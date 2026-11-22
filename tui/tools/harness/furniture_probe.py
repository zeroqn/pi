#!/usr/bin/env python3
"""The furniture, against a live host: the picker, the palette popup, and the routed built-ins.

Tickets 07 and 08 of `.scratch/tui-rust-v2/map.md`. The host is stock `pi --mode rpc` with a scripted
model, so the checks are the client's own behaviour over the real protocol:

  - ctrl+l opens the model picker over `get_available_models`
  - typing `/mo` lists `/model` with its description, from the palette's built-in table
  - `/hotkeys` runs the client's own action, and says so
  - `/session` routes to `get_session_stats` and shows a summary
  - `/tree` routes to `get_tree` and reports the nodes it was given

    ./furniture_probe.py --binary target/release/pi-tui
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
	return " ".join(ANSI.sub(b" ", buf).decode("utf-8", "replace").split())


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--binary", required=True)
	ap.add_argument("--timeout", type=float, default=30.0)
	a = ap.parse_args()
	checks = []
	with fake_model(script="fake_model_corpus.py") as port, pi_home(port) as home, workdir() as cwd:
		argv = [a.binary, "--pi", f"pi --mode rpc {' '.join(MODEL_ARGS)}"]
		tty = Tty(argv, pi_env(home), str(cwd), cols=120, rows=40)
		try:
			deadline = time.time() + 30
			while time.time() < deadline and b"\x1b[?2026h" not in tty.buf:
				tty.pump(0.05)
			# pi boots with extensions loaded, so the three startup queries answer seconds after spawn;
			# measuring before that is a probe defect, not a client one.
			time.sleep(5.0)
			tty.settle(0.3, time.time() + 3)

			# 1. the model picker. The list is only as full as `get_available_models` has answered,
			#    so retry rather than assume a boot time.
			text = ""
			for _ in range(4):
				mark = len(tty.buf)
				os.write(tty.fd, b"\x0c")  # ctrl+l
				time.sleep(0.4)
				tty.pump(0.05)
				text = screen(tty.buf[mark:])
				os.write(tty.fd, b"\x1b")  # close it
				time.sleep(0.2)
				if "fake-model" in text:
					break
				time.sleep(1.0)
			checks.append(("ctrl+l opened the model picker", "Select model" in text))
			checks.append(("the picker lists a model", "fake-model" in text, text[-160:]))

			# 2. the palette popup
			mark = len(tty.buf)
			tty.send(b"/mo")
			time.sleep(0.4)
			tty.pump(0.05)
			text = screen(tty.buf[mark:])
			checks.append(("/mo lists /model", "/model" in text))
			checks.append(("the popup carries the description", "Select model" in text, text[-160:]))
			tty.send(b"\x15")  # ctrl+u: clear the line (kill to line start)
			time.sleep(0.2)

			# 3. a built-in the client runs itself
			mark = len(tty.buf)
			tty.send(b"/hotkeys\r")
			deadline = time.time() + a.timeout
			seen = False
			while time.time() < deadline:
				tty.pump(0.05)
				if "ctrl+o" in screen(tty.buf[mark:]):
					seen = True
					break
			checks.append(("/hotkeys ran a client action", seen, screen(tty.buf[mark:])[-160:]))

			# 4. a built-in routed to an RPC command
			mark = len(tty.buf)
			tty.send(b"/tree\r")
			deadline = time.time() + a.timeout
			seen = False
			while time.time() < deadline:
				tty.pump(0.05)
				if "session tree" in screen(tty.buf[mark:]):
					seen = True
					break
			checks.append(("/tree routed to get_tree", seen, screen(tty.buf[mark:])[-160:]))

			mark = len(tty.buf)
			tty.send(b"/session\r")
			deadline = time.time() + a.timeout
			seen = False
			while time.time() < deadline:
				tty.pump(0.05)
				if "messages" in screen(tty.buf[mark:]) and "tokens" in screen(tty.buf[mark:]):
					seen = True
					break
			checks.append(("/session showed the stats", seen, screen(tty.buf[mark:])[-160:]))

			tty.send(b"\x03\x04")
			time.sleep(0.3)
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
