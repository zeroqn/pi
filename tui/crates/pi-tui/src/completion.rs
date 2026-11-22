//! Completion: file paths and slash-command names, computed locally.
//!
//! pi's autocomplete is a provider chain that runs in its process and shells out to `fd`
//! (`packages/tui/src/autocomplete.ts`, 858 lines). The client cannot call it without a new RPC method
//! (ruled out by Q14(i)), so ticket 07/09 of `.scratch/tui-rust-v2/map.md` decided the client implements
//! the two cases that matter: paths and slash names from the `get_commands` response it already fetches.
//!
//! **Paths come from `fd`** with pi's own arguments — `--hidden --exclude .git --type f --type d --follow
//! --max-results 100`, `--full-path` once the query holds a separator — with a depth-1 readdir as the
//! fallback, exactly pi's own (`autocomplete.ts:145-197`: "Use fd to walk directory tree (fast, respects
//! .gitignore)"). An `@` mention is **text**: RPC mode rejects `@file` prompt arguments
//! (`main.ts:703`, `docs/rpc.md:20`), so the client inserts the path and the agent's `read` does the rest.

use std::path::{Path, PathBuf};
use std::process::Command;

/// How many suggestions the popup can hold.
const MAX_RESULTS: usize = 100;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Suggestion {
    /// What replaces the token when accepted (a path, or `/name`).
    pub insert: String,
    /// What the popup shows.
    pub label: String,
    /// The popup's right column: a command's description. Empty for a path.
    pub hint: Option<String>,
}

/// The token under the cursor, and the wrapper its insertion needs (pi's `CompletionPrefix`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Prefix {
    /// The path text, without the `@` or the quotes.
    pub text: String,
    /// The token began with `@`: an `@`-mention.
    pub at: bool,
    /// The token was quoted (`@"path with spaces"`), so its insertion is quoted too.
    pub quoted: bool,
}

impl Prefix {
    /// The character count of the token as typed, so the composer can replace all of it.
    pub fn width(&self) -> usize {
        self.text.chars().count() + usize::from(self.at) + if self.quoted { 2 } else { 0 }
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_empty() && !self.at
    }
}

/// The token before the cursor and the wrapper it carries. A quoted token may hold spaces and may or may
/// not have its closing quote yet, so a second Tab can descend into `@"dir with space/`.
pub fn prefix_before_cursor(line: &str, col: usize) -> Prefix {
    let head: String = line.chars().take(col).collect();
    // A quoted token: the last `@"` with no quote after it (or one closing at the end).
    if let Some(start) = head.rfind("@\"") {
        let rest = &head[start + 2..];
        let text = match rest.find('"') {
            Some(end) => rest[..end].to_string(),
            None => rest.to_string(),
        };
        return Prefix { text, at: true, quoted: true };
    }
    let token = token_before_cursor(&head, head.chars().count());
    if let Some(rest) = token.strip_prefix('@') {
        return Prefix { text: rest.to_string(), at: true, quoted: false };
    }
    Prefix { text: token.to_string(), at: false, quoted: false }
}

/// Wrap a completed path for insertion, as pi's `buildCompletionValue` does: an `@` stays a mention, a
/// path with a space (or one that was quoted) gets quotes, and a directory keeps its separator.
pub fn insert_for(path: &str, is_directory: bool, prefix: &Prefix) -> String {
    let mut value = path.replace('\\', "/");
    if is_directory && !value.ends_with('/') {
        value.push('/');
    }
    let quoted = prefix.quoted || value.contains(' ');
    match (prefix.at, quoted) {
        (true, true) => format!("@\"{value}\""),
        (true, false) => format!("@{value}"),
        (false, true) => format!("\"{value}\""),
        (false, false) => value,
    }
}


/// The popup's state: the suggestions, the cursor, and the rows it draws.
#[derive(Default, Debug)]
pub struct Completions {
    pub items: Vec<Suggestion>,
    cursor: usize,
}

impl Completions {
    pub fn new(items: Vec<Suggestion>) -> Completions {
        Completions { items, cursor: 0 }
    }

