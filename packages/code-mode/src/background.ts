/**
 * Background shell handles — ticket 10.
 *
 * A background command is the one capability in this design with no pi precedent:
 * pi's own bash tool is synchronous. The handle is a prelude object over these host
 * functions, and the process lives on the host, because the kernel is a
 * single-threaded interpreter with no processes of its own.
 *
 * Records are persisted (metadata in the transcript, output in a file beside the
 * session) so a resumed session can still see what ran — read-only, and never
 * re-executed: replay turns a journaled background start into a **terminal handle
 * with its recorded output**.
 *
 * **Since 2026-10-17 a background shell with no declared `timeout=` is a lease.** The case is
 * measured (`.scratch/bg-lease/REPORT.md`): a session backgrounded a benchmark whose own script
 * blocked in a bare `wait` behind spinner processes it had started, and with nothing to bound it
 * the shell held ~20 cores for eighteen hours. An abort does not touch a background handle — that
 * is the point of it being session-owned — and `shutdownAll` runs only at `session_shutdown`, so
 * while the process stayed open nothing could end it and no notice was ever due, because a notice
 * is raised when a handle **finishes**. The lease closes exactly that hole: the handle still runs
 * past its soft bound (the model is the actor, `long-work` tickets 03/01), it is *announced*, and
 * only a handle nobody grants more time is killed. A declared `timeout=` is untouched by it.
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SHELL } from "./shell";

export type BgStatus = "running" | "done" | "failed" | "killed" | "timeout" | "unverified";

export interface BgHandleInfo {
	id: string;
	command: string;
	pid: number | null;
	status: BgStatus;
	exit_code: number | null;
	reason?: string;
	started_at: string;
	ended_at: string | null;
	log_path: string | null;
	/**
	 * How long it has been going, measured against the kernel's own monotonic reference — and `null`
	 * unless the process is running **here**: a finished handle, or one restored from a previous
	 * session, has no duration this process can vouch for (`.scratch/long-work` ticket 03).
	 *
	 * It answers one question — *should I end this?* — which only a running shell poses. Whether a run
	 * has **finished** is what the completion notice is for.
	 */
	age_ms: number | null;
	/**
	 * The bound the caller declared, or `null` for unbounded. A shell is the one thing in a cell that
	 * knows its own expected duration, so this is the only field an age can be read *against*.
	 */
	timeout_s: number | null;
	/**
	 * Bytes of output seen **in this process** — a monotonic counter, not a read of `output`, which is
	 * trimmed to its last 64 KB once it grows. A restored handle counts from zero, and says so.
	 */
	bytes_out: number;
	/**
	 * Seconds until an **unattended** handle is killed — the clock to judge by, computed at read
	 * time like `age_ms`. Non-`null` only in the window that opens when the soft bound is announced
	 * and closes when the model grants more time or the handle ends, so `null` means *there is no
	 * such deadline*, never *no deadline at all*.
	 */
	lease_s: number | null;
	/**
	 * The process's own start time, as the host's OS reports it (`/proc/<pid>/stat`'s `starttime`, in
	 * clock ticks since boot), recorded so a **later** session can tell this process from a different
	 * one that inherited the pid.
	 *
	 * `null` where the host cannot say — no `/proc`, or a record written before this field existed —
	 * and that absence is honest rather than assumed: a resumed session that cannot prove a live pid is
	 * *this* process reports `unverified` and kills nothing (see `restore`).
	 */
	pid_start: number | null;
}

interface BgRecord extends Omit<BgHandleInfo, "age_ms" | "timeout_s" | "lease_s" | "pid_start" | "bytes_out"> {
	child?: ReturnType<typeof spawn>;
	output: string;
	timeoutSeconds: number | null;
	/** Armed for a **declared** bound; the lease's two timers are below and never coexist with it. */
	timer?: ReturnType<typeof setTimeout>;
	/** The soft bound's announcement, then the countdown it starts. Unset once either is disarmed. */
	softTimer?: ReturnType<typeof setTimeout>;
	leaseTimer?: ReturnType<typeof setTimeout>;
	/**
	 * When the unattended kill falls, against the kernel's monotonic reference, or `null` outside the
	 * announced window. `lease_s` is this read against the clock rather than a second countdown.
	 */
	leaseKillAtMonotonic: number | null;
	/** Why this handle is leased — the text differs, the mechanism does not ({@link LeaseWhy}). */
	leaseWhy: LeaseWhy;
	/** The process's start time as the OS reports it (see {@link BgHandleInfo.pid_start}). */
	pidStart: number | null;
	/** `null` for a restored record: the process it describes did not run here. */
	startedMonotonic: number | null;
	bytesOut: number;
}

