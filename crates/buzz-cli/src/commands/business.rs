//! `buzz business` commands for the private AIOS business workspace canvas.

use std::{collections::HashSet, fs::File, io::Read};

use buzz_business::{
    parse_document, BusinessDocument, BusinessSource, ConnectionStatus, SourceKind,
    MAX_DOCUMENT_BYTES,
};
use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    client::{extract_d_tag, BuzzClient},
    commands::{channels, parse_write_response},
    error::CliError,
    BusinessCmd, BusinessSourceCmd, BusinessSourceKind,
};

/// Exact channel description shared with the desktop business-workspace discovery.
pub const BUSINESS_CHANNEL_MARKER: &str = "AIOS business workspace · private company context and main-agent conversation. [aios.business-workspace:v1]";

const CHANNEL_SCAN_LIMIT: u32 = 10_000;

#[derive(Debug, Clone)]
struct BusinessChannel {
    id: String,
}

#[derive(Debug, Clone)]
struct CanvasSnapshot {
    revision: String,
    created_at: u64,
    content: String,
}

#[derive(Debug)]
struct ChannelMetadata {
    id: String,
    name: String,
    about: Option<String>,
    is_private: bool,
    is_public: bool,
    archived: bool,
}

/// Dispatch one `buzz business` command, writing JSON to stdout.
pub async fn dispatch(cmd: BusinessCmd, client: &BuzzClient) -> Result<(), CliError> {
    match cmd {
        BusinessCmd::Init {
            name,
            website,
            summary,
            audience,
            offers,
            goals,
        } => {
            let output = cmd_init(client, name, website, summary, audience, offers, goals).await?;
            print_json(&output)
        }
        BusinessCmd::Show { channel } => print_json(&cmd_show(client, &channel).await?),
        BusinessCmd::Update {
            channel,
            file,
            expected_revision,
        }
        | BusinessCmd::Import {
            channel,
            file,
            expected_revision,
        } => {
            let output = cmd_update(client, &channel, &file, expected_revision.as_deref()).await?;
            print_json(&output)
        }
        BusinessCmd::Export { channel, output } => {
            let (channel_id, document) = cmd_export(client, &channel).await?;
            let json = document.to_json().map_err(map_input_document_error)?;
            match output {
                Some(path) => {
                    std::fs::write(&path, json.as_bytes()).map_err(|error| {
                        CliError::Other(format!("could not write export `{path}`: {error}"))
                    })?;
                    print_json(&json!({
                        "channel_id": channel_id,
                        "output": path,
                        "exported": true,
                    }))
                }
                None => {
                    println!("{json}");
                    Ok(())
                }
            }
        }
        BusinessCmd::Source(source_cmd) => {
            let output = match source_cmd {
                BusinessSourceCmd::List { channel } => cmd_source_list(client, &channel).await?,
                BusinessSourceCmd::Add {
                    channel,
                    title,
                    kind,
                    content,
                    url,
                    expected_revision,
                } => {
                    cmd_source_add(
                        client,
                        &channel,
                        title,
                        kind,
                        &content,
                        url,
                        expected_revision.as_deref(),
                    )
                    .await?
                }
                BusinessSourceCmd::Remove {
                    channel,
                    id,
                    expected_revision,
                } => cmd_source_remove(client, &channel, &id, expected_revision.as_deref()).await?,
            };
            print_json(&output)
        }
    }
}

async fn cmd_init(
    client: &BuzzClient,
    name: String,
    website: String,
    summary: String,
    audience: String,
    offers: Vec<String>,
    goals: Vec<String>,
) -> Result<Value, CliError> {
    let mut initial = BusinessDocument::new(name);
    initial.company.website = website;
    initial.company.summary = summary;
    initial.company.audience = audience;
    initial.company.offers = offers;
    initial.company.goals = goals;
    initial.validate().map_err(map_input_document_error)?;

    let (workspace, created, channel_event_id) =
        match find_business_channel_for_company(client, &initial.company.name).await? {
            Some(workspace) => (workspace, false, None),
            None => {
                let name = workspace_channel_name(&initial.company.name);
                let (workspace, event_id) = create_business_channel(client, &name).await?;
                (workspace, true, Some(event_id))
            }
        };

    let snapshot = fetch_snapshot(client, &workspace.id, true).await?;
    let (document, initialized, canvas_event_id) = match snapshot {
        Some(snapshot) => (parse_canvas(&workspace.id, &snapshot.content)?, false, None),
        None => {
            let content = initial.to_json().map_err(map_input_document_error)?;
            let response = write_document(client, &workspace.id, &content, None)
                .await
                .map_err(|error| {
                    CliError::Other(format!(
                        "business workspace channel {} exists; initial canvas write failed: {error}. Re-run `buzz business init` to resume safely",
                        workspace.id
                    ))
                })?;
            let event_id = event_id_from_write(&response)?;
            (initial, true, Some(event_id))
        }
    };

    Ok(json!({
        "channel_id": workspace.id,
        "created": created,
        "initialized": initialized,
        "channel_event_id": channel_event_id,
        "canvas_event_id": canvas_event_id,
        "document": document,
    }))
}

