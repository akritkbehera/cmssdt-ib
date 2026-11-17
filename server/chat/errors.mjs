export class ChatError extends Error {
  constructor(code, message, status = 502, source, kind) { super(message); Object.assign(this, { code, status, source, kind }); }
}

// Node/undici network error codes that indicate a transient transport failure.
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CLOSED', 'ERR_STREAM_PREMATURE_CLOSE']);
const HTTP_STATUS = error => {
  const value = Number(error?.status ?? error?.statusCode ?? (typeof error?.code === 'number' ? error.code : NaN));
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
};
const jsonRpcCode = error => {
  if (typeof error?.code === 'number' && error.code < 0) return error.code;
  const match = /^MCP error (-?\d+)/.exec(String(error?.message || ''));
  return match ? Number(match[1]) : undefined;
};

// Kinds distinguish authentication, authorization, timeouts, cancellation,
// transient transport failures, expired MCP sessions, MCP protocol errors and
// invalid tool arguments. They survive conversion to public ChatErrors so the
// real failure category is never flattened into a generic message.
export function classifyError(error, { signal } = {}) {
  if (error instanceof ChatError) {
    return { kind: error.kind || kindFromCode(error.code), code: error.code, status: error.status,
      source: error.source, retryable: false, aborted: error.kind === 'cancelled', timedOut: error.kind === 'timeout', httpStatus: undefined };
  }
  const message = String(error?.message || ''), name = String(error?.name || '');
  // The request signal is authoritative about why a request stopped: a
  // TimeoutError reason is a timeout, any other abort is a cancellation. The
  // SDK wraps both as McpError(-32001), so message matching alone is not
  // enough to tell them apart.
  if (signal?.aborted) {
    return signal.reason?.name === 'TimeoutError' || name === 'TimeoutError'
      ? { kind: 'timeout', code: 'upstream_timeout', status: 504, retryable: true, aborted: false, timedOut: true }
      : { kind: 'cancelled', code: 'request_cancelled', status: 499, retryable: false, aborted: true, timedOut: false };
  }
  const aborted = name === 'AbortError' || error?.code === 'ABORT_ERR' || Boolean(error?.aborted) || /\bAbortError\b/i.test(message);
  const timedOut = name === 'TimeoutError' || /timeout|timed out/i.test(message);
  if (aborted || timedOut) {
    return timedOut && !aborted
      ? { kind: 'timeout', code: 'upstream_timeout', status: 504, retryable: true, aborted: false, timedOut: true }
      : { kind: 'cancelled', code: 'request_cancelled', status: 499, retryable: false, aborted: true, timedOut: false };
  }
  const rpc = jsonRpcCode(error);
  if (name === 'McpError' || rpc !== undefined) {
    if (rpc === -32001) return { kind: 'timeout', code: 'upstream_timeout', status: 504, retryable: true, aborted: false, timedOut: true, rpc };
    if (rpc === -32000) return { kind: 'session', code: 'mcp_session_expired', status: 502, retryable: true, aborted: false, timedOut: false, rpc };
    if (rpc === -32602) return { kind: 'invalid_arguments', code: 'invalid_tool_arguments', status: 502, retryable: false, aborted: false, timedOut: false, rpc };
    if (rpc === -32603) return { kind: 'protocol', code: 'mcp_protocol_error', status: 502, retryable: false, aborted: false, timedOut: false, rpc };
    return { kind: 'protocol', code: 'mcp_protocol_error', status: 502, retryable: false, aborted: false, timedOut: false, rpc };
  }
  const status = HTTP_STATUS(error);
  if (status !== undefined) {
    const base = { status, httpStatus: status, aborted: false, timedOut: false };
    if (status === 401 || /\b401\b|unauthorized/i.test(message)) return { ...base, kind: 'authentication', code: 'authentication_required', retryable: false };
    if (status === 403 || /\b403\b|forbidden/i.test(message)) return { ...base, kind: 'authorization', code: 'permission_denied', retryable: false };
    // MCP Streamable HTTP: 404/410 on a POST with a session means "session not found".
    if (status === 404 || status === 410) return { ...base, kind: 'session', code: 'mcp_session_expired', retryable: true };
    if ([408, 425, 429].includes(status) || status >= 500) return { ...base, kind: 'http_transient', code: 'upstream_unavailable', retryable: true };
    return { ...base, kind: 'http_client', code: 'mcp_request_rejected', retryable: false };
  }
  // Some transport layers surface auth failures as bare errors with the status
  // only in the message; classify those before the network heuristics.
  if (/\b401\b|unauthorized/i.test(message)) return { kind: 'authentication', code: 'authentication_required', status: 401, retryable: false, aborted: false, timedOut: false };
  if (/\b403\b|forbidden/i.test(message)) return { kind: 'authorization', code: 'permission_denied', status: 403, retryable: false, aborted: false, timedOut: false };
  if (NETWORK_CODES.has(error?.code) || /fetch failed|terminated|socket hang up|other side closed|network|ECONN|getaddrinfo|tls|certificate/i.test(message)) {
    return { kind: 'transport', code: 'transport_failure', status: 502, retryable: true, aborted: false, timedOut: false };
  }
  return { kind: 'unknown', code: 'upstream_unavailable', status: 502, retryable: false, aborted: false, timedOut: false };
}

