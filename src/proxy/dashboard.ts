import { emptyTotals, foldOutcome, tierBreakdown } from '../totals.js';
import { DISPLAY_TIERS, DEFAULT_MODELS, DEFAULT_PRICING, counterfactualCents, type DisplayTier } from '../models.js';
import { savedCentsDisplay } from './format.js';
import { lookupSessionTitle } from './session-names.js';
import type { RouteEvent } from './route-event.js';
import { HISTORY_TAIL_LINES, type LifetimeStats } from './history.js';

/** Sentinel option value for "events with no value on this field" - its own
 * slice rather than silently excluded, the precedent set for routingMode. */
const NONE = '__none__';

const TIER_BAR_LABEL: Record<DisplayTier, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
  fable: 'Fable',
  passthrough: 'Pass',
};

/**
 * Derived per-event label, not a filter: compares the pilotfish
 * pin against the billed model rather than reading a stored verdict. Absent
 * `requestedModel` means either no pin was sent or the line predates the
 * field — both render as "-", never as a wrong label.
 */
function pinLabel(e: RouteEvent): string {
  if (!e.requestedModel) return '<span class="none" title="No pin: the client sent no model, or this line predates the field.">-</span>';
  return e.requestedModel === e.model
    ? `<span class="badge badge-pin-honored" title="Pin honored: the client asked for ${esc(e.requestedModel)} and that is the model that was billed.">pin honored</span>`
    : `<span class="badge badge-pin-overridden" title="Overridden: the client asked for ${esc(e.requestedModel)} but the router billed ${esc(e.model)}.">overridden</span>`;
}

/** Filterable form of the pin comparison: honored / overridden, or absent when no model was requested. */
function pinState(e: RouteEvent): string | undefined {
  if (!e.requestedModel) return undefined;
  return e.requestedModel === e.model ? 'honored' : 'overridden';
}

const PIN_VALUES = ['honored', 'overridden'];

/** Plain-language meaning of a routing reason, matched on its prefix; unknown reasons say so rather than guess. */
export function reasonHelp(reason: string | undefined): string {
  if (!reason) return 'No reason recorded for this request.';
  const table: Array<[string, string]> = [
    ['agentic:mid-loop', 'Agentic session already running a tool loop: kept on sonnet.'],
    ['agentic:depth+long-horizon', 'Agentic request asking for depth over a long horizon: sent to fable.'],
    ['agentic:depth-requested', 'Agentic request that asked for deep reasoning: sent to opus.'],
    ['agentic:trivial', 'Trivial agentic request, opt-in cheap path: sent to haiku.'],
    ['agentic:default', 'Agentic session with no stronger signal: default sonnet.'],
    ['single-turn:depth+long-horizon', 'Single prompt asking for depth over a long horizon: sent to fable.'],
    ['single-turn:depth-requested', 'Single prompt that asked for deep reasoning: sent to opus.'],
    ['single-turn:short mechanical', 'Short mechanical transform: sent to haiku.'],
    ['single-turn:default', 'Single prompt with no stronger signal: default sonnet.'],
    ['subagent:readonly-tools', 'Subagent with read-only tools, treated as recon: pinned to haiku.'],
    ['subagent:write-tools', 'Subagent with write tools, treated as a builder.'],
    ['role:', 'Role named by an explicit marker in the prompt.'],
    ['agent:', 'Role taken from the agent type of the subagent.'],
  ];
  const hit = table.find(([p]) => reason.startsWith(p));
  return hit ? hit[1] : `Routing reason ${reason} (no description for this one).`;
}

/** Plain-language meaning of the role cell. */
function roleHelp(e: RouteEvent): string {
  if (e.role) return `Role ${e.role}: the kind of work this subagent was doing${e.roleSource ? ` (detected from ${e.roleSource})` : ''}.`;
  if (e.coordinator) return 'Coordinator: the main session that can dispatch subagents.';
  return 'No role: an ordinary request outside any subagent.';
}

