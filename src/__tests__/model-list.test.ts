import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadModelListPricing,
  staleTierIds,
  warnStaleTierIds,
  resetStaleTierWarnings,
  type ModelListEntry,
  type ModelListResult,
} from '../model-list.js';
import { DEFAULT_PRICING, DEFAULT_MODELS } from '../models.js';
import type { Tier } from '../types.js';

function tempCachePath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crouter-modellist-')), 'cache.json');
}

const ENTRY: ModelListEntry = {
  id: 'claude-opus-5-5',
  pricing: { input: 6, output: 30, cache_read: 0.6, cache_write_5m: 7.5, cache_write_1h: 12 },
};

describe('loadModelListPricing', () => {
  it('prices a model from a successful fetch and writes it to the cache', async () => {
    const cachePath = tempCachePath();
    const result = await loadModelListPricing({
      cachePath,
      fetchList: async () => [ENTRY],
    });

    assert.equal(result.source, 'remote');
    // cache_read (0.6) / input (6) = 0.1 — the fraction ModelPricing.cacheRead expects.
    const priced = result.pricing['claude-opus-5-5'];
    assert.equal(priced?.input, 6);
    assert.equal(priced?.output, 30);
    assert.ok(priced && Math.abs(priced.cacheRead! - 0.1) < 1e-9);
    assert.deepEqual(JSON.parse(fs.readFileSync(cachePath, 'utf8')), [ENTRY]);
  });

  it('falls back to the cache when the fetch fails', async () => {
    const cachePath = tempCachePath();
    fs.writeFileSync(cachePath, JSON.stringify([ENTRY]));

    const result = await loadModelListPricing({
      cachePath,
      fetchList: async () => {
        throw new Error('offline');
      },
    });

    assert.equal(result.source, 'cache');
    assert.equal(result.pricing['claude-opus-5-5']?.input, 6);
  });

  it('falls back to DEFAULT_PRICING when both the fetch and the cache fail', async () => {
    const cachePath = tempCachePath();
    fs.rmSync(cachePath, { force: true });

    const result = await loadModelListPricing({
      cachePath,
      fetchList: async () => {
        throw new Error('offline');
      },
    });

    assert.equal(result.source, 'snapshot');
    assert.deepEqual(result.pricing, DEFAULT_PRICING);
  });

  it('rejects an incompatible shape (e.g. the envelope form other lists use) rather than trusting it', async () => {
    const cachePath = tempCachePath();
    const result = await loadModelListPricing({
      cachePath,
      // @ts-expect-error — deliberately the wrong shape, to prove the loader refuses it
      fetchList: async () => ({ generated_at: 'x', schema_version: 2, models: [ENTRY] }),
    });

    assert.equal(result.source, 'snapshot');
  });

  it('drops an entry with no usable pricing rather than inventing a $0 price', async () => {
    const cachePath = tempCachePath();
    const result = await loadModelListPricing({
      cachePath,
      fetchList: async () => [{ id: 'claude-unpriced-9' } as ModelListEntry],
    });

    assert.equal(result.source, 'remote');
    assert.equal(result.pricing['claude-unpriced-9'], undefined);
  });
});

describe('staleTierIds', () => {
  const CURRENT: ModelListResult = {
    source: 'remote',
    pricing: {
      [DEFAULT_MODELS.haiku]: { input: 1, output: 5 },
      [DEFAULT_MODELS.sonnet]: { input: 2, output: 10 },
      [DEFAULT_MODELS.opus]: { input: 5, output: 25 },
      [DEFAULT_MODELS.fable]: { input: 10, output: 50 },
    },
  };

  it('flags a tier id the list does not carry', () => {
    const tiers = { ...DEFAULT_MODELS, sonnet: 'claude-sonnet-5' } as Record<Tier, string>;
    assert.deepEqual(staleTierIds(tiers, CURRENT), [{ tier: 'sonnet', id: 'claude-sonnet-5' }]);
  });

  it('is empty when every configured id is in the list', () => {
    assert.deepEqual(staleTierIds(DEFAULT_MODELS, CURRENT), []);
  });

  it('skips the check entirely when there is nothing to validate against', () => {
    const tiers = { ...DEFAULT_MODELS, sonnet: 'claude-sonnet-5' } as Record<Tier, string>;
    assert.equal(staleTierIds(tiers, { source: 'snapshot', pricing: DEFAULT_PRICING }), undefined);
  });
});

describe('warnStaleTierIds', () => {
  const CURRENT: ModelListResult = {
    source: 'cache',
    pricing: {
      [DEFAULT_MODELS.haiku]: { input: 1, output: 5 },
      [DEFAULT_MODELS.sonnet]: { input: 2, output: 10 },
      [DEFAULT_MODELS.opus]: { input: 5, output: 25 },
      [DEFAULT_MODELS.fable]: { input: 10, output: 50 },
    },
  };

  it('warns once naming the tier, the id and that it may be a previous generation', () => {
    resetStaleTierWarnings();
    const warnings: string[] = [];
    const tiers = { ...DEFAULT_MODELS, opus: 'claude-opus-5' } as Record<Tier, string>;
    warnStaleTierIds(tiers, CURRENT, (m) => warnings.push(m));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /tier "opus"/);
    assert.match(warnings[0]!, /"claude-opus-5"/);
    assert.match(warnings[0]!, /previous generation/);
  });

  it('does not change routing or pricing — the message says so', () => {
    resetStaleTierWarnings();
    const warnings: string[] = [];
    const tiers = { ...DEFAULT_MODELS, opus: 'claude-opus-5' } as Record<Tier, string>;
    warnStaleTierIds(tiers, CURRENT, (m) => warnings.push(m));
    assert.match(warnings[0]!, /unaffected/);
  });

  it('warns once per tier, not once per call', () => {
    resetStaleTierWarnings();
    const warnings: string[] = [];
    const tiers = { ...DEFAULT_MODELS, opus: 'claude-opus-5' } as Record<Tier, string>;
    warnStaleTierIds(tiers, CURRENT, (m) => warnings.push(m));
    warnStaleTierIds(tiers, CURRENT, (m) => warnings.push(m));
    assert.equal(warnings.length, 1);
  });

  it('stays quiet when every tier id is current', () => {
    resetStaleTierWarnings();
    const warnings: string[] = [];
    warnStaleTierIds(DEFAULT_MODELS, CURRENT, (m) => warnings.push(m));
    assert.deepEqual(warnings, []);
  });

  it('stays quiet (skip, not warn) when the pricing source is built-in', () => {
    resetStaleTierWarnings();
    const warnings: string[] = [];
    const tiers = { ...DEFAULT_MODELS, opus: 'claude-opus-5' } as Record<Tier, string>;
    warnStaleTierIds(tiers, { source: 'snapshot', pricing: DEFAULT_PRICING }, (m) => warnings.push(m));
    assert.deepEqual(warnings, []);
  });
});
