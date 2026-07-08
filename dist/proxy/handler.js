"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeHistory = void 0;
exports.createProviderClient = createProviderClient;
exports.getAnthropicClient = getAnthropicClient;
exports.clearClientCache = clearClientCache;
exports.handleMessages = handleMessages;
exports.handlePassthrough = handlePassthrough;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const classifier_js_1 = require("../classifier.js");
const cache_js_1 = require("../cache.js");
const models_js_1 = require("../models.js");
const retry_js_1 = require("../retry.js");
const params_js_1 = require("../params.js");
const term_js_1 = require("./term.js");
const history_js_1 = require("./history.js");
const MAX_HISTORY = 1000;
exports.routeHistory = [];
function recordEvent(event, config) {
    exports.routeHistory.push(event);
    if (exports.routeHistory.length > MAX_HISTORY) {
        // shift() is O(n) at the cap; acceptable at n=1000 and keeps the
        // plain-array shape that /health, /dashboard, and tests consume.
        exports.routeHistory.shift();
    }
    if (config?.historyFile)
        (0, history_js_1.appendEvent)(config.historyFile, event);
}
/** Cost + savings for a completed response, including prompt-cache tokens.
 * `usage` may be missing/partial on an unexpected response shape — guard every
 * field so cost math (and the event record built from it) can't crash the request. */
function computeCosts(model, usage, config) {
    const pricing = config.pricing ?? models_js_1.DEFAULT_PRICING;
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    const cache = {
        readTokens: usage?.cache_read_input_tokens ?? 0,
        creationTokens: usage?.cache_creation_input_tokens ?? 0,
    };
    const cost = (0, models_js_1.computeCostCents)(model, inputTokens, outputTokens, pricing, cache);
    const baseline = (0, models_js_1.computeCostCents)(config.defaultModel, inputTokens, outputTokens, pricing, cache);
    return {
        costCents: Math.round(cost * 1000) / 1000,
        savedCents: Math.round((baseline - cost) * 1000) / 1000,
        cacheReadTokens: cache.readTokens,
        cacheCreationTokens: cache.creationTokens,
        inputTokens,
        outputTokens,
    };
}
function buildClassifyInput(body) {
    const messages = (body.messages ?? []);
    const system = body.system;
    let systemInput;
    if (typeof system === 'string') {
        systemInput = system;
    }
    else if (Array.isArray(system)) {
        systemInput = system.filter((b) => typeof b === 'object' && b !== null && 'type' in b && b.type === 'text');
    }
    return { messages, system: systemInput, tools: body.tools };
}
// One classification cache per handler config (i.e. per proxy app instance)
const classifyCaches = new WeakMap();
async function classify(client, input, config) {
    let cache = classifyCaches.get(config);
    if (!cache) {
        cache = new cache_js_1.LruCache(config.routing?.classifyCacheSize ?? classifier_js_1.DEFAULT_CLASSIFY_CACHE_SIZE);
        classifyCaches.set(config, cache);
    }
    return (0, classifier_js_1.classify)(client, input, config.classifier, config.models.haiku, {
        ...config.routing,
        cache,
    });
}
function log(tier, model, classifyResult, costCents, savedCents, defaultModel, retried = false, retryReason = null) {
    const saved = savedCents >= 0
        ? term_js_1.term.green(`saved: $${(savedCents / 100).toFixed(4)}`)
        : term_js_1.term.red(`extra: $${(Math.abs(savedCents) / 100).toFixed(4)}`);
    const retryNote = retried ? term_js_1.term.yellow(` [retried: ${retryReason}]`) : '';
    const cachedNote = classifyResult.cached ? ', cached' : '';
    console.log(`${term_js_1.term.dim('[claude-router]')} → ${term_js_1.term.tier(tier)} ${term_js_1.term.dim(`(${classifyResult.method}, ${classifyResult.ms}ms, conf:${classifyResult.confidence}${cachedNote})`)}${retryNote} | cost: $${(costCents / 100).toFixed(4)} | ${saved} ${term_js_1.term.dim(`vs ${defaultModel}`)}`);
}
function setRouterHeaders(headers, tier, model, costCents, savedCents, classifyResult, retried = false, retryReason = null) {
    headers.set('x-router-tier', tier);
    headers.set('x-router-model', model);
    headers.set('x-router-cost-cents', costCents.toFixed(3));
    headers.set('x-router-saved-cents', savedCents.toFixed(3));
    headers.set('x-router-classifier', classifyResult.method);
    headers.set('x-router-classifier-ms', classifyResult.ms.toString());
    headers.set('x-router-confidence', classifyResult.confidence.toString());
    if (retried) {
        headers.set('x-router-retried', 'true');
        headers.set('x-router-retry-reason', retryReason ?? '');
    }
}
/**
 * Create provider-specific client at startup.
 * Returns null for 'anthropic' — client is created per-request from x-api-key header.
 */
