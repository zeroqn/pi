/**
 * zvec-grep (zg) on a code-mode surface.
 *
 * This package registers **no pi tool**. It is a `pi-host-bridge` contributor — the shape
 * `pi-web-access` established and `pi-ask-user-question` repeated — whose offer is two host functions a
 * code-mode cell calls:
 *
 *     hits  = await zvec_grep_search(query="where is auth validated", limit=7)
 *     lines = await zvec_grep_rg("rg -n -F loadTheme -g '*.ts' src | head -40")
 *
 * plus user-invoked maintenance commands, which a host function cannot replace because a human types
 * them:
 *
 *   /zg-enable [--rebuild] [--root <path>] [embedding-model]   (index + server on)
 *   /zg-index [--rebuild] [--drop] [--root <path>] [embedding-model]
 *   /zg-index-all        (strategy B escalation only)
 *   /zg-status
 *   /zg-status-all [<scan-root>]   (list every indexed workspace + last-index time)
 *   /zg-server [on|off|status]
 *
 * The two pi tools that stood here were unreachable: code mode's mount calls `setActiveTools(["python"])`
 * on every session, so no surface ever offered them while the routing block told the model to call
 * them. `.scratch/zvec-grep` is the effort that moved the lane.
 *
 * Default strategy (A): a single parent workspace containing the related repos. Point `workspaceRoot`
 * at it once; every search and index then uses that one index, so ranking is fused across all repos.
 * Per-repo indexes with a `roots` fan-out (strategy B) remain available as an explicit escalation.
 *
 * Optional configuration:
 *   ZVEC_GREP_BIN        Path to the zg binary (default: "zg")
 *   ZVEC_GREP_CLI_STYLE  "modern" | "legacy" to skip auto-detection
 *   ZVEC_GREP_PI_STATUS  "0" to disable the session_start footer status
 *   ZVEC_GREP_PI_WORKSPACE  Strategy A parent workspace root (A default)
 *   ZVEC_GREP_PI_ROOTS   Strategy B comma/newline-separated roots (opt-in)
 *   ZVEC_GREP_EMBEDDING  Embedding model for a new index
 *
 * Two CLI generations are auto-detected (`src/cli.ts`): modern (zg >= 0.2.1) and legacy
 * (zg <= 0.2.0, which this host has).
 *
 * Registration happens at module load, not from the factory: pi loads each extension entry through its
 * own jiti instance, so the factory may never run in the process that composes a session, while the
 * process-global slot host-bridge reads is written either way.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
	API_VERSION,
	registerContributor,
	type ContributorAnswer,
	type SessionInput,
} from "../host-bridge/src/convention.ts";
import {
	INDEX_TIMEOUT_MS,
	STATUS_TIMEOUT_MS,
	createZgCli,
	lastNonEmptyLine,
	parseIndexArgs,
	serverAction,
	type Exec,
} from "./src/cli.ts";
import {
	configuredEmbedding,
	configuredRoots,
	configuredWorkspaceRoot,
	ensureNestedRepoInclude,
} from "./src/config.ts";
import { createZvecGrepHost } from "./src/host.ts";

/** This package's name in a kernel's receipts, records and refusals. */
export const OWNER = "zvec-grep";

/**
 * The contribution's prose, in cell terms — the package's own words about its own functions.
 *
 * No `systemPrompt` rides with it, unlike web-access's untrusted-content rule or
 * `ask_user_question`'s "this exists" note: these sentences land in the `python` tool's description
 * through the ledger, for a root and a child alike, so a second copy in the system prompt would only
 * be a copy. The routing rule *between* the search routes is the user's, and lives in the prompt.
 */
export const ZVEC_GREP_DESCRIPTION =
	" Host functions also include await zvec_grep_search(query=…, limit=7, globs=[…], file_types=[…])" +
	" for ranked hybrid, lexical and vector search over this workspace's zvec-grep index, and await" +
	" zvec_grep_rg(command) for exhaustive managed ripgrep, which needs no index and takes the ripgrep" +
	` command you would otherwise run — e.g. await zvec_grep_rg("rg -n -F loadTheme -g '*.ts' src | head -40").` +
	" Both return what zg printed, as text bounded at 80 000 characters, and raise RuntimeError only when" +
	" every root failed; root defaults to this session's directory, and roots=[…] fans out over several" +
	" workspaces. zg must be on PATH (or ZVEC_GREP_BIN must point at it) and the workspace needs an index" +
	" (/zg-index builds one). Read-only mode permits both calls.";

