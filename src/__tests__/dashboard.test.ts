import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterByMode, filterHistory, renderDashboard, sessionLabel } from '../proxy/dashboard.js';
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
  it('"all" returns the full set, including lines with no routingMode', () => {
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

  it('"unknown" picks up lines that carry no routingMode at all', () => {
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
    const all = renderDashboard(history, undefined, { mode: 'all' });
    const route = renderDashboard(history, undefined, { mode: 'route' });
    assert.match(all, /\$1\.1100/); // (10 + 1 + 100) / 100
    assert.match(route, /\$0\.1000/); // 10 / 100
    assert.doesNotMatch(route, /\$1\.1100/);
  });

  it('an empty "off" slice renders rather than throwing, with zeroed figures', () => {
    const history = [e({ routingMode: 'route' })];
    const html = renderDashboard(history, undefined, { mode: 'off' });
    assert.match(html, /No requests yet/);
  });

  it('defaults to "all" when no mode is given, matching pre-filter behavior', () => {
    const history = [e({ routingMode: 'route' }), e({ routingMode: undefined })];
    assert.equal(renderDashboard(history), renderDashboard(history, undefined, { mode: 'all' }));
  });
});

describe('filterHistory - AND combination across all filters', () => {
  const history = [
    e({ role: 'recon', model: 'claude-haiku-5', tier: 'haiku', sessionId: 'sess-a', timestamp: '2026-09-04T10:00:00.000Z' }),
    e({ role: 'builder', model: 'claude-sonnet-5', tier: 'sonnet', sessionId: 'sess-a', timestamp: '2026-09-04T10:05:00.000Z' }),
    e({ role: 'recon', model: 'claude-haiku-5', tier: 'haiku', sessionId: 'sess-b', timestamp: '2026-09-04T10:00:00.000Z' }),
    e({ model: 'claude-sonnet-5', tier: 'sonnet', sessionId: undefined, timestamp: '2026-09-04T10:00:00.000Z' }), // no role, no session
  ];

  it('combines every active control with AND, not OR', () => {
    const out = filterHistory(history, { role: 'recon', session: 'sess-a' });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.sessionId, 'sess-a');
    assert.equal(out[0]!.role, 'recon');
  });

  it('role, model, tier and session each narrow independently', () => {
    assert.equal(filterHistory(history, { role: 'builder' }).length, 1);
    assert.equal(filterHistory(history, { model: 'claude-haiku-5' }).length, 2);
    assert.equal(filterHistory(history, { tier: 'sonnet' }).length, 2);
    assert.equal(filterHistory(history, { session: 'sess-b' }).length, 1);
  });

  it('the NONE sentinel picks up events missing that field - its own slice, never silently excluded', () => {
    const noRole = filterHistory(history, { role: '__none__' });
    assert.equal(noRole.length, 1);
    assert.equal(noRole[0]!.role, undefined);
    const noSession = filterHistory(history, { session: '__none__' });
    assert.equal(noSession.length, 1);
    assert.equal(noSession[0]!.sessionId, undefined);
  });

  it('an empty filters object is a no-op (mode defaults to "all")', () => {
    assert.equal(filterHistory(history, {}).length, history.length);
  });
});

describe('sessionLabel - readable session names', () => {
  it('falls back to a derived label when the transcript resolves no title', () => {
    const events = [
      e({ sessionId: 'sess-x', role: 'coordinator', coordinator: true, timestamp: '2026-10-10T17:03:00.000Z' }),
      e({ sessionId: 'sess-x', role: 'coordinator', coordinator: true, timestamp: '2026-10-10T17:03:00.000Z' }),
    ];
    const label = sessionLabel('sess-x-does-not-exist-anywhere', events);
    assert.match(label, /^10\.10\. 17:03/);
    assert.match(label, /2 req/);
    assert.match(label, /coordinator/);
  });

  it('never throws when the transcript directory does not exist', () => {
    assert.doesNotThrow(() => sessionLabel('no-such-session-id', []));
  });
});
