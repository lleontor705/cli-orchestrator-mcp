export const CLI_PROVIDERS = ["claude", "gemini", "codex"] as const;
export type CliProvider = (typeof CLI_PROVIDERS)[number];

export const AGENT_ROLES = ["manager", "coordinator", "developer", "researcher", "reviewer", "architect"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export interface CliDefinition {
  binary: string;
  strengths: string[];
  fallback_order: CliProvider[];
}

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreaker {
  state: CircuitState;
  failures: number;
  timeouts: number;
  last_failure: number | null;
  successes_in_half_open: number;
  total_executions: number;
  total_failures: number;
  total_timeouts: number;
}

export interface DetectionResult {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface ExecutionResult {
  success: boolean;
  provider: CliProvider;
  output: string;
  duration_ms: number;
  fallback_used: boolean;
  attempts: number;
  error?: string;
}

export const ROLE_ROUTING: Record<AgentRole, { primary: CliProvider; fallbacks: CliProvider[] }> = {
  manager: { primary: "gemini", fallbacks: ["claude", "codex"] },
  coordinator: { primary: "claude", fallbacks: ["gemini", "codex"] },
  developer: { primary: "codex", fallbacks: ["claude", "gemini"] },
  researcher: { primary: "gemini", fallbacks: ["claude", "codex"] },
  reviewer: { primary: "claude", fallbacks: ["gemini", "codex"] },
  architect: { primary: "claude", fallbacks: ["gemini", "codex"] },
};
