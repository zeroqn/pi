/**
 * The in-process learner fork (spec §4.3, ticket 11).
 *
 * `createAgentSession` with an explicit minimal `ResourceLoader` and exactly one
 * tool. The loader is the recursion guard: it keeps this extension — and every
 * other — from loading into the fork, keeps the fork's reads out of the usage
 * ledger, and keeps other extensions' handlers off a background agent's tool
 * calls. The fork runs on the parent's credentials and dies with the session.
 *
 * This module is pi glue and is not unit-tested; the decisions it carries out
 * live in `skill-actions.ts` and `prompt.ts`, which are.
 */

import * as path from "node:path";
import { existsSync } from "node:fs";
import type { AgentToolResult, CreateAgentSessionOptions, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, resolveCliModel, SessionManager } from "@earendil-works/pi-coding-agent";
import type { RsiConfig } from "./config.ts";
import { runSkillAction, type SkillActionDeps, type SkillActionInput } from "./skill-actions.ts";

export interface ForkSession {
	abort(): Promise<void>;
}

export interface ForkOptions {
	cwd: string;
	agentDir: string;
	config: RsiConfig;
	prompt: string;
	deps: SkillActionDeps;
	/** The parent session's model, used when `reviewModel` is not configured. */
	fallbackModel?: CreateAgentSessionOptions["model"];
	/** Called once the fork exists, so a session shutdown can abort it. */
	onSession?: (session: ForkSession) => void;
}

export interface ForkResult {
	ok: boolean;
	/** Successful mutating store actions; a failed pass with none rolls back. */
	toolActions: number;
	modelLabel?: string;
	error?: string;
}

export async function runLearningFork(options: ForkOptions): Promise<ForkResult> {
	const { cwd, agentDir, config, deps } = options;
	let toolActions = 0;
	const tool = buildStoreTool(deps, () => {
		toolActions++;
	});

	let modelRuntime: ModelRuntime | undefined;
	let model = options.fallbackModel;
	let thinkingLevel: CreateAgentSessionOptions["thinkingLevel"];
	let modelLabel = "session default";

	if (config.reviewModel) {
		try {
			const modelsPath = path.join(agentDir, "models.json");
			modelRuntime = await ModelRuntime.create({
				authPath: path.join(agentDir, "auth.json"),
				modelsPath: existsSync(modelsPath) ? modelsPath : null,
			});
			const resolved = resolveCliModel({ cliModel: config.reviewModel, modelRuntime });
			if (resolved.error) return { ok: false, toolActions, error: `reviewModel: ${resolved.error}` };
			if (resolved.model) {
				model = resolved.model;
				modelLabel = config.reviewModel;
			}
			thinkingLevel = resolved.thinkingLevel;
		} catch (error) {
			return { ok: false, toolActions, error: `model runtime: ${message(error)}` };
		}
	}
	if (!thinkingLevel && config.thinking) {
		thinkingLevel = config.thinking as CreateAgentSessionOptions["thinkingLevel"];
	}

	let loader: DefaultResourceLoader;
	try {
		loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();
	} catch (error) {
		return { ok: false, toolActions, error: `resource loader: ${message(error)}` };
	}

	let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
	try {
		({ session } = await createAgentSession({
			cwd,
			agentDir,
			modelRuntime,
			model,
			thinkingLevel,
			resourceLoader: loader,
			noTools: "all",
			tools: ["skill_store"],
			customTools: [tool],
			sessionManager: SessionManager.inMemory(cwd),
		}));
	} catch (error) {
		return { ok: false, toolActions, error: `createAgentSession: ${message(error)}` };
	}

	options.onSession?.(session);

	const ceilingMs = config.stageCeilingMinutes * 60_000;
	const timer = setTimeout(() => {
		void session.abort();
	}, ceilingMs);

	try {
		await session.prompt(options.prompt, { expandPromptTemplates: false });
		return { ok: true, toolActions, modelLabel };
	} catch (error) {
		return { ok: false, toolActions, modelLabel, error: message(error) };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * A hand-written JSON Schema rather than `Type.Object`: the schema is plain JSON
 * to the provider, and avoiding the runtime typebox import keeps this module
 * loadable under Node's type stripping.
 */
const SKILL_STORE_PARAMETERS = {
	type: "object",
	properties: {
		action: { type: "string", enum: ["list", "read", "create", "patch", "archive", "propose"] },
		name: { type: "string", description: "Skill name (lowercase words separated by single hyphens)." },
		description: { type: "string", description: "What the skill does and when to use it." },
		body: { type: "string", description: "Markdown body: ## When this applies, ## How, and ## Verification when procedural." },
		scope: { type: "string", description: '"general" or a project key; defaults to the pass scope.' },
		reason: { type: "string", description: "For propose: why this should be reviewed by a human." },
		files: {
			type: "array",
			description: "Optional payload files under scripts/, references/ or assets/.",
			items: {
				type: "object",
				properties: { path: { type: "string" }, content: { type: "string" } },
				required: ["path", "content"],
			},
		},
	},
	required: ["action"],
	additionalProperties: false,
} as const;

function buildStoreTool(deps: SkillActionDeps, countAction: () => void): ToolDefinition {
	const tool = {
		name: "skill_store",
		label: "Skill store",
		description:
			"The learned-skill store. Use action=list to see existing skills, action=read to read one, action=create to add a skill, action=propose to send a change to a human instead. Nothing here can run commands or touch the project.",
		promptSnippet: "skill_store: list, read, create and propose learned skills",
		parameters: SKILL_STORE_PARAMETERS,
		execute: async (_toolCallId: string, params: SkillActionInput): Promise<AgentToolResult<unknown>> => {
			const result = await runSkillAction(params, deps);
			if (!result.isError && result.action !== undefined && result.action !== "list" && result.action !== "read") {
				countAction();
			}
			return {
				content: [{ type: "text", text: result.text }],
				details: {},
				isError: result.isError === true,
			} as AgentToolResult<unknown>;
		},
	};
	return tool as unknown as ToolDefinition;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
