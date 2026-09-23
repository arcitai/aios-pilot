//! Shared types and validation for the AIOS business workspace document.
//!
//! This crate is deliberately independent of Buzz canvases and user interfaces.
//! It accepts only the version-one JSON contract shared by the desktop and CLI.

use std::collections::HashSet;

use chrono::{DateTime, NaiveDate};
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;
use url::Url;

/// The exact `kind` value for a business workspace document.
pub const BUSINESS_DOCUMENT_KIND: &str = "aios.business-workspace";

/// The only document schema version currently supported.
pub const BUSINESS_DOCUMENT_SCHEMA_VERSION: u32 = 1;

/// Largest accepted UTF-8 JSON document, measured in bytes.
pub const MAX_DOCUMENT_BYTES: usize = 200_000;

const MAX_COMPANY_NAME_UNITS: usize = 300;
const MAX_WEBSITE_UNITS: usize = 2_000;
const MAX_COMPANY_TEXT_UNITS: usize = 12_000;
const MAX_SOURCES: usize = 100;
const MAX_SOURCE_ID_UNITS: usize = 128;
const MAX_SOURCE_TITLE_UNITS: usize = 300;
const MAX_SOURCE_CONTENT_UNITS: usize = 40_000;
const MAX_SOURCE_URL_UNITS: usize = 2_000;
const MAX_CONNECTIONS: usize = 50;
const MAX_CONNECTION_ID_UNITS: usize = 128;
const MAX_CONNECTION_PROVIDER_UNITS: usize = 100;
const MAX_CONNECTION_LABEL_UNITS: usize = 300;
const MAX_CONNECTION_DETAILS_UNITS: usize = 2_000;

/// A versioned business context document stored in the dedicated workspace canvas.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BusinessDocument {
    /// The document contract version. Only version `1` is currently accepted.
    #[serde(deserialize_with = "deserialize_schema_version")]
    pub schema_version: u32,
    /// The stable discriminator `aios.business-workspace`.
    pub kind: String,
    /// Company context shared with the desktop and agent surfaces.
    pub company: Company,
    /// Source-backed context records.
    pub sources: Vec<BusinessSource>,
    /// Provider descriptors and their reported state; these contain no credentials.
    pub connections: Vec<BusinessConnection>,
}

/// The company fields defined by schema version one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Company {
    /// Company name, which may initially be empty.
    pub name: String,
    /// Company website, or an empty string when it is unknown.
    pub website: String,
    /// Short company summary.
    pub summary: String,
    /// Intended audience.
    pub audience: String,
    /// Current offers, represented as freeform text.
    pub offers: String,
    /// Current goals, represented as freeform text.
    pub goals: String,
}

/// A provenance record attached to a business context claim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BusinessSource {
    /// Stable source identifier, unique within the sources collection.
    pub id: String,
    /// Human-readable source title.
    pub title: String,
    /// The source medium.
    pub kind: SourceKind,
    /// Source text or extracted content.
    pub content: String,
    /// Optional absolute HTTP or HTTPS URL.
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub url: Option<String>,
    /// ISO-8601 creation timestamp.
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

/// The source media values in schema version one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    /// A manually supplied note.
    Note,
    /// A web page.
    Url,
    /// A file.
    File,
}

/// A provider descriptor and non-secret connection status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BusinessConnection {
    /// Stable connection identifier, unique within the connections collection.
    pub id: String,
    /// Provider identifier, such as `google_drive`.
    pub provider: String,
    /// Human-readable connection label.
    pub label: String,
    /// Reported state. A descriptor alone does not authenticate a provider.
    pub status: ConnectionStatus,
    /// Optional non-secret explanatory text.
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub details: Option<String>,
}

/// The connection status values in schema version one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    /// No provider authentication has been configured.
    NotConfigured,
    /// A provider operation has successfully authenticated this connection.
    Connected,
    /// The most recent provider operation failed.
    Error,
}

/// A parse or validation failure for the shared business document.
#[derive(Debug, Error)]
pub enum BusinessDocumentError {
    /// The input or canonical serialized value exceeded the byte bound.
    #[error("business document exceeds the {MAX_DOCUMENT_BYTES}-byte limit")]
    TooLarge,
    /// The JSON document could not be decoded into the strict schema.
    #[error("invalid business document JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// The document uses a version newer or older than this implementation.
    #[error("unsupported business document schemaVersion {0}; expected {BUSINESS_DOCUMENT_SCHEMA_VERSION}")]
    UnsupportedVersion(u32),
    /// A field has an invalid value or exceeds its schema bound.
    #[error("invalid business document: {0}")]
    Invalid(String),
}

