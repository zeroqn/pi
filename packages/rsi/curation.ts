/**
 * The curator: lifecycle and consolidation over the whole learned store.
 *
 * Two jobs, deliberately separated:
 *
 * - **Retirement** is deterministic and model-free. A learned skill not used
 *   within the disuse window is archived; any use resets the clock; skills
 *   younger than the window and pinned skills are exempt. There is no numeric
 *   salience, because pi offers no effectiveness signal to feed one.
 * - **Consolidation** is the LLM pass: absorb narrow siblings into class-level
 *   umbrellas, never delete, and turn anything it may not do unattended (a
 *   pinned skill, a human-tier overlap, a cross-scope duplicate) into a
 *   proposal.
 *
 * The decisions live here so they can be tested; `index.ts` wires the fork.
 */

import type { Ledger } from "./ledger.ts";
import type { RsiConfig } from "./config.ts";
import type { SkillStore } from "./store.ts";
import { scopeKey } from "./telemetry.ts";

export interface Candidate {
	name: string;
	scope: string;
	description: string;
	pinned: boolean;
	createdAt?: string;
	useCount: number;
	readCount: number;
	lastUsedAt?: string;
	/** Days since creation; 0 when unknown, so a hand-placed skill is never retired. */
	ageDays: number;
	/** Days since the last use, falling back to creation. */
	idleDays: number;
}

const DAY_MS = 86_400_000;

/** Every live learned skill with the ledger counters that describe it. */
export function buildCandidates(store: SkillStore, ledger: Ledger, now: number): Candidate[] {
	return store.listSkills().map((skill) => {
		const entry = ledger.skills[skill.name] ?? {};
		const createdAt = typeof skill.metadata.created_at === "string" ? skill.metadata.created_at : undefined;
		const lastUsedAt = typeof entry.last_used_at === "string" ? entry.last_used_at : undefined;
		return {
			name: skill.name,
			scope: scopeKey(skill.scope),
			description: skill.description,
			pinned: skill.pinned || entry.pinned === true,
			createdAt,
			useCount: entry.use_count ?? 0,
			readCount: entry.read_count ?? 0,
			lastUsedAt,
			ageDays: daysSince(createdAt, now) ?? 0,
			idleDays: daysSince(lastUsedAt ?? createdAt, now) ?? 0,
		};
	});
}

/** Skills past the disuse window: not pinned, and not used recently enough. */
export function retirementCandidates(candidates: readonly Candidate[], options: { disuseWeeks: number }): Candidate[] {
	const window = options.disuseWeeks * 7;
	return candidates.filter((candidate) => !candidate.pinned && candidate.idleDays >= window);
}

export interface CurationDue {
	due: boolean;
	reason?: string;
}

/** Interval-or-size, gated on the library having anything in it at all. */
export function isCurationDue(input: {
	lastCurateAt: string | null | undefined;
	activeCount: number;
	config: RsiConfig;
	now: number;
}): CurationDue {
	if (input.activeCount === 0) return { due: false, reason: "nothing learned yet" };
	if (input.activeCount > input.config.maxActiveSkills) {
		return { due: true, reason: `${input.activeCount} active skills (> ${input.config.maxActiveSkills})` };
	}

	const intervalDays = input.config.consolidateEveryWeeks * 7;
	const elapsed = daysSince(input.lastCurateAt, input.now);
	if (elapsed === undefined) return { due: true, reason: "first curation" };
	if (elapsed >= intervalDays) return { due: true, reason: `${Math.floor(elapsed)} days since the last curation` };

	return { due: false };
}

export interface CuratorPromptInput {
	candidates: readonly Candidate[];
	/** Names already taken in the human tier, so the curator proposes instead of colliding. */
	humanTier: readonly string[];
	mode: "observe" | "write";
}

