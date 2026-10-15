import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REMOTE_OUTPUT_FENCE } from "../guard";
import { webAccessAnswer } from "../host";
import {
	__resetGrantRecordsForTests,
	ensureGrantRecord,
	findProjectFile,
	grantRecord,
	heldKeys,
	readGrantEntries,
	redirectsOrTees,
	restoreGrantSession,
	sshGrantCommand,
} from "../grants";
import type { SessionInput } from "../../host-bridge/src/convention";

let counter = 0;
function newKey(): string {
	counter += 1;
	return `ssh-grant-test-${counter}`;
}

type Confirm = (title: string, body: string, opts: { timeout: number; signal?: AbortSignal }) => Promise<boolean> | boolean;

type Ctx = {
	hasUI: boolean;
	cwd: string;
	signal?: AbortSignal;
	isProjectTrusted: () => boolean;
	ui: { confirm: Confirm; notify: (text: string, kind?: string) => void };
};

function makeCtx(options: { hasUI?: boolean; trusted?: boolean; cwd?: string; confirm?: Confirm; notify?: (text: string, kind?: string) => void } = {}): Ctx {
	return {
		hasUI: options.hasUI ?? true,
		cwd: options.cwd ?? "/tmp",
		isProjectTrusted: () => options.trusted ?? false,
		ui: {
			confirm: options.confirm ?? (async () => true),
			notify: options.notify ?? (() => {}),
		},
	};
}

/**
 * One session's policy, asked the way the real sequence asks it: the session-start restore first
 * (entries + the project file), then the contributor's answer.
 */
function policyFor(sessionKey: string, ctx: Ctx, apiVersion = 5) {
	restoreGrantSession(ctx, () => sessionKey);
	const answer = webAccessAnswer({
		cwd: ctx.cwd,
		sessionKey,
		ctx,
		isChild: false,
		progress: () => {},
		handle: { apiVersion },
	} as unknown as SessionInput);
	const before = answer.contribution?.egress?.before;
	if (before === undefined) throw new Error("expected an egress policy");
	return { before, answer, state: ensureGrantRecord(sessionKey) };
}

const call = (command: string, background = false) => ({ name: "bash_host", args: background ? [command, { background: true }] : [command] }) as never;

function refuseReason(verdict: unknown): string {
	if (verdict === null || typeof verdict !== "object" || (verdict as { allow?: unknown }).allow !== false) {
		throw new Error(`expected a refusal, got ${JSON.stringify(verdict)}`);
	}
	return String((verdict as { reason: string }).reason);
}

beforeEach(() => {
	__resetGrantRecordsForTests();
});

describe("the grant-aware policy (ticket 06 §1, §4)", () => {
	it("allows a granted foreground call, and answers the fenced allowance", async () => {
		const key = newKey();
		const { before, state } = policyFor(key, makeCtx());
		state.grants.set("dev@build-box", { route: "command", at: Date.now() });
		expect(await before(call("ssh dev@build-box uptime"))).toEqual({ allow: true, fence: REMOTE_OUTPUT_FENCE });
		// The whole key set must be held, not the first key: a -J hop is a second destination.
		state.grants.set("ops@bastion", { route: "command", at: Date.now() });
		expect(await before(call("ssh -J ops@bastion dev@build-box"))).toEqual({ allow: true, fence: REMOTE_OUTPUT_FENCE });
	});

	it("refuses an ungranted key where no dialog can appear, naming the key, never the fetch sentence", async () => {
		const key = newKey();
		const { before } = policyFor(key, makeCtx({ hasUI: false }));
		const reason = refuseReason(await before(call("ssh dev@build-box")));
		expect(reason).toContain("dev@build-box");
		expect(reason).toContain("nobody can be asked");
		expect(reason).not.toContain("fetch_content");
	});

	it("still refuses a second target while the first is granted", async () => {
		const key = newKey();
		// A dialog exists; the human answers no to the second target, so the first grant did not widen.
		const { before, state } = policyFor(key, makeCtx({ confirm: () => false }));
		state.grants.set("dev@build-box", { route: "ask", at: Date.now() });
		expect(await before(call("ssh dev@build-box"))).toEqual({ allow: true, fence: REMOTE_OUTPUT_FENCE });
		expect(refuseReason(await before(call("ssh dev@other-box")))).toContain("dev@other-box");
	});

	it("allows a transport invocation that reaches nobody, with no grant and no dialog", async () => {
		const key = newKey();
		let asked = 0;
		const ctx = makeCtx({ confirm: () => { asked += 1; return true; } });
		const { before } = policyFor(key, ctx);
		expect(await before(call("ssh -V"))).toBeUndefined();
		expect(await before(call("ssh -Q cipher"))).toBeUndefined();
		// The deliberate loosening ticket 03's amendment records: the -e makes it "remote" to
		// checkEgress, but the command names no host, so its key set is empty and no grant is needed.
		expect(await before(call("rsync -e ssh local1 local2"))).toBeUndefined();
		expect(asked).toBe(0);
	});

	it("keeps checkEgress's refusals for everything outside the transport family", async () => {
		const key = newKey();
		const { before } = policyFor(key, makeCtx());
		expect(refuseReason(await before(call("curl -s https://example.com")))).toContain("fetch_content");
		// A command that mixes a granted transport with a fetch is still refused for the fetch.
		const { before: before2, state } = policyFor(newKey(), makeCtx());
		state.grants.set("dev@build-box", { route: "command", at: Date.now() });
		expect(refuseReason(await before2(call("ssh dev@build-box && curl https://example.com")))).toContain("fetch_content");
	});
});

