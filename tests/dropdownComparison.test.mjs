import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dropdownComparison} from '../src/Utils/dropdownComparison.js';
const item=(count,extra={})=>({arch:'el9_amd64_gcc14',gpu:'nvidia-T4',done:true,passed:count?false:true,details:{num_failed:count,num_passed:12-count},...extra});
const ib={release_queue:'CMSSW_20_1_X'}, previous={...ib,release_name:'previous',gpu_data:{relvals:{T4:item(4)}}};
const context={latest:true,previous};
test('GPU dropdown compares exact device and architecture, ignoring build-specific log paths',()=>{
  const delta=dropdownComparison(ib,context,'gpu_data','relvals','T4',{T4:item(2,{release_name:'current',file:'new.log'})});
  assert.equal(delta.metrics[0].delta,-2);
  assert.equal(delta.baseline,'previous');
});
test('never substitutes another architecture, device, flavour or named result',()=>{
  for(const extra of [{arch:'el9_aarch64_gcc14'},{gpu:'amd-MI250'}])
    assert.equal(dropdownComparison(ib,context,'gpu_data','relvals','T4',{T4:item(2,extra)}),null);
  assert.equal(dropdownComparison({...ib,release_queue:'CMSSW_20_1_ASAN_X'},context,'gpu_data','relvals','T4',{T4:item(2)}),null);
  assert.equal(dropdownComparison(ib,context,'gpu_data','relvals','other',{other:item(2)}),null);
});
test('older builds, missing baselines, and running results suppress comparison',()=>{
  for(const ctx of [{latest:false,previous},{latest:true}])
    assert.equal(dropdownComparison(ib,ctx,'gpu_data','relvals','T4',{T4:item(2)}),null);
  assert.equal(dropdownComparison(ib,context,'gpu_data','relvals','T4',{T4:item(2,{done:false})}),null);
});
test('RNTuple prefix maps to original key without crossing sections',()=>{
  const current={cpu:{arch:'el9_amd64_gcc14',other:'rntuple/cpu',done:true,details:{num_failed:2,num_passed:10}}};
  const old={...current.cpu,details:{num_failed:5,num_passed:7}};
  const ctx={latest:true,previous:{...ib,release_name:'previous',other_data:{relvals:{'rntuple/cpu':old}}}};
  assert.equal(dropdownComparison(ib,ctx,'other_data','relvals','cpu',current).metrics[0].delta,-3);
});
