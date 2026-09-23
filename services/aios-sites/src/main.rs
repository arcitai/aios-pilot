mod admin;
mod model;
mod public;
mod state;
mod storage;

use crate::{admin::admin_router, model::*, public::public_router, state::AppState};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env, fs,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::{net::TcpListener, sync::Mutex as AsyncMutex};
use url::{Host, Url};
use zeroize::Zeroizing;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(load_state()?);
    let public_addr = bind_address("AIOS_SITES_PUBLIC_BIND", 3351, false)?;
    let admin_addr = bind_address("AIOS_SITES_ADMIN_BIND", 3352, true)?;

    let public_listener = TcpListener::bind(public_addr).await?;
    let admin_listener = TcpListener::bind(admin_addr).await?;

    let preview_store = state.previews.clone();
    let public_app = public_router(state.clone());
    let admin_app = admin_router(state.clone());
    let public_server = axum::serve(public_listener, public_app);
    let admin_server = axum::serve(admin_listener, admin_app);
    let pruner = admin::prune_previews_task(preview_store);

    tokio::select! {
        result = public_server => result?,
        result = admin_server => result?,
        _ = pruner => {},
        _ = tokio::signal::ctrl_c() => {},
    }
    Ok(())
}

fn load_state() -> Result<AppState, Box<dyn std::error::Error>> {
    let token = Zeroizing::new(
        env::var("AIOS_SITES_ADMIN_TOKEN")
            .map_err(|_| "AIOS_SITES_ADMIN_TOKEN must be configured")?,
    );
    if !(32..=512).contains(&token.len())
        || !token.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    {
        return Err("AIOS_SITES_ADMIN_TOKEN must be 32-512 printable non-space ASCII bytes".into());
    }
    let admin_token_hash: [u8; HASH_BYTES] = Sha256::digest(token.as_bytes()).into();

    let data_dir = env::var_os("AIOS_SITES_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("./aios-sites-data"));
    fs::create_dir_all(&data_dir)?;

    let public_origin = env::var("AIOS_SITES_PUBLIC_ORIGIN")
        .unwrap_or_else(|_| "http://127.0.0.1:3351".to_string());
    let public_origin = normalize_origin(&public_origin)?;

    let dev_preview = env::var("AIOS_SITES_ENABLE_DEV_PREVIEW")
        .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"));
    let preview_ancestors = preview_frame_ancestors(dev_preview);

    Ok(AppState {
        admin_token_hash,
        data_dir: Arc::new(data_dir),
        public_origin: Arc::from(public_origin),
        preview_ancestors: Arc::from(preview_ancestors),
        sites_lock: Arc::new(AsyncMutex::new(())),
        previews: Arc::new(Mutex::new(HashMap::new())),
    })
}

fn preview_frame_ancestors(dev_preview: bool) -> String {
    let mut ancestors = vec![
        "tauri://localhost",
        "https://tauri.localhost",
        "http://tauri.localhost",
    ];
    if dev_preview {
        ancestors.extend([
            "http://127.0.0.1:4173",
            "http://localhost:1437",
            "http://127.0.0.1:1437",
        ]);
    }
    ancestors.join(" ")
}

fn bind_address(name: &str, default_port: u16, is_admin: bool) -> Result<SocketAddr, String> {
    let container_mode = env::var("AIOS_SITES_CONTAINER_MODE")
        .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"));
    let default_ip = if container_mode {
        Ipv4Addr::UNSPECIFIED
    } else {
        Ipv4Addr::LOCALHOST
    };
    let default = SocketAddr::new(IpAddr::V4(default_ip), default_port);
    let address = env::var(name)
        .ok()
        .map(|value| {
            value
                .parse::<SocketAddr>()
                .map_err(|_| format!("{name} is invalid"))
        })
        .transpose()?
        .unwrap_or(default);
    if !container_mode && !address.ip().is_loopback() {
        return Err(format!("{name} must use a loopback address"));
    }
    if is_admin && address.port() == 3351 {
        return Err("AIOS_SITES_ADMIN_BIND must not share the public site port".into());
    }
    if !is_admin && address.port() == 3352 {
        return Err("AIOS_SITES_PUBLIC_BIND must not share the control port".into());
    }
    Ok(address)
}

fn normalize_origin(origin: &str) -> Result<String, String> {
    let parsed = Url::parse(origin)
        .map_err(|_| "AIOS_SITES_PUBLIC_ORIGIN must be a valid HTTP(S) origin".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !matches!(parsed.path(), "" | "/")
    {
        return Err(
            "AIOS_SITES_PUBLIC_ORIGIN must not contain credentials, a path, or query data".into(),
        );
    }
    let host_is_loopback = match parsed.host() {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(host)) => host.is_loopback(),
        Some(Host::Ipv6(host)) => host.is_loopback(),
        None => false,
    };
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && host_is_loopback) {
        return Err("AIOS_SITES_PUBLIC_ORIGIN must use HTTPS outside loopback".into());
    }
    Ok(parsed.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admin::admin_router;
    use crate::public::public_router;
    use crate::state::AppState;
    use axum::{
        body::{to_bytes, Body},
        http::{header, Request, StatusCode},
    };
    use std::{
        collections::HashMap,
        sync::Mutex,
        time::{Duration, Instant},
    };
    use tempfile::tempdir;
    use tokio::sync::Mutex as AsyncMutex;
    use tower::ServiceExt;

    fn test_state(data_dir: PathBuf) -> Arc<AppState> {
        Arc::new(AppState {
            admin_token_hash: Sha256::digest(b"sufficiently-long-test-token-value").into(),
            data_dir: Arc::new(data_dir),
            public_origin: Arc::from("http://127.0.0.1:3351"),
            preview_ancestors: Arc::from("tauri://localhost https://tauri.localhost http://tauri.localhost http://localhost:1437"),
            sites_lock: Arc::new(AsyncMutex::new(())),
            previews: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    fn site_request() -> PublishRequest {
        PublishRequest {
            title: "My site".to_string(),
            files: SiteFiles {
                index_html: "<button id='go'>Run</button><output id='result'></output>".to_string(),
                style_css: "body { color: navy }".to_string(),
                app_js: "document.querySelector('#go').onclick=()=>document.querySelector('#result').textContent='worked'".to_string(),
            },
        }
    }

    fn admin_request(method: &str, uri: &str, body: Option<String>) -> Request<Body> {
        let builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(
                header::AUTHORIZATION,
                "Bearer sufficiently-long-test-token-value",
            )
            .header(header::CONTENT_TYPE, "application/json");
        builder
            .body(body.map(Body::from).unwrap_or_else(Body::empty))
            .unwrap()
    }

    #[tokio::test]
    async fn publish_is_idempotent_revoke_is_a_tombstone_and_restart_serves_the_snapshot() {
        let directory = tempdir().unwrap();
        let data_dir = directory.path().to_path_buf();
        let state = test_state(data_dir.clone());
        let app = admin_router(state.clone());
        let body = serde_json::to_string(&site_request()).unwrap();

        let first = app
            .clone()
            .oneshot(admin_request(
                "PUT",
                "/api/sites/site_1",
                Some(body.clone()),
            ))
            .await
            .unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let first_result: PublishResult =
            serde_json::from_slice(&to_bytes(first.into_body(), 1024).await.unwrap()).unwrap();
        assert!(!first_result.already_published);

        let duplicate = app
            .clone()
            .oneshot(admin_request("PUT", "/api/sites/site_1", Some(body)))
            .await
            .unwrap();
        let duplicate_result: PublishResult =
            serde_json::from_slice(&to_bytes(duplicate.into_body(), 1024).await.unwrap()).unwrap();
        assert!(duplicate_result.already_published);
        assert_eq!(duplicate_result.content_hash, first_result.content_hash);

        let public = public_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri("/sites/site_1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(public.status(), StatusCode::OK);
        assert_eq!(public.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        let csp = public.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.contains("sandbox allow-scripts"));
        assert!(csp.contains("frame-ancestors 'none'"));
        assert!(csp.contains("connect-src 'none'"));
        assert!(!csp.contains("allow-same-origin"));
        let html = to_bytes(public.into_body(), 64_000).await.unwrap();
        assert!(String::from_utf8_lossy(&html).contains("id='go'"));

        let restarted = test_state(data_dir);
        let after_restart = public_router(restarted.clone())
            .oneshot(
                Request::builder()
                    .uri("/sites/site_1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(after_restart.status(), StatusCode::OK);

        let revoked = admin_router(restarted)
            .oneshot(admin_request("DELETE", "/api/sites/site_1", None))
            .await
            .unwrap();
        assert_eq!(revoked.status(), StatusCode::OK);
        let missing = public_router(test_state(directory.path().to_path_buf()))
            .oneshot(
                Request::builder()
                    .uri("/sites/site_1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn publish_retains_only_current_and_previous_snapshot_objects() {
        let directory = tempdir().unwrap();
        let data_dir = directory.path().to_path_buf();
        let app = admin_router(test_state(data_dir.clone()));
        let mut hashes = Vec::new();

        for title in ["First version", "Second version", "Third version"] {
            let mut request = site_request();
            request.title = title.to_string();
            let response = app
                .clone()
                .oneshot(admin_request(
                    "PUT",
                    "/api/sites/site_1",
                    Some(serde_json::to_string(&request).unwrap()),
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let result: PublishResult =
                serde_json::from_slice(&to_bytes(response.into_body(), 1024).await.unwrap())
                    .unwrap();
            hashes.push(result.content_hash);
        }

        let objects_dir = data_dir.join("sites/site_1/objects");
        assert!(!crate::storage::snapshot_path(&data_dir, "site_1", &hashes[0]).exists());
        assert!(crate::storage::snapshot_path(&data_dir, "site_1", &hashes[1]).exists());
        assert!(crate::storage::snapshot_path(&data_dir, "site_1", &hashes[2]).exists());
        let retained_count = fs::read_dir(objects_dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "json")
            })
            .count();
        assert_eq!(retained_count, 2);
    }

    #[tokio::test]
    async fn corrupted_existing_snapshot_blocks_publish_without_advancing_pointer() {
        let directory = tempdir().unwrap();
        let data_dir = directory.path().to_path_buf();
        let request = site_request();
        let snapshot = SiteSnapshot {
            schema_version: 1,
            site_id: "site_1".to_string(),
            title: request.title.clone(),
            files: request.files.clone(),
        };
        let serialized = serde_json::to_vec(&snapshot).unwrap();
        let content_hash = hex::encode(Sha256::digest(&serialized));
        let object_path = crate::storage::snapshot_path(&data_dir, "site_1", &content_hash);
        fs::create_dir_all(object_path.parent().unwrap()).unwrap();
        fs::write(&object_path, b"corrupted pre-existing object").unwrap();

        let response = admin_router(test_state(data_dir.clone()))
            .oneshot(admin_request(
                "PUT",
                "/api/sites/site_1",
                Some(serde_json::to_string(&request).unwrap()),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(crate::storage::read_pointer(&data_dir, "site_1")
            .unwrap()
            .is_none());
        assert_eq!(
            fs::read(object_path).unwrap(),
            b"corrupted pre-existing object"
        );
    }

    #[tokio::test]
    async fn management_requires_token_and_does_not_follow_ambient_cors() {
        let directory = tempdir().unwrap();
        let state = test_state(directory.path().to_path_buf());
        let request = Request::builder()
            .uri("/api/status")
            .header(header::ORIGIN, "https://attacker.example")
            .body(Body::empty())
            .unwrap();
        let response = admin_router(state).oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }

    #[tokio::test]
    async fn previews_expire_are_bounded_and_cannot_use_storage_or_network() {
        let directory = tempdir().unwrap();
        let state = test_state(directory.path().to_path_buf());
        let body = serde_json::to_string(&site_request()).unwrap();
        let created = admin_router(state.clone())
            .oneshot(admin_request("POST", "/api/previews", Some(body)))
            .await
            .unwrap();
        assert_eq!(created.status(), StatusCode::OK);
        let result: PreviewResult =
            serde_json::from_slice(&to_bytes(created.into_body(), 1024).await.unwrap()).unwrap();
        let preview_id = result.preview_url.rsplit('/').next().unwrap();
        let response = public_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri(format!("/previews/{preview_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let csp = response.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.contains("http://localhost:1437"));
        assert!(csp.contains("sandbox allow-scripts"));
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");

        let mut previews = state.previews.lock().unwrap();
        let entry = previews.get_mut(preview_id).unwrap();
        entry.expires_at = Instant::now() - Duration::from_secs(1);
        drop(previews);
        let expired = public_router(state.clone())
            .oneshot(
                Request::builder()
                    .uri(format!("/previews/{preview_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(expired.status(), StatusCode::NOT_FOUND);

        for _ in 0..MAX_PREVIEWS {
            let response = admin_router(state.clone())
                .oneshot(admin_request(
                    "POST",
                    "/api/previews",
                    Some(serde_json::to_string(&site_request()).unwrap()),
                ))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
        }
        let full = admin_router(state)
            .oneshot(admin_request(
                "POST",
                "/api/previews",
                Some(serde_json::to_string(&site_request()).unwrap()),
            ))
            .await
            .unwrap();
        assert_eq!(full.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn reject_path_traversal_external_http_origins_and_oversized_files() {
        assert!(!valid_site_id("../secret"));
        assert!(!valid_site_id("site/a"));
        assert!(!valid_site_id(".."));
        assert!(!valid_preview_id("../secret"));
        assert!(normalize_origin("https://sites.example").is_ok());
        assert!(normalize_origin("http://127.0.0.1:3351").is_ok());
        assert!(normalize_origin("http://[::1]:3351").is_ok());
        assert!(normalize_origin("http://sites.example").is_err());
        assert!(normalize_origin("https://user@sites.example").is_err());
        let mut request = site_request();
        request.files.app_js = "x".repeat(MAX_JS_BYTES + 1);
        assert!(validate_publish_request(&request).is_err());
    }

    #[test]
    fn preview_ancestors_are_exact_and_dev_origins_are_opt_in() {
        assert_eq!(
            preview_frame_ancestors(false),
            "tauri://localhost https://tauri.localhost http://tauri.localhost"
        );
        assert_eq!(
            preview_frame_ancestors(true),
            "tauri://localhost https://tauri.localhost http://tauri.localhost http://127.0.0.1:4173 http://localhost:1437 http://127.0.0.1:1437"
        );
    }
}
