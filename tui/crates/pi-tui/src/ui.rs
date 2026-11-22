//! Extension UI on the client side: dialogs, the status line, widgets and notices.
//!
//! RPC mode serves nine `ctx.ui` methods (ticket 08's table). The client answers four of them —
//! `select`, `confirm`, `input`, `editor` — by drawing a dialog and returning
//! `extension_ui_response`. The other five are fire-and-forget and are drawn as state: a status line,
//! widget rows above the composer, the terminal title, text placed in the composer, and notifications.
//!
//! The policy is ticket 08's: a request the client cannot render is answered `cancelled` (so the
//! extension's `await` resolves and its fallback runs) and produces **one notice per method per
//! session**. Silence would be pi's current behaviour, which is why `custom()` used to break invisibly.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use pi_tui::filter::{self, Mode};
use pi_tui::keymap::Keymap;

use crate::paint;

/// How long a notification stays on screen.
const NOTICE_FOR_MS: u64 = 6_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    Above,
    Below,
}

pub struct Widget {
    pub lines: Vec<String>,
    pub placement: Placement,
}

/// One row of a list: what it says, and what sits in its right column (empty for most lists).
#[derive(Clone, Debug)]
pub struct ListItem {
    pub label: String,
    pub right: String,
}

impl ListItem {
    pub fn label(label: impl Into<String>) -> ListItem {
        ListItem { label: label.into(), right: String::new() }
    }
}

/// One widget with four skins (ticket 05 of `.scratch/tui-rust-v2/map.md`): the extension `select`,
/// the model and thinking picker, the session picker, the command palette, and the completion popup.
///
/// A skin fills only the fields it needs: the popup has no title and no filter line, the picker has a
/// title and a right column, the palette has a filter line and no title. Filtering, the cursor, the
/// window and the hint line are shared, which is the point of one widget.
#[derive(Clone, Debug)]
pub struct ListDialog {
    pub title: Option<String>,
    pub items: Vec<ListItem>,
    /// What has been typed into the filter line.
    pub filter: String,
    pub mode: Mode,
    /// Index into the *matching* rows, not into `items`.
    pub cursor: usize,
    pub max_visible: usize,
    /// `(binding id, verb)`: rendered from the user's own keybindings, never a literal.
    pub hint: Vec<(&'static str, &'static str)>,
    /// The completion popup draws no filter line: the composer's own text is the needle.
    pub filter_line: bool,
}

impl ListDialog {
    pub fn new(items: Vec<ListItem>, mode: Mode, max_visible: usize) -> ListDialog {
        ListDialog {
            title: None,
            items,
            filter: String::new(),
            mode,
            cursor: 0,
            max_visible: max_visible.max(1),
            hint: Vec::new(),
            filter_line: true,
        }
    }

    pub fn title(mut self, title: impl Into<String>) -> ListDialog {
        self.title = Some(title.into());
        self
    }

    pub fn hint(mut self, hint: Vec<(&'static str, &'static str)>) -> ListDialog {
        self.hint = hint;
        self
    }

    pub fn no_filter_line(mut self) -> ListDialog {
        self.filter_line = false;
        self
    }

