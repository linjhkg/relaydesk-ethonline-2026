import test from 'node:test';
import assert from 'node:assert/strict';
import { TransactionReceiptNotFoundError } from 'viem';
import { getReceipt } from '../src/ens-receipt.mjs';

const hash = `0x${'a'.repeat(64)}`;
const client = receipt => ({ getChainId: async () => 11155111, getTransactionReceipt: async () => receipt });

test('receipt only reports success or revert from an actual returned receipt', async () => {
  assert.equal((await getReceipt({hash}, client({status:'success',blockNumber:50n}))).status,'success');
  assert.equal((await getReceipt({hash}, client({status:'reverted',blockNumber:50n}))).status,'reverted');
});
test('missing receipt is pending but RPC errors are errors', async () => {
  const missing = {...client(null), getTransactionReceipt:async()=>{throw new TransactionReceiptNotFoundError({hash});}};
  assert.equal((await getReceipt({hash},missing)).status,'pending');
  await assert.rejects(getReceipt({hash},{...client(null),getTransactionReceipt:async()=>{throw Error('RPC offline');}}),/RPC offline/);
});
test('receipt validates hash, network and status', async () => {
  await assert.rejects(getReceipt({hash:'invalid'},client(null)),/Invalid transaction hash/);
  await assert.rejects(getReceipt({hash},{...client(null),getChainId:async()=>1}),/not Ethereum Sepolia/);
  await assert.rejects(getReceipt({hash},client({status:'unknown'})),/Unknown receipt/);
});
