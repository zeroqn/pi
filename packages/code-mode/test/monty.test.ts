/**
 * The napi binding search. Ticket 03 moved this loader into code mode; the layout it has to
 * cope with is bun's, and the failure it exists to prevent — "Cannot find native binding"
 * from inside the compiled pi binary — is why it searches the store as well as a hoisted
 * `node_modules`. Both layouts are written out here rather than probed from the real tree,
 * so the test says which layouts are supported.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBinding } from "../src/monty";

function hoisted(root: string, version = "0.0.23"): string {
	const dir = join(root, "node_modules", "@pydantic", `monty-linux-x64-gnu`);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "monty.linux-x64-gnu.node");
	writeFileSync(file, "");
	return file;
}

function stored(root: string, version = "0.0.23"): string {
	const dir = join(
		root,
		"node_modules",
		".bun",
		`@pydantic+monty-linux-x64-gnu@${version}`,
		"node_modules",
		"@pydantic",
		"monty-linux-x64-gnu",
	);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "monty.linux-x64-gnu.node");
	writeFileSync(file, "");
	return file;
}

describe("finding the platform binding (the compiled-Bun hazard)", () => {
	it("finds a hoisted platform package beside the extension", () => {
		const base = mkdtempSync(join(tmpdir(), "cm-binding-"));
		const expected = hoisted(base);
		expect(findBinding(join(base, "src", "nested"))).toBe(expected);
	});

	it("finds one in bun's store, which no hoisted search would reach", () => {
		const base = mkdtempSync(join(tmpdir(), "cm-binding-"));
		// The package itself is symlinked from the store, so `node_modules/@pydantic` holds
		// only `monty`; the platform package is a sibling inside `.bun`.
		const scoped = join(base, "node_modules", "@pydantic", "monty");
		mkdirSync(scoped, { recursive: true });
		writeFileSync(join(scoped, "package.json"), "{}");
		const expected = stored(base);
		expect(findBinding(join(base, "src"))).toBe(expected);
	});

	it("prefers a hoisted package over the store when both exist", () => {
		const base = mkdtempSync(join(tmpdir(), "cm-binding-"));
		const expected = hoisted(base);
		stored(base);
		expect(findBinding(join(base, "src"))).toBe(expected);
	});

	it("returns null rather than guessing when neither layout is present", () => {
		const base = mkdtempSync(join(tmpdir(), "cm-binding-"));
		expect(findBinding(join(base, "src"))).toBeNull();
	});
});
