import { execa } from "execa";
import type { CliProvider } from "../types/index.js";
import { CLI_DEFINITIONS, buildArgs } from "./definitions.js";

const STDIN_THRESHOLD = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration_ms: number;
}

export async function executeCli(
  provider: CliProvider,
  prompt: string,
  mode: "generate" | "analyze",
  timeoutSeconds: number
): Promise<ExecResult> {
  const binary = CLI_DEFINITIONS[provider].binary;
  const start = Date.now();

  // For large prompts, use stdin to avoid OS arg length limits
  const useStdin = prompt.length > STDIN_THRESHOLD;

  const args = useStdin
    ? buildArgs(provider, "<stdin>", mode).map((a) => (a === prompt ? "<stdin>" : a))
    : buildArgs(provider, prompt, mode);

  try {
    const result = await execa(binary, args, {
      timeout: timeoutSeconds * 1000,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      input: useStdin ? prompt : undefined,
      reject: false,
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