export const ZVEC_GREP_GUIDELINES = [
	"Use await zvec_grep_search(query=…) when the answer is grounded in this workspace but the exact wording or location is unknown, or when semantic, fuzzy, relationship, chronology, causality, comparison or cross-file synthesis is needed; it needs a built index.",
	"Do not use zvec_grep_search for open-world knowledge or external facts unrelated to the local workspace — that is await web_search(...).",
	"Use await zvec_grep_rg(command) for exhaustive exact, literal or regex search when ranked indexed results are not appropriate; scope it with a path, -g/--glob or -t/--type, and append `| head -N` to bound the output.",
	"Its arguments are snake_case (file_types, excluded_file_types, symbol_type, prefer_symbol, modified_after, modified_before); the old camelCase spellings still bind. An unknown parameter raises ValueError and nothing runs, on purpose — a misspelled argument is meant to be loud.",
];

/** What this package contributes to one session. It does not branch on `isChild`: a delegated coding task wants search as much as its spawner does, and there is no UI to gate on. */
export function zvecGrepAnswer(input: SessionInput): ContributorAnswer {
	return {
		contribution: {
			owner: OWNER,
			hostFns: createZvecGrepHost({
				cwd: input.cwd,
				progress: input.progress,
				// The run's abort, read through the handle this session was handed (long-work ticket 08):
				// a `zg` search is foreground work, and an aborted turn must not leave one running.
				signal: () => input.handle.runSignal?.(),
			}),
			description: ZVEC_GREP_DESCRIPTION,
			guidelines: ZVEC_GREP_GUIDELINES,
		},
	};
}

export const zvecGrepRegistration = {
	key: "pi-zvec-grep",
	owner: OWNER,
	apiVersion: API_VERSION,
	session: (input: SessionInput) => zvecGrepAnswer(input),
};

registerContributor(zvecGrepRegistration);

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

/** Every footer value says whose line it is; the key stays `"zvec-grep"`. */
function status(text: string): string {
	return `zg: ${text}`;
}

export default function zvecGrepExtension(pi: ExtensionAPI) {
	// pi's executor is what the commands run through — a user-invoked command can be cancelled with the
	// session. The host functions cannot use it: a contributor is handed no `pi` (host-bridge's
	// `SessionInput`), so `src/cli.ts` spawns for itself, which is what `pi.exec` does anyway.
	const piExec: Exec = (command, args, options) => pi.exec(command, args, options);
	const cli = createZgCli({ exec: piExec });

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
			ctx.ui.setStatus("zvec-grep", status(`indexing ${targetRoot}…`));
			const indexArgs = style === "legacy" ? ["index"] : ["--index"];
			if (model) indexArgs.push("--embedding", model);
			if (parsed.rebuild) indexArgs.push("--rebuild");
			const indexResult = await cli.run(indexArgs, {
				cwd: targetRoot,
				timeout: INDEX_TIMEOUT_MS,
			});
			const indexOk = indexResult.code === 0;

			ctx.ui.setStatus("zvec-grep", status("starting server…"));
			const serverResult = await serverAction(cli, style, "on", targetRoot);
			const serverOk = serverResult.code === 0;

			ctx.ui.setStatus(
				"zvec-grep",
				status(indexOk && serverOk ? "index ready · server on" : "setup incomplete"),
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

			ctx.ui.setStatus("zvec-grep", status(drop ? "dropping index…" : `indexing ${targetRoot}…`));
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
				ctx.ui.setStatus("zvec-grep", status("index ready"));
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
				ctx.ui.setStatus("zvec-grep", status(`indexing ${index + 1}/${roots.length}: ${root}`));
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
			ctx.ui.setStatus("zvec-grep", status(failures === 0 ? "index ready" : "index incomplete"));
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
				status(result.code === 0 ? "index ready" : "no index — run /zg-index"),
			);
		} catch {
			// zg is not installed or not on PATH; the host functions surface the error when used.
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("zvec-grep", undefined);
	});
}
