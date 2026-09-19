import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { discoverSkillNames, parseFrontmatter, serializeFrontmatter } from "../frontmatter.ts";

// ---------------------------------------------------------------------------
// parseFrontmatter — a learned skill must be recognisable from the file alone.
// The store reads names, descriptions and provenance out of frontmatter, so the
// parser has to handle both what we write and a hand-placed fixture.
// ---------------------------------------------------------------------------

test("parseFrontmatter reads flat keys, nested metadata and the body", () => {
	const content = [
		"---",
		'name: "use-git-worktrees"',
		'description: "Isolate parallel agent work in git worktrees."',
		"metadata:",
		'  origin: "learned"',
		'  created_at: "2026-09-14T00:00:00.000Z"',
		'  scope: "github.com/earendil-works/pi"',
		"  pinned: false",
		"---",
		"",
		"## When this applies",
		"Work happens in parallel.",
	].join("\n");

	const { frontmatter, body } = parseFrontmatter(content);
	assert.equal(frontmatter.name, "use-git-worktrees");
	assert.equal(frontmatter.description, "Isolate parallel agent work in git worktrees.");
	const metadata = frontmatter.metadata;
	assert.equal(metadata.origin, "learned");
	assert.equal(metadata.scope, "github.com/earendil-works/pi");
	assert.equal(metadata.pinned, false);
	assert.match(body, /^## When this applies/);
});

test("parseFrontmatter returns the whole document when there is no block", () => {
	const { frontmatter, body } = parseFrontmatter("# Just markdown\n");
	assert.deepEqual(frontmatter, {});
	assert.equal(body, "# Just markdown\n");
});

test("parseFrontmatter strips an empty frontmatter block", () => {
	const { frontmatter, body } = parseFrontmatter("---\n---\nbody\n");
	assert.deepEqual(frontmatter, {});
	assert.equal(body, "body");
});

test("parseFrontmatter handles quoted values containing YAML-significant text", () => {
	const content = '---\ndescription: "Use a:b and #hash — safely"\nmetadata:\n  scope: "general"\n---\nbody\n';
	const { frontmatter } = parseFrontmatter(content);
	assert.equal(frontmatter.description, "Use a:b and #hash — safely");
	assert.deepEqual(frontmatter.metadata, { scope: "general" });
});

test("serializeFrontmatter round-trips through parseFrontmatter", () => {
	const frontmatter = {
		name: "some-skill",
		description: 'A description with "quotes", a colon: and a #hash',
		metadata: {
			origin: "learned",
			created_at: "2026-09-14T12:00:00.000Z",
			scope: "github.com/earendil-works/pi",
			pinned: false,
			sessions: ["abc", "def"],
		},
	};
	const body = "## How\n\nDo the thing.\n";
	const document = serializeFrontmatter(frontmatter, body);
	const parsed = parseFrontmatter(document);
	assert.deepEqual(parsed.frontmatter, frontmatter);
	assert.equal(parsed.body, "## How\n\nDo the thing.");
});

// ---------------------------------------------------------------------------
// discoverSkillNames — reserves human-authored names so the store can refuse a
// collision before it writes a skill that pi would silently drop.
// ---------------------------------------------------------------------------

test("discoverSkillNames walks SKILL.md directories and root markdown files", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-fm-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));

	fs.mkdirSync(path.join(root, "human-skill"), { recursive: true });
	fs.writeFileSync(path.join(root, "human-skill", "SKILL.md"), '---\nname: human-skill\ndescription: "x"\n---\nbody\n');
	fs.mkdirSync(path.join(root, "group", "nested-skill"), { recursive: true });
	fs.writeFileSync(path.join(root, "group", "nested-skill", "SKILL.md"), '---\nname: nested-skill\ndescription: "x"\n---\nbody\n');
	fs.writeFileSync(path.join(root, "loose.md"), '---\nname: loose\ndescription: "x"\n---\nbody\n');

	// Ignored: hidden trees and non-SKILL markdown below the root.
	fs.mkdirSync(path.join(root, ".archive", "old"), { recursive: true });
	fs.writeFileSync(path.join(root, ".archive", "old", "SKILL.md"), '---\nname: archived\ndescription: "x"\n---\nbody\n');
	fs.writeFileSync(path.join(root, "group", "README.md"), '---\nname: not-a-skill\ndescription: "x"\n---\nbody\n');

	const names = discoverSkillNames(root);
	assert.deepEqual([...names].sort(), ["human-skill", "loose", "nested-skill"]);
});

test("discoverSkillNames returns an empty set for a missing root", () => {
	assert.deepEqual([...discoverSkillNames(path.join(os.tmpdir(), "rsi-does-not-exist-xyz"))], []);
});
