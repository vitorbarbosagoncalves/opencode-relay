process.title = "opencode-relay";

import { ClaudeAgentAdapter } from "./adapters/ClaudeAgentAdapter.js";
import { ClaudeMcpAdapter } from "./adapters/ClaudeMcpAdapter.js";
import { ClaudeSkillAdapter } from "./adapters/ClaudeSkillAdapter.js";
import { SyncEngine } from "./engine/SyncEngine.js";

const engine = new SyncEngine([
	new ClaudeMcpAdapter(),
	new ClaudeAgentAdapter(),
	new ClaudeSkillAdapter(),
]);

async function main(): Promise<void> {
	console.info("[relay] Starting opencode-relay…");

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => {
			console.info(`\n[relay] ${signal} received — shutting down`);
			engine
				.stop()
				.then(() => process.exit(0))
				.catch((err: unknown) => {
					console.error("[relay] Error during shutdown:", err);
					process.exit(1);
				});
		});
	}

	await engine.start();
	console.info("[relay] Watching for changes. Press Ctrl+C to stop.");
}

main().catch((err: unknown) => {
	console.error("[relay] Fatal error:", err);
	process.exit(1);
});
