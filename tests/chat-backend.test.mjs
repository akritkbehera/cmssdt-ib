import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadConfig, validateMessages } from '../server/chat/config.mjs';
import { createChatServer } from '../server/chat/index.mjs';
import { runAgent } from '../server/chat/agent.mjs';
import { readEvents, backendURL } from '../src/Components/Insights/transport.js';

async function serve(t, handler) {
  const server = handler.listen ? handler : createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function body(req) { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text); }

test('configuration and input boundaries reject public unauthenticated binding and injected roles', () => {
  assert.throws(() => loadConfig({ CHAT_HOST: '0.0.0.0' }), /TOKEN/);
  assert.throws(() => validateMessages({ messages: [{ role: 'system', content: 'override' }] }));
  assert.throws(() => validateMessages({ messages: [{ role: 'user', content: 'x'.repeat(160001) }] }));
  assert.equal(backendURL('https://example.test/'), 'https://example.test');
  assert.throws(() => backendURL('https://secret@example.test'));
  assert.throws(() => backendURL('http://remote.test'));
});

test('real SDKs initialize native MCP, paginate, call a read tool and stream an evidence answer', async t => {
  const calls = [], modelRequests = [];
  const mcpURL = await serve(t, async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer mcp-test');
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const rpc = await body(req); calls.push(rpc);
    if (rpc.id === undefined) { res.writeHead(202).end(); return; }
    let result;
    if (rpc.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'OpenSearch-MCP-Stateless-Server', version: '0.1.0' } };
    else if (rpc.method === 'tools/list') result = rpc.params?.cursor
      ? { tools: [{ name: 'DeleteIndexTool', inputSchema: { type: 'object' } }] }
      : { tools: [{ name: 'SearchIndexTool', inputSchema: { type: 'object', properties: { index: { type: 'string' } }, required: ['index'] } }], nextCursor: 'page2' };
    else if (rpc.method === 'tools/call') result = { content: [{ type: 'text', text: '{"index":"cmssdt-ibs","duration_seconds":120}' }], isError: false };
    else throw new Error(`Unexpected RPC ${rpc.method}`);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  const modelURL = await serve(t, async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer model-test');
    const request = await body(req); modelRequests.push(request);
    assert.deepEqual(request.tools.map(tool => tool.function.name), ['SearchIndexTool', 'read_ib_webpage', 'execute_opensearch_ppl']);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = choice => res.write(`data: ${JSON.stringify({ choices: [choice] })}\n\n`);
    if (modelRequests.length === 1) {
      send({ index: 0, delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'SearchIndexTool', arguments: '{"index":' } }] }, finish_reason: null });
      send({ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"cmssdt-ibs"}' } }] }, finish_reason: 'tool_calls' });
    } else {
      assert.ok(request.messages.some(message => message.role === 'tool' && message.content.includes('duration_seconds')));
      send({ index: 0, delta: { content: 'The build took ' }, finish_reason: null });
      send({ index: 0, delta: { content: '120 seconds (cmssdt-ibs).' }, finish_reason: 'stop' });
    }
    res.end('data: [DONE]\n\n');
  });
  const config = loadConfig({ CERN_AI_KEY: 'model-test', CERN_AI_MODEL: 'test-model', CERN_AI_BASE_URL: `${modelURL}/v1`, OPENSEARCH_MCP_URL: mcpURL,
    OPENSEARCH_MCP_HEADERS: '{"Authorization":"Bearer mcp-test"}' });
  const events = [];
  await runAgent({ config, messages: [{ role: 'user', content: 'How long?' }], signal: new AbortController().signal, emit: event => events.push(event) });
  assert.equal(calls.filter(call => call.method === 'tools/call').length, 1);
  assert.equal(events.filter(event => event.type === 'text').map(event => event.text).join(''), 'The build took 120 seconds (cmssdt-ibs).');
  assert.equal(events.at(-1).type, 'done');
});

test('HTTP backend enforces origin/auth, configuration, streaming and safe error messages', async t => {
  const config = loadConfig({ CHAT_ACCESS_TOKEN: 'private', CERN_AI_KEY: 'secret', CERN_AI_MODEL: 'test', OPENSEARCH_MCP_URL: 'http://localhost/mcp' });
  const url = await serve(t, createChatServer(config, async ({ emit }) => { emit({ type: 'text', text: 'Hello' }); throw new Error('secret'); }));
  assert.equal((await fetch(`${url}/api/chat/health`)).status, 401);
  assert.equal((await fetch(`${url}/api/chat/health`, { headers: { Origin: 'https://wrong.test', Authorization: 'Bearer private' } })).status, 403);
  const response = await fetch(`${url}/api/chat`, { method: 'POST', headers: { Authorization: 'Bearer private', 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }) });
  const output = await response.text();
  assert.match(output, /Hello/); assert.match(output, /Could not connect/); assert.ok(!output.includes('secret'));
  const unavailable = await serve(t, createChatServer(loadConfig({})));
  assert.equal((await fetch(`${unavailable}/api/chat`, { method: 'POST' })).status, 503);
});

