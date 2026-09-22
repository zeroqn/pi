/**
 * The reader: what a session may call, how those names reach the kernel, and the one rule about
 * pi's active set.
 *
 * Three things live here, and each is a decision from the effort's map (`.scratch/tool-bridge/`):
 *
 * 1. **Gathering, per session** (ticket 04). One policy — the owner's `catalogue(ctx)` — is what
 *    gets advertised, so a listed name is a name that works. A publication that is the wrong
 *    version, has no executor, or throws while answering is refused whole; a malformed *entry*
 *    is dropped and the owner keeps the rest (ticket 08).
 * 2. **The single host function** (tickets 01 and 08). `await tool()` lists what is published,
 *    `await tool("ctx_reduce", drop="3-5")` calls one, and the answer is the tool's own text,
 *    refusals included. An unpublished name throws a `NameError` that lists what was published,
 *    which is the one failure a model can repair by itself.
 * 3. **The surface rule** (ticket 03, extended by ticket 12). Once a name is reachable from a
 *    cell, its pi tool is stripped from the active set for that session — and only then, because a
 *    session with no cell route must keep the pi tool it had. The rule has a second direction: a
 *    *native-only* tool, whose effect is pi's dispatch rather than its own `execute`, must be
 *    **active**, because the convention forbids publishing it. This is the half an entry runs per
 *    turn, and the same function is what a child factory would call, since ambient extensions are
 *    not loaded in a child.
 *
 * Nothing here imports pi: the surface is typed structurally, so the rules are testable with no
 * extension host, no kernel and no monty — the same property that makes code mode's
 * `contract.ts` a test of rules rather than of monty.
 */
import {
	API_VERSION,
	type BridgePublication,
	type BridgeToolEntry,
	READER,
	type SlotOwner,
	sessionKey,
	bridgedSession,
	publications,
	recordBridged,
} from "./convention";

/** The part of a contribution ledger this package uses, structurally (code-mode's handle). */
export type BridgeContribution = {
	owner: string;
	hostFns?: Record<string, (...args: unknown[]) => Promise<unknown>>;
	guidelines?: string[];
};

export type BridgeReceipt = {
	accepted?: string[];
	rejected?: { name: string; reason: string }[];
};

/** `KernelHandle.contribute`, structurally. */
export type KernelContribute = (contribution: BridgeContribution) => BridgeReceipt;

/** What a pi extension api has to offer for the surface rule — nothing else is used. */
export type ActiveToolSurface = {
	getActiveTools(): string[];
	/** pi's real api has this; a minimal test stub may not. It is the only way to tell whether a
	 *  native-only tool is registered at all — activating an unknown name is a silent no-op. */
	getAllTools?(): { name: string }[];
	setActiveTools(names: string[]): void;
};

/**
 * Tools the convention forbids publishing, so a bridged session must keep them as real pi tools.
 *
 * Their effect is pi's *dispatch*, not their own `execute` — Magic Context's `todowrite` writes
 * nothing itself (its state is captured from `tool_execution_start` / `message_end`), so a call
 * routed through the bridge would succeed and record nothing. Code mode's mount-time reset is what
 * removes them from the active set, and no owner re-appends this one, so the rule has to put it
 * back. See `.scratch/tool-bridge/issues/12-activate-todowrite.md`.
 */
export const NATIVE_ONLY_TOOLS = ["todowrite"] as const;

export type BridgeProblem = {
	owner: string;
	reason: string;
	/** Set when the problem is one entry rather than the whole owner. */
	entry?: string;
};

export type GatheredTool = {
	owner: string;
	entry: BridgeToolEntry;
	publication: BridgePublication;
};

export type Gathered = { tools: GatheredTool[]; problems: BridgeProblem[] };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Reads every publication for one session and returns the tools that session may call, plus a
 * reason for everything it dropped.
 */
