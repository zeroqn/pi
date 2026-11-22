//! Turning the model into one write: wrap, clip to the window, and paint only what changed.
//!
//! Every frame is wrapped in the synchronized-update markers `\x1b[?2026h` … `\x1b[?2026l`, which is
//! also what `acceptance.md` counts as a frame. Inside, three strategies, cheapest first:
//!
//! 1. **scroll** — the window shifted up by k rows and nothing else changed: scroll the region with
//!    `CSI k S` and paint only the k new rows at the bottom. A scrolled row cost 6 228 bytes in pi's
//!    TUI and 164 bytes after its incremental port; the same saving is available here.
//! 2. **row diff** — unchanged rows are not written at all.
//! 3. **full repaint** — a resize, or a screen whose shape changed.

use unicode_width::UnicodeWidthStr;

const SYNC_BEGIN: &str = "\x1b[?2026h";
const SYNC_END: &str = "\x1b[?2026l";

/// Wrap one logical line to `width` display cells. Wide characters count as their cell width; a
/// character wider than the window is replaced rather than allowed to overflow.
pub fn wrap(line: &str, width: usize, out: &mut Vec<String>) {
    if width == 0 {
        return;
    }
    if line.is_empty() {
        out.push(String::new());
        return;
    }
    let mut current = String::new();
    let mut used = 0usize;
    for ch in line.chars() {
        let cells = UnicodeWidthStr::width(ch.to_string().as_str());
        if used + cells > width {
            out.push(std::mem::take(&mut current));
            used = 0;
        }
        if cells > width {
            continue;
        }
        current.push(ch);
        used += cells;
    }
    out.push(current);
}

/// The rows to paint, bottom-aligned, plus the cursor position on the composer's row.
/// The wrapped window plus the cursor's place in it. `paint::compose` is what the frame uses now; this
/// stays because the ticket-03 tests drive it directly.
#[allow(dead_code)]
pub fn visible(transcript: &[String], composer: &str, width: usize, rows: usize) -> (Vec<String>, u16, u16) {
    let height = rows.saturating_sub(1);
    let mut wrapped: Vec<String> = Vec::new();
    for line in transcript {
        wrap(line, width, &mut wrapped);
    }
    let start = wrapped.len().saturating_sub(height);
    let mut window: Vec<String> = wrapped[start..].to_vec();
    while window.len() < height {
        window.push(String::new());
    }
    let mut composer_rows: Vec<String> = Vec::new();
    wrap(composer, width, &mut composer_rows);
    let composer_rows = if composer_rows.is_empty() { vec![String::new()] } else { composer_rows };
    let cursor_line = composer_rows.len() - 1;
    let cursor_col = UnicodeWidthStr::width(composer_rows[cursor_line].as_str()).min(width.saturating_sub(1));
    window.push(composer_rows.last().cloned().unwrap_or_default());
    let cursor_row = (window.len() - 1) as u16;
    (window, cursor_row, cursor_col as u16)
}

/// The visible window: the transcript's last `rows - bottom.len()` lines, then the bottom block
/// (widgets, status, dialog or composer), which is already wrapped.
/// Compose one frame from a **window** of already-wrapped transcript rows and an already-wrapped bottom
/// block. The window is the viewport's decision (ticket 03 of `.scratch/tui-rust-v2/map.md`), so this
/// function no longer assumes the tail: the caller picks `start` and this pads the height.
pub fn compose(
    window: &[pi_tui::render::StyledRow],
    bottom: &[pi_tui::render::StyledRow],
    width: usize,
    rows: usize,
) -> (Vec<pi_tui::render::StyledRow>, u16, u16) {
    let height = rows.saturating_sub(bottom.len()).max(1);
    let mut out: Vec<pi_tui::render::StyledRow> = window.iter().take(height).cloned().collect();
    out.resize(height, pi_tui::render::StyledRow::default());
    out.extend(bottom.iter().cloned());
    let cursor_row = out.len().saturating_sub(1) as u16;
    let cursor_col =
        bottom.last().map(|row| row.width()).unwrap_or(0).min(width.saturating_sub(1)) as u16;
    (out, cursor_row, cursor_col)
}

