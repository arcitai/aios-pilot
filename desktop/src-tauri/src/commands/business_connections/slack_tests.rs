use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use url::Url;

use super::{
    CredentialStore, SlackAdapter, SlackConnectionError, MAX_CHANNELS_PER_PAGE,
    MAX_HISTORY_MESSAGES,
};
use crate::commands::business_connections::scope::ConnectionScope;

const TEST_TOKEN: &str = "xoxb-fixture-slack-token-1234567890";
const TEST_AUTHORIZATION: &str = "Bearer xoxb-fixture-slack-token-1234567890";
const CHANNEL_ID: &str = "C12345678";
const OTHER_CHANNEL_ID: &str = "G87654321";

#[derive(Default)]
struct MemoryCredentialStore(Mutex<HashMap<String, String>>);

impl CredentialStore for MemoryCredentialStore {
    fn load(&self, key: &str) -> Result<Option<String>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "test lock".to_string())?
            .get(key)
            .cloned())
    }

    fn store(&self, key: &str, value: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "test lock".to_string())?
            .insert(key.to_string(), value.to_string());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "test lock".to_string())?
            .remove(key);
        Ok(())
    }
}

fn scope() -> ConnectionScope {
    ConnectionScope::new(
        "wss://community.example".to_string(),
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string(),
    )
    .expect("valid test scope")
}

async fn serve(router: Router) -> (Url, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("fixture listener binds");
    let address = listener.local_addr().expect("fixture address");
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    (
        Url::parse(&format!("http://{address}/")).expect("fixture URL"),
        task,
    )
}

fn authorized(headers: &HeaderMap) -> bool {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        == Some(TEST_AUTHORIZATION)
}

