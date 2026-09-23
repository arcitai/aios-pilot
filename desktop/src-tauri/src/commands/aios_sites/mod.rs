mod client;
mod scope;
mod types;

use reqwest::Method;
use tauri::State;
use url::Url;
use zeroize::{Zeroize, Zeroizing};

use crate::{app_state::AppState, relay, secret_store::SecretStore};

use self::{
    client::{
        checked_public_url, decode_success, fetch_health, preview_body, publish_body,
        send_authenticated, validate_site, validate_token, verify_public_404, RevokeResponse,
        API_PREFIX,
    },
    scope::{require_matching_scope, PublisherScope},
};

pub use self::types::{
    SitesPublisherConnectionStatus, SitesPublisherFiles, SitesPublisherPreview,
    SitesPublisherResult, SitesPublisherSiteStatus,
};

fn active_scope(state: &AppState, manager_url: &str) -> Result<PublisherScope, String> {
    let keys = state.signing_keys()?;
    PublisherScope::new(
        manager_url,
        relay::relay_ws_url_with_override(state),
        keys.public_key().to_hex(),
    )
}

fn require_active_scope(
    manager_url: &str,
    expected_relay_url: &str,
    expected_signer_pubkey: &str,
    state: &AppState,
) -> Result<PublisherScope, String> {
    let active = active_scope(state, manager_url)?;
    require_matching_scope(expected_relay_url, expected_signer_pubkey, &active)?;
    Ok(active)
}

fn ensure_scope_is_current(scope: &PublisherScope, state: &AppState) -> Result<(), String> {
    let keys = state.signing_keys()?;
    let current = PublisherScope::new(
        &scope.manager_origin,
        relay::relay_ws_url_with_override(state),
        keys.public_key().to_hex(),
    )?;
    if &current != scope {
        return Err(
            "The active community or identity changed during the Sites request.".to_string(),
        );
    }
    Ok(())
}

fn secret_store() -> &'static SecretStore {
    SecretStore::shared(crate::app_state::keyring_service())
}

fn load_token(scope: &PublisherScope) -> Result<Option<Zeroizing<String>>, String> {
    secret_store()
        .load(&scope.keyring_key())
        .map(|token| token.map(Zeroizing::new))
        .map_err(|_| "Buzz could not access the OS keyring for Sites.".to_string())
}

