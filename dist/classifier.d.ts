import type Anthropic from '@anthropic-ai/sdk';
import { LruCache } from './cache.js';
import type { ClassifyInput, ClassifyResult, Tier } from './types.js';
/** Additive score weights. BASE starts in the sonnet band; signals move it. */
export declare const HEURISTIC_WEIGHTS: {
    readonly BASE: 35;
    readonly SIMPLE_VERB: -12;
    readonly MEDIUM_VERB: 5;
    readonly COMPLEX_VERB: 15;
    readonly TINY_PROMPT: -10;
    readonly LONG_PROMPT: 10;
    readonly VERY_LONG_PROMPT: 20;
    readonly LONG_SENTENCE: 10;
    readonly CODE_BLOCK: 10;
    readonly SYMBOL_DENSITY: 8;
    readonly MATH_KEYWORD: 25;
    readonly MATH_TINY_OFFSET: 13;
    readonly MATH_NOTATION: 20;
    readonly LONG_SYSTEM: 10;
    readonly EXPERT_SYSTEM: 15;
    readonly MULTI_TURN: 10;
    readonly LONG_CONVERSATION: 20;
    readonly TOOL_BLOCKS_PRESENT: 10;
    readonly TOOLS_DEFINED: 8;
    readonly MANY_TOOLS: 7;
    readonly IMAGE_BLOCK: 10;
};
export declare const DEFAULT_AI_TIMEOUT_MS = 1500;
export declare const DEFAULT_CLASSIFY_CACHE_SIZE = 500;
export declare const DEFAULT_HYBRID_BAND: [number, number];
export interface HeuristicDetail {
    score: number;
    /** Total keyword/notation signals that fired — 0 means the text gave us nothing */
    keywordHits: number;
    estimatedTokens: number;
}
export declare function heuristicScoreDetailed(input: ClassifyInput): HeuristicDetail;
export declare function heuristicScore(input: ClassifyInput): number;
export interface TierThresholds {
    haikuMax?: number;
    opusMin?: number;
}
export declare function scoreToTier(score: number, thresholds?: TierThresholds): Tier;
export declare function scoreToConfidence(score: number): number;
export declare function classifyHeuristic(input: ClassifyInput, thresholds?: TierThresholds): ClassifyResult;
export interface ClassifyOptions {
    haikuMax?: number;
    opusMin?: number;
    hybridBand?: [number, number];
    aiTimeoutMs?: number;
    /** Caller-owned cache for AI classification results; undefined = no caching */
    cache?: LruCache<string, ClassifyResult>;
}
export declare function classifyAI(client: Anthropic, input: ClassifyInput, haikuModel: string, opts?: {
    timeoutMs?: number;
}): Promise<ClassifyResult>;
export declare function classifyHybrid(client: Anthropic, input: ClassifyInput, haikuModel: string, opts?: ClassifyOptions): Promise<ClassifyResult>;
/**
 * Unified classification entry point used by both the library and the proxy.
 * Never throws: AI failures fall back to the heuristic result.
 */
export declare function classify(client: Anthropic | null, input: ClassifyInput, mode: 'heuristic' | 'ai' | 'hybrid', haikuModel: string, opts?: ClassifyOptions): Promise<ClassifyResult>;
//# sourceMappingURL=classifier.d.ts.map