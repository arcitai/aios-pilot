use serde_json::Value;

use super::{notion::NotionPageSummary, source_text::strip_controls};

pub(super) fn page_summary_from_api(page: Value) -> Option<NotionPageSummary> {
    if page.get("object").and_then(Value::as_str) != Some("page") {
        return None;
    }
    let id = page
        .get("id")
        .and_then(Value::as_str)
        .and_then(normalize_uuid)?;
    let title = page_title(&page)?;
    let url = safe_page_url(&id, page.get("url")?.as_str()?)?;
    let last_edited_time = page
        .get("last_edited_time")
        .and_then(Value::as_str)
        .map(safe_timestamp)
        .filter(|value| !value.is_empty());
    Some(NotionPageSummary {
        url,
        id,
        title,
        last_edited_time,
    })
}

pub(super) fn page_title(page: &Value) -> Option<String> {
    let properties = page.get("properties")?.as_object()?;
    let title = properties.values().find_map(|property| {
        let title = property.get("title")?.as_array()?;
        Some(title.iter().filter_map(rich_text_plain).collect::<String>())
    })?;
    let title = safe_label(&title);
    (!title.is_empty()).then_some(title)
}

fn rich_text_plain(value: &Value) -> Option<String> {
    value
        .get("plain_text")
        .and_then(Value::as_str)
        .or_else(|| value.get("text")?.get("content")?.as_str())
        .map(strip_controls)
}

pub(super) fn render_block(block: &Value) -> (String, bool) {
    let Some(kind) = block.get("type").and_then(Value::as_str) else {
        return (String::new(), false);
    };
    let Some(data) = block.get(kind) else {
        return (String::new(), false);
    };
    let text = data
        .get("rich_text")
        .and_then(Value::as_array)
        .or_else(|| data.get("title").and_then(Value::as_array))
        .map(|parts| parts.iter().filter_map(rich_text_plain).collect::<String>())
        .or_else(|| {
            data.get("title")
                .and_then(Value::as_str)
                .map(strip_controls)
        })
        .unwrap_or_default();
    let rendered = match kind {
        "heading_1" => prefixed_text(&text, "# "),
        "heading_2" => prefixed_text(&text, "## "),
        "heading_3" => prefixed_text(&text, "### "),
        "bulleted_list_item" => prefixed_text(&text, "- "),
        "numbered_list_item" => prefixed_text(&text, "1. "),
        "to_do" => prefixed_text(
            &text,
            if data.get("checked").and_then(Value::as_bool) == Some(true) {
                "- [x] "
            } else {
                "- [ ] "
            },
        ),
        "quote" => prefixed_text(&text, "> "),
        "callout" => prefixed_text(&text, "Note: "),
        "code" if !text.is_empty() => format!("```\n{text}\n```\n"),
        "table_row" => data
            .get("cells")
            .and_then(Value::as_array)
            .map(|cells| {
                format!(
                    "| {} |\n",
                    cells
                        .iter()
                        .map(|cell| cell
                            .as_array()
                            .map(|parts| parts
                                .iter()
                                .filter_map(rich_text_plain)
                                .collect::<String>())
                            .unwrap_or_default())
                        .collect::<Vec<_>>()
                        .join(" | ")
                )
            })
            .unwrap_or_default(),
        "paragraph" | "toggle" | "child_page" | "child_database" => prefixed_text(&text, ""),
        "table" | "column" | "column_list" | "synced_block" | "template" => String::new(),
        _ => return (String::new(), false),
    };
    (rendered, true)
}

fn prefixed_text(text: &str, prefix: &str) -> String {
    if text.is_empty() {
        String::new()
    } else {
        format!("{prefix}{text}\n")
    }
}

pub(super) fn safe_label(value: &str) -> String {
    strip_controls(value).trim().chars().take(200).collect()
}

fn safe_timestamp(value: &str) -> String {
    if value.len() <= 40 && value.bytes().all(|byte| byte.is_ascii_graphic()) {
        value.to_string()
    } else {
        String::new()
    }
}

pub(super) fn safe_page_url(page_id: &str, value: &str) -> Option<String> {
    if value.len() > 2048 {
        return None;
    }
    let parsed = url::Url::parse(value).ok()?;
    let host = parsed.host_str()?;
    let path = parsed
        .path_segments()?
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let allowed_host = matches!(host, "app.notion.com" | "notion.so" | "www.notion.so");
    let valid_path = if host == "app.notion.com" {
        path.len() == 2 && path[0] == "p"
    } else {
        !path.is_empty() && path.len() <= 8
    };
    if parsed.scheme() != "https"
        || !allowed_host
        || !valid_path
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }
    let last_segment = path.last()?;
    let candidate_id = normalize_uuid(last_segment)
        .or_else(|| {
            last_segment
                .rsplit_once('-')
                .and_then(|(_, suffix)| normalize_uuid(suffix))
        })
        .or_else(|| {
            [36, 32].into_iter().find_map(|suffix_len| {
                last_segment
                    .len()
                    .checked_sub(suffix_len)
                    .and_then(|start| last_segment.get(start..))
                    .and_then(normalize_uuid)
            })
        })?;
    (candidate_id == page_id).then(|| parsed.to_string().trim_end_matches('/').to_string())
}

pub(super) fn normalize_uuid(value: &str) -> Option<String> {
    if value.contains('-')
        && (value.len() != 36
            || ![8, 13, 18, 23]
                .iter()
                .all(|index| value.as_bytes().get(*index) == Some(&b'-')))
    {
        return None;
    }
    let compact: String = value
        .chars()
        .filter(|character| *character != '-')
        .collect();
    if compact.len() != 32 || !compact.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let compact = compact.to_ascii_lowercase();
    Some(format!(
        "{}-{}-{}-{}-{}",
        &compact[0..8],
        &compact[8..12],
        &compact[12..16],
        &compact[16..20],
        &compact[20..32]
    ))
}

pub(super) fn sanitize_query(query: &str) -> String {
    strip_controls(query).trim().chars().take(100).collect()
}
