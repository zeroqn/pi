#!/usr/bin/env python3
"""The mouse and the clipboard, end to end: select with a drag and read the OSC 52 write.

No terminal emulator is needed for this row: the client's clipboard write is an escape sequence in the
pty stream, so a drag can be proven by decoding it (ticket 04 of `.scratch/tui-rust-v2/map.md`).

    ./selection_probe.py --binary <client> --messages 20
"""

import argparse
import base64
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from harness import Tty  # noqa: E402

FRAME = b"\x1b[?2026h"
OSC52 = re.compile(rb"\x1b\]52;c;([A-Za-z0-9+/=]+)\x07")


def transcript(messages):
	items = []
	for index in range(messages):
		items.append({"role": "user", "content": f"question {index}"})
		items.append({"role": "assistant", "content": [{"type": "text", "text": f"answer {index} with several words to select"}]})
	return {"type": "response", "command": "get_messages", "success": True, "data": {"messages": items}}


def sgr(button, col, row, release=False):
	"""A 1006-protocol mouse event. Rows and columns are 1-based, as the terminal sends them."""
	return f"\x1b[<{button};{col};{row}{'m' if release else 'M'}".encode()


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--binary", required=True)
	ap.add_argument("--messages", type=int, default=20)
	ap.add_argument("--cols", type=int, default=100)
	ap.add_argument("--rows", type=int, default=30)
	a = ap.parse_args()

	with tempfile.TemporaryDirectory() as scratch:
		fixture = Path(scratch) / "replay.jsonl"
		fixture.write_text(json.dumps(transcript(a.messages)) + "\n", encoding="utf-8")
		tty = Tty([a.binary, "--replay", str(fixture), "--pace-ms", "0"], os.environ.copy(), str(HERE), cols=a.cols, rows=a.rows, stderr=str(Path(scratch) / "stderr.log"))
		checks = []
		try:
			deadline = time.perf_counter() + 20
			while time.perf_counter() < deadline and FRAME not in tty.buf:
				tty.pump(0.02)
			if not tty.wait_for(f"question {a.messages - 1}", 0, time.perf_counter() + 20):
				sys.exit("the history never painted")
			tty.settle(0.3, time.perf_counter() + 3)

			# The client asked for the mouse: 1000h or 1006h must be in its output.
			checks.append(("mouse capture requested", b"\x1b[?1006h" in tty.buf or b"\x1b[?1000h" in tty.buf))

			# A wheel-up event (button 64) moves the window: the frame after it must differ from before.
			mark = len(tty.buf)
			tty.send(sgr(64, 10, 5))
			tty.settle(0.2, time.perf_counter() + 2)
			checks.append(("wheel scrolled", tty.buf.count(FRAME) > tty.buf[:mark].count(FRAME)))

			# A drag across three rows, then a release: copy-on-select is pi's default.
			mark = len(tty.buf)
			tty.send(sgr(0, 10, 3))          # press
			time.sleep(0.05)
			tty.send(sgr(32, 30, 6))         # drag
			time.sleep(0.05)
			tty.send(sgr(0, 30, 6, release=True))
			deadline = time.perf_counter() + 2
			while time.perf_counter() < deadline and not OSC52.search(tty.buf[mark:]):
				tty.pump(0.02)
			found = OSC52.search(tty.buf[mark:])
			checks.append(("drag produced an OSC 52 write", found is not None))

			copied = ""
			if found:
				copied = base64.b64decode(found.group(1)).decode("utf-8", "replace")
				checks.append(("the clipboard payload is the selected text", "answer" in copied or "question" in copied))

			# Ctrl+X with copy-on-select true copies the last assistant message.
			mark = len(tty.buf)
			os.write(tty.fd, b"\x18")  # ctrl+x
			deadline = time.perf_counter() + 2
			while time.perf_counter() < deadline and not OSC52.search(tty.buf[mark:]):
				tty.pump(0.02)
			found2 = OSC52.search(tty.buf[mark:])
			checks.append(("ctrl+x wrote the last answer", found2 is not None))
			if found2:
				last = base64.b64decode(found2.group(1)).decode("utf-8", "replace")
				checks.append(("ctrl+x payload is the assistant text", "answer" in last))

			os.write(tty.fd, b"\x03\x04")
			time.sleep(0.2)
		finally:
			try:
				os.close(tty.fd)
			except OSError:
				pass
			import contextlib
			with contextlib.suppress(ChildProcessError, OSError):
				os.waitpid(tty.pid, os.WNOHANG)

	failed = 0
	for name, ok in checks:
		print(("ok   " if ok else "FAIL ") + name)
		failed += 0 if ok else 1
	if copied:
		print("selected: %r" % copied[:80])
	sys.exit(1 if failed else 0)


if __name__ == "__main__":
	main()