describe("the routes the fence cannot reach (ticket 04 §4)", () => {
	it("refuses a granted call in the background arm", async () => {
		const key = newKey();
		const { before, state } = policyFor(key, makeCtx());
		state.grants.set("dev@build-box", { route: "command", at: Date.now() });
		const reason = refuseReason(await before(call("ssh dev@build-box", true)));
		expect(reason).toContain("background=True");
		expect(reason).toContain("foreground");
	});

	it("refuses a granted call that redirects or tees its output", async () => {
		const key = newKey();
		const { before, state } = policyFor(key, makeCtx());
		state.grants.set("dev@build-box", { route: "command", at: Date.now() });
		expect(refuseReason(await before(call("ssh dev@build-box > /tmp/out")))).toContain("redirected or teed");
		expect(refuseReason(await before(call("ssh dev@build-box | tee /tmp/out")))).toContain("redirected or teed");
		// A stderr duplication still returns the output to the cell: not a file redirect.
		expect(await before(call("ssh dev@build-box 2>&1"))).toEqual({ allow: true, fence: REMOTE_OUTPUT_FENCE });
		// A quoted `>` is the remote shell's, not ours.
		expect(await before(call("ssh dev@build-box 'echo hi > /tmp/x'"))).toEqual({ allow: true, fence: REMOTE_OUTPUT_FENCE });
	});

	it("unit-tests the redirect detector", () => {
		expect(redirectsOrTees("ssh a > f")).toBe(true);
		expect(redirectsOrTees("ssh a >> f")).toBe(true);
		expect(redirectsOrTees("ssh a 2> f")).toBe(true);
		expect(redirectsOrTees("ssh a | tee f")).toBe(true);
		expect(redirectsOrTees("ssh a 2>&1")).toBe(false);
		expect(redirectsOrTees("ssh a 'echo > f'")).toBe(false);
	});
});

describe("the ask and the remembered denial (ticket 06 §3-§5)", () => {
	it("asks with the literal command and every key, and a yes records the grant", async () => {
		const key = newKey();
		let asked = 0;
		let seenBody = "";
		let seenOpts: { timeout: number; signal?: AbortSignal } | undefined;
		const ctx = makeCtx({
			confirm: (title, body, opts) => {
				asked += 1;
				seenBody = body;
				seenOpts = opts;
				expect(title).toContain("dev@build-box");
				return true;
			},
		});
		const { before, state } = policyFor(key, ctx);
		expect(await before(call("ssh -J ops@bastion dev@build-box"))).toEqual({ allow: true, fence: REMOTE_OUTPUT_FENCE });
		expect(asked).toBe(1);
		expect(seenBody).toContain("ssh -J ops@bastion dev@build-box");
		expect(seenBody).toContain("ops@bastion");
		// Milliseconds, not seconds (ticket 05's trap).
		expect(seenOpts?.timeout).toBe(60_000);
		expect(state.grants.get("dev@build-box")?.route).toBe("ask");
		expect(state.grants.get("ops@bastion")?.route).toBe("ask");
		// A second identical call in the same session is not re-asked (ticket 05 finding).
		expect(await before(call("ssh -J ops@bastion dev@build-box"))).toEqual({ allow: true, fence: REMOTE_OUTPUT_FENCE });
		expect(asked).toBe(1);
	});

	it("remembers a denial and does not ask again", async () => {
		const key = newKey();
		let asked = 0;
		const ctx = makeCtx({ confirm: () => { asked += 1; return false; } });
		const { before, state } = policyFor(key, ctx);
		const first = refuseReason(await before(call("ssh dev@build-box")));
		expect(asked).toBe(1);
		expect(first).toContain("declined");
		expect(state.denials.has("dev@build-box")).toBe(true);
		const second = refuseReason(await before(call("ssh dev@build-box")));
		expect(asked).toBe(1);
		expect(second).toContain("declined");
	});

	it("treats an unanswered dialog as a refusal", async () => {
		const key = newKey();
		const ctx = makeCtx({ confirm: async () => { throw new Error("dialog aborted"); } });
		const { before, state } = policyFor(key, ctx);
		expect(refuseReason(await before(call("ssh dev@build-box")))).toContain("declined");
		expect(state.grants.has("dev@build-box")).toBe(false);
	});

	it("gives a spawned child the escalation-shaped refusal instead of asking", async () => {
		const key = newKey();
		let asked = 0;
		const ctx = makeCtx({ confirm: () => { asked += 1; return true; } });
		const answer = webAccessAnswer({
			cwd: "/tmp",
			sessionKey: key,
			ctx,
			isChild: true,
			progress: () => {},
			handle: { apiVersion: 5 },
		} as unknown as SessionInput);
		const before = answer.contribution?.egress?.before;
		if (before === undefined) throw new Error("expected an egress policy");
		const reason = refuseReason(await before(call("ssh dev@build-box")));
		expect(asked).toBe(0);
		expect(reason).toContain("agent_message.send");
		expect(reason).toContain("parent");
	});

	it("never asks where no dialog can appear, and never calls the stub", async () => {
		const key = newKey();
		let called = 0;
		const ctx = makeCtx({ hasUI: false, confirm: () => { called += 1; return true; } });
		const { before } = policyFor(key, ctx);
		const reason = refuseReason(await before(call("ssh dev@build-box")));
		expect(called).toBe(0);
		expect(reason).toContain("nobody can be asked");
		expect(reason).toContain("not trusted");
	});
});

