use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{
    header::{HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE},
    Client, Method, Response,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use url::{Host, Url};

use super::{scope::PublisherScope, types::SitesPublisherFiles};

pub(super) const API_PREFIX: &str = "/api";
const MAX_TOKEN_BYTES: usize = 512;
const MAX_SITE_BYTES: usize = 200_000;
const MAX_SITE_ID_BYTES: usize = 128;
const MAX_SITE_TITLE_CODE_UNITS: usize = 120;
const MAX_SITE_HTML_CODE_UNITS: usize = 120_000;
const MAX_SITE_CSS_CODE_UNITS: usize = 80_000;
const MAX_SITE_JS_CODE_UNITS: usize = 80_000;
const MAX_RESPONSE_BYTES: usize = 256_000;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PublisherHealth {
    pub service: String,
    pub version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RevokeResponse {
    pub site_id: String,
    pub revoked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishRequest<'a> {
    title: &'a str,
    files: &'a SitesPublisherFiles,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewRequest<'a> {
    title: &'a str,
    files: &'a SitesPublisherFiles,
}

pub(super) fn publisher_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .map_err(|_| "Buzz could not prepare a secure Sites publisher connection.".to_string())
}

pub(super) async fn send_authenticated(
    scope: &PublisherScope,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Vec<u8>>,
) -> Result<Response, String> {
    if body
        .as_ref()
        .is_some_and(|bytes| bytes.len() > MAX_SITE_BYTES)
    {
        return Err("The Sites request is larger than the 200 KB limit.".to_string());
    }
    let auth = HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| "The saved Sites publisher credential is invalid.".to_string())?;
    let endpoint = scope.endpoint(path)?;
    let mut request = publisher_client()?
        .request(method, endpoint)
        .header(AUTHORIZATION, auth)
        .header(ACCEPT, "application/json");
    if let Some(body) = body {
        request = request.header(CONTENT_TYPE, "application/json").body(body);
    }
    request.send().await.map_err(|_| {
        "Buzz could not reach the Sites publisher. Check its address and try again.".to_string()
    })
}

pub(super) async fn decode_success<T: DeserializeOwned>(response: Response) -> Result<T, String> {
    if response.status().is_redirection() {
        return Err(
            "The Sites publisher redirected the request. Redirects are disabled.".to_string(),
        );
    }
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "The Sites publisher rejected this credential.".to_string(),
            404 => "The requested site is not registered with this publisher.".to_string(),
            413 | 422 => "The Sites publisher rejected this site or its size.".to_string(),
            429 => "The Sites publisher is at its preview or site limit.".to_string(),
            status => format!("The Sites publisher returned HTTP {status}."),
        });
    }
    let bytes = read_response_bounded(response, MAX_RESPONSE_BYTES).await?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "The Sites publisher returned an invalid response.".to_string())
}

async fn read_response_bounded(response: Response, limit: usize) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err("The Sites publisher response is too large.".to_string());
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| "Could not read the Sites publisher response.".to_string())?;
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err("The Sites publisher response is too large.".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(super) async fn verify_public_404(url: &str, expected_path: &str) -> Result<(), String> {
    let url = checked_public_url(url, expected_path)?;
    let response = publisher_client()?
        .get(url)
        .send()
        .await
        .map_err(|_| "Buzz could not verify the public Sites address.".to_string())?;
    if response.status().is_redirection() {
        return Err(
            "The public Sites address redirected during revocation verification.".to_string(),
        );
    }
    if response.status() != reqwest::StatusCode::NOT_FOUND {
        return Err(
            "The Sites publisher did not return HTTP 404 for the revoked site.".to_string(),
        );
    }
    Ok(())
}

pub(super) fn validate_token(token: &str) -> Result<(), String> {
    if !(32..=MAX_TOKEN_BYTES).contains(&token.len())
        || !token.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    {
        return Err("Enter the publisher’s 32–512 character operator token.".to_string());
    }
    Ok(())
}

pub(super) fn validate_site(
    site_id: &str,
    title: &str,
    files: &SitesPublisherFiles,
) -> Result<(), String> {
    if site_id.is_empty()
        || site_id.len() > MAX_SITE_ID_BYTES
        || !site_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("This site has an invalid Buzz channel id.".to_string());
    }
    if title.trim().is_empty()
        || title.encode_utf16().count() > MAX_SITE_TITLE_CODE_UNITS
        || files.index_html.encode_utf16().count() > MAX_SITE_HTML_CODE_UNITS
        || files.style_css.encode_utf16().count() > MAX_SITE_CSS_CODE_UNITS
        || files.app_js.encode_utf16().count() > MAX_SITE_JS_CODE_UNITS
    {
        return Err("The Sites content exceeds its supported field limits.".to_string());
    }
    let request = PublishRequest { title, files };
    let body = serde_json::to_vec(&request)
        .map_err(|_| "Could not serialize this Sites document.".to_string())?;
    if body.len() > MAX_SITE_BYTES {
        return Err("The Sites document is larger than the 200 KB limit.".to_string());
    }
    Ok(())
}

