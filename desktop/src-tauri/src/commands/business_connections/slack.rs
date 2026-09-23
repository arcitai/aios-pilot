use std::{fmt, time::Duration};

use reqwest::Method;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use url::Url;
use zeroize::Zeroizing;

use super::{
    adapter::CredentialStore,
    scope::ConnectionScope,
    slack_content::{
        channel_url, safe_channel_name, safe_message_text, safe_timestamp, safe_workspace_name,
        valid_channel_id, valid_team_id,
    },
    source_text::apply_source_limit,
    transport::{decode_json, ProviderHttpClient, TransportError},
};

const SLACK_API_ORIGIN: &str = "https://slack.com/api/";
const MAX_AUTH_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_CHANNEL_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_HISTORY_RESPONSE_BYTES: usize = 512 * 1024;
const MAX_CHANNELS_PER_PAGE: usize = 100;
const MAX_HISTORY_MESSAGES: usize = 15;
const MAX_CURSOR_BYTES: usize = 512;
const IMPORT_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum SlackConnectionError {
    InvalidToken,
    InvalidChannelId,
    InvalidCursor,
    RejectedCredentials,
    MissingScope,
    NotInChannel,
    RateLimited,
    Network,
    HttpStatus(u16),
    ResponseTooLarge,
    InvalidResponse,
    Timeout,
    Store,
}

