#!/usr/bin/env python3
"""C-11, amended by ticket 02's D6: how the client fails and how it leaves.

pi's split, which v2 adopted: `escape` aborts a turn, `ctrl+c` **clears** the composer and never exits,
`ctrl+d` exits only with an empty composer, and a dead host ends the client rather than leaving it
painted over a corpse.

    ./failure_probe.py --binary target/release/pi-tui
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
from harness import MODEL_ARGS, Tty, fake_model, pi_env, pi_home, workdir  # noqa: E402

ANSI = re.compile(rb"\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>78]")
FRAME = b"\x1b[?2026h"


def screen(buf):
	return " ".join(ANSI.sub(b" ", buf).decode("utf-8", "replace").split())


def alive(pid):
	try:
		return Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1][0] != "Z"
	except OSError:
		return False


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--binary", required=True)
	a = ap.parse_args()
	checks = []
	with fake_model(script="fake_model_corpus.py", pace_ms=15) as port, pi_home(port) as home, workdir() as cwd:
		tty = Tty([a.binary, "--pi", "pi --mode rpc " + " ".join(MODEL_ARGS)], pi_env(home), str(cwd), cols=120, rows=40,
		          stderr=str(Path(tempfile.mkdtemp()) / "stderr.log"))
		try:
			deadline = time.perf_counter() + 30
			while time.perf_counter() < deadline and FRAME not in tty.buf:
				tty.pump(0.02)
			time.sleep(4.0)

			# 1. escape aborts a streaming turn, and the client stays usable afterwards.
			tty.send(b"CODE: show the frame function\r")
			time.sleep(1.0)
			mark = len(tty.buf)
			tty.send(b"\x1b")
			deadline = time.perf_counter() + 8
			while time.perf_counter() < deadline:
				tty.pump(0.05)
			text = screen(tty.buf[mark:])
			checks.append(("escape aborts the turn", "abort" in text.lower(), text[-160:]))
			mark = len(tty.buf)
			tty.send(b"x")
			time.sleep(0.4)
			tty.pump(0.05)
			checks.append(("the client is usable after an abort", len(tty.buf) > mark))

			# 2. ctrl+c clears the composer and does not exit.
			tty.send(b"draft text")
			time.sleep(0.3)
			mark = len(tty.buf)
			tty.send(b"\x03")
			time.sleep(0.4)
			tty.pump(0.05)
			text = screen(tty.buf[mark:])
			checks.append(("ctrl+c does not exit the client", alive(tty.pid)))
			checks.append(("ctrl+c cleared the composer", "draft text" not in screen(tty.buf[-4000:]) or len(tty.buf) > mark))

			# 3. ctrl+d with a non-empty composer does not exit; with an empty one it does, and the
			#    terminal is given back.
			tty.send(b"still typing")
			time.sleep(0.3)
			tty.send(b"\x04")
			time.sleep(0.4)
			tty.pump(0.05)
			checks.append(("ctrl+d with text does not exit", alive(tty.pid)))
			os.write(tty.fd, b"\x15\x04")  # ctrl+u clears, then ctrl+d
			deadline = time.perf_counter() + 4
			while time.perf_counter() < deadline and alive(tty.pid):
				tty.pump(0.05)
			checks.append(("ctrl+d on an empty composer exits", not alive(tty.pid)))
			checks.append(("the terminal is restored on exit", b"\x1b[?1049l" in tty.buf and b"\x1b[?1006l" in tty.buf))
		finally:
			with contextlib.suppress(OSError):
				os.close(tty.fd)
			with contextlib.suppress(ChildProcessError, OSError):
				os.waitpid(tty.pid, os.WNOHANG)

	# 4. A host that dies ends the client with a message, not a painted corpse (ticket 02 D7).
	with tempfile.TemporaryDirectory() as scratch:
		fixture = Path(scratch) / "replay.jsonl"
		fixture.write_text("")
		host = Tty(["sh", "-c", "echo '{}'; sleep 30"], os.environ.copy(), scratch, cols=80, rows=24, stderr=str(Path(scratch) / "hstderr.log"))
		child = Tty([a.binary, "--pi", "sh -c 'echo {}; sleep 30'"], os.environ.copy(), scratch, cols=80, rows=24,
		            stderr=str(Path(scratch) / "cstderr.log"))
		# Find the client's host child and kill it.
		time.sleep(1.5)
		kids = [int(p) for p in re.findall(r"^(\d+)", os.popen(f"pgrep -P {child.pid} || true").read(), re.M)] if os.popen("which pgrep").read().strip() else []
		for kid in kids:
			with contextlib.suppress(ProcessLookupError):
				os.kill(kid, 9)
		deadline = time.perf_counter() + 6
		while time.perf_counter() < deadline and alive(child.pid):
			child.pump(0.05)
		checks.append(("a dead host ends the client", not alive(child.pid), f"kids {kids}"))
		with contextlib.suppress(OSError):
			os.close(child.fd)
		with contextlib.suppress(OSError):
			os.close(host.fd)

	failed = 0
	for name, ok, *detail in checks:
		print(("ok   " if ok else "FAIL ") + name)
		failed += 0 if ok else 1
		if not ok and detail:
			print("      ", detail[0])
	sys.exit(1 if failed else 0)


if __name__ == "__main__":
	main()
