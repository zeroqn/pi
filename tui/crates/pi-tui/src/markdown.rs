//! Streaming markdown: split the answer into blocks, parse only the block that can still change.
//!
//! Why: upstream pi re-lexes the whole accumulated answer on every chunk — its cache keys on the
//! full source string (`pi/packages/tui/src/markdown.ts:393-400`) — which is quadratic in the answer
//! (2.64 ms/chunk at 26.9 KB, worst chunk 26.5 ms, measured in `research/child-streaming-path.md`).
//! Only the *last* block is ever re-styled there too (`markdown.ts:412-417`), so the fix is to make that
//! structural rather than incidental.
//!
//! The model here is a **block list with a stable prefix**: every block but the last is frozen once its
//! terminator has been seen, and the last ("open") block is re-parsed on every append. That makes per-chunk
//! cost a function of the *open block's* size, not the answer's — which is the contract ticket 05's
//! highlighter hangs off, and what `acceptance.md` C-5 measures.
//!
//! Block boundaries are deliberately conservative: a blank line outside a fence ends a block, and a fence
//! that has not been closed stays a fence (so a streamed code block never flickers back into prose).

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

/// One rendered block: the source it came from (for the prefix check) and its styled lines.
#[derive(Clone, Debug)]
pub struct Block {
    /// The block's source text, terminator included.
    pub source: String,
    /// Rendered rows, already wrapped-free: the painter wraps.
    pub lines: Vec<String>,
    /// Whether this block is still open (its terminator has not been seen).
    pub open: bool,
}

/// A block's span in the source: `[start, end)`.
fn split_blocks(source: &str) -> Vec<(usize, usize, bool)> {
    let mut spans: Vec<(usize, usize, bool)> = Vec::new();
    let mut start = 0;
    let mut offset = 0;
    let mut in_fence = false;
    let mut fence_marker = String::new();
    for line in source.split_inclusive('\n') {
        let trimmed = line.trim_end_matches('\n');
        let lead = trimmed.trim_start();
        if in_fence {
            if lead.starts_with(&fence_marker) && lead.trim_end() == fence_marker {
                in_fence = false;
                // The closing fence ends the block, trailing blank line or not.
                spans.push((start, offset + line.len(), false));
                start = offset + line.len();
            }
        } else if lead.starts_with("```") || lead.starts_with("~~~") {
            in_fence = true;
            fence_marker = if lead.starts_with("```") { "```".to_string() } else { "~~~".to_string() };
        } else if trimmed.trim().is_empty() && offset > start {
            // A blank line outside a fence ends a block. It belongs to the block it follows, so the
            // block's source is exactly what was parsed and the next block starts clean.
            spans.push((start, offset + line.len(), false));
            start = offset + line.len();
        }
        offset += line.len();
    }
    let tail = &source[start..];
    if !tail.trim().is_empty() {
        // Whatever is left is the open block; a fence left open stays open and renders as code.
        spans.push((start, source.len(), true));
    }
    spans
}

