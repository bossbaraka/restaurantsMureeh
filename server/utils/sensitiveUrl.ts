const SENSITIVE_QUERY_PARAMS =
  /([?&])(sessionToken|qrToken|token|access_token|refresh_token|pin|password|secret|apiKey)=[^&\s]*/gi;

/**
 * Redact capability tokens and credentials from logged request URLs.
 * EventSource requests use query parameters for authentication because they
 * cannot set headers, so these values must never be written to access logs.
 */
export function redactSensitiveUrl(url: string): string {
  return url.replace(SENSITIVE_QUERY_PARAMS, '$1$2=[REDACTED]');
}
