import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createInflightTracker, formatSample, startDiagnostics, attachInflight, installExitLog } from '../proxy/diagnostics.js';

describe('inflight tracker', () => {
  it('counts begun requests, drops finished ones, reports the oldest first', () => {
    let t = 1000;
    const tr = createInflightTracker(() => t);
    const doneA = tr.begin('POST /v1/messages');
    t = 5000;
    tr.begin('GET /health');
    t = 9000;
    const snap = tr.snapshot();
    assert.equal(snap.count, 2);
    assert.deepEqual(snap.oldest.map((r) => [r.label, r.ageMs]), [['POST /v1/messages', 8000], ['GET /health', 4000]]);
    doneA();
    doneA(); // idempotent
    assert.equal(tr.snapshot().count, 1);
  });

  it('caps the listed requests', () => {
    const tr = createInflightTracker(() => 0);
    for (let i = 0; i < 50; i++) tr.begin(`r${i}`);
    const snap = tr.snapshot(5);
    assert.equal(snap.count, 50);
    assert.equal(snap.oldest.length, 5);
  });

  it('attachInflight tracks a request until the response closes', () => {
    const tr = createInflightTracker(() => 0);
    const server = new EventEmitter();
    const res = new EventEmitter();
    attachInflight(server as never, tr);
    server.emit('request', { method: 'POST', url: '/v1/messages?x=1' }, res);
    assert.equal(tr.snapshot().count, 1);
    assert.equal(tr.snapshot().oldest[0]!.label, 'POST /v1/messages');
    res.emit('close');
    assert.equal(tr.snapshot().count, 0);
  });
});

describe('formatSample', () => {
  it('renders one greppable line', () => {
    const line = formatSample({
      at: '2026-10-18T12:00:00.000Z', lagP99Ms: 1.234, lagMaxMs: 7.8, rssMb: 120, heapUsedMb: 50, heapLimitMb: 4096,
      handles: { Timeout: 3, TCPSocketWrap: 2 }, inflight: 2, oldestInflightMs: 61000,
    });
    assert.match(line, /^\[diag\] 2026-10-18T12:00:00\.000Z lag_p99=1\.2ms lag_max=7\.8ms rss=120MB heap=50\/4096MB handles=Timeout:3,TCPSocketWrap:2 inflight=2 oldest=61s$/);
  });
});

describe('startDiagnostics', () => {
  it('logs a sample per interval, lists old in-flight requests, and stops', async () => {
    const lines: string[] = [];
    let offset = 0;
    const tr = createInflightTracker(() => Date.now() + offset);
    tr.begin('POST /v1/messages');
    offset = 120_000;
    const d = startDiagnostics({ intervalMs: 20, log: (l) => lines.push(l), tracker: tr });
    await new Promise((r) => setTimeout(r, 90));
    d.stop();
    const n = lines.length;
    assert.ok(lines.some((l) => l.startsWith('[diag] 20') && l.includes('inflight=1')));
    assert.ok(lines.some((l) => l.startsWith('[diag] inflight ') && l.includes('POST /v1/messages')));
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(lines.length, n);
  });
});

describe('exit log', () => {
  it('logs SIGHUP/SIGBREAK without swallowing the default exit, and logs the exit code', () => {
    const proc = new EventEmitter() as unknown as NodeJS.Process;
    const lines: string[] = [];
    const exits: number[] = [];
    installExitLog((l) => lines.push(l), proc, (c) => exits.push(c));
    proc.emit('SIGHUP', 'SIGHUP');
    proc.emit('exit', 0);
    assert.ok(lines.some((l) => l.includes('SIGHUP')));
    assert.ok(lines.some((l) => l.includes('exit code=0')));
    assert.deepEqual(exits, [129]);
  });
});
