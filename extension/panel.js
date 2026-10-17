const $ = (id) => document.getElementById(id);
const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

const LABELS = {
  open: 'Opened', navigate: 'Went to', back: 'Went back', close: 'Closed tab', read: 'Read page',
  click: 'Clicked', type: 'Typed', press: 'Pressed', scroll: 'Scrolled', wait: 'Waited for', snap: 'Took screenshot',
};

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function renderActivity() {
  const { activity = [] } = await chrome.storage.session.get('activity');
  const list = $('activity');
  list.replaceChildren(
    ...activity
      .slice()
      .reverse()
      .map((a) => {
        const when = new Date(a.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const detail = a.ok ? a.detail || '' : `Refused or failed: ${a.error}`;
        return el(
          'li',
          { className: 'entry' },
          el('time', { textContent: when }),
          el('span', { className: `what${a.ok ? '' : ' failed'}`, textContent: LABELS[a.action] || a.action }),
          el('span', { className: 'detail', textContent: detail })
        );
      })
  );
  $('activity-empty').hidden = activity.length > 0;
}

async function renderSettings() {
  const state = await send('ui:state', {});
  const status = $('status');
  status.textContent = state.paused ? 'Paused' : state.connected ? 'Connected' : 'Not connected';
  status.className = `pill ${state.paused ? 'warn' : state.connected ? 'ok' : 'bad'}`;
  $('off').hidden = state.turnedOn;
  $('all-sites').checked = state.allowAllSites;
  $('sites').replaceChildren(
    ...state.allowedSites.map((origin) => {
      const remove = el('button', { className: 'small', textContent: 'Remove' });
      remove.setAttribute('aria-label', `Stop allowing ${origin}`);
      remove.onclick = () => send('ui:revoke', { origin }).then(renderSettings);
      return el('li', { className: 'site-row' }, el('span', { textContent: origin.replace(/^https?:\/\//, '') }), remove);
    })
  );
  $('sites-empty').hidden = state.allowedSites.length > 0;
}

$('clear').onclick = () => send('ui:clearActivity').then(renderActivity);
$('all-sites').onchange = (e) => send('ui:allowAll', { value: e.target.checked }).then(renderSettings);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.activity) renderActivity();
  if (area === 'local') renderSettings();
});
chrome.permissions.onAdded.addListener(renderSettings);
chrome.permissions.onRemoved.addListener(renderSettings);
setInterval(renderSettings, 5000);

renderActivity();
renderSettings();
