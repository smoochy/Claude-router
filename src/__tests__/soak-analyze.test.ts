import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The soak harness is a plain .mjs script outside tsc's rootDir, so load it at runtime.
let mod: any;
// Function() keeps tsc (CommonJS output) from rewriting import() into require().
const load = new Function('u', 'return import(u)') as (u: string) => Promise<any>;
before(async () => { mod = await load(pathToFileURL(path.resolve('scripts/soak/analyze.mjs')).href); });

const line = (at: string, lag99: number, heap: number) =>
  `[diag] ${at} lag_p99=${lag99}ms lag_max=${lag99 * 2}ms rss=200MB heap=${heap}/4144MB handles=Timeout:3 inflight=0 oldest=0s`;

describe('soak analyze', () => {
  it('parses [diag] sample lines and ignores everything else', () => {
    const text = [
      'noise',
      line('2026-10-18T10:00:00.000Z', 1.5, 80),
      '[diag] inflight POST /v1/messages age=31s',
      line('2026-10-18T10:00:30.000Z', 2, 82),
    ].join('\n');
    const s = mod.parseDiagLines(text);
    assert.equal(s.length, 2);
    assert.equal(s[0].heapMb, 80);
    assert.equal(s[1].lagP99Ms, 2);
    assert.equal(s[1].atMs, Date.parse('2026-10-18T10:00:30.000Z'));
  });

  it('slope is MB per hour', () => {
    const pts = [0, 1, 2].map((h) => ({ atMs: h * 3600_000, heapMb: 100 + 50 * h }));
    assert.equal(Math.round(mod.slopeMbPerHour(pts)), 50);
  });

  it('slope ignores the sawtooth across a planned restart', () => {
    const pts = [
      { atMs: 0, heapMb: 100 }, { atMs: 3600_000, heapMb: 100 },
      { atMs: 7200_000, heapMb: 10 }, { atMs: 10800_000, heapMb: 10 },
    ];
    assert.equal(mod.maxSegmentSlope(pts, [5400_000]), 0);
  });

  const ok = { unplannedRestarts: 0, hangReplacedMs: 6000, samples: [
    { atMs: 0, heapMb: 80, lagP99Ms: 3 }, { atMs: 1800_000, heapMb: 81, lagP99Ms: 4 }, { atMs: 3600_000, heapMb: 80, lagP99Ms: 3 },
  ], plannedRestartsAtMs: [] };

  it('passes a healthy run', () => {
    assert.equal(mod.evaluate(ok).pass, true);
  });

  it('fails on each criterion', () => {
    assert.equal(mod.evaluate({ ...ok, unplannedRestarts: 1 }).pass, false);
    assert.equal(mod.evaluate({ ...ok, hangReplacedMs: 10_001 }).pass, false);
    assert.equal(mod.evaluate({ ...ok, hangReplacedMs: null }).pass, false);
    assert.equal(mod.evaluate({ ...ok, samples: ok.samples.map((s) => ({ ...s, lagP99Ms: 250 })) }).pass, false);
    assert.equal(mod.evaluate({ ...ok, samples: ok.samples.map((s) => ({ ...s, heapMb: 1100 })) }).pass, false);
    const growing = ok.samples.map((s, i) => ({ ...s, heapMb: 80 + i * 100 }));
    assert.equal(mod.evaluate({ ...ok, samples: growing }, { slopeWarmupMs: 0 }).pass, false);
  });

  it('fails when there are too few samples to judge', () => {
    assert.equal(mod.evaluate({ ...ok, samples: [] }).pass, false);
  });

  it('does not extrapolate a trend from a span under an hour', () => {
    const pts = [{ atMs: 0, heapMb: 20 }, { atMs: 120_000, heapMb: 26 }];
    assert.equal(mod.maxSegmentSlope(pts, [], { warmupMs: 0, minSpanMs: 3600_000 }), 0);
  });
});
