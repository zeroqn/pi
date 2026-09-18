import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { isValidSkillName, SkillStore, validatePayloadPath } from "../store.ts";
import { isInside } from "../paths.ts";

function tempStore(t, options = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-store-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return new SkillStore({ root, ...options });
}

function basic(name, scope = "general") {
	return { name, description: `${name} description`, scope, body: `## How\n\nDo ${name}.\n` };
}

// ---------------------------------------------------------------------------
// Name rules and uniqueness — a learned name that collides loads nothing at
// all, so creation is refused rather than shadowed.
// ---------------------------------------------------------------------------

test("isValidSkillName follows the Agent Skills name rules", () => {
	assert.equal(isValidSkillName("use-git-worktrees"), true);
	assert.equal(isValidSkillName("a"), true);
	assert.equal(isValidSkillName("PDF-Processing"), false);
	assert.equal(isValidSkillName("-leading"), false);
	assert.equal(isValidSkillName("trailing-"), false);
	assert.equal(isValidSkillName("double--hyphen"), false);
	assert.equal(isValidSkillName("under_score"), false);
	assert.equal(isValidSkillName(""), false);
	assert.equal(isValidSkillName("x".repeat(65)), false);
});

test("create writes a general skill with learned provenance", (t) => {
	const store = tempStore(t);
	const result = store.create(basic("use-git-worktrees"));
	assert.equal(result.ok, true);
	const file = path.join(store.root, "skills", "general", "use-git-worktrees", "SKILL.md");
	assert.equal(fs.existsSync(file), true);

	const skill = store.findByName("use-git-worktrees");
	assert.ok(skill);
	assert.equal(skill.scope, "general");
	assert.equal(skill.description, "use-git-worktrees description");
	assert.equal(skill.metadata.origin, "learned");
	assert.equal(skill.metadata.scope, "general");
	assert.equal(typeof skill.metadata.created_at, "string");
	assert.equal(skill.pinned, false);
});

test("a name already in the human tier is refused", (t) => {
	const store = tempStore(t, { reservedNames: ["tdd"] });
	const result = store.create(basic("tdd"));
	assert.equal(result.ok, false);
	assert.match(result.reason, /human skill tier/);
	assert.equal(store.findByName("tdd"), undefined);
});

test("a name is unique across the whole store, not just its scope", (t) => {
	const store = tempStore(t);
	assert.equal(store.create(basic("shared-name", "general")).ok, true);
	const collision = store.create(basic("shared-name", { project: "github.com/acme/app" }));
	assert.equal(collision.ok, false);
	assert.match(collision.reason, /learned store/);
});

test("an invalid name is refused before anything is written", (t) => {
	const store = tempStore(t);
	const result = store.create(basic("Not Valid"));
	assert.equal(result.ok, false);
	assert.match(result.reason, /invalid skill name/);
	assert.equal(fs.existsSync(path.join(store.root, "skills", "general")), false);
});

// ---------------------------------------------------------------------------
// Scopes — only the current scope plus general may be surfaced.
// ---------------------------------------------------------------------------

test("project skills live under their key and never in general", (t) => {
	const store = tempStore(t);
	const scope = { project: "github.com/acme/app" };
	assert.equal(store.create(basic("acme-deploy", scope)).ok, true);

	const projectDir = store.scopeDir(scope);
	assert.equal(projectDir.startsWith(store.projectsDir()), true);
	assert.equal(fs.existsSync(path.join(projectDir, "acme-deploy", "SKILL.md")), true);
	assert.equal(fs.existsSync(path.join(store.generalDir(), "acme-deploy")), false);

	const skill = store.findByName("acme-deploy");
	assert.ok(skill);
	assert.deepEqual(skill.scope, scope);
});

test("skillPaths surfaces general plus the current project scope only", (t) => {
	const store = tempStore(t);
	assert.equal(store.create(basic("general-skill")).ok, true);
	assert.equal(store.create(basic("app-skill", { project: "github.com/acme/app" })).ok, true);
	assert.equal(store.create(basic("other-skill", { project: "github.com/acme/other" })).ok, true);

	assert.deepEqual(store.skillPaths("general"), [store.generalDir()]);
	const appPaths = store.skillPaths({ project: "github.com/acme/app" });
	assert.equal(appPaths.includes(store.generalDir()), true);
	assert.equal(appPaths.includes(store.scopeDir({ project: "github.com/acme/app" })), true);
	assert.equal(appPaths.includes(store.scopeDir({ project: "github.com/acme/other" })), false);
});

