use std::{fs::File, io::Read, path::Path};

use serde::{Deserialize, Serialize};

use crate::error::CliError;

pub(super) const MAX_SITE_DOCUMENT_BYTES: usize = 200_000;
pub(super) const MAX_SITE_TITLE_CODE_UNITS: usize = 120;
pub(super) const MAX_SITE_HTML_CODE_UNITS: usize = 120_000;
pub(super) const MAX_SITE_CSS_CODE_UNITS: usize = 80_000;
pub(super) const MAX_SITE_JS_CODE_UNITS: usize = 80_000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SiteDocument {
    pub schema_version: u8,
    pub kind: String,
    pub site_id: String,
    pub parent_business_channel_id: String,
    pub title: String,
    pub files: SiteFiles,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SiteFiles {
    pub index_html: String,
    pub style_css: String,
    pub app_js: String,
}

pub(super) fn parse_document(content: &str) -> Result<SiteDocument, CliError> {
    decode_document(content).map_err(CliError::Usage)
}

pub(super) fn parse_saved_document(content: &str) -> Result<SiteDocument, CliError> {
    decode_document(content).map_err(|message| {
        CliError::Other(format!(
            "saved site canvas is not a supported Sites v1 document: {message}"
        ))
    })
}

fn decode_document(content: &str) -> Result<SiteDocument, String> {
    if content.len() > MAX_SITE_DOCUMENT_BYTES {
        return Err(format!(
            "Sites documents are limited to {MAX_SITE_DOCUMENT_BYTES} UTF-8 bytes"
        ));
    }
    let document: SiteDocument = serde_json::from_str(content)
        .map_err(|error| format!("invalid strict Sites v1 JSON: {error}"))?;
    validate_document(&document)?;
    Ok(document)
}

pub(super) fn validate_document(document: &SiteDocument) -> Result<(), String> {
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

pub(super) fn serialize_document(document: &SiteDocument) -> Result<String, CliError> {
    validate_document(document).map_err(CliError::Usage)?;
    let mut bytes = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(b"  ");
    let mut serializer = serde_json::Serializer::with_formatter(&mut bytes, formatter);
    document
        .serialize(&mut serializer)
        .map_err(|error| CliError::Other(format!("could not serialize site document: {error}")))?;
    if bytes.len() > MAX_SITE_DOCUMENT_BYTES {
        return Err(CliError::Usage(format!(
            "serialized Sites document exceeds {MAX_SITE_DOCUMENT_BYTES} UTF-8 bytes"
        )));
    }
    String::from_utf8(bytes)
        .map_err(|error| CliError::Other(format!("serialized site JSON is not UTF-8: {error}")))
}

pub(super) fn read_document(path: &Path) -> Result<SiteDocument, CliError> {
    let max_read = (MAX_SITE_DOCUMENT_BYTES + 1) as u64;
    let mut bytes = Vec::new();
    if path == Path::new("-") {
        std::io::stdin()
            .lock()
            .take(max_read)
            .read_to_end(&mut bytes)
            .map_err(|error| CliError::Other(format!("could not read site document: {error}")))?;
    } else {
        File::open(path)
            .map_err(|error| {
                CliError::Usage(format!(
                    "could not open site document {}: {error}",
                    path.display()
                ))
            })?
            .take(max_read)
            .read_to_end(&mut bytes)
            .map_err(|error| CliError::Other(format!("could not read site document: {error}")))?;
    }
    if bytes.len() > MAX_SITE_DOCUMENT_BYTES {
        return Err(CliError::Usage(format!(
            "site document exceeds {MAX_SITE_DOCUMENT_BYTES} UTF-8 bytes"
        )));
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| CliError::Usage("site document must be UTF-8 JSON".to_string()))?;
    parse_document(&content)
}

pub(super) fn build_standalone_html(document: &SiteDocument) -> String {
    let style = escape_raw_text_end_tag(&document.files.style_css, "</style");
    let script = escape_raw_text_end_tag(&document.files.app_js, "</script");
    let csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; worker-src 'none'";
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <meta http-equiv=\"Content-Security-Policy\" content=\"{csp}\">\n  <title>{}</title>\n  <style>{style}</style>\n</head>\n<body>\n{}\n<script>{script}</script>\n</body>\n</html>\n",
        escape_html(&document.title),
        document.files.index_html,
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn escape_raw_text_end_tag(value: &str, needle: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;
    let mut copy_from = 0;
    while cursor + needle.len() <= value.len() {
        let remaining = &value[cursor..];
        if remaining
            .get(..needle.len())
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(needle))
        {
            output.push_str(&value[copy_from..cursor]);
            output.push_str("<\\/");
            output.push_str(&value[cursor + 2..cursor + needle.len()]);
            cursor += needle.len();
            copy_from = cursor;
        } else if let Some(character) = remaining.chars().next() {
            cursor += character.len_utf8();
        } else {
            break;
        }
    }
    output.push_str(&value[copy_from..]);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_shared_sites_document_fixture() {
        let fixture: SiteDocument = serde_json::from_str(include_str!(
            "../../../../../fixtures/aios-sites/site-v1.json"
        ))
        .expect("valid shared Sites v1 fixture");
        assert_eq!(fixture.schema_version, 1);
        assert_eq!(fixture.kind, "aios.site");
        assert_eq!(fixture.title, "Sommer i København");
        assert!(validate_document(&fixture).is_ok());
    }

    #[test]
    fn cli_schema_matches_the_shared_utf16_length_contract() {
        let contract: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../fixtures/aios-sites/site-v1-length-contract.json"
        ))
        .expect("valid shared Sites length fixture");
        assert_eq!(contract["limits"]["title"], MAX_SITE_TITLE_CODE_UNITS);
        assert_eq!(contract["limits"]["indexHtml"], MAX_SITE_HTML_CODE_UNITS);
        assert_eq!(contract["limits"]["styleCss"], MAX_SITE_CSS_CODE_UNITS);
        assert_eq!(contract["limits"]["appJs"], MAX_SITE_JS_CODE_UNITS);
        assert_eq!(contract["limits"]["document"], MAX_SITE_DOCUMENT_BYTES);

        let sample = contract["unicode"]["sample"]
            .as_str()
            .expect("unicode sample");
        let mut document = SiteDocument {
            schema_version: 1,
            kind: "aios.site".into(),
            site_id: "site_demo_1234".into(),
            parent_business_channel_id: "business_demo".into(),
            title: sample.repeat(100),
            files: SiteFiles {
                index_html: String::new(),
                style_css: String::new(),
                app_js: String::new(),
            },
        };
        assert_eq!(document.title.encode_utf16().count(), 100);
        assert!(document.title.len() > document.title.encode_utf16().count());
        assert!(validate_document(&document).is_ok());

        document.files.index_html = sample.repeat(60_001);
        assert!(document.files.index_html.len() > MAX_SITE_HTML_CODE_UNITS);
        assert!(validate_document(&document).is_ok());
        assert!(serialize_document(&document).is_ok());
        document.title = sample.repeat(MAX_SITE_TITLE_CODE_UNITS + 1);
        assert!(validate_document(&document).is_err());
    }

    #[test]
    fn exported_html_escapes_titles_and_raw_text_end_tags() {
        let document = SiteDocument {
            schema_version: 1,
            kind: "aios.site".into(),
            site_id: "site_demo_1234".into(),
            parent_business_channel_id: "business_demo".into(),
            title: "A < B & C".into(),
            files: SiteFiles {
                index_html: "<h1>hello</h1>".into(),
                style_css: "p::after { content: '</STYLE>'; }".into(),
                app_js: "const html = '</ScRiPt>';".into(),
            },
        };
        let html = build_standalone_html(&document);
        assert!(html.contains("<title>A &lt; B &amp; C</title>"));
        assert!(html.contains("<\\/STYLE>"));
        assert!(html.contains("<\\/ScRiPt>"));
        assert!(html.contains("connect-src 'none'"));
    }
}
