/**
 * zvec-grep (zg) integration for pi.
 *
 * pi intentionally ships without a built-in MCP client, so this extension
 * exposes zvec-grep's local-first search layer as native pi tools backed by
 * the `zg` CLI (which itself can run direct or against the shared daemon):
 *
 *   - zvec_grep_search : ranked hybrid / lexical / vector search over the index
 *   - zvec_grep_rg     : exhaustive managed ripgrep (no index required)
 *
 * plus user-invoked maintenance commands:
 *
 *   /zg-enable [--rebuild] [--root <path>] [embedding-model]   (index + server on)
 *   /zg-index [--rebuild] [--drop] [--root <path>] [embedding-model]
 *   /zg-index-all        (strategy B escalation only)
 *   /zg-status
 *   /zg-server [on|off|status]
 *
 * Default strategy (A): a single parent workspace that contains the related
 * repos. Point `workspaceRoot` at it once; every search and index then uses
 * that one index, so ranking is fused across all repos. Per-repo indexes with
 * a `roots` fan-out (strategy B) remain available as an explicit escalation.
 *
 * The extension auto-detects both CLI generations:
 *   - "modern" (zg >= 0.2.1): `zg <query>`, `zg --rg`, `zg --index`, `zg --status`
 *   - "legacy" (zg <= 0.2.0): `zg query`, `zg query --rg`, `zg index`, `zg status`
 *
 * Optional configuration:
 *   ZVEC_GREP_BIN        Path to the zg binary (default: "zg")
 *   ZVEC_GREP_CLI_STYLE  "modern" | "legacy" to skip auto-detection
 *   ZVEC_GREP_PI_STATUS  "0" to disable the session_start footer status
 *   ZVEC_GREP_PI_WORKSPACE  Strategy A parent workspace root (A default)
 *   ZVEC_GREP_PI_ROOTS   Strategy B comma/newline-separated roots (opt-in)
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Type, type Static } from "typebox";

const SEARCH_TIMEOUT_MS = 10 * 60 * 1000;
const RG_TIMEOUT_MS = 2 * 60 * 1000;
const INDEX_TIMEOUT_MS = 60 * 60 * 1000;
const STATUS_TIMEOUT_MS = 30 * 1000;
const MAX_OUTPUT_CHARS = 80_000;

type CliStyle = "modern" | "legacy";

function zgBinary(): string {
	return process.env.ZVEC_GREP_BIN?.trim() || "zg";
}

function statusEnabled(): boolean {
	const value = process.env.ZVEC_GREP_PI_STATUS?.trim().toLowerCase();
	return value !== "0" && value !== "false" && value !== "off";
}

/** Compare a parsed semver against 0.2.1 (the first "modern" CLI shape). */
function styleForVersion(version: string): CliStyle {
	const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!match) return "modern";
	const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
	if (major > 0) return "modern";
	if (minor > 2) return "modern";
	if (minor === 2 && patch >= 1) return "modern";
	return "legacy";
}

/* ------------------------------------------------------------------ *
 * Workspace configuration
 *
 * Strategy A (default): one parent workspace containing the related repos.
 * Configure `workspaceRoot` once and every search/index targets that single
 * index, which ranks across all repos together.
 *
 * Strategy B (escalation): independent per-repo indexes. Configure `roots`
 * (or ZVEC_GREP_PI_ROOTS) only when per-repo refresh/model isolation is
 * needed; results then come back grouped per root without fused ranking.
 *
 * Root precedence (highest first): tool `roots` arg (B) > tool `root` arg >
 * ZVEC_GREP_PI_ROOTS (B) > ZVEC_GREP_PI_WORKSPACE (A) >
 * config `workspaceRoot` (A) > config `roots` (B) > cwd.
 * ------------------------------------------------------------------ */

type ZvecGrepExtensionConfig = {
	workspaceRoot?: string;
	roots: string[];
	embedding?: string;
};

function dedupePaths(paths: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const path of paths) {
		if (seen.has(path)) continue;
		seen.add(path);
		out.push(path);
	}
	return out;
}

