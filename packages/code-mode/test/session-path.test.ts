/**
 * Ticket 12: the kernel's paths are built from the session file, and monty refuses a
 * relative *virtual* path — `--session-dir sessions` used to kill the kernel before the
 * first cell with `TypeError: virtual path must be absolute`.
 */
import { describe, expect, it } from "bun:test";
import { isAbsolute, join } from "node:path";
import { sessionFilePath } from "../src/kernel";

const ctx = (file: string | undefined) => ({ sessionManager: { getSessionFile: () => file } });

describe("the session file is resolved to an absolute path (ticket 12)", () => {
	it("resolves a relative session file, which is what monty's mount needs", () => {
		const file = sessionFilePath(ctx("sessions/2026-09-17T10-47-28-131Z_acc-probe.jsonl"));
		expect(file).toBe(join(process.cwd(), "sessions/2026-09-17T10-47-28-131Z_acc-probe.jsonl"));
		expect(isAbsolute(file!)).toBe(true);
		// The scratch the kernel mounts is derived from it, so it is absolute too.
		expect(isAbsolute(`${file}.scratch`)).toBe(true);
	});

	it("leaves an absolute session file alone, so existing sessions keep their paths", () => {
		expect(sessionFilePath(ctx("/tmp/t09/sessions/parent.jsonl"))).toBe("/tmp/t09/sessions/parent.jsonl");
	});

	it("is undefined when the session is not persisted, so the scratch falls back to tmp", () => {
		expect(sessionFilePath(ctx(undefined))).toBeUndefined();
		expect(sessionFilePath({})).toBeUndefined();
	});
});
