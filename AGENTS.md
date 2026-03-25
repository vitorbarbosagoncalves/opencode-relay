# OpenCode Relay - Agent Context

## Project Summary

Lightweight Node.js daemon that watches `~/.config/opencode/opencode.jsonc` and syncs its configuration to Claude Code (and future targets). Uses **Hub-and-Spoke / Adapter Pattern**.

- **Source truth**: `~/.config/opencode/opencode.jsonc` — JSONC format (has comments; use `jsonc-parser`, never `JSON.parse()`)
- **Sync targets**: `~/.claude.json` (MCPs), `~/.claude/agents/` (agents), `~/.claude/skills/` (skills)
- **Full schema analysis**: see `PLAN.md`

## Architecture

### Hub (`src/engine/SyncEngine.ts`)
- Watches source files with chokidar + 500ms debounce
- Orchestrates adapter calls on change — contains **zero translation logic**

### Spokes (`src/adapters/`)
- Each adapter implements `src/interfaces/ProviderAdapter.ts`
- Non-destructive: read target first, merge, write back
- Three Claude adapters: `ClaudeMcpAdapter`, `ClaudeAgentAdapter`, `ClaudeSkillAdapter`

## Code Style: Elixir-Inspired Functional

- All functions **pure** — no side effects, deterministic output
- `const` everywhere — never reassign variables; use `function` declarations for named functions (not `const fn = () =>`)
- Immutable transforms: spread, `.map()`, `.filter()` — never mutate state
- Small, composable, single-purpose functions
- **Test names start with a verb** — `"resolves ~/foo"`, `"returns error for missing var"`, never `"should …"`
- **`describe` uses the function reference**, not a string — `describe(myFn, () => { … })` not `describe("myFn", () => { … })`
- **No `throw`** — return a result/error tuple instead:
  - Success: `{ data: T; error: null }`
  - Failure: `{ data: null; error: string }`
  - Or a default value when an absent/invalid input is recoverable (e.g. return `[]` for a missing list)
  - Callers decide whether to propagate, warn, or skip — never let a single bad entry crash the daemon

## Schema Transform Quick Reference

### MCPs (`mcp` → `mcpServers` in `~/.claude.json`)
| OpenCode | Claude Code |
|---|---|
| `type: "local"` | `type: "stdio"` |
| `type: "remote"` | `type: "http"` (default) |
| `command: ["npx", "-y", "x"]` array | `command: "npx"`, `args: ["-y", "x"]` |
| `environment: {}` | `env: {}` |
| `{env:VAR}` in values | resolve `process.env[VAR]` at sync time |
| `enabled: false` | omit server entirely |
| `oauth: {...}` | **drop** — convert as plain `http`; Claude manages auth |

### Agents (`agent` key + `~/.config/opencode/agents/*.md` → `~/.claude/agents/`)
| OpenCode | Claude Code |
|---|---|
| JSON object key or MD filename | `name` frontmatter (kebab-case) |
| `tools: { write: true, bash: false }` object | `tools: "Write"` PascalCase comma-string |
| `model: "anthropic/claude-sonnet-4-6"` | `model: "sonnet"` (strip prefix, alias) |
| `model: "openrouter/..."` non-Anthropic | `model: "inherit"` + warn |
| `mode: "subagent"` | still written to `~/.claude/agents/` — it's a Claude subagent, not a skill |
| `temperature` | **drop** — invalid in Claude agents; warn |
| `prompt: "{file:./prompts/x.md}"` | inline file content as body |

### Skills (`~/.config/opencode/skills/` → `~/.claude/skills/`)
Pure file copy — formats are compatible. OpenCode extras (`license`, `compatibility`, `metadata`) are silently ignored by Claude Code.

**Do NOT sync from `~/.claude/skills/`** — OpenCode already searches that path natively. Only sync from `~/.config/opencode/skills/` (OpenCode-exclusive).

## Critical Gotchas

1. **JSONC**: source is `opencode.jsonc` not `.json` — always use `jsonc-parser`
2. **`{env:VAR}` templates**: present in MCP values/headers — resolve at sync time; log warn if undefined
3. **`temperature` in OpenCode agents**: valid in OpenCode, **crashes Claude** — must be dropped
4. **`description` required**: Claude Code agents require `description`; OpenCode makes it optional — write `""` + warn rather than omit
5. **Two agent sources**: both `opencode.jsonc` (`agent` key) and `~/.config/opencode/agents/*.md` must be watched
6. **`mode: "subagent"` is still an agent**: goes to `~/.claude/agents/` like any other agent — `~/.claude/skills/` is for user-invocable slash commands, a different concept
7. **Shared skills dir**: `~/.claude/skills/` is scanned by both tools natively — never use it as a sync *source* or you'll create circular updates
8. **Home dir**: always use `pathResolver.resolveHome()`, never assume `~` expansion
9. **Non-destructive merge**: read target file first, spread only the synced keys, preserve Claude-specific fields (`skills`, `permissionMode`, etc.)
10. **Deletion tracking**: removing an agent/skill from OpenCode must delete the corresponding Claude file — track what was last synced
