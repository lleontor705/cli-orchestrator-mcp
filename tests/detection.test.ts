import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execaCommand: vi.fn(),
}));

import { execaCommand } from "execa";

const mockExecaCommand = vi.mocked(execaCommand);

describe("CLI Detection (fresh module per test)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecaCommand.mockReset();
    // Re-register the mock so dynamic imports pick it up
    vi.doMock("execa", () => ({
      execaCommand: mockExecaCommand,
    }));
  });

  async function freshDetection() {
    // Each dynamic import after resetModules gives us a fresh detection module
    // with empty cache and detected=false
    return await import("../src/cli/detection.js");
  }

  it("detects an installed CLI (where/which returns path)", async () => {
    mockExecaCommand.mockResolvedValue({
      stdout: "/usr/bin/claude",
      stderr: "",
      exitCode: 0,
    } as any);

    const { detectCli } = await freshDetection();
    const result = await detectCli("claude");

    expect(result.installed).toBe(true);
    expect(result.path).toBe("/usr/bin/claude");
  });

  it("handles missing CLI gracefully (where/which throws)", async () => {
    mockExecaCommand.mockRejectedValue(new Error("not found"));

    const { detectCli } = await freshDetection();
    const result = await detectCli("gemini");

    expect(result.installed).toBe(false);
    expect(result.path).toBeNull();
  });

  it("caches results (second call does not re-execute)", async () => {
    mockExecaCommand.mockResolvedValue({
      stdout: "/usr/bin/codex",
      stderr: "",
      exitCode: 0,
    } as any);

    const { detectCli } = await freshDetection();

    const result1 = await detectCli("codex");
    const result2 = await detectCli("codex");

    expect(result1).toEqual(result2);
    expect(result1.installed).toBe(true);
    // execaCommand should only be called once due to caching
    expect(mockExecaCommand).toHaveBeenCalledTimes(1);
  });

  it("detectAll detects all 3 providers", async () => {
    mockExecaCommand.mockImplementation((cmd: any) => {
      const command = typeof cmd === "string" ? cmd : String(cmd);
      if (command.includes("claude")) {
        return Promise.resolve({ stdout: "/usr/bin/claude", stderr: "", exitCode: 0 }) as any;
      }
      if (command.includes("gemini")) {
        return Promise.resolve({ stdout: "/usr/bin/gemini", stderr: "", exitCode: 0 }) as any;
      }
      if (command.includes("codex")) {
        return Promise.resolve({ stdout: "/usr/bin/codex", stderr: "", exitCode: 0 }) as any;
      }
      return Promise.reject(new Error("unknown"));
    });

    const { detectAll } = await freshDetection();
    const results = await detectAll();

    expect(results.size).toBe(3);
    for (const provider of ["claude", "gemini", "codex"] as const) {
      const r = results.get(provider);
      expect(r).toBeDefined();
      expect(r!.installed).toBe(true);
      expect(r!.path).toBe(`/usr/bin/${provider}`);
    }
  });
});
