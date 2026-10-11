import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCostCents, computeRouteCost, pricingTableFromList } from '../models.js';

const entry = (extra: object = {}) => ({
  id: 'claude-haiku-5-5',
  created_at: '2026-10-07T00:00:00Z',
  pricing: { input: 0.1, output: 0.5, cache_read: 0.01, cache_write_5m: 0.125, cache_write_1h: 0.2 },
  ...extra,
});
const lc = { threshold_input_tokens: 100000, input: 0.5, output: 2.5, cache_read: 0.05, cache_write_5m: 0.625, cache_write_1h: 1 };
const T = pricingTableFromList([
  entry({ pricing_long_context: lc }),
  { id: 'claude-sonnet-5', created_at: '2026-06-29T00:00:00Z', pricing: { input: 2, output: 10, cache_read: 0.2, cache_write_5m: 2.5, cache_write_1h: 4 } },
]);
const cost = (model: string, inp: number, out: number, cache?: { readTokens?: number; creationTokens?: number }) =>
  computeCostCents(model, inp, out, T, cache);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

describe('long-context tier', () => {
  it('reads the tier from the list', () => {
    assert.deepEqual(T['claude-haiku-5-5'].longContext, { thresholdInputTokens: 100000, input: 0.5, output: 2.5, cacheRead: 0.1 });
    assert.equal(T['claude-sonnet-5'].longContext, undefined);
  });

  it('prices a request over the threshold at 0.50/2.50 and at the threshold at 0.10/0.50', () => {
    near(cost('claude-haiku-5-5', 100_001, 1_000_000), (0.0500005 + 2.5) * 100);
    near(cost('claude-haiku-5-5', 100_000, 1_000_000), (0.01 + 0.5) * 100);
  });

  it('counts cache reads and writes toward the threshold and bills them at the upper tier', () => {
    // 50k + 40k read + 10k write = 100k: not above, base tier.
    near(cost('claude-haiku-5-5', 50_000, 0, { readTokens: 40_000, creationTokens: 10_000 }),
      (50_000 * 0.1 + 40_000 * 0.1 * 0.1 + 10_000 * 0.1 * 1.25) / 1e4);
    // One more cache-read token tips it over; every component uses the upper tier.
    near(cost('claude-haiku-5-5', 50_000, 0, { readTokens: 40_001, creationTokens: 10_000 }),
      (50_000 * 0.5 + 40_001 * 0.5 * 0.1 + 10_000 * 0.5 * 1.25) / 1e4);
  });

  it('keeps a single price for a model without tiers', () => {
    near(cost('claude-sonnet-5', 500_000, 0), 100);
  });

  it('drops a malformed tier', () => {
    const t = pricingTableFromList([entry({ pricing_long_context: { ...lc, threshold_input_tokens: 0 } })]);
    assert.equal(t['claude-haiku-5-5'].longContext, undefined);
  });

  it('savedCents follows the baseline per-request tier', () => {
    const r = computeRouteCost('claude-sonnet-5', { input_tokens: 200_000, output_tokens: 0 } as never, 'claude-haiku-5-5', T, () => {});
    // baseline haiku upper tier $0.10, sonnet $0.40
    near(r.savedCents, -30);
  });
});
