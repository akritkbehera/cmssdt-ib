import { createHash } from 'node:crypto';
import { ChatError, classifyError } from './errors.mjs';
import { nullDiagnostics } from './diagnostics.mjs';
import { createKerberosFetch } from './kerberos.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const READ_TOOLS = new Set(['ListIndexTool', 'IndexMappingTool', 'SearchIndexTool']);
const DEFAULT_TIMEOUT = 30000;

export function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32); }

// Only type names/flags are logged, never the query or result payload.
export function toolFailureSummary(error) {
  const message = String(error?.message || '');
  const cast = /class ([A-Za-z0-9_.$]+) cannot be cast to class ([A-Za-z0-9_.$]+)/.exec(message);
  return cast ? `${cast[1]} cannot be cast to ${cast[2]}`
    : /parsing_exception|parse_exception|failed to parse/i.test(message) ? 'query_parse_error'
    : /illegal_argument_exception/i.test(message) ? 'illegal_argument'
    : 'unspecified_tool_error';
}

const abortable = (reason, signal) => (signal?.aborted ? (signal.reason ?? new DOMException('Aborted', 'AbortError')) : reason ?? new DOMException('Aborted', 'AbortError'));
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortable(undefined, signal)); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(abortable(undefined, signal)); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
// Exponential backoff with jitter: base 250ms doubling to a 2s cap, ±50% jitter.
const backoff = attempt => Math.round(Math.min(2000, 250 * 2 ** (attempt - 1)) * (0.5 + Math.random()));

// Bounded recovery for read-only MCP operations. Retries only genuinely
// transient failures (network resets, 408/429/5xx, request timeouts). Expired
// MCP sessions and broken transports trigger one reinitialize before the
// retry. Authentication failures are only retried after a successful forced
// credential refresh; they are never blindly replayed. Cancellation is always
// respected and persistent failures are not masked.
export async function runWithRecovery({ run, stage, tool, signal, diagnostics = nullDiagnostics,
  reconnect, refreshAndReconnect, readOnly = true, maxAttempts = 3 }) {
  let refreshed = false, reconnected = false;
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    try {
      const value = await run();
      if (stage === 'tools/call' && !value?.isError) diagnostics.recordSuccess?.();
      diagnostics.log('mcp_operation', { stage, tool, attempt, durationMs: Date.now() - started, outcome: 'ok' });
      return value;
    } catch (error) {
      const info = classifyError(error, { signal });
      diagnostics.log('mcp_operation', { stage, tool, attempt, durationMs: Date.now() - started, outcome: 'error',
        errorKind: info.kind, errorCode: info.code, httpStatus: info.httpStatus, rpcCode: info.rpc,
        timedOut: info.timedOut, aborted: info.aborted, errorSummary: info.rpc === -32603 ? toolFailureSummary(error) : undefined });
      if (info.aborted || signal?.aborted) throw error;
      if (info.kind === 'authentication' && refreshAndReconnect && !refreshed) {
        refreshed = true;
        if (await refreshAndReconnect()) { diagnostics.log('mcp_recovery', { stage, tool, action: 'credential_refresh', attempt }); continue; }
        throw error;
      }
      const wantsRecovery = info.kind === 'session' || info.kind === 'transport';
      if (wantsRecovery && reconnect && !reconnected && readOnly) {
        reconnected = true;
        await reconnect();
        diagnostics.log('mcp_recovery', { stage, tool, action: 'reinitialize', attempt });
        continue;
      }
      const canRetry = readOnly && info.retryable && attempt < maxAttempts;
      if (!canRetry || (wantsRecovery && !reconnect)) throw error;
      const wait = backoff(attempt);
      diagnostics.log('mcp_recovery', { stage, tool, action: 'retry_backoff', attempt, waitMs: wait });
      await sleep(wait, signal);
    }
  }
}

export async function openMcp(config, signal, { diagnostics = nullDiagnostics, timeout = DEFAULT_TIMEOUT } = {}) {
  const started = Date.now();
  try {
    // A fresh client+transport per attempt: the SDK transport cannot restart.
    const client = await runWithRecovery({
      run: async () => {
        const next = new Client({ name: 'cmssdt-insights', version: '1.0.0' });
        const transport = new StreamableHTTPClientTransport(new URL(config.mcpURL), {
          requestInit: { headers: config.mcpHeaders, redirect: 'error' },
          ...(config.kerberosCache ? { fetch: createKerberosFetch(config) } : {}),
        });
        try {
          await next.connect(transport, { signal, timeout });
          return next;
        } catch (error) { await next.close().catch(() => {}); throw error; }
      },
      stage: 'connect', signal, diagnostics, maxAttempts: 2,
    });
    diagnostics.log('mcp_operation', { stage: 'initialize', outcome: 'ok', durationMs: Date.now() - started });
    return client;
  } catch (error) {
    diagnostics.log('mcp_operation', { stage: 'connect', outcome: 'error', durationMs: Date.now() - started,
      errorKind: classifyError(error, { signal }).kind });
    throw error;
  }
}