impl BusinessDocument {
    /// Create an empty schema-version-one document; the company name may be empty.
    pub fn new(company_name: impl Into<String>) -> Self {
        Self {
            schema_version: BUSINESS_DOCUMENT_SCHEMA_VERSION,
            kind: BUSINESS_DOCUMENT_KIND.to_string(),
            company: Company {
                name: company_name.into(),
                website: String::new(),
                summary: String::new(),
                audience: String::new(),
                offers: String::new(),
                goals: String::new(),
            },
            sources: Vec::new(),
            connections: Vec::new(),
        }
    }

    /// Validate this value against the exact version-one schema and all size bounds.
    pub fn validate(&self) -> Result<(), BusinessDocumentError> {
        if self.schema_version != BUSINESS_DOCUMENT_SCHEMA_VERSION {
            return Err(BusinessDocumentError::UnsupportedVersion(
                self.schema_version,
            ));
        }
        if self.kind != BUSINESS_DOCUMENT_KIND {
            return Err(BusinessDocumentError::Invalid(format!(
                "kind must be `{BUSINESS_DOCUMENT_KIND}`"
            )));
        }

        validate_text(
            "company.name",
            &self.company.name,
            MAX_COMPANY_NAME_UNITS,
            false,
        )?;
        validate_text(
            "company.website",
            &self.company.website,
            MAX_WEBSITE_UNITS,
            false,
        )?;
        validate_text(
            "company.summary",
            &self.company.summary,
            MAX_COMPANY_TEXT_UNITS,
            false,
        )?;
        validate_text(
            "company.audience",
            &self.company.audience,
            MAX_COMPANY_TEXT_UNITS,
            false,
        )?;
        validate_text(
            "company.offers",
            &self.company.offers,
            MAX_COMPANY_TEXT_UNITS,
            false,
        )?;
        validate_text(
            "company.goals",
            &self.company.goals,
            MAX_COMPANY_TEXT_UNITS,
            false,
        )?;

        if self.sources.len() > MAX_SOURCES {
            return Err(BusinessDocumentError::Invalid(format!(
                "sources may contain at most {MAX_SOURCES} entries"
            )));
        }
        if self.connections.len() > MAX_CONNECTIONS {
            return Err(BusinessDocumentError::Invalid(format!(
                "connections may contain at most {MAX_CONNECTIONS} entries"
            )));
        }

        let mut source_ids = HashSet::with_capacity(self.sources.len());
        for (index, source) in self.sources.iter().enumerate() {
            validate_text(
                &format!("sources[{index}].id"),
                &source.id,
                MAX_SOURCE_ID_UNITS,
                true,
            )?;
            if !source_ids.insert(source.id.as_str()) {
                return Err(BusinessDocumentError::Invalid(format!(
                    "duplicate id `{}`",
                    source.id
                )));
            }
            validate_text(
                &format!("sources[{index}].title"),
                &source.title,
                MAX_SOURCE_TITLE_UNITS,
                true,
            )?;
            validate_text(
                &format!("sources[{index}].content"),
                &source.content,
                MAX_SOURCE_CONTENT_UNITS,
                false,
            )?;
            validate_timestamp(index, &source.created_at)?;
            if let Some(source_url) = source.url.as_deref() {
                validate_http_url(index, source_url)?;
            }
        }

        let mut connection_ids = HashSet::with_capacity(self.connections.len());
        for (index, connection) in self.connections.iter().enumerate() {
            validate_text(
                &format!("connections[{index}].id"),
                &connection.id,
                MAX_CONNECTION_ID_UNITS,
                true,
            )?;
            if !connection_ids.insert(connection.id.as_str()) {
                return Err(BusinessDocumentError::Invalid(format!(
                    "duplicate id `{}`",
                    connection.id
                )));
            }
            validate_text(
                &format!("connections[{index}].provider"),
                &connection.provider,
                MAX_CONNECTION_PROVIDER_UNITS,
                true,
            )?;
            validate_text(
                &format!("connections[{index}].label"),
                &connection.label,
                MAX_CONNECTION_LABEL_UNITS,
                true,
            )?;
            if let Some(details) = connection.details.as_deref() {
                validate_text(
                    &format!("connections[{index}].details"),
                    details,
                    MAX_CONNECTION_DETAILS_UNITS,
                    false,
                )?;
            }
        }

        let encoded = serde_json::to_vec(self)?;
        if encoded.len() > MAX_DOCUMENT_BYTES {
            return Err(BusinessDocumentError::TooLarge);
        }
        Ok(())
    }

