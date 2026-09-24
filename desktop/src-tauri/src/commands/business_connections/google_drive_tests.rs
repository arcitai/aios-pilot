use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{Form, Path, Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::{json, Value};
use sha2::Digest as _;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Notify,
};
use url::Url;

use super::{
    build_authorization_url, build_list_url, parse_callback_request, validate_configured_client_id,
    validate_token_response, GoogleConnectionError, GoogleDriveAdapter, OAuthTokenResponse,
    StoredGoogleCredential, DRIVE_READONLY_SCOPE, GOOGLE_DOC_MIME_TYPE,
};
use crate::commands::business_connections::{adapter::CredentialStore, scope::ConnectionScope};

const CLIENT_ID: &str = "123456789012-exampleclient.apps.googleusercontent.com";
const ACCESS_TOKEN: &str = "fixture-access-token-0123456789";
const REFRESH_TOKEN: &str = "fixture-refresh-token-0123456789";

#[derive(Default)]
struct MemoryCredentials(Mutex<HashMap<String, String>>);

impl CredentialStore for MemoryCredentials {
    fn load(&self, key: &str) -> Result<Option<String>, String> {
        self.0
            .lock()
            .map(|credentials| credentials.get(key).cloned())
            .map_err(|_| "fixture lock failed".to_string())
    }

    fn store(&self, key: &str, value: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "fixture lock failed".to_string())?
            .insert(key.to_string(), value.to_string());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "fixture lock failed".to_string())?
            .remove(key);
        Ok(())
    }
}

#[derive(Default)]
struct FixtureCapture {
    list_query: Option<HashMap<String, String>>,
    export_query: Option<HashMap<String, String>>,
    token_form: Option<HashMap<String, String>>,
    authorization_headers: Vec<String>,
}

#[derive(Clone)]
struct FixtureState {
    capture: Arc<Mutex<FixtureCapture>>,
    exported_text: Arc<String>,
    metadata_mime_type: Arc<String>,
    control: Arc<FixtureControl>,
}

#[derive(Default)]
struct FixtureControl {
    hold_first_authorization_code: AtomicBool,
    hold_refresh: AtomicBool,
    authorization_code_requests: AtomicUsize,
    authorization_started: Notify,
    release_authorization: Notify,
    refresh_started: Notify,
    release_refresh: Notify,
}

fn record_authorization(state: &FixtureState, headers: &HeaderMap) {
    if let Some(value) = headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(value) = value.to_str() {
            if let Ok(mut capture) = state.capture.lock() {
                capture.authorization_headers.push(value.to_string());
            }
        }
    }
}

async fn about(State(state): State<FixtureState>, headers: HeaderMap) -> Json<Value> {
    record_authorization(&state, &headers);
    Json(json!({ "kind": "drive#about" }))
}

async fn list_files(
    State(state): State<FixtureState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    record_authorization(&state, &headers);
    if let Ok(mut capture) = state.capture.lock() {
        capture.list_query = Some(query);
    }
    Json(json!({
        "files": [
            {
                "id": "doc-123",
                "name": "Runbook",
                "mimeType": GOOGLE_DOC_MIME_TYPE,
                "modifiedTime": "2026-09-23T12:30:00Z"
            },
            {
                "id": "spreadsheet-1",
                "name": "Sheet",
                "mimeType": "application/vnd.google-apps.spreadsheet"
            },
            {
                "id": "trashed-doc",
                "name": "Old Doc",
                "mimeType": GOOGLE_DOC_MIME_TYPE,
                "trashed": true
            }
        ],
        "nextPageToken": "fixture-next-page-token"
    }))
}

