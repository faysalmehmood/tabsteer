// Tab Steer service worker: bridges the native messaging host to the tabs the
// user has shared. Everything the agent may touch is decided here, from state
// only the user can change (tab group membership, site permissions, pause).

const HOST_NAME = 'dev.tabsteer.host';
const GROUP_TITLE = 'Tab Steer';
const VERSION = chrome.runtime.getManifest().version;
const LOAD_TIMEOUT_MS = 15000;
const MAX_WAIT_MS = 25000;

let port = null;
let hostReady = false;
let hostError = null;

// ------------------------------------------------------------ native host
function connect() {
  if (port) return;
  let p;
  try {
    p = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    hostError = e.message;
    return;
  }
  port = p;
  p.onMessage.addListener(async (msg) => {
    if (msg.type === 'hello_ack') {
      hostReady = true;
      hostError = null;
      return;
    }
    const response = await handle(msg);
    try {
      p.postMessage(response);
    } catch (e) {}
  });
  p.onDisconnect.addListener(() => {
    const wasReady = hostReady;
    hostError = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
    if (port === p) {
      port = null;
      hostReady = false;
    }
    // A host that was working and died is worth a quick retry; a host that
    // never started is left to the alarm below.
    if (wasReady) setTimeout(connect, 2000);
  });
  p.postMessage({ type: 'hello', version: VERSION });
}

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('reconnect', { periodInMinutes: 1 });
  connect();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'reconnect') connect();
});
connect();
refreshBadge();

// ------------------------------------------------------------ user state
async function isPaused() {
  return !!(await chrome.storage.local.get('paused')).paused;
}

async function refreshBadge() {
  const paused = await isPaused();
  await chrome.action.setBadgeText({ text: paused ? 'II' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#b45309' });
}

// A tab is shared when it sits in a tab group titled "Tab Steer". The user
// shares and unshares by moving tabs in and out of that group.
async function sharedTabs() {
  const groups = await chrome.tabGroups.query({ title: GROUP_TITLE });
  const lists = await Promise.all(groups.map((g) => chrome.tabs.query({ groupId: g.id })));
  return lists.flat();
}

async function shareTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const [group] = await chrome.tabGroups.query({ title: GROUP_TITLE, windowId: tab.windowId });
  if (group) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: group.id });
  } else {
    const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
    await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: 'blue' });
  }
}

async function resolveTab(tabId) {
  const tabs = await sharedTabs();
  if (tabId != null) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) throw new Error(`Tab ${tabId} is not shared with Tab Steer. Run "tabsteer tabs" to list shared tabs.`);
    return tab;
  }
  if (!tabs.length) {
    throw new Error('No tabs are shared. Run "tabsteer open <url>" to open one, or ask the user to share a tab from the Tab Steer toolbar icon.');
  }
  if (tabs.length === 1) return tabs[0];
  const active = tabs.filter((t) => t.active);
  if (active.length === 1) return active[0];
  throw new Error(`Several tabs are shared. Pass --tab <id>. Shared tab ids: ${tabs.map((t) => t.id).join(', ')}`);
}

// Without host permission for a tab's site, Chrome hides its URL from us.
function requireAccess(tab) {
  if (!tab.url) {
    throw new Error(`Tab ${tab.id} is on a site Tab Steer is not allowed to access. Ask the user to click the Tab Steer toolbar icon on that tab and choose "Allow on this site".`);
  }
  if (!/^https?:/i.test(tab.url)) throw new Error('Tab Steer can only act on http and https pages.');
}

const describeTab = (t) => ({ id: t.id, title: t.title || null, url: t.url || null, active: t.active, allowed: !!t.url });

function normalizeUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('A URL is required.');
  const raw = /^[a-z][a-z0-9+.-]*:/i.test(input.trim()) ? input.trim() : 'https://' + input.trim();
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    throw new Error(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https URLs are allowed.');
  return url.href;
}

// Runs `start`, then resolves when the tab finishes loading (or times out).
function loadAndWait(tabId, start) {
  return new Promise((resolve, reject) => {
    let sawLoading = false;
    const finish = () => {
      clearTimeout(timer);
      clearTimeout(settle);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      if (info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, LOAD_TIMEOUT_MS);
    // Same-document navigations never report "complete".
    const settle = setTimeout(() => {
      if (!sawLoading) finish();
    }, 1500);
    chrome.tabs.onUpdated.addListener(listener);
    Promise.resolve(start()).catch((e) => {
      finish();
      reject(e);
    });
  });
}

async function runInPage(tab, command, args) {
  requireAccess(tab);
  let injection;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page.js'] });
    [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (c, a) => globalThis.__tabsteer.run(c, a),
      args: [command, args],
    });
  } catch (e) {
    throw new Error(`Could not reach the page: ${e.message}`);
  }
  const outcome = injection && injection.result;
  if (!outcome) throw new Error('The page did not answer (it may have navigated). Try again.');
  if (outcome.error) throw new Error(outcome.error);
  return outcome.ok;
}

