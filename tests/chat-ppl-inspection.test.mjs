import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/chat/config.mjs';
import { runAgent } from '../server/chat/agent.mjs';
import { inspectPplFirst, inspectionQuestion, inspectionIndices } from '../server/chat/ppl-inspection.mjs';

const index = 'cmssdt-jenkins-ibs-2968';
const config = loadConfig({ CERN_AI_MODEL: 'fixture', CERN_AI_KEY: 'fixture' });
const result = { isError: false, content: [{ type: 'text', text: JSON.stringify({ schema: [{ name: 'total_time', type: 'double' }], datarows: [['PRIVATE SAMPLE VALUE']], returnedRows: 1, retrievedAt: '2026-11-17T00:00:00Z' }) }] };

test('a series-only follow-up preserves the preceding investigation intent', () => {
  assert.match(inspectionQuestion([{ role: 'user', content: 'Compare latest full DEFAULT with CLANG builds' },
    { role: 'assistant', content: 'Which series?' }, { role: 'user', content: 'CMSSW_20_1_X' }]), /Compare latest full/);
});

test('inspection selects concrete known families without synthesizing suffixes or probing system indices', () => {
  const registry = { document: { indices: { names: ['cmssdt-jenkins-ibs-2964', index, 'cmssdt-jenkins-jobs-2968', '.tasks'] } } };
  assert.deepEqual(inspectionIndices('compare build durations', registry, null, config), ['cmssdt-jenkins-jobs-2968', index]);
  assert.deepEqual(inspectionIndices('hi', registry, null, config), []);
  assert.deepEqual(inspectionIndices('inspect cmssdt-ibs-7777', null, null, config), ['cmssdt-ibs-7777']);
});

test('PPL inspection runs before MCP discovery and supplies columns, never sampled values or fabricated mappings', async () => {
  const order = [];
  const client = { listTools: async () => { order.push('mcp'); return { tools: [{ name: 'IndexMappingTool', inputSchema: { type: 'object' } }] }; }, close: async () => {} };
  const model = { chat: { completions: { create: async request => {
    order.push('model');
    assert.match(request.messages[0].content, /total_time/);
    assert.match(request.messages[0].content, /NOT complete OpenSearch mappings/);
    assert.ok(!request.messages[0].content.includes('PRIVATE SAMPLE VALUE'));
    return (async function* () { yield { choices: [{ delta: { content: 'Observed a duration column; completion semantics still require verification.' }, finish_reason: 'stop' }] }; })();
  } } } };
  await runAgent({ config, messages: [{ role: 'user', content: `Inspect ${index}` }], client, model, emit: () => {},
    pplExecute: async (runtime, args) => { order.push('ppl'); assert.equal(runtime.pplTimeout, 4000); assert.deepEqual(args, { query: `source = ${index} | head 1`, max_rows: 1 }); return result; } });
  assert.deepEqual(order, ['ppl', 'mcp', 'model']);
});

test('PPL inspection failure falls back without leaking upstream data or aborting MCP', async () => {
  const text = await inspectPplFirst({ config, question: `Inspect ${index}`, emit: () => {}, execute: async () => { throw Error('secret upstream payload'); } });
  assert.match(text, /ppl_inspection_failed/);
  assert.ok(!text.includes('secret upstream'));
  const skipped = await inspectPplFirst({ config, question: 'unknown topic', emit: () => {}, execute: () => { throw Error('must not call'); } });
  assert.match(skipped, /no approved concrete index/);
  assert.equal(await inspectPplFirst({ config: { ...config, pplPreflight: false }, question: index }), '');
});

test('inspection respects parent cancellation instead of falling back after user cancellation', async () => {
  const controller = new AbortController();
  await assert.rejects(inspectPplFirst({ config, question: index, signal: controller.signal, emit: () => {}, execute: async () => {
    controller.abort(new DOMException('cancelled', 'AbortError')); throw controller.signal.reason;
  } }), /cancelled/);
});