async fn file_metadata(
    State(state): State<FixtureState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Json<Value> {
    record_authorization(&state, &headers);
    Json(json!({
        "id": id,
        "name": "Runbook",
        "mimeType": state.metadata_mime_type.as_str(),
        "modifiedTime": "2026-09-23T12:30:00Z",
        "trashed": false
    }))
}

async fn export_file(
    State(state): State<FixtureState>,
    Path(_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> String {
    record_authorization(&state, &headers);
    if let Ok(mut capture) = state.capture.lock() {
        capture.export_query = Some(query);
    }
    state.exported_text.as_str().to_string()
}

async fn refresh_token(
    State(state): State<FixtureState>,
    Form(form): Form<HashMap<String, String>>,
) -> Json<Value> {
    let grant_type = form.get("grant_type").cloned().unwrap_or_default();
    if let Ok(mut capture) = state.capture.lock() {
        capture.token_form = Some(form);
    }
    if grant_type == "authorization_code" {
        let request_index = state
            .control
            .authorization_code_requests
            .fetch_add(1, Ordering::SeqCst);
        if request_index == 0
            && state
                .control
                .hold_first_authorization_code
                .load(Ordering::SeqCst)
        {
            state.control.authorization_started.notify_one();
            state.control.release_authorization.notified().await;
        }
        Json(json!({
            "access_token": if request_index == 0 {
                "fixture-first-connected-access-token-012345"
            } else {
                "fixture-second-connected-access-token-012345"
            },
            "refresh_token": REFRESH_TOKEN,
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": DRIVE_READONLY_SCOPE
        }))
    } else {
        if state.control.hold_refresh.load(Ordering::SeqCst) {
            state.control.refresh_started.notify_one();
            state.control.release_refresh.notified().await;
        }
        Json(json!({
            "access_token": "fixture-refreshed-access-token-012345",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": DRIVE_READONLY_SCOPE
        }))
    }
}

async fn fixture_server(
    exported_text: String,
    metadata_mime_type: &str,
) -> (Url, Url, FixtureState) {
    fixture_server_controlled(
        exported_text,
        metadata_mime_type,
        Arc::new(FixtureControl::default()),
    )
    .await
}

async fn fixture_server_controlled(
    exported_text: String,
    metadata_mime_type: &str,
    control: Arc<FixtureControl>,
) -> (Url, Url, FixtureState) {
    let state = FixtureState {
        capture: Arc::new(Mutex::new(FixtureCapture::default())),
        exported_text: Arc::new(exported_text),
        metadata_mime_type: Arc::new(metadata_mime_type.to_string()),
        control,
    };
    let router = Router::new()
        .route("/drive/v3/about", get(about))
        .route("/drive/v3/files", get(list_files))
        .route("/drive/v3/files/{id}", get(file_metadata))
        .route("/drive/v3/files/{id}/export", get(export_file))
        .route("/token", axum::routing::post(refresh_token))
        .with_state(state.clone());
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("fixture listener binds");
    let address = listener.local_addr().expect("fixture address is available");
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    (
        Url::parse(&format!("http://{address}/drive/v3/")).expect("fixture Drive URL"),
        Url::parse(&format!("http://{address}/")).expect("fixture OAuth URL"),
        state,
    )
}

fn scope(relay: &str, pubkey_byte: char) -> ConnectionScope {
    ConnectionScope::new(relay.to_string(), pubkey_byte.to_string().repeat(64))
        .expect("fixture scope is valid")
}

fn credential_json(access_expires_at: u64) -> String {
    serde_json::to_string(&StoredGoogleCredential {
        version: 1,
        client_id: CLIENT_ID.to_string(),
        access_token: ACCESS_TOKEN.to_string(),
        refresh_token: REFRESH_TOKEN.to_string(),
        access_expires_at,
        refresh_expires_at: None,
        scope: DRIVE_READONLY_SCOPE.to_string(),
    })
    .expect("fixture credential serializes")
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock is after epoch")
        .as_secs()
}

type CallbackTask = tokio::task::JoinHandle<Result<(), std::io::Error>>;
type CallbackTaskSlot = Arc<Mutex<Option<CallbackTask>>>;

fn fixture_browser_opener(callback_task: CallbackTaskSlot) -> impl FnOnce(&str) -> Result<(), ()> {
    move |authorization_url| {
        let url = Url::parse(authorization_url).map_err(|_| ())?;
        let params = url
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<HashMap<_, _>>();
        let redirect_uri = params.get("redirect_uri").ok_or(())?;
        let redirect = Url::parse(redirect_uri).map_err(|_| ())?;
        let port = redirect.port().ok_or(())?;
        let state = params.get("state").ok_or(())?.clone();
        let task = tokio::spawn(async move {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).await?;
            let request = format!(
                "GET /?code=fixture-authorization-code&state={state}&scope={DRIVE_READONLY_SCOPE} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(request.as_bytes()).await?;
            let mut response = Vec::new();
            stream.read_to_end(&mut response).await?;
            Ok::<(), std::io::Error>(())
        });
        if let Ok(mut captured) = callback_task.lock() {
            *captured = Some(task);
        }
        Ok(())
    }
}

async fn join_fixture_callback(callback_task: &CallbackTaskSlot) {
    let task = callback_task
        .lock()
        .expect("callback task slot is readable")
        .take()
        .expect("callback task was started");
    task.await
        .expect("callback task joins")
        .expect("callback request succeeds");
}

#[test]
fn oauth_url_requests_only_readonly_drive_and_binds_pkce_state() {
    let verifier = "v".repeat(43);
    let state = "s".repeat(43);
    let url = build_authorization_url(CLIENT_ID, "http://127.0.0.1:43123", &state, &verifier)
        .expect("OAuth URL is valid");
    let pairs = url.query_pairs().collect::<HashMap<_, _>>();
    let challenge = URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(verifier.as_bytes()));
    assert_eq!(
        pairs.get("scope").map(|value| value.as_ref()),
        Some(DRIVE_READONLY_SCOPE)
    );
    assert_eq!(
        pairs.get("state").map(|value| value.as_ref()),
        Some(state.as_str())
    );
    assert_eq!(
        pairs.get("code_challenge").map(|value| value.as_ref()),
        Some(challenge.as_str())
    );
    assert_eq!(
        pairs
            .get("code_challenge_method")
            .map(|value| value.as_ref()),
        Some("S256")
    );
    assert_eq!(
        pairs.get("access_type").map(|value| value.as_ref()),
        Some("offline")
    );
    assert!(!pairs.contains_key("client_secret"));
    assert!(!pairs.contains_key("drive.file"));
    assert!(!pairs.contains_key("openid"));
}

#[tokio::test]
async fn connect_uses_loopback_pkce_exchange_and_saves_only_after_verification() {
    let (drive_origin, oauth_origin, fixture) =
        fixture_server("text".to_string(), GOOGLE_DOC_MIME_TYPE).await;
    let store = MemoryCredentials::default();
    let scope = scope("wss://pkce-connect.example", 'a');
    let adapter = GoogleDriveAdapter::for_test(&store, drive_origin, oauth_origin)
        .expect("fixture adapter builds");
    let authorization = Arc::new(Mutex::new(None::<HashMap<String, String>>));
    let callback_task = Arc::new(Mutex::new(None));
    let captured_authorization = Arc::clone(&authorization);
    let captured_callback_task = Arc::clone(&callback_task);

    adapter
            .connect(&scope, CLIENT_ID, move |authorization_url| {
                let url = Url::parse(authorization_url).map_err(|_| ())?;
                let params = url
                    .query_pairs()
                    .map(|(key, value)| (key.into_owned(), value.into_owned()))
                    .collect::<HashMap<_, _>>();
                let redirect_uri = params.get("redirect_uri").ok_or(())?;
                let redirect = Url::parse(redirect_uri).map_err(|_| ())?;
                let port = redirect.port().ok_or(())?;
                let state = params.get("state").ok_or(())?.clone();
                let task = tokio::spawn(async move {
                    let mut stream = TcpStream::connect(("127.0.0.1", port)).await?;
                    let request = format!(
                        "GET /?code=fixture-authorization-code&state={state}&scope={DRIVE_READONLY_SCOPE} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
                    );
                    stream.write_all(request.as_bytes()).await?;
                    let mut response = Vec::new();
                    stream.read_to_end(&mut response).await?;
                    Ok::<(), std::io::Error>(())
                });
                if let Ok(mut captured) = captured_authorization.lock() {
                    *captured = Some(params);
                }
                if let Ok(mut captured) = captured_callback_task.lock() {
                    *captured = Some(task);
                }
                Ok(())
            }, || Ok(()))
            .await
            .expect("local OAuth fixture completes");

    let task = callback_task
        .lock()
        .expect("callback task is readable")
        .take()
        .expect("callback task was started");
    task.await
        .expect("callback task joins")
        .expect("callback request succeeds");
    let auth_params = authorization
        .lock()
        .expect("authorization capture is readable")
        .clone()
        .expect("authorization URL was captured");
    let token_form = fixture
        .capture
        .lock()
        .expect("fixture capture is readable")
        .token_form
        .clone()
        .expect("authorization code exchange was captured");
    assert_eq!(token_form["grant_type"], "authorization_code");
    assert_eq!(token_form["code"], "fixture-authorization-code");
    assert_eq!(token_form["client_id"], CLIENT_ID);
    assert!(!token_form.contains_key("client_secret"));
    assert_eq!(token_form["redirect_uri"], auth_params["redirect_uri"]);
    let expected_challenge =
        URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(token_form["code_verifier"].as_bytes()));
    assert_eq!(auth_params["code_challenge"], expected_challenge);
    assert_eq!(auth_params["scope"], DRIVE_READONLY_SCOPE);

    let stored = store
        .load(&scope.keyring_key("google"))
        .expect("credential loads")
        .expect("verified credential is saved");
    let stored: StoredGoogleCredential =
        serde_json::from_str(&stored).expect("stored credential parses");
    assert_eq!(stored.scope, DRIVE_READONLY_SCOPE);
    assert_eq!(stored.refresh_token, REFRESH_TOKEN);
    assert_eq!(
        stored.access_token,
        "fixture-first-connected-access-token-012345"
    );
}

#[test]
fn callback_requires_the_matching_state_host_and_unique_parameters() {
    let state = "fixture-state-012345678901234567890123456789012345";
    let request = format!(
            "GET /?code=fixture-code&state={state}&scope={DRIVE_READONLY_SCOPE} HTTP/1.1\r\nHost: 127.0.0.1:43123\r\nConnection: close\r\n\r\n"
        );
    let peer = "127.0.0.1:50123".parse().expect("loopback peer parses");
    assert_eq!(
        parse_callback_request(request.as_bytes(), peer, 43123, state)
            .expect("valid callback accepted"),
        "fixture-code"
    );
    assert_eq!(
        parse_callback_request(request.as_bytes(), peer, 43123, "wrong-state"),
        Err(GoogleConnectionError::InvalidAuthorization)
    );
    let duplicate = request.replace("code=fixture-code&", "code=first&code=second&");
    assert_eq!(
        parse_callback_request(duplicate.as_bytes(), peer, 43123, state),
        Err(GoogleConnectionError::InvalidAuthorization)
    );
    let wrong_host = request.replace("127.0.0.1:43123", "127.0.0.1:43124");
    assert_eq!(
        parse_callback_request(wrong_host.as_bytes(), peer, 43123, state),
        Err(GoogleConnectionError::Callback)
    );
    let non_loopback = "192.0.2.10:50123".parse().expect("peer parses");
    assert_eq!(
        parse_callback_request(request.as_bytes(), non_loopback, 43123, state),
        Err(GoogleConnectionError::Callback)
    );
}

#[test]
fn public_oauth_client_id_is_validated_before_storage_or_browser_use() {
    assert!(validate_configured_client_id(CLIENT_ID).is_ok());
    for invalid in [
        "123456789012-exampleclient.apps.googleusercontent.com.evil.test",
        "client-secret.apps.googleusercontent.com",
        "https://example.test/client.apps.googleusercontent.com",
        "123456789012-example client.apps.googleusercontent.com",
    ] {
        assert_eq!(
            validate_configured_client_id(invalid),
            Err(GoogleConnectionError::InvalidClientId)
        );
    }
}

#[test]
fn token_response_rejects_extra_scopes_and_missing_offline_refresh_token() {
    let extra_scope = OAuthTokenResponse {
        access_token: ACCESS_TOKEN.to_string(),
        token_type: "Bearer".to_string(),
        expires_in: 3600,
        refresh_token: Some(REFRESH_TOKEN.to_string()),
        refresh_token_expires_in: None,
        scope: Some(format!(
            "{DRIVE_READONLY_SCOPE} https://www.googleapis.com/auth/userinfo.email"
        )),
    };
    assert_eq!(
        validate_token_response(&extra_scope, true),
        Err(GoogleConnectionError::ScopeMismatch)
    );

    let missing_refresh = OAuthTokenResponse {
        access_token: ACCESS_TOKEN.to_string(),
        token_type: "Bearer".to_string(),
        expires_in: 3600,
        refresh_token: None,
        refresh_token_expires_in: None,
        scope: Some(DRIVE_READONLY_SCOPE.to_string()),
    };
    assert_eq!(
        validate_token_response(&missing_refresh, true),
        Err(GoogleConnectionError::InvalidResponse)
    );
}

#[test]
fn drive_list_query_escapes_input_and_pins_docs_and_untrashed_files() {
    let origin = Url::parse("https://www.googleapis.com/drive/v3/").expect("Drive API URL parses");
    let client = super::ProviderHttpClient::new(origin).expect("Drive client builds");
    let url = build_list_url(&client, "Bob's \\ plan", Some("opaque-cursor"))
        .expect("safe Drive query builds");
    let params = url.query_pairs().collect::<HashMap<_, _>>();
    assert_eq!(
            params.get("q").map(|value| value.as_ref()),
            Some("name contains 'Bob\\'s \\\\ plan' and mimeType = 'application/vnd.google-apps.document' and trashed = false")
        );
    assert_eq!(
        params.get("pageSize").map(|value| value.as_ref()),
        Some("25")
    );
    assert_eq!(
        params.get("pageToken").map(|value| value.as_ref()),
        Some("opaque-cursor")
    );
    assert_eq!(
        build_list_url(&client, "  ", None).err(),
        Some(GoogleConnectionError::InvalidQuery)
    );
    assert_eq!(
        build_list_url(&client, "Runbook", Some("invalid\ncursor")).err(),
        Some(GoogleConnectionError::InvalidCursor)
    );
}

#[tokio::test]
async fn status_search_and_import_use_bounded_readonly_fixture_requests() {
    let (drive_origin, oauth_origin, fixture) = fixture_server(
        "# Selected text\nOnly this document".to_string(),
        GOOGLE_DOC_MIME_TYPE,
    )
    .await;
    let store = MemoryCredentials::default();
    let scope = scope("wss://search-import.example", 'b');
    store
        .store(&scope.keyring_key("google"), &credential_json(now() + 3600))
        .expect("seed scoped credential");
    let adapter = GoogleDriveAdapter::for_test(&store, drive_origin, oauth_origin)
        .expect("fixture adapter builds");

    assert!(
        adapter
            .status(&scope)
            .await
            .expect("status verifies")
            .connected
    );
    let page = adapter
        .search_files(&scope, "Runbook", None)
        .await
        .expect("bounded Drive search succeeds");
    assert_eq!(page.files.len(), 1);
    assert_eq!(page.files[0].id, "doc-123");
    assert_eq!(
        page.files[0].url,
        "https://docs.google.com/document/d/doc-123/edit"
    );
    assert!(page.has_more);

    let imported = adapter
        .import_document(&scope, "doc-123")
        .await
        .expect("selected Docs export succeeds");
    assert_eq!(imported.title, "Runbook");
    assert_eq!(imported.content, "# Selected text\nOnly this document");
    assert_eq!(
        imported.url,
        "https://docs.google.com/document/d/doc-123/edit"
    );
    assert!(!imported.truncated);

    let capture = fixture.capture.lock().expect("fixture capture is readable");
    let list_query = capture.list_query.as_ref().expect("list request captured");
    assert!(list_query["q"].contains("mimeType = 'application/vnd.google-apps.document'"));
    assert!(list_query["q"].contains("trashed = false"));
    assert_eq!(list_query["corpora"], "user");
    assert_eq!(list_query["spaces"], "drive");
    assert_eq!(list_query["pageSize"], "25");
    assert_eq!(
        capture
            .export_query
            .as_ref()
            .and_then(|query| query.get("mimeType"))
            .map(String::as_str),
        Some("text/plain")
    );
    assert_eq!(capture.authorization_headers.len(), 4);
    assert!(capture
        .authorization_headers
        .iter()
        .all(|header| header == &format!("Bearer {ACCESS_TOKEN}")));
}

#[tokio::test]
async fn refresh_form_omits_client_secret_and_preserves_refresh_token() {
    let (drive_origin, oauth_origin, fixture) =
        fixture_server("text".to_string(), GOOGLE_DOC_MIME_TYPE).await;
    let store = MemoryCredentials::default();
    let scope = scope("wss://refresh-success.example", 'f');
    store
        .store(
            &scope.keyring_key("google"),
            &credential_json(now().saturating_sub(1)),
        )
        .expect("seed expired access credential");
    let adapter = GoogleDriveAdapter::for_test(&store, drive_origin, oauth_origin)
        .expect("fixture adapter builds");

    assert!(
        adapter
            .status(&scope)
            .await
            .expect("refresh and status work")
            .connected
    );
    let token_form = fixture
        .capture
        .lock()
        .expect("fixture capture is readable")
        .token_form
        .clone()
        .expect("refresh request captured");
    assert_eq!(token_form["grant_type"], "refresh_token");
    assert_eq!(token_form["refresh_token"], REFRESH_TOKEN);
    assert_eq!(token_form["client_id"], CLIENT_ID);
    assert!(!token_form.contains_key("client_secret"));

    let stored = store
        .load(&scope.keyring_key("google"))
        .expect("credential loads")
        .expect("credential remains stored");
    let stored: StoredGoogleCredential =
        serde_json::from_str(&stored).expect("stored refresh result parses");
    assert_eq!(stored.access_token, "fixture-refreshed-access-token-012345");
    assert_eq!(stored.refresh_token, REFRESH_TOKEN);
}

#[tokio::test]
async fn revoke_invalidates_a_delayed_refresh_across_adapter_instances() {
    let control = Arc::new(FixtureControl::default());
    control.hold_refresh.store(true, Ordering::SeqCst);
    let (drive_origin, oauth_origin, _fixture) = fixture_server_controlled(
        "text".to_string(),
        GOOGLE_DOC_MIME_TYPE,
        Arc::clone(&control),
    )
    .await;
    let store = MemoryCredentials::default();
    let scope = scope("wss://delayed-refresh-revoke.example", 'd');
    store
        .store(
            &scope.keyring_key("google"),
            &credential_json(now().saturating_sub(1)),
        )
        .expect("seed expired access credential");
    let refreshing =
        GoogleDriveAdapter::for_test(&store, drive_origin.clone(), oauth_origin.clone())
            .expect("refresh adapter builds");
    let revoking = GoogleDriveAdapter::for_test(&store, drive_origin, oauth_origin)
        .expect("revocation adapter builds");

    let mut status = Box::pin(refreshing.status(&scope));
    let mut refresh_entered = Box::pin(tokio::time::timeout(
        Duration::from_secs(3),
        control.refresh_started.notified(),
    ));
    tokio::select! {
        result = &mut status => panic!("refresh completed before the fixture gate: {result:?}"),
        result = &mut refresh_entered => result.expect("refresh request reached fixture"),
    }

    revoking
        .revoke(&scope)
        .expect("revoke deletes the scoped key");
    control.release_refresh.notify_one();
    assert_eq!(
        status.await,
        Err(GoogleConnectionError::OperationSuperseded)
    );
    assert!(store
        .load(&scope.keyring_key("google"))
        .expect("keyring can be checked after refresh")
        .is_none());
}

#[tokio::test]
async fn revoke_invalidates_delayed_oauth_connect_before_it_can_save() {
    let control = Arc::new(FixtureControl::default());
    control
        .hold_first_authorization_code
        .store(true, Ordering::SeqCst);
    let (drive_origin, oauth_origin, _fixture) = fixture_server_controlled(
        "text".to_string(),
        GOOGLE_DOC_MIME_TYPE,
        Arc::clone(&control),
    )
    .await;
    let store = MemoryCredentials::default();
    let scope = scope("wss://delayed-connect-revoke.example", 'd');
    let connecting =
        GoogleDriveAdapter::for_test(&store, drive_origin.clone(), oauth_origin.clone())
            .expect("connect adapter builds");
    let revoking = GoogleDriveAdapter::for_test(&store, drive_origin, oauth_origin)
        .expect("revocation adapter builds");
    let callback_task = Arc::new(Mutex::new(None));
    let mut connect = Box::pin(connecting.connect(
        &scope,
        CLIENT_ID,
        fixture_browser_opener(Arc::clone(&callback_task)),
        || Ok(()),
    ));
    let mut exchange_entered = Box::pin(tokio::time::timeout(
        Duration::from_secs(3),
        control.authorization_started.notified(),
    ));
    tokio::select! {
        result = &mut connect => panic!("connect completed before the fixture gate: {result:?}"),
        result = &mut exchange_entered => result.expect("token exchange reached fixture"),
    }

    revoking
        .revoke(&scope)
        .expect("revoke deletes the scoped key");
    control.release_authorization.notify_one();
    assert_eq!(
        connect.await,
        Err(GoogleConnectionError::OperationSuperseded)
    );
    join_fixture_callback(&callback_task).await;
    assert!(store
        .load(&scope.keyring_key("google"))
        .expect("keyring can be checked after connect")
        .is_none());
}

#[tokio::test]
async fn newer_connect_generation_wins_when_older_oauth_response_is_delayed() {
    let control = Arc::new(FixtureControl::default());
    control
        .hold_first_authorization_code
        .store(true, Ordering::SeqCst);
    let (drive_origin, oauth_origin, _fixture) = fixture_server_controlled(
        "text".to_string(),
        GOOGLE_DOC_MIME_TYPE,
        Arc::clone(&control),
    )
    .await;
    let store = MemoryCredentials::default();
    let scope = scope("wss://overlapping-connects.example", 'e');
    let older = GoogleDriveAdapter::for_test(&store, drive_origin.clone(), oauth_origin.clone())
        .expect("older adapter builds");
    let newer = GoogleDriveAdapter::for_test(&store, drive_origin, oauth_origin)
        .expect("newer adapter builds");
    let older_callback = Arc::new(Mutex::new(None));
    let newer_callback = Arc::new(Mutex::new(None));
    let mut older_connect = Box::pin(older.connect(
        &scope,
        CLIENT_ID,
        fixture_browser_opener(Arc::clone(&older_callback)),
        || Ok(()),
    ));
    let mut older_exchange_entered = Box::pin(tokio::time::timeout(
        Duration::from_secs(3),
        control.authorization_started.notified(),
    ));
    tokio::select! {
        result = &mut older_connect => panic!("older connect completed before the fixture gate: {result:?}"),
        result = &mut older_exchange_entered => result.expect("older exchange reached fixture"),
    }

    newer
        .connect(
            &scope,
            CLIENT_ID,
            fixture_browser_opener(Arc::clone(&newer_callback)),
            || Ok(()),
        )
        .await
        .expect("newer connect saves its credential");
    join_fixture_callback(&newer_callback).await;

    control.release_authorization.notify_one();
    assert_eq!(
        older_connect.await,
        Err(GoogleConnectionError::OperationSuperseded)
    );
    join_fixture_callback(&older_callback).await;
    let stored = store
        .load(&scope.keyring_key("google"))
        .expect("new credential remains readable")
        .expect("new credential remains stored");
    let stored: StoredGoogleCredential =
        serde_json::from_str(&stored).expect("new credential parses");
    assert_eq!(
        stored.access_token,
        "fixture-second-connected-access-token-012345"
    );
}

#[tokio::test]
async fn connect_checks_active_scope_before_persisting_oauth_credentials() {
    let (drive_origin, oauth_origin, _fixture) =
        fixture_server("text".to_string(), GOOGLE_DOC_MIME_TYPE).await;
    let store = MemoryCredentials::default();
    let scope = scope("wss://active-scope-check.example", 'f');
    let adapter = GoogleDriveAdapter::for_test(&store, drive_origin, oauth_origin)
        .expect("fixture adapter builds");
    let callback_task = Arc::new(Mutex::new(None));

    assert_eq!(
        adapter
            .connect(
                &scope,
                CLIENT_ID,
                fixture_browser_opener(Arc::clone(&callback_task)),
                || Err(GoogleConnectionError::ActiveScopeChanged),
            )
            .await,
        Err(GoogleConnectionError::ActiveScopeChanged)
    );
    join_fixture_callback(&callback_task).await;
    assert!(store
        .load(&scope.keyring_key("google"))
        .expect("keyring can be checked after active-scope rejection")
        .is_none());
}

#[tokio::test]
async fn import_rejects_non_docs_and_oversized_exports() {
    let (drive_origin, oauth_origin, _fixture) = fixture_server(
        "text".to_string(),
        "application/vnd.google-apps.spreadsheet",
    )
    .await;
    let store = MemoryCredentials::default();
    let scope = scope("wss://import-reject.example", 'c');
    store
        .store(&scope.keyring_key("google"), &credential_json(now() + 3600))
        .expect("seed scoped credential");
    let adapter = GoogleDriveAdapter::for_test(&store, drive_origin, oauth_origin)
        .expect("fixture adapter builds");
    assert_eq!(
        adapter.import_document(&scope, "doc-123").await,
        Err(GoogleConnectionError::NotGoogleDoc)
    );

    let (drive_origin, oauth_origin, _fixture) = fixture_server(
        "x".repeat(super::MAX_GOOGLE_DOC_BYTES + 1),
        GOOGLE_DOC_MIME_TYPE,
    )
    .await;
    let oversized_adapter = GoogleDriveAdapter::for_test(&store, drive_origin, oauth_origin)
        .expect("oversized fixture adapter builds");
    assert_eq!(
        oversized_adapter.import_document(&scope, "doc-123").await,
        Err(GoogleConnectionError::ResponseTooLarge)
    );
}

#[tokio::test]
async fn credential_entries_are_scoped_and_disconnect_is_local() {
    let (drive_origin, oauth_origin, _fixture) =
        fixture_server("text".to_string(), GOOGLE_DOC_MIME_TYPE).await;
    let store = MemoryCredentials::default();
    let first = scope("wss://credential-scope-a.example", 'a');
    let second = scope("wss://credential-scope-b.example", 'a');
    store
        .store(&first.keyring_key("google"), &credential_json(now() + 3600))
        .expect("seed first scoped credential");
    let adapter = GoogleDriveAdapter::for_test(&store, drive_origin, oauth_origin)
        .expect("fixture adapter builds");
    assert!(
        !adapter
            .status(&second)
            .await
            .expect("other scope is empty")
            .connected
    );
    adapter
        .revoke(&first)
        .expect("local scoped disconnect succeeds");
    assert!(store
        .load(&first.keyring_key("google"))
        .expect("first scope can be read")
        .is_none());
    assert!(store
        .load(&second.keyring_key("google"))
        .expect("second scope can be read")
        .is_none());
}

#[test]
fn callback_host_and_query_parser_require_one_http_request() {
    let peer = "127.0.0.1:50123".parse().expect("loopback peer parses");
    let state = "one-use-state-value-long-enough-for-test";
    let body = format!(
            "GET /?code=fixture-code&state={state}&unexpected=value HTTP/1.1\r\nHost: 127.0.0.1:43123\r\n\r\n"
        );
    assert_eq!(
        parse_callback_request(body.as_bytes(), peer, 43123, state),
        Err(GoogleConnectionError::InvalidAuthorization)
    );
    let non_get = body.replace("GET /", "POST /");
    assert_eq!(
        parse_callback_request(non_get.as_bytes(), peer, 43123, state),
        Err(GoogleConnectionError::Callback)
    );
}
