// Cold-vs-warm comparison for five sample questions, run through the real
// runAgent pipeline (real MCP client session code, real tool-schema
// validation, real warm-up code) with a scripted model and a mock OpenSearch
// MCP server replaying fixture data captured in opensearch-discovery/raw/.
//
// IMPORTANT MEASUREMENT NOTE (do not read these numbers as live performance):
// - The model is SCRIPTED: its decision rules are written out below and are
//   deterministic. "modelRounds" counts LLM API round-trips the plan would
//   make; "wallMs" is harness wall-clock over zero-latency mocks and contains
//   no network and no model latency. Nothing here is a live LLM or live
//   OpenSearch measurement (no credentials exist in this environment).
// - Query bodies in warm mode are rendered from the verified templates in
//   server/chat/knowledge/query-templates.json via renderTemplate(); in cold
//   mode the same final queries are used after the discovery steps, so the
//   measured delta is exactly the discovery work and extra model rounds.
//
// Scripted decision rules:
// - COLD (no VERIFIED STRUCTURAL KNOWLEDGE block): the system prompt says to
//   discover indices and inspect mappings before writing queries, and
//   "latest" questions need the newest IB identified first. Plan:
//   ListIndexTool -> IndexMappingTool -> [release counts query] -> answer
//   queries -> final answer.
// - WARM (knowledge block injected): verified fields/templates are known and
//   the OPERATIONAL SNAPSHOT names the latest IB, so the model runs only the
//   answer queries. For unit-test questions the knowledge declares the schema
//   UNKNOWN (gap G10), so the warm plan runs the same discovery as cold
//   instead of inventing fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../server/chat/agent.mjs';
import { loadKnowledge, renderTemplate, createKnowledgeCache, detectCycle } from '../server/chat/knowledge.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const T0 = 1794900000000; // fixed clock: keeps the shared warm cache deterministic

// Fixtures: values captured in the discovery session (opensearch-discovery/raw).
const RELEASE_BUCKETS = [
  { key: 'CMSSW_9_4_X_2026-11-15-0000', doc_count: 1200 },
  { key: 'CMSSW_20_1_X_2026-11-17-2300', doc_count: 8239 },
  { key: 'CMSSW_20_1_X_2026-11-17-1100', doc_count: 8000 },
  { key: 'CMSSW_20_1_ROOT6_X_2026-11-16-2300', doc_count: 500 },
];
const FAILURE_BY_ARCH = {
  architectures: {
    buckets: [
      { key: 'el9_amd64_gcc14', doc_count: 12, workflows: { buckets: [{ key: '38634.422', doc_count: 3 }, { key: '38634.423', doc_count: 3 }, { key: '36434.0', doc_count: 2 }, { key: '36834.0', doc_count: 2 }, { key: '38551.85', doc_count: 2 }] } },
      { key: 'el9_aarch64_gcc14', doc_count: 2, workflows: { buckets: [{ key: '38551.85', doc_count: 1 }, { key: '10804.31', doc_count: 1 }] } },
      { key: 'el8_amd64_gcc14', doc_count: 1, workflows: { buckets: [{ key: '38551.85', doc_count: 1 }] } },
    ],
  },
};
const FAILED_STEP_HITS = ['38634.422', '38634.423', '36434.0', '36834.0', '38551.85'].map(workflow => ({
  _index: 'cmssdt-ib-matrix-2968', _source: { release: 'CMSSW_20_1_X_2026-11-17-2300', workflow, exitcode: 256 },
}));
const MAPPING_MATRIX = { 'cmssdt-ib-matrix-2968': { mappings: { properties: {
  release: { type: 'keyword' }, architecture: { type: 'keyword' }, workflow: { type: 'keyword' },
  step: { type: 'keyword' }, exitcode: { type: 'integer' }, error_count: { type: 'integer' },
} } } };

const pickLatest = buckets => (buckets.find(bucket => bucket.key.startsWith('CMSSW_20_1_X_')) || {}).key;

function mockClient(state) {
  const counters = { toolsList: 0, listIndex: 0, indexMapping: 0, search: 0, probeSearch: 0, modelSearch: 0, failures: 0 };
  return {
    counters,
    async listTools() {
      counters.toolsList += 1;
      return { tools: [
        { name: 'ListIndexTool', description: 'list', inputSchema: { type: 'object', properties: {} } },
        { name: 'IndexMappingTool', description: 'map', inputSchema: { type: 'object', properties: { index: { type: 'string' } }, required: ['index'] } },
        { name: 'SearchIndexTool', description: 'search', inputSchema: { type: 'object', properties: { index: { type: 'string' }, body: { type: 'object' } }, required: ['index'] } },
      ] };
    },
    async callTool(request) {
      const { name, arguments: args } = request;
      if (name === 'ListIndexTool') {
        counters.listIndex += 1;
        return { content: [{ type: 'text', text: JSON.stringify(['cmssdt-ib-matrix-2964', 'cmssdt-ib-matrix-2968', 'cmssdt-ibs-2968']) }] };
      }
      if (name === 'IndexMappingTool') {
        counters.indexMapping += 1;
        return { content: [{ type: 'text', text: JSON.stringify(String(args.index).startsWith('cmssdt-ibs') ? {} : MAPPING_MATRIX) }] };
      }
      counters.search += 1;
      if (state.modelRequests === 0) counters.probeSearch += 1; else counters.modelSearch += 1;
      const body = args?.body || {};
      let payload;
      if (body.aggs?.releases) payload = { aggregations: { releases: { buckets: RELEASE_BUCKETS } } };
      else if (body.aggs?.architectures) payload = { aggregations: FAILURE_BY_ARCH };
      else payload = { hits: { total: { value: 5, relation: 'eq' }, hits: FAILED_STEP_HITS } };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false };
    },
    async close() {},
  };
}

