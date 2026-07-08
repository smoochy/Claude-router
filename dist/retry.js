"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldRetry = shouldRetry;
exports.nextTier = nextTier;
const models_js_1 = require("./models.js");
const REFUSAL_PATTERNS = [
    "i can't",
    "i'm unable",
    "i cannot",
    "i apologize but i'm not able",
    "i don't have the ability",
    "i don't have access",
    "as an ai",
    "i'm not able to",
    "i am unable",
    "i am not able",
];
// Refusals lead with the refusal — only scan the opening of the response,
// so a legitimate short answer that merely contains a pattern mid-sentence
// (e.g. quoting) doesn't trigger escalation.
const REFUSAL_SCAN_CHARS = 80;
function extractResponseText(response) {
    // A routing proxy must never crash on an unexpected response shape: if `content`
    // is missing (some upstreams/edge responses omit it), skip retry inspection rather
    // than throwing — an uncaught TypeError here surfaces as a 500 to the client.
    if (!Array.isArray(response.content))
        return '';
    return response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
}
function shouldRetry(response, tier) {
    const tierIndex = models_js_1.TIER_ORDER.indexOf(tier);
    // Can't retry from opus — nowhere to escalate
    if (tierIndex >= models_js_1.TIER_ORDER.length - 1) {
        return { retry: false, reason: null };
    }
    // Truncation: hit max_tokens with substantive output (not empty)
    if (response.stop_reason === 'max_tokens' &&
        (response.usage?.output_tokens ?? 0) > 20) {
        return { retry: true, reason: 'truncation' };
    }
    // Refusal: very short output opening with a refusal pattern
    const text = extractResponseText(response);
    if (text.length < 200) {
        const lower = text.toLowerCase().slice(0, REFUSAL_SCAN_CHARS);
        for (const pattern of REFUSAL_PATTERNS) {
            if (lower.includes(pattern)) {
                return { retry: true, reason: 'refusal' };
            }
        }
    }
    return { retry: false, reason: null };
}
function nextTier(tier) {
    const idx = models_js_1.TIER_ORDER.indexOf(tier);
    if (idx < 0 || idx >= models_js_1.TIER_ORDER.length - 1)
        return null;
    return models_js_1.TIER_ORDER[idx + 1];
}
//# sourceMappingURL=retry.js.map