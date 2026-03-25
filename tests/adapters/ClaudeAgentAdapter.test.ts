import { afterEach, describe, expect, it, vi } from "vitest";

// Mock must be declared before any import that uses node:fs/promises.
vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	readdir: vi.fn().mockResolvedValue([]),
	readFile: vi
		.fn()
		.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
	rm: vi.fn().mockResolvedValue(undefined),
	stat: vi
		.fn()
		.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
	writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import {
	buildFrontmatter,
	ClaudeAgentAdapter,
	mapModel,
	mapTools,
	parseFrontmatter,
	processMdAgent,
	renderAgentMd,
	serializeFrontmatter,
	toKebabCase,
} from "../../src/adapters/ClaudeAgentAdapter.js";

// ── toKebabCase ───────────────────────────────────────────────────────────────

describe(toKebabCase, () => {
	it("lowercases a simple name", () => {
		expect(toKebabCase("developer")).toBe("developer");
	});

	it("converts camelCase to kebab-case", () => {
		expect(toKebabCase("codeReviewer")).toBe("code-reviewer");
	});

	it("converts snake_case to kebab-case", () => {
		expect(toKebabCase("code_reviewer")).toBe("code-reviewer");
	});

	it("converts spaces to hyphens", () => {
		expect(toKebabCase("code reviewer")).toBe("code-reviewer");
	});

	it("strips leading hyphen from PascalCase input", () => {
		expect(toKebabCase("CodeReviewer")).toBe("code-reviewer");
	});

	it("collapses repeated separators from mixed underscores and spaces", () => {
		expect(toKebabCase("code__review  tool")).toBe("code-review-tool");
	});
});

// ── mapModel ──────────────────────────────────────────────────────────────────

describe(mapModel, () => {
	it("returns undefined with no warning when model is absent", () => {
		expect(mapModel(undefined)).toEqual({ value: undefined, warning: null });
	});

	it("maps anthropic/claude-opus-4-6 to opus", () => {
		expect(mapModel("anthropic/claude-opus-4-6")).toEqual({
			value: "opus",
			warning: null,
		});
	});

	it("maps anthropic/claude-sonnet-4-6 to sonnet", () => {
		expect(mapModel("anthropic/claude-sonnet-4-6")).toEqual({
			value: "sonnet",
			warning: null,
		});
	});

	it("maps anthropic/claude-haiku-4-5 to haiku", () => {
		expect(mapModel("anthropic/claude-haiku-4-5")).toEqual({
			value: "haiku",
			warning: null,
		});
	});

	it("strips anthropic/ prefix for unlisted Anthropic models", () => {
		expect(mapModel("anthropic/claude-3-5-sonnet")).toEqual({
			value: "claude-3-5-sonnet",
			warning: null,
		});
	});

	it("falls back to inherit and warns for non-Anthropic models", () => {
		const result = mapModel("openrouter/meta/llama-3");
		expect(result.value).toBe("inherit");
		expect(result.warning).toMatch(/not an Anthropic model/);
		expect(result.warning).toMatch(/openrouter\/meta\/llama-3/);
	});
});

// ── mapTools ──────────────────────────────────────────────────────────────────

describe(mapTools, () => {
	it("returns undefined when tools is absent (inherit all)", () => {
		expect(mapTools(undefined)).toEqual({ value: undefined });
	});

	it("returns undefined when all tools are enabled (inherit all)", () => {
		expect(
			mapTools({ read: true, write: true, edit: true, bash: true }),
		).toEqual({ value: undefined });
	});

	it("returns empty string when all tools are disabled", () => {
		expect(
			mapTools({ read: false, write: false, edit: false, bash: false }),
		).toEqual({ value: "" });
	});

	it("returns PascalCase comma-string for a subset of enabled tools", () => {
		expect(
			mapTools({ read: true, write: false, edit: true, bash: false }),
		).toEqual({ value: "Read, Edit" });
	});

	it("maps write → Write, bash → Bash", () => {
		expect(mapTools({ write: true, bash: true })).toEqual({
			value: "Write, Bash",
		});
	});
});

