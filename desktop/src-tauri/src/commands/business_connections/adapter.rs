use std::fmt;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use url::Url;
use zeroize::Zeroizing;

use super::{
    scope::ConnectionScope,
    source_text::{apply_source_limit, strip_controls},
    transport::{decode_json, ProviderHttpClient, TransportError},
};

const GITHUB_API_ORIGIN: &str = "https://api.github.com/";
const GITHUB_API_VERSION: &str = "2026-03-10";
const MAX_USER_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_REPOSITORIES_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_README_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_README_CONTENT_BYTES: usize = 768 * 1024;
const MAX_REPOSITORIES: usize = 25;

/// Small injectable boundary around the existing Buzz OS-keyring store.
pub(super) trait CredentialStore: Send + Sync {
    fn load(&self, key: &str) -> Result<Option<String>, String>;
    fn store(&self, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum GitHubConnectionError {
    InvalidToken,
    RejectedCredentials,
    Network,
    HttpStatus(u16),
    ResponseTooLarge,
    InvalidResponse,
    RepositoryNotListed,
    Store,
}

impl fmt::Display for GitHubConnectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidToken => write!(formatter, "Enter a valid GitHub personal access token."),
            Self::RejectedCredentials => write!(
                formatter,
                "GitHub rejected this token or its read-only permissions do not cover this request."
            ),
            Self::Network => write!(
                formatter,
                "Could not reach GitHub. Check the connection and try again."
            ),
            Self::HttpStatus(status) => write!(formatter, "GitHub returned HTTP {status}."),
            Self::ResponseTooLarge => write!(
                formatter,
                "GitHub returned a response that is too large to use."
            ),
            Self::InvalidResponse => write!(formatter, "GitHub returned an invalid response."),
            Self::RepositoryNotListed => write!(
                formatter,
                "That repository is not in the accessible repository list."
            ),
            Self::Store => write!(formatter, "Buzz could not access the OS keyring."),
        }
    }
}

/// Public account label returned after GitHub accepts a token.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAccount {
    pub login: String,
}

/// Connection state produced only after checking the token with GitHub.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubConnectionStatus {
    pub connected: bool,
    pub login: Option<String>,
}

/// One accessible repository returned by the bounded GitHub list operation.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepository {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub description: Option<String>,
    pub url: String,
}

/// Sanitized README material for the caller's source-import callback.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedReadme {
    pub title: String,
    pub content: String,
    pub url: String,
    pub kind: &'static str,
    pub truncated: bool,
}

#[derive(Deserialize)]
struct ApiUser {
    login: String,
}

#[derive(Deserialize)]
struct ApiRepository {
    id: u64,
    name: String,
    owner: ApiRepositoryOwner,
    #[serde(default)]
    private: bool,
    description: Option<String>,
}

#[derive(Deserialize)]
struct ApiRepositoryOwner {
    login: String,
}

#[derive(Deserialize)]
struct ApiReadme {
    name: String,
    path: String,
    encoding: String,
    content: String,
}

/// Read-only GitHub REST adapter. Production construction always uses the fixed
/// GitHub API origin and disables redirects before attaching credentials.
pub(super) struct GitHubAdapter<'a> {
    client: ProviderHttpClient,
    credentials: &'a dyn CredentialStore,
}

impl<'a> GitHubAdapter<'a> {
    pub fn new(credentials: &'a dyn CredentialStore) -> Result<Self, GitHubConnectionError> {
        let origin =
            Url::parse(GITHUB_API_ORIGIN).map_err(|_| GitHubConnectionError::InvalidResponse)?;
        let client = ProviderHttpClient::new(origin).map_err(map_transport_error)?;
        Ok(Self {
            client,
            credentials,
        })
    }

    #[cfg(test)]
    fn for_test(
        credentials: &'a dyn CredentialStore,
        origin: Url,
    ) -> Result<Self, GitHubConnectionError> {
        let client = ProviderHttpClient::for_test(origin).map_err(map_transport_error)?;
        Ok(Self {
            client,
            credentials,
        })
    }

