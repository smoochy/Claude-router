# End-to-end run on the fork: what does the router save as it ships now?

**Date:** 2026-10-13
**Method:** the fork's built CLI (`@smoochy/claude-router`, `0.4.0-smoo.5`, commit `245350c` of `smoo/main`) started as a real proxy process under a scratch `HOME`, driven with 330 synthetic turns against a local stub upstream, once per routing configuration.
**Predecessor:** [2026-07-21-end-to-end-savings.md](2026-07-21-end-to-end-savings.md) measured upstream `@sheruq/claude-router@0.2.2` with 200 real transcript turns. That document is unchanged.
**Metric:** the router's own figures only - `costCents`, `savedCents` and the per-tier breakdown from `history.jsonl`. Output quality is out of scope.

## What this run is, and is not

It is a deterministic, reproducible exercise of the shipped routing, pricing and ledger code path with the fork's current 5.5 model generation and pricing snapshot. Every number below can be regenerated from this file alone.

It is **not** a forecast. The turn mix and the token counts are synthetic constants chosen to give each routing gate traffic, so the percentages describe this mix, not anyone's bill. The real-traffic figures for the fork are the dashboard numbers recorded in the closed measurement decision for the three-mode comparison (22.7 percent over 1,776 route events, coordinator 858 events and subagents 958); the result here lands in the same neighbourhood for the pinned configuration, which is a consistency check on the harness shape and nothing more.

## Deviations from the 2026-07-21 method

| 2026-07-21 | This run | Why |
|---|---|---|
| Published npm package, one line patched to reach a stub | Fork build from the working tree, stub reached with the shipped `--upstream` flag | The flag now exists, so the artifact runs unmodified. |
| 200 real turns from local Claude Code transcripts, real `usage` replayed | 330 synthetic turns, fixed synthetic `usage` per turn shape | No real prompts or session data may be committed or reused. |
| `createProxyApp` called in-process | The CLI is spawned as a process (`start`) and addressed over HTTP | Exercises argument parsing and the config path too. |
| One configuration (`forceRoute`, heuristic classifier) | Three: pinned coordinator, unpinned, observe | The fork's headline lever is the coordinator pin. |
| Baseline computed offline from what each turn really ran on | Baseline is the router's own `savedCents` reference: the model the client named (`claude-opus-5-5`) | Matches the map's comparison metric and the all-Opus baseline of the old run. |
| Pricing of the time | `src/pricing-snapshot.json` of the commit: opus 5.5 $4/$20, sonnet 5.5 $2/$10, haiku 5.5 $0.10/$0.50 per million, cache reads at 5 percent / 5 percent / 10 percent of input | The pricing the fork ships. |

## Environment

- Node v26.8.1 on Windows 11, `npm ci` then `npm run build` in the checkout.
- Scratch `HOME` and `USERPROFILE` created with `mkdtemp`, so `~/.claude-router` of the operator is never touched. `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed from the child environment. The only credential is the literal string `synthetic-key`; no request leaves the machine.
- Proxy flags common to all runs: `--classifier heuristic` (no classifier model call) and `--upstream http://127.0.0.1:41999`. The proxy listens on 41998.
- Per-run flags: A `--session-model opus` (the Claude Code profile that `install` writes), B none (coordinator classified like any request), C `--routing-mode observe` (passthrough control).

## The turn set

All turns name `claude-opus-5-5`, so the all-Opus baseline is what the client asked for. Text is generated from the loop index, so there is no personal content. 330 turns:

| Group | Turns | Shape |
|---|---|---|
| Coordinator, mid-loop | 84 | Eight tools, no agent header, newest message is a `tool_result` |
| Coordinator, fresh instruction | 56 | Eight tools, no agent header, plain user text |
| Subagent, mid-loop | 100 | Four write-capable tools, `x-claude-code-agent-id` header, newest message a `tool_result` |
| Subagent, fresh instruction | 44 | Same, plain user text |
| Subagent, depth request | 16 | Same, text asks to "critique the trade-offs" |
| Single-turn, mechanical | 20 | No tools, "Translate item N to French" |
| Single-turn, other | 10 | No tools, short standalone question |

The stub returns the model the router chose and a fixed `usage`: with tools 800 input, 300 output, 30,000 cache-read and 1,500 cache-creation tokens; without tools 400 input and 120 output. The coordinator share is 140 of 330 (42 percent), the subagent share 160 (48 percent), single-turn 30.

