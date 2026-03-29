# cli-orchestrator-mcp

MCP Server for **resilient multi-CLI orchestration** — route AI tasks to Claude, Gemini, or Codex with automatic retry, circuit breaker, and fallback.

Works with any MCP-compatible client: **Claude Code**, **Codex CLI**, **Gemini CLI**, **OpenClaw**, and more.

## Features

- **Role-based Routing** — Automatically select the best CLI based on agent role
- **Circuit Breaker** — Per-provider fault isolation (closed → open → half-open)
- **Retry with Backoff** — Exponential backoff with jitter for transient failures
- **Automatic Fallback** — If primary CLI fails, try alternatives in order
- **Auto-detection** — Discovers installed CLIs at startup
- **Cross-platform** — Windows, macOS, Linux support

## Quick Start

```bash
npx -y cli-orchestrator-mcp
```

**Prerequisites:** At least one CLI must be installed: `claude`, `gemini`, or `codex`.

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
| `cli_status` | Health dashboard with per-provider installation, circuit breaker state, and stats |
| `cli_route` | Suggest best CLI for a task based on agent role |

## Role-based Routing

| Role | Primary CLI | Strengths | Fallbacks |
|------|-------------|-----------|-----------|
| **Manager** | Gemini | research, trends, large-context | Claude → Codex |
| **Coordinator** | Claude | reasoning, planning, architecture | Gemini → Codex |
| **Developer** | Codex | code-generation, refactoring | Claude → Gemini |
| **Researcher** | Gemini | knowledge, web-search | Claude |
| **Reviewer** | Claude | code-analysis, debugging | Gemini |
| **Architect** | Claude | system design, architecture | Gemini |

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

## Development

```bash
git clone https://github.com/lleontor705/cli-orchestrator-mcp.git
cd cli-orchestrator-mcp
npm install
npm run dev
npm test
npm run build
```

## License

MIT
