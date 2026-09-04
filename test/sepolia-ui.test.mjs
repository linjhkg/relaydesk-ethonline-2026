import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/sepolia.mjs', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/sepolia.html', import.meta.url), 'utf8');
const ACTOR = '0x2222222222222222222222222222222222222222';
const VOLUNTEER = '0x3333333333333333333333333333333333333333';
const RESOLVER = '0x1111111111111111111111111111111111111111';
const HASH = `0x${'a'.repeat(64)}`;
const CHAIN = '0xaa36a7';

// The real frontend runs unchanged; only its browser, wallet and HTTP boundaries
// are simulated. No provider or network operation can escape this harness.
class Element {
  constructor() {
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this.className = '';
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(fn);
    this.listeners.set(type, listeners);
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  async dispatch(type, force = false) {
    if (type === 'click' && this.disabled && !force) return;
    for (const fn of this.listeners.get(type) || []) await fn({ target: this, preventDefault() {} });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(options = {}) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
  const el = id => {
    assert.ok(elements.has(id), `Frontend references an existing HTML id: ${id}`);
    return elements.get(id);
  };
  for (const action of ['grant', 'revoke', 'update']) el(`${action}-button`).dataset.action = action;
  el('ens-name').value = 'event.eth';
  el('volunteer').value = VOLUNTEER;
  el('new-url').value = 'https://event.example/new';
  const wallet = { account: ACTOR, chain: options.chain || CHAIN };
  const walletCalls = [];
  const requests = [];
  const subscriptions = new Map();
  const provider = {
    on(type, fn) {
      const handlers = subscriptions.get(type) || [];
      handlers.push(fn);
      subscriptions.set(type, handlers);
    },
    async request(call) {
      walletCalls.push(call);
      if (options.walletRequest) {
        const override = await options.walletRequest(call);
        if (override !== undefined) return override;
      }
      switch (call.method) {
        case 'eth_accounts':
        case 'eth_requestAccounts': return wallet.account ? [wallet.account] : [];
        case 'eth_chainId': return wallet.chain;
        case 'wallet_switchEthereumChain': wallet.chain = call.params[0].chainId; return null;
        case 'eth_sendTransaction': return HASH;
        default: throw new Error(`Unexpected wallet method: ${call.method}`);
      }
    },
  };
  const inspection = { name: 'event.eth', chainId: 11155111, resolver: RESOLVER,
    url: 'https://event.example/old', bytecodePresent: true, ...options.inspection };
  const prepared = request => ({ status: 'ready', action: request.action, state: inspection,
    transaction: { from: request.actor, to: RESOLVER, value: '0x0', chainId: CHAIN, data: '0x12345678' } });
  const context = vm.createContext({
    window: { ethereum: provider }, URL, AbortSignal, console,
    document: {
      getElementById: el,
      createElement: () => new Element(),
      querySelectorAll: selector => {
        assert.equal(selector, '[data-action]');
        return ['grant', 'revoke', 'update'].map(action => el(`${action}-button`));
      },
    },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, body });
      let result;
      if (url === '/api/ens/inspect') result = inspection;
      else if (url === '/api/ens/prepare') result = options.prepare ? await options.prepare(body, prepared(body)) : prepared(body);
      else if (url === '/api/ens/receipt') result = options.receipt ? await options.receipt(body) : { hash: body.hash, status: 'pending' };
      else throw new Error(`Unexpected API URL: ${url}`);
      return { ok: true, status: 200, json: async () => result };
    },
  });
  vm.runInContext(source, context, { filename: 'public/sepolia.mjs' });
  return {
    el, wallet, walletCalls, requests,
    sendCalls: () => walletCalls.filter(call => call.method === 'eth_sendTransaction'),
    click: (id, force) => el(id).dispatch('click', force),
    inspect: () => el('inspect-form').dispatch('submit'),
    async connect() { el('wallet-select').value = '0'; await el('wallet-select').dispatch('change'); await el('connect-button').dispatch('click'); },
    async ready() { await this.connect(); await this.inspect(); },
    async input(id, value) { el(id).value = value; await el(id).dispatch('input'); },
    async emit(type, value) {
      if (type === 'accountsChanged') wallet.account = value[0] || '';
      if (type === 'chainChanged') wallet.chain = value;
      if (type === 'disconnect') wallet.account = '';
      for (const fn of subscriptions.get(type) || []) await fn(value);
    },
  };
}

test('wallet discovery, connect, inspection and all simulations never send; explicit confirm sends once', async () => {
  const h = harness();
  assert.equal(h.walletCalls.length, 0, 'Page load cannot request wallet access');
  await h.ready();
  for (const action of ['grant', 'revoke', 'update']) {
    await h.click(`${action}-button`);
    assert.equal(h.el('review').hidden, false);
    assert.equal(h.el('send-button').disabled, false);
    assert.equal(h.sendCalls().length, 0);
  }
  const simulations = h.requests.filter(request => request.url.endsWith('/prepare')).length;
  await h.click('send-button');
  assert.equal(h.sendCalls().length, 1);
  assert.equal(h.requests.filter(request => request.url.endsWith('/prepare')).length, simulations + 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.sendCalls()[0].params[0])), {
    from: ACTOR, to: RESOLVER, value: '0x0', chainId: CHAIN, data: '0x12345678',
  });
  await h.click('send-button', true);
  assert.equal(h.sendCalls().length, 1, 'Submitted transaction prevents duplicate send');
});

test('wrong wallet chain disables actions and forced events cannot prepare or send', async () => {
  const h = harness({ chain: '0x1' });
  await h.ready();
  assert.equal(h.el('grant-button').disabled, true);
  await h.click('grant-button', true);
  await h.click('send-button', true);
  assert.equal(h.requests.some(request => request.url.endsWith('/prepare')), false);
  assert.equal(h.sendCalls().length, 0);
});

