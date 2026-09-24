use super::*;

fn document() -> BusinessDocument {
    let mut document = BusinessDocument::new("Example Studio");
    document.company.summary = "We help small Danish teams.".into();
    document.sources = vec![BusinessSource {
        id: "source:with:colons".into(),
        title: "Brand guide".into(),
        kind: SourceKind::File,
        content: "SENTINEL_PRIVATE_BODY: Skriv klart på dansk. 🌿".into(),
        url: Some("https://example.test/brand".into()),
        created_at: "2026-09-24T09:00:00Z".into(),
    }];
    document
}

#[test]
fn index_contains_routes_and_provenance_but_no_company_or_source_bodies() {
    let document = document();
    let lookup = KnowledgeLookup::new(&document).unwrap();
    let index = lookup.index(0, 6).unwrap();
    assert_eq!(index.next_offset, Some(6));
    assert_eq!(index.total, 7);
    let serialized = serde_json::to_string(&index).unwrap();
    assert!(!serialized.contains("Danish teams"));
    let source_page = lookup.index(6, 20).unwrap();
    let serialized = serde_json::to_string(&source_page).unwrap();
    assert!(serialized.contains("source:source:with:colons"));
    assert!(serialized.contains("https://example.test/brand"));
    assert!(!serialized.contains("SENTINEL_PRIVATE_BODY"));
    assert_eq!(source_page.next_offset, None);
}

#[test]
fn selected_reads_are_bounded_reconstruct_unicode_and_keep_sources_separate() {
    let document = document();
    let lookup = KnowledgeLookup::new(&document).unwrap();
    let id = "source:source:with:colons";
    let mut output = String::new();
    let mut offset = 0;
    loop {
        let page = lookup.read(id, offset, 7).unwrap();
        assert!(page.text.chars().count() <= 7);
        assert_eq!(page.entry.id, id);
        output.push_str(&page.text);
        match page.next_offset {
            Some(next) => {
                assert!(next > offset);
                offset = next;
            }
            None => break,
        }
    }
    assert_eq!(output, document.sources[0].content);
    let summary = lookup
        .read("company:summary", 0, MAX_READ_CHARACTERS)
        .unwrap();
    assert_eq!(summary.text, document.company.summary);
    assert!(!summary.text.contains("SENTINEL_PRIVATE_BODY"));
    assert!(matches!(
        lookup.read("source:missing", 0, 10),
        Err(KnowledgeError::NotFound(_))
    ));
}

#[test]
fn search_is_literal_bounded_and_preserves_danish_and_expanding_unicode_case() {
    let mut document = document();
    document.sources[0].content = format!("{}İ dansk ØRESUND mål", "æ🌿".repeat(400));
    let lookup = KnowledgeLookup::new(&document).unwrap();
    let found = lookup.search("brand ØRESUND", 1).unwrap();
    assert_eq!(found.total, 1);
    let hit = &found.hits[0];
    assert!(!hit.title_only);
    assert!(hit.excerpt.contains("ØRESUND"));
    assert!(hit.excerpt.chars().count() <= MAX_EXCERPT_CHARACTERS);
    assert_eq!(
        hit.excerpt,
        document.sources[0]
            .content
            .chars()
            .skip(hit.offset)
            .take(MAX_EXCERPT_CHARACTERS)
            .collect::<String>()
    );
    let expanding = lookup.search("i\u{307}", 1).unwrap();
    assert!(expanding.hits[0].excerpt.contains('İ'));
    assert_eq!(lookup.search(".*", 2).unwrap().total, 0);
    assert_eq!(lookup.search("ØRESUND absent", 2).unwrap().total, 0);
    let title_match = lookup.search("brand guide", 1).unwrap();
    assert!(title_match.hits[0].title_only);
    assert_eq!(title_match.hits[0].offset, 0);
}

#[test]
fn invalid_inputs_and_oversized_documents_do_not_become_empty_successes() {
    let mut document = document();
    let lookup = KnowledgeLookup::new(&document).unwrap();
    for limit in [0, MAX_LOOKUP_RESULTS + 1, usize::MAX] {
        assert!(lookup.index(0, limit).is_err());
        assert!(lookup.search("brand", limit).is_err());
    }
    assert!(lookup.index(usize::MAX, 1).is_err());
    assert!(lookup.read("company:name", usize::MAX, 1).is_err());
    assert!(lookup
        .read("company:name", 0, MAX_READ_CHARACTERS + 1)
        .is_err());
    for query in [
        "".to_string(),
        " ".into(),
        "x".repeat(257),
        "a b c d e f g h i".into(),
    ] {
        assert!(lookup.search(&query, 1).is_err());
    }
    document.sources[0].content = "x".repeat(40_001);
    assert!(matches!(
        KnowledgeLookup::new(&document),
        Err(KnowledgeError::Document(_))
    ));
}
