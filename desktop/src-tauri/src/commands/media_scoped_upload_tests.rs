use axum::{
    body::Bytes,
    extract::{OriginalUri, State as AxumState},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::put,
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use nostr::{JsonUtil, Keys};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tokio::sync::Notify;

use super::super::{extract_server_authority, upload_prepared_media};
use super::ScopedMediaUpload;

#[derive(Clone)]
struct ScopedUploadServerState {
    base: String,
    uploads: Arc<Mutex<Vec<ObservedUpload>>>,
    gate_first_upload: bool,
    first_upload_entered: Arc<Notify>,
    release_first_upload: Arc<Notify>,
}

#[derive(Debug)]
struct ObservedUpload {
    path: String,
    signer: String,
    server_tag: Option<String>,
    hash_tag: Option<String>,
}

struct ScopedUploadServer {
    state: ScopedUploadServerState,
    relay_url: String,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for ScopedUploadServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn scoped_upload_request(
    AxumState(state): AxumState<ScopedUploadServerState>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let encoded = headers["authorization"]
        .to_str()
        .unwrap()
        .strip_prefix("Nostr ")
        .unwrap();
    let auth_json = URL_SAFE_NO_PAD.decode(encoded).unwrap();
    let event = nostr::Event::from_json(std::str::from_utf8(&auth_json).unwrap()).unwrap();
    event.verify().unwrap();
    let tag_value = |name: &str| {
        event.tags.iter().find_map(|tag| {
            let fields = tag.as_slice();
            (fields.first().map(String::as_str) == Some(name)).then(|| fields[1].clone())
        })
    };
    let path = uri.path().to_string();
    let first_request = {
        let mut uploads = state.uploads.lock().unwrap();
        let first = uploads.is_empty();
        uploads.push(ObservedUpload {
            path: path.clone(),
            signer: event.pubkey.to_hex(),
            server_tag: tag_value("server"),
            hash_tag: tag_value("x"),
        });
        first
    };

    if path == "/upload" {
        if state.gate_first_upload && first_request {
            state.first_upload_entered.notify_one();
            state.release_first_upload.notified().await;
        }
        return StatusCode::NOT_FOUND.into_response();
    }
    if path != "/media/upload" {
        return StatusCode::NOT_FOUND.into_response();
    }

    let hash = hex::encode(Sha256::digest(&body));
    let mime = headers["content-type"].to_str().unwrap();
    Json(serde_json::json!({
        "url": format!("{}/media/{hash}.png", state.base),
        "sha256": hash,
        "size": body.len(),
        "type": mime,
        "uploaded": 1
    }))
    .into_response()
}

async fn scoped_upload_server(gate_first_upload: bool) -> ScopedUploadServer {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let relay_url = format!("ws{}", base.strip_prefix("http").unwrap());
    let state = ScopedUploadServerState {
        base,
        uploads: Arc::new(Mutex::new(Vec::new())),
        gate_first_upload,
        first_upload_entered: Arc::new(Notify::new()),
        release_first_upload: Arc::new(Notify::new()),
    };
    let app = Router::new()
        .route("/{*path}", put(scoped_upload_request))
        .with_state(state.clone());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    ScopedUploadServer {
        state,
        relay_url,
        task,
    }
}

fn scoped_upload_test_app(relay_url: &str, keys: Keys) -> tauri::App<tauri::test::MockRuntime> {
    let state = crate::app_state::build_app_state();
    *state.keys.lock().unwrap() = keys;
    *state.relay_url_override.lock().unwrap() = Some(relay_url.to_string());
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
}

#[tokio::test]
async fn scoped_upload_rechecks_relay_and_signer_before_network() {
    let relay_a = scoped_upload_server(false).await;
    let relay_b = scoped_upload_server(false).await;
    let keys_a = Keys::generate();
    let keys_b = Keys::generate();
    let app = scoped_upload_test_app(&relay_a.relay_url, keys_a.clone());
    let state = app.state::<crate::app_state::AppState>();
    let scope = ScopedMediaUpload::capture(
        &state,
        relay_a.relay_url.clone(),
        keys_a.public_key().to_hex(),
    )
    .unwrap();

    *state.relay_url_override.lock().unwrap() = Some(relay_b.relay_url.clone());
    let relay_error = upload_prepared_media(
        b"avatar".to_vec(),
        "image/png",
        &state,
        None,
        None,
        Some(&scope),
    )
    .await
    .unwrap_err();
    assert!(
        relay_error.contains("active community changed"),
        "{relay_error}"
    );
    assert!(relay_a.state.uploads.lock().unwrap().is_empty());
    assert!(relay_b.state.uploads.lock().unwrap().is_empty());

    *state.relay_url_override.lock().unwrap() = Some(relay_a.relay_url.clone());
    *state.keys.lock().unwrap() = keys_b.clone();
    let identity_error = upload_prepared_media(
        b"avatar".to_vec(),
        "image/png",
        &state,
        None,
        None,
        Some(&scope),
    )
    .await
    .unwrap_err();
    assert!(
        identity_error.contains("active identity changed"),
        "{identity_error}"
    );
    assert!(relay_a.state.uploads.lock().unwrap().is_empty());
    assert!(relay_b.state.uploads.lock().unwrap().is_empty());
    assert_ne!(keys_a.public_key(), keys_b.public_key());
}

#[tokio::test]
async fn scoped_upload_fallback_keeps_captured_relay_and_signer() {
    let relay_a = scoped_upload_server(true).await;
    let relay_b = scoped_upload_server(false).await;
    let keys_a = Keys::generate();
    let keys_b = Keys::generate();
    let app = scoped_upload_test_app(&relay_a.relay_url, keys_a.clone());
    let state = app.state::<crate::app_state::AppState>();
    let scope = ScopedMediaUpload::capture(
        &state,
        relay_a.relay_url.clone(),
        keys_a.public_key().to_hex(),
    )
    .unwrap();

    let entered = relay_a.state.first_upload_entered.notified();
    tokio::pin!(entered);
    let upload = upload_prepared_media(
        b"avatar".to_vec(),
        "image/png",
        &state,
        None,
        None,
        Some(&scope),
    );
    tokio::pin!(upload);
    tokio::select! {
        _ = &mut entered => {}
        result = &mut upload => panic!("upload completed before its first request: {result:?}"),
    }

    *state.relay_url_override.lock().unwrap() = Some(relay_b.relay_url.clone());
    *state.keys.lock().unwrap() = keys_b;
    relay_a.state.release_first_upload.notify_one();
    let descriptor = upload.await.unwrap();

    assert!(descriptor.url.starts_with(&relay_a.state.base));
    let uploads_a = relay_a.state.uploads.lock().unwrap();
    assert_eq!(
        uploads_a
            .iter()
            .map(|upload| upload.path.as_str())
            .collect::<Vec<_>>(),
        ["/upload", "/media/upload"]
    );
    for upload in uploads_a.iter() {
        assert_eq!(upload.signer, keys_a.public_key().to_hex());
        assert_eq!(
            upload.server_tag.as_deref(),
            extract_server_authority(&relay_a.state.base).as_deref()
        );
        assert_eq!(upload.hash_tag.as_deref(), Some(descriptor.sha256.as_str()));
    }
    drop(uploads_a);
    assert!(relay_b.state.uploads.lock().unwrap().is_empty());

    // The same seam handles derived video posters. A workspace switch while
    // the primary upload ran fails closed before a poster can reach either relay.
    let poster_error = upload_prepared_media(
        b"poster".to_vec(),
        "image/png",
        &state,
        None,
        None,
        Some(&scope),
    )
    .await
    .unwrap_err();
    assert!(
        poster_error.contains("active community changed"),
        "{poster_error}"
    );
    assert_eq!(relay_a.state.uploads.lock().unwrap().len(), 2);
    assert!(relay_b.state.uploads.lock().unwrap().is_empty());
}
