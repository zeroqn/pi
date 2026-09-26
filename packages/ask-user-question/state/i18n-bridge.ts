/**
 * The i18n surface, reduced to English.
 *
 * Upstream routes every user-facing string through `@juicesharp/rpiv-i18n` and falls back to the inline
 * English literal at each call site when the SDK is absent. The port keeps the *surface* —
 * `t(key, fallback)` at ~100 call sites, so the vendored files stay diffable against the reference — and
 * drops the machinery: the SDK is not installed here, so `t` was already the identity, and the nine
 * locale bundles it would have read are gone (`.scratch/ask-user-question` tickets 05 and 06).
 *
 * Reinstating localization means restoring the dynamic import and the `registerLocalesFromDir` call in
 * `index.ts`, plus the bundles — nothing in this file changes.
 *
 * Reserved-label validation stays English-locked: it compares the canonical
 * `ROW_INTENT_META[kind].label`, never a localized one.
 */
import { ROW_INTENT_META, type SentinelKind } from "./row-intent.js";

type ScopeFn = (key: string, fallback: string) => string;

/** Identity over the call site's inline English. */
export const t: ScopeFn = (_key, fallback) => fallback;

export function displayLabel(kind: SentinelKind): string {
	return t(`sentinel.${kind}`, ROW_INTENT_META[kind].label);
}
