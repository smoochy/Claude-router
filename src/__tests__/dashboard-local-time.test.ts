import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localStamp, filterHistory } from '../proxy/dashboard.js';

describe('dashboard local time', () => {
  it('renders in host locale, not raw UTC ISO', () => {
    const iso = '2026-10-11T12:34:56.000Z';
    assert.equal(localStamp(iso), new Date(iso).toLocaleString());
    assert.ok(!localStamp(iso).includes('T12:'));
  });

  it('passes an unparseable timestamp through', () => {
    assert.equal(localStamp('nope'), 'nope');
  });

  it('today window follows the host calendar day', () => {
    const e = (timestamp: string) => ({ timestamp }) as never;
    const now = new Date();
    const midnightLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 1);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 0);
    const out = filterHistory([e(midnightLocal.toISOString()), e(yesterday.toISOString())], { window: 'today' });
    assert.equal(out.length, 1);
  });
});
