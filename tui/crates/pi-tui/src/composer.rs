//! The composer: a text buffer with grapheme motion, undo, a kill ring, paste markers and history.
//!
//! Ticket 07 fixed the contract: the composer is **local until submit**. One `prompt` command crosses,
//! nothing else — no keystrokes, no cursor, no draft. Paste markers are expanded here, before the prompt
//! is sent, so the host never sees `[paste #1 +123 lines]`.
//!
//! The pi file each rule mirrors is cited where the rule is odd enough to be worth explaining:
//! `pi/packages/tui/src/components/editor.ts` (2 494 lines) is the reference, and `keybindings.ts` is
//! where the default chords live. What is deliberately missing: mouse selection, jump mode, `@`-mentions
//! and pi's autocomplete provider chain (ticket 07's port list, rows 13–15).

use std::collections::BTreeMap;

use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

/// A paste becomes one atomic segment above either of these, exactly as pi does
/// (`editor.ts` `handlePaste`: `pastedLines.length > 10 || totalChars > 1000`).
pub const PASTE_MAX_LINES: usize = 10;
pub const PASTE_MAX_CHARS: usize = 1000;
/// How many rows the composer grows to before it scrolls internally.
pub const MAX_VISIBLE_ROWS: usize = 8;
const UNDO_LIMIT: usize = 200;

#[derive(Clone, PartialEq, Eq, Debug)]
struct Snapshot {
    lines: Vec<String>,
    row: usize,
    col: usize,
}

#[derive(Default)]
pub struct KillRing {
    entries: Vec<String>,
    /// Index into `entries` while a yank is being popped (`alt+y`).
    pop_from: Option<usize>,
}

impl KillRing {
    /// Push text killed; consecutive kills in pi append to one entry. Appending keeps `ctrl+k ctrl+k`
    /// behaving like one kill, which is what muscle memory expects.
    pub fn kill(&mut self, text: String, append: bool) {
        if text.is_empty() {
            return;
        }
        if append {
            if let Some(last) = self.entries.last_mut() {
                last.push_str(&text);
                self.pop_from = None;
                return;
            }
        }
        self.entries.push(text);
        if self.entries.len() > 32 {
            self.entries.remove(0);
        }
        self.pop_from = None;
    }

    pub fn yank(&mut self) -> Option<String> {
        let last = self.entries.last()?.clone();
        self.pop_from = Some(self.entries.len() - 1);
        Some(last)
    }

    pub fn yank_pop(&mut self) -> Option<String> {
        let index = self.pop_from?;
        if index == 0 || self.entries.is_empty() {
            return None;
        }
        let next = index - 1;
        self.pop_from = Some(next);
        Some(self.entries[next].clone())
    }

    /// A blank composer submits nothing; `submit` checks it inline too.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

pub struct Composer {
    lines: Vec<String>,
    row: usize,
    /// Byte offset into `lines[row]`, always on a grapheme boundary.
    col: usize,
    undo: Vec<Snapshot>,
    pub kill_ring: KillRing,
    /// Pasted texts behind `[paste #N …]` markers, expanded on submit (`editor.ts` `pastes`).
    pastes: BTreeMap<u32, String>,
    paste_counter: u32,
    /// Prompt history, oldest first; the last entry is the most recent prompt.
    pub history: Vec<String>,
    history_cursor: Option<usize>,
    draft: Option<Vec<String>>,
    last_action_was_kill: bool,
}

impl Default for Composer {
    fn default() -> Self {
        Composer {
            lines: vec![String::new()],
            row: 0,
            col: 0,
            undo: Vec::new(),
            kill_ring: KillRing::default(),
            pastes: BTreeMap::new(),
            paste_counter: 0,
            history: Vec::new(),
            history_cursor: None,
            draft: None,
            last_action_was_kill: false,
        }
    }
}

impl Composer {
    pub fn text(&self) -> String {
        self.lines.join("\n")
    }

