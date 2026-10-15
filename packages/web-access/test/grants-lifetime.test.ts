import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REMOTE_OUTPUT_FENCE } from "../guard";
import { webAccessAnswer, webAccessRegistration } from "../host";
import {
	__resetGrantFloorsForTests,
	__resetGrantRecordsForTests,
	GRANT_IDLE_MS,
	SSH_GRANT_ENTRY,
	SSH_GRANT_INHERITED_ENTRY,
	ensureGrantRecord,
	installSshGrant,
	isStaleGrant,
	readGrantEntries,
	restoreGrantSession,
	sshGrantCommand,
} from "../grants";
import type { SessionInput } from "../../host-bridge/src/convention";

let counter = 0;
function newKey(): string {
	counter += 1;
	return `/tmp/ssh-grant-lifetime-${counter}-${Date.now()}.jsonl`;
}

type Confirm = (title: string, body: string, opts: { timeout: number; signal?: AbortSignal }) => Promise<boolean> | boolean;
type Append = (type: string, data?: unknown) => void;

type Ctx = {
	hasUI: boolean;
	cwd: string;
	isProjectTrusted: () => boolean;
	ui: { confirm: Confirm; notify: (text: string, kind?: string) => void };
	sessionManager: {
		getEntries: () => unknown[];
		getSessionFile: () => string | undefined;
		appendCustomEntry: Append;
	};
};

type CtxOptions = {
	hasUI?: boolean;
	trusted?: boolean;
	cwd?: string;
	confirm?: Confirm;
	notify?: (text: string, kind?: string) => void;
	entries?: unknown[];
	sessionFile?: string;
	onAppend?: Append;
};

function makeCtx(options: CtxOptions = {}): Ctx {
	const entries = options.entries ?? [];
	return {
		hasUI: options.hasUI ?? true,
		cwd: options.cwd ?? "/tmp",
		isProjectTrusted: () => options.trusted ?? false,
		ui: {
			confirm: options.confirm ?? (async () => true),
			notify: options.notify ?? (() => {}),
		},
		sessionManager: {
			getEntries: () => entries,
			getSessionFile: () => options.sessionFile,
			appendCustomEntry: options.onAppend ?? (() => {}),
		},
	};
}

/** The contributor's answer for a session, without the session-start restore (called separately). */
function ready(sessionKey: string, ctx: Ctx, options: { isChild?: boolean; apiVersion?: number } = {}) {
	const answer = webAccessAnswer({
		cwd: ctx.cwd,
		sessionKey,
		ctx,
		isChild: options.isChild ?? false,
		progress: () => {},
		handle: { apiVersion: options.apiVersion ?? 5 },
	} as unknown as SessionInput);
	const before = answer.contribution?.egress?.before;
	if (before === undefined) throw new Error("expected an egress policy");
	return { before, answer, state: ensureGrantRecord(sessionKey) };
}

const call = (command: string) => ({ name: "bash_host", args: [command] }) as never;

function refuseReason(verdict: unknown): string {
	if (verdict === null || typeof verdict !== "object" || (verdict as { allow?: unknown }).allow !== false) {
		throw new Error(`expected a refusal, got ${JSON.stringify(verdict)}`);
	}
	return String((verdict as { reason: string }).reason);
}

const granted = { allow: true as const, fence: REMOTE_OUTPUT_FENCE };

/** A `ssh-grant` (or inherited) entry in ticket 07's shape. */
function grantEntry(
	customType: string,
	grants: { key: string; route?: string; at?: number }[],
	denials: { key: string; at?: number }[] = [],
): unknown {
	return { type: "custom", customType, data: { grants, denials } };
}

function tree(): { base: string; repo: string } {
	const base = mkdtempSync(join(tmpdir(), "ssh-grant-lifetime-"));
	const repo = join(base, "repo");
	mkdirSync(join(repo, ".git"), { recursive: true });
	return { base, repo };
}
function declare(dir: string, body: unknown): void {
	mkdirSync(join(dir, ".pi"), { recursive: true });
	writeFileSync(join(dir, ".pi", "ssh-grant.json"), JSON.stringify(body));
}

