import test from 'node:test';
import assert from 'node:assert/strict';
import { getRegistrationReceipt } from '../src/registration-receipt.mjs';
import { ENS_DEPLOYMENTS } from '../src/sepolia-config.mjs';
import { TransactionReceiptNotFoundError } from 'viem';

const hash=`0x${'a'.repeat(64)}`;
const expected={from:`0x${'1'.repeat(40)}`,to:ENS_DEPLOYMENTS.MockUSDC,data:'0x40c10f19',chainId:'0xaa36a7',value:'0x0'};
const matching={from:expected.from,to:expected.to,input:expected.data,chainId:11155111,value:0n};
const mock=(tx=matching)=>({getChainId:async()=>11155111,getTransactionReceipt:async()=>({status:'success',blockNumber:42n}),getTransaction:async()=>tx});

test('matching receipt proves exact request bytes, not registration completion',async()=>{
  const result=await getRegistrationReceipt({hash,expected},mock());
  assert.equal(result.transactionVerified,true); assert.equal(result.status,'success');
  assert.equal(result.registered,undefined);
});
test('different sender, target, input, value or network cannot advance a pending step',async()=>{
  for(const change of [{from:`0x${'2'.repeat(40)}`},{to:`0x${'2'.repeat(40)}`},{input:'0x095ea7b3'},{value:1n},{chainId:1}]) {
    await assert.rejects(getRegistrationReceipt({hash,expected},mock({...matching,...change})),/does not match/);
  }
});
test('arbitrary transaction expectations and wrong chain are rejected',async()=>{
  await assert.rejects(getRegistrationReceipt({hash,expected:{...expected,to:`0x${'3'.repeat(40)}`}},mock()),/Invalid registration/);
  await assert.rejects(getRegistrationReceipt({hash,expected:{...expected,value:'0x1'}},mock()),/Invalid registration/);
  await assert.rejects(getRegistrationReceipt({hash,expected}, {...mock(),getChainId:async()=>1}),/not Ethereum Sepolia/);
});
test('pending receipts are not verified and do not query an unmined transaction',async()=>{
  const client={...mock(),getTransactionReceipt:async()=>{throw new TransactionReceiptNotFoundError({hash});},getTransaction:async()=>{throw Error('should not query');}};
  const result=await getRegistrationReceipt({hash,expected},client);
  assert.equal(result.status,'pending'); assert.equal(result.transactionVerified,false);
});
