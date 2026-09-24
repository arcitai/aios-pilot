//! `buzz business` commands for the private AIOS business workspace canvas.

mod knowledge;
mod registration;

use std::{collections::HashSet, fs::File, io::Read};

use buzz_business::{
    parse_document, BusinessDocument, BusinessSource, ConnectionStatus, SourceKind,
    BUSINESS_CONTEXT_RESOURCE_TYPE, MAX_DOCUMENT_BYTES,
};
use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    client::{extract_d_tag, BuzzClient},
    commands::{channels, parse_write_response},
    error::CliError,
    BusinessCmd, BusinessSourceCmd, BusinessSourceKind,
};

/// Exact channel description shared with the desktop business-workspace discovery.
pub const BUSINESS_CHANNEL_MARKER: &str = "AIOS business workspace · private company context and main-agent conversation. [aios.business-workspace:v1]";

const CHANNEL_SCAN_LIMIT: u32 = 10_000;

#[derive(Debug, Clone)]
struct BusinessChannel {
    id: String,
}

#[derive(Debug, Clone)]
struct CanvasSnapshot {
    revision: String,
    created_at: u64,
    content: String,
}

#[derive(Debug)]
struct ChannelMetadata {
    id: String,
    name: String,
    about: Option<String>,
    is_private: bool,
    is_public: bool,
    archived: bool,
    resource_type: Option<String>,
    channel_type: String,
}

/// Dispatch one `buzz business` command, writing JSON to stdout.
pub async fn dispatch(cmd: BusinessCmd, client: &BuzzClient) -> Result<(), CliError> {
    match cmd {
        BusinessCmd::Discover => print_json(&registration::discover(client).await?),
        BusinessCmd::Adopt { channel } => print_json(&registration::adopt(client, &channel).await?),
        BusinessCmd::Index {
            channel,
            offset,
            limit,
            expected_revision,
        } => print_json(
            &knowledge::index(
                client,
                &channel,
                offset,
                limit,
                expected_revision.as_deref(),
            )
            .await?,
        ),
        BusinessCmd::Search {
            channel,
            query,
            limit,
        } => print_json(&knowledge::search(client, &channel, &query, limit).await?),
        BusinessCmd::Read {
            channel,
            entry,
            offset,
            limit,
            expected_revision,
        } => print_json(
            &knowledge::read(
                client,
                &channel,
                &entry,
                offset,
                limit,
                expected_revision.as_deref(),
            )
            .await?,
        ),
        BusinessCmd::Init {
            name,
            website,
            summary,
            audience,
            offers,
            goals,
        } => {
            let output = cmd_init(client, name, website, summary, audience, offers, goals).await?;
            print_json(&output)
        }
        BusinessCmd::Show { channel } => print_json(&cmd_show(client, &channel).await?),
        BusinessCmd::Update {
            channel,
            file,
            expected_revision,
        }
        | BusinessCmd::Import {
            channel,
            file,
            expected_revision,
        } => {
            let output = cmd_update(client, &channel, &file, expected_revision.as_deref()).await?;
            print_json(&output)
        }
        BusinessCmd::Export { channel, output } => {
            let (channel_id, document) = cmd_export(client, &channel).await?;
            let json = document.to_json().map_err(map_input_document_error)?;
            match output {
                Some(path) => {
                    std::fs::write(&path, json.as_bytes()).map_err(|error| {
                        CliError::Other(format!("could not write export `{path}`: {error}"))
                    })?;
                    print_json(&json!({
                        "channel_id": channel_id,
                        "output": path,
                        "exported": true,
                    }))
                }
                None => {
                    println!("{json}");
                    Ok(())
                }
            }
        }
        BusinessCmd::Source(source_cmd) => {
            let output = match source_cmd {
                BusinessSourceCmd::List { channel } => cmd_source_list(client, &channel).await?,
                BusinessSourceCmd::Add {
                    channel,
                    title,
                    kind,
                    content,
                    url,
                    expected_revision,
                } => {
                    cmd_source_add(
                        client,
                        &channel,
                        title,
                        kind,
                        &content,
                        url,
                        expected_revision.as_deref(),
                    )
                    .await?
                }
                BusinessSourceCmd::Remove {
                    channel,
                    id,
                    expected_revision,
                } => cmd_source_remove(client, &channel, &id, expected_revision.as_deref()).await?,
            };
            print_json(&output)
        }
    }
}

