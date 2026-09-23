use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};

/// The active Buzz community and signer that own a local connection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ConnectionScope {
    pub relay_url: String,
    pub pubkey: String,
}

impl ConnectionScope {
    pub fn new(relay_url: String, pubkey: String) -> Result<Self, String> {
        if relay_url.trim().is_empty() {
            return Err("active community relay URL is missing".to_string());
        }
        if pubkey.len() != 64 || !pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("active identity is unavailable".to_string());
        }
        Ok(Self {
            relay_url,
            pubkey: pubkey.to_ascii_lowercase(),
        })
    }

    /// Hash scope values before using them as a keyring entry name.
    pub fn keyring_key(&self, provider: &str) -> String {
        let mut digest = Sha256::new();
        digest.update(b"buzz-business-connection-scope:v1\0");
        digest.update(self.relay_url.as_bytes());
        digest.update([0]);
        digest.update(self.pubkey.as_bytes());
        let encoded = URL_SAFE_NO_PAD.encode(digest.finalize());
        format!("business-connections:v1:{provider}:{encoded}")
    }
}

/// Reject a frontend request whose claimed scope is no longer the native scope.
pub(super) fn require_matching_scope(
    expected_relay_url: &str,
    expected_pubkey: &str,
    active: &ConnectionScope,
) -> Result<(), String> {
    if expected_relay_url != active.relay_url {
        return Err("active community changed; reload and retry".to_string());
    }
    if !expected_pubkey.eq_ignore_ascii_case(&active.pubkey) {
        return Err("active identity changed; reload and retry".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{require_matching_scope, ConnectionScope};

    fn scope() -> ConnectionScope {
        ConnectionScope::new(
            "wss://community.example".to_string(),
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string(),
        )
        .expect("valid test scope")
    }

    #[test]
    fn scope_requires_both_the_active_community_and_signer() {
        let active = scope();
        assert!(require_matching_scope(&active.relay_url, &active.pubkey, &active).is_ok());
        assert!(
            require_matching_scope("wss://other-community.example", &active.pubkey, &active)
                .unwrap_err()
                .contains("community changed")
        );
        assert!(require_matching_scope(
            &active.relay_url,
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            &active
        )
        .unwrap_err()
        .contains("identity changed"));
    }

    #[test]
    fn keyring_namespace_is_provider_and_scope_specific() {
        let active = scope();
        let other_community = ConnectionScope::new(
            "wss://other-community.example".to_string(),
            active.pubkey.clone(),
        )
        .expect("valid test scope");
        let other_signer = ConnectionScope::new(
            active.relay_url.clone(),
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_string(),
        )
        .expect("valid test scope");

        let github_key = active.keyring_key("github");
        assert_ne!(github_key, other_community.keyring_key("github"));
        assert_ne!(github_key, other_signer.keyring_key("github"));
        assert_ne!(github_key, active.keyring_key("notion"));
    }
}
