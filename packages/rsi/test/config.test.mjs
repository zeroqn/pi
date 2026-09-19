import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { configPathFor, defaultStorePath, loadConfig, saveConfig } from "../config.ts";

function tempAgent() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "rsi-cfg-"));
}

function writeConfig(agentDir, body) {
	const file = configPathFor(agentDir);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, body);
}

// ---------------------------------------------------------------------------
// loadConfig — the extension must never fail to load because config is absent
// or malformed; bad values fall back to their default and are reported.
// ---------------------------------------------------------------------------

test("missing config yields the documented defaults and no warnings", (t) => {
	const agentDir = tempAgent();
	t.after(() => fs.rmSync(agentDir, { recursive: true, force: true }));

	const { config, warnings } = loadConfig({ agentDir });
	assert.deepEqual(warnings, []);
	assert.equal(config.enabled, true);
	assert.equal(config.observeOnly, true);
	assert.equal(config.quietMinutes, 5);
	assert.equal(config.minIntervalMinutes, 15);
	assert.equal(config.stageCeilingMinutes, 10);
	assert.equal(config.disuseWeeks, 6);
	assert.equal(config.consolidateEveryWeeks, 4);
	assert.equal(config.maxActiveSkills, 25);
	assert.deepEqual(config.disabledProjects, []);
	assert.equal(config.storePath, defaultStorePath(agentDir));
});

test("JSONC comments and trailing commas are accepted", (t) => {
	const agentDir = tempAgent();
	t.after(() => fs.rmSync(agentDir, { recursive: true, force: true }));

	writeConfig(
		agentDir,
		[
			"{",
			"\t// quiet period before a pass",
			"\t\"quietMinutes\": 7,",
			"\t\"observeOnly\": false,",
			"\t\"disabledProjects\": [",
			'\t\t"github.com/acme/legacy",',
			"\t],",
			"\t/* models */",
			'\t"reviewModel": "small",',
			"}",
		].join("\n"),
	);

	const { config, warnings } = loadConfig({ agentDir });
	assert.deepEqual(warnings, []);
	assert.equal(config.quietMinutes, 7);
	assert.equal(config.observeOnly, false);
	assert.deepEqual(config.disabledProjects, ["github.com/acme/legacy"]);
	assert.equal(config.reviewModel, "small");
});

test("values with comment-like or comma-like text inside strings survive", (t) => {
	const agentDir = tempAgent();
	t.after(() => fs.rmSync(agentDir, { recursive: true, force: true }));

	writeConfig(agentDir, '{"reviewModel": "provider/model, // not a comment", "curatorModel": "a}b"}');

	const { config, warnings } = loadConfig({ agentDir });
	assert.deepEqual(warnings, []);
	assert.equal(config.reviewModel, "provider/model, // not a comment");
	assert.equal(config.curatorModel, "a}b");
});

test("invalid values fall back to defaults and produce warnings", (t) => {
	const agentDir = tempAgent();
	t.after(() => fs.rmSync(agentDir, { recursive: true, force: true }));

	writeConfig(
		agentDir,
		JSON.stringify({
			enabled: "yes",
			quietMinutes: -1,
			disabledProjects: ["ok", 3],
			storePath: "relative/path",
		}),
	);

	const { config, warnings } = loadConfig({ agentDir });
	assert.equal(config.enabled, true);
	assert.equal(config.quietMinutes, 5);
	assert.deepEqual(config.disabledProjects, []);
	assert.equal(config.storePath, defaultStorePath(agentDir));
	assert.equal(warnings.length, 4);
	assert.ok(warnings.every((warning) => warning.startsWith("rsi: ")));
});

test("a malformed config warns once and keeps every default", (t) => {
	const agentDir = tempAgent();
	t.after(() => fs.rmSync(agentDir, { recursive: true, force: true }));

	writeConfig(agentDir, "{ this is not json");

	const { config, warnings } = loadConfig({ agentDir });
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /invalid JSONC/);
	assert.equal(config.enabled, true);
	assert.equal(config.storePath, defaultStorePath(agentDir));
});

test("storePath expands a leading tilde to an absolute path", (t) => {
	const agentDir = tempAgent();
	t.after(() => fs.rmSync(agentDir, { recursive: true, force: true }));

	writeConfig(agentDir, JSON.stringify({ storePath: "~/custom-rsi" }));

	const { config, warnings } = loadConfig({ agentDir });
	assert.deepEqual(warnings, []);
	assert.equal(config.storePath, path.join(os.homedir(), "custom-rsi"));
});

test("an explicit config file overrides the agent-dir location", (t) => {
	const agentDir = tempAgent();
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-cfg-file-"));
	t.after(() => {
		fs.rmSync(agentDir, { recursive: true, force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const file = path.join(dir, "custom.jsonc");
	fs.writeFileSync(file, '{"quietMinutes": 1}');

	const { config } = loadConfig({ agentDir, file });
	assert.equal(config.quietMinutes, 1);
});

// ---------------------------------------------------------------------------
// saveConfig — the operator toggles (/rsi off, observe, off --project) write
// config back, so this must merge rather than clobber, and never throw.
// ---------------------------------------------------------------------------

test("saveConfig merges into an existing config, preserving other keys", (t) => {
	const agentDir = tempAgent();
	t.after(() => fs.rmSync(agentDir, { recursive: true, force: true }));

	fs.mkdirSync(path.dirname(configPathFor(agentDir)), { recursive: true });
	fs.writeFileSync(configPathFor(agentDir), '{\n  // keep me\n  "quietMinutes": 9,\n}');

	assert.equal(saveConfig({ agentDir }, { observeOnly: false }).ok, true);
	const { config, warnings } = loadConfig({ agentDir });
	assert.deepEqual(warnings, []);
	assert.equal(config.quietMinutes, 9, "the existing key survives");
	assert.equal(config.observeOnly, false);
});

test("saveConfig creates the file and replaces a malformed one", (t) => {
	const agentDir = tempAgent();
	t.after(() => fs.rmSync(agentDir, { recursive: true, force: true }));

	assert.equal(saveConfig({ agentDir }, { enabled: false }).ok, true);
	assert.equal(loadConfig({ agentDir }).config.enabled, false);

	fs.writeFileSync(configPathFor(agentDir), "{ not json");
	assert.equal(saveConfig({ agentDir }, { enabled: true }).ok, true);
	assert.equal(loadConfig({ agentDir }).config.enabled, true);
});

test("saveConfig round-trips a disabledProjects list", (t) => {
	const agentDir = tempAgent();
	t.after(() => fs.rmSync(agentDir, { recursive: true, force: true }));

	assert.equal(saveConfig({ agentDir }, { disabledProjects: ["github.com/acme/app"] }).ok, true);
	assert.deepEqual(loadConfig({ agentDir }).config.disabledProjects, ["github.com/acme/app"]);
});
