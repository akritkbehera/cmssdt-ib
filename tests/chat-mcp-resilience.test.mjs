import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openMcp, createMcpSession, createToolCache, runWithRecovery, toolFailureSummary } from '../server/chat/mcp.mjs';
import { publicError, classifyError, ChatError } from '../server/chat/errors.mjs';
import { createDiagnostics } from '../server/chat/diagnostics.mjs';

test('internal tool errors are not automatically replayed and diagnostics expose only exception types', async () => {
  let calls = 0;
  const lines = [];
  const error = Object.assign(new Error('class org.example.ModelTensorOutput cannot be cast to class java.lang.String; Bearer SECRET-CREDENTIAL'), { code: -32603 });
  assert.equal(classifyError(error).retryable, false);
  assert.equal(toolFailureSummary(error), 'org.example.ModelTensorOutput cannot be cast to java.lang.String');
  await assert.rejects(runWithRecovery({ run: async () => { calls++; throw error; }, stage: 'tools/call', tool: 'SearchIndexTool',
    diagnostics: createDiagnostics({ sink: line => lines.push(line) }) }));
  assert.equal(calls, 1);
  assert.ok(!lines.join('').includes('SECRET-CREDENTIAL'));
  assert.ok(lines.join('').includes('ModelTensorOutput'));
  assert.ok(!publicError(error).message.includes('restarting'));
});

test('model gateway HTTP failures are never labelled as OpenSearch failures', () => {
  const issue = publicError({ status: 503, message: 'private upstream response' }, 'model');
  assert.match(issue.message, /CERN AI Gateway/);
  assert.ok(!issue.message.includes('OpenSearch'));
  assert.ok(!issue.message.includes('private'));
});

// Controllable mock MCP server speaking JSON-RPC over Streamable HTTP.
function mockMcp(t, { onCall, tools = [{ name: 'SearchIndexTool', description: 'search', inputSchema: { type: 'object', properties: { index: { type: 'string' }, query: { type: 'object' } }, required: ['index'] } }] } = {}) {
  const state = { sessions: 0, current: null, calls: [], perTool: new Map(), listCalls: 0, initCalls: 0 };
  const server = createServer(async (req, res) => {
    if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
    if (req.method === 'GET') { res.writeHead(405).end(); return; } // no server-initiated SSE stream
    let text = '';
    for await (const chunk of req) text += chunk;
    const rpc = text.trim() ? JSON.parse(text) : {};
    if (rpc.id === undefined) { res.writeHead(202).end(); return; }
    state.calls.push(rpc);
    const reply = result => res.writeHead(200, { 'Content-Type': 'application/json', ...(state.current ? { 'mcp-session-id': state.current } : {}) })
      .end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
    const fail = (status, message) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message || 'upstream failure' }));
    if (rpc.method === 'initialize') {
      state.initCalls += 1;
      state.current = `session-${state.sessions += 1}`;
      return reply({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } });
    }
    if (req.headers['mcp-session-id'] && req.headers['mcp-session-id'] !== state.current && state.rejectStaleSessions) {
      return fail(404, 'Session not found');
    }
    if (rpc.method === 'tools/list') { state.listCalls += 1; return reply({ tools: typeof tools === 'function' ? tools() : tools }); }
    if (rpc.method === 'tools/call') {
      state.perTool.set(rpc.params.name, (state.perTool.get(rpc.params.name) || 0) + 1);
      if (onCall) return onCall(rpc, { reply, fail, state, res });
      return reply({ content: [{ type: 'text', text: '{}' }], isError: false });
    }
    reply({});
  });
  const url = (async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return `http://127.0.0.1:${server.address().port}`;
  })();
  return { state, url };
}

const configFor = (url, extra = {}) => ({ mcpURL: url, mcpHeaders: { Authorization: 'Bearer unit-test' }, maxSteps: 4, ...extra });

