/**
 * zvec-grep (zg) integration for pi.
 *
 * pi intentionally ships without a built-in MCP client, so this extension exposes zvec-grep's
 * local-first search layer:
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
 *   /zg-status-all [<scan-root>]   (list every indexed workspace + last-index time)
 *   /zg-server [on|off|status]
 *
 * Default strategy (A): a single parent workspace containing the related repos. Point `workspaceRoot`
 * at it once; every search and index then uses that one index, so ranking is fused across all repos.
 * Per-repo indexes with a `roots` fan-out (strategy B) remain available as an explicit escalation.
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
 *
 * The two search capabilities are becoming **host functions a code-mode cell calls**
 * (`.scratch/zvec-grep`): `src/host.ts` holds them, and the two `registerTool` calls below are what
 * ticket 04 deletes. Everything the entry and the commands share — argv, the CLI generation, the
 * spawned process, the root rules — lives in `src/cli.ts` and `src/config.ts` now, and is reachable
 * without booting pi.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Type, type Static } from "typebox";

import {
	INDEX_TIMEOUT_MS,
	RG_TIMEOUT_MS,
	buildRgArgs,
	buildSearchArgs,
	SEARCH_TIMEOUT_MS,
	STATUS_TIMEOUT_MS,
	createZgCli,
	formatRootResults,
	lastNonEmptyLine,
	parseIndexArgs,
	runAcrossRoots,
	serverAction,
	tokenizeRgCommand,
	type CliStyle,
	type Exec,
} from "./src/cli.ts";
import {
	configuredEmbedding,
	configuredRoots,
	configuredWorkspaceRoot,
	ensureNestedRepoInclude,
	resolveTargetRoots,
} from "./src/config.ts";

function statusEnabled(): boolean {
	const value = process.env.ZVEC_GREP_PI_STATUS?.trim().toLowerCase();
	return value !== "0" && value !== "false" && value !== "off";
}

type IndexedWorkspace = {
	root: string;
	name: string;
	updatedTime: number;
	embedding?: string;
};

/** Read `<root>/.zvec-grep/manifest.json` and describe the indexed workspace, if any. */
function readIndexedWorkspace(root: string): IndexedWorkspace | undefined {
	const manifestPath = join(root, ".zvec-grep", "manifest.json");
	if (!existsSync(manifestPath)) return undefined;
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			name?: unknown;
			updatedTime?: unknown;
			embedding?: { model?: unknown } | null;
		};
		const model =
			manifest.embedding && typeof manifest.embedding.model === "string"
				? manifest.embedding.model
				: undefined;
		return {
			root,
			name:
				typeof manifest.name === "string" && manifest.name.trim()
					? manifest.name.trim()
					: basename(root),
			updatedTime: typeof manifest.updatedTime === "number" ? manifest.updatedTime : 0,
			embedding: model,
		};
	} catch {
		return undefined;
	}
}

/**
 * Discover indexed workspaces at `scanRoot` and its immediate children.
 *
 * zg keeps no workspace registry, so the portable signal is each workspace's
 * `<root>/.zvec-grep/manifest.json`. Explicit `extraRoots` (configured strategy
 * B roots) are checked even when they live outside the scan root.
 */
function discoverIndexedWorkspaces(
	scanRoot: string,
	extraRoots: readonly string[] = [],
): IndexedWorkspace[] {
	const candidates: string[] = [scanRoot, ...extraRoots];
	try {
		for (const entry of readdirSync(scanRoot, { withFileTypes: true })) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
			if (entry.name === ".git" || entry.name === ".zvec-grep" || entry.name === "node_modules") {
				continue;
			}
			candidates.push(join(scanRoot, entry.name));
		}
	} catch {
		// Unreadable scan root: still probe the explicit roots.
	}
	const seen = new Set<string>();
	const found: IndexedWorkspace[] = [];
	for (const candidate of candidates.map((entry) => resolve(entry))) {
		if (seen.has(candidate)) continue;
		seen.add(candidate);
		const workspace = readIndexedWorkspace(candidate);
		if (workspace) found.push(workspace);
	}
	return found.sort((a, b) => b.updatedTime - a.updatedTime);
}

