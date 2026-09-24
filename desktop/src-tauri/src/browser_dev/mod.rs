//! Explicitly enabled, debug-only localhost transport for the existing native backend.
//! The launcher keeps the bearer token in a private file; Vite's server-side proxy
//! holds it, never the browser bundle. Production builds exclude this module.
mod config;
mod sessions;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{
    ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody},
    Manager,
};
use tokio::sync::{oneshot, Semaphore};
use uuid::Uuid;

use config::Config;
use sessions::Sessions;

#[derive(Clone)]
pub(crate) struct BrowserDevState(Arc<Bridge>);

struct Bridge {
    app: tauri::AppHandle,
    config: Config,
    sessions: Sessions,
    inflight: Semaphore,
    host_ready: AtomicBool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    client_id: Uuid,
    command: String,
    #[serde(default)]
    args: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientRequest {
    client_id: Uuid,
}

/// Whether the development launcher requested a hidden native companion.
pub(crate) fn enabled() -> bool {
    std::env::var("AIOS_BROWSER_DEV").as_deref() == Ok("1")
}

/// Start only when the launcher explicitly enables this local development transport.
pub(crate) fn start(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(config) = Config::from_env()? else {
        return Ok(());
    };
    if !crate::build_identity::is_demo_build() {
        return Err("Browser development requires an isolated pilot app identity".into());
    }
    let listener = std::net::TcpListener::bind(config.address)
        .map_err(|error| format!("Cannot start local browser backend: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let bridge = Arc::new(Bridge {
        app: app.clone(),
        config,
        sessions: Sessions::default(),
        inflight: Semaphore::new(32),
        host_ready: AtomicBool::new(false),
    });
    app.manage(BrowserDevState(Arc::clone(&bridge)));
    let router = Router::new()
        .route("/health", post(health))
        .route("/connect", post(connect))
        .route("/disconnect", post(disconnect))
        .route("/rpc", post(invoke))
        .route("/events", post(events))
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .layer(middleware::from_fn_with_state(
            Arc::clone(&bridge),
            authorize,
        ))
        .with_state(Arc::clone(&bridge));
    let cleanup = Arc::clone(&bridge);
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            cleanup.sessions.reap(&cleanup.app);
        }
    });
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("aios-browser: listener failed: {error}");
                return;
            }
        };
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("aios-browser: server stopped: {error}");
        }
    });
    Ok(())
}

async fn authorize(
    State(bridge): State<Arc<Bridge>>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if !bridge.config.accepts(request.headers()) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if request
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next())
        != Some(Some("application/json"))
    {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        "cache-control",
        axum::http::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        axum::http::HeaderValue::from_static("nosniff"),
    );
    response
}

async fn health(State(bridge): State<Arc<Bridge>>) -> Response {
    if !bridge.host_ready.load(Ordering::Acquire) {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Native companion is still initializing",
        );
    }
    Json(json!({"service":"aios-browser-backend", "mode":"real-native", "version":1}))
        .into_response()
}

async fn connect(State(bridge): State<Arc<Bridge>>) -> Response {
    if !bridge.host_ready.load(Ordering::Acquire) {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Native companion is still initializing",
        );
    }
    match bridge.sessions.connect() {
        Ok(id) => Json(json!({"clientId":id})).into_response(),
        Err(error) => failure(StatusCode::TOO_MANY_REQUESTS, error),
    }
}

async fn disconnect(
    State(bridge): State<Arc<Bridge>>,
    Json(request): Json<ClientRequest>,
) -> Json<Value> {
    bridge.sessions.disconnect(request.client_id, &bridge.app);
    Json(json!({"disconnected":true}))
}

