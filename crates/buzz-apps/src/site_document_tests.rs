use super::*;

#[test]
fn reads_the_shared_sites_document_fixture() {
    let fixture = parse_site_document(include_str!("../../../fixtures/aios-sites/site-v1.json"))
        .expect("valid shared Sites v1 fixture");
    assert_eq!(fixture.schema_version, 1);
    assert_eq!(fixture.kind, "aios.site");
    assert_eq!(fixture.title, "Sommer i København");
}

#[test]
fn shared_sites_fixture_matches_utf16_and_byte_limits() {
    let contract: serde_json::Value = serde_json::from_str(include_str!(
        "../../../fixtures/aios-sites/site-v1-length-contract.json"
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
    let mut document: SiteDocument =
        serde_json::from_str(include_str!("../../../fixtures/aios-sites/site-v1.json"))
            .expect("valid shared Sites v1 fixture");
    document.title = sample.repeat(100);
    assert_eq!(document.title.encode_utf16().count(), 100);
    assert!(document.title.len() > document.title.encode_utf16().count());
    assert!(validate_site_document(&document).is_ok());

    document.files.index_html = sample.repeat(60_001);
    assert!(document.files.index_html.len() > MAX_SITE_HTML_CODE_UNITS);
    assert!(validate_site_document(&document).is_ok());
    document.title = sample.repeat(MAX_SITE_TITLE_CODE_UNITS + 1);
    assert!(validate_site_document(&document).is_err());
}

#[test]
fn sites_schema_rejects_unknown_fields_and_bad_versions() {
    let mut value: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/aios-sites/site-v1.json"))
            .expect("valid shared Sites v1 fixture");
    value["unexpected"] = serde_json::json!(true);
    assert!(parse_site_document(&value.to_string()).is_err());

    let mut value: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/aios-sites/site-v1.json"))
            .expect("valid shared Sites v1 fixture");
    value["schemaVersion"] = serde_json::json!(2);
    assert!(parse_site_document(&value.to_string()).is_err());
}

#[test]
fn sites_parser_checks_serialized_input_size_in_utf8_bytes() {
    let oversized = "æ".repeat(MAX_SITE_DOCUMENT_BYTES / 2 + 1);
    let error = parse_site_document(&oversized).expect_err("oversized UTF-8 input is rejected");
    assert!(error.contains("200000 UTF-8 bytes"));
}
