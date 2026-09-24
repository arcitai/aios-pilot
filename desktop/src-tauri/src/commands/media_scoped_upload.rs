use nostr::Keys;

use crate::{
    app_state::AppState,
    relay::{
        assert_expected_relay_scope, assert_expected_signer, bind_expected_relay_scope,
        bind_expected_signer, relay_api_base_url_with_override, ScopedWorkspaceRelay,
    },
};

/// The caller's validated relay and signer snapshot for one scoped upload.
/// Callers retain this value across preparation and every network attempt.
pub(super) struct ScopedMediaUpload {
    relay: ScopedWorkspaceRelay,
    keys: Keys,
    expected_relay_url: String,
    expected_signer_pubkey: String,
}

impl ScopedMediaUpload {
    pub(super) fn capture(
        state: &AppState,
        expected_relay_url: String,
        expected_signer_pubkey: String,
    ) -> Result<Self, String> {
        let expected_relay_url =
            require_scoped_upload_value(expected_relay_url, "expected relay URL")?;
        let expected_signer_pubkey =
            require_scoped_upload_value(expected_signer_pubkey, "expected signer pubkey")?;
        let relay = bind_expected_relay_scope(
            Some(&expected_relay_url),
            relay_api_base_url_with_override(state),
        )?;
        let keys = state.signing_keys()?;
        bind_expected_signer(Some(&expected_signer_pubkey), keys.public_key().to_hex())?;

        Ok(Self {
            relay,
            keys,
            expected_relay_url,
            expected_signer_pubkey,
        })
    }

    /// Recheck after asynchronous preparation without changing the captured
    /// relay or keys that the uploader will use.
    pub(super) fn recheck(&self, state: &AppState) -> Result<(), String> {
        assert_expected_relay_scope(
            Some(&self.expected_relay_url),
            &relay_api_base_url_with_override(state),
        )?;
        let live_keys = state.signing_keys()?;
        assert_expected_signer(
            Some(&self.expected_signer_pubkey),
            &live_keys.public_key().to_hex(),
        )
    }

    pub(super) fn relay_base_url(&self) -> &str {
        self.relay.as_str()
    }

    pub(super) fn keys(&self) -> &Keys {
        &self.keys
    }
}

fn require_scoped_upload_value(value: String, name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{name} is required for a scoped media upload"));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
#[path = "media_scoped_upload_tests.rs"]
mod tests;
