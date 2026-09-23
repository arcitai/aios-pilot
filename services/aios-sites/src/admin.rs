use crate::{
    model::*,
    state::AppState,
    storage::{prune_site_snapshots, read_pointer, write_pointer, write_snapshot_if_missing},
};
use axum::{
    extract::{DefaultBodyLimit, Path as AxumPath, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use tokio::time;
use uuid::Uuid;

pub(crate) fn admin_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/status", get(get_status))
        .route(
            "/api/sites/{site_id}",
            get(get_site_status).put(publish_site).delete(revoke_site),
        )
        .route("/api/previews", post(create_preview))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

pub(crate) async fn prune_previews_task(previews: Arc<Mutex<HashMap<String, PreviewEntry>>>) {
    let mut interval = time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        prune_expired_previews(&mut previews.lock().unwrap_or_else(|error| error.into_inner()));
    }
}

pub(crate) fn admin_authorized(headers: &HeaderMap, state: &AppState) -> bool {
    let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    if value.len() < 32 || value.len() > 512 {
        return false;
    }
    let provided_hash = Sha256::digest(value.as_bytes());
    bool::from(
        provided_hash
            .as_slice()
            .ct_eq(state.admin_token_hash.as_slice()),
    )
}

pub(crate) fn unauthorized() -> impl IntoResponse {
    (
        StatusCode::UNAUTHORIZED,
        Json(ApiError {
            error: "unauthorized",
        }),
    )
}

pub(crate) async fn get_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !admin_authorized(&headers, &state) {
        return unauthorized().into_response();
    }
    Json(PublisherStatus {
        service: "aios-sites-publisher",
        version: env!("CARGO_PKG_VERSION"),
    })
    .into_response()
}

pub(crate) async fn get_site_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(site_id): AxumPath<String>,
) -> impl IntoResponse {
    if !admin_authorized(&headers, &state) {
        return unauthorized().into_response();
    }
    if !valid_site_id(&site_id) {
        return api_error(StatusCode::BAD_REQUEST, "invalid_site_id").into_response();
    }
    let _guard = state.sites_lock.lock().await;
    let pointer = match read_pointer(&state.data_dir, &site_id) {
        Ok(pointer) => pointer,
        Err(_) => {
            return api_error(StatusCode::INTERNAL_SERVER_ERROR, "storage_error").into_response()
        }
    };
    let active = pointer
        .as_ref()
        .is_some_and(|pointer| pointer.status == PointerStatus::Active);
    let content_hash = pointer.and_then(|pointer| {
        (pointer.status == PointerStatus::Active)
            .then_some(pointer.content_hash)
            .flatten()
    });
    let public_url = Some(format!("{}/sites/{site_id}", state.public_origin));
    Json(SiteStatus {
        site_id,
        published: active,
        content_hash,
        public_url,
    })
    .into_response()
}

