# cli-orchestrator-mcp

MCP Server for **resilient multi-CLI orchestration** — route AI tasks to Claude, Gemini, Codex, or Ollama with automatic retry, circuit breaker, and fallback.

Works with any MCP-compatible client: **Claude Code**, **Codex CLI**, **Gemini CLI**, **OpenClaw**, and more.

## Features

- **Role-based Routing** — Automatically select the best CLI based on agent role
- **Circuit Breaker** — Per-provider fault isolation (closed → open → half-open)
- **Retry with Backoff** — Exponential backoff with jitter for transient failures
- **Automatic Fallback** — If primary CLI fails, try alternatives in order
- **Auto-detection** — Discovers installed CLIs at startup with 5-minute cache
- **Security Hardening** — Whitelist-based env filtering, secret redaction in logs
- **Cross-platform** — Windows (.cmd/.bat shim support), macOS, Linux

## Quick Start

```bash
npx -y cli-orchestrator-mcp
```

**Prerequisites:** Node.js ≥18 and at least one CLI installed: `claude`, `gemini`, `codex`, or `ollama`.

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

### OpenClaw (`openclaw.json`)

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
| `cli` | string | Yes | Provider: `claude`, `gemini`, `codex`, or `ollama` |
| `prompt` | string | Yes | The prompt to send |
| `mode` | string | No | `generate` (default) or `analyze` |
| `timeout_seconds` | number | No | Execution timeout (default: 30s) |
| `allow_fallback` | boolean | No | Enable fallback chain (default: true) |
| `cwd` | string | No | Working directory for the CLI |
| `env` | object | No | Additional environment variables |

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
| **Manager** | Gemini | research, trends, large-context | Claude → Codex → Ollama |
| **Coordinator** | Claude | reasoning, planning, architecture | Gemini → Codex → Ollama |
| **Developer** | Codex | code-generation, refactoring | Claude → Gemini → Ollama |
| **Researcher** | Gemini | knowledge, web-search | Claude → Ollama |
| **Reviewer** | Claude | code-analysis, debugging | Gemini → Ollama |
| **Architect** | Claude | system design, architecture | Gemini → Ollama |

## Resilience Pipeline

```
Request → Route by Role → Check Circuit Breaker → Execute CLI
                                                      ↓
                                              Success? → Done
                                              Retryable? → Retry (max 2, exp backoff)
                                              Permanent? → Next Provider in Fallback Chain
                                              All Failed? → Return Error
```

**Circuit Breaker States:**
- **Closed** — Normal operation, track failures
- **Open** — After 3 consecutive failures, reject for 60s
- **Half-open** — After cooldown, allow 1 test request

**Retry Configuration:**
- Max retries: 2 (3 total attempts)
- Base delay: 1s with exponential backoff
- Max delay: 10s
- Jitter: ±30%
- Retryable errors: timeouts, rate limits (429), server errors (503)

## Security

- **Environment Filtering** — Whitelist-based: only safe variables forwarded to CLI subprocesses (PATH, HOME, TERM, Node config, and provider-specific API keys)
- **Secret Redaction** — API keys and tokens automatically redacted from logs and error output
- **No Full env Forwarding** — `process.env` is never passed wholesale to child processes

### Required Environment Variables

Each CLI provider requires its own API key:

| Provider | Variables |
|----------|-----------|
| Claude | `ANTHROPIC_API_KEY` |
| Gemini | `GEMINI_API_KEY`, `GOOGLE_API_KEY` |
| Codex | `OPENAI_API_KEY` |
| Ollama | `OLLAMA_HOST` (optional, defaults to localhost) |

## Development

```bash
git clone https://github.com/lleontor705/cli-orchestrator-mcp.git
cd cli-orchestrator-mcp
npm install
npm run dev        # Run in development mode
npm test           # Run tests
npm run build      # Compile TypeScript
npm run lint       # Type-check without emitting
npm run inspect    # Inspect MCP server with inspector tool
```

## License

MIT
