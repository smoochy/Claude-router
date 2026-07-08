import type { RouteMeta, RouterStats } from './types.js';
export declare class CostTracker {
    private totalCost;
    private totalSaved;
    private count;
    private breakdown;
    record(meta: RouteMeta): void;
    stats(): RouterStats;
    reset(): void;
}
//# sourceMappingURL=tracker.d.ts.map