#!/usr/bin/env node
// Soak harness: runs a real daemon (dist/proxy/cli.js, isolated HOME) against a stub upstream, replays a
// history.jsonl-shaped load, periodically makes the upstream kill a connection mid-stream (UND_ERR_SOCKET),
// forces one hang of the daemon, replaces it with `start -d`, and judges the `[diag]` lines in proxy.log.
// Usage: node scripts/soak/soak.mjs --help
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDiagLines, evaluate } from './analyze.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const cli = path.join(root, 'dist', 'proxy', 'cli.js');

const HELP = `node scripts/soak/soak.mjs [options]   (run \`npm run build\` first)
  --duration <dur>        total run time, e.g. 90s, 30m, 24h (default 24h)
  --port <n>              daemon port (default 4100, never the real 4000)
  --rps <n>               replayed requests per second (default 2)
  --history <file>        history.jsonl to replay token counts from (default: synthetic, same shape)
  --abort-every <dur>     upstream kills one in-flight stream this often (default 5m)
  --hang-at <dur>         when to force the hang (default: half of --duration)
  --home <dir>            isolated HOME for the daemon (default: fresh temp dir)
  --out <file>            write the JSON report here (default: <home>/soak-report.json)
  --max-heap-slope <n>    allowed heap growth in MB/h (default 10)
Exit code 0 = all criteria pass, 1 = fail.`;

export function parseDuration(s) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(s));
  if (!m) throw new Error(`bad duration: ${s}`);
  return Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2]];
}

function parseArgs(argv) {
  const o = { duration: '24h', port: 4100, rps: 2, 'abort-every': '5m' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') { console.log(HELP); process.exit(0); }
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    o[argv[i].slice(2)] = argv[++i];
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[soak ${new Date().toISOString()}] ${m}`);

// ── history-shaped load ────────────────────────────────────────────────────

function loadRecords(file) {
  if (file) {
    const recs = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && typeof r.inputTokens === 'number');
    if (recs.length) return recs;
    throw new Error(`no usable history records in ${file}`);
  }
  // shortcut: synthetic mix, upgrade to a recorded file via --history for a production-shaped load
  return Array.from({ length: 200 }, (_, i) => ({
    model: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-5'][i % 3],
    inputTokens: 2, outputTokens: 50 + ((i * 37) % 900),
    cacheReadTokens: (i % 5) * 30_000, cacheCreationTokens: (i % 7) * 400,
  }));
}

// ── stub upstream ──────────────────────────────────────────────────────────

function startStub(stats) {
  const state = { abortNext: false };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not json */ }
      const rec = body.__rec ?? {};
      const usage = { input_tokens: rec.inputTokens ?? 2, output_tokens: rec.outputTokens ?? 100, cache_read_input_tokens: rec.cacheReadTokens ?? 0, cache_creation_input_tokens: rec.cacheCreationTokens ?? 0 };
      const model = body.model ?? 'claude-sonnet-5';
      stats.upstream++;
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'msg_soak', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
      res.write(ev('message_start', { message: { id: 'msg_soak', type: 'message', role: 'assistant', model, content: [], usage: { ...usage, output_tokens: 1 } } }));
      res.write(ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }));
      if (state.abortNext) {
        state.abortNext = false;
        stats.aborts++;
        setTimeout(() => req.socket.destroy(), 50); // mid-stream: the client sees UND_ERR_SOCKET
        return;
      }
      res.write(ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ok' } }));
      res.write(ev('content_block_stop', { index: 0 }));
      res.write(ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }));
      res.end(ev('message_stop', {}));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}

// ── daemon control ─────────────────────────────────────────────────────────

function makeEnv(home, hangFlag) {
  return {
    ...process.env,
    HOME: home, USERPROFILE: home,
    ANTHROPIC_API_KEY: 'sk-soak-not-real',
    SOAK_HANG_FLAG: hangFlag,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${JSON.stringify(path.join(here, 'hang-preload.cjs'))}`.trim(),
  };
}

const healthy = async (port, ms = 1000) => {
  try { return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(ms) })).ok; } catch { return false; }
};

const daemonPid = (home) => {
  try { return JSON.parse(fs.readFileSync(path.join(home, '.claude-router', 'daemon.json'), 'utf8')).pid; } catch { return null; }
};

