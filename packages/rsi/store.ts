/**
 * The learned-skill store: everything under `~/.pi/agent/rsi/`.
 *
 * This is the only writer. It owns the layout, enforces store-wide name
 * uniqueness, validates every path it is asked to create, and publishes a new
 * skill with a single atomic rename so a killed pass can never leave a
 * half-written SKILL.md in the live tree.
 *
 * Layout (spec §2):
 *
 *   <root>/skills/general/<name>/SKILL.md
 *   <root>/skills/projects/<encoded-key>/<name>/SKILL.md
 *   <root>/.staging/            in-flight writes, swept on the next pass
 *   <root>/.archive/            retired skills, outside every surfaced path
 *   <root>/proposals/           pending human decisions
 *   <root>/reports/             audit records
 *   <root>/index.json           the ledger
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { ensureLedger } from "./ledger.ts";
import { assertInside, decodeScopeKey, encodeScopeKey, isInside } from "./paths.ts";

/** A learned skill lives in exactly one scope: `general`, or one project key. */
export type Scope = "general" | { project: string };

export interface LearnedSkill {
	name: string;
	description: string;
	scope: Scope;
	dir: string;
	filePath: string;
	metadata: Record<string, unknown>;
	pinned: boolean;
}

export interface SkillFile {
	/** Path relative to the skill directory, e.g. `scripts/run.sh`. */
	path: string;
	content: string;
}

export interface NewSkillInput {
	name: string;
	description: string;
	scope: Scope;
	body: string;
	metadata?: Record<string, unknown>;
	files?: SkillFile[];
	/** The session that produced it, recorded durably (ticket 14). */
	provenance?: SkillProvenance;
}

export interface StagedSkill {
	token: string;
	name: string;
	scope: Scope;
	/** Staging directory holding the fully-written skill. */
	dir: string;
	/** Final destination; checked again at publish time. */
	dest: string;
}

export type StageResult = { ok: true; staged: StagedSkill } | { ok: false; reason: string };
export type PublishResult = { ok: true; skill: LearnedSkill } | { ok: false; reason: string };
export type CreateResult = PublishResult;
export type ProposeResult = { ok: true; dir: string } | { ok: false; reason: string };
export type ArchiveResult = { ok: true; dir: string } | { ok: false; reason: string };
export type PatchPlan = { ok: true; input: NewSkillInput } | { ok: false; reason: string };

/** What a proposal is waiting for: a new skill, an edit, a retirement, or a promotion. */
export type ProposalKind = "skill" | "patch" | "archive" | "promotion";

export interface ProposalMeta {
	reason: string;
	kind?: ProposalKind;
	mode?: string;
	createdAt?: string;
}

/** A proposal may carry content (a skill or a patch) or just an operation (archive, promotion). */
export interface ProposalInput {
	name: string;
	description?: string;
	body?: string;
	scope?: Scope;
	files?: SkillFile[];
}

/** The `proposal.json` a pending proposal is read back from. */
export interface ProposalRecord {
	kind: string;
	name: string;
	scope?: string;
	reason?: string;
	mode?: string;
	created_at?: string;
}

export interface PendingProposal {
	dir: string;
	record: ProposalRecord;
	/** Present when the proposal carries skill content to apply. */
	input?: NewSkillInput;
}

export interface SkillContent {
	skill: LearnedSkill;
	/** The raw SKILL.md text. */
	content: string;
	/** Payload files relative to the skill directory, sorted. */
	files: string[];
}

export const MAX_SKILL_NAME_LENGTH = 64;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PAYLOAD_DIRS = new Set(["scripts", "references", "assets"]);
const SKILL_FILE_NAME = "SKILL.md";

/** True when `name` satisfies the Agent Skills name rules. */
export function isValidSkillName(name: string): boolean {
	return name.length >= 1 && name.length <= MAX_SKILL_NAME_LENGTH && SKILL_NAME.test(name);
}

/**
 * Where a skill came from (RSI x RLM ticket 14). Durable, because it lives in the skill
 * itself rather than the ledger, so it survives archiving and restore. The point is
 * double-learning: a child's finding reaches its own pass *and* the root's, and the root's
 * reviewer needs to know that its tree already wrote the lesson.
 */
export interface SkillProvenance {
	/** The session file that produced the skill. */
	session?: string;
	/** That session's parent, so a pass can find what its own tree wrote. */
	parentSession?: string;
}

