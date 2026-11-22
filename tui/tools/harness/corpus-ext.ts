/**
 * Corpus extension: exercises every `ctx.ui` method that RPC mode carries.
 *
 * Loaded by `record_corpus.py -e` for the `dialog` fixture. The chain runs from the `/corpus-ui`
 * command rather than from `session_start`, because an awaiting dialog inside `session_start` ends the
 * RPC host before the client can answer (measured 2026-11-21: the host exits 0 right after the first
 * `extension_ui_request`; see the ticket's resolution). A command is also the shape real extensions
 * use for a dialog.
 *
 * Every call is guarded: a method that is a no-op in RPC mode (or absent in this pi version) must not
 * abort the rest, because the fixture's value is the list of requests that DID arrive.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function corpusUi(pi: ExtensionAPI): void {
	pi.registerCommand("corpus-ui", {
		description: "Exercise every ctx.ui method RPC mode carries",
		handler: async (_args: string, ctx: any) => {
			const ui = ctx?.ui;
			if (!ui) return;
			const step = async (name: string, run: () => unknown) => {
				try {
					await run();
				} catch (error) {
					try {
						await ui.notify(`corpus: ${name} failed: ${String(error)}`, "error");
					} catch {
						/* nothing to report to */
					}
				}
			};
			await step("notify", () => ui.notify("corpus notify", "info"));
			await step("setStatus", () => ui.setStatus("corpus", "diagnosing"));
			await step("setWidget", () => ui.setWidget("corpus", ["widget line one", "widget line two"]));
			await step("setTitle", () => ui.setTitle("corpus title"));
			await step("setEditorText", () => ui.setEditorText("corpus editor text"));
			await step("select", () => ui.select("Corpus select", ["alpha", "beta", "gamma"]));
			await step("confirm", () => ui.confirm("Corpus confirm", "Proceed with the corpus dialog?"));
			await step("input", () => ui.input("Corpus input", "type something"));
			await step("editor", () => ui.editor("Corpus editor", "prefilled\ntext"));
			await step("clearWidget", () => ui.setWidget("corpus", undefined));
			await step("done", () => ui.notify("corpus done", "info"));
		},
	});
}
