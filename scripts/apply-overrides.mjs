// Applies overrides.yaml (npm: package -> minimum version) to package.json `overrides` and relocks.
//   node scripts/apply-overrides.mjs [dir]   prints pruned entries, one per line
// shortcut: npm only, flat `package: 'x.y.z'` entries, parsed by line; add an ecosystem when a second one is needed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ENTRY = /^ {2}([^\s:#][^:]*?):\s*'([^']+)'/;
const ver = (v) => v.split('.').map(Number);

export function parseOverrides(text) {
  const out = {};
  let eco = null;
  for (const line of text.split('\n')) {
    const h = /^([a-z]+):\s*$/.exec(line);
    if (h) {
      if (h[1] !== 'npm') throw new Error(`unsupported ecosystem ${h[1]}, expected npm`);
      eco = h[1];
    } else if (eco && ENTRY.test(line)) {
      const [, name, min] = ENTRY.exec(line);
      out[name] = min;
    }
  }
  return out;
}

export function installedVersions(lock, name) {
  return Object.entries(lock.packages ?? {})
    .filter(([k]) => k === `node_modules/${name}` || k.endsWith(`/node_modules/${name}`))
    .map(([, v]) => v.version);
}

// Satisfied: no copy of the same major sits below the minimum, and some copy reaches its major.
export function satisfied(versions, min) {
  const m = ver(min);
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (versions.length === 0) return false;
  const vs = versions.map(ver);
  return !vs.some((v) => v[0] === m[0] && cmp(v, m) < 0) && vs.some((v) => v[0] >= m[0]);
}

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
};

export function applyOverrides(dir, { run: exec = (c, a) => run(c, a, dir) } = {}) {
  const file = join(dir, 'overrides.yaml');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const wanted = parseOverrides(text);
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  const pruned = [];
  let changed = false;
  for (const [name, min] of Object.entries(wanted)) {
    const have = installedVersions(lock, name);
    const enforced = pkg.overrides?.[name] === `^${min}`;
    if (have.length === 0 || satisfied(have, min)) {
      // Satisfied on its own: drop the entry. One we enforce ourselves must stay.
      if (!enforced) pruned.push(`${name} ${min}`);
      continue;
    }
    pkg.overrides = { ...pkg.overrides, [name]: `^${min}` };
    changed = true;
  }
  if (pruned.length) {
    const drop = new Set(pruned.map((p) => p.split(' ')[0]));
    const kept = text.split('\n').filter((l) => !drop.has(ENTRY.exec(l)?.[1]));
    const left = kept.some((l) => ENTRY.test(l));
    writeFileSync(file, left ? kept.join('\n') : '');
  }
  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    exec('npm', ['install', '--package-lock-only', '--ignore-scripts']);
  }
  return pruned;
}

if (process.argv[1]?.endsWith('apply-overrides.mjs')) {
  for (const p of applyOverrides(process.argv[2] ?? '.')) console.log(p);
}
