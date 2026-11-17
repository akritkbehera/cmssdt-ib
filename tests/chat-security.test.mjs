// Security review tests for the IB Insights chat backend:
// multi-user isolation, conversation isolation, credential/result non-leakage,
// diagnostics sanitization, read-only enforcement surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../server/chat/agent.mjs';
import { openMcp, createMcpSession, createToolCache, wrapMcpClient, discoverTools } from '../server/chat/mcp.mjs';
import { classifyError, publicError } from '../server/chat/errors.mjs';
import { createDiagnostics, sanitizeSecrets } from '../server/chat/diagnostics.mjs';
import { createRegistry } from '../server/chat/registry.mjs';

// Minimal mock MCP server that records every Authorization header it sees.
function mockMcp(t, tools = [{ name: 'SearchIndexTool', description: 'search', inputSchema: { type: 'object', properties: { index: { type: 'string' }, query: { type: 'object' } }, required: ['index'] } }]) {
  const state = { authHeaders: [], calls: 0, listCalls: 0, session: null, sessions: 0 };
  const server = createServer(async (req, res) => {
    if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
    if (req.method === 'GET') { res.writeHead(405).end(); return; }
    let text = '';
    for await (const chunk of req) text += chunk;
    const rpc = text.trim() ? JSON.parse(text) : {};
    if (rpc.id === undefined) { res.writeHead(202).end(); return; }
    state.authHeaders.push(req.headers.authorization || null);
    const reply = result => res.writeHead(200, { 'Content-Type': 'application/json', ...(state.session ? { 'mcp-session-id': state.session } : {}) })
      .end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
    if (rpc.method === 'initialize') {
      state.session = `session-${state.sessions += 1}`;
      return reply({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } });
    }
    if (rpc.method === 'tools/list') { state.listCalls += 1; return reply({ tools }); }
    if (rpc.method === 'tools/call') {
      state.calls += 1;
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

const configFor = (url, token) => ({ mcpURL: url, mcpHeaders: { Authorization: `Bearer ${token}` }, maxSteps: 4 });

test('multi-user sessions never send another user\'s credentials', async t => {
  const serverA = mockMcp(t);
  const serverB = mockMcp(t);
  const [urlA, urlB] = [await serverA.url, await serverB.url];

  const sessionA = await createMcpSession({ config: configFor(urlA, 'user-A-token'), signal: AbortSignal.timeout(5000) }).init();
  const sessionB = await createMcpSession({ config: configFor(urlB, 'user-B-token'), signal: AbortSignal.timeout(5000) }).init();
  await sessionA.callTool('SearchIndexTool', { index: 'a' });
  await sessionB.callTool('SearchIndexTool', { index: 'b' });
  await sessionA.close();
  await sessionB.close();

  assert.ok(serverA.state.authHeaders.length > 0);
  assert.ok(serverB.state.authHeaders.length > 0);
  assert.ok(serverA.state.authHeaders.every(h => h === 'Bearer user-A-token'), 'server A only ever sees user A\'s token');
  assert.ok(serverB.state.authHeaders.every(h => h === 'Bearer user-B-token'), 'server B only ever sees user B\'s token');
  assert.ok(!serverA.state.authHeaders.includes('Bearer user-B-token'));
  assert.ok(!serverB.state.authHeaders.includes('Bearer user-A-token'));
});

test('tool schema caches are per-session: no cross-user tool state', async t => {
  const server = mockMcp(t);
  const url = await server.url;
  const sessionA = await createMcpSession({ config: configFor(url, 'a-token'), signal: AbortSignal.timeout(5000) }).init();
  const sessionB = await createMcpSession({ config: configFor(url, 'b-token'), signal: AbortSignal.timeout(5000) }).init();

  const toolsA = await sessionA.discoverTools();
  assert.equal(toolsA.length, 1);
  // B's cache is separate: it must go to the server again, not reuse A's entry.
  await sessionB.discoverTools();
  assert.equal(server.state.listCalls, 2, 'sessions do not share tool caches');

  // Explicit caches are independent objects with independent state.
  const cacheX = createToolCache();
  const cacheY = createToolCache();
  cacheX.set('endpoint', toolsA);
  assert.equal(cacheX.fresh('endpoint'), true);
  assert.equal(cacheY.fresh('endpoint'), false, 'cache state never leaks between instances');

  await sessionA.close();
  await sessionB.close();
});

test('registry knowledge is per data dir and holds no query results or credentials', async t => {
  const dirA = await mkdtemp(join(tmpdir(), 'chat-sec-a-'));
  const dirB = await mkdtemp(join(tmpdir(), 'chat-sec-b-'));
  t.after(() => Promise.all([rm(dirA, { recursive: true, force: true }), rm(dirB, { recursive: true, force: true })]));

  const mapping = { 'cmssdt-ibs-2968': { mappings: { properties: {
    release_name: { type: 'keyword' }, arch: { type: 'keyword' }, ib_date: { type: 'date' },
    status: { type: 'keyword' }, done: { type: 'boolean' },
  } } } };
  const regA = createRegistry({ dir: dirA });
  await regA.load();
  regA.recordTools('https://os.example/mcp', [{ function: { name: 'SearchIndexTool', description: 'search', parameters: { type: 'object' } } }]);
  regA.recordIndices(['cmssdt-ibs-2968']);
  const family = regA.recordMapping({ index: 'cmssdt-ibs-2968', mapping });
  regA.touchValidation({ familyId: family.id, fingerprint: family.fingerprint });
  await regA.flush();

  const regB = createRegistry({ dir: dirB });
  await regB.load();
  assert.equal(regB.document.families.length, 0, 'one user\'s registry never appears in another\'s volume');

  const raw = await readFile(join(dirA, 'registry.json'), 'utf8');
  assert.ok(/cmssdt-ibs-2968/.test(raw), 'index names are structural metadata and may persist');
  assert.ok(!/"result"|hits|_source/i.test(raw), 'query results must never persist');
  assert.ok(!/Bearer|access_token|client_secret|password|cookie/i.test(raw), 'credentials must never persist');
});

test('runAgent conversations are isolated: no evidence crosses between questions', async () => {
  const prompts = [];
  const makeModel = (toolOutput, answer) => ({
    chat: { completions: { create: async (params) => {
      prompts.push(params.messages);
      const step = prompts.length;
      const events = step % 2 === 1
        ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${step}`, function: { name: 'SearchIndexTool', arguments: '{"index":"cmssdt-ibs-*"}' } }] }, finish_reason: 'tool_calls' }] }]
        : [{ choices: [{ delta: { content: answer }, finish_reason: 'stop' }] }];
      return (async function* () { for (const event of events) yield event; })();
    } } },
  });
  const fakeClient = output => ({
    async listTools() { return { tools: [{ name: 'SearchIndexTool', description: 'search', inputSchema: { type: 'object', properties: { index: { type: 'string' }, query: { type: 'object' } }, required: ['index'] } }] }; },
    async callTool() { return { content: [{ type: 'text', text: output }], isError: false }; },
    async close() {},
  });

  const ask = (question, output) => runAgent({
    config: { mcpURL: 'external', maxSteps: 4 },
    messages: [{ role: 'user', content: question }],
    model: makeModel(output, 'answer'),
    emit: () => {},
    client: fakeClient(output),
    registry: null,
  });

  await ask('first question of user 1', 'user-1-private-evidence');
  await ask('completely unrelated second question', 'user-2-private-evidence');

  // Every prompt the model sees for question 2 must exclude question 1's data.
  const secondRunPrompts = prompts.slice(2);
  for (const messages of secondRunPrompts) {
    const text = JSON.stringify(messages);
    assert.ok(!text.includes('user-1-private-evidence'), 'evidence never crosses conversations');
    assert.ok(!text.includes('first question of user 1'), 'other conversation content never crosses');
  }
  // Each conversation contains only its own user question and its own result.
  assert.ok(JSON.stringify(prompts[0]).includes('first question of user 1'));
  assert.ok(JSON.stringify(prompts[2]).includes('completely unrelated second question'));
});

test('public errors never contain raw credentials or payload text', () => {
  const SECRET = 'secret-token-ABCDEF-123456';
  const authErr = new Error(`401 Unauthorized: Authorization: Bearer ${SECRET}; auth_cookie=super-secret-cookie-value`);
  const info = classifyError(authErr);
  const pub = publicError(info);
  assert.equal(pub.code, 'authentication_required');
  assert.ok(!pub.message.includes(SECRET));
  assert.ok(!pub.message.includes('super-secret-cookie'));
  for (const [kind, error] of [
    ['http_transient', Object.assign(new Error('boom'), { status: 503 })],
    ['transport', Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })],
  ]) {
    const message = publicError(classifyError(error)).message;
    assert.ok(!message.includes('boom'), `${kind} public message must not echo raw error text`);
    assert.ok(message.length > 0);
  }
});

test('diagnostics redact bearer tokens, cookies, JWTs and credential URLs', () => {
  const lines = [];
  const diag = createDiagnostics({ sink: line => { lines.push(line); } });
  diag.log('mcp_operation', {
    stage: 'tools/call',
    tool: 'SearchIndexTool',
    durationMs: 12,
    error: '401 for Bearer secret-token-ABCDEF-123456 and auth_cookie=super-secret-cookie-value',
    url: 'https://user:password@opensearch.example:9200/_search?apiKey=abc123',
    detail: 'Authorization: Basic dXNlcjpwYXNz, set-cookie: sid=1; jwt eyJabcdefgh.ijklmnop.qrstuvwxyz',
  });
  const line = lines.join('');
  assert.ok(!line.includes('secret-token-ABCDEF'), 'bearer tokens must be redacted');
  assert.ok(!line.includes('super-secret-cookie'), 'cookies must be redacted');
  assert.ok(!line.includes('password@'), 'credential URLs must be redacted');
  assert.ok(!line.includes('abc123'), 'api keys must be redacted');
  assert.ok(!line.includes('dXNlcjpwYXNz'), 'authorization values must be redacted');
  assert.ok(!line.includes('eyJabcdefgh'), 'JWTs must be redacted');
  assert.ok(line.includes('[redacted]'));
  assert.ok(line.includes('tools/call'), 'sanitized operational fields survive');
});

test('MCP tool results are sanitized before they reach the model or evidence', async () => {
  const prompts = [];
  const model = {
    chat: { completions: { create: async (params) => {
      prompts.push(params.messages);
      const events = prompts.length % 2 === 1
        ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'SearchIndexTool', arguments: '{"index":"cmssdt-ibs-*"}' } }] }, finish_reason: 'tool_calls' }] }]
        : [{ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }];
      return (async function* () { for (const event of events) yield event; })();
    } } },
  };
  const client = {
    async listTools() { return { tools: [{ name: 'SearchIndexTool', description: 'search', inputSchema: { type: 'object', properties: { index: { type: 'string' }, query: { type: 'object' } }, required: ['index'] } }] }; },
    async callTool() {
      return { isError: true, content: [{ type: 'text', text: '401 Unauthorized: request used Bearer user-A-service-token and auth_cookie=sekret' }] };
    },
    async close() {},
  };
  await runAgent({
    config: { mcpURL: 'external', maxSteps: 4 },
    messages: [{ role: 'user', content: 'search something' }],
    model, emit: () => {}, client, registry: null,
  });
  // The second prompt carries the tool result; it must be scrubbed.
  const toolView = JSON.stringify(prompts[1] || []);
  assert.ok(!toolView.includes('user-A-service-token'), 'tool results are scrubbed before reaching the model');
  assert.ok(!toolView.includes('sekret'), 'cookie values are scrubbed before reaching the model');
});

test('wrapped MCP client logs sizes and outcomes, never result payloads', async () => {
  const lines = [];
  const diag = createDiagnostics({ sink: line => { lines.push(line); } });
  const fake = {
    async listTools() {
      return { tools: [{ name: 'SearchIndexTool', description: 'search', inputSchema: { type: 'object', properties: {} } }] };
    },
    async callTool() {
      return { content: [{ type: 'text', text: 'SECRET-QUERY-RESULT-CONTENT' }], structuredContent: { hit: 'SECRET-HIT' } };
    },
    async close() {},
  };
  const wrapped = wrapMcpClient(fake, { diagnostics: diag, toolCache: createToolCache() });
  await wrapped.discoverTools({ fresh: true });
  const call = await wrapped.callTool('SearchIndexTool', { index: 'x' });
  assert.equal(call.structuredContent.hit, 'SECRET-HIT', 'the caller still receives the result');

  const all = lines.join('');
  assert.ok(!all.includes('SECRET-QUERY-RESULT-CONTENT'), 'result text must not be logged');
  assert.ok(!all.includes('SECRET-HIT'), 'structured results must not be logged');
  assert.ok(!all.includes('cmssdt'), 'query bodies must not be logged');
});

test('sanitizeSecrets covers the known credential shapes', () => {
  assert.equal(sanitizeSecrets('Bearer abc.def-123'), '[redacted]');
  assert.equal(sanitizeSecrets('{"access_token":"abc"}'), '{"[redacted]"}');
  assert.equal(sanitizeSecrets('cookie: sid=1'), '[redacted]');
  assert.equal(sanitizeSecrets('plain operational text'), 'plain operational text');
});

test('discoverTools exposes only allowlisted read tools', async () => {
  const fakeClient = {
    async listTools() {
      return {
        tools: [
          { name: 'SearchIndexTool', description: 'd', inputSchema: {} },
          { name: 'UpdateIndexTool', description: 'd', inputSchema: {} },
          { name: 'DeleteIndexTool', description: 'd', inputSchema: {} },
        ],
      };
    },
    async callTool() { throw new Error('must not be called'); },
    async close() {},
  };
  const tools = await discoverTools(fakeClient, undefined);
  assert.deepEqual(tools.map(tool => tool.function.name), ['SearchIndexTool']);
});

test('read-only surface: rendered template queries never mutate', async () => {
  const { TEMPLATES, renderTemplate } = await import('../server/chat/templates.mjs');
  const registry = createRegistry({});
  registry.recordIndices(['cmssdt-ibs-2968', 'cmssdt-relvals-2968']);
  registry.recordMapping({ index: 'cmssdt-ibs-2968', mapping: { 'cmssdt-ibs-2968': { mappings: { properties: {
    release_name: { type: 'keyword' }, release_queue: { type: 'keyword' }, arch: { type: 'keyword' },
    ib_date: { type: 'date', format: 'yyyy-MM-dd-HHmm' }, status: { type: 'keyword' },
    done: { type: 'boolean' }, passed: { type: 'boolean' }, tests_archs: { type: 'keyword' },
  } } } } });
  registry.recordMapping({ index: 'cmssdt-relvals-2968', mapping: { 'cmssdt-relvals-2968': { mappings: { properties: {
    release_name: { type: 'keyword' }, arch: { type: 'keyword' }, ib_date: { type: 'date' },
    workflowID: { type: 'integer' }, workflowName: { type: 'keyword' }, exitcode: { type: 'integer' },
    status: { type: 'keyword' }, steps: { type: 'nested', properties: { name: { type: 'keyword' }, exitcode: { type: 'integer' } } },
  } } } } });
  const searchSchema = { type: 'object', properties: {
    index: { type: 'string' }, query: { type: 'object' }, size: { type: 'number' }, sort: { type: 'array' },
    _source: { type: 'array' }, aggs: { type: 'object' },
  }, required: ['index'] };
  const params = {
    series: '20_1', release: 'CMSSW_20_1_X_2026-11-16-2300', arch: 'el8_amd64_gcc12',
    workflow: '33734', flavour: 'DEFAULT',
  };
  let renderedCount = 0;
  for (const template of TEMPLATES) {
    for (const family of registry.document.families) {
      const rendered = renderTemplate(template, { family, params, searchSchema });
      if (!rendered) continue;
      renderedCount++;
      const serialized = JSON.stringify(rendered.args);
      assert.ok(!/"script"/i.test(serialized), `${template.id} must not use scripts`);
      assert.ok(!/_(?:delete|update|bulk|create)/i.test(serialized), `${template.id} must only read`);
      assert.ok(rendered.args.index, 'queries are index-scoped reads');
    }
  }
  assert.ok(renderedCount >= 3, `expected several templates to render, got ${renderedCount}`);
});
