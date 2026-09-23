//! Signed/encrypted call-request round trips against an isolated Buzz relay.
//!
//! Run with `BUZZ_MANAGED_AGENT_START_NONCE=<ephemeral-value> cargo test -p
//! buzz-cli --test calls_relay_roundtrip -- --ignored --nocapture` after
//! starting `scripts/start-isolated-test-relay.sh`.

#[path = "../src/commands/calls/mod.rs"]
mod calls;
#[allow(dead_code)]
#[path = "../src/client.rs"]
mod client;
#[allow(dead_code)]
#[path = "../src/error.rs"]
mod error;

use std::time::Duration;

use buzz_ws_client::{NostrWsConnection, RelayMessage};
use nostr::{Event, Keys, PublicKey};
use serde_json::{json, Value};
use tokio::time::{timeout, Instant};
use uuid::Uuid;

const OBSERVER_FRAME_KIND: u16 = 24_200;

#[derive(Clone, Copy)]
enum SyntheticResponse {
    Accept,
    Decline,
    StaleRuntimeNonce,
    NoResponse,
}

fn relay_urls() -> (String, String) {
    let http_url = std::env::var("BUZZ_CALLS_RELAY_URL")
        .unwrap_or_else(|_| "http://localhost:3030".to_owned());
    let ws_url = http_url
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1)
        .trim_end_matches('/')
        .to_owned();
    (http_url, ws_url)
}

async fn receive_call_request(
    owner_connection: &mut NostrWsConnection,
    subscription_id: &str,
    wait: Duration,
) -> Event {
    let deadline = Instant::now() + wait;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(!remaining.is_zero(), "timed out waiting for call request");
        match owner_connection
            .next_event(remaining)
            .await
            .expect("receive call request from relay")
        {
            RelayMessage::Event {
                subscription_id: received_id,
                event,
            } if received_id == subscription_id => {
                if event.kind.as_u16() == OBSERVER_FRAME_KIND {
                    return *event;
                }
            }
            _ => {}
        }
    }
}

