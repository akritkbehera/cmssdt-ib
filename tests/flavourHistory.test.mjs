import test from 'node:test';
import assert from 'node:assert/strict';
import { flavourHistory, historyFlavours, selectHistoryBuilds } from '../src/Utils/flavourHistory.js';

test('history anchors at the selected run, isolates variants, and deduplicates records', () => {
  const run = (queue, hour) => ({ isIB: true, release_queue: queue, release_name: queue + '_2026-11-09-' + hour });
  const queue = 'CMSSW_20_1_ASAN_X';
  const anchor = run(queue, '1100'), earlier = run(queue, '0000');
  const records = [earlier, run(queue, '2300'), { ...anchor }, run('CMSSW_20_1_X', '0000'),
    { ...earlier, variant: 'other' }, { ...earlier, next_ib: true }];
  assert.deepEqual(flavourHistory(anchor, records.values()), [anchor, earlier]);
});

test('flavour choices use the latest available run within the release line', () => {
  const run = (queue, hour) => ({ isIB: true, release_queue: queue, release_name: queue + '_2026-11-09-' + hour });
  const anchor = run('CMSSW_20_1_X', '1100');
  const asan = run('CMSSW_20_1_ASAN_X', '2300');
  assert.deepEqual(new Set(historyFlavours(anchor, [
    run('CMSSW_20_1_ASAN_X', '0000'), asan, run('CMSSW_19_1_X', '0000')
  ])), new Set([anchor, asan]));
});

const run = (flavour, stamp) => {
  const queue = 'CMSSW_20_1_' + (flavour ? flavour + '_' : '') + 'X';
  return { isIB: true, release_queue: queue, release_name: queue + '_' + stamp };
};

test('multi-flavour history hides unmatched intermediates and retains exact matches', () => {
  const d9 = run('', '2026-11-09-2300'), u9 = run('UBSAN', '2026-11-09-2300');
  const d6 = run('', '2026-11-06-2300'), u6 = run('UBSAN', '2026-11-06-2300');
  const records = [d6, u6, run('', '2026-11-08-2300'), d9, u9, run('', '2026-11-09-1100')];
  assert.deepEqual(new Set(selectHistoryBuilds([d9, u9], records)), new Set([d9, u9, d6, u6]));
});

test('latest selected flavours survive without any exact match', () => {
  const u = run('UBSAN', '2026-11-09-2300'), dbg = run('DBG', '2026-11-08-1100');
  assert.deepEqual(selectHistoryBuilds([u, dbg], [dbg, u, run('DBG', '2026-11-07-2300')]), [u, dbg]);
});

test('matches require the full time and all selected flavours', () => {
  const d = run('', '2026-11-10-2300'), u = run('UBSAN', '2026-11-10-1100'), c = run('CLANG', '2026-11-09-2300');
  const dOld = run('', '2026-11-08-2300'), uOld = run('UBSAN', '2026-11-08-2300');
  const unmatched = run('CLANG', '2026-11-08-1100');
  const builds = selectHistoryBuilds([d, u, c], [d, u, c, dOld, uOld, { ...dOld }, unmatched]);
  assert.deepEqual(builds, [d, u, c]);
  assert.deepEqual(selectHistoryBuilds([d, u, c], [d, u, c, dOld, uOld, unmatched], true), [d, u, c, uOld, dOld, unmatched]);
});

test('one flavour keeps its uninterrupted anchored history', () => {
  const current = run('', '2026-11-09-2300'), older = run('', '2026-11-09-1100');
  assert.deepEqual(selectHistoryBuilds([current], [older, current]), [current, older]);
});