#[tauri::command]
pub async fn sites_publisher_status(
    manager_url: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<SitesPublisherConnectionStatus, String> {
    let scope = require_active_scope(
        &manager_url,
        &expected_relay_url,
        &expected_signer_pubkey,
        &state,
    )?;
    let Some(token) = load_token(&scope)? else {
        return Ok(SitesPublisherConnectionStatus {
            connected: false,
            version: None,
        });
    };
    let health = fetch_health(&scope, &token).await?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(SitesPublisherConnectionStatus {
        connected: true,
        version: Some(health.version),
    })
}

#[tauri::command]
pub async fn connect_sites_publisher(
    manager_url: String,
    token: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<SitesPublisherConnectionStatus, String> {
    let scope = require_active_scope(
        &manager_url,
        &expected_relay_url,
        &expected_signer_pubkey,
        &state,
    )?;
    let mut submitted = Zeroizing::new(token);
    validate_token(&submitted)?;
    let normalized = submitted.trim().to_string();
    submitted.zeroize();
    let token = Zeroizing::new(normalized);
    let health = fetch_health(&scope, &token).await?;
    ensure_scope_is_current(&scope, &state)?;
    secret_store()
        .store(&scope.keyring_key(), &token)
        .map_err(|_| {
            "Buzz could not save the Sites operator token in the OS keyring.".to_string()
        })?;
    if let Err(error) = ensure_scope_is_current(&scope, &state) {
        let _ = secret_store().delete(&scope.keyring_key());
        return Err(error);
    }
    Ok(SitesPublisherConnectionStatus {
        connected: true,
        version: Some(health.version),
    })
}

#[tauri::command]
pub fn disconnect_sites_publisher(
    manager_url: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let scope = require_active_scope(
        &manager_url,
        &expected_relay_url,
        &expected_signer_pubkey,
        &state,
    )?;
    secret_store()
        .delete(&scope.keyring_key())
        .map_err(|_| "Buzz could not remove the Sites token from the OS keyring.".to_string())
}

#[tauri::command]
pub async fn sites_publisher_preview(
    manager_url: String,
    site_id: String,
    title: String,
    files: SitesPublisherFiles,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<SitesPublisherPreview, String> {
    let scope = require_active_scope(
        &manager_url,
        &expected_relay_url,
        &expected_signer_pubkey,
        &state,
    )?;
    validate_site(&site_id, &title, &files)?;
    let token = load_token(&scope)?
        .ok_or_else(|| "Connect a Sites publisher before creating a preview.".to_string())?;
    let body = preview_body(&title, &files)?;
    let response = send_authenticated(
        &scope,
        &token,
        Method::POST,
        &format!("{API_PREFIX}/previews"),
        Some(body),
    )
    .await?;
    let mut result: SitesPublisherPreview = decode_success(response).await?;
    let parsed = Url::parse(&result.preview_url)
        .map_err(|_| "The Sites publisher returned an invalid preview address.".to_string())?;
    if !parsed.path().starts_with("/previews/") || parsed.path().len() != "/previews/".len() + 32 {
        return Err("The Sites publisher returned an unexpected preview address.".to_string());
    }
    let preview_id = parsed.path().trim_start_matches("/previews/");
    if !preview_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The Sites publisher returned an unexpected preview address.".to_string());
    }
    result.preview_url = checked_public_url(&result.preview_url, &parsed.path())?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(result)
}

#[tauri::command]
pub async fn sites_publisher_site_status(
    manager_url: String,
    site_id: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<SitesPublisherSiteStatus, String> {
    let scope = require_active_scope(
        &manager_url,
        &expected_relay_url,
        &expected_signer_pubkey,
        &state,
    )?;
    validate_site(
        &site_id,
        "status",
        &SitesPublisherFiles {
            index_html: String::new(),
            style_css: String::new(),
            app_js: String::new(),
        },
    )?;
    let token = load_token(&scope)?
        .ok_or_else(|| "Connect a Sites publisher to check publication status.".to_string())?;
    let response = send_authenticated(
        &scope,
        &token,
        Method::GET,
        &format!("{API_PREFIX}/sites/{site_id}"),
        None,
    )
    .await?;
    let mut result: SitesPublisherSiteStatus = decode_success(response).await?;
    if result.site_id != site_id {
        return Err("The Sites publisher returned the wrong site status.".to_string());
    }
    if result.published {
        let expected_path = format!("/sites/{site_id}");
        result.public_url = Some(checked_public_url(
            result.public_url.as_deref().unwrap_or_default(),
            &expected_path,
        )?);
        if result.content_hash.as_deref().is_none_or(|hash| {
            hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        }) {
            return Err(
                "The Sites publisher returned an invalid published content hash.".to_string(),
            );
        }
    } else {
        let expected_path = format!("/sites/{site_id}");
        result.public_url = Some(checked_public_url(
            result.public_url.as_deref().unwrap_or_default(),
            &expected_path,
        )?);
        if result.content_hash.is_some() {
            return Err(
                "The Sites publisher returned inconsistent publication status.".to_string(),
            );
        }
    }
    ensure_scope_is_current(&scope, &state)?;
    Ok(result)
}

#[tauri::command]
pub async fn publish_sites_site(
    manager_url: String,
    site_id: String,
    title: String,
    files: SitesPublisherFiles,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<SitesPublisherResult, String> {
    let scope = require_active_scope(
        &manager_url,
        &expected_relay_url,
        &expected_signer_pubkey,
        &state,
    )?;
    validate_site(&site_id, &title, &files)?;
    let token = load_token(&scope)?
        .ok_or_else(|| "Connect a Sites publisher before publishing.".to_string())?;
    let body = publish_body(&title, &files)?;
    let response = send_authenticated(
        &scope,
        &token,
        Method::PUT,
        &format!("{API_PREFIX}/sites/{site_id}"),
        Some(body),
    )
    .await?;
    let mut result: SitesPublisherResult = decode_success(response).await?;
    if result.site_id != site_id
        || result.content_hash.len() != 64
        || !result
            .content_hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("The Sites publisher returned an invalid publish result.".to_string());
    }
    result.public_url = checked_public_url(&result.public_url, &format!("/sites/{site_id}"))?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(result)
}

#[tauri::command]
pub async fn revoke_sites_site(
    manager_url: String,
    site_id: String,
    expected_relay_url: String,
    expected_signer_pubkey: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let scope = require_active_scope(
        &manager_url,
        &expected_relay_url,
        &expected_signer_pubkey,
        &state,
    )?;
    validate_site(
        &site_id,
        "status",
        &SitesPublisherFiles {
            index_html: String::new(),
            style_css: String::new(),
            app_js: String::new(),
        },
    )?;
    let token = load_token(&scope)?
        .ok_or_else(|| "Connect a Sites publisher before revoking a site.".to_string())?;
    let response = send_authenticated(
        &scope,
        &token,
        Method::DELETE,
        &format!("{API_PREFIX}/sites/{site_id}"),
        None,
    )
    .await?;
    let result: RevokeResponse = decode_success(response).await?;
    if result.site_id != site_id || !result.revoked {
        return Err("The Sites publisher did not confirm revocation.".to_string());
    }
    let verify = send_authenticated(
        &scope,
        &token,
        Method::GET,
        &format!("{API_PREFIX}/sites/{site_id}"),
        None,
    )
    .await?;
    let status: SitesPublisherSiteStatus = decode_success(verify).await?;
    if status.site_id != site_id || status.published {
        return Err("The Sites publisher could not verify that the site was revoked.".to_string());
    }
    let public_url = status
        .public_url
        .as_deref()
        .ok_or_else(|| "The Sites publisher did not return the public site address.".to_string())?;
    verify_public_404(public_url, &format!("/sites/{site_id}")).await?;
    ensure_scope_is_current(&scope, &state)?;
    Ok(true)
}
