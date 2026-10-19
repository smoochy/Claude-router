import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { serve } from '@hono/node-server';
import { routerPaths } from '../proxy/cli-config.js';
import { isProcessAlive, readDaemonState, replaceHungDaemon, writeDaemonState } from '../proxy/daemon.js';
import { createProxyApp } from '../proxy/server.js';
import { DEFAULT_MODELS } from '../models.js';

const children: ChildProcess[] = [];
after(() => { for (const c of children) c.kill('SIGKILL'); });

function tempPaths() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'crouter-replace-'));
  return { home, paths: routerPaths(home) };
}

/** A child process that binds a port and accepts connections but never answers: a hung daemon. */
async function spawnHungServer(ignoreSigterm = false): Promise<{ pid: number; port: number }> {
  const script = `
    const net = require('node:net');
    ${ignoreSigterm ? "process.on('SIGTERM', () => {});" : ''}
    net.createServer((s) => s.on('error', () => {})).listen(0, '127.0.0.1', function () { console.log(this.address().port); });
  `;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  children.push(child);
  const port = await new Promise<number>((resolve) => child.stdout!.once('data', (d) => resolve(Number(String(d).trim()))));
  return { pid: child.pid!, port };
}

const state = (pid: number, port: number) => ({ pid, port, startedAt: new Date().toISOString(), args: [] });
const FAST = { attempts: 3, totalMs: 600, termWaitMs: 400, isRouter: () => true };
const waitDead = async (pid: number) => { for (let i = 0; i < 30 && isProcessAlive(pid); i++) await new Promise((r) => setTimeout(r, 100)); };

describe('replaceHungDaemon', () => {
  it('terminates the state-file pid when /health is silent but the pid is alive', async () => {
    const { home, paths } = tempPaths();
    const hung = await spawnHungServer();
    writeDaemonState(state(hung.pid, hung.port), paths);
    const res = await replaceHungDaemon(hung.port, paths, FAST);
    assert.equal(res.replaced, true);
    await waitDead(hung.pid);
    assert.equal(isProcessAlive(hung.pid), false);
    assert.equal(readDaemonState(paths), null);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('escalates to SIGKILL when SIGTERM is ignored', { skip: process.platform === 'win32' ? 'SIGTERM always kills on Windows' : false }, async () => {
    const { home, paths } = tempPaths();
    const hung = await spawnHungServer(true);
    writeDaemonState(state(hung.pid, hung.port), paths);
    const res = await replaceHungDaemon(hung.port, paths, FAST);
    assert.equal(res.replaced, true);
    await waitDead(hung.pid);
    assert.equal(isProcessAlive(hung.pid), false);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('never kills a pid the state file does not name', async () => {
    const { home, paths } = tempPaths();
    const hung = await spawnHungServer();
    // No state file: the port is held, but by nobody we own.
    assert.equal((await replaceHungDaemon(hung.port, paths, FAST)).replaced, false);
    // State file names a different port: its pid proves nothing about this one.
    writeDaemonState(state(hung.pid, hung.port + 1), paths);
    assert.equal((await replaceHungDaemon(hung.port, paths, FAST)).replaced, false);
    assert.equal(isProcessAlive(hung.pid), true);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('refuses a pid that does not look like a claude-router process', async () => {
    const { home, paths } = tempPaths();
    const hung = await spawnHungServer();
    writeDaemonState(state(hung.pid, hung.port), paths);
    const res = await replaceHungDaemon(hung.port, paths, { ...FAST, isRouter: () => false });
    assert.equal(res.replaced, false);
    assert.equal(isProcessAlive(hung.pid), true);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('leaves a daemon alone that answers /health', async () => {
    const { home, paths } = tempPaths();
    const bystander = await spawnHungServer();
    const app = createProxyApp({ classifier: 'heuristic', defaultModel: DEFAULT_MODELS.sonnet, verbose: false, provider: 'anthropic', models: DEFAULT_MODELS, forceRoute: false });
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
    after(() => server.close());
    await new Promise<void>((r) => server.once('listening', r));
    const port = (server.address() as { port: number }).port;
    writeDaemonState(state(bystander.pid, port), paths);
    assert.equal((await replaceHungDaemon(port, paths, FAST)).replaced, false);
    assert.equal(isProcessAlive(bystander.pid), true);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('writes pid, reason and silent seconds to proxy.log', async () => {
    const { home, paths } = tempPaths();
    fs.mkdirSync(paths.configDir, { recursive: true });
    fs.writeFileSync(paths.logFile, '[diag] x\n');
    const old = new Date(Date.now() - 42_000);
    fs.utimesSync(paths.logFile, old, old);
    const hung = await spawnHungServer();
    writeDaemonState(state(hung.pid, hung.port), paths);
    await replaceHungDaemon(hung.port, paths, FAST);
    const log = fs.readFileSync(paths.logFile, 'utf8');
    assert.match(log, new RegExp(`replacing pid ${hung.pid}: /health silent, log silent 4\\d s`));
    assert.match(log, /sent SIGTERM/);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
