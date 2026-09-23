//! Native command checks. Live proof uses only an explicitly selected loopback relay.
use super::{create_channel, get_canvas, get_canvas_history, set_canvas};
use crate::app_state::{build_app_state, AppState};
use tauri::Manager;

fn test_app(relay: &str, keys: nostr::Keys) -> tauri::App<tauri::test::MockRuntime> {
    let state = build_app_state();
    *state.keys.lock().unwrap() = keys;
    *state.relay_url_override.lock().unwrap() = Some(relay.to_owned());
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
}

#[tokio::test]
async fn business_commands_reject_stale_tenant_or_signer_before_network() {
    let relay = "ws://127.0.0.1:1";
    let keys = nostr::Keys::generate();
    let signer = keys.public_key().to_hex();
    let app = test_app(relay, keys);
    let channel = uuid::Uuid::new_v4().to_string();
    for (expected_relay, expected_signer) in [
        ("ws://127.0.0.1:2".to_owned(), signer.clone()),
        (relay.to_owned(), "a".repeat(64)),
    ] {
        let read = get_canvas(
            channel.clone(),
            Some(expected_relay.clone()),
            Some(expected_signer.clone()),
            app.state(),
        )
        .await;
        let write = set_canvas(
            channel.clone(),
            "{}".to_owned(),
            Some("none".to_owned()),
            Some(expected_relay.clone()),
            Some(expected_signer.clone()),
            app.state(),
        )
        .await;
        let create = create_channel(
            "Mismatch".to_owned(),
            "stream".to_owned(),
            "private".to_owned(),
            None,
            None,
            Some(expected_relay.clone()),
            Some(expected_signer.clone()),
            app.state(),
        )
        .await;
        let history = get_canvas_history(
            channel.clone(),
            Some(20),
            None,
            None,
            Some(expected_relay),
            Some(expected_signer),
            app.state(),
        )
        .await;
        for result in [
            read.map(|_| ()),
            write.map(|_| ()),
            create.map(|_| ()),
            history.map(|_| ()),
        ] {
            let error = result.unwrap_err();
            assert!(
                error.contains("changed"),
                "scope must reject before HTTP: {error}"
            );
        }
    }
}

#[tokio::test]
#[ignore = "Requires AIOS_TEST_RELAY_URL pointing to the isolated local selfhost stack"]
async fn business_native_live_roundtrip_conflict_and_denial() {
    tokio::time::timeout(std::time::Duration::from_secs(60), live_roundtrip())
        .await
        .unwrap();
}

async fn live_roundtrip() {
    let relay = std::env::var("AIOS_TEST_RELAY_URL").expect("explicit local relay required");
    let url = reqwest::Url::parse(&relay).unwrap();
    assert_eq!(url.scheme(), "ws");
    assert_eq!(
        url.host_str(),
        Some("127.0.0.1"),
        "never write test fixtures to a remote relay"
    );
    assert!(url.port().is_some());
    let owner = nostr::Keys::generate();
    let signer = owner.public_key().to_hex();
    let app = test_app(&relay, owner.clone());
    let channel = create_channel(
        format!("AIOS native test {}", uuid::Uuid::new_v4()),
        "stream".into(), "private".into(),
        Some("AIOS business workspace · private company context and main-agent conversation. [aios.business-workspace:v1]".into()),
        None, Some(relay.clone()), Some(signer.clone()), app.state(),
    ).await.expect("create private workspace through the native command");
    let original = serde_json::json!({
        "schemaVersion":1,"kind":"aios.business-workspace",
        "company":{"name":"Native Test Studio","website":"","summary":"A test company","audience":"Small teams","offers":"Design","goals":"Reliable onboarding"},
        "sources":[],"connections":[]
    }).to_string();
    let saved = set_canvas(
        channel.id.clone(),
        original.clone(),
        Some("none".into()),
        Some(relay.clone()),
        Some(signer.clone()),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(saved["verified"], true);
    let first_revision = saved["event_id"].as_str().unwrap().to_owned();
    // A fresh native state with the same signing identity must read the durable document.
    let reopened = test_app(&relay, owner);
    let loaded = get_canvas(
        channel.id.clone(),
        Some(relay.clone()),
        Some(signer.clone()),
        reopened.state(),
    )
    .await
    .unwrap();
    assert_eq!(loaded["content"], original);
    assert_eq!(loaded["event_id"], first_revision);
    let newer = original.replace("A test company", "An updated test company");
    set_canvas(
        channel.id.clone(),
        newer.clone(),
        Some(first_revision.clone()),
        Some(relay.clone()),
        Some(signer.clone()),
        reopened.state(),
    )
    .await
    .unwrap();
    let stale = set_canvas(
        channel.id.clone(),
        original,
        Some(first_revision),
        Some(relay.clone()),
        Some(signer.clone()),
        app.state(),
    )
    .await;
    assert!(stale.unwrap_err().contains("conflict"));

    let outsider = test_app(&relay, nostr::Keys::generate());
    let outsider_signer = outsider
        .state::<AppState>()
        .signing_keys()
        .unwrap()
        .public_key()
        .to_hex();
    let denied_read = get_canvas(
        channel.id.clone(),
        Some(relay.clone()),
        Some(outsider_signer.clone()),
        outsider.state(),
    )
    .await;
    if let Ok(snapshot) = denied_read {
        assert!(snapshot["content"].as_str().unwrap_or_default().is_empty());
    }
    assert!(set_canvas(
        channel.id.clone(),
        "unauthorized".into(),
        None,
        Some(relay.clone()),
        Some(outsider_signer),
        outsider.state()
    )
    .await
    .is_err());
    let final_read = get_canvas(
        channel.id.clone(),
        Some(relay),
        Some(signer),
        reopened.state(),
    )
    .await
    .unwrap();
    assert_eq!(final_read["content"], newer);
    let history = get_canvas_history(
        channel.id.clone(),
        Some(20),
        None,
        None,
        None,
        None,
        reopened.state(),
    )
    .await
    .unwrap();
    assert_eq!(history["revisions"].as_array().unwrap().len(), 2);
    println!(
        "Native live proof passed for private test channel {}",
        channel.id
    );
}