export function gatherToolBridge(
	ctx: unknown,
	owners: SlotOwner[] = publications(),
): Gathered {
	const tools: GatheredTool[] = [];
	const problems: BridgeProblem[] = [];
	/** tool name -> the owner that holds it. First owner wins; see the collision rule below. */
	const claimed = new Map<string, string>();

	for (const { publication } of owners) {
		const owner =
			isRecord(publication) && typeof publication.owner === "string" && publication.owner.length > 0
				? publication.owner
				: "(unnamed)";

		if (
			!isRecord(publication) ||
			typeof publication.catalogue !== "function" ||
			typeof publication.execute !== "function"
		) {
			problems.push({
				owner,
				reason: "publishes no catalogue/execute — nothing from this owner is offered",
			});
			continue;
		}
		if (publication.apiVersion !== API_VERSION) {
			problems.push({
				owner,
				reason: `apiVersion ${String(publication.apiVersion)} is not ${API_VERSION} — refused whole`,
			});
			continue;
		}

		let raw: unknown;
		try {
			raw = publication.catalogue(ctx);
		} catch (error) {
			problems.push({ owner, reason: `catalogue(ctx) threw — ${errorText(error)}` });
			continue;
		}
		if (!Array.isArray(raw)) {
			problems.push({ owner, reason: "catalogue(ctx) did not return an array" });
			continue;
		}

		const kept: GatheredTool[] = [];
		const seen = new Set<string>();
		let refused: string | undefined;
		for (const candidate of raw) {
			const checked = asEntry(candidate);
			if (checked.ok && checked.value) {
				const name = checked.value.name;
				if (seen.has(name)) {
					refused = `publishes '${name}' twice`;
					break;
				}
				const holder = claimed.get(name);
				if (holder !== undefined && holder !== owner) {
					refused = `publishes '${name}', which ${holder} already holds`;
					break;
				}
				seen.add(name);
				kept.push({ owner, entry: checked.value, publication });
				continue;
			}
			problems.push({
				owner,
				reason: checked.reason ?? "malformed catalogue entry was dropped",
				entry: checked.name,
			});
		}
		if (refused !== undefined) {
			problems.push({ owner, reason: `${refused} — refused whole` });
			continue;
		}
		for (const tool of kept) {
			claimed.set(tool.entry.name, owner);
			tools.push(tool);
		}
	}
	return { tools, problems };
}

/**
 * A deliberately undiscriminated result: a consumer typechecks this file with *its own* tsconfig,
 * and a boolean-literal discriminant does not narrow under `strict: false` — which rlm's config
 * is. Every field is optional and the reader checks `ok` and `value` at runtime.
 */
type EntryCheck = {
	ok: boolean;
	value?: BridgeToolEntry;
	name?: string;
	reason?: string;
};

function asEntry(candidate: unknown): EntryCheck {
	if (!isRecord(candidate)) {
		return { ok: false, reason: "a catalogue entry that is not an object was dropped" };
	}
	const name = candidate.name;
	if (typeof name !== "string" || name.length === 0) {
		return { ok: false, reason: "a catalogue entry without a name was dropped" };
	}
	if (candidate.parameters !== undefined && !isRecord(candidate.parameters)) {
		return {
			ok: false,
			name,
			reason: `entry '${name}' has a parameters value that is not a schema object — entry dropped`,
		};
	}
	return {
		ok: true,
		value: {
			name,
			description: typeof candidate.description === "string" ? candidate.description : undefined,
			snippet: typeof candidate.snippet === "string" ? candidate.snippet : undefined,
			parameters: candidate.parameters,
		},
	};
}

/** The property names of a tool's published schema. Only the names are read, never required-ness:
 * every schema Magic Context publishes is all-optional. */
export function parameterNames(entry: BridgeToolEntry): string[] {
	const parameters = entry.parameters;
	if (!isRecord(parameters)) return [];
	const properties = parameters.properties;
	if (!isRecord(properties)) return [];
	return Object.keys(properties);
}

/** What `await tool()` answers: every published name with its one-line description. */
export function renderCatalogue(gathered: Gathered): string {
	if (gathered.tools.length === 0) return "No tools are published for this session.";
	const lines: string[] = [];
	for (const owner of ownersOf(gathered)) {
		lines.push(`${owner}:`);
		for (const tool of gathered.tools) {
			if (tool.owner !== owner) continue;
			const summary = tool.entry.snippet ?? tool.entry.description ?? "";
			const names = parameterNames(tool.entry);
			const params = names.length > 0 ? `params: ${names.join(", ")}` : "no parameters";
			lines.push(`  ${tool.entry.name}${summary.length > 0 ? ` — ${summary}` : ""} (${params})`);
		}
	}
	return lines.join("\n");
}

