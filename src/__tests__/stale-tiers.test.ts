import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadModelListPricing,
  staleTierIds,
  applyStaleTierReplacements,
  rewriteStaleTiers,
  resetStaleTierWarnings,
  type ModelListEntry,
  type ModelListResult,
} from '../model-list.js';
import { DEFAULT_PRICING, DEFAULT_MODELS, pricingTableFromList } from '../models.js';
import type { Tier } from '../types.js';

const entry = (id: string, created_at: string): ModelListEntry => ({
  id,
  created_at,
  pricing: { input: 5, output: 25, cache_read: 0.5, cache_write_5m: 6, cache_write_1h: 10 },
});

const REMOTE: ModelListResult = {
  source: 'remote',
  pricing: pricingTableFromList([
    entry('claude-opus-5', '2026-06-01T00:00:00Z'),
    entry('claude-opus-5-5', '2026-09-01T00:00:00Z'),
    entry('claude-sonnet-5', '2026-06-01T00:00:00Z'),
    entry('claude-sonnet-5-5', '2026-09-01T00:00:00Z'),
  ]),
};
const SNAPSHOT: ModelListResult = { source: 'snapshot', pricing: DEFAULT_PRICING };
const stale = { opus: 'claude-opus-5', sonnet: 'claude-sonnet-5' };

describe('stale former-default tier ids', () => {
  it('replaces a former default with the newest model of its family', () => {
    assert.deepEqual(staleTierIds(stale, REMOTE), [
      { tier: 'opus', id: 'claude-opus-5', replacement: 'claude-opus-5-5' },
      { tier: 'sonnet', id: 'claude-sonnet-5', replacement: 'claude-sonnet-5-5' },
    ]);
  });

  it('keeps a deliberate pin and a current default', () => {
    assert.deepEqual(staleTierIds({ opus: 'claude-opus-4-7', sonnet: DEFAULT_MODELS.sonnet }, REMOTE), []);
  });

  it('works offline: the cache and the built-in snapshot both resolve the replacement', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crouter-stale-'));
    const cachePath = path.join(dir, 'cache.json');
    fs.writeFileSync(
      cachePath,
      JSON.stringify([entry('claude-opus-5', '2026-06-01T00:00:00Z'), entry('claude-opus-5-5', '2026-09-01T00:00:00Z')]),
    );
    const offline = async () => { throw new Error('offline'); };
    const cached = await loadModelListPricing({ cachePath, fetchList: offline });
    assert.equal(cached.source, 'cache');
    assert.equal(staleTierIds({ opus: 'claude-opus-5' }, cached)[0]?.replacement, 'claude-opus-5-5');
    assert.equal(staleTierIds({ opus: 'claude-opus-5' }, SNAPSHOT)[0]?.replacement, DEFAULT_MODELS.opus);
  });

  it('install rewrite drops the pricing override of a replaced id and keeps others', () => {
    const config = {
      tiers: { opus: 'claude-opus-5', sonnet: 'claude-sonnet-4-7' } as Partial<Record<Tier, string>>,
      pricing: { 'claude-opus-5': { input: 1 }, 'claude-sonnet-4-7': { input: 2 } },
    };
    rewriteStaleTiers(config, REMOTE);
    assert.deepEqual(config.tiers, { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-4-7' });
    assert.deepEqual(Object.keys(config.pricing), ['claude-sonnet-4-7']);
  });

  it('start override warns once per tier with old and new id and leaves the input alone', () => {
    resetStaleTierWarnings();
    const warnings: string[] = [];
    const out = applyStaleTierReplacements(stale, REMOTE, (m) => warnings.push(m));
    applyStaleTierReplacements(stale, REMOTE, (m) => warnings.push(m));
    assert.equal(out.opus, 'claude-opus-5-5');
    assert.equal(stale.opus, 'claude-opus-5');
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /"claude-opus-5".*"claude-opus-5-5"/);
  });
});
