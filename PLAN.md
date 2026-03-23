# OpenCode Relay - Project Plan

## Overview

A lightweight background daemon that watches an OpenCode configuration file, translates its schema, and synchronizes it across multiple AI CLI tool configuration files (e.g., Claude Code, Cline, etc.).

## Architecture

### Pattern: Hub-and-Spoke / Adapter Pattern

- **Hub**: Core watcher engine that reads the source of truth (`~/.config/opencode/opencode.jsonc`)
- **Spokes (Adapters)**: Isolated classes that translate source data to provider-specific schemas and persist to target files

This design enables adding new tool adapters without modifying the core engine.

## Tech Stack

| Category | Specification |
|----------|---|
| **Language** | TypeScript |
| **Runtime** | Node.js (npm-compatible, also runnable via `bun run` or `deno run`) |
| **File Watching** | chokidar (cross-platform, robust) |
| **File I/O** | Node.js `fs/promises` and `path` modules |
| **JSONC Parsing** | `jsonc-parser` (strips comments before parsing) |
| **Dev Tools** | typescript, @types/node |

---

## Full Schema Analysis: OpenCode → Claude Code

### Source Config

- **Location**: `~/.config/opencode/opencode.jsonc` (JSONC format — JSON with comments)
- **Note**: Must be parsed with a JSONC-aware parser (e.g. `jsonc-parser`), not `JSON.parse()`

---

### 1. MCP Servers

#### OpenCode schema (`mcp` key)

```jsonc
{
  "mcp": {
    // Local stdio process
    "tool-local": {
      "type": "local",
      "command": ["npx", "-y", "some-tool"],
      "environment": {
        "API_KEY": "{env:MY_API_KEY}",
        "REGION": "eu-west-1"
      },
      "enabled": false          // optional - omit to enable
    },
    // Remote HTTP/SSE
    "tool-remote": {
      "type": "remote",
      "url": "https://mcp.example.com/v1/sse",
      "headers": {
        "Authorization": "Bearer {env:MY_TOKEN}"
      }
    },
    // Remote with OAuth (no direct Claude equivalent)
    "tool-oauth": {
      "type": "remote",
      "url": "https://mcp.figma.com/mcp",
      "oauth": {
        "clientId": "abc123",
        "clientSecret": "xyz789"
      }
    }
  }
}
```

#### Claude Code schema (`mcpServers` key in `~/.claude.json`)

```json
{
  "mcpServers": {
    "tool-local": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-tool"],
      "env": {
        "API_KEY": "actual-resolved-value",
        "REGION": "eu-west-1"
      }
    },
    "tool-remote-http": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer actual-resolved-value"
      }
    },
    "tool-remote-sse": {
      "type": "sse",
      "url": "https://mcp.example.com/v1/sse",
      "headers": {
        "Authorization": "Bearer actual-resolved-value"
      }
    }
  }
}
```

#### MCP Schema Diff Table

| Field / Behavior | OpenCode | Claude Code | Transform Required |
|---|---|---|---|
| Container key | `mcp` | `mcpServers` | rename |
| Local type value | `"local"` | `"stdio"` | rename |
| Remote type value | `"remote"` | `"http"` or `"sse"` | **heuristic or config** |
| Command format | array `["npx", "-y", "x"]` | `command: "npx"` + `args: ["-y", "x"]` | split array[0] vs rest |
| Env vars key | `environment` | `env` | rename |
| Env var template | `"{env:VAR_NAME}"` | raw string (process.env resolved) | resolve at sync time |
| Disable flag | `enabled: false` | absent = disabled (must omit) | skip entry if `enabled === false` |
| OAuth config | `oauth: { clientId, clientSecret }` | **not supported** | skip / warn user |
| Remote URL path | may end in `/sse` (SSE protocol) | `/mcp` (streamable HTTP) | **cannot auto-detect; user must configure** |
| Header templates | `"{env:VAR}"` in `headers` | raw values | resolve `{env:VAR}` references |

