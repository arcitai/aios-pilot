use std::{fs::File, io::Read, path::Path};

use serde::Serialize;

use crate::error::CliError;
use buzz_apps::site_document::{parse_site_document, validate_site_document};

#[cfg(test)]
use buzz_apps::site_document::SiteFiles;
pub(super) use buzz_apps::site_document::{SiteDocument, MAX_SITE_DOCUMENT_BYTES};

pub(super) fn parse_document(content: &str) -> Result<SiteDocument, CliError> {
    parse_site_document(content).map_err(CliError::Usage)
}

pub(super) fn parse_saved_document(content: &str) -> Result<SiteDocument, CliError> {
    parse_site_document(content).map_err(|message| {
        CliError::Other(format!(
            "saved site canvas is not a supported Sites v1 document: {message}"
        ))
    })
}

pub(super) fn validate_document(document: &SiteDocument) -> Result<(), String> {
    validate_site_document(document)
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

    #[test]
    fn shared_schema_keeps_cli_pretty_serialization_byte_limit() {
        let contract: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../fixtures/aios-sites/site-v1-length-contract.json"
        ))
        .expect("valid shared Sites length fixture");
        let sample = contract["unicode"]["sample"]
            .as_str()
            .expect("unicode sample");
        let mut document: SiteDocument = serde_json::from_str(include_str!(
            "../../../../../fixtures/aios-sites/site-v1.json"
        ))
        .expect("valid shared Sites v1 fixture");

        document.title = sample.repeat(100);
        assert!(validate_document(&document).is_ok());
        document.files.index_html = sample.repeat(60_001);
        assert!(serialize_document(&document).is_ok());

        document.files.index_html = sample.repeat(100_000);
        assert!(validate_document(&document).is_ok());
        assert!(matches!(
            serialize_document(&document),
            Err(CliError::Usage(message)) if message.contains("serialized Sites document exceeds 200000 UTF-8 bytes")
        ));
    }
}
