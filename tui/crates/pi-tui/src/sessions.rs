//! The session picker's data: pi's session directory, read the way pi reads it.
//!
//! Ticket 06 of `.scratch/tui-rust-v2/map.md`: **no RPC command lists sessions** — `get_tree` and
//! `get_entries` describe the *current* one, and `switch_session` takes a path. So the client reads the
//! directory pi writes (`session-manager.ts:590`, `config.ts:674`):
//!
//! ```text
//! <agentDir>/sessions/--<cwd, slashes to dashes>--/<timestamp>_<uuid>.jsonl
//! ```
//!
//! pi's own list streams every file to build a search index over ten gigabytes of history; a picker
//! cannot. This reads the **first line** of each file (the session header) and takes the display name from
//! a `session_info` entry when one exists, so a directory of 800 sessions costs 800 small reads.

use std::path::{Path, PathBuf};

use serde_json::Value;

/// One row of the picker.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionRow {
    pub path: PathBuf,
    pub name: String,
    /// Seconds since the epoch, from the header or the file's own mtime.
    pub modified: u64,
    pub cwd: String,
}

/// pi's directory name for a working directory: non-leading separators and colons become dashes, wrapped
/// in double dashes (`session-manager.ts:590`).
pub fn dir_name(cwd: &Path) -> String {
    let text = cwd.to_string_lossy();
    let trimmed = text.trim_start_matches(['/', '\\']);
    let replaced: String = trimmed.chars().map(|ch| if ch == '/' || ch == '\\' || ch == ':' { '-' } else { ch }).collect();
    format!("--{replaced}--")
}

/// The sessions for this working directory, newest first. A missing directory is an empty list, not an
/// error: the first session of a fresh install has nowhere to come from.
pub fn list(agent_dir: &Path, cwd: &Path) -> Vec<SessionRow> {
    let dir = agent_dir.join("sessions").join(dir_name(cwd));
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut rows: Vec<SessionRow> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        if let Some(row) = read_header(&path) {
            rows.push(row);
        }
    }
    rows.sort_by(|a, b| b.modified.cmp(&a.modified));
    rows
}

/// The first line of a session file, plus its display name if one was set.
fn read_header(path: &Path) -> Option<SessionRow> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut lines = text.lines();
    let header: Value = serde_json::from_str(lines.next()?).ok()?;
    if header.get("type").and_then(Value::as_str) != Some("session") {
        return None;
    }
    let cwd = header.get("cwd").and_then(Value::as_str).unwrap_or("").to_string();
    let stamp = header
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|text| text.get(..10))
        .unwrap_or("")
        .to_string();
    let mut name = stamp.clone();
    // A `session_info` entry carries the name the user gave it; it may be anywhere after the header.
    for line in lines.take(400) {
        let Ok(value) = serde_json::from_str::<Value>(line) else { continue };
        if value.get("type").and_then(Value::as_str) == Some("session_info") {
            if let Some(title) = value.get("name").and_then(Value::as_str) {
                if !title.is_empty() {
                    name = format!("{stamp}  {title}");
                }
            }
            break;
        }
    }
    let modified = std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|delta| delta.as_secs())
        .unwrap_or(0);
    Some(SessionRow { path: path.to_path_buf(), name, modified, cwd })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_directory_name_is_pis_own_encoding() {
        assert_eq!(dir_name(Path::new("/workspace/pi")), "--workspace-pi--");
        assert_eq!(dir_name(Path::new("/a/b/c")), "--a-b-c--");
        // pi replaces each of `/`, `\\` and `:` with a dash after stripping a leading separator
        // (`session-manager.ts:590`), so a drive letter and its colon give two dashes, not one.
        assert_eq!(dir_name(Path::new("C:\\src")), "--C--src--");
    }

    #[test]
    fn a_session_directory_yields_its_sessions_newest_first() {
        let root = std::env::temp_dir().join(format!("pi-tui-sessions-{}", std::process::id()));
        let cwd = Path::new("/workspace/demo");
        let dir = root.join("sessions").join(dir_name(cwd));
        std::fs::create_dir_all(&dir).expect("a directory");
        let header = |stamp: &str| {
            format!(r#"{{"type":"session","id":"{stamp}","timestamp":"{stamp}","cwd":"/workspace/demo"}}"#)
        };
        std::fs::write(dir.join("old.jsonl"), format!("{}\n{}", header("2026-11-01T09:00:00Z"), r#"{"type":"session_info","name":"harvest"}"#)).unwrap();
        std::fs::write(dir.join("new.jsonl"), format!("{}\n", header("2026-11-20T10:00:00Z"))).unwrap();
        std::fs::write(dir.join("not-a-session.txt"), "ignore me").unwrap();

        let rows = list(&root, cwd);
        assert_eq!(rows.len(), 2, "only .jsonl files, only session headers");
        let names: Vec<&str> = rows.iter().map(|row| row.name.as_str()).collect();
        assert!(names.iter().any(|name| name.contains("harvest")), "the display name is read: {names:?}");
        assert_eq!(rows[0].cwd, "/workspace/demo");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_missing_directory_is_an_empty_list() {
        let root = std::env::temp_dir().join("pi-tui-sessions-absent");
        assert!(list(&root, Path::new("/nowhere")).is_empty());
    }

    #[test]
    fn a_file_whose_first_line_is_not_a_header_is_skipped() {
        let root = std::env::temp_dir().join(format!("pi-tui-sessions-bad-{}", std::process::id()));
        let cwd = Path::new("/workspace/bad");
        let dir = root.join("sessions").join(dir_name(cwd));
        std::fs::create_dir_all(&dir).expect("a directory");
        std::fs::write(dir.join("x.jsonl"), "{\"type\":\"message\"}\n").unwrap();
        assert!(list(&root, cwd).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }
}
