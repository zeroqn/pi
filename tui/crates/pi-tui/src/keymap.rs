//! Which key does what: pi's binding ids, its defaults, and the user's `keybindings.json`.
//!
//! pi resolves bindings by **id**, not by chord: `<agentDir>/keybindings.json` maps ids like
//! `tui.input.submit` to a key or a list of keys, defaults come from `TUI_KEYBINDINGS`
//! (`pi/packages/tui/src/keybindings.ts`), a user binding replaces the default for that id, and two ids
//! claiming the same key is a conflict that pi reports rather than resolves silently. The client mirrors
//! that merge so your muscle memory and customisations carry over (ticket 07, decision 1).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

/// A chord as a binding file writes it: `"ctrl+k"`, `"shift+enter"`, `"alt+left"`, `"up"`, `"enter"`.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct KeyId {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub base: String,
}

impl KeyId {
    pub fn parse(spec: &str) -> Option<KeyId> {
        let mut key = KeyId { ctrl: false, alt: false, shift: false, base: String::new() };
        let mut parts = spec.trim().to_lowercase();
        loop {
            if let Some(rest) = parts.strip_prefix("ctrl+") {
                key.ctrl = true;
                parts = rest.to_string();
            } else if let Some(rest) = parts.strip_prefix("control+") {
                key.ctrl = true;
                parts = rest.to_string();
            } else if let Some(rest) = parts.strip_prefix("alt+") {
                key.alt = true;
                parts = rest.to_string();
            } else if let Some(rest) = parts.strip_prefix("meta+") {
                key.alt = true;
                parts = rest.to_string();
            } else if let Some(rest) = parts.strip_prefix("shift+") {
                key.shift = true;
                parts = rest.to_string();
            } else {
                break;
            }
        }
        // pi writes `pageUp`/`pageDown`; the file is case-insensitive for these.
        let base = match parts.as_str() {
            "pageup" | "page_up" => "pageup".to_string(),
            "pagedown" | "page_down" => "pagedown".to_string(),
            "escape" | "esc" => "esc".to_string(),
            "return" => "enter".to_string(),
            other => other.to_string(),
        };
        if base.is_empty() {
            return None;
        }
        key.base = base;
        Some(key)
    }

    /// Does this chord match the key the terminal delivered? Shift is compared loosely for printable
    /// characters, because terminals disagree about whether a capital `A` carries SHIFT.
    pub fn matches(&self, event: &KeyEvent) -> bool {
        if self.ctrl != event.modifiers.contains(KeyModifiers::CONTROL) {
            return false;
        }
        if self.alt != event.modifiers.contains(KeyModifiers::ALT) {
            return false;
        }
        let base = match event.code {
            KeyCode::Char(ch) => ch.to_lowercase().to_string(),
            KeyCode::Enter => "enter".to_string(),
            KeyCode::Tab => "tab".to_string(),
            KeyCode::Backspace => "backspace".to_string(),
            KeyCode::Delete => "delete".to_string(),
            KeyCode::Esc => "esc".to_string(),
            KeyCode::Up => "up".to_string(),
            KeyCode::Down => "down".to_string(),
            KeyCode::Left => "left".to_string(),
            KeyCode::Right => "right".to_string(),
            KeyCode::Home => "home".to_string(),
            KeyCode::End => "end".to_string(),
            KeyCode::PageUp => "pageup".to_string(),
            KeyCode::PageDown => "pagedown".to_string(),
            _ => return false,
        };
        if self.base != base {
            return false;
        }
        // Shift matters for the chords that use it (shift+enter, shift+delete); for a bare printable
        // character the terminal's report is unreliable, so it is ignored.
        if self.base.len() == 1 && !self.ctrl && !self.alt {
            return true;
        }
        self.shift == event.modifiers.contains(KeyModifiers::SHIFT)
    }

    /// The chord as a hint line writes it: `ctrl+k`, `alt+enter`, `up`. A hint must never name a chord
    /// the user no longer has (ticket 05 D6 of `.scratch/tui-rust-v2/map.md`).
    pub fn display(&self) -> String {
        let mut out = String::new();
        if self.ctrl {
            out.push_str("ctrl+");
        }
        if self.alt {
            out.push_str("alt+");
        }
        if self.shift {
            out.push_str("shift+");
        }
        let base = match self.base.as_str() {
            "esc" => "esc",
            "enter" => "enter",
            "pageup" => "pgup",
            "pagedown" => "pgdn",
            "backspace" => "bspace",
            " " => "space",
            other => other,
        };
        out.push_str(base);
        out
    }
}

