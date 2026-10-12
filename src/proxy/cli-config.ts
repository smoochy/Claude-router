import { warnDeadRoutingKeys } from '../routing.js';
import { ROLES, invalidRoleMappings } from '../roles.js';
import { TIER_ORDER } from '../models.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_UPSTREAM, type Provider } from './handler.js';
import type { ModelPricing, RoutingTuning, Tier } from '../types.js';

// ── Paths ──────────────────────────────────────────────────────────────────

export interface RouterPaths {
  configDir: string;
  configFile: string;
  daemonStateFile: string;
  logFile: string;
  historyFile: string;
  plistFile: string;
  claudeSettingsFile: string;
  zshrcFile: string;
  bashrcFile: string;
  /** Persisted streak used by the delegation-pattern-drift alarm — see
   * src/proxy/delegation.ts's `DelegationDriftState`. Not a secret on its own
   * (just a counter), but kept 0600 like the rest of this directory. */
  delegationDriftFile: string;
  /** Written only when `--capture-system-prompt` is on (off by default). Holds
   * a full, unredacted Claude Code `system` prompt the moment it is captured —
   * treat it like a secret, delete it once you've copied what you need. See
   * the flag's own help text in OPTIONS below. */
  captureSystemPromptFile: string;
}

export function routerPaths(homeDir: string = os.homedir()): RouterPaths {
  const configDir = path.join(homeDir, '.claude-router');
  return {
    configDir,
    configFile: path.join(configDir, 'config.json'),
    daemonStateFile: path.join(configDir, 'daemon.json'),
    logFile: path.join(configDir, 'proxy.log'),
    historyFile: path.join(configDir, 'history.jsonl'),
    plistFile: path.join(homeDir, 'Library', 'LaunchAgents', 'com.claude-router.proxy.plist'),
    claudeSettingsFile: path.join(homeDir, '.claude', 'settings.json'),
    zshrcFile: path.join(homeDir, '.zshrc'),
    bashrcFile: path.join(homeDir, '.bashrc'),
    delegationDriftFile: path.join(configDir, 'delegation-drift.json'),
    captureSystemPromptFile: path.join(configDir, 'captured-system-prompt.json'),
  };
}

export const PLIST_LABEL = 'com.claude-router.proxy';

// ── Config file ────────────────────────────────────────────────────────────

/** Shape of ~/.claude-router/config.json. Every field optional; CLI flags win. */
export type RoutingMode = 'route' | 'observe' | 'off';

export interface FileConfig {
  port?: number;
  /** Bind address (default 127.0.0.1 — use 0.0.0.0 to expose on the network) */
  host?: string;
  verbose?: boolean;
  classifier?: 'heuristic' | 'ai' | 'hybrid';
  provider?: Provider;
  region?: string;
  /**
   * `route` — the router picks the tier (today's `forceRoute: true`).
   * `observe` — the client's model choice passes through untouched; every
   * request is still recorded (today's `forceRoute: false`).
   * `off` — no routing and no recording.
   *
   * `forceRoute` stays as a backwards-compatible alias so
   * config.json files written before this field existed keep working:
   * `true` -> `route`, `false` -> `observe`. See {@link routingModeFromForceRoute}.
   */
  routingMode?: RoutingMode;
  /** @deprecated Alias for `routingMode` — `true` -> `route`, `false` -> `observe`. */
  forceRoute?: boolean;
  /**
   * Where requests actually go (default `https://api.anthropic.com`). Point it at
   * a stub to exercise the proxy without credentials or spend. Never inherited
   * from the environment — see `DEFAULT_UPSTREAM`.
   */
  upstream?: string;
  /**
   * Pin the Claude Code coordinator session (the main interactive session, which
   * sends no x-claude-code-agent-id header) to this tier, bypassing the classifier
   * for it. Subagents still route by evidence. Only takes effect under forceRoute.
   */
  sessionModel?: Tier;
  /**
   * Remove Claude Code's injected anti-delegation lines from the system prompt so
   * subagents can be spawned again. Off by default — this is the one place the
   * proxy edits a prompt. Only takes effect under forceRoute.
   */
  restoreDelegation?: boolean;
  /**
   * Opt-in diagnostic: on the next request that carries tools, write its raw
   * `system` field to `~/.claude-router/captured-system-prompt.json` (one
   * fixed, server-chosen path — never a client-supplied name) and stop. Off
   * by default and never flipped on by this file's own scaffolded defaults —
   * the written file is a full, unredacted Claude Code system prompt. Exists
   * to re-cut `src/proxy/delegation.ts`'s patterns against current wording
   * (see #4304); delete the file once you've copied what you need from it.
   */
  captureSystemPrompt?: boolean;
  /**
   * Route Claude Code subagents by role (default `'on'`): marker, `agents`
   * mapping, or read-only tool shape in the cheap direction. `'off'` classifies
   * subagents like any other request (the inferred role is still recorded).
   */
  roleRouting?: 'on' | 'off';
  /** Per-role tier overrides, e.g. `{ "builder": "opus" }`. Roles: recon, builder, batch, gate, audit. */
  roles?: Partial<Record<string, Tier>>;
  /** Pin third-party agents by Claude Code agent type, e.g. `{ "my-plugin:reviewer": "opus" }`. */
  agents?: Record<string, Tier>;
  /** Override the model ID used for each tier. */
  tiers?: Partial<Record<Tier, string>>;
  /** Override pricing ($/1M tokens) for savings math, keyed by model ID. */
  pricing?: Record<string, ModelPricing>;
  /** Classifier thresholds/band/timeout/cache tuning. */
  routing?: RoutingTuning;
}

