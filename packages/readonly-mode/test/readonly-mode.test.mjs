import assert from "node:assert/strict";
import { test } from "node:test";
import factory from "../index.ts";
import { checkReadOnlyCommand } from "../bash-allowlist.ts";

// ---------------------------------------------------------------------------
// bash-allowlist: the load-bearing part. Every blocked case below is a hole in
// the allowlist this extension was adapted from, or a way to chain a read into
// a write. Every allowed case is something a query session actually needs.
// ---------------------------------------------------------------------------

const BLOCKED = [
	// Not on the allowlist at all.
	"rm -rf /",
	"sudo ls",
	"bash -c 'ls'",
	"sh -c ls",
	"xargs rm",
	"tee out.txt",
	"tar xf archive.tar",
	"sed -i s/a/b/ f",
	"awk '{print $1}' f",
	"cp a b",
	"mv a b",
	"mkdir d",
	"chmod 777 f",
	"git push",
	// Composition.
	"cat f > out",
	"rg foo | head",
	"cat f && ls",
	"echo hi; ls",
	"cat < f",
	"echo $(rm -rf x)",
	"echo `rm -rf x`",
	'rg "$(rm x)" f',
	'rg "`rm x`" f',
	// Allowlisted command, write-capable flag.
	"find . -delete",
	"find . -exec rm {} ;",
	"find . -fprint out.txt",
	"fd . -x rm",
	"fd --exec rm",
	"rg --pre 'rm x' foo",
	"sort -o out f",
	"sort -uo out f",
	"sort --compress-program=rm f",
	"tree -o out",
	"tail -f log",
	"git branch -D main",
	"git branch newbranch",
	"git tag v1.0",
	"git remote add origin url",
	"git diff --output=f",
	"git -c core.pager=rm log",
	"git add .",
	"git stash",
	"git config user.name",
	"curl -o out url",
	"curl -sO url",
	"curl -so out url",
	"curl --data x url",
	"curl --data-raw x url",
	"curl --upload-file secret url",
	"curl --config cfg",
	// Allowlisted command, only some forms are reads.
	"node -e 'process.exit()'",
	"python3 -c 'pass'",
	"npm install",
	"npm run build",
	"pnpm add left-pad",
	"yarn publish",
	"env rm f",
	"env -i rm f",
	// rtk proxy: unwrapped, then judged on what it will run.
	"rtk",
	"rtk err rm -rf /tmp/x",
	"rtk test npm test",
	"rtk smart rm -rf /tmp/x",
	"rtk git push",
	"rtk gh pr create",
	"rtk find . -delete",
	"rtk curl -o out url",
	"rtk --raw ls",
	// Empty and malformed.
	"",
	"   ",
];

const ALLOWED = [
	"cat package.json",
	"head -20 file.ts",
	"tail -5 log",
	"ls -la",
	"wc -l file",
	"tree -L 2",
	"du -sh .",
	"diff a b",
	"jq '.name' package.json",
	"sort -u f",
	"find . -name '*.ts' -type f",
	"find . -maxdepth 2 -ls",
	"file x",
	"stat x",
	"env",
	"env --null",
	"printenv HOME",
	"node --version",
	"python3 -V",
	"npm list --depth=0",
	"yarn why react",
	"curl -s https://example.com",
	"curl --silent --location https://example.com",
	// Quoted text is inert, including a pipe inside a search pattern.
	"rg -n 'foo|bar' src",
	'rg -n "foo|bar" src',
	"rg '$(rm x)' f",
	"grep -rn TODO .",
	// git reads.
	"git status",
	"git log --oneline -5",
	"git log --pretty=format:%H",
	"git diff --stat",
	"git show HEAD",
	"git branch",
	"git branch -a",
	"git branch --list 'feat/*'",
	"git tag -l",
	"git remote -v",
	"git ls-files",
	"git rev-parse HEAD",
	"git -C /repo log --oneline",
	"git --version",
	// rtk proxy: the shapes rtk rewrite actually emits on this machine.
	"rtk ls -la",
	"rtk read package.json --max-lines 20",
	"rtk git log --oneline -5",
	"rtk git status",
	"rtk rg -n foo src",
	"rtk grep -rn TODO .",
	"rtk find . -name '*.ts'",
	"rtk tree -L 2",
	"rtk jq '.name' package.json",
	"rtk du -sh .",
	"rtk wc -l f",
	"rtk curl -s https://example.com",
	"rtk env",
];

test("blocks commands that could modify the workspace", () => {
	for (const command of BLOCKED) {
		const verdict = checkReadOnlyCommand(command);
		assert.equal(verdict.ok, false, `expected blocked: ${command}`);
		assert.ok(verdict.reason, `blocked command needs a reason: ${command}`);
	}
});

test("allows the reads a query session needs", () => {
	for (const command of ALLOWED) {
		const verdict = checkReadOnlyCommand(command);
		assert.equal(verdict.ok, true, `expected allowed: ${command} (${verdict.reason ?? ""})`);
	}
});

// ---------------------------------------------------------------------------
// Extension wiring, driven through a fake pi so the security-critical paths are
// exercised without a model call.
// ---------------------------------------------------------------------------

