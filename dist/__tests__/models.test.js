"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const models_js_1 = require("../models.js");
(0, node_test_1.describe)('computeCostCents', () => {
    (0, node_test_1.it)('calculates cost for known model', () => {
        // 1000 input tokens at $3/M + 500 output tokens at $15/M
        // = (1000 * 3 + 500 * 15) / 1_000_000 * 100
        // = (3000 + 7500) / 1_000_000 * 100
        // = 10500 / 1_000_000 * 100
        // = 10500 / 1_000_000 * 100 = 1.05 cents
        const cost = (0, models_js_1.computeCostCents)('claude-sonnet-4-6', 1000, 500, models_js_1.DEFAULT_PRICING);
        strict_1.default.equal(Math.round(cost * 10000) / 10000, 1.05);
    });
    (0, node_test_1.it)('returns 0 for unknown model', () => {
        const cost = (0, models_js_1.computeCostCents)('unknown-model', 1000, 500, models_js_1.DEFAULT_PRICING);
        strict_1.default.equal(cost, 0);
    });
    (0, node_test_1.it)('bills cache reads at 10% of the input rate', () => {
        // sonnet input $3/M → 1M cache-read tokens = $0.30 = 30 cents
        const base = (0, models_js_1.computeCostCents)('claude-sonnet-5', 0, 0, models_js_1.DEFAULT_PRICING);
        const withReads = (0, models_js_1.computeCostCents)('claude-sonnet-5', 0, 0, models_js_1.DEFAULT_PRICING, {
            readTokens: 1_000_000,
        });
        strict_1.default.equal(base, 0);
        strict_1.default.equal(Math.round(withReads * 100) / 100, 30);
    });
    (0, node_test_1.it)('bills cache writes at 125% of the input rate', () => {
        // sonnet input $3/M → 1M cache-creation tokens = $3.75 = 375 cents
        const cost = (0, models_js_1.computeCostCents)('claude-sonnet-5', 0, 0, models_js_1.DEFAULT_PRICING, {
            creationTokens: 1_000_000,
        });
        strict_1.default.equal(Math.round(cost * 100) / 100, 375);
    });
    (0, node_test_1.it)('combines regular, cache-read, and cache-write tokens', () => {
        // haiku $1/M in, $5/M out:
        // 1000 in = $0.001; 500 out = $0.0025; 10000 reads = $0.001; 2000 writes = $0.0025
        const cost = (0, models_js_1.computeCostCents)('claude-haiku-4-5', 1000, 500, models_js_1.DEFAULT_PRICING, {
            readTokens: 10_000,
            creationTokens: 2_000,
        });
        strict_1.default.equal(Math.round(cost * 100000) / 100000, 0.7);
    });
    (0, node_test_1.it)('omitting cache tokens matches the old behavior', () => {
        const without = (0, models_js_1.computeCostCents)('claude-sonnet-5', 1000, 500, models_js_1.DEFAULT_PRICING);
        const withEmpty = (0, models_js_1.computeCostCents)('claude-sonnet-5', 1000, 500, models_js_1.DEFAULT_PRICING, {});
        strict_1.default.equal(without, withEmpty);
    });
    (0, node_test_1.it)('returns 0 for zero tokens', () => {
        const cost = (0, models_js_1.computeCostCents)('claude-sonnet-4-6', 0, 0, models_js_1.DEFAULT_PRICING);
        strict_1.default.equal(cost, 0);
    });
    (0, node_test_1.it)('handles large token counts', () => {
        const cost = (0, models_js_1.computeCostCents)('claude-opus-4-8', 1_000_000, 1_000_000, models_js_1.DEFAULT_PRICING);
        // Current-generation Opus pricing: $5/M input + $25/M output.
        // (1M * 5 + 1M * 25) / 1M * 100 = 30 * 100 = 3000
        strict_1.default.equal(cost, 3000);
    });
    (0, node_test_1.it)('haiku is cheapest', () => {
        const haiku = (0, models_js_1.computeCostCents)(models_js_1.DEFAULT_MODELS.haiku, 1000, 500, models_js_1.DEFAULT_PRICING);
        const sonnet = (0, models_js_1.computeCostCents)(models_js_1.DEFAULT_MODELS.sonnet, 1000, 500, models_js_1.DEFAULT_PRICING);
        const opus = (0, models_js_1.computeCostCents)(models_js_1.DEFAULT_MODELS.opus, 1000, 500, models_js_1.DEFAULT_PRICING);
        strict_1.default.ok(haiku < sonnet);
        strict_1.default.ok(sonnet < opus);
    });
    (0, node_test_1.it)('uses custom pricing when provided', () => {
        const custom = { 'my-model': { input: 1.0, output: 2.0 } };
        const cost = (0, models_js_1.computeCostCents)('my-model', 1_000_000, 1_000_000, custom);
        // (1M * 1 + 1M * 2) / 1M * 100 = 300
        strict_1.default.equal(cost, 300);
    });
    (0, node_test_1.it)('handles very small token counts', () => {
        const cost = (0, models_js_1.computeCostCents)('claude-sonnet-4-6', 1, 1, models_js_1.DEFAULT_PRICING);
        strict_1.default.ok(cost > 0, `cost should be positive, got ${cost}`);
        strict_1.default.ok(Number.isFinite(cost), 'cost should be finite');
    });
    (0, node_test_1.it)('handles negative tokens without crashing', () => {
        const cost = (0, models_js_1.computeCostCents)('claude-sonnet-4-6', -100, -100, models_js_1.DEFAULT_PRICING);
        strict_1.default.equal(typeof cost, 'number');
        strict_1.default.ok(Number.isFinite(cost), 'cost should be finite');
    });
});
(0, node_test_1.describe)('current-generation pricing (guards against drift)', () => {
    // These exact numbers are the product's whole value prop — every `savedCents`
    // figure depends on them. If a regression reintroduces old-generation pricing
    // (e.g. Opus $15/$75), these fail loudly.
    (0, node_test_1.it)('Opus is $5/$25 per 1M, not the old $15/$75', () => {
        strict_1.default.deepEqual(models_js_1.FAMILY_PRICING.opus, { input: 5.0, output: 25.0 });
    });
    (0, node_test_1.it)('Sonnet is $3/$15 per 1M', () => {
        strict_1.default.deepEqual(models_js_1.FAMILY_PRICING.sonnet, { input: 3.0, output: 15.0 });
    });
    (0, node_test_1.it)('Haiku is $1/$5 per 1M, not the old $0.80/$4', () => {
        strict_1.default.deepEqual(models_js_1.FAMILY_PRICING.haiku, { input: 1.0, output: 5.0 });
    });
    (0, node_test_1.it)('every DEFAULT_PRICING entry matches its family price', () => {
        for (const [model, price] of Object.entries(models_js_1.DEFAULT_PRICING)) {
            const fam = (0, models_js_1.familyForModel)(model);
            strict_1.default.ok(fam, `${model} should map to a family`);
            strict_1.default.deepEqual(price, models_js_1.FAMILY_PRICING[fam], `${model} priced off-family`);
        }
    });
});
(0, node_test_1.describe)('familyForModel', () => {
    (0, node_test_1.it)('maps first-party IDs to families', () => {
        strict_1.default.equal((0, models_js_1.familyForModel)('claude-haiku-4-5'), 'haiku');
        strict_1.default.equal((0, models_js_1.familyForModel)('claude-sonnet-5'), 'sonnet');
        strict_1.default.equal((0, models_js_1.familyForModel)('claude-sonnet-4-6'), 'sonnet');
        strict_1.default.equal((0, models_js_1.familyForModel)('claude-opus-4-8'), 'opus');
    });
    (0, node_test_1.it)('maps Bedrock and Vertex IDs to families', () => {
        strict_1.default.equal((0, models_js_1.familyForModel)('us.anthropic.claude-opus-4-8-v1:0'), 'opus');
        strict_1.default.equal((0, models_js_1.familyForModel)('anthropic.claude-haiku-4-5'), 'haiku');
    });
    (0, node_test_1.it)('returns undefined for non-Claude IDs', () => {
        strict_1.default.equal((0, models_js_1.familyForModel)('gpt-4o'), undefined);
    });
});
(0, node_test_1.describe)('priceForModel (drift resilience)', () => {
    (0, node_test_1.it)('prices an unlisted dated snapshot by family', () => {
        // A future snapshot ID not in DEFAULT_PRICING must still price correctly.
        const p = (0, models_js_1.priceForModel)('claude-opus-4-9-20991231', models_js_1.DEFAULT_PRICING);
        strict_1.default.deepEqual(p, models_js_1.FAMILY_PRICING.opus);
    });
    (0, node_test_1.it)('prices Bedrock/Vertex IDs by family with no explicit entry', () => {
        const cost = (0, models_js_1.computeCostCents)('us.anthropic.claude-opus-4-8-v1:0', 1_000_000, 1_000_000, models_js_1.DEFAULT_PRICING);
        strict_1.default.equal(cost, 3000); // same as first-party opus
    });
    (0, node_test_1.it)('exact override wins over family fallback', () => {
        const custom = { ...models_js_1.DEFAULT_PRICING, 'claude-opus-4-8': { input: 0.0, output: 0.0 } };
        strict_1.default.deepEqual((0, models_js_1.priceForModel)('claude-opus-4-8', custom), { input: 0.0, output: 0.0 });
    });
});
(0, node_test_1.describe)('tierForModel', () => {
    (0, node_test_1.it)('finds tier for known model', () => {
        strict_1.default.equal((0, models_js_1.tierForModel)(models_js_1.DEFAULT_MODELS.haiku, models_js_1.DEFAULT_MODELS), 'haiku');
        strict_1.default.equal((0, models_js_1.tierForModel)(models_js_1.DEFAULT_MODELS.sonnet, models_js_1.DEFAULT_MODELS), 'sonnet');
        strict_1.default.equal((0, models_js_1.tierForModel)(models_js_1.DEFAULT_MODELS.opus, models_js_1.DEFAULT_MODELS), 'opus');
    });
    (0, node_test_1.it)('returns undefined for unknown model', () => {
        strict_1.default.equal((0, models_js_1.tierForModel)('unknown', models_js_1.DEFAULT_MODELS), undefined);
    });
});
//# sourceMappingURL=models.test.js.map