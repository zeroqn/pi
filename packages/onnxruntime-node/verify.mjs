#!/usr/bin/env bun
/**
 * Health check for this repo's ONNX Runtime arrangement, run without pi.
 *
 * Two consumers exist, and they are checked separately because they load different things:
 *
 *   member (the in-pi arrangement)  packages/magic-context -> `requireFromHere("onnxruntime-node")`
 *                                   -> this workspace member (binding `libonnxrtabi24.so.1`)
 *                                   -> the ABI shim in shell/onnxruntime-shim -> pkgs.onnxruntime
 *   --vendor (Magic Context's own)  vendor/magic-context's npm `onnxruntime-node@1.30.0`, which
 *                                   ships its own `libonnxruntime.so.1` and needs no shim
 *
 * Each row loads a binding, reports the `libonnx*` files the process actually mapped, and runs
 * one real session over a cached MiniLM model with the options Magic Context passes
 * (`executionProviders: ["cpu"]`). `--row auto` runs both. Exit 0 when every requested row
 * passed; the JSON verdict prints either way.
 *
 *   bun packages/onnxruntime-node/verify.mjs                    # member, devShell env
 *   ONNXRUNTIME_LIB_PATH=<dir>/lib bun …/verify.mjs             # any candidate ORT
 *   bun …/verify.mjs --row vendor                               # the 1.30.0 binding
 *   bun …/verify.mjs --model <path/to/model.onnx>
 *
 * Exit codes: 0 all rows passed, 1 a row failed, 2 no row could run (nothing to check).
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(dirname(HERE));
const MEMBER = HERE;
const VENDOR = join(REPO, "vendor", "magic-context");
const MODEL_CACHES = [join(VENDOR, "target", "scratch", "local-pooling-model-cache")];

function option(name, fallback) {
	const at = process.argv.indexOf(`--${name}`);
	return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

/** The first cached MiniLM-family model, so a run needs no download. */
function defaultModel() {
	for (const cache of MODEL_CACHES) {
		for (const bundle of ["all-MiniLM-L6-v2", "bge-small-en-v1.5"]) {
			const file = join(cache, "Xenova", bundle, "onnx", "model.onnx");
			if (existsSync(file)) return file;
		}
	}
	return null;
}

/** Libraries named libonnx* this process has mapped, by basename. */
function mappedLibraries() {
	const seen = new Map();
	for (const line of readFileSync("/proc/self/maps", "utf8").split("\n")) {
		const file = line.match(/ (\/[^\s]+)$/);
		if (!file) continue;
		const base = basename(file[1]);
		if (!base.includes("libonnx") || seen.has(base)) continue;
		seen.set(base, dirname(file[1]));
	}
	return Object.fromEntries(seen);
}

/** Where the two consumers' bindings live, resolved the way their own code resolves them. */
function memberEntry() {
	return join(MEMBER, "dist", "index.js");
}

function vendorEntry() {
	for (const root of ["packages/plugin", "packages/pi-plugin", "packages/cli"]) {
		try {
			return createRequire(join(VENDOR, root, "package.json")).resolve("onnxruntime-node");
		} catch {
			/* try the next workspace package, whose manifest declares it */
		}
	}
	const direct = join(VENDOR, "node_modules", "onnxruntime-node", "dist", "index.js");
	return existsSync(direct) ? direct : null;
}

const INT64_IDS = (n, mod) => BigInt64Array.from({ length: n }, (_, i) => BigInt(i % mod));

