#!/usr/bin/env python3
"""Echo latency and frame cost of the Rust client, measured from outside its process.

Types into the client's pseudo-terminal and measures the time until the character appears in the
bytes the client wrote — the same yardstick `acceptance.md` C-1 uses for pi. The client's own
`--stats` histogram is written beside these numbers so the two can be compared.

    ./echo_probe.py --binary target/release/pi-tui --replay FIXTURE --pace-ms 2 --keys 200
    ./echo_probe.py --binary ... --replay ... --load 0     # the client and a burner share core 0

The marker character is `¶`, which no fixture contains, so an appearance in the stream is the echo.
"""

import argparse
import contextlib
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from harness import Tty  # noqa: E402

MARKER = "¶"
# A frame is one synchronized-update begin, the definition `acceptance.md` uses.
FRAME = b"\x1b[?2026h"


def status_of(path):
    if not path or not os.path.exists(path):
        return None
    return open(path).read().strip()


def run(a):
    argv = [a.binary]
    if a.replay:
        argv += ["--replay", a.replay, "--pace-ms", str(a.pace_ms), "--repeat", str(a.repeat)]
    if a.stats:
        argv += ["--stats", a.stats]
    if a.load is not None:
        argv = ["taskset", "-c", str(a.load), *argv]
    burner = None
    if a.load is not None:
        burner = subprocess.Popen(["taskset", "-c", str(a.load), "sh", "-c", "while :; do :; done"])
    tty = Tty(argv, dict(os.environ), os.getcwd(), cols=a.cols, rows=a.rows)
    try:
        # First frame: the alternate-screen switch arrives before any paint, so wait for a frame marker.
        deadline = time.time() + 20
        while time.time() < deadline and FRAME not in tty.buf:
            tty.pump(0.05)
        if not tty.buf:
            raise SystemExit("the client painted nothing in 20 s")
        # A client that died at exec leaves the terminal echoing our keys, which looks like a 0.5 ms
        # echo latency and is nothing of the kind. Prove it is alive and painting real frames.
        passed, status = os.waitpid(tty.pid, os.WNOHANG)
        if passed:
            raise SystemExit(f"the client exited immediately (status {status}); wrote: {tty.buf[:400]!r}")
        if tty.buf.count(FRAME) == 0:
            raise SystemExit(f"no frame marker in the client's output: {tty.buf[:400]!r}")
        first_frame_at = time.time()

        # Let the replay get going, so echo is measured while the client is under streaming load.
        time.sleep(a.warmup)
        bytes_before = len(tty.buf)
        frames_before = tty.buf.count(FRAME)
        latencies = []
        seen = tty.buf.count(MARKER.encode())
        for _ in range(a.keys):
            start = time.perf_counter()
            os.write(tty.fd, MARKER.encode())
            if a.stall:
                time.sleep(a.stall)
            deadline = time.time() + a.key_timeout
            while time.time() < deadline:
                # Zero-timeout select in a tight loop: a 2 ms poll granularity would set the floor of
                # the measurement, and the number under test is under 2 ms.
                if not tty.pump(0.0):
                    time.sleep(0.00005)
                count = tty.buf.count(MARKER.encode())
                if count > seen:
                    seen = count
                    latencies.append((time.perf_counter() - start) * 1000.0)
                    break
            else:
                latencies.append(float("nan"))
            time.sleep(a.interval)
        bytes_after = len(tty.buf)
        frames_after = tty.buf.count(FRAME)

        os.write(tty.fd, b"\x03\x04")  # Ctrl-C clears, Ctrl-D exits: ticket 02 D6 of the v2 map
        end = time.time() + 1.0
        while time.time() < end:
            if not tty.pump(0.05):
                break
        bytes_after = len(tty.buf)
        frames_after = tty.buf.count(FRAME)
    finally:
        if burner:
            burner.terminate()
            burner.wait()
        # The client owns the pty; closing the descriptor reaps it if Ctrl-C did not.
        with contextlib.suppress(OSError):
            os.close(tty.fd)
        with contextlib.suppress(ChildProcessError, OSError):
            os.waitpid(tty.pid, os.WNOHANG)

    clean = sorted(x for x in latencies if x == x)
    pick = lambda q: clean[min(len(clean) - 1, round((len(clean) - 1) * q))] if clean else float("nan")  # noqa: E731
    print(
        f"echo n={len(clean)}/{a.keys} p50={pick(0.5):.3f}ms p95={pick(0.95):.3f}ms "
        f"p99={pick(0.99):.3f}ms max={max(clean) if clean else float('nan'):.3f}ms lost={len(latencies) - len(clean)}"
    )
    print(
        f"frames={frames_after - frames_before} over {time.time() - first_frame_at:.1f}s "
        f"bytes={bytes_after - bytes_before}"
    )
    stats = status_of(a.stats)
    if stats:
        print(f"client stats: {stats}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", required=True)
    ap.add_argument("--replay")
    ap.add_argument("--pace-ms", type=float, default=2.0)
    ap.add_argument("--keys", type=int, default=200)
    ap.add_argument("--repeat", type=int, default=1, help="replay the fixture this many times, for sustained load")
    ap.add_argument("--interval", type=float, default=0.02, help="seconds between keys")
    ap.add_argument("--key-timeout", type=float, default=5.0)
    ap.add_argument("--warmup", type=float, default=1.0)
    ap.add_argument("--load", type=int, help="pin the client and a burner to this CPU")
    ap.add_argument("--cols", type=int, default=120)
    ap.add_argument("--rows", type=int, default=40)
    ap.add_argument("--stats", help="where the client writes its own histogram")
    ap.add_argument(
        "--stall",
        type=float,
        default=0.0,
        help="seconds to stop reading the pty after each key (a slow terminal, C-7)",
    )
    run(ap.parse_args())


if __name__ == "__main__":
    main()
