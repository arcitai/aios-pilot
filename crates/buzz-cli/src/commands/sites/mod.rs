mod schema;

use std::{collections::HashSet, fs, io::Write, path::PathBuf};

use clap::Subcommand;
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    client::{extract_d_tag, extract_tag_value, normalize_write_response, BuzzClient},
    error::CliError,
    validate::{parse_uuid, validate_hex64},
};

const BUSINESS_WORKSPACE_DESCRIPTION: &str = "AIOS business workspace · private company context and main-agent conversation. [aios.business-workspace:v1]";
const SITE_CHANNEL_DESCRIPTION_PREFIX: &str = "AIOS private site workspace for business channel ";
const SITE_CHANNEL_MARKER: &str = "[aios.site-channel:v1]";
const MAX_MEMBER_CHANNELS: u32 = 10_000;
const MEMBER_METADATA_BATCH_SIZE: usize = 100;

#[derive(Subcommand)]
/// Commands for private site documents and offline exports.
pub enum SitesCmd {
    /// List private Sites channels belonging to a business workspace
    List {
        /// Exact business workspace channel UUID
        #[arg(long)]
        business_channel: String,
    },
    /// Show the saved Sites document and current canvas revision
    Show {
        /// Exact business workspace channel UUID
        #[arg(long)]
        business_channel: String,
        /// Exact private Sites channel UUID
        #[arg(long)]
        site_channel: String,
    },
    /// Replace a Sites document with an expected-revision check
    Update {
        /// Exact business workspace channel UUID
        #[arg(long)]
        business_channel: String,
        /// Exact private Sites channel UUID
        #[arg(long)]
        site_channel: String,
        /// Current canvas event ID, or 'none' only when the canvas has no head
        #[arg(long)]
        expected_revision: String,
        /// Strict Sites v1 JSON file, or '-' to read stdin
        #[arg(long, value_name = "PATH")]
        document: PathBuf,
    },
    /// Export a saved Sites document as standalone HTML (never publishes)
    Export {
        /// Exact business workspace channel UUID
        #[arg(long)]
        business_channel: String,
        /// Exact private Sites channel UUID
        #[arg(long)]
        site_channel: String,
        /// Write HTML to this path instead of stdout
        #[arg(long, value_name = "PATH")]
        output: Option<PathBuf>,
    },
}

/// Execute a site command using the captured relay client and signing identity.
pub async fn dispatch_sites(command: SitesCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        SitesCmd::List { business_channel } => list_sites(client, &business_channel).await,
        SitesCmd::Show {
            business_channel,
            site_channel,
        } => show_site(client, &business_channel, &site_channel).await,
        SitesCmd::Update {
            business_channel,
            site_channel,
            expected_revision,
            document,
        } => {
            update_site(
                client,
                &business_channel,
                &site_channel,
                &expected_revision,
                &document,
            )
            .await
        }
        SitesCmd::Export {
            business_channel,
            site_channel,
            output,
        } => export_site(client, &business_channel, &site_channel, output.as_deref()).await,
    }
}

async fn list_sites(client: &BuzzClient, business_channel: &str) -> Result<(), CliError> {
    canonical_uuid(business_channel, "business channel")?;
    ensure_business_channel(client, business_channel).await?;

    let signer = client.keys().public_key().to_hex();
    let memberships = client
        .query_all_bounded(
            json!({
                "kinds": [39002],
                "#p": [signer],
                "consistency": "strong",
            }),
            MAX_MEMBER_CHANNELS,
        )
        .await?;
    let member_channels: HashSet<String> = memberships
        .iter()
        .filter(|event| member_snapshot_contains(event, &signer))
        .map(extract_d_tag)
        .filter(|channel_id| canonical_uuid(channel_id, "member channel").is_ok())
        .collect();

    let channel_ids: Vec<String> = member_channels.iter().cloned().collect();
    let expected_description = site_channel_description(business_channel);
    let mut sites = Vec::new();
    for channel_batch in channel_ids.chunks(MEMBER_METADATA_BATCH_SIZE) {
        if channel_batch.is_empty() {
            continue;
        }
        let events = query_events(
            client,
            json!({
                "kinds": [39000],
                "#d": channel_batch,
                "limit": channel_batch.len(),
                "consistency": "strong",
            }),
        )
        .await?;
        for event in events {
            let channel_id = extract_d_tag(&event);
            if !member_channels.contains(&channel_id)
                || !is_active_private_stream_channel(&event)
                || extract_tag_value(&event, "about") != expected_description
            {
                continue;
            }
            sites.push(SiteChannelSummary {
                business_channel_id: business_channel.to_string(),
                site_channel_id: channel_id,
                channel_name: extract_tag_value(&event, "name"),
            });
        }
    }
    sites.sort_by(|left, right| left.site_channel_id.cmp(&right.site_channel_id));
    print_json(&sites)
}

