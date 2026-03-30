import type { CliProvider, ExecutionResult } from "../types/index.js";
import { detectCli } from "./detection.js";
import { canExecute, recordSuccess, recordFailure } from "./circuit-breaker.js";
import { executeCli } from "./executor.js";
import { CLI_DEFINITIONS } from "./definitions.js";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 10000;
const JITTER_FACTOR = 0.3;

function isRetryable(stderr: string): boolean {
  const retryablePatterns = ["timeout", "rate limit", "ECONNRESET", "ETIMEDOUT", "503", "429"];
  const lower = stderr.toLowerCase();
  return retryablePatterns.some((p) => lower.includes(p.toLowerCase()));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getDelay(attempt: number): number {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  const jitter = delay * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(0, delay + jitter);
}

export async function executeWithResilience(
  primary: CliProvider,
  prompt: string,
  mode: "generate" | "analyze",
  timeoutSeconds: number,
  allowFallback: boolean,
  signal?: AbortSignal
): Promise<ExecutionResult> {
  const chain: CliProvider[] = [primary];
  if (allowFallback) {
    chain.push(...CLI_DEFINITIONS[primary].fallback_order);
  }

  const errors: string[] = [];

  for (const provider of chain) {
    const detection = await detectCli(provider);
    if (!detection.installed) {
      errors.push(`${provider}: not installed`);
      continue;
    }

    if (!canExecute(provider)) {
      errors.push(`${provider}: circuit breaker open`);
      continue;
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(getDelay(attempt - 1));
      }

      const result = await executeCli(provider, prompt, mode, timeoutSeconds, signal);

      if (result.exitCode === 0 && result.stdout) {
        recordSuccess(provider);
        return {
          success: true,
          provider,
          output: result.stdout,
          duration_ms: result.duration_ms,
          fallback_used: provider !== primary,
          attempts: attempt + 1,
        };
      }

      if (!isRetryable(result.stderr)) {
        errors.push(`${provider}: ${result.stderr || "non-retryable failure"}`);
        recordFailure(provider);
        break;
      }

      if (attempt === MAX_RETRIES) {
        errors.push(`${provider}: exhausted retries — ${result.stderr}`);
        recordFailure(provider);
      }
    }
  }

  return {
    success: false,
    provider: primary,
    output: "",
    duration_ms: 0,
    fallback_used: false,
    attempts: 0,
    error: `All providers failed: ${errors.join("; ")}`,
  };
}
