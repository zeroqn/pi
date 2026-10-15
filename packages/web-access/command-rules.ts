/**
 * The two text rules a **granted** command must satisfy, and the reason they are one module.
 *
 * Both answer the same question about the command's text: *does the output of this call come back to the
 * caller?* A granted call is allowed only because its result is fenced, so a command whose text sends the
 * output somewhere else — a redirect, a `tee`, a shell that detaches the connection — is refused instead,
 * and the refusal names which of the two it was (`policy.ts` holds the sentences).
 *
 * They live here rather than in `policy.ts` or `grants.ts` because both touch them: the policy decides with
 * them, and `grants.ts` re-exports `redirectsOrTees` where the package's tests already reach it
 * (`.scratch/guardrail-blindspots` ticket 02 §5 records the split).
 */
import { egressSegments } from "./egress";

/** Whether the command sends the granted output somewhere other than the caller. */
export function redirectsOrTees(command: string): boolean {
	if (egressSegments(command).some((segment) => segment.command === "tee")) return true;
	// One unquoted `>` is enough: `> file`, `>> file`, `>| file`, `2> file`. A `>&N` duplication
	// (`2>&1`) still returns the output to the cell and is not a file redirect.
	let quote: string | null = null;
	for (let index = 0; index < command.length; index += 1) {
		const ch = command[index];
		if (quote !== null) {
			if (ch === "\\" && quote === '"') index += 1;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (ch === "\\") {
			index += 1;
			continue;
		}
		if (ch === ">") {
			const next = command[index + 1];
			if (next === "&") {
				const after = command[index + 2];
				if (after !== undefined && (after === "-" || (after >= "0" && after <= "9"))) continue;
			}
			return true;
		}
	}
	return false;
}

/**
 * Whether the command backgrounds itself with an unquoted trailing `&`.
 *
 * The narrow rule, on purpose (ticket 02 §5): `nohup … &`, `setsid …`, `disown` and a mid-command `&` are
 * the same class spelled differently, and a word list chases them badly — `setsid sh -c '…'` gets away from
 * any of it. Those spellings are the map's fog; this catches the common one **on the text**, because pi's
 * `bash` tool has no `background` field to reject (only `command` and `timeout`). A `&&` is a sequencer, not
 * a detachment: only an unquoted single `&` with nothing but whitespace after it counts.
 */
export function backgroundsItself(command: string): boolean {
	let quote: string | null = null;
	for (let index = 0; index < command.length; index += 1) {
		const ch = command[index];
		if (quote !== null) {
			if (ch === "\\" && quote === '"') index += 1;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (ch === "\\") {
			index += 1;
			continue;
		}
		if (ch !== "&") continue;
		if (command[index - 1] === "&" || command[index + 1] === "&") continue;
		if (command.slice(index + 1).trim() !== "") continue;
		return true;
	}
	return false;
}
