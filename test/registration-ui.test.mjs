import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { encodeFunctionData, zeroAddress, zeroHash } from 'viem';
import registrarAbi from '../src/abi/eth-registrar.json' with { type: 'json' };
import factoryAbi from '../src/abi/verifiable-factory.json' with { type: 'json' };
import tokenAbi from '../src/abi/mock-usdc.json' with { type: 'json' };
import resolverAbi from '../src/abi/permissioned-resolver.json' with { type: 'json' };
import { ENS_DEPLOYMENTS } from '../src/sepolia-config.mjs';

const source = await readFile(new URL('../public/register.mjs', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/register.html', import.meta.url), 'utf8');
const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const RESOLVER = '0x3333333333333333333333333333333333333333';
const CHAIN = '0xaa36a7';
const HASH = `0x${'ab'.repeat(32)}`;
const COMMITMENT = `0x${'cd'.repeat(32)}`;
const NAME = 'relaydesk2026.eth';
const PLAN = { owner: OWNER, name: NAME, secret: `0x${'12'.repeat(32)}`, salt: `0x${'34'.repeat(32)}`, resolver: RESOLVER, deploymentHash: `0x${'56'.repeat(32)}` };
const PLAN_KEY = `relaydesk:registration:ethonline-v2:plan:${OWNER}:${NAME}`;
const PENDING_KEY = `relaydesk:registration:ethonline-v2:pending:${OWNER}:${NAME}`;
const ACTIONS = ['mint', 'deploy', 'approve', 'commit', 'register'];
const CONTRACTS = { mockUsdc: ENS_DEPLOYMENTS.MockUSDC, factory: ENS_DEPLOYMENTS.VerifiableFactory, registrar: ENS_DEPLOYMENTS.ETHRegistrar };

class Element {
  value = ''; disabled = false; hidden = false; textContent = ''; className = '';
  dataset = {}; children = []; listeners = new Map();
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  async dispatch(type, force = false) {
    if (type === 'click' && this.disabled && !force) return;
    for (const listener of this.listeners.get(type) || []) await listener({ target: this, preventDefault() {} });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function locks() {
  const tails = new Map();
  return { calls: [], async request(key, fn) {
    this.calls.push(key);
    const previous = tails.get(key) || Promise.resolve();
    const released = deferred(); tails.set(key, released.promise);
    await previous;
    try { return await fn(); } finally { released.resolve(); }
  } };
}

function inspection(plan, override = {}) {
  return { chainId: 11155111, owner: plan.owner, name: plan.name, label: plan.name.slice(0, -4),
    duration: '31536000', contracts: CONTRACTS, price: { raw: '8000000', formatted: '8', decimals: 6 },
    balance: { raw: '25000000', formatted: '25' }, allowanceRaw: '8000000', available: true,
    registered: false, resolver: plan.resolver, commitment: COMMITMENT,
    commitmentAt: 1000, readyAt: 1060, maxCommitmentAge: 86400, chainTimestamp: 1100, ...override };
}

function prepared(request, inspected) {
  let abi, functionName, args, to;
  const tuple = [request.name.slice(0, -4), request.owner, request.secret, zeroAddress, request.resolver || RESOLVER, 31536000n];
  if (request.action === 'mint') { abi = tokenAbi; functionName = 'mint'; args = [request.owner, 25000000n]; to = CONTRACTS.mockUsdc; }
  if (request.action === 'approve') { abi = tokenAbi; functionName = 'approve'; args = [CONTRACTS.registrar, BigInt(inspected.price.raw)]; to = CONTRACTS.mockUsdc; }
  if (request.action === 'commit') { abi = registrarAbi; functionName = 'commit'; args = [inspected.commitment]; to = CONTRACTS.registrar; }
  if (request.action === 'register') { abi = registrarAbi; functionName = 'register'; args = [...tuple, CONTRACTS.mockUsdc, zeroHash]; to = CONTRACTS.registrar; }
  if (request.action === 'deploy') {
    abi = factoryAbi; functionName = 'deployProxy'; to = CONTRACTS.factory;
    args = [ENS_DEPLOYMENTS.PermissionedResolverImpl, BigInt(request.salt), encodeFunctionData({ abi: resolverAbi,
      functionName: 'initialize', args: [[{ account: request.owner, roleBitmap: (1n << 132n) | (1n << 4n) }], []] })];
  }
  return { status: 'ready', action: request.action, inspected, summary: `Prepare ${request.action}`,
    ...(request.action === 'deploy' ? { resolver: RESOLVER } : {}),
    transaction: { from: request.owner, to, data: encodeFunctionData({ abi, functionName, args }), chainId: CHAIN, value: '0x0' } };
}

// Execute the real registration frontend; every wallet, HTTP and storage boundary
// is in memory, including shared storage and Web Locks for multiple tabs.
function harness(options = {}) {
  const elements = new Map([...html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => {
    const element = new Element(); element.hidden = /\bhidden(?:\s|>)/.test(tag);
    return [id, element];
  }));
  const el = id => { assert.ok(elements.has(id), `HTML id exists: ${id}`); return elements.get(id); };
  el('ens-name').value = NAME;
  for (const action of ACTIONS) el(`${action}-button`).dataset.action = action;
  const storage = options.storage || new Map();
  if (!options.blank && !storage.has(PLAN_KEY)) storage.set(PLAN_KEY, JSON.stringify(options.plan || PLAN));
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { if (options.storageWrite) options.storageWrite(key, value); storage.set(key, value); },
    removeItem: key => storage.delete(key),
  };
  const wallet = { account: OWNER, chain: options.chain || CHAIN };
  const walletCalls = [], requests = [], subscriptions = new Map(), browserEvents = new Map();
  const provider = {
    on(type, handler) { subscriptions.set(type, [...(subscriptions.get(type) || []), handler]); },
    async request(call) {
      walletCalls.push(call);
      if (options.walletRequest) { const override = await options.walletRequest(call); if (override !== undefined) return override; }
      if (['eth_accounts', 'eth_requestAccounts'].includes(call.method)) return wallet.account ? [wallet.account] : [];
      if (call.method === 'eth_chainId') return wallet.chain;
      if (call.method === 'wallet_switchEthereumChain') { wallet.chain = call.params[0].chainId; return null; }
      if (call.method === 'eth_sendTransaction') return HASH;
      throw new Error(`Unexpected wallet call ${call.method}`);
    },
  };
  const lockManager = options.locks || locks();
  let random = 0;
  const context = vm.createContext({
    window: { ethereum: provider, addEventListener: (type, handler) => browserEvents.set(type, handler) },
    navigator: options.noLocks ? {} : { locks: lockManager }, localStorage, URL, AbortSignal, console,
    crypto: { getRandomValues: bytes => { bytes.fill(++random); return bytes; } },
    setInterval: () => 1,
    document: { getElementById: el, createElement: () => new Element(),
      querySelectorAll: selector => { assert.equal(selector, '[data-action]'); return ACTIONS.map(action => el(`${action}-button`)); } },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); requests.push({ url, body });
      assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error');
      const apiError = options.apiError?.(url, body);
      if (apiError) return { ok: false, status: 422, json: async () => ({ error: apiError }) };
      let result;
      if (url.endsWith('/inspect')) result = options.inspect ? await options.inspect(body, inspection(body)) : inspection(body, options.inspection);
      else if (url.endsWith('/prepare')) {
        const normal = prepared(body, inspection(body, options.inspection));
        result = options.prepare ? await options.prepare(body, normal) : normal;
      } else if (url.endsWith('/receipt')) result = options.receipt ? await options.receipt(body) : { hash: body.hash, status: 'pending' };
      else throw new Error(`Unexpected URL ${url}`);
      return { ok: true, status: 200, json: async () => result };
    },
  });
  vm.runInContext(source, context, { filename: 'public/register.mjs' });
  return { el, wallet, walletCalls, requests, storage, lockManager,
    sendCalls: () => walletCalls.filter(call => call.method === 'eth_sendTransaction'),
    savedPlan: () => JSON.parse(storage.get(PLAN_KEY)), savedPending: () => JSON.parse(storage.get(PENDING_KEY)),
    click: (id, force) => el(id).dispatch('click', force),
    async connect() { el('wallet-select').value = '0'; await el('wallet-select').dispatch('change'); await this.click('connect-button'); },
    async ready() { await this.connect(); await this.click('create-plan-button'); },
    async send(action = 'mint') { await this.click(`${action}-button`); await this.click('send-button'); },
    async input(id, value) { el(id).value = value; await el(id).dispatch('input'); },
    async emit(type, value) {
      if (type === 'accountsChanged') wallet.account = value[0] || '';
      if (type === 'chainChanged') wallet.chain = value;
      for (const listener of subscriptions.get(type) || []) await listener(value);
    },
    async storageEvent(key) { await browserEvents.get('storage')?.({ key }); },
  };
}

test('registration load, wallet connection, plan creation and every prepare require explicit confirmation before sending', async () => {
  const h = harness(); assert.equal(h.walletCalls.length, 0);
  await h.ready();
  for (const action of ACTIONS) {
    await h.click(`${action}-button`);
    assert.equal(h.el('review').hidden, false, action);
    assert.equal(h.el('send-button').disabled, false, action);
    assert.equal(h.sendCalls().length, 0);
  }
  await h.click('send-button'); assert.equal(h.sendCalls().length, 1);
  await h.click('send-button', true); assert.equal(h.sendCalls().length, 1);
  assert.equal(h.savedPending().status, 'pending');
  assert.equal(h.lockManager.calls.length, 1);
});

test('new plan randomness persists across refresh without requesting a private key or sending', async () => {
  const h = harness({ blank: true }); await h.ready();
  const plan = h.savedPlan(); assert.match(plan.secret, /^0x[0-9a-f]{64}$/); assert.notEqual(plan.secret, plan.salt);
  assert.equal(plan.resolver, null); assert.equal('privateKey' in plan, false);
  const refreshed = harness({ storage: h.storage, blank: true }); await refreshed.ready();
  assert.deepEqual(refreshed.savedPlan(), plan); assert.equal(refreshed.sendCalls().length, 0);
});

test('wrong network and silent wallet/account changes block both preparation and confirmation', async t => {
  const wrong = harness({ chain: '0x1' }); await wrong.ready();
  await wrong.click('mint-button', true); await wrong.click('send-button', true);
  assert.equal(wrong.requests.some(item => item.url.endsWith('/prepare')), false); assert.equal(wrong.sendCalls().length, 0);
  for (const kind of ['account', 'chain', 'input', 'event']) await t.test(kind, async () => {
    const h = harness(); await h.ready(); await h.click('mint-button');
    if (kind === 'account') h.wallet.account = OTHER;
    if (kind === 'chain') h.wallet.chain = '0x1';
    if (kind === 'input') await h.input('ens-name', 'othername.eth');
    if (kind === 'event') await h.emit('accountsChanged', [OTHER]);
    await h.click('send-button', true); assert.equal(h.sendCalls().length, 0); assert.equal(h.el('send-button').disabled, true);
  });
});

test('transaction fields, action selectors and official targets are checked before review and after reprepare', async t => {
  const changes = { from: OTHER, to: OTHER, chainId: '0x1', value: '0x1', data: '0xdeadbeef' };
  for (const stage of [1, 2]) for (const [field, value] of Object.entries(changes)) await t.test(`${stage}:${field}`, async () => {
    let prepares = 0;
    const h = harness({ prepare: (_, result) => { if (++prepares === stage) result.transaction[field] = value; return result; } });
    await h.ready(); await h.click('mint-button'); await h.click('send-button', true);
    assert.equal(h.sendCalls().length, 0); assert.equal(h.el('send-button').disabled, true);
  });
  for (const action of ACTIONS) await t.test(`selector:${action}`, async () => {
    const h = harness({ prepare: (_, result) => { result.transaction.data = `0xdeadbeef${result.transaction.data.slice(10)}`; return result; } });
    await h.ready(); await h.click(`${action}-button`); assert.equal(h.el('send-button').disabled, true);
  });
});

test('mint recipient/amount, approval spender/amount and commit hash cannot be altered', async t => {
  for (const action of ['mint', 'approve', 'commit']) await t.test(action, async () => {
    const h = harness({ prepare: (_, result) => { result.transaction.data = `${result.transaction.data.slice(0, -2)}ff`; return result; } });
    await h.ready(); await h.click(`${action}-button`); await h.click('send-button', true); assert.equal(h.sendCalls().length, 0);
  });
});

test('input mutation while confirmation prepares cannot send stale transaction', async () => {
  const entered = deferred(), release = deferred(); let count = 0;
  const h = harness({ prepare: async (_, result) => { if (++count === 2) { entered.resolve(); await release.promise; } return result; } });
  await h.ready(); await h.click('mint-button'); const pending = h.click('send-button'); await entered.promise;
  await h.input('ens-name', 'different.eth'); release.resolve(); await pending;
  assert.equal(h.sendCalls().length, 0);
});

test('unknown wallet submission remains locked across refresh and cannot resend', async () => {
  const h = harness({ walletRequest: call => { if (call.method === 'eth_sendTransaction') throw new Error('Wallet transport disconnected'); } });
  await h.ready(); await h.send(); assert.equal(h.sendCalls().length, 1); assert.equal(h.savedPending().status, 'sending');
  assert.match(h.el('receipt-state').textContent, /未知/);
  const refresh = harness({ storage: h.storage }); await refresh.ready();
  await refresh.click('mint-button', true); await refresh.click('send-button', true);
  assert.equal(refresh.sendCalls().length, 0); assert.equal(refresh.el('recover-hash-button').disabled, false);
  assert.equal(refresh.savedPending().status, 'sending');
});

test('pending receipt is never completion and preserves duplicate-send protection', async () => {
  const h = harness(); await h.ready(); await h.send('register'); await h.click('receipt-button');
  assert.equal(h.savedPending().status, 'pending'); assert.equal(h.el('registration-complete').hidden, true);
  assert.match(h.el('receipt-message').textContent, /等待|尚未/);
  await h.click('register-button', true); await h.click('send-button', true); assert.equal(h.sendCalls().length, 1);
});

test('deployment proof enters the plan only after a successful identity-verified receipt', async t => {
  for (const response of [
    { status: 'pending' }, { status: 'success', transactionVerified: false },
    { status: 'success' }, { status: 'reverted', transactionVerified: true },
    { status: 'success', transactionVerified: true, hash: zeroHash },
  ]) await t.test(JSON.stringify(response), async () => {
    const h = harness({ blank: true, receipt: ({ hash }) => ({ hash, ...response }) }); await h.ready(); await h.send('deploy'); await h.click('receipt-button');
    assert.equal(h.savedPlan().resolver, null); assert.equal('deploymentHash' in h.savedPlan(), false);
  });
  const h = harness({ blank: true, receipt: ({ hash }) => ({ hash, status: 'success', transactionVerified: true }) });
  await h.ready(); await h.send('deploy'); assert.equal(h.savedPlan().resolver, null);
  await h.click('receipt-button'); assert.equal(h.savedPlan().resolver, RESOLVER); assert.equal(h.savedPlan().deploymentHash, HASH);
  assert.equal(h.el('registration-complete').hidden, true);
});

test('successful registration receipt still requires inspect.registered for completion', async () => {
  let registered = false;
  const h = harness({ receipt: ({ hash }) => ({ hash, status: 'success', transactionVerified: true }),
    inspect: (plan, normal) => ({ ...normal, registered, available: !registered, price: registered ? null : normal.price }) });
  await h.ready(); await h.send('register'); await h.click('receipt-button');
  assert.equal(h.savedPending().status, 'pending'); assert.equal(h.el('registration-complete').hidden, true);
  assert.equal(h.el('register-button').disabled, true);
  registered = true; await h.click('receipt-button'); assert.equal(h.savedPending().status, 'success');
  assert.equal(h.el('registration-complete').hidden, false);
  assert.equal(h.el('chain-price').textContent, '—'); assert.equal(h.el('register-button').disabled, true);
});

test('identity-verified success requires actual mint, allowance and commitment effects before releasing pending', async t => {
  const cases = [
    { action: 'mint', effect: { balance: { raw: '24999999', formatted: '24.999999' } } },
    { action: 'mint', effect: { balance: { raw: '0', formatted: '0' } } },
    { action: 'approve', effect: { allowanceRaw: '7999999' } },
    { action: 'approve', effect: { allowanceRaw: '8000001' } },
    { action: 'commit', effect: { commitmentAt: 0, readyAt: 0 } },
    { action: 'commit', effect: { commitment: `0x${'ef'.repeat(32)}` } },
  ];
  for (const { action, effect } of cases) await t.test(`${action}:${JSON.stringify(effect)}`, async () => {
    let confirmed = false;
    const h = harness({
      receipt: ({ hash }) => { confirmed = true; return { hash, status: 'success', transactionVerified: true }; },
      inspect: (_, normal) => confirmed ? { ...normal, ...effect } : normal,
    });
    await h.ready(); await h.send(action); await h.click('receipt-button');
    assert.equal(h.savedPending().status, 'pending');
    assert.equal(h.el(`${action}-button`).disabled, true);
    assert.equal(h.el('registration-complete').hidden, true);
    assert.equal(h.el('receipt-button').disabled, false);
    await h.click(`${action}-button`, true); await h.click('send-button', true);
    assert.equal(h.sendCalls().length, 1);
    const restored = harness({ storage: h.storage }); await restored.ready();
    assert.equal(restored.savedPending().status, 'pending'); assert.equal(restored.el(`${action}-button`).disabled, true);
  });
});

test('matching on-chain effects confirm each action; approval amount follows submitted calldata even when price changes', async t => {
  for (const action of ACTIONS) await t.test(action, async () => {
    let confirmed = false;
    const h = harness({ blank: action === 'deploy',
      receipt: ({ hash }) => { confirmed = true; return { hash, status: 'success', transactionVerified: true }; },
      inspect: (plan, normal) => {
        if (!confirmed) return normal;
        if (action === 'register') return { ...normal, available: false, registered: true, price: null };
        if (action === 'approve') return { ...normal, allowanceRaw: '8000000', price: { raw: '9000000', formatted: '9', decimals: 6 } };
        if (action === 'commit') return { ...normal, commitment: COMMITMENT, commitmentAt: 1050, readyAt: 1110 };
        if (action === 'mint') return { ...normal, balance: { raw: '25000000', formatted: '25' } };
        assert.equal(plan.resolver, RESOLVER); assert.equal(plan.deploymentHash, HASH);
        return normal;
      },
    });
    await h.ready(); await h.send(action); await h.click('receipt-button');
    assert.equal(h.savedPending().status, 'success');
    const checked = h.requests.find(request => request.url.endsWith('/receipt'));
    assert.deepEqual(checked.body.expected, JSON.parse(JSON.stringify(h.sendCalls()[0].params[0])));
    assert.equal(h.el('registration-complete').hidden, action !== 'register');
    if (action === 'deploy') { assert.equal(h.savedPlan().resolver, RESOLVER); assert.equal(h.savedPlan().deploymentHash, HASH); }
    if (action === 'approve') assert.equal(h.el('chain-price').textContent, '9');
  });
});

test('deployment proof failure, mismatching candidate resolver or inspection API error cannot persist deployment state', async t => {
  for (const failure of ['proof', 'resolver', 'api']) await t.test(failure, async () => {
    let confirmed = false;
    const h = harness({ blank: true,
      receipt: ({ hash }) => { confirmed = true; return { hash, status: 'success', transactionVerified: true }; },
      apiError: (url, plan) => confirmed && url.endsWith('/inspect') && plan.resolver && failure === 'api'
        ? 'RPC unavailable while verifying deployment' : null,
      inspect: (plan, normal) => {
        if (!confirmed) return normal;
        assert.equal(plan.resolver, RESOLVER); assert.equal(plan.deploymentHash, HASH);
        if (failure === 'proof') throw new Error('DEPLOYMENT_PROOF_MISMATCH');
        return { ...normal, resolver: OTHER };
      },
    });
    await h.ready(); await h.send('deploy'); await h.click('receipt-button');
    assert.equal(h.savedPlan().resolver, null); assert.equal('deploymentHash' in h.savedPlan(), false);
    assert.equal(h.savedPending().status, 'pending'); assert.equal(h.el('deploy-button').disabled, true);
    assert.equal(h.el('receipt-button').disabled, false); assert.equal(h.el('registration-complete').hidden, true);
    assert.equal(h.sendCalls().length, 1);
  });
});

test('unavailable price:null and skipped preparation produce no transaction controls', async () => {
  const unavailable = harness({ inspection: { available: false, price: null } }); await unavailable.ready();
  assert.equal(unavailable.el('chain-price').textContent, '—'); assert.equal(unavailable.el('register-button').disabled, true);
  const skipped = harness({ prepare: (request, result) => ({ status: 'skipped', action: request.action, inspected: result.inspected, summary: 'Already funded' }) });
  await skipped.ready(); await skipped.click('mint-button'); assert.match(skipped.el('status').textContent, /无需发送/);
  assert.equal(skipped.el('review').hidden, true); await skipped.click('send-button', true); assert.equal(skipped.sendCalls().length, 0);
});

test('shared Web Locks plus durable pending record permit at most one of two tabs to send', async () => {
  const storage = new Map(), sharedLocks = locks();
  const first = harness({ storage, locks: sharedLocks }), second = harness({ storage, locks: sharedLocks });
  await first.ready(); await second.ready(); await first.click('mint-button'); await second.click('mint-button');
  await Promise.all([first.click('send-button'), second.click('send-button')]);
  assert.equal(first.sendCalls().length + second.sendCalls().length, 1);
  assert.equal(sharedLocks.calls.length, 2); assert.equal(first.savedPending().status, 'pending');
});

test('a silent wallet account change while waiting for the cross-tab lock prevents broadcast', async () => {
  const entered = deferred(), release = deferred();
  const h = harness({ locks: { async request(_key, callback) { entered.resolve(); await release.promise; return callback(); } } });
  await h.ready(); await h.click('mint-button');
  const sending = h.click('send-button'); await entered.promise;
  h.wallet.account = OTHER;
  release.resolve(); await sending;
  assert.equal(h.sendCalls().length, 0);
});

test('unsupported locks, storage mutations and malformed persisted plans/pending records fail closed', async t => {
  const noLocks = harness({ noLocks: true }); await noLocks.ready(); await noLocks.send(); assert.equal(noLocks.sendCalls().length, 0);
  const changed = harness(); await changed.ready(); await changed.click('mint-button');
  changed.storage.set(PLAN_KEY, JSON.stringify({ ...PLAN, salt: `0x${'99'.repeat(32)}` }));
  await changed.click('send-button'); assert.equal(changed.sendCalls().length, 0);
  for (const data of ['{broken', JSON.stringify({ ...PLAN, owner: OTHER }), JSON.stringify({ ...PLAN, secret: zeroHash })]) await t.test(data.slice(0, 20), async () => {
    const storage = new Map([[PLAN_KEY, data]]); const h = harness({ storage }); await h.connect();
    await h.click('create-plan-button', true); await h.click('mint-button', true); await h.click('send-button', true);
    assert.equal(h.sendCalls().length, 0); assert.equal(h.el('plan-badge').textContent, '存储需要恢复');
  });
  const badPending = harness({ storage: new Map([[PLAN_KEY, JSON.stringify(PLAN)], [PENDING_KEY, JSON.stringify({ status: 'success', action: 'mint' })]]) });
  await badPending.ready(); await badPending.click('mint-button', true); assert.equal(badPending.sendCalls().length, 0);
});

test('storage events invalidate prepared transactions and completed records require receipt re-verification after refresh', async () => {
  const h = harness(); await h.ready(); await h.click('mint-button');
  await h.storageEvent(PLAN_KEY); await h.click('send-button', true); assert.equal(h.sendCalls().length, 0);
  const completed = harness({ receipt: ({ hash }) => ({ hash, status: 'success', transactionVerified: true }) });
  await completed.ready(); await completed.send(); await completed.click('receipt-button');
  const refreshed = harness({ storage: completed.storage }); await refreshed.ready();
  assert.equal(refreshed.el('mint-button').disabled, true); assert.equal(refreshed.el('receipt-button').disabled, false);
  await refreshed.click('send-button', true); assert.equal(refreshed.sendCalls().length, 0);
});
