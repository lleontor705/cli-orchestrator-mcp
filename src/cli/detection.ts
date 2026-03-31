import { execa } from "execa";
import type { CliProvider, DetectionResult } from "../types/index.js";
import { CLI_DEFINITIONS } from "./definitions.js";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  result: DetectionResult;
  timestamp: number;
}

const cache = new Map<CliProvider, CacheEntry>();
let detected = false;
let detectedAt = 0;

const isWindows = process.platform === "win32";
const whichCmd = isWindows ? "where" : "which";

function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

async function runWhich(binary: string): Promise<string> {
  const { stdout } = await execa(whichCmd, [binary], {
    timeout: 5000,
    windowsHide: true,
  });
  return stdout;
}

async function getVersion(binary: string): Promise<string | null> {
  try {
    if (!execa) return null;
    const { stdout } = await execa(binary, ["--version"], {
      timeout: 5000,
      windowsHide: true,
    });
    const line = stdout.trim().split(/\r?\n/)[0];
    return line || null;
  } catch {
    return null;
  }
}

export async function detectCli(provider: CliProvider): Promise<DetectionResult> {
  const cached = cache.get(provider);
  if (cached && isCacheValid(cached)) return cached.result;

  const binary = CLI_DEFINITIONS[provider].binary;
  try {
    const stdout = await runWhich(binary);
    const pathLine = stdout.trim().split(/\r?\n/)[0];
    const version = await getVersion(binary);
    const result: DetectionResult = { installed: true, path: pathLine, version };
    cache.set(provider, { result, timestamp: Date.now() });
    return result;
  } catch {
    const result: DetectionResult = { installed: false, path: null, version: null };
    cache.set(provider, { result, timestamp: Date.now() });
    return result;
  }
}

export async function detectAll(): Promise<Map<CliProvider, DetectionResult>> {
  if (detected && Date.now() - detectedAt < CACHE_TTL_MS) {
    return new Map([...cache].map(([k, v]) => [k, v.result]));
  }
  const providers: CliProvider[] = ["claude", "gemini", "codex"];
  await Promise.all(providers.map(detectCli));
  detected = true;
  detectedAt = Date.now();
  return new Map([...cache].map(([k, v]) => [k, v.result]));
}

export function getDetectionCache(): Map<CliProvider, DetectionResult> {
  return new Map([...cache].map(([k, v]) => [k, v.result]));
}
