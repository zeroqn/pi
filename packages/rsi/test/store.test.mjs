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
