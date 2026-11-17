// Warm-up tests: the agent must answer from verified structural knowledge and
// cached operational snapshots without rediscovering indices or mappings,
// keep per-user OpenSearch authorization on every live call, keep cached
// snapshots per principal and time-bounded, and never present cached values as
// structural knowledge or vice versa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  warmUp, createKnowledgeCache, principalOf, buildSearchArgs, needsFreshness,
  detectCycle, selectKnowledge, DEFAULT_TTL_MS, SNAPSHOT_DATE,
} from '../server/chat/knowledge.mjs';
import { runAgent } from '../server/chat/agent.mjs';
import { loadConfig } from '../server/chat/config.mjs';

// Cross-cycle lexicographic trap: _key-desc order ranks CMSSW_9_4_X above
// CMSSW_20_1_X. The warm-up must still pick the latest of the requested cycle.
const BUCKETS = [
  { key: 'CMSSW_9_4_X_2026-11-15-0000', doc_count: 1200 },
  { key: 'CMSSW_20_1_X_2026-11-17-2300', doc_count: 8239 },
  { key: 'CMSSW_20_1_X_2026-11-17-1100', doc_count: 8000 },
  { key: 'CMSSW_20_1_ROOT6_X_2026-11-16-2300', doc_count: 500 },
];
const SEARCH_SCHEMA = { type: 'object', properties: { index: { type: 'string' }, body: { type: 'object' } }, required: ['index'] };

function mockMcp(buckets = BUCKETS) {
  const calls = [];
  return {
    calls,
    async callTool(tool) {
      calls.push({ name: tool.name, args: tool.arguments });
      return { content: [{ type: 'text', text: JSON.stringify({ aggregations: { releases: { buckets } } }) }] };
    },
  };
}

test('warm-up injects verified knowledge and a labelled operational snapshot with zero discovery calls', async () => {
  const mcp = mockMcp();
  const cache = createKnowledgeCache();
  const t0 = 1794900000000;
  const warm = await warmUp({
    question: 'What is the latest CMSSW_20_1_X IB?',
    mcp, searchSchema: SEARCH_SCHEMA, cache, now: () => t0,
  });

  assert.equal(mcp.calls.length, 1, 'exactly one live call');
  assert.equal(mcp.calls[0].name, 'SearchIndexTool');
  assert.equal(mcp.calls[0].args.index, 'cmssdt-ib-matrix-*');
  assert.equal(mcp.calls[0].args.body.aggs.releases.terms.field, 'release');
  assert.equal(mcp.calls.filter(call => call.name === 'ListIndexTool').length, 0);
  assert.equal(mcp.calls.filter(call => call.name === 'IndexMappingTool').length, 0);

  const addendum = warm.systemAddendum;
  assert.ok(addendum.indexOf('VERIFIED STRUCTURAL KNOWLEDGE') < addendum.indexOf('OPERATIONAL SNAPSHOT'),
    'structural knowledge precedes the operational snapshot');
  assert.match(addendum, /static schema facts, NOT query results/);
  assert.match(addendum, /OPERATIONAL SNAPSHOT — live query result fetched/);
  assert.match(addendum, /not structural knowledge/);
  assert.ok(addendum.includes(new Date(t0).toISOString()), 'snapshot carries its fetch time');
  assert.match(addendum, /Latest IB for CMSSW_20_1_X: CMSSW_20_1_X_2026-11-17-2300/,
    'latest is picked within the cycle, not lexicographically across cycles');
  assert.doesNotMatch(addendum, /Latest IB[^\n]*CMSSW_9_4_X/);

  assert.deepEqual(warm.stats, { structural: true, probes: 1, cacheHits: 0, probeFailures: 0, needsDiscovery: false });
});

test('questions without freshness needs make no live calls at all', async () => {
  const mcp = mockMcp();
  const warm = await warmUp({
    question: 'Which RelVals failed in CMSSW_20_1_X_2026-11-16-2300?',
    mcp, searchSchema: SEARCH_SCHEMA, cache: createKnowledgeCache(), now: () => 1794900000000,
  });
  assert.equal(mcp.calls.length, 0);
  assert.equal(warm.stats.probes, 0);
  assert.doesNotMatch(warm.systemAddendum, /OPERATIONAL SNAPSHOT/);
  assert.match(warm.systemAddendum, /VERIFIED STRUCTURAL KNOWLEDGE/);
  assert.match(warm.systemAddendum, /failed_steps/);
});

