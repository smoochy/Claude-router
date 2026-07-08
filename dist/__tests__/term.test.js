"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const term_js_1 = require("../proxy/term.js");
(0, node_test_1.describe)('term — color control', () => {
    (0, node_test_1.it)('forceColor: true emits ANSI codes', () => {
        const t = (0, term_js_1.createTerm)({ forceColor: true });
        strict_1.default.ok(t.enabled);
        strict_1.default.notEqual(t.red('x'), 'x');
        strict_1.default.ok(t.red('x').includes('\x1b['));
    });
    (0, node_test_1.it)('forceColor: false is identity for all styles', () => {
        const t = (0, term_js_1.createTerm)({ forceColor: false });
        strict_1.default.ok(!t.enabled);
        for (const fn of [t.accent, t.red, t.green, t.yellow, t.cyan, t.magenta, t.dim, t.bold]) {
            strict_1.default.equal(fn('hello'), 'hello');
        }
        strict_1.default.equal(t.ok(), '✓');
        strict_1.default.equal(t.fail(), '✗');
        strict_1.default.equal(t.warn(), '!');
    });
    (0, node_test_1.it)('tier maps each tier to a distinct color', () => {
        const t = (0, term_js_1.createTerm)({ forceColor: true });
        const rendered = [t.tier('haiku'), t.tier('sonnet'), t.tier('opus')];
        strict_1.default.equal((0, term_js_1.stripAnsi)(rendered[0]), 'haiku');
        strict_1.default.equal((0, term_js_1.stripAnsi)(rendered[1]), 'sonnet');
        strict_1.default.equal((0, term_js_1.stripAnsi)(rendered[2]), 'opus');
        strict_1.default.equal(new Set(rendered.map((r) => r.slice(0, 5))).size, 3);
    });
    (0, node_test_1.it)('tier passes through unknown values unstyled', () => {
        const t = (0, term_js_1.createTerm)({ forceColor: true });
        strict_1.default.equal(t.tier('pass'), 'pass');
    });
});
(0, node_test_1.describe)('term — stripAnsi', () => {
    (0, node_test_1.it)('removes SGR sequences', () => {
        strict_1.default.equal((0, term_js_1.stripAnsi)('\x1b[31mred\x1b[39m plain \x1b[38;5;209maccent\x1b[39m'), 'red plain accent');
    });
    (0, node_test_1.it)('leaves plain text untouched', () => {
        strict_1.default.equal((0, term_js_1.stripAnsi)('no codes here'), 'no codes here');
    });
});
(0, node_test_1.describe)('term — box', () => {
    (0, node_test_1.it)('all lines have equal visible width', () => {
        const t = (0, term_js_1.createTerm)({ forceColor: true });
        const out = t.box('claude-router', [
            ['URL', 'http://localhost:65535'],
            ['Provider', t.tier('sonnet')],
            ['Config', 'C:\\Users\\Someone With Long Name\\.claude-router\\config.json'],
        ]);
        const widths = out.split('\n').map((l) => (0, term_js_1.stripAnsi)(l).length);
        strict_1.default.ok(widths.length >= 4);
        strict_1.default.equal(new Set(widths).size, 1, `uneven box: ${JSON.stringify(widths)}`);
    });
    (0, node_test_1.it)('handles a 5-digit port and colored values without breaking alignment', () => {
        const t = (0, term_js_1.createTerm)({ forceColor: true });
        const out = t.box('T', [['Port', t.accent('12345')]]);
        const lines = out.split('\n').map((l) => (0, term_js_1.stripAnsi)(l));
        for (const line of lines.slice(1, -1)) {
            strict_1.default.ok(line.startsWith('│') && line.endsWith('│'), `bad row: ${line}`);
        }
        strict_1.default.equal(new Set(lines.map((l) => l.length)).size, 1);
    });
    (0, node_test_1.it)('works with colors disabled', () => {
        const t = (0, term_js_1.createTerm)({ forceColor: false });
        const out = t.box('Title', [['A', '1'], ['Longer label', '2']]);
        const widths = out.split('\n').map((l) => l.length);
        strict_1.default.equal(new Set(widths).size, 1);
    });
});
//# sourceMappingURL=term.test.js.map