/// The ids the client acts on, with pi's defaults.
pub fn default_bindings() -> Vec<(&'static str, Vec<&'static str>)> {
    vec![
        ("tui.editor.cursorUp", vec!["up"]),
        ("tui.editor.cursorDown", vec!["down"]),
        // pi binds NO keys to history by default (`TUI_KEYBINDINGS`): up/down are cursor motion, and
        // history is opt-in through the user's file.
        ("tui.editor.historyPrevious", vec![]),
        ("tui.editor.historyNext", vec![]),
        ("tui.editor.cursorLeft", vec!["left", "ctrl+b"]),
        ("tui.editor.cursorRight", vec!["right", "ctrl+f"]),
        ("tui.editor.cursorWordLeft", vec!["alt+left", "ctrl+left", "alt+b"]),
        ("tui.editor.cursorWordRight", vec!["alt+right", "ctrl+right", "alt+f"]),
        ("tui.editor.cursorLineStart", vec!["home", "ctrl+a"]),
        ("tui.editor.cursorLineEnd", vec!["end", "ctrl+e"]),
        ("tui.editor.pageUp", vec!["pageup", "ctrl+pageup"]),
        ("tui.editor.pageDown", vec!["pagedown", "ctrl+pagedown"]),
        ("tui.editor.deleteCharBackward", vec!["backspace"]),
        ("tui.editor.deleteCharForward", vec!["delete", "ctrl+d"]),
        ("tui.editor.deleteWordBackward", vec!["ctrl+w", "alt+backspace"]),
        ("tui.editor.deleteWordForward", vec!["alt+d", "alt+delete"]),
        ("tui.editor.deleteToLineStart", vec!["ctrl+u"]),
        ("tui.editor.deleteToLineEnd", vec!["ctrl+k"]),
        ("tui.editor.yank", vec!["ctrl+y"]),
        ("tui.editor.yankPop", vec!["alt+y"]),
        ("tui.editor.undo", vec!["ctrl+-", "ctrl+z"]),
        ("tui.input.newLine", vec!["shift+enter", "ctrl+j"]),
        ("tui.select.up", vec!["up"]),
        ("tui.select.down", vec!["down"]),
        ("tui.select.pageUp", vec!["pageup"]),
        ("tui.select.pageDown", vec!["pagedown"]),
        ("tui.select.confirm", vec!["enter"]),
        ("tui.select.cancel", vec!["esc"]),
        ("tui.input.submit", vec!["enter"]),
        ("tui.input.tab", vec!["tab"]),
        ("app.tools.expand", vec!["ctrl+o"]),
        // Ticket 02 of `.scratch/tui-rust-v2/map.md`: pi's turn-control ids, with pi's own defaults
        // (`keybindings.ts`: `app.interrupt` escape, `app.clear` ctrl+c, `app.exit` ctrl+d, then
        // `app.message.followUp` alt+enter and `app.message.dequeue` alt+up; on Windows pi uses
        // ctrl+q for both). v1 hardcoded ctrl+c/ctrl+d and bound none of these.
        ("app.interrupt", vec!["esc"]),
        ("app.clear", vec!["ctrl+c"]),
        ("app.exit", vec!["ctrl+d"]),
        ("app.message.followUp", vec!["alt+enter"]),
        ("app.message.dequeue", vec!["alt+up"]),
        // pi's copy chord (`keybindings.ts`: `app.message.copy` ctrl+x).
        ("app.message.copy", vec!["ctrl+x"]),
        // Ticket 10 D2: pi's suspend chord (`keybindings.ts`), unbound on Windows in pi.
        ("app.suspend", vec!["ctrl+z"]),
        // Ticket 07: pi's picker and cycle chords (`keybindings.ts`), with pi's defaults.
        ("app.model.select", vec!["ctrl+l"]),
        ("app.model.cycleForward", vec!["ctrl+p"]),
        ("app.model.cycleBackward", vec!["shift+ctrl+p"]),
        ("app.thinking.cycle", vec!["shift+tab"]),
        // Client-only ids (ticket 03 D7): pi has no transcript-scrolling bindings, and its schema
        // tolerates extra ids (`keybindings-schema.ts:20-24`). Documented as client-only in the README
        // so nobody expects pi to honour them.
        ("app.scroll.top", vec!["ctrl+home"]),
        ("app.scroll.bottom", vec!["ctrl+end"]),
        ("app.scroll.prevUserMessage", vec!["alt+["]),
        ("app.scroll.nextUserMessage", vec!["alt+]"]),
    ]
}

