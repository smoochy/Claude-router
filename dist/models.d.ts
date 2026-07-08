import type { ModelPricing, Tier } from './types.js';
export declare const DEFAULT_MODELS: Record<Tier, string>;
export declare const BEDROCK_MODELS: Record<Tier, string>;
export declare const VERTEX_MODELS: Record<Tier, string>;
/**
 * Current-generation Claude pricing ($ per 1M tokens), keyed by tier/family.
 * Verified against platform.claude.com pricing for the current generation:
 *   Haiku 4.5 — $1.00 / $5.00
 *   Sonnet 5  — $3.00 / $15.00 standard (intro $2.00 / $10.00 through 2026-08-31)
 *   Opus 4.6/4.7/4.8 — $5.00 / $25.00  (note: NOT the old $15/$75 of Opus 4.0/4.1)
 *
 * We price Sonnet at the standard rate so savings math stays stable when the
 * intro discount ends. Fable 5 ($10/$50) is intentionally not a tier here.
 *
 * Pricing drift here silently corrupts every `savedCents` figure the router
 * reports — keep this in sync when a new generation ships, and rely on the
 * family fallback in `priceForModel` to cover Bedrock/Vertex/dated IDs.
 */
export declare const FAMILY_PRICING: Record<Tier, ModelPricing>;
/**
 * Pricing keyed by exact model ID. Built from FAMILY_PRICING so the two never
 * disagree. Any first-party, Bedrock, or Vertex ID not listed here is resolved
 * by family in `priceForModel` — so a newly-dated snapshot still prices right.
 */
export declare const DEFAULT_PRICING: Record<string, ModelPricing>;
export declare const TIER_ORDER: Tier[];
/**
 * Map any Claude model ID (first-party, Bedrock `us.anthropic.*`, Vertex,
 * dated snapshot, or `auto`) to its tier by family name. Returns undefined for
 * non-Claude IDs.
 */
export declare function familyForModel(model: string): Tier | undefined;
/**
 * Resolve pricing for a model: exact match first (so user overrides win), then
 * fall back to the model's family. This keeps savings math correct across
 * providers and across newly-released dated snapshots without a code change.
 */
export declare function priceForModel(model: string, pricing: Record<string, ModelPricing>): ModelPricing | undefined;
/**
 * Prompt-cache pricing multipliers (fractions of the model's input rate):
 * cache reads bill at 10%, cache writes (5-minute TTL) at 125%.
 * Claude Code uses caching heavily — ignoring these understates every cost.
 */
export declare const CACHE_READ_RATE = 0.1;
export declare const CACHE_WRITE_RATE = 1.25;
export interface CacheTokens {
    readTokens?: number;
    creationTokens?: number;
}
export declare function computeCostCents(model: string, inputTokens: number, outputTokens: number, pricing: Record<string, ModelPricing>, cache?: CacheTokens): number;
export declare function tierForModel(model: string, tiers: Record<Tier, string>): Tier | undefined;
//# sourceMappingURL=models.d.ts.map