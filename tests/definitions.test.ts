import { describe, it, expect } from "vitest";
import { CLI_PROVIDERS, AGENT_ROLES, ROLE_ROUTING } from "../src/types/index.js";
import { CLI_DEFINITIONS, buildArgs } from "../src/cli/definitions.js";

describe("CLI Definitions", () => {
  it("has definitions for all providers", () => {
    for (const provider of CLI_PROVIDERS) {
      expect(CLI_DEFINITIONS[provider]).toBeDefined();
      expect(CLI_DEFINITIONS[provider].binary).toBeTruthy();
      expect(CLI_DEFINITIONS[provider].strengths.length).toBeGreaterThan(0);
    }
  });

  it("fallback chains dont include the primary", () => {
    for (const provider of CLI_PROVIDERS) {
      expect(CLI_DEFINITIONS[provider].fallback_order).not.toContain(provider);
    }
  });

  it("builds correct args for claude", () => {
    const args = buildArgs("claude", "test prompt", "generate");
    expect(args).toContain("-p");
    expect(args).toContain("test prompt");
  });

  it("builds correct args for gemini", () => {
    const args = buildArgs("gemini", "test", "generate");
    expect(args).toContain("-e");
    expect(args).toContain("none");
  });

  it("builds correct args for codex", () => {
    const args = buildArgs("codex", "test", "generate");
    expect(args[0]).toBe("exec");
    expect(args).toContain("--full-auto");
  });
});

describe("Role Routing", () => {
  it("covers all agent roles", () => {
    for (const role of AGENT_ROLES) {
      expect(ROLE_ROUTING[role]).toBeDefined();
      expect(ROLE_ROUTING[role].primary).toBeTruthy();
      expect(ROLE_ROUTING[role].fallbacks.length).toBeGreaterThan(0);
    }
  });

  it("manager routes to gemini by default", () => {
    expect(ROLE_ROUTING.manager.primary).toBe("gemini");
  });

  it("developer routes to codex by default", () => {
    expect(ROLE_ROUTING.developer.primary).toBe("codex");
  });

  it("coordinator routes to claude by default", () => {
    expect(ROLE_ROUTING.coordinator.primary).toBe("claude");
  });

  it("fallbacks dont include the primary", () => {
    for (const role of AGENT_ROLES) {
      expect(ROLE_ROUTING[role].fallbacks).not.toContain(ROLE_ROUTING[role].primary);
    }
  });
});
