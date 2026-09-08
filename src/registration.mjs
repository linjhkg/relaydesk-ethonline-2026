import {
  createPublicClient, encodeFunctionData, formatUnits, getAddress, http,
  isAddress, parseEventLogs, zeroAddress, zeroHash,
} from 'viem';
import { sepolia } from 'viem/chains';
import { normalize } from 'viem/ens';
import registrarAbi from './abi/eth-registrar.json' with { type: 'json' };
import factoryAbi from './abi/verifiable-factory.json' with { type: 'json' };
import tokenAbi from './abi/mock-usdc.json' with { type: 'json' };
import registryAbi from './abi/eth-registry.json' with { type: 'json' };
import resolverAbi from './abi/permissioned-resolver.json' with { type: 'json' };
import { ENS_DEPLOYMENTS, PUBLIC_RPC, SEPOLIA_CHAIN_ID } from './sepolia-config.mjs';

const DURATION = 31_536_000n;
const BUDGET = 25_000_000n;
const TEXT_ROLES = (1n << 132n) | (1n << 4n);
const CONTRACTS = Object.freeze({
  mockUsdc: ENS_DEPLOYMENTS.MockUSDC,
  factory: ENS_DEPLOYMENTS.VerifiableFactory,
  registrar: ENS_DEPLOYMENTS.ETHRegistrar,
  impl: ENS_DEPLOYMENTS.PermissionedResolverImpl,
  registry: ENS_DEPLOYMENTS.ETHRegistry,
});

export class RegistrationError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RegistrationError';
    this.code = code;
  }
}

function fail(code, message, cause) { throw new RegistrationError(code, message, cause); }
function sameAddress(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && left.toLowerCase() === right.toLowerCase();
}
function address(value, field) {
  if (typeof value !== 'string' || !isAddress(value) || sameAddress(value, zeroAddress)) {
    fail('INVALID_ADDRESS', `${field} must be a valid, nonzero Ethereum address.`);
  }
  return getAddress(value);
}
function uint(value, field) {
  if (typeof value !== 'bigint' || value < 0n || value >= 1n << 256n) {
    fail('INVALID_CHAIN_RESPONSE', `${field} could not be verified on Sepolia.`);
  }
  return value;
}
function seconds(value, field) {
  const number = Number(uint(value, field));
  if (!Number.isSafeInteger(number)) fail('INVALID_CHAIN_RESPONSE', `${field} is outside the supported range.`);
  return number;
}
function parsePlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_PLAN', 'A registration plan is required.');
  const owner = address(input.owner, 'Owner');
  if (typeof input.name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.eth$/i.test(input.name)) {
    fail('INVALID_NAME', 'Use one ASCII .eth label of 3–63 letters, digits, or internal hyphens.');
  }
  let name;
  try { name = normalize(input.name); } catch (cause) { fail('INVALID_NAME', 'This label is not a normalized ENS name.', cause); }
  if (typeof input.secret !== 'string' || !/^0x[0-9a-f]{64}$/i.test(input.secret) || sameAddress(input.secret, zeroHash)) {
    fail('INVALID_SECRET', 'The commitment secret must be 32 nonzero random bytes.');
  }
  if (typeof input.salt !== 'string' || !/^0x[0-9a-f]{1,64}$/i.test(input.salt)) {
    fail('INVALID_SALT', 'The resolver salt must be a uint256 hex value.');
  }
  const resolver = input.resolver == null ? null : address(input.resolver, 'Resolver');
  const deploymentHash = input.deploymentHash ?? null;
  if ((resolver || deploymentHash != null)
    && (typeof deploymentHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(deploymentHash) || sameAddress(deploymentHash, zeroHash))) {
    fail('DEPLOYMENT_PROOF_REQUIRED', 'A resolver requires its confirmed factory deployment transaction hash.');
  }
  return { owner, name, label: name.slice(0, -4), secret: input.secret, salt: BigInt(input.salt), resolver, deploymentHash };
}
function commitmentArgs(plan) {
  return [plan.label, plan.owner, plan.secret, zeroAddress, plan.resolver, DURATION, zeroHash];
}
function deploymentArgs(plan) {
  const initializer = encodeFunctionData({ abi: resolverAbi, functionName: 'initialize', args: [[{ account: plan.owner, roleBitmap: TEXT_ROLES }], []] });
  return [CONTRACTS.impl, plan.salt, initializer];
}

