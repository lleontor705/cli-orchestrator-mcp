/**
 * Redacts API keys and secrets from text to prevent leaking credentials
 * in error messages, logs, and user-facing output.
 */
export function redactSecrets(text: string): string {
  return text.replace(/(?:sk-|key-|AIza)[a-zA-Z0-9_-]{20,}/g, "[REDACTED]");
}
