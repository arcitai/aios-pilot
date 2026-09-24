use chrono::{DateTime, SecondsFormat};
use serde_json::{json, Map, Value};

/// Maximum UTF-8 byte length of a serialized app Canvas envelope.
pub const MAX_APP_CANVAS_BYTES: usize = 240_000;
/// Maximum number of slides in one Slides document.
pub const MAX_SLIDES: usize = 20;
/// Maximum number of calendar events in one Calendar document.
pub const MAX_CALENDAR_EVENTS: usize = 100;
/// Maximum UTF-16 code-unit length of a Calendar event description.
pub const MAX_EVENT_DESCRIPTION_LENGTH: usize = 1_000;
/// Maximum UTF-16 code-unit length of a Design document's HTML.
pub const MAX_DESIGN_HTML_LENGTH: usize = 100_000;

/// A built-in AIOS document type whose schema is supported by this crate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppType {
    /// A Slides presentation.
    Slides,
    /// A Calendar document.
    Calendar,
    /// A Design HTML document.
    Design,
}

impl AppType {
    /// Return the stable JSON `kind` value for this app type.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Slides => "slides",
            Self::Calendar => "calendar",
            Self::Design => "design",
        }
    }
}

impl std::fmt::Display for AppType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Validate and normalize one version-1 Slides, Calendar, or Design document.
///
/// Unknown object fields are discarded, matching the desktop TypeScript
/// parsers. Field lengths use UTF-16 code units; callers enforce the serialized
/// envelope byte limit with [`MAX_APP_CANVAS_BYTES`].
pub fn normalize_app_document(app_type: AppType, value: &Value) -> Result<Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{} document must be a JSON object", app_type.as_str()))?;
    if object.get("kind").and_then(Value::as_str) != Some(app_type.as_str())
        || number_is_one(object.get("schemaVersion")) != Some(true)
    {
        return Err(invalid_document(app_type));
    }

    let id = required_string(object, "id").filter(|value| valid_id(value));
    let updated_at =
        required_string(object, "updatedAt").filter(|value| valid_iso_timestamp(value));
    let Some((id, updated_at)) = id.zip(updated_at) else {
        return Err(invalid_document(app_type));
    };

    let mut result = Map::new();
    result.insert("kind".into(), json!(app_type.as_str()));
    result.insert("schemaVersion".into(), json!(1));
    result.insert("id".into(), json!(id));
    result.insert("updatedAt".into(), json!(updated_at));

    match app_type {
        AppType::Slides => {
            let title = required_string(object, "title")
                .filter(|value| utf16_len(value) <= 200)
                .ok_or_else(|| invalid_document(app_type))?;
            let slides = object
                .get("slides")
                .and_then(Value::as_array)
                .filter(|items| (1..=MAX_SLIDES).contains(&items.len()))
                .ok_or_else(|| invalid_document(app_type))?;
            let mut normalized_slides = Vec::with_capacity(slides.len());
            for slide in slides {
                let slide = slide
                    .as_object()
                    .ok_or_else(|| invalid_document(app_type))?;
                let slide_id = required_string(slide, "id")
                    .filter(|value| valid_id(value))
                    .ok_or_else(|| invalid_document(app_type))?;
                let slide_title = required_string(slide, "title")
                    .filter(|value| utf16_len(value) <= 500)
                    .ok_or_else(|| invalid_document(app_type))?;
                let body = required_string(slide, "body")
                    .filter(|value| utf16_len(value) <= 8_000)
                    .ok_or_else(|| invalid_document(app_type))?;
                normalized_slides.push(json!({
                    "id": slide_id,
                    "title": slide_title,
                    "body": body,
                }));
            }
            result.insert("title".into(), json!(title));
            result.insert("slides".into(), json!(normalized_slides));
        }
        AppType::Calendar => {
            if object.get("googleCalendarStatus").and_then(Value::as_str) != Some("not_connected") {
                return Err(invalid_document(app_type));
            }
            let events = object
                .get("events")
                .and_then(Value::as_array)
                .filter(|items| items.len() <= MAX_CALENDAR_EVENTS)
                .ok_or_else(|| invalid_document(app_type))?;
            let mut normalized_events = Vec::with_capacity(events.len());
            for event in events {
                let event = event
                    .as_object()
                    .ok_or_else(|| invalid_document(app_type))?;
                let event_id = required_string(event, "id")
                    .filter(|value| valid_id(value))
                    .ok_or_else(|| invalid_document(app_type))?;
                let title = required_string(event, "title")
                    .filter(|value| !value.trim().is_empty() && utf16_len(value) <= 200)
                    .ok_or_else(|| invalid_document(app_type))?;
                let description = required_string(event, "description")
                    .filter(|value| utf16_len(value) <= MAX_EVENT_DESCRIPTION_LENGTH)
                    .ok_or_else(|| invalid_document(app_type))?;
                let starts_at = required_string(event, "startsAt")
                    .filter(|value| valid_iso_timestamp(value))
                    .ok_or_else(|| invalid_document(app_type))?;
                let ends_at = required_string(event, "endsAt")
                    .filter(|value| valid_iso_timestamp(value))
                    .ok_or_else(|| invalid_document(app_type))?;
                let starts =
                    parse_iso_timestamp(starts_at).ok_or_else(|| invalid_document(app_type))?;
                let ends =
                    parse_iso_timestamp(ends_at).ok_or_else(|| invalid_document(app_type))?;
                if ends <= starts {
                    return Err(invalid_document(app_type));
                }
                normalized_events.push(json!({
                    "id": event_id,
                    "title": title,
                    "description": description,
                    "startsAt": starts_at,
                    "endsAt": ends_at,
                }));
            }
            result.insert("events".into(), json!(normalized_events));
            result.insert("googleCalendarStatus".into(), json!("not_connected"));
        }
        AppType::Design => {
            let title = required_string(object, "title")
                .filter(|value| utf16_len(value) <= 200)
                .ok_or_else(|| invalid_document(app_type))?;
            let html = required_string(object, "html")
                .filter(|value| utf16_len(value) <= MAX_DESIGN_HTML_LENGTH)
                .ok_or_else(|| invalid_document(app_type))?;
            result.insert("title".into(), json!(title));
            result.insert("html".into(), json!(html));
        }
    }

    Ok(Value::Object(result))
}

fn invalid_document(app_type: AppType) -> String {
    format!("the {app_type} document does not match schema version 1")
}

fn required_string<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str)
}

fn number_is_one(value: Option<&Value>) -> Option<bool> {
    value.and_then(Value::as_f64).map(|number| number == 1.0)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty() && utf16_len(value) <= 160
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn parse_iso_timestamp(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.timestamp_millis())
}

fn valid_iso_timestamp(value: &str) -> bool {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .is_some_and(|date| date.to_utc().to_rfc3339_opts(SecondsFormat::Millis, true) == value)
}

#[cfg(test)]
#[path = "app_document_tests.rs"]
mod tests;
