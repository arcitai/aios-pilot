//! Native command checks. Live proof uses only an explicitly selected loopback relay.
use super::{create_channel, get_canvas, get_canvas_history, get_channel_members, set_canvas};
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
        let members = get_channel_members(
            channel.clone(),
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
            members.map(|_| ()),
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
    let members = get_channel_members(
        channel.id.clone(),
        Some(relay.clone()),
        Some(signer.clone()),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(members.members.len(), 1);
    assert_eq!(members.members[0].pubkey, signer);
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
        Some(relay.clone()),
        Some(signer.clone()),
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
    concurrent_canvas_proof(&reopened, &relay, &channel.id, &signer).await;
    if let Ok(binary) = std::env::var("AIOS_TEST_CLI") {
        cli_roundtrip(&reopened, &binary, &relay, &channel.id, &signer).await;
    }
    println!(
        "Native live proof passed for private test channel {}",
        channel.id
    );
}

async fn concurrent_canvas_proof(
    app: &tauri::App<tauri::test::MockRuntime>,
    relay: &str,
    channel: &str,
    signer: &str,
) {
    use crate::relay::{relay_api_base_url_with_override, submit_event_at_with_keys};
    let state = app.state::<AppState>();
    let keys = state.signing_keys().unwrap();
    let head = get_canvas(
        channel.into(),
        Some(relay.into()),
        Some(signer.into()),
        app.state(),
    )
    .await
    .unwrap();
    let revision = head["event_id"].as_str().unwrap();
    let content: serde_json::Value =
        serde_json::from_str(head["content"].as_str().unwrap()).unwrap();
    let timestamp =
        buzz_sdk_pkg::canvas_write_created_at(head["updated_at"].as_u64().unwrap()).unwrap();
    let mut first = content.clone();
    let mut second = content;
    first["company"]["goals"] = serde_json::json!("Concurrent writer one");
    second["company"]["goals"] = serde_json::json!("Concurrent writer two");
    let channel_id = uuid::Uuid::parse_str(channel).unwrap();
    // Build both signed preconditions from the same snapshot before submitting
    // either. A client-only preflight cannot reject this race for us.
    let build = |document: &serde_json::Value| {
        crate::events::build_set_canvas(channel_id, &document.to_string(), Some(revision))
            .unwrap()
            .custom_created_at(nostr::Timestamp::from(timestamp))
    };
    let base = relay_api_base_url_with_override(&state);
    let (left, right) = tokio::join!(
        submit_event_at_with_keys(build(&first), &state, &base, &keys),
        submit_event_at_with_keys(build(&second), &state, &base, &keys),
    );
    assert_ne!(
        left.is_ok(),
        right.is_ok(),
        "exactly one same-head write is accepted"
    );
    let (winner, rejected) = match (left, right) {
        (Ok(_), Err(error)) => (first, error),
        (Err(error), Ok(_)) => (second, error),
        _ => unreachable!(),
    };
    assert!(
        rejected.to_lowercase().contains("conflict"),
        "loser must return a conflict: {rejected}"
    );
    let readback = get_canvas(
        channel.into(),
        Some(relay.into()),
        Some(signer.into()),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(readback["content"].as_str().unwrap()).unwrap(),
        winner
    );
    let history = get_canvas_history(
        channel.into(),
        Some(20),
        None,
        None,
        Some(relay.into()),
        Some(signer.into()),
        app.state(),
    )
    .await
    .unwrap();
    assert_eq!(
        history["revisions"].as_array().unwrap().len(),
        3,
        "the rejected competing write never enters durable history"
    );
    println!(
        "Relay atomic canvas proof: one competing write accepted, one rejected, history verified"
    );
}

async fn cli_roundtrip(
    app: &tauri::App<tauri::test::MockRuntime>,
    binary: &str,
    relay: &str,
    channel: &str,
    signer: &str,
) {
    let keys = app.state::<AppState>().signing_keys().unwrap();
    let shown = run_cli(binary, relay, &keys, &["show", "--channel", channel], None).await;
    assert!(shown.status.success());
    let shown: serde_json::Value = serde_json::from_slice(&shown.stdout).unwrap();
    let revision = shown["revision"].as_str().unwrap();
    let mut document = shown["document"].clone();
    document["company"]["goals"] = serde_json::json!("CLI and desktop share the same context");
    let input = document.to_string();
    let update_args = [
        "update",
        "--channel",
        channel,
        "--file",
        "-",
        "--expected-revision",
        revision,
    ];
    let updated = run_cli(binary, relay, &keys, &update_args, Some(&input)).await;
    assert!(updated.status.success(), "CLI update must succeed");
    let readback = get_canvas(
        channel.to_owned(),
        Some(relay.to_owned()),
        Some(signer.to_owned()),
        app.state(),
    )
    .await
    .unwrap();
    let readback: serde_json::Value =
        serde_json::from_str(readback["content"].as_str().unwrap()).unwrap();
    assert_eq!(
        readback, document,
        "native command reads the complete CLI update"
    );

    let stale = run_cli(binary, relay, &keys, &update_args, Some(&input)).await;
    assert!(
        !stale.status.success(),
        "CLI rejects the old native revision"
    );
    let outsider = run_cli(
        binary,
        relay,
        &nostr::Keys::generate(),
        &["show", "--channel", channel],
        None,
    )
    .await;
    assert!(
        !outsider.status.success(),
        "CLI refuses another signer's private workspace"
    );
    assert!(!String::from_utf8_lossy(&outsider.stdout).contains("CLI and desktop"));
    println!("Native → CLI → native company-context roundtrip, stale revision and outsider denial passed");
}

async fn run_cli(
    binary: &str,
    relay: &str,
    keys: &nostr::Keys,
    arguments: &[&str],
    input: Option<&str>,
) -> std::process::Output {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;
    let mut child = tokio::process::Command::new(binary)
        .arg("business")
        .args(arguments)
        .env_clear()
        .env("BUZZ_RELAY_URL", relay)
        .env("BUZZ_PRIVATE_KEY", keys.secret_key().to_secret_hex())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn explicitly selected test CLI");
    if let Some(mut stdin) = child.stdin.take() {
        if let Some(input) = input {
            stdin.write_all(input.as_bytes()).await.unwrap();
        }
        stdin.shutdown().await.unwrap();
    }
    tokio::time::timeout(std::time::Duration::from_secs(15), child.wait_with_output())
        .await
        .expect("CLI operation finishes within fifteen seconds")
        .expect("CLI exits")
}