#### Critical Transform Rules

1. **`type: "local"` → `type: "stdio"`**: simple rename
2. **`type: "remote"` → `"http"` or `"sse"`**: cannot be determined from URL alone; default to `"http"`, allow per-server override in relay config
3. **command array split**: `["npx", "-y", "pkg"]` → `command: "npx"`, `args: ["-y", "pkg"]`
4. **`{env:VAR}` resolution**: read `process.env[VAR]` at sync time; log warning if var is missing, skip that server
5. **`enabled: false`**: skip the server entirely — do not write it to Claude config
6. **`oauth`**: no Claude equivalent; log a warning and skip the server
7. **`environment` → `env`**: key rename only

---

### 2. Agents / Prompts

#### OpenCode agent sources (two formats)

**Format A — JSON in `opencode.jsonc`** (`agent` key):

```jsonc
{
  "default_agent": "economy",
  "agent": {
    "developer": {
      "description": "Full-stack developer agent",
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-6",
      "prompt": "{file:./prompts/developer.txt}",  // file reference OR inline string
      "tools": { "write": true, "edit": true, "bash": true }
    },
    "code-reviewer": {
      "description": "Reviews code for best practices",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-6",
      "prompt": "You are a code reviewer. Focus on security and maintainability.",
      "tools": { "write": false, "edit": false }
    }
  }
}
```

**Format B — Markdown files** in `~/.config/opencode/agents/` or `.opencode/agents/` (filename = agent name):

```markdown
---
description: Reviews code for quality and best practices
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
tools:
  write: false
  edit: false
  bash: false
---

You are in code review mode. Focus on code quality, bugs, performance, security.
```

OpenCode `tools` in both formats: YAML/JSON **object** `{ key: boolean }` using lowercase tool names.
`prompt` in JSON can be an **inline string** or a `{file:./path}` reference.

#### Claude Code schema (`~/.claude/agents/<name>.md` or `.claude/agents/<name>.md`)

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

Full supported frontmatter fields (official docs):

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique ID, lowercase + hyphens |
| `description` | Yes | When Claude should delegate to this subagent |
| `tools` | No | Comma-separated PascalCase tool names. Inherits all if omitted |
| `disallowedTools` | No | Tools to deny from inherited or specified list |
| `model` | No | `sonnet`, `opus`, `haiku`, full model ID, or `inherit` (default: `inherit`) |
| `permissionMode` | No | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, or `plan` |
| `maxTurns` | No | Max agentic turns before stopping |
| `skills` | No | List of skill names to inject into subagent context at startup (full content, not just available) |
| `mcpServers` | No | MCP servers available to this subagent (inline or by reference name) |
| `hooks` | No | Lifecycle hooks scoped to this subagent |
| `memory` | No | Persistent memory scope: `user`, `project`, or `local` |
| `background` | No | `true` to always run as background task |
| `isolation` | No | `worktree` to run in isolated git worktree |

**Locations**: `~/.claude/agents/` (global, all projects) or `.claude/agents/` (project-scoped, shareable via git).
Skills are NOT agents — they live in `~/.claude/skills/<name>/SKILL.md` and are invoked via `/skill-name`.

#### Agent Schema Diff Table

