# Other providers

The proxy binds to `127.0.0.1` by default - only your own machine can reach it.

The tier IDs follow the 5.5 generation, matching the first-party defaults. They come from the [Anthropic models overview](https://platform.claude.com/docs/en/about-claude/models/overview) and the AWS Bedrock model cards, not from a live console:

| Tier | Bedrock (US geo profile) | Vertex AI |
|---|---|---|
| haiku | `us.anthropic.claude-haiku-5-5` | `claude-haiku-5-5` |
| sonnet | `us.anthropic.claude-sonnet-5-5` | `claude-sonnet-5-5` |
| opus | `us.anthropic.claude-opus-5-5` | `claude-opus-5-5` |
| fable | `us.anthropic.claude-fable-5-1` | `claude-fable-5-1` |

Two things to know. Bedrock also offers `global.`, `eu.` and `au.` profiles (Haiku and Opus add `jp.`); to use one, override the tier via `tiers.<tier>` in `~/.claude-router/config.json`. Fable 5.1 on Bedrock only has a US geo and a global profile and needs the `aws_review` data-retention opt-in, so enable `routing.allowFable` there only after you have checked your account. If a profile 400s, confirm it in your console.

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
