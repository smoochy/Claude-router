"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HYBRID_BAND = exports.DEFAULT_CLASSIFY_CACHE_SIZE = exports.DEFAULT_AI_TIMEOUT_MS = exports.HEURISTIC_WEIGHTS = void 0;
exports.heuristicScoreDetailed = heuristicScoreDetailed;
exports.heuristicScore = heuristicScore;
exports.scoreToTier = scoreToTier;
exports.scoreToConfidence = scoreToConfidence;
exports.classifyHeuristic = classifyHeuristic;
exports.classifyAI = classifyAI;
exports.classifyHybrid = classifyHybrid;
exports.classify = classify;
const node_crypto_1 = require("node:crypto");
const SIMPLE_VERBS = [
    'translate', 'summarize', 'format', 'convert', 'list',
    'extract', 'define', 'count', 'repeat', 'spell',
];
const MEDIUM_VERBS = [
    'explain', 'compare', 'implement', 'write', 'generate',
    'analyze', 'debug', 'refactor', 'optimize', 'describe',
];
const COMPLEX_VERBS = [
    'architect', 'design', 'evaluate', 'critique', 'reason',
    'prove', 'strategize', 'synthesize', 'theorize', 'plan',
];
const EXPERT_KEYWORDS = [
    'expert', 'senior', 'architect', 'principal', 'staff',
    'advanced', 'comprehensive', 'thorough', 'detailed analysis',
];
// Math/science concepts that are inherently complex regardless of prompt length.
// Short queries like "P=NP?" or "prove Riemann Hypothesis" must not route to Haiku.
const MATH_SCIENCE_KEYWORDS = [
    // Proof and theorem concepts
    'theorem', 'conjecture', 'proof', 'lemma', 'corollary', 'hypothesis',
    'axiom', 'postulate', 'proposition',
    // Advanced math domains
    'eigenvalue', 'eigenvector', 'determinant', 'matrix', 'matrices', 'tensor',
    'derivative', 'integral', 'differential equation', 'gradient',
    'topology', 'manifold', 'homomorphism', 'isomorphism',
    'polynomial', 'prime', 'modular arithmetic', 'number theory',
    'fourier', 'laplace', 'stochastic', 'markov',
    // Complexity theory
    'p=np', 'np-hard', 'np-complete', 'turing', 'halting problem',
    // Physics concepts
    'quantum', 'entanglement', 'wave function', 'hamiltonian',
    'riemann', 'navier-stokes', 'euler equation',
];
/** Additive score weights. BASE starts in the sonnet band; signals move it. */
exports.HEURISTIC_WEIGHTS = {
    BASE: 35,
    SIMPLE_VERB: -12,
    MEDIUM_VERB: 5,
    COMPLEX_VERB: 15,
    TINY_PROMPT: -10,
    LONG_PROMPT: 10,
    VERY_LONG_PROMPT: 20,
    LONG_SENTENCE: 10,
    CODE_BLOCK: 10,
    SYMBOL_DENSITY: 8,
    MATH_KEYWORD: 25,
    MATH_TINY_OFFSET: 13,
    MATH_NOTATION: 20,
    LONG_SYSTEM: 10,
    EXPERT_SYSTEM: 15,
    MULTI_TURN: 10,
    LONG_CONVERSATION: 20,
    TOOL_BLOCKS_PRESENT: 10,
    TOOLS_DEFINED: 8,
    MANY_TOOLS: 7,
    IMAGE_BLOCK: 10,
};
exports.DEFAULT_AI_TIMEOUT_MS = 1500;
exports.DEFAULT_CLASSIFY_CACHE_SIZE = 500;
exports.DEFAULT_HYBRID_BAND = [40, 60];
const AI_SNIPPET_HEAD = 700;
const AI_SNIPPET_TAIL = 300;
const AI_SYSTEM_SNIPPET = 200;
// Signal-poor prompts at least this long get AI confirmation in hybrid mode
// (typical for non-English input, which the keyword lists cannot score).
const SIGNAL_POOR_MIN_TOKENS = 20;
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Word-boundary matching with optional plural: "list" must not match "listen",
// but "eigenvalue" must still match "eigenvalues".
function compileKeywords(words) {
    return words.map((w) => new RegExp(`\\b${escapeRegex(w)}s?\\b`, 'i'));
}
const SIMPLE_RE = compileKeywords(SIMPLE_VERBS);
const MEDIUM_RE = compileKeywords(MEDIUM_VERBS);
const COMPLEX_RE = compileKeywords(COMPLEX_VERBS);
const EXPERT_RE = compileKeywords(EXPERT_KEYWORDS);
const MATH_RE = compileKeywords(MATH_SCIENCE_KEYWORDS);
function countMatches(text, patterns) {
    let count = 0;
    for (const re of patterns) {
        if (re.test(text))
            count++;
    }
    return count;
}
function extractSignals(messages) {
    const parts = [];
    let toolBlockCount = 0;
    let imageCount = 0;
    let extraChars = 0;
    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            parts.push(msg.content);
        }
        else if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
                const type = block.type;
                if (type === 'text' && 'text' in block && typeof block.text === 'string') {
                    parts.push(block.text);
                }
                else if (type === 'tool_use') {
                    toolBlockCount++;
                }
                else if (type === 'tool_result') {
                    toolBlockCount++;
                    const content = block.content;
                    if (typeof content === 'string') {
                        extraChars += content.length;
                    }
                    else if (content !== undefined) {
                        try {
                            extraChars += JSON.stringify(content).length;
                        }
                        catch {
                            // circular or unserializable tool content — skip sizing
                        }
                    }
                }
                else if (type === 'image') {
                    imageCount++;
                }
            }
        }
    }
    return { text: parts.join(' '), toolBlockCount, imageCount, extraChars };
}
function extractSystemText(system) {
    if (!system)
        return '';
    if (typeof system === 'string')
        return system;
    return system
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
}
function heuristicScoreDetailed(input) {
    const W = exports.HEURISTIC_WEIGHTS;
    const { text, toolBlockCount, imageCount, extraChars } = extractSignals(input.messages);
    const systemText = extractSystemText(input.system);
    const combined = text + ' ' + systemText;
    let score = W.BASE;
    // --- Cognitive verb signals ---
    const simpleHits = countMatches(combined, SIMPLE_RE);
    const mediumHits = countMatches(combined, MEDIUM_RE);
    const complexHits = countMatches(combined, COMPLEX_RE);
    score += simpleHits * W.SIMPLE_VERB;
    score += mediumHits * W.MEDIUM_VERB;
    score += complexHits * W.COMPLEX_VERB;
    // --- Token estimate (chars / 4, including tool_result volume) ---
    const estimatedTokens = (text.length + extraChars) / 4;
    // Only penalize truly empty/trivial prompts (< 5 tokens ≈ "hi", "ok", "2+2")
    // Short but substantive questions like "Prove Fermat's Last Theorem" must not be penalized
    if (estimatedTokens < 5)
        score += W.TINY_PROMPT;
    else if (estimatedTokens > 2000)
        score += W.VERY_LONG_PROMPT;
    else if (estimatedTokens > 500)
        score += W.LONG_PROMPT;
    // --- Sentence complexity ---
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const avgSentenceLen = sentences.length > 0
        ? sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) /
            sentences.length
        : 0;
    if (avgSentenceLen > 25)
        score += W.LONG_SENTENCE;
    // --- Code block presence ---
    if (text.includes('```'))
        score += W.CODE_BLOCK;
    // --- Non-alphanumeric density (code-like content) ---
    const nonAlpha = (text.match(/[^a-zA-Z0-9\s]/g) || []).length;
    const density = text.length > 0 ? nonAlpha / text.length : 0;
    if (density > 0.15)
        score += W.SYMBOL_DENSITY;
    // --- Math/science domain signals ---
    // These are complexity signals independent of prompt length.
    // "P=NP?" is 4 chars but inherently Opus-level.
    const mathHits = countMatches(combined, MATH_RE);
    if (mathHits > 0) {
        score += mathHits * W.MATH_KEYWORD;
        // Cancel short-prompt penalty + small bonus: "P=NP?" must not be penalized for brevity.
        if (estimatedTokens < 5)
            score += W.MATH_TINY_OFFSET;
    }
    // Math notation: Greek letters, equation symbols, LaTeX-style operators
    const hasMathNotation = /[∫∑∂∇∈∉⊂⊃∪∩≤≥≠≈∞√∏∧∨∀∃α-ωΑ-Ω]/.test(text) ||
        /d[²³]?[xyz]\/d[xyz]|\\frac|\\int|\\sum|\\nabla|\^\{|\^2|\^3/.test(text);
    if (hasMathNotation)
        score += W.MATH_NOTATION;
    // --- Tool and image signals ---
    // An in-flight agentic loop (tool_use/tool_result blocks) is at least Sonnet territory.
    if (toolBlockCount > 0)
        score += W.TOOL_BLOCKS_PRESENT;
    const toolCount = input.tools?.length ?? 0;
    if (toolCount > 0)
        score += W.TOOLS_DEFINED;
    if (toolCount > 8)
        score += W.MANY_TOOLS;
    if (imageCount > 0)
        score += W.IMAGE_BLOCK;
    // --- System prompt signals ---
    const expertHits = countMatches(systemText, EXPERT_RE);
    if (systemText.length > 500)
        score += W.LONG_SYSTEM;
    if (expertHits > 0)
        score += W.EXPERT_SYSTEM;
    // --- Multi-turn signals ---
    const messageCount = input.messages.length;
    if (messageCount > 15)
        score += W.LONG_CONVERSATION;
    else if (messageCount > 5)
        score += W.MULTI_TURN;
    const keywordHits = simpleHits + mediumHits + complexHits + mathHits + expertHits + (hasMathNotation ? 1 : 0);
    return {
        score: Math.max(0, Math.min(100, score)),
        keywordHits,
        estimatedTokens,
    };
}
function heuristicScore(input) {
    return heuristicScoreDetailed(input).score;
}
function scoreToTier(score, thresholds) {
    if (score < (thresholds?.haikuMax ?? 30))
        return 'haiku';
    if (score > (thresholds?.opusMin ?? 70))
        return 'opus';
    return 'sonnet';
}
function scoreToConfidence(score) {
    // Distance from ambiguous center (50). Farther = more confident.
    // Score 0→1.0, 20→0.9, 40→0.7, 50→0.5, 60→0.7, 80→0.9, 100→1.0
    return Math.min(1, Math.abs(score - 50) / 50 + 0.5);
}
function classifyHeuristic(input, thresholds) {
    const start = performance.now();
    const score = heuristicScore(input);
    const ms = performance.now() - start;
    return {
        tier: scoreToTier(score, thresholds),
        score,
        method: 'heuristic',
        ms: Math.round(ms * 100) / 100,
        confidence: Math.round(scoreToConfidence(score) * 100) / 100,
    };
}
function buildAISnippet(input) {
    const { text } = extractSignals(input.messages);
    const snippet = text.length > AI_SNIPPET_HEAD + AI_SNIPPET_TAIL
        ? `${text.slice(0, AI_SNIPPET_HEAD)} … ${text.slice(-AI_SNIPPET_TAIL)}`
        : text;
    const sysSnippet = extractSystemText(input.system).slice(0, AI_SYSTEM_SNIPPET);
    return sysSnippet ? `System: ${sysSnippet}\nTask: ${snippet}` : `Task: ${snippet}`;
}
function cacheKey(input) {
    const { text } = extractSignals(input.messages);
    const sys = extractSystemText(input.system);
    return (0, node_crypto_1.createHash)('sha1')
        .update(text.trim().toLowerCase().slice(0, 500))
        .update('\0')
        .update(sys.trim().toLowerCase().slice(0, 200))
        .update('\0')
        .update(String(input.messages.length))
        .update('\0')
        .update(String(input.tools?.length ?? 0))
        .digest('hex');
}
async function classifyAI(client, input, haikuModel, opts) {
    const timeoutMs = opts?.timeoutMs ?? exports.DEFAULT_AI_TIMEOUT_MS;
    const start = performance.now();
    let response;
    try {
        response = await client.messages.create({
            model: haikuModel,
            max_tokens: 4,
            messages: [
                {
                    role: 'user',
                    content: `Task complexity 1-3. 1=simple factual/translation/formatting. 2=reasoning/code/analysis. 3=architecture/creative/multi-step. Reply with ONLY the number.\n\n${buildAISnippet(input)}`,
                },
            ],
        }, { signal: AbortSignal.timeout(timeoutMs) });
    }
    catch {
        // Haiku timeout/outage must never break routing — fall back to heuristic.
        return classifyHeuristic(input);
    }
    const ms = performance.now() - start;
    let level = 2; // default sonnet
    let cleanParse = false;
    const responseText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
    const digit = responseText.match(/[1-3]/);
    if (digit) {
        level = parseInt(digit[0], 10);
        cleanParse = true;
    }
    const tierMap = { 1: 'haiku', 2: 'sonnet', 3: 'opus' };
    const score = level === 1 ? 15 : level === 2 ? 50 : 85;
    return {
        tier: tierMap[level],
        score,
        method: 'ai',
        ms: Math.round(ms * 100) / 100,
        confidence: cleanParse ? 0.9 : 0.6,
    };
}
async function classifyAICached(client, input, haikuModel, opts) {
    const key = opts?.cache ? cacheKey(input) : null;
    if (key) {
        const hit = opts.cache.get(key);
        if (hit)
            return { ...hit, ms: 0, cached: true };
    }
    const result = await classifyAI(client, input, haikuModel, {
        timeoutMs: opts?.aiTimeoutMs,
    });
    // Only genuine AI verdicts are worth caching — heuristic fallbacks are free to recompute
    if (key && result.method === 'ai') {
        opts.cache.set(key, result);
    }
    return result;
}
async function classifyHybrid(client, input, haikuModel, opts) {
    const start = performance.now();
    const detail = heuristicScoreDetailed(input);
    const [bandLow, bandHigh] = opts?.hybridBand ?? exports.DEFAULT_HYBRID_BAND;
    // Confirm with AI when the score is ambiguous, or when the text produced no
    // keyword signals at all (non-English or otherwise unscorable content).
    const ambiguous = detail.score >= bandLow && detail.score <= bandHigh;
    const signalPoor = detail.keywordHits === 0 && detail.estimatedTokens >= SIGNAL_POOR_MIN_TOKENS;
    if (ambiguous || signalPoor) {
        return classifyAICached(client, input, haikuModel, opts);
    }
    const ms = performance.now() - start;
    return {
        tier: scoreToTier(detail.score, opts),
        score: detail.score,
        method: 'heuristic',
        ms: Math.round(ms * 100) / 100,
        confidence: Math.round(scoreToConfidence(detail.score) * 100) / 100,
    };
}
/**
 * Unified classification entry point used by both the library and the proxy.
 * Never throws: AI failures fall back to the heuristic result.
 */
async function classify(client, input, mode, haikuModel, opts) {
    if (mode === 'heuristic' || !client) {
        return classifyHeuristic(input, opts);
    }
    if (mode === 'ai') {
        return classifyAICached(client, input, haikuModel, opts);
    }
    return classifyHybrid(client, input, haikuModel, opts);
}
//# sourceMappingURL=classifier.js.map