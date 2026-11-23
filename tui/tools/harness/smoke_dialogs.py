#!/usr/bin/env python3
"""Drive the client's dialogs end to end: a live `pi --mode rpc` plus the corpus extension.

Launches the client against a real host with `tools/harness/corpus-ext.ts` loaded, types
`/corpus-ui`, and answers the dialogs the extension raises with keystrokes the client must turn into
`extension_ui_response` lines. Then it checks the follow-up state — a status line, a widget, a notice —
appeared in the client's own output.

    ./smoke_dialogs.py --binary target/release/rpi
"""

import argparse
import contextlib
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from harness import MODEL_ARGS, Tty, fake_model, pi_env, pi_home, workdir  # noqa: E402

ANSI = re.compile(rb"\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>78]")


def screen(buf):
	return ANSI.sub(b" ", buf).decode("utf-8", "replace")


def wait_for(tty, needle, timeout, since=0, raw=False):
	"""Wait for text on the screen, or — with `raw=True` — for a byte sequence in the pty stream."""
	needle = needle.encode() if isinstance(needle, str) else needle
	deadline = time.time() + timeout
	while time.time() < deadline:
		tty.pump(0.05)
		haystack = tty.buf[since:] if raw else screen(tty.buf[since:]).encode()
		if needle in haystack:
			return True
	return False


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--binary", required=True)
	a = ap.parse_args()
	fixture_ext = HERE / "corpus-ext.ts"
	with fake_model(script="fake_model_corpus.py") as port, pi_home(port) as home, workdir() as cwd:
		argv = [
			a.binary,
			"--pi",
			f"pi --mode rpc {' '.join(MODEL_ARGS)} -e {fixture_ext}",
			"--stats",
			"/tmp/smoke-dialogs-stats.json",
		]
		tty = Tty(argv, pi_env(home), str(cwd), cols=120, rows=40)
		checks = []
		try:
			if not wait_for(tty, b"\x1b[?2026h", 30, raw=True):
				raise SystemExit("the client painted nothing")
			start = len(tty.buf)
			tty.send(b"/corpus-ui\r")

			# 1. select: move down once and take the second option.
			ok = wait_for(tty, "Corpus select", 30, start)
			checks.append(("select dialog rendered", ok, screen(tty.buf)[-300:]))
			mark = len(tty.buf)
			tty.send(b"\x1b[B")  # down
			time.sleep(0.1)
			tty.send(b"\r")

			# 2. confirm: answer yes.
			ok = wait_for(tty, "Corpus confirm", 20, mark)
			checks.append(("confirm dialog rendered", ok, ""))
			mark = len(tty.buf)
			tty.send(b"y")

			# 3. input: type three characters and submit.
			ok = wait_for(tty, "Corpus input", 20, mark)
			checks.append(("input dialog rendered", ok, ""))
			mark = len(tty.buf)
			for ch in "abc":
				tty.send(ch.encode())
				time.sleep(0.02)
			tty.send(b"\r")

			# 4. editor: cancel it (esc), which is a legal answer and closes the dialog.
			ok = wait_for(tty, "Corpus editor", 20, mark)
			checks.append(("editor dialog rendered", ok, ""))
			tty.send(b"\x1b")
			time.sleep(0.3)

			# 5. the extension's own follow-ups: a notice, a status line, a widget.
			ok = wait_for(tty, "corpus done", 20, 0)
			checks.append(("extension notice rendered", ok, ""))
			ok = wait_for(tty, "corpus: diagnosing", 10, 0)
			checks.append(("status line rendered", ok, ""))
			ok = wait_for(tty, "widget line one", 10, 0)
			checks.append(("widget rows rendered", ok, ""))
		finally:
			with contextlib.suppress(OSError):
				os.close(tty.fd)
			with contextlib.suppress(ChildProcessError, OSError):
				os.waitpid(tty.pid, os.WNOHANG)

	failed = 0
	for name, ok, detail in checks:
		print(f"{'ok  ' if ok else 'FAIL'} {name}")
		if not ok:
			failed += 1
			if detail:
				print("   screen:", " ".join(detail.split())[-200:])
	stats = Path("/tmp/smoke-dialogs-stats.json")
	if stats.exists():
		print("client stats:", stats.read_text().strip())
	sys.exit(1 if failed else 0)


if __name__ == "__main__":
	main()
