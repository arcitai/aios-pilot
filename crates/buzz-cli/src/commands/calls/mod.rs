//! Owner-approved business voice call requests over observer control frames.
//!
//! The command intentionally stays separate from ACP permission messages. The
//! parent CLI command module owns registration and passes its already-verified
//! NIP-OA auth tag into [`request_call`].

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use nostr::{Event, PublicKey, Tag, Timestamp};
use serde::{Deserialize, Serialize};
use url::Url;
use uuid::Uuid;

use crate::{client::BuzzClient, error::CliError};

const OBSERVER_FRAME_KIND: u16 = 24_200;
const CALL_TTL_MAX_SECONDS: u64 = 60;
const CALL_CLOCK_SKEW_SECONDS: u64 = 5;
const RUNTIME_START_NONCE_ENV: &str = "BUZZ_MANAGED_AGENT_START_NONCE";
const CALL_REQUEST_TYPE: &str = "call_request";
const CALL_DECISION_TYPE: &str = "call_decision";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallRequestPayload<'a> {
    #[serde(rename = "type")]
    message_type: &'static str,
    version: u8,
    request_id: &'a str,
    owner_pubkey: &'a str,
    agent_pubkey: &'a str,
    relay_url: &'a str,
    runtime_start_nonce: &'a str,
    channel_id: &'a str,
    created_at: u64,
    expires_at: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallDecisionPayload {
    #[serde(rename = "type")]
    message_type: String,
    version: u8,
    request_id: String,
    decision: String,
    owner_pubkey: String,
    agent_pubkey: String,
    relay_url: String,
    runtime_start_nonce: String,
    channel_id: String,
    created_at: u64,
    expires_at: u64,
}

/// Machine-readable result printed by the dispatching CLI command.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CallRequestResult {
    pub request_id: String,
    pub decision: String,
    pub channel_id: String,
    pub agent_pubkey: String,
    pub relay_url: String,
}

