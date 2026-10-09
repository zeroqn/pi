/**
 * The staleness predicate (rlm-stop ticket 06) — a pure function, so the real case is a fixture rather
 * than a memory.
 *
 * The floor is the child's **model messages**; the age of the oldest in-flight host call is the clock
 * *inside* a cell; silence is the minimum of the wall-clock silence and the monotonic time since the
 * child started, so a host that slept cannot manufacture silence; and a declared bound pushes the
 * verdict out until it expires.
 *
 * The two fixtures are the ones the effort was chartered on:
 *
 *   - **child-10** (`../cases/child-10/`): a real child that wedged in an unbounded `bash` and stayed
 *     `running` for 19 hours. Its record must read stale at 12m of silence, with `phase: "waiting"` and
 *     the command named.
 *   - **wedge B** (`../tools/wedge-b-prompt.txt`): a cell with **no host call at all**
 *     (`while True: time.sleep(1)`), which today's `remove` could not end. Its record must read stale
 *     with `phase: "computing"` and nothing to name.
 */
import { describe, expect, it } from "bun:test";
import { STALE_AFTER_DEFAULT_SECONDS } from "../src/config";
import { staleness } from "../src/children";

const MINUTE = 60_000;
/** child-10's own transcript: the last message at 08:39:42Z, one unbounded `bash` from 08:39:43Z. */
const CHILD_10_MESSAGE = Date.parse("2026-10-08T08:39:42.000Z");
const CHILD_10_CALL = "2026-10-08T08:39:43.000Z";
const CHILD_10_COMMAND = "bash: cat /dev/dri/renderD128";

/** What child-10's kernel would have published: one call in flight, unbounded, no bound declared. */
const child10Activity = {
	cell_running: true,
	calls: [
		{
			name: "bash_host",
			detail: CHILD_10_COMMAND,
			started_at: CHILD_10_CALL,
			age_ms: 12_000,
			timeout_s: null,
		},
	],
};

/** Read the verdict for child-10 at a wall-clock instant, given the child started 2 minutes before. */
function child10At(instant: string, activity: typeof child10Activity | null = child10Activity) {
	const wall = Date.parse(instant);
	const startedMonotonic = 0;
	return staleness(
		{
			status: "running",
			lastMessageAt: CHILD_10_MESSAGE,
			startedMonotonic,
			activity,
		},
		// The monotonic clock has run the whole time since the child started, so it never caps this case.
		{ wall, monotonic: wall - CHILD_10_MESSAGE + 2 * MINUTE },
		STALE_AFTER_DEFAULT_SECONDS,
	)!;
}

