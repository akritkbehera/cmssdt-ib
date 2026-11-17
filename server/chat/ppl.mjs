import { ChatError } from './errors.mjs';
import { sanitizeSecrets, nullDiagnostics } from './diagnostics.mjs';
import { createKerberosFetch } from './kerberos.mjs';

export const DEFAULT_PPL_INDICES = [
  'cmssdt-ib-matrix-*', 'cmssdt-ibs-*', 'cmssdt-ib-dataset-*',
  'cmssdt-jenkins-jobs-*', 'cmssdt-jenkins-ibs-*',
  'cmssdt-relvals_stats_summary-*', 'cmssdt-externals_stats_summary-*',
];
export const PPL_TOOL_NAME = 'execute_opensearch_ppl';
export const PPL_TOOL = { type: 'function', function: {
  name: PPL_TOOL_NAME,
  description: 'Execute read-only PPL directly against OpenSearch, using the same backend credentials as MCP. Prefer this for simple counts, grouped statistics and numeric comparisons. First discover concrete open indices and field types using ListIndexTool/IndexMappingTool; do not guess generations, fields, units, completion or full-build semantics. Syntax: source = concrete-index | where field = \'value\' | stats count() as total by field | sort - total | head 20. Supported commands: where, stats (count/sum/avg/min/max), fields, sort (prefix +/-), head. No wildcards in source, multiple sources, joins, subqueries, comments, eval, remote sources or writes. Use single-quoted string values and backticks for special field names. Use SearchIndexTool for complex DSL or unsupported PPL. Results contain schema, datarows and explicit truncation metadata; missing/error output never proves zero records.',
  parameters: { type: 'object', properties: {
    query: { type: 'string', minLength: 1, maxLength: 8000 },
    max_rows: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
  }, required: ['query'], additionalProperties: false },
} };

const invalid = () => new ChatError('ppl_invalid_query', 'Unsupported PPL. Use one concrete approved source and only where, stats(count/sum/avg/min/max), fields, sort, head. No comments, subqueries or additional sources.', 400, 'opensearch', 'invalid_arguments');

// A fail-closed parser for a small grammar, not a denylist or a rewriting
// sanitizer. Only token sequences fully consumed by these productions run.
// Quoted pipes remain literals; brackets, comments and unknown tokens fail.
function lex(input) {
  const tokens = [];
  const pattern = /\s+|'[^'\\\x00-\x1f]*'|`[A-Za-z_@][A-Za-z0-9_@.\-]*`|[A-Za-z_@][A-Za-z0-9_@.]*|\d+(?:\.\d+)?|!=|<=|>=|<>|[=<>(),|+\-]/y;
  let offset = 0;
  while (offset < input.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(input);
    if (!match) throw invalid();
    offset = pattern.lastIndex;
    const value = match[0];
    if (!/^\s+$/.test(value)) tokens.push(value);
    if (tokens.length > 1500) throw invalid();
  }
  return tokens;
}

