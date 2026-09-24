mod adapter;
mod google_drive;
mod notion;
mod notion_content;
mod scope;
mod slack;
mod slack_content;
mod source_text;
mod transport;

use std::{fs::File, io::Read};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use zeroize::{Zeroize, Zeroizing};

use crate::{app_state::AppState, relay, secret_store::SecretStore};

pub use self::adapter::{GitHubAccount, GitHubConnectionStatus, GitHubRepository, ImportedReadme};
pub use self::google_drive::{
    GoogleDriveConnectionStatus, GoogleDriveOAuthClientConfig, GoogleDriveSearchResult,
    ImportedGoogleDoc,
};
pub use self::notion::{
    ImportedNotionPage, NotionAccount, NotionConnectionStatus, NotionPageSearchResult,
};
pub use self::slack::{
    ImportedSlackHistory, SlackChannelListResult, SlackConnectionStatus, SlackWorkspaceAccount,
};
use self::{
    adapter::{CredentialStore, GitHubAdapter},
    google_drive::{validate_configured_client_id, GoogleConnectionError, GoogleDriveAdapter},
    notion::NotionAdapter,
    scope::{require_matching_scope, ConnectionScope},
    slack::SlackAdapter,
};

const GOOGLE_DRIVE_OAUTH_CONFIG_FILE: &str = "google-drive-oauth.json";
const GOOGLE_DRIVE_OAUTH_CONFIG_MAX_BYTES: u64 = 4096;

impl CredentialStore for SecretStore {
    fn load(&self, key: &str) -> Result<Option<String>, String> {
        SecretStore::load(self, key)
    }

    fn store(&self, key: &str, value: &str) -> Result<(), String> {
        SecretStore::store(self, key, value)
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        SecretStore::delete(self, key)
    }
}

fn active_scope(state: &AppState) -> Result<ConnectionScope, String> {
    let keys = state.signing_keys()?;
    ConnectionScope::new(
        relay::relay_ws_url_with_override(state),
        keys.public_key().to_hex(),
    )
}

fn require_active_scope(
    expected_relay_url: &str,
    expected_signer_pubkey: &str,
    state: &AppState,
) -> Result<ConnectionScope, String> {
    let active = active_scope(state)?;
    require_matching_scope(expected_relay_url, expected_signer_pubkey, &active)?;
    Ok(active)
}

fn ensure_scope_is_current(scope: &ConnectionScope, state: &AppState) -> Result<(), String> {
    let current = active_scope(state)?;
    if &current != scope {
        return Err("active community or identity changed during the request".to_string());
    }
    Ok(())
}

fn github_adapter() -> Result<GitHubAdapter<'static>, String> {
    // Share the same build-specific blob as identity and managed-agent secrets;
    // keyring_service() selects the isolated demo service for demo builds.
    GitHubAdapter::new(SecretStore::shared(crate::app_state::keyring_service()))
        .map_err(|error| error.to_string())
}

fn notion_adapter() -> Result<NotionAdapter<'static>, String> {
    NotionAdapter::new(SecretStore::shared(crate::app_state::keyring_service()))
        .map_err(|error| error.to_string())
}

fn slack_adapter() -> Result<SlackAdapter<'static>, String> {
    // Slack bot tokens use the same build-specific, scope-keyed OS keyring.
    SlackAdapter::new(SecretStore::shared(crate::app_state::keyring_service()))
        .map_err(|error| error.to_string())
}

fn google_drive_adapter() -> Result<GoogleDriveAdapter<'static>, String> {
    GoogleDriveAdapter::new(SecretStore::shared(crate::app_state::keyring_service()))
        .map_err(|error| error.to_string())
}

fn google_drive_oauth_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(GOOGLE_DRIVE_OAUTH_CONFIG_FILE))
        .map_err(|error| format!("could not locate Buzz's local configuration directory: {error}"))
}

fn read_google_drive_client_id(app: &AppHandle) -> Result<Option<String>, String> {
    let path = google_drive_oauth_config_path(app)?;
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("could not read the local Google Drive configuration".to_string()),
    };
    if file
        .metadata()
        .map_err(|_| "could not read the local Google Drive configuration".to_string())?
        .len()
        > GOOGLE_DRIVE_OAUTH_CONFIG_MAX_BYTES
    {
        return Err("the local Google Drive configuration is too large".to_string());
    }
    let mut bytes = Vec::new();
    file.take(GOOGLE_DRIVE_OAUTH_CONFIG_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "could not read the local Google Drive configuration".to_string())?;
    if bytes.len() as u64 > GOOGLE_DRIVE_OAUTH_CONFIG_MAX_BYTES {
        return Err("the local Google Drive configuration is too large".to_string());
    }
    let config: GoogleDriveOAuthClientConfig = serde_json::from_slice(&bytes)
        .map_err(|_| "the local Google Drive configuration is invalid".to_string())?;
    validate_configured_client_id(&config.client_id).map_err(|error| error.to_string())?;
    Ok(Some(config.client_id))
}