export function createRegistrationService({ client = createPublicClient({
  chain: sepolia,
  ccipRead: false,
  transport: http(PUBLIC_RPC, { timeout: 15_000, retryCount: 0 }),
}) } = {}) {
  async function requireChain() {
    if (await client.getChainId() !== sepolia.id || (client.chain && client.chain.id !== sepolia.id)) {
      fail('WRONG_CHAIN', 'Registration requires Ethereum Sepolia (11155111).');
    }
  }

  async function verifyDeployment(plan, block) {
    let transaction;
    let receipt;
    try {
      [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash: plan.deploymentHash }),
        client.getTransactionReceipt({ hash: plan.deploymentHash }),
      ]);
    } catch (cause) { fail('DEPLOYMENT_PROOF_MISMATCH', 'The confirmed resolver deployment could not be verified.', cause); }
    const expectedData = encodeFunctionData({ abi: factoryAbi, functionName: 'deployProxy', args: deploymentArgs(plan) });
    if (!transaction || !receipt || transaction.chainId !== sepolia.id
      || !sameAddress(transaction.hash, plan.deploymentHash)
      || !sameAddress(receipt.transactionHash, plan.deploymentHash)
      || !sameAddress(transaction.from, plan.owner) || !sameAddress(receipt.from, plan.owner)
      || !sameAddress(transaction.to, CONTRACTS.factory) || !sameAddress(receipt.to, CONTRACTS.factory)
      || transaction.value !== 0n || !sameAddress(transaction.input, expectedData)
      || receipt.status !== 'success' || !transaction.blockHash
      || !sameAddress(transaction.blockHash, receipt.blockHash)
      || typeof receipt.blockNumber !== 'bigint' || transaction.blockNumber !== receipt.blockNumber
      || (block.number != null && receipt.blockNumber > block.number)) {
      fail('DEPLOYMENT_PROOF_MISMATCH', 'The deployment must be a confirmed official factory call from this wallet with this plan’s exact salt and resolver initializer.');
    }
    let events;
    try {
      events = parseEventLogs({
        abi: factoryAbi, eventName: 'ProxyDeployed', strict: true,
        logs: receipt.logs.filter(log => sameAddress(log.address, CONTRACTS.factory) && !log.removed),
      });
    } catch (cause) { fail('DEPLOYMENT_PROOF_MISMATCH', 'The factory deployment event could not be decoded.', cause); }
    if (events.length !== 1 || !sameAddress(events[0].args.sender, plan.owner)
      || !sameAddress(events[0].args.proxyAddress, plan.resolver)
      || events[0].args.salt !== plan.salt || !sameAddress(events[0].args.implementation, CONTRACTS.impl)) {
      fail('DEPLOYMENT_PROOF_MISMATCH', 'The confirmed factory event does not bind this resolver to this wallet and salt.');
    }
  }

  async function inspectPlan(plan) {
    await requireChain();
    const block = await client.getBlock({ blockTag: 'latest' });
    const chainTimestamp = seconds(block.timestamp, 'Block timestamp');
    const snapshot = block.number == null ? {} : { blockNumber: block.number };
    const read = (contract, abi, functionName, args = []) => client.readContract({
      address: contract, abi, functionName, args, ...snapshot,
    });
    await Promise.all(Object.values(CONTRACTS).map(async contract => {
      if (!contract || !isAddress(contract)) fail('INVALID_DEPLOYMENT', 'Official Sepolia deployment configuration is incomplete.');
      const code = await client.getBytecode({ address: contract, ...snapshot });
      if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) {
        fail('NO_CONTRACT_CODE', 'An official ENSv2 Sepolia contract has no verifiable bytecode.');
      }
    }));
    const ownerCode = await client.getBytecode({ address: plan.owner, ...snapshot });
    if (ownerCode != null && ownerCode !== '0x') {
      fail('OWNER_NOT_EOA', 'This registration flow requires a direct EOA wallet without deployed or delegated code.');
    }
    const [registry, minAge, maxAge, minDuration, decimals, symbol, balance, allowance, available, foundOwner, foundResolver] = await Promise.all([
      read(CONTRACTS.registrar, registrarAbi, 'ETH_REGISTRY'),
      read(CONTRACTS.registrar, registrarAbi, 'MIN_COMMITMENT_AGE'),
      read(CONTRACTS.registrar, registrarAbi, 'MAX_COMMITMENT_AGE'),
      read(CONTRACTS.registrar, registrarAbi, 'MIN_REGISTER_DURATION'),
      read(CONTRACTS.mockUsdc, tokenAbi, 'decimals'),
      read(CONTRACTS.mockUsdc, tokenAbi, 'symbol'),
      read(CONTRACTS.mockUsdc, tokenAbi, 'balanceOf', [plan.owner]),
      read(CONTRACTS.mockUsdc, tokenAbi, 'allowance', [plan.owner, CONTRACTS.registrar]),
      read(CONTRACTS.registrar, registrarAbi, 'isAvailable', [plan.label]),
      read(CONTRACTS.registry, registryAbi, 'findOwner', [plan.label]),
      read(CONTRACTS.registry, registryAbi, 'getResolver', [plan.label]),
    ]);
    if (!sameAddress(registry, CONTRACTS.registry)) fail('REGISTRY_MISMATCH', 'The registrar is not connected to the expected ENSv2 registry.');
    if (decimals !== 6 || symbol !== 'USDC') fail('UNEXPECTED_TOKEN', 'The official MockUSDC token metadata could not be verified.');
    const minCommitmentAge = seconds(minAge, 'Minimum commitment age');
    const maxCommitmentAge = seconds(maxAge, 'Maximum commitment age');
    if (maxCommitmentAge <= minCommitmentAge || uint(minDuration, 'Minimum duration') > DURATION) {
      fail('UNSUPPORTED_CONSTANTS', 'The live registrar bounds do not support this one-year registration flow.');
    }
    if (typeof available !== 'boolean' || !isAddress(foundOwner) || !isAddress(foundResolver)) {
      fail('INVALID_CHAIN_RESPONSE', 'Name availability and registry ownership could not be verified.');
    }
    uint(balance, 'Balance');
    uint(allowance, 'Allowance');
    let price = null;
    // The registrar intentionally reverts when pricing an unavailable name.
    if (available) {
      const quoted = await read(CONTRACTS.registrar, registrarAbi, 'getRegisterPrice', [plan.label, DURATION, CONTRACTS.mockUsdc]);
      if (!Array.isArray(quoted) || quoted.length !== 2) fail('INVALID_CHAIN_RESPONSE', 'The registration price could not be verified.');
      const total = uint(quoted[0], 'Base price') + uint(quoted[1], 'Premium');
      if (total > BUDGET) fail('PRICE_OVER_BUDGET', 'The current one-year price exceeds the 25 MockUSDC test budget. Choose another name.');
      price = { raw: total.toString(), formatted: formatUnits(total, 6), decimals: 6 };
    }
    let commitment = null;
    let commitmentAt = 0;
    if (plan.resolver) {
      await verifyDeployment(plan, block);
      const code = await client.getBytecode({ address: plan.resolver, ...snapshot });
      if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) fail('NO_RESOLVER_CODE', 'The resolver must be deployed before it can be used.');
      let implementation;
      try { implementation = await read(CONTRACTS.factory, factoryAbi, 'verifyContract', [plan.resolver]); }
      catch (cause) { fail('INVALID_RESOLVER_PROOF', 'The official factory could not verify this resolver.', cause); }
      if (!sameAddress(implementation, CONTRACTS.impl)) fail('INVALID_RESOLVER_PROOF', 'The resolver is not a verified proxy of the official PermissionedResolver implementation.');
      const roles = uint(await read(plan.resolver, resolverAbi, 'roles', [0n, plan.owner]), 'Resolver roles');
      if ((roles & TEXT_ROLES) !== TEXT_ROLES) fail('RESOLVER_OWNER_MISMATCH', 'The wallet does not hold both root TEXT and TEXT_ADMIN roles on this resolver.');
      commitment = await read(CONTRACTS.registrar, registrarAbi, 'makeCommitment', commitmentArgs(plan));
      if (typeof commitment !== 'string' || !/^0x[0-9a-f]{64}$/i.test(commitment) || sameAddress(commitment, zeroHash)) {
        fail('INVALID_CHAIN_RESPONSE', 'The registration commitment could not be verified.');
      }
      commitmentAt = seconds(await read(CONTRACTS.registrar, registrarAbi, 'commitmentAt', [commitment]), 'Commitment timestamp');
      if (commitmentAt > chainTimestamp) fail('INVALID_CHAIN_RESPONSE', 'The commitment timestamp is ahead of the inspected block.');
    }
    await requireChain();
    return {
      chainId: sepolia.id, owner: plan.owner, name: plan.name, label: plan.label,
      duration: DURATION.toString(), contracts: { ...CONTRACTS }, price,
      balance: { raw: balance.toString(), formatted: formatUnits(balance, 6) },
      allowanceRaw: allowance.toString(), available, minCommitmentAge, maxCommitmentAge,
      commitment, commitmentAt, readyAt: commitmentAt ? commitmentAt + minCommitmentAge : 0,
      chainTimestamp, resolver: plan.resolver,
      registered: !available && plan.resolver !== null
        && sameAddress(foundOwner, plan.owner) && sameAddress(foundResolver, plan.resolver),
    };
  }

  async function inspect(input) {
    return inspectPlan(parsePlan(input));
  }

  async function prepare(input) {
    const action = input?.action;
    if (!['mint', 'deploy', 'approve', 'commit', 'register'].includes(action)) fail('INVALID_ACTION', 'Choose mint, deploy, approve, commit, or register.');
    const plan = parsePlan(input);
    const inspected = await inspectPlan(plan);
    if (!inspected.available) fail(inspected.registered ? 'ALREADY_REGISTERED' : 'NAME_UNAVAILABLE', inspected.registered
      ? 'The registry already confirms this name belongs to this wallet with this resolver.'
      : 'This name is unavailable; ownership by this wallet has not been confirmed.');
    const cost = BigInt(inspected.price.raw);
    const skipped = summary => ({ status: 'skipped', action, summary, inspected });
    let contract;
    let abi;
    let functionName;
    let args;
    let summary;
    if (action === 'mint') {
      if (BigInt(inspected.balance.raw) >= cost) return skipped('The wallet already has enough MockUSDC for the current price.');
      contract = CONTRACTS.mockUsdc; abi = tokenAbi; functionName = 'mint'; args = [plan.owner, BUDGET];
      summary = 'Mint 25 test-only MockUSDC to the connected Sepolia wallet.';
    } else if (action === 'deploy') {
      if (plan.resolver) return skipped('The supplied resolver is already deployed and verified for this wallet.');
      contract = CONTRACTS.factory; abi = factoryAbi; functionName = 'deployProxy';
      args = deploymentArgs(plan);
      summary = 'Deploy an official PermissionedResolver proxy with TEXT and TEXT_ADMIN roles assigned to this wallet.';
    } else if (action === 'approve') {
      if (BigInt(inspected.balance.raw) < cost) fail('INSUFFICIENT_FUNDS', 'Mint test MockUSDC before approving the registration cost.');
      if (BigInt(inspected.allowanceRaw) === cost) return skipped('The registrar allowance already equals the current registration price.');
      contract = CONTRACTS.mockUsdc; abi = tokenAbi; functionName = 'approve'; args = [CONTRACTS.registrar, cost];
      summary = `Approve exactly ${inspected.price.formatted} MockUSDC for the official ETHRegistrar.`;
    } else {
      if (!plan.resolver) fail('RESOLVER_REQUIRED', 'Deploy and verify a resolver before committing or registering.');
      contract = CONTRACTS.registrar; abi = registrarAbi;
      if (action === 'commit') {
        if (inspected.commitmentAt && inspected.chainTimestamp < inspected.commitmentAt + inspected.maxCommitmentAge) {
          fail('ACTIVE_COMMITMENT', 'This exact registration commitment is already active. Wait for it to mature, or register it.');
        }
        functionName = 'commit'; args = [inspected.commitment];
        summary = `Commit to one year of ${plan.name} ownership for this wallet.`;
      } else {
        if (!inspected.commitmentAt) fail('COMMITMENT_MISSING', 'No on-chain commitment matches this exact registration plan.');
        if (inspected.chainTimestamp < inspected.readyAt) fail('COMMITMENT_TOO_EARLY', 'The on-chain commitment has not reached the minimum age.');
        if (inspected.chainTimestamp >= inspected.commitmentAt + inspected.maxCommitmentAge) fail('COMMITMENT_EXPIRED', 'The commitment expired. Submit a new commitment for this plan.');
        if (BigInt(inspected.balance.raw) < cost) fail('INSUFFICIENT_FUNDS', 'The wallet has insufficient MockUSDC for the current registration price.');
        if (BigInt(inspected.allowanceRaw) < cost) fail('INSUFFICIENT_ALLOWANCE', 'Approve the current registration price before registering.');
        functionName = 'register';
        args = [...commitmentArgs(plan).slice(0, 6), CONTRACTS.mockUsdc, zeroHash];
        summary = `Register ${plan.name} for one year to this wallet, paying ${inspected.price.formatted} MockUSDC.`;
      }
    }
    let simulation;
    try {
      simulation = await client.simulateContract({
        address: contract, abi, functionName, args, account: plan.owner, chain: sepolia, value: 0n,
      });
    } catch (cause) { fail('SIMULATION_REJECTED', 'Sepolia rejected this transaction simulation. Refresh the registration state before retrying.', cause); }
    if (!simulation || (action === 'approve' && simulation.result !== true)) fail('SIMULATION_REJECTED', 'The simulated transaction did not return the expected result.');
    let predicted;
    if (action === 'deploy') {
      if (typeof simulation.result !== 'string' || !isAddress(simulation.result) || sameAddress(simulation.result, zeroAddress)) {
        fail('INVALID_DEPLOYMENT_RESULT', 'The factory simulation did not return a valid resolver address.');
      }
      predicted = getAddress(simulation.result);
      const existingCode = await client.getBytecode({ address: predicted });
      if (existingCode != null && existingCode !== '0x') fail('RESOLVER_ALREADY_DEPLOYED', 'The predicted resolver already has bytecode; inspect that address before continuing.');
    }
    if (action === 'register') uint(simulation.result, 'Simulated registration token');
    await requireChain();
    return {
      status: 'ready', action, inspected, summary,
      ...(predicted ? { resolver: predicted } : {}),
      transaction: { from: plan.owner, to: contract,
        data: encodeFunctionData({ abi, functionName, args }),
        chainId: SEPOLIA_CHAIN_ID, value: '0x0' },
    };
  }

  return { inspect, prepare };
}