// --------------------------------------------------------------- commands
const commands = {
  async tabs() {
    return (await sharedTabs()).map(describeTab);
  },

  async open({ url, background }) {
    const href = normalizeUrl(url);
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    // Start blank so the tab is in the shared group before the site loads.
    const tab = await chrome.tabs.create({ url: 'about:blank', active: !background, windowId: win.id });
    await shareTab(tab.id);
    await loadAndWait(tab.id, () => chrome.tabs.update(tab.id, { url: href }));
    return describeTab(await chrome.tabs.get(tab.id));
  },

  async navigate({ url, tabId }) {
    const tab = await resolveTab(tabId);
    const href = normalizeUrl(url);
    await loadAndWait(tab.id, () => chrome.tabs.update(tab.id, { url: href }));
    return describeTab(await chrome.tabs.get(tab.id));
  },

  async back({ tabId }) {
    const tab = await resolveTab(tabId);
    requireAccess(tab);
    // chrome.tabs.goBack skips history entries created without a real user
    // gesture, which is every entry the agent creates. history.back() doesn't.
    await loadAndWait(tab.id, () =>
      chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => history.back() })
    );
    return describeTab(await chrome.tabs.get(tab.id));
  },

  async close({ tabId }) {
    const tab = await resolveTab(tabId);
    await chrome.tabs.remove(tab.id);
    return { closed: tab.id };
  },

  async snap({ tabId }) {
    const tab = await resolveTab(tabId);
    requireAccess(tab);
    if (!tab.active) {
      await chrome.tabs.update(tab.id, { active: true });
      await new Promise((r) => setTimeout(r, 250));
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { base64: dataUrl.replace(/^data:image\/png;base64,/, '') };
  },

  async read({ tabId, offset, limit }) {
    return runInPage(await resolveTab(tabId), 'read', { offset: offset || 0, limit: limit || 0 });
  },

  async click({ tabId, target }) {
    if (!target) throw new Error('click needs a target.');
    return runInPage(await resolveTab(tabId), 'click', { target });
  },

  async type({ tabId, text, into }) {
    if (typeof text !== 'string') throw new Error('type needs text.');
    return runInPage(await resolveTab(tabId), 'type', { text, into: into || null });
  },

  async press({ tabId, key, into }) {
    if (!key) throw new Error('press needs a key.');
    return runInPage(await resolveTab(tabId), 'press', { key, into: into || null });
  },

  async scroll({ tabId, direction, amount }) {
    return runInPage(await resolveTab(tabId), 'scroll', { direction: direction || 'down', amount: amount || 0 });
  },

  async wait({ tabId, target, timeout, gone }) {
    if (!target) throw new Error('wait needs a target.');
    const ms = Math.min(Math.max(Number(timeout) || 10000, 100), MAX_WAIT_MS);
    return runInPage(await resolveTab(tabId), 'wait', { target, timeout: ms, gone: !!gone });
  },
};

async function handle(msg) {
  const { id, action, params = {} } = msg;
  try {
    const paused = await isPaused();
    if (action === 'status') {
      return { id, success: true, result: { version: VERSION, paused, sharedTabs: (await sharedTabs()).length } };
    }
    if (paused) throw new Error('Tab Steer is paused by the user. Ask them to resume it from the Tab Steer toolbar icon.');
    const command = Object.hasOwn(commands, action) ? commands[action] : null;
    if (!command) throw new Error(`Unknown action: ${action}`);
    return { id, success: true, result: await command(params) };
  } catch (e) {
    return { id, success: false, error: String((e && e.message) || e) };
  }
}

// ------------------------------------------------------------------ popup
// Only this extension's own pages may change sharing or pause state. Code
// injected into web pages reports the page's URL as its sender and is ignored.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !String(sender.url).startsWith(chrome.runtime.getURL(''))) return false;
  (async () => {
    switch (msg.type) {
      case 'ui:state': {
        connect();
        const shared = await sharedTabs();
        return {
          version: VERSION,
          connected: hostReady,
          hostError,
          paused: await isPaused(),
          sharedCount: shared.length,
          shared: shared.some((t) => t.id === msg.tabId),
        };
      }
      case 'ui:share':
        await shareTab(msg.tabId);
        return { ok: true };
      case 'ui:unshare':
        await chrome.tabs.ungroup(msg.tabId);
        return { ok: true };
      case 'ui:pause':
        await chrome.storage.local.set({ paused: !!msg.paused });
        await refreshBadge();
        return { ok: true };
      default:
        return { error: 'unknown message' };
    }
  })().then(sendResponse, (e) => sendResponse({ error: e.message }));
  return true;
});
