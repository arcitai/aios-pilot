//! Selective reads of an already-authorized Business snapshot.
//!
//! The caller must obtain the current document under the requesting identity's
//! grant and attach its context ID and revision to the response. This module
//! performs no I/O, caches no documents and cannot authorize a read.

use serde::Serialize;
use thiserror::Error;

use crate::{BusinessDocument, BusinessDocumentError, BusinessSource, SourceKind};

/// Maximum index entries or search hits returned by one lookup.
pub const MAX_LOOKUP_RESULTS: usize = 20;
/// Maximum Unicode characters returned by one selected-entry read.
pub const MAX_READ_CHARACTERS: usize = 4_000;
/// Maximum Unicode characters in a search excerpt.
pub const MAX_EXCERPT_CHARACTERS: usize = 300;

/// A reference to company knowledge without its text body.
#[derive(Debug, Clone, Serialize)]
pub struct KnowledgeEntry {
    /// Stable lookup key, `company:<field>` or `source:<source ID>`.
    pub id: String,
    /// Human-readable company field or source title.
    pub title: String,
    /// Size of the selected text in Unicode characters, not bytes.
    pub characters: usize,
    /// Source medium; absent for directly maintained company fields.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_kind: Option<SourceKind>,
    /// Original source location when recorded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Recorded source creation time, not a claim of last synchronization.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// One bounded page of entry references; source bodies are deliberately absent.
#[derive(Debug, Serialize)]
pub struct KnowledgeIndex {
    /// Entries in document order, with company fields first.
    pub entries: Vec<KnowledgeEntry>,
    /// Number of entries in this snapshot.
    pub total: usize,
    /// Continue with this entry offset using the same document revision.
    pub next_offset: Option<usize>,
}

/// Selected text plus the information needed to continue or cite it.
#[derive(Debug, Serialize)]
pub struct KnowledgeRead {
    /// Entry identity and provenance.
    pub entry: KnowledgeEntry,
    /// Unicode character offset within the original text.
    pub offset: usize,
    /// Bounded text from the requested entry only.
    pub text: String,
    /// Continue with this character offset using the same document revision.
    pub next_offset: Option<usize>,
}

/// A lexical match with a bounded excerpt; it is not a semantic ranking claim.
#[derive(Debug, Serialize)]
pub struct KnowledgeHit {
    /// Entry identity and provenance.
    pub entry: KnowledgeEntry,
    /// Unicode character offset of the excerpt in the original source.
    pub offset: usize,
    /// True when terms matched only the title; the excerpt is then the opening text.
    pub title_only: bool,
    /// Original source text, retaining casing and Unicode; not necessarily a body match.
    pub excerpt: String,
}

/// Bounded lookup result with an explicit indication of further matches.
#[derive(Debug, Serialize)]
pub struct KnowledgeSearch {
    /// Matching entries in document order.
    pub hits: Vec<KnowledgeHit>,
    /// Total entries matching every query term in this snapshot.
    pub total: usize,
}

/// Invalid input is distinguishable from a valid search with no matches.
#[derive(Debug, Error)]
pub enum KnowledgeError {
    /// The source document is not a valid bounded Business document.
    #[error(transparent)]
    Document(#[from] BusinessDocumentError),
    /// The lookup parameters cannot be used safely or unambiguously.
    #[error("invalid knowledge lookup: {0}")]
    Input(String),
    /// The requested entry is absent from this snapshot.
    #[error("knowledge entry does not exist in this revision: {0}")]
    NotFound(String),
}

struct EntryView<'a> {
    id: String,
    title: &'a str,
    text: &'a str,
    source: Option<&'a BusinessSource>,
}

impl EntryView<'_> {
    fn metadata(&self) -> KnowledgeEntry {
        KnowledgeEntry {
            id: self.id.clone(),
            title: self.title.to_string(),
            characters: self.text.chars().count(),
            source_kind: self.source.map(|source| source.kind),
            url: self.source.and_then(|source| source.url.clone()),
            created_at: self.source.map(|source| source.created_at.clone()),
        }
    }
}

/// Lookup over a validated, borrowed snapshot. Grants belong to the caller.
pub struct KnowledgeLookup<'a> {
    document: &'a BusinessDocument,
}

impl<'a> KnowledgeLookup<'a> {
    /// Validate document bounds before any iteration or result construction.
    pub fn new(document: &'a BusinessDocument) -> Result<Self, KnowledgeError> {
        document.validate()?;
        Ok(Self { document })
    }

