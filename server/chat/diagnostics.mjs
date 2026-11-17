import { randomUUID } from 'node:crypto';

// Structured, sanitized diagnostics for MCP operations. Records are single
// JSON lines on stderr. Access tokens, cookies, client secrets, authorization
// headers, credentials and query payloads are never logged: only scalar
// metadata (stage, tool, duration, status, error kind, retry attempt) is
// allowed through, and strings are scrubbed defensively.
const SECRET_PATTERN = /(Bearer\s+[A-Za-z0-9._~+/=-]+)|(Basic\s+[A-Za-z0-9+/=]+)|(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})|((?:access_token|refresh_token|client_secret|id_token|api[_-]?key|password|passwd|authorization|proxy-authorization|set-cookie|cookie|session|token)["']?\s*[:=]\s*["']?(?:Basic\s+|Bearer\s+)?[^\s"',}]+)|((?:[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@)/gi;
const scrub = text => String(text).replace(SECRET_PATTERN, '[redacted]');
// Same scrubbing is applied to tool-result text before it is fed back to the
// model or stored as evidence: upstream errors can echo request headers.
export const sanitizeSecrets = scrub;
const scalar = value => {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (value === undefined) return undefined;
  return scrub(String(value)).slice(0, 300);
};

export function createDiagnostics({ correlationId = randomUUID(), enabled = process.env.CHAT_DIAGNOSTICS !== 'off', sink } = {}) {
  let successfulToolCalls = 0;
  const write = sink || (line => { process.stderr.write(`${line}\n`); });
  return {
    correlationId,
    recordSuccess() { successfulToolCalls += 1; },
    get successfulToolCalls() { return successfulToolCalls; },
    log(event, fields = {}) {
      if (!enabled) return;
      const record = { event, correlationId, successfulToolCalls };
      for (const [key, value] of Object.entries(fields)) {
        const clean = scalar(value);
        if (clean !== undefined) record[key] = clean;
      }
      try { write(JSON.stringify(record)); } catch { /* Diagnostics must never break a request. */ }
    },
  };
}

export const nullDiagnostics = createDiagnostics({ correlationId: 'none', enabled: false });
