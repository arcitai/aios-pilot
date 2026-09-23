//! Owner-approved, one-shot ACP tool permission requests.
//!
//! Requests are surfaced through the existing encrypted observer channel. The
//! broker keeps the live decision capability in memory and binds it to one
//! managed runtime, ACP session, turn, and pool slot. A relay frame alone can
//! never create or replay a pending request.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use crate::{observer::ObserverContext, observer::ObserverHandle};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::oneshot;
use tokio::time::{timeout, Instant};

pub(crate) const PERMISSION_DECISION_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_PENDING_PERMISSION_REQUESTS: usize = 8;
const MAX_CONTEXT_DEPTH: usize = 4;
const MAX_CONTEXT_ITEMS: usize = 16;
const MAX_CONTEXT_STRING_BYTES: usize = 512;
const MAX_PERMISSION_CONTEXT_BYTES: usize = 4_096;

#[derive(Clone, Debug)]
pub(crate) struct PermissionRuntimeIdentity {
    pub owner_pubkey: String,
    pub agent_pubkey: String,
    pub relay_url: String,
    pub runtime_start_nonce: String,
}

/// Binding echoed by Desktop when it resolves one displayed request.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PermissionBinding {
    pub request_id: String,
    pub owner_pubkey: String,
    pub agent_pubkey: String,
    pub relay_url: String,
    pub runtime_start_nonce: String,
    pub agent_index: usize,
    pub session_id: String,
    pub turn_id: String,
    pub channel_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PermissionDecision {
    Approve,
    Deny,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionDecisionControl {
    #[serde(rename = "type")]
    control_type: String,
    #[serde(flatten)]
    binding: PermissionBinding,
    decision: PermissionDecision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PermissionOutcome {
    Approved,
    Denied,
    TimedOut,
    Unavailable,
}

struct PendingPermission {
    binding: PermissionBinding,
    expires_at: Instant,
    decision_tx: oneshot::Sender<PermissionDecision>,
}

#[derive(Default)]
struct PendingState {
    by_request_id: HashMap<String, PendingPermission>,
}

/// In-memory, bounded decision broker shared by the ACP workers and relay loop.
#[derive(Clone)]
pub(crate) struct PermissionBroker {
    identity: PermissionRuntimeIdentity,
    timeout: Duration,
    max_pending: usize,
    pending: Arc<Mutex<PendingState>>,
}

impl PermissionBroker {
    pub fn new(identity: PermissionRuntimeIdentity) -> Self {
        Self::with_limits(
            identity,
            PERMISSION_DECISION_TIMEOUT,
            MAX_PENDING_PERMISSION_REQUESTS,
        )
    }

    pub(crate) fn with_limits(
        identity: PermissionRuntimeIdentity,
        timeout: Duration,
        max_pending: usize,
    ) -> Self {
        Self {
            identity,
            timeout,
            max_pending,
            pending: Arc::new(Mutex::new(PendingState::default())),
        }
    }

    pub async fn request(
        &self,
        observer: Option<&ObserverHandle>,
        agent_index: Option<usize>,
        observer_context: &ObserverContext,
        params: &Value,
    ) -> PermissionOutcome {
        let (Some(observer), Some(agent_index), Some(session_id), Some(turn_id)) = (
            observer,
            agent_index,
            observer_context.session_id.as_deref(),
            observer_context.turn_id.as_deref(),
        ) else {
            return PermissionOutcome::Unavailable;
        };

        if !valid_pubkey(&self.identity.owner_pubkey)
            || !valid_pubkey(&self.identity.agent_pubkey)
            || self.identity.relay_url.is_empty()
            || self.identity.runtime_start_nonce.is_empty()
        {
            return PermissionOutcome::Unavailable;
        }

        let binding = PermissionBinding {
            request_id: uuid::Uuid::new_v4().to_string(),
            owner_pubkey: self.identity.owner_pubkey.clone(),
            agent_pubkey: self.identity.agent_pubkey.clone(),
            relay_url: self.identity.relay_url.clone(),
            runtime_start_nonce: self.identity.runtime_start_nonce.clone(),
            agent_index,
            session_id: session_id.to_owned(),
            turn_id: turn_id.to_owned(),
            channel_id: observer_context.channel_id.clone(),
        };
        let (decision_tx, decision_rx) = oneshot::channel();
        let expires_at = Instant::now() + self.timeout;

        {
            let Ok(mut pending) = self.pending.lock() else {
                return PermissionOutcome::Unavailable;
            };
            if pending.by_request_id.len() >= self.max_pending {
                return PermissionOutcome::Unavailable;
            }
            pending.by_request_id.insert(
                binding.request_id.clone(),
                PendingPermission {
                    binding: binding.clone(),
                    expires_at,
                    decision_tx,
                },
            );
        }

        let details = safe_permission_details(params);
        let guard = PendingRequestGuard::new(self.clone(), observer.clone(), binding.clone());
        observer.emit(
            "permission_request",
            Some(agent_index),
            observer_context,
            serde_json::json!({
                "requestId": binding.request_id,
                "ownerPubkey": binding.owner_pubkey,
                "agentPubkey": binding.agent_pubkey,
                "relayUrl": binding.relay_url,
                "runtimeStartNonce": binding.runtime_start_nonce,
                "agentIndex": binding.agent_index,
                "sessionId": binding.session_id,
                "turnId": binding.turn_id,
                "channelId": binding.channel_id,
                "toolName": details.tool_name,
                "action": details.action,
                "context": details.context,
            }),
        );

        let outcome = match timeout(self.timeout, decision_rx).await {
            Ok(Ok(PermissionDecision::Approve)) => PermissionOutcome::Approved,
            Ok(Ok(PermissionDecision::Deny)) => PermissionOutcome::Denied,
            Ok(Err(_)) => PermissionOutcome::Denied,
            Err(_) => PermissionOutcome::TimedOut,
        };
        guard.finish(permission_outcome_name(outcome));
        outcome
    }

    /// Resolve a pending request only if every request identity field matches.
    pub fn resolve_control(&self, payload: &Value) -> Result<(), String> {
        let control = serde_json::from_value::<PermissionDecisionControl>(payload.clone())
            .map_err(|_| "invalid permission decision".to_string())?;
        if control.control_type != "resolve_permission" {
            return Err("unsupported permission control".into());
        }

        let pending = {
            let mut state = self
                .pending
                .lock()
                .map_err(|_| "permission registry unavailable".to_string())?;
            let entry = state
                .by_request_id
                .get(&control.binding.request_id)
                .ok_or_else(|| "permission request is no longer pending".to_string())?;
            if Instant::now() >= entry.expires_at {
                state.by_request_id.remove(&control.binding.request_id);
                return Err("permission request expired".into());
            }
            if entry.binding != control.binding {
                return Err("permission request binding does not match".into());
            }
            state
                .by_request_id
                .remove(&control.binding.request_id)
                .ok_or_else(|| "permission request is no longer pending".to_string())?
        };

        pending
            .decision_tx
            .send(control.decision)
            .map_err(|_| "permission request is no longer awaiting a decision".into())
    }

    #[cfg(test)]
    pub fn pending_count(&self) -> usize {
        self.pending
            .lock()
            .map(|pending| pending.by_request_id.len())
            .unwrap_or_default()
    }

    fn remove(&self, request_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.by_request_id.remove(request_id);
        }
    }
}

struct PendingRequestGuard {
    broker: PermissionBroker,
    observer: ObserverHandle,
    binding: PermissionBinding,
    finished: bool,
}

impl PendingRequestGuard {
    fn new(broker: PermissionBroker, observer: ObserverHandle, binding: PermissionBinding) -> Self {
        Self {
            broker,
            observer,
            binding,
            finished: false,
        }
    }

    fn finish(mut self, status: &str) {
        self.broker.remove(&self.binding.request_id);
        self.emit_result(status);
        self.finished = true;
    }

    fn emit_result(&self, status: &str) {
        let context = ObserverContext {
            channel_id: self.binding.channel_id.clone(),
            session_id: Some(self.binding.session_id.clone()),
            turn_id: Some(self.binding.turn_id.clone()),
            started_at: None,
        };
        self.observer.emit(
            "permission_result",
            Some(self.binding.agent_index),
            &context,
            serde_json::json!({
                "requestId": self.binding.request_id,
                "status": status,
            }),
        );
    }
}

impl Drop for PendingRequestGuard {
    fn drop(&mut self) {
        self.broker.remove(&self.binding.request_id);
        if !self.finished {
            self.emit_result("cancelled");
        }
    }
}

struct SafePermissionDetails {
    tool_name: String,
    action: String,
    context: Value,
}

fn safe_permission_details(params: &Value) -> SafePermissionDetails {
    let subject = params.get("subject").unwrap_or(&Value::Null);
    let tool_call = subject
        .get("toolCall")
        .or_else(|| params.get("toolCall"))
        .unwrap_or(&Value::Null);
    let raw_input = tool_call.get("rawInput").unwrap_or(&Value::Null);
    let tool_name = first_string([
        raw_input.get("toolName"),
        raw_input.get("tool_name"),
        raw_input.get("name"),
        tool_call.get("kind"),
        subject.get("type"),
    ])
    .unwrap_or_else(|| "Agent tool".into());
    let action = first_string([
        tool_call.get("title"),
        params.get("title"),
        params.get("message"),
        params.get("reason"),
    ])
    .unwrap_or_else(|| format!("The agent requested permission to use {tool_name}."));

    let mut context = sanitize_context(raw_input, 0);
    if serde_json::to_vec(&context)
        .map(|bytes| bytes.len() > MAX_PERMISSION_CONTEXT_BYTES)
        .unwrap_or(true)
    {
        context = Value::String("Request details omitted because they were too large.".into());
    }

    SafePermissionDetails {
        tool_name: redact_and_bound(&tool_name, 128),
        action: redact_and_bound(&action, 256),
        context,
    }
}

fn first_string<'a>(values: impl IntoIterator<Item = Option<&'a Value>>) -> Option<String> {
    values.into_iter().flatten().find_map(|value| {
        value
            .as_str()
            .filter(|text| !text.trim().is_empty())
            .map(str::to_owned)
    })
}

