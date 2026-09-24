use std::io::{Read, Write};

use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    client::{extract_d_tag, extract_p_tags, BuzzClient},
    error::CliError,
    validate::{parse_uuid, validate_hex64},
};

const APP_CANVAS_KIND: &str = "aios.app-document";
const APP_CANVAS_VERSION: u64 = 1;
const MAX_APP_CANVAS_BYTES: usize = buzz_apps::app_document::MAX_APP_CANVAS_BYTES;
const MAX_INPUT_BYTES: usize = MAX_APP_CANVAS_BYTES + 1;
const MAX_CHANNEL_DISCOVERY_RESULTS: usize = 100;

/// A built-in document type supported by the AIOS app-channel contract.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppId {
    Slides,
    Calendar,
    Design,
}

impl AppId {
    /// All built-in apps in registry order.
    pub const ALL: [Self; 3] = [Self::Slides, Self::Calendar, Self::Design];

    /// Stable string used by the app Canvas marker and JSON schema.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Slides => "slides",
            Self::Calendar => "calendar",
            Self::Design => "design",
        }
    }

    fn parse(value: &str) -> Result<Self, CliError> {
        match value {
            "slides" => Ok(Self::Slides),
            "calendar" => Ok(Self::Calendar),
            "design" => Ok(Self::Design),
            other => Err(CliError::Usage(format!(
                "unknown app {other:?}; expected slides, calendar, or design"
            ))),
        }
    }
}

impl From<AppId> for buzz_apps::app_document::AppType {
    fn from(app_id: AppId) -> Self {
        match app_id {
            AppId::Slides => Self::Slides,
            AppId::Calendar => Self::Calendar,
            AppId::Design => Self::Design,
        }
    }
}

impl std::fmt::Display for AppId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Built-in AIOS app document subcommands.
#[derive(clap::Subcommand)]
pub enum AppsCmd {
    /// List built-in app documents accessible in a business channel.
    List {
        /// Business channel UUID that owns the apps.
        #[arg(long)]
        channel: String,
    },
    /// Show one app document and its current access list.
    Show {
        /// Business channel UUID that owns the app.
        #[arg(long)]
        channel: String,
        /// App id: slides, calendar, or design.
        #[arg(long)]
        app: String,
    },
    /// Create a private app channel and its first document.
    Create {
        /// Business channel UUID that owns the app.
        #[arg(long)]
        channel: String,
        /// App id: slides, calendar, or design.
        #[arg(long)]
        app: String,
        /// Document JSON, a file path (or @file path), or '-' for stdin.
        #[arg(long)]
        document: String,
    },
    /// Update an app document with an explicit Canvas revision precondition.
    Update {
        /// Business channel UUID that owns the app.
        #[arg(long)]
        channel: String,
        /// App id: slides, calendar, or design.
        #[arg(long)]
        app: String,
        /// Current revision from `buzz apps show`, or `none` for an empty app channel.
        #[arg(long)]
        expected_revision: String,
        /// Document JSON, a file path (or @file path), or '-' for stdin.
        #[arg(long)]
        document: String,
    },
}

/// Dispatch the `buzz apps` subcommands once registered by the root CLI.
pub async fn dispatch(cmd: AppsCmd, client: &BuzzClient) -> Result<(), CliError> {
    match cmd {
        AppsCmd::List { channel } => cmd_list_apps(client, &channel).await,
        AppsCmd::Show { channel, app } => cmd_show_app(client, &channel, &app).await,
        AppsCmd::Create {
            channel,
            app,
            document,
        } => cmd_create_app(client, &channel, &app, &document).await,
        AppsCmd::Update {
            channel,
            app,
            expected_revision,
            document,
        } => cmd_update_app(client, &channel, &app, &expected_revision, &document).await,
    }
}

#[derive(Clone, Debug)]
struct AppChannel {
    app_id: AppId,
    channel_id: String,
    marker: String,
    metadata: Value,
}

#[derive(Clone, Debug)]
struct ChannelMembers {
    members: Vec<Value>,
}

/// List private app channels the current identity can access for a business channel.
pub async fn cmd_list_apps(client: &BuzzClient, business_channel_id: &str) -> Result<(), CliError> {
    cmd_list_apps_to(client, business_channel_id, &mut std::io::stdout()).await
}

