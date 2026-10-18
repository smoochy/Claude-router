# Soak harness

Proves the daemon stays up: a real `claude-router` daemon runs on its own port with an isolated `HOME` against a stub upstream, while the harness replays a `history.jsonl`-shaped load, makes the upstream kill a connection mid-stream on a timer (the `UND_ERR_SOCKET` case), forces one hang of the daemon with the port still bound, and replaces it with `claude-router start -d`. The verdict comes from the daemon's own `[diag]` lines in `proxy.log`.

```
npm run build
node scripts/soak/soak.mjs --duration 24h
```

Smoke test (about 2.5 minutes, same code path, the heap-growth check is skipped because the span is under an hour):

```
node scripts/soak/soak.mjs --duration 150s --hang-at 50s --abort-every 10s --rps 3
```

Options are listed by `node scripts/soak/soak.mjs --help`. Use `--history ~/.claude-router/history.jsonl` to replay recorded token counts instead of the synthetic mix. The harness never touches port 4000 or your real `~/.claude-router`; it prints the temp home it used, including `proxy.log` and `soak-report.json`.

## Pass criteria

| Check | Limit |
| --- | --- |
| Unplanned restarts | 0 (a changed pid in `daemon.json` that the harness did not cause) |
| Heap used | max under 1024 MB |
| Heap growth | under 10 MB/h by least squares, per stretch between planned restarts, first 10 min of each stretch dropped, skipped for stretches under 1 h |
| Event-loop lag p99 | max sample under 200 ms |
| Forced hang | `start -d` returns a healthy daemon within 10 s, and the pid changed |

Exit code 0 on pass, 1 on fail, 2 on a harness error.

## How the faults work

- **Upstream abort**: the stub writes the SSE head, then destroys the socket 50 ms later. The Anthropic SDK retries it, so the client usually still gets a 200; the proof that it reached the daemon is the stub's abort counter and any `upstream connection error` line in `proxy.log`.
- **Hang**: the daemon is started with `NODE_OPTIONS=--require scripts/soak/hang-preload.cjs`. When the harness creates the flag file, the daemon spins forever in its event loop, so `/health` goes silent while the port stays bound. This works on Windows, where `SIGSTOP` does not exist.
- **Replacement**: the harness calls `claude-router start -d` and times it until `/health` answers; `replaceHungDaemon` needs 5 s of silence before it signals the old pid, so a healthy result is normally 6 to 9 s.

`analyze.mjs` holds the parsing and the verdict and is unit tested (`src/__tests__/soak-analyze.test.ts`).
