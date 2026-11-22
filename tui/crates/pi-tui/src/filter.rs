//! One matcher for every list the client owns.
//!
//! pi uses two mechanisms and the client mirrors both (ticket 05 D5 / ticket 07 D5 of
//! `.scratch/tui-rust-v2/map.md`): **`startsWith`** on the item's value for a plain select list
//! (`pi/packages/tui/src/components/select-list.ts:62-67`) and **fuzzy** matching for the model
//! selector (`pi/packages/coding-agent/src/modes/interactive/components/model-selector.ts:9`).
//!
//! `score` answers `None` for "no match" and a number where a higher value sorts first, so a caller
//! filters and ranks in one pass.

/// Which matching rule a list uses.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// The item starts with the needle, case-insensitively. pi's `SelectList` rule.
    Prefix,
    /// Every needle character appears in order, case-insensitively, scored by how tightly.
    Fuzzy,
}

/// Score `haystack` against `needle`. `None` means no match.
pub fn score(mode: Mode, needle: &str, haystack: &str) -> Option<i32> {
    if needle.is_empty() {
        return Some(0);
    }
    match mode {
        Mode::Prefix => haystack.to_lowercase().starts_with(&needle.to_lowercase()).then_some(0),
        Mode::Fuzzy => fuzzy(needle, haystack),
    }
}

/// Each matched character scores 1, plus 2 when it follows the previous match directly and 3 when it
/// starts a word. Ties prefer the shorter haystack, so `model` sorts above `models/api`.
fn fuzzy(needle: &str, haystack: &str) -> Option<i32> {
    let mut wanted = needle.chars().map(lower).peekable();
    let mut score: i32 = 0;
    let mut previous: Option<usize> = None;
    let mut previous_char: Option<char> = None;
    for (index, ch) in haystack.chars().enumerate() {
        if wanted.peek().is_none() {
            break;
        }
        let want = *wanted.peek()?;
        if lower(ch) == want {
            wanted.next();
            let mut bonus = 1;
            if previous == Some(index.wrapping_sub(1)) {
                bonus += 2;
            }
            if previous_char.is_none_or(|c| !c.is_alphanumeric()) {
                bonus += 3;
            }
            score += bonus;
            previous = Some(index);
        }
        previous_char = Some(ch);
    }
    if wanted.peek().is_some() {
        return None;
    }
    Some(score * 1_000 - haystack.chars().count() as i32)
}

/// Lowercase one character. A character whose lowercase is several characters (rare) keeps its first,
/// which is enough to compare two needles against two haystacks consistently.
fn lower(ch: char) -> char {
    ch.to_lowercase().next().unwrap_or(ch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_matches_only_a_leading_substring() {
        assert!(score(Mode::Prefix, "mo", "model").is_some());
        assert!(score(Mode::Prefix, "MO", "model").is_some(), "the needle is case-insensitive");
        assert!(score(Mode::Prefix, "del", "model").is_none());
        assert!(score(Mode::Prefix, "", "model").is_some(), "an empty needle matches everything");
    }

    #[test]
    fn fuzzy_ranks_a_contiguous_run_above_a_braided_one() {
        let tight = score(Mode::Fuzzy, "abcd", "xabcdx").expect("contiguous");
        let loose = score(Mode::Fuzzy, "abcd", "xaxbxcxd").expect("braided");
        assert!(tight > loose, "contiguous {tight} should beat braided {loose}");
    }

    #[test]
    fn fuzzy_refuses_a_character_that_never_appears() {
        assert!(score(Mode::Fuzzy, "mo", "compact").is_none(), "no `o` after the `m`");
        assert!(score(Mode::Fuzzy, "src", "src/markdown.rs").is_some());
    }

    #[test]
    fn fuzzy_prefers_a_word_start_over_a_mid_word_hit() {
        let word_start = score(Mode::Fuzzy, "md", "src/markdown.rs").expect("m…d");
        let mid_word = score(Mode::Fuzzy, "md", "src/amidships.txt").expect("m…d");
        assert!(word_start > mid_word, "word start {word_start} should beat mid-word {mid_word}");
    }
}