export function buildCuratorPrompt(input: CuratorPromptInput): string {
	const groups = new Map<string, Candidate[]>();
	for (const candidate of input.candidates) {
		const group = groups.get(candidate.scope) ?? [];
		group.push(candidate);
		groups.set(candidate.scope, group);
	}

	const catalog = [...groups.entries()]
		.map(([scope, candidates]) => {
			const lines = candidates.map((candidate) => {
				const pin = candidate.pinned ? " [PINNED]" : "";
				const used = candidate.useCount === 0 ? "never used" : `${candidate.useCount} uses, idle ${Math.floor(candidate.idleDays)}d`;
				return `- ${candidate.name}${pin} (${used}; age ${Math.floor(candidate.ageDays)}d): ${candidate.description}`;
			});
			return `### Scope ${scope}\n${lines.join("\n")}`;
		})
		.join("\n\n");

	const human = input.humanTier.length > 0 ? input.humanTier.join(", ") : "(none)";
	const modeLine =
		input.mode === "observe"
			? "The store is in **observe-only** mode: every create, patch and archive you attempt becomes a proposal for a human, never an applied change. (Deterministic retirement for disuse still runs; that is a clock, not a judgement.)"
			: "Writes are applied directly. Every patch takes a snapshot first, so a merge reverts exactly.";

	return `You are the curator of a learned-skill library for the pi coding agent. Your job is to turn a pile of narrow, session-shaped skills into a small set of class-level umbrellas.

## The library

${catalog || "(the learned store is empty)"}

Names already taken in the human-authored tier: ${human}

${modeLine}

## What to do

- **Absorb narrow siblings into an umbrella.** If several skills cover facets of one domain, extend an existing umbrella with \`patch\` (add labelled subsections), or create one umbrella and archive the siblings it absorbs. Five narrow siblings should lose to one umbrella with five subsections.
- **Create an umbrella** only when there is no suitable parent and at least two candidates justify it.
- **Archive** a skill that is fully subsumed or clearly superseded. Never delete anything — archive is a move, and it is reversible.
- Keep every umbrella grounded and concrete; do not invent content that the candidates do not support.

## What you may not do unattended

- **Never touch a pinned skill.** \`patch\` and \`archive\` refuse it. If a pinned skill ought to be absorbed, \`propose\` the change instead and say why.
- **Never merge across scopes into \`general\`.** If the same lesson appears in two scopes, \`propose\` a scope promotion and let a human decide.
- **Never edit a human-authored skill.** If a learned skill duplicates one of the human-tier names above, \`propose\` instead of creating a collision.
- Emitting nothing is a perfectly good outcome. Most curation passes should change little.

## How to work

Use the \`skill_store\` tool: \`list\`, \`read\`, \`create\`, \`patch\`, \`archive\`, \`propose\`. Read a skill before you patch it. When you create or patch, keep the standard shape (\`## When this applies\`, \`## How\`, \`## Verification\` when procedural).

When you are done, reply with a short list of what you changed, or \`nothing\`.`;
}

export interface CurationReportInput {
	at: string;
	mode: "observe" | "write";
	model?: string;
	dueReason?: string;
	beforeCount: number;
	afterCount: number;
	retired: readonly string[];
	created: number;
	proposed: number;
	patched: number;
	archived: number;
	hardHits: number;
	error?: string;
	snapshotDir?: string;
}

export function buildCurationReport(input: CurationReportInput): string {
	const lines = [
		"# RSI curation report",
		"",
		`- at: ${input.at}`,
		`- mode: ${input.mode}`,
		`- model: ${input.model ?? "(session default)"}`,
		`- due: ${input.dueReason ?? "forced"}`,
		"",
		"## Library",
		"",
		`- before: ${input.beforeCount} active`,
		`- after: ${input.afterCount} active`,
		"",
		"## Tool actions",
		"",
		`- created: ${input.created}`,
		`- proposed: ${input.proposed}`,
		`- patched: ${input.patched}`,
		`- archived: ${input.archived}`,
	];
	if (input.retired.length > 0) {
		lines.push("", "## Retired for disuse", "");
		for (const name of input.retired) lines.push(`- ${name}`);
	}
	if (input.snapshotDir) lines.push("", `Snapshots: ${input.snapshotDir}`);
	if (input.hardHits > 0) lines.push("", `Content scan hits: ${input.hardHits}`);
	if (input.error) lines.push("", "## Error", "", `- ${input.error}`);
	lines.push("");
	return lines.join("\n");
}

function daysSince(iso: string | null | undefined, now: number): number | undefined {
	if (typeof iso !== "string") return undefined;
	const parsed = Date.parse(iso);
	if (Number.isNaN(parsed)) return undefined;
	return (now - parsed) / DAY_MS;
}