test('MCP initialization succeeds and failures are classified, with one transient retry', async t => {
  let down = true, attempts = 0;
  const mock = mockMcp(t, {});
  const url = await mock.url;
  const good = await openMcp(configFor(url), AbortSignal.timeout(5000));
  assert.ok(good); await good.close();
  assert.equal(mock.state.initCalls, 1);

  // Persistent 503 on initialize: bounded retries (2 attempts), classified error.
  const server = createServer((req, res) => { attempts++; res.writeHead(503).end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  await assert.rejects(() => openMcp(configFor(`http://127.0.0.1:${server.address().port}`), AbortSignal.timeout(5000)), error => {
    const issue = publicError(error);
    return issue.kind === 'http_transient' && issue.code === 'upstream_unavailable' && issue.message.includes('HTTP 503');
  });
  assert.equal(attempts, 2, 'transient connect failures retry exactly once');
});

test('authentication and authorization failures are classified and never blindly retried', async t => {
  for (const [status, code, kind] of [[401, 'authentication_required', 'authentication'], [403, 'permission_denied', 'authorization']]) {
    let calls = 0;
    const mock = mockMcp(t, { onCall: (rpc, ctx) => { calls++; ctx.fail(status, 'with secret details'); } });
    const session = await createMcpSession({ config: configFor(await mock.url), signal: AbortSignal.timeout(5000) }).init();
    await assert.rejects(() => session.callTool('SearchIndexTool', { index: 'x' }), error => {
      const issue = publicError(error);
      return issue.code === code && issue.kind === kind && !issue.message.includes('secret');
    });
    assert.equal(calls, 1, 'auth failures are not retried');
    await session.close();
  }
});

test('401 triggers a single credential refresh and reconnection before failing', async t => {
  let calls = 0, refreshes = 0, sessions = 0;
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let text = ''; for await (const chunk of req) text += chunk;
    const rpc = text.trim() ? JSON.parse(text) : {};
    if (rpc.id === undefined) { res.writeHead(202).end(); return; }
    if (rpc.method === 'initialize') {
      sessions += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id,
        result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } } }));
      return;
    }
    if (rpc.method === 'tools/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id,
        result: { tools: [{ name: 'SearchIndexTool', inputSchema: { type: 'object', properties: { index: { type: 'string' } }, required: ['index'] } }] } }));
      return;
    }
    calls += 1;
    if (req.headers.authorization !== 'Bearer refreshed-secret') {
      res.writeHead(401).end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id,
      result: { content: [{ type: 'text', text: '{"ok":true}' }], isError: false } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const session = await createMcpSession({
    config: { mcpURL: `http://127.0.0.1:${server.address().port}`, mcpHeaders: { Authorization: 'Bearer stale-secret' } },
    signal: AbortSignal.timeout(5000),
    authRefresh: async () => { refreshes += 1; return { mcpURL: `http://127.0.0.1:${server.address().port}`, mcpHeaders: { Authorization: 'Bearer refreshed-secret' } }; },
  }).init();
  const result = await session.callTool('SearchIndexTool', { index: 'x' });
  assert.equal(result.isError, false);
  assert.equal(refreshes, 1, 'credential refreshed exactly once');
  assert.equal(sessions, 2, 'MCP reinitialized with fresh credentials');
  assert.equal(calls, 2, 'one rejected attempt plus one retry after refresh');
  await session.close();
});

test('mid-investigation transient failure recovers without replaying earlier tool calls', async t => {
  let callCount = 0;
  const mock = mockMcp(t, { onCall: (rpc, ctx) => {
    callCount += 1;
    if (callCount === 2) { ctx.fail(503, 'temporarily overloaded'); return; }
    ctx.reply({ content: [{ type: 'text', text: `{"call":${callCount}}` }], isError: false });
  } });
  const session = await createMcpSession({ config: configFor(await mock.url), signal: AbortSignal.timeout(10000) }).init();
  const first = await session.callTool('SearchIndexTool', { index: 'a' });
  const second = await session.callTool('SearchIndexTool', { index: 'b' });
  const third = await session.callTool('SearchIndexTool', { index: 'c' });
  assert.equal(first.isError, false);
  assert.equal(second.isError, false, 'retried call succeeded');
  assert.equal(third.isError, false);
  assert.equal(mock.state.perTool.get('SearchIndexTool'), 4, 'three queries plus one retry; no replays');
  await session.close();
});

