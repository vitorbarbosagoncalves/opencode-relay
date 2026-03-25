import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
	const NO_ENV_FILE = "/tmp/__missing_env_file_xyz__.env";

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
			NO_ENV_FILE,
		);

		await engine.start();
		await engine.stop();

		expect(syncA).toHaveBeenCalledOnce();
		expect(syncB).toHaveBeenCalledOnce();
		expect(syncA).toHaveBeenCalledWith({ mcp: {} });
	});

	it("does not call sync when config cannot be read", async () => {
		const sync = vi.fn().mockResolvedValue(undefined);
		const engine = new SyncEngine(
			[{ sync }],
			"/tmp/__missing_config__.jsonc",
			NO_ENV_FILE,
		);

		await engine.start();
		await engine.stop();

		expect(sync).not.toHaveBeenCalled();
	});

	it("stop resolves without error when called before start", async () => {
		const engine = new SyncEngine([], tmpConfig, NO_ENV_FILE);
		await expect(engine.stop()).resolves.toBeUndefined();
	});

	it("continues running and calls remaining adapters when one adapter rejects", async () => {
		const syncA = vi.fn().mockRejectedValue(new Error("adapter failure"));
		const syncB = vi.fn().mockResolvedValue(undefined);
		const engine = new SyncEngine(
			[{ sync: syncA }, { sync: syncB }],
			tmpConfig,
			NO_ENV_FILE,
		);

		await expect(engine.start()).resolves.toBeUndefined();
		await engine.stop();

		expect(syncA).toHaveBeenCalledOnce();
		expect(syncB).toHaveBeenCalledOnce();
	});

	it("loads env vars from env file before syncing adapters", async () => {
		const TEST_KEY = "RELAY_ENGINE_TEST_ENV_KEY_XYZ";
		const tmpEnv = join(
			tmpdir(),
			`opencode-relay-engine-env-${Date.now()}.env`,
		);
		await writeFile(tmpEnv, `${TEST_KEY}=from_env_file`, "utf8");

		let capturedEnv: string | undefined;
		const sync = vi.fn().mockImplementation(() => {
			capturedEnv = process.env[TEST_KEY];
			return Promise.resolve();
		});

		const engine = new SyncEngine([{ sync }], tmpConfig, tmpEnv);
		await engine.start();
		await engine.stop();

		expect(capturedEnv).toBe("from_env_file");
		delete process.env[TEST_KEY];
	});
});
