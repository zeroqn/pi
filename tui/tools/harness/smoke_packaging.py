#!/usr/bin/env python3
"""A full turn through `bin/pi` — the wrapper, the client, and a live host, on a pty.

Three claims at once: the wrapper takes the `pi` name, the client spawns the host, and an unmodified
`pi --mode rpc` answers. Exit 1 if the answer never appears.

    ./smoke_packaging.py --wrapper ../../bin/pi --client target/release/pi-tui
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


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument("--wrapper", required=True)
	ap.add_argument("--client", required=True)
	ap.add_argument("--needle", default="Done")
	ap.add_argument("--timeout", type=float, default=60)
	a = ap.parse_args()
	with fake_model(script="fake_model_corpus.py") as port, pi_home(port) as home, workdir() as cwd:
		env = pi_env(home)
		env["PI_TUI_CLIENT"] = str(Path(a.client).resolve())
		env["PI_TUI_HOST"] = "pi"
		env["PI_TUI_HOST_ARGS"] = " ".join(MODEL_ARGS)
		tty = Tty([str(Path(a.wrapper).resolve())], env, str(cwd), cols=120, rows=40)
		try:
			deadline = time.time() + 30
			while time.time() < deadline and b"\x1b[?2026h" not in tty.buf:
				tty.pump(0.05)
			tty.send(b"PLAIN: say it is done\r")
			deadline = time.time() + a.timeout
			seen = False
			while time.time() < deadline:
				tty.pump(0.05)
				if a.needle.encode() in screen(tty.buf).encode():
					seen = True
					break
			tty.send(b"\x03")
			time.sleep(0.3)
			while tty.pump(0.05):
				pass
		finally:
			with contextlib.suppress(OSError):
				os.close(tty.fd)
			with contextlib.suppress(ChildProcessError, OSError):
				os.waitpid(tty.pid, os.WNOHANG)
	if not seen:
		print("FAILED: no answer through the wrapper; screen tail:")
		print(" ".join(screen(tty.buf).split())[-400:])
		sys.exit(1)
	print(f"ok: `pi` started the client, which drove the host ({tty.buf.count(b'\x1b[?2026h')} frames)")


if __name__ == "__main__":
	main()
