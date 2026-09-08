import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, keccak256, zeroAddress, zeroHash } from 'viem';
import { createRegistrationService } from '../src/registration.mjs';
import { ENS_DEPLOYMENTS } from '../src/sepolia-config.mjs';
import registrarAbi from '../src/abi/eth-registrar.json' with { type: 'json' };
import factoryAbi from '../src/abi/verifiable-factory.json' with { type: 'json' };
import tokenAbi from '../src/abi/mock-usdc.json' with { type: 'json' };
import resolverAbi from '../src/abi/permissioned-resolver.json' with { type: 'json' };

const owner = '0x1111111111111111111111111111111111111111';
const resolver = '0x2222222222222222222222222222222222222222';
const other = '0x3333333333333333333333333333333333333333';
const predicted = '0x4444444444444444444444444444444444444444';
const secret = `0x${'ab'.repeat(32)}`;
const salt = `0x${'cd'.repeat(32)}`;
const deploymentHash = `0x${'12'.repeat(32)}`;
const blockHash = `0x${'34'.repeat(32)}`;
const plan = { owner, name: 'RelayDesk2026.eth', secret, salt, resolver, deploymentHash };
const roleBitmap = (1n << 132n) | (1n << 4n);

function deploymentInput({ admin = owner, roles = roleBitmap, setters = [], deployedSalt = BigInt(salt) } = {}) {
  return encodeFunctionData({ abi: factoryAbi, functionName: 'deployProxy', args: [
    ENS_DEPLOYMENTS.PermissionedResolverImpl, deployedSalt,
    encodeFunctionData({ abi: resolverAbi, functionName: 'initialize', args: [[{ account: admin, roleBitmap: roles }], setters] }),
  ] });
}

function deploymentTransaction(overrides = {}) {
  return { hash: deploymentHash, chainId: 11155111, from: owner, to: ENS_DEPLOYMENTS.VerifiableFactory,
    input: deploymentInput(), value: 0n, blockHash, blockNumber: 12300n, ...overrides };
}

function deploymentLog({ sender = owner, proxyAddress = resolver, deployedSalt = BigInt(salt), implementation = ENS_DEPLOYMENTS.PermissionedResolverImpl, ...overrides } = {}) {
  return { address: ENS_DEPLOYMENTS.VerifiableFactory,
    topics: encodeEventTopics({ abi: factoryAbi, eventName: 'ProxyDeployed', args: { sender, proxyAddress } }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }], [deployedSalt, implementation]),
    ...overrides };
}

function deploymentReceipt(overrides = {}) {
  return { transactionHash: deploymentHash, from: owner, to: ENS_DEPLOYMENTS.VerifiableFactory,
    status: 'success', blockHash, blockNumber: 12300n, logs: [deploymentLog()], ...overrides };
}

function hashCommitment(args) {
  return keccak256(encodeAbiParameters([
    { type: 'string' }, { type: 'address' }, { type: 'bytes32' }, { type: 'address' },
    { type: 'address' }, { type: 'uint64' }, { type: 'bytes32' },
  ], args));
}

function fake({ values = {}, methods = {} } = {}) {
  const calls = [];
  const state = {
    ETH_REGISTRY: ENS_DEPLOYMENTS.ETHRegistry,
    MIN_COMMITMENT_AGE: 60n, MAX_COMMITMENT_AGE: 86400n,
    MIN_REGISTER_DURATION: 2419200n, decimals: 6, symbol: 'USDC',
    balanceOf: 25_000_000n, allowance: 8_000_000n, isAvailable: true,
    findOwner: zeroAddress, getResolver: zeroAddress,
    getRegisterPrice: [8_000_000n, 0n], verifyContract: ENS_DEPLOYMENTS.PermissionedResolverImpl,
    roles: roleBitmap, makeCommitment: ({ args }) => hashCommitment(args), commitmentAt: 900n,
    ...values,
  };
  const implementations = {
    getChainId: () => 11155111,
    getBlock: () => ({ number: 12345n, timestamp: 1000n }),
    getBytecode: ({ address }) => [owner, predicted].includes(address) ? '0x' : '0x6000',
    getTransaction: () => deploymentTransaction(),
    getTransactionReceipt: () => deploymentReceipt(),
    readContract: call => {
      if (!(call.functionName in state)) throw new Error(`Unexpected read: ${call.functionName}`);
      const value = state[call.functionName];
      return typeof value === 'function' ? value(call) : value;
    },
    simulateContract: ({ functionName }) => ({
      result: functionName === 'deployProxy' ? predicted : functionName === 'register' ? 42n : functionName === 'approve' ? true : undefined,
    }),
    ...methods,
  };
  const client = { chain: { id: 11155111 } };
  for (const [method, implementation] of Object.entries(implementations)) {
    client[method] = async args => {
      calls.push({ method, ...args });
      return implementation(args);
    };
  }
  return { service: createRegistrationService({ client }), client, calls, state };
}

