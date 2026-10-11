// PROTOTYPE (homelab-private #4399) - throwaway, wipe me. Three structurally different
// takes on Tier Distribution + By Role as absolute numbers and percent, switchable via ?variant=a|b|c.
import { DISPLAY_TIERS, type DisplayTier } from '../models.js';
import type { RouteTotals } from '../totals.js';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (n: number, d: number): string => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '-');
const usd = (c: number): string => `$${(c / 100).toFixed(4)}`;

const TIER_NAME: Record<DisplayTier, string> = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable', passthrough: 'Pass' };
const TIER_HELP: Record<DisplayTier, string> = {
  haiku: 'Cheapest tier. Recon subagents, short mechanical transforms and trivial agentic turns land here.',
  sonnet: 'Default tier. Builders, batch work and any request with no stronger signal.',
  opus: 'Deep reasoning. Gate and audit roles, and prompts that asked for depth.',
  fable: 'Top tier. Prompts asking for depth over a long horizon.',
  passthrough: 'Routing was off for these requests: the client model went through untouched, only logged.',
};

const ROLE_HELP: Record<string, { what: string; how: string }> = {
  'no role': { what: 'Ordinary requests outside any subagent or coordinator turn, such as plain single prompts.', how: 'No agent id and no role marker in the request.' },
  coordinator: { what: 'The main Claude Code session that can hand work to subagents.', how: 'Not a subagent: a request with tools but no agent id.' },
  recon: { what: 'Read-only reconnaissance: find things, report facts. Pinned to haiku.', how: 'Marker "claude-router:role=recon", the agent type, or read-only tools.' },
  builder: { what: 'Scoped implementation that needs local judgement. Sonnet.', how: 'Marker, agent type, or a subagent with write tools.' },
  batch: { what: 'Same-shape edits across many files, fully specified. Sonnet.', how: 'Marker "claude-router:role=batch" at the start of the agent prompt.' },
  gate: { what: 'Fresh-context readiness check before risky work is approved. Opus.', how: 'Marker "claude-router:role=gate" at the start of the agent prompt.' },
  audit: { what: 'Fresh-context falsification after risky work lands. Opus.', how: 'Marker "claude-router:role=audit" at the start of the agent prompt.' },
};
const FIG_HELP = {
  req: 'Requests: routed calls from subagents of this role. Failed streams are not counted.',
  cost: 'Cost: what these requests cost on the model that was billed, at list price, in dollars (4 decimals).',
  share: 'Share: this role as a part of all role-attributed requests (or cost) in the current view.',
};

const tip = (lines: string[]): string => `<span class="p-tip" role="tooltip">${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</span>`;
const roleTip = (name: string): string => {
  const h = ROLE_HELP[name] ?? { what: `Custom role "${name}".`, how: 'Named by a prompt marker or agent type.' };
  return tip([`${name}: ${h.what}`, `Comes from: ${h.how}`]);
};

