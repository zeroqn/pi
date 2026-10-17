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

export type BgStatus = "running" | "done" | "failed" | "killed" | "timeout";

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
}

interface BgRecord extends Omit<BgHandleInfo, "age_ms" | "timeout_s" | "lease_s" | "bytes_out"> {
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
	/** `null` for a restored record: the process it describes did not run here. */
	startedMonotonic: number | null;
	bytesOut: number;
}

const MAX_MEMORY_OUTPUT = 64 * 1024;

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
	onLease?: (record: BgHandleInfo, graceSeconds: number) => void;
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
	function armLease(record: BgRecord, seconds: number): void {
		record.softTimer = setTimeout(() => {
			if (record.status !== "running") return;
			record.leaseKillAtMonotonic = performance.now() + leaseGraceSeconds * 1000;
			deps.onLease?.(info(record), leaseGraceSeconds);
			record.leaseTimer = setTimeout(() => {
				if (record.status !== "running") return;
				record.reason = `unattended: no bound was declared and none was granted within ${leaseGraceSeconds}s of the ${seconds}s soft bound`;
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

		/** Read-only restoration for a resumed session: nothing is re-executed. */
		restore(previous: BgHandleInfo[]): void {
			for (const record of previous) {
				if (records.has(record.id)) continue;
				records.set(record.id, {
					...record,
					status: record.status === "running" ? "killed" : record.status,
					reason: record.status === "running" ? "the process did not survive the session that started it" : record.reason,
					output: "",
					timeoutSeconds: null,
					// Nothing here ran in this process: no duration to report, no bytes watched, and no
					// lease to serve — whatever is still on the host is not this process's to kill.
					startedMonotonic: null,
					leaseKillAtMonotonic: null,
					bytesOut: 0,
				});
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
