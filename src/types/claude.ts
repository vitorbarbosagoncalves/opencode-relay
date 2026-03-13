/** Shape of ~/.claude.json */
export interface ClaudeConfig {
	mcpServers?: Record<string, ClaudeMcpServer>;
	[key: string]: unknown;
}

export interface ClaudeStdioMcpServer {
	type: "stdio";
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface ClaudeHttpMcpServer {
	type: "http" | "sse";
	url: string;
	headers?: Record<string, string>;
}

export type ClaudeMcpServer = ClaudeStdioMcpServer | ClaudeHttpMcpServer;