async function checkRow(label, entry, model) {
	const row = { label, entry, checks: { mapped: mappedLibraries() } };
	try {
		// The member asks for `libonnxrtabi24.so.1`, i.e. the shim; MC's npm package asks for
		// `libonnxruntime.so.1`, which it ships beside its own binding. Report which is here.
		row.checks.bindingLoaded = true;
		const ort = await import(entry);
		row.checks.ownBinding = basename(dirname(dirname(entry)));
		if (model) {
			const session = await ort.InferenceSession.create(model, { executionProviders: ["cpu"] });
			row.checks.inputs = session.inputNames;
			const feeds = {};
			for (const name of session.inputNames) {
				// MiniLM: int64 ids, masks and token types of 0/1.
				if (name === "token_type_ids") feeds[name] = new ort.Tensor("int64", INT64_IDS(16, 2), [2, 8]);
				else if (name.endsWith("mask")) feeds[name] = new ort.Tensor("int64", BigInt64Array.from({ length: 16 }, (_, i) => BigInt(i % 8 === 7 ? 0 : 1)), [2, 8]);
				else if (name.endsWith("ids")) feeds[name] = new ort.Tensor("int64", INT64_IDS(16, 5), [2, 8]);
				else feeds[name] = new ort.Tensor("float32", new Float32Array(16).fill(0.1), [2, 8]);
			}
			const result = await session.run(feeds);
			const first = Object.keys(result)[0];
			const data = Array.from(result[first].data, Number);
			row.checks.finite = Number.isFinite(data.reduce((a, b) => a + b, 0));
			row.checks.output = { name: first, dims: result[first].dims, head: data.slice(0, 4), sum: Number(data.reduce((a, b) => a + b, 0).toFixed(6)) };
		}
	} catch (error) {
		row.checks.error = String(error?.message ?? error).split("\n")[0];
		// The vendor row loads an npm binding that ships its own `libonnxruntime.so.1` and finds it
		// through `RUNPATH $ORIGIN/`. Anything with that name earlier on `LD_LIBRARY_PATH` outranks
		// it, and ORT checks the symbol version node before its own append-only `OrtApi` negotiation
		// — so a different generation refuses by name instead of adapting.
		if (/version `VERS_[0-9.]+' not found/.test(row.checks.error) && /libonnxruntime\.so/.test(row.checks.error)) {
			row.checks.hint = "a libonnxruntime.so.1 earlier on LD_LIBRARY_PATH outranks the binding's own $ORIGIN copy; "
				+ "run this row with LD_LIBRARY_PATH=<gcc-lib> only (or empty) to load the package's own library";
		}
		if (/libonnxrtabi24\.so\.1: cannot open/.test(row.checks.error)) {
			row.checks.hint = "the shim is not on the library path; it comes from shell/onnxruntime-shim and the "
				+ "devShell prepends its output to LD_LIBRARY_PATH";
		}
	}
	row.checks.mapped = mappedLibraries();
	row.checks.shimMapped = Object.keys(row.checks.mapped).includes("libonnxrtabi24.so.1");
	// A file *named* `libonnxruntime.so.1` on the library path is every process's ONNX Runtime —
	// an older generation of the shim shipped under that name and `zg` died on it. Report each one.
	row.checks.foreignShims = Object.entries(row.checks.mapped)
		.filter(([name]) => /^libonnxruntime.*\.so/.test(name))
		.map(([name, dir]) => `${name} <- ${dir}`);
	const needsShim = label === "member";
	row.ok = row.checks.error === undefined
		&& row.checks.bindingLoaded === true
		&& (row.checks.mapped !== undefined)
		&& (model ? row.checks.finite === true : true)
		&& (needsShim ? row.checks.shimMapped === true : true);
	return row;
}

const want = option("row", "auto");
const model = option("model", defaultModel());
const requested = want === "auto" ? ["member", "vendor"] : want.split(",").map((s) => s.trim());
const single = process.argv.includes("--__row");

/**
 * A row's verdict, taken in a **process of its own**.
 *
 * Two bindings in one process do not mix: the member's row maps `libonnxruntime.so.1.27.1` (the
 * shim dlopens it), whose SONAME is the same name MC's npm binding needs, so a later row can be
 * refused by the earlier row's library. Each row therefore re-executes this file.
 */
function runRowInOwnProcess(label) {
	const child = Bun.spawnSync([process.execPath, fileURLToPath(import.meta.url), "--row", label, "--__row",
		...(model ? ["--model", model] : [])], { env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
	const text = child.stdout.toString().trim();
	const start = text.indexOf("{\n");
	if (start < 0) {
		return { label, ok: false, checks: { error: `row process produced no verdict; exit ${child.exitCode}: ${text.slice(-400) || child.stderr.toString().slice(-400)}` } };
	}
	try {
		return JSON.parse(text.slice(start));
	} catch (error) {
		return { label, ok: false, checks: { error: `row process verdict unreadable: ${String(error.message ?? error)}` } };
	}
}

if (!single) {
	const verdict = {
		ONNXRUNTIME_LIB_PATH: process.env.ONNXRUNTIME_LIB_PATH ?? "(unset: the shim's baked default)",
		LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH ?? "",
		model: model ?? "(none found: pass --model; rows report load only)",
		rows: [],
	};
	for (const label of requested) verdict.rows.push(runRowInOwnProcess(label));
	verdict.ok = verdict.rows.length > 0 && verdict.rows.every((row) => row.ok === true);
	console.log(JSON.stringify(verdict, null, 1));
	process.exit(verdict.ok ? 0 : verdict.rows.length === 0 ? 2 : 1);
}

const label = want;
const entry = label === "member" ? memberEntry() : label === "vendor" ? vendorEntry() : null;
const row = entry && existsSync(entry)
	? await checkRow(label, entry, model)
	: { label, ok: false, checks: { error: `${label}: no entry point found (${entry ?? "unknown row"})` } };
console.log(JSON.stringify(row, null, 1));
process.exit(row.ok ? 0 : 1);
