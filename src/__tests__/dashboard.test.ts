import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterByMode, renderDashboard } from '../proxy/dashboard.js';
import type { RouteEvent } from '../proxy/route-event.js';

function e(overrides: Partial<RouteEvent> = {}): RouteEvent {
  return {
    timestamp: '2026-09-04T10:00:00.000Z',
    tier: 'sonnet',
    model: 'claude-sonnet-5',
    costCents: 1,
    savedCents: 0.5,
    confidence: 1,
    classifier: 'ai',
    retried: false,
    retryReason: null,
    inputTokens: 10,
    outputTokens: 5,
    ...overrides,
  };
}

describe('filterByMode', () => {
  it('"all" returns the full set, including pre-#4239 lines with no routingMode', () => {
    const history = [e({ routingMode: 'route' }), e({ routingMode: undefined })];
    assert.equal(filterByMode(history, 'all').length, 2);
  });

  it('filters to exactly the requested mode', () => {
    const history = [e({ routingMode: 'route' }), e({ routingMode: 'observe' }), e({ routingMode: 'off' })];
    assert.deepEqual(filterByMode(history, 'route').map((h) => h.routingMode), ['route']);
    assert.deepEqual(filterByMode(history, 'observe').map((h) => h.routingMode), ['observe']);
  });

  it('"off" is a real, selectable slice even though off never records in practice', () => {
    const history = [e({ routingMode: 'off' })];
    assert.equal(filterByMode(history, 'off').length, 1);
  });

  it('"unknown" picks up pre-#4239 lines that carry no routingMode at all', () => {
    const history = [e({ routingMode: 'route' }), e({ routingMode: undefined })];
    const unknown = filterByMode(history, 'unknown');
    assert.equal(unknown.length, 1);
    assert.equal(unknown[0]!.routingMode, undefined);
  });
});

describe('renderDashboard — recomputation per mode', () => {
  it('recomputes cost totals and the tier breakdown for the filtered selection, not the whole history', () => {
    const history = [
      e({ routingMode: 'route', tier: 'opus', costCents: 10, savedCents: 2 }),
      e({ routingMode: 'observe', tier: 'haiku', costCents: 1, savedCents: 0 }),
      e({ routingMode: undefined, tier: 'sonnet', costCents: 100, savedCents: 50 }),
    ];
    const all = renderDashboard(history, undefined, 'all');
    const route = renderDashboard(history, undefined, 'route');
    assert.match(all, /\$1\.1100/); // (10 + 1 + 100) / 100
    assert.match(route, /\$0\.1000/); // 10 / 100
    assert.doesNotMatch(route, /\$1\.1100/);
  });

  it('an empty "off" slice renders rather than throwing, with zeroed figures', () => {
    const history = [e({ routingMode: 'route' })];
    const html = renderDashboard(history, undefined, 'off');
    assert.match(html, /No requests yet/);
  });

  it('defaults to "all" when no mode is given, matching pre-filter behavior', () => {
    const history = [e({ routingMode: 'route' }), e({ routingMode: undefined })];
    assert.equal(renderDashboard(history), renderDashboard(history, undefined, 'all'));
  });
});
