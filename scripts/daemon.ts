#!/usr/bin/env tsx
/**
 * Install or uninstall opencode-relay as a background daemon.
 *
 * macOS  → launchd user agent  (~/.Library/LaunchAgents/)
 * Linux  → systemd user unit   (~/.config/systemd/user/)
 *
 * Usage:
 *   npm run install-daemon
 *   npm run uninstall-daemon
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const NODE = process.execPath;
const ENTRY = join(ROOT, "dist/index.mjs");
const LABEL = "com.opencode-relay";
const SERVICE = "opencode-relay";

// ── macOS launchd ─────────────────────────────────────────────────────────────

function plistPath(): string {
	return join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
}

function plistContent(): string {
	const logDir = join(homedir(), "Library/Logs");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${ENTRY}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logDir}/${SERVICE}.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/${SERVICE}.err</string>
</dict>
</plist>
`;
}

function installMacos(): void {
	const path = plistPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, plistContent(), "utf8");
	run("launchctl", ["bootstrap", `gui/${process.getuid!()}`, path]);
	console.info(`[daemon] Installed and started via launchd.`);
	console.info(`[daemon] Logs: ~/Library/Logs/${SERVICE}.log`);
}

function uninstallMacos(): void {
	const path = plistPath();
	try {
		run("launchctl", ["bootout", `gui/${process.getuid!()}`, path]);
	} catch {
		// Already unloaded — continue to remove the file.
	}
	rmSync(path, { force: true });
	console.info(`[daemon] Removed launchd agent.`);
}

// ── Linux systemd ─────────────────────────────────────────────────────────────

function unitPath(): string {
	return join(
		homedir(),
		".config/systemd/user",
		`${SERVICE}.service`,
	);
}

function unitContent(): string {
	return `[Unit]
Description=OpenCode Relay — sync OpenCode config to Claude Code
After=default.target

[Service]
ExecStart=${NODE} ${ENTRY}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

function installLinux(): void {
	const path = unitPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, unitContent(), "utf8");
	run("systemctl", ["--user", "daemon-reload"]);
	run("systemctl", ["--user", "enable", "--now", SERVICE]);
	console.info(`[daemon] Installed and started via systemd.`);
	console.info(`[daemon] Logs: journalctl --user -u ${SERVICE} -f`);
}

function uninstallLinux(): void {
	run("systemctl", ["--user", "disable", "--now", SERVICE]);
	rmSync(unitPath(), { force: true });
	run("systemctl", ["--user", "daemon-reload"]);
	console.info(`[daemon] Removed systemd unit.`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd: string, args: string[]): void {
	execFileSync(cmd, args, { stdio: "inherit" });
}

function die(msg: string): never {
	console.error(`[daemon] ${msg}`);
	process.exit(1);
}

// ── Entry ─────────────────────────────────────────────────────────────────────

const [, , command] = process.argv;

if (command !== "install" && command !== "uninstall") {
	die(`Unknown command "${command}". Use "install" or "uninstall".`);
}

const { platform } = process;

if (platform === "darwin") {
	command === "install" ? installMacos() : uninstallMacos();
} else if (platform === "linux") {
	command === "install" ? installLinux() : uninstallLinux();
} else {
	die(`Unsupported platform "${platform}". Only macOS and Linux are supported.`);
}
