//! Where the transcript window sits in the document, and whether it follows new rows.
//!
//! Seven decisions from ticket 03 of `.scratch/tui-rust-v2/map.md` live here:
//!
//! * **D1** follow is a boolean beside the offset, and a motion that lands on the last page re-arms it;
//! * **D2** the offset is fixed in rows while content grows below it;
//! * **D5** a width change keeps the **block** that was at the top, not the row number, because a re-wrap
//!   moves every row.
//!
//! The document is described by [`DocMap`]: one row count per block and the running start offset. The
//! transcript builds it from its row cache, and the tests build it by hand.

/// The document's shape: how many rows each block has, and where each starts.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DocMap {
    starts: Vec<usize>,
    counts: Vec<usize>,
    total: usize,
}

impl DocMap {
    pub fn new(counts: Vec<usize>) -> DocMap {
        let mut starts = Vec::with_capacity(counts.len());
        let mut total = 0usize;
        for count in &counts {
            starts.push(total);
            total += count;
        }
        DocMap { starts, counts, total }
    }

    pub fn total(&self) -> usize {
        self.total
    }

    pub fn blocks(&self) -> usize {
        self.counts.len()
    }

    pub fn count(&self, block: usize) -> usize {
        self.counts.get(block).copied().unwrap_or(0)
    }

    pub fn start_of(&self, block: usize) -> usize {
        self.starts.get(block).copied().unwrap_or(self.total)
    }

    /// Which block a document row belongs to, and its offset inside that block.
    pub fn item_of(&self, row: usize) -> (usize, usize) {
        if self.counts.is_empty() {
            return (0, 0);
        }
        // The last block that starts at or before `row`.
        let block = match self.starts.binary_search(&row) {
            Ok(index) => index,
            Err(next) => next.saturating_sub(1),
        };
        let block = block.min(self.counts.len() - 1);
        (block, row - self.starts[block])
    }
}

/// The window over the document.
#[derive(Clone, Debug)]
pub struct Viewport {
    offset: usize,
    following: bool,
}

impl Default for Viewport {
    fn default() -> Self {
        Viewport { offset: 0, following: true }
    }
}

impl Viewport {
    pub fn new() -> Viewport {
        Viewport::default()
    }

    pub fn following(&self) -> bool {
        self.following
    }

    pub fn offset(&self) -> usize {
        self.offset
    }

    /// The last offset the window can sit at, so the document's tail is at the screen's bottom.
    pub fn max_top(&self, map: &DocMap, height: usize) -> usize {
        map.total().saturating_sub(height.max(1))
    }

    /// Start row and height of the window actually painted.
    pub fn window(&self, map: &DocMap, height: usize) -> (usize, usize) {
        let height = height.max(1);
        let start = self.offset.min(self.max_top(map, height));
        (start, height)
    }

    /// Move by `delta` rows. Landing on the last page re-arms follow (D1); moving away clears it (D2's
    /// companion: while not following, the offset stays put as content grows).
    pub fn scroll_by(&mut self, delta: isize, map: &DocMap, height: usize) -> bool {
        let max = self.max_top(map, height);
        let next = (self.offset as isize + delta).clamp(0, max as isize) as usize;
        let before = (self.offset, self.following);
        self.offset = next;
        self.following = next == max;
        before != (self.offset, self.following)
    }

    /// Jump to the first row: never follows.
    pub fn to_top(&mut self, map: &DocMap, height: usize) -> bool {
        let before = (self.offset, self.following);
        self.offset = 0;
        self.following = self.max_top(map, height) == 0;
        before != (self.offset, self.following)
    }

    /// Jump to the last page: follows.
    pub fn to_bottom(&mut self, map: &DocMap, height: usize) -> bool {
        let max = self.max_top(map, height);
        let changed = (self.offset, self.following) != (max, true);
        self.offset = max;
        self.following = true;
        changed
    }

    /// The document grew, or the window changed height: a follower pins the tail, anyone else keeps the
    /// rows they were reading (D2).
    pub fn settle(&mut self, map: &DocMap, height: usize) {
        if self.following {
            self.offset = self.max_top(map, height);
        } else {
            self.offset = self.offset.min(self.max_top(map, height));
        }
    }

    /// The width changed: keep the block at the top (D5). Every row moved, so a row number would land in
    /// another message; the block and its offset inside it survive a re-wrap.
    pub fn resettle(&mut self, before: &DocMap, after: &DocMap, height: usize) {
        if self.following || before.total() == 0 {
            self.settle(after, height);
            return;
        }
        let (block, inside) = before.item_of(self.offset);
        let inside = inside.min(after.count(block).saturating_sub(1));
        self.offset = (after.start_of(block) + inside).min(self.max_top(after, height));
    }
}

