"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const server_js_1 = require("../proxy/server.js");
const handler_js_1 = require("../proxy/handler.js");
const dashboard_js_1 = require("../proxy/dashboard.js");
const models_js_1 = require("../models.js");
(0, node_test_1.describe)('getAnthropicClient — per-credential cache', () => {
    (0, node_test_1.it)('returns the same instance for the same api key', () => {
        (0, handler_js_1.clearClientCache)();
        const a = (0, handler_js_1.getAnthropicClient)('sk-test-1', null);
        const b = (0, handler_js_1.getAnthropicClient)('sk-test-1', null);
        strict_1.default.equal(a, b);
    });
    (0, node_test_1.it)('returns different instances for different credentials', () => {
        (0, handler_js_1.clearClientCache)();
        const a = (0, handler_js_1.getAnthropicClient)('sk-test-1', null);
        const b = (0, handler_js_1.getAnthropicClient)('sk-test-2', null);
        const c = (0, handler_js_1.getAnthropicClient)(undefined, 'bearer-token');
        strict_1.default.notEqual(a, b);
        strict_1.default.notEqual(a, c);
    });
    (0, node_test_1.it)('evicts old clients past the cache cap', () => {
        (0, handler_js_1.clearClientCache)();
        const first = (0, handler_js_1.getAnthropicClient)('sk-evict-0', null);
        for (let i = 1; i <= 100; i++) {
            (0, handler_js_1.getAnthropicClient)(`sk-evict-${i}`, null);
        }
        const firstAgain = (0, handler_js_1.getAnthropicClient)('sk-evict-0', null);
        strict_1.default.notEqual(first, firstAgain, 'first client should have been evicted');
        (0, handler_js_1.clearClientCache)();
    });
    (0, node_test_1.it)('pins the upstream to api.anthropic.com even when ANTHROPIC_BASE_URL points at the proxy', () => {
        // Otherwise the SDK inherits ANTHROPIC_BASE_URL (the proxy's own address) and
        // the proxy calls itself in an infinite loop.
        const prev = process.env['ANTHROPIC_BASE_URL'];
        process.env['ANTHROPIC_BASE_URL'] = 'http://localhost:4000';
        (0, handler_js_1.clearClientCache)();
        const client = (0, handler_js_1.getAnthropicClient)('sk-loop-test', null);
        strict_1.default.equal(client.baseURL.replace(/\/$/, ''), 'https://api.anthropic.com');
        (0, handler_js_1.clearClientCache)();
        if (prev === undefined)
            delete process.env['ANTHROPIC_BASE_URL'];
        else
            process.env['ANTHROPIC_BASE_URL'] = prev;
    });
});
(0, node_test_1.describe)('createProxyApp', () => {
    const app = (0, server_js_1.createProxyApp)({
        classifier: 'heuristic',
        defaultModel: 'claude-sonnet-4-6',
        verbose: false,
        provider: 'anthropic',
        models: models_js_1.DEFAULT_MODELS,
        forceRoute: false,
    });
    (0, node_test_1.it)('GET /health returns ok', async () => {
        const res = await app.request('/health');
        strict_1.default.equal(res.status, 200);
        const body = await res.json();
        strict_1.default.equal(body.status, 'ok');
        strict_1.default.equal(body.service, 'claude-router-proxy');
        strict_1.default.equal(body.classifier, 'heuristic');
    });
    (0, node_test_1.it)('GET /dashboard returns HTML', async () => {
        const res = await app.request('/dashboard');
        strict_1.default.equal(res.status, 200);
        const html = await res.text();
        strict_1.default.ok(html.includes('<!DOCTYPE html>'));
        strict_1.default.ok(html.includes('claude-router dashboard'));
    });
    (0, node_test_1.it)('POST /v1/messages without api key returns 401', async () => {
        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }),
        });
        strict_1.default.equal(res.status, 401);
        const body = await res.json();
        strict_1.default.equal(body.error.type, 'authentication_error');
    });
    (0, node_test_1.it)('GET /unknown returns 404', async () => {
        const res = await app.request('/unknown');
        strict_1.default.equal(res.status, 404);
    });
});
(0, node_test_1.describe)('renderDashboard', () => {
    (0, node_test_1.it)('renders empty state', () => {
        const html = (0, dashboard_js_1.renderDashboard)([]);
        strict_1.default.ok(html.includes('No requests yet'));
        strict_1.default.ok(html.includes('Session Requests'));
        strict_1.default.ok(html.includes('0'));
        strict_1.default.ok(!html.includes('Lifetime Saved'), 'no lifetime card without history');
    });
    (0, node_test_1.it)('renders lifetime stats when provided', () => {
        const html = (0, dashboard_js_1.renderDashboard)([], {
            requests: 42,
            costCents: 100,
            savedCents: 4700,
            retried: 1,
            tiers: { haiku: 40, opus: 2 },
            byDay: {},
        });
        strict_1.default.ok(html.includes('Lifetime Saved'));
        strict_1.default.ok(html.includes('$47.00'));
        strict_1.default.ok(html.includes('42'));
    });
    (0, node_test_1.it)('renders with data', () => {
        const events = [
            {
                timestamp: '2026-05-01T12:00:00.000Z',
                tier: 'haiku',
                model: 'claude-haiku-4-5-20251001',
                costCents: 0.05,
                savedCents: 0.15,
                confidence: 0.9,
                classifier: 'heuristic',
                retried: false,
                retryReason: null,
                inputTokens: 100,
                outputTokens: 50,
            },
            {
                timestamp: '2026-05-01T12:01:00.000Z',
                tier: 'sonnet',
                model: 'claude-sonnet-4-6',
                costCents: 0.45,
                savedCents: 0,
                confidence: 0.7,
                classifier: 'heuristic',
                retried: true,
                retryReason: 'truncation',
                inputTokens: 500,
                outputTokens: 200,
            },
        ];
        const html = (0, dashboard_js_1.renderDashboard)(events);
        strict_1.default.ok(html.includes('haiku'));
        strict_1.default.ok(html.includes('sonnet'));
        strict_1.default.ok(html.includes('truncation'));
        strict_1.default.ok(!html.includes('No requests yet'));
    });
    (0, node_test_1.it)('escapes HTML in model name', () => {
        const events = [
            {
                timestamp: '2026-05-01T12:00:00.000Z',
                tier: 'haiku',
                model: '<script>alert(1)</script>',
                costCents: 0,
                savedCents: 0,
                confidence: 0.5,
                classifier: 'heuristic',
                retried: false,
                retryReason: null,
                inputTokens: 0,
                outputTokens: 0,
            },
        ];
        const html = (0, dashboard_js_1.renderDashboard)(events);
        strict_1.default.ok(!html.includes('<script>'));
        strict_1.default.ok(html.includes('&lt;script&gt;'));
    });
    (0, node_test_1.it)('escapes HTML in retryReason', () => {
        const events = [
            {
                timestamp: '2026-05-01T12:00:00.000Z',
                tier: 'sonnet',
                model: 'claude-sonnet-4-6',
                costCents: 0,
                savedCents: 0,
                confidence: 0.5,
                classifier: 'heuristic',
                retried: true,
                retryReason: '<img onerror=alert(1)>',
                inputTokens: 0,
                outputTokens: 0,
            },
        ];
        const html = (0, dashboard_js_1.renderDashboard)(events);
        strict_1.default.ok(!html.includes('<img'));
        strict_1.default.ok(html.includes('&lt;img'));
    });
    (0, node_test_1.it)('renders with many events (shows last 50)', () => {
        const events = Array.from({ length: 60 }, (_, i) => ({
            timestamp: `2026-05-01T12:${String(i).padStart(2, '0')}:00.000Z`,
            tier: 'haiku',
            model: 'claude-haiku-4-5-20251001',
            costCents: 0.01,
            savedCents: 0.05,
            confidence: 0.9,
            classifier: 'heuristic',
            retried: false,
            retryReason: null,
            inputTokens: 10,
            outputTokens: 5,
        }));
        const html = (0, dashboard_js_1.renderDashboard)(events);
        strict_1.default.ok(html.includes('60')); // total requests count
        strict_1.default.ok(html.includes('Showing last 50 of 60'));
        strict_1.default.ok(!html.includes('No requests yet'));
    });
    (0, node_test_1.it)('handles zero-cost events', () => {
        const events = [
            {
                timestamp: '2026-05-01T12:00:00.000Z',
                tier: 'haiku',
                model: 'claude-haiku-4-5-20251001',
                costCents: 0,
                savedCents: 0,
                confidence: 0.9,
                classifier: 'heuristic',
                retried: false,
                retryReason: null,
                inputTokens: 0,
                outputTokens: 0,
            },
        ];
        const html = (0, dashboard_js_1.renderDashboard)(events);
        strict_1.default.ok(html.includes('$0.0000'));
        strict_1.default.ok(!html.includes('NaN'));
    });
    (0, node_test_1.it)('handles negative savedCents', () => {
        const events = [
            {
                timestamp: '2026-05-01T12:00:00.000Z',
                tier: 'opus',
                model: 'claude-opus-4-6',
                costCents: 5.0,
                savedCents: -3.0,
                confidence: 0.85,
                classifier: 'heuristic',
                retried: false,
                retryReason: null,
                inputTokens: 200,
                outputTokens: 100,
            },
        ];
        const html = (0, dashboard_js_1.renderDashboard)(events);
        strict_1.default.ok(html.includes('negative'), 'should have negative class for negative savings');
    });
    (0, node_test_1.it)('handles passthrough tier', () => {
        const events = [
            {
                timestamp: '2026-05-01T12:00:00.000Z',
                tier: 'passthrough',
                model: 'claude-sonnet-4-6',
                costCents: 0,
                savedCents: 0,
                confidence: 0,
                classifier: 'none',
                retried: false,
                retryReason: null,
                inputTokens: 0,
                outputTokens: 0,
            },
        ];
        const html = (0, dashboard_js_1.renderDashboard)(events);
        strict_1.default.ok(html.includes('passthrough'));
    });
});
(0, node_test_1.describe)('proxy passthrough', () => {
    const app = (0, server_js_1.createProxyApp)({
        classifier: 'heuristic',
        defaultModel: 'claude-sonnet-4-6',
        verbose: false,
        provider: 'anthropic',
        models: models_js_1.DEFAULT_MODELS,
        forceRoute: false,
    });
    (0, node_test_1.it)('POST /v1/messages with model=auto without key returns 401', async () => {
        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }),
        });
        strict_1.default.equal(res.status, 401);
    });
    (0, node_test_1.it)('POST /v1/messages/count_tokens forwards to Anthropic instead of 404', async () => {
        // Claude Code / the VS Code extension call count_tokens; a 404 breaks them.
        const res = await app.request('/v1/messages/count_tokens', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'sk-test-fake' },
            body: JSON.stringify({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] }),
        });
        strict_1.default.notEqual(res.status, 404, 'count_tokens must reach the origin, not 404 locally');
        strict_1.default.equal(res.headers.get('x-router-tier'), 'passthrough');
    });
    (0, node_test_1.it)('count_tokens on a non-anthropic provider 404s with a clear message', async () => {
        const bedrockApp = (0, server_js_1.createProxyApp)({
            classifier: 'heuristic',
            defaultModel: 'claude-sonnet-4-6',
            verbose: false,
            provider: 'bedrock',
            models: models_js_1.DEFAULT_MODELS,
            forceRoute: false,
        });
        const res = await bedrockApp.request('/v1/messages/count_tokens', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'x', messages: [] }),
        });
        strict_1.default.equal(res.status, 404);
        const body = await res.json();
        strict_1.default.equal(body.error.type, 'not_found_error');
    });
    (0, node_test_1.it)('POST /v1/messages with explicit model and key passes through to Anthropic', async () => {
        // With explicit model + key, passthrough forwards to real Anthropic API
        // Fake key → Anthropic returns 401 with its own error format (not ours)
        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'sk-test-fake' },
            body: JSON.stringify({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }),
        });
        // Passthrough should set x-router-tier header
        strict_1.default.equal(res.headers.get('x-router-tier'), 'passthrough');
        // Anthropic rejects invalid key with 401
        strict_1.default.equal(res.status, 401);
    });
});
(0, node_test_1.describe)('proxy parameter normalization', () => {
    // Inject a mock client via the provider path so we can inspect the exact params
    // that reach messages.create. A Claude-Code-style body (adaptive thinking +
    // effort) routed to Haiku 4.5 used to 400 — the router must strip those.
    (0, node_test_1.it)('strips adaptive thinking + effort when routing to haiku', async () => {
        let captured;
        const mockClient = {
            messages: {
                create: async (params) => {
                    captured = params;
                    return {
                        id: 'msg_1',
                        type: 'message',
                        role: 'assistant',
                        model: params.model,
                        content: [{ type: 'text', text: 'hello there' }],
                        stop_reason: 'end_turn',
                        stop_sequence: null,
                        usage: { input_tokens: 5, output_tokens: 3 },
                    };
                },
            },
        };
        const app = (0, server_js_1.createProxyApp)({
            classifier: 'heuristic',
            defaultModel: models_js_1.DEFAULT_MODELS.sonnet,
            verbose: false,
            provider: 'bedrock',
            models: models_js_1.DEFAULT_MODELS,
            forceRoute: true,
        }, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockClient);
        const res = await app.request('/v1/messages', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-opus-4-8', // client pins a model; --force-route overrides it
                messages: [{ role: 'user', content: 'hi' }], // trivial → classifies to haiku
                max_tokens: 10,
                thinking: { type: 'adaptive' },
                output_config: { effort: 'high' },
            }),
        });
        strict_1.default.equal(res.status, 200);
        strict_1.default.equal(res.headers.get('x-router-tier'), 'haiku');
        strict_1.default.ok(captured, 'messages.create should have been called');
        strict_1.default.equal(captured.model, models_js_1.DEFAULT_MODELS.haiku);
        strict_1.default.ok(!('thinking' in captured), 'adaptive thinking must be stripped for Haiku');
        strict_1.default.ok(!('output_config' in captured), 'effort must be stripped for Haiku');
        strict_1.default.deepEqual(captured.messages, [{ role: 'user', content: 'hi' }]);
    });
});
(0, node_test_1.describe)('proxy non-streaming timeout guard', () => {
    function appWithCreate(create) {
        return (0, server_js_1.createProxyApp)({ classifier: 'heuristic', defaultModel: models_js_1.DEFAULT_MODELS.sonnet, verbose: false, provider: 'bedrock', models: models_js_1.DEFAULT_MODELS, forceRoute: true }, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { messages: { create } });
    }
    (0, node_test_1.it)('gives the per-credential client a timeout above the SDK 10-min non-streaming ceiling', () => {
        (0, handler_js_1.clearClientCache)();
        const client = (0, handler_js_1.getAnthropicClient)('sk-timeout-test', null);
        strict_1.default.equal(typeof client.timeout, 'number');
        strict_1.default.ok(client.timeout > 10 * 60 * 1000, 'client timeout must exceed the 10-min guard ceiling');
        (0, handler_js_1.clearClientCache)();
    });
    (0, node_test_1.it)('returns a clean error (not an uncaught 500) when the SDK throws a non-API AnthropicError', async () => {
        const app = appWithCreate(() => { throw new sdk_1.default.AnthropicError('Streaming is strongly recommended \u2026'); });
        const res = await app.request('/v1/messages', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }),
        });
        strict_1.default.equal(res.status, 500);
        const body = await res.json();
        strict_1.default.ok(body.error?.type, 'error body must be structured JSON');
    });
});
(0, node_test_1.describe)('proxy resilience to responses missing usage', () => {
    (0, node_test_1.it)('returns 200 (does not crash) when the response has no usage field', async () => {
        const app = (0, server_js_1.createProxyApp)({ classifier: 'heuristic', defaultModel: models_js_1.DEFAULT_MODELS.sonnet, verbose: false, provider: 'bedrock', models: models_js_1.DEFAULT_MODELS, forceRoute: true }, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { messages: { create: async () => ({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null }) } });
        const res = await app.request('/v1/messages', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }),
        });
        strict_1.default.equal(res.status, 200);
    });
});
(0, node_test_1.describe)('proxy forwards anthropic-beta on routed calls', () => {
    (0, node_test_1.it)('relays the anthropic-beta header to messages.create', async () => {
        let opts;
        const app = (0, server_js_1.createProxyApp)({ classifier: 'heuristic', defaultModel: models_js_1.DEFAULT_MODELS.sonnet, verbose: false, provider: 'bedrock', models: models_js_1.DEFAULT_MODELS, forceRoute: true }, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { messages: { create: async (_p, o) => { opts = o; return { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }; } } });
        const res = await app.request('/v1/messages', {
            method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-beta': 'context-management-2025-06-27' },
            body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }),
        });
        strict_1.default.equal(res.status, 200);
        strict_1.default.equal(opts?.headers?.['anthropic-beta'], 'context-management-2025-06-27');
    });
});
//# sourceMappingURL=proxy.test.js.map