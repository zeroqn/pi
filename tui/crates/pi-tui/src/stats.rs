//! The frame histogram, from the first commit.
//!
//! `acceptance.md` C-12: one command produces every number. The client keeps its own samples and
//! writes them as one JSON object on exit, so a harness can read them without parsing the terminal.

use std::time::Duration;

#[derive(Default)]
pub struct Stats {
    pub frames: u64,
    pub bytes: u64,
    pub paint_ms: Vec<f64>,
    pub echo_ms: Vec<f64>,
    /// Frames a newer event arrived during: the coalescing that keeps the loop from pegging.
    pub coalesced: u64,
    /// Frames painted because a key arrived, outside the 16 ms budget.
    pub input_frames: u64,
    /// Frames whose whole window had to be written again (resize, or a shape change).
    pub full_repaints: u64,
    /// Frames replaced before the writer wrote them: the price of a slow terminal.
    pub frames_dropped: u64,
    /// The longest single `write_all` on the writer thread. If this is large while `paint_ms` is small,
    /// the blocking lives where it belongs: off the paint thread.
    pub write_blocked_ms: u64,
}

impl Stats {
    pub fn paint(&mut self, took: Duration, bytes: usize) {
        self.frames += 1;
        self.bytes += bytes as u64;
        if self.paint_ms.len() < 100_000 {
            self.paint_ms.push(took.as_secs_f64() * 1000.0);
        }
    }

    pub fn echo(&mut self, took: Duration) {
        if self.echo_ms.len() < 100_000 {
            self.echo_ms.push(took.as_secs_f64() * 1000.0);
        }
    }

    pub fn json(&self) -> String {
        format!(
            "{{\"frames\":{},\"bytes\":{},\"coalesced\":{},\"input_frames\":{},\"full_repaints\":{},\"frames_dropped\":{},\"write_blocked_ms\":{},\"paint_ms\":{},\"echo_ms\":{}}}",
            self.frames,
            self.bytes,
            self.coalesced,
            self.input_frames,
            self.full_repaints,
            self.frames_dropped,
            self.write_blocked_ms,
            summary(&self.paint_ms),
            summary(&self.echo_ms)
        )
    }
}

fn summary(samples: &[f64]) -> String {
    if samples.is_empty() {
        return "{\"n\":0}".to_string();
    }
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let pick = |q: f64| sorted[((sorted.len() - 1) as f64 * q).round() as usize];
    format!(
        "{{\"n\":{},\"p50\":{:.3},\"p95\":{:.3},\"p99\":{:.3},\"max\":{:.3}}}",
        sorted.len(),
        pick(0.50),
        pick(0.95),
        pick(0.99),
        sorted[sorted.len() - 1]
    )
}