/** `forceRoute` -> `routingMode`, per the alias contract on {@link FileConfig.routingMode}. */
export function routingModeFromForceRoute(forceRoute: boolean): RoutingMode {
  return forceRoute ? 'route' : 'observe';
}

export interface LoadedFileConfig {
  config: FileConfig;
  loaded: boolean;
  error?: string;
}

export function loadFileConfig(configFile: string = routerPaths().configFile): LoadedFileConfig {
  if (!fs.existsSync(configFile)) return { config: {}, loaded: false };
  try {
    return { config: JSON.parse(fs.readFileSync(configFile, 'utf8')) as FileConfig, loaded: true };
  } catch (err) {
    return { config: {}, loaded: false, error: String(err) };
  }
}

// ── Serve options ──────────────────────────────────────────────────────────

export interface ServeOptions {
  port: number;
  host: string;
  verbose: boolean;
  classifier: 'heuristic' | 'ai' | 'hybrid';
  provider: Provider;
  region: string;
  routingMode: RoutingMode;
  /** @deprecated Derived from `routingMode` (`route` -> true) — kept for callers that still check the boolean. */
  forceRoute: boolean;
  upstream: string;
  /** '' = disabled (classify every request); a tier name pins the coordinator. */
  sessionModel: string;
  /** Strip the client's injected anti-delegation lines (routed path only). */
  restoreDelegation: boolean;
  /** Opt-in: capture the next tool-bearing request's raw system prompt to disk. See FileConfig.captureSystemPrompt. */
  captureSystemPrompt: boolean;
  /** 'on' | 'off' — see FileConfig.roleRouting. */
  roleRouting: string;
  roles?: Partial<Record<string, Tier>>;
  agents?: Record<string, Tier>;
  tiers?: Partial<Record<Tier, string>>;
  pricing?: Record<string, ModelPricing>;
  routing?: RoutingTuning;
}

/** Thrown for user-facing argument errors; the CLI prints it red and exits 1. */
export class CliUsageError extends Error {}

const DEFAULT_HOST = '127.0.0.1';
const TIER_NAMES = 'haiku | sonnet | opus | fable';

type OptionKind =
  | { type: 'number'; min: number; max: number }
  | { type: 'string' }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'boolean' };

/**
 * One row per serve option. This single table drives parsing, re-serialization
 * (`serveArgsFrom`), and config scaffolding (`configFromOptions`) — so a new flag
 * is one row, not five parallel hand-written lists. `emit`/`config` predicates
 * key off `default`, so a value and "when to omit it" can never disagree.
 */
interface OptionSpec {
  /** Corresponding key on ServeOptions / FileConfig. */
  key: 'port' | 'host' | 'verbose' | 'classifier' | 'provider' | 'region' | 'forceRoute' | 'routingMode' | 'upstream' | 'sessionModel' | 'restoreDelegation' | 'captureSystemPrompt' | 'roleRouting';
  flags: string[];
  kind: OptionKind;
  default: string | number | boolean;
  /** One line for `claude-router help`. Enum values and the default are appended by the renderer. */
  help: string;
  /** Placeholder for the flag's argument in help (`<port>`); omitted for booleans. */
  arg?: string;
  /** Always emit as a spawn arg (else only when non-default). */
  argAlways?: boolean;
  /** Always include in the scaffolded config.json (else only when non-default). */
  configAlways?: boolean;
}

