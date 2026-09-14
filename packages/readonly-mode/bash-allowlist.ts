/**
 * Read-only bash gate for readonly-mode.
 *
 * Pure and dependency-free so the rules can be tested directly
 * (test/readonly-mode.test.mjs). Posture, in order:
 *
 *  1. No composition. Substitution, expansion, redirection, pipes, chaining and
 *     subshells are rejected, so a read command cannot chain its way into a
 *     write. Single-quoted spans are inert and skipped; double-quoted spans are
 *     skipped only after the expansion check, because "$(...)" still expands
 *     inside double quotes.
 *  2. Fail closed. The first word (its basename, so /bin/cat passes) must be on
 *     the allowlist. Shells, wrappers and interpreters (sh, env, xargs, sudo,
 *     timeout, eval, ...) are absent by design, so nothing can re-introduce
 *     arbitrary execution.
 *  3. Per-command rules. Commands that can write through a flag of their own
 *     (find -delete, fd -x, sort -o, tree -o, curl -o, ...), and commands whose
 *     only read-only form is a version probe, a read subcommand, or a plain
 *     GET, get an extra gate.
 *
 * The gate reasons about text, so it blocks whatever it cannot reason about.
 * It is a guardrail against incident, not a sandbox: bash still has the process
 * filesystem and network, and side effects invisible in the command line (a git
 * alias that shells out, an editor writing a swap file) are out of reach.
 */

export interface CommandVerdict {
	ok: boolean;
	reason?: string;
}

const HINT =
	"Use the read, ffgrep, fffind or zvec_grep tools instead of shelling out, or run /readonly to leave read-only mode.";

const ALLOWED_COMMANDS = new Set([
	// File and directory inspection.
	"cat", "head", "tail", "less", "more", "nl", "wc", "file", "stat", "du", "df", "tree",
	"ls", "pwd", "basename", "dirname", "realpath", "readlink", "which", "whereis",
	// Search and text shaping. Commands that write through a flag keep their gate below.
	"grep", "rg", "fd", "find", "jq", "cut", "sort", "uniq", "diff", "comm",
	"md5sum", "sha1sum", "sha256sum", "base64", "echo", "printf",
	// System and environment inspection.
	"uname", "whoami", "id", "date", "uptime", "ps", "env", "printenv",
	// Version probes only (see VERSION_ONLY).
	"node", "python", "python3", "deno", "bun", "go", "cargo", "rustc",
	// Package managers, read subcommands only (see PKG_READ).
	"npm", "pnpm", "yarn",
	// git, read subcommands only (see GIT_READ_SUBCOMMANDS and GIT_RULES).
	"git",
	// Plain GET to stdout only (see the curl gate).
	"curl",
]);

const VERSION_ONLY_COMMANDS = new Set(["node", "python", "python3", "deno", "bun", "go", "cargo", "rustc"]);
const VERSION_ONLY = /^\s*(node|python|python3|deno|bun|go|cargo|rustc)\s+(--version|-v|-V|--help|-h)\s*$/;

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);
const PKG_READ =
	/^\s*(npm|pnpm|yarn)\s+(list|ls|view|info|show|why|explain|search|outdated|audit|licenses|doctor|help|--version|-v)\b/;

const GIT_READ_SUBCOMMANDS = new Set([
	"status", "log", "diff", "show", "branch", "tag", "remote", "ls-files", "ls-tree",
	"ls-remote", "rev-parse", "rev-list", "blame", "describe", "shortlog", "for-each-ref",
	"cat-file", "name-rev", "whatchanged", "grep", "show-ref", "count-objects", "version", "help",
]);