async function createProviderClient(provider) {
    if (provider === 'bedrock') {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mod = await import('@anthropic-ai/bedrock-sdk');
            const AnthropicBedrock = mod.default ?? mod.AnthropicBedrock;
            return new AnthropicBedrock({ timeout: CLIENT_TIMEOUT_MS });
        }
        catch {
            throw new Error('Bedrock provider requires @anthropic-ai/bedrock-sdk.\nInstall it: npm install @anthropic-ai/bedrock-sdk\n' +
                'Also set: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION');
        }
    }
    if (provider === 'vertex') {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mod = await import('@anthropic-ai/vertex-sdk');
            const AnthropicVertex = mod.AnthropicVertex ?? mod.default;
            return new AnthropicVertex({
                projectId: process.env['ANTHROPIC_VERTEX_PROJECT_ID'] ?? '',
                region: process.env['ANTHROPIC_VERTEX_REGION'] ?? 'us-east5',
                timeout: CLIENT_TIMEOUT_MS,
            });
        }
        catch {
            throw new Error('Vertex provider requires @anthropic-ai/vertex-sdk.\nInstall it: npm install @anthropic-ai/vertex-sdk\n' +
                'Also set: ANTHROPIC_VERTEX_PROJECT_ID, run: gcloud auth application-default login');
        }
    }
    return null; // 'anthropic' — per-request client
}
// The SDK refuses a non-streaming create whose implied duration exceeds 10 min
// (expectedTimeout = 3600 * max_tokens / 128000 s), throwing a base AnthropicError.
// Claude Code sends large max_tokens on non-streaming requests, tripping that guard.
// The guard is skipped entirely once a CLIENT-level timeout is set (it only falls
// back to the guard when this._options.timeout is null), so any value suppresses it.
// 15 min clears the guard for the largest max_tokens while not pinning a dead
// connection open for an hour under load.
const CLIENT_TIMEOUT_MS = 15 * 60 * 1000;
// The real Anthropic API. Pinned explicitly so the proxy's own SDK clients never
// inherit ANTHROPIC_BASE_URL from the environment — which, once the proxy is the
// thing that variable points at (localhost), makes the proxy call itself in an
// infinite loop (routing AND the classifier's Haiku call both go through here).
const ANTHROPIC_UPSTREAM = 'https://api.anthropic.com';
// Reusing clients per credential preserves HTTP keep-alive connections to the API.
const MAX_CLIENT_CACHE = 100;
const clientCache = new cache_js_1.LruCache(MAX_CLIENT_CACHE);
function getAnthropicClient(apiKey, bearerToken) {
    const key = apiKey ? `k:${apiKey}` : `b:${bearerToken}`;
    let client = clientCache.get(key);
    if (!client) {
        client = apiKey
            ? new sdk_1.default({ apiKey, timeout: CLIENT_TIMEOUT_MS, baseURL: ANTHROPIC_UPSTREAM })
            : new sdk_1.default({ authToken: bearerToken, timeout: CLIENT_TIMEOUT_MS, baseURL: ANTHROPIC_UPSTREAM });
        clientCache.set(key, client);
    }
    return client;
}
/** @internal Test hook */
function clearClientCache() {
    clientCache.clear();
}
async function handleMessages(c, config, providerClient) {
    let client;
    if (providerClient) {
        // Bedrock or Vertex — use singleton client, no x-api-key needed
        client = providerClient;
    }
    else {
        // Anthropic direct — accept x-api-key (API key) or Authorization: Bearer (Pro/Max subscription)
        const apiKey = c.req.header('x-api-key');
        const authHeader = c.req.header('authorization');
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!apiKey && !bearerToken) {
            return c.json({ error: { type: 'authentication_error', message: 'Missing x-api-key or Authorization header' } }, 401);
        }
        client = getAnthropicClient(apiKey, bearerToken);
    }
    // Read once as text so passthrough can forward the exact client bytes
    const rawBody = await c.req.text();
    let body;
    try {
        body = JSON.parse(rawBody);
    }
    catch {
        return c.json({ error: { type: 'invalid_request_error', message: 'Request body is not valid JSON' } }, 400);
    }
    const isStreaming = body.stream === true;
    const requestedModel = body.model;
    // Passthrough only for Anthropic provider with explicit model (not "auto"), unless --force-route
    if (!config.forceRoute && config.provider === 'anthropic' && requestedModel && requestedModel !== 'auto') {
        return proxyPassthrough(c, rawBody);
    }
    const input = buildClassifyInput(body);
    const classifyResult = await classify(client, input, config);
    const tier = classifyResult.tier;
    const model = config.models[tier];
    // Remove 'model' and 'stream' from body, we control them
    const { model: _m, stream: _s, ...apiParams } = body;
    // Forward the client's anthropic-beta header on routed calls. The SDK rebuilds the
    // request and would otherwise drop it, breaking beta features the body relies on
    // (e.g. context_management → "Extra inputs are not permitted").
    const anthropicBeta = c.req.header('anthropic-beta');
    if (isStreaming) {
        return handleStreaming(c, client, apiParams, tier, model, classifyResult, config, anthropicBeta);
    }
    return handleNonStreaming(c, client, apiParams, tier, model, classifyResult, config, anthropicBeta);
}
/** SDK request options that relay the client's anthropic-beta header, if any. */
function betaRequestOptions(anthropicBeta) {
    return anthropicBeta ? { headers: { 'anthropic-beta': anthropicBeta } } : undefined;
}
async function handleNonStreaming(c, client, apiParams, tier, model, classifyResult, config, anthropicBeta) {
    const reqOpts = betaRequestOptions(anthropicBeta);
    try {
        const response = await client.messages.create((0, params_js_1.normalizeParamsForTier)({ ...apiParams, model }, tier), reqOpts);
        // Auto-retry on bad output
        const retryDecision = (0, retry_js_1.shouldRetry)(response, tier);
        if (retryDecision.retry) {
            const escalatedTier = (0, retry_js_1.nextTier)(tier);
            if (escalatedTier) {
                const escalatedModel = config.models[escalatedTier];
                const retryResponse = await client.messages.create((0, params_js_1.normalizeParamsForTier)({ ...apiParams, model: escalatedModel }, escalatedTier), reqOpts);
                const { costCents: roundedCost, savedCents, cacheReadTokens, cacheCreationTokens, inputTokens, outputTokens } = computeCosts(escalatedModel, retryResponse.usage, config);
                if (config.verbose) {
                    log(escalatedTier, escalatedModel, classifyResult, roundedCost, savedCents, config.defaultModel, true, retryDecision.reason);
                }
                recordEvent({
                    timestamp: new Date().toISOString(),
                    tier: escalatedTier,
                    model: escalatedModel,
                    costCents: roundedCost,
                    savedCents,
                    confidence: classifyResult.confidence,
                    classifier: classifyResult.method,
                    retried: true,
                    retryReason: retryDecision.reason,
                    inputTokens,
                    outputTokens,
                    cacheReadTokens,
                    cacheCreationTokens,
                }, config);
                const headers = new Headers({ 'content-type': 'application/json' });
                setRouterHeaders(headers, escalatedTier, escalatedModel, roundedCost, savedCents, classifyResult, true, retryDecision.reason);
                return new Response(JSON.stringify(retryResponse), { status: 200, headers });
            }
        }
        const { costCents: roundedCost, savedCents, cacheReadTokens, cacheCreationTokens, inputTokens, outputTokens } = computeCosts(model, response.usage, config);
        if (config.verbose) {
            log(tier, model, classifyResult, roundedCost, savedCents, config.defaultModel);
        }
        recordEvent({
            timestamp: new Date().toISOString(),
            tier,
            model,
            costCents: roundedCost,
            savedCents,
            confidence: classifyResult.confidence,
            classifier: classifyResult.method,
            retried: false,
            retryReason: null,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
        }, config);
        const headers = new Headers({ 'content-type': 'application/json' });
        setRouterHeaders(headers, tier, model, roundedCost, savedCents, classifyResult);
        return new Response(JSON.stringify(response), { status: 200, headers });
    }
    catch (err) {
        // Catch Anthropic API errors from any provider SDK (instanceof fails cross-bundle)
        if (err instanceof sdk_1.default.APIError || (err instanceof Error && 'status' in err && typeof err.status === 'number')) {
            const status = err.status;
            return c.json({ error: { type: 'api_error', message: err.message } }, status);
        }
        // Non-API SDK errors (e.g. the client-side non-streaming timeout guard) are
        // AnthropicError without a status. Return a clean error instead of letting it
        // throw uncaught — that surfaced as an opaque 500 and leaked the connection.
        if (err instanceof sdk_1.default.AnthropicError) {
            return c.json({ error: { type: 'proxy_error', message: err.message } }, 500);
        }
        throw err;
    }
}
async function handleStreaming(c, client, apiParams, tier, model, classifyResult, config, anthropicBeta) {
    const stream = client.messages.stream((0, params_js_1.normalizeParamsForTier)({ ...apiParams, model }, tier), betaRequestOptions(anthropicBeta));
    const headers = new Headers({
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'x-router-tier': tier,
        'x-router-model': model,
        'x-router-classifier': classifyResult.method,
        'x-router-classifier-ms': classifyResult.ms.toString(),
        'x-router-confidence': classifyResult.confidence.toString(),
    });
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
        async start(controller) {
            try {
                for await (const event of stream) {
                    const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
                    controller.enqueue(encoder.encode(data));
                }
                const finalMessage = await stream.finalMessage();
                const { costCents: roundedCost, savedCents, cacheReadTokens, cacheCreationTokens, inputTokens, outputTokens } = computeCosts(model, finalMessage.usage, config);
                if (config.verbose) {
                    log(tier, model, classifyResult, roundedCost, savedCents, config.defaultModel);
                }
                recordEvent({
                    timestamp: new Date().toISOString(),
                    tier,
                    model,
                    costCents: roundedCost,
                    savedCents,
                    confidence: classifyResult.confidence,
                    classifier: classifyResult.method,
                    retried: false,
                    retryReason: null,
                    inputTokens,
                    outputTokens,
                    cacheReadTokens,
                    cacheCreationTokens,
                }, config);
                controller.close();
            }
            catch (err) {
                const errorData = `event: error\ndata: ${JSON.stringify({ error: { message: String(err) } })}\n\n`;
                controller.enqueue(encoder.encode(errorData));
                controller.close();
            }
        },
    });
    return new Response(readable, { status: 200, headers });
}
/**
 * Forward a non-routed endpoint (count_tokens, model listing, …) straight to the
 * Anthropic API, preserving the client's auth + beta headers. Routing only makes
 * sense for /v1/messages; every other endpoint the client needs must still reach
 * the origin, or Claude Code (and the VS Code extension) 404s on count_tokens.
 */