## Raw numbers

All 330 requests succeeded in every run, and every run wrote 330 history events.

| Run | Flags | Baseline (all Opus) | Actual cost | `savedCents` | Saving |
|---|---|---|---|---|---|
| A | `--session-model opus` | $6.9300 | $5.1976 | $1.7324 | **25.0 percent** |
| B | none | $6.9300 | $3.6086 | $3.3214 | **47.9 percent** |
| C | `--routing-mode observe` | $6.9300 | $6.9300 | $0.0000 | 0.0 percent |

Baseline equal to cost plus saved holds in all three runs, and C reproduces the baseline exactly as a passthrough control.

Per-tier breakdown (events, cost, saved), cents:

| Tier | A events | A cost | A saved | B events | B cost | B saved |
|---|---|---|---|---|---|---|
| opus | 156 | 354.12 | 0.00 | 16 | 36.32 | 0.00 |
| sonnet | 154 | 165.44 | 165.44 | 294 | 324.34 | 324.34 |
| haiku | 20 | 0.20 | 7.80 | 20 | 0.20 | 7.80 |

Decisions by reason (the `reason` field of each event):

| Reason | A | B |
|---|---|---|
| `session:coordinator-pinned` | 140 | 0 |
| `agentic:mid-loop` | 100 | 184 |
| `agentic:default` | 44 | 100 |
| `agentic:depth-requested` | 16 | 16 |
| `single-turn:short mechanical transform` | 20 | 20 |
| `single-turn:default` | 10 | 10 |

## Reading it

- **The pin decides most of the result.** With the coordinator pinned to opus (A), all 140 coordinator turns bill at the baseline model and contribute zero saving; the 25.0 percent comes entirely from the 160 subagent turns and the 30 single-turn requests. Unpinned (B), the same 140 coordinator turns are routed by the structural gates and the saving nearly doubles to 47.9 percent. This repeats, on the current build, the structure that the dashboard showed on live traffic: the router cannot discount a price it is configured never to question.
- **Nothing routes up in this mix.** Every non-opus decision is cheaper than the requested opus, so `savedCents` is never negative here. The 2026-07-21 run found 16 of 200 turns routed to a more expensive tier because real traffic contained turns that genuinely ran on haiku; this synthetic set contains no such turns, so that cost term is absent by construction and the percentages above are upper bounds in the same sense as before.
- **Token counts are held constant across models**, exactly as in the old run. A cheaper tier that answers differently or needs an extra turn is not modelled.
- **Sonnet carries almost everything that is not pinned.** 154 of the 160 non-opus decisions in A and 294 of 330 in B are sonnet, mostly via `agentic:mid-loop` and `agentic:default`; haiku only fires for the 20 mechanical single-turn transforms and saves 7.8 cents. This matches the old finding that one structural rule produces nearly all of the saving.
- **The depth gate still works as designed.** The 16 "critique the trade-offs" subagent turns stay on opus in both runs.

## Reproducing

1. Check out `smoo/main` at commit `245350c`, then `npm ci && npm run build`.
2. Save the script below as `harness.mjs` anywhere outside the repository.
3. Run it once per configuration, passing the built CLI, a label and the per-run flags:

```bash
node harness.mjs "$PWD/dist/proxy/cli.js" A --session-model opus
node harness.mjs "$PWD/dist/proxy/cli.js" B
node harness.mjs "$PWD/dist/proxy/cli.js" C --routing-mode observe
```

The script prints a JSON summary (`costCents`, `savedCents`, `baselineCents`, `pct`, `byTier`, `reasons`). Its ports are 41999 (stub) and 41998 (proxy); free them first.

```js
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [cli, label, ...flags] = process.argv.slice(2);
const STUB = 41999, PROXY = 41998;
const home = mkdtempSync(join(tmpdir(), 'cr-e2e-'));

// Stub upstream: fixed synthetic usage, echoes the model the router chose.
const stub = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const b = JSON.parse(raw);
    const tools = (b.tools?.length ?? 0) > 0;
    const usage = tools
      ? { input_tokens: 800, output_tokens: 300, cache_read_input_tokens: 30000, cache_creation_input_tokens: 1500 }
      : { input_tokens: 400, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_x', type: 'message', role: 'assistant', model: b.model,
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage }));
  });
});
await new Promise((r) => stub.listen(STUB, '127.0.0.1', r));

const env = { ...process.env, HOME: home, USERPROFILE: home };
delete env.ANTHROPIC_BASE_URL; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
const proxy = spawn('node', [cli, 'start', '--port', String(PROXY), '--upstream', `http://127.0.0.1:${STUB}`,
  '--classifier', 'heuristic', ...flags], { env, stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PROXY}/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

