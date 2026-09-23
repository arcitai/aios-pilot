use std::{
    fmt,
    net::SocketAddr,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::{Method, RequestBuilder};
use serde::{Deserialize, Serialize};
use sha2::Digest as _;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::timeout,
};
use url::Url;
use zeroize::{Zeroize, Zeroizing};

use super::{
    adapter::CredentialStore,
    scope::ConnectionScope,
    source_text::{apply_source_limit, strip_controls},
    transport::{
        decode_json, decode_sensitive_json, decode_text, validate_token, ProviderHttpClient,
        TransportError,
    },
};

const DRIVE_API_ORIGIN: &str = "https://www.googleapis.com/drive/v3/";
const OAUTH_TOKEN_ORIGIN: &str = "https://oauth2.googleapis.com/";
const OAUTH_AUTHORIZATION_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE_READONLY_SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_DOC_MIME_TYPE: &str = "application/vnd.google-apps.document";
const GOOGLE_CLIENT_ID_SUFFIX: &str = ".apps.googleusercontent.com";
const CREDENTIAL_VERSION: u32 = 1;
const MAX_CLIENT_ID_BYTES: usize = 512;
const MAX_CREDENTIAL_BYTES: usize = 8192;
const MAX_DRIVE_LIST_BYTES: usize = 512 * 1024;
const MAX_DRIVE_METADATA_BYTES: usize = 64 * 1024;
const MAX_GOOGLE_DOC_BYTES: usize = 1024 * 1024;
const MAX_LIST_RESULTS: usize = 25;
const MAX_QUERY_BYTES: usize = 200;
const MAX_CURSOR_BYTES: usize = 2048;
const MAX_CALLBACK_BYTES: usize = 8192;
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);
const IMPORT_TIMEOUT: Duration = Duration::from_secs(20);
const TEXT_LIMIT_NOTICE: &str = "[Source text truncated by Buzz to 40,000 UTF-16 units.]";

/// Public Google Desktop OAuth client ID; no client secret is stored.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GoogleDriveOAuthClientConfig {
    pub client_id: String,
}

/// Minimal verification result. Buzz requests no identity scope or user profile.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveConnectionStatus {
    pub connected: bool,
}

/// One Google Doc found by a bounded Drive title search.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveFile {
    pub id: String,
    pub title: String,
    pub mime_type: String,
    pub modified_time: Option<String>,
    pub url: String,
}

/// One bounded page of Google Docs, with Google's opaque page token retained.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDriveSearchResult {
    pub files: Vec<GoogleDriveFile>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

/// Text and provenance returned only after importing one selected Google Doc.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedGoogleDoc {
    pub title: String,
    pub content: String,
    pub url: String,
    pub kind: &'static str,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum GoogleConnectionError {
    InvalidClientId,
    NotConfigured,
    InvalidAuthorization,
    AuthorizationDenied,
    Callback,
    CallbackTimeout,
    Browser,
    TokenExchange,
    ReconnectRequired,
    ScopeMismatch,
    Network,
    HttpStatus(u16),
    ResponseTooLarge,
    InvalidResponse,
    InvalidQuery,
    InvalidCursor,
    InvalidFileId,
    NotGoogleDoc,
    ImportTimeout,
    Store,
}