/// Render one block's source into rows. Only what the prototype needs to be honest about cost is
/// rendered: headings, fences, lists, quotes, rules, emphasis-as-text. Ticket 05 adds colour and the
/// full construct set; the *cost model* is what this module proves.
pub fn render_block(source: &str) -> Vec<String> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_code_block = false;
    #[allow(unused_assignments)]
    let mut code_language = String::new();
    let mut list_depth = 0usize;
    let mut quote_depth = 0usize;
    let mut pending_link: Option<String> = None;

    let flush = |out: &mut Vec<String>, current: &mut String| {
        if !current.is_empty() {
            out.push(std::mem::take(current));
        }
    };

    for event in Parser::new_ext(source, options) {
        match event {
            Event::Start(Tag::CodeBlock(kind)) => {
                flush(&mut out, &mut current);
                in_code_block = true;
                code_language = match kind {
                    pulldown_cmark::CodeBlockKind::Fenced(info) => info.trim().to_string(),
                    pulldown_cmark::CodeBlockKind::Indented => String::new(),
                };
                out.push(if code_language.is_empty() {
                    "```".to_string()
                } else {
                    format!("```{code_language}")
                });
            }
            Event::End(TagEnd::CodeBlock) => {
                in_code_block = false;
                out.push("```".to_string());
            }
            Event::Start(Tag::Heading { level, .. }) => {
                flush(&mut out, &mut current);
                let marks = "#".repeat(level as usize);
                current.push_str(&format!("{marks} "));
            }
            Event::Start(Tag::List(_)) => {
                flush(&mut out, &mut current);
                list_depth += 1;
            }
            Event::End(TagEnd::List(_)) => {
                list_depth = list_depth.saturating_sub(1);
            }
            Event::Start(Tag::Item) => {
                flush(&mut out, &mut current);
                current.push_str(&format!("{} ", if list_depth > 1 { "-" } else { "-" }));
            }
            Event::Start(Tag::BlockQuote(_)) => {
                flush(&mut out, &mut current);
                quote_depth += 1;
            }
            Event::End(TagEnd::BlockQuote(_)) => {
                quote_depth = quote_depth.saturating_sub(1);
            }
            Event::Start(Tag::Link { dest_url, .. }) => {
                pending_link = Some(dest_url.to_string());
            }
            Event::End(TagEnd::Link) => {
                if let Some(url) = pending_link.take() {
                    if !url.is_empty() && !url.starts_with('#') {
                        current.push_str(&format!(" ({url})"));
                    }
                }
            }
            Event::Text(text) => {
                if in_code_block {
                    for line in text.split('\n') {
                        out.push(line.to_string());
                    }
                } else {
                    current.push_str(&text);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if in_code_block {
                    // A hard break inside a fenced block is text, already handled above.
                } else {
                    flush(&mut out, &mut current);
                }
            }
            Event::Rule => {
                flush(&mut out, &mut current);
                out.push("---".to_string());
            }
            Event::End(TagEnd::Paragraph) => flush(&mut out, &mut current),
            Event::End(TagEnd::Heading(_)) => flush(&mut out, &mut current),
            Event::End(TagEnd::Item) => flush(&mut out, &mut current),
            Event::Code(code) => {
                current.push_str(&format!("`{code}`"));
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                // HTML is stripped (ticket 04's "not in v1" list is about images/LaTeX/mermaid).
                let _ = html;
            }
            _ => {}
        }
    }
    flush(&mut out, &mut current);
    if quote_depth > 0 {
        for line in out.iter_mut() {
            *line = format!("> {line}");
        }
    }
    out
}

/// The incremental renderer: block list plus the open tail.
#[derive(Default)]
pub struct StreamingMarkdown {
    blocks: Vec<Block>,
    /// Styled rows per block, computed when a block is (re)parsed — so a frozen block never pays for
    /// colour twice, which is the whole point of ticket 06's partitioning.
    styled: Vec<Vec<crate::render::StyledRow>>, 
    /// Length of the source consumed so far, for the prefix check.
    pub source_len: usize,
}

impl StreamingMarkdown {
    pub fn new() -> StreamingMarkdown {
        StreamingMarkdown { blocks: Vec::new(), styled: Vec::new(), source_len: 0 }
    }

    /// The rendered rows in order.
    pub fn lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        for block in &self.blocks {
            out.extend(block.lines.iter().cloned());
        }
        out
    }

    pub fn is_open(&self) -> bool {
        self.blocks.last().map(|block| block.open).unwrap_or(false)
    }

    /// Feed the *whole* accumulated source. Frozen blocks are kept by prefix equality; only the open
    /// block (and anything after the frozen prefix) is re-parsed. Returns how many blocks were parsed,
    /// so a test can assert the linear behaviour rather than only its speed.
    pub fn update(&mut self, source: &str) -> usize {
        let spans = split_blocks(source);
        let mut parsed = 0;
        let mut frozen = 0;
        // Keep the frozen prefix: a span is frozen when it is closed (not open) and its source matches.
        for (index, (start, end, open)) in spans.iter().enumerate() {
            match self.blocks.get(index) {
                Some(block) if block.source == source[*start..*end] && !block.open => {
                    frozen = index + 1;
                    let _ = open;
                }
                _ => break,
            }
        }
        self.blocks.truncate(frozen);
        // Re-parse the tail, open block included.
        for (start, end, open) in spans.iter().skip(frozen) {
            let block_source = source[*start..*end].to_string();
            let lines = render_block(&block_source);
            parsed += 1;
            self.blocks.push(Block { source: block_source, lines, open: *open });
        }
        self.source_len = source.len();
        parsed
    }

    /// The same blocks with roles attached, from the cache built at parse time.
    pub fn styled_rows(&self) -> Vec<crate::render::StyledRow> {
        let mut out = Vec::new();
        for block in &self.styled {
            out.extend(block.iter().cloned());
        }
        out
    }

    /// Update and style in one pass: a frozen block keeps both its plain lines and its styled rows, so a
    /// streaming frame pays only for the open tail.
    pub fn update_styled(&mut self, source: &str, theme: &crate::theme::Theme) -> usize {
        // The plain pass decides which blocks are frozen; the styled cache follows that boundary.
        let parsed_from = {
            let spans = split_blocks(source);
            let mut frozen = 0;
            for (index, (start, end, _)) in spans.iter().enumerate() {
                match self.blocks.get(index) {
                    Some(block) if block.source == source[*start..*end] && !block.open => frozen = index + 1,
                    _ => break,
                }
            }
            frozen
        };
        let parsed = self.update(source);
        self.styled.truncate(parsed_from);
        for block in self.blocks.iter().skip(parsed_from) {
            let rows = render_block_styled(&block.source, theme);
            self.styled.push(rows);
        }
        parsed
    }

    /// Number of frozen (unchanged) blocks: the measure of how much work an append avoids.
    pub fn frozen_blocks(&self) -> usize {
        self.blocks.iter().filter(|block| !block.open).count()
    }
}


