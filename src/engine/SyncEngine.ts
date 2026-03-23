import { readFile } from "node:fs/promises";
import { dirname } from "node:path";

import chokidar, { type FSWatcher } from "chokidar";
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";

import type { OpenCodeConfig } from "../types/opencode.js";
import type { Result } from "../types/result.js";
import { fromHome } from "../utils/pathResolver.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

const OPENCODE_CONFIG = fromHome(".config/opencode/opencode.jsonc");

const DEBOUNCE_MS = 500;

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Read and parse the OpenCode JSONC config file.
 * Returns a Result — never throws.
 */
export async function readConfig(
	path: string = OPENCODE_CONFIG,
): Promise<Result<OpenCodeConfig>> {
	try {
		const content = await readFile(path, "utf8");
		const errors: ParseError[] = [];
		const parsed = parse(content, errors) as OpenCodeConfig | null;

		if (errors.length > 0) {
			return {
				data: null,
				error: `JSONC parse error in ${path}: ${printParseErrorCode(errors[0].error)}`,
			};
		}
		if (!parsed) return { data: null, error: `Empty config: ${path}` };

		return { data: parsed, error: null };
	} catch {
		return { data: null, error: `Could not read config: ${path}` };
	}
}

// ── Syncable interface ────────────────────────────────────────────────────────

interface Syncable {
	sync(source: OpenCodeConfig): Promise<void>;
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class SyncEngine {
	readonly #adapters: Syncable[];
	readonly #configPath: string;
	#watcher: FSWatcher | null = null;
	#debounceTimer: ReturnType<typeof setTimeout> | null = null;
	#syncing = false;
	#syncQueued = false;

	constructor(adapters: Syncable[], configPath: string = OPENCODE_CONFIG) {
		this.#adapters = adapters;
		this.#configPath = configPath;
	}

	/**
	 * Start watching source files and perform an initial sync.
	 * Subsequent file changes are debounced by 500 ms.
	 */
	async start(): Promise<void> {
		await this.#runSync();

		this.#watcher = chokidar.watch(dirname(this.#configPath), {
			ignoreInitial: true,
			persistent: true,
			// usePolling is not needed on macOS/Linux with native FSEvents/inotify,
			// but watching the directory (not individual files) is more reliable
			// for editors that write via atomic rename.
			awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
		});

		this.#watcher.on("all", (event, path) => {
			console.info(`[relay:event] ${event}: ${path}`);
			this.#scheduleSync();
		});
	}

	/**
	 * Stop watching and cancel any pending debounced sync.
	 */
	async stop(): Promise<void> {
		if (this.#debounceTimer) {
			clearTimeout(this.#debounceTimer);
			this.#debounceTimer = null;
		}
		await this.#watcher?.close();
		this.#watcher = null;
	}

	#scheduleSync(): void {
		if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
		this.#debounceTimer = setTimeout(() => {
			this.#runSync().catch((err: unknown) =>
				console.error("[relay] Sync error:", err),
			);
		}, DEBOUNCE_MS);
	}

	async #runSync(): Promise<void> {
		if (this.#syncing) {
			this.#syncQueued = true;
			return;
		}

		this.#syncing = true;
		try {
			const { data: source, error } = await readConfig(this.#configPath);

			if (error) {
				console.error(`[relay] ${error}`);
				return;
			}

			if (source == null) {
				console.error(`[relay] Couldn't load: ${this.#configPath}`);
				return;
			}

			const results = await Promise.allSettled(
				this.#adapters.map((adapter) => adapter.sync(source)),
			);
			for (const result of results) {
				if (result.status === "rejected") {
					console.error("[relay] Adapter error:", result.reason);
				}
			}
			console.info("[relay] Sync complete.");
		} finally {
			this.#syncing = false;
			if (this.#syncQueued) {
				this.#syncQueued = false;
				await this.#runSync();
			}
		}
	}
}
