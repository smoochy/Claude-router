"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const platform_js_1 = require("../proxy/platform.js");
(0, node_test_1.describe)('buildPlist', () => {
    (0, node_test_1.it)('contains node path, cli path, and args as strings', () => {
        const plist = (0, platform_js_1.buildPlist)('/usr/local/bin/node', '/opt/app/cli.js', ['--port', '4000'], '/home/u/.claude-router/proxy.log');
        strict_1.default.ok(plist.includes('<string>/usr/local/bin/node</string>'));
        strict_1.default.ok(plist.includes('<string>/opt/app/cli.js</string>'));
        strict_1.default.ok(plist.includes('<string>start</string>'));
        strict_1.default.ok(plist.includes('<string>--port</string>'));
        strict_1.default.ok(plist.includes('<string>4000</string>'));
        strict_1.default.ok(plist.includes('proxy.log'));
    });
    (0, node_test_1.it)('escapes XML-special characters in paths', () => {
        const plist = (0, platform_js_1.buildPlist)('/node', '/path/with <weird> & "chars"/cli.js', [], '/log');
        strict_1.default.ok(plist.includes('&lt;weird&gt; &amp; &quot;chars&quot;'));
        strict_1.default.ok(!plist.includes('<weird>'));
    });
});
(0, node_test_1.describe)('buildRunKeyCommand', () => {
    (0, node_test_1.it)('quotes paths with spaces and includes --daemon', () => {
        const cmd = (0, platform_js_1.buildRunKeyCommand)('C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\Some User\\cli.js', ['--port', '4000', '--force-route']);
        strict_1.default.ok(cmd.startsWith('"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Some User\\cli.js" start --daemon'));
        strict_1.default.ok(cmd.includes('--port 4000'));
        strict_1.default.ok(cmd.includes('--force-route'));
    });
});
(0, node_test_1.describe)('buildSystemdUnit', () => {
    (0, node_test_1.it)('has a correct ExecStart line', () => {
        const unit = (0, platform_js_1.buildSystemdUnit)('/usr/bin/node', '/opt/cli.js', ['--port', '4000']);
        strict_1.default.ok(unit.includes('ExecStart=/usr/bin/node /opt/cli.js start --port 4000'));
        strict_1.default.ok(unit.includes('WantedBy=default.target'));
    });
    (0, node_test_1.it)('quotes arguments containing spaces', () => {
        const unit = (0, platform_js_1.buildSystemdUnit)('/usr/bin/node', '/opt/my app/cli.js', []);
        strict_1.default.ok(unit.includes('"/opt/my app/cli.js"'));
    });
});
(0, node_test_1.describe)('rc block', () => {
    (0, node_test_1.it)('is marker-delimited and removable', () => {
        const block = (0, platform_js_1.buildRcBlock)(4000);
        strict_1.default.ok(block.includes('export ANTHROPIC_BASE_URL=http://localhost:4000'));
        const content = `# my stuff\nalias ll='ls -la'\n${block}\n# more`;
        const cleaned = (0, platform_js_1.removeRcBlock)(content);
        strict_1.default.ok(!cleaned.includes('ANTHROPIC_BASE_URL'));
        strict_1.default.ok(!cleaned.includes('claude-router'));
        strict_1.default.ok(cleaned.includes("alias ll='ls -la'"));
        strict_1.default.ok(cleaned.includes('# more'));
    });
    (0, node_test_1.it)('removes blocks written for any port', () => {
        const content = `pre\n${(0, platform_js_1.buildRcBlock)(9999)}\npost`;
        const cleaned = (0, platform_js_1.removeRcBlock)(content);
        strict_1.default.ok(!cleaned.includes('9999'));
        strict_1.default.ok(cleaned.includes('pre') && cleaned.includes('post'));
    });
    (0, node_test_1.it)('removes the legacy single-marker format', () => {
        const content = `pre\n# claude-router\nexport ANTHROPIC_BASE_URL=http://localhost:4000\npost`;
        const cleaned = (0, platform_js_1.removeRcBlock)(content);
        strict_1.default.ok(!cleaned.includes('ANTHROPIC_BASE_URL'));
        strict_1.default.ok(!cleaned.includes('# claude-router'));
        strict_1.default.ok(cleaned.includes('pre') && cleaned.includes('post'));
    });
});
(0, node_test_1.describe)('statusline', () => {
    (0, node_test_1.it)('uses 127.0.0.1 with the given port and node (no curl/python)', () => {
        const cmd = (0, platform_js_1.buildStatuslineCommand)(4321);
        strict_1.default.ok(cmd.startsWith('node -e'));
        strict_1.default.ok(cmd.includes('http://127.0.0.1:4321/health'));
        strict_1.default.ok(!cmd.includes('curl'));
        strict_1.default.ok(!cmd.includes('python'));
    });
    (0, node_test_1.it)('is JSON-embedding safe (single outer double-quote pair)', () => {
        const cmd = (0, platform_js_1.buildStatuslineCommand)(4000);
        // Exactly two double quotes: around the -e script
        strict_1.default.equal((cmd.match(/"/g) ?? []).length, 2);
        // Round-trips through JSON (as it will live in settings.json)
        strict_1.default.equal(JSON.parse(JSON.stringify(cmd)), cmd);
    });
    (0, node_test_1.it)('recognizes both current and legacy installed commands', () => {
        strict_1.default.ok((0, platform_js_1.isOurStatusline)((0, platform_js_1.buildStatuslineCommand)(4000)));
        const legacyCurl = `curl -sf --max-time 0.3 http://localhost:4000/health | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('lastTier') or 'ready'; r=d.get('requests',0); print(f'[auto:{t} #{r}]')" 2>/dev/null || echo '[auto:off]'`;
        strict_1.default.ok((0, platform_js_1.isOurStatusline)(legacyCurl));
        strict_1.default.ok(!(0, platform_js_1.isOurStatusline)('my-custom-statusline --fancy'));
    });
});
//# sourceMappingURL=platform.test.js.map