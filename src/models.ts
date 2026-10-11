import type Anthropic from '@anthropic-ai/sdk';
import type { ModelPricing, Tier } from './types.js';
import type { ModelListEntry } from './model-list.js';
import snapshot from './pricing-snapshot.json';

export const DEFAULT_MODELS: Record<Tier, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  // Fable 5.1 (2026-09-01) supersedes Fable 5, which is now a legacy model. Same
  // $10/$50 base, cheaper cache reads — so this promotion *does* move a cost
  // figure, downward, on the cache-read line.
  fable: 'claude-fable-5-1',
};

// NOTE: Bedrock inference-profile IDs vary by account/region and Anthropic's
// snapshot naming — verify these against your Bedrock console if routing 400s.
// Pricing is unaffected (resolved by family in priceForModel).
export const BEDROCK_MODELS: Record<Tier, string> = {
  haiku:  'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'us.anthropic.claude-sonnet-5-v1:0',
  opus:   'us.anthropic.claude-opus-5-v1:0',
  // Fable's availability and inference-profile ID on Bedrock are unverified, so
  // the fable tier resolves to Opus here rather than risking a 404. Fable
  // routing is opt-in and off by default, so this is inert unless enabled.
  fable:  'us.anthropic.claude-opus-5-v1:0',
};

export const VERTEX_MODELS: Record<Tier, string> = {
  haiku:  'claude-haiku-4-5',
  sonnet: 'claude-sonnet-5',
  opus:   'claude-opus-5',
  // Same reasoning as Bedrock above.
  fable:  'claude-opus-5',
};

/**
 * Turn a model list into a pricing table. Entries are inserted oldest-first by
 * `created_at`, so within a family the LAST key is the newest model - the
 * family fallback in {@link priceForModel} relies on that insertion order.
 * `ModelPricing.cacheRead` is a fraction of `input`; cache-write columns are not
 * modeled per model (`CACHE_WRITE_RATE` is global).
 */
export function pricingTableFromList(entries: ModelListEntry[]): Record<string, ModelPricing> {
  const table: Record<string, ModelPricing> = {};
  const byAge = [...entries].sort((a, b) =>
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
  );
  for (const { id, pricing: p } of byAge) {
    if (!p || !(p.input > 0) || !(p.output >= 0)) continue;
    const cacheRead = p.cache_read >= 0 ? p.cache_read / p.input : undefined;
    table[id] = { input: p.input, output: p.output, ...(cacheRead !== undefined ? { cacheRead } : {}) };
  }
  return table;
}

/**
 * Pricing from the snapshot committed at `src/pricing-snapshot.json`, refreshed
 * by `npm run pricing:refresh` (and by the release workflow before packing). No
 * price is written by hand anywhere in the source.
 */
export const DEFAULT_PRICING: Record<string, ModelPricing> = pricingTableFromList(
  snapshot as ModelListEntry[],
);

export const TIER_ORDER: Tier[] = ['haiku', 'sonnet', 'opus', 'fable'];

/**
 * The fixed label set for a per-tier breakdown: every tier, plus `passthrough`
 * for requests that bypassed routing. `RouteTotals.tiers` carries only labels
 * actually seen, so consumers that render a stable set (the dashboard bars,
 * `claude-router stats`) zero-fill from this via `tierBreakdown`.
 *
 * Derived from TIER_ORDER on purpose: both consumers used to spell the list out
 * by hand and both had gone stale, omitting `fable` — a fable route was folded
 * into the totals and then rendered nowhere, and it was excluded from the bar
 * chart's own percentage denominator.
 */
export const DISPLAY_TIERS = [...TIER_ORDER, 'passthrough'] as const;
export type DisplayTier = (typeof DISPLAY_TIERS)[number];

/**
 * Automatic escalation stops here. Fable is 2x opus, and the triggers that would
 * reach it — truncation and refusal — have never fired on real traffic
 * (`research/2026-07-21-detector-measurement.md`: 0 of 35,314 responses). Paying
 * 2x on a signal with no observed activations is not a trade worth making
 * silently. Fable stays reachable by classification (opt-in) and by an explicit
 * tier pin, just not by the retry path.
 */
export const ESCALATION_CEILING: Tier = 'opus';

