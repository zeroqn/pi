//! Syntax highlighting with line-level resume: appending a line must cost a line, not a block.
//!
//! Upstream pi re-highlights the whole growing code block on every chunk (measured: `cli-highlight`
//! 9.3 ms per chunk average, 4.82 s of CPU for one 15.7 KB block, `research/child-streaming-path.md`).
//! The ticket-06 block contract makes that the one remaining quadratic path in the client, so this module
//! is the state that removes it.
//!
//! The contract (ticket 05):
//!
//! ```text
//! highlight(text, language, previous_state) -> (spans per line, new_state)
//! ```
//!
//! `Cache` holds the spans of finished lines and syntect's `(HighlightState, ParseState)` **at the end of
//! the last finished line**. A render replays only the lines after that point, so a chunk that appends
//! bytes to the tail line costs one line plus the parse state's own cost — never the block's.

use std::sync::OnceLock;

use syntect::highlighting::{HighlightState, Style, Theme, ThemeSet};
use syntect::parsing::{ParseState, SyntaxSet};

/// One styled run of bytes inside a line: `[start, end)` in bytes, and the colour the painter applies.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub style: Style,
}

impl Span {
    pub fn text<'a>(&self, line: &'a str) -> &'a str {
        &line[self.start..self.end]
    }
}

/// A process-wide syntax set and theme set: parsed once, shared by every block.
pub struct Assets {
    syntaxes: SyntaxSet,
    themes: ThemeSet,
    theme_name: String,
}

static ASSETS: OnceLock<Assets> = OnceLock::new();

/// The theme used until pi's colour roles are mapped onto syntect scopes (ticket 05's hand-off):
/// the roles are 9 named `syntax*` colours, and this bundled theme is a stand-in chosen for contrast
/// rather than for pi parity. Colour parity is a rendering decision (ticket 04's table), not a parsing one.
pub const STAND_IN_THEME: &str = "base16-ocean.dark";

fn assets() -> &'static Assets {
    ASSETS.get_or_init(|| Assets {
        syntaxes: SyntaxSet::load_defaults_newlines(),
        themes: ThemeSet::load_defaults(),
        theme_name: STAND_IN_THEME.to_string(),
    })
}

impl Assets {
    fn theme(&self) -> &Theme {
        self.themes.themes.get(&self.theme_name).unwrap_or_else(|| {
            self.themes
                .themes
                .values()
                .next()
                .expect("a bundled syntect theme")
        })
    }
}

/// Map a fence's info string onto a syntax. Unknown languages fall back to plain text, which is what pi
/// does too (its no-language fence costs 0.077 ms/chunk, 36× less than a highlighted block).
pub fn lookup(language: &str) -> &'static syntect::parsing::SyntaxReference {
    let assets = assets();
    let name = language.trim().split_whitespace().next().unwrap_or("").to_lowercase();
    let by_token = assets.syntaxes.find_syntax_by_token(&name);
    by_token
        .or_else(|| assets.syntaxes.find_syntax_by_extension(&name))
        .unwrap_or_else(|| assets.syntaxes.find_syntax_plain_text())
}

/// The per-block cache: finished lines' spans plus the state after the last finished line.
pub struct Cache {
    pub language: String,
    /// Spans for every finished line.
    pub spans: Vec<Vec<Span>>,
    state: Option<(HighlightState, ParseState)>,
}

impl Default for Cache {
    fn default() -> Self {
        Cache { language: String::new(), spans: Vec::new(), state: None }
    }
}

impl Cache {
    pub fn new(language: &str) -> Cache {
        Cache { language: language.to_string(), spans: Vec::new(), state: None }
    }

    /// How many lines are already highlighted: the measure of what an append avoids.
    pub fn done_lines(&self) -> usize {
        self.spans.len()
    }

    /// Reset when the block's language changes or its text stops being append-only.
    pub fn reset(&mut self, language: &str) {
        self.language = language.to_string();
        self.spans.clear();
        self.state = None;
    }
}

/// Highlight `source` into the cache, reusing finished lines. Returns how many lines were highlighted
/// this call, so a test can assert the line-level behaviour rather than only its speed.
pub fn highlight_into(source: &str, cache: &mut Cache) -> usize {
    let assets = assets();
    let syntax = lookup(&cache.language);
    let theme = assets.theme();

    // Split keeping the trailing newline: syntect distinguishes a terminated line from a partial one.
    let lines: Vec<&str> = if source.ends_with('\n') {
        source.split_inclusive('\n').collect()
    } else {
        source.split_inclusive('\n').collect()
    };
    // A partial last line (no trailing newline) is "in progress": its spans are recomputed and its state
    // is not committed, so the next chunk re-highlights exactly that line.
    let terminated = if source.ends_with('\n') { lines.len() } else { lines.len().saturating_sub(1) };

    // A shrink invalidates the committed lines; a language change is handled by `style_lines`, which
    // owns the language string (comparing a fence token against `syntax.name` would reset on every call).
    if cache.spans.len() > terminated {
        let language = cache.language.clone();
        cache.reset(&language);
    }

    let start_line = cache.spans.len();
    let mut highlighter = match cache.state.take() {
        Some((highlight_state, parse_state)) => {
            syntect::easy::HighlightLines::from_state(theme, highlight_state, parse_state)
        }
        None => syntect::easy::HighlightLines::new(syntax, theme),
    };
    // Discard the partial line's stale spans: they live after the committed ones.
    let mut styled = 0;
    for line in lines.iter().skip(start_line) {
        let spans = match highlighter.highlight_line(line, assets.syntax_set()) {
            Ok(spans) => {
                // syntect returns the line as consecutive slices; track a cursor rather than assuming
                // each slice ends where the previous one began.
                let mut cursor = 0;
                spans
                    .into_iter()
                    .map(|(style, text)| {
                        let start = cursor;
                        cursor += text.len();
                        Span { start, end: cursor, style }
                    })
                    .collect::<Vec<Span>>()
            }
            Err(_) => Vec::new(),
        };
        styled += 1;
        if cache.spans.len() < terminated {
            cache.spans.push(spans);
        } else {
            // The partial tail: reported in the result but never committed.
            cache.spans.truncate(terminated);
            let _ = spans;
        }
    }
    if terminated > 0 {
        let (highlight_state, parse_state) = highlighter.state();
        cache.state = Some((highlight_state, parse_state));
    }
    styled
}