function kindFromCode(code) {
  return ({ authentication_required: 'authentication', permission_denied: 'authorization', upstream_timeout: 'timeout',
    request_cancelled: 'cancelled', mcp_session_expired: 'session', invalid_tool_arguments: 'invalid_arguments',
    mcp_protocol_error: 'protocol', mcp_request_rejected: 'http_client', transport_failure: 'transport' })[code] || 'unknown';
}

const MESSAGES = {
  authentication: target => `${target} rejected authentication. Renew its credential or sign in again.`,
  authorization: target => `${target} denied access. Ask the service owner for the required read permissions.`,
  timeout: () => 'The upstream request timed out. Try a narrower question.',
  cancelled: () => 'The request was cancelled before the answer completed.',
  session: () => 'The OpenSearch MCP session ended mid-investigation and reconnection failed. Start the question again; no conversation data was lost.',
  invalid_arguments: () => 'The generated OpenSearch tool arguments were rejected as invalid (schema mismatch). The tool schema may have changed; retry the question.',
  protocol: info => `OpenSearch MCP could not execute the requested tool${info?.rpc ? ` (code ${info.rpc})` : ''}. This error alone does not establish an expired login or a server restart.`,
  http_client: info => `OpenSearch MCP rejected the request${info?.httpStatus ? ` (HTTP ${info.httpStatus})` : ''}. This is not retryable automatically.`,
  http_transient: info => `OpenSearch MCP failed temporarily${info?.httpStatus ? ` (HTTP ${info.httpStatus})` : ''}. The connection itself worked; retrying usually helps.`,
  transport: () => 'The connection to OpenSearch MCP failed or was reset mid-request. This is usually transient; retry or check network access.',
  unknown: source => `Could not connect to ${source === 'model' ? 'CERN AI Gateway' : 'OpenSearch MCP'}. Check network access, the endpoint and server authentication.`,
};

export function publicError(error, source = 'opensearch') {
  if (error instanceof ChatError) return error;
  const info = classifyError(error);
  const target = source === 'model' ? 'CERN AI Gateway' : 'OpenSearch';
  if (source === 'model' && info.status === 400) {
    // Classify upstream text, but never expose it: it can echo prompts or secrets.
    const detail = String(error?.error?.message || error?.message || '');
    if (/context.{0,30}(?:length|window)|maximum.{0,20}(?:tokens|context)|too many tokens|input.{0,20}too long/i.test(detail)) {
      return new ChatError('model_context_rejected', 'CERN AI Gateway rejected the conversation because it exceeds this model’s context limit. Try this question in a new conversation.', 400, source, 'http_client');
    }
    if (/tool.{0,30}(?:parser|choice|support|enable)|enable.auto.tool|chat template/i.test(detail)) {
      return new ChatError('model_tools_unsupported', 'The selected CERN AI Gateway model rejected tool calling. Its serving configuration must support automatic tool calls; changing your question will not fix this.', 400, source, 'http_client');
    }
  }
  if (source === 'model' && ['http_transient', 'http_client', 'transport'].includes(info.kind)) {
    return new ChatError(info.code, `${target} ${info.kind === 'transport' ? 'connection failed' : `returned an HTTP error (${info.status})`}. The model request did not complete.`, info.status || 502, source, info.kind);
  }
  const message = ({ authentication: MESSAGES.authentication(target), authorization: MESSAGES.authorization(target),
    timeout: MESSAGES.timeout(), cancelled: MESSAGES.cancelled(), session: MESSAGES.session(),
    invalid_arguments: MESSAGES.invalid_arguments(), protocol: MESSAGES.protocol(info), http_client: MESSAGES.http_client(info),
    http_transient: MESSAGES.http_transient(info), transport: MESSAGES.transport(), unknown: MESSAGES.unknown(source) })[info.kind];
  return new ChatError(info.code, message, info.status || 502, source, info.kind);
}
