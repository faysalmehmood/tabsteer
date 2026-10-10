const status = document.getElementById('status');

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'ui:state', tabId: null });
  const connected = !!(state && state.connected);
  status.className = `status ${connected ? 'ok' : 'bad'}`;
  status.firstChild.textContent = connected ? 'Connected' : 'Not connected';
  status.querySelector('span').textContent = connected
    ? 'The companion is installed and running.'
    : 'The companion is not installed yet. Follow step 1.';
}

refresh();
setInterval(refresh, 3000);