    pub fn load_token(
        &self,
        scope: &ConnectionScope,
    ) -> Result<Option<String>, GitHubConnectionError> {
        self.credentials
            .load(&scope.keyring_key("github"))
            .map_err(|_| GitHubConnectionError::Store)
    }

    pub fn save_verified_token(
        &self,
        scope: &ConnectionScope,
        token: &str,
    ) -> Result<(), GitHubConnectionError> {
        validate_token(token)?;
        self.credentials
            .store(&scope.keyring_key("github"), token)
            .map_err(|_| GitHubConnectionError::Store)
    }

    pub fn revoke(&self, scope: &ConnectionScope) -> Result<(), GitHubConnectionError> {
        self.credentials
            .delete(&scope.keyring_key("github"))
            .map_err(|_| GitHubConnectionError::Store)
    }

    /// Call GET /user and return only the public login used by the UI.
    pub async fn verify_token(&self, token: &str) -> Result<GitHubAccount, GitHubConnectionError> {
        validate_token(token)?;
        let response = self
            .authenticated_get("user", token)?
            .send()
            .await
            .map_err(|_| GitHubConnectionError::Network)?;
        let user: ApiUser = self.decode_json(response, MAX_USER_RESPONSE_BYTES).await?;
        if !valid_login(&user.login) {
            return Err(GitHubConnectionError::InvalidResponse);
        }
        Ok(GitHubAccount { login: user.login })
    }

    /// Verify any stored token before reporting it as connected.
    pub async fn status(
        &self,
        scope: &ConnectionScope,
    ) -> Result<GitHubConnectionStatus, GitHubConnectionError> {
        let Some(token) = self.load_token(scope)? else {
            return Ok(GitHubConnectionStatus {
                connected: false,
                login: None,
            });
        };
        let token = Zeroizing::new(token);
        let account = self.verify_token(&token).await?;
        Ok(GitHubConnectionStatus {
            connected: true,
            login: Some(account.login),
        })
    }

    /// Return only the first 25 accessible repositories, sorted by update time.
    pub async fn list_repositories(
        &self,
        token: &str,
    ) -> Result<Vec<GitHubRepository>, GitHubConnectionError> {
        validate_token(token)?;
        let mut url = self.api_url("user/repos")?;
        url.query_pairs_mut()
            .append_pair("per_page", &MAX_REPOSITORIES.to_string())
            .append_pair("sort", "updated")
            .append_pair("visibility", "all")
            .append_pair("affiliation", "owner,collaborator,organization_member");

        let response = self
            .authenticated_get_url(url, token)?
            .send()
            .await
            .map_err(|_| GitHubConnectionError::Network)?;
        let repositories: Vec<ApiRepository> = self
            .decode_json(response, MAX_REPOSITORIES_RESPONSE_BYTES)
            .await?;

        Ok(repositories
            .into_iter()
            .take(MAX_REPOSITORIES)
            .filter_map(repository_from_api)
            .collect())
    }

    /// Fetch a README only when its repository ID appears in the bounded list.
    pub async fn import_readme(
        &self,
        token: &str,
        repository_id: u64,
    ) -> Result<ImportedReadme, GitHubConnectionError> {
        validate_token(token)?;
        if repository_id == 0 {
            return Err(GitHubConnectionError::RepositoryNotListed);
        }
        let repository = self
            .list_repositories(token)
            .await?
            .into_iter()
            .find(|repository| repository.id == repository_id)
            .ok_or(GitHubConnectionError::RepositoryNotListed)?;

        let path = format!(
            "repos/{}/{}/readme",
            repository.owner_login(),
            repository.name
        );
        let response = self
            .authenticated_get(&path, token)?
            .send()
            .await
            .map_err(|_| GitHubConnectionError::Network)?;
        let readme: ApiReadme = self
            .decode_json(response, MAX_README_RESPONSE_BYTES)
            .await?;
        imported_readme(repository, readme)
    }

    fn authenticated_get(
        &self,
        path: &str,
        token: &str,
    ) -> Result<reqwest::RequestBuilder, GitHubConnectionError> {
        validate_token(token)?;
        self.client
            .request(
                Method::GET,
                path,
                token,
                &[
                    ("Accept", "application/vnd.github+json"),
                    ("X-GitHub-Api-Version", GITHUB_API_VERSION),
                ],
                None,
            )
            .map_err(map_transport_error)
    }

