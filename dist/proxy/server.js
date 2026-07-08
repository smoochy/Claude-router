"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProxyApp = createProxyApp;
const hono_1 = require("hono");
const cors_1 = require("hono/cors");
const handler_js_1 = require("./handler.js");
const dashboard_js_1 = require("./dashboard.js");
const history_js_1 = require("./history.js");
function createProxyApp(config, providerClient = null) {
    const app = new hono_1.Hono();
    app.use('*', (0, cors_1.cors)());
    app.get('/health', (c) => {
        const last = handler_js_1.routeHistory[handler_js_1.routeHistory.length - 1] ?? null;
        return c.json({
            status: 'ok',
            service: 'claude-router-proxy',
            classifier: config.classifier,
            provider: config.provider,
            forceRoute: config.forceRoute,
            requests: handler_js_1.routeHistory.length,
            lastTier: last?.tier ?? null,
            lastModel: last?.model ?? null,
        });
    });
    app.get('/api/last-route', (c) => {
        const last = handler_js_1.routeHistory[handler_js_1.routeHistory.length - 1] ?? null;
        return c.json(last);
    });
    app.get('/dashboard', (c) => {
        const lifetime = config.historyFile ? (0, history_js_1.readLifetimeStats)(config.historyFile) : undefined;
        return c.html((0, dashboard_js_1.renderDashboard)(handler_js_1.routeHistory, lifetime));
    });
    app.post('/v1/messages', (c) => (0, handler_js_1.handleMessages)(c, config, providerClient));
    // Everything else under /v1 (count_tokens, model listing, …) is not routable —
    // forward it verbatim to Anthropic so the client doesn't 404 on count_tokens.
    app.all('/v1/*', (c) => (0, handler_js_1.handlePassthrough)(c, config));
    return app;
}
//# sourceMappingURL=server.js.map