beforeEach(() => {
	__resetGrantRecordsForTests();
	__resetGrantFloorsForTests();
});

describe("the persisted entry (ticket 07 §1)", () => {
	it("writes the entry on every change and round-trips through readGrantEntries", async () => {
		const key = newKey();
		const appended: { grants: unknown[]; denials: unknown[] }[] = [];
		const ctx = makeCtx();
		restoreGrantSession(ctx, () => key, (data) => appended.push(data));
		const { state } = ready(key, ctx);

		await sshGrantCommand("dev@build-box", ctx, key);
		expect(appended.length).toBe(1);
		const first = readGrantEntries([{ type: "custom", customType: SSH_GRANT_ENTRY, data: appended[0] }]).own;
		expect(first?.grants.get("dev@build-box")?.route).toBe("command");
		expect(typeof first?.grants.get("dev@build-box")?.at).toBe("number");

		// A denial is an entry too, and its `at` survives the round-trip (denials are never aged).
		state.denials.add("refused@host");
		state.deniedAt.set("refused@host", 12345);
		await sshGrantCommand("--revoke dev@build-box", ctx, key);
		const second = readGrantEntries([{ type: "custom", customType: SSH_GRANT_ENTRY, data: appended[appended.length - 1] }]).own;
		expect([...(second?.denials ?? [])]).toEqual(["refused@host"]);
		expect(second?.deniedAt?.get("refused@host")).toBe(12345);
		expect(second?.grants.has("dev@build-box")).toBe(false);
	});

	it("installs the writer through installSshGrant's own session_start and /ssh-grant", async () => {
		const key = newKey();
		const appended: { type: string; data: unknown }[] = [];
		let onSessionStart: ((event: unknown, ctx: unknown) => unknown) | undefined;
		let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
		const pi = {
			on(event: string, fn: (event: unknown, ctx: unknown) => unknown) {
				if (event === "session_start") onSessionStart = fn;
			},
			registerCommand(name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) {
				if (name === "ssh-grant") handler = options.handler;
			},
			appendEntry(type: string, data: unknown) {
				appended.push({ type, data });
			},
		};
		installSshGrant(pi, () => key);
		const ctx = makeCtx();
		onSessionStart?.({}, ctx);
		// In the real flow host-bridge's composition marks the record ready after `session_start`.
		ready(key, ctx);
		await handler?.("dev@build-box", ctx);
		expect(appended.length).toBe(1);
		expect(appended[0].type).toBe(SSH_GRANT_ENTRY);
		const restored = readGrantEntries([{ type: "custom", customType: SSH_GRANT_ENTRY, data: appended[0].data }]).own;
		expect(restored?.grants.get("dev@build-box")?.route).toBe("command");
	});

	it("stays best-effort: a failed write does not fail the call that triggered it", async () => {
		const key = newKey();
		const ctx = makeCtx();
		restoreGrantSession(ctx, () => key, () => {
			throw new Error("disk full");
		});
		const { state } = ready(key, ctx);
		await sshGrantCommand("dev@build-box", ctx, key);
		expect(state.grants.has("dev@build-box")).toBe(true);
	});
});

