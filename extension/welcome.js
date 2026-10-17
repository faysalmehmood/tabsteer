const $ = (id) => document.getElementById(id);
const ALL_SITES = { origins: ['<all_urls>'] };

function mark(stepId, pillId, done, onText, offText) {
  $(stepId).classList.toggle('done', done);
  $(pillId).className = `pill ${done ? 'ok' : 'bad'}`;
  $(pillId).textContent = done ? onText : offText;
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'ui:state' });
  mark('step-companion', 'companion-status', !!(state && state.connected), 'Connected', 'Not connected');
  const on = await chrome.permissions.contains(ALL_SITES);
  mark('step-on', 'on-status', on, 'On', 'Off');
  $('turn-on').hidden = on;
}

$('copy').onclick = async () => {
  await navigator.clipboard.writeText($('install-command').textContent);
  $('copy').textContent = 'Copied';
  setTimeout(() => ($('copy').textContent = 'Copy'), 2000);
};
$('turn-on').onclick = () => chrome.permissions.request(ALL_SITES).then(refresh, refresh);

refresh();
setInterval(refresh, 3000);
