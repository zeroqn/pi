//! Completion: file paths and slash-command names, computed locally.
//!
//! pi's autocomplete is a provider chain that runs in its process and shells out to `fd`
//! (`packages/tui/src/autocomplete.ts`, 858 lines). The client cannot call it without a new RPC method
//! (ruled out by Q14(i)), so ticket 07 decided the client implements the two cases that matter: paths
//! (`@`-free, delimited like pi's tokens) and slash names from the `get_commands` response it already
//! fetches. The popup costs one row and never blocks a frame.

use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Suggestion {
    /// What replaces the token when accepted (a path, or `/name`).
    pub insert: String,
    /// What the popup shows.
    pub label: String,
    /// The popup's right column: a command's description. Empty for a path.
    pub hint: Option<String>,
}

/// Cut a row to `width` cells with an ellipsis, so the popup never wraps.
fn truncate(row: &str, width: usize) -> String {
    if row.chars().count() <= width {
        return row.to_string();
    }
    let clipped: String = row.chars().take(width.saturating_sub(1)).collect();
    format!("{clipped}…")
}

#[derive(Default, Debug)]
pub struct Completions {
    pub items: Vec<Suggestion>,
    cursor: usize,
}

impl Completions {
    /// Empty means no popup; used by the key router and the tests.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn new(items: Vec<Suggestion>) -> Completions {
        Completions { items, cursor: 0 }
    }

    /// Reported by the probe, not the frame: the popup row already shows the count.
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn current(&self) -> Option<&Suggestion> {
        self.items.get(self.cursor)
    }

    pub fn next(&mut self) {
        if !self.items.is_empty() {
            self.cursor = (self.cursor + 1) % self.items.len();
        }
    }

    pub fn previous(&mut self) {
        if !self.items.is_empty() {
            self.cursor = (self.cursor + self.items.len() - 1) % self.items.len();
        }
    }

    /// The popup: up to `max` rows, the cursor's own row marked, and `(i/n)` when the list is clipped
    /// (ticket 09 D5/D6). It draws **above the composer**, taken from the transcript's rows, so the text
    /// being typed is never hidden.
    pub fn render_rows(&self, width: usize, max: usize) -> Vec<String> {
        if self.items.is_empty() {
            return Vec::new();
        }
        let max = max.max(1);
        let span = max.min(self.items.len());
        let start = self.cursor.saturating_sub(max / 2).min(self.items.len() - span);
        let end = start + span;
        let mut out: Vec<String> = Vec::new();
        let label_width = self
            .items
            .iter()
            .map(|item| item.label.chars().count())
            .max()
            .unwrap_or(0)
            .min(width.saturating_sub(12));
        for index in start..end {
            let item = &self.items[index];
            let marker = if index == self.cursor { ">" } else { " " };
            let mut row = format!(" {marker} {}", item.label);
            if let Some(hint) = &item.hint {
                row.push_str(&" ".repeat(label_width.saturating_sub(item.label.chars().count()) + 2));
                row.push_str(hint);
            }
            if index == self.cursor && self.items.len() > 1 {
                row.push_str(&format!(" ({}/{})", index + 1, self.items.len()));
            }
            out.push(truncate(&row, width));
        }
        out
    }
}

/// Delimiters that end a token, matching pi's `PATH_DELIMITERS` plus its separators.
const DELIMITERS: &[char] = &[' ', '\t', '"', '\'', '=', '(', ')', '[', ']', '{', '}', '<', '>', '`', ','];

/// The token being completed: everything after the last delimiter, up to the cursor.
pub fn token_before_cursor(line: &str, col: usize) -> &str {
    let head = &line[..col];
    let mut start = 0;
    for (index, ch) in head.char_indices() {
        if DELIMITERS.contains(&ch) {
            start = index + ch.len_utf8();
        }
    }
    &head[start..]
}

/// Slash commands, when the token is the first thing on the line.
pub fn slash(commands: &[String], token: &str, at_line_start: bool) -> Vec<Suggestion> {
    if !at_line_start || !token.starts_with('/') && !token.is_empty() {
        return Vec::new();
    }
    commands
        .iter()
        .filter(|name| name.starts_with(token) || token.is_empty())
        .map(|name| Suggestion { insert: name.clone(), label: name.clone(), hint: None })
        .take(20)
        .collect()
}

