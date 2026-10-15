/**
 * The policy unit: **one decision, two seams** (`.scratch/guardrail-blindspots` tickets 02 and 03).
 *
 * The egress guardrail began as the kernel's (`code-mode`'s `egress` slot). Its policy, though, was never
 * kernel-shaped: it reads a **command's text**, compares the destinations it names against the session's
 * live grants, asks a human where it can, and answers. This module is that decision, with a verdict that
 * names no seam:
 *
 *     CallVerdict = { kind: "allow" } | { kind: "fence", fence } | { kind: "refuse", reason }
 *
 * Each seam translates it into its own vocabulary and performs the act itself:
 *
 *   - the **kernel seam** (`web-access/host.ts`'s `egress.before` → {@link toEgressVerdict}): code mode's
 *     `guarded()` refuses with the reason and wraps the call's text fields with the fence;
 *   - the **tool seam** (`web-access/tool-seam.ts`): pi's `tool_call` is blocked with the reason and
 *     `tool_result` has its text block wrapped with the same fence.
 *
 * The union exists so the two cannot drift: "allowed *and* fenced" is unrepresentable as anything else, so
 * no seam can treat a fenced allowance as a plain allow.
 *
 * ## What stays where
 *
 * The **record** (the per-session state, its entries and the project declaration) stays in `grants.ts`,
 * together with the routes (`/ssh-grant`, the session-start restore) — and the two small view helpers the
 * route's listing needs (`heldKeysOf`, `isStaleGrant`) and the context readers (`hasUi`, `uiOf`,
 * `signalOf`) stay with it because both modules use them. This module owns the **decision**: the gate
 * routing, the view a decision is made against, the ask, and the refusal's words.
 *
 * ## The rules a granted call must satisfy (the fence is the price of the grant)
 *
 * A grant buys one thing: the call runs **and what it returns is fenced**. Where the fence cannot reach,
 * the grant does not apply and the call is refused — `background=True` (a handle, not output, and the text
 * would arrive through calls this policy never produced), a redirect or tee (the text lands on the host's
 * disk where `read_text` returns it unfenced), and a command that **detaches itself** (a trailing `&`: the
 * connection would outlive the call whose result the fence wraps). Those are the three refusals
 * {@link grantedCall} builds; every other refusal comes from the matcher or the matcher's comparison.
 */
import {
	checkEgress,
	describeAge,
	destinationKeys,
	egressSegments,
	transportRefusal,
	unmatched,
	type EgressSegment,
} from "./egress";
import { backgroundsItself, redirectsOrTees } from "./command-rules";
import { REMOTE_OUTPUT_FENCE } from "./guard";
import {
	ASK_TIMEOUT_MS,
	FENCE_API_VERSION,
	GRANT_IDLE_DAYS,
	PROJECT_FILE,
	countRefusal,
	ensureGrantRecord,
	grantFloor,
	hasUi,
	heldKeysOf,
	isStaleGrant,
	persistGrantState,
	signalOf,
	updateStatus,
	uiOf,
	type Grant,
	type GrantSession,
	type GrantView,
	type SshGrantState,
} from "./grants";

/** The three strings a fence is made of; `guard.ts`'s `REMOTE_OUTPUT_FENCE` is this package's. */
export type Fence = { open: string; preamble: string; close: string };

/**
 * What a policy answers for one call, seam-neutrally.
 *
 * `allow` is "no verdict" for the kernel seam (the callee runs, and nothing about its result changes);
 * `fence` is "it runs, and its text is external"; `refuse` carries the sentence the model reads.
 */
export type CallVerdict =
	| { kind: "allow" }
	| { kind: "fence"; fence: Fence }
	| { kind: "refuse"; reason: string };

/** The five-family command words whose destination is a host; `sshpass` wraps one. */
const FAMILY = new Set(["ssh", "scp", "sftp", "mosh", "rsync", "sshpass"]);

/** Whether this segment is one the transport matcher judges (so `checkEgress` must not). */
function isFamilySegment(segment: EgressSegment): boolean {
	if (FAMILY.has(segment.command)) return true;
	const reading = destinationKeys(segment.text);
	return reading.keys.length > 0 || reading.refused !== undefined;
}

/** The command's non-transport text: what `checkEgress` still judges on its own terms. */
function nonFamilyText(command: string): string {
	return egressSegments(command)
		.filter((segment) => !isFamilySegment(segment))
		.map((segment) => segment.text)
		.join("\n");
}

/** The command text with comments stripped, so a `# /dev/tcp/...` comment cannot be mistaken for one. */
function strippedText(command: string): string {
	return egressSegments(command)
		.map((segment) => segment.text)
		.join("\n");
}

const SOCKET_REDIRECT = /\/dev\/(tcp|udp)\//;

const BACKGROUND_REFUSAL =
	"web-access: that command is granted for this session, but a `background=True` invocation returns a handle, not the output — the remote text would reach the cell later through calls this policy did not produce, so the fence cannot wrap it. Run it in the foreground.";

