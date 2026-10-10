/** A cell's output, on its way back to the model: truncation, spilling, and the process
 * runner every host function that shells out goes through. Code mode's, wholesale
 * (ticket 03).
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_LINES = 2000;
export const MAX_BYTES = 50 * 1024;

export type RunResult = { stdout: string; stderr: string; exitCode: number | null; killed: boolean };

export function truncate(text: string, maxLines = MAX_LINES, maxBytes = MAX_BYTES) {
	const lines = text.split("\n");
	const kept: string[] = [];
	let bytes = 0;
	for (const line of lines) {
		if (kept.length >= maxLines) break;
		const size = Buffer.byteLength(line) + 1;
		if (bytes + size > maxBytes) break;
		kept.push(line);
		bytes += size;
	}
	return { text: kept.join("\n"), truncated: kept.length < lines.length, totalLines: lines.length, shownLines: kept.length };
}

export function spill(text: string, label: string): string | null {
	try {
		const path = join(mkdtempSync(join(tmpdir(), "rlm-cell-")), `${label}.txt`);
		writeFileSync(path, text);
		return path;
	} catch {
		return null;
	}
}

/**
 * How long a child's stdio pipes are allowed to stay open after it has `exit`ed.
 *
 * A shell that exits while a descendant inherited its stdout leaves `close` unfired and the pipes
 * open, which is how a *killed* call used to leave the host's promise pending after the process was
 * already gone. Pi's own runner solved this first and this is its solution, copied deliberately
 * (`$PI` `packages/coding-agent/src/utils/child-process.ts:17,39-137`): wait on `exit`, let the pipes
 * go **idle**, and re-arm the timer on every chunk that arrives after `exit` — so a descendant still
 * writing keeps us reading, and a quiet inherited handle releases us.
 */
const EXIT_STDIO_GRACE_MS = 100;

export function run(
	command: string,
	args: string[],
	options: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		timeoutSeconds?: number | null;
		/**
		 * The run's own signal (`.scratch/long-work/issues/01-the-aborts-kill.md`). When it fires, the
		 * **process group** is killed and `killed` comes back `true`: a foreground shell is
		 * *turn-owned*, and nothing of it outlives the cell. This is the only place that can decide
		 * that, because it is the only place holding a pid — which is why `abortable` stays a generic
		 * wrapper that knows nothing about processes.
		 */
		signal?: AbortSignal;
	} = {},
): Promise<RunResult> {
	return new Promise<RunResult>((resolvePromise) => {
		// A call that is already over never spawns: there is nothing to kill and nothing to report. The
		// abort gate refuses such a call before it reaches here, so this is the race's own guard.
		if (options.signal?.aborted) {
			resolvePromise({ stdout: "", stderr: "", exitCode: null, killed: true });
			return;
		}
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, {
				cwd: options.cwd,
				env: options.env ?? process.env,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			resolvePromise({ stdout: "", stderr: String(error), exitCode: null, killed: false });
			return;
		}
		let stdout = "";
		let stderr = "";
		let killed = false;
		let settled = false;
		let exited = false;
		let exitCode: number | null = null;
		let stdoutEnded = false;
		let stderrEnded = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let idleTimer: ReturnType<typeof setTimeout> | undefined;

		/** Kill the whole group, with the single-pid fallback — the same kill the bound below performs. */
		const kill = () => {
			killed = true;
			try {
				if (child.pid) process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {
				try {
					child.kill("SIGKILL");
				} catch {
					/* already gone */
				}
			}
		};
		const cleanup = () => {
			if (timer) clearTimeout(timer);
			if (idleTimer) clearTimeout(idleTimer);
			options.signal?.removeEventListener("abort", kill);
		};
		const finish = (code: number | null, error: string | null) => {
			if (settled) return;
			settled = true;
			cleanup();
			// Out of the way, so a descendant still holding the pipe cannot keep this promise — or the
			// host's event loop — alive after the result has been decided.
			child.stdout?.destroy();
			child.stderr?.destroy();
			resolvePromise({ stdout, stderr: error ? `${stderr}\n${error}` : stderr, exitCode: code, killed });
		};
		const armIdle = () => {
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = setTimeout(() => finish(exitCode, null), EXIT_STDIO_GRACE_MS);
		};
		const doneIfQuiet = () => {
			if (exited && stdoutEnded && stderrEnded) finish(exitCode, null);
		};
		const collect = (which: "out" | "err") => (chunk: Buffer) => {
			if (which === "out") {
				if (stdout.length < 8 * MAX_BYTES) stdout += chunk.toString();
			} else if (stderr.length < 8 * MAX_BYTES) {
				stderr += chunk.toString();
			}
			// Output still arriving after `exit` means a descendant is writing: keep reading, so the
			// timer measures idleness rather than a deadline measured from the exit (pi#5303).
			if (exited && !settled) armIdle();
		};

		child.stdout?.on("data", collect("out"));
		child.stderr?.on("data", collect("err"));
		child.stdout?.on("end", () => {
			stdoutEnded = true;
			doneIfQuiet();
		});
		child.stderr?.on("end", () => {
			stderrEnded = true;
			doneIfQuiet();
		});
		child.on("error", (error: Error) => finish(null, String(error?.message ?? error)));
		child.on("exit", (code: number | null) => {
			exited = true;
			exitCode = code;
			doneIfQuiet();
			if (!settled) armIdle();
		});
		// `close` still settles everything the ordinary way; it is the *inherited* handle that no longer
		// holds the promise hostage.
		child.on("close", (code: number | null) => finish(code ?? exitCode, null));

		if (options.timeoutSeconds != null) timer = setTimeout(kill, options.timeoutSeconds * 1000);
		if (options.signal) {
			if (options.signal.aborted) kill();
			else options.signal.addEventListener("abort", kill, { once: true });
		}
	});
}
