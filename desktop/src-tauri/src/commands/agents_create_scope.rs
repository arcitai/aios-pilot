//! Captured business-workspace scope for creating a stopped local agent.
use tauri::AppHandle;

use crate::{
    app_state::AppState,
    managed_agents::{
        retention::{active_retention_scope, RetentionScope},
        BackendKind, CreateManagedAgentRequest, ManagedAgentRecord,
    },
};

pub(super) fn prepare(
    app: &AppHandle,
    state: &AppState,
    input: &mut CreateManagedAgentRequest,
    expected_relay: Option<&str>,
    expected_signer: Option<&str>,
) -> Result<Option<RetentionScope>, String> {
    if expected_relay.is_none() && expected_signer.is_none() {
        return Ok(None);
    }
    let scope = active_retention_scope(app, state)?;
    validate(
        input,
        expected_relay,
        expected_signer,
        &scope.relay_url,
        &scope.owner_keys.public_key().to_hex(),
    )?;
    input.relay_url = Some(scope.relay_url.clone());
    Ok(Some(scope))
}

fn validate(
    input: &CreateManagedAgentRequest,
    expected_relay: Option<&str>,
    expected_signer: Option<&str>,
    actual_relay: &str,
    actual_signer: &str,
) -> Result<(), String> {
    if expected_relay.is_none_or(|value| value.trim().is_empty())
        || expected_signer.is_none_or(|value| value.trim().is_empty())
    {
        return Err("creating a workspace agent requires its community and identity".into());
    }
    crate::relay::assert_expected_relay_scope(
        expected_relay,
        &crate::relay::relay_http_base_url(actual_relay),
    )?;
    crate::relay::assert_expected_signer(expected_signer, actual_signer)?;
    crate::relay::assert_expected_relay_scope(
        input.relay_url.as_deref(),
        &crate::relay::relay_http_base_url(actual_relay),
    )?;
    // Starting or remote deployment is a separate, scope-checked action after
    // channel membership and the first conversation request are established.
    if input.spawn_after_create || input.backend != BackendKind::Local {
        return Err("create the local workspace agent stopped, then start it separately".into());
    }
    Ok(())
}

pub(super) fn retain(scope: &RetentionScope, record: &ManagedAgentRecord) {
    let result = (|| {
        let conn = crate::managed_agents::retention::open_retention_db(&scope.db_path)?;
        crate::managed_agents::reconcile::retain_agent_record(&conn, &scope.owner_keys, record)
    })();
    if let Err(error) = result {
        eprintln!("buzz-desktop: scoped agent-retain: {error}");
    }
}

pub(super) async fn flush(
    scope: &RetentionScope,
    state: &AppState,
    existing_error: Option<String>,
) -> Option<String> {
    match crate::managed_agents::persona_events::flush_pending_events_at(
        &scope.db_path,
        state,
        &scope.relay_url,
        &scope.owner_keys,
    )
    .await
    {
        Ok(_) => existing_error,
        Err(error) => Some(match existing_error {
            Some(previous) => format!("{previous}; managed policy sync failed: {error}"),
            None => format!("managed policy sync failed: {error}"),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> CreateManagedAgentRequest {
        serde_json::from_value(serde_json::json!({
            "name": "Fizz", "personaId": "builtin:fizz", "spawnAfterCreate": false,
            "relayUrl": "ws://127.0.0.1:3341"
        }))
        .unwrap()
    }

    #[test]
    fn scoped_create_requires_matching_owner_and_relay_before_creation() {
        let relay = "ws://127.0.0.1:3341";
        let signer = "a".repeat(64);
        assert!(validate(&input(), Some(relay), Some(&signer), relay, &signer).is_ok());
        assert!(validate(
            &input(),
            Some("wss://other.invalid"),
            Some(&signer),
            relay,
            &signer
        )
        .is_err());
        assert!(validate(&input(), Some(relay), Some(&"b".repeat(64)), relay, &signer).is_err());
        assert!(validate(&input(), Some(relay), None, relay, &signer).is_err());
        assert!(validate(&input(), Some(""), Some(&signer), relay, &signer).is_err());
        let mut other = input();
        other.relay_url = Some("wss://other.invalid".into());
        assert!(validate(&other, Some(relay), Some(&signer), relay, &signer).is_err());
    }

    #[test]
    fn scoped_create_cannot_implicitly_start_or_deploy() {
        let mut requested = input();
        requested.spawn_after_create = true;
        assert!(validate(
            &requested,
            Some("ws://127.0.0.1:3341"),
            Some("owner"),
            "ws://127.0.0.1:3341",
            "owner"
        )
        .unwrap_err()
        .contains("stopped"));
    }
}
