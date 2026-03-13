import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	ClaudeMcpAdapter,
	resolveEnvRecord,
	transformLocalServer,
	transformMcpServers,
	transformRemoteServer,
} from "../../src/adapters/ClaudeMcpAdapter.js";

// ── resolveEnvRecord ──────────────────────────────────────────────────────────

describe(resolveEnvRecord, () => {
	beforeEach(() => {
		process.env.MY_KEY = "secret";
		process.env.REGION = "eu-west-1";
	});

	afterEach(() => {
		delete process.env.MY_KEY;
		delete process.env.REGION;
	});

	it("resolves all env references in record values", () => {
		const { resolved, missing } = resolveEnvRecord({
			API_KEY: "{env:MY_KEY}",
			REGION: "eu-west-1",
		});
		expect(resolved).toEqual({ API_KEY: "secret", REGION: "eu-west-1" });
		expect(missing).toEqual([]);
	});

	it("reports missing variables and substitutes empty string", () => {
		const { resolved, missing } = resolveEnvRecord({
			TOKEN: "{env:UNSET_XYZ}",
		});
		expect(resolved).toEqual({ TOKEN: "" });
		expect(missing).toEqual(["UNSET_XYZ"]);
	});

	it("resolves inline references within values", () => {
		const { resolved } = resolveEnvRecord({
			AUTH: "Bearer {env:MY_KEY}",
		});
		expect(resolved).toEqual({ AUTH: "Bearer secret" });
	});

	it("returns unchanged values when no references are present", () => {
		const { resolved, missing } = resolveEnvRecord({ KEY: "static" });
		expect(resolved).toEqual({ KEY: "static" });
		expect(missing).toEqual([]);
	});
});

// ── transformLocalServer ──────────────────────────────────────────────────────

describe(transformLocalServer, () => {
	it("transforms a minimal local server", () => {
		const result = transformLocalServer({
			type: "local",
			command: ["npx", "-y", "my-tool"],
		});
		expect(result?.server).toEqual({
			type: "stdio",
			command: "npx",
			args: ["-y", "my-tool"],
		});
		expect(result?.warnings).toEqual([]);
	});

	it("splits single-element command array without args field", () => {
		const result = transformLocalServer({
			type: "local",
			command: ["node"],
		});
		expect(result?.server).toEqual({ type: "stdio", command: "node" });
	});

	it("renames environment to env", () => {
		const result = transformLocalServer({
			type: "local",
			command: ["npx"],
			environment: { REGION: "us-east-1" },
		});
		expect(result?.server).toMatchObject({ env: { REGION: "us-east-1" } });
	});

	it("omits env field when environment is empty", () => {
		const result = transformLocalServer({
			type: "local",
			command: ["npx"],
			environment: {},
		});
		expect(result?.server).not.toHaveProperty("env");
	});

	it("returns null when enabled is false", () => {
		expect(
			transformLocalServer({ type: "local", command: ["npx"], enabled: false }),
		).toBeNull();
	});

	it("returns null when command array is empty", () => {
		expect(transformLocalServer({ type: "local", command: [] })).toBeNull();
	});

	it("collects warnings for undefined env variables", () => {
		const result = transformLocalServer({
			type: "local",
			command: ["npx"],
			environment: { KEY: "{env:UNSET_ABC}" },
		});
		expect(result?.warnings).toEqual(["Undefined env variable: UNSET_ABC"]);
	});
});

// ── transformRemoteServer ─────────────────────────────────────────────────────

