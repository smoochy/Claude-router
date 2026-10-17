import { emptyTotals, foldOutcome } from '../totals.js';
import { DISPLAY_TIERS, DEFAULT_MODELS, DEFAULT_PRICING, counterfactualCents, type DisplayTier } from '../models.js';
import { savedCentsDisplay, usd } from './format.js';
import { lookupSessionTitle } from './session-names.js';
import type { RouteEvent } from './route-event.js';
import { HISTORY_TAIL_LINES, type LifetimeStats } from './history.js';

/** Sentinel option value for "events with no value on this field" - its own
 * slice rather than silently excluded, the precedent set for routingMode. */
const NONE = '__none__';
/** Tier-filter value that keeps every tier except passthrough - the only exclusion the tier control offers. */
export const HIDE_PASSTHROUGH = '__not_passthrough__';

/** Typed Record<DisplayTier, ...>: a new tier fails the build until it has a name and a help text. */
const TIER_NAME: Record<DisplayTier, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
  fable: 'Fable',
  passthrough: 'Pass',
};

const TIER_HELP: Record<DisplayTier, string> = {
  haiku: 'Cheapest tier. Recon subagents, short mechanical transforms and trivial agentic turns land here.',
  sonnet: 'Default tier. Builders, batch work and any request with no stronger signal.',
  opus: 'Deep reasoning. Gate and audit roles, and prompts that asked for depth.',
  fable: 'Top tier. Prompts asking for depth over a long horizon.',
  passthrough: 'The client model went through untouched, only logged: routing was off, or routing.passthroughHaiku kept a haiku request on haiku.',
};

/** Meaning and origin of each role (see src/roles.ts); unknown names fall back to a custom-role text. */
const ROLE_HELP: Record<string, { what: string; how: string }> = {
  'no role': { what: 'Ordinary requests outside any subagent or coordinator turn, such as plain single prompts.', how: 'No agent id and no role marker in the request.' },
  coordinator: { what: 'The main Claude Code session that can hand work to subagents.', how: 'Not a subagent: a request with tools but no agent id.' },
  recon: { what: 'Read-only reconnaissance: find things, report facts. Pinned to haiku.', how: 'Marker "claude-router:role=recon", the agent type, or read-only tools.' },
  builder: { what: 'Scoped implementation that needs local judgement. Sonnet.', how: 'Marker "claude-router:role=builder", the agent type, or a subagent with write tools.' },
  batch: { what: 'Same-shape edits across many files, fully specified. Sonnet.', how: 'Marker "claude-router:role=batch" at the start of the agent prompt.' },
  gate: { what: 'Fresh-context readiness check before risky work is approved. Opus.', how: 'Marker "claude-router:role=gate" at the start of the agent prompt.' },
  audit: { what: 'Fresh-context falsification after risky work lands. Opus.', how: 'Marker "claude-router:role=audit" at the start of the agent prompt.' },
};

const NO_ROLE = 'no role';
/** Dim ink for percentages and the passthrough tier name; both are AA (>= 4.5:1) on the card and on the #0b0f19 popover (pinned in the tests). */
export const DIM_INK = '#a9b3c6';
export const PASSTHROUGH_INK = '#8b95a7';
const pct1 = (n: number, d: number): string => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '-');

/**
 * One shared fixed-position popover for every [data-tip] target. The feed sits in
 * `.table-wrap { overflow-x: auto }`, which clips any absolutely positioned
 * popover, so these use the fixed variant, clamped to the viewport and flipped
 * above the target when it would leave the bottom.
 */
const DATA_TIP_SCRIPT = `<script>(function(){var t=document.createElement('div');t.className='tip-body';t.setAttribute('role','tooltip');t.style.cssText='position:fixed;z-index:100;pointer-events:none';document.body.appendChild(t);
function show(el){t.textContent=el.getAttribute('data-tip');t.style.display='block';var r=el.getBoundingClientRect(),w=t.offsetWidth,h=t.offsetHeight,x=Math.min(Math.max(8,r.left),innerWidth-w-8),y=r.bottom+6;if(y+h>innerHeight-8)y=Math.max(8,r.top-h-6);t.style.left=x+'px';t.style.top=y+'px'}
function hide(){t.style.display='none'}
document.addEventListener('mouseover',function(e){var el=e.target.closest&&e.target.closest('[data-tip]');el?show(el):hide()});
document.addEventListener('focusin',function(e){var el=e.target.closest&&e.target.closest('[data-tip]');el?show(el):hide()});
document.addEventListener('scroll',hide,true)})()</script>`;

interface Share { name: string; cls: string; n: number; c: number }

/**
 * Per-tier and per-role breakdown of one view. Tier cost is summed here from the
 * events (errors excluded, as foldOutcome does) rather than kept in RouteTotals.
 * "no role" is the remainder, so both rows add up to Session Requests / Cost.
 */
