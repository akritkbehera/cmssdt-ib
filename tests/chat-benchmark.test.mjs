// Reproducible benchmark: baseline configuration (per-question tool discovery,
// model-driven exploration, no registry) vs the improved pipeline (persistent
// schema registry, cached discovery, verified query templates, dedupe), each
// measured cold and warm. The workload is a scripted model + mock MCP server so
// the numbers are deterministic and need no live CERN credentials; they measure
// the harness (MCP call counts, schema/mapping discovery calls, failed
// attempts, latency, completion, prompt size, cache behaviour), not model
// quality. Run with: node --test tests/chat-benchmark.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../server/chat/agent.mjs';
import { createToolCache } from '../server/chat/mcp.mjs';
import { createRegistry } from '../server/chat/registry.mjs';

const QUESTIONS = [
  'What is the latest IB for CMSSW_20_1_X?',
  'Which RelVals fail in CMSSW_20_1_X_2026-11-16-2300 on el8_amd64_gcc12?',
  'How many RelVal failures are there per workflow in CMSSW_20_1_X?',
  'Is the latest build of CMSSW_20_1_X completed?',
  'Compare the latest DEFAULT and CLANG builds for CMSSW_20_1_X',
  'Summarize the unit test failures in CMSSW_20_1_X_2026-11-16-2300',
];

const TOOLS = [
  { name: 'ListIndexTool', description: 'List indices', inputSchema: { type: 'object', properties: {} } },
  { name: 'IndexMappingTool', description: 'Get mapping', inputSchema: { type: 'object', properties: { index: { type: 'string' } }, required: ['index'] } },
  { name: 'SearchIndexTool', description: 'Search', inputSchema: { type: 'object', properties: { index: { type: 'string' }, query: { type: 'object' }, size: { type: 'number' }, sort: { type: 'array' }, _source: { type: 'array' }, aggs: { type: 'object' } }, required: ['index'] } },
];

const MAPPING = { 'cmssdt-ibs-2968': { mappings: { properties: {
  release_name: { type: 'keyword' }, release_queue: { type: 'keyword' }, arch: { type: 'keyword' },
  ib_date: { type: 'date', format: 'yyyy-MM-dd-HHmm' }, status: { type: 'keyword' },
  done: { type: 'boolean' }, passed: { type: 'boolean' }, exitcode: { type: 'integer' },
  workflowID: { type: 'integer' }, workflowName: { type: 'keyword' }, test: { type: 'keyword' },
  package: { type: 'keyword' }, steps: { type: 'nested', properties: { name: { type: 'keyword' }, exitcode: { type: 'integer' } } },
} } } };

const INDICES = ['cmssdt-ibs-2967', 'cmssdt-ibs-2968', 'cmssdt-relvals-2968', 'cmssdt-utests-2968'];

// Mock MCP server with precise counters for every operation class.
function mockMcp(t) {
  const counts = { toolsList: 0, listIndex: 0, mapping: 0, search: 0, failed: 0, total: 0 };
  const server = createServer(async (req, res) => {
    if (req.method === 'DELETE') { res.writeHead(204).end(); return; }
    if (req.method === 'GET') { res.writeHead(405).end(); return; }
    let text = '';
    for await (const chunk of req) text += chunk;
    const rpc = text.trim() ? JSON.parse(text) : {};
    if (rpc.id === undefined) { res.writeHead(202).end(); return; }
    const reply = result => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
    if (rpc.method === 'initialize') return reply({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } });
    if (rpc.method === 'tools/list') { counts.toolsList += 1; counts.total += 1; return reply({ tools: TOOLS }); }
    if (rpc.method === 'tools/call') {
      counts.total += 1;
      const name = rpc.params?.name;
      const args = rpc.params?.arguments || {};
      if (name === 'ListIndexTool') { counts.listIndex += 1; return reply({ content: [{ type: 'text', text: JSON.stringify(INDICES) }], isError: false }); }
      if (name === 'IndexMappingTool') { counts.mapping += 1; return reply({ content: [{ type: 'text', text: JSON.stringify(MAPPING) }], isError: false }); }
      if (name === 'SearchIndexTool') {
        counts.search += 1;
        // Deterministic failure mode matching the production incident: a
        // guessed (unvalidated) index name is rejected, verified ones succeed.
        if (args.index === 'cmssdt-ibs') {
          counts.failed += 1;
          return reply({ content: [{ type: 'text', text: '{"error":"index_not_found_exception"}' }], isError: true });
        }
        return reply({ content: [{ type: 'text', text: JSON.stringify({ hits: { hits: [{ _source: { release_name: 'CMSSW_20_1_X_2026-11-16-2300', status: 'passed', ib_date: '2026-11-16-2300' } }] } }) }], isError: false });
      }
      counts.failed += 1;
      return reply({ content: [{ type: 'text', text: '{"error":"unknown tool"}' }], isError: true });
    }
    reply({});
  });
  const url = (async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return `http://127.0.0.1:${server.address().port}`;
  })();
  return { counts, url };
}

