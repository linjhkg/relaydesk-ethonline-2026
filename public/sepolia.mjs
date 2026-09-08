const CHAIN_ID = '0xaa36a7';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const $ = (id) => document.getElementById(id);
const actions = { grant: '授予 url 编辑权限', revoke: '撤销 url 编辑权限', update: '更新 url 记录' };
const state = { provider: null, account: '', chain: '', inspected: null, prepared: null, revision: 0, walletSession: 0, busy: false, walletBusy: false, receiptBusy: false, hash: '' };
const wallets = [];

function status(message, type = '') {
  $('status').textContent = message;
  $('status').className = `feedback ${type ? `is-${type}` : ''}`;
}

function chainId(value) {
  try { return `0x${BigInt(value).toString(16)}`; } catch { return ''; }
}

function address(value) { return typeof value === 'string' && ADDRESS.test(value); }
function sameAddress(a, b) { return address(a) && address(b) && a.toLowerCase() === b.toLowerCase(); }
function safeUrl(value) {
  try {
    const url = new URL(value);
    return /^https:\/\//i.test(value) && url.protocol === 'https:' && !url.username && !url.password && !/[\s\\\u0000-\u001f\u007f]/.test(value) ? url.href : null;
  } catch { return null; }
}

function render() {
  const ready = Boolean(state.inspected && state.account && state.chain === CHAIN_ID && !state.busy && !state.walletBusy && !state.hash);
  $('inspect-button').disabled = state.busy || state.walletBusy;
  $('connect-button').disabled = !$('wallet-select').value || state.busy || state.walletBusy;
  $('wallet-select').disabled = state.busy || state.walletBusy;
  $('switch-button').hidden = !state.provider || !state.account || state.chain === CHAIN_ID;
  $('switch-button').disabled = state.busy || state.walletBusy;
  $('wallet-account').textContent = state.account || '未连接';
  $('wallet-chain').textContent = state.chain === CHAIN_ID ? 'Sepolia · 11155111' : state.chain ? `错误网络 · chainId ${state.chain}（写入已禁用）` : '未读取';
  $('wallet-badge').textContent = state.account ? state.chain === CHAIN_ID ? 'Sepolia 已连接' : '请切换网络' : '未连接';
  $('grant-button').disabled = !ready || !address($('volunteer').value.trim());
  $('revoke-button').disabled = !ready || !address($('volunteer').value.trim());
  $('update-button').disabled = !ready || !safeUrl($('new-url').value.trim());
  $('send-button').disabled = !ready || !state.prepared;
  $('discard-button').disabled = state.busy;
  $('receipt-button').disabled = state.receiptBusy || !state.hash;
}

function invalidate(message, clearInspection = false) {
  state.revision += 1;
  state.prepared = null;
  $('review').hidden = true;
  if (clearInspection) {
    state.inspected = null;
    $('record-details').hidden = true;
    $('record-empty').hidden = false;
  }
  if (message) status(message);
  render();
}

function assertCurrent(revision) {
  if (revision !== state.revision) throw new Error('输入、账户或网络已变化。请重新读取或模拟。');
}

async function api(path, body) {
  if (globalThis.RelayDeskRuntime) return globalThis.RelayDeskRuntime.request('ens', path, body);
  const response = await fetch(`/api/ens/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', redirect: 'error', body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）`);
  return result;
}

function errorMessage(error) {
  if (Number(error?.code) === 4001) return '你已取消钱包请求。未确认的操作不会继续发送。';
  if (Number(error?.code) === 4902) return '钱包尚未配置 Sepolia。请在钱包的测试网设置中启用 Sepolia，再重试。';
  if (Number(error?.code) === -32002) return '钱包中已有待处理请求，请先处理该请求。';
  return error?.message || '操作失败，请重试。';
}

async function walletSnapshot(provider) {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
  ]);
  return { account: Array.isArray(accounts) && address(accounts[0]) ? accounts[0] : '', chain: chainId(chain) };
}