// ── parseFrontmatter ──────────────────────────────────────────────────────────

describe(parseFrontmatter, () => {
	it("parses scalar string fields", () => {
		const md = `---\nname: dev\ndescription: A developer agent\n---\n\nbody text`;
		const { frontmatter, body } = parseFrontmatter(md);
		expect(frontmatter.name).toBe("dev");
		expect(frontmatter.description).toBe("A developer agent");
		expect(body.trim()).toBe("body text");
	});

	it("parses boolean and number scalars", () => {
		const md = `---\nbackground: true\nmaxTurns: 10\n---\n\n`;
		const { frontmatter } = parseFrontmatter(md);
		expect(frontmatter.background).toBe(true);
		expect(frontmatter.maxTurns).toBe(10);
	});

	it("parses YAML list fields", () => {
		const md = `---\nskills:\n  - git-release\n  - deploy\n---\n\n`;
		const { frontmatter } = parseFrontmatter(md);
		expect(frontmatter.skills).toEqual(["git-release", "deploy"]);
	});

	it("parses nested object fields (OpenCode tools format)", () => {
		const md = `---\ntools:\n  write: false\n  bash: true\n---\n\n`;
		const { frontmatter } = parseFrontmatter(md);
		expect(frontmatter.tools).toEqual({ write: false, bash: true });
	});

	it("returns empty frontmatter and full string as body when no fence found", () => {
		const plain = "no frontmatter here";
		const { frontmatter, body } = parseFrontmatter(plain);
		expect(frontmatter).toEqual({});
		expect(body).toBe(plain);
	});

	it("handles quoted empty string for tools", () => {
		const md = `---\ntools: ""\n---\n\n`;
		const { frontmatter } = parseFrontmatter(md);
		expect(frontmatter.tools).toBe("");
	});
});

// ── serializeFrontmatter ──────────────────────────────────────────────────────

describe(serializeFrontmatter, () => {
	it("serializes scalar fields", () => {
		const result = serializeFrontmatter({ name: "dev", model: "sonnet" });
		expect(result).toContain("name: dev");
		expect(result).toContain("model: sonnet");
	});

	it("serializes array fields as YAML list", () => {
		const result = serializeFrontmatter({ skills: ["git", "deploy"] });
		expect(result).toContain("skills:");
		expect(result).toContain("  - git");
		expect(result).toContain("  - deploy");
	});

	it("serializes empty string as quoted value", () => {
		const result = serializeFrontmatter({ tools: "" });
		expect(result).toContain('tools: ""');
	});

	it("omits undefined and null fields", () => {
		const result = serializeFrontmatter({ name: "dev", model: undefined });
		expect(result).not.toContain("model");
	});
});

// ── renderAgentMd ─────────────────────────────────────────────────────────────

describe(renderAgentMd, () => {
	it("wraps frontmatter in --- fences with a blank line before body", () => {
		const result = renderAgentMd({ name: "dev", description: "A dev" }, "body");
		expect(result).toMatch(/^---\n/);
		expect(result).toContain("\n---\n\nbody\n");
	});

	it("trims trailing whitespace from body", () => {
		const result = renderAgentMd(
			{ name: "x", description: "" },
			"  body  \n\n",
		);
		expect(result.endsWith("body\n")).toBe(true);
	});
});

// ── buildFrontmatter ──────────────────────────────────────────────────────────

