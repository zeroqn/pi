#!/usr/bin/env python3
"""Scroll the transcript and price it: C-13's measure, on a replay with no live host.

The client is fed a recorded transcript (a `get_messages` response with `--messages` pairs), then the
transcript is scrolled with the page keys. Reports bytes per press, bytes per scrolled row and whether
the screen returns to where it started — ticket 03 D1's "landing on the last row re-arms follow".

    ./scroll_probe.py --binary <client> --messages 200 --page 3
"""

import argparse
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
ANSI = re.compile(rb"\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>78]")


def screen(buf):
	return " ".join(ANSI.sub(b" ", buf).decode("utf-8", "replace").split())


def transcript(messages):
	"""A replay that attaches history: the client asks for it once, and paints the response."""
	items = []
	for index in range(messages):
		items.append({"role": "user", "content": f"question {index} about the viewport"})
		body = [f"answer {index}: the window is a slice of the rendered rows, so scrolling costs the rows it shows."]
		body.append("")
		body.append(f"detail {index} " + ("filler text for wrapping " * 4).strip())
		items.append({"role": "assistant", "content": [{"type": "text", "text": "\n".join(body)}]})
	return {
		"type": "response", "command": "get_messages", "success": True,
		"data": {"messages": items},
	}


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--binary", required=True)
	ap.add_argument("--messages", type=int, default=200, help="question/answer pairs in the transcript")
	ap.add_argument("--page", type=int, default=3, help="page-up presses to scroll by")
	ap.add_argument("--cols", type=int, default=100)
	ap.add_argument("--rows", type=int, default=30)
	a = ap.parse_args()

	with tempfile.TemporaryDirectory() as scratch:
		fixture = Path(scratch) / "replay.jsonl"
		fixture.write_text(json.dumps(transcript(a.messages)) + "\n", encoding="utf-8")
		tty = Tty([a.binary, "--replay", str(fixture), "--pace-ms", "0"], os.environ.copy(), str(HERE), cols=a.cols, rows=a.rows)
		try:
			deadline = time.perf_counter() + 20
			while time.perf_counter() < deadline and FRAME not in tty.buf:
				tty.pump(0.02)
			if FRAME not in tty.buf:
				sys.exit(f"the client never painted a frame: {tty.buf[:400]!r}")
			# The first frame is painted before any event arrives, so wait for the last question to
			# appear before calling the screen "the tail".
			if not tty.wait_for(f"question {a.messages - 1}", 0, time.perf_counter() + 20):
				sys.exit(f"the history never painted: {screen(tty.buf)[:300]!r}")
			tty.settle(0.5, time.perf_counter() + 3)
			before = screen(tty.buf)

			presses = []
			for _ in range(a.page):
				start = len(tty.buf)
				tty.send(b"\x1b[5~")  # PageUp
				deadline = time.perf_counter() + 2.0
				while time.perf_counter() < deadline:
					tty.pump(0.02)
					if tty.buf.count(FRAME) > tty.buf[:start].count(FRAME):
						break
				presses.append(len(tty.buf) - start)
			tty.settle(0.2, time.perf_counter() + 2)
			scrolled = screen(tty.buf)
			if scrolled == before:
				sys.exit("PageUp painted the same screen: the viewport did not move")

			for _ in range(a.page):
				tty.send(b"\x1b[6~")  # PageDown
				time.sleep(0.05)
			tty.settle(0.2, time.perf_counter() + 2)
			# A pinned-at-the-tail client paints nothing for a further page-down: only the frame markers
			# and the cursor move, so its bytes are tens, not thousands. That is the observable form of
			# "landing on the last row re-arms follow" (ticket 03 D1).
			start = len(tty.buf)
			tty.send(b"\x1b[6~")
			time.sleep(0.2)
			tty.pump(0.05)
			settled_bytes = len(tty.buf) - start

			os.write(tty.fd, b"\x03\x04")  # clear, then exit
			time.sleep(0.2)
		finally:
			try:
				os.close(tty.fd)
			except OSError:
				pass
			import contextlib
			with contextlib.suppress(ChildProcessError, OSError):
				os.waitpid(tty.pid, os.WNOHANG)

	page_rows = a.rows - 1  # the transcript's height is about the screen less the dock
	bytes_per_row = [bytes_press / page_rows for bytes_press in presses]
	print(f"messages        {a.messages} pairs ({a.messages * 2} entries)")
	print(f"page scroll     {presses} bytes per press, {bytes_per_row}")
	print(f"budget (C-13)   <= 300 B per scrolled row, <= 300 B x rows moved + 64 B per frame")
	print(f"screen moved    {scrolled[:60]!r} …")
	import difflib
	bar = b"\xe2\x96\x88" in tty.buf or b"\xe2\x94\x82" in tty.buf
	print(f"scrollbar       {'drawn' if bar else 'MISSING'} (ticket 03 D4: the bar overlays the last column)")
	print(f"pinned at tail  {settled_bytes} bytes for one further page-down (< 200: follow re-armed)")
	print(f"first screen    {before[:60]!r} …")
	print(f"scrolled screen {scrolled[:60]!r} …")


if __name__ == "__main__":
	main()
