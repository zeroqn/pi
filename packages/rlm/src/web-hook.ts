/**
 * The web host-function hook — map ticket 03.
 *
 * rlm owns the wire: the two names, the descriptor text, the journal entries and the
 * failure surface. A module named by `RLM_WEB_MODULE` owns the implementations, and is
 * asked for them once per kernel with that kernel's context.
 *
 * Two moments, deliberately separate:
 *
 *   - **Load time** (`resolveWebHook`, awaited at module scope in `index.ts`): import
 *     the module and check its *shape*, so the tool description promises exactly what
 *     exists. Absence is normal and silent; a broken module is loud and promises
 *     nothing. Top-level await is fine — pi's extension loader accepts it (verified),
 *     and this runs before any session exists.
 *   - **Kernel start** (`instantiateWebHook`): call the factory with this kernel's
 *     cwd, session file and a progress forwarder, then require exactly the contract's
 *     names. Anything else injects nothing and says why — never a stub.
 */

export const WEB_NAMES = ["web_search", "fetch_content"] as const;
export type WebName = (typeof WEB_NAMES)[number];

export type WebContext = {
	cwd: string;
	sessionFile?: string;
	/** Forwarded to the current cell's progress channel; may be called at any time. */
	progress?: (text: string) => void;
};

export type WebFactory = (ctx: WebContext) => unknown;

export type WebPlan =
	| { status: "none" }
	| { status: "loaded"; module: string; factory: WebFactory }
	| { status: "error"; module: string; reason: string };

export type WebInstantiation =
	| { status: "none" }
	| { status: "injected"; names: readonly WebName[]; fns: Record<string, unknown> }
	| { status: "error"; reason: string };

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Import the configured module and check its shape. Called once per process, at
 * extension load: the environment variable does not change under a running session,
 * and the description must be built before the tool is registered.
 *
 * A relative specifier resolves against the process's working directory, which is what
 * a hand-written `RLM_WEB_MODULE=./host.ts` means to the person who wrote it.
 */
export async function resolveWebHook(env: NodeJS.ProcessEnv = process.env): Promise<WebPlan> {
	const spec = String(env.RLM_WEB_MODULE ?? "").trim();
	if (!spec) return { status: "none" };
	const resolved = spec.startsWith("/") ? spec : `${process.cwd()}/${spec.replace(/^\.\//, "")}`;
	let imported: unknown;
	try {
		imported = await import(resolved);
	} catch (error) {
		return { status: "error", module: resolved, reason: `import failed: ${errorText(error)}` };
	}
	const factory = isRecord(imported) ? imported.createHost : undefined;
	if (typeof factory !== "function") {
		return { status: "error", module: resolved, reason: "module does not export createHost()" };
	}
	return { status: "loaded", module: resolved, factory: factory as WebFactory };
}

/**
 * Ask the module for this kernel's host functions and require exactly the contract's
 * names. A missing name, an extra name, or a non-function value is a contract
 * mismatch: nothing is injected, and the caller records the reason.
 */
export function instantiateWebHook(plan: WebPlan, ctx: WebContext): WebInstantiation {
	if (plan.status === "none") return { status: "none" };
	if (plan.status === "error") return { status: "error", reason: plan.reason };
	let returned: unknown;
	try {
		returned = plan.factory(ctx);
	} catch (error) {
		return { status: "error", reason: `createHost() threw: ${errorText(error)}` };
	}
	if (!isRecord(returned)) {
		return { status: "error", reason: `createHost() returned ${returned === null ? "null" : typeof returned}, expected an object` };
	}
	const keys = Object.keys(returned);
	const missing = WEB_NAMES.filter((name) => !keys.includes(name));
	const extra = keys.filter((key) => !(WEB_NAMES as readonly string[]).includes(key));
	const problems = [
		...missing.map((name) => `missing ${name}`),
		...extra.map((key) => `unexpected ${key}`),
		...WEB_NAMES.filter((name) => keys.includes(name) && typeof returned[name] !== "function").map(
			(name) => `${name} is not a function`,
		),
	];
	if (problems.length > 0) return { status: "error", reason: `contract mismatch: ${problems.join(", ")}` };
	return { status: "injected", names: WEB_NAMES, fns: returned };
}

const WEB_DESCRIPTION =
	" Host functions also include await web_search(query, num_results=5, provider=None, domain_filter=None), which searches DuckDuckGo and then AnySearch " +
	'and returns {query, provider, results:[{title,url,snippet,content}], errors}; and await fetch_content(url, mode="markdown"), which writes the page text ' +
	'to SCRATCH and returns {url, title, path, chars, head} — read or grep that path for more than the head. mode="raw" writes the response bytes and returns ' +
	"{url, path, bytes, content_type} instead. Fetches are http and https only and refuse local and private addresses: a check on this tool, not a sandbox — " +
	"the kernel's bash is unfiltered.";

const WEB_GUIDELINES = [
	"Use await web_search(query, num_results=5, provider=None, domain_filter=None) for web research: it returns {query, provider, results:[{title,url,snippet,content}], errors}, where a per-provider failure beside a success is data in errors.",
	'Use await fetch_content(url, mode="markdown") to read a page: it writes the text to SCRATCH and returns {url, title, path, chars, head}, so grep or read the path instead of printing the head twice; mode="raw" writes the bytes and returns {path, bytes, content_type}.',
];

/** The description gains its web sentences only when a module is loaded and shaped right. */
export function webDescriptionSuffix(plan: WebPlan): string {
	return plan.status === "loaded" ? WEB_DESCRIPTION : "";
}

/** Same rule for the guidelines: nothing is promised that cannot be called. */
export function webPromptGuidelines(plan: WebPlan): string[] {
	return plan.status === "loaded" ? [...WEB_GUIDELINES] : [];
}
