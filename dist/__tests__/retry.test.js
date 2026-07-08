"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const retry_js_1 = require("../retry.js");
function fakeResponse(overrides = {}) {
    return {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: 'Hello world response here', citations: null }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        ...overrides,
    };
}
(0, node_test_1.describe)('shouldRetry', () => {
    (0, node_test_1.it)('no retry on normal response', () => {
        const result = (0, retry_js_1.shouldRetry)(fakeResponse(), 'haiku');
        strict_1.default.equal(result.retry, false);
        strict_1.default.equal(result.reason, null);
    });
    (0, node_test_1.it)('retry on truncation (max_tokens with output > 20)', () => {
        const result = (0, retry_js_1.shouldRetry)(fakeResponse({
            stop_reason: 'max_tokens',
            usage: { input_tokens: 100, output_tokens: 50 },
        }), 'haiku');
        strict_1.default.equal(result.retry, true);
        strict_1.default.equal(result.reason, 'truncation');
    });
    (0, node_test_1.it)('no retry on truncation with very short output', () => {
        const result = (0, retry_js_1.shouldRetry)(fakeResponse({
            stop_reason: 'max_tokens',
            usage: { input_tokens: 100, output_tokens: 5 },
        }), 'haiku');
        strict_1.default.equal(result.retry, false);
    });
    (0, node_test_1.it)('no retry on truncation from opus', () => {
        const result = (0, retry_js_1.shouldRetry)(fakeResponse({
            stop_reason: 'max_tokens',
            usage: { input_tokens: 100, output_tokens: 50 },
        }), 'opus');
        strict_1.default.equal(result.retry, false);
    });
    (0, node_test_1.it)('does not throw when response.content is undefined', () => {
        // Regression: extractResponseText did response.content.filter(...) and an
        // undefined content threw TypeError, uncaught in the proxy handler — it
        // surfaced as a 500 plus a leaked connection.
        const result = (0, retry_js_1.shouldRetry)(fakeResponse({ content: undefined }), 'haiku');
        strict_1.default.equal(result.retry, false);
        strict_1.default.equal(result.reason, null);
    });
    (0, node_test_1.it)('does not throw when usage is undefined on a max_tokens stop', () => {
        const result = (0, retry_js_1.shouldRetry)(fakeResponse({ stop_reason: 'max_tokens', usage: undefined }), 'haiku');
        strict_1.default.equal(result.retry, false);
    });
    (0, node_test_1.it)('retry on refusal pattern', () => {
        const result = (0, retry_js_1.shouldRetry)(fakeResponse({
            content: [{ type: 'text', text: "I can't help with that." }],
        }), 'haiku');
        strict_1.default.equal(result.retry, true);
        strict_1.default.equal(result.reason, 'refusal');
    });
    (0, node_test_1.it)('retry on "as an AI" refusal', () => {
        const result = (0, retry_js_1.shouldRetry)(fakeResponse({
            content: [{ type: 'text', text: 'As an AI, I cannot do that.' }],
        }), 'sonnet');
        strict_1.default.equal(result.retry, true);
        strict_1.default.equal(result.reason, 'refusal');
    });
    (0, node_test_1.it)('no retry on long response with refusal-like word', () => {
        const result = (0, retry_js_1.shouldRetry)(fakeResponse({
            content: [{ type: 'text', text: 'A'.repeat(250) + " I can't believe how great this is" }],
        }), 'haiku');
        strict_1.default.equal(result.retry, false);
    });
    (0, node_test_1.it)('no retry from opus even on refusal', () => {
        const result = (0, retry_js_1.shouldRetry)(fakeResponse({
            content: [{ type: 'text', text: "I can't help." }],
        }), 'opus');
        strict_1.default.equal(result.retry, false);
    });
});
(0, node_test_1.describe)('nextTier', () => {
    (0, node_test_1.it)('haiku → sonnet', () => strict_1.default.equal((0, retry_js_1.nextTier)('haiku'), 'sonnet'));
    (0, node_test_1.it)('sonnet → opus', () => strict_1.default.equal((0, retry_js_1.nextTier)('sonnet'), 'opus'));
    (0, node_test_1.it)('opus → null', () => strict_1.default.equal((0, retry_js_1.nextTier)('opus'), null));
});
//# sourceMappingURL=retry.test.js.map