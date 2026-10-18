#!/usr/bin/env node
// Release smoke test in your real, everyday Chrome (with your other extensions).
// The automated e2e tests use a clean Chromium, so they miss problems caused by
// password managers, ad blockers and similar. Run this before every release:
//
//   npm run smoke
//
// It serves test pages on localhost, drives them with the installed CLI, and
// asks you to click Allow, Pause, Resume and Remove at the right moments.

'use strict';

const http = require('http');
const { execFile } = require('child_process');
const path = require('path');
const os = require('os');

const CLI = path.join(__dirname, '..', 'bin', 'tabsteer.js');
const PORT = 8766;
const BASE = `http://localhost:${PORT}`;

const PAGES = {
  '/': `<!doctype html><title>Smoke login</title><h1>Smoke login</h1>
<form id="f"><label>Username <input name="username" autocomplete="username"></label>
<label>Password <input type="password" name="password" value="smoke-secret-pw"></label>
<label>Card number <input autocomplete="cc-number" value="4111111111111111"></label>
<label>One-time code <input autocomplete="one-time-code" value="123456"></label>
<button>Sign in</button></form><p id="out">Not submitted</p>
<button onclick="this.textContent='Clicked!'">Click me</button>
<label><input type="checkbox" id="c"> Remember me</label>
<select id="s" aria-label="Plan"><option>Free</option><option>Pro</option></select>
<textarea aria-label="Notes"></textarea>
<div contenteditable="true" aria-label="Editor"></div>
<a href="/two">Next page</a>
<script>f.addEventListener('submit', (e) => { e.preventDefault(); out.textContent = 'Submitted as ' + f.username.value; });</script>`,
  '/plain': `<!doctype html><title>Smoke search</title><form id="f"><label>Search <input name="q"></label><button>Go</button></form>
<p id="out">Not submitted</p><script>f.addEventListener('submit', (e) => { e.preventDefault(); out.textContent = 'Searched ' + f.q.value; });</script>`,
  '/two': '<!doctype html><title>Smoke two</title><h1>Page two</h1><p>Navigation works.</p>',
};

function cli(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd: os.tmpdir() }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code || 1 : 0, out: stdout + stderr }));
  });
}