async fn show_site(
    client: &BuzzClient,
    business_channel: &str,
    site_channel: &str,
) -> Result<(), CliError> {
    let business_uuid = canonical_uuid(business_channel, "business channel")?;
    let site_uuid = canonical_uuid(site_channel, "site channel")?;
    ensure_site_access(client, business_channel, site_channel).await?;

    let head = fetch_canvas_head(client, site_channel).await?;
    let (revision, updated_at, document) = match head {
        Some(head) => {
            let revision = head
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| CliError::Other("canvas head has no event ID".to_string()))?;
            let content = head.get("content").and_then(Value::as_str).ok_or_else(|| {
                CliError::Other("canvas head has no document content".to_string())
            })?;
            let document = schema::parse_saved_document(content)?;
            validate_document_scope(
                &document,
                &site_uuid.to_string(),
                &business_uuid.to_string(),
            )?;
            let updated_at = head.get("created_at").cloned().unwrap_or(Value::Null);
            (revision.to_string(), updated_at, Some(document))
        }
        None => ("none".to_string(), Value::Null, None),
    };

    print_json(&json!({
        "business_channel_id": business_channel,
        "site_channel_id": site_channel,
        "revision": revision,
        "updated_at": updated_at,
        "document": document,
    }))
}

async fn update_site(
    client: &BuzzClient,
    business_channel: &str,
    site_channel: &str,
    expected_revision: &str,
    document_path: &std::path::Path,
) -> Result<(), CliError> {
    let business_uuid = canonical_uuid(business_channel, "business channel")?;
    let site_uuid = canonical_uuid(site_channel, "site channel")?;
    let expected_revision = parse_expected_revision(expected_revision)?;
    let document = schema::read_document(document_path)?;
    validate_document_scope(
        &document,
        &site_uuid.to_string(),
        &business_uuid.to_string(),
    )?;
    let content = schema::serialize_document(&document)?;
    ensure_site_access(client, business_channel, site_channel).await?;

    let head = fetch_canvas_head(client, site_channel).await?;
    let builder = match (expected_revision.as_deref(), head.as_ref()) {
        (None, None) => buzz_sdk::build_set_canvas(site_uuid, &content, Some("none")),
        (Some(expected), Some(head)) => {
            let head_id = head
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| CliError::Other("canvas head has no event ID".to_string()))?;
            if expected != head_id {
                return Err(CliError::Conflict(format!(
                    "expected canvas revision {expected}, but the current revision is {head_id}; re-read the site before updating"
                )));
            }
            let created_at = head
                .get("created_at")
                .and_then(Value::as_u64)
                .ok_or_else(|| CliError::Other("canvas head has an invalid timestamp".to_string()))?;
            buzz_sdk::build_set_canvas_after_head(site_uuid, &content, head_id, created_at)
        }
        (None, Some(head)) => {
            let head_id = head.get("id").and_then(Value::as_str).unwrap_or("unknown");
            return Err(CliError::Conflict(format!(
                "expected an empty canvas, but the current revision is {head_id}; re-read the site before updating"
            )));
        }
        (Some(expected), None) => {
            return Err(CliError::Conflict(format!(
                "expected canvas revision {expected}, but this site has no canvas head; re-read the site before updating"
            )));
        }
    }
    .map_err(|error| CliError::Other(format!("build_set_canvas failed: {error}")))?;

    let event = client.sign_event(builder)?;
    let event_id = event.id.to_hex();
    match client.submit_event(event).await {
        Ok(response) => {
            verify_accepted_write(client, site_channel, &event_id, &response).await?;
            Ok(())
        }
        Err(error @ CliError::Relay { status: 409, .. }) if matches!(&error, CliError::Relay { body, .. } if body.contains("canvas changed")) => {
            reconcile_uncertain_write(client, site_channel, &event_id, error).await
        }
        Err(error @ CliError::DeliveryUnknown(_)) => {
            reconcile_uncertain_write(client, site_channel, &event_id, error).await
        }
        Err(error) => Err(error),
    }
}