/// Output-writing seam for `cmd_list_apps`, used by focused command tests.
pub async fn cmd_list_apps_to(
    client: &BuzzClient,
    business_channel_id: &str,
    out: &mut dyn Write,
) -> Result<(), CliError> {
    let business_channel_id = canonical_channel_id(business_channel_id)?;
    let channels = discover_app_channels(client, &business_channel_id, None).await?;
    let mut apps = Vec::with_capacity(channels.len());

    for channel in channels {
        if !is_private_channel(&channel.metadata) || !is_stream_channel(&channel.metadata) {
            return Err(invalid_app_channel(
                &channel,
                "channel is not a private stream",
            ));
        }
        let Some(members) = fetch_members(client, &channel.channel_id).await? else {
            continue;
        };
        let signer = client.keys().public_key().to_hex();
        if !members_contain(&members.members, &signer) {
            continue;
        }

        let head = fetch_canvas_head(client, &channel.channel_id).await?;
        let (revision, document_valid) = match head {
            Some(event) => {
                let revision = event_string(&event, "id", "Canvas event is missing its ID")?;
                let content =
                    event_string(&event, "content", "Canvas event is missing its document")?;
                parse_app_envelope(content, &business_channel_id, channel.app_id)?;
                (Some(revision.to_string()), true)
            }
            None => (None, false),
        };
        apps.push(json!({
            "app_id": channel.app_id.as_str(),
            "channel_id": channel.channel_id,
            "marker": channel.marker,
            "private": true,
            "member": true,
            "revision": revision,
            "has_document": document_valid,
        }));
    }

    write_json(
        out,
        &json!({
            "business_channel_id": business_channel_id,
            "apps": apps,
        }),
    )
}

/// Show the validated current document from one private app channel.
pub async fn cmd_show_app(
    client: &BuzzClient,
    business_channel_id: &str,
    app_id: &str,
) -> Result<(), CliError> {
    cmd_show_app_to(client, business_channel_id, app_id, &mut std::io::stdout()).await
}

/// Output-writing seam for `cmd_show_app`, used by focused command tests.
pub async fn cmd_show_app_to(
    client: &BuzzClient,
    business_channel_id: &str,
    app_id: &str,
    out: &mut dyn Write,
) -> Result<(), CliError> {
    let business_channel_id = canonical_channel_id(business_channel_id)?;
    let app_id = AppId::parse(app_id)?;
    let channel = find_app_channel(client, &business_channel_id, app_id)
        .await?
        .ok_or_else(|| app_not_found(&business_channel_id, app_id))?;
    require_private_member(client, &channel).await?;
    let head = fetch_canvas_head(client, &channel.channel_id).await?;
    let (revision, document) = if let Some(event) = head {
        let revision = event_string(&event, "id", "Canvas event is missing its ID")?;
        let content = event_string(&event, "content", "Canvas event is missing its document")?;
        let envelope = parse_app_envelope(content, &business_channel_id, app_id)?;
        (
            Some(revision.to_string()),
            envelope.get("document").cloned(),
        )
    } else {
        (None, None)
    };
    let members = fetch_members(client, &channel.channel_id)
        .await?
        .ok_or_else(|| inaccessible_app_channel(&channel))?;
    write_json(
        out,
        &json!({
            "app_id": app_id.as_str(),
            "business_channel_id": business_channel_id,
            "channel_id": channel.channel_id,
            "marker": channel.marker,
            "private": true,
            "member": true,
            "members": members.members,
            "revision": revision,
            "document": document,
        }),
    )
}

/// Create a private app channel and write its first validated document.
pub async fn cmd_create_app(
    client: &BuzzClient,
    business_channel_id: &str,
    app_id: &str,
    input: &str,
) -> Result<(), CliError> {
    cmd_create_app_to(
        client,
        business_channel_id,
        app_id,
        input,
        &mut std::io::stdout(),
    )
    .await
}

