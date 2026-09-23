//! Captured community and owner scope for one huddle lifetime.

use nostr::{EventBuilder, Keys};

use crate::{
    app_state::AppState,
    relay::{
        bind_expected_relay_scope, bind_expected_signer, query_relay_at_with_keys,
        relay_api_base_url_with_override, relay_ws_url_with_override, submit_event_at_with_keys,
    },
};

pub(crate) struct HuddleWorkspaceScope {
    relay_url: String,
    api_base_url: String,
    signer_pubkey: String,
    keys: Keys,
}

impl HuddleWorkspaceScope {
    /// Capture the active relay and signer, rejecting stale UI bindings before
    /// the command performs any asynchronous work.
    pub(crate) fn capture(
        state: &AppState,
        expected_relay_url: Option<&str>,
        expected_signer_pubkey: Option<&str>,
    ) -> Result<Self, String> {
        let relay =
            bind_expected_relay_scope(expected_relay_url, relay_ws_url_with_override(state))?;
        let relay_url = relay.as_str().to_owned();
        let api_base_url = relay_api_base_url_with_override(state);
        let keys = state.signing_keys()?;
        let signer = bind_expected_signer(expected_signer_pubkey, keys.public_key().to_hex())?;

        Ok(Self {
            relay_url,
            api_base_url,
            signer_pubkey: signer.as_str().to_owned(),
            keys,
        })
    }

    /// Rebuild a scoped publisher from the huddle's stored binding. The
    /// current signing identity must still be the huddle owner; the relay URL
    /// and API endpoint always come from the stored huddle scope.
    pub(crate) fn from_huddle_state(state: &AppState) -> Result<Option<Self>, String> {
        let (relay_url, api_base_url, signer_pubkey, stored_keys) = {
            let huddle = state.huddle()?;
            match (
                huddle.workspace_relay_url.clone(),
                huddle.workspace_api_base_url.clone(),
                huddle.workspace_signer_pubkey.clone(),
                huddle.workspace_signing_keys.clone(),
            ) {
                (None, None, None, None) => return Ok(None),
                (Some(relay), api, Some(signer), keys) => (
                    relay.clone(),
                    api.unwrap_or_else(|| crate::relay::relay_http_base_url(&relay)),
                    signer,
                    keys,
                ),
                _ => return Err("huddle workspace scope is incomplete".to_string()),
            }
        };
        let keys = match stored_keys {
            Some(keys) => keys,
            None => state.signing_keys()?,
        };
        let signer = bind_expected_signer(Some(&signer_pubkey), keys.public_key().to_hex())?;
        Ok(Some(Self {
            relay_url,
            api_base_url,
            signer_pubkey: signer.as_str().to_owned(),
            keys,
        }))
    }

    pub(crate) fn assert_active_huddle_matches(
        state: &AppState,
        expected_relay_url: Option<&str>,
        expected_signer_pubkey: Option<&str>,
    ) -> Result<(), String> {
        let expected = Self::capture(state, expected_relay_url, expected_signer_pubkey)?;
        let active = Self::from_huddle_state(state)?
            .ok_or_else(|| "active huddle has no captured workspace scope".to_string())?;
        if active.relay_url != expected.relay_url
            || active.api_base_url != expected.api_base_url
            || active.signer_pubkey != expected.signer_pubkey
        {
            return Err("active huddle belongs to a different community or identity".to_string());
        }
        Ok(())
    }

    pub(crate) fn relay_url(&self) -> &str {
        &self.relay_url
    }

    pub(crate) fn api_base_url(&self) -> &str {
        &self.api_base_url
    }

    pub(crate) fn signer_pubkey(&self) -> &str {
        &self.signer_pubkey
    }

    pub(crate) fn keys(&self) -> &Keys {
        &self.keys
    }

    /// Reject continued setup or user actions after the active community or
    /// owner changes. Side effects still consume the captured endpoint/keys.
    pub(crate) fn assert_current(&self, state: &AppState) -> Result<(), String> {
        bind_expected_relay_scope(Some(&self.relay_url), relay_ws_url_with_override(state))?;
        let active_api = relay_api_base_url_with_override(state);
        if active_api.trim().trim_end_matches('/') != self.api_base_url.trim().trim_end_matches('/')
        {
            return Err("active community changed before the huddle continued".to_string());
        }
        bind_expected_signer(
            Some(&self.signer_pubkey),
            state.signing_keys()?.public_key().to_hex(),
        )?;
        Ok(())
    }

    pub(crate) async fn submit_event(
        &self,
        builder: EventBuilder,
        state: &AppState,
        require_current_scope: bool,
    ) -> Result<crate::relay::SubmitEventResponse, String> {
        if require_current_scope {
            self.assert_current(state)?;
        }
        submit_event_at_with_keys(builder, state, &self.api_base_url, &self.keys).await
    }