async fn cmd_show(client: &BuzzClient, channel_id: &str) -> Result<Value, CliError> {
    let (workspace, snapshot, document) = load_document(client, channel_id, false).await?;
    Ok(json!({
        "channel_id": workspace.id,
        "revision": snapshot.revision,
        "document": document,
    }))
}

async fn cmd_update(
    client: &BuzzClient,
    channel_id: &str,
    path: &str,
    expected_revision: Option<&str>,
) -> Result<Value, CliError> {
    let input = read_bounded_input(path)?;
    let proposed = parse_document(&input).map_err(map_input_document_error)?;
    let (workspace, snapshot, current) = load_document(client, channel_id, true).await?;
    check_expected_revision(&snapshot, expected_revision)?;
    validate_connection_transition(&current, &proposed)?;
    let content = proposed.to_json().map_err(map_input_document_error)?;
    let response = write_document(client, &workspace.id, &content, Some(&snapshot)).await?;
    let mut output = accepted_write_value(&response, &workspace.id)?;
    output["document"] = serde_json::to_value(proposed)
        .map_err(|error| CliError::Other(format!("could not encode business document: {error}")))?;
    Ok(output)
}

async fn cmd_export(
    client: &BuzzClient,
    channel_id: &str,
) -> Result<(String, BusinessDocument), CliError> {
    let (workspace, _, document) = load_document(client, channel_id, false).await?;
    Ok((workspace.id, document))
}

async fn cmd_source_list(client: &BuzzClient, channel_id: &str) -> Result<Value, CliError> {
    let (workspace, snapshot, document) = load_document(client, channel_id, false).await?;
    Ok(json!({
        "channel_id": workspace.id,
        "revision": snapshot.revision,
        "sources": document.sources,
    }))
}

async fn cmd_source_add(
    client: &BuzzClient,
    channel_id: &str,
    title: String,
    kind: BusinessSourceKind,
    content: &str,
    url: Option<String>,
    expected_revision: Option<&str>,
) -> Result<Value, CliError> {
    let content = read_bounded_content(content)?;
    let (workspace, snapshot, mut document) = load_document(client, channel_id, true).await?;
    check_expected_revision(&snapshot, expected_revision)?;
    let source = BusinessSource {
        id: Uuid::new_v4().to_string(),
        title,
        kind: match kind {
            BusinessSourceKind::Note => SourceKind::Note,
            BusinessSourceKind::Url => SourceKind::Url,
            BusinessSourceKind::File => SourceKind::File,
        },
        content,
        url,
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
    };
    document.sources.push(source.clone());
    document.validate().map_err(map_input_document_error)?;
    let content = document.to_json().map_err(map_input_document_error)?;
    let response = write_document(client, &workspace.id, &content, Some(&snapshot)).await?;
    let mut output = accepted_write_value(&response, &workspace.id)?;
    output["source"] = serde_json::to_value(source)
        .map_err(|error| CliError::Other(format!("could not encode source: {error}")))?;
    Ok(output)
}

async fn cmd_source_remove(
    client: &BuzzClient,
    channel_id: &str,
    source_id: &str,
    expected_revision: Option<&str>,
) -> Result<Value, CliError> {
    let (workspace, snapshot, mut document) = load_document(client, channel_id, true).await?;
    check_expected_revision(&snapshot, expected_revision)?;
    let Some(index) = document
        .sources
        .iter()
        .position(|source| source.id == source_id)
    else {
        return Err(CliError::NotFound(format!(
            "business source `{source_id}` was not found"
        )));
    };
    document.sources.remove(index);
    let content = document.to_json().map_err(map_input_document_error)?;
    let response = write_document(client, &workspace.id, &content, Some(&snapshot)).await?;
    let mut output = accepted_write_value(&response, &workspace.id)?;
    output["removed_source_id"] = json!(source_id);
    Ok(output)
}

async fn load_document(
    client: &BuzzClient,
    channel_id: &str,
    writer_pinned: bool,
) -> Result<(BusinessChannel, CanvasSnapshot, BusinessDocument), CliError> {
    let workspace = select_business_channel(client, channel_id).await?;
    let snapshot = fetch_snapshot(client, &workspace.id, writer_pinned)
        .await?
        .ok_or_else(|| {
            CliError::NotFound(format!(
                "business workspace {} has no document; run `buzz business init`",
                workspace.id
            ))
        })?;
    let document = parse_canvas(&workspace.id, &snapshot.content)?;
    Ok((workspace, snapshot, document))
}

fn parse_canvas(channel_id: &str, content: &str) -> Result<BusinessDocument, CliError> {
    parse_document(content).map_err(|error| {
        CliError::Other(format!(
            "business canvas for channel {channel_id} is not a valid schema-version-one document: {error}"
        ))
    })
}

async fn fetch_snapshot(
    client: &BuzzClient,
    channel_id: &str,
    writer_pinned: bool,
) -> Result<Option<CanvasSnapshot>, CliError> {
    let Some(head) = channels::fetch_canvas_head(client, channel_id, writer_pinned).await? else {
        return Ok(None);
    };
    let revision = head
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("canvas head is missing its event ID".into()))?
        .to_string();
    if revision.len() != 64
        || !revision
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(CliError::Other(
            "canvas head has a malformed event ID".into(),
        ));
    }
    let created_at = head
        .get("created_at")
        .and_then(Value::as_u64)
        .ok_or_else(|| CliError::Other("canvas head is missing a valid created_at".into()))?;
    let content = head
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("canvas head is missing string content".into()))?
        .to_string();
    if content.len() > MAX_DOCUMENT_BYTES {
        return Err(CliError::Other(format!(
            "business canvas for channel {channel_id} exceeds the {MAX_DOCUMENT_BYTES}-byte limit"
        )));
    }
    Ok(Some(CanvasSnapshot {
        revision,
        created_at,
        content,
    }))
}

