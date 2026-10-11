#!/usr/bin/env node
// Rewrites src/pricing-snapshot.json from the published Anthropic model list.
// Run by `npm run pricing:refresh` and by the release workflow before packing.
// Fails closed: any fetch, shape or content problem exits 1 and leaves the
// committed snapshot untouched, so a release can never ship an empty or
// half-trusted price table.
import fs from 'node:fs';

// PRICING_SNAPSHOT_URL / PRICING_SNAPSHOT_OUT let a branch file or a test point elsewhere.
const URL_ = process.env.PRICING_SNAPSHOT_URL || 'https://raw.githubusercontent.com/smoochy/openrouter-model-list/main/anthropic-models.json';
const OUT = process.env.PRICING_SNAPSHOT_OUT || new URL('../src/pricing-snapshot.json', import.meta.url);

const TIER_PRICES = ['input', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'output'];
const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
function checkLongContext(m) {
  const t = m.pricing_long_context;
  if (t === undefined) return;
  if (!t || !pos(t.threshold_input_tokens) || !TIER_PRICES.every((k) => pos(t[k]))) {
    throw new Error(`malformed pricing_long_context on ${m.id}`);
  }
}

try {
  const res = await fetch(URL_, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('not an array');
  // Keep only what the router reads; the full list carries capabilities etc.
  const slim = list
    .filter((m) => m && typeof m.id === 'string' && m.pricing && m.pricing.input > 0 && m.pricing.output >= 0)
    .map((m) => {
      checkLongContext(m);
      const e = { id: m.id, line: m.line, created_at: m.created_at, pricing: m.pricing };
      if (m.pricing_long_context) e.pricing_long_context = m.pricing_long_context;
      return e;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const lines = new Set(slim.map((m) => m.line));
  for (const f of ['haiku', 'sonnet', 'opus', 'fable']) {
    if (!lines.has(f)) throw new Error(`no priced model in family "${f}"`);
  }
  fs.writeFileSync(OUT, JSON.stringify(slim, null, 2) + '\n');
  console.log(`pricing snapshot: ${slim.length} models`);
} catch (e) {
  console.error(`pricing snapshot refresh failed: ${e}`);
  process.exit(1);
}