/// Mark a window's rows with the selection, in **document** coordinates: `first` is the document row of
/// `window[0]` (ticket 04 D6).
pub fn with_selection(
    window: Vec<pi_tui::render::StyledRow>,
    first: usize,
    selection: &pi_tui::selection::Selection,
) -> Vec<pi_tui::render::StyledRow> {
    window
        .into_iter()
        .enumerate()
        .map(|(index, row)| match selection.span_in(first + index) {
            Some((from, to)) => row.with_selection(from, to),
            None => row,
        })
        .collect()
}

/// Draw the scrollbar over the window's last column (ticket 03 D4): the bar covers the rightmost cell
/// rather than taking a column of its own, so text never re-wraps when it appears or fades.
pub fn with_scrollbar(
    window: Vec<pi_tui::render::StyledRow>,
    total: usize,
    first: usize,
    width: usize,
) -> Vec<pi_tui::render::StyledRow> {
    let height = window.len();
    if width == 0 || height == 0 {
        return window;
    }
    let (thumb_start, thumb_len) = pi_tui::viewport::thumb(total, height, first);
    window
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            let glyph = if index >= thumb_start && index < thumb_start + thumb_len { "█" } else { "│" };
            let mut row = row.truncate_cols(width - 1);
            row.spans.push(pi_tui::render::StyledSpan::new(glyph, pi_tui::theme::Role::Border));
            row
        })
        .collect()
}

/// Wrap a bottom block and keep it to half the screen: a long widget or a twelve-row list must not
/// squeeze the transcript to nothing.
pub fn bottom_block(rows: &[pi_tui::render::StyledRow], width: usize, screen_rows: usize) -> Vec<pi_tui::render::StyledRow> {
    let wrapped = pi_tui::render::wrap_rows(rows, width);
    let keep = screen_rows.max(2) / 2;
    wrapped[wrapped.len().saturating_sub(keep)..].to_vec()
}

/// The previous window, and how to get from it to the next one in as few bytes as possible.
#[derive(Default)]
pub struct Screen {
    previous: Vec<String>,
}

