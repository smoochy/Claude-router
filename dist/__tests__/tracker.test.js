"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const tracker_js_1 = require("../tracker.js");
function makeMeta(overrides = {}) {
    return {
        tier: 'sonnet',
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 500,
        costCents: 0.45,
        savedCents: 0,
        classifierMethod: 'heuristic',
        classifierMs: 0.1,
        fallbackUsed: false,
        confidence: 0.8,
        retried: false,
        retryReason: null,
        ...overrides,
    };
}
(0, node_test_1.describe)('CostTracker', () => {
    (0, node_test_1.it)('starts with zero stats', () => {
        const tracker = new tracker_js_1.CostTracker();
        const stats = tracker.stats();
        strict_1.default.equal(stats.callCount, 0);
        strict_1.default.equal(stats.totalCostCents, 0);
        strict_1.default.equal(stats.totalSavedCents, 0);
        strict_1.default.deepEqual(stats.tierBreakdown, { haiku: 0, sonnet: 0, opus: 0 });
    });
    (0, node_test_1.it)('records single call correctly', () => {
        const tracker = new tracker_js_1.CostTracker();
        tracker.record(makeMeta({ costCents: 1.5, savedCents: 3.2, tier: 'haiku' }));
        const stats = tracker.stats();
        strict_1.default.equal(stats.callCount, 1);
        strict_1.default.equal(stats.totalCostCents, 1.5);
        strict_1.default.equal(stats.totalSavedCents, 3.2);
        strict_1.default.equal(stats.tierBreakdown.haiku, 1);
    });
    (0, node_test_1.it)('accumulates across calls', () => {
        const tracker = new tracker_js_1.CostTracker();
        tracker.record(makeMeta({ costCents: 1.0, savedCents: 2.0, tier: 'haiku' }));
        tracker.record(makeMeta({ costCents: 3.0, savedCents: 0.0, tier: 'sonnet' }));
        tracker.record(makeMeta({ costCents: 10.0, savedCents: -5.0, tier: 'opus' }));
        const stats = tracker.stats();
        strict_1.default.equal(stats.callCount, 3);
        strict_1.default.equal(stats.totalCostCents, 14);
        strict_1.default.equal(stats.totalSavedCents, -3);
        strict_1.default.equal(stats.tierBreakdown.haiku, 1);
        strict_1.default.equal(stats.tierBreakdown.sonnet, 1);
        strict_1.default.equal(stats.tierBreakdown.opus, 1);
    });
    (0, node_test_1.it)('reset clears state', () => {
        const tracker = new tracker_js_1.CostTracker();
        tracker.record(makeMeta({ costCents: 5 }));
        tracker.reset();
        const stats = tracker.stats();
        strict_1.default.equal(stats.callCount, 0);
        strict_1.default.equal(stats.totalCostCents, 0);
    });
    (0, node_test_1.it)('savings = baseline - actual (can be negative)', () => {
        const tracker = new tracker_js_1.CostTracker();
        // Opus costs more than sonnet baseline → negative savings
        tracker.record(makeMeta({ savedCents: -7.5, tier: 'opus' }));
        strict_1.default.equal(tracker.stats().totalSavedCents, -7.5);
    });
});
(0, node_test_1.describe)('CostTracker — volume', () => {
    (0, node_test_1.it)('handles 10k records with O(1) stats and stable results', () => {
        const tracker = new tracker_js_1.CostTracker();
        for (let i = 0; i < 10_000; i++) {
            tracker.record(makeMeta({ costCents: 0.1, savedCents: 0.05, tier: i % 2 === 0 ? 'haiku' : 'opus' }));
        }
        const first = tracker.stats();
        const second = tracker.stats();
        strict_1.default.equal(first.callCount, 10_000);
        strict_1.default.equal(first.totalCostCents, 1000);
        strict_1.default.equal(first.totalSavedCents, 500);
        strict_1.default.deepEqual(first.tierBreakdown, { haiku: 5000, sonnet: 0, opus: 5000 });
        strict_1.default.deepEqual(second, first);
    });
});
//# sourceMappingURL=tracker.test.js.map