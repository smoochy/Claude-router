"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LruCache = void 0;
/**
 * Minimal bounded LRU cache backed by Map insertion order.
 * Used for AI classification results and per-credential SDK clients.
 * A maxSize of 0 (or negative) disables storage entirely.
 */
class LruCache {
    maxSize;
    map = new Map();
    constructor(maxSize) {
        this.maxSize = maxSize;
    }
    get(key) {
        if (!this.map.has(key))
            return undefined;
        const value = this.map.get(key);
        // Refresh recency: re-insert so this key becomes newest
        this.map.delete(key);
        this.map.set(key, value);
        return value;
    }
    set(key, value) {
        if (this.maxSize <= 0)
            return;
        if (this.map.has(key))
            this.map.delete(key);
        this.map.set(key, value);
        if (this.map.size > this.maxSize) {
            // Oldest entry is the first key in insertion order
            const oldest = this.map.keys().next().value;
            this.map.delete(oldest);
        }
    }
    get size() {
        return this.map.size;
    }
    clear() {
        this.map.clear();
    }
}
exports.LruCache = LruCache;
//# sourceMappingURL=cache.js.map