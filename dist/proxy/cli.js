#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_server_1 = require("@hono/node-server");
const node_fs_1 = __importDefault(require("node:fs"));
const server_js_1 = require("./server.js");
const handler_js_1 = require("./handler.js");
const models_js_1 = require("../models.js");
const term_js_1 = require("./term.js");
const cli_config_js_1 = require("./cli-config.js");
const daemon_js_1 = require("./daemon.js");
const history_js_1 = require("./history.js");
const platform_js_1 = require("./platform.js");
const COMMANDS = [
    'start', 'stop', 'restart', 'status', 'stats', 'logs',
    'install', 'uninstall', 'init', 'doctor', 'help',
];
const paths = (0, cli_config_js_1.routerPaths)();
// ── Helpers ────────────────────────────────────────────────────────────────
function loadConfigWarned() {
    const { config, error } = (0, cli_config_js_1.loadFileConfig)(paths.configFile);
    if (error) {
        console.error(term_js_1.term.warn() + ` Ignoring invalid config at ${paths.configFile}: ${error}`);
    }
    return config;
}
/** Split command-specific boolean flags out of an arg list before serve parsing. */
function extractFlags(args, flags) {
    const found = new Set();
    const rest = args.filter((a) => {
        if (flags.includes(a)) {
            found.add(a);
            return false;
        }
        return true;
    });
    return { rest, found };
}
function printStep(result) {
    const glyph = result.ok ? term_js_1.term.ok() : result.skipped ? term_js_1.term.warn() : term_js_1.term.fail();
    console.log(`  ${glyph} ${result.detail}`);
}
function modelsForProvider(provider) {
    if (provider === 'bedrock')
        return models_js_1.BEDROCK_MODELS;
    if (provider === 'vertex')
        return models_js_1.VERTEX_MODELS;
    return models_js_1.DEFAULT_MODELS;
}
function resolveOptions(args) {
    return (0, cli_config_js_1.parseServeArgs)(args, loadConfigWarned());
}
// ── start ──────────────────────────────────────────────────────────────────
async function cmdStart(args) {
    const { rest, found } = extractFlags(args, ['--daemon', '-d']);
    const options = resolveOptions(rest);
    if (found.size > 0) {
        const result = await (0, daemon_js_1.startDaemon)((0, cli_config_js_1.serveArgsFrom)(options), options.port, paths);
        if (result.ok) {
            console.log(`${term_js_1.term.ok()} ${result.detail}`);
            console.log(term_js_1.term.dim(`  logs: claude-router logs   stop: claude-router stop`));
        }
        else {
            term_js_1.term.errorLine(result.detail);
            process.exit(1);
        }
        return;
    }
    (0, cli_config_js_1.applyRegionEnv)(options);
    const models = { ...modelsForProvider(options.provider), ...(options.tiers ?? {}) };
    let providerClient;
    try {
        providerClient = await (0, handler_js_1.createProviderClient)(options.provider);
    }
    catch (err) {
        term_js_1.term.errorLine(`Provider init failed: ${String(err)}`);
        process.exit(1);
    }
    const app = (0, server_js_1.createProxyApp)({
        classifier: options.classifier,
        defaultModel: models.sonnet,
        verbose: options.verbose,
        provider: options.provider,
        models,
        forceRoute: options.forceRoute,
        pricing: options.pricing,
        routing: options.routing,
        historyFile: paths.historyFile,
    }, providerClient);
    const regionDisplay = options.region ||
        (options.provider === 'bedrock' ? process.env['AWS_REGION'] ?? 'us-east-1' :
            options.provider === 'vertex' ? process.env['ANTHROPIC_VERTEX_REGION'] ?? 'us-east5' : '');
    const exposed = options.host !== '127.0.0.1' && options.host !== 'localhost';
    if (exposed && (options.provider === 'bedrock' || options.provider === 'vertex')) {
        console.error(term_js_1.term.warn() +
            ` Binding to ${options.host} with the ${options.provider} provider exposes YOUR cloud credentials to the network — incoming requests are not authenticated.`);
    }
    const displayHost = exposed ? options.host : 'localhost';
    const { loaded } = (0, cli_config_js_1.loadFileConfig)(paths.configFile);
    const rows = [
        ['URL', term_js_1.term.accent(`http://${displayHost}:${options.port}`)],
        ['Dashboard', `http://${displayHost}:${options.port}/dashboard`],
        ['Provider', options.provider],
        ['Classifier', options.classifier],
        ['Force-route', options.forceRoute ? term_js_1.term.green('on') : term_js_1.term.dim('off')],
        ['Tiers', `${term_js_1.term.tier('haiku')} ${term_js_1.term.dim('→')} ${models.haiku}`],
        ['', `${term_js_1.term.tier('sonnet')} ${term_js_1.term.dim('→')} ${models.sonnet}`],
        ['', `${term_js_1.term.tier('opus')} ${term_js_1.term.dim('→')} ${models.opus}`],
    ];
    if (exposed)
        rows.push(['Bind', `${options.host} ${term_js_1.term.yellow('(network-exposed)')}`]);
    if (regionDisplay)
        rows.push(['Region', regionDisplay]);
    if (loaded)
        rows.push(['Config', paths.configFile]);
    console.log('\n' + term_js_1.term.box(`claude-router ${term_js_1.term.dim('v' + (0, cli_config_js_1.getVersion)())}`, rows) + '\n');
    process.on('unhandledRejection', (err) => {
        term_js_1.term.errorLine(`Fatal error: ${String(err)}`);
        if (options.provider === 'vertex') {
            console.error('\nVertex auth failed. Run: gcloud auth application-default login');
        }
        else if (options.provider === 'bedrock') {
            console.error('\nBedrock auth failed. Check: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION');
        }
        process.exit(1);
    });
    (0, node_server_1.serve)({ fetch: app.fetch, port: options.port, hostname: options.host });
}
// ── stop / restart ─────────────────────────────────────────────────────────
async function cmdStop() {
    const result = await (0, daemon_js_1.stopDaemon)(paths);
    if (result.ok) {
        console.log(`${term_js_1.term.ok()} ${result.detail}`);
    }
    else {
        term_js_1.term.errorLine(result.detail);
        process.exit(1);
    }
}
async function cmdRestart(args) {
    const state = (0, daemon_js_1.readDaemonState)(paths);
    const stop = await (0, daemon_js_1.stopDaemon)(paths);
    if (!stop.ok) {
        term_js_1.term.errorLine(stop.detail);
        process.exit(1);
    }
    // Reuse the previous daemon's args unless new flags were given
    const options = resolveOptions(args.length > 0 ? args : state?.args ?? []);
    const result = await (0, daemon_js_1.startDaemon)((0, cli_config_js_1.serveArgsFrom)(options), options.port, paths);
    if (result.ok) {
        console.log(`${term_js_1.term.ok()} ${result.detail}`);
    }
    else {
        term_js_1.term.errorLine(result.detail);
        process.exit(1);
    }
}
// ── status ─────────────────────────────────────────────────────────────────
async function cmdStatus(args) {
    const options = resolveOptions(args);
    const health = await (0, daemon_js_1.checkHealth)(options.port);
    const state = (0, daemon_js_1.readDaemonState)(paths);
    if (!health) {
        console.log(`${term_js_1.term.fail()} ${term_js_1.term.bold('stopped')} ${term_js_1.term.dim(`(no proxy on port ${options.port})`)}`);
        if (state && !(0, daemon_js_1.isProcessAlive)(state.pid)) {
            console.log(term_js_1.term.dim(`  stale daemon state found (pid ${state.pid} is gone)`));
        }
        console.log(`\nStart it:  ${term_js_1.term.accent('claude-router start -d')}  ${term_js_1.term.dim('(or claude-router install)')}`);
        process.exitCode = 1;
        return;
    }
    const rows = [
        ['Status', `${term_js_1.term.green('running')}${state ? term_js_1.term.dim(` (pid ${state.pid})`) : ''}`],
        ['URL', `http://localhost:${options.port}`],
        ['Dashboard', `http://localhost:${options.port}/dashboard`],
        ['Provider', health.provider],
        ['Classifier', health.classifier],
        ['Force-route', health.forceRoute ? term_js_1.term.green('on') : term_js_1.term.dim('off')],
        ['Requests', String(health.requests)],
        ['Last tier', health.lastTier ? term_js_1.term.tier(health.lastTier) : term_js_1.term.dim('none')],
        ['Autostart', (0, platform_js_1.isAutostartRegistered)(paths) ? term_js_1.term.green('registered') : term_js_1.term.dim('not registered')],
        ['Env var', (0, platform_js_1.isEnvVarSet)(options.port) ? term_js_1.term.green('set') : term_js_1.term.dim('not set')],
    ];
    console.log('\n' + term_js_1.term.box('claude-router status', rows) + '\n');
}
// ── stats ──────────────────────────────────────────────────────────────────
function cmdStats(args) {
    const asJson = args.includes('--json');
    const stats = (0, history_js_1.readLifetimeStats)(paths.historyFile);
    if (asJson) {
        console.log(JSON.stringify(stats, null, 2));
        return;
    }
    if (stats.requests === 0) {
        console.log(term_js_1.term.dim('No routing history yet — savings are recorded once requests flow through the proxy.'));
        return;
    }
    const tierLine = ['haiku', 'sonnet', 'opus', 'passthrough']
        .filter((t) => stats.tiers[t])
        .map((t) => `${term_js_1.term.tier(t)} ${stats.tiers[t]}`)
        .join(term_js_1.term.dim('  ·  '));
    const rows = [
        ['Requests', String(stats.requests)],
        ['Total cost', `$${(stats.costCents / 100).toFixed(2)}`],
        ['Total saved', stats.savedCents >= 0
                ? term_js_1.term.green(`$${(stats.savedCents / 100).toFixed(2)}`)
                : term_js_1.term.red(`-$${(Math.abs(stats.savedCents) / 100).toFixed(2)}`)],
        ['Auto-retried', String(stats.retried)],
        ['Tiers', tierLine || term_js_1.term.dim('none')],
    ];
    console.log('\n' + term_js_1.term.box('claude-router — lifetime savings', rows));
    const days = Object.keys(stats.byDay).sort().slice(-7);
    if (days.length > 0) {
        console.log('\n' + term_js_1.term.bold('Last 7 days'));
        for (const day of days) {
            const d = stats.byDay[day];
            const saved = d.savedCents >= 0
                ? term_js_1.term.green(`saved $${(d.savedCents / 100).toFixed(2)}`)
                : term_js_1.term.red(`extra $${(Math.abs(d.savedCents) / 100).toFixed(2)}`);
            console.log(`  ${day}  ${String(d.requests).padStart(5)} req   ${saved}`);
        }
    }
    console.log(term_js_1.term.dim(`\nHistory: ${paths.historyFile}`));
}
// ── logs ───────────────────────────────────────────────────────────────────
function cmdLogs(args) {
    let lines = 50;
    let follow = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-f' || arg === '--follow')
            follow = true;
        else if ((arg === '-n' || arg === '--lines') && args[i + 1]) {
            lines = parseInt(args[++i], 10) || 50;
        }
        else {
            term_js_1.term.errorLine(`Unknown option '${arg}' for logs.`);
            process.exit(1);
        }
    }
    if (!node_fs_1.default.existsSync(paths.logFile)) {
        console.log(term_js_1.term.dim(`No log file yet (${paths.logFile}). Start the daemon: claude-router start -d`));
        return;
    }
    const printTail = (fromSize = 0) => {
        const content = node_fs_1.default.readFileSync(paths.logFile, 'utf8');
        if (fromSize === 0) {
            const tail = content.split('\n').slice(-lines - 1).join('\n');
            process.stdout.write(tail.endsWith('\n') ? tail : tail + '\n');
        }
        else if (content.length > fromSize) {
            process.stdout.write(content.slice(fromSize));
        }
        return content.length;
    };
    let size = printTail();
    if (follow) {
        console.log(term_js_1.term.dim('— following (ctrl+c to exit) —'));
        node_fs_1.default.watchFile(paths.logFile, { interval: 500 }, () => {
            size = printTail(size);
        });
    }
}
// ── install / uninstall ────────────────────────────────────────────────────
async function cmdInstall(args) {
    const { rest, found } = extractFlags(args, ['--no-autostart', '--no-env', '--no-statusline']);
    const options = resolveOptions(rest);
    const serveArgs = (0, cli_config_js_1.serveArgsFrom)(options);
    console.log(`\nInstalling claude-router ${term_js_1.term.dim(`(${(0, platform_js_1.platformName)()})`)}\n`);
    let failures = 0;
    // 1. Autostart on login. On macOS/Linux the supervisor (launchd RunAtLoad /
    //    systemd --now) ALSO starts the proxy immediately, so this must run before
    //    we consider starting our own daemon — otherwise both bind the port and the
    //    supervisor's instance loops forever on EADDRINUSE.
    if (!found.has('--no-autostart')) {
        const result = (0, platform_js_1.installAutostart)(serveArgs, paths);
        printStep(result);
        if (!result.ok && !result.skipped)
            failures++;
    }
    // 2. Ensure the proxy is running — but don't start a second one if the
    //    autostart supervisor already brought it up (that's the port race).
    let running = await (0, daemon_js_1.checkHealth)(options.port);
    // Only macOS/Linux supervisors start the proxy at install time; the Windows Run
    // key fires at next login, so there's nothing to wait for there.
    if (!running && !found.has('--no-autostart') && (0, platform_js_1.platformName)() !== 'windows') {
        // Give the just-loaded supervisor a moment to bind the port before deciding.
        for (let i = 0; i < 15 && !running; i++) {
            await new Promise((r) => setTimeout(r, 200));
            running = await (0, daemon_js_1.checkHealth)(options.port);
        }
    }
    if (running) {
        // Record the supervised process so status/stop/restart keep working without
        // a redundant daemon of our own.
        const pid = (0, platform_js_1.supervisorPid)(paths);
        if (pid) {
            (0, daemon_js_1.writeDaemonState)({ pid, port: options.port, startedAt: new Date().toISOString(), args: serveArgs }, paths);
        }
        printStep({
            ok: true,
            detail: pid
                ? `Proxy running on port ${options.port} (pid ${pid}, autostart-supervised)`
                : `Proxy already running on port ${options.port}`,
        });
    }
    else {
        const start = await (0, daemon_js_1.startDaemon)(serveArgs, options.port, paths);
        printStep({ ok: start.ok, detail: start.detail });
        if (!start.ok)
            failures++;
    }
    // 3. Environment variable
    if (!found.has('--no-env')) {
        const result = (0, platform_js_1.setEnvVar)(options.port, paths);
        printStep(result);
        if (!result.ok && !result.skipped)
            failures++;
    }
    // 4. Claude Code statusline
    if (!found.has('--no-statusline')) {
        const result = (0, platform_js_1.addStatusline)(options.port, paths);
        printStep(result);
        if (!result.ok && !result.skipped)
            failures++;
    }
    if (failures > 0) {
        console.log(`\n${term_js_1.term.fail()} Install finished with ${failures} failed step(s) — see above.`);
        process.exit(1);
    }
    const envNote = (0, platform_js_1.platformName)() === 'windows'
        ? 'Open a new terminal (setx applies to new sessions only)'
        : 'Restart your terminal (or: source your shell rc file)';
    console.log(`
${term_js_1.term.ok()} Done. Requests to ${term_js_1.term.accent(`http://localhost:${options.port}`)} are auto-routed.

  ${term_js_1.term.dim('→')} ${envNote}
  ${term_js_1.term.dim('→')} Use ${term_js_1.term.accent('claude')} normally — calls route through the proxy
  ${term_js_1.term.dim('→')} Check anytime: ${term_js_1.term.accent('claude-router status')} · ${term_js_1.term.accent('claude-router doctor')}
`);
}
async function cmdUninstall() {
    console.log(`\nUninstalling claude-router ${term_js_1.term.dim(`(${(0, platform_js_1.platformName)()})`)}\n`);
    const stop = await (0, daemon_js_1.stopDaemon)(paths);
    printStep({ ok: stop.ok, detail: stop.detail, skipped: !stop.ok });
    printStep((0, platform_js_1.uninstallAutostart)(paths));
    printStep((0, platform_js_1.unsetEnvVar)(paths));
    printStep((0, platform_js_1.removeStatusline)(paths));
    console.log(`\n${term_js_1.term.ok()} claude-router uninstalled.\n`);
}
// ── init ───────────────────────────────────────────────────────────────────
function cmdInit(args) {
    const { rest, found } = extractFlags(args, ['--force']);
    if (node_fs_1.default.existsSync(paths.configFile) && !found.has('--force')) {
        term_js_1.term.errorLine(`${paths.configFile} already exists. Use --force to overwrite.`);
        process.exit(1);
    }
    const options = (0, cli_config_js_1.parseServeArgs)(rest, {});
    const config = {
        port: options.port,
        classifier: options.classifier,
        provider: options.provider,
        forceRoute: options.forceRoute,
        verbose: options.verbose,
    };
    if (options.region)
        config.region = options.region;
    if (options.host !== '127.0.0.1')
        config.host = options.host;
    node_fs_1.default.mkdirSync(paths.configDir, { recursive: true });
    node_fs_1.default.writeFileSync(paths.configFile, JSON.stringify(config, null, 2) + '\n', 'utf8');
    console.log(`${term_js_1.term.ok()} Wrote ${paths.configFile}`);
    console.log(term_js_1.term.dim('  Edit it to add per-tier model overrides ("tiers") or pricing ("pricing").'));
}
// ── doctor ─────────────────────────────────────────────────────────────────
async function cmdDoctor(args) {
    const options = resolveOptions(args);
    console.log(`\n${term_js_1.term.bold('claude-router doctor')} ${term_js_1.term.dim(`(${(0, platform_js_1.platformName)()})`)}\n`);
    let failures = 0;
    const check = (ok, label, hint, warnOnly = false) => {
        const glyph = ok ? term_js_1.term.ok() : warnOnly ? term_js_1.term.warn() : term_js_1.term.fail();
        console.log(`  ${glyph} ${label}`);
        if (!ok && hint)
            console.log(term_js_1.term.dim(`      ${hint}`));
        if (!ok && !warnOnly)
            failures++;
    };
    const [major] = process.versions.node.split('.').map(Number);
    check(major >= 18, `Node ${process.versions.node} (need ≥ 18)`);
    const { loaded, error } = (0, cli_config_js_1.loadFileConfig)(paths.configFile);
    if (error)
        check(false, `Config file invalid: ${error}`, `Fix or regenerate: claude-router init --force`);
    else
        check(true, loaded ? `Config file loaded (${paths.configFile})` : 'No config file (defaults in use)');
    const health = await (0, daemon_js_1.checkHealth)(options.port);
    check(health !== null, health ? `Proxy healthy on port ${options.port}` : `No proxy responding on port ${options.port}`, 'Start it: claude-router start -d');
    const envOk = (0, platform_js_1.isEnvVarSet)(options.port);
    check(envOk, envOk
        ? `ANTHROPIC_BASE_URL points at the proxy`
        : `ANTHROPIC_BASE_URL is not set to http://localhost:${options.port}`, (0, platform_js_1.platformName)() === 'windows'
        ? `Set it: setx ANTHROPIC_BASE_URL http://localhost:${options.port} (then open a new terminal)`
        : `Add to your shell rc: export ANTHROPIC_BASE_URL=http://localhost:${options.port}`);
    check(Boolean(process.env['ANTHROPIC_API_KEY']) || options.provider !== 'anthropic', process.env['ANTHROPIC_API_KEY']
        ? 'ANTHROPIC_API_KEY is set'
        : 'ANTHROPIC_API_KEY not set (fine if Claude Code sends its own auth)', undefined, true);
    const state = (0, daemon_js_1.readDaemonState)(paths);
    if (state) {
        check((0, daemon_js_1.isProcessAlive)(state.pid), (0, daemon_js_1.isProcessAlive)(state.pid)
            ? `Daemon state matches a live process (pid ${state.pid})`
            : `Stale daemon state (pid ${state.pid} is gone)`, 'Clear it by restarting: claude-router restart', true);
    }
    check((0, platform_js_1.isAutostartRegistered)(paths), (0, platform_js_1.isAutostartRegistered)(paths) ? 'Autostart registered' : 'Autostart not registered', 'Register it: claude-router install', true);
    check((0, platform_js_1.isStatuslineConfigured)(paths), (0, platform_js_1.isStatuslineConfigured)(paths) ? 'Claude Code statusline configured' : 'Statusline not configured', 'Add it: claude-router install', true);
    console.log(failures === 0
        ? `\n${term_js_1.term.ok()} Everything looks good.\n`
        : `\n${term_js_1.term.fail()} ${failures} problem(s) found.\n`);
    process.exit(failures);
}
// ── help ───────────────────────────────────────────────────────────────────
function printHelp() {
    const a = (s) => term_js_1.term.accent(s);
    const d = (s) => term_js_1.term.dim(s);
    console.log(`
${term_js_1.term.bold('claude-router')} ${d('v' + (0, cli_config_js_1.getVersion)())} — auto-route Claude API calls by prompt complexity

${term_js_1.term.bold('Usage')}
  ${a('claude-router install')} [options]     One-time setup: daemon + autostart + env + statusline
  ${a('claude-router uninstall')}             Remove everything install added
  ${a('claude-router start')} [options]       Run the proxy in the foreground
  ${a('claude-router start -d')}              Run it in the background (daemon)
  ${a('claude-router stop')}                  Stop the background proxy
  ${a('claude-router restart')} [options]     Restart the background proxy
  ${a('claude-router status')}                Health, routing stats, install state
  ${a('claude-router stats')} [--json]        Lifetime savings and per-day breakdown
  ${a('claude-router logs')} [-f] [-n N]      Show (or follow) the daemon log
  ${a('claude-router init')} [--force]        Scaffold ~/.claude-router/config.json
  ${a('claude-router doctor')}                Diagnose common setup problems

${term_js_1.term.bold('Options')} ${d('(install / start / restart / status / doctor)')}
  --port, -p <number>      Port (default: 4000)
  --host <address>         Bind address (default: 127.0.0.1 — local only; 0.0.0.0 exposes to the network)
  --force-route            Route even explicit model requests — required for Claude Code
  --verbose, -v            Log each routing decision
  --classifier <mode>      heuristic | ai | hybrid (default: hybrid)
  --provider <mode>        anthropic | bedrock | vertex (default: anthropic)
  --region <string>        AWS/GCP region
  --version, -V            Print version

${term_js_1.term.bold('Install-only options')}
  --no-autostart           Skip login autostart registration
  --no-env                 Skip setting ANTHROPIC_BASE_URL
  --no-statusline          Skip the Claude Code statusline

${term_js_1.term.bold('Config file')} ${d('(~/.claude-router/config.json — flags always win)')}
  Any option above, plus per-tier model overrides ("tiers"), pricing ("pricing"),
  and classifier tuning ("routing"). Scaffold with: ${a('claude-router init')}

${term_js_1.term.bold('Quick start')}
  ${a('claude-router install --force-route')}
  ${d('# open a new terminal, then use `claude` normally')}
`);
}
// ── Entry ──────────────────────────────────────────────────────────────────
async function main() {
    const [subcommand, ...rest] = process.argv.slice(2);
    if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
        printHelp();
        return;
    }
    if (subcommand === '--version' || subcommand === '-V') {
        console.log((0, cli_config_js_1.getVersion)());
        return;
    }
    // Legacy invocation: bare flags with no subcommand used to mean `start`
    if (subcommand.startsWith('-')) {
        console.error(term_js_1.term.warn() + ' Deprecated: bare flags now require the `start` subcommand — running `start` for you.');
        await cmdStart(process.argv.slice(2));
        return;
    }
    if (rest.includes('--help') || rest.includes('-h')) {
        printHelp();
        return;
    }
    switch (subcommand) {
        case 'start': return cmdStart(rest);
        case 'stop': return cmdStop();
        case 'restart': return cmdRestart(rest);
        case 'status': return cmdStatus(rest);
        case 'stats': return cmdStats(rest);
        case 'logs': return cmdLogs(rest);
        case 'install': return cmdInstall(rest);
        case 'uninstall': return cmdUninstall();
        case 'init': return cmdInit(rest);
        case 'doctor': return cmdDoctor(rest);
        default: {
            const suggestion = (0, cli_config_js_1.suggestCommand)(subcommand, COMMANDS);
            term_js_1.term.errorLine(`Unknown command '${subcommand}'.` + (suggestion ? ` Did you mean '${suggestion}'?` : ''));
            console.error(term_js_1.term.dim(`Run 'claude-router help' for usage.`));
            process.exit(1);
        }
    }
}
main().catch((err) => {
    if (err instanceof cli_config_js_1.CliUsageError) {
        term_js_1.term.errorLine(err.message);
    }
    else {
        term_js_1.term.errorLine(String(err));
    }
    process.exit(1);
});
//# sourceMappingURL=cli.js.map