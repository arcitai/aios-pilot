pub(super) const BUSINESS_SOURCE_MAX_UTF16_UNITS: usize = 40_000;

/// Strip control characters while preserving Markdown line structure.
pub(super) fn strip_controls(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\r' | '\t'))
        .collect()
}

/// Fit source text into the business schema and identify every partial import.
pub(super) fn apply_source_limit(
    value: &str,
    already_partial: bool,
    notice: &str,
) -> (String, bool) {
    let exceeds_limit = value.encode_utf16().count() > BUSINESS_SOURCE_MAX_UTF16_UNITS;
    if !already_partial && !exceeds_limit {
        return (value.to_string(), false);
    }

    let notice = truncate_utf16(&format!("\n\n{notice}"), BUSINESS_SOURCE_MAX_UTF16_UNITS);
    let notice_units = notice.encode_utf16().count();
    let text_budget = BUSINESS_SOURCE_MAX_UTF16_UNITS - notice_units;
    let mut content = String::new();
    let mut used_units = 0;
    for character in value.chars() {
        let units = character.len_utf16();
        if used_units + units > text_budget {
            break;
        }
        content.push(character);
        used_units += units;
    }
    content.push_str(&notice);
    (content, true)
}

fn truncate_utf16(value: &str, max_units: usize) -> String {
    let mut result = String::new();
    let mut used_units = 0;
    for character in value.chars() {
        let units = character.len_utf16();
        if used_units + units > max_units {
            break;
        }
        result.push(character);
        used_units += units;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{apply_source_limit, BUSINESS_SOURCE_MAX_UTF16_UNITS};

    #[test]
    fn source_limit_counts_utf16_units_without_splitting_surrogate_pairs() {
        let content = "🧭".repeat(BUSINESS_SOURCE_MAX_UTF16_UNITS / 2 + 2);
        let (limited, truncated) = apply_source_limit(&content, false, "[truncated by Buzz]");
        assert!(truncated);
        assert!(limited.encode_utf16().count() <= BUSINESS_SOURCE_MAX_UTF16_UNITS);
        assert!(limited.ends_with("[truncated by Buzz]"));
        assert!(!limited.contains('\u{fffd}'));
    }

    #[test]
    fn partial_imports_are_marked_even_when_text_fits() {
        let (limited, truncated) =
            apply_source_limit("short text", true, "[some blocks were omitted]");
        assert!(truncated);
        assert!(limited.contains("[some blocks were omitted]"));
    }

    #[test]
    fn even_an_unusually_long_notice_respects_the_schema_limit() {
        let (limited, truncated) = apply_source_limit("short", true, &"x".repeat(50_000));
        assert!(truncated);
        assert_eq!(
            limited.encode_utf16().count(),
            BUSINESS_SOURCE_MAX_UTF16_UNITS
        );
    }
}
