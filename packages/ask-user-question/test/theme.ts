/**
 * The port's test harness — the whole of it.
 *
 * rpiv's suite runs on `vitest` + `@juicesharp/rpiv-test-utils`, a mono-internal package that does not
 * exist here; of its 1275 lines the tests carried over need exactly one function, `makeTheme`
 * (`.scratch/ask-user-question` ticket 06). Everything else they use is `bun:test`.
 */
import { mock } from "bun:test";

type ColorKey = string;

export interface MockTheme {
	fg: (_color: ColorKey, text: string) => string;
	bg: (_color: ColorKey, text: string) => string;
	bold: (text: string) => string;
	strikethrough: (text: string) => string;
}

/** Identity colours: assertions read the plain text, never an escape sequence. */
export function makeTheme(overrides: Partial<MockTheme> = {}): MockTheme {
	return {
		fg: (_color, text) => text,
		bg: (_color, text) => text,
		bold: (text) => text,
		strikethrough: (text) => text,
		...overrides,
	};
}

export interface MockTui {
	requestRender: ReturnType<typeof mock>;
}

export function makeTui(): MockTui {
	return { requestRender: mock() };
}
