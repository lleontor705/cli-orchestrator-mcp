import type { CliProvider } from "../types/index.js";

/**
 * Base environment variables safe to pass to all spawned CLI processes.
 * Only explicitly allowlisted vars are forwarded — never the full process.env.
 */
const BASE_ALLOWLIST: readonly string[] = [
  // System essentials
  "PATH",
  "HOME",
  "USERPROFILE",
  "USER",
  "USERNAME",
  "LOGNAME",
  "TERM",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  // Windows specifics
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "COMMONPROGRAMFILES",
  // Node/npm
  "NODE_ENV",
  "NODE_PATH",
  "NODE_OPTIONS",
  "npm_config_prefix",
  // XDG (Linux)
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
] as const;

/**
 * Per-CLI API key environment variables.
 * Only the keys needed by a specific provider are forwarded.
 */
const CLI_API_KEYS: Record<CliProvider, readonly string[]> = {
  claude: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"],
  codex: ["OPENAI_API_KEY", "CODEX_HOME"],
  ollama: ["OLLAMA_HOST", "OLLAMA_MODELS"],
};

/**
 * Build a filtered environment for a specific CLI provider.
 * Only includes allowlisted base vars + provider-specific API keys.
 */
export function buildFilteredEnv(
  provider: CliProvider,
  extraEnv?: Record<string, string>,
): Record<string, string> {
  const allowed = new Set<string>([
    ...BASE_ALLOWLIST,
    ...CLI_API_KEYS[provider],
  ]);

  const filtered: Record<string, string> = {};
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) {
      filtered[key] = value;
    }
  }

  // Merge any explicit overrides from the caller
  if (extraEnv) {
    Object.assign(filtered, extraEnv);
  }

  return filtered;
}