export const OPTIONS: readonly OptionSpec[] = [
  { key: 'port',       flags: ['--port', '-p'],    kind: { type: 'number', min: 1, max: 65535 }, default: 4000, argAlways: true, configAlways: true,
    arg: 'number', help: 'Port' },
  { key: 'host',       flags: ['--host'],          kind: { type: 'string' },                     default: DEFAULT_HOST,
    arg: 'address', help: 'Bind address — 127.0.0.1 is local only; 0.0.0.0 exposes the proxy to the network' },
  { key: 'routingMode', flags: ['--routing-mode'], kind: { type: 'enum', values: ['route', 'observe', 'off'] }, default: 'route', configAlways: true,
    arg: 'mode', help: '`route` routes, `observe` passes through and still records, `off` passes through and records nothing' },
  // Deprecated alias for routingMode (true -> route, false -> observe). Kept for
  // scripts/configs written before routingMode existed; see parseServeArgs.
  { key: 'forceRoute', flags: ['--force-route'],   kind: { type: 'boolean' },                    default: true, configAlways: true,
    help: 'Deprecated alias for --routing-mode route — required for Claude Code' },
  { key: 'verbose',    flags: ['--verbose', '-v'], kind: { type: 'boolean' },                    default: false, configAlways: true,
    help: 'Log each routing decision' },
  { key: 'classifier', flags: ['--classifier'],    kind: { type: 'enum', values: ['heuristic', 'ai', 'hybrid'] }, default: 'hybrid', configAlways: true,
    arg: 'mode', help: 'How a tier is chosen' },
  { key: 'provider',   flags: ['--provider'],      kind: { type: 'enum', values: ['anthropic', 'bedrock', 'vertex'] }, default: 'anthropic', configAlways: true,
    arg: 'name', help: 'API provider' },
  { key: 'region',     flags: ['--region'],        kind: { type: 'string' },                     default: '',
    arg: 'string', help: 'AWS/GCP region (bedrock/vertex)' },
  // Explicit only — never inherited from the environment. See DEFAULT_UPSTREAM.
  { key: 'upstream',   flags: ['--upstream'],      kind: { type: 'string' },                     default: DEFAULT_UPSTREAM,
    arg: 'url', help: 'Where routed and passed-through requests go — testing only, never read from the environment' },
  // Empty default = disabled. A tier name pins the Claude Code coordinator session.
  { key: 'sessionModel', flags: ['--session-model'], kind: { type: 'enum', values: ['haiku', 'sonnet', 'opus', 'fable'] }, default: '',
    arg: 'tier', help: 'Pin the Claude Code main session to one tier; subagents still route by evidence (needs --force-route)' },
  // On by default (the one place the proxy edits a prompt, and only under route). See src/proxy/delegation.ts.
  { key: 'restoreDelegation', flags: ['--restore-delegation'], kind: { type: 'boolean' }, default: true, configAlways: true,
    help: 'Strip the injected "do not spawn agents" lines so a pinned session can still delegate' },
  // Off by default, and configAlways is deliberately absent: a scaffolded
  // config.json never mentions this key unless someone turned it on. The file
  // it writes holds a full system prompt — see cli-config.ts's FileConfig doc.
  { key: 'captureSystemPrompt', flags: ['--capture-system-prompt'], kind: { type: 'boolean' }, default: false,
    help: 'One-shot diagnostic: write the next tool-bearing request\'s raw system prompt to ~/.claude-router/captured-system-prompt.json, then stop (file holds a FULL system prompt — treat it as a secret)' },
  // An enum rather than a boolean: the table's booleans can only be switched on,
  // and "off" is the interesting value here (the A/B baseline for the ledger).
  { key: 'roleRouting', flags: ['--role-routing'], kind: { type: 'enum', values: ['on', 'off'] }, default: 'on',
    arg: 'on|off', help: 'Route Claude Code subagents by role — marker, agents mapping, or read-only tool shape (needs --force-route)' },
];

/**
 * The `Options` block of `claude-router help`, rendered from OPTIONS so a flag
 * cannot exist without a help line — `--session-model` and `--upstream` shipped
 * with no mention in `help`, because the text was a second hand-written copy of
 * the table.
 */
