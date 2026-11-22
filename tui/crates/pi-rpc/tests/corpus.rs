//! The recorded corpus, parsed: the wire's shape is a test, not a hope.
//!
//! Fixtures come from `extensions/tui/tools/harness/record_corpus.py`, which drives `pi --mode rpc`
//! over its pipes and writes every stdout line unedited. Re-record (`--only ...`) and this test tells
//! you exactly what pi changed.
//!
//! The fixtures live outside this repo's tracked tree (`.scratch/tui-rust/fixtures/`), so the test
//! that needs them skips when they are absent; a fixture that IS present must parse cleanly.

use std::path::{Path, PathBuf};

use serde_json::Value;

const SCENARIOS: &[&str] = &["text", "code", "tool", "compact", "dialog"];

fn fixtures_dir() -> PathBuf {
    // crates/pi-rpc -> crates -> tui -> extensions -> repo root
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .expect("a workspace root above the crate")
        .join(".scratch/tui-rust/fixtures")
}

/// Whether a missing corpus is a failure. The fixtures are recorded artifacts and live outside the
/// tracked tree, so a checkout without them skips; a run that means to verify the wire sets
/// `PI_RPC_REQUIRE_CORPUS=1` and then a missing fixture fails loudly instead of passing empty.
fn corpus_required() -> bool {
    std::env::var_os("PI_RPC_REQUIRE_CORPUS").is_some()
}

fn read_lines(path: &Path) -> Vec<Value> {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).unwrap_or_else(|e| panic!("{}: {e}\n{line}", path.display())))
        .collect()
}

#[test]
fn every_recorded_line_is_understood() {
    let dir = fixtures_dir();
    if !dir.is_dir() {
        let message = format!("no fixtures at {} — record them with tools/harness/record_corpus.py", dir.display());
        assert!(!corpus_required(), "{message}");
        eprintln!("{message}");
        return;
    }
    let mut problems = Vec::new();
    let mut types = std::collections::BTreeSet::new();
    let mut lines_seen = 0;
    for scenario in SCENARIOS {
        let path = dir.join(format!("{scenario}.jsonl"));
        if !path.is_file() {
            problems.push(format!("{} is missing", path.display()));
            continue;
        }
        for (index, value) in read_lines(&path).into_iter().enumerate() {
            lines_seen += 1;
            if let Some(kind) = value.get("type").and_then(Value::as_str) {
                types.insert(kind.to_string());
            }
            for problem in pi_rpc::problems(&value) {
                problems.push(format!("{scenario}.jsonl:{} {problem}", index + 1));
            }
        }
    }
    assert_eq!(problems, Vec::<String>::new(), "the corpus has lines the client cannot interpret");
    // A guard against empty or truncated fixtures: the recording covers the event families a client
    // needs, or it is not the corpus this test is meant to defend.
    assert!(lines_seen > 400, "only {lines_seen} lines recorded");
    for required in [
        "agent_start",
        "agent_settled",
        "message_start",
        "message_end",
        "message_update",
        "tool_execution_start",
        "tool_execution_update",
        "tool_execution_end",
        "compaction_start",
        "compaction_end",
        "extension_ui_request",
        "response",
    ] {
        assert!(types.contains(required), "{required} is not in the corpus (have {types:?})");
    }
}

#[test]
fn the_dialog_fixture_covers_every_method_rpc_serves() {
    let path = fixtures_dir().join("dialog.jsonl");
    if !path.is_file() {
        assert!(!corpus_required(), "no dialog fixture at {}", path.display());
        eprintln!("no dialog fixture at {}", path.display());
        return;
    }
    let mut methods = std::collections::BTreeSet::new();
    for value in read_lines(&path) {
        if value.get("type").and_then(Value::as_str) == Some("extension_ui_request") {
            if let Some(method) = value.get("method").and_then(Value::as_str) {
                methods.insert(method.to_string());
            }
        }
    }
    let expected: std::collections::BTreeSet<String> = pi_rpc::inventory::UI_METHODS.iter().map(|m| m.to_string()).collect();
    assert_eq!(methods, expected, "the dialog fixture must exercise every method the client answers or shows");
}

#[test]
fn the_code_fixture_streams_a_fenced_block() {
    let path = fixtures_dir().join("code.jsonl");
    if !path.is_file() {
        assert!(!corpus_required(), "no code fixture at {}", path.display());
        eprintln!("no code fixture at {}", path.display());
        return;
    }
    let mut text = String::new();
    for value in read_lines(&path) {
        if value.get("type").and_then(Value::as_str) == Some("message_update") {
            if let Some(delta) = value
                .get("assistantMessageEvent")
                .and_then(|event| event.get("delta"))
                .and_then(Value::as_str)
            {
                text.push_str(delta);
            }
        }
    }
    assert!(text.contains("```ts"), "the code fixture must carry a fenced ts block");
    assert!(text.contains("```\n") || text.matches("```").count() >= 2, "the fence must close");
}
