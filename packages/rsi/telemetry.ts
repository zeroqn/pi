/**
 * Usage telemetry for the learned store.
 *
 * pi records no skill usage, so the extension observes it: a read whose path is
 * inside a learned skill directory, or a `/skill:name` expansion (which reaches
 * `before_agent_start` as an expanded `<skill name=…>` prompt). Observations are
 * deduped per turn — a skill consulted once in a turn counts once, however many
 * times the turn reads it. A `bash` read is a best-effort fallback for when
 * `read` is unavailable.
 *
 * The learner's own fork never reaches these hooks: its explicit ResourceLoader
 * excludes this extension.
 */

import * as path from "node:path";
import type { Ledger, StatusCounts } from "./ledger.ts";
import { isInside } from "./paths.ts";
import type { LearnedSkill, Scope, SkillStore } from "./store.ts";

export type UsageKind = "read" | "expansion";

export interface UsageEvent {
	skill: string;
	/** `"general"` or a project key, as stored in the ledger. */
	scope: string;
	kind: UsageKind;
}

/** The ledger's string form of a scope. */
export function scopeKey(scope: Scope): string {
	return scope === "general" ? "general" : scope.project;
}

/**
 * Turns raw observations into deduped usage events. It owns no persistence and
 * makes no decisions about the ledger; callers record what it returns.
 */
export class UsageTracker {
	private counted = new Set<string>();
	private firstTurn = true;
	private index: LearnedSkill[] | undefined;
	private readonly store: SkillStore;

	constructor(store: SkillStore) {
		this.store = store;
	}

	/** Start of a user prompt: the expansion that follows belongs to turn zero. */
	beginRun(): void {
		this.counted.clear();
		this.firstTurn = true;
	}

	/** A turn boundary. The first turn keeps the expansion counted before it. */
	beginTurn(): void {
		if (this.firstTurn) {
			this.firstTurn = false;
			return;
		}
		this.counted.clear();
	}

	/** A file read: usage when the path is inside a learned skill directory. */
	noteRead(filePath: string): UsageEvent | undefined {
		if (filePath.length === 0) return undefined;
		const skill = this.findByPath(filePath);
		return skill ? this.mark(skill, "read") : undefined;
	}

	/** A `/skill:name` expansion, resolved by name and then by location. */
	noteExpansion(name: string, location?: string): UsageEvent | undefined {
		const skill = this.findByName(name) ?? (location ? this.findByPath(location) : undefined);
		return skill ? this.mark(skill, "expansion") : undefined;
	}

	private mark(skill: LearnedSkill, kind: UsageKind): UsageEvent | undefined {
		if (this.counted.has(skill.name)) return undefined;
		this.counted.add(skill.name);
		return { skill: skill.name, scope: scopeKey(skill.scope), kind };
	}

	private all(): LearnedSkill[] {
		return (this.index ??= this.store.listSkills());
	}

	/** A skill added mid-session (after a reload) is only found on a re-scan. */
	private refreshed(): LearnedSkill[] {
		return (this.index = this.store.listSkills());
	}

	private findByPath(filePath: string): LearnedSkill | undefined {
		const absolute = path.resolve(filePath);
		const match = (skills: LearnedSkill[]) => skills.find((skill) => isInside(skill.dir, absolute));
		return match(this.all()) ?? match(this.refreshed());
	}

	private findByName(name: string): LearnedSkill | undefined {
		const match = (skills: LearnedSkill[]) => skills.find((skill) => skill.name === name);
		return match(this.all()) ?? match(this.refreshed());
	}
}

/**
 * Path-looking tokens from a bash command that may have read a skill, for the
 * `read`-unavailable fallback. Deliberately conservative: the first token must
 * be a known read-only command, and a token only counts if it looks like a path.
 * A miss costs one usage count; a false positive would invent one.
 */
const READ_COMMANDS = new Set([
	"cat",
	"bat",
	"head",
	"tail",
	"less",
	"more",
	"sed",
	"awk",
	"grep",
	"rg",
	"wc",
	"nl",
	"strings",
	"jq",
	"read",
	"rtk",
	"python",
	"python3",
	"node",
]);

export function bashReadCandidates(command: string): string[] {
	const tokens = tokenizeCommand(command);
	if (tokens.length === 0 || !READ_COMMANDS.has(tokens[0])) return [];
	return tokens.slice(1).filter((token) => token.includes("/") || token.endsWith(".md"));
}

function tokenizeCommand(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: string | null = null;

	for (const ch of command) {
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch) || ch === "|" || ch === "&" || ch === ";" || ch === ">" || ch === "<") {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (current.length > 0) tokens.push(current);
	return tokens;
}

/** The counters `/rsi status` reports, and snapshots so it can show a delta. */
export function summarizeStatus(store: SkillStore, ledger: Ledger): StatusCounts {
	const skills = store.listSkills();
	let uses = 0;
	for (const entry of Object.values(ledger.skills)) {
		uses += entry.use_count ?? 0;
	}
	const neverUsed = skills.filter((skill) => (ledger.skills[skill.name]?.use_count ?? 0) === 0).length;
	return { skills: skills.length, uses, neverUsed };
}

export interface StatusView {
	counts: StatusCounts;
	previous?: StatusCounts;
	enabled: boolean;
	observeOnly: boolean;
	lastPassAt: string | null;
	proposals: number;
	storePath: string;
}

/** Render `/rsi status`, opening with the since-last-look delta when there is one. */
export function formatStatus(view: StatusView): string {
	const { counts } = view;
	const lines = [`rsi: ${counts.skills} skills, ${counts.uses} uses (${counts.neverUsed} never used)`];
	if (view.previous) {
		lines.push(
			`since last look: ${signed(counts.skills - view.previous.skills)} skills, ` +
				`${signed(counts.uses - view.previous.uses)} uses, ${signed(counts.neverUsed - view.previous.neverUsed)} never used`,
		);
	}
	lines.push(`mode: ${view.enabled ? "enabled" : "disabled"}, ${view.observeOnly ? "observe-only" : "write"}`);
	lines.push(`last pass: ${view.lastPassAt ?? "never"}`);
	lines.push(`proposals: ${view.proposals}`);
	lines.push(`store: ${view.storePath}`);
	return lines.join("\n");
}

function signed(value: number): string {
	return value >= 0 ? `+${value}` : String(value);
}
