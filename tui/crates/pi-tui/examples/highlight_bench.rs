//! Highlight cost: whole-block re-highlight against line-level resume (ticket 05).
//!
//!     cargo run --release --example highlight_bench -- --size 15700 --chunk 12
//!
//! `full` reconstructs a `HighlightLines` from scratch and highlights every line — what upstream pi's
//! `cli-highlight` path does per chunk. `resume` keeps the cache and papers over only the new lines.

use std::time::Instant;

use pi_tui::highlight::{self, Cache};

fn block(size: usize) -> String {
    let mut body = String::new();
    let mut i = 0u32;
    while body.len() < size {
        body.push_str(&format!("const value{i} = compute({i}, \"label-{i}\");\n"));
        i += 1;
    }
    body
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut size = 15_700usize;
    let mut chunk = 12usize;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--size" => size = args.next().and_then(|v| v.parse().ok()).unwrap_or(size),
            "--chunk" => chunk = args.next().and_then(|v| v.parse().ok()).unwrap_or(chunk),
            other => {
                eprintln!("unknown argument {other}");
                std::process::exit(2);
            }
        }
    }
    let source = block(size);
    let chunk = chunk.max(1);
    let mut full_samples = Vec::new();
    let mut resume_samples = Vec::new();
    let mut cache = Cache::new("ts");
    let mut at = 0;
    let mut chunks = 0;
    while at < source.len() {
        at = (at + chunk).min(source.len());
        let prefix = &source[..at];

        let started = Instant::now();
        let mut fresh = Cache::new("ts");
        let _ = highlight::highlight_into(prefix, &mut fresh);
        full_samples.push(started.elapsed().as_secs_f64() * 1000.0);

        let started = Instant::now();
        let _ = highlight::highlight_into(prefix, &mut cache);
        resume_samples.push(started.elapsed().as_secs_f64() * 1000.0);
        chunks += 1;
    }
    let stats = |samples: &[f64]| {
        let mut sorted = samples.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let avg = if sorted.is_empty() { 0.0 } else { sorted.iter().sum::<f64>() / sorted.len() as f64 };
        let index = ((sorted.len() - 1) as f64 * 0.99).round() as usize;
        let p99 = sorted[index.min(sorted.len() - 1)];
        let worst = sorted.last().copied().unwrap_or(0.0);
        format!("{{\"avg_ms\":{avg:.4},\"p99_ms\":{p99:.4},\"worst_ms\":{worst:.4}}}")
    };
    println!(
        "{{\"chunks\":{chunks},\"size\":{size},\"full\":{},\"resume\":{}}}",
        stats(&full_samples),
        stats(&resume_samples)
    );
}