test('operational snapshots are cached per principal with a TTL and never shared across users', async () => {
  const cache = createKnowledgeCache();
  const t0 = 1794900000000;
  const question = 'What is the latest CMSSW_20_1_X IB?';
  const alice = { mcpHeaders: { Authorization: 'Bearer alice-token' } };
  const bob = { mcpHeaders: { Authorization: 'Bearer bob-token' } };
  const aliceMcp = mockMcp(), bobMcp = mockMcp();

  const first = await warmUp({ question, mcp: aliceMcp, runtime: alice, searchSchema: SEARCH_SCHEMA, cache, now: () => t0 });
  assert.equal(aliceMcp.calls.length, 1);
  assert.equal(first.stats.probes, 1);

  const repeat = await warmUp({ question, mcp: aliceMcp, runtime: alice, searchSchema: SEARCH_SCHEMA, cache, now: () => t0 + 60000 });
  assert.equal(aliceMcp.calls.length, 1, 'second call within TTL is served from cache');
  assert.equal(repeat.stats.cacheHits, 1);
  assert.ok(repeat.systemAddendum.includes(new Date(t0).toISOString()), 'cached snapshot keeps its original fetch time');

  const other = await warmUp({ question, mcp: bobMcp, runtime: bob, searchSchema: SEARCH_SCHEMA, cache, now: () => t0 + 120000 });
  assert.equal(bobMcp.calls.length, 1, 'a different user triggers their own probe with their own credentials');
  assert.equal(other.stats.cacheHits, 0);
  assert.equal(other.stats.probes, 1);

  assert.notEqual(principalOf(alice), principalOf(bob));
  assert.equal(cache.size(), 2, 'one cached snapshot per principal');
  assert.ok(cache.get(`${principalOf(alice)}:release-buckets`));
  assert.ok(cache.get(`${principalOf(bob)}:release-buckets`));

  const expired = await warmUp({ question, mcp: aliceMcp, runtime: alice, searchSchema: SEARCH_SCHEMA, cache,
    now: () => t0 + DEFAULT_TTL_MS + 1000 });
  assert.equal(aliceMcp.calls.length, 2, 'after the TTL the snapshot is refreshed');
  assert.equal(expired.stats.probes, 1, 'the refresh performs exactly one new probe');
  assert.equal(expired.stats.cacheHits, 0);
  assert.ok(expired.systemAddendum.includes(new Date(t0 + DEFAULT_TTL_MS + 1000).toISOString()));
});

test('the freshness probe fails soft when the tool schema cannot express it or the call fails', async () => {
  const t = 1794900000000;
  const question = 'What is the latest CMSSW_20_1_X IB?';

  const noBodySchema = { type: 'object', properties: { index: { type: 'string' } }, required: ['index'] };
  assert.equal(buildSearchArgs(noBodySchema, { index: 'x', body: {} }), null,
    'no tool arguments are invented when the schema lacks a body');
  assert.equal(buildSearchArgs(undefined, { index: 'x', body: {} }), null);

  const strict = mockMcp();
  const soft = await warmUp({ question, mcp: strict, searchSchema: noBodySchema, cache: createKnowledgeCache(), now: () => t });
  assert.equal(strict.calls.length, 0);
  assert.equal(soft.stats.probeFailures, 1);
  assert.match(soft.systemAddendum, /OPERATIONAL SNAPSHOT: unavailable/);
  assert.match(soft.systemAddendum, /Verify latest releases with your own tool calls/);
  assert.match(soft.systemAddendum, /VERIFIED STRUCTURAL KNOWLEDGE/, 'structural knowledge is still delivered');

  const broken = { calls: [], async callTool() { throw new Error('connection reset'); } };
  const failed = await warmUp({ question, mcp: broken, searchSchema: SEARCH_SCHEMA, cache: createKnowledgeCache(), now: () => t });
  assert.equal(failed.stats.probeFailures, 1);
  assert.match(failed.systemAddendum, /OPERATIONAL SNAPSHOT: unavailable \(freshness probe failed\)/);
});