/// Publish a request for an explicit owner decision and wait no longer than
/// `wait_seconds` for a matching signed/encrypted response. The caller should
/// serialize the returned value as JSON, including the `timeout` decision.
pub async fn request_call(
    client: &BuzzClient,
    auth_tag: Option<&Tag>,
    channel_id: &str,
    wait_seconds: u64,
) -> Result<CallRequestResult, CliError> {
    if !(1..=CALL_TTL_MAX_SECONDS).contains(&wait_seconds) {
        return Err(CliError::Usage(format!(
            "call wait must be between 1 and {CALL_TTL_MAX_SECONDS} seconds"
        )));
    }

    let auth_tag = auth_tag.ok_or_else(|| {
        CliError::Auth("incoming calls require the verified NIP-OA owner auth tag".into())
    })?;
    let owner_pubkey = client
        .auth_tag_owner_hex()
        .filter(|owner| is_hex_pubkey(owner))
        .ok_or_else(|| CliError::Auth("the agent has no valid NIP-OA owner identity".into()))?;
    let auth_parts = auth_tag.as_slice();
    if auth_parts.first().map(String::as_str) != Some("auth")
        || auth_parts
            .get(1)
            .is_none_or(|owner| !owner.eq_ignore_ascii_case(&owner_pubkey))
    {
        return Err(CliError::Auth(
            "the supplied NIP-OA auth tag does not match the configured owner".into(),
        ));
    }

    let owner = PublicKey::parse(&owner_pubkey)
        .map_err(|error| CliError::Auth(format!("invalid owner public key: {error}")))?;
    let agent_pubkey = client.keys().public_key().to_hex();
    if agent_pubkey.eq_ignore_ascii_case(&owner_pubkey) {
        return Err(CliError::Auth(
            "the agent identity cannot place a call to itself as its owner".into(),
        ));
    }

    let channel_id = Uuid::parse_str(channel_id)
        .map_err(|_| CliError::Usage("call channel ID must be a UUID".into()))?
        .to_string();
    let relay_url = canonical_call_relay_url(client.relay_url())?;
    let runtime_start_nonce = std::env::var(RUNTIME_START_NONCE_ENV)
        .map_err(|_| CliError::Auth("the managed runtime start nonce is unavailable".into()))?;
    if runtime_start_nonce.trim().is_empty()
        || runtime_start_nonce.len() > 256
        || runtime_start_nonce.chars().any(char::is_control)
    {
        return Err(CliError::Auth(
            "the managed runtime start nonce is invalid".into(),
        ));
    }

    let mut connection = buzz_ws_client::NostrWsConnection::connect_authenticated(
        &relay_url,
        client.keys(),
        Some(auth_tag),
    )
    .await
    .map_err(|error| CliError::Other(format!("could not connect to call relay: {error}")))?;

    // Start the call TTL after relay authentication so the signed event's
    // created_at and encrypted payload remain aligned even on slow NIP-42 AUTH.
    let request_id = Uuid::new_v4().to_string();
    let wall_now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| CliError::Other(format!("system clock is invalid: {error}")))?;
    let created_at = wall_now.as_secs();
    let expires_at = created_at + wait_seconds;
    let request_deadline = tokio::time::Instant::now()
        + Duration::from_secs(wait_seconds)
            .saturating_sub(Duration::from_nanos(u64::from(wall_now.subsec_nanos())));
    let request = CallRequestPayload {
        message_type: CALL_REQUEST_TYPE,
        version: 1,
        request_id: &request_id,
        owner_pubkey: &owner_pubkey,
        agent_pubkey: &agent_pubkey,
        relay_url: &relay_url,
        runtime_start_nonce: &runtime_start_nonce,
        channel_id: &channel_id,
        created_at,
        expires_at,
    };

    let encrypted = buzz_core::observer::encrypt_observer_payload(client.keys(), &owner, &request)
        .map_err(|error| CliError::Other(format!("could not encrypt call request: {error}")))?;
    let builder =
        buzz_sdk::build_agent_observer_frame(&owner_pubkey, &agent_pubkey, "control", &encrypted)
            .map_err(|error| CliError::Other(format!("could not build call request: {error}")))?
            .custom_created_at(Timestamp::from(created_at));
    let event = builder
        .sign_with_keys(client.keys())
        .map_err(|error| CliError::Other(format!("could not sign call request: {error}")))?;

    let subscription_id = format!("voice-call-{}", Uuid::new_v4().simple());
    let since = created_at.saturating_sub(CALL_CLOCK_SKEW_SECONDS);
    let subscribe = tokio::time::timeout_at(
        request_deadline,
        connection.send_raw(&serde_json::json!([
            "REQ",
            subscription_id.clone(),
            {
                "kinds": [OBSERVER_FRAME_KIND],
                "#p": [agent_pubkey.clone()],
                "#agent": [agent_pubkey.clone()],
                "#frame": ["control"],
                "since": since,
                "limit": 64,
            }
        ])),
    )
    .await
    .map_err(|_| CliError::Other("call request expired before relay subscription".into()))?;
    subscribe.map_err(|error| {
        CliError::Other(format!("could not subscribe for call decisions: {error}"))
    })?;

    let result = async {
        let publish = tokio::time::timeout_at(request_deadline, connection.send_event(event)).await;
        match publish {
            Err(_) => return Ok(timeout_result(&request)),
            Ok(Err(error)) => {
                return Err(CliError::Other(format!(
                    "could not publish call request: {error}"
                )));
            }
            Ok(Ok(response)) if !response.accepted => {
                return Err(CliError::Relay {
                    status: 400,
                    body: response.message,
                });
            }
            Ok(Ok(_)) => {}
        }

        loop {
            let remaining = request_deadline
                .checked_duration_since(tokio::time::Instant::now())
                .unwrap_or(Duration::ZERO);
            if remaining.is_zero() {
                return Ok(timeout_result(&request));
            }

            match tokio::time::timeout_at(request_deadline, connection.next_event(remaining)).await
            {
                Err(_) => return Ok(timeout_result(&request)),
                Ok(Ok(buzz_ws_client::RelayMessage::Event {
                    subscription_id: received_subscription,
                    event,
                })) if received_subscription == subscription_id => {
                    if let Some(decision) = matching_decision(
                        &event,
                        client,
                        &request,
                        &owner_pubkey,
                        &agent_pubkey,
                        &relay_url,
                    ) {
                        return Ok(result_for(&request, decision));
                    }
                }
                Ok(Ok(buzz_ws_client::RelayMessage::Closed {
                    subscription_id: received_subscription,
                    message,
                })) if received_subscription == subscription_id => {
                    return Err(CliError::Other(format!(
                        "call decision subscription closed by relay: {message}"
                    )));
                }
                Ok(Ok(_)) => {}
                Ok(Err(buzz_ws_client::WsClientError::Timeout)) => {
                    return Ok(timeout_result(&request));
                }
                Ok(Err(error)) => {
                    return Err(CliError::Other(format!(
                        "failed while waiting for call decision: {error}"
                    )));
                }
            }
        }
    }
    .await;

    let _ = tokio::time::timeout(
        Duration::from_secs(1),
        connection.send_raw(&serde_json::json!(["CLOSE", subscription_id])),
    )
    .await;
    let _ = tokio::time::timeout(Duration::from_secs(1), connection.disconnect()).await;
    result
}

