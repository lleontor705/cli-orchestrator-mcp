import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CLI_PROVIDERS, AGENT_ROLES, ROLE_ROUTING } from "../types/index.js";
import { CLI_DEFINITIONS } from "../cli/definitions.js";
import { detectAll, getDetectionCache } from "../cli/detection.js";
import { getAllStates } from "../cli/circuit-breaker.js";
import { executeWithResilience } from "../cli/resilience.js";

const PROGRESS_INTERVAL_MS = 5_000;

const EXECUTE_ANNOTATIONS: ToolAnnotations = {
  title: "Execute CLI",
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const STATS_ANNOTATIONS: ToolAnnotations = {
  title: "CLI Stats",
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const LIST_ANNOTATIONS: ToolAnnotations = {
  title: "List CLIs",
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const ROUTE_ANNOTATIONS: ToolAnnotations = {
  title: "Route CLI",
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function registerOrchestratorTools(server: McpServer): void {
  server.tool(
    "cli_execute",
    "Execute a task on a CLI (Claude, Gemini, or Codex) with automatic retry, circuit breaker, and fallback to other providers.",
    {
      cli: z.enum(CLI_PROVIDERS).describe("Target CLI provider"),
      prompt: z.string().min(1).max(100000).describe("Prompt to send to the CLI"),
      mode: z.enum(["generate", "analyze"]).default("generate").describe("Execution mode"),
      timeout_seconds: z.number().min(10).max(1800).default(720).describe("Timeout in seconds"),
      allow_fallback: z.boolean().default(true).describe("Allow fallback to other CLIs on failure"),
    },
    EXECUTE_ANNOTATIONS,
    async ({ cli, prompt, mode, timeout_seconds, allow_fallback }, extra) => {
      await detectAll();

      const progressToken = extra._meta?.progressToken;
      let progressTick = 0;
      let progressTimer: ReturnType<typeof setInterval> | undefined;

      if (progressToken !== undefined) {
        progressTimer = setInterval(() => {
          progressTick++;
          extra.sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress: progressTick,
              total: Math.ceil(timeout_seconds / (PROGRESS_INTERVAL_MS / 1000)),
              message: `CLI execution in progress (${progressTick * (PROGRESS_INTERVAL_MS / 1000)}s elapsed)`,
            },
          }).catch(() => {});
        }, PROGRESS_INTERVAL_MS);
      }

      try {
        const result = await executeWithResilience(cli, prompt, mode, timeout_seconds, allow_fallback, extra.signal);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: result.success,
              provider: result.provider,
              output: result.output.slice(0, 50000), // Cap output
              duration_ms: result.duration_ms,
              fallback_used: result.fallback_used,
              attempts: result.attempts,
              error: result.error,
            }),
          }],
        };
      } finally {
        if (progressTimer) clearInterval(progressTimer);
      }
    }
  );

  server.tool(
    "cli_stats",
    "Health dashboard showing per-provider installation status, circuit breaker state, and usage stats.",
    {},
    STATS_ANNOTATIONS,
    async () => {
      const detections = await detectAll();
      const breakers = getAllStates();

      const status: Record<string, unknown> = {};
      for (const provider of CLI_PROVIDERS) {
        const det = detections.get(provider);
        const cb = breakers.get(provider);
        status[provider] = {
          installed: det?.installed ?? false,
          path: det?.path ?? null,
          circuit_breaker: cb?.state ?? "closed",
          total_executions: cb?.total_executions ?? 0,
          total_failures: cb?.total_failures ?? 0,
          strengths: CLI_DEFINITIONS[provider].strengths,
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ providers: status }) }],
      };
    }
  );

  server.tool(
    "cli_list",
    "List installed CLI providers with their paths.",
    {},
    LIST_ANNOTATIONS,
    async () => {
      const detections = await detectAll();
      const installed: Record<string, unknown>[] = [];
      for (const provider of CLI_PROVIDERS) {
        const det = detections.get(provider);
        if (det?.installed) {
          installed.push({ provider, path: det.path, strengths: CLI_DEFINITIONS[provider].strengths });
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ installed_count: installed.length, providers: installed }) }],
      };
    }
  );

  server.tool(
    "cli_route",
    "Suggest the best CLI for a task based on agent role. Returns recommended provider with reasoning and fallback chain.",
    {
      role: z.enum(AGENT_ROLES).describe("Agent role"),
      task_description: z.string().optional().describe("Brief task description for context"),
    },
    ROUTE_ANNOTATIONS,
    async ({ role, task_description }) => {
      const routing = ROLE_ROUTING[role];
      const detections = await detectAll();
      const breakers = getAllStates();

      const chain = [routing.primary, ...routing.fallbacks];
      const availability: Record<string, boolean> = {};

      for (const provider of chain) {
        const det = detections.get(provider);
        const cb = breakers.get(provider);
        availability[provider] = (det?.installed ?? false) && (cb?.state !== "open");
      }

      const recommended = chain.find(p => availability[p]) || routing.primary;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            role,
            task_description,
            recommended_cli: recommended,
            reasoning: `Role "${role}" maps to ${routing.primary} (${CLI_DEFINITIONS[routing.primary].strengths.join(", ")})${recommended !== routing.primary ? `. Falling back to ${recommended} because ${routing.primary} is unavailable.` : "."}`,
            fallback_chain: chain,
            availability,
          }),
        }],
      };
    }
  );
}
