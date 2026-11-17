import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../server/chat/registry.mjs';
import { createInvestigationState, noteQuery, formatState, buildContext, selectFamilies } from '../server/chat/context.mjs';
import { detectIntent, extractParams, TEMPLATES, renderTemplate, validateToolArguments, buildSearchArgs, flavourSuffix } from '../server/chat/templates.mjs';
import { planQuestion, executePlan, makeDedupe } from '../server/chat/planner.mjs';
import { loadKnowledge, selectKnowledge } from '../server/chat/knowledge.mjs';

test('integration loads the captured schema snapshot without treating it as live evidence', async () => {
  const knowledge = await loadKnowledge();
  assert.equal(knowledge.ok, true);
  const selection = selectKnowledge(knowledge, 'Which RelVals failed in CMSSW_20_1_X?');
  assert.ok(selection.text.includes('cmssdt-ib-matrix'));
  assert.ok(selection.text.includes('NOT query results'));
});

test('deduplication distinguishes nested query filters and canonicalizes equivalent objects', () => {
  const cache = makeDedupe();
  const first = { index: 'x', query: { term: { release: 'A' } } };
  const second = { index: 'x', query: { term: { release: 'B' } } };
  assert.notEqual(cache.key('SearchIndexTool', first), cache.key('SearchIndexTool', second));
  assert.equal(cache.key('SearchIndexTool', first), cache.key('SearchIndexTool', { query: { term: { release: 'A' } }, index: 'x' }));
});

test('search argument adaptation never silently drops requested aggregations', () => {
  const schema = { type: 'object', properties: { index: { type: 'string' }, query: { type: 'object' } } };
  assert.equal(buildSearchArgs(schema, { index: 'x', body: { size: 0, query: { match_all: {} }, aggs: { by_release: { terms: { field: 'release' } } } } }), null);
});

const BUILD_MAPPING = { 'cmssdt-ibs-2968': { mappings: { properties: {
  release_name: { type: 'keyword' }, release_queue: { type: 'keyword' }, arch: { type: 'keyword' },
  ib_date: { type: 'date', format: 'yyyy-MM-dd-HHmm' }, status: { type: 'keyword' },
  done: { type: 'boolean' }, passed: { type: 'boolean' }, tests_archs: { type: 'keyword' },
} } } };
const RELVAL_MAPPING = { 'cmssdt-relvals-2968': { mappings: { properties: {
  release_name: { type: 'keyword' }, arch: { type: 'keyword' }, ib_date: { type: 'date' },
  workflowID: { type: 'integer' }, workflowName: { type: 'keyword' }, exitcode: { type: 'integer' },
  status: { type: 'keyword' }, steps: { type: 'nested', properties: { name: { type: 'keyword' }, exitcode: { type: 'integer' } } },
} } } };
const SEARCH_SCHEMA = { type: 'object', properties: {
  index: { type: 'string' }, query: { type: 'object' }, size: { type: 'number' }, sort: { type: 'array' },
  _source: { type: 'array' }, aggs: { type: 'object' },
}, required: ['index'] };

function seededRegistry() {
  const registry = createRegistry({});
  registry.recordIndices(['cmssdt-ibs-2967', 'cmssdt-ibs-2968', 'cmssdt-relvals-2968']);
  registry.recordMapping({ index: 'cmssdt-ibs-2968', mapping: BUILD_MAPPING });
  registry.recordMapping({ index: 'cmssdt-relvals-2968', mapping: RELVAL_MAPPING });
  return registry;
}

test('intent detection and parameter extraction cover the common investigations', () => {
  assert.equal(detectIntent('What is the latest IB for CMSSW_20_1_X?'), 'latest-ib');
  assert.equal(detectIntent('Which RelVals fail in CMSSW_20_1_X_2026-11-16-2300?'), 'failing-relvals');
  assert.equal(detectIntent('How many RelVal failures are there per workflow?'), 'relval-failure-aggregation');
  assert.equal(detectIntent('Compare the latest DEFAULT and CLANG builds'), 'compare-flavours');
  assert.equal(detectIntent('Compare the latest build with the previous one'), 'compare-builds');
  assert.equal(detectIntent('Summarize the unit test failures'), 'unit-test-failures');
  assert.equal(detectIntent('Is the latest build completed?'), 'build-status');
  assert.equal(detectIntent('hello'), 'generic');
  const params = extractParams('RelVal workflow 33734 failures in CMSSW_20_1_X_2026-11-16-2300 on el9_amd64_gcc14');
  assert.equal(params.release, 'CMSSW_20_1_X_2026-11-16-2300');
  assert.equal(params.series, '20_1');
  assert.equal(params.arch, 'el9_amd64_gcc14');
  assert.equal(params.workflow, '33734');
  assert.equal(flavourSuffix('DEFAULT'), 'X');
  assert.equal(flavourSuffix('CLANG'), 'CLANG_X');
});

