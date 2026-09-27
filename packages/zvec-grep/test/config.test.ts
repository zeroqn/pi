import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	configuredEmbedding,
	configuredRoots,
	configuredWorkspaceRoot,
	ensureNestedRepoInclude,
	loadExtensionConfig,
	parseRootList,
	resolveTargetRoots,
} from "../src/config.ts";

const ENV_KEYS = ["ZVEC_GREP_PI_ROOTS", "ZVEC_GREP_PI_WORKSPACE", "ZVEC_GREP_EMBEDDING"] as const;
const saved = new Map<string, string | undefined>();
const dirs: string[] = [];

beforeEach(() => {
	for (const key of ENV_KEYS) {
		saved.set(key, process.env[key]);
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = saved.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A scratch cwd and a scratch home, so neither source of `zvec-grep.json` is the real one. */
function scratch(): { cwd: string; home: string } {
	const cwd = mkdtempSync(join(tmpdir(), "zvec-cwd-"));
	const home = mkdtempSync(join(tmpdir(), "zvec-home-"));
	dirs.push(cwd, home);
	return { cwd, home };
}

function writeConfig(dir: string, body: unknown, where = [".pi", "zvec-grep.json"]): void {
	const path = join(dir, ...where);
	mkdirSync(join(dir, ...where.slice(0, -1)), { recursive: true });
	writeFileSync(path, JSON.stringify(body));
}

describe("loadExtensionConfig", () => {
	test("global first, project second: scalars override, roots accumulate", () => {
		const { cwd, home } = scratch();
		writeConfig(home, { workspaceRoot: "/global", roots: ["/g1"], embedding: "global-model" }, [
			".pi", "agent", "zvec-grep.json",
		]);
		writeConfig(cwd, { workspaceRoot: "/project", roots: ["/p1"] });
		const config = loadExtensionConfig(cwd, home);
		expect(config.workspaceRoot).toBe("/project");
		expect(config.embedding).toBe("global-model");
		expect(config.roots).toEqual(["/g1", "/p1"]);
	});

	test("a relative root resolves against the file that declared it", () => {
		const { cwd, home } = scratch();
		writeConfig(cwd, { roots: ["../sibling"], workspaceRoot: "." });
		const config = loadExtensionConfig(cwd, home);
		expect(config.roots).toEqual([join(cwd, "..", "sibling")]);
		expect(config.workspaceRoot).toBe(cwd);
	});

	test("no config at all is an empty config", () => {
		const { cwd, home } = scratch();
		expect(loadExtensionConfig(cwd, home)).toEqual({ workspaceRoot: undefined, roots: [], embedding: undefined });
	});
});

describe("resolveTargetRoots", () => {
	test("explicit roots beat everything, and are resolved and deduped", () => {
		const { cwd, home } = scratch();
		writeConfig(cwd, { workspaceRoot: "/configured" });
		process.env.ZVEC_GREP_PI_ROOTS = "/from-env";
		expect(resolveTargetRoots(cwd, ["/a", "/a", "/b"], "/root", home)).toEqual(["/a", "/b"]);
	});

	test("then the root argument, over any environment", () => {
		const { cwd, home } = scratch();
		process.env.ZVEC_GREP_PI_ROOTS = "/from-env";
		process.env.ZVEC_GREP_PI_WORKSPACE = "/from-env-workspace";
		expect(resolveTargetRoots(cwd, undefined, "/root", home)).toEqual(["/root"]);
		expect(resolveTargetRoots(cwd, undefined, undefined, home)).toEqual(["/from-env"]);
	});

	test("then the environment workspace, then the config, then cwd", () => {
		const { cwd, home } = scratch();
		writeConfig(cwd, { workspaceRoot: "/configured", roots: ["/configured-root"] });
		process.env.ZVEC_GREP_PI_WORKSPACE = "/from-env-workspace";
		expect(resolveTargetRoots(cwd, undefined, undefined, home)).toEqual(["/from-env-workspace"]);
		delete process.env.ZVEC_GREP_PI_WORKSPACE;
		expect(resolveTargetRoots(cwd, undefined, undefined, home)).toEqual(["/configured"]);
	});

	test("configured roots (strategy B) are used when there is no workspace root", () => {
		const { cwd, home } = scratch();
		writeConfig(cwd, { roots: ["/one", "/two"] });
		expect(resolveTargetRoots(cwd, undefined, undefined, home)).toEqual(["/one", "/two"]);
		expect(resolveTargetRoots(cwd, [], "   ", home)).toEqual(["/one", "/two"]);
	});

	test("with nothing configured, the session's own directory", () => {
		const { cwd, home } = scratch();
		expect(resolveTargetRoots(cwd, undefined, undefined, home)).toEqual([cwd]);
	});
});

describe("the configured* readers", () => {
	test("the environment wins over the config file, file by file", () => {
		const { cwd, home } = scratch();
		writeConfig(cwd, { workspaceRoot: "/configured", roots: ["/configured"], embedding: "file-model" });
		expect(configuredWorkspaceRoot(cwd, home)).toBe("/configured");
		expect(configuredRoots(cwd, home)).toEqual(["/configured"]);
		expect(configuredEmbedding(cwd, home)).toBe("file-model");

		process.env.ZVEC_GREP_PI_WORKSPACE = "/env";
		process.env.ZVEC_GREP_PI_ROOTS = "/env-a,/env-b";
		process.env.ZVEC_GREP_EMBEDDING = "env-model";
		expect(configuredWorkspaceRoot(cwd, home)).toBe("/env");
		expect(configuredRoots(cwd, home)).toEqual(["/env-a", "/env-b"]);
		expect(configuredEmbedding(cwd, home)).toBe("env-model");
	});

	test("parseRootList splits on commas and newlines and resolves", () => {
		expect(parseRootList("/a,/b\n/c")).toEqual(["/a", "/b", "/c"]);
		expect(parseRootList("  ")).toEqual([]);
		expect(parseRootList(undefined)).toEqual([]);
	});
});

describe("ensureNestedRepoInclude", () => {
	test("seeds a manifest whose root paths carry an explicit include", () => {
		const { cwd } = scratch();
		ensureNestedRepoInclude(cwd);
		const manifest = JSON.parse(readFileSync(join(cwd, ".zvec-grep", "manifest.json"), "utf8"));
		expect(manifest.rootPaths).toEqual([
			{ absolutePath: cwd, recursive: true, include: ["**"] },
		]);
		expect(manifest.manifestVersion).toBe(1);
	});

	test("backfills an include-less root path and leaves an explicit one alone", () => {
		const { cwd } = scratch();
		mkdirSync(join(cwd, ".zvec-grep"), { recursive: true });
		writeFileSync(
			join(cwd, ".zvec-grep", "manifest.json"),
			JSON.stringify({ rootPaths: [{ absolutePath: cwd }, { absolutePath: "/other", include: ["src/**"] }] }),
		);
		ensureNestedRepoInclude(cwd);
		const manifest = JSON.parse(readFileSync(join(cwd, ".zvec-grep", "manifest.json"), "utf8"));
		expect(manifest.rootPaths[0].include).toEqual(["**"]);
		expect(manifest.rootPaths[1].include).toEqual(["src/**"]);
	});

	test("a missing root is never given a workspace", () => {
		const { cwd } = scratch();
		ensureNestedRepoInclude(join(cwd, "nope"));
		expect(() => readFileSync(join(cwd, "nope", ".zvec-grep", "manifest.json"))).toThrow();
	});
});