impl Screen {
    /// Whether the screen model has ever been painted.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.previous.is_empty()
    }

    /// Forget what the terminal is showing. Called when a frame was dropped before it reached the
    /// writer: the screen then holds a state between two frames, and diffing against it would paint
    /// rows that are already right and skip rows that are not.
    pub fn invalidate(&mut self) {
        self.previous.clear();
    }

    /// The bytes for one frame, and whether it was a full repaint.
    /// Paint a window of plain rows. Kept for the tests and for a caller with no theme; the live path is
    /// `frame_styled`, which diffs on plain text and colours only what it emits.
    #[allow(dead_code)]
    pub fn frame(&mut self, window: &[String], cursor_row: u16, cursor_col: u16) -> (Vec<u8>, bool) {
        let rows: Vec<pi_tui::render::StyledRow> = window.iter().cloned().map(pi_tui::render::StyledRow::plain).collect();
        self.frame_styled(&rows, &pi_tui::theme::Theme::default(), cursor_row, cursor_col)
    }

    /// Paint a window of styled rows: the diff compares **plain text** and the colour is rendered only for
    /// the rows that are emitted. Comparing ANSI strings instead would repaint a whole row for a colour
    /// change and would cost per-frame rendering of every visible row's escapes.
    pub fn frame_styled(
        &mut self,
        window_rows: &[pi_tui::render::StyledRow],
        theme: &pi_tui::theme::Theme,
        cursor_row: u16,
        cursor_col: u16,
    ) -> (Vec<u8>, bool) {
        let window: Vec<String> = window_rows.iter().map(|row| row.text()).collect();
        let ansi: Vec<String> = window_rows.iter().map(|row| row.ansi(theme)).collect();
        let (mut bytes, full) = self.frame_inner(&window, &ansi, cursor_row, cursor_col);
        bytes.truncate(bytes.len());
        (bytes, full)
    }

    fn frame_inner(&mut self, window: &[String], ansi: &[String], cursor_row: u16, cursor_col: u16) -> (Vec<u8>, bool) {
        let mut body = String::with_capacity(256);
        let full = self.previous.len() != window.len();
        let mut full_repaint = full;
        if !full {
            if let Some(shift) = self.scroll_shift(window) {
                // Rows rose by `shift`: scroll the region and repaint the bottom `shift` rows.
                let bottom = window.len() as u16;
                body.push_str(&format!("\x1b[1;{bottom}r"));
                if shift > 0 {
                    body.push_str(&format!("\x1b[{shift}S"));
                } else {
                    body.push_str(&format!("\x1b[{}T", -shift));
                }
                let from = if shift > 0 { window.len() - shift as usize } else { 0 };
                for (index, row) in window.iter().enumerate().skip(from) {
                    let _ = row;
                    body.push_str(&format!("\x1b[{};1H{}\x1b[K", index + 1, ansi[index]));
                }
                if shift < 0 {
                    // Rows moved down: the top rows are new.
                    for (index, _row) in window.iter().enumerate().take((-shift) as usize) {
                        body.push_str(&format!("\x1b[{};1H{}\x1b[K", index + 1, ansi[index]));
                    }
                }
                body.push_str(&format!("\x1b[{};{}H", cursor_row + 1, cursor_col + 1));
                self.previous = window.to_vec();
                return (frame_bytes(body), false);
            }
            for (index, row) in window.iter().enumerate() {
                if self.previous.get(index) != Some(row) {
                    body.push_str(&format!("\x1b[{};1H{}\x1b[K", index + 1, ansi[index]));
                }
            }
            if body.is_empty() {
                // Only the cursor moved.
                body.push_str(&format!("\x1b[{};{}H", cursor_row + 1, cursor_col + 1));
                self.previous = window.to_vec();
                return (frame_bytes(body), false);
            }
        } else {
            full_repaint = true;
            body.push_str("\x1b[H");
            for (index, _row) in window.iter().enumerate() {
                body.push_str(&ansi[index]);
                body.push_str("\x1b[K");
                if index + 1 < window.len() {
                    body.push_str("\r\n");
                }
            }
            body.push_str("\x1b[J");
        }
        body.push_str(&format!("\x1b[{};{}H", cursor_row + 1, cursor_col + 1));
        self.previous = window.to_vec();
        (frame_bytes(body), full_repaint)
    }

    /// How many rows the window advanced, when every surviving row moved by the same amount and the
    /// rows themselves are identical. `None` when the screen is not a pure scroll.
    fn scroll_shift(&self, window: &[String]) -> Option<i32> {
        let height = window.len() as i32;
        if height == 0 || self.previous.len() as i32 != height {
            return None;
        }
        for shift in 1..height {
            if self.previous[shift as usize..] == window[..(height - shift) as usize] {
                // The last `shift` rows are new; every row above them is the same row, moved.
                return Some(shift);
            }
        }
        None
    }
}

