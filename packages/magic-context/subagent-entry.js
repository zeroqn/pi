import {
  TOKEN_BUDGET_TOOL_REFUSAL
} from "./index-6vfy5y6a.js";
import {
  setHarness2
} from "./index-0h2mkab2.js";
import {
  log2
} from "./index-gymgz20n.js";
import"./index-dnp1jjar.js";
import {
  resolveProjectIdentityForSession
} from "./index-6pk49fc3.js";
import"./index-2qtx0q6h.js";
import {
  openDatabase
} from "./index-cx7ctxbc.js";
import"./index-fapenpch.js";
import"./index-3bb24eb6.js";
import"./index-399p688g.js";
import"./index-54wmg4rj.js";
import"./index-mkh1cm5k.js";
import"./index-rgvqh5x7.js";
import"./index-vd4cwnaz.js";
import"./index-3pk2mhaq.js";
import"./index-135e8hvg.js";
import"./index-n0zjvs3h.js";
import"./index-3rq8rbt9.js";
import"./index-c6wbq66z.js";
import"./index-4knyh1kt.js";
import {
  loadPiConfig,
  ensureProjectRegisteredFromPiDirectory,
  resolvePiHarnessKind,
  registerMagicContextTools
} from "./index-x5y4ar97.js";
import"./index-ccanzg8p.js";
import"./index-ar863dwd.js";
import"./index-6gtz99am.js";
import"./index-kd79p7yt.js";
import"./index-4113vdfg.js";
import"./index-hgd00nas.js";
import"./index-9p40dgkm.js";
import"./index-mp0gh04g.js";
import"./index-yhzhdp3m.js";
import"./index-9m0jvsz2.js";
import"./index-0hsvna5t.js";
import"./index-2bfj5gcg.js";
import"./index-asxy48qe.js";
import"./index-6x556c2q.js";
import"./index-ea37qn4x.js";
import"./index-r74njrfh.js";
import"./index-1cvyaw9a.js";
import"./index-kfs7073b.js";
import"./index-e9n1n9ah.js";
import"./index-29nw7n1r.js";
import"./index-6td53h94.js";
import"./index-d0w84hy5.js";
import"./index-0wtm7g7f.js";
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