| Field / Behavior | OpenCode | Claude Code | Transform Required |
|---|---|---|---|
| Config format | JSON key in config OR markdown file | Markdown file only | always produce `.md` |
| Global agent dir | `~/.config/opencode/agents/` | `~/.claude/agents/` | different paths |
| Project agent dir | `.opencode/agents/` | `.claude/agents/` | different paths |
| Agent name (JSON) | JSON object key | `name` frontmatter field (kebab-case) | sanitize to kebab-case |
| Agent name (MD) | filename (without `.md`) | filename (without `.md`) | normalize to kebab-case |
| `description` | optional in JSON; absent from MD frontmatter | **required** in Claude | add empty description warning if missing |
| `prompt` (JSON) | inline string OR `{file:./path}` | inline markdown body | resolve file ref; use string directly |
| `prompt` in MD format | markdown body content | markdown body content | direct copy |
| `model` | full provider ID `anthropic/claude-sonnet-4-6` | alias or full Anthropic ID or `inherit` | **map — see table below** |
| `mode: "primary"` | default chat agent | standard agent | none |
| `mode: "subagent"` | slash-command skill | **not an agent concept** — route to skills | use Skills adapter |
| `default_agent` | sets default agent globally | **no equivalent** | drop; log info |
| `tools` (JSON) | `{ "write": true, "bash": false }` object | comma-separated PascalCase `"Write, Bash"` | filter `true`, rename, join |
| `tools` (MD) | YAML object `write: false` | comma-separated PascalCase string | same transform |
| `temperature` | valid in OpenCode MD agents | **not a Claude Code agent field** | drop; log warning |
| `color`, `emoji`, `vibe` | not in OpenCode | Claude Code extra visual fields | preserve if already in target file |
| `skills` | not supported | list of skill names preloaded at startup | no OpenCode source; Claude-only |
| `disallowedTools` | not supported | deny list for inherited tools | no OpenCode source; Claude-only |
| `permissionMode` | not supported | permission model | no OpenCode source; Claude-only |
| `maxTurns` | not supported | agentic turn limit | no OpenCode source; Claude-only |

#### Model Mapping Rules

OpenCode uses `provider/model-id` format; Claude Code accepts only Anthropic models:

| OpenCode model | Claude Code `model` |
|---|---|
| `anthropic/claude-opus-4-6` | `opus` |
| `anthropic/claude-sonnet-4-6` | `sonnet` |
| `anthropic/claude-haiku-4-5` | `haiku` |
| `anthropic/claude-*` (other) | full ID, strip `anthropic/` prefix |
| `openrouter/*`, `openai/*`, `google/*`, etc. | **`inherit`** + log warning |

#### Tools Mapping Rules

OpenCode `tools` (boolean object) → Claude Code `tools` (PascalCase comma-separated string):

| OpenCode key | Claude Code name |
|---|---|
| `read` | `Read` |
| `write` | `Write` |
| `edit` | `Edit` |
| `bash` | `Bash` |

Filter to `true` values only. If all tools are `true` or `tools` is absent → **omit `tools` field** (Claude inherits all).
If all tools are `false` → set `tools: ""` (empty string disables all tool access).

#### Critical Transform Rules

1. **Source detection**: watch both `opencode.jsonc` (`agent` key) AND `~/.config/opencode/agents/*.md` files
2. **Output**: always write to `~/.claude/agents/<name>.md`
3. **`mode: "subagent"`**: route to `~/.claude/skills/<name>/SKILL.md` — do not create an agent file
4. **`prompt` resolution**: inline string → use as body; `{file:./path}` → read file, use content as body
5. **Frontmatter merge (MD source)**: merge source frontmatter fields, applying model/tools transforms; Claude-specific fields (`skills`, `permissionMode`, etc.) preserved if already in target
6. **`description` is required** in Claude Code — if missing in OpenCode, write empty string and log warning
7. **`model` mapping**: apply table above; non-Anthropic → `inherit` + warn
8. **`tools` mapping**: filter `true` → PascalCase → join `, `; omit if all enabled; `""` if all disabled
9. **`temperature`**: drop; log warning (common in OpenCode MD agents, invalid in Claude agents)
10. **`default_agent`**: no equivalent — drop; log info
11. **Deletion**: if an agent is removed from source, delete corresponding target `.md`

---

### 3. Skills

#### OpenCode schema

**Recognized frontmatter fields** (all others silently ignored by OpenCode):

```markdown
---
name: git-release              # required
description: Create consistent releases and changelogs   # required
license: MIT                   # optional
compatibility: opencode        # optional
metadata:                      # optional, string-to-string map
  audience: maintainers
  workflow: github
---

[Skill prompt body]
```