fn sanitize_context(value: &Value, depth: usize) -> Value {
    if depth >= MAX_CONTEXT_DEPTH {
        return Value::String("[nested details omitted]".into());
    }
    match value {
        Value::Object(object) => {
            let mut safe = serde_json::Map::new();
            for (index, (key, value)) in object.iter().enumerate() {
                if index >= MAX_CONTEXT_ITEMS {
                    safe.insert(
                        "more".into(),
                        Value::String("[additional fields omitted]".into()),
                    );
                    break;
                }
                if sensitive_key(key) {
                    safe.insert(key.clone(), Value::String("[REDACTED]".into()));
                } else {
                    safe.insert(key.clone(), sanitize_context(value, depth + 1));
                }
            }
            Value::Object(safe)
        }
        Value::Array(values) => Value::Array(
            values
                .iter()
                .take(MAX_CONTEXT_ITEMS)
                .map(|value| sanitize_context(value, depth + 1))
                .collect(),
        ),
        Value::String(text) => Value::String(redact_and_bound(text, MAX_CONTEXT_STRING_BYTES)),
        Value::Null | Value::Bool(_) | Value::Number(_) => value.clone(),
    }
}

pub(crate) fn sanitize_observer_context(value: &Value) -> Value {
    sanitize_context(value, 0)
}

