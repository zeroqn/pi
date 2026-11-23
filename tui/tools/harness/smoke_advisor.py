#!/usr/bin/env python3
"""End to end: `/advisor`'s degraded picker, answered through the Rust client.

The advisor extension is loaded into a live `pi --mode rpc`; the client gets the prompt `/advisor`,
shows the `select` the extension falls back to (ticket 08/13), takes the last row ("No advisor") and
writes the answer back. Exit status 1 if any step does not appear.

    ./smoke_advisor.py --binary target/release/rpi
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
# .../extensions/tui/tools/harness/smoke_advisor.py -> the repo root is four levels up.
ADVISOR = Path(__file__).resolve().parents[4] / "extensions/packages/advisor/index.ts"


def screen(buf):
	return ANSI.sub(b" ", buf).decode("utf-8", "replace")


def wait_for(tty, needle, timeout, since=0):
	needle = needle.encode() if isinstance(needle, str) else needle
	deadline = time.time() + timeout
	while time.time() < deadline:
		tty.pump(0.05)
		if needle in screen(tty.buf[since:]).encode():
			return True
	return False


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--binary", required=True)
	ap.add_argument("--advisor", default=str(ADVISOR))
	a = ap.parse_args()
	with fake_model(script="fake_model_corpus.py") as port, pi_home(port) as home, workdir() as cwd:
		argv = [
			a.binary,
			"--pi",
			f"pi --mode rpc {' '.join(MODEL_ARGS)} -e {a.advisor}",
			"--stats",
			"/tmp/smoke-advisor-stats.json",
		]
		tty = Tty(argv, pi_env(home), str(cwd), cols=120, rows=40)
		checks = []
		try:
			wait_for(tty, b"\x1b[?2026h", 30)
			tty.send(b"/advisor\r")
			start = len(tty.buf)
			ok = wait_for(tty, "type-to-filter is not available", 25, start)
			checks.append(("the degraded picker title reached the client", ok))
			ok = wait_for(tty, "No advisor", 10, start)
			checks.append(("the picker's rows reached the client", ok))
			# Walk to the last row and take it.
			for _ in range(12):
				tty.send(b"\x1b[B")
				time.sleep(0.01)
			tty.send(b"\r")
			ok = wait_for(tty, "Advisor disabled", 20, start)
			checks.append(("the answer produced the extension's notify", ok))
		finally:
			tty.send(b"\x03")
			time.sleep(0.4)
			for _ in range(20):
				tty.pump(0.05)
			with contextlib.suppress(OSError):
				os.close(tty.fd)
			with contextlib.suppress(ChildProcessError, OSError):
				os.waitpid(tty.pid, os.WNOHANG)

	failed = 0
	for name, ok in checks:
		print(f"{'ok  ' if ok else 'FAIL'} {name}")
		failed += 0 if ok else 1
	print("screen tail:", " ".join(screen(tty.buf).split())[-220:])
	sys.exit(1 if failed else 0)


if __name__ == "__main__":
	main()
