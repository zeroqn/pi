/**
 * The shell a host command runs in — `bash_host` and the background manager both spawn with it.
 *
 * `$SHELL` is the host's own answer to "which shell am I", and `/bin/bash` is the last resort for a
 * launcher that exports none (an empty value counts as unset, so the fallback still runs). There is
 * deliberately no override variable: a host with neither is a **preflight problem** (`shellProblem`),
 * reported before the first cell, rather than a knob to set — which is the reason `RLM_SHELL` used to
 * exist.
 *
 * Not `/bin/sh` as the fallback: the argv is `-lc`, and `-l` is not POSIX sh (`dash` refuses it) —
 * which is exactly what CI's ubuntu-24.04 would hand us.
 */
import { existsSync } from "node:fs";

export const SHELL = process.env.SHELL || "/bin/bash";

/** What the preflight says when there is no shell to run host commands in, or null when there is.
 *
 * The parameter is the path the check asks about, so a test can ask about one this host does not have. */
export function shellProblem(shell: string = SHELL): string | null {
	if (existsSync(shell)) return null;
	return `no shell to run host commands in: ${shell} does not exist — export SHELL pointing at a shell, or install bash at /bin/bash`;
}