function parseRootList(value: string | undefined): string[] {
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

function loadExtensionConfig(cwd: string): ZvecGrepExtensionConfig {
	const roots: string[] = [];
	let workspaceRoot: string | undefined;
	let embedding: string | undefined;
	// Global first, project second: project values override for scalar fields.
	const sources: Array<{ path: string; base: string }> = [
		{ path: join(homedir(), ".pi", "agent", "zvec-grep.json"), base: homedir() },
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

function configuredRoots(cwd: string): string[] {
	const fromEnv = parseRootList(process.env.ZVEC_GREP_PI_ROOTS);
	if (fromEnv.length > 0) return dedupePaths(fromEnv);
	return loadExtensionConfig(cwd).roots;
}

/** Strategy A: the single parent workspace root, if configured. */
function configuredWorkspaceRoot(cwd: string): string | undefined {
	const fromEnv = process.env.ZVEC_GREP_PI_WORKSPACE?.trim();
	if (fromEnv) return resolve(fromEnv);
	return loadExtensionConfig(cwd).workspaceRoot;
}

function configuredEmbedding(cwd: string): string | undefined {
	return process.env.ZVEC_GREP_EMBEDDING?.trim() || loadExtensionConfig(cwd).embedding;
}

function resolveTargetRoots(
	cwd: string,
	roots: readonly string[] | undefined,
	root: string | undefined,
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
	const config = loadExtensionConfig(cwd);
	if (config.workspaceRoot) return [config.workspaceRoot];
	if (config.roots.length > 0) return config.roots;
	return [cwd];
}

/** Parse `/zg-index [--rebuild] [--drop] [--root <path>] [embedding-model]`. */
function parseIndexArgs(args: string): {
	rebuild: boolean;
	drop: boolean;
	root?: string;
	model?: string;
} {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const rootFlag = tokens.indexOf("--root");
	const root = rootFlag === -1 ? undefined : tokens[rootFlag + 1]?.trim() || undefined;
	const model = tokens.find(
		(token, index) => !token.startsWith("-") && (rootFlag === -1 || index !== rootFlag + 1),
	);
	return {
		rebuild: tokens.includes("--rebuild"),
		drop: tokens.includes("--drop"),
		root,
		model,
	};
}

async function runServerAction(
	pi: ExtensionAPI,
	style: CliStyle,
	action: "on" | "off" | "status",
	cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	const cliArgs = style === "legacy" ? ["server", action] : ["--server", action];
	return pi.exec(zgBinary(), cliArgs, { cwd, timeout: STATUS_TIMEOUT_MS });
}

type RootRun = { root: string; result: { stdout: string; stderr: string; code: number } };

async function runAcrossRoots(
	pi: ExtensionAPI,
	roots: readonly string[],
	args: readonly string[],
	signal: AbortSignal | undefined,
	timeout: number,
): Promise<RootRun[]> {
	return Promise.all(
		roots.map(async (root) => ({
			root,
			result: await pi.exec(zgBinary(), [...args], { cwd: root, signal, timeout }),
		})),
	);
}

function formatRootResults(
	label: string,
	outcomes: readonly RootRun[],
	options: { header: boolean; head?: number },
): { text: string; failed: number } {
	let failed = 0;
	const sections = outcomes.map(({ root, result }) => {
		const prefix = options.header ? `### ${root}\n` : "";
		if (result.code !== 0) {
			failed += 1;
			const detail = (result.stderr || result.stdout).trim() || "no output";
			return `${prefix}${label} failed (exit ${result.code}).\n${detail}`;
		}
		const body = boundOutput((result.stdout || result.stderr).trim() || "(no results)", options.head);
		return `${prefix}${body}`;
	});
	return { text: sections.join("\n\n"), failed };
}

const SEARCH_PARAMS = Type.Object({
	query: Type.Optional(
		Type.String({ description: "One hybrid natural-language or exact query." }),
	),
	queries: Type.Optional(
		Type.Array(Type.String(), { description: "Multiple hybrid query groups." }),
	),
	fts: Type.Optional(
		Type.Array(Type.String(), {
			description: "Ranked lexical query groups (not exhaustive occurrence lookup).",
		}),
	),
	vector: Type.Optional(
		Type.Array(Type.String(), { description: "Semantic-only query groups." }),
	),
	fuse: Type.Optional(
		Type.Boolean({ description: "Fuse every query group into one ranked list." }),
	),
	limit: Type.Optional(
		Type.Number({ description: "Maximum results per group (default 7, max 50)." }),
	),
	globs: Type.Optional(
		Type.Array(Type.String(), { description: "Include globs; prefix with ! to exclude." }),
	),
	iglobs: Type.Optional(
		Type.Array(Type.String(), { description: "Case-insensitive include globs." }),
	),
	fileTypes: Type.Optional(
		Type.Array(Type.String(), { description: "ripgrep file types to include (e.g. ts)." }),
	),
	excludedFileTypes: Type.Optional(
		Type.Array(Type.String(), { description: "ripgrep file types to exclude." }),
	),
	symbolType: Type.Optional(
		StringEnum(["module", "class", "interface", "function", "value", "alias"] as const, {
			description: "Restrict results to an indexed symbol type.",
		}),
	),
	preferSymbol: Type.Optional(
		Type.Boolean({ description: "Prefer an exact indexed symbol match." }),
	),
	modifiedAfter: Type.Optional(
		Type.String({ description: "Only files modified after a date or epoch milliseconds." }),
	),
	modifiedBefore: Type.Optional(
		Type.String({ description: "Only files modified before a date or epoch milliseconds." }),
	),
	preview: Type.Optional(
		StringEnum(["none", "short", "full"] as const, { description: "Source preview size." }),
	),
	refresh: Type.Optional(
		StringEnum(["background", "wait", "off"] as const, {
			description: "Index refresh policy. Defaults: server=background, direct=off.",
		}),
	),
	mode: Type.Optional(
		StringEnum(["direct", "server", "auto"] as const, {
			description: "Execution transport. Defaults to the zg configuration.",
		}),
	),
	roots: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Multiple absolute workspace roots to search in one call. Results are grouped per root. Overrides `root` and any configured roots.",
		}),
	),
	root: Type.Optional(
		Type.String({
			description: "Absolute workspace root to search. Defaults to pi's current directory.",
		}),
	),
});

