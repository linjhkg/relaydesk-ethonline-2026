import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeAbiParameters, keccak256, stringToHex, zeroHash } from 'viem';
import { namehash, normalize, packetToBytes } from 'viem/ens';
import { toHex } from 'viem';
import resolverAbi from '../src/abi/permissioned-resolver.json' with { type: 'json' };
import { createEnsService } from '../src/ens-chain.mjs';
import { ENS_DEPLOYMENTS } from '../src/sepolia-config.mjs';
const urlResource = BigInt(keccak256(stringToHex('url')));
const interfaceRead = ({ functionName }) => functionName === 'verifyContract' ? ENS_DEPLOYMENTS.PermissionedResolverImpl
  : functionName === 'decodeSetter' ? [stringToHex('url'), urlResource, 16n] : 0n;

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
    readContract: interfaceRead,
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

test('grant and revoke encode only the url key with resolver-wide scope', async () => {
  for (const action of ['grant', 'revoke']) {
    const { service, calls } = fake();
    const prepared = await service.prepare({ ...input, action });
    const decoded = decodeFunctionData({ abi: resolverAbi, data: prepared.transaction.data });
    assert.equal(decoded.functionName, action === 'grant' ? 'grantSetterRoles' : 'revokeRoles');
    if (action === 'grant') {
      assert.equal(decoded.args[1], volunteer);
      const setter = decodeFunctionData({abi: resolverAbi, data: decoded.args[0]});
      assert.equal(setter.functionName, 'setText');
      assert.deepEqual(setter.args, ['0x', 'url', '']);
    } else assert.deepEqual(decoded.args, [urlResource, 16n, volunteer]);
    assert.match(prepared.summary, /ALL names/);
    assert.deepEqual(calls.find(call => call.method === 'simulateContract').args, decoded.args);
    assert.equal(prepared.transaction.chainId, '0xaa36a7');
    assert.equal(prepared.transaction.from, actor);
    assert.equal(prepared.transaction.value, '0x0');
    assert.doesNotThrow(() => JSON.stringify(prepared));
  }
});

test('update uses DNS bytes, verifies simulation with actor, and encodes only url', async () => {
  const { service, calls } = fake({ simulateContract: () => ({ result: undefined }) });
  const prepared = await service.prepare({ ...input, action: 'update', value: 'https://event.example/new' });
  const decoded = decodeFunctionData({ abi: resolverAbi, data: prepared.transaction.data });
  assert.equal(decoded.functionName, 'setText');
  assert.deepEqual(decoded.args, ['0x056576656e740365746800', 'url', 'https://event.example/new']);
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

test('permission checks cover official root and key resources, not fictional name scopes', async () => {
  const { service, calls } = fake();
  await service.prepare(input);
  const roleCalls = calls.filter(call => call.functionName === 'roles');
  assert.deepEqual(roleCalls.map(call => call.args), [0n, urlResource]
    .map(id => [id, volunteer]));
});

test('broad text roles and administrative authority block scoped handover claims', async () => {
  for (const index of [0]) {
    for (const bitmap of [16n, 16n << 128n]) {
      let reads = 0;
      const { service } = fake({ readContract: (arg) => arg.functionName !== 'roles' ? interfaceRead(arg) : reads++ === index ? bitmap : 0n });
      await assert.rejects(service.prepare({ ...input, action: 'revoke' }), { code: 'BROAD_AUTHORITY' });
    }
  }
  let adminReads = 0;
  const keyAdmin = fake({ readContract: arg => arg.functionName !== 'roles' ? interfaceRead(arg) : adminReads++ === 1 ? 16n << 128n : 0n });
  await assert.rejects(keyAdmin.service.prepare({ ...input, action: 'revoke' }), { code: 'BROAD_AUTHORITY' });
  let reads = 0;
  const scoped = fake({ readContract: arg => arg.functionName !== 'roles' ? interfaceRead(arg) : reads++ === 1 ? 16n : 0n });
  const prepared = await scoped.service.prepare({ ...input, action: 'revoke' });
  assert.equal(prepared.permissions.scopedUrlRole, true);
  assert.equal(prepared.permissions.broadAuthority, false);
});

test('unknown permissions and unverified resolver semantics fail closed for delegation', async () => {
  const unknown = fake({ readContract: ({ functionName }) => {
    if (functionName !== 'roles') return interfaceRead({ functionName });
    throw new Error('RPC unavailable');
  } });
  await assert.rejects(unknown.service.prepare(input), { code: 'PERMISSIONS_UNKNOWN' });
  const wrong = fake({ readContract: arg => arg.functionName === 'decodeSetter' ? ['0x', 0n, 16n] : interfaceRead(arg) });
  await assert.rejects(wrong.service.prepare(input), { code: 'UNSUPPORTED_RESOLVER' });
  const unsupported = fake({ readContract: () => { throw new Error('unsupported'); } });
  await assert.rejects(unsupported.service.prepare(input), { code: 'UNSUPPORTED_RESOLVER' });
});

test('all ENS resolutions explicitly select the dedicated hackathon Universal Resolver', async () => {
  const {service,calls}=fake();
  await service.prepare(input);
  for(const call of calls.filter(c=>['getEnsResolver','getEnsText'].includes(c.method))) {
    assert.equal(call.universalResolverAddress, ENS_DEPLOYMENTS.UniversalResolver);
  }
});

test('URL grants for different names on one resolver have the SAME scope, never a per-name guarantee', async () => {
  const {service}=fake();
  const a=await service.prepare(input);
  const b=await service.prepare({...input,name:'another.eth'});
  assert.equal(a.transaction.data,b.transaction.data);
  assert.equal(a.permissions.scope,'url-key-across-entire-resolver');
  assert.match(a.notice,/No one-name isolation/);
});

test('root linking or upgrade authority and their admins prevent narrow-revocation claims', async () => {
  for(const bit of [28n,124n,156n,252n]) {
    const {service}=fake({readContract:arg=>arg.functionName==='roles' ? (arg.args[0]===0n ? 1n<<bit:0n) : interfaceRead(arg)});
    await assert.rejects(service.prepare({...input,action:'revoke'}),{code:'BROAD_AUTHORITY'});
  }
});

test('a proxy of the old resolver implementation is refused even on Sepolia', async () => {
  const {service}=fake({readContract:arg=>arg.functionName==='verifyContract'?'0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e':interfaceRead(arg)});
  await assert.rejects(service.prepare(input),{code:'UNSUPPORTED_RESOLVER'});
});
