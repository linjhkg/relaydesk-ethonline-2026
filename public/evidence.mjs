const refresh = document.getElementById('refresh-live');
const status = document.getElementById('live-status');
refresh.addEventListener('click', async () => {
  refresh.disabled = true;
  status.textContent = 'Reading Ethereum Sepolia…';
  try {
    let result;
    if (globalThis.RelayDeskRuntime) result = await globalThis.RelayDeskRuntime.request('ens', 'inspect', {name:'relaydesk2026.eth'});
    else {
      const response = await fetch('/api/ens/inspect', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'relaydesk2026.eth'})});
      result = await response.json();
      if (!response.ok) throw new Error(result.error || 'RPC request failed.');
    }
    if (result.chainId !== 11155111 || result.name !== 'relaydesk2026.eth') throw new Error('Unexpected network or name.');
    document.getElementById('live-resolver').textContent = result.resolver;
    document.getElementById('live-url').textContent = result.url || 'No url record is currently set.';
    status.textContent = 'Live Sepolia read completed. This does not grant permissions or send a transaction.';
  } catch (error) {
    status.textContent = `Could not verify the live record: ${error.shortMessage || error.message}`;
  } finally { refresh.disabled = false; }
});
