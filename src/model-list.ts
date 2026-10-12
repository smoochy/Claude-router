import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelPricing, Tier } from './types.js';
import { DEFAULT_PRICING, pricingTableFromList } from './models.js';

/**
 * `smoochy/openrouter-model-list`'s published Anthropic list. It is a **bare
 * JSON array**, sorted by `id` - deliberately no `generated_at`/`schema_version`
 * envelope, because adding one would break an existing consumer. Don't
 * wrap-expect it.
 */
export const MODEL_LIST_URL =
  'https://raw.githubusercontent.com/smoochy/openrouter-model-list/main/anthropic-models.json';

/** One entry's shape, trimmed to the fields this module reads. The list carries
 * many more (capabilities, lifecycle, ...) that the router has no use for. */
export interface ModelListEntry {
  id: string;
  created_at?: string;
  pricing?: {
    input: number;
    output: number;
    cache_read: number;
    cache_write_5m: number;
    cache_write_1h: number;
  };
  /** Optional upper tier above `threshold_input_tokens` prompt tokens. */
  pricing_long_context?: {
    threshold_input_tokens: number;
    input: number;
    output: number;
    cache_read: number;
    cache_write_5m?: number;
    cache_write_1h?: number;
  };
  [key: string]: unknown;
}

export interface ModelListResult {
  pricing: Record<string, ModelPricing>;
  /** Where this pricing came from — surfaced by `doctor` and the startup banner. */
  source: 'remote' | 'cache' | 'snapshot';
}

export function defaultModelListCachePath(): string {
  return path.join(os.homedir(), '.claude-router', 'model-list-cache.json');
}

function isModelListEntry(e: unknown): e is ModelListEntry {
  return typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string';
}

/** Loose validation on purpose: the list carries fields this module never reads
 * (capabilities, lifecycle, ...) and a schema addition there must not break us. */
function isModelList(data: unknown): data is ModelListEntry[] {
  return Array.isArray(data) && data.every(isModelListEntry);
}

/** Fetch the published list. Throws on a network error, a non-2xx, invalid
 * JSON, or a shape that fails {@link isModelList} — every failure path is the
 * caller's cue to fall back, never a half-trusted partial table. */
export async function fetchModelList(
  url: string = MODEL_LIST_URL,
  timeoutMs = 3000,
): Promise<ModelListEntry[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`model list fetch failed: HTTP ${res.status}`);
  const data: unknown = await res.json();
  if (!isModelList(data)) throw new Error('model list response has an unexpected shape');
  return data;
}

function readCache(cachePath: string): ModelListEntry[] | undefined {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return isModelList(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort: a cache write failure must never fail the startup it's caching for. */
function writeCache(cachePath: string, entries: ModelListEntry[]): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(entries));
  } catch {
    // ponytail: best-effort cache; a write failure just means no cache next time.
  }
}

/**
 * Ids that were a built-in `DEFAULT_MODELS` value in an earlier release. A tier
 * id equal to one of these is a stale default (a config written by an older
 * `install`); any other id is a deliberate pin and is never touched. Append the
 * outgoing id here whenever `DEFAULT_MODELS` moves.
 */
export const FORMER_DEFAULT_MODELS: Record<Tier, readonly string[]> = {
  haiku: ['claude-haiku-4-5', 'claude-haiku-4-5-20251001'],
  sonnet: ['claude-sonnet-4-6', 'claude-sonnet-5'],
  opus: ['claude-opus-4-6', 'claude-opus-4-8', 'claude-opus-5'],
  fable: ['claude-fable-5'],
};

/** Newest model of the tier's family. The pricing table is inserted oldest-first by `created_at`, so the last matching key wins. */
function newestOfFamily(tier: Tier, pricing: Record<string, ModelPricing>): string | undefined {
  return Object.keys(pricing).filter((id) => id.includes(tier)).pop();
}

export interface StaleTier {
  tier: Tier;
  id: string;
  /** Newest model of the same family, from the remote list, else the cache, else the built-in snapshot. */
  replacement: string;
}

/**
 * Configured tier ids that equal a former built-in default and have a newer
 * model in their family. Works on every source, snapshot included: the former
 * defaults are in code, and the snapshot orders the family by `created_at`.
 */
export function staleTierIds(
  tiers: Partial<Record<Tier, string>>,
  modelList: ModelListResult,
): StaleTier[] {
  const stale: StaleTier[] = [];
  for (const [tier, id] of Object.entries(tiers) as Array<[Tier, string]>) {
    if (!FORMER_DEFAULT_MODELS[tier]?.includes(id)) continue;
    const replacement = newestOfFamily(tier, modelList.pricing);
    if (replacement && replacement !== id) stale.push({ tier, id, replacement });
  }
  return stale;
}

const warnedStaleTiers = new Set<Tier>();

/** @internal Test hook */
export function resetStaleTierWarnings(): void {
  warnedStaleTiers.clear();
}

/**
 * `install`'s rewrite: mutate a config object so stale tier ids become their
 * replacement and a `pricing` override keyed by a replaced id is dropped.
 * Returns what was replaced.
 */
export function rewriteStaleTiers(
  config: { tiers?: Partial<Record<Tier, string>>; pricing?: Record<string, unknown> },
  modelList: ModelListResult,
): StaleTier[] {
  const replaced = staleTierIds(config.tiers ?? {}, modelList);
  for (const { tier, id, replacement } of replaced) {
    config.tiers![tier] = replacement;
    if (config.pricing) delete config.pricing[id];
  }
  return replaced;
}

/**
 * Replace stale tier ids in memory and warn once per tier per process (old id,
 * new id). Returns the tiers to route with; the config on disk is untouched.
 */
export function applyStaleTierReplacements<T extends Partial<Record<Tier, string>>>(
  tiers: T,
  modelList: ModelListResult,
  warn: (message: string) => void = console.warn,
): T {
  const out = { ...tiers };
  for (const { tier, id, replacement } of staleTierIds(tiers, modelList)) {
    out[tier] = replacement as T[Tier];
    if (warnedStaleTiers.has(tier)) continue;
    warnedStaleTiers.add(tier);
    warn(
      `[claude-router] config: tier "${tier}" is set to "${id}", a former default; routing to "${replacement}" instead. ` +
        `Run "claude-router install" to rewrite the config, or pin a different id on purpose.`,
    );
  }
  return out;
}

/**
 * Remote list, else the last-good local cache, else the build-time snapshot
 * `DEFAULT_PRICING` table — in that order, each one only tried after the
 * previous one failed. This is the "local cache and built-in fallback" the
 * ticket asks for; there is no `schema_version` to gate on (the list
 * deliberately has none, see {@link MODEL_LIST_URL}'s doc comment), so an
 * incompatible future shape is caught by {@link isModelList} instead.
 */
export async function loadModelListPricing(options: {
  url?: string;
  cachePath?: string;
  fetchList?: (url: string) => Promise<ModelListEntry[]>;
} = {}): Promise<ModelListResult> {
  const cachePath = options.cachePath ?? defaultModelListCachePath();
  const fetchList = options.fetchList ?? ((url: string) => fetchModelList(url));
  try {
    const entries = await fetchList(options.url ?? MODEL_LIST_URL);
    writeCache(cachePath, entries);
    return { pricing: pricingTableFromList(entries), source: 'remote' };
  } catch {
    const cached = readCache(cachePath);
    if (cached) return { pricing: pricingTableFromList(cached), source: 'cache' };
    return { pricing: DEFAULT_PRICING, source: 'snapshot' };
  }
}