async fn export_site(
    client: &BuzzClient,
    business_channel: &str,
    site_channel: &str,
    output_path: Option<&std::path::Path>,
) -> Result<(), CliError> {
    let business_uuid = canonical_uuid(business_channel, "business channel")?;
    let site_uuid = canonical_uuid(site_channel, "site channel")?;
    ensure_site_access(client, business_channel, site_channel).await?;
    let head = fetch_canvas_head(client, site_channel)
        .await?
        .ok_or_else(|| CliError::NotFound(format!("site {site_channel} has no saved document")))?;
    let content = head
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("canvas head has no document content".to_string()))?;
    let document = schema::parse_saved_document(content)?;
    validate_document_scope(
        &document,
        &site_uuid.to_string(),
        &business_uuid.to_string(),
    )?;
    let html = schema::build_standalone_html(&document);
    let revision = head
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("canvas head has no event ID".to_string()))?;

    if let Some(path) = output_path {
        fs::write(path, html).map_err(|error| {
            CliError::Usage(format!(
                "could not write export {}: {error}",
                path.display()
            ))
        })?;
        print_json(&json!({
            "business_channel_id": business_channel,
            "site_channel_id": site_channel,
            "revision": revision,
            "output": path.display().to_string(),
            "published": false,
        }))
    } else {
        std::io::stdout()
            .write_all(html.as_bytes())
            .and_then(|_| std::io::stdout().flush())
            .map_err(|error| CliError::Other(format!("could not write HTML to stdout: {error}")))
    }
}

async fn ensure_site_access(
    client: &BuzzClient,
    business_channel: &str,
    site_channel: &str,
) -> Result<(), CliError> {
    ensure_business_channel(client, business_channel).await?;
    let site_event = fetch_channel_metadata(client, site_channel)
        .await?
        .ok_or_else(|| CliError::NotFound(format!("site channel {site_channel} was not found")))?;
    if !is_active_private_stream_channel(&site_event)
        || extract_tag_value(&site_event, "about") != site_channel_description(business_channel)
    {
        return Err(CliError::Usage(format!(
            "channel {site_channel} is not an active private Sites channel for business workspace {business_channel}"
        )));
    }
    ensure_channel_membership(client, site_channel).await
}

async fn ensure_business_channel(
    client: &BuzzClient,
    business_channel: &str,
) -> Result<(), CliError> {
    let event = fetch_channel_metadata(client, business_channel)
        .await?
        .ok_or_else(|| {
            CliError::NotFound(format!("business channel {business_channel} was not found"))
        })?;
    if !is_active_private_stream_channel(&event)
        || extract_tag_value(&event, "about") != BUSINESS_WORKSPACE_DESCRIPTION
    {
        return Err(CliError::Usage(format!(
            "channel {business_channel} is not an active private AIOS business workspace"
        )));
    }
    ensure_channel_membership(client, business_channel).await
}

async fn ensure_channel_membership(client: &BuzzClient, channel_id: &str) -> Result<(), CliError> {
    let signer = client.keys().public_key().to_hex();
    let filter = json!({
        "kinds": [39002],
        "#d": [channel_id],
        "limit": 1,
        "consistency": "strong",
    });
    let events = query_events(client, filter).await?;
    let member_event = events.iter().find(|event| {
        extract_d_tag(event) == channel_id && member_snapshot_contains(event, &signer)
    });
    if member_event.is_none() {
        return Err(CliError::NotFound(format!(
            "current signer is not a member of private channel {channel_id}"
        )));
    }
    Ok(())
}

async fn fetch_channel_metadata(
    client: &BuzzClient,
    channel_id: &str,
) -> Result<Option<Value>, CliError> {
    let filter = json!({
        "kinds": [39000],
        "#d": [channel_id],
        "limit": 1,
        "consistency": "strong",
    });
    let events = query_events(client, filter).await?;
    Ok(events
        .into_iter()
        .find(|event| extract_d_tag(event) == channel_id))
}

fn is_active_private_stream_channel(event: &Value) -> bool {
    let private = has_single_element_tag(event, "private");
    let stream = extract_tag_value(event, "t") == "stream";
    let archived = extract_tag_value(event, "archived") == "true";
    event.get("kind").and_then(Value::as_u64) == Some(39000) && private && stream && !archived
}

fn has_single_element_tag(event: &Value, key: &str) -> bool {
    event
        .get("tags")
        .and_then(Value::as_array)
        .is_some_and(|tags| {
            tags.iter().any(|tag| {
                let Some(parts) = tag.as_array() else {
                    return false;
                };
                parts.len() == 1 && parts.first().and_then(Value::as_str) == Some(key)
            })
        })
}

