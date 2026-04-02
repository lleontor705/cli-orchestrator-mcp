import type { CliProvider, CliDefinition } from "../types/index.js";

export const CLI_DEFINITIONS: Record<CliProvider, CliDefinition> = {
  claude: {
    binary: "claude",
    strengths: ["reasoning", "code-analysis", "debugging", "architecture", "planning"],
    fallback_order: ["gemini", "codex"],
  },
  gemini: {
    binary: "gemini",
    strengths: ["research", "trends", "knowledge", "large-context", "web-search"],
    fallback_order: ["claude", "codex"],
  },
  codex: {
    binary: "codex",
    strengths: ["code-generation", "edits", "refactoring", "full-auto"],
    fallback_order: ["claude", "gemini"],
  },
};

export function buildArgs(
  provider: CliProvider,
  prompt: string,
  mode: "generate" | "analyze"
): string[] {
  switch (provider) {
    case "claude":
      return mode === "analyze"
        ? ["-p", prompt]
        : ["-p", prompt, "--allowedTools", ""];
    case "gemini":
      return ["-e", "none", "-p", prompt];
    case "codex":
      return ["exec", prompt, "--full-auto"];
  }
}

export function buildStdinArgs(
  provider: CliProvider,
  mode: "generate" | "analyze"
): string[] {
  switch (provider) {
    case "claude":
      return mode === "analyze"
        ? ["-p", "-"]
        : ["-p", "-", "--allowedTools", ""];
    case "gemini":
      return ["-e", "none"];
    case "codex":
      return ["exec", "-", "--full-auto"];
  }
}

/**
 * Generate CLI-specific args that hint at timeout constraints.
 * Claude: --max-turns scales with available time (~1 turn per 30s).
 * Gemini/Codex: no known timeout flags.
 */
export function buildTimeoutArgs(
  provider: CliProvider,
  remainingSeconds: number,
): string[] {
  switch (provider) {
    case "claude": {
      const maxTurns = Math.max(2, Math.min(25, Math.floor(remainingSeconds / 30)));
      return ["--max-turns", String(maxTurns)];
    }
    case "gemini":
      return [];
    case "codex":
      return [];
  }
}
