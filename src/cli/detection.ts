import { execaCommand } from "execa";
import type { CliProvider, DetectionResult } from "../types/index.js";
import { CLI_DEFINITIONS } from "./definitions.js";

const cache = new Map<CliProvider, DetectionResult>();
let detected = false;

const isWindows = process.platform === "win32";
const whichCmd = isWindows ? "where" : "which";

export async function detectCli(provider: CliProvider): Promise<DetectionResult> {
  if (cache.has(provider)) return cache.get(provider)!;

  const binary = CLI_DEFINITIONS[provider].binary;
  try {
    const { stdout } = await execaCommand(`${whichCmd} ${binary}`, {
      timeout: 5000,
      windowsHide: true,
    });
    const pathLine = stdout.trim().split("\n")[0];
    const result: DetectionResult = { installed: true, path: pathLine, version: null };
    cache.set(provider, result);
    return result;
  } catch {
    const result: DetectionResult = { installed: false, path: null, version: null };
    cache.set(provider, result);
    return result;
  }
}

export async function detectAll(): Promise<Map<CliProvider, DetectionResult>> {
  if (detected) return cache;
  const providers: CliProvider[] = ["claude", "gemini", "codex"];
  await Promise.all(providers.map(detectCli));
  detected = true;
  return cache;
}

export function getDetectionCache(): Map<CliProvider, DetectionResult> {
  return cache;
}
