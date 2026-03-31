/**
 * Core Execution Engine — runs a CLI binary via execa with structured output.
 * Aligned with opencode-cli-enforcer's inline execution approach.
 */

import { execa } from "execa";
import path from "node:path";
import os from "node:os";
import type { CliProvider } from "../types/index.js";
import { CLI_DEFINITIONS, buildArgs, buildStdinArgs } from "./definitions.js";
import { getSafeEnv } from "../utils/env-allowlist.js";
import { redactSecrets } from "../utils/redact.js";

const STDIN_THRESHOLD = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

const isWindows = process.platform === "win32";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration_ms: number;
}

/**
 * On Windows, CLIs installed via npm/scoop/cargo may be .cmd/.bat shims.
 * Wrap with `cmd /c` so execa can execute them without a shell.
 */
function resolveCommand(binary: string): { file: string; prefix: string[] } {
  if (!isWindows) return { file: binary, prefix: [] };

  const ext = path.extname(binary).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    return { file: "cmd", prefix: ["/c", binary] };
  }

  const pathext = (process.env.PATHEXT || "").toLowerCase();
  if (pathext.includes(".cmd") || pathext.includes(".bat")) {
    return { file: "cmd", prefix: ["/c", binary] };
  }

  return { file: binary, prefix: [] };
}

/** Enhance PATH on Windows with common CLI install locations */
function getEnhancedPath(): string | undefined {
  if (!isWindows) return undefined;

  const home = os.homedir();
  const extraPaths = [
    path.join(home, "AppData", "Roaming", "npm"),
    path.join(home, "scoop", "shims"),
    path.join(home, ".cargo", "bin"),
    path.join(home, "AppData", "Local", "pnpm"),
  ];

  const currentPath = process.env.PATH || "";
  return [...extraPaths, currentPath].join(path.delimiter);
}

export async function executeCli(
  provider: CliProvider,
  prompt: string,
  mode: "generate" | "analyze",
  timeoutSeconds: number,
  signal?: AbortSignal,
  cwd?: string,
): Promise<ExecResult> {
  const binary = CLI_DEFINITIONS[provider].binary;
  const start = Date.now();

  const useStdin = prompt.length > STDIN_THRESHOLD;
  const args = useStdin
    ? buildStdinArgs(provider, mode)
    : buildArgs(provider, prompt, mode);

  const { file, prefix } = resolveCommand(binary);
  const finalArgs = [...prefix, ...args];

  // Safe env — CLIs handle their own auth inline
  const env = getSafeEnv();
  const enhancedPath = getEnhancedPath();
  if (enhancedPath) {
    env.PATH = enhancedPath;
  }

  try {
    const result = await execa(file, finalArgs, {
      timeout: timeoutSeconds * 1000,
      maxBuffer: MAX_BUFFER,
      reject: false,
      windowsHide: true,
      env,
      ...(useStdin ? { input: prompt } : {}),
      ...(signal ? { cancelSignal: signal } : {}),
      ...(cwd ? { cwd } : {}),
    });

    return {
      stdout: result.stdout || "",
      stderr: redactSecrets(result.stderr || ""),
      exitCode: result.exitCode ?? 1,
      duration_ms: Date.now() - start,
    };
  } catch (error: any) {
    return {
      stdout: "",
      stderr: redactSecrets(error.message || "Execution failed"),
      exitCode: 1,
      duration_ms: Date.now() - start,
    };
  }
}