**Search locations** — OpenCode finds skills in ALL of these (first match by name wins):

| Priority | Path |
|---|---|
| 1 (project) | `.opencode/skills/<name>/SKILL.md` |
| 2 (project) | `.claude/skills/<name>/SKILL.md` ← **shared with Claude Code!** |
| 3 (project) | `.agents/skills/<name>/SKILL.md` |
| 4 (global) | `~/.config/opencode/skills/<name>/SKILL.md` |
| 5 (global) | `~/.claude/skills/<name>/SKILL.md` ← **shared with Claude Code!** |
| 6 (global) | `~/.agents/skills/<name>/SKILL.md` |

**Critical discovery**: OpenCode already searches `~/.claude/skills/` and `.claude/skills/`. Skills stored in Claude's directories are natively visible to OpenCode — no relay needed for files already placed there.

Skill names must be **unique** across all locations. Skills with `deny` permission are hidden from agents.

#### Claude Code schema

**Recognized frontmatter fields** (`~/.claude/skills/<name>/SKILL.md` or `.claude/skills/<name>/SKILL.md`):

```markdown
---
name: fix-issue                          # display name (optional but recommended)
description: Fix a GitHub issue when the user provides an issue number or URL
argument-hint: <issue-number-or-url>     # shown in autocomplete
disable-model-invocation: true           # prevent Claude auto-triggering (user-only)
user-invocable: false                    # hide from / slash menu (still invocable via tool)
allowed-tools: Read, Bash, Glob          # tools Claude can use within this skill
model: sonnet                            # model for this skill execution
context: fork                            # run in a forked subagent
agent: code-reviewer                     # delegate to named subagent
hooks:                                   # lifecycle hooks
  before: [...]
  after: [...]
---

Analyze and fix the GitHub issue: $ARGUMENTS.
```

**Key Claude-only features**:
- `$ARGUMENTS` — placeholder substituted with text typed after `/skill-name <args>`
- `argument-hint` — autocomplete hint shown when typing `/skill-name `
- `disable-model-invocation: true` — skill only runs when user explicitly invokes via `/`; Claude cannot trigger it autonomously (use for destructive/side-effect actions like deploys)
- `user-invocable: false` — hides from `/` menu but Claude can still trigger it programmatically via the Skill tool
- `allowed-tools` — restricts which tools are available when this skill runs
- `context: fork` — skill runs in an isolated subagent context
- `agent` — delegates skill execution to a named subagent

#### Skills Schema Diff Table

| Field / Behavior | OpenCode | Claude Code | Transform Required |
|---|---|---|---|
| Global dir | `~/.config/opencode/skills/` | `~/.claude/skills/` | copy from opencode-only path |
| Project dir | `.opencode/skills/` | `.claude/skills/` | copy from opencode-only path |
| **Shared global dir** | `~/.claude/skills/` ✓ | `~/.claude/skills/` ✓ | **no sync needed** |
| **Shared project dir** | `.claude/skills/` ✓ | `.claude/skills/` ✓ | **no sync needed** |
| File name | `SKILL.md` (case-sensitive) | `SKILL.md` | none |
| `name` | required | optional (recommended) | none |
| `description` | human-readable summary | **invocation trigger hint** — must describe *when* to invoke | review; no auto-transform |
| `license`, `compatibility`, `metadata` | OpenCode extras | silently ignored | harmless; copy as-is |
| `argument-hint` | not supported | shown in autocomplete | Claude-only; no source |
| `disable-model-invocation` | not supported (`deny` permission instead) | prevents auto-invoke | Claude-only; no source |
| `user-invocable` | not supported | hides from `/` menu | Claude-only; no source |
| `allowed-tools` | not supported | restricts tool access | Claude-only; no source |
| `model` | not supported in skills | model for skill execution | Claude-only; no source |
| `context` | not supported | fork into subagent | Claude-only; no source |
| `agent` | not supported | delegate to named subagent | Claude-only; no source |
| `$ARGUMENTS` in body | not supported | substituted at invocation | Claude-only; harmless if present |
| Invocation trigger | `mode: "subagent"` agent definition | `/skill-name` slash command | no transform; different mechanism |
| Name uniqueness | enforced across all locations | per-directory | warn on duplicates during sync |

