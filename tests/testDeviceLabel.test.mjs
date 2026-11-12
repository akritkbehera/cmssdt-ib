import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testDeviceLabel} from '../src/Utils/testDeviceLabel.js';
test('GPU models retain company names and capitalize without changing architecture paths',()=>{
  assert.deepEqual(testDeviceLabel('nvidia_l4/CUDART/el9_amd64_gcc14'),{model:'NVIDIA_L4',path:'CUDART/el9_amd64_gcc14'});
  assert.deepEqual(testDeviceLabel('amd_mi300x/el9_amd64_gcc14'),{model:'AMD_MI300X',path:'el9_amd64_gcc14'});
  assert.deepEqual(testDeviceLabel('NVIDIA T4'),{model:'NVIDIA_T4',path:''});
  assert.deepEqual(testDeviceLabel('AMD/mi250/el9_amd64_gcc14'),{model:'AMD_MI250',path:'el9_amd64_gcc14'});
});
test('non-GPU identifiers preserve their spelling',()=>{
  assert.deepEqual(testDeviceLabel('cpu/el9_amd64_gcc14','rntuple'),{model:'cpu',path:'el9_amd64_gcc14'});
});
