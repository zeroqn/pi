#!/usr/bin/env bash
# Run a measurement with a burner pinning CPU time away from the process under test.
#
#   ./run-under-load.sh 0 python3 long_transcript.py --build pi=pi --entries 4000 --cpus 0 --keys
#
# The burner runs on the same core the command is pinned to, so the measured process gets about half
# of one core — the state in which pi 1.5.0 fell from 34.1 to 4.6 fps on a 26-vCPU box.
set -u
cpus=${1:?usage: run-under-load.sh <cpu-list> <command...>}
shift
taskset -c "$cpus" sh -c 'while :; do :; done' &
burner=$!
trap 'kill "$burner" 2>/dev/null' EXIT INT TERM
taskset -c "$cpus" "$@"