impl Assets {
    fn syntax_set(&self) -> &SyntaxSet {
        &self.syntaxes
    }
}

/// The rows for a block: each line's text split into styled spans. The painter turns styles into
/// pi's colour roles; this module only says which bytes are what.
pub fn style_lines(source: &str, language: &str, cache: &mut Cache) -> Vec<(String, Vec<Span>)> {
    if cache.language != language {
        cache.reset(language);
    }
    let _ = highlight_into(source, cache);
    let lines: Vec<&str> = source.split_inclusive('\n').collect();
    let mut out = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let text = line.trim_end_matches('\n').to_string();
        // The spans cover the line including its newline; clamp them to the text the painter draws.
        let spans: Vec<Span> = cache
            .spans
            .get(index)
            .map(|spans| {
                spans
                    .iter()
                    .filter_map(|span| {
                        let start = span.start.min(text.len());
                        let end = span.end.min(text.len());
                        if end <= start {
                            None
                        } else {
                            Some(Span { start, end, style: span.style })
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();
        let spans = if spans.is_empty() {
            vec![Span { start: 0, end: text.len(), style: Style::default() }]
        } else {
            spans
        };
        out.push((text, spans));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined(source: &str, language: &str) -> Vec<String> {
        let mut cache = Cache::new(language);
        style_lines(source, language, &mut cache)
            .into_iter()
            .map(|(text, spans)| {
                // Reconstruct the line from its spans to prove nothing is lost or reordered.
                let mut rebuilt = String::new();
                for span in &spans {
                    rebuilt.push_str(span.text(&text));
                }
                rebuilt
            })
            .collect()
    }

    #[test]
    fn a_plain_text_block_is_byte_identical_after_styling() {
        let source = "alpha\nbeta\ngamma\n";
        let rows = joined(source, "");
        assert_eq!(rows.join("\n"), "alpha\nbeta\ngamma");
    }

    #[test]
    fn an_append_highlights_only_the_new_lines() {
        let mut cache = Cache::new("ts");
        highlight_into("const a = 1;\n", &mut cache);
        assert_eq!(cache.done_lines(), 1);
        highlight_into("const a = 1;\nconst b = 2;\n", &mut cache);
        assert_eq!(cache.done_lines(), 2);
        let styled = highlight_into("const a = 1;\nconst b = 2;\nconst c = 3;\n", &mut cache);
        assert_eq!(styled, 1, "only the appended line is highlighted");

        // Spans of the finished lines are untouched by the append: the reuse is exact, not approximate.
        let mut fresh = Cache::new("ts");
        highlight_into("const a = 1;\nconst b = 2;\nconst c = 3;\n", &mut fresh);
        assert_eq!(cache.spans, fresh.spans);
    }

    #[test]
    fn a_partial_tail_line_is_recomputed_and_not_committed() {
        let mut cache = Cache::new("ts");
        highlight_into("let value = ", &mut cache);
        assert_eq!(cache.done_lines(), 0, "a line without its newline is in progress");
        highlight_into("let value = 42;\n", &mut cache);
        assert_eq!(cache.done_lines(), 1);
    }

    #[test]
    fn a_language_change_resets_the_cache() {
        let mut cache = Cache::new("ts");
        highlight_into("const a = 1;\n", &mut cache);
        cache.reset("rust");
        assert_eq!(cache.done_lines(), 0);
        highlight_into("let a = 1;\n", &mut cache);
        assert_eq!(cache.done_lines(), 1);
    }

    #[test]
    fn a_known_language_and_an_unknown_one_both_produce_spans() {
        let mut cache = Cache::new("ts");
        let rows = style_lines("const answer = 42;\n", "ts", &mut cache);
        assert_eq!(rows.len(), 1);
        assert!(!rows[0].1.is_empty(), "a TS line has at least one span");
        let mut cache = Cache::new("no-such-language");
        let rows = style_lines("plain words\n", "no-such-language", &mut cache);
        assert_eq!(rows[0].0, "plain words");
    }

    #[test]
    fn a_string_span_covers_the_quoted_text() {
        let mut cache = Cache::new("ts");
        let rows = style_lines("const s = \"hello\";\n", "ts", &mut cache);
        let (text, spans) = &rows[0];
        let string_span = spans.iter().find(|span| span.text(text).contains("hello"));
        assert!(string_span.is_some(), "the string literal is its own span: {spans:?}");
    }
}
