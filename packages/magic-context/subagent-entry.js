import {
  TOKEN_BUDGET_TOOL_REFUSAL
} from "./index-6ck7trd8.js";
import {
  setHarness2
} from "./index-0h2mkab2.js";
import {
  log2
} from "./index-f956htf3.js";
import {
  resolveProjectIdentityForSession
} from "./index-dkx0b1kt.js";
import {
  openDatabase
} from "./index-8pdxxv7j.js";
import"./index-3cgbv47m.js";
import"./index-fapenpch.js";
import"./index-603mt6nm.js";
import"./index-jg27bxae.js";
import"./index-gj0r90h9.js";
import"./index-135e8hvg.js";
import"./index-8976mezv.js";
import"./index-xwgrhenf.js";
import {
  loadPiConfig,
  ensureProjectRegisteredFromPiDirectory,
  resolvePiHarnessKind,
  registerMagicContextTools
} from "./index-4zepsjy7.js";
import"./index-yy0h7gp8.js";
import"./index-bgmv2kaf.js";
import"./index-7neahsnb.js";
import"./index-zmyrvs22.js";
import"./index-9d4pnmrf.js";
import"./index-9p40dgkm.js";
import"./index-yhzhdp3m.js";
import"./index-yg8ktppn.js";
import"./index-td9qvw23.js";
import"./index-mk0cr4vy.js";
import"./index-rt5jgzp1.js";
import"./index-a1zrv5dx.js";
import"./index-xjqheg7a.js";
import"./index-fp37he9a.js";
import {
  setStoragePrivatePermissionEnforcement
} from "./index-vf38qhee.js";

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
