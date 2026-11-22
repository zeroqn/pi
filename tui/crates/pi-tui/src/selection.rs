//! A selection over the transcript, in **document rows** (ticket 04 D2/D6).
//!
//! pi slices the *screen* and throws the selection away when the window moves. The client keeps
//! `(row, column)` pairs in document coordinates, so a scroll, a stream or a partial repaint leaves the
//! selection where you made it; drawing maps it through the current window offset.
//!
//! Columns are character counts inside the row, which is what a mouse coordinate maps to once the row is
//! in front of you. Copy trims trailing space and joins rows with a newline, as pi does.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Selection {
    pub anchor: (usize, usize),
    pub end: (usize, usize),
}

impl Selection {
    pub fn new(anchor: (usize, usize)) -> Selection {
        Selection { anchor, end: anchor }
    }

    pub fn extend(&mut self, end: (usize, usize)) {
        self.end = end;
    }

    /// Anchor and end in reading order, so a drag up or left works like a drag down or right.
    pub fn ordered(&self) -> ((usize, usize), (usize, usize)) {
        if self.anchor <= self.end {
            (self.anchor, self.end)
        } else {
            (self.end, self.anchor)
        }
    }

    /// Nothing selected: a click with no drag.
    pub fn is_empty(&self) -> bool {
        self.anchor == self.end
    }

    /// The selected character range within one document row, if the row is touched at all.
    pub fn span_in(&self, row: usize) -> Option<(usize, usize)> {
        let ((start_row, start_col), (end_row, end_col)) = self.ordered();
        if row < start_row || row > end_row {
            return None;
        }
        let from = if row == start_row { start_col } else { 0 };
        let to = if row == end_row { end_col } else { usize::MAX };
        Some((from, to))
    }

    /// The selected text, given the document's rows.
    pub fn text(&self, rows: &[String]) -> String {
        if self.is_empty() {
            return String::new();
        }
        let ((start_row, _), (end_row, _)) = self.ordered();
        let mut out: Vec<String> = Vec::new();
        for row in start_row..=end_row {
            let Some(text) = rows.get(row) else { break };
            let Some((from, to)) = self.span_in(row) else { continue };
            let chars: Vec<char> = text.chars().collect();
            let from = from.min(chars.len());
            let to = to.min(chars.len());
            let piece: String = chars[from..to].iter().collect();
            out.push(piece.trim_end().to_string());
        }
        out.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|line| line.to_string()).collect()
    }

    #[test]
    fn a_selection_inside_one_row_takes_that_slice() {
        let selection = Selection { anchor: (0, 2), end: (0, 5) };
        let document = rows(&["abcdefgh"]);
        assert_eq!(selection.text(&document), "cde");
    }

    #[test]
    fn a_selection_across_rows_joins_them_with_newlines() {
        // Column 4 is where "two" starts: column 3 would take the space before it.
        let selection = Selection { anchor: (0, 4), end: (2, 4) };
        let document = rows(&["one two", "middle", "three four"]);
        assert_eq!(selection.text(&document), "two\nmiddle\nthre");
    }

    #[test]
    fn a_backwards_drag_selects_the_same_text() {
        let forwards = Selection { anchor: (0, 3), end: (2, 4) };
        let backwards = Selection { anchor: (2, 4), end: (0, 3) };
        let document = rows(&["one two", "middle", "three four"]);
        assert_eq!(forwards.text(&document), backwards.text(&document));
        assert_eq!(forwards.ordered(), backwards.ordered());
    }

    #[test]
    fn trailing_space_is_trimmed_from_every_row() {
        let selection = Selection { anchor: (0, 0), end: (1, 6) };
        let document = rows(&["text    ", "more  "]);
        assert_eq!(selection.text(&document), "text\nmore", "the trailing space goes, the text stays");
    }

    #[test]
    fn a_click_with_no_drag_selects_nothing() {
        let selection = Selection::new((3, 7));
        assert!(selection.is_empty());
        assert_eq!(selection.span_in(3), Some((7, 7)));
        assert_eq!(selection.span_in(2), None, "an empty selection touches no other row");
        assert_eq!(selection.text(&rows(&["a"])), "");
    }

    #[test]
    fn a_row_is_touched_only_inside_its_range() {
        let selection = Selection { anchor: (1, 0), end: (3, 0) };
        assert_eq!(selection.span_in(0), None);
        assert_eq!(selection.span_in(1), Some((0, usize::MAX)));
        assert_eq!(selection.span_in(3), Some((0, 0)));
        assert_eq!(selection.span_in(4), None);
    }
}
