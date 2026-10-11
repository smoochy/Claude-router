// Helpers for .github/workflows/sync-upstream.yml (pure, no network).
//   node scripts/sync-upstream.mjs latest        stdin: tag names, one per line -> highest vX.Y.Z (empty if none)
//   node scripts/sync-upstream.mjs base <ver>    package version -> upstream base (strips -smoo.<n>)
//   node scripts/sync-upstream.mjs newer <a> <b> exit 0 when a > b (both X.Y.Z)
//   node scripts/sync-upstream.mjs bump <ver> <newBase>   -> <newBase>-smoo.<n>, counter kept
import { readFileSync } from 'node:fs';

const RE = /^v?(\d+)\.(\d+)\.(\d+)$/;
const parts = (v) => RE.exec(v).slice(1).map(Number);
const cmp = (a, b) => { const [x, y] = [parts(a), parts(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
const base = (v) => v.replace(/-smoo\.\d+$/, '');

export function latest(tags) {
  const ok = tags.map((t) => t.trim()).filter((t) => RE.test(t));
  return ok.sort(cmp).pop() ?? '';
}
export function bump(version, newBase) {
  const n = /-smoo\.(\d+)$/.exec(version);
  if (!n) throw new Error(`not a smoo version: ${version}`);
  return `${newBase.replace(/^v/, '')}-smoo.${n[1]}`;
}

if (process.argv[1]?.endsWith('sync-upstream.mjs')) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'latest') console.log(latest(readFileSync(0, 'utf8').split('\n')));
  else if (cmd === 'base') console.log(base(a));
  else if (cmd === 'newer') process.exit(cmp(a, b) > 0 ? 0 : 1);
  else if (cmd === 'bump') console.log(bump(a, b));
  else if (cmd === 'selftest') {
    const assert = (await import('node:assert')).default;
    assert.equal(latest(['v0.4.0', 'v0.10.0', 'v0.9.9', 'junk', 'v0.4.0-rc1']), 'v0.10.0');
    assert.equal(latest([]), '');
    assert.equal(bump('0.4.0-smoo.3', 'v0.5.0'), '0.5.0-smoo.3');
    assert.equal(base('0.4.0-smoo.3'), '0.4.0');
    assert.ok(cmp('0.10.0', '0.9.0') > 0);
    console.log('ok');
  } else { console.error('usage: see header'); process.exit(2); }
}
