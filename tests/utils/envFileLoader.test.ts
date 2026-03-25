import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEnvFile, parseEnvFile } from "../../src/utils/envFileLoader.js";

// ── parseEnvFile ──────────────────────────────────────────────────────────────

describe(parseEnvFile, () => {
	it("parses simple KEY=VALUE pairs", () => {
		expect(parseEnvFile("FOO=bar\nBAZ=qux")).toEqual({
			FOO: "bar",
			BAZ: "qux",
		});
	});

	it("strips double quotes from values", () => {
		expect(parseEnvFile('KEY="hello world"')).toEqual({ KEY: "hello world" });
	});

	it("strips single quotes from values", () => {
		expect(parseEnvFile("KEY='hello world'")).toEqual({ KEY: "hello world" });
	});

	it("strips export prefix", () => {
		expect(parseEnvFile("export KEY=value")).toEqual({ KEY: "value" });
	});

	it("ignores blank lines", () => {
		expect(parseEnvFile("\n\nFOO=bar\n\n")).toEqual({ FOO: "bar" });
	});

	it("ignores full-line comments", () => {
		expect(parseEnvFile("# this is a comment\nFOO=bar")).toEqual({
			FOO: "bar",
		});
	});

	it("strips inline comments outside quotes", () => {
		expect(parseEnvFile("FOO=bar # comment")).toEqual({ FOO: "bar" });
	});

	it("preserves # inside double-quoted values", () => {
		expect(parseEnvFile('FOO="bar#baz"')).toEqual({ FOO: "bar#baz" });
	});

	it("preserves # inside single-quoted values", () => {
		expect(parseEnvFile("FOO='bar#baz'")).toEqual({ FOO: "bar#baz" });
	});

	it("ignores lines without an equals sign", () => {
		expect(parseEnvFile("NOEQUALS\nFOO=bar")).toEqual({ FOO: "bar" });
	});

	it("returns empty object for empty content", () => {
		expect(parseEnvFile("")).toEqual({});
	});

	it("handles VALUE containing = sign", () => {
		expect(parseEnvFile("KEY=a=b=c")).toEqual({ KEY: "a=b=c" });
	});
});

// ── loadEnvFile ───────────────────────────────────────────────────────────────

describe(loadEnvFile, () => {
	let tmpFile: string;
	const TEST_KEY = "RELAY_TEST_LOAD_KEY_XYZ";
	const TEST_KEY2 = "RELAY_TEST_LOAD_KEY2_XYZ";

	beforeEach(() => {
		tmpFile = join(tmpdir(), `opencode-relay-env-test-${Date.now()}.env`);
		delete process.env[TEST_KEY];
		delete process.env[TEST_KEY2];
	});

	afterEach(() => {
		delete process.env[TEST_KEY];
		delete process.env[TEST_KEY2];
	});

	it("returns null for a missing file", async () => {
		const result = await loadEnvFile("/tmp/__no_such_env_file_xyz__.env");
		expect(result).toBeNull();
	});

	it("loads vars into process.env and reports them as loaded", async () => {
		await writeFile(tmpFile, `${TEST_KEY}=loaded_value`, "utf8");
		const result = await loadEnvFile(tmpFile);
		expect(result?.loaded).toContain(TEST_KEY);
		expect(process.env[TEST_KEY]).toBe("loaded_value");
	});

	it("does not overwrite existing process env vars", async () => {
		process.env[TEST_KEY] = "original";
		await writeFile(tmpFile, `${TEST_KEY}=from_file`, "utf8");
		const result = await loadEnvFile(tmpFile);
		expect(result?.skipped).toContain(TEST_KEY);
		expect(process.env[TEST_KEY]).toBe("original");
	});

	it("reports loaded and skipped separately", async () => {
		process.env[TEST_KEY] = "original";
		await writeFile(
			tmpFile,
			`${TEST_KEY}=from_file\n${TEST_KEY2}=new_value`,
			"utf8",
		);
		const result = await loadEnvFile(tmpFile);
		expect(result?.loaded).toContain(TEST_KEY2);
		expect(result?.skipped).toContain(TEST_KEY);
	});

	it("returns empty loaded and skipped arrays for an empty file", async () => {
		await writeFile(tmpFile, "", "utf8");
		const result = await loadEnvFile(tmpFile);
		expect(result).toEqual({ loaded: [], skipped: [] });
	});
});
