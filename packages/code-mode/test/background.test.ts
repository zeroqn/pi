/**
 * Background handles (ticket 10). These drive real shell processes, which is the point:
 * the process lives on the host, so the contract that matters is the one the host obeys.
 */
import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackgroundManager, type BgHandleInfo } from "../src/background";

function harness(cap = 8, limits: { softBoundSeconds?: number; leaseGraceSeconds?: number } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "rlm-bg-test-"));
	const finished: BgHandleInfo[] = [];
	const leases: Array<{ id: string; why: string; grace: number }> = [];
	const manager = createBackgroundManager({
		cwd: () => dir,
		logDir: () => join(dir, "logs"),
		cap,
		...limits,
		onFinish: (record) => finished.push(record),
		onLease: (record, grace, why) => leases.push({ id: record.id, why, grace }),
	});
	return { dir, manager, finished, leases, done: () => rmSync(dir, { recursive: true, force: true }) };
}

async function until(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("condition not reached in time");
}

describe("a background handle", () => {
	it("runs, reports its status, and keeps the output", async () => {
		const h = harness();
		try {
			const handle = h.manager.start("printf hello-from-bg", null);
			expect(handle.id).toBe("bg-1");
			expect(handle.status).toBe("running");
			await until(() => h.manager.poll(handle.id).status !== "running");
			const settled = h.manager.poll(handle.id);
			expect(settled.status).toBe("done");
			expect(settled.exit_code).toBe(0);
			expect(h.manager.output(handle.id).text).toBe("hello-from-bg");
			expect(h.finished.length).toBe(1);
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});

	it("reports a failing command as failed, with its exit code", async () => {
		const h = harness();
		try {
			const handle = h.manager.start("exit 3", null);
			await until(() => h.manager.poll(handle.id).status !== "running");
			const settled = h.manager.poll(handle.id);
			expect(settled.status).toBe("failed");
			expect(settled.exit_code).toBe(3);
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});

	it("can be killed, and says so", async () => {
		const h = harness();
		try {
			const handle = h.manager.start("sleep 30", null);
			const killed = h.manager.kill(handle.id);
			expect(killed.status).toBe("killed");
			expect(killed.reason).toBe("killed by request");
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});

	it("applies its timeout as a distinguishable terminal reason", async () => {
		const h = harness();
		try {
			const handle = h.manager.start("sleep 30", 1);
			await until(() => h.manager.poll(handle.id).status !== "running", 10_000);
			const settled = h.manager.poll(handle.id);
			expect(settled.status).toBe("timeout");
			expect(settled.reason).toContain("timed out after 1s");
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});

	it("refuses to exceed the cap, naming the limit", async () => {
		const h = harness(2);
		try {
			h.manager.start("sleep 30", null);
			h.manager.start("sleep 30", null);
			expect(() => h.manager.start("sleep 30", null)).toThrow(/limit is 2/);
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});

	it("writes the log where a resumed session can read it", async () => {
		const h = harness();
		try {
			const handle = h.manager.start("printf logged", null);
			await until(() => h.manager.poll(handle.id).status !== "running");
			expect(readFileSync(handle.log_path!, "utf8")).toBe("logged");
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});
});

describe("restoring after a resume", () => {
	it("never re-runs a process, and never claims one is still alive", async () => {
		const h = harness();
		try {
			const previous: BgHandleInfo[] = [
				{
					id: "bg-7",
					command: "sleep 999",
					pid: 1,
					status: "running",
					exit_code: null,
					started_at: new Date(0).toISOString(),
					ended_at: null,
					log_path: null,
				},
			];
			h.manager.restore(previous);
			const restored = h.manager.poll("bg-7");
			expect(restored.status).toBe("killed");
			expect(restored.reason).toContain("did not survive");
			expect(h.manager.list().length).toBe(1);
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});

	it("kills what is still live when the session ends", async () => {
		const h = harness();
		try {
			const handle = h.manager.start("sleep 30", null);
			await h.manager.shutdownAll();
			const settled = h.manager.poll(handle.id);
			expect(settled.status).toBe("killed");
			expect(settled.reason).toBe("the session ended");
		} finally {
			h.done();
		}
	});
});

describe("what a handle says about progress (long-work ticket 03)", () => {
	it("reports an age that grows, the bytes it has seen, and the bound that was declared", async () => {
		const h = harness();
		try {
			// Slow enough to be read twice, and printing so the byte counter has something to count.
			const handle = h.manager.start("printf one; sleep 1; printf two; sleep 5", 60);
			expect(handle.timeout_s).toBe(60);
			expect(handle.age_ms ?? -1).toBeGreaterThanOrEqual(0);
			const first = h.manager.poll(handle.id);
			await new Promise((resolve) => setTimeout(resolve, 400));
			const second = h.manager.poll(handle.id);
			// Both are read-time facts: an age the *reader* would otherwise have to derive from two clocks.
			expect(second.age_ms ?? 0).toBeGreaterThan(first.age_ms ?? 0);
			expect(second.bytes_out).toBeGreaterThanOrEqual(3);
			// Only `running` work has progress to measure: once it ends there is no age to report.
			h.manager.kill(handle.id);
			const ended = h.manager.poll(handle.id);
			expect(ended.status).toBe("killed");
			expect(ended.age_ms).toBeNull();
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});

	it("reads an unbounded handle as unbounded, and a silent one as silent — never as a verdict", async () => {
		const h = harness();
		try {
			// A command that emits nothing for its whole life: `bytes_out` stays 0 and the age grows.
			const handle = h.manager.start("sleep 5", null);
			expect(handle.timeout_s).toBeNull();
			await new Promise((resolve) => setTimeout(resolve, 300));
			const during = h.manager.poll(handle.id);
			expect(during.bytes_out).toBe(0);
			expect(during.age_ms ?? 0).toBeGreaterThan(0);
			// There is no `stale`, and no `last_output_at`: the fields are facts, and a piped command
			// produces no output until it ends, so a verdict built on silence would call a healthy run
			// stuck (the case this effort started from).
			expect(Object.keys(during).includes("stale")).toBe(false);
			expect(Object.keys(during).includes("last_output_at")).toBe(false);
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});
});

describe("the lease on a shell that declared no bound (2026-10-17)", () => {
	/**
	 * The case this answers is in `.scratch/bg-lease/REPORT.md`: a session backgrounded a script that
	 * blocked in a bare `wait` behind its own spinner processes, and with nothing to bound it the
	 * shell held a machine for eighteen hours while no notice was ever due — a notice is raised when a
	 * handle *finishes*. These drive the two constants down through the `deps` seam.
	 */
	function leased(soft: number, grace: number) {
		const dir = mkdtempSync(join(tmpdir(), "rlm-bg-lease-"));
		const finished: BgHandleInfo[] = [];
		const leases: Array<{ id: string; grace: number; lease_s: number | null }> = [];
		const manager = createBackgroundManager({
			cwd: () => dir,
			logDir: () => join(dir, "logs"),
			cap: 8,
			softBoundSeconds: soft,
			leaseGraceSeconds: grace,
			onFinish: (record) => finished.push(record),
			onLease: (record, graceSeconds) => leases.push({ id: record.id, grace: graceSeconds, lease_s: record.lease_s }),
		});
		return { dir, manager, finished, leases, done: () => rmSync(dir, { recursive: true, force: true }) };
	}

	it("announces at the soft bound without killing, and a grant keeps the handle alive past the grace", async () => {
		const h = leased(1, 2);
		try {
			const handle = h.manager.start("sleep 30", null);
			// Before the soft bound there is nothing to judge, and no countdown to report.
			expect(handle.timeout_s).toBeNull();
			expect(handle.lease_s).toBeNull();
			await until(() => h.leases.length === 1, 8000);
			// Announced — and still running: the notice reports a deadline, it does not impose one.
			const announced = h.manager.poll(handle.id);
			expect(announced.status).toBe("running");
			expect(h.leases[0]!.id).toBe(handle.id);
			expect(h.leases[0]!.grace).toBe(2);
			expect(announced.timeout_s).toBeNull();
			expect(announced.lease_s ?? 0).toBeGreaterThan(0);
			// Judged: the grant *becomes* the bound, so the lease is over and the handle stands.
			const granted = h.manager.extend(handle.id, 30);
			expect(granted.status).toBe("running");
			expect(granted.timeout_s).toBe(30);
			expect(granted.lease_s).toBeNull();
			// Past the moment the unattended kill would have fallen: it did not.
			await new Promise((resolve) => setTimeout(resolve, 2500));
			expect(h.manager.poll(handle.id).status).toBe("running");
			h.manager.kill(handle.id);
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});

	it("kills a handle nobody judged, with a reason that says why, and still finishes it", async () => {
		const h = leased(1, 1);
		try {
			const handle = h.manager.start("sleep 30", null);
			await until(() => h.manager.poll(handle.id).status !== "running", 12_000);
			const settled = h.manager.poll(handle.id);
			expect(settled.status).toBe("killed");
			expect(settled.reason).toContain("unattended");
			expect(settled.reason).toContain("no bound was declared");
			expect(settled.lease_s).toBeNull();
			// One terminal event, so the completion notice fires exactly as it does for any other end.
			expect(h.finished.length).toBe(1);
			expect(h.finished[0]!.status).toBe("killed");
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});

	it("leaves a declared bound to its own hard kill, and never announces one", async () => {
		const h = leased(1, 60);
		try {
			h.manager.start("sleep 30", 1);
			await until(() => h.manager.list()[0]!.status !== "running", 10_000);
			expect(h.leases.length).toBe(0);
			expect(h.manager.list()[0]!.status).toBe("timeout");
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});

	it("refuses a grant that is not a positive span, and answers a settled handle as it stands", async () => {
		const h = leased(1, 1);
		try {
			const handle = h.manager.start("sleep 30", null);
			expect(() => h.manager.extend(handle.id, 0)).toThrow(/positive number of seconds/);
			expect(() => h.manager.extend(handle.id, Number.NaN)).toThrow(/positive number of seconds/);
			h.manager.kill(handle.id);
			const settled = h.manager.extend(handle.id, 60);
			expect(settled.status).toBe("killed");
			expect(settled.timeout_s).toBeNull();
		} finally {
			await h.manager.shutdownAll();
			h.done();
		}
	});
});

describe("restoring tells the truth about a process that outlived its session (2026-10-17)", () => {
	/**
	 * The verdict used to be unconditional: a record that was `running` when the previous session ended
	 * was called `killed` — *"the process did not survive the session that started it"* — without asking.
	 * True of a clean end, false of a **leak**, and the incident in `background.ts`'s header left two
	 * shells holding a machine for eighteen hours while every resumed session described them as dead.
	 * The three answers are tested here; `lease.test.ts` drives the notice the live one produces.
	 */
	function spawnOwn(command: string): number {
		// A process this test starts itself, so it can assert on it: detached and its own group, like the
		// manager's own children.
		const child = spawn("/bin/bash", ["-lc", command], { detached: true, stdio: "ignore" });
		return child.pid!;
	}

	function alive(pid: number | null): boolean {
		if (pid === null) return false;
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	it("reports a verified orphan as running, and kills it when nobody grants it more time", async () => {
		// A first session starts a real shell; a second one (a fresh manager, as a resume is) reads the
		// record and probes it. The lease is driven at a second, so its grace is reachable.
		const first = harness();
		const second = harness(8, { softBoundSeconds: 1, leaseGraceSeconds: 1 });
		let pid: number | null = null;
		try {
			const handle = first.manager.start("sleep 30", null);
			await new Promise((resolve) => setTimeout(resolve, 200));
			const info = first.manager.poll(handle.id);
			pid = info.pid;
			// The identity token is recorded at spawn, from the host: without it a resume could only ever
			// say "cannot verify".
			expect(info.pid_start).toBeGreaterThan(0);
			expect(alive(pid)).toBe(true);

			second.manager.restore([info]);
			const restored = second.manager.poll(info.id);
			// Still running, and honest about where it came from — not "killed".
			expect(restored.status).toBe("running");
			expect(restored.reason).toContain("started by an earlier session");
			expect(restored.reason).toContain(`pid ${pid}`);
			// Announced at once (`soft = 0`) rather than after a fresh hour, and named as an orphan.
			await until(() => second.leases.length === 1, 5000);
			expect(second.leases[0]).toEqual({ id: info.id, why: "orphan", grace: 1 });
			expect(second.manager.poll(info.id).lease_s).not.toBeNull();
			expect(alive(pid)).toBe(true);
			// Nobody judged it: the process is really gone, and the verdict says why.
			await until(() => second.manager.poll(info.id).status !== "running", 8000);
			const settled = second.manager.poll(info.id);
			expect(settled.status).toBe("killed");
			expect(settled.reason).toContain("an earlier session started it");
			await until(() => !alive(pid), 4000);
		} finally {
			await first.manager.shutdownAll();
			await second.manager.shutdownAll();
			if (alive(pid)) process.kill(-(pid as number), "SIGKILL");
			first.done();
			second.done();
		}
	});

	it("reports a pid it cannot prove is the record's process, and never kills it", async () => {
		const h = harness();
		const pid = spawnOwn("sleep 30");
		try {
			// No `pid_start`: a record written before the field existed, or a platform with no /proc. The
			// pid is alive — so the record must not claim otherwise — and nothing proves it is *this*
			// record's process, so this session must not kill it either.
			h.manager.restore([restoredRecord("bg-9", pid, null)]);
			const restored = h.manager.poll("bg-9");
			expect(restored.status).toBe("unverified");
			expect(restored.reason).toContain(`a process with pid ${pid} is alive`);
			expect(restored.reason).toContain("cannot prove");
			expect(restored.lease_s).toBeNull();
			// The pid-reuse guard: not `kill`, not a mode change, not the session's own end.
			h.manager.kill("bg-9");
			await h.manager.shutdownAll();
			expect(alive(pid)).toBe(true);
			expect(h.manager.poll("bg-9").status).toBe("unverified");
		} finally {
			if (alive(pid)) process.kill(-pid, "SIGKILL");
			h.done();
		}
	});

	it("answers a mismatched start time the same way, so a reused pid is never killed", async () => {
		const h = harness();
		const pid = spawnOwn("sleep 30");
		try {
			// A live pid whose start time is not the one recorded: the pid was reused, and the process
			// wearing it now is somebody else's.
			h.manager.restore([restoredRecord("bg-8", pid, 1)]);
			expect(h.manager.poll("bg-8").status).toBe("unverified");
			await h.manager.shutdownAll();
			expect(alive(pid)).toBe(true);
		} finally {
			if (alive(pid)) process.kill(-pid, "SIGKILL");
			h.done();
		}
	});

	it("keeps the old sentence where it is true: the process really is gone", async () => {
		const first = harness();
		const second = harness();
		try {
			const handle = first.manager.start("true", null);
			await until(() => first.manager.poll(handle.id).status !== "running");
			const finished = first.manager.poll(handle.id);
			// A second session reads the record as it was written, but as if the process had been running
			// when its session died. The probe asks the host, finds nothing, and *then* says "did not
			// survive" — the same words as before, now the answer to a question.
			second.manager.restore([{ ...finished, status: "running", ended_at: null }]);
			const restored = second.manager.poll(handle.id);
			expect(restored.status).toBe("killed");
			expect(restored.reason).toBe("the process did not survive the session that started it");
		} finally {
			await first.manager.shutdownAll();
			await second.manager.shutdownAll();
			first.done();
			second.done();
		}
	});
});

/** A record as a previous session wrote it, with the fields this test cares about under its control. */
function restoredRecord(id: string, pid: number, pidStart: number | null): BgHandleInfo {
	return {
		id,
		command: "sleep 30",
		pid,
		status: "running",
		exit_code: null,
		reason: undefined,
		started_at: new Date(0).toISOString(),
		ended_at: null,
		log_path: null,
		age_ms: null,
		timeout_s: null,
		lease_s: null,
		pid_start: pidStart,
		bytes_out: 0,
	};
}
