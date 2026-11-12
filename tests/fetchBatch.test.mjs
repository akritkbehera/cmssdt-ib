import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchBatch} from '../src/Utils/fetchBatch.js';
import {memoizeLast} from '../src/Utils/memoizeLast.js';

test('batch starts immediately, bounds concurrency, reports partial ordered results',async()=>{
  let active=0,peak=0; const releases=new Map(),progress=[];
  const task=fetchBatch(['a','b','c'],url=>new Promise(resolve=>{active++;peak=Math.max(peak,active);releases.set(url,()=>{active--;resolve(url);});}),
    {concurrency:2,onProgress:(rows,info)=>progress.push({rows,info})});
  assert.equal(releases.size,2,'no artificial request-start delay');
  releases.get('b')(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(progress[0].info.completed,1);assert.equal(progress[0].rows[1],'b');assert.equal(progress[0].rows[0],undefined);
  releases.get('a')();releases.get('c')();
  assert.deepEqual(await task,['a','b','c']); assert.equal(peak,2);
});
test('failed batch rejects once and never launches queued requests',async()=>{
  const starts=[];
  await assert.rejects(fetchBatch(['a','b','c'],async url=>{starts.push(url);throw Error('offline');},{concurrency:1}),/offline/);
  assert.deepEqual(starts,['a']);
});
test('cancelled batches suppress late progress and queued requests',async()=>{
  const controller=new AbortController();let resolve,progress=0,starts=0;
  const promise=fetchBatch(['a','b'],()=>{starts++;return new Promise(done=>resolve=done);},{concurrency:1,signal:controller.signal,onProgress:()=>progress++});
  controller.abort();resolve('a');await assert.rejects(promise,{name:'AbortError'});
  assert.equal(progress,0);assert.equal(starts,1);
});
test('memoized derivations reuse unchanged input and invalidate changed references',()=>{
  let runs=0;const cached=memoizeLast((...args)=>({args,run:++runs}));const data=[];
  const first=cached(data,'filter');assert.equal(cached(data,'filter'),first);
  assert.notEqual(cached(data,'other'),first);assert.equal(runs,2);
  assert.notEqual(cached([],'other'),first);assert.equal(runs,3);
});
