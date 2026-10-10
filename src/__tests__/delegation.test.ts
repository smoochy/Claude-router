import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DELEGATION_BLOCKERS,
  stripDelegationBlockers,
  describeStrip,
  STALE_PATTERN_STREAK,
  nextDriftState,
  readDelegationDriftState,
  writeDelegationDriftState,
} from '../proxy/delegation.js';

const [AGENT_LINE, WORKFLOW_LINE] = DELEGATION_BLOCKERS as [string, string];

// The two shapes Claude Code actually renders as of the current binary. The
// AgentTool line's suffix has already moved once (`…unless the user requested
// it` -> `…unless the user`); the workflow line interpolates whichever tool
// is live and carries a new exception clause the fork's original two lines
// never had. Binary-derived (see #4304's resolution comment on #4300) —
// not captured off a live request. A real capture is a follow-up (the capture
// path this ticket adds has no fixture to run it against yet).
const AGENT_TOOL_TASK_VARIANT = 'Do not use the Task tool, workflows, or deep-research unless the user, a CLAUDE.md file, or a skill asks for it';
const AGENT_TOOL_BASH_VARIANT = 'Do not use the Bash tool, workflows, or deep-research unless the user, a CLAUDE.md file, or a skill asks for it';

// The wording the fork originally shipped against — must never match again,
// so the two shapes (pre- and post-rewording) cannot be silently confused.
const OLD_AGENT_LINE = 'Do not call the AgentTool unless the user requested it';
const OLD_WORKFLOW_LINE = 'Do not use workflows or deep-research unless the user requested it';

// The payload as Claude Code actually renders it: lines at the end of a long
// system prompt, not a standalone block.
const REAL_SYSTEM = [
  'You are Claude Code, Anthropic official CLI for Claude.',
  '',
  '# Delivering work',
  'Do ordinary work as asked, acting on the actual request.',
  '',
  AGENT_LINE,
  WORKFLOW_LINE,
].join('\n');

describe('stripDelegationBlockers — string system', () => {
  it('removes both injected lines and keeps everything else byte-identical', () => {
    const { system, removed } = stripDelegationBlockers(REAL_SYSTEM);
    assert.equal(removed, 2);
    assert.equal(
      system,
      [
        'You are Claude Code, Anthropic official CLI for Claude.',
        '',
        '# Delivering work',
        'Do ordinary work as asked, acting on the actual request.',
        '',
      ].join('\n'),
    );
  });

  it('is deterministic — the same input always yields the same output (cache stability)', () => {
    const a = stripDelegationBlockers(REAL_SYSTEM).system;
    const b = stripDelegationBlockers(REAL_SYSTEM).system;
    assert.equal(a, b);
  });

  it('returns the original reference untouched when the payload is absent', () => {
    const clean = 'You are a helpful assistant.';
    const { system, removed } = stripDelegationBlockers(clean);
    assert.equal(removed, 0);
    assert.equal(system, clean);
  });

  it('tolerates surrounding indentation on the injected line', () => {
    const { removed } = stripDelegationBlockers(`intro\n   ${AGENT_LINE}   \noutro`);
    assert.equal(removed, 1);
  });

  it('matches the combined line regardless of which tool name it interpolates', () => {
    assert.equal(stripDelegationBlockers(`intro\n${AGENT_TOOL_TASK_VARIANT}\noutro`).removed, 1);
    assert.equal(stripDelegationBlockers(`intro\n${AGENT_TOOL_BASH_VARIANT}\noutro`).removed, 1);
  });

  it('strips the combined line in full, including its new exception clause', () => {
    const { system } = stripDelegationBlockers(`intro\n${AGENT_TOOL_TASK_VARIANT}\noutro`);
    assert.equal(system, 'intro\noutro', 'the exception clause must not survive as a dangling fragment');
  });

  // The regression this ticket exists to prevent: the two shapes must never be
  // confused with each other. The AgentTool line is a prefix match on purpose
  // (see delegation.ts's module doc) — its suffix already moved once, so the
  // fully-suffixed pre-rewording text still matches, which is expected, not a
  // leak. The old *workflow* line is a fundamentally different sentence (no
  // "the <tool> tool," clause at all), so the new anchored regex correctly
  // does not match it — asserting that is what keeps the two generations from
  // being silently confused.
  it('still matches the old AgentTool suffix (prefix is suffix-agnostic on purpose)', () => {
    assert.equal(stripDelegationBlockers(OLD_AGENT_LINE).removed, 1);
  });

  it('does not match the old standalone workflow line — it is a different sentence, not an older wording of the same one', () => {
    assert.equal(stripDelegationBlockers(OLD_WORKFLOW_LINE).removed, 0);
    assert.equal(
      stripDelegationBlockers([OLD_AGENT_LINE, OLD_WORKFLOW_LINE].join('\n')).removed,
      1,
      'only the AgentTool line matches; the retired standalone workflow line does not',
    );
  });
});

