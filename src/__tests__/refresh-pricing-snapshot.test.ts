import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const P = { input: 1, cache_write_5m: 1.25, cache_write_1h: 2, cache_read: 0.1, output: 5 };
const LC = { threshold_input_tokens: 100000, input: 2, cache_write_5m: 2.5, cache_write_1h: 4, cache_read: 0.2, output: 10 };
const mk = (line: string, extra: object = {}) => ({ id: `claude-${line}-1`, line, created_at: 'x', pricing: P, ...extra });

async function run(list: unknown): Promise<{ code: number | null; out: any }> {
  const srv = http.createServer((_q, r) => r.end(JSON.stringify(list)));
  await new Promise<void>((ok) => srv.listen(0, ok));
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-')), 'snap.json');
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;
  const code = await new Promise<number | null>((ok) => {
    const c = spawn(process.execPath, ['scripts/refresh-pricing-snapshot.mjs'], {
      env: { ...process.env, PRICING_SNAPSHOT_URL: url, PRICING_SNAPSHOT_OUT: out },
      stdio: 'ignore',
    });
    c.on('close', ok);
  });
  srv.close();
  return { code, out: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : undefined };
}

const fams = (haiku: object) => [mk('haiku', haiku), mk('sonnet'), mk('opus'), mk('fable')];

test('refresh keeps a valid pricing_long_context', async () => {
  const r = await run(fams({ pricing_long_context: LC }));
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.find((m: any) => m.line === 'haiku').pricing_long_context, LC);
  assert.equal(r.out.find((m: any) => m.line === 'opus').pricing_long_context, undefined);
});

test('refresh fails closed on a malformed pricing_long_context', async () => {
  for (const bad of [{ ...LC, cache_read: 0 }, { ...LC, threshold_input_tokens: undefined }, { ...LC, output: '5' }, null]) {
    const r = await run(fams({ pricing_long_context: bad }));
    assert.equal(r.code, 1);
    assert.equal(r.out, undefined);
  }
});