async fn fixture_auth_test(headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
    if !authorized(&headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(Json(json!({
        "ok": true,
        "team": "Example workspace",
        "team_id": "T12345678"
    })))
}

#[tokio::test]
async fn bot_tokens_are_required_and_rejected_credentials_are_not_saved() {
    async fn unauthorized(headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
        assert!(authorized(&headers));
        Ok(Json(json!({ "ok": false, "error": "invalid_auth" })))
    }
    let (origin, server) = serve(Router::new().route("/auth.test", post(unauthorized))).await;
    let store = MemoryCredentialStore::default();
    let adapter = SlackAdapter::for_test(&store, origin).expect("adapter builds");

    assert_eq!(
        adapter
            .verify_token("xoxp-user-token-123456789012345")
            .await,
        Err(SlackConnectionError::InvalidToken)
    );
    assert_eq!(
        adapter.verify_token(TEST_TOKEN).await,
        Err(SlackConnectionError::RejectedCredentials)
    );
    assert!(store
        .load(&scope().keyring_key("slack"))
        .expect("credential lookup")
        .is_none());
    server.abort();
}

#[tokio::test]
async fn verified_bot_tokens_save_only_after_auth_test_and_status_rechecks_them() {
    async fn auth(headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        Ok(Json(json!({
            "ok": true,
            "team": "Example workspace",
            "team_id": "T12345678",
            "user": "buzz-bot",
            "bot_id": "B12345678"
        })))
    }
    let (origin, server) = serve(Router::new().route("/auth.test", post(auth))).await;
    let store = MemoryCredentialStore::default();
    let adapter = SlackAdapter::for_test(&store, origin).expect("adapter builds");
    let account = adapter
        .verify_token(TEST_TOKEN)
        .await
        .expect("token verifies");
    assert_eq!(account.team_id, "T12345678");
    assert_eq!(account.name, "Example workspace");
    adapter
        .save_verified_token(&scope(), TEST_TOKEN)
        .expect("verified token saves");
    let status = adapter.status(&scope()).await.expect("status verifies");
    assert!(status.connected);
    assert_eq!(status.workspace_id.as_deref(), Some("T12345678"));
    assert_eq!(status.workspace_name.as_deref(), Some("Example workspace"));
    assert_eq!(
        store
            .load(&scope().keyring_key("slack"))
            .expect("credential lookup")
            .as_deref(),
        Some(TEST_TOKEN)
    );
    server.abort();
}

#[tokio::test]
async fn local_revoke_removes_only_the_selected_relay_identity_and_provider_entry() {
    async fn unused(headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
        assert!(authorized(&headers));
        Ok(Json(json!({ "ok": true })))
    }
    let (origin, server) = serve(Router::new().route("/auth.test", post(unused))).await;
    let store = MemoryCredentialStore::default();
    let adapter = SlackAdapter::for_test(&store, origin).expect("adapter builds");
    let current = scope();
    let other_community = ConnectionScope::new(
        "wss://other-community.example".to_string(),
        current.pubkey.clone(),
    )
    .expect("valid other scope");
    let other_identity = ConnectionScope::new(
        current.relay_url.clone(),
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_string(),
    )
    .expect("valid other scope");
    for key in [
        current.keyring_key("slack"),
        current.keyring_key("github"),
        other_community.keyring_key("slack"),
        other_identity.keyring_key("slack"),
    ] {
        store.store(&key, TEST_TOKEN).expect("fixture stores token");
    }

    adapter
        .revoke(&current)
        .expect("selected credential removed");
    assert!(store
        .load(&current.keyring_key("slack"))
        .expect("current credential")
        .is_none());
    for key in [
        current.keyring_key("github"),
        other_community.keyring_key("slack"),
        other_identity.keyring_key("slack"),
    ] {
        assert!(store.load(&key).expect("other credential").is_some());
    }
    server.abort();
}

#[tokio::test]
async fn channel_browsing_is_bounded_filtered_to_membership_and_cursor_paged() {
    async fn list(
        State(requests): State<Arc<Mutex<Vec<HashMap<String, String>>>>>,
        Query(query): Query<HashMap<String, String>>,
        headers: HeaderMap,
    ) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        assert_eq!(query.get("limit").map(String::as_str), Some("100"));
        assert_eq!(
            query.get("types").map(String::as_str),
            Some("public_channel,private_channel")
        );
        assert_eq!(
            query.get("exclude_archived").map(String::as_str),
            Some("true")
        );
        requests
            .lock()
            .expect("request log lock")
            .push(query.clone());
        let first = query.get("cursor").is_none();
        let channels = if first {
            vec![
                json!({"id": CHANNEL_ID, "name": "operations", "is_private": false, "is_member": true, "is_archived": false}),
                json!({"id": OTHER_CHANNEL_ID, "name": "planning", "is_private": true, "is_member": true, "is_archived": false}),
                json!({"id": "C99999999", "name": "not-joined", "is_private": false, "is_member": false, "is_archived": false}),
                json!({"id": "C88888888", "name": "archived", "is_private": false, "is_member": true, "is_archived": true}),
                json!({"id": "D77777777", "name": "direct-message", "is_private": false, "is_member": true, "is_archived": false}),
            ]
        } else {
            vec![]
        };
        Ok(Json(json!({
            "ok": true,
            "channels": channels,
            "response_metadata": {"next_cursor": if first { "opaque-next-cursor" } else { "" }}
        })))
    }
    let requests = Arc::new(Mutex::new(Vec::new()));
    let (origin, server) = serve(
        Router::new()
            .route("/auth.test", post(fixture_auth_test))
            .route("/conversations.list", get(list))
            .with_state(Arc::clone(&requests)),
    )
    .await;
    let store = MemoryCredentialStore::default();
    let adapter = SlackAdapter::for_test(&store, origin).expect("adapter builds");

    let first = adapter
        .list_channels(TEST_TOKEN, None)
        .await
        .expect("first channel page");
    assert!(first.has_more);
    assert_eq!(first.next_cursor.as_deref(), Some("opaque-next-cursor"));
    assert_eq!(first.channels.len(), 2);
    assert_eq!(first.channels[0].id, CHANNEL_ID);
    assert_eq!(
        first.channels[0].url,
        "https://slack.com/app_redirect?channel=C12345678&team=T12345678"
    );
    assert!(!first.channels[0].is_private);
    assert!(first.channels[1].is_private);
    let second = adapter
        .list_channels(TEST_TOKEN, first.next_cursor.as_deref())
        .await
        .expect("next channel page");
    assert!(!second.has_more);
    assert_eq!(MAX_CHANNELS_PER_PAGE, 100);
    assert_eq!(
        requests.lock().expect("request log lock")[1]
            .get("cursor")
            .map(String::as_str),
        Some("opaque-next-cursor")
    );
    server.abort();
}

