import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SKILLS_DIR } from "../constants/claude.js";
import type { ProviderAdapter } from "../interfaces/ProviderAdapter.js";
import type { OpenCodeConfig } from "../types/opencode.js";
import { fromHome } from "../utils/pathResolver.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

const OPENCODE_SKILLS_DIR = fromHome(".config/opencode/skills");
const SKILLS_TARGET_DIR = fromHome(SKILLS_DIR);
const MANIFEST_PATH = join(SKILLS_TARGET_DIR, ".relay-manifest.json");

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the path to a skill's SKILL.md in the OpenCode source directory.
 */
export function openCodeSkillPath(name: string): string {
	return join(OPENCODE_SKILLS_DIR, name, "SKILL.md");
}

/**
 * Returns the path to a skill's SKILL.md in the Claude target directory.
 */
export function claudeSkillPath(name: string): string {
	return join(SKILLS_TARGET_DIR, name, "SKILL.md");
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

async function readManifest(): Promise<string[]> {
	try {
		const raw = await readFile(MANIFEST_PATH, "utf8");
		return JSON.parse(raw) as string[];
	} catch {
		return [];
	}
}

async function writeManifest(skills: string[]): Promise<void> {
	await mkdir(SKILLS_TARGET_DIR, { recursive: true });
	await writeFile(
		MANIFEST_PATH,
		`${JSON.stringify(skills, null, 2)}\n`,
		"utf8",
	);
}

async function readOpenCodeSkills(): Promise<
	{ name: string; content: string }[]
> {
	try {
		const entries = await readdir(OPENCODE_SKILLS_DIR, { withFileTypes: true });
		const results = await Promise.all(
			entries
				.filter((e) => e.isDirectory())
				.map(async (dir) => {
					try {
						const content = await readFile(
							join(OPENCODE_SKILLS_DIR, dir.name, "SKILL.md"),
							"utf8",
						);
						return { name: dir.name, content };
					} catch {
						return null;
					}
				}),
		);
		return results.filter(
			(r): r is { name: string; content: string } => r !== null,
		);
	} catch {
		return [];
	}
}

async function targetSkillExists(name: string): Promise<boolean> {
	try {
		await readFile(claudeSkillPath(name), "utf8");
		return true;
	} catch {
		return false;
	}
}

async function writeSkillFile(name: string, content: string): Promise<void> {
	const dir = join(SKILLS_TARGET_DIR, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), content, {
		encoding: "utf8",
		mode: 0o644,
	});
}

async function deleteSkillDir(name: string): Promise<void> {
	await rm(join(SKILLS_TARGET_DIR, name), { recursive: true, force: true });
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class ClaudeSkillAdapter implements ProviderAdapter<string> {
	/**
	 * Read the current content of `~/.claude/skills/<skillName>/SKILL.md`.
	 * Returns an empty string when the file does not exist.
	 */
	async readTarget(skillName?: string): Promise<string> {
		if (!skillName) return "";
		try {
			return await readFile(claudeSkillPath(skillName), "utf8");
		} catch {
			return "";
		}
	}

	/**
	 * Skills are a pure file copy — no schema transform is applied.
	 * Returns the existing target content unchanged.
	 */
	transform(_source: OpenCodeConfig, target: string): string {
		return target;
	}

	/**
	 * Not applicable for the skill adapter — use `sync()` instead.
	 */
	async writeTarget(_content: string): Promise<void> {}

	/**
	 * Full sync pipeline:
	 * 1. Scan `~/.config/opencode/skills/` for skill directories containing `SKILL.md`.
	 * 2. Copy each to `~/.claude/skills/<name>/SKILL.md` (pure file copy).
	 * 3. Warn when a skill name already exists in the target but was not placed by the relay.
	 * 4. Delete previously synced skills that are no longer in the source.
	 * 5. Update the relay manifest.
	 */
	async sync(_source: OpenCodeConfig): Promise<void> {
		const manifest = await readManifest();
		const skills = await readOpenCodeSkills();
		const synced: string[] = [];

		for (const { name, content } of skills) {
			const exists = await targetSkillExists(name);

			if (exists && !manifest.includes(name)) {
				console.warn(
					`[relay:skill] Skill "${name}" already exists in ~/.claude/skills/ and was not placed by the relay — overwriting with OpenCode version`,
				);
			}

			await writeSkillFile(name, content);
			synced.push(name);
		}

		const removed = manifest.filter((n) => !synced.includes(n));
		await Promise.all(removed.map(deleteSkillDir));

		await writeManifest(synced);
	}
}
