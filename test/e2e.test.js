'use strict';

// End-to-end: real Chromium, the real extension, the real native host and CLI,
// against local fixture pages. Runs in its own browser profile and its own
// TABSTEER_HOME, so it never touches the developer's browser.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'tabsteer.js');
const HOST = path.join(ROOT, 'host', 'native-host.js');
const { HOST_NAME, EXTENSION_IDS } = require('../lib/common');

const FORM_PAGE = `<!doctype html><title>Fixture</title>
<h1>Fixture page</h1>
<p>Some <b>inline</b> text.</p>
<a href="/next">Next page</a>
<button id="add">Add</button> <span id="count">Count: 0</span>
<div><button onclick="out.textContent='Deleted A'">Delete</button>
<button onclick="out.textContent='Deleted B'">Delete</button></div>
<p id="out"></p>
<form id="f"><label>Name <input name="who"></label>
<label>Password <input type="password" value="s3cret"></label>
<label>Colour <select name="c"><option>Red</option><option>Green</option></select></label>
<label>Security code <input name="cvv" value="987"></label>
<label>Expiry month <select autocomplete="cc-exp-month"><option>01</option><option selected>07</option></select></label>
<button>Greet</button></form>
<p id="hello"></p>
<div id="shadow-host"></div>
<p id="late"></p>
<script>
  let n = 0;
  add.addEventListener('click', () => count.textContent = 'Count: ' + (++n));
  f.addEventListener('submit', (e) => { e.preventDefault(); hello.textContent = 'Hello ' + f.who.value + ' in ' + f.c.value; });
  const root = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
  root.innerHTML = '<button>Shadow button</button>';
  root.querySelector('button').onclick = () => out.textContent = 'Shadow clicked';
  setTimeout(() => late.textContent = 'Loaded late', 700);
</script>`;

const PAGES = {
  '/form': FORM_PAGE,
  // A login form where something else (like a password manager) cancels Enter.
  '/cancel': `<!doctype html><title>Cancel</title><form id="g"><label>User <input name="u"></label><button>Send</button></form><p id="sent"></p>
<script>
  g.addEventListener('submit', (e) => { e.preventDefault(); sent.textContent = 'Sent ' + g.u.value; });
  addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
</script>`,
  '/next': '<!doctype html><title>Next</title><h1>Second page</h1><button>Add</button>',
  '/long': `<!doctype html><title>Long</title>${Array.from({ length: 600 }, (_, i) => `<p>Paragraph number ${i} with some filler words in it.</p>`).join('')}`,
};

let server, base;

