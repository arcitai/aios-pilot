use std::sync::{Arc, Mutex};

use axum::{
    body::Bytes, extract::State, http::StatusCode, response::IntoResponse, routing::post, Json,
    Router,
};
use nostr::Keys;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use uuid::Uuid;

use super::{
    cmd_create_app_to, cmd_list_apps_to, cmd_show_app_to, cmd_update_app_to, is_private_channel,
    is_stream_channel, normalize_app_document, parse_app_envelope, AppId,
};
use crate::{client::BuzzClient, error::CliError};

const BUSINESS_CHANNEL: &str = "326d56bc-c96c-4af0-86a1-5e804cd1b467";
const CALENDAR_CHANNEL: &str = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

#[derive(Clone)]
struct RelayState {
    events: Arc<Mutex<Vec<Value>>>,
    submitted: Arc<Mutex<Vec<Value>>>,
    signer: String,
    created_channel_count: Arc<Mutex<usize>>,
}

async fn relay(keys: &Keys) -> (String, RelayState, tokio::task::JoinHandle<()>) {
    let signer = keys.public_key().to_hex();
    let events = Arc::new(Mutex::new(vec![
        channel_event(
            "d".repeat(64),
            BUSINESS_CHANNEL,
            "Pilot business",
            Some("private"),
            Some("stream"),
            "",
        ),
        member_event("e".repeat(64), BUSINESS_CHANNEL, &signer),
    ]));
    let submitted = Arc::new(Mutex::new(Vec::new()));
    let created_channel_count = Arc::new(Mutex::new(0));
    let state = RelayState {
        events,
        submitted,
        signer,
        created_channel_count,
    };
    let app = Router::new()
        .route("/query", post(query_events))
        .route("/events", post(submit_event))
        .with_state(state.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}"), state, task)
}

async fn query_events(State(state): State<RelayState>, body: Bytes) -> Json<Vec<Value>> {
    let filters: Vec<Value> = serde_json::from_slice(&body).unwrap_or_default();
    let mut events: Vec<_> = state
        .events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| filters.iter().any(|filter| matches_filter(event, filter)))
        .cloned()
        .collect();
    events.sort_by(|left, right| {
        right
            .get("created_at")
            .and_then(Value::as_u64)
            .cmp(&left.get("created_at").and_then(Value::as_u64))
            .then_with(|| {
                left.get("id")
                    .and_then(Value::as_str)
                    .cmp(&right.get("id").and_then(Value::as_str))
            })
    });
    let limit = filters
        .iter()
        .filter_map(|filter| filter.get("limit").and_then(Value::as_u64))
        .min()
        .unwrap_or(100) as usize;
    events.truncate(limit);
    Json(events)
}

async fn submit_event(State(state): State<RelayState>, body: Bytes) -> impl IntoResponse {
    let Ok(event) = serde_json::from_slice::<Value>(&body) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid event"})),
        );
    };
    let kind = event
        .get("kind")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    if kind == 40100 {
        let channel_id = tag_value(&event, "h").unwrap_or_default();
        let current = state
            .events
            .lock()
            .unwrap()
            .iter()
            .filter(|candidate| {
                candidate.get("kind").and_then(Value::as_u64) == Some(40100)
                    && tag_value(candidate, "h").as_deref() == Some(&channel_id)
            })
            .max_by(|left, right| {
                left.get("created_at")
                    .and_then(Value::as_u64)
                    .cmp(&right.get("created_at").and_then(Value::as_u64))
            })
            .cloned();
        let expected = tag_value(&event, "expected-revision");
        let precondition_matches = match (expected.as_deref(), current.as_ref()) {
            (Some("none"), None) => true,
            (Some(revision), Some(head)) => {
                head.get("id").and_then(Value::as_str) == Some(revision)
            }
            _ => false,
        };
        if !precondition_matches {
            return (
                StatusCode::CONFLICT,
                Json(json!({"error":"Canvas revision mismatch"})),
            );
        }
    }

    state.submitted.lock().unwrap().push(event.clone());
    match kind {
        9007 => {
            let Some(channel_id) = tag_value(&event, "h") else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error":"channel id missing"})),
                );
            };
            let name = tag_value(&event, "name").unwrap_or_default();
            let about = tag_value(&event, "about").unwrap_or_default();
            let visibility = tag_value(&event, "visibility");
            let channel_type = tag_value(&event, "channel_type");
            let count = {
                let mut count = state.created_channel_count.lock().unwrap();
                *count += 1;
                *count
            };
            let created_at = event
                .get("created_at")
                .and_then(Value::as_u64)
                .unwrap_or_default();
            let mut tags = vec![json!(["d", channel_id]), json!(["name", name])];
            if let Some(visibility) = visibility {
                tags.push(json!(["visibility", visibility]));
            }
            if let Some(channel_type) = channel_type {
                tags.push(json!(["t", channel_type]));
            }
            tags.push(json!(["about", about]));
            let mut events = state.events.lock().unwrap();
            events.push(json!({
                "id": format!("{:064x}", count),
                "pubkey": state.signer,
                "kind": 39000,
                "content": "",
                "created_at": created_at,
                "tags": tags,
            }));
            events.push(member_event(
                format!("{:064x}", count + 10),
                &channel_id,
                &state.signer,
            ));
        }
        40100 => state.events.lock().unwrap().push(event.clone()),
        _ => {}
    }

    (
        StatusCode::OK,
        Json(json!({
            "event_id": event.get("id").and_then(Value::as_str).unwrap_or_default(),
            "accepted": true,
            "message": "accepted",
        })),
    )
}