/// Output-writing seam for `cmd_create_app`, used by focused command tests.
pub async fn cmd_create_app_to(
    client: &BuzzClient,
    business_channel_id: &str,
    app_id: &str,
    input: &str,
    out: &mut dyn Write,
) -> Result<(), CliError> {
    let business_channel_id = canonical_channel_id(business_channel_id)?;
    let app_id = AppId::parse(app_id)?;
    let document = parse_input_document(input, app_id)?;
    ensure_business_membership(client, &business_channel_id).await?;
    if find_app_channel(client, &business_channel_id, app_id)
        .await?
        .is_some()
    {
        return Err(CliError::Conflict(format!(
            "the {app_id} app channel already exists for business channel {business_channel_id}"
        )));
    }

    let channel_uuid = Uuid::new_v4();
    let channel_id = channel_uuid.to_string();
    let marker = app_canvas_marker(&business_channel_id, app_id);
    let name = format!("aios-{}-{}", app_id.as_str(), &business_channel_id[..8]);
    let builder = buzz_sdk::build_create_channel(
        channel_uuid,
        &name,
        Some(buzz_sdk::Visibility::Private),
        Some(buzz_sdk::ChannelKind::Stream),
        Some(&marker),
        None,
    )
    .map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    client
        .submit_event(event)
        .await
        .map_err(|error| match error {
            CliError::Relay { status: 409, body } => CliError::Conflict(format!(
                "could not create the app channel because the relay rejected it: {body}"
            )),
            other => other,
        })?;

    let metadata = fetch_channel_metadata(client, &channel_id)
        .await?
        .ok_or_else(|| {
            CliError::DeliveryUnknown(format!(
                "the relay accepted app channel creation for {channel_id}, but metadata readback did not find it"
            ))
        })?;
    let channel = validate_app_channel(metadata, &business_channel_id, app_id)?;
    require_private_member(client, &channel).await?;
    write_app_document(
        client,
        &business_channel_id,
        &channel,
        document,
        "none",
        true,
        out,
    )
    .await
}

/// Update a private app document using a caller-supplied Canvas revision precondition.
pub async fn cmd_update_app(
    client: &BuzzClient,
    business_channel_id: &str,
    app_id: &str,
    expected_revision: &str,
    input: &str,
) -> Result<(), CliError> {
    cmd_update_app_to(
        client,
        business_channel_id,
        app_id,
        expected_revision,
        input,
        &mut std::io::stdout(),
    )
    .await
}

/// Output-writing seam for `cmd_update_app`, used by focused command tests.
pub async fn cmd_update_app_to(
    client: &BuzzClient,
    business_channel_id: &str,
    app_id: &str,
    expected_revision: &str,
    input: &str,
    out: &mut dyn Write,
) -> Result<(), CliError> {
    let business_channel_id = canonical_channel_id(business_channel_id)?;
    let app_id = AppId::parse(app_id)?;
    let expected_revision = normalize_expected_revision(expected_revision)?;
    let document = parse_input_document(input, app_id)?;
    let channel = find_app_channel(client, &business_channel_id, app_id)
        .await?
        .ok_or_else(|| app_not_found(&business_channel_id, app_id))?;
    require_private_member(client, &channel).await?;
    write_app_document(
        client,
        &business_channel_id,
        &channel,
        document,
        &expected_revision,
        false,
        out,
    )
    .await
}

