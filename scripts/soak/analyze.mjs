// Pure analysis for the soak harness: parse the daemon's `[diag]` lines and judge a run against the pass criteria.

const DIAG = /^\[diag\] (\S+) lag_p99=([\d.]+)ms lag_max=([\d.]+)ms rss=(\d+)MB heap=(\d+)\/(\d+)MB handles=(\S+) inflight=(\d+) oldest=(\d+)s/;

export const DEFAULTS = {
  maxHeapMb: 1024,
  maxLagP99Ms: 200,
  maxHangReplaceMs: 10_000,
  /** 10 MB/h is 240 MB over 24h: well under the 1 GB cap, and flat noise stays far below it. */
  maxHeapSlopeMbPerHour: 10,
  minSamples: 3,
  slopeWarmupMs: 10 * 60_000,
  slopeMinSpanMs: 60 * 60_000,
};

export function parseDiagLines(text) {
  const out = [];
  for (const l of text.split('\n')) {
    const m = DIAG.exec(l.trim());
    if (!m) continue;
    out.push({ at: m[1], atMs: Date.parse(m[1]), lagP99Ms: +m[2], lagMaxMs: +m[3], rssMb: +m[4], heapMb: +m[5], inflight: +m[8] });
  }
  return out;
}

/** Least-squares slope of heapMb over time, in MB per hour. */
export function slopeMbPerHour(pts) {
  if (pts.length < 2) return 0;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.atMs, 0) / n;
  const my = pts.reduce((a, p) => a + p.heapMb, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.atMs - mx) * (p.heapMb - my); den += (p.atMs - mx) ** 2; }
  return den === 0 ? 0 : (num / den) * 3600_000;
}

/**
 * Worst slope over the stretches between planned restarts, so a restart's heap reset is not read as a trend.
 * Each stretch drops its first `warmupMs` (the heap legitimately fills after a start) and is skipped when
 * less than `minSpanMs` remains: a few minutes of samples extrapolated to an hour is noise, not a trend.
 */
export function maxSegmentSlope(pts, restartsAtMs, { warmupMs = 0, minSpanMs = 0 } = {}) {
  const cuts = [-Infinity, ...[...restartsAtMs].sort((a, b) => a - b), Infinity];
  let worst = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    let seg = pts.filter((p) => p.atMs > cuts[i] && p.atMs <= cuts[i + 1]);
    if (seg.length) { const from = seg[0].atMs + warmupMs; seg = seg.filter((p) => p.atMs >= from); }
    if (seg.length < 2 || seg[seg.length - 1].atMs - seg[0].atMs < minSpanMs) continue;
    worst = Math.max(worst, slopeMbPerHour(seg));
  }
  return worst;
}

export function evaluate({ unplannedRestarts, hangReplacedMs, samples, plannedRestartsAtMs = [] }, limits = {}) {
  const t = { ...DEFAULTS, ...limits };
  const maxHeap = Math.max(0, ...samples.map((s) => s.heapMb));
  const maxLag = Math.max(0, ...samples.map((s) => s.lagP99Ms));
  const slope = maxSegmentSlope(samples, plannedRestartsAtMs, { warmupMs: t.slopeWarmupMs, minSpanMs: t.slopeMinSpanMs });
  const checks = [
    { name: 'samples', ok: samples.length >= t.minSamples, detail: `${samples.length} [diag] samples (need ${t.minSamples})` },
    { name: 'unplanned restarts', ok: unplannedRestarts === 0, detail: `${unplannedRestarts} (need 0)` },
    { name: 'heap used', ok: maxHeap < t.maxHeapMb, detail: `max ${maxHeap} MB (need < ${t.maxHeapMb})` },
    { name: 'heap growth', ok: slope < t.maxHeapSlopeMbPerHour, detail: `${slope.toFixed(2)} MB/h (need < ${t.maxHeapSlopeMbPerHour})` },
    { name: 'event-loop lag p99', ok: maxLag < t.maxLagP99Ms, detail: `max ${maxLag} ms (need < ${t.maxLagP99Ms})` },
    {
      name: 'hang replaced by start -d',
      ok: hangReplacedMs != null && hangReplacedMs <= t.maxHangReplaceMs,
      detail: hangReplacedMs == null ? 'not replaced' : `${hangReplacedMs} ms (need <= ${t.maxHangReplaceMs})`,
    },
  ];
  return { pass: checks.every((c) => c.ok), checks };
}
