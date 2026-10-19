import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StepResult } from './platform.js';

/**
 * Install/inspect the orchestration plugin — the role agents and session
 * policy under `plugin/` — through the `claude` CLI's own plugin commands.
 *
 * Installed from the GitHub marketplace rather than from the npm package's
 * copy of `plugin/`: what `claude plugin marketplace add <dir>` does with a
 * directory inside a global `node_modules` (and on `npm update -g`) is not
 * documented, while the GitHub form is, and it updates with
 * `claude plugin marketplace update`. The package still ships `plugin/` so
 * `claude --plugin-dir` works for development and the sandbox.
 */
export const PLUGIN_NAME = 'claude-router';
export const MARKETPLACE_NAME = 'claude-router';
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
export const MARKETPLACE_SOURCE = 'smoochy/Claude-router';

export interface ExecResult {
  ok: boolean;
  output: string;
}
/** Runs `claude <args>`; injectable so the install flow is testable without the CLI. */
export type Exec = (args: string[]) => ExecResult;

/**
 * One cmd.exe command line for a `.cmd` shim. Node refuses to spawn `.cmd`
 * without a shell, but `shell: true` plus an args array concatenates the args
 * unescaped (DEP0190). So the shell gets a single string whose words are
 * double-quoted here. Rejected: `"%^&|<>!` and line breaks (`!` expands inside
 * quotes under delayed expansion). Backslashes before the closing quote are
 * doubled so the target's argv parser does not read `\"` as a literal quote.
 * Keep in sync with the copy in plugin/hooks/sessionstart.js.
 */
export function winCmdLine(bin: string, args: string[]): string {
  const q = (a: string) => {
    if (/["%^&|<>!\r\n]/.test(a)) throw new Error(`unsafe argument for cmd.exe: ${a}`);
    return /^[\w./:@=+-]+$/.test(a) ? a : `"${a.replace(/\\+$/, (m) => m + m)}"`;
  };
  return [bin, ...args].map(q).join(' ');
}

type ExecOpts = { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'pipe']; timeout: number };
interface WinRunners {
  file: (bin: string, args: string[], opts: ExecOpts) => string;
  shell: (cmd: string, opts: ExecOpts) => string;
}

/**
 * Windows: a native install ships only `claude.exe` (no shell needed), an npm install only the `claude.cmd` shim
 * (cmd.exe). Try the exe first and fall back to the shim only when the exe is not on PATH (ENOENT).
 */
export function runClaudeWin(
  args: string[],
  opts: Partial<ExecOpts> = {},
  run: WinRunners = { file: (b, a, o) => execFileSync(b, a, o), shell: (c, o) => execSync(c, o) },
): string {
  const o = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], timeout: 60_000, ...opts };
  try {
    return run.file('claude.exe', args, o);
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
    return run.shell(winCmdLine('claude.cmd', args), o);
  }
}

export function defaultExec(args: string[]): ExecResult {
  try {
    const opts = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], timeout: 60_000 };
    const output = process.platform === 'win32' ? runClaudeWin(args, opts) : execFileSync('claude', args, opts);
    return { ok: true, output: output.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim() };
  }
}

export function claudeAvailable(exec: Exec = defaultExec): boolean {
  return exec(['--version']).ok;
}

const MANUAL = `claude plugin marketplace add --scope user ${MARKETPLACE_SOURCE} && claude plugin install --scope user ${PLUGIN_ID}`;

/**
 * `claude plugin marketplace add` leaves autoUpdate off for a third-party marketplace and has no flag for it.
 * The non-interactive switch is the `extraKnownMarketplaces` entry in settings.json. Returns a warning, or null.
 * Without it the plugin (and its session-start hook, the daemon's fail-guard) never updates.
 */
function enableMarketplaceAutoUpdate(settingsFile: string): string | null {
  const manual = `set extraKnownMarketplaces.${MARKETPLACE_NAME}.autoUpdate to true in ${settingsFile}, or toggle it in /plugin`;
  try {
    const settings = fs.existsSync(settingsFile) ? (JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, any>) : {};
    const known = (settings['extraKnownMarketplaces'] ??= {});
    const entry = (known[MARKETPLACE_NAME] ??= { source: { source: 'github', repo: MARKETPLACE_SOURCE } });
    entry.autoUpdate = true;
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
    return null;
  } catch (err) {
    return `marketplace autoUpdate not enabled (${firstLine(String(err))}); ${manual}`;
  }
}

