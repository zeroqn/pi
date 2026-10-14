/**
 * Where a search points, and what a workspace's manifest is seeded with.
 *
 * Moved out of `index.ts` unchanged (`.scratch/zvec-grep` ticket 03): the root precedence rule is what
 * `resolveTargetRoots` is for, and it is the piece a test has to be able to reach without booting pi.
 *
 * It also owns the workspace manifest: seeding one (a `rootPaths` include, so nested repositories are
 * indexed), dropping that seed again when a `zg` refuses it, and reading one back for `/zg-status-all`.
 * The two CLI generations keep *different* manifests, which is what the seed/discard pair is about — see
 * `ensureNestedRepoInclude` and `discardSeededManifest`.
 *
 * `home` is a parameter rather than a call to `homedir()` inside each function because the global
 * config source lives under it, and a test that had to mutate `HOME` to reach that tier would not work:
 * node caches the first `os.homedir()` lookup for the life of the process (measured).
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export type ZvecGrepExtensionConfig = {
	workspaceRoot?: string;
	roots: string[];
	embedding?: string;
};

export function dedupePaths(paths: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const path of paths) {
		if (seen.has(path)) continue;
		seen.add(path);
		out.push(path);
	}
	return out;
}

export function parseRootList(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(/[,\n]/)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => resolve(entry));
}

function readJsonFile(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

export function loadExtensionConfig(cwd: string, home: string = homedir()): ZvecGrepExtensionConfig {
	const roots: string[] = [];
	let workspaceRoot: string | undefined;
	let embedding: string | undefined;
	// Global first, project second: project values override for scalar fields.
	const sources: Array<{ path: string; base: string }> = [
		{ path: join(home, ".pi", "agent", "zvec-grep.json"), base: home },
		{ path: join(cwd, ".pi", "zvec-grep.json"), base: cwd },
	];
	for (const { path, base } of sources) {
		const parsed = readJsonFile(path);
		if (!parsed || typeof parsed !== "object") continue;
		const record = parsed as Record<string, unknown>;
		if (Array.isArray(record.roots)) {
			for (const entry of record.roots) {
				if (typeof entry === "string" && entry.trim()) {
					roots.push(resolve(base, entry.trim()));
				}
			}
		}
		if (typeof record.workspaceRoot === "string" && record.workspaceRoot.trim()) {
			workspaceRoot = resolve(base, record.workspaceRoot.trim());
		}
		if (typeof record.embedding === "string" && record.embedding.trim()) {
			embedding = record.embedding.trim();
		}
	}
	return { workspaceRoot, roots: dedupePaths(roots), embedding };
}

export function configuredRoots(cwd: string, home: string = homedir()): string[] {
	const fromEnv = parseRootList(process.env.ZVEC_GREP_PI_ROOTS);
	if (fromEnv.length > 0) return dedupePaths(fromEnv);
	return loadExtensionConfig(cwd, home).roots;
}

/** Strategy A: the single parent workspace root, if configured. */
export function configuredWorkspaceRoot(cwd: string, home: string = homedir()): string | undefined {
	const fromEnv = process.env.ZVEC_GREP_PI_WORKSPACE?.trim();
	if (fromEnv) return resolve(fromEnv);
	return loadExtensionConfig(cwd, home).workspaceRoot;
}

export function configuredEmbedding(cwd: string, home: string = homedir()): string | undefined {
	return process.env.ZVEC_GREP_EMBEDDING?.trim() || loadExtensionConfig(cwd, home).embedding;
}

/**
 * Root precedence (highest first): tool `roots` (B) > tool `root` > `ZVEC_GREP_PI_ROOTS` (B) >
 * `ZVEC_GREP_PI_WORKSPACE` (A) > config `workspaceRoot` (A) > config `roots` (B) > cwd.
 */
export function resolveTargetRoots(
	cwd: string,
	roots: readonly string[] | undefined,
	root: string | undefined,
	home: string = homedir(),
): string[] {
	const explicit = (roots ?? [])
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => resolve(entry));
	if (explicit.length > 0) return dedupePaths(explicit);
	if (root?.trim()) return [resolve(root.trim())];
	// Strategy B escalation (per-repo fan-out) only when explicitly opted into.
	const envRoots = parseRootList(process.env.ZVEC_GREP_PI_ROOTS);
	if (envRoots.length > 0) return dedupePaths(envRoots);
	const envWorkspace = process.env.ZVEC_GREP_PI_WORKSPACE?.trim();
	if (envWorkspace) return [resolve(envWorkspace)];
	// Strategy A default: one parent workspace.
	const config = loadExtensionConfig(cwd, home);
	if (config.workspaceRoot) return [config.workspaceRoot];
	if (config.roots.length > 0) return config.roots;
	return [cwd];
}

/** `<root>/.zvec-grep/manifest.json` — the workspace record both `zg` generations keep. */
export function workspaceManifestPath(root: string): string {
	return join(root, ".zvec-grep", "manifest.json");
}

/**
 * Ensure a workspace index covers nested git repositories.
 *
 * zg's scanner skips any directory that contains a `.git` entry unless the root path carries an
 * explicit `include` pattern matching it. The CLI only ever writes the query-side `globs` field, so
 * `include: ["**"]` has to be seeded in the workspace manifest. Pre-seed it before the first index and
 * backfill existing manifests that have no include yet. An explicit include set by the user is left
 * untouched.
 */
