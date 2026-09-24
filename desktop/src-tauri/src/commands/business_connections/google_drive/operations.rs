use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

use super::super::{adapter::CredentialStore, scope::ConnectionScope};
use super::GoogleConnectionError;

const MAX_OPERATION_SCOPES: usize = 128;

struct ScopeOperations {
    generation: Mutex<u64>,
    refresh_gate: tokio::sync::Mutex<()>,
}

struct ScopeOperationEntry {
    operations: Arc<ScopeOperations>,
    last_used: u64,
}

#[derive(Default)]
struct ScopeOperationRegistry {
    scopes: HashMap<String, ScopeOperationEntry>,
    clock: u64,
}

static SCOPE_OPERATIONS: OnceLock<Mutex<ScopeOperationRegistry>> = OnceLock::new();

pub(super) struct OperationLease {
    operations: Arc<ScopeOperations>,
    generation: u64,
}

impl OperationLease {
    pub(super) fn ensure_current(&self) -> Result<(), GoogleConnectionError> {
        self.with_current(|| Ok(()))
    }

    pub(super) fn refresh_gate(&self) -> &tokio::sync::Mutex<()> {
        &self.operations.refresh_gate
    }

    /// Hold the scope fence through the operation that mutates the credential store.
    pub(super) fn with_current<T>(
        &self,
        action: impl FnOnce() -> Result<T, GoogleConnectionError>,
    ) -> Result<T, GoogleConnectionError> {
        let generation = self
            .operations
            .generation
            .lock()
            .map_err(|_| GoogleConnectionError::Store)?;
        if *generation != self.generation {
            return Err(GoogleConnectionError::OperationSuperseded);
        }
        action()
    }
}

pub(super) fn operation_lease(
    scope: &ConnectionScope,
    advance: bool,
) -> Result<OperationLease, GoogleConnectionError> {
    let operations = scope_operations(&scope.keyring_key("google"))?;
    let mut generation = operations
        .generation
        .lock()
        .map_err(|_| GoogleConnectionError::Store)?;
    if advance {
        advance_generation(&mut generation);
    }
    Ok(OperationLease {
        operations: Arc::clone(&operations),
        generation: *generation,
    })
}

/// Fence pending operations and remove the credential while holding the same generation lock
/// used by every save. Calls through separate adapter instances share this process-wide state.
pub(super) fn revoke_scope_credentials(
    scope: &ConnectionScope,
    credentials: &dyn CredentialStore,
) -> Result<(), GoogleConnectionError> {
    let key = scope.keyring_key("google");
    let registry = SCOPE_OPERATIONS.get_or_init(Default::default);
    let operations = {
        let mut registry = registry.lock().map_err(|_| GoogleConnectionError::Store)?;
        registry.clock = registry.clock.wrapping_add(1);
        let last_used = registry.clock;
        if let Some(entry) = registry.scopes.get_mut(&key) {
            entry.last_used = last_used;
            Some(Arc::clone(&entry.operations))
        } else {
            // No operation can hold this scope's state without the registry entry. Keep the
            // registry lock through deletion so a fresh operation cannot start in between.
            credentials
                .delete(&key)
                .map_err(|_| GoogleConnectionError::Store)?;
            None
        }
    };

    if let Some(operations) = operations {
        let mut generation = operations
            .generation
            .lock()
            .map_err(|_| GoogleConnectionError::Store)?;
        advance_generation(&mut generation);
        credentials
            .delete(&key)
            .map_err(|_| GoogleConnectionError::Store)?;
    }
    Ok(())
}

fn scope_operations(key: &str) -> Result<Arc<ScopeOperations>, GoogleConnectionError> {
    let registry = SCOPE_OPERATIONS.get_or_init(Default::default);
    let mut registry = registry.lock().map_err(|_| GoogleConnectionError::Store)?;
    registry.clock = registry.clock.wrapping_add(1);
    let last_used = registry.clock;
    if let Some(entry) = registry.scopes.get_mut(key) {
        entry.last_used = last_used;
        return Ok(Arc::clone(&entry.operations));
    }

    if registry.scopes.len() >= MAX_OPERATION_SCOPES {
        let evictable = registry
            .scopes
            .iter()
            .filter(|(_, entry)| Arc::strong_count(&entry.operations) == 1)
            .min_by_key(|(_, entry)| entry.last_used)
            .map(|(key, _)| key.clone());
        if let Some(evictable) = evictable {
            registry.scopes.remove(&evictable);
        } else {
            return Err(GoogleConnectionError::TooManyConcurrentOperations);
        }
    }

    let operations = Arc::new(ScopeOperations {
        generation: Mutex::new(0),
        refresh_gate: tokio::sync::Mutex::new(()),
    });
    registry.scopes.insert(
        key.to_string(),
        ScopeOperationEntry {
            operations: Arc::clone(&operations),
            last_used,
        },
    );
    Ok(operations)
}

fn advance_generation(generation: &mut u64) {
    *generation = generation.wrapping_add(1);
    if *generation == 0 {
        *generation = 1;
    }
}