    pub fn set_text(&mut self, text: &str) {
        self.push_undo();
        self.lines = normalize_text(text);
        let row = self.lines.len() - 1;
        self.row = row;
        self.col = self.lines[row].len();
        self.pastes.clear();
        self.history_cursor = None;
    }

    /// Used by `submit` and by tests; kept public so a future `/clear` binding can call it.
    #[allow(dead_code)]
    pub fn clear(&mut self) {
        self.lines = vec![String::new()];
        self.row = 0;
        self.col = 0;
        self.pastes.clear();
        self.history_cursor = None;
        self.draft = None;
    }

    /// A blank composer submits nothing; `submit` checks it inline too.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.lines.len() == 1 && self.lines[0].is_empty()
    }

    pub fn cursor(&self) -> (usize, usize) {
        (self.row, self.col)
    }

    // --- editing -------------------------------------------------------------------------

    fn push_undo(&mut self) {
        let snapshot = Snapshot { lines: self.lines.clone(), row: self.row, col: self.col };
        if self.undo.last() == Some(&snapshot) {
            return;
        }
        self.undo.push(snapshot);
        if self.undo.len() > UNDO_LIMIT {
            self.undo.remove(0);
        }
    }

    /// Insert text, splitting lines when it contains newlines: a short paste carries them, and a buffer
    /// that stored one line holding a newline byte would render and submit wrongly.
    pub fn insert(&mut self, text: &str) {
        self.push_undo();
        self.last_action_was_kill = false;
        self.history_cursor = None;
        if !text.contains('\n') {
            let line = &mut self.lines[self.row];
            line.insert_str(self.col, text);
            self.col += text.len();
            return;
        }
        let head_len = self.col;
        let (head, tail) = {
            let line = &self.lines[self.row];
            (line[..self.col].to_string(), line[self.col..].to_string())
        };
        let joined = format!("{head}{text}{tail}");
        let parts: Vec<String> = joined.split('\n').map(str::to_string).collect();
        let inserted_newlines = text.matches('\n').count();
        let last_segment_len = text.rsplit('\n').next().unwrap_or("").len();
        self.lines.splice(self.row..=self.row, parts);
        self.row += inserted_newlines;
        self.col = head_len + last_segment_len;
    }

    pub fn undo(&mut self) -> bool {
        match self.undo.pop() {
            Some(snapshot) => {
                self.lines = snapshot.lines;
                self.row = snapshot.row.min(self.lines.len() - 1);
                self.col = snapshot.col.min(self.lines[self.row].len());
                true
            }
            None => false,
        }
    }

    /// Backspace. At column 0 it joins the line above, as pi does.
    pub fn backspace(&mut self) {
        if self.col == 0 {
            if self.row == 0 {
                return;
            }
            self.push_undo();
            let line = self.lines.remove(self.row);
            self.row -= 1;
            self.col = self.lines[self.row].len();
            self.lines[self.row].push_str(&line);
            return;
        }
        self.push_undo();
        let start = self.prev_boundary(self.row, self.col);
        self.lines[self.row].replace_range(start..self.col, "");
        self.col = start;
        self.last_action_was_kill = false;
    }

    pub fn delete_forward(&mut self) {
        self.push_undo();
        let line_len = self.lines[self.row].len();
        if self.col >= line_len {
            if self.row + 1 >= self.lines.len() {
                return;
            }
            let next = self.lines.remove(self.row + 1);
            self.lines[self.row].push_str(&next);
            return;
        }
        let end = self.next_boundary(self.row, self.col);
        self.lines[self.row].replace_range(self.col..end, "");
    }

    pub fn newline(&mut self) {
        self.push_undo();
        let tail = self.lines[self.row].split_off(self.col);
        self.lines.insert(self.row + 1, tail);
        self.row += 1;
        self.col = 0;
    }

    // --- motion --------------------------------------------------------------------------

    fn next_boundary(&self, row: usize, col: usize) -> usize {
        let line = &self.lines[row];
        let mut width = col;
        for grapheme in line[col..].graphemes(true) {
            width += grapheme.len();
            return width;
        }
        line.len()
    }