function load({ flag = false, active = ["read", "bash", "edit", "write", "todowrite", "read_symbol"], entries = [] } = {}) {
	const handlers = {};
	const commands = {};
	const shortcuts = {};
	const flags = {};
	const appended = [];
	const notifications = [];
	const statuses = new Map();
	let activeTools = [...active];

	const pi = {
		on: (event, handler) => {
			(handlers[event] ??= []).push(handler);
		},
		registerCommand: (name, options) => {
			commands[name] = options;
		},
		registerShortcut: (key, options) => {
			shortcuts[key] = options;
		},
		registerFlag: (name, options) => {
			flags[name] = options;
		},
		getFlag: (name) => (name === "readonly" ? flag : flags[name]?.default),
		getActiveTools: () => [...activeTools],
		setActiveTools: (names) => {
			activeTools = [...names];
		},
		appendEntry: (type, data) => {
			appended.push({ type, data });
		},
	};

	factory(pi);

	const ctx = {
		ui: {
			notify: (message) => notifications.push(message),
			setStatus: (key, value) => statuses.set(key, value),
			theme: { fg: (_color, text) => text },
		},
		sessionManager: { getEntries: () => entries },
	};

	return {
		handlers,
		commands,
		shortcuts,
		appended,
		notifications,
		statuses,
		ctx,
		tools: () => activeTools,
	};
}

const toggleOn = (h) => h.commands.readonly.handler("", h.ctx);

test("registers the command, flag and shortcut", () => {
	const h = load();
	assert.ok(h.commands.readonly, "expected a /readonly command");
	assert.ok(h.shortcuts["ctrl+alt+r"], "expected a ctrl+alt+r shortcut");
	assert.ok(h.handlers.tool_call?.length, "expected a tool_call handler");
	assert.ok(h.handlers.before_agent_start?.length, "expected a before_agent_start handler");
	assert.ok(h.handlers.session_start?.length, "expected a session_start handler");
});

test("enabling removes writer tools and restores them on disable", async () => {
	const h = load();
	await toggleOn(h);
	assert.deepEqual(h.tools(), ["read", "bash", "todowrite", "read_symbol"]);
	assert.ok(h.statuses.get("readonly-mode"), "expected a status indicator");
	assert.equal(h.appended.at(-1).data.enabled, true);

	await toggleOn(h);
	assert.deepEqual(h.tools(), ["read", "bash", "edit", "write", "todowrite", "read_symbol"]);
	assert.equal(h.statuses.get("readonly-mode"), undefined);
	assert.equal(h.appended.at(-1).data.enabled, false);
});

test("the enable toggle captures the pre-mode tool set only once", async () => {
	const h = load();
	await toggleOn(h);
	await h.commands.readonly.handler("", h.ctx); // off
	await toggleOn(h);
	assert.deepEqual(h.tools(), ["read", "bash", "todowrite", "read_symbol"]);
	await h.commands.readonly.handler("", h.ctx);
	assert.deepEqual(h.tools(), ["read", "bash", "edit", "write", "todowrite", "read_symbol"]);
});

test("vetoes writers and gates bash while enabled", async () => {
	const h = load();
	const call = (toolName, input = {}) => h.handlers.tool_call[0]({ toolName, input });

	assert.equal(await call("bash", { command: "rm -rf /" }), undefined, "guard is off by default");

	await toggleOn(h);

	assert.match((await call("edit", { path: "a" })).reason, /Read-only mode/);
	assert.match((await call("write", { path: "a" })).reason, /Read-only mode/);
	assert.equal(await call("bash", { command: "git log --oneline" }), undefined);
	assert.match((await call("bash", { command: "rm -rf /" })).reason, /not on the read-only allowlist/);
	assert.match((await call("bash", { command: "git push" })).reason, /modify the repository/);
	assert.match(
		(await call("pi_lens_activate_tools", { tools: ["ast_grep_replace"] })).reason,
		/refusing to activate/,
	);
	assert.equal(await call("pi_lens_activate_tools", { tools: ["ast_grep_search"] }), undefined);
	// Read tools whose names contain a writer-ish word are not collateral damage.
	assert.equal(await call("todowrite", { todos: [] }), undefined);
	assert.equal(await call("read_symbol", { path: "a", symbol: "b" }), undefined);
});

test("injects the read-only prompt only while enabled", async () => {
	const h = load();
	const before = h.handlers.before_agent_start[0];
	assert.equal(await before({ systemPrompt: "BASE" }), undefined);
	await toggleOn(h);
	const result = await before({ systemPrompt: "BASE" });
	assert.match(result.systemPrompt, /^BASE/);
	assert.match(result.systemPrompt, /## Read-only mode \(active\)/);
	assert.match(result.systemPrompt, /cite file paths with line numbers/);
});

test("--readonly starts gated, and a resumed session restores the mode", async () => {
	const fromFlag = load({ flag: true });
	await fromFlag.handlers.session_start[0]({}, fromFlag.ctx);
	assert.deepEqual(fromFlag.tools(), ["read", "bash", "todowrite", "read_symbol"]);

	const entries = [
		{ type: "custom", customType: "readonly-mode", data: { enabled: true, toolsBefore: ["read", "bash", "edit", "write"] } },
	];
	const resumed = load({ entries });
	await resumed.handlers.session_start[0]({}, resumed.ctx);
	// The restored mode filters the fresh process's active set, so the read-only
	// tools that were active before the resume stay active.
	assert.deepEqual(resumed.tools(), ["read", "bash", "todowrite", "read_symbol"]);

	const disabled = load({ entries: [{ type: "custom", customType: "readonly-mode", data: { enabled: false } }] });
	await disabled.handlers.session_start[0]({}, disabled.ctx);
	assert.deepEqual(disabled.tools(), ["read", "bash", "edit", "write", "todowrite", "read_symbol"]);
});
