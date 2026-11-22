
//! PROTOTYPE (throwaway) for wayfinder ticket 05: the dialog surface.
//!
//! Renders four list skins from one widget shape, as plain text, so the layout can be argued about
//! before anything is built. Run with `cargo run --example dialog_skins`.
//!
//! Not production code: no theme, no ANSI, no key handling, no state machine.

struct Item<'a> {
    label: &'a str,
    right: &'a str,
}

struct ListDialog<'a> {
    title: Option<&'a str>,
    filter: Option<&'a str>,
    items: Vec<Item<'a>>,
    cursor: usize,
    max_visible: usize,
    hint: &'a str,
    /// Width of the label column, 0 = no description column.
    label_width: usize,
}

impl<'a> ListDialog<'a> {
    fn rows(&self, width: usize) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(title) = self.title {
            out.push(format!(" {title}"));
        }
        if let Some(filter) = self.filter {
            out.push(format!(" Filter: {filter}_"));
        }
        if self.items.is_empty() {
            out.push("   No matching entries".to_string());
            return out;
        }
        // pi's window: centred on the cursor, `(i/n)` when clipped (select-list.ts:95-108).
        let start = self.cursor.saturating_sub(self.max_visible / 2).min(self.items.len().saturating_sub(self.max_visible));
        let end = (start + self.max_visible).min(self.items.len());
        for (index, item) in self.items.iter().enumerate().skip(start).take(end - start) {
            let marker = if index == self.cursor { ">" } else { " " };
            let label = if self.label_width == 0 {
                item.label.to_string()
            } else {
                format!("{:<w$}  {}", item.label, item.right, w = self.label_width)
            };
            out.push(fit(&format!(" {marker} {label}"), width));
        }
        if start > 0 || end < self.items.len() {
            out.push(format!("     ({}/{})", self.cursor + 1, self.items.len()));
        }
        out.push(format!(" {}", self.hint));
        out
    }
}

/// Truncate to `width` cells with an ellipsis, so a prototype dump never wraps.
fn fit(text: &str, width: usize) -> String {
    if text.chars().count() <= width {
        return text.to_string();
    }
    let keep = width.saturating_sub(1);
    text.chars().take(keep).collect::<String>() + "…"
}

fn main() {
    let width = 72;

    let models = ListDialog {
        title: Some("Select model"),
        filter: None,
        items: vec![
            Item { label: "claude-sonnet-4.5", right: "thinking: high" },
            Item { label: "claude-haiku-4.5", right: "thinking: low" },
            Item { label: "gpt-5.2-codex", right: "thinking: medium" },
            Item { label: "o4-mini", right: "thinking: off" },
            Item { label: "gemini-3-flash", right: "thinking: high" },
            Item { label: "claude-opus-4.6", right: "thinking: max" },
        ],
        cursor: 2,
        max_visible: 5,
        hint: "[enter] choose   [esc] cancel   [ctrl+p] cycle",
        label_width: 24,
    };

    let sessions = ListDialog {
        title: Some("Resume a session"),
        filter: Some("view"),
        items: vec![
            Item { label: "2026-11-22 02:10  viewport", right: "84 msgs" },
            Item { label: "2026-11-21 18:02  v2 map", right: "31 msgs" },
            Item { label: "2026-11-21 09:14  harvest", right: "212 msgs" },
            Item { label: "2026-11-20 22:40  tui-rust v1", right: "406 msgs" },
        ],
        cursor: 1,
        max_visible: 5,
        hint: "[enter] open   [ctrl+r] rename   [esc] cancel",
        label_width: 30,
    };

    let commands = ListDialog {
        title: None,
        filter: Some("mo"),
        items: vec![
            Item { label: "/model", right: "switch the model" },
            Item { label: "/models", right: "model scope and order" },
            Item { label: "/compact", right: "compress the context" },
            Item { label: "/copy", right: "copy the last answer" },
        ],
        cursor: 0,
        max_visible: 5,
        hint: "[enter] run   [tab] complete   [esc] cancel",
        label_width: 12,
    };

    let completion = ListDialog {
        title: None,
        filter: None,
        items: vec![
            Item { label: "src/model.rs", right: "" },
            Item { label: "src/markdown.rs", right: "" },
            Item { label: "src/main.rs", right: "" },
            Item { label: "src/mount.rs", right: "" },
            Item { label: "src/moved.rs", right: "" },
        ],
        cursor: 1,
        max_visible: 5,
        hint: "[tab] accept   [esc] dismiss",
        label_width: 0,
    };

    for (name, dialog) in [
        ("model picker", &models),
        ("session picker", &sessions),
        ("command palette", &commands),
        ("completion popup", &completion),
    ] {
        println!("--- {name} ---");
        for row in dialog.rows(width) {
            println!("{row}");
        }
        println!();
    }

    // The same palette with the composer acting as the filter line (variant B).
    println!("--- command palette, composer as filter (variant B) ---");
    let palette_b = ListDialog {
        title: None,
        filter: None,
        items: vec![
            Item { label: "/model", right: "switch the model" },
            Item { label: "/models", right: "model scope and order" },
            Item { label: "/compact", right: "compress the context" },
            Item { label: "/copy", right: "copy the last answer" },
        ],
        cursor: 0,
        max_visible: 5,
        hint: "[enter] run   [tab] complete   [esc] cancel",
        label_width: 12,
    };
    for row in palette_b.rows(width) {
        println!("{row}");
    }
    println!(" > /mo_");
}