test("skillPaths omits paths that do not exist yet", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-store-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const store = new SkillStore({ root });
	assert.deepEqual(store.skillPaths("general"), []);
	assert.deepEqual(store.skillPaths({ project: "github.com/acme/app" }), []);
});

// ---------------------------------------------------------------------------
// Staged writes — a pass killed mid-write must leave staging garbage, never a
// half-written skill in the live tree.
// ---------------------------------------------------------------------------

test("stage writes to staging and publish moves it in one rename", (t) => {
	const store = tempStore(t);
	const staged = store.stage(basic("staged-skill"));
	assert.equal(staged.ok, true);
	const { dir, dest } = staged.staged;

	assert.equal(fs.existsSync(dir), true);
	assert.equal(fs.existsSync(path.join(dir, "SKILL.md")), true);
	assert.equal(isInside(store.stagingRoot, dir), true);
	assert.equal(fs.existsSync(dest), false, "dest must not exist before publish");

	const published = store.publish(staged.staged);
	assert.equal(published.ok, true);
	assert.equal(fs.existsSync(path.join(dest, "SKILL.md")), true);
	assert.deepEqual(fs.readdirSync(store.stagingRoot), [], "token directory is cleaned up");
});

test("a staged-but-never-published skill is swept and never appears", (t) => {
	const store = tempStore(t);
	const staged = store.stage(basic("orphan-skill"));
	assert.equal(staged.ok, true);
	assert.equal(fs.existsSync(staged.staged.dest), false);

	assert.equal(store.sweepStaging(), 1);
	assert.deepEqual(fs.readdirSync(store.stagingRoot), []);
	assert.equal(store.findByName("orphan-skill"), undefined);
});

test("publish refuses a destination that appeared after staging", (t) => {
	const store = tempStore(t);
	const staged = store.stage(basic("racy-skill"));
	assert.equal(staged.ok, true);

	// Another writer won the name between stage and publish.
	assert.equal(store.create(basic("racy-skill")).ok, true);

	const published = store.publish(staged.staged);
	assert.equal(published.ok, false);
	assert.match(published.reason, /already exists/);
	assert.deepEqual(fs.readdirSync(store.stagingRoot), []);
});

test("create leaves no staging behind on success or refusal", (t) => {
	const store = tempStore(t);
	assert.equal(store.create(basic("clean-skill")).ok, true);
	assert.deepEqual(fs.readdirSync(store.stagingRoot), []);
	assert.equal(store.create(basic("clean-skill")).ok, false);
	assert.deepEqual(fs.readdirSync(store.stagingRoot), []);
});

// ---------------------------------------------------------------------------
// Payloads and containment — nothing may be written outside the store, and a
// payload may not become a second skill or a dotfile.
// ---------------------------------------------------------------------------

test("create writes whitelisted payload files inside the skill directory", (t) => {
	const store = tempStore(t);
	const result = store.create({
		...basic("script-skill"),
		files: [
			{ path: "scripts/run.sh", content: "#!/bin/sh\necho ok\n" },
			{ path: "references/notes.md", content: "# Notes\n" },
			{ path: "assets/data.json", content: "{}\n" },
		],
	});
	assert.equal(result.ok, true);
	const dir = result.skill.dir;
	assert.equal(fs.readFileSync(path.join(dir, "scripts", "run.sh"), "utf8"), "#!/bin/sh\necho ok\n");
	assert.equal(fs.existsSync(path.join(dir, "references", "notes.md")), true);
	assert.equal(fs.existsSync(path.join(dir, "assets", "data.json")), true);
});

test("create refuses payloads that escape or impersonate a skill", (t) => {
	const store = tempStore(t);
	const attempts = [
		{ path: "../escape.sh", content: "x" },
		{ path: "scripts/../../escape.sh", content: "x" },
		{ path: "/tmp/escape.sh", content: "x" },
		{ path: "SKILL.md", content: "x" },
		{ path: "scripts/.hidden", content: "x" },
		{ path: "scripts/", content: "x" },
	];
	for (const file of attempts) {
		const result = store.create({ ...basic("payload-skill"), files: [file] });
		assert.equal(result.ok, false, `expected refusal for ${file.path}`);
	}
	assert.equal(store.findByName("payload-skill"), undefined);
	assert.equal(fs.existsSync(path.join(store.root, "..", "escape.sh")), false);
});

