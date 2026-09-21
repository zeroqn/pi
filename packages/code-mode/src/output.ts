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

export function run(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutSeconds?: number | null } = {},
): Promise<RunResult> {
	return new Promise<RunResult>((resolvePromise) => {
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
		child.stdout?.on("data", (chunk: Buffer) => {
			if (stdout.length < 8 * MAX_BYTES) stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			if (stderr.length < 8 * MAX_BYTES) stderr += chunk.toString();
		});
		const timer =
			options.timeoutSeconds != null
				? setTimeout(() => {
						killed = true;
						try {
							if (child.pid) process.kill(-child.pid, "SIGKILL");
						} catch {
							child.kill("SIGKILL");
						}
					}, options.timeoutSeconds * 1000)
				: undefined;
		const finish = (code: number | null, error: string | null) => {
			if (timer) clearTimeout(timer);
			resolvePromise({ stdout, stderr: error ? `${stderr}\n${error}` : stderr, exitCode: code, killed });
		};
		child.on("error", (error: Error) => finish(null, String(error?.message ?? error)));
		child.on("close", (code: number | null) => finish(code, null));
	});
}
