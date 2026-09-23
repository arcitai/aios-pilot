use std::{fmt, time::Duration};

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;
use zeroize::Zeroizing;

use super::{
    adapter::CredentialStore,
    notion_content::{
        normalize_uuid, page_summary_from_api, page_title, render_block, safe_label, safe_page_url,
        sanitize_query,
    },
    scope::ConnectionScope,
    source_text::apply_source_limit,
    transport::{decode_json, decode_json_counted, ProviderHttpClient, TransportError},
};

const NOTION_API_ORIGIN: &str = "https://api.notion.com/";
const NOTION_API_VERSION: &str = "2026-03-11";
const MAX_USER_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_SEARCH_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_IMPORT_RESPONSE_BYTES: usize = 512 * 1024;
const MAX_TOTAL_IMPORT_BYTES: usize = 4 * 1024 * 1024;
const MAX_SEARCH_RESULTS: usize = 25;
const MAX_CHILDREN_PAGES: usize = 8;
const MAX_BLOCKS: usize = 400;
const MAX_BLOCK_DEPTH: u8 = 2;
const PAGE_SIZE: usize = 100;
const IMPORT_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum NotionConnectionError {
    InvalidToken,
    InvalidPageId,
    InvalidCursor,
    RejectedCredentials,
    Network,
    HttpStatus(u16),
    ResponseTooLarge,
    InvalidResponse,
    Timeout,
    Store,
}

