use nostr::{EventBuilder, EventId, Kind};

use super::{check_content, tag};

/// Kind 30620 — replaceable workflow definition.
///
/// The `d` tag carries the workflow id; `h` tag carries the channel id; the
/// content is the YAML definition. Same (pubkey, d) replaces the prior version.
pub fn build_workflow_definition(
    workflow_id: &str,
    channel_id: &str,
    yaml_definition: &str,
    expected_revision: Option<&str>,
) -> Result<EventBuilder, String> {
    check_content(yaml_definition)?;
    let mut tags = vec![tag(vec!["d", workflow_id])?, tag(vec!["h", channel_id])?];
    if let Some(revision) = expected_revision {
        EventId::from_hex(revision).map_err(|_| "invalid workflow revision".to_string())?;
        tags.push(tag(vec!["expected-revision", revision])?);
    }
    Ok(EventBuilder::new(Kind::Custom(30620), yaml_definition.to_string()).tags(tags))
}

/// Kind 5 — NIP-09 deletion targeting a kind:30620 workflow definition.
pub fn build_workflow_delete(
    workflow_id: &str,
    owner_pubkey_hex: &str,
) -> Result<EventBuilder, String> {
    let coord = format!("30620:{owner_pubkey_hex}:{workflow_id}");
    let tags = vec![tag(vec!["a", &coord])?];
    Ok(EventBuilder::new(Kind::Custom(5), "").tags(tags))
}

/// Kind 46020 — trigger a workflow run by id.
pub fn build_workflow_trigger(workflow_id: &str) -> Result<EventBuilder, String> {
    let tags = vec![tag(vec!["d", workflow_id])?];
    Ok(EventBuilder::new(Kind::Custom(46020), "").tags(tags))
}

fn validate_approval_ref(approval_ref: &str) -> Result<(), String> {
    if approval_ref.len() != 64 || !approval_ref.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err("invalid approval reference".to_string());
    }
    Ok(())
}

/// Kind 46030 — grant an approval by its stored SHA-256 reference.
pub fn build_approval_grant(
    approval_ref: &str,
    note: Option<&str>,
) -> Result<EventBuilder, String> {
    validate_approval_ref(approval_ref)?;
    let tags = vec![tag(vec!["d", approval_ref])?];
    Ok(EventBuilder::new(Kind::Custom(46030), note.unwrap_or("")).tags(tags))
}

/// Kind 46031 — deny an approval by its stored SHA-256 reference.
pub fn build_approval_deny(approval_ref: &str, note: Option<&str>) -> Result<EventBuilder, String> {
    validate_approval_ref(approval_ref)?;
    let tags = vec![tag(vec!["d", approval_ref])?];
    Ok(EventBuilder::new(Kind::Custom(46031), note.unwrap_or("")).tags(tags))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_commands_use_the_stored_hash_reference() {
        let keys = nostr::Keys::generate();
        let approval_ref = "ab".repeat(32);
        for builder in [
            build_approval_grant(&approval_ref, None).expect("grant builder"),
            build_approval_deny(&approval_ref, None).expect("deny builder"),
        ] {
            let event = builder
                .sign_with_keys(&keys)
                .expect("sign approval command");
            assert!(event.tags.iter().any(|tag| {
                let parts = tag.as_slice();
                parts.len() >= 2 && parts[0] == "d" && parts[1] == approval_ref
            }));
        }
    }

    #[test]
    fn approval_commands_reject_malformed_references() {
        assert!(build_approval_grant("abc", None).is_err());
        assert!(build_approval_deny(&"zz".repeat(32), None).is_err());
    }
}