fn workspace_channel_name(company_name: &str) -> String {
    company_name.trim().to_string()
}

async fn channel_catalog(
    client: &BuzzClient,
) -> Result<(Vec<ChannelMetadata>, HashSet<String>), CliError> {
    let pubkey = client.keys().public_key().to_hex();
    let membership_events = client
        .query_all_bounded(
            json!({
                "kinds": [39002],
                "#p": [pubkey],
                "consistency": "strong",
            }),
            CHANNEL_SCAN_LIMIT,
        )
        .await?;
    let member_ids: HashSet<String> = membership_events
        .iter()
        .map(extract_d_tag)
        .filter(|id| !id.is_empty())
        .map(|id| id.to_ascii_lowercase())
        .collect();

    let metadata_events = client
        .query_all_bounded(
            json!({
                "kinds": [39000],
                "consistency": "strong",
            }),
            CHANNEL_SCAN_LIMIT,
        )
        .await?;
    let mut metadata = Vec::new();
    for event in &metadata_events {
        if let Some(channel) = parse_channel_metadata(event)? {
            metadata.push(channel);
        }
    }
    Ok((metadata, member_ids))
}

async fn find_business_channel_for_company(
    client: &BuzzClient,
    company_name: &str,
) -> Result<Option<BusinessChannel>, CliError> {
    let expected_name = workspace_channel_name(company_name);
    let (metadata, member_ids) = channel_catalog(client).await?;
    let named: Vec<&ChannelMetadata> = metadata
        .iter()
        .filter(|channel| channel.name.eq_ignore_ascii_case(&expected_name))
        .collect();
    if named.len() > 1 {
        return Err(CliError::Usage(format!(
            "multiple channels use the business workspace name `{expected_name}`; resolve the duplicate before continuing"
        )));
    }
    let Some(channel) = named.first().copied() else {
        return Ok(None);
    };
    validate_business_channel(channel, &member_ids).map(Some)
}

async fn select_business_channel(
    client: &BuzzClient,
    channel_id: &str,
) -> Result<BusinessChannel, CliError> {
    let selected_id = Uuid::parse_str(channel_id)
        .map_err(|_| CliError::Usage(format!("invalid business channel UUID: {channel_id}")))?
        .to_string();
    let (metadata, member_ids) = channel_catalog(client).await?;
    let matches: Vec<&ChannelMetadata> = metadata
        .iter()
        .filter(|channel| channel.id.eq_ignore_ascii_case(&selected_id))
        .collect();
    if matches.len() > 1 {
        return Err(CliError::Usage(format!(
            "channel {selected_id} has ambiguous business metadata"
        )));
    }
    let channel = matches.first().copied().ok_or_else(|| {
        CliError::NotFound(format!(
            "channel {selected_id} is not a discoverable AIOS business workspace"
        ))
    })?;
    validate_business_channel(channel, &member_ids)
}

fn validate_business_channel(
    channel: &ChannelMetadata,
    member_ids: &HashSet<String>,
) -> Result<BusinessChannel, CliError> {
    if channel.about.as_deref() != Some(BUSINESS_CHANNEL_MARKER) {
        return Err(CliError::Usage(format!(
            "channel {} is not marked as an AIOS business workspace; refusing to use its canvas",
            channel.id
        )));
    }
    if channel.is_private == channel.is_public {
        return Err(CliError::Usage(format!(
            "marked channel {} does not have an unambiguous private visibility",
            channel.id
        )));
    }
    if !channel.is_private {
        return Err(CliError::Usage(format!(
            "marked channel {} is not private; refusing to use its canvas",
            channel.id
        )));
    }
    if channel.archived {
        return Err(CliError::Usage(format!(
            "marked business workspace {} is archived",
            channel.id
        )));
    }
    if !member_ids.contains(&channel.id.to_ascii_lowercase()) {
        return Err(CliError::Auth(format!(
            "the current signer is not a member of business workspace {}",
            channel.id
        )));
    }
    Ok(BusinessChannel {
        id: channel.id.clone(),
    })
}