fn frame_bytes(body: String) -> Vec<u8> {
    let mut out = String::with_capacity(body.len() + SYNC_BEGIN.len() + SYNC_END.len());
    out.push_str(SYNC_BEGIN);
    out.push_str(&body);
    out.push_str(SYNC_END);
    out.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_on_cell_width() {
        let mut out = Vec::new();
        wrap("abcdef", 4, &mut out);
        assert_eq!(out, vec!["abcd", "ef"]);
        let mut wide = Vec::new();
        wrap("a\u{4e16}b", 2, &mut wide);
        assert_eq!(wide, vec!["a", "\u{4e16}", "b"]);
    }

    #[test]
    fn the_window_is_bottom_aligned_and_ends_with_the_composer() {
        let transcript: Vec<String> = (0..10).map(|i| format!("line {i}")).collect();
        let (window, cursor_row, _) = visible(&transcript, "hi", 20, 5);
        assert_eq!(window.len(), 5);
        assert_eq!(window[4], "hi");
        assert_eq!(cursor_row, 4);
        assert_eq!(window[3], "line 9");
    }

    #[test]
    fn compose_paints_the_window_it_is_given_not_the_tail() {
        use pi_tui::render::StyledRow;
        let window: Vec<StyledRow> = (0..3).map(|i| StyledRow::plain(format!("w{i}"))).collect();
        let bottom = vec![StyledRow::plain("composer".to_string())];
        let (frame, cursor_row, _) = compose(&window, &bottom, 40, 6);
        assert_eq!(frame.len(), 6);
        assert_eq!(frame[0].text(), "w0", "row 0 comes from the window's start");
        assert_eq!(frame[2].text(), "w2");
        assert_eq!(frame[3].text(), "", "the height is padded with blanks");
        assert_eq!(frame[5].text(), "composer");
        assert_eq!(cursor_row, 5);
    }

    #[test]
    fn the_scrollbar_overlays_the_last_column_without_widening_a_row() {
        use pi_tui::render::StyledRow;
        let window: Vec<StyledRow> = (0..4).map(|i| StyledRow::plain(format!("row {i} text here"))).collect();
        let bar = with_scrollbar(window.clone(), 40, 0, 10);
        assert_eq!(bar.len(), 4);
        for row in &bar {
            assert_eq!(row.width(), 10, "the bar sits inside the width, it does not add a column");
        }
        let glyphs: String = bar.iter().map(|row| row.text().chars().last().unwrap()).collect();
        assert!(glyphs.contains('█'), "the thumb is drawn: {glyphs}");
        assert!(glyphs.contains('│'), "the track is drawn: {glyphs}");
    }

    #[test]
    fn a_scrollbar_never_appears_on_a_document_that_fits() {
        use pi_tui::render::StyledRow;
        let window: Vec<StyledRow> = (0..4).map(|i| StyledRow::plain(format!("r{i}"))).collect();
        let bar = with_scrollbar(window, 4, 0, 10);
        let glyphs: String = bar.iter().map(|row| row.text().chars().last().unwrap()).collect();
        assert_eq!(glyphs, "████", "a document that fits shows a full thumb");
    }

    #[test]
    fn the_bottom_block_keeps_at_most_half_the_screen() {
        use pi_tui::render::StyledRow;
        let rows: Vec<StyledRow> = (0..20).map(|i| StyledRow::plain(format!("b{i}"))).collect();
        let kept = bottom_block(&rows, 40, 10);
        assert_eq!(kept.len(), 5, "half of ten rows");
        assert_eq!(kept.last().unwrap().text(), "b19", "the tail of the block is what stays");
    }

    #[test]
    fn an_unchanged_row_is_not_written_again() {
        let mut screen = Screen::default();
        let window: Vec<String> = (0..4).map(|i| format!("row {i}")).collect();
        let (first, full) = screen.frame(&window, 3, 0);
        assert!(full);
        let mut changed = window.clone();
        changed[2] = "row 2 changed".to_string();
        let (second, full) = screen.frame(&changed, 3, 0);
        assert!(!full);
        let text = String::from_utf8(second).unwrap();
        assert!(text.contains("row 2 changed"));
        assert!(!text.contains("row 0"));
        assert!(!text.contains("row 1"));
        assert!(first.len() > text.len());
    }

    #[test]
    fn a_pure_scroll_uses_the_scroll_region() {
        let mut screen = Screen::default();
        let window: Vec<String> = (0..6).map(|i| format!("row {i}")).collect();
        let _ = screen.frame(&window, 5, 0);
        let shifted: Vec<String> = (2..8).map(|i| format!("row {i}")).collect();
        let (bytes, full) = screen.frame(&shifted, 5, 0);
        assert!(!full);
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("\x1b[1;6r"), "expected a scroll region: {text:?}");
        assert!(text.contains("\x1b[2S"), "expected a two-row scroll: {text:?}");
        // Only the two new rows are painted.
        assert!(!text.contains("row 3"));
        assert!(text.contains("row 6"));
        assert!(text.contains("row 7"));
    }

    #[test]
    fn every_frame_is_wrapped_in_the_sync_markers() {
        let mut screen = Screen::default();
        let (bytes, _) = screen.frame(&["a".to_string()], 0, 0);
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with("\x1b[?2026h"));
        assert!(text.ends_with("\x1b[?2026l"));
    }
}
