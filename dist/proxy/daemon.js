"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDaemonState = readDaemonState;
exports.writeDaemonState = writeDaemonState;
exports.clearDaemonState = clearDaemonState;
exports.isProcessAlive = isProcessAlive;
exports.checkHealth = checkHealth;
exports.startDaemon = startDaemon;
exports.stopDaemon = stopDaemon;
const node_fs_1 = __importDefault(require("node:fs"));
const node_child_process_1 = require("node:child_process");
const cli_config_js_1 = require("./cli-config.js");
const platform_js_1 = require("./platform.js");
function readDaemonState(paths = (0, cli_config_js_1.routerPaths)()) {
    if (!node_fs_1.default.existsSync(paths.daemonStateFile))
        return null;
    try {
        return JSON.parse(node_fs_1.default.readFileSync(paths.daemonStateFile, 'utf8'));
    }
    catch {
        return null;
    }
}
function writeDaemonState(state, paths = (0, cli_config_js_1.routerPaths)()) {
    node_fs_1.default.mkdirSync(paths.configDir, { recursive: true });
    node_fs_1.default.writeFileSync(paths.daemonStateFile, JSON.stringify(state, null, 2), 'utf8');
}
function clearDaemonState(paths = (0, cli_config_js_1.routerPaths)()) {
    try {
        node_fs_1.default.unlinkSync(paths.daemonStateFile);
    }
    catch {
        // already gone
    }
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        // EPERM means the process exists but we can't signal it
        return err.code === 'EPERM';
    }
}
/**
 * Fetch /health and verify it is actually our proxy (not some other service
 * on the port). Uses 127.0.0.1 — localhost can resolve to ::1 on Windows.
 */
async function checkHealth(port, timeoutMs = 1000) {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        return data.service === 'claude-router-proxy' ? data : null;
    }
    catch {
        return null;
    }
}
/**
 * Spawn the proxy as a detached background process and wait for /health to
 * pass before reporting success — no ✓ until the server is actually up.
 */
async function startDaemon(serveArgs, port, paths = (0, cli_config_js_1.routerPaths)()) {
    const existing = await checkHealth(port);
    if (existing) {
        return { ok: false, detail: `A proxy is already running on port ${port}` };
    }
    node_fs_1.default.mkdirSync(paths.configDir, { recursive: true });
    const logFd = node_fs_1.default.openSync(paths.logFile, 'a');
    const child = (0, node_child_process_1.spawn)(process.execPath, [process.argv[1], 'start', ...serveArgs], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
    });
    child.unref();
    node_fs_1.default.closeSync(logFd);
    const pid = child.pid;
    if (!pid)
        return { ok: false, detail: 'Failed to spawn the proxy process' };
    // Poll health for up to ~3s
    for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const health = await checkHealth(port, 500);
        if (health) {
            writeDaemonState({ pid, port, startedAt: new Date().toISOString(), args: serveArgs }, paths);
            return { ok: true, pid, detail: `Proxy running on http://localhost:${port} (pid ${pid})` };
        }
        if (!isProcessAlive(pid))
            break;
    }
    return {
        ok: false,
        pid,
        detail: `Proxy did not become healthy on port ${port}. Check logs: ${paths.logFile}`,
    };
}
async function stopDaemon(paths = (0, cli_config_js_1.routerPaths)()) {
    // macOS: unload the LaunchAgent first — KeepAlive would resurrect a killed process
    (0, platform_js_1.unloadLaunchAgent)(paths);
    const state = readDaemonState(paths);
    if (state && isProcessAlive(state.pid)) {
        try {
            process.kill(state.pid);
        }
        catch (err) {
            return { ok: false, detail: `Could not stop pid ${state.pid}: ${String(err)}` };
        }
        // Verify death for up to ~2s
        for (let i = 0; i < 10; i++) {
            if (!isProcessAlive(state.pid))
                break;
            await new Promise((r) => setTimeout(r, 200));
        }
        if (isProcessAlive(state.pid)) {
            return { ok: false, detail: `Process ${state.pid} did not exit` };
        }
        clearDaemonState(paths);
        return { ok: true, detail: `Proxy stopped (pid ${state.pid})` };
    }
    clearDaemonState(paths);
    // No usable state file — maybe an older version or a manual start owns the port
    const health = await checkHealth(state?.port ?? 4000);
    if (health) {
        return {
            ok: false,
            detail: 'A proxy is running but was not started by this version — stop it from its own terminal or restart it with: claude-router start -d',
        };
    }
    return { ok: true, detail: 'Proxy was not running' };
}
//# sourceMappingURL=daemon.js.map