#### Sync Strategy

**Only sync from `~/.config/opencode/skills/`** (OpenCode-exclusive global path) → `~/.claude/skills/`.
Skills already in `~/.claude/skills/` are natively visible to OpenCode — no action needed.
Sync is a **pure file copy** — body and core fields are fully compatible.
The only non-automatable concern: `description` quality (trigger hint vs. summary).

---

## Sync Targets Summary (Claude Adapter)

| Sync Type | Source | Target | Adapter | Notes |
|---|---|---|---|---|
| MCPs | `opencode.jsonc` → `mcp` | `~/.claude.json` → `mcpServers` | `ClaudeAdapter` | JSON merge, schema transform |
| Agents (JSON) | `opencode.jsonc` → `agent` | `~/.claude/agents/<name>.md` | `ClaudeAgentAdapter` | model + tools transform |
| Agents (MD) | `~/.config/opencode/agents/*.md` | `~/.claude/agents/<name>.md` | `ClaudeAgentAdapter` | frontmatter transform |
| Skills | `~/.config/opencode/skills/*/SKILL.md` | `~/.claude/skills/*/SKILL.md` | `ClaudeSkillAdapter` | pure file copy |
| Skills (shared) | `~/.claude/skills/` | `~/.claude/skills/` | — | natively shared; no sync needed |

---

## Design Principles

1. **Strict Separation of Concerns**: Watcher engine contains no translation logic
2. **Non-Destructive Merging**: Adapters read existing target files and merge new MCP data without overwriting unrelated settings
3. **Graceful Error Handling**: Invalid JSON/JSONC in source or target files logs errors without crashing the daemon
4. **Env Resolution**: `{env:VAR}` templates resolved at sync time; missing vars logged as warnings

---

## Phased Implementation Plan

### Phase 1: Project Scaffolding & Interfaces
- [x] Initialize `package.json` and `tsconfig.json`
- [x] Add `jsonc-parser` dependency for JSONC parsing
- [x] Define generic `ProviderAdapter<T>` TypeScript interface
- [x] Implement utility functions for cross-platform home directory resolution (`~`)
- [x] Implement `{env:VAR}` template resolver utility
- [x] Implement `{file:./path}` file-reference resolver utility

### Phase 2: MCP Adapter
- [x] Implement `ClaudeAdapter` for MCP server sync
- [x] Transform: `mcp` → `mcpServers`, `"local"` → `"stdio"`, `"remote"` → `"http"`
- [x] Transform: command array → `command` string + `args` array
- [x] Transform: `environment` → `env`
- [x] Resolve `{env:VAR}` in values and headers at sync time
- [x] Skip servers with `enabled: false`
- [x] Skip + warn servers with `oauth` config (no Claude equivalent)
- [x] Implement safe read-merge-write to `~/.claude.json` (preserve non-MCP keys)

### Phase 3: Agent Adapter
- [x] Implement `ClaudeAgentAdapter`
- [x] Watch both `opencode.jsonc` (`agent` key) AND `~/.config/opencode/agents/*.md`
- [x] For JSON agents: resolve `{file:./path}` prompt refs OR use inline string as body
- [x] For MD agents: read frontmatter + body directly
- [x] Route `mode: "subagent"` → `~/.claude/skills/<name>/SKILL.md`
- [x] Route `mode: "primary"` / absent → `~/.claude/agents/<name>.md`
- [x] Ensure `description` exists; warn if absent (required by Claude Code)
- [x] Map `model`: `anthropic/X` → strip prefix + alias; non-Anthropic → `inherit` + warn
- [x] Map `tools` object: filter `true` → PascalCase → join `, `; omit if all enabled; `""` if all disabled
- [x] Drop `temperature` (log warning); drop `default_agent` (log info)
- [x] Preserve existing Claude-only fields (`skills`, `permissionMode`, etc.) on non-destructive merge
- [x] Handle deletion: remove target `.md` when agent removed from source