fn timeout_result(request: &CallRequestPayload<'_>) -> CallRequestResult {
    result_for(request, "timeout")
}

fn result_for(request: &CallRequestPayload<'_>, decision: &str) -> CallRequestResult {
    CallRequestResult {
        request_id: request.request_id.to_string(),
        decision: decision.to_string(),
        channel_id: request.channel_id.to_string(),
        agent_pubkey: request.agent_pubkey.to_string(),
        relay_url: request.relay_url.to_string(),
    }
}

fn matching_decision(
    event: &Event,
    client: &BuzzClient,
    request: &CallRequestPayload<'_>,
    owner_pubkey: &str,
    agent_pubkey: &str,
    relay_url: &str,
) -> Option<&'static str> {
    if event.kind.as_u16() != OBSERVER_FRAME_KIND
        || !event.pubkey.to_hex().eq_ignore_ascii_case(owner_pubkey)
        || event.verify().is_err()
        || tag_value(event, "p").is_none_or(|value| !value.eq_ignore_ascii_case(agent_pubkey))
        || tag_value(event, "agent").is_none_or(|value| !value.eq_ignore_ascii_case(agent_pubkey))
        || tag_value(event, "frame") != Some("control")
    {
        return None;
    }

    let decision_created_at = event.created_at.as_secs();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    if decision_created_at < request.created_at.saturating_sub(CALL_CLOCK_SKEW_SECONDS)
        || decision_created_at
            > request
                .expires_at
                .saturating_add(CALL_CLOCK_SKEW_SECONDS)
                .min(now.saturating_add(CALL_CLOCK_SKEW_SECONDS))
        || now >= request.expires_at
    {
        return None;
    }

    let decision: CallDecisionPayload =
        buzz_core::observer::decrypt_observer_payload(client.keys(), event).ok()?;
    if decision.message_type != CALL_DECISION_TYPE
        || decision.version != 1
        || decision.request_id != request.request_id
        || !decision.owner_pubkey.eq_ignore_ascii_case(owner_pubkey)
        || !decision.agent_pubkey.eq_ignore_ascii_case(agent_pubkey)
        || canonical_call_relay_url(&decision.relay_url).ok()?.as_str() != relay_url
        || decision.runtime_start_nonce != request.runtime_start_nonce
        || decision.channel_id != request.channel_id
        || decision.created_at != request.created_at
        || decision.expires_at != request.expires_at
        || now >= decision.expires_at
    {
        return None;
    }

    match decision.decision.as_str() {
        "accept" => Some("accept"),
        "decline" => Some("decline"),
        _ => None,
    }
}

fn tag_value<'a>(event: &'a Event, name: &str) -> Option<&'a str> {
    let mut matching = event
        .tags
        .iter()
        .filter(|tag| tag.as_slice().first().map(String::as_str) == Some(name));
    let tag = matching.next()?;
    if matching.next().is_some() {
        return None;
    }
    let values = tag.as_slice();
    if values.len() != 2 {
        return None;
    }
    values.get(1).map(String::as_str)
}