fn member_snapshot_contains(event: &Value, signer: &str) -> bool {
    event.get("kind").and_then(Value::as_u64) == Some(39002)
        && event
            .get("tags")
            .and_then(Value::as_array)
            .is_some_and(|tags| {
                tags.iter().any(|tag| {
                    let Some(parts) = tag.as_array() else {
                        return false;
                    };
                    parts.first().and_then(Value::as_str) == Some("p")
                        && parts.get(1).and_then(Value::as_str) == Some(signer)
                })
            })
}

async fn fetch_canvas_head(
    client: &BuzzClient,
    channel_id: &str,
) -> Result<Option<Value>, CliError> {
    let filter = json!({
        "kinds": [40100],
        "#h": [channel_id],
        "limit": 1,
        "consistency": "strong",
    });
    let events = query_events(client, filter).await?;
    Ok(events.into_iter().next())
}

async fn fetch_canvas_ancestry(
    client: &BuzzClient,
    channel_id: &str,
) -> Result<Vec<(String, Option<String>)>, CliError> {
    let filter = json!({
        "kinds": [40100],
        "#h": [channel_id],
        "limit": buzz_sdk::CANVAS_ANCESTRY_WALK_MAX,
        "consistency": "strong",
    });
    let events = query_events(client, filter).await?;
    Ok(events
        .iter()
        .filter_map(|event| {
            let id = event.get("id").and_then(Value::as_str)?.to_string();
            Some((id, head_expected_revision(event)))
        })
        .collect())
}

async fn fetch_canvas_event_exists(
    client: &BuzzClient,
    channel_id: &str,
    event_id: &str,
) -> Result<bool, CliError> {
    let events = query_events(
        client,
        json!({
            "ids": [event_id],
            "kinds": [40100],
            "#h": [channel_id],
            "limit": 1,
            "consistency": "strong",
        }),
    )
    .await?;
    Ok(events
        .iter()
        .any(|event| event.get("id").and_then(Value::as_str) == Some(event_id)))
}

async fn verify_accepted_write(
    client: &BuzzClient,
    channel_id: &str,
    event_id: &str,
    response: &str,
) -> Result<(), CliError> {
    let ancestry = match fetch_canvas_ancestry(client, channel_id).await {
        Ok(ancestry) => ancestry,
        Err(error) => {
            eprintln!(
                "warning: Sites update {event_id} was accepted, but post-write verification failed: {error}"
            );
            println!("{}", normalize_write_response(response));
            return Ok(());
        }
    };
    if buzz_sdk::canvas_write_survived(event_id, &ancestry) {
        println!("{}", normalize_write_response(response));
        return Ok(());
    }
    match fetch_canvas_event_exists(client, channel_id, event_id).await {
        Ok(true) => Err(CliError::Conflict(format!(
            "Sites update {event_id} was accepted but superseded by a concurrent write; it remains in canvas history"
        ))),
        Ok(false) => Err(CliError::DeliveryUnknown(format!(
            "Sites update {event_id} was accepted but is not visible in the strongly consistent canvas read; check `buzz sites show` before retrying"
        ))),
        Err(error) => {
            eprintln!(
                "warning: Sites update {event_id} was accepted, but persistence could not be confirmed: {error}"
            );
            println!("{}", normalize_write_response(response));
            Ok(())
        }
    }
}

async fn reconcile_uncertain_write(
    client: &BuzzClient,
    channel_id: &str,
    event_id: &str,
    original_error: CliError,
) -> Result<(), CliError> {
    let ancestry = fetch_canvas_ancestry(client, channel_id).await.map_err(|error| {
        CliError::DeliveryUnknown(format!(
            "Sites update {event_id} could not be reconciled after {original_error}; strong canvas read failed: {error} — check `buzz sites show` before retrying"
        ))
    })?;
    if buzz_sdk::canvas_write_survived(event_id, &ancestry) {
        println!(
            "{}",
            json!({ "event_id": event_id, "accepted": true, "message": "" })
        );
        return Ok(());
    }
    match fetch_canvas_event_exists(client, channel_id, event_id).await {
        Ok(true) => Err(CliError::Conflict(format!(
            "Sites update {event_id} was stored but superseded by a concurrent write; it remains in canvas history"
        ))),
        Ok(false) => Err(original_error),
        Err(error) => Err(CliError::DeliveryUnknown(format!(
            "Sites update {event_id} could not be reconciled after {original_error}; event existence read failed: {error} — check `buzz sites show` before retrying"
        ))),
    }
}