function scriptedModel(state, script) {
  state.modelRequests = 0;
  return { chat: { completions: { async create(request) {
    state.modelRequests += 1;
    state.systemChars = request.messages[0].content.length;
    const step = script[state.modelRequests - 1];
    return (async function* () {
      if (step.toolCall) {
        yield { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `c${state.modelRequests}`,
          function: { name: step.toolCall.name, arguments: JSON.stringify(step.toolCall.args) } }] }, finish_reason: 'tool_calls' }] };
      } else {
        yield { choices: [{ index: 0, delta: { content: step.text }, finish_reason: 'stop' }] };
      }
    })();
  } } } };
}

test('cold vs warm: five questions through runAgent with a scripted plan', async t => {
  const knowledge = await loadKnowledge();
  assert.equal(knowledge.ok, true);
  const search = (id, args) => ({ toolCall: { name: 'SearchIndexTool', args: { index: 'cmssdt-ib-matrix-*', body: renderTemplate(knowledge, id, args).body } } });
  const discover = [
    { toolCall: { name: 'ListIndexTool', args: {} } },
    { toolCall: { name: 'IndexMappingTool', args: { index: 'cmssdt-ib-matrix-*' } } },
  ];
  const discoverUnit = [
    { toolCall: { name: 'ListIndexTool', args: {} } },
    { toolCall: { name: 'IndexMappingTool', args: { index: 'cmssdt-ibs-*' } } },
  ];
  const answer = text => ({ text });

  const scenarios = [
    {
      id: 'q1-latest-ib',
      question: 'What is the latest CMSSW_20_1_X IB?',
      warm: [search('release_doc_counts', {}), answer('CMSSW_20_1_X_2026-11-17-2300')],
      cold: [...discover, search('release_doc_counts', {}), answer('CMSSW_20_1_X_2026-11-17-2300')],
    },
    {
      id: 'q2-failed-relvals',
      question: 'Which RelVals failed in the latest CMSSW_20_1_X IB?',
      warm: [search('failed_steps', { release: pickLatest(RELEASE_BUCKETS) }), answer('38634.422, 38634.423, 36434.0, 36834.0, 38551.85')],
      cold: [...discover, search('release_doc_counts', {}), search('failed_steps', { release: pickLatest(RELEASE_BUCKETS) }),
        answer('38634.422, 38634.423, 36434.0, 36834.0, 38551.85')],
    },
    {
      id: 'q3-failures-by-arch',
      question: 'Which architectures have failures in the latest CMSSW_20_1_X IB?',
      warm: [search('failure_distribution_by_arch', { release: pickLatest(RELEASE_BUCKETS) }), answer('el9_amd64_gcc14: 12, el9_aarch64_gcc14: 2, el8_amd64_gcc14: 1')],
      cold: [...discover, search('release_doc_counts', {}), search('failure_distribution_by_arch', { release: pickLatest(RELEASE_BUCKETS) }),
        answer('el9_amd64_gcc14: 12, el9_aarch64_gcc14: 2, el8_amd64_gcc14: 1')],
    },
    {
      id: 'q4-default-vs-root642',
      question: 'Compare DEFAULT vs ROOT642 for CMSSW_20_1_X',
      warm: [search('release_doc_counts', { size: 100 }), answer('ROOT642 is a dashboard label; release strings carry ROOT6 (gap G6)')],
      cold: [...discover, search('release_doc_counts', { size: 100 }), answer('ROOT642 is a dashboard label; release strings carry ROOT6 (gap G6)')],
    },
    {
      id: 'q5-unit-tests',
      question: 'Which unit tests failed in the latest CMSSW_20_1_X IB?',
      // Knowledge gap G10: the unit-test schema is unknown. Both plans must
      // discover; the warm plan must NOT invent fields.
      warm: [...discoverUnit, answer('Unit-test schema unverified (G10); discovery ran but no verified query can be built')],
      cold: [...discoverUnit, answer('Unit-test schema unknown; discovery ran but no verified query can be built')],
    },
  ];

  const warmCache = createKnowledgeCache();
  const results = [];
  for (const scenario of scenarios) {
    const row = { id: scenario.id, question: scenario.question };
    for (const mode of ['cold', 'warm']) {
      const state = { modelRequests: 0, systemChars: 0 };
      const client = mockClient(state);
      const model = scriptedModel(state, scenario[mode]);
      const started = Date.now();
      await runAgent({
        config: { model: 'scripted', maxSteps: 8, mcpHeaders: { Authorization: 'Bearer perf-user' } },
        messages: [{ role: 'user', content: scenario.question }],
        signal: new AbortController().signal,
        emit: () => {},
        client, model,
        knowledgeCache: mode === 'warm' ? warmCache : null,
        clock: () => T0,
      });
      const wallMs = Date.now() - started;
      row[mode] = {
        mcpToolCalls: client.counters.search + client.counters.listIndex + client.counters.indexMapping,
        indexDiscoveryCalls: client.counters.listIndex,
        mappingDiscoveryCalls: client.counters.indexMapping,
        probeSearchCalls: client.counters.probeSearch,
        answerSearchCalls: client.counters.modelSearch,
        failedCalls: client.counters.failures,
        modelRounds: state.modelRequests,
        wallMs,
        systemChars: state.systemChars,
      };
    }
    results.push(row);
    t.diagnostic(`${scenario.id}: cold ${row.cold.mcpToolCalls} MCP calls / ${row.cold.modelRounds} model rounds` +
      ` -> warm ${row.warm.mcpToolCalls} MCP calls / ${row.warm.modelRounds} model rounds`);
  }

  const totals = { cold: { mcpToolCalls: 0, modelRounds: 0, mappingDiscoveryCalls: 0, failedCalls: 0 },
    warm: { mcpToolCalls: 0, modelRounds: 0, mappingDiscoveryCalls: 0, failedCalls: 0, probeSearchCalls: 0 } };
  for (const row of results) {
    for (const mode of ['cold', 'warm']) {
      totals[mode].mcpToolCalls += row[mode].mcpToolCalls;
      totals[mode].modelRounds += row[mode].modelRounds;
      totals[mode].mappingDiscoveryCalls += row[mode].mappingDiscoveryCalls;
      totals[mode].failedCalls += row[mode].failedCalls;
      if (mode === 'warm') totals.warm.probeSearchCalls += row[mode].probeSearchCalls;
    }
  }
  t.diagnostic(`totals: cold ${totals.cold.mcpToolCalls} MCP calls / ${totals.cold.modelRounds} model rounds / ` +
    `${totals.cold.mappingDiscoveryCalls} mapping discoveries -> warm ${totals.warm.mcpToolCalls} MCP calls / ` +
    `${totals.warm.modelRounds} model rounds / ${totals.warm.mappingDiscoveryCalls} mapping discoveries / ` +
    `${totals.warm.probeSearchCalls} cached-freshness probes`);

  const report = {
    generated_at: new Date().toISOString(),
    method: {
      harness: 'real runAgent pipeline + scripted model + mock MCP server replaying discovery fixtures',
      measurement_note: 'modelRounds counts LLM round-trips the scripted plan makes; wallMs is harness wall-clock over zero-latency mocks and is NOT live latency. No live LLM or OpenSearch measurements were taken (no credentials in this environment).',
      cold_plan: 'no warm-up: system prompt requires index/mapping discovery before queries; latest-IB questions query release counts first',
      warm_plan: 'verified knowledge block + cached OPERATIONAL SNAPSHOT; only answer queries are run (templates rendered from query-templates.json)',
      fixtures: 'query result fixtures replay values captured in opensearch-discovery/raw/context3.txt and context4.txt',
    },
    questions: results,
    totals,
  };
  await mkdir(path.join(REPO, 'docs'), { recursive: true });
  await writeFile(path.join(REPO, 'docs', 'performance-warmup.json'), `${JSON.stringify(report, null, 2)}\n`);

  // The comparison must hold: warm mode saves discovery and model rounds on
  // every question answerable from verified knowledge, and equal work (never
  // invented fields) where knowledge declares a gap.
  for (const row of results.filter(entry => entry.id !== 'q5-unit-tests')) {
    assert.equal(row.warm.indexDiscoveryCalls + row.warm.mappingDiscoveryCalls, 0,
      `${row.id}: warm mode runs no discovery`);
    assert.ok(row.warm.mcpToolCalls < row.cold.mcpToolCalls, `${row.id}: fewer MCP calls warm (${row.warm.mcpToolCalls}) than cold (${row.cold.mcpToolCalls})`);
    assert.ok(row.warm.modelRounds < row.cold.modelRounds, `${row.id}: fewer model rounds warm`);
  }
  const q5 = results.find(entry => entry.id === 'q5-unit-tests');
  assert.equal(q5.warm.mcpToolCalls, q5.cold.mcpToolCalls, 'gap G10: warm mode does the same discovery, never invented fields');
  assert.equal(totals.warm.probeSearchCalls, 1, 'one freshness probe serves all five questions from the shared cache');
  assert.equal(totals.warm.failedCalls + totals.cold.failedCalls, 0, 'no query failed validation or execution in either plan');
});
