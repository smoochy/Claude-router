# Other providers

The proxy binds to `127.0.0.1` by default - only your own machine can reach it.

> ⚠️ **Fable on Bedrock / Vertex is not wired up.** Fable 5's inference-profile ID on those platforms is unverified, so the `fable` tier resolves to **Opus** there rather than risking a 404 - a request routed to fable on Bedrock or Vertex silently runs on Opus instead. This is inert while `routing.allowFable` is off (the default). If you enable fable on Bedrock or Vertex, set the real ID yourself via `tiers.fable` in `~/.claude-router/config.json` and verify it against your console first. On the first-party Anthropic API, fable routes to `claude-fable-5` as expected.

## AWS Bedrock

```bash
npm install @anthropic-ai/bedrock-sdk

AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1 \
  npx @smoochy/claude-router start --provider bedrock --port 4000
# auth comes from AWS env vars - no x-api-key needed
export ANTHROPIC_BASE_URL=http://localhost:4000
```

## Google Vertex AI

```bash
npm install @anthropic-ai/vertex-sdk
gcloud auth application-default login

ANTHROPIC_VERTEX_PROJECT_ID=my-project \
  npx @smoochy/claude-router start --provider vertex --port 4000
```

Back to the [README](../README.md).
