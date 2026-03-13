import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fromHome, resolveHome } from "../../src/utils/pathResolver.js";

const HOME = homedir();

describe(resolveHome, () => {
	it("expands ~ to the home directory", () => {
		expect(resolveHome("~")).toBe(HOME);
	});

	it("expands ~/foo to a path under home", () => {
		expect(resolveHome("~/foo/bar")).toBe(join(HOME, "foo/bar"));
	});

	it("leaves an absolute path unchanged", () => {
		expect(resolveHome("/usr/local/bin")).toBe("/usr/local/bin");
	});

	it("leaves a relative path unchanged", () => {
		expect(resolveHome("relative/path")).toBe("relative/path");
	});
});

describe(fromHome, () => {
	it("joins segments under the home directory", () => {
		expect(fromHome(".config", "opencode")).toBe(
			join(HOME, ".config", "opencode"),
		);
	});

	it("works with a single segment", () => {
		expect(fromHome(".claude")).toBe(join(HOME, ".claude"));
	});
});
