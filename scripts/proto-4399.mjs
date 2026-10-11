// PROTOTYPE #4399 - throwaway. Usage: node scripts/proto-4399.mjs <out.html>
// Real history tail plus synthetic rows so all four tiers and all roles show up.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { renderDashboard } from '../dist/proxy/dashboard.js';

const lines = readFileSync(`${homedir()}/.claude-router/history.jsonl`, 'utf8').trim().split('\n').slice(-2000);
const history = [];
for (const l of lines) { try { history.push(JSON.parse(l)); } catch { /* skip */ } }

const mk = (tier, model, role, n, cents) => Array.from({ length: n }, (_, i) => ({
  timestamp: new Date(Date.now() - i * 60000).toISOString(), tier, model, costCents: cents, savedCents: cents * 2,
  confidence: 1, classifier: 'synthetic', retried: false, retryReason: null, inputTokens: 1000, outputTokens: 300,
  ...(role === 'coordinator' ? { coordinator: true } : role ? { role, roleSource: 'marker', subagent: true } : {}),
}));
const synthetic = [
  ...mk('fable', 'claude-fable-5-1', 'coordinator', 4, 38),
  ...mk('opus', 'claude-opus-5-5', 'gate', 3, 21),
  ...mk('opus', 'claude-opus-5-5', 'audit', 2, 17),
  ...mk('sonnet', 'claude-sonnet-5-5', 'batch', 5, 3),
  ...mk('haiku', 'claude-haiku-5-5', 'recon', 7, 1),
];
const html = renderDashboard([...history, ...synthetic], undefined, { scope: 'all' });
writeFileSync(process.argv[2], html);
console.log('wrote', process.argv[2], history.length, 'real +', synthetic.length, 'synthetic');
