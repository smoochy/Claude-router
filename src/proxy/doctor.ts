import { term } from './term.js';
import { out, type OutputLine } from './command.js';
import type { HealthInfo } from './health.js';
import type { DaemonState } from './daemon.js';
import type { Tier } from '../types.js';

/**
 * `doctor`'s diagnostics as data.
 *
 * The checks used to be a closure that printed a glyph and incremented a
 * `failures` counter in the same statement, then `process.exit(failures)`. The
 * exit code is the contract CI consumes and nothing pinned it — and the
 * print-as-you-decide shape had already let one check's predicate drift from
 * its own label: with `--provider bedrock` and no API key, a green ✓ appeared
 * beside the text "ANTHROPIC_API_KEY not set".
 *
 * Deciding and rendering are separate here, so both are assertable.
 */
export interface Diagnostic {
  ok: boolean;
  label: string;
  /** Remediation shown under a failing check. */
  hint?: string;
  /** A warning is reported but does not count toward the exit code. */
  warnOnly?: boolean;
}

/**
 * Everything `doctor` inspects about the machine. One member per probe, each
 * called exactly once per run — the inline version evaluated
 * `isProcessAlive`/`isAutostartRegistered`/`isStatuslineConfigured` twice apiece
 * (once for the verdict, once for the label), which on Windows meant shelling
 * out to `reg query` twice per check.
 */
export interface DoctorProbes {
  nodeVersion: string;
  platform: string;
  loadConfig(): { loaded: boolean; error?: string };
  checkHealth(port: number): Promise<HealthInfo | null>;
  isEnvVarSet(port: number): boolean;
  /** Claude Code's own settings.json env points at the proxy (the install default). */
  isClaudeCodeEnvSet(port: number): boolean;
  apiKeySet(): boolean;
  daemonState(): DaemonState | null;
  isProcessAlive(pid: number): boolean;
  isAutostartRegistered(): boolean;
  isStatuslineConfigured(): boolean;
  policyPluginInstalled(): boolean;
  /** Where the installed plugin came from and its version; null when not installed. */
  policyPluginInfo?(): { marketplace: string; version: string | null } | null;
  packageVersion?(): string;
  /** Age in whole days of the local model-list cache (`model-list.ts`), or
   * `undefined` when no cache file exists yet (first run, or remote has never
   * failed). Not "how stale is the live list" — that has no date to read
   * (see `MODEL_LIST_URL`'s doc comment) — just "how long since this proxy
   * last reached the remote list". */
  modelListCacheAgeDays(): number | undefined;
  /** Configured tier ids that are a former built-in default (see `model-list.ts`'s
   * `staleTierIds`) - empty when none is, with the newest model of the family as the replacement. `undefined` is kept for a probe that
   * cannot run. */
  staleTierIds(): Promise<Array<{ tier: Tier; id: string; replacement?: string }> | undefined>;
  /** Has `restoreDelegation` matched nothing for `STALE_PATTERN_STREAK` starts
   * in a row (see src/proxy/delegation.ts)? `undefined` when `restoreDelegation`
   * is off — there is no streak to report on. */
  delegationPatternsStale(): boolean | undefined;
}

export interface DoctorOptions {
  port: number;
  provider: string;
  configFile: string;
}