describe("the project declaration (ticket 06 §2)", () => {
	function tree(): { base: string; repo: string; sub: string } {
		const base = mkdtempSync(join(tmpdir(), "ssh-grant-project-"));
		const repo = join(base, "repo");
		const sub = join(repo, "sub");
		mkdirSync(join(repo, ".git"), { recursive: true });
		mkdirSync(sub, { recursive: true });
		return { base, repo, sub };
	}
	function declare(dir: string, body: unknown): string {
		mkdirSync(join(dir, ".pi"), { recursive: true });
		const file = join(dir, ".pi", "ssh-grant.json");
		writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
		return file;
	}

	it("walks up to the nearest file and stops at the VCS root", () => {
		const { base, repo, sub } = tree();
		expect(findProjectFile(sub)).toBeNull();
		// A declaration above the VCS root is a host declaration wearing a project's name: never read.
		declare(base, { grants: ["host@parent"] });
		expect(findProjectFile(sub)).toBeNull();
		// The repo's own declaration applies from below it...
		const repoFile = declare(repo, { grants: ["dev@build-box"] });
		expect(findProjectFile(sub)).toBe(repoFile);
		// ...and a nested declaration is the nearest, so it wins.
		const subFile = declare(sub, { grants: ["root@nested"] });
		expect(findProjectFile(sub)).toBe(subFile);
	});

	it("reads a trusted project's declaration and ignores an untrusted one", () => {
		const { repo, sub } = tree();
		declare(repo, { grants: ["dev@build-box"] });
		const trusted = restoreGrantSession(makeCtx({ cwd: sub, trusted: true }), () => newKey());
		expect(trusted.project?.keys).toEqual(["dev@build-box"]);
		expect(trusted.projectTrusted).toBe(true);
		const untrusted = restoreGrantSession(makeCtx({ cwd: sub, trusted: false }), () => newKey());
		expect(untrusted.project).toBeNull();
		expect(untrusted.projectTrusted).toBe(false);
	});

	it("reports an unknown field loudly", () => {
		const { repo } = tree();
		const notices: string[] = [];
		declare(repo, { grants: ["dev@build-box"], extra: true });
		const state = restoreGrantSession(makeCtx({ cwd: repo, trusted: true, notify: (text) => notices.push(text) }), () => newKey());
		expect(state.project?.keys).toEqual(["dev@build-box"]);
		expect(notices.join("\n")).toContain('unknown field "extra"');
	});

	it("is authoritative where nobody can be asked, and still asks where a dialog can appear", async () => {
		const { repo } = tree();
		declare(repo, { grants: ["dev@build-box"] });
		// No UI: the declaration is the route; the call runs, fenced.
		const noUiKey = newKey();
		const noUi = policyFor(noUiKey, makeCtx({ hasUI: false, cwd: repo, trusted: true }));
		expect(await noUi.before(call("ssh dev@build-box"))).toEqual({ allow: true, fence: REMOTE_OUTPUT_FENCE });
		// A dialog exists: the first use still asks, and a yes records the grant.
		const uiKey = newKey();
		let asked = 0;
		const ui = policyFor(uiKey, makeCtx({ cwd: repo, trusted: true, confirm: (title, body) => { asked += 1; expect(body).toContain("Declared in .pi/ssh-grant.json"); return true; } }));
		expect(await ui.before(call("ssh dev@build-box"))).toEqual({ allow: true, fence: REMOTE_OUTPUT_FENCE });
		expect(asked).toBe(1);
	});

	it("says why nobody can be asked for an untrusted project", async () => {
		const { repo } = tree();
		declare(repo, { grants: ["dev@build-box"] });
		const key = newKey();
		const { before } = policyFor(key, makeCtx({ hasUI: false, cwd: repo, trusted: false }));
		const reason = refuseReason(await before(call("ssh dev@build-box")));
		expect(reason).toContain("not trusted");
	});

	it("records the entries ticket 07 writes, newest of each kind winning", () => {
		const newer = { grants: [{ key: "dev@build-box", route: "command", at: 2 }], denials: [{ key: "old@host", at: 1 }] };
		const older = { grants: [{ key: "stale@host", route: "ask", at: 1 }] };
		const inherited = { grants: [{ key: "parent@host", route: "ask", at: 3 }] };
		const restored = readGrantEntries([
			{ type: "custom", customType: "ssh-grant", data: older },
			{ type: "message" },
			{ type: "custom", customType: "ssh-grant", data: newer },
			{ type: "custom", customType: "ssh-grant-inherited", data: inherited },
		]);
		expect([...(restored.own?.grants.keys() ?? [])]).toEqual(["dev@build-box"]);
		expect([...(restored.own?.denials ?? [])]).toEqual(["old@host"]);
		expect([...(restored.inherited?.grants.keys() ?? [])]).toEqual(["parent@host"]);
	});
});