/** The frontmatter a learned skill ships with; shared by every write path. */
export function buildSkillFrontmatter(input: {
	name: string;
	description: string;
	scope: Scope;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	/** Payload paths the skill ships, declared in frontmatter so a reader sees them. */
	files?: readonly string[];
	/** The session that produced it, recorded durably (ticket 14). */
	provenance?: SkillProvenance;
}): Record<string, unknown> {
	const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
	metadata.origin = "learned";
	if (typeof metadata.created_at !== "string") {
		metadata.created_at = input.createdAt ?? new Date().toISOString();
	}
	metadata.scope = input.scope === "general" ? "general" : input.scope.project;
	if (input.files && input.files.length > 0) metadata.files = [...input.files];
	if (input.provenance?.session) metadata.session = input.provenance.session;
	if (input.provenance?.parentSession) metadata.parent_session = input.provenance.parentSession;
	return { name: input.name, description: input.description, metadata };
}

/** A skill's recorded provenance, or `undefined` when it has none (a pre-provenance skill). */
export function provenanceOf(skill: LearnedSkill): SkillProvenance | undefined {
	const session = skill.metadata.session;
	const parentSession = skill.metadata.parent_session;
	if (typeof session !== "string" && typeof parentSession !== "string") return undefined;
	return {
		session: typeof session === "string" ? session : undefined,
		parentSession: typeof parentSession === "string" ? parentSession : undefined,
	};
}

/**
 * The skills written **by this session's tree**, which is what a pass is shown so it does not
 * create a sibling of its own child's work (ticket 14). "Tree" means: written by this session,
 * or by a session whose parent is this session. Resolved from the durable provenance above,
 * so it needs nothing from the seam.
 */
export function treeWrittenSkills(store: SkillStore, sessionFile: string | undefined): LearnedSkill[] {
	if (!sessionFile) return [];
	return store.listSkills().filter((skill) => {
		const provenance = provenanceOf(skill);
		return provenance?.session === sessionFile || provenance?.parentSession === sessionFile;
	});
}

export class SkillStore {
	readonly root: string;
	readonly stagingRoot: string;
	readonly archiveRoot: string;
	private readonly reservedNames: ReadonlySet<string>;

	constructor(options: { root: string; reservedNames?: Iterable<string> }) {
		this.root = path.resolve(options.root);
		this.stagingRoot = path.join(this.root, ".staging");
		this.archiveRoot = path.join(this.root, ".archive");
		this.reservedNames = new Set(options.reservedNames ?? []);
	}

	// -- layout ---------------------------------------------------------------

	generalDir(): string {
		return path.join(this.root, "skills", "general");
	}

	projectsDir(): string {
		return path.join(this.root, "skills", "projects");
	}

	/** Directory a scope's skills live in. Throws on an unencodable key. */
	scopeDir(scope: Scope): string {
		const base = path.join(this.root, "skills");
		const dir = scope === "general" ? this.generalDir() : path.join(this.projectsDir(), encodeScopeKey(scope.project));
		assertInside(base, dir);
		return dir;
	}

	ensureLayout(): void {
		for (const dir of [
			this.root,
			this.generalDir(),
			this.projectsDir(),
			path.join(this.root, "proposals"),
			this.archiveRoot,
			this.stagingRoot,
			path.join(this.root, "reports"),
		]) {
			fs.mkdirSync(dir, { recursive: true });
		}
		ensureLedger(this.root);
	}

	// -- surfacing ------------------------------------------------------------

	/**
	 * Skill paths to hand to `resources_discover` for a scope: `general` always,
	 * plus the project scope when there is one. Only paths that exist are
	 * returned, so a fresh store contributes nothing.
	 */
	skillPaths(scope: Scope): string[] {
		const dirs = scope === "general" ? [this.generalDir()] : [this.generalDir(), this.scopeDir(scope)];
		return dirs.filter((dir) => fs.existsSync(dir));
	}

	// -- reads ----------------------------------------------------------------

	/**
	 * Skills for a scope. `general` always, plus the project scope when there is one -
	 * the same union {@link skillPaths} surfaces to pi, so the two never disagree about
	 * what a session can see. Called with no argument, every scope.
	 */
	listSkills(scope?: Scope): LearnedSkill[] {
		const skills: LearnedSkill[] = [];
		for (const entry of this.scanSkillDirs(scope)) {
			const skill = this.readSkill(entry.dir, entry.scope);
			if (skill) skills.push(skill);
		}
		return skills.sort((a, b) => a.name.localeCompare(b.name));
	}