async function revalidateWallet(revision) {
  const provider = state.provider;
  if (!provider) throw new Error('请先连接钱包。');
  const current = await walletSnapshot(provider);
  assertCurrent(revision);
  if (provider !== state.provider || !sameAddress(current.account, state.account) || current.chain !== state.chain) {
    state.account = current.account;
    state.chain = current.chain;
    invalidate('钱包状态已变化，原交易准备已失效。请重新模拟。');
    throw new Error('钱包账户或网络已变化，请重新模拟。');
  }
  if (current.chain !== CHAIN_ID || !current.account) throw new Error('请连接实际账户并切换到 Sepolia。');
  return current;
}

function bindProvider(provider) {
  state.provider = provider;
  const session = ++state.walletSession;
  const changed = (account, chain, message) => {
    if (session !== state.walletSession) return;
    state.account = account;
    state.chain = chain;
    invalidate(message);
  };
  provider.on?.('accountsChanged', (accounts) => changed(Array.isArray(accounts) && address(accounts[0]) ? accounts[0] : '', state.chain, '钱包账户已变化，请重新模拟；已提交的交易仍可查询回执。'));
  provider.on?.('chainChanged', (chain) => changed(state.account, chainId(chain), '钱包网络已变化，待确认交易已失效。仅 Sepolia 可以写入。'));
  provider.on?.('disconnect', () => changed('', '', '钱包已断开。请重新连接；已提交的交易仍可查询回执。'));
  return session;
}

function addWallet(provider, label) {
  if (!provider || typeof provider.request !== 'function' || wallets.some((wallet) => wallet.provider === provider)) return;
  wallets.push({ provider, label });
  const option = document.createElement('option');
  option.value = String(wallets.length - 1);
  option.textContent = label;
  $('wallet-select').append(option);
}

addWallet(window.okxwallet, 'OKX Wallet');
addWallet(window.ethereum, window.ethereum?.isMetaMask ? 'MetaMask / Ethereum 钱包' : '浏览器 Ethereum 钱包');
$('wallet-help').textContent = wallets.length ? '请选择一个钱包，再主动连接。本站不会请求助记词或私钥。' : '未检测到钱包扩展。应用内浏览器可能不支持扩展，请在已安装并登录钱包的 Chrome 中打开相同的本地网址，然后刷新。';

$('wallet-select').addEventListener('change', () => {
  state.walletSession += 1;
  state.provider = null;
  state.account = '';
  state.chain = '';
  invalidate('已更换钱包选择，请点击连接钱包。');
});

$('connect-button').addEventListener('click', async () => {
  const wallet = wallets[Number($('wallet-select').value)];
  if (!$('wallet-select').value || !wallet || state.walletBusy || state.busy) return;
  invalidate();
  const session = bindProvider(wallet.provider);
  state.walletBusy = true;
  render();
  status('请在选中的钱包中确认连接账户。');
  try {
    await wallet.provider.request({ method: 'eth_requestAccounts' });
    const current = await walletSnapshot(wallet.provider);
    if (session !== state.walletSession) return;
    state.account = current.account;
    state.chain = current.chain;
    if (!current.account) throw new Error('钱包未提供可用账户。请在钱包中授权连接。');
    status(current.chain === CHAIN_ID ? '已连接 Sepolia 实际账户。读取名称后即可模拟操作。' : '已连接钱包，但当前不是 Sepolia。请主动点击切换网络。');
  } catch (error) { if (session === state.walletSession) status(errorMessage(error), 'error'); }
  finally { state.walletBusy = false; render(); }
});

$('switch-button').addEventListener('click', async () => {
  if (!state.provider || state.busy || state.walletBusy) return;
  invalidate();
  state.walletBusy = true;
  render();
  const provider = state.provider;
  const session = state.walletSession;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] });
    const current = await walletSnapshot(provider);
    if (session !== state.walletSession) return;
    state.account = current.account;
    state.chain = current.chain;
    status(current.chain === CHAIN_ID ? '已切换到 Sepolia。请重新模拟操作。' : '钱包尚未切换到 Sepolia，写入保持禁用。');
  } catch (error) { status(errorMessage(error), 'error'); }
  finally { state.walletBusy = false; render(); }
});