async fn cmd_init(
    client: &BuzzClient,
    name: String,
    website: String,
    summary: String,
    audience: String,
    offers: Vec<String>,
    goals: Vec<String>,
) -> Result<Value, CliError> {
    let mut initial = BusinessDocument::new(name.trim().to_string());
    initial.company.website = website;
    initial.company.summary = summary;
    initial.company.audience = audience;
    initial.company.offers = offers.join("\n");
    initial.company.goals = goals.join("\n");
    initial.validate().map_err(map_input_document_error)?;

    let (workspace, created, channel_event_id) =
        match find_business_channel_for_company(client, &initial.company.name).await? {
            Some(workspace) => (workspace, false, None),
            None => {
                let name = workspace_channel_name(&initial.company.name);
                let (workspace, event_id) = create_business_channel(client, &name).await?;
                (workspace, true, Some(event_id))
            }
        };

    let snapshot = fetch_snapshot(client, &workspace.id, true).await?;
    let (document, initialized, canvas_event_id) = match snapshot {
        Some(snapshot) => (parse_canvas(&workspace.id, &snapshot.content)?, false, None),
        None => {
            let content = initial.to_json().map_err(map_input_document_error)?;
            let response = write_document(client, &workspace.id, &content, None)
                .await
                .map_err(|error| {
                    CliError::Other(format!(
                        "business workspace channel {} exists; initial canvas write failed: {error}. Re-run `buzz business init` to resume safely",
                        workspace.id
                    ))
                })?;
            let event_id = event_id_from_write(&response)?;
            (initial, true, Some(event_id))
        }
    };

    Ok(json!({
        "channel_id": workspace.id,
        "created": created,
        "initialized": initialized,
        "channel_event_id": channel_event_id,
        "canvas_event_id": canvas_event_id,
        "document": document,
    }))
}

async fn cmd_show(client: &BuzzClient, channel_id: &str) -> Result<Value, CliError> {
    let (workspace, snapshot, document) = load_document(client, channel_id, false).await?;
    Ok(json!({
        "channel_id": workspace.id,
        "revision": snapshot.revision,
        "document": document,
    }))
}

async fn cmd_update(
    client: &BuzzClient,
    channel_id: &str,
    path: &str,
    expected_revision: Option<&str>,
) -> Result<Value, CliError> {
    let input = read_bounded_input(path)?;
    let proposed = parse_document(&input).map_err(map_input_document_error)?;
    let (workspace, snapshot, current) = load_document(client, channel_id, true).await?;
    check_expected_revision(&snapshot, expected_revision)?;
    validate_connection_transition(&current, &proposed)?;
    let content = proposed.to_json().map_err(map_input_document_error)?;
    let response = write_document(client, &workspace.id, &content, Some(&snapshot)).await?;
    let mut output = accepted_write_value(&response, &workspace.id)?;
    output["document"] = serde_json::to_value(proposed)
        .map_err(|error| CliError::Other(format!("could not encode business document: {error}")))?;
    Ok(output)
}

async fn cmd_export(
    client: &BuzzClient,
    channel_id: &str,
) -> Result<(String, BusinessDocument), CliError> {
    let (workspace, _, document) = load_document(client, channel_id, false).await?;
    Ok((workspace.id, document))
}

async fn cmd_source_list(client: &BuzzClient, channel_id: &str) -> Result<Value, CliError> {
    let (workspace, snapshot, document) = load_document(client, channel_id, false).await?;
    Ok(json!({
        "channel_id": workspace.id,
        "revision": snapshot.revision,
        "sources": document.sources,
    }))
}

async fn cmd_source_add(
    client: &BuzzClient,
    channel_id: &str,
    title: String,
    kind: BusinessSourceKind,
    content: &str,
    url: Option<String>,
    expected_revision: Option<&str>,
) -> Result<Value, CliError> {
    let content = read_bounded_content(content)?;
    let (workspace, snapshot, mut document) = load_document(client, channel_id, true).await?;
    check_expected_revision(&snapshot, expected_revision)?;
    let source = BusinessSource {
        id: Uuid::new_v4().to_string(),
        title,
        kind: match kind {
            BusinessSourceKind::Note => SourceKind::Note,
            BusinessSourceKind::Url => SourceKind::Url,
            BusinessSourceKind::File => SourceKind::File,
        },
        content,
        url,
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
    };
    document.sources.push(source.clone());
    document.validate().map_err(map_input_document_error)?;
    let content = document.to_json().map_err(map_input_document_error)?;
    let response = write_document(client, &workspace.id, &content, Some(&snapshot)).await?;
    let mut output = accepted_write_value(&response, &workspace.id)?;
    output["source"] = serde_json::to_value(source)
        .map_err(|error| CliError::Other(format!("could not encode source: {error}")))?;
    Ok(output)
}