export function installPolicyPlugin(exec: Exec = defaultExec, settingsFile?: string): StepResult {
  if (!claudeAvailable(exec)) {
    return { ok: false, skipped: true, detail: `Orchestration plugin skipped: \`claude\` is not on PATH. Later: ${MANUAL}` };
  }
  const add = exec(['plugin', 'marketplace', 'add', '--scope', 'user', MARKETPLACE_SOURCE]);
  // Re-adding a known marketplace is not a failure; only an unknown error is.
  if (!add.ok && !/already/i.test(add.output)) {
    return { ok: false, detail: `Could not add the ${MARKETPLACE_NAME} marketplace: ${firstLine(add.output)}` };
  }
  const install = exec(['plugin', 'install', '--scope', 'user', PLUGIN_ID]);
  if (!install.ok && !/already/i.test(install.output)) {
    return { ok: false, detail: `Could not install ${PLUGIN_ID}: ${firstLine(install.output)}` };
  }
  const warn = settingsFile ? enableMarketplaceAutoUpdate(settingsFile) : null;
  return { ok: true, detail: `Orchestration plugin installed (${PLUGIN_ID}) — restart Claude Code to load it${warn ? `. Warning: ${warn}` : ''}` };
}

export function uninstallPolicyPlugin(exec: Exec = defaultExec, status: PolicyPluginStatus = policyPluginStatus(), settingsFile?: string): StepResult {
  if (!claudeAvailable(exec)) {
    return { ok: false, skipped: true, detail: `Orchestration plugin left in place: \`claude\` is not on PATH` };
  }
  const id = status.id ?? PLUGIN_ID;
  const result = exec(['plugin', 'uninstall', '--scope', 'user', id]);
  if (!result.ok && !/not installed|not found/i.test(result.output)) {
    return { ok: false, detail: `Could not uninstall ${id}: ${firstLine(result.output)}` };
  }
  if (settingsFile) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, any>;
      if (settings['extraKnownMarketplaces']?.[MARKETPLACE_NAME]) {
        delete settings['extraKnownMarketplaces'][MARKETPLACE_NAME];
        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
      }
    } catch { /* no or unreadable settings: nothing of ours to remove */ }
  }
  return { ok: true, detail: `Orchestration plugin removed (${id})` };
}

export interface PolicyPluginStatus {
  installed: boolean;
  /** Full `claude-router@<marketplace>` id as registered, or null. */
  id: string | null;
  marketplace: string | null;
  version: string | null;
  installPath: string | null;
}

const NOT_INSTALLED: PolicyPluginStatus = { installed: false, id: null, marketplace: null, version: null, installPath: null };

/** Read Claude Code's plugin registry directly — no CLI needed for `status`/`doctor`. */
export function policyPluginStatus(
  pluginsDir: string = path.join(process.env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude'), 'plugins'),
): PolicyPluginStatus {
  try {
    const raw = fs.readFileSync(path.join(pluginsDir, 'installed_plugins.json'), 'utf8');
    const registry = JSON.parse(raw) as { plugins?: Record<string, Array<{ version?: string; installPath?: string }>> };
    // Match the plugin name across marketplaces: it may have been added from
    // another marketplace than the one this package installs from.
    const plugins = registry.plugins ?? {};
    const id = [PLUGIN_ID, ...Object.keys(plugins)].find(
      (k) => (k === PLUGIN_ID || k.startsWith(`${PLUGIN_NAME}@`)) && Array.isArray(plugins[k]) && plugins[k]![0],
    );
    const entry = id ? plugins[id]![0] : undefined;
    if (!id || !entry) return NOT_INSTALLED;
    return { installed: true, id, marketplace: id.slice(PLUGIN_NAME.length + 1), version: entry.version ?? null, installPath: entry.installPath ?? null };
  } catch {
    return NOT_INSTALLED;
  }
}

function firstLine(s: string): string {
  return s.split('\n').find((l) => l.trim()) ?? '(no output)';
}
