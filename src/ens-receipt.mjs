import { createPublicClient, http, TransactionReceiptNotFoundError } from 'viem';
import { sepolia } from 'viem/chains';
import { PUBLIC_RPC } from './sepolia-config.mjs';

const client = createPublicClient({ chain: sepolia, transport: http(PUBLIC_RPC, { timeout: 15000, retryCount: 0 }), ccipRead: false });

export async function getReceipt({ hash } = {}, publicClient = client) {
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Invalid transaction hash.');
  if (await publicClient.getChainId() !== sepolia.id) throw new Error('Receipt RPC is not Ethereum Sepolia.');
  const common = { hash, explorerUrl: `https://sepolia.etherscan.io/tx/${hash}` };
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    if (!['success', 'reverted'].includes(receipt.status)) throw new Error('Unknown receipt status.');
    return { ...common, status: receipt.status, blockNumber: receipt.blockNumber.toString() };
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return { ...common, status: 'pending' };
    throw error;
  }
}
