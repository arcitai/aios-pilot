//! Explicit host registration, separate from legacy document initialization.

use nostr::{EventBuilder, Kind, Tag};

use super::*;

pub(super) async fn discover(client: &BuzzClient) -> Result<Value, CliError> {
    let (metadata, members) = channel_catalog(client).await?;
    let mut contexts = Vec::new();
    let mut canonical = None;
    for channel in metadata {
        let registered = channel.resource_type.as_deref() == Some(BUSINESS_CONTEXT_RESOURCE_TYPE);
        let legacy = channel.resource_type.is_none()
            && channel.about.as_deref() == Some(BUSINESS_CHANNEL_MARKER);
        if (!registered && !legacy) || channel.archived || !members.contains(&channel.id) {
            continue;
        }
        validate_business_channel(&channel, &members)?;
        if registered && canonical.replace(channel.id.clone()).is_some() {
            return Err(CliError::Other(
                "host returned more than one canonical Business context".into(),
            ));
        }
        contexts.push(json!({
            "context_id": channel.id, "name": channel.name, "registered": registered,
        }));
    }
    contexts.sort_by_key(|context| !context["registered"].as_bool().unwrap_or(false));
    Ok(json!({ "canonical_context_id": canonical, "contexts": contexts }))
}

pub(super) async fn adopt(client: &BuzzClient, channel_id: &str) -> Result<Value, CliError> {
    let workspace = select_business_channel(client, channel_id).await?;
    if is_registered(client, &workspace.id).await? {
        return Ok(
            json!({ "context_id": workspace.id, "registered": true, "already_registered": true }),
        );
    }
    // Validate locally for useful diagnostics. The relay repeats validation and
    // serializes adoption with every Canvas writer; this check is not authority.
    if let Some(snapshot) = fetch_snapshot(client, &workspace.id, true).await? {
        parse_canvas(&workspace.id, &snapshot.content)?;
    }
    let tags = [
        Tag::parse(["h", &workspace.id]),
        Tag::parse(["resource", BUSINESS_CONTEXT_RESOURCE_TYPE]),
    ]
    .into_iter()
    .collect::<Result<Vec<_>, _>>()
    .map_err(|error| CliError::Usage(format!("invalid context registration: {error}")))?;
    let builder = EventBuilder::new(
        Kind::Custom(buzz_core::kind::KIND_NIP29_EDIT_METADATA as u16),
        "",
    )
    .tags(tags);
    let event = client.sign_event(builder)?;
    let event_id = event.id.to_hex();
    let raw = client.submit_event(event).await?;
    let result: Value = serde_json::from_str(&raw)
        .map_err(|error| CliError::Other(format!("invalid registration response: {error}")))?;
    let duplicate = result["message"]
        .as_str()
        .is_some_and(|message| message == "duplicate" || message.starts_with("duplicate:"));
    if result["accepted"] != true && !duplicate {
        return Err(CliError::Other(format!(
            "context registration rejected: {}",
            result["message"]
        )));
    }
    if !is_registered(client, &workspace.id).await.map_err(|error| CliError::DeliveryUnknown(format!(
        "context registration {event_id} was acknowledged but readback failed: {error}; retry business adopt with the same context ID"
    )))? {
        return Err(CliError::DeliveryUnknown(format!(
            "context registration {event_id} was acknowledged but the host reference is not visible; retry business adopt with the same context ID"
        )));
    }
    Ok(
        json!({ "context_id": workspace.id, "registered": true, "already_registered": false, "event_id": event_id }),
    )
}

async fn is_registered(client: &BuzzClient, channel_id: &str) -> Result<bool, CliError> {
    let (metadata, members) = channel_catalog(client).await?;
    let registered: Vec<_> = metadata
        .iter()
        .filter(|channel| channel.resource_type.as_deref() == Some(BUSINESS_CONTEXT_RESOURCE_TYPE))
        .collect();
    if registered.len() > 1 {
        return Err(CliError::Other(
            "host returned more than one canonical Business context".into(),
        ));
    }
    let Some(current) = registered.first() else {
        return Ok(false);
    };
    validate_business_channel(current, &members)?;
    if current.id != channel_id {
        return Err(CliError::Conflict(format!(
            "this host already uses context {}; registration cannot retarget it",
            current.id
        )));
    }
    Ok(true)
}
