/**
 * rlm's delegation surface, as the kernel sees it: the host functions behind `_Rlm`,
 * `agent_message`, `find_models` and `rlm.list`/`poll`/`remove`/`send`/`tree_cost`
 * (`prelude-rlm.ts` wraps them).
 *
 * Background handles are *not* here — they are code mode's (ticket 03's table). What this
 * file adds is everything that routes to a child session, at the root (through the child
 * manager) or inside a child (through the `ChildKernelContext` its spawner handed it).
 */
import { WAIT_DEFAULT_SECONDS, findModels, modelRuntime } from "./children";
import type { ChildHandle, ChildKernelContext } from "./children";
import { bind } from "./host-util";
import { num, str } from "./util";

export type DelegationDeps = {
	/** The root's child manager, or null inside a child. */
	manager: {
		spawn: (request: any) => Promise<ChildHandle>;
		poll: (selector: string) => any;
		list: () => any;
		/** Ends a child and its own subtree (`.scratch/rlm-stop` tickets 03/04). */
		stop: (selector: string, reason?: string) => any;
		remove: (selector: string) => any;
		send: (selector: string, text: string) => any;
		treeCost: () => number;
		/** The join (rlm-wait ticket 01): resolve, then wait for terminal or for the patience to run out. */
		wait: (selectors: string[], timeoutSeconds: number) => Promise<any[]>;
	} | null;
	/** Present inside a child: this is which parent the delegation calls reach. */
	childContext: ChildKernelContext | null;
	/** Whether this session is a child at all — a root has no record to note on (ticket 10). */
	isChild?: boolean;
	/** Absolute durable depth of this session, so a child spawns one level deeper. */
	ownDepth: number;
	/** The child's own session file, recorded as its child's parent (provenance, not the root's). */
	sessionFile: () => string | undefined;
	/** How a finished child notifies its spawner: the parent's notice queue. */
	ownerDispatch?: (notice: { key: string; content: string; customType?: string; cancelled?: () => boolean }) => void;
	/** Which cell is running, for `spawnCell` provenance at depth >= 2. */
	currentCell: () => string;
	/**
	 * **This** session's live surface, read when a child is spawned (`.scratch/child-surface/` ticket
	 * 01 §3). It travels with the request because the manager that actually creates the child may not be
	 * this session's: a grandchild is spawned through the *root's* manager, so without this the ceiling
	 * would be computed from the root's surface and a grandchild could hold a tool its own parent does
	 * not — breaking the transitivity the rule promises.
	 */
	ownSurface: () => string[];
};