test('inspect returns JSON-safe live state and computes the exact commitment on chain', async () => {
  const { service, calls } = fake();
  const result = await service.inspect(plan);
  assert.equal(result.chainId, 11155111);
  assert.equal(result.name, 'relaydesk2026.eth');
  assert.equal(result.label, 'relaydesk2026');
  assert.equal(result.owner, owner);
  assert.equal(result.duration, '31536000');
  assert.deepEqual(result.price, { raw: '8000000', formatted: '8', decimals: 6 });
  assert.deepEqual(result.balance, { raw: '25000000', formatted: '25' });
  assert.equal(result.allowanceRaw, '8000000');
  assert.equal(result.commitmentAt, 900);
  assert.equal(result.readyAt, 960);
  assert.equal(result.chainTimestamp, 1000);
  assert.equal(result.available, true);
  assert.equal(result.registered, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(salt), false);
  assert.deepEqual(calls.find(call => call.functionName === 'makeCommitment').args,
    ['relaydesk2026', owner, secret, zeroAddress, resolver, 31536000n, zeroHash]);
  assert.deepEqual(calls.find(call => call.functionName === 'verifyContract').args, [resolver]);
  assert.deepEqual(calls.find(call => call.functionName === 'roles').args, [0n, owner]);
  assert.ok(calls.filter(call => call.method === 'readContract').every(call => call.blockNumber === 12345n));
});

test('inspect without a resolver never fabricates a commitment or ownership', async () => {
  const { service, calls } = fake();
  const result = await service.inspect({ ...plan, resolver: null });
  assert.equal(result.resolver, null);
  assert.equal(result.commitment, null);
  assert.equal(result.commitmentAt, 0);
  assert.equal(result.readyAt, 0);
  assert.equal(result.registered, false);
  assert.equal(calls.some(call => call.functionName === 'verifyContract'), false);
});

test('unavailable names are only registered when owner, resolver, and factory proof all match', async () => {
  for (const values of [
    { findOwner: other, getResolver: resolver },
    { findOwner: owner, getResolver: other },
    { findOwner: zeroAddress, getResolver: zeroAddress },
  ]) {
    const { service, calls } = fake({ values: { ...values, isAvailable: false } });
    const result = await service.inspect(plan);
    assert.equal(result.registered, false);
    assert.equal(result.price, null);
    assert.equal(calls.some(call => call.functionName === 'getRegisterPrice'), false);
    await assert.rejects(service.prepare({ ...plan, action: 'register' }), { code: 'NAME_UNAVAILABLE' });
  }
  const { service } = fake({ values: { isAvailable: false, findOwner: owner, getResolver: resolver } });
  assert.equal((await service.inspect(plan)).registered, true);
  await assert.rejects(service.prepare({ ...plan, action: 'register' }), { code: 'ALREADY_REGISTERED' });
  const invalid = fake({ values: { isAvailable: false, findOwner: owner, getResolver: resolver, verifyContract: other } });
  await assert.rejects(invalid.service.inspect(plan), { code: 'INVALID_RESOLVER_PROOF' });
});