async fn cmd_source_remove(
    client: &BuzzClient,
    channel_id: &str,
    source_id: &str,
    expected_revision: Option<&str>,
) -> Result<Value, CliError> {
    let (workspace, snapshot, mut document) = load_document(client, channel_id, true).await?;
    check_expected_revision(&snapshot, expected_revision)?;
    let Some(index) = document
        .sources
        .iter()
        .position(|source| source.id == source_id)
    else {
        return Err(CliError::NotFound(format!(
            "business source `{source_id}` was not found"
        )));
    };
    document.sources.remove(index);
    let content = document.to_json().map_err(map_input_document_error)?;
    let response = write_document(client, &workspace.id, &content, Some(&snapshot)).await?;
    let mut output = accepted_write_value(&response, &workspace.id)?;
    output["removed_source_id"] = json!(source_id);
    Ok(output)
}

async fn load_document(
    client: &BuzzClient,
    channel_id: &str,
    writer_pinned: bool,
) -> Result<(BusinessChannel, CanvasSnapshot, BusinessDocument), CliError> {
    let workspace = select_business_channel(client, channel_id).await?;
    let snapshot = fetch_snapshot(client, &workspace.id, writer_pinned)
        .await?
        .ok_or_else(|| {
            CliError::NotFound(format!(
                "business workspace {} has no document; run `buzz business init`",
                workspace.id
            ))
        })?;
    let document = parse_canvas(&workspace.id, &snapshot.content)?;
    Ok((workspace, snapshot, document))
}

fn parse_canvas(channel_id: &str, content: &str) -> Result<BusinessDocument, CliError> {
    parse_document(content).map_err(|error| {
        CliError::Other(format!(
            "business canvas for channel {channel_id} is not a valid schema-version-one document: {error}"
        ))
    })
}

async fn fetch_snapshot(
    client: &BuzzClient,
    channel_id: &str,
    writer_pinned: bool,
) -> Result<Option<CanvasSnapshot>, CliError> {
    let Some(head) = channels::fetch_canvas_head(client, channel_id, writer_pinned).await? else {
        return Ok(None);
    };
    let revision = head
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("canvas head is missing its event ID".into()))?
        .to_string();
    if revision.len() != 64
        || !revision
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(CliError::Other(
            "canvas head has a malformed event ID".into(),
        ));
    }
    let created_at = head
        .get("created_at")
        .and_then(Value::as_u64)
        .ok_or_else(|| CliError::Other("canvas head is missing a valid created_at".into()))?;
    let content = head
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("canvas head is missing string content".into()))?
        .to_string();
    if content.len() > MAX_DOCUMENT_BYTES {
        return Err(CliError::Other(format!(
            "business canvas for channel {channel_id} exceeds the {MAX_DOCUMENT_BYTES}-byte limit"
        )));
    }
    Ok(Some(CanvasSnapshot {
        revision,
        created_at,
        content,
    }))
}

fn workspace_channel_name(company_name: &str) -> String {
    let trimmed = company_name.trim();
    if trimmed.is_empty() {
        "My business".to_string()
    } else {
        trimmed.to_string()
    }
}

async fn channel_catalog(
    client: &BuzzClient,
) -> Result<(Vec<ChannelMetadata>, HashSet<String>), CliError> {
    let pubkey = client.keys().public_key().to_hex();
    let membership_events = client
        .query_all_bounded(
            json!({
                "kinds": [39002],
                "#p": [pubkey],
                "consistency": "strong",
            }),
            CHANNEL_SCAN_LIMIT,
        )
        .await?;
    let member_ids: HashSet<String> = membership_events
        .iter()
        .map(extract_d_tag)
        .filter(|id| !id.is_empty())
        .map(|id| id.to_ascii_lowercase())
        .collect();

    let metadata_events = client
        .query_all_bounded(
            json!({
                "kinds": [39000],
                "consistency": "strong",
            }),
            CHANNEL_SCAN_LIMIT,
        )
        .await?;
    let mut metadata = Vec::new();
    for event in &metadata_events {
        if let Some(channel) = parse_channel_metadata(event)? {
            metadata.push(channel);
        }
    }
    Ok((metadata, member_ids))
}