    pub(crate) async fn query(
        &self,
        state: &AppState,
        filters: &[serde_json::Value],
    ) -> Result<Vec<nostr::Event>, String> {
        query_relay_at_with_keys(state, &self.api_base_url, filters, &self.keys, None).await
    }
}

#[cfg(test)]
mod tests {
    use crate::app_state::{build_app_state, AppState};

    use super::HuddleWorkspaceScope;

    fn scoped_state() -> (AppState, nostr::Keys, String) {
        let state = build_app_state();
        let keys = nostr::Keys::generate();
        let relay_url = "ws://127.0.0.1:3341".to_string();
        *state.keys.lock().unwrap() = keys.clone();
        *state.relay_url_override.lock().unwrap() = Some(relay_url.clone());
        (state, keys, relay_url)
    }

    #[test]
    fn capture_binds_the_ui_relay_and_signer_before_network_work() {
        let (state, keys, relay_url) = scoped_state();
        let signer = keys.public_key().to_hex();

        let captured = match HuddleWorkspaceScope::capture(&state, Some(&relay_url), Some(&signer))
        {
            Ok(scope) => scope,
            Err(error) => panic!("matching scope rejected: {error}"),
        };
        assert_eq!(captured.relay_url(), relay_url);
        assert_eq!(captured.signer_pubkey(), signer);
        assert_eq!(captured.api_base_url(), "http://127.0.0.1:3341");
    }

    #[test]
    fn capture_rejects_a_stale_relay_or_signer() {
        let (state, keys, relay_url) = scoped_state();
        let signer = keys.public_key().to_hex();

        let relay_error =
            match HuddleWorkspaceScope::capture(&state, Some("ws://127.0.0.1:3342"), Some(&signer))
            {
                Ok(_) => panic!("stale relay accepted"),
                Err(error) => error,
            };
        assert!(relay_error.contains("community changed"), "{relay_error}");

        let wrong_signer = "f".repeat(64);
        let signer_error =
            match HuddleWorkspaceScope::capture(&state, Some(&relay_url), Some(&wrong_signer)) {
                Ok(_) => panic!("stale signer accepted"),
                Err(error) => error,
            };
        assert!(signer_error.contains("identity changed"), "{signer_error}");
    }

    #[test]
    fn captured_scope_fails_closed_after_a_community_or_identity_switch() {
        let (state, keys, relay_url) = scoped_state();
        let signer = keys.public_key().to_hex();
        let captured = match HuddleWorkspaceScope::capture(&state, Some(&relay_url), Some(&signer))
        {
            Ok(scope) => scope,
            Err(error) => panic!("matching scope rejected: {error}"),
        };

        *state.relay_url_override.lock().unwrap() = Some("ws://127.0.0.1:3342".to_string());
        assert!(captured
            .assert_current(&state)
            .unwrap_err()
            .contains("community changed"));

        *state.relay_url_override.lock().unwrap() = Some(relay_url);
        *state.keys.lock().unwrap() = nostr::Keys::generate();
        assert!(captured
            .assert_current(&state)
            .unwrap_err()
            .contains("identity changed"));
    }

    #[test]
    fn cleanup_scope_keeps_the_original_relay_after_a_switch() {
        let (state, keys, relay_url) = scoped_state();
        let signer = keys.public_key().to_hex();
        let captured = match HuddleWorkspaceScope::capture(&state, Some(&relay_url), Some(&signer))
        {
            Ok(scope) => scope,
            Err(error) => panic!("matching scope rejected: {error}"),
        };
        {
            let mut huddle = state.huddle().expect("huddle state");
            huddle.workspace_relay_url = Some(captured.relay_url().to_string());
            huddle.workspace_api_base_url = Some(captured.api_base_url().to_string());
            huddle.workspace_signer_pubkey = Some(captured.signer_pubkey().to_string());
            huddle.workspace_signing_keys = Some(captured.keys().clone());
        }
        *state.relay_url_override.lock().unwrap() = Some("ws://127.0.0.1:3342".to_string());
        *state.keys.lock().unwrap() = nostr::Keys::generate();

        let cleanup = match HuddleWorkspaceScope::from_huddle_state(&state) {
            Ok(Some(scope)) => scope,
            Ok(None) => panic!("stored scope missing"),
            Err(error) => panic!("same signer rejected: {error}"),
        };
        assert_eq!(cleanup.relay_url(), relay_url);
        assert_eq!(cleanup.api_base_url(), "http://127.0.0.1:3341");
        assert_eq!(cleanup.signer_pubkey(), signer);
        assert_eq!(cleanup.keys().public_key().to_hex(), signer);
        assert!(cleanup.assert_current(&state).is_err());
    }
}
