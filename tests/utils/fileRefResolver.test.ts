import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	isFileRef,
	resolveFileRef,
	resolveFileRefs,
} from "../../src/utils/fileRefResolver.js";

const TMP = join(import.meta.dirname, "__fixtures__");
const CONFIG_PATH = join(TMP, "config.jsonc");

beforeAll(async () => {
	await mkdir(TMP, { recursive: true });
	await writeFile(join(TMP, "prompt.md"), "You are a helpful assistant.");
	await writeFile(join(TMP, "intro.md"), "Hello");
	await writeFile(join(TMP, "outro.md"), "Goodbye");
});

afterAll(() => rm(TMP, { recursive: true, force: true }));

describe(isFileRef, () => {
	it("returns true for a valid {file:./path} reference", () => {
		expect(isFileRef("{file:./prompt.md}")).toBe(true);
	});

	it("returns false for a plain string", () => {
		expect(isFileRef("./prompt.md")).toBe(false);
	});

	it("returns false for an inline reference (not the whole string)", () => {
		expect(isFileRef("prefix {file:./prompt.md}")).toBe(false);
	});
});

describe(resolveFileRef, () => {
	it("reads the referenced file", async () => {
		const result = await resolveFileRef("{file:./prompt.md}", CONFIG_PATH);
		expect(result).toEqual({
			data: "You are a helpful assistant.",
			error: null,
		});
	});

	it("returns error for a non-existent file", async () => {
		const result = await resolveFileRef("{file:./missing.md}", CONFIG_PATH);
		expect(result.data).toBeNull();
		expect(result.error).toMatch("missing.md");
	});

	it("returns error for a non-reference string", async () => {
		const result = await resolveFileRef("not-a-ref", CONFIG_PATH);
		expect(result.data).toBeNull();
		expect(result.error).toMatch("not-a-ref");
	});
});

describe(resolveFileRefs, () => {
	it("replaces a single inline reference", async () => {
		const result = await resolveFileRefs(
			"Start: {file:./prompt.md}",
			CONFIG_PATH,
		);
		expect(result).toEqual({
			resolved: "Start: You are a helpful assistant.",
			missing: [],
		});
	});

	it("replaces multiple inline references", async () => {
		const result = await resolveFileRefs(
			"{file:./intro.md} — {file:./outro.md}",
			CONFIG_PATH,
		);
		expect(result).toEqual({ resolved: "Hello — Goodbye", missing: [] });
	});

	it("records missing paths and leaves the original reference in place", async () => {
		const { resolved, missing } = await resolveFileRefs(
			"{file:./ghost.md}",
			CONFIG_PATH,
		);
		expect(resolved).toBe("{file:./ghost.md}");
		expect(missing[0]).toMatch("ghost.md");
	});

	it("returns the original string when no references are present", async () => {
		const result = await resolveFileRefs("no refs here", CONFIG_PATH);
		expect(result).toEqual({ resolved: "no refs here", missing: [] });
	});
});
