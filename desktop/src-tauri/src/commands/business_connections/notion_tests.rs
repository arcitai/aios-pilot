use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use url::Url;

use super::{
    normalize_uuid, safe_page_url, CredentialStore, NotionAdapter, NotionConnectionError,
    MAX_CHILDREN_PAGES, MAX_SEARCH_RESULTS, PAGE_SIZE,
};
use crate::commands::business_connections::scope::ConnectionScope;

type BlockRequestLog = Arc<Mutex<Vec<(String, HashMap<String, String>)>>>;

const TEST_TOKEN: &str = "ntn_fixture_internal_token_123456789";
const TEST_AUTHORIZATION: &str = "Bearer ntn_fixture_internal_token_123456789";
const PAGE_ID: &str = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID: &str = "22222222-2222-4222-8222-222222222222";
const DEEP_BLOCK_ID: &str = "33333333-3333-4333-8333-333333333333";

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

fn page_payload(page_id: &str) -> Value {
    let url = format!(
        "https://app.notion.com/p/Operations-handbook-{}",
        page_id.replace('-', "")
    );
    json!({
        "object": "page",
        "id": page_id,
        "url": url,
        "properties": {
            "title": {
                "type": "title",
                "title": [{ "plain_text": "Operations handbook" }]
            }
        },
        "last_edited_time": "2026-09-23T12:00:00.000Z"
    })
}

fn block(id: &str, kind: &str, text: &str, has_children: bool) -> Value {
    json!({
        "id": id,
        "type": kind,
        "has_children": has_children,
        (kind): { "rich_text": [{ "plain_text": text }] }
    })
}

fn authorized(headers: &HeaderMap) -> bool {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        == Some(TEST_AUTHORIZATION)
        && headers
            .get("notion-version")
            .and_then(|value| value.to_str().ok())
            == Some("2026-03-11")
}

#[tokio::test]
async fn rejected_credentials_are_not_saved_or_reported_connected() {
    async fn unauthorized(headers: HeaderMap) -> StatusCode {
        assert!(authorized(&headers));
        StatusCode::UNAUTHORIZED
    }
    let (origin, server) = serve(Router::new().route("/users/me", get(unauthorized))).await;
    let store = MemoryCredentialStore::default();
    let adapter = NotionAdapter::for_test(&store, origin).expect("adapter builds");

    assert_eq!(
        adapter.verify_token(TEST_TOKEN).await.unwrap_err(),
        NotionConnectionError::RejectedCredentials
    );
    assert!(store
        .load(&scope().keyring_key("notion"))
        .expect("test store read")
        .is_none());
    assert_eq!(
        adapter.verify_token("too-short").await.unwrap_err(),
        NotionConnectionError::InvalidToken
    );
    server.abort();
}

