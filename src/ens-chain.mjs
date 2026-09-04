import {
  createPublicClient, encodeAbiParameters, encodeFunctionData, getAddress,
  http, isAddress, keccak256, stringToHex, toHex, zeroAddress, zeroHash,
} from 'viem';
import { sepolia } from 'viem/chains';
import { namehash, normalize, packetToBytes } from 'viem/ens';
import resolverAbi from './abi/permissioned-resolver.json' with { type: 'json' };
import { PUBLIC_RPC } from './sepolia-config.mjs';

export const ENS_CHAIN_ID = sepolia.id;
export const ENS_TEXT_KEY = 'url';
const TEXT = 1n << 4n;
const TEXT_ADMIN = TEXT << 128n;
const CLEAR = 1n << 32n;
const ALIAS = 1n << 28n;
const UPGRADE = 1n << 124n;

export class EnsChainError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'EnsChainError';
    this.code = code;
  }
}

function fail(code, message, cause) { throw new EnsChainError(code, message, cause); }

function parseName(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 1024) {
    fail('INVALID_NAME', 'Enter a valid ENS name.');
  }
  try {
    const name = normalize(input.trim());
    if (!name) fail('INVALID_NAME', 'The ENS root is not an event name.');
    return { name, node: namehash(name), dnsName: toHex(packetToBytes(name)) };
  } catch (cause) {
    fail('INVALID_NAME', 'The ENS name cannot be normalized or DNS encoded.', cause);
  }
}

function parseAddress(value, field) {
  if (typeof value !== 'string' || !isAddress(value) || value.toLowerCase() === zeroAddress) {
    fail('INVALID_ADDRESS', `${field} must be a valid nonzero Ethereum address.`);
  }
  return getAddress(value);
}

function parseUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    fail('INVALID_URL', 'Enter an HTTPS event URL of at most 2048 characters.');
  }
  const candidate = value.trim();
  if (!/^https:\/\/[^/\\?#]/i.test(candidate) || /[\s\\\u0000-\u001f\u007f]/.test(candidate)) {
    fail('INVALID_URL', 'Use a valid HTTPS URL with no whitespace, control characters, or backslashes.');
  }
  let parsed;
  try { parsed = new URL(candidate); } catch { fail('INVALID_URL', 'Enter a complete HTTPS event URL.'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    fail('INVALID_URL', 'The event URL must use HTTPS and contain no credentials.');
  }
  return parsed.href;
}

// Official PermissionedResolverLib.resource and partHash, contracts-v2 commit
// 97a57293f3b4279d94b571e678edb53ce62638f4. Both values are bytes32, not strings.
function resource(node, part) {
  if (node === zeroHash && part === zeroHash) return 0n;
  return BigInt(keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }], [node, part],
  )));
}

