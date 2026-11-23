#!/usr/bin/env python3
"""End-to-end smoke test: the Rust client spawned `pi --mode rpc` and rendered its answer.

Starts a scripted model and a throwaway `PI_CODING_AGENT_DIR`, launches the client in a pty with the
host command pointing at that model, types a prompt, and waits for the model's answer to appear in the
client's own output. Exit status 1 if it does not.

    ./smoke_host.py --binary target/release/rpi
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


def text_of(buf):
    return ANSI.sub(b" ", buf).decode("utf-8", "replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", required=True)
    ap.add_argument("--host", default="pi", help="the pi the client should spawn (default: pi on PATH)")
    ap.add_argument("--prompt", default="PLAIN: describe the render path")
    ap.add_argument("--needle", default="Done")
    ap.add_argument("--timeout", type=float, default=60.0)
    a = ap.parse_args()
    with fake_model(script="fake_model_corpus.py") as port, pi_home(port) as home, workdir() as cwd:
        argv = [
            a.binary,
            "--pi",
            f"{a.host} --mode rpc {' '.join(MODEL_ARGS)}",
            "--stats",
            "/tmp/smoke-host-stats.json",
        ]
        tty = Tty(argv, pi_env(home), str(cwd), cols=120, rows=40)
        try:
            deadline = time.time() + 30
            while time.time() < deadline and b"\x1b[?2026h" not in tty.buf:
                tty.pump(0.05)
            tty.send(a.prompt.replace(" ", " ").encode() + b"\r")
            deadline = time.time() + a.timeout
            seen = False
            while time.time() < deadline:
                tty.pump(0.05)
                if a.needle.encode() in text_of(tty.buf).encode():
                    seen = True
                    break
            tty.send(b"\x03\x04")  # clear (ctrl+c), then exit (ctrl+d): ticket 02 D6
            end = time.time() + 1.0
            while time.time() < end:
                if not tty.pump(0.05):
                    break
        finally:
            with contextlib.suppress(OSError):
                os.close(tty.fd)
            with contextlib.suppress(ChildProcessError, OSError):
                os.waitpid(tty.pid, os.WNOHANG)
        screen = text_of(tty.buf)
        if not seen:
            print("FAILED: the answer never appeared; screen tail:")
            print(screen[-600:])
            sys.exit(1)
        print(f"ok: {a.needle!r} rendered from a live RPC host ({len(tty.buf)} bytes, {tty.buf.count(b'\x1b[?2026h')} frames)")
        print("screen tail:", " ".join(screen.split())[-200:])


if __name__ == "__main__":
    main()