test('missing knowledge and unverified domains trigger discovery instructions instead of guesses', async () => {
  const brokenKnowledge = { ok: false, registry: null, fieldIndex: new Set() };
  const fallback = selectKnowledge(brokenKnowledge, 'What is the latest IB?');
  assert.equal(fallback.needsDiscovery, true);
  assert.match(fallback.text, /ListIndexTool/);
  assert.match(fallback.text, /IndexMappingTool/);

  const mcp = mockMcp();
  const warm = await warmUp({
    question: 'Which unit tests failed in the latest CMSSW_20_1_X IB?',
    mcp, searchSchema: SEARCH_SCHEMA, cache: createKnowledgeCache(), now: () => 1794900000000,
  });
  assert.equal(warm.selection.needsDiscovery, true, 'unit-test data is an open gap (G10)');
  assert.match(warm.systemAddendum, /UNIT TESTS:/);
  assert.match(warm.systemAddendum, /G10/);
  assert.match(warm.systemAddendum, /do not guess fields/);
});

test('helper predicates match the verified release grammar', () => {
  assert.equal(needsFreshness('What is the latest IB?'), true);
  assert.equal(needsFreshness('What ran on 2026-11-16?'), false);
  assert.equal(detectCycle('latest CMSSW_20_1_X IB'), 'CMSSW_20_1_X');
  assert.equal(detectCycle('latest CMSSW_20_1_ROOT6_X IB'), 'CMSSW_20_1_ROOT6_X');
  assert.equal(detectCycle('any failures?'), null);
});

// ---------------------------------------------------------------------------
// End-to-end through runAgent over a real MCP HTTP transport. The mock server
// records every RPC with its Authorization header, so per-user credential
// preservation is asserted at the wire.
// ---------------------------------------------------------------------------

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function body(req) { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text); }