	findByName(name: string, scope?: Scope): LearnedSkill | undefined {
		return this.listSkills(scope).find((skill) => skill.name === name);
	}

	/** True when a name would collide with a human or learned skill. */
	isNameTaken(name: string): boolean {
		return this.reservedNames.has(name) || this.findByName(name) !== undefined;
	}

	/** Names reserved in the human tier, so a pass can propose instead of colliding. */
	humanTierNames(): string[] {
		return [...this.reservedNames];
	}

	// -- writes ---------------------------------------------------------------

	/**
	 * Validate a new skill and write it into staging. Nothing is visible to pi
	 * until {@link publish} renames the directory into the live tree.
	 */
	stage(input: NewSkillInput): StageResult {
		const nameError = this.validateName(input.name);
		if (nameError) return { ok: false, reason: nameError };
		if (input.description.trim().length === 0) return { ok: false, reason: "description must not be empty" };
		if (input.body.trim().length === 0) return { ok: false, reason: "body must not be empty" };

		let dest: string;
		try {
			dest = path.join(this.scopeDir(input.scope), input.name);
		} catch (error) {
			return { ok: false, reason: error instanceof Error ? error.message : String(error) };
		}
		assertInside(this.root, dest);

		for (const file of input.files ?? []) {
			const fileError = validatePayloadPath(file.path);
			if (fileError) return { ok: false, reason: fileError };
		}

		this.ensureLayout();

		const token = randomUUID();
		const stagingDir = path.join(this.stagingRoot, token, input.name);
		assertInside(this.stagingRoot, stagingDir);

		try {
			fs.mkdirSync(stagingDir, { recursive: true });
			this.writeSkillFiles(stagingDir, buildSkillFrontmatter({ name: input.name, description: input.description, scope: input.scope, metadata: input.metadata, files: (input.files ?? []).map((file) => file.path), provenance: input.provenance }), input.body, input.files);
		} catch (error) {
			this.removeQuietly(path.join(this.stagingRoot, token));
			return { ok: false, reason: `staging write failed: ${error instanceof Error ? error.message : String(error)}` };
		}

		return { ok: true, staged: { token, name: input.name, scope: input.scope, dir: stagingDir, dest } };
	}

	/**
	 * Move a staged skill into the live tree with one rename. Re-checks the
	 * destination so two passes cannot both publish the same name.
	 */
	publish(staged: StagedSkill): PublishResult {
		assertInside(this.root, staged.dest);
		assertInside(this.stagingRoot, staged.dir);

		if (fs.existsSync(staged.dest)) {
			this.discard(staged);
			return { ok: false, reason: `a skill named "${staged.name}" already exists in this scope` };
		}

		try {
			fs.mkdirSync(path.dirname(staged.dest), { recursive: true });
			fs.renameSync(staged.dir, staged.dest);
		} catch (error) {
			this.discard(staged);
			return { ok: false, reason: `publish failed: ${error instanceof Error ? error.message : String(error)}` };
		}

		this.removeQuietly(path.join(this.stagingRoot, staged.token));
		const skill = this.readSkill(staged.dest, staged.scope);
		if (!skill) {
			return { ok: false, reason: `published skill could not be read back: ${staged.dest}` };
		}
		return { ok: true, skill };
	}

	/** Stage and immediately publish; a failure never leaves staging behind. */
	create(input: NewSkillInput): CreateResult {
		const staged = this.stage(input);
		if (!staged.ok) return { ok: false, reason: staged.reason };
		return this.publish(staged.staged);
	}

	/** Remove a staged skill. Safe to call more than once. */
	discard(staged: StagedSkill): void {
		this.removeQuietly(path.join(this.stagingRoot, staged.token));
	}

	/** Delete every staging entry. Returns how many were removed. */
	sweepStaging(): number {
		let entries: string[];
		try {
			entries = fs.readdirSync(this.stagingRoot);
		} catch {
			return 0;
		}
		let removed = 0;
		for (const entry of entries) {
			const target = path.join(this.stagingRoot, entry);
			if (!isInside(this.stagingRoot, target)) continue;
			this.removeQuietly(target);
			removed++;
		}
		return removed;
	}