function confidenceHelp(e: RouteEvent): string {
  return `Classifier confidence ${e.confidence.toFixed(2)} on a 0 to 1 scale${e.classifier ? ` (${e.classifier})` : ''}. 1.00 means a fixed rule or pin, lower means a heuristic guess.`;
}

const HEADER_HELP = {
  pin: 'Whether the model the client asked for (pilotfish pin) is the one that was billed: honored or overridden.',
  reason: 'The routing rule that picked the tier. Hover an entry for its meaning.',
  role: 'What kind of request this was: coordinator, a subagent role, or none.',
  confidence: 'How sure the classifier was, 0 to 1. 1.00 means a fixed rule or pin.',
} as const;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Dashboard mode filter: a filter over the recorded history
 * rather than separate measurement windows, so an unrepresentative window can
 * be re-sliced after the fact instead of re-run.
 *
 * `unknown` is its own slice, not folded into `all` and not excluded. Lines
 * written before `routingMode` was added (194k+ of them on a long-running
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
  unknown: 'Unknown (pre-routingMode)',
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
 * The five filters, on top of the mode filter. All read
 * fields already on `RouteEvent` - no new recording. A field left undefined
 * (or `'all'` for window) means "no constraint from this control"; `NONE`
 * means "only events where this field is absent" - role and session are both
 * optional on the event, so "absent" is a real, selectable case rather than a
 * silent exclusion, the precedent set for pre-field history.
 */
export interface DashboardFilters {
  mode?: DashboardMode;
  role?: string;
  model?: string;
  tier?: string;
  /** `honored` | `overridden` | NONE (no model requested). */
  pin?: string;
  reason?: string;
  session?: string;
  window?: TimeWindow;
  auto?: boolean;
  /** `session` (default): events since this router started. `all`: tail of history.jsonl. */
  scope?: DashboardScope;
}

export const DASHBOARD_SCOPES = ['session', 'all'] as const;
export type DashboardScope = (typeof DASHBOARD_SCOPES)[number];

function roleLabel(e: RouteEvent): string | undefined {
  return e.role ?? (e.coordinator ? 'coordinator' : undefined);
}

/** Stored timestamps are UTC ISO; the dashboard shows them in the host's own locale and timezone. */
export function localStamp(timestamp: string): string {
  const t = new Date(timestamp);
  return Number.isNaN(t.getTime()) ? timestamp : t.toLocaleString();
}

function inWindow(timestamp: string, window: TimeWindow): boolean {
  if (window === 'all') return true;
  const t = new Date(timestamp);
  if (Number.isNaN(t.getTime())) return false;
  if (window === 'hour') return Date.now() - t.getTime() <= 60 * 60 * 1000;
  const now = new Date();
  return (
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate()
  );
}

/** Applies every active control as one AND, recomputed from the full history — exported for the filter/recomputation tests. */
export function filterHistory(history: RouteEvent[], filters: DashboardFilters): RouteEvent[] {
  let out = filterByMode(history, filters.mode ?? 'all');
  if (filters.role) out = out.filter((e) => (filters.role === NONE ? roleLabel(e) === undefined : roleLabel(e) === filters.role));
  if (filters.model) out = out.filter((e) => e.model === filters.model);
  if (filters.tier) out = out.filter((e) => String(e.tier) === filters.tier);
  if (filters.pin) out = out.filter((e) => (filters.pin === NONE ? pinState(e) === undefined : pinState(e) === filters.pin));
  if (filters.reason) out = out.filter((e) => (filters.reason === NONE ? e.reason === undefined : e.reason === filters.reason));
  if (filters.session) out = out.filter((e) => (filters.session === NONE ? e.sessionId === undefined : e.sessionId === filters.session));
  if (filters.window) out = out.filter((e) => inWindow(e.timestamp, filters.window!));
  return out;
}

/** Distinct, present-in-the-history values for one filter's options - never a hardcoded list. */
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
 * Readable label for the session filter's options: the session's own
 * name when the transcript resolves one, else a label derived purely from
 * this session's slice of the history - start time, duration, request count,
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
    parts.push(start.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
  }
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${events.length} req`);
  if (topRole) parts.push(topRole);
  return parts.join(' - ');
}

/**
 * A stat card whose explanation lives in a hover/focus popover rather than in
 * prose under the figure, so every card keeps the same height and the row does
 * not reflow when a scope or filter changes which notes apply.
 */
function statCard(label: string, value: string, valueClass: string, sub: string, tipLines: string[]): string {
  const tip = tipLines.length > 0
    ? `<div class="tip-body" role="tooltip">${tipLines.map((l) => `<div>${l}</div>`).join('')}</div>`
    : '';
  return `<div class="stat-card card${tip ? ' has-tip' : ''}"${tip ? ' tabindex="0"' : ''}>
      <div class="label">${label}</div>
      <div class="value${valueClass ? ` ${valueClass}` : ''}">${value}</div>
      <div class="sub">${sub || '&nbsp;'}</div>
      ${tip}
    </div>`;
}

const usd2 = (c: number): string => `$${(c / 100).toFixed(2)}`;

/**
 * Short marker under a net saved figure that has a negative side; empty when
 * nothing was extra, so a plain positive figure stays unadorned.
 */
export function extraCostNote(t: LifetimeStats): string {
  if (t.extra.events === 0) return '';
  return `<span class="negative">${usd2(t.extra.cents)} extra cost</span>`;
}

/**
 * Popover lines for a net saved figure: gross saved vs the extra cost of
 * events served on a model priced above the baseline, with the pre-#4264
 * events (no requestedModel, baseline unknown) as their own slice.
 */
export function savedTipLines(t: LifetimeStats): string[] {
  const lines = ['Net: what the requested model would have cost, minus what was paid.'];
  if (t.extra.events === 0) return lines;
  lines.push(`Gross saved <b>${usd2(t.savedCents + t.extra.cents)}</b>`);
  lines.push(`Extra cost <b class="negative">${usd2(t.extra.cents)}</b> &middot; ${t.extra.events} event${t.extra.events === 1 ? '' : 's'} on a model above the baseline`);
  if (t.extra.unknownEvents > 0) {
    lines.push(`${t.extra.unknownEvents} without requestedModel <b>${usd2(t.extra.unknownCents)}</b> &middot; baseline unknown`);
  }
  return lines;
}

/** `opusModel` is the effective `config.tiers.opus`; defaults to the compiled-in one. */
export function renderDashboard(history: RouteEvent[], lifetime?: LifetimeStats, filters: DashboardFilters = {}, opusModel: string = DEFAULT_MODELS.opus): string {
  const mode = filters.mode ?? 'all';
  const filtered = filterHistory(history, filters);
  const totals = emptyTotals();
  for (const e of filtered) foldOutcome(totals, e);

  const totalRequests = totals.requests;
  const totalCost = totals.costCents;
  const retried = totals.retried;
  // Every card is always rendered ("-" when there is nothing to count) so the
  // row keeps one shape across scopes and filters.
  const { turns, dispatched, nested } = totals.dispatch;
  const dispatchCard = statCard(
    'Dispatch Rate',
    turns > 0 ? `${((dispatched / turns) * 100).toFixed(0)}%` : '-',
    '',
    turns > 0 ? `${dispatched}/${turns}${nested > 0 ? ` &middot; <span class="negative">${nested} nested</span>` : ''}` : '',
    ['Share of coordinator turns that called the Agent tool.', `${dispatched} of ${turns} coordinator turns${nested > 0 ? `, ${nested} nested` : ''}`],
  );
  const allOpus = totals.tokens.input + totals.tokens.output > 0
    ? counterfactualCents(totals.tokens, opusModel, DEFAULT_PRICING)
    : 0;
  const counterfactualCard = statCard(
    'vs All-Opus',
    allOpus > 0 ? `$${(allOpus / 100).toFixed(4)}` : '-',
    allOpus > 0 ? 'orange' : '',
    allOpus > 0 ? 'upper bound' : '',
    [`Same tokens priced on ${esc(opusModel)}. An upper bound, not a measurement.`],
  );
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
  const unpricedNote = (models: Record<string, number>): { sub: string; tip: string[] } => {
    const entries = Object.entries(models);
    if (entries.length === 0) return { sub: '', tip: [] };
    const calls = entries.reduce((n, [, c]) => n + c, 0);
    const names = entries.map(([m]) => m).join(', ');
    return {
      sub: `<span class="warn">${calls} unpriced</span>`,
      tip: [`${calls} call${calls === 1 ? '' : 's'} unpriced: ${esc(names)}`],
    };
  };
  const savedCard = (label: string, t: LifetimeStats, digits: number | undefined, unpriced: { sub: string; tip: string[] }): string => {
    const d = savedCentsDisplay(t.savedCents, false, digits);
    const sub = [extraCostNote(t), unpriced.sub].filter(Boolean).join(' &middot; ');
    return statCard(label, d.text, d.tone === 'neutral' ? '' : d.tone, sub, [...savedTipLines(t), ...unpriced.tip]);
  };

  const recent = filtered.slice(-50).reverse();

  const modeOptions = DASHBOARD_MODES.map(
    (m) => `<option value="${m}"${m === mode ? ' selected' : ''}>${esc(MODE_LABEL[m])}</option>`,
  ).join('');

  // Option lists come from the full history, not a hardcoded list -
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

  // Session options need a readable label, not the raw id - resolved
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
  const pinOptions = simpleOptions(PIN_VALUES, true, 'No pin', filters.pin);
  const reasonValues = distinct(history, (e) => e.reason);
  const reasonOptions = simpleOptions(reasonValues.values, reasonValues.hasNone, 'No reason', filters.reason);

  const auto = filters.auto !== false;
  // Carries the active filters as query params so the refresh target keeps
  // them — otherwise auto-refresh resets every control to "All" every 10s.
  const refreshParams = new URLSearchParams();
  if (filters.mode && filters.mode !== 'all') refreshParams.set('mode', filters.mode);
  if (filters.role) refreshParams.set('role', filters.role);
  if (filters.model) refreshParams.set('model', filters.model);
  if (filters.tier) refreshParams.set('tier', filters.tier);
  if (filters.pin) refreshParams.set('pin', filters.pin);
  if (filters.reason) refreshParams.set('reason', filters.reason);
  if (filters.session) refreshParams.set('session', filters.session);
  if (filters.window && filters.window !== 'all') refreshParams.set('window', filters.window);
  if (filters.scope === 'all') refreshParams.set('scope', 'all');
  refreshParams.set('auto', '1');
  const refreshUrl = `/dashboard?${refreshParams.toString()}`;
  const metaRefresh = auto ? `<meta http-equiv="refresh" content="10;url=${refreshUrl}">` : '';

  const rows = recent
    .map(
      (e) => `
      <tr>
        <td>${esc(localStamp(e.timestamp))}</td>
        <td><span class="badge badge-${esc(String(e.tier))}">${esc(String(e.tier))}</span></td>
        <td>${esc(e.model)}</td>
        <td class="pin">${pinLabel(e)}</td>
        <td class="reason" title="${esc(reasonHelp(e.reason))}">${e.reason ? esc(e.reason) : '<span class="none">-</span>'}</td>
        <td class="role" title="${esc(roleHelp(e))}">${e.role ? esc(e.role) : e.coordinator ? 'coordinator' : '<span class="none">-</span>'}${e.dispatched ? ' <span class="badge badge-retry" title="This coordinator turn called the Agent tool.">dispatched</span>' : ''}</td>
        <td>${e.priced === false ? '<span class="unknown" title="no pricing for this model">—</span>' : `$${(e.costCents / 100).toFixed(4)}`}</td>
        <td class="${e.priced === false ? 'unknown' : e.savedCents >= 0 ? 'positive' : 'negative'}">${e.priced === false ? '—' : `$${(e.savedCents / 100).toFixed(4)}`}</td>
        <td title="${esc(confidenceHelp(e))}">${e.confidence.toFixed(2)}</td>
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
    th.help { cursor: help; text-decoration: underline dotted; text-underline-offset: 4px; }
    td[title] { cursor: help; }
    .mode-filter select {
      max-width: 22ch;
      text-overflow: ellipsis;
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

    /* One grid for every scope: cards never change height or count, so the row does not jump */
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 26px; }
    .stat-card { position: relative; min-width: 0; padding: 11px 14px 12px; }
    .stat-card .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .stat-card.has-tip .value { text-decoration: underline dotted; text-decoration-color: var(--ink-dim); text-underline-offset: 5px; cursor: help; }
    /* Hover or keyboard focus opens the explanation, same pattern as the cryo-dash schema tab */
    .tip-body {
      position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; display: none;
      width: max-content; max-width: 320px; padding: 8px 10px;
      font-family: var(--sans); font-size: 12px; line-height: 1.5; color: var(--ink);
      background: var(--void); border: 1px solid var(--edge); border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
    }
    .tip-body b { font-family: var(--mono); font-variant-numeric: tabular-nums; margin-left: 6px; }
    .stat-card:hover .tip-body, .stat-card:focus-within .tip-body, .stat-card:focus .tip-body { display: block; }
    .stat-card:hover { z-index: 21; }
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
    .warn { color: var(--gold); }
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
      <h1><a href="/dashboard" title="Reset all filters" style="color:inherit;text-decoration:none">claude-router dashboard</a></h1>
      <div class="tagline">routing ledger &middot; cost engine</div>
    </div>
    <div class="live"><span class="dot"></span>live &middot; refresh ${auto ? 'on' : 'off'}</div>
  </header>

  <form class="filter-bar card" method="GET" action="/dashboard">
    <div class="mode-filter">
      <label for="scope">Scope</label>
      <select id="scope" name="scope" onchange="this.form.submit()"><option value="session"${filters.scope === 'all' ? '' : ' selected'}>Session (since start)</option><option value="all"${filters.scope === 'all' ? ' selected' : ''}>All (last ${HISTORY_TAIL_LINES} from history)</option></select>
    </div>
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
      <label for="pin">Pin</label>
      <select id="pin" name="pin" onchange="this.form.submit()">${pinOptions}</select>
    </div>
    <div class="mode-filter">
      <label for="reason">Reason</label>
      <select id="reason" name="reason" onchange="this.form.submit()">${reasonOptions}</select>
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
      <input type="hidden" id="auto-state" name="auto" value="${auto ? '1' : '0'}">
      <label for="auto"><input type="checkbox" id="auto"${auto ? ' checked' : ''} onchange="document.getElementById('auto-state').value = this.checked ? '1' : '0'; this.form.submit()"> Auto-update</label>
    </div>
  </form>

  <div class="stats">
    ${statCard('Session Requests', String(totalRequests), 'blue', '', [])}
    ${statCard('Session Cost', `$${(totalCost / 100).toFixed(4)}`, 'orange', '', [])}
    ${savedCard('Session Saved', totals, 4, unpricedNote(totals.unpricedModels))}
    ${statCard('Auto-retried', String(retried), '', '', [])}
    ${dispatchCard}
    ${counterfactualCard}
    ${lifetime ? savedCard('Lifetime Saved', lifetime, undefined, unpricedNote(lifetime.unpricedModels)) : ''}
    ${lifetime ? statCard('Lifetime Requests', String(lifetime.requests), 'blue', '', []) : ''}
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
            <th title="${esc(HEADER_HELP.pin)}" class="help">Pin</th>
            <th title="${esc(HEADER_HELP.reason)}" class="help">Reason</th>
            <th title="${esc(HEADER_HELP.role)}" class="help">Role</th>
            <th>Cost</th>
            <th>Saved</th>
            <th title="${esc(HEADER_HELP.confidence)}" class="help">Confidence</th>
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