test('transaction from, resolver, value, chain and calldata are validated before review', async t => {
  for (const [field, value] of Object.entries({ from: VOLUNTEER, to: VOLUNTEER, value: '0x1', chainId: '0x1', data: '0x123' })) {
    await t.test(field, async () => {
      const h = harness({ prepare: (_, result) => { result.transaction[field] = value; return result; } });
      await h.ready();
      await h.click('grant-button');
      assert.equal(h.el('send-button').disabled, true);
      await h.click('send-button', true);
      assert.equal(h.sendCalls().length, 0);
    });
  }
});

test('input, account, chain, disconnect and wallet-selection changes invalidate prepared transactions', async t => {
  const changes = {
    name: h => h.input('ens-name', 'other.eth'),
    volunteer: h => h.input('volunteer', RESOLVER),
    url: h => h.input('new-url', 'https://event.example/changed'),
    account: h => h.emit('accountsChanged', [VOLUNTEER]),
    chain: h => h.emit('chainChanged', '0x1'),
    disconnect: h => h.emit('disconnect'),
    wallet: h => h.el('wallet-select').dispatch('change'),
  };
  for (const [kind, change] of Object.entries(changes)) await t.test(kind, async () => {
    const h = harness();
    await h.ready();
    await h.click('grant-button');
    await change(h);
    assert.equal(h.el('review').hidden, true);
    assert.equal(h.el('send-button').disabled, true);
    await h.click('send-button', true);
    assert.equal(h.sendCalls().length, 0);
  });
});

test('late prepare responses cannot revive an invalidated account, chain or input', async t => {
  for (const kind of ['account', 'chain', 'input']) await t.test(kind, async () => {
    const entered = deferred();
    const release = deferred();
    const h = harness({ prepare: async (_, result) => { entered.resolve(); await release.promise; return result; } });
    await h.ready();
    const pending = h.click('grant-button');
    await entered.promise;
    if (kind === 'account') await h.emit('accountsChanged', [VOLUNTEER]);
    else if (kind === 'chain') await h.emit('chainChanged', '0x1');
    else await h.input('new-url', 'https://event.example/changed');
    release.resolve();
    await pending;
    assert.equal(h.el('review').hidden, true);
    assert.equal(h.el('send-button').disabled, true);
    await h.click('send-button', true);
    assert.equal(h.sendCalls().length, 0);
  });
});

test('silent wallet changes and changed re-simulation calldata block confirmation', async t => {
  for (const kind of ['account', 'chain', 'calldata']) await t.test(kind, async () => {
    let calls = 0;
    const h = harness({ prepare: (_, result) => {
      if (++calls > 1 && kind === 'calldata') result.transaction.data = '0x87654321';
      return result;
    } });
    await h.ready();
    await h.click('grant-button');
    if (kind === 'account') h.wallet.account = VOLUNTEER;
    if (kind === 'chain') h.wallet.chain = '0x1';
    await h.click('send-button');
    assert.equal(h.sendCalls().length, 0);
    assert.equal(h.el('send-button').disabled, true);
  });
});

test('input changed during confirmation re-simulation prevents broadcast', async () => {
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const h = harness({ prepare: async (_, result) => {
    if (++calls === 2) { entered.resolve(); await release.promise; }
    return result;
  } });
  await h.ready();
  await h.click('grant-button');
  const pending = h.click('send-button');
  await entered.promise;
  await h.input('volunteer', RESOLVER);
  release.resolve();
  await pending;
  assert.equal(h.sendCalls().length, 0);
});

test('pending receipts remain pending and keep new writes blocked', async () => {
  const h = harness();
  await h.ready();
  await h.click('grant-button');
  await h.click('send-button');
  assert.match(h.el('receipt-state').textContent, /等待/);
  await h.click('receipt-button');
  assert.match(h.el('receipt-state').textContent, /等待/);
  assert.doesNotMatch(h.el('receipt-state').className, /is-success/);
  assert.equal(h.el('grant-button').disabled, true);
  assert.equal(h.el('receipt-button').disabled, false);
  assert.equal(h.sendCalls().length, 1);
});

test('reverted receipt does not display successful execution', async () => {
  const h = harness({ receipt: ({ hash }) => ({ hash, status: 'reverted', blockNumber: '12' }) });
  await h.ready();
  await h.click('grant-button');
  await h.click('send-button');
  await h.click('receipt-button');
  assert.match(h.el('receipt-state').textContent, /失败/);
  assert.doesNotMatch(h.el('receipt-state').className, /is-success/);
  assert.equal(h.el('grant-button').disabled, true, 'A fresh inspection is required after receipt');
});

test('missing url record can still be inspected and prepared', async () => {
  const h = harness({ inspection: { url: null } });
  await h.ready();
  assert.equal(h.el('grant-button').disabled, false);
  await h.click('grant-button');
  assert.equal(h.el('send-button').disabled, false);
  assert.equal(h.sendCalls().length, 0);
});

test('a new pending transaction clears a previous success badge and receipt button', async () => {
  let receipts = 0;
  const h = harness({ receipt: ({ hash }) => ({ hash, status: ++receipts === 1 ? 'success' : 'pending', blockNumber: '12' }) });
  await h.ready();
  await h.click('grant-button');
  await h.click('send-button');
  await h.click('receipt-button');
  assert.match(h.el('receipt-state').className, /is-success/);
  await h.inspect();
  await h.click('grant-button');
  await h.click('send-button');
  await h.click('receipt-button');
  assert.doesNotMatch(h.el('receipt-state').className, /is-success/);
  assert.doesNotMatch(h.el('receipt-button').textContent, /已确认/);
  assert.match(h.el('receipt-state').textContent, /等待/);
});