impl fmt::Display for GoogleConnectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidClientId => {
                write!(formatter, "Enter a valid Google Desktop OAuth client ID.")
            }
            Self::NotConfigured => {
                write!(formatter, "Set up a Google Desktop OAuth client ID first.")
            }
            Self::InvalidAuthorization => write!(
                formatter,
                "Google returned an invalid authorization response."
            ),
            Self::AuthorizationDenied => {
                write!(formatter, "Google authorization was canceled or denied.")
            }
            Self::Callback => write!(
                formatter,
                "Buzz could not receive the Google authorization response."
            ),
            Self::CallbackTimeout => write!(
                formatter,
                "Google authorization timed out. Try connecting again."
            ),
            Self::Browser => write!(formatter, "Buzz could not open the system browser."),
            Self::TokenExchange => write!(
                formatter,
                "Google could not complete the authorization. Try connecting again."
            ),
            Self::ReconnectRequired => write!(
                formatter,
                "The Google connection expired. Connect Google Drive again."
            ),
            Self::ScopeMismatch => write!(
                formatter,
                "Google did not grant only the requested read-only Drive permission."
            ),
            Self::Network => write!(
                formatter,
                "Could not reach Google. Check the connection and try again."
            ),
            Self::HttpStatus(status) => write!(formatter, "Google returned HTTP {status}."),
            Self::ResponseTooLarge => write!(
                formatter,
                "Google returned a response that is too large to use."
            ),
            Self::InvalidResponse => write!(formatter, "Google returned an invalid response."),
            Self::InvalidQuery => write!(formatter, "Enter a search term of at most 200 bytes."),
            Self::InvalidCursor => write!(formatter, "Google returned an invalid search cursor."),
            Self::InvalidFileId => {
                write!(formatter, "Select a Google Doc from the search results.")
            }
            Self::NotGoogleDoc => {
                write!(formatter, "That Drive file is not an available Google Doc.")
            }
            Self::ImportTimeout => write!(formatter, "The Google Doc import timed out. Try again."),
            Self::Store => write!(formatter, "Buzz could not access the OS keyring."),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredGoogleCredential {
    version: u32,
    client_id: String,
    access_token: String,
    refresh_token: String,
    access_expires_at: u64,
    refresh_expires_at: Option<u64>,
    scope: String,
}

impl Drop for StoredGoogleCredential {
    fn drop(&mut self) {
        self.access_token.zeroize();
        self.refresh_token.zeroize();
    }
}

#[derive(Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    token_type: String,
    expires_in: u64,
    refresh_token: Option<String>,
    refresh_token_expires_in: Option<u64>,
    scope: Option<String>,
}

impl Drop for OAuthTokenResponse {
    fn drop(&mut self) {
        self.access_token.zeroize();
        if let Some(refresh_token) = self.refresh_token.as_mut() {
            refresh_token.zeroize();
        }
        self.token_type.zeroize();
        if let Some(scope) = self.scope.as_mut() {
            scope.zeroize();
        }
    }
}

#[derive(Deserialize)]
struct DriveAbout {
    kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFileResponse {
    id: String,
    name: String,
    mime_type: String,
    modified_time: Option<String>,
    trashed: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFileListResponse {
    files: Vec<DriveFileResponse>,
    next_page_token: Option<String>,
}

/// Read-only Drive adapter with separately pinned API and OAuth origins.
pub(super) struct GoogleDriveAdapter<'a> {
    drive: ProviderHttpClient,
    oauth: ProviderHttpClient,
    credentials: &'a dyn CredentialStore,
}

impl<'a> GoogleDriveAdapter<'a> {
    pub fn new(credentials: &'a dyn CredentialStore) -> Result<Self, GoogleConnectionError> {
        let drive_origin =
            Url::parse(DRIVE_API_ORIGIN).map_err(|_| GoogleConnectionError::InvalidResponse)?;
        let oauth_origin =
            Url::parse(OAUTH_TOKEN_ORIGIN).map_err(|_| GoogleConnectionError::InvalidResponse)?;
        Ok(Self {
            drive: ProviderHttpClient::new(drive_origin).map_err(map_transport_error)?,
            oauth: ProviderHttpClient::new(oauth_origin).map_err(map_transport_error)?,
            credentials,
        })
    }

    #[cfg(test)]
    pub fn for_test(
        credentials: &'a dyn CredentialStore,
        drive_origin: Url,
        oauth_origin: Url,
    ) -> Result<Self, GoogleConnectionError> {
        Ok(Self {
            drive: ProviderHttpClient::for_test(drive_origin).map_err(map_transport_error)?,
            oauth: ProviderHttpClient::for_test(oauth_origin).map_err(map_transport_error)?,
            credentials,
        })
    }