function ownersOf(gathered: Gathered): string[] {
	return [...new Set(gathered.tools.map((tool) => tool.owner))];
}

/**
 * One instruction line per publishing owner (ticket 02, widened by ticket 13). Generated from the
 * catalogue that was actually contributed, so it cannot name a tool this session does not have.
 *
 * It carries three things, and the second is the one ticket 13 had to add. The line names **every**
 * tool the owner published, because an owner's own prompt may have told the model to call
 * `ctx_reduce` — Magic Context's does, in every session — and a line naming only the first entry
 * (`ctx_search`) left that model writing `await ctx_reduce(drop="3-5")`: a bare name no kernel has,
 * to which monty answers with a `NameError` that teaches nothing. So the line states the negative
 * too, and then closes the gap to *how* with a worked example.
 */
export function bridgeGuidelines(gathered: Gathered): string[] {
	const lines: string[] = [];
	for (const owner of ownersOf(gathered)) {
		const published = gathered.tools.filter((tool) => tool.owner === owner);
		const first = published[0];
		if (!first) continue;
		const names = parameterNames(first.entry);
		const call =
			names.length > 0
				? `await tool("${first.entry.name}", ${names[0]}=…)`
				: `await tool("${first.entry.name}")`;
		lines.push(
			`${owner} publishes ${published.map((tool) => tool.entry.name).join(", ")}. None of them is a pi tool or a bare name in a cell — call one as ${call}; await tool() lists them all.`,
		);
	}
	return lines;
}

/**
 * The tool's own text, verbatim. A refusal (`isError: true`) is an answer the model must read,
 * not an exception — only a *fault* (an executor that threw, a name that was never published)
 * crosses into the sandbox as one.
 */
export function textOfResult(result: unknown): string {
	if (typeof result === "string") return result;
	const content = (result as { content?: unknown } | null)?.content;
	const parts: string[] = [];
	let nonText = 0;
	if (Array.isArray(content)) {
		for (const part of content) {
			if (typeof part === "string") {
				parts.push(part);
				continue;
			}
			const text = (part as { text?: unknown } | null)?.text;
			if (typeof text === "string") parts.push(text);
			else nonText += 1;
		}
	}
	if (parts.length > 0) return parts.join("\n");
	return nonText > 0
		? `(no text; the tool returned ${nonText} non-text part${nonText === 1 ? "" : "s"})`
		: "";
}

/**
 * An unknown name is a fault the cell can catch and the model can repair: monty maps a thrown
 * error into a Python exception, using the error's own `name` when it matches a Python type, so
 * this arrives as a `NameError` whose message says what *is* published.
 */
function unknownTool(name: string, gathered: Gathered): Error {
	const published = gathered.tools.map((tool) => tool.entry.name);
	const suffix =
		published.length > 0 ? `Published in this session: ${published.join(", ")}.` : "Nothing is published in this session.";
	const error = new Error(`no tool named '${name}'. ${suffix}`);
	error.name = "NameError";
	return error;
}

/** The one host function the bridge contributes, bound to the session it was gathered for. */
export function toolHostFn(
	gathered: Gathered,
	ctx: unknown,
): (...args: unknown[]) => Promise<string> {
	return async (...args: unknown[]): Promise<string> => {
		if (args.length === 0) return renderCatalogue(gathered);
		const requested = args[0];
		if (typeof requested !== "string" || requested.length === 0) {
			const error = new TypeError(
				`tool() takes a tool name: await tool() lists what is published, await tool("<name>", ...) calls one. Got ${typeof requested}.`,
			);
			throw error;
		}
		const found = gathered.tools.find((tool) => tool.entry.name === requested);
		if (!found) throw unknownTool(requested, gathered);
		// monty delivers a host function's keyword arguments as one trailing object, so
		// `tool("ctx_search", query="x")` and `tool("ctx_search", {"query": "x"})` arrive the same
		// way — and a call with no second argument means "no parameters".
		const params = isRecord(args[1]) ? args[1] : {};
		return textOfResult(await found.publication.execute(requested, params, ctx));
	};
}

