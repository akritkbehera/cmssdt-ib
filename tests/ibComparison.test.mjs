import test from 'node:test';
import assert from 'node:assert/strict';
import { ibIdentity, buildComparisonIndex, compareCell } from '../src/Utils/ibComparison.js';
const arch='el9_amd64_gcc15';
const stage=(passed,count,extra={})=>({arch,passed,done:true,details:{num_failed:count},...extra});
const ib=(time,queue='CMSSW_20_1_X',result=stage(false,2))=>({isIB:true,next_ib:false,release_queue:queue,release_name:`${queue}_${time}`,ib_date:time,tests_archs:[arch],utests:result?[result]:[]});
test('latest uses full dataset, independent of input or visible order',()=>{
 const old=ib('2026-11-05-1100'), latest=ib('2026-11-05-2300'), oldest=ib('2026-11-04-2300');
 const index=buildComparisonIndex([old,latest,oldest]);
 assert.equal(index.get(latest).previous,old); assert.equal(index.get(old).latest,false);
 assert.equal(compareCell(old,index.get(old),'utests',arch),null);
 assert.equal(buildComparisonIndex([latest,oldest,old]).get(latest).previous,old);
});
test('ASAN, UBSAN, normal and other release queues never mix',()=>{
 const normal=ib('2026-11-05-2300'), asan=ib('2026-11-05-2300','CMSSW_20_1_ASAN_X'), ubsan=ib('2026-11-05-1100','CMSSW_20_1_UBSAN_X'), other=ib('2026-11-05-1100','CMSSW_20_0_X');
 const index=buildComparisonIndex([normal,asan,ubsan,other]);
 for(const item of [normal,asan,ubsan,other]) assert.equal(index.get(item).previous,undefined);
});
test('does not skip the immediately preceding IB with missing results',()=>{
 const a=ib('2026-11-05-2300'), b=ib('2026-11-05-1100','CMSSW_20_1_X',null), c=ib('2026-11-04-2300');
 const index=buildComparisonIndex([c,b,a]); assert.equal(index.get(a).previous,b);
 assert.equal(compareCell(a,index.get(a),'utests',arch),null);
});
test('configuration mismatch and duplicate cell keys suppress comparisons',()=>{
 const a=ib('2026-11-05-2300'), b=ib('2026-11-05-1100');
 a.utests[0].configuration='Full10'; b.utests[0].configuration='Full11';
 let index=buildComparisonIndex([a,b]); assert.equal(compareCell(a,index.get(a),'utests',arch),null);
 b.utests=[{...a.utests[0]},{...a.utests[0]}]; index=buildComparisonIndex([a,b]);
 assert.equal(compareCell(a,index.get(a),'utests',arch),null);
});
test('equal timestamps are deterministic and suppress ambiguous baselines',()=>{
 const a=ib('2026-11-05-2300'), b=ib('2026-11-05-2300');
 assert.match(buildComparisonIndex([a,b]).get(a).reason,/Ambiguous/);
});
test('validated fallback timestamp and mismatched queue names',()=>{
 const a=ib('2026-11-05-2300'); delete a.ib_date; assert.ok(ibIdentity(a));
 a.release_queue='CMSSW_20_1_ASAN_X'; assert.equal(ibIdentity(a),null);
 assert.equal(ibIdentity(ib('2026-02-30-2300')),null);
});
test('different compiler and running results cannot produce a delta',()=>{
 const a=ib('2026-11-05-2300'), b=ib('2026-11-05-1100'); b.utests[0].arch='el9_amd64_gcc14';
 let index=buildComparisonIndex([a,b]); assert.equal(compareCell(a,index.get(a),'utests',arch),null);
 b.utests[0].arch=arch; a.utests[0].done=false; index=buildComparisonIndex([a,b]);
 assert.equal(compareCell(a,index.get(a),'utests',arch),null);
});
test('backend ib_date sequence suffix is ordered without losing the timestamp',()=>{
 const current=ib('2026-11-05-2300'), previous=ib('2026-11-05-1100');
 current.ib_date += '-0000'; previous.ib_date += '-0000';
 const index=buildComparisonIndex([previous,current]);
 assert.equal(index.get(current).previous,previous);
 assert.equal(index.get(previous).latest,false);
});