async fn find_business_channel_for_company(
    client: &BuzzClient,
    company_name: &str,
) -> Result<Option<BusinessChannel>, CliError> {
    let expected_name = workspace_channel_name(company_name);
    let (metadata, member_ids) = channel_catalog(client).await?;
    let registered: Vec<_> = metadata
        .iter()
        .filter(|channel| channel.resource_type.as_deref() == Some(BUSINESS_CONTEXT_RESOURCE_TYPE))
        .collect();
    if registered.len() > 1 {
        return Err(CliError::Other(
            "host returned more than one canonical Business context".into(),
        ));
    }
    if let Some(channel) = registered.first() {
        return validate_business_channel(channel, &member_ids).map(Some);
    }
    let named: Vec<&ChannelMetadata> = metadata
        .iter()
        .filter(|channel| channel.name.eq_ignore_ascii_case(&expected_name))
        .collect();
    if named.len() > 1 {
        return Err(CliError::Usage(format!(
            "multiple channels use the business workspace name `{expected_name}`; resolve the duplicate before continuing"
        )));
    }
    let Some(channel) = named.first().copied() else {
        return Ok(None);
    };
    validate_business_channel(channel, &member_ids).map(Some)
}

async fn select_business_channel(
    client: &BuzzClient,
    channel_id: &str,
) -> Result<BusinessChannel, CliError> {
    let selected_id = Uuid::parse_str(channel_id)
        .map_err(|_| CliError::Usage(format!("invalid business channel UUID: {channel_id}")))?
        .to_string();
    let (metadata, member_ids) = channel_catalog(client).await?;
    let matches: Vec<&ChannelMetadata> = metadata
        .iter()
        .filter(|channel| channel.id.eq_ignore_ascii_case(&selected_id))
        .collect();
    if matches.len() > 1 {
        return Err(CliError::Usage(format!(
            "channel {selected_id} has ambiguous business metadata"
        )));
    }
    let channel = matches.first().copied().ok_or_else(|| {
        CliError::NotFound(format!(
            "channel {selected_id} is not a discoverable AIOS business workspace"
        ))
    })?;
    validate_business_channel(channel, &member_ids)
}

fn validate_business_channel(
    channel: &ChannelMetadata,
    member_ids: &HashSet<String>,
) -> Result<BusinessChannel, CliError> {
    let is_business = match channel.resource_type.as_deref() {
        Some(BUSINESS_CONTEXT_RESOURCE_TYPE) => true,
        None => channel.about.as_deref() == Some(BUSINESS_CHANNEL_MARKER),
        Some(_) => false,
    };
    if !is_business {
        return Err(CliError::Usage(format!(
            "channel {} is not marked as an AIOS business workspace; refusing to use its canvas",
            channel.id
        )));
    }
    if channel.channel_type != "stream" {
        return Err(CliError::Usage(format!(
            "Business context {} must be a stream resource",
            channel.id
        )));
    }
    if channel.is_private == channel.is_public {
        return Err(CliError::Usage(format!(
            "marked channel {} does not have an unambiguous private visibility",
            channel.id
        )));
    }
    if !channel.is_private {
        return Err(CliError::Usage(format!(
            "marked channel {} is not private; refusing to use its canvas",
            channel.id
        )));
    }
    if channel.archived {
        return Err(CliError::Usage(format!(
            "marked business workspace {} is archived",
            channel.id
        )));
    }
    if !member_ids.contains(&channel.id.to_ascii_lowercase()) {
        return Err(CliError::Auth(format!(
            "the current signer is not a member of business workspace {}",
            channel.id
        )));
    }
    Ok(BusinessChannel {
        id: channel.id.clone(),
    })
}

