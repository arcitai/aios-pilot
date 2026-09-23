use std::time::Duration;

use reqwest::{
    header::{HeaderValue, AUTHORIZATION},
    Method, RequestBuilder, Response,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use url::Url;
use zeroize::Zeroizing;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_TOKEN_BYTES: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum TransportError {
    InvalidOrigin,
    InvalidToken,
    Network,
    HttpStatus(u16),
    ResponseTooLarge,
    InvalidResponse,
}

pub(super) struct ProviderHttpClient {
    client: reqwest::Client,
    origin: Url,
}

impl ProviderHttpClient {
    pub fn new(origin: Url) -> Result<Self, TransportError> {
        if origin.scheme() != "https" || origin.host_str().is_none() {
            return Err(TransportError::InvalidOrigin);
        }
        Self::with_testable_origin(origin)
    }

    #[cfg(test)]
    pub fn for_test(origin: Url) -> Result<Self, TransportError> {
        if !matches!(origin.scheme(), "http" | "https") || origin.host_str().is_none() {
            return Err(TransportError::InvalidOrigin);
        }
        Self::with_testable_origin(origin)
    }

    fn with_testable_origin(origin: Url) -> Result<Self, TransportError> {
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Buzz-Desktop")
            .build()
            .map_err(|_| TransportError::Network)?;
        Ok(Self { client, origin })
    }

    pub fn api_url(&self, path: &str) -> Result<Url, TransportError> {
        let url = self
            .origin
            .join(path)
            .map_err(|_| TransportError::InvalidOrigin)?;
        self.require_same_origin(&url)?;
        Ok(url)
    }

    pub fn request(
        &self,
        method: Method,
        path: &str,
        token: &str,
        headers: &[(&str, &str)],
        body: Option<Value>,
    ) -> Result<RequestBuilder, TransportError> {
        let url = self.api_url(path)?;
        self.request_url(method, url, token, headers, body)
    }

    /// Build a form-encoded request against this client's fixed origin.
    /// OAuth token endpoints use this path without attaching an access token.
    pub fn request_form(
        &self,
        method: Method,
        path: &str,
        fields: &[(&str, &str)],
    ) -> Result<RequestBuilder, TransportError> {
        let url = self.api_url(path)?;
        Ok(self.client.request(method, url).form(fields))
    }

    pub fn request_url(
        &self,
        method: Method,
        url: Url,
        token: &str,
        headers: &[(&str, &str)],
        body: Option<Value>,
    ) -> Result<RequestBuilder, TransportError> {
        validate_token(token)?;
        self.require_same_origin(&url)?;
        let authorization = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| TransportError::InvalidToken)?;
        let mut request = self
            .client
            .request(method, url)
            .header(AUTHORIZATION, authorization);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        Ok(request)
    }

    fn require_same_origin(&self, url: &Url) -> Result<(), TransportError> {
        if url.scheme() != self.origin.scheme()
            || url.host_str() != self.origin.host_str()
            || url.port_or_known_default() != self.origin.port_or_known_default()
        {
            return Err(TransportError::InvalidOrigin);
        }
        Ok(())
    }
}

pub(super) fn validate_token(token: &str) -> Result<(), TransportError> {
    if token.len() < 20
        || token.len() > MAX_TOKEN_BYTES
        || !token.is_ascii()
        || token
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
    {
        return Err(TransportError::InvalidToken);
    }
    HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| TransportError::InvalidToken)?;
    Ok(())
}

pub(super) async fn decode_json<T: DeserializeOwned>(
    response: Response,
    max_bytes: usize,
) -> Result<T, TransportError> {
    decode_json_counted(response, max_bytes)
        .await
        .map(|(value, _)| value)
}

pub(super) async fn decode_json_counted<T: DeserializeOwned>(
    response: Response,
    max_bytes: usize,
) -> Result<(T, usize), TransportError> {
    let status = response.status();
    if !status.is_success() {
        return Err(TransportError::HttpStatus(status.as_u16()));
    }
    let bytes = read_bounded_body(response, max_bytes).await?;
    let length = bytes.len();
    let value = serde_json::from_slice(&bytes).map_err(|_| TransportError::InvalidResponse)?;
    Ok((value, length))
}

pub(super) async fn decode_text(
    response: Response,
    max_bytes: usize,
) -> Result<String, TransportError> {
    if !response.status().is_success() {
        return Err(TransportError::HttpStatus(response.status().as_u16()));
    }
    let bytes = read_bounded_body(response, max_bytes).await?;
    String::from_utf8(bytes).map_err(|_| TransportError::InvalidResponse)
}

pub(super) async fn decode_sensitive_json<T: DeserializeOwned>(
    response: Response,
    max_bytes: usize,
) -> Result<T, TransportError> {
    if !response.status().is_success() {
        return Err(TransportError::HttpStatus(response.status().as_u16()));
    }
    let bytes = read_bounded_sensitive_body(response, max_bytes).await?;
    serde_json::from_slice(&bytes).map_err(|_| TransportError::InvalidResponse)
}

async fn read_bounded_body(
    mut response: Response,
    max_bytes: usize,
) -> Result<Vec<u8>, TransportError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(TransportError::ResponseTooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| TransportError::Network)?
    {
        if bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Err(TransportError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn read_bounded_sensitive_body(
    mut response: Response,
    max_bytes: usize,
) -> Result<Zeroizing<Vec<u8>>, TransportError> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(TransportError::ResponseTooLarge);
    }
    let mut bytes = Zeroizing::new(Vec::new());
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| TransportError::Network)?
    {
        if bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Err(TransportError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
