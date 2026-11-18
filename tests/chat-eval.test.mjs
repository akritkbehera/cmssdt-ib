import test from 'node:test';
import assert from 'node:assert/strict';
import { devCases, heldOutCases, FIXED_NOW } from '../server/chat/eval/cases.mjs';
import { runSuite, runCase, runStructuralCase, evaluateAnswer, fieldsFromCalls, LATENCY_LABEL } from '../server/chat/eval/replay.mjs';
import { parseCatalog, loadCatalog } from '../server/chat/graph/catalog.mjs';
import { loadFixtureCatalog, loadFixtureSet } from '../server/chat/eval/fixture-store.mjs';
import { loadPromptBundle } from '../server/chat/skills/prompts.mjs';
import { extractParams, detectIntent } from '../server/chat/skills/route.mjs';

const byId = (results, id, mode) => results.find(result => result.caseId === id && result.mode === mode);

test('fixture catalog parses clean under the v1 contract', async () => {
  const raw = await loadFixtureCatalog('full');
  const parsed = parseCatalog(raw, { source: 'test' });
  assert.equal(parsed.ok, true, parsed.errors.join('; '));
  assert.equal(parsed.catalog.schemaMajor, 1);
  assert.ok(parsed.catalog.datasets.some(dataset => dataset.datasetId === 'unit_test_results'));
  assert.ok(parsed.catalog.routes.length >= 8);
});

test('graph workflow passes every dev and held-out case offline', async () => {
  const suite = await runSuite([...devCases, ...heldOutCases], { modes: ['graph'] });
  const failed = suite.results.filter(result => !result.pass);
  assert.equal(failed.length, 0, failed.map(result => `${result.caseId}: ${result.checks.filter(c => !c.pass).map(c => c.name).join(', ')}`).join(' | '));
  assert.equal(suite.summary.graph.routeFirstAttemptAccuracy, 1);
  assert.equal(suite.summary.graph.answerCorrectRate, 1);
  assert.equal(suite.summary.graph.latencyLabel, LATENCY_LABEL);
});

test('baseline workflow shows the measured gaps on the dual unit-test fixtures', async () => {
  const perTest = devCases.find(kase => kase.id === 'dev-01-per-test-failures');
  const aggregateOnly = devCases.find(kase => kase.id === 'dev-07-missing-per-test-details');
  const both = await runSuite([perTest, aggregateOnly], { modes: ['baseline'] });
  // Same question, two fixtures: with per-test records the baseline names the
  // failing tests; with aggregate counts only it claims "no failed unit tests"
  // — the exact failure mode the graph workflow must avoid.
  const withDetails = byId(both.results, 'dev-01-per-test-failures', 'baseline');
  assert.ok(withDetails.checks.some(check => check.name === 'answer:contains:testCaloParticles' && check.pass));
  const missing = byId(both.results, 'dev-07-missing-per-test-details', 'baseline');
  assert.equal(missing.metrics.answerCorrect, false);
  assert.ok(missing.checks.some(check => check.name === 'answer:reportsMissingDetail' && !check.pass));
});

test('graph workflow asks instead of querying on ambiguous requests', async () => {
  const ambiguous = devCases.find(kase => kase.id === 'dev-08-ambiguous-clarify');
  const result = await runCase(ambiguous, { mode: 'graph', prompts: await loadPromptBundle('v1') });
  assert.equal(result.metrics.answerCorrect, true);
  assert.equal(result.metrics.toolCalls, 0);
  assert.equal(result.trace.decision, 'clarify');
});

test('zero matches are scoped to the asked-about records, not masked by metadata rows', async () => {
  const zero = devCases.find(kase => kase.id === 'dev-09-zero-matches');
  const result = await runCase(zero, { mode: 'graph', prompts: await loadPromptBundle('v1') });
  assert.equal(result.trace.evidenceStatus, 'zero_matches');
  assert.equal(result.metrics.answerCorrect, true);
});

test('missing indices become query failures, never empty results', async () => {
  const broken = devCases.find(kase => kase.id === 'dev-10-failed-query');
  const result = await runCase(broken, { mode: 'graph', prompts: await loadPromptBundle('v1') });
  assert.equal(result.trace.evidenceStatus, 'query_failed');
  assert.equal(result.metrics.answerCorrect, true);
});

test('real-catalog structural replay runs offline against a catalog path', async () => {
  const prompts = await loadPromptBundle('v1');
  // Point the structural runner at the fixture catalog file: it must parse,
  // route and validate plans without executing any query.
  const loaded = await loadCatalog(new URL('../server/chat/eval/fixtures/catalog.v1.json', import.meta.url).pathname);
  assert.equal(loaded.ok, true, loaded.errors.join('; '));
  for (const kase of devCases.filter(entry => !entry.patch)) {
    const structural = await runStructuralCase(kase, { catalog: loaded.catalog, prompts });
    assert.ok(['answer', 'clarify', 'unsupported'].includes(structural.decision), `${kase.id}: ${structural.decision}`);
    if (structural.decision === 'answer') assert.equal(structural.planValid, true, `${kase.id}: plan did not validate`);
  }
});

test('answer grading distinguishes abstentions from scoped negatives', () => {
  assert.equal(evaluateAnswer('Per-test details are missing from the available data: only aggregate counts are present.', { reportsMissingDetail: true }).pass, true);
  assert.equal(evaluateAnswer('No failed unit tests found.', { reportsMissingDetail: true }).pass, false);
  assert.equal(evaluateAnswer('No matching records in the queried scope — the queries succeeded but matched nothing, so there are zero matching failures in that scope.', { contains: ['zero matching'], notContains: ['No failed unit tests found'] }).pass, true);
});

test('field extraction reads DSL and PPL queries alike', () => {
  const fields = fieldsFromCalls([
    { tool: 'SearchIndexTool', args: { query: { bool: { filter: [{ term: { release_name: 'x' } }, { bool: { must_not: [{ term: { exitcode: 0 } }] } }] } }, aggs: { groups: { terms: { field: 'workflow', size: 5 }, aggs: { newest: { max: { field: 'ib_date' } } } } } } },
    { tool: 'execute_opensearch_ppl', args: { query: "source = cmssdt-x | where arch = 'el9' | stats count() as total by workflow" } },
  ]);
  for (const expected of ['release_name', 'exitcode', 'workflow', 'ib_date', 'arch']) assert.ok(fields.includes(expected), expected);
});

test('parameter extraction keeps flavoured cycles intact', () => {
  assert.equal(extractParams('Which RelVal workflows failed for CMSSW_20_1_CLANG_X?').series.value, 'CMSSW_20_1_CLANG_X');
  assert.equal(extractParams('latest CMSSW_20_1_X build').series.value, 'CMSSW_20_1_X');
  assert.equal(detectIntent('Compare the latest two IBs of CMSSW_20_1_X for el8_amd64_gcc12.'), 'compare_builds');
});

test('the fixed eval clock is deterministic', () => {
  assert.equal(FIXED_NOW, Date.parse('2026-11-18T02:00:00.000Z'));
  const set = loadFixtureSet('full');
  assert.ok(set);
});
