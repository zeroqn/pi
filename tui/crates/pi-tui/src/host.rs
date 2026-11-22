//! Where lines come from: a real `pi --mode rpc` child, or a recorded fixture replayed at a pace.
//!
//! Both produce the same `Value` stream and accept the same commands, so the client's rendering path
//! is identical in a test and in daily use. The child's stdout is read on its own thread and the
//! child's stdin is written on another: neither may ever block the thread that paints.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};

pub struct Host {
	pub events: Receiver<serde_json::Value>,
	commands: Sender<serde_json::Value>,
	child: Option<Child>,
	kind: &'static str,
}

impl Host {
	/// A child process speaking the RPC protocol on its pipes.
	pub fn spawn(argv: &[String], envs: &[(String, String)]) -> std::io::Result<Host> {
		let mut command = Command::new(&argv[0]);
		command
			.args(&argv[1..])
			.stdin(Stdio::piped())
			.stdout(Stdio::piped())
			.stderr(Stdio::inherit());
		for (key, value) in envs {
			command.env(key, value);
		}
		let mut child = command.spawn()?;
		let stdout = child.stdout.take().expect("a piped stdout");
		let stdin = child.stdin.take().expect("a piped stdin");
		let (event_tx, events) = channel();
		read_lines(BufReader::new(stdout), event_tx);
		let commands = write_commands(stdin);
		Ok(Host { events, commands, child: Some(child), kind: "rpc" })
	}

	/// A fixture recorded by `tools/harness/record_corpus.py`, fed at `pace` per line.
	///
	/// `repeat` replays the fixture again on end, which is how a measurement keeps the client under
	/// sustained streaming load for as long as it needs.
	pub fn replay(path: &str, pace: Duration, repeat: usize) -> std::io::Result<Host> {
		let file = std::fs::File::open(path)?;
		let (event_tx, events) = channel();
		let (command_tx, _command_rx) = channel::<serde_json::Value>();
		let body = BufReader::new(file);
		thread::Builder::new().name("replay".into()).spawn(move || {
			let mut lines: Vec<serde_json::Value> = Vec::new();
			for line in body.lines() {
				let Ok(line) = line else { break };
				let trimmed = line.trim();
				if trimmed.is_empty() {
					continue;
				}
				if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
					lines.push(value);
				}
			}
			for _ in 0..repeat.max(1) {
				for value in &lines {
					if event_tx.send(value.clone()).is_err() {
						return;
					}
					if !pace.is_zero() {
						thread::sleep(pace);
					}
				}
			}
		})?;
		Ok(Host { events, commands: command_tx, child: None, kind: "replay" })
	}

	pub fn send(&self, command: serde_json::Value) {
		// A closed channel means the host is gone; the client reports that as an event, not a crash.
		let _ = self.commands.send(command);
	}

    /// Which host the run used (rpc or replay), for a results file.
    #[allow(dead_code)]
	pub fn kind(&self) -> &'static str {
		self.kind
	}

	/// `Some(code)` once the child has exited, `None` while it runs (or in replay).
	pub fn exited(&mut self) -> Option<i32> {
		match self.child.as_mut() {
			Some(child) => match child.try_wait() {
				Ok(Some(status)) => Some(status.code().unwrap_or(-1)),
				_ => None,
			},
			None => None,
		}
	}

	pub fn shutdown(&mut self) {
		if let Some(mut child) = self.child.take() {
			let _ = child.kill();
			let _ = child.wait();
		}
	}
}

fn read_lines(stdout: BufReader<std::process::ChildStdout>, tx: Sender<serde_json::Value>) {
	thread::Builder::new()
		.name("host-reader".into())
		.spawn(move || {
			let mut reader = stdout;
			let mut line = String::new();
			loop {
				line.clear();
				match reader.read_line(&mut line) {
					Ok(0) | Err(_) => return,
					Ok(_) => {}
				}
				let trimmed = line.trim();
				if trimmed.is_empty() {
					continue;
				}
				let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else { continue };
				if tx.send(value).is_err() {
					return;
				}
			}
		})
		.expect("a reader thread");
}

fn write_commands(mut stdin: ChildStdin) -> Sender<serde_json::Value> {
	let (tx, rx) = channel::<serde_json::Value>();
	thread::Builder::new()
		.name("host-writer".into())
		.spawn(move || {
			while let Ok(command) = rx.recv() {
				if serde_json::to_writer(&mut stdin, &command).is_err() {
					return;
				}
				if stdin.write_all(b"\n").is_err() || stdin.flush().is_err() {
					return;
				}
			}
		})
		.expect("a writer thread");
	tx
}

/// Seconds since the process started, for the fixture replay's own pacing reference.
/// Timing helper kept for the harness-facing replays.
#[allow(dead_code)]
pub fn elapsed_since(start: Instant) -> f64 {
	start.elapsed().as_secs_f64()
}
