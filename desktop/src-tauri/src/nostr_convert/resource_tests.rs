use super::*;

#[test]
fn channel_resource_metadata_survives_list_and_detail_conversion() {
    for resource in [None, Some("aios.business-context:v1"), Some("future:v2")] {
        let mut tags = vec![vec!["d", "context-id"], vec!["private"]];
        if let Some(resource) = resource {
            tags.push(vec!["resource", resource]);
        }
        let event = ev(39000, "", tags);
        assert_eq!(
            channel_info_from_event(&event, None, Some(true))
                .unwrap()
                .resource_type
                .as_deref(),
            resource
        );
        assert_eq!(
            channel_detail_from_event(&event)
                .unwrap()
                .resource_type
                .as_deref(),
            resource
        );
    }
}

#[test]
fn malformed_or_duplicate_resource_tags_never_become_legacy_metadata() {
    for resource_tags in [
        vec![vec!["resource"]],
        vec![vec!["resource", ""]],
        vec![vec!["resource", "aios.business-context:v1", "extra"]],
        vec![
            vec!["resource", "aios.business-context:v1"],
            vec!["resource", "future:v2"],
        ],
    ] {
        let mut tags = vec![vec!["d", "context-id"], vec!["private"]];
        tags.extend(resource_tags);
        let event = ev(39000, "", tags);
        assert!(channel_info_from_event(&event, None, Some(true)).is_err());
        assert!(channel_detail_from_event(&event).is_err());
    }
}