test('invalid plans are rejected before any RPC call', async () => {
  const { service, calls } = fake();
  for (const input of [null, [], 'plan']) await assert.rejects(service.inspect(input), { code: 'INVALID_PLAN' });
  for (const owner of [zeroAddress, null, '0x123', 'wallet']) {
    await assert.rejects(service.inspect({ ...plan, owner }), { code: 'INVALID_ADDRESS' });
  }
  for (const name of ['a.eth', 'ab.eth', 'sub.event.eth', 'event.com', 'BÜCHER.eth', '-event.eth', 'event-.eth', 'ev ent.eth', `${'x'.repeat(64)}.eth`, 'ab--cd.eth']) {
    await assert.rejects(service.inspect({ ...plan, name }), { code: 'INVALID_NAME' });
  }
  for (const secret of [null, zeroHash, '0xab', `0x${'ab'.repeat(33)}`, 'not-secret']) {
    await assert.rejects(service.inspect({ ...plan, secret }), { code: 'INVALID_SECRET' });
  }
  for (const salt of [null, 1, '-1', '0x', `0x${'ab'.repeat(33)}`, '1']) {
    await assert.rejects(service.inspect({ ...plan, salt }), { code: 'INVALID_SALT' });
  }
  for (const deploymentHash of [null, zeroHash, '0x123', 1]) {
    await assert.rejects(service.inspect({ ...plan, deploymentHash }), { code: 'DEPLOYMENT_PROOF_REQUIRED' });
  }
  await assert.rejects(service.prepare({ ...plan, action: 'transfer' }), { code: 'INVALID_ACTION' });
  assert.equal(calls.length, 0);
});

test('wrong network, contract accounts, and missing official code fail closed', async () => {
  const wrong = fake({ methods: { getChainId: () => 1 } });
  await assert.rejects(wrong.service.prepare({ ...plan, action: 'register' }), { code: 'WRONG_CHAIN' });
  assert.equal(wrong.calls.some(call => call.method === 'simulateContract'), false);
  const configured = fake(); configured.client.chain.id = 1;
  await assert.rejects(configured.service.inspect(plan), { code: 'WRONG_CHAIN' });
  for (const ownerCode of ['0x6000', `0xef0100${other.slice(2)}`]) {
    const contractOwner = fake({ methods: { getBytecode: () => ownerCode } });
    await assert.rejects(contractOwner.service.inspect(plan), { code: 'OWNER_NOT_EOA' });
  }
  for (const [name, contract] of Object.entries(ENS_DEPLOYMENTS).filter(([name]) => name !== 'UniversalResolver')) {
    const missing = fake({ methods: { getBytecode: ({ address }) => address === contract ? '0x' : address === owner ? '0x' : '0x6000' } });
    await assert.rejects(missing.service.inspect(plan), { code: 'NO_CONTRACT_CODE' });
  }
});

test('resolver code, returned implementation, and both owner roles are mandatory', async () => {
  const missing = fake({ methods: { getBytecode: ({ address }) => [owner, resolver].includes(address) ? '0x' : '0x6000' } });
  await assert.rejects(missing.service.inspect(plan), { code: 'NO_RESOLVER_CODE' });
  for (const verifyContract of [true, false, zeroAddress, other, () => { throw new Error('not a factory proxy'); }]) {
    await assert.rejects(fake({ values: { verifyContract } }).service.inspect(plan), { code: 'INVALID_RESOLVER_PROOF' });
  }
  for (const roles of [0n, 1n << 4n, 1n << 132n, 1n << 124n]) {
    await assert.rejects(fake({ values: { roles } }).service.inspect(plan), { code: 'RESOLVER_OWNER_MISMATCH' });
  }
  const wrongOwner = fake({ values: { roles: ({ args }) => args[1] === owner ? roleBitmap : 0n } });
  await assert.rejects(wrongOwner.service.inspect({ ...plan, owner: other }), { code: 'OWNER_NOT_EOA' });
});

test('live registry, token metadata, registrar bounds, and price budget are validated', async () => {
  for (const [values, code] of [
    [{ ETH_REGISTRY: other }, 'REGISTRY_MISMATCH'],
    [{ decimals: 18 }, 'UNEXPECTED_TOKEN'],
    [{ symbol: 'USD' }, 'UNEXPECTED_TOKEN'],
    [{ MIN_COMMITMENT_AGE: 60n, MAX_COMMITMENT_AGE: 60n }, 'UNSUPPORTED_CONSTANTS'],
    [{ MIN_REGISTER_DURATION: 31536001n }, 'UNSUPPORTED_CONSTANTS'],
    [{ getRegisterPrice: [25_000_000n, 1n] }, 'PRICE_OVER_BUDGET'],
    [{ getRegisterPrice: [160_000_000n, 0n] }, 'PRICE_OVER_BUDGET'],
    [{ getRegisterPrice: null }, 'INVALID_CHAIN_RESPONSE'],
    [{ balanceOf: -1n }, 'INVALID_CHAIN_RESPONSE'],
    [{ allowance: '100' }, 'INVALID_CHAIN_RESPONSE'],
    [{ commitmentAt: 1001n }, 'INVALID_CHAIN_RESPONSE'],
    [{ makeCommitment: zeroHash }, 'INVALID_CHAIN_RESPONSE'],
    [{ isAvailable: 'true' }, 'INVALID_CHAIN_RESPONSE'],
  ]) await assert.rejects(fake({ values }).service.inspect(plan), { code });
  assert.equal((await fake({ values: { getRegisterPrice: [25_000_000n, 0n] } }).service.inspect(plan)).price.raw, '25000000');
});