$('ens-name').addEventListener('input', () => invalidate('名称已改变，请重新读取链上记录。', true));
for (const id of ['volunteer', 'new-url']) $(id).addEventListener('input', () => invalidate('输入已变化。请选择操作并重新模拟。'));

$('inspect-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy || state.walletBusy) return;
  const name = $('ens-name').value.trim();
  if (!name) return;
  invalidate('', true);
  const revision = state.revision;
  state.busy = true;
  render();
  status('正在读取 Sepolia 上的 ENS Resolver 和 url 记录…');
  try {
    const result = await api('inspect', { name });
    assertCurrent(revision);
    if (Number(result.chainId) !== 11155111 || !address(result.resolver) || result.bytecodePresent !== true || typeof result.name !== 'string' || (result.url !== null && typeof result.url !== 'string')) throw new Error('读取结果不完整或不属于 Sepolia，无法准备交易。');
    state.inspected = { ...result, inputName: name };
    $('record-name').textContent = result.name;
    $('record-resolver').textContent = result.resolver;
    $('record-url').textContent = result.url || '尚未设置 url 记录';
    $('record-code').textContent = '已确认链上存在合约代码';
    $('record-details').hidden = false;
    $('record-empty').hidden = true;
    status('已读取真实测试网记录。连接 Sepolia 钱包后，可模拟授权、撤销或更新。', 'success');
  } catch (error) { if (revision === state.revision) status(errorMessage(error), 'error'); }
  finally { state.busy = false; render(); }
});

function payload(action) {
  if (!state.inspected || state.inspected.inputName !== $('ens-name').value.trim()) throw new Error('请先读取当前 ENS 名称。');
  const volunteer = $('volunteer').value.trim();
  const value = $('new-url').value.trim();
  if (action !== 'update' && (!address(volunteer) || /^0x0{40}$/i.test(volunteer))) throw new Error('请输入有效且非零的志愿者地址。');
  if (action === 'update' && !safeUrl(value)) throw new Error('请输入不含账号密码的完整 HTTPS 地址。');
  return { name: state.inspected.inputName, actor: state.account, volunteer, action, value: action === 'update' ? safeUrl(value) : value };
}

function transaction(result, request) {
  const tx = result.transaction;
  if (result.status !== 'ready' || !tx || !sameAddress(tx.from, request.actor) || !sameAddress(tx.to, state.inspected?.resolver) || tx.chainId !== CHAIN_ID || tx.value !== '0x0' || typeof tx.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(tx.data)) throw new Error('准备结果的账户、网络、合约或金额与当前页面不一致。请重新读取名称。');
  return { from: tx.from, to: tx.to, data: tx.data, chainId: tx.chainId, value: tx.value };
}

function showReview(prepared) {
  const rows = [
    ['ENS 名称', state.inspected.name], ['操作', actions[prepared.request.action]],
    ['签名账户', prepared.tx.from], ['目标 Resolver', prepared.tx.to],
    ['网络', 'Sepolia · 11155111'], ['转账金额', '0 ETH（另需测试网网络费）'],
    ['实际授权范围', '整个 Resolver 的 url 字段，包含其服务的所有名称；不是仅限当前名称。'],
    ['志愿者 root 权限', prepared.permissions?.roles?.root ?? '未核验'],
    ['志愿者 url-key 权限', prepared.permissions?.roles?.key ?? '未核验'],
    [prepared.request.action === 'update' ? '新的 url' : '志愿者地址', prepared.request.action === 'update' ? prepared.request.value : prepared.request.volunteer],
  ];
  $('review-details').replaceChildren();
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    row.append(term, detail);
    $('review-details').append(row);
  }
  $('review-data').textContent = prepared.tx.data;
  $('review').hidden = false;
}