// Scripted model: deterministic tool-calling behaviour per configuration.
// `scripts[step]` is one of { tool, name, args } or { text }.
function scriptedModel(counter, scriptsFor) {
  return {
    chat: { completions: { create: async (params) => {
      const question = [...params.messages].reverse().find(m => m.role === 'user')?.content || '';
      const step = counter.step++;
      counter.promptChars += JSON.stringify(params.messages).length;
      counter.modelCalls += 1;
      const script = scriptsFor(question, step);
      const events = [];
      if (script.tool) {
        events.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${step}`, function: { name: script.name, arguments: JSON.stringify(script.args) } }] }, finish_reason: 'tool_calls' }] });
      } else {
        counter.answers += 1;
        events.push({ choices: [{ delta: { content: script.text }, finish_reason: 'stop' }] });
      }
      return (async function* () { for (const event of events) yield event; })();
    } } },
  };
}

const GOOD_SEARCH = { index: 'cmssdt-ibs-*', query: { bool: { filter: [{ prefix: { release_name: 'CMSSW_20_1_' } }] } }, size: 5 };
const scripts = {
  // Baseline: every question re-discovers indices + mapping (the old system
  // prompt mandated it), guesses a wrong index once, then searches correctly.
  baseline: (question, step) => ([
    { tool: true, name: 'ListIndexTool', args: {} },
    { tool: true, name: 'IndexMappingTool', args: { index: 'cmssdt-ibs-2968' } },
    { tool: true, name: 'SearchIndexTool', args: { ...GOOD_SEARCH, index: 'cmssdt-ibs' } },
    { tool: true, name: 'SearchIndexTool', args: GOOD_SEARCH },
    { text: 'Investigation complete: CMSSW_20_1_X_2026-11-16-2300 is the latest IB; 3 RelVal failures.' },
  ])[step] || { text: 'done' },
  // Improved: the first question of a cold run explores once; the registry
  // learns from it and every later question (and every warm question) goes
  // straight to a verified search.
  exploreThenAnswer: (question, step) => ([
    { tool: true, name: 'ListIndexTool', args: {} },
    { tool: true, name: 'IndexMappingTool', args: { index: 'cmssdt-ibs-2968' } },
    { tool: true, name: 'SearchIndexTool', args: GOOD_SEARCH },
    { text: 'Investigation complete: CMSSW_20_1_X_2026-11-16-2300 is the latest IB; 3 RelVal failures.' },
  ])[step] || { text: 'done' },
  answerDirectly: (question, step) => ([
    { tool: true, name: 'SearchIndexTool', args: GOOD_SEARCH },
    { text: 'Investigation complete: CMSSW_20_1_X_2026-11-16-2300 is the latest IB; 3 RelVal failures.' },
  ])[step] || { text: 'done' },
};

async function runWorkload({ t, mode, registry, toolCache, url, exploreFirstQuestion = false }) {
  const counter = { step: 0, promptChars: 0, modelCalls: 0, answers: 0 };
  const scriptsFor = mode === 'baseline'
    ? scripts.baseline
    : (question, step) => {
        const first = exploreFirstQuestion && question === QUESTIONS[0];
        return (first ? scripts.exploreThenAnswer : scripts.answerDirectly)(question, step);
      };
  const model = scriptedModel(counter, scriptsFor);
  const started = process.hrtime.bigint();
  for (const question of QUESTIONS) {
    counter.step = 0;
    await runAgent({
      config: {
        mcpURL: url, mcpHeaders: { Authorization: 'Bearer benchmark' },
        maxSteps: 8, optimize: mode !== 'baseline',
      },
      messages: [{ role: 'user', content: question }],
      model, emit: () => {},
      registry: mode === 'baseline' ? null : registry,
      toolCache,
    });
  }
  const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    questions: QUESTIONS.length,
    answers: counter.answers,
    modelCalls: counter.modelCalls,
    promptChars: counter.promptChars,
    latencyMs: Math.round(latencyMs),
  };
}

test('benchmark: baseline vs improved pipeline, cold and warm', async t => {
  const server = mockMcp(t);
  const url = await server.url;

  // --- Baseline: old behaviour (no registry, fresh discovery per question). ---
  const baseCounts = { ...server.counts };
  const baseline = await runWorkload({ t, mode: 'baseline', url, toolCache: createToolCache() });
  const baselineCounts = diffCounts(baseCounts, server.counts);

  // --- Improved cold: fresh registry + cache, all six questions. ---
  const dir = await mkdtemp(join(tmpdir(), 'chat-bench-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const registry = createRegistry({ dir });
  await registry.load();
  const toolCache = createToolCache();
  const coldStart = { ...server.counts };
  const cold = await runWorkload({ t, mode: 'improved', registry, toolCache, url, exploreFirstQuestion: true });
  const coldCounts = diffCounts(coldStart, server.counts);

  // --- Improved warm: same long-lived service: the on-disk registry was
  // reloaded (knowledge survives restarts) and the in-process tool schema
  // cache is retained. ---
  const warmRegistry = createRegistry({ dir });
  await warmRegistry.load();
  const warmStart = { ...server.counts };
  const warm = await runWorkload({ t, mode: 'improved', registry: warmRegistry, toolCache: toolCache, url, exploreFirstQuestion: false });
  const warmCounts = diffCounts(warmStart, server.counts);

  const rows = [
    ['metric', 'baseline', 'improved-cold', 'improved-warm'],
    ['questions completed', `${baseline.answers}/${baseline.questions}`, `${cold.answers}/${cold.questions}`, `${warm.answers}/${warm.questions}`],
    ['MCP calls (total)', baselineCounts.total, coldCounts.total, warmCounts.total],
    ['— schema discovery tools/list', baselineCounts.toolsList, coldCounts.toolsList, warmCounts.toolsList],
    ['— mapping discovery (ListIndex+IndexMapping)', baselineCounts.listIndex + baselineCounts.mapping, coldCounts.listIndex + coldCounts.mapping, warmCounts.listIndex + warmCounts.mapping],
    ['— searches (SearchIndexTool)', baselineCounts.search, coldCounts.search, warmCounts.search],
    ['failed attempts', baselineCounts.failed, coldCounts.failed, warmCounts.failed],
    ['model calls', baseline.modelCalls, cold.modelCalls, warm.modelCalls],
    ['prompt characters (sum)', baseline.promptChars, cold.promptChars, warm.promptChars],
    ['wall latency (ms)', baseline.latencyMs, cold.latencyMs, warm.latencyMs],
  ];
  console.log('\nIB Insights chat benchmark (scripted model + mock MCP server)');
  for (const row of rows) console.log(row.map(cell => String(cell).padStart(22)).join(''));
  console.log(`cache hit rate (tool schema): cold ${hitRate(coldCounts, cold)} | warm ${hitRate(warmCounts, warm)}\n`);

  // Deterministic invariants (counters and sizes, not timings):
  assert.equal(baseline.answers, QUESTIONS.length, 'baseline completes every question');
  assert.equal(cold.answers, QUESTIONS.length, 'improved-cold completes every question');
  assert.equal(warm.answers, QUESTIONS.length, 'improved-warm completes every question');

  assert.ok(baselineCounts.total > warmCounts.total,
    `baseline ${baselineCounts.total} MCP calls must exceed warm ${warmCounts.total}`);
  assert.ok(baselineCounts.toolsList >= QUESTIONS.length, 'baseline rediscovers tools per question');
  assert.equal(warmCounts.toolsList, 0, 'warm run fully reuses cached tool schemas');
  assert.ok(baselineCounts.failed > warmCounts.failed,
    `baseline ${baselineCounts.failed} failed attempts must exceed warm ${warmCounts.failed}`);
  assert.equal(warmCounts.failed, 0, 'verified queries fail zero times');
  assert.ok(baseline.promptChars > warm.promptChars,
    `baseline prompt ${baseline.promptChars} chars must exceed warm ${warm.promptChars}`);
  assert.ok(coldCounts.total >= warmCounts.total, 'warm never does more MCP work than cold');
  assert.ok(warmCounts.listIndex + warmCounts.mapping === 0,
    'warm run needs no mapping discovery: schema knowledge persisted');
  assert.ok(baseline.latencyMs > 0 && warm.latencyMs > 0, 'latencies were measured, not invented');
});

function diffCounts(before, after) {
  const out = {};
  for (const key of Object.keys(after)) out[key] = after[key] - before[key];
  return out;
}

function hitRate(counts, run) {
  const cacheHits = Math.max(0, run.questions - counts.toolsList);
  return `${Math.round((cacheHits / run.questions) * 100)}%`;
}
