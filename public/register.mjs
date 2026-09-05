const CHAIN_ID = '0xaa36a7';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO = /^0x0{40}$/i;
const CONTRACTS = Object.freeze({ mockUsdc: '0x768f42455a2d082e23ceef7d51e5787c82d67a39', factory: '0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef', registrar: '0xa88553f454b77203b0d036a05c894d555eaaa2cc' });
const TARGETS = Object.freeze({ mint: CONTRACTS.mockUsdc, deploy: CONTRACTS.factory, approve: CONTRACTS.mockUsdc, commit: CONTRACTS.registrar, register: CONTRACTS.registrar });
const SELECTORS = Object.freeze({ mint: '0x40c10f19', approve: '0x095ea7b3', deploy: '0x5d84121a', commit: '0xf14fcbc8', register: '0xcff3e7c2' });
const ACTIONS = Object.freeze({ mint: '铸造 25 测试 MockUSDC', deploy: '部署专属 Resolver', approve: '按当前注册价授权 MockUSDC', commit: '预约名称（commit）', register: '注册 Sepolia 测试名' });
const $ = (id) => document.getElementById(id);
const state = { provider: null, account: '', chain: '', plan: null, pending: null, inspected: null, inspectedAt: 0, prepared: null, revision: 0, walletSession: 0, busy: false, walletBusy: false, receiptBusy: false, storageError: '' };
const wallets = [];