export type BridgeInstallInput = {
	/** The session's kernel handle: `handle.contribute`. */
	contribute: KernelContribute;
	/** The calling session's ctx, handed to every executor (the tools resolve their own session). */
	ctx: unknown;
	/** Defaults to `sessionKey(ctx)`; the surface rule looks up the same value. */
	sessionKey?: string;
	/** Test seam: publications to read instead of the live slot. */
	owners?: SlotOwner[];
};

export type BridgeInstallResult = {
	/** The pi tool names this session's kernel can now call. Empty when nothing was installed. */
	installed: string[];
	/** Everything dropped on the way, each with a reason (loud once, in the caller's record). */
	problems: BridgeProblem[];
	/** Why nothing was installed, when nothing was. */
	reason?: string;
};

/**
 * Builds the contribution, hands it to the kernel, and records what became reachable — in that
 * order, because the record must not claim a route that the ledger refused.
 */
export function installToolBridge(input: BridgeInstallInput): BridgeInstallResult {
	const gathered = gatherToolBridge(input.ctx, input.owners ?? publications());
	if (gathered.tools.length === 0) {
		return {
			installed: [],
			problems: gathered.problems,
			reason:
				gathered.problems.length > 0
					? "no owner offered a usable tool"
					: "nothing is published",
		};
	}

	let receipt: BridgeReceipt;
	try {
		receipt = input.contribute({
			owner: READER,
			hostFns: { tool: toolHostFn(gathered, input.ctx) },
			guidelines: bridgeGuidelines(gathered),
		});
	} catch (error) {
		// The ledger is another package's code, and this runs inside a `session_start` handler:
		// a throw here would take the session's start with it. Loud, inert, recorded.
		return {
			installed: [],
			problems: gathered.problems,
			reason: `the kernel refused the contribution with an exception — ${errorText(error)}`,
		};
	}

	const accepted = new Set(receipt?.accepted ?? []);
	if (!accepted.has("tool")) {
		const rejected = (receipt?.rejected ?? [])
			.map((entry) => `${entry.name}: ${entry.reason}`)
			.join("; ");
		return {
			installed: [],
			problems: gathered.problems,
			reason: `the 'tool' host function was not accepted (${rejected || "no receipt"}) — the pi tools stay active, so nothing is lost`,
		};
	}

	const installed = gathered.tools.map((tool) => tool.entry.name);
	recordBridged(input.sessionKey ?? sessionKey(input.ctx), {
		toolNames: installed,
		owners: ownersOf(gathered),
	});
	return { installed, problems: gathered.problems };
}

/**
 * The surface rule, both directions: a name a cell can reach is not a pi tool in that session, and
 * a native-only tool is.
 *
 * Reads the session's record first, so a session with no installed bridge is left exactly as it
 * was — which is what keeps a code-mode session without the bridge from losing Magic Context's
 * `ctx_memory` re-append, the only route it has. Returns the names it stripped.
 */
export function reconcileToolSurface(pi: ActiveToolSurface, ctx: unknown): string[] {
	const record = bridgedSession(sessionKey(ctx));
	if (!record || record.toolNames.length === 0) return [];
	const bridged = new Set(record.toolNames);
	const active = pi.getActiveTools();
	const next = active.filter((name) => !bridged.has(name));
	const stripped = active.filter((name) => bridged.has(name));
	for (const name of nativeOnlyToActivate(pi, next, bridged)) next.push(name);
	if (!sameNames(next, active)) pi.setActiveTools(next);
	return stripped;
}

/**
 * The native-only tools that are registered and not already active, in declared order.
 *
 * A name an owner published is excluded even if it is on this list: the convention forbids
 * publishing these, so a publication is the owner's claim that a cell *can* do it, and the strip is
 * the direction that honours the claim. The two directions must not fight over one name.
 */
function nativeOnlyToActivate(
	pi: ActiveToolSurface,
	next: string[],
	bridged: Set<string>,
): string[] {
	const registered = pi.getAllTools?.();
	return NATIVE_ONLY_TOOLS.filter(
		(name) =>
			!next.includes(name) &&
			!bridged.has(name) &&
			// No registry to ask (a minimal stub): offer the name anyway — pi's `setActiveTools`
			// ignores a name that is not registered, so the worst case is a no-op.
			(registered === undefined || registered.some((tool) => tool.name === name)),
	);
}

function sameNames(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((name, index) => name === b[index]);
}
