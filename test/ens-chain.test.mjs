import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeAbiParameters, keccak256, stringToHex, zeroHash } from 'viem';
import { namehash, normalize, packetToBytes } from 'viem/ens';
import { toHex } from 'viem';
import resolverAbi from '../src/abi/permissioned-resolver.json' with { type: 'json' };
import { createEnsService } from '../src/ens-chain.mjs';

const resolver = '0x1111111111111111111111111111111111111111';
const actor = '0x2222222222222222222222222222222222222222';
const volunteer = '0x3333333333333333333333333333333333333333';
const anotherResolver = '0x4444444444444444444444444444444444444444';
const input = { name: 'Event.eth', actor, volunteer, action: 'grant' };

function fake(overrides = {}) {
  const calls = [];
  const defaults = {
    getChainId: () => 11155111,
    getEnsResolver: () => resolver,
    getBytecode: () => '0x6000',
    getEnsText: () => 'https://example.com/',
    readContract: ({ functionName }) => functionName === 'getAlias' ? '0x' : 0n,
    simulateContract: () => ({ result: true }),
  };
  const client = { chain: { id: 11155111 } };
  for (const [method, impl] of Object.entries({ ...defaults, ...overrides })) {
    client[method] = async args => { calls.push({ method, ...args }); return impl(args); };
  }
  return { service: createEnsService({ client }), client, calls };
}

test('inspect normalizes ENS and DNS names, uses url and allows missing text records', async () => {
  for (const name of ['Event.eth', 'conference.example.com', 'BÜCHER.eth']) {
    const { service, calls } = fake({ getEnsText: () => null });
    const state = await service.inspect({ name });
    assert.equal(state.name, normalize(name));
    assert.equal(state.node, namehash(normalize(name)));
    assert.equal(state.dnsName, toHex(packetToBytes(normalize(name))));
    assert.equal(state.url, null);
    assert.equal(state.bytecodePresent, true);
    assert.equal(calls.find(call => call.method === 'getEnsText').key, 'url');
  }
});

test('rejects invalid names and addresses before producing transactions', async () => {
  const { service } = fake();
  for (const name of ['', 'a..eth', 'a b.eth', null]) {
    await assert.rejects(service.inspect({ name }), { code: 'INVALID_NAME' });
  }
  for (const address of ['owner', '0x123', '0x0000000000000000000000000000000000000000']) {
    await assert.rejects(service.prepare({ ...input, actor: address }), { code: 'INVALID_ADDRESS' });
    await assert.rejects(service.prepare({ ...input, volunteer: address }), { code: 'INVALID_ADDRESS' });
  }
  await assert.rejects(service.prepare({ ...input, action: 'anything' }), { code: 'INVALID_ACTION' });
});

test('wrong RPC chain and configured chain fail closed', async () => {
  const { service, calls } = fake({ getChainId: () => 1 });
  await assert.rejects(service.prepare(input), { code: 'WRONG_CHAIN' });
  assert.equal(calls.some(call => call.method === 'simulateContract'), false);
  const other = fake();
  other.client.chain.id = 1;
  await assert.rejects(other.service.inspect(input), { code: 'WRONG_CHAIN' });
});

test('missing resolver and missing code fail without inventing registration or ownership', async () => {
  for (const missing of [null, '0x0000000000000000000000000000000000000000']) {
    await assert.rejects(fake({ getEnsResolver: () => missing }).service.inspect(input), { code: 'NO_RESOLVER' });
  }
  await assert.rejects(fake({ getBytecode: () => '0x' }).service.prepare(input), { code: 'NO_RESOLVER_CODE' });
});

test('grant and revoke encode DNS bytes and only the url key', async () => {
  for (const action of ['grant', 'revoke']) {
    const { service, calls } = fake();
    const prepared = await service.prepare({ ...input, action });
    const decoded = decodeFunctionData({ abi: resolverAbi, data: prepared.transaction.data });
    assert.equal(decoded.functionName, 'authorizeTextRoles');
    assert.deepEqual(decoded.args, ['0x056576656e740365746800', 'url', volunteer, action === 'grant']);
    assert.deepEqual(calls.find(call => call.method === 'simulateContract').args, decoded.args);
    assert.equal(prepared.transaction.chainId, '0xaa36a7');
    assert.equal(prepared.transaction.from, actor);
    assert.equal(prepared.transaction.value, '0x0');
    assert.doesNotThrow(() => JSON.stringify(prepared));
  }
});

test('update uses namehash, verifies simulation with actor, and encodes only url', async () => {
  const { service, calls } = fake({ simulateContract: () => ({ result: undefined }) });
  const prepared = await service.prepare({ ...input, action: 'update', value: 'https://event.example/new' });
  const decoded = decodeFunctionData({ abi: resolverAbi, data: prepared.transaction.data });
  assert.equal(decoded.functionName, 'setText');
  assert.deepEqual(decoded.args, [namehash('event.eth'), 'url', 'https://event.example/new']);
  assert.equal(calls.find(call => call.method === 'simulateContract').account, actor);
  for (const value of ['', 'http://event.test/', 'javascript:alert(1)', 'https://user:pass@site.test/', 'plain-text',
    'https://event.test/a b', 'https://event.test/a\\b', 'https://event.test/a\nb', 'https://event.test/a\u007fb']) {
    await assert.rejects(service.prepare({ ...input, action: 'update', value }), { code: 'INVALID_URL' });
  }
});