async fn write_app_document(
    client: &BuzzClient,
    business_channel_id: &str,
    channel: &AppChannel,
    document: Value,
    expected_revision: &str,
    created_channel: bool,
    out: &mut dyn Write,
) -> Result<(), CliError> {
    let app_id = channel.app_id;
    let content = serialize_app_envelope(business_channel_id, app_id, document)?;
    let channel_uuid = parse_uuid(&channel.channel_id)?;
    let head = fetch_canvas_head(client, &channel.channel_id).await?;
    let current_revision = head
        .as_ref()
        .map(|event| event_string(event, "id", "Canvas head is missing its ID"))
        .transpose()?;
    let actual_revision = current_revision.unwrap_or("none");
    if !actual_revision.eq_ignore_ascii_case(expected_revision) {
        return Err(CliError::Conflict(format!(
            "the {app_id} app changed: expected revision {expected_revision}, current revision is {actual_revision}"
        )));
    }
    if let Some(head) = &head {
        let previous_content = event_string(
            head,
            "content",
            "Current app Canvas head is missing its document",
        )?;
        parse_app_envelope(previous_content, business_channel_id, app_id)?;
    }

    let builder = match &head {
        Some(event) => {
            let head_id = event_string(event, "id", "Canvas event is missing its ID")?;
            let created_at = event
                .get("created_at")
                .and_then(Value::as_u64)
                .ok_or_else(|| CliError::Other("Canvas head has no timestamp".into()))?;
            buzz_sdk::build_set_canvas_after_head(channel_uuid, &content, head_id, created_at)
        }
        None => buzz_sdk::build_set_canvas(channel_uuid, &content, Some("none")),
    }
    .map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let event_id = event.id.to_hex();
    client.submit_event(event).await.map_err(|error| match error {
        CliError::Relay { status: 409, body } => CliError::Conflict(format!(
            "the {app_id} app changed while it was being saved; read the latest revision and retry ({body})"
        )),
        other => other,
    })?;

    let persisted = fetch_canvas_revision(client, &channel.channel_id, &event_id)
        .await?
        .ok_or_else(|| {
            CliError::DeliveryUnknown(format!(
                "the relay accepted app save {event_id}, but the Canvas event was not present on readback"
            ))
        })?;
    let persisted_content = event_string(
        &persisted,
        "content",
        "Saved app Canvas event is missing its document",
    )?;
    parse_app_envelope(persisted_content, business_channel_id, app_id)?;
    if persisted_content != content {
        return Err(CliError::DeliveryUnknown(format!(
            "app save {event_id} persisted with content that differs from the submitted document"
        )));
    }
    let latest = fetch_canvas_head(client, &channel.channel_id)
        .await?
        .ok_or_else(|| {
            CliError::DeliveryUnknown(format!(
                "app save {event_id} persisted, but no current Canvas head was returned"
            ))
        })?;
    let current_revision = event_string(&latest, "id", "Canvas head is missing its ID")?;
    write_json(
        out,
        &json!({
            "operation": if created_channel { "created" } else { "updated" },
            "app_id": app_id.as_str(),
            "business_channel_id": business_channel_id,
            "channel_id": channel.channel_id,
            "marker": channel.marker,
            "private": true,
            "member": true,
            "event_id": event_id,
            "expected_revision": expected_revision,
            "revision": current_revision,
            "readback_verified": true,
            "is_current_head": current_revision == event_id,
        }),
    )
}

async fn discover_app_channels(
    client: &BuzzClient,
    business_channel_id: &str,
    only_app: Option<AppId>,
) -> Result<Vec<AppChannel>, CliError> {
    let apps: Vec<AppId> = only_app.map_or_else(|| AppId::ALL.to_vec(), |app| vec![app]);
    let markers: Vec<String> = apps
        .iter()
        .map(|app| app_canvas_marker(business_channel_id, *app))
        .collect();
    let filter = json!({
        "kinds": [39000],
        "#about": markers,
        "limit": MAX_CHANNEL_DISCOVERY_RESULTS,
    });
    let events = query_events(client, &filter).await?;
    if events.len() >= MAX_CHANNEL_DISCOVERY_RESULTS {
        return Err(CliError::Other(format!(
            "app channel discovery reached its {} result cap",
            MAX_CHANNEL_DISCOVERY_RESULTS
        )));
    }

    let mut channels = Vec::new();
    for event in events {
        let Some(app_id) = apps.iter().copied().find(|app| {
            event_has_tag_value(
                &event,
                "about",
                &app_canvas_marker(business_channel_id, *app),
            )
        }) else {
            continue;
        };
        let channel = validate_app_channel(event, business_channel_id, app_id)?;
        if channels
            .iter()
            .any(|existing: &AppChannel| existing.app_id == app_id)
        {
            return Err(CliError::Conflict(format!(
                "multiple private channels use the exact {} app marker for business channel {business_channel_id}",
                app_id.as_str()
            )));
        }
        channels.push(channel);
    }
    Ok(channels)
}

async fn find_app_channel(
    client: &BuzzClient,
    business_channel_id: &str,
    app_id: AppId,
) -> Result<Option<AppChannel>, CliError> {
    Ok(
        discover_app_channels(client, business_channel_id, Some(app_id))
            .await?
            .into_iter()
            .next(),
    )
}

fn validate_app_channel(
    metadata: Value,
    business_channel_id: &str,
    app_id: AppId,
) -> Result<AppChannel, CliError> {
    let marker = app_canvas_marker(business_channel_id, app_id);
    if metadata.get("kind").and_then(Value::as_u64) != Some(39000)
        || !has_single_tag_value(&metadata, "about", &marker)
    {
        return Err(CliError::Other(format!(
            "channel metadata does not match the exact {} app marker",
            app_id.as_str()
        )));
    }
    let channel_id = extract_d_tag(&metadata);
    let channel_id = canonical_channel_id(&channel_id).map_err(|_| {
        CliError::Other(format!(
            "the {} app marker is attached to a channel with an invalid ID",
            app_id.as_str()
        ))
    })?;
    Ok(AppChannel {
        app_id,
        channel_id,
        marker,
        metadata,
    })
}

