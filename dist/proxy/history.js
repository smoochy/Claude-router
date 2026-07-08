"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendEvent = appendEvent;
exports.resetHistoryCache = resetHistoryCache;
exports.readLifetimeStats = readLifetimeStats;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Persistent route history: one JSON line per event, append-only.
 * Powers `claude-router stats` and the dashboard's lifetime figures.
 */
function appendEvent(file, event) {
    try {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
        node_fs_1.default.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
    }
    catch {
        // History is best-effort — never let persistence break a request.
    }
}
function emptyStats() {
    return { requests: 0, costCents: 0, savedCents: 0, retried: 0, tiers: {}, byDay: {} };
}
function fold(stats, line) {
    let event;
    try {
        event = JSON.parse(line);
    }
    catch {
        return; // skip corrupt lines rather than losing the whole history
    }
    if (typeof event?.costCents !== 'number')
        return;
    stats.requests++;
    stats.costCents += event.costCents;
    stats.savedCents += event.savedCents;
    if (event.retried)
        stats.retried++;
    stats.tiers[event.tier] = (stats.tiers[event.tier] ?? 0) + 1;
    const day = String(event.timestamp ?? '').slice(0, 10);
    if (day) {
        const d = (stats.byDay[day] ??= { requests: 0, costCents: 0, savedCents: 0 });
        d.requests++;
        d.costCents += event.costCents;
        d.savedCents += event.savedCents;
    }
}
// Incremental cache: the file is append-only, so once a prefix is folded we
// only ever need to read the newly-appended bytes.
let cached = null;
/** @internal Test hook */
function resetHistoryCache() {
    cached = null;
}
function readLifetimeStats(file) {
    let size;
    try {
        size = node_fs_1.default.statSync(file).size;
    }
    catch {
        return emptyStats();
    }
    if (!cached || cached.file !== file || size < cached.offset) {
        cached = { file, offset: 0, stats: emptyStats() };
    }
    if (size === cached.offset)
        return cached.stats;
    try {
        const fd = node_fs_1.default.openSync(file, 'r');
        try {
            const buf = Buffer.alloc(size - cached.offset);
            node_fs_1.default.readSync(fd, buf, 0, buf.length, cached.offset);
            const text = buf.toString('utf8');
            // Only fold complete lines; keep the offset at the last newline so a
            // partially-written trailing line is picked up next read.
            const lastNewline = text.lastIndexOf('\n');
            if (lastNewline >= 0) {
                for (const line of text.slice(0, lastNewline).split('\n')) {
                    if (line.trim())
                        fold(cached.stats, line);
                }
                cached.offset += lastNewline + 1;
            }
        }
        finally {
            node_fs_1.default.closeSync(fd);
        }
    }
    catch {
        // Unreadable — serve what we have
    }
    return cached.stats;
}
//# sourceMappingURL=history.js.map