/**
 * One shared `Markdown` double for the two preview tests.
 *
 * bun's `mock.module` is **process-global** — a specifier resolves to one factory for the whole test
 * run, whichever file registered it, and a second registration replaces the first — so two files each
 * registering their own `FakeMarkdown` would leave both of them reading whichever counters that one
 * factory closed over. They share this module instead, and reset `markdownMock` in `beforeEach`.
 *
 * It is imported as a side effect, above the modules under test, because the mock has to be registered
 * before they evaluate their `Markdown` import.
 */
import { mock } from "bun:test";

export const markdownMock = { constructed: 0, lastText: "" };

export function resetMarkdownMock(): void {
	markdownMock.constructed = 0;
	markdownMock.lastText = "";
}

const actual = (await import("@earendil-works/pi-tui")) as Record<string, unknown>;

class FakeMarkdown {
	constructor(public text: string) {
		markdownMock.constructed += 1;
		markdownMock.lastText = text;
	}

	render(width: number): string[] {
		return [`MD[${width}]:${this.text.slice(0, Math.max(0, width - 4))}`];
	}

	invalidate(): void {}

	setText(text: string): void {
		this.text = text;
	}
}

mock.module("@earendil-works/pi-tui", () => ({ ...actual, Markdown: FakeMarkdown }));