async fn require_private_member(
    client: &BuzzClient,
    channel: &AppChannel,
) -> Result<ChannelMembers, CliError> {
    if !is_private_channel(&channel.metadata) || !is_stream_channel(&channel.metadata) {
        return Err(invalid_app_channel(
            channel,
            "channel is not a private stream",
        ));
    }
    let members = fetch_members(client, &channel.channel_id)
        .await?
        .ok_or_else(|| inaccessible_app_channel(channel))?;
    let signer = client.keys().public_key().to_hex();
    if !members_contain(&members.members, &signer) {
        return Err(inaccessible_app_channel(channel));
    }
    Ok(members)
}

async fn ensure_business_membership(
    client: &BuzzClient,
    business_channel_id: &str,
) -> Result<(), CliError> {
    let metadata = fetch_channel_metadata(client, business_channel_id)
        .await?
        .ok_or_else(|| {
            CliError::NotFound(format!(
                "business channel {business_channel_id} was not found"
            ))
        })?;
    if extract_d_tag(&metadata) != business_channel_id {
        return Err(CliError::NotFound(format!(
            "business channel {business_channel_id} was not found"
        )));
    }
    if !has_single_tag_value(&metadata, "about", super::business::BUSINESS_CHANNEL_MARKER)
        || !is_private_channel(&metadata)
        || !is_stream_channel(&metadata)
        || event_has_tag_value(&metadata, "archived", "true")
    {
        return Err(CliError::Usage(
            "Apps must be created in an active private AIOS business workspace.".into(),
        ));
    }
    let Some(members) = fetch_members(client, business_channel_id).await? else {
        return Err(CliError::NotFound(format!(
            "the current identity is not a member of business channel {business_channel_id}"
        )));
    };
    let signer = client.keys().public_key().to_hex();
    if !members_contain(&members.members, &signer) {
        return Err(CliError::NotFound(format!(
            "the current identity is not a member of business channel {business_channel_id}"
        )));
    }
    Ok(())
}

async fn fetch_channel_metadata(
    client: &BuzzClient,
    channel_id: &str,
) -> Result<Option<Value>, CliError> {
    let filter = json!({ "kinds": [39000], "#d": [channel_id], "limit": 1 });
    Ok(query_events(client, &filter)
        .await?
        .into_iter()
        .find(|event| {
            event.get("kind").and_then(Value::as_u64) == Some(39000)
                && extract_d_tag(event) == channel_id
        }))
}

async fn fetch_members(
    client: &BuzzClient,
    channel_id: &str,
) -> Result<Option<ChannelMembers>, CliError> {
    let filter = json!({ "kinds": [39002], "#d": [channel_id], "limit": 1 });
    let event = query_events(client, &filter)
        .await?
        .into_iter()
        .find(|event| {
            event.get("kind").and_then(Value::as_u64) == Some(39002)
                && extract_d_tag(event) == channel_id
        });
    Ok(event.map(|event| ChannelMembers {
        members: extract_p_tags(&event),
    }))
}

async fn fetch_canvas_head(
    client: &BuzzClient,
    channel_id: &str,
) -> Result<Option<Value>, CliError> {
    let filter = json!({ "kinds": [40100], "#h": [channel_id], "limit": 1 });
    let event = query_events(client, &filter).await?.into_iter().next();
    if let Some(event) = &event {
        if event.get("kind").and_then(Value::as_u64) != Some(40100)
            || !event_has_tag_value(event, "h", channel_id)
        {
            return Err(CliError::Other(
                "Canvas head readback did not match the requested channel".into(),
            ));
        }
    }
    Ok(event)
}

async fn fetch_canvas_revision(
    client: &BuzzClient,
    channel_id: &str,
    revision: &str,
) -> Result<Option<Value>, CliError> {
    let filter = json!({
        "ids": [revision],
        "kinds": [40100],
        "#h": [channel_id],
        "limit": 1,
    });
    Ok(query_events(client, &filter)
        .await?
        .into_iter()
        .find(|event| {
            event.get("kind").and_then(Value::as_u64) == Some(40100)
                && event.get("id").and_then(Value::as_str) == Some(revision)
                && event_has_tag_value(event, "h", channel_id)
        }))
}