describe(buildFrontmatter, () => {
	it("builds minimal frontmatter from a JSON agent", () => {
		const { frontmatter, warnings } = buildFrontmatter(
			"developer",
			{
				description: "A full-stack developer",
				model: "anthropic/claude-sonnet-4-6",
				tools: { read: true, write: true },
			},
			{},
		);
		expect(frontmatter.name).toBe("developer");
		expect(frontmatter.description).toBe("A full-stack developer");
		expect(frontmatter.model).toBe("sonnet");
		expect(frontmatter.tools).toBe("Read, Write"); // explicit subset → emit
		expect(warnings).toHaveLength(0);
	});

	it("warns and uses empty description when missing", () => {
		const { frontmatter, warnings } = buildFrontmatter("bot", {}, {});
		expect(frontmatter.description).toBe("");
		expect(warnings.some((w) => w.includes("no description"))).toBe(true);
	});

	it("warns and drops temperature", () => {
		const { warnings } = buildFrontmatter(
			"bot",
			{ description: "x", temperature: 0.5 },
			{},
		);
		expect(warnings.some((w) => w.includes("temperature"))).toBe(true);
		expect(warnings.some((w) => w.includes("dropped"))).toBe(true);
	});

	it("warns for non-Anthropic model and sets inherit", () => {
		const { frontmatter, warnings } = buildFrontmatter(
			"bot",
			{ description: "x", model: "openrouter/gpt-4" },
			{},
		);
		expect(frontmatter.model).toBe("inherit");
		expect(warnings.some((w) => w.includes("not an Anthropic model"))).toBe(
			true,
		);
	});

	it("preserves Claude-only fields from existing target", () => {
		const existing = {
			permissionMode: "acceptEdits",
			maxTurns: 5,
			skills: ["git-release"],
			someOtherField: "ignored",
		};
		const { frontmatter } = buildFrontmatter(
			"bot",
			{ description: "x" },
			existing,
		);
		expect(frontmatter.permissionMode).toBe("acceptEdits");
		expect(frontmatter.maxTurns).toBe(5);
		expect(frontmatter.skills).toEqual(["git-release"]);
		expect(frontmatter.someOtherField).toBeUndefined();
	});

	it("includes tools string when subset of tools enabled", () => {
		const { frontmatter } = buildFrontmatter(
			"bot",
			{ description: "x", tools: { read: true, write: false, bash: false } },
			{},
		);
		expect(frontmatter.tools).toBe("Read");
	});

	it("sets tools to empty string when all disabled", () => {
		const { frontmatter } = buildFrontmatter(
			"bot",
			{ description: "x", tools: { read: false, write: false } },
			{},
		);
		expect(frontmatter.tools).toBe("");
	});
});

// ── processMdAgent ────────────────────────────────────────────────────────────

describe(processMdAgent, () => {
	it("uses frontmatter name: as output name instead of the filename", async () => {
		const source = "---\nname: custom-agent\ndescription: x\n---\nbody text";
		const result = await processMdAgent("my_filename", source, "");
		expect(result.name).toBe("custom-agent");
	});
});

// ── ClaudeAgentAdapter.sync — MD name collision ───────────────────────────────

