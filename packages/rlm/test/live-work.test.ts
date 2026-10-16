/**
 * rlm's half of the session's live-work answer (`.scratch/todo-desync/PLAN.md` slice A): the
 * contributors answer one question the composition root cannot answer alone — *is anything this
 * contributor started still running?* — and rlm answers with the children its own records still hold.
 *
 * Two shapes matter and neither is obvious from the type: a root reads its manager's registry, while a
 * **child** reads through the context its spawner handed it (`manager` is null there, because the
 * manager belongs to the root), and only `running` records count — a child that finished a second ago
 * must be gone from the answer, or the reader that gates on it never fires.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { type ChildHandle, type ChildKernelContext } from "../src/children";
import { type RlmSessionDeps, rlmAnswer, setRlmSessionDeps, __clearRlmSessionDepsForTests } from "../src/registration";

const KEY = "/tmp/sessions/root.jsonl";

function handle(name: string, status: ChildHandle["status"]): ChildHandle {
	return {
		child_id: name,
		name,
		session_file: `/tmp/sessions/${name}.jsonl`,
		model: "deepseek/deepseek-flash",
		depth: 1,
		status,
		started_at: "2026-10-16T00:00:00.000Z",
		ended_at: status === "running" ? null : "2026-10-16T00:01:00.000Z",
	};
}

function deps(overrides: Partial<RlmSessionDeps> = {}): RlmSessionDeps {
	return {
		manager: { list: () => [handle("child-1", "running"), handle("child-2", "done")] } as never,
		childContext: null,
		ownDepth: 0,
		ownSurface: () => [],
		sessionFile: () => KEY,
		ownerDispatch: () => {},
		provenance: { startReason: "startup", isChild: false },
		...overrides,
	};
}

function answer(d: RlmSessionDeps = deps()) {
	setRlmSessionDeps(KEY, d);
	return rlmAnswer({ sessionKey: KEY, handle: { currentCell: () => "" } } as never);
}

beforeEach(() => {
	__clearRlmSessionDepsForTests();
});

describe("rlm's live-work answer", () => {
	it("names exactly the children still running", () => {
		expect(answer()?.liveWork?.()).toEqual({ count: 1, names: ["child-1"] });
	});

	it("is live: a child that ended drops out of the same answer", () => {
		let running = [handle("child-1", "running")];
		const session = deps({ manager: { list: () => running } as never });
		const built = answer(session);
		expect(built?.liveWork?.().count).toBe(1);
		running = [];
		expect(built?.liveWork?.()).toEqual({ count: 0, names: [] });
	});

	it("reads a child's own registry through the context its spawner handed it", () => {
		const childContext = {
			list: () => [handle("grandchild-1", "running"), handle("grandchild-2", "running")],
		} as unknown as ChildKernelContext;
		// The manager a child holds is the root's and knows nothing about the child's own spawns.
		const session = deps({
			childContext,
			manager: { list: () => [handle("root-sibling", "running")] } as never,
		});
		expect(answer(session)?.liveWork?.()).toEqual({
			count: 2,
			names: ["grandchild-1", "grandchild-2"],
		});
	});

	it("answers nothing at all for a session no rlm instance is serving", () => {
		expect(rlmAnswer({ sessionKey: "/tmp/sessions/other.jsonl", handle: {} } as never)).toBeNull();
	});
});
