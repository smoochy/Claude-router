"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CliUsageError = exports.PLIST_LABEL = void 0;
exports.routerPaths = routerPaths;
exports.loadFileConfig = loadFileConfig;
exports.parseServeArgs = parseServeArgs;
exports.applyRegionEnv = applyRegionEnv;
exports.serveArgsFrom = serveArgsFrom;
exports.getVersion = getVersion;
exports.suggestCommand = suggestCommand;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
function routerPaths(homeDir = node_os_1.default.homedir()) {
    const configDir = node_path_1.default.join(homeDir, '.claude-router');
    return {
        configDir,
        configFile: node_path_1.default.join(configDir, 'config.json'),
        daemonStateFile: node_path_1.default.join(configDir, 'daemon.json'),
        logFile: node_path_1.default.join(configDir, 'proxy.log'),
        historyFile: node_path_1.default.join(configDir, 'history.jsonl'),
        plistFile: node_path_1.default.join(homeDir, 'Library', 'LaunchAgents', 'com.claude-router.proxy.plist'),
        claudeSettingsFile: node_path_1.default.join(homeDir, '.claude', 'settings.json'),
        zshrcFile: node_path_1.default.join(homeDir, '.zshrc'),
        bashrcFile: node_path_1.default.join(homeDir, '.bashrc'),
    };
}
exports.PLIST_LABEL = 'com.claude-router.proxy';
function loadFileConfig(configFile = routerPaths().configFile) {
    if (!node_fs_1.default.existsSync(configFile))
        return { config: {}, loaded: false };
    try {
        return { config: JSON.parse(node_fs_1.default.readFileSync(configFile, 'utf8')), loaded: true };
    }
    catch (err) {
        return { config: {}, loaded: false, error: String(err) };
    }
}
/** Thrown for user-facing argument errors; the CLI prints it red and exits 1. */
class CliUsageError extends Error {
}
exports.CliUsageError = CliUsageError;
/**
 * Parse start/install flags. File config supplies defaults; flags override.
 * Throws CliUsageError on invalid or unknown flags.
 */
function parseServeArgs(args, file = {}) {
    let port = file.port ?? 4000;
    let host = file.host ?? '127.0.0.1';
    let verbose = file.verbose ?? false;
    let classifier = file.classifier ?? 'hybrid';
    let provider = file.provider ?? 'anthropic';
    let region = file.region ?? '';
    let forceRoute = file.forceRoute ?? false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--port' || arg === '-p') {
            const raw = args[++i];
            const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
            if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
                throw new CliUsageError(`Invalid port: ${raw ?? '(missing)'}. Must be 1-65535.`);
            }
            port = parsed;
        }
        else if (arg === '--host') {
            const val = args[++i];
            if (!val)
                throw new CliUsageError('Missing value for --host.');
            host = val;
        }
        else if (arg === '--verbose' || arg === '-v') {
            verbose = true;
        }
        else if (arg === '--classifier') {
            const val = args[++i];
            if (val === 'heuristic' || val === 'ai' || val === 'hybrid') {
                classifier = val;
            }
            else {
                throw new CliUsageError(`Invalid classifier: ${val ?? '(missing)'}. Must be heuristic | ai | hybrid.`);
            }
        }
        else if (arg === '--provider') {
            const val = args[++i];
            if (val === 'anthropic' || val === 'bedrock' || val === 'vertex') {
                provider = val;
            }
            else {
                throw new CliUsageError(`Invalid provider: ${val ?? '(missing)'}. Must be anthropic | bedrock | vertex.`);
            }
        }
        else if (arg === '--region') {
            const val = args[++i];
            if (!val)
                throw new CliUsageError('Missing value for --region.');
            region = val;
        }
        else if (arg === '--force-route') {
            forceRoute = true;
        }
        else {
            throw new CliUsageError(`Unknown option '${arg}'. Run 'claude-router help' for usage.`);
        }
    }
    return { port, host, verbose, classifier, provider, region, forceRoute, tiers: file.tiers, pricing: file.pricing, routing: file.routing };
}
/** Region flags map onto the provider SDK env vars unless already set. */
function applyRegionEnv(options) {
    if (!options.region)
        return;
    if (options.provider === 'bedrock' && !process.env['AWS_REGION']) {
        process.env['AWS_REGION'] = options.region;
    }
    else if (options.provider === 'vertex' && !process.env['ANTHROPIC_VERTEX_REGION']) {
        process.env['ANTHROPIC_VERTEX_REGION'] = options.region;
    }
}
/** Serve flags to re-create these options in a spawned/registered process. */
function serveArgsFrom(options) {
    const args = ['--port', String(options.port)];
    if (options.host !== '127.0.0.1')
        args.push('--host', options.host);
    if (options.forceRoute)
        args.push('--force-route');
    if (options.verbose)
        args.push('--verbose');
    if (options.classifier !== 'hybrid')
        args.push('--classifier', options.classifier);
    if (options.provider !== 'anthropic')
        args.push('--provider', options.provider);
    if (options.region)
        args.push('--region', options.region);
    return args;
}
// ── Version ────────────────────────────────────────────────────────────────
function getVersion() {
    // Compiled output lives at dist/proxy/, so package.json is two levels up.
    // The project compiles to CJS, so __dirname is available.
    const pkgPath = node_path_1.default.join(__dirname, '..', '..', 'package.json');
    try {
        const pkg = JSON.parse(node_fs_1.default.readFileSync(pkgPath, 'utf8'));
        return pkg.version ?? 'unknown';
    }
    catch {
        return 'unknown';
    }
}
// ── Command suggestion ─────────────────────────────────────────────────────
function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++)
        dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return dp[a.length][b.length];
}
/** Closest known command within edit distance 2, or null. */
function suggestCommand(input, commands) {
    let best = null;
    let bestDist = 3;
    for (const cmd of commands) {
        const d = levenshtein(input.toLowerCase(), cmd);
        if (d < bestDist) {
            bestDist = d;
            best = cmd;
        }
    }
    return best;
}
//# sourceMappingURL=cli-config.js.map