export function helpOptionLines(): string[] {
  const width = 26;
  return OPTIONS.map((spec) => {
    const left = `${spec.flags.join(', ')}${spec.arg ? ` <${spec.arg}>` : ''}`;
    const values = spec.kind.type === 'enum' ? `${spec.kind.values.join(' | ')}` : '';
    const dflt = spec.default === '' || spec.default === false ? '' : `default: ${String(spec.default)}`;
    const tail = [values, dflt].filter(Boolean).join('; ');
    return `  ${left.padEnd(width)} ${spec.help}${tail ? ` (${tail})` : ''}`;
  });
}

/** Validate and convert a flag's raw argument per its declared kind. */
function coerce(spec: OptionSpec, raw: string | undefined): string | number | boolean {
  const k = spec.kind;
  if (k.type === 'number') {
    const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
    if (isNaN(parsed) || parsed < k.min || parsed > k.max) {
      throw new CliUsageError(`Invalid ${spec.key}: ${raw ?? '(missing)'}. Must be ${k.min}-${k.max}.`);
    }
    return parsed;
  }
  if (k.type === 'enum') {
    if (raw !== undefined && k.values.includes(raw)) return raw;
    throw new CliUsageError(`Invalid ${spec.key}: ${raw ?? '(missing)'}. Must be ${k.values.join(' | ')}.`);
  }
  // string
  if (!raw) throw new CliUsageError(`Missing value for ${spec.flags[0]}.`);
  return raw;
}

/**
 * Parse start/install flags. File config supplies defaults; flags override.
 * Throws CliUsageError on invalid or unknown flags.
 */
export function parseServeArgs(args: string[], file: FileConfig = {}): ServeOptions {
  const values: Record<string, string | number | boolean> = {};
  // Alias: a file with `forceRoute` but no `routingMode` of its own picks the
  // routingMode default — covers config.json files
  // written before routingMode existed.
  const fileRoutingModeDefault = file.routingMode ?? (file.forceRoute !== undefined ? routingModeFromForceRoute(file.forceRoute) : undefined);
  for (const spec of OPTIONS) {
    if (spec.key === 'routingMode') {
      values.routingMode = fileRoutingModeDefault ?? spec.default;
      continue;
    }
    const fromFile = (file as Record<string, unknown>)[spec.key];
    values[spec.key] = (fromFile ?? spec.default) as string | number | boolean;
  }

  const explicitlySet = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const spec = OPTIONS.find((o) => o.flags.includes(arg));
    if (!spec) {
      throw new CliUsageError(`Unknown option '${arg}'. Run 'claude-router help' for usage.`);
    }
    explicitlySet.add(spec.key);
    if (spec.kind.type === 'boolean') {
      values[spec.key] = true;
    } else {
      values[spec.key] = coerce(spec, args[++i]);
    }
  }

  // The CLI flag alias: --force-route without an explicit --routing-mode picks
  // the mode it used to mean. routingMode is then the single source of truth —
  // forceRoute is recomputed from it so the two can never disagree.
  if (explicitlySet.has('forceRoute') && !explicitlySet.has('routingMode')) {
    values.routingMode = routingModeFromForceRoute(values.forceRoute as boolean);
  }
  values.forceRoute = values.routingMode === 'route';

  // The config file is where these keys actually live for most users, so this
  // is the call site that matters. Warn after parsing, before the proxy starts.
  warnDeadRoutingKeys(file.routing as Record<string, unknown> | undefined);
  // A mapping to a non-tier is skipped at routing time (never `model: undefined`);
  // say so once here rather than letting a typo silently route by shape instead.
  for (const [name, mapping] of [['roles', file.roles], ['agents', file.agents]] as const) {
    for (const bad of invalidRoleMappings(mapping as Record<string, unknown> | undefined)) {
      console.warn(`[claude-router] config ${name}.${bad} is not a tier (${TIER_NAMES}) and will be ignored.`);
    }
  }

  return {
    ...(values as unknown as Omit<ServeOptions, 'tiers' | 'pricing' | 'routing' | 'roles' | 'agents'>),
    tiers: file.tiers,
    pricing: file.pricing,
    routing: file.routing,
    roles: file.roles,
    agents: file.agents,
  };
}

