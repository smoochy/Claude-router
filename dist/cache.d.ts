/**
 * Minimal bounded LRU cache backed by Map insertion order.
 * Used for AI classification results and per-credential SDK clients.
 * A maxSize of 0 (or negative) disables storage entirely.
 */
export declare class LruCache<K, V> {
    private maxSize;
    private map;
    constructor(maxSize: number);
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    get size(): number;
    clear(): void;
}
//# sourceMappingURL=cache.d.ts.map