"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.platformName = platformName;
exports.buildPlist = buildPlist;
exports.buildRunKeyCommand = buildRunKeyCommand;
exports.buildSystemdUnit = buildSystemdUnit;
exports.buildRcBlock = buildRcBlock;
exports.removeRcBlock = removeRcBlock;
exports.buildStatuslineCommand = buildStatuslineCommand;
exports.isOurStatusline = isOurStatusline;
exports.installAutostart = installAutostart;
exports.uninstallAutostart = uninstallAutostart;
exports.isAutostartRegistered = isAutostartRegistered;
exports.supervisorPid = supervisorPid;
exports.unloadLaunchAgent = unloadLaunchAgent;
exports.setEnvVar = setEnvVar;
exports.unsetEnvVar = unsetEnvVar;
exports.isEnvVarSet = isEnvVarSet;
exports.addStatusline = addStatusline;
exports.removeStatusline = removeStatusline;
exports.isStatuslineConfigured = isStatuslineConfigured;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const node_child_process_1 = require("node:child_process");
const cli_config_js_1 = require("./cli-config.js");
function platformName() {
    if (process.platform === 'win32')
        return 'windows';
    if (process.platform === 'darwin')
        return 'macos';
    return 'linux';
}
const WIN_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const WIN_RUN_VALUE = 'claude-router';
const SYSTEMD_UNIT = 'claude-router.service';
function systemdUnitPath(homeDir = node_os_1.default.homedir()) {
    return node_path_1.default.join(homeDir, '.config', 'systemd', 'user', SYSTEMD_UNIT);
}
// ── Pure builders (testable) ───────────────────────────────────────────────
function escapeXml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function buildPlist(nodePath, cliPath, serveArgs, logFile) {
    const argXml = [nodePath, cliPath, 'start', ...serveArgs]
        .map((a) => `    <string>${escapeXml(a)}</string>`)
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${cli_config_js_1.PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logFile)}</string>
</dict>
</plist>`;
}
/** Command line stored in the HKCU Run key — quotes paths that may contain spaces. */
function buildRunKeyCommand(nodePath, cliPath, serveArgs) {
    return [`"${nodePath}"`, `"${cliPath}"`, 'start', '--daemon', ...serveArgs].join(' ');
}
function buildSystemdUnit(nodePath, cliPath, serveArgs) {
    const exec = [nodePath, cliPath, 'start', ...serveArgs]
        .map((a) => (a.includes(' ') ? `"${a}"` : a))
        .join(' ');
    return `[Unit]
Description=claude-router proxy

[Service]
ExecStart=${exec}
Restart=on-failure