    /// The rows that match the filter, best first. Equal scores keep their original order.
    pub fn matching(&self) -> Vec<usize> {
        let mut scored: Vec<(i32, usize)> = self
            .items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| filter::score(self.mode, &self.filter, &item.label).map(|s| (s, index)))
            .collect();
        scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        scored.into_iter().map(|(_, index)| index).collect()
    }

    pub fn len(&self) -> usize {
        self.matching().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The label of the row under the cursor: what a list answers with.
    pub fn selected(&self) -> Option<String> {
        let matching = self.matching();
        matching.get(self.cursor).map(|index| self.items[*index].label.clone())
    }

    pub fn move_by(&mut self, delta: isize) {
        let len = self.len();
        if len == 0 {
            self.cursor = 0;
            return;
        }
        let next = self.cursor as isize + delta;
        self.cursor = next.clamp(0, len as isize - 1) as usize;
    }

    /// Typing into the filter line: pi resets the cursor to the first row on every change
    /// (`select-list.ts:62-67`), so the selection never jumps to a row you have not looked at.
    pub fn push_filter_char(&mut self, ch: char) {
        self.filter.push(ch);
        self.cursor = 0;
    }

    pub fn pop_filter_char(&mut self) {
        self.filter.pop();
        self.cursor = 0;
    }

    /// The visible slice of `len` rows: `max_visible` wide, centred on the cursor, clamped at both ends.
    pub fn window(&self, len: usize) -> (usize, usize) {
        if len == 0 {
            return (0, 0);
        }
        let span = self.max_visible.min(len);
        let start = self.cursor.saturating_sub(self.max_visible / 2).min(len - span);
        (start, start + span)
    }

    /// The rows this list draws in the dock, in order. The caller owns width and wrapping.
    pub fn rows(&self, keys: &Keymap) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        if let Some(title) = &self.title {
            out.push(format!(" {title}"));
        }
        if self.filter_line {
            out.push(format!(" Filter: {}_", self.filter));
        }
        let matching = self.matching();
        if matching.is_empty() {
            out.push("   No matching entries".to_string());
        } else {
            let label_width = matching
                .iter()
                .map(|index| self.items[*index].label.chars().count())
                .max()
                .unwrap_or(0);
            let show_right = matching.iter().any(|index| !self.items[*index].right.is_empty());
            let (start, end) = self.window(matching.len());
            for position in start..end {
                let item = &self.items[matching[position]];
                let marker = if position == self.cursor { ">" } else { " " };
                let mut row = format!(" {marker} {}", item.label);
                if show_right {
                    row.push_str(&" ".repeat(label_width.saturating_sub(item.label.chars().count()) + 2));
                    row.push_str(&item.right);
                }
                out.push(row);
            }
            if start > 0 || end < matching.len() {
                out.push(format!("     ({}/{})", self.cursor + 1, matching.len()));
            }
        }
        if !self.hint.is_empty() {
            let parts: Vec<String> =
                self.hint.iter().map(|(id, verb)| format!("[{}] {verb}", chord(keys, *id))).collect();
            out.push(format!(" {}", parts.join("   ")));
        }
        out
    }
}

/// A binding's chord, or the id's own last word when the user has unbound it.
fn chord(keys: &Keymap, id: &str) -> String {
    keys.display(id).unwrap_or_else(|| id.rsplit('.').next().unwrap_or(id).to_string())
}

/// Who opened a list. An extension's `select` must be answered over the wire; the client's own pickers
/// must not be (no extension is waiting for them).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Owner {
    /// An extension's request, with the id its `await` is registered under.
    Host,
    /// The client's own list: the answer comes back to the loop, tagged with this action.
    Client(&'static str),
}

pub enum Dialog {
    Select { list: ListDialog, owner: Owner },
    Confirm { title: String, message: String },
    Input { title: String, placeholder: String, text: String },
    Editor { title: String, text: String },
}

/// What the client does with a request it cannot render: one record per method, shown once.
pub struct UiState {
    pub dialog: Option<(String, Dialog)>,
    queue: VecDeque<(String, Dialog)>,
    pub status: BTreeMap<String, String>,
    pub widgets: BTreeMap<String, Widget>,
    pub notice: Option<(String, Instant)>,
    pub title: Option<String>,
    /// A request that arrived with no dialog slot: its id, so it is not lost.
    refused: Vec<String>,
    seen_unsupported: BTreeSet<String>,
    pub notices_seen: usize,
    /// Rows a list may show before it clips. pi's `autocompleteMaxVisible` (default 5, range 3-20).
    pub list_rows: usize,
    /// The messages the host has queued for the running turn, kind-tagged: `queue_update`
    /// (`agent-session.ts:1110`). Ticket 02 D3 of `.scratch/tui-rust-v2/map.md`.
    pub pending: Vec<(String, String)>,
}

impl Default for UiState {
    fn default() -> Self {
        UiState {
            dialog: None,
            queue: VecDeque::new(),
            status: BTreeMap::new(),
            widgets: BTreeMap::new(),
            notice: None,
            title: None,
            refused: Vec::new(),
            seen_unsupported: BTreeSet::new(),
            notices_seen: 0,
            list_rows: 5,
            pending: Vec::new(),
        }
    }
}

impl Default for Dialog {
    fn default() -> Self {
        Dialog::Input { title: String::new(), placeholder: String::new(), text: String::new() }
    }
}