test('expired MCP session is reinitialized and only the failed call is retried', async t => {
  let callCount = 0;
  const mock = mockMcp(t, { onCall: (rpc, ctx) => {
    callCount += 1;
    if (callCount === 2) { ctx.state.current = 'rotated'; ctx.fail(404, 'Session not found'); return; }
    ctx.reply({ content: [{ type: 'text', text: '{"ok":true}' }], isError: false });
  } });
  mock.state.rejectStaleSessions = true;
  const session = await createMcpSession({ config: configFor(await mock.url), signal: AbortSignal.timeout(10000) }).init();
  await session.callTool('SearchIndexTool', { index: 'a' });
  const result = await session.callTool('SearchIndexTool', { index: 'b' });
  assert.equal(result.isError, false, 'recovered after session expiry');
  assert.equal(mock.state.initCalls, 2, 'MCP reinitialized exactly once');
  assert.equal(mock.state.perTool.get('SearchIndexTool'), 3, 'call a ran once, call b ran twice (failed + retried)');
  await session.close();
});

test('broken transport mid-investigation reinitializes and reports transport category on failure', async t => {
  let callCount = 0, destroy = true;
  const mock = mockMcp(t, { onCall: (rpc, ctx) => {
    callCount += 1;
    if (callCount === 2 && destroy) { destroy = false; ctx.res.socket.destroy(); return; }
    ctx.reply({ content: [{ type: 'text', text: '{"ok":true}' }], isError: false });
  } });
  const session = await createMcpSession({ config: configFor(await mock.url), signal: AbortSignal.timeout(10000) }).init();
  await session.callTool('SearchIndexTool', { index: 'a' });
  const result = await session.callTool('SearchIndexTool', { index: 'b' });
  assert.equal(result.isError, false, 'transport failure recovered');
  assert.equal(mock.state.initCalls, 2);
  await session.close();

  // Persistent transport failure: bounded attempts, then a transport category.
  const mock2 = mockMcp(t, { onCall: (rpc, ctx) => { ctx.res.socket.destroy(); } });
  const session2 = await createMcpSession({ config: configFor(await mock2.url), signal: AbortSignal.timeout(10000) }).init();
  await assert.rejects(() => session2.callTool('SearchIndexTool', { index: 'a' }), error => {
    const issue = publicError(error);
    return issue.kind === 'transport' && issue.code === 'transport_failure' && !issue.message.includes('Could not connect');
  });
  assert.equal(mock2.state.perTool.get('SearchIndexTool'), 3, 'bounded attempts');
  await session2.close();
});

test('timeouts are distinguished from cancellation and retried only when safe', async t => {
  let callCount = 0;
  const mock = mockMcp(t, { onCall: (rpc, ctx) => {
    callCount += 1;
    if (callCount <= 2) return; // hang: no response
    ctx.reply({ content: [{ type: 'text', text: '{"ok":true}' }], isError: false });
  } });
  const session = await createMcpSession({ config: configFor(await mock.url, { mcpTimeout: 250 }), signal: AbortSignal.timeout(15000) }).init();
  const result = await session.callTool('SearchIndexTool', { index: 'a' });
  assert.equal(result.isError, false, 'timeout retried and recovered');
  await session.close();

  // Cancellation is immediate and never retried.
  let attempts = 0;
  const mock2 = mockMcp(t, { onCall: (rpc, ctx) => { attempts += 1; return; } });
  const controller = new AbortController();
  const session2 = await createMcpSession({ config: configFor(await mock2.url, { mcpTimeout: 5000 }), signal: controller.signal }).init();
  const pending = session2.callTool('SearchIndexTool', { index: 'a' });
  setTimeout(() => controller.abort(new DOMException('Client disconnected', 'AbortError')), 50).unref();
  await assert.rejects(() => pending, error => {
    const info = classifyError(error, { signal: controller.signal });
    return info.kind === 'cancelled' && info.aborted;
  });
  assert.equal(attempts, 1, 'cancelled requests are not retried');
  await session2.close();
});