    pub async fn connect<F>(
        &self,
        scope: &ConnectionScope,
        client_id: &str,
        open_browser: F,
    ) -> Result<(), GoogleConnectionError>
    where
        F: FnOnce(&str) -> Result<(), ()>,
    {
        validate_client_id(client_id)?;
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| GoogleConnectionError::Callback)?;
        let port = listener
            .local_addr()
            .map_err(|_| GoogleConnectionError::Callback)?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{port}");
        let state = random_url_token(32)?;
        let verifier = Zeroizing::new(random_url_token(32)?);
        let authorization_url =
            build_authorization_url(client_id, &redirect_uri, &state, &verifier)?;
        open_browser(authorization_url.as_str()).map_err(|_| GoogleConnectionError::Browser)?;

        let code = Zeroizing::new(
            match timeout(
                CALLBACK_TIMEOUT,
                receive_oauth_callback(listener, port, &state),
            )
            .await
            {
                Ok(result) => result?,
                Err(_) => return Err(GoogleConnectionError::CallbackTimeout),
            },
        );
        let token_response = self
            .exchange_authorization_code(client_id, &code, &verifier, &redirect_uri)
            .await?;
        validate_token_response(&token_response, true)?;
        let refresh_token = token_response
            .refresh_token
            .as_ref()
            .ok_or(GoogleConnectionError::InvalidResponse)?
            .clone();
        let now = now_unix()?;
        let credential = StoredGoogleCredential {
            version: CREDENTIAL_VERSION,
            client_id: client_id.to_string(),
            access_token: token_response.access_token.clone(),
            refresh_token,
            access_expires_at: now.saturating_add(token_response.expires_in),
            refresh_expires_at: token_response
                .refresh_token_expires_in
                .map(|seconds| now.saturating_add(seconds)),
            scope: DRIVE_READONLY_SCOPE.to_string(),
        };
        verify_about(&self.drive, &credential.access_token).await?;
        self.save_credential(scope, &credential)?;
        Ok(())
    }

    pub fn revoke(&self, scope: &ConnectionScope) -> Result<(), GoogleConnectionError> {
        self.credentials
            .delete(&scope.keyring_key("google"))
            .map_err(|_| GoogleConnectionError::Store)
    }

    pub async fn status(
        &self,
        scope: &ConnectionScope,
    ) -> Result<GoogleDriveConnectionStatus, GoogleConnectionError> {
        let Some(mut credential) = self.load_credential(scope)? else {
            return Ok(GoogleDriveConnectionStatus { connected: false });
        };
        self.refresh_if_needed(scope, &mut credential).await?;
        verify_about(&self.drive, &credential.access_token).await?;
        Ok(GoogleDriveConnectionStatus { connected: true })
    }

    pub async fn search_files(
        &self,
        scope: &ConnectionScope,
        query: &str,
        cursor: Option<&str>,
    ) -> Result<GoogleDriveSearchResult, GoogleConnectionError> {
        let mut credential = self.require_credential(scope)?;
        self.refresh_if_needed(scope, &mut credential).await?;
        let url = build_list_url(&self.drive, query, cursor)?;
        let response = self
            .authenticated_get(url, &credential.access_token)?
            .send()
            .await
            .map_err(|_| GoogleConnectionError::Network)?;
        let page: DriveFileListResponse = decode_json(response, MAX_DRIVE_LIST_BYTES)
            .await
            .map_err(map_transport_error)?;
        let files = page
            .files
            .into_iter()
            .take(MAX_LIST_RESULTS)
            .filter_map(file_from_response)
            .collect();
        let next_cursor = match page.next_page_token {
            Some(token)
                if !token.is_empty()
                    && token.len() <= MAX_CURSOR_BYTES
                    && token.is_ascii()
                    && !token.bytes().any(|byte| byte.is_ascii_control()) =>
            {
                Some(token)
            }
            Some(_) => return Err(GoogleConnectionError::InvalidCursor),
            None => None,
        };
        Ok(GoogleDriveSearchResult {
            files,
            has_more: next_cursor.is_some(),
            next_cursor,
        })
    }

