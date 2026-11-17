export class ChatError extends Error {
  constructor(code, message, status = 502, source) { super(message); Object.assign(this, { code, status, source }); }
}

export function publicError(error, source = 'opensearch') {
  if (error instanceof ChatError) return error;
  const status = error?.status || error?.statusCode || error?.code;
  const message = String(error?.message || '');
  if (status === 401 || /\b401\b|unauthorized/i.test(message)) return new ChatError('authentication_required', `${source === 'model' ? 'CERN AI Gateway' : 'OpenSearch'} rejected authentication. Renew its credential or sign in again.`, 401, source);
  if (status === 403 || /\b403\b|forbidden/i.test(message)) return new ChatError('permission_denied', `${source === 'model' ? 'CERN AI Gateway' : 'OpenSearch'} denied access. Ask the service owner for the required read permissions.`, 403, source);
  if (error?.name === 'AbortError' || /timeout|timed out/i.test(message)) return new ChatError('upstream_timeout', 'The upstream request timed out. Try a narrower question.', 504, source);
  if (source === 'opensearch' && Number.isInteger(Number(error?.code)) && Number(error.code) < 0) {
    return new ChatError('mcp_request_failed', `OpenSearch MCP returned an error (code ${error.code}). Try a narrower query; this does not establish a lost connection.`, 502, source);
  }
  return new ChatError('upstream_unavailable', `Could not connect to ${source === 'model' ? 'CERN AI Gateway' : 'OpenSearch MCP'}. Check network access, the endpoint and server authentication.`, 502, source);
}
