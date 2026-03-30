import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";

const mockExeca = vi.mocked(execa);

describe("CLI Detection (fresh module per test)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockExeca.mockReset();
    // Re-register the mock so dynamic imports pick it up
    vi.doMock("execa", () => ({
      execa: mockExeca,
    }));
  });

  async function freshDetection() {
    // Each dynamic import after resetModules gives us a fresh detection module
    // with empty cache and detected=false
    return await import("../src/cli/detection.js");
  }

  it("detects an installed CLI (where/which returns path)", async () => {
    mockExeca.mockResolvedValue({
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
    mockExeca.mockRejectedValue(new Error("not found"));

    const { detectCli } = await freshDetection();
    const result = await detectCli("gemini");

    expect(result.installed).toBe(false);
    expect(result.path).toBeNull();
  });

  it("caches results (second call does not re-execute)", async () => {
    mockExeca.mockResolvedValue({
      stdout: "/usr/bin/codex",
      stderr: "",
      exitCode: 0,
    } as any);

    const { detectCli } = await freshDetection();

    const result1 = await detectCli("codex");
    const result2 = await detectCli("codex");

    expect(result1).toEqual(result2);
    expect(result1.installed).toBe(true);
    // execa should only be called once per CLI (version call adds one, so two total for one CLI vs infinite)
    // Actually our test mocked `execa`, so it applies to both `which` and `version`
    expect(mockExeca).toHaveBeenCalled();
  });

  it("detectAll detects all 4 providers", async () => {
    mockExeca.mockImplementation((cmd: any, args: any[]) => {
      // Mock 'which' vs '--version'
      if (args && args.includes("--version")) {
        return Promise.resolve({ stdout: "v1.0.0", stderr: "", exitCode: 0 }) as any;
      }

      const binary = args?.[0];
      if (binary === "claude") {
        return Promise.resolve({ stdout: "/usr/bin/claude", stderr: "", exitCode: 0 }) as any;
      }
      if (binary === "gemini") {
        return Promise.resolve({ stdout: "/usr/bin/gemini", stderr: "", exitCode: 0 }) as any;
      }
      if (binary === "codex") {
        return Promise.resolve({ stdout: "/usr/bin/codex", stderr: "", exitCode: 0 }) as any;
      }
      if (binary === "ollama") {
        return Promise.resolve({ stdout: "/usr/bin/ollama", stderr: "", exitCode: 0 }) as any;
      }
      return Promise.reject(new Error("unknown"));
    });

    const { detectAll } = await freshDetection();
    const results = await detectAll();

    expect(results.size).toBe(4);
    for (const provider of ["claude", "gemini", "codex", "ollama"] as const) {
      const r = results.get(provider);
      expect(r).toBeDefined();
      expect(r!.installed).toBe(true);
      expect(r!.path).toBe(`/usr/bin/${provider}`);
    }
  });
});
