import { join } from "node:path";

export const CONFIG = ".claude.json";
export const CONFIG_DIR = ".claude/";
export const AGENTS_DIR = join(CONFIG_DIR, "agents");
export const SKILLS_DIR = join(CONFIG_DIR, "skills");
