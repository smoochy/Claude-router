# @smoochy/claude-router

<p align="center">
  <img src="assets/claude-router.svg" alt="claude-router" width="640">
</p>

<p align="center">
  <strong>Auto-route every Claude request to the cheapest model that can handle it.</strong>
</p>

<p align="center">
  <a href="https://github.com/smoochy/Claude-router/actions/workflows/test.yml"><img src="https://github.com/smoochy/Claude-router/actions/workflows/test.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/smoochy/Claude-router/releases"><img src="https://img.shields.io/github/v/release/smoochy/Claude-router?include_prereleases&color=D97757&label=release" alt="release"></a>
  <img src="https://img.shields.io/github/license/smoochy/Claude-router?color=D97757" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-strict-D97757" alt="TypeScript">
</p>

[![Coindrop](https://img.shields.io/badge/Tip%20me%20crypto-smoochy-FFB655?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgwIDUxMikgc2NhbGUoLjEgLS4xKSIgZmlsbD0iIzAwMCI%2BPHBhdGggZD0iTTE5NjIgNTAwOCBjMCAtNDAgMCAtNzkgLTEgLTg1IC0xIC05IC0yNSAtMTMgLTg2IC0xMyBsLTg1IDAgMCAtODUgYzAgLTYxIDQgLTg1IDEzIC04NiA2IDAgNDUgMCA4NSAxIDgyIDEgNzUgMTIgNzQgLTEwNyBsLTEgLTYzIDg3IDAgODcgMCAwIDgzIC0xIDgyIC04NiAzIC04NSAzIDEgODIgMSA4MiA4MyAzIGM2OCAyIDgyIDAgODMgLTEzIDAgLTggMSAtNDYgMiAtODUgbDAgLTcwIDg3IDAgODYgMCAtMSA4MyAtMSA4MiAtODYgMyAtODYgMyAxIDgyIDIgODIgLTg3IDMgLTg2IDMgMCAtNzN6Ii8%2BPHBhdGggZD0iTTM5MzIgNDgyMCBjLTQgLTMgLTcgLTQyIC02IC04NiBsMCAtODIgLTc5IDIgYy00MyAxIC04MiAtMSAtODYgLTQgLTQgLTMgLTcgLTQxIC03IC04NSBsMSAtODAgNzAgLTIgYzEwNCAtMyAxMDEgLTUgMTAwIDgzIC0xIDg5IDAgOTAgMTAxIDg5IGw3MCAtMiAtMiA4MSBjLTEgNDUgLTIgODQgLTMgODcgLTEgNiAtMTUwIDYgLTE1OSAtMXoiLz48cGF0aCBkPSJNNDEwMiA0NjQ1IGMtMyAtNSAtNiAtNDQgLTcgLTg3IGwwIC03NiA4NSAwIDg2IDEgMCA4NSAtMSA4NSAtNzggMSBjLTQ0IDEgLTgyIC0zIC04NSAtOXoiLz48cGF0aCBkPSJNMjg0MCA0NTUzIGMtMzAzIC02MyAtNTUyIC0zMTAgLTYwNCAtNTk5IC0xOCAtOTkgLTEyIC05MSAtNjkgLTk4IC0xNDkgLTIwIC0xMzAgLTI1IC0xNzUgNDEgLTc0IDEwOCAtMTg0IDIwMSAtMzEyIDI2MSAtNjkgMzMgLTE5NyA2MyAtMjc3IDY1IC02NCAyIC03NiAtMSAtOTUgLTIxIC0yMyAtMjIgLTIzIC0yNiAtMjYgLTMyNiBsLTMgLTMwMyAtNDIgLTIzIGMtMjYwIC0xNDMgLTUyMiAtMzg5IC02ODIgLTY0MiBsLTMwIC00NyAtMTkwIC0xIGMtMTA0IDAgLTIwMiAtMyAtMjE3IC03IC00MCAtMTEgLTk2IC02OSAtMTA4IC0xMTEgLTggLTI1IC0xMCAtMjE0IC04IC01ODMgbDMgLTU0NSAyNyAtNDEgYzQ1IC02OSA3MyAtNzYgMzAyIC03OCAxNTUgLTEgMjAxIC00IDIwNCAtMTQgNiAtMTggMTA4IC0xNjcgMTQxIC0yMDQgMTE4IC0xMzcgMjA3IC0yMjQgMzIwIC0zMTEgNDIgLTMyIDEwMCAtNzIgMTI4IC04OCAyOSAtMTcgNTYgLTM1IDYwIC00MSA0IC02IDcgLTE1OCA4IC0zMzcgMCAtMzIyIDEgLTMyNSAyNCAtMzY2IDE0IC0yNSA0MCAtNTEgNjUgLTY1IDQwIC0yMyA0NyAtMjMgMzIxIC0yNCAxNTQgMCAyOTYgMyAzMTYgOCA0OSAxMiAxMDUgNjYgMTE4IDExNCA2IDIxIDExIDEwOSAxMSAxOTYgMCAxNDYgMSAxNTggMTggMTUzIDkgLTMgNDIgLTggNzIgLTExIDMwIC0zIDYyIC04IDcwIC0xMCAzNyAtMTAgMjA5IC0xOSAzNTUgLTE5IDIzMCAwIDMzNiAxMSA1ODkgNjAgNjYgMTIgMjM2IDYwIDMxOSA4OSA1NCAxOSAxMDEgMzUgMTA1IDM1IDQgMCA3IC0xMDcgNyAtMjM4IDAgLTIyNiAxIC0yMzkgMjIgLTI4MyAxNiAtMzEgMzYgLTUzIDY1IC02OSA0MyAtMjQgNDUgLTI0IDMzOCAtMjQgMzM1IDAgMzQ2IDIgMzk3IDc3IGwyOCA0MiAxIDU1MSAxIDU1MSA0NCA1OSBjMTQ0IDE5MCAyNDAgNDE1IDI4MyA2NjEgNCAyMiAxMyAyNCA0OSAxMCA0NSAtMTkgNTAgLTM4IDUyIC0yMjIgMSAtMTM3IDMgLTE1NCAyNCAtMTkxIDMwIC01MyA4NCAtODQgMTUzIC04OCAyOSAtMiA1OSAtMSA2NiAyIDggMyAxMiAzMCAxMiA4NyBsMCA4MiAtNDIgLTEgLTQzIC0xIC0xIDE1NSBjLTEgMTM0IC00IDE2MiAtMjEgMjAyIC0zNiA4MCAtOTYgMTI4IC0xOTIgMTUyIGwtNDMgMTIgLTQgNzQgYy0yIDQxIC02IDkxIC0xMCAxMTAgLTMgMTkgLTggNDYgLTExIDYwIC0zMiAxODEgLTEyNiAzOTQgLTI1MSA1NzAgLTU2IDc4IC0yNDAgMjc2IC0zMTcgMzQwIC0xMDUgODcgLTMwMSAyMTQgLTQwOCAyNjQgbC0zOSAxOCA4IDcxIGMxNCAxNDEgNiAyMzIgLTMxIDM0NSAtODkgMjY0IC0zMDUgNDU2IC01ODQgNTE4IC01NCAxMiAtMjI4IDEwIC0yOTEgLTN6Ii8%2BPHBhdGggZD0iTTM5MzEgNDQ3NSBjLTYgLTggLTcgLTEwNCAtMiAtMTUzIDEgLTEwIDIyIC0xMiA4NCAtMTAgbDgyIDMgMCA3OCBjMSA0MyAtMyA4MSAtOCA4NCAtMTcgMTAgLTE0OCA4IC0xNTYgLTJ6Ii8%2BPHBhdGggZD0iTTQ2OTQgNDA1OCBsMSAtODMgLTg2IC0zIC04NiAtMyAwIC04NCAwIC04NCA4NiAtMyA4NiAtMyAtMSAtODMgLTEgLTgzIDg2IDMgODYgMyAwIDgwIDAgODAgLTg2IDMgLTg2IDMgMSA4NCAwIDg0IDg1IDMgODUgMyAxIDgzIDEgODIgLTg3IDAgLTg3IDAgMiAtODJ6Ii8%2BPHBhdGggZD0iTTQ4NjQgMzg4OCBsMSAtODMgODUgMCA4NSAwIDAgODAgLTEgODAgLTg1IDMgLTg1IDMgMCAtODN6Ii8%2BPC9nPjwvc3ZnPg%3D%3D)](https://coindrop.to/smoochy) [![Tip me uptime](https://img.shields.io/badge/Tip%20me%20uptime%20%F0%9F%96%A5%EF%B8%8F-smoochy84-E9C46A?logo=buymeacoffee&logoColor=000000)](https://www.buymeacoffee.com/smoochy84) [![Ko-fi](https://img.shields.io/badge/Ko--fi-smoochy-7CC6FE?logo=ko-fi&logoColor=000000)](https://ko-fi.com/smoochy)

<p align="center">
  This project exists because of <a href="https://github.com/Serhii-Leniv/claude-router">Serhii-Leniv/claude-router</a>'s work - all credit for the original routing idea and implementation goes upstream. Released independently as <code>-smoo</code> tarballs; see <a href="https://github.com/smoochy/Claude-router/blob/smoo/main/docs/BRANCHING.md">docs/BRANCHING.md</a> for how this fork tracks it.
</p>

> [!WARNING]
> **This is an AI-assisted ("vibe-coded") project with no professional third-party security audit.** Review the code yourself before trusting it with real traffic.
>
> - **The proxy sits in the request path.** Every prompt, every response, and the Anthropic API key you send through it pass through this code — more exposure than a typical self-hosted web app.
> - **The dashboard binds to `127.0.0.1` by default and has no authentication.** Keep it there. Do not bind it to `0.0.0.0`, put it on a network you do not control, or reverse-proxy it to the public internet.
> - **`history.jsonl` is a ledger of your traffic**: model, cost, role, session ID, and session titles read from Claude Code's transcripts. Treat it as sensitive, not as a plain log file.

---

## What this fork adds

- **A `routingMode` switch.** `route` routes every call, `observe` forwards the client's model untouched but still records every request, and `off` forwards it untouched and records nothing. It is read once at start, so changing it takes a restart; `--force-route` and `forceRoute` remain aliases for `route` (and `forceRoute: false` for `observe`). `status`, `doctor`, the startup banner and the statusline show the active mode, and the dashboard can filter the recorded history by mode (including entries recorded before the switch existed) so the modes can be compared.
- **A generated model and price list.** Prices and model ids come from a CI-generated list, read remote first, then from a local cache, then from a build-time snapshot. The default tiers are Haiku 5.5, Sonnet 5.5 and Opus 5.5 (Fable 5.1 when enabled). A tier id that equals a former built-in default is routed to the newest model of its family with a one-time warning, `install` rewrites it in the config, and `doctor` reports it. Models with a long-context price tier are billed at the higher rate once the prompt passes its threshold.
- **A security gate and releases.** Every release goes through an `/appsec` and `/security-review` gate, versions are the upstream version plus a `-smoo.<n>` suffix, each release is published to npm and attached as a tarball, and a workflow opens a pull request whenever upstream tags a new release.
- **Dashboard filters and cost display.** Filter by routing mode, role, model, tier, pin, reason, retry, session and time window (all time, today, last hour). Mode, role, model, tier, pin, reason, retry and session take several values at once: every value starts shown, a click hides it (`!=`), a second click shows only it (`=`), and the bar keeps its width because the selection is summarised in an ellipsized entry (the URL carries `tier=opus&tier=sonnet` and `tier_ne=passthrough`, or `mode_ne=route`). Scope (this session or the last 2000 history entries), window and the refresh interval (off, 10, 20, 30, 45 or 60 seconds) are single-select popovers in the same look. The Pin column shows whether the requested model was honored, and every dollar amount has four decimals. The screenshots below come from a local build fed with synthetic history and invented session names, not real traffic; they show the popups truly open (Mode with one value hidden, Session with one hidden and one only, Window, Refresh) and the closed bar with its ellipsized summaries.

![Dashboard overview: stat cards for cost and requests, By Role and Tier Distribution summaries, and the route feed with every filter set to All, the multi-value filters shown as compact All entries.](https://raw.githubusercontent.com/smoochy/Claude-router/smoo/main/docs/images/dashboard-overview.png)

![Dashboard with the Mode filter set to "≠ Route" (the route mode hidden): every row is an observe-mode passthrough, and the stat cards and summaries recompute for just those requests.](https://raw.githubusercontent.com/smoochy/Claude-router/smoo/main/docs/images/dashboard-observe-mode.png)

![Dashboard with the multi-select Mode filter popup open, listing Observe (shown, green check) and Route (hidden, red cross, struck through), the same tri-state rows as the other filters.](https://raw.githubusercontent.com/smoochy/Claude-router/smoo/main/docs/images/dashboard-mode-filter.png)

![Dashboard filtered to the gate role (shown as "= gate" in the Role filter) and the Today window: eight Opus requests, with the summaries recomputed for them.](https://raw.githubusercontent.com/smoochy/Claude-router/smoo/main/docs/images/dashboard-role-window.png)

![Dashboard filtered to overridden pins (Pin "= overridden") on Sonnet (Tier "= sonnet"), with the hover tooltip on an Overridden badge explaining that the client asked for Opus but the router billed Sonnet.](https://raw.githubusercontent.com/smoochy/Claude-router/smoo/main/docs/images/dashboard-pin-tooltip.png)

![Dashboard with the refresh-interval popover open below the Refresh control in the header, listing off, 10s, 20s, 30s, 45s and 60s with 30s selected, and the footer reading Auto-refreshes every 30 seconds.](https://raw.githubusercontent.com/smoochy/Claude-router/smoo/main/docs/images/dashboard-auto-refresh.png)

![Dashboard with the single-select Window popover open, listing All time (selected), Today and Last hour in the same style as the multi-value filters.](https://raw.githubusercontent.com/smoochy/Claude-router/smoo/main/docs/images/dashboard-window-filter.png)

![Dashboard with the tri-state Session filter popup open, listing four invented session names and No session id: Write release notes is marked only (filled dot), Fix flaky unit test is hidden (red cross, struck through), and the other values are still shown (green check).](https://raw.githubusercontent.com/smoochy/Claude-router/smoo/main/docs/images/dashboard-session-filter.png)

![Dashboard with the closed filter bar after a mixed selection: the Session entry reads "= Write..." and the Tier entry "= sonnet ≠ ...", both ellipsized to keep the bar's width, and the four matching requests below.](https://raw.githubusercontent.com/smoochy/Claude-router/smoo/main/docs/images/dashboard-filter-summary.png)

**Cut your Anthropic API bill by routing every request to the cheapest Claude model that can handle it — Haiku, Sonnet, or Opus.** `claude-router` is a self-hosted, drop-in proxy: point any Anthropic-compatible app (Claude Code, Cursor, Cline, or your own SDK code) at it with one environment variable and get automatic, complexity-aware model routing — **zero code changes, no SaaS in your request path, no per-token markup**. Every response reports exactly what you saved.

```text
[claude-router] → haiku  (heuristic, 0ms) | cost: $0.0010 | saved: $0.0030 vs claude-sonnet-5-5
[claude-router] → opus   (hybrid, 48ms)   | cost: $0.0890 | extra: $0.0740 vs claude-sonnet-5-5
```

## Is this for you?

**If you pay per token** (Anthropic API, Amazon Bedrock, or Google Vertex) **and your traffic is a mix of easy and hard requests.** The router skims the easy majority down to Haiku/Sonnet and reserves Opus for what actually needs it.

**Measured, not promised.** One live Claude Code session through the proxy spent $3.34 against a $4.23 all-Opus counterfactual — **21%** ([note](research/2026-07-25-live-session.md)). A 200-turn replay of the published 0.2.2 projected **35%** ([method](research/2026-07-21-end-to-end-savings.md)), an upper bound that assumes token counts do not change when the model does and that comes almost entirely from one rule: mid-loop tool steps go to Sonnet. Direct API (single-turn) traffic is **unmeasured**. See [What is measured vs assumed](#what-is-measured-vs-assumed).

## Contents

- [Quick start](#quick-start) · [How it works](#how-it-works) · [Configuration](#configuration) · [CLI reference](#cli-reference)
- [Pricing & savings](#pricing--savings) · [Other providers](https://github.com/smoochy/Claude-router/blob/smoo/main/docs/providers.md) · [Use as a library](https://github.com/smoochy/Claude-router/blob/smoo/main/docs/library.md) · [Authentication & security](#authentication--security)

## Features

| | |
|---|---|
| 🔌 **Zero code changes** | Point any Anthropic app at the proxy via `ANTHROPIC_BASE_URL`, or `import` it as a library. |
| 🧠 **Evidence-based routing** | Conjunctive gates on request shape, not a keyword score. Sonnet is the default; leaving it needs positive evidence. See [research/](research/) for the measurements behind it. |
| 🛟 **Quality-safe** | Sonnet floor for tool-using sessions, plus auto-escalation on truncation/refusal and auto-fallback on rate limits. |
| 📊 **Measurable** | Every call reports exact cents saved vs your baseline, with lifetime `stats` and a live dashboard. |
| 💯 **Correct by construction** | Per-tier parameter normalization (so routed requests don't 400) and prompt-cache-aware pricing. |
| 🏠 **Self-hosted & Claude-only** | No third party sees your traffic; tuned specifically for the Haiku/Sonnet/Opus/Fable tiers. |

---

## Quick start

### Claude Code (recommended)

Two commands on **Windows, macOS, or Linux**, no flags, no environment variables:

```bash
npm install -g @smoochy/claude-router
claude-router install
# restart Claude Code — that's it
```

> This fork is published to npm as `@smoochy/claude-router` (pin a release with `@smoochy/claude-router@<version>-smoo.<n>`). Every release also attaches a `.tgz` to its [GitHub Release](https://github.com/smoochy/Claude-router/releases): download it with `gh release download <tag> -D <dir>` and run `npm install -g <dir>/claude-router-<version>-smoo.<n>.tgz`. See [RELEASING.md](RELEASING.md).

> Install **globally** (not via `npx`) when using `install`: login autostart points at the installed CLI, and the `claude-router` command must stay on your PATH for `status` / `stop` / `doctor`.

`install` does the whole setup and verifies each step before reporting it:

- starts the proxy in the background and registers it to start on login (Windows Run key, macOS LaunchAgent, Linux systemd user unit);
- points Claude Code at the proxy through its own `~/.claude/settings.json` `env` block — no shell rc edit, no `setx`, no new terminal;
- saves the defaults to `~/.claude-router/config.json`: `routingMode: "route"` (Claude Code pins a model on every request, so nothing routes otherwise) and `restoreDelegation: true`, an empty `sessionModel` (no pin unless you pass `--session-model`), the current `tiers` ids for your provider and a `routing` block (`aiTimeoutMs: 1500`, `classifyCacheSize: 500`, `allowHaikuInAgentic: true`, `passthroughHaiku: true`); keys already in the file win; `start` and `init` use the same defaults;
- installs the [orchestration plugin](#orchestration-mode-claude-code) (role agents + session policy). The statusline is opt-in: add `--statusline`; an already installed one is never removed by a re-run.

From then on the plugin's session-start hook keeps it honest: if the proxy isn't running it starts it, and every session opens with one line saying `claude-router: enforcing — …` or why not.

Manage it anytime:

```bash
claude-router status    # health, routing stats, install state
claude-router stats     # lifetime savings, dispatch rate, cost by role
claude-router logs -f   # follow the daemon log
claude-router doctor    # diagnose setup problems
claude-router stop      # stop the background proxy
claude-router uninstall # remove everything install added
```

Watch routing live in the logs, or open the dashboard at `http://localhost:4000/dashboard`.

> **Only want a plain proxy for SDK apps?** `claude-router install --api-only` skips the Claude Code profile and plugin and exports `ANTHROPIC_BASE_URL` in your shell instead (add `--shell-env` to a normal install to get both). The routing defaults are the same; add `--routing-mode observe` to let explicit model requests pass through untouched.

### Any app, without installing

**1. Start the proxy** in one terminal:

```bash
npx @smoochy/claude-router start --port 4000 --routing-mode route --verbose
```

**2. Point your app at it** in another:

```bash
# macOS / Linux
export ANTHROPIC_BASE_URL=http://localhost:4000
claude
```

```powershell
# Windows (PowerShell)
$env:ANTHROPIC_BASE_URL = "http://localhost:4000"
claude
```

---

## How it works

For each request the proxy classifies the task, routes to the right tier, calls the API, and returns the response plus `x-router-*` headers:

- **Route** — `model: "auto"` (or omitted) is classified and routed. An explicit model passes through unchanged **unless** `routingMode` is `route` (the default; `--force-route` is an alias). Under `observe` it passes through and is recorded, under `off` it passes through unrecorded.
- **Coordinator pin** *(optional)* — with `--session-model <tier>`, the Claude Code **main session** is pinned to that tier (e.g. `opus` for a large context window and no early compaction) while subagents still route by evidence. It keys off the gateway protocol's `x-claude-code-agent-id` header, which Claude Code sets only on subagent requests — so a request without it is the coordinator. Needs `--routing-mode route` (otherwise the client's pinned model already passes through). See [Pin the coordinator session](#pin-the-coordinator-session).
- **Sonnet by default** — leaving it needs positive evidence. Gates are *conjunctive*, so coincidental keyword matches can't sum into an expensive verdict.
- **Loop-position aware** — a turn answering a `tool_result` is a mid-loop step, and those are largely tier-insensitive. Agentic turns never reach Haiku unless `routing.allowHaikuInAgentic: true`.
- **Auto-retry** — a truncated or refused response escalates one tier and retries.
- **Auto-fallback** — a rate-limited (429) tier falls back to the next tier up.
- **Parameter normalization** — the router owns the model, so it adapts model-coupled params to the chosen tier (otherwise a request built for one model 400s on another). Haiku: strips `thinking` and `output_config.effort`. Sonnet/Opus/Fable: strips `temperature`/`top_p`/`top_k` and converts a fixed `thinking.budget_tokens` to adaptive thinking; Fable additionally rejects *disabled* thinking, so that is dropped too. Your `messages`, `system`, `tools`, and `max_tokens` are never touched.

### Classification modes

| Mode | Overhead | How it decides |
|------|----------|----------------|
| `heuristic` | ~0ms | Conjunctive gates on request shape: tool use, loop position, message count, length, code fences, explicit depth markers. |
| `ai` | one Haiku call (a fraction of a cent) | Asks Haiku to rate task complexity 1–3. |
| `hybrid` *(default)* | 0ms, or one Haiku call | Gates first; asks Haiku only when no gate fired and routing fell through to the default. |

Every decision carries a `reason` (e.g. `agentic:mid-loop`), so routing is auditable. **Fable** is opt-in (`routing.allowFable`). AI classification is resilient by design — results are cached (LRU 500), calls time out at 1.5s, and any failure falls back to the heuristic, so a Haiku outage never blocks a request.

### Pin the coordinator session

Claude Code's main interactive session is your coordinator — it holds the growing plan and delegates work to subagents. If it routes to Sonnet, its 200k context window fills fast and compaction kicks in early. `--session-model opus` keeps that one session on Opus (large window, no early compaction) while everything the router does for **subagents** stays intact:

```bash
claude-router start --session-model opus
# or in ~/.claude-router/config.json:  "sessionModel": "opus"
```

How it tells them apart: Claude Code sets the `x-claude-code-agent-id` header **only** on requests from a subagent it spawned ([gateway protocol](https://code.claude.com/docs/en/llm-gateway-protocol)). A request without it is the coordinator, so it gets pinned (classifier skipped, `x-router-classifier: pinned`); a request with it routes by evidence as usual. To route subagents down to cheaper tiers, give them lower models in their `.claude/agents/*.md` frontmatter — the pin never touches them. Only takes effect under `--routing-mode route`; otherwise the client's explicit model already passes through untouched.

The pin also requires the request to **carry tools**, which every real coordinator turn does. Claude Code's own meta-calls — generating a session title, summarising a conversation — arrive without the agent-id header too, but with no tools and the conversation quoted in `<session>…</session>`. Those keep routing by evidence, so pinning `opus` doesn't pay Opus rates to name a session.

---

## Orchestration mode (Claude Code)

The proxy already sees every request Claude Code makes, so it can do more than pick a model per turn: it can run the whole session as a coordinator on the top tier with role agents carrying the volume on cheaper tiers — and enforce that, and measure it.

```bash
claude-router install --session-model opus
# then restart Claude Code
```

`install` also adds the **orchestration plugin** (skip with `--no-policy`, or manage it alone with `claude-router policy install|status|uninstall`). The plugin ships five role agents and a short session policy:

| Agent | Hand it | Tier |
|---|---|---|
| `claude-router:recon` | read-only lookup: where is X, what calls Y | haiku |
| `claude-router:builder` | one scoped change that needs judgement | sonnet |
| `claude-router:batch` | the same edit across many files, fully specified | sonnet |
| `claude-router:gate` | fresh-context readiness check before risky work (READY / REVISE) | opus |
| `claude-router:audit` | fresh-context attempt to refute finished risky work (CONFIRMED / REFUTED / INCONCLUSIVE) | opus |

What the proxy adds that a prompt-only policy cannot:

- **Enforcement.** Each agent definition opens with a marker (`<!-- claude-router:role=recon -->`); the proxy reads it from the subagent's system prompt and pins the tier, whatever model the client asked for and whatever `CLAUDE_CODE_SUBAGENT_MODEL` says. `--session-model opus` pins the coordinator; `--restore-delegation` removes the injected lines that stop Claude Code from spawning agents at all.
- **A ledger.** Every subagent row in `history.jsonl` carries `role`, and `x-router-role` names the deciding role on the response. `claude-router stats` and the dashboard show what reconnaissance, implementation and review actually cost.
- **Every OS.** The hooks are Node scripts, not shell.

Configure in `~/.claude-router/config.json`:

```jsonc
{
  "sessionModel": "opus",
  "restoreDelegation": true,
  "roleRouting": "on",                          // "off" = classify subagents like any request (A/B baseline)
  "roles": { "builder": "opus" },               // move a role to another tier
  "agents": { "some-plugin:reviewer": "opus" }  // pin third-party agents by Claude Code agent type
}
```

Without a marker, a read-only agent Claude Code already runs on haiku (the built-in Explore) is confirmed at haiku instead of being floored to sonnet; the proxy never demotes an agent from tool shape alone.

**Coming from a prompt-only delegation policy?** Keep it if you like it — the proxy does not care where the instruction to delegate came from. What changes: `--session-model opus` holds the coordinator's tier whatever the client sends, `--restore-delegation` removes the injected lines that stop Claude Code spawning agents at all, and `claude-router stats` tells you the dispatch rate and what each role cost, which a prompt cannot. To pin agents from another plugin by name, map their agent type under `agents`. On SessionStart the plugin prints one line saying whether the proxy is actually enforcing (`claude-router: enforcing — session pinned to opus, subagent roles routed by the proxy`) or, if it is down, that the tiers are advisory. For development: `claude --plugin-dir ./plugin`.

## Configuration

Set defaults once in `~/.claude-router/config.json` instead of passing flags. **CLI flags always override the file.** Scaffold it with `claude-router init --port 4000`; the scaffold already contains `sessionModel`, `tiers` and `routing`, so edit those rather than adding them. The example below shows `allowHaikuInAgentic` and `passthroughHaiku` as `false`, which is what the code does when the keys are absent; the scaffold writes `true`.

```json
{
  "port": 4000,
  "classifier": "hybrid",
  "routingMode": "route",
  "verbose": false,
  "sessionModel": "opus",
  "tiers": {
    "haiku": "claude-haiku-5-5",
    "sonnet": "claude-sonnet-5-5",
    "opus": "claude-opus-5-5"
  },
  "pricing": {
    "claude-opus-5-5": { "input": 4.0, "output": 20.0 }
  },
  "routing": {
    "aiTimeoutMs": 1500,
    "classifyCacheSize": 500,
    "allowHaikuInAgentic": false,
    "passthroughHaiku": false,
    "allowFable": false
  }
}
```

`haikuMax`, `opusMin` and `hybridBand` are accepted but ignored since 0.2.2 — routing is gate-based and there is no score to threshold; the proxy warns once per key. `allowFable` lets classification reach the fable tier (off by default: it is $10/$50 and no measured signal predicts "super hard" from request text).

- **`sessionModel`** — pin the Claude Code coordinator session to a tier (subagents still route). See [Pin the coordinator session](#pin-the-coordinator-session).
- **`tiers`** — override which model ID each tier maps to.
- **`pricing`** — override `$/1M` token rates used for savings math (handy for enterprise/negotiated rates).
- **`routing`** — tune the classifier. `allowHaikuInAgentic: true` lets clearly-trivial tool-using turns reach Haiku (off by default — see the [agentic floor](#how-it-works)). `passthroughHaiku: true` forwards requests that explicitly ask for a haiku model unchanged under `forceRoute` and records them as `passthrough` with a saving of 0, so haiku background calls stay on haiku and still show in the dashboard instead of being booked as extra cost (off by default).

---

## CLI reference

```text
claude-router install [options]     One-time setup: daemon + login autostart + env var + statusline
claude-router uninstall             Remove everything install added
claude-router start [options]       Run the proxy in the foreground
claude-router start -d              Run it in the background (daemon)
claude-router stop                  Stop the background proxy
claude-router restart [options]     Restart the background proxy
claude-router status                Health, routing stats, install state
claude-router stats [--json]        Lifetime savings and per-day breakdown
claude-router logs [-f] [-n N]      Show (or follow) the daemon log
claude-router init [--force] [options]  Scaffold ~/.claude-router/config.json from the given options
claude-router doctor                Diagnose common setup problems
claude-router --version, -V         Print version

Options (install / start / restart / status / doctor):
  --port, -p <number>    Port (default: 4000)
  --host <address>       Bind address (default: 127.0.0.1 — local only)
  --routing-mode <mode>  route (default) | observe (pass through, still record) | off (pass through, record nothing). --force-route is an alias for route
  --restore-delegation <bool>  Strip the injected "do not spawn agents" lines (default: on)
  --role-routing <on|off>  Route subagents by role (default: on)
  --session-model <tier> Pin the Claude Code coordinator session to a tier (haiku|sonnet|opus|fable); subagents still route. Off by default
  --verbose, -v          Log routing decisions
  --classifier <mode>    heuristic | ai | hybrid (default: hybrid)
  --provider <mode>      anthropic | bedrock | vertex (default: anthropic)
  --region <string>      AWS/GCP region

Install-only options:
  --no-autostart         Skip login autostart registration
  --no-env               Skip setting ANTHROPIC_BASE_URL
  --no-policy            Skip the orchestration plugin
  --shell-env            Also export ANTHROPIC_BASE_URL in your shell (for SDK apps)
  --api-only             Plain proxy for API clients: shell env only, no Claude Code profile or plugin
  --statusline           Add the Claude Code statusline (off by default; --no-statusline is accepted and does nothing)
```

**Daemon hung or restarted?** The daemon logs a `[diag]` health line to `proxy.log` every 30 s (event-loop lag, memory, active handles, in-flight requests), so the last one before a gap shows when it stopped and what was open: `claude-router logs -n 200 | grep '\[diag\]'`. On a heap OOM it also writes a `report.*.json` into `~/.claude-router/`; on macOS and Linux `kill -USR2 <pid>` writes one from a live daemon.

**Something not routing?** Run `claude-router doctor` — it checks the Node version, the model-list cache age, stale former-default tier ids, config validity and unknown keys, proxy health on your port, the active routing mode, `ANTHROPIC_BASE_URL`, credentials, stale daemon state, autostart, the statusline and the orchestration plugin, with a fix hint for anything that fails.

---

## Pricing & savings

Each response's `savedCents` is `(baseline cost − actual cost)` for the tokens used, where the baseline is **the model the client asked for** — the counterfactual of "what this request would have cost without the router". Claude Code pins a model on every request (that is what `routingMode: route` overrides), so an opus-pinned request routed to Sonnet books the real opus→sonnet saving, and one the coordinator pin keeps on Opus books exactly `$0.00`. The proxy falls back to `defaultModel` only when the client named nothing usable: no `model` field, `"auto"`, or a model with no pricing entry. **Prompt-cache tokens are included** — reads bill at the model's own rate from the price list (5% of input on Sonnet 5.5 and Opus 5.5, 10% on Haiku 5.5, 2.5% on Fable 5.1) and writes at 125% — so figures stay accurate for cache-heavy clients like Claude Code. Every request is appended to `~/.claude-router/history.jsonl`, so savings survive restarts (`claude-router stats` / the dashboard's *Lifetime Saved* card), except under `routingMode: off`, which records nothing.

`history.jsonl` is append-only by design and never rotated — it *is* the lifetime-savings ledger (~250 bytes/event; a million routed requests ≈ 250 MB). Archive or delete it anytime to start fresh; stats restart from zero. The daemon log (`~/.claude-router/proxy.log`) *does* rotate: past 5 MiB it rolls over to `proxy.log.1` on the next daemon start.

No price is written by hand in the source. Rates come from the generated model and price list: fetched at start, else the last-good local cache (`~/.claude-router/model-list-cache.json`), else the snapshot (`src/pricing-snapshot.json`) built into the release (`npm run pricing:refresh` rewrites it, and the release workflow runs it before packing). Unknown, dated, Bedrock and Vertex IDs are priced by the newest model of their family in the table, so the math stays correct across model launches. The default tiers at the time of writing:

| Model | ID | Input $/1M | Output $/1M |
|-------|-----|-----------:|------------:|
| Claude Fable 5.1 | `claude-fable-5-1` | $10.00 | $50.00 |
| Claude Opus 5.5 | `claude-opus-5-5` | $4.00 | $20.00 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2.00 | $10.00 |
| Claude Haiku 5.5 | `claude-haiku-5-5` | $0.10 | $0.50 |

> **Long-context tier.** A model whose list entry carries a long-context price is billed at that higher rate for the whole request once its prompt (uncached input plus cache reads plus cache writes) is strictly above the threshold. In the current snapshot that is Haiku 5.5: above 100,000 prompt tokens it costs $0.50 / $2.50 per 1M. Override via `pricing` for negotiated or enterprise rates.
>
> **Cache reads are a per-model fraction of the input rate**, taken from the list (`ModelPricing.cacheRead`), not a global constant: 10% on Haiku 5.5, 5% on Sonnet 5.5 and Opus 5.5, 2.5% on Fable 5.1. A model with no list value falls back to 10%. On a cache-heavy client like Claude Code the read line is most of the input bill. Cache writes are 125% everywhere.

Every response also carries the decision as headers:

```text
x-router-tier: haiku
x-router-model: claude-haiku-5-5
x-router-cost-cents: 0.045
x-router-saved-cents: 1.200
x-router-classifier: heuristic
x-router-classifier-ms: 0.1
x-router-confidence: 0.9
x-router-reason: agentic:mid-loop
```

---

## What is measured vs assumed

Every number this project reports is downstream of a few measurements and a few assumptions. Which is which:

| Claim | Status | Evidence |
|---|---|---|
| Mid-loop tool steps are tier-insensitive (Sonnet adequate 75%, zero clear losses); final synthesis is not (Opus won 10 of 11) | **Measured** | [tier ceiling](research/2026-07-21-tier-ceiling.md), 23 real turns, blind-judged |
| Escalation triggers (truncation, refusal) never fire on real traffic | **Measured** | [detector measurement](research/2026-07-21-detector-measurement.md), 0 of 35,314 responses |
| 21% saved on one live Claude Code session | **Measured**, n=1 | [live session](research/2026-07-25-live-session.md) |
| 35% on agentic coding traffic | **Upper bound**, replay on a stub upstream, tokens held constant | [end-to-end savings](research/2026-07-21-end-to-end-savings.md) |
| The single-turn haiku gate (short mechanical transforms) | **Unmeasured**, deliberately conservative | [failed experiment](research/2026-07-21-single-turn-failed.md) |
| Fable promotion signals (depth + long horizon) | **Assumed** — nothing measured predicts "super hard" from text | off by default |
| Bedrock / Vertex 5.5 inference-profile IDs | **Documented**, not checked against a live console | [providers](docs/providers.md) |
| Orchestration mode saves money over classifying subagents | **Unmeasured** — that is what `--role-routing off` and `stats` exist to compare | [sandbox](sandbox/README.md) |

The standing caveats are in [research/README.md](research/README.md#standing-caveats).

---

## Other providers and library use

- [Other providers](https://github.com/smoochy/Claude-router/blob/smoo/main/docs/providers.md): AWS Bedrock and Google Vertex AI, and the Fable caveat there.
- [Use as a library](https://github.com/smoochy/Claude-router/blob/smoo/main/docs/library.md): route inside your own app with `createRouter` instead of running a proxy.

---

## Authentication & security

The proxy forwards whatever credentials your app already sends — no extra config:

| Method | Header | Use case |
|--------|--------|----------|
| API key | `x-api-key: sk-ant-...` | Anthropic API (pay-per-token) |
| Bearer token | `Authorization: Bearer <token>` | Claude Code / subscription auth |
| Env vars | — | AWS Bedrock, Google Vertex AI |

> **Security.** The proxy binds to `127.0.0.1` by default — only your own machine can reach it. If you pass `--host 0.0.0.0` to share it on a network, note that with the `bedrock`/`vertex` providers it calls out with **your** cloud credentials and does not authenticate incoming requests.

---

## Contributing

Contributions welcome! See **[CONTRIBUTING.md](CONTRIBUTING.md)** to go from clone to merged PR — the short version is `npm install && npm test`, branch, add a test, open a PR. `master` is protected: changes merge by squash after review and green CI. For security reports, see **[SECURITY.md](SECURITY.md)**.

## License

[MIT](LICENSE)
