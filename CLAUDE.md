# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # TypeScript compilation to build/
npm run dev            # Run with tsx (no build step)
npm test               # Unit tests only (CI-safe, mocked, no real CLIs)
npm run test:local     # Integration + stress tests (requires real CLIs installed)
npm run test:all       # All tests: unit + integration + stress
npm run test:watch     # Vitest watch mode
npm run lint           # Type-check (tsc --noEmit)
npm run inspect        # MCP Inspector for debugging tool calls
```

Test files: `*.test.ts` run in CI; `*.local.ts` (integration/stress) run only locally via `test:local` or `test:all`.

## Architecture

MCP server that orchestrates three AI CLI tools (Claude CLI, Gemini CLI, Codex CLI) with resilience patterns. Runs over stdio transport.

**Request flow**: MCP client → `cli_execute` tool → resilience pipeline (retry + circuit breaker + fallback) → CLI process execution → redacted output back to client.

### Core Modules

- **`src/cli/definitions.ts`** — Provider configs (binary names, arg builders, fallback chains). Each CLI has distinct arg formats: Claude uses `-p` with `--allowedTools ""`, Gemini uses `-e none -p`, Codex uses `exec --full-auto`.
- **`src/cli/detection.ts`** — Auto-detects installed CLIs via `which`/`where` with 5-minute cache per provider.
- **`src/cli/executor.ts`** — Process execution via execa. Handles Windows .cmd/.bat shim detection, stdin fallback for prompts >30KB, PATH augmentation on Windows.
- **`src/cli/circuit-breaker.ts`** — Per-provider state machine (closed→open→half-open). Opens after 3 consecutive failures, 60s cooldown.
- **`src/cli/resilience.ts`** — Orchestrates retry (max 2 retries, exponential backoff with jitter), circuit breaker checks, and fallback chain traversal. Non-retryable errors (auth, permanent) skip directly to fallback.

### MCP Surface

Four tools: `cli_execute` (run prompt with resilience), `cli_stats` (health dashboard), `cli_list` (installed CLIs), `cli_route` (role-based recommendation). One resource: `mcp://cli-stats`. Two prompts: `code_review`, `architecture_design`.

### Security

- **Environment filtering** (`src/utils/env-allowlist.ts`): Only whitelisted env vars (PATH, HOME, TERM, etc.) forwarded to subprocesses. CLIs handle their own auth.
- **Secret redaction** (`src/utils/redact.ts`): API key patterns (`sk-`, `key-`, `AIza`) scrubbed from all output/errors before returning to client.
- Commands built as arrays (no shell interpolation). execa runs without shell.

### Type Patterns

- `CliProvider = "claude" | "gemini" | "codex"` used throughout.
- All tool inputs validated with Zod schemas in `src/tools/orchestrator.ts`.
- Role-based routing table in `src/types/index.ts` maps agent roles (developer, reviewer, architect, etc.) to primary CLI + fallback chain.

### Testing

Unit tests mock `execa` and test each module in isolation. Stress tests (`tests/stress.local.ts`) cover concurrency (10+ parallel), large output (5MB), abort signals, circuit breaker rapid-fire, and timeout enforcement. Integration tests (`tests/integration.local.ts`) hit real CLIs.
