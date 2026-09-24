//! Agent-facing selective reads; authorization and revisions come from the live relay.

use buzz_business::retrieval::{KnowledgeError, KnowledgeLookup};
use serde::Serialize;
use serde_json::{json, Value};

use super::{check_expected_revision, load_document, BuzzClient, CliError};

pub(super) async fn index(
    client: &BuzzClient,
    channel: &str,
    offset: usize,
    limit: usize,
    expected_revision: Option<&str>,
) -> Result<Value, CliError> {
    require_page_revision(offset, expected_revision)?;
    let (workspace, snapshot, document) = load_document(client, channel, true).await?;
    check_expected_revision(&snapshot, expected_revision)?;
    let page = KnowledgeLookup::new(&document)
        .map_err(lookup_error)?
        .index(offset, limit)
        .map_err(lookup_error)?;
    response(&workspace.id, &snapshot.revision, page)
}

pub(super) async fn read(
    client: &BuzzClient,
    channel: &str,
    entry: &str,
    offset: usize,
    limit: usize,
    expected_revision: Option<&str>,
) -> Result<Value, CliError> {
    require_page_revision(offset, expected_revision)?;
    let (workspace, snapshot, document) = load_document(client, channel, true).await?;
    check_expected_revision(&snapshot, expected_revision)?;
    let page = KnowledgeLookup::new(&document)
        .map_err(lookup_error)?
        .read(entry, offset, limit)
        .map_err(lookup_error)?;
    response(&workspace.id, &snapshot.revision, page)
}

pub(super) async fn search(
    client: &BuzzClient,
    channel: &str,
    query: &str,
    limit: usize,
) -> Result<Value, CliError> {
    let (workspace, snapshot, document) = load_document(client, channel, true).await?;
    let results = KnowledgeLookup::new(&document)
        .map_err(lookup_error)?
        .search(query, limit)
        .map_err(lookup_error)?;
    response(&workspace.id, &snapshot.revision, results)
}

fn response(context_id: &str, revision: &str, result: impl Serialize) -> Result<Value, CliError> {
    let result = serde_json::to_value(result)
        .map_err(|error| CliError::Other(format!("could not encode knowledge result: {error}")))?;
    Ok(json!({ "context_id": context_id, "revision": revision, "result": result }))
}

fn require_page_revision(offset: usize, revision: Option<&str>) -> Result<(), CliError> {
    if offset > 0 && revision.is_none() {
        return Err(CliError::Usage(
            "continuing a page requires --expected-revision from the previous result".into(),
        ));
    }
    Ok(())
}

fn lookup_error(error: KnowledgeError) -> CliError {
    match error {
        KnowledgeError::Input(message) => CliError::Usage(message),
        KnowledgeError::NotFound(id) => {
            CliError::NotFound(format!("knowledge entry {id} is not in this revision"))
        }
        other => CliError::Other(other.to_string()),
    }
}