describe("the child's live floor (ticket 07 §5, ticket 11)", () => {
	it("refuse in the child, grant in the parent, retry succeeds, revoke propagates", async () => {
		const parentKey = newKey();
		const childKey = newKey();
		const parent = ensureGrantRecord(parentKey);
		parent.ready = true;
		webAccessRegistration.bindChild?.({ childSessionFile: childKey, parentSessionFile: parentKey });

		const child = ready(childKey, makeCtx({ hasUI: false }), { isChild: true });
		// A child has no dialog: the refusal is escalation-shaped, and it is not a human's no.
		expect(refuseReason(await child.before(call("ssh dev@build-box")))).toContain("agent_message.send");

		// A grant the parent makes *after* the refusal is visible to the child's next attempt.
		parent.grants.set("dev@build-box", { route: "command", at: Date.now() });
		expect(await child.before(call("ssh dev@build-box"))).toEqual(granted);

		// The floor is the whole truth: a removal in the parent lands in the child even when a marker
		// still names the key (a copy would have let the revoked key survive here).
		child.state.inherited = {
			grants: new Map([["dev@build-box", { route: "ask", at: Date.now() }]]),
			denials: new Set(),
		};
		parent.grants.delete("dev@build-box");
		expect(refuseReason(await child.before(call("ssh dev@build-box")))).toContain("agent_message.send");
	});

	it("writes the marker into the child's own transcript, keys, routes and denials included", () => {
		const parentKey = newKey();
		const childKey = newKey();
		const parent = ensureGrantRecord(parentKey);
		parent.ready = true;
		parent.grants.set("dev@build-box", { route: "command", at: 777 });
		parent.denials.add("refused@host");
		webAccessRegistration.bindChild?.({ childSessionFile: childKey, parentSessionFile: parentKey });

		const appended: { type: string; data?: unknown }[] = [];
		ready(childKey, makeCtx({ hasUI: false, onAppend: (type, data) => appended.push({ type, data }) }), { isChild: true });
		const marker = appended.find((entry) => entry.type === SSH_GRANT_INHERITED_ENTRY);
		expect(marker).toBeDefined();
		const restored = readGrantEntries([{ type: "custom", customType: SSH_GRANT_INHERITED_ENTRY, data: marker?.data }]).inherited;
		expect(restored?.grants.get("dev@build-box")).toEqual({ route: "command", at: 777 });
		expect([...(restored?.denials ?? [])]).toEqual(["refused@host"]);
	});
});

describe("a resumed child whose spawner is gone (ticket 07 §3)", () => {
	it("reads the marker union its own project declaration, and nothing else", async () => {
		const { repo } = tree();
		declare(repo, { grants: ["own@host"] });
		const childKey = newKey();
		const now = Date.now();
		const ctx = makeCtx({
			hasUI: false,
			cwd: repo,
			trusted: true,
			entries: [
				grantEntry(SSH_GRANT_INHERITED_ENTRY, [{ key: "parent@host", route: "ask", at: now }], [{ key: "refused@host", at: now }]),
			],
		});
		const child = ready(childKey, ctx, { isChild: true });

		expect(await child.before(call("ssh parent@host"))).toEqual(granted);
		expect(await child.before(call("ssh own@host"))).toEqual(granted);
		expect(refuseReason(await child.before(call("ssh refused@host")))).toContain("declined");
		const missing = refuseReason(await child.before(call("ssh other@host")));
		expect(missing).toContain("other@host");
		expect(missing).toContain("agent_message.send");
	});
});

