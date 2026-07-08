"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const cli_config_js_1 = require("../proxy/cli-config.js");
(0, node_test_1.describe)('parseServeArgs', () => {
    (0, node_test_1.it)('applies defaults with no args and no file config', () => {
        const opts = (0, cli_config_js_1.parseServeArgs)([]);
        strict_1.default.equal(opts.port, 4000);
        strict_1.default.equal(opts.host, '127.0.0.1', 'must bind local-only by default');
        strict_1.default.equal(opts.classifier, 'hybrid');
        strict_1.default.equal(opts.provider, 'anthropic');
        strict_1.default.equal(opts.forceRoute, false);
    });
    (0, node_test_1.it)('parses --host and file-config host', () => {
        strict_1.default.equal((0, cli_config_js_1.parseServeArgs)(['--host', '0.0.0.0']).host, '0.0.0.0');
        strict_1.default.equal((0, cli_config_js_1.parseServeArgs)([], { host: '0.0.0.0' }).host, '0.0.0.0');
        strict_1.default.equal((0, cli_config_js_1.parseServeArgs)(['--host', '127.0.0.1'], { host: '0.0.0.0' }).host, '127.0.0.1');
        strict_1.default.throws(() => (0, cli_config_js_1.parseServeArgs)(['--host']), cli_config_js_1.CliUsageError);
    });
    (0, node_test_1.it)('file config supplies defaults; flags override', () => {
        const file = { port: 5000, classifier: 'heuristic', forceRoute: true };
        const fromFile = (0, cli_config_js_1.parseServeArgs)([], file);
        strict_1.default.equal(fromFile.port, 5000);
        strict_1.default.equal(fromFile.classifier, 'heuristic');
        strict_1.default.equal(fromFile.forceRoute, true);
        const overridden = (0, cli_config_js_1.parseServeArgs)(['--port', '6000', '--classifier', 'ai'], file);
        strict_1.default.equal(overridden.port, 6000);
        strict_1.default.equal(overridden.classifier, 'ai');
        strict_1.default.equal(overridden.forceRoute, true, 'un-overridden file values stay');
    });
    (0, node_test_1.it)('rejects invalid port', () => {
        strict_1.default.throws(() => (0, cli_config_js_1.parseServeArgs)(['--port', 'abc']), cli_config_js_1.CliUsageError);
        strict_1.default.throws(() => (0, cli_config_js_1.parseServeArgs)(['--port', '0']), cli_config_js_1.CliUsageError);
        strict_1.default.throws(() => (0, cli_config_js_1.parseServeArgs)(['--port', '70000']), cli_config_js_1.CliUsageError);
    });
    (0, node_test_1.it)('rejects invalid classifier (same as provider)', () => {
        strict_1.default.throws(() => (0, cli_config_js_1.parseServeArgs)(['--classifier', 'bogus']), cli_config_js_1.CliUsageError);
        strict_1.default.throws(() => (0, cli_config_js_1.parseServeArgs)(['--provider', 'bogus']), cli_config_js_1.CliUsageError);
    });
    (0, node_test_1.it)('rejects unknown flags', () => {
        strict_1.default.throws(() => (0, cli_config_js_1.parseServeArgs)(['--nope']), cli_config_js_1.CliUsageError);
    });
    (0, node_test_1.it)('parses all valid flags', () => {
        const opts = (0, cli_config_js_1.parseServeArgs)([
            '--port', '4100', '--verbose', '--classifier', 'heuristic',
            '--provider', 'bedrock', '--region', 'eu-west-1', '--force-route',
        ]);
        strict_1.default.deepEqual({ ...opts, tiers: undefined, pricing: undefined, routing: undefined }, {
            port: 4100, host: '127.0.0.1', verbose: true, classifier: 'heuristic', provider: 'bedrock',
            region: 'eu-west-1', forceRoute: true, tiers: undefined, pricing: undefined, routing: undefined,
        });
    });
});
(0, node_test_1.describe)('serveArgsFrom', () => {
    (0, node_test_1.it)('round-trips through parseServeArgs', () => {
        const original = (0, cli_config_js_1.parseServeArgs)(['--port', '4200', '--force-route', '--classifier', 'ai', '--host', '0.0.0.0']);
        const rebuilt = (0, cli_config_js_1.parseServeArgs)((0, cli_config_js_1.serveArgsFrom)(original));
        strict_1.default.equal(rebuilt.port, 4200);
        strict_1.default.equal(rebuilt.forceRoute, true);
        strict_1.default.equal(rebuilt.classifier, 'ai');
        strict_1.default.equal(rebuilt.host, '0.0.0.0');
    });
    (0, node_test_1.it)('omits --host for the default bind', () => {
        const args = (0, cli_config_js_1.serveArgsFrom)((0, cli_config_js_1.parseServeArgs)([]));
        strict_1.default.ok(!args.includes('--host'));
    });
});
(0, node_test_1.describe)('loadFileConfig', () => {
    (0, node_test_1.it)('reports invalid JSON without throwing', () => {
        const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'crouter-'));
        const file = node_path_1.default.join(dir, 'config.json');
        node_fs_1.default.writeFileSync(file, '{not json', 'utf8');
        const result = (0, cli_config_js_1.loadFileConfig)(file);
        strict_1.default.equal(result.loaded, false);
        strict_1.default.ok(result.error);
        strict_1.default.deepEqual(result.config, {});
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
    (0, node_test_1.it)('loads valid config', () => {
        const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'crouter-'));
        const file = node_path_1.default.join(dir, 'config.json');
        node_fs_1.default.writeFileSync(file, JSON.stringify({ port: 4321 }), 'utf8');
        const result = (0, cli_config_js_1.loadFileConfig)(file);
        strict_1.default.equal(result.loaded, true);
        strict_1.default.equal(result.config.port, 4321);
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    });
    (0, node_test_1.it)('missing file is not an error', () => {
        const result = (0, cli_config_js_1.loadFileConfig)(node_path_1.default.join(node_os_1.default.tmpdir(), 'does-not-exist', 'config.json'));
        strict_1.default.equal(result.loaded, false);
        strict_1.default.equal(result.error, undefined);
    });
});
(0, node_test_1.describe)('suggestCommand', () => {
    const commands = ['start', 'stop', 'status', 'install', 'uninstall', 'doctor'];
    (0, node_test_1.it)('suggests for close typos', () => {
        strict_1.default.equal((0, cli_config_js_1.suggestCommand)('installl', commands), 'install');
        strict_1.default.equal((0, cli_config_js_1.suggestCommand)('statis', commands), 'status');
        strict_1.default.equal((0, cli_config_js_1.suggestCommand)('stpo', commands), 'stop');
    });
    (0, node_test_1.it)('returns null for distant input', () => {
        strict_1.default.equal((0, cli_config_js_1.suggestCommand)('frobnicate', commands), null);
    });
});
(0, node_test_1.describe)('getVersion', () => {
    (0, node_test_1.it)('matches package.json', () => {
        const pkg = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(__dirname, '..', '..', 'package.json'), 'utf8'));
        strict_1.default.equal((0, cli_config_js_1.getVersion)(), pkg.version);
    });
});
(0, node_test_1.describe)('routerPaths', () => {
    (0, node_test_1.it)('derives all paths from the home dir', () => {
        const p = (0, cli_config_js_1.routerPaths)('/fake/home');
        strict_1.default.ok(p.configFile.includes('.claude-router'));
        strict_1.default.ok(p.daemonStateFile.endsWith('daemon.json'));
        strict_1.default.ok(p.logFile.endsWith('proxy.log'));
        strict_1.default.ok(p.plistFile.includes('LaunchAgents'));
    });
});
//# sourceMappingURL=cli-config.test.js.map