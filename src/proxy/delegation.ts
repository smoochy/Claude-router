import fs from 'node:fs';
import path from 'node:path';

/**
 * Restore subagent delegation that the client's own system prompt suppresses.
 *
 * WHY THIS EXISTS
 * Claude Code 2.1.219+ injects a system-prompt section (registered internally as
 * `heron_brook`, applied under the event name `tengu_brook_heron_applied`) whose
 * default payload tells the model not to spawn subagents unless explicitly asked.
 * Verified against the shipped 2.1.220 binary: the section is gated on a *model
 * capability*, not on user config —
 *
 *     if (NN(lo(e), "opus_5_prompt_bundle") !== true) return false;
 *     return !Ke("tengu_fennel_godwit", false)      // killswitch, defaults false
 *
 * — and of every `capabilities:[…]` array in that binary exactly one carries
 * `opus_5_prompt_bundle`: `claude-opus-5`. So selecting Opus 5 silently turns
 * delegation off, and there is no settings key, CLI flag or env var to turn it
 * back on (anthropics/claude-code#80988).
 *
 * WHY THE ROUTER CARES
 * `sessionModel` pins the coordinator to one tier so *subagents* carry the
 * volume on cheaper tiers. With delegation suppressed no subagent requests are
 * ever made, so the pinned tier does every turn itself and the pin costs more
 * than not pinning. Worse, the loss cannot be recovered by routing: a Claude Code
 * coordinator carries a large cached prefix, prompt caches are model-scoped, and
 * a cache read bills at 10% of input against 125% for a cold write — so moving a
 * ~110K-token prefix to a cheaper tier costs several times what the cheaper tier
 * saves. Delegation into fresh, small subagent contexts is the only lever that
 * actually lowers the bill, which is exactly what the injection removes.
 *
 * WHY IT IS OPT-IN AND NARROW
 * This is the one place the proxy edits a prompt, so the rule stays the tightest
 * one that can still work. Each known payload line is matched **per line, after
 * trimming** — never as a substring scan over the whole prompt, so content that
 * merely quotes the delimiter inside a sentence survives untouched (the failure
 * mode `latestUserText` already documents for `<system-reminder>`).
 *
 * Refreshed for #4304: the vendor reworded both lines (anthropics/claude-code,
 * undated) and the fork's original whole-line-**exact** match could never survive
 * it — the current combined line interpolates a tool name
 * (`` `Do not use the ${tool} tool, workflows, or deep-research unless the user,
 * a CLAUDE.md file, or a skill asks for it` ``), so no fixed string equals it under
 * any wording. Matching moved to prefix (the short AgentTool line, whose only
 * observed change so far is where the sentence stops) and anchored regex (the
 * combined line, whose only stable shape is "starts with this, ends with that").
 * Both are still whole-line matchers — anchored at `^` and `$` — not a general
 * substring rule, so the narrowness the original design wanted is kept; only the
 * equality test got looser.
 *
 * Deliberate choice on the new exception clause (`unless the user, a CLAUDE.md
 * file, or a skill asks for it`): it is matched and removed as part of the line,
 * not left behind. `restoreDelegation` is opt-in and exists specifically so a
 * pinned coordinator can delegate unconditionally — leaving the vendor's narrower
 * permission in place would still block delegation on every turn that has no
 * CLAUDE.md or skill asking for it, which is most turns, and would silently
 * undercut the saving #4234 measured (0.132 vs 0.171 $/1k combined output). A
 * user who does not want that keeps `restoreDelegation` off.
 *
 * If the vendor rewrites the payload again, this stops matching and removes
 * nothing rather than damaging the prompt — `describeStrip` reports that per
 * process, and `noteDelegationStrip`/`doctor` escalate it across a run of starts
 * (see {@link STALE_PATTERN_STREAK}) instead of letting a silent miss look like
 * normal operation, which is how the previous drift went unnoticed.
 *
 * Removal is deterministic — the same input always yields the same output — so
 * the edited prefix pays one cache write and is warm from the second request on.
 */

/**
 * Today's concrete lines, verbatim/representative from the current Claude Code
 * binary (`${tool}` stands in for whatever tool name it interpolates — the
 * matcher below doesn't care which). Kept as plain strings for fixtures and
 * docs; the actual match logic is {@link isDelegationBlockerLine}, not a Set
 * lookup against this array.
 */
export const DELEGATION_BLOCKERS: readonly string[] = [
  'Do not call the AgentTool unless the user',
  'Do not use the Task tool, workflows, or deep-research unless the user, a CLAUDE.md file, or a skill asks for it',
];

export interface StripResult {
  /** The system field with blocker lines removed. Same reference when nothing matched. */
  system: unknown;
  /** How many lines were removed. 0 means the payload was not present. */
  removed: number;
}

// Unconditional short line. A prefix match survives the suffix moving again —
// it already moved once (`…unless the user requested it` -> `…unless the user`).
const AGENT_TOOL_PREFIX = 'Do not call the AgentTool unless the user';

// Combined line: the fork's old two-line form was merged into one sentence with
// an interpolated tool name, so no fixed string can equal it under any wording.
// Anchored start-to-end so this stays a whole-line matcher, not a substring scan;
// `.+` stands in for the interpolated tool, and the exception clause is optional
// in the pattern (but see the module doc above: when present, it is stripped too).
const COMBINED_LINE = /^Do not use the .+ tool, workflows, or deep-research unless the user(?:, a CLAUDE\.md file, or a skill)? asks? for it\.?$/;