fn matches_filter(event: &Value, filter: &Value) -> bool {
    if filter
        .get("kinds")
        .and_then(Value::as_array)
        .is_some_and(|kinds| {
            !kinds
                .iter()
                .any(|kind| kind.as_u64() == event.get("kind").and_then(Value::as_u64))
        })
    {
        return false;
    }
    if filter
        .get("ids")
        .and_then(Value::as_array)
        .is_some_and(|ids| {
            !ids.iter()
                .any(|id| id.as_str() == event.get("id").and_then(Value::as_str))
        })
    {
        return false;
    }
    ["d", "about", "h"].into_iter().all(|name| {
        let Some(wanted) = filter.get(format!("#{name}")).and_then(Value::as_array) else {
            return true;
        };
        event
            .get("tags")
            .and_then(Value::as_array)
            .is_some_and(|tags| {
                tags.iter().any(|tag| {
                    tag.as_array().is_some_and(|parts| {
                        parts.first().and_then(Value::as_str) == Some(name)
                            && parts.get(1).is_some_and(|value| wanted.contains(value))
                    })
                })
            })
    })
}

fn channel_event(
    event_id: String,
    channel_id: &str,
    name: &str,
    visibility: Option<&str>,
    channel_type: Option<&str>,
    about: &str,
) -> Value {
    let mut tags = vec![json!(["d", channel_id]), json!(["name", name])];
    if let Some(visibility) = visibility {
        tags.push(json!(["visibility", visibility]));
    }
    if let Some(channel_type) = channel_type {
        tags.push(json!(["t", channel_type]));
    }
    if !about.is_empty() {
        tags.push(json!(["about", about]));
    }
    json!({
        "id": event_id,
        "pubkey": "1".repeat(64),
        "kind": 39000,
        "content": "",
        "created_at": 1_700_000_000u64,
        "tags": tags,
    })
}

fn member_event(event_id: String, channel_id: &str, pubkey: &str) -> Value {
    json!({
        "id": event_id,
        "pubkey": "1".repeat(64),
        "kind": 39002,
        "content": "",
        "created_at": 1_700_000_001u64,
        "tags": [["d", channel_id], ["p", pubkey, "", "owner"]],
    })
}

fn tag_value(event: &Value, name: &str) -> Option<String> {
    event
        .get("tags")?
        .as_array()?
        .iter()
        .find(|tag| {
            tag.as_array()
                .and_then(|parts| parts.first())
                .and_then(Value::as_str)
                == Some(name)
        })?
        .as_array()?
        .get(1)?
        .as_str()
        .map(str::to_string)
}

fn client(url: &str, keys: Keys) -> BuzzClient {
    BuzzClient::new(url.to_string(), keys, None, None).unwrap()
}

fn slides_document(title: &str, updated_at: &str) -> String {
    json!({
        "kind": "slides",
        "schemaVersion": 1,
        "id": "slides-doc-1",
        "updatedAt": updated_at,
        "title": title,
        "slides": [{
            "id": "slide-1",
            "title": "Introduction",
            "body": "A short introduction.",
        }],
    })
    .to_string()
}

