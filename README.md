# cli-orchestrator-mcp

MCP Server for **resilient multi-CLI orchestration** — execute AI tasks inline via Claude, Gemini, or Codex with automatic retry, circuit breaker, and fallback.

Works with any MCP-compatible client: **Claude Code**, **Codex CLI**, **Gemini CLI**, **OpenCode**, and more.

## Features

- **Inline CLI Execution** — Runs Claude, Gemini, and Codex directly as installed on your machine (no API keys needed)
- **Role-based Routing** — Automatically select the best CLI based on agent role
- **Circuit Breaker** — Per-provider fault isolation (closed → open → half-open)
- **Retry with Backoff** — Exponential backoff with jitter for transient failures
- **Automatic Fallback** — If primary CLI fails, try alternatives in order
- **Abort-aware** — AbortSignal support cancels execution and stops retries immediately
- **Auto-detection** — Discovers installed CLIs at startup with 5-minute cache
- **Large Prompt Handling** — Prompts >30KB sent via stdin to avoid OS arg-length limits
- **Cross-platform** — Windows (.cmd/.bat shim support), macOS, Linux

## Quick Start

```bash
npx -y cli-orchestrator-mcp
```

**Prerequisites:** Node.js ≥18 and at least one CLI installed and authenticated:

| CLI | Install | Auth |
|-----|---------|------|
| Claude | `npm i -g @anthropic-ai/claude-code` | `claude` (interactive login) |
| Gemini | `npm i -g @anthropic-ai/gemini-cli` | `gemini` (Google auth) |
| Codex | `npm i -g @openai/codex` | `codex` (OpenAI auth) |

CLIs handle their own authentication inline — no API keys or env vars required.

## Configuration

### Claude Code

```bash
claude mcp add cli-orchestrator --transport stdio -- npx -y cli-orchestrator-mcp
```

### Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.cli-orchestrator]
command = "npx"
args = ["-y", "cli-orchestrator-mcp"]
```

### Gemini CLI (`settings.json`)

```json
{
  "mcpServers": {
    "cli-orchestrator": {
      "command": "npx",
      "args": ["-y", "cli-orchestrator-mcp"]
    }
  }
}
```

### OpenCode (`opencode.json`)

```json5
mcp: {
  servers: {
    "cli-orchestrator": { command: "npx", args: ["-y", "cli-orchestrator-mcp"] }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `cli_execute` | Execute a task on a CLI with full resilience (retry + circuit breaker + fallback) |
| `cli_stats` | Health dashboard with per-provider installation, circuit breaker state, and execution stats |
| `cli_list` | List all installed CLI providers with their paths and capabilities |
| `cli_route` | Suggest best CLI for a task based on agent role |

### `cli_execute`

Execute a prompt on a specific CLI provider with full resilience pipeline.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cli` | string | Yes | Provider: `claude`, `gemini`, or `codex` |
| `prompt` | string | Yes | The prompt to send (max 100KB) |
| `mode` | string | No | `generate` (default) or `analyze` |
| `timeout_seconds` | number | No | Execution timeout (default: 720s, max: 1800s) |
| `allow_fallback` | boolean | No | Enable fallback chain (default: true) |
| `cwd` | string | No | Working directory for the CLI |

**CLI Arguments by Provider:**

| Provider | Generate mode | Analyze mode |
|----------|--------------|--------------|
| Claude | `-p <prompt> --allowedTools ""` | `-p <prompt> --max-turns 10` |
| Gemini | `-e none -p <prompt>` | `-e none -p <prompt>` |
| Codex | `exec <prompt> --full-auto` | `exec <prompt> --full-auto` |

### `cli_route`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `role` | string | Yes | Agent role: `manager`, `coordinator`, `developer`, `researcher`, `reviewer`, `architect` |
| `task_description` | string | No | Optional task context for better routing |

## Resources

| URI | Description |
|-----|-------------|
| `mcp://cli-stats` | Real-time health dashboard as JSON resource |

## Prompts

| Prompt | Description | Inputs |
|--------|-------------|--------|
| `code_review` | Generate a code review request | `code` (required), `language` (optional) |
| `architecture_design` | Generate an architecture design request | `requirements` (required) |

## Role-based Routing

| Role | Primary CLI | Strengths | Fallbacks |
|------|-------------|-----------|-----------|
| **Manager** | Gemini | research, trends, large-context | Claude → Codex |
| **Coordinator** | Claude | reasoning, planning, architecture | Gemini → Codex |
| **Developer** | Codex | code-generation, refactoring | Claude → Gemini |
| **Researcher** | Gemini | knowledge, web-search | Claude → Codex |
| **Reviewer** | Claude | code-analysis, debugging | Gemini → Codex |
| **Architect** | Claude | system design, architecture | Gemini → Codex |

## Resilience Pipeline

```
Request → Route by Role → Check Circuit Breaker → Execute CLI
                                                      ↓
                                              Success? → Done
                                              Retryable? → Retry (max 2, exp backoff)
                                              Timeout? → Skip to Next Provider
                                              Permanent? → Next Provider in Fallback Chain
                                              Aborted? → Stop Immediately
                                              All Failed? → Return Error
```

**Circuit Breaker States:**
- **Closed** — Normal operation, track failures
- **Open** — After 3 consecutive failures, reject for 60s
- **Half-open** — After cooldown, allow 1 test request

**Retry Configuration:**
- Max retries: 2 (3 total attempts)
- Base delay: 1s with exponential backoff (max 10s)
- Jitter: ±30%
- Retryable errors: rate limits (429), server errors (503), ECONNRESET, ETIMEDOUT
- Non-retryable: timeouts (skip to fallback), auth errors, permanent failures

**Abort Handling:**
- AbortSignal cancels the running CLI process immediately
- Retry backoff sleeps are abort-aware — no wasted wait time
- Signal is checked between retry attempts and between providers

## Security

- **Safe Environment** — Only essential system variables forwarded to CLI subprocesses (PATH, HOME, TERM, proxy settings)
- **No API Keys in Env** — CLIs authenticate inline via their own config, no env var secrets needed
- **Secret Redaction** — API keys and tokens automatically redacted from logs and error output
- **No Shell Execution** — Commands built as arrays, never via string concatenation or `shell: true`

## Development

```bash
git clone https://github.com/lleontor705/cli-orchestrator-mcp.git
cd cli-orchestrator-mcp
npm install
npm run build         # Compile TypeScript
npm run dev           # Run in development mode
npm test              # Unit tests (CI-safe, no CLIs needed)
npm run test:all      # All tests including stress & integration (local only)
npm run lint          # Type-check without emitting
npm run inspect       # Inspect MCP server with inspector tool
```

### Test Suites

| Command | Tests | Environment |
|---------|-------|-------------|
| `npm test` | Unit tests (definitions, detection, circuit breaker, resilience) | CI — fast, mocked, no real CLIs |
| `npm run test:all` | Unit + stress + integration | Local — includes timeout stress, concurrency, abort, and real CLI execution |

**Stress tests cover:** timeout enforcement, abort/cancellation, concurrent execution (10+ parallel), fallback chain timing, large output (5MB+), circuit breaker under rapid-fire, large prompt stdin handling.

## License

MIT