export function validatePpl(query, { patterns = DEFAULT_PPL_INDICES, maxRows = 100 } = {}) {
  if (typeof query !== 'string' || query.length > 8000 || !Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100) throw invalid();
  const source = /^\s*(?:search\s+)?source\s*=\s*(`?)([a-z][a-z0-9_-]{0,180})\1(?=\s|\||$)/i.exec(query);
  if (!source) throw invalid();
  const index = source[2];
  if (!patterns.some(pattern => pattern.endsWith('*') ? index.startsWith(pattern.slice(0, -1)) && index.length > pattern.length - 1 : index === pattern)) {
    throw new ChatError('ppl_index_denied', 'This index is not approved for PPL access.', 403, 'opensearch', 'authorization');
  }
  const tokens = lex(query.slice(source[0].length));
  let pos = 0, stages = 0, depth = 0;
  const peek = value => tokens[pos]?.toLowerCase() === value;
  const take = value => { if (peek(value)) { pos++; return true; } return false; };
  const need = value => { if (!take(value)) throw invalid(); };
  const field = () => {
    if (!/^(?:[A-Za-z_@][A-Za-z0-9_@.]*|`[A-Za-z_@][A-Za-z0-9_@.\-]*`)$/.test(tokens[pos] || '')) throw invalid();
    pos++;
  };
  const literal = () => {
    take('-');
    if (!/^(?:'[^'\\\x00-\x1f]*'|\d+(?:\.\d+)?|true|false|null)$/i.test(tokens[pos] || '')) throw invalid();
    pos++;
  };
  const list = parse => { parse(); while (take(',')) parse(); };
  const atom = () => {
    if (++depth > 16) throw invalid();
    if (take('not')) atom();
    else if (take('(')) { expression(); need(')'); }
    else {
      field();
      if (take('is')) { take('not'); need('null'); }
      else if (take('in')) { need('('); list(literal); need(')'); }
      else {
        if (!['=', '!=', '<>', '<', '<=', '>', '>='].includes(tokens[pos++])) throw invalid();
        literal();
      }
    }
    depth--;
  };
  const conjunction = () => { atom(); while (take('and')) atom(); };
  const expression = () => { conjunction(); while (take('or')) conjunction(); };
  // Require filters to use an explicit where stage; no ambiguous inline DSL.
  while (pos < tokens.length) {
    if (++stages > 12) throw invalid();
    need('|');
    const command = tokens[pos++]?.toLowerCase();
    if (command === 'where') expression();
    else if (command === 'fields') list(field);
    else if (command === 'sort') list(() => { if (!take('-')) take('+'); field(); });
    else if (command === 'head') {
      const count = tokens[pos++];
      if (!/^\d+$/.test(count || '') || Number(count) < 1 || Number(count) > maxRows) throw invalid();
      if (pos < tokens.length) throw invalid(); // never aggregate a pre-limited sample
    } else if (command === 'stats') {
      list(() => {
        const fn = tokens[pos++]?.toLowerCase();
        if (!['count', 'sum', 'avg', 'min', 'max'].includes(fn)) throw invalid();
        need('(');
        if (!peek(')') || fn !== 'count') field();
        need(')');
        if (take('as')) field();
      });
      if (take('by')) list(field);
    } else throw invalid();
    if (pos < tokens.length && !peek('|')) throw invalid();
  }
  // A trailing head is always added after aggregation/sort; never pre-limit
  // input documents, which would silently change counts and averages.
  return { index, query: `${query.trim()} | head ${maxRows}`, maxRows };
}

// Shared per-process admission limits complement the HTTP server's four-chat
// concurrency bound. These contain timestamps/counters only, never user data.
export function createPplLimiter({ now = Date.now, concurrency = 2, perMinute = 30 } = {}) {
  let active = 0;
  const starts = [];
  return () => {
    const at = now();
    while (starts.length && starts[0] <= at - 60000) starts.shift();
    if (active >= concurrency || starts.length >= perMinute) throw new ChatError('ppl_busy', 'PPL is busy or its request budget is exhausted. Retry shortly.', 429, 'opensearch', 'http_transient');
    active++; starts.push(at);
    let released = false;
    return () => { if (!released) { active--; released = true; } };
  };
}
const admit = createPplLimiter();

async function boundedJson(response, bytes) {
  if (!response.body) throw new ChatError('ppl_invalid_response', 'OpenSearch PPL returned no JSON body.', 502, 'opensearch');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > bytes) throw new ChatError('ppl_response_too_large', 'PPL response exceeded its byte limit. Select fewer fields or use an aggregation.', 502, 'opensearch');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ChatError('ppl_invalid_response', 'OpenSearch PPL returned invalid JSON.', 502, 'opensearch'); }
}

function upstreamIssue(status, payload) {
  // Inspect only for classification; never forward the upstream text, query,
  // URL, stack trace or headers to a user/model/log.
  const detail = JSON.stringify(payload);
  if (/IndexClosedException|index_closed_exception/i.test(detail)) return new ChatError('ppl_index_closed', 'The selected PPL index is closed. Discover an open index.', 400, 'opensearch');
  if (status === 404 || /index_not_found_exception/i.test(detail)) return new ChatError('ppl_index_missing', 'The selected PPL index was not found. Discover a current open index.', 404, 'opensearch');
  if (status === 401) return new ChatError('authentication_required', 'OpenSearch PPL authentication expired or was rejected.', 401, 'opensearch', 'authentication');
  if (status === 403) return new ChatError('permission_denied', 'The OpenSearch identity lacks PPL or index read permission.', 403, 'opensearch', 'authorization');
  if (status === 408 || status === 504 || /timeout_exception|timed out/i.test(detail)) return new ChatError('ppl_timeout', 'OpenSearch PPL timed out. Use a smaller scope.', 504, 'opensearch', 'timeout');
  if (status === 400) return new ChatError('ppl_query_rejected', 'OpenSearch rejected this PPL query. Check field mappings and supported syntax.', 400, 'opensearch', 'invalid_arguments');
  return new ChatError('ppl_unavailable', 'OpenSearch PPL is unavailable. Retry later.', 502, 'opensearch');
}

export async function executePpl(config, args, { signal, fetchImpl, diagnostics = nullDiagnostics, limiter = admit } = {}) {
  let release; const start = Date.now();
  try {
    const checked = validatePpl(args?.query, { patterns: config.pplIndices || DEFAULT_PPL_INDICES, maxRows: args?.max_rows ?? 100 });
    release = limiter();
    const timeout = AbortSignal.timeout(config.pplTimeout ?? 120000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const request = fetchImpl || (config.kerberosCache ? createKerberosFetch(config, undefined, { target: 'ppl', timeoutMs: config.pplTimeout }) : fetch);
    let response;
    try {
      response = await request(config.pplURL, { method: 'POST', redirect: 'error', signal: requestSignal,
        headers: { ...config.mcpHeaders, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: checked.query }) });
      if (response.status === 401 && config.authRefresh && !config.kerberosCache) {
        await response.body?.cancel();
        const fresh = await config.authRefresh();
        if (fresh) response = await request(config.pplURL, { method: 'POST', redirect: 'error', signal: requestSignal,
          headers: { ...fresh.mcpHeaders, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: checked.query }) });
      }
      if ([401, 403].includes(response.status)) {
        await response.body?.cancel();
        throw upstreamIssue(response.status, {});
      }
      let payload;
      try { payload = await boundedJson(response, config.pplMaxBytes ?? 131072); }
      catch (error) { if (!response.ok) throw upstreamIssue(response.status, {}); throw error; }
      if (!response.ok || payload?.error) throw upstreamIssue(response.status, payload);
      if (!Array.isArray(payload.schema) || !Array.isArray(payload.datarows) || payload.schema.length > 100 ||
        payload.datarows.some(row => !Array.isArray(row) || row.length !== payload.schema.length)) {
        throw new ChatError('ppl_invalid_response', 'OpenSearch PPL returned an unexpected result shape.', 502, 'opensearch');
      }
      const rows = payload.datarows.slice(0, checked.maxRows);
      const result = { schema: payload.schema, datarows: rows, returnedRows: rows.length,
        total: typeof payload.total === 'number' ? payload.total : null,
        rowLimit: checked.maxRows, limitReached: rows.length === checked.maxRows,
        truncated: payload.datarows.length > rows.length,
        note: 'A trailing head limits returned groups/rows, not input documents. limitReached means more groups may exist. total is the PPL response row total, not necessarily the source document count.',
        retrievedAt: new Date().toISOString() };
      diagnostics.recordSuccess?.();
      diagnostics.log('ppl_operation', { stage: 'tools/call', tool: PPL_TOOL_NAME, outcome: 'ok', durationMs: Date.now() - start, rows: rows.length });
      return { content: [{ type: 'text', text: sanitizeSecrets(JSON.stringify(result)) }], isError: false };
    } catch (error) {
      if (requestSignal.aborted) throw new ChatError(signal?.aborted ? 'request_cancelled' : 'ppl_timeout', signal?.aborted ? 'PPL request cancelled.' : 'OpenSearch PPL timed out. Use a smaller scope.', signal?.aborted ? 499 : 504, 'opensearch', signal?.aborted ? 'cancelled' : 'timeout');
      throw error;
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    const issue = error instanceof ChatError ? error : new ChatError('ppl_transport_failed', 'Could not reach OpenSearch PPL. Check the backend network and authentication.', 502, 'opensearch');
    diagnostics.log('ppl_operation', { stage: 'tools/call', tool: PPL_TOOL_NAME, outcome: 'error', errorCode: issue.code, status: issue.status, durationMs: Date.now() - start });
    return { content: [{ type: 'text', text: JSON.stringify({ code: issue.code, message: issue.message }) }], isError: true };
  } finally { release?.(); }
}
