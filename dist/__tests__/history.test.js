"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const history_js_1 = require("../proxy/history.js");
function makeEvent(overrides = {}) {
    return {
        timestamp: '2026-07-02T10:00:00.000Z',
        tier: 'haiku',
        model: 'claude-haiku-4-5',
        costCents: 0.1,
        savedCents: 0.3,
        confidence: 0.9,
        classifier: 'heuristic',
        retried: false,
        retryReason: null,
        inputTokens: 100,
        outputTokens: 50,
        ...overrides,
    };
}
function tempFile() {
    const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'crouter-history-'));
    return node_path_1.default.join(dir, 'history.jsonl');
}
(0, node_test_1.describe)('history', () => {
    (0, node_test_1.beforeEach)(() => (0, history_js_1.resetHistoryCache)());
    (0, node_test_1.it)('appends and aggregates events', () => {
        const file = tempFile();
        (0, history_js_1.appendEvent)(file, makeEvent());
        (0, history_js_1.appendEvent)(file, makeEvent({ tier: 'opus', costCents: 2, savedCents: -1.5, retried: true, retryReason: 'truncation' }));
        const stats = (0, history_js_1.readLifetimeStats)(file);
        strict_1.default.equal(stats.requests, 2);
        strict_1.default.equal(Math.round(stats.costCents * 100) / 100, 2.1);
        strict_1.default.equal(Math.round(stats.savedCents * 100) / 100, -1.2);
        strict_1.default.equal(stats.retried, 1);
        strict_1.default.deepEqual(stats.tiers, { haiku: 1, opus: 1 });
        strict_1.default.equal(stats.byDay['2026-07-02'].requests, 2);
    });
    (0, node_test_1.it)('missing file yields empty stats', () => {
        const stats = (0, history_js_1.readLifetimeStats)(node_path_1.default.join(node_os_1.default.tmpdir(), 'nope', 'missing.jsonl'));
        strict_1.default.equal(stats.requests, 0);
        strict_1.default.equal(stats.savedCents, 0);
    });
    (0, node_test_1.it)('reads appended events incrementally after a cached read', () => {
        const file = tempFile();
        (0, history_js_1.appendEvent)(file, makeEvent());
        strict_1.default.equal((0, history_js_1.readLifetimeStats)(file).requests, 1);
        (0, history_js_1.appendEvent)(file, makeEvent({ timestamp: '2026-07-03T09:00:00.000Z', savedCents: 1 }));
        const stats = (0, history_js_1.readLifetimeStats)(file);
        strict_1.default.equal(stats.requests, 2);
        strict_1.default.equal(Math.round(stats.savedCents * 100) / 100, 1.3);
        strict_1.default.equal(Object.keys(stats.byDay).length, 2);
    });
    (0, node_test_1.it)('skips corrupt lines without losing valid ones', () => {
        const file = tempFile();
        (0, history_js_1.appendEvent)(file, makeEvent());
        node_fs_1.default.appendFileSync(file, 'this is not json\n{"also":"not an event"}\n', 'utf8');
        (0, history_js_1.appendEvent)(file, makeEvent({ savedCents: 0.5 }));
        const stats = (0, history_js_1.readLifetimeStats)(file);
        strict_1.default.equal(stats.requests, 2);
        strict_1.default.equal(Math.round(stats.savedCents * 100) / 100, 0.8);
    });
    (0, node_test_1.it)('appendEvent never throws on an unwritable path', () => {
        strict_1.default.doesNotThrow(() => (0, history_js_1.appendEvent)('\0invalid\0path', makeEvent()));
    });
});
//# sourceMappingURL=history.test.js.map