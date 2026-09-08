import { pathToFileURL } from 'node:url';
import {
  ContractFunctionRevertedError, createPublicClient, getAddress,
  http, isAddress, keccak256, stringToHex, toHex, zeroAddress, zeroHash,
} from 'viem';
import { sepolia } from 'viem/chains';
import { normalize, packetToBytes } from 'viem/ens';
import resolverAbi from '../src/abi/permissioned-resolver.json' with { type: 'json' };
import registryAbi from '../src/abi/eth-registry.json' with { type: 'json' };
import factoryAbi from '../src/abi/verifiable-factory.json' with { type: 'json' };
import { ENS_DEPLOYMENTS, PUBLIC_RPC, HACKATHON_SEPOLIA } from '../src/sepolia-config.mjs';

export const DEFAULTS = Object.freeze({
  name: 'relaydesk2026.eth',
  volunteer: '0xd1e7194c2f5a6503b6e9599c7a6ba4c807b90836',
  url: 'https://example.org/relaydesk-negative-check',
});
const TEXT = 1n << 4n;
// Official RegistryRolesLib, contracts-v2 commit 97a57293f3b4279d94b571e678edb53ce62638f4.
const SET_RESOLVER = 1n << 24n;
const SET_RESOLVER_ADMIN = SET_RESOLVER << 128n;
const UNAUTHORIZED = 'EACUnauthorizedAccountRoles';

const universalResolverAddress = ENS_DEPLOYMENTS.UniversalResolver;
function parseOptions(input) {
  if (!['allowed', 'denied'].includes(input.expect)) throw new Error('Explicit --expect=allowed or --expect=denied is required.');
  const options = { ...DEFAULTS, ...input };
  if (typeof options.name !== 'string' || options.name.length > 255) throw new Error('A single .eth name is required.');
  options.name = normalize(options.name.trim());
  if (!/^[^.]+\.eth$/.test(options.name)) throw new Error('A single .eth name is required for registry checks.');
  if (!isAddress(options.volunteer) || options.volunteer.toLowerCase() === zeroAddress) throw new Error('Volunteer must be a nonzero Ethereum address.');
  options.volunteer = getAddress(options.volunteer);
  if (typeof options.url !== 'string' || options.url.length > 2048) throw new Error('The simulated URL must be a valid HTTPS URL.');
  const url = new URL(options.url);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('The simulated URL must use HTTPS without credentials.');
  options.url = url.href;
  return options;
}

export function parseArgs(args) {
  const options = {};
  for (const arg of args) {
    const match = /^--(expect|name|volunteer|url)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(options, match[1])) throw new Error(`Unknown, duplicate, or malformed argument: ${arg}`);
    options[match[1]] = match[2];
  }
  return parseOptions(options);
}

// Error text and error.name alone are not authorization evidence. Viem must
// actually decode the exact custom error from the official resolver ABI.
export function isUnauthorizedRevert(error) {
  const seen = new Set();
  for (let current = error; current && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (current instanceof ContractFunctionRevertedError && current.data?.errorName === UNAUTHORIZED) return true;
  }
  return false;
}

