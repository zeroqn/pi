/**
 * Ticket 13: a CLI `--fork <path>` reports `session_start {reason: "startup"}` and no
 * `previousSessionFile`, recording the source only in the new session's header — so a fork
 * used to replay against an empty scratch.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forkSourceFile, headerParentSession, journalSourceOf } from "../src/children";

describe("a fork's source is read from the event and the header (ticket 13)", () => {
	it("takes the event's source for an interactive /fork", () => {
		expect(
			forkSourceFile({
				startReason: "fork",
				previousSessionFile: "/tmp/s/parent.jsonl",
				parentSessionFile: "/tmp/s/parent.jsonl",
				isChild: false,
			}),
		).toBe("/tmp/s/parent.jsonl");
	});

	it("takes the header's source for a CLI --fork, which reports startup", () => {
		expect(
			forkSourceFile({
				startReason: "startup",
				previousSessionFile: undefined,
				parentSessionFile: "/tmp/s/parent.jsonl",
				isChild: false,
			}),
		).toBe("/tmp/s/parent.jsonl");
	});

	it("is not a fork when neither signal is present", () => {
		expect(forkSourceFile({ startReason: "startup", isChild: false })).toBeUndefined();
		expect(forkSourceFile({ startReason: "resume", previousSessionFile: "/tmp/s/other.jsonl", isChild: false })).toBeUndefined();
	});

	it("never treats a child's parent as a fork, whatever the event says", () => {
		// A child's header names its parent, and its scratch is its own (ticket 03).
		expect(forkSourceFile({ startReason: "startup", parentSessionFile: "/tmp/s/parent.jsonl", isChild: true })).toBeUndefined();
		expect(forkSourceFile({ startReason: "resume", parentSessionFile: "/tmp/s/parent.jsonl", isChild: true })).toBeUndefined();
	});

	it("reads the header's parentSession, resolved, and nothing when there is none", () => {
		const dir = mkdtempSync(join(tmpdir(), "rlm-fork-"));
		try {
			const manager = (parent?: string) => ({ getHeader: () => ({ type: "session", parentSession: parent }) }) as any;
			expect(headerParentSession(manager("sessions/parent.jsonl"))).toBe(join(process.cwd(), "sessions/parent.jsonl"));
			expect(headerParentSession(manager("/tmp/s/parent.jsonl"))).toBe("/tmp/s/parent.jsonl");
			expect(headerParentSession(manager())).toBeUndefined();
			// A session manager that cannot answer must not throw a session.
			expect(headerParentSession({})).toBeUndefined();
			expect(headerParentSession(null)).toBeUndefined();
			// The header on disk is what the CLI fork wrote, and it is read the same way.
			const file = join(dir, "fork.jsonl");
			writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir, parentSession: "/tmp/s/parent.jsonl" })}\n`);
			expect(headerParentSession({ getHeader: () => JSON.parse(readFileSync(file, "utf8").split("\n", 1)[0]!) })).toBe("/tmp/s/parent.jsonl");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("which journal a kernel replays, and whether a scratch comes with it", () => {
	const base = { startReason: "startup", isChild: false } as const;

	it("uses a session's own journal whenever it has one, with no scratch copy", () => {
		// A fork replays the source's once; after its first cell its own journal is the whole
		// story for cells it wrote itself.
		expect(
			journalSourceOf({
				...base,
				ownSessionFile: "/tmp/s/fork.jsonl",
				ownFirstIndex: 0,
				parentSessionFile: "/tmp/s/parent.jsonl",
			}),
		).toEqual({ files: ["/tmp/s/fork.jsonl"] });
	});

	it("replays the parent's prefix under a fork's own fragment", () => {
		// A fork's own journal is indexed against the history it inherited: one cell of its
		// own is a record at index 2, and everything it inherited must be replayed too
		// (ticket 14), or the fork resumes without the values it started with.
		expect(
			journalSourceOf({
				...base,
				ownSessionFile: "/tmp/s/fork.jsonl",
				ownFirstIndex: 2,
				parentSessionFile: "/tmp/s/parent.jsonl",
			}),
		).toEqual({ files: ["/tmp/s/parent.jsonl", "/tmp/s/fork.jsonl"] });
	});

	it("seeds a fresh CLI fork from the header's source, and copies its scratch", () => {
		expect(
			journalSourceOf({
				...base,
				ownSessionFile: "/tmp/s/fork.jsonl",
				parentSessionFile: "/tmp/s/parent.jsonl",
			}),
		).toEqual({ files: ["/tmp/s/parent.jsonl"], seedFrom: "/tmp/s/parent.jsonl" });
	});

	it("never seeds a child from its parent's journal or scratch", () => {
		expect(
			journalSourceOf({
				...base,
				ownSessionFile: "/tmp/s/child.jsonl",
				parentSessionFile: "/tmp/s/parent.jsonl",
				isChild: true,
			}),
		).toEqual({ files: ["/tmp/s/child.jsonl"] });
	});

	it("takes the event's source for an interactive /fork", () => {
		expect(
			journalSourceOf({
				...base,
				startReason: "fork",
				previousSessionFile: "/tmp/s/parent.jsonl",
				ownSessionFile: "/tmp/s/fork.jsonl",
			}),
		).toEqual({ files: ["/tmp/s/parent.jsonl"], seedFrom: "/tmp/s/parent.jsonl" });
	});

	it("has nothing to replay for a plain session with no journal and no fork", () => {
		expect(journalSourceOf({ ...base, ownSessionFile: "/tmp/s/plain.jsonl" })).toEqual({ files: ["/tmp/s/plain.jsonl"] });
		expect(journalSourceOf({ ...base })).toBeUndefined();
	});
});