export function protoTierRole(totals: RouteTotals, events: Array<{ tier: string; costCents: number; error?: string }>): string {
  const tierCost: Record<string, number> = {};
  for (const e of events) if (!e.error) tierCost[e.tier] = (tierCost[e.tier] ?? 0) + e.costCents;
  const tcSum = Object.values(tierCost).reduce((a, b) => a + b, 0);
  const tiers = DISPLAY_TIERS.map((t) => ({ t, n: totals.tiers[t] ?? 0 }));
  const tierSum = tiers.reduce((a, x) => a + x.n, 0);
  const named = Object.entries(totals.byRole);
  // "no role" = everything outside any role, so the role row adds up to the same Total as the tier row
  const noRole = {
    requests: totals.requests - named.reduce((a, [, r]) => a + r.requests, 0),
    costCents: totals.costCents - named.reduce((a, [, r]) => a + r.costCents, 0),
  };
  // alphabetical; "no role" is the remainder and always comes last
  const roles = [...named].sort((a, b) => a[0].localeCompare(b[0]));
  if (noRole.requests > 0) roles.push(['no role', noRole]);
  const reqSum = totals.requests;
  const costSum = totals.costCents;

  // A: tables
  const tierA = `<table class="p-tbl"><thead><tr><th>Tier</th><th class="n">Requests</th><th class="n">Share</th></tr></thead><tbody>${tiers
    .map((x) => `<tr class="p-hov"><td><span class="p-dot t-${x.t}"></span>${TIER_NAME[x.t]}${tip([TIER_HELP[x.t]])}</td><td class="n">${x.n}</td><td class="n">${pct(x.n, tierSum)}</td></tr>`)
    .join('')}<tr class="p-sum"><td>Total</td><td class="n">${tierSum}</td><td class="n">100%</td></tr></tbody></table>`;
  const roleA = `<table class="p-tbl"><thead><tr><th>Role</th><th class="n p-hov">Requests${tip([FIG_HELP.req])}</th><th class="n p-hov">Share${tip([FIG_HELP.share])}</th><th class="n p-hov">Cost${tip([FIG_HELP.cost])}</th><th class="n p-hov">Share${tip([FIG_HELP.share])}</th></tr></thead><tbody>${roles
    .map(([name, r]) => `<tr class="p-hov"><td class="mono">${esc(name)}${roleTip(name)}</td><td class="n">${r.requests}</td><td class="n">${pct(r.requests, reqSum)}</td><td class="n">${usd(r.costCents)}</td><td class="n">${pct(r.costCents, costSum)}</td></tr>`)
    .join('')}<tr class="p-sum"><td>Total</td><td class="n">${reqSum}</td><td class="n">100%</td><td class="n">${usd(costSum)}</td><td class="n">100%</td></tr></tbody></table>`;

  // B: tiles
  const tierB = `<div class="p-tiles">${tiers
    .map((x) => `<div class="p-tile p-hov b-${x.t}"><div class="p-lbl">${TIER_NAME[x.t]}</div><div class="p-big">${x.n}</div><div class="p-sub">${pct(x.n, tierSum)} of requests</div>${tip([TIER_HELP[x.t]])}</div>`)
    .join('')}</div>`;
  const roleB = `<div class="p-tiles">${roles
    .map(([name, r]) => `<div class="p-tile p-hov"><div class="p-lbl mono">${esc(name)}</div><div class="p-big">${r.requests}<small> req</small></div><div class="p-sub">${pct(r.requests, reqSum)} of requests</div><div class="p-big m">${usd(r.costCents)}</div><div class="p-sub">${pct(r.costCents, costSum)} of cost</div>${roleTip(name)}</div>`)
    .join('')}</div>`;

  // C: ledger lines, one sentence-like line per entry
  const tierC = `<div class="p-line">${tiers
    .map((x) => `<span class="p-chip p-hov"><span class="p-dot t-${x.t}"></span><b>${TIER_NAME[x.t]}</b> ${x.n} <i>(${pct(x.n, tierSum)})</i>${tip([TIER_HELP[x.t]])}</span>`)
    .join('')}</div>`;
  const roleC = `<div class="p-led">${roles
    .map(([name, r]) => `<div class="p-hov"><span class="mono">${esc(name)}</span><span>${r.requests} req <i>(${pct(r.requests, reqSum)})</i></span><span>${usd(r.costCents)} <i>(${pct(r.costCents, costSum)})</i></span>${roleTip(name)}</div>`)
    .join('')}</div>`;

  // D: C's inline format for both sections; each entry is a two-line chip (name, then requests and cost, each with percent)
  const tierD = `<div class="p-flow">${tiers
    .filter((x) => x.n > 0 || x.t !== 'passthrough')
    .map((x) => `<div class="p-ent p-hov"><div class="p-nm"><span class="p-dot t-${x.t}"></span>${TIER_NAME[x.t]}</div><div class="p-fg">${x.n} req <i>(${pct(x.n, tierSum)})</i></div><div class="p-fg">${usd(tierCost[x.t] ?? 0)} <i>(${pct(tierCost[x.t] ?? 0, tcSum)})</i></div>${tip([TIER_HELP[x.t]])}</div>`)
    .join('')}</div>`;
  const roleD = `<div class="p-flow">${roles
    .map(([name, r]) => `<div class="p-ent p-hov"><div class="p-nm mono">${esc(name)}</div><div class="p-fg">${r.requests} req <i>(${pct(r.requests, reqSum)})</i></div><div class="p-fg">${usd(r.costCents)} <i>(${pct(r.costCents, costSum)})</i></div>${roleTip(name)}</div>`)
    .join('')}</div>`;

  // E: D on a single line per section, with a Total entry; no wrapping, scrolls only if the window is too narrow
  const ent = (nm: string, cls: string, n: number, nd: number, c: number, cd: number, t: string): string =>
    `<span class="p-e p-hov"><b class="${cls}">${nm}</b> ${n} <i>(${pct(n, nd)})</i> <u>${usd(c)}</u> <i>(${pct(c, cd)})</i>${t}</span>`;
  const tierE = `<div class="p-one"><div class="p-ents">${tiers
    .filter((x) => x.n > 0 || x.t !== 'passthrough')
    .map((x) => ent(`<span class="p-dot t-${x.t}"></span>${TIER_NAME[x.t]}`, '', x.n, tierSum, tierCost[x.t] ?? 0, tcSum, tip([TIER_HELP[x.t]])))
    .join('')}</div><span class="p-e p-tot p-hov"><b>Total</b> ${tierSum} <u>${usd(tcSum)}</u>${tip(['Total: all routed requests in the current view and what they cost on the billed models at list price. Failed streams are not counted.', 'Equals the sum of the tier entries; passthrough is included when shown.'])}</span></div>`;
  const roleE = `<div class="p-one"><div class="p-ents">${roles
    .map(([name, r]) => ent(esc(name), 'mono', r.requests, reqSum, r.costCents, costSum, roleTip(name)))
    .join('')}</div><span class="p-e p-tot p-hov"><b>Total</b> ${reqSum} <u>${usd(costSum)}</u>${tip(['Total: all routed requests in the current view and their cost; the 100% the role percentages refer to.', 'Same figure as the Tier Distribution total: requests outside any role are the "no role" entry.'])}</span></div>`;

  const block = (v: string, role: string, tier: string): string =>
    `<div class="p-var" data-v="${v}"><div class="section-label">By Role</div><div class="card p-card">${role}</div><div class="section-label">Tier Distribution</div><div class="card p-card">${tier}</div></div>`;

  return `<style>
.p-var{display:none}.p-var.on{display:block}.p-card{padding:10px 14px;margin-bottom:26px}
.p-bar{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:99;display:flex;gap:6px;padding:6px;background:#0b0f19;border:1px solid #3a4560;border-radius:10px;font:12px ui-monospace,monospace}
.p-bar a{color:#e6ebf5;padding:4px 12px;border-radius:6px;text-decoration:none}.p-bar a.on{background:#2f74f9;color:#fff}
.p-hov{position:relative;cursor:help}.p-tip{position:absolute;z-index:30;left:8px;top:100%;display:none;width:300px;padding:8px 10px;background:#0b0f19;color:#e6ebf5;border:1px solid #3a4560;border-radius:8px;font:12px/1.5 system-ui,sans-serif;text-align:left;box-shadow:0 10px 30px #000a;font-weight:400;letter-spacing:0;text-transform:none}
.p-tip span{display:block}.p-tip span+span{margin-top:4px}.p-hov:hover>.p-tip{display:block}
td.p-hov,th.p-hov{text-decoration:underline dotted #8b95a7;text-underline-offset:4px}tr.p-hov{cursor:default}tr.p-hov>td:first-child{cursor:help}
.p-tbl{width:100%;border-collapse:collapse;font-size:13px}.p-tbl th{font:10px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#a9b3c6;text-align:left;padding:4px 8px}
.p-tbl td{padding:6px 8px;border-top:1px solid #8b95a726}.p-tbl .n{text-align:right;font-variant-numeric:tabular-nums}.p-tbl th.n{text-align:right}.p-sum td{font-weight:700;border-top:1px solid #8b95a766}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.p-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px}
.t-haiku{background:var(--t-haiku)}.t-sonnet{background:var(--t-sonnet)}.t-opus{background:var(--t-opus)}.t-fable{background:var(--t-fable)}.t-passthrough{background:#55607a}
.p-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.p-tile{padding:10px 12px;border:1px solid #8b95a733;border-radius:10px;border-left:3px solid #8b95a7}
.b-haiku{border-left-color:var(--t-haiku)}.b-sonnet{border-left-color:var(--t-sonnet)}.b-opus{border-left-color:var(--t-opus)}.b-fable{border-left-color:var(--t-fable)}
.p-lbl{font:10px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#a9b3c6}.p-big{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}.p-big small{font-size:12px;color:#a9b3c6;font-weight:400}.p-big.m{font-size:16px;margin-top:6px}.p-sub{font-size:12px;color:#a9b3c6}
[data-tip]{cursor:help}td[data-tip]:not(.none){text-decoration:underline dotted #8b95a7;text-underline-offset:4px}.p-card:hover{z-index:40}.p-tip{white-space:normal}.p-e:nth-last-child(-n+3)>.p-tip{left:auto;right:0}
.p-one{display:flex;flex-wrap:nowrap;align-items:flex-start;gap:18px;font-size:12px;}.p-ents{flex:1;min-width:0;display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 18px}.p-one{font-variant-numeric:tabular-nums;padding:2px 0}.p-e{white-space:nowrap}
.p-e{position:relative}.p-e b{font-weight:600}.p-e i{font-style:normal;color:#a9b3c6}.p-e u{text-decoration:none;color:#e6ebf5;margin-left:4px}.p-e .p-dot{width:8px;height:8px;margin-right:6px}
.p-tot>.p-tip{left:auto;right:0}.p-tot{flex:0 0 190px;box-sizing:border-box;padding-left:18px;border-left:1px solid #8b95a766}
.p-flow{display:flex;flex-wrap:wrap;gap:14px 34px;padding:4px 2px}.p-ent{min-width:120px}.p-nm{font-size:14px;font-weight:600;margin-bottom:3px}.p-fg{font-size:13px;font-variant-numeric:tabular-nums;line-height:1.55}.p-fg i{font-style:normal;color:#a9b3c6}
.p-line{display:flex;flex-wrap:wrap;gap:6px 22px;font-size:14px;padding:4px 0}.p-chip b{font-weight:600}.p-chip i,.p-led i{font-style:normal;color:#a9b3c6}
.p-led>div{display:grid;grid-template-columns:1fr auto auto;gap:24px;padding:6px 0;font-size:13px;border-bottom:1px solid #8b95a726;font-variant-numeric:tabular-nums}.p-led>div:last-child{border:0}
</style>
${block('a', roleA, tierA)}${block('b', roleB, tierB)}${block('c', roleC, tierC)}${block('d', roleD, tierD)}${block('e', roleE, tierE)}
<div class="p-bar"><a data-k="e" href="?variant=e">E one line</a><a data-k="a" href="?variant=a">A table</a><a data-k="b" href="?variant=b">B tiles</a><a data-k="c" href="?variant=c">C ledger</a><a data-k="d" href="?variant=d">D inline both</a></div>
<script>(function(){var t=document.createElement('div');t.className='tip-body';t.setAttribute('role','tooltip');t.style.cssText='position:fixed;z-index:100;pointer-events:none';document.body.appendChild(t);
function show(el){t.textContent=el.getAttribute('data-tip');t.style.display='block';var r=el.getBoundingClientRect(),w=t.offsetWidth,h=t.offsetHeight,x=Math.min(Math.max(8,r.left),innerWidth-w-8),y=r.bottom+6;if(y+h>innerHeight-8)y=Math.max(8,r.top-h-6);t.style.left=x+'px';t.style.top=y+'px'}
function hide(){t.style.display='none'}
document.addEventListener('mouseover',function(e){var el=e.target.closest&&e.target.closest('[data-tip]');el?show(el):hide()});
document.addEventListener('focusin',function(e){var el=e.target.closest&&e.target.closest('[data-tip]');el?show(el):hide()});
document.addEventListener('scroll',hide,true);})();
(function(){var v=(new URLSearchParams(location.search).get('variant')||'e');document.querySelectorAll('[data-v],[data-k]').forEach(function(e){if((e.dataset.v||e.dataset.k)===v)e.classList.add('on')})})()</script>`;
}
