"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeParamsForTier = normalizeParamsForTier;
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
function normalizeParamsForTier(params, tier) {
    const out = { ...params };
    if (tier === 'haiku') {
        // Haiku 4.5 predates adaptive thinking and the effort parameter.
        if ('thinking' in out)
            delete out['thinking'];
        if (out['output_config'] && typeof out['output_config'] === 'object') {
            const oc = { ...out['output_config'] };
            delete oc['effort'];
            if (Object.keys(oc).length === 0)
                delete out['output_config'];
            else
                out['output_config'] = oc;
        }
    }
    else {
        // Sonnet 5 / Opus 4.8 reject sampling params and fixed thinking budgets.
        delete out['temperature'];
        delete out['top_p'];
        delete out['top_k'];
        const thinking = out['thinking'];
        if (thinking &&
            typeof thinking === 'object' &&
            thinking.type === 'enabled') {
            const next = { type: 'adaptive' };
            if (thinking.display !== undefined)
                next['display'] = thinking.display;
            out['thinking'] = next;
        }
    }
    return out;
}
//# sourceMappingURL=params.js.map