export function ensureNestedRepoInclude(root: string): void {
	if (!existsSync(root)) {
		// Never create a workspace for a missing root; zg will report it.
		return;
	}
	const home = join(root, ".zvec-grep");
	const manifestPath = workspaceManifestPath(root);
	if (!existsSync(manifestPath)) {
		const now = Date.now();
		const manifest = {
			manifestVersion: 1,
			id: randomUUID(),
			name: basename(root) || "workspace",
			path: home,
			rootPaths: [{ absolutePath: root, recursive: true, include: ["**"] }],
			indexPolicy: "enabled",
			embedding: null,
			indexVersion: null,
			createdTime: now,
			updatedTime: now,
			embeddingRuntime: {},
		};
		try {
			mkdirSync(home, { recursive: true, mode: 0o700 });
			writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
				mode: 0o600,
			});
		} catch {
			// Fall back to letting zg create the manifest itself.
		}
		return;
	}
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			rootPaths?: Array<{ include?: unknown }>;
			updatedTime?: number;
		};
		if (!Array.isArray(manifest.rootPaths)) {
			return;
		}
		let changed = false;
		for (const rootPath of manifest.rootPaths) {
			if (rootPath && rootPath.include === undefined) {
				rootPath.include = ["**"];
				changed = true;
			}
		}
		if (changed) {
			manifest.updatedTime = Date.now();
			writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
				mode: 0o600,
			});
		}
	} catch {
		// Invalid manifest: leave it for zg to report.
	}
}

/**
 * Remove the manifest `ensureNestedRepoInclude` pre-seeded, once an engine has refused to read it.
 *
 * The seed is the *node* CLI's manifest shape, and the Rust `zg` will not read a manifest it did not
 * write: it answers `unsupported index version ... rebuild the index with ...` and refuses to index or
 * search until it is gone. Nothing is indexed behind an unbuilt manifest, so dropping it costs nothing —
 * but only that shape is dropped. A manifest carrying an `indexVersion` (either generation's, once
 * something has been indexed through it) or a Rust `storageGeneration` is left exactly as it is, so an
 * index can never be discarded here by accident.
 *
 * Returns whether a manifest was removed.
 */
export function discardSeededManifest(root: string): boolean {
	const manifestPath = workspaceManifestPath(root);
	if (!existsSync(manifestPath)) return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		// An unreadable manifest is not this extension's seed; leave it for the CLI to report.
		return false;
	}
	if (!parsed || typeof parsed !== "object") return false;
	const manifest = parsed as { manifestVersion?: unknown; indexVersion?: unknown; storageGeneration?: unknown };
	const unbuiltNodeSeed =
		manifest.manifestVersion === 1 && manifest.indexVersion == null && manifest.storageGeneration == null;
	if (!unbuiltNodeSeed) return false;
	try {
		rmSync(manifestPath);
	} catch {
		return false;
	}
	return true;
}

export type IndexedWorkspace = {
	root: string;
	name: string;
	updatedTime: number;
	embedding?: string;
};

/**
 * Read `<root>/.zvec-grep/manifest.json` and describe the indexed workspace, if any.
 *
 * Both generations are read, because `/zg-status-all` lists whichever one a workspace was indexed with:
 * the node manifest keeps the model at `embedding.model`, the Rust one at `embeddings[0].model.name`
 * (and, when it was routed, with the routed spelling in `embeddingRoutes.text`). `updatedTime` is
 * epoch milliseconds in both.
 */
export function readIndexedWorkspace(root: string): IndexedWorkspace | undefined {
	const manifestPath = workspaceManifestPath(root);
	if (!existsSync(manifestPath)) return undefined;
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			name?: unknown;
			updatedTime?: unknown;
			embedding?: { model?: unknown } | null;
			embeddings?: Array<{ model?: { name?: unknown } | null }> | null;
			embeddingRoutes?: Record<string, unknown> | null;
		};
		return {
			root,
			name:
				typeof manifest.name === "string" && manifest.name.trim()
					? manifest.name.trim()
					: basename(root),
			updatedTime: typeof manifest.updatedTime === "number" ? manifest.updatedTime : 0,
			embedding: embeddingModelOf(manifest),
		};
	} catch {
		return undefined;
	}
}

/** The model name as either manifest spells it, or `undefined` when neither does. */
function embeddingModelOf(manifest: {
	embedding?: { model?: unknown } | null;
	embeddings?: Array<{ model?: { name?: unknown } | null }> | null;
	embeddingRoutes?: Record<string, unknown> | null;
}): string | undefined {
	const nodeModel = manifest.embedding?.model;
	if (typeof nodeModel === "string" && nodeModel.trim()) return nodeModel.trim();
	const rustModel = manifest.embeddings?.[0]?.model?.name;
	if (typeof rustModel === "string" && rustModel.trim()) return rustModel.trim();
	const routed = manifest.embeddingRoutes?.text;
	if (typeof routed === "string" && routed.trim()) return routed.trim();
	return undefined;
}
