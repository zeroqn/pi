/**
 * rlm's delegation surface, as the kernel sees it: the host functions behind `_Rlm`,
 * `agent_message`, `find_models` and `rlm.list`/`poll`/`remove`/`send`/`tree_cost`
 * (`prelude-rlm.ts` wraps them).
 *
 * Background handles are *not* here — they are code mode's (ticket 03's table). What this
 * file adds is everything that routes to a child session, at the root (through the child
 * manager) or inside a child (through the `ChildKernelContext` its spawner handed it).
 */
import { findModels, modelRuntime } from "./children";
import type { ChildHandle, ChildKernelContext } from "./children";
import { bind } from "./host-util";
import { num, str } from "./util";

export type DelegationDeps = {
	/** The root's child manager, or null inside a child. */
	manager: { spawn: (request: any) => Promise<ChildHandle>; poll: (selector: string) => any; list: () => any; remove: (selector: string) => any; send: (selector: string, text: string) => any; treeCost: () => number } | null;
	/** Present inside a child: this is which parent the delegation calls reach. */
	childContext: ChildKernelContext | null;
	/** Absolute durable depth of this session, so a child spawns one level deeper. */
	ownDepth: number;
	/** The child's own session file, recorded as its child's parent (provenance, not the root's). */
	sessionFile: () => string | undefined;
	/** How a finished child notifies its spawner: the parent's notice queue. */
	ownerDispatch?: (notice: { key: string; content: string; customType?: string; cancelled?: () => boolean }) => void;
	/** Which cell is running, for `spawnCell` provenance at depth >= 2. */
	currentCell: () => string;
};

export function delegationHostFns(deps: DelegationDeps): Record<string, (...args: unknown[]) => Promise<unknown>> {
	const spawnHandle = async (depth: number, args: unknown[]): Promise<ChildHandle> => {
		const { prompt, name, model, thinking } = bind(args, ["prompt", "name", "model", "thinking"]);
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
			return deps.childContext.spawn({ ...inner, parentSessionFile: deps.sessionFile(), spawnCell: deps.currentCell() });
		}
		return deps.manager!.spawn({
			...inner,
			depth,
			spawnCell: deps.currentCell(),
			parentSessionFile: deps.sessionFile(),
			ownerDispatch: deps.ownerDispatch,
		});
	};

	return {
		async rlm_spawn(...args: unknown[]) {
			// The depth is absolute: a session that is itself a child spawns one level deeper
			// than its own durable depth, which is what enforces the cap with no root present.
			return spawnHandle(deps.ownDepth + 1, args);
		},
		async rlm_poll(...args: unknown[]) {
			const { selector } = bind(args, ["selector"]);
			return deps.childContext ? deps.childContext.poll(str(selector)) : deps.manager!.poll(str(selector));
		},
		async rlm_list() {
			return deps.childContext ? deps.childContext.list() : deps.manager!.list();
		},
		async rlm_remove(...args: unknown[]) {
			const { selector } = bind(args, ["selector"]);
			return deps.childContext ? deps.childContext.remove(str(selector)) : deps.manager!.remove(str(selector));
		},
		async rlm_send(...args: unknown[]) {
			const { selector, text } = bind(args, ["selector", "text"]);
			return deps.childContext
				? deps.childContext.send(str(selector), str(text))
				: deps.manager!.send(str(selector), str(text));
		},
		async rlm_find_models(...args: unknown[]) {
			const { query, limit } = bind(args, ["query", "limit"]);
			const text = query ? str(query) : undefined;
			const count = num(limit, 20);
			return deps.childContext ? deps.childContext.findModels(text, count) : findModels(await modelRuntime(), text, count);
		},
		async rlm_tree_cost() {
			return { total_tokens: deps.manager ? deps.manager.treeCost() : 0, own_depth: deps.ownDepth };
		},
		async agent_message_send(...args: unknown[]) {
			const { text, receiver_role } = bind(args, ["text", "receiver_role"]);
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