test('mint fixes recipient and amount and skips when enough test tokens already exist', async () => {
  const { service, calls } = fake({ values: { balanceOf: 0n } });
  const result = await service.prepare({ ...plan, action: 'mint', to: other, amount: '999999999', paymentToken: other });
  assert.equal(result.status, 'ready');
  assert.equal(result.transaction.to, ENS_DEPLOYMENTS.MockUSDC);
  const decoded = decodeFunctionData({ abi: tokenAbi, data: result.transaction.data });
  assert.deepEqual(decoded, { functionName: 'mint', args: [owner, 25_000_000n] });
  assert.equal(calls.find(call => call.method === 'simulateContract').account, owner);
  const skipped = await fake().service.prepare({ ...plan, action: 'mint' });
  assert.equal(skipped.status, 'skipped');
  assert.equal('transaction' in skipped, false);
});

test('deploy uses official factory, fixed roles, empty setters and only the simulation-predicted address', async () => {
  const { service, calls } = fake();
  const result = await service.prepare({ ...plan, resolver: null, action: 'deploy', implementation: other, roleBitmap: '0xffff', setters: ['0xff'] });
  assert.equal(result.status, 'ready');
  assert.equal(result.resolver, predicted);
  assert.equal(result.inspected.resolver, null);
  assert.equal(result.inspected.registered, false);
  assert.equal(result.transaction.to, ENS_DEPLOYMENTS.VerifiableFactory);
  const decoded = decodeFunctionData({ abi: factoryAbi, data: result.transaction.data });
  assert.equal(decoded.functionName, 'deployProxy');
  assert.equal(decoded.args[0], getAddress(ENS_DEPLOYMENTS.PermissionedResolverImpl));
  assert.equal(decoded.args[1], BigInt(salt));
  assert.deepEqual(decodeFunctionData({ abi: resolverAbi, data: decoded.args[2] }), {
    functionName: 'initialize', args: [[{ account: owner, roleBitmap }], []],
  });
  assert.equal(calls.find(call => call.method === 'simulateContract').chain.id, 11155111);
  assert.equal((await fake().service.prepare({ ...plan, action: 'deploy' })).status, 'skipped');
  for (const result of [undefined, true, zeroAddress, '0x123']) {
    await assert.rejects(fake({ methods: { simulateContract: () => ({ result }) } }).service.prepare({ ...plan, resolver: null, action: 'deploy' }), { code: 'INVALID_DEPLOYMENT_RESULT' });
  }
  const existing = fake({ methods: { getBytecode: ({ address }) => address === owner ? '0x' : '0x6000' } });
  await assert.rejects(existing.service.prepare({ ...plan, resolver: null, action: 'deploy' }), { code: 'RESOLVER_ALREADY_DEPLOYED' });
});

test('approve grants exactly fresh base plus premium to the official registrar', async () => {
  const { service } = fake({ values: { allowance: (1n << 256n) - 1n, getRegisterPrice: [8_000_000n, 123n] } });
  const result = await service.prepare({ ...plan, action: 'approve', spender: other, amount: '9999999' });
  assert.deepEqual(decodeFunctionData({ abi: tokenAbi, data: result.transaction.data }), {
    functionName: 'approve', args: [getAddress(ENS_DEPLOYMENTS.ETHRegistrar), 8_000_123n],
  });
  assert.equal(result.transaction.to, ENS_DEPLOYMENTS.MockUSDC);
  assert.equal((await fake().service.prepare({ ...plan, action: 'approve' })).status, 'skipped');
  await assert.rejects(fake({ values: { balanceOf: 0n } }).service.prepare({ ...plan, action: 'approve' }), { code: 'INSUFFICIENT_FUNDS' });
  await assert.rejects(fake({ values: { allowance: 0n }, methods: { simulateContract: () => ({ result: false }) } }).service.prepare({ ...plan, action: 'approve' }), { code: 'SIMULATION_REJECTED' });
});

