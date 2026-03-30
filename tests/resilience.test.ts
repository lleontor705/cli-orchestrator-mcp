import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetAll } from "../src/cli/circuit-breaker.js";

// Mock detection — all providers installed
vi.mock("../src/cli/detection.js", () => ({
  detectCli: vi.fn().mockResolvedValue({ installed: true, path: "/usr/bin/mock", version: null }),
}));

// Mock executor
vi.mock("../src/cli/executor.js", () => ({
  executeCli: vi.fn(),
}));

import { executeWithResilience } from "../src/cli/resilience.js";
import { executeCli } from "../src/cli/executor.js";
import { detectCli } from "../src/cli/detection.js";

const mockExecuteCli = vi.mocked(executeCli);
const mockDetectCli = vi.mocked(detectCli);

beforeEach(() => {
  resetAll();
  vi.clearAllMocks();
  // Default: all providers installed
  mockDetectCli.mockResolvedValue({ installed: true, path: "/usr/bin/mock", version: null });
});

describe("executeWithResilience", () => {
  it("returns output on first success (no retry needed)", async () => {
    mockExecuteCli.mockResolvedValueOnce({
      stdout: "hello world",
      stderr: "",
      exitCode: 0,
      duration_ms: 100,
    });

    const result = await executeWithResilience("claude", "test", "generate", 30, true);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("claude");
    expect(result.output).toBe("hello world");
    expect(result.fallback_used).toBe(false);
    expect(result.attempts).toBe(1);
    expect(mockExecuteCli).toHaveBeenCalledTimes(1);
  });

  it("falls back to next provider when primary fails with non-retryable error", async () => {
    // Claude fails (non-retryable)
    mockExecuteCli.mockResolvedValueOnce({
      stdout: "",
      stderr: "fatal error",
      exitCode: 1,
      duration_ms: 50,
    });
    // Gemini succeeds
    mockExecuteCli.mockResolvedValueOnce({
      stdout: "gemini output",
      stderr: "",
      exitCode: 0,
      duration_ms: 200,
    });

    const result = await executeWithResilience("claude", "test", "generate", 30, true);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("gemini");
    expect(result.output).toBe("gemini output");
    expect(result.fallback_used).toBe(true);
  });

  it("retries on retryable errors (timeout)", async () => {
    // First attempt: retryable timeout
    mockExecuteCli.mockResolvedValueOnce({
      stdout: "",
      stderr: "ETIMEDOUT connection timed out",
      exitCode: 1,
      duration_ms: 5000,
    });
    // Second attempt: success
    mockExecuteCli.mockResolvedValueOnce({
      stdout: "success after retry",
      stderr: "",
      exitCode: 0,
      duration_ms: 100,
    });

    const result = await executeWithResilience("claude", "test", "generate", 30, true);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("claude");
    expect(result.output).toBe("success after retry");
    expect(result.attempts).toBe(2);
    expect(result.fallback_used).toBe(false);
  });

  it("retries on retryable errors (rate limit)", async () => {
    // First attempt: rate limit
    mockExecuteCli.mockResolvedValueOnce({
      stdout: "",
      stderr: "rate limit exceeded",
      exitCode: 1,
      duration_ms: 100,
    });
    // Second attempt: success
    mockExecuteCli.mockResolvedValueOnce({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      duration_ms: 100,
    });

    const result = await executeWithResilience("claude", "test", "generate", 30, true);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("exhausts retries then falls back", async () => {
    // Claude: 3 retryable failures (attempt 0, 1, 2 = MAX_RETRIES)
    mockExecuteCli.mockResolvedValueOnce({
      stdout: "",
      stderr: "timeout error",
      exitCode: 1,
      duration_ms: 100,
    });
    mockExecuteCli.mockResolvedValueOnce({
      stdout: "",
      stderr: "timeout error",
      exitCode: 1,
      duration_ms: 100,
    });
    mockExecuteCli.mockResolvedValueOnce({
      stdout: "",
      stderr: "timeout error",
      exitCode: 1,
      duration_ms: 100,
    });
    // Gemini succeeds
    mockExecuteCli.mockResolvedValueOnce({
      stdout: "gemini saved the day",
      stderr: "",
      exitCode: 0,
      duration_ms: 200,
    });

    const result = await executeWithResilience("claude", "test", "generate", 30, true);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("gemini");
    expect(result.fallback_used).toBe(true);
  });

  it("returns error when all providers fail", async () => {
    // All fail with non-retryable errors
    mockExecuteCli.mockResolvedValue({
      stdout: "",
      stderr: "fatal error",
      exitCode: 1,
      duration_ms: 50,
    });

    const result = await executeWithResilience("claude", "test", "generate", 30, true);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("All providers failed");
  });

  it("respects allow_fallback=false (does not try other providers)", async () => {
    // Claude fails (non-retryable)
    mockExecuteCli.mockResolvedValue({
      stdout: "",
      stderr: "fatal error",
      exitCode: 1,
      duration_ms: 50,
    });

    const result = await executeWithResilience("claude", "test", "generate", 30, false);

    expect(result.success).toBe(false);
    // Should only call executeCli once (only claude, no fallback)
    expect(mockExecuteCli).toHaveBeenCalledTimes(1);
    expect(result.error).toContain("All providers failed");
  });

  it("circuit breaker opens after 3 failures", async () => {
    // All calls fail non-retryably
    mockExecuteCli.mockResolvedValue({
      stdout: "",
      stderr: "fatal error",
      exitCode: 1,
      duration_ms: 50,
    });

    // First call: claude fails, gemini fails, codex fails (3 providers, 1 call each)
    await executeWithResilience("claude", "test1", "generate", 30, true);
    await executeWithResilience("claude", "test2", "generate", 30, true);
    await executeWithResilience("claude", "test3", "generate", 30, true);

    // After 3 rounds, each provider has failed 3 times, circuit breakers should be open
    // The 4th call should skip all due to open circuit breakers
    mockExecuteCli.mockClear();
    const result = await executeWithResilience("claude", "test4", "generate", 30, true);

    expect(result.success).toBe(false);
    // No actual executeCli calls should be made since circuit breakers are open
    expect(mockExecuteCli).toHaveBeenCalledTimes(0);
  });
});
