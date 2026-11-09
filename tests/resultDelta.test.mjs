import test from 'node:test';
import assert from 'node:assert/strict';
import { resultDelta } from '../src/Utils/resultDelta.js';
const r = (passed, details = {}, done = true) => ({ passed, details, done });
test('missing, invalid and running results cannot produce final comparisons', () => {
  for (const pair of [[r(false), undefined], [r(false, {}, false), r(true)], [r(false), r('unknown')], [r(false,{num_failed:null}),r(false,{num_failed:2})]]) assert.equal(resultDelta(...pair,'relvals'), null);
});
test('newly failing and fixed describe status transitions, never uniqueness', () => {
  assert.equal(resultDelta(r(false), r(true), 'dupDict').label, 'Newly failing');
  assert.equal(resultDelta(r(true), r(false), 'dupDict').label, 'Fixed');
});
test('failure decreases are favorable; pass increases are favorable', () => {
  let delta = resultDelta(r(false,{num_failed:2}),r(false,{num_failed:3}),'relvals');
  assert.equal(delta.metrics[0].label,'−1'); assert.equal(delta.metrics[0].tone,'success');
  delta = resultDelta(r(true,{num_passed:20}),r(true,{num_passed:10}),'utests');
  assert.equal(delta.metrics[0].label,'+10'); assert.equal(delta.metrics[0].tone,'success');
});
test('unchanged failures have no zero delta; incompatible metrics are not summed', () => {
  const delta=resultDelta(r(false,{num_failed:2}),r(false,{num_failed:2}),'relvals');
  assert.equal(delta.label,null); assert.deepEqual(delta.metrics,[]); assert.match(delta.detail,/Still failing/);
  assert.equal(resultDelta(r(false,{num_fails:2}),r(false,{num_errors:1}),'utests'),null);
});
test('warnings retain warning semantics; each build error metric compares independently', () => {
  const warning=resultDelta(r('warning',{num_warnings:2}),r('warning',{num_warnings:1}),'utests');
  assert.equal(warning.metrics[0].tone,'warning');
  const build=resultDelta(r(false,{compError:2,linkError:1}),r(false,{compError:1,linkError:2}),'builds');
  assert.deepEqual(build.metrics.map(m=>m.delta),[1,-1]);
});
