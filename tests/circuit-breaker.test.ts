import { describe, it, expect, beforeEach } from "vitest";
import { canExecute, recordSuccess, recordFailure, recordTimeout, getState, resetAll } from "../src/cli/circuit-breaker.js";

beforeEach(() => resetAll());

describe("Circuit Breaker", () => {
  it("starts in closed state", () => {
    expect(getState("claude").state).toBe("closed");
  });

  it("allows execution when closed", () => {
    expect(canExecute("claude")).toBe(true);
  });

  it("stays closed after 1-2 failures", () => {
    recordFailure("claude");
    recordFailure("claude");
    expect(getState("claude").state).toBe("closed");
    expect(canExecute("claude")).toBe(true);
  });

  it("opens after 3 consecutive failures", () => {
    recordFailure("claude");
    recordFailure("claude");
    recordFailure("claude");
    expect(getState("claude").state).toBe("open");
    expect(canExecute("claude")).toBe(false);
  });

  it("rejects execution when open", () => {
    recordFailure("claude");
    recordFailure("claude");
    recordFailure("claude");
    expect(canExecute("claude")).toBe(false);
  });

  it("resets failures on success", () => {
    recordFailure("claude");
    recordFailure("claude");
    recordSuccess("claude");
    expect(getState("claude").failures).toBe(0);
    expect(getState("claude").state).toBe("closed");
  });

  it("tracks total executions and failures", () => {
    recordSuccess("gemini");
    recordSuccess("gemini");
    recordFailure("gemini");
    const state = getState("gemini");
    expect(state.total_executions).toBe(3);
    expect(state.total_failures).toBe(1);
  });

  it("isolates breakers per provider", () => {
    recordFailure("claude");
    recordFailure("claude");
    recordFailure("claude");
    expect(getState("claude").state).toBe("open");
    expect(getState("gemini").state).toBe("closed");
    expect(getState("codex").state).toBe("closed");
  });
});

describe("Circuit Breaker — Timeout handling", () => {
  it("does not open breaker before timeout threshold (5)", () => {
    recordTimeout("claude");
    recordTimeout("claude");
    recordTimeout("claude");
    recordTimeout("claude");
    expect(getState("claude").state).toBe("closed");
    expect(getState("claude").timeouts).toBe(4);
  });

  it("opens breaker at timeout threshold (5)", () => {
    for (let i = 0; i < 5; i++) recordTimeout("claude");
    expect(getState("claude").state).toBe("open");
    expect(canExecute("claude")).toBe(false);
  });

  it("success resets timeout counter", () => {
    recordTimeout("claude");
    recordTimeout("claude");
    recordTimeout("claude");
    recordSuccess("claude");
    expect(getState("claude").timeouts).toBe(0);
    recordTimeout("claude");
    recordTimeout("claude");
    recordTimeout("claude");
    expect(getState("claude").state).toBe("closed");
  });

  it("tracks total_timeouts separately from total_failures", () => {
    recordTimeout("gemini");
    recordTimeout("gemini");
    recordFailure("gemini");
    const state = getState("gemini");
    expect(state.total_timeouts).toBe(2);
    expect(state.total_failures).toBe(1);
    expect(state.total_executions).toBe(3);
  });

  it("opens immediately from half_open on timeout", () => {
    // Open the breaker with failures
    recordFailure("codex");
    recordFailure("codex");
    recordFailure("codex");
    expect(getState("codex").state).toBe("open");
    // Simulate cooldown expiring (manually set last_failure far in the past)
    const state = getState("codex");
    state.last_failure = Date.now() - 120_000;
    canExecute("codex"); // transitions to half_open
    expect(getState("codex").state).toBe("half_open");
    // Timeout in half_open → back to open
    recordTimeout("codex");
    expect(getState("codex").state).toBe("open");
  });
});
