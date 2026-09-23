use super::source_text::strip_controls;

pub(super) fn valid_channel_id(value: &str) -> bool {
    (9..=32).contains(&value.len())
        && matches!(value.as_bytes().first().copied(), Some(b'C' | b'G'))
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

pub(super) fn valid_team_id(value: &str) -> bool {
    (8..=32).contains(&value.len())
        && value.starts_with('T')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

pub(super) fn safe_channel_name(value: &str) -> String {
    strip_controls(value).trim().chars().take(80).collect()
}

pub(super) fn safe_workspace_name(value: &str) -> String {
    strip_controls(value).trim().chars().take(120).collect()
}

pub(super) fn safe_message_text(value: &str) -> String {
    strip_controls(value)
}

pub(super) fn safe_timestamp(value: &str) -> bool {
    let Some((seconds, fractional)) = value.split_once('.') else {
        return false;
    };
    (1..=16).contains(&seconds.len())
        && (1..=9).contains(&fractional.len())
        && seconds.bytes().all(|byte| byte.is_ascii_digit())
        && fractional.bytes().all(|byte| byte.is_ascii_digit())
}

pub(super) fn channel_url(channel_id: &str, team_id: &str) -> Option<String> {
    (valid_channel_id(channel_id) && valid_team_id(team_id))
        .then(|| format!("https://slack.com/app_redirect?channel={channel_id}&team={team_id}"))
}

#[cfg(test)]
mod tests {
    use super::{
        channel_url, safe_channel_name, safe_timestamp, safe_workspace_name, valid_channel_id,
        valid_team_id,
    };

    #[test]
    fn validates_channel_and_workspace_identifiers_before_url_construction() {
        assert!(valid_channel_id("C12345678"));
        assert!(valid_channel_id("G12345678"));
        assert!(!valid_channel_id("D12345678"));
        assert!(!valid_channel_id("C1234567/slack.com"));
        assert_eq!(
            channel_url("C12345678", "T12345678").as_deref(),
            Some("https://slack.com/app_redirect?channel=C12345678&team=T12345678")
        );
        assert!(channel_url("C12345678?redirect=bad", "T12345678").is_none());
        assert!(channel_url("C12345678", "T123456").is_none());
        assert!(valid_team_id("T12345678"));
        assert!(!valid_team_id("C12345678"));
    }

    #[test]
    fn labels_and_timestamps_are_bounded_and_control_safe() {
        assert_eq!(safe_channel_name("  ops\u{0000}-north  "), "ops-north");
        assert_eq!(
            safe_workspace_name("Workspace\u{007f} One"),
            "Workspace One"
        );
        assert!(safe_timestamp("1723456789.000123"));
        assert!(!safe_timestamp("1723456789"));
        assert!(!safe_timestamp("x.000123"));
    }
}
