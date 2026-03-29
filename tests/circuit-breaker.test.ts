import { describe, it, expect, beforeEach } from "vitest";
import { canExecute, recordSuccess, recordFailure, getState, resetAll } from "../src/cli/circuit-breaker.js";

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
