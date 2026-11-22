//! The command palette: pi's built-in slash commands, and how each one is routed.
//!
//! Ticket 08 of `.scratch/tui-rust-v2/map.md`. `get_commands` returns **only** extension commands,
//! prompt templates and skills (`rpc-mode.ts:692`, payload `{name, description?, source, sourceInfo}`),
//! so the palette is the **union** of that payload and this table: `BUILTIN_SLASH_COMMANDS` in pi
//! (`core/slash-commands.ts:19`) never appears in `get_commands`.
//!
//! Every payload entry is dispatched as **prompt text** — `prompt "/<name> <args>"` already runs
//! extension commands and expands prompt templates (`agent-session.ts:2187`) — so only a built-in can
//! have a dedicated route. Nine built-ins have no RPC operation at all and are recorded as unsupported
//! rather than hidden: a palette that silently omits `/share` looks broken.

/// What Enter does with an entry.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Route {
    /// Send the text as a prompt and let the host expand it.
    Prompt,
    /// Call the RPC command with this name.
    Command(&'static str),
    /// The client handles it (copy, quit, hotkeys).
    Client(&'static str),
    /// No RPC operation carries it (ticket 08's deferred nine).
    Unsupported,
}

#[derive(Clone, Copy, Debug)]
pub struct Builtin {
    pub name: &'static str,
    pub description: &'static str,
    pub route: Route,
}

/// pi's **24** built-ins with the route the client gives each (`core/slash-commands.ts:19`; the map
/// said 25, which the counted test below disproved).
pub const BUILTINS: &[Builtin] = &[
    Builtin { name: "settings", description: "Open settings menu", route: Route::Unsupported },
    Builtin { name: "model", description: "Select model (opens the picker)", route: Route::Client("model") },
    Builtin { name: "tree", description: "Show the session tree", route: Route::Client("tree") },
    Builtin { name: "thinking", description: "Cycle the thinking level", route: Route::Client("thinking") },
    Builtin { name: "scoped-models", description: "Enable/disable models for cycling", route: Route::Unsupported },
    Builtin { name: "export", description: "Export the session (HTML)", route: Route::Command("export_html") },
    Builtin { name: "import", description: "Import a JSONL session", route: Route::Unsupported },
    Builtin { name: "share", description: "Share the session", route: Route::Unsupported },
    Builtin { name: "bug", description: "Report a bug to the pi developers", route: Route::Unsupported },
    Builtin { name: "copy", description: "Copy the last agent message", route: Route::Client("copy") },
    Builtin { name: "name", description: "Set the session display name", route: Route::Client("name") },
    Builtin { name: "session", description: "Show session info and stats", route: Route::Command("get_session_stats") },
    Builtin { name: "changelog", description: "Show changelog entries", route: Route::Unsupported },
    Builtin { name: "hotkeys", description: "Show every keyboard shortcut", route: Route::Client("hotkeys") },
    Builtin { name: "fork", description: "Fork from an earlier message", route: Route::Client("fork") },
    Builtin { name: "clone", description: "Duplicate the session here", route: Route::Command("clone") },
    Builtin { name: "trust", description: "Save a project trust decision", route: Route::Unsupported },
    Builtin { name: "login", description: "Configure provider authentication", route: Route::Unsupported },
    Builtin { name: "logout", description: "Remove provider authentication", route: Route::Unsupported },
    Builtin { name: "new", description: "Start a new session", route: Route::Command("new_session") },
    Builtin { name: "compact", description: "Compact the session context", route: Route::Command("compact") },
    Builtin { name: "resume", description: "Resume another session", route: Route::Client("resume") },
    Builtin { name: "reload", description: "Reload extensions, skills and themes", route: Route::Unsupported },
    Builtin { name: "quit", description: "Quit the client", route: Route::Client("quit") },
];

/// One palette row: a built-in or a payload entry, and what to do with it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub description: String,
    pub route: Route,
}

/// The palette's entries: the payload's commands first (the session's own, which a reader looks for
/// most), then pi's built-ins. Names collide only if an extension takes a built-in's name, and pi
/// dispatches the extension first, so the payload wins.
pub fn entries(extension_commands: &[String], extension_descriptions: &[String]) -> Vec<Entry> {
    let mut out: Vec<Entry> = Vec::new();
    for (index, name) in extension_commands.iter().enumerate() {
        out.push(Entry {
            name: format!("/{name}"),
            description: extension_descriptions.get(index).cloned().unwrap_or_default(),
            route: Route::Prompt,
        });
    }
    for builtin in BUILTINS {
        let name = format!("/{}", builtin.name);
        if out.iter().any(|entry| entry.name == name) {
            continue;
        }
        out.push(Entry { name, description: builtin.description.to_string(), route: builtin.route });
    }
    out
}

/// The entries a typed prefix matches, in palette order. `startsWith` on the name, pi's rule for a
/// select list (`select-list.ts:62-67`) rather than the fuzzy rule the model picker uses.
pub fn filtered<'a>(entries: &'a [Entry], prefix: &str) -> Vec<&'a Entry> {
    let needle = prefix.trim_start_matches('/').to_lowercase();
    entries
        .iter()
        .filter(|entry| {
            needle.is_empty() || entry.name.trim_start_matches('/').to_lowercase().starts_with(&needle)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_builtin_pi_ships_is_in_the_table() {
        // pi's list is **24** entries (`core/slash-commands.ts:19`), counted from the source. Ticket 08 and
        // the map said 25: that was wrong, and a count asserted here is what caught it.
        assert_eq!(BUILTINS.len(), 24);
        assert!(BUILTINS.iter().any(|builtin| builtin.name == "compact"));
        assert!(BUILTINS.iter().any(|builtin| builtin.name == "quit"));
    }

    #[test]
    fn a_payload_entry_is_dispatched_as_prompt_text() {
        let entries = entries(&["deploy".to_string()], &["Run the deploy".to_string()]);
        let deploy = entries.iter().find(|entry| entry.name == "/deploy").expect("the payload entry");
        assert_eq!(deploy.route, Route::Prompt, "`prompt` already runs extension commands");
        assert_eq!(deploy.description, "Run the deploy");
    }

    #[test]
    fn a_payload_command_wins_a_name_clash_with_a_builtin() {
        let entries = entries(&["compact".to_string()], &["An extension's compact".to_string()]);
        let compact = entries.iter().filter(|entry| entry.name == "/compact").collect::<Vec<_>>();
        assert_eq!(compact.len(), 1, "one row per name");
        assert_eq!(compact[0].route, Route::Prompt, "pi dispatches the extension first");
    }

    #[test]
    fn the_ten_without_an_rpc_operation_are_marked_unsupported() {
        let entries = entries(&[], &[]);
        for name in ["/settings", "/import", "/share", "/bug", "/trust", "/login", "/logout", "/changelog", "/reload", "/scoped-models"] {
            let entry = entries.iter().find(|entry| entry.name == name).expect(name);
            assert_eq!(entry.route, Route::Unsupported, "{name} has no RPC operation");
        }
    }

    #[test]
    fn filtering_is_a_prefix_match_on_the_name() {
        let entries = entries(&[], &[]);
        let rows = filtered(&entries, "/mo");
        let names: Vec<&str> = rows.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, vec!["/model"], "`/model` starts with `mo`, `/compact` does not");
        assert_eq!(filtered(&entries, "/").len(), entries.len(), "a bare slash lists everything");
        assert!(filtered(&entries, "/zzz").is_empty());
    }
}