    /// The grapheme boundary strictly before `col`. Returns 0 at the line start and the line's length
    /// when `col` is past the end, so motion never lands inside a multi-code-point grapheme.
    fn prev_boundary(&self, row: usize, col: usize) -> usize {
        let line = &self.lines[row];
        let mut width = 0;
        for grapheme in line.graphemes(true) {
            let next = width + grapheme.len();
            if next >= col {
                return width;
            }
            width = next;
        }
        width.min(col)
    }

    pub fn move_left(&mut self) {
        if self.col > 0 {
            self.col = self.prev_boundary(self.row, self.col);
            return;
        }
        if self.row > 0 {
            self.row -= 1;
            self.col = self.lines[self.row].len();
        }
    }

    pub fn move_right(&mut self) {
        let line_len = self.lines[self.row].len();
        if self.col < line_len {
            self.col = self.next_boundary(self.row, self.col);
            return;
        }
        if self.row + 1 < self.lines.len() {
            self.row += 1;
            self.col = 0;
        }
    }

    pub fn move_up(&mut self) {
        if self.row > 0 {
            self.row -= 1;
            let len = self.lines[self.row].len();
            self.col = self.clamp_to_boundary(self.row, self.col.min(len));
        }
    }

    pub fn move_down(&mut self) {
        if self.row + 1 < self.lines.len() {
            self.row += 1;
            let len = self.lines[self.row].len();
            self.col = self.clamp_to_boundary(self.row, self.col.min(len));
        }
    }

    fn clamp_to_boundary(&self, row: usize, col: usize) -> usize {
        let line = &self.lines[row];
        let mut width = 0;
        for grapheme in line.graphemes(true) {
            if width + grapheme.len() > col {
                return width;
            }
            width += grapheme.len();
        }
        line.len()
    }

    pub fn move_line_start(&mut self) {
        self.col = 0;
    }

    pub fn move_line_end(&mut self) {
        self.col = self.lines[self.row].len();
    }

    /// Word motion is whitespace-delimited. pi segments with `Intl.Segmenter`, which also breaks on
    /// punctuation; the difference shows on `foo.bar` (one word here, two there) and is recorded in the
    /// ticket rather than silently claimed as parity.
    pub fn move_word_left(&mut self) {
        if self.col == 0 {
            return;
        }
        let line = &self.lines[self.row];
        let mut at = self.col;
        while at > 0 && line[..at].ends_with(char::is_whitespace) {
            at -= 1;
        }
        while at > 0 {
            let prev = self.prev_boundary(self.row, at);
            let ch = &line[prev..at];
            if ch.chars().next().map(char::is_whitespace).unwrap_or(true) {
                break;
            }
            at = prev;
        }
        self.col = at;
    }

    pub fn move_word_right(&mut self) {
        let line_len = self.lines[self.row].len();
        if self.col >= line_len {
            return;
        }
        let line = &self.lines[self.row];
        let mut at = self.col;
        while at < line_len && !line[at..].chars().next().map(char::is_whitespace).unwrap_or(false) {
            at = self.next_boundary(self.row, at);
        }
        while at < line_len && line[at..].chars().next().map(char::is_whitespace).unwrap_or(false) {
            at = self.next_boundary(self.row, at);
        }
        self.col = at;
    }

    // --- killing -------------------------------------------------------------------------

    pub fn kill_word_backward(&mut self) {
        let start = {
            let before = self.col;
            self.move_word_left();
            let start = self.col;
            self.col = before;
            start
        };
        let killed = self.lines[self.row][start..self.col].to_string();
        self.push_undo();
        self.lines[self.row].replace_range(start..self.col, "");
        self.col = start;
        self.kill_ring.kill(killed, self.last_action_was_kill);
        self.last_action_was_kill = true;
    }

