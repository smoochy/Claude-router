import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { failureCount, runDiagnostics, type Diagnostic, type DoctorProbes } from '../proxy/doctor.js';
import { SERVICE_ID, type HealthInfo } from '../proxy/health.js';

const HEALTHY: HealthInfo = {
  status: 'ok',
  service: SERVICE_ID,
  classifier: 'hybrid',
  provider: 'anthropic',
  routingMode: 'route',
  forceRoute: true,
  sessionModel: null,
  roleRouting: true,
  version: '0.0.0-test',
  requests: 3,
  lastTier: 'sonnet',
  lastModel: 'claude-sonnet-5',
};

/** A machine where everything is configured. Override one field per test. */
function probes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    nodeVersion: '22.1.0',
    platform: 'linux',
    loadConfig: () => ({ loaded: true }),
    checkHealth: async () => HEALTHY,
    isEnvVarSet: () => true,
    isClaudeCodeEnvSet: () => true,
    apiKeySet: () => true,
    daemonState: () => null,
    isProcessAlive: () => true,
    isAutostartRegistered: () => true,
    isStatuslineConfigured: () => true,
    policyPluginInstalled: () => true,
    modelListCacheAgeDays: () => undefined,
    staleTierIds: async () => [],
    delegationPatternsStale: () => undefined,
    ...overrides,
  };
}

const OPTIONS = { port: 4000, provider: 'anthropic', configFile: '/home/u/.claude-router/config.json' };

function find(diagnostics: Diagnostic[], pattern: RegExp): Diagnostic {
  const match = diagnostics.find((d) => pattern.test(d.label));
  assert.ok(match, `no diagnostic matching ${pattern}`);
  return match;
}

