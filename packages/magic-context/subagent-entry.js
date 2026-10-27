import {
  TOKEN_BUDGET_TOOL_REFUSAL
} from "./index-cm9e52mb.js";
import {
  setHarness2
} from "./index-0h2mkab2.js";
import {
  log2
} from "./index-fgs78jyd.js";
import {
  resolveProjectIdentityForSession
} from "./index-hxp6q5f8.js";
import"./index-2qtx0q6h.js";
import"./index-n4wyxcgr.js";
import"./index-fapenpch.js";
import {
  openDatabase
} from "./index-j0t5pwjg.js";
import"./index-399p688g.js";
import"./index-54wmg4rj.js";
import"./index-8hmqdav2.js";
import"./index-8a2wvrda.js";
import"./index-0dr64gsy.js";
import"./index-w1avzkdt.js";
import"./index-135e8hvg.js";
import"./index-23t8ryqw.js";
import"./index-my0dn413.js";
import"./index-4knyh1kt.js";
import {
  loadPiConfig,
  ensureProjectRegisteredFromPiDirectory,
  resolvePiHarnessKind,
  registerMagicContextTools
} from "./index-sxyhgtzp.js";
import"./index-ccanzg8p.js";
import"./index-gwxaz0z5.js";
import"./index-wb2t932e.js";
import"./index-0pt8z7am.js";
import"./index-vc6fjs1m.js";
import"./index-9p40dgkm.js";
import"./index-j3pz3a1b.js";
import"./index-yhzhdp3m.js";
import"./index-zrc2y4em.js";
import"./index-zmg1td73.js";
import"./index-n8e5e9fp.js";
import"./index-6x556c2q.js";
import"./index-adk1kpy9.js";
import"./index-1cvyaw9a.js";
import"./index-cms6wfmd.js";
import"./index-29nw7n1r.js";
import"./index-6wdwv3a6.js";
import"./index-hqw0rt9k.js";
import {
  setStoragePrivatePermissionEnforcement
} from "./index-81nthk8j.js";

// src/subagent-entry.ts
import { readFileSync } from "node:fs";
var SUBAGENT_DREAMER_ACTIONS_FLAG = "magic-context-dreamer-actions";
var openedDb;
function magicContextSubagentExtension(pi) {
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
      const db = openDatabase();
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log2(`[pi-subagent] startup failed: ${message}`);
      process.exitCode = 1;
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
