const $ = (selector) => document.querySelector(selector);
const roleNames = { owner: '负责人', volunteer: '志愿者', outsider: '其他人' };
const roleDescriptions = {
  owner: '负责人可授权、撤销和更新链接。切换角色可验证权限边界。',
  volunteer: '志愿者仅在获授权后可更新 url；授权和撤销操作会被拒绝。',
  outsider: '其他人没有修改权限。你仍可尝试操作，观察服务端如何拒绝。',
};
const actionNames = { grant: '授予 URL 修改权限', revoke: '撤销 URL 修改权限', update: '更新报名链接', reset: '重置演示', init: '创建本地演示' };
let currentRole = 'owner';
let busy = false;

function setBusy(value) {
  busy = value;
  document.querySelectorAll('[data-command-button], [data-role]').forEach((button) => { button.disabled = value; });
  $('#url-input').disabled = value;
  $('#url-form').setAttribute('aria-busy', String(value));
}

function feedback(message, kind = '') {
  $('#feedback').className = `feedback${kind ? ` is-${kind}` : ''}`;
  $('#feedback-text').textContent = message;
  $('.feedback-icon').textContent = kind === 'success' ? '✓' : kind === 'error' ? '!' : 'i';
}

function selectRole(role) {
  currentRole = role;
  document.querySelectorAll('[data-role]').forEach((button) => {
    const selected = button.dataset.role === role;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('#role-explanation').textContent = roleDescriptions[role];
}

function explainError(message) {
  if (message.startsWith('Access denied.')) return '当前角色没有有效的 URL 编辑权限，请由负责人授权。';
  if (message.startsWith('Only the owner')) return '只有负责人可以授予或撤销权限。';
  if (message.includes('credentials')) return '链接不能包含用户名或密码。';
  if (message.includes('HTTPS URL')) return '请填写格式正确的 HTTPS 链接。';
  return message;
}

function safeHTTPS(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function render(state) {
  $('#event-name').textContent = state.name;
  $('#preview-name').textContent = state.name;
  $('#url-input').value = state.url;
  $('#preview-url').textContent = state.url;
  $('#revision').textContent = `LOCAL / REV ${String(state.revision).padStart(2, '0')}`;
  const granted = state.grants.some((grant) => grant.actor === 'volunteer' && grant.key === 'url' && grant.active);
  $('#grant-badge').textContent = granted ? '已授权' : '未授权';
  $('#grant-badge').className = `pill${granted ? ' is-active' : ''}`;
  $('#url-permission').textContent = granted ? '允许修改' : '需要授权';
  $('#url-permission').className = granted ? 'permission-yes' : 'permission-no';
  const link = safeHTTPS(state.url);
  if (link) $('#attendee-link').href = link;
  else $('#attendee-link').removeAttribute('href');
  $('#attendee-link').setAttribute('aria-disabled', String(!link));
  $('#audit-count').textContent = `${state.audit.length} 条记录`;
  const items = state.audit.slice().reverse().map((entry) => {
    const item = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = 'audit-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = entry.action === 'grant' ? '+' : entry.action === 'revoke' ? '−' : '↗';
    const body = document.createElement('div');
    body.className = 'audit-entry';
    const top = document.createElement('div');
    top.className = 'audit-entry-top';
    const title = document.createElement('strong');
    title.className = 'audit-title';
    title.textContent = actionNames[entry.action] || entry.action;
    const sequence = document.createElement('span');
    sequence.className = 'audit-sequence';
    sequence.textContent = `#${entry.id}`;
    const detail = document.createElement('p');
    detail.className = 'audit-detail';
    detail.textContent = `${roleNames[entry.actor] || entry.actor} · ${entry.detail}`;
    top.append(title, sequence);
    body.append(top, detail);
    item.append(icon, body);
    return item;
  });
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = '还没有交接记录。试着授予志愿者 URL 修改权限。';
    items.push(empty);
  }
  $('#audit-list').replaceChildren(...items);
}

async function request(path, body) {
  if (globalThis.RelayDeskRuntime) return globalThis.RelayDeskRuntime.request('demo', path, body);
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('本地服务未返回有效数据，请确认演示服务正在运行。'); }
  if (!response.ok) throw new Error(data.error || '本次操作未被接受。');
  return data;
}

async function command(type, value, actor = currentRole) {
  if (busy) return;
  setBusy(true);
  try {
    const state = await request('/api/command', { type, actor, ...(value === undefined ? {} : { value }) });
    render(state);
    const messages = { grant: '权限已授予。切换至志愿者，即可更新报名链接。', revoke: '权限已撤销。志愿者的后续修改将被拒绝，现有报名链接保持可用。', update: '报名链接已更新。活动名称保持不变，参会者预览已同步。' };
    feedback(`${roleNames[actor]}：${messages[type]}（本地模拟，未上链）`, 'success');
  } catch (error) {
    feedback(`${roleNames[actor]}的操作未完成：${explainError(error.message)} 输入内容尚未保存，参会者预览和交接记录保持不变。`, 'error');
  } finally { setBusy(false); }
}

document.querySelectorAll('[data-role]').forEach((button) => {
  button.addEventListener('click', () => {
    selectRole(button.dataset.role);
    feedback(`已切换至${roleNames[currentRole]}演示角色。${roleDescriptions[currentRole]}此选择不是身份认证。`);
  });
});
$('#url-form').addEventListener('submit', (event) => {
  event.preventDefault();
  command('update', $('#url-input').value);
});
$('#grant-button').addEventListener('click', () => command('grant'));
$('#revoke-button').addEventListener('click', () => command('revoke'));
$('#outsider-attempt').addEventListener('click', () => {
  selectRole('outsider');
  command('update', 'https://example.org/unauthorized-attempt', 'outsider');
});
$('#unsafe-attempt').addEventListener('click', () => {
  $('#url-input').value = 'javascript:alert(1)';
  command('update', $('#url-input').value);
});
$('#reset-button').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    render(await request('/api/reset', {}));
    selectRole('owner');
    feedback('本地演示已重置。可以从负责人授权开始，重新体验交接。', 'success');
  } catch (error) { feedback(`重置未完成：${error.message}`, 'error'); }
  finally { setBusy(false); }
});

setBusy(true);
try {
  render(await request('/api/state'));
  feedback('本地演示已就绪。试着授权 → 切换志愿者 → 更新链接 → 撤销，再验证权限边界。');
} catch (error) {
  feedback(`无法加载演示：${error.message} 请在服务可用后刷新页面。`, 'error');
} finally { setBusy(false); }
