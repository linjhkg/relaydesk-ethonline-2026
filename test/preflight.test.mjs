import test from 'node:test';
import assert from 'node:assert/strict';
import { runPreflight } from '../scripts/sepolia-preflight.mjs';

function fakeRpc(overrides = {}) {
  const methods = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    methods.push(request.method);
    const defaults = { eth_chainId: '0xaa36a7', eth_blockNumber: '0xabc', eth_getCode: '0x60016000' };
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: request.id, result: { ...defaults, ...overrides }[request.method] }),
    };
  };
  return { fetchImpl, methods };
}

test('preflight permits only read methods and checks all deployment bytecodes', async () => {
  const mock = fakeRpc();
  const result = await runPreflight(mock);
  assert.equal(result.contracts.length, 3);
  assert.equal(result.contracts[0].codeBytes, 4);
  assert.deepEqual(mock.methods, ['eth_chainId', 'eth_blockNumber', 'eth_getCode', 'eth_getCode', 'eth_getCode']);
  assert.match(result.evidence, /existence only/);
});

test('wrong network fails before any contract lookup', async () => {
  const mock = fakeRpc({ eth_chainId: '0x1' });
  await assert.rejects(runPreflight(mock), /not Ethereum Sepolia/);
  assert.deepEqual(mock.methods, ['eth_chainId']);
});

test('empty code or malformed responses cannot appear as success', async () => {
  await assert.rejects(runPreflight(fakeRpc({ eth_getCode: '0x' })), /No valid deployed bytecode/);
  await assert.rejects(runPreflight(fakeRpc({ eth_chainId: undefined })), /Missing result/);
  await assert.rejects(runPreflight(fakeRpc({ eth_blockNumber: 'not-a-block' })), /Invalid block number/);
  await assert.rejects(runPreflight({ fetchImpl: async () => ({ ok: false, status: 429 }) }), /HTTP 429/);
});
