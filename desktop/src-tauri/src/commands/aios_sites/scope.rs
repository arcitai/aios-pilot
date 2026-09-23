use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use url::{Host, Url};

pub const SITES_PUBLISHER_DEFAULT_ORIGIN: &str = "http://127.0.0.1:3352";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct PublisherScope {
    pub manager_origin: String,
    relay_url: String,
    pubkey: String,
}

impl PublisherScope {
    pub fn new(manager_url: &str, relay_url: String, pubkey: String) -> Result<Self, String> {
        let manager_origin = normalize_manager_origin(manager_url)?;
        if relay_url.trim().is_empty() {
            return Err("The active Buzz community relay URL is missing.".to_string());
        }
        if pubkey.len() != 64 || !pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("The active Buzz identity is unavailable.".to_string());
        }
        Ok(Self {
            manager_origin,
            relay_url,
            pubkey: pubkey.to_ascii_lowercase(),
        })
    }

    pub fn keyring_key(&self) -> String {
        let mut digest = Sha256::new();
        digest.update(b"buzz-sites-publisher-scope:v1\0");
        digest.update(self.manager_origin.as_bytes());
        digest.update([0]);
        digest.update(self.relay_url.as_bytes());
        digest.update([0]);
        digest.update(self.pubkey.as_bytes());
        format!(
            "sites-publisher:v1:{}",
            URL_SAFE_NO_PAD.encode(digest.finalize())
        )
    }

    pub fn endpoint(&self, path: &str) -> Result<Url, String> {
        if !path.starts_with('/') || path.starts_with("//") {
            return Err("The Sites publisher API path is invalid.".to_string());
        }
        Url::parse(&format!("{}{}", self.manager_origin, path))
            .map_err(|_| "The Sites publisher API address is invalid.".to_string())
    }
}

pub(super) fn require_matching_scope(
    expected_relay_url: &str,
    expected_signer_pubkey: &str,
    active: &PublisherScope,
) -> Result<(), String> {
    if expected_relay_url != active.relay_url {
        return Err("The active Buzz community changed. Reload Sites and try again.".to_string());
    }
    if !expected_signer_pubkey.eq_ignore_ascii_case(&active.pubkey) {
        return Err("The active Buzz identity changed. Reload Sites and try again.".to_string());
    }
    Ok(())
}

pub(super) fn normalize_manager_origin(input: &str) -> Result<String, String> {
    let parsed = Url::parse(input.trim()).map_err(|_| {
        "Enter a valid HTTPS publisher address, or the local loopback address.".to_string()
    })?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !matches!(parsed.path(), "" | "/")
    {
        return Err(
            "The Sites publisher address must be an origin without credentials or a path."
                .to_string(),
        );
    }
    let host_is_loopback = match parsed.host() {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(host)) => host.is_loopback(),
        Some(Host::Ipv6(host)) => host.is_loopback(),
        None => false,
    };
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && host_is_loopback) {
        return Err("HTTPS is required for a remote Sites publisher.".to_string());
    }
    Ok(parsed.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::{normalize_manager_origin, require_matching_scope, PublisherScope};

    const PUBKEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn scope(manager: &str, relay: &str) -> PublisherScope {
        PublisherScope::new(manager, relay.to_string(), PUBKEY.to_string()).unwrap()
    }

    #[test]
    fn remote_http_and_urls_with_credentials_or_paths_are_rejected() {
        assert_eq!(
            normalize_manager_origin("http://127.0.0.1:3352").unwrap(),
            "http://127.0.0.1:3352"
        );
        assert_eq!(
            normalize_manager_origin("http://[::1]:3352").unwrap(),
            "http://[::1]:3352"
        );
        assert_eq!(
            normalize_manager_origin("https://publisher.example/").unwrap(),
            "https://publisher.example"
        );
        assert!(normalize_manager_origin("http://publisher.example").is_err());
        assert!(normalize_manager_origin("https://user@publisher.example").is_err());
        assert!(normalize_manager_origin("https://publisher.example/path").is_err());
    }

    #[test]
    fn keyring_scope_is_bound_to_endpoint_community_and_signer() {
        let active = scope("http://127.0.0.1:3352", "wss://relay.example");
        assert_ne!(
            active.keyring_key(),
            scope("https://other.example", "wss://relay.example").keyring_key()
        );
        assert_ne!(
            active.keyring_key(),
            scope("http://127.0.0.1:3352", "wss://other.example").keyring_key()
        );
        let mut other_key = active.clone();
        other_key.pubkey = "f".repeat(64);
        assert_ne!(active.keyring_key(), other_key.keyring_key());
    }

    #[test]
    fn stale_workspace_and_signer_requests_are_rejected() {
        let active = scope("http://127.0.0.1:3352", "wss://relay.example");
        assert!(require_matching_scope("wss://relay.example", PUBKEY, &active).is_ok());
        assert!(require_matching_scope("wss://other.example", PUBKEY, &active).is_err());
        assert!(require_matching_scope("wss://relay.example", &"f".repeat(64), &active).is_err());
    }
}