/// Render a block with pi's roles attached.
///
/// The construct set is ticket 04's decision: headings, lists, inline code, fenced code (syntax colours
/// projected onto pi's nine `syntax*` roles), links, quotes, rules. Images become alt text, HTML is
/// dropped, and LaTeX/mermaid stay literal because pi's own renderers are out of v1.
pub fn render_block_styled(source: &str, theme: &crate::theme::Theme) -> Vec<crate::render::StyledRow> {
    use crate::render::{StyledRow, StyledSpan};
    use crate::theme::Role;

    // A block that is a single fence is rendered by the highlighter, not by the markdown walker.
    if let Some((info, body)) = fence_parts(source) {
        return fence_styled(&info, &body, theme);
    }

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);

    let mut rows: Vec<StyledRow> = Vec::new();
    let mut current: Vec<StyledSpan> = Vec::new();
    let mut heading = false;

    for event in Parser::new_ext(source, options) {
        match event {
            Event::Start(Tag::CodeBlock(_)) | Event::End(TagEnd::CodeBlock) => {}
            Event::Start(Tag::Heading { level, .. }) => {
                flush(&mut rows, &mut current);
                heading = true;
                current.push(StyledSpan::new(format!("{} ", "#".repeat(level as usize)), Role::MdHeading));
            }
            Event::End(TagEnd::Heading(_)) => {
                flush(&mut rows, &mut current);
                heading = false;
            }
            Event::Start(Tag::Item) => {
                flush(&mut rows, &mut current);
                current.push(StyledSpan::new("- ", Role::MdListBullet));
            }
            Event::Start(Tag::BlockQuote(_)) => {
                flush(&mut rows, &mut current);
                current.push(StyledSpan::new("> ", Role::MdQuoteBorder));
            }
            Event::Start(Tag::Link { .. }) => {}
            Event::End(TagEnd::Link) => {}
            Event::Code(code) => current.push(StyledSpan::new(format!("`{code}`"), Role::MdCode)),
            Event::Text(text) => {
                let role = if heading { Role::MdHeading } else { Role::Text };
                current.push(StyledSpan::new(text.to_string(), role));
            }
            Event::SoftBreak | Event::HardBreak => flush(&mut rows, &mut current),
            Event::Rule => {
                flush(&mut rows, &mut current);
                rows.push(StyledRow::styled("---", Role::MdHr));
            }
            Event::End(TagEnd::Paragraph) => flush(&mut rows, &mut current),
            Event::End(TagEnd::BlockQuote(_)) => flush(&mut rows, &mut current),
            Event::End(TagEnd::Item) => flush(&mut rows, &mut current),
            Event::Html(_) | Event::InlineHtml(_) => {}
            _ => {}
        }
    }
    flush(&mut rows, &mut current);
    rows
}

/// Whether a role is one of pi's nine syntax colours (used by tests to assert highlighted bodies).
#[allow(dead_code)]
fn role_is_syntax(role: crate::theme::Role) -> bool {
    matches!(
        role,
        crate::theme::Role::SyntaxComment
            | crate::theme::Role::SyntaxKeyword
            | crate::theme::Role::SyntaxString
            | crate::theme::Role::SyntaxNumber
            | crate::theme::Role::SyntaxFunction
            | crate::theme::Role::SyntaxType
            | crate::theme::Role::SyntaxVariable
            | crate::theme::Role::SyntaxOperator
            | crate::theme::Role::SyntaxPunctuation
    )
}

