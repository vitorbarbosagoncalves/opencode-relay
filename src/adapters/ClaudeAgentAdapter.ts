import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { AGENTS_DIR, SKILLS_DIR } from "../constants/claude.js";
import type { ProviderAdapter } from "../interfaces/ProviderAdapter.js";
import type { OpenCodeAgent, OpenCodeConfig } from "../types/opencode.js";
import { isFileRef, resolveFileRef } from "../utils/fileRefResolver.js";
import { fromHome } from "../utils/pathResolver.js";

// ── Paths ─────────────────────────────────────────────────────────────────────

const OPENCODE_CONFIG_PATH = fromHome(".config/opencode/opencode.jsonc");
const OPENCODE_AGENTS_DIR = fromHome(".config/opencode/agents");
const AGENTS_TARGET_DIR = fromHome(AGENTS_DIR);
const SKILLS_TARGET_DIR = fromHome(SKILLS_DIR);
const MANIFEST_PATH = join(AGENTS_TARGET_DIR, ".relay-manifest.json");

// ── Model / tools maps ────────────────────────────────────────────────────────

const MODEL_ALIASES: Record<string, string> = {
	"anthropic/claude-opus-4-6": "opus",
	"anthropic/claude-sonnet-4-6": "sonnet",
	"anthropic/claude-haiku-4-5": "haiku",
};

const TOOL_NAMES: Record<string, string> = {
	read: "Read",
	write: "Write",
	edit: "Edit",
	bash: "Bash",
};

const ALL_KNOWN_TOOLS = new Set(Object.keys(TOOL_NAMES));

// Fields that belong exclusively to Claude Code and must be preserved when
// merging into an existing agent file.
const CLAUDE_ONLY_KEYS = new Set([
	"permissionMode",
	"maxTurns",
	"skills",
	"disallowedTools",
	"background",
	"isolation",
	"memory",
	"hooks",
	"mcpServers",
]);

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Normalize an agent name to lowercase kebab-case.
 * Handles camelCase, snake_case, spaces, and already-kebab names.
 */