/// The scrollbar's thumb as `(start, len)` inside a window of `height` rows (ticket 03 D4): long enough
/// to grab (`height² / total`, at least one row), positioned by the offset, and full height when the
/// document fits.
pub fn thumb(total: usize, height: usize, first: usize) -> (usize, usize) {
    let height = height.max(1);
    if total <= height {
        return (0, height);
    }
    let len = ((height * height) / total).max(1).min(height);
    let travel = height - len;
    let max_first = total - height;
    let start = if max_first == 0 { 0 } else { (first.min(max_first) * travel) / max_first };
    (start, len)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Three blocks of 10, 20 and 30 rows.
    fn map() -> DocMap {
        DocMap::new(vec![10, 20, 30])
    }

    #[test]
    fn a_fresh_viewport_follows_the_tail() {
        let mut view = Viewport::new();
        let map = map();
        view.settle(&map, 10);
        assert_eq!(view.offset(), 50, "60 rows, a 10-row window: the tail starts at 50");
        assert!(view.following());
    }

    #[test]
    fn scrolling_away_stops_following_and_landing_on_the_tail_re_arms_it() {
        let mut view = Viewport::new();
        let map = map();
        view.settle(&map, 10);
        assert!(view.scroll_by(-25, &map, 10));
        assert!(!view.following(), "25 rows up must stop following");
        assert_eq!(view.offset(), 25);
        assert!(view.scroll_by(25, &map, 10), "back to the last page");
        assert!(view.following(), "landing on the last row re-arms follow");
        assert_eq!(view.offset(), 50);
    }

    #[test]
    fn a_growing_document_moves_a_follower_and_leaves_a_reader_alone() {
        let map = map();
        let mut follower = Viewport::new();
        follower.settle(&map, 10);
        let grown = DocMap::new(vec![10, 20, 40]);
        follower.settle(&grown, 10);
        assert_eq!(follower.offset(), 60, "a follower pins the new tail");

        let mut reader = Viewport::new();
        reader.settle(&map, 10);
        reader.scroll_by(-20, &map, 10);
        let before = reader.offset();
        reader.settle(&grown, 10);
        assert_eq!(reader.offset(), before, "a reader keeps the rows they are reading");
    }

    #[test]
    fn a_resize_keeps_the_block_at_the_top_not_the_row_number() {
        let mut view = Viewport::new();
        let before = map();
        view.settle(&before, 10);
        view.scroll_by(-30, &before, 10);
        // The top row (20) is inside block 1 (rows 10..30), 10 rows into it.
        assert_eq!(before.item_of(view.offset()), (1, 10));
        // A narrower width re-wraps: block 1 grows to 30 rows, block 2 shrinks to 20.
        let after = DocMap::new(vec![15, 30, 20]);
        view.resettle(&before, &after, 10);
        assert_eq!(after.item_of(view.offset()).0, 1, "still in the same block");
        assert_eq!(after.item_of(view.offset()).1, 10, "and the same row inside it");
        assert_eq!(view.offset(), 15 + 10);
    }

    #[test]
    fn the_offset_clamps_within_the_document() {
        let mut view = Viewport::new();
        let map = map();
        view.settle(&map, 10);
        assert!(!view.scroll_by(100, &map, 10), "already at the bottom: nothing moves");
        assert_eq!(view.offset(), 50);
        let taller = Viewport::new();
        assert_eq!(taller.window(&map, 100), (0, 100), "a window taller than the document starts at 0");
    }

    #[test]
    fn the_thumb_is_a_full_column_when_the_document_fits() {
        assert_eq!(thumb(3, 10, 0), (0, 10));
        assert_eq!(thumb(10, 10, 0), (0, 10));
    }

    #[test]
    fn the_thumb_shrinks_with_the_document_and_sits_at_its_share() {
        let (start, len) = thumb(100, 10, 0);
        assert_eq!((start, len), (0, 1), "one hundred rows in ten: a one-row thumb at the top");
        let (start, len) = thumb(100, 10, 90);
        assert_eq!(len, 1);
        assert_eq!(start, 9, "at the tail the thumb is the last row");
        let (start, len) = thumb(100, 10, 45);
        assert_eq!((start, len), (4, 1), "half way is half way");
    }

    #[test]
    fn a_document_shorter_than_the_window_always_follows() {
        let mut view = Viewport::new();
        let short = DocMap::new(vec![3]);
        view.settle(&short, 10);
        assert_eq!(view.offset(), 0);
        assert!(view.to_top(&short, 10) == false, "already at the top");
    }
}