test('commit requires a verified deployed resolver and blocks duplicate active commitments', async () => {
  const { service, calls } = fake({ values: { commitmentAt: 0n } });
  const result = await service.prepare({ ...plan, action: 'commit', commitment: zeroHash });
  const decoded = decodeFunctionData({ abi: registrarAbi, data: result.transaction.data });
  assert.equal(decoded.functionName, 'commit');
  assert.deepEqual(decoded.args, [result.inspected.commitment]);
  assert.equal(result.transaction.to, ENS_DEPLOYMENTS.ETHRegistrar);
  assert.equal(calls.some(call => call.functionName === 'verifyContract'), true);
  await assert.rejects(fake().service.prepare({ ...plan, action: 'commit' }), { code: 'ACTIVE_COMMITMENT' });
  await assert.rejects(fake().service.prepare({ ...plan, resolver: null, action: 'commit' }), { code: 'RESOLVER_REQUIRED' });
  const expired = fake({ values: { commitmentAt: 1n, MAX_COMMITMENT_AGE: 999n } });
  assert.equal((await expired.service.prepare({ ...plan, action: 'commit' })).status, 'ready');
});

test('register encodes exact plan, fixed year, token, zero subregistry and referrer', async () => {
  const { service, calls } = fake();
  const result = await service.prepare({ ...plan, action: 'register', duration: '9999999999', subregistry: other, referrer: secret, paymentToken: other, to: other });
  assert.equal(result.status, 'ready');
  assert.equal(result.inspected.registered, false);
  const decoded = decodeFunctionData({ abi: registrarAbi, data: result.transaction.data });
  assert.deepEqual(decoded, { functionName: 'register', args: [
    'relaydesk2026', owner, secret, zeroAddress, resolver, 31536000n, getAddress(ENS_DEPLOYMENTS.MockUSDC), zeroHash,
  ] });
  assert.deepEqual(calls.find(call => call.method === 'simulateContract').args.map(value => typeof value === 'string' ? value.toLowerCase() : value), decoded.args.map(value => typeof value === 'string' ? value.toLowerCase() : value));
  assert.equal(result.transaction.from, owner);
  assert.equal(result.transaction.to, ENS_DEPLOYMENTS.ETHRegistrar);
  assert.equal(result.transaction.chainId, '0xaa36a7');
  assert.equal(result.transaction.value, '0x0');
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('register enforces live funds, allowance, and inclusive minimum/exclusive maximum ages', async () => {
  for (const [values, code] of [
    [{ balanceOf: 7_999_999n }, 'INSUFFICIENT_FUNDS'],
    [{ allowance: 7_999_999n }, 'INSUFFICIENT_ALLOWANCE'],
    [{ commitmentAt: 0n }, 'COMMITMENT_MISSING'],
    [{ commitmentAt: 941n }, 'COMMITMENT_TOO_EARLY'],
    [{ commitmentAt: 1n, MAX_COMMITMENT_AGE: 999n }, 'COMMITMENT_EXPIRED'],
  ]) {
    const { service, calls } = fake({ values });
    await assert.rejects(service.prepare({ ...plan, action: 'register' }), { code });
    assert.equal(calls.some(call => call.method === 'simulateContract'), false);
  }
  assert.equal((await fake({ values: { commitmentAt: 940n } }).service.prepare({ ...plan, action: 'register' })).status, 'ready');
  await assert.rejects(fake().service.prepare({ ...plan, resolver: null, action: 'register' }), { code: 'RESOLVER_REQUIRED' });
});

test('changing committed label or secret cannot reuse the prior commitment; owner/resolver changes break deployment proof', async () => {
  const expected = hashCommitment(['relaydesk2026', owner, secret, zeroAddress, resolver, 31536000n, zeroHash]);
  const { service } = fake({
    values: { commitmentAt: ({ args }) => args[0] === expected ? 900n : 0n },
    methods: { getBytecode: ({ address }) => [owner, other].includes(address) ? '0x' : '0x6000' },
  });
  for (const change of [{ name: 'different2026.eth' }, { secret: `0x${'ef'.repeat(32)}` }]) {
    await assert.rejects(service.prepare({ ...plan, ...change, action: 'register' }), { code: 'COMMITMENT_MISSING' });
  }
  await assert.rejects(service.prepare({ ...plan, owner: other, action: 'register' }), { code: 'DEPLOYMENT_PROOF_MISMATCH' });
  const differentResolver = fake({ values: { commitmentAt: ({ args }) => args[0] === expected ? 900n : 0n } });
  await assert.rejects(differentResolver.service.prepare({ ...plan, resolver: other, action: 'register' }), { code: 'DEPLOYMENT_PROOF_MISMATCH' });
});

test('resolver provenance requires the exact owner, salt, initializer and successful deployment transaction', async () => {
  for (const override of [
    { chainId: 1 }, { from: other }, { to: other }, { value: 1n }, { hash: zeroHash },
    { input: deploymentInput({ deployedSalt: 0n }) },
    { input: deploymentInput({ admin: other }) },
    { input: deploymentInput({ roles: roleBitmap | (1n << 124n) }) },
    { input: deploymentInput({ setters: ['0x1234'] }) },
    { blockHash: null }, { blockNumber: 12301n },
  ]) {
    const { service, calls } = fake({ methods: { getTransaction: () => deploymentTransaction(override) } });
    await assert.rejects(service.inspect(plan), { code: 'DEPLOYMENT_PROOF_MISMATCH' });
    assert.equal(calls.some(call => call.method === 'simulateContract'), false);
  }
  for (const override of [
    { status: 'reverted' }, { transactionHash: zeroHash }, { from: other }, { to: other },
    { blockHash: zeroHash }, { logs: [] }, { logs: [deploymentLog(), deploymentLog()] },
    { logs: [deploymentLog({ address: other })] }, { logs: [deploymentLog({ removed: true })] },
    { logs: [deploymentLog({ sender: other })] }, { logs: [deploymentLog({ proxyAddress: other })] },
    { logs: [deploymentLog({ deployedSalt: 0n })] }, { logs: [deploymentLog({ implementation: other })] },
  ]) await assert.rejects(fake({ methods: { getTransactionReceipt: () => deploymentReceipt(override) } }).service.inspect(plan), { code: 'DEPLOYMENT_PROOF_MISMATCH' });
  await assert.rejects(fake({ methods: { getTransactionReceipt: () => { throw new Error('receipt not found'); } } }).service.inspect(plan), { code: 'DEPLOYMENT_PROOF_MISMATCH' });
  await assert.rejects(fake({ methods: { getBlock: () => ({ number: 12299n, timestamp: 1000n }) } }).service.inspect(plan), { code: 'DEPLOYMENT_PROOF_MISMATCH' });
  await assert.rejects(fake().service.inspect({ ...plan, salt: '0x1' }), { code: 'DEPLOYMENT_PROOF_MISMATCH' });
  await assert.rejects(fake().service.inspect({ ...plan, deploymentHash: `0x${'56'.repeat(32)}` }), { code: 'DEPLOYMENT_PROOF_MISMATCH' });
});

test('all actions reject simulation failures and never produce fabricated transaction success', async () => {
  for (const action of ['mint', 'deploy', 'approve', 'commit', 'register']) {
    const { service } = fake({
      values: { balanceOf: action === 'mint' ? 0n : 25_000_000n, allowance: action === 'approve' ? 0n : 8_000_000n, commitmentAt: action === 'commit' ? 0n : 900n },
      methods: { simulateContract: () => { throw new Error('execution reverted'); } },
    });
    await assert.rejects(service.prepare({ ...plan, resolver: action === 'deploy' ? null : resolver, action }), { code: 'SIMULATION_REJECTED' });
  }
  await assert.rejects(fake({ methods: { simulateContract: () => ({ result: undefined }) } }).service.prepare({ ...plan, action: 'register' }), { code: 'INVALID_CHAIN_RESPONSE' });
});

test('network changes after a successful simulation still prevent a ready transaction', async () => {
  let chainId = 11155111;
  const { service } = fake({ methods: {
    getChainId: () => chainId,
    simulateContract: () => { chainId = 1; return { result: 42n }; },
  } });
  await assert.rejects(service.prepare({ ...plan, action: 'register' }), { code: 'WRONG_CHAIN' });
});

test('every prepare reads a fresh price and availability', async () => {
  const { service, state } = fake();
  await service.inspect(plan);
  state.getRegisterPrice = [9_000_000n, 0n];
  await assert.rejects(service.prepare({ ...plan, action: 'register' }), { code: 'INSUFFICIENT_ALLOWANCE' });
  state.isAvailable = false;
  await assert.rejects(service.prepare({ ...plan, action: 'register' }), { code: 'NAME_UNAVAILABLE' });
});