    /// Validate and serialize as compact UTF-8 JSON for canvas storage or export.
    pub fn to_json(&self) -> Result<String, BusinessDocumentError> {
        self.validate()?;
        let json = serde_json::to_string(self)?;
        if json.len() > MAX_DOCUMENT_BYTES {
            return Err(BusinessDocumentError::TooLarge);
        }
        Ok(json)
    }
}

/// Parse and validate one complete UTF-8 JSON business document.
pub fn parse_document(input: &str) -> Result<BusinessDocument, BusinessDocumentError> {
    if input.len() > MAX_DOCUMENT_BYTES {
        return Err(BusinessDocumentError::TooLarge);
    }
    let document: BusinessDocument = serde_json::from_str(input)?;
    document.validate()?;
    Ok(document)
}

fn validate_text(
    field: &str,
    value: &str,
    max_utf16_units: usize,
    required: bool,
) -> Result<(), BusinessDocumentError> {
    if required && value.is_empty() {
        return Err(BusinessDocumentError::Invalid(format!(
            "{field} must not be empty"
        )));
    }
    let utf16_units = value.encode_utf16().count();
    if utf16_units > max_utf16_units {
        return Err(BusinessDocumentError::Invalid(format!(
            "{field} exceeds the {max_utf16_units}-UTF-16-code-unit limit"
        )));
    }
    if value
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(BusinessDocumentError::Invalid(format!(
            "{field} contains a disallowed control character"
        )));
    }
    Ok(())
}

fn validate_timestamp(index: usize, value: &str) -> Result<(), BusinessDocumentError> {
    let invalid = || {
        BusinessDocumentError::Invalid(format!(
            "sources[{index}].createdAt must be an ISO-8601 timestamp"
        ))
    };
    let Some((date, time_and_zone)) = value.split_once('T') else {
        return Err(invalid());
    };
    if time_and_zone.contains('T')
        || !time_and_zone.is_ascii()
        || date.len() != 10
        || date.as_bytes().get(4) != Some(&b'-')
        || date.as_bytes().get(7) != Some(&b'-')
        || !date
            .bytes()
            .enumerate()
            .all(|(position, byte)| matches!(position, 4 | 7) || byte.is_ascii_digit())
        || NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err()
    {
        return Err(invalid());
    }

    let (time, zone) = if let Some(time) = time_and_zone.strip_suffix('Z') {
        (time, "Z")
    } else {
        let Some(zone_start) = time_and_zone.len().checked_sub(6) else {
            return Err(invalid());
        };
        let zone = &time_and_zone[zone_start..];
        if !valid_timestamp_offset(zone) {
            return Err(invalid());
        }
        (&time_and_zone[..zone_start], zone)
    };
    let minute_precision = valid_timestamp_time(time).ok_or_else(invalid)?;
    let normalized = if minute_precision {
        format!("{date}T{time}:00{zone}")
    } else {
        value.to_string()
    };
    DateTime::parse_from_rfc3339(&normalized)
        .map(|_| ())
        .map_err(|_| invalid())
}

fn validate_http_url(index: usize, value: &str) -> Result<(), BusinessDocumentError> {
    let utf16_units = value.encode_utf16().count();
    if utf16_units > MAX_SOURCE_URL_UNITS {
        return Err(BusinessDocumentError::Invalid(format!(
            "sources[{index}].url exceeds the {MAX_SOURCE_URL_UNITS}-UTF-16-code-unit limit"
        )));
    }
    if !(value.starts_with("http://") || value.starts_with("https://")) {
        return Err(BusinessDocumentError::Invalid(format!(
            "sources[{index}].url must be an absolute HTTP or HTTPS URL"
        )));
    }
    let parsed = Url::parse(value).map_err(|_| {
        BusinessDocumentError::Invalid(format!(
            "sources[{index}].url must be an absolute HTTP or HTTPS URL"
        ))
    })?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(BusinessDocumentError::Invalid(format!(
            "sources[{index}].url must be an absolute HTTP or HTTPS URL"
        )));
    }
    Ok(())
}

fn valid_timestamp_offset(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 6 || !matches!(bytes[0], b'+' | b'-') || bytes[3] != b':' {
        return false;
    }
    let Some(hours) = parse_ascii_two_digits(&bytes[1..3]) else {
        return false;
    };
    let Some(minutes) = parse_ascii_two_digits(&bytes[4..6]) else {
        return false;
    };
    hours <= 23 && minutes <= 59
}