#[tokio::test]
async fn create_show_update_and_list_use_private_member_channel_and_revision_cas() {
    let keys = Keys::generate();
    let (url, state, server) = relay(&keys).await;
    let client = client(&url, keys);
    let mut created = Vec::new();
    cmd_create_app_to(
        &client,
        BUSINESS_CHANNEL,
        "slides",
        &slides_document("Pilot deck", "2026-09-24T12:00:00.000Z"),
        &mut created,
    )
    .await
    .expect("create app succeeds");
    let created: Value = serde_json::from_slice(&created).unwrap();
    assert_eq!(created["operation"], "created");
    assert_eq!(created["private"], true);
    assert_eq!(created["member"], true);
    assert_eq!(created["readback_verified"], true);
    assert_eq!(created["is_current_head"], true);
    let channel_id = created["channel_id"].as_str().unwrap().to_string();
    assert_eq!(
        created["marker"],
        format!("aios.app-document:v1:{BUSINESS_CHANNEL}:slides")
    );

    let submitted = state.submitted.lock().unwrap().clone();
    let channel_create = submitted
        .iter()
        .find(|event| event.get("kind").and_then(Value::as_u64) == Some(9007))
        .unwrap();
    assert_eq!(
        tag_value(channel_create, "visibility").as_deref(),
        Some("private")
    );
    assert_eq!(
        tag_value(channel_create, "channel_type").as_deref(),
        Some("stream")
    );
    assert_eq!(
        tag_value(channel_create, "about"),
        created["marker"].as_str().map(str::to_string)
    );
    let first_canvas = submitted
        .iter()
        .find(|event| event.get("kind").and_then(Value::as_u64) == Some(40100))
        .unwrap();
    assert_eq!(
        tag_value(first_canvas, "h").as_deref(),
        Some(channel_id.as_str())
    );
    assert_eq!(
        tag_value(first_canvas, "expected-revision").as_deref(),
        Some("none")
    );

    let mut shown = Vec::new();
    cmd_show_app_to(&client, BUSINESS_CHANNEL, "slides", &mut shown)
        .await
        .expect("show app succeeds");
    let shown: Value = serde_json::from_slice(&shown).unwrap();
    assert_eq!(shown["document"]["title"], "Pilot deck");
    assert_eq!(shown["members"].as_array().unwrap().len(), 1);

    let first_revision = shown["revision"].as_str().unwrap().to_string();
    let mut updated = Vec::new();
    cmd_update_app_to(
        &client,
        BUSINESS_CHANNEL,
        "slides",
        &first_revision,
        &slides_document("Updated pilot deck", "2026-09-24T12:01:00.000Z"),
        &mut updated,
    )
    .await
    .expect("update app succeeds");
    let updated: Value = serde_json::from_slice(&updated).unwrap();
    assert_eq!(updated["operation"], "updated");
    assert_ne!(updated["revision"], first_revision);
    assert_eq!(updated["expected_revision"], first_revision);
    assert_eq!(updated["readback_verified"], true);
    assert_eq!(updated["is_current_head"], true);
    let update_event = state
        .submitted
        .lock()
        .unwrap()
        .iter()
        .find(|event| event.get("id").and_then(Value::as_str) == updated["event_id"].as_str())
        .cloned()
        .expect("submitted update event is present");
    assert_eq!(
        tag_value(&update_event, "expected-revision").as_deref(),
        Some(first_revision.as_str()),
        "the update event carries the revision precondition for relay CAS"
    );

    let submitted_before_stale_update = state.submitted.lock().unwrap().len();
    let stale = cmd_update_app_to(
        &client,
        BUSINESS_CHANNEL,
        "slides",
        &first_revision,
        &slides_document("Stale edit", "2026-09-24T12:02:00.000Z"),
        &mut Vec::new(),
    )
    .await
    .expect_err("stale revision must conflict");
    assert!(matches!(stale, CliError::Conflict(_)));
    assert_eq!(
        state.submitted.lock().unwrap().len(),
        submitted_before_stale_update
    );

    let mut listed = Vec::new();
    cmd_list_apps_to(&client, BUSINESS_CHANNEL, &mut listed)
        .await
        .expect("list apps succeeds");
    let listed: Value = serde_json::from_slice(&listed).unwrap();
    assert_eq!(listed["apps"].as_array().unwrap().len(), 1);
    assert_eq!(listed["apps"][0]["app_id"], "slides");
    assert_eq!(listed["apps"][0]["revision"], updated["revision"]);

    server.abort();
}

#[tokio::test]
async fn create_requires_business_membership_before_publishing() {
    let keys = Keys::generate();
    let (url, state, server) = relay(&keys).await;
    state.events.lock().unwrap().retain(|event| {
        !(event.get("kind").and_then(Value::as_u64) == Some(39002)
            && crate::client::extract_d_tag(event) == BUSINESS_CHANNEL)
    });
    state.events.lock().unwrap().push(member_event(
        "f".repeat(64),
        BUSINESS_CHANNEL,
        &Keys::generate().public_key().to_hex(),
    ));
    let client = client(&url, keys);
    let error = cmd_create_app_to(
        &client,
        BUSINESS_CHANNEL,
        "slides",
        &slides_document("Pilot deck", "2026-09-24T12:00:00.000Z"),
        &mut Vec::new(),
    )
    .await
    .expect_err("non-member cannot create app channel");
    assert!(matches!(error, CliError::NotFound(_)));
    assert!(state.submitted.lock().unwrap().is_empty());
    assert_eq!(*state.created_channel_count.lock().unwrap(), 0);
    server.abort();
}

