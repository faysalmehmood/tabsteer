const $ = (id) => document.getElementById(id);
const ALL_SITES = { origins: ['<all_urls>'] };

let tab = null;
let sitePattern = null;

const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

async function render() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = await send('ui:state', { tabId: tab ? tab.id : null });

  const status = $('status');
  if (state.paused) {
    status.textContent = 'Paused';
    status.className = 'pill warn';
  } else if (state.connected) {
    status.textContent = 'Connected';
    status.className = 'pill ok';
  } else {
    status.textContent = 'Not connected';
    status.className = 'pill bad';
  }
  $('setup').hidden = state.connected;
  $('host-error').textContent = state.hostError || '';
  $('pause').textContent = state.paused ? 'Resume' : 'Pause';
  $('pause').onclick = async () => {
    await send('ui:pause', { paused: !state.paused });
    render();
  };
  $('count').textContent = state.sharedCount === 1 ? '1 tab shared' : `${state.sharedCount} tabs shared`;

  let url = null;
  try {
    url = tab && tab.url ? new URL(tab.url) : null;
  } catch (e) {}
  const shareable = !!url && (url.protocol === 'http:' || url.protocol === 'https:');
  for (const id of ['share', 'unshare', 'allow', 'revoke', 'allow-all']) $(id).hidden = true;

  if (!shareable) {
    $('site').textContent = 'This page';
    $('facts').textContent = "Tab Steer can't be used on this kind of page.";
    return;
  }

  sitePattern = `${url.protocol}//${url.host}/*`;
  const everywhere = await chrome.permissions.contains(ALL_SITES);
  const allowed = everywhere || (await chrome.permissions.contains({ origins: [sitePattern] }));

  $('site').textContent = url.host;
  $('facts').textContent =
    (state.shared ? 'Shared with your agent' : 'Not shared') +
    ' · ' +
    (everywhere ? 'all sites allowed' : allowed ? 'site allowed' : 'site not allowed');

  $('share').hidden = state.shared;
  $('unshare').hidden = !state.shared;
  $('allow').hidden = allowed;
  $('allow').textContent = `Allow on ${url.host}`;
  $('revoke').hidden = !allowed;
  $('revoke').textContent = everywhere ? 'Stop allowing all sites' : `Stop allowing ${url.host}`;
  $('allow-all').hidden = everywhere;

  // Sharing a tab is only useful with site access, so one click asks for both.
  // The share message goes first because the permission prompt can close this popup.
  $('share').onclick = () => {
    const sharing = send('ui:share', { tabId: tab.id });
    if (allowed) return sharing.then(render);
    chrome.permissions.request({ origins: [sitePattern] }).then(render, render);
  };
  $('unshare').onclick = async () => {
    await send('ui:unshare', { tabId: tab.id });
    render();
  };
  $('allow').onclick = () => chrome.permissions.request({ origins: [sitePattern] }).then(render, render);
  $('allow-all').onclick = () => chrome.permissions.request(ALL_SITES).then(render, render);
  $('revoke').onclick = async () => {
    await chrome.permissions.remove(everywhere ? ALL_SITES : { origins: [sitePattern] });
    render();
  };
}

render();
