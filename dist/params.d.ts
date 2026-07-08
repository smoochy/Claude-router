import type { Tier } from './types.js';
/**
 * Reconcile model-specific request parameters with the tier we're about to route
 * to. The router chooses the model, so it must also strip or adapt any parameters
 * that model would reject — otherwise a request built for one model 400s the
 * moment it's routed to another (this is what breaks Claude Code behind the proxy:
 * it sends adaptive thinking + effort, which Haiku 4.5 rejects).
 *
 * Current-generation capability rules (per the Anthropic model docs):
 *  - Haiku 4.5: rejects `output_config.effort`, and does not support adaptive
 *    thinking (`thinking: {type: "adaptive"}`). Accepts sampling params.
 *  - Sonnet 5 / Opus 4.8: reject `temperature` / `top_p` / `top_k` and
 *    `thinking: {type: "enabled", budget_tokens}` — use adaptive thinking instead.
 *
 * Only model-coupled parameters are touched. `messages`, `system`, `tools`,
 * `max_tokens`, and everything else pass through unchanged.
 */
export declare function normalizeParamsForTier<T extends Record<string, any>>(params: T, tier: Tier): T;
//# sourceMappingURL=params.d.ts.map