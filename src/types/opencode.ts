/** Raw parsed shape of ~/.config/opencode/opencode.jsonc */
export interface OpenCodeConfig {
	default_agent?: string;
	mcp?: Record<string, OpenCodeMcpServer>;
	agent?: Record<string, OpenCodeAgent>;
	[key: string]: unknown;
}

// ── MCP ──────────────────────────────────────────────────────────────────────

export interface OpenCodeMcpServerBase {
	enabled?: boolean;
}

export interface OpenCodeLocalMcpServer extends OpenCodeMcpServerBase {
	type: "local";
	command: string[];
	environment?: Record<string, string>;
}

export interface OpenCodeRemoteMcpServer extends OpenCodeMcpServerBase {
	type: "remote";
	url: string;
	headers?: Record<string, string>;
	oauth?: { clientId: string; clientSecret: string };
}

export type OpenCodeMcpServer =
	| OpenCodeLocalMcpServer
	| OpenCodeRemoteMcpServer;

// ── Agents ───────────────────────────────────────────────────────────────────

export type OpenCodeAgentMode = "primary" | "subagent";

export interface OpenCodeAgent {
	description?: string;
	mode?: OpenCodeAgentMode;
	model?: string;
	prompt?: string;
	tools?: Record<string, boolean>;
	temperature?: number;
	[key: string]: unknown;
}