/// The resolved keymap: id -> chords, plus the conflicts found while resolving.
#[derive(Clone)]
pub struct Keymap {
    bindings: BTreeMap<String, Vec<KeyId>>,
    pub conflicts: Vec<String>,
}

impl Default for Keymap {
    fn default() -> Self {
        Keymap::from_user(BTreeMap::new())
    }
}

impl Keymap {
    pub fn from_user(user: BTreeMap<String, Vec<String>>) -> Keymap {
        let mut bindings = BTreeMap::new();
        let mut conflicts = Vec::new();
        let defaults = default_bindings();

        // User claims first, so a conflict is reported as "two ids want this key".
        let mut claims: BTreeMap<KeyId, Vec<String>> = BTreeMap::new();
        for (id, specs) in &user {
            for spec in specs {
                if let Some(key) = KeyId::parse(spec) {
                    claims.entry(key).or_default().push(id.clone());
                }
            }
        }
        for (key, ids) in claims {
            if ids.len() > 1 {
                conflicts.push(format!(
                    "{:?} is claimed by {}",
                    key.base,
                    ids.join(", ")
                ));
            }
        }

        for (id, defaults_keys) in defaults {
            let chosen = match user.get(id) {
                Some(specs) => specs.clone(),
                None => defaults_keys.into_iter().map(str::to_string).collect(),
            };
            let keys: Vec<KeyId> = chosen.iter().filter_map(|spec| KeyId::parse(spec)).collect();
            bindings.insert(id.to_string(), keys);
        }
        Keymap { bindings, conflicts }
    }

    /// Read `<agentDir>/keybindings.json`. A missing or malformed file is not an error: pi falls back
    /// to defaults, and so does the client.
    pub fn load() -> Keymap {
        let Some(path) = keybindings_path() else { return Keymap::default() };
        Keymap::load_from(&path)
    }

    pub fn load_from(path: &Path) -> Keymap {
        let Ok(text) = std::fs::read_to_string(path) else { return Keymap::default() };
        let user = parse_bindings(&text);
        Keymap::from_user(user)
    }

    pub fn matches(&self, event: &KeyEvent, id: &str) -> bool {
        self.bindings.get(id).map(|keys| keys.iter().any(|key| key.matches(event))).unwrap_or(false)
    }

    /// Do any of the ids beginning with `prefix` match? Used for the editor's motion family.
    #[allow(dead_code)]
    /// The chords behind an id: the hint row and the tests read it.
    pub fn keys_for(&self, id: &str) -> Vec<KeyId> {
        self.bindings.get(id).cloned().unwrap_or_default()
    }

    /// Whether the user bound this id at all (history ships unbound, as in pi).
    #[allow(dead_code)]
    pub fn has_binding(&self, id: &str) -> bool { self.bindings.get(id).map(|keys| !keys.is_empty()).unwrap_or(false) }

    /// The first chord bound to `id`, ready for a hint line. `None` when the id is unbound.
    pub fn display(&self, id: &str) -> Option<String> {
        self.keys_for(id).first().map(KeyId::display)
    }
}

/// pi's agent directory: `PI_CODING_AGENT_DIR` when set (the harness and tests use it), else
/// `~/.pi/agent`.
pub fn agent_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PI_CODING_AGENT_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    std::env::var("HOME").ok().map(|home| PathBuf::from(home).join(".pi/agent"))
}

pub fn keybindings_path() -> Option<PathBuf> {
    agent_dir().map(|dir| dir.join("keybindings.json"))
}

/// Parse the file's shape: `{"tui.editor.cursorUp": "ctrl+p", "tui.disable": ["ctrl+x", "ctrl+y"]}`.
/// Comments and trailing commas are not supported by pi either (it reads strict JSON through a schema).
fn parse_bindings(text: &str) -> BTreeMap<String, Vec<String>> {
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else { return out };
    let Some(object) = value.as_object() else { return out };
    for (id, entry) in object {
        let specs: Vec<String> = match entry {
            serde_json::Value::String(single) => vec![single.clone()],
            serde_json::Value::Array(items) => items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect(),
            _ => continue,
        };
        out.insert(id.clone(), specs);
    }
    out
}

