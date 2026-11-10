import test from 'node:test';
import assert from 'node:assert/strict';
import { flavourHistory } from '../src/Utils/flavourHistory.js';

test('history anchors at the selected run, isolates variants, and deduplicates records', () => {
  const run = (queue, hour) => ({ isIB: true, release_queue: queue, release_name: queue + '_2026-11-09-' + hour });
  const queue = 'CMSSW_20_1_ASAN_X';
  const anchor = run(queue, '1100'), earlier = run(queue, '0000');
  const records = [earlier, run(queue, '2300'), { ...anchor }, run('CMSSW_20_1_X', '0000'),
    { ...earlier, variant: 'other' }, { ...earlier, next_ib: true }];
  assert.deepEqual(flavourHistory(anchor, records.values()), [anchor, earlier]);
});