const RG_PARAMS = Type.Object({
	command: Type.String({
		description:
			"The ripgrep command to run, e.g. \"rg -n -F 'loadTheme' -g '*.ts' src\". Parsed into arguments without a shell. A trailing `| head -N` bounds the output.",
	}),
	roots: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Multiple absolute workspace roots to search in one call. Results are grouped per root.",
		}),
	),
	root: Type.Optional(
		Type.String({
			description: "Absolute workspace root to search. Defaults to pi's current directory.",
		}),
	),
});

type SearchParams = Static<typeof SEARCH_PARAMS>;
type RgParams = Static<typeof RG_PARAMS>;

/** Parse a ripgrep command string into argv, honouring quotes. Never uses a shell. */
export function tokenizeRgCommand(command: string): { args: string[]; head?: number } {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let hasToken = false;

	const flush = (): void => {
		if (hasToken || current.length > 0) {
			tokens.push(current);
			current = "";
			hasToken = false;
		}
	};

	for (let i = 0; i < command.length; i++) {
		const ch = command[i]!;
		if (quote) {
			if (ch === quote) {
				quote = undefined;
			} else if (ch === "\\" && quote === '"' && i + 1 < command.length) {
				current += command[++i];
			} else {
				current += ch;
			}
			hasToken = true;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			hasToken = true;
			continue;
		}
		if (ch === "\\" && i + 1 < command.length) {
			current += command[++i];
			hasToken = true;
			continue;
		}
		if (/\s/.test(ch)) {
			flush();
			continue;
		}
		current += ch;
		hasToken = true;
	}
	flush();

	// Drop a leading `zg` and/or the managed-rg selector for convenience.
	if (tokens[0] === "zg") tokens.shift();
	if (tokens[0] === "--rg" || tokens[0] === "rg") tokens.shift();

	// Translate a trailing `| head -N` into an output bound.
	const pipeIndex = tokens.indexOf("|");
	if (pipeIndex === -1) return { args: tokens };
	const rest = tokens.slice(pipeIndex + 1);
	let head: number | undefined;
	if (rest[0] === "head") {
		const [a, b] = [rest[1], rest[2]];
		if (a && /^-\d+$/.test(a)) head = Number(a.slice(1));
		else if (a === "-n" && b && /^\d+$/.test(b)) head = Number(b);
		else if (a && /^-n\d+$/.test(a)) head = Number(a.slice(2));
		else if (a && /^\d+$/.test(a)) head = Number(a);
	}
	return { args: tokens.slice(0, pipeIndex), head };
}

