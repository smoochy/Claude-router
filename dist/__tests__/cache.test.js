"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const cache_js_1 = require("../cache.js");
(0, node_test_1.describe)('LruCache', () => {
    (0, node_test_1.it)('stores and retrieves values', () => {
        const cache = new cache_js_1.LruCache(3);
        cache.set('a', 1);
        cache.set('b', 2);
        strict_1.default.equal(cache.get('a'), 1);
        strict_1.default.equal(cache.get('b'), 2);
        strict_1.default.equal(cache.get('missing'), undefined);
        strict_1.default.equal(cache.size, 2);
    });
    (0, node_test_1.it)('evicts the oldest entry when over capacity', () => {
        const cache = new cache_js_1.LruCache(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        strict_1.default.equal(cache.get('a'), undefined);
        strict_1.default.equal(cache.get('b'), 2);
        strict_1.default.equal(cache.get('c'), 3);
        strict_1.default.equal(cache.size, 2);
    });
    (0, node_test_1.it)('get refreshes recency so recently-read keys survive eviction', () => {
        const cache = new cache_js_1.LruCache(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.get('a'); // 'a' is now newest; 'b' is oldest
        cache.set('c', 3);
        strict_1.default.equal(cache.get('a'), 1);
        strict_1.default.equal(cache.get('b'), undefined);
    });
    (0, node_test_1.it)('set on an existing key updates value without growing size', () => {
        const cache = new cache_js_1.LruCache(2);
        cache.set('a', 1);
        cache.set('a', 10);
        strict_1.default.equal(cache.get('a'), 10);
        strict_1.default.equal(cache.size, 1);
    });
    (0, node_test_1.it)('maxSize 0 disables storage', () => {
        const cache = new cache_js_1.LruCache(0);
        cache.set('a', 1);
        strict_1.default.equal(cache.get('a'), undefined);
        strict_1.default.equal(cache.size, 0);
    });
    (0, node_test_1.it)('clear empties the cache', () => {
        const cache = new cache_js_1.LruCache(5);
        cache.set('a', 1);
        cache.clear();
        strict_1.default.equal(cache.size, 0);
        strict_1.default.equal(cache.get('a'), undefined);
    });
});
//# sourceMappingURL=cache.test.js.map