    fn authenticated_get_url(
        &self,
        url: Url,
        token: &str,
    ) -> Result<reqwest::RequestBuilder, GitHubConnectionError> {
        validate_token(token)?;
        self.client
            .request_url(
                Method::GET,
                url,
                token,
                &[
                    ("Accept", "application/vnd.github+json"),
                    ("X-GitHub-Api-Version", GITHUB_API_VERSION),
                ],
                None,
            )
            .map_err(map_transport_error)
    }

    fn api_url(&self, path: &str) -> Result<Url, GitHubConnectionError> {
        self.client.api_url(path).map_err(map_transport_error)
    }

    async fn decode_json<T: for<'de> Deserialize<'de>>(
        &self,
        response: reqwest::Response,
        max_bytes: usize,
    ) -> Result<T, GitHubConnectionError> {
        decode_json(response, max_bytes)
            .await
            .map_err(|error| match error {
                TransportError::HttpStatus(401 | 403) => GitHubConnectionError::RejectedCredentials,
                other => map_transport_error(other),
            })
    }
}

impl GitHubRepository {
    fn owner_login(&self) -> &str {
        self.full_name
            .split_once('/')
            .map(|(owner, _)| owner)
            .unwrap_or("")
    }
}

fn repository_from_api(repository: ApiRepository) -> Option<GitHubRepository> {
    if repository.id == 0
        || !valid_login(&repository.owner.login)
        || !valid_repository_name(&repository.name)
    {
        return None;
    }
    let full_name = format!("{}/{}", repository.owner.login, repository.name);
    let description = repository
        .description
        .map(|value| strip_controls(&value).chars().take(300).collect::<String>())
        .filter(|value| !value.is_empty());
    let url = format!("https://github.com/{full_name}");
    Some(GitHubRepository {
        id: repository.id,
        name: repository.name,
        full_name,
        private: repository.private,
        description,
        url,
    })
}

fn imported_readme(
    repository: GitHubRepository,
    readme: ApiReadme,
) -> Result<ImportedReadme, GitHubConnectionError> {
    let name = readme.name.to_ascii_lowercase();
    let path_name = readme
        .path
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !name.starts_with("readme")
        || !path_name.starts_with("readme")
        || readme.encoding != "base64"
    {
        return Err(GitHubConnectionError::InvalidResponse);
    }

    let compact = readme
        .content
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect::<Vec<_>>();
    if compact.len() > MAX_README_CONTENT_BYTES.div_ceil(3) * 4 + 8 {
        return Err(GitHubConnectionError::ResponseTooLarge);
    }
    let decoded = BASE64
        .decode(compact)
        .map_err(|_| GitHubConnectionError::InvalidResponse)?;
    if decoded.len() > MAX_README_CONTENT_BYTES {
        return Err(GitHubConnectionError::ResponseTooLarge);
    }
    let markdown =
        String::from_utf8(decoded).map_err(|_| GitHubConnectionError::InvalidResponse)?;
    let content = strip_controls(&markdown);
    if content.trim().is_empty() {
        return Err(GitHubConnectionError::InvalidResponse);
    }
    let (content, truncated) = apply_source_limit(
        &content,
        false,
        "[README truncated to fit Buzz's 40,000 UTF-16-unit source limit.]",
    );

    Ok(ImportedReadme {
        title: format!("{} README", repository.full_name),
        content,
        url: repository.url,
        kind: "url",
        truncated,
    })
}

fn valid_login(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 39
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && !value.starts_with('-')
        && !value.ends_with('-')
}

fn valid_repository_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn validate_token(token: &str) -> Result<(), GitHubConnectionError> {
    super::transport::validate_token(token).map_err(map_transport_error)
}