    pub async fn import_document(
        &self,
        scope: &ConnectionScope,
        file_id: &str,
    ) -> Result<ImportedGoogleDoc, GoogleConnectionError> {
        validate_file_id(file_id)?;
        timeout(IMPORT_TIMEOUT, self.import_document_inner(scope, file_id))
            .await
            .map_err(|_| GoogleConnectionError::ImportTimeout)?
    }

    fn load_credential(
        &self,
        scope: &ConnectionScope,
    ) -> Result<Option<StoredGoogleCredential>, GoogleConnectionError> {
        let Some(serialized) = self
            .credentials
            .load(&scope.keyring_key("google"))
            .map_err(|_| GoogleConnectionError::Store)?
        else {
            return Ok(None);
        };
        if serialized.len() > MAX_CREDENTIAL_BYTES {
            return Err(GoogleConnectionError::InvalidResponse);
        }
        let serialized = Zeroizing::new(serialized);
        let credential: StoredGoogleCredential = serde_json::from_str(&serialized)
            .map_err(|_| GoogleConnectionError::InvalidResponse)?;
        validate_stored_credential(&credential)?;
        Ok(Some(credential))
    }

    fn require_credential(
        &self,
        scope: &ConnectionScope,
    ) -> Result<StoredGoogleCredential, GoogleConnectionError> {
        self.load_credential(scope)?
            .ok_or(GoogleConnectionError::NotConfigured)
    }

    fn save_credential(
        &self,
        scope: &ConnectionScope,
        credential: &StoredGoogleCredential,
    ) -> Result<(), GoogleConnectionError> {
        validate_stored_credential(credential)?;
        let serialized = Zeroizing::new(
            serde_json::to_string(credential)
                .map_err(|_| GoogleConnectionError::InvalidResponse)?,
        );
        if serialized.len() > MAX_CREDENTIAL_BYTES {
            return Err(GoogleConnectionError::InvalidResponse);
        }
        self.credentials
            .store(&scope.keyring_key("google"), &serialized)
            .map_err(|_| GoogleConnectionError::Store)
    }

    async fn refresh_if_needed(
        &self,
        scope: &ConnectionScope,
        credential: &mut StoredGoogleCredential,
    ) -> Result<(), GoogleConnectionError> {
        let now = now_unix()?;
        if credential.access_expires_at > now.saturating_add(60) {
            return Ok(());
        }
        if credential
            .refresh_expires_at
            .is_some_and(|expires_at| expires_at <= now)
        {
            return Err(GoogleConnectionError::ReconnectRequired);
        }
        let response = self
            .oauth
            .request_form(
                Method::POST,
                "token",
                &[
                    ("client_id", credential.client_id.as_str()),
                    ("grant_type", "refresh_token"),
                    ("refresh_token", credential.refresh_token.as_str()),
                ],
            )
            .map_err(map_transport_error)?
            .send()
            .await
            .map_err(|_| GoogleConnectionError::Network)?;
        let token: OAuthTokenResponse = decode_sensitive_json(response, MAX_DRIVE_METADATA_BYTES)
            .await
            .map_err(map_refresh_error)?;
        validate_token_response(&token, false)?;
        let now = now_unix()?;
        credential.access_token.zeroize();
        credential.access_token.clone_from(&token.access_token);
        credential.access_expires_at = now.saturating_add(token.expires_in);
        if let Some(refresh_token) = token.refresh_token.as_ref() {
            validate_token(refresh_token).map_err(map_transport_error)?;
            credential.refresh_token.zeroize();
            credential.refresh_token.clone_from(refresh_token);
        }
        if let Some(seconds) = token.refresh_token_expires_in {
            credential.refresh_expires_at = Some(now.saturating_add(seconds));
        }
        self.save_credential(scope, credential)?;
        Ok(())
    }

