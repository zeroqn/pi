import { describe, expect, it } from "bun:test";
import { resolveConfigDir } from "../config";

const home = "/home/dev";
const exists = (present: string[]) => (path: string) => present.includes(path);

describe("where the shared config is looked for (ticket 03, extended deliberately)", () => {
	it("prefers an explicit PI_CODING_AGENT_DIR above everything", () => {
		const found = exists(["/xdg/pi/web-search.json", `${home}/.pi/agent/web-search.json`]);
		expect(resolveConfigDir({ PI_CODING_AGENT_DIR: "/explicit", XDG_CONFIG_HOME: "/xdg" }, found, home)).toBe("/explicit");
	});

	it("finds the XDG location when the file is there", () => {
		const found = exists(["/xdg/pi/web-search.json", `${home}/.pi/agent/web-search.json`]);
		expect(resolveConfigDir({ XDG_CONFIG_HOME: "/xdg" }, found, home)).toBe("/xdg/pi");
	});

	it("finds ~/.pi/agent, which is where this host's file actually is", () => {
		const found = exists([`${home}/.pi/agent/web-search.json`]);
		expect(resolveConfigDir({ XDG_CONFIG_HOME: "/xdg" }, found, home)).toBe(`${home}/.pi/agent`);
	});

	it("finds upstream's ~/.pi when that is the one that exists", () => {
		const found = exists([`${home}/.pi/web-search.json`]);
		expect(resolveConfigDir({ XDG_CONFIG_HOME: "/xdg" }, found, home)).toBe(`${home}/.pi`);
	});

	it("names a place to create when nothing exists, XDG-first as upstream does", () => {
		const nothing = exists([]);
		expect(resolveConfigDir({ XDG_CONFIG_HOME: "/xdg" }, nothing, home)).toBe("/xdg/pi");
		expect(resolveConfigDir({}, nothing, home)).toBe(`${home}/.pi/agent`);
	});
});
