# Measurement harness

Ticket 02 of the `tui-rust` map (`.scratch/tui-rust/`). Measures what the TUI costs — frames, CPU,
bytes, echo latency — against **either** binary, on the same box, so that every later ticket has a
gate and `acceptance.md`'s checks have a recorded run.

Derived from Pi-Bolt's `bench/` (MIT, same upstream): `harness.py`, `fake_model.py`,
`fake_model_stress.py`, `long_transcript.py`, `long_answer.py`, `pauses.py` and `fixtures/` are
copies, kept here so no run depends on the Pi-Bolt tree. Local additions: `run-under-load.sh`.

## What a run does

Each run starts its own scripted model server on a free port and its own throwaway
`PI_CODING_AGENT_DIR`, so the caller's pi configuration, extensions and model store cannot affect a
number. `long_transcript.py` writes a synthetic session of N entries (thinking, Markdown, bash calls,
~2.6 KB an entry), starts pi on a pty at 200x50, continues that session, and streams a paced answer
while counting:

| Quantity | Source |
|---|---|
| frames | occurrences of `\x1b[?2026h` (synchronized update begin) in the pty stream |
| fps | frames / wall time of the stream |
| cpu_s | sum over `/proc/<pid>/task/*/schedstat` |
| kb_written | bytes pi wrote to the pty |
| echo latency | `--keys`: time from writing a key to the pty until the frame that shows it |
| per-frame ms | `pauses.py` (gap between screen updates) |

## Use

```sh
# fullscreen and regular, 1 000 and 4 000 entries, a 60 000-character answer, echo measured
python3 long_transcript.py --build pi=pi --entries 1000,4000 --mode fullscreen,regular \
  --size 60000 --keys --json ../../../../.scratch/tui-rust/results/<date>-<arm>.jsonl

# the same under CPU contention: pi pinned to core 0, a burner on core 0 too
./run-under-load.sh 0 python3 long_transcript.py --build pi=pi --entries 4000 --cpus 0 --keys

# the answer alone: CPU per streamed character, no long transcript
python3 long_answer.py --build pi=pi --sizes 5000,60000

# the longest stretch with no write while the screen should be drawing, and GC pauses
python3 pauses.py --build pi=pi --scenario answer --gc
```

`--build` is repeatable and takes `name=command`, so the Rust client is measured by the same tool:

```sh
python3 long_transcript.py --build pi=pi --build client=extensions/tui/target/release/rpi \\
  --entries 4000 --keys
```

## Rules this harness exists to enforce

1. **A check without a recorded run fails** (`acceptance.md`). Append each run to
   `.scratch/tui-rust/results/<date>-<arm>.md` with the box, both binaries and the commit.
2. **Never carry a number across machines.** Baseline and client are measured in the same session on
   the same box, unpacked and page-cache-warm (`harness.py` does the warming).
3. **Contention is part of the measurement.** `run-under-load.sh` makes "under load" a repeatable
   state rather than a story about three cargo builds.