for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', async () => {
  if (state.busy || state.walletBusy || state.hash) return;
  invalidate();
  const revision = state.revision;
  state.busy = true;
  render();
  status('正在核验实际钱包账户，并在 Sepolia 模拟操作…');
  try {
    await revalidateWallet(revision);
    const request = payload(button.dataset.action);
    const result = await api('prepare', request);
    assertCurrent(revision);
    await revalidateWallet(revision);
    const tx = transaction(result, request);
    state.prepared = { request, tx, revision, permissions: result.permissions };
    showReview(state.prepared);
    status('模拟通过，尚未发送交易。请核对下方详情，再主动点击“在钱包中确认”。', 'success');
  } catch (error) { if (revision === state.revision) status(errorMessage(error), 'error'); }
  finally { state.busy = false; render(); }
});

$('discard-button').addEventListener('click', () => { if (!state.busy) invalidate('已取消交易准备。没有发送交易。'); });

$('send-button').addEventListener('click', async () => {
  const prepared = state.prepared;
  if (!prepared || state.busy || state.walletBusy || state.hash) return;
  const revision = prepared.revision;
  state.busy = true;
  render();
  status('正在重新模拟并核对钱包与交易参数…');
  try {
    assertCurrent(revision);
    await revalidateWallet(revision);
    const request = payload(prepared.request.action);
    if (JSON.stringify(request) !== JSON.stringify(prepared.request)) throw new Error('操作参数已变化，请重新模拟。');
    const fresh = await api('prepare', request);
    assertCurrent(revision);
    const tx = transaction(fresh, request);
    if (JSON.stringify(tx) !== JSON.stringify(prepared.tx)) throw new Error('链上准备结果已变化，请重新读取名称并模拟。');
    await revalidateWallet(revision);
    assertCurrent(revision);
    const provider = state.provider;
    status('请在钱包中核对并确认 Sepolia 交易。等待你的签名…');
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
    if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('钱包没有返回有效交易哈希。请先在钱包中检查是否已发送，避免重复提交。');
    state.hash = hash;
    invalidate();
    $('receipt').hidden = false;
    $('receipt-state').textContent = '已提交 · 等待回执';
    $('receipt-state').className = 'pill';
    $('receipt-button').textContent = '检查链上回执';
    $('receipt-message').textContent = '钱包已返回交易哈希，尚未确认链上执行结果。请检查回执。';
    $('receipt-link').textContent = hash;
    $('receipt-link').href = `https://sepolia.etherscan.io/tx/${hash}`;
    status('交易已提交，正在等待链上确认。请点击“检查链上回执”。');
  } catch (error) {
    invalidate();
    status(errorMessage(error), 'error');
  } finally { state.busy = false; render(); }
});

$('receipt-button').addEventListener('click', async () => {
  if (!state.hash || state.receiptBusy) return;
  const hash = state.hash;
  state.receiptBusy = true;
  render();
  $('receipt-message').textContent = '正在读取 Sepolia 链上回执…';
  try {
    const result = await api('receipt', { hash });
    if (result.hash && result.hash.toLowerCase() !== hash.toLowerCase()) throw new Error('回执哈希不匹配，请使用交易浏览器核对。');
    if (result.status === 'pending') {
      $('receipt-state').textContent = '等待链上确认';
      $('receipt-message').textContent = '尚未获得回执。交易可能仍在等待打包，请稍后再次检查。';
    } else if (result.status === 'success' || result.status === 'reverted') {
      const success = result.status === 'success';
      $('receipt-state').textContent = success ? '链上执行成功' : '链上执行失败';
      $('receipt-state').className = `pill is-${success ? 'success' : 'error'}`;
      $('receipt-message').textContent = success ? `已取得成功回执${result.blockNumber != null ? `，区块 ${String(result.blockNumber)}` : ''}。请重新读取名称核对当前状态。` : '交易已上链但执行回滚。请重新读取状态、核对权限并重新模拟；网络费可能已消耗。';
      state.hash = '';
      invalidate(success ? '回执确认：链上执行成功。请重新读取名称，再进行下一次操作。' : '回执确认：链上执行回滚。请读取当前状态后重试。', true);
      $('receipt-button').textContent = '回执已确认';
    } else throw new Error('无法识别回执状态，请在交易浏览器中核对。');
  } catch (error) { $('receipt-message').textContent = `查询失败：${errorMessage(error)} 可再次检查或打开交易浏览器。`; }
  finally { state.receiptBusy = false; render(); }
});

render();