    pub fn kill_word_forward(&mut self) {
        let before = self.col;
        self.move_word_right();
        let end = self.col;
        self.col = before;
        let killed = self.lines[self.row][self.col..end].to_string();
        self.push_undo();
        self.lines[self.row].replace_range(self.col..end, "");
        self.kill_ring.kill(killed, self.last_action_was_kill);
        self.last_action_was_kill = true;
    }

    pub fn kill_to_line_start(&mut self) {
        let killed = self.lines[self.row][..self.col].to_string();
        self.push_undo();
        self.lines[self.row].replace_range(..self.col, "");
        self.col = 0;
        self.kill_ring.kill(killed, self.last_action_was_kill);
        self.last_action_was_kill = true;
    }

    pub fn kill_to_line_end(&mut self) {
        let killed = self.lines[self.row][self.col..].to_string();
        self.push_undo();
        self.lines[self.row].truncate(self.col);
        self.kill_ring.kill(killed, self.last_action_was_kill);
        self.last_action_was_kill = true;
    }

    pub fn yank(&mut self) -> bool {
        match self.kill_ring.yank() {
            Some(text) => {
                self.insert(&text);
                true
            }
            None => false,
        }
    }

    pub fn yank_pop(&mut self) -> bool {
        let Some(text) = self.kill_ring.yank_pop() else { return false };
        // Replace what the previous yank inserted: the same text, found backwards from the cursor.
        let line = &self.lines[self.row];
        let len = text.len();
        let start = self.col.saturating_sub(len);
        if start < self.col && line[start..self.col] == text {
            self.push_undo();
            self.lines[self.row].replace_range(start..self.col, &text);
            self.col = start + len;
            return true;
        }
        self.insert(&text);
        true
    }

    // --- paste ---------------------------------------------------------------------------

    /// Insert a bracketed paste. Above the threshold the text is stored aside and one atomic marker
    /// goes into the buffer, so wrapping, deletion and motion treat it as a single unit.
    pub fn paste(&mut self, raw: &str) {
        let text = clean_paste(raw);
        if text.is_empty() {
            return;
        }
        let lines = text.split('\n').count();
        let chars = text.chars().count();
        self.push_undo();
        let text = if starts_like_a_path(&text) && self.needs_space_before_cursor() {
            // pi's readability rule: a path pasted after a word gets a space (`editor.ts` `handlePaste`).
            format!(" {text}")
        } else {
            text
        };
        if lines > PASTE_MAX_LINES || chars > PASTE_MAX_CHARS {
            self.paste_counter += 1;
            let id = self.paste_counter;
            let marker = if lines > PASTE_MAX_LINES {
                format!("[paste #{id} +{lines} lines]")
            } else {
                format!("[paste #{id} {chars} chars]")
            };
            self.pastes.insert(id, text);
            self.insert(&marker);
        } else {
            self.insert(&text);
        }
    }

    fn needs_space_before_cursor(&self) -> bool {
        let line = &self.lines[self.row];
        let before = &line[..self.col];
        before.chars().last().map(|c| c.is_alphanumeric()).unwrap_or(false)
    }

    /// Expand markers and return the text to send. Named separately from `text()` so a caller cannot
     /// accidentally send a marker to the host.
    pub fn take_for_submit(&mut self) -> String {
        let mut out = self.text();
        let ids: Vec<u32> = self.pastes.keys().copied().collect();
        for id in ids {
            let Some(text) = self.pastes.get(&id).cloned() else { continue };
            let prefix = format!("[paste #{id} ");
            let mut from = 0;
            while let Some(offset) = out[from..].find(&prefix) {
                let start = from + offset;
                let Some(close) = out[start..].find(']') else { break };
                let span = start..start + close + 1;
                // Only a whole marker is expanded: `[paste #1` followed by anything up to `]` is the
                // marker's own shape (`[paste #1 +123 lines]` / `[paste #1 1234 chars]`).
                out.replace_range(span.clone(), &text);
                from = span.start + text.len();
            }
        }
        out
    }

