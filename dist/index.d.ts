import Anthropic from '@anthropic-ai/sdk';
import { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream.js';
import type { RoutedMessage, RouteMeta, RouterConfig, RouterStats, Tier } from './types.js';
export interface StreamResult {
    stream: MessageStream;
    meta: Promise<RouteMeta>;
}
type SendParams = Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'> & {
    tier?: Tier;
};
type StreamParams = Omit<Anthropic.MessageStreamParams, 'model'> & {
    tier?: Tier;
};
export declare class ClaudeRouter {
    /** @internal Exposed for testing — do not depend on this. */
    _client: Anthropic;
    private config;
    private tracker;
    private classifyCache;
    constructor(config: RouterConfig);
    private classify;
    private buildMeta;
    private log;
    send(params: SendParams): Promise<RoutedMessage>;
    stream(params: StreamParams): StreamResult;
    stats(): RouterStats;
    reset(): void;
}
export declare function createRouter(config: RouterConfig): ClaudeRouter;
export type { Tier, ModelPricing, RouterConfig, RouteMeta, RoutedMessage, RouterStats, RoutingTuning, ClassifyInput, ClassifyResult, } from './types.js';
export { heuristicScore, heuristicScoreDetailed, scoreToTier, scoreToConfidence, classifyHeuristic, classify, HEURISTIC_WEIGHTS, } from './classifier.js';
export { shouldRetry, nextTier } from './retry.js';
export { normalizeParamsForTier } from './params.js';
export { DEFAULT_MODELS, DEFAULT_PRICING, FAMILY_PRICING, computeCostCents, priceForModel, familyForModel, } from './models.js';
export { CostTracker } from './tracker.js';
//# sourceMappingURL=index.d.ts.map