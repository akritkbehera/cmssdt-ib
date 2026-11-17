import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeResult } from '../server/chat/diagnose-search.mjs';
import { runAgent } from '../server/chat/agent.mjs';

test('diagnostics distinguish missing aggregation output from an actual empty result', () => {
  assert.equal(summarizeResult({ content: [{ type: 'text', text: '' }] }).empty, true);
  assert.equal(summarizeResult({ content: [{ type: 'text', text: '[]' }] }).documentsReturned, 0);
  assert.equal(summarizeResult({ content: [{ type: 'text', text: '[]' }] }).aggregationsPresent, false);
  assert.equal(summarizeResult({ content: [{ type: 'text', text: '{"aggregations":{"by_architecture":{"buckets":[]}}}' }] }).aggregationsPresent, true);
});

test('tool execution returns evidence to the same model without a forced final-step instruction', async () => {
  let modelCalls = 0;
  const client = { listTools: async () => ({ tools: [{ name: 'SearchIndexTool', inputSchema: { type: 'object' } }] }),
    callTool: async () => ({ content: [{ type: 'text', text: '{"evidence":"one bounded result"}' }] }), close: async () => {} };
  const model = { chat: { completions: { create: async request => (async function* () {
    if (++modelCalls === 1) {
      assert.equal(request.tool_choice, 'auto');
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'SearchIndexTool', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] };
    } else {
      assert.equal(request.tool_choice, 'auto');
      assert.ok(request.tools.length);
      assert.equal(request.messages.filter(message => message.role === 'system').length, 1);
      assert.ok(!request.messages[0].content.includes('final response for this investigation'));
      assert.ok(request.messages.some(message => message.role === 'tool' && message.content.includes('one bounded result')));
      yield { choices: [{ delta: { content: 'One result was retrieved. Completion of the comparison is not verified.' }, finish_reason: 'stop' }] };
    }
  })() } } };
  const events = [];
  await runAgent({ config: { model: 'fixture', maxSteps: 2 }, messages: [{ role: 'user', content: 'Compare builds' }],
    signal: new AbortController().signal, emit: event => events.push(event), client, model });
  assert.equal(events.at(-1).type, 'done');
  assert.ok(events.some(event => event.type === 'text' && event.text.includes('not verified')));
});

test('a standalone greeting never connects to MCP or the model, even after an investigation', async () => {
  const events = [];
  await runAgent({ config: {}, messages: [{ role: 'user', content: 'Compare DEFAULT with CLANG' },
    { role: 'assistant', content: 'Previous investigation failed.' }, { role: 'user', content: 'hi' }],
    emit: event => events.push(event), client: { listTools() { throw Error('must not discover tools'); } },
    model: { chat: { completions: { create() { throw Error('must not call model'); } } } } });
  assert.equal(events.at(-1).type, 'done');
  assert.match(events[0].text, /^Hi!/);
});
