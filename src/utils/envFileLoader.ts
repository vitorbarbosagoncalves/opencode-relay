import { readFile } from "node:fs/promises";

export type EnvFileResult = {
	loaded: string[];
	skipped: string[];
};

/**
 * Parse a `.env` file into key/value pairs.
 * Supports:
 *   - `KEY=VALUE` and `KEY="VALUE"` and `KEY='VALUE'`
 *   - Inline `#` comments
 *   - Blank lines and `# full-line comments` are ignored
 *   - `export KEY=VALUE` prefix is stripped
 * Returns null when the file cannot be read (missing file is not an error).
 */
export function parseEnvFile(content: string): Record<string, string> | null {
	const result: Record<string, string> = {};

	for (const raw of content.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;

		// Strip optional `export ` prefix
		const stripped = line.startsWith("export ") ? line.slice(7).trim() : line;

		const eq = stripped.indexOf("=");
		if (eq === -1) continue;

		const key = stripped.slice(0, eq).trim();
		if (!key) continue;

		let value = stripped.slice(eq + 1);

		// Strip inline comment (outside of quotes)
		const commentIdx = findInlineComment(value);
		if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();

		// Unquote
		value = unquote(value);

		result[key] = value;
	}

	return result;
}

function findInlineComment(value: string): number {
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		else if (ch === "#" && !inSingle && !inDouble) return i;
	}

	return -1;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/**
 * Load a `.env` file and merge its contents into `process.env`.
 * Existing process env vars are NOT overwritten (process env wins).
 * Returns the list of keys loaded and keys skipped (already set).
 * Returns null when the file is absent — not an error, just no-op.
 */
export async function loadEnvFile(path: string): Promise<EnvFileResult | null> {
	let content: string;

	try {
		content = await readFile(path, "utf8");
	} catch {
		// File absent or unreadable — treat as no-op
		return null;
	}

	const pairs = parseEnvFile(content);
	if (!pairs) return null;

	const loaded: string[] = [];
	const skipped: string[] = [];

	for (const [key, value] of Object.entries(pairs)) {
		if (process.env[key] !== undefined) {
			skipped.push(key);
		} else {
			process.env[key] = value;
			loaded.push(key);
		}
	}

	return { loaded, skipped };
}
