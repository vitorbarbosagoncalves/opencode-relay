import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CONFIG_DIR } from "../constants/claude.js";
import type { ProviderAdapter } from "../interfaces/ProviderAdapter.js";
import type {
	ClaudeConfig,
	ClaudeHttpMcpServer,
	ClaudeMcpServer,
	ClaudeStdioMcpServer,
} from "../types/claude.js";
import type {
	OpenCodeConfig,
	OpenCodeLocalMcpServer,
	OpenCodeMcpServer,
	OpenCodeRemoteMcpServer,
} from "../types/opencode.js";
import { resolveEnvRefs } from "../utils/envResolver.js";
import { fromHome } from "../utils/pathResolver.js";

const TARGET_PATH = fromHome(CONFIG_DIR);

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve all `{env:VAR}` references in every value of a string record.
 * Returns the resolved record and the names of any missing variables.
 */
export function resolveEnvRecord(record: Record<string, string>): {
	resolved: Record<string, string>;
	missing: string[];
} {
	const entries = Object.entries(record).map(([key, value]) => {
		const { resolved, missing } = resolveEnvRefs(value);
		return { key, resolved, missing };
	});

	return {
		resolved: Object.fromEntries(
			entries.map(({ key, resolved }) => [key, resolved]),
		),
		missing: entries.flatMap(({ missing }) => missing),
	};
}

/**
 * Transform a local (stdio) OpenCode MCP server to Claude Code schema.
 * Returns null when the server is disabled or the command array is empty.
 */
export function transformLocalServer(
	server: OpenCodeLocalMcpServer,
): { server: ClaudeStdioMcpServer; warnings: string[] } | null {
	if (server.enabled === false) return null;

	const [command, ...args] = server.command;
	if (!command) return null;

	const { resolved: env, missing } = server.environment
		? resolveEnvRecord(server.environment)
		: { resolved: {} as Record<string, string>, missing: [] as string[] };

	return {
		server: {
			type: "stdio",
			command,
			...(args.length > 0 && { args }),
			...(Object.keys(env).length > 0 && { env }),
		},
		warnings: missing.map((v) => `Undefined env variable: ${v}`),
	};
}

/**
 * Transform a remote (HTTP) OpenCode MCP server to Claude Code schema.
 * Returns null when the server is disabled.
 * OAuth servers must be filtered out by the caller before calling this.
 */
export function transformRemoteServer(
	server: OpenCodeRemoteMcpServer,
): { server: ClaudeHttpMcpServer; warnings: string[] } | null {
	if (server.enabled === false) return null;

	const { resolved: headers, missing } = server.headers
		? resolveEnvRecord(server.headers)
		: { resolved: {} as Record<string, string>, missing: [] as string[] };

	return {
		server: {
			type: "http",
			url: server.url,
			...(Object.keys(headers).length > 0 && { headers }),
		},
		warnings: missing.map((v) => `Undefined env variable: ${v}`),
	};
}

/**
 * Transform all MCP servers from OpenCode schema to Claude Code schema.
 * Returns the translated server map and any warnings collected along the way.
 */
export function transformMcpServers(mcp: Record<string, OpenCodeMcpServer>): {
	servers: Record<string, ClaudeMcpServer>;
	warnings: string[];
} {
	return Object.entries(mcp).reduce<{
		servers: Record<string, ClaudeMcpServer>;
		warnings: string[];
	}>(
		(acc, [name, server]) => {
			if (server.type === "local") {
				const result = transformLocalServer(server);
				if (!result) return acc;
				return {
					servers: { ...acc.servers, [name]: result.server },
					warnings: [...acc.warnings, ...result.warnings],
				};
			}

			// remote
			if (server.oauth) {
				return {
					...acc,
					warnings: [
						...acc.warnings,
						`MCP server "${name}" uses OAuth — not supported by Claude Code; skipping`,
					],
				};
			}

			const result = transformRemoteServer(server);
			if (!result) return acc;
			return {
				servers: { ...acc.servers, [name]: result.server },
				warnings: [...acc.warnings, ...result.warnings],
			};
		},
		{ servers: {}, warnings: [] },
	);
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export class ClaudeMcpAdapter implements ProviderAdapter<ClaudeConfig> {
	/**
	 * Read the current `~/.claude.json`, returning an empty config on missing
	 * or unparseable file.
	 */
	async readTarget(): Promise<ClaudeConfig> {
		try {
			const content = await readFile(TARGET_PATH, "utf8");
			return (JSON.parse(content) as ClaudeConfig) ?? {};
		} catch {
			return {};
		}
	}

	/**
	 * Pure: translate the MCP slice of the OpenCode config and merge it into
	 * the existing Claude config without touching any other keys.
	 */
	transform(source: OpenCodeConfig, target: ClaudeConfig): ClaudeConfig {
		if (!source.mcp) return target;
		const { servers } = transformMcpServers(source.mcp);
		return { ...target, mcpServers: servers };
	}

	/**
	 * Write `config` back to `~/.claude.json` with restricted permissions.
	 */
	async writeTarget(config: ClaudeConfig): Promise<void> {
		await mkdir(dirname(TARGET_PATH), { recursive: true });
		await writeFile(TARGET_PATH, `${JSON.stringify(config, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
	}

	/**
	 * Full pipeline: read → transform (with warning emission) → write.
	 */
	async sync(source: OpenCodeConfig): Promise<void> {
		const target = await this.readTarget();
		if (!source.mcp) return;

		const { servers, warnings } = transformMcpServers(source.mcp);

		for (const warning of warnings) {
			console.warn(`[relay:mcp] ${warning}`);
		}

		await this.writeTarget({ ...target, mcpServers: servers });
	}
}
