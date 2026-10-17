const $ = (id) => document.getElementById(id);
const ALL_SITES = { origins: ['<all_urls>'] };

const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = await send('ui:state', { tabId: tab ? tab.id : null, url: tab ? tab.url : null });

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
  $('turn-on').hidden = state.turnedOn;
  $('pause').textContent = state.paused ? 'Resume' : 'Pause';
  $('count').textContent = state.sharedCount === 1 ? '1 tab shared' : `${state.sharedCount} tabs shared`;

  for (const id of ['share', 'unshare', 'allow', 'revoke']) $(id).hidden = true;
  if (!state.origin) {
    $('site').textContent = 'This page';
    $('facts').textContent = "Tab Steer can't be used on this kind of page.";
  } else {
    const host = new URL(state.origin).host;
    $('site').textContent = host;
    $('facts').textContent = `${state.shared ? 'Shared with your agent' : 'Not shared'} · ${state.siteAllowed ? 'site allowed' : 'site not allowed'}`;
    $('share').hidden = state.shared;
    $('unshare').hidden = !state.shared;
    $('allow').hidden = state.siteAllowed || !state.shared;
    $('allow').textContent = `Allow ${host}`;
    $('revoke').hidden = !state.siteAllowed || state.allowAllSites;
    $('revoke').textContent = `Stop allowing ${host}`;
  }

  // Permission prompts need the click itself, so they are requested straight
  // from these handlers. Sharing also allows the tab's site.
  const turnOn = () => (state.turnedOn ? Promise.resolve(true) : chrome.permissions.request(ALL_SITES));
  $('turn-on-button').onclick = () => turnOn().then(render, render);
  $('share').onclick = () => {
    const sharing = send('ui:share', { tabId: tab.id, origin: state.origin });
    turnOn().then(() => sharing).then(render, render);
  };
  $('unshare').onclick = () => send('ui:unshare', { tabId: tab.id }).then(render);
  $('allow').onclick = () => {
    const allowing = send('ui:allow', { origin: state.origin });
    turnOn().then(() => allowing).then(render, render);
  };
  $('revoke').onclick = () => send('ui:revoke', { origin: state.origin }).then(render);
  $('pause').onclick = () => send('ui:pause', { paused: !state.paused }).then(render);
  $('panel').onclick = () => {
    chrome.sidePanel.open({ windowId: tab.windowId }).then(() => window.close(), () => {});
  };
}

render();