	// -- proposals, patches, retirement ---------------------------------------

	/**
	 * Write a pending change under `proposals/` instead of the live store: what
	 * observe-only produces, and what a script-bearing skill is held as. The
	 * directory holds the exact files that would be published plus `proposal.json`.
	 */
	propose(input: ProposalInput, meta: ProposalMeta): ProposeResult {
		if (!isValidSkillName(input.name)) return { ok: false, reason: `invalid skill name "${input.name}"` };

		const hasContent = typeof input.body === "string" && input.body.trim().length > 0;
		if (hasContent) {
			if (typeof input.description !== "string" || input.description.trim().length === 0) {
				return { ok: false, reason: "a proposed skill needs a description" };
			}
			for (const file of input.files ?? []) {
				const fileError = validateProposalPath(file.path);
				if (fileError) return { ok: false, reason: fileError };
			}
		}

		this.ensureLayout();
		const proposalsDir = path.join(this.root, "proposals");
		const dir = this.uniqueChildDir(proposalsDir, input.name);
		assertInside(proposalsDir, dir);

		try {
			fs.mkdirSync(dir, { recursive: true });
			if (hasContent) {
				const scope: Scope = input.scope ?? "general";
				this.writeSkillFiles(
					path.join(dir, "skill"),
					buildSkillFrontmatter({ name: input.name, description: input.description as string, scope, files: (input.files ?? []).map((file) => file.path) }),
					input.body as string,
					input.files,
				);
			}
			const record = {
				kind: meta.kind ?? (hasContent ? "skill" : "archive"),
				name: input.name,
				scope: input.scope ? (input.scope === "general" ? "general" : input.scope.project) : undefined,
				reason: meta.reason,
				mode: meta.mode,
				created_at: meta.createdAt ?? new Date().toISOString(),
			};
			fs.writeFileSync(path.join(dir, "proposal.json"), `${JSON.stringify(record, null, 2)}\n`);
		} catch (error) {
			this.removeQuietly(dir);
			return { ok: false, reason: `proposal write failed: ${error instanceof Error ? error.message : String(error)}` };
		}
		return { ok: true, dir };
	}

	/** Read a skill's SKILL.md and list its payload files, for the store API. */
	readSkillContent(name: string): SkillContent | undefined {
		const skill = this.findByName(name);
		if (!skill) return undefined;
		let content: string;
		try {
			content = fs.readFileSync(skill.filePath, "utf8");
		} catch {
			return undefined;
		}
		const files = this.listFiles(skill.dir).filter((file) => file !== SKILL_FILE_NAME).sort();
		return { skill, content, files };
	}

	/**
	 * Resolve the content a patch would produce, without writing anything. Shared
	 * by {@link patch} and by observe-only, which proposes the result instead of
	 * applying it. Pins are enforced at apply time, so a pinned skill can still be
	 * *proposed* for a change.
	 */
	planPatch(name: string, changes: { description?: string; body?: string; files?: SkillFile[] }): PatchPlan {
		const existing = this.findByName(name);
		if (!existing) return { ok: false, reason: `no learned skill named "${name}"` };
		const current = this.readSkillContent(name);
		if (!current) return { ok: false, reason: `could not read "${name}"` };
		const parsed = parseFrontmatter(current.content);
		const body = changes.body ?? parsed.body;
		const description =
			changes.description ?? (typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : existing.description);
		const metadata = isPlainObject(parsed.frontmatter.metadata) ? parsed.frontmatter.metadata : existing.metadata;
		const files = changes.files ?? this.readPayloadFiles(existing.dir);

		if (description.trim().length === 0) return { ok: false, reason: "description must not be empty" };
		if (body.trim().length === 0) return { ok: false, reason: "body must not be empty" };
		for (const file of files) {
			const fileError = validatePayloadPath(file.path);
			if (fileError) return { ok: false, reason: fileError };
		}
		return { ok: true, input: { name, description, body, scope: existing.scope, metadata, files } };
	}

