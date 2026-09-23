use crate::{
    model::prune_expired_previews,
    model::*,
    state::AppState,
    storage::{read_pointer, read_snapshot},
};
use axum::{
    body::Body,
    extract::{Path as AxumPath, State},
    http::{header, HeaderValue, Response, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use std::sync::Arc;

pub(crate) fn public_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(public_health))
        .route("/sites/{site_id}", get(get_published_site))
        .route("/previews/{preview_id}", get(get_preview))
        .with_state(state)
}

pub(crate) async fn public_health() -> impl IntoResponse {
    Json(PublisherStatus {
        service: "aios-sites-publisher",
        version: env!("CARGO_PKG_VERSION"),
    })
}

pub(crate) async fn get_preview(
    State(state): State<Arc<AppState>>,
    AxumPath(preview_id): AxumPath<String>,
) -> Response<Body> {
    if !valid_preview_id(&preview_id) {
        return not_found();
    }
    let mut previews = state
        .previews
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    prune_expired_previews(&mut previews);
    let Some(entry) = previews.get(&preview_id) else {
        return not_found();
    };
    let html = render_html(&entry.request.title, &entry.request.files);
    html_response(html, &state.preview_ancestors, true)
}

pub(crate) async fn get_published_site(
    State(state): State<Arc<AppState>>,
    AxumPath(site_id): AxumPath<String>,
) -> Response<Body> {
    if !valid_site_id(&site_id) {
        return not_found();
    }
    let pointer = match read_pointer(&state.data_dir, &site_id) {
        Ok(Some(pointer)) if pointer.status == PointerStatus::Active => pointer,
        _ => return not_found(),
    };
    let Some(content_hash) = pointer.content_hash.filter(|hash| valid_hash(hash)) else {
        return not_found();
    };
    let snapshot = match read_snapshot(&state.data_dir, &site_id, &content_hash) {
        Ok(Some(snapshot))
            if snapshot.site_id == site_id && validate_snapshot(&snapshot).is_ok() =>
        {
            snapshot
        }
        _ => return not_found(),
    };
    let html = render_html(&snapshot.title, &snapshot.files);
    html_response(html, "'none'", false)
}

pub(crate) fn not_found() -> Response<Body> {
    let mut response = Response::new(Body::from("Not found"));
    *response.status_mut() = StatusCode::NOT_FOUND;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