pub(crate) async fn publish_site(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(site_id): AxumPath<String>,
    Json(request): Json<PublishRequest>,
) -> impl IntoResponse {
    if !admin_authorized(&headers, &state) {
        return unauthorized().into_response();
    }
    if !valid_site_id(&site_id) {
        return api_error(StatusCode::BAD_REQUEST, "invalid_site_id").into_response();
    }
    if validate_publish_request(&request).is_err() {
        return api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_site").into_response();
    }
    let snapshot = SiteSnapshot {
        schema_version: 1,
        site_id: site_id.clone(),
        title: request.title,
        files: request.files,
    };
    let serialized = match serde_json::to_vec(&snapshot) {
        Ok(serialized) if serialized.len() <= MAX_SITE_BYTES => serialized,
        _ => return api_error(StatusCode::PAYLOAD_TOO_LARGE, "site_too_large").into_response(),
    };
    let content_hash = hex::encode(Sha256::digest(&serialized));
    let _guard = state.sites_lock.lock().await;
    let previous = match read_pointer(&state.data_dir, &site_id) {
        Ok(pointer) => pointer,
        Err(_) => {
            return api_error(StatusCode::INTERNAL_SERVER_ERROR, "storage_error").into_response()
        }
    };
    let already_published = previous.as_ref().is_some_and(|pointer| {
        pointer.status == PointerStatus::Active
            && pointer.content_hash.as_deref() == Some(content_hash.as_str())
    });
    let previous_hash = previous
        .as_ref()
        .filter(|pointer| pointer.status == PointerStatus::Active)
        .and_then(|pointer| pointer.content_hash.as_deref())
        .filter(|hash| valid_hash(hash));
    let mut retained_hashes = vec![content_hash.as_str()];
    if let Some(previous_hash) = previous_hash.filter(|hash| *hash != content_hash) {
        retained_hashes.push(previous_hash);
    }
    if write_snapshot_if_missing(&state.data_dir, &site_id, &content_hash, &serialized)
        .and_then(|()| prune_site_snapshots(&state.data_dir, &site_id, &retained_hashes))
        .and_then(|()| {
            write_pointer(
                &state.data_dir,
                &site_id,
                &SitePointer {
                    status: PointerStatus::Active,
                    content_hash: Some(content_hash.clone()),
                },
            )
        })
        .is_err()
    {
        return api_error(StatusCode::INTERNAL_SERVER_ERROR, "storage_error").into_response();
    }
    Json(PublishResult {
        site_id: site_id.clone(),
        content_hash,
        public_url: format!("{}/sites/{site_id}", state.public_origin),
        already_published,
    })
    .into_response()
}

pub(crate) async fn revoke_site(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(site_id): AxumPath<String>,
) -> impl IntoResponse {
    if !admin_authorized(&headers, &state) {
        return unauthorized().into_response();
    }
    if !valid_site_id(&site_id) {
        return api_error(StatusCode::BAD_REQUEST, "invalid_site_id").into_response();
    }
    let _guard = state.sites_lock.lock().await;
    if write_pointer(
        &state.data_dir,
        &site_id,
        &SitePointer {
            status: PointerStatus::Revoked,
            content_hash: None,
        },
    )
    .is_err()
    {
        return api_error(StatusCode::INTERNAL_SERVER_ERROR, "storage_error").into_response();
    }
    Json(RevokeResult {
        site_id,
        revoked: true,
    })
    .into_response()
}

pub(crate) async fn create_preview(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<PreviewRequest>,
) -> impl IntoResponse {
    if !admin_authorized(&headers, &state) {
        return unauthorized().into_response();
    }
    let request = PublishRequest {
        title: request.title,
        files: request.files,
    };
    if validate_publish_request(&request).is_err() {
        return api_error(StatusCode::UNPROCESSABLE_ENTITY, "invalid_site").into_response();
    }
    let byte_len = serde_json::to_vec(&request).map_or(MAX_SITE_BYTES + 1, |bytes| bytes.len());
    if byte_len > MAX_SITE_BYTES {
        return api_error(StatusCode::PAYLOAD_TOO_LARGE, "site_too_large").into_response();
    }
    let mut previews = state
        .previews
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    prune_expired_previews(&mut previews);
    let bytes_used = previews.values().map(|entry| entry.byte_len).sum::<usize>();
    if previews.len() >= MAX_PREVIEWS || bytes_used + byte_len > MAX_PREVIEW_BYTES {
        return api_error(StatusCode::TOO_MANY_REQUESTS, "preview_capacity_reached")
            .into_response();
    }
    let preview_id = Uuid::new_v4().simple().to_string();
    previews.insert(
        preview_id.clone(),
        PreviewEntry {
            request,
            byte_len,
            expires_at: Instant::now() + PREVIEW_TTL,
        },
    );
    Json(PreviewResult {
        preview_url: format!("{}/previews/{preview_id}", state.public_origin),
        expires_in_seconds: PREVIEW_TTL.as_secs(),
    })
    .into_response()
}

pub(crate) fn api_error(status: StatusCode, error: &'static str) -> impl IntoResponse {
    (status, Json(ApiError { error }))
}
