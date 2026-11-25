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
    // One renderer, one answer: plain text is the styled rows' text, so the bench's whole-source
    // baseline and the painted transcript cannot drift apart. Before ticket 13 they did — the plain
    // walker kept heading marks and inline backticks that the styled one hid.
    render_block_styled(source, &crate::theme::Theme::find_default())
        .iter()
        .map(crate::render::StyledRow::text)
        .collect()
}

/// The incremental renderer: a block list with a stable frozen prefix, and one styled row set per block.
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

    /// The rendered rows in order, with one blank row between blocks. Spacing is a property of the
    /// document, not of a block: pi ends every block with a blank row (`markdown.ts:597-600`, `:651-657`),
    /// and before ticket 13 the client had none, so an answer's paragraphs, headings and fences collided
    /// into a wall of text. Plain text is the styled rows' text, so both paths agree.
    pub fn lines(&self) -> Vec<String> {
        self.styled_rows().iter().map(crate::render::StyledRow::text).collect()
    }

    pub fn is_open(&self) -> bool {
        self.blocks.last().map(|block| block.open).unwrap_or(false)
    }

    /// Feed the *whole* accumulated source, rendered with the default theme. Frozen blocks are kept by
    /// prefix equality; only the open block (and anything after the frozen prefix) is re-parsed. Returns
    /// how many blocks were parsed, so a test can assert the linear behaviour rather than only its speed.
    pub fn update(&mut self, source: &str) -> usize {
        self.render(source, &crate::theme::Theme::find_default())
    }

    /// Update and style in one pass: a frozen block keeps its styled rows, so a streaming frame pays only
    /// for the open tail.
    pub fn update_styled(&mut self, source: &str, theme: &crate::theme::Theme) -> usize {
        self.render(source, theme)
    }

    /// The one render path both callers share: freeze the prefix, then render what is left.
    fn render(&mut self, source: &str, theme: &crate::theme::Theme) -> usize {
        let spans = split_blocks(source);
        let mut frozen = 0;
        for (index, (start, end, _)) in spans.iter().enumerate() {
            match self.blocks.get(index) {
                Some(block) if block.source == source[*start..*end] && !block.open => frozen = index + 1,
                _ => break,
            }
        }
        self.blocks.truncate(frozen);
        self.styled.truncate(frozen);
        for (start, end, open) in spans.iter().skip(frozen) {
            let block_source = source[*start..*end].to_string();
            let rows = render_block_styled(&block_source, theme);
            self.blocks.push(Block { source: block_source, open: *open });
            self.styled.push(rows);
        }
        self.source_len = source.len();
        spans.len() - frozen
    }

    /// The rows in order, a blank row between blocks. The last block does not get a trailing one: the
    /// message-level spacer in the transcript (`model.rs::commit_open`) already separates messages.
    pub fn styled_rows(&self) -> Vec<crate::render::StyledRow> {
        let mut out = Vec::new();
        for (index, block) in self.styled.iter().enumerate() {
            if index > 0 {
                out.push(crate::render::StyledRow::default());
            }
            out.extend(block.iter().cloned());
        }
        out
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
/// Render a block with pi's roles attached.
///
/// The construct set is ticket 04's decision, aligned with pi's own renderer by ticket 13: headings (marks
/// hidden below level 3), lists, inline code without its backticks, fenced code with syntax colours,
/// links, quotes, a glyph rule, and real tables. Images become alt text, HTML is dropped, and
/// LaTeX/mermaid stay literal because pi's own renderers are out of v1. Spacing *between* blocks is the
/// streaming renderer's job, not this one's: a block renders only its own rows.
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
    let mut table: Option<TableBuild> = None;

    for event in Parser::new_ext(source, options) {
        match event {
            Event::Start(Tag::CodeBlock(_)) | Event::End(TagEnd::CodeBlock) => {}
            Event::Start(Tag::Heading { level, .. }) => {
                flush(&mut rows, &mut current);
                heading = true;
                // pi hides the marks for levels 1 and 2 and keeps them from 3 down
                // (`pi/packages/tui/src/components/markdown.ts:576-600`): a heading reads as a heading
                // because it is styled, not because it is spelled.
                let marks = level as usize;
                if marks >= 3 {
                    current.push(StyledSpan::new(format!("{} ", "#".repeat(marks)), Role::MdHeading));
                }
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
            Event::Code(code) => {
                // pi styles the run and drops the delimiters (`markdown.ts:833-835`).
                push_or_cell(&mut current, &mut table, StyledSpan::new(code.to_string(), Role::MdCode));
            }
            Event::Text(text) => {
                let role = if heading { Role::MdHeading } else { Role::Text };
                push_or_cell(&mut current, &mut table, StyledSpan::new(text.to_string(), role));
            }
            Event::SoftBreak | Event::HardBreak => {
                if table.is_none() {
                    flush(&mut rows, &mut current);
                }
            }
            Event::Rule => {
                flush(&mut rows, &mut current);
                // pi's rule is a glyph row, not markdown source (`markdown.ts:745-750`).
                rows.push(StyledRow::styled("\u{2500}".repeat(80), Role::MdHr));
            }
            Event::End(TagEnd::Paragraph) => flush(&mut rows, &mut current),
            Event::End(TagEnd::BlockQuote(_)) => flush(&mut rows, &mut current),
            Event::End(TagEnd::Item) => flush(&mut rows, &mut current),
            Event::Start(Tag::Table(_)) => {
                flush(&mut rows, &mut current);
                table = Some(TableBuild::default());
            }
            Event::Start(Tag::TableHead) | Event::Start(Tag::TableRow) => {
                if let Some(build) = table.as_mut() {
                    build.row.clear();
                }
            }
            Event::Start(Tag::TableCell) => {
                if let Some(build) = table.as_mut() {
                    build.cell.clear();
                }
            }
            Event::End(TagEnd::TableCell) => {
                if let Some(build) = table.as_mut() {
                    let cell = std::mem::take(&mut build.cell);
                    build.row.push(cell);
                }
            }
            Event::End(TagEnd::TableHead) | Event::End(TagEnd::TableRow) => {
                if let Some(build) = table.as_mut() {
                    let row = std::mem::take(&mut build.row);
                    if !row.is_empty() {
                        let head = build.rows.is_empty();
                        build.heads.push(head);
                        build.rows.push(row);
                    }
                }
            }
            Event::End(TagEnd::Table) => {
                if let Some(build) = table.take() {
                    rows.extend(table_rows(build));
                }
            }
            Event::Html(_) | Event::InlineHtml(_) => {}
            _ => {}
        }
    }
    flush(&mut rows, &mut current);
    rows
}

/// Text belongs to the open table's cell while a table is open, and to the running line otherwise.
fn push_or_cell(
    current: &mut Vec<crate::render::StyledSpan>,
    table: &mut Option<TableBuild>,
    span: crate::render::StyledSpan,
) {
    match table.as_mut() {
        Some(build) => build.cell.push(span),
        None => current.push(span),
    }
}

/// A table being collected. pulldown-cmark emits the header row first, so `heads` is true for index 0.
#[derive(Default)]
struct TableBuild {
    rows: Vec<Vec<Vec<crate::render::StyledSpan>>>,
    row: Vec<Vec<crate::render::StyledSpan>>,
    cell: Vec<crate::render::StyledSpan>,
    heads: Vec<bool>,
}

/// The widest a table may be before its columns are squeezed. The block renderer has no pane width (the
/// painter owns wrapping, and blocks are cached by source alone), so a table is laid out at its natural
/// width capped here: narrow enough for a normal pane, wide enough for a real table not to be cut.
const TABLE_MAX_WIDTH: usize = 100;

/// A table as a box-drawn grid with pi's glyphs (`markdown.ts:1126-1163`). A cell keeps its spans; a cell
/// wider than its column wraps inside the cell rather than losing text.
fn table_rows(build: TableBuild) -> Vec<crate::render::StyledRow> {
    use crate::render::{StyledRow, StyledSpan};
    use crate::theme::Role;

    let columns = build.rows.iter().map(Vec::len).max().unwrap_or(0);
    if columns == 0 || build.rows.is_empty() {
        return Vec::new();
    }
    let mut widths = vec![1usize; columns];
    for row in &build.rows {
        for (index, cell) in row.iter().enumerate() {
            let width: usize = cell.iter().map(|span| span_width(&span.text)).sum();
            widths[index] = widths[index].max(width);
        }
    }
    let overhead = 3 * columns + 1;
    let room = TABLE_MAX_WIDTH.saturating_sub(overhead).max(columns);
    while widths.iter().sum::<usize>() > room {
        let widest = widths
            .iter()
            .enumerate()
            .filter(|(_, width)| **width > 1)
            .max_by_key(|(_, width)| *width)
            .map(|(index, _)| index);
        match widest {
            Some(index) => widths[index] -= 1,
            None => break,
        }
    }

    let border = |left: &str, join: &str, right: &str| -> StyledRow {
        let mut text = String::new();
        text.push_str(left);
        for (index, width) in widths.iter().enumerate() {
            if index > 0 {
                text.push_str(join);
            }
            text.push_str(&"\u{2500}".repeat(*width));
        }
        text.push_str(right);
        StyledRow::styled(text, Role::Dim)
    };
    let row_line = |cells: &[StyledRow]| -> StyledRow {
        let mut spans: Vec<StyledSpan> = vec![StyledSpan::new("\u{2502} ", Role::Dim)];
        for (index, cell) in cells.iter().enumerate() {
            if index > 0 {
                spans.push(StyledSpan::new(" \u{2502} ", Role::Dim));
            }
            let width: usize = cell.spans.iter().map(|span| span_width(&span.text)).sum();
            spans.extend(cell.spans.iter().cloned());
            let pad = widths[index].saturating_sub(width);
            if pad > 0 {
                spans.push(StyledSpan::new(" ".repeat(pad), Role::Text));
            }
        }
        spans.push(StyledSpan::new(" \u{2502}", Role::Dim));
        StyledRow { spans }
    };

    let mut out: Vec<StyledRow> = Vec::new();
    out.push(border("\u{250c}\u{2500}", "\u{2500}\u{252c}\u{2500}", "\u{2500}\u{2510}"));
    for (index, row) in build.rows.iter().enumerate() {
        let head = build.heads.get(index).copied().unwrap_or(false);
        // Each cell is wrapped inside its own column, and the row is as tall as its tallest cell.
        let wrapped: Vec<Vec<StyledRow>> = (0..columns)
            .map(|column| {
                let spans: Vec<StyledSpan> = row
                    .get(column)
                    .map(|cell| {
                        cell.iter()
                            .map(|span| StyledSpan {
                                text: span.text.clone(),
                                role: if head { Role::MdHeading } else { span.role },
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                crate::render::wrap_rows(&[StyledRow { spans }], widths[column])
            })
            .collect();
        let height = wrapped.iter().map(Vec::len).max().unwrap_or(1).max(1);
        for line in 0..height {
            let cells: Vec<StyledRow> = wrapped
                .iter()
                .map(|lines| lines.get(line).cloned().unwrap_or_default())
                .collect();
            out.push(row_line(&cells));
        }
        if index == 0 && build.rows.len() > 1 {
            out.push(border("\u{251c}\u{2500}", "\u{2500}\u{253c}\u{2500}", "\u{2500}\u{2524}"));
        }
    }
    out.push(border("\u{2514}\u{2500}", "\u{2500}\u{2534}\u{2500}", "\u{2500}\u{2518}"));
    out
}

/// The cells a string occupies in a terminal.
fn span_width(text: &str) -> usize {
    use unicode_width::UnicodeWidthStr;
    UnicodeWidthStr::width(text)
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
    // pi replaces a tab with three spaces and indents a code row by two (`render-utils.ts:replaceTabs`,
    // `markdown.ts:638-654`). The client passed tabs through, so the terminal's tab stop (8) decided the
    // indent and a fenced block did not line up with pi's.
    let body = body.replace('\t', "   ");
    let indent = "  ";
    let mut cache = crate::highlight::Cache::new(info);
    let mut rows = vec![StyledRow::styled(
        if info.is_empty() { "```".to_string() } else { format!("```{info}") },
        Role::MdCodeBlockBorder,
    )];
    for (line, spans) in crate::highlight::style_lines(&body, info, &mut cache) {
        if line.is_empty() {
            rows.push(StyledRow::default());
            continue;
        }
        let mut row = StyledRow { spans: vec![crate::render::StyledSpan::new(indent, Role::Text)] };
        for span in spans {
            let text = span.text(&line).to_string();
            if text.is_empty() {
                continue;
            }
            row.spans.push(crate::render::StyledSpan::new(text, syntax_role(&span.style, theme)));
        }
        rows.push(row);
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
    fn a_heading_hides_its_marks_below_level_three_and_the_rule_is_a_glyph() {
        // pi's rule (`markdown.ts:576-600`, `:745-750`), ticket 13's F3 and the rule row.
        let rows = render_block_styled("# Title\n", &crate::theme::Theme::find_default());
        assert_eq!(rows[0].text(), "Title", "an h1 is styled, not spelled");
        assert_eq!(rows[0].spans[0].role, crate::theme::Role::MdHeading);
        let rows = render_block_styled("### Details\n", &crate::theme::Theme::find_default());
        assert_eq!(rows[0].text(), "### Details", "an h3 keeps its marks, as pi does");
        let rows = render_block_styled("---\n", &crate::theme::Theme::find_default());
        assert!(rows[0].text().starts_with('\u{2500}'), "a glyph rule: {:?}", rows[0].text());
        assert!(rows[0].text().chars().all(|ch| ch == '\u{2500}'), "no markdown source");
    }

    #[test]
    fn blocks_are_separated_by_one_blank_row() {
        // Ticket 13's F2: a heading, a paragraph and a fence must not collide.
        let mut md = StreamingMarkdown::new();
        md.update("# Title\n\nA paragraph.\n\n```ts\nconst a = 1;\n```\n");
        let lines = md.lines();
        let blank = |index: usize| lines.get(index).map(|line| line.is_empty()).unwrap_or(false);
        let heading = lines.iter().position(|line| line == "Title").expect("the heading");
        assert!(blank(heading + 1), "a blank row after the heading: {lines:?}");
        let para = lines.iter().position(|line| line == "A paragraph.").expect("the paragraph");
        assert!(blank(para + 1), "a blank row after the paragraph: {lines:?}");
        let fence = lines.iter().position(|line| line == "```ts").expect("the fence");
        assert!(blank(fence - 1), "a blank row before the fence: {lines:?}");
    }

    #[test]
    fn inline_code_drops_its_backticks_and_keeps_the_code_role() {
        // Ticket 13's F4: pi styles the run and drops the delimiters (`markdown.ts:833-835`).
        let rows = render_block_styled("See `tui-main-screen.ts` here.\n", &crate::theme::Theme::find_default());
        let text = rows.iter().map(|row| row.text()).collect::<Vec<_>>().join("\n");
        assert_eq!(text, "See tui-main-screen.ts here.");
        let code: Vec<_> = rows
            .iter()
            .flat_map(|row| row.spans.iter())
            .filter(|span| span.role == crate::theme::Role::MdCode)
            .collect();
        assert_eq!(code.len(), 1, "the run carries the code role");
    }

    #[test]
    fn a_table_is_a_grid_that_keeps_every_cell() {
        // Ticket 13's F5: a table used to collapse into one concatenated line.
        let theme = crate::theme::Theme::find_default();
        let rows = render_block_styled("| a | b |\n| --- | --- |\n| 1 | 2 |\n", &theme);
        let lines = rows.iter().map(|row| row.text()).collect::<Vec<_>>();
        assert!(lines[0].starts_with('\u{250c}'), "a top border: {lines:?}");
        assert!(lines.iter().any(|line| line.contains("\u{2502} a") && line.contains("\u{2502} b")), "{}", lines.join("\n"));
        assert!(lines.iter().any(|line| line.contains("\u{2502} 1") && line.contains("\u{2502} 2")), "{}", lines.join("\n"));
        assert!(lines.last().unwrap().starts_with('\u{2514}'), "a bottom border: {lines:?}");
    }

    #[test]
    fn a_heading_and_a_list_carry_pi_roles() {
        let theme = crate::theme::Theme::parse(r#"{"colors": {"mdHeading": "okhsl(83 88% 67%)", "mdListBullet": "okhsl(295 50% 67%)"}}"#).expect("a theme");
        let rows = render_block_styled("# Title\n\n- one\n- two\n", &theme);
        let heading = &rows[0];
        assert_eq!(heading.text(), "Title");
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
        let syntax: Vec<_> = body[0].spans.iter().filter(|span| role_is_syntax(span.role)).collect();
        assert!(!syntax.is_empty(), "code carries a syntax role: {:?}", body[0].spans);
        // The text is intact, and indented by two like pi (`markdown.ts:638-654`).
        assert_eq!(body[0].text(), "  const answer = 42;");
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
