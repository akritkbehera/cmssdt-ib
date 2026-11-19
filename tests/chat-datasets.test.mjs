import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runAgent } from '../server/chat/agent.mjs';
import {
  DATASET_REGISTRY_PATH, RESOLVE_DATASET_TOOL, RESOLVE_DATASET_TOOL_NAME,
  loadDatasetRegistry, normalizeDatasetKey, resolveDataset, validateDatasetRegistry,
} from '../server/chat/datasets.mjs';

const REPLAY_PATH = new URL('./fixtures/datasets/unit-test-replay.json', import.meta.url);

async function baseRegistry() {
  return JSON.parse(await readFile(DATASET_REGISTRY_PATH, 'utf8'));
}

test('canonical key and every alias resolve to the unit-test dataset with unconfirmed verification', async () => {
  const registry = await loadDatasetRegistry();
  assert.deepEqual(registry, await loadDatasetRegistry(), 'the registry is loaded once and memoized');
  assert.ok(Object.isFrozen(registry) && Object.isFrozen(registry.datasets[0]), 'the runtime registry is frozen');

  const inputs = ['unit-test-results', 'unit test', 'unit tests', 'unit test failures', 'utest', 'utests',
    '  UNIT   TESTS  ', 'Unit Test Failures'];
  for (const input of inputs) {
    const result = resolveDataset(registry, input);
    assert.equal(result.status, 'resolved', input);
    assert.equal(result.dataset.key, 'unit-test-results');
    assert.equal(result.dataset.cluster, 'cmssdt1');
    assert.equal(result.dataset.index_family, 'cmssdt-ibs-*');
    assert.deepEqual(result.dataset.fields, {
      release: 'release',
      architecture: 'architecture',
      test_name: 'name',
      package: 'package',
      status: 'status',
    });
    assert.equal(result.dataset.verification.status, 'unverified');
    assert.equal(result.dataset.verification.mapping_confirmed, false);
    assert.equal(result.dataset.verification.status_semantics_confirmed, false);
    assert.match(result.dataset.provenance.notes, /candidate failure code/);
  }
});

test('unknown inputs and a bare CMSSW release identifier stay unresolved', async () => {
  const registry = await loadDatasetRegistry();
  const inputs = ['cmssdt-ib-matrix', 'unit tests failure', 'CMSSW_20_1_X_2026-11-17-2300',
    'CMSSW_20_1_X', '20_1_X', '', '   ', 'unit-test-results-extra'];
  for (const input of inputs) {
    const result = resolveDataset(registry, input);
    assert.equal(result.status, 'unresolved', JSON.stringify(input));
    assert.equal(result.dataset, undefined);
    assert.equal(result.reason, 'no_registered_dataset_match');
    assert.match(result.guidance, /ListIndexTool/);
    assert.match(result.guidance, /IndexMappingTool/);
  }
});

test('resolution normalizes case and collapsed whitespace but never fuzzily matches', async () => {
  const registry = await loadDatasetRegistry();
  assert.equal(normalizeDatasetKey('  Unit\t  Tests '), 'unit tests');
  assert.equal(resolveDataset(registry, 'unit-tests').status, 'unresolved', 'hyphens are not normalized away');
  assert.equal(resolveDataset(registry, 'unit').status, 'unresolved', 'substrings do not match');
  const before = JSON.stringify(registry);
  resolveDataset(registry, 'unit tests');
  assert.equal(JSON.stringify(registry), before, 'resolution never mutates the registry');
});

test('invalid entries, duplicate keys and duplicate normalized aliases are rejected', async () => {
  const clone = async () => baseRegistry();
  const registry = await clone();

  assert.throws(() => validateDatasetRegistry({ ...registry, version: 99 }), /version must be 1/);
  assert.throws(() => validateDatasetRegistry({ version: 1, datasets: [] }), /datasets must be a non-empty array/);

  let broken = await clone();
  delete broken.datasets[0].fields;
  assert.throws(() => validateDatasetRegistry(broken), /fields must be a non-empty object/);

  broken = await clone();
  broken.datasets[0].fields.release = '   ';
  assert.throws(() => validateDatasetRegistry(broken), /fields\.release must be a non-empty source field/);

  broken = await clone();
  broken.datasets[0].aliases.push('   ');
  assert.throws(() => validateDatasetRegistry(broken), /aliases\[\d+\] must be a non-empty string/);

  broken = await clone();
  broken.datasets[0].aliases.push(' Unit   Tests ');
  assert.throws(() => validateDatasetRegistry(broken), /duplicates normalized alias "unit tests" in the same dataset/);

  broken = await clone();
  const copy = JSON.parse(JSON.stringify(broken.datasets[0]));
  copy.key = 'other-dataset';
  broken.datasets.push(copy);
  assert.throws(() => validateDatasetRegistry(broken), /duplicates normalized alias "unit test" from datasets\[0\]/);

  broken = await clone();
  delete broken.datasets[0].verification.mapping_confirmed;
  assert.throws(() => validateDatasetRegistry(broken), /verification\.mapping_confirmed must be a boolean/);

  broken = await clone();
  broken.datasets[0].key = 'Not A Key';
  assert.throws(() => validateDatasetRegistry(broken), /must be a lowercase hyphenated identifier/);
});