test('update defaults an omitted or empty volunteer to the validated actor', async () => {
  for (const absent of [undefined, null, '', '  ']) {
    const { service, calls } = fake();
    const prepared = await service.prepare({ ...input, action: 'update', volunteer: absent, value: 'https://event.test/' });
    assert.equal(prepared.transaction.from, actor);
    assert.equal(prepared.permissions.volunteer, actor);
    assert.equal(calls.find(call => call.method === 'simulateContract').account, actor);
    assert.ok(calls.filter(call => call.functionName === 'roles').every(call => call.args[1] === actor));
    for (const action of ['grant', 'revoke']) {
      await assert.rejects(service.prepare({ ...input, action, volunteer: absent }), { code: 'INVALID_ADDRESS' });
    }
  }
  for (const invalid of [undefined, '', 'owner', '0x0000000000000000000000000000000000000000']) {
    const { service, calls } = fake();
    await assert.rejects(service.prepare({ ...input, action: 'update', actor: invalid, volunteer: '', value: 'https://event.test/' }),
      { code: 'INVALID_ADDRESS' });
    assert.equal(calls.some(call => call.method === 'simulateContract'), false);
  }
  await assert.rejects(fake().service.prepare({ ...input, action: 'update', volunteer: 'invalid', value: 'https://event.test/' }),
    { code: 'INVALID_ADDRESS' });
});

test('resolver is looked up fresh on every action; mid-preparation changes are rejected', async () => {
  let current = resolver;
  const { service } = fake({ getEnsResolver: () => current });
  assert.equal((await service.inspect(input)).resolver, resolver);
  current = anotherResolver;
  assert.equal((await service.prepare(input)).transaction.to, anotherResolver);
  let counter = 0;
  const changed = fake({ getEnsResolver: () => counter++ ? anotherResolver : resolver });
  await assert.rejects(changed.service.prepare(input), { code: 'RESOLVER_CHANGED' });
});

test('simulation errors and false revokes never return a success transaction', async () => {
  for (const action of ['grant', 'revoke', 'update']) {
    const { service } = fake({ simulateContract: () => { throw new Error('EACUnauthorizedAccountRoles'); } });
    await assert.rejects(service.prepare({ ...input, action, value: 'https://event.test/' }), error => {
      assert.equal(error.code, 'SIMULATION_REJECTED');
      assert.match(error.message, /EACUnauthorizedAccountRoles/);
      assert.equal(error.transaction, undefined);
      return true;
    });
  }
  for (const action of ['grant', 'revoke']) {
    await assert.rejects(fake({ simulateContract: () => ({ result: false }) }).service.prepare({ ...input, action }),
      { code: 'NO_PERMISSION_CHANGE' });
  }
});

test('permission checks cover official root/name/global-key/key resources', async () => {
  const { service, calls } = fake();
  await service.prepare(input);
  const hash = (node, part) => BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [node, part])));
  const node = namehash('event.eth');
  const part = keccak256(stringToHex('url'));
  const roleCalls = calls.filter(call => call.functionName === 'roles');
  assert.deepEqual(roleCalls.map(call => call.args), [0n, hash(node, zeroHash), hash(zeroHash, part), hash(node, part)]
    .map(id => [id, volunteer]));
});

test('broad text roles and administrative authority block scoped handover claims', async () => {
  for (const index of [0, 1, 2]) {
    for (const bitmap of [16n, 16n << 128n]) {
      let reads = 0;
      const { service } = fake({ readContract: ({ functionName }) => functionName === 'getAlias' ? '0x' : reads++ === index ? bitmap : 0n });
      await assert.rejects(service.prepare({ ...input, action: 'revoke' }), { code: 'BROAD_AUTHORITY' });
    }
  }
  let adminReads = 0;
  const keyAdmin = fake({ readContract: ({ functionName }) => functionName === 'getAlias' ? '0x' : adminReads++ === 3 ? 16n << 128n : 0n });
  await assert.rejects(keyAdmin.service.prepare({ ...input, action: 'revoke' }), { code: 'BROAD_AUTHORITY' });
  let reads = 0;
  const scoped = fake({ readContract: ({ functionName }) => functionName === 'getAlias' ? '0x' : reads++ === 3 ? 16n : 0n });
  const prepared = await scoped.service.prepare({ ...input, action: 'revoke' });
  assert.equal(prepared.permissions.scopedUrlRole, true);
  assert.equal(prepared.permissions.broadAuthority, false);
});

test('unknown permissions and alias resolution fail closed for delegation', async () => {
  const unknown = fake({ readContract: ({ functionName }) => {
    if (functionName === 'getAlias') return '0x';
    throw new Error('RPC unavailable');
  } });
  await assert.rejects(unknown.service.prepare(input), { code: 'PERMISSIONS_UNKNOWN' });
  const alias = fake({ readContract: () => '0x05616c6963650365746800' });
  await assert.rejects(alias.service.prepare(input), { code: 'ALIASED_NAME' });
  const unsupported = fake({ readContract: () => { throw new Error('unsupported'); } });
  await assert.rejects(unsupported.service.prepare(input), { code: 'UNSUPPORTED_RESOLVER' });
});