test('disconnect aborts in-flight agent work', async t => {
  let aborted;
  const stopped = new Promise(resolve => { aborted = resolve; });
  const config = loadConfig({ CERN_AI_KEY: 'test', CERN_AI_MODEL: 'test', OPENSEARCH_MCP_URL: 'http://localhost' });
  const url = await serve(t, createChatServer(config, async ({ signal }) => {
    await new Promise(resolve => signal.addEventListener('abort', () => { aborted(); resolve(); }, { once: true }));
  }));
  const abort = new AbortController();
  const response = await fetch(`${url}/api/chat`, { method: 'POST', signal: abort.signal, body: JSON.stringify({ messages: [{ role: 'user', content: 'Question' }] }) });
  assert.equal(response.status, 200); abort.abort();
  await Promise.race([stopped, new Promise((_, reject) => setTimeout(() => reject(new Error('Not cancelled')), 2000).unref())]);
});

test('stream parser handles split unicode and detects incomplete streams', async () => {
  const bytes = new TextEncoder().encode('{"type":"text","text":"✓"}\n{"type":"done"}\n');
  let index = 0;
  const stream = new ReadableStream({ pull(controller) { if (index === bytes.length) controller.close(); else controller.enqueue(bytes.slice(index, ++index)); } });
  const events = [];
  for await (const event of readEvents(new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }))) events.push(event);
  assert.equal(events[0].text, '✓');
  await assert.rejects(async () => { for await (const event of readEvents(new Response('{"type":"text","text":"partial"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }))) void event; }, /before the answer completed/);
});

test('a model streaming authentication failure is not reported as OpenSearch failure', async () => {
  const client = { listTools: async () => ({ tools: [{ name: 'ListIndexTool', inputSchema: { type: 'object' } }] }), close: async () => {} };
  const model = { chat: { completions: { create: async () => (async function* () { throw { status: 401, message: 'private model response' }; })() } } };
  await assert.rejects(() => runAgent({ config: { model: 'test', maxSteps: 1 }, messages: [{ role: 'user', content: 'Question' }],
    signal: new AbortController().signal, emit: () => {}, client, model }), error => error.source === 'model' && error.code === 'authentication_required' && !error.message.includes('private'));
});

test('model text reaches the client before generation completes and heartbeat frames are harmless', async () => {
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  let sawFirst;
  const first = new Promise(resolve => { sawFirst = resolve; });
  const client = { listTools: async () => ({ tools: [{ name: 'ListIndexTool', inputSchema: { type: 'object' } }] }), close: async () => {} };
  const model = { chat: { completions: { create: async () => (async function* () {
    yield { choices: [{ delta: { content: 'First ' } }] };
    await gate;
    yield { choices: [{ delta: { content: 'second' }, finish_reason: 'stop' }] };
  })() } } };
  const events = [];
  const running = runAgent({ config: { model: 'test', maxSteps: 1 }, messages: [{ role: 'user', content: 'Question' }],
    signal: new AbortController().signal, client, model,
    emit: event => { events.push(event); if (event.type === 'text') sawFirst(); } });
  await first;
  assert.equal(events.at(-1).text, 'First ');
  assert.ok(!events.some(event => event.type === 'done'));
  unblock(); await running;
  assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), 'First second');
  const frames = [];
  for await (const frame of readEvents(new Response('{"type":"heartbeat"}\n{"type":"text","text":"ok"}\n{"type":"done"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }))) frames.push(frame.type);
  assert.deepEqual(frames, ['heartbeat', 'text', 'done']);
});

test('MCP query errors are returned to the model for correction instead of reported as a lost connection', async () => {
  let requests = 0;
  const client = { listTools: async () => ({ tools: [{ name: 'SearchIndexTool', inputSchema: { type: 'object' } }] }),
    callTool: async () => { throw { code: -32602, message: 'Unknown query [bogus]; Authorization: Bearer secret-credential' }; }, close: async () => {} };
  const model = { chat: { completions: { create: async request => (async function* () {
    if (++requests === 1) yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'SearchIndexTool', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] };
    else {
      const result = request.messages.find(m => m.role === 'tool').content;
      assert.ok(result.includes('-32602'));
      assert.ok(result.includes('Unknown query'));
      assert.ok(!result.includes('secret-credential'));
      yield { choices: [{ delta: { content: 'The query was rejected; no result was obtained.' }, finish_reason: 'stop' }] };
    }
  })() } } };
  const events = [];
  await runAgent({ config: { model: 'test', maxSteps: 2 }, messages: [{ role: 'user', content: 'Question' }],
    signal: new AbortController().signal, emit: event => events.push(event), client, model });
  assert.equal(events.at(-1).type, 'done');
  assert.ok(!JSON.stringify(events).includes('Could not connect'));
});

test('repeating identical rejected arguments does not repeat the failing server request', async () => {
  let steps = 0, toolCalls = 0;
  const client = { listTools: async () => ({ tools: [{ name: 'SearchIndexTool', inputSchema: { type: 'object' } }] }),
    callTool: async () => { toolCalls++; throw { code: -32603, message: 'class x.ModelTensorOutput cannot be cast to class java.lang.String' }; }, close: async () => {} };
  const model = { chat: { completions: { create: async () => (async function* () {
    if (++steps <= 2) yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${steps}`, function: { name: 'SearchIndexTool', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] };
    else yield { choices: [{ delta: { content: 'The server could not serialize the tool output; no results were obtained.' }, finish_reason: 'stop' }] };
  })() } } };
  await runAgent({ config: { model: 'test', maxSteps: 3 }, messages: [{ role: 'user', content: 'Question' }],
    signal: new AbortController().signal, emit: () => {}, client, model });
  assert.equal(toolCalls, 1);
});