describe('stripDelegationBlockers — block-array system', () => {
  it('edits only the block that carries the payload', () => {
    const system = [
      { type: 'text', text: 'stable preamble', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `guidance\n${AGENT_LINE}` },
    ];
    const { system: out, removed } = stripDelegationBlockers(system) as {
      system: Array<Record<string, unknown>>;
      removed: number;
    };
    assert.equal(removed, 1);
    assert.deepEqual(out[0], system[0], 'untouched block must keep its cache_control');
    assert.equal(out[1]!['text'], 'guidance');
  });

  it('drops a block that becomes empty rather than forwarding one the API rejects', () => {
    const system = [
      { type: 'text', text: 'keep me' },
      { type: 'text', text: `${AGENT_LINE}\n${WORKFLOW_LINE}` },
    ];
    const { system: out, removed } = stripDelegationBlockers(system) as {
      system: unknown[];
      removed: number;
    };
    assert.equal(removed, 2);
    assert.equal(out.length, 1);
  });

  it('leaves non-text blocks alone', () => {
    const system = [{ type: 'image', source: { type: 'base64', data: 'x' } }];
    const { system: out, removed } = stripDelegationBlockers(system);
    assert.equal(removed, 0);
    assert.equal(out, system);
  });
});

// The regression this repo has already shipped twice in a different form (#34):
// a text rule that reaches into content it should not own.
describe('stripDelegationBlockers — does not damage content that merely mentions the payload', () => {
  it('keeps a line that quotes the payload inside a sentence', () => {
    const prose = `The docs say "${AGENT_LINE}" which is why delegation stopped.`;
    const { system, removed } = stripDelegationBlockers(prose);
    assert.equal(removed, 0, 'a quoted mention is discussion, not the injected directive');
    assert.equal(system, prose);
  });

  it('never touches messages or tools — it only ever receives `system`', () => {
    // Guards the call contract: the handler passes body.system, nothing else.
    const notASystemField = { messages: [{ role: 'user', content: AGENT_LINE }] };
    const { system, removed } = stripDelegationBlockers(notASystemField);
    assert.equal(removed, 0);
    assert.equal(system, notASystemField);
  });
});

// Measured against live Claude Code 2.1.220: request #1 is a tool-less meta-call
// with a 1.3K system prompt and no payload; request #2 is the coordinator turn,
// 31 tools and 10.3K, carrying both lines. Reporting on whichever came first told
// the operator "not present" while the feature was working.
describe('the meta-call comes first — a tool-less miss must not be reported', () => {
  it('a real meta-call system prompt legitimately carries no payload', () => {
    const metaCall = '<session>\nuser: fix the bug\n</session>\n\nWrite a short title.';
    assert.equal(stripDelegationBlockers(metaCall).removed, 0);
  });

  it('the coordinator turn that follows does carry it', () => {
    assert.equal(stripDelegationBlockers(REAL_SYSTEM).removed, 2);
  });
});

describe('describeStrip', () => {
  it('reports the no-match case as clearly as the match case', () => {
    // A vendor payload change must not read as success.
    assert.match(describeStrip(0), /not present|nothing removed/i);
    assert.match(describeStrip(2), /removed 2/);
    assert.match(describeStrip(1), /removed 1 injected anti-delegation line\b/);
  });
});

describe('nextDriftState', () => {
  it('resets the streak to 0 the moment a run matches something', () => {
    const { state, stale } = nextDriftState({ consecutiveMisses: STALE_PATTERN_STREAK + 5 }, true);
    assert.equal(state.consecutiveMisses, 0);
    assert.equal(stale, false);
  });

  it('does not cry wolf on a single miss', () => {
    const { state, stale } = nextDriftState({ consecutiveMisses: 0 }, false);
    assert.equal(state.consecutiveMisses, 1);
    assert.equal(stale, false);
  });

  it('crosses over at STALE_PATTERN_STREAK consecutive misses, not before', () => {
    const justBelow = nextDriftState({ consecutiveMisses: STALE_PATTERN_STREAK - 2 }, false);
    assert.equal(justBelow.state.consecutiveMisses, STALE_PATTERN_STREAK - 1);
    assert.equal(justBelow.stale, false);

    const atThreshold = nextDriftState({ consecutiveMisses: STALE_PATTERN_STREAK - 1 }, false);
    assert.equal(atThreshold.state.consecutiveMisses, STALE_PATTERN_STREAK);
    assert.equal(atThreshold.stale, true);
  });
});

describe('delegation drift state — persisted across restarts', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crouter-drift-'));
    file = path.join(dir, 'delegation-drift.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads a missing file as "no streak yet" rather than throwing', () => {
    assert.deepEqual(readDelegationDriftState(file), { consecutiveMisses: 0 });
  });

  it('round-trips a written streak', () => {
    writeDelegationDriftState(file, { consecutiveMisses: 2 });
    assert.deepEqual(readDelegationDriftState(file), { consecutiveMisses: 2 });
  });

  it('reads a corrupt file as "no streak yet" rather than throwing', () => {
    fs.writeFileSync(file, 'not json');
    assert.deepEqual(readDelegationDriftState(file), { consecutiveMisses: 0 });
  });
});