export function toKebabCase(name: string): string {
	return name
		.replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`)
		.replace(/[\s_]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-/, "")
		.toLowerCase();
}

/**
 * Map an OpenCode provider-prefixed model id to a Claude Code alias or id.
 * Non-Anthropic models fall back to "inherit" with a warning.
 */
export function mapModel(model: string | undefined): {
	value: string | undefined;
	warning: string | null;
} {
	if (!model) return { value: undefined, warning: null };
	if (MODEL_ALIASES[model])
		return { value: MODEL_ALIASES[model], warning: null };
	if (model.startsWith("anthropic/"))
		return { value: model.slice("anthropic/".length), warning: null };
	return {
		value: "inherit",
		warning: `Model "${model}" is not an Anthropic model — using "inherit"`,
	};
}

/**
 * Map an OpenCode `tools` boolean map to Claude Code's PascalCase comma-string.
 * - Absent / all-true → undefined (Claude inherits all tools)
 * - All-false        → "" (disables all tool access)
 * - Subset           → comma-separated PascalCase names of enabled tools
 */
export function mapTools(tools: Record<string, boolean> | undefined): {
	value: string | undefined;
} {
	if (!tools) return { value: undefined };
	const entries = Object.entries(tools);
	if (entries.length === 0) return { value: undefined };

	const trueKeys = entries.filter(([, v]) => v).map(([k]) => k);

	if (trueKeys.length === 0) return { value: "" };

	// Only omit the field (inherit all) when every known tool is explicitly enabled
	const allKnownEnabled =
		trueKeys.length === ALL_KNOWN_TOOLS.size &&
		trueKeys.every((k) => ALL_KNOWN_TOOLS.has(k));
	if (allKnownEnabled) return { value: undefined };

	return { value: trueKeys.map((k) => TOOL_NAMES[k] ?? k).join(", ") };
}

// ── YAML frontmatter parser ───────────────────────────────────────────────────

function parseScalar(value: string): unknown {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === '""' || value === "''") return "";
	const num = Number(value);
	if (!Number.isNaN(num) && value !== "") return num;
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function parseYaml(yaml: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	let currentKey: string | null = null;

	for (const line of yaml.split("\n")) {
		if (!line.trim()) continue;

		// Top-level key (no leading whitespace)
		if (!/^\s/.test(line)) {
			const keyMatch = /^([\w-]+):\s*(.*)$/.exec(line);
			if (keyMatch) {
				currentKey = keyMatch[1];
				const val = keyMatch[2].trim();
				result[currentKey] = val ? parseScalar(val) : null;
			}
			continue;
		}

		if (!currentKey) continue;

		// List item
		const listMatch = /^\s+-\s+(.+)$/.exec(line);
		if (listMatch) {
			if (!Array.isArray(result[currentKey])) result[currentKey] = [];
			(result[currentKey] as string[]).push(listMatch[1].trim());
			continue;
		}

		// Nested key: value (e.g. tools object)
		const nestedMatch = /^\s+([\w-]+):\s*(.*)$/.exec(line);
		if (nestedMatch) {
			if (
				result[currentKey] == null ||
				typeof result[currentKey] !== "object" ||
				Array.isArray(result[currentKey])
			) {
				result[currentKey] = {};
			}
			(result[currentKey] as Record<string, unknown>)[nestedMatch[1]] =
				parseScalar(nestedMatch[2].trim());
		}
	}

	return result;
}

/**
 * Split a markdown string into its YAML frontmatter and body.
 * Returns empty frontmatter and the full string as body when no `---` fence is found.
 */
export function parseFrontmatter(content: string): {
	frontmatter: Record<string, unknown>;
	body: string;
} {
	if (!content.startsWith("---")) return { frontmatter: {}, body: content };

	const end = content.indexOf("\n---", 3);
	if (end === -1) return { frontmatter: {}, body: content };

	const yaml = content.slice(4, end);
	const body = content.slice(end + 4).replace(/^\r?\n/, "");

	return { frontmatter: parseYaml(yaml), body };
}

// ── YAML frontmatter serializer ───────────────────────────────────────────────

function serializeValue(key: string, value: unknown): string {
	if (Array.isArray(value)) {
		return `${key}:\n${(value as unknown[]).map((item) => `  - ${item}`).join("\n")}`;
	}
	if (value === "") return `${key}: ""`;
	return `${key}: ${value}`;
}

export function serializeFrontmatter(fm: Record<string, unknown>): string {
	return Object.entries(fm)
		.filter(([, v]) => v !== undefined && v !== null)
		.map(([k, v]) => serializeValue(k, v))
		.join("\n");
}

/**
 * Render a Claude agent/skill markdown file from frontmatter + body.
 */
export function renderAgentMd(
	frontmatter: Record<string, unknown>,
	body: string,
): string {
	return `---\n${serializeFrontmatter(frontmatter)}\n---\n\n${body.trim()}\n`;
}

// ── Frontmatter builder ───────────────────────────────────────────────────────

type AgentSource = {
	description?: string;
	model?: string;
	tools?: Record<string, boolean>;
	temperature?: number;
};

/**
 * Build the Claude Code agent frontmatter from a normalized source shape.
 * Preserves Claude-only fields that already exist in the target file.
 */
export function buildFrontmatter(
	name: string,
	source: AgentSource,
	existing: Record<string, unknown>,
): { frontmatter: Record<string, unknown>; warnings: string[] } {
	const warnings: string[] = [];

	const { value: model, warning: modelWarning } = mapModel(source.model);
	if (modelWarning) warnings.push(modelWarning);

	const { value: tools } = mapTools(source.tools);

	const description = source.description ?? "";
	if (!source.description) {
		warnings.push(`Agent "${name}" has no description — using empty string`);
	}

	if (source.temperature !== undefined) {
		warnings.push(
			`Agent "${name}" has temperature — dropped (not supported by Claude Code)`,
		);
	}

	const preserved = Object.fromEntries(
		Object.entries(existing).filter(([k]) => CLAUDE_ONLY_KEYS.has(k)),
	);

	return {
		frontmatter: {
			name,
			description,
			...preserved,
			...(tools !== undefined && { tools }),
			...(model !== undefined && { model }),
		},
		warnings,
	};
}

// ── Per-agent async transforms ────────────────────────────────────────────────

async function processJsonAgent(
	rawName: string,
	agent: OpenCodeAgent,
	existingContent: string,
): Promise<{
	name: string;
	content: string;
	isSkill: boolean;
	warnings: string[];
}> {
	const name = toKebabCase(rawName);
	const isSkill = agent.mode === "subagent";
	const { frontmatter: existing } = parseFrontmatter(existingContent);
	const warnings: string[] = [];

	let body = "";
	if (agent.prompt) {
		if (isFileRef(agent.prompt)) {
			const { data, error } = await resolveFileRef(
				agent.prompt,
				OPENCODE_CONFIG_PATH,
			);
			if (error) {
				warnings.push(
					`Agent "${name}" prompt file could not be read: ${error}`,
				);
			} else {
				body = data ?? "";
			}
		} else {
			body = agent.prompt;
		}
	}

	const { frontmatter, warnings: fmWarnings } = buildFrontmatter(
		name,
		{
			description: agent.description,
			model: agent.model,
			tools: agent.tools,
			temperature: agent.temperature,
		},
		existing,
	);

	return {
		name,
		content: renderAgentMd(frontmatter, body),
		isSkill,
		warnings: [...fmWarnings, ...warnings],
	};
}

async function processMdAgent(
	rawName: string,
	sourceContent: string,
	existingContent: string,
): Promise<{
	name: string;
	content: string;
	isSkill: boolean;
	warnings: string[];
}> {
	const { frontmatter: sourceFm, body } = parseFrontmatter(sourceContent);
	// Frontmatter `name:` takes precedence over filename when present.
	const name = toKebabCase((sourceFm.name as string | undefined) ?? rawName);
	const { frontmatter: existing } = parseFrontmatter(existingContent);

	const isSkill = sourceFm.mode === "subagent";

	const { frontmatter, warnings } = buildFrontmatter(
		name,
		{
			description: sourceFm.description as string | undefined,
			model: sourceFm.model as string | undefined,
			tools: sourceFm.tools as Record<string, boolean> | undefined,
			temperature: sourceFm.temperature as number | undefined,
		},
		existing,
	);

	return { name, content: renderAgentMd(frontmatter, body), isSkill, warnings };
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

type Manifest = { agents: string[]; skills: string[] };

async function readManifest(): Promise<Manifest> {
	try {
		const raw = await readFile(MANIFEST_PATH, "utf8");
		return JSON.parse(raw) as Manifest;
	} catch {
		return { agents: [], skills: [] };
	}
}

async function writeManifest(manifest: Manifest): Promise<void> {
	await mkdir(AGENTS_TARGET_DIR, { recursive: true });
	await writeFile(
		MANIFEST_PATH,
		`${JSON.stringify(manifest, null, 2)}\n`,
		"utf8",
	);
}

async function readOpenCodeMdAgents(): Promise<
	{ name: string; content: string }[]
> {
	try {
		const files = await readdir(OPENCODE_AGENTS_DIR);
		return Promise.all(
			files
				.filter((f) => f.endsWith(".md"))
				.map(async (file) => ({
					name: basename(file, ".md"),
					content: await readFile(join(OPENCODE_AGENTS_DIR, file), "utf8"),
				})),
		);
	} catch {
		return [];
	}
}

async function readExistingTarget(
	name: string,
	isSkill: boolean,
): Promise<string> {
	try {
		const path = isSkill
			? join(SKILLS_TARGET_DIR, name, "SKILL.md")
			: join(AGENTS_TARGET_DIR, `${name}.md`);
		return await readFile(path, "utf8");
	} catch {
		return "";
	}
}

async function writeAgentFile(name: string, content: string): Promise<void> {
	await mkdir(AGENTS_TARGET_DIR, { recursive: true });
	await writeFile(join(AGENTS_TARGET_DIR, `${name}.md`), content, {
		encoding: "utf8",
		mode: 0o644,
	});
}

async function writeSkillFile(name: string, content: string): Promise<void> {
	const dir = join(SKILLS_TARGET_DIR, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), content, {
		encoding: "utf8",
		mode: 0o644,
	});
}

async function deleteAgentFile(name: string): Promise<void> {
	await rm(join(AGENTS_TARGET_DIR, `${name}.md`), { force: true });
}

async function deleteSkillFile(name: string): Promise<void> {
	await rm(join(SKILLS_TARGET_DIR, name), { recursive: true, force: true });
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class ClaudeAgentAdapter implements ProviderAdapter<string> {
	/**
	 * Read the current content of `~/.claude/agents/<targetName>.md`.
	 * Returns an empty string when the file does not exist.
	 */
	async readTarget(targetName?: string): Promise<string> {
		if (!targetName) return "";
		try {
			return await readFile(
				join(AGENTS_TARGET_DIR, `${targetName}.md`),
				"utf8",
			);
		} catch {
			return "";
		}
	}

	/**
	 * Not applicable for the agent adapter — agents are multi-file.
	 * Use `sync()` as the primary entry point.
	 */
	transform(_source: OpenCodeConfig, target: string): string {
		return target;
	}

	/**
	 * Not applicable for the agent adapter — use `sync()` instead.
	 */
	async writeTarget(_content: string): Promise<void> {}

	/**
	 * Full sync pipeline:
	 * 1. Process JSON agents from `opencode.jsonc` (`agent` key).
	 * 2. Process MD agents from `~/.config/opencode/agents/`.
	 * 3. Delete previously synced files that are no longer in source.
	 * 4. Update the relay manifest.
	 */
	async sync(source: OpenCodeConfig): Promise<void> {
		if (source.default_agent) {
			console.info(
				`[relay:agent] default_agent "${source.default_agent}" has no Claude Code equivalent — ignored`,
			);
		}

		const manifest = await readManifest();
		const newAgents: string[] = [];
		const newSkills: string[] = [];
		const processedNames = new Set<string>();

		// ── JSON agents ─────────────────────────────────────────────────────────
		for (const [rawName, agent] of Object.entries(source.agent ?? {})) {
			const name = toKebabCase(rawName);
			const isSkill = agent.mode === "subagent";
			const existingContent = await readExistingTarget(name, isSkill);
			const result = await processJsonAgent(rawName, agent, existingContent);

			for (const w of result.warnings) console.warn(`[relay:agent] ${w}`);

			if (isSkill) {
				await writeSkillFile(name, result.content);
				newSkills.push(name);
			} else {
				await writeAgentFile(name, result.content);
				newAgents.push(name);
			}
			processedNames.add(name);
		}

		// ── MD agents ────────────────────────────────────────────────────────────
		const mdAgents = await readOpenCodeMdAgents();

		for (const { name: rawName, content: sourceContent } of mdAgents) {
			// Pre-parse frontmatter to resolve the effective output name before
			// checking processedNames and reading the existing target file.
			const { frontmatter: sourceFm } = parseFrontmatter(sourceContent);
			const outputName = toKebabCase(
				(sourceFm.name as string | undefined) ?? rawName,
			);
			const isSkill = sourceFm.mode === "subagent";

			if (processedNames.has(outputName)) {
				console.warn(
					`[relay:agent] Agent "${outputName}" defined in both opencode.jsonc and MD file — JSON entry takes precedence`,
				);
				continue;
			}

			const existingContent = await readExistingTarget(outputName, isSkill);
			const result = await processMdAgent(
				rawName,
				sourceContent,
				existingContent,
			);

			for (const w of result.warnings) console.warn(`[relay:agent] ${w}`);

			if (result.isSkill) {
				await writeSkillFile(result.name, result.content);
				newSkills.push(result.name);
			} else {
				await writeAgentFile(result.name, result.content);
				newAgents.push(result.name);
			}
			processedNames.add(result.name);
		}

		// ── Deletion ─────────────────────────────────────────────────────────────
		const removedAgents = manifest.agents.filter((n) => !newAgents.includes(n));
		const removedSkills = manifest.skills.filter((n) => !newSkills.includes(n));

		await Promise.all([
			...removedAgents.map(deleteAgentFile),
			...removedSkills.map(deleteSkillFile),
		]);

		await writeManifest({ agents: newAgents, skills: newSkills });
	}
}