/// Return whether a Zod-compatible ISO time has minute precision.
fn valid_timestamp_time(value: &str) -> Option<bool> {
    let bytes = value.as_bytes();
    if !value.is_ascii() || bytes.len() < 5 || bytes[2] != b':' {
        return None;
    }
    let hours = parse_ascii_two_digits(&bytes[0..2])?;
    let minutes = parse_ascii_two_digits(&bytes[3..5])?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    if bytes.len() == 5 {
        return Some(true);
    }
    if bytes.len() < 8 || bytes[5] != b':' || parse_ascii_two_digits(&bytes[6..8])? > 59 {
        return None;
    }
    if bytes.len() == 8 {
        return Some(false);
    }
    if bytes[8] != b'.' || bytes.len() == 9 || !bytes[9..].iter().all(u8::is_ascii_digit) {
        return None;
    }
    Some(false)
}

fn parse_ascii_two_digits(bytes: &[u8]) -> Option<u8> {
    let [first, second] = bytes else {
        return None;
    };
    if !first.is_ascii_digit() || !second.is_ascii_digit() {
        return None;
    }
    Some((first - b'0') * 10 + (second - b'0'))
}

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

fn deserialize_schema_version<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: Deserializer<'de>,
{
    let number = serde_json::Number::deserialize(deserializer)?;
    let version = number
        .as_u64()
        .or_else(|| {
            number.as_f64().and_then(|value| {
                (value.is_finite() && value >= 0.0 && value.fract() == 0.0).then_some(value as u64)
            })
        })
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| {
            <D::Error as serde::de::Error>::custom(
                "schemaVersion must be a non-negative 32-bit integer",
            )
        })?;
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> BusinessDocument {
        BusinessDocument {
            schema_version: 1,
            kind: BUSINESS_DOCUMENT_KIND.to_string(),
            company: Company {
                name: "Example Co".to_string(),
                website: "https://example.test".to_string(),
                summary: "A small example".to_string(),
                audience: "Independent shops".to_string(),
                offers: "Consulting".to_string(),
                goals: "Reach 20 customers".to_string(),
            },
            sources: vec![BusinessSource {
                id: "source-1".to_string(),
                title: "Interview notes".to_string(),
                kind: SourceKind::Note,
                content: "Customer interviews".to_string(),
                url: None,
                created_at: "2026-09-23T12:00:00Z".to_string(),
            }],
            connections: vec![BusinessConnection {
                id: "connection-1".to_string(),
                provider: "google_drive".to_string(),
                label: "Research folder".to_string(),
                status: ConnectionStatus::Connected,
                details: Some("Read-only source".to_string()),
            }],
        }
    }

    #[test]
    fn desktop_shaped_document_round_trips_including_reported_status() {
        let document = sample();
        let json = document.to_json().expect("valid document serializes");
        let parsed = parse_document(&json).expect("serialized document parses");
        assert_eq!(parsed, document);
        assert!(json.contains("\"schemaVersion\":1"));
        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"status\":\"connected\""));
    }

    #[test]
    fn rejects_unknown_schema_versions_and_unknown_fields_at_every_level() {
        let mut value = serde_json::to_value(sample()).expect("sample serializes");
        value["schemaVersion"] = serde_json::json!(2);
        assert!(matches!(
            parse_document(&value.to_string()),
            Err(BusinessDocumentError::UnsupportedVersion(2))
        ));

        let mut value = serde_json::to_value(sample()).expect("sample serializes");
        value["company"]["accessToken"] = serde_json::json!("secret");
        assert!(parse_document(&value.to_string()).is_err());

        let mut value = serde_json::to_value(sample()).expect("sample serializes");
        value["sources"][0]["unexpected"] = serde_json::json!(true);
        assert!(parse_document(&value.to_string()).is_err());
    }

    #[test]
    fn validates_kind_status_url_timestamp_and_collection_scoped_ids() {
        let mut value = serde_json::to_value(sample()).expect("sample serializes");
        value["kind"] = serde_json::json!("another.kind");
        assert!(parse_document(&value.to_string()).is_err());

        let mut value = serde_json::to_value(sample()).expect("sample serializes");
        value["connections"][0]["status"] = serde_json::json!("authenticated");
        assert!(parse_document(&value.to_string()).is_err());

        let mut value = serde_json::to_value(sample()).expect("sample serializes");
        value["sources"][0]["url"] = serde_json::json!("file:///etc/passwd");
        assert!(parse_document(&value.to_string()).is_err());

        let mut value = serde_json::to_value(sample()).expect("sample serializes");
        value["sources"][0]["createdAt"] = serde_json::json!("yesterday");
        assert!(parse_document(&value.to_string()).is_err());

        let mut value = serde_json::to_value(sample()).expect("sample serializes");
        value["connections"][0]["id"] = serde_json::json!("source-1");
        assert!(parse_document(&value.to_string()).is_ok());

        let mut value = serde_json::to_value(sample()).expect("sample serializes");
        let duplicate_source = value["sources"][0].clone();
        value["sources"]
            .as_array_mut()
            .unwrap()
            .push(duplicate_source);
        assert!(parse_document(&value.to_string()).is_err());

        let mut value = serde_json::to_value(sample()).expect("sample serializes");
        let duplicate_connection = value["connections"][0].clone();
        value["connections"]
            .as_array_mut()
            .unwrap()
            .push(duplicate_connection);
        assert!(parse_document(&value.to_string()).is_err());
    }

    #[test]
    fn enforces_field_collection_and_document_bounds() {
        let mut document = sample();
        document.company.name = "x".repeat(MAX_COMPANY_NAME_UNITS + 1);
        assert!(document.validate().is_err());

        let mut document = sample();
        document.sources[0].content = "x".repeat(MAX_SOURCE_CONTENT_UNITS + 1);
        assert!(document.validate().is_err());

        let oversized = " ".repeat(MAX_DOCUMENT_BYTES + 1);
        assert!(matches!(
            parse_document(&oversized),
            Err(BusinessDocumentError::TooLarge)
        ));

        let mut document = sample();
        document.company.name = String::new();
        assert!(document.validate().is_ok());

        let mut document = sample();
        document.sources[0].id = " ".into();
        document.sources[0].title = " ".into();
        document.connections[0].id = " ".into();
        document.connections[0].provider = " ".into();
        document.connections[0].label = " ".into();
        assert!(document.validate().is_ok());
    }

    #[test]
    fn shared_frontend_fixtures_match_utf16_and_document_byte_contract() {
        let valid_non_ascii = include_str!("../tests/fixtures/valid-non-ascii-offset.json");
        let parsed = parse_document(valid_non_ascii).expect("151 accented characters are valid");
        assert_eq!(parsed.company.name.encode_utf16().count(), 151);
        assert_eq!(
            parsed.sources[0]
                .url
                .as_ref()
                .unwrap()
                .encode_utf16()
                .count(),
            MAX_SOURCE_URL_UNITS
        );
        assert!(parsed.sources[0].created_at.ends_with("+02:00"));

        let valid_emoji_boundary =
            include_str!("../tests/fixtures/valid-emoji-utf16-boundary.json");
        let parsed = parse_document(valid_emoji_boundary)
            .expect("the emoji name reaches exactly 300 UTF-16 code units");
        assert_eq!(
            parsed.company.name.encode_utf16().count(),
            MAX_COMPANY_NAME_UNITS
        );

        for invalid_fixture in [
            include_str!("../tests/fixtures/invalid-company-name-utf16-limit.json"),
            include_str!("../tests/fixtures/invalid-url-utf16-limit.json"),
            include_str!("../tests/fixtures/invalid-unknown-field.json"),
            include_str!("../tests/fixtures/invalid-timestamp.json"),
            include_str!("../tests/fixtures/invalid-null-url.json"),
            include_str!("../tests/fixtures/invalid-null-details.json"),
            include_str!("../tests/fixtures/invalid-duplicate-source-id.json"),
            include_str!("../tests/fixtures/invalid-duplicate-connection-id.json"),
            include_str!("../tests/fixtures/invalid-document-byte-limit.json"),
            include_str!("../tests/fixtures/invalid-uppercase-url-scheme.json"),
            include_str!("../tests/fixtures/invalid-leap-second-timestamp.json"),
            include_str!("../tests/fixtures/invalid-lowercase-iso-separator.json"),
            include_str!("../tests/fixtures/invalid-lowercase-iso-zone.json"),
            include_str!("../tests/fixtures/invalid-space-iso-separator.json"),
            include_str!("../tests/fixtures/invalid-compact-offset.json"),
        ] {
            assert!(
                parse_document(invalid_fixture).is_err(),
                "fixture should be rejected: {}",
                invalid_fixture.chars().take(100).collect::<String>()
            );
        }

        for valid_fixture in [
            include_str!("../tests/fixtures/valid-empty-company-name.json"),
            include_str!("../tests/fixtures/valid-cross-collection-duplicate-ids.json"),
            include_str!("../tests/fixtures/valid-whitespace-min-length.json"),
            include_str!("../tests/fixtures/valid-minute-precision-timestamp.json"),
            include_str!("../tests/fixtures/valid-long-fraction-timestamp.json"),
            include_str!("../tests/fixtures/valid-schema-version-decimal-one.json"),
        ] {
            parse_document(valid_fixture).expect("desktop-compatible fixture parses");
        }
    }
}
