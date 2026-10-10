import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadModelListPricing, type ModelListEntry } from '../model-list.js';
import { DEFAULT_PRICING } from '../models.js';

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

    assert.equal(result.source, 'built-in');
    assert.deepEqual(result.pricing, DEFAULT_PRICING);
  });

  it('rejects an incompatible shape (e.g. the envelope form other lists use) rather than trusting it', async () => {
    const cachePath = tempCachePath();
    const result = await loadModelListPricing({
      cachePath,
      // @ts-expect-error — deliberately the wrong shape, to prove the loader refuses it
      fetchList: async () => ({ generated_at: 'x', schema_version: 2, models: [ENTRY] }),
    });

    assert.equal(result.source, 'built-in');
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