test('retries use exponential backoff with jitter and respect abort during backoff', async t => {
  const waits = [];
  let attempts = 0;
  const result = await runWithRecovery({
    run: async () => { attempts += 1; if (attempts < 3) throw { status: 503, message: 'busy' }; return 'ok'; },
    stage: 'tools/call', tool: 'SearchIndexTool', maxAttempts: 3,
    diagnostics: createDiagnostics({ sink: line => { const record = JSON.parse(line); if (record.action === 'retry_backoff') waits.push(record.waitMs); } }),
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.equal(waits.length, 2);
  assert.ok(waits[0] >= 125 && waits[0] <= 375, `first backoff bounded: ${waits[0]}`);
  assert.ok(waits[1] >= 250 && waits[1] <= 750, `second backoff doubles the base with jitter: ${waits.join(',')}`);
  assert.ok(waits.every(wait => wait >= 125 && wait <= 3000), 'backoff bounded with jitter');

  const controller = new AbortController();
  const slow = runWithRecovery({
    run: async () => { throw { status: 503, message: 'busy' }; },
    stage: 'tools/call', tool: 'SearchIndexTool', maxAttempts: 5, signal: controller.signal,
    diagnostics: createDiagnostics({ enabled: false }),
  });
  setTimeout(() => controller.abort(new DOMException('Client disconnected', 'AbortError')), 30).unref();
  await assert.rejects(() => slow, error => classifyError(error, { signal: controller.signal }).aborted);
});

test('MCP tool schema changes invalidate cached schemas by fingerprint', async t => {
  let variant = 0;
  const makeTools = () => [{ name: 'SearchIndexTool', inputSchema: { type: 'object', properties: { index: { type: 'string' }, ...(variant ? { size: { type: 'number' } } : {}) }, required: ['index'] } }];
  const mock = mockMcp(t, { tools: makeTools });
  const cache = createToolCache({ ttl: 60000 });
  const session = await createMcpSession({ config: configFor(await mock.url), signal: AbortSignal.timeout(5000), toolCache: cache }).init();
  const first = await session.discoverTools();
  assert.equal(mock.state.listCalls, 1);
  const again = await session.discoverTools();
  assert.equal(mock.state.listCalls, 1, 'unchanged schemas served from cache');
  assert.equal(again, first);

  variant = 1; // server schema changes; cache TTL still valid
  const changed = await session.discoverTools({ fresh: true });
  assert.equal(mock.state.listCalls, 2);
  assert.ok(JSON.stringify(changed) !== JSON.stringify(first), 'fresh discovery sees the new schema');
  await session.close();
});

test('error classification preserves categories and public messages never leak payloads', () => {
  const cases = [
    [{ status: 401, message: 'Bearer topsecret-token rejected' }, 'authentication_required', 'authentication'],
    [{ status: 403, message: 'no permission' }, 'permission_denied', 'authorization'],
    [{ code: -32602, name: 'McpError', message: 'MCP error -32602: Invalid params' }, 'invalid_tool_arguments', 'invalid_arguments'],
    [{ code: -32001, name: 'McpError', message: 'MCP error -32001: Request timed out' }, 'upstream_timeout', 'timeout'],
    [{ code: -32000, name: 'McpError', message: 'MCP error -32000: Connection closed' }, 'mcp_session_expired', 'session'],
    [{ code: 'ECONNRESET', message: 'read ECONNRESET' }, 'transport_failure', 'transport'],
    [{ status: 502, message: 'bad gateway with internal-stack-fragment' }, 'upstream_unavailable', 'http_transient'],
    [{ message: 'totally unknown' }, 'upstream_unavailable', 'unknown'],
  ];
  for (const [error, code, kind] of cases) {
    const issue = publicError(error);
    assert.equal(issue.code, code, JSON.stringify(error));
    assert.equal(issue.kind, kind);
    assert.ok(!issue.message.includes('topsecret'), 'no credential material in public messages');
    assert.ok(!issue.message.includes('internal-stack-fragment'), 'no upstream payloads in public messages');
  }
  const wrapped = publicError(new ChatError('authentication_required', 'custom', 401, 'opensearch'));
  assert.equal(wrapped.message, 'custom', 'classification preserved through ChatError');
});

test('gateway 400 categories explain context and tool configuration without leaking upstream text', () => {
  const context = publicError({ status: 400, error: { message: 'maximum context length exceeded private-value' } }, 'model');
  assert.equal(context.code, 'model_context_rejected');
  assert.ok(!context.message.includes('private-value'));
  const tools = publicError({ status: 400, error: { message: 'auto tool choice requires enable-auto-tool-choice private-value' } }, 'model');
  assert.equal(tools.code, 'model_tools_unsupported');
  assert.ok(!tools.message.includes('private-value'));
});