/// Path completion for a token: `~` expands, a trailing `/` lists a directory, and directories are
/// offered with their separator so a second Tab descends.
pub fn paths(token: &str, cwd: &Path) -> Vec<Suggestion> {
    if token.is_empty() || token.starts_with('-') {
        return Vec::new();
    }
    let expanded: PathBuf = if let Some(rest) = token.strip_prefix("~/") {
        match std::env::var("HOME") {
            Ok(home) => PathBuf::from(home).join(rest),
            Err(_) => return Vec::new(),
        }
    } else {
        cwd.join(token)
    };
    // The directory to list: the token's own directory when it ends with a separator, else its parent.
    let (dir, prefix) = if token.ends_with('/') {
        (expanded.clone(), String::new())
    } else {
        match (expanded.parent(), expanded.file_name()) {
            (Some(parent), Some(name)) => (parent.to_path_buf(), name.to_string_lossy().to_string()),
            _ => return Vec::new(),
        }
    };
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
    let typed_dir = if token.ends_with('/') {
        token.to_string()
    } else {
        match token.rfind('/') {
            Some(index) => token[..=index].to_string(),
            None => String::new(),
        }
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(&prefix) || name.starts_with('.') && !prefix.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        let insert = format!("{typed_dir}{name}{}", if is_dir { "/" } else { "" });
        let label = if is_dir { format!("{name}/") } else { name.clone() };
        out.push(Suggestion { insert, label, hint: None });
    }
    out.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    out.truncate(20);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_token_is_what_follows_the_last_delimiter() {
        assert_eq!(token_before_cursor("look at src/ma", 14), "src/ma");
        assert_eq!(token_before_cursor("(src/ma", 7), "src/ma");
        assert_eq!(token_before_cursor("plain", 5), "plain");
        assert_eq!(token_before_cursor("trailing ", 9), "");
    }

    #[test]
    fn slash_completion_only_fires_at_the_line_start() {
        let commands = vec!["/help".to_string(), "/model".to_string(), "/models".to_string()];
        let at_start = slash(&commands, "/mo", true);
        assert_eq!(at_start.len(), 2);
        assert!(slash(&commands, "/mo", false).is_empty());
        assert!(slash(&commands, "mo", true).is_empty());
    }

    #[test]
    fn path_completion_lists_a_directory_and_marks_directories() {
        let dir = std::env::temp_dir().join(format!("pi-tui-completion-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).expect("a dir");
        std::fs::write(dir.join("sub").join("subfile.txt"), "x").expect("a file");
        std::fs::write(dir.join("solo.txt"), "x").expect("a file");

        // A prefix inside the working directory.
        let items = paths("s", &dir);
        let labels: Vec<&str> = items.iter().map(|item| item.label.as_str()).collect();
        assert_eq!(labels, vec!["solo.txt", "sub/"], "only top-level entries match the prefix");

        // Descending into the directory keeps the typed prefix.
        let nested = paths("sub/", &dir);
        assert_eq!(nested.len(), 1);
        assert_eq!(nested[0].insert, "sub/subfile.txt");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_hidden_file_is_only_offered_when_the_prefix_is_dotted() {
        let dir = std::env::temp_dir().join(format!("pi-tui-completion-hidden-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a dir");
        std::fs::write(dir.join(".env"), "x").expect("a file");
        std::fs::write(dir.join("visible.txt"), "x").expect("a file");

        let plain = paths("", &dir);
        assert!(plain.is_empty(), "an empty token offers nothing");
        let undotted = paths("e", &dir);
        assert_eq!(undotted.len(), 0);
        let dotted = paths(".e", &dir);
        assert_eq!(dotted.len(), 1);
        assert_eq!(dotted[0].insert, ".env");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_popup_marks_the_cursor_and_shows_its_place() {
        let mut completions = Completions::new(vec![
            Suggestion { insert: "a".into(), label: "alpha".into(), hint: None },
            Suggestion { insert: "b".into(), label: "beta".into(), hint: Some("the second".into()) },
        ]);
        let rows = completions.render_rows(80, 5);
        assert_eq!(rows.len(), 2);
        assert!(rows[0].contains("alpha") && rows[0].starts_with(" >"), "the cursor row is marked: {rows:?}");
        assert!(rows[1].contains("beta") && rows[1].contains("the second"), "the hint is the right column");
        completions.next();
        let rows = completions.render_rows(80, 5);
        assert!(rows[1].starts_with(" > "), "the marker moves: {rows:?}");
        assert!(rows[1].contains("(2/2)"), "the count is on the cursor's row");
    }

    #[test]
    fn a_popup_longer_than_its_cap_scrolls_around_the_cursor() {
        let items: Vec<Suggestion> = (0..12)
            .map(|n| Suggestion { insert: format!("f{n}"), label: format!("file-{n}.rs"), hint: None })
            .collect();
        let mut completions = Completions::new(items);
        let rows = completions.render_rows(40, 5);
        assert_eq!(rows.len(), 5, "the cap bounds the popup");
        assert!(rows[0].contains("file-0"));
        for _ in 0..11 {
            completions.next();
        }
        let rows = completions.render_rows(40, 5);
        assert!(rows.last().unwrap().contains("file-11"), "the window follows the cursor: {rows:?}");
    }

    #[test]
    fn a_narrow_popup_truncates_rather_than_wrapping() {
        let completions = Completions::new(vec![Suggestion {
            insert: "x".into(),
            label: "a-very-long-suggestion-name".into(),
            hint: None,
        }]);
        let rows = completions.render_rows(8, 5);
        assert_eq!(rows.len(), 1);
        assert!(rows[0].chars().count() <= 8, "row is {} cells: {rows:?}", rows[0].chars().count());
        assert!(rows[0].ends_with('…'));
    }
}
