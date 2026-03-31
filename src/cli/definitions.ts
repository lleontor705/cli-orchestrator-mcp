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
        ? ["-p", prompt, "--max-turns", "10"]
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
        ? ["-p", "-", "--max-turns", "10"]
        : ["-p", "-", "--allowedTools", ""];
    case "gemini":
      return ["-e", "none"];
    case "codex":
      return ["exec", "-", "--full-auto"];
  }
}