test('templates render sound bounded queries against verified roles and refuse otherwise', () => {
  const registry = seededRegistry();
  const family = registry.document.families.find(entry => entry.id === 'cmssdt-ibs-*');
  const latest = TEMPLATES.find(template => template.id === 'latest-ib');
  const rendered = renderTemplate(latest, { family, params: { series: '20_1' }, searchSchema: SEARCH_SCHEMA });
  assert.ok(rendered, 'renders when roles bind');
  assert.equal(rendered.body.size, 5, 'bounded');
  assert.deepEqual(rendered.body.sort, [{ ib_date: 'desc' }], 'sorted by the bound date field');
  assert.deepEqual(rendered.body.query.bool.filter, [{ prefix: { release_name: 'CMSSW_20_1_' } }]);
  assert.equal(rendered.args.index, 'cmssdt-ibs-*');
  assert.ok(validateToolArguments(SEARCH_SCHEMA, rendered.args).ok, 'tool input validates against the discovered schema');

  // Not enough information: no series/release → no sound query.
  assert.equal(renderTemplate(latest, { family, params: {}, searchSchema: SEARCH_SCHEMA }), null);
  // Missing roles: a family without timestamp cannot render latest-ib.
  const bare = { id: 'x-*', pattern: 'x-*', fields: { release_name: { type: 'keyword' } }, roles: { release: 'release_name' } };
  assert.equal(renderTemplate(latest, { family: bare, params: { series: '20_1' }, searchSchema: SEARCH_SCHEMA }), null);
  // A search schema we cannot map confidently is refused, not guessed.
  assert.equal(buildSearchArgs({ type: 'object', properties: { foo: { type: 'string' } } }, { index: 'x', body: rendered.body }), null);
});

test('tool-input validation errors are detailed and separate from OpenSearch DSL validation', () => {
  const { ok, errors } = validateToolArguments(SEARCH_SCHEMA, { size: 5 });
  assert.equal(ok, false);
  assert.ok(errors.some(error => error.includes('required') || error.includes('index')), 'missing required property is named');
  assert.ok(validateToolArguments(SEARCH_SCHEMA, { index: 'x' }).ok);
  // A syntactically valid tool input may still be a bad OpenSearch query: that
  // surfaces as an isError tool result, not an input validation failure.
  assert.ok(validateToolArguments(SEARCH_SCHEMA, { index: 'x', query: { nonsense: 1 } }).ok);
});

test('failing-relvals and aggregation templates express failure semantics via bound fields', () => {
  const registry = seededRegistry();
  const relval = registry.document.families.find(entry => entry.id === 'cmssdt-relvals-*');
  const failing = renderTemplate(TEMPLATES.find(template => template.id === 'failing-relvals'),
    { family: relval, params: { release: 'CMSSW_20_1_X_2026-11-16-2300' }, searchSchema: SEARCH_SCHEMA });
  assert.ok(failing);
  assert.equal(failing.body.size, 50);
  assert.deepEqual(failing.body.query.bool.filter[1], { bool: { must_not: [{ term: { exitcode: 0 } }] } }, 'exitcode 0 = passed convention');
  const aggregate = renderTemplate(TEMPLATES.find(template => template.id === 'relval-failure-aggregation'),
    { family: relval, params: { series: '20_1' }, searchSchema: SEARCH_SCHEMA });
  assert.ok(aggregate);
  assert.equal(aggregate.body.aggs.by_workflow.terms.field, 'workflowID');
  assert.equal(aggregate.body.size, 0, 'aggregation without document dump');
});