/** Compact age such as `12m ago`; `never` for a missing timestamp. */
function formatAge(from: number, now = Date.now()): string {
	if (!from) return "never";
	const seconds = Math.max(0, Math.round((now - from) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

function formatWorkspaceList(
	workspaces: readonly IndexedWorkspace[],
	scanRoot: string,
	now = Date.now(),
): string {
	if (workspaces.length === 0) {
		return `No indexed workspaces found under ${scanRoot}.\nRun /zg-index (or /zg-enable) to create one.`;
	}
	const lines = workspaces.map((workspace, index) => {
		const model = workspace.embedding ? ` · ${workspace.embedding}` : "";
		const age = workspace.updatedTime ? formatAge(workspace.updatedTime, now) : "never indexed";
		return `${String(index + 1).padStart(2)}. ${workspace.name}  ${workspace.root}  updated ${age}${model}`;
	});
	return [`Indexed workspaces under ${scanRoot} (${workspaces.length})`, "", ...lines].join("\n");
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

export default function zvecGrepExtension(pi: ExtensionAPI) {
	// pi's executor is still what the commands and the (not yet deleted) tools run through, and
	// `createZgCli` takes it as a parameter so there is one CLI implementation rather than two.
	const piExec: Exec = (command, args, options) => pi.exec(command, args, options);
	const cli = createZgCli({ exec: piExec });

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

			const style: CliStyle = await cli.style(ctx.cwd);
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
				details: { roots },
			});

			const outcomes = await runAcrossRoots(cli, roots, args, signal, SEARCH_TIMEOUT_MS);
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

			const style: CliStyle = await cli.style(ctx.cwd);
			const args = buildRgArgs(style, rgArgs);
			const outcomes = await runAcrossRoots(cli, roots, args, signal, RG_TIMEOUT_MS);
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
			const style = await cli.style(ctx.cwd);

			ensureNestedRepoInclude(targetRoot);
			ctx.ui.setStatus("zvec-grep", `indexing ${targetRoot}…`);
			const indexArgs = style === "legacy" ? ["index"] : ["--index"];
			if (model) indexArgs.push("--embedding", model);
			if (parsed.rebuild) indexArgs.push("--rebuild");
			const indexResult = await cli.run(indexArgs, {
				cwd: targetRoot,
				timeout: INDEX_TIMEOUT_MS,
			});
			const indexOk = indexResult.code === 0;

			ctx.ui.setStatus("zvec-grep", "starting zvec-grep server…");
			const serverResult = await serverAction(cli, style, "on", targetRoot);
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

			if (!drop) {
				ensureNestedRepoInclude(targetRoot);
			}

			const style = await cli.style(ctx.cwd);
			const cliArgs: string[] =
				style === "legacy" ? ["index"] : ["--index"];
			if (model) cliArgs.push("--embedding", model);
			if (rebuild) cliArgs.push("--rebuild");
			if (drop) cliArgs.push("--drop", "--yes");

			ctx.ui.setStatus("zvec-grep", drop ? "dropping index…" : `indexing ${targetRoot}…`);
			try {
				const result = await cli.run(cliArgs, {
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

			const style = await cli.style(ctx.cwd);
			let failures = 0;
			for (const [index, root] of roots.entries()) {
				ensureNestedRepoInclude(root);
				ctx.ui.setStatus("zvec-grep", `indexing ${index + 1}/${roots.length}: ${root}`);
				const cliArgs = style === "legacy" ? ["index"] : ["--index"];
				if (model) cliArgs.push("--embedding", model);
				if (rebuild) cliArgs.push("--rebuild");
				const result = await cli.run(cliArgs, {
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
			const style = await cli.style(ctx.cwd);
			const cliArgs = style === "legacy" ? ["status"] : ["--status"];
			const targetRoot = configuredWorkspaceRoot(ctx.cwd) ?? ctx.cwd;
			try {
				const result = await cli.run(cliArgs, {
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

	pi.registerCommand("zg-status-all", {
		description:
			"List every indexed workspace under a scan root with its last-index time: /zg-status-all [<scan-root>] [--root <path>]",
		handler: async (args, ctx) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const rootFlag = tokens.indexOf("--root");
			const flagValue = rootFlag === -1 ? undefined : tokens[rootFlag + 1]?.trim() || undefined;
			const positional = tokens.find(
				(token, index) => !token.startsWith("-") && index !== rootFlag + 1,
			);
			const scanRoot = resolve(
				flagValue ?? positional ?? dirname(configuredWorkspaceRoot(ctx.cwd) ?? ctx.cwd),
			);
			const workspaces = discoverIndexedWorkspaces(scanRoot, configuredRoots(ctx.cwd));
			ctx.ui.notify(formatWorkspaceList(workspaces, scanRoot), "info");
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
			const style = await cli.style(ctx.cwd);
			try {
				const result = await serverAction(cli, style, action as "on" | "off" | "status", ctx.cwd);
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
			const style = await cli.style(ctx.cwd);
			const cliArgs = style === "legacy" ? ["status"] : ["--status"];
			const targetRoot = configuredWorkspaceRoot(ctx.cwd) ?? ctx.cwd;
			const result = await cli.run(cliArgs, {
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
