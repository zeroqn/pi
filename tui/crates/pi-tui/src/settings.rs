//! pi's `settings.json`, read for the knobs the client honours.
//!
//! Ticket 04 of `.scratch/tui-rust-v2/map.md` brought the mouse and copy into the client, and both have
//! settings pi already publishes: `fullscreenWheelScrollLines`, `fullscreenCopyOnSelect`,
//! `fullscreenScrollbar`; ticket 05 added `autocompleteMaxVisible` and ticket 10 `showHardwareCursor`.
//! Defaults are pi's own (`pi/packages/coding-agent/docs/settings.md`).

use std::path::Path;

use serde_json::Value;

use crate::keymap::agent_dir;

/// How far one wheel event moves the window.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WheelLines {
    /// pi's `"auto"`: one line on a local macOS terminal (the OS already accelerated the delta), a few
    /// lines elsewhere so a fast spin is not ignored.
    Auto,
    Lines(u16),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Scrollbar {
    /// Visible for a second after motion, then gone (`scroll-view.ts:97-111`).
    Auto,
    /// A column reserved always, which re-wraps text by one cell.
    Always,
    Hidden,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Settings {
    pub wheel_lines: WheelLines,
    pub copy_on_select: bool,
    pub scrollbar: Scrollbar,
    pub list_rows: usize,
    pub hardware_cursor: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            wheel_lines: WheelLines::Auto,
            copy_on_select: true,
            scrollbar: Scrollbar::Auto,
            list_rows: 5,
            hardware_cursor: false,
        }
    }
}

impl Settings {
    /// pi's file in the agent directory, or the defaults when there is none.
    pub fn load() -> Settings {
        match agent_dir() {
            Some(dir) => Settings::load_from(&dir.join("settings.json")),
            None => Settings::default(),
        }
    }

    pub fn load_from(path: &Path) -> Settings {
        match std::fs::read_to_string(path) {
            Ok(text) => Settings::parse(&text),
            Err(_) => Settings::default(),
        }
    }

    /// Unknown keys are ignored: a setting the client does not honour must not stop it starting.
    pub fn parse(text: &str) -> Settings {
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return Settings::default();
        };
        let mut settings = Settings::default();
        match value.get("fullscreenWheelScrollLines") {
            Some(Value::String(word)) if word == "auto" => settings.wheel_lines = WheelLines::Auto,
            Some(Value::Number(n)) => {
                if let Some(lines) = n.as_u64() {
                    settings.wheel_lines = WheelLines::Lines(lines.min(50) as u16);
                }
            }
            _ => {}
        }
        if let Some(flag) = value.get("fullscreenCopyOnSelect").and_then(Value::as_bool) {
            settings.copy_on_select = flag;
        }
        match value.get("fullscreenScrollbar").and_then(Value::as_str) {
            Some("always") => settings.scrollbar = Scrollbar::Always,
            Some("hidden") => settings.scrollbar = Scrollbar::Hidden,
            Some("auto") => settings.scrollbar = Scrollbar::Auto,
            _ => {}
        }
        if let Some(rows) = value.get("autocompleteMaxVisible").and_then(Value::as_u64) {
            // pi's range is 3..20 (`autocomplete.ts`), clamped rather than rejected.
            settings.list_rows = (rows as usize).clamp(3, 20);
        }
        if let Some(flag) = value.get("showHardwareCursor").and_then(Value::as_bool) {
            settings.hardware_cursor = flag;
        }
        settings
    }

    /// How many rows one wheel event moves. `alt` is pi's fast path: five times as far.
    pub fn wheel_step(&self, alt: bool, local_macos: bool) -> isize {
        let lines = match self.wheel_lines {
            WheelLines::Auto => {
                if local_macos {
                    1
                } else {
                    3
                }
            }
            WheelLines::Lines(lines) => lines.max(1) as usize,
        };
        let lines = if alt { lines * 5 } else { lines };
        lines as isize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_with_nothing_the_client_knows_leaves_the_defaults() {
        assert_eq!(Settings::parse("{}"), Settings::default());
        assert_eq!(Settings::parse("not json"), Settings::default());
    }

    #[test]
    fn the_knobs_pi_publishes_are_read() {
        let settings = Settings::parse(
            r#"{"fullscreenWheelScrollLines": 2, "fullscreenCopyOnSelect": false,
                "fullscreenScrollbar": "always", "autocompleteMaxVisible": 12,
                "showHardwareCursor": true, "unknownKey": 1}"#,
        );
        assert_eq!(settings.wheel_lines, WheelLines::Lines(2));
        assert!(!settings.copy_on_select);
        assert_eq!(settings.scrollbar, Scrollbar::Always);
        assert_eq!(settings.list_rows, 12);
        assert!(settings.hardware_cursor);
    }

    #[test]
    fn the_list_row_cap_is_clamped_to_pis_range() {
        assert_eq!(Settings::parse(r#"{"autocompleteMaxVisible": 1}"#).list_rows, 3);
        assert_eq!(Settings::parse(r#"{"autocompleteMaxVisible": 99}"#).list_rows, 20);
    }

    #[test]
    fn auto_wheel_lines_are_one_on_a_local_macos_terminal_and_three_elsewhere() {
        let settings = Settings::default();
        assert_eq!(settings.wheel_step(false, true), 1);
        assert_eq!(settings.wheel_step(false, false), 3);
        assert_eq!(settings.wheel_step(true, false), 15, "alt moves five times as far");
        assert_eq!(Settings::parse(r#"{"fullscreenWheelScrollLines": 2}"#).wheel_step(false, true), 2);
    }
}
