"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const classifier_js_1 = require("../classifier.js");
const cache_js_1 = require("../cache.js");
function makeInput(content, opts) {
    const messages = [];
    if (opts?.messageCount) {
        for (let i = 0; i < opts.messageCount; i++) {
            messages.push({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: i === opts.messageCount - 1 ? content : 'filler message',
            });
        }
    }
    else {
        messages.push({ role: 'user', content });
    }
    return { messages, system: opts?.system };
}
(0, node_test_1.describe)('scoreToTier', () => {
    (0, node_test_1.it)('maps low scores to haiku', () => {
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(0), 'haiku');
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(15), 'haiku');
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(29), 'haiku');
    });
    (0, node_test_1.it)('maps mid scores to sonnet', () => {
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(30), 'sonnet');
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(50), 'sonnet');
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(70), 'sonnet');
    });
    (0, node_test_1.it)('maps high scores to opus', () => {
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(71), 'opus');
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(85), 'opus');
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(100), 'opus');
    });
});
(0, node_test_1.describe)('heuristicScore', () => {
    (0, node_test_1.it)('simple translation → haiku', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('translate hello to French'));
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(score), 'haiku');
    });
    (0, node_test_1.it)('explain React hooks → sonnet', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('explain how React hooks work and compare useState with useReducer'));
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(score), 'sonnet');
    });
    (0, node_test_1.it)('design distributed system → opus', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('architect and design a distributed system for real-time event processing that can evaluate and strategize about scaling patterns across multiple regions with comprehensive fault tolerance'));
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(score), 'opus');
    });
    (0, node_test_1.it)('code block presence bumps score', () => {
        const without = (0, classifier_js_1.heuristicScore)(makeInput('fix this function'));
        const with_ = (0, classifier_js_1.heuristicScore)(makeInput('fix this function ```\nconst x = 1;\n```'));
        strict_1.default.ok(with_ > without, `with code (${with_}) should be higher than without (${without})`);
    });
    (0, node_test_1.it)('long system prompt bumps score', () => {
        const short = (0, classifier_js_1.heuristicScore)(makeInput('hello', { system: 'Be helpful.' }));
        const long = (0, classifier_js_1.heuristicScore)(makeInput('hello', { system: 'A'.repeat(600) }));
        strict_1.default.ok(long > short, `long system (${long}) should be higher than short (${short})`);
    });
    (0, node_test_1.it)('multi-turn (>5 messages) bumps score', () => {
        const few = (0, classifier_js_1.heuristicScore)(makeInput('continue', { messageCount: 2 }));
        const many = (0, classifier_js_1.heuristicScore)(makeInput('continue', { messageCount: 8 }));
        strict_1.default.ok(many > few, `many turns (${many}) should be higher than few (${few})`);
    });
    (0, node_test_1.it)('multi-turn (>15 messages) bumps more', () => {
        const mid = (0, classifier_js_1.heuristicScore)(makeInput('continue', { messageCount: 8 }));
        const lots = (0, classifier_js_1.heuristicScore)(makeInput('continue', { messageCount: 18 }));
        strict_1.default.ok(lots > mid, `18 turns (${lots}) should be higher than 8 (${mid})`);
    });
    (0, node_test_1.it)('empty prompt → haiku (safe default)', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput(''));
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(score), 'haiku');
    });
    (0, node_test_1.it)('score is clamped 0–100', () => {
        // Many simple verbs → should not go below 0
        const low = (0, classifier_js_1.heuristicScore)(makeInput('translate summarize format convert list extract define count repeat spell'));
        strict_1.default.ok(low >= 0, `score should be >= 0, got ${low}`);
        strict_1.default.ok(low <= 100, `score should be <= 100, got ${low}`);
    });
    // --- Math/science domain: short queries must not route to haiku ---
    (0, node_test_1.it)('short math theorem query → opus', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('Prove Fermat Last Theorem'));
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(score), 'opus', `score=${score}`);
    });
    (0, node_test_1.it)('P=NP question → opus', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('P=NP?'));
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(score), 'opus', `score=${score}`);
    });
    (0, node_test_1.it)('Riemann Hypothesis → opus', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('Prove the Riemann Hypothesis'));
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(score), 'opus', `score=${score}`);
    });
    (0, node_test_1.it)('quantum entanglement question → opus', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('explain quantum entanglement and wave function collapse'));
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(score), 'opus', `score=${score}`);
    });
    (0, node_test_1.it)('NP-hard complexity → at least sonnet (not haiku)', () => {
        // "Is 3-SAT NP-hard?" is a factual yes/no question — sonnet is correct routing.
        // Key requirement: must NOT route to haiku.
        const score = (0, classifier_js_1.heuristicScore)(makeInput('Is 3-SAT NP-hard?'));
        strict_1.default.ok((0, classifier_js_1.scoreToTier)(score) !== 'haiku', `NP-hard should not route to haiku, score=${score}`);
    });
    (0, node_test_1.it)('eigenvalue computation → opus', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('compute eigenvalues of this matrix'));
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(score), 'opus', `score=${score}`);
    });
    (0, node_test_1.it)('integral calculus → opus', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('solve this differential equation using integral transform'));
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(score), 'opus', `score=${score}`);
    });
    (0, node_test_1.it)('math notation (integral symbol) → high score', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('∫f(x)dx'));
        strict_1.default.ok(score >= 50, `integral symbol should bump score >= 50, got ${score}`);
    });
    (0, node_test_1.it)('LaTeX math → high score', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('compute \\int_0^\\infty e^{-x} dx using \\frac{1}{s}'));
        strict_1.default.ok(score >= 50, `LaTeX math should bump score >= 50, got ${score}`);
    });
    (0, node_test_1.it)('simple factual (no math) → still low', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('what is the capital of France'));
        strict_1.default.ok(score < 70, `non-math factual should not reach opus, got ${score}`);
    });
});
(0, node_test_1.describe)('scoreToConfidence', () => {
    (0, node_test_1.it)('extreme scores → high confidence', () => {
        strict_1.default.equal((0, classifier_js_1.scoreToConfidence)(0), 1.0);
        strict_1.default.equal((0, classifier_js_1.scoreToConfidence)(100), 1.0);
    });
    (0, node_test_1.it)('center score → low confidence', () => {
        strict_1.default.equal((0, classifier_js_1.scoreToConfidence)(50), 0.5);
    });
    (0, node_test_1.it)('near-boundary scores → moderate confidence', () => {
        const conf40 = (0, classifier_js_1.scoreToConfidence)(40);
        const conf60 = (0, classifier_js_1.scoreToConfidence)(60);
        strict_1.default.ok(conf40 > 0.5 && conf40 < 1.0, `conf at 40: ${conf40}`);
        strict_1.default.ok(conf60 > 0.5 && conf60 < 1.0, `conf at 60: ${conf60}`);
        // Symmetric
        strict_1.default.equal(conf40, conf60);
    });
    (0, node_test_1.it)('confidence increases with distance from center', () => {
        strict_1.default.ok((0, classifier_js_1.scoreToConfidence)(20) > (0, classifier_js_1.scoreToConfidence)(40));
        strict_1.default.ok((0, classifier_js_1.scoreToConfidence)(80) > (0, classifier_js_1.scoreToConfidence)(60));
    });
});
(0, node_test_1.describe)('classifyHeuristic', () => {
    (0, node_test_1.it)('returns full ClassifyResult with confidence', () => {
        const result = (0, classifier_js_1.classifyHeuristic)(makeInput('translate hello'));
        strict_1.default.equal(result.method, 'heuristic');
        strict_1.default.equal(typeof result.score, 'number');
        strict_1.default.equal(typeof result.ms, 'number');
        strict_1.default.equal(typeof result.confidence, 'number');
        strict_1.default.ok(result.confidence >= 0 && result.confidence <= 1);
        strict_1.default.ok(result.ms >= 0);
        strict_1.default.ok(['haiku', 'sonnet', 'opus'].includes(result.tier));
    });
});
function mockClient(responseText) {
    return {
        messages: {
            create: node_test_1.mock.fn(async () => ({
                content: responseText ? [{ type: 'text', text: responseText }] : [],
            })),
        },
    };
}
function mockClientEmpty() {
    return {
        messages: {
            create: node_test_1.mock.fn(async () => ({
                content: [],
            })),
        },
    };
}
(0, node_test_1.describe)('classifyAI', () => {
    (0, node_test_1.it)('returns haiku for "1"', async () => {
        const result = await (0, classifier_js_1.classifyAI)(mockClient('1'), makeInput('test'), 'claude-haiku-4-5-20251001');
        strict_1.default.equal(result.tier, 'haiku');
        strict_1.default.equal(result.confidence, 0.9);
        strict_1.default.equal(result.method, 'ai');
    });
    (0, node_test_1.it)('returns sonnet for "2"', async () => {
        const result = await (0, classifier_js_1.classifyAI)(mockClient('2'), makeInput('test'), 'claude-haiku-4-5-20251001');
        strict_1.default.equal(result.tier, 'sonnet');
        strict_1.default.equal(result.confidence, 0.9);
    });
    (0, node_test_1.it)('returns opus for "3"', async () => {
        const result = await (0, classifier_js_1.classifyAI)(mockClient('3'), makeInput('test'), 'claude-haiku-4-5-20251001');
        strict_1.default.equal(result.tier, 'opus');
        strict_1.default.equal(result.confidence, 0.9);
    });
    (0, node_test_1.it)('defaults to sonnet on garbage response', async () => {
        const result = await (0, classifier_js_1.classifyAI)(mockClient('banana'), makeInput('test'), 'claude-haiku-4-5-20251001');
        strict_1.default.equal(result.tier, 'sonnet');
        strict_1.default.equal(result.confidence, 0.6);
    });
    (0, node_test_1.it)('defaults to sonnet on empty content', async () => {
        const result = await (0, classifier_js_1.classifyAI)(mockClientEmpty(), makeInput('test'), 'claude-haiku-4-5-20251001');
        strict_1.default.equal(result.tier, 'sonnet');
        strict_1.default.equal(result.confidence, 0.6);
    });
});
(0, node_test_1.describe)('classifyHybrid', () => {
    (0, node_test_1.it)('uses heuristic for clear haiku (score<40)', async () => {
        const client = mockClient('1');
        const result = await (0, classifier_js_1.classifyHybrid)(client, makeInput('translate hello'), 'claude-haiku-4-5-20251001');
        strict_1.default.equal(result.method, 'heuristic');
        // AI should NOT have been called
        strict_1.default.equal(client.messages.create.mock.calls.length, 0);
    });
    (0, node_test_1.it)('uses heuristic for clear opus (score>60)', async () => {
        const client = mockClient('3');
        const input = makeInput('architect and design a distributed system, evaluate tradeoffs, strategize about scaling and prove correctness');
        const result = await (0, classifier_js_1.classifyHybrid)(client, input, 'claude-haiku-4-5-20251001');
        strict_1.default.equal(result.method, 'heuristic');
        strict_1.default.equal(client.messages.create.mock.calls.length, 0);
    });
    (0, node_test_1.it)('calls AI for ambiguous zone (score 40-60)', async () => {
        const client = mockClient('2');
        // This prompt scores 45 — in the ambiguous 40-60 zone
        const input = makeInput('explain compare write generate describe this code');
        const score = (0, classifier_js_1.heuristicScore)(input);
        strict_1.default.ok(score >= 40 && score <= 60, `expected score 40-60, got ${score}`);
        const result = await (0, classifier_js_1.classifyHybrid)(client, input, 'claude-haiku-4-5-20251001');
        strict_1.default.equal(result.method, 'ai');
        strict_1.default.equal(client.messages.create.mock.calls.length, 1);
    });
    (0, node_test_1.it)('calls AI for signal-poor non-English prompts outside the band', async () => {
        const client = mockClient('2');
        // No English keywords fire, but the text is substantive (>20 est. tokens)
        const input = makeInput('напиши будь ласка довгий детальний огляд цієї архітектури і поясни компроміси між рішеннями');
        const detail = (0, classifier_js_1.heuristicScoreDetailed)(input);
        strict_1.default.equal(detail.keywordHits, 0, 'expected no keyword hits');
        await (0, classifier_js_1.classifyHybrid)(client, input, 'claude-haiku-4-5-20251001');
        strict_1.default.equal(client.messages.create.mock.calls.length, 1);
    });
    (0, node_test_1.it)('respects a custom hybrid band', async () => {
        const client = mockClient('2');
        const input = makeInput('translate hello'); // clear haiku score, outside default band
        const score = (0, classifier_js_1.heuristicScore)(input);
        await (0, classifier_js_1.classifyHybrid)(client, input, 'claude-haiku-4-5-20251001', {
            hybridBand: [Math.max(0, score - 1), score + 1],
        });
        strict_1.default.equal(client.messages.create.mock.calls.length, 1);
    });
});
(0, node_test_1.describe)('heuristicScore — word boundaries', () => {
    (0, node_test_1.it)('"listen" does not match simple verb "list"', () => {
        const withFalsePositive = (0, classifier_js_1.heuristicScore)(makeInput('listen to this song and name the tempo'));
        const withRealMatch = (0, classifier_js_1.heuristicScore)(makeInput('list to this song and name the tempo'));
        strict_1.default.ok(withFalsePositive > withRealMatch, 'listen must not get the simple-verb penalty');
    });
    (0, node_test_1.it)('"planets" does not match complex verb "plan"', () => {
        const withFalsePositive = (0, classifier_js_1.heuristicScore)(makeInput('the planets orbit the sun'));
        const withRealMatch = (0, classifier_js_1.heuristicScore)(makeInput('the plan orbit the sun'));
        strict_1.default.ok(withFalsePositive < withRealMatch, 'planets must not get the complex-verb bonus');
    });
    (0, node_test_1.it)('plural forms still match ("eigenvalues")', () => {
        const score = (0, classifier_js_1.heuristicScore)(makeInput('Compute the eigenvalues of A'));
        strict_1.default.ok(score > 50, `expected math signal to fire, got ${score}`);
    });
});
(0, node_test_1.describe)('heuristicScore — token branches', () => {
    (0, node_test_1.it)('very long prompts (>2000 tokens) score higher than long prompts (>500)', () => {
        const long = (0, classifier_js_1.heuristicScore)(makeInput('word '.repeat(500))); // ~625 tokens
        const veryLong = (0, classifier_js_1.heuristicScore)(makeInput('word '.repeat(2000))); // ~2500 tokens
        strict_1.default.ok(veryLong > long, `expected ${veryLong} > ${long}`);
    });
});
(0, node_test_1.describe)('heuristicScore — tool and image signals', () => {
    const base = makeInput('what is the weather');
    (0, node_test_1.it)('tool_use blocks raise the score', () => {
        const withTools = {
            messages: [
                { role: 'user', content: 'what is the weather' },
                {
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: 't1', name: 'get_weather', input: {} }],
                },
            ],
        };
        strict_1.default.ok((0, classifier_js_1.heuristicScore)(withTools) > (0, classifier_js_1.heuristicScore)(base));
    });
    (0, node_test_1.it)('tool_result content counts toward token estimate, not keywords', () => {
        const bigResult = {
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'tool_result', tool_use_id: 't1', content: 'translate list count '.repeat(500) },
                    ],
                },
            ],
        };
        // 10500 chars of tool output → >2000 est. tokens, but the simple verbs
        // inside the tool output must NOT apply their -12 penalties
        const detail = (0, classifier_js_1.heuristicScoreDetailed)(bigResult);
        strict_1.default.ok(detail.estimatedTokens > 2000);
        strict_1.default.equal(detail.keywordHits, 0);
    });
    (0, node_test_1.it)('defined tools raise the score, many tools raise it more', () => {
        const fewTools = { ...base, tools: [{}, {}] };
        const manyTools = { ...base, tools: Array.from({ length: 10 }, () => ({})) };
        strict_1.default.ok((0, classifier_js_1.heuristicScore)(fewTools) > (0, classifier_js_1.heuristicScore)(base));
        strict_1.default.ok((0, classifier_js_1.heuristicScore)(manyTools) > (0, classifier_js_1.heuristicScore)(fewTools));
    });
    (0, node_test_1.it)('image blocks raise the score', () => {
        const withImage = {
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'what is the weather' },
                        {
                            type: 'image',
                            source: { type: 'base64', media_type: 'image/png', data: '' },
                        },
                    ],
                },
            ],
        };
        strict_1.default.ok((0, classifier_js_1.heuristicScore)(withImage) > (0, classifier_js_1.heuristicScore)(base));
    });
});
(0, node_test_1.describe)('scoreToTier — custom thresholds', () => {
    (0, node_test_1.it)('haikuMax override widens the haiku band', () => {
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(35), 'sonnet');
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(35, { haikuMax: 40 }), 'haiku');
    });
    (0, node_test_1.it)('opusMin override widens the opus band', () => {
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(65), 'sonnet');
        strict_1.default.equal((0, classifier_js_1.scoreToTier)(65, { opusMin: 60 }), 'opus');
    });
});
(0, node_test_1.describe)('classifyAI — hardening', () => {
    (0, node_test_1.it)('falls back to heuristic when the API call rejects', async () => {
        const client = {
            messages: { create: node_test_1.mock.fn(async () => { throw new Error('network down'); }) },
        };
        const result = await (0, classifier_js_1.classifyAI)(client, makeInput('translate hello'), 'claude-haiku-4-5-20251001');
        strict_1.default.equal(result.method, 'heuristic');
        strict_1.default.equal(result.tier, 'haiku');
    });
    (0, node_test_1.it)('falls back to heuristic on timeout', async () => {
        const client = {
            messages: {
                create: node_test_1.mock.fn((_params, opts) => new Promise((_resolve, reject) => {
                    // Ref'd timer keeps the event loop alive: AbortSignal.timeout's
                    // internal timer is unref'd, so on Node 18/22 the loop would
                    // otherwise drain before the abort ever fires.
                    const failsafe = setTimeout(() => reject(new Error('abort never fired')), 5000);
                    opts?.signal?.addEventListener('abort', () => {
                        clearTimeout(failsafe);
                        reject(opts.signal.reason);
                    });
                })),
            },
        };
        const result = await (0, classifier_js_1.classifyAI)(client, makeInput('translate hello'), 'claude-haiku-4-5-20251001', {
            timeoutMs: 20,
        });
        strict_1.default.equal(result.method, 'heuristic');
    });
    (0, node_test_1.it)('parses the digit from any text block, not just the first', async () => {
        const client = {
            messages: {
                create: node_test_1.mock.fn(async () => ({
                    content: [
                        { type: 'tool_use', id: 'x', name: 'noop', input: {} },
                        { type: 'text', text: 'complexity: 3' },
                    ],
                })),
            },
        };
        const result = await (0, classifier_js_1.classifyAI)(client, makeInput('test'), 'claude-haiku-4-5-20251001');
        strict_1.default.equal(result.tier, 'opus');
        strict_1.default.equal(result.confidence, 0.9);
    });
    (0, node_test_1.it)('sends system snippet and head+tail of long prompts', async () => {
        const client = mockClient('2');
        const longText = 'A'.repeat(800) + 'MIDDLE' + 'Z'.repeat(800);
        await (0, classifier_js_1.classifyAI)(client, makeInput(longText, { system: 'You are a legal expert' }), 'claude-haiku-4-5-20251001');
        const createMock = client.messages.create;
        const params = createMock.mock.calls[0].arguments[0];
        const prompt = params.messages[0].content;
        strict_1.default.ok(prompt.includes('System: You are a legal expert'));
        strict_1.default.ok(prompt.includes('AAA'), 'head of prompt missing');
        strict_1.default.ok(prompt.includes('ZZZ'), 'tail of prompt missing');
        strict_1.default.ok(!prompt.includes('MIDDLE'), 'middle should be elided');
    });
});
(0, node_test_1.describe)('classify — unified entry with cache', () => {
    (0, node_test_1.it)('identical inputs hit the cache, calling the API only once', async () => {
        const client = mockClient('3');
        const cache = new cache_js_1.LruCache(10);
        const input = makeInput('test prompt');
        const first = await (0, classifier_js_1.classify)(client, input, 'ai', 'claude-haiku-4-5-20251001', { cache });
        const second = await (0, classifier_js_1.classify)(client, input, 'ai', 'claude-haiku-4-5-20251001', { cache });
        strict_1.default.equal(client.messages.create.mock.calls.length, 1);
        strict_1.default.equal(first.tier, 'opus');
        strict_1.default.equal(second.tier, 'opus');
        strict_1.default.ok(!first.cached);
        strict_1.default.equal(second.cached, true);
    });
    (0, node_test_1.it)('different inputs are classified separately', async () => {
        const client = mockClient('2');
        const cache = new cache_js_1.LruCache(10);
        await (0, classifier_js_1.classify)(client, makeInput('first prompt'), 'ai', 'claude-haiku-4-5-20251001', { cache });
        await (0, classifier_js_1.classify)(client, makeInput('second prompt'), 'ai', 'claude-haiku-4-5-20251001', { cache });
        strict_1.default.equal(client.messages.create.mock.calls.length, 2);
    });
    (0, node_test_1.it)('heuristic fallbacks are not cached', async () => {
        let failures = 0;
        const client = {
            messages: {
                create: node_test_1.mock.fn(async () => {
                    failures++;
                    throw new Error('down');
                }),
            },
        };
        const cache = new cache_js_1.LruCache(10);
        const input = makeInput('test prompt');
        await (0, classifier_js_1.classify)(client, input, 'ai', 'claude-haiku-4-5-20251001', { cache });
        await (0, classifier_js_1.classify)(client, input, 'ai', 'claude-haiku-4-5-20251001', { cache });
        strict_1.default.equal(failures, 2, 'second call should retry the AI, not serve a cached fallback');
        strict_1.default.equal(cache.size, 0);
    });
    (0, node_test_1.it)('heuristic mode never touches the client', async () => {
        const client = mockClient('3');
        const result = await (0, classifier_js_1.classify)(client, makeInput('translate hello'), 'heuristic', 'claude-haiku-4-5-20251001');
        strict_1.default.equal(result.method, 'heuristic');
        strict_1.default.equal(client.messages.create.mock.calls.length, 0);
    });
});
//# sourceMappingURL=classifier.test.js.map