function scriptedModel(script) {
  const requests = [];
  return {
    requests,
    chat: { completions: { async create(request) {
      requests.push(request);
      const step = script[requests.length - 1] || { text: 'done' };
      return (async function* () {
        if (step.toolCall) {
          yield { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call${requests.length}`,
            function: { name: step.toolCall.name, arguments: JSON.stringify(step.toolCall.args) } }] }, finish_reason: 'tool_calls' }] };
        } else {
          yield { choices: [{ index: 0, delta: { content: step.text }, finish_reason: 'stop' }] };
        }
      })();
    } } },
  };
}

function mcpServer(rpcLog) {
  return async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const rpc = await body(req);
    rpcLog.push({ authorization: req.headers.authorization, rpc });
    if (rpc.id === undefined) { res.writeHead(202).end(); return; }
    let result;
    if (rpc.method === 'initialize') {
      result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } };
    } else if (rpc.method === 'tools/list') {
      result = { tools: [
        { name: 'ListIndexTool', description: 'list indices', inputSchema: { type: 'object', properties: {} } },
        { name: 'IndexMappingTool', description: 'mapping', inputSchema: { type: 'object', properties: { index: { type: 'string' } }, required: ['index'] } },
        { name: 'SearchIndexTool', description: 'search', inputSchema: SEARCH_SCHEMA },
      ] };
    } else if (rpc.method === 'tools/call') {
      result = { content: [{ type: 'text', text: JSON.stringify({ aggregations: { releases: { buckets: BUCKETS } } }) }], isError: false };
    } else {
      res.writeHead(500).end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  };
}

const ANSWER_PLAN = [
  { toolCall: { name: 'SearchIndexTool', args: { index: 'cmssdt-ib-matrix-*',
    body: { size: 0, aggs: { releases: { terms: { field: 'release', size: 50, order: { _key: 'desc' } } } } } } } },
  { text: 'The latest CMSSW_20_1_X IB is CMSSW_20_1_X_2026-11-17-2300.' },
];

test('runAgent warm-up answers without discovery and keeps each user on their own credentials', async t => {
  const rpcLog = [];
  const mcpURL = await serve(t, mcpServer(rpcLog));
  const cache = createKnowledgeCache();
  const question = 'What is the latest CMSSW_20_1_X IB?';

  const runAs = async (token, script = ANSWER_PLAN) => {
    const config = loadConfig({ CERN_AI_KEY: 'model-key', CERN_AI_MODEL: 'test-model',
      OPENSEARCH_MCP_URL: mcpURL, OPENSEARCH_MCP_HEADERS: JSON.stringify({ Authorization: `Bearer ${token}` }) });
    const events = [];
    const model = scriptedModel(script);
    await runAgent({ config, messages: [{ role: 'user', content: question }],
      signal: new AbortController().signal, emit: event => events.push(event), model,
      knowledgeCache: cache, clock: () => 1794900000000 });
    return { events, model };
  };

  const alice = await runAs('alice-token');
  const bob = await runAs('bob-token');
  const aliceAgain = await runAs('alice-token');

  const calls = rpcLog.filter(entry => entry.rpc.method === 'tools/call');
  assert.equal(calls.filter(entry => entry.rpc.params.name !== 'SearchIndexTool').length, 0,
    'warm-up needs no ListIndexTool/IndexMappingTool at all');
  assert.equal(calls.filter(entry => entry.authorization === 'Bearer alice-token').length, 2 + 1,
    'alice: one probe + one answer query, then one cached answer query');
  assert.equal(calls.filter(entry => entry.authorization === 'Bearer bob-token').length, 2,
    'bob: his own probe + answer query, never served from alice cache');
  for (const entry of calls) {
    assert.ok(entry.authorization, 'every live call carries the caller credentials');
  }

  const system = alice.model.requests[0].messages[0];
  assert.equal(system.role, 'system');
  assert.ok(system.content.includes('VERIFIED STRUCTURAL KNOWLEDGE — OpenSearch snapshot'),
    'the structural knowledge block is injected');
  assert.ok(system.content.includes('OPERATIONAL SNAPSHOT — live query result fetched'),
    'the operational snapshot block is injected and labelled');
  assert.ok(system.content.indexOf('VERIFIED STRUCTURAL KNOWLEDGE —') < system.content.indexOf('OPERATIONAL SNAPSHOT —'));
  assert.ok(system.content.includes('CMSSW_20_1_X_2026-11-17-2300'));
  assert.doesNotMatch(system.content, /opensearch-discovery|context[1-4]\.txt/, 'raw discovery files never reach the model');

  const aliceAgainSystem = aliceAgain.model.requests[0].messages[0].content;
  assert.match(aliceAgainSystem, /OPERATIONAL SNAPSHOT —/, 'cached snapshot is still injected, labelled and dated');
  assert.ok(aliceAgainSystem.includes(new Date(1794900000000).toISOString()));

  assert.equal(alice.events.filter(event => event.type === 'text').map(event => event.text).join(''),
    'The latest CMSSW_20_1_X IB is CMSSW_20_1_X_2026-11-17-2300.');
  assert.ok(alice.events.some(event => event.type === 'activity' && /verified IB schema knowledge/.test(event.text)));
  assert.equal(alice.events.at(-1).type, 'done');
});

test('runAgent without a knowledge cache keeps baseline discovery-first behaviour', async t => {
  const rpcLog = [];
  const mcpURL = await serve(t, mcpServer(rpcLog));
  const config = loadConfig({ CERN_AI_KEY: 'model-key', CERN_AI_MODEL: 'test-model',
    OPENSEARCH_MCP_URL: mcpURL, OPENSEARCH_MCP_HEADERS: '{"Authorization":"Bearer carol-token"}' });
  const model = scriptedModel(ANSWER_PLAN);
  await runAgent({ config, messages: [{ role: 'user', content: 'What is the latest CMSSW_20_1_X IB?' }],
    signal: new AbortController().signal, emit: () => {}, model, knowledgeCache: null });

  const system = model.requests[0].messages[0].content;
  assert.doesNotMatch(system, /VERIFIED STRUCTURAL KNOWLEDGE —|OPERATIONAL SNAPSHOT —/,
    'no knowledge block is injected without a knowledge cache');
  assert.match(system, /discover indices and inspect mappings/i);
  const calls = rpcLog.filter(entry => entry.rpc.method === 'tools/call');
  assert.equal(calls.length, 1, 'baseline: only the model\'s own query hits OpenSearch');
  assert.equal(calls[0].rpc.params.name, 'SearchIndexTool');
});