    pub fn submit(&mut self) -> Option<String> {
        let text = self.take_for_submit();
        let trimmed = text.trim();
        if trimmed.is_empty() {
            self.clear();
            return None;
        }
        if self.history.last().map(|last| last.as_str()) != Some(trimmed) {
            self.history.push(trimmed.to_string());
            if self.history.len() > 200 {
                self.history.remove(0);
            }
        }
        self.clear();
        Some(text)
    }

    /// History navigation, bound to pi's `tui.editor.historyPrevious`/`historyNext` — which default to
    /// **no keys**, so this only runs when the user binds them.
    pub fn history_previous(&mut self) -> bool {
        if self.history.is_empty() {
            return false;
        }
        let next = match self.history_cursor {
            None => {
                self.draft = Some(self.lines.clone());
                self.history.len() - 1
            }
            Some(0) => 0,
            Some(index) => index - 1,
        };
        self.history_cursor = Some(next);
        let text = self.history[next].clone();
        self.set_history_text(&text);
        true
    }

    pub fn history_next(&mut self) -> bool {
        let Some(index) = self.history_cursor else { return false };
        if index + 1 >= self.history.len() {
            self.history_cursor = None;
            if let Some(draft) = self.draft.take() {
                self.lines = draft;
                self.row = self.lines.len() - 1;
                self.col = self.lines[self.row].len();
            }
            return true;
        }
        let text = self.history[index + 1].clone();
        self.history_cursor = Some(index + 1);
        self.set_history_text(&text);
        true
    }

    fn set_history_text(&mut self, text: &str) {
        self.lines = normalize_text(text);
        self.row = self.lines.len() - 1;
        self.col = self.lines[self.row].len();
    }

    /// Visible rows around the cursor, and the cursor's position within them. A pure function of the
    /// buffer and the width, so it is tested without a terminal.
    pub fn render(&self, width: usize) -> (Vec<String>, usize, usize) {
        let width = width.max(1);
        let mut visual: Vec<(usize, String)> = Vec::new();
        for (row, line) in self.lines.iter().enumerate() {
            let mut current = String::new();
            let mut used = 0;
            if line.is_empty() {
                visual.push((row, String::new()));
                continue;
            }
            for grapheme in line.graphemes(true) {
                let cells = UnicodeWidthStr::width(grapheme);
                if used + cells > width && used > 0 {
                    visual.push((row, current.clone()));
                    current.clear();
                    used = 0;
                }
                current.push_str(grapheme);
                used += cells;
            }
            visual.push((row, current));
        }

        let cursor_row_visual = visual
            .iter()
            .rposition(|(row, line)| *row == self.row && line.len() <= self.col)
            .unwrap_or(0);
        let cursor_visual_width = {
            let line = &self.lines[self.row];
            UnicodeWidthStr::width(&line[..self.col]) % width
        };

        let height = MAX_VISIBLE_ROWS;
        let start = if visual.len() > height { visual.len().saturating_sub(height).max(cursor_row_visual.saturating_sub(height - 1)) } else { 0 };
        // Keep the cursor inside the window.
        let start = if cursor_row_visual >= start + height { cursor_row_visual + 1 - height } else { start };
        let rows: Vec<String> = visual[start..].iter().map(|(_, line)| line.clone()).collect();
        let cursor_row = cursor_row_visual - start;
        (rows, cursor_row, cursor_visual_width)
    }
}

