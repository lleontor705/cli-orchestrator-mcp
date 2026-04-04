/**
 * Redacts API keys and secrets from text to prevent leaking credentials
 * in error messages, logs, and user-facing output.
 */
const SECRET_PATTERNS = [
  /(?:sk-ant-|sk-)[a-zA-Z0-9_-]{20,}/g,
  /AIza[a-zA-Z0-9_-]{20,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /gh[ps]_[a-zA-Z0-9]{36,}/g,
  /github_pat_[a-zA-Z0-9_]{20,}/g,
  /[sr]k_(?:live|test)_[a-zA-Z0-9]{20,}/g,
  /xox[bpras]-[a-zA-Z0-9-]{10,}/g,
  /key-[a-zA-Z0-9_-]{20,}/g,
  /:\/\/[^@\s]+:[^@\s]+@/g,
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}
