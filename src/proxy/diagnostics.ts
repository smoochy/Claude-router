import v8 from 'node:v8';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Server } from 'node:http';

/** Requests open longer than this get listed individually in each sample. */
const SLOW_INFLIGHT_MS = 30_000;
const MB = 1024 * 1024;

export interface InflightSnapshot {
  count: number;
  /** Longest-running first, capped at the `limit` passed to `snapshot`. */
  oldest: { label: string; ageMs: number }[];
}

export interface InflightTracker {
  /** Register a request; call the returned function once it finished. */
  begin(label: string): () => void;
  snapshot(limit?: number): InflightSnapshot;
}

export function createInflightTracker(now: () => number = Date.now): InflightTracker {
  const open = new Map<number, { label: string; startedAt: number }>();
  let seq = 0;
  return {
    begin(label) {
      const id = seq++;
      open.set(id, { label, startedAt: now() });
      return () => { open.delete(id); };
    },
    snapshot(limit = 20) {
      const t = now();
      const oldest = [...open.values()]
        .map((r) => ({ label: r.label, ageMs: t - r.startedAt }))
        .sort((a, b) => b.ageMs - a.ageMs)
        .slice(0, limit);
      return { count: open.size, oldest };
    },
  };
}

/** Track every request on the node server until its response closes (covers long SSE streams). */
export function attachInflight(server: Pick<Server, 'on'>, tracker: InflightTracker): void {
  server.on('request', (req: { method?: string; url?: string }, res: { once(e: 'close', cb: () => void): unknown }) => {
    const done = tracker.begin(`${req.method ?? '?'} ${(req.url ?? '').split('?')[0]}`);
    res.once('close', done);
  });
}

export interface Sample {
  at: string;
  lagP99Ms: number;
  lagMaxMs: number;
  rssMb: number;
  heapUsedMb: number;
  heapLimitMb: number;
  handles: Record<string, number>;
  inflight: number;
  oldestInflightMs: number;
}

export function formatSample(s: Sample): string {
  const handles = Object.entries(s.handles).map(([k, n]) => `${k}:${n}`).join(',') || 'none';
  return `[diag] ${s.at} lag_p99=${s.lagP99Ms.toFixed(1)}ms lag_max=${s.lagMaxMs.toFixed(1)}ms rss=${s.rssMb}MB heap=${s.heapUsedMb}/${s.heapLimitMb}MB handles=${handles} inflight=${s.inflight} oldest=${Math.round(s.oldestInflightMs / 1000)}s`;
}

export interface DiagnosticsOptions {
  intervalMs?: number;
  /** proxy.log is the daemon's stdout/stderr, so console.log lands there. */
  log?: (line: string) => void;
  tracker: InflightTracker;
}

/**
 * Periodic one-line health sample (event-loop lag, memory, active handles,
 * in-flight requests). A hung loop stops the samples, so the last `[diag]`
 * timestamp in proxy.log brackets when the hang began, and the sample before it
 * shows what was open and how big the heap was.
 */
export function startDiagnostics(opts: DiagnosticsOptions): { stop(): void } {
  const log = opts.log ?? ((l: string) => console.log(l));
  const hist = monitorEventLoopDelay({ resolution: 10 });
  hist.enable();
  const timer = setInterval(() => {
    const mem = process.memoryUsage();
    const handles: Record<string, number> = {};
    for (const name of process.getActiveResourcesInfo()) handles[name] = (handles[name] ?? 0) + 1;
    const snap = opts.tracker.snapshot();
    log(formatSample({
      at: new Date().toISOString(),
      lagP99Ms: hist.percentile(99) / 1e6,
      lagMaxMs: hist.max / 1e6,
      rssMb: Math.round(mem.rss / MB),
      heapUsedMb: Math.round(mem.heapUsed / MB),
      heapLimitMb: Math.round(v8.getHeapStatistics().heap_size_limit / MB),
      handles,
      inflight: snap.count,
      oldestInflightMs: snap.oldest[0]?.ageMs ?? 0,
    }));
    for (const r of snap.oldest) {
      if (r.ageMs >= SLOW_INFLIGHT_MS) log(`[diag] inflight ${r.label} age=${Math.round(r.ageMs / 1000)}s`);
    }
    hist.reset();
  }, opts.intervalMs ?? 30_000);
  timer.unref();
  return { stop() { clearInterval(timer); hist.disable(); } };
}

/**
 * Diagnostic reports (JSON: native + JS stacks, handles, heap) land in `dir`.
 * Written automatically on a fatal error such as the heap OOM, and on SIGUSR2
 * (POSIX only, Windows has no such signal) so a hung daemon can be dumped with
 * `kill -USR2 <pid>`.
 */
export function installCrashReports(dir: string, proc: NodeJS.Process = process): void {
  try {
    proc.report.directory = dir;
    proc.report.reportOnFatalError = true;
    if (proc.platform !== 'win32') {
      proc.report.signal = 'SIGUSR2';
      proc.report.reportOnSignal = true;
    }
  } catch {
    // diagnostics must never block startup
  }
}

/**
 * A daemon killed by a signal or a console close used to vanish from proxy.log
 * without a line. Handling SIGHUP/SIGBREAK replaces Node's silent default exit,
 * so the handler exits itself (128+signal number). A Windows TerminateProcess
 * runs no handler at all; the absence of an `exit` line is then the evidence.
 */
export function installExitLog(
  log: (line: string) => void = console.log,
  proc: NodeJS.Process = process,
  exit: (code: number) => void = (c) => proc.exit(c),
): void {
  const codes: Record<string, number> = { SIGHUP: 129, SIGBREAK: 149 };
  for (const sig of ['SIGHUP', 'SIGBREAK'] as const) {
    try {
      proc.on(sig, () => {
        log(`[exit] ${new Date().toISOString()} received ${sig}`);
        exit(codes[sig]!);
      });
    } catch {
      // signal not supported on this platform
    }
  }
  proc.on('exit', (code) => log(`[exit] ${new Date().toISOString()} exit code=${code}`));
}
