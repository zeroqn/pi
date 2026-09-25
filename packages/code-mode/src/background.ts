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
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
}

interface BgRecord extends BgHandleInfo {
	child?: ReturnType<typeof spawn>;
	output: string;
	timeoutSeconds: number | null;
	timer?: ReturnType<typeof setTimeout>;
}

const MAX_MEMORY_OUTPUT = 64 * 1024;

export interface BackgroundManagerDeps {
	cwd: () => string;
	/** Directory for the output logs; the session must stay readable after resume. */
	logDir: () => string;
	onFinish: (record: BgHandleInfo) => void;
	onRecord?: (record: BgHandleInfo) => void;
	cap: number;
}

export function createBackgroundManager(deps: BackgroundManagerDeps) {
	const records = new Map<string, BgRecord>();
	let counter = 0;

	function info(record: BgRecord): BgHandleInfo {
		const { child: _child, output: _output, timeoutSeconds: _timeout, timer: _timer, ...rest } = record;
		return { ...rest };
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
		if (record.timer) clearTimeout(record.timer);
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

	function start(command: string, timeoutSeconds: number | null): BgHandleInfo {
		const running = [...records.values()].filter((record) => record.status === "running");
		if (running.length >= deps.cap) {
			throw new Error(`${running.length} background commands are already running; the limit is ${deps.cap}. Use bg_list() and kill one first.`);
		}
		const id = `bg-${++counter}`;
		const child = spawn(process.env.RLM_SHELL ?? process.env.SHELL ?? "/bin/bash", ["-lc", command], {
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
		};
		const append = (chunk: Buffer) => {
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

		if (timeoutSeconds !== null && timeoutSeconds > 0) {
			record.timer = setTimeout(() => {
				if (record.status !== "running") return;
				record.reason = `timed out after ${timeoutSeconds}s`;
				killProcess(record);
				finish(record, "timeout", record.reason, null);
			}, timeoutSeconds * 1000);
			record.timer.unref?.();
		}

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
