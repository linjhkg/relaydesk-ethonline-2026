import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEPOLIA_CHAIN_ID, PUBLIC_RPC, ENS_DEPLOYMENTS } from '../src/sepolia-config.mjs';

// Read-only chain reachability/code-existence check. Does NOT prove ENS functionality.
export async function runPreflight({ fetchImpl = fetch } = {}) {
  let id = 0;
  async function rpc(method, params = []) {
    const requestId = ++id;
    const response = await fetchImpl(PUBLIC_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const message = await response.json();
    if (message.id !== requestId || message.jsonrpc !== '2.0') throw new Error('Invalid RPC response envelope.');
    if (message.error) throw new Error(`RPC rejected ${method}: ${message.error.message || 'unknown error'}`);
    if (typeof message.result !== 'string') throw new Error(`Missing result for ${method}.`);
    return message.result;
  }
  const chainId = await rpc('eth_chainId');
  if (chainId.toLowerCase() !== SEPOLIA_CHAIN_ID) throw new Error('RPC is not Ethereum Sepolia.');
  const block = await rpc('eth_blockNumber');
  if (!/^0x[0-9a-f]+$/i.test(block)) throw new Error('Invalid block number.');
  const contracts = await Promise.all(Object.entries(ENS_DEPLOYMENTS).map(async ([name, address]) => {
    const code = await rpc('eth_getCode', [address, block]);
    if (!/^0x(?:[0-9a-f]{2})+$/i.test(code)) throw new Error(`No valid deployed bytecode for ${name}.`);
    return { name, address, codeBytes: (code.length - 2) / 2 };
  }));
  return {
    checkedAt: new Date().toISOString(), network: 'Ethereum Sepolia', chainId,
    block, rpc: PUBLIC_RPC, contracts,
    evidence: 'READ-ONLY: network and bytecode existence only; no name registration, permissions or transactions verified.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runPreflight(), null, 2)); }
  catch (error) { console.error(`Sepolia preflight failed: ${error.message}`); process.exitCode = 1; }
}