async fn query_events(client: &BuzzClient, filter: &Value) -> Result<Vec<Value>, CliError> {
    let mut filter = filter.clone();
    filter["consistency"] = json!("strong");
    let response = client.query(&filter).await?;
    serde_json::from_str::<Vec<Value>>(&response).map_err(|error| {
        CliError::Other(format!("malformed relay response for app query: {error}"))
    })
}

fn parse_input_document(input: &str, app_id: AppId) -> Result<Value, CliError> {
    let raw = read_input(input)?;
    let value = serde_json::from_str::<Value>(&raw)
        .map_err(|error| CliError::Usage(format!("app document is not valid JSON: {error}")))?;
    normalize_app_document(app_id, &value)
}

fn read_input(input: &str) -> Result<String, CliError> {
    let mut content = String::new();
    if input.trim() == "-" {
        std::io::stdin()
            .take((MAX_INPUT_BYTES + 1) as u64)
            .read_to_string(&mut content)
            .map_err(|error| {
                CliError::Usage(format!("could not read app document from stdin: {error}"))
            })?;
    } else if input.trim_start().starts_with('{') {
        content.push_str(input);
    } else {
        let path = input.strip_prefix('@').unwrap_or(input);
        let file = std::fs::File::open(path).map_err(|error| {
            CliError::Usage(format!(
                "could not read app document file {path:?}: {error}"
            ))
        })?;
        file.take((MAX_INPUT_BYTES + 1) as u64)
            .read_to_string(&mut content)
            .map_err(|error| {
                CliError::Usage(format!("app document file could not be read: {error}"))
            })?;
    }
    if content.len() > MAX_INPUT_BYTES {
        return Err(CliError::Usage(format!(
            "app document input exceeds {} bytes",
            MAX_APP_CANVAS_BYTES
        )));
    }
    Ok(content)
}

fn normalize_app_document(app_id: AppId, value: &Value) -> Result<Value, CliError> {
    buzz_apps::app_document::normalize_app_document(app_id.into(), value).map_err(CliError::Usage)
}

fn serialize_app_envelope(
    business_channel_id: &str,
    app_id: AppId,
    document: Value,
) -> Result<String, CliError> {
    let marker = app_canvas_marker(business_channel_id, app_id);
    let envelope = json!({
        "kind": APP_CANVAS_KIND,
        "schemaVersion": APP_CANVAS_VERSION,
        "marker": marker,
        "businessChannelId": business_channel_id,
        "appId": app_id.as_str(),
        "document": document,
    });
    let serialized = serde_json::to_string(&envelope)
        .map_err(|error| CliError::Other(format!("could not serialize app document: {error}")))?;
    if serialized.len() > MAX_APP_CANVAS_BYTES {
        return Err(CliError::Usage(format!(
            "app Canvas document exceeds {MAX_APP_CANVAS_BYTES} bytes"
        )));
    }
    Ok(serialized)
}

fn parse_app_envelope(
    content: &str,
    business_channel_id: &str,
    app_id: AppId,
) -> Result<Value, CliError> {
    if content.len() > MAX_APP_CANVAS_BYTES {
        return Err(CliError::Other(format!(
            "the {} app Canvas exceeds {MAX_APP_CANVAS_BYTES} bytes",
            app_id.as_str()
        )));
    }
    let value = serde_json::from_str::<Value>(content).map_err(|error| {
        CliError::Other(format!(
            "the {} app Canvas is invalid JSON: {error}",
            app_id.as_str()
        ))
    })?;
    let object = value
        .as_object()
        .ok_or_else(|| invalid_remote_envelope(app_id))?;
    if object.get("kind").and_then(Value::as_str) != Some(APP_CANVAS_KIND)
        || number_is_one(object.get("schemaVersion")) != Some(true)
        || object.get("marker").and_then(Value::as_str)
            != Some(app_canvas_marker(business_channel_id, app_id).as_str())
        || object.get("businessChannelId").and_then(Value::as_str) != Some(business_channel_id)
        || object.get("appId").and_then(Value::as_str) != Some(app_id.as_str())
    {
        return Err(invalid_remote_envelope(app_id));
    }
    let document = normalize_app_document(
        app_id,
        object
            .get("document")
            .ok_or_else(|| invalid_remote_envelope(app_id))?,
    )
    .map_err(|_| invalid_remote_envelope(app_id))?;
    Ok(json!({
        "kind": APP_CANVAS_KIND,
        "schemaVersion": APP_CANVAS_VERSION,
        "marker": app_canvas_marker(business_channel_id, app_id),
        "businessChannelId": business_channel_id,
        "appId": app_id.as_str(),
        "document": document,
    }))
}