/// Ids the user's file mentions that the client does not implement: reported once rather than
/// silently dropped, because a binding that does nothing is worse than a notice.
pub fn unknown_ids(path: &Path, known: &BTreeSet<&str>) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    parse_bindings(&text)
        .into_keys()
        .filter(|id| !known.contains(id.as_str()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(code: KeyCode, modifiers: KeyModifiers) -> KeyEvent {
        KeyEvent::new(code, modifiers)
    }

    #[test]
    fn a_chord_parses_with_modifiers_in_any_order() {
        let parsed = KeyId::parse("ctrl+shift+k").expect("a chord");
        assert!(parsed.ctrl && parsed.shift && !parsed.alt);
        assert_eq!(parsed.base, "k");
        let reversed = KeyId::parse("shift+ctrl+k").expect("a chord");
        assert_eq!(parsed, reversed);
    }

    #[test]
    fn defaults_match_pi() {
        let map = Keymap::default();
        assert!(map.matches(&key(KeyCode::Enter, KeyModifiers::NONE), "tui.input.submit"));
        assert!(map.matches(
            &key(KeyCode::Enter, KeyModifiers::SHIFT),
            "tui.input.newLine"
        ));
        assert!(map.matches(
            &key(KeyCode::Char('j'), KeyModifiers::CONTROL),
            "tui.input.newLine"
        ));
        assert!(map.matches(&key(KeyCode::Char('k'), KeyModifiers::CONTROL), "tui.editor.deleteToLineEnd"));
        // pi leaves history unbound.
        assert!(!map.has_binding("tui.editor.historyPrevious"));
        assert!(!map.matches(&key(KeyCode::Up, KeyModifiers::NONE), "tui.editor.historyPrevious"));
        assert!(map.matches(&key(KeyCode::Up, KeyModifiers::NONE), "tui.editor.cursorUp"));
    }

    #[test]
    fn a_user_binding_replaces_the_default_for_that_id() {
        let mut user = BTreeMap::new();
        user.insert("tui.editor.cursorUp".to_string(), vec!["ctrl+p".to_string()]);
        let map = Keymap::from_user(user);
        assert!(map.matches(&key(KeyCode::Char('p'), KeyModifiers::CONTROL), "tui.editor.cursorUp"));
        assert!(!map.matches(&key(KeyCode::Up, KeyModifiers::NONE), "tui.editor.cursorUp"));
    }

    #[test]
    fn two_ids_claiming_one_key_is_reported_as_a_conflict() {
        let mut user = BTreeMap::new();
        user.insert("tui.editor.cursorUp".to_string(), vec!["ctrl+x".to_string()]);
        user.insert("tui.editor.cursorDown".to_string(), vec!["ctrl+x".to_string()]);
        let map = Keymap::from_user(user);
        assert_eq!(map.conflicts.len(), 1);
        assert!(map.conflicts[0].contains("tui.editor.cursorUp"));
        assert!(map.conflicts[0].contains("tui.editor.cursorDown"));
        // Both still respond: pi reports the conflict, it does not pick a winner.
        assert!(map.matches(&key(KeyCode::Char('x'), KeyModifiers::CONTROL), "tui.editor.cursorUp"));
        assert!(map.matches(&key(KeyCode::Char('x'), KeyModifiers::CONTROL), "tui.editor.cursorDown"));
    }

    #[test]
    fn bindings_load_from_a_file_and_unknown_ids_are_listed() {
        let dir = std::env::temp_dir().join(format!("pi-tui-keymap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a temp dir");
        let path = dir.join("keybindings.json");
        std::fs::write(
            &path,
            r#"{"tui.input.submit": ["alt+enter"], "tui.editor.cursorLeft": "ctrl+b", "tui.nonsense.id": "ctrl+q"}"#,
        )
        .expect("a file");
        let map = Keymap::load_from(&path);
        assert!(map.matches(
            &key(KeyCode::Enter, KeyModifiers::ALT),
            "tui.input.submit"
        ));
        assert!(!map.matches(&key(KeyCode::Enter, KeyModifiers::NONE), "tui.input.submit"));
        let known: BTreeSet<&str> = default_bindings().into_iter().map(|(id, _)| id).collect();
        assert_eq!(unknown_ids(&path, &known), vec!["tui.nonsense.id".to_string()]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_malformed_file_falls_back_to_defaults() {
        let dir = std::env::temp_dir().join(format!("pi-tui-keymap-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a temp dir");
        let path = dir.join("keybindings.json");
        std::fs::write(&path, "{ not json").expect("a file");
        let map = Keymap::load_from(&path);
        assert!(map.matches(&key(KeyCode::Enter, KeyModifiers::NONE), "tui.input.submit"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