fn is_hex_pubkey(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn canonical_call_relay_url(raw: &str) -> Result<String, CliError> {
    let mut url = Url::parse(raw.trim())
        .map_err(|error| CliError::Usage(format!("invalid call relay URL: {error}")))?;
    let host = url
        .host_str()
        .ok_or_else(|| CliError::Usage("call relay URL has no host".into()))?
        .to_ascii_lowercase();
    if url.username() != "" || url.password().is_some() || url.fragment().is_some() {
        return Err(CliError::Usage(
            "call relay URL cannot contain credentials or a fragment".into(),
        ));
    }

    let loopback =
        host == "localhost" || host.ends_with(".localhost") || host == "127.0.0.1" || host == "::1";
    let websocket_scheme = match url.scheme() {
        "https" | "wss" => "wss",
        "http" | "ws" if loopback => "ws",
        "http" | "ws" => {
            return Err(CliError::Usage(
                "cleartext call relays are allowed only on loopback".into(),
            ));
        }
        _ => {
            return Err(CliError::Usage(
                "call relay must use HTTP(S) or WS(S)".into(),
            ));
        }
    };
    url.set_scheme(websocket_scheme)
        .map_err(|_| CliError::Usage("call relay URL scheme is invalid".into()))?;

    let mut path = url.path().to_string();
    while path.len() > 1 && path.ends_with('/') {
        path.pop();
    }
    url.set_path(&path);
    let mut canonical = url.to_string();
    if canonical.ends_with('/') && url.path() == "/" {
        canonical.pop();
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_url_normalization_matches_the_desktop_gate() {
        assert_eq!(
            canonical_call_relay_url("https://Relay.Example.test/").unwrap(),
            "wss://relay.example.test"
        );
        assert_eq!(
            canonical_call_relay_url("http://localhost:3000/").unwrap(),
            "ws://localhost:3000"
        );
        assert!(canonical_call_relay_url("ws://relay.example.test").is_err());
        assert!(canonical_call_relay_url("https://user@relay.example.test").is_err());
    }

    #[test]
    fn owner_key_and_relay_restrictions_are_explicit() {
        assert!(is_hex_pubkey(&"a".repeat(64)));
        assert!(!is_hex_pubkey(&"g".repeat(64)));
        assert!(!is_hex_pubkey(&"a".repeat(63)));
    }

    #[test]
    fn accepts_only_a_matching_owner_signed_and_encrypted_decision() {
        let owner_keys = nostr::Keys::generate();
        let agent_keys = nostr::Keys::generate();
        let owner_pubkey = owner_keys.public_key().to_hex();
        let agent_pubkey = agent_keys.public_key().to_hex();
        let auth_tag =
            Tag::parse(["auth", owner_pubkey.as_str(), "conditions", "signature"]).unwrap();
        let client = BuzzClient::new(
            "https://relay.example.test".into(),
            agent_keys.clone(),
            Some(auth_tag),
            None,
        )
        .unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let request_id = Uuid::new_v4().to_string();
        let channel_id = Uuid::new_v4().to_string();
        let runtime_start_nonce = "runtime-nonce-current";
        let request = CallRequestPayload {
            message_type: CALL_REQUEST_TYPE,
            version: 1,
            request_id: &request_id,
            owner_pubkey: &owner_pubkey,
            agent_pubkey: &agent_pubkey,
            relay_url: "wss://relay.example.test",
            runtime_start_nonce,
            channel_id: &channel_id,
            created_at: now,
            expires_at: now + CALL_TTL_MAX_SECONDS,
        };
        let decision = CallDecisionPayload {
            message_type: CALL_DECISION_TYPE.into(),
            version: 1,
            request_id: request_id.clone(),
            decision: "accept".into(),
            owner_pubkey: owner_pubkey.clone(),
            agent_pubkey: agent_pubkey.clone(),
            relay_url: request.relay_url.into(),
            runtime_start_nonce: runtime_start_nonce.into(),
            channel_id: channel_id.clone(),
            created_at: request.created_at,
            expires_at: request.expires_at,
        };
        let encrypted = buzz_core::observer::encrypt_observer_payload(
            &owner_keys,
            &agent_keys.public_key(),
            &decision,
        )
        .unwrap();
        let event = buzz_sdk::build_agent_observer_frame(
            &agent_pubkey,
            &agent_pubkey,
            "control",
            &encrypted,
        )
        .unwrap()
        .custom_created_at(Timestamp::from(now))
        .sign_with_keys(&owner_keys)
        .unwrap();

        assert_eq!(
            matching_decision(
                &event,
                &client,
                &request,
                &owner_pubkey,
                &agent_pubkey,
                request.relay_url,
            ),
            Some("accept")
        );

        let mut tampered = event;
        tampered.content.push('x');
        assert_eq!(
            matching_decision(
                &tampered,
                &client,
                &request,
                &owner_pubkey,
                &agent_pubkey,
                request.relay_url,
            ),
            None
        );
    }
}
