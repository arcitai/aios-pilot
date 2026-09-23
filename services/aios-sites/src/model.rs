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
pub(crate) const MAX_TITLE_CODE_UNITS: usize = 120;
pub(crate) const MAX_HTML_CODE_UNITS: usize = 120_000;
pub(crate) const MAX_CSS_CODE_UNITS: usize = 80_000;
pub(crate) const MAX_JS_CODE_UNITS: usize = 80_000;
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
        || request.title.encode_utf16().count() > MAX_TITLE_CODE_UNITS
        || request.files.index_html.encode_utf16().count() > MAX_HTML_CODE_UNITS
        || request.files.style_css.encode_utf16().count() > MAX_CSS_CODE_UNITS
        || request.files.app_js.encode_utf16().count() > MAX_JS_CODE_UNITS
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn publisher_validation_matches_shared_utf16_contract() {
        let contract: Value = serde_json::from_str(include_str!(
            "../../../fixtures/aios-sites/site-v1-length-contract.json"
        ))
        .expect("valid shared Sites length fixture");
        assert_eq!(contract["limits"]["title"], MAX_TITLE_CODE_UNITS);
        assert_eq!(contract["limits"]["indexHtml"], MAX_HTML_CODE_UNITS);
        assert_eq!(contract["limits"]["styleCss"], MAX_CSS_CODE_UNITS);
        assert_eq!(contract["limits"]["appJs"], MAX_JS_CODE_UNITS);
        assert_eq!(contract["limits"]["document"], MAX_SITE_BYTES);

        let unicode = &contract["unicode"];
        let sample = unicode["sample"].as_str().expect("unicode sample");
        let title = sample.repeat(
            unicode["validTitleCodeUnits"]
                .as_u64()
                .expect("title boundary") as usize,
        );
        assert_eq!(title.encode_utf16().count(), 100);
        assert!(title.len() > title.encode_utf16().count());
        let empty = SiteFiles {
            index_html: String::new(),
            style_css: String::new(),
            app_js: String::new(),
        };
        assert!(validate_publish_request(&PublishRequest {
            title: title.clone(),
            files: empty.clone(),
        })
        .is_ok());

        let mut unicode_html = empty.clone();
        unicode_html.index_html = sample.repeat(
            unicode["validIndexHtmlCodeUnits"]
                .as_u64()
                .expect("HTML boundary") as usize,
        );
        assert!(unicode_html.index_html.len() > MAX_HTML_CODE_UNITS);
        assert!(validate_publish_request(&PublishRequest {
            title: title.clone(),
            files: unicode_html,
        })
        .is_ok());

        let mut unicode_styles = empty.clone();
        unicode_styles.style_css = sample.repeat(
            unicode["validStyleCssCodeUnits"]
                .as_u64()
                .expect("CSS boundary") as usize,
        );
        unicode_styles.app_js = sample.repeat(
            unicode["validAppJsCodeUnits"]
                .as_u64()
                .expect("JS boundary") as usize,
        );
        assert!(validate_publish_request(&PublishRequest {
            title: title.clone(),
            files: unicode_styles,
        })
        .is_ok());

        assert!(validate_publish_request(&PublishRequest {
            title: sample.repeat(MAX_TITLE_CODE_UNITS + 1),
            files: empty.clone(),
        })
        .is_err());
        assert!(validate_publish_request(&PublishRequest {
            title: "site".into(),
            files: SiteFiles {
                index_html: "x".repeat(MAX_HTML_CODE_UNITS + 1),
                ..empty.clone()
            },
        })
        .is_err());
        assert!(validate_publish_request(&PublishRequest {
            title: "site".into(),
            files: SiteFiles {
                style_css: "x".repeat(MAX_CSS_CODE_UNITS + 1),
                ..empty.clone()
            },
        })
        .is_err());
        assert!(validate_publish_request(&PublishRequest {
            title: "site".into(),
            files: SiteFiles {
                app_js: "x".repeat(MAX_JS_CODE_UNITS + 1),
                ..empty
            },
        })
        .is_err());
    }

    #[test]
    fn publisher_still_enforces_total_serialized_utf8_bytes() {
        let request = PublishRequest {
            title: "site".into(),
            files: SiteFiles {
                index_html: "x".repeat(MAX_HTML_CODE_UNITS),
                style_css: "x".repeat(60_000),
                app_js: "x".repeat(30_000),
            },
        };
        assert!(validate_publish_request(&request).is_err());
    }
}

pub(crate) fn prune_expired_previews(previews: &mut HashMap<String, PreviewEntry>) {
    let now = Instant::now();
    previews.retain(|_, entry| entry.expires_at > now);
}