async fn run_round_trip(response: SyntheticResponse, expected: &str) {
    let (http_url, ws_url) = relay_urls();
    let runtime_nonce = std::env::var("BUZZ_MANAGED_AGENT_START_NONCE")
        .expect("test runner must provide a synthetic runtime nonce");
    let owner_keys = Keys::generate();
    let agent_keys = Keys::generate();
    let owner_pubkey = owner_keys.public_key().to_hex();
    let agent_pubkey = agent_keys.public_key().to_hex();
    let channel_id = Uuid::new_v4().to_string();

    let auth_tag_json =
        buzz_sdk::nip_oa::compute_auth_tag(&owner_keys, &agent_keys.public_key(), "")
            .expect("sign generated owner-to-agent NIP-OA delegation");
    let auth_tag = buzz_sdk::nip_oa::parse_auth_tag(&auth_tag_json)
        .expect("parse generated NIP-OA delegation");

    let mut owner_connection = NostrWsConnection::connect_authenticated(&ws_url, &owner_keys, None)
        .await
        .expect("authenticate generated owner identity to isolated relay");
    let subscription_id = format!("calls-request-{}", Uuid::new_v4().simple());
    let since = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock after Unix epoch")
        .as_secs()
        .saturating_sub(60);
    owner_connection
        .send_raw(&json!([
            "REQ",
            subscription_id,
            {
                "kinds": [OBSERVER_FRAME_KIND],
                "#p": [owner_pubkey],
                "since": since,
                "limit": 16
            }
        ]))
        .await
        .expect("subscribe generated owner identity to its incoming request");

    let agent_client = client::BuzzClient::new(
        http_url,
        agent_keys.clone(),
        Some(auth_tag.clone()),
        Some(auth_tag_json),
    )
    .expect("create CLI client with generated identity");
    let wait_seconds = if expected == "timeout" { 1 } else { 6 };
    let call_channel_id = channel_id.clone();
    let call_task = tokio::spawn(async move {
        calls::request_call(
            &agent_client,
            Some(&auth_tag),
            &call_channel_id,
            wait_seconds,
        )
        .await
    });

    let request_event = receive_call_request(
        &mut owner_connection,
        &subscription_id,
        Duration::from_secs(8),
    )
    .await;
    assert_eq!(request_event.pubkey.to_hex(), agent_pubkey);
    assert!(
        request_event.verify().is_ok(),
        "call request signature verifies"
    );

    let request: Value = buzz_core::observer::decrypt_observer_payload(&owner_keys, &request_event)
        .expect("decrypt signed/encrypted request using generated owner identity");
    assert_eq!(request["type"], "call_request");
    assert_eq!(request["ownerPubkey"], owner_pubkey);
    assert_eq!(request["agentPubkey"], agent_pubkey);
    assert_eq!(request["runtimeStartNonce"], runtime_nonce);
    assert_eq!(request["channelId"], channel_id);

    if !matches!(response, SyntheticResponse::NoResponse) {
        let request_id = request["requestId"].as_str().expect("request ID");
        let created_at = request["createdAt"].as_u64().expect("createdAt");
        let expires_at = request["expiresAt"].as_u64().expect("expiresAt");
        let runtime_start_nonce = match response {
            SyntheticResponse::StaleRuntimeNonce => "stale-synthetic-runtime".to_owned(),
            _ => runtime_nonce,
        };
        let decision = match response {
            SyntheticResponse::Accept | SyntheticResponse::StaleRuntimeNonce => "accept",
            SyntheticResponse::Decline => "decline",
            SyntheticResponse::NoResponse => unreachable!(),
        };
        let decision_payload = json!({
            "type": "call_decision",
            "version": 1,
            "requestId": request_id,
            "decision": decision,
            "ownerPubkey": owner_pubkey,
            "agentPubkey": agent_pubkey,
            "relayUrl": ws_url,
            "runtimeStartNonce": runtime_start_nonce,
            "channelId": channel_id,
            "createdAt": created_at,
            "expiresAt": expires_at,
        });
        let agent_public_key =
            PublicKey::parse(&agent_pubkey).expect("parse generated agent public key");
        let encrypted = buzz_core::observer::encrypt_observer_payload(
            &owner_keys,
            &agent_public_key,
            &decision_payload,
        )
        .expect("encrypt owner decision for generated agent identity");
        let event = buzz_sdk::build_agent_observer_frame(
            &agent_pubkey,
            &agent_pubkey,
            "control",
            &encrypted,
        )
        .expect("build owner control frame")
        .sign_with_keys(&owner_keys)
        .expect("sign owner control frame");
        let response = owner_connection
            .send_event(event)
            .await
            .expect("publish owner decision to isolated relay");
        assert!(
            response.accepted,
            "relay accepts the synthetic owner decision"
        );
    }

    let result = timeout(Duration::from_secs(wait_seconds + 4), call_task)
        .await
        .expect("CLI request completes within its advertised wait")
        .expect("CLI request task does not panic")
        .expect("CLI request succeeds");
    assert_eq!(result.decision, expected);
    assert_eq!(result.channel_id, channel_id);
    assert_eq!(result.agent_pubkey, agent_pubkey);
    assert_eq!(result.relay_url, ws_url);

    let _ = owner_connection
        .send_raw(&json!(["CLOSE", subscription_id]))
        .await;
    let _ = timeout(Duration::from_secs(1), owner_connection.disconnect()).await;
}

#[tokio::test]
#[ignore = "requires the isolated Buzz relay from scripts/start-isolated-test-relay.sh"]
async fn generated_identities_complete_call_decisions_and_reject_stale_nonce() {
    let _ = rustls::crypto::ring::default_provider().install_default();

    run_round_trip(SyntheticResponse::Accept, "accept").await;
    run_round_trip(SyntheticResponse::Decline, "decline").await;
    run_round_trip(SyntheticResponse::StaleRuntimeNonce, "timeout").await;
    run_round_trip(SyntheticResponse::NoResponse, "timeout").await;
}