export async function runDiagnostics(
  options: DoctorOptions,
  probes: DoctorProbes,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  // Floor must track package.json `engines.node` — a green doctor on a Node the
  // package refuses to install on is worse than no check.
  const [major] = probes.nodeVersion.split('.').map(Number);
  diagnostics.push({
    ok: (major ?? 0) >= 20,
    label: `Node ${probes.nodeVersion} (need ≥ 20)`,
  });

  // Informational only: a missing cache just means every start so far either
  // reached the remote list or ran on the snapshot fallback — neither is a
  // problem on its own, so there's nothing to warn about when it's absent.
  const cacheAge = probes.modelListCacheAgeDays();
  if (cacheAge !== undefined) {
    diagnostics.push({
      ok: true,
      label: `Model-list cache last refreshed ${cacheAge} day${cacheAge === 1 ? '' : 's'} ago`,
      warnOnly: true,
    });
  }

  // Same reasoning as the pricing-age check above, one layer down: this is the
  // model-id side of "the hand-written config may have drifted."
  const stale = await probes.staleTierIds();
  if (stale !== undefined) {
    diagnostics.push({
      ok: stale.length === 0,
      label: stale.length === 0
        ? 'No tier id is a stale former default'
        : `Stale tier id(s): ${stale.map((s) => `${s.tier}="${s.id}"${s.replacement ? ` (now ${s.replacement})` : ''}`).join(', ')} - a former default`,
      hint: 'Run "claude-router install" to rewrite the stale ids (start already routes to the replacement)',
      warnOnly: true,
    });
  }

  // Same "may be a previous generation" reasoning as staleTierIds above, one
  // layer further down: a vendor wording change rather than a stale config value.
  const delegationStale = probes.delegationPatternsStale();
  if (delegationStale !== undefined) {
    diagnostics.push({
      ok: !delegationStale,
      label: delegationStale
        ? 'restore-delegation has matched nothing for several starts in a row — the known lines may be stale'
        : 'restore-delegation is matching the current anti-delegation lines',
      hint: 'Capture a fresh prompt (claude-router start --capture-system-prompt) and refresh src/proxy/delegation.ts against it',
      warnOnly: true,
    });
  }

  const config = probes.loadConfig();
  diagnostics.push(
    config.error
      ? {
          ok: false,
          label: `Config file invalid: ${config.error}`,
          hint: 'Fix or regenerate: claude-router init --force',
        }
      : {
          ok: true,
          label: config.loaded
            ? `Config file loaded (${options.configFile})`
            : 'No config file (defaults in use)',
        },
  );

  const health = await probes.checkHealth(options.port);
  diagnostics.push({
    ok: health !== null,
    label: health
      ? `Proxy healthy on port ${options.port}`
      : `No proxy responding on port ${options.port}`,
    hint: 'Start it: claude-router start -d',
  });

  // Not pass/fail — routingMode is a deliberate choice (the three-mode
  // comparison runs `off` on purpose), so this just names the live mode, and
  // flags `off` since that one silently drops routing AND recording.
  if (health) {
    diagnostics.push({
      ok: health.routingMode !== 'off',
      label: `Routing mode: ${health.routingMode}${health.routingMode === 'off' ? ' (no routing, no recording)' : ''}`,
      warnOnly: true,
    });
  }

  // Either route counts: Claude Code's settings.json env (what `install` writes)
  // or the shell variable (api-only installs and SDK apps).
  const claudeEnvOk = probes.isClaudeCodeEnvSet(options.port);
  const envOk = probes.isEnvVarSet(options.port);
  diagnostics.push({
    ok: claudeEnvOk || envOk,
    label: claudeEnvOk
      ? 'Claude Code routes through the proxy (settings.json env)'
      : envOk
        ? 'ANTHROPIC_BASE_URL points at the proxy'
        : `Nothing points at the proxy (no settings.json env, ANTHROPIC_BASE_URL is not http://localhost:${options.port})`,
    hint: 'Run: claude-router install',
  });


  // The key is only required for the anthropic provider, so the verdict has two
  // ways to pass — and the label has to say which one applied, or a green tick
  // sits next to a sentence reporting a problem.
  const apiKeySet = probes.apiKeySet();
  const providerNeedsKey = options.provider === 'anthropic';
  diagnostics.push({
    ok: apiKeySet || !providerNeedsKey,
    label: apiKeySet
      ? 'ANTHROPIC_API_KEY is set'
      : providerNeedsKey
        ? 'ANTHROPIC_API_KEY not set (fine if Claude Code sends its own auth)'
        : `ANTHROPIC_API_KEY not set (not needed for the ${options.provider} provider)`,
    warnOnly: true,
  });

  const state = probes.daemonState();
  if (state) {
    const alive = probes.isProcessAlive(state.pid);
    diagnostics.push({
      ok: alive,
      label: alive
        ? `Daemon state matches a live process (pid ${state.pid})`
        : `Stale daemon state (pid ${state.pid} is gone)`,
      hint: 'Clear it by restarting: claude-router restart',
      warnOnly: true,
    });
  }

  const autostart = probes.isAutostartRegistered();
  diagnostics.push({
    ok: autostart,
    label: autostart ? 'Autostart registered' : 'Autostart not registered',
    hint: 'Register it: claude-router install',
    warnOnly: true,
  });

  const statusline = probes.isStatuslineConfigured();
  diagnostics.push({
    ok: statusline,
    label: statusline ? 'Claude Code statusline configured' : 'Statusline not configured',
    hint: 'Add it: claude-router install',
    warnOnly: true,
  });

  const plugin = probes.policyPluginInstalled();
  diagnostics.push({
    ok: plugin,
    label: plugin ? 'Orchestration plugin installed' : 'Orchestration plugin not installed',
    hint: 'Add it: claude-router policy install',
    warnOnly: true,
  });

  const info = plugin ? probes.policyPluginInfo?.() : null;
  const pkg = probes.packageVersion?.();
  if (info?.version && pkg && info.version !== pkg) {
    diagnostics.push({
      ok: false,
      label: `Orchestration plugin ${info.version} (from ${info.marketplace}) differs from package ${pkg}`,
      hint: `Update it: claude plugin marketplace update ${info.marketplace}`,
      warnOnly: true,
    });
  }

  return diagnostics;
}

/** The exit code: how many non-warning checks failed. Warnings never move it. */
export function failureCount(diagnostics: Diagnostic[]): number {
  return diagnostics.filter((d) => !d.ok && !d.warnOnly).length;
}

export function formatDiagnostics(diagnostics: Diagnostic[]): OutputLine[] {
  const lines: OutputLine[] = [];
  for (const d of diagnostics) {
    const glyph = d.ok ? term.ok() : d.warnOnly ? term.warn() : term.fail();
    lines.push(out(`  ${glyph} ${d.label}`));
    if (!d.ok && d.hint) lines.push(out(term.dim(`      ${d.hint}`)));
  }
  const failures = failureCount(diagnostics);
  lines.push(
    out(
      failures === 0
        ? `\n${term.ok()} Everything looks good.\n`
        : `\n${term.fail()} ${failures} problem(s) found.\n`,
    ),
  );
  return lines;
}
