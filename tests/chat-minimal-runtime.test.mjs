import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../server/chat/agent.mjs';
import { loadConfig } from '../server/chat/config.mjs';
import { createChatServer } from '../server/chat/index.mjs';
import { trimToolHistory } from '../server/chat/tool-runtime.mjs';

test('plain tool loop passes eight iterations without context injection and stops only on cancellation', async () => {
  const controller = new AbortController();
  let turns = 0, calls = 0, closed = false;
  const client = { listTools: async () => ({ tools: [{ name: 'SearchIndexTool', inputSchema: { type: 'object' } }] }),
    callTool: async () => { calls++; return { content: [{ type: 'text', text: 'x'.repeat(25000) }] }; },
    close: async () => { closed = true; } };
  const model = { chat: { completions: { create: async request => (async function* () {
    assert.ok(JSON.stringify(request.messages).length < 70000);
    assert.equal(request.messages[0].content.length < 300, true);
    assert.ok(!/schema registry|VERIFIED|OPERATIONAL SNAPSHOT|INSPECTION|domain conventions|final response/.test(request.messages[0].content));
    assert.equal(request.tool_choice, 'auto');
    if (++turns === 13) { controller.abort(new DOMException('user stopped', 'AbortError')); controller.signal.throwIfAborted(); }
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${turns}`, function: { name: 'SearchIndexTool', arguments: JSON.stringify({ sequence: turns }) } }] }, finish_reason: 'tool_calls' }] };
  })() } } };
  await assert.rejects(runAgent({ config: { model: 'fixture', maxSteps: 1 }, messages: [{ role: 'user', content: 'Investigate' }],
    signal: controller.signal, client, model, emit: () => {},
    registry: { recordTools() { throw Error('registry must not be used'); } },
    pplExecute() { throw Error('preflight must not run'); } }), /cancel|user stopped/i);
  assert.equal(calls, 12);
  assert.equal(closed, true);
});

test('rolling history evicts complete tool turns and preserves the actual user question', () => {
  const context = [{ role: 'system', content: 'safety' }, { role: 'user', content: 'my question' }];
  for (let i = 0; i < 8; i++) context.push({ role: 'assistant', tool_calls: [{ id: `c${i}` }] }, { role: 'tool', tool_call_id: `c${i}`, content: 'x'.repeat(1000) });
  trimToolHistory(context, 3000);
  assert.equal(context[1].content, 'my question');
  for (const message of context.filter(message => message.role === 'tool')) assert.ok(context.some(call => call.tool_calls?.some(c => c.id === message.tool_call_id)));
  assert.ok(JSON.stringify(context).length < 3000);
});

test('chat HTTP streaming has no overall request/socket deadline and tool defaults are increased', () => {
  const config = loadConfig();
  assert.equal(config.mcpTimeout, 120000);
  assert.equal(config.pplTimeout, 120000);
  assert.equal(config.maxSteps, undefined);
  const server = createChatServer(config);
  assert.equal(server.requestTimeout, 0);
  assert.equal(server.timeout, 0);
});

test('token-limited text generation continues streaming instead of ending the investigation', async () => {
  let turns = 0; const events = [];
  const client = { listTools: async () => ({ tools: [{ name: 'ListIndexTool', inputSchema: { type: 'object' } }] }), close: async () => {} };
  const model = { chat: { completions: { create: async () => (async function* () {
    yield { choices: [{ delta: { content: ++turns === 1 ? 'First part' : 'Second part' }, finish_reason: turns === 1 ? 'length' : 'stop' }] };
  })() } } };
  await runAgent({ config: { model: 'fixture' }, messages: [{ role: 'user', content: 'Explain' }], client, model, emit: event => events.push(event) });
  assert.equal(turns, 2);
  assert.equal(events.at(-1).type, 'done');
  assert.match(events.filter(event => event.type === 'text').map(event => event.text).join(''), /First part\s+Second part/);
});