async fn events(State(bridge): State<Arc<Bridge>>, Json(request): Json<ClientRequest>) -> Response {
    let session = match bridge.sessions.get(request.client_id) {
        Ok(session) => session,
        Err(error) => return failure(StatusCode::UNAUTHORIZED, error),
    };
    match session.poll().await {
        Ok(events) => Json(events).into_response(),
        Err(error) => failure(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn invoke(State(bridge): State<Arc<Bridge>>, Json(request): Json<Request>) -> Response {
    let Ok(_permit) = bridge.inflight.try_acquire() else {
        return failure(
            StatusCode::TOO_MANY_REQUESTS,
            "The local backend is busy. Try again.",
        );
    };
    let session = match bridge.sessions.get(request.client_id) {
        Ok(session) => session,
        Err(error) => return failure(StatusCode::UNAUTHORIZED, error),
    };
    if request.command.starts_with("browser_dev_") {
        return failure(
            StatusCode::FORBIDDEN,
            "This command belongs to the native companion",
        );
    }
    if request.command.len() > 160 || request.command.is_empty() {
        return failure(StatusCode::BAD_REQUEST, "Invalid native command");
    }
    let sockets = bridge
        .app
        .state::<crate::native_websocket::WebSocketManager>()
        .inner()
        .clone();
    if request.command == "plugin:websocket|disconnect_all" {
        for id in session.take_sockets() {
            sockets.disconnect(id).await;
        }
        return success(Value::Null);
    }
    if matches!(
        request.command.as_str(),
        "plugin:websocket|send" | "plugin:websocket|disconnect"
    ) {
        let Some(id) = request
            .args
            .get("id")
            .and_then(Value::as_u64)
            .and_then(|id| u32::try_from(id).ok())
        else {
            return failure(StatusCode::BAD_REQUEST, "Invalid browser connection");
        };
        if !session.owns_socket(id) {
            return failure(
                StatusCode::FORBIDDEN,
                "Connection belongs to another browser session",
            );
        }
        if request.command == "plugin:websocket|disconnect" {
            sockets.disconnect(id).await;
            session.forget_socket(id);
            return success(Value::Null);
        }
    }
    let is_socket_connect = request.command == "plugin:websocket|connect";
    if request.command == "plugin:event|listen" {
        let event = request
            .args
            .get("event")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(callback) = request
            .args
            .get("handler")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
        else {
            return failure(StatusCode::BAD_REQUEST, "Invalid listener callback");
        };
        return match session.listen(&bridge.app, event, callback) {
            Ok(id) => success(json!(id)),
            Err(error) => failure(StatusCode::BAD_REQUEST, error),
        };
    }
    if request.command == "plugin:event|unlisten" {
        let Some(id) = request
            .args
            .get("eventId")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
        else {
            return failure(StatusCode::BAD_REQUEST, "Invalid listener identifier");
        };
        return match session.unlisten(&bridge.app, id) {
            Ok(()) => success(Value::Null),
            Err(error) => failure(StatusCode::BAD_REQUEST, error),
        };
    }
    if let Err(error) = bridge.sessions.register_channels(&session, &request.args) {
        return failure(StatusCode::BAD_REQUEST, error);
    }
    let Some(window) = bridge.app.get_webview_window("main") else {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Native backend is not ready",
        );
    };
    // Use the configured local application origin so Tauri still applies its
    // existing main-window capability checks. Never accept a caller-supplied URL,
    // window label or invoke key.
    let Some(url) = bridge.app.config().build.dev_url.clone() else {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Browser backend requires a development build",
        );
    };
    if url.origin().ascii_serialization() != bridge.config.origin {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Browser frontend and backend origins do not match",
        );
    }
    let (sender, receiver) = oneshot::channel();
    let native = tauri::webview::InvokeRequest {
        cmd: request.command,
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url,
        body: InvokeBody::Json(request.args),
        headers: HeaderMap::new(),
        invoke_key: bridge.app.invoke_key().to_owned(),
    };
    window.on_message(
        native,
        Box::new(move |_, _, response, _, _| {
            let _ = sender.send(response);
        }),
    );
    match tokio::time::timeout(Duration::from_secs(210), receiver).await {
        Ok(Ok(InvokeResponse::Ok(InvokeResponseBody::Json(value)))) => match serde_json::from_str::<Value>(&value) {
            Ok(value) => {
                if is_socket_connect {
                    if let Some(id) = value.as_u64().and_then(|id| u32::try_from(id).ok()) {
                        if let Err(error) = session.register_socket(id) {
                            sockets.disconnect(id).await;
                            return failure(StatusCode::GONE, error);
                        }
                    }
                }
                success(value)
            },
            Err(_) => failure(StatusCode::BAD_GATEWAY, "Native backend returned invalid JSON"),
        },
        Ok(Ok(InvokeResponse::Ok(InvokeResponseBody::Raw(bytes)))) => Json(json!({"ok":true,"raw":bytes})).into_response(),
        Ok(Ok(InvokeResponse::Err(error))) => Json(json!({"ok":false,"error":error.0})).into_response(),
        _ => failure(StatusCode::GATEWAY_TIMEOUT, "The native command did not finish in time. It may still complete; check the current state before retrying."),
    }
}

fn success(value: Value) -> Response {
    Json(json!({"ok":true,"value":value})).into_response()
}
fn failure(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({"ok":false,"error":message.into()}))).into_response()
}

/// Deliver IPC channel progress through the same bounded browser event queue.
pub(crate) fn intercept_channel(
    webview: &tauri::Webview,
    callback: CallbackFn,
    index: usize,
    body: &InvokeResponseBody,
) -> bool {
    let Some(state) = webview.app_handle().try_state::<BrowserDevState>() else {
        return false;
    };
    let payload = match body {
        InvokeResponseBody::Json(text) => match serde_json::from_str::<Value>(text) {
            Ok(value) => json!({"index":index,"message":value}),
            Err(_) => return false,
        },
        InvokeResponseBody::Raw(bytes) => json!({"index":index,"message":bytes,"binary":true}),
    };
    state.0.sessions.send_channel(callback.0, payload)
}

/// Forward channel completion emitted by Tauri into the hidden companion page.
/// Message bodies travel through the native interceptor; this accepts only end markers.
#[tauri::command]
pub(crate) fn browser_dev_channel_end(
    state: tauri::State<'_, BrowserDevState>,
    callback: u32,
    index: usize,
) {
    state.0.sessions.end_channel(callback, index);
}

/// Open the transport only after the native companion installed channel cleanup.
#[tauri::command]
pub(crate) fn browser_dev_host_ready(state: tauri::State<'_, BrowserDevState>) {
    state.0.host_ready.store(true, Ordering::Release);
}
