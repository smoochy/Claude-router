import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installExitLogging } from '../proxy/cli.js';

describe('installExitLogging', () => {
  it('logs SIGHUP and SIGBREAK then exits with 128+signo', () => {
    const proc = new EventEmitter();
    const lines: string[] = [];
    const codes: number[] = [];
    installExitLogging(proc as never, (l) => lines.push(l), (c) => codes.push(c));
    proc.emit('SIGHUP', 'SIGHUP');
    proc.emit('SIGBREAK', 'SIGBREAK');
    assert.match(lines[0]!, /received SIGHUP/);
    assert.match(lines[1]!, /received SIGBREAK/);
    assert.deepEqual(codes, [129, 149]);
  });

  it('logs the exit event with its code', () => {
    const proc = new EventEmitter();
    const lines: string[] = [];
    installExitLogging(proc as never, (l) => lines.push(l), () => {});
    proc.emit('exit', 7, null);
    assert.match(lines[0]!, /process exit code=7/);
  });
});