/**
 * Map any Claude model ID (first-party, Bedrock `us.anthropic.*`, Vertex,
 * dated snapshot, or `auto`) to its tier by family name. Returns undefined for
 * non-Claude IDs.
 */
export function familyForModel(model: string): Tier | undefined {
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus')) return 'opus';
  if (m.includes('fable')) return 'fable';
  return undefined;
}

/**
 * Resolve pricing for a model: exact match first (so user overrides win), then
 * fall back to the model's family. This keeps savings math correct across
 * providers and across newly-released dated snapshots without a code change.
 */
export function priceForModel(
  model: string,
  pricing: Record<string, ModelPricing>,
): ModelPricing | undefined {
  if (pricing[model]) return pricing[model];
  const fam = familyForModel(model);
  if (!fam) return undefined;
  // Newest model of the family in the table (insertion order is oldest-first,
  // see pricingTableFromList). This is the single seam every price goes through.
  let newest: ModelPricing | undefined;
  for (const [id, price] of Object.entries(pricing)) {
    if (familyForModel(id) === fam) newest = price;
  }
  return newest;
}

/**
 * Prompt-cache pricing multipliers (fractions of the model's input rate):
 * cache reads bill at 10%, cache writes (5-minute TTL) at 125%.
 * Claude Code uses caching heavily — ignoring these understates every cost.
 *
 * `CACHE_READ_RATE` is the *default*, not a universal: a model may carry its own
 * `ModelPricing.cacheRead` (Fable 5.1 / Mythos 5.1 read at 2.5%). Resolve it with
 * {@link cacheReadRate}, never by reading this constant directly at a cost site.
 */
export const CACHE_READ_RATE = 0.1;
export const CACHE_WRITE_RATE = 1.25;

/** The cache-read multiplier for a resolved price: its own, else the standard 10%. */
export function cacheReadRate(price: ModelPricing): number {
  return price.cacheRead ?? CACHE_READ_RATE;
}

export interface CacheTokens {
  readTokens?: number;
  creationTokens?: number;
}

/** Sink for library warnings. Defaults to `console.warn` everywhere it's accepted. */
export type WarnFn = (message: string) => void;

// Models we've already warned about, so a hot request path warns once, not per call.
// Deliberately module-global: dedup across router instances is fine — the sink
// itself is per-call so two instances with different loggers never fight.
const warnedUnpriced = new Set<string>();

/** @internal Test hook */
export function resetUnpricedWarnings(): void {
  warnedUnpriced.clear();
}

/**
 * An unpriced model is the router's worst failure mode: the cost is not zero,
 * we just don't know it, and a product whose whole pitch is "here is what you
 * saved" reporting $0.00 reads as a slow week rather than a bug. Callers get the
 * machine-readable signal via `RouteCost.priced`; this is the human one.
 */
function warnIfUnpriced(model: string, priced: boolean, warn: WarnFn = console.warn): void {
  if (priced || warnedUnpriced.has(model)) return;
  warnedUnpriced.add(model);
  warn(
    `[claude-router] No pricing for "${model}" — its cost and savings are reported as 0, ` +
      `not measured. Add a "pricing" entry for it in ~/.claude-router/config.json.`,
  );
}

/**
 * Cost in cents for a token count. Returns 0 for a model with no resolvable
 * price — deliberately side-effect-free, so it stays a pure math function. The
 * "we don't know this model" signal is raised by `computeRouteCost`, which is
 * the path every routed call takes and the one that knows the baseline too.
 */
export function computeCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricing: Record<string, ModelPricing>,
  cache?: CacheTokens,
): number {
  const p = priceForModel(model, pricing);
  if (!p) return 0;
  const cacheCost =
    (cache?.readTokens ?? 0) * p.input * cacheReadRate(p) +
    (cache?.creationTokens ?? 0) * p.input * CACHE_WRITE_RATE;
  return ((inputTokens * p.input + outputTokens * p.output + cacheCost) / 1_000_000) * 100;
}

export function tierForModel(
  model: string,
  tiers: Record<Tier, string>,
): Tier | undefined {
  for (const [tier, modelId] of Object.entries(tiers)) {
    if (modelId === model) return tier as Tier;
  }
  return undefined;
}