fn normalize_expected_revision(value: &str) -> Result<String, CliError> {
    if value == "none" {
        return Ok(value.to_string());
    }
    validate_hex64(value)?;
    Ok(value.to_ascii_lowercase())
}

fn canonical_channel_id(value: &str) -> Result<String, CliError> {
    Ok(parse_uuid(value)?.to_string())
}

fn app_canvas_marker(business_channel_id: &str, app_id: AppId) -> String {
    format!(
        "aios.app-document:v1:{business_channel_id}:{}",
        app_id.as_str()
    )
}

fn is_private_channel(metadata: &Value) -> bool {
    let mut private = false;
    let mut public = false;
    if let Some(tags) = metadata.get("tags").and_then(Value::as_array) {
        for tag in tags {
            let Some(parts) = tag.as_array() else {
                continue;
            };
            match (
                parts.first().and_then(Value::as_str),
                parts.get(1).and_then(Value::as_str),
            ) {
                (Some("private"), None) | (Some("visibility"), Some("private")) => private = true,
                (Some("public"), None) | (Some("visibility"), Some("open")) => public = true,
                _ => {}
            }
        }
    }
    private && !public
}

fn is_stream_channel(metadata: &Value) -> bool {
    has_single_tag_value(metadata, "t", "stream")
}

fn members_contain(members: &[Value], pubkey: &str) -> bool {
    members.iter().any(|member| {
        member
            .get("pubkey")
            .and_then(Value::as_str)
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(pubkey))
    })
}

fn event_has_tag_value(event: &Value, name: &str, value: &str) -> bool {
    event
        .get("tags")
        .and_then(Value::as_array)
        .is_some_and(|tags| {
            tags.iter().any(|tag| {
                let Some(parts) = tag.as_array() else {
                    return false;
                };
                parts.first().and_then(Value::as_str) == Some(name)
                    && parts.get(1).and_then(Value::as_str) == Some(value)
            })
        })
}

fn has_single_tag_value(event: &Value, name: &str, value: &str) -> bool {
    let Some(tags) = event.get("tags").and_then(Value::as_array) else {
        return false;
    };
    let mut matches = 0;
    for tag in tags {
        let Some(parts) = tag.as_array() else {
            continue;
        };
        if parts.first().and_then(Value::as_str) != Some(name) {
            continue;
        }
        matches += 1;
        if parts.len() != 2 || parts.get(1).and_then(Value::as_str) != Some(value) {
            return false;
        }
    }
    matches == 1
}

fn event_string<'a>(event: &'a Value, key: &str, error: &str) -> Result<&'a str, CliError> {
    event
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other(error.to_string()))
}

fn number_is_one(value: Option<&Value>) -> Option<bool> {
    value.and_then(Value::as_f64).map(|number| number == 1.0)
}

fn invalid_remote_envelope(app_id: AppId) -> CliError {
    CliError::Other(format!(
        "the {app_id} app Canvas marker or schema is malformed or unsupported"
    ))
}

fn invalid_app_channel(channel: &AppChannel, reason: &str) -> CliError {
    CliError::Other(format!(
        "the {} app channel {} is invalid: {reason}",
        channel.app_id.as_str(),
        channel.channel_id
    ))
}

fn inaccessible_app_channel(channel: &AppChannel) -> CliError {
    CliError::NotFound(format!(
        "no accessible private {} app channel for this identity and business channel",
        channel.app_id.as_str()
    ))
}

fn app_not_found(business_channel_id: &str, app_id: AppId) -> CliError {
    CliError::NotFound(format!(
        "no accessible private {} app channel for business channel {business_channel_id}",
        app_id.as_str()
    ))
}

fn write_json(out: &mut dyn Write, value: &Value) -> Result<(), CliError> {
    serde_json::to_writer(&mut *out, value)
        .map_err(|error| CliError::Other(format!("could not serialize app response: {error}")))?;
    out.write_all(b"\n")
        .map_err(|error| CliError::Other(format!("could not write app response: {error}")))
}

#[cfg(test)]
mod tests;