fn sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase().replace(['_', '-', '.'], "");
    [
        "password",
        "passwd",
        "secret",
        "token",
        "apikey",
        "privatekey",
        "credential",
        "authorization",
        "cookie",
        "nsec",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn redact_and_bound(value: &str, max_bytes: usize) -> String {
    let mut safe = value.to_owned();
    for marker in ["nsec1", "ghp_", "gho_", "github_pat_", "glpat-", "sk-"] {
        safe = redact_token_after_marker(&safe, marker);
    }
    safe = redact_assignment_values(&safe);
    truncate_utf8(&safe, max_bytes)
}

fn redact_token_after_marker(value: &str, marker: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut remaining = value;
    while let Some(index) = remaining.find(marker) {
        let start = index + marker.len();
        result.push_str(&remaining[..start]);
        let token_len = remaining[start..]
            .find(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | ',' | ')' | ']'))
            .unwrap_or(remaining.len() - start);
        result.push_str("[REDACTED]");
        remaining = &remaining[start + token_len..];
    }
    result.push_str(remaining);
    result
}

fn redact_assignment_values(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let mut ranges = Vec::new();
    for marker in [
        "password=",
        "token=",
        "secret=",
        "api_key=",
        "apikey=",
        "authorization: bearer ",
    ] {
        let mut from = 0;
        while let Some(relative) = lower[from..].find(marker) {
            let start = from + relative + marker.len();
            let end = value[start..]
                .find(|ch: char| ch.is_whitespace() || matches!(ch, '&' | '"' | '\'' | ',' | ';'))
                .map(|offset| start + offset)
                .unwrap_or(value.len());
            if end > start {
                ranges.push((start, end));
            }
            from = end.max(start);
            if from >= value.len() {
                break;
            }
        }
    }
    ranges.sort_unstable();
    let mut result = String::with_capacity(value.len());
    let mut cursor = 0;
    for (start, end) in ranges {
        if start < cursor {
            continue;
        }
        result.push_str(&value[cursor..start]);
        result.push_str("[REDACTED]");
        cursor = end;
    }
    result.push_str(&value[cursor..]);
    result
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

fn valid_pubkey(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn permission_outcome_name(outcome: PermissionOutcome) -> &'static str {
    match outcome {
        PermissionOutcome::Approved => "approved",
        PermissionOutcome::Denied => "denied",
        PermissionOutcome::TimedOut => "timed_out",
        PermissionOutcome::Unavailable => "unavailable",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> PermissionRuntimeIdentity {
        PermissionRuntimeIdentity {
            owner_pubkey: "11".repeat(32),
            agent_pubkey: "22".repeat(32),
            relay_url: "ws://127.0.0.1:3000".into(),
            runtime_start_nonce: "runtime-a".into(),
        }
    }

    fn context() -> ObserverContext {
        ObserverContext {
            channel_id: Some("channel-a".into()),
            session_id: Some("session-a".into()),
            turn_id: Some("turn-a".into()),
            started_at: None,
        }
    }

    fn control(binding: &PermissionBinding, decision: PermissionDecision) -> Value {
        let mut value = serde_json::to_value(binding).unwrap_or_default();
        if let Some(object) = value.as_object_mut() {
            object.insert("type".into(), Value::String("resolve_permission".into()));
            object.insert(
                "decision".into(),
                serde_json::to_value(decision).unwrap_or(Value::Null),
            );
        }
        value
    }

    async fn wait_for_request(observer: &ObserverHandle) -> Value {
        let mut rx = observer.subscribe();
        if let Some(event) = observer
            .snapshot()
            .into_iter()
            .find(|event| event.kind == "permission_request")
        {
            return event.payload;
        }
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if let Ok(event) = rx.recv().await {
                    if event.kind == "permission_request" {
                        return event.payload;
                    }
                }
            }
        })
        .await
        .unwrap_or(Value::Null)
    }

    fn payload_binding(payload: &Value) -> PermissionBinding {
        serde_json::from_value(payload.clone()).unwrap_or_else(|_| PermissionBinding {
            request_id: String::new(),
            owner_pubkey: String::new(),
            agent_pubkey: String::new(),
            relay_url: String::new(),
            runtime_start_nonce: String::new(),
            agent_index: usize::MAX,
            session_id: String::new(),
            turn_id: String::new(),
            channel_id: None,
        })
    }

    #[tokio::test]
    async fn request_is_exactly_bound_and_duplicate_decision_is_rejected() {
        let observer = ObserverHandle::in_process();
        let broker = PermissionBroker::new(identity());
        let requester = {
            let broker = broker.clone();
            let observer = observer.clone();
            tokio::spawn(async move {
                broker
                    .request(
                        Some(&observer),
                        Some(2),
                        &context(),
                        &serde_json::json!({
                            "title":"shell",
                            "subject":{"toolCall":{"title":"shell","rawInput":{"command":"echo safe"}}},
                        }),
                    )
                    .await
            })
        };
        let request = wait_for_request(&observer).await;
        let binding = payload_binding(&request);
        assert_eq!(binding.agent_index, 2);
        assert_eq!(binding.session_id, "session-a");
        assert_eq!(binding.turn_id, "turn-a");

        broker
            .resolve_control(&control(&binding, PermissionDecision::Approve))
            .expect("first owner decision is accepted");
        assert!(broker
            .resolve_control(&control(&binding, PermissionDecision::Approve))
            .is_err());
        assert_eq!(
            requester.await.unwrap_or(PermissionOutcome::Unavailable),
            PermissionOutcome::Approved
        );
        assert_eq!(broker.pending_count(), 0);
    }

    #[tokio::test]
    async fn mismatched_owner_runtime_or_turn_cannot_resolve_a_request() {
        let observer = ObserverHandle::in_process();
        let broker = PermissionBroker::new(identity());
        let task = {
            let broker = broker.clone();
            let observer = observer.clone();
            tokio::spawn(async move {
                broker
                    .request(Some(&observer), Some(0), &context(), &Value::Null)
                    .await
            })
        };
        let request = wait_for_request(&observer).await;
        let binding = payload_binding(&request);
        let mut stale = binding.clone();
        stale.owner_pubkey = "33".repeat(32);
        assert!(broker
            .resolve_control(&control(&stale, PermissionDecision::Approve))
            .is_err());

        stale = binding.clone();
        stale.runtime_start_nonce = "old-runtime".into();
        assert!(broker
            .resolve_control(&control(&stale, PermissionDecision::Approve))
            .is_err());
        stale = binding.clone();
        stale.turn_id = "other-turn".into();
        assert!(broker
            .resolve_control(&control(&stale, PermissionDecision::Approve))
            .is_err());
        assert!(broker
            .resolve_control(&control(&binding, PermissionDecision::Deny))
            .is_ok());
        assert_eq!(
            task.await.unwrap_or(PermissionOutcome::Unavailable),
            PermissionOutcome::Denied
        );
    }

    #[tokio::test]
    async fn timeout_and_cancel_remove_pending_requests() {
        let observer = ObserverHandle::in_process();
        let broker = PermissionBroker::with_limits(identity(), Duration::from_millis(10), 1);
        assert_eq!(
            broker
                .request(Some(&observer), Some(0), &context(), &Value::Null)
                .await,
            PermissionOutcome::TimedOut
        );
        assert_eq!(broker.pending_count(), 0);

        // Keep the cancellation phase's replay snapshot free of the earlier
        // timed-out request; wait_for_request intentionally accepts replayed
        // requests so it cannot miss an event emitted before subscription.
        let observer = ObserverHandle::in_process();
        let broker = PermissionBroker::with_limits(identity(), Duration::from_secs(1), 1);
        let task = {
            let broker = broker.clone();
            let observer = observer.clone();
            tokio::spawn(async move {
                broker
                    .request(Some(&observer), Some(0), &context(), &Value::Null)
                    .await
            })
        };
        let _ = wait_for_request(&observer).await;
        assert_eq!(broker.pending_count(), 1);
        task.abort();
        let _ = task.await;
        assert_eq!(broker.pending_count(), 0);
    }

    #[test]
    fn permission_context_redacts_credentials_and_bounds_values() {
        let details = safe_permission_details(&serde_json::json!({
            "title":"shell",
            "subject":{"toolCall":{"title":"Run command","rawInput":{
                "command":"curl https://example.test?token=secret-value",
                "apiKey":"api-secret",
                "path":"/tmp/output"
            }}}
        }));
        let rendered = serde_json::to_string(&details.context).unwrap_or_default();
        assert!(rendered.contains("[REDACTED]"));
        assert!(!rendered.contains("secret-value"));
        assert!(!rendered.contains("api-secret"));
        assert!(rendered.contains("/tmp/output"));

        let huge = safe_permission_details(&serde_json::json!({
            "subject":{"toolCall":{"title":"shell","rawInput":{"arg":"x".repeat(5000)}}}
        }));
        assert!(
            serde_json::to_vec(&huge.context)
                .map(|bytes| bytes.len())
                .unwrap_or(usize::MAX)
                <= MAX_PERMISSION_CONTEXT_BYTES
        );
    }

    #[tokio::test]
    async fn missing_observer_or_runtime_identity_fails_closed_without_registration() {
        let broker = PermissionBroker::new(PermissionRuntimeIdentity {
            runtime_start_nonce: String::new(),
            ..identity()
        });
        assert_eq!(broker.pending_count(), 0);
        assert_eq!(
            broker
                .request(None, Some(0), &context(), &Value::Null)
                .await,
            PermissionOutcome::Unavailable
        );
    }
}