function startDetached(env, port, upstream) {
  return spawnSync(process.execPath, [cli, 'start', '-d', '--port', String(port), '--upstream', upstream], { env, encoding: 'utf8' });
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const duration = parseDuration(opts.duration);
  const hangAt = opts['hang-at'] ? parseDuration(opts['hang-at']) : duration / 2;
  const abortEvery = parseDuration(opts['abort-every']);
  const port = Number(opts.port);
  const rps = Number(opts.rps);
  if (!fs.existsSync(cli)) throw new Error(`${cli} missing: run npm run build`);
  if (hangAt >= duration) throw new Error('--hang-at must be before --duration');

  const home = opts.home ? path.resolve(opts.home) : fs.mkdtempSync(path.join(os.tmpdir(), 'claude-router-soak-'));
  fs.mkdirSync(home, { recursive: true });
  const hangFlag = path.join(home, 'hang.flag');
  const env = makeEnv(home, hangFlag);
  const records = loadRecords(opts.history);
  const stats = { sent: 0, ok: 0, failed: 0, upstream: 0, aborts: 0 };

  if (await healthy(port)) throw new Error(`port ${port} already answers /health, pick another with --port`);
  const stub = await startStub(stats);
  const upstream = `http://127.0.0.1:${stub.port}`;
  log(`home=${home} stub=${upstream} daemon port=${port}`);

  const started = startDetached(env, port, upstream);
  if (started.status !== 0 || !(await healthy(port))) throw new Error(`daemon did not start: ${started.stdout}${started.stderr}`);
  let expectedPid = daemonPid(home);
  log(`daemon pid ${expectedPid}`);

  const plannedRestartsAtMs = [];
  let unplannedRestarts = 0;
  let hangReplacedMs = null;
  let hanging = false;
  const t0 = Date.now();

  // Replay: constant rate, each request carries the token counts of one history record.
  let n = 0;
  const loadTimer = setInterval(async () => {
    if (hanging) return; // requests into a hung daemon would only pile up client-side
    const rec = records[n++ % records.length];
    stats.sent++;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'sk-soak-not-real', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: rec.model ?? 'claude-sonnet-5', max_tokens: 64, stream: n % 4 !== 0, messages: [{ role: 'user', content: `soak ${n}` }], __rec: rec }),
        signal: AbortSignal.timeout(30_000),
      });
      await r.arrayBuffer();
      if (r.ok) stats.ok++; else stats.failed++;
    } catch { stats.failed++; }
  }, Math.max(1, Math.round(1000 / rps)));

  const abortTimer = setInterval(() => { stub.state.abortNext = true; }, abortEvery);

  // Watchdog: any pid change we did not cause is an unplanned restart.
  const watch = setInterval(async () => {
    if (hanging) return;
    const pid = daemonPid(home);
    if (pid !== expectedPid) {
      unplannedRestarts++;
      log(`UNPLANNED RESTART: pid ${expectedPid} -> ${pid}`);
      expectedPid = pid;
    } else if (!(await healthy(port, 3000)) && !hanging) {
      log('health probe failed (not counted unless the pid changes)');
    }
  }, 5000);

  const progress = setInterval(() => log(`t=${Math.round((Date.now() - t0) / 1000)}s sent=${stats.sent} ok=${stats.ok} failed=${stats.failed} aborts=${stats.aborts} unplanned=${unplannedRestarts}`), 60_000);

  // Forced hang.
  await sleep(hangAt);
  log('forcing hang');
  hanging = true;
  fs.writeFileSync(hangFlag, '1');
  let wentSilent = false;
  for (let i = 0; i < 40 && !wentSilent; i++) { await sleep(500); wentSilent = !(await healthy(port, 500)); }
  if (!wentSilent) log('daemon never went silent after the hang flag');
  const hangPid = expectedPid;
  const tStart = Date.now();
  const rep = startDetached(env, port, upstream);
  hangReplacedMs = rep.status === 0 && (await healthy(port)) ? Date.now() - tStart : null;
  const newPid = daemonPid(home);
  if (hangReplacedMs != null && (!wentSilent || newPid === hangPid)) hangReplacedMs = null;
  plannedRestartsAtMs.push(Date.now());
  expectedPid = newPid;
  log(`start -d after hang: ${hangReplacedMs == null ? 'FAILED' : `healthy in ${hangReplacedMs} ms`} (pid ${hangPid} -> ${newPid})\n${rep.stdout}${rep.stderr}`);
  hanging = false;

  await sleep(Math.max(0, duration - (Date.now() - t0)));
  clearInterval(loadTimer); clearInterval(abortTimer); clearInterval(watch); clearInterval(progress);

  // Let the last [diag] sample land, then stop everything.
  await sleep(1000);
  const logText = [path.join(home, '.claude-router', 'proxy.log.1'), path.join(home, '.claude-router', 'proxy.log')]
    .filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const samples = parseDiagLines(logText);
  const verdict = evaluate({ unplannedRestarts, hangReplacedMs, samples, plannedRestartsAtMs }, opts['max-heap-slope'] ? { maxHeapSlopeMbPerHour: Number(opts['max-heap-slope']) } : {});

  spawnSync(process.execPath, [cli, 'stop'], { env });
  stub.server.close();

  const report = { stats, unplannedRestarts, hangReplacedMs, samples: samples.length, ...verdict };
  const out = opts.out ? path.resolve(opts.out) : path.join(home, 'soak-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nSoak ${verdict.pass ? 'PASS' : 'FAIL'}  (requests ${stats.sent}, ok ${stats.ok}, upstream aborts ${stats.aborts})`);
  for (const c of verdict.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`);
  console.log(`report: ${out}\nlog: ${path.join(home, '.claude-router', 'proxy.log')}`);
  process.exit(verdict.pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
