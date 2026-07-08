"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const params_js_1 = require("../params.js");
(0, node_test_1.describe)('normalizeParamsForTier — haiku (Haiku 4.5)', () => {
    (0, node_test_1.it)('strips adaptive thinking (unsupported on Haiku 4.5)', () => {
        const out = (0, params_js_1.normalizeParamsForTier)({ max_tokens: 100, thinking: { type: 'adaptive' } }, 'haiku');
        strict_1.default.ok(!('thinking' in out), 'thinking should be removed');
    });
    (0, node_test_1.it)('strips output_config.effort and drops output_config if now empty', () => {
        const out = (0, params_js_1.normalizeParamsForTier)({ max_tokens: 100, output_config: { effort: 'high' } }, 'haiku');
        strict_1.default.ok(!('output_config' in out), 'empty output_config should be removed');
    });
    (0, node_test_1.it)('keeps other output_config keys while removing effort', () => {
        const out = (0, params_js_1.normalizeParamsForTier)({ max_tokens: 100, output_config: { effort: 'high', format: { type: 'json' } } }, 'haiku');
        strict_1.default.deepEqual(out.output_config, { format: { type: 'json' } });
    });
    (0, node_test_1.it)('keeps sampling params (Haiku 4.5 accepts them)', () => {
        const out = (0, params_js_1.normalizeParamsForTier)({ max_tokens: 100, temperature: 0.5, top_p: 0.9 }, 'haiku');
        strict_1.default.equal(out.temperature, 0.5);
        strict_1.default.equal(out.top_p, 0.9);
    });
});
(0, node_test_1.describe)('normalizeParamsForTier — sonnet/opus (Sonnet 5 / Opus 4.8)', () => {
    for (const tier of ['sonnet', 'opus']) {
        (0, node_test_1.it)(`${tier}: strips temperature/top_p/top_k`, () => {
            const out = (0, params_js_1.normalizeParamsForTier)({ max_tokens: 100, temperature: 0.5, top_p: 0.9, top_k: 40 }, tier);
            strict_1.default.ok(!('temperature' in out));
            strict_1.default.ok(!('top_p' in out));
            strict_1.default.ok(!('top_k' in out));
        });
        (0, node_test_1.it)(`${tier}: converts enabled thinking budget to adaptive`, () => {
            const out = (0, params_js_1.normalizeParamsForTier)({ max_tokens: 100, thinking: { type: 'enabled', budget_tokens: 8000 } }, tier);
            strict_1.default.deepEqual(out.thinking, { type: 'adaptive' });
        });
        (0, node_test_1.it)(`${tier}: preserves thinking.display when converting`, () => {
            const out = (0, params_js_1.normalizeParamsForTier)({ max_tokens: 100, thinking: { type: 'enabled', budget_tokens: 8000, display: 'summarized' } }, tier);
            strict_1.default.deepEqual(out.thinking, { type: 'adaptive', display: 'summarized' });
        });
        (0, node_test_1.it)(`${tier}: leaves adaptive thinking and effort untouched`, () => {
            const out = (0, params_js_1.normalizeParamsForTier)({ max_tokens: 100, thinking: { type: 'adaptive' }, output_config: { effort: 'xhigh' } }, tier);
            strict_1.default.deepEqual(out.thinking, { type: 'adaptive' });
            strict_1.default.deepEqual(out.output_config, { effort: 'xhigh' });
        });
    }
});
(0, node_test_1.describe)('normalizeParamsForTier — invariants', () => {
    (0, node_test_1.it)('never mutates the input object', () => {
        const input = { max_tokens: 100, temperature: 0.5, thinking: { type: 'adaptive' } };
        (0, params_js_1.normalizeParamsForTier)(input, 'opus');
        strict_1.default.equal(input.temperature, 0.5, 'input must be untouched');
        strict_1.default.deepEqual(input.thinking, { type: 'adaptive' });
    });
    (0, node_test_1.it)('leaves messages/system/tools/max_tokens alone', () => {
        const input = {
            max_tokens: 512,
            messages: [{ role: 'user', content: 'hi' }],
            system: 'be brief',
            tools: [{ name: 't' }],
            temperature: 0.7,
        };
        const out = (0, params_js_1.normalizeParamsForTier)(input, 'opus');
        strict_1.default.equal(out.max_tokens, 512);
        strict_1.default.deepEqual(out.messages, input.messages);
        strict_1.default.equal(out.system, 'be brief');
        strict_1.default.deepEqual(out.tools, input.tools);
        strict_1.default.ok(!('temperature' in out));
    });
});
//# sourceMappingURL=params.test.js.map