fn flush(rows: &mut Vec<crate::render::StyledRow>, current: &mut Vec<crate::render::StyledSpan>) {
    if !current.is_empty() {
        rows.push(crate::render::StyledRow { spans: std::mem::take(current) });
    }
}

/// The info string and body of a block that is exactly one fenced code block.
pub fn fence_parts(source: &str) -> Option<(String, String)> {
    let mut lines = source.lines();
    let first = lines.next()?;
    let open = first.trim_start();
    if !(open.starts_with("```") || open.starts_with("~~~")) {
        return None;
    }
    let info = open.trim_start_matches('`').trim_start_matches('~').trim().to_string();
    let body_lines: Vec<&str> = lines.collect();
    // A closing fence is the last line when the block is complete.
    let (body, closed) = match body_lines.split_last() {
        Some((last, rest)) if {
            let trimmed = last.trim();
            trimmed == "```" || trimmed == "~~~" || trimmed.starts_with("```") && trimmed.trim_start_matches('`').trim().is_empty()
        } => (rest, true),
        _ => (&body_lines[..], false),
    };
    let mut body = body.join("\n");
    if closed {
        body.push('\n');
    }
    Some((info, body))
}

/// A fenced block, highlighted and styled. An unterminated fence still renders as code (ticket 06's
/// contract), with no closing border row.
fn fence_styled(info: &str, body: &str, theme: &crate::theme::Theme) -> Vec<crate::render::StyledRow> {
    use crate::render::StyledRow;
    use crate::theme::Role;
    let mut cache = crate::highlight::Cache::new(info);
    let mut rows = vec![StyledRow::styled(
        if info.is_empty() { "```".to_string() } else { format!("```{info}") },
        Role::MdCodeBlockBorder,
    )];
    for (line, spans) in crate::highlight::style_lines(body, info, &mut cache) {
        if line.is_empty() {
            rows.push(StyledRow::default());
            continue;
        }
        let mut row = StyledRow { spans: Vec::new() };
        for span in spans {
            let text = span.text(&line).to_string();
            if text.is_empty() {
                continue;
            }
            row.spans.push(crate::render::StyledSpan::new(text, syntax_role(&span.style, theme)));
        }
        rows.push(if row.spans.is_empty() { StyledRow::default() } else { row });
    }
    if body.ends_with('\n') {
        rows.push(StyledRow::styled("```", Role::MdCodeBlockBorder));
    }
    rows
}