function breakdown(totals: ReturnType<typeof emptyTotals>, events: RouteEvent[]): { tiers: Share[]; roles: Share[] } {
  const tierCost: Record<string, number> = {};
  for (const e of events) if (!e.error) tierCost[e.tier] = (tierCost[e.tier] ?? 0) + e.costCents;
  const tiers = DISPLAY_TIERS.map((t) => ({ name: TIER_NAME[t], cls: t, n: totals.tiers[t] ?? 0, c: tierCost[t] ?? 0 }))
    .filter((x) => x.cls !== 'passthrough' || x.n > 0);
  const roles = Object.entries(totals.byRole)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, r]) => ({ name, cls: '', n: r.requests, c: r.costCents }));
  const rest = { name: NO_ROLE, cls: '', n: totals.requests - roles.reduce((a, r) => a + r.n, 0), c: totals.costCents - roles.reduce((a, r) => a + r.c, 0) };
  if (rest.n > 0) roles.push(rest);
  return { tiers, roles };
}

function roleTip(name: string): string[] {
  const h = ROLE_HELP[name] ?? { what: `Custom role "${name}".`, how: 'Named by a prompt marker or agent type.' };
  return [`${esc(name)}: ${esc(h.what)}`, `Comes from: ${esc(h.how)}`];
}

/** One entry of the Tier / Role rows: `name n (p%) $cost (p%)` with a hover popover. */
function entry(x: Share, dot: boolean, totals: ReturnType<typeof emptyTotals>, help: string[]): string {
  return `<span class="ent has-tip" tabindex="0">${dot ? `<span class="dot t-${x.cls}"></span>` : ''}<b class="${dot ? '' : 'mono'}">${esc(x.name)}</b> ${x.n} <i>(${pct1(x.n, totals.requests)})</i> <u>${usd(x.c)}</u> <i>(${pct1(x.c, totals.costCents)})</i><span class="tip-body" role="tooltip">${help.map((l) => `<div>${l}</div>`).join('')}</span></span>`;
}

/** Hover lines for Session Requests / Session Cost: what is counted, then the composition by tier and by role. */
function sessionTips(b: { tiers: Share[]; roles: Share[] }, totals: ReturnType<typeof emptyTotals>): { requests: string[]; cost: string[] } {
  const list = (xs: Share[], f: (x: Share) => string): string =>
    xs.filter((x) => x.n > 0).map((x) => `<b class="tn${x.cls ? ` tt-${x.cls}` : ''}">${esc(x.name)}</b> ${f(x)}`).join(' &middot; ');
  const rq = (x: Share): string => `${x.n} <i>(${pct1(x.n, totals.requests)})</i>`;
  const co = (x: Share): string => `${usd(x.c)} <i>(${pct1(x.c, totals.costCents)})</i>`;
  return {
    requests: ['Routed requests in the current view; failed streams are not counted.', `By tier: ${list(b.tiers, rq)}`, `By role: ${list(b.roles, rq)}`],
    cost: ['What these requests cost on the billed models at list price, in dollars.', `By tier: ${list(b.tiers, co)}`, `By role: ${list(b.roles, co)}`],
  };
}

/**
 * Derived per-event label, not a filter: compares the pilotfish
 * pin against the billed model rather than reading a stored verdict. Absent
 * `requestedModel` means either no pin was sent or the line predates the
 * field — both render as "-", never as a wrong label.
 */
