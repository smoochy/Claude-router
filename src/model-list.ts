import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelPricing } from './types.js';
import { DEFAULT_PRICING } from './models.js';

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
  pricing?: {
    input: number;
    output: number;
    cache_read: number;
    cache_write_5m: number;
    cache_write_1h: number;
  };
  [key: string]: unknown;
}

export interface ModelListResult {
  pricing: Record<string, ModelPricing>;
  /** Where this pricing came from — surfaced by `doctor` and the startup banner. */
  source: 'remote' | 'cache' | 'built-in';
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

/**
 * A list entry's `pricing` is five $/MTok columns; `ModelPricing` only ever
 * tracks `input`/`output`/`cacheRead` (a *fraction* of `input` — see
 * `types.ts`). Cache-write pricing isn't modeled per-model anywhere in this
 * codebase (`CACHE_WRITE_RATE` is a single global constant in `models.ts`), so
 * `cache_write_5m`/`cache_write_1h` are read by the list but not consumed here.
 */
function pricingFromEntry(entry: ModelListEntry): ModelPricing | undefined {
  const p = entry.pricing;
  if (!p || !(p.input > 0) || !(p.output >= 0)) return undefined;
  const cacheRead = p.cache_read >= 0 ? p.cache_read / p.input : undefined;
  return { input: p.input, output: p.output, ...(cacheRead !== undefined ? { cacheRead } : {}) };
}

function pricingTableFromList(entries: ModelListEntry[]): Record<string, ModelPricing> {
  const table: Record<string, ModelPricing> = {};
  for (const entry of entries) {
    const price = pricingFromEntry(entry);
    if (price) table[entry.id] = price;
  }
  return table;
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
 * Remote list, else the last-good local cache, else the compiled-in
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
    return { pricing: DEFAULT_PRICING, source: 'built-in' };
  }
}
