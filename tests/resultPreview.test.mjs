import test from 'node:test';
import assert from 'node:assert/strict';
import { resultSnapshot, snapshotMatches, previewGroups } from '../src/Utils/resultPreview.js';
import { comparableCellResults, compareCell, buildComparisonIndex } from '../src/Utils/ibComparison.js';
const workflow = (id, status, extra = {}) => ({ id, name: `Workflow ${id}`, steps: [{ status }], ...extra });
test('fixes require an observed fail-to-pass identity; missing and unfinished workflows are not fixes', () => {
  const before = resultSnapshot('relvals', [workflow(1, 'FAILED'), workflow(2, 'PASSED'), workflow(3, 'FAILED'), workflow(4, 'FAILED'), workflow(5, 'FAILED'), workflow(6, 'PASSED')]);
  const now = resultSnapshot('relvals', [workflow(1, 'PASSED'), workflow(2, 'FAILED'), workflow(3, 'FAILED'), workflow(5, 'STARTED'), workflow(6, 'PASSED'), workflow(7, 'FAILED')]);
  const groups = previewGroups(now, before);
  assert.deepEqual(groups.fixed.map(item => item.key), ['1']);
  assert.deepEqual(groups.newFailures.map(item => item.key), ['2']);
  assert.deepEqual(groups.stillFailing.map(item => item.key), ['3']);
  assert.deepEqual(groups.passing.map(item => item.key), ['6']);
  assert.deepEqual(groups.failing.map(item => item.key), ['7']);
});
test('known failures are kept separate and snapshots must agree with reported counts', () => {
  const entries = resultSnapshot('relvals', [workflow(1, 'FAILED', { known_error: true }), workflow(2, 'PASSED')]);
  assert.equal(previewGroups(entries).warnings.length, 1);
  assert.equal(snapshotMatches('relvals', entries, { done: true, details: { num_failed: 0, known_failed: 1, num_passed: 1 } }), true);
  assert.equal(snapshotMatches('relvals', entries, { details: { num_passed: 20 } }), false);
  assert.equal(snapshotMatches('relvals', entries, { done: false }), false);
});
test('unit test failures count errors while identities name packages; invalid or duplicate details are rejected', () => {
  const entries = resultSnapshot('utests', [{ name: 'Reco/A', errors: 3 }, { name: 'Reco/B', errors: 0 }]);
  assert.equal(snapshotMatches('utests', entries, { details: { num_fails: 3 } }), true);
  assert.equal(snapshotMatches('utests', entries, { details: { num_fails: 1 } }), false);
  assert.equal(resultSnapshot('utests', [{ name: 'A', errors: null }]), null);
  assert.equal(resultSnapshot('relvals', [workflow(1, 'PASSED'), workflow(1, 'FAILED')]), null);
});
test('unchanged cells can preview results while retaining exact baseline and running suppression', () => {
  const make = date => ({ isIB: true, release_queue: 'CMSSW_20_1_X', release_name: `CMSSW_20_1_X_${date}`, tests_archs: ['el9_amd64_gcc14'], relvals: [{ arch: 'el9_amd64_gcc14', passed: true, done: true, details: { num_passed: 2 } }] });
  const now = make('2026-11-09-2300'), before = make('2026-11-09-1100');
  const index = buildComparisonIndex([now, before]);
  assert.equal(compareCell(now, index.get(now), 'relvals', 'el9_amd64_gcc14'), null);
  assert.equal(comparableCellResults(now, index.get(now), 'relvals', 'el9_amd64_gcc14').previous, before.relvals[0]);
  now.relvals[0].done = false;
  assert.equal(comparableCellResults(now, index.get(now), 'relvals', 'el9_amd64_gcc14'), null);
});
