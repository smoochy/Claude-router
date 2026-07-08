import type { Context } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import type { ModelPricing, RoutingTuning, Tier } from '../types.js';
export type Provider = 'anthropic' | 'bedrock' | 'vertex';
export interface HandlerConfig {
    classifier: 'heuristic' | 'ai' | 'hybrid';
    defaultModel: string;
    verbose: boolean;
    provider: Provider;
    models: Record<Tier, string>;
    forceRoute: boolean;
    /** Pricing table for savings math (default: current-generation DEFAULT_PRICING) */
    pricing?: Record<string, ModelPricing>;
    /** Classifier thresholds/band/timeout/cache tuning */
    routing?: RoutingTuning;
    /** JSONL file for persistent route history (undefined = in-memory only) */
    historyFile?: string;
}
export interface RouteEvent {
    timestamp: string;
    tier: Tier | 'passthrough';
    model: string;
    costCents: number;
    savedCents: number;
    confidence: number;
    classifier: string;
    retried: boolean;
    retryReason: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
}
export declare const routeHistory: RouteEvent[];
/**
 * Create provider-specific client at startup.
 * Returns null for 'anthropic' — client is created per-request from x-api-key header.
 */
export declare function createProviderClient(provider: Provider): Promise<Anthropic | null>;
export declare function getAnthropicClient(apiKey: string | undefined, bearerToken: string | null): Anthropic;
/** @internal Test hook */
export declare function clearClientCache(): void;
export declare function handleMessages(c: Context, config: HandlerConfig, providerClient: Anthropic | null): Promise<Response>;
/**
 * Forward a non-routed endpoint (count_tokens, model listing, …) straight to the
 * Anthropic API, preserving the client's auth + beta headers. Routing only makes
 * sense for /v1/messages; every other endpoint the client needs must still reach
 * the origin, or Claude Code (and the VS Code extension) 404s on count_tokens.
 */
export declare function handlePassthrough(c: Context, config: HandlerConfig): Promise<Response>;
//# sourceMappingURL=handler.d.ts.map