export async function discoverTools(client, signal, { diagnostics = nullDiagnostics, timeout = DEFAULT_TIMEOUT } = {}) {
  const tools = [];
  let cursor;
  const seen = new Set();
  do {
    const page = await runWithRecovery({ run: () => client.listTools(cursor ? { cursor } : {}, { signal, timeout }),
      stage: 'tools/list', signal, diagnostics });
    tools.push(...page.tools.filter(tool => READ_TOOLS.has(tool.name)));
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new ChatError('tools_not_registered', 'MCP tools/list returned a repeated pagination cursor.', 502, 'opensearch', 'protocol');
    seen.add(cursor);
  } while (cursor);
  if (!tools.length) throw new ChatError('tools_not_registered', 'MCP initialized but no approved read tools were discovered. Register ListIndexTool, IndexMappingTool or SearchIndexTool.', 409, 'opensearch');
  return tools.map(tool => ({ type: 'function', function: {
    name: tool.name, description: tool.description, parameters: tool.inputSchema || { type: 'object' },
  } }));
}

// In-memory tool-schema cache with TTL and schema fingerprints. Tool schemas
// are shared structural metadata (public tool names/descriptions/input
// schemas); they contain no user data, so caching them across requests and
// users never leaks per-user information. Fingerprint comparison detects MCP
// schema changes.
export function createToolCache({ ttl = 600000, max = 16 } = {}) {
  const entries = new Map();
  return {
    get(endpoint) {
      const entry = entries.get(endpoint);
      if (!entry) return undefined;
      entry.hits += 1;
      return entry;
    },
    fresh(endpoint) {
      const entry = entries.get(endpoint);
      return Boolean(entry && Date.now() - entry.cachedAt < ttl);
    },
    set(endpoint, tools) {
      const entry = { endpoint, tools, fingerprint: fingerprint(tools), cachedAt: Date.now(), hits: 0 };
      entries.set(endpoint, entry);
      while (entries.size > max) entries.delete(entries.keys().next().value);
      return entry;
    },
    invalidate(endpoint) { entries.delete(endpoint); },
  };
}

// A session owns one MCP client at a time and recovers it when the transport
// or the server-side session breaks mid-investigation. Reinitializing never
// replays the investigation: only the failed operation is retried.
export function createMcpSession({ config, signal, diagnostics = nullDiagnostics, authRefresh, toolCache = createToolCache() }) {
  let runtime = config, client, closed = false;
  const timeout = config.mcpTimeout || DEFAULT_TIMEOUT;
  const open = async () => { client = await openMcp(runtime, signal, { diagnostics, timeout }); };
  const recover = async ({ refresh } = {}) => {
    await client?.close().catch(() => {});
    client = undefined;
    let refreshed = false;
    if (refresh && authRefresh) { const fresh = await authRefresh(); if (fresh) { runtime = fresh; refreshed = true; } }
    if (closed) throw new ChatError('request_cancelled', 'The request was cancelled.', 499, 'opensearch', 'cancelled');
    await open();
    return refresh ? refreshed : true;
  };
  return {
    get client() { return client; },
    async init() { await open(); return this; },
    async discoverTools({ fresh = false } = {}) {
      const cached = toolCache.get(runtime.mcpURL);
      if (!fresh && toolCache.fresh(runtime.mcpURL)) {
        diagnostics.log('mcp_operation', { stage: 'tools/list', outcome: 'cache_hit', toolFingerprint: cached.fingerprint });
        return cached.tools;
      }
      const tools = await discoverTools(client, signal, { diagnostics, timeout });
      const entry = toolCache.set(runtime.mcpURL, tools);
      if (cached && cached.fingerprint !== entry.fingerprint) {
        diagnostics.log('mcp_schema_change', { stage: 'tools/list', previous: cached.fingerprint, current: entry.fingerprint });
      }
      return tools;
    },
    async callTool(name, args, { stage = 'tools/call', readOnly = true } = {}) {
      diagnostics.log('mcp_tool_request', { stage, tool: name, argumentKeys: Object.keys(args || {}).sort().join(','),
        queryType: typeof args?.query, rawResponseRequested: args?.return_raw_response === true || args?.return_raw_response === 'true' });
      return runWithRecovery({
        run: () => client.callTool({ name, arguments: args }, undefined, { signal, timeout }),
        stage, tool: name, signal, diagnostics, readOnly,
        reconnect: () => recover(), refreshAndReconnect: () => recover({ refresh: true }),
      });
    },
    async close() {
      closed = true;
      const active = client;
      client = undefined;
      await active?.close().catch(() => {});
      diagnostics.log('mcp_operation', { stage: 'close', outcome: 'ok' });
    },
  };
}

// Wrap a caller-provided raw MCP client (used by tests and one-shot probes).
// Recovery retries transient failures but cannot reinitialize a foreign client.
export function wrapMcpClient(client, { signal, diagnostics = nullDiagnostics, toolCache = createToolCache(), endpoint = 'external' } = {}) {
  return {
    get client() { return client; },
    async init() { return this; },
    async discoverTools({ fresh = false } = {}) {
      if (!fresh && toolCache.fresh(endpoint)) return toolCache.get(endpoint).tools;
      const tools = await discoverTools(client, signal, { diagnostics });
      toolCache.set(endpoint, tools);
      return tools;
    },
    async callTool(name, args, { stage = 'tools/call', readOnly = true } = {}) {
      return runWithRecovery({ run: () => client.callTool({ name, arguments: args }, undefined, { signal, timeout: DEFAULT_TIMEOUT }),
        stage, tool: name, signal, diagnostics, readOnly });
    },
    async close() { await client.close().catch(() => {}); },
  };
}