describe("the idle window (ticket 07 §3)", () => {
	it("puts the boundary exactly at the window", () => {
		const now = 1_700_000_000_000;
		expect(isStaleGrant({ route: "ask", at: now - GRANT_IDLE_MS }, now)).toBe(false);
		expect(isStaleGrant({ route: "ask", at: now - GRANT_IDLE_MS - 1 }, now)).toBe(true);
		expect(isStaleGrant({ route: "command", at: now }, now)).toBe(false);
		expect(isStaleGrant({ route: "project", at: 1 }, now)).toBe(false);
		expect(isStaleGrant({ route: "ask" }, now)).toBe(false);
	});

	it("does not re-ask a grant just inside the window", async () => {
		const key = newKey();
		let asked = 0;
		const freshAt = Date.now() - GRANT_IDLE_MS + 60_000;
		const ctx = makeCtx({
			confirm: () => {
				asked += 1;
				return true;
			},
			entries: [grantEntry(SSH_GRANT_ENTRY, [{ key: "dev@build-box", route: "ask", at: freshAt }])],
		});
		restoreGrantSession(ctx, () => key);
		const { before } = ready(key, ctx);
		expect(await before(call("ssh dev@build-box"))).toEqual(granted);
		expect(asked).toBe(0);
	});

	it("re-asks a grant just past the window, notes the age, and re-stamps it on yes", async () => {
		const key = newKey();
		let asked = 0;
		let seenBody = "";
		const staleAt = Date.now() - GRANT_IDLE_MS - 60_000;
		const ctx = makeCtx({
			confirm: (_title, body) => {
				asked += 1;
				seenBody = body;
				return true;
			},
			entries: [grantEntry(SSH_GRANT_ENTRY, [{ key: "dev@build-box", route: "ask", at: staleAt }])],
		});
		restoreGrantSession(ctx, () => key);
		const { before, state } = ready(key, ctx);
		expect(await before(call("ssh dev@build-box"))).toEqual(granted);
		expect(asked).toBe(1);
		expect(seenBody).toContain("re-confirmation");
		expect(state.grants.get("dev@build-box")?.at).toBeGreaterThan(staleAt);
		// A yes re-stamps, so an actively used grant never re-asks twice.
		expect(await before(call("ssh dev@build-box"))).toEqual(granted);
		expect(asked).toBe(1);
	});

	it("refuses a stale grant where nobody can be asked, naming the age and the human", async () => {
		const key = newKey();
		const staleAt = Date.now() - GRANT_IDLE_MS - 2 * 24 * 60 * 60 * 1000;
		const ctx = makeCtx({ hasUI: false, entries: [grantEntry(SSH_GRANT_ENTRY, [{ key: "dev@build-box", route: "ask", at: staleAt }])] });
		restoreGrantSession(ctx, () => key);
		const { before } = ready(key, ctx);
		const reason = refuseReason(await before(call("ssh dev@build-box")));
		expect(reason).toMatch(/\d+ days old/);
		expect(reason).toContain("human");
		expect(reason).toContain("7-day");
	});

	it("does not age a project declaration or a denial", async () => {
		const { repo } = tree();
		declare(repo, { grants: ["declared@host"] });
		const key = newKey();
		const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
		const ctx = makeCtx({
			hasUI: false,
			cwd: repo,
			trusted: true,
			entries: [grantEntry(SSH_GRANT_ENTRY, [], [{ key: "refused@host", at: old }])],
		});
		restoreGrantSession(ctx, () => key);
		const { before } = ready(key, ctx);
		expect(await before(call("ssh declared@host"))).toEqual(granted);
		expect(refuseReason(await before(call("ssh refused@host")))).toContain("declined");
	});

	it("keeps the project file its own route even when a same-key grant is stale", async () => {
		const { repo } = tree();
		declare(repo, { grants: ["dev@build-box"] });
		const key = newKey();
		const staleAt = Date.now() - GRANT_IDLE_MS - 60_000;
		const ctx = makeCtx({
			hasUI: false,
			cwd: repo,
			trusted: true,
			entries: [grantEntry(SSH_GRANT_ENTRY, [{ key: "dev@build-box", route: "ask", at: staleAt }])],
		});
		restoreGrantSession(ctx, () => key);
		const { before } = ready(key, ctx);
		expect(await before(call("ssh dev@build-box"))).toEqual(granted);
	});
});

describe("a fork and /new (ticket 07 §4)", () => {
	it("a fork keeps what the entries carry; /new starts clean", async () => {
		const entries = [
			grantEntry(
				SSH_GRANT_ENTRY,
				[{ key: "dev@build-box", route: "ask", at: Date.now() }],
				[{ key: "refused@host", at: Date.now() }],
			),
		];
		// A fork is a new session file with the transcript copied: a different key, same entries.
		const forkKey = newKey();
		restoreGrantSession(makeCtx({ entries }), () => forkKey);
		const fork = ensureGrantRecord(forkKey);
		expect(fork.grants.get("dev@build-box")?.route).toBe("ask");
		expect(fork.denials.has("refused@host")).toBe(true);

		// /new is a fresh transcript: no entries, no grants, no denials.
		const newSessionKey = newKey();
		restoreGrantSession(makeCtx({ entries: [] }), () => newSessionKey);
		const fresh = ensureGrantRecord(newSessionKey);
		expect(fresh.grants.size).toBe(0);
		expect(fresh.denials.size).toBe(0);
	});
});
