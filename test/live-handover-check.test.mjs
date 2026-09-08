import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ContractFunctionRevertedError, encodeAbiParameters, encodeErrorResult, getAddress, keccak256, stringToHex, zeroHash } from 'viem';
import { namehash, packetToBytes } from 'viem/ens';
import { toHex } from 'viem';
import resolverAbi from '../src/abi/permissioned-resolver.json' with { type: 'json' };
import { DEFAULTS, checkLiveHandover, isUnauthorizedRevert, parseArgs } from '../scripts/live-handover-check.mjs';
import { ENS_DEPLOYMENTS } from '../src/sepolia-config.mjs';

const RESOLVER = '0xe3987444ace129a21e1c44f782292da0bc73241e';
const OTHER = '0x2222222222222222222222222222222222222222';
const node = namehash(DEFAULTS.name), part = keccak256(stringToHex('url'));
const resource = (node, part) => BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [node, part])));
const scopes = { root: 0n, key: BigInt(part) };

function unauthorized() {
  return new ContractFunctionRevertedError({ abi: resolverAbi, functionName: 'setText', data: encodeErrorResult({ abi: resolverAbi,
    errorName: 'EACUnauthorizedAccountRoles', args: [scopes.key, 16n, DEFAULTS.volunteer] }) });
}

function fake({ allowed = false, roles = {}, methods = {}, bypass = false } = {}) {
  const calls = [];
  const defaults = {
    getChainId: () => 11155111,
    getEnsResolver: () => RESOLVER,
    getEnsText: () => 'https://example.org/actual-event',
    getBytecode: () => '0x6000',
    readContract: ({ functionName, args }) => {
      if (functionName === 'verifyContract') return ENS_DEPLOYMENTS.PermissionedResolverImpl;
      if (functionName === 'findTokenId') return 42n;
      if (['hasRoles', 'hasRootRoles'].includes(functionName)) return bypass;
      if (functionName === 'roles') {
        const scope = Object.entries(scopes).find(([, id]) => id === args[0])?.[0];
        return Object.hasOwn(roles, scope) ? roles[scope] : allowed && scope === 'key' ? 16n : 0n;
      }
      throw new Error('Unexpected contract function');
    },
    simulateContract: ({ args }) => {
      if (args[1] === 'url' && allowed) return { result: undefined };
      throw new Error('Wrapped contract error', { cause: unauthorized() });
    },
  };
  const client = { chain: { id: 11155111 } };
  for (const [method, implementation] of Object.entries({ ...defaults, ...methods })) {
    client[method] = async args => { calls.push({ method, ...args }); return implementation(args); };
  }
  return { client, calls };
}

