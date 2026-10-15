import { beforeEach, describe, expect, it } from "bun:test";

import { REMOTE_OUTPUT_FENCE } from "../guard";
import { ensureGrantRecord, __resetGrantRecordsForTests, __resetGrantFloorsForTests } from "../grants";
import { backgroundsItself } from "../command-rules";
import { decide, toEgressVerdict, type CallVerdict } from "../policy";

/**
 * Ticket 02's unit, tested where it is seam-neutral (`.scratch/guardrail-blindspots` tickets 02 and 03).
 *
 * The kernel adapter's own suite (`test/grants.test.ts`, `test/host.test.ts`) is what proves the extraction
 * changed no behaviour: it is unchanged apart from one registration assertion, and it passes. These tests
 * are about the *new* surface — the union, its translations, and the rules that exist only because the tool
 * seam has no kernel to lean on.
 */

let counter = 0;
function newKey(): string {
	counter += 1;
	return `blindspots-policy-${counter}`;
}

type Confirm = (title: string, body: string, opts: { timeout: number; signal?: AbortSignal }) => Promise<boolean> | boolean;

type Ctx = {
	hasUI: boolean;
	cwd: string;
	signal?: AbortSignal;
	isProjectTrusted: () => boolean;
	ui: { confirm: Confirm; notify: (text: string, kind?: string) => void };
};

function makeCtx(
	options: { hasUI?: boolean; trusted?: boolean; cwd?: string; confirm?: Confirm } = {},
): Ctx {
	return {
		hasUI: options.hasUI ?? false,
		cwd: options.cwd ?? "/tmp",
		isProjectTrusted: () => options.trusted ?? false,
		ui: {
			confirm: options.confirm ?? (async () => true),
			notify: () => {},
		},
	};
}

/** One session, asked the way either seam asks it. */
function session(key: string, ctx: Ctx) {
	return { sessionKey: key, ctx, isChild: false };
}

const ask = (key: string, ctx: Ctx, command: string, background = false, canFence = true, version = 5) =>
	decide(command, background, session(key, ctx), canFence, version);

function reasonOf(verdict: CallVerdict): string {
	if (verdict.kind !== "refuse") throw new Error(`expected a refusal, got ${JSON.stringify(verdict)}`);
	return verdict.reason;
}

beforeEach(() => {
	__resetGrantRecordsForTests();
	__resetGrantFloorsForTests();
});

describe("the seam-neutral verdict (ticket 02 §1)", () => {
	it("answers `allow` for a command the gate does not judge, and the kernel translation says nothing", async () => {
		const key = newKey();
		const verdict = await ask(key, makeCtx(), "ls -la /tmp");
		expect(verdict).toEqual({ kind: "allow" });
		// `allow` becomes *no verdict* for the kernel seam, which is what the slot said before the split.
		expect(toEgressVerdict(verdict)).toBeUndefined();
	});

	it("answers `fence` for a granted call, and the translation is the fenced allowance", async () => {
		const key = newKey();
		ensureGrantRecord(key).grants.set("dev@build-box", { route: "command", at: Date.now() });
		const verdict = await ask(key, makeCtx(), "ssh dev@build-box uptime");
		expect(verdict).toEqual({ kind: "fence", fence: REMOTE_OUTPUT_FENCE });
		expect(toEgressVerdict(verdict)).toEqual({ allow: true, fence: REMOTE_OUTPUT_FENCE });
	});

	it("answers `refuse` with the sentence the model reads, and the translation carries it", async () => {
		const key = newKey();
		const verdict = await ask(key, makeCtx(), "ssh dev@build-box uptime");
		expect(verdict.kind).toBe("refuse");
		const reason = reasonOf(verdict);
		expect(reason).toContain("dev@build-box");
		expect(reason).toContain("holds no grant at all");
		expect(toEgressVerdict(verdict)).toEqual({ allow: false, reason });
	});

	it("keeps every non-family refusal exactly as the gate wrote it", async () => {
		const key = newKey();
		const verdict = await ask(key, makeCtx(), "curl -s https://example.com");
		expect(reasonOf(verdict)).toContain("use await fetch_content(url) instead");
	});

	it("treats a transport invocation that reaches nobody as nothing to decide", async () => {
		const key = newKey();
		expect(await ask(key, makeCtx(), "ssh -V")).toEqual({ kind: "allow" });
	});
});