export function createEnsService({ client = createPublicClient({
  chain: sepolia,
  ccipRead: false,
  transport: http(process.env.SEPOLIA_RPC_URL || PUBLIC_RPC, { timeout: 15_000, retryCount: 1 }),
}) } = {}) {
  async function requireChain() {
    const chainId = await client.getChainId();
    if (chainId !== ENS_CHAIN_ID || (client.chain && client.chain.id !== ENS_CHAIN_ID)) {
      fail('WRONG_CHAIN', 'ENSv2 testing requires Ethereum Sepolia (11155111).');
    }
  }

  async function inspect({ name } = {}) {
    const parsed = parseName(name);
    await requireChain();
    // Do not cache: the name may have changed resolvers since its last inspection.
    const resolver = await client.getEnsResolver({ name: parsed.name });
    if (!resolver || resolver.toLowerCase() === zeroAddress) {
      fail('NO_RESOLVER', 'This name has no resolvable ENS resolver. It may be unregistered or have no resolver set.');
    }
    const address = parseAddress(resolver, 'Resolver');
    const bytecode = await client.getBytecode({ address });
    if (!bytecode || bytecode === '0x') fail('NO_RESOLVER_CODE', 'The resolved address has no contract bytecode on Sepolia.');
    const url = await client.getEnsText({ name: parsed.name, key: ENS_TEXT_KEY });
    return { chainId: ENS_CHAIN_ID, ...parsed, resolver: address, url: url ?? null, bytecodePresent: true };
  }

  async function inspectPermissions(state, volunteer) {
    const part = keccak256(stringToHex(ENS_TEXT_KEY));
    const scopes = {
      root: 0n,
      name: resource(state.node, zeroHash),
      globalKey: resource(zeroHash, part),
      key: resource(state.node, part),
    };
    try {
      const entries = await Promise.all(Object.entries(scopes).map(async ([scope, id]) => {
        const roles = await client.readContract({ address: state.resolver, abi: resolverAbi,
          functionName: 'roles', args: [id, volunteer] });
        if (typeof roles !== 'bigint' || roles < 0n) throw new Error('Unexpected roles response.');
        return [scope, roles];
      }));
      const roles = Object.fromEntries(entries);
      const broadText = [roles.root, roles.name, roles.globalKey].some(bits => (bits & TEXT) !== 0n)
        || Object.values(roles).some(bits => (bits & TEXT_ADMIN) !== 0n);
      const alternateRoot = ALIAS | UPGRADE | CLEAR;
      const otherAuthority = (roles.root & (alternateRoot | (alternateRoot << 128n))) !== 0n
        || (roles.name & (CLEAR | (CLEAR << 128n))) !== 0n;
      return {
        status: 'known', volunteer,
        roles: Object.fromEntries(entries.map(([scope, bits]) => [scope, toHex(bits)])),
        broadAuthority: broadText || otherAuthority,
        canEditUrl: [roles.root, roles.name, roles.globalKey, roles.key].some(bits => (bits & TEXT) !== 0n),
        scopedUrlRole: (roles.key & TEXT) !== 0n,
      };
    } catch (cause) {
      return { status: 'unknown', volunteer, broadAuthority: null, canEditUrl: null,
        reason: 'The resolver permission scopes could not be verified.' };
    }
  }

  async function prepare({ name, actor, volunteer, action, value } = {}) {
    if (!['grant', 'revoke', 'update'].includes(action)) fail('INVALID_ACTION', 'Choose grant, revoke, or update.');
    const account = parseAddress(actor, 'Actor');
    const delegate = action === 'update'
      && (volunteer == null || (typeof volunteer === 'string' && !volunteer.trim()))
      ? account
      : parseAddress(volunteer, 'Volunteer');
    const url = action === 'update' ? parseUrl(value) : undefined;
    const state = await inspect({ name });
    let alias;
    try {
      // Required interface probe, not an attestation of the deployed implementation.
      alias = await client.readContract({ address: state.resolver, abi: resolverAbi,
        functionName: 'getAlias', args: [state.dnsName] });
    } catch (cause) {
      fail('UNSUPPORTED_RESOLVER', 'This resolver does not expose the required ENSv2 interface.', cause);
    }
    if (alias !== '0x') fail('ALIASED_NAME', 'This name uses resolver aliasing; direct updates would not reliably change the resolved URL.');
    const permissions = await inspectPermissions(state, delegate);
    if (action !== 'update' && permissions.status !== 'known') {
      fail('PERMISSIONS_UNKNOWN', 'Cannot verify the volunteer’s broader permissions. A URL-only handover cannot be prepared safely.');
    }
    if (action !== 'update' && permissions.broadAuthority) {
      fail('BROAD_AUTHORITY', 'The volunteer has broader resolver authority. Changing the URL-specific role would not establish a URL-only handover or remove all URL editing authority.');
    }
    const functionName = action === 'update' ? 'setText' : 'authorizeTextRoles';
    const args = action === 'update'
      ? [state.node, ENS_TEXT_KEY, url]
      : [state.dnsName, ENS_TEXT_KEY, delegate, action === 'grant'];
    let simulation;
    try {
      simulation = await client.simulateContract({ address: state.resolver, abi: resolverAbi,
        functionName, args, account, chain: sepolia });
    } catch (cause) {
      fail('SIMULATION_REJECTED', `Sepolia rejected the ${action} simulation: ${cause.shortMessage || cause.message || 'contract call failed'}`, cause);
    }
    // authorizeTextRoles returns false when the permission was already in that state.
    if (action !== 'update' && simulation.result !== true) {
      fail('NO_PERMISSION_CHANGE', `The ${action} simulation would not change the URL permission.`);
    }
    await requireChain();
    const latestResolver = await client.getEnsResolver({ name: state.name });
    if (latestResolver?.toLowerCase() !== state.resolver.toLowerCase()) {
      fail('RESOLVER_CHANGED', 'The name changed resolvers during preparation. Refresh and prepare again.');
    }
    return {
      status: 'ready', action, state, permissions,
      transaction: { from: account, to: state.resolver,
        data: encodeFunctionData({ abi: resolverAbi, functionName, args }),
        chainId: toHex(ENS_CHAIN_ID), value: '0x0' },
      summary: action === 'update'
        ? `Set ${state.name} text record “url” to ${url}.`
        : `${action === 'grant' ? 'Grant' : 'Revoke'} ${delegate} permission for only ${state.name} text record “url”.`,
      notice: 'Simulation passed; nothing has been signed or broadcast. State may change before the wallet transaction is mined.',
    };
  }

  return { inspect, prepare };
}