test('expectation is mandatory, arguments are bounded, and CLI without expect fails before networking', () => {
  assert.throws(() => parseArgs([]), /Explicit/);
  assert.throws(() => parseArgs(['--expect=maybe']), /Explicit/);
  assert.throws(() => parseArgs(['--expect=denied', '--rpc=https://evil.test']), /Unknown/);
  assert.throws(() => parseArgs(['--expect=denied', '--expect=allowed']), /duplicate/);
  assert.throws(() => parseArgs(['--expect=denied', '--name=sub.event.eth']), /single/);
  assert.throws(() => parseArgs(['--expect=denied', '--volunteer=wallet']), /Volunteer/);
  assert.throws(() => parseArgs(['--expect=denied', '--url=http://example.org']), /HTTPS/);
  assert.equal(parseArgs(['--expect=allowed']).name, DEFAULTS.name);
  const run = spawnSync(process.execPath, ['scripts/live-handover-check.mjs'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(run.status, 2); assert.equal(JSON.parse(run.stdout).overallPass, false);
});

test('allowed check observes exact scoped URL role, denies description, and only simulates as volunteer', async () => {
  const { client, calls } = fake({ allowed: true });
  const report = await checkLiveHandover({ client, expect: 'allowed' });
  assert.equal(report.overallPass, true);
  assert.equal(report.actualResolver, getAddress(RESOLVER));
  assert.equal(report.actualUrl, 'https://example.org/actual-event');
  assert.equal(report.roles.key.bits, '0x10');
  assert.deepEqual(report.simulations.url, { outcome: 'allowed' });
  assert.equal(report.simulations.description.errorName, 'EACUnauthorizedAccountRoles');
  const simulations = calls.filter(call => call.method === 'simulateContract');
  assert.equal(simulations.length, 2);
  for (const call of simulations) {
    assert.equal(call.account, getAddress(DEFAULTS.volunteer)); assert.equal(call.chain.id, 11155111);
    assert.equal(call.address, getAddress(RESOLVER)); assert.equal(call.value, 0n);
    assert.equal(call.functionName, 'setText'); assert.equal(call.args[0], toHex(packetToBytes(DEFAULTS.name))); assert.equal(call.args[2], DEFAULTS.url);
  }
  assert.deepEqual(calls.filter(call => call.functionName === 'roles').map(call => call.args[0]), Object.values(scopes));
  assert.ok(calls.some(call => call.functionName === 'hasRoles' && call.args[0] === 42n && call.args[1] === 1n << 24n));
  assert.ok(calls.some(call => call.functionName === 'hasRootRoles' && call.args[0] === 1n << 24n));
  assert.equal(calls.filter(call => call.method === 'getEnsResolver').length, 2);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test('denied passes only with exact ABI-decoded authorization errors and both scopes empty', async () => {
  const report = await checkLiveHandover({ client: fake().client, expect: 'denied' });
  assert.equal(report.overallPass, true);
  assert.equal(report.simulations.url.outcome, 'denied');
  assert.ok(Object.values(report.roles).every(({ bits }) => BigInt(bits) === 0n));
});

test('RPC failures, undecodable reverts, unrelated custom errors and forged names never count as denied', async () => {
  const unrelated = new ContractFunctionRevertedError({ abi: resolverAbi, functionName: 'setText', data: encodeErrorResult({ abi: resolverAbi, errorName: 'EACInvalidAccount' }) });
  const undecodable = new ContractFunctionRevertedError({ abi: resolverAbi, functionName: 'setText', data: '0xdeadbeef' });
  const forged = Object.assign(new Error('EACUnauthorizedAccountRoles'), { name: 'ContractFunctionRevertedError', data: { errorName: 'EACUnauthorizedAccountRoles' } });
  for (const error of [new Error('RPC timeout'), new Error('execution reverted'), unrelated, undecodable, forged]) {
    assert.equal(isUnauthorizedRevert(error), false);
    const { client } = fake({ methods: { simulateContract: () => { throw error; } } });
    const report = await checkLiveHandover({ client, expect: 'denied' });
    assert.equal(report.overallPass, false); assert.equal(report.simulations.url.outcome, 'error');
    assert.equal(report.results.urlPermission, false); assert.equal(report.results.wrongKeyDenied, false);
  }
  assert.equal(isUnauthorizedRevert(new Error('outer', { cause: unauthorized() })), true);
});

test('wrong-key success, broad resolver roles and registry bypass authority fail verification', async () => {
  for (const [options, expect] of [
    [{ methods: { simulateContract: () => ({ result: undefined }) } }, 'allowed'],
    [{ allowed: true, roles: { root: 16n } }, 'allowed'],
    [{ allowed: true, roles: { key: 16n | (16n << 128n) } }, 'allowed'],
    [{ roles: { root: 16n } }, 'denied'],
    [{ bypass: true }, 'denied'],
  ]) assert.equal((await checkLiveHandover({ client: fake(options).client, expect })).overallPass, false);
});

test('wrong networks, resolver replacement, unavailable reads and missing code fail closed', async () => {
  const wrong = fake({ methods: { getChainId: () => 1 } });
  assert.equal((await checkLiveHandover({ client: wrong.client, expect: 'denied' })).overallPass, false);
  assert.equal(wrong.calls.some(call => call.method === 'simulateContract'), false);
  const configured = fake(); configured.client.chain.id = 1;
  assert.equal((await checkLiveHandover({ client: configured.client, expect: 'denied' })).overallPass, false);
  let resolverReads = 0;
  const changed = fake({ methods: { getEnsResolver: () => ++resolverReads === 1 ? RESOLVER : OTHER } });
  const report = await checkLiveHandover({ client: changed.client, expect: 'denied' });
  assert.equal(report.overallPass, false); assert.equal(report.results.resolverStable, false);
  for (const methods of [
    { getBytecode: () => '0x' }, { getEnsResolver: () => null },
    { getEnsText: () => { throw new Error('RPC down'); } },
    { readContract: () => { throw new Error('ABI mismatch'); } },
  ]) assert.equal((await checkLiveHandover({ client: fake({ methods }).client, expect: 'denied' })).overallPass, false);
});