    async fn exchange_authorization_code(
        &self,
        client_id: &str,
        code: &str,
        verifier: &str,
        redirect_uri: &str,
    ) -> Result<OAuthTokenResponse, GoogleConnectionError> {
        let response = self
            .oauth
            .request_form(
                Method::POST,
                "token",
                &[
                    ("client_id", client_id),
                    ("code", code),
                    ("code_verifier", verifier),
                    ("grant_type", "authorization_code"),
                    ("redirect_uri", redirect_uri),
                ],
            )
            .map_err(map_transport_error)?
            .send()
            .await
            .map_err(|_| GoogleConnectionError::Network)?;
        decode_sensitive_json(response, MAX_DRIVE_METADATA_BYTES)
            .await
            .map_err(|error| match error {
                TransportError::HttpStatus(_) => GoogleConnectionError::TokenExchange,
                other => map_transport_error(other),
            })
    }

    async fn import_document_inner(
        &self,
        scope: &ConnectionScope,
        file_id: &str,
    ) -> Result<ImportedGoogleDoc, GoogleConnectionError> {
        let mut credential = self.require_credential(scope)?;
        self.refresh_if_needed(scope, &mut credential).await?;
        let metadata_path = format!("files/{file_id}");
        let mut metadata_url = self
            .drive
            .api_url(&metadata_path)
            .map_err(map_transport_error)?;
        metadata_url
            .query_pairs_mut()
            .append_pair("fields", "id,name,mimeType,modifiedTime,trashed");
        let response = self
            .authenticated_get(metadata_url, &credential.access_token)?
            .send()
            .await
            .map_err(|_| GoogleConnectionError::Network)?;
        let metadata: DriveFileResponse = decode_json(response, MAX_DRIVE_METADATA_BYTES)
            .await
            .map_err(map_transport_error)?;
        if metadata.id != file_id
            || metadata.mime_type != GOOGLE_DOC_MIME_TYPE
            || metadata.trashed != Some(false)
        {
            return Err(GoogleConnectionError::NotGoogleDoc);
        }
        let export_path = format!("files/{file_id}/export");
        let mut export_url = self
            .drive
            .api_url(&export_path)
            .map_err(map_transport_error)?;
        export_url
            .query_pairs_mut()
            .append_pair("mimeType", "text/plain");
        let response = self
            .authenticated_get(export_url, &credential.access_token)?
            .send()
            .await
            .map_err(|_| GoogleConnectionError::Network)?;
        let exported = decode_text(response, MAX_GOOGLE_DOC_BYTES)
            .await
            .map_err(map_transport_error)?;
        let clean_text = strip_controls(&exported);
        if clean_text.trim().is_empty() {
            return Err(GoogleConnectionError::InvalidResponse);
        }
        let title = sanitize_title(&metadata.name);
        let (content, truncated) = apply_source_limit(&clean_text, false, TEXT_LIMIT_NOTICE);
        Ok(ImportedGoogleDoc {
            title,
            content,
            url: google_document_url(file_id),
            kind: "url",
            truncated,
        })
    }

    fn authenticated_get(
        &self,
        url: Url,
        token: &str,
    ) -> Result<RequestBuilder, GoogleConnectionError> {
        self.drive
            .request_url(Method::GET, url, token, &[], None)
            .map_err(map_transport_error)
    }
}

fn validate_client_id(client_id: &str) -> Result<(), GoogleConnectionError> {
    let Some(prefix) = client_id.strip_suffix(GOOGLE_CLIENT_ID_SUFFIX) else {
        return Err(GoogleConnectionError::InvalidClientId);
    };
    let Some((project_number, client_suffix)) = prefix.split_once('-') else {
        return Err(GoogleConnectionError::InvalidClientId);
    };
    if client_id.len() > MAX_CLIENT_ID_BYTES
        || prefix.len() < 10
        || project_number.is_empty()
        || !project_number.bytes().all(|byte| byte.is_ascii_digit())
        || client_suffix.is_empty()
        || !client_suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(GoogleConnectionError::InvalidClientId);
    }
    Ok(())
}

pub(super) fn validate_configured_client_id(client_id: &str) -> Result<(), GoogleConnectionError> {
    validate_client_id(client_id)
}

