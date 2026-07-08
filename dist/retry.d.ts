import type Anthropic from '@anthropic-ai/sdk';
import type { Tier } from './types.js';
export interface RetryDecision {
    retry: boolean;
    reason: 'truncation' | 'refusal' | null;
}
export declare function shouldRetry(response: Anthropic.Message, tier: Tier): RetryDecision;
export declare function nextTier(tier: Tier): Tier | null;
//# sourceMappingURL=retry.d.ts.map