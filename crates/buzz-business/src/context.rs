//! Shared interpretation of the signed relay's Business context catalog.
//!
//! These pure checks do not authenticate a caller. Adapters must obtain current
//! metadata and memberships from the chosen host using the caller's own identity.

use std::collections::HashSet;

use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

use crate::BUSINESS_CONTEXT_RESOURCE_TYPE;

/// Exact legacy description retained for explicit recovery of existing contexts.
pub const BUSINESS_CHANNEL_MARKER: &str = "AIOS business workspace · private company context and main-agent conversation. [aios.business-workspace:v1]";

/// Parsed NIP-29 metadata used to select a company context.
#[derive(Debug, Clone)]
pub struct ChannelMetadata {
    /// Canonical UUID string from the metadata's `d` tag.
    pub id: String,
    /// Human-readable name supplied by the host.
    pub name: String,
    /// Legacy marker, only considered when there is no typed resource tag.
    pub about: Option<String>,
    /// Whether the host explicitly marked this group private.
    pub is_private: bool,
    /// Whether the host explicitly marked this group public.
    pub is_public: bool,
    /// Archived resources cannot provide active company knowledge.
    pub archived: bool,
    /// Typed resource discriminator, including unknown future values.
    pub resource_type: Option<String>,
    /// NIP-29 channel type; missing tags retain the protocol's stream default.
    pub channel_type: String,
}

/// Distinguishes malformed host data, an unsuitable context and missing access.
#[derive(Debug, Error)]
pub enum ContextError {
    /// The metadata cannot be interpreted unambiguously.
    #[error("{0}")]
    InvalidMetadata(String),
    /// The selected resource is not an active, private Business stream.
    #[error("{0}")]
    InvalidContext(String),
    /// The requesting identity lacks a current membership.
    #[error("{0}")]
    AccessDenied(String),
}

/// Check a selected context against the requesting identity's fresh memberships.
///
/// This validates resource shape and the membership result supplied by the
/// authenticated adapter. It never grants access or replaces host enforcement.
pub fn validate_context_access(
    channel: &ChannelMetadata,
    member_ids: &HashSet<String>,
) -> Result<(), ContextError> {
    let is_business = match channel.resource_type.as_deref() {
        Some(BUSINESS_CONTEXT_RESOURCE_TYPE) => true,
        None => channel.about.as_deref() == Some(BUSINESS_CHANNEL_MARKER),
        Some(_) => false,
    };
    if !is_business {
        return Err(ContextError::InvalidContext(format!(
            "channel {} is not marked as an AIOS business workspace; refusing to use its canvas",
            channel.id
        )));
    }
    if channel.channel_type != "stream" {
        return Err(ContextError::InvalidContext(format!(
            "Business context {} must be a stream resource",
            channel.id
        )));
    }
    if channel.is_private == channel.is_public {
        return Err(ContextError::InvalidContext(format!(
            "marked channel {} does not have an unambiguous private visibility",
            channel.id
        )));
    }
    if !channel.is_private {
        return Err(ContextError::InvalidContext(format!(
            "marked channel {} is not private; refusing to use its canvas",
            channel.id
        )));
    }
    if channel.archived {
        return Err(ContextError::InvalidContext(format!(
            "marked business workspace {} is archived",
            channel.id
        )));
    }
    if !member_ids.contains(&channel.id.to_ascii_lowercase()) {
        return Err(ContextError::AccessDenied(format!(
            "the current signer is not a member of business workspace {}",
            channel.id
        )));
    }
    Ok(())
}

/// Parse host metadata while preserving typed versus legacy resource semantics.
///
/// The adapter must request kind 39000 from its authenticated host. Missing
/// tags yield no metadata; malformed resource/type discriminators fail closed.
pub fn parse_channel_metadata(event: &Value) -> Result<Option<ChannelMetadata>, ContextError> {
    let Some(tags) = event.get("tags").and_then(Value::as_array) else {
        return Ok(None);
    };
    let mut id = None;
    let mut name = None;
    let mut about = None;
    let mut is_private = false;
    let mut is_public = false;
    let mut archived = false;
    let mut resource_type = None;
    let mut channel_type = None;
    for tag in tags {
        let Some(parts) = tag.as_array() else {
            continue;
        };
        let Some(key) = parts.first().and_then(Value::as_str) else {
            continue;
        };
        let value = parts.get(1).and_then(Value::as_str);
        match key {
            "d" => id = value.map(str::to_string),
            "name" => name = value.map(str::to_string),
            "about" => about = value.map(str::to_string),
            "private" => is_private = true,
            "public" => is_public = true,
            "archived" => archived = value != Some("false"),
            "t" => {
                if channel_type.is_some() || parts.len() != 2 || value.is_none_or(str::is_empty) {
                    return Err(ContextError::InvalidMetadata(
                        "channel metadata has invalid type tags".into(),
                    ));
                }
                channel_type = value.map(str::to_string);
            }
            "resource" => {
                if resource_type.is_some() || parts.len() != 2 || value.is_none_or(str::is_empty) {
                    return Err(ContextError::InvalidMetadata(
                        "channel metadata has invalid resource tags".into(),
                    ));
                }
                resource_type = value.map(str::to_string);
            }
            _ => {}
        }
    }
    let marked = about.as_deref() == Some(BUSINESS_CHANNEL_MARKER);
    let id = id.ok_or_else(|| {
        ContextError::InvalidMetadata("channel metadata is missing its d tag".into())
    })?;
    let id = Uuid::parse_str(&id)
        .map_err(|_| ContextError::InvalidMetadata("channel metadata has an invalid d tag".into()))?
        .to_string();
    let name = name
        .ok_or_else(|| {
            ContextError::InvalidMetadata("channel metadata is missing its name tag".into())
        })?
        .to_string();
    if marked && name.trim().is_empty() {
        return Err(ContextError::InvalidMetadata(
            "marked business channel has an empty name".into(),
        ));
    }
    Ok(Some(ChannelMetadata {
        id,
        name,
        about,
        is_private,
        is_public,
        archived,
        resource_type,
        channel_type: channel_type.unwrap_or_else(|| "stream".into()),
    }))
}