describe("the rules a granted call must satisfy (ticket 02 §5)", () => {
	const granted = () => {
		const key = newKey();
		ensureGrantRecord(key).grants.set("dev@build-box", { route: "command", at: Date.now() });
		return key;
	};

	it("refuses a background invocation, because the fence cannot wrap a handle", async () => {
		const verdict = await ask(granted(), makeCtx(), "ssh dev@build-box uptime", true);
		expect(reasonOf(verdict)).toContain("background=True");
	});

	it("refuses a redirected or teed granted command", async () => {
		expect(reasonOf(await ask(granted(), makeCtx(), "ssh dev@build-box uptime > /tmp/out"))).toContain("redirected");
		expect(reasonOf(await ask(granted(), makeCtx(), "ssh dev@build-box uptime | tee /tmp/out"))).toContain("redirected");
	});

	it("refuses a granted command that detaches itself, and allows the sequencer", async () => {
		expect(reasonOf(await ask(granted(), makeCtx(), "ssh dev@build-box uptime &"))).toContain("detaches itself");
		// `&&` is a sequencer, and a quoted `&` is not a detachment either.
		expect(await ask(granted(), makeCtx(), "ssh dev@build-box uptime && echo ok")).toEqual({
			kind: "fence",
			fence: REMOTE_OUTPUT_FENCE,
		});
		expect(await ask(granted(), makeCtx(), "ssh dev@build-box 'echo a & b'")).toEqual({
			kind: "fence",
			fence: REMOTE_OUTPUT_FENCE,
		});
	});
});

describe("backgroundsItself reads the text, not a word list", () => {
	it("counts an unquoted trailing & and nothing else", () => {
		expect(backgroundsItself("ssh host cmd &")).toBe(true);
		expect(backgroundsItself("ssh host cmd &  ")).toBe(true);
		expect(backgroundsItself("ssh host cmd &&")).toBe(false);
		expect(backgroundsItself("ssh host cmd && other")).toBe(false);
		expect(backgroundsItself("ssh host cmd & other")).toBe(false);
		expect(backgroundsItself("ssh host 'cmd &'")).toBe(false);
		expect(backgroundsItself("echo hi > file &")).toBe(true);
		expect(backgroundsItself("ssh host cmd")).toBe(false);
	});
});

describe("a session whose code mode cannot fence (ticket 04 §5)", () => {
	it("refuses the target and names the version, and offers no grant route", async () => {
		const key = newKey();
		ensureGrantRecord(key).grants.set("dev@build-box", { route: "command", at: Date.now() });
		const verdict = await ask(key, makeCtx(), "ssh dev@build-box uptime", false, false, 4);
		const reason = reasonOf(verdict);
		expect(reason).toContain("contract version 4");
		expect(reason).toContain("a grant needs 5");
	});
});

describe("the ask, at the seam-neutral level (ticket 02 §2)", () => {
	it("grants on a yes, and the very next call is fenced", async () => {
		const key = newKey();
		const ctx = makeCtx({ hasUI: true, confirm: async () => true });
		expect(await ask(key, ctx, "ssh dev@build-box uptime")).toEqual({ kind: "fence", fence: REMOTE_OUTPUT_FENCE });
		expect(ensureGrantRecord(key).grants.get("dev@build-box")?.route).toBe("ask");
	});

	it("remembers a no, so the next call does not ask again", async () => {
		const key = newKey();
		let asked = 0;
		const ctx = makeCtx({
			hasUI: true,
			confirm: async () => {
				asked += 1;
				return false;
			},
		});
		const first = await ask(key, ctx, "ssh dev@build-box uptime");
		expect(reasonOf(first)).toContain("declined");
		expect(ensureGrantRecord(key).denials.has("dev@build-box")).toBe(true);
		const second = await ask(key, ctx, "ssh dev@build-box uptime");
		expect(reasonOf(second)).toContain("declined");
		expect(asked).toBe(1);
	});

	it("never asks where no dialog can appear", async () => {
		const key = newKey();
		let asked = 0;
		const ctx = makeCtx({ hasUI: false, confirm: async () => (asked += 1, true) });
		const verdict = await ask(key, ctx, "ssh dev@build-box uptime");
		expect(reasonOf(verdict)).toContain("nobody can be asked here");
		expect(asked).toBe(0);
	});
});
