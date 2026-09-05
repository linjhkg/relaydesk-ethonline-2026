import { createPublicClient, http, isAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { getReceipt } from './ens-receipt.mjs';
import { PUBLIC_RPC, ENS_DEPLOYMENTS } from './sepolia-config.mjs';

const client = createPublicClient({chain:sepolia,ccipRead:false,transport:http(PUBLIC_RPC,{timeout:15000,retryCount:0})});
const selectors = new Map([
  [ENS_DEPLOYMENTS.MockUSDC.toLowerCase(), ['0x40c10f19', '0x095ea7b3']],
  [ENS_DEPLOYMENTS.VerifiableFactory.toLowerCase(), ['0x5d84121a']],
  [ENS_DEPLOYMENTS.ETHRegistrar.toLowerCase(), ['0xf14fcbc8', '0xcff3e7c2']],
]);

// Verifies transaction identity, not registration completion. The UI must inspect
// actual token/registry/resolver state after a successful receipt.
export async function getRegistrationReceipt({hash,expected}={},publicClient=client) {
  if(!expected || !isAddress(expected.from || '') || !isAddress(expected.to || '')
    || expected.chainId !== '0xaa36a7' || expected.value !== '0x0'
    || typeof expected.data !== 'string' || !/^0x(?:[0-9a-f]{2}){4,}$/i.test(expected.data)
    || !selectors.get(expected.to.toLowerCase())?.includes(expected.data.slice(0,10).toLowerCase())) {
    throw new Error('Invalid registration transaction expectation.');
  }
  const receipt=await getReceipt({hash},publicClient);
  if(receipt.status==='pending') return {...receipt,transactionVerified:false};
  const tx=await publicClient.getTransaction({hash});
  if(tx.from?.toLowerCase()!==expected.from.toLowerCase()
    || tx.to?.toLowerCase()!==expected.to.toLowerCase()
    || tx.input?.toLowerCase()!==expected.data.toLowerCase()
    || tx.value!==0n || tx.chainId!==sepolia.id) {
    throw new Error('Mined transaction does not match the reviewed registration request.');
  }
  return {...receipt,transactionVerified:true};
}