pub(super) fn preview_body(title: &str, files: &SitesPublisherFiles) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&PreviewRequest { title, files })
        .map_err(|_| "Could not serialize this Sites preview.".to_string())
}

pub(super) fn publish_body(title: &str, files: &SitesPublisherFiles) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&PublishRequest { title, files })
        .map_err(|_| "Could not serialize this Sites document.".to_string())
}

pub(super) fn checked_public_url(url: &str, expected_path: &str) -> Result<String, String> {
    let parsed = Url::parse(url)
        .map_err(|_| "The Sites publisher returned an invalid address.".to_string())?;
    if parsed.path() != expected_path
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("The Sites publisher returned an unexpected address.".to_string());
    }
    let loopback = match parsed.host() {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(host)) => host.is_loopback(),
        Some(Host::Ipv6(host)) => host.is_loopback(),
        None => false,
    };
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err("The publisher returned an insecure non-loopback address.".to_string());
    }
    Ok(parsed.to_string())
}

pub(super) async fn fetch_health(
    scope: &PublisherScope,
    token: &str,
) -> Result<PublisherHealth, String> {
    let response = send_authenticated(
        scope,
        token,
        Method::GET,
        &format!("{API_PREFIX}/status"),
        None,
    )
    .await?;
    let health: PublisherHealth = decode_success(response).await?;
    if health.service != "aios-sites-publisher" {
        return Err("This address is not an AIOS Sites publisher.".to_string());
    }
    Ok(health)
}

#[cfg(test)]
mod tests {
    use super::super::types::SitesPublisherFiles;
    use super::{checked_public_url, validate_site};
    use serde_json::Value;

    #[test]
    fn site_upload_limits_and_urls_are_checked_at_the_native_boundary() {
        let files = SitesPublisherFiles {
            index_html: String::new(),
            style_css: String::new(),
            app_js: String::new(),
        };
        assert!(validate_site("channel_123", "site", &files).is_ok());
        assert!(validate_site("../escape", "site", &files).is_err());
        assert!(validate_site("channel_123", " ", &files).is_err());
        assert!(checked_public_url(
            "http://127.0.0.1:3351/sites/channel_123",
            "/sites/channel_123"
        )
        .is_ok());
        assert!(checked_public_url(
            "http://outside.example/sites/channel_123",
            "/sites/channel_123"
        )
        .is_err());
        assert!(
            checked_public_url("https://sites.example/sites/wrong", "/sites/channel_123").is_err()
        );
    }

    #[test]
    fn native_publisher_limits_match_the_shared_utf16_contract() {
        let contract: Value = serde_json::from_str(include_str!(
            "../../../../../fixtures/aios-sites/site-v1-length-contract.json"
        ))
        .expect("valid shared Sites length fixture");
        assert_eq!(contract["limits"]["title"], 120);
        assert_eq!(contract["limits"]["indexHtml"], 120_000);
        assert_eq!(contract["limits"]["styleCss"], 80_000);
        assert_eq!(contract["limits"]["appJs"], 80_000);
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
        let empty = SitesPublisherFiles {
            index_html: String::new(),
            style_css: String::new(),
            app_js: String::new(),
        };
        assert!(validate_site("channel_123", &title, &empty).is_ok());

        let mut unicode_html = empty.clone();
        unicode_html.index_html = sample.repeat(
            unicode["validIndexHtmlCodeUnits"]
                .as_u64()
                .expect("HTML boundary") as usize,
        );
        assert!(unicode_html.index_html.len() > MAX_SITE_HTML_CODE_UNITS);
        assert!(validate_site("channel_123", "site", &unicode_html).is_ok());

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
        assert!(validate_site("channel_123", "site", &unicode_styles).is_ok());
        assert!(validate_site(
            "channel_123",
            &"x".repeat(MAX_SITE_TITLE_CODE_UNITS + 1),
            &empty
        )
        .is_err());
        assert!(validate_site(
            "channel_123",
            "site",
            &SitesPublisherFiles {
                index_html: "x".repeat(MAX_SITE_HTML_CODE_UNITS + 1),
                ..empty.clone()
            }
        )
        .is_err());
    }
}
