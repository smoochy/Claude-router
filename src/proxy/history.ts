import fs from 'node:fs';
import path from 'node:path';
import { emptyTotals, foldOutcome, type RouteTotals } from '../totals.js';
import type { RouteEvent } from './route-event.js';

/**
 * Persistent route history: one JSON line per event, append-only.
 * Powers `claude-router stats` and the dashboard's lifetime figures.
 *
 * Deliberately never rotated: this file IS the lifetime-savings ledger, and
 * rotating it would delete the product's headline number. At ~250 bytes/event,
 * 1M routed requests ≈ 250 MB — years of heavy use. Users may archive or
 * delete it at any time; the offset cache below self-invalidates on shrink and
 * totals restart from zero. Writes assume a single writer — the daemon's
 * pre-start health check enforces one proxy per port.
 */

const HISTORY_SIZE_NUDGE_BYTES = 100 * 1024 * 1024;
// One stat + at most one warn per process — keeps the append hot path free of
// per-event size checks. Growth past the threshold mid-run is caught on the
// next daemon start.
let checkedHistorySize = false;

export function appendEvent(file: string, event: RouteEvent): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (!checkedHistorySize) {
      checkedHistorySize = true;
      try {
        if (fs.statSync(file).size > HISTORY_SIZE_NUDGE_BYTES) {
          console.warn(
            `[claude-router] ${file} is over 100 MB. It is append-only by design (it holds your lifetime savings); ` +
              `archive or delete it to start fresh — stats will restart from zero.`,
          );
        }
      } catch {
        // No file yet — nothing to nudge about.
      }
    }
    // The ledger holds token counts, model IDs and timestamps of the operator's
    // work; owner-only like the config dir. `mode` applies on creation.
    fs.appendFileSync(file, JSON.stringify(event) + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch {
    // History is best-effort — never let persistence break a request.
  }
}

export const HISTORY_TAIL_LINES = 2000;

/**
 * The last `maxLines` events of the ledger, oldest first. Reads backwards in
 * chunks from the end, so cost is bounded by the tail, not by the (never
 * rotated, ~200k line) file. A partial first line and corrupt lines are skipped.
 */
export function readHistoryTail(file: string, maxLines: number = HISTORY_TAIL_LINES): RouteEvent[] {
  const CHUNK = 256 * 1024;
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    let pos = fs.fstatSync(fd).size;
    const parts: Buffer[] = [];
    let newlines = 0;
    while (pos > 0 && newlines <= maxLines) {
      const len = Math.min(CHUNK, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      for (const b of buf) if (b === 0x0a) newlines++;
      parts.unshift(buf);
    }
    const lines = Buffer.concat(parts).toString('utf8').split('\n');
    // Unless we reached the file start, the first line is cut mid-way.
    if (pos > 0) lines.shift();
    const events: RouteEvent[] = [];
    for (const line of lines.slice(-maxLines - 1)) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as RouteEvent;
        if (typeof e?.timestamp === 'string' && typeof e.costCents === 'number') events.push(e);
      } catch {
        // skip corrupt lines
      }
    }
    return events.slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Lifetime figures are just accumulated {@link RouteTotals}. */
export type LifetimeStats = RouteTotals;

// Parsing and corrupt-line rejection are this module's concern (they belong to
// the file seam); the numeric folding is shared via foldOutcome.
function foldLine(stats: LifetimeStats, line: string): void {
  let event: RouteEvent;
  try {
    event = JSON.parse(line) as RouteEvent;
  } catch {
    return; // skip corrupt lines rather than losing the whole history
  }
  if (typeof event?.costCents !== 'number') return;
  foldOutcome(stats, event);
}

// Incremental cache: the file is append-only, so once a prefix is folded we
// only ever need to read the newly-appended bytes.
let cached: { file: string; offset: number; stats: LifetimeStats } | null = null;

/** @internal Test hook */
export function resetHistoryCache(): void {
  cached = null;
}

export function readLifetimeStats(file: string): LifetimeStats {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return emptyTotals();
  }

  if (!cached || cached.file !== file || size < cached.offset) {
    cached = { file, offset: 0, stats: emptyTotals() };
  }
  if (size === cached.offset) return cached.stats;

  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - cached.offset);
      fs.readSync(fd, buf, 0, buf.length, cached.offset);
      const text = buf.toString('utf8');
      // Only fold complete lines; keep the offset at the last newline so a
      // partially-written trailing line is picked up next read.
      const lastNewline = text.lastIndexOf('\n');
      if (lastNewline >= 0) {
        for (const line of text.slice(0, lastNewline).split('\n')) {
          if (line.trim()) foldLine(cached.stats, line);
        }
        cached.offset += lastNewline + 1;
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Unreadable — serve what we have
  }
  return cached.stats;
}
