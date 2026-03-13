import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Result } from "../types/result.js";

const FILE_REF_RE = /^\{file:([^}]+)\}$/;
const INLINE_FILE_RE = /\{file:([^}]+)\}/g;

/** Returns true if the string is a `{file:./path}` reference. */
export function isFileRef(value: string): boolean {
	return FILE_REF_RE.test(value);
}

/**
 * Resolve a `{file:./path}` reference relative to `basePath` (the directory
 * that contains the config file holding the reference).
 */
export async function resolveFileRef(
	value: string,
	basePath: string,
): Promise<Result<string>> {
	const match = FILE_REF_RE.exec(value);
	if (!match) return { data: null, error: `Not a file reference: ${value}` };

	const absolutePath = resolve(dirname(basePath), match[1]);
	try {
		const data = await readFile(absolutePath, "utf8");
		return { data, error: null };
	} catch {
		return {
			data: null,
			error: `Could not read file reference: ${absolutePath}`,
		};
	}
}

/**
 * Resolve all `{file:./path}` references found inline within a string.
 * Returns the resolved string and a list of paths that could not be read.
 */
export async function resolveFileRefs(
	value: string,
	basePath: string,
): Promise<{ resolved: string; missing: string[] }> {
	const matches = [...value.matchAll(INLINE_FILE_RE)];
	if (matches.length === 0) return { resolved: value, missing: [] };

	const missing: string[] = [];
	let resolved = value;

	for (const match of matches) {
		const absolutePath = resolve(dirname(basePath), match[1]);
		try {
			const content = await readFile(absolutePath, "utf8");
			resolved = resolved.replace(match[0], content);
		} catch {
			missing.push(absolutePath);
		}
	}

	return { resolved, missing };
}
