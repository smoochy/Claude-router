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
const node_server_1 = require("@hono/node-server");
const cli_config_js_1 = require("../proxy/cli-config.js");
const daemon_js_1 = require("../proxy/daemon.js");
const server_js_1 = require("../proxy/server.js");
const models_js_1 = require("../models.js");
function tempPaths() {
    const home = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'crouter-daemon-'));
    return { home, paths: (0, cli_config_js_1.routerPaths)(home) };
}
(0, node_test_1.describe)('daemon state file', () => {
    (0, node_test_1.it)('round-trips state', () => {
        const { home, paths } = tempPaths();
        const state = { pid: 12345, port: 4000, startedAt: '2026-07-02T00:00:00Z', args: ['--port', '4000'] };
        (0, daemon_js_1.writeDaemonState)(state, paths);
        strict_1.default.deepEqual((0, daemon_js_1.readDaemonState)(paths), state);
        (0, daemon_js_1.clearDaemonState)(paths);
        strict_1.default.equal((0, daemon_js_1.readDaemonState)(paths), null);
        node_fs_1.default.rmSync(home, { recursive: true, force: true });
    });
    (0, node_test_1.it)('returns null for missing or corrupt state', () => {
        const { home, paths } = tempPaths();
        strict_1.default.equal((0, daemon_js_1.readDaemonState)(paths), null);
        node_fs_1.default.mkdirSync(paths.configDir, { recursive: true });
        node_fs_1.default.writeFileSync(paths.daemonStateFile, 'not json', 'utf8');
        strict_1.default.equal((0, daemon_js_1.readDaemonState)(paths), null);
        node_fs_1.default.rmSync(home, { recursive: true, force: true });
    });
});
(0, node_test_1.describe)('isProcessAlive', () => {
    (0, node_test_1.it)('true for the current process', () => {
        strict_1.default.equal((0, daemon_js_1.isProcessAlive)(process.pid), true);
    });
    (0, node_test_1.it)('false for a dead pid', () => {
        // PIDs near the max are vanishingly unlikely to be live in CI
        strict_1.default.equal((0, daemon_js_1.isProcessAlive)(2 ** 22 - 7), false);
    });
});
(0, node_test_1.describe)('checkHealth', () => {
    (0, node_test_1.it)('returns health info from a live proxy and null otherwise', async () => {
        const app = (0, server_js_1.createProxyApp)({
            classifier: 'heuristic',
            defaultModel: models_js_1.DEFAULT_MODELS.sonnet,
            verbose: false,
            provider: 'anthropic',
            models: models_js_1.DEFAULT_MODELS,
            forceRoute: true,
        });
        const server = (0, node_server_1.serve)({ fetch: app.fetch, port: 0 });
        (0, node_test_1.after)(() => server.close());
        const port = server.address().port;
        const health = await (0, daemon_js_1.checkHealth)(port);
        strict_1.default.ok(health);
        strict_1.default.equal(health.service, 'claude-router-proxy');
        strict_1.default.equal(health.forceRoute, true);
        const dead = await (0, daemon_js_1.checkHealth)(port === 4999 ? 5001 : 4999, 300);
        strict_1.default.equal(dead, null);
    });
});
//# sourceMappingURL=daemon.test.js.map