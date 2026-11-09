import test from 'node:test';
import assert from 'node:assert/strict';
import { configurationBuildState, familyBuildState, architectureDefaults, matchesResultFilter, sectionState, testGroupState } from '../src/Utils/buildStatus.js';
const arch = 'el9_amd64_gcc14';
const ib = (...results) => ({ builds: results.map(result => ({ arch, ...result })) });

test('running failures and warnings retain their outcome and motion', () => {
  assert.deepEqual(configurationBuildState(ib({ passed: 'error', done: false }), arch), { status: 'failed', running: true });
  assert.deepEqual(configurationBuildState(ib({ passed: 'warning', done: false }), arch), { status: 'warnings', running: true });
  assert.deepEqual(configurationBuildState(ib({ passed: 'passed', done: false }), arch), { status: 'running', running: true });
  assert.deepEqual(configurationBuildState(ib({ passed: 'passed', done: true }), arch), { status: 'passed', running: false });
});
test('missing and ambiguous builds are unknown; only explicit queue states are queued', () => {
  for (const data of [undefined, ib(), ib({ passed: 'passed' }, { passed: 'error' }), ib({})]) {
    assert.deepEqual(configurationBuildState(data, arch), { status: 'unknown', running: false });
  }
  assert.deepEqual(configurationBuildState(ib({ passed: 'queued' }), arch), { status: 'queued', running: false });
});
test('family outcome keeps the worst result while any configuration runs', () => {
  const data = { builds: [{ arch, passed: 'error', done: true }, { arch: 'el9_aarch64_gcc14', passed: 'passed', done: false }] };
  assert.deepEqual(familyBuildState(data, [arch, 'el9_aarch64_gcc14']), { status: 'failed', running: true });
});
test('metadata highlights use the modal axis values and avoid arbitrary ties', () => {
  assert.deepEqual(architectureDefaults([arch, arch, 'el8_aarch64_gcc15']), ['el9', 'amd64', 'gcc14']);
  assert.deepEqual(architectureDefaults([arch, 'el8_aarch64_gcc15']), [undefined, undefined, undefined]);
});
test('issue emphasis includes warnings while individual chips match only their state', () => {
  assert.equal(matchesResultFilter('warning', 'issues'), true);
  assert.equal(matchesResultFilter('danger', 'issues'), true);
  assert.equal(matchesResultFilter('success', 'issues'), false);
  assert.equal(matchesResultFilter('warning', 'danger'), false);
  assert.equal(matchesResultFilter('secondary', 'all'), true);
});
test('section outcomes preserve failures during progress and unknown data never passes', () => {
  assert.deepEqual(sectionState([{ variant: 'danger' }, { variant: 'info' }]), { status: 'danger', running: true });
  assert.deepEqual(sectionState([{ variant: 'info' }]), { status: 'info', running: true });
  assert.deepEqual(testGroupState({ gpu: { done: false, details: { num_fails: 2 } } }, 'num_fails'), { status: 'danger', running: true });
  assert.deepEqual(testGroupState({ gpu: { details: {} } }, 'num_fails'), { status: 'secondary', running: false });
  assert.deepEqual(testGroupState({ gpu: { passed: 'passed', details: { known_failed: 1 } } }, 'num_failed'), { status: 'warning', running: false });
});
