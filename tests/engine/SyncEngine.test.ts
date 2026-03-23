import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readConfig, SyncEngine } from "../../src/engine/SyncEngine.js";

// ── readConfig ────────────────────────────────────────────────────────────────

describe(readConfig, () => {
	let tmpFile: string;

	beforeEach(() => {
		tmpFile = join(tmpdir(), `opencode-relay-test-${Date.now()}.jsonc`);
	});

	it("parses a valid JSONC file", async () => {
		await writeFile(tmpFile, '// comment\n{"mcp": {}, "agent": {}}', "utf8");
		const { data, error } = await readConfig(tmpFile);
		expect(error).toBeNull();
		expect(data).toMatchObject({ mcp: {}, agent: {} });
	});

	it("returns error for a non-existent file", async () => {
		const { data, error } = await readConfig("/tmp/__no_such_file_xyz__.jsonc");
		expect(data).toBeNull();
		expect(error).toMatch(/Could not read config/);
	});

	it("returns a JSONC parse error for an empty file", async () => {
		await writeFile(tmpFile, "", "utf8");
		const { data, error } = await readConfig(tmpFile);
		expect(data).toBeNull();
		expect(error).toMatch(/JSONC parse error/);
	});

	it("returns a JSONC parse error for malformed JSON", async () => {
		await writeFile(tmpFile, '{ "key": }', "utf8");
		const { data, error } = await readConfig(tmpFile);
		expect(data).toBeNull();
		expect(error).toMatch(/JSONC parse error/);
		expect(error).toMatch(tmpFile);
	});

	it("strips comments and parses successfully", async () => {
		await writeFile(tmpFile, '{\n  // MCP servers\n  "mcp": {}\n}', "utf8");
		const { data, error } = await readConfig(tmpFile);
		expect(error).toBeNull();
		expect(data?.mcp).toEqual({});
	});
});

// ── SyncEngine ────────────────────────────────────────────────────────────────

describe(SyncEngine, () => {
	let tmpConfig: string;

	beforeEach(async () => {
		tmpConfig = join(
			tmpdir(),
			`opencode-relay-engine-test-${Date.now()}.jsonc`,
		);
		await writeFile(tmpConfig, '{"mcp": {}}', "utf8");
	});

	it("calls sync on all adapters during initial start", async () => {
		const syncA = vi.fn().mockResolvedValue(undefined);
		const syncB = vi.fn().mockResolvedValue(undefined);
		const engine = new SyncEngine(
			[{ sync: syncA }, { sync: syncB }],
			tmpConfig,
		);

		await engine.start();
		await engine.stop();

		expect(syncA).toHaveBeenCalledOnce();
		expect(syncB).toHaveBeenCalledOnce();
		expect(syncA).toHaveBeenCalledWith({ mcp: {} });
	});

	it("does not call sync when config cannot be read", async () => {
		const sync = vi.fn().mockResolvedValue(undefined);
		const engine = new SyncEngine([{ sync }], "/tmp/__missing_config__.jsonc");

		await engine.start();
		await engine.stop();

		expect(sync).not.toHaveBeenCalled();
	});

	it("stop resolves without error when called before start", async () => {
		const engine = new SyncEngine([], tmpConfig);
		await expect(engine.stop()).resolves.toBeUndefined();
	});
});