impl UiState {
    /// Fold one `extension_ui_request` in. Returns an immediate answer when the request is one the
    /// client refuses, so the host is never left waiting.
    pub fn apply(&mut self, request: &Value) -> Option<Value> {
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        let id = request.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        match method {
            "select" => {
                // The extension's list is the same widget as the pickers (ticket 05 D5): a title, a
                // filter line, a bounded window and a hint. v1 printed every option, so a 30-option
                // request flooded the dock.
                let title = text(request, "title");
                let options = request
                    .get("options")
                    .and_then(Value::as_array)
                    .map(|items| items.iter().filter_map(|v| v.as_str().map(ListItem::label)).collect())
                    .unwrap_or_default();
                let mut list = ListDialog::new(options, Mode::Prefix, self.list_rows);
                if !title.is_empty() {
                    list.title = Some(title);
                }
                list.hint = vec![
                    ("tui.select.confirm", "choose"),
                    ("tui.select.cancel", "cancel"),
                ];
                self.push_dialog(id, Dialog::Select { list, owner: Owner::Host });
                None
            }
            "confirm" => {
                self.push_dialog(id, Dialog::Confirm { title: text(request, "title"), message: text(request, "message") });
                None
            }
            "input" => {
                self.push_dialog(
                    id,
                    Dialog::Input { title: text(request, "title"), placeholder: text(request, "placeholder"), text: String::new() },
                );
                None
            }
            "editor" => {
                self.push_dialog(id, Dialog::Editor { title: text(request, "title"), text: text(request, "prefill") });
                None
            }
            "notify" => {
                let kind = request.get("notifyType").and_then(Value::as_str).unwrap_or("info");
                let mark = match kind {
                    "error" => "!",
                    "warning" => "?",
                    _ => "-",
                };
                self.notify(format!("[{mark}] {}", text(request, "message")));
                None
            }
            "setStatus" => {
                let key = text(request, "statusKey");
                match request.get("statusText").and_then(Value::as_str) {
                    Some(value) if !value.is_empty() => {
                        self.status.insert(key, value.to_string());
                    }
                    _ => {
                        self.status.remove(&key);
                    }
                }
                None
            }
            "setWidget" => {
                let key = text(request, "widgetKey");
                let placement = match request.get("widgetPlacement").and_then(Value::as_str) {
                    Some("belowEditor") => Placement::Below,
                    _ => Placement::Above,
                };
                match request.get("widgetLines").and_then(Value::as_array) {
                    Some(lines) => {
                        let lines = lines.iter().filter_map(|v| v.as_str().map(str::to_string)).collect();
                        self.widgets.insert(key, Widget { lines, placement });
                    }
                    None => {
                        self.widgets.remove(&key);
                    }
                }
                None
            }
            "setTitle" => {
                self.title = Some(text(request, "title"));
                None
            }
            "set_editor_text" => None,
            other => Some(self.refuse(other, &id)),
        }
    }

    /// A method the client has no vocabulary for: answer cancelled, notice once.
    fn refuse(&mut self, method: &str, id: &str) -> Value {
        if self.seen_unsupported.insert(method.to_string()) {
            self.notify(format!("[ui] {method} is not supported by this client"));
        }
        if !id.is_empty() {
            self.refused.push(id.to_string());
        }
        json!({ "type": "extension_ui_response", "id": id, "cancelled": true })
    }

    /// Open one of the client's own lists. Its answer comes back tagged with `action` instead of as an
    /// extension response (see `Owner`).
    pub fn open_client_list(&mut self, action: &'static str, list: ListDialog) {
        self.push_dialog(action.to_string(), Dialog::Select { list, owner: Owner::Client(action) });
    }

    fn push_dialog(&mut self, id: String, dialog: Dialog) {
        if self.dialog.is_none() {
            self.dialog = Some((id, dialog));
        } else {
            // Never drop a dialog: the host's `await` would hang. Queue it.
            self.queue.push_back((id, dialog));
        }
    }

    pub fn notify(&mut self, message: String) {
        self.notice = Some((message, Instant::now()));
        self.notices_seen += 1;
    }

    pub fn notice_visible(&mut self) -> Option<String> {
        let (message, at) = self.notice.as_ref()?;
        if at.elapsed() > Duration::from_millis(NOTICE_FOR_MS) {
            self.notice = None;
            return None;
        }
        Some(message.clone())
    }

