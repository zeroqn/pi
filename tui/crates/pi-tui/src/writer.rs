//! The writer: one thread owns the terminal's writes, and the paint thread never blocks on it.
//!
//! Why this exists, measured twice: on a TTY Bun's `process.stdout.write` blocks the JS thread, and in
//! Rust a `write(2)` blocks just as well — the skeleton recorded a **607 ms** paint blocked against a
//! pty that was not being drained (`results/2026-11-21-pi-tui-skeleton.md`). A slow terminal must cost
//! *frames*, never bytes: the slot below holds at most one pending frame and a newer one replaces it,
//! so a backed-up writer loses pictures, never correctness.

use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

#[derive(Default)]
pub struct Counters {
    pub written: AtomicU64,
    pub dropped: AtomicU64,
    pub bytes: AtomicU64,
    /// Milliseconds the writer spent inside a single `write_all` — the number that would have been the
    /// paint thread's stall before this thread existed.
    pub blocked_ms: AtomicU64,
}

struct Slot {
    frame: Option<Vec<u8>>,
    closing: bool,
}

pub struct Writer {
    shared: Arc<(Mutex<Slot>, Condvar)>,
    counters: Arc<Counters>,
    handle: Option<thread::JoinHandle<()>>,
}

impl Writer {
    pub fn spawn() -> Writer {
        let shared = Arc::new((Mutex::new(Slot { frame: None, closing: false }), Condvar::new()));
        let counters = Arc::new(Counters::default());
        let worker_shared = Arc::clone(&shared);
        let worker_counters = Arc::clone(&counters);
        let handle = thread::Builder::new()
            .name("tty-writer".into())
            .spawn(move || {
                let mut out = std::io::stdout();
                loop {
                    let frame = {
                        let (lock, condvar) = &*worker_shared;
                        let mut slot = lock.lock().expect("the writer slot");
                        while slot.frame.is_none() && !slot.closing {
                            slot = condvar.wait(slot).expect("the writer slot");
                        }
                        if slot.closing {
                            return;
                        }
                        slot.frame.take()
                    };
                    let Some(frame) = frame else { continue };
                    let started = std::time::Instant::now();
                    if out.write_all(&frame).is_err() || out.flush().is_err() {
                        return;
                    }
                    worker_counters.written.fetch_add(1, Ordering::Relaxed);
                    worker_counters.bytes.fetch_add(frame.len() as u64, Ordering::Relaxed);
                    worker_counters
                        .blocked_ms
                        .store(started.elapsed().as_millis() as u64, Ordering::Relaxed);
                }
            })
            .expect("a writer thread");
        Writer { shared, counters, handle: Some(handle) }
    }

    /// Hand a frame over. Returns `false` when an older, unwritten frame was replaced — the drop that
    /// keeps a slow terminal from delaying the paint thread.
    pub fn submit(&self, frame: Vec<u8>) -> bool {
        let (lock, condvar) = &*self.shared;
        let mut slot = lock.lock().expect("the writer slot");
        let replaced = slot.frame.is_some();
        if replaced {
            self.counters.dropped.fetch_add(1, Ordering::Relaxed);
        }
        slot.frame = Some(frame);
        condvar.notify_one();
        !replaced
    }

    pub fn counters(&self) -> &Counters {
        &self.counters
    }

    /// Wait for the last frame to land, then stop. Called before the alternate screen is left, so the
    /// screen a user sees is the one the client last computed.
    pub fn finish(mut self) {
        {
            let (lock, condvar) = &*self.shared;
            let mut slot = lock.lock().expect("the writer slot");
            slot.closing = true;
            condvar.notify_all();
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}
