/**
 * SKILL.md frontmatter for the learned store.
 *
 * pi parses skill frontmatter with a full YAML parser, but extensions cannot
 * import pi's `yaml` dependency at runtime (it is not resolvable from the
 * extension directory), and the store must read and write frontmatter without
 * it. This module therefore understands the subset the store produces —
 * flat scalar keys plus a `metadata:` map — and the shapes a hand-written test
 * skill uses. `serializeFrontmatter` emits JSON-quoted scalars, which are valid
 * YAML, so anything it writes parses back both here and in pi.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ParsedSkillFile {
	frontmatter: Record<string, unknown>;
	body: string;
}

/** Extract the `---`-delimited frontmatter block and the Markdown body. */
export function parseFrontmatter(content: string): ParsedSkillFile {
	const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	if (!normalized.startsWith("---\n")) {
		return { frontmatter: {}, body: normalized };
	}
	const end = normalized.indexOf("\n---", 3);
	if (end === -1) {
		return { frontmatter: {}, body: normalized };
	}
	return {
		frontmatter: parseFrontmatterBlock(normalized.slice(4, end)),
		body: normalized.slice(end + 4).trim(),
	};
}

/** Serialize frontmatter and body into a SKILL.md document. */
export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
	const lines = ["---"];
	for (const [key, value] of Object.entries(frontmatter)) {
		if (value === undefined) continue;
		if (isPlainObject(value)) {
			lines.push(`${key}:`);
			for (const [nestedKey, nestedValue] of Object.entries(value)) {
				if (nestedValue === undefined) continue;
				lines.push(`  ${nestedKey}: ${yamlScalar(nestedValue)}`);
			}
			continue;
		}
		lines.push(`${key}: ${yamlScalar(value)}`);
	}
	lines.push("---", "");
	const trimmedBody = body.replace(/\s+$/, "");
	lines.push(trimmedBody);
	return `${lines.join("\n")}\n`;
}

/**
 * Collect the declared `name` of every `SKILL.md` beneath `root`, plus direct
 * root `*.md` skills. Used to reserve human-authored names before the store
 * accepts a new skill; a learned name that collides with one loads nothing.
 * Missing roots and unreadable files are treated as empty.
 */
export function discoverSkillNames(root: string): Set<string> {
	const names = new Set<string>();
	walk(root, names, 0);
	return names;
}

const MAX_DEPTH = 6;

function walk(dir: string, names: Set<string>, depth: number): void {
	if (depth > MAX_DEPTH) return;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}

	const hasSkillFile = entries.some((entry) => entry.isFile() && entry.name === "SKILL.md");
	if (hasSkillFile) {
		recordName(path.join(dir, "SKILL.md"), names);
		return;
	}

	for (const entry of entries) {
		if (entry.isDirectory()) {
			// Archived and staging trees never hold surfaced names.
			if (entry.name.startsWith(".")) continue;
			walk(path.join(dir, entry.name), names, depth + 1);
			continue;
		}
		if (entry.isFile() && depth === 0 && entry.name.endsWith(".md")) {
			recordName(path.join(dir, entry.name), names);
		}
	}
}

function recordName(filePath: string, names: Set<string>): void {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf8");
	} catch {
		return;
	}
	const { frontmatter } = parseFrontmatter(content);
	const name = frontmatter.name;
	if (typeof name === "string" && name.trim().length > 0) {
		names.add(name.trim());
	}
}

// ---------------------------------------------------------------------------
// Minimal YAML-subset parser. Handles `key: scalar`, a nested map introduced by
// `key:` with indented `key: scalar` lines, and `- item` lists. Inline comments
// are not stripped: the store always quotes string scalars, and test fixtures
// are written to match.
// ---------------------------------------------------------------------------

function parseFrontmatterBlock(block: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = block.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
		if (/^\s/.test(line)) continue;

		const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
		if (!match) continue;
		const [, key, rest] = match;

		if (rest.trim().length > 0) {
			result[key] = parseScalar(rest);
			continue;
		}

		const nested: Record<string, unknown> = {};
		const list: unknown[] = [];
		let sawList = false;
		while (i + 1 < lines.length) {
			const next = lines[i + 1];
			if (next.trim().length === 0) {
				// A blank line only continues the block while the following line
				// is still indented.
				const after = lines[i + 2];
				if (after === undefined || !/^\s/.test(after)) break;
				i++;
				continue;
			}
			if (!/^\s/.test(next)) break;
			i++;
			const trimmed = next.trim();
			if (trimmed.startsWith("#")) continue;
			if (trimmed.startsWith("- ")) {
				sawList = true;
				list.push(parseScalar(trimmed.slice(2)));
				continue;
			}
			const nestedMatch = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(trimmed);
			if (nestedMatch) {
				nested[nestedMatch[1]] = parseScalar(nestedMatch[2]);
			}
		}
		result[key] = sawList ? list : nested;
	}

	return result;
}

function parseScalar(raw: string): unknown {
	const value = raw.trim();
	if (value.length === 0) return "";
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null" || value === "~") return null;
	if (/^-?\d+$/.test(value)) return Number(value);

	if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
		try {
			return JSON.parse(value);
		} catch {
			return value.slice(1, -1);
		}
	}
	if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
		return value.slice(1, -1).replace(/''/g, "'");
	}
	if (value.startsWith("[") || value.startsWith("{")) {
		try {
			return JSON.parse(value);
		} catch {
			// Fall through to the raw string.
		}
	}
	return value;
}

function yamlScalar(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (typeof value === "object") return JSON.stringify(value);
	return JSON.stringify(String(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
