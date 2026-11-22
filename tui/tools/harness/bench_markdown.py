#!/usr/bin/env python3
"""Per-chunk cost of the client's markdown, against a whole-source re-parse (ticket 06).

Feeds an answer in pi's streaming shape — a paced append of small chunks — through two implementations:

  * `full`  — re-parse the whole accumulated source per chunk (what upstream pi does);
  * `stream` — `StreamingMarkdown`: frozen blocks plus the open tail.

Reports per-chunk average, p99 and worst at 1 / 10 / 26.9 / 60 KB of prose and of a single growing
fenced TS block, with the chunk size set to 12 bytes (pi's observed streaming granularity).

    ./bench_markdown.py --binary <path-to>/markdown_bench
"""

import argparse
import json
import subprocess
import sys


def run(binary, kind, size):
    out = subprocess.run(
        [binary, "--kind", kind, "--size", str(size), "--chunk", "12"],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        print(out.stderr[-400:], file=sys.stderr)
        raise SystemExit(out.returncode)
    return json.loads(out.stdout.strip().splitlines()[-1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", required=True)
    ap.add_argument("--sizes", default="1000,10000,26900,60000")
    ap.add_argument("--kinds", default="prose,fence")
    a = ap.parse_args()
    rows = []
    print(f"{'kind':6s} {'KB':>6s} {'impl':8s} {'chunks':>7s} {'avg ms':>8s} {'p99 ms':>8s} {'worst ms':>9s}")
    for kind in a.kinds.split(","):
        for size in [int(x) for x in a.sizes.split(",")]:
            for impl in ("full", "stream"):
                r = run(a.binary, kind, size)
                stats = r[impl]
                rows.append(
                    {
                        "kind": kind,
                        "size": size,
                        "impl": impl,
                        "chunks": r["chunks"],
                        "avg_ms": stats["avg_ms"],
                        "p99_ms": stats["p99_ms"],
                        "worst_ms": stats["worst_ms"],
                    }
                )
                print(
                    f"{kind:6s} {size / 1000:6.1f} {impl:8s} {r['chunks']:7d} "
                    f"{stats['avg_ms']:8.3f} {stats['p99_ms']:8.3f} {stats['worst_ms']:9.3f}"
                )
    json.dump(rows, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
