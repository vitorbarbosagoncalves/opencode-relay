import type { OpenCodeConfig } from "../types/opencode.js";

/**
 * Generic adapter interface for syncing OpenCode config to a provider-specific target.
 *
 * T = the provider's target config shape (e.g. ClaudeConfig)
 */
export interface ProviderAdapter<T> {
	/**
	 * Read the current state of the target config file.
	 * Returns the parsed config, or a sensible empty default if the file does not exist.
	 */
	readTarget(): Promise<T>;

	/**
	 * Translate the relevant slice of the OpenCode config into the provider's schema
	 * and merge it non-destructively with the existing target config.
	 *
	 * Pure function — does not perform any I/O.
	 */
	transform(source: OpenCodeConfig, target: T): T;

	/**
	 * Persist the merged config back to the provider's target file.
	 */
	writeTarget(config: T): Promise<void>;

	/**
	 * Convenience method that composes readTarget → transform → writeTarget.
	 * Implementations should call this in the order above.
	 */
	sync(source: OpenCodeConfig): Promise<void>;
}