#[tokio::test]
async fn verified_internal_token_is_saved_only_after_users_me_succeeds() {
    async fn current_user(headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        Ok(Json(json!({
            "object": "user",
            "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "type": "bot",
            "name": "Buzz workspace integration",
            "email": "private@example.invalid"
        })))
    }
    let (origin, server) = serve(Router::new().route("/users/me", get(current_user))).await;
    let store = MemoryCredentialStore::default();
    let adapter = NotionAdapter::for_test(&store, origin).expect("adapter builds");
    let active_scope = scope();

    let account = adapter
        .verify_token(TEST_TOKEN)
        .await
        .expect("internal token verifies");
    assert_eq!(account.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert_eq!(account.name, "Buzz workspace integration");
    adapter
        .save_verified_token(&active_scope, TEST_TOKEN)
        .expect("save verified token");
    assert_eq!(
        store
            .load(&active_scope.keyring_key("notion"))
            .expect("load scoped token")
            .as_deref(),
        Some(TEST_TOKEN)
    );
    server.abort();
}

#[tokio::test]
async fn local_revoke_removes_only_the_selected_relay_and_identity_entry() {
    let (origin, server) = serve(Router::new()).await;
    let store = MemoryCredentialStore::default();
    let adapter = NotionAdapter::for_test(&store, origin).expect("adapter builds");
    let selected_scope = scope();
    let other_scope = ConnectionScope::new(
        "wss://other-community.example".to_string(),
        selected_scope.pubkey.clone(),
    )
    .expect("other scope is valid");
    let other_identity = ConnectionScope::new(
        selected_scope.relay_url.clone(),
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_string(),
    )
    .expect("other identity scope is valid");
    store
        .store(&selected_scope.keyring_key("notion"), TEST_TOKEN)
        .expect("store selected credential");
    store
        .store(&other_scope.keyring_key("notion"), "other-fixture-token")
        .expect("store other credential");
    store
        .store(
            &other_identity.keyring_key("notion"),
            "other-identity-fixture-token",
        )
        .expect("store other identity credential");

    adapter.revoke(&selected_scope).expect("local revoke");
    assert_eq!(
        adapter.status(&selected_scope).await.expect("empty status"),
        super::NotionConnectionStatus {
            connected: false,
            name: None,
        }
    );
    assert!(store
        .load(&other_scope.keyring_key("notion"))
        .expect("other credential remains")
        .is_some());
    assert!(store
        .load(&other_identity.keyring_key("notion"))
        .expect("other identity credential remains")
        .is_some());
    server.abort();
}

#[tokio::test]
async fn search_uses_page_filter_bounded_page_size_and_opaque_cursors() {
    async fn search(
        State(requests): State<Arc<Mutex<Vec<Value>>>>,
        headers: HeaderMap,
        Json(request): Json<Value>,
    ) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        requests
            .lock()
            .expect("request log lock")
            .push(request.clone());
        let first = request.get("start_cursor").is_none();
        let pages = if first {
            vec![json!({
                "object": "page",
                "id": PAGE_ID,
                "url": "https://app.notion.com/p/Runbook-11111111111141118111111111111111",
                "properties": { "Name": { "title": [{ "plain_text": "Runbook" }] } }
            })]
        } else {
            vec![]
        };
        Ok(Json(json!({
            "results": pages,
            "has_more": first,
            "next_cursor": if first { Some("opaque-next-cursor".to_string()) } else { None }
        })))
    }
    let requests = Arc::new(Mutex::new(Vec::new()));
    let (origin, server) = serve(
        Router::new()
            .route("/search", post(search))
            .with_state(Arc::clone(&requests)),
    )
    .await;
    let store = MemoryCredentialStore::default();
    let adapter = NotionAdapter::for_test(&store, origin).expect("adapter builds");

    let first = adapter
        .search_pages(TEST_TOKEN, "runbook", None)
        .await
        .expect("first page");
    assert!(first.has_more);
    assert_eq!(first.next_cursor.as_deref(), Some("opaque-next-cursor"));
    assert_eq!(first.pages[0].id, PAGE_ID);
    assert_eq!(
        first.pages[0].url,
        "https://app.notion.com/p/Runbook-11111111111141118111111111111111"
    );
    let second = adapter
        .search_pages(TEST_TOKEN, "runbook", first.next_cursor.as_deref())
        .await
        .expect("second page");
    assert!(!second.has_more);
    let requests = requests.lock().expect("request log lock");
    assert_eq!(requests.len(), 2);
    assert_eq!(
        requests[0]["filter"],
        json!({ "property": "object", "value": "page" })
    );
    assert_eq!(requests[0]["page_size"], MAX_SEARCH_RESULTS);
    assert_eq!(requests[0]["query"], "runbook");
    assert_eq!(requests[1]["start_cursor"], "opaque-next-cursor");
    assert_eq!(MAX_SEARCH_RESULTS, 25);
    assert_eq!(PAGE_SIZE, 100);
    server.abort();
}

