/**
 * The store API the learner's fork is given: one tool, one action at a time.
 *
 * This module is the whole surface a background pass can touch, so the
 * governance invariants live here rather than in the prompt: content is scanned
 * before anything is written, observe-only and script-bearing skills become
 * proposals instead of library entries, and every path goes through the store's
 * own validation. It is dependency-free so the rules can be tested directly.
 */

import { formatContentHits, scanSkillContent, type ContentHit } from "./content-scan.ts";
import { serializeFrontmatter } from "./frontmatter.ts";
import { ensureSkillEntry, setSkillState } from "./ledger.ts";
import {
	buildSkillFrontmatter,
	validatePayloadPath,
	type NewSkillInput,
	type ProposalKind,
	type Scope,
	type SkillFile,
	type SkillStore,
} from "./store.ts";
import { scopeKey } from "./telemetry.ts";

export type SkillAction = "list" | "read" | "create" | "patch" | "archive" | "propose";

export interface SkillActionInput {
	action?: string;
	name?: string;
	description?: string;
	body?: string;
	/** `"general"` or a project key; defaults to the pass's scope. */
	scope?: string;
	files?: Array<{ path?: string; content?: string }>;
	reason?: string;
	/** For propose: skill | patch | archive | promotion. */
	kind?: string;
}

export interface SkillActionDeps {
	store: SkillStore;
	root: string;
	scope: Scope;
	mode: "observe" | "write";
	/** Reported for the pass's tool-action histogram. */
	onAction?: (action: SkillAction, name: string, held: boolean) => void;
	/** A hard scan hit is surfaced immediately, not just refused. */
	onHardHit?: (hits: readonly ContentHit[]) => void;
	/** Soft-hit retry counter, per skill name, for the length of a pass. */
	softAttempts?: Map<string, number>;
	/** Called before a patch so a merge can be reverted exactly. */
	snapshot?: (name: string) => void;
	now?: () => Date;
}

export interface SkillActionResult {
	text: string;
	isError?: boolean;
	action?: SkillAction;
	name?: string;
}

const USAGE =
	"skill_store actions: list | read {name} | create {name, description, body, files?} | patch {name, body?/description?/files?} | archive {name} | propose {name, description, body, reason}";

export async function runSkillAction(input: SkillActionInput, deps: SkillActionDeps): Promise<SkillActionResult> {
	const action = typeof input.action === "string" ? (input.action as SkillAction) : undefined;

	switch (action) {
		case "list":
			return listSkills(deps);
		case "read":
			return readSkill(input, deps);
		case "create":
			return createSkill(input, deps, "create");
		case "propose":
			return createSkill(input, deps, "propose");
		case "patch":
			return patchSkill(input, deps);
		case "archive":
			return archiveSkill(input, deps);
		default:
			return { text: USAGE, isError: true };
	}
}

function listSkills(deps: SkillActionDeps): SkillActionResult {
	const skills = deps.store.listSkills();
	if (skills.length === 0) return { text: "The learned store is empty.", action: "list" };
	const lines = skills.map((skill) => `- ${skill.name} [${scopeKey(skill.scope)}]: ${skill.description}`);
	return { text: lines.join("\n"), action: "list" };
}

function readSkill(input: SkillActionInput, deps: SkillActionDeps): SkillActionResult {
	const name = typeof input.name === "string" ? input.name : "";
	if (name.length === 0) return { text: "read requires a name", isError: true };
	const found = deps.store.readSkillContent(name);
	if (!found) return { text: `no learned skill named "${name}"`, isError: true };
	const files = found.files.length > 0 ? `\n\nFiles shipped: ${found.files.join(", ")}` : "";
	return { text: `${found.content}${files}`, action: "read", name };
}

async function createSkill(input: SkillActionInput, deps: SkillActionDeps, forced: "create" | "propose"): Promise<SkillActionResult> {
	const name = typeof input.name === "string" ? input.name.trim() : "";
	if (name.length === 0) return { text: "create requires a name", isError: true };
	const description = typeof input.description === "string" ? input.description.trim() : "";
	const body = typeof input.body === "string" ? input.body : "";
	if (forced === "create") {
		if (description.length === 0) return { text: "create requires a description", isError: true, name };
		if (body.trim().length === 0) return { text: "create requires a body", isError: true, name };
	}

	const files = normalizeFiles(input.files);
	const outsideWhitelist = files.find((file) => validatePayloadPath(file.path) !== undefined);

	const scope = scopeOf(input.scope, deps.scope);
	const gate = gateContent({ name, description, body, scope, files, deps });
	if (gate) return { ...gate, name };

	const proposed = { name, description, body, scope, files } satisfies NewSkillInput;
	const reason =
		forced === "propose"
			? typeof input.reason === "string" && input.reason.trim().length > 0
				? input.reason.trim()
				: "proposed by the learner"
			: outsideWhitelist
				? `out-of-whitelist payload: ${outsideWhitelist.path}`
				: deps.mode === "observe"
					? "observe-only mode"
					: "ships a script";
	const hold =
		forced === "propose" || deps.mode === "observe" || outsideWhitelist !== undefined || files.some((file) => file.path.startsWith("scripts/"));

	if (hold) {
		const result = deps.store.propose(proposed, { reason, kind: proposalKind(input.kind), mode: deps.mode, createdAt: deps.now?.().toISOString() });
		if (!result.ok) return { text: result.reason, isError: true, name };
		deps.onAction?.(forced, name, true);
		return { text: `held as a proposal for review (${reason}); nothing entered the live store.`, action: forced, name };
	}

	const result = deps.store.create(proposed);
	if (!result.ok) return { text: result.reason, isError: true, name };
	await ensureSkillEntry(deps.root, { name, scope: scopeKey(scope), at: deps.now?.().toISOString() });
	deps.onAction?.(forced, name, false);
	return { text: `created "${name}" in scope ${scopeKey(scope)}.`, action: forced, name };
}