#[tokio::test]
async fn import_reads_only_the_selected_channel_and_marks_omitted_history() {
    async fn info(
        Query(query): Query<HashMap<String, String>>,
        headers: HeaderMap,
    ) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) || query.get("channel").map(String::as_str) != Some(CHANNEL_ID) {
            return Err(StatusCode::NOT_FOUND);
        }
        Ok(Json(json!({
            "ok": true,
            "channel": {"id": CHANNEL_ID, "name": "operations", "is_private": false, "is_member": true, "is_archived": false}
        })))
    }
    async fn history(
        State(requests): State<Arc<Mutex<Vec<HashMap<String, String>>>>>,
        Query(query): Query<HashMap<String, String>>,
        headers: HeaderMap,
    ) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) || query.get("channel").map(String::as_str) != Some(CHANNEL_ID) {
            return Err(StatusCode::NOT_FOUND);
        }
        assert_eq!(query.get("limit").map(String::as_str), Some("15"));
        requests
            .lock()
            .expect("history log lock")
            .push(query.clone());
        Ok(Json(json!({
            "ok": true,
            "has_more": true,
            "response_metadata": {"next_cursor": "older-history-cursor"},
            "messages": [
                {"type": "message", "user": "U12345678", "ts": "1723456789.000002", "text": "newer message", "reply_count": 2},
                {"type": "message", "user": "U12345678", "ts": "1723456788.000001", "text": "older message", "files": [{"id": "F123"}]}
            ]
        })))
    }
    let history_requests = Arc::new(Mutex::new(Vec::new()));
    let (origin, server) = serve(
        Router::new()
            .route("/auth.test", post(fixture_auth_test))
            .route("/conversations.info", get(info))
            .route("/conversations.history", get(history))
            .with_state(Arc::clone(&history_requests)),
    )
    .await;
    let store = MemoryCredentialStore::default();
    let adapter = SlackAdapter::for_test(&store, origin).expect("adapter builds");

    let imported = adapter
        .import_channel_history(TEST_TOKEN, CHANNEL_ID)
        .await
        .expect("selected channel imports");
    assert_eq!(imported.title, "Slack #operations recent messages");
    assert_eq!(
        imported.url,
        "https://slack.com/app_redirect?channel=C12345678&team=T12345678"
    );
    assert!(imported.truncated);
    assert!(imported
        .content
        .contains("older messages, threads, or non-text content were omitted"));
    let older = imported.content.find("older message").expect("older text");
    let newer = imported.content.find("newer message").expect("newer text");
    assert!(older < newer, "messages are rendered oldest first");
    assert_eq!(
        history_requests.lock().expect("history log lock").len(),
        1,
        "only the selected channel's history is fetched"
    );
    assert_eq!(MAX_HISTORY_MESSAGES, 15);
    server.abort();
}

#[tokio::test]
async fn history_is_not_requested_for_a_channel_the_bot_does_not_belong_to() {
    async fn info(headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        Ok(Json(json!({
            "ok": true,
            "channel": {"id": CHANNEL_ID, "name": "private", "is_private": true, "is_member": false, "is_archived": false}
        })))
    }
    async fn history() -> StatusCode {
        StatusCode::INTERNAL_SERVER_ERROR
    }
    let (origin, server) = serve(
        Router::new()
            .route("/auth.test", post(fixture_auth_test))
            .route("/conversations.info", get(info))
            .route("/conversations.history", get(history)),
    )
    .await;
    let store = MemoryCredentialStore::default();
    let adapter = SlackAdapter::for_test(&store, origin).expect("adapter builds");
    assert_eq!(
        adapter
            .import_channel_history(TEST_TOKEN, CHANNEL_ID)
            .await
            .unwrap_err(),
        SlackConnectionError::NotInChannel
    );
    assert_eq!(
        adapter
            .import_channel_history(TEST_TOKEN, "https://slack.example/C12345678")
            .await
            .unwrap_err(),
        SlackConnectionError::InvalidChannelId
    );
    server.abort();
}

