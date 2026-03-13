import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();

/** Resolve `~` or `~/foo` to an absolute path. Leaves absolute paths unchanged. */
export function resolveHome(p: string): string {
	return p === "~" || p.startsWith("~/") ? join(HOME, p.slice(1)) : p;
}

/** Join path segments relative to the user's home directory. */
export function fromHome(...segments: string[]): string {
	return join(HOME, ...segments);
}