function address(value) { return typeof value === 'string' && ADDRESS.test(value) && !ZERO.test(value); }
function sameAddress(a, b) { return address(a) && address(b) && a.toLowerCase() === b.toLowerCase(); }
function chainId(value) { try { return `0x${BigInt(value).toString(16)}`; } catch { return ''; } }
function normalizedName(value) {
  const name = String(value).trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.eth$/.test(name) || name.length > 255) throw new Error('请输入单层英文字母、数字或连字符组成的 .eth 测试名。');
  return name;
}
function planKey(owner, name) { return `relaydesk:registration:v1:plan:${owner.toLowerCase()}:${name}`; }
function pendingKey(plan) { return `relaydesk:registration:v1:pending:${plan.owner.toLowerCase()}:${plan.name}`; }
function validatePlan(value, owner = state.account, name = normalizedName($('ens-name').value)) {
  if (!value || !sameAddress(value.owner, owner) || normalizedName(value.name) !== name || !HASH.test(value.secret) || /^0x0{64}$/i.test(value.secret) || !HASH.test(value.salt) || /^0x0{64}$/i.test(value.salt) || (value.resolver != null && (!address(value.resolver) || !HASH.test(value.deploymentHash)))) throw new Error('计划的账户、名称、随机数或部署交易证明无效。请恢复此账户和名称对应的原始备份。');
  return { owner: value.owner.toLowerCase(), name, secret: value.secret.toLowerCase(), salt: value.salt.toLowerCase(), resolver: value.resolver?.toLowerCase() || null, ...(value.resolver ? { deploymentHash: value.deploymentHash.toLowerCase() } : {}) };
}
function validateTransaction(tx, owner, action) {
  if (!Object.hasOwn(TARGETS, action) || !tx || !sameAddress(tx.from, owner) || !sameAddress(tx.to, TARGETS[action]) || tx.chainId !== CHAIN_ID || tx.value !== '0x0' || typeof tx.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(tx.data) || tx.data.slice(0, 10).toLowerCase() !== SELECTORS[action]) throw new Error('交易的账户、固定合约、网络、金额或操作方法不符合注册流程。');
  return { from: tx.from.toLowerCase(), to: tx.to.toLowerCase(), data: tx.data.toLowerCase(), chainId: CHAIN_ID, value: '0x0' };
}
function validatePending(value, plan) {
  if (!value || !Object.hasOwn(ACTIONS, value.action) || !sameAddress(value.owner, plan.owner) || value.name !== plan.name || value.planRandomness !== `${plan.secret}:${plan.salt}` || !['sending', 'pending', 'success', 'reverted'].includes(value.status) || (value.hash !== null && !HASH.test(value.hash)) || (value.status !== 'sending' && !value.hash) || (value.action === 'deploy' && !address(value.resolver))) throw new Error('已保存的交易记录无法校验。请保留浏览器数据并在钱包中核对，当前计划暂停发送。');
  validateTransaction(value.transaction, plan.owner, value.action);
  return value;
}
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  if (localStorage.getItem(key) !== JSON.stringify(value)) throw new Error('无法可靠保存计划。请启用此网站的浏览器存储后重试。');
}
function currentKey() { return state.plan ? planKey(state.plan.owner, state.plan.name) : ''; }
function pendingBlocks() { return Boolean(state.pending && !['success', 'reverted'].includes(state.pending.status)); }
function status(message, type = '') { $('status').textContent = message; $('status').className = `feedback ${type ? `is-${type}` : ''}`; }
function invalidate(message, clearInspection = true) {
  state.revision += 1; state.prepared = null; $('review').hidden = true;
  if (clearInspection) { state.inspected = null; $('registration-complete').hidden = true; }
  if (message) status(message);
  render();
}
function assertCurrent(revision) { if (revision !== state.revision) throw new Error('账户、网络或名称已变化。请重新读取状态并模拟。'); }
function errorMessage(error) {
  if (Number(error?.code) === 4001) return '你已取消钱包请求。';
  if (Number(error?.code) === 4902) return '请在钱包中启用 Sepolia 测试网，再重试切换。';
  if (Number(error?.code) === -32002) return '钱包中已有待处理请求，请先处理。';
  return error?.message || '操作失败，请检查状态后重试。';
}
function render() {
  const connected = Boolean(state.provider && state.account && state.chain === CHAIN_ID);
  const idle = !state.busy && !state.walletBusy && !state.receiptBusy;
  const ready = connected && idle && state.plan && !state.storageError && !pendingBlocks();
  $('connect-button').disabled = !$('wallet-select').value || !idle;
  $('wallet-select').disabled = !idle;
  $('switch-button').hidden = !state.provider || !state.account || state.chain === CHAIN_ID;
  $('switch-button').disabled = !idle;
  $('wallet-account').textContent = state.account || '未连接';
  $('wallet-chain').textContent = state.chain === CHAIN_ID ? 'Sepolia · 11155111' : state.chain ? `错误网络 · ${state.chain}（操作已禁用）` : '未读取';
  $('wallet-badge').textContent = state.account ? state.chain === CHAIN_ID ? 'Sepolia 已连接' : '请切换网络' : '未连接';
  $('create-plan-button').disabled = !connected || !idle || Boolean(state.storageError);
  $('restore-button').disabled = !connected || !idle || pendingBlocks();
  $('inspect-button').disabled = !connected || !idle || !state.plan || Boolean(state.storageError);
  $('plan-badge').textContent = state.storageError ? '存储需要恢复' : state.plan ? '计划已保存' : '候选名称';
  $('plan-backup').value = state.plan ? JSON.stringify(state.plan, null, 2) : '';
  for (const action of Object.keys(ACTIONS)) $(action + '-button').disabled = !ready || !state.inspected || Boolean(state.inspected.registered) || state.inspected.available !== true || (['commit', 'approve', 'register'].includes(action) && !state.plan.resolver);
  $('send-button').disabled = !ready || !state.prepared;
  $('discard-button').disabled = !idle;
  $('receipt-button').disabled = !idle || !state.pending?.hash || !pendingBlocks();
  $('recover-hash-button').disabled = !idle || state.pending?.status !== 'sending';
  const s = state.inspected;
  $('chain-badge').textContent = s ? '已读取 Sepolia 链上状态' : '等待读取测试网';
  $('chain-name').textContent = s?.name || '尚未读取';
  $('chain-price').textContent = s?.price?.formatted != null ? `${s.price.formatted}` : '—';
  $('chain-balance').textContent = s?.balance?.formatted != null ? `${s.balance.formatted}` : '—';
  $('chain-availability').textContent = s ? s.registered ? '已注册并核验' : s.available ? '当前可注册' : '当前不可注册' : '尚未读取';
  $('chain-resolver').textContent = s?.resolver || state.plan?.resolver || '尚未部署';
  countdown();
}
function countdown() {
  const s = state.inspected;
  if (!s) { $('commitment-wait').textContent = '读取链上状态后显示'; return; }
  if (s.registered) { $('commitment-wait').textContent = '注册已核验'; return; }
  const committed = Number(s.commitmentAt), ready = Number(s.readyAt), chain = Number(s.chainTimestamp);
  if (!committed) { $('commitment-wait').textContent = '尚未预约；commit 成功后开始计时'; return; }
  if (![committed, ready, chain].every(Number.isFinite)) { $('commitment-wait').textContent = '时间信息不可用，请重新读取'; return; }
  const estimated = chain + Math.floor((Date.now() - state.inspectedAt) / 1000);
  const remaining = Math.max(0, Math.ceil(ready - estimated));
  $('commitment-wait').textContent = remaining ? `按最近链上时间估算，还需约 ${remaining} 秒；发送前会重新核验` : '估算已到最短等待时间，请重新读取或模拟；以最新链上时间为准';
  if (Number(s.maxCommitmentAge) > 0 && estimated >= committed + Number(s.maxCommitmentAge)) $('commitment-wait').textContent = '预约估算已过期，请重新读取链上状态并重新预约';
}
function showPending() {
  const p = state.pending;
  $('receipt').hidden = !p;
  $('receipt-recovery').hidden = p?.status !== 'sending';
  if (!p) return;
  const labels = { sending: '发送结果未知', pending: '已提交 · 等待回执', success: '成功回执已确认', reverted: '交易已回滚' };
  $('receipt-state').textContent = labels[p.status];
  $('receipt-link').hidden = !p.hash;
  $('receipt-link').textContent = p.hash || '';
  if (p.hash) $('receipt-link').href = `https://sepolia.etherscan.io/tx/${p.hash}`;
  $('receipt-message').textContent = p.status === 'sending' ? `${ACTIONS[p.action]}：已打开过钱包，但尚无可确认的交易哈希。请在钱包中核对提交状态；本计划保持锁定，避免重复发送。` : p.status === 'pending' ? `${ACTIONS[p.action]}：已保存交易哈希。请主动检查回执；刷新不会自动重复发送。` : p.status === 'success' ? `${ACTIONS[p.action]}：回执成功。仍需读取最新链上状态核验结果。` : `${ACTIONS[p.action]}：链上执行回滚。请重新读取状态后再模拟，网络费可能已消耗。`;
}
function loadPlan() {
  state.plan = null; state.pending = null; state.storageError = '';
  if (!state.account) { showPending(); render(); return; }
  try {
    const name = normalizedName($('ens-name').value);
    const raw = localStorage.getItem(planKey(state.account, name));
    if (raw) state.plan = validatePlan(JSON.parse(raw), state.account, name);
    const pendingRaw = localStorage.getItem(pendingKey({ owner: state.account, name }));
    if (pendingRaw) {
      if (!state.plan) throw new Error('存在交易记录但缺少注册计划，请先恢复该名称的原始备份。');
      state.pending = validatePending(JSON.parse(pendingRaw), state.plan);
      if (['success', 'reverted'].includes(state.pending.status)) state.pending = { ...state.pending, status: 'pending' };
    }
  } catch (error) { state.storageError = errorMessage(error); status(state.storageError, 'error'); }
  showPending(); render();
}
async function api(path, body) {
  if (globalThis.RelayDeskRuntime) return globalThis.RelayDeskRuntime.request('registration', path, body);
  const response = await fetch(`/api/registration/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', redirect: 'error', body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）`);
  return result;
}
function validateInspection(result, plan) {
  if (!result || result.chainId !== 11155111 || !sameAddress(result.owner, plan.owner) || result.name !== plan.name || Object.entries(CONTRACTS).some(([key, value]) => !sameAddress(result.contracts?.[key], value)) || typeof result.available !== 'boolean' || typeof result.registered !== 'boolean') throw new Error('链上响应的账户、名称、网络或合约与注册计划不一致。');
  if (plan.resolver && !sameAddress(result.resolver, plan.resolver)) throw new Error('链上 Resolver 与保存的计划不一致。');
  return result;
}
function acceptInspection(result, plan) {
  state.inspected = validateInspection(result, plan); state.inspectedAt = Date.now();
  $('registration-complete').hidden = !result.registered;
  if (result.registered) $('completion-message').textContent = `${result.name} · 当前钱包 ${plan.owner} 的名称所有权、专属 Resolver 与权限已通过链上核验。`;
  render();
}
async function inspectPlan(revision) {
  const plan = { ...state.plan };
  const result = await api('inspect', plan); assertCurrent(revision); acceptInspection(result, plan); return result;
}
async function walletSnapshot(provider) {
  const [accounts, chain] = await Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]);
  return { account: Array.isArray(accounts) && address(accounts[0]) ? accounts[0] : '', chain: chainId(chain) };
}
async function revalidateWallet(revision) {
  const provider = state.provider;
  if (!provider) throw new Error('请先主动连接钱包。');
  const current = await walletSnapshot(provider); assertCurrent(revision);
  if (provider !== state.provider || !sameAddress(current.account, state.account) || current.chain !== state.chain) {
    state.account = current.account; state.chain = current.chain; invalidate(); loadPlan(); throw new Error('钱包账户或网络已变化，请重新读取并模拟。');
  }
  if (!current.account || current.chain !== CHAIN_ID) throw new Error('仅可使用已连接的 Sepolia 实际钱包账户。');
  return current;
}
function bindProvider(provider) {
  state.provider = provider; const session = ++state.walletSession;
  const changed = (account, chain) => { if (session !== state.walletSession) return; state.account = account; state.chain = chain; invalidate('钱包状态已变化，请读取当前名称的链上状态。'); loadPlan(); };
  provider.on?.('accountsChanged', accounts => changed(Array.isArray(accounts) && address(accounts[0]) ? accounts[0] : '', state.chain));
  provider.on?.('chainChanged', chain => changed(state.account, chainId(chain)));
  provider.on?.('disconnect', () => changed('', ''));
  return session;
}
function addWallet(provider, label) {
  if (!provider || typeof provider.request !== 'function' || wallets.some(wallet => wallet.provider === provider)) return;
  wallets.push({ provider, label }); const option = document.createElement('option'); option.value = String(wallets.length - 1); option.textContent = label; $('wallet-select').append(option);
}
addWallet(window.okxwallet, 'OKX Wallet');
addWallet(window.ethereum, window.ethereum?.isMetaMask ? 'MetaMask / Ethereum 钱包' : '浏览器 Ethereum 钱包');
$('wallet-help').textContent = wallets.length ? '先明确选择钱包，再连接。本站永不请求助记词或私钥。' : '未检测到钱包扩展。Codex 应用内浏览器可能不支持扩展；请在装有钱包的 Chrome 中打开同一网址并刷新。';
$('wallet-select').addEventListener('change', () => { state.walletSession += 1; state.provider = null; state.account = ''; state.chain = ''; invalidate('已更换钱包选择，请主动连接。'); loadPlan(); });
$('ens-name').addEventListener('input', () => { invalidate('名称已变化，请创建或载入此名称对应的计划。'); loadPlan(); });
$('connect-button').addEventListener('click', async () => {
  const selected = $('wallet-select').value; const wallet = wallets[Number(selected)];
  if (!selected || !wallet || state.busy || state.walletBusy) return;
  state.walletBusy = true; invalidate(); const session = bindProvider(wallet.provider); render();
  try {
    await wallet.provider.request({ method: 'eth_requestAccounts' });
    const current = await walletSnapshot(wallet.provider);
    if (session !== state.walletSession) throw new Error('钱包选择已变化，请重新连接。');
    state.account = current.account; state.chain = current.chain; loadPlan();
    if (!state.storageError) status(current.account ? current.chain === CHAIN_ID ? '实际账户已连接。可创建、载入或恢复注册计划。' : '已连接钱包，请主动切换到 Sepolia。' : '钱包未提供账户，请在钱包中确认连接。');
  } catch (error) { status(errorMessage(error), 'error'); }
  finally { state.walletBusy = false; render(); }
});
$('switch-button').addEventListener('click', async () => {
  if (!state.provider || state.busy || state.walletBusy) return;
  state.walletBusy = true; invalidate(); const provider = state.provider; const session = state.walletSession;
  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] }); const current = await walletSnapshot(provider); if (session !== state.walletSession) throw new Error('钱包选择已变化。'); state.account = current.account; state.chain = current.chain; loadPlan(); status(current.chain === CHAIN_ID ? '已切换到 Sepolia，请读取链上状态。' : '当前网络仍不是 Sepolia。'); }
  catch (error) { status(errorMessage(error), 'error'); }
  finally { state.walletBusy = false; render(); }
});
function random32() { return '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''); }
$('create-plan-button').addEventListener('click', async () => {
  if (state.busy || state.walletBusy || state.storageError) return;
  state.busy = true; invalidate(); const revision = state.revision;
  try {
    await revalidateWallet(revision); const name = normalizedName($('ens-name').value); $('ens-name').value = name;
    loadPlan(); if (state.storageError) throw new Error(state.storageError);
    if (!state.plan) { const plan = validatePlan({ owner: state.account, name, secret: random32(), salt: random32(), resolver: null }); save(planKey(plan.owner, plan.name), plan); state.plan = plan; }
    await inspectPlan(revision); status('计划已保存并读取链上状态。请备份计划，然后逐步模拟操作。', 'success');
  } catch (error) { if (revision === state.revision) status(errorMessage(error), 'error'); }
  finally { state.busy = false; render(); }
});
$('restore-button').addEventListener('click', async () => {
  if (state.busy || state.walletBusy || pendingBlocks()) return;
  state.busy = true; invalidate(); const revision = state.revision;
  try {
    await revalidateWallet(revision); const plan = validatePlan(JSON.parse($('plan-restore').value));
    if (state.plan && JSON.stringify(plan) !== JSON.stringify(state.plan)) throw new Error('此账户和名称已有有效计划，不能用不同随机数覆盖。请使用已保存计划。');
    const pendingRaw = localStorage.getItem(pendingKey(plan)); if (pendingRaw) validatePending(JSON.parse(pendingRaw), plan);
    save(planKey(plan.owner, plan.name), plan); loadPlan(); if (state.storageError) throw new Error(state.storageError); $('plan-restore').value = '';
    await inspectPlan(revision); status('已恢复原始计划，并重新读取链上状态。', 'success');
  } catch (error) { if (revision === state.revision) status(errorMessage(error), 'error'); }
  finally { state.busy = false; render(); }
});
$('inspect-button').addEventListener('click', async () => {
  if (!state.plan || state.busy || state.walletBusy) return;
  state.busy = true; invalidate(); const revision = state.revision;
  try { await revalidateWallet(revision); const result = await inspectPlan(revision); status(result.registered ? '当前账户的名称所有权、Resolver 与权限已在链上核验。' : result.available ? '链上状态已更新。请选择下一步操作。' : '此名称当前不可注册。注册价格不可用；请检查已有记录或更换候选名称。', result.registered ? 'success' : ''); }
  catch (error) { if (revision === state.revision) status(errorMessage(error), 'error'); }
  finally { state.busy = false; render(); }
});
function transaction(result, request) {
  const tx = result.transaction;
  validateInspection(result.inspected, request);
  if (result.status !== 'ready' || result.action !== request.action || (request.action === 'deploy' && !address(result.resolver))) throw new Error('准备结果的操作或部署地址不符合注册流程。');
  const validated = validateTransaction(tx, request.owner, request.action);
  const word = value => value.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  if (request.action === 'mint' && validated.data !== SELECTORS.mint + word(request.owner) + word((25000000n).toString(16))) throw new Error('铸造操作的接收账户或 25 MockUSDC 数量不匹配。');
  if (request.action === 'approve' && (!/^\d+$/.test(String(result.inspected.price?.raw)) || validated.data !== SELECTORS.approve + word(CONTRACTS.registrar) + word(BigInt(result.inspected.price.raw).toString(16)))) throw new Error('授权操作的接收方或当前注册价不匹配。');
  if (request.action === 'commit' && validated.data !== SELECTORS.commit + word(String(result.inspected.commitment))) throw new Error('预约承诺与链上模拟结果不匹配。');
  return validated;
}
function showReview(prepared) {
  const rows = [['测试名称', prepared.request.name], ['操作', ACTIONS[prepared.request.action]], ['实际账户', prepared.tx.from], ['目标合约', prepared.tx.to], ['网络', 'Sepolia · 11155111 · 0xaa36a7'], ['转账金额', '0 ETH（另需 Sepolia ETH 网络费）'], ['操作摘要', prepared.summary]];
  if (prepared.resolver) rows.push(['部署地址', prepared.resolver]);
  if (prepared.request.action === 'approve') { rows.push(['授权接收方', CONTRACTS.registrar], ['授权额度', `${state.inspected.price?.formatted ?? '未知'} MockUSDC · 原始单位 ${state.inspected.price?.raw ?? '未知'}`]); }
  $('review-details').replaceChildren();
  for (const [label, value] of rows) { const row = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; row.append(dt, dd); $('review-details').append(row); }
  $('review-data').textContent = prepared.tx.data; $('review').hidden = false;
}
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', async () => {
  if (!state.plan || state.busy || state.walletBusy || pendingBlocks() || state.storageError) return;
  state.busy = true; invalidate(); const revision = state.revision; render(); status('正在核验实际账户并模拟这一步操作…');
  try {
    await revalidateWallet(revision); const request = { ...state.plan, action: button.dataset.action }; const result = await api('prepare', request); assertCurrent(revision); await revalidateWallet(revision);
    if (result.status === 'skipped') { if (result.action !== request.action) throw new Error('准备响应的操作不匹配。'); acceptInspection(result.inspected, request); status(`无需发送交易：${result.summary || '此步骤已满足。'}`); return; }
    const tx = transaction(result, request); acceptInspection(result.inspected, request);
    state.prepared = { request, tx, revision, summary: String(result.summary || ACTIONS[request.action]), resolver: result.resolver?.toLowerCase() || null };
    showReview(state.prepared); status('模拟通过，尚未发送。请核对交易详情，再主动确认。', 'success');
  } catch (error) { if (revision === state.revision) status(errorMessage(error), 'error'); }
  finally { state.busy = false; render(); }
});
$('discard-button').addEventListener('click', () => { if (!state.busy) invalidate('已取消本次准备，没有发送交易。', false); });
$('send-button').addEventListener('click', async () => {
  const prepared = state.prepared;
  if (!prepared || state.busy || state.walletBusy || pendingBlocks() || state.storageError) return;
  const revision = prepared.revision; const plan = { ...state.plan }; const key = pendingKey(plan); let submitted = false; let claimed = false; let previousPendingRaw = null; let record;
  state.busy = true; render(); status('正在重新模拟并核对交易参数…');
  try {
    assertCurrent(revision); await revalidateWallet(revision);
    const request = { ...state.plan, action: prepared.request.action };
    if (JSON.stringify(request) !== JSON.stringify(prepared.request)) throw new Error('计划参数已变化，请重新模拟。');
    const fresh = await api('prepare', request); assertCurrent(revision); const tx = transaction(fresh, request);
    if (JSON.stringify(tx) !== JSON.stringify(prepared.tx) || (fresh.resolver?.toLowerCase() || null) !== prepared.resolver || String(fresh.summary || ACTIONS[request.action]) !== prepared.summary) throw new Error('链上准备结果已变化，请重新模拟并核对。');
    await revalidateWallet(revision); assertCurrent(revision);
    record = { owner: plan.owner, name: plan.name, planRandomness: `${plan.secret}:${plan.salt}`, action: request.action, resolver: prepared.resolver, transaction: tx, hash: null, status: 'sending' };
    if (!globalThis.navigator?.locks?.request) throw new Error('当前浏览器无法安全协调多个页面的提交。请使用支持 Web Locks 的 Chrome，并在单个页面中操作。');
    await navigator.locks.request(key, () => {
      assertCurrent(revision);
      const storedPlan = localStorage.getItem(planKey(plan.owner, plan.name));
      if (!storedPlan || JSON.stringify(validatePlan(JSON.parse(storedPlan), plan.owner, plan.name)) !== JSON.stringify(plan)) throw new Error('其他页面修改了注册计划，请重新载入。');
      const raw = localStorage.getItem(key); previousPendingRaw = raw;
      if (raw) { const existing = validatePending(JSON.parse(raw), plan); if (!['success', 'reverted'].includes(existing.status) || !state.pending || existing.hash !== state.pending.hash || existing.status !== state.pending.status) throw new Error('此名称存在另一笔尚未核验的交易，请载入并检查回执。'); }
      save(key, record); claimed = true;
    });
    assertCurrent(revision);
    await revalidateWallet(revision);
    assertCurrent(revision);
    state.pending = record; showPending(); render();
    const provider = state.provider; submitted = true; status('请在钱包中核对并确认这笔 Sepolia 交易…');
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
    if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('钱包未返回有效交易哈希。请核对钱包中的提交状态，避免重发。');
    record = { ...record, hash, status: 'pending' }; save(key, record);
    if (currentKey() === planKey(plan.owner, plan.name)) { state.pending = record; showPending(); }
    invalidate('交易已提交并保存。请主动检查链上回执。');
  } catch (error) {
    if (claimed && (!submitted || Number(error?.code) === 4001)) {
      try {
        await navigator.locks.request(key, () => {
          if (localStorage.getItem(key) !== JSON.stringify(record)) return;
          if (previousPendingRaw) localStorage.setItem(key, previousPendingRaw); else localStorage.removeItem(key);
        });
        if (currentKey() === planKey(plan.owner, plan.name)) loadPlan();
      } catch { /* Keep the durable sending lock if browser storage is unavailable. */ }
    }
    if (submitted && Number(error?.code) !== 4001 && record) { if (currentKey() === planKey(plan.owner, plan.name)) state.pending = record; }
    invalidate(); showPending(); status(`${errorMessage(error)}${submitted && Number(error?.code) !== 4001 ? ' 本计划保持锁定，请先在钱包中核对。' : ''}`, 'error');
  } finally { state.busy = false; render(); }
});
function assertReceiptEffect(pending, inspected, plan) {
  const data = pending.transaction.data.toLowerCase();
  let matches = false;
  if (pending.action === 'mint') matches = BigInt(inspected.balance?.raw ?? '-1') >= 25_000_000n;
  if (pending.action === 'deploy') matches = sameAddress(inspected.resolver, pending.resolver) && plan.deploymentHash === pending.hash.toLowerCase();
  if (pending.action === 'approve' && data.length === 138) {
    const spender = `0x${data.slice(34, 74)}`;
    const amount = BigInt(`0x${data.slice(74)}`);
    matches = sameAddress(spender, CONTRACTS.registrar) && BigInt(inspected.allowanceRaw ?? '-1') === amount;
  }
  if (pending.action === 'commit') matches = data.length === 74 && inspected.commitment?.toLowerCase() === `0x${data.slice(10)}` && Number(inspected.commitmentAt) > 0;
  if (pending.action === 'register') matches = inspected.registered === true;
  if (!matches) throw new Error('交易回执成功，但本计划预期的链上效果尚未核验。保留待确认记录，请勿重复发送；可再次检查回执。');
}
$('receipt-button').addEventListener('click', async () => {
  const pending = state.pending; const plan = state.plan ? { ...state.plan } : null;
  if (!pending?.hash || !plan || state.receiptBusy || state.busy) return;
  const key = currentKey(); const revision = state.revision;
  const originalPlan = localStorage.getItem(key), originalPending = localStorage.getItem(pendingKey(plan));
  state.receiptBusy = true; render(); $('receipt-message').textContent = '正在读取 Sepolia 链上回执…';
  try {
    const result = await api('receipt', { hash: pending.hash, expected: pending.transaction });
    if (!result.hash || result.hash.toLowerCase() !== pending.hash.toLowerCase()) throw new Error('回执哈希不匹配，请在交易浏览器中核对。');
    if (result.status === 'pending') { if (currentKey() === key) $('receipt-message').textContent = '尚未获得回执，交易可能仍在等待打包。请稍后再次检查。'; return; }
    if (!['success', 'reverted'].includes(result.status) || result.transactionVerified !== true) throw new Error('回执状态或交易身份尚未通过核验，继续保留待确认记录。');
    let inspected = null;
    if (result.status === 'success') {
      if (pending.action === 'deploy') { plan.resolver = pending.resolver.toLowerCase(); plan.deploymentHash = pending.hash.toLowerCase(); }
      inspected = validateInspection(await api('inspect', plan), plan);
      assertReceiptEffect(pending, inspected, plan);
    }
    if (currentKey() !== key || revision !== state.revision) return;
    const completed = { ...pending, status: result.status };
    await navigator.locks.request(pendingKey(plan), () => {
      assertCurrent(revision);
      if (localStorage.getItem(key) !== originalPlan || localStorage.getItem(pendingKey(plan)) !== originalPending) throw new Error('其他页面已更改计划或交易记录，请重新载入后核验。');
      save(key, plan); save(pendingKey(plan), completed);
    });
    if (currentKey() !== key || revision !== state.revision) return;
    state.plan = plan; state.pending = completed; invalidate(); showPending();
    if (result.status === 'reverted') { status('交易已上链但执行回滚，请重新读取链上状态后再模拟。', 'error'); return; }
    acceptInspection(inspected, plan);
    status(inspected.registered ? '注册完成：当前账户的名称所有权、Resolver 与权限已通过链上核验。' : `${ACTIONS[pending.action]}的成功回执及本计划对应的链上效果均已核验。`, 'success');
  } catch (error) { if (currentKey() === key) { $('receipt-message').textContent = `查询或核验失败：${errorMessage(error)} 请保留交易记录，再次检查回执或读取链上状态。`; status(errorMessage(error), 'error'); } }
  finally { state.receiptBusy = false; render(); }
});
window.addEventListener?.('storage', event => {
  if (event.key?.startsWith('relaydesk:registration:v1:')) { invalidate('另一页面更新了注册计划或交易记录，请重新读取并检查回执。'); loadPlan(); }
});
$('recover-hash-button').addEventListener('click', async () => {
  const pending = state.pending; const plan = state.plan; const key = currentKey(); const hash = $('recovery-hash').value.trim();
  if (state.busy || state.walletBusy || state.receiptBusy || pending?.status !== 'sending' || !plan) return;
  if (!HASH.test(hash)) { status('请输入钱包中完整的交易哈希。', 'error'); return; }
  state.receiptBusy = true; render();
  try {
    const result = await api('receipt', { hash, expected: pending.transaction });
    if (result.status === 'pending') throw new Error('该交易尚未取得链上回执，暂时无法证明它与原交易一致。请等待确认后再恢复。');
    if (!['success', 'reverted'].includes(result.status) || result.transactionVerified !== true || result.hash?.toLowerCase() !== hash.toLowerCase()) throw new Error('此交易尚未通过原交易身份核验，保持原有锁定状态。');
    const recovered = { ...pending, hash, status: 'pending' }; save(pendingKey(plan), recovered);
    if (currentKey() === key) { state.pending = recovered; showPending(); status('已核验并恢复原交易哈希。请点击检查链上回执，继续核验本次操作结果。', 'success'); }
  } catch (error) { status(errorMessage(error), 'error'); }
  finally { state.receiptBusy = false; render(); }
});
setInterval(countdown, 1000);
render();
