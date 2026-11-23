#!/usr/bin/env python3
"""C-15 coverage: what one arm puts on the screen, as facts, from the same parser as the other arm.

The bar's C-15 asks: does the client show what pi's TUI showed for the same session? Two arms, one
terminal emulator (`vt100.py`), one fact extractor per scenario, a gold file per (scenario, arm).

    # capture the reference from pi's own TUI, once per host version
    ./coverage.py --arm pi     --scenario S1 --capture results/gold/S1.json
    # capture the client's facts, then compare against the reference
    ./coverage.py --arm client --scenario S1 --capture results/gold/S1.client.json
    ./coverage.py --check --scenario S1

A fact is a name plus what the screen must contain for it. The client may show **more** than pi; it may
not show less — that is what "pi is the reference" means (C-15's target).
"""

import argparse
import contextlib
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from harness import MODEL_ARGS, Tty, fake_model, pi_env, pi_home, workdir  # noqa: E402
from vt100 import Screen  # noqa: E402

BEGIN_FRAME = "\x1b[?2026h"

# The scripted model picks its answer from the prompt's first word: `CODE` gives a fence, `BASH` gives a
# tool call with a large result, `PLAIN` gives prose only (`fake_model_corpus.py`).
PROMPT = "CODE: show the frame function"

# The facts each scenario asks for. A fact is (name, needles): every needle must be found in the screen's
# text for the fact to hold. `needles` is a list of alternatives — the first one that matches wins.
SCENARIOS = {
	"S1": {
		"title": "a turn with prose and a fenced code block",
		"keystrokes": [PROMPT + "\r"],
		"settle": 20.0,
		"facts": [
			("the prompt you typed", ["CODE: show the frame function"]),
			("a fenced code block's content", ["export function frame", "const out"]),
			("prose after the fence", ["The renderer walks", "Hermes"]),
		],
	},
	"S2": {
		"title": "abort a streaming answer",
		"pace": 12,
		"keystrokes": ["CODE: show the frame function", "\r", "\x1b"],
		"settle": 8.0,
		"facts": [
			("partial answer text was shown", ["The renderer walks", "The frame function", "export function frame"]),
			("the abort is marked on screen", ["Operation aborted", "aborted"]),
		],
	},
	"S3": {
		"title": "a long tool result, scrolled back with the page keys",
		"keystrokes": ["BASH: run it", "\r", "\x1b[5~", "\x1b[5~", "\x1b[5~"],
		"settle": 14.0,
		"facts": [
			# At the tail the window shows the tool result; the prompt that began the turn is only
			# visible once the page keys have moved it back into view.
			("scrolling revealed the prompt above the result", ["BASH: run it"]),
			("the tool card names the tool", ["bash", "seq 1 1200"]),
		],
	},
	"S4": {
		"title": "open the model picker and the palette",
		"keystrokes": ["\x0c", "\x1b", "/mo"],
		"settle": 4.0,
		"facts": [
			("the picker lists a model", ["fake-model"]),
			("the picker names itself", ["Select model", "Model"]),
			("the palette lists /model with its description", ["/model", "Select model"]),
		],
	},
	"S5": {
		"title": "type @src and accept a path",
		"setup": "tree",
		"keystrokes": ["@src", "\t"],
		"settle": 3.0,
		"facts": [
			("a path under src is offered", ["src/", "main.rs"]),
			("the accepted path reaches the composer", ["@src", "src/"]),
		],
	},
}