const TOOLS = (names) => names.map((name) => ({ name, description: name, input_schema: { type: 'object', properties: {} } }));
const COORD_TOOLS = TOOLS(['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Agent', 'TodoWrite']);
const BUILD_TOOLS = TOOLS(['Read', 'Edit', 'Bash', 'Grep']);
const result = (n) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: 'synthetic output' }] });
const loop = (n, task) => [{ role: 'user', content: task },
  { role: 'assistant', content: [{ type: 'tool_use', id: `t${n}`, name: 'Read', input: {} }] }, result(n)];

const turns = [];
const add = (count, make) => { for (let i = 0; i < count; i++) turns.push(make(i)); };
const req = (messages, tools, agent) => ({ headers: agent !== undefined ? { 'x-claude-code-agent-id': `agent${agent + 1}` } : {},
  body: { model: 'claude-opus-5-5', max_tokens: 1024, messages, ...(tools ? { tools } : {}) } });
add(84, (i) => req(loop(i, `Synthetic coordinator task ${i}`), COORD_TOOLS));           // coordinator, mid-loop
add(56, (i) => req([{ role: 'user', content: `Synthetic coordinator question ${i}` }], COORD_TOOLS)); // coordinator, fresh
add(100, (i) => req(loop(i, `Synthetic subagent task ${i}`), BUILD_TOOLS, i));          // subagent, mid-loop
add(44, (i) => req([{ role: 'user', content: `Synthetic subagent instruction ${i}` }], BUILD_TOOLS, i)); // subagent, fresh
add(16, (i) => req([{ role: 'user', content: `Critique the trade-offs of synthetic option ${i}` }], BUILD_TOOLS, i)); // subagent, depth
add(20, (i) => req([{ role: 'user', content: `Translate item ${i} to French` }]));        // single-turn, mechanical
add(10, (i) => req([{ role: 'user', content: `Synthetic standalone question ${i}` }]));  // single-turn, default

let fail = 0;
for (const t of turns) {
  const r = await fetch(`http://127.0.0.1:${PROXY}/v1/messages`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'synthetic-key', 'anthropic-version': '2023-06-01', ...t.headers },
    body: JSON.stringify(t.body) });
  if (!r.ok) fail++;
  await r.text();
}
await new Promise((r) => setTimeout(r, 500));

const hist = join(home, '.claude-router', 'history.jsonl');
const ev = existsSync(hist) ? readFileSync(hist, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const by = {}; let cost = 0, saved = 0;
for (const e of ev) {
  const k = e.tier; by[k] ??= { n: 0, cost: 0, saved: 0 };
  by[k].n++; by[k].cost += e.costCents; by[k].saved += e.savedCents; cost += e.costCents; saved += e.savedCents;
}
const reasons = {}; for (const e of ev) reasons[e.reason ?? 'none'] = (reasons[e.reason ?? 'none'] ?? 0) + 1;
const r2 = (x) => Math.round(x * 1000) / 1000;
for (const v of Object.values(by)) { v.cost = r2(v.cost); v.saved = r2(v.saved); }
console.log(JSON.stringify({ label, flags, sent: turns.length, failures: fail, events: ev.length,
  costCents: r2(cost), savedCents: r2(saved), baselineCents: r2(cost + saved),
  pct: cost + saved ? r2((saved / (cost + saved)) * 100) : 0, byTier: by, reasons }, null, 1));
proxy.kill(); stub.close(); process.exit(0);
```

## What this changes

- The fork's shipped build routes as documented on the 5.5 generation, with no code patch and no live credentials needed to verify it.
- The sensitivity to the coordinator pin is now a number on the current build (25.0 versus 47.9 percent on this mix), reproducible without touching live traffic. Whether to act on it is a quality decision this map does not evaluate.
- Not measured here: real token distributions, routing-up cost on genuinely cheap turns, streaming responses, and the `requestedModel` pin-honored label of the dashboard (this run only asserts the baseline it feeds).