async function patchSkill(input: SkillActionInput, deps: SkillActionDeps): Promise<SkillActionResult> {
	const name = typeof input.name === "string" ? input.name.trim() : "";
	if (name.length === 0) return { text: "patch requires a name", isError: true, name };

	const changes = {
		description: typeof input.description === "string" ? input.description : undefined,
		body: typeof input.body === "string" ? input.body : undefined,
		files: input.files ? normalizeFiles(input.files) : undefined,
	};
	const planned = deps.store.planPatch(name, changes);
	if (!planned.ok) return { text: planned.reason, isError: true, name };

	const content = planned.input;
	const document = composeDocument(content.name, content.description, content.body, content.scope, content.files ?? []);
	const gate = scanAndGate([{ path: "SKILL.md", content: document }, ...(content.files ?? [])], name, deps);
	if (gate) return { ...gate, name };

	if (deps.mode === "observe") {
		const result = deps.store.propose(content, { kind: "patch", reason: "observe-only mode", mode: deps.mode, createdAt: deps.now?.().toISOString() });
		if (!result.ok) return { text: result.reason, isError: true, name };
		deps.onAction?.("patch", name, true);
		return { text: `proposed a patch for "${name}" for review; the live skill is unchanged.`, action: "patch", name };
	}

	deps.snapshot?.(name);
	const result = deps.store.patch(name, changes);
	if (!result.ok) return { text: result.reason, isError: true, name };
	deps.onAction?.("patch", name, false);
	return { text: `patched "${name}".`, action: "patch", name };
}

async function archiveSkill(input: SkillActionInput, deps: SkillActionDeps): Promise<SkillActionResult> {
	const name = typeof input.name === "string" ? input.name.trim() : "";
	if (name.length === 0) return { text: "archive requires a name", isError: true };

	if (deps.mode === "observe") {
		const result = deps.store.propose({ name }, { kind: "archive", reason: "observe-only mode", mode: deps.mode, createdAt: deps.now?.().toISOString() });
		if (!result.ok) return { text: result.reason, isError: true, name };
		deps.onAction?.("archive", name, true);
		return { text: `proposed archiving "${name}" for review; nothing was moved.`, action: "archive", name };
	}

	const result = deps.store.archive(name);
	if (!result.ok) return { text: result.reason, isError: true, name };
	await setSkillState(deps.root, name, "archived");
	deps.onAction?.("archive", name, false);
	return { text: `archived "${name}" to ${result.dir}.`, action: "archive", name };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Scan the SKILL.md that would be written plus every payload. */
function gateContent(input: {
	name: string;
	description: string;
	body: string;
	scope: Scope;
	files: SkillFile[];
	deps: SkillActionDeps;
}): SkillActionResult | undefined {
	const document = composeDocument(input.name, input.description, input.body, input.scope, input.files);
	return scanAndGate([{ path: "SKILL.md", content: document }, ...input.files], input.name, input.deps);
}

function scanAndGate(files: { path: string; content: string }[], name: string, deps: SkillActionDeps): SkillActionResult | undefined {
	const scan = scanSkillContent(files);
	if (scan.hard.length > 0) {
		deps.onHardHit?.(scan.hard);
		return { text: `refused — ${formatContentHits(scan.hard)}`, isError: true, action: "create", name };
	}
	if (scan.soft.length === 0) return undefined;

	const attempts = (deps.softAttempts?.get(name) ?? 0) + 1;
	deps.softAttempts?.set(name, attempts);
	const allowed = attempts <= 1 ? " Remove or placehold the offending text and retry once." : " This was the retry; the skill was refused.";
	return { text: `refused — ${formatContentHits(scan.soft)}.${allowed}`, isError: true, action: "create", name };
}

function composeDocument(name: string, description: string, body: string, scope: Scope, files: readonly SkillFile[]): string {
	return serializeFrontmatter(buildSkillFrontmatter({ name, description, scope, files: files.map((file) => file.path) }), body);
}

function normalizeFiles(files: SkillActionInput["files"]): SkillFile[] {
	if (!Array.isArray(files)) return [];
	const normalized: SkillFile[] = [];
	for (const file of files) {
		if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
		normalized.push({ path: file.path, content: file.content });
	}
	return normalized;
}

function scopeOf(value: string | undefined, fallback: Scope): Scope {
	if (value === "general") return "general";
	if (typeof value === "string" && value.trim().length > 0) return { project: value.trim() };
	return fallback;
}

function proposalKind(value: string | undefined): ProposalKind | undefined {
	return value === "skill" || value === "patch" || value === "archive" || value === "promotion" ? value : undefined;
}