test('context selection is deterministic, relevant and strictly budgeted', async () => {
  const registry = seededRegistry();
  for (let i = 0; i < 30; i++) registry.recordMapping({ index: `other-index-${i}`, mapping: { [`other-index-${i}`]: { mappings: { properties: { noise: { type: 'keyword' } } } } } });
  const question = 'Which RelVals fail in CMSSW_20_1_X_2026-11-16-2300?';
  const state = createInvestigationState(question);
  const context = await buildContext({ question, registry, state, maxChars: 3600 });
  assert.ok(context.length <= 3600, `context stays under budget (${context.length})`);
  assert.ok(context.includes('cmssdt-relvals-*'), 'selects the relval family');
  assert.ok(!context.includes('other-index-15'), 'does not dump unrelated registry entries');
  assert.ok(context.includes('failing-relvals'), 'includes the matched template');
  assert.ok(context.includes('Domain conventions') || context.includes('RelVal'), 'includes domain guidance');
  assert.equal(state.verifiedIndexFamily, 'cmssdt-relvals-*');
  assert.ok(state.mappingFingerprint, 'mapping fingerprint recorded in state');
  // Deterministic: same input yields the same context.
  const again = await buildContext({ question, registry, state: createInvestigationState(question), maxChars: 3600 });
  assert.equal(context, again);
});

test('investigation state only contains verified facts and unresolved gaps', () => {
  const state = createInvestigationState('Compare the latest DEFAULT and CLANG builds in CMSSW_20_1');
  assert.equal(state.intent, 'compare-flavours');
  assert.equal(state.releaseSeries, 'CMSSW_20_1');
  assert.equal(state.flavour, 'DEFAULT');
  assert.equal(state.verifiedIndexFamily, null);
  assert.ok(formatState(state).includes('unverified'));
  noteQuery(state, { tool: 'SearchIndexTool', ok: true, summary: 'saw release CMSSW_20_1_X_2026-11-16-2300' });
  noteQuery(state, { tool: 'ListIndexTool', ok: false });
  assert.equal(state.queriesAttempted.length, 2);
  assert.equal(state.successfulEvidence.length, 1, 'only successful queries become evidence');
  const text = formatState(state);
  assert.ok(text.includes('SearchIndexTool:ok'));
  assert.ok(text.includes('ListIndexTool:failed'));
  assert.ok(!text.includes('invented'), 'no claims beyond verified results');
});

test('planner executes validated templates, records validation and deduplicates repeats', async () => {
  const registry = seededRegistry();
  const executed = [];
  const session = { callTool: async (name, args) => {
    executed.push({ name, args });
    return { content: [{ type: 'text', text: '{"hits":{"hits":[{"_source":{"release_name":"CMSSW_20_1_X_2026-11-16-2300"}}}]}}' }], isError: false };
  } };
  const question = 'What is the latest IB for CMSSW_20_1_X?';
  const state = createInvestigationState(question);
  const { plans, intent } = planQuestion({ question, registry, searchSchema: SEARCH_SCHEMA });
  assert.equal(intent, 'latest-ib');
  assert.equal(plans.length, 1);
  const dedupe = makeDedupe();
  const evidence = await executePlan({ plans, session, registry, dedupe, state, note: entry => noteQuery(state, entry) });
  assert.equal(evidence.length, 1);
  assert.ok(evidence[0].ok && evidence[0].excerpt.includes('CMSSW_20_1_X_2026-11-16-2300'));
  assert.equal(executed.length, 1);
  assert.equal(registry.templateStatus('latest-ib', registry.document.families[0]), 'validated');
  assert.ok(state.successfulEvidence.length === 1);

  // A second identical planned query is served from the dedupe cache.
  const repeat = await executePlan({ plans, session, registry, dedupe, state, note: entry => noteQuery(state, entry) });
  assert.equal(executed.length, 1, 'identical query deduplicated within the investigation');
  assert.ok(repeat[0].description.includes('deduplicated'));

  // A failing query marks the template untrusted and is not presented as evidence of success.
  const failingSession = { callTool: async () => ({ content: [{ type: 'text', text: '{"error":"index_not_found"}' }], isError: true }) };
  const failed = await executePlan({ plans, session: failingSession, registry, dedupe: makeDedupe(), state });
  assert.equal(failed[0].ok, false);
  assert.notEqual(registry.templateStatus('latest-ib', registry.document.families[0]), 'validated');
});

test('planner produces nothing without verified mappings instead of guessing', () => {
  const empty = createRegistry({});
  const { plans } = planQuestion({ question: 'What is the latest IB for CMSSW_20_1_X?', registry: empty, searchSchema: SEARCH_SCHEMA });
  assert.equal(plans.length, 0, 'no schema knowledge: model explores instead');
});