#[tokio::test]
async fn imported_history_obeys_utf16_bound_and_preserves_code_points() {
    async fn info(headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        Ok(Json(json!({
            "ok": true,
            "channel": {"id": CHANNEL_ID, "name": "operations", "is_private": false, "is_member": true, "is_archived": false}
        })))
    }
    async fn history(headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        Ok(Json(json!({
            "ok": true,
            "has_more": false,
            "messages": [{"type": "message", "user": "U12345678", "ts": "1723456789.000001", "text": "🧭".repeat(20_100)}]
        })))
    }
    let (origin, server) = serve(
        Router::new()
            .route("/auth.test", post(fixture_auth_test))
            .route("/conversations.info", get(info))
            .route("/conversations.history", get(history)),
    )
    .await;
    let store = MemoryCredentialStore::default();
    let adapter = SlackAdapter::for_test(&store, origin).expect("adapter builds");
    let imported = adapter
        .import_channel_history(TEST_TOKEN, CHANNEL_ID)
        .await
        .expect("bounded history import");
    assert!(imported.truncated);
    assert!(imported.content.encode_utf16().count() <= 40_000);
    assert!(!imported.content.contains('\u{fffd}'));
    server.abort();
}

#[tokio::test]
async fn redirect_responses_are_not_followed() {
    async fn auth() -> Response<Body> {
        Response::builder()
            .status(StatusCode::FOUND)
            .header("location", "/redirect-target")
            .body(Body::empty())
            .expect("redirect response")
    }
    async fn redirect_target() -> StatusCode {
        panic!("Slack token request followed a redirect")
    }
    let (origin, server) = serve(
        Router::new()
            .route("/auth.test", post(auth))
            .route("/redirect-target", get(redirect_target)),
    )
    .await;
    let store = MemoryCredentialStore::default();
    let adapter = SlackAdapter::for_test(&store, origin).expect("adapter builds");
    assert_eq!(
        adapter.verify_token(TEST_TOKEN).await.unwrap_err(),
        SlackConnectionError::HttpStatus(302)
    );
    server.abort();
}

#[tokio::test]
async fn import_deadline_bounds_selected_channel_requests() {
    async fn slow_info(headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
        Ok(Json(json!({
            "ok": true,
            "channel": {"id": CHANNEL_ID, "name": "operations", "is_private": false, "is_member": true, "is_archived": false}
        })))
    }
    let (origin, server) = serve(
        Router::new()
            .route("/auth.test", post(fixture_auth_test))
            .route("/conversations.info", get(slow_info)),
    )
    .await;
    let store = MemoryCredentialStore::default();
    let adapter = SlackAdapter::for_test_with_timeout(&store, origin, Duration::from_millis(20))
        .expect("adapter builds");
    assert_eq!(
        adapter
            .import_channel_history(TEST_TOKEN, CHANNEL_ID)
            .await
            .unwrap_err(),
        SlackConnectionError::Timeout
    );
    server.abort();
}

#[test]
fn cursor_validation_rejects_empty_control_and_oversized_values() {
    assert_eq!(MAX_CHANNELS_PER_PAGE, 100);
    assert_eq!(MAX_HISTORY_MESSAGES, 15);
    assert_eq!(
        super::validate_cursor("\u{0000}").unwrap_err(),
        SlackConnectionError::InvalidCursor
    );
    assert_eq!(
        super::validate_cursor(&"x".repeat(513)).unwrap_err(),
        SlackConnectionError::InvalidCursor
    );
}
