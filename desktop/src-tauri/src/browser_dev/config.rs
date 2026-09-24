use std::{net::SocketAddr, path::Path};
use subtle::ConstantTimeEq;

pub(super) struct Config {
    pub address: SocketAddr,
    pub origin: String,
    pub token: String,
}

impl Config {
    pub fn from_env() -> Result<Option<Self>, String> {
        if std::env::var("AIOS_BROWSER_DEV").as_deref() != Ok("1") {
            return Ok(None);
        }
        let origin = std::env::var("AIOS_BROWSER_ORIGIN")
            .map_err(|_| "AIOS_BROWSER_ORIGIN is required".to_owned())?;
        let parsed = url::Url::parse(&origin).map_err(|_| "Invalid browser origin")?;
        if parsed.scheme() != "http"
            || parsed.host_str() != Some("127.0.0.1")
            || parsed.port().is_none()
            || parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("The browser development origin must be http://127.0.0.1:<port>".into());
        }
        let port = std::env::var("AIOS_BROWSER_BRIDGE_PORT")
            .map_err(|_| "AIOS_BROWSER_BRIDGE_PORT is required")?
            .parse::<u16>()
            .map_err(|_| "Invalid browser bridge port")?;
        if port < 1024 || Some(port) == parsed.port() {
            return Err("Choose a distinct unprivileged browser bridge port".into());
        }
        let path = std::env::var("AIOS_BROWSER_TOKEN_FILE")
            .map_err(|_| "AIOS_BROWSER_TOKEN_FILE is required")?;
        let token = read_token(Path::new(&path))?;
        Ok(Some(Self {
            address: SocketAddr::from(([127, 0, 0, 1], port)),
            origin: parsed.origin().ascii_serialization(),
            token,
        }))
    }

    pub fn accepts(&self, headers: &axum::http::HeaderMap) -> bool {
        headers.get("origin").and_then(|value| value.to_str().ok()) == Some(self.origin.as_str())
            && headers.get("host").and_then(|value| value.to_str().ok())
                == Some(self.address.to_string().as_str())
            && headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| {
                    constant_time_equal(
                        value.as_bytes(),
                        format!("Bearer {}", self.token).as_bytes(),
                    )
                })
    }
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    bool::from(left.ct_eq(right))
}

fn read_token(path: &Path) -> Result<String, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "Browser token file unavailable")?;
    if !metadata.is_file() || metadata.len() != 64 {
        return Err("Browser token file must contain a 64-character token".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err("Browser token file must be private (mode 0600)".into());
        }
    }
    let token = std::fs::read_to_string(path).map_err(|_| "Cannot read browser token file")?;
    if !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid browser token".into());
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_token_exact_host_and_origin() {
        let config = Config {
            address: "127.0.0.1:1438".parse().unwrap(),
            origin: "http://127.0.0.1:1437".into(),
            token: "a".repeat(64),
        };
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("host", "127.0.0.1:1438".parse().unwrap());
        headers.insert("origin", config.origin.parse().unwrap());
        headers.insert(
            "authorization",
            format!("Bearer {}", config.token).parse().unwrap(),
        );
        assert!(config.accepts(&headers));
        for (name, value) in [
            ("origin", "http://evil.example"),
            ("origin", "null"),
            ("host", "rebind.example:1438"),
            ("authorization", "Bearer wrong"),
        ] {
            let mut invalid = headers.clone();
            invalid.insert(name, value.parse().unwrap());
            assert!(!config.accepts(&invalid));
        }
        headers.remove("origin");
        assert!(!config.accepts(&headers));
    }
}