describe('runDiagnostics', () => {
  it('passes everything on a fully configured machine', async () => {
    const diagnostics = await runDiagnostics(OPTIONS, probes());
    assert.equal(failureCount(diagnostics), 0);
    assert.ok(diagnostics.every((d) => d.ok));
  });

  it('reports the active routing mode, warning (not failing) on off', async () => {
    const routed = await runDiagnostics(OPTIONS, probes());
    assert.match(find(routed, /Routing mode/).label, /Routing mode: route/);
    assert.equal(find(routed, /Routing mode/).ok, true);

    const off = await runDiagnostics(OPTIONS, probes({ checkHealth: async () => ({ ...HEALTHY, routingMode: 'off' }) }));
    const offDiag = find(off, /Routing mode/);
    assert.equal(offDiag.ok, false);
    assert.equal(offDiag.warnOnly, true, 'off is a deliberate choice, not a failure');
    assert.match(offDiag.label, /no routing, no recording/);
    assert.equal(failureCount(off), 0, 'warnOnly keeps it out of the exit code');
  });

  it('accepts Claude Code\'s settings.json env as the route to the proxy', async () => {
    // `install` no longer touches the shell; it writes settings.json env. Doctor
    // must not fail a machine set up the default way.
    const diagnostics = await runDiagnostics(OPTIONS, probes({ isEnvVarSet: () => false, isClaudeCodeEnvSet: () => true }));
    const env = find(diagnostics, /routes through the proxy|ANTHROPIC_BASE_URL|points at the proxy/);
    assert.equal(env.ok, true);
    assert.match(env.label, /settings\.json env/);
    assert.equal(failureCount(diagnostics), 0);
    const neither = await runDiagnostics(OPTIONS, probes({ isEnvVarSet: () => false, isClaudeCodeEnvSet: () => false }));
    assert.equal(failureCount(neither), 1);
    assert.match(find(neither, /Nothing points at the proxy/).hint ?? '', /claude-router install/);
  });

  it('warns when the installed plugin version differs from the package', async () => {
    const stale = await runDiagnostics(OPTIONS, probes({
      policyPluginInfo: () => ({ marketplace: 'smoochy-marketplace', version: '0.3.0' }),
      packageVersion: () => '0.4.0',
    }));
    const d = find(stale, /differs from package 0\.4\.0/);
    assert.equal(d.warnOnly, true);
    assert.match(d.label, /smoochy-marketplace/);
    assert.match(d.hint ?? '', /claude plugin marketplace update smoochy-marketplace/);
    const same = await runDiagnostics(OPTIONS, probes({
      policyPluginInfo: () => ({ marketplace: 'm', version: '0.4.0' }),
      packageVersion: () => '0.4.0',
    }));
    assert.equal(same.some((x) => /differs from package/.test(x.label)), false);
  });

  it('counts only hard failures toward the exit code', async () => {
    // The exit code is doctor's contract for CI. A missing proxy and a missing
    // env var are failures; an unregistered autostart is a warning.
    const diagnostics = await runDiagnostics(
      OPTIONS,
      probes({
        checkHealth: async () => null,
        isEnvVarSet: () => false,
        isClaudeCodeEnvSet: () => false,
        isAutostartRegistered: () => false,
        isStatuslineConfigured: () => false,
      }),
    );
    assert.equal(failureCount(diagnostics), 2);
    assert.equal(find(diagnostics, /Autostart not registered/).warnOnly, true);
  });

  it('fails an unsupported Node version', async () => {
    const diagnostics = await runDiagnostics(OPTIONS, probes({ nodeVersion: '16.20.0' }));
    assert.equal(find(diagnostics, /^Node 16/).ok, false);
    assert.equal(failureCount(diagnostics), 1);
  });

  it('reports an unreadable config file as a failure with a fix', async () => {
    const diagnostics = await runDiagnostics(
      OPTIONS,
      probes({ loadConfig: () => ({ loaded: false, error: 'Unexpected token }' }) }),
    );
    const d = find(diagnostics, /Config file invalid/);
    assert.equal(d.ok, false);
    assert.match(d.hint!, /claude-router init --force/);
  });

  it('points at `claude-router install` when nothing routes to the proxy, on every platform', async () => {
    // The install writes Claude Code's settings.json env everywhere, so the
    // remedy is the same command on Linux and Windows — no per-OS shell advice.
    for (const platform of ['linux', 'windows']) {
      const diagnostics = await runDiagnostics(OPTIONS, probes({ isEnvVarSet: () => false, isClaudeCodeEnvSet: () => false, platform }));
      assert.match(find(diagnostics, /Nothing points at the proxy/).hint!, /claude-router install/);
    }
  });

  describe('ANTHROPIC_API_KEY', () => {
    it('is fine when unset on the anthropic provider — Claude Code sends its own', async () => {
      const diagnostics = await runDiagnostics(OPTIONS, probes({ apiKeySet: () => false }));
      const d = find(diagnostics, /ANTHROPIC_API_KEY/);
      assert.equal(d.warnOnly, true);
      assert.match(d.label, /fine if Claude Code sends its own auth/);
    });

    it('says why a missing key passes on a cloud provider', async () => {
      // The verdict and its label used to disagree: with --provider bedrock and
      // no key, a green tick sat next to the words "ANTHROPIC_API_KEY not set".
      const diagnostics = await runDiagnostics(
        { ...OPTIONS, provider: 'bedrock' },
        probes({ apiKeySet: () => false }),
      );
      const d = find(diagnostics, /ANTHROPIC_API_KEY/);
      assert.equal(d.ok, true);
      assert.match(d.label, /not needed for the bedrock provider/);
    });
  });

  describe('daemon state', () => {
    it('is not reported at all when there is no state file', async () => {
      const diagnostics = await runDiagnostics(OPTIONS, probes());
      assert.equal(diagnostics.find((d) => /daemon state/i.test(d.label)), undefined);
    });

    it('warns about a stale record without failing the run', async () => {
      const diagnostics = await runDiagnostics(
        OPTIONS,
        probes({
          daemonState: () => ({ pid: 4242, port: 4000, startedAt: '2026-07-01T00:00:00.000Z', args: [] }),
          isProcessAlive: () => false,
        }),
      );
      const d = find(diagnostics, /Stale daemon state/);
      assert.equal(d.ok, false);
      assert.equal(d.warnOnly, true);
      assert.match(d.label, /pid 4242 is gone/);
      assert.equal(failureCount(diagnostics), 0);
    });
  });

  it('reports the model-list cache age when a cache exists, and says nothing when it does not', async () => {
    const withCache = await runDiagnostics(OPTIONS, probes({ modelListCacheAgeDays: () => 3 }));
    const d = find(withCache, /Model-list cache/);
    assert.equal(d.ok, true);
    assert.equal(d.warnOnly, true);
    assert.match(d.label, /refreshed 3 days ago/);

    const withoutCache = await runDiagnostics(OPTIONS, probes({ modelListCacheAgeDays: () => undefined }));
    assert.equal(withoutCache.some((x) => /Model-list cache/.test(x.label)), false);
  });

  it('warns, without failing, on a stale tier id', async () => {
    const diagnostics = await runDiagnostics(
      OPTIONS,
      probes({ staleTierIds: async () => [{ tier: 'opus', id: 'claude-opus-5' }] }),
    );
    const d = find(diagnostics, /Stale tier/);
    assert.equal(d.ok, false);
    assert.equal(d.warnOnly, true);
    assert.match(d.label, /opus="claude-opus-5"/);
    assert.equal(failureCount(diagnostics), 0);
  });

  it('reports ok when every tier id resolves, and says nothing when there is nothing to check', async () => {
    const ok = await runDiagnostics(OPTIONS, probes({ staleTierIds: async () => [] }));
    assert.match(find(ok, /Tier model ids/).label, /match the current model list/);

    const skipped = await runDiagnostics(OPTIONS, probes({ staleTierIds: async () => undefined }));
    assert.equal(skipped.some((x) => /[Tt]ier.*model ids|Stale tier/.test(x.label)), false);
  });

  it('warns, without failing, when the delegation-blocker patterns look stale', async () => {
    const stale = await runDiagnostics(OPTIONS, probes({ delegationPatternsStale: () => true }));
    const d = find(stale, /restore-delegation/);
    assert.equal(d.ok, false);
    assert.equal(d.warnOnly, true);
    assert.equal(failureCount(stale), 0);

    const fine = await runDiagnostics(OPTIONS, probes({ delegationPatternsStale: () => false }));
    assert.equal(find(fine, /restore-delegation/).ok, true);

    const off = await runDiagnostics(OPTIONS, probes({ delegationPatternsStale: () => undefined }));
    assert.equal(off.some((x) => /restore-delegation/.test(x.label)), false);
  });

  it('probes each fact exactly once', async () => {
    // Every probe used to run twice — once for the verdict and once to build the
    // label — which on Windows meant two `reg query` subprocesses per check.
    const calls: Record<string, number> = {};
    const count = <T>(name: string, value: T) => () => {
      calls[name] = (calls[name] ?? 0) + 1;
      return value;
    };

    await runDiagnostics(
      OPTIONS,
      probes({
        daemonState: count('daemonState', { pid: 1, port: 4000, startedAt: '', args: [] }),
        isProcessAlive: count('isProcessAlive', true),
        isAutostartRegistered: count('isAutostartRegistered', true),
        isStatuslineConfigured: count('isStatuslineConfigured', true),
        isEnvVarSet: count('isEnvVarSet', true),
        apiKeySet: count('apiKeySet', true),
      }),
    );

    assert.deepEqual(calls, {
      daemonState: 1,
      isProcessAlive: 1,
      isAutostartRegistered: 1,
      isStatuslineConfigured: 1,
      isEnvVarSet: 1,
      apiKeySet: 1,
    });
  });
});
