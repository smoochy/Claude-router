import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extraCostNote, filterByMode, filterHistory, parseRefresh, renderDashboard, sessionLabel } from '../proxy/dashboard.js';
import { emptyTotals, foldOutcome } from '../totals.js';
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

  it('styles select popups dark, including the refresh dropdown and the selected option', () => {
    const html = renderDashboard([]);
    assert.match(html, /select \{ color-scheme: dark; \}/);
    assert.match(html, /\.live select option,\s*\.mode-filter select option \{\s*background: var\(--void\);\s*color: var\(--ink\);/);
    assert.doesNotMatch(html, /option:checked/);
    assert.match(html, /\.live select \{ font-family: var\(--mono\); font-size: 11px; letter-spacing: normal;/);
    assert.match(html, /header \.gh \{ order: 1; \}\s*header \.live \{ order: 2; \}/);
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
    const start = new Date('2026-10-10T17:03:00.000Z').toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    assert.ok(label.startsWith(start), `${label} should start with ${start}`);
    assert.match(label, /2 req/);
    assert.match(label, /coordinator/);
  });

  it('never throws when the transcript directory does not exist', () => {
    assert.doesNotThrow(() => sessionLabel('no-such-session-id', []));
  });
});

describe('renderDashboard - net saved, extra cost and the All-Opus card', () => {
  const history = [
    e({ savedCents: 4, requestedModel: 'claude-opus-5-5', model: 'claude-sonnet-5-5' }),
    e({ savedCents: -3, requestedModel: 'claude-sonnet-5-5', model: 'claude-opus-5-5' }),
    e({ savedCents: -2 }),
    e({ savedCents: 0, priced: false }),
  ];
  const lifetime = emptyTotals();
  for (const ev of history) foldOutcome(lifetime, ev);

  it('folds only priced negative events into extra, with the pre-#4264 events as their own slice', () => {
    assert.deepEqual(lifetime.extra, { events: 2, cents: 5, unknownEvents: 1, unknownCents: 2 });
  });

  it('explains the net headline with gross saved, extra cost and the unknown slice', () => {
    const html = renderDashboard(history, lifetime);
    assert.match(html, /<span class="negative">\$0\.05 extra cost<\/span>/);
    assert.match(html, /Gross saved <b>\$0\.04<\/b>/);
    assert.match(html, /2 events on a model above the baseline/);
    assert.match(html, /1 without requestedModel <b>\$0\.02<\/b> &middot; baseline unknown/);
  });

  it('sends auto exactly once, from a single hidden input', () => {
    const html = renderDashboard(history, lifetime);
    assert.equal(html.match(/name="auto"/g)?.length, 1);
  });

  it('adds no extra-cost line when nothing was negative', () => {
    assert.equal(extraCostNote(emptyTotals()), '');
  });

  it('names the configured opus tier on the All-Opus card, not the compiled-in default', () => {
    assert.match(renderDashboard([e()], undefined, {}, 'claude-opus-9-9'), /Same tokens priced on claude-opus-9-9/);
  });

  it('defaults the All-Opus card to the compiled-in 5.5 tier', () => {
    assert.match(renderDashboard([e()]), /Same tokens priced on claude-opus-5-5/);
  });
});

describe('pin and reason filters', () => {
  const h = [
    e({ requestedModel: 'claude-sonnet-5', model: 'claude-sonnet-5', reason: 'agentic:default' }),
    e({ requestedModel: 'claude-opus-5', model: 'claude-sonnet-5', reason: 'role:recon' }),
    e({}),
  ];
  it('filters by pin state and by absent pin', () => {
    assert.equal(filterHistory(h, { pin: 'honored' }).length, 1);
    assert.equal(filterHistory(h, { pin: 'overridden' }).length, 1);
    assert.equal(filterHistory(h, { pin: '__none__' }).length, 1);
  });
  it('filters by exact reason and by absent reason', () => {
    assert.equal(filterHistory(h, { reason: 'role:recon' }).length, 1);
    assert.equal(filterHistory(h, { reason: '__none__' }).length, 1);
  });
  it('explains reasons and headers on hover', () => {
    const html = renderDashboard(h);
    assert.match(html, /<th title="[^"]+" class="help">Confidence<\/th>/);
    assert.match(html, /title="Role named by an explicit marker in the prompt\."/);
  });
});