function buildSearchArgs(style: CliStyle, params: SearchParams): string[] {
	const args: string[] = [];
	if (style === "legacy") args.push("query");
	for (const value of params.queries ?? []) args.push("--hybrid", value);
	for (const value of params.fts ?? []) args.push("--fts", value);
	for (const value of params.vector ?? []) args.push("--vector", value);
	if (params.fuse) args.push("--fuse");
	if (params.limit !== undefined) args.push("--limit", String(params.limit));
	for (const value of params.globs ?? []) args.push("-g", value);
	for (const value of params.iglobs ?? []) args.push("--iglob", value);
	for (const value of params.fileTypes ?? []) args.push("-t", value);
	for (const value of params.excludedFileTypes ?? []) args.push("-T", value);
	if (params.symbolType) args.push("--symbol-type", params.symbolType);
	if (params.preferSymbol) args.push("--prefer-symbol");
	if (params.modifiedAfter) args.push("--modified-after", params.modifiedAfter);
	if (params.modifiedBefore) args.push("--modified-before", params.modifiedBefore);
	if (params.preview) args.push("--preview", params.preview);
	if (params.refresh) args.push("--refresh", params.refresh);
	if (params.mode) args.push("--mode", params.mode);
	// Keep the positional query last so a leading `-` can be escaped with `--`.
	if (params.query) {
		if (params.query.startsWith("-")) args.push("--");
		args.push(params.query);
	}
	return args;
}

function buildRgArgs(style: CliStyle, rgArgs: string[]): string[] {
	return style === "legacy" ? ["query", "--rg", ...rgArgs] : ["--rg", ...rgArgs];
}

function boundOutput(text: string, head?: number): string {
	let out = text;
	if (head !== undefined && Number.isFinite(head) && head >= 0) {
		out = out.split("\n").slice(0, head).join("\n");
	}
	if (out.length > MAX_OUTPUT_CHARS) {
		out = `${out.slice(0, MAX_OUTPUT_CHARS)}\n…[output truncated at ${MAX_OUTPUT_CHARS} characters]`;
	}
	return out;
}

function lastNonEmptyLine(text: string): string {
	const lines = text.split("\n").map((line) => line.trimEnd()).filter(Boolean);
	return lines.length > 0 ? lines[lines.length - 1]! : "";
}