let failures = 0;
function check(ok, label, detail) {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : `\n    ${detail.trim().split('\n').join('\n    ')}`}`);
  if (!ok) failures++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(prompt, test, timeoutMs = 180000) {
  console.log(`\n→ ${prompt}`);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await test()) return true;
    await sleep(1000);
  }
  console.log('  (timed out waiting)');
  return false;
}
const ref = (text, label) => (text.match(new RegExp(`"${label}"[^\\]]*?(@[a-z]{6}\\d+)\\]`)) || [])[1];

async function main() {
  const server = http.createServer((req, res) => {
    const body = PAGES[req.url];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html' });
    res.end(body || 'not found');
  }).listen(PORT, '127.0.0.1');

  try {
    const status = await cli('status');
    check(status.code === 0, 'Extension is connected', status.out);
    if (status.code) return;
    console.log(`  ${status.out.trim().split('\n').join('\n  ')}`);

    const opened = await cli('open', `localhost:${PORT}`);
    check(opened.code === 0, 'open accepts a bare localhost address', opened.out);
    const tab = (opened.out.match(/Opened tab (\d+)/) || [])[1];
    const t = ['--tab', tab];

    const refused = await cli('read', ...t);
    if (refused.code === 0) {
      console.log('  (localhost is already allowed, so the not-allowed check is skipped)');
    } else {
      check(/not allowed/.test(refused.out), 'A tab on a site that is not allowed is refused', refused.out);
      await until(`In Chrome, on the "Smoke login" tab, click the Tab Steer icon and choose "Allow localhost:${PORT}".`,
        async () => (await cli('read', ...t)).code === 0);
    }

    let page = (await cli('read', ...t)).out;
    check(/\[hidden\]/.test(page) && !/smoke-secret-pw|4111111111111111|123456/.test(page),
      'Password, card and one-time-code values stay hidden', page);

    const user = ref(page, 'Username');
    let r = await cli('type', user, 'smoke-user', ...t);
    check(/"smoke-user"/.test(r.out), 'type @ref text fills the field', r.out);
    r = await cli('type', 'smoke-user2', '--into', user, ...t);
    check(/"smoke-user2"/.test(r.out), 'type text --into @ref fills the field', r.out);

    r = await cli('press', 'Enter', '--into', user, ...t);
    page = (await cli('read', ...t)).out;
    if (/Submitted as smoke-user2/.test(page)) {
      check(true, 'Enter submits the login form');
    } else {
      const submit = (r.out.match(/tabsteer click (@[a-z]{6}\d+)/) || [])[1];
      check(!!submit, 'A cancelled Enter on the login form is reported with the submit button', r.out);
      if (submit) await cli('click', submit, ...t);
      page = (await cli('read', ...t)).out;
      check(/Submitted as smoke-user2/.test(page), 'Clicking the reported submit button submits', page);
      console.log('  (another extension, often a password manager, cancelled Enter here)');
    }

    r = await cli('click', 'Click me', ...t);
    check(/Clicked!/.test((await cli('read', ...t)).out), 'click by text works', r.out);
    page = (await cli('read', ...t)).out;
    r = await cli('click', ref(page, 'Remember me'), ...t);
    check(r.code === 0, 'click a checkbox', r.out);
    r = await cli('type', 'Pro', '--into', ref(page, 'Plan'), ...t);
    check(/"Pro"/.test(r.out), 'pick a select option', r.out);
    r = await cli('type', 'some notes', '--into', ref(page, 'Notes'), ...t);
    check(/"some notes"/.test(r.out), 'type into a textarea', r.out);
    r = await cli('type', 'rich text', '--into', ref(page, 'Editor'), ...t);
    check(/"rich text"/.test(r.out), 'type into a contenteditable', r.out);

    r = await cli('snap', '--out', path.join(os.tmpdir(), 'tabsteer-smoke.png'), ...t);
    check(r.code === 0 && /Saved/.test(r.out), 'snap saves a screenshot', r.out);

    r = await cli('click', 'Next page', ...t);
    r = await cli('wait', 'Navigation works', ...t);
    check(r.code === 0, 'a link navigates and wait finds the new text', r.out);
    r = await cli('back', ...t);
    check(/localhost:\d+\/$/m.test(r.out) || /localhost:\d+\/\s/.test(r.out), 'back returns to the first page', r.out);

    r = await cli('navigate', `${BASE}/plain`, ...t);
    page = (await cli('read', ...t)).out;
    await cli('type', 'cats', '--into', ref(page, 'Search'), ...t);
    r = await cli('press', 'Enter', ...t);
    check(/Searched cats/.test((await cli('read', ...t)).out), 'Enter submits a plain form', r.out);

    await until('Open the Tab Steer popup and click "Pause".', async () => /paused/i.test((await cli('status')).out));
    r = await cli('read', ...t);
    check(r.code === 1 && /paused/i.test(r.out), 'Commands are refused while paused', r.out);
    await until('Now click "Resume".', async () => (await cli('read', ...t)).code === 0);

    await until('Click "Activity" in the popup. Check it lists the actions above, with no typed text. Then, under Allowed sites, click Remove next to localhost.',
      async () => (await cli('read', ...t)).code === 1);
    r = await cli('read', ...t);
    check(/not allowed/.test(r.out), 'Removing the site cuts off access at once', r.out);

    await cli('close', ...t).catch(() => {});
  } finally {
    server.close();
    console.log(failures ? `\n${failures} check(s) failed.` : '\nAll smoke checks passed.');
    process.exitCode = failures ? 1 : 0;
  }
}

main();