#[tokio::test]
async fn import_reads_text_only_uses_api_provenance_and_stops_at_depth_limit() {
    async fn page(Path(id): Path<String>, headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) || id != PAGE_ID {
            return Err(StatusCode::NOT_FOUND);
        }
        Ok(Json(page_payload(&id)))
    }
    async fn children(
        Path(id): Path<String>,
        Query(query): Query<HashMap<String, String>>,
        headers: HeaderMap,
        State(calls): State<BlockRequestLog>,
    ) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        calls
            .lock()
            .expect("block request log lock")
            .push((id.clone(), query.clone()));
        let results = if id == PAGE_ID {
            vec![
                block(BLOCK_ID, "paragraph", "Parent text", true),
                json!({ "id": DEEP_BLOCK_ID, "type": "image", "has_children": false, "image": { "type": "external" } }),
            ]
        } else if id == BLOCK_ID {
            vec![block(DEEP_BLOCK_ID, "heading_2", "Nested text", true)]
        } else {
            return Err(StatusCode::NOT_FOUND);
        };
        Ok(Json(
            json!({ "results": results, "has_more": false, "next_cursor": null }),
        ))
    }
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (origin, server) = serve(
        Router::new()
            .route("/pages/{id}", get(page))
            .route("/blocks/{id}/children", get(children))
            .with_state(Arc::clone(&calls)),
    )
    .await;
    let store = MemoryCredentialStore::default();
    let adapter = NotionAdapter::for_test(&store, origin).expect("adapter builds");

    let imported = adapter
        .import_page(TEST_TOKEN, PAGE_ID)
        .await
        .expect("selected page imports");
    assert_eq!(imported.title, "Operations handbook");
    assert_eq!(
        imported.url,
        "https://app.notion.com/p/Operations-handbook-11111111111141118111111111111111"
    );
    assert!(imported.content.contains("Parent text"));
    assert!(imported.content.contains("Nested text"));
    assert!(imported.truncated);
    assert!(imported.content.contains("some blocks were omitted"));
    let calls = calls.lock().expect("block request log lock");
    assert_eq!(calls.len(), 2, "depth-two children are not fetched");
    assert!(calls
        .iter()
        .all(|(_, query)| query.get("page_size").map(String::as_str) == Some("100")));
    server.abort();
}

#[tokio::test]
async fn import_caps_block_pagination_at_eight_requests() {
    async fn page(Path(id): Path<String>) -> Json<Value> {
        Json(page_payload(&id))
    }
    async fn children(
        headers: HeaderMap,
        Query(query): Query<HashMap<String, String>>,
        State(calls): State<Arc<AtomicUsize>>,
    ) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        calls.fetch_add(1, Ordering::SeqCst);
        let cursor = query
            .get("start_cursor")
            .cloned()
            .unwrap_or_else(|| "cursor-0".to_string());
        let next = format!(
            "cursor-{}",
            cursor
                .trim_start_matches("cursor-")
                .parse::<u8>()
                .unwrap_or(0)
                + 1
        );
        Ok(Json(
            json!({ "results": [], "has_more": true, "next_cursor": next }),
        ))
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let (origin, server) = serve(
        Router::new()
            .route("/pages/{id}", get(page))
            .route("/blocks/{id}/children", get(children))
            .with_state(Arc::clone(&calls)),
    )
    .await;
    let store = MemoryCredentialStore::default();
    let adapter = NotionAdapter::for_test(&store, origin).expect("adapter builds");

    let imported = adapter
        .import_page(TEST_TOKEN, PAGE_ID)
        .await
        .expect("bounded import");
    assert!(imported.truncated);
    assert_eq!(calls.load(Ordering::SeqCst), MAX_CHILDREN_PAGES);
    server.abort();
}

