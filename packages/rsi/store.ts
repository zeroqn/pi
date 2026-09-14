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

export interface ProposalMeta {
	reason: string;
	kind?: string;
	mode?: string;
	createdAt?: string;
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

/** The frontmatter a learned skill ships with; shared by every write path. */
export function buildSkillFrontmatter(input: {
	name: string;
	description: string;
	scope: Scope;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	/** Payload paths the skill ships, declared in frontmatter so a reader sees them. */
	files?: readonly string[];
}): Record<string, unknown> {
	const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
	metadata.origin = "learned";
	if (typeof metadata.created_at !== "string") {
		metadata.created_at = input.createdAt ?? new Date().toISOString();
	}
	metadata.scope = input.scope === "general" ? "general" : input.scope.project;
	if (input.files && input.files.length > 0) metadata.files = [...input.files];
	return { name: input.name, description: input.description, metadata };
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
			this.writeSkillFiles(stagingDir, buildSkillFrontmatter({ name: input.name, description: input.description, scope: input.scope, metadata: input.metadata, files: (input.files ?? []).map((file) => file.path) }), input.body, input.files);
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
	propose(input: NewSkillInput, meta: ProposalMeta): ProposeResult {
		if (!isValidSkillName(input.name)) return { ok: false, reason: `invalid skill name "${input.name}"` };
		if (input.description.trim().length === 0) return { ok: false, reason: "description must not be empty" };
		if (input.body.trim().length === 0) return { ok: false, reason: "body must not be empty" };
		for (const file of input.files ?? []) {
			const fileError = validateProposalPath(file.path);
			if (fileError) return { ok: false, reason: fileError };
		}

		this.ensureLayout();
		const proposalsDir = path.join(this.root, "proposals");
		const dir = this.uniqueChildDir(proposalsDir, input.name);
		assertInside(proposalsDir, dir);

		try {
			this.writeSkillFiles(path.join(dir, "skill"), buildSkillFrontmatter({ name: input.name, description: input.description, scope: input.scope, metadata: input.metadata, files: (input.files ?? []).map((file) => file.path) }), input.body, input.files);
			const record = {
				kind: meta.kind ?? "skill",
				name: input.name,
				scope: input.scope === "general" ? "general" : input.scope.project,
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
	 * Rewrite a skill in place, staged and published atomically. The previous
	 * directory is moved into `.archive/` first, so a patch is never destructive
	 * and can be reverted even before the curator's snapshots exist.
	 */
	patch(name: string, changes: { description?: string; body?: string; files?: SkillFile[] }): PublishResult {
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

		this.ensureLayout();
		const token = randomUUID();
		const stagingDir = path.join(this.stagingRoot, token, name);
		assertInside(this.stagingRoot, stagingDir);
		try {
			this.writeSkillFiles(stagingDir, buildSkillFrontmatter({ name, description, scope: existing.scope, metadata, files: files.map((file) => file.path) }), body, files);
		} catch (error) {
			this.removeQuietly(path.join(this.stagingRoot, token));
			return { ok: false, reason: `staging write failed: ${error instanceof Error ? error.message : String(error)}` };
		}

		const backup = this.uniqueChildDir(this.archiveRoot, name);
		try {
			fs.mkdirSync(this.archiveRoot, { recursive: true });
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

	/** Write an audit record under `reports/<timestamp>/REPORT.md`. Returns its directory. */
	writeReport(content: string): string {
		this.ensureLayout();
		const reportsDir = path.join(this.root, "reports");
		const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
		const dir = this.uniqueChildDir(reportsDir, stamp);
		assertInside(reportsDir, dir);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "REPORT.md"), content);
		return dir;
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
		} else {
			scopes.push(scope);
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
