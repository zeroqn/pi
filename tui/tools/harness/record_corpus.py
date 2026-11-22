#!/usr/bin/env python3
"""Record the RPC event corpus (ticket 01 of the Rust-TUI effort).

Drives `pi --mode rpc` over its stdin/stdout pipes through five scenarios and writes one JSONL fixture
per scenario, raw and unedited: every line the host printed, in order.

    text      get_state, get_available_models, get_commands, get_session_stats, then a prose answer
    code      an answer containing a fenced ```ts block that arrives in 12-byte pieces
    tool      one `bash` tool call printing 1 200 lines, then a short answer
    compact   a short answer, then a manual compact and its compaction events
    dialog    every `ctx.ui` method RPC mode carries, answered by the client side

Usage:
    python3 record_corpus.py --pi pi --out ../../../../.scratch/tui-rust/fixtures

The fixtures are what `crates/pi-rpc` parses in its tests: a schema change in pi shows up there as a
failing test rather than as a blank screen in the client.
"""

import argparse
import json
import os
import queue
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from harness import MODEL_ARGS, fake_model, pi_env, pi_home, workdir  # noqa: E402

TERMINAL_EVENTS = {"agent_settled", "agent_end"}


class Recorder:
	"""One RPC host: a child process, a reader thread, and the raw lines it produced."""

	def __init__(self, argv, env, cwd, ext=None, answer=None):
		self.argv = [*argv, "--mode", "rpc", *MODEL_ARGS]
		if ext:
			self.argv += ["-e", str(ext)]
		self.proc = subprocess.Popen(
			self.argv,
			cwd=cwd,
			env=env,
			stdin=subprocess.PIPE,
			stdout=subprocess.PIPE,
			stderr=open(os.path.join(str(cwd), f".rpc-{int(time.time())}.stderr"), "wb"),
			text=True,
			bufsize=1,
		)
		self.answer = answer
		self.lines: list[str] = []
		self.queue: "queue.Queue[str | None]" = queue.Queue()
		self.reader = threading.Thread(target=self._read, daemon=True)
		self.reader.start()

	def _read(self):
		assert self.proc.stdout is not None
		for line in self.proc.stdout:
			line = line.rstrip("\n")
			if line:
				self.lines.append(line)
				self.queue.put(line)
		self.queue.put(None)

	def send(self, obj):
		if self.proc.poll() is not None:
			raise RuntimeError(f"the host exited with {self.proc.returncode} before {json.dumps(obj)[:60]}")
		assert self.proc.stdin is not None
		self.proc.stdin.write(json.dumps(obj) + "\n")
		self.proc.stdin.flush()

	def next_line(self, timeout):
		try:
			return self.queue.get(timeout=timeout)
		except queue.Empty:
			return None

	def drain(self, timeout, until=None, answer_timeout=1.5):
		"""Read until `until(line)` is true, or `timeout` passes.

		The recorder's `answer` hook is called with each parsed line; if it returns a dict, that is sent
		back (an extension_ui_response). Every drain answers, or a dialog would be swallowed by whichever
		read happened to consume it. Returns the lines seen."""
		seen = []
		deadline = time.time() + timeout
		idle_since = None
		while time.time() < deadline:
			line = self.next_line(min(0.5, max(0.01, deadline - time.time())))
			if line is None:
				if until is None and self.answer is not None:
					# The dialog scenario: no fixed terminal event, so stop after quiet.
					idle_since = idle_since or time.time()
					if time.time() - idle_since > answer_timeout:
						return seen
				continue
			idle_since = None
			seen.append(line)
			parsed = json.loads(line)
			if self.answer is not None:
				reply = self.answer(parsed)
				if reply:
					self.send(reply)
			if until is not None and until(parsed):
				return seen
		return seen

	def close(self):
		try:
			if self.proc.stdin:
				self.proc.stdin.close()
		except OSError:
			pass
		self.proc.terminate()
		try:
			self.proc.wait(timeout=10)
		except subprocess.TimeoutExpired:
			self.proc.kill()
			self.proc.wait()


def is_event(name):
	return lambda line: line.get("type") == name


def single_event(events, types):
	return any(e.get("type") in types for e in (json.loads(x) for x in events))


def dialog_answer(line):
	if line.get("type") != "extension_ui_request":
		return None
	method, rid = line.get("method"), line.get("id")
	if method == "select":
		return {"type": "extension_ui_response", "id": rid, "value": line["options"][1]}
	if method == "confirm":
		return {"type": "extension_ui_response", "id": rid, "confirmed": True}
	if method in ("input", "editor"):
		return {"type": "extension_ui_response", "id": rid, "value": "corpus answer"}
	return None


