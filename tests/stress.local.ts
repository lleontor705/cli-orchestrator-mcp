/**
 * Stress tests — focused on timeout behavior, cancellation,
 * concurrent execution, and long-running process handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock execa so we control timing without real processes ──────────
vi.mock("execa", () => ({ execa: vi.fn() }));

import { execa } from "execa";
const mockExeca = vi.mocked(execa);

// ── Mock detection so all providers appear "installed" ──────────────
vi.mock("../src/cli/detection.js", () => ({
  detectCli: vi.fn().mockResolvedValue({ installed: true, path: "/usr/bin/mock", version: "1.0" }),
  detectAll: vi.fn().mockResolvedValue(new Map([
    ["claude", { installed: true, path: "/usr/bin/claude", version: "1.0" }],
    ["gemini", { installed: true, path: "/usr/bin/gemini", version: "1.0" }],
    ["codex", { installed: true, path: "/usr/bin/codex", version: "1.0" }],
  ])),
  getDetectionCache: vi.fn().mockReturnValue(new Map()),
}));

import { executeCli } from "../src/cli/executor.js";
import { executeWithResilience } from "../src/cli/resilience.js";
import { resetAll } from "../src/cli/circuit-breaker.js";

beforeEach(() => {
  mockExeca.mockReset();
  resetAll();
});

// ─── Helper: simulate a process that hangs for `ms` then resolves ───
function mockHangingProcess(ms: number, output = "") {
  return new Promise<any>((resolve) =>
    setTimeout(() => resolve({ stdout: output, stderr: "", exitCode: 0 }), ms),
  );
}

// ─── Helper: simulate execa timeout error (what execa actually throws) ──
function mockTimedOut() {
  const err: any = new Error("Command timed out after 10000 milliseconds");
  err.timedOut = true;
  err.exitCode = null;
  err.stderr = "";
  err.stdout = "";
  return err;
}

// ═══════════════════════════════════════════════════════════════════════
//  1. TIMEOUT ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════
describe("Timeout enforcement", () => {
  it("executeCli returns within timeout + small margin", async () => {
    // Simulate process that would hang for 30s but execa kills it at timeout
    mockExeca.mockImplementation(() => {
      return new Promise<any>((_resolve, reject) => {
        setTimeout(() => {
          const err = mockTimedOut();
          reject(err);
        }, 50); // Simulate execa killing at ~50ms for test speed
      });
    });

    const start = Date.now();
    const result = await executeCli("claude", "test", "generate", 1);
    const elapsed = Date.now() - start;

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("timed out");
    // Should complete quickly, not hang
    expect(elapsed).toBeLessThan(5000);
  });

  it("short timeout (10s) does not multiply into 30s+ with retries", async () => {
    // This is the critical test: timeout errors should NOT be retried
    // because retrying a timeout just wastes more time
    mockExeca.mockImplementation(() => {
      return new Promise<any>((_resolve, reject) => {
        setTimeout(() => reject(mockTimedOut()), 50);
      });
    });

    const start = Date.now();
    const result = await executeWithResilience(
      "claude",
      "test",
      "generate",
      10, // 10s timeout
      false, // no fallback
    );
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    // With retries on timeout: 3 attempts * 10s + backoff = 30s+
    // Without retries on timeout: should be fast (<5s with mocks)
    // If this fails, timeout retries are the bug.
    expect(elapsed).toBeLessThan(10_000);
  }, 15_000);

  it("timeout errors should NOT trigger retries (they are not transient)", async () => {
    let callCount = 0;
    mockExeca.mockImplementation(() => {
      callCount++;
      return new Promise<any>((_resolve, reject) => {
        setTimeout(() => reject(mockTimedOut()), 50);
      });
    });

    await executeWithResilience("claude", "test", "generate", 10, false);

    // If timeout is retryable: callCount = 3 (initial + 2 retries)
    // If timeout is NOT retryable: callCount = 1
    expect(callCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  2. ABORT / CANCELLATION
// ═══════════════════════════════════════════════════════════════════════
describe("AbortSignal cancellation", () => {
  it("respects AbortSignal and stops execution", async () => {
    const controller = new AbortController();

    mockExeca.mockImplementation(() => {
      // Simulate a long-running process
      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve({ stdout: "done", stderr: "", exitCode: 0 }),
          60_000,
        );
        // Listen for abort
        controller.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          const err: any = new Error("canceled");
          err.isCanceled = true;
          reject(err);
        });
      });
    });

    // Abort after 100ms
    setTimeout(() => controller.abort(), 100);

    const start = Date.now();
    const result = await executeCli("claude", "test", "generate", 300, controller.signal);
    const elapsed = Date.now() - start;

    expect(result.exitCode).toBe(1);
    expect(elapsed).toBeLessThan(5000);
  });

  it("abort during resilience loop stops all retries", async () => {
    const controller = new AbortController();
    let callCount = 0;

    mockExeca.mockImplementation(() => {
      callCount++;
      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve({ stdout: "", stderr: "rate limit", exitCode: 1 }),
          200,
        );
        controller.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          const err: any = new Error("canceled");
          err.isCanceled = true;
          reject(err);
        });
      });
    });

    // Abort after 300ms (during first retry backoff or second attempt)
    setTimeout(() => controller.abort(), 300);

    const start = Date.now();
    const result = await executeWithResilience(
      "claude", "test", "generate", 60, false, controller.signal,
    );
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
    // Should not have completed all 3 attempts
    expect(callCount).toBeLessThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  3. CONCURRENT EXECUTIONS
// ═══════════════════════════════════════════════════════════════════════
describe("Concurrent execution stress", () => {
  it("handles 10 concurrent executions without interference", async () => {
    let activeCount = 0;
    let peakConcurrent = 0;

    mockExeca.mockImplementation(() => {
      activeCount++;
      peakConcurrent = Math.max(peakConcurrent, activeCount);
      return new Promise<any>((resolve) => {
        setTimeout(() => {
          activeCount--;
          resolve({ stdout: `result-${activeCount}`, stderr: "", exitCode: 0 });
        }, 50 + Math.random() * 100);
      });
    });

    const promises = Array.from({ length: 10 }, (_, i) =>
      executeCli("claude", `prompt-${i}`, "generate", 30),
    );

    const results = await Promise.all(promises);

    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBeTruthy();
    }
    // Verify actual concurrency happened
    expect(peakConcurrent).toBeGreaterThan(1);
  });

  it("handles 5 concurrent resilience executions", async () => {
    mockExeca.mockImplementation(() =>
      new Promise<any>((resolve) =>
        setTimeout(
          () => resolve({ stdout: "ok", stderr: "", exitCode: 0 }),
          50 + Math.random() * 100,
        ),
      ),
    );

    const promises = Array.from({ length: 5 }, (_, i) =>
      executeWithResilience("claude", `prompt-${i}`, "generate", 30, false),
    );

    const start = Date.now();
    const results = await Promise.all(promises);
    const elapsed = Date.now() - start;

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.success).toBe(true);
    }
    // All should run concurrently, not sequentially (5 * 150ms max = 750ms sequential)
    expect(elapsed).toBeLessThan(3000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  4. FALLBACK CHAIN UNDER TIMEOUT
// ═══════════════════════════════════════════════════════════════════════
describe("Fallback chain timeout behavior", () => {
  it("total time with fallback stays bounded", async () => {
    // All providers timeout — total should NOT be 3 providers * 3 attempts * timeout
    let callCount = 0;
    mockExeca.mockImplementation(() => {
      callCount++;
      return new Promise<any>((_resolve, reject) => {
        setTimeout(() => reject(mockTimedOut()), 50);
      });
    });

    const start = Date.now();
    const result = await executeWithResilience(
      "claude",
      "test",
      "generate",
      10,
      true, // allow fallback to gemini, codex
    );
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    // With 3 providers and NO retry on timeout: 3 calls, fast
    // With 3 providers and retry on timeout: 3 * 3 = 9 calls, very slow
    expect(elapsed).toBeLessThan(10_000);
    // Should only try each provider once if timeout is non-retryable
    expect(callCount).toBe(3);
  }, 15_000);

  it("fallback succeeds after primary times out", async () => {
    let callIndex = 0;
    mockExeca.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        // Primary (claude) times out
        return new Promise<any>((_resolve, reject) => {
          setTimeout(() => reject(mockTimedOut()), 50);
        });
      }
      // Fallback (gemini) succeeds
      return Promise.resolve({ stdout: "gemini output", stderr: "", exitCode: 0 });
    });

    const result = await executeWithResilience("claude", "test", "generate", 10, true);

    expect(result.success).toBe(true);
    expect(result.provider).toBe("gemini");
    expect(result.fallback_used).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  5. LARGE OUTPUT HANDLING
// ═══════════════════════════════════════════════════════════════════════
describe("Large output stress", () => {
  it("handles output near maxBuffer limit", async () => {
    const largeOutput = "x".repeat(5 * 1024 * 1024); // 5MB
    mockExeca.mockResolvedValue({
      stdout: largeOutput,
      stderr: "",
      exitCode: 0,
    } as any);

    const result = await executeCli("claude", "test", "generate", 30);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBe(5 * 1024 * 1024);
  });

  it("handles large stderr without crashing", async () => {
    const largeStderr = "error line\n".repeat(100_000);
    mockExeca.mockResolvedValue({
      stdout: "",
      stderr: largeStderr,
      exitCode: 1,
    } as any);

    const result = await executeCli("claude", "test", "generate", 30);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  6. CIRCUIT BREAKER UNDER STRESS
// ═══════════════════════════════════════════════════════════════════════
describe("Circuit breaker stress", () => {
  it("opens after 3 consecutive timeouts and rejects fast", async () => {
    mockExeca.mockImplementation(() =>
      new Promise<any>((_resolve, reject) => {
        setTimeout(() => reject(mockTimedOut()), 50);
      }),
    );

    // First 3 calls open the circuit breaker
    for (let i = 0; i < 3; i++) {
      await executeWithResilience("claude", "test", "generate", 10, false);
    }

    // 4th call should be rejected instantly by circuit breaker
    const start = Date.now();
    const result = await executeWithResilience("claude", "test", "generate", 10, false);
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    expect(result.error).toContain("circuit breaker");
    expect(elapsed).toBeLessThan(500); // Should be instant
  });

  it("rapid-fire 20 calls: circuit breaker protects after initial failures", async () => {
    let execCount = 0;
    mockExeca.mockImplementation(() => {
      execCount++;
      return new Promise<any>((_resolve, reject) => {
        setTimeout(() => reject(mockTimedOut()), 30);
      });
    });

    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(await executeWithResilience("claude", `prompt-${i}`, "generate", 10, false));
    }

    // All should fail
    expect(results.every((r) => !r.success)).toBe(true);
    // Circuit breaker should have blocked most calls after first 3
    // Without CB: 20 calls. With CB: ~3 actual executions + 17 fast rejections.
    expect(execCount).toBeLessThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  7. LARGE PROMPT (STDIN) STRESS
// ═══════════════════════════════════════════════════════════════════════
describe("Large prompt via stdin", () => {
  it("sends prompt >30KB via stdin instead of args", async () => {
    let receivedInput: string | undefined;
    mockExeca.mockImplementation((_cmd: any, _args: any, opts: any) => {
      receivedInput = opts?.input;
      return Promise.resolve({ stdout: "ok", stderr: "", exitCode: 0 });
    });

    const largePrompt = "word ".repeat(10_000); // ~50KB
    await executeCli("claude", largePrompt, "generate", 30);

    expect(receivedInput).toBe(largePrompt);
  });

  it("normal prompt (<30KB) uses args, not stdin", async () => {
    let receivedInput: string | undefined;
    let receivedArgs: string[] = [];
    mockExeca.mockImplementation((_cmd: any, args: any, opts: any) => {
      receivedInput = opts?.input;
      receivedArgs = args;
      return Promise.resolve({ stdout: "ok", stderr: "", exitCode: 0 });
    });

    await executeCli("claude", "short prompt", "generate", 30);

    expect(receivedInput).toBeUndefined();
    expect(receivedArgs).toContain("short prompt");
  });
});
