import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyCards} from '../src/Utils/flavourHistory.js';
const ib = (queue, stamp) => ({isIB:true,release_queue:queue,release_name:queue+'_'+stamp});
test('date cards retain exact time subgroups within newest first days', () => {
  const a=ib('CMSSW_20_1_X','2026-11-09-2300'), b=ib('CMSSW_20_1_UBSAN_X','2026-11-09-2300');
  const c=ib('CMSSW_20_1_X','2026-11-06-1100'), d=ib('CMSSW_20_1_UBSAN_X','2026-11-06-1100');
  const groups=historyCards([c,d,a,b],[a.release_name,b.release_name]);
  assert.deepEqual(groups.map(g=>g.title),['2026-11-09','2026-11-06']);
  assert.deepEqual(groups[0].builds,[a,b]);
});
test('without a shared timestamp only latest builds form a fallback card', () => {
  const a=ib('CMSSW_20_1_X','2026-11-09-2300'), b=ib('CMSSW_20_1_UBSAN_X','2026-11-06-2300'), old=ib('CMSSW_20_1_X','2026-11-04-2300');
  const groups=historyCards([a,b,old],[a.release_name,b.release_name]);
  assert.equal(groups.length,1); assert.equal(groups[0].differentTimes,true);
  assert.deepEqual(groups[0].builds,[a,b]);
});
test('single flavour keeps every date rather than falling back', () => {
  const groups=historyCards([ib('CMSSW_20_1_X','2026-11-09-2300'),ib('CMSSW_20_1_X','2026-11-06-2300')]);
  assert.equal(groups.length,2); assert.ok(groups.every(g=>!g.differentTimes));
});