	/**
	 * Rewrite a skill in place, staged and published atomically. The previous
	 * directory is moved into `.archive/` first, so a patch is never destructive
	 * and can be reverted even before the curator's snapshots exist.
	 */
	patch(name: string, changes: { description?: string; body?: string; files?: SkillFile[] }): PublishResult {
		const existing = this.findByName(name);
		if (!existing) return { ok: false, reason: `no learned skill named "${name}"` };
		if (existing.pinned) return { ok: false, reason: `"${name}" is pinned and may not be patched` };

		const planned = this.planPatch(name, changes);
		if (!planned.ok) return { ok: false, reason: planned.reason };
		const { input } = planned;

		this.ensureLayout();
		const token = randomUUID();
		const stagingDir = path.join(this.stagingRoot, token, name);
		assertInside(this.stagingRoot, stagingDir);
		try {
			this.writeSkillFiles(
				stagingDir,
				buildSkillFrontmatter({ name: input.name, description: input.description, scope: input.scope, metadata: input.metadata, files: (input.files ?? []).map((file) => file.path), provenance: input.provenance }),
				input.body,
				input.files,
			);
		} catch (error) {
			this.removeQuietly(path.join(this.stagingRoot, token));
			return { ok: false, reason: `staging write failed: ${error instanceof Error ? error.message : String(error)}` };
		}

		const backup = this.uniqueChildDir(path.join(this.archiveRoot, ".backups"), name);
		try {
			fs.mkdirSync(path.join(this.archiveRoot, ".backups"), { recursive: true });
			fs.renameSync(existing.dir, backup);
			fs.renameSync(stagingDir, existing.dir);
		} catch (error) {
			try {
				if (!fs.existsSync(existing.dir) && fs.existsSync(backup)) fs.renameSync(backup, existing.dir);
			} catch {
				// Leave the backup in the archive; nothing was lost either way.
			}
			this.removeQuietly(path.join(this.stagingRoot, token));
			return { ok: false, reason: `patch failed: ${error instanceof Error ? error.message : String(error)}` };
		}

		this.removeQuietly(path.join(this.stagingRoot, token));
		const skill = this.readSkill(existing.dir, existing.scope);
		return skill ? { ok: true, skill } : { ok: false, reason: "patched skill could not be read back" };
	}

	/** Move a skill out of every surfaced path. Never deletes. */
	archive(name: string): ArchiveResult {
		const skill = this.findByName(name);
		if (!skill) return { ok: false, reason: `no learned skill named "${name}"` };
		if (skill.pinned) return { ok: false, reason: `"${name}" is pinned and may not be archived` };
		const target = this.uniqueChildDir(this.archiveRoot, name);
		assertInside(this.archiveRoot, target);
		try {
			fs.mkdirSync(this.archiveRoot, { recursive: true });
			fs.renameSync(skill.dir, target);
		} catch (error) {
			return { ok: false, reason: `archive failed: ${error instanceof Error ? error.message : String(error)}` };
		}
		return { ok: true, dir: target };
	}

	/** Copy a skill's directory into `destParent`, for the exact revert a merge needs. */
	snapshot(name: string, destParent: string): string | undefined {
		const skill = this.findByName(name);
		if (!skill) return undefined;
		const dest = path.join(destParent, name);
		assertInside(this.root, dest);
		assertInside(this.root, destParent);
		fs.mkdirSync(destParent, { recursive: true });
		fs.cpSync(skill.dir, dest, { recursive: true });
		return dest;
	}

	/** Create a fresh report directory under `reports/<timestamp>/`. */
	newReportDir(): string {
		this.ensureLayout();
		const reportsDir = path.join(this.root, "reports");
		const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
		const dir = this.uniqueChildDir(reportsDir, stamp);
		assertInside(reportsDir, dir);
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	}

	/** Write an audit record under `reports/<timestamp>/REPORT.md`. Returns its directory. */
	writeReport(content: string): string {
		const dir = this.newReportDir();
		fs.writeFileSync(path.join(dir, "REPORT.md"), content);
		return dir;
	}

	// -- operator surface (spec §4.8) -----------------------------------------

	proposalsDir(): string {
		return path.join(this.root, "proposals");
	}

