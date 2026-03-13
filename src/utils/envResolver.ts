import { env } from "node:process";

import type { Result } from "../types/result.js";

const ENV_REF_RE = /^\{env:([^}]+)\}$/;
const INLINE_ENV_RE = /\{env:([^}]+)\}/g;

/** Returns true if the whole string is a `{env:VAR}` reference. */
export function isEnvRef(value: string): boolean {
	return ENV_REF_RE.test(value);
}

/**
 * Resolve a single `{env:VAR}` reference.
 * Returns an error if the string is not a valid reference or the variable is not set.
 */
export function resolveEnvRef(value: string): Result<string> {
	const match = ENV_REF_RE.exec(value);
	if (!match) return { data: null, error: `Not an env reference: ${value}` };

	const val = env[match[1]];
	if (val === undefined)
		return { data: null, error: `Undefined env variable: ${match[1]}` };

	return { data: val, error: null };
}

/**
 * Resolve all `{env:VAR}` references found inline within a string.
 * Returns the resolved string and a list of variable names that were missing.
 */
export function resolveEnvRefs(value: string): {
	resolved: string;
	missing: string[];
} {
	const missing: string[] = [];

	const resolved = value.replace(INLINE_ENV_RE, (_, varName: string) => {
		const val = env[varName];
		if (val === undefined) missing.push(varName);
		return val ?? "";
	});

	return { resolved, missing };
}