test('the advertised resolver keeps the existing tool contract and carries the evidence boundary', () => {
  assert.equal(RESOLVE_DATASET_TOOL_NAME, 'resolve_dataset');
  assert.equal(RESOLVE_DATASET_TOOL.function.name, 'resolve_dataset');
  assert.deepEqual(RESOLVE_DATASET_TOOL.function.parameters.required, ['key']);
  const description = RESOLVE_DATASET_TOOL.function.description;
  assert.match(description, /before guessing/);
  assert.match(description, /A CMSSW release identifier by itself is not a dataset key/);
  assert.match(description, /ListIndexTool/);
  assert.match(description, /IndexMappingTool/);
  assert.match(description, /preserve the exact release and architecture/);
  assert.match(description, /does not confirm what a status value means/);
});

// Replay the acceptance question through the real runAgent tool loop. The
// model and MCP responses are fixtures; the resolver dispatch, argument
// validation, tool result routing and final answer shape are real. This does
// not establish anything about the live index or status semantics.
test('fixture replay: unit-test question selects the dataset, keeps exact scope and flags unconfirmed status', async () => {
  const fixture = JSON.parse(await readFile(REPLAY_PATH, 'utf8'));
  const expected = fixture.expected;
  const requests = [];
  const toolCalls = [];
  let step = 0;

  const client = {
    listTools: async () => ({ tools: [
      { name: 'ListIndexTool', description: 'List indices', inputSchema: { type: 'object', properties: {} } },
      { name: 'IndexMappingTool', description: 'Get a mapping', inputSchema: { type: 'object', properties: { index: { type: 'string' } }, required: ['index'] } },
      { name: 'SearchIndexTool', description: 'Search an index', inputSchema: { type: 'object', properties: { index: { type: 'string' }, query: { type: 'object' } }, required: ['index'] } },
    ] }),
    callTool: async ({ name, arguments: args }) => {
      toolCalls.push({ name, args });
      const text = fixture.tool_results[name];
      if (text === undefined) throw new Error(`Unexpected MCP tool ${name}: the resolver must be dispatched locally.`);
      return { content: [{ type: 'text', text }], isError: false };
    },
    close: async () => {},
  };

  const model = { chat: { completions: { create: async request => {
    requests.push(JSON.parse(JSON.stringify(request)));
    if (step < fixture.steps.length) {
      const next = fixture.steps[step++];
      return (async function* () {
        yield { choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${step}`,
          function: { name: next.tool, arguments: JSON.stringify(next.arguments) } }] }, finish_reason: 'tool_calls' }] };
      })();
    }
    return (async function* () {
      yield { choices: [{ delta: { content: fixture.final_answer }, finish_reason: 'stop' }] };
    })();
  } } } };

  const events = [];
  await runAgent({
    config: { model: 'fixture-model' }, messages: [{ role: 'user', content: fixture.question }],
    signal: new AbortController().signal, emit: event => events.push(event), client, model,
  });

  assert.deepEqual(requests[0].tools.map(tool => tool.function.name),
    ['resolve_dataset', 'ListIndexTool', 'IndexMappingTool', 'SearchIndexTool'],
    'the resolver is advertised and existing tools remain available');
  assert.equal(requests.length, fixture.steps.length + 1);

  const resolverRequest = requests[1];
  const resolverToolMessages = resolverRequest.messages.filter(message => message.role === 'tool');
  assert.equal(resolverToolMessages.length, 1, 'the resolver ran before any OpenSearch discovery tool');
  const outer = JSON.parse(resolverToolMessages[0].content);
  const resolution = JSON.parse(outer.content[0].text);
  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.dataset.key, expected.dataset_key);
  assert.equal(resolution.dataset.cluster, expected.cluster);
  assert.equal(resolution.dataset.index_family, expected.index_family);
  assert.equal(resolution.dataset.verification.mapping_confirmed, false);
  assert.equal(resolution.dataset.verification.status_semantics_confirmed, false);

  assert.deepEqual(toolCalls.map(call => call.name), ['ListIndexTool', 'IndexMappingTool', 'SearchIndexTool'],
    'only the resolver is local; live discovery still goes through MCP');

  const assistantCalls = requests.at(-1).messages.filter(message => message.tool_calls).flatMap(message => message.tool_calls);
  const searchCall = assistantCalls.find(call => call.function.name === 'SearchIndexTool');
  assert.ok(searchCall, 'the replayed answer queried the concrete index');
  const searchArgs = JSON.parse(searchCall.function.arguments);
  assert.equal(searchArgs.index, expected.index);
  const filters = searchArgs.query.query.bool.filter;
  assert.deepEqual(filters.find(clause => clause.term?.release), { term: { release: expected.release } });
  assert.deepEqual(filters.find(clause => clause.term?.architecture), { term: { architecture: expected.architecture } });
  assert.deepEqual(filters.find(clause => clause.term?.status), { term: { status: 1 } },
    'status 1 is queried only as a candidate failure code');

  const final = events.filter(event => event.type === 'text').map(event => event.text).join('');
  assert.equal(final, fixture.final_answer);
  assert.match(final, /cmssdt-ibs-2968/, 'the answer cites the concrete index');
  assert.match(final, /candidate failure code/);
  assert.match(final, /unconfirmed/);
  assert.match(final, /does not establish the live answer/);
  assert.equal(events.at(-1).type, 'done');
});