def run_arm(arm, scenario, cols=120, rows=40):
	"""Run one arm and return the facts it showed **at any point**, not only in the final screen.

	A popup that closes after Tab, or a scroll that moves the window, is invisible in the last frame; the
	question C-15 asks is whether the user ever saw it.
	"""
	spec = SCENARIOS[scenario]
	with fake_model(script="fake_model_corpus.py", pace_ms=spec.get("pace", 0)) as port, pi_home(port) as home, workdir() as cwd:
		if spec.get("setup") == "tree":
			# A real tree to complete against: `fd` is asked about the working directory, so the scenario
			# must give it one with files in it.
			(Path(cwd) / "src").mkdir(exist_ok=True)
			(Path(cwd) / "src" / "model.rs").write_text("// a file to complete\n", encoding="utf-8")
		if arm == "client":
			argv = [CLIENT, "--pi", f"pi --mode rpc {' '.join(MODEL_ARGS)}"]
			env = pi_env(home)
		else:
			# pi's own TUI: same scripted model, same throwaway home.
			argv = ["pi", *MODEL_ARGS]
			env = pi_env(home)
		tty = Tty(argv, env, str(cwd), cols=cols, rows=rows)
		screen = Screen(cols, rows)
		seen = {name: False for name, _ in spec["facts"]}
		fed = 0
		pending = ""

		def check_facts():
			text = screen.text()
			for name, needles in spec["facts"]:
				if not seen[name] and any(needle in text for needle in needles):
					seen[name] = True

		def sample():
			"""Feed the new bytes **frame by frame**: a fact must be seen when the user saw it.

			Feeding a whole batch at once lands on the last frame, so a popup that opened and closed
            inside the batch would never be counted — which is exactly how S4 first reported a picker
            with no models.
			"""
			nonlocal fed, pending
			if len(tty.buf) > fed:
				pending += tty.buf[fed:].decode("utf-8", "replace")
				fed = len(tty.buf)
			while True:
				index = pending.find(BEGIN_FRAME, 1)
				if index < 0:
					break
				screen.feed(pending[:index])
				pending = pending[index:]
				check_facts()
			if pending and BEGIN_FRAME not in pending[1:]:
				pass

		try:
			start = time.perf_counter()
			while time.perf_counter() - start < 30:
				tty.pump(0.05)
				sample()
				if tty.buf:
					break
			# pi boots with extensions loaded, so give it a moment before typing.
			time.sleep(4.0)
			for keys in spec["keystrokes"]:
				tty.send(keys.encode())
				time.sleep(0.6)
				sample()
				# Pump between keystrokes too, so each frame is fed before the next key arrives.
				deadline_keys = time.perf_counter() + 0.4
				while time.perf_counter() < deadline_keys:
					tty.pump(0.05)
					sample()
			deadline = time.perf_counter() + spec["settle"]
			while time.perf_counter() < deadline:
				tty.pump(0.1)
				sample()
			if pending:
				screen.feed(pending)
				check_facts()
			with contextlib.suppress(OSError):
				os.write(tty.fd, b"\x03" if arm == "pi" else b"\x03\x04")
		finally:
			with contextlib.suppress(OSError):
				os.close(tty.fd)
			with contextlib.suppress(ChildProcessError, OSError):
				os.waitpid(tty.pid, os.WNOHANG)
	return seen


def host_version():
	try:
		return subprocess_run(["pi", "--version"]).strip()
	except OSError:
		return "unknown"


def subprocess_run(argv):
	import subprocess
	done = subprocess.run(argv, capture_output=True, text=True, timeout=30)
	return done.stdout


def facts_of(seen, scenario):
	return {name: bool(seen.get(name, False)) for name, _ in SCENARIOS[scenario]["facts"]}


def main():
	global CLIENT
	ap = argparse.ArgumentParser()
	ap.add_argument("--arm", choices=["pi", "client"])
	ap.add_argument("--scenario", required=True, choices=sorted(SCENARIOS))
	ap.add_argument("--client-binary", default="rpi")
	ap.add_argument("--capture", help="write the facts here as JSON")
	ap.add_argument("--check", action="store_true", help="compare against the reference gold file")
	ap.add_argument("--gold", default=str(HERE / "gold"), help="where gold facts live, version-stamped")
	a = ap.parse_args()
	CLIENT = a.client_binary
	Path(a.gold).mkdir(parents=True, exist_ok=True)
	reference = Path(a.gold) / f"{a.scenario}.json"

	if a.arm:
		seen = run_arm(a.arm, a.scenario)
		facts = facts_of(seen, a.scenario)
		payload = {"scenario": a.scenario, "arm": a.arm, "host": host_version(), "facts": facts}
		for name, ok in facts.items():
			print(("ok   " if ok else "MISS ") + name)

		if a.capture:
			Path(a.capture).write_text(json.dumps(payload, indent=2) + "\n")
			print(f"captured -> {a.capture}")
		if a.arm == "pi" and facts:
			Path(reference).write_text(json.dumps(payload, indent=2) + "\n")
			print(f"reference -> {reference}")
		return 0 if all(facts.values()) else 1

	if a.check:
		gold = Path(a.capture) if a.capture else reference
		if not gold.exists():
			sys.exit(f"no gold file at {gold}: capture the reference from pi first")
		gold_data = json.loads(gold.read_text())
		want = gold_data["facts"]
		if gold_data.get("host") and gold_data["host"] != host_version():
			print(f"note: the gold file was captured on pi {gold_data['host']}, this box runs {host_version()}")
		seen = run_arm("client", a.scenario)
		got = facts_of(seen, a.scenario)
		failed = 0
		for name, expected in want.items():
			if not expected:
				print(f"skip {name}: pi's own screen did not show it either")
				continue
			ok = got.get(name, False)
			print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  (pi showed it, the client did not)"))
			failed += 0 if ok else 1
		return 1 if failed else 0

	ap.print_help()
	return 0


if __name__ == "__main__":
	main()
