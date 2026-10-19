import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Tests run from the repo root (see scripts/run-tests.mjs).
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Record<string, any>;
const minor = (range: string) => Number(/^\^0\.(\d+)\./.exec(range)?.[1]);

describe('install-time dependency tree', () => {
  // `npm install -g <tarball>` ignores package-lock.json, so the declared range decides the tree:
  // vertex-sdk 0.16 -> google-auth-library 9 -> gaxios 6.7 -> uuid@9, which prints a deprecation warning.
  // vertex-sdk >= 0.21 needs google-auth-library ^10 -> gaxios 7, which has no uuid.
  it('the declared @anthropic-ai/vertex-sdk range cannot resolve to the uuid-pulling 0.16', () => {
    const range: string = readJson('package.json')['optionalDependencies']['@anthropic-ai/vertex-sdk'];
    assert.ok(minor(range) >= 21, `range ${range}`);
  });

  it('the installed vertex-sdk requires google-auth-library 10+', () => {
    const deps = readJson('node_modules/@anthropic-ai/vertex-sdk/package.json')['dependencies'];
    assert.match(deps['google-auth-library'], /^\^1\d\./);
  });

  // Importing pulls in google-auth-library and gaxios; constructing a client would start a real credential lookup.
  it('the Vertex SDK still loads with the resolved google-auth-library', async () => {
    const spec = '@anthropic-ai/vertex-sdk';
    const mod = (await import(spec)) as { AnthropicVertex?: unknown };
    assert.equal(typeof mod.AnthropicVertex, 'function');
  });
});