export function delegationHostFns(deps: DelegationDeps): Record<string, (...args: unknown[]) => Promise<unknown>> {
	const spawnHandle = async (depth: number, args: unknown[]): Promise<ChildHandle> => {
		const { prompt, name, model, thinking } = bind(args, ["prompt", "name", "model", "thinking"], "rlm.spawn");
		const label = str(name).trim();
		if (!label) throw new Error("rlm.spawn requires a name");
		const inner = {
			prompt: str(prompt),
			name: label,
			model: model ? str(model) : undefined,
			thinking: thinking ? str(thinking) : undefined,
		};
		if (deps.childContext) {
			// The child's own session file is *its* child's parent — provenance, not the root's.
			return deps.childContext.spawn({
				...inner,
				parentSessionFile: deps.sessionFile(),
				spawnCell: deps.currentCell(),
				surface: deps.ownSurface(),
			});
		}
		return deps.manager!.spawn({
			...inner,
			depth,
			spawnCell: deps.currentCell(),
			parentSessionFile: deps.sessionFile(),
			ownerDispatch: deps.ownerDispatch,
			surface: deps.ownSurface(),
		});
	};

	return {
		async rlm_spawn(...args: unknown[]) {
			// The depth is absolute: a session that is itself a child spawns one level deeper
			// than its own durable depth, which is what enforces the cap with no root present.
			return spawnHandle(deps.ownDepth + 1, args);
		},
		async rlm_stop(...args: unknown[]) {
			const { selector, reason } = bind(args, ["selector", "reason"], "rlm.stop");
			// A child's stop goes through its own context, which is what carries the asker's identity
			// into the manager's authority check (ticket 04 §3).
			const text = reason === undefined || reason === null ? undefined : str(reason);
			return deps.childContext
				? deps.childContext.stop(str(selector), text)
				: deps.manager!.stop(str(selector), text);
		},
		/**
		 * The child's own declaration (ticket 10). A **root** has no record of its own to write on, so
		 * the refusal is the same fact `rlm.note`'s absence would convey, said out loud.
		 */
		async rlm_note(...args: unknown[]) {
			const { text, expect_seconds } = bind(args, ["text", "expect_seconds"], "rlm.note");
			if (!deps.childContext) {
				throw new Error("rlm.note: only a delegated child can note; this session has no record to note on");
			}
			return deps.childContext.note(str(text), expect_seconds === null ? null : num(expect_seconds, 0) || null);
		},
		async rlm_poll(...args: unknown[]) {
			const { selector } = bind(args, ["selector"], "rlm.poll");
			return deps.childContext ? deps.childContext.poll(str(selector)) : deps.manager!.poll(str(selector));
		},
		async rlm_list() {
			return deps.childContext ? deps.childContext.list() : deps.manager!.list();
		},
		async rlm_remove(...args: unknown[]) {
			const { selector } = bind(args, ["selector"], "rlm.remove");
			return deps.childContext ? deps.childContext.remove(str(selector)) : deps.manager!.remove(str(selector));
		},
		async rlm_send(...args: unknown[]) {
			const { selector, text } = bind(args, ["selector", "text"], "rlm.send");
			return deps.childContext
				? deps.childContext.send(str(selector), str(text))
				: deps.manager!.send(str(selector), str(text));
		},
		async rlm_wait(...args: unknown[]) {
			const { names, timeout } = bind(args, ["names", "timeout"], "rlm.wait");
			// One name or a list of them; a string is the ordinary case and a list is the fan-out. Names
			// are trimmed the way `rlm.spawn` trims the label it creates, so a name that is only
			// whitespace selects nothing rather than selecting something surprising.
			const selectors = Array.isArray(names)
				? names.map((name) => str(name).trim()).filter((name) => name.length > 0)
				: str(names).trim()
					? [str(names).trim()]
					: [];
			if (selectors.length === 0) throw new Error("rlm.wait needs at least one child id or name");
			const seconds = timeout === null || timeout === undefined ? WAIT_DEFAULT_SECONDS : num(timeout, WAIT_DEFAULT_SECONDS);
			// A child joins through the same manager its `poll` reads (rlm-wait ticket 01): selectors
			// resolve in the manager the caller can see, so a root reaches any live descendant — a
			// grandchild included, since the registry lives in the root.
			return deps.childContext
				? deps.childContext.wait(selectors, seconds)
				: deps.manager!.wait(selectors, seconds);
		},
		async rlm_find_models(...args: unknown[]) {
			const { query, limit } = bind(args, ["query", "limit"], "find_models");
			const text = query ? str(query) : undefined;
			const count = num(limit, 20);
			return deps.childContext ? deps.childContext.findModels(text, count) : findModels(await modelRuntime(), text, count);
		},
		async rlm_tree_cost() {
			return { total_tokens: deps.manager ? deps.manager.treeCost() : 0, own_depth: deps.ownDepth };
		},
		async agent_message_send(...args: unknown[]) {
			const { text, receiver_role } = bind(args, ["text", "receiver_role"], "agent_message.send");
			const role = receiver_role ? str(receiver_role) : null;
			if (deps.childContext && (!role || role === "parent")) {
				deps.childContext.onMessage(str(text));
				return { sent: true, to: "parent" };
			}
			if (!deps.childContext && role) {
				const handle = await deps.manager!.send(role, str(text));
				return { sent: true, to: handle.child_id, status: handle.status };
			}
			throw new Error('agent_message.send needs receiver_role="parent" inside a child, or a child id or name at the root');
		},
	};
}
