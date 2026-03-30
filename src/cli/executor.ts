import { execa } from "execa";
import path from "node:path";
import os from "node:os";
import type { CliProvider } from "../types/index.js";
import { CLI_DEFINITIONS, buildArgs } from "./definitions.js";

const STDIN_THRESHOLD = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

const isWindows = process.platform === "win32";

let cachedEnhancedEnv: Record<string, string> | undefined;

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
function getEnhancedEnv(): Record<string, string> | undefined {
  if (!isWindows) return undefined;
  if (cachedEnhancedEnv) return cachedEnhancedEnv;

  const home = os.homedir();
  const extraPaths = [
    path.join(home, "AppData", "Roaming", "npm"),          // npm global
    path.join(home, "scoop", "shims"),                      // scoop
    path.join(home, ".cargo", "bin"),                        // cargo
    path.join(home, "AppData", "Local", "pnpm"),            // pnpm global
  ];

  const currentPath = process.env.PATH || "";
  const newPath = [...extraPaths, currentPath].join(path.delimiter);

  cachedEnhancedEnv = { ...process.env, PATH: newPath } as Record<string, string>;
  return cachedEnhancedEnv;
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

  const args = useStdin
    ? buildArgs(provider, "", mode).filter((a) => a !== "")
    : buildArgs(provider, prompt, mode);

  const { file, prefix } = resolveCommand(binary);
  const finalArgs = [...prefix, ...args];
  const env = getEnhancedEnv() || process.env;
  const mergedEnv = customEnv ? { ...env, ...customEnv } : env;

  try {
    const result = await execa(file, finalArgs, {
      timeout: timeoutSeconds * 1000,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      input: useStdin ? prompt : undefined,
      reject: false,
      cancelSignal: signal,
      cwd,
      env: mergedEnv as Record<string, string>,
    });

    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.exitCode ?? 1,
      duration_ms: Date.now() - start,
    };
  } catch (error: any) {
    return {
      stdout: "",
      stderr: error.message || "Execution failed",
      exitCode: 1,
      duration_ms: Date.now() - start,
    };
  }
}
