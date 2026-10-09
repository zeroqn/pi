/**
 * Ticket 12: the kernel's paths are built from the session file, and monty refuses a
 * relative *virtual* path — `--session-dir sessions` used to kill the kernel before the
 * first cell with `TypeError: virtual path must be absolute`.
 */
import { describe, expect, it } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { scratchPathFor, sessionFilePath } from "../src/kernel";

const ctx = (file: string | undefined) => ({ sessionManager: { getSessionFile: () => file } });

/**
 * Put TMPDIR back the way it was found. `process.env.TMPDIR = undefined` does not unset it: Node and
 * Bun both coerce, and the variable ends up holding the *string* "undefined", which `os.tmpdir()`
 * then answers verbatim — a relative path, so every later `mkdtempSync(join(tmpdir(), …))` in the
 * process dies with `ENOENT: mkdtemp 'undefined/…'`. That is what this file did on CI, where TMPDIR
 * is simply absent, and it took `host.test.ts` down with it (see the note on the case below). A dev
 * box has TMPDIR set and never saw it.
 */
function restoreTmp(saved: string | undefined): void {
	if (saved === undefined) delete process.env.TMPDIR;
	else process.env.TMPDIR = saved;
}

describe("the session file is resolved to an absolute path (ticket 12)", () => {
	it("resolves a relative session file, which is what monty's mount needs", () => {
		const file = sessionFilePath(ctx("sessions/2026-09-17T10-47-28-131Z_acc-probe.jsonl"));
		expect(file).toBe(join(process.cwd(), "sessions/2026-09-17T10-47-28-131Z_acc-probe.jsonl"));
		expect(isAbsolute(file!)).toBe(true);
		// The scratch the kernel mounts is derived from it, so it is absolute too.
		expect(isAbsolute(scratchPathFor(file!, process.cwd()))).toBe(true);
	});

	it("leaves an absolute session file alone, so existing sessions keep their paths", () => {
		expect(sessionFilePath(ctx("/tmp/t09/sessions/parent.jsonl"))).toBe("/tmp/t09/sessions/parent.jsonl");
	});

	it("is undefined when the session is not persisted, so the scratch falls back to tmp", () => {
		expect(sessionFilePath(ctx(undefined))).toBeUndefined();
		expect(sessionFilePath({})).toBeUndefined();
	});

	it("does not let a repo-local TMPDIR put the escape hatch back inside the workspace", () => {
		// The fallback's own home is the temp dir, and a temp dir is not necessarily outside the
		// workspace: a repo-local TMPDIR (direnv, a container, a build shell) makes both mounts nest
		// and monty then refuses to start the kernel at all. Measured against the real thing —
		// `TMPDIR=<root>/.tmp` + a session file in `<root>` used to fail with "it overlaps the mount
		// of <root>".
		const root = join(tmpdir(), "t12-ws");
		const inside = join(root, "sessions", "in.jsonl");
		const savedTmp = process.env.TMPDIR;
		try {
			process.env.TMPDIR = join(root, ".tmp");
			const scratch = scratchPathFor(inside, root);
			expect(scratch.startsWith(`${root}/`)).toBe(false);
			// Home is the second base, and it is the one that answered here.
			expect(scratch).toBe(join(homedir(), ".cache", "pi-code-mode-scratch", scratch.split("/").pop()!));
		} finally {
			restoreTmp(savedTmp);
		}
	});

	it("says so when neither the temp dir nor home is outside the workspace", () => {
		// Nothing left to try: monty's own message ("overlapping mounts cannot both be registered")
		// does not name the cause, so this one does — TMPDIR is the caller's to move. The workspace
		// *is* home here, which puts both bases inside it (Bun's `homedir()` ignores a changed
		// `HOME`, so the root moves rather than the env).
		const root = homedir();
		const inside = join(root, "sessions", "in.jsonl");
		const savedTmp = process.env.TMPDIR;
		try {
			process.env.TMPDIR = join(root, ".tmp");
			expect(() => scratchPathFor(inside, root)).toThrow(/TMPDIR/);
		} finally {
			restoreTmp(savedTmp);
		}
	});

	it("moves the scratch out of the workspace, which monty will not mount inside it", () => {
		// A session file inside the workspace: the sibling path would nest with the workspace
		// mount, which monty 1.0 refuses, so the scratch goes to the temp dir instead.
		const inside = join(process.cwd(), "sessions", "in.jsonl");
		expect(scratchPathFor(inside, process.cwd())).not.toBe(`${inside}.scratch`);
		expect(isAbsolute(scratchPathFor(inside, process.cwd()))).toBe(true);
		// Outside it — the ordinary layout — nothing moves.
		expect(scratchPathFor("/tmp/t12/out.jsonl", process.cwd())).toBe("/tmp/t12/out.jsonl.scratch");
		// A sibling that merely shares a prefix is not inside the workspace.
		expect(scratchPathFor(`${process.cwd()}x/out.jsonl`, process.cwd())).toBe(`${process.cwd()}x/out.jsonl.scratch`);
	});
});
