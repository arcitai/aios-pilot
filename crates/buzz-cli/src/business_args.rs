//! Arguments for Business context and selective knowledge lookup.

use clap::Subcommand;

/// Commands for the dedicated private AIOS business workspace.
#[derive(Subcommand)]
pub enum BusinessCmd {
    /// Discover accessible Business references without reading document bodies
    Discover,
    /// Register an existing private Business context as this host's canonical context
    Adopt {
        /// Existing private Business context UUID; its history and ACL are preserved
        #[arg(long)]
        channel: String,
    },
    /// List company fields and source references without their text bodies
    Index {
        /// Explicit context UUID returned by business discover or init
        #[arg(long)]
        channel: String,
        /// Entry offset returned by the previous page
        #[arg(long, default_value_t = 0)]
        offset: usize,
        /// Maximum entries, between 1 and 20
        #[arg(long, default_value_t = 10)]
        limit: usize,
        /// Require the same snapshot when continuing a page
        #[arg(long)]
        expected_revision: Option<String>,
    },
    /// Search company fields and sources, returning bounded lexical excerpts
    Search {
        /// Explicit context UUID returned by business discover or init
        #[arg(long)]
        channel: String,
        /// Between one and eight literal search terms
        #[arg(long)]
        query: String,
        /// Maximum matches, between 1 and 20
        #[arg(long, default_value_t = 5)]
        limit: usize,
    },
    /// Read one selected company field or source with bounded character pagination
    Read {
        /// Explicit context UUID returned by business discover or init
        #[arg(long)]
        channel: String,
        /// Entry ID returned by business index or search
        #[arg(long)]
        entry: String,
        /// Unicode character offset returned by the previous page
        #[arg(long, default_value_t = 0)]
        offset: usize,
        /// Maximum Unicode characters, between 1 and 4000
        #[arg(long, default_value_t = 2000)]
        limit: usize,
        /// Require the same snapshot when continuing a page
        #[arg(long)]
        expected_revision: Option<String>,
    },
    /// Create the private business workspace and its initial document if absent
    Init {
        /// Company name for a newly initialized document
        #[arg(long)]
        name: String,
        /// Company website
        #[arg(long, default_value = "")]
        website: String,
        /// Short company summary
        #[arg(long, default_value = "")]
        summary: String,
        /// Intended audience
        #[arg(long, default_value = "")]
        audience: String,
        /// Initial offer (repeat the flag for multiple offers)
        #[arg(long = "offer")]
        offers: Vec<String>,
        /// Initial goal (repeat the flag for multiple goals)
        #[arg(long = "goal")]
        goals: Vec<String>,
    },
    /// Show the current business document and its channel/revision identifiers
    Show {
        /// Business workspace channel UUID returned by `business init`
        #[arg(long)]
        channel: String,
    },
    /// Replace the current document from a validated JSON file (use '-' for stdin)
    Update {
        /// Business workspace channel UUID returned by `business init`
        #[arg(long)]
        channel: String,
        /// Input path, or '-' to read from stdin
        #[arg(long)]
        file: String,
        /// Revision returned by `business show`; fail if the canvas has moved
        #[arg(long)]
        expected_revision: Option<String>,
    },
    /// Import a validated JSON document; equivalent to `business update`
    Import {
        /// Business workspace channel UUID returned by `business init`
        #[arg(long)]
        channel: String,
        /// Input path, or '-' to read from stdin
        #[arg(long)]
        file: String,
        /// Revision returned by `business show`; fail if the canvas has moved
        #[arg(long)]
        expected_revision: Option<String>,
    },
    /// Export the document as compact desktop-compatible JSON
    Export {
        /// Business workspace channel UUID returned by `business init`
        #[arg(long)]
        channel: String,
        /// Write to this path instead of stdout
        #[arg(long)]
        output: Option<String>,
    },
    /// List, add, or remove source provenance records
    #[command(subcommand)]
    Source(BusinessSourceCmd),
}

/// Source operations on the current business workspace document.
#[derive(Subcommand)]
pub enum BusinessSourceCmd {
    /// List sources in the current document
    List {
        /// Business workspace channel UUID returned by `business init`
        #[arg(long)]
        channel: String,
    },
    /// Add a source with a generated ID and current ISO-8601 timestamp
    Add {
        /// Business workspace channel UUID returned by `business init`
        #[arg(long)]
        channel: String,
        /// Source title
        #[arg(long)]
        title: String,
        /// Source kind
        #[arg(long, value_enum)]
        kind: BusinessSourceKind,
        /// Source text, or '-' to read from stdin
        #[arg(long)]
        content: String,
        /// Optional absolute HTTP or HTTPS source URL
        #[arg(long)]
        url: Option<String>,
        /// Revision returned by `business show`; fail if the canvas has moved
        #[arg(long)]
        expected_revision: Option<String>,
    },
    /// Remove a source by its ID
    Remove {
        /// Business workspace channel UUID returned by `business init`
        #[arg(long)]
        channel: String,
        /// Source ID
        #[arg(long)]
        id: String,
        /// Revision returned by `business show`; fail if the canvas has moved
        #[arg(long)]
        expected_revision: Option<String>,
    },
}

/// Source media values accepted by `buzz business source add`.
#[derive(Clone, Copy, clap::ValueEnum)]
pub enum BusinessSourceKind {
    /// A manually supplied note.
    Note,
    /// A web page.
    Url,
    /// A file.
    File,
}