/// Read the installation-local public Google Desktop OAuth client ID.
#[tauri::command]
pub fn get_google_drive_oauth_client_id(app: AppHandle) -> Result<Option<String>, String> {
    read_google_drive_client_id(&app)
}

/// Save only the public Google Desktop OAuth client ID in Buzz app config.
#[tauri::command]
pub fn set_google_drive_oauth_client_id(
    app: AppHandle,
    client_id: String,
) -> Result<String, String> {
    validate_configured_client_id(&client_id).map_err(|error| error.to_string())?;
    let path = google_drive_oauth_config_path(&app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "could not locate Buzz's local configuration directory".to_string())?;
    std::fs::create_dir_all(directory)
        .map_err(|_| "could not create Buzz's local configuration directory".to_string())?;
    let payload = serde_json::to_vec(&GoogleDriveOAuthClientConfig {
        client_id: client_id.clone(),
    })
    .map_err(|_| "could not encode the local Google Drive configuration".to_string())?;
    crate::managed_agents::storage::atomic_write_json_restricted(&path, &payload)?;
    Ok(client_id)
}

/// Verify the saved token with GitHub; a keyring entry alone never means connected.
#[tauri::command]
pub async fn get_github_connection_status(
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<GitHubConnectionStatus, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let status = github_adapter()?
        .status(&scope)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(status)
}

/// Verify a read-only PAT through GET /user, then save it in the OS keyring.
#[tauri::command]
pub async fn connect_github_connection(
    token: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<GitHubAccount, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let adapter = github_adapter()?;
    let mut submitted = Zeroizing::new(token);
    let normalized_token = submitted.trim().to_string();
    submitted.zeroize();
    let token = Zeroizing::new(normalized_token);

    let account = adapter
        .verify_token(&token)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    adapter
        .save_verified_token(&scope, &token)
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(account)
}

/// Remove only this community and identity's GitHub credential from the keyring.
#[tauri::command]
pub fn revoke_github_connection(
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    github_adapter()?
        .revoke(&scope)
        .map_err(|error| error.to_string())
}

/// List the first 25 accessible repositories; this operation is read-only.
#[tauri::command]
pub async fn list_github_repositories(
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<Vec<GitHubRepository>, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let adapter = github_adapter()?;
    let token = Zeroizing::new(
        adapter
            .load_token(&scope)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                "GitHub is not connected for this community and identity.".to_string()
            })?,
    );
    let repositories = adapter
        .list_repositories(&token)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(repositories)
}

/// Import a README only for a repository in the bounded accessible list.
#[tauri::command]
pub async fn import_github_readme(
    repository_id: u64,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<ImportedReadme, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let adapter = github_adapter()?;
    let token = Zeroizing::new(
        adapter
            .load_token(&scope)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                "GitHub is not connected for this community and identity.".to_string()
            })?,
    );
    let source = adapter
        .import_readme(&token, repository_id)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(source)
}

/// Verify the saved Notion integration token before reporting a connection.
#[tauri::command]
pub async fn get_notion_connection_status(
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<NotionConnectionStatus, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let status = notion_adapter()?
        .status(&scope)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(status)
}

/// Verify a read-only Notion internal integration token, then save it locally.
#[tauri::command]
pub async fn connect_notion_connection(
    token: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<NotionAccount, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let adapter = notion_adapter()?;
    let mut submitted = Zeroizing::new(token);
    let normalized_token = submitted.trim().to_string();
    submitted.zeroize();
    let token = Zeroizing::new(normalized_token);
    let account = adapter
        .verify_token(&token)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    adapter
        .save_verified_token(&scope, &token)
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(account)
}

/// Remove only this community and identity's Notion token from the keyring.
#[tauri::command]
pub fn revoke_notion_connection(
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    notion_adapter()?
        .revoke(&scope)
        .map_err(|error| error.to_string())
}

