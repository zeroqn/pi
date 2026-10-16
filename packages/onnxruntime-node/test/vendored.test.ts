import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// The repo's invariant: Magic Context's local embeddings load the ONNX Runtime this
// workspace pins — through the `libonnxrtabi24.so.1` shim in `shell/onnxruntime-shim` —
// and never a copy that arrived from the registry. The three transformers chunks inside
// `packages/magic-context` do `requireFromHere("onnxruntime-node")`, and that bare
// specifier is satisfied by this workspace member; this test is what makes a regression
// loud instead of a surprise 220 MB later. See packages/onnxruntime-node/README.md.
//
// It asserts *semantics*, not a path: npm materializes a `file:` dependency as a symlink
// and bun hardlinks it into `.bun/onnxruntime-node@file+…`, so a path check would have to
// know the installer. What must hold either way is that whatever `requireFromHere`
// resolves to carries this member's bytes and nothing from the published package.

const repoRoot = resolve(import.meta.dir, "..", "..", "..");
const member = resolve(import.meta.dir, "..");
const name = "onnxruntime-node";
const magicContext = join(repoRoot, "packages", "magic-context");

// The member is 428 KB (384,040 B of it the binding); the registry package is 220 MB
// unpacked plus ~301 MB the postinstall fetches from NuGet. Nothing sits in between.
const PAYLOAD_CAP = 1024 * 1024;

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function filesIn(root: string, skip: string[] = [], dir = root, seen = new Set<string>()): string[] {
  const real = realpathSync(dir);
  if (seen.has(real)) return [];
  seen.add(real);
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skip.includes(entry.name)) continue;
      out.push(...filesIn(root, skip, full, seen));
    } else {
      out.push(relative(root, full));
    }
  }
  return out;
}

function treeSize(dir: string, seen = new Set<string>()): number {
  const real = realpathSync(dir);
  if (seen.has(real)) return 0;
  seen.add(real);
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += treeSize(full, seen);
    else total += statSync(full).size;
  }
  return total;
}

/** Artifacts of the published package that must never appear in ours, by relative path. */
function forbidden(rels: string[]): string[] {
  const bad: string[] = [];
  for (const rel of rels) {
    const base = rel.split("/").pop() ?? rel;
    if (/^libonnxruntime.*\.so(\..*)?$/.test(base) || /^libonnxruntime_providers/.test(base)) {
      bad.push(`${rel}: the real library or a CUDA/TensorRT provider — the shim supplies these`);
    } else if (/^install\.js$/.test(base)) {
      bad.push(`${rel}: script/install.js, the NuGet fetcher`);
    } else if (/^onnxruntime_binding\.node$/.test(base) && !/^bin\/napi-v6\/[^/]+\/[^/]+\//.test(rel)) {
      bad.push(`${rel}: the binding outside bin/napi-v6/<platform>/<arch>`);
    } else if (rel.includes("adm-zip") || rel.includes("global-agent")) {
      bad.push(`${rel}: a dependency of the published postinstall`);
    }
  }
  return bad;
}

/** Everything we ship: the compiled JS and the one native artifact, member-relative. */
function vendoredFiles(): string[] {
  return filesIn(member, ["node_modules", "test"])
    .filter((rel) => rel.startsWith("dist/") || rel.startsWith("bin/"))
    .sort();
}

