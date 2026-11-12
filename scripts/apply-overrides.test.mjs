import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOverrides, installedVersions, satisfied, applyOverrides } from './apply-overrides.mjs';

const YAML = `# header
npm:
  fast-xml-parser: '5.12.0'  # alert 29
  qs: '6.16.1'  # alert 30
`;

const lock = (versions) => JSON.stringify({
  lockfileVersion: 3,
  packages: { '': {}, ...Object.fromEntries(Object.entries(versions).map(([k, v]) => [`node_modules/${k}`, { version: v }])) },
});

function project(versions, pkg = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ov-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', ...pkg }, null, 2) + '\n');
  writeFileSync(join(dir, 'package-lock.json'), lock(versions));
  writeFileSync(join(dir, 'overrides.yaml'), YAML);
  return dir;
}

test('parseOverrides reads package -> minimum and ignores comments', () => {
  assert.deepEqual(parseOverrides(YAML), { 'fast-xml-parser': '5.12.0', qs: '6.16.1' });
});

test('parseOverrides rejects an unknown ecosystem', () => {
  assert.throws(() => parseOverrides("pip:\n  a: '1.0.0'\n"), /ecosystem/);
});

test('installedVersions collects nested copies too', () => {
  const l = JSON.parse(lock({ qs: '6.0.0', 'a/node_modules/qs': '6.9.0' }));
  l.packages['node_modules/a/node_modules/qs'] = { version: '6.9.0' };
  assert.deepEqual(installedVersions(l, 'qs').sort(), ['6.0.0', '6.9.0']);
});

test('satisfied needs no copy of the same major below the minimum', () => {
  assert.equal(satisfied(['5.12.1'], '5.12.0'), true);
  assert.equal(satisfied(['5.7.2'], '5.12.0'), false);
  assert.equal(satisfied(['5.12.1', '5.7.2'], '5.12.0'), false);
  assert.equal(satisfied(['6.0.0'], '5.12.0'), true);
});

test('apply writes ^min into package.json overrides and relocks', () => {
  const dir = project({ 'fast-xml-parser': '5.7.2', qs: '6.16.1' });
  const calls = [];
  const pruned = applyOverrides(dir, { run: (cmd, args) => calls.push([cmd, ...args]) });
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.overrides, { 'fast-xml-parser': '^5.12.0' });
  assert.deepEqual(calls, [['npm', 'install', '--package-lock-only', '--ignore-scripts']]);
  assert.deepEqual(pruned, ['qs 6.16.1']);
  const yaml = readFileSync(join(dir, 'overrides.yaml'), 'utf8');
  assert.match(yaml, /fast-xml-parser/);
  assert.doesNotMatch(yaml, /qs/);
});

test('apply keeps entries already enforced through package.json overrides', () => {
  const dir = project({ 'fast-xml-parser': '5.12.0', qs: '6.16.1' }, { overrides: { 'fast-xml-parser': '^5.12.0' } });
  const calls = [];
  applyOverrides(dir, { run: (...a) => calls.push(a) });
  assert.match(readFileSync(join(dir, 'overrides.yaml'), 'utf8'), /fast-xml-parser/);
  assert.equal(calls.length, 0);
});

test('apply is a no-op without an overrides file', () => {
  const dir = project({});
  writeFileSync(join(dir, 'overrides.yaml'), '');
  assert.deepEqual(applyOverrides(dir, { run: () => assert.fail('no relock') }), []);
});
