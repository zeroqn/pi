# pi-ask-user-question

The questionnaire, as a host function a code-mode cell can call.

```python
r = await ask_user_question(questions=[...])
```

The cell suspends while the questionnaire is on screen and resumes with a dict:

```python
{
    "text": 'User has answered your questions: "Which storage engine?"="SQLite". You can now continue '
            "with the user's answers in mind.",
    "cancelled": False,
    "answers": [
        {
            "question_index": 0,
            "question": "Which storage engine?",
            "kind": "option",           # "option" | "custom" | "multi"
            "answer": "SQLite",         # never None
            "selected": None,           # ["A", "B"] when kind == "multi"
            "preview": "### SQLite…",   # the matched option's markdown, when it had one
            "notes": None,
        },
    ],
    "global_note": None,
}
```

`cancelled` is **data** — the user pressed Esc or closed the questionnaire, and whatever they had
already answered is still in `answers`. A malformed questionnaire raises `ValueError` before anything
opens, and a session that cannot render it raises `RuntimeError`; neither is a decline.

The model's instructions for it are contributed with the host function (`ask-user-question.ts`,
`DEFAULT_DESCRIPTION` / `DEFAULT_PROMPT_GUIDELINES`), and every field is overridable from the config.

## Where it renders

| Environment | What happens |
| --- | --- |
| Interactive terminal | The tabbed overlay, in the editor pane's place, with the collapse key (`Ctrl+]`) hiding it so the transcript can be read |
| RPC / ACP host (VS Code pendant, Zed, Paseo) | One native `select`/`input` dialog per question — no previews, no tabs, no notes; multi-select is typed (`1,3`) |
| No UI (print mode), or a spawned child | The capability is **not composed into the session**: the model is never told it exists, and a cell that calls it anyway gets a `NameError` |

The gate is `ctx.hasUI && (mode === "tui" || hasDialogUI(ctx.ui))`. It is deliberately the same decision
rpiv makes for its tool, taken earlier: better to never offer what cannot be used than to offer it and
refuse every call.

## Config

`~/.pi/agent/extension-configs/ask-user-question/ask-user-question.jsonc` — JSONC, optional, and a
malformed value is a warning rather than a failure:

```jsonc
{
  // The key that hides the dialog so the transcript underneath can be read. "off" disables it.
  // Remap it on layouts where `]` is on the shifted layer, e.g. "ctrl+}".
  "collapseKey": "ctrl+]",
  "guidance": {
    // Override the prose the model is given, per field.
    "description": "…",
    "promptSnippet": "…",
    "promptGuidelines": ["…"]
  }
}
```

`PI_CODING_AGENT_DIR` moves the whole tree if you set it.

## Keys (terminal)

| Key | |
| --- | --- |
| `↑` / `↓` | move between options |
| `Enter` | select; on the Submit tab, submit |
| `Tab` / `Shift+Tab` | switch questions |
| `Space` | toggle, on a multi-select question |
| `n` | add notes to a question (or a global note on Submit) |
| `Shift+Enter` | newline, while typing a custom answer |
| `Ctrl+U` | clear the custom-answer line |
| `Ctrl+]` | hide the box so you can read the transcript (press again to bring it back) |
| `Esc` | cancel the questionnaire |

The collapse hint has a footer row of its own, in the accent colour — measured, because as the last item
of the hint row it was the first thing a narrow terminal clipped.

## Vendored

Vendored from [`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)
**v2.11.0** (MIT — see `LICENSE`, unchanged). The diff base is that package as installed at
`~/.pi/agent/npm/node_modules/@juicesharp/rpiv-ask-user-question`, byte-identical to the mono checkout at
`/workspace/pi/thirdpart-extensions/rpiv-mono/packages/rpiv-ask-user-question`. Upstream is a **reference**,
not a subtree: `diff -r` against that path is the way to see what this port changed.

### Vendored delta

- **`ask-user-question.ts`** — `pi.registerTool(…)` becomes `createAskUserQuestionHost({ ctx })`: one host
  function instead of a tool. The `ctx.ui.custom` call site, the session factory, the lazy session load
  and its pre-warm, the external-editor bridge and the collapse-key listener are upstream's, unchanged.
  Added: the RPC/TUI branch, the strict key pass, the dict projection, and the failures that raise.
- **`index.ts`** — registers a `pi-host-bridge` contributor at module load, and answers `null` for a
  session that cannot render (replacing upstream's `reconcile.ts`, which stripped and re-added a *tool*
  against `ctx.hasUI`).
- **`config.ts`** — reads pi's own config tree with a local JSONC loader; `@juicesharp/rpiv-config` is
  dropped. The key-spec grammar below it is upstream's.
- **`tool/normalize-params.ts`** — adds the `multi_select` → `multiSelect` alias and rejects unknown keys,
  because the typebox schemas are permissive and a misspelled `multiselect` would otherwise be ignored.
- **`view/tab-content-strategy.ts`** — the collapse hint gets its own footer row (accent), and
  `footerRowCount` becomes `3` while it is drawn, `2` when `collapseKey` is `"off"`.
- **`state/i18n-bridge.ts`** — `t(key, fallback)` is the identity. The `@juicesharp/rpiv-i18n` peer and
  the nine locale bundles are dropped: the SDK was never installed, so every call site already rendered
  its inline English.
- **Deleted** — `events.ts` (nothing consumes `rpiv:ask-user:*`), `reconcile.ts`, `locales/`, `docs/`.
- **Tests** — the suites that need no pi/ctx mock are ported to `bun:test` with a 30-line
  `test/theme.ts`; the ones that drove a fake pi tool are dropped, and `ask-user-question.contract.test.ts`
  covers the port's own contract instead.