fn parse_channel_metadata(event: &Value) -> Result<Option<ChannelMetadata>, CliError> {
    let Some(tags) = event.get("tags").and_then(Value::as_array) else {
        return Ok(None);
    };
    let mut id = None;
    let mut name = None;
    let mut about = None;
    let mut is_private = false;
    let mut is_public = false;
    let mut archived = false;
    for tag in tags {
        let Some(parts) = tag.as_array() else {
            continue;
        };
        let Some(key) = parts.first().and_then(Value::as_str) else {
            continue;
        };
        let value = parts.get(1).and_then(Value::as_str);
        match key {
            "d" => id = value.map(str::to_string),
            "name" => name = value.map(str::to_string),
            "about" => about = value.map(str::to_string),
            "private" => is_private = true,
            "public" => is_public = true,
            "archived" => archived = value != Some("false"),
            _ => {}
        }
    }
    let marked = about.as_deref() == Some(BUSINESS_CHANNEL_MARKER);
    let id = id.ok_or_else(|| CliError::Other("channel metadata is missing its d tag".into()))?;
    let id = Uuid::parse_str(&id)
        .map_err(|_| CliError::Other("channel metadata has an invalid d tag".into()))?
        .to_string();
    let name = name
        .ok_or_else(|| CliError::Other("channel metadata is missing its name tag".into()))?
        .to_string();
    if marked && name.trim().is_empty() {
        return Err(CliError::Other(
            "marked business channel has an empty name".into(),
        ));
    }
    Ok(Some(ChannelMetadata {
        id,
        name,
        about,
        is_private,
        is_public,
        archived,
    }))
}