fn map_transport_error(error: TransportError) -> GitHubConnectionError {
    match error {
        TransportError::InvalidOrigin | TransportError::InvalidResponse => {
            GitHubConnectionError::InvalidResponse
        }
        TransportError::InvalidToken => GitHubConnectionError::InvalidToken,
        TransportError::Network => GitHubConnectionError::Network,
        TransportError::HttpStatus(status) => GitHubConnectionError::HttpStatus(status),
        TransportError::ResponseTooLarge => GitHubConnectionError::ResponseTooLarge,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
    };

    use axum::{
        body::Body,
        extract::State,
        http::{HeaderMap, StatusCode},
        response::Response,
        routing::get,
        Json, Router,
    };
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use futures_util::stream;
    use url::Url;

    use super::{
        CredentialStore, GitHubAdapter, GitHubConnectionError, MAX_README_CONTENT_BYTES,
        MAX_USER_RESPONSE_BYTES,
    };
    use crate::commands::business_connections::scope::ConnectionScope;
    use crate::commands::business_connections::source_text::BUSINESS_SOURCE_MAX_UTF16_UNITS;

    const TEST_TOKEN: &str = "ghp_test_token_12345678901234567890";
    const TEST_AUTHORIZATION: &str = "Bearer ghp_test_token_12345678901234567890";

    #[derive(Default)]
    struct MemoryCredentialStore(Mutex<HashMap<String, String>>);

    impl CredentialStore for MemoryCredentialStore {
        fn load(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self
                .0
                .lock()
                .map_err(|_| "test lock".to_string())?
                .get(key)
                .cloned())
        }

        fn store(&self, key: &str, value: &str) -> Result<(), String> {
            self.0
                .lock()
                .map_err(|_| "test lock".to_string())?
                .insert(key.to_string(), value.to_string());
            Ok(())
        }

        fn delete(&self, key: &str) -> Result<(), String> {
            self.0
                .lock()
                .map_err(|_| "test lock".to_string())?
                .remove(key);
            Ok(())
        }
    }

    fn scope() -> ConnectionScope {
        ConnectionScope::new(
            "wss://community.example".to_string(),
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string(),
        )
        .expect("valid test scope")
    }

    async fn serve(router: Router) -> (Url, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("fixture listener binds");
        let address = listener.local_addr().expect("fixture address");
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        (
            Url::parse(&format!("http://{address}/")).expect("fixture URL"),
            task,
        )
    }

    async fn successful_api() -> (Url, tokio::task::JoinHandle<()>) {
        async fn user(headers: HeaderMap) -> Result<Json<serde_json::Value>, StatusCode> {
            if headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                != Some(TEST_AUTHORIZATION)
            {
                return Err(StatusCode::UNAUTHORIZED);
            }
            Ok(Json(
                serde_json::json!({ "login": "octocat", "email": "private@example.com" }),
            ))
        }

        async fn repositories(headers: HeaderMap) -> Result<Json<serde_json::Value>, StatusCode> {
            if headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                != Some(TEST_AUTHORIZATION)
            {
                return Err(StatusCode::UNAUTHORIZED);
            }
            Ok(Json(serde_json::json!([
                {
                    "id": 42,
                    "name": "launchpad",
                    "full_name": "untrusted/ignored",
                    "owner": { "login": "acme" },
                    "private": true,
                    "description": "Widget\0 library",
                    "html_url": "https://attacker.example/redirect"
                },
                {
                    "id": 43,
                    "name": "../outside",
                    "owner": { "login": "acme" },
                    "private": true
                }
            ])))
        }

        async fn readme(headers: HeaderMap) -> Result<Json<serde_json::Value>, StatusCode> {
            if headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                != Some(TEST_AUTHORIZATION)
            {
                return Err(StatusCode::UNAUTHORIZED);
            }
            let encoded = BASE64.encode(b"# Acme\0\n\tRead-only adapter\n");
            Ok(Json(serde_json::json!({
                "name": "README.md",
                "path": "README.md",
                "encoding": "base64",
                "content": encoded,
                "html_url": "https://attacker.example/readme"
            })))
        }

        let router = Router::new()
            .route("/user", get(user))
            .route("/user/repos", get(repositories))
            .route("/repos/acme/launchpad/readme", get(readme));
        serve(router).await
    }

    #[tokio::test]
    async fn verifies_token_lists_bounded_repositories_and_sanitizes_imported_source() {
        let store = MemoryCredentialStore::default();
        let (origin, server) = successful_api().await;
        let adapter = GitHubAdapter::for_test(&store, origin).expect("adapter builds");
        let active_scope = scope();

        let account = adapter.verify_token(TEST_TOKEN).await.expect("valid token");
        assert_eq!(account.login, "octocat");
        adapter
            .save_verified_token(&active_scope, TEST_TOKEN)
            .expect("verified token saved");

        let status = adapter
            .status(&active_scope)
            .await
            .expect("status verifies token");
        assert!(status.connected);
        assert_eq!(status.login.as_deref(), Some("octocat"));

        let token = store
            .load(&active_scope.keyring_key("github"))
            .expect("test store read")
            .expect("token is stored");
        let repositories = adapter
            .list_repositories(&token)
            .await
            .expect("bounded repository list");
        assert_eq!(repositories.len(), 1);
        assert_eq!(repositories[0].full_name, "acme/launchpad");
        assert_eq!(repositories[0].url, "https://github.com/acme/launchpad");
        assert_eq!(
            repositories[0].description.as_deref(),
            Some("Widget library")
        );

        let source = adapter
            .import_readme(&token, 42)
            .await
            .expect("selected README imports");
        assert_eq!(source.title, "acme/launchpad README");
        assert_eq!(source.url, "https://github.com/acme/launchpad");
        assert_eq!(source.content, "# Acme\n\tRead-only adapter\n");
        assert_eq!(source.kind, "url");
        assert!(!source.truncated);
        server.abort();
    }

    #[tokio::test]
    async fn rejected_credentials_are_never_saved_or_reported_connected() {
        async fn rejected() -> StatusCode {
            StatusCode::UNAUTHORIZED
        }
        let router = Router::new().route("/user", get(rejected));
        let (origin, server) = serve(router).await;
        let store = MemoryCredentialStore::default();
        let adapter = GitHubAdapter::for_test(&store, origin).expect("adapter builds");

        assert_eq!(
            adapter.verify_token(TEST_TOKEN).await.unwrap_err(),
            GitHubConnectionError::RejectedCredentials
        );
        assert!(store
            .load(&scope().keyring_key("github"))
            .expect("test store read")
            .is_none());
        server.abort();
    }

    #[tokio::test]
    async fn redirects_are_rejected_without_contacting_the_redirect_target() {
        async fn capture(State(count): State<Arc<AtomicUsize>>) -> Json<serde_json::Value> {
            count.fetch_add(1, Ordering::SeqCst);
            Json(serde_json::json!({ "login": "should-not-be-read" }))
        }
        let hits = Arc::new(AtomicUsize::new(0));
        let (target, target_task) = serve(
            Router::new()
                .route("/capture", get(capture))
                .with_state(Arc::clone(&hits)),
        )
        .await;

        async fn redirect(State(location): State<String>) -> Response<Body> {
            Response::builder()
                .status(StatusCode::FOUND)
                .header("Location", location)
                .body(Body::empty())
                .expect("fixture response")
        }
        let redirect_target = target.join("capture").expect("target path").to_string();
        let (origin, redirect_task) = serve(
            Router::new()
                .route("/user", get(redirect))
                .with_state(redirect_target),
        )
        .await;
        let store = MemoryCredentialStore::default();
        let adapter = GitHubAdapter::for_test(&store, origin).expect("adapter builds");

        assert_eq!(
            adapter.verify_token(TEST_TOKEN).await.unwrap_err(),
            GitHubConnectionError::HttpStatus(StatusCode::FOUND.as_u16())
        );
        assert_eq!(hits.load(Ordering::SeqCst), 0);
        redirect_task.abort();
        target_task.abort();
    }

    #[tokio::test]
    async fn network_errors_remain_errors_and_do_not_create_a_connection() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("unused port binds");
        let address = listener.local_addr().expect("unused port address");
        drop(listener);
        let origin = Url::parse(&format!("http://{address}/")).expect("fixture URL");
        let store = MemoryCredentialStore::default();
        let adapter = GitHubAdapter::for_test(&store, origin).expect("adapter builds");

        assert_eq!(
            adapter.verify_token(TEST_TOKEN).await.unwrap_err(),
            GitHubConnectionError::Network
        );
        assert!(store
            .load(&scope().keyring_key("github"))
            .expect("test store read")
            .is_none());
    }

    #[tokio::test]
    async fn oversized_http_bodies_are_rejected_before_json_parsing() {
        async fn oversized() -> Response<Body> {
            let body = Body::from_stream(stream::iter([Ok::<_, std::io::Error>(vec![
                b'x';
                MAX_USER_RESPONSE_BYTES
                    + 1
            ])]));
            Response::builder()
                .status(StatusCode::OK)
                .body(body)
                .expect("fixture response")
        }
        let (origin, server) = serve(Router::new().route("/user", get(oversized))).await;
        let store = MemoryCredentialStore::default();
        let adapter = GitHubAdapter::for_test(&store, origin).expect("adapter builds");

        assert_eq!(
            adapter.verify_token(TEST_TOKEN).await.unwrap_err(),
            GitHubConnectionError::ResponseTooLarge
        );
        server.abort();
    }

    #[tokio::test]
    async fn local_revoke_clears_only_the_selected_scope_and_status_stops_connecting() {
        let store = MemoryCredentialStore::default();
        let (origin, server) = successful_api().await;
        let adapter = GitHubAdapter::for_test(&store, origin).expect("adapter builds");
        let active_scope = scope();
        let other_scope = ConnectionScope::new(
            "wss://other-community.example".to_string(),
            active_scope.pubkey.clone(),
        )
        .expect("valid other scope");
        adapter
            .save_verified_token(&active_scope, TEST_TOKEN)
            .expect("save test token");
        store
            .store(&other_scope.keyring_key("github"), "other-scope-token")
            .expect("save other scoped token");

        adapter.revoke(&active_scope).expect("local revoke");
        let status = adapter
            .status(&active_scope)
            .await
            .expect("unconfigured status");
        assert!(!status.connected);
        assert!(store
            .load(&other_scope.keyring_key("github"))
            .expect("read other scoped token")
            .is_some());
        server.abort();
    }

    #[tokio::test]
    async fn readme_content_limit_is_enforced_after_base64_decode() {
        let oversized = vec![b'a'; MAX_README_CONTENT_BYTES + 1];
        let payload = super::ApiReadme {
            name: "README.md".to_string(),
            path: "README.md".to_string(),
            encoding: "base64".to_string(),
            content: BASE64.encode(oversized),
        };
        let repository = super::GitHubRepository {
            id: 42,
            name: "launchpad".to_string(),
            full_name: "acme/launchpad".to_string(),
            private: false,
            description: None,
            url: "https://github.com/acme/launchpad".to_string(),
        };

        assert_eq!(
            super::imported_readme(repository, payload).unwrap_err(),
            GitHubConnectionError::ResponseTooLarge
        );
    }

    #[test]
    fn readme_import_truncates_to_business_source_utf16_limit_with_marker() {
        let content = "🧭".repeat(BUSINESS_SOURCE_MAX_UTF16_UNITS / 2 + 5);
        let payload = super::ApiReadme {
            name: "README.md".to_string(),
            path: "README.md".to_string(),
            encoding: "base64".to_string(),
            content: BASE64.encode(content.as_bytes()),
        };
        let repository = super::GitHubRepository {
            id: 42,
            name: "launchpad".to_string(),
            full_name: "acme/launchpad".to_string(),
            private: false,
            description: None,
            url: "https://github.com/acme/launchpad".to_string(),
        };

        let imported = super::imported_readme(repository, payload).expect("bounded README");
        assert!(imported.truncated);
        assert!(imported.content.encode_utf16().count() <= BUSINESS_SOURCE_MAX_UTF16_UNITS);
        assert!(imported
            .content
            .ends_with("40,000 UTF-16-unit source limit.]"));
        assert!(!imported.content.contains('\u{fffd}'));
    }
}
