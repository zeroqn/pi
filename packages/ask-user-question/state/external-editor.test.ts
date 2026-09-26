import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { editWithExternalEditor } from "./external-editor.js";

let fixtureDir: string;
let stdout: ReturnType<typeof spyOn>;

beforeEach(() => {
	fixtureDir = mkdtempSync(join(tmpdir(), "rpiv-external-editor-test-"));
	stdout = spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
	stdout.mockRestore();
	rmSync(fixtureDir, { recursive: true, force: true });
});

describe("editWithExternalEditor", () => {
	it("round-trips the temp file and restores the TUI after the editor exits", async () => {
		const editor = join(fixtureDir, "editor.mjs");
		writeFileSync(
			editor,
			'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], "edited answer\\n");',
		);
		const tui = { stop: mock(), start: mock(), requestRender: mock() };

		const result = await editWithExternalEditor(tui, `${process.execPath} ${editor}`, "draft");

		expect(result).toBe("edited answer");
		expect(tui.stop).toHaveBeenCalledTimes(1);
		expect(tui.start).toHaveBeenCalledTimes(1);
		expect(tui.requestRender).toHaveBeenCalledWith(true);
	});

	it("restores the TUI and rejects when the editor exits unsuccessfully", async () => {
		const editor = join(fixtureDir, "failing-editor.mjs");
		writeFileSync(editor, "process.exit(7);");
		const tui = { stop: mock(), start: mock(), requestRender: mock() };

		await expect(editWithExternalEditor(tui, `${process.execPath} ${editor}`, "draft")).rejects.toThrow(
			"exit code 7",
		);
		expect(tui.start).toHaveBeenCalledTimes(1);
		expect(tui.requestRender).toHaveBeenCalledWith(true);
	});
});
