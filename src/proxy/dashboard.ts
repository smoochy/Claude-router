import { emptyTotals, foldOutcome, tierBreakdown } from '../totals.js';
import { DISPLAY_TIERS, DEFAULT_MODELS, DEFAULT_PRICING, counterfactualCents, type DisplayTier } from '../models.js';
import { savedCentsDisplay } from './format.js';
import { lookupSessionTitle } from './session-names.js';
import type { RouteEvent } from './route-event.js';
import type { LifetimeStats } from './history.js';

/** Sentinel option value for "events with no value on this field" — its own
 * slice rather than silently excluded, the precedent #4253 set for routingMode. */
const NONE = '__none__';

const TIER_BAR_LABEL: Record<DisplayTier, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
  fable: 'Fable',
  passthrough: 'Pass',
};

/**
 * Derived per-event label, not a filter (#4263/#4264): compares the pilotfish
 * pin against the billed model rather than reading a stored verdict. Absent
 * `requestedModel` means either no pin was sent or the line predates the
 * field — both render as "-", never as a wrong label.
 */
function pinLabel(e: RouteEvent): string {
  if (!e.requestedModel) return '<span class="none">-</span>';
  return e.requestedModel === e.model
    ? '<span class="badge badge-pin-honored" title="pilotfish pin matched the billed model">pin honored</span>'
    : `<span class="badge badge-pin-overridden" title="pilotfish asked for ${esc(e.requestedModel)}">overridden</span>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Dashboard mode filter, decided in #4246: a filter over the recorded history
 * rather than separate measurement windows, so an unrepresentative window can
 * be re-sliced after the fact instead of re-run.
 *
 * `unknown` is its own slice, not folded into `all` and not excluded. Lines
 * written before #4239 added `routingMode` (194k+ of them on a long-running
 * install) carry no field at all, and excluding them would make the default
 * view of a long history mostly empty while silently discarding most of the
 * data; a labeled slice keeps them visible without mixing them into a mode
 * that never actually produced them.
 */
export const DASHBOARD_MODES = ['all', 'route', 'observe', 'off', 'unknown'] as const;
export type DashboardMode = (typeof DASHBOARD_MODES)[number];

const MODE_LABEL: Record<DashboardMode, string> = {
  all: 'All',
  route: 'Route',
  observe: 'Observe',
  off: 'Off',
  unknown: 'Unknown (pre-#4239)',
};

/** Filters the history by `routingMode`. Exported for the filtering/recomputation tests. */
export function filterByMode(history: RouteEvent[], mode: DashboardMode): RouteEvent[] {
  if (mode === 'all') return history;
  if (mode === 'unknown') return history.filter((e) => e.routingMode === undefined);
  return history.filter((e) => e.routingMode === mode);
}

export const TIME_WINDOWS = ['all', 'today', 'hour'] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

const WINDOW_LABEL: Record<TimeWindow, string> = { all: 'All time', today: 'Today', hour: 'Last hour' };

/**
 * The five filters from #4267, on top of the #4246 mode filter. All read
 * fields already on `RouteEvent` — no new recording. A field left undefined
 * (or `'all'` for window) means "no constraint from this control"; `NONE`
 * means "only events where this field is absent" — role and session are both
 * optional on the event, so "absent" is a real, selectable case rather than a
 * silent exclusion (#4253's precedent for pre-field history).
 */
export interface DashboardFilters {
  mode?: DashboardMode;
  role?: string;
  model?: string;
  tier?: string;
  session?: string;
  window?: TimeWindow;
  auto?: boolean;
}

function roleLabel(e: RouteEvent): string | undefined {
  return e.role ?? (e.coordinator ? 'coordinator' : undefined);
}

function inWindow(timestamp: string, window: TimeWindow): boolean {
  if (window === 'all') return true;
  const t = new Date(timestamp);
  if (Number.isNaN(t.getTime())) return false;
  if (window === 'hour') return Date.now() - t.getTime() <= 60 * 60 * 1000;
  const now = new Date();
  return (
    t.getUTCFullYear() === now.getUTCFullYear() &&
    t.getUTCMonth() === now.getUTCMonth() &&
    t.getUTCDate() === now.getUTCDate()
  );
}

/** Applies every active control as one AND, recomputed from the full history — exported for the filter/recomputation tests. */
export function filterHistory(history: RouteEvent[], filters: DashboardFilters): RouteEvent[] {
  let out = filterByMode(history, filters.mode ?? 'all');
  if (filters.role) out = out.filter((e) => (filters.role === NONE ? roleLabel(e) === undefined : roleLabel(e) === filters.role));
  if (filters.model) out = out.filter((e) => e.model === filters.model);
  if (filters.tier) out = out.filter((e) => String(e.tier) === filters.tier);
  if (filters.session) out = out.filter((e) => (filters.session === NONE ? e.sessionId === undefined : e.sessionId === filters.session));
  if (filters.window) out = out.filter((e) => inWindow(e.timestamp, filters.window!));
  return out;
}

/** Distinct, present-in-the-history values for one filter's options — never a hardcoded list (#4267). */
function distinct(history: RouteEvent[], pick: (e: RouteEvent) => string | undefined): { values: string[]; hasNone: boolean } {
  const seen = new Set<string>();
  let hasNone = false;
  for (const e of history) {
    const v = pick(e);
    if (v === undefined) hasNone = true;
    else seen.add(v);
  }
  return { values: [...seen].sort(), hasNone };
}

/**
 * Readable label for the session filter's options (#4267): the session's own
 * name when the transcript resolves one, else a label derived purely from
 * this session's slice of the history — start time, duration, request count,
 * most frequent role. Never throws; `lookupSessionTitle` is already best-effort.
 */
export function sessionLabel(sessionId: string, eventsForSession: RouteEvent[]): string {
  const own = lookupSessionTitle(sessionId);
  if (own) return own;
  return deriveSessionLabel(eventsForSession);
}

function deriveSessionLabel(events: RouteEvent[]): string {
  if (events.length === 0) return 'empty session';
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const start = new Date(sorted[0]!.timestamp);
  const end = new Date(sorted[sorted.length - 1]!.timestamp);
  const minutes = Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    ? 0
    : Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

  const roleCounts = new Map<string, number>();
  for (const e of events) {
    const label = roleLabel(e);
    if (label) roleCounts.set(label, (roleCounts.get(label) ?? 0) + 1);
  }
  let topRole = '';
  let topCount = 0;
  for (const [role, count] of roleCounts) if (count > topCount) { topRole = role; topCount = count; }

  const parts: string[] = [];
  if (!Number.isNaN(start.getTime())) {
    const dd = String(start.getUTCDate()).padStart(2, '0');
    const mm = String(start.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(start.getUTCHours()).padStart(2, '0');
    const min = String(start.getUTCMinutes()).padStart(2, '0');
    parts.push(`${dd}.${mm}. ${hh}:${min}`);
  }
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${events.length} req`);
  if (topRole) parts.push(topRole);
  return parts.join(' - ');
}

