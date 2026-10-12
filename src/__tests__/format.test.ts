import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSavedCents, savedCentsDisplay, usd } from '../proxy/format.js';

describe('formatSavedCents', () => {
  it('renders a neutral zero for sub-cent amounts (no signed zero) — #38', () => {
    assert.equal(formatSavedCents(-0.004), '$0.0000');
    assert.equal(formatSavedCents(0.004), '$0.0000');
    assert.equal(formatSavedCents(0), '$0.0000');
  });

  it('keeps the sign for amounts that round to a non-zero cent', () => {
    assert.equal(formatSavedCents(123), '$1.2300');
    assert.equal(formatSavedCents(-123), '-$1.2300');
    assert.equal(formatSavedCents(-1), '-$0.0100');
  });

  it('supports the saved/extra label', () => {
    assert.equal(formatSavedCents(123, true), 'saved $1.2300');
    assert.equal(formatSavedCents(-123, true), 'extra $1.2300');
    assert.equal(formatSavedCents(-0.004, true), '$0.0000');
  });
});

describe('savedCentsDisplay', () => {
  it('collapses sub-cent amounts to a neutral zero regardless of sign — #38', () => {
    assert.deepEqual(savedCentsDisplay(-0.004), { text: '$0.0000', tone: 'neutral' });
    assert.deepEqual(savedCentsDisplay(0.004), { text: '$0.0000', tone: 'neutral' });
    assert.deepEqual(savedCentsDisplay(0), { text: '$0.0000', tone: 'neutral' });
  });

  it('reports a clear saving as positive', () => {
    assert.deepEqual(savedCentsDisplay(123), { text: '$1.2300', tone: 'positive' });
  });

  it('reports a clear loss as negative with a signed amount', () => {
    assert.deepEqual(savedCentsDisplay(-123), { text: '-$1.2300', tone: 'negative' });
    assert.deepEqual(savedCentsDisplay(-1), { text: '-$0.0100', tone: 'negative' });
  });

  it('supports the saved/extra label', () => {
    assert.deepEqual(savedCentsDisplay(123, true), { text: 'saved $1.2300', tone: 'positive' });
    assert.deepEqual(savedCentsDisplay(-123, true), { text: 'extra $1.2300', tone: 'negative' });
    assert.deepEqual(savedCentsDisplay(-0.004, true), { text: '$0.0000', tone: 'neutral' });
  });

  it('shows sub-cent figures signed at precision 4 (no neutral collapse) — #47', () => {
    assert.deepEqual(savedCentsDisplay(-0.43, false, 4), { text: '-$0.0043', tone: 'negative' });
    assert.deepEqual(savedCentsDisplay(0, false, 4), { text: '$0.0000', tone: 'neutral' });
    assert.deepEqual(savedCentsDisplay(4567, false, 4), { text: '$45.6700', tone: 'positive' });
  });
});

describe("usd", () => {
  it("renders 4 decimals", () => {
    assert.equal(usd(123), "$1.2300");
    assert.equal(usd(0.05), "$0.0005");
  });
});