export default function zvecGrepExtension(pi: ExtensionAPI) {
	let cliStylePromise: Promise<CliStyle> | undefined;

	const resolveStyle = (cwd: string): Promise<CliStyle> => {
		if (!cliStylePromise) {
			const override = process.env.ZVEC_GREP_CLI_STYLE?.trim().toLowerCase();
			if (override === "modern" || override === "legacy") {
				cliStylePromise = Promise.resolve(override);
			} else {
				cliStylePromise = pi
					.exec(zgBinary(), ["--version"], { cwd, timeout: 15_000 })
					.then((result) => styleForVersion(`${result.stdout}\n${result.stderr}`))
					.catch(() => "modern" as CliStyle);
			}
		}
		return cliStylePromise;
	};

	pi.registerTool({
		name: "zvec_grep_search",
		label: "zvec-grep search",
		description:
			"Ranked hybrid, lexical, and semantic search over the zvec-grep index of the current workspace. Use when the answer is grounded in local files but the wording or location is unknown, or when semantic, fuzzy, cross-file, chronological, or comparative synthesis is needed. Requires an existing index (`/zg-index`).",
		promptSnippet: "Ranked semantic + lexical search over the indexed workspace (zvec-grep)",
		promptGuidelines: [
			"Use zvec_grep_search when the answer should be grounded in the current workspace but exact wording or location is unknown, or when semantic, fuzzy, relationship, chronology, causality, comparison, or cross-file synthesis is required.",
			"Do not use zvec_grep_search for open-world knowledge or external facts unrelated to the local workspace.",
			"Use zvec_grep_search before native grep/rg only when no sufficient exact anchor (quotation, identifier, filename, regex) is available; otherwise prefer exact search.",
		],
		parameters: SEARCH_PARAMS,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const roots = resolveTargetRoots(ctx.cwd, params.roots, params.root);
			const hasQuery = Boolean(
				params.query ||
					(params.queries?.length ?? 0) > 0 ||
					(params.fts?.length ?? 0) > 0 ||
					(params.vector?.length ?? 0) > 0,
			);
			if (!hasQuery) {
				return {
					content: [
						{
							type: "text",
							text: "zvec_grep_search requires at least one of query, queries, fts, or vector.",
						},
					],
					isError: true,
					details: { roots },
				};
			}

			const style = await resolveStyle(ctx.cwd);
			const args = buildSearchArgs(style, params);
			onUpdate?.({
				content: [
					{
						type: "text",
						text:
							roots.length > 1
								? `Searching ${roots.length} workspaces…`
								: "Searching the indexed workspace…",
					},
				],
			});

			const outcomes = await runAcrossRoots(pi, roots, args, signal, SEARCH_TIMEOUT_MS);
			const { text, failed } = formatRootResults("zvec-grep search", outcomes, {
				header: roots.length > 1,
			});
			return {
				content: [{ type: "text", text }],
				isError: failed === outcomes.length,
				details: { roots, args, style },
			};
		},
	});

	pi.registerTool({
		name: "zvec_grep_rg",
		label: "zvec-grep rg",
		description:
			"Exhaustive managed ripgrep over the workspace. No index required. Pass the ripgrep command you would otherwise run; it is parsed into arguments and never executed by a shell. Append `| head -N` to bound output.",
		promptSnippet: "Exhaustive managed ripgrep search (zvec-grep, no index required)",
		promptGuidelines: [
			"Use zvec_grep_rg for exhaustive exact, literal, or regex search when ranked indexed results from zvec_grep_search are not appropriate.",
			"Scope broad zvec_grep_rg searches with command paths, -g/--glob, or -t/--type.",
		],
		parameters: RG_PARAMS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const roots = resolveTargetRoots(ctx.cwd, params.roots, params.root);
			const { args: rgArgs, head } = tokenizeRgCommand(params.command);
			if (rgArgs.length === 0) {
				return {
					content: [{ type: "text", text: "zvec_grep_rg requires a ripgrep command." }],
					isError: true,
					details: { roots },
				};
			}

			const style = await resolveStyle(ctx.cwd);
			const args = buildRgArgs(style, rgArgs);
			const outcomes = await runAcrossRoots(pi, roots, args, signal, RG_TIMEOUT_MS);
			const { text, failed } = formatRootResults("zvec-grep rg", outcomes, {
				header: roots.length > 1,
				head,
			});
			return {
				content: [{ type: "text", text }],
				isError: failed === outcomes.length,
				details: { roots, args, style },
			};
		},
	});

	pi.registerCommand("zg-enable", {
		description:
			"One-shot setup: build/update the parent workspace index and start the shared daemon: /zg-enable [--rebuild] [--root <path>] [embedding-model]",
		handler: async (args, ctx) => {
			const parsed = parseIndexArgs(args);
			if (parsed.drop) {
				ctx.ui.notify("/zg-enable does not support --drop; use /zg-index --drop.", "warning");
				return;
			}
			const model = parsed.model || configuredEmbedding(ctx.cwd);
			const targetRoot = parsed.root
				? resolve(parsed.root)
				: (configuredWorkspaceRoot(ctx.cwd) ?? ctx.cwd);
			const style = await resolveStyle(ctx.cwd);

			ctx.ui.setStatus("zvec-grep", `indexing ${targetRoot}…`);
			const indexArgs = style === "legacy" ? ["index"] : ["--index"];
			if (model) indexArgs.push("--embedding", model);
			if (parsed.rebuild) indexArgs.push("--rebuild");
			const indexResult = await pi.exec(zgBinary(), indexArgs, {
				cwd: targetRoot,
				timeout: INDEX_TIMEOUT_MS,
			});
			const indexOk = indexResult.code === 0;

			ctx.ui.setStatus("zvec-grep", "starting zvec-grep server…");
			const serverResult = await runServerAction(pi, style, "on", targetRoot);
			const serverOk = serverResult.code === 0;

			ctx.ui.setStatus(
				"zvec-grep",
				indexOk && serverOk ? "index ready · server on" : "setup incomplete",
			);
			const indexLine = indexOk
				? lastNonEmptyLine(indexResult.stdout) || "index updated"
				: `index failed: ${(indexResult.stderr || indexResult.stdout).trim() || `exit ${indexResult.code}`}`;
			const serverLine = serverOk
				? lastNonEmptyLine(serverResult.stdout) || "server ready"
				: `server failed: ${(serverResult.stderr || serverResult.stdout).trim() || `exit ${serverResult.code}`}`;
			ctx.ui.notify(
				`zvec-grep enabled (${targetRoot})\n${indexLine}\n${serverLine}`,
				indexOk && serverOk ? "info" : "warning",
			);
		},
	});

	pi.registerCommand("zg-index", {
		description:
			"Build or update the workspace index (strategy A): /zg-index [--rebuild] [--drop] [--root <path>] [embedding-model]",
		handler: async (args, ctx) => {
			const parsedArgs = parseIndexArgs(args);
			const rebuild = parsedArgs.rebuild;
			const drop = parsedArgs.drop;
			const model = parsedArgs.model || configuredEmbedding(ctx.cwd);
			// Strategy A default: index the configured parent workspace.
			const targetRoot = parsedArgs.root
				? resolve(parsedArgs.root)
				: (configuredWorkspaceRoot(ctx.cwd) ?? ctx.cwd);

			if (drop) {
				const confirmed = await ctx.ui.confirm(
					"Drop zvec-grep index?",
					"This permanently removes the workspace index.",
				);
				if (!confirmed) {
					ctx.ui.notify("zvec-grep index drop cancelled.", "info");
					return;
				}
			}

			const style = await resolveStyle(ctx.cwd);
			const cliArgs: string[] =
				style === "legacy" ? ["index"] : ["--index"];
			if (model) cliArgs.push("--embedding", model);
			if (rebuild) cliArgs.push("--rebuild");
			if (drop) cliArgs.push("--drop", "--yes");

			ctx.ui.setStatus("zvec-grep", drop ? "dropping index…" : `indexing ${targetRoot}…`);
			try {
				const result = await pi.exec(zgBinary(), cliArgs, {
					cwd: targetRoot,
					timeout: INDEX_TIMEOUT_MS,
				});
				if (result.code !== 0) {
					ctx.ui.notify(
						`zvec-grep index failed: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`,
						"error",
					);
					return;
				}
				ctx.ui.notify(
					lastNonEmptyLine(result.stdout) || "zvec-grep index updated.",
					"info",
				);
				ctx.ui.setStatus("zvec-grep", "index ready");
			} catch (error) {
				ctx.ui.notify(
					`zvec-grep index failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("zg-index-all", {
		description:
			"Index each independently indexed repo (strategy B escalation): /zg-index-all [--rebuild] [embedding-model]",
		handler: async (args, ctx) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const rebuild = tokens.includes("--rebuild");
			const model = tokens.find((token) => !token.startsWith("-")) || configuredEmbedding(ctx.cwd);
			const roots = configuredRoots(ctx.cwd);
			if (roots.length === 0) {
				ctx.ui.notify(
					"No per-repo roots configured. Strategy A uses one parent workspace via /zg-index; set ZVEC_GREP_PI_ROOTS or a `roots` array in .pi/zvec-grep.json only for independent repos.",
					"warning",
				);
				return;
			}

			const style = await resolveStyle(ctx.cwd);
			let failures = 0;
			for (const [index, root] of roots.entries()) {
				ctx.ui.setStatus("zvec-grep", `indexing ${index + 1}/${roots.length}: ${root}`);
				const cliArgs = style === "legacy" ? ["index"] : ["--index"];
				if (model) cliArgs.push("--embedding", model);
				if (rebuild) cliArgs.push("--rebuild");
				const result = await pi.exec(zgBinary(), cliArgs, {
					cwd: root,
					timeout: INDEX_TIMEOUT_MS,
				});
				if (result.code !== 0) {
					failures += 1;
					ctx.ui.notify(
						`Index failed for ${root}: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`,
						"error",
					);
				}
			}
			ctx.ui.setStatus("zvec-grep", failures === 0 ? "index ready" : "index incomplete");
			ctx.ui.notify(
				`Updated ${roots.length - failures}/${roots.length} workspace(s).`,
				failures === 0 ? "info" : "warning",
			);
		},
	});

	pi.registerCommand("zg-status", {
		description: "Show zvec-grep workspace and index status",
		handler: async (_args, ctx) => {
			const style = await resolveStyle(ctx.cwd);
			const cliArgs = style === "legacy" ? ["status"] : ["--status"];
			const targetRoot = configuredWorkspaceRoot(ctx.cwd) ?? ctx.cwd;
			try {
				const result = await pi.exec(zgBinary(), cliArgs, {
					cwd: targetRoot,
					timeout: STATUS_TIMEOUT_MS,
				});
				const text = (result.stdout || result.stderr).trim();
				if (result.code !== 0) {
					ctx.ui.notify(`zvec-grep status failed: ${text || `exit ${result.code}`}`, "error");
					return;
				}
				ctx.ui.notify(text || "(no status output)", "info");
			} catch (error) {
				ctx.ui.notify(
					`zvec-grep status failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("zg-server", {
		description: "Manage the shared zvec-grep MCP daemon: /zg-server [on|off|status]",
		handler: async (args, ctx) => {
			const action = args.trim().split(/\s+/)[0] || "status";
			if (!["on", "off", "status"].includes(action)) {
				ctx.ui.notify("Usage: /zg-server [on|off|status]", "warning");
				return;
			}
			const style = await resolveStyle(ctx.cwd);
			try {
				const result = await runServerAction(pi, style, action as "on" | "off" | "status", ctx.cwd);
				const text = (result.stdout || result.stderr).trim();
				ctx.ui.notify(text || `zvec-grep server ${action}: exit ${result.code}`, result.code === 0 ? "info" : "error");
			} catch (error) {
				ctx.ui.notify(
					`zvec-grep server failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!statusEnabled()) return;
		try {
			const style = await resolveStyle(ctx.cwd);
			const cliArgs = style === "legacy" ? ["status"] : ["--status"];
			const targetRoot = configuredWorkspaceRoot(ctx.cwd) ?? ctx.cwd;
			const result = await pi.exec(zgBinary(), cliArgs, {
				cwd: targetRoot,
				timeout: STATUS_TIMEOUT_MS,
			});
			ctx.ui.setStatus(
				"zvec-grep",
				result.code === 0 ? "index ready" : "no index — run /zg-index",
			);
		} catch {
			// zg is not installed or not on PATH; tools surface the error when used.
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("zvec-grep", undefined);
	});
}

// Exported for unit testing without booting pi.
export {
	buildRgArgs,
	buildSearchArgs,
	styleForVersion,
	boundOutput,
	loadExtensionConfig,
	resolveTargetRoots,
	configuredWorkspaceRoot,
	parseIndexArgs,
	formatRootResults,
};