const REDIRECT_REFUSAL =
	"web-access: that command is granted for this session, but its output is redirected or teed: the text would land on the host's disk, where read_text returns it unfenced. A granted command's output comes back to the cell or it does not run — run it without the redirect.";

/** Ticket 02 §5: a granted connection that outlives the call is the `-t` class by another spelling. */
const DETACHED_REFUSAL =
	"web-access: that command is granted for this session, but it detaches itself (an unquoted trailing `&`): the connection would outlive the call, and the fence wraps a result that came back. Run it in the foreground.";

/** Preference 6: an interactive connection has no completion, and a cell cannot drive a terminal anyway. */
const TTY_REFUSAL =
	"web-access: that command is granted for this session, but it asks for a terminal (`-t`/`-tt`, `-o RequestTTY=`): an interactive session has no result for the fence to wrap, and a cell cannot drive a terminal. Drop `-t` (use `-T` to say so explicitly) and run the command non-interactively.";

/** A granted invocation's verdict: fenced if the result comes back, refused if it cannot. */
function grantedCall(command: string, background: boolean, tty: boolean): CallVerdict {
	if (background) return { kind: "refuse", reason: BACKGROUND_REFUSAL };
	if (redirectsOrTees(command)) return { kind: "refuse", reason: REDIRECT_REFUSAL };
	if (backgroundsItself(command)) return { kind: "refuse", reason: DETACHED_REFUSAL };
	if (tty) return { kind: "refuse", reason: TTY_REFUSAL };
	return { kind: "fence", fence: REMOTE_OUTPUT_FENCE };
}

function versionRefusal(command: string, keys: readonly string[], version: number): string {
	return `web-access: ${command} reaches ${keys.join(", ")}, and this session cannot grant it: its code mode speaks contract version ${version}, and a grant needs ${FENCE_API_VERSION} (a verdict that fences what comes back). For a host, no route exists in this session.`;
}

/**
 * Ask one question, with the literal command and every key it would grant. Any non-answer is a no.
 *
 * A **stale** grant is being re-confirmed, so the body says so and how old it is: a human deciding
 * again should know it is a resume and not a fresh ask (ticket 07 §3).
 */
export async function askForGrant(
	ctx: unknown,
	command: string,
	keys: readonly string[],
	declared: readonly string[],
	stale: readonly { key: string; at: number }[] = [],
	where = "in a cell",
): Promise<boolean> {
	const ui = uiOf(ctx);
	if (ui === null || typeof ui.confirm !== "function") return false;
	const title = `Reach ${keys.join(", ")} for this session?`;
	const declaredNote = declared.length > 0 ? `\n\nDeclared in ${PROJECT_FILE}: ${declared.join(", ")}.` : "";
	const staleNote =
		stale.length > 0
			? `\n\nThis is a re-confirmation: ${stale
					.map((entry) => `${entry.key} was granted ${describeAge(entry.at)} ago, past the ${GRANT_IDLE_DAYS}-day window`)
					.join("; ")}.`
			: "";
	// `where` is the seam's own word for what is asking: a kernel cell, or pi's own shell tool. The dialog
	// is the same dialog either way (one store, one ask), but it must not tell a human the command is
	// running "in a cell" when the model asked for it as a tool call — row 4 of the map's bar caught that.
	const body = `The session is asking to run, ${where}:\n\n${command}\n\nThis grants: ${keys.join(", ")}${declaredNote}${staleNote}`;
	try {
		const yes = await (ui.confirm as (title: string, body: string, opts: { timeout: number; signal?: AbortSignal }) => Promise<boolean>)(
			title,
			body,
			{ timeout: ASK_TIMEOUT_MS, signal: signalOf(ctx) },
		);
		return yes === true;
	} catch {
		return false;
	}
}

function declineOrRefusal(
	session: GrantSession,
	command: string,
	keys: readonly string[],
	held: Set<string>,
	declined: boolean,
	stale: readonly { key: string; at: number }[] = [],
): string {
	const state = ensureGrantRecord(session.sessionKey);
	return transportRefusal({
		command,
		keys,
		comparison: unmatched(keys, held),
		hasUI: hasUi(session.ctx),
		isChild: session.isChild,
		projectTrusted: state.projectTrusted,
		declined,
		// The policy only reaches this without a dialog, so the stale sentence's "nobody can be asked"
		// is true by construction; it names the age and the human (ticket 07 §3).
		...(stale.length > 0 ? { stale: { key: stale[0].key, at: stale[0].at, windowDays: GRANT_IDLE_DAYS } } : {}),
	});
}

/**
 * A child session's effective grants, denials and project; the record itself for anyone else.
 *
 * The floor is consulted **live** and is the whole truth — a key revoked in the spawner must not
 * survive here because a marker once named it. The project is always the child's **own** declaration:
 * the spawner's project is about the spawner's cwd, not the child's.
 */
