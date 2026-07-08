import type { RouteEvent } from './handler.js';
/**
 * Persistent route history: one JSON line per event, append-only.
 * Powers `claude-router stats` and the dashboard's lifetime figures.
 */
export declare function appendEvent(file: string, event: RouteEvent): void;
export interface LifetimeStats {
    requests: number;
    costCents: number;
    savedCents: number;
    retried: number;
    tiers: Record<string, number>;
    /** Per-day aggregates keyed by YYYY-MM-DD */
    byDay: Record<string, {
        requests: number;
        costCents: number;
        savedCents: number;
    }>;
}
/** @internal Test hook */
export declare function resetHistoryCache(): void;
export declare function readLifetimeStats(file: string): LifetimeStats;
//# sourceMappingURL=history.d.ts.map