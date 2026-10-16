import {
  TOKEN_BUDGET_TOOL_REFUSAL
} from "./index-s1bev2xq.js";
import {
  setHarness2
} from "./index-0h2mkab2.js";
import {
  log2
} from "./index-x3dcnxh0.js";
import {
  resolveProjectIdentityForSession
} from "./index-fgabebe5.js";
import"./index-kgd6t63g.js";
import"./index-3cgbv47m.js";
import"./index-fapenpch.js";
import {
  openDatabase
} from "./index-35sd5btx.js";
import"./index-knxngpvf.js";
import"./index-krhpcm6f.js";
import"./index-nmsb3x01.js";
import"./index-135e8hvg.js";
import"./index-8976mezv.js";
import"./index-vaah9fbg.js";
import {
  loadPiConfig,
  ensureProjectRegisteredFromPiDirectory,
  resolvePiHarnessKind,
  registerMagicContextTools
} from "./index-6fhr2g6x.js";
import"./index-cyrnv16r.js";
import"./index-xkf1qyj1.js";
import"./index-jhw13tmp.js";
import"./index-sdgdm92c.js";
import"./index-1vesbrss.js";
import"./index-9p40dgkm.js";
import"./index-yhzhdp3m.js";
import"./index-c4n0940k.js";
import"./index-sv5yv3gc.js";
import"./index-2s0s8mca.js";
import"./index-399p688g.js";
import"./index-2apf1afe.js";
import"./index-hsftpq74.js";
import"./index-xjqheg7a.js";
import"./index-g3600tpw.js";
import"./index-0vrkp1jq.js";
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