fn validate_stored_credential(
    credential: &StoredGoogleCredential,
) -> Result<(), GoogleConnectionError> {
    validate_client_id(&credential.client_id)?;
    validate_token(&credential.access_token).map_err(map_transport_error)?;
    validate_token(&credential.refresh_token).map_err(map_transport_error)?;
    if credential.version != CREDENTIAL_VERSION || credential.scope != DRIVE_READONLY_SCOPE {
        return Err(GoogleConnectionError::ScopeMismatch);
    }
    Ok(())
}

fn validate_token_response(
    response: &OAuthTokenResponse,
    require_refresh_token: bool,
) -> Result<(), GoogleConnectionError> {
    validate_token(&response.access_token).map_err(map_transport_error)?;
    if !response.token_type.eq_ignore_ascii_case("Bearer")
        || response.expires_in == 0
        || response.expires_in > 86_400
        || (require_refresh_token && response.refresh_token.is_none())
    {
        return Err(GoogleConnectionError::InvalidResponse);
    }
    if let Some(refresh_token) = response.refresh_token.as_deref() {
        validate_token(refresh_token).map_err(map_transport_error)?;
    }
    if let Some(scope) = response.scope.as_deref() {
        let mut scopes = scope.split_ascii_whitespace();
        if scopes.next() != Some(DRIVE_READONLY_SCOPE) || scopes.next().is_some() {
            return Err(GoogleConnectionError::ScopeMismatch);
        }
    }
    if response
        .refresh_token_expires_in
        .is_some_and(|seconds| seconds == 0 || seconds > 315_360_000)
    {
        return Err(GoogleConnectionError::InvalidResponse);
    }
    Ok(())
}

fn random_url_token(byte_count: usize) -> Result<String, GoogleConnectionError> {
    let mut bytes = Zeroizing::new(vec![0_u8; byte_count]);
    getrandom::getrandom(&mut bytes).map_err(|_| GoogleConnectionError::InvalidAuthorization)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn build_authorization_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    verifier: &str,
) -> Result<Url, GoogleConnectionError> {
    validate_client_id(client_id)?;
    if state.len() < 40 || verifier.len() < 43 || verifier.len() > 128 {
        return Err(GoogleConnectionError::InvalidAuthorization);
    }
    let challenge = URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(verifier.as_bytes()));
    let mut url = Url::parse(OAUTH_AUTHORIZATION_ENDPOINT)
        .map_err(|_| GoogleConnectionError::InvalidAuthorization)?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", DRIVE_READONLY_SCOPE)
        .append_pair("state", state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("include_granted_scopes", "false");
    Ok(url)
}

async fn receive_oauth_callback(
    listener: TcpListener,
    port: u16,
    expected_state: &str,
) -> Result<String, GoogleConnectionError> {
    let (mut stream, peer) = listener
        .accept()
        .await
        .map_err(|_| GoogleConnectionError::Callback)?;
    let request = read_callback_request(&mut stream).await?;
    let result = parse_callback_request(&request, peer, port, expected_state);
    let (status, body) = if result.is_ok() {
        ("200 OK", "Google authorization received. Return to Buzz.")
    } else {
        (
            "400 Bad Request",
            "Google authorization could not be verified.",
        )
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
    result
}

async fn read_callback_request(stream: &mut TcpStream) -> Result<Vec<u8>, GoogleConnectionError> {
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 512];
    loop {
        let count = stream
            .read(&mut chunk)
            .await
            .map_err(|_| GoogleConnectionError::Callback)?;
        if count == 0 {
            return Err(GoogleConnectionError::Callback);
        }
        if request.len().saturating_add(count) > MAX_CALLBACK_BYTES {
            return Err(GoogleConnectionError::Callback);
        }
        request.extend_from_slice(&chunk[..count]);
        if let Some(end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            if end + 4 != request.len() {
                return Err(GoogleConnectionError::Callback);
            }
            return Ok(request);
        }
    }
}

