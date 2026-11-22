/**
 * advisor-ui — bordered select-panel builders for the `/advisor` command.
 *
 * Carried from upstream (`advisor-ui.ts`), including its panel prose: two public functions
 * (`showAdvisorPicker`, `showEffortPicker`) over a private `showFilterablePicker` that owns the bordered
 * container, the `SelectList` theme wiring, and a type-to-filter fuzzy search. Nothing about it is
 * lane-specific — a command is still typed by a human, and a host function cannot be typed — which is why
 * the picker survives the port.
 *
 * **One amendment, for pi 1.5.0.** `ctx.ui.custom()` took a `blocked` option and the picker now declares
 * itself through it, so a terminal that speaks OSC 7501 is told the program waits on a **question** while
 * this panel is the visible component, instead of reporting nothing and looking stalled. Pi's reporter
 * accepts only the session name, a dialog title or an error's first line as the message
 * (`program-status-reporter.ts`), so the message is the panel's own title and never a row or the filter.
 * pi 1.6.0 also reports it for overlays, until their `done()`; this picker is an inline component, so it
 * reports while visible. A host older than 1.5.0 ignores the key, so there is no version check and no
 * second code path.
 */

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Spacer, Text } from "@earendil-works/pi-tui";

import { filterItems, isBackspace, isPrintable } from "./fuzzy.ts";

const MAX_VISIBLE_ROWS = 10;
/** Said in the dialog title when the picker degrades: a scroll list has no type-to-filter. */
const DEGRADED_PICKER_HINT = "type-to-filter is not available in this host; choose from the list";
const NAV_HINT = "type to filter • ↑↓ navigate • enter select • esc cancel";

const ADVISOR_HEADER_TITLE = "Advisor Tool";
const ADVISOR_HEADER_PROSE_1 =
	"When the active model needs stronger judgment — a complex decision, an ambiguous " +
	"failure, a problem it's circling without progress — it escalates to the " +
	"advisor model for guidance, then resumes. The advisor runs server-side " +
	"and uses additional tokens.";
const ADVISOR_HEADER_PROSE_2 =
	"For certain workloads, pairing a faster model as the main model with a " +
	"more capable one as the advisor gives near-top-tier performance with " +
	"reduced token usage.";

const EFFORT_HEADER_TITLE = "Reasoning Level";
const EFFORT_HEADER_PROSE =
	"Choose the reasoning effort level for the advisor. " +
	"Higher levels produce stronger judgment but use more tokens.";

function selectListTheme(theme: Theme) {
	return {
		selectedPrefix: (t: string) => theme.bg("selectedBg", theme.fg("accent", t)),
		selectedText: (t: string) => theme.bg("selectedBg", theme.bold(t)),
		description: (t: string) => theme.fg("muted", t),
		scrollInfo: (t: string) => theme.fg("dim", t),
		noMatch: (t: string) => theme.fg("warning", t),
	};
}

function buildSelectPanel(
	theme: Theme,
	title: string,
	proseLines: string[],
	query: string,
	selectList: SelectList,
): Container {
	const container = new Container();
	const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));

	container.addChild(border());
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
	container.addChild(new Spacer(1));
	for (const line of proseLines) {
		container.addChild(new Text(line, 1, 0));
		container.addChild(new Spacer(1));
	}
	const filterText = query.length > 0 ? `Filter: ${query}` : "Type to filter…";
	container.addChild(new Text(theme.fg(query.length > 0 ? "accent" : "dim", filterText), 1, 0));
	container.addChild(new Spacer(1));
	container.addChild(selectList);
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("dim", NAV_HINT), 1, 0));
	container.addChild(new Spacer(1));
	container.addChild(border());
	return container;
}

interface FilterablePickerOptions {
	title: string;
	proseLines: string[];
	items: SelectItem[];
	/** Value to preselect while the query is empty (e.g. the current effort). */
	preferredValue?: string;
}

/**
 * The dialog-primitive path for a host that cannot render a component (`ctx.mode !== "tui"`).
 *
 * pi's RPC mode — and this repo's Rust client — answer `select` natively and ignore `custom`, so the
 * picker degrades to one `select` over the same rows. What is lost, and said out loud in the notify:
 * the type-to-filter search (a long model list becomes a scroll), the bordered panel, and the prose
 * lines, which move into the dialog title.
 */
async function selectWithPrimitives(
	ctx: ExtensionContext,
	opts: FilterablePickerOptions,
): Promise<string | null> {
	const labels = opts.items.map((item) => item.label);
	const title = `${opts.title} — ${DEGRADED_PICKER_HINT}\n${opts.proseLines.join(" ")}`.trim();
	const chosen = await ctx.ui.select(title, labels);
	if (chosen == null) return null;
	// A host answers with one of the offered lines; anything else is a typed custom value, which this
	// picker has no row for, so it is treated as a dismissal rather than as a fabricated selection.
	const index = labels.indexOf(chosen);
	return index >= 0 ? opts.items[index].value : null;
}

function showFilterablePicker(ctx: ExtensionContext, opts: FilterablePickerOptions): Promise<string | null> {
	// Only a host that *declares* a non-terminal mode is degraded. A host that declares nothing keeps the
	// component path: it may be an older pi, or a wrapper that still renders `custom`.
	if (ctx.mode !== undefined && ctx.mode !== "tui") return selectWithPrimitives(ctx, opts);
	// What pi 1.5.0 reports to the terminal (OSC 7501) while this panel is the visible component: a program
	// waiting on a question, named by the panel's own title. Inline components only — which this is — and a
	// host older than 1.5.0 ignores the key, so there is no version check and no second code path.
	const dialog: { blocked: { kind: "question"; message: string } } = {
		blocked: { kind: "question", message: opts.title },
	};
	return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		let query = "";
		let selectList: SelectList;
		let container: Container;

		const rebuild = () => {
			const filtered = filterItems(opts.items, query);
			const visibleRows = Math.min(Math.max(filtered.length, 1), MAX_VISIBLE_ROWS);
			selectList = new SelectList(filtered, visibleRows, selectListTheme(theme));
			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);
			if (query.length === 0 && opts.preferredValue) {
				const idx = filtered.findIndex((item) => item.value === opts.preferredValue);
				if (idx >= 0) selectList.setSelectedIndex(idx);
			}
			container = buildSelectPanel(theme, opts.title, opts.proseLines, query, selectList);
		};

		rebuild();

		return {
			render: (w) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				if (isBackspace(data)) {
					if (query.length > 0) {
						query = query.slice(0, -1);
						rebuild();
					}
				} else if (isPrintable(data)) {
					query += data;
					rebuild();
				} else {
					selectList.handleInput(data);
				}
				tui.requestRender();
			},
		};
	}, dialog);
}

export async function showAdvisorPicker(ctx: ExtensionContext, items: SelectItem[]): Promise<string | null> {
	return showFilterablePicker(ctx, {
		title: ADVISOR_HEADER_TITLE,
		proseLines: [ADVISOR_HEADER_PROSE_1, ADVISOR_HEADER_PROSE_2],
		items,
	});
}

export async function showEffortPicker(
	ctx: ExtensionContext,
	items: SelectItem[],
	currentEffort: ThinkingLevel | undefined,
	defaultEffort: ThinkingLevel,
): Promise<string | null> {
	const preferredValue = items.some((item) => item.value === currentEffort) ? currentEffort : defaultEffort;
	return showFilterablePicker(ctx, {
		title: EFFORT_HEADER_TITLE,
		proseLines: [EFFORT_HEADER_PROSE],
		items,
		preferredValue,
	});
}
