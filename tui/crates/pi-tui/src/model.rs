//! What the client knows: the transcript it renders, from the host's events.
//!
//! The model is deliberately dumb. It keeps logical lines — unwrapped — and the painter wraps them at
//! the current width, because wrapping at paint time is what makes a resize cheap. Every event the
//! client does not need is ignored rather than rejected: `pi-rpc`'s inventory is what decides whether
//! an event is understood at all.

use serde_json::Value;

use pi_tui::markdown::StreamingMarkdown;
use pi_tui::render::StyledRow;
use pi_tui::theme::{Role, Theme};
use pi_rpc::Line;

/// A tool call's card: the summary line, the body, and whether the cap is lifted.
///
/// Ticket 04's caps are pi's: 10 visual lines for a tool result, 20 for bash output, counted after
/// wrapping (`render::truncate_visual`), with the `app.tools.expand` chord lifting them. The body is kept
/// whole here — truncation happens at render time, so expanding costs no re-parse.
pub struct ToolCard {
    pub id: String,
    /// Kept for the per-tool policy (bash keeps its tail, edits render as diffs) and for a future
    /// per-tool expand default.
    #[allow(dead_code)]
    pub name: String,
    pub summary: StyledRow,
    pub body: Vec<StyledRow>,
    pub cap: usize,
    pub keep_last: bool,
    /// Recorded when the result failed, for the error styling the summary already applies.
    #[allow(dead_code)]
    pub is_error: bool,
    pub expanded: bool,
}

impl ToolCard {
    /// The rows to draw: the summary, the capped body, and the hint when lines are hidden.
    pub fn rows(&self) -> Vec<StyledRow> {
        let mut out = vec![self.summary.clone()];
        if self.expanded || self.body.is_empty() {
            out.extend(self.body.iter().cloned());
            return out;
        }
        let (kept, hidden) = pi_tui::render::truncate_visual(self.body.clone(), self.cap, self.keep_last);
        out.extend(kept);
        if hidden > 0 {
            out.push(pi_tui::render::more_lines_hint(hidden, "ctrl+o"));
        }
        out
    }
}

enum Item {
    Rows(Vec<StyledRow>),
    /// One of your own prompts. Kept apart from plain rows so the viewport can jump between them
    /// (ticket 03 D7) without matching a prefix in the text.
    User(Vec<StyledRow>),
    Tool(ToolCard),
}

/// Committed rows wrapped at one width, per block (ticket 03 D6). A scroll frame reuses this; any
/// change to the committed items drops it. The still-streaming tail is recomputed every frame because
/// it changes every frame.
struct RowCache {
    width: usize,
    per_item: Vec<Vec<StyledRow>>,
}

/// One piece of the transcript.
pub struct Transcript {
    items: Vec<Item>,
    cache: Option<RowCache>,
    assistant_src: String,
    md: StreamingMarkdown,
    theme: Theme,
    open: String,
    /// The last committed assistant message, for `app.message.copy` (ticket 04 D4).
    last_assistant: String,
    pub streaming: bool,
    pub tool_calls: usize,
    pub ui_requests: usize,
}

impl Default for Transcript {
    fn default() -> Self {
        Transcript {
            items: Vec::new(),
            cache: None,
            assistant_src: String::new(),
            md: StreamingMarkdown::new(),
            theme: Theme::default(),
            open: String::new(),
            last_assistant: String::new(),
            streaming: false,
            tool_calls: 0,
            ui_requests: 0,
        }
    }
}

/// The role a plain transcript line gets, by its prefix. Tool rows, notices and markers are the only
/// non-assistant rows the model produces; the assistant's own text goes through markdown.
fn role_for_line(line: &str) -> Role {
    if line.starts_with("> ") {
        Role::ToolTitle
    } else if line.starts_with("< ") {
        Role::ToolOutput
    } else if line.starts_with("... ") {
        Role::Dim
    } else if line.starts_with("[ui] ") || line.starts_with("[note] ") {
        Role::Muted
    } else {
        Role::Text
    }
}

/// A tool result's body as rows. An edit/write result renders as a diff with the three diff roles; any
    /// other result is plain output, and a failed one keeps the error background role for its first line.
