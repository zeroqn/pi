/**
 * A stub for pi's formatter, shared by the suites that must not depend on pi being resolvable.
 *
 * The real `formatSkillsForPrompt` is reached through a variable specifier at call time, and it is
 * absent wherever pi is not installed — including a test process. `render.ts` exposes
 * `__setFormatterForTests` for exactly this, and the stub has to mirror pi's own output because the
 * sentence replacement matches on the formatter's text.
 *
 * It is also **module state**: `formatterPromise` is cached for the life of the process, so a suite
 * that installs a stub leaks it into every suite that runs after it. That is why every suite installs
 * its own, in `beforeEach`, rather than relying on the first one to run.
 */
import { __setFormatterForTests } from "../src/render";

export function stubFormatter(): void {
	__setFormatterForTests((skills, tool) => {
		const lines = [
			"",
			"",
			"The following skills provide specialized instructions for specific tasks.",
			`Use ${tool} to load a skill's file when the task matches its description.`,
			"When a skill file references a relative path, resolve it against the skill directory.",
			"",
			"<available_skills>",
		];
		for (const skill of skills as { name: string; description: string; filePath: string }[]) {
			lines.push(
				"  <skill>",
				`    <name>${skill.name}</name>`,
				`    <description>${skill.description}</description>`,
				`    <location>${skill.filePath}</location>`,
				"  </skill>",
			);
		}
		lines.push("</available_skills>");
		return lines.join("\n");
	});
}
