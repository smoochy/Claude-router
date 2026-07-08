import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { type HandlerConfig } from './handler.js';
export declare function createProxyApp(config: HandlerConfig, providerClient?: Anthropic | null): Hono;
//# sourceMappingURL=server.d.ts.map