//! Per-chunk markdown cost: whole-source re-parse against `StreamingMarkdown` (ticket 06).
//!
//!     cargo run --release --example markdown_bench -- --kind prose --size 26900 --chunk 12
//!
//! Prints one JSON line: chunks, and per-chunk average / p99 / worst for both implementations, so a
//! harness can compare without trusting a table someone typed.

use std::time::Instant;

fn chunks_for(kind: &str, size: usize) -> String {
    match kind {
        // A growing fenced TypeScript block: the shape that cost upstream 96 % of its streaming time.
        "fence" => {
            let mut body = String::from("```ts\n");
            let mut i = 0u32;
            while body.len() < size.saturating_sub(4) {
                body.push_str(&format!("const v{index} = compute({index}, 'x');\n", index = i));
                i += 1;
            }
            body.push_str("```\n");
            body
        }
        // Prose with a paragraph and a list, so blocks actually close while streaming.
        _ => {
            let mut body = String::new();
            let mut i = 0u32;
            while body.len() < size {
                if i % 8 == 0 {
                    body.push_str("Para with **emphasis** and `code` words to lex.\n\n");
                } else {
                    body.push_str(&format!("- bullet {i} with some words in it\n"));
                }
                i += 1;
            }
            body
        }
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut kind = String::from("prose");
    let mut size = 26_900usize;
    let mut chunk = 12usize;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--kind" => kind = args.next().unwrap_or(kind),
            "--size" => size = args.next().and_then(|v| v.parse().ok()).unwrap_or(size),
            "--chunk" => chunk = args.next().and_then(|v| v.parse().ok()).unwrap_or(chunk),
            other => {
                eprintln!("unknown argument {other}");
                std::process::exit(2);
            }
        }
    }
    let source = chunks_for(&kind, size);
    let chunk = chunk.max(1);

    let mut full_samples = Vec::new();
    let mut stream_samples = Vec::new();
    let mut streaming = pi_tui::markdown::StreamingMarkdown::new();
    let mut chunks = 0;
    let mut at = 0;
    while at < source.len() {
        at = (at + chunk).min(source.len());
        // A chunk boundary must land on a character boundary; the fixtures are ASCII by construction.
        let prefix = &source[..at];

        let started = Instant::now();
        let _ = pi_tui::markdown::render_block(prefix);
        full_samples.push(started.elapsed().as_secs_f64() * 1000.0);

        let started = Instant::now();
        streaming.update(prefix);
        stream_samples.push(started.elapsed().as_secs_f64() * 1000.0);
        chunks += 1;
    }

    let stats = |samples: &[f64]| {
        let mut sorted = samples.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let avg = if sorted.is_empty() { 0.0 } else { sorted.iter().sum::<f64>() / sorted.len() as f64 };
        let p99 = percentile(&sorted, 0.99);
        let worst = sorted.last().copied().unwrap_or(0.0);
        format!("{{\"avg_ms\":{avg:.4},\"p99_ms\":{p99:.4},\"worst_ms\":{worst:.4}}}")
    };
    println!(
        "{{\"chunks\":{chunks},\"kind\":\"{kind}\",\"size\":{size},\"full\":{},\"stream\":{}}}",
        stats(&full_samples),
        stats(&stream_samples)
    );
}

fn percentile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() - 1) as f64 * q).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}
