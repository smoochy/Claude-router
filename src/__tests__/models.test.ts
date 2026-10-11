import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCostCents,
  computeRouteCost,
  resetUnpricedWarnings,
  tierForModel,
  priceForModel,
  familyForModel,
  DEFAULT_MODELS,
  DEFAULT_PRICING,
  pricingTableFromList,
} from '../models.js';

// Fixed table so cost-math tests do not move when the snapshot is refreshed.
const P = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.025 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.025 },
};

describe('computeCostCents', () => {
  it('calculates cost for known model', () => {
    // 1000 input tokens at $3/M + 500 output tokens at $15/M
    // = (1000 * 3 + 500 * 15) / 1_000_000 * 100
    // = (3000 + 7500) / 1_000_000 * 100
    // = 10500 / 1_000_000 * 100
    // = 10500 / 1_000_000 * 100 = 1.05 cents
    const cost = computeCostCents('claude-sonnet-4-6', 1000, 500, P);
    assert.equal(Math.round(cost * 10000) / 10000, 1.05);
  });

  it('returns 0 for unknown model', () => {
    const cost = computeCostCents('unknown-model', 1000, 500, P);
    assert.equal(cost, 0);
  });

  it('bills cache reads at 10% of the input rate', () => {
    // sonnet input $2/M → 1M cache-read tokens = $0.20 = 20 cents
    const base = computeCostCents('claude-sonnet-5', 0, 0, P);
    const withReads = computeCostCents('claude-sonnet-5', 0, 0, P, {
      readTokens: 1_000_000,
    });
    assert.equal(base, 0);
    assert.equal(Math.round(withReads * 100) / 100, 20);
  });

  it('bills Fable 5.1 cache reads at its own 2.5%, not the standard 10%', () => {
    // The 10% multiplier is a default, not a universal. Fable 5.1 / Mythos 5.1
    // read at $0.25/MTok against a $10/MTok input rate — on a cache-heavy client
    // the read line is most of the input bill, so the standard rate overstates a
    // fable route ~4x on that component.
    for (const id of ['claude-fable-5-1', 'claude-mythos-5-1']) {
      const cost = computeCostCents(id, 0, 0, P, { readTokens: 1_000_000 });
      assert.equal(Math.round(cost * 100) / 100, 25, id);
    }
    // Fable 5 keeps the standard rate: $10/M × 10% = $1.00 = 100 cents.
    const fable5 = computeCostCents('claude-fable-5', 0, 0, P, {
      readTokens: 1_000_000,
    });
    assert.equal(Math.round(fable5 * 100) / 100, 100);
  });

  it('bills cache writes at 125% of the input rate', () => {
    // sonnet input $2/M → 1M cache-creation tokens = $2.50 = 250 cents
    const cost = computeCostCents('claude-sonnet-5', 0, 0, P, {
      creationTokens: 1_000_000,
    });
    assert.equal(Math.round(cost * 100) / 100, 250);
  });

  it('combines regular, cache-read, and cache-write tokens', () => {
    // haiku $1/M in, $5/M out:
    // 1000 in = $0.001; 500 out = $0.0025; 10000 reads = $0.001; 2000 writes = $0.0025
    const cost = computeCostCents('claude-haiku-4-5', 1000, 500, P, {
      readTokens: 10_000,
      creationTokens: 2_000,
    });
    assert.equal(Math.round(cost * 100000) / 100000, 0.7);
  });

  it('omitting cache tokens matches the old behavior', () => {
    const without = computeCostCents('claude-sonnet-5', 1000, 500, P);
    const withEmpty = computeCostCents('claude-sonnet-5', 1000, 500, P, {});
    assert.equal(without, withEmpty);
  });

  it('returns 0 for zero tokens', () => {
    const cost = computeCostCents('claude-sonnet-4-6', 0, 0, P);
    assert.equal(cost, 0);
  });

  it('handles large token counts', () => {
    const cost = computeCostCents('claude-opus-4-8', 1_000_000, 1_000_000, P);
    // Current-generation Opus pricing: $5/M input + $25/M output.
    // (1M * 5 + 1M * 25) / 1M * 100 = 30 * 100 = 3000
    assert.equal(cost, 3000);
  });

  it('haiku is cheapest', () => {
    const haiku = computeCostCents(DEFAULT_MODELS.haiku, 1000, 500, DEFAULT_PRICING);
    const sonnet = computeCostCents(DEFAULT_MODELS.sonnet, 1000, 500, DEFAULT_PRICING);
    const opus = computeCostCents(DEFAULT_MODELS.opus, 1000, 500, P);
    assert.ok(haiku < sonnet);
    assert.ok(sonnet < opus);
  });

  it('uses custom pricing when provided', () => {
    const custom = { 'my-model': { input: 1.0, output: 2.0 } };
    const cost = computeCostCents('my-model', 1_000_000, 1_000_000, custom);
    // (1M * 1 + 1M * 2) / 1M * 100 = 300
    assert.equal(cost, 300);
  });

  it('handles very small token counts', () => {
    const cost = computeCostCents('claude-sonnet-4-6', 1, 1, P);
    assert.ok(cost > 0, `cost should be positive, got ${cost}`);
    assert.ok(Number.isFinite(cost), 'cost should be finite');
  });

  it('handles negative tokens without crashing', () => {
    const cost = computeCostCents('claude-sonnet-4-6', -100, -100, P);
    assert.equal(typeof cost, 'number');
    assert.ok(Number.isFinite(cost), 'cost should be finite');
  });
});


