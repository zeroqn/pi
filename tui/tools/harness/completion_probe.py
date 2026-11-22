#!/usr/bin/env python3
"""Completion against a real tree: `@` lists files, Tab inserts, a quoted path survives a space.

Ticket 09 of `.scratch/tui-rust-v2/map.md`: `fd` supplies the candidates (pi's own engine, `fd`'s own
.gitignore handling), `@` opens the popup, and a path with a space is inserted inside quotes.

    ./completion_probe.py --binary target/release/pi-tui
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


def screen(buf):
	return " ".join(ANSI.sub(b" ", buf).decode("utf-8", "replace").split())


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--binary", required=True)
	a = ap.parse_args()
	checks = []
	with tempfile.TemporaryDirectory() as scratch:
		tree = Path(scratch) / "tree"
		(tree / "src").mkdir(parents=True)
		(tree / "src" / "model.rs").write_text("x", encoding="utf-8")
		(tree / "src" / "markdown.rs").write_text("x", encoding="utf-8")
		(tree / "docs").mkdir()
		(tree / "docs" / "my file.txt").write_text("x", encoding="utf-8")
		(tree / ".hidden.rs").write_text("x", encoding="utf-8")
		fixture = Path(scratch) / "replay.jsonl"
		fixture.write_text("", encoding="utf-8")

		tty = Tty([a.binary, "--replay", str(fixture), "--pace-ms", "0"], os.environ.copy(), str(tree), cols=100, rows=30)
		try:
			deadline = time.perf_counter() + 20
			while time.perf_counter() < deadline and b"\x1b[?2026h" not in tty.buf:
				tty.pump(0.02)
			tty.settle(0.2, time.perf_counter() + 2)

			# 1. `@` alone lists files, from fd, hidden ones included as pi does. Retried: the first
			#    keystroke can beat the client's own first frame on a loaded box.
			text = ""
			for _ in range(3):
				mark = len(tty.buf)
				tty.send(b"@")
				time.sleep(0.6)
				tty.pump(0.05)
				text = screen(tty.buf[mark:])
				if "src/" in text or "model.rs" in text:
					break
				tty.send(b"\x15")  # ctrl+u, clear the line, and try again
				time.sleep(0.2)
			checks.append(("@ opens the popup", "src/" in text or "model.rs" in text, text[-200:]))
			checks.append(("a nested file is offered", "model.rs" in text or "markdown.rs" in text))

			# 2. Tab inserts the highlighted path, with the `@` kept.
			mark = len(tty.buf)
			tty.send(b"\t")
			time.sleep(0.4)
			tty.pump(0.05)
			text = screen(tty.buf[mark:])
			checks.append(("Tab inserted an @ mention", "@" in text and ("src/" in text or "model" in text), text[-200:]))

			# 3. A prefix narrows it.
			tty.send(b"\x15")  # ctrl+u clears the line
			time.sleep(0.2)
			mark = len(tty.buf)
			tty.send(b"@src/mo")
			time.sleep(0.6)
			tty.pump(0.05)
			text = screen(tty.buf[mark:])
			checks.append(("a prefix narrows to the file", "model.rs" in text, text[-200:]))

			# 4. A path with a space is inserted inside quotes.
			tty.send(b"\x15")
			time.sleep(0.2)
			mark = len(tty.buf)
			tty.send(b'@"docs/my')
			time.sleep(0.6)
			tty.pump(0.05)
			text = screen(tty.buf[mark:])
			checks.append(("a quoted token survives a space", "my file.txt" in text, text[-200:]))
			tty.send(b"\t")
			time.sleep(0.4)
			tty.pump(0.05)
			text = screen(tty.buf[mark:])
			checks.append(("the insert is quoted", '@"docs/my file.txt"' in text or "my file.txt\"" in text, text[-200:]))

			os.write(tty.fd, b"\x03\x04")
			time.sleep(0.2)
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
			print("      screen:", detail[0])
	sys.exit(1 if failed else 0)


if __name__ == "__main__":
	main()