export async function checkLiveHandover(input = {}) {
  const { expect, name, volunteer, url } = parseOptions(input);
  const client = input.client || createPublicClient({
    chain: HACKATHON_SEPOLIA, ccipRead: false,
    transport: http(PUBLIC_RPC, { timeout: 15_000, retryCount: 0 }),
  });
  const report = {
    timestamp: new Date().toISOString(), deployment: 'ethonline-2026', universalResolverAddress,
    permissionScope: 'url key across entire resolver; no per-name isolation claim', chainId: null, expect, name, volunteer,
    actualResolver: null, actualUrl: null, simulatedUrl: url, roles: null,
    registry: null, simulations: null, results: {}, overallPass: false,
  };
  async function requireSepolia() {
    const chainId = await client.getChainId(); report.chainId = chainId;
    if (chainId !== sepolia.id || (client.chain && client.chain.id !== sepolia.id)) throw new Error('Only Ethereum Sepolia (11155111) is permitted.');
  }
  try {
    await requireSepolia();
    const resolved = await client.getEnsResolver({ name, universalResolverAddress });
    if (!resolved || !isAddress(resolved) || resolved.toLowerCase() === zeroAddress) throw new Error('The name has no current ENS resolver.');
    const resolver = getAddress(resolved); report.actualResolver = resolver;
    const code = await client.getBytecode({ address: resolver });
    if (!code || code === '0x') throw new Error('The current ENS resolver has no bytecode.');
    const implementation = await client.readContract({ address: ENS_DEPLOYMENTS.VerifiableFactory, abi: factoryAbi,
      functionName: 'verifyContract', args: [resolver] });
    if (typeof implementation !== 'string' || implementation.toLowerCase() !== ENS_DEPLOYMENTS.PermissionedResolverImpl) {
      throw new Error('Resolver is not a verified dedicated hackathon implementation.');
    }
    report.actualUrl = await client.getEnsText({ name, key: 'url', universalResolverAddress }) ?? null;
    const dnsName = toHex(packetToBytes(name));
    const scopes = { root: 0n, key: BigInt(keccak256(stringToHex('url'))) };
    const entries = await Promise.all(Object.entries(scopes).map(async ([scope, id]) => {
      const bits = await client.readContract({ address: resolver, abi: resolverAbi, functionName: 'roles', args: [id, volunteer] });
      if (typeof bits !== 'bigint' || bits < 0n) throw new Error(`Invalid ${scope} resolver role response.`);
      return [scope, { resource: toHex(id), bits: toHex(bits) }];
    }));
    report.roles = Object.fromEntries(entries);
    const tokenId = await client.readContract({ address: ENS_DEPLOYMENTS.ETHRegistry, abi: registryAbi, functionName: 'findTokenId', args: [name.slice(0, -4)] });
    if (typeof tokenId !== 'bigint' || tokenId < 0n) throw new Error('Invalid registry token ID response.');
    const registryChecks = [
      ['canSetResolver', 'hasRoles', [tokenId, SET_RESOLVER, volunteer]],
      ['rootCanSetResolver', 'hasRootRoles', [SET_RESOLVER, volunteer]],
      ['canAdminSetResolver', 'hasRoles', [tokenId, SET_RESOLVER_ADMIN, volunteer]],
      ['rootCanAdminSetResolver', 'hasRootRoles', [SET_RESOLVER_ADMIN, volunteer]],
    ];
    const permissions = await Promise.all(registryChecks.map(async ([key, functionName, args]) => {
      const value = await client.readContract({ address: ENS_DEPLOYMENTS.ETHRegistry, abi: registryAbi, functionName, args });
      if (typeof value !== 'boolean') throw new Error(`Invalid registry permission response: ${key}.`);
      return [key, value];
    }));
    report.registry = { address: ENS_DEPLOYMENTS.ETHRegistry, tokenId: tokenId.toString(),
      ...Object.fromEntries(permissions), hasBypassAuthority: permissions.some(([, value]) => value) };
    async function probe(key) {
      try {
        await client.simulateContract({ address: resolver, abi: resolverAbi, functionName: 'setText',
          args: [dnsName, key, url], account: volunteer, chain: HACKATHON_SEPOLIA, value: 0n });
        return { outcome: 'allowed' };
      } catch (error) {
        if (isUnauthorizedRevert(error)) return { outcome: 'denied', errorName: UNAUTHORIZED };
        return { outcome: 'error', error: error.shortMessage || error.message || 'Unknown simulation error' };
      }
    }
    const [urlResult, descriptionResult] = await Promise.all([probe('url'), probe('description')]);
    report.simulations = { url: urlResult, description: descriptionResult };
    await requireSepolia();
    const latestResolver = await client.getEnsResolver({ name, universalResolverAddress });
    report.results = {
      urlPermission: urlResult.outcome === expect,
      wrongKeyDenied: descriptionResult.outcome === 'denied',
      scopedRoles: entries.every(([scope, { bits }]) => BigInt(bits) === (expect === 'allowed' && scope === 'key' ? TEXT : 0n)),
      registryNoBypass: report.registry.hasBypassAuthority === false,
      resolverStable: typeof latestResolver === 'string' && latestResolver.toLowerCase() === resolver.toLowerCase(),
      chainStable: true,
    };
    report.overallPass = Object.values(report.results).every(Boolean);
  } catch (error) {
    report.error = error.shortMessage || error.message || 'Read-only verification failed.';
    report.overallPass = false;
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await checkLiveHandover(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.overallPass ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), overallPass: false, error: error.message }, null, 2)}\n`);
    process.exitCode = 2;
  }
}
