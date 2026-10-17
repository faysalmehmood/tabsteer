// Tab Steer service worker: bridges the native messaging host to the tabs the
// user has shared. Everything the agent may touch is decided here, from state
// only the user can change through the extension's own pages: tab group
// membership, the list of allowed sites, and pause.

const HOST_NAME = 'dev.tabsteer.host';
const GROUP_TITLE = 'Tab Steer';
const VERSION = chrome.runtime.getManifest().version;
const LOAD_TIMEOUT_MS = 15000;
const MAX_WAIT_MS = 25000;
const ACTIVITY_LIMIT = 200;
const ALL_SITES = { origins: ['<all_urls>'] };
// page.js registers itself under a per-version name, so an update never talks to old page code.
const PAGE_KEY = '__tabsteer_' + VERSION.replace(/\W/g, '_');

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

function startup() {
  chrome.alarms.create('reconnect', { periodInMinutes: 1 });
  connect();
}

chrome.runtime.onStartup.addListener(startup);
chrome.runtime.onInstalled.addListener((details) => {
  startup();
  if (details.reason === 'install') chrome.tabs.create({ url: 'welcome.html' });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'reconnect') connect();
});
chrome.permissions.onAdded.addListener(refreshBadge);
chrome.permissions.onRemoved.addListener(refreshBadge);
chrome.storage.onChanged.addListener((changes) => {
  if ('paused' in changes) refreshBadge();
});

// Keep settings away from content scripts where Chrome supports it.
for (const area of [chrome.storage.local, chrome.storage.session]) {
  try {
    area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch (e) {}
}

connect();
refreshBadge();

// ------------------------------------------------------------ user state
async function settings() {
  const s = await chrome.storage.local.get(['paused', 'allowedSites', 'allowAllSites']);
  return { paused: !!s.paused, allowedSites: s.allowedSites || [], allowAllSites: !!s.allowAllSites };
}

const isPaused = async () => (await settings()).paused;
const isTurnedOn = () => chrome.permissions.contains(ALL_SITES);

async function refreshBadge() {
  const [paused, on] = await Promise.all([isPaused(), isTurnedOn()]);
  await chrome.action.setBadgeText({ text: paused ? 'II' : on ? '' : 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ color: paused ? '#b45309' : '#6b7280' });
}

function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch (e) {
    return null;
  }
}

async function allowSite(origin) {
  if (!originOf(origin)) throw new Error('Only http and https sites can be allowed.');
  const { allowedSites } = await settings();
  if (!allowedSites.includes(origin)) await chrome.storage.local.set({ allowedSites: [...allowedSites, origin].sort() });
}

async function revokeSite(origin) {
  const { allowedSites } = await settings();
  await chrome.storage.local.set({ allowedSites: allowedSites.filter((o) => o !== origin) });
  // Sites allowed one by one through Chrome's own prompt (Tab Steer 0.1) are removed too.
  await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => {});
}

// A site is usable when Chrome lets the extension reach it AND the user allowed
// it in Tab Steer. The temporary access Chrome gives when the toolbar icon is
// clicked does not count: it is not in either list.
async function siteAllowed(url) {
  const origin = originOf(url);
  if (!origin) return false;
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) return false;
  const { allowedSites, allowAllSites } = await settings();
  if (allowAllSites || allowedSites.includes(origin)) return true;
  // Sites granted one by one through Chrome's own prompt (Tab Steer 0.1) still count.
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.some((pattern) => sitePatternMatches(pattern, url));
}

// Matches Chrome site patterns such as https://example.com/*, http://localhost:8080/*
// or https://*.example.com/*. Patterns that cover every site do not count here.
function sitePatternMatches(pattern, url) {
  const m = /^(\*|https?):\/\/(\*\.)?([^/:*]+)(?::(\d+|\*))?\//.exec(pattern);
  if (!m) return false;
  const u = new URL(url);
  if (m[1] !== '*' && `${m[1]}:` !== u.protocol) return false;
  const host = m[3].toLowerCase();
  if (m[2] ? !(u.hostname === host || u.hostname.endsWith(`.${host}`)) : u.hostname !== host) return false;
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return !m[4] || m[4] === '*' || m[4] === port;
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

async function requireAccess(tab) {
  if (tab.url && !originOf(tab.url)) throw new Error('Tab Steer can only act on http and https pages.');
  if (await siteAllowed(tab.url)) return;
  throw new Error(
    (await isTurnedOn())
      ? `Tab ${tab.id} is on a site the user has not allowed. Ask them to click the Tab Steer toolbar icon on that tab and choose "Allow".`
      : `Tab Steer is not turned on for websites, or this site is not allowed. Ask the user to click the Tab Steer toolbar icon and choose "Turn on".`
  );
}

async function describeTab(t) {
  if (!(await siteAllowed(t.url))) return { id: t.id, title: null, url: null, active: t.active, allowed: false };
  return { id: t.id, title: t.title || null, url: t.url, active: t.active, allowed: true };
}

function normalizeUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('A URL is required.');
  const text = input.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(javascript|data|file|chrome|about|blob):/i.test(text);
  // A bare local address means a development server, which rarely speaks https.
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|[^/:]+\.localhost)(:\d+)?(\/|$)/i.test(text);
  const raw = hasScheme ? text : (local ? 'http://' : 'https://') + text;
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
  await requireAccess(tab);
  let injection;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page.js'] });
    [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (key, c, a) => globalThis[key].run(c, a),
      args: [PAGE_KEY, command, args],
    });
  } catch (e) {
    throw new Error(`Could not reach the page: ${e.message}`);
  }
  const outcome = injection && injection.result;
  if (!outcome) throw new Error('The page did not answer (it may have navigated). Try again.');
  if (outcome.error) throw new Error(outcome.error);
  return outcome.ok;
}