test("validatePayloadPath accepts only paths under the payload directories", () => {
	assert.equal(validatePayloadPath("scripts/run.sh"), undefined);
	assert.equal(validatePayloadPath("references/notes.md"), undefined);
	assert.equal(validatePayloadPath("assets/data.json"), undefined);
	assert.match(validatePayloadPath("run.sh"), /scripts\/, references\/ or assets\//);
	assert.match(validatePayloadPath("scripts/../x"), /traversing/);
	assert.match(validatePayloadPath("/abs.sh"), /must be relative/);
});

test("everything the store writes stays inside the store root", (t) => {
	const store = tempStore(t);
	store.ensureLayout();
	store.create(basic("inside-skill"));
	store.create({ ...basic("scoped-skill", { project: "github.com/acme/app" }), files: [{ path: "scripts/x.sh", content: "x" }] });

	const offenders = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (!isInside(store.root, full)) offenders.push(full);
			if (entry.isDirectory()) walk(full);
		}
	};
	walk(store.root);
	assert.deepEqual(offenders, []);
});

test("ensureLayout creates the documented directories and ledger", (t) => {
	const store = tempStore(t);
	store.ensureLayout();
	for (const dir of ["skills/general", "skills/projects", "proposals", ".archive", ".staging", "reports"]) {
		assert.equal(fs.statSync(path.join(store.root, dir)).isDirectory(), true, dir);
	}
	assert.equal(fs.existsSync(path.join(store.root, "index.json")), true);
});

// ---------------------------------------------------------------------------
// Proposals, patches and retirement — the store API's other write paths.
// ---------------------------------------------------------------------------

test("propose writes a reviewable directory and leaves the live store empty", (t) => {
	const store = tempStore(t);
	const result = store.propose(
		{ ...basic("held-skill"), files: [{ path: "scripts/run.sh", content: "#!/bin/sh\ntrue\n" }] },
		{ reason: "ships a script", mode: "write" },
	);
	assert.equal(result.ok, true);

	assert.equal(fs.existsSync(path.join(result.dir, "skill", "SKILL.md")), true);
	assert.equal(fs.existsSync(path.join(result.dir, "skill", "scripts", "run.sh")), true);
	const record = JSON.parse(fs.readFileSync(path.join(result.dir, "proposal.json"), "utf8"));
	assert.equal(record.name, "held-skill");
	assert.equal(record.reason, "ships a script");
	assert.equal(record.mode, "write");
	assert.equal(store.findByName("held-skill"), undefined, "a proposal is not a live skill");
});

test("readSkillContent returns the document and its payload paths", (t) => {
	const store = tempStore(t);
	store.create({ ...basic("readable-skill"), files: [{ path: "references/notes.md", content: "# Notes\n" }] });

	const found = store.readSkillContent("readable-skill");
	assert.ok(found);
	assert.match(found.content, /name: "readable-skill"/);
	assert.deepEqual(found.files, ["references/notes.md"]);
	assert.deepEqual(store.findByName("readable-skill").metadata.files, ["references/notes.md"], "frontmatter declares the payload");
	assert.equal(store.readSkillContent("missing"), undefined);
});

test("patch rewrites a skill and keeps the previous directory in the archive", (t) => {
	const store = tempStore(t);
	const created = store.create(basic("patchable-skill"));
	assert.equal(created.ok, true);
	const createdAt = store.findByName("patchable-skill").metadata.created_at;

	const patched = store.patch("patchable-skill", { description: "updated description", body: "## How\n\nNew body.\n" });
	assert.equal(patched.ok, true);

	const skill = store.findByName("patchable-skill");
	assert.equal(skill.description, "updated description");
	assert.equal(skill.metadata.created_at, createdAt, "created_at survives a patch");
	assert.match(fs.readFileSync(skill.filePath, "utf8"), /New body\./);

	const archived = fs.readdirSync(store.archiveRoot);
	assert.equal(archived.length, 1, "the old directory is preserved, not deleted");
});

test("archive moves a skill out of every surfaced path", (t) => {
	const store = tempStore(t);
	const created = store.create(basic("retire-me"));
	assert.equal(created.ok, true);

	const result = store.archive("retire-me");
	assert.equal(result.ok, true);
	assert.equal(fs.existsSync(result.dir), true);
	assert.equal(store.findByName("retire-me"), undefined);
	assert.equal(fs.existsSync(path.join(store.generalDir(), "retire-me")), false);
	assert.equal(store.archive("retire-me").ok, false, "archiving again is refused");
});