[Install]
WantedBy=default.target
`;
}
const RC_BLOCK_START = '# >>> claude-router >>>';
const RC_BLOCK_END = '# <<< claude-router <<<';
function buildRcBlock(port) {
    return `${RC_BLOCK_START}\nexport ANTHROPIC_BASE_URL=http://localhost:${port}\n${RC_BLOCK_END}`;
}
/** Remove our marker-delimited block, plus the legacy single-marker format. */
function removeRcBlock(content) {
    const lines = content.split('\n');
    const out = [];
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === RC_BLOCK_START) {
            inBlock = true;
            continue;
        }
        if (line.trim() === RC_BLOCK_END) {
            inBlock = false;
            continue;
        }
        if (inBlock)
            continue;
        // Legacy pre-0.1 format: "# claude-router" marker followed by the export
        if (line.trim() === '# claude-router') {
            if (lines[i + 1]?.includes('ANTHROPIC_BASE_URL='))
                i++;
            continue;
        }
        out.push(line);
    }
    return out.join('\n');
}
/** Statusline command for ~/.claude/settings.json — node is guaranteed present. */
function buildStatuslineCommand(port) {
    // 127.0.0.1, not localhost: localhost can resolve to ::1 first on Windows.
    // Outer double quotes + inner single quotes work under cmd, PowerShell, and sh.
    return (`node -e "fetch('http://127.0.0.1:${port}/health',{signal:AbortSignal.timeout(300)})` +
        `.then(r=>r.json()).then(d=>console.log('[auto:'+(d.lastTier??'ready')+' #'+d.requests+']'))` +
        `.catch(()=>console.log('[auto:off]'))"`);
}
/** Matches any statusline command this tool has ever installed. */
function isOurStatusline(command) {
    return command.includes('[auto:');
}
// ── Autostart ──────────────────────────────────────────────────────────────
function installAutostart(serveArgs, paths = (0, cli_config_js_1.routerPaths)()) {
    const nodePath = process.execPath;
    const cliPath = process.argv[1];
    const platform = platformName();
    if (platform === 'windows') {
        try {
            (0, node_child_process_1.execFileSync)('reg', [
                'add', WIN_RUN_KEY, '/v', WIN_RUN_VALUE, '/t', 'REG_SZ',
                '/d', buildRunKeyCommand(nodePath, cliPath, serveArgs), '/f',
            ], { stdio: 'pipe' });
            return { ok: true, detail: `Run key registered (${WIN_RUN_KEY}\\${WIN_RUN_VALUE})` };
        }
        catch (err) {
            return { ok: false, detail: `Could not write Run key: ${String(err)}` };
        }
    }
    if (platform === 'macos') {
        try {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(paths.plistFile), { recursive: true });
            node_fs_1.default.writeFileSync(paths.plistFile, buildPlist(nodePath, cliPath, serveArgs, paths.logFile), 'utf8');
        }
        catch (err) {
            return { ok: false, detail: `Could not write LaunchAgent: ${String(err)}` };
        }
        try {
            (0, node_child_process_1.execFileSync)('launchctl', ['unload', paths.plistFile], { stdio: 'pipe' });
        }
        catch {
            // not loaded yet — fine
        }
        try {
            (0, node_child_process_1.execFileSync)('launchctl', ['load', paths.plistFile], { stdio: 'pipe' });
            return { ok: true, detail: `LaunchAgent loaded (${paths.plistFile})` };
        }
        catch (err) {
            return { ok: false, detail: `LaunchAgent written but launchctl load failed: ${String(err)}` };
        }
    }
    // linux
    try {
        const unitPath = systemdUnitPath();
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(unitPath), { recursive: true });
        node_fs_1.default.writeFileSync(unitPath, buildSystemdUnit(nodePath, cliPath, serveArgs), 'utf8');
        (0, node_child_process_1.execFileSync)('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
        (0, node_child_process_1.execFileSync)('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT], { stdio: 'pipe' });
        return { ok: true, detail: `systemd user unit enabled (${unitPath})` };
    }
    catch (err) {
        return {
            ok: false,
            detail: `systemd setup failed (${String(err)}). The daemon still runs; re-run 'claude-router start -d' after reboot.`,
        };
    }
}
function uninstallAutostart(paths = (0, cli_config_js_1.routerPaths)()) {
    const platform = platformName();
    if (platform === 'windows') {
        try {
            (0, node_child_process_1.execFileSync)('reg', ['delete', WIN_RUN_KEY, '/v', WIN_RUN_VALUE, '/f'], { stdio: 'pipe' });
            return { ok: true, detail: 'Run key removed' };
        }
        catch {
            return { ok: true, detail: 'Run key was not present', skipped: true };
        }
    }
    if (platform === 'macos') {
        unloadLaunchAgent(paths);
        if (node_fs_1.default.existsSync(paths.plistFile)) {
            try {
                node_fs_1.default.unlinkSync(paths.plistFile);
                return { ok: true, detail: 'LaunchAgent removed' };
            }
            catch (err) {
                return { ok: false, detail: `Could not remove LaunchAgent: ${String(err)}` };
            }
        }
        return { ok: true, detail: 'LaunchAgent was not present', skipped: true };
    }
    // linux
    const unitPath = systemdUnitPath();
    if (!node_fs_1.default.existsSync(unitPath))
        return { ok: true, detail: 'systemd unit was not present', skipped: true };
    try {
        (0, node_child_process_1.execFileSync)('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT], { stdio: 'pipe' });
    }
    catch {
        // systemctl absent or unit not enabled — still remove the file
    }
    try {
        node_fs_1.default.unlinkSync(unitPath);
        return { ok: true, detail: 'systemd unit removed' };
    }
    catch (err) {
        return { ok: false, detail: `Could not remove systemd unit: ${String(err)}` };
    }
}
function isAutostartRegistered(paths = (0, cli_config_js_1.routerPaths)()) {
    const platform = platformName();
    if (platform === 'windows') {
        try {
            (0, node_child_process_1.execFileSync)('reg', ['query', WIN_RUN_KEY, '/v', WIN_RUN_VALUE], { stdio: 'pipe' });
            return true;
        }
        catch {
            return false;
        }
    }
    if (platform === 'macos')
        return node_fs_1.default.existsSync(paths.plistFile);
    return node_fs_1.default.existsSync(systemdUnitPath());
}
/**
 * PID of the proxy if the OS autostart supervisor (launchd / systemd) is
 * currently running it. Lets `install` record the supervised process in the
 * daemon state file instead of starting a redundant daemon that would race it
 * on the port. Returns null when no supervisor owns the process (e.g. Windows,
 * or a manually started daemon).
 */
function supervisorPid(paths = (0, cli_config_js_1.routerPaths)()) {
    const platform = platformName();
    try {
        if (platform === 'macos') {
            const out = (0, node_child_process_1.execFileSync)('launchctl', ['list'], { encoding: 'utf8', stdio: 'pipe' });
            for (const line of out.split('\n')) {
                // columns: "<pid>\t<last exit>\t<label>"; pid is '-' when not running
                const [pid, , label] = line.split('\t');
                if (label === cli_config_js_1.PLIST_LABEL && pid && pid !== '-') {
                    const n = parseInt(pid, 10);
                    return Number.isNaN(n) ? null : n;
                }
            }
            return null;
        }
        if (platform === 'linux') {
            const out = (0, node_child_process_1.execFileSync)('systemctl', ['--user', 'show', SYSTEMD_UNIT, '--property=MainPID', '--value'], { encoding: 'utf8', stdio: 'pipe' });
            const n = parseInt(out.trim(), 10);
            return n > 0 ? n : null;
        }
    }
    catch {
        return null;
    }
    return null;
}
function unloadLaunchAgent(paths = (0, cli_config_js_1.routerPaths)()) {
    if (platformName() !== 'macos' || !node_fs_1.default.existsSync(paths.plistFile))
        return;
    try {
        (0, node_child_process_1.execFileSync)('launchctl', ['unload', paths.plistFile], { stdio: 'pipe' });
    }
    catch {
        // not loaded — fine
    }
}
// ── Environment variable ───────────────────────────────────────────────────
function readWindowsUserEnv(name) {
    try {
        const out = (0, node_child_process_1.execFileSync)('reg', ['query', 'HKCU\\Environment', '/v', name], {
            stdio: 'pipe',
            encoding: 'utf8',
        });
        const match = out.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
        return match ? match[1].trim() : null;
    }
    catch {
        return null;
    }
}
function setEnvVar(port, paths = (0, cli_config_js_1.routerPaths)()) {
    const target = `http://localhost:${port}`;
    const platform = platformName();
    if (platform === 'windows') {
        const existing = readWindowsUserEnv('ANTHROPIC_BASE_URL');
        if (existing && existing !== target) {
            return {
                ok: false,
                skipped: true,
                detail: `ANTHROPIC_BASE_URL is already set to ${existing} — not overwriting. Set it manually: setx ANTHROPIC_BASE_URL ${target}`,
            };
        }
        try {
            (0, node_child_process_1.execFileSync)('setx', ['ANTHROPIC_BASE_URL', target], { stdio: 'pipe' });
            return { ok: true, detail: `ANTHROPIC_BASE_URL=${target} (new terminals only)` };
        }
        catch (err) {
            return { ok: false, detail: `setx failed: ${String(err)}` };
        }
    }
    // macOS/Linux: marker-delimited block in the shell rc file
    const rcFile = platform === 'macos' || process.env['SHELL']?.includes('zsh')
        ? paths.zshrcFile
        : paths.bashrcFile;
    try {
        let content = node_fs_1.default.existsSync(rcFile) ? node_fs_1.default.readFileSync(rcFile, 'utf8') : '';
        if (content.includes(RC_BLOCK_START)) {
            content = removeRcBlock(content);
        }
        else if (/^export ANTHROPIC_BASE_URL=/m.test(content)) {
            return {
                ok: false,
                skipped: true,
                detail: `${rcFile} already exports ANTHROPIC_BASE_URL — not overwriting`,
            };
        }
        node_fs_1.default.writeFileSync(rcFile, `${content.replace(/\n*$/, '\n')}${buildRcBlock(port)}\n`, 'utf8');
        // GUI apps launched from Dock/Finder (VS Code, the Claude Code extension) don't
        // read shell rc files, so the rc export alone never reaches them. launchctl setenv
        // injects it into the running GUI session — no relaunch-from-terminal needed.
        if (platform === 'macos') {
            try {
                (0, node_child_process_1.execFileSync)('launchctl', ['setenv', 'ANTHROPIC_BASE_URL', target], { stdio: 'pipe' });
                return { ok: true, detail: `ANTHROPIC_BASE_URL added to ${rcFile} + GUI session (launchctl)` };
            }
            catch {
                // ponytail: launchctl absent/denied — rc export still covers terminal use.
                return { ok: true, detail: `ANTHROPIC_BASE_URL added to ${rcFile} (launchctl setenv failed — restart GUI apps from a terminal)` };
            }
        }
        return { ok: true, detail: `ANTHROPIC_BASE_URL added to ${rcFile}` };
    }
    catch (err) {
        return { ok: false, detail: `Could not update ${rcFile}: ${String(err)}` };
    }
}
function unsetEnvVar(paths = (0, cli_config_js_1.routerPaths)()) {
    const platform = platformName();
    if (platform === 'windows') {
        const existing = readWindowsUserEnv('ANTHROPIC_BASE_URL');
        if (!existing)
            return { ok: true, detail: 'ANTHROPIC_BASE_URL was not set', skipped: true };
        if (!/https?:\/\/(localhost|127\.0\.0\.1):/.test(existing)) {
            return { ok: true, skipped: true, detail: `ANTHROPIC_BASE_URL points elsewhere (${existing}) — left in place` };
        }
        try {
            (0, node_child_process_1.execFileSync)('reg', ['delete', 'HKCU\\Environment', '/v', 'ANTHROPIC_BASE_URL', '/f'], { stdio: 'pipe' });
            return { ok: true, detail: 'ANTHROPIC_BASE_URL removed' };
        }
        catch (err) {
            return { ok: false, detail: `Could not remove env var: ${String(err)}` };
        }
    }
    let removedAny = false;
    for (const rcFile of [paths.zshrcFile, paths.bashrcFile]) {
        if (!node_fs_1.default.existsSync(rcFile))
            continue;
        const content = node_fs_1.default.readFileSync(rcFile, 'utf8');
        const cleaned = removeRcBlock(content);
        if (cleaned !== content) {
            node_fs_1.default.writeFileSync(rcFile, cleaned, 'utf8');
            removedAny = true;
        }
    }
    if (platform === 'macos') {
        try {
            (0, node_child_process_1.execFileSync)('launchctl', ['unsetenv', 'ANTHROPIC_BASE_URL'], { stdio: 'pipe' });
        }
        catch {
            // not set / launchctl absent — nothing to undo
        }
    }
    return removedAny
        ? { ok: true, detail: 'ANTHROPIC_BASE_URL block removed from shell rc' }
        : { ok: true, detail: 'No claude-router block found in shell rc', skipped: true };
}
function isEnvVarSet(port) {
    const target = `http://localhost:${port}`;
    const altTarget = `http://127.0.0.1:${port}`;
    if (platformName() === 'windows') {
        const persisted = readWindowsUserEnv('ANTHROPIC_BASE_URL');
        if (persisted === target || persisted === altTarget)
            return true;
    }
    const current = process.env['ANTHROPIC_BASE_URL'];
    return current === target || current === altTarget;
}
// ── Claude Code statusline ─────────────────────────────────────────────────
function addStatusline(port, paths = (0, cli_config_js_1.routerPaths)()) {
    let settings = {};
    if (node_fs_1.default.existsSync(paths.claudeSettingsFile)) {
        try {
            settings = JSON.parse(node_fs_1.default.readFileSync(paths.claudeSettingsFile, 'utf8'));
        }
        catch (err) {
            return { ok: false, detail: `~/.claude/settings.json is not valid JSON (${String(err)}) — skipping statusline` };
        }
    }
    const existing = settings['statusLine'];
    if (existing?.command && !isOurStatusline(existing.command)) {
        return { ok: false, skipped: true, detail: 'A custom statusline is already configured — not overwriting' };
    }
    try {
        settings['statusLine'] = { type: 'command', command: buildStatuslineCommand(port) };
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(paths.claudeSettingsFile), { recursive: true });
        node_fs_1.default.writeFileSync(paths.claudeSettingsFile, JSON.stringify(settings, null, 2), 'utf8');
        return { ok: true, detail: 'Statusline configured in ~/.claude/settings.json' };
    }
    catch (err) {
        return { ok: false, detail: `Could not write ~/.claude/settings.json: ${String(err)}` };
    }
}
function removeStatusline(paths = (0, cli_config_js_1.routerPaths)()) {
    if (!node_fs_1.default.existsSync(paths.claudeSettingsFile)) {
        return { ok: true, detail: 'No Claude settings file', skipped: true };
    }
    try {
        const settings = JSON.parse(node_fs_1.default.readFileSync(paths.claudeSettingsFile, 'utf8'));
        const statusLine = settings['statusLine'];
        if (statusLine?.command && isOurStatusline(statusLine.command)) {
            delete settings['statusLine'];
            node_fs_1.default.writeFileSync(paths.claudeSettingsFile, JSON.stringify(settings, null, 2), 'utf8');
            return { ok: true, detail: 'Statusline removed' };
        }
        return { ok: true, detail: 'Statusline was not ours', skipped: true };
    }
    catch (err) {
        return { ok: false, detail: `Could not update ~/.claude/settings.json: ${String(err)}` };
    }
}
function isStatuslineConfigured(paths = (0, cli_config_js_1.routerPaths)()) {
    if (!node_fs_1.default.existsSync(paths.claudeSettingsFile))
        return false;
    try {
        const settings = JSON.parse(node_fs_1.default.readFileSync(paths.claudeSettingsFile, 'utf8'));
        const statusLine = settings['statusLine'];
        return Boolean(statusLine?.command && isOurStatusline(statusLine.command));
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=platform.js.map