impl fmt::Display for SlackConnectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidToken => write!(formatter, "Enter a valid Slack bot token."),
            Self::InvalidChannelId => write!(formatter, "Choose a valid Slack channel."),
            Self::InvalidCursor => write!(formatter, "Slack returned an invalid channel cursor."),
            Self::RejectedCredentials => write!(formatter, "Slack rejected this bot token."),
            Self::MissingScope => write!(
                formatter,
                "The Slack app needs the read permissions listed in the setup guide."
            ),
            Self::NotInChannel => write!(
                formatter,
                "Add the Slack app to this channel, then browse channels again."
            ),
            Self::RateLimited => write!(formatter, "Slack is limiting requests. Try again later."),
            Self::Network => write!(formatter, "Could not reach Slack. Check the connection."),
            Self::HttpStatus(status) => write!(formatter, "Slack returned HTTP {status}."),
            Self::ResponseTooLarge => write!(formatter, "Slack returned too much data to import."),
            Self::InvalidResponse => write!(formatter, "Slack returned an invalid response."),
            Self::Timeout => write!(formatter, "The Slack import exceeded its time limit."),
            Self::Store => write!(formatter, "Buzz could not access the OS keyring."),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlackWorkspaceAccount {
    pub team_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlackConnectionStatus {
    pub connected: bool,
    pub workspace_id: Option<String>,
    pub workspace_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlackChannel {
    pub id: String,
    pub name: String,
    pub is_private: bool,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlackChannelListResult {
    pub channels: Vec<SlackChannel>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSlackHistory {
    pub title: String,
    pub content: String,
    pub url: String,
    pub kind: &'static str,
    pub truncated: bool,
}

#[derive(Deserialize)]
struct ApiAuthTest {
    team: Option<String>,
    team_id: Option<String>,
}

#[derive(Deserialize)]
struct ApiChannelList {
    #[serde(default)]
    channels: Vec<ApiChannel>,
    response_metadata: Option<ApiResponseMetadata>,
}

#[derive(Deserialize)]
struct ApiChannelInfo {
    channel: ApiChannel,
}

#[derive(Deserialize)]
struct ApiChannel {
    id: String,
    name: String,
    is_archived: Option<bool>,
    is_member: Option<bool>,
    is_private: Option<bool>,
}

#[derive(Deserialize)]
struct ApiResponseMetadata {
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
struct ApiHistory {
    #[serde(default)]
    messages: Vec<ApiMessage>,
    #[serde(default)]
    has_more: bool,
    response_metadata: Option<ApiResponseMetadata>,
}

#[derive(Deserialize)]
struct ApiMessage {
    #[serde(rename = "type")]
    message_type: Option<String>,
    text: Option<String>,
    ts: Option<String>,
    user: Option<String>,
    bot_id: Option<String>,
    reply_count: Option<u64>,
    #[serde(default)]
    attachments: Vec<Value>,
    #[serde(default)]
    files: Vec<Value>,
}

/// Reusable read-only Slack adapter. Tauri commands and future local consumers
/// can share this API without adding Slack scopes to the agent tools bridge.
pub(super) struct SlackAdapter<'a> {
    client: ProviderHttpClient,
    credentials: &'a dyn CredentialStore,
    import_timeout: Duration,
}

impl<'a> SlackAdapter<'a> {
    pub fn new(credentials: &'a dyn CredentialStore) -> Result<Self, SlackConnectionError> {
        let origin =
            Url::parse(SLACK_API_ORIGIN).map_err(|_| SlackConnectionError::InvalidResponse)?;
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
    ) -> Result<Self, SlackConnectionError> {
        Self::for_test_with_timeout(credentials, origin, IMPORT_TIMEOUT)
    }

    #[cfg(test)]
    fn for_test_with_timeout(
        credentials: &'a dyn CredentialStore,
        origin: Url,
        import_timeout: Duration,
    ) -> Result<Self, SlackConnectionError> {
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
    ) -> Result<Option<String>, SlackConnectionError> {
        self.credentials
            .load(&scope.keyring_key("slack"))
            .map_err(|_| SlackConnectionError::Store)
    }

    pub fn save_verified_token(
        &self,
        scope: &ConnectionScope,
        token: &str,
    ) -> Result<(), SlackConnectionError> {
        validate_token(token)?;
        self.credentials
            .store(&scope.keyring_key("slack"), token)
            .map_err(|_| SlackConnectionError::Store)
    }

    pub fn revoke(&self, scope: &ConnectionScope) -> Result<(), SlackConnectionError> {
        self.credentials
            .delete(&scope.keyring_key("slack"))
            .map_err(|_| SlackConnectionError::Store)
    }

    pub async fn verify_token(
        &self,
        token: &str,
    ) -> Result<SlackWorkspaceAccount, SlackConnectionError> {
        validate_token(token)?;
        let response = self
            .client
            .request(Method::POST, "auth.test", token, api_headers(), None)
            .map_err(map_transport_error)?
            .send()
            .await
            .map_err(|_| SlackConnectionError::Network)?;
        let auth: ApiAuthTest = decode_api_response(response, MAX_AUTH_RESPONSE_BYTES).await?;
        let team_id = auth
            .team_id
            .filter(|value| valid_team_id(value))
            .ok_or(SlackConnectionError::InvalidResponse)?;
        let name = auth
            .team
            .as_deref()
            .map(safe_workspace_name)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Slack workspace".to_string());
        Ok(SlackWorkspaceAccount { team_id, name })
    }

    pub async fn status(
        &self,
        scope: &ConnectionScope,
    ) -> Result<SlackConnectionStatus, SlackConnectionError> {
        let Some(token) = self.load_token(scope)? else {
            return Ok(SlackConnectionStatus {
                connected: false,
                workspace_id: None,
                workspace_name: None,
            });
        };
        let token = Zeroizing::new(token);
        let workspace = self.verify_token(&token).await?;
        Ok(SlackConnectionStatus {
            connected: true,
            workspace_id: Some(workspace.team_id),
            workspace_name: Some(workspace.name),
        })
    }

    /// Return one explicitly requested page of non-archived channels containing
    /// this bot. DMs are excluded; the UI caps accumulated pages at 200 items.
    pub async fn list_channels(
        &self,
        token: &str,
        cursor: Option<&str>,
    ) -> Result<SlackChannelListResult, SlackConnectionError> {
        validate_token(token)?;
        if let Some(cursor) = cursor {
            validate_cursor(cursor)?;
        }
        let workspace = self.verify_token(token).await?;
        let limit = MAX_CHANNELS_PER_PAGE.to_string();
        let mut query = vec![
            ("limit", limit.as_str()),
            ("types", "public_channel,private_channel"),
            ("exclude_archived", "true"),
        ];
        if let Some(cursor) = cursor {
            query.push(("cursor", cursor));
        }
        let result: ApiChannelList = self
            .get_json(
                "conversations.list",
                token,
                &query,
                MAX_CHANNEL_RESPONSE_BYTES,
            )
            .await?;
        if result.channels.len() > MAX_CHANNELS_PER_PAGE {
            return Err(SlackConnectionError::InvalidResponse);
        }
        let channels = result
            .channels
            .into_iter()
            .filter_map(|channel| channel_from_api(channel, &workspace.team_id))
            .collect();
        let next_cursor = result
            .response_metadata
            .and_then(|metadata| metadata.next_cursor)
            .filter(|value| !value.is_empty());
        if let Some(cursor) = next_cursor.as_deref() {
            validate_cursor(cursor).map_err(|_| SlackConnectionError::InvalidResponse)?;
        }
        let has_more = next_cursor.is_some();
        Ok(SlackChannelListResult {
            channels,
            has_more,
            next_cursor,
        })
    }

    /// Import only the chosen channel's latest 15 top-level messages. The
    /// conversation is rechecked for current membership before history access.
    pub async fn import_channel_history(
        &self,
        token: &str,
        channel_id: &str,
    ) -> Result<ImportedSlackHistory, SlackConnectionError> {
        validate_token(token)?;
        if !valid_channel_id(channel_id) {
            return Err(SlackConnectionError::InvalidChannelId);
        }
        tokio::time::timeout(self.import_timeout, async {
            let workspace = self.verify_token(token).await?;
            self.import_channel_history_with_deadline(token, channel_id, &workspace.team_id)
                .await
        })
        .await
        .map_err(|_| SlackConnectionError::Timeout)?
    }

    async fn import_channel_history_with_deadline(
        &self,
        token: &str,
        channel_id: &str,
        team_id: &str,
    ) -> Result<ImportedSlackHistory, SlackConnectionError> {
        let channel_query = [("channel", channel_id)];
        let info: ApiChannelInfo = self
            .get_json(
                "conversations.info",
                token,
                &channel_query,
                MAX_AUTH_RESPONSE_BYTES,
            )
            .await?;
        if info.channel.id != channel_id
            || info.channel.is_member != Some(true)
            || info.channel.is_archived == Some(true)
            || info.channel.is_private.is_none()
        {
            return Err(SlackConnectionError::NotInChannel);
        }
        let name = safe_channel_name(&info.channel.name);
        if name.is_empty() {
            return Err(SlackConnectionError::InvalidResponse);
        }
        let limit = MAX_HISTORY_MESSAGES.to_string();
        let history_query = [("channel", channel_id), ("limit", limit.as_str())];
        let history: ApiHistory = self
            .get_json(
                "conversations.history",
                token,
                &history_query,
                MAX_HISTORY_RESPONSE_BYTES,
            )
            .await?;
        if history.messages.len() > MAX_HISTORY_MESSAGES {
            return Err(SlackConnectionError::InvalidResponse);
        }
        let mut partial = history.has_more;
        if let Some(cursor) = history
            .response_metadata
            .as_ref()
            .and_then(|metadata| metadata.next_cursor.as_deref())
            .filter(|value| !value.is_empty())
        {
            validate_cursor(cursor).map_err(|_| SlackConnectionError::InvalidResponse)?;
            partial = true;
        }

        let mut content = format!(
            "# Slack channel #{name}\n\nRecent messages from the channel you chose, in time order:\n\n"
        );
        let mut rendered_messages = 0;
        for message in history.messages.into_iter().rev() {
            if message.message_type.as_deref() != Some("message") {
                partial = true;
            }
            if message.reply_count.unwrap_or_default() > 0
                || !message.attachments.is_empty()
                || !message.files.is_empty()
            {
                partial = true;
            }
            let (Some(timestamp), Some(text)) = (message.ts.as_deref(), message.text.as_deref())
            else {
                partial = true;
                continue;
            };
            if !safe_timestamp(timestamp) {
                partial = true;
                continue;
            }
            let text = safe_message_text(text);
            if text.trim().is_empty() {
                partial = true;
                continue;
            }
            let author = message
                .user
                .or(message.bot_id)
                .filter(|value| valid_slack_actor(value))
                .unwrap_or_else(|| "Slack participant".to_string());
            content.push_str(&format!("[{timestamp}] {author}: {text}\n"));
            rendered_messages += 1;
        }
        if rendered_messages == 0 {
            content.push_str("No readable text messages were returned.\n");
        }
        let (content, truncated) = apply_source_limit(
            &content,
            partial,
            "[Slack history partially imported by Buzz; older messages, threads, or non-text content were omitted.]",
        );
        let url = channel_url(channel_id, team_id).ok_or(SlackConnectionError::InvalidChannelId)?;
        Ok(ImportedSlackHistory {
            title: format!("Slack #{name} recent messages"),
            content,
            url,
            kind: "url",
            truncated,
        })
    }

    async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        token: &str,
        query: &[(&str, &str)],
        max_bytes: usize,
    ) -> Result<T, SlackConnectionError> {
        validate_token(token)?;
        let mut url = self.client.api_url(path).map_err(map_transport_error)?;
        {
            let mut pairs = url.query_pairs_mut();
            for (key, value) in query {
                pairs.append_pair(key, value);
            }
        }
        let response = self
            .client
            .request_url(Method::GET, url, token, api_headers(), None)
            .map_err(map_transport_error)?
            .send()
            .await
            .map_err(|_| SlackConnectionError::Network)?;
        decode_api_response(response, max_bytes).await
    }
}

fn api_headers() -> &'static [(&'static str, &'static str)] {
    &[("Accept", "application/json")]
}

async fn decode_api_response<T: DeserializeOwned>(
    response: reqwest::Response,
    max_bytes: usize,
) -> Result<T, SlackConnectionError> {
    let value: Value = decode_json(response, max_bytes)
        .await
        .map_err(map_transport_error)?;
    if value.get("ok").and_then(Value::as_bool) != Some(true) {
        let api_error = value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or_default();
        return Err(map_api_error(api_error));
    }
    serde_json::from_value(value).map_err(|_| SlackConnectionError::InvalidResponse)
}

fn channel_from_api(channel: ApiChannel, team_id: &str) -> Option<SlackChannel> {
    if !valid_channel_id(&channel.id)
        || channel.is_member != Some(true)
        || channel.is_archived == Some(true)
    {
        return None;
    }
    let is_private = channel.is_private?;
    let name = safe_channel_name(&channel.name);
    if name.is_empty() {
        return None;
    }
    Some(SlackChannel {
        url: channel_url(&channel.id, team_id)?,
        id: channel.id,
        name,
        is_private,
    })
}

fn valid_slack_actor(value: &str) -> bool {
    (2..=32).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

fn validate_token(token: &str) -> Result<(), SlackConnectionError> {
    super::transport::validate_token(token).map_err(map_transport_error)?;
    if !token.starts_with("xoxb-") {
        return Err(SlackConnectionError::InvalidToken);
    }
    Ok(())
}

fn validate_cursor(cursor: &str) -> Result<(), SlackConnectionError> {
    if cursor.is_empty() || cursor.len() > MAX_CURSOR_BYTES || cursor.chars().any(char::is_control)
    {
        return Err(SlackConnectionError::InvalidCursor);
    }
    Ok(())
}

fn map_transport_error(error: TransportError) -> SlackConnectionError {
    match error {
        TransportError::InvalidOrigin | TransportError::InvalidResponse => {
            SlackConnectionError::InvalidResponse
        }
        TransportError::InvalidToken => SlackConnectionError::InvalidToken,
        TransportError::Network => SlackConnectionError::Network,
        TransportError::HttpStatus(401 | 403) => SlackConnectionError::RejectedCredentials,
        TransportError::HttpStatus(429) => SlackConnectionError::RateLimited,
        TransportError::HttpStatus(status) => SlackConnectionError::HttpStatus(status),
        TransportError::ResponseTooLarge => SlackConnectionError::ResponseTooLarge,
    }
}

fn map_api_error(error: &str) -> SlackConnectionError {
    match error {
        "invalid_auth" | "not_authed" | "token_expired" | "token_revoked" => {
            SlackConnectionError::RejectedCredentials
        }
        "missing_scope" => SlackConnectionError::MissingScope,
        "not_in_channel" | "channel_not_found" | "no_permission" => {
            SlackConnectionError::NotInChannel
        }
        "invalid_cursor" => SlackConnectionError::InvalidCursor,
        "ratelimited" => SlackConnectionError::RateLimited,
        _ => SlackConnectionError::InvalidResponse,
    }
}

#[cfg(test)]
#[path = "slack_tests.rs"]
mod tests;
