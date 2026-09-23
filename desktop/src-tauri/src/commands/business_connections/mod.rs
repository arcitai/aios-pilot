mod adapter;
mod scope;

use tauri::State;
use zeroize::{Zeroize, Zeroizing};

use crate::{app_state::AppState, relay, secret_store::SecretStore};

pub use self::adapter::{GitHubAccount, GitHubConnectionStatus, GitHubRepository, ImportedReadme};
use self::{
    adapter::{CredentialStore, GitHubAdapter},
    scope::{require_matching_scope, ConnectionScope},
};

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
    expected_pubkey: &str,
    state: &AppState,
) -> Result<ConnectionScope, String> {
    let active = active_scope(state)?;
    require_matching_scope(expected_relay_url, expected_pubkey, &active)?;
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

/// Verify the saved token with GitHub; a keyring entry alone never means connected.
#[tauri::command]
pub async fn get_github_connection_status(
    expected_relay_url: String,
    expected_pubkey: String,
    state: State<'_, AppState>,
) -> Result<GitHubConnectionStatus, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_pubkey, &state)?;
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
    expected_pubkey: String,
    state: State<'_, AppState>,
) -> Result<GitHubAccount, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_pubkey, &state)?;
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
    expected_pubkey: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let scope = require_active_scope(&expected_relay_url, &expected_pubkey, &state)?;
    github_adapter()?
        .revoke(&scope)
        .map_err(|error| error.to_string())
}

/// List the first 25 accessible repositories; this operation is read-only.
#[tauri::command]
pub async fn list_github_repositories(
    expected_relay_url: String,
    expected_pubkey: String,
    state: State<'_, AppState>,
) -> Result<Vec<GitHubRepository>, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_pubkey, &state)?;
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
    expected_pubkey: String,
    state: State<'_, AppState>,
) -> Result<ImportedReadme, String> {
    let scope = require_active_scope(&expected_relay_url, &expected_pubkey, &state)?;
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
