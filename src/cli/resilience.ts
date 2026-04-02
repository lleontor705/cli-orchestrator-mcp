import type { CliProvider, ExecutionResult } from "../types/index.js";
import { detectCli } from "./detection.js";
import { canExecute, recordSuccess, recordFailure, recordTimeout } from "./circuit-breaker.js";
import { executeCli } from "./executor.js";
import { CLI_DEFINITIONS } from "./definitions.js";
import { redactSecrets } from "../utils/redact.js";

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 10000;
const JITTER_FACTOR = 0.3;

function isRetryable(stderr: string): boolean {
  const retryablePatterns = ["rate limit", "ECONNRESET", "ETIMEDOUT", "503", "429"];
  const lower = stderr.toLowerCase();
  return retryablePatterns.some((p) => lower.includes(p.toLowerCase()));
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("aborted")); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
  });
}

function getDelay(attempt: number): number {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  const jitter = delay * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(0, delay + jitter);
}

/** Merge caller signal with budget signal (Node 18 compatible — no AbortSignal.any) */
function mergeAbortSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

export async function executeWithResilience(
  primary: CliProvider,
  prompt: string,
  mode: "generate" | "analyze",
  timeoutSeconds: number,
  allowFallback: boolean,
  signal?: AbortSignal,
  cwd?: string,
  onLog?: (msg: string, level: "info" | "error" | "warning") => void
): Promise<ExecutionResult> {
  const chain: CliProvider[] = [primary];
  if (allowFallback) {
    chain.push(...CLI_DEFINITIONS[primary].fallback_order);
  }

  const errors: string[] = [];

  // Global time budget: entire chain (retries + fallbacks) must fit within timeoutSeconds
  const globalDeadline = Date.now() + timeoutSeconds * 1000;
  const budgetController = new AbortController();
  const budgetTimeout = setTimeout(() => budgetController.abort(), timeoutSeconds * 1000);
  const mergedSignal = mergeAbortSignals(signal, budgetController.signal);

  try {
    for (const provider of chain) {
      const remaining = globalDeadline - Date.now();
      if (remaining <= 0) {
        errors.push(`${provider}: global budget exhausted`);
        onLog?.(`Global timeout budget exhausted before trying ${provider}`, "warning");
        break;
      }

      const detection = await detectCli(provider);
      if (!detection.installed) {
        const err = `${provider}: not installed`;
        errors.push(err);
        onLog?.(err, "warning");
        continue;
      }

      if (!canExecute(provider)) {
        const err = `${provider}: circuit breaker open`;
        errors.push(err);
        onLog?.(err, "warning");
        continue;
      }

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (mergedSignal?.aborted) {
          errors.push(`${provider}: aborted`);
          break;
        }

        const remainingSeconds = Math.max(1, Math.floor((globalDeadline - Date.now()) / 1000));
        if (remainingSeconds <= 1) {
          errors.push(`${provider}: global budget exhausted`);
          onLog?.("Global timeout budget exhausted", "warning");
          break;
        }

        if (attempt > 0) {
          const delay = getDelay(attempt - 1);
          onLog?.(`Retrying ${provider} (attempt ${attempt}) after ${Math.round(delay)}ms...`, "info");
          try {
            await sleep(delay, mergedSignal);
          } catch {
            errors.push(`${provider}: aborted during retry backoff`);
            break;
          }
        }

        onLog?.(`Executing with ${provider}...`, "info");
        const result = await executeCli(provider, prompt, mode, remainingSeconds, mergedSignal, cwd);

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

        // Process timeout: skip retries, move to next provider immediately
        if (result.timedOut) {
          const err = redactSecrets(`${provider}: process timeout (${result.duration_ms}ms) — skipping retries`);
          errors.push(err);
          onLog?.(err, "warning");
          recordTimeout(provider);
          break;
        }

        if (!isRetryable(result.stderr)) {
          const err = redactSecrets(`${provider}: ${result.stderr || "non-retryable failure"}`);
          errors.push(err);
          onLog?.(err, "error");
          recordFailure(provider);
          break;
        }

        const err = redactSecrets(`${provider}: failed with retryable error (attempt ${attempt}) — ${result.stderr}`);
        onLog?.(err, "warning");

        if (attempt === MAX_RETRIES) {
          const exhaustErr = redactSecrets(`${provider}: exhausted retries — ${result.stderr}`);
          errors.push(exhaustErr);
          onLog?.(exhaustErr, "error");
          recordFailure(provider);
        }
      }

      if (mergedSignal?.aborted) break;
    }

    onLog?.("All providers failed", "error");

    return {
      success: false,
      provider: primary,
      output: "",
      duration_ms: 0,
      fallback_used: false,
      attempts: 0,
      error: redactSecrets(`All providers failed: ${errors.join("; ")}`),
    };
  } finally {
    clearTimeout(budgetTimeout);
  }
}