    /// Empty means no popup; used by the key router and the tests.
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Reported by the probe, not the frame.
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

/// Cut a row to `width` cells with an ellipsis, so the popup never wraps.
fn truncate(row: &str, width: usize) -> String {
    if row.chars().count() <= width {
        return row.to_string();
    }
    let clipped: String = row.chars().take(width.saturating_sub(1)).collect();
    format!("{clipped}…")
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

/// Path completion for a token: `fd` first, with pi's arguments, then a depth-1 readdir.
pub fn paths(prefix: &Prefix, cwd: &Path) -> Vec<Suggestion> {
    let query = prefix.text.clone();
    // An empty token is not a path: a bare `@` is, and lists everything (ticket 09 D3).
    if query.is_empty() && !prefix.at {
        return Vec::new();
    }
    if query.starts_with('-') {
        return Vec::new();
    }
    let mut out = match fd_paths(&query, cwd) {
        Some(items) => items,
        None => readdir_paths(&query, cwd),
    };
    for item in &mut out {
        // The popup shows the path; the insertion carries the `@` and the quotes its token needs.
        let path = item.insert.trim_end_matches('/');
        let is_dir = item.insert.ends_with('/');
        item.insert = insert_for(path, is_dir, prefix);
    }
    out.sort_by(|a, b| rank(&query, &a.label).cmp(&rank(&query, &b.label)).then(a.label.cmp(&b.label)));
    out.truncate(MAX_RESULTS);
    out
}

/// How well a suggestion matches: a prefix match first, then the shorter label, then alphabetical.
fn rank(query: &str, label: &str) -> (u8, usize) {
    let needle = query.rsplit('/').next().unwrap_or(query).to_lowercase();
    // The row is read by its last segment: `src/monitor.rs` matches `mo` the way `monitor.rs` does.
    let hay = label.trim_end_matches('/').rsplit('/').next().unwrap_or(label).to_lowercase();
    let tier = if needle.is_empty() || hay.starts_with(&needle) { 0 } else { 1 };
    (tier, label.chars().count())
}

/// `fd` with pi's own arguments (`autocomplete.ts:145-197`). `None` when `fd` is not installed, so the
/// caller can fall back to a readdir.
fn fd_paths(query: &str, cwd: &Path) -> Option<Vec<Suggestion>> {
    let base = cwd.to_string_lossy().to_string();
    let mut args: Vec<&str> = vec![
        "--base-directory", &base,
        "--max-results", "100",
        "--type", "f",
        "--type", "d",
        "--follow",
        "--hidden",
        "--exclude", ".git",
        "--exclude", ".git/*",
        "--exclude", ".git/**",
    ];
    let normalized = query.replace('\\', "/");
    let full_path = normalized.contains('/');
    if full_path {
        args.push("--full-path");
    }
    let pattern = if normalized.is_empty() {
        String::new()
    } else if full_path {
        // pi turns a slash-bearing query into a segment regex with either separator (`buildFdPathQuery`).
        let trailing = normalized.ends_with('/');
        let trimmed = normalized.trim_matches('/');
        let segments: Vec<String> = trimmed.split('/').filter(|s| !s.is_empty()).map(escape_regex).collect();
        let mut joined = segments.join("[\\\\/]");
        if trailing {
            joined.push_str("[\\\\/]");
        }
        joined
    } else {
        escape_regex(&normalized)
    };
    if !pattern.is_empty() {
        args.push(&pattern);
    }
    let output = Command::new("fd").args(&args).output().ok()?;
    if !output.status.success() {
        // fd exits non-zero when nothing matched, which is not an error worth a readdir retry.
        return Some(Vec::new());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut items = Vec::new();
    for line in text.lines() {
        let path = line.trim();
        if path.is_empty() {
            continue;
        }
        let is_dir = cwd.join(path).is_dir();
        let label = if is_dir { format!("{path}/") } else { path.to_string() };
        items.push(Suggestion { insert: format!("{path}{}", if is_dir { "/" } else { "" }), label, hint: None });
    }
    Some(items)
}

/// A plain readdir of the token's directory: pi's own fallback, and what the client used before `fd`.
fn readdir_paths(query: &str, cwd: &Path) -> Vec<Suggestion> {
    let expanded: PathBuf = if let Some(rest) = query.strip_prefix("~/") {
        match std::env::var("HOME") {
            Ok(home) => PathBuf::from(home).join(rest),
            Err(_) => return Vec::new(),
        }
    } else {
        cwd.join(query)
    };
    let (dir, prefix) = if query.ends_with('/') {
        (expanded.clone(), String::new())
    } else {
        match (expanded.parent(), expanded.file_name()) {
            (Some(parent), Some(name)) => (parent.to_path_buf(), name.to_string_lossy().to_string()),
            _ => return Vec::new(),
        }
    };
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
    let typed_dir = if query.ends_with('/') {
        query.to_string()
    } else {
        match query.rfind('/') {
            Some(index) => query[..=index].to_string(),
            None => String::new(),
        }
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(&prefix) || (name.starts_with('.') && !prefix.starts_with('.')) {
            continue;
        }
        let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        let insert = format!("{typed_dir}{name}{}", if is_dir { "/" } else { "" });
        let label = if is_dir { format!("{name}/") } else { name.clone() };
        out.push(Suggestion { insert, label, hint: None });
    }
    out.sort_by(|a, b| rank(query, &a.label).cmp(&rank(query, &b.label)).then(a.label.cmp(&b.label)));
    out
}

/// Escape a string for fd's regex dialect.
fn escape_regex(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        if "\\.*+?()[]{}|^$".contains(ch) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain(text: &str) -> Prefix {
        Prefix { text: text.to_string(), at: false, quoted: false }
    }

    #[test]
    fn the_token_is_what_follows_the_last_delimiter() {
        assert_eq!(token_before_cursor("look at src/ma", 14), "src/ma");
        assert_eq!(token_before_cursor("(src/ma", 7), "src/ma");
        assert_eq!(token_before_cursor("plain", 5), "plain");
        assert_eq!(token_before_cursor("trailing ", 9), "");
    }

    #[test]
    fn an_at_mention_is_a_prefix_wrapper_not_a_path_character() {
        let prefix = prefix_before_cursor("open @src/ma", 12);
        assert_eq!(prefix.text, "src/ma");
        assert!(prefix.at);
        assert!(!prefix.quoted);
        assert_eq!(prefix.width(), 7, "`@src/ma` is six characters plus the `@`");
    }

    #[test]
    fn a_quoted_mention_keeps_its_spaces_and_works_without_the_closing_quote() {
        // Closed: the path is what sits between the quotes.
        let closed = prefix_before_cursor("open @\"docs/my file", 19);
        assert_eq!(closed.text, "docs/my file", "spaces are part of a quoted token");
        assert!(closed.at && closed.quoted);
        let opened = prefix_before_cursor("open @\"docs/my fi", 18);
        assert_eq!(opened.text, "docs/my fi");
    }

    #[test]
    fn insertion_wraps_a_path_the_way_its_token_was_written() {
        let plain_token = plain("src/mo");
        assert_eq!(insert_for("src/model.rs", false, &plain_token), "src/model.rs");
        assert_eq!(insert_for("src", true, &plain_token), "src/");
        let at = Prefix { text: "src/mo".into(), at: true, quoted: false };
        assert_eq!(insert_for("src/model.rs", false, &at), "@src/model.rs");
        let quoted = Prefix { text: "my fi".into(), at: true, quoted: true };
        assert_eq!(insert_for("my file.txt", false, &quoted), "@\"my file.txt\"");
        // A path with a space gets quotes even from an unquoted token, as pi does.
        let at_plain = Prefix { text: "my".into(), at: true, quoted: false };
        assert_eq!(insert_for("my file.txt", false, &at_plain), "@\"my file.txt\"");
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
    fn the_readdir_fallback_lists_a_directory_and_marks_directories() {
        let dir = std::env::temp_dir().join(format!("pi-tui-completion-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).expect("a dir");
        std::fs::write(dir.join("sub").join("subfile.txt"), "x").expect("a file");
        std::fs::write(dir.join("solo.txt"), "x").expect("a file");

        let items = readdir_paths("s", &dir);
        let labels: Vec<&str> = items.iter().map(|item| item.label.as_str()).collect();
        assert_eq!(labels, vec!["sub/", "solo.txt"], "only top-level entries, ranked then alphabetical");

        let nested = readdir_paths("sub/", &dir);
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

        // The rule belongs to the readdir fallback: `fd` matches a substring anywhere, as pi's does.
        assert!(paths(&plain(""), &dir).is_empty(), "an empty token offers nothing");
        assert!(readdir_paths("e", &dir).is_empty(), "an undotted prefix never sees a hidden file");
        let dotted = paths(&plain(".e"), &dir);
        assert_eq!(dotted.len(), 1);
        assert_eq!(dotted[0].insert, ".env");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fd_results_are_ranked_by_prefix_then_by_length() {
        // The ranking is applied to whatever engine answered, so it is tested on its own.
        assert_eq!(rank("mo", "model.rs"), (0, 8));
        assert_eq!(rank("mo", "src/monitor.rs"), (0, 14));
        assert_eq!(rank("mo", "alpha.rs"), (1, 8), "a non-prefix match ranks below every prefix match");
        assert!(rank("mod", "model.rs") > rank("mod", "mod.rs"), "shorter wins a tie");
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
