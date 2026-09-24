use serde::{Deserialize, Serialize};

/// Maximum UTF-8 byte length of serialized Sites v1 JSON.
pub const MAX_SITE_DOCUMENT_BYTES: usize = 200_000;
/// Maximum UTF-16 code-unit length of a Sites title.
pub const MAX_SITE_TITLE_CODE_UNITS: usize = 120;
/// Maximum UTF-16 code-unit length of Sites `index.html`.
pub const MAX_SITE_HTML_CODE_UNITS: usize = 120_000;
/// Maximum UTF-16 code-unit length of Sites `style.css`.
pub const MAX_SITE_CSS_CODE_UNITS: usize = 80_000;
/// Maximum UTF-16 code-unit length of Sites `app.js`.
pub const MAX_SITE_JS_CODE_UNITS: usize = 80_000;

/// A validated Sites v1 document stored in the existing private Sites channel.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteDocument {
    /// Supported document schema version.
    pub schema_version: u8,
    /// Stable document kind, `aios.site`.
    pub kind: String,
    /// Existing site-channel identifier.
    pub site_id: String,
    /// Existing parent Business channel identifier.
    pub parent_business_channel_id: String,
    /// Nonblank user-facing title.
    pub title: String,
    /// HTML, CSS, and JavaScript source files.
    pub files: SiteFiles,
}

/// The source files contained by a Sites v1 document.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteFiles {
    /// Site markup.
    pub index_html: String,
    /// Site styles.
    pub style_css: String,
    /// Site behavior.
    pub app_js: String,
}

/// Parse and validate one UTF-8 Sites v1 JSON document.
pub fn parse_site_document(content: &str) -> Result<SiteDocument, String> {
    if content.len() > MAX_SITE_DOCUMENT_BYTES {
        return Err(format!(
            "Sites documents are limited to {MAX_SITE_DOCUMENT_BYTES} UTF-8 bytes"
        ));
    }
    let document: SiteDocument = serde_json::from_str(content)
        .map_err(|error| format!("invalid strict Sites v1 JSON: {error}"))?;
    validate_site_document(&document)?;
    Ok(document)
}

/// Validate the schema, identifiers, and UTF-16 field limits.
pub fn validate_site_document(document: &SiteDocument) -> Result<(), String> {
    if document.schema_version != 1 || document.kind != "aios.site" {
        return Err("document must use schemaVersion 1 and kind aios.site".to_string());
    }
    if !valid_channel_id(&document.site_id)
        || !valid_channel_id(&document.parent_business_channel_id)
    {
        return Err("site and parent business channel ids are malformed".to_string());
    }
    if document.title.trim().is_empty()
        || document.title.encode_utf16().count() > MAX_SITE_TITLE_CODE_UNITS
        || document.files.index_html.encode_utf16().count() > MAX_SITE_HTML_CODE_UNITS
        || document.files.style_css.encode_utf16().count() > MAX_SITE_CSS_CODE_UNITS
        || document.files.app_js.encode_utf16().count() > MAX_SITE_JS_CODE_UNITS
    {
        return Err("document text exceeds its UTF-16 field limits".to_string());
    }
    Ok(())
}

fn valid_channel_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

#[cfg(test)]
#[path = "site_document_tests.rs"]
mod tests;