test.before(async () => {
  server = http.createServer((req, res) => {
    const body = PAGES[req.url];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html' });
    res.end(body || 'not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

// Launches Chromium with the extension and a private native host registration.
// mode: 'on' (turned on: access to all sites), 'site' (one site granted the 0.1 way), 'off'.
async function launch({ mode }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
  const home = path.join(dir, 'h');
  const profile = path.join(dir, 'profile');
  let extension = path.join(ROOT, 'extension');
  fs.mkdirSync(home, { mode: 0o700 });

  if (mode !== 'off') {
    // The permission prompt can't be clicked from a test, so this variant is
    // installed with the permission already granted.
    extension = path.join(dir, 'extension');
    fs.cpSync(path.join(ROOT, 'extension'), extension, { recursive: true });
    const file = path.join(extension, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.host_permissions = [mode === 'on' ? '<all_urls>' : 'http://127.0.0.1/*'];
    fs.writeFileSync(file, JSON.stringify(manifest));
  }

  const wrapper = path.join(home, 'host.sh');
  fs.writeFileSync(wrapper, `#!/bin/sh\nTABSTEER_HOME='${home}' exec '${process.execPath}' '${HOST}'\n`, { mode: 0o755 });
  const hostsDir = path.join(profile, 'NativeMessagingHosts');
  fs.mkdirSync(hostsDir, { recursive: true });
  fs.writeFileSync(
    path.join(hostsDir, `${HOST_NAME}.json`),
    JSON.stringify({ name: HOST_NAME, description: 'test', path: wrapper, type: 'stdio', allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`) })
  );

  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    // TABSTEER_CHROMIUM points at a specific Chromium build instead of Playwright's own.
    executablePath: process.env.TABSTEER_CHROMIUM || undefined,
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  for (let i = 0; i < 200 && !fs.existsSync(path.join(home, 'tabsteer.sock')); i++) await new Promise((r) => setTimeout(r, 50));

  const run = (...args) =>
    new Promise((resolve) => {
      execFile(process.execPath, [CLI, ...args], { env: { ...process.env, TABSTEER_HOME: home }, cwd: dir }, (error, stdout, stderr) =>
        resolve({ code: error ? error.code : 0, stdout, stderr })
      );
    });
  const ok = async (...args) => {
    const r = await run(...args);
    assert.strictEqual(r.code, 0, `tabsteer ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };
  const refOf = (text, pattern) => {
    const m = pattern.exec(text);
    assert.ok(m, `expected ${pattern} in:\n${text}`);
    return m[1];
  };
  return { context, worker, run, ok, refOf, dir };
}

test('shared tabs with site access', async (t) => {
  const { context, worker, run, ok, refOf, dir } = await launch({ mode: 'on' });
  t.after(() => context.close());

  await t.test('starts connected with nothing shared', async () => {
    assert.match(await ok('status'), /Connected[\s\S]*Shared tabs: 0/);
    const r = await run('read');
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /No tabs are shared/);
  });

  let tabId;
  await t.test('open creates a tab inside the Tab Steer group', async () => {
    const opened = JSON.parse(await ok('open', `${base}/form`, '--json'));
    tabId = opened.id;
    // Turned on, but this site has not been allowed yet.
    assert.strictEqual(opened.allowed, false);
    assert.strictEqual(opened.url, null);
    const refused = await run('read');
    assert.strictEqual(refused.code, 1);
    assert.match(refused.stderr, /site the user has not allowed/);
    await worker.evaluate((origin) => allowSite(origin), base);
    const [listed] = JSON.parse(await ok('tabs', '--json'));
    assert.strictEqual(listed.allowed, true);
    assert.strictEqual(listed.url, `${base}/form`);
    const title = await worker.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id);
      return (await chrome.tabGroups.get(tab.groupId)).title;
    }, tabId);
    assert.strictEqual(title, 'Tab Steer');
  });

  await t.test('a tab the user has not shared is refused', async () => {
    const page = await context.newPage();
    await page.goto(`${base}/next`);
    const otherId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `${base}/next`);
    for (const command of [['read'], ['click', 'Add'], ['navigate', `${base}/form`], ['close'], ['snap']]) {
      const r = await run(...command, '--tab', String(otherId));
      assert.strictEqual(r.code, 1, command[0]);
      assert.match(r.stderr, /is not shared with Tab Steer/, command[0]);
    }
    assert.strictEqual(await page.title(), 'Next');
    await page.close();
  });

  let page1;
  await t.test('read gives structure and refs, and hides passwords', async () => {
    page1 = await ok('read');
    assert.match(page1, /^# Fixture\nURL: /);
    assert.match(page1, /^# Fixture page$/m);
    assert.match(page1, /^Some inline text\.$/m);
    assert.match(page1, /\[Next page\]\(\/next\) @[a-z]{6}\d+/);
    assert.match(page1, /\[input:password "Password" value="\[hidden\]" @/);
    assert.doesNotMatch(page1, /s3cret/);
    assert.match(page1, /\[input:text "Security code" value="\[hidden\]" @/);
    assert.doesNotMatch(page1, /987/);
    assert.match(page1, /\[select "Expiry month" value="\[hidden\]" @/);
    assert.match(page1, /\[button "Shadow button" @/);
  });

  await t.test('click fires exactly once', async () => {
    await ok('click', 'Add');
    assert.match(await ok('read'), /Count: 1\b/);
  });

  await t.test('ambiguous text is refused with candidate refs', async () => {
    const r = await run('click', 'Delete');
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /"Delete" matches 2 elements/);
    const second = [...r.stderr.matchAll(/\[button "Delete" (@[a-z]{6}\d+)\]/g)][1][1];
    await ok('click', second);
    assert.match(await ok('read'), /Deleted B/);
  });

  await t.test('click reaches into shadow DOM', async () => {
    await ok('click', 'Shadow button');
    assert.match(await ok('read'), /Shadow clicked/);
  });

  await t.test('type, select and Enter submit a form', async () => {
    const name = refOf(page1, /\[input:text "Name" value="" (@[a-z]{6}\d+)\]/);
    const colour = refOf(page1, /\[select "Colour" value="Red" (@[a-z]{6}\d+)\]/);
    await ok('type', 'Green', '--into', colour);
    await ok('type', 'Ada', '--into', name);
    assert.match(await ok('press', 'Enter'), /submitted form/);
    await ok('wait', 'Hello Ada in Green');
    const bad = await run('type', 'x', '--into', 'css=#add');
    assert.match(bad.stderr, /not a text field/);
  });

  await t.test('selectors that test field values are refused', async () => {
    for (const sel of ['css=input[value^="s"]', 'css=input[type=password][value="s3cret"]', 'css=input:placeholder-shown']) {
      for (const command of ['click', 'wait']) {
        const r = await run(command, sel);
        assert.strictEqual(r.code, 1, `${command} ${sel}`);
        assert.match(r.stderr, /may not test field values/);
      }
    }
  });

  await t.test('status names the connected build', async () => {
    const status = JSON.parse(await ok('status', '--json'));
    assert.match(status.extensionId, /^[a-p]{32}$/);
  });

  await t.test('wait sees late content and times out on missing content', async () => {
    await ok('wait', 'Loaded late');
    const r = await run('wait', 'never appears', '--timeout', '300');
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /Timed out after 300 ms/);
  });

  await t.test('snap saves a PNG of an allowed site', async () => {
    const file = path.join(dir, 'shot.png');
    await ok('snap', '--out', file);
    assert.strictEqual(fs.readFileSync(file).subarray(1, 4).toString(), 'PNG');
  });

  await t.test('the activity log records commands without typed text', async () => {
    await ok('type', 'very-secret-words', '--into', 'css=input[name=who]');
    const activity = await worker.evaluate(async () => (await chrome.storage.session.get('activity')).activity);
    const actions = activity.map((a) => a.action);
    for (const action of ['open', 'read', 'click', 'type', 'snap']) assert.ok(actions.includes(action), action);
    const typed = activity.filter((a) => a.action === 'type').at(-1);
    assert.strictEqual(typed.detail, '17 characters into css=input[name=who]');
    assert.doesNotMatch(JSON.stringify(activity), /very-secret-words/);
    assert.ok(activity.some((a) => !a.ok && /not allowed/.test(a.error)), 'refusals are logged');
  });

  await t.test('code in a page cannot change the allowed sites', async () => {
    const outcome = await worker.evaluate(async (id) => {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: id },
        func: async () => {
          try {
            await chrome.storage.local.set({ allowAllSites: true, allowedSites: ['https://evil.example'] });
            return 'written';
          } catch (e) {
            return 'blocked';
          }
        },
      });
      return r.result;
    }, tabId);
    const s = await worker.evaluate(() => chrome.storage.local.get(['allowAllSites', 'allowedSites']));
    assert.strictEqual(outcome, 'blocked');
    assert.ok(!s.allowAllSites);
    assert.ok(!s.allowedSites.includes('https://evil.example'));
  });

  await t.test('removing a site cuts access, and "allow every site" restores it', async () => {
    await worker.evaluate((origin) => revokeSite(origin), base);
    const r = await run('read');
    assert.match(r.stderr, /site the user has not allowed/);
    await worker.evaluate(() => chrome.storage.local.set({ allowAllSites: true }));
    await ok('read');
    await worker.evaluate(() => chrome.storage.local.set({ allowAllSites: false }));
    await worker.evaluate((origin) => allowSite(origin), base);
    await ok('read');
  });

  await t.test('refs go stale after navigation', async () => {
    const add = refOf(page1, /\[button "Add" (@[a-z]{6}\d+)\]/);
    await ok('click', 'Next page');
    await ok('wait', 'Second page');
    await ok('read');
    const r = await run('click', add);
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /is stale/);
    assert.match(await ok('back'), /\/form/);
  });

  await t.test('long pages are truncated with a continuation hint', async () => {
    await ok('navigate', `${base}/long`);
    const first = await ok('read');
    const next = refOf(first, /Continue with --offset (\d+)\]/);
    assert.match(first, /Paragraph number 0 /);
    const rest = await ok('read', '--offset', next, '--limit', '100000');
    assert.doesNotMatch(rest, /Paragraph number 0 /);
    assert.match(rest, /Paragraph number 599 /);
    assert.doesNotMatch(rest, /truncated/);
  });

  await t.test('a cancelled Enter is reported with the submit button, and "type @ref text" works', async () => {
    await ok('navigate', `${base}/cancel`);
    const field = refOf(await ok('read'), /\[input:text "User" value="" (@[a-z]{6}\d+)\]/);
    assert.match(await ok('type', field, 'ada'), /Typed into .*"ada"/);
    const pressed = await ok('press', 'Enter', '--into', field);
    const submit = refOf(pressed, /cancelled it.*tabsteer click (@[a-z]{6}\d+)/);
    assert.doesNotMatch(await ok('read'), /Sent ada/);
    await ok('click', submit);
    await ok('wait', 'Sent ada');
  });

  await t.test('only http and https URLs are accepted', async () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings']) {
      const r = await run('navigate', url);
      assert.strictEqual(r.code, 1, url);
      assert.match(r.stderr, /Only http and https/, url);
    }
  });

  await t.test('pausing discards the result of a command already running', async () => {
    const pending = run('wait', 'never appears', '--timeout', '3000');
    await new Promise((r) => setTimeout(r, 500));
    await worker.evaluate(() => chrome.storage.local.set({ paused: true }));
    const r = await pending;
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /paused by the user/);
    await worker.evaluate(() => chrome.storage.local.set({ paused: false }));
  });

  await t.test('pause blocks every action until resumed', async () => {
    await worker.evaluate(() => chrome.storage.local.set({ paused: true }));
    const r = await run('read');
    assert.strictEqual(r.code, 1);
    assert.match(r.stderr, /paused by the user/);
    assert.match(await ok('status'), /PAUSED/);
    await worker.evaluate(() => chrome.storage.local.set({ paused: false }));
    await ok('read');
  });

  await t.test('unsharing a tab cuts access immediately', async () => {
    await worker.evaluate((id) => chrome.tabs.ungroup(id), tabId);
    const r = await run('read', '--tab', String(tabId));
    assert.match(r.stderr, /is not shared/);
    await worker.evaluate((id) => shareTab(id), tabId);
    await ok('read');
  });

  await t.test('connection survives the service worker idle limit', { skip: !process.env.TABSTEER_SLOW }, async () => {
    await new Promise((r) => setTimeout(r, 45000));
    assert.match(await ok('status'), /Connected/);
  });

  await t.test('close removes the tab', async () => {
    await ok('close');
    assert.match(await ok('status'), /Shared tabs: 0/);
  });
});

test('when Tab Steer is not turned on, the agent can open a page but not read or act on it', async (t) => {
  const { context, run, ok } = await launch({ mode: 'off' });
  t.after(() => context.close());

  const opened = JSON.parse(await ok('open', `${base}/form`, '--json'));
  assert.strictEqual(opened.allowed, false);
  assert.strictEqual(opened.url, null);
  for (const command of [['read'], ['click', 'Add'], ['type', 'x'], ['snap']]) {
    const r = await run(...command);
    assert.strictEqual(r.code, 1, command[0]);
    assert.match(r.stderr, /not turned on/, command[0]);
  }
});

test('a site granted the 0.1 way keeps working, and screenshots ask to turn on', async (t) => {
  const { context, run, ok } = await launch({ mode: 'site' });
  t.after(() => context.close());
  const opened = JSON.parse(await ok('open', `${base}/next`, '--json'));
  assert.strictEqual(opened.allowed, true);
  assert.match(await ok('read'), /Second page/);
  const r = await run('snap');
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /Screenshots need Tab Steer to be turned on/);
  assert.match(await ok('status'), /Turned on: no/);
});