describe("the vendored onnxruntime-node is the one that gets loaded", () => {
  test("packages/magic-context asks for this member by path, not by a version range", () => {
    const manifest = JSON.parse(readFileSync(join(magicContext, "package.json"), "utf8"));
    const spec = manifest.optionalDependencies?.[name] ?? manifest.dependencies?.[name];
    // A bare range makes the link depend on the member's version happening to satisfy it,
    // and a range that stops satisfying it silently installs the 86 MB registry tarball.
    expect(spec).toBeDefined();
    expect(String(spec).startsWith("file:")).toBe(true);
  });

  test("what packages/magic-context resolves to carries this member's bytes", () => {
    const require = createRequire(join(magicContext, "index.js"));
    const resolved = realpathSync(require.resolve(`${name}/package.json`));
    const dir = resolve(resolved, "..");

    const pkg = JSON.parse(readFileSync(resolved, "utf8"));
    expect(pkg.name).toBe(name);
    expect(pkg.version).toBe(JSON.parse(readFileSync(join(member, "package.json"), "utf8")).version);
    // No postinstall: that is the only thing that fetches the 301 MB of CUDA providers.
    expect(pkg.scripts?.postinstall).toBeUndefined();

    // Byte-for-byte the vendored payload — which also fails on a stale install (bun
    // hardlinks `file:` dependencies into .bun/, so an in-place edit without `bun install`
    // leaves a mirror behind) and on the fork's own 1.30.0 binding.
    for (const rel of vendoredFiles()) {
      expect({ rel, sha: sha256(join(dir, rel)) }).toEqual({ rel, sha: sha256(join(member, rel)) });
    }
    expect(forbidden(filesIn(dir))).toEqual([]);
  });

  test("the member ships the binding, and nothing from the published package", () => {
    const allowed = new Set([
      ...vendoredFiles(),
      "README.md",
      "package.json",
      "vendor.sh",
      "test/vendored.test.ts",
      ".gitignore", // re-includes dist/, which the root .gitignore ignores
    ]);
    const extra = filesIn(member, ["node_modules"]).filter((rel) => !allowed.has(rel));
    expect(extra).toEqual([]);
    expect(forbidden(filesIn(member, ["node_modules"]))).toEqual([]);
    expect(existsSync(join(member, "bin", "napi-v6", "linux", "x64", "onnxruntime_binding.node"))).toBe(true);
  });

  test("no node_modules copy of this name anywhere in the tree is a registry one", () => {
    const dirs = [
      join(repoRoot, "node_modules", name),
      join(magicContext, "node_modules", name),
      join(member, "node_modules", name),
    ].filter((d) => existsSync(d) && !statSync(d).isSymbolicLink());
    for (const dir of dirs) {
      expect(forbidden(filesIn(dir))).toEqual([]);
      expect(treeSize(dir)).toBeLessThan(PAYLOAD_CAP * 2);
    }
  });

  test("the member stays small", () => {
    const bytes = vendoredFiles().reduce((sum, rel) => sum + statSync(join(member, rel)).size, 0) +
      readFileSync(join(member, "package.json")).length;
    expect(bytes).toBeLessThan(PAYLOAD_CAP);
    expect(bytes).toBeGreaterThan(300 * 1024); // the binding alone is 384,040 B
  });

  // The first version of this member shipped *without* its code: the repository's root
  // .gitignore ignores `dist/` generally, so `git add packages/onnxruntime-node` took the
  // manifest, the README and the 384 KB binding and silently left the JavaScript behind.
  // Nothing noticed until Magic Context reported
  // `Cannot find module '.../onnxruntime-node/dist/index.js'` at runtime and turned local
  // embeddings off. The working tree looked perfect, which is exactly why this assertion
  // reads git rather than the filesystem.
  test("every vendored file is tracked in git, not hidden by the root .gitignore", () => {
    const tracked = new Set(
      execFileSync("git", ["-C", repoRoot, "ls-files", "packages/onnxruntime-node"], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean),
    );
    const untracked = [...vendoredFiles(), "package.json", "README.md"]
      .map((rel) => `packages/onnxruntime-node/${rel}`)
      .filter((path) => !tracked.has(path));
    expect(untracked).toEqual([]);
  });

  test("bun.lock has no registry form of the name", () => {
    const lock = readFileSync(join(repoRoot, "bun.lock"), "utf8");
    expect(lock.match(/"onnxruntime-node": \["onnxruntime-node@\d[^"]*"/g) ?? []).toEqual([]);
    expect(/onnxruntime-node@(workspace:|file:)/.test(lock) || /"onnxruntime-node": "file:/.test(lock)).toBe(true);
  });
});
