"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostTracker = exports.familyForModel = exports.priceForModel = exports.computeCostCents = exports.FAMILY_PRICING = exports.DEFAULT_PRICING = exports.DEFAULT_MODELS = exports.normalizeParamsForTier = exports.nextTier = exports.shouldRetry = exports.HEURISTIC_WEIGHTS = exports.classify = exports.classifyHeuristic = exports.scoreToConfidence = exports.scoreToTier = exports.heuristicScoreDetailed = exports.heuristicScore = exports.ClaudeRouter = void 0;
exports.createRouter = createRouter;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const classifier_js_1 = require("./classifier.js");
const cache_js_1 = require("./cache.js");
const models_js_1 = require("./models.js");
const tracker_js_1 = require("./tracker.js");
const retry_js_1 = require("./retry.js");
const params_js_1 = require("./params.js");
function resolveConfig(config) {
    const tiers = {
        haiku: config.tiers?.haiku ?? models_js_1.DEFAULT_MODELS.haiku,
        sonnet: config.tiers?.sonnet ?? models_js_1.DEFAULT_MODELS.sonnet,
        opus: config.tiers?.opus ?? models_js_1.DEFAULT_MODELS.opus,
    };
    return {
        apiKey: config.apiKey,
        defaultModel: config.defaultModel ?? tiers.sonnet,
        classifier: config.classifier ?? 'hybrid',
        tiers,
        pricing: { ...models_js_1.DEFAULT_PRICING, ...config.pricing },
        fallback: config.fallback ?? true,
        verbose: config.verbose ?? false,
        routing: config.routing ?? {},
    };
}
function buildClassifyInput(params) {
    const system = params.system;
    let systemInput;
    if (typeof system === 'string') {
        systemInput = system;
    }
    else if (Array.isArray(system)) {
        systemInput = system.filter((b) => 'type' in b && b.type === 'text');
    }
    return {
        messages: params.messages,
        system: systemInput,
        tools: params.tools,
    };
}
class ClaudeRouter {
    /** @internal Exposed for testing — do not depend on this. */
    _client;
    config;
    tracker;
    classifyCache;
    constructor(config) {
        this.config = resolveConfig(config);
        this._client = new sdk_1.default({ apiKey: this.config.apiKey });
        this.tracker = new tracker_js_1.CostTracker();
        this.classifyCache = new cache_js_1.LruCache(this.config.routing.classifyCacheSize ?? classifier_js_1.DEFAULT_CLASSIFY_CACHE_SIZE);
    }
    async classify(input) {
        return (0, classifier_js_1.classify)(this._client, input, this.config.classifier, this.config.tiers.haiku, { ...this.config.routing, cache: this.classifyCache });
    }
    buildMeta(tier, model, usage, classifyResult, fallbackUsed, retried = false, retryReason = null) {
        const inputTokens = usage.input_tokens;
        const outputTokens = usage.output_tokens;
        const cache = {
            readTokens: usage.cache_read_input_tokens ?? 0,
            creationTokens: usage.cache_creation_input_tokens ?? 0,
        };
        const costCents = (0, models_js_1.computeCostCents)(model, inputTokens, outputTokens, this.config.pricing, cache);
        const baselineCost = (0, models_js_1.computeCostCents)(this.config.defaultModel, inputTokens, outputTokens, this.config.pricing, cache);
        return {
            tier,
            model,
            inputTokens,
            outputTokens,
            cacheReadTokens: cache.readTokens,
            cacheCreationTokens: cache.creationTokens,
            costCents: Math.round(costCents * 1000) / 1000,
            savedCents: Math.round((baselineCost - costCents) * 1000) / 1000,
            classifierMethod: classifyResult.method,
            classifierMs: classifyResult.ms,
            fallbackUsed,
            confidence: classifyResult.confidence,
            retried,
            retryReason,
        };
    }
    log(meta, classifyResult) {
        if (!this.config.verbose)
            return;
        const fallbackNote = meta.fallbackUsed
            ? `, fallback from ${classifyResult.tier}`
            : '';
        const saved = meta.savedCents >= 0
            ? `saved: $${(meta.savedCents / 100).toFixed(4)}`
            : `extra: $${(Math.abs(meta.savedCents) / 100).toFixed(4)}`;
        console.log(`[claude-router] → ${meta.tier} (${meta.classifierMethod}, ${meta.classifierMs}ms${fallbackNote}) | cost: $${(meta.costCents / 100).toFixed(4)} | ${saved} vs ${this.config.defaultModel}`);
    }
    async send(params) {
        const { tier: forcedTier, ...apiParams } = params;
        const input = buildClassifyInput(params);
        const classifyResult = forcedTier
            ? { tier: forcedTier, score: -1, method: 'heuristic', ms: 0, confidence: 1.0 }
            : await this.classify(input);
        const startIndex = models_js_1.TIER_ORDER.indexOf(classifyResult.tier);
        let lastError;
        for (let i = startIndex; i < models_js_1.TIER_ORDER.length; i++) {
            const tier = models_js_1.TIER_ORDER[i];
            const model = this.config.tiers[tier];
            const fallbackUsed = i !== startIndex;
            try {
                const response = await this._client.messages.create((0, params_js_1.normalizeParamsForTier)({ ...apiParams, model }, tier));
                // Auto-retry on bad output (truncation/refusal)
                const retryDecision = (0, retry_js_1.shouldRetry)(response, tier);
                if (retryDecision.retry && !fallbackUsed) {
                    const escalatedTier = (0, retry_js_1.nextTier)(tier);
                    if (escalatedTier) {
                        const escalatedModel = this.config.tiers[escalatedTier];
                        const retryResponse = await this._client.messages.create((0, params_js_1.normalizeParamsForTier)({ ...apiParams, model: escalatedModel }, escalatedTier));
                        const meta = this.buildMeta(escalatedTier, escalatedModel, retryResponse.usage, classifyResult, true, true, retryDecision.reason);
                        this.tracker.record(meta);
                        this.log(meta, classifyResult);
                        const routed = retryResponse;
                        routed.meta = meta;
                        return routed;
                    }
                }
                const meta = this.buildMeta(tier, model, response.usage, classifyResult, fallbackUsed);
                this.tracker.record(meta);
                this.log(meta, classifyResult);
                const routed = response;
                routed.meta = meta;
                return routed;
            }
            catch (err) {
                lastError = err;
                if (this.config.fallback &&
                    err instanceof sdk_1.default.RateLimitError &&
                    i < models_js_1.TIER_ORDER.length - 1) {
                    continue;
                }
                throw err;
            }
        }
        throw lastError;
    }
    stream(params) {
        const { tier: forcedTier, ...apiParams } = params;
        const input = buildClassifyInput(params);
        const classifyPromise = forcedTier
            ? Promise.resolve({
                tier: forcedTier,
                score: -1,
                method: 'heuristic',
                ms: 0,
                confidence: 1.0,
            })
            : this.classify(input);
        // We need to classify first, then start stream
        let resolveStream;
        let rejectStream;
        const streamReady = new Promise((res, rej) => {
            resolveStream = res;
            rejectStream = rej;
        });
        const metaPromise = classifyPromise
            .then(async (classifyResult) => {
            const tier = classifyResult.tier;
            const model = this.config.tiers[tier];
            const s = this._client.messages.stream((0, params_js_1.normalizeParamsForTier)({ ...apiParams, model }, tier));
            resolveStream(s);
            const finalMessage = await s.finalMessage();
            const meta = this.buildMeta(tier, model, finalMessage.usage, classifyResult, false);
            this.tracker.record(meta);
            this.log(meta, classifyResult);
            return meta;
        })
            .catch((err) => {
            rejectStream(err);
            throw err;
        });
        // Return a proxy that waits for classification to complete
        const streamProxy = new Proxy({}, {
            get(_target, prop) {
                if (prop === 'then')
                    return undefined; // Not a thenable
                return (...args) => {
                    return streamReady.then((s) => {
                        const val = s[prop];
                        if (typeof val === 'function') {
                            return val.apply(s, args);
                        }
                        return val;
                    });
                };
            },
        });
        return {
            stream: streamProxy,
            meta: metaPromise,
        };
    }
    stats() {
        return this.tracker.stats();
    }
    reset() {
        this.tracker.reset();
    }
}
exports.ClaudeRouter = ClaudeRouter;
function createRouter(config) {
    return new ClaudeRouter(config);
}
var classifier_js_2 = require("./classifier.js");
Object.defineProperty(exports, "heuristicScore", { enumerable: true, get: function () { return classifier_js_2.heuristicScore; } });
Object.defineProperty(exports, "heuristicScoreDetailed", { enumerable: true, get: function () { return classifier_js_2.heuristicScoreDetailed; } });
Object.defineProperty(exports, "scoreToTier", { enumerable: true, get: function () { return classifier_js_2.scoreToTier; } });
Object.defineProperty(exports, "scoreToConfidence", { enumerable: true, get: function () { return classifier_js_2.scoreToConfidence; } });
Object.defineProperty(exports, "classifyHeuristic", { enumerable: true, get: function () { return classifier_js_2.classifyHeuristic; } });
Object.defineProperty(exports, "classify", { enumerable: true, get: function () { return classifier_js_2.classify; } });
Object.defineProperty(exports, "HEURISTIC_WEIGHTS", { enumerable: true, get: function () { return classifier_js_2.HEURISTIC_WEIGHTS; } });
var retry_js_2 = require("./retry.js");
Object.defineProperty(exports, "shouldRetry", { enumerable: true, get: function () { return retry_js_2.shouldRetry; } });
Object.defineProperty(exports, "nextTier", { enumerable: true, get: function () { return retry_js_2.nextTier; } });
var params_js_2 = require("./params.js");
Object.defineProperty(exports, "normalizeParamsForTier", { enumerable: true, get: function () { return params_js_2.normalizeParamsForTier; } });
var models_js_2 = require("./models.js");
Object.defineProperty(exports, "DEFAULT_MODELS", { enumerable: true, get: function () { return models_js_2.DEFAULT_MODELS; } });
Object.defineProperty(exports, "DEFAULT_PRICING", { enumerable: true, get: function () { return models_js_2.DEFAULT_PRICING; } });
Object.defineProperty(exports, "FAMILY_PRICING", { enumerable: true, get: function () { return models_js_2.FAMILY_PRICING; } });
Object.defineProperty(exports, "computeCostCents", { enumerable: true, get: function () { return models_js_2.computeCostCents; } });
Object.defineProperty(exports, "priceForModel", { enumerable: true, get: function () { return models_js_2.priceForModel; } });
Object.defineProperty(exports, "familyForModel", { enumerable: true, get: function () { return models_js_2.familyForModel; } });
var tracker_js_2 = require("./tracker.js");
Object.defineProperty(exports, "CostTracker", { enumerable: true, get: function () { return tracker_js_2.CostTracker; } });
//# sourceMappingURL=index.js.map