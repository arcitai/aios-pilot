use super::{validate_business_context_canvas, CanvasRevisionSpec, IngestError};

const VALID_DOCUMENT: &str = r#"{"schemaVersion":1,"kind":"aios.business-workspace","company":{"name":"","website":"","summary":"","audience":"","offers":"","goals":""},"sources":[],"connections":[]}"#;

#[test]
fn typed_business_canvas_requires_valid_document_and_revision() {
    assert!(
        validate_business_context_canvas(VALID_DOCUMENT, Some(&CanvasRevisionSpec::NoHead)).is_ok()
    );

    assert!(matches!(
        validate_business_context_canvas(VALID_DOCUMENT, None),
        Err(IngestError::Rejected(message)) if message.contains("requires expected-revision")
    ));

    assert!(matches!(
        validate_business_context_canvas(
            r#"{"schemaVersion":2,"kind":"aios.business-workspace"}"#,
            Some(&CanvasRevisionSpec::NoHead)
        ),
        Err(IngestError::Rejected(message)) if message.contains("Business context Canvas")
    ));
}