describe(transformRemoteServer, () => {
	it("transforms a minimal remote server", () => {
		const result = transformRemoteServer({
			type: "remote",
			url: "https://mcp.example.com/mcp",
		});
		expect(result?.server).toEqual({
			type: "http",
			url: "https://mcp.example.com/mcp",
		});
		expect(result?.warnings).toEqual([]);
	});

	it("resolves env references in headers", () => {
		process.env.TOKEN = "tok123";
		const result = transformRemoteServer({
			type: "remote",
			url: "https://mcp.example.com/mcp",
			headers: { Authorization: "Bearer {env:TOKEN}" },
		});
		expect(result?.server).toMatchObject({
			headers: { Authorization: "Bearer tok123" },
		});
		delete process.env.TOKEN;
	});

	it("omits headers field when headers is empty", () => {
		const result = transformRemoteServer({
			type: "remote",
			url: "https://mcp.example.com/mcp",
			headers: {},
		});
		expect(result?.server).not.toHaveProperty("headers");
	});

	it("returns null when enabled is false", () => {
		expect(
			transformRemoteServer({
				type: "remote",
				url: "https://mcp.example.com/mcp",
				enabled: false,
			}),
		).toBeNull();
	});

	it("collects warnings for missing header env variables", () => {
		const result = transformRemoteServer({
			type: "remote",
			url: "https://mcp.example.com/mcp",
			headers: { Auth: "{env:MISSING_TOKEN}" },
		});
		expect(result?.warnings).toEqual(["Undefined env variable: MISSING_TOKEN"]);
	});
});

// ── transformMcpServers ───────────────────────────────────────────────────────

describe(transformMcpServers, () => {
	it("transforms a mix of local and remote servers", () => {
		const { servers, warnings } = transformMcpServers({
			"my-local": { type: "local", command: ["npx", "-y", "tool"] },
			"my-remote": { type: "remote", url: "https://mcp.example.com/mcp" },
		});
		expect(servers["my-local"]).toMatchObject({
			type: "stdio",
			command: "npx",
		});
		expect(servers["my-remote"]).toMatchObject({
			type: "http",
			url: "https://mcp.example.com/mcp",
		});
		expect(warnings).toEqual([]);
	});

	it("skips disabled servers", () => {
		const { servers } = transformMcpServers({
			"off-local": { type: "local", command: ["npx"], enabled: false },
			"off-remote": {
				type: "remote",
				url: "https://mcp.example.com/mcp",
				enabled: false,
			},
		});
		expect(Object.keys(servers)).toHaveLength(0);
	});

	it("skips OAuth servers and emits a warning", () => {
		const { servers, warnings } = transformMcpServers({
			"oauth-tool": {
				type: "remote",
				url: "https://mcp.figma.com/mcp",
				oauth: { clientId: "abc", clientSecret: "xyz" },
			},
		});
		expect(Object.keys(servers)).toHaveLength(0);
		expect(warnings[0]).toMatch(/oauth-tool/);
		expect(warnings[0]).toMatch(/OAuth/);
	});

	it("returns an empty result for an empty input", () => {
		const { servers, warnings } = transformMcpServers({});
		expect(servers).toEqual({});
		expect(warnings).toEqual([]);
	});

	it("collects env warnings from included servers", () => {
		const { warnings } = transformMcpServers({
			"my-tool": {
				type: "local",
				command: ["npx"],
				environment: { K: "{env:MISSING_RELAY_VAR}" },
			},
		});
		expect(warnings).toEqual(["Undefined env variable: MISSING_RELAY_VAR"]);
	});
});

// ── ClaudeMcpAdapter.transform ────────────────────────────────────────────────

describe(ClaudeMcpAdapter, () => {
	const adapter = new ClaudeMcpAdapter();

	it("returns target unchanged when source has no mcp key", () => {
		const target = { someKey: "preserved" };
		expect(adapter.transform({}, target)).toEqual(target);
	});

	it("merges mcpServers into existing target without removing other keys", () => {
		const source = {
			mcp: { tool: { type: "local" as const, command: ["npx"] } },
		};
		const target = { numSuggestions: 5, otherField: "keep-me" };
		const result = adapter.transform(source, target);
		expect(result.otherField).toBe("keep-me");
		expect(result.numSuggestions).toBe(5);
		expect(result.mcpServers).toMatchObject({
			tool: { type: "stdio", command: "npx" },
		});
	});

	it("replaces mcpServers entirely on re-sync (non-enabled servers are dropped)", () => {
		const source = {
			mcp: {
				active: { type: "local" as const, command: ["node"] },
				dead: { type: "local" as const, command: ["python"], enabled: false },
			},
		};
		const result = adapter.transform(source, {});
		expect(Object.keys(result.mcpServers ?? {})).toEqual(["active"]);
	});
});
