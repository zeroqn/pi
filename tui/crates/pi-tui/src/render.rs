//! Styled rows: the transcript as text plus colour roles, wrapped at the pane width.
//!
//! Two things meet here. Ticket 04 decided colour comes from pi's theme roles (56 of them, parsed by
//! `theme.rs`); ticket 06 decided markdown renders per block, unwrapped, so the painter keeps ownership of
//! wrapping. A row is therefore **spans of text with a role**, and wrapping happens on spans — never on a
//! string that already carries escape sequences, which is how a wrapped span loses its colour mid-word.

use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

use crate::theme::{Role, Theme};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StyledSpan {
    pub text: String,
    pub role: Role,
}

impl StyledSpan {
    pub fn new(text: impl Into<String>, role: Role) -> StyledSpan {
        StyledSpan { text: text.into(), role }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StyledRow {
    pub spans: Vec<StyledSpan>,
}

impl StyledRow {
    pub fn plain(text: impl Into<String>) -> StyledRow {
        StyledRow { spans: vec![StyledSpan::new(text, Role::Text)] }
    }

    pub fn styled(text: impl Into<String>, role: Role) -> StyledRow {
        StyledRow { spans: vec![StyledSpan::new(text, role)] }
    }

    /// The first `cols` characters of the row, spans preserved. An overlay that covers the last column
    /// needs a row one cell shorter (ticket 03 D4).
    pub fn truncate_cols(&self, cols: usize) -> StyledRow {
        let mut out = StyledRow::default();
        let mut kept = 0usize;
        for span in &self.spans {
            if kept >= cols {
                break;
            }
            let mut piece = String::new();
            for ch in span.text.chars() {
                if kept >= cols {
                    break;
                }
                piece.push(ch);
                kept += 1;
            }
            if !piece.is_empty() {
                out.spans.push(StyledSpan::new(piece, span.role));
            }
        }
        out
    }

    /// The row with the character range `from..to` marked `Role::Selected`. Spans are split at the
    /// boundary, so a selection can start and end inside a coloured span (ticket 04 D6).
    pub fn with_selection(&self, from: usize, to: usize) -> StyledRow {
        if from >= to {
            return self.clone();
        }
        let mut out = StyledRow::default();
        let mut column = 0usize;
        for span in &self.spans {
            let mut piece = String::new();
            let mut piece_role = span.role;
            let mut _flushed = false;
            for ch in span.text.chars() {
                let selected = column >= from && column < to;
                let role = if selected { Role::Selected } else { span.role };
                if role != piece_role && !piece.is_empty() {
                    out.spans.push(StyledSpan::new(std::mem::take(&mut piece), piece_role));
                    piece_role = role;
                    _flushed = true;
                } else if piece.is_empty() {
                    piece_role = role;
                }
                piece.push(ch);
                column += 1;
            }
            let _ = _flushed;
            if !piece.is_empty() {
                out.spans.push(StyledSpan::new(piece, piece_role));
            }
        }
        out
    }

    pub fn text(&self) -> String {
        self.spans.iter().map(|span| span.text.as_str()).collect()
    }

    pub fn width(&self) -> usize {
        self.spans.iter().map(|span| UnicodeWidthStr::width(span.text.as_str())).sum()
    }

    /// The row as one ANSI string, colour applied per span and reset at the end.
    pub fn ansi(&self, theme: &Theme) -> String {
        if theme.plain {
            return self.text();
        }
        let mut out = String::new();
        for span in &self.spans {
            if span.text.is_empty() {
                continue;
            }
            if span.role == Role::Selected {
                // Reverse video: the terminal's own selection affordance, with no theme entry.
                out.push_str("\u{1b}[7m");
                out.push_str(&span.text);
                out.push_str("\u{1b}[0m");
                continue;
            }
            out.push_str(&theme.color(span.role).fg());
            out.push_str(&span.text);
            out.push_str("\u{1b}[0m");
        }
        out
    }
}

/// Wrap one row to `width` cells, breaking at a space where one is available and inside a word only
/// when no space fits.
///
/// pi's own wrapper (`pi/packages/tui/src/utils.ts`, `wrapTextWithAnsi`) is the reference: it fills a
/// line greedily and breaks at the last space, so a wrapped answer reads as prose. Breaking per grapheme
/// — what this did before the wear-in day — put "…The tree is cl" and "an." on separate lines for every
/// row that overflowed. Grapheme-wise cutting survives only for a single word wider than the pane, which
/// is what pi does too.
pub fn wrap(row: &StyledRow, width: usize, out: &mut Vec<StyledRow>) {
    let width = width.max(1);
    if row.spans.is_empty() {
        out.push(StyledRow::default());
        return;
    }
    if !row.spans.iter().any(|span| span.text.contains('\n')) {
        wrap_line(&row.spans, width, out);
        return;
    }
    // A row should not carry newlines (the markdown renderer splits them), but a plain row handed
    // straight from the model may: each newline ends a line, even when it ends nothing else.
    let mut piece: Vec<StyledSpan> = Vec::new();
    for span in &row.spans {
        for (index, part) in span.text.split('\n').enumerate() {
            if index > 0 {
                wrap_line(&piece, width, out);
                piece.clear();
            }
            if !part.is_empty() {
                piece.push(StyledSpan::new(part, span.role));
            }
        }
    }
    wrap_line(&piece, width, out);
}

/// One logical line, already free of newlines: fill each row up to `width`, break at the last space.
fn wrap_line(spans: &[StyledSpan], width: usize, out: &mut Vec<StyledRow>) {
    if spans.is_empty() {
        out.push(StyledRow::default());
        return;
    }
    let cells: usize = spans.iter().map(|span| UnicodeWidthStr::width(span.text.as_str())).sum();
    if cells <= width {
        out.push(StyledRow { spans: spans.to_vec() });
        return;
    }
    // Flatten to graphemes with their role, so a break can fall anywhere and a span can be split
    // without losing its colour.
    let mut graphemes: Vec<(&str, Role)> = Vec::with_capacity(cells);
    for span in spans {
        for grapheme in span.text.graphemes(true) {
            graphemes.push((grapheme, span.role));
        }
    }
    let mut start = 0usize;
    while start < graphemes.len() {
        // Spaces left over by the break belong to neither row.
        while start < graphemes.len() && graphemes[start].0 == " " {
            start += 1;
        }
        if start >= graphemes.len() {
            break;
        }
        let mut used = 0usize;
        let mut end = start;
        let mut last_space = None;
        while end < graphemes.len() {
            let cells = UnicodeWidthStr::width(graphemes[end].0);
            if used + cells > width && used > 0 {
                break;
            }
            used += cells;
            if graphemes[end].0 == " " {
                last_space = Some(end);
            }
            end += 1;
        }
        // Break before the space that ended the row; a word wider than the pane is cut at the width,
        // and a row that took the whole remainder takes all of it.
        let next = if end >= graphemes.len() {
            end
        } else {
            match last_space {
                Some(space) if space > start => space,
                _ => end,
            }
        };
        let next = if next <= start { (start + 1).min(graphemes.len()) } else { next };
        let mut emit = next;
        while emit > start && graphemes[emit - 1].0 == " " {
            emit -= 1;
        }
        if emit == start {
            // A row of nothing but spaces: it carries nothing, so the break is what matters.
            emit = start + 1;
        }
        push_graphemes(&graphemes[start..emit], out);
        start = next;
    }
}

/// One row out of graphemes, merging runs that share a role back into spans.
fn push_graphemes(graphemes: &[(&str, Role)], out: &mut Vec<StyledRow>) {
    let mut row = StyledRow::default();
    let mut buffer = String::new();
    let mut role: Option<Role> = None;
    for (grapheme, cell_role) in graphemes {
        if role != Some(*cell_role) {
            if !buffer.is_empty() {
                row.spans.push(StyledSpan::new(std::mem::take(&mut buffer), role.expect("a role for the buffer")));
            }
            role = Some(*cell_role);
        }
        buffer.push_str(grapheme);
    }
    if !buffer.is_empty() {
        row.spans.push(StyledSpan::new(buffer, role.expect("a role for the buffer")));
    }
    out.push(row);
}

/// Wrap a whole document of rows.
pub fn wrap_rows(rows: &[StyledRow], width: usize) -> Vec<StyledRow> {
    let mut out = Vec::new();
    for row in rows {
        wrap(row, width, &mut out);
    }
    out
}

/// Truncate to `max` visual lines, keeping either the last or the first ones, and report how many were
/// hidden. Those are pi's rule and caps (ticket 04's decision): 10 visual lines for a tool result, 20 for
/// bash output, counted after wrapping rather than in logical lines.
pub fn truncate_visual(rows: Vec<StyledRow>, max: usize, keep_last: bool) -> (Vec<StyledRow>, usize) {
    if rows.len() <= max {
        return (rows, 0);
    }
    let hidden = rows.len() - max;
    let kept: Vec<StyledRow> = if keep_last {
        rows[rows.len() - max..].to_vec()
    } else {
        rows[..max].to_vec()
    };
    (kept, hidden)
}

/// The `... (N more lines, <chord> to expand)` hint pi shows, split into role-tagged spans.
///
/// `keep_last` picks pi's word for a body that kept its tail: a bash result says *earlier* lines
/// (`core/tools/renderers/bash.ts:61-66`), everything else says *more* lines
/// (`components/tool-execution.ts:155-162`).
pub fn more_lines_hint_kind(hidden: usize, chord: &str, keep_last: bool) -> StyledRow {
    let noun = if keep_last { "earlier lines" } else { "more lines" };
    StyledRow {
        spans: vec![
            StyledSpan::new(format!("... ({hidden} {noun}, "), Role::Muted),
            StyledSpan::new(chord.to_string(), Role::Accent),
            StyledSpan::new(" to expand)", Role::Muted),
        ],
    }
}

/// The hint as pi writes it for a body that kept its head.
pub fn more_lines_hint(hidden: usize, chord: &str) -> StyledRow {
    more_lines_hint_kind(hidden, chord, false)
}



#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::Theme;

    fn theme() -> Theme {
        Theme::parse(r#"{"colors": {"text": "okhsl(234 3% 89%)", "accent": "okhsl(295 50% 67%)"}}"#)
            .expect("a theme")
    }

    #[test]
    fn a_selection_marks_the_cells_it_covers_and_nothing_else() {
        let row = StyledRow {
            spans: vec![
                StyledSpan::new("plain ", Role::Text),
                StyledSpan::new("accent", Role::Accent),
                StyledSpan::new(" tail", Role::Muted),
            ],
        };
        // Columns 6..11 are "accen", which straddles the accent span's start.
        let marked = row.with_selection(6, 11);
        assert_eq!(marked.text(), row.text(), "selection never changes the text");
        let selected: String = marked
            .spans
            .iter()
            .filter(|span| span.role == Role::Selected)
            .map(|span| span.text.clone())
            .collect();
        assert_eq!(selected, "accen", "only the covered cells are marked");
        // A range that ends inside a span splits it, so the tail keeps its own role.
        let inside = row.with_selection(1, 3);
        assert_eq!(inside.text(), "plain accent tail");
        assert_eq!(inside.spans.last().unwrap().role, Role::Muted);
    }

    #[test]
    fn truncating_a_row_keeps_its_spans_and_drops_the_tail() {
        let row = StyledRow {
            spans: vec![StyledSpan::new("plain ", Role::Text), StyledSpan::new("accent", Role::Accent)],
        };
        let short = row.truncate_cols(7);
        assert_eq!(short.text(), "plain a");
        assert_eq!(short.spans.len(), 2, "the split point stays a span boundary");
        assert_eq!(short.spans[1].role, Role::Accent);
        assert_eq!(row.truncate_cols(99).text(), row.text(), "asking for more keeps everything");
    }

    #[test]
    fn an_empty_selection_leaves_the_row_untouched() {
        let row = StyledRow::styled("text", Role::Text);
        assert_eq!(row.with_selection(2, 2), row);
        assert_eq!(row.with_selection(5, 2), row, "a backwards range is no selection");
    }

    #[test]
    fn wrapping_keeps_every_span_and_splits_only_where_it_must() {
        let row = StyledRow {
            spans: vec![
                StyledSpan::new("plain ", Role::Text),
                StyledSpan::new("code-span", Role::MdCode),
                StyledSpan::new(" tail", Role::Dim),
            ],
        };
        let wrapped = wrap_rows(&[row], 10);
        let text: Vec<String> = wrapped.iter().map(|row| row.text()).collect();
        // The break is at a space, so no word is cut: "code-span" moves whole to the next row even
        // though "plain " + "code" would have filled the first one (ticket 13's F1).
        assert_eq!(text, vec!["plain", "code-span", "tail"]);
        assert_eq!(wrapped[1].spans[0].role, Role::MdCode, "the role survives the break");
        assert_eq!(wrapped[2].spans[0].role, Role::Dim, "and so does the next span's role");
        assert!(wrapped.iter().all(|row| row.width() <= 10));
    }

    #[test]
    fn a_wrapped_line_breaks_at_a_space_and_never_inside_a_word() {
        let row = StyledRow::styled("the quick brown fox jumps over the lazy dog", Role::Text);
        let wrapped = wrap_rows(&[row], 12);
        let text: Vec<String> = wrapped.iter().map(|row| row.text()).collect();
        assert_eq!(text, vec!["the quick", "brown fox", "jumps over", "the lazy dog"]);
    }

    #[test]
    fn a_word_wider_than_the_pane_is_cut_and_the_rest_still_flows() {
        let row = StyledRow::styled("a supercalifragilistic word", Role::Text);
        let wrapped = wrap_rows(&[row], 10);
        let text: Vec<String> = wrapped.iter().map(|row| row.text()).collect();
        assert_eq!(text, vec!["a", "supercalif", "ragilistic", "word"]);
        assert!(wrapped.iter().all(|row| row.width() <= 10));
    }

    #[test]
    fn a_long_span_is_cut_at_the_width_and_keeps_its_role() {
        let row = StyledRow::styled("abcdefghijklmno", Role::MdHeading);
        let wrapped = wrap_rows(&[row], 5);
        assert_eq!(wrapped.len(), 3);
        assert_eq!(wrapped[0].text(), "abcde");
        assert!(wrapped.iter().all(|row| row.spans.iter().all(|span| span.role == Role::MdHeading)));
    }

    #[test]
    fn wide_characters_are_never_split_across_rows() {
        let row = StyledRow::styled("日本語です", Role::Text);
        let wrapped = wrap_rows(&[row], 6);
        for row in &wrapped {
            assert!(row.width() <= 6, "{:?}", row.text());
        }
        let joined: String = wrapped.iter().map(|row| row.text()).collect();
        assert_eq!(joined, "日本語です");
    }

    #[test]
    fn ansi_carries_the_role_and_resets() {
        let t = theme();
        let row = StyledRow::styled("hello", Role::Text);
        let ansi = row.ansi(&t);
        assert!(ansi.starts_with("\u{1b}[38;2;"), "truecolor prefix: {ansi:?}");
        assert!(ansi.ends_with("\u{1b}[0m"));
        let accent = StyledRow::styled("x", Role::Accent).ansi(&t);
        assert_ne!(ansi, accent);
    }

    #[test]
    fn no_color_strips_every_escape() {
        let mut theme = theme();
        theme.plain = true;
        let row = StyledRow::styled("hello", Role::Accent);
        assert_eq!(row.ansi(&theme), "hello", "no SGR at all when NO_COLOR is honoured");
    }

    #[test]
    fn truncation_counts_visual_lines_and_reports_what_it_hid() {
        let rows: Vec<StyledRow> = (0..25).map(|i| StyledRow::plain(format!("line {i}"))).collect();
        let (kept, hidden) = truncate_visual(rows, 20, true);
        assert_eq!(kept.len(), 20);
        assert_eq!(hidden, 5);
        assert_eq!(kept[0].text(), "line 5", "the last ones are kept for bash output");
        let (kept, hidden) = truncate_visual((0..12).map(|i| StyledRow::plain(format!("r{i}"))).collect(), 10, false);
        assert_eq!(hidden, 2);
        assert_eq!(kept[0].text(), "r0");
    }

    #[test]
    fn the_hint_names_the_chord_in_the_accent_role() {
        let row = more_lines_hint(7, "ctrl+o");
        assert_eq!(row.text(), "... (7 more lines, ctrl+o to expand)");
        assert_eq!(row.spans[1].role, Role::Accent);
    }
}