function pinLabel(e: RouteEvent): string {
  if (!e.requestedModel) return '<span class="none" data-tip="No pin: the client sent no model, or this line predates the field.">-</span>';
  return e.requestedModel === e.model
    ? `<span class="badge badge-pin-honored" data-tip="Pin honored: the client asked for ${esc(e.requestedModel)} and that is the model that was billed.">pin honored</span>`
    : `<span class="badge badge-pin-overridden" data-tip="Overridden: the client asked for ${esc(e.requestedModel)} but the router billed ${esc(e.model)}.">overridden</span>`;
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
    ['passthrough:explicit-model', 'The client named a model and it was forwarded untouched (routing off, or routing.passthroughHaiku for a haiku request): only logged, saving 0.'],
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

/** Hover/focus explanation for each filter label. */
const FILTER_HELP = {
  mode: 'Which routing mode the requests ran under: all, routed (the router chose the model) or passthrough (routing off, request logged as sent).',
  scope: 'Session counts requests since this router started; All reads the tail of the history file, across restarts.',
  window: 'Only requests inside this time window: all time, today, or the last hour.',
  session: 'Only requests from one Claude Code session. The label is the session title when known, else its start time, length and request count.',
  tier: 'The model class the router picked: haiku, sonnet, opus or fable, or pass for a request forwarded untouched. Hide passthrough keeps every tier except pass.',
  model: 'The exact model id that was billed for the request.',
  pin: 'Whether the model the client asked for (pilotfish pin) is the one that was billed: honored or overridden. No pin means the client sent no model.',
  reason: 'The routing rule that picked the tier, such as agentic:default or role:recon.',
  retry: 'Requests the router re-sent to a stronger model after a truncated or refused answer, by retry reason. No retry means answered first time.',
  role: 'The agent role of the request, such as recon or builder, or coordinator for a coordinator turn.',
} as const;

/** Plain-language meaning of the retry cell. */
function retryHelp(e: RouteEvent): string {
  if (!e.retried) return 'Not retried: the first answer was used.';
  if (e.retryReason === 'truncation') return 'Retried after truncation: the answer hit the output limit, so the router asked again on a stronger model.';
  if (e.retryReason === 'refusal') return 'Retried after a refusal: the cheaper model declined, so the router asked again on a stronger model.';
  return `Auto-retried${e.retryReason ? ` (${e.retryReason})` : ''} on a stronger model.`;
}

const REQUESTED_MODEL_HELP = 'Requested model: the model field Claude Code sent in the request body, before the router chose a tier. Older log lines have none.';

const HEADER_HELP = {
  saved: 'Net saving: what the requested model would have cost, minus what was paid. Negative when the served model was priced above the requested one; a dash when unpriced or no model was requested.',
  retry: 'Whether the router re-sent the request to a stronger model after a truncated or refused answer.',
  pin: 'Whether the requested model (the model field the client sent, e.g. a pilotfish pin) is the one that was billed: honored or overridden.',
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
  /** The retry reason (`truncation` | `refusal` | ...) of an auto-retried request, or NONE (not retried). */
  retry?: string;
  session?: string;
  window?: TimeWindow;
  /** Refresh interval in seconds; 0 = off. Default 10. */
  auto?: number;
  /** `session` (default): events since this router started. `all`: tail of history.jsonl. */
  scope?: DashboardScope;
}

export const REFRESH_INTERVALS = [0, 10, 20, 30, 45, 60] as const;

/** `auto` query values: seconds from the menu, legacy `1` = 10s, legacy `0` = off; anything else falls back to 10s. */
export function parseRefresh(raw: string | undefined): number {
  if (raw === undefined || raw === '1') return 10;
  const n = Number(raw);
  return raw !== '' && (REFRESH_INTERVALS as readonly number[]).includes(n) ? n : 10;
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

/** Filterable form of the retry cell: the retry reason, `retried` when none was recorded, absent when not retried. */
function retryState(e: RouteEvent): string | undefined {
  return e.retried ? e.retryReason || 'retried' : undefined;
}

/** True when any control narrows the event set; scope only picks the source, so it is not a filter. */
export function hasActiveFilter(f: DashboardFilters): boolean {
  return Boolean((f.mode && f.mode !== 'all') || f.role || f.model || f.tier || f.pin || f.reason || f.retry || f.session || (f.window && f.window !== 'all'));
}

/** Applies every active control as one AND, recomputed from the full history — exported for the filter/recomputation tests. */
export function filterHistory(history: RouteEvent[], filters: DashboardFilters): RouteEvent[] {
  let out = filterByMode(history, filters.mode ?? 'all');
  if (filters.role) out = out.filter((e) => (filters.role === NONE ? roleLabel(e) === undefined : roleLabel(e) === filters.role));
  if (filters.model) out = out.filter((e) => e.model === filters.model);
  if (filters.tier === HIDE_PASSTHROUGH) out = out.filter((e) => e.tier !== 'passthrough');
  else if (filters.tier) out = out.filter((e) => String(e.tier) === filters.tier);
  if (filters.pin) out = out.filter((e) => (filters.pin === NONE ? pinState(e) === undefined : pinState(e) === filters.pin));
  if (filters.reason) out = out.filter((e) => (filters.reason === NONE ? e.reason === undefined : e.reason === filters.reason));
  if (filters.retry) out = out.filter((e) => (filters.retry === NONE ? retryState(e) === undefined : retryState(e) === filters.retry));
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
function statCard(label: string, value: string, valueClass: string, sub: string, tipLines: string[], dim = false): string {
  const tip = tipLines.length > 0
    ? `<div class="tip-body" role="tooltip">${tipLines.map((l) => `<div>${l}</div>`).join('')}</div>`
    : '';
  return `<div class="stat-card card${tip ? ' has-tip' : ''}${dim ? ' dim' : ''}"${tip ? ' tabindex="0"' : ''}>
      <div class="label">${label}</div>
      <div class="value${valueClass ? ` ${valueClass}` : ''}">${value}</div>
      <div class="sub">${sub || '&nbsp;'}</div>
      ${tip}
    </div>`;
}


/**
 * Short marker under a net saved figure that has a negative side; empty when
 * nothing was extra, so a plain positive figure stays unadorned.
 */
export function extraCostNote(t: LifetimeStats): string {
  if (t.extra.events === 0) return '';
  return `<span class="negative">${usd(t.extra.cents)} extra cost</span>`;
}

/**
 * Popover lines for a net saved figure: gross saved vs the extra cost of
 * events served on a model priced above the baseline, with the pre-#4264
 * events (no requestedModel, baseline unknown) as their own slice.
 */
export function savedTipLines(t: LifetimeStats): string[] {
  const lines = ['Net: what the requested model would have cost, minus what was paid.', REQUESTED_MODEL_HELP];
  if (t.extra.events === 0) return lines;
  lines.push(`Gross saved <b>${usd(t.savedCents + t.extra.cents)}</b>`);
  lines.push(`Extra cost <b class="negative">${usd(t.extra.cents)}</b> &middot; ${t.extra.events} event${t.extra.events === 1 ? '' : 's'} on a model above the baseline`);
  if (t.extra.unknownEvents > 0) {
    lines.push(`${t.extra.unknownEvents} without requestedModel <b>${usd(t.extra.unknownCents)}</b> &middot; baseline unknown`);
  }
  return lines;
}

/** `opusModel` is the effective `config.tiers.opus`; defaults to the compiled-in one. */
export function renderDashboard(history: RouteEvent[], lifetime?: LifetimeStats, filters: DashboardFilters = {}, opusModel: string = DEFAULT_MODELS.opus, version?: string): string {
  const mode = filters.mode ?? 'all';
  const filtered = filterHistory(history, filters);
  const totals = emptyTotals();
  for (const e of filtered) foldOutcome(totals, e);

  const totalRequests = totals.requests;
  const totalCost = totals.costCents;
  const retried = totals.retried;
  // Labels say what the figure covers: the in-memory session, or the ledger tail under scope=all; "(filtered)" when a control narrows it.
  const flt = hasActiveFilter(filters);
  const cardLabel = (name: string): string => `${filters.scope === 'all' ? 'History' : 'Session'} ${name}${flt ? ' (filtered)' : ''}`;
  // Lifetime comes from the whole ledger as a running sum, not events, so no filter can apply to it: dim it and say why.
  const lifetimeTip = flt ? ['Not filtered: the lifetime total is summed over the whole ledger, so the active filters do not apply to this figure.'] : [];
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
    allOpus > 0 ? usd(allOpus) : '-',
    allOpus > 0 ? 'orange' : '',
    allOpus > 0 ? 'upper bound' : '',
    [`Same tokens priced on ${esc(opusModel)}. An upper bound, not a measurement.`],
  );
  // DISPLAY_TIERS, not a hand-written list: the list here used to omit `fable`,
  // which hid fable routes from the section. Roles come from totals.byRole, so a
  // new role shows up on its own.
  const split = breakdown(totals, filtered);
  const tierEntries = split.tiers.map((x) => entry(x, true, totals, [esc(TIER_HELP[x.cls as DisplayTier])])).join('');
  const roleEntries = split.roles.map((x) => entry(x, false, totals, roleTip(x.name))).join('');
  const sessionTipLines = sessionTips(split, totals);

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
  const savedCard = (label: string, t: LifetimeStats, digits: number | undefined, unpriced: { sub: string; tip: string[] }, extraTip: string[] = []): string => {
    const d = savedCentsDisplay(t.savedCents, false, digits);
    const sub = [extraCostNote(t), unpriced.sub].filter(Boolean).join(' &middot; ');
    return statCard(label, d.text, d.tone === 'neutral' ? '' : d.tone, sub, [...extraTip, ...savedTipLines(t), ...unpriced.tip], extraTip.length > 0);
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
  const tierOptions = simpleOptions(tierValues.values, false, '', filters.tier).replace(
    '</option>',
    `</option><option value="${HIDE_PASSTHROUGH}"${filters.tier === HIDE_PASSTHROUGH ? ' selected' : ''}>Hide passthrough</option>`,
  );
  const pinOptions = simpleOptions(PIN_VALUES, true, 'No pin', filters.pin);
  const reasonValues = distinct(history, (e) => e.reason);
  const reasonOptions = simpleOptions(reasonValues.values, reasonValues.hasNone, 'No reason', filters.reason);

  const retryValues = distinct(history, retryState);
  const retryOptions = simpleOptions(retryValues.values, retryValues.hasNone, 'No retry', filters.retry);

  const scopeOptions = `<option value="session"${filters.scope === 'all' ? '' : ' selected'}>Session (since start)</option><option value="all"${filters.scope === 'all' ? ' selected' : ''}>All (last ${HISTORY_TAIL_LINES} from history)</option>`;
  const filterFields = ([
    ['mode', 'Mode', FILTER_HELP.mode, modeOptions],
    ['scope', 'Scope', FILTER_HELP.scope, scopeOptions],
    ['window', 'Window', FILTER_HELP.window, windowOptions],
    ['session', 'Session', FILTER_HELP.session, sessionOptions],
    ['tier', 'Tier', FILTER_HELP.tier, tierOptions],
    ['model', 'Model', FILTER_HELP.model, modelOptions],
    ['pin', 'Pin', FILTER_HELP.pin, pinOptions],
    ['reason', 'Reason', FILTER_HELP.reason, reasonOptions],
    ['retry', 'Retry', FILTER_HELP.retry, retryOptions],
    ['role', 'Role', FILTER_HELP.role, roleOptions],
  ] as const)
    .map(([id, label, help, options]) => `<div class="mode-filter">
      <label for="${id}" class="has-tip" tabindex="0">${label}<span class="tip-body" role="tooltip">${esc(help)}</span></label>
      <select id="${id}" name="${id}" onmouseenter="this.title = this.selectedOptions[0].text" onchange="this.form.submit()">${options}</select>
    </div>`)
    .join('\n    ');

  const interval = filters.auto ?? 10;
  const auto = interval > 0;
  // Carries the active filters as query params so the refresh target keeps
  // them — otherwise auto-refresh resets every control to "All" every 10s.
  const refreshParams = new URLSearchParams();
  if (filters.mode && filters.mode !== 'all') refreshParams.set('mode', filters.mode);
  if (filters.role) refreshParams.set('role', filters.role);
  if (filters.model) refreshParams.set('model', filters.model);
  if (filters.tier) refreshParams.set('tier', filters.tier);
  if (filters.pin) refreshParams.set('pin', filters.pin);
  if (filters.reason) refreshParams.set('reason', filters.reason);
  if (filters.retry) refreshParams.set('retry', filters.retry);
  if (filters.session) refreshParams.set('session', filters.session);
  if (filters.window && filters.window !== 'all') refreshParams.set('window', filters.window);
  if (filters.scope === 'all') refreshParams.set('scope', 'all');
  refreshParams.set('auto', String(interval));
  const refreshUrl = `/dashboard?${refreshParams.toString()}`;
  // Clears every filter and the scope, keeps only the refresh interval.
  const resetUrl = `/dashboard?auto=${interval}`;
  // The one inline script (allowlisted in the tests): reload after the interval, but wait while a tooltip is hovered or focused,
  // or while a select popup is open with the pointer on it. A native popup swallows mouse events, so "pointer inside" is the
  // last pointer position seen: on the open select (or its popup) keeps the pause, elsewhere on the page lifts it and the reload
  // closes the dropdown. A click, change, blur or Escape ends "open". Mouse-opened popups only; a keyboard-opened one does not pause.
  const refreshScript = auto
    ? `<script>var o,i,d=document,k='dashY';try{scrollTo(0,+sessionStorage.getItem(k)||0)}catch(e){}var s=function(e){return e.target.closest&&e.target.closest('select')};d.addEventListener('mousedown',function(e){var x=s(e);o=x&&x!==o?x:null;i=1});d.addEventListener('mousemove',function(e){i=s(e)===o});d.addEventListener('change',function(){o=null});d.addEventListener('focusout',function(e){if(e.target===o)o=null});d.addEventListener('keydown',function(e){if(e.key==='Escape')o=null});setTimeout(function t(){if(d.querySelector('.has-tip:hover,.has-tip:focus-within,[data-tip]:hover')||o&&i)setTimeout(t,500);else{try{sessionStorage.setItem(k,scrollY)}catch(e){}location.href=${JSON.stringify(refreshUrl)}}},${interval * 1000})</script>`
    : '';

  const rows = recent
    .map(
      (e) => `
      <tr>
        <td>${esc(localStamp(e.timestamp))}</td>
        <td><span class="badge badge-${esc(String(e.tier))}">${esc(String(e.tier))}</span></td>
        <td>${esc(e.model)}</td>
        <td class="pin">${pinLabel(e)}</td>
        <td class="reason" data-tip="${esc(reasonHelp(e.reason))}">${e.reason ? esc(e.reason) : '<span class="none">-</span>'}</td>
        <td class="role" data-tip="${esc(roleHelp(e))}">${e.role ? esc(e.role) : e.coordinator ? 'coordinator' : '<span class="none">-</span>'}${e.dispatched ? ' <span class="badge badge-retry" data-tip="This coordinator turn called the Agent tool.">dispatched</span>' : ''}</td>
        <td>${e.priced === false ? '<span class="unknown" data-tip="no pricing for this model">—</span>' : usd(e.costCents)}</td>
        <td class="${e.priced === false ? 'unknown' : e.savedCents >= 0 ? 'positive' : 'negative'}">${e.priced === false ? '—' : usd(e.savedCents)}</td>
        <td data-tip="${esc(confidenceHelp(e))}">${e.confidence.toFixed(2)}</td>
        <td>${e.inputTokens}</td>
        <td>${e.outputTokens}</td>
        <td data-tip="${esc(retryHelp(e))}">${e.retried ? `<span class="badge badge-retry">${esc(e.retryReason ?? '')}</span>` : '<span class="none">-</span>'}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>claude-router dashboard</title>
  <style>
    :root {
      --void: #05070f;
      --orange: #2f74f9;
      --gold: #52a8ff;
      --green: #0ecb81;
      --red: #f6465d;
      --violet: #b47cff;
      --t-haiku: #2ee6a8;
      --t-sonnet: #22d3ee;
      --t-opus: #4f8bff;
      --t-fable: #a78bfa;
      --steel: #9fb0c8;
      --ink: #f4f7fb;
      --ink-dim: #7e8fac;
      --glass: rgba(255, 255, 255, 0.03);
      --glass-2: rgba(255, 255, 255, 0.015);
      --edge: rgba(47, 116, 249, 0.16);
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
        radial-gradient(ellipse 70% 45% at 22% -8%, rgba(47, 116, 249, 0.09), transparent 65%),
        radial-gradient(ellipse 55% 40% at 85% 4%, rgba(82, 168, 255, 0.05), transparent 60%),
        linear-gradient(rgba(47, 116, 249, 0.024) 1px, transparent 1px),
        linear-gradient(90deg, rgba(47, 116, 249, 0.024) 1px, transparent 1px);
      background-size: auto, auto, 44px 44px, 44px 44px;
      padding: 30px clamp(16px, 4vw, 52px) 44px;
      max-width: 1680px;
      margin: 0 auto;
      min-height: 100vh;
    }
    ::selection { background: rgba(47, 116, 249, 0.85); color: var(--void); }

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
      box-shadow: 0 0 12px rgba(47, 116, 249, 0.55);
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
    .live select { font-family: var(--mono); font-size: 11px; letter-spacing: normal; text-transform: none; color: var(--ink); background: var(--void); border: 1px solid var(--edge-soft); border-radius: 6px; padding: 3px 6px; cursor: pointer; }
    header > div:first-child { margin-right: auto; }
    header .gh { order: 1; }
    header .live { order: 2; }
    .live.paused .dot { background: var(--red); box-shadow: 0 0 10px rgba(246, 70, 93, 0.9); animation: none; }
    .live .dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 10px rgba(14, 203, 129, 0.9);
      animation: pulse 2.4s ease-in-out infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

    .filter-bar {
      display: flex; align-items: center; gap: 12px; flex-wrap: nowrap;
      padding: 10px 16px; margin-bottom: 18px;
    }
    .filter-bar .mode-filter:not(.auto-toggle) { flex: 1 1 0; min-width: 0; }
    .filter-bar .mode-filter label { flex: none; }
    .reset-btn {
      flex: none; white-space: nowrap;
      font-family: var(--mono); font-size: 11px; color: var(--ink);
      text-decoration: none; padding: 5px 12px;
      border: 1px solid var(--edge); border-radius: 6px; background: var(--glass);
    }
    .reset-btn:hover { border-color: var(--orange); color: var(--gold); }
    .auto-toggle label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .mode-filter { display: flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 11px; color: var(--ink-dim); }
    th.help { cursor: help; text-decoration: underline dotted; text-underline-offset: 4px; }
    td[title] { cursor: help; }
    .mode-filter select {
      flex: 1 1 0;
      min-width: 0;
      width: 100%;
      text-overflow: ellipsis;
      background: var(--void);
      color: var(--ink);
      border: 1px solid var(--edge-soft);
      border-radius: 6px;
      padding: 5px 8px;
      font-family: var(--mono);
      font-size: 11px;
    }
    select { color-scheme: dark; }
    .live select option,
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
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 12px 34px rgba(0, 0, 0, 0.5), 0 0 28px rgba(47, 116, 249, 0.12);
    }

    /* One grid for every scope: cards never change height or count, so the row does not jump */
    /* Cost group left, thin gradient divider, requests group right; stacks with a horizontal divider when narrow */
    .stats { display: flex; align-items: stretch; gap: 14px; margin-bottom: 26px; }
    .stat-group { flex: 1 1 0; min-width: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 10px; }
    .stat-divider { flex: none; width: 1px; background: linear-gradient(to bottom, transparent, var(--edge), transparent); }
    @media (max-width: 900px) {
      .stats { flex-direction: column; }
      .stat-group { grid-auto-flow: row; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
      .stat-divider { width: auto; height: 1px; background: linear-gradient(to right, transparent, var(--edge), transparent); }
    }
    .stat-card { position: relative; min-width: 0; padding: 11px 14px 12px; }
    .stat-card.dim .value, .stat-card.dim .sub { opacity: 0.22; }
    .stat-card .sub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .stat-card.has-tip .value { text-decoration: underline dotted; text-decoration-color: var(--ink-dim); text-underline-offset: 5px; cursor: help; }
    /* Hover or keyboard focus opens the explanation, same pattern as the cryo-dash schema tab */
    .tip-body {
      position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; display: none;
      width: max-content; max-width: 300px; padding: 8px 10px;
      font-family: var(--sans); font-size: 12px; line-height: 1.5; color: var(--ink);
      background: #0b0f19; border: 1px solid #3a4560; border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.67); white-space: normal; text-align: left; font-weight: 400;
    }
    .tip-body > div + div { margin-top: 4px; }
    .tip-body b { font-family: var(--mono); font-variant-numeric: tabular-nums; margin-left: 6px; }
    .stat-card:hover .tip-body, .stat-card:focus-within .tip-body, .stat-card:focus .tip-body { display: block; }
    /* Filter labels: same popover; the bar stacks above the cards below it, and the right-hand labels open leftwards */
    .filter-bar { z-index: 22; }
    .filter-bar label.has-tip { position: relative; cursor: help; text-decoration: underline dotted; text-underline-offset: 4px; }
    .filter-bar label.has-tip:hover .tip-body, .filter-bar label.has-tip:focus .tip-body { display: block; }
    .filter-bar .mode-filter:nth-last-child(-n+4) .tip-body { left: auto; right: 0; }
    .filter-bar .tip-body { text-transform: none; letter-spacing: normal; text-decoration: none; white-space: normal; width: 260px; }
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
    .stat-card .value.blue   { color: var(--orange); text-shadow: 0 0 18px rgba(47, 116, 249, 0.4); }
    .stat-card .value.orange { color: var(--gold);   text-shadow: 0 0 18px rgba(82, 168, 255, 0.35); }
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

    /* Tier / Role rows: one wrapping flex row per card. The hovered card stacks above the next one so its popovers are not overdrawn. */
    .ents { display: flex; flex-wrap: wrap; justify-content: flex-start; gap: 6px 18px; margin-bottom: 26px; padding: 10px 14px; font-size: 12px; font-variant-numeric: tabular-nums; }
    .ents:hover, .ents:focus-within { z-index: 40; }
    .ent { position: relative; white-space: nowrap; cursor: help; }
    .ent b { font-weight: 600; }
    .ent b.mono { font-family: var(--mono); }
    .ent i, .tip-body i { font-style: normal; color: ${DIM_INK}; }
    .ent u { text-decoration: none; }
    .ent .dot { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; }
    .ent:hover .tip-body, .ent:focus .tip-body { display: block; }
    .ent:nth-last-child(-n+3) .tip-body { left: auto; right: 0; }
    .t-haiku { background: var(--t-haiku); } .t-sonnet { background: var(--t-sonnet); } .t-opus { background: var(--t-opus); } .t-fable { background: var(--t-fable); } .t-passthrough { background: #55607a; }
    .tip-body b.tn { font-family: inherit; font-weight: 600; margin-left: 0; }
    .tt-haiku { color: var(--t-haiku); } .tt-sonnet { color: var(--t-sonnet); } .tt-opus { color: var(--t-opus); } .tt-fable { color: var(--t-fable); } .tt-passthrough { color: ${PASSTHROUGH_INK}; }
    [data-tip] { cursor: help; }
    td[data-tip]:not(.none) { text-decoration: underline dotted ${PASSTHROUGH_INK}; text-underline-offset: 4px; }

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
    tbody tr:hover td { background: rgba(47, 116, 249, 0.045); }
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
    .badge-haiku       { background: rgba(46, 230, 168, 0.1);  color: var(--t-haiku);  border-color: rgba(46, 230, 168, 0.4); }
    .badge-sonnet      { background: rgba(34, 211, 238, 0.1);  color: var(--t-sonnet); border-color: rgba(34, 211, 238, 0.4); }
    .badge-opus        { background: rgba(79, 139, 255, 0.1);  color: var(--t-opus);   border-color: rgba(79, 139, 255, 0.4); }
    .badge-fable       { background: rgba(167, 139, 250, 0.1); color: var(--t-fable);  border-color: rgba(167, 139, 250, 0.4); }
    .badge-passthrough { background: rgba(159, 176, 200, 0.1); color: var(--steel);  border-color: rgba(159, 176, 200, 0.35); }
    td.reason          { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--steel); }
    td.role            { font-size: 12px; }
    .stat-card .sub    { font-size: 11px; color: var(--steel); margin-top: 4px; }
    .badge-retry       { background: rgba(246, 70, 93, 0.1);   color: var(--red);    border-color: rgba(246, 70, 93, 0.4); }
    .badge-pin-honored    { background: rgba(14, 203, 129, 0.1); color: var(--green); border-color: rgba(14, 203, 129, 0.35); }
    .badge-pin-overridden { background: rgba(82, 168, 255, 0.1); color: var(--gold);  border-color: rgba(82, 168, 255, 0.4); }
    td.pin             { font-size: 12px; }
    .none { color: var(--ink-dim); }
    .unknown { color: var(--gold); }
    .warn { color: var(--gold); }
    .warn::before { content: '\\26A0 '; }
    .positive { color: var(--green); }
    .negative { color: var(--red); text-shadow: 0 0 12px rgba(246, 70, 93, 0.35); }
    .empty { text-align: center; padding: 30px; color: var(--ink-dim); font-family: var(--sans); font-size: 13px; }
    .gh { color: var(--ink-dim); display: flex; }
    .gh:hover { color: var(--gold); }
    .footer a { color: inherit; }
    .footer .version { opacity: 0.7; }
    .footer > span + span { border-left: 1px solid var(--ink-dim); padding-left: 10px; }
    .footer {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 10px;
      overflow-wrap: anywhere;
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
      <h1><a href="/dashboard" style="color:inherit;text-decoration:none">claude-router dashboard</a></h1>
      <div class="tagline">routing ledger &middot; cost engine</div>
    </div>
    <div class="live${auto ? '' : ' paused'}"><span class="dot"></span>live &middot; refresh <select name="auto" form="filter-form" aria-label="Refresh interval" onchange="this.form.submit()">${REFRESH_INTERVALS.map((s) => `<option value="${s}"${s === interval ? ' selected' : ''}>${s === 0 ? 'off' : `${s}s`}</option>`).join('')}</select></div>
    <a class="gh" href="https://github.com/smoochy/Claude-router" aria-label="GitHub repository"><svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg></a>
  </header>

  <form id="filter-form" class="filter-bar card" method="GET" action="/dashboard">
    ${filterFields}
    <a class="reset-btn" href="${esc(resetUrl)}">Reset filters</a>
  </form>

  <div class="stats">
    <div class="stat-group" data-group="cost">
      ${statCard(cardLabel('Cost'), usd(totalCost), 'orange', '', sessionTipLines.cost)}
      ${savedCard(cardLabel('Saved'), totals, 4, unpricedNote(totals.unpricedModels))}
      ${counterfactualCard}
      ${lifetime ? savedCard('Lifetime Saved', lifetime, undefined, unpricedNote(lifetime.unpricedModels), lifetimeTip) : ''}
    </div>
    <div class="stat-divider" role="separator" aria-orientation="vertical"></div>
    <div class="stat-group" data-group="requests">
      ${statCard(cardLabel('Requests'), String(totalRequests), 'blue', '', sessionTipLines.requests)}
      ${lifetime ? statCard('Lifetime Requests', String(lifetime.requests), 'blue', '', lifetimeTip, flt) : ''}
      ${dispatchCard}
      ${statCard('Auto-retried', String(retried), '', '', ['Requests the router re-sent to a stronger model after a truncated or refused answer.', `${retried} of ${totalRequests} requests in the current view.`])}
    </div>
  </div>

  ${roleEntries ? `<div class="section-label">By Role</div>
  <div class="card ents">${roleEntries}</div>` : ''}

  <div class="section-label">Tier Distribution</div>
  <div class="card ents">${tierEntries}</div>

  <div class="section-label">Route Feed</div>
  <div class="table-shell card">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Tier</th>
            <th>Model</th>
            <th data-tip="${esc(HEADER_HELP.pin)}" class="help">Pin</th>
            <th data-tip="${esc(HEADER_HELP.reason)}" class="help">Reason</th>
            <th data-tip="${esc(HEADER_HELP.role)}" class="help">Role</th>
            <th>Cost</th>
            <th data-tip="${esc(`${HEADER_HELP.saved} ${REQUESTED_MODEL_HELP}`)}" class="help">Saved</th>
            <th data-tip="${esc(HEADER_HELP.confidence)}" class="help">Confidence</th>
            <th>In Tokens</th>
            <th>Out Tokens</th>
            <th data-tip="${esc(HEADER_HELP.retry)}" class="help">Retry</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="11" class="empty">No requests yet. Send requests to the proxy to see data here.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <div class="footer"><span>${auto ? `Auto-refreshes every ${interval} seconds` : 'Auto-refresh is off'}.</span><span>Showing last ${Math.min(50, filtered.length)} of ${filtered.length} requests.</span>${version ? `<span class="version">v${esc(version)}</span>` : ''}<span>Theme: Neon glass &middot; palette from <a href="https://github.com/RayVelez27/instalanding.ai/tree/main/pages/neon-glass-app-landing-page">instalanding.ai/neon-glass-app-landing-page</a> (MIT, Ray Velez)</span></div>
  ${refreshScript}
  ${DATA_TIP_SCRIPT}
</body>
</html>`;
}
