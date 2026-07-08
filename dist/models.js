"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_WRITE_RATE = exports.CACHE_READ_RATE = exports.TIER_ORDER = exports.DEFAULT_PRICING = exports.FAMILY_PRICING = exports.VERTEX_MODELS = exports.BEDROCK_MODELS = exports.DEFAULT_MODELS = void 0;
exports.familyForModel = familyForModel;
exports.priceForModel = priceForModel;
exports.computeCostCents = computeCostCents;
exports.tierForModel = tierForModel;
exports.DEFAULT_MODELS = {
    haiku: 'claude-haiku-4-5',
    sonnet: 'claude-sonnet-5',
    opus: 'claude-opus-4-8',
};
// NOTE: Bedrock inference-profile IDs vary by account/region and Anthropic's
// snapshot naming — verify these against your Bedrock console if routing 400s.
// Pricing is unaffected (resolved by family in priceForModel).
exports.BEDROCK_MODELS = {
    haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    sonnet: 'us.anthropic.claude-sonnet-5-v1:0',
    opus: 'us.anthropic.claude-opus-4-8-v1:0',
};
exports.VERTEX_MODELS = {
    haiku: 'claude-haiku-4-5',
    sonnet: 'claude-sonnet-5',
    opus: 'claude-opus-4-8',
};
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
exports.FAMILY_PRICING = {
    haiku: { input: 1.00, output: 5.00 },
    sonnet: { input: 3.00, output: 15.00 },
    opus: { input: 5.00, output: 25.00 },
};
/**
 * Pricing keyed by exact model ID. Built from FAMILY_PRICING so the two never
 * disagree. Any first-party, Bedrock, or Vertex ID not listed here is resolved
 * by family in `priceForModel` — so a newly-dated snapshot still prices right.
 */
exports.DEFAULT_PRICING = {
    'claude-haiku-4-5': exports.FAMILY_PRICING.haiku,
    'claude-haiku-4-5-20251001': exports.FAMILY_PRICING.haiku,
    'claude-sonnet-5': exports.FAMILY_PRICING.sonnet,
    'claude-sonnet-4-6': exports.FAMILY_PRICING.sonnet,
    'claude-opus-4-8': exports.FAMILY_PRICING.opus,
    'claude-opus-4-7': exports.FAMILY_PRICING.opus,
    'claude-opus-4-6': exports.FAMILY_PRICING.opus,
};
exports.TIER_ORDER = ['haiku', 'sonnet', 'opus'];
/**
 * Map any Claude model ID (first-party, Bedrock `us.anthropic.*`, Vertex,
 * dated snapshot, or `auto`) to its tier by family name. Returns undefined for
 * non-Claude IDs.
 */
function familyForModel(model) {
    const m = model.toLowerCase();
    if (m.includes('haiku'))
        return 'haiku';
    if (m.includes('sonnet'))
        return 'sonnet';
    if (m.includes('opus'))
        return 'opus';
    return undefined;
}
/**
 * Resolve pricing for a model: exact match first (so user overrides win), then
 * fall back to the model's family. This keeps savings math correct across
 * providers and across newly-released dated snapshots without a code change.
 */
function priceForModel(model, pricing) {
    if (pricing[model])
        return pricing[model];
    const fam = familyForModel(model);
    if (!fam)
        return undefined;
    // Honor a user override that targets the family's default model ID, else the
    // canonical family price.
    return pricing[exports.DEFAULT_MODELS[fam]] ?? exports.FAMILY_PRICING[fam];
}
/**
 * Prompt-cache pricing multipliers (fractions of the model's input rate):
 * cache reads bill at 10%, cache writes (5-minute TTL) at 125%.
 * Claude Code uses caching heavily — ignoring these understates every cost.
 */
exports.CACHE_READ_RATE = 0.1;
exports.CACHE_WRITE_RATE = 1.25;
function computeCostCents(model, inputTokens, outputTokens, pricing, cache) {
    const p = priceForModel(model, pricing);
    if (!p)
        return 0;
    const cacheCost = (cache?.readTokens ?? 0) * p.input * exports.CACHE_READ_RATE +
        (cache?.creationTokens ?? 0) * p.input * exports.CACHE_WRITE_RATE;
    return ((inputTokens * p.input + outputTokens * p.output + cacheCost) / 1_000_000) * 100;
}
function tierForModel(model, tiers) {
    for (const [tier, modelId] of Object.entries(tiers)) {
        if (modelId === model)
            return tier;
    }
    return undefined;
}
//# sourceMappingURL=models.js.map