impl fmt::Display for NotionConnectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidToken => write!(formatter, "Enter a valid Notion integration token."),
            Self::InvalidPageId => write!(formatter, "Select a valid Notion page."),
            Self::InvalidCursor => write!(formatter, "Notion returned an invalid page cursor."),
            Self::RejectedCredentials => write!(
                formatter,
                "Notion rejected this token or the connection lacks read-content access."
            ),
            Self::Network => write!(formatter, "Could not reach Notion. Check the connection."),
            Self::HttpStatus(status) => write!(formatter, "Notion returned HTTP {status}."),
            Self::ResponseTooLarge => write!(formatter, "Notion returned too much data to import."),
            Self::InvalidResponse => write!(formatter, "Notion returned an invalid response."),
            Self::Timeout => write!(formatter, "The Notion import exceeded its time limit."),
            Self::Store => write!(formatter, "Buzz could not access the OS keyring."),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionAccount {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionConnectionStatus {
    pub connected: bool,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionPageSummary {
    pub id: String,
    pub title: String,
    pub url: String,
    pub last_edited_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotionPageSearchResult {
    pub pages: Vec<NotionPageSummary>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedNotionPage {
    pub title: String,
    pub content: String,
    pub url: String,
    pub kind: &'static str,
    pub truncated: bool,
}

#[derive(Deserialize)]
struct ApiUser {
    id: String,
    name: Option<String>,
}

#[derive(Deserialize)]
struct ApiSearchResult {
    #[serde(default)]
    results: Vec<Value>,
    #[serde(default)]
    has_more: bool,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
struct ApiBlockChildren {
    #[serde(default)]
    results: Vec<Value>,
    #[serde(default)]
    has_more: bool,
    next_cursor: Option<String>,
}

/// Read-only Notion API adapter. It accepts only the fixed API origin and keeps
/// the integration token in the existing workspace-scoped OS keyring.
pub(super) struct NotionAdapter<'a> {
    client: ProviderHttpClient,
    credentials: &'a dyn CredentialStore,
    import_timeout: Duration,
}

impl<'a> NotionAdapter<'a> {
    pub fn new(credentials: &'a dyn CredentialStore) -> Result<Self, NotionConnectionError> {
        let origin =
            Url::parse(NOTION_API_ORIGIN).map_err(|_| NotionConnectionError::InvalidResponse)?;
        let client = ProviderHttpClient::new(origin).map_err(map_transport_error)?;
        Ok(Self {
            client,
            credentials,
            import_timeout: IMPORT_TIMEOUT,
        })
    }

    #[cfg(test)]
    fn for_test(
        credentials: &'a dyn CredentialStore,
        origin: Url,
    ) -> Result<Self, NotionConnectionError> {
        Self::for_test_with_timeout(credentials, origin, IMPORT_TIMEOUT)
    }

    #[cfg(test)]
    fn for_test_with_timeout(
        credentials: &'a dyn CredentialStore,
        origin: Url,
        import_timeout: Duration,
    ) -> Result<Self, NotionConnectionError> {
        let client = ProviderHttpClient::for_test(origin).map_err(map_transport_error)?;
        Ok(Self {
            client,
            credentials,
            import_timeout,
        })
    }

    pub fn load_token(
        &self,
        scope: &ConnectionScope,
    ) -> Result<Option<String>, NotionConnectionError> {
        self.credentials
            .load(&scope.keyring_key("notion"))
            .map_err(|_| NotionConnectionError::Store)
    }

    pub fn save_verified_token(
        &self,
        scope: &ConnectionScope,
        token: &str,
    ) -> Result<(), NotionConnectionError> {
        validate_token(token)?;
        self.credentials
            .store(&scope.keyring_key("notion"), token)
            .map_err(|_| NotionConnectionError::Store)
    }

    pub fn revoke(&self, scope: &ConnectionScope) -> Result<(), NotionConnectionError> {
        self.credentials
            .delete(&scope.keyring_key("notion"))
            .map_err(|_| NotionConnectionError::Store)
    }

    pub async fn verify_token(&self, token: &str) -> Result<NotionAccount, NotionConnectionError> {
        validate_token(token)?;
        let response = self
            .request(Method::GET, "users/me", token, None)?
            .send()
            .await
            .map_err(|_| NotionConnectionError::Network)?;
        let user: ApiUser = decode_json(response, MAX_USER_RESPONSE_BYTES)
            .await
            .map_err(map_transport_error)?;
        let id = normalize_uuid(&user.id).ok_or(NotionConnectionError::InvalidResponse)?;
        let name = user
            .name
            .as_deref()
            .map(safe_label)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Notion integration".to_string());
        Ok(NotionAccount { id, name })
    }

    pub async fn status(
        &self,
        scope: &ConnectionScope,
    ) -> Result<NotionConnectionStatus, NotionConnectionError> {
        let Some(token) = self.load_token(scope)? else {
            return Ok(NotionConnectionStatus {
                connected: false,
                name: None,
            });
        };
        let token = Zeroizing::new(token);
        let account = self.verify_token(&token).await?;
        Ok(NotionConnectionStatus {
            connected: true,
            name: Some(account.name),
        })
    }

    pub async fn search_pages(
        &self,
        token: &str,
        query: &str,
        cursor: Option<&str>,
    ) -> Result<NotionPageSearchResult, NotionConnectionError> {
        validate_token(token)?;
        let query = sanitize_query(query);
        if let Some(cursor) = cursor {
            validate_cursor(cursor)?;
        }
        let mut body = json!({
            "query": query,
            "filter": { "property": "object", "value": "page" },
            "sort": { "direction": "descending", "timestamp": "last_edited_time" },
            "page_size": MAX_SEARCH_RESULTS
        });
        if let Some(cursor) = cursor {
            body["start_cursor"] = Value::String(cursor.to_string());
        }
        let response = self
            .request(Method::POST, "search", token, Some(body))?
            .send()
            .await
            .map_err(|_| NotionConnectionError::Network)?;
        let result: ApiSearchResult = decode_json(response, MAX_SEARCH_RESPONSE_BYTES)
            .await
            .map_err(map_transport_error)?;
        if result.results.len() > MAX_SEARCH_RESULTS {
            return Err(NotionConnectionError::InvalidResponse);
        }
        let pages = result
            .results
            .into_iter()
            .filter_map(page_summary_from_api)
            .collect();
        let next_cursor = match (result.has_more, result.next_cursor) {
            (true, Some(cursor)) => {
                validate_cursor(&cursor).map_err(|_| NotionConnectionError::InvalidResponse)?;
                Some(cursor)
            }
            (true, None) => return Err(NotionConnectionError::InvalidResponse),
            (false, _) => None,
        };
        Ok(NotionPageSearchResult {
            pages,
            has_more: result.has_more,
            next_cursor,
        })
    }

    pub async fn import_page(
        &self,
        token: &str,
        page_id: &str,
    ) -> Result<ImportedNotionPage, NotionConnectionError> {
        validate_token(token)?;
        let page_id = normalize_uuid(page_id).ok_or(NotionConnectionError::InvalidPageId)?;
        tokio::time::timeout(
            self.import_timeout,
            self.import_page_with_deadline(token, &page_id),
        )
        .await
        .map_err(|_| NotionConnectionError::Timeout)?
    }

    async fn import_page_with_deadline(
        &self,
        token: &str,
        page_id: &str,
    ) -> Result<ImportedNotionPage, NotionConnectionError> {
        let page_path = format!("pages/{page_id}");
        let response = self
            .request(Method::GET, &page_path, token, None)?
            .send()
            .await
            .map_err(|_| NotionConnectionError::Network)?;
        let (page, mut total_bytes): (Value, usize) =
            decode_json_counted(response, MAX_IMPORT_RESPONSE_BYTES)
                .await
                .map_err(map_transport_error)?;
        if total_bytes > MAX_TOTAL_IMPORT_BYTES {
            return Err(NotionConnectionError::ResponseTooLarge);
        }
        if page.get("object").and_then(Value::as_str) != Some("page")
            || page
                .get("id")
                .and_then(Value::as_str)
                .and_then(normalize_uuid)
                .as_deref()
                != Some(page_id)
        {
            return Err(NotionConnectionError::InvalidResponse);
        }
        let title = page_title(&page).ok_or(NotionConnectionError::InvalidResponse)?;
        let source_url = page
            .get("url")
            .and_then(Value::as_str)
            .and_then(|value| safe_page_url(page_id, value))
            .ok_or(NotionConnectionError::InvalidResponse)?;
        let mut content = format!("# {title}\n\n");
        let mut partial = false;
        let mut pages_fetched = 0;
        let mut blocks_seen = 0;
        let first_page = self.fetch_children_page(token, page_id, None).await?;
        pages_fetched += 1;
        total_bytes = total_bytes.saturating_add(first_page.bytes);
        if total_bytes > MAX_TOTAL_IMPORT_BYTES {
            partial = true;
        } else {
            let mut work = Vec::new();
            push_children_page(&mut work, first_page, page_id.to_string(), 1, &mut partial);
            while let Some(item) = work.pop() {
                match item {
                    ImportWork::Block(block, depth) => {
                        if blocks_seen >= MAX_BLOCKS {
                            partial = true;
                            continue;
                        }
                        blocks_seen += 1;
                        let (rendered, supported) = render_block(&block);
                        if !supported {
                            partial = true;
                        }
                        if !rendered.is_empty() {
                            content.push_str(&rendered);
                            if !rendered.ends_with('\n') {
                                content.push('\n');
                            }
                        }
                        let has_children = block
                            .get("has_children")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        if has_children {
                            if depth >= MAX_BLOCK_DEPTH {
                                partial = true;
                            } else if let Some(id) = block
                                .get("id")
                                .and_then(Value::as_str)
                                .and_then(normalize_uuid)
                            {
                                work.push(ImportWork::FetchChildren {
                                    block_id: id,
                                    cursor: None,
                                    depth: depth + 1,
                                });
                            } else {
                                partial = true;
                            }
                        }
                    }
                    ImportWork::FetchChildren {
                        block_id,
                        cursor,
                        depth,
                    } => {
                        if pages_fetched >= MAX_CHILDREN_PAGES
                            || blocks_seen >= MAX_BLOCKS
                            || total_bytes >= MAX_TOTAL_IMPORT_BYTES
                        {
                            partial = true;
                            continue;
                        }
                        let page = self
                            .fetch_children_page(token, &block_id, cursor.as_deref())
                            .await?;
                        pages_fetched += 1;
                        total_bytes = total_bytes.saturating_add(page.bytes);
                        if total_bytes > MAX_TOTAL_IMPORT_BYTES {
                            partial = true;
                            continue;
                        }
                        push_children_page(&mut work, page, block_id, depth, &mut partial);
                    }
                }
            }
        }
        if content.trim().is_empty() {
            return Err(NotionConnectionError::InvalidResponse);
        }
        let (content, truncated) = apply_source_limit(
            &content,
            partial,
            "[Notion page partially imported by Buzz; some blocks were omitted or limits were reached.]",
        );
        Ok(ImportedNotionPage {
            title,
            content,
            url: source_url,
            kind: "url",
            truncated,
        })
    }

    async fn fetch_children_page(
        &self,
        token: &str,
        block_id: &str,
        cursor: Option<&str>,
    ) -> Result<ChildrenPage, NotionConnectionError> {
        let path = format!("blocks/{block_id}/children");
        let mut url = self.client.api_url(&path).map_err(map_transport_error)?;
        url.query_pairs_mut()
            .append_pair("page_size", &PAGE_SIZE.to_string());
        if let Some(cursor) = cursor {
            validate_cursor(cursor)?;
            url.query_pairs_mut().append_pair("start_cursor", cursor);
        }
        let response = self
            .request_url(Method::GET, url, token)?
            .send()
            .await
            .map_err(|_| NotionConnectionError::Network)?;
        let (response, bytes): (ApiBlockChildren, usize) =
            decode_json_counted(response, MAX_IMPORT_RESPONSE_BYTES)
                .await
                .map_err(map_transport_error)?;
        Ok(ChildrenPage {
            results: response.results,
            has_more: response.has_more,
            next_cursor: response.next_cursor,
            bytes,
        })
    }

    fn request(
        &self,
        method: Method,
        path: &str,
        token: &str,
        body: Option<Value>,
    ) -> Result<reqwest::RequestBuilder, NotionConnectionError> {
        validate_token(token)?;
        self.client
            .request(method, path, token, notion_headers(), body)
            .map_err(map_transport_error)
    }

    fn request_url(
        &self,
        method: Method,
        url: Url,
        token: &str,
    ) -> Result<reqwest::RequestBuilder, NotionConnectionError> {
        validate_token(token)?;
        self.client
            .request_url(method, url, token, notion_headers(), None)
            .map_err(map_transport_error)
    }
}

struct ChildrenPage {
    results: Vec<Value>,
    has_more: bool,
    next_cursor: Option<String>,
    bytes: usize,
}

enum ImportWork {
    Block(Value, u8),
    FetchChildren {
        block_id: String,
        cursor: Option<String>,
        depth: u8,
    },
}

fn push_children_page(
    work: &mut Vec<ImportWork>,
    mut page: ChildrenPage,
    block_id: String,
    depth: u8,
    partial: &mut bool,
) {
    if page.results.len() > PAGE_SIZE {
        page.results.truncate(PAGE_SIZE);
        *partial = true;
    }
    if page.has_more {
        match page.next_cursor.take() {
            Some(cursor) if validate_cursor(&cursor).is_ok() => {
                work.push(ImportWork::FetchChildren {
                    block_id,
                    cursor: Some(cursor),
                    depth,
                });
            }
            _ => *partial = true,
        }
    }
    for block in page.results.into_iter().rev() {
        work.push(ImportWork::Block(block, depth));
    }
}

fn notion_headers() -> &'static [(&'static str, &'static str)] {
    &[
        ("Accept", "application/json"),
        ("Notion-Version", NOTION_API_VERSION),
    ]
}

fn validate_cursor(cursor: &str) -> Result<(), NotionConnectionError> {
    if cursor.is_empty() || cursor.len() > 512 || cursor.chars().any(char::is_control) {
        return Err(NotionConnectionError::InvalidCursor);
    }
    Ok(())
}

fn validate_token(token: &str) -> Result<(), NotionConnectionError> {
    super::transport::validate_token(token).map_err(map_transport_error)
}

fn map_transport_error(error: TransportError) -> NotionConnectionError {
    match error {
        TransportError::InvalidOrigin => NotionConnectionError::InvalidResponse,
        TransportError::InvalidToken => NotionConnectionError::InvalidToken,
        TransportError::Network => NotionConnectionError::Network,
        TransportError::HttpStatus(401 | 403) => NotionConnectionError::RejectedCredentials,
        TransportError::HttpStatus(status) => NotionConnectionError::HttpStatus(status),
        TransportError::ResponseTooLarge => NotionConnectionError::ResponseTooLarge,
        TransportError::InvalidResponse => NotionConnectionError::InvalidResponse,
    }
}

#[cfg(test)]
#[path = "notion_tests.rs"]
mod tests;