	/** Every pending proposal, read back from its proposal.json. */
	listProposals(): PendingProposal[] {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(this.proposalsDir(), { withFileTypes: true });
		} catch {
			return [];
		}
		const pending: PendingProposal[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const proposal = this.readProposal(path.join(this.proposalsDir(), entry.name));
			if (proposal) pending.push(proposal);
		}
		return pending.sort((a, b) => a.record.name.localeCompare(b.record.name));
	}

	readProposal(dir: string): PendingProposal | undefined {
		assertInside(this.proposalsDir(), dir);
		let record: Record<string, unknown>;
		try {
			record = JSON.parse(fs.readFileSync(path.join(dir, "proposal.json"), "utf8"));
		} catch {
			return undefined;
		}
		if (!isPlainObject(record) || typeof record.name !== "string") return undefined;

		const skillDir = path.join(dir, "skill");
		let input: NewSkillInput | undefined;
		if (fs.existsSync(path.join(skillDir, SKILL_FILE_NAME))) {
			const { frontmatter, body } = parseFrontmatter(fs.readFileSync(path.join(skillDir, SKILL_FILE_NAME), "utf8"));
			input = {
				name: record.name,
				description: typeof frontmatter.description === "string" ? frontmatter.description : "",
				body,
				scope: parseScope(record.scope),
				files: this.readPayloadFiles(skillDir),
			};
		}

		return {
			dir,
			record: {
				kind: typeof record.kind === "string" ? record.kind : "skill",
				name: record.name,
				scope: typeof record.scope === "string" ? record.scope : undefined,
				reason: typeof record.reason === "string" ? record.reason : undefined,
				mode: typeof record.mode === "string" ? record.mode : undefined,
				created_at: typeof record.created_at === "string" ? record.created_at : undefined,
			},
			input,
		};
	}

	/** Remove a pending proposal. Proposals are decisions, not library content. */
	removeProposal(dir: string): void {
		if (!isInside(this.proposalsDir(), dir)) return;
		this.removeQuietly(dir);
	}

	/** Retired skills, read from the direct children of `.archive/`. */
	listArchived(): LearnedSkill[] {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(this.archiveRoot, { withFileTypes: true });
		} catch {
			return [];
		}
		const archived: LearnedSkill[] = [];
		for (const entry of entries) {
			// `.backups` (patch snapshots) is hidden and never a retired skill.
			if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
			const dir = path.join(this.archiveRoot, entry.name);
			if (!fs.existsSync(path.join(dir, SKILL_FILE_NAME))) continue;
			const skill = this.readSkill(dir, this.scopeFromFrontmatter(dir));
			if (skill) archived.push(skill);
		}
		return archived.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Bring an archived skill back to the scope its frontmatter names. */
	restore(name: string): ArchiveResult {
		const archived = this.listArchived().find((skill) => skill.name === name);
		if (!archived) return { ok: false, reason: `no archived skill named "${name}"` };

		let dest: string;
		try {
			dest = path.join(this.scopeDir(archived.scope), name);
		} catch (error) {
			return { ok: false, reason: error instanceof Error ? error.message : String(error) };
		}
		assertInside(this.root, dest);
		if (fs.existsSync(dest)) return { ok: false, reason: `a skill named "${name}" is already live` };

		try {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.renameSync(archived.dir, dest);
		} catch (error) {
			return { ok: false, reason: `restore failed: ${error instanceof Error ? error.message : String(error)}` };
		}
		return { ok: true, dir: dest };
	}

	/** Move a learned skill to another scope, updating its frontmatter mirror. */
	moveToScope(name: string, scope: Scope): PublishResult {
		const skill = this.findByName(name);
		if (!skill) return { ok: false, reason: `no learned skill named "${name}"` };

		let dest: string;
		try {
			dest = path.join(this.scopeDir(scope), name);
		} catch (error) {
			return { ok: false, reason: error instanceof Error ? error.message : String(error) };
		}
		assertInside(this.root, dest);
		if (dest === skill.dir) return { ok: true, skill };
		if (fs.existsSync(dest)) return { ok: false, reason: `a skill named "${name}" already exists in that scope` };

		try {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.renameSync(skill.dir, dest);
		} catch (error) {
			return { ok: false, reason: `promotion failed: ${error instanceof Error ? error.message : String(error)}` };
		}

		const moved = this.readSkill(dest, scope);
		if (!moved) return { ok: false, reason: "moved skill could not be read back" };
		this.rewriteFrontmatter(moved, { scope: scope === "general" ? "general" : scope.project });
		const updated = this.readSkill(dest, scope);
		return updated ? { ok: true, skill: updated } : { ok: false, reason: "moved skill could not be read back" };
	}

	/** Pin or unpin a skill by rewriting its frontmatter, the durable source. */
	setPinned(name: string, pinned: boolean): { ok: true } | { ok: false; reason: string } {
		const skill = this.findByName(name);
		if (!skill) return { ok: false, reason: `no learned skill named "${name}"` };
		try {
			this.rewriteFrontmatter(skill, { pinned });
		} catch (error) {
			return { ok: false, reason: `pin failed: ${error instanceof Error ? error.message : String(error)}` };
		}
		return { ok: true };
	}

	/**
	 * One-way tier promotion: copy a skill into the human tier with the learned
	 * metadata stripped. The learned copy is left for the caller to archive.
	 */
	exportToHuman(name: string, humanSkillsDir: string): { ok: true; dir: string } | { ok: false; reason: string } {
		const skill = this.findByName(name);
		if (!skill) return { ok: false, reason: `no learned skill named "${name}"` };
		const dest = path.join(humanSkillsDir, name);
		if (this.reservedNames.has(name) || fs.existsSync(dest)) {
			return { ok: false, reason: `the human tier already has a skill named "${name}"` };
		}

		try {
			fs.mkdirSync(humanSkillsDir, { recursive: true });
			fs.cpSync(skill.dir, dest, { recursive: true });
			const file = path.join(dest, SKILL_FILE_NAME);
			const { frontmatter, body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
			fs.writeFileSync(file, serializeFrontmatter({ name, description: frontmatter.description }, body));
		} catch (error) {
			this.removeQuietly(dest);
			return { ok: false, reason: `promotion to the human tier failed: ${error instanceof Error ? error.message : String(error)}` };
		}
		return { ok: true, dir: dest };
	}

	// -- internals ------------------------------------------------------------

	private validateName(name: string): string | undefined {
		if (!isValidSkillName(name)) {
			return `invalid skill name "${name}" (lowercase letters, digits and single hyphens, max ${MAX_SKILL_NAME_LENGTH})`;
		}
		if (this.reservedNames.has(name)) {
			return `name "${name}" already exists in the human skill tier`;
		}
		if (this.findByName(name)) {
			return `name "${name}" already exists in the learned store`;
		}
		return undefined;
	}

	private *scanSkillDirs(scope?: Scope): Iterable<{ dir: string; scope: Scope }> {
		const scopes: Scope[] = [];
		if (scope === undefined) {
			scopes.push("general");
			for (const segment of this.listProjectSegments()) {
				try {
					scopes.push({ project: decodeScopeKey(segment) });
				} catch {
					// A directory whose name is not a scope key is not ours.
				}
			}
		} else if (scope === "general") {
			scopes.push("general");
		} else {
			// A project scope is the union of general and that project, matching
			// `skillPaths` and therefore what pi actually loads. Scanning only the
			// project directory under-reported whenever a session was project-scoped.
			scopes.push("general", scope);
		}

		for (const current of scopes) {
			const dir = this.scopeDir(current);
			let entries: fs.Dirent[];
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const skillDir = path.join(dir, entry.name);
				if (!fs.existsSync(path.join(skillDir, SKILL_FILE_NAME))) continue;
				yield { dir: skillDir, scope: current };
			}
		}
	}

	private listProjectSegments(): string[] {
		try {
			return fs
				.readdirSync(this.projectsDir(), { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name);
		} catch {
			return [];
		}
	}

	private readSkill(dir: string, fallbackScope: Scope): LearnedSkill | undefined {
		const filePath = path.join(dir, SKILL_FILE_NAME);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf8");
		} catch {
			return undefined;
		}
		const { frontmatter } = parseFrontmatter(content);
		const metadata = isPlainObject(frontmatter.metadata) ? frontmatter.metadata : {};
		const name = typeof frontmatter.name === "string" && frontmatter.name.trim().length > 0 ? frontmatter.name.trim() : path.basename(dir);
		const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
		return {
			name,
			description,
			scope: fallbackScope,
			dir,
			filePath,
			metadata,
			pinned: metadata.pinned === true,
		};
	}

	/** Rewrite a skill's frontmatter in place, atomically, keeping the body. */
	private rewriteFrontmatter(skill: LearnedSkill, patch: Record<string, unknown>): void {
		const { frontmatter, body } = parseFrontmatter(fs.readFileSync(skill.filePath, "utf8"));
		const metadata = { ...(isPlainObject(frontmatter.metadata) ? frontmatter.metadata : {}), ...patch };
		const temp = `${skill.filePath}.${process.pid}.tmp`;
		fs.writeFileSync(temp, serializeFrontmatter({ ...frontmatter, metadata }, body));
		fs.renameSync(temp, skill.filePath);
	}

	/** The scope an archived skill's frontmatter names; defaults to general. */
	private scopeFromFrontmatter(dir: string): Scope {
		try {
			const { frontmatter } = parseFrontmatter(fs.readFileSync(path.join(dir, SKILL_FILE_NAME), "utf8"));
			const scope = isPlainObject(frontmatter.metadata) ? frontmatter.metadata.scope : undefined;
			if (typeof scope === "string" && scope !== "general") return { project: scope };
		} catch {
			// Fall through to general.
		}
		return "general";
	}

	private writeSkillFiles(dir: string, frontmatter: Record<string, unknown>, body: string, files: readonly SkillFile[] | undefined): void {
		assertInside(this.root, dir);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, SKILL_FILE_NAME), serializeFrontmatter(frontmatter, body));
		for (const file of files ?? []) {
			const target = path.join(dir, file.path);
			assertInside(dir, target);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, file.content);
		}
	}

	/** Relative paths of every non-hidden file beneath `dir`, recursively. */
	private listFiles(dir: string, prefix = ""): string[] {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(path.join(dir, prefix), { withFileTypes: true });
		} catch {
			return [];
		}
		const files: string[] = [];
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) files.push(...this.listFiles(dir, relative));
			else if (entry.isFile()) files.push(relative);
		}
		return files;
	}

	private readPayloadFiles(dir: string): SkillFile[] {
		const files: SkillFile[] = [];
		for (const relative of this.listFiles(dir)) {
			if (relative === SKILL_FILE_NAME) continue;
			try {
				files.push({ path: relative, content: fs.readFileSync(path.join(dir, relative), "utf8") });
			} catch {
				// Unreadable payloads are omitted from a patch rather than fatal.
			}
		}
		return files;
	}

	/** A child directory that does not collide: `<name>`, then `<name>-<stamp>`, then a token. */
	private uniqueChildDir(parent: string, name: string): string {
		const base = path.join(parent, name);
		assertInside(parent, base);
		if (!fs.existsSync(base)) return base;
		const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
		const dated = path.join(parent, `${name}-${stamp}`);
		if (!fs.existsSync(dated)) return dated;
		return path.join(parent, `${name}-${randomUUID().slice(0, 8)}`);
	}

	private removeQuietly(target: string): void {
		try {
			fs.rmSync(target, { recursive: true, force: true });
		} catch {
			// A staging entry that cannot be removed is swept on the next pass.
		}
	}
}