fn render_tool_body(name: &str, text: &str, failed: bool) -> Vec<StyledRow> {
        let mut rows: Vec<StyledRow> = Vec::new();
        for line in text.split('\n') {
            if line.is_empty() {
                rows.push(StyledRow::default());
                continue;
            }
            let role = if failed {
                Role::Error
            } else {
                match line.chars().next() {
                    Some('+') => Role::DiffAdded,
                    Some('-') => Role::DiffRemoved,
                    Some(' ') => Role::DiffContext,
                    _ => Role::ToolOutput,
                }
            };
            let role = if name == "edit" || name == "write" { role } else if failed { Role::Error } else { Role::ToolOutput };
            rows.push(StyledRow::styled(line.to_string(), role));
        }
        rows
    }

impl Transcript {
    /// Plain text of every committed row, tool cards included at their current caps.
    pub fn lines(&self) -> Vec<String> {
        self.styled_rows().iter().map(|row| row.text()).collect()
    }

    /// Fold a `get_messages` reply into the transcript, so attaching to an existing session renders its
    /// history through the same rows as live traffic (ticket 11).
    pub fn apply_history(&mut self, messages: &serde_json::Value) -> bool {
        let Some(items) = messages.as_array() else { return false };
        let mut changed = false;
        for message in items {
            let role = message.get("role").and_then(Value::as_str).unwrap_or("");
            match role {
                "user" => {
                    if let Some(text) = message.get("content").and_then(Value::as_str) {
                        let rows: Vec<StyledRow> = text
                            .split('\n')
                            .map(|line| StyledRow::styled(format!("> {line}"), Role::UserText))
                            .collect();
                        self.items.push(Item::User(rows));
                        changed = true;
                    } else if let Some(parts) = message.get("content").and_then(Value::as_array) {
                        let text: String = parts
                            .iter()
                            .filter_map(|part| part.get("text").and_then(Value::as_str))
                            .collect();
                        if !text.is_empty() {
                            let rows: Vec<StyledRow> = text
                                .split('\n')
                                .map(|line| StyledRow::styled(format!("> {line}"), Role::UserText))
                                .collect();
                            self.items.push(Item::Rows(rows));
                            changed = true;
                        }
                    }
                }
                "assistant" => {
                    let mut source = String::new();
                    if let Some(parts) = message.get("content").and_then(Value::as_array) {
                        for part in parts {
                            match part.get("type").and_then(Value::as_str) {
                                Some("text") => {
                                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                                        source.push_str(text);
                                        source.push('\n');
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    if !source.trim().is_empty() {
                        let mut md = StreamingMarkdown::new();
                        md.update_styled(&source, &self.theme);
                        let rows = md.styled_rows();
                        self.last_assistant =
                            rows.iter().map(|row| row.text()).collect::<Vec<_>>().join("\n");
                        if !rows.is_empty() {
                            self.items.push(Item::Rows(rows));
                            self.items.push(Item::Rows(vec![StyledRow::default()]));
                            changed = true;
                        }
                    }
                }
                "toolResult" => {
                    let name = message.get("toolName").and_then(Value::as_str).unwrap_or("tool").to_string();
                    let text: String = message
                        .get("content")
                        .and_then(Value::as_array)
                        .map(|parts| {
                            parts
                                .iter()
                                .filter_map(|part| part.get("text").and_then(Value::as_str))
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .unwrap_or_default();
                    if !text.is_empty() {
                        let body = render_tool_body(&name, &text, false);
                        self.items.push(Item::Tool(ToolCard {
                            id: String::new(),
                            name: name.clone(),
                            summary: StyledRow::styled(format!("< {name} (history)"), Role::Muted),
                            body,
                            cap: if name == "bash" { 20 } else { 10 },
                            keep_last: name == "bash",
                            is_error: false,
                            expanded: false,
                        }));
                        changed = true;
                    }
                }
                _ => {}
            }
        }
        if changed {
            self.invalidate_rows();
        }
        changed
    }

    /// Toggle a tool card's cap. Returns true when something changed, so the caller repaints.
    pub fn toggle_tool_expansion(&mut self, id: Option<&str>) -> bool {
        self.invalidate_rows();
        let target = match id {
            Some(id) => self.items.iter_mut().find_map(|item| match item {
                Item::Tool(card) if card.id == id => Some(card),
                _ => None,
            }),
            None => self.items.iter_mut().rev().find_map(|item| match item {
                Item::Tool(card) => Some(card),
                _ => None,
            }),
        };
        match target {
            Some(card) => {
                card.expanded = !card.expanded;
                true
            }
            None => false,
        }
    }

    /// Set once at start: the theme the markdown blocks are rendered with.
    pub fn set_theme(&mut self, theme: Theme) {
        self.theme = theme;
        self.invalidate_rows();
    }

    /// Every document row as text, wrapped at `width`. A copy needs the whole document because a
    /// selection can span any part of it; this is the only caller allowed to pay for the whole wrap.
    pub fn all_rows_text(&mut self, width: usize) -> Vec<String> {
        self.refresh_cache(width);
        let mut out: Vec<String> = Vec::new();
        if let Some(cache) = &self.cache {
            for rows in &cache.per_item {
                out.extend(rows.iter().map(|row| row.text()));
            }
        }
        out.extend(pi_tui::render::wrap_rows(&self.md.styled_rows(), width).iter().map(|row| row.text()));
        out
    }

    /// The last assistant message the transcript committed, as text.
    pub fn last_assistant(&self) -> String {
        self.last_assistant.clone()
    }

    /// Drop the wrapped-row cache. Every mutator calls this: a stale cache paints a stale transcript.
    fn invalidate_rows(&mut self) {
        self.cache = None;
    }

    /// Rebuild the per-block wrapped rows when the width changed or the cache was dropped.
    fn refresh_cache(&mut self, width: usize) {
        if self.cache.as_ref().is_some_and(|cache| cache.width == width) {
            return;
        }
        let mut per_item = Vec::with_capacity(self.items.len());
        for item in &self.items {
            let rows = match item {
                Item::Rows(rows) | Item::User(rows) => rows.clone(),
                Item::Tool(card) => card.rows(),
            };
            per_item.push(pi_tui::render::wrap_rows(&rows, width));
        }
        self.cache = Some(RowCache { width, per_item });
    }

    /// The document's shape at this width: one row count per committed block, then the streaming tail.
    /// A scroll frame needs only this and the cached rows (ticket 03 D6).
    pub fn doc_map(&mut self, width: usize) -> pi_tui::viewport::DocMap {
        self.refresh_cache(width);
        let mut counts: Vec<usize> = self
            .cache
            .as_ref()
            .map(|cache| cache.per_item.iter().map(Vec::len).collect())
            .unwrap_or_default();
        counts.push(pi_tui::render::wrap_rows(&self.md.styled_rows(), width).len());
        pi_tui::viewport::DocMap::new(counts)
    }

    /// The document rows `start..start+height`, padded with blanks so the caller always gets `height`
    /// rows. Nothing outside the window is wrapped, which is the whole point of the cache.
    pub fn window_rows(&mut self, width: usize, start: usize, height: usize) -> Vec<StyledRow> {
        self.refresh_cache(width);
        let open_rows = pi_tui::render::wrap_rows(&self.md.styled_rows(), width);
        let end = start.saturating_add(height);
        let mut out: Vec<StyledRow> = Vec::with_capacity(height);
        let mut row = 0usize;
        if let Some(cache) = &self.cache {
            for rows in &cache.per_item {
                if row >= end {
                    break;
                }
                let block_end = row + rows.len();
                if block_end > start {
                    let from = start.saturating_sub(row);
                    let to = (end - row).min(rows.len());
                    out.extend(rows[from..to].iter().cloned());
                }
                row = block_end;
            }
        }
        if row < end && start < row + open_rows.len() {
            let from = start.saturating_sub(row);
            let to = (end - row).min(open_rows.len());
            out.extend(open_rows[from..to].iter().cloned());
        }
        out.resize(height, StyledRow::default());
        out
    }

    /// The document row each of your prompts starts at, for `app.scroll.prevUserMessage`.
    pub fn user_rows(&mut self, width: usize) -> Vec<usize> {
        self.refresh_cache(width);
        let mut rows = Vec::new();
        let mut row = 0usize;
        if let Some(cache) = &self.cache {
            for (index, item) in self.items.iter().enumerate() {
                if matches!(item, Item::User(_)) {
                    rows.push(row);
                }
                row += cache.per_item.get(index).map(Vec::len).unwrap_or(0);
            }
        }
        rows
    }

    /// Committed items plus the assistant's styled markdown, ready for the painter.
    /// Wrapped at no width: the live path asks for `window_rows` instead.
    #[allow(dead_code)]
    pub fn styled_rows(&self) -> Vec<StyledRow> {
        let mut out = Vec::new();
        for item in &self.items {
            match item {
                Item::Rows(rows) | Item::User(rows) => out.extend(rows.iter().cloned()),
                Item::Tool(card) => out.extend(card.rows()),
            }
        }
        out.extend(self.md.styled_rows());
        out
    }

    /// Logical lines, with the still-streaming text as the last one.
    /// Plain text of everything, open text included: the probes and tests read it.
    #[allow(dead_code)]
    pub fn snapshot(&self) -> Vec<String> {
        let mut out = self.lines();
        if !self.open.is_empty() {
            out.extend(self.open.split('\n').map(|s| s.to_string()));
        }
        out
    }

    /// Wipes the transcript (a future `/new` path).
    #[allow(dead_code)]
    pub fn clear(&mut self) {
        self.invalidate_rows();
        self.items.clear();
        self.assistant_src.clear();
        self.md = StreamingMarkdown::new();
        self.open.clear();
    }

    fn commit_open(&mut self) {
        self.invalidate_rows();
        if !self.open.is_empty() {
            // The assistant's message becomes markdown rows; the streamed source already lives in the
            // incremental renderer, so nothing is re-parsed here.
            self.open.clear();
        }
        if !self.assistant_src.is_empty() {
            self.last_assistant = self.md.styled_rows().iter().map(|row| row.text()).collect::<Vec<_>>().join("\n");
            let rows = self.md.styled_rows();
            if !rows.is_empty() {
                self.items.push(Item::Rows(rows));
            }
            self.items.push(Item::Rows(vec![StyledRow::default()]));
            self.assistant_src.clear();
            self.md = StreamingMarkdown::new();
        }
    }

    fn push_line(&mut self, text: impl Into<String>) {
        self.commit_open();
        self.invalidate_rows();
        let text = text.into();
        let rows: Vec<StyledRow> = text
            .split('\n')
            .map(|piece| StyledRow::styled(piece.to_string(), role_for_line(piece)))
            .collect();
        self.items.push(Item::Rows(rows));
    }

    /// The prompt the client is sending, shown the way history shows an earlier one (`apply_history`'s
    /// `user` branch). Without this a live prompt never appears: the host does not echo what the client
    /// sent, so only a reload showed your own messages.
    pub fn push_user(&mut self, text: &str) -> bool {
        if text.trim().is_empty() {
            return false;
        }
        self.commit_open();
        let rows: Vec<StyledRow> = text
            .split('\n')
            .map(|line| StyledRow::styled(format!("> {line}"), Role::UserText))
            .collect();
        self.items.push(Item::User(rows));
        self.invalidate_rows();
        true
    }

    /// Apply one host line. Returns true when the painted frame would change.
    pub fn apply(&mut self, line: &Line) -> bool {
        let value = line.value();
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "agent_start" => {
                self.streaming = true;
                true
            }
            "agent_settled" | "agent_end" => {
                self.commit_open();
                self.streaming = false;
                true
            }
            "message_update" => self.apply_delta(value),
            "message_start" => {
                // A new message begins; nothing to paint until its first delta.
                false
            }
            "message_end" => {
                let role = value.pointer("/message/role").and_then(Value::as_str);
                if role == Some("assistant") {
                    self.commit_open();
                    // An aborted turn is marked with the host's own fields, never an invented notice
                    // (ticket 02 D4 of `.scratch/tui-rust-v2/map.md`): the message carries
                    // `stopReason: "aborted"` and an `errorMessage` (`interactive-mode.ts:3756-3777`
                    // renders exactly these).
                    if value.pointer("/message/stopReason").and_then(Value::as_str) == Some("aborted") {
                        let text = value
                            .pointer("/message/errorMessage")
                            .and_then(Value::as_str)
                            .unwrap_or("aborted");
                        self.push_line(format!("... {text}"));
                    }
                    true
                } else {
                    false
                }
            }
            "tool_execution_start" => {
                self.tool_calls += 1;
                let name = value.get("toolName").and_then(Value::as_str).unwrap_or("tool");
                let detail = value
                    .pointer("/args/command")
                    .or_else(|| value.pointer("/args/path"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let detail = detail.lines().next().unwrap_or("").chars().take(60).collect::<String>();
                self.push_line(format!("> {name}: {detail}"));
                true
            }
            "tool_execution_end" => {
                let name = value.get("toolName").and_then(Value::as_str).unwrap_or("tool").to_string();
                let id = value.get("toolCallId").and_then(Value::as_str).unwrap_or("").to_string();
                let failed = value.get("isError").and_then(Value::as_bool).unwrap_or(false);
                let text = value
                    .pointer("/result/content/0/text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let bytes = text.len();
                self.commit_open();
                // Bash output keeps its tail (pi shows the last 20 lines); other tools keep their head.
                let (cap, keep_last) = if name == "bash" { (20, true) } else { (10, false) };
                let body = render_tool_body(&name, &text, failed);
                let summary = StyledRow {
                    spans: vec![
                        pi_tui::render::StyledSpan::new(format!("< {name} "), Role::ToolTitle),
                        pi_tui::render::StyledSpan::new(
                            if failed { "failed" } else { "done" },
                            if failed { Role::Error } else { Role::Success },
                        ),
                        pi_tui::render::StyledSpan::new(format!(" ({bytes} B)"), Role::Muted),
                    ],
                };
                self.items.push(Item::Tool(ToolCard {
                    id,
                    name,
                    summary,
                    body,
                    cap,
                    keep_last,
                    is_error: failed,
                    expanded: false,
                }));
                true
            }
            "compaction_start" => {
                self.push_line("... compacting");
                true
            }
            "compaction_end" => {
                let failed = value.get("errorMessage").and_then(Value::as_str);
                self.push_line(match failed {
                    Some(message) => format!("... compaction failed: {message}"),
                    None => "... compacted".to_string(),
                });
                true
            }
            "extension_ui_request" => {
                self.ui_requests += 1;
                let method = value.get("method").and_then(Value::as_str).unwrap_or("?");
                if method != "notify" && method != "setStatus" && method != "setWidget" {
                    self.push_line(format!("[ui] {method}"));
                } else if method == "notify" {
                    if let Some(message) = value.get("message").and_then(Value::as_str) {
                        self.push_line(format!("[note] {message}"));
                    }
                }
                true
            }
            "response" => false,
            _ => false,
        }
    }

    fn apply_delta(&mut self, value: &Value) -> bool {
        let delta = match value.get("assistantMessageEvent") {
            Some(delta) => delta,
            None => return false,
        };
        match delta.get("type").and_then(Value::as_str) {
            Some("text_delta") => {
                if let Some(text) = delta.get("delta").and_then(Value::as_str) {
                    // The assistant's text is markdown: append to the source and let the incremental
                    // renderer re-parse only its open block (ticket 06).
                    self.assistant_src.push_str(text);
                    self.md.update_styled(&self.assistant_src, &self.theme);
                    return true;
                }
                false
            }
            Some("text_end") => {
                self.commit_open();
                true
            }
            Some("toolcall_start") => true,
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pi_tui::theme::Theme;
    use serde_json::json;

    fn apply(t: &mut Transcript, value: serde_json::Value) {
        let line = pi_rpc::Line::parse(value);
        t.apply(&line);
    }

    #[test]
    fn the_window_shows_only_the_rows_asked_for() {
        let mut t = Transcript::default();
        for line in ["one", "two", "three", "four"] {
            apply(&mut t, json!({"type": "extension_ui_request", "method": "notify", "message": line}));
        }
        // The notify rows are pushed as plain lines; take the middle two of the document.
        let map = t.doc_map(40);
        assert!(map.total() >= 4, "the document has the pushed lines: {}", map.total());
        let window = t.window_rows(40, 1, 2);
        assert_eq!(window.len(), 2);
        let text = window.iter().map(|row| row.text()).collect::<Vec<_>>().join("|");
        let full = t.window_rows(40, 0, map.total());
        assert_ne!(text, full.iter().take(2).map(|r| r.text()).collect::<Vec<_>>().join("|"),
                   "the window must start at row 1, not row 0");
        assert_eq!(text, full[1..3].iter().map(|r| r.text()).collect::<Vec<_>>().join("|"));
    }

    #[test]
    fn a_window_past_the_end_is_padded_with_blanks() {
        let mut t = Transcript::default();
        apply(&mut t, json!({"type": "extension_ui_request", "method": "notify", "message": "only"}));
        let rows = t.window_rows(40, 999, 3);
        assert_eq!(rows.len(), 3, "the caller always gets the height it asked for");
        assert!(rows.iter().all(|row| row.text().is_empty()));
    }

    #[test]
    fn the_document_map_counts_the_streaming_tail() {
        let mut t = Transcript::default();
        apply(&mut t, json!({"type": "message_start", "message": {"role": "assistant"}}));
        apply(&mut t, json!({"type": "message_update",
                             "assistantMessageEvent": {"type": "text_delta", "delta": "streaming"}}));
        let map = t.doc_map(40);
        assert!(map.total() >= 1, "the open text is part of the document");
    }

    #[test]
    fn the_user_rows_are_where_a_jump_lands() {
        let mut t = Transcript::default();
        assert!(t.push_user("first"));
        apply(&mut t, json!({"type": "extension_ui_request", "method": "notify", "message": "answer"}));
        assert!(t.push_user("second"));
        let rows = t.user_rows(40);
        assert_eq!(rows.len(), 2, "two prompts, two anchors: {rows:?}");
        assert_eq!(rows[0], 0);
        assert!(rows[1] > rows[0], "the second prompt comes after the first");
    }

    #[test]
    fn the_clients_own_prompt_is_visible_without_a_reload() {
        let mut t = Transcript::default();
        assert!(t.push_user("what does this do?"));
        let text = t.lines().join("\n");
        assert!(text.contains("> what does this do?"), "the prompt must show: {text}");
    }

    #[test]
    fn an_aborted_turn_is_marked_with_the_hosts_own_error_text() {
        let mut t = Transcript::default();
        apply(&mut t, json!({"type": "message_start", "message": {"role": "assistant"}}));
        apply(&mut t, json!({"type": "message_update",
                             "assistantMessageEvent": {"type": "text_delta", "delta": "half an answer"}}));
        apply(&mut t, json!({"type": "message_end", "message": {
            "role": "assistant", "stopReason": "aborted", "errorMessage": "Operation aborted"
        }}));
        let text = t.lines().join("\n");
        assert!(text.contains("half an answer"), "the partial answer stays: {text}");
        assert!(text.contains("Operation aborted"), "the abort text must be shown: {text}");
    }

    fn tool_end(name: &str, text: String, failed: bool) -> serde_json::Value {
        json!({
            "type": "tool_execution_end",
            "toolCallId": "call-1",
            "toolName": name,
            "isError": failed,
            "result": { "content": [ { "type": "text", "text": text } ] }
        })
    }

    #[test]
    fn a_long_tool_result_is_capped_at_ten_visual_lines_with_a_hint() {
        let mut t = Transcript::default();
        let body = (1..=40).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n");
        apply(&mut t, tool_end("read", body, false));
        let rows = t.styled_rows();
        // summary + 10 body rows + hint
        assert_eq!(rows.len(), 12, "{:?}", rows.iter().map(|r| r.text()).collect::<Vec<_>>());
        assert_eq!(rows[1].text(), "line 1", "the head is kept for a read");
        let hint = rows.last().unwrap().text();
        assert!(hint.contains("30 more lines"), "{hint:?}");
        assert!(hint.contains("ctrl+o"), "the chord is named: {hint:?}");
    }

    #[test]
    fn expanding_shows_the_whole_body_and_collapsing_restores_the_cap() {
        let mut t = Transcript::default();
        let body = (1..=40).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n");
        apply(&mut t, tool_end("read", body, false));
        assert!(t.toggle_tool_expansion(None));
        assert_eq!(t.styled_rows().len(), 41, "summary plus every body line");
        // Collapsing toggles the same card back; the call reports that it acted.
        assert!(t.toggle_tool_expansion(None));
        assert_eq!(t.styled_rows().len(), 12);
    }

    #[test]
    fn bash_output_keeps_its_tail() {
        let mut t = Transcript::default();
        let body = (1..=40).map(|i| format!("row {i}")).collect::<Vec<_>>().join("\n");
        apply(&mut t, tool_end("bash", body, false));
        let rows = t.styled_rows();
        assert_eq!(rows.len(), 22, "summary + 20 body rows + hint");
        let kept_last = rows.len() - 2;
        assert_eq!(rows[kept_last].text(), "row 40", "the tail is what matters for bash");
        assert!(rows.last().unwrap().text().contains("20 more lines"));
    }

    #[test]
    fn an_edit_result_carries_the_three_diff_roles() {
        let mut t = Transcript::default();
        apply(&mut t, tool_end("edit", "+added\n-removed\n context\n".to_string(), false));
        let rows = t.styled_rows();
        let roles: Vec<Role> = rows.iter().skip(1).flat_map(|r| r.spans.iter().map(|s| s.role)).collect();
        assert_eq!(roles, vec![Role::DiffAdded, Role::DiffRemoved, Role::DiffContext]);
    }

    #[test]
    fn a_failed_tool_result_keeps_its_summary_in_the_error_role() {
        let mut t = Transcript::default();
        apply(&mut t, tool_end("bash", "boom\n".to_string(), true));
        let rows = t.styled_rows();
        assert_eq!(rows[0].spans[1].role, Role::Error);
        assert_eq!(rows[1].spans[0].role, Role::Error);
    }

    #[test]
    fn attaching_to_a_session_renders_its_history() {
        let mut t = Transcript::default();
        t.set_theme(Theme::parse(r#"{"colors": {"text": "okhsl(234 3% 89%)"}}"#).expect("a theme"));
        let history = json!([
            { "role": "user", "content": [ { "type": "text", "text": "earlier question" } ] },
            { "role": "assistant", "content": [ { "type": "text", "text": "# Answer\n\nbody text\n" } ] },
            { "role": "toolResult", "toolName": "bash", "content": [ { "type": "text", "text": "history output" } ] }
        ]);
        assert!(t.apply_history(&history));
        let rows = t.styled_rows();
        assert_eq!(rows.iter().find(|r| r.text().starts_with("> earlier")).unwrap().spans[0].role, Role::UserText);
        assert!(rows.iter().any(|r| r.text() == "# Answer"));
        assert!(rows.iter().any(|r| r.text() == "history output"), "a historical tool result renders as body rows");
    }

    #[test]
    fn assistant_text_is_markdown_with_roles_and_tool_cards_stay_in_order() {
        let mut t = Transcript::default();
        t.set_theme(Theme::parse(r#"{"colors": {"mdHeading": "okhsl(83 88% 67%)"}}"#).expect("a theme"));
        apply(&mut t, json!({"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": "# Heading\n\npara\n"}}));
        apply(&mut t, tool_end("bash", "out\n".to_string(), false));
        apply(&mut t, json!({"type": "message_end", "message": {"role": "assistant"}}));
        let rows = t.styled_rows();
        let heading = rows.iter().position(|r| r.text() == "# Heading").expect("the heading row");
        assert_eq!(rows[heading].spans[0].role, Role::MdHeading);
        let summary = rows.iter().position(|r| r.text().starts_with("< bash ")).expect("the tool summary");
        assert!(summary > heading, "the tool card comes after the assistant's text");
    }
}