async function handlePassthrough(c, config) {
    if (config.provider !== 'anthropic') {
        // ponytail: bedrock/vertex have no HTTP passthrough target; count_tokens there is rare.
        return c.json({ error: { type: 'not_found_error', message: `${c.req.path} is only proxied for the anthropic provider` } }, 404);
    }
    const url = new URL(c.req.url);
    const headers = new Headers();
    c.req.raw.headers.forEach((value, key) => {
        // host/content-length are recomputed by fetch; forward everything else
        // (x-api-key, authorization, anthropic-version, anthropic-beta, …).
        if (key === 'host' || key === 'content-length')
            return;
        headers.set(key, value);
    });
    const method = c.req.method;
    const body = method === 'GET' || method === 'HEAD' ? undefined : await c.req.text();
    try {
        const response = await fetch('https://api.anthropic.com' + url.pathname + url.search, {
            method,
            headers,
            body,
        });
        const outHeaders = new Headers();
        response.headers.forEach((value, key) => outHeaders.set(key, value));
        outHeaders.delete('content-encoding');
        outHeaders.delete('content-length');
        outHeaders.set('x-router-tier', 'passthrough');
        return new Response(response.body, { status: response.status, headers: outHeaders });
    }
    catch (err) {
        return c.json({ error: { type: 'proxy_error', message: `Failed to reach Anthropic API: ${String(err)}` } }, 502);
    }
}
async function proxyPassthrough(c, rawBody) {
    try {
        // Forward original auth headers (x-api-key or Authorization: Bearer)
        const passthroughHeaders = {
            'content-type': 'application/json',
            'anthropic-version': c.req.header('anthropic-version') ?? '2023-06-01',
        };
        const apiKey = c.req.header('x-api-key');
        const authHeader = c.req.header('authorization');
        if (apiKey)
            passthroughHeaders['x-api-key'] = apiKey;
        if (authHeader)
            passthroughHeaders['authorization'] = authHeader;
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: passthroughHeaders,
            body: rawBody,
        });
        const headers = new Headers();
        response.headers.forEach((value, key) => headers.set(key, value));
        // fetch already decompressed the body; origin encoding headers no longer apply
        headers.delete('content-encoding');
        headers.delete('content-length');
        headers.set('x-router-tier', 'passthrough');
        // Pipe the upstream body through without buffering
        return new Response(response.body, { status: response.status, headers });
    }
    catch (err) {
        return c.json({ error: { type: 'proxy_error', message: `Failed to reach Anthropic API: ${String(err)}` } }, 502);
    }
}
//# sourceMappingURL=handler.js.map