describe('unpriced models are loud, not free', () => {
  // The regression guard the suite was missing: asserting a specific price only
  // ever catches the model you already thought of. These assert that ANY model
  // with no exact entry and no family match produces an observable signal —
  // which is what makes the next claude-mythos-5 impossible to ship silently.
  function capturingWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
    resetUnpricedWarnings();
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: unknown) => void warnings.push(String(msg));
    try {
      return { result: fn(), warnings };
    } finally {
      console.warn = original;
      resetUnpricedWarnings();
    }
  }

  const usage = { input_tokens: 1000, output_tokens: 500 } as never;

  it('flags a model with no exact entry and no family match as unpriced', () => {
    const { result, warnings } = capturingWarnings(() =>
      computeRouteCost('some-future-model-5', usage, DEFAULT_MODELS.sonnet, DEFAULT_PRICING),
    );
    assert.equal(result.priced, false, 'must not claim these figures are measured');
    assert.equal(result.costCents, 0);
    assert.equal(warnings.length, 1, 'exactly one warning');
    assert.match(warnings[0]!, /some-future-model-5/);
  });

  it('flags an unpriced baseline too — savedCents is just as wrong', () => {
    const { result } = capturingWarnings(() =>
      computeRouteCost(DEFAULT_MODELS.haiku, usage, 'some-future-model-5', DEFAULT_PRICING),
    );
    assert.equal(result.priced, false);
  });

  it('warns once per model, not once per call', () => {
    const { warnings } = capturingWarnings(() => {
      for (let i = 0; i < 5; i++) {
        computeRouteCost('some-future-model-5', usage, DEFAULT_MODELS.sonnet, DEFAULT_PRICING);
      }
    });
    assert.equal(warnings.length, 1);
  });

  it('stays silent and priced for a fully-known route', () => {
    const { result, warnings } = capturingWarnings(() =>
      computeRouteCost(DEFAULT_MODELS.haiku, usage, DEFAULT_MODELS.sonnet, DEFAULT_PRICING),
    );
    assert.equal(result.priced, true);
    assert.deepEqual(warnings, []);
  });

  it('delivers warnings to an injected sink, not the console', () => {
    const custom: string[] = [];
    const { warnings } = capturingWarnings(() =>
      computeRouteCost(
        'some-future-model-5',
        usage,
        DEFAULT_MODELS.sonnet,
        DEFAULT_PRICING,
        (msg) => void custom.push(msg),
      ),
    );
    assert.equal(custom.length, 1);
    assert.match(custom[0]!, /some-future-model-5/);
    assert.deepEqual(warnings, [], 'console.warn must stay silent');
  });
});