#[tokio::test]
async fn imported_page_text_is_capped_in_utf16_units() {
    async fn page(Path(id): Path<String>) -> Json<Value> {
        Json(page_payload(&id))
    }
    async fn children(headers: HeaderMap) -> Result<Json<Value>, StatusCode> {
        if !authorized(&headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        let long_text = "🌱".repeat(20_005);
        Ok(Json(json!({
            "results": [block(BLOCK_ID, "paragraph", &long_text, false)],
            "has_more": false,
            "next_cursor": null
        })))
    }
    let (origin, server) = serve(
        Router::new()
            .route("/pages/{id}", get(page))
            .route("/blocks/{id}/children", get(children)),
    )
    .await;
    let store = MemoryCredentialStore::default();
    let adapter = NotionAdapter::for_test(&store, origin).expect("adapter builds");

    let imported = adapter
        .import_page(TEST_TOKEN, PAGE_ID)
        .await
        .expect("truncated page imports");
    assert!(imported.truncated);
    assert!(imported.content.encode_utf16().count() <= 40_000);
    assert!(imported.content.contains("limits were reached"));
    assert!(!imported.content.contains('\u{fffd}'));
    server.abort();
}

#[tokio::test]
async fn oversized_page_metadata_and_slow_imports_are_bounded() {
    async fn oversized() -> Response<Body> {
        Response::builder()
            .status(StatusCode::OK)
            .body(Body::from(format!(
                "{{\"object\":\"page\",\"padding\":\"{}\"}}",
                "x".repeat(512 * 1024)
            )))
            .expect("oversized fixture response")
    }
    let (origin, server) = serve(Router::new().route("/pages/{id}", get(oversized))).await;
    let store = MemoryCredentialStore::default();
    let adapter = NotionAdapter::for_test(&store, origin).expect("adapter builds");
    assert_eq!(
        adapter.import_page(TEST_TOKEN, PAGE_ID).await.unwrap_err(),
        NotionConnectionError::ResponseTooLarge
    );
    server.abort();

    async fn slow_page(Path(id): Path<String>) -> Json<Value> {
        tokio::time::sleep(Duration::from_millis(150)).await;
        Json(page_payload(&id))
    }
    let (origin, server) = serve(Router::new().route("/pages/{id}", get(slow_page))).await;
    let timed_adapter =
        NotionAdapter::for_test_with_timeout(&store, origin, Duration::from_millis(20))
            .expect("timed adapter builds");
    assert_eq!(
        timed_adapter
            .import_page(TEST_TOKEN, PAGE_ID)
            .await
            .unwrap_err(),
        NotionConnectionError::Timeout
    );
    server.abort();
}

#[test]
fn page_ids_are_normalized_and_malformed_ids_are_denied() {
    assert_eq!(
        normalize_uuid("11111111111141118111111111111111").as_deref(),
        Some(PAGE_ID)
    );
    assert!(normalize_uuid("---11111111111141118111111111111111-").is_none());
    assert!(normalize_uuid("not-a-page-id").is_none());
}

#[test]
fn provenance_urls_must_match_the_selected_page_and_notion_hosts() {
    let valid = "https://app.notion.com/p/Runbook-11111111111141118111111111111111";
    assert_eq!(safe_page_url(PAGE_ID, valid).as_deref(), Some(valid));
    let valid_hyphenated_id =
        "https://www.notion.so/workspace/Runbook-11111111-1111-4111-8111-111111111111";
    assert_eq!(
        safe_page_url(PAGE_ID, valid_hyphenated_id).as_deref(),
        Some(valid_hyphenated_id)
    );
    for url in [
        "https://attacker.example/p/Runbook-11111111111141118111111111111111",
        "https://app.notion.com/p/Runbook-22222222222242228222222222222222",
        "https://app.notion.com/p/Runbook-11111111111141118111111111111111?redirect=https://attacker.example",
        "https://user:pass@app.notion.com/p/Runbook-11111111111141118111111111111111",
    ] {
        assert!(safe_page_url(PAGE_ID, url).is_none(), "accepted {url}");
    }
}