fn parse_callback_request(
    request: &[u8],
    peer: SocketAddr,
    port: u16,
    expected_state: &str,
) -> Result<String, GoogleConnectionError> {
    if request.len() > MAX_CALLBACK_BYTES || !peer.is_ipv4() || !peer.ip().is_loopback() {
        return Err(GoogleConnectionError::Callback);
    }
    let request_text = std::str::from_utf8(request).map_err(|_| GoogleConnectionError::Callback)?;
    let (headers, trailing) = request_text
        .split_once("\r\n\r\n")
        .ok_or(GoogleConnectionError::Callback)?;
    if !trailing.is_empty() {
        return Err(GoogleConnectionError::Callback);
    }
    let mut lines = headers.split("\r\n");
    let request_line = lines.next().ok_or(GoogleConnectionError::Callback)?;
    let mut request_parts = request_line.split_ascii_whitespace();
    if request_parts.next() != Some("GET")
        || request_parts.next().is_none()
        || request_parts.next() != Some("HTTP/1.1")
        || request_parts.next().is_some()
    {
        return Err(GoogleConnectionError::Callback);
    }
    let target = request_line
        .split_ascii_whitespace()
        .nth(1)
        .ok_or(GoogleConnectionError::Callback)?;
    if !target.starts_with("/?") {
        return Err(GoogleConnectionError::Callback);
    }
    let expected_host = format!("127.0.0.1:{port}");
    let mut host_count = 0;
    let mut content_length = None;
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or(GoogleConnectionError::Callback)?;
        if name.eq_ignore_ascii_case("host") {
            host_count += 1;
            if value.trim() != expected_host {
                return Err(GoogleConnectionError::Callback);
            }
        } else if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(GoogleConnectionError::Callback);
            }
            content_length = Some(value.trim());
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(GoogleConnectionError::Callback);
        }
    }
    if host_count != 1 || content_length.is_some_and(|value| value != "0") {
        return Err(GoogleConnectionError::Callback);
    }
    let callback_url = Url::parse(&format!("http://127.0.0.1:{port}{target}"))
        .map_err(|_| GoogleConnectionError::Callback)?;
    if callback_url.path() != "/"
        || callback_url.port() != Some(port)
        || callback_url.host_str() != Some("127.0.0.1")
    {
        return Err(GoogleConnectionError::Callback);
    }
    let mut values = std::collections::HashMap::<String, String>::new();
    for (key, value) in callback_url.query_pairs() {
        if !matches!(
            key.as_ref(),
            "code"
                | "state"
                | "scope"
                | "authuser"
                | "prompt"
                | "error"
                | "error_description"
                | "error_uri"
        ) || values
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err(GoogleConnectionError::InvalidAuthorization);
        }
    }
    let returned_state = values
        .get("state")
        .ok_or(GoogleConnectionError::InvalidAuthorization)?;
    if returned_state != expected_state {
        return Err(GoogleConnectionError::InvalidAuthorization);
    }
    if values.contains_key("error") {
        return Err(GoogleConnectionError::AuthorizationDenied);
    }
    if values
        .get("scope")
        .is_some_and(|scope| scope != DRIVE_READONLY_SCOPE)
    {
        return Err(GoogleConnectionError::ScopeMismatch);
    }
    let code = values
        .get("code")
        .ok_or(GoogleConnectionError::InvalidAuthorization)?;
    if code.is_empty()
        || code.len() > 4096
        || !code.is_ascii()
        || code.bytes().any(|byte| byte.is_ascii_whitespace())
    {
        return Err(GoogleConnectionError::InvalidAuthorization);
    }
    Ok(code.clone())
}

