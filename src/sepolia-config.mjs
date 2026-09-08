import { sepolia } from 'viem/chains';
// ETHOnline dedicated deployment, verified 2026-09-08, NOT the general beta.
// https://feature-permres-inode-refact.docs-bao.pages.dev/learn/deployments#sepolia-ensv2-beta
export const SEPOLIA_CHAIN_ID = '0xaa36a7';
export const PUBLIC_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
export const ENS_DEPLOYMENTS = Object.freeze({
  PermissionedResolverImpl: '0xa9d3814ab151bf6e37a427432795371a8361614e',
  VerifiableFactory: '0x894bc9cc8ff1ad96b8a288c86a8c71d662c07780',
  ETHRegistrar: '0x7d1b7f586a62ac3f54b9a396849757814283270b',
  MockUSDC: '0xcbfd80f74375c54e545af34788ff465f96f66f05',
  ETHRegistry: '0x1d78834d97c1d7b1a38c1dedbd1a287cfed3971e',
  UniversalResolver: '0xd26f2040d083af1cd2962ba303f4bea0c4faf142',
});
export const HACKATHON_SEPOLIA = Object.freeze({
  ...sepolia,
  contracts: { ...sepolia.contracts, ensUniversalResolver: { address: ENS_DEPLOYMENTS.UniversalResolver } },
});