/// Search only accessible Notion pages, using a bounded opaque pagination cursor.
#[tauri::command]
pub async fn search_notion_pages(
    query: String,
    cursor: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<NotionPageSearchResult, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let adapter = notion_adapter()?;
    let token = Zeroizing::new(
        adapter
            .load_token(&scope)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                "Notion is not connected for this community and identity.".to_string()
            })?,
    );
    let pages = adapter
        .search_pages(&token, &query, cursor.as_deref())
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(pages)
}

/// Import text from one selected page ID; arbitrary URLs are never accepted.
#[tauri::command]
pub async fn import_notion_page(
    page_id: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<ImportedNotionPage, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let adapter = notion_adapter()?;
    let token = Zeroizing::new(
        adapter
            .load_token(&scope)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                "Notion is not connected for this community and identity.".to_string()
            })?,
    );
    let source = adapter
        .import_page(&token, &page_id)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(source)
}

/// Verify the manually supplied Slack bot token before saving it locally.
#[tauri::command]
pub async fn get_slack_connection_status(
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<SlackConnectionStatus, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let status = slack_adapter()?
        .status(&scope)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(status)
}

/// Verify a Slack bot token with auth.test and store it in the scoped keyring.
#[tauri::command]
pub async fn connect_slack_connection(
    token: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<SlackWorkspaceAccount, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let adapter = slack_adapter()?;
    let mut submitted = Zeroizing::new(token);
    let normalized_token = submitted.trim().to_string();
    submitted.zeroize();
    let token = Zeroizing::new(normalized_token);
    let account = adapter
        .verify_token(&token)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    adapter
        .save_verified_token(&scope, &token)
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(account)
}

/// Remove only this community and identity's Slack bot token from the keyring.
#[tauri::command]
pub fn revoke_slack_connection(
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    slack_adapter()?
        .revoke(&scope)
        .map_err(|error| error.to_string())
}

/// List one bounded page of channels the bot already belongs to; never join.
#[tauri::command]
pub async fn list_slack_channels(
    cursor: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<SlackChannelListResult, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let adapter = slack_adapter()?;
    let token = Zeroizing::new(
        adapter
            .load_token(&scope)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Slack is not connected for this community and identity.".to_string())?,
    );
    let channels = adapter
        .list_channels(&token, cursor.as_deref())
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(channels)
}

/// Import recent text from exactly one selected Slack channel.
#[tauri::command]
pub async fn import_slack_channel_history(
    channel_id: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<ImportedSlackHistory, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let adapter = slack_adapter()?;
    let token = Zeroizing::new(
        adapter
            .load_token(&scope)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Slack is not connected for this community and identity.".to_string())?,
    );
    let source = adapter
        .import_channel_history(&token, &channel_id)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(source)
}

/// Run Google Desktop OAuth in the system browser and store verified tokens locally.
#[tauri::command]
pub async fn connect_google_drive_connection(
    app: AppHandle,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<GoogleDriveConnectionStatus, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let client_id = read_google_drive_client_id(&app)?
        .ok_or_else(|| "Set up a Google Desktop OAuth client ID first.".to_string())?;
    google_drive_adapter()?
        .connect(
            &scope,
            &client_id,
            |url| app.opener().open_url(url, None::<&str>).map_err(|_| ()),
            || {
                ensure_scope_is_current(&scope, &state)
                    .map_err(|_| GoogleConnectionError::ActiveScopeChanged)
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(GoogleDriveConnectionStatus { connected: true })
}

/// Verify a saved Google token using only Drive's minimal about resource.
#[tauri::command]
pub async fn get_google_drive_connection_status(
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<GoogleDriveConnectionStatus, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let status = google_drive_adapter()?
        .status(&scope)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(status)
}

/// Remove only this community and identity's local Google token pair.
#[tauri::command]
pub fn revoke_google_drive_connection(
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    google_drive_adapter()?
        .revoke(&scope)
        .map_err(|error| error.to_string())
}

/// Search a bounded page of Google Docs by title using Drive's read-only API.
#[tauri::command]
pub async fn search_google_drive_files(
    query: String,
    cursor: Option<String>,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<GoogleDriveSearchResult, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let result = google_drive_adapter()?
        .search_files(&scope, &query, cursor.as_deref())
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(result)
}

/// Import text only from the Google Doc ID explicitly selected in the UI.
#[tauri::command]
pub async fn import_google_drive_document(
    file_id: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<ImportedGoogleDoc, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_signer_pubkey, &state)?;
    let source = google_drive_adapter()?
        .import_document(&scope, &file_id)
        .await
        .map_err(|error| error.to_string())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(source)
}