#[tokio::test]
async fn show_rejects_open_or_non_stream_app_channels() {
    for (visibility, channel_type) in [
        (Some("open"), Some("stream")),
        (Some("private"), Some("forum")),
    ] {
        let keys = Keys::generate();
        let (url, state, server) = relay(&keys).await;
        let marker = format!("aios.app-document:v1:{BUSINESS_CHANNEL}:slides");
        state.events.lock().unwrap().push(channel_event(
            "a".repeat(64),
            CALENDAR_CHANNEL,
            "aios-slides",
            visibility,
            channel_type,
            &marker,
        ));
        state.events.lock().unwrap().push(member_event(
            "b".repeat(64),
            CALENDAR_CHANNEL,
            &keys.public_key().to_hex(),
        ));
        let client = client(&url, keys);
        let error = cmd_show_app_to(&client, BUSINESS_CHANNEL, "slides", &mut Vec::new())
            .await
            .expect_err("app channel must be private stream");
        assert!(matches!(error, CliError::Other(_)));
        server.abort();
    }
}

#[test]
fn app_envelope_schema_is_bound_to_business_channel_and_app() {
    let input = slides_document("Pilot deck", "2026-09-24T12:00:00.000Z");
    let document = super::parse_input_document(&input, AppId::Slides).unwrap();
    let envelope =
        super::serialize_app_envelope(BUSINESS_CHANNEL, AppId::Slides, document).unwrap();
    assert!(parse_app_envelope(&envelope, BUSINESS_CHANNEL, AppId::Slides).is_ok());
    assert!(parse_app_envelope(&envelope, CALENDAR_CHANNEL, AppId::Slides).is_err());
    assert!(parse_app_envelope(&envelope, BUSINESS_CHANNEL, AppId::Design).is_err());
    assert!(AppId::parse("sites").is_err());
}

#[test]
fn app_documents_validate_bounded_schema_and_canonical_timestamps() {
    let valid: Value =
        serde_json::from_str(&slides_document("Pilot deck", "2026-09-24T12:00:00.000Z")).unwrap();
    assert!(normalize_app_document(AppId::Slides, &valid).is_ok());

    let mut invalid = valid.clone();
    invalid["schemaVersion"] = json!(2);
    assert!(normalize_app_document(AppId::Slides, &invalid).is_err());

    let mut invalid = valid;
    invalid["updatedAt"] = json!("2026-09-24T14:00:00+02:00");
    assert!(normalize_app_document(AppId::Slides, &invalid).is_err());

    let too_many_slides = json!({
        "kind": "slides",
        "schemaVersion": 1,
        "id": "deck",
        "updatedAt": "2026-09-24T12:00:00.000Z",
        "title": "Deck",
        "slides": (0..21).map(|index| json!({
            "id": format!("slide-{index}"),
            "title": "Slide",
            "body": "Body",
        })).collect::<Vec<_>>(),
    });
    assert!(normalize_app_document(AppId::Slides, &too_many_slides).is_err());
}

#[test]
fn app_channel_security_requires_private_stream() {
    let private_stream = channel_event(
        "1".repeat(64),
        &Uuid::new_v4().to_string(),
        "app",
        Some("private"),
        Some("stream"),
        "marker",
    );
    assert!(is_private_channel(&private_stream));
    assert!(is_stream_channel(&private_stream));

    let open_stream = channel_event(
        "2".repeat(64),
        &Uuid::new_v4().to_string(),
        "app",
        Some("open"),
        Some("stream"),
        "marker",
    );
    assert!(!is_private_channel(&open_stream));
    assert!(is_stream_channel(&open_stream));

    let private_forum = channel_event(
        "3".repeat(64),
        &Uuid::new_v4().to_string(),
        "app",
        Some("private"),
        Some("forum"),
        "marker",
    );
    assert!(is_private_channel(&private_forum));
    assert!(!is_stream_channel(&private_forum));
}

#[test]
fn app_marker_and_channel_type_require_single_exact_tags() {
    let marker = format!("aios.app-document:v1:{BUSINESS_CHANNEL}:slides");
    let metadata = channel_event(
        "1".repeat(64),
        CALENDAR_CHANNEL,
        "app",
        Some("private"),
        Some("stream"),
        &marker,
    );
    assert!(super::validate_app_channel(metadata.clone(), BUSINESS_CHANNEL, AppId::Slides).is_ok());

    let mut duplicate_marker = metadata.clone();
    duplicate_marker["tags"]
        .as_array_mut()
        .unwrap()
        .push(json!(["about", marker]));
    assert!(
        super::validate_app_channel(duplicate_marker, BUSINESS_CHANNEL, AppId::Slides).is_err()
    );

    let mut duplicate_type = metadata;
    duplicate_type["tags"]
        .as_array_mut()
        .unwrap()
        .push(json!(["t", "forum"]));
    assert!(!is_stream_channel(&duplicate_type));
}