describe("the staleness predicate (rlm-stop ticket 06)", () => {
	it("reads the child-10 fixture: fresh early, stale once the threshold passes", () => {
		const early = child10At("2026-10-08T08:45:00.000Z");
		expect(early.stale).toBe(false);
		// The call started a second after the message, so the call is the newest evidence.
		expect(early.idle_seconds).toBe(317);
		expect(early.phase).toBe("waiting");
		expect(early.waiting_on).toBe(CHILD_10_COMMAND);

		const late = child10At("2026-10-08T08:51:25.000Z");
		expect(late.stale).toBe(true);
		expect(late.idle_seconds).toBe(702);
		expect(late.phase).toBe("waiting");
		expect(late.waiting_on).toBe(CHILD_10_COMMAND);
		expect(late.expectation_seconds).toBeUndefined();
	});

	it("reads a cell with no host call at all as computing, and stale on silence alone", () => {
		const wedgeB = staleness(
			{
				status: "running",
				lastMessageAt: 1_000_000,
				startedMonotonic: 0,
				activity: { cell_running: true, calls: [] },
			},
			{ wall: 1_000_000 + 11 * MINUTE, monotonic: 11 * MINUTE },
			STALE_AFTER_DEFAULT_SECONDS,
		)!;
		expect(wedgeB.stale).toBe(true);
		expect(wedgeB.phase).toBe("computing");
		expect(wedgeB.waiting_on).toBeUndefined();
		expect(wedgeB.idle_seconds).toBe(660);
	});

	it("calls a finished run idle, and fires exactly at the threshold", () => {
		const idle = staleness(
			{ status: "running", lastMessageAt: 0, startedMonotonic: 0, activity: { cell_running: false, calls: [] } },
			{ wall: 10 * MINUTE, monotonic: 10 * MINUTE },
			STALE_AFTER_DEFAULT_SECONDS,
		)!;
		expect(idle.phase).toBe("idle");
		expect(idle.stale).toBe(true);

		const second = (offset: number) =>
			staleness(
				{ status: "running", lastMessageAt: 0, startedMonotonic: 0 },
				{ wall: 600_000 + offset, monotonic: 600_000 + offset },
				600,
			)!.stale;
		expect(second(-1_000)).toBe(false);
		expect(second(0)).toBe(true);
		expect(second(1_000)).toBe(true);
	});

	it("lets a declared bound buy exactly its own patience, and no more", () => {
		const bounded = (elapsedMs: number) =>
			staleness(
				{
					status: "running",
					lastMessageAt: 0,
					startedMonotonic: 0,
					activity: {
						cell_running: true,
						calls: [
							{
								name: "bash_host",
								detail: "bash: make -j8",
								started_at: new Date(0).toISOString(),
								age_ms: elapsedMs,
								timeout_s: 1_800,
							},
						],
					},
				},
				{ wall: elapsedMs, monotonic: elapsedMs },
				600,
			)!;
		const inside = bounded(20 * MINUTE);
		expect(inside.stale).toBe(false);
		expect(inside.expectation_seconds).toBe(600);

		const past = bounded(30 * MINUTE + 1_000);
		expect(past.stale).toBe(true);
		expect(past.expectation_seconds).toBeUndefined();
	});

	it("accepts a note's own expectation the same way (the child's declaration)", () => {
		const withNote = (elapsedMs: number) =>
			staleness(
				{
					status: "running",
					lastMessageAt: 0,
					startedMonotonic: 0,
					note: { at: new Date(0).toISOString(), expect_seconds: 1_800 },
				},
				{ wall: elapsedMs, monotonic: elapsedMs },
				600,
			)!;
		expect(withNote(25 * MINUTE).stale).toBe(false);
		expect(withNote(25 * MINUTE).expectation_seconds).toBe(300);
		expect(withNote(31 * MINUTE).stale).toBe(true);
	});

	it("does not manufacture silence out of a wall-clock jump", () => {
		// A laptop that slept: the wall clock moved 12 hours, monotonic time moved two minutes.
		const jumped = staleness(
			{ status: "running", lastMessageAt: 0, startedMonotonic: 0 },
			{ wall: 12 * 60 * MINUTE, monotonic: 2 * MINUTE },
			600,
		)!;
		expect(jumped.stale).toBe(false);
		expect(jumped.idle_seconds).toBe(120);
	});

	it("reports no phase when the kernel cannot be reached, and decides on the floor alone", () => {
		const blind = staleness(
			{ status: "running", lastMessageAt: 0, startedMonotonic: 0 },
			{ wall: 11 * MINUTE, monotonic: 11 * MINUTE },
			600,
		)!;
		expect(blind.stale).toBe(true);
		expect(blind.phase).toBeUndefined();
		expect(blind.waiting_on).toBeUndefined();
	});

	it("treats a threshold of zero as never stale, and says nothing about a terminal child", () => {
		expect(
			staleness(
				{ status: "running", lastMessageAt: 0, startedMonotonic: 0 },
				{ wall: 10 * 60 * MINUTE, monotonic: 10 * 60 * MINUTE },
				0,
			)!.stale,
		).toBe(false);
		expect(
			staleness(
				{ status: "stopped", lastMessageAt: 0, startedMonotonic: 0 },
				{ wall: 10 * 60 * MINUTE, monotonic: 10 * 60 * MINUTE },
				600,
			),
		).toBeNull();
		for (const status of ["done", "failed", "stopped"] as const) {
			expect(staleness({ status, lastMessageAt: 0, startedMonotonic: 0 }, { wall: 1, monotonic: 1 }, 600)).toBeNull();
		}
	});

	it("takes the monotonic cap from the child's own start, not from the evidence", () => {
		// A child that has existed for 20 minutes and said nothing: its silence is bounded by how long it
		// has existed, and `min` picks the honest one.
		const young = staleness(
			{ status: "running", lastMessageAt: null, startedMonotonic: 0 },
			{ wall: 60 * MINUTE, monotonic: 90_000 },
			600,
		)!;
		expect(young.stale).toBe(false);
		expect(young.idle_seconds).toBe(90);
	});
});