def scenario_controls(rec):
	"""Command/response pairs the client issues when it attaches: state, models, commands, stats."""
	for command, cid in (("get_state", "c1"), ("get_available_models", "c2"), ("get_commands", "c3"), ("get_session_stats", "c4")):
		rec.send({"id": cid, "type": command})
		rec.drain(30, until=lambda line, c=cid: line.get("type") == "response" and line.get("id") == c)

SCENARIOS = {
	"text": {"prompt": "PLAIN: describe the render path", "controls": True},
	"code": {"prompt": "CODE: show the frame function"},
	"tool": {"prompt": "BASH: print the numbered lines"},
	"compact": {"prompts": ["PLAIN: first turn", "PLAIN: second turn", "PLAIN: third turn"], "compact": True, "context_window": 8000},
	"dialog": {"prompt": "/corpus-ui", "ext": HERE / "corpus-ext.ts"},
}


def shrink_context(home, window):
	"""Rewrite the throwaway home's model catalog with a small context window.

	Compaction refuses with "Nothing to compact (session too small)" against a 200 000-token window,
	because nothing is old enough to cut. A small window makes the compaction events reachable."""
	path = os.path.join(str(home), "models.json")
	models = json.loads(open(path).read())
	for provider in models["providers"].values():
		for model in provider["models"]:
			model["contextWindow"] = window
			model["maxTokens"] = 1000
	open(path, "w").write(json.dumps(models, indent=2))
	open(os.path.join(str(home), "models.yml"), "w").write(open(path).read())
	# Small compaction budgets: with the default 20 000 kept-recent tokens the cut point lands on the
	# first entry, so there is nothing to summarize and compaction refuses.
	settings_path = os.path.join(str(home), "settings.json")
	settings = json.loads(open(settings_path).read())
	settings["compaction"] = {"enabled": True, "reserveTokens": 200, "keepRecentTokens": 200}
	open(settings_path, "w").write(json.dumps(settings, indent=2))


def record(name, spec, argv, outdir, pace_ms):
	with fake_model(pace_ms=pace_ms, script="fake_model_corpus.py") as port, pi_home(port) as home, workdir() as cwd:
		if spec.get("context_window"):
			shrink_context(home, spec["context_window"])
		# A bash tool call must be allowed to run in the throwaway project.
		rec = Recorder(argv, pi_env(home), cwd, ext=spec.get("ext"), answer=dialog_answer if spec.get("ext") else None)
		try:
			rec.drain(60, until=is_event("session_start"), timeout=60) if False else None
			if spec.get("controls"):
				scenario_controls(rec)
			prompts = spec.get("prompts") or ([spec["prompt"]] if spec.get("prompt") else [])
			for index, message in enumerate(prompts):
				rec.send({"id": f"p{index}", "type": "prompt", "message": message})
				rec.drain(180, until=lambda line: line.get("type") in TERMINAL_EVENTS)
			if spec.get("compact"):
				rec.send({"id": "k1", "type": "compact"})
				rec.drain(180, until=is_event("compaction_end"))
			if spec.get("ext"):
				rec.drain(30)
				if rec.proc.poll() is None:
					rec.send({"id": "c9", "type": "get_state"})
					rec.drain(30, until=lambda line: line.get("type") == "response" and line.get("id") == "c9")
		finally:
			rec.close()
			if rec.proc.returncode not in (0, -15, None):
				print(f"{name}: host exited {rec.proc.returncode}", file=sys.stderr)
	path = outdir / f"{name}.jsonl"
	path.write_text("\n".join(rec.lines) + "\n")
	return path, len(rec.lines)


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--pi", default="pi", help="pi executable (or a command line to one)")
	ap.add_argument("--out", required=True, help="fixture directory")
	ap.add_argument("--pace-ms", type=float, default=2.0, help="model chunk pace")
	ap.add_argument("--only", help="comma-separated scenario names")
	a = ap.parse_args()
	outdir = Path(a.out)
	outdir.mkdir(parents=True, exist_ok=True)
	argv = os.path.expanduser(a.pi).split()
	wanted = a.only.split(",") if a.only else list(SCENARIOS)
	index = {}
	for name in wanted:
		path, count = record(name, SCENARIOS[name], argv, outdir, a.pace_ms)
		print(f"{name:8s} {count:6d} lines -> {path}")
		index[name] = {"file": path.name, "lines": count, "scenario": SCENARIOS[name].get("prompt")}
	version = subprocess.run([*argv, "--version"], capture_output=True, text=True).stdout.strip()
	(outdir / "index.json").write_text(json.dumps({
		"pi": version,
		"pi_argv": argv,
		"recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
		"pace_ms": a.pace_ms,
		"scenarios": index,
		"note": "Raw stdout of `pi --mode rpc`, one JSON object per line. Never edit by hand: re-record.",
	}, indent=2) + "\n")


if __name__ == "__main__":
	main()