/**
 * Reject a payload path that could write outside the skill directory or into a
 * place pi would treat as another skill. Payloads live under `scripts/`,
 * `references/` or `assets/`, contain no dot-directories, and are files.
 */
export function validatePayloadPath(relative: string): string | undefined {
	if (relative.trim().length === 0) return "payload path must not be empty";
	if (path.isAbsolute(relative) || relative.includes("\\")) {
		return `payload path must be relative: ${relative}`;
	}
	const segments = relative.split("/");
	if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
		return `payload path contains an empty or traversing segment: ${relative}`;
	}
	if (segments.some((segment) => segment.startsWith("."))) {
		return `payload path may not contain dotfiles: ${relative}`;
	}
	const [top] = segments;
	if (!PAYLOAD_DIRS.has(top)) {
		return `payload path must live under scripts/, references/ or assets/: ${relative}`;
	}
	if (segments.length < 2) return `payload path must name a file under a payload directory: ${relative}`;
	return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a proposal's recorded scope back into a {@link Scope}. */
function parseScope(value: unknown): Scope {
	if (typeof value === "string" && value !== "general") return { project: value };
	return "general";
}

/**
 * A payload path destined for a proposal rather than the live store. Looser than
 * {@link validatePayloadPath} on purpose: an out-of-whitelist file is exactly
 * what a proposal exists to carry, so only traversal, dotfiles and absolute
 * paths are refused here.
 */
export function validateProposalPath(relative: string): string | undefined {
	if (relative.trim().length === 0) return "payload path must not be empty";
	if (path.isAbsolute(relative) || relative.includes("\\")) return `payload path must be relative: ${relative}`;
	const segments = relative.split("/");
	if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
		return `payload path contains an empty or traversing segment: ${relative}`;
	}
	if (segments.some((segment) => segment.startsWith("."))) return `payload path may not contain dotfiles: ${relative}`;
	return undefined;
}