/** Does this already-trimmed line match a known anti-delegation payload line? */
function isDelegationBlockerLine(line: string): boolean {
  return line.startsWith(AGENT_TOOL_PREFIX) || COMBINED_LINE.test(line);
}

/**
 * Remove whole lines that match a known blocker. Returns null if none did. The
 * count comes from the filter itself, never from re-splitting the result:
 * `''.split('\n')` has length 1, so differencing line counts undercounts by one
 * whenever every line is removed.
 */
function stripText(text: string): { text: string; removed: number } | null {
  if (!text.includes('Do not ')) return null; // cheap reject for the common case
  let removed = 0;
  const kept = text.split('\n').filter((line) => {
    if (!isDelegationBlockerLine(line.trim())) return true;
    removed++;
    return false;
  });
  return removed === 0 ? null : { text: kept.join('\n'), removed };
}

/**
 * Strip the injected anti-delegation lines from an Anthropic `system` field.
 *
 * Handles both shapes the API accepts: a bare string, or an array of content
 * blocks. A text block left empty (or whitespace-only) after the removal is
 * dropped, so we never forward a block the API would reject. `messages`,
 * `tools` and every other field are untouched — this function only ever sees
 * `system`.
 */
export function stripDelegationBlockers(system: unknown): StripResult {
  if (typeof system === 'string') {
    const stripped = stripText(system);
    return stripped === null ? { system, removed: 0 } : { system: stripped.text, removed: stripped.removed };
  }

  if (Array.isArray(system)) {
    let removed = 0;
    const out: unknown[] = [];
    for (const block of system) {
      if (
        block !== null &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        const stripped = stripText((block as { text: string }).text);
        if (stripped !== null) {
          removed += stripped.removed;
          if (stripped.text.trim() === '') continue; // block is now empty — drop it
          out.push({ ...(block as object), text: stripped.text });
          continue;
        }
      }
      out.push(block);
    }
    return removed > 0 ? { system: out, removed } : { system, removed: 0 };
  }

  return { system, removed: 0 };
}

/**
 * One-line operator-facing summary. The negative case matters as much as the
 * positive one: "enabled but matched nothing" is how a vendor payload change
 * surfaces, and it must not look like success.
 */
export function describeStrip(removed: number): string {
  return removed > 0
    ? `restored delegation — removed ${removed} injected anti-delegation line${removed === 1 ? '' : 's'} from system`
    : 'restore-delegation is on but the known injected lines were not present (nothing removed)';
}

/**
 * Persisted across process restarts (small JSON file under `~/.claude-router/`,
 * see `RouterPaths.delegationDriftFile`) because the signal that matters is a
 * *trend*, not one process's single sample: a fresh install, or a start that
 * happens to see only meta-calls, legitimately matches nothing once.
 */
export interface DelegationDriftState {
  /** Consecutive process starts, with `restoreDelegation` on, that saw at
   * least one tool-bearing request and matched nothing. Resets to 0 the
   * moment any start strips something. */
  consecutiveMisses: number;
}

/**
 * Past this many consecutive misses, a neutral "nothing removed" stops being
 * a plausible fluke and becomes a probable stale pattern set — the drift this
 * ticket exists to make loud instead of silent. One start proves nothing
 * (see {@link DelegationDriftState}); three in a row is a trend worth a
 * warning rather than a per-start reset of hope.
 */
export const STALE_PATTERN_STREAK = 3;

const EMPTY_DRIFT_STATE: DelegationDriftState = { consecutiveMisses: 0 };

/** Read the persisted streak. Missing or unreadable file reads as "no streak
 * yet" rather than failing the start over a diagnostic. */
export function readDelegationDriftState(filePath: string): DelegationDriftState {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<DelegationDriftState>;
    return { consecutiveMisses: typeof parsed.consecutiveMisses === 'number' ? parsed.consecutiveMisses : 0 };
  } catch {
    return EMPTY_DRIFT_STATE;
  }
}

/** Persist the streak. Best-effort: a failed write just means the next start
 * recomputes from 0, which is the same "stay quiet until proven otherwise"
 * bias the read side already has. */
export function writeDelegationDriftState(filePath: string, state: DelegationDriftState): void {
  try {
    // Same convention as daemon.ts's writeDaemonState: the directory may not
    // exist yet on a first `start` with no prior `init`.
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // best-effort — see doc comment above
  }
}

/**
 * Pure decision: given the persisted streak and whether *this* run's
 * tool-bearing request matched anything, what the next streak is and whether
 * it has crossed {@link STALE_PATTERN_STREAK}. Kept separate from the disk I/O
 * above so the threshold logic is testable without a filesystem.
 */
export function nextDriftState(
  previous: DelegationDriftState,
  matchedThisRun: boolean,
): { state: DelegationDriftState; stale: boolean } {
  const consecutiveMisses = matchedThisRun ? 0 : previous.consecutiveMisses + 1;
  return { state: { consecutiveMisses }, stale: consecutiveMisses >= STALE_PATTERN_STREAK };
}