/// Project a syntect colour onto pi's nine `syntax*` roles by nearest theme colour.
///
/// This is the fidelity step ticket 05 handed over: syntect speaks Sublime scopes, the painter speaks pi
/// roles, and the bridge is the theme's own palette rather than a hardcoded table.
pub fn syntax_role(style: &syntect::highlighting::Style, theme: &crate::theme::Theme) -> crate::theme::Role {
    use crate::theme::{Role, Rgb};
    const CANDIDATES: [Role; 9] = [
        Role::SyntaxComment,
        Role::SyntaxKeyword,
        Role::SyntaxString,
        Role::SyntaxNumber,
        Role::SyntaxFunction,
        Role::SyntaxType,
        Role::SyntaxVariable,
        Role::SyntaxOperator,
        Role::SyntaxPunctuation,
    ];
    let foreground: Rgb = Rgb::new(style.foreground.r, style.foreground.g, style.foreground.b);
    let distance = |a: Rgb, b: Rgb| -> i32 {
        let dr = a.r as i32 - b.r as i32;
        let dg = a.g as i32 - b.g as i32;
        let db = a.b as i32 - b.b as i32;
        dr * dr + dg * dg + db * db
    };
    CANDIDATES
        .iter()
        .copied()
        .min_by_key(|role| distance(foreground, theme.color(*role)))
        .unwrap_or(Role::SyntaxVariable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unterminated_fence_renders_as_code_from_the_first_chunk() {
        let mut md = StreamingMarkdown::new();
        md.update("Here:\n\n```ts\nconst a = 1;\n");
        let lines = md.lines();
        assert!(lines.iter().any(|line| line == "```ts"), "the fence opens: {lines:?}");
        assert!(lines.iter().any(|line| line.contains("const a = 1;")), "and the code is inside it");
        assert!(md.is_open(), "a fence that has not closed is the open block");
    }

    #[test]
    fn a_closed_fence_freezes_and_an_append_parses_only_the_tail() {
        let mut md = StreamingMarkdown::new();
        md.update("Intro paragraph.\n\n```ts\ncode\n```\n\n");
        assert!(!md.is_open());
        let parsed = md.update("Intro paragraph.\n\n```ts\ncode\n```\n\nTail para");
        assert_eq!(parsed, 1, "only the new tail block is parsed");
        assert_eq!(md.frozen_blocks(), 2, "the paragraph and the fence stay frozen");
        assert!(md.lines().iter().any(|line| line.contains("Tail para")));
    }

    #[test]
    fn a_paragraph_that_keeps_growing_is_reparsed_alone() {
        let mut md = StreamingMarkdown::new();
        let mut growing = String::from("Intro.\n\n");
        for word in ["one ", "two ", "three"] {
            growing.push_str(word);
            md.update(&growing);
        }
        assert_eq!(md.lines().iter().filter(|line| line.contains("Intro.")).count(), 1);
        let last = md.lines().last().cloned().unwrap_or_default();
        assert_eq!(last, "one two three");
    }

    #[test]
    fn a_list_stays_one_block_until_a_blank_line() {
        let mut md = StreamingMarkdown::new();
        md.update("- one\n- two\n");
        assert!(md.is_open(), "a list without a trailing blank line is still open");
        let lines = md.lines();
        assert_eq!(lines.iter().filter(|line| line.starts_with("- ")).count(), 2, "{lines:?}");
    }

    #[test]
    fn a_heading_keeps_its_marks_and_a_rule_survives() {
        let mut md = StreamingMarkdown::new();
        md.update("# Title\n\n---\n\n");
        let lines = md.lines();
        assert_eq!(lines[0], "# Title");
        assert!(lines.iter().any(|line| line == "---"));
    }

    #[test]
    fn a_heading_and_a_list_carry_pi_roles() {
        let theme = crate::theme::Theme::parse(r#"{"colors": {"mdHeading": "okhsl(83 88% 67%)", "mdListBullet": "okhsl(295 50% 67%)"}}"#).expect("a theme");
        let rows = render_block_styled("# Title\n\n- one\n- two\n", &theme);
        let heading = &rows[0];
        assert_eq!(heading.text(), "# Title");
        assert_eq!(heading.spans[0].role, crate::theme::Role::MdHeading);
        // Two items means two bullet spans, each in the bullet role; the text of the items survives.
        let bullet_spans: Vec<_> = rows
            .iter()
            .flat_map(|row| row.spans.iter())
            .filter(|span| span.role == crate::theme::Role::MdListBullet)
            .collect();
        assert_eq!(bullet_spans.len(), 2, "one bullet per item: {rows:#?}");
        let text: String = rows.iter().map(|row| row.text()).collect::<Vec<_>>().join("\n");
        assert!(text.contains("- one") && text.contains("- two"), "items intact: {text:?}");
    }

    #[test]
    fn a_fenced_block_renders_borders_and_syntax_roles() {
        let theme = crate::theme::Theme::find_default();
        let rows = render_block_styled("```ts\nconst answer = 42;\n```\n", &theme);
        assert_eq!(rows[0].text(), "```ts");
        assert_eq!(rows[0].spans[0].role, crate::theme::Role::MdCodeBlockBorder);
        assert_eq!(rows.last().unwrap().text(), "```");
        let body: Vec<_> = rows.iter().skip(1).take(rows.len() - 2).collect();
        assert_eq!(body.len(), 1);
        assert!(role_is_syntax(body[0].spans[0].role), "code carries a syntax role: {:?}", body[0].spans);
        // The text is intact: colour never rewrites the code.
        assert_eq!(body[0].text(), "const answer = 42;");
    }

    #[test]
    fn an_unterminated_fence_renders_without_a_closing_border() {
        let theme = crate::theme::Theme::find_default();
        let rows = render_block_styled("```ts\nconst a = 1;\n", &theme);
        assert_eq!(rows[0].text(), "```ts");
        assert!(rows.iter().all(|row| row.text() != "```"), "no closing border yet");
    }

    #[test]
    fn a_streamed_table_does_not_flicker_into_prose() {
        let mut md = StreamingMarkdown::new();
        // Half a table: the header row and the separator, no body yet.
        md.update("| a | b |\n| --- | --- |\n");
        assert!(md.is_open());
        md.update("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
        let lines = md.lines();
        assert!(lines.iter().any(|line| line.contains("1")), "{lines:?}");
    }
}