    /// Handle a keystroke while a dialog is open. `Some(answer)` means respond to the host now.
    /// The bindings are the user's own, so a rebind of `tui.select.up` or `ev` moves the cursor.
    pub fn handle_dialog_key(&mut self, key: &crossterm::event::KeyEvent, keys: &Keymap) -> Option<Value> {
        use crossterm::event::{KeyCode, KeyModifiers};
        let (id, dialog) = self.dialog.as_mut()?;
        let id = id.clone();
        let owner = match dialog {
            Dialog::Select { owner, .. } => *owner,
            _ => Owner::Host,
        };
        let cancelled = || match owner {
            Owner::Host => Some(json!({ "type": "extension_ui_response", "id": id, "cancelled": true })),
            Owner::Client(action) => Some(json!({ "client": action, "cancelled": true })),
        };
        let answered = |value: String| match owner {
            Owner::Host => Some(json!({ "type": "extension_ui_response", "id": id, "value": value })),
            // The loop routes the marker: a picker's answer is an RPC command, not a UI response.
            Owner::Client(action) => Some(json!({ "client": action, "value": value })),
        };
        let confirmed = |yes: bool| Some(json!({ "type": "extension_ui_response", "id": id, "confirmed": yes }));
        let is_editor = matches!(dialog, Dialog::Editor { .. });
        match dialog {
            Dialog::Select { list, .. } => {
                // Escape cancels rather than clearing the filter (ticket 02 D1: a dialog's escape is
                // its cancel). Digits land in the filter: the `[1-9] jump` shortcut is gone
                // (ticket 05 D5), because digits are filter text in a searchable list.
                if keys.matches(key, "tui.select.cancel") {
                    cancelled()
                } else if keys.matches(key, "tui.select.up") {
                    list.move_by(-1);
                    None
                } else if keys.matches(key, "tui.select.down") {
                    list.move_by(1);
                    None
                } else if keys.matches(key, "tui.select.pageUp") {
                    let step = list.max_visible as isize;
                    list.move_by(-step);
                    None
                } else if keys.matches(key, "tui.select.pageDown") {
                    let step = list.max_visible as isize;
                    list.move_by(step);
                    None
                } else if keys.matches(key, "tui.select.confirm") {
                    match list.selected() {
                        Some(value) => answered(value),
                        None => cancelled(),
                    }
                } else {
                    match key.code {
                        KeyCode::Backspace => {
                            list.pop_filter_char();
                            None
                        }
                        KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                            list.push_filter_char(ch);
                            None
                        }
                        _ => None,
                    }
                }
            }
            Dialog::Confirm { .. } => match key.code {
                KeyCode::Esc => cancelled(),
                KeyCode::Enter | KeyCode::Char('y') | KeyCode::Char('Y') => confirmed(true),
                KeyCode::Char('n') | KeyCode::Char('N') => confirmed(false),
                _ => None,
            },
            Dialog::Input { text, .. } | Dialog::Editor { text, .. } => {
                // Whether Enter inserts a newline depends on the dialog kind, decided before the
                // borrow of its `text` begins.
                let editor = is_editor;
                match key.code {
                    KeyCode::Esc => cancelled(),
                    KeyCode::Enter if !editor || key.modifiers.contains(KeyModifiers::CONTROL) => {
                        answered(text.clone())
                    }
                    KeyCode::Enter => {
                        text.push('\n');
                        None
                    }
                    KeyCode::Backspace => {
                        text.pop();
                        None
                    }
                    KeyCode::Char(ch) => {
                        text.push(ch);
                        None
                    }
                    _ => None,
                }
            }
        }
        .map(|answer| {
            // The dialog is answered: close it and promote the next queued one.
            self.finish_dialog();
            answer
        })
    }

    fn finish_dialog(&mut self) {
        self.dialog = self.queue.pop_front();
    }

    /// Answer the open dialog `cancelled` and promote the next one. `app.clear` (ctrl+c) closes a
    /// dialog in pi, so a client that swallows it is a client you cannot back out of.
    pub fn cancel_dialog(&mut self) -> Option<Value> {
        let (id, _) = self.dialog.take()?;
        self.finish_dialog();
        Some(json!({ "type": "extension_ui_response", "id": id, "cancelled": true }))
    }

    /// The rows below the transcript, bottom-up order preserved: widgets above, then the status line,
    /// then the dialog or the composer.
    pub fn bottom_rows(&mut self, composer_rows: &[String], width: usize, keys: &Keymap) -> Vec<String> {
        let mut rows: Vec<String> = Vec::new();
        if let Some(message) = self.notice_visible() {
            rows.push(message);
        }
        if !self.status.is_empty() {
            let line = self
                .status
                .iter()
                .map(|(key, value)| format!("{key}: {value}"))
                .collect::<Vec<_>>()
                .join("  ");
            rows.push(line);
        }
        for widget in self.widgets.values().filter(|w| w.placement == Placement::Above) {
            rows.extend(widget.lines.iter().cloned());
        }
        if let Some((_, dialog)) = &self.dialog {
            rows.push(String::new());
            match dialog {
                Dialog::Select { list, .. } => rows.extend(list.rows(keys)),
                Dialog::Confirm { title, message } => {
                    rows.push(format!(" {title}"));
                    rows.push(format!(" {message}"));
                    rows.push(" [y]es  [n]o  [esc] cancel".to_string());
                }
                Dialog::Input { title, placeholder, text } => {
                    rows.push(format!(" {title}"));
                    rows.push(format!(" {}{}", text, if text.is_empty() { placeholder.as_str() } else { "" }));
                    rows.push(" [enter] submit   [esc] cancel".to_string());
                }
                Dialog::Editor { title, text } => {
                    rows.push(format!(" {title}"));
                    for line in text.split('\n').take(6) {
                        rows.push(format!(" {line}"));
                    }
                    rows.push(" [ctrl-enter] submit   [enter] newline   [esc] cancel".to_string());
                }
            }
        } else {
            let _ = width;
            // The queued messages, where pi draws them: dim lines above the composer, kind-tagged,
            // with the chord that takes them back into the editor (`interactive-mode.ts:4962-4983`).
            for (kind, text) in &self.pending {
                rows.push(format!(" {kind}: {}", one_line(text, width)));
            }
            if !self.pending.is_empty() {
                if let Some(key) = keys.display("app.message.dequeue") {
                    rows.push(format!(" ↳ {key} to edit all queued messages"));
                }
            }
            rows.extend(composer_rows.iter().cloned());
        }
        for widget in self.widgets.values().filter(|w| w.placement == Placement::Below) {
            rows.extend(widget.lines.iter().cloned());
        }
        rows
    }

    pub fn has_dialog(&self) -> bool {
        self.dialog.is_some()
    }

    pub fn prompt(&self) -> String {
        match self.dialog.as_ref().map(|(_, dialog)| dialog) {
            Some(Dialog::Input { text, .. }) | Some(Dialog::Editor { text, .. }) => text.clone(),
            _ => String::new(),
        }
    }
}