/**
 * Why a handle is serving a lease: its own caller declared no bound, or an **earlier session** started
 * it and this one found it still running. One mechanism and two sentences — the model is told which,
 * because "you never bounded this" and "this outlived a session" call for different judgement.
 */
export type LeaseWhy = "undeclared" | "orphan";

const MAX_MEMORY_OUTPUT = 64 * 1024;

/**
 * A running process's start time, as Linux reports it in `/proc/<pid>/stat`'s 22nd field — clock ticks
 * since boot, immutable for the life of the process, which is what makes it an identity rather than a
 * timestamp. `null` where it cannot be read: another platform, a pid that is gone, an unreadable
 * `/proc`. A caller must treat `null` as *cannot say*, never as *not the same process*.
 *
 * Read from `/proc` rather than by shelling out to `ps` for the same reason `killProcess` uses
 * `process.kill`: this runs at spawn and at restore, and a subprocess there would be a process to
 * reap in order to learn about processes.
 */
function readPidStart(pid: number): number | null {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		// The comm field is parenthesised and may itself contain spaces and parens, so count fields
		// from the *last* ")" rather than splitting on whitespace from the front.
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		const starttime = Number(fields[19]);
		return Number.isFinite(starttime) ? starttime : null;
	} catch {
		return null;
	}
}

/**
 * What a record's pid says about the process now (see `restore`, which is the only caller).
 *
 * `process.kill(pid, 0)` is the existence probe: it throws `ESRCH` for a pid nothing holds and `EPERM`
 * for one this user does not own — and *both* mean this record's process is gone, since a child we
 * spawned is ours. A live pid is then matched against the start time recorded at spawn; a record with
 * no such token (an older one, or another platform) can only ever be `unverified`.
 */
function probeRestored(record: BgHandleInfo): "gone" | "live" | "unverified" {
	const pid = record.pid;
	if (pid === null || pid <= 0) return "gone";
	try {
		process.kill(pid, 0);
	} catch {
		return "gone";
	}
	const expected = record.pid_start ?? null;
	const actual = readPidStart(pid);
	return expected !== null && actual !== null && actual === expected ? "live" : "unverified";
}

/**
 * The soft bound an **undeclared** background shell gets, and the grace it has to be judged in.
 *
 * The soft bound is not a kill: at it the handle is announced (`deps.onLease`) and the countdown
 * that *will* kill it starts, so a job nobody attends to stops instead of burning a machine, while
 * a job the model is watching is kept by one call (`extend`). Both are module constants rather than
 * knobs — a value a caller could pass is one more thing to get wrong — and a test drives them
 * through `deps`, the seam `limits?` already is elsewhere.
 */
export const SOFT_BOUND_SECONDS = 3600;
export const LEASE_GRACE_SECONDS = 600;

export interface BackgroundManagerDeps {
	cwd: () => string;
	/** Directory for the output logs; the session must stay readable after resume. */
	logDir: () => string;
	onFinish: (record: BgHandleInfo) => void;
	onRecord?: (record: BgHandleInfo) => void;
	cap: number;
	/**
	 * The soft bound has passed on an undeclared handle, and `graceSeconds` is all the time left to
	 * judge it in. A notice, not a kill: the caller composes the sentence, because it is the one that
	 * knows how this session speaks to the model (`kernel.ts`'s `raiseNotice`).
	 */
	onLease?: (record: BgHandleInfo, graceSeconds: number, why: LeaseWhy) => void;
	/** Test seams for the two constants; production takes the module values. */
	softBoundSeconds?: number;
	leaseGraceSeconds?: number;
}

