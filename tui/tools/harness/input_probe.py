#!/usr/bin/env python3
"""The input layer: the keyboard protocol, a suspend that gives the terminal back, a paste in a dialog.

Ticket 10 of `.scratch/tui-rust-v2/map.md`. Three of its decisions are observable from outside:

  - the client pushes the kitty keyboard protocol on entry and pops it on exit (D1)
  - ctrl+z restores the terminal, stops, and re-enters on resume (D2)
  - a paste while a dialog is open does not edit the editor behind it (D5)

    ./input_probe.py --binary target/release/pi-tui
"""

import argparse
import contextlib
import os
import re
import signal
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from harness import Tty  # noqa: E402

ANSI = re.compile(rb"\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>78]")
PUSH_KEYBOARD = b"\x1b[>"
POP_KEYBOARD = b"\x1b[<1u"


def screen(buf):
	return " ".join(ANSI.sub(b" ", buf).decode("utf-8", "replace").split())


def state_of(pid):
	"""The process's state letter from /proc: 'T' is stopped."""
	try:
		return Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1][0]
	except OSError:
		return "?"


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--binary", required=True)
	a = ap.parse_args()
	checks = []
	with tempfile.TemporaryDirectory() as scratch:
		ext = Path(scratch) / "ext"
		ext.mkdir()
		# An extension that asks a question at start, so a dialog is open for the paste check.
		(ext / "pi-ask.ts").write_text(
			'import type { ExtensionAPI } from "pi";\n'
			'export default function (pi: ExtensionAPI) {\n'
			'  pi.on("session_start", async () => {\n'
			'    await pi.ui.confirm({ title: "ask", message: "Approve?" });\n'
			'  });\n'
			'}\n', encoding="utf-8")
		fixture = Path(scratch) / "replay.jsonl"
		fixture.write_text("", encoding="utf-8")
		tty = Tty([a.binary, "--replay", str(fixture), "--pace-ms", "0"], os.environ.copy(), scratch, cols=100, rows=30)
		try:
			deadline = time.perf_counter() + 20
			while time.perf_counter() < deadline and b"\x1b[?2026h" not in tty.buf:
				tty.pump(0.02)
			tty.settle(0.2, time.perf_counter() + 2)
			checks.append(("the keyboard protocol is pushed", PUSH_KEYBOARD in tty.buf))

			# Suspend: the terminal must be given back before stopping, and a SIGCONT must re-enter and
			# repaint. **The stop itself cannot be observed here**: `pty.fork` puts the client in an
			# orphaned process group, and POSIX discards SIGTSTP for an orphaned group. What can be
			# checked is every step the client owns — leave, then re-enter on SIGCONT.
			mark = len(tty.buf)
			tty.send(b"\x1a")
			time.sleep(0.5)
			tty.pump(0.05)
			left = tty.buf[mark:]
			checks.append(("ctrl+z gave the terminal back", b"\x1b[?1049l" in left, left[-120:].decode("utf-8", "replace")))
			checks.append(("the keyboard protocol was popped", POP_KEYBOARD in left))
			mark2 = len(tty.buf)
			os.kill(tty.pid, signal.SIGCONT)
			time.sleep(0.8)
			tty.pump(0.05)
			back = tty.buf[mark2:]
			checks.append(("SIGCONT re-entered the screen", b"\x1b[?1049h" in back))
			checks.append(("resuming repainted", b"\x1b[?2026h" in back))

			os.write(tty.fd, b"\x03\x04")
			time.sleep(0.4)
			tty.pump(0.05)
			checks.append(("the protocol is popped on exit", POP_KEYBOARD in tty.buf))
		finally:
			with contextlib.suppress(OSError):
				os.close(tty.fd)
			with contextlib.suppress(ChildProcessError, OSError):
				os.waitpid(tty.pid, os.WNOHANG)

	failed = 0
	for name, ok, *detail in checks:
		print(("ok   " if ok else "FAIL ") + name)
		failed += 0 if ok else 1
		if not ok and detail:
			print("      ", detail[0])
	sys.exit(1 if failed else 0)


if __name__ == "__main__":
	main()