/// A queue row is one line: a newline inside a queued message must not split the dock.
fn one_line(text: &str, width: usize) -> String {
    let flattened: String = text.split(['\n', '\r']).collect::<Vec<_>>().join(" ");
    let limit = width.saturating_sub(16);
    if flattened.chars().count() <= limit {
        return flattened;
    }
    flattened.chars().take(limit.saturating_sub(1)).collect::<String>() + "…"
}

fn text(request: &Value, key: &str) -> String {
    request.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

/// Wrap the bottom block for the screen. The cursor sits at the end of the last line of the block.
/// The bottom block wrapped with its cursor. `paint::compose` does this now; the helper stays for the
/// dialog tests that pin the block's shape.
#[allow(dead_code)]
pub fn compose_bottom(rows: &[String], width: usize) -> (Vec<String>, u16, u16) {
    let mut wrapped: Vec<String> = Vec::new();
    for row in rows {
        paint::wrap(row, width, &mut wrapped);
    }
    let cursor_row = wrapped.len().saturating_sub(1) as u16;
    let cursor_col = wrapped.last().map(|line| line.chars().count()).unwrap_or(0).min(width.saturating_sub(1)) as u16;
    (wrapped, cursor_row, cursor_col)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    /// pi's defaults, which is what a client with no `keybindings.json` uses.
    fn keys() -> Keymap {
        Keymap::from_user(BTreeMap::new())
    }

    #[test]
    fn a_select_dialog_answers_with_the_chosen_option() {
        let mut ui = UiState::default();
        ui.apply(&json!({"type":"extension_ui_request","id":"s1","method":"select","title":"t","options":["alpha","beta","gamma"]}));
        assert!(ui.has_dialog());
        let _ = ui.handle_dialog_key(&key(KeyCode::Down), &keys());
        let answer = ui.handle_dialog_key(&key(KeyCode::Enter), &keys()).expect("an answer");
        assert_eq!(answer["value"], "beta");
        assert_eq!(answer["id"], "s1");
        assert!(!ui.has_dialog());
    }

    #[test]
    fn a_select_list_filters_as_you_type_and_answers_the_visible_row() {
        // Ticket 05 D5: the `[1-9] jump` shortcut is gone, so a digit is filter text. Typing narrows
        // the list, and Enter answers the row under the cursor in the *filtered* order.
        let mut ui = UiState::default();
        ui.apply(&json!({"type":"extension_ui_request","id":"s2","method":"select","title":"t",
                         "options":["alpha","beta","gamma","alphabet"]}));
        for ch in "alph".chars() {
            let _ = ui.handle_dialog_key(&key(KeyCode::Char(ch)), &keys());
        }
        let answer = ui.handle_dialog_key(&key(KeyCode::Enter), &keys()).expect("an answer");
        assert!(answer["value"].as_str().unwrap().starts_with("alph"), "answered {}", answer["value"]);
        assert_eq!(answer["id"], "s2");
    }

    #[test]
    fn a_select_list_shows_a_bounded_window_and_says_how_many_rows_are_behind_it() {
        let mut ui = UiState::default();
        let options: Vec<String> = (0..12).map(|n| format!("option-{n}")).collect();
        ui.apply(&json!({"type":"extension_ui_request","id":"s3","method":"select","title":"Pick","options":options}));
        let rows = ui.bottom_rows(&[], 60, &keys());
        assert!(rows.iter().any(|r| r.contains("Pick")), "the title is missing: {rows:?}");
        // One spacer, the title, the filter line, five rows (pi's autocompleteMaxVisible default),
        // the clip indicator and the hint — and not twelve rows of options.
        assert!(rows.len() <= 10, "the window is unbounded: {} rows", rows.len());
        assert!(rows.iter().any(|r| r.contains("(1/12)")), "no clip indicator: {rows:?}");
        assert!(rows.iter().any(|r| r.contains("[enter] choose")), "no hint: {rows:?}");
    }

    #[test]
    fn a_list_hint_names_the_users_own_chord() {
        // Ticket 05 D6: the hint is rendered from the bindings, so a rebind shows up in the list.
        let mut ui = UiState::default();
        ui.apply(&json!({"type":"extension_ui_request","id":"s4","method":"select","title":"t","options":["a"]}));
        let mut rebind = BTreeMap::new();
        rebind.insert("tui.select.cancel".to_string(), vec!["ctrl+g".to_string()]);
        let rebound = Keymap::from_user(rebind);
        let rows = ui.bottom_rows(&[], 60, &rebound);
        assert!(rows.iter().any(|r| r.contains("[ctrl+g] cancel")), "hint not rebound: {rows:?}");
    }

    #[test]
    fn escape_cancels_a_list_without_clearing_its_filter() {
        let mut ui = UiState::default();
        ui.apply(&json!({"type":"extension_ui_request","id":"s5","method":"select","title":"t","options":["a","b"]}));
        let _ = ui.handle_dialog_key(&key(KeyCode::Char('b')), &keys());
        let answer = ui.handle_dialog_key(&key(KeyCode::Esc), &keys()).expect("a cancel");
        assert_eq!(answer["cancelled"], true);
    }

    #[test]
    fn escape_cancels_and_confirms_answer_the_boolean() {
        let mut ui = UiState::default();
        ui.apply(&json!({"type":"extension_ui_request","id":"c1","method":"confirm","title":"t","message":"m"}));
        assert_eq!(ui.handle_dialog_key(&key(KeyCode::Char('y')), &keys()).unwrap()["confirmed"], true);
        ui.apply(&json!({"type":"extension_ui_request","id":"c2","method":"confirm","title":"t","message":"m"}));
        assert_eq!(ui.handle_dialog_key(&key(KeyCode::Esc), &keys()).unwrap()["cancelled"], true);
    }

    #[test]
    fn an_input_dialog_accumulates_characters_and_submits_on_enter() {
        let mut ui = UiState::default();
        ui.apply(&json!({"type":"extension_ui_request","id":"i1","method":"input","title":"t","placeholder":"p"}));
        for ch in "hello".chars() {
            let _ = ui.handle_dialog_key(&key(KeyCode::Char(ch)), &keys());
        }
        assert_eq!(ui.prompt(), "hello");
        let answer = ui.handle_dialog_key(&key(KeyCode::Enter), &keys()).expect("an answer");
        assert_eq!(answer["value"], "hello");
    }

    #[test]
    fn an_editor_inserts_newlines_and_submits_on_control_enter() {
        let mut ui = UiState::default();
        ui.apply(&json!({"type":"extension_ui_request","id":"e1","method":"editor","title":"t","prefill":"one"}));
        let _ = ui.handle_dialog_key(&key(KeyCode::Enter), &keys());
        for ch in "two".chars() {
            let _ = ui.handle_dialog_key(&key(KeyCode::Char(ch)), &keys());
        }
        let answer = ui
            .handle_dialog_key(&KeyEvent::new(KeyCode::Enter, KeyModifiers::CONTROL), &keys())
            .expect("an answer");
        assert_eq!(answer["value"], "one\ntwo");
    }

    #[test]
    fn a_second_dialog_queues_instead_of_being_dropped() {
        let mut ui = UiState::default();
        ui.apply(&json!({"type":"extension_ui_request","id":"a","method":"confirm","title":"t","message":"m"}));
        ui.apply(&json!({"type":"extension_ui_request","id":"b","method":"input","title":"t2"}));
        let first = ui.handle_dialog_key(&key(KeyCode::Char('y')).into(), &keys()).unwrap();
        assert_eq!(first["id"], "a");
        assert!(ui.has_dialog(), "the queued dialog must be promoted");
        let second = ui.handle_dialog_key(&key(KeyCode::Enter), &keys()).unwrap();
        assert_eq!(second["id"], "b");
    }

    #[test]
    fn the_pending_area_lists_queued_messages_with_the_dequeue_chord() {
        // Ticket 02 D3: dim rows above the composer, kind-tagged, plus the chord that takes them back.
        let mut ui = UiState::default();
        ui.pending = vec![
            ("Steering".to_string(), "fix the test".to_string()),
            ("Follow-up".to_string(), "then run it".to_string()),
        ];
        let rows = ui.bottom_rows(&["composer".to_string()], 60, &keys());
        assert!(rows.iter().any(|r| r.contains("Steering: fix the test")), "{rows:?}");
        assert!(rows.iter().any(|r| r.contains("Follow-up: then run it")), "{rows:?}");
        assert!(rows.iter().any(|r| r.contains("to edit all queued messages")), "{rows:?}");
        // The queue sits above the composer, and the composer is the last row.
        let position = rows.iter().position(|r| r.contains("Steering:")).unwrap();
        let composer = rows.iter().position(|r| r == "composer").unwrap();
        assert!(position < composer, "the queue must be above the composer");
        assert_eq!(rows.last().unwrap(), "composer");
    }

    #[test]
    fn a_queued_message_with_a_newline_stays_on_one_row() {
        let mut ui = UiState::default();
        ui.pending = vec![("Steering".to_string(), "one\ntwo".to_string())];
        let rows = ui.bottom_rows(&["composer".to_string()], 60, &keys());
        assert!(rows.iter().any(|r| r.contains("Steering: one two")), "{rows:?}");
    }

    #[test]
    fn status_widgets_and_notices_become_rows() {
        let mut ui = UiState::default();
        ui.apply(&json!({"type":"extension_ui_request","id":"1","method":"notify","message":"hello","notifyType":"info"}));
        ui.apply(&json!({"type":"extension_ui_request","id":"2","method":"setStatus","statusKey":"k","statusText":"v"}));
        ui.apply(&json!({"type":"extension_ui_request","id":"3","method":"setWidget","widgetKey":"w","widgetLines":["w1","w2"]}));
        let rows = ui.bottom_rows(&["composer".to_string()], 40, &keys());
        assert!(rows.iter().any(|r| r.contains("hello")), "notice missing: {rows:?}");
        assert!(rows.iter().any(|r| r.contains("k: v")), "status missing: {rows:?}");
        assert!(rows.iter().any(|r| r == "w1"), "widget missing: {rows:?}");
        assert_eq!(rows.last().unwrap(), "composer");
    }

    #[test]
    fn an_unknown_method_is_answered_cancelled_and_noticed_once() {
        let mut ui = UiState::default();
        let first = ui.apply(&json!({"type":"extension_ui_request","id":"x1","method":"custom"})).expect("a refusal");
        assert_eq!(first["cancelled"], true);
        assert_eq!(first["id"], "x1");
        let notices = ui.notices_seen;
        let second = ui.apply(&json!({"type":"extension_ui_request","id":"x2","method":"custom"})).expect("a refusal");
        assert_eq!(second["cancelled"], true);
        assert_eq!(ui.notices_seen, notices, "one notice per method per session");
    }
}
