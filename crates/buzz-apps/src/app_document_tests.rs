use serde_json::{json, Value};

use super::{normalize_app_document, AppType};

fn contract() -> Value {
    serde_json::from_str(include_str!(
        "../../../fixtures/aios-apps/app-document-v1-contract.json"
    ))
    .expect("valid shared app document contract")
}

#[test]
fn shared_fixture_covers_each_existing_app_document_type() {
    let fixture = contract();
    assert_eq!(fixture["contractVersion"], 1);
    assert_eq!(fixture["fieldLengthUnit"], "UTF-16 code units");
    assert_eq!(fixture["serializedLengthUnit"], "UTF-8 bytes");
    assert_eq!(
        fixture["limits"]["appCanvasBytes"],
        super::MAX_APP_CANVAS_BYTES
    );

    for (name, app_type) in [
        ("slides", AppType::Slides),
        ("calendar", AppType::Calendar),
        ("design", AppType::Design),
    ] {
        normalize_app_document(app_type, &fixture["validDocuments"][name])
            .unwrap_or_else(|error| panic!("shared {name} fixture should validate: {error}"));
    }
}

#[test]
fn normalization_matches_the_shared_typescript_fixture() {
    let fixture = contract();
    let normalized = normalize_app_document(AppType::Slides, &fixture["normalization"]["input"])
        .expect("the fixture document is valid");
    assert_eq!(normalized, fixture["normalization"]["expected"]);
}

#[test]
fn app_field_limits_use_utf16_code_units() {
    let fixture = contract();
    let sample = fixture["unicode"]["sample"]
        .as_str()
        .expect("unicode sample is a string");
    assert_eq!(
        sample.encode_utf16().count(),
        fixture["unicode"]["utf16CodeUnits"]
            .as_u64()
            .expect("UTF-16 code-unit count") as usize
    );
    assert_eq!(
        sample.len(),
        fixture["unicode"]["utf8Bytes"]
            .as_u64()
            .expect("UTF-8 byte count") as usize
    );

    let mut slides = fixture["validDocuments"]["slides"].clone();
    slides["id"] = json!(sample.repeat(80));
    slides["title"] = json!(sample.repeat(100));
    slides["slides"][0]["title"] = json!(sample.repeat(250));
    slides["slides"][0]["body"] = json!(sample.repeat(4_000));
    assert!(normalize_app_document(AppType::Slides, &slides).is_ok());

    slides["id"] = json!(sample.repeat(81));
    assert!(normalize_app_document(AppType::Slides, &slides).is_err());

    let mut slides = fixture["validDocuments"]["slides"].clone();
    slides["title"] = json!(sample.repeat(101));
    assert!(normalize_app_document(AppType::Slides, &slides).is_err());

    let mut slides = fixture["validDocuments"]["slides"].clone();
    slides["slides"][0]["body"] = json!(sample.repeat(4_001));
    assert!(normalize_app_document(AppType::Slides, &slides).is_err());

    let mut calendar = fixture["validDocuments"]["calendar"].clone();
    calendar["events"][0]["description"] = json!(sample.repeat(500));
    assert!(normalize_app_document(AppType::Calendar, &calendar).is_ok());
    calendar["events"][0]["description"] = json!(sample.repeat(501));
    assert!(normalize_app_document(AppType::Calendar, &calendar).is_err());

    let mut design = fixture["validDocuments"]["design"].clone();
    design["html"] = json!(sample.repeat(50_000));
    assert!(normalize_app_document(AppType::Design, &design).is_ok());
    design["html"] = json!(sample.repeat(50_001));
    assert!(normalize_app_document(AppType::Design, &design).is_err());
}

#[test]
fn type_schema_and_timestamp_rules_match_desktop_documents() {
    let fixture = contract();
    let canonical = fixture["timestamps"]["canonical"]
        .as_str()
        .expect("canonical timestamp");
    let offset = fixture["timestamps"]["equivalentNoncanonicalOffset"]
        .as_str()
        .expect("offset timestamp");

    let mut slides = fixture["validDocuments"]["slides"].clone();
    slides["schemaVersion"] = json!(1.0);
    assert!(normalize_app_document(AppType::Slides, &slides).is_ok());

    slides["kind"] = json!("calendar");
    assert!(normalize_app_document(AppType::Slides, &slides).is_err());

    let mut slides = fixture["validDocuments"]["slides"].clone();
    slides["schemaVersion"] = json!(2);
    assert!(normalize_app_document(AppType::Slides, &slides).is_err());

    let mut slides = fixture["validDocuments"]["slides"].clone();
    slides["updatedAt"] = json!(offset);
    assert!(normalize_app_document(AppType::Slides, &slides).is_err());
    slides["updatedAt"] = json!(canonical);
    assert!(normalize_app_document(AppType::Slides, &slides).is_ok());

    let mut calendar = fixture["validDocuments"]["calendar"].clone();
    let starts_at = calendar["events"][0]["startsAt"].clone();
    calendar["events"][0]["endsAt"] = starts_at;
    assert!(normalize_app_document(AppType::Calendar, &calendar).is_err());
}