fn build_list_url(
    client: &ProviderHttpClient,
    query: &str,
    cursor: Option<&str>,
) -> Result<Url, GoogleConnectionError> {
    let query = query.trim();
    if query.is_empty() || query.len() > MAX_QUERY_BYTES || query.chars().any(char::is_control) {
        return Err(GoogleConnectionError::InvalidQuery);
    }
    if let Some(cursor) = cursor {
        if cursor.is_empty()
            || cursor.len() > MAX_CURSOR_BYTES
            || !cursor.is_ascii()
            || cursor.bytes().any(|byte| byte.is_ascii_control())
        {
            return Err(GoogleConnectionError::InvalidCursor);
        }
    }
    let escaped = query.replace('\\', "\\\\").replace('\'', "\\'");
    let q = format!(
        "name contains '{escaped}' and mimeType = '{GOOGLE_DOC_MIME_TYPE}' and trashed = false"
    );
    let mut url = client.api_url("files").map_err(map_transport_error)?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs
            .append_pair("q", &q)
            .append_pair("corpora", "user")
            .append_pair("spaces", "drive")
            .append_pair("pageSize", &MAX_LIST_RESULTS.to_string())
            .append_pair("orderBy", "modifiedTime desc")
            .append_pair(
                "fields",
                "nextPageToken,files(id,name,mimeType,modifiedTime)",
            );
        if let Some(cursor) = cursor {
            pairs.append_pair("pageToken", cursor);
        }
    }
    Ok(url)
}

fn file_from_response(file: DriveFileResponse) -> Option<GoogleDriveFile> {
    if file.mime_type != GOOGLE_DOC_MIME_TYPE || file.trashed.unwrap_or(false) {
        return None;
    }
    validate_file_id(&file.id).ok()?;
    let title = sanitize_title(&file.name);
    let modified_time = file
        .modified_time
        .filter(|time| time.len() <= 64 && !time.chars().any(char::is_control));
    Some(GoogleDriveFile {
        url: google_document_url(&file.id),
        id: file.id,
        title,
        mime_type: GOOGLE_DOC_MIME_TYPE.to_string(),
        modified_time,
    })
}

fn sanitize_title(value: &str) -> String {
    let clean = strip_controls(value);
    let title: String = clean.trim().chars().take(200).collect();
    if title.is_empty() {
        "Untitled Google Doc".to_string()
    } else {
        title
    }
}

fn validate_file_id(file_id: &str) -> Result<(), GoogleConnectionError> {
    if file_id.is_empty()
        || file_id.len() > 256
        || !file_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(GoogleConnectionError::InvalidFileId);
    }
    Ok(())
}

fn google_document_url(file_id: &str) -> String {
    format!("https://docs.google.com/document/d/{file_id}/edit")
}

async fn verify_about(
    drive: &ProviderHttpClient,
    access_token: &str,
) -> Result<(), GoogleConnectionError> {
    let mut url = drive.api_url("about").map_err(map_transport_error)?;
    url.query_pairs_mut().append_pair("fields", "kind");
    let response = drive
        .request_url(Method::GET, url, access_token, &[], None)
        .map_err(map_transport_error)?
        .send()
        .await
        .map_err(|_| GoogleConnectionError::Network)?;
    let about: DriveAbout = decode_json(response, MAX_DRIVE_METADATA_BYTES)
        .await
        .map_err(map_transport_error)?;
    if about.kind != "drive#about" {
        return Err(GoogleConnectionError::InvalidResponse);
    }
    Ok(())
}

fn now_unix() -> Result<u64, GoogleConnectionError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| GoogleConnectionError::InvalidResponse)
}

fn map_refresh_error(error: TransportError) -> GoogleConnectionError {
    match error {
        TransportError::HttpStatus(_) => GoogleConnectionError::ReconnectRequired,
        other => map_transport_error(other),
    }
}

fn map_transport_error(error: TransportError) -> GoogleConnectionError {
    match error {
        TransportError::InvalidOrigin | TransportError::InvalidToken => {
            GoogleConnectionError::InvalidResponse
        }
        TransportError::Network => GoogleConnectionError::Network,
        TransportError::HttpStatus(status) => GoogleConnectionError::HttpStatus(status),
        TransportError::ResponseTooLarge => GoogleConnectionError::ResponseTooLarge,
        TransportError::InvalidResponse => GoogleConnectionError::InvalidResponse,
    }
}

#[cfg(test)]
#[path = "google_drive_tests.rs"]
mod tests;