/** Cost of a routed call plus its savings vs a baseline model, rounded and cache-aware. */
export interface RouteCost {
  costCents: number;
  savedCents: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputTokens: number;
  outputTokens: number;
  /**
   * False when `costCents`/`savedCents` are placeholder zeros rather than
   * measured figures — i.e. the routed model, the baseline model, or both
   * resolved to no price. Both are included because an unpriced baseline makes
   * `savedCents` just as wrong as an unpriced routed model (it reports the
   * negative of the cost). Consumers must render these figures as "unknown",
   * not as $0.00; see `RouteTotals.unpricedModels`.
   */
  priced: boolean;
}

/**
 * Cost + savings for a completed response, including prompt-cache tokens. Shared
 * by the library (`RouteMeta`) and the proxy (`RouteEvent`) so both price a call
 * the same way. `savedCents` is `baseline − actual` and can be negative.
 *
 * `usage` may be missing/partial on an unexpected response shape — guard every
 * field so a routing proxy never crashes on cost math. The resolved token counts
 * are returned so callers record the same guarded values they priced.
 */
export function computeRouteCost(
  model: string,
  usage: Anthropic.Usage | undefined,
  defaultModel: string,
  pricing: Record<string, ModelPricing>,
  warn: WarnFn = console.warn,
): RouteCost {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cache = {
    readTokens: usage?.cache_read_input_tokens ?? 0,
    creationTokens: usage?.cache_creation_input_tokens ?? 0,
  };
  const cost = computeCostCents(model, inputTokens, outputTokens, pricing, cache);
  const baseline = computeCostCents(defaultModel, inputTokens, outputTokens, pricing, cache);

  const modelPriced = priceForModel(model, pricing) !== undefined;
  const baselinePriced = priceForModel(defaultModel, pricing) !== undefined;
  warnIfUnpriced(model, modelPriced, warn);
  warnIfUnpriced(defaultModel, baselinePriced, warn);

  return {
    costCents: Math.round(cost * 1000) / 1000,
    savedCents: Math.round((baseline - cost) * 1000) / 1000,
    cacheReadTokens: cache.readTokens,
    cacheCreationTokens: cache.creationTokens,
    inputTokens,
    outputTokens,
    priced: modelPriced && baselinePriced,
  };
}

/**
 * What a token total would have cost on one model — the "vs all-opus" figure.
 * Cost is linear in tokens, so the totals fold once and price here. Same caveat
 * as the research replay: tokens are held constant across models, which makes
 * this an upper bound on what a single-model session would have cost, not a
 * measurement of one. 0 (with no warning) when the model has no price; the
 * caller decides how to render that.
 */
export function counterfactualCents(
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number },
  model: string,
  pricing: Record<string, ModelPricing> = DEFAULT_PRICING,
): number {
  return computeCostCents(model, tokens.input, tokens.output, pricing, {
    readTokens: tokens.cacheRead,
    creationTokens: tokens.cacheCreation,
  });
}

/** The cost and token fields a route outcome record carries, plus the `priced` flag. */
export interface RouteCostFields {
  costCents: number;
  savedCents: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputTokens: number;
  outputTokens: number;
  priced?: false;
}

/**
 * Shape a {@link RouteCost} into the fields every route outcome record carries.
 *
 * The library's `RouteMeta` and the proxy's `RouteEvent` are different records,
 * but the step from priced call to recorded figures is the same one — and it
 * used to be written out longhand at four sites (`index.buildMeta`, plus the
 * non-streaming, streaming-success and streaming-error paths in the proxy
 * handler), which is how `priced` and the cache-token fields drifted between
 * them. One place to change means one place to get it wrong.
 *
 * `priced` is emitted **only when false**: absent means priced, so history lines
 * written before the flag existed keep counting as measured.
 */
export function costFields(cost: RouteCost): RouteCostFields {
  const {
    costCents,
    savedCents,
    cacheReadTokens,
    cacheCreationTokens,
    inputTokens,
    outputTokens,
    priced,
  } = cost;
  return {
    costCents,
    savedCents,
    cacheReadTokens,
    cacheCreationTokens,
    inputTokens,
    outputTokens,
    ...(priced ? {} : { priced: false as const }),
  };
}