// --------------------------------------------------------------- activity
// A short record of what the agent did, for the side panel. It lives in
// session storage, so it is gone when the browser closes, and it never holds
// typed text or full addresses.
function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch (e) {
    return null;
  }
}

function describeAction(action, params, result) {
  switch (action) {
    case 'open':
    case 'navigate':
      return shortUrl(normalizeUrl(params.url));
    case 'click':
      return result ? `${result.kind} "${result.label}"` : params.target;
    case 'type':
      return `${(params.text || '').length} characters${params.into ? ` into ${params.into}` : ''}`;
    case 'press':
      return params.key;
    case 'wait':
      return `${params.gone ? 'until gone: ' : ''}${params.target}`;
    case 'read':
      return result ? `${result.end - result.offset} of ${result.total} characters` : null;
    case 'scroll':
      return params.direction || 'down';
    default:
      return null;
  }
}

async function logActivity(entry) {
  const { activity = [] } = await chrome.storage.session.get('activity');
  activity.push(entry);
  await chrome.storage.session.set({ activity: activity.slice(-ACTIVITY_LIMIT) });
}

// --------------------------------------------------------------- commands
const commands = {
  async tabs() {
    return Promise.all((await sharedTabs()).map(describeTab));
  },

  async open({ url, background }) {
    const href = normalizeUrl(url);
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    // Start blank so the tab is in the shared group before the site loads.
    const tab = await chrome.tabs.create({ url: 'about:blank', active: !background, windowId: win.id });
    try {
      await shareTab(tab.id);
    } catch (e) {
      await chrome.tabs.remove(tab.id).catch(() => {});
      throw e;
    }
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
    await requireAccess(tab);
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
    await requireAccess(tab);
    // Chrome allows tab screenshots only to extensions with access to all sites.
    if (!(await isTurnedOn())) {
      throw new Error('Screenshots need Tab Steer to be turned on. Ask the user to click the Tab Steer toolbar icon and choose "Turn on", or use "tabsteer read" instead.');
    }
    if (!tab.active) {
      await chrome.tabs.update(tab.id, { active: true });
      await new Promise((r) => setTimeout(r, 250));
    }
    // captureVisibleTab takes whatever is showing, so make sure the user didn't
    // switch to another tab or page meanwhile.
    const showing = async () => {
      const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      return !!active && active.id === tab.id && (await siteAllowed(active.url));
    };
    if (!(await showing())) throw new Error('The shared tab is no longer the visible tab in its window. Try again.');
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (!(await showing())) throw new Error('The visible tab changed during the screenshot. Try again.');
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
  const started = Date.now();
  let result;
  let error = null;
  try {
    const { paused } = await settings();
    if (action === 'status') {
      return {
        id,
        success: true,
        result: { version: VERSION, extensionId: chrome.runtime.id, paused, turnedOn: await isTurnedOn(), sharedTabs: (await sharedTabs()).length },
      };
    }
    if (paused) throw new Error('Tab Steer is paused by the user. Ask them to resume it from the Tab Steer toolbar icon.');
    const command = Object.hasOwn(commands, action) ? commands[action] : null;
    if (!command) throw new Error(`Unknown action: ${action}`);
    try {
      result = await command(params);
    } finally {
      if (await isPaused()) throw new Error('Tab Steer was paused by the user while this command ran. Its result was discarded.');
    }
    return { id, success: true, result };
  } catch (e) {
    error = String((e && e.message) || e);
    return { id, success: false, error };
  } finally {
    if (action !== 'status' && action !== 'tabs') {
      let detail = null;
      try {
        detail = describeAction(action, params, result);
      } catch (e) {}
      logActivity({
        time: started,
        action,
        tab: params.tabId ?? (result && result.id) ?? null,
        detail,
        ok: !error,
        error,
      }).catch(() => {});
    }
  }
}

// ------------------------------------------------------- extension pages
// Only this extension's own pages (popup, side panel, welcome page) may change
// sharing, allowed sites or pause. Code injected into web pages reports the
// page's URL as its sender and is ignored.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !String(sender.url).startsWith(chrome.runtime.getURL(''))) return false;
  (async () => {
    switch (msg.type) {
      case 'ui:state': {
        connect();
        const shared = await sharedTabs();
        const s = await settings();
        const origin = originOf(msg.url);
        return {
          version: VERSION,
          connected: hostReady,
          hostError,
          paused: s.paused,
          turnedOn: await isTurnedOn(),
          allowAllSites: s.allowAllSites,
          allowedSites: s.allowedSites,
          sharedCount: shared.length,
          shared: shared.some((t) => t.id === msg.tabId),
          origin,
          siteAllowed: origin ? await siteAllowed(msg.url) : false,
        };
      }
      case 'ui:share':
        // Sharing a tab also allows its site: one click does both.
        await shareTab(msg.tabId);
        if (originOf(msg.origin)) await allowSite(originOf(msg.origin));
        return { ok: true };
      case 'ui:unshare':
        await chrome.tabs.ungroup(msg.tabId);
        return { ok: true };
      case 'ui:allow':
        await allowSite(originOf(msg.origin));
        return { ok: true };
      case 'ui:revoke':
        await revokeSite(msg.origin);
        return { ok: true };
      case 'ui:allowAll':
        await chrome.storage.local.set({ allowAllSites: !!msg.value });
        return { ok: true };
      case 'ui:pause':
        await chrome.storage.local.set({ paused: !!msg.paused });
        await refreshBadge();
        return { ok: true };
      case 'ui:clearActivity':
        await chrome.storage.session.set({ activity: [] });
        return { ok: true };
      default:
        return { error: 'unknown message' };
    }
  })().then(sendResponse, (e) => sendResponse({ error: e.message }));
  return true;
});
