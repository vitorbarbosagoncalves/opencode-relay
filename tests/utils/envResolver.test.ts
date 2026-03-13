import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	isEnvRef,
	resolveEnvRef,
	resolveEnvRefs,
} from "../../src/utils/envResolver.js";

describe(isEnvRef, () => {
	it("returns true for a valid {env:VAR} reference", () => {
		expect(isEnvRef("{env:MY_VAR}")).toBe(true);
	});

	it("returns false for a plain string", () => {
		expect(isEnvRef("MY_VAR")).toBe(false);
	});

	it("returns false for an inline reference (not the whole string)", () => {
		expect(isEnvRef("Bearer {env:TOKEN}")).toBe(false);
	});
});

describe(resolveEnvRef, () => {
	beforeEach(() => {
		process.env.TEST_VAR = "hello";
	});

	afterEach(() => {
		delete process.env.TEST_VAR;
	});

	it("resolves a set variable", () => {
		expect(resolveEnvRef("{env:TEST_VAR}")).toEqual({
			data: "hello",
			error: null,
		});
	});

	it("returns error for an unset variable", () => {
		const result = resolveEnvRef("{env:UNSET_VAR_XYZ}");
		expect(result.data).toBeNull();
		expect(result.error).toMatch("UNSET_VAR_XYZ");
	});

	it("returns error for a non-reference string", () => {
		const result = resolveEnvRef("not-a-ref");
		expect(result.data).toBeNull();
		expect(result.error).toMatch("not-a-ref");
	});
});

describe(resolveEnvRefs, () => {
	beforeEach(() => {
		process.env.TOKEN = "abc123";
		process.env.REGION = "eu-west-1";
	});

	afterEach(() => {
		delete process.env.TOKEN;
		delete process.env.REGION;
	});

	it("replaces a single inline reference", () => {
		expect(resolveEnvRefs("Bearer {env:TOKEN}")).toEqual({
			resolved: "Bearer abc123",
			missing: [],
		});
	});

	it("replaces multiple inline references", () => {
		expect(resolveEnvRefs("{env:TOKEN}:{env:REGION}")).toEqual({
			resolved: "abc123:eu-west-1",
			missing: [],
		});
	});

	it("records missing variable names and replaces with empty string", () => {
		const { resolved, missing } = resolveEnvRefs("key={env:MISSING_XYZ}");
		expect(resolved).toBe("key=");
		expect(missing).toEqual(["MISSING_XYZ"]);
	});

	it("returns the original string when no references are present", () => {
		expect(resolveEnvRefs("no refs here")).toEqual({
			resolved: "no refs here",
			missing: [],
		});
	});
});