### Phase 4: Skills Adapter
- [x] Implement `ClaudeSkillAdapter`
- [x] Watch **only** `~/.config/opencode/skills/` (OpenCode-exclusive path)
- [x] Skip `~/.claude/skills/` as source — already natively shared with Claude Code
- [x] Copy changed `SKILL.md` files to `~/.claude/skills/<name>/SKILL.md` (pure file sync)
- [x] Warn on duplicate skill names across sync locations
- [x] Handle deletions: remove corresponding file in target

### Phase 5: Core Engine (Watcher)
- [x] Implement `SyncEngine` class
- [x] Integrate chokidar watching `opencode.jsonc` + `agents/` + `skills/` dirs
- [x] Add debouncer (500ms) to prevent rapid re-triggers on file saves
- [x] Orchestrate all three adapters on relevant file changes

### Phase 6: CLI Entry & Execution
- [x] Create `index.ts` to wire up Engine and all Adapters
- [x] Add npm scripts: `dev`, `build`, `start`
- [x] Test cross-platform compatibility

---

## Gotchas & Edge Cases

1. **JSONC**: source file is `opencode.jsonc` (has comments) — `JSON.parse()` will throw; use `jsonc-parser`
2. **`{env:VAR}` templates**: resolve at sync time, not load time; log warning if var undefined
3. **`oauth` MCPs**: no Claude equivalent — skip and warn user; do not crash
4. **`type: "remote"` ambiguity**: cannot detect SSE vs streamable HTTP from URL alone; default to `"http"`, allow override via relay-level config
5. **URL path differences**: some servers use `/sse` for OpenCode and `/mcp` for Claude (e.g. Atlassian); this requires user-configured URL overrides per server
6. **Prompt file frontmatter collision**: if prompt `.md` file has a `description` AND the agent JSON has different metadata, agent JSON wins
7. **File permissions**: `~/.claude.json` may not exist; create with mode `0600`; `~/.claude/agents/` and `~/.claude/skills/` may not exist; `mkdir -p` before writing
8. **Deleted agents/skills**: when an agent is removed from `opencode.jsonc`, the corresponding `~/.claude/agents/<name>.md` should be deleted (track what was synced last)
9. **Two agent source formats**: JSON in `opencode.jsonc` and MD in `~/.config/opencode/agents/`; both must be watched and handled
10. **`mode: "subagent"` in MD agents**: OpenCode MD agent files can declare `mode: subagent` — these must be routed to `~/.claude/skills/` not `~/.claude/agents/`
11. **`temperature` is valid in OpenCode MD agents** but NOT in Claude Code agents — common source of confusion; must be dropped with a warning
12. **`description` required by Claude**: OpenCode agents often omit it (it's optional there); Claude requires it — write `""` and warn rather than crash
13. **Skills shared dirs**: `~/.claude/skills/` and `.claude/skills/` are already scanned by OpenCode natively — never sync FROM these paths or you'll create circular updates
14. **Skill name uniqueness**: OpenCode enforces uniqueness across all scan locations; if a skill exists in both `~/.config/opencode/skills/` and `~/.claude/skills/`, the relay's copy will create a duplicate — detect and warn
15. **`disable-model-invocation` and `user-invocable`**: Claude Code skill features with no OpenCode equivalent; if already present in target skill file, preserve on copy
16. **`$ARGUMENTS` in skill body**: Claude Code substitutes this at invocation; OpenCode ignores it — harmless to copy as-is
