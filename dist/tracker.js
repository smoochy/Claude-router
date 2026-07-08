"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostTracker = void 0;
class CostTracker {
    totalCost = 0;
    totalSaved = 0;
    count = 0;
    breakdown = { haiku: 0, sonnet: 0, opus: 0 };
    record(meta) {
        this.totalCost += meta.costCents;
        this.totalSaved += meta.savedCents;
        this.count++;
        this.breakdown[meta.tier]++;
    }
    stats() {
        return {
            totalCostCents: Math.round(this.totalCost * 1000) / 1000,
            totalSavedCents: Math.round(this.totalSaved * 1000) / 1000,
            callCount: this.count,
            tierBreakdown: { ...this.breakdown },
        };
    }
    reset() {
        this.totalCost = 0;
        this.totalSaved = 0;
        this.count = 0;
        this.breakdown = { haiku: 0, sonnet: 0, opus: 0 };
    }
}
exports.CostTracker = CostTracker;
//# sourceMappingURL=tracker.js.map