test("writeReport writes an audit record under reports", (t) => {
	const store = tempStore(t);
	const dir = store.writeReport("# report\n");
	assert.equal(isInside(path.join(store.root, "reports"), dir), true);
	assert.equal(fs.readFileSync(path.join(dir, "REPORT.md"), "utf8"), "# report\n");
});

test("patch and archive refuse a pinned skill", (t) => {
	const store = tempStore(t);
	store.create({ ...basic("pinned-skill"), metadata: { pinned: true } });
	assert.equal(store.findByName("pinned-skill").pinned, true);

	assert.equal(store.patch("pinned-skill", { body: "## How\n\nnew\n" }).ok, false);
	assert.equal(store.archive("pinned-skill").ok, false);
	assert.equal(store.findByName("pinned-skill").pinned, true);
});

test("snapshot copies a skill's directory for an exact revert", (t) => {
	const store = tempStore(t);
	store.create({ ...basic("snap-me"), files: [{ path: "references/a.md", content: "a" }] });

	const snapshots = path.join(store.root, "reports", "20260914-000000", "snapshots");
	const dir = store.snapshot("snap-me", snapshots);
	assert.equal(dir, path.join(snapshots, "snap-me"));
	assert.equal(fs.existsSync(path.join(dir, "SKILL.md")), true);
	assert.equal(fs.existsSync(path.join(dir, "references", "a.md")), true);
	assert.equal(store.snapshot("missing", snapshots), undefined);
});

test("humanTierNames exposes the reserved names for a pass to avoid", (t) => {
	const store = tempStore(t, { reservedNames: ["tdd", "code-review"] });
	assert.deepEqual(store.humanTierNames().sort(), ["code-review", "tdd"]);
});

test("planPatch resolves the merged content without writing", (t) => {
	const store = tempStore(t);
	store.create({ ...basic("planned-skill"), files: [{ path: "references/a.md", content: "a" }] });

	const plan = store.planPatch("planned-skill", { body: "## How\n\nmerged\n" });
	assert.equal(plan.ok, true);
	assert.equal(plan.input.description, "planned-skill description");
	assert.deepEqual(plan.input.files, [{ path: "references/a.md", content: "a" }]);
	assert.equal(store.findByName("planned-skill").scope, "general");
	assert.match(fs.readFileSync(store.findByName("planned-skill").filePath, "utf8"), /Do planned-skill/, "nothing was written");
	assert.match(store.planPatch("missing", {}).reason, /no learned skill/);
});

test("setPinned rewrites frontmatter, the durable source", (t) => {
	const store = tempStore(t);
	store.create(basic("pin-me"));
	assert.equal(store.findByName("pin-me").pinned, false);

	assert.equal(store.setPinned("pin-me", true).ok, true);
	assert.equal(store.findByName("pin-me").pinned, true);
	assert.equal(store.setPinned("pin-me", false).ok, true);
	assert.equal(store.findByName("pin-me").pinned, false);
	assert.equal(store.setPinned("missing", true).ok, false);
});

test("moveToScope promotes a project skill to general, frontmatter included", (t) => {
	const store = tempStore(t);
	store.create(basic("promote-me", { project: "github.com/acme/app" }));

	const result = store.moveToScope("promote-me", "general");
	assert.equal(result.ok, true);
	assert.equal(result.skill.scope, "general");
	assert.equal(result.skill.dir.startsWith(store.generalDir()), true);
	assert.equal(result.skill.metadata.scope, "general");
	assert.equal(store.findByName("promote-me").scope, "general");
});

test("archive then restore round-trips a skill to its original scope", (t) => {
	const store = tempStore(t);
	store.create(basic("round-trip", { project: "github.com/acme/app" }));

	assert.equal(store.archive("round-trip").ok, true);
	const archived = store.listArchived();
	assert.deepEqual(archived.map((skill) => skill.name), ["round-trip"]);
	assert.deepEqual(archived[0].scope, { project: "github.com/acme/app" });
	assert.equal(store.findByName("round-trip"), undefined);

	const restored = store.restore("round-trip");
	assert.equal(restored.ok, true);
	assert.equal(store.findByName("round-trip").scope.project, "github.com/acme/app");
	assert.deepEqual(store.listArchived(), []);

	assert.equal(store.restore("round-trip").ok, false, "nothing left to restore");
});

