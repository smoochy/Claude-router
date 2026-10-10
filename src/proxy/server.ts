import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { handleMessages, handlePassthrough, registerAgent, routeHistory, routeCounters, type HandlerConfig } from './handler.js';
import { getVersion } from './cli-config.js';
import { renderDashboard, DASHBOARD_MODES, TIME_WINDOWS, type DashboardMode, type DashboardFilters } from './dashboard.js';
import { readLifetimeStats } from './history.js';
import { buildHealth, formatStatusLine } from './health.js';

export function createProxyApp(
  config: HandlerConfig,
  providerClient: Anthropic | null = null,
): Hono {
  const app = new Hono();
  // routingMode is optional on HandlerConfig (tests built pre-dating it still
  // construct configs with only `forceRoute`) — buildHealth needs it resolved.
  const health = {
    ...config,
    routingMode: config.routingMode ?? (config.forceRoute ? ('route' as const) : ('observe' as const)),
    version: getVersion(),
  };

  // Deliberately NO CORS middleware. Every legitimate consumer is same-origin
  // (the dashboard) or CORS-exempt (Node fetch from the CLI/statusline). A
  // wildcard here let any webpage in the operator's browser POST /v1/messages
  // to localhost and read the response — with bedrock/vertex that spends the
  // operator's cloud credentials with no authentication. Browsers blocking
  // cross-origin reads IS the security boundary; do not add cors() back.

  app.get('/health', (c) => c.json(buildHealth(health, routeHistory, routeCounters.recorded)));

  // Preformatted statusline text for the shell statusline command — plain text,
  // so the installed `curl` one-liner needs no JSON parsing (no jq/python).
  app.get('/statusline', (c) => c.text(formatStatusLine(buildHealth(health, routeHistory, routeCounters.recorded))));

  app.get('/api/last-route', (c) => {
    const last = routeHistory[routeHistory.length - 1] ?? null;
    return c.json(last);
  });

  // The plugin's SubagentStart hook reports each subagent's agent type here so
  // the `agents` config mapping can pin third-party agents by name. Loopback
  // only by virtue of the bind address; the payload is two short strings.
  app.post('/api/agents', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: { type: 'invalid_request_error', message: 'Request body is not valid JSON' } }, 400);
    }
    const { agentId, agentType, sessionId } = body;
    const short = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
    if (!short(agentId) || !short(agentType)) {
      return c.json({ error: { type: 'invalid_request_error', message: 'agentId and agentType are required strings' } }, 400);
    }
    registerAgent(agentId, agentType, short(sessionId) ? sessionId : undefined);
    return c.body(null, 204);
  });

  app.get('/dashboard', (c) => {
    const lifetime = config.historyFile ? readLifetimeStats(config.historyFile) : undefined;
    const requestedMode = c.req.query('mode');
    const mode: DashboardMode = (DASHBOARD_MODES as readonly string[]).includes(requestedMode ?? '')
      ? (requestedMode as DashboardMode)
      : 'all';
    const requestedWindow = c.req.query('window');
    const window = (TIME_WINDOWS as readonly string[]).includes(requestedWindow ?? '')
      ? (requestedWindow as DashboardFilters['window'])
      : undefined;
    const filters: DashboardFilters = {
      mode,
      role: c.req.query('role') || undefined,
      model: c.req.query('model') || undefined,
      tier: c.req.query('tier') || undefined,
      session: c.req.query('session') || undefined,
      window,
      auto: c.req.query('auto') !== '0',
    };
    return c.html(renderDashboard(routeHistory, lifetime, filters));
  });

  app.post('/v1/messages', (c) => handleMessages(c, config, providerClient));

  // Registered LAST, so every route above still wins on first match. Everything
  // else belongs to the origin, not to us: the non-routable /v1 endpoints
  // (count_tokens, model listing, …) and the paths outside /v1 alike — Claude
  // Code probes `HEAD /api/hello` on startup and also calls /api/organizations.
  // Scoping this to /v1/* made the router answer 404 for endpoints the origin
  // serves, which is a failure we invented rather than one the client would hit.

  // The paths this proxy answers itself, reserved on *every* method. Route
  // ordering only protects each one for the method it registers: `GET /dashboard`
  // matches above, `POST /dashboard` does not — it reaches the catch-all, and
  // handlePassthrough forwards it to api.anthropic.com with the operator's
  // x-api-key attached. Reaching here on one of these means the method is wrong,
  // not that the path belongs to the origin.
  const routerSurface = new Set(['/health', '/statusline', '/api/last-route', '/api/agents', '/dashboard']);
  app.all('*', (c) => {
    if (routerSurface.has(c.req.path)) {
      return c.json(
        { error: { type: 'invalid_request_error', message: `${c.req.method} ${c.req.path} is not allowed` } },
        405,
      );
    }
    return handlePassthrough(c, config);
  });

  return app;
}
