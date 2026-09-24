//! Signed/encrypted call-request round trips against an isolated Buzz relay.
//!
//! Run with `BUZZ_CALLS_RELAY_URL` set to a disposable isolated relay and
//! `BUZZ_MANAGED_AGENT_START_NONCE` set to an ephemeral value, then invoke
//! `cargo test -p buzz-cli --test calls_relay_roundtrip -- --ignored
//! --nocapture`. This test never starts or resets relay services and has no
//! default URL, and refuses ports 3030 and 3031 so it cannot target the known
//! shared endpoints.

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
const MAX_RELAY_DIAGNOSTICS: usize = 8;
const MAX_RELAY_DIAGNOSTIC_CHARS: usize = 240;

#[derive(Clone, Copy)]
enum SyntheticResponse {
    Accept,
    Decline,
    StaleRuntimeNonce,
    NoResponse,
}

fn relay_urls() -> (String, String) {
    let http_url = std::env::var("BUZZ_CALLS_RELAY_URL")
        .expect("set BUZZ_CALLS_RELAY_URL to a disposable isolated relay");
    assert!(
        !http_url.contains(":3030") && !http_url.contains(":3031"),
        "refusing shared relay ports 3030 and 3031"
    );
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
) -> Result<Event, String> {
    let deadline = Instant::now() + wait;
    let mut diagnostics = Vec::new();
    let mut omitted_diagnostics = 0;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(format!(
                "timed out waiting for call request; {}",
                relay_diagnostics(&diagnostics, omitted_diagnostics)
            ));
        }
        let message = match owner_connection.next_event(remaining).await {
            Ok(message) => message,
            Err(error) => {
                return Err(format!(
                    "relay receive failed: {error:?}; {}",
                    relay_diagnostics(&diagnostics, omitted_diagnostics)
                ));
            }
        };
        match message {
            RelayMessage::Event {
                subscription_id: received_id,
                event,
            } if received_id == subscription_id && event.kind.as_u16() == OBSERVER_FRAME_KIND => {
                return Ok(*event);
            }
            RelayMessage::Closed {
                subscription_id: received_id,
                message,
            } if received_id == subscription_id => {
                return Err(format!(
                    "request subscription was closed: {}; {}",
                    clipped(&message),
                    relay_diagnostics(&diagnostics, omitted_diagnostics)
                ));
            }
            message => push_relay_diagnostic(
                &mut diagnostics,
                &mut omitted_diagnostics,
                relay_message_diagnostic(&message),
            ),
        }
    }
}

fn clipped(value: &str) -> String {
    value.chars().take(MAX_RELAY_DIAGNOSTIC_CHARS).collect()
}

fn push_relay_diagnostic(
    diagnostics: &mut Vec<String>,
    omitted_diagnostics: &mut usize,
    detail: String,
) {
    if diagnostics.len() == MAX_RELAY_DIAGNOSTICS {
        *omitted_diagnostics += 1;
    } else {
        diagnostics.push(clipped(&detail));
    }
}

fn relay_diagnostics(diagnostics: &[String], omitted_diagnostics: usize) -> String {
    format!("observed relay messages: {diagnostics:?} ({omitted_diagnostics} more omitted)")
}

fn relay_message_diagnostic(message: &RelayMessage) -> String {
    match message {
        RelayMessage::Event {
            subscription_id,
            event,
        } => event_diagnostic(subscription_id, event),
        RelayMessage::Closed {
            subscription_id,
            message,
        } => format!("CLOSED sub={subscription_id}: {}", clipped(message)),
        RelayMessage::Notice { message } => format!("NOTICE: {}", clipped(message)),
        RelayMessage::Ok(response) => format!(
            "OK accepted={} message={}",
            response.accepted,
            clipped(&response.message)
        ),
        RelayMessage::Eose { subscription_id } => format!("unexpected EOSE sub={subscription_id}"),
        RelayMessage::Auth { challenge } => {
            format!("unexpected AUTH challenge={}", clipped(challenge))
        }
        RelayMessage::Count {
            subscription_id,
            count,
        } => format!("unexpected COUNT sub={subscription_id} count={count}"),
    }
}

fn event_diagnostic(subscription_id: &str, event: &Event) -> String {
    let tag_values = |tag_name: &str| {
        event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == tag_name)
            .filter_map(|tag| tag.content())
            .take(2)
            .map(clipped)
            .collect::<Vec<_>>()
    };
    format!(
        "EVENT sub={} kind={} id={} author={} p={:?} agent={:?} frame={:?}",
        clipped(subscription_id),
        event.kind.as_u16(),
        event.id.to_hex(),
        event.pubkey.to_hex(),
        tag_values("p"),
        tag_values("agent"),
        tag_values("frame")
    )
}

async fn wait_for_subscription_ready(
    owner_connection: &mut NostrWsConnection,
    subscription_id: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "owner subscription did not reach EOSE"
        );
        match owner_connection
            .next_event(remaining)
            .await
            .expect("wait for owner subscription EOSE")
        {
            RelayMessage::Eose {
                subscription_id: received_id,
            } if received_id == subscription_id => return,
            RelayMessage::Closed {
                subscription_id: received_id,
                message,
            } if received_id == subscription_id => {
                panic!("relay closed owner request subscription before EOSE: {message}");
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
    wait_for_subscription_ready(&mut owner_connection, &subscription_id).await;

    let agent_client = client::BuzzClient::new(
        http_url,
        agent_keys.clone(),
        Some(auth_tag.clone()),
        Some(auth_tag_json),
    )
    .expect("create CLI client with generated identity");
    let wait_seconds = if expected == "timeout" { 1 } else { 6 };
    let call_channel_id = channel_id.clone();
    let mut call_task = tokio::spawn(async move {
        calls::request_call(
            &agent_client,
            Some(&auth_tag),
            &call_channel_id,
            wait_seconds,
        )
        .await
    });

    let request_event = match receive_call_request(
        &mut owner_connection,
        &subscription_id,
        Duration::from_secs(8),
    )
    .await
    {
        Ok(event) => event,
        Err(relay_error) => {
            let cli_result = timeout(Duration::from_secs(7), &mut call_task).await;
            panic!(
                "owner did not receive call request ({relay_error}); CLI completion: {cli_result:?}"
            );
        }
    };
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
