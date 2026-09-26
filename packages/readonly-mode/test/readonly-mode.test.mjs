import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import factory from "../index.ts";
import { checkReadOnlyCommand } from "../bash-allowlist.ts";
import { contributors, recordSession, sessionKey } from "../../host-bridge/src/convention.ts";

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

let sessionCounter = 0;

function load({
	flag = false,
	active = ["read", "bash", "edit", "write", "todowrite", "read_symbol"],
	entries = [],
	sessionFile,
	hasUI = false,
	confirm = null,
} = {}) {
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

	// A real session file, so the seam keys this session the way it keys a live one.
	const file = sessionFile ?? `/sessions/readonly-mode-${(sessionCounter += 1)}.jsonl`;
	// What this session's own transcript received from another extension — which is how a spawner
	// writes the marker into a child's session.
	const transcript = [];
	const confirmations = [];
	const ctx = {
		hasUI,
		ui: {
			notify: (message) => notifications.push(message),
			setStatus: (key, value) => statuses.set(key, value),
			theme: { fg: (_color, text) => text },
			confirm: async (title, message) => {
				confirmations.push({ title, message });
				return confirm ? confirm(title, message) : false;
			},
		},
		sessionManager: {
			getEntries: () => entries,
			getSessionFile: () => file,
			appendCustomEntry: (type, data) => {
				transcript.push({ type, data });
				return `entry-${transcript.length}`;
			},
		},
	};

	return {
		handlers,
		commands,
		shortcuts,
		appended,
		notifications,
		statuses,
		ctx,
		file,
		transcript,
		confirmations,
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
	const result = await before({ systemPrompt: "BASE" }, h.ctx);
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

// ---------------------------------------------------------------------------
// The cell lane (`.scratch/readonly-guard` ticket 04): the guard this extension
// contributes to a code-mode kernel. The two audiences are told apart by *how* a
// decision is reached — the guard is a function of the call, so it is tested as
// one, with no kernel and no monty.
// ---------------------------------------------------------------------------

/**
 * Load the extension, start its session, and read back the guard it registered.
 *
 * `handleApiVersion` is the contract version the mounted code mode reports: 2 knows the `guard`
 * slot, anything lower does not.
 */
async function cellLane({ flag = false, entries = [], handleApiVersion = 2, isChild = false, shells = [], hasUI = false, confirm = null } = {}) {
	const h = load({ flag, entries, hasUI, confirm });
	await h.handlers.session_start[0]({}, h.ctx);
	const key = sessionKey(h.ctx);
	const registration = contributors().find((r) => r.owner === "readonly-mode" && r.key.endsWith(key));
	// The two handle members a policy uses to see and stop the shells the mount cannot reach.
	const handle = {
		apiVersion: handleApiVersion,
		backgrounds: () => shells,
		killBackgrounds: async (ids) => {
			const wanted = ids && ids.length > 0 ? ids : null;
			const killed = shells
				.filter((shell) => shell.status === "running" && (!wanted || wanted.includes(shell.id)))
				.map((shell) => shell.id);
			for (const id of killed) shells.find((shell) => shell.id === id).status = "killed";
			return killed;
		},
	};
	const answer = registration?.session({
		ctx: h.ctx,
		sessionKey: key,
		handle,
		isChild,
		cwd: "/workspace",
		sessionFile: undefined,
	});
	return { h, key, registration, answer, shells, guard: answer?.contribution?.guard };
}

const allowed = (verdict) => verdict === undefined;

test("registers for its own session, under a key that cannot be taken by a second load", async () => {
	const { key, registration, guard } = await cellLane();
	assert.ok(registration, "expected a registration in the seam");
	assert.match(registration.key, new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
	assert.ok(guard, "expected a guard contribution");

	// A guard answers for one session only: the key is the session's own.
	assert.deepEqual(registration.session({ sessionKey: "another-session", handle: { apiVersion: 2 } }), {});
});

test("the mount is read-only exactly while the mode is on", async () => {
	const { h, guard } = await cellLane();
	assert.equal(guard.mountMode(), "read-write");
	await toggleOn(h);
	assert.equal(guard.mountMode(), "read-only");
	await toggleOn(h);
	assert.equal(guard.mountMode(), "read-write");
});

test("the shell lane is checkReadOnlyCommand's, verbatim — and only while the mode is on", async () => {
	const { h, guard } = await cellLane();
	const bash = (command) => guard.before({ name: "bash_host", args: [command] });

	assert.ok(allowed(bash("rm -rf /")), "the guard does nothing while the mode is off");

	await toggleOn(h);
	assert.equal(bash("rm -rf /").allow, false);
	assert.match(bash("rm -rf /").reason, /not on the read-only allowlist/);
	assert.match(bash("git push").reason, /modify the repository/);
	assert.ok(allowed(bash("git log --oneline")));
	// Code mode's calling shape: a trailing kwargs object is where a named call lands.
	assert.match(guard.before({ name: "bash_host", args: [{ command: "rm -rf /" }] }).reason, /allowlist/);
});

test("code mode's own reads are not the policy's business", async () => {
	const { h, guard } = await cellLane();
	await toggleOn(h);
	for (const name of ["find", "grep", "read_image", "bg_poll", "bg_read", "bg_kill", "bg_list"]) {
		assert.ok(allowed(guard.before({ name, args: [] })), `expected ${name} to be untouched`);
	}
});

test("an exempt extension call passes, and an unlisted one is refused with the fix named", async () => {
	const { h, guard } = await cellLane();
	await toggleOn(h);

	assert.ok(allowed(guard.before({ name: "rlm_spawn", args: ["look at it"] })));
	assert.ok(allowed(guard.before({ name: "web_search", args: ["anything"] })));

	const verdict = guard.before({ name: "some_new_capability", args: [] });
	assert.equal(verdict.allow, false);
	assert.match(verdict.reason, /'some_new_capability' is not on the read-only exemption list/);
	assert.match(verdict.reason, /EXEMPT_HOST_CALLS/);
});

test("the tool bridge's route is judged on the name it carries", async () => {
	const { h, guard } = await cellLane();
	await toggleOn(h);
	const route = (...args) => guard.before({ name: "tool", args });

	assert.ok(allowed(route("ctx_search", { query: "x" })), "a listed capability");
	assert.ok(allowed(route("ctx_memory", { content: "x" })), "Magic Context's store is deliberately exempt");
	assert.ok(allowed(route()), "introspection (`await tool()` lists) asks for nothing");
	assert.ok(allowed(route({ name: "ctx_expand" })), "a named call lands in the kwargs object");

	const refused = route("ctx_something_new");
	assert.equal(refused.allow, false);
	assert.match(refused.reason, /'ctx_something_new' is not on the read-only exemption list/);
});

test("every exemption carries a reason, and no name is listed twice", async () => {
	// The list is hand-edited, so the two ways a hand edit goes wrong are pinned: a name nobody can
	// justify, and a name added twice so a later deletion looks like it worked.
	const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
	const entries = [...source.matchAll(/\{ name: "([a-z_]+)", reason: "(.+?)" \}/g)];
	assert.ok(entries.length > 10, "expected the exemption list to be read");
	const names = entries.map((entry) => entry[1]);
	assert.equal(new Set(names).size, names.length, `duplicate exemption: ${names.join(", ")}`);
	for (const [, name, reason] of entries) {
		assert.ok(reason.length > 10, `${name} needs a reason a reader can weigh`);
	}
});

test("a code mode too old to know the guard is refused, and its cell with it", async () => {
	const { h, answer, guard } = await cellLane({ handleApiVersion: 1 });
	assert.equal(guard, undefined, "nothing is contributed to a code mode that would refuse it whole");
	assert.equal(answer.contribution, undefined);
	assert.match(answer.problems.join(" "), /contract version 1, and a guard needs 2/);

	// The floor: no guard, no `python`. Fail-closed costs the cell, never the workspace.
	await toggleOn(h);
	const veto = await h.handlers.tool_call[0]({ toolName: "python", input: { code: "1" } });
	assert.match(veto.reason, /cannot be enforced inside a cell/);

	// And a cell is only refused while the mode is on.
	await h.commands.readonly.handler("", h.ctx);
	assert.equal(await h.handlers.tool_call[0]({ toolName: "python", input: {} }), undefined);
});

test("a guard is contributed for a fresh session even when the mode is restored from a resume", async () => {
	const entries = [
		{ type: "custom", customType: "readonly-mode", data: { enabled: true, toolsBefore: ["read", "bash"] } },
	];
	const { guard } = await cellLane({ entries });
	assert.equal(guard.mountMode(), "read-only", "a resumed session keeps the guard it was saved with");
	assert.equal(guard.before({ name: "some_new_capability", args: [] }).allow, false);
});

test("the prompt describes the cell only where there is a governed kernel to describe", async () => {
	// No kernel: the prompt is the tool-and-shell one, which is all that is true there.
	const bare = load();
	await toggleOn(bare);
	const plain = (await bare.handlers.before_agent_start[0]({ systemPrompt: "BASE" }, bare.ctx)).systemPrompt;
	assert.match(plain, /## Read-only mode \(active\)/);
	assert.doesNotMatch(plain, /mounted read-only/);

	// A governed kernel: the cell half appears, and says what actually happens inside one.
	const { h, guard } = await cellLane();
	assert.ok(guard, "expected the guard to have been contributed");
	await toggleOn(h);
	const withCell = (await h.handlers.before_agent_start[0]({ systemPrompt: "BASE" }, h.ctx)).systemPrompt;
	assert.match(withCell, /your Python runs in one kernel whose workspace is mounted read-only/);
	assert.match(withCell, /raise `PermissionError` there/);
	assert.match(withCell, /declared exception, not a licence/);

	// Off is off: neither half is injected.
	await h.commands.readonly.handler("", h.ctx);
	assert.equal(await h.handlers.before_agent_start[0]({ systemPrompt: "BASE" }, h.ctx), undefined);
});

test("a session whose kernel cannot be governed is not told it is", async () => {
	const { h } = await cellLane({ handleApiVersion: 1 });
	await toggleOn(h);
	const prompt = (await h.handlers.before_agent_start[0]({ systemPrompt: "BASE" }, h.ctx)).systemPrompt;
	assert.doesNotMatch(prompt, /mounted read-only/, "the mount half would be a lie here");
	// The floor is what tells the truth instead: the tool is refused, and the refusal says why.
	assert.match((await h.handlers.tool_call[0]({ toolName: "python", input: {} })).reason, /cannot be enforced inside a cell/);
});

test("the inventory check reports both ways the hand-edited list goes wrong", async () => {
	const { h, key } = await cellLane();
	// What the seam recorded for this session: rlm's name is listed, one name is new, and the tool
	// bridge reached a single capability — so four listed capabilities are gone from this surface.
	recordSession(key, {
		mounted: true,
		owners: ["rlm", "pi-tool-bridge"],
		installed: ["rlm_spawn", "brand_new_thing"],
		reaches: ["ctx_search"],
		promptTexts: [],
		problems: [],
	});
	await toggleOn(h);
	await h.handlers.before_agent_start[0]({ systemPrompt: "BASE" }, h.ctx);

	assert.ok(
		h.notifications.some((n) => /brand_new_thing is contributed/.test(n)),
		"a live name that is not listed has to be reported",
	);
	assert.ok(
		h.notifications.some((n) => /ctx_expand is on the read-only exemption list/.test(n)),
		"a listed name nothing contributes has to be reported",
	);
	assert.ok(
		!h.notifications.some((n) => /rlm_spawn is contributed/.test(n)),
		"a listed live name is not",
	);
	assert.equal(h.appended.filter((entry) => entry.type === "readonly-mode-inventory").length, 1);

	// Said once per session: a second turn does not repeat it.
	const before = h.notifications.length;
	await h.handlers.before_agent_start[0]({ systemPrompt: "BASE" }, h.ctx);
	assert.equal(h.notifications.length, before);
});

test("a child's narrowed surface is not mistaken for a name that is gone", async () => {
	const { h, key } = await cellLane({ isChild: true });
	recordSession(key, {
		mounted: true,
		owners: ["rlm"],
		installed: ["rlm_spawn"],
		reaches: [],
		promptTexts: [],
		problems: [],
	});
	await toggleOn(h);
	await h.handlers.before_agent_start[0]({ systemPrompt: "BASE" }, h.ctx);
	assert.equal(h.notifications.filter((n) => /remove the line/.test(n)).length, 0);
	// The other direction still holds: a child that reaches something unlisted is told.
	assert.ok(h.notifications.length > 0, "the unlisted half is asked of every session");
});

test("nothing is said when there is no kernel to be wrong about", async () => {
	const h = load();
	await toggleOn(h);
	await h.handlers.before_agent_start[0]({ systemPrompt: "BASE" }, h.ctx);
	assert.equal(h.notifications.filter((n) => /exemption list|remove the line/.test(n)).length, 0);
	assert.deepEqual(h.appended.filter((entry) => entry.type === "readonly-mode-inventory"), []);
});

// ---------------------------------------------------------------------------
// The child lane (ticket 05): a child's mode comes from its spawner, as a live floor.
// ---------------------------------------------------------------------------

/**
 * What a spawn does to the contributors: the seam's own dispatch, done here by hand.
 *
 * `pi-host-bridge`'s `bindChild` is exactly this loop (every registration that declares one, contained
 * so one cannot stop another), and it is its own tested behaviour; importing `compose.ts` would drag
 * its runtime import of `client` into a suite that runs on node, which will not resolve an
 * extensionless relative import.
 */
const spawn = (childFile, parentFile) => {
	for (const registration of contributors()) {
		if (typeof registration.bindChild === "function") {
			registration.bindChild({ childSessionFile: childFile, parentSessionFile: parentFile, cwd: "/workspace" });
		}
	}
};

const ask = (registration, sessionKey_, isChild) =>
	registration.session({ ctx: {}, sessionKey: sessionKey_, handle: { apiVersion: 2 }, isChild, cwd: "/workspace" });

const registrationFor = (key) => contributors().find((r) => r.key === `readonly-mode@${key}`);

test("a child inherits its spawner's floor, and follows it", async () => {
	const parent = await cellLane();
	const childFile = "/sessions/child-of-floor.jsonl";
	spawn(childFile, parent.key);

	// Nothing holds it yet: the spawner is not read-only.
	assert.equal(ask(parent.registration, childFile, true).contribution.guard.mountMode(), "read-write");

	await toggleOn(parent.h);
	const childGuard = ask(parent.registration, childFile, true).contribution.guard;
	assert.equal(childGuard.mountMode(), "read-only");
	assert.equal(childGuard.before({ name: "some_new_capability", args: [] }).allow, false);
	assert.ok(childGuard.before({ name: "rlm_spawn", args: [] }) === undefined, "a child may still delegate");

	// The floor is the spawner's *live* answer, not the state at the moment of the spawn.
	await toggleOn(parent.h);
	assert.equal(childGuard.mountMode(), "read-write");
});

test("a child's own instance cannot widen what its spawner holds", async () => {
	const parent = await cellLane();
	await toggleOn(parent.h);
	const childFile = "/sessions/child-own.jsonl";
	spawn(childFile, parent.key);

	// The child's own load of this entry: its own flag is off, which is all it knows about itself.
	const child = load({ sessionFile: childFile });
	await child.handlers.session_start[0]({}, child.ctx);
	const childKey = sessionKey(child.ctx);
	const guard = ask(registrationFor(childKey), childKey, true).contribution.guard;
	assert.equal(guard.mountMode(), "read-only", "the floor is the spawner's, not the child's own flag");
	assert.equal(guard.before({ name: "some_new_capability", args: [] }).allow, false);
});

test("a grandchild inherits through a child", async () => {
	const parent = await cellLane();
	await toggleOn(parent.h);
	const childFile = "/sessions/child-mid.jsonl";
	const grandFile = "/sessions/child-grand.jsonl";
	spawn(childFile, parent.key);

	const child = load({ sessionFile: childFile });
	await child.handlers.session_start[0]({}, child.ctx);
	const childKey = sessionKey(child.ctx);
	spawn(grandFile, childKey);

	// The middle session's own flag is false, and what holds it is its own spawner's floor: the
	// grandchild has to inherit the *effective* answer, not the raw one.
	const guard = ask(registrationFor(childKey), grandFile, true).contribution.guard;
	assert.equal(guard.mountMode(), "read-only");
});

test("a registration answers for its own session and its children, and for nobody else", async () => {
	const parent = await cellLane();
	assert.deepEqual(ask(parent.registration, "/sessions/stranger.jsonl", false), {});
});

// ---------------------------------------------------------------------------
// The inherited hold (ticket 02): the marker a spawner writes into a child's own
// transcript, and who may lift it.
// ---------------------------------------------------------------------------

const INHERITED = "readonly-mode-inherited";
const marker = (enabled) => ({ type: "custom", customType: INHERITED, data: { enabled, from: "/sessions/parent.jsonl" } });

/** The child ctx a spawner hands to the seam: a real session whose transcript we can read. */
function childCtx(file) {
	const transcript = [];
	return {
		transcript,
		ctx: {
			ui: { notify() {}, setStatus() {}, theme: { fg: (_c, text) => text } },
			sessionManager: {
				getEntries: () => [],
				getSessionFile: () => file,
				appendCustomEntry: (type, data) => {
					transcript.push({ type, data });
					return `entry-${transcript.length}`;
				},
			},
		},
	};
}

test("a spawner writes its answer into the child's own transcript, every time it answers", async () => {
	const parent = await cellLane();
	const childFile = "/sessions/marked-child.jsonl";
	spawn(childFile, parent.key);
	const child = childCtx(childFile);
	const askWith = (ctx) =>
		parent.registration.session({ ctx, sessionKey: childFile, handle: { apiVersion: 2 }, isChild: true, cwd: "/workspace" });

	// Writable: the marker still lands, so a later resume is not left guessing — and so a relaxation
	// rewrites a read-only record rather than leaving it behind.
	askWith(child.ctx);
	assert.deepEqual(child.transcript.at(-1), { type: INHERITED, data: { enabled: false, from: parent.key } });

	await toggleOn(parent.h);
	askWith(child.ctx);
	assert.deepEqual(child.transcript.at(-1), { type: INHERITED, data: { enabled: true, from: parent.key } });
});

test("a resumed child that carries the marker starts read-only", async () => {
	const h = load({ entries: [marker(true)] });
	await h.handlers.session_start[0]({}, h.ctx);
	assert.ok(h.statuses.get("readonly-mode"), "expected the status line");
	assert.deepEqual(h.tools(), ["read", "bash", "todowrite", "read_symbol"]);
	// And the guard agrees, so the kernel is mounted read-only without the child being told anything.
	const { guard } = await (async () => {
		const registration = contributors().find((r) => r.key === `readonly-mode@${sessionKey(h.ctx)}`);
		return registration.session({
			ctx: h.ctx,
			sessionKey: sessionKey(h.ctx),
			handle: { apiVersion: 2 },
			isChild: true,
			cwd: "/workspace",
		}).contribution;
	})();
	assert.equal(guard.mountMode(), "read-only");
});

test("a resumed child may lift the hold itself, and the lift is what persists", async () => {
	const h = load({ entries: [marker(true)] });
	await h.handlers.session_start[0]({}, h.ctx);

	await toggleOn(h); // the mode is on, so this turns it off
	assert.equal(h.statuses.get("readonly-mode"), undefined);
	assert.deepEqual(h.tools(), ["read", "bash", "edit", "write", "todowrite", "read_symbol"]);
	// Its own decision is written down as its own, which is what makes it survive the next resume.
	assert.equal(h.appended.at(-1).data.enabled, false);
	assert.doesNotMatch(h.notifications.at(-1), /held by the session that spawned/);
});

test("a live hold cannot be lifted from inside the child, and the toggle says why", async () => {
	const parent = await cellLane();
	await toggleOn(parent.h);
	const childFile = "/sessions/held-child.jsonl";
	spawn(childFile, parent.key);

	const child = load({ sessionFile: childFile });
	await child.handlers.session_start[0]({}, child.ctx);
	assert.ok(child.statuses.get("readonly-mode"), "the child inherits the live hold");

	await toggleOn(child); // tries to turn it off
	assert.match(child.notifications.at(-1), /held by the session that spawned/);
	assert.ok(child.statuses.get("readonly-mode"), "the hold is not the child's to lift");
	// Nothing was written down as the child's own decision, so a resume cannot mistake it for one.
	assert.deepEqual(child.appended, []);
});

test("a root session with neither marker nor floor is unchanged", async () => {
	const h = load();
	await h.handlers.session_start[0]({}, h.ctx);
	assert.equal(h.statuses.get("readonly-mode"), undefined);
	assert.deepEqual(h.tools(), ["read", "bash", "edit", "write", "todowrite", "read_symbol"]);
});

// ---------------------------------------------------------------------------
// The shells the mount cannot reach (ticket 03): the toggle asks, and "wait"
// means the mode waits.
// ---------------------------------------------------------------------------

const aShell = (id = "bg-1") => ({
	id,
	command: "npm run build",
	status: "running",
	started_at: "2026-09-25T14:00:00.000Z",
});

test("with no dialog-capable UI the shells are killed, not waited for", async () => {
	const { h, shells } = await cellLane({ shells: [aShell()] });
	await toggleOn(h);
	assert.equal(shells[0].status, "killed");
	assert.equal(h.statuses.get("readonly-mode"), "🔒 read-only");
	assert.match(h.notifications.join(" "), /killed 1 background shell\(s\)/);
	// The mode is on and the tools are filtered: nobody was available to say otherwise.
	assert.ok(!h.tools().includes("edit"));
});

test("with a UI the toggle asks, and kills the ones it is told to kill", async () => {
	const { h, shells } = await cellLane({ shells: [aShell()], hasUI: true, confirm: () => true });
	await toggleOn(h);
	assert.equal(shells[0].status, "killed");
	assert.equal(h.statuses.get("readonly-mode"), "🔒 read-only");
	assert.equal(h.confirmations.length, 1);
	// The question names what it is about to stop, not a count it guessed.
	assert.match(h.confirmations[0].message, /bg-1 — npm run build/);
});

test("answering no keeps the mode off until the shells finish, and the status says so", async () => {
	const { h, shells } = await cellLane({ shells: [aShell()], hasUI: true, confirm: () => false });
	await toggleOn(h);

	assert.equal(shells[0].status, "running", "a spared shell is left alone");
	assert.equal(h.statuses.get("readonly-mode"), "🔒 read-only (waiting for 1 shell(s))");
	assert.ok(h.tools().includes("edit"), "the mode is not on, so nothing has been taken away");
	assert.match(h.notifications.join(" "), /off until 1 background shell\(s\) finish/);

	// The wait ends at the turn boundary, once nothing is running — and the turn is the first read-only
	// one, because the prompt is built after this.
	shells[0].status = "done";
	await h.handlers.before_agent_start[0]({ systemPrompt: "BASE" }, h.ctx);
	assert.equal(h.statuses.get("readonly-mode"), "🔒 read-only");
	assert.ok(!h.tools().includes("edit"));
	const prompt = (await h.handlers.before_agent_start[0]({ systemPrompt: "BASE" }, h.ctx))?.systemPrompt ?? "";
	assert.match(prompt, /## Read-only mode \(active\)/);
});

test("a wait still running at the boundary stays a wait", async () => {
	const { h } = await cellLane({ shells: [aShell()], hasUI: true, confirm: () => false });
	await toggleOn(h);
	await h.handlers.before_agent_start[0]({ systemPrompt: "BASE" }, h.ctx);
	assert.equal(h.statuses.get("readonly-mode"), "🔒 read-only (waiting for 1 shell(s))");
});

test("a second /readonly cancels the wait rather than asking again", async () => {
	const { h, shells } = await cellLane({ shells: [aShell()], hasUI: true, confirm: () => false });
	await toggleOn(h);
	await toggleOn(h); // cancels

	assert.equal(h.statuses.get("readonly-mode"), undefined);
	assert.equal(h.confirmations.length, 1, "the second press asks nothing");
	assert.equal(shells[0].status, "running");
	assert.match(h.notifications.at(-1), /wait was cancelled/);
});