describe('familyForModel', () => {
  it('maps first-party IDs to families', () => {
    assert.equal(familyForModel('claude-haiku-4-5'), 'haiku');
    assert.equal(familyForModel('claude-sonnet-5'), 'sonnet');
    assert.equal(familyForModel('claude-sonnet-4-6'), 'sonnet');
    assert.equal(familyForModel('claude-opus-4-8'), 'opus');
  });

  it('maps Bedrock and Vertex IDs to families', () => {
    assert.equal(familyForModel('us.anthropic.claude-opus-4-8-v1:0'), 'opus');
    assert.equal(familyForModel('anthropic.claude-haiku-4-5'), 'haiku');
  });

  it('returns undefined for non-Claude IDs', () => {
    assert.equal(familyForModel('gpt-4o'), undefined);
  });
});

describe('priceForModel (snapshot and family fallback)', () => {
  const list = [
    { id: 'claude-opus-5', created_at: '2026-07-24T00:00:00Z', pricing: { input: 5, output: 25, cache_read: 0.5, cache_write_5m: 6.25, cache_write_1h: 10 } },
    { id: 'claude-opus-5-5', created_at: '2026-09-21T00:00:00Z', pricing: { input: 4, output: 20, cache_read: 0.2, cache_write_5m: 5, cache_write_1h: 8 } },
    { id: 'claude-opus-4-6', created_at: '2026-02-04T00:00:00Z', pricing: { input: 5, output: 25, cache_read: 0.5, cache_write_5m: 6.25, cache_write_1h: 10 } },
    { id: 'claude-sonnet-5', created_at: '2026-06-29T00:00:00Z', pricing: { input: 2, output: 10, cache_read: 0.2, cache_write_5m: 2.5, cache_write_1h: 4 } },
  ];
  const table = pricingTableFromList(list);

  it('derives cacheRead as a fraction of input', () => {
    assert.deepEqual(table['claude-opus-5-5'], { input: 4, output: 20, cacheRead: 0.05 });
  });

  it('prices an unlisted dated or Bedrock id from the NEWEST model of its family', () => {
    // Input order is not age order; opus-5-5 is newest, so it wins over opus-5 / 4-6.
    assert.deepEqual(priceForModel('claude-opus-4-9-20991231', table), table['claude-opus-5-5']);
    assert.deepEqual(priceForModel('us.anthropic.claude-opus-4-8-v1:0', table), table['claude-opus-5-5']);
    assert.deepEqual(priceForModel('claude-sonnet-4-20250514', table), table['claude-sonnet-5']);
  });

  it('has no price for a family the table does not carry or a non-Claude id', () => {
    assert.equal(priceForModel('claude-haiku-9', table), undefined);
    assert.equal(priceForModel('gpt-4o', table), undefined);
  });

  it('skips list entries without a usable price', () => {
    assert.deepEqual(pricingTableFromList([{ id: 'claude-opus-9' }]), {});
  });

  it('exact entry wins over family fallback', () => {
    const custom = { ...table, 'claude-opus-4-8': { input: 0.0, output: 0.0 } };
    assert.deepEqual(priceForModel('claude-opus-4-8', custom), { input: 0.0, output: 0.0 });
  });

  it('the committed snapshot prices every default tier model', () => {
    for (const id of Object.values(DEFAULT_MODELS)) {
      assert.ok(priceForModel(id, DEFAULT_PRICING), `${id} unpriced by the snapshot`);
    }
  });
});

describe('tierForModel', () => {
  it('finds tier for known model', () => {
    assert.equal(tierForModel(DEFAULT_MODELS.haiku, DEFAULT_MODELS), 'haiku');
    assert.equal(tierForModel(DEFAULT_MODELS.sonnet, DEFAULT_MODELS), 'sonnet');
    assert.equal(tierForModel(DEFAULT_MODELS.opus, DEFAULT_MODELS), 'opus');
  });

  it('returns undefined for unknown model', () => {
    assert.equal(tierForModel('unknown', DEFAULT_MODELS), undefined);
  });
});