describe(ClaudeAgentAdapter, () => {
	afterEach(() => vi.clearAllMocks());

	it("skips MD agent whose frontmatter name: collides with a JSON-defined agent", async () => {
		// MD file "reviewer.md" declares name: code-reviewer in its frontmatter,
		// matching the JSON agent "code_reviewer" — it must be skipped.
		vi.mocked(readdir).mockResolvedValue(["reviewer.md"] as never);
		vi.mocked(readFile).mockImplementation(async (path) => {
			if (String(path).endsWith("reviewer.md")) {
				return "---\nname: code-reviewer\ndescription: from md\n---\nbody";
			}
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		});

		const adapter = new ClaudeAgentAdapter();
		await adapter.sync({
			agent: { code_reviewer: { description: "from json" } },
		} as never);

		// Only the JSON agent's .md and the manifest (.json) should be written —
		// the MD agent must have been skipped entirely.
		const writtenPaths = vi
			.mocked(writeFile)
			.mock.calls.map((c) => String(c[0]));
		const agentWrites = writtenPaths.filter((p) => p.endsWith(".md"));
		expect(agentWrites).toHaveLength(1);
		expect(agentWrites[0]).toMatch(/code-reviewer\.md$/);
	});

	it("does not delete a manifest agent when its MD source file still exists", async () => {
		// "foo" was previously synced as an agent (present in manifest).
		// It has been removed from opencode.jsonc but foo.md still exists in the
		// OpenCode agents directory (possibly with a changed role). The relay must
		// not delete ~/.claude/agents/foo.md — the MD processing will handle it.
		vi.mocked(readdir).mockResolvedValue([] as never); // MD dir returns nothing this cycle
		vi.mocked(readFile).mockImplementation(async (path) => {
			if (String(path).endsWith(".relay-manifest.json")) {
				return JSON.stringify({ agents: ["foo"], skills: [] });
			}
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		});
		// stat succeeds for foo.md — the source file exists
		vi.mocked(stat).mockImplementation(async (path) => {
			if (String(path).endsWith("foo.md")) return {} as never;
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		});

		const adapter = new ClaudeAgentAdapter();
		await adapter.sync({} as never);

		expect(vi.mocked(rm)).not.toHaveBeenCalledWith(
			expect.stringMatching(/foo\.md$/),
			expect.anything(),
		);
	});

	it("deletes a manifest agent when its MD source file is gone", async () => {
		// "bar" was previously synced as an agent (present in manifest).
		// It has been removed from opencode.jsonc and no MD file exists for it —
		// the relay must delete ~/.claude/agents/bar.md.
		vi.mocked(readdir).mockResolvedValue([] as never);
		vi.mocked(readFile).mockImplementation(async (path) => {
			if (String(path).endsWith(".relay-manifest.json")) {
				return JSON.stringify({ agents: ["bar"], skills: [] });
			}
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		});
		// stat fails for all files — no MD source exists
		vi.mocked(stat).mockRejectedValue(
			Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
		);

		const adapter = new ClaudeAgentAdapter();
		await adapter.sync({} as never);

		expect(vi.mocked(rm)).toHaveBeenCalledWith(
			expect.stringMatching(/bar\.md$/),
			expect.anything(),
		);
	});

	it("writes an MD-only subagent to ~/.claude/agents/ not ~/.claude/skills/", async () => {
		// mode: subagent is an OpenCode concept — it maps to a Claude subagent
		// in ~/.claude/agents/, not a skill in ~/.claude/skills/.
		vi.mocked(readdir).mockResolvedValue(["helper.md"] as never);
		vi.mocked(readFile).mockImplementation(async (path) => {
			if (String(path).endsWith("helper.md")) {
				return "---\nname: helper\ndescription: A helper\nmode: subagent\n---\nbody";
			}
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		});

		const adapter = new ClaudeAgentAdapter();
		await adapter.sync({} as never);

		const writtenPaths = vi
			.mocked(writeFile)
			.mock.calls.map((c) => String(c[0]));
		expect(writtenPaths.some((p) => p.match(/agents\/helper\.md$/))).toBe(true);
		expect(writtenPaths.some((p) => p.includes("skills/helper"))).toBe(false);
	});

	it("migrates manifest.skills entries to ~/.claude/agents/ and cleans up ~/.claude/skills/", async () => {
		// Old manifests had subagents incorrectly written to ~/.claude/skills/.
		// On first sync after the fix, those skill dirs must be deleted and the
		// agents must be (re-)written to ~/.claude/agents/.
		vi.mocked(readdir).mockResolvedValue(["mover.md"] as never);
		vi.mocked(readFile).mockImplementation(async (path) => {
			if (String(path).endsWith(".relay-manifest.json")) {
				return JSON.stringify({ agents: [], skills: ["mover"] });
			}
			if (String(path).endsWith("mover.md")) {
				return "---\nname: mover\ndescription: moved\nmode: subagent\n---\nbody";
			}
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		});

		const adapter = new ClaudeAgentAdapter();
		await adapter.sync({} as never);

		// Old skill dir must be removed
		expect(vi.mocked(rm)).toHaveBeenCalledWith(
			expect.stringMatching(/skills\/mover$/),
			expect.objectContaining({ recursive: true }),
		);
		// Agent must be written to ~/.claude/agents/
		const writtenPaths = vi
			.mocked(writeFile)
			.mock.calls.map((c) => String(c[0]));
		expect(writtenPaths.some((p) => p.match(/agents\/mover\.md$/))).toBe(true);
	});
});
