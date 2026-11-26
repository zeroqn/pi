import {
  TOKEN_BUDGET_TOOL_REFUSAL
} from "./index-hpbdnbtf.js";
import {
  setHarness2
} from "./index-0h2mkab2.js";
import {
  log2
} from "./index-tm11k42a.js";
import"./index-dnp1jjar.js";
import {
  resolveProjectIdentityForSession
} from "./index-453s1hj6.js";
import"./index-2qtx0q6h.js";
import {
  openDatabase2
} from "./index-6gm43ppw.js";
import"./index-3bb24eb6.js";
import"./index-8sqebjzk.js";
import"./index-wfqysrwq.js";
import"./index-x2n261wp.js";
import"./index-xjhq27z9.js";
import"./index-ghp32f9m.js";
import"./index-pqhc0k9d.js";
import"./index-jhmz9tgv.js";
import"./index-135e8hvg.js";
import"./index-n0zjvs3h.js";
import"./index-pefn1gt5.js";
import"./index-4knyh1kt.js";
import {
  loadPiConfig,
  ensureProjectRegisteredFromPiDirectory,
  resolvePiHarnessKind,
  reportSubagentStartupError,
  registerMagicContextTools
} from "./index-nrwaxwkd.js";
import"./index-vcegxfwg.js";
import"./index-5rcjs14a.js";
import"./index-cxczethe.js";
import"./index-bte6kzsd.js";
import"./index-s2zjddb6.js";
import"./index-hgd00nas.js";
import"./index-9p40dgkm.js";
import"./index-79xfn84y.js";
import"./index-yhzhdp3m.js";
import"./index-pj9b2mmd.js";
import"./index-tksyex8e.js";
import"./index-0t9xfj3x.js";
import"./index-nh4srq1p.js";
import"./index-6x556c2q.js";
import"./index-nvh6d3bz.js";
import"./index-ay13n5s4.js";
import"./index-8d2z6503.js";
import"./index-qhdmqkan.js";
import"./index-fvfq9gva.js";
import"./index-t5pyexcf.js";
import"./index-29nw7n1r.js";
import"./index-3s39a1md.js";
import"./index-1ts77n1b.js";
import {
  setStoragePrivatePermissionEnforcement
} from "./index-81nthk8j.js";

// src/subagent-entry.ts
import { readFileSync } from "node:fs";
var SUBAGENT_DREAMER_ACTIONS_FLAG = "magic-context-dreamer-actions";
var openedDb;
function magicContextSubagentExtension(pi) {
  let startupComplete = false;
  let startupError;
  let failureReported = false;
  const reportStartupFailure = async () => {
    if (failureReported)
      return;
    failureReported = true;
    await reportSubagentStartupError(startupError ?? "Magic Context child startup did not complete");
  };
  pi.on("context", async () => {
    if (startupComplete)
      return;
    try {
      await reportStartupFailure();
    } finally {
      process.exit(1);
    }
  });
  setHarness2(resolvePiHarnessKind());
  pi.registerFlag(SUBAGENT_DREAMER_ACTIONS_FLAG, {
    description: "Register ctx_memory with dreamer actions for Magic Context subagents.",
    type: "boolean",
    default: false
  });
  const budgetGuardFile = process.env.MAGIC_CONTEXT_SUBAGENT_BUDGET_GUARD_FILE;
  if (budgetGuardFile) {
    pi.on("tool_call", () => {
      try {
        if (readFileSync(budgetGuardFile, "utf8") === "finalize") {
          return { block: true, reason: TOKEN_BUDGET_TOOL_REFUSAL };
        }
      } catch {
        return { block: true, reason: TOKEN_BUDGET_TOOL_REFUSAL };
      }
      return;
    });
  }
  pi.on("session_start", async () => {
    try {
      const directory = process.cwd();
      const { config: cfg, registrationPromptSurface } = loadPiConfig({
        cwd: directory
      });
      setStoragePrivatePermissionEnforcement(cfg.storage.enforce_private_permissions);
      const db = openDatabase2();
      if (!db) {
        throw new Error("storage open failed; refusing to start without Magic Context tools");
      }
      openedDb = db;
      await ensureProjectRegisteredFromPiDirectory(directory, db);
      const dreamerActionsEnabled = pi.getFlag(SUBAGENT_DREAMER_ACTIONS_FLAG) === true;
      registerMagicContextTools(pi, {
        rerankConnectionFile: cfg.subc?.connection_file,
        rerankConfig: cfg.rerank,
        db,
        ensureProjectRegistered: ensureProjectRegisteredFromPiDirectory,
        resolveProjectIdentity: (ctx) => resolveProjectIdentityForSession(ctx.cwd, cfg.allow_home_project),
        memoryToolEnabled: dreamerActionsEnabled,
        allowDreamerActions: dreamerActionsEnabled,
        sessionScopedToolsDisabled: true,
        todowriteEnabled: cfg.todowrite.enabled,
        todowriteCommandEnabled: false,
        promptSurface: registrationPromptSurface
      });
      log2(`[pi-subagent] registered tools: ctx_search${dreamerActionsEnabled ? ", ctx_memory" : ""}${cfg.todowrite.enabled ? ", todowrite" : ""}` + ` (ctx_note/ctx_expand omitted: --no-session child;` + ` memory=${cfg.memory.enabled}, embedding=${cfg.embedding.provider !== "off"},` + ` git_commits=${cfg.memory.git_commit_indexing.enabled}, dreamer_actions=${dreamerActionsEnabled})`);
      startupComplete = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      startupError = `Magic Context child startup failed: ${message}`;
      log2(`[pi-subagent] startup failed: ${message}`);
      process.exitCode = 1;
      await reportStartupFailure();
      throw err;
    }
  });
  pi.on("session_shutdown", () => {
    if (openedDb) {
      try {
        openedDb.close();
      } catch {}
      openedDb = undefined;
    }
  });
}
export {
  magicContextSubagentExtension as default
};