    /// List references without loading source bodies into the agent response.
    pub fn index(&self, offset: usize, limit: usize) -> Result<KnowledgeIndex, KnowledgeError> {
        check_limit(limit, MAX_LOOKUP_RESULTS)?;
        let views = self.entries();
        check_offset(offset, views.len())?;
        let entries: Vec<_> = views
            .iter()
            .skip(offset)
            .take(limit)
            .map(EntryView::metadata)
            .collect();
        let end = offset + entries.len();
        Ok(KnowledgeIndex {
            entries,
            total: views.len(),
            next_offset: (end < views.len()).then_some(end),
        })
    }

    /// Read part of exactly one entry. Offsets are Unicode characters, not bytes.
    pub fn read(
        &self,
        id: &str,
        offset: usize,
        limit: usize,
    ) -> Result<KnowledgeRead, KnowledgeError> {
        check_limit(limit, MAX_READ_CHARACTERS)?;
        if id.len() > 600 {
            return Err(KnowledgeError::Input("entry ID is too long".into()));
        }
        let entry = self
            .entries()
            .into_iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| KnowledgeError::NotFound(id.to_string()))?;
        let metadata = entry.metadata();
        check_offset(offset, metadata.characters)?;
        let text: String = entry.text.chars().skip(offset).take(limit).collect();
        let end = offset + text.chars().count();
        Ok(KnowledgeRead {
            next_offset: (end < metadata.characters).then_some(end),
            entry: metadata,
            offset,
            text,
        })
    }

    /// Match all whitespace-separated terms case-insensitively in title and text.
    /// Punctuation remains literal; no query syntax or regular expressions run.
    pub fn search(&self, query: &str, limit: usize) -> Result<KnowledgeSearch, KnowledgeError> {
        check_limit(limit, MAX_LOOKUP_RESULTS)?;
        if query.chars().count() > 256 {
            return Err(KnowledgeError::Input("query exceeds 256 characters".into()));
        }
        let folded = query.to_lowercase();
        let mut terms: Vec<_> = folded.split_whitespace().collect();
        terms.sort_unstable();
        terms.dedup();
        if terms.is_empty() || terms.len() > 8 {
            return Err(KnowledgeError::Input(
                "use between 1 and 8 search terms".into(),
            ));
        }
        let mut hits = Vec::new();
        let mut total = 0;
        for entry in self.entries() {
            let title = entry.title.to_lowercase();
            let text = entry.text.to_lowercase();
            if !terms
                .iter()
                .all(|term| title.contains(*term) || text.contains(*term))
            {
                continue;
            }
            total += 1;
            if hits.len() == limit {
                continue;
            }
            let first_match = terms.iter().filter_map(|term| text.find(*term)).min();
            // Lowercasing can expand a Unicode character. Map folded byte offset
            // back to original character offset before slicing the original text.
            let position = first_match.map_or(0, |byte| original_position(entry.text, byte));
            let offset = position.saturating_sub(60);
            let excerpt = entry
                .text
                .chars()
                .skip(offset)
                .take(MAX_EXCERPT_CHARACTERS)
                .collect();
            hits.push(KnowledgeHit {
                entry: entry.metadata(),
                offset,
                title_only: first_match.is_none(),
                excerpt,
            });
        }
        Ok(KnowledgeSearch { hits, total })
    }

    fn entries(&self) -> Vec<EntryView<'a>> {
        let company = &self.document.company;
        let mut entries: Vec<_> = [
            ("name", "Company name", company.name.as_str()),
            ("website", "Website", company.website.as_str()),
            ("summary", "What we do", company.summary.as_str()),
            ("audience", "Who we help", company.audience.as_str()),
            ("offers", "Our offers", company.offers.as_str()),
            ("goals", "Our priorities", company.goals.as_str()),
        ]
        .into_iter()
        .map(|(id, title, text)| EntryView {
            id: format!("company:{id}"),
            title,
            text,
            source: None,
        })
        .collect();
        entries.extend(self.document.sources.iter().map(|source| EntryView {
            id: format!("source:{}", source.id),
            title: &source.title,
            text: &source.content,
            source: Some(source),
        }));
        entries
    }
}

fn original_position(text: &str, folded_byte: usize) -> usize {
    let mut bytes = 0;
    for (position, character) in text.chars().enumerate() {
        bytes += character.to_lowercase().map(char::len_utf8).sum::<usize>();
        if bytes > folded_byte {
            return position;
        }
    }
    text.chars().count()
}

fn check_limit(limit: usize, maximum: usize) -> Result<(), KnowledgeError> {
    if limit == 0 || limit > maximum {
        return Err(KnowledgeError::Input(format!(
            "limit must be between 1 and {maximum}"
        )));
    }
    Ok(())
}

fn check_offset(offset: usize, total: usize) -> Result<(), KnowledgeError> {
    if offset > total {
        return Err(KnowledgeError::Input(
            "offset is beyond the end of this revision".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "retrieval_tests.rs"]
mod tests;
