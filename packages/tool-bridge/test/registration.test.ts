/**
 * The registration: the pin that keeps this package's offer *wired*, not merely written
 * (`.scratch/host-bridge` ticket 05).
 *
 * Every field here is one a child loses silently if it is dropped — a misnamed member is not a type
 * error, it is an offer the seam never reads. So each is asserted by name, and the whole registration
 * is handed to the seam's own validator, which is the thing that would refuse it in a live process.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { contributors, registerContributor, __resetHostBridgeForTests } from "../../host-bridge/src/convention";
import { toolBridgeRegistration } from "../src/registration";

beforeEach(() => __resetHostBridgeForTests());

describe("the registration", () => {
	it("is accepted by the seam's own validator", () => {
		expect(registerContributor(toolBridgeRegistration)).toEqual({ registered: true });
		expect(contributors().map((entry) => entry.key)).toEqual(["pi-tool-bridge"]);
	});

	it("declares every child fact a child needs, or the child loses it silently", () => {
		for (const field of [
			"session",
			"childEligible",
			"childFactories",
			"childSurface",
			"bindChild",
			"childStatus",
		] as const) {
			expect(typeof toolBridgeRegistration[field]).toBe("function");
		}
	});

	it("names itself once, so a second import cannot leave two live offers", () => {
		registerContributor(toolBridgeRegistration);
		registerContributor(toolBridgeRegistration);
		expect(contributors()).toHaveLength(1);
	});
});