fn parse_channel_metadata(event: &Value) -> Result<Option<ChannelMetadata>, CliError> {
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
                    return Err(CliError::Other(
                        "channel metadata has invalid type tags".into(),
                    ));
                }
                channel_type = value.map(str::to_string);
            }
            "resource" => {
                if resource_type.is_some() || parts.len() != 2 || value.is_none_or(str::is_empty) {
                    return Err(CliError::Other(
                        "channel metadata has invalid resource tags".into(),
                    ));
                }
                resource_type = value.map(str::to_string);
            }
            _ => {}
        }
    }
    let marked = about.as_deref() == Some(BUSINESS_CHANNEL_MARKER);
    let id = id.ok_or_else(|| CliError::Other("channel metadata is missing its d tag".into()))?;
    let id = Uuid::parse_str(&id)
        .map_err(|_| CliError::Other("channel metadata has an invalid d tag".into()))?
        .to_string();
    let name = name
        .ok_or_else(|| CliError::Other("channel metadata is missing its name tag".into()))?
        .to_string();
    if marked && name.trim().is_empty() {
        return Err(CliError::Other(
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

async fn create_business_channel(
    client: &BuzzClient,
    name: &str,
) -> Result<(BusinessChannel, String), CliError> {
    let id = Uuid::new_v4();
    let builder = buzz_sdk::build_create_channel(
        id,
        name,
        Some(buzz_sdk::Visibility::Private),
        Some(buzz_sdk::ChannelKind::Stream),
        Some(BUSINESS_CHANNEL_MARKER),
        None,
    )
    .map_err(|error| CliError::Other(format!("could not build business channel event: {error}")))?;
    let event = client.sign_event(builder)?;
    let raw = client.submit_event(event).await?;
    let created = parse_write_response(&raw, "business workspace channel creation was rejected")?;
    let created: Value = serde_json::from_str(&created)
        .map_err(|error| CliError::Other(format!("malformed channel create response: {error}")))?;
    let event_id = created
        .get("event_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| CliError::Other("channel create response is missing event_id".into()))?;
    let workspace = select_business_channel(client, &id.to_string()).await?;
    Ok((workspace, event_id))
}

async fn write_document(
    client: &BuzzClient,
    channel_id: &str,
    content: &str,
    snapshot: Option<&CanvasSnapshot>,
) -> Result<String, CliError> {
    let channel_uuid = Uuid::parse_str(channel_id).map_err(|_| {
        CliError::Usage(format!(
            "invalid business workspace channel ID: {channel_id}"
        ))
    })?;
    let builder = match snapshot {
        Some(snapshot) => buzz_sdk::build_set_canvas_after_head(
            channel_uuid,
            content,
            &snapshot.revision,
            snapshot.created_at,
        ),
        None => buzz_sdk::build_set_canvas(channel_uuid, content, Some("none")),
    }
    .map_err(|error| CliError::Other(format!("could not build business canvas event: {error}")))?;
    let event = client.sign_event(builder)?;
    let event_id = event.id.to_hex();
    match client.submit_event(event).await {
        Ok(response) => {
            match channels::fetch_canvas_ancestry(client, channel_id).await {
                Ok(stream) if buzz_sdk::canvas_write_survived(&event_id, &stream) => Ok(response),
                Ok(_) => match channels::fetch_canvas_event_exists(client, channel_id, &event_id).await {
                    Ok(true) => Err(CliError::Conflict(format!(
                        "business canvas write {event_id} was superseded by a concurrent edit; it remains in history"
                    ))),
                    Ok(false) => Err(CliError::DeliveryUnknown(format!(
                        "relay accepted business canvas write {event_id}, but a strong history read could not find it"
                    ))),
                    Err(_) => Err(CliError::DeliveryUnknown(format!(
                        "relay accepted business canvas write {event_id}, but its persistence could not be verified; inspect `buzz business show` before retrying"
                    ))),
                },
                Err(_) => Err(CliError::DeliveryUnknown(format!(
                    "relay accepted business canvas write {event_id}, but its persistence could not be verified; inspect `buzz business show` before retrying"
                ))),
            }
        }
        Err(error) if is_canvas_revision_conflict(&error) => {
            let stream = channels::fetch_canvas_ancestry(client, channel_id)
                .await
                .map_err(|_| {
                    CliError::DeliveryUnknown(format!(
                        "business canvas write {event_id}: the relay returned a revision conflict and history verification failed; inspect `buzz business show` before retrying"
                    ))
                })?;
            if buzz_sdk::canvas_write_survived(&event_id, &stream) {
                return Ok(json!({
                    "event_id": event_id,
                    "accepted": true,
                    "message": "",
                })
                .to_string());
            }
            match channels::fetch_canvas_event_exists(client, channel_id, &event_id).await {
                Ok(true) => Err(CliError::Conflict(format!(
                    "business canvas write {event_id} was persisted but superseded by a concurrent edit; it remains in history"
                ))),
                Ok(false) => Err(CliError::Conflict(
                    "business canvas changed since it was read; no update was written".into(),
                )),
                Err(_) => Err(CliError::DeliveryUnknown(format!(
                    "business canvas write {event_id}: the relay returned a revision conflict and persistence could not be verified; inspect `buzz business show` before retrying"
                ))),
            }
        }
        Err(error) => Err(error),
    }
}

fn is_canvas_revision_conflict(error: &CliError) -> bool {
    matches!(error, CliError::Relay { status: 409, body } if body.contains("canvas changed"))
}

fn validate_connection_transition(
    current: &BusinessDocument,
    proposed: &BusinessDocument,
) -> Result<(), CliError> {
    for connection in &proposed.connections {
        if connection.status != ConnectionStatus::Connected {
            continue;
        }
        let previously_connected = current.connections.iter().any(|existing| {
            existing.id == connection.id
                && existing.provider == connection.provider
                && existing.status == ConnectionStatus::Connected
        });
        if !previously_connected {
            return Err(CliError::Usage(format!(
                "cannot mark connection `{}` connected from the CLI; a successful provider operation is required",
                connection.id
            )));
        }
    }
    Ok(())
}

fn check_expected_revision(
    snapshot: &CanvasSnapshot,
    expected_revision: Option<&str>,
) -> Result<(), CliError> {
    let Some(expected) = expected_revision else {
        return Ok(());
    };
    if expected != "none"
        && (expected.len() != 64
            || !expected
                .chars()
                .all(|character| character.is_ascii_hexdigit()))
    {
        return Err(CliError::Usage(
            "--expected-revision must be `none` or a 64-character hexadecimal event ID".into(),
        ));
    }
    if expected == "none" || !snapshot.revision.eq_ignore_ascii_case(expected) {
        return Err(CliError::Conflict(format!(
            "business canvas revision changed: expected {expected}, current revision is {}",
            snapshot.revision
        )));
    }
    Ok(())
}

fn read_bounded_input(path: &str) -> Result<String, CliError> {
    let mut bytes = Vec::with_capacity(8 * 1024);
    if path == "-" {
        std::io::stdin()
            .take((MAX_DOCUMENT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|error| CliError::Usage(format!("could not read stdin: {error}")))?;
    } else {
        File::open(path)
            .map_err(|error| CliError::Usage(format!("could not open `{path}`: {error}")))?
            .take((MAX_DOCUMENT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|error| CliError::Usage(format!("could not read `{path}`: {error}")))?;
    }
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(CliError::Usage(format!(
            "business document exceeds the {MAX_DOCUMENT_BYTES}-byte limit"
        )));
    }
    String::from_utf8(bytes)
        .map_err(|error| CliError::Usage(format!("business document is not valid UTF-8: {error}")))
}

fn read_bounded_content(content: &str) -> Result<String, CliError> {
    if content != "-" {
        return Ok(content.to_string());
    }
    let mut bytes = Vec::new();
    std::io::stdin()
        .take((MAX_DOCUMENT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CliError::Usage(format!("could not read source content from stdin: {error}"))
        })?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(CliError::Usage(format!(
            "source content exceeds the {MAX_DOCUMENT_BYTES}-byte input limit"
        )));
    }
    String::from_utf8(bytes)
        .map_err(|error| CliError::Usage(format!("source content is not valid UTF-8: {error}")))
}

fn accepted_write_value(response: &str, channel_id: &str) -> Result<Value, CliError> {
    let normalized = parse_write_response(response, "business canvas write was superseded")?;
    let mut output: Value = serde_json::from_str(&normalized)
        .map_err(|error| CliError::Other(format!("malformed business write response: {error}")))?;
    output["channel_id"] = json!(channel_id);
    Ok(output)
}

fn event_id_from_write(response: &str) -> Result<String, CliError> {
    let normalized = parse_write_response(response, "business canvas write was superseded")?;
    let value: Value = serde_json::from_str(&normalized)
        .map_err(|error| CliError::Other(format!("malformed business write response: {error}")))?;
    value
        .get("event_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| CliError::Other("business canvas response is missing event_id".into()))
}

fn map_input_document_error(error: impl std::fmt::Display) -> CliError {
    CliError::Usage(error.to_string())
}

fn print_json(value: &Value) -> Result<(), CliError> {
    let output = serde_json::to_string(value).map_err(|error| {
        CliError::Other(format!("could not encode business command output: {error}"))
    })?;
    println!("{output}");
    Ok(())
}

#[cfg(test)]
mod tests;
