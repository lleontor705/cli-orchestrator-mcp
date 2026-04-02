import type { CliProvider, CircuitBreaker, CircuitState } from "../types/index.js";

const FAILURE_THRESHOLD = 3;
const TIMEOUT_THRESHOLD = 5;
const COOLDOWN_MS = 60_000;
const HALF_OPEN_SUCCESSES = 1;

const breakers = new Map<CliProvider, CircuitBreaker>();

function getOrCreate(provider: CliProvider): CircuitBreaker {
  if (!breakers.has(provider)) {
    breakers.set(provider, {
      state: "closed",
      failures: 0,
      timeouts: 0,
      last_failure: null,
      successes_in_half_open: 0,
      total_executions: 0,
      total_failures: 0,
      total_timeouts: 0,
    });
  }
  return breakers.get(provider)!;
}

export function canExecute(provider: CliProvider): boolean {
  const cb = getOrCreate(provider);

  if (cb.state === "closed") return true;

  if (cb.state === "open") {
    if (cb.last_failure && Date.now() - cb.last_failure >= COOLDOWN_MS) {
      cb.state = "half_open";
      cb.successes_in_half_open = 0;
      return true;
    }
    return false;
  }

  // half_open: allow one test request
  return true;
}

export function recordSuccess(provider: CliProvider): void {
  const cb = getOrCreate(provider);
  cb.total_executions++;

  if (cb.state === "half_open") {
    cb.successes_in_half_open++;
    if (cb.successes_in_half_open >= HALF_OPEN_SUCCESSES) {
      cb.state = "closed";
      cb.failures = 0;
    }
  } else {
    cb.failures = 0;
  }
  cb.timeouts = 0;
}

export function recordFailure(provider: CliProvider): void {
  const cb = getOrCreate(provider);
  cb.total_executions++;
  cb.total_failures++;
  cb.failures++;
  cb.last_failure = Date.now();

  if (cb.state === "half_open") {
    cb.state = "open";
  } else if (cb.failures >= FAILURE_THRESHOLD) {
    cb.state = "open";
  }
}

export function recordTimeout(provider: CliProvider): void {
  const cb = getOrCreate(provider);
  cb.total_executions++;
  cb.total_timeouts++;
  cb.timeouts++;
  cb.last_failure = Date.now();

  if (cb.state === "half_open") {
    cb.state = "open";
  } else if (cb.timeouts >= TIMEOUT_THRESHOLD) {
    cb.state = "open";
  }
}

export function getState(provider: CliProvider): CircuitBreaker {
  return getOrCreate(provider);
}

export function getAllStates(): Map<CliProvider, CircuitBreaker> {
  for (const p of ["claude", "gemini", "codex"] as CliProvider[]) getOrCreate(p);
  return breakers;
}

export function resetAll(): void {
  breakers.clear();
}