describe('filter row and retry help', () => {
  const html = renderDashboard([e({ retried: true, retryReason: 'truncation' })]);
  it('lists the selects in route-feed order, one row', () => {
    const ids = [...html.matchAll(/<select id="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ['mode', 'scope', 'window', 'session', 'tier', 'model', 'pin', 'reason', 'retry', 'role']);
    assert.match(html, /flex-wrap: nowrap/);
  });
  it('gives every filter label a hover/focus popover', () => {
    const labels = [...html.matchAll(/<label for="(\w+)" class="has-tip" tabindex="0">(\w+)<span class="tip-body" role="tooltip">[^<]+<\/span><\/label>/g)];
    assert.equal(labels.length, 10);
  });
  it('filters by retry reason and by not retried, ANDed with other filters', () => {
    const h = [
      e({ retried: true, retryReason: 'truncation', tier: 'opus' }),
      e({ retried: true, retryReason: 'refusal', tier: 'opus' }),
      e({ tier: 'opus' }),
      e({ retried: true, retryReason: 'truncation', tier: 'haiku' }),
    ];
    assert.equal(filterHistory(h, { retry: 'truncation' }).length, 2);
    assert.equal(filterHistory(h, { retry: '__none__' }).length, 1);
    assert.equal(filterHistory(h, { retry: 'truncation', tier: 'opus' }).length, 1);
    const page = renderDashboard(h, undefined, { retry: 'refusal' });
    assert.match(page, /<option value="refusal" selected>refusal<\/option>/);
    assert.match(page, /<option value="__none__">No retry<\/option>/);
    assert.ok(page.includes('retry=refusal'), 'refresh url keeps the retry filter');
  });
  it('explains retry in header and cell', () => {
    assert.match(html, /<th title="[^"]+" class="help">Retry<\/th>/);
    assert.match(html, /title="Retried after truncation/);
  });
});

describe('refresh pill and reset button', () => {
  it('parses intervals, maps legacy auto=0/1, and falls back to 10s', () => {
    assert.equal(parseRefresh(undefined), 10);
    assert.equal(parseRefresh('0'), 0);
    assert.equal(parseRefresh('1'), 10);
    for (const n of [10, 20, 30, 45, 60]) assert.equal(parseRefresh(String(n)), n);
    for (const bad of ['7', '', 'x', '-1', '3600']) assert.equal(parseRefresh(bad), 10);
  });
  it('renders the chosen interval as selected and as a deferred-reload script', () => {
    const html = renderDashboard([e()], undefined, { tier: 'haiku', auto: 30 });
    assert.match(html, /<option value="30" selected>30s<\/option>/);
    assert.ok(!html.includes('http-equiv="refresh"'));
    const scripts = html.match(/<script>[\s\S]*?<\/script>/g) ?? [];
    assert.equal(scripts.length, 1);
    assert.ok(scripts[0].includes('.has-tip:hover'), 'defers while a tooltip is open');
    assert.ok(scripts[0].includes('"/dashboard?tier=haiku&auto=30"'));
    // Open-dropdown pause: the DOM-event logic is not run here (no DOM); it is verified by hand in a browser.
    assert.ok(scripts[0].includes('o&&i'), 'defers while a dropdown is open with the pointer on it');
    assert.doesNotThrow(() => new Function(scripts[0].slice('<script>'.length, -'</script>'.length)), 'script parses');
    assert.ok(scripts[0].endsWith(',30000)</script>'));
    assert.match(html, /<div class="live"/);
  });
  it('footer names the active interval or off', () => {
    assert.match(renderDashboard([e()], undefined, { auto: 30 }), /Auto-refreshes every 30 seconds\./);
    assert.match(renderDashboard([e()], undefined, {}), /Auto-refreshes every 10 seconds\./);
    assert.match(renderDashboard([e()], undefined, { auto: 0 }), /Auto-refresh is off\./);
  });
  it('off pauses the LED and runs no timer', () => {
    const off = renderDashboard([e()], undefined, { auto: 0 });
    assert.match(off, /<div class="live paused"/);
    assert.match(off, /<option value="0" selected>off<\/option>/);
    assert.ok(!off.includes('<script'));
  });
  it('resets filters but keeps the interval, and has no auto checkbox', () => {
    const html = renderDashboard([e()], undefined, { tier: 'haiku', auto: 45 });
    assert.match(html, /class="reset-btn" href="\/dashboard\?auto=45"/);
    assert.match(renderDashboard([e()], undefined, { auto: 0 }), /class="reset-btn" href="\/dashboard\?auto=0"/);
    assert.ok(!html.includes('type="checkbox"'));
  });
});

describe('dashboard version footer', () => {
  it('shows the running version in the footer and escapes it', () => {
    assert.match(renderDashboard([e()], undefined, {}, undefined, '1.2.3-smoo.4'), /<span class="version">v1\.2\.3-smoo\.4<\/span>/);
    assert.doesNotMatch(renderDashboard([e()], undefined, {}, undefined, '<x>'), /<x>/);
  });
  it('omits the version when none is given', () => {
    assert.doesNotMatch(renderDashboard([e()]), /class="version"/);
  });
});

describe('dashboard Neon glass theme', () => {
  const html = renderDashboard([e()]);
  it('defines the decoupled tier tokens and uses them for bars and badges', () => {
    for (const [t, c] of [['haiku', '#2ee6a8'], ['sonnet', '#22d3ee'], ['opus', '#4f8bff'], ['fable', '#a78bfa']]) {
      assert.ok(html.includes(`--t-${t}: ${c};`));
      assert.match(html, new RegExp(`\\.tier-${t}\\s+\\{[^}]*var\\(--t-${t}\\)`));
      assert.match(html, new RegExp(`\\.badge-${t}\\s+\\{[^}]*color: var\\(--t-${t}\\)`));
    }
  });
  it('carries no leftover amber palette', () => {
    assert.doesNotMatch(html, /247, 147, 26|255, 209, 102|#f7931a|#ffd166/);
  });
  it('links the own repo with an inline icon in the header', () => {
    assert.match(html, /<header>[\s\S]*<a class="gh" href="https:\/\/github\.com\/smoochy\/Claude-router"[^>]*><svg[\s\S]*<\/header>/);
  });
  it('credits the theme source in the footer', () => {
    assert.match(html, /Theme: Neon glass &middot; palette from <a href="https:\/\/github\.com\/RayVelez27\/instalanding\.ai\/tree\/main\/pages\/neon-glass-app-landing-page">instalanding\.ai\/neon-glass-app-landing-page<\/a> \(MIT, Ray Velez\)/);
  });
});