/** Anything that writes, or that runs a helper program git finds on disk. */
const GIT_RULES: Array<{ pattern: RegExp; reason: string }> = [
	{
		pattern: /\bgit\s+(-c|--config-env|--exec-path|--upload-pack|--receive-pack)(\s|=)/,
		reason: "that git option can execute a helper program",
	},
	{
		pattern: /\bgit\s+(?:-C\s+\S+\s+)?(add|commit|push|pull|fetch|merge|rebase|reset|checkout|switch|restore|clean|apply|am|init|clone|gc|prune|update-ref|symbolic-ref|notes|filter-branch|replace|submodule|sparse-checkout|difftool|mergetool|web--browse|bisect|archive|bundle|repack|maintenance|fast-import)(\s|$)/,
		reason: "that git subcommand can modify the repository or run a program",
	},
	{
		pattern: /\bgit\s+(branch|tag)\s+[^-\s]/,
		reason: "git branch/tag with a name creates or moves it",
	},
	{
		pattern: /\bgit\s+(branch|tag)\s+(?:-\w*[dDmMcCfuU]\w*|--(?:delete|move|copy|force|set-upstream-to))(\s|$|=)/,
		reason: "that git branch/tag flag deletes or moves",
	},
	{
		pattern: /\bgit\s+remote\s+(add|remove|rm|set-url|rename|prune|update|set-head|set-branches)(\s|$)/,
		reason: "that git remote subcommand rewrites config",
	},
	{
		pattern: /\bgit\s+(diff|log|show|format-patch)\b[^\n]*\s(?:-o|--output)/,
		reason: "git can write its output to a file",
	},
];

/** Per-command gates, applied to the whole line. */
const COMMAND_RULES: Record<string, Array<{ pattern: RegExp; reason: string }>> = {
	tail: [{ pattern: /(^|\s)-\w*f\w*(\s|$)|--follow/, reason: "tail -f would block; use a bounded tail" }],
	env: [{ pattern: /^\s*env\s+(?!--null$|-0$)/, reason: "env with an operand runs it as a command; only bare env reads" }],
	printenv: [{ pattern: /^\s*printenv\s+\S+\s+\S/, reason: "printenv takes at most one variable name" }],
	sort: [
		{ pattern: /(^|\s)-\w*o/, reason: "sort -o writes a file" },
		{ pattern: /--output/, reason: "sort --output writes a file" },
		{ pattern: /--compress-program/, reason: "sort --compress-program runs a program" },
	],
	tree: [
		{ pattern: /(^|\s)-\w*o/, reason: "tree -o writes a file" },
		{ pattern: /--output/, reason: "tree --output writes a file" },
	],
	find: [
		{
			pattern: /(^|\s)-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)(\s|$)/,
			reason: "find can delete files, run commands, or write files through that predicate",
		},
	],
	fd: [{ pattern: /(^|\s)-\w*[xX]\w*(\s|$)|--exec(-batch)?(\s|$|=)/, reason: "fd -x/--exec runs a command" }],
	rg: [{ pattern: /--pre(-glob)?(\s|=|$)/, reason: "rg --pre runs a command" }],
	curl: [
		{
			pattern: /(^|\s)-\w*[oOTXdFbuKH]\w*(\s|$|=)/,
			reason: "curl is limited to a plain GET to stdout; that flag writes a file, uploads, or shapes a request",
		},
		{
			pattern:
				/(^|\s)--(config|output|remote-name|upload-file|request|cookie|user|header|proxy|netrc|output-dir|create-dirs)(\s|=|$)/,
			reason: "curl is limited to a plain GET to stdout; that flag writes a file or shapes a request",
		},
		{
			pattern: /(^|\s)--(data|form|json|url-query|url-encode)\S*(\s|=|$)/,
			reason: "curl is limited to a plain GET to stdout",
		},
	],
};

/**
 * The rtk extension (rtk.ts) rewrites bash commands to `rtk <subcommand> ...`
 * for token savings, mutating the tool call before execution, so this gate is
 * handed the rewritten text. Unwrap the proxy and validate what it will run:
 * `rtk git log` is checked as `git log`, `rtk read f` as `cat f`. rtk's own
 * subcommands that only print (read, json, deps, env) are checked as `cat`,
 * which is what they are. Subcommands with no read-only meaning (err, test,
 * smart, gh, glab, aws, psql) fall through to the allowlist and are blocked.
 */
