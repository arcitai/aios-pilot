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
    fail_canvas_history_after_write: bool,
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

async fn test_query(State(relay): State<TestRelay>, Json(filters): Json<Vec<Value>>) -> Response {
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
    if kind == 40100
        && data.fail_canvas_history_after_write
        && data.writes.iter().any(|event| event["kind"] == 40100)
    {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "canvas history unavailable"})),
        )
            .into_response();
    }
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
                                    && parts.get(1).and_then(Value::as_str).is_some_and(|channel| {
                                        channel_ids
                                            .iter()
                                            .any(|candidate| candidate.as_str() == Some(channel))
                                    })
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
        vec!["Consulting".into(), "Strategy".into()],
        vec!["Reach 20 customers".into(), "Hire a designer".into()],
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
    assert_eq!(document["company"]["name"], "Example Co");
    assert_eq!(document["company"]["offers"], "Consulting\nStrategy");
    assert_eq!(
        document["company"]["goals"],
        "Reach 20 customers\nHire a designer"
    );
    drop(data);
    task.abort();
}

#[tokio::test]
async fn init_allows_an_empty_company_name_and_uses_desktop_channel_fallback() {
    let (client, relay, _, task) = start_test_relay().await;
    let result = cmd_init(
        &client,
        "  ".into(),
        String::new(),
        String::new(),
        String::new(),
        Vec::new(),
        Vec::new(),
    )
    .await
    .expect("empty business name matches the desktop schema");
    assert_eq!(result["document"]["company"]["name"], "");
    let data = relay.data.lock().expect("test relay lock");
    let create = data
        .writes
        .iter()
        .find(|event| event["kind"] == 9007)
        .expect("fallback private channel create event");
    assert!(create["tags"].as_array().is_some_and(|tags| tags
        .iter()
        .any(|tag| tag == &json!(["name", "My business"]))));
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
async fn source_write_reports_delivery_unknown_when_post_write_history_fails() {
    let (client, relay, pubkey, task) = start_test_relay().await;
    let document = sample_document().to_json().expect("serialize fixture");
    let channel_id = "123e4567-e89b-12d3-a456-426614174000";
    add_managed_workspace(&relay, channel_id, &pubkey, Some(&document));
    relay
        .data
        .lock()
        .expect("test relay lock")
        .fail_canvas_history_after_write = true;

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

    assert!(matches!(
        result,
        Err(CliError::DeliveryUnknown(message))
            if message.contains("persistence could not be verified")
    ));
    assert!(relay
        .data
        .lock()
        .expect("test relay lock")
        .writes
        .iter()
        .any(|event| event["kind"] == 40100));
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