export function renderDashboard(history: RouteEvent[], lifetime?: LifetimeStats, filters: DashboardFilters = {}): string {
  const mode = filters.mode ?? 'all';
  const filtered = filterHistory(history, filters);
  const totals = emptyTotals();
  for (const e of filtered) foldOutcome(totals, e);

  const totalRequests = totals.requests;
  const totalCost = totals.costCents;
  const totalSaved = totals.savedCents;
  const retried = totals.retried;
  // Orchestration cards render only once there is a coordinator turn to count.
  const { turns, dispatched, nested } = totals.dispatch;
  const dispatchCard = turns > 0
    ? `<div class="stat-card card">
      <div class="label">Dispatch Rate</div>
      <div class="value">${((dispatched / turns) * 100).toFixed(0)}%</div>
      <div class="sub">${dispatched} of ${turns} coordinator turns${nested > 0 ? ` · <span class="negative">${nested} nested</span>` : ''}</div>
    </div>`
    : '';
  const allOpus = totals.tokens.input + totals.tokens.output > 0
    ? counterfactualCents(totals.tokens, DEFAULT_MODELS.opus, DEFAULT_PRICING)
    : 0;
  const counterfactualCard = allOpus > 0
    ? `<div class="stat-card card">
      <div class="label">vs All-Opus</div>
      <div class="value orange">$${(allOpus / 100).toFixed(4)}</div>
      <div class="sub">same tokens on ${esc(DEFAULT_MODELS.opus)} · upper bound</div>
    </div>`
    : '';
  const roleRows = Object.entries(totals.byRole)
    .sort((a, b) => b[1].costCents - a[1].costCents)
    .map(([name, r]) => `<div class="role-row"><span class="role-name">${esc(name)}</span><span>${r.requests} req</span><span>$${(r.costCents / 100).toFixed(4)}</span></div>`)
    .join('');

  // DISPLAY_TIERS, not a hand-written list: the list here used to omit `fable`,
  // which both hid fable routes from the chart and left them out of its own
  // percentage denominator, so the bars quietly failed to total 100%.
  const tierCounts = tierBreakdown(totals, DISPLAY_TIERS);
  const tierTotal = DISPLAY_TIERS.reduce((n, t) => n + tierCounts[t], 0) || 1;
  const tierBars = DISPLAY_TIERS.map((t) => ({
    tier: t,
    count: tierCounts[t],
    pct: ((tierCounts[t] / tierTotal) * 100).toFixed(1),
  }))
    .filter((b) => Number(b.pct) > 0)
    .map((b) => `<div class="tier-${b.tier}" style="width:${b.pct}%">${TIER_BAR_LABEL[b.tier]} ${b.count} (${b.pct}%)</div>`)
    .join('');

  // A card reading "$0.0000 saved" is indistinguishable from a quiet week, so
  // any unpriced call gets called out next to the figures it silently deflates.
  const unpricedNote = (models: Record<string, number>): string => {
    const entries = Object.entries(models);
    if (entries.length === 0) return '';
    const calls = entries.reduce((n, [, c]) => n + c, 0);
    const names = entries.map(([m]) => m).join(', ');
    return `<div class="warn">${calls} call${calls === 1 ? '' : 's'} unpriced: ${esc(names)}</div>`;
  };
  const sessionUnpriced = unpricedNote(totals.unpricedModels);
  const lifetimeUnpriced = lifetime ? unpricedNote(lifetime.unpricedModels) : '';

  const recent = filtered.slice(-50).reverse();

  const modeOptions = DASHBOARD_MODES.map(
    (m) => `<option value="${m}"${m === mode ? ' selected' : ''}>${esc(MODE_LABEL[m])}</option>`,
  ).join('');

  // Option lists come from the full history, not a hardcoded list (#4267) —
  // a role/model/tier that never ran never appears, and one that did always does.
  const roleValues = distinct(history, roleLabel);
  const modelValues = distinct(history, (e) => e.model);
  const tierValues = distinct(history, (e) => String(e.tier));
  const sessionValues = distinct(history, (e) => e.sessionId);

  const simpleOptions = (values: string[], hasNone: boolean, noneLabel: string, selected: string | undefined): string => {
    const opts = values.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`);
    if (hasNone) opts.push(`<option value="${NONE}"${selected === NONE ? ' selected' : ''}>${esc(noneLabel)}</option>`);
    return [`<option value=""${selected ? '' : ' selected'}>All</option>`, ...opts].join('');
  };

  // Session options need a readable label, not the raw id (#4267) — resolved
  // from the session's own transcript title, falling back to a label derived
  // from that session's own slice of the (unfiltered) history.
  const eventsBySession = new Map<string, RouteEvent[]>();
  for (const e of history) {
    if (e.sessionId === undefined) continue;
    (eventsBySession.get(e.sessionId) ?? eventsBySession.set(e.sessionId, []).get(e.sessionId)!).push(e);
  }
  const sessionOptionsBody = sessionValues.values
    .map((id) => `<option value="${esc(id)}"${id === filters.session ? ' selected' : ''}>${esc(sessionLabel(id, eventsBySession.get(id) ?? []))}</option>`)
    .join('');
  const sessionOptions = [
    `<option value=""${filters.session ? '' : ' selected'}>All</option>`,
    sessionOptionsBody,
    sessionValues.hasNone ? `<option value="${NONE}"${filters.session === NONE ? ' selected' : ''}>No session id</option>` : '',
  ].join('');

  const windowOptions = TIME_WINDOWS.map(
    (w) => `<option value="${w}"${w === (filters.window ?? 'all') ? ' selected' : ''}>${esc(WINDOW_LABEL[w])}</option>`,
  ).join('');

  const roleOptions = simpleOptions(roleValues.values, roleValues.hasNone, 'No role', filters.role);
  const modelOptions = simpleOptions(modelValues.values, false, '', filters.model);
  const tierOptions = simpleOptions(tierValues.values, false, '', filters.tier);

  const auto = filters.auto !== false;
  // Carries the active filters as query params so the refresh target keeps
  // them — otherwise auto-refresh resets every control to "All" every 10s.
  const refreshParams = new URLSearchParams();
  if (filters.mode && filters.mode !== 'all') refreshParams.set('mode', filters.mode);
  if (filters.role) refreshParams.set('role', filters.role);
  if (filters.model) refreshParams.set('model', filters.model);
  if (filters.tier) refreshParams.set('tier', filters.tier);
  if (filters.session) refreshParams.set('session', filters.session);
  if (filters.window && filters.window !== 'all') refreshParams.set('window', filters.window);
  refreshParams.set('auto', '1');
  const refreshUrl = `/dashboard?${refreshParams.toString()}`;
  const metaRefresh = auto ? `<meta http-equiv="refresh" content="10;url=${refreshUrl}">` : '';

  const rows = recent
    .map(
      (e) => `
      <tr>
        <td>${esc(e.timestamp.replace('T', ' ').slice(0, 19))}</td>
        <td><span class="badge badge-${esc(String(e.tier))}">${esc(String(e.tier))}</span></td>
        <td>${esc(e.model)}</td>
        <td class="pin">${pinLabel(e)}</td>
        <td class="reason">${e.reason ? esc(e.reason) : '<span class="none">-</span>'}</td>
        <td class="role">${e.role ? esc(e.role) : e.coordinator ? 'coordinator' : '<span class="none">-</span>'}${e.dispatched ? ' <span class="badge badge-retry" title="called the Agent tool">dispatched</span>' : ''}</td>
        <td>${e.priced === false ? '<span class="unknown" title="no pricing for this model">—</span>' : `$${(e.costCents / 100).toFixed(4)}`}</td>
        <td class="${e.priced === false ? 'unknown' : e.savedCents >= 0 ? 'positive' : 'negative'}">${e.priced === false ? '—' : `$${(e.savedCents / 100).toFixed(4)}`}</td>
        <td>${e.confidence.toFixed(2)}</td>
        <td>${e.inputTokens}</td>
        <td>${e.outputTokens}</td>
        <td>${e.retried ? `<span class="badge badge-retry">${esc(e.retryReason ?? '')}</span>` : '<span class="none">-</span>'}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${metaRefresh}
  <title>claude-router dashboard</title>
  <style>
    :root {
      --void: #030304;
      --orange: #f7931a;
      --gold: #ffd166;
      --green: #0ecb81;
      --red: #f6465d;
      --violet: #b47cff;
      --steel: #8b95a7;
      --ink: #ece9e2;
      --ink-dim: #8f8a7e;
      --glass: rgba(255, 255, 255, 0.03);
      --glass-2: rgba(255, 255, 255, 0.015);
      --edge: rgba(247, 147, 26, 0.16);
      --edge-soft: rgba(255, 255, 255, 0.07);
      --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif;
      --mono: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, 'Roboto Mono', monospace;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { background: var(--void); }
    body {
      font-family: var(--sans);
      color: var(--ink);
      background-color: var(--void);
      background-image:
        radial-gradient(ellipse 70% 45% at 22% -8%, rgba(247, 147, 26, 0.09), transparent 65%),
        radial-gradient(ellipse 55% 40% at 85% 4%, rgba(255, 209, 102, 0.05), transparent 60%),
        linear-gradient(rgba(247, 147, 26, 0.024) 1px, transparent 1px),
        linear-gradient(90deg, rgba(247, 147, 26, 0.024) 1px, transparent 1px);
      background-size: auto, auto, 44px 44px, 44px 44px;
      padding: 30px clamp(16px, 4vw, 52px) 44px;
      max-width: 1680px;
      margin: 0 auto;
      min-height: 100vh;
    }
    ::selection { background: rgba(247, 147, 26, 0.85); color: var(--void); }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 28px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--edge);
      position: relative;
    }
    /* golden ember on the divider — light emanating from the structure itself */
    header::after {
      content: '';
      position: absolute;
      left: 0; bottom: -1px;
      height: 1px; width: 220px;
      background: linear-gradient(90deg, var(--orange), var(--gold) 60%, transparent);
      box-shadow: 0 0 12px rgba(247, 147, 26, 0.55);
    }
    h1 {
      font-size: 19px;
      font-weight: 650;
      letter-spacing: 0.01em;
      background: linear-gradient(90deg, var(--ink), var(--gold) 85%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: var(--ink);
    }
    .tagline {
      margin-top: 2px;
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--ink-dim);
    }
    .live {
      display: flex; align-items: center; gap: 8px;
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--ink-dim);
      padding: 7px 14px;
      border: 1px solid var(--edge-soft);
      border-radius: 999px;
      background: var(--glass);
      white-space: nowrap;
    }
    .live .dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 10px rgba(14, 203, 129, 0.9);
      animation: pulse 2.4s ease-in-out infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

    .filter-bar {
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
      padding: 10px 16px; margin-bottom: 18px;
    }
    .auto-toggle label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .mode-filter { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 11px; color: var(--ink-dim); }
    .mode-filter select {
      background: var(--void);
      color: var(--ink);
      border: 1px solid var(--edge-soft);
      border-radius: 6px;
      padding: 5px 8px;
      font-family: var(--mono);
      font-size: 11px;
    }
    .mode-filter select option {
      background: var(--void);
      color: var(--ink);
    }

    /* Glass panel: transparency stack + 1px edge + inner top highlight + warm glow */
    .card {
      position: relative;
      background: linear-gradient(160deg, var(--glass), var(--glass-2) 60%);
      border: 1px solid var(--edge-soft);
      border-radius: 14px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 12px 34px rgba(0, 0, 0, 0.5);
      transition: border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease;
    }
    .card:hover {
      border-color: var(--edge);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 12px 34px rgba(0, 0, 0, 0.5), 0 0 28px rgba(247, 147, 26, 0.12);
    }

    .stats { display: flex; gap: 10px; margin-bottom: 26px; flex-wrap: wrap; }
    .stat-card { min-width: 132px; flex: 1 1 auto; padding: 11px 14px 12px; }
    .stat-card:hover { transform: translateY(-2px); }
    .stat-card .label {
      font-family: var(--mono);
      font-size: 10px;
      color: var(--ink-dim);
      text-transform: uppercase;
      letter-spacing: 0.2em;
    }
    .stat-card .value {
      font-family: var(--mono);
      font-variant-numeric: tabular-nums;
      font-size: 21px;
      font-weight: 700;
      margin-top: 5px;
      color: var(--ink);
    }
    .stat-card .value.blue   { color: var(--orange); text-shadow: 0 0 18px rgba(247, 147, 26, 0.4); }
    .stat-card .value.orange { color: var(--gold);   text-shadow: 0 0 18px rgba(255, 209, 102, 0.35); }
    .stat-card .value.green  { color: var(--green);  text-shadow: 0 0 18px rgba(14, 203, 129, 0.35); }

    .section-label {
      display: flex; align-items: center; gap: 10px;
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--ink-dim);
      margin: 0 0 10px 2px;
    }
    .section-label::after {
      content: '';
      height: 1px; flex: 1;
      background: linear-gradient(90deg, var(--edge), transparent);
    }

    .tier-shell { margin-bottom: 26px; padding: 8px; }
    .tier-bar { display: flex; gap: 3px; height: 30px; border-radius: 8px; overflow: hidden; }
    .tier-bar div {
      display: flex; align-items: center; justify-content: center;
      overflow: hidden; white-space: nowrap;
      font-family: var(--mono);
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.06em;
      border-radius: 5px;
    }
    .tier-haiku       { background: linear-gradient(180deg, #14e695, #0bb371); color: #01180e; box-shadow: 0 0 16px rgba(14, 203, 129, 0.3); }
    .tier-sonnet      { background: linear-gradient(180deg, #ffa53d, #ef8a0e); color: #1d0e00; box-shadow: 0 0 16px rgba(247, 147, 26, 0.35); }
    .tier-opus        { background: linear-gradient(180deg, #ffdd85, #f5c04e); color: #1e1400; box-shadow: 0 0 16px rgba(255, 209, 102, 0.35); }
    .tier-fable       { background: linear-gradient(180deg, #c79bff, #9d5ff0); color: #16022e; box-shadow: 0 0 16px rgba(180, 124, 255, 0.35); }
    .tier-passthrough { background: linear-gradient(180deg, #55607a, #414b61); color: #dde3ee; }

    .table-shell { padding: 4px; }
    .table-wrap { overflow-x: auto; border-radius: 10px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-family: var(--mono);
      font-variant-numeric: tabular-nums;
    }
    th {
      background: rgba(255, 255, 255, 0.025);
      text-align: left;
      padding: 11px 14px;
      font-size: 10px;
      font-weight: 600;
      color: var(--ink-dim);
      text-transform: uppercase;
      letter-spacing: 0.16em;
      border-bottom: 1px solid var(--edge);
      white-space: nowrap;
    }
    td {
      padding: 9px 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.045);
      font-size: 12.5px;
      white-space: nowrap;
    }
    tbody tr { transition: background 0.15s ease; }
    tbody tr:hover td { background: rgba(247, 147, 26, 0.045); }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border: 1px solid;
    }
    .badge-haiku       { background: rgba(14, 203, 129, 0.1);  color: var(--green);  border-color: rgba(14, 203, 129, 0.35); }
    .badge-sonnet      { background: rgba(247, 147, 26, 0.1);  color: var(--orange); border-color: rgba(247, 147, 26, 0.4); }
    .badge-opus        { background: rgba(255, 209, 102, 0.1); color: var(--gold);   border-color: rgba(255, 209, 102, 0.4); }
    .badge-fable       { background: rgba(180, 124, 255, 0.1); color: var(--violet); border-color: rgba(180, 124, 255, 0.4); }
    .badge-passthrough { background: rgba(139, 149, 167, 0.1); color: var(--steel);  border-color: rgba(139, 149, 167, 0.35); }
    td.reason          { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--steel); }
    td.role            { font-size: 12px; }
    .stat-card .sub    { font-size: 11px; color: var(--steel); margin-top: 4px; }
    .roles             { padding: 8px 16px; }
    .role-row          { display: grid; grid-template-columns: 1fr auto auto; gap: 16px; padding: 6px 0; font-size: 13px; border-bottom: 1px solid rgba(139, 149, 167, 0.15); }
    .role-row:last-child { border-bottom: 0; }
    .role-name         { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .badge-retry       { background: rgba(246, 70, 93, 0.1);   color: var(--red);    border-color: rgba(246, 70, 93, 0.4); }
    .badge-pin-honored    { background: rgba(14, 203, 129, 0.1); color: var(--green); border-color: rgba(14, 203, 129, 0.35); }
    .badge-pin-overridden { background: rgba(255, 209, 102, 0.1); color: var(--gold);  border-color: rgba(255, 209, 102, 0.4); }
    td.pin             { font-size: 12px; }
    .none { color: var(--ink-dim); }
    .unknown { color: var(--gold); }
    .warn {
      margin-top: 9px;
      padding: 5px 10px;
      font-family: var(--mono);
      font-size: 10.5px;
      line-height: 1.5;
      color: var(--gold);
      background: rgba(255, 209, 102, 0.07);
      border: 1px solid rgba(255, 209, 102, 0.25);
      border-radius: 8px;
    }
    .warn::before { content: '\\26A0 '; }
    .positive { color: var(--green); }
    .negative { color: var(--red); text-shadow: 0 0 12px rgba(246, 70, 93, 0.35); }
    .empty { text-align: center; padding: 30px; color: var(--ink-dim); font-family: var(--sans); font-size: 13px; }
    .footer {
      margin-top: 18px;
      font-family: var(--mono);
      font-size: 10.5px;
      letter-spacing: 0.1em;
      color: var(--ink-dim);
    }

    @media (prefers-reduced-motion: reduce) {
      .live .dot { animation: none; }
      .card, .stat-card, tbody tr { transition: none; }
      .stat-card:hover { transform: none; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>claude-router dashboard</h1>
      <div class="tagline">routing ledger &middot; cost engine</div>
    </div>
    <div class="live"><span class="dot"></span>live &middot; refresh ${auto ? 'on' : 'off'}</div>
  </header>

  <form class="filter-bar card" method="GET" action="/dashboard">
    <div class="mode-filter">
      <label for="mode">Mode</label>
      <select id="mode" name="mode" onchange="this.form.submit()">${modeOptions}</select>
    </div>
    <div class="mode-filter">
      <label for="role">Role</label>
      <select id="role" name="role" onchange="this.form.submit()">${roleOptions}</select>
    </div>
    <div class="mode-filter">
      <label for="model">Model</label>
      <select id="model" name="model" onchange="this.form.submit()">${modelOptions}</select>
    </div>
    <div class="mode-filter">
      <label for="tier">Tier</label>
      <select id="tier" name="tier" onchange="this.form.submit()">${tierOptions}</select>
    </div>
    <div class="mode-filter">
      <label for="session">Session</label>
      <select id="session" name="session" onchange="this.form.submit()">${sessionOptions}</select>
    </div>
    <div class="mode-filter">
      <label for="window">Window</label>
      <select id="window" name="window" onchange="this.form.submit()">${windowOptions}</select>
    </div>
    <div class="mode-filter auto-toggle">
      <input type="hidden" name="auto" value="0">
      <label for="auto"><input type="checkbox" id="auto" name="auto" value="1"${auto ? ' checked' : ''} onchange="this.form.submit()"> Auto-update</label>
    </div>
  </form>

  <div class="stats">
    <div class="stat-card card">
      <div class="label">Session Requests</div>
      <div class="value blue">${totalRequests}</div>
    </div>
    <div class="stat-card card">
      <div class="label">Session Cost</div>
      <div class="value orange">$${(totalCost / 100).toFixed(4)}</div>
    </div>
    ${(() => {
      const d = savedCentsDisplay(totalSaved, false, 4);
      const toneClass = d.tone === 'neutral' ? '' : d.tone;
      return `<div class="stat-card card">
      <div class="label">Session Saved</div>
      <div class="value${toneClass ? ` ${toneClass}` : ''}">${d.text}</div>
      ${sessionUnpriced}
    </div>`;
    })()}
    <div class="stat-card card">
      <div class="label">Auto-retried</div>
      <div class="value">${retried}</div>
    </div>
    ${dispatchCard}
    ${counterfactualCard}
    ${lifetime ? (() => {
      const d = savedCentsDisplay(lifetime.savedCents);
      const toneClass = d.tone === 'neutral' ? '' : d.tone;
      return `
    <div class="stat-card card">
      <div class="label">Lifetime Saved</div>
      <div class="value${toneClass ? ` ${toneClass}` : ''}">${d.text}</div>
      ${lifetimeUnpriced}
    </div>
    <div class="stat-card card">
      <div class="label">Lifetime Requests</div>
      <div class="value blue">${lifetime.requests}</div>
    </div>`;
    })() : ''}
  </div>

  ${roleRows ? `<div class="section-label">By Role</div>
  <div class="card roles">${roleRows}</div>` : ''}

  <div class="section-label">Tier Distribution</div>
  <div class="tier-shell card">
    <div class="tier-bar">
      ${tierBars}
    </div>
  </div>

  <div class="section-label">Route Feed</div>
  <div class="table-shell card">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Tier</th>
            <th>Model</th>
            <th>Pin</th>
            <th>Reason</th>
            <th>Role</th>
            <th>Cost</th>
            <th>Saved</th>
            <th>Confidence</th>
            <th>In Tokens</th>
            <th>Out Tokens</th>
            <th>Retry</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="11" class="empty">No requests yet. Send requests to the proxy to see data here.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <div class="footer">Auto-refreshes every 10 seconds. Showing last ${Math.min(50, filtered.length)} of ${filtered.length} requests.</div>
</body>
</html>`;
}
