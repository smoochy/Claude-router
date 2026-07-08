"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.term = void 0;
exports.stripAnsi = stripAnsi;
exports.supportsColor = supportsColor;
exports.createTerm = createTerm;
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s) {
    return s.replace(ANSI_RE, '');
}
function supportsColor(stream = process.stdout) {
    if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0')
        return true;
    if (process.env.NO_COLOR)
        return false;
    if (process.env.TERM === 'dumb')
        return false;
    return Boolean(stream.isTTY);
}
function createTerm(opts) {
    const enabled = opts?.forceColor ?? supportsColor();
    const wrap = (open, close = '\x1b[39m') => enabled ? (s) => `\x1b[${open}m${s}${close}` : (s) => s;
    // Claude Code's warm coral/orange brand accent (256-color)
    const accent = enabled ? (s) => `\x1b[38;5;209m${s}\x1b[39m` : (s) => s;
    const red = wrap('31');
    const green = wrap('32');
    const yellow = wrap('33');
    const cyan = wrap('36');
    const magenta = wrap('35');
    const dim = enabled ? (s) => `\x1b[2m${s}\x1b[22m` : (s) => s;
    const bold = enabled ? (s) => `\x1b[1m${s}\x1b[22m` : (s) => s;
    const tierColors = {
        haiku: cyan,
        sonnet: yellow,
        opus: magenta,
    };
    const tier = (t) => (tierColors[t] ?? ((s) => s))(t);
    const box = (title, rows) => {
        const labelWidth = Math.max(0, ...rows.map(([label]) => label.length));
        const lines = rows.map(([label, value]) => `${dim(label.padEnd(labelWidth))}  ${value}`);
        const contentWidth = Math.max(stripAnsi(title).length + 1, ...lines.map((l) => stripAnsi(l).length));
        const top = `╭─ ${bold(title)} ${'─'.repeat(contentWidth - stripAnsi(title).length - 1)}╮`;
        const body = lines.map((l) => `│ ${l}${' '.repeat(contentWidth - stripAnsi(l).length)} │`);
        const bottom = `╰${'─'.repeat(contentWidth + 2)}╯`;
        return [top, ...body, bottom].join('\n');
    };
    return {
        accent,
        red,
        green,
        yellow,
        cyan,
        magenta,
        dim,
        bold,
        tier,
        ok: () => green('✓'),
        fail: () => red('✗'),
        warn: () => yellow('!'),
        errorLine: (msg) => console.error(red(`✗ ${msg}`)),
        box,
        enabled,
    };
}
/** Shared default instance for stdout */
exports.term = createTerm();
//# sourceMappingURL=term.js.map