/** Region flags map onto the provider SDK env vars unless already set. */
export function applyRegionEnv(options: Pick<ServeOptions, 'provider' | 'region'>): void {
  if (!options.region) return;
  if (options.provider === 'bedrock' && !process.env['AWS_REGION']) {
    process.env['AWS_REGION'] = options.region;
  } else if (options.provider === 'vertex' && !process.env['ANTHROPIC_VERTEX_REGION']) {
    process.env['ANTHROPIC_VERTEX_REGION'] = options.region;
  }
}

/** Serve flags to re-create these options in a spawned/registered process. */
export function serveArgsFrom(options: ServeOptions): string[] {
  const args: string[] = [];
  for (const spec of OPTIONS) {
    const value = (options as unknown as Record<string, unknown>)[spec.key];
    if (spec.key === 'forceRoute') continue; // derived alias of routingMode
    if (!(spec.argAlways || value !== spec.default)) continue;
    if (spec.kind.type === 'boolean') args.push(spec.flags[0]!);
    else args.push(spec.flags[0]!, String(value));
  }
  return args;
}

/** Build a scaffolded config.json from resolved options (drives `init`). */
export function configFromOptions(options: ServeOptions): FileConfig {
  const config: Record<string, unknown> = {};
  for (const spec of OPTIONS) {
    const value = (options as unknown as Record<string, unknown>)[spec.key];
    if (spec.configAlways || value !== spec.default) config[spec.key] = value;
  }
  return config as FileConfig;
}

// ── Version ────────────────────────────────────────────────────────────────

export function getVersion(): string {
  // Compiled output lives at dist/proxy/, so package.json is two levels up.
  // The project compiles to CJS, so __dirname is available.
  const pkgPath = path.join(__dirname, '..', '..', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch (err) {
    // 'unknown' in a banner, a /health payload or a bug report is a silent
    // degradation; say why once so a broken install layout is diagnosable.
    if (!versionReadFailureReported) {
      versionReadFailureReported = true;
      console.warn(`[claude-router] cannot read ${pkgPath}: ${String(err)} — version reported as "unknown"`);
    }
    return 'unknown';
  }
}
let versionReadFailureReported = false;

// ── Command suggestion ─────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length]![b.length]!;
}

/** Closest known command within edit distance 2, or null. */
export function suggestCommand(input: string, commands: string[]): string | null {
  let best: string | null = null;
  let bestDist = 3;
  for (const cmd of commands) {
    const d = levenshtein(input.toLowerCase(), cmd.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = cmd;
    }
  }
  return best;
}

// ── Unknown config keys ────────────────────────────────────────────────────

type OptionKey = (typeof OPTIONS)[number]['key'];

// Keys of FileConfig that are not CLI options. Typed against FileConfig so a
// new field fails to compile until it is listed here.
const OBJECT_KEYS: Record<Exclude<keyof FileConfig, OptionKey>, true> = {
  roles: true, agents: true, tiers: true, pricing: true, routing: true,
};

// Same exhaustiveness trick for the one nested object with no runtime key list.
const ROUTING_KEYS: Record<keyof RoutingTuning, true> = {
  haikuMax: true, opusMin: true, hybridBand: true, aiTimeoutMs: true,
  classifyCacheSize: true, allowHaikuInAgentic: true, allowFable: true,
};

export interface UnknownConfigKey {
  /** Dotted path, e.g. `restoreDekegation` or `routing.aiTimeout`. */
  path: string;
  /** The likely intended key (full path), when one is within edit distance 2. */
  suggestion: string | null;
}

/**
 * Keys in a parsed config.json the schema does not know. `agents` and `pricing`
 * are keyed by user-chosen names, so only their top-level presence is checked.
 */
export function unknownConfigKeys(raw: unknown): UnknownConfigKey[] {
  const result: UnknownConfigKey[] = [];
  const check = (obj: unknown, known: string[], prefix: string): void => {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return;
    for (const key of Object.keys(obj)) {
      if (known.includes(key)) continue;
      const near = suggestCommand(key, known);
      result.push({ path: prefix + key, suggestion: near ? prefix + near : null });
    }
  };
  check(raw, [...OPTIONS.map((o) => o.key as string), ...Object.keys(OBJECT_KEYS)], '');
  const cfg = (raw ?? {}) as Record<string, unknown>;
  check(cfg.roles, [...ROLES], 'roles.');
  check(cfg.tiers, [...TIER_ORDER], 'tiers.');
  check(cfg.routing, Object.keys(ROUTING_KEYS), 'routing.');
  return result;
}