describe("/ssh-grant (ticket 06 §3)", () => {
	function ready(key: string, ctx: Ctx) {
		return policyFor(key, ctx).state;
	}

	it("grants for the session", async () => {
		const key = newKey();
		const notices: string[] = [];
		const state = ready(key, makeCtx());
		await sshGrantCommand("dev@build-box", makeCtx({ notify: (text) => notices.push(text) }), key);
		expect(state.grants.get("dev@build-box")?.route).toBe("command");
		expect(notices.join(" ")).toContain("granted dev@build-box");
	});

	it("lists each key with its route and whether a denial is remembered", async () => {
		const key = newKey();
		const state = ready(key, makeCtx());
		state.grants.set("dev@build-box", { route: "ask", at: Date.now() });
		state.denials.add("dev@other-box");
		state.project = { path: "/repo/.pi/ssh-grant.json", keys: ["declared@host"], };
		const notices: string[] = [];
		await sshGrantCommand("", makeCtx({ notify: (text) => notices.push(text) }), key);
		const text = notices.join("\n");
		expect(text).toContain("dev@build-box — route ask");
		expect(text).toContain("declared@host — route project");
		expect(text).toContain("dev@other-box — denied this session");
	});

	it("revokes a grant and clears a denial, without editing a project file", async () => {
		const key = newKey();
		const state = ready(key, makeCtx());
		state.grants.set("dev@build-box", { route: "command", at: Date.now() });
		state.denials.add("dev@other-box");
		state.project = { path: "/repo/.pi/ssh-grant.json", keys: ["declared@host"] };
		await sshGrantCommand("--revoke dev@build-box", makeCtx(), key);
		await sshGrantCommand("--revoke dev@other-box", makeCtx(), key);
		expect(state.grants.has("dev@build-box")).toBe(false);
		expect(state.denials.has("dev@other-box")).toBe(false);
		expect(state.project?.keys).toEqual(["declared@host"]);
	});

	it("overrides a declared key with a denial, so the revoke survives a resume", async () => {
		// A declaration is not a grant, so `--revoke` has nothing to delete for it. The session-level
		// override is a **denial**: it keeps the key out of `heldKeys` (the no-dialog path included),
		// and it is what the entry persists — filtering `project.keys` in memory instead would lose the
		// revoke at the next session start, when the file is read again.
		const key = newKey();
		const state = ready(key, makeCtx({ hasUI: false, trusted: true }));
		state.project = { path: "/repo/.pi/ssh-grant.json", keys: ["declared@host"] };
		expect(heldKeys(state, false).has("declared@host")).toBe(true);
		await sshGrantCommand("--revoke declared@host", makeCtx(), key);
		expect(state.denials.has("declared@host")).toBe(true);
		expect(heldKeys(state, false).has("declared@host")).toBe(false);
		expect(state.project?.keys).toEqual(["declared@host"]);
	});

	it("says so in a session whose policy cannot hold state", async () => {
		const key = newKey();
		policyFor(key, makeCtx(), 4);
		const notices: string[] = [];
		await sshGrantCommand("dev@build-box", makeCtx({ notify: (text, kind) => notices.push(`${kind ?? "info"}: ${text}`) }), key);
		expect(notices.join("\n")).toContain("cannot hold a grant");
		expect(grantRecord(key)?.grants.size).toBe(0);
	});
});
