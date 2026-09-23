use axum::{
    body::Body,
    http::{header, HeaderValue, Response, StatusCode},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

pub(crate) const MAX_SITE_BYTES: usize = 200_000;
pub(crate) const MAX_REQUEST_BYTES: usize = 220_000;
pub(crate) const MAX_TITLE_BYTES: usize = 120;
pub(crate) const MAX_HTML_BYTES: usize = 120_000;
pub(crate) const MAX_CSS_BYTES: usize = 80_000;
pub(crate) const MAX_JS_BYTES: usize = 80_000;
pub(crate) const PREVIEW_TTL: Duration = Duration::from_secs(30 * 60);
pub(crate) const MAX_PREVIEWS: usize = 8;
pub(crate) const MAX_PREVIEW_BYTES: usize = 2_000_000;
pub(crate) const HASH_BYTES: usize = 32;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SiteFiles {
    pub(crate) index_html: String,
    pub(crate) style_css: String,
    pub(crate) app_js: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PublishRequest {
    pub(crate) title: String,
    pub(crate) files: SiteFiles,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SiteSnapshot {
    pub(crate) schema_version: u8,
    pub(crate) site_id: String,
    pub(crate) title: String,
    pub(crate) files: SiteFiles,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SitePointer {
    pub(crate) status: PointerStatus,
    pub(crate) content_hash: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PointerStatus {
    Active,
    Revoked,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublisherStatus {
    pub(crate) service: &'static str,
    pub(crate) version: &'static str,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SiteStatus {
    pub(crate) site_id: String,
    pub(crate) published: bool,
    pub(crate) content_hash: Option<String>,
    pub(crate) public_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishResult {
    pub(crate) site_id: String,
    pub(crate) content_hash: String,
    pub(crate) public_url: String,
    pub(crate) already_published: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevokeResult {
    pub(crate) site_id: String,
    pub(crate) revoked: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PreviewRequest {
    pub(crate) title: String,
    pub(crate) files: SiteFiles,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewResult {
    pub(crate) preview_url: String,
    pub(crate) expires_in_seconds: u64,
}

pub(crate) struct PreviewEntry {
    pub(crate) request: PublishRequest,
    pub(crate) byte_len: usize,
    pub(crate) expires_at: Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiError {
    pub(crate) error: &'static str,
}

pub(crate) fn html_response(html: String, ancestors: &str, preview: bool) -> Response<Body> {
    let csp = format!(
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; sandbox allow-scripts; frame-ancestors {ancestors}"
    );
    let mut response = Response::new(Body::from(html));
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_str(&csp)
            .unwrap_or_else(|_| HeaderValue::from_static("default-src 'none'; sandbox")),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(if preview {
            "no-store"
        } else {
            "public, max-age=60, must-revalidate"
        }),
    );
    if !preview {
        headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    }
    response
}

pub(crate) fn render_html(title: &str, files: &SiteFiles) -> String {
    let title = escape_html(title);
    let css = files
        .style_css
        .replace("</style", "<\\/style")
        .replace("</STYLE", "<\\/STYLE");
    let js = files
        .app_js
        .replace("</script", "<\\/script")
        .replace("</SCRIPT", "<\\/SCRIPT");
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>{title}</title>\n<style>{css}</style>\n</head>\n<body>\n{}\n<script>{js}</script>\n</body>\n</html>\n",
        files.index_html
    )
}

pub(crate) fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(crate) fn validate_publish_request(request: &PublishRequest) -> Result<(), ()> {
    if request.title.trim().is_empty()
        || request.title.as_bytes().len() > MAX_TITLE_BYTES
        || request.files.index_html.as_bytes().len() > MAX_HTML_BYTES
        || request.files.style_css.as_bytes().len() > MAX_CSS_BYTES
        || request.files.app_js.as_bytes().len() > MAX_JS_BYTES
    {
        return Err(());
    }
    let snapshot = SiteSnapshot {
        schema_version: 1,
        site_id: "site".to_string(),
        title: request.title.clone(),
        files: request.files.clone(),
    };
    let serialized = serde_json::to_vec(&snapshot).map_err(|_| ())?;
    if serialized.len() > MAX_SITE_BYTES {
        return Err(());
    }
    Ok(())
}

pub(crate) fn validate_snapshot(snapshot: &SiteSnapshot) -> Result<(), ()> {
    if snapshot.schema_version != 1 || !valid_site_id(&snapshot.site_id) {
        return Err(());
    }
    validate_publish_request(&PublishRequest {
        title: snapshot.title.clone(),
        files: snapshot.files.clone(),
    })
}

pub(crate) fn valid_site_id(site_id: &str) -> bool {
    !site_id.is_empty()
        && site_id.len() <= 128
        && site_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

pub(crate) fn valid_preview_id(preview_id: &str) -> bool {
    preview_id.len() == 32 && preview_id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn prune_expired_previews(previews: &mut HashMap<String, PreviewEntry>) {
    let now = Instant::now();
    previews.retain(|_, entry| entry.expires_at > now);
}