export function childView(session: GrantSession, state: SshGrantState): GrantView {
	if (!session.isChild) return state;
	const floor = grantFloor(session.sessionKey);
	const source = floor !== undefined ? floor() : state.inherited;
	return {
		grants: source?.grants ?? new Map(),
		denials: source?.denials ?? new Set(),
		project: state.project,
	};
}

/**
 * Decide one call, whoever is asking.
 *
 * Everything `checkEgress` refuses stays refused, except the transport family, which is judged by
 * `destinationKeys` against this session's live grants. `canFence` is the kernel seam's
 * `apiVersion >= 5`; the tool seam always can (it supplies the wrap itself), and passes `true`.
 */
export async function decide(
	command: string,
	background: boolean,
	session: GrantSession,
	canFence: boolean,
	codeModeVersion: number,
	/** The seam's word for what is asking, for the dialog's own sentence (see {@link askForGrant}). */
	where = "in a cell",
): Promise<CallVerdict> {
	// 1. Everything the present gate refuses, except the family — so a command combining a granted
	//    ssh with a curl is still refused for the curl.
	const whole = checkEgress(command);
	if (!whole.ok) {
		const restVerdict = checkEgress(nonFamilyText(command));
		if (!restVerdict.ok) return { kind: "refuse", reason: restVerdict.reason };
		// The refusal came from a family segment, or from a raw socket inside one; tell them apart.
		if (SOCKET_REDIRECT.test(strippedText(command))) return { kind: "refuse", reason: whole.reason };
	}

	// 2. The transport family, through the matcher.
	const reading = destinationKeys(command);
	if (reading.refused !== undefined) return { kind: "refuse", reason: reading.refused };
	if (reading.keys.length === 0) return { kind: "allow" }; // reaches nobody: `ssh -V`, a local `rsync -e ssh`.

	const state = ensureGrantRecord(session.sessionKey);
	if (!canFence) {
		countRefusal(session.ctx, state);
		return { kind: "refuse", reason: versionRefusal(command, reading.keys, codeModeVersion) };
	}

	// 3. Compare against the live grants. A dialog-capable session does not let a project declaration
	//    stand in for a human's answer; where nobody can be asked, it is what applies. A **child**
	//    reads its spawner's effective state through the floor (live, removals included); a resumed
	//    child with no spawner reads the marker its transcript carries.
	const view = childView(session, state);
	const dialogCapable = hasUi(session.ctx) && !session.isChild;
	const held = heldKeysOf(view, dialogCapable);
	const comparison = unmatched(reading.keys, held);
	const unheld = [...comparison.missing, ...comparison.unmatched];
	const tty = reading.ttyRequested === true;
	if (unheld.length === 0) return grantedCall(command, background, tty);

	// 4. A no is remembered for the session; without it the next cell asks again, which reads as the
	//    tool not listening (ticket 06 §4). A stale grant is **not** a no: it re-asks where a dialog
	//    can appear, and is refused with its age where nobody can be asked (ticket 07 §3).
	const denied = unheld.some((key) => view.denials.has(key));
	const stale = unheld
		.map((key) => ({ key, grant: view.grants.get(key) }))
		.filter((entry): entry is { key: string; grant: Grant } => entry.grant !== undefined)
		.filter((entry) => isStaleGrant(entry.grant))
		.map((entry) => ({ key: entry.key, at: entry.grant.at as number }));
	if (dialogCapable && !denied) {
		const declared = reading.keys.filter((key) => state.project !== null && state.project.keys.includes(key));
		const yes = await askForGrant(session.ctx, command, reading.keys, declared, stale, where);
		if (yes === true) {
			// A yes **re-stamps** every key, so an actively used grant never re-asks twice.
			const at = Date.now();
			for (const key of reading.keys) {
				state.grants.set(key, { route: "ask", at });
				state.denials.delete(key);
				state.deniedAt.delete(key);
			}
			persistGrantState(state);
			updateStatus(session.ctx, state);
			return grantedCall(command, background, tty);
		}
		for (const key of unheld) {
			state.denials.add(key);
			state.deniedAt.set(key, Date.now());
		}
		persistGrantState(state);
		countRefusal(session.ctx, state);
		return { kind: "refuse", reason: declineOrRefusal(session, command, reading.keys, held, true, stale) };
	}
	countRefusal(session.ctx, state);
	return { kind: "refuse", reason: declineOrRefusal(session, command, reading.keys, held, denied, stale) };
}

/**
 * The kernel seam's translation: the union as code mode's `EgressVerdict` expects it.
 *
 * `allow` becomes **no verdict at all** (`undefined`), which is what the slot said before this refactor —
 * so an ordinary call's result is untouched, byte for byte, and the adapter's tests are the proof
 * (ticket 02 §3).
 */
export function toEgressVerdict(
	verdict: CallVerdict,
): { allow: false; reason: string } | { allow: true; fence: Fence } | undefined {
	if (verdict.kind === "allow") return undefined;
	if (verdict.kind === "refuse") return { allow: false, reason: verdict.reason };
	return { allow: true, fence: verdict.fence };
}