const PROXY = "rtk";
const PROXY_READ_SUBCOMMANDS: Record<string, string> = { read: "cat", json: "cat", deps: "cat", env: "cat" };
const MAX_PROXY_DEPTH = 3;

const EXPANSION = /[`$]/;
const COMPOSITION = /[;&|<>()\n]/;
const SINGLE_QUOTED = /'[^']*'/g;
const DOUBLE_QUOTED = /"[^"]*"/g;
const FIRST_TOKEN = /^\s*(\S+)/;
const GIT_LEADING_OPTIONS = /^\s*(\S+)\s+(?:-C\s+\S+\s+)?/;

function block(reason: string): CommandVerdict {
	return { ok: false, reason };
}

export function checkReadOnlyCommand(command: string): CommandVerdict {
	return check(command, 0);
}

function check(command: string, depth: number): CommandVerdict {
	const line = command.trim();
	if (line === "") return block("empty command");

	// Expansion can reach inside double quotes, so it is checked before any
	// quoting is stripped. Single-quoted text is inert by shell rules.
	const withoutSingleQuotes = line.replace(SINGLE_QUOTED, "''");
	if (EXPANSION.test(withoutSingleQuotes)) {
		return block(`command substitution and variable expansion are not allowed. ${HINT}`);
	}

	// Pipes, redirection, chaining, subshells. Double-quoted spans are inert now
	// that expansion has been ruled out, so `rg "foo|bar"` still works.
	const withoutDoubleQuotes = withoutSingleQuotes.replace(DOUBLE_QUOTED, '""');
	if (COMPOSITION.test(withoutDoubleQuotes)) {
		return block(`pipes, redirection and command chaining are not allowed; run one command at a time. ${HINT}`);
	}

	// Fail closed on anything not on the allowlist. Compare the basename so
	// /bin/cat reads and /usr/bin/rm does not pass as "rm's own path".
	const first = line.match(FIRST_TOKEN)?.[1] ?? "";
	const base = first.split("/").pop() ?? first;

	// Validate the command behind a rewrite rather than the rewrite.
	if (base === PROXY) {
		if (depth >= MAX_PROXY_DEPTH) return block(`${PROXY} is nested too deeply to validate`);
		const after = line.replace(/^\s*\S+\s+/, "");
		if (after === line) return block(`bare ${PROXY} has no read-only meaning. ${HINT}`);
		const subcommand = after.match(FIRST_TOKEN)?.[1] ?? "";
		const mapped = PROXY_READ_SUBCOMMANDS[subcommand];
		return check(mapped ? after.replace(FIRST_TOKEN, mapped) : after, depth + 1);
	}

	if (!ALLOWED_COMMANDS.has(base)) {
		return block(`"${base}" is not on the read-only allowlist. ${HINT}`);
	}

	for (const { pattern, reason } of COMMAND_RULES[base] ?? []) {
		if (pattern.test(line)) return block(reason);
	}

	if (VERSION_ONLY_COMMANDS.has(base) && !VERSION_ONLY.test(line)) {
		return block(`${base} would execute code; in read-only mode it is limited to --version and --help`);
	}
	if (PACKAGE_MANAGERS.has(base) && !PKG_READ.test(line)) {
		return block(
			`${base} is limited to read subcommands (list, view, why, outdated, audit); install, run and exec change files or execute code`,
		);
	}
	if (base === "git") {
		for (const { pattern, reason } of GIT_RULES) {
			if (pattern.test(line)) return block(reason);
		}
		const subcommand = (line.replace(GIT_LEADING_OPTIONS, "").match(FIRST_TOKEN)?.[1] ?? "").replace(/^-+/, "");
		if (!GIT_READ_SUBCOMMANDS.has(subcommand)) {
			return block(`git ${subcommand || "(none)"} is not on the read-only list`);
		}
	}

	return { ok: true };
}