test("restore refuses when a live skill already holds the name", (t) => {
	const store = tempStore(t);
	store.create(basic("dupe"));
	store.archive("dupe");
	store.create(basic("dupe"));
	assert.equal(store.restore("dupe").ok, false);
});

test("patch backups live in a hidden backups dir, not among retired skills", (t) => {
	const store = tempStore(t);
	store.create(basic("backed-up"));
	store.patch("backed-up", { body: "## How\n\nnew\n" });
	assert.deepEqual(fs.readdirSync(store.archiveRoot), [".backups"]);
	assert.deepEqual(store.listArchived(), [], "a patch backup is not a retired skill");
});

test("listProposals reads content and operation proposals, and removeProposal discards", (t) => {
	const store = tempStore(t);
	store.propose({ name: "content-proposal", description: "D.", body: "## How\n\nx\n", scope: "general", files: [{ path: "references/a.md", content: "a" }] }, { kind: "skill", reason: "observe-only mode" });
	store.propose({ name: "archive-proposal" }, { kind: "archive", reason: "observe-only mode" });

	const pending = store.listProposals();
	assert.deepEqual(pending.map((p) => p.record.name), ["archive-proposal", "content-proposal"]);
	const content = pending.find((p) => p.record.name === "content-proposal");
	assert.equal(content.input.description, "D.");
	assert.equal(content.input.body, "## How\n\nx");
	assert.deepEqual(content.input.files, [{ path: "references/a.md", content: "a" }]);
	const operation = pending.find((p) => p.record.name === "archive-proposal");
	assert.equal(operation.input, undefined);

	store.removeProposal(content.dir);
	assert.deepEqual(store.listProposals().map((p) => p.record.name), ["archive-proposal"]);
});

test("exportToHuman strips the learned metadata and refuses a collision", (t) => {
	const store = tempStore(t);
	store.create({ ...basic("to-human"), metadata: { pinned: true } });
	const humanDir = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-human-"));
	t.after(() => fs.rmSync(humanDir, { recursive: true, force: true }));

	const result = store.exportToHuman("to-human", humanDir);
	assert.equal(result.ok, true);
	const copy = fs.readFileSync(path.join(result.dir, "SKILL.md"), "utf8");
	assert.doesNotMatch(copy, /metadata:/);
	assert.match(copy, /description: "to-human description"/);
	assert.equal(store.findByName("to-human") !== undefined, true, "the learned copy remains for the caller to archive");

	assert.equal(store.exportToHuman("to-human", humanDir).ok, false, "the human tier now owns the name");
});

// ---------------------------------------------------------------------------
// Scope resolution — listSkills and skillPaths must agree, because pi loads what
// skillPaths returns and the seam serves what listSkills finds. They disagreed:
// listSkills(project) scanned only the project directory, so a project-scoped
// session was told about fewer skills than pi had actually loaded.
// ---------------------------------------------------------------------------

test("listSkills(project) is the union of general and that project", (t) => {
	const store = tempStore(t);
	assert.equal(store.create(basic("general-skill")).ok, true);
	assert.equal(store.create(basic("app-skill", { project: "github.com/acme/app" })).ok, true);
	assert.equal(store.create(basic("other-skill", { project: "github.com/acme/other" })).ok, true);

	const app = store.listSkills({ project: "github.com/acme/app" }).map((skill) => skill.name);
	assert.deepEqual(app, ["app-skill", "general-skill"]);
	assert.equal(store.findByName("general-skill", { project: "github.com/acme/app" })?.name, "general-skill");

	// general alone sees only general, and every scope sees everything.
	assert.deepEqual(store.listSkills("general").map((skill) => skill.name), ["general-skill"]);
	assert.deepEqual(store.listSkills().map((skill) => skill.name), ["app-skill", "general-skill", "other-skill"]);
});

test("what listSkills resolves for a scope is what skillPaths surfaces", (t) => {
	const store = tempStore(t);
	store.create(basic("general-skill"));
	store.create(basic("app-skill", { project: "github.com/acme/app" }));
	const scope = { project: "github.com/acme/app" };

	const listed = store.listSkills(scope).map((skill) => path.dirname(skill.dir));
	for (const dir of listed) {
		assert.equal(
			store.skillPaths(scope).some((surfaced) => dir === surfaced || dir.startsWith(`${surfaced}${path.sep}`)),
			true,
			`${dir} is listed but not surfaced to pi`,
		);
	}
});
