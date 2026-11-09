import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMatrix } from '../src/Utils/matrixSummary.js';
const marker = (status, children = '420') => ({ props: { 'data-result-status': status, children } });
test('counts results, not numeric test totals or tooltip copies', () => {
  const tree = { props: { overlay: marker('danger'), children: [marker('success'), marker('danger'), marker('warning')] } };
  assert.deepEqual(summarizeMatrix(tree), { success: 1, danger: 1, warning: 1, secondary: 0, info: 0 });
});
test('missing results never become passing results', () => {
  assert.deepEqual(summarizeMatrix([null, false, '—']), { success: 0, danger: 0, warning: 0, secondary: 0, info: 0 });
});
test('tracks pending and unknown outcomes separately from success', () => {
  assert.deepEqual(summarizeMatrix([marker('info'), marker('secondary')]), { success: 0, danger: 0, warning: 0, secondary: 1, info: 1 });
});
