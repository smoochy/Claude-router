# Claude-router 0.4.1 vs v0.4.0-smoo.10: what carries over

Research for smooCorp/homelab-private#5887 (map #5397). Method: `git log v0.4.0..v0.4.0-smoo.10 --no-merges`, `git diff v0.4.0-smoo.10 v0.4.1` per file, `git cherry`, and a trial `git merge v0.4.1` in a throwaway worktree (removed afterwards).

## Upstream v0.4.0..v0.4.1

Two commits only: 3eb63bb "Port security and stability fixes from smoochy's fork (#80)" (21 files, +831/-184) and fd2e23a "chore(release): 0.4.1 (#81)". Upstream ported our fork patches as one squash, so `git cherry v0.4.1 v0.4.0-smoo.10` marks every smoo commit as "+" (patch-ids never match). Cherry is useless here; the byte-level diff is the real comparison. Upstream package name is still `@sheruq/claude-router`, and v0.4.0 never reached npm (OIDC publish failed), so 0.4.1 carries the same risk.

## Patch table

| smoo patch | Upstream 0.4.1 | Verdict |
| --- | --- | --- |
| 626fd167 localGuard (Host/Origin/Sec-Fetch-Site, 415 JSON-only) | equal (`src/proxy/local-guard.ts` byte-identical) | drop, comes with base |
| 4c208f9 POST /v1/messages guard test | absent | carry over, conflicts in `src/__tests__/proxy.test.ts` (keep smoo) |
| 4f16828 survive unhandled upstream stream error | equal in behaviour, different text | carry over only one copy: textual merge is clean but `tsc` fails with duplicate `UPSTREAM_TRANSPORT_ERROR` and `installUncaughtGuard` in `src/proxy/cli.ts`; drop one copy |
| 1431539 memory bounds (body cap, SSE partial line, async dashboard fold) | equal (`memory-bounds.test.ts` identical) | drop, comes with base |
| fe65c6b history bounded chunks | equal | drop, comes with base |
| 659ee31 abort upstream on stream cancel | equal | drop, comes with base |
| b556bb4 restart drops stale daemon.json flags | equal | drop, comes with base |
| 24d545e plugin hooks find router in chained ANTHROPIC_BASE_URL | equal (`plugin/hooks/common.js`, `subagent-start.js` identical) | drop, comes with base |
| 2394976 DEP0190, 1685e79 winCmdLine hardening, 1bfa2d9 claude.exe/.cmd fallback | equal | drop, comes with base |
| hono, @hono/node-server, fast-xml-parser bumps (13a0561, 7bf6ed5, c1619ad) | different: upstream is newer (hono ^4.13.21, node-server ^2.1.11) | take upstream versions |
| 26705a8 options object for log()/setRouterHeaders | absent | carry over |
| abb31ea session id CWE-22 validation | absent | carry over |
| 97378d0 hang forensics, c4f2bba start -d replaces hung daemon, 2d335d1 signals log, soak harness 9ed8b80 | absent | carry over |
| `sessionstart.js` health wait loop 45 vs 20 iterations | different (upstream 20) | carry over smoo value (needed by hung-daemon replace) |
| 313e15a plugin hook fail-guard and marketplace autoUpdate, `policy.ts` `MARKETPLACE_SOURCE` = `smoochy/Claude-router` | different (upstream `serhiileniv/claude-router`) | carry over, fork identity |
| `history.ts` readHistoryTail (dashboard scope=all), dashboard filters, GET / redirect | absent | carry over |
| routingMode, models, pricing, passthroughHaiku, requestedModel | absent | carry over |
| 95c3f5f vertex-sdk bump, @anthropic-ai/sdk ^0.133.0 | different (upstream sdk ^0.39.0) | keep smoo |
| 70c77eb lockfile funding strip, managed workflow/sync files, overrides.yaml sync 70b6db0 | absent | carry over (lockfile regenerated) |
| dc0af32 and earlier release commits | n/a | not carried, new tag scheme `v0.4.1-smoo.1` |

## Trial merge conflicts (`git merge --no-commit --no-ff v0.4.1` on smoo.10)

Seven conflicted files, all mechanical:

- `package.json`: name (`@smoochy` vs `@sheruq`), version, description keep smoo; hono and @hono/node-server take upstream; sdk keep smoo.
- `package-lock.json`: 9 hunks, regenerate with `npm install`.
- `plugin/.claude-plugin/plugin.json`: version only.
- `CHANGELOG.md`: one hunk, merge both sections.
- `src/proxy/server.ts`: 3 hunks (import line, guard/health ordering, dashboard route), take smoo side.
- `src/proxy/handler.ts`: 1 hunk near line 784 (`errorRouteEvent` with `requestedModel`), take smoo.
- `src/__tests__/proxy.test.ts`: 1 hunk near line 220, keep smoo test.

Everything else auto-merged. Silent semantic break after resolving: `npx tsc --noEmit` fails in `src/proxy/cli.ts` (310, 318, 352, 360): duplicate `UPSTREAM_TRANSPORT_ERROR` and `installUncaughtGuard`. Fix: delete one copy. The test suite was not reached because `npm test` builds first.

## Open requirements in map #5397 touching Claude-router

Open sub-issues: #5840 "[T] Layout check of the first auto-generated release PR" and #5887 itself.

- #5840 (open): first auto-generated release PR layout check for Claude-router; E2E from #5538 produced "manual release needed" on feat PR Claude-router#124 and no release PR.
- #5534: release notes in Keep a Changelog layout; Claude-router needs a changelog section the generator can read.
- #5509: release PRs bump `plugin.json`, need a non-empty CHANGELOG section, and refuse when the last tag is not an ancestor of HEAD. With base v0.4.1 the first tag `v0.4.1-smoo.1` must keep the ancestry rule satisfied (merge, not rebase, or retag deliberately).
- #5504, #5508, #5531: fleet-release-on-fix and release guard are verified (Claude-router#121 gave v0.4.0-smoo.9), no open work.
- Out of scope: hand-backfilling the v0.4.0-smoo.9 release body.

## Recommendation

Merge `v0.4.1` into the fork rather than rebase (keeps tag ancestry for #5509), resolve the seven files as above, remove the duplicate guard in `cli.ts`, run `npm test`, tag `v0.4.1-smoo.1`.
