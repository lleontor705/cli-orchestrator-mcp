import { execa } from "execa";
import path from "node:path";
import os from "node:os";
import type { CliProvider } from "../types/index.js";
import { CLI_DEFINITIONS, buildArgs } from "./definitions.js";
import { buildFilteredEnv } from "../utils/env-allowlist.js";
import { redactSecrets } from "../utils/redact.js";

const STDIN_THRESHOLD = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB
const LARGE_OUTPUT_THRESHOLD = 1 * 1024 * 1024; // 1MB — stream instead of buffering

const isWindows = process.platform === "win32";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration_ms: number;
}

/**
 * On Windows, CLIs installed via npm/scoop/cargo may be .cmd/.bat shims.
 * When launched without a shell (e.g., from editors like VS Code or OpenCode),
 * execa cannot execute .cmd files directly. This helper detects that case and
 * wraps the invocation with `cmd /c`.
 */
function resolveCommand(binary: string): { file: string; prefix: string[] } {
  if (!isWindows) return { file: binary, prefix: [] };

  // Check common extensions for Windows shims
  const ext = path.extname(binary).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    return { file: "cmd", prefix: ["/c", binary] };
  }

  // For bare names, check if a .cmd shim exists via PATHEXT
  const pathext = (process.env.PATHEXT || "").toLowerCase();
  if (pathext.includes(".cmd") || pathext.includes(".bat")) {
    // Let cmd handle the PATH resolution for .cmd shims
    return { file: "cmd", prefix: ["/c", binary] };
  }

  return { file: binary, prefix: [] };
}

/** Build enhanced PATH that includes common Windows CLI install locations */
function getEnhancedPath(): string | undefined {
  if (!isWindows) return undefined;

  const home = os.homedir();
  const extraPaths = [
    path.join(home, "AppData", "Roaming", "npm"),          // npm global
    path.join(home, "scoop", "shims"),                      // scoop
    path.join(home, ".cargo", "bin"),                        // cargo
    path.join(home, "AppData", "Local", "pnpm"),            // pnpm global
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
  customEnv?: Record<string, string>
): Promise<ExecResult> {
  const binary = CLI_DEFINITIONS[provider].binary;
  const start = Date.now();

  // For large prompts, use stdin to avoid OS arg length limits
  const useStdin = prompt.length > STDIN_THRESHOLD;

  // Build args as array — never via string concatenation / shell: true
  const args = useStdin
    ? buildArgs(provider, "", mode).filter((a) => a !== "")
    : buildArgs(provider, prompt, mode);

  const { file, prefix } = resolveCommand(binary);
  const finalArgs = [...prefix, ...args];

  // Build filtered env: only allowlisted vars + provider API keys
  const filteredEnv = buildFilteredEnv(provider, customEnv);

  // Enhance PATH on Windows
  const enhancedPath = getEnhancedPath();
  if (enhancedPath) {
    filteredEnv.PATH = enhancedPath;
  }

  const timeoutMs = timeoutSeconds * 1000;

  const baseOptions = {
    timeout: timeoutMs,
    windowsHide: true,
    input: useStdin ? prompt : undefined,
    reject: false,
    cancelSignal: signal,
    cwd,
    env: filteredEnv,
  } as const;

  try {
    const result = await execa(file, finalArgs, {
      ...baseOptions,
      maxBuffer: MAX_BUFFER,
    } as any);

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