export function createBackgroundManager(deps: BackgroundManagerDeps) {
	const records = new Map<string, BgRecord>();
	const softBoundSeconds = deps.softBoundSeconds ?? SOFT_BOUND_SECONDS;
	const leaseGraceSeconds = deps.leaseGraceSeconds ?? LEASE_GRACE_SECONDS;
	let counter = 0;

	function info(record: BgRecord): BgHandleInfo {
		const {
			child: _child,
			output: _output,
			timeoutSeconds,
			timer: _timer,
			// Every internal field is destructured away here, not merely typed out of the record: the
			// spread below is what the model sees through `bg_list`, and a `setTimeout` handle in it is a
			// value monty cannot convert (`abort.test.ts` caught exactly that on the first run of the lease).
			softTimer: _softTimer,
			leaseTimer: _leaseTimer,
			leaseKillAtMonotonic: _leaseAt,
			startedMonotonic,
			bytesOut,
			// A restored record was spread from a previous session's info, so the computed fields may
			// already be sitting on it. They are recomputed here rather than inherited: what a *previous*
			// process saw is not what this one can vouch for.
			age_ms: _staleAge,
			timeout_s: _staleTimeout,
			lease_s: _staleLease,
			bytes_out: _staleBytes,
			...rest
		} = record as BgRecord & Partial<BgHandleInfo>;
		const now = performance.now();
		return {
			...(rest as Omit<BgHandleInfo, "age_ms" | "timeout_s" | "lease_s" | "bytes_out">),
			age_ms:
				record.status === "running" && startedMonotonic !== null
					? Math.max(0, Math.round(now - startedMonotonic))
					: null,
			timeout_s: timeoutSeconds,
			pid_start: record.pidStart,
			// Only a running handle inside the announced window has a countdown; everywhere else the
			// answer is an absence (see the field).
			lease_s:
				record.status === "running" && record.leaseKillAtMonotonic != null
					? Math.max(0, Math.round((record.leaseKillAtMonotonic - now) / 1000))
					: null,
			bytes_out: bytesOut,
		};
	}

	function find(id: string): BgRecord {
		const record = records.get(String(id));
		if (!record) {
			const known = [...records.keys()];
			throw new Error(`no background handle "${id}"${known.length ? `; known: ${known.join(", ")}` : ""}`);
		}
		return record;
	}

	function finish(record: BgRecord, status: BgStatus, reason?: string, exitCode?: number | null) {
		if (record.status !== "running") return;
		record.status = status;
		record.reason = reason;
		record.exit_code = exitCode ?? record.exit_code;
		record.ended_at = new Date().toISOString();
		clearTimers(record);
		try {
			if (record.log_path) {
				mkdirSync(deps.logDir(), { recursive: true });
				writeFileSync(record.log_path, record.output);
			}
		} catch {
			// Losing the log must not lose the record.
		}
		deps.onRecord?.(info(record));
		deps.onFinish(info(record));
	}

	function clearTimers(record: BgRecord): void {
		for (const timer of [record.timer, record.softTimer, record.leaseTimer]) {
			if (timer) clearTimeout(timer);
		}
		record.timer = record.softTimer = record.leaseTimer = undefined;
	}

	/** A declared bound, and the grant `extend` turns a lease into: one kill, one status, one reason. */
	function armHardBound(record: BgRecord, seconds: number): void {
		record.timer = setTimeout(() => {
			if (record.status !== "running") return;
			record.reason = `timed out after ${seconds}s`;
			killProcess(record);
			finish(record, "timeout", record.reason, null);
		}, seconds * 1000);
		record.timer.unref?.();
	}

	/**
	 * The lease for a handle whose caller declared no bound: announce at `seconds`, and start the
	 * countdown that kills it if nobody grants more time.
	 *
	 * The kill is armed by the **announcement**, not by its delivery: a session with no turn coming
	 * still gets the deadline it was told about, which is the whole reason this exists (a notice that
	 * waits for a turn would leave the case that started this file's header exactly as it was).
	 */
	function armLease(record: BgRecord, seconds: number, why: LeaseWhy = "undeclared"): void {
		record.leaseWhy = why;
		record.softTimer = setTimeout(() => {
			if (record.status !== "running") return;
			record.leaseKillAtMonotonic = performance.now() + leaseGraceSeconds * 1000;
			deps.onLease?.(info(record), leaseGraceSeconds, why);
			record.leaseTimer = setTimeout(() => {
				if (record.status !== "running") return;
				record.reason =
					why === "orphan"
						? `unattended: an earlier session started it and no more time was granted within ${leaseGraceSeconds}s`
						: `unattended: no bound was declared and none was granted within ${leaseGraceSeconds}s of the ${seconds}s soft bound`;
				killProcess(record);
				finish(record, "killed", record.reason, null);
			}, leaseGraceSeconds * 1000);
			record.leaseTimer.unref?.();
		}, seconds * 1000);
		record.softTimer.unref?.();
	}

	function start(command: string, timeoutSeconds: number | null): BgHandleInfo {
		const running = [...records.values()].filter((record) => record.status === "running");
		if (running.length >= deps.cap) {
			throw new Error(`${running.length} background commands are already running; the limit is ${deps.cap}. Use bg_list() and kill one first.`);
		}
		const id = `bg-${++counter}`;
		const child = spawn(SHELL, ["-lc", command], {
			cwd: deps.cwd(),
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const record: BgRecord = {
			id,
			command,
			pid: child.pid ?? null,
			status: "running",
			exit_code: null,
			started_at: new Date().toISOString(),
			ended_at: null,
			log_path: join(deps.logDir(), `${id}.log`),
			child,
			output: "",
			timeoutSeconds,
			startedMonotonic: performance.now(),
			leaseKillAtMonotonic: null,
			leaseWhy: "undeclared",
			// Read here, at spawn: a start time is fixed at fork, so this is the one moment it is both
			// available and cheap, and it is what lets a *later* session prove this pid is this process.
			pidStart: readPidStart(child.pid ?? -1),
			bytesOut: 0,
		};
		const append = (chunk: Buffer) => {
			record.bytesOut += chunk.length;
			record.output += chunk.toString();
			// Keep memory bounded; the full text is written when the handle finishes.
			if (record.output.length > MAX_MEMORY_OUTPUT * 2) {
				try {
					mkdirSync(deps.logDir(), { recursive: true });
					appendFileSync(record.log_path!, record.output.slice(0, record.output.length - MAX_MEMORY_OUTPUT));
				} catch {
					/* the log is best effort */
				}
				record.output = record.output.slice(-MAX_MEMORY_OUTPUT);
			}
		};
		child.stdout?.on("data", append);
		child.stderr?.on("data", append);
		child.on("error", (error) => finish(record, "failed", error.message));
		child.on("close", (code, signal) => {
			if (record.status !== "running") return;
			if (signal) finish(record, "killed", `signal ${signal}`, null);
			else finish(record, code === 0 ? "done" : "failed", code === 0 ? undefined : `exit ${code}`, code);
		});

		// A declared bound is a promise and keeps today's hard kill; a shell that declared none gets the
		// lease, which announces and only then kills (the header).
		if (timeoutSeconds !== null && timeoutSeconds > 0) armHardBound(record, timeoutSeconds);
		else armLease(record, softBoundSeconds);

		records.set(id, record);
		deps.onRecord?.(info(record));
		return info(record);
	}

	function killProcess(record: BgRecord) {
		try {
			// Detached, so the child leads its own process group: kill the group.
			if (record.pid) process.kill(-record.pid, "SIGKILL");
			else record.child?.kill("SIGKILL");
		} catch {
			try {
				record.child?.kill("SIGKILL");
			} catch {
				/* already gone */
			}
		}
	}

	function tail(record: BgRecord, tailBytes = MAX_MEMORY_OUTPUT): { text: string; truncated: boolean; log_path: string | null } {
		let text = record.output;
		let truncated = false;
		// A finished handle's log holds everything the in-memory tail had to drop.
		if (record.status !== "running" && record.log_path) {
			try {
				text = readFileSync(record.log_path, "utf8");
			} catch {
				/* keep the in-memory tail */
			}
		}
		if (text.length > tailBytes) {
			text = text.slice(-tailBytes);
			truncated = true;
		}
		return { text, truncated, log_path: record.log_path };
	}

	return {
		start,

		poll(id: string): BgHandleInfo {
			return info(find(id));
		},

		output(id: string, tailBytes?: number) {
			return tail(find(id), tailBytes);
		},

		kill(id: string): BgHandleInfo {
			const record = find(id);
			if (record.status === "running") {
				killProcess(record);
				finish(record, "killed", "killed by request", null);
			}
			return info(record);
		},

		/**
		 * Grant a handle more seconds, and answer with it.
		 *
		 * **One rule: the grant becomes the bound.** The lease is over, `timeout_s` reports the granted
		 * value, and from here the handle is hard-bounded exactly as a declared `timeout=` is — so
		 * `extend` is the same act whether it answers a lease notice or re-decides a bound the caller
		 * set too low. A terminal handle is simply answered as it stands, the way `kill` does it.
		 */
		extend(id: string, seconds: number): BgHandleInfo {
			const record = find(id);
			if (record.status !== "running") return info(record);
			const granted = Math.floor(seconds);
			if (!Number.isFinite(granted) || granted <= 0) {
				throw new Error(`bg_extend needs a positive number of seconds, got ${String(seconds)}`);
			}
			clearTimers(record);
			record.leaseKillAtMonotonic = null;
			record.timeoutSeconds = granted;
			armHardBound(record, granted);
			deps.onRecord?.(info(record));
			return info(record);
		},

		list(): BgHandleInfo[] {
			return [...records.values()].map(info);
		},

		/**
		 * Restoration for a resumed session: nothing is re-executed, and — since 2026-10-17 — nothing is
		 * **misreported** either.
		 *
		 * It used to call every record that was `running` when the previous session ended `killed` with
		 * *"the process did not survive the session that started it"*, without asking. That is true of a
		 * session that ended cleanly (`shutdownAll` killed them) and false of a **leaked** one: the
		 * incident in this file's header left two shells holding a machine for eighteen hours, and a
		 * resumed session describing them as dead is what made the leak invisible. So the record is
		 * *probed* now, and the three answers are different:
		 *
		 * - **gone** — no process with that pid, or one this user does not own: `killed`, with the same
		 *   sentence as before, which is now something this session checked.
		 * - **live** — the pid's start time matches the one recorded at spawn, so this *is* the process the
		 *   record describes: it stays `running`, and it gets the **lease** at once (`soft = 0`), because
		 *   an orphan has already had all the soft bound it is going to get. Announced immediately, killed
		 *   in the grace unless the model grants more — the same consequence for the same inaction, now
		 *   reaching the leaks a session cannot be asked about.
		 * - **unverified** — a process has the pid but nothing proves it is this one (a reused pid, another
		 *   platform, or a record written before `pid_start` existed). Reported as such, with the pid in
		 *   the reason, and **never killed**: `killProcess` is only reached from a `running` record, so a
		 *   misevaluated pid cannot become a kill.
		 */
		restore(previous: BgHandleInfo[]): void {
			for (const record of previous) {
				if (records.has(record.id)) continue;
				const running = record.status === "running";
				const verdict = running ? probeRestored(record) : "gone";
				const restored: BgRecord = {
					...record,
					status: running ? (verdict === "live" ? "running" : verdict === "unverified" ? "unverified" : "killed") : record.status,
					reason: !running
						? record.reason
						: verdict === "live"
							? `started by an earlier session (pid ${record.pid}); its output is not readable here`
							: verdict === "unverified"
								? `a process with pid ${record.pid} is alive, and this session cannot prove it is the one this record describes`
								: "the process did not survive the session that started it",
					output: "",
					timeoutSeconds: null,
					// Nothing here ran in this process: no duration to report, no bytes watched, and no
					// lease yet — a verified orphan is armed below, an unverified one never is.
					startedMonotonic: null,
					leaseKillAtMonotonic: null,
					leaseWhy: "orphan",
					pidStart: record.pid_start ?? null,
					bytesOut: 0,
				};
				records.set(record.id, restored);
				if (verdict === "live") armLease(restored, 0, "orphan");
			}
		},

		/**
		 * Kill every running handle, and answer with the ids.
		 *
		 * The ids are for a caller that is *not* the session's end — a mode change, which kills what the
		 * mount cannot reach and then has to say what it did (readonly-guard ticket 10) — and `reason`
		 * is a parameter for the same caller: "the session ended" would be a lie there.
		 */
		async shutdownAll(reason = "the session ended"): Promise<string[]> {
			const killed: string[] = [];
			for (const record of records.values()) {
				if (record.status !== "running") continue;
				killProcess(record);
				finish(record, "killed", reason, null);
				killed.push(record.id);
			}
			return killed;
		},
	};
}