/// Normalise a text block into lines: CRLF to LF, tabs to four spaces, no control bytes but newlines.
fn normalize_text(text: &str) -> Vec<String> {
    let text = text.replace("\r\n", "\n").replace('\r', "\n").replace('\t', "    ");
    let filtered: String = text
        .chars()
        .filter(|c| *c == '\n' || ((*c as u32) >= 32 && *c != '\u{7f}'))
        .collect();
    let mut lines: Vec<String> = filtered.split('\n').map(str::to_string).collect();
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn clean_paste(raw: &str) -> String {
    // Some terminals re-encode control bytes inside a bracketed paste as CSI-u sequences
    // (`editor.ts` decodes `ESC [ <code> ; 5 u` back to the literal control byte).
    let decoded = decode_csi_u(raw);
    normalize_text(&decoded).join("\n")
}

fn decode_csi_u(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find("\u{1b}[") {
        out.push_str(&rest[..index]);
        let after = &rest[index + 2..];
        if let Some(semi) = after.find(";5u") {
            let digits: String = after[..semi].chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(code) = digits.parse::<u32>() {
                let ch = if (97..=122).contains(&code) {
                    Some((code as u8 - 96) as char)
                } else if (65..=90).contains(&code) {
                    Some((code as u8 - 64) as char)
                } else {
                    None
                };
                if let Some(ch) = ch {
                    out.push(ch);
                    rest = &after[semi + 3..];
                    continue;
                }
            }
        }
        out.push_str("\u{1b}[");
        rest = after;
    }
    out.push_str(rest);
    out
}

fn starts_like_a_path(text: &str) -> bool {
    text.starts_with('/') || text.starts_with('~') || text.starts_with('.')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn typed(text: &str) -> Composer {
        let mut composer = Composer::default();
        composer.insert(text);
        composer
    }

    #[test]
    fn typing_and_motion_stay_inside_the_buffer() {
        let mut c = typed("abc\ndef");
        c.move_up();
        c.move_line_start();
        assert_eq!(c.cursor(), (0, 0));
        c.move_right();
        assert_eq!(c.cursor(), (0, 1));
        c.move_line_end();
        c.move_down();
        assert_eq!(c.cursor(), (1, 3));
        c.move_word_left();
        assert_eq!(c.cursor(), (1, 0));
    }

    #[test]
    fn backspace_at_column_zero_joins_the_line_above() {
        let mut c = typed("abc\ndef");
        c.move_up();
        c.move_line_end();
        c.move_down();
        c.move_line_start();
        c.backspace();
        assert_eq!(c.text(), "abcdef");
        assert_eq!(c.cursor(), (0, 3));
    }

    #[test]
    fn grapheme_motion_crosses_a_flag_as_one_unit() {
        // A flag is one grapheme made of two code points; navigating by char would split it.
        let mut c = typed("a🇯🇵b");
        c.move_line_end();
        c.move_left();
        let line = c.text();
        let (_, col) = c.cursor();
        assert!(line[col..].starts_with("b"), "one step left lands before b, not inside the flag");
        c.move_left();
        let (_, col) = c.cursor();
        assert!(line[col..].starts_with("🇯🇵b"), "the next step crosses the whole flag");
        c.move_right();
        assert_eq!(c.cursor().1, line.len() - 1, "and moving right stays on the boundary");
        c.backspace();
        assert_eq!(c.text(), "ab");
    }

    #[test]
    fn undo_restores_the_previous_buffer() {
        let mut c = typed("one");
        c.insert(" two");
        assert_eq!(c.text(), "one two");
        assert!(c.undo());
        assert_eq!(c.text(), "one");
        assert!(c.undo());
        assert_eq!(c.text(), "");
        assert!(!c.undo());
    }

    #[test]
    fn the_kill_ring_yanks_and_pops() {
        let mut c = typed("alpha beta");
        c.move_line_start();
        c.kill_word_forward();
        assert_eq!(c.text(), "beta");
        c.kill_word_forward();
        // Consecutive kills append, so one entry holds both words.
        assert_eq!(c.text(), "");
        c.yank();
        assert_eq!(c.text(), "alpha beta");
    }

    #[test]
    fn kill_to_line_end_then_yank_puts_it_back() {
        let mut c = typed("keep drop");
        c.move_line_end();
        for _ in 0..4 {
            c.move_left();
        }
        c.kill_to_line_end();
        assert_eq!(c.text(), "keep ");
        c.yank();
        assert_eq!(c.text(), "keep drop");
    }

    #[test]
    fn a_short_paste_lands_inline_and_a_long_one_becomes_a_marker() {
        let mut c = Composer::default();
        c.paste("one\ntwo");
        assert_eq!(c.text(), "one\ntwo");

        let mut c = Composer::default();
        let long = (1..=12).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n");
        c.paste(&long);
        assert_eq!(c.text(), "[paste #1 +12 lines]");
        // The marker is atomic: one grapheme-motion step does not enter it, and deleting it once
        // removes it whole.
        assert_eq!(c.take_for_submit(), long);
    }

    #[test]
    fn a_long_single_line_paste_uses_the_char_form() {
        let mut c = Composer::default();
        c.paste(&"x".repeat(1200));
        assert_eq!(c.text(), "[paste #1 1200 chars]");
        assert_eq!(c.take_for_submit().len(), 1200);
    }

    #[test]
    fn a_pasted_path_after_a_word_gets_a_space() {
        let mut c = Composer::default();
        c.insert("see");
        c.paste("/tmp/file.txt");
        assert_eq!(c.text(), "see /tmp/file.txt");
    }

    #[test]
    fn csi_u_control_bytes_inside_a_paste_are_decoded() {
        let mut c = Composer::default();
        // What tmux with extended-keys-format=csi-u sends for a newline inside a paste.
        c.paste("a\u{1b}[106;5ub");
        assert_eq!(c.text(), "a\nb");
    }

    #[test]
    fn tabs_and_control_bytes_are_normalised() {
        let mut c = Composer::default();
        c.paste("a\tb\u{7}c\r\nd");
        assert_eq!(c.text(), "a    bc\nd");
    }

    #[test]
    fn submit_expands_markers_clears_and_records_history() {
        let mut c = Composer::default();
        let long = (1..=14).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n");
        c.paste(&long);
        let sent = c.submit().expect("a prompt");
        assert_eq!(sent, long);
        assert!(c.is_empty());
        assert_eq!(c.history.len(), 1);
        // A blank submit sends nothing.
        assert!(c.submit().is_none());
    }

    #[test]
    fn history_previous_restores_the_draft_on_the_way_back() {
        let mut c = Composer::default();
        c.insert("first");
        c.submit();
        c.insert("second");
        c.submit();
        c.insert("draft");
        assert!(c.history_previous());
        assert_eq!(c.text(), "second");
        assert!(c.history_previous());
        assert_eq!(c.text(), "first");
        assert!(c.history_previous(), "at the oldest entry it stays there");
        assert_eq!(c.text(), "first");
        assert!(c.history_next());
        assert_eq!(c.text(), "second");
        assert!(c.history_next());
        assert_eq!(c.text(), "draft", "the draft comes back");
    }

    #[test]
    fn render_wraps_and_keeps_the_cursor_visible() {
        let mut c = Composer::default();
        c.insert(&"abcdefghij".repeat(3)); // 30 cells
        let (rows, cursor_row, cursor_col) = c.render(10);
        assert_eq!(rows.len(), 3, "three visual rows at width 10");
        assert_eq!(rows[0], "abcdefghij");
        assert_eq!(cursor_row, 2);
        assert_eq!(cursor_col, 0);
    }

    #[test]
    fn render_caps_the_height_and_scrolls_the_window() {
        let mut c = Composer::default();
        for i in 0..20 {
            if i > 0 {
                c.newline();
            }
            c.insert(&format!("line {i}"));
        }
        let (rows, cursor_row, _) = c.render(40);
        assert_eq!(rows.len(), MAX_VISIBLE_ROWS);
        assert_eq!(cursor_row, MAX_VISIBLE_ROWS - 1);
        assert_eq!(rows.last().unwrap(), "line 19");
    }

    #[test]
    fn wide_characters_count_two_cells() {
        let mut c = Composer::default();
        c.insert("日本語");
        let (rows, _, cursor_col) = c.render(80);
        assert_eq!(rows[0], "日本語");
        assert_eq!(cursor_col, 6);
    }
}