async fn create_business_channel(
    client: &BuzzClient,
    name: &str,
) -> Result<(BusinessChannel, String), CliError> {
    let id = Uuid::new_v4();
    let builder = buzz_sdk::build_create_channel(
        id,
        name,
        Some(buzz_sdk::Visibility::Private),
        Some(buzz_sdk::ChannelKind::Stream),
        Some(BUSINESS_CHANNEL_MARKER),
        None,
    )
    .map_err(|error| CliError::Other(format!("could not build business channel event: {error}")))?;
    let event = client.sign_event(builder)?;
    let raw = client.submit_event(event).await?;
    let created = parse_write_response(&raw, "business workspace channel creation was rejected")?;
    let created: Value = serde_json::from_str(&created)
        .map_err(|error| CliError::Other(format!("malformed channel create response: {error}")))?;
    let event_id = created
        .get("event_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| CliError::Other("channel create response is missing event_id".into()))?;
    let workspace = select_business_channel(client, &id.to_string()).await?;
    Ok((workspace, event_id))
}

async fn write_document(
    client: &BuzzClient,
    channel_id: &str,
    content: &str,
    snapshot: Option<&CanvasSnapshot>,
) -> Result<String, CliError> {
    let channel_uuid = Uuid::parse_str(channel_id).map_err(|_| {
        CliError::Usage(format!(
            "invalid business workspace channel ID: {channel_id}"
        ))
    })?;
    let builder = match snapshot {
        Some(snapshot) => buzz_sdk::build_set_canvas_after_head(
            channel_uuid,
            content,
            &snapshot.revision,
            snapshot.created_at,
        ),
        None => buzz_sdk::build_set_canvas(channel_uuid, content, Some("none")),
    }
    .map_err(|error| CliError::Other(format!("could not build business canvas event: {error}")))?;
    let event = client.sign_event(builder)?;
    let event_id = event.id.to_hex();
    match client.submit_event(event).await {
        Ok(response) => {
            match channels::fetch_canvas_ancestry(client, channel_id).await {
                Ok(stream) if buzz_sdk::canvas_write_survived(&event_id, &stream) => Ok(response),
                Ok(_) => match channels::fetch_canvas_event_exists(client, channel_id, &event_id).await {
                    Ok(true) => Err(CliError::Conflict(format!(
                        "business canvas write {event_id} was superseded by a concurrent edit; it remains in history"
                    ))),
                    Ok(false) => Err(CliError::DeliveryUnknown(format!(
                        "relay accepted business canvas write {event_id}, but a strong history read could not find it"
                    ))),
                    Err(_) => Err(CliError::DeliveryUnknown(format!(
                        "relay accepted business canvas write {event_id}, but its persistence could not be verified; inspect `buzz business show` before retrying"
                    ))),
                },
                Err(_) => {
                    eprintln!("warning: business canvas write {event_id} was accepted, but post-write verification failed; inspect `buzz business show` if another edit may have landed");
                    Ok(response)
                }
            }
        }
        Err(error) if is_canvas_revision_conflict(&error) => {
            let stream = channels::fetch_canvas_ancestry(client, channel_id)
                .await
                .map_err(|_| {
                    CliError::DeliveryUnknown(format!(
                        "business canvas write {event_id}: the relay returned a revision conflict and history verification failed; inspect `buzz business show` before retrying"
                    ))
                })?;
            if buzz_sdk::canvas_write_survived(&event_id, &stream) {
                return Ok(json!({
                    "event_id": event_id,
                    "accepted": true,
                    "message": "",
                })
                .to_string());
            }
            match channels::fetch_canvas_event_exists(client, channel_id, &event_id).await {
                Ok(true) => Err(CliError::Conflict(format!(
                    "business canvas write {event_id} was persisted but superseded by a concurrent edit; it remains in history"
                ))),
                Ok(false) => Err(CliError::Conflict(
                    "business canvas changed since it was read; no update was written".into(),
                )),
                Err(_) => Err(CliError::DeliveryUnknown(format!(
                    "business canvas write {event_id}: the relay returned a revision conflict and persistence could not be verified; inspect `buzz business show` before retrying"
                ))),
            }
        }
        Err(error) => Err(error),
    }
}

fn is_canvas_revision_conflict(error: &CliError) -> bool {
    matches!(error, CliError::Relay { status: 409, body } if body.contains("canvas changed"))
}

fn validate_connection_transition(
    current: &BusinessDocument,
    proposed: &BusinessDocument,
) -> Result<(), CliError> {
    for connection in &proposed.connections {
        if connection.status != ConnectionStatus::Connected {
            continue;
        }
        let previously_connected = current.connections.iter().any(|existing| {
            existing.id == connection.id
                && existing.provider == connection.provider
                && existing.status == ConnectionStatus::Connected
        });
        if !previously_connected {
            return Err(CliError::Usage(format!(
                "cannot mark connection `{}` connected from the CLI; a successful provider operation is required",
                connection.id
            )));
        }
    }
    Ok(())
}

fn check_expected_revision(
    snapshot: &CanvasSnapshot,
    expected_revision: Option<&str>,
) -> Result<(), CliError> {
    let Some(expected) = expected_revision else {
        return Ok(());
    };
    if expected != "none"
        && (expected.len() != 64
            || !expected
                .chars()
                .all(|character| character.is_ascii_hexdigit()))
    {
        return Err(CliError::Usage(
            "--expected-revision must be `none` or a 64-character hexadecimal event ID".into(),
        ));
    }
    if expected == "none" || !snapshot.revision.eq_ignore_ascii_case(expected) {
        return Err(CliError::Conflict(format!(
            "business canvas revision changed: expected {expected}, current revision is {}",
            snapshot.revision
        )));
    }
    Ok(())
}

fn read_bounded_input(path: &str) -> Result<String, CliError> {
    let mut bytes = Vec::with_capacity(8 * 1024);
    if path == "-" {
        std::io::stdin()
            .take((MAX_DOCUMENT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|error| CliError::Usage(format!("could not read stdin: {error}")))?;
    } else {
        File::open(path)
            .map_err(|error| CliError::Usage(format!("could not open `{path}`: {error}")))?
            .take((MAX_DOCUMENT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|error| CliError::Usage(format!("could not read `{path}`: {error}")))?;
    }
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(CliError::Usage(format!(
            "business document exceeds the {MAX_DOCUMENT_BYTES}-byte limit"
        )));
    }
    String::from_utf8(bytes)
        .map_err(|error| CliError::Usage(format!("business document is not valid UTF-8: {error}")))
}

fn read_bounded_content(content: &str) -> Result<String, CliError> {
    if content != "-" {
        return Ok(content.to_string());
    }
    let mut bytes = Vec::new();
    std::io::stdin()
        .take((MAX_DOCUMENT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CliError::Usage(format!("could not read source content from stdin: {error}"))
        })?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(CliError::Usage(format!(
            "source content exceeds the {MAX_DOCUMENT_BYTES}-byte input limit"
        )));
    }
    String::from_utf8(bytes)
        .map_err(|error| CliError::Usage(format!("source content is not valid UTF-8: {error}")))
}

fn accepted_write_value(response: &str, channel_id: &str) -> Result<Value, CliError> {
    let normalized = parse_write_response(response, "business canvas write was superseded")?;
    let mut output: Value = serde_json::from_str(&normalized)
        .map_err(|error| CliError::Other(format!("malformed business write response: {error}")))?;
    output["channel_id"] = json!(channel_id);
    Ok(output)
}

fn event_id_from_write(response: &str) -> Result<String, CliError> {
    let normalized = parse_write_response(response, "business canvas write was superseded")?;
    let value: Value = serde_json::from_str(&normalized)
        .map_err(|error| CliError::Other(format!("malformed business write response: {error}")))?;
    value
        .get("event_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| CliError::Other("business canvas response is missing event_id".into()))
}

fn map_input_document_error(error: impl std::fmt::Display) -> CliError {
    CliError::Usage(error.to_string())
}

fn print_json(value: &Value) -> Result<(), CliError> {
    let output = serde_json::to_string(value).map_err(|error| {
        CliError::Other(format!("could not encode business command output: {error}"))
    })?;
    println!("{output}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::State,
        http::StatusCode,
        response::{IntoResponse, Response},
        routing::post,
        Json, Router,
    };
    use buzz_business::BusinessConnection;
    use nostr::Keys;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct TestRelay {
        data: Arc<Mutex<TestRelayData>>,
    }

    #[derive(Default)]
    struct TestRelayData {
        metadata: Vec<Value>,
        memberships: Vec<Value>,
        canvases: Vec<Value>,
        writes: Vec<Value>,
        deny_queries: bool,
        conflict_canvas_writes: bool,
    }

    async fn start_test_relay() -> (BuzzClient, TestRelay, String, tokio::task::JoinHandle<()>) {
        let relay = TestRelay::default();
        let app = Router::new()
            .route("/query", post(test_query))
            .route("/events", post(test_event))
            .with_state(relay.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test relay");
        let address = listener.local_addr().expect("test relay address");
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve test relay");
        });
        let keys = Keys::generate();
        let pubkey = keys.public_key().to_hex();
        let client = BuzzClient::new(format!("http://{address}"), keys, None, None)
            .expect("construct test client");
        (client, relay, pubkey, task)
    }

    async fn test_query(
        State(relay): State<TestRelay>,
        Json(filters): Json<Vec<Value>>,
    ) -> Response {
        let data = relay.data.lock().expect("test relay lock");
        if data.deny_queries {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "membership required"})),
            )
                .into_response();
        }
        let filter = filters.first().cloned().unwrap_or_else(|| json!({}));
        let kind = filter["kinds"]
            .as_array()
            .and_then(|kinds| kinds.first())
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let events = match kind {
            39000 => data.metadata.clone(),
            39002 => data.memberships.clone(),
            40100 => {
                let mut events = data.canvases.clone();
                if let Some(ids) = filter["ids"].as_array() {
                    events.retain(|event| event.get("id").is_some_and(|id| ids.contains(id)));
                }
                if let Some(channel_ids) = filter["#h"].as_array() {
                    events.retain(|event| {
                        event["tags"].as_array().is_some_and(|tags| {
                            tags.iter().any(|tag| {
                                tag.as_array().is_some_and(|parts| {
                                    parts.first().and_then(Value::as_str) == Some("h")
                                        && parts.get(1).and_then(Value::as_str).is_some_and(
                                            |channel| {
                                                channel_ids.iter().any(|candidate| {
                                                    candidate.as_str() == Some(channel)
                                                })
                                            },
                                        )
                                })
                            })
                        })
                    });
                }
                events.sort_by(|left, right| {
                    right["created_at"]
                        .as_u64()
                        .cmp(&left["created_at"].as_u64())
                });
                if let Some(limit) = filter["limit"].as_u64() {
                    events.truncate(limit as usize);
                }
                events
            }
            _ => Vec::new(),
        };
        Json(events).into_response()
    }

    async fn test_event(State(relay): State<TestRelay>, Json(event): Json<Value>) -> Response {
        let mut data = relay.data.lock().expect("test relay lock");
        data.writes.push(event.clone());
        let kind = event["kind"].as_u64().unwrap_or_default();
        if kind == 40100 && data.conflict_canvas_writes {
            return (
                StatusCode::CONFLICT,
                Json(json!({"error": "canvas changed since it was loaded"})),
            )
                .into_response();
        }
        if kind == 9007 {
            let tags = event["tags"].as_array().cloned().unwrap_or_default();
            let get_tag = |key: &str| {
                tags.iter().find_map(|tag| {
                    let parts = tag.as_array()?;
                    (parts.first()?.as_str()? == key)
                        .then(|| parts.get(1).and_then(Value::as_str).map(str::to_string))
                        .flatten()
                })
            };
            let channel_id = get_tag("h").unwrap_or_default();
            let name = get_tag("name").unwrap_or_default();
            let about = get_tag("about").unwrap_or_default();
            let visibility = get_tag("visibility").unwrap_or_default();
            let mut metadata_tags = vec![json!(["d", channel_id]), json!(["name", name])];
            if !about.is_empty() {
                metadata_tags.push(json!(["about", about]));
            }
            metadata_tags.push(if visibility == "private" {
                json!(["private"])
            } else {
                json!(["public"])
            });
            data.metadata.push(json!({
                "id": "created-metadata-event",
                "kind": 39000,
                "created_at": 1,
                "tags": metadata_tags,
                "content": "",
            }));
            data.memberships.push(json!({
                "id": "created-membership-event",
                "kind": 39002,
                "created_at": 1,
                "tags": [["d", channel_id], ["p", event["pubkey"].as_str().unwrap_or_default()]],
                "content": "",
            }));
        } else if kind == 40100 {
            data.canvases.push(event.clone());
        }
        Json(json!({
            "event_id": event["id"],
            "accepted": true,
            "message": "",
        }))
        .into_response()
    }

    fn add_managed_workspace(
        relay: &TestRelay,
        channel_id: &str,
        pubkey: &str,
        document: Option<&str>,
    ) {
        let mut data = relay.data.lock().expect("test relay lock");
        data.metadata.push(json!({
            "id": "metadata-event",
            "kind": 39000,
            "created_at": 1,
            "tags": [
                ["d", channel_id],
                ["name", workspace_channel_name("Example Co")],
                ["about", BUSINESS_CHANNEL_MARKER],
                ["private"],
            ],
            "content": "",
        }));
        data.memberships.push(json!({
            "id": "membership-event",
            "kind": 39002,
            "created_at": 1,
            "tags": [["d", channel_id], ["p", pubkey]],
            "content": "",
        }));
        if let Some(document) = document {
            data.canvases.push(canvas_event(channel_id, document));
        }
    }

    fn canvas_event(channel_id: &str, content: &str) -> Value {
        json!({
            "id": "a".repeat(64),
            "pubkey": "b".repeat(64),
            "kind": 40100,
            "content": content,
            "created_at": 100,
            "tags": [["h", channel_id], ["expected-revision", "none"]],
            "sig": "c".repeat(128),
        })
    }

    fn sample_document() -> BusinessDocument {
        let mut document = BusinessDocument::new("Example Co");
        document.company.summary = "A small company".into();
        document
    }

    #[test]
    fn connection_state_cannot_be_elevated_by_a_descriptor() {
        let current = BusinessDocument::new("Example");
        let mut proposed = BusinessDocument::new("Example");
        proposed.connections.push(BusinessConnection {
            id: "drive-1".into(),
            provider: "google_drive".into(),
            label: "Research".into(),
            status: ConnectionStatus::Connected,
            details: None,
        });
        let error = validate_connection_transition(&current, &proposed)
            .expect_err("new connected descriptor must be rejected");
        assert!(error.to_string().contains("successful provider operation"));
    }

    #[test]
    fn existing_connected_state_can_round_trip_but_not_change_provider() {
        let mut current = BusinessDocument::new("Example");
        current.connections.push(BusinessConnection {
            id: "drive-1".into(),
            provider: "google_drive".into(),
            label: "Research".into(),
            status: ConnectionStatus::Connected,
            details: None,
        });
        let mut proposed = current.clone();
        proposed.connections[0].label = "Updated label".into();
        assert!(validate_connection_transition(&current, &proposed).is_ok());
        proposed.connections[0].provider = "other_provider".into();
        assert!(validate_connection_transition(&current, &proposed).is_err());
    }

    #[test]
    fn marker_and_workspace_safety_rules_are_exact() {
        assert!(BUSINESS_CHANNEL_MARKER.ends_with("[aios.business-workspace:v1]"));
        assert_eq!(workspace_channel_name("Example Co"), "Example Co");
    }

    #[tokio::test]
    async fn init_creates_private_marked_workspace_and_initial_canvas_with_cas() {
        let (client, relay, _, task) = start_test_relay().await;
        let result = cmd_init(
            &client,
            "Example Co".into(),
            "https://example.test".into(),
            "A small company".into(),
            "Independent shops".into(),
            vec!["Consulting".into()],
            vec!["Reach 20 customers".into()],
        )
        .await
        .expect("initialization succeeds");
        assert_eq!(result["created"], true);
        assert_eq!(result["initialized"], true);
        assert!(result["channel_id"].as_str().is_some());
        let data = relay.data.lock().expect("test relay lock");
        let create = data
            .writes
            .iter()
            .find(|event| event["kind"] == 9007)
            .expect("private channel create event");
        assert!(create["tags"].as_array().is_some_and(|tags| {
            tags.iter()
                .any(|tag| tag == &json!(["visibility", "private"]))
                && tags
                    .iter()
                    .any(|tag| tag == &json!(["about", BUSINESS_CHANNEL_MARKER]))
        }));
        let canvas = data
            .writes
            .iter()
            .find(|event| event["kind"] == 40100)
            .expect("initial canvas event");
        assert!(canvas["tags"].as_array().is_some_and(|tags| {
            tags.iter()
                .any(|tag| tag == &json!(["expected-revision", "none"]))
        }));
        let document: Value = serde_json::from_str(
            canvas["content"]
                .as_str()
                .expect("canvas content is JSON text"),
        )
        .expect("canvas document is valid JSON");
        assert_eq!(document["schemaVersion"], 1);
        drop(data);
        task.abort();
    }

    #[tokio::test]
    async fn init_refuses_reserved_name_collision_without_writing_any_canvas() {
        let (client, relay, pubkey, task) = start_test_relay().await;
        let channel_id = "123e4567-e89b-12d3-a456-426614174000";
        {
            let mut data = relay.data.lock().expect("test relay lock");
            data.metadata.push(json!({
                "id": "ordinary-metadata-event",
                "kind": 39000,
                "created_at": 1,
                "tags": [["d", channel_id], ["name", workspace_channel_name("Example Co")], ["about", "ordinary channel"], ["private"]],
                "content": "",
            }));
            data.memberships.push(json!({
                "id": "ordinary-membership-event",
                "kind": 39002,
                "created_at": 1,
                "tags": [["d", channel_id], ["p", pubkey]],
                "content": "",
            }));
        }
        let result = cmd_init(
            &client,
            "Example Co".into(),
            String::new(),
            String::new(),
            String::new(),
            Vec::new(),
            Vec::new(),
        )
        .await;
        assert!(matches!(result, Err(CliError::Usage(_))));
        assert!(relay
            .data
            .lock()
            .expect("test relay lock")
            .writes
            .is_empty());
        task.abort();
    }

    #[tokio::test]
    async fn show_propagates_membership_denial() {
        let (client, relay, _, task) = start_test_relay().await;
        relay.data.lock().expect("test relay lock").deny_queries = true;
        let result = cmd_show(&client, "123e4567-e89b-12d3-a456-426614174000").await;
        assert!(matches!(result, Err(CliError::Relay { status: 403, .. })));
        assert!(relay
            .data
            .lock()
            .expect("test relay lock")
            .writes
            .is_empty());
        task.abort();
    }

    #[tokio::test]
    async fn show_rejects_malformed_canvas_instead_of_treating_it_as_business_data() {
        let (client, relay, pubkey, task) = start_test_relay().await;
        add_managed_workspace(
            &relay,
            "123e4567-e89b-12d3-a456-426614174000",
            &pubkey,
            Some(r#"{"schemaVersion":2}"#),
        );
        let result = cmd_show(&client, "123e4567-e89b-12d3-a456-426614174000").await;
        assert!(
            matches!(result, Err(CliError::Other(message)) if message.contains("schema-version-one"))
        );
        assert!(relay
            .data
            .lock()
            .expect("test relay lock")
            .writes
            .is_empty());
        task.abort();
    }

    #[tokio::test]
    async fn show_uses_the_explicit_channel_when_multiple_workspaces_exist() {
        let (client, relay, pubkey, task) = start_test_relay().await;
        let first_id = "123e4567-e89b-12d3-a456-426614174000";
        let selected_id = "223e4567-e89b-12d3-a456-426614174000";
        let first_document = sample_document()
            .to_json()
            .expect("serialize first fixture");
        let mut selected_document = sample_document();
        selected_document.company.summary = "Selected workspace".into();
        let selected_json = selected_document
            .to_json()
            .expect("serialize selected fixture");
        add_managed_workspace(&relay, first_id, &pubkey, Some(&first_document));
        add_managed_workspace(&relay, selected_id, &pubkey, Some(&selected_json));

        let result = cmd_show(&client, selected_id)
            .await
            .expect("selected workspace is shown");
        assert_eq!(result["channel_id"], selected_id);
        assert_eq!(
            result["document"]["company"]["summary"],
            "Selected workspace"
        );
        assert!(result["revision"]
            .as_str()
            .is_some_and(|revision| revision.len() == 64));
        task.abort();
    }

    #[tokio::test]
    async fn update_replaces_the_document_with_the_show_revision_cas() {
        let (client, relay, pubkey, task) = start_test_relay().await;
        let channel_id = "123e4567-e89b-12d3-a456-426614174000";
        let current = sample_document()
            .to_json()
            .expect("serialize current fixture");
        add_managed_workspace(&relay, channel_id, &pubkey, Some(&current));

        let mut proposed = sample_document();
        proposed.company.summary = "Revised company context".into();
        let proposed_json = proposed.to_json().expect("serialize proposed fixture");
        let directory = tempfile::tempdir().expect("create temporary directory");
        let path = directory.path().join("business.json");
        std::fs::write(&path, &proposed_json).expect("write proposed document");

        let result = cmd_update(
            &client,
            channel_id,
            path.to_str().expect("temporary path is UTF-8"),
            Some(&"a".repeat(64)),
        )
        .await
        .expect("document update succeeds");
        assert_eq!(result["channel_id"], channel_id);
        assert_eq!(
            result["document"]["company"]["summary"],
            "Revised company context"
        );

        let data = relay.data.lock().expect("test relay lock");
        let write = data
            .writes
            .iter()
            .find(|event| event["kind"] == 40100)
            .expect("business canvas update");
        assert!(write["tags"].as_array().is_some_and(|tags| {
            tags.iter()
                .any(|tag| tag == &json!(["expected-revision", "a".repeat(64)]))
        }));
        let written: BusinessDocument =
            parse_document(write["content"].as_str().expect("canvas content is string"))
                .expect("written canvas has a valid business document");
        assert_eq!(written.company.summary, "Revised company context");
        drop(data);
        task.abort();
    }

    #[tokio::test]
    async fn source_update_uses_expected_revision_and_reports_concurrent_conflict() {
        let (client, relay, pubkey, task) = start_test_relay().await;
        let document = sample_document().to_json().expect("serialize fixture");
        let channel_id = "123e4567-e89b-12d3-a456-426614174000";
        add_managed_workspace(&relay, channel_id, &pubkey, Some(&document));
        relay
            .data
            .lock()
            .expect("test relay lock")
            .conflict_canvas_writes = true;

        let result = cmd_source_add(
            &client,
            channel_id,
            "Interview".into(),
            BusinessSourceKind::Note,
            "customer feedback",
            None,
            Some(&"a".repeat(64)),
        )
        .await;
        assert!(matches!(result, Err(CliError::Conflict(_))));
        let data = relay.data.lock().expect("test relay lock");
        let write = data
            .writes
            .iter()
            .find(|event| event["kind"] == 40100)
            .expect("canvas update attempt");
        assert!(write["tags"].as_array().is_some_and(|tags| {
            tags.iter()
                .any(|tag| tag == &json!(["expected-revision", "a".repeat(64)]))
        }));
        drop(data);
        task.abort();
    }

    #[tokio::test]
    async fn stale_caller_revision_stops_before_canvas_write() {
        let (client, relay, pubkey, task) = start_test_relay().await;
        let document = sample_document().to_json().expect("serialize fixture");
        let channel_id = "123e4567-e89b-12d3-a456-426614174000";
        add_managed_workspace(&relay, channel_id, &pubkey, Some(&document));

        let result = cmd_source_add(
            &client,
            channel_id,
            "Interview".into(),
            BusinessSourceKind::Note,
            "customer feedback",
            None,
            Some(&"b".repeat(64)),
        )
        .await;
        assert!(matches!(result, Err(CliError::Conflict(_))));
        assert!(relay
            .data
            .lock()
            .expect("test relay lock")
            .writes
            .is_empty());
        task.abort();
    }

    #[tokio::test]
    async fn business_commands_require_explicit_private_channel_membership() {
        let (client, relay, pubkey, task) = start_test_relay().await;
        let channel_id = "123e4567-e89b-12d3-a456-426614174000";
        add_managed_workspace(&relay, channel_id, &pubkey, None);
        relay
            .data
            .lock()
            .expect("test relay lock")
            .memberships
            .clear();
        let result = cmd_show(&client, channel_id).await;
        assert!(matches!(result, Err(CliError::Auth(_))));
        task.abort();
    }
}