fn head_expected_revision(event: &Value) -> Option<String> {
    event
        .get("tags")
        .and_then(Value::as_array)
        .and_then(|tags| {
            tags.iter().find(|tag| {
                tag.as_array()
                    .and_then(|parts| parts.first())
                    .and_then(Value::as_str)
                    == Some("expected-revision")
            })
        })
        .and_then(Value::as_array)
        .and_then(|parts| parts.get(1))
        .and_then(Value::as_str)
        .map(str::to_string)
}

async fn query_events(client: &BuzzClient, filter: Value) -> Result<Vec<Value>, CliError> {
    let response = client.query(&filter).await?;
    serde_json::from_str(&response)
        .map_err(|error| CliError::Other(format!("malformed relay query response: {error}")))
}

fn site_channel_description(business_channel: &str) -> String {
    format!("{SITE_CHANNEL_DESCRIPTION_PREFIX}{business_channel} {SITE_CHANNEL_MARKER}")
}

fn canonical_uuid(value: &str, label: &str) -> Result<Uuid, CliError> {
    let parsed = parse_uuid(value)?;
    if parsed.to_string() != value {
        return Err(CliError::Usage(format!(
            "{label} must be a canonical lowercase UUID: {value}"
        )));
    }
    Ok(parsed)
}

fn parse_expected_revision(value: &str) -> Result<Option<String>, CliError> {
    if value == "none" {
        return Ok(None);
    }
    validate_hex64(value)?;
    if value != value.to_ascii_lowercase() {
        return Err(CliError::Usage(
            "--expected-revision must use lowercase hexadecimal".to_string(),
        ));
    }
    Ok(Some(value.to_string()))
}

fn validate_document_scope(
    document: &schema::SiteDocument,
    site_channel: &str,
    business_channel: &str,
) -> Result<(), CliError> {
    if document.site_id != site_channel {
        return Err(CliError::Usage(format!(
            "document siteId {} does not match --site-channel {site_channel}",
            document.site_id
        )));
    }
    if document.parent_business_channel_id != business_channel {
        return Err(CliError::Usage(format!(
            "document parentBusinessChannelId {} does not match --business-channel {business_channel}",
            document.parent_business_channel_id
        )));
    }
    Ok(())
}

fn print_json(value: &impl Serialize) -> Result<(), CliError> {
    let serialized = serde_json::to_string(value)
        .map_err(|error| CliError::Other(format!("could not serialize Sites output: {error}")))?;
    println!("{serialized}");
    Ok(())
}

#[derive(Serialize)]
struct SiteChannelSummary {
    business_channel_id: String,
    site_channel_id: String,
    channel_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(kind: u64, tags: Value) -> Value {
        json!({ "kind": kind, "tags": tags })
    }

    #[test]
    fn requires_canonical_uuid_flags() {
        assert!(canonical_uuid("11111111-1111-4111-8111-111111111111", "business").is_ok());
        assert!(canonical_uuid("11111111111141118111111111111111", "business").is_err());
        assert!(canonical_uuid("11111111-1111-4111-8111-11111111111A", "business").is_err());
    }

    #[test]
    fn expected_revision_accepts_only_none_or_lowercase_event_ids() {
        assert_eq!(parse_expected_revision("none").unwrap(), None);
        assert_eq!(
            parse_expected_revision(&"a".repeat(64)).unwrap(),
            Some("a".repeat(64))
        );
        assert!(parse_expected_revision(&"A".repeat(64)).is_err());
        assert!(parse_expected_revision("current").is_err());
    }

    #[test]
    fn channel_access_requires_active_private_stream_metadata_and_membership() {
        let mut metadata = event(
            39000,
            json!([
                ["d", "11111111-1111-4111-8111-111111111111"],
                ["name", "site-demo"],
                ["about", BUSINESS_WORKSPACE_DESCRIPTION],
                ["t", "stream"],
                ["private"]
            ]),
        );
        assert!(is_active_private_stream_channel(&metadata));
        metadata["tags"]
            .as_array_mut()
            .unwrap()
            .push(json!(["archived", "true"]));
        assert!(!is_active_private_stream_channel(&metadata));

        let membership = event(
            39002,
            json!([
                ["d", "11111111-1111-4111-8111-111111111111"],
                ["p", "signer"]
            ]),
        );
        assert!(member_snapshot_contains(&membership, "signer"));
        assert!(!member_snapshot_contains(&membership, "other"));
    }
}
