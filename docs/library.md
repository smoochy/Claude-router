# Use as a library

Prefer to route inside your own app instead of running a proxy? Import it directly.

```bash
npm install @smoochy/claude-router
```

```typescript
import { createRouter } from '@smoochy/claude-router';

const router = createRouter({ apiKey: process.env.ANTHROPIC_API_KEY!, verbose: true });

const response = await router.send({
  messages: [{ role: 'user', content: 'Translate to French: Hello world' }],
  max_tokens: 100,
});

console.log(response.meta.tier);       // 'haiku'
console.log(response.meta.savedCents); // 1.2
```

**Streaming** - `await router.stream(...)` classifies first, then returns the real SDK `MessageStream`; `meta` resolves after the stream completes:

```typescript
const { stream, meta } = await router.stream({
  messages: [{ role: 'user', content: 'Write a detailed essay on quantum computing' }],
  max_tokens: 4096,
});

for await (const event of stream) {
  // standard @anthropic-ai/sdk stream events; .on()/.finalMessage() work too
}

const routeMeta = await meta;
console.log(routeMeta.tier); // 'sonnet'
```

**Force a tier / read session stats:**

```typescript
await router.send({ messages: [/* … */], max_tokens: 50, tier: 'opus' }); // skip the classifier

console.log(router.stats());
// { totalCostCents: 5.3, totalSavedCents: 47.3, callCount: 120,
//   tierBreakdown: { haiku: 72, sonnet: 41, opus: 7 } }
```

## Full `createRouter` options and `RouteMeta` shape

```typescript
const router = createRouter({
  apiKey: 'sk-...',
  classifier: 'hybrid',            // 'heuristic' | 'ai' | 'hybrid' (default: 'hybrid')
  defaultModel: 'claude-sonnet-5-5', // baseline for savings (default: sonnet tier)
  tiers: {                         // override model IDs per tier
    haiku: 'claude-haiku-5-5',
    sonnet: 'claude-sonnet-5-5',
    opus: 'claude-opus-5-5',
  },
  pricing: {                       // override $/1M token pricing
    'claude-sonnet-5-5': { input: 2.0, output: 10.0 },
  },
  fallback: true,                  // auto-fallback to next tier on rate limit (default: true)
  verbose: true,                   // log routing decisions (default: false)
  routing: {                       // classifier tuning (defaults shown)
    allowFable: false,             // let classification reach fable (depth AND long-horizon evidence required)
    aiTimeoutMs: 1500,             // AI classifier timeout → heuristic fallback
    classifyCacheSize: 500,        // LRU size for AI results (0 disables)
    allowHaikuInAgentic: false,    // let trivial tool-using turns reach haiku (default: floor at sonnet)
  },
});
```

Every `send` / `stream` response includes a `meta` object:

```typescript
interface RouteMeta {
  tier: 'haiku' | 'sonnet' | 'opus';
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;          // actual cost in cents
  savedCents: number;         // vs baseline (negative when routed to opus)
  classifierMethod: 'heuristic' | 'ai';
  classifierMs: number;
  confidence: number;         // 0-1
  fallbackUsed: boolean;      // rate-limited and escalated
  retried: boolean;           // auto-retried on bad output
  retryReason: string | null; // 'truncation' | 'refusal' | null
}
```

Back to the [README](../README.md).
