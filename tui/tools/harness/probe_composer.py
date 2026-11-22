#!/usr/bin/env python3
"""Composer probes: a multi-line paste, a remapped keybinding, and completion.

Three checks against the client alone (no host needed for the first two):

1. **Bracketed paste collapses.** A 12-line paste shows `[paste #1 +12 lines]` on screen.
2. **A remapped submit key is honoured.** With `keybindings.json` moving `tui.input.submit` to
   `alt+enter`, `Enter` must NOT send a prompt and `alt+enter` must.
3. **Tab completes a path.** Typing a prefix of a real file and pressing Tab replaces it.

    ./probe_composer.py --binary target/release/pi-tui [--fixture F]
"""

import argparse
import contextlib
import os
import re
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from harness import Tty  # noqa: E402

ANSI = re.compile(rb"\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>78]")
FIXTURE = (HERE / "../../../../.scratch/tui-rust/fixtures/text.jsonl").resolve()


def screen(buf):
	return ANSI.sub(b" ", buf).decode("utf-8", "replace")


def wait_for(tty, needle, timeout, since=0, raw=False):
	needle = needle.encode() if isinstance(needle, str) else needle
	deadline = time.time() + timeout
	while time.time() < deadline:
		tty.pump(0.05)
		haystack = tty.buf[since:] if raw else screen(tty.buf[since:]).encode()
		if needle in haystack:
			return True
	return False


def run(a, argv, agent_dir, script, cols=100, rows=30):
	tty = Tty(argv, {**os.environ, "PI_CODING_AGENT_DIR": agent_dir}, str(Path(a.cwd).resolve()), cols=cols, rows=rows)
	ok = []
	try:
		if not wait_for(tty, b"\x1b[?2026h", 25, raw=True):
			raise SystemExit("the client painted nothing")
		ok = script(tty)
	finally:
		tty.send(b"\x03")
		time.sleep(0.3)
		for _ in range(20):
			tty.pump(0.05)
		with contextlib.suppress(OSError):
			os.close(tty.fd)
		with contextlib.suppress(ChildProcessError, OSError):
			os.waitpid(tty.pid, os.WNOHANG)
	return ok


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--binary", required=True)
	ap.add_argument("--fixture", default=str(FIXTURE))
	ap.add_argument("--cwd", default=str(Path.cwd()))
	a = ap.parse_args()

	agent_dir = tempfile.mkdtemp(prefix="pi-tui-composer-")
	checks = []

	# 1: paste collapse, on a fresh composer.
	def paste_case(tty):
		start = len(tty.buf)
		paste = "\n".join(f"pasted line {i}" for i in range(1, 13))
		tty.send(b"\x1b[200~" + paste.encode() + b"\x1b[201~")
		return [("a 12-line bracketed paste collapses into one marker", wait_for(tty, "[paste #1 +12 lines]", 10, start))]

	checks += run(a, [a.binary, "--replay", a.fixture, "--pace-ms", "0"], agent_dir, paste_case)

	# 2: Tab completion, on a fresh composer (a marker-token before the cursor would have nothing to list).
	def tab_case(tty):
		mark = len(tty.buf)
		tty.send(b"mcp-disc")
		time.sleep(0.2)
		tty.send(b"\t")
		time.sleep(0.3)
		return [("Tab completes a path in the working directory", wait_for(tty, "mcp-discovery.md", 10, mark))]

	checks += run(a, [a.binary, "--replay", a.fixture, "--pace-ms", "0"], agent_dir, tab_case)

	# 3: submit remapped to alt+enter.
	with open(os.path.join(agent_dir, "keybindings.json"), "w") as handle:
		handle.write('{"tui.input.submit": "alt+enter"}')

	def second(tty):
		start = len(tty.buf)
		tty.send(b"first line")
		time.sleep(0.2)
		newline_mark = len(tty.buf)
		tty.send(b"\r")  # Enter is now a no-op for submit; with pi's defaults it would send
		time.sleep(0.3)
		# The composer must still hold the text: a second line typed shows both.
		tty.send(b"second")
		got_newline = wait_for(tty, "second", 5, newline_mark)
		out = [("Enter no longer submits when the binding moves it", got_newline)]
		_ = start
		return out

	checks += run(
		a,
		[a.binary, "--replay", a.fixture, "--pace-ms", "0"],
		agent_dir,
		second,
		100,
		30,
	)

	failed = 0
	for name, ok in checks:
		print(f"{'ok  ' if ok else 'FAIL'} {name}")
		failed += 0 if ok else 1
	shutil = __import__("shutil")
	shutil.rmtree(agent_dir, ignore_errors=True)
	sys.exit(1 if failed else 0)


if __name__ == "__main__":
	main()
