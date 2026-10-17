#!/usr/bin/env node
'use strict';

// Renders the popup screenshot used in the README and site, and the Chrome Web
// Store images, from the real extension pages. Needs Playwright's Chromium:
//   npx playwright install chromium && node scripts/store-images.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const LOGO = `file://${path.join(ROOT, 'docs', 'assets', 'logo.svg')}`;
const POPUP = `file://${path.join(ROOT, 'docs', 'assets', 'popup.png')}`;

const HERO = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;width:1280px;height:800px;background:#f5f7fb;color:#0f172a;font:400 22px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;grid-template-columns:1fr 420px;gap:56px;align-items:center;padding:0 80px;box-sizing:border-box}
h1{font-size:54px;line-height:1.08;letter-spacing:-1.5px;margin:18px 0 16px}
p{color:#55607a;margin:0 0 28px;max-width:560px}
.brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:24px}.brand img{width:44px}
pre{margin:0;background:#0b1220;color:#d7e0f2;border-radius:14px;padding:20px 22px;font:15px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}
pre b{color:#93c5fd;font-weight:400} pre i{color:#7f8db0;font-style:normal}
.pop{width:400px;border-radius:16px;border:1px solid #e3e8f1;box-shadow:0 24px 60px rgba(15,23,42,.18)}
</style>
<div><div class="brand"><img src="${LOGO}">Tab Steer</div>
<h1>Hand your coding agent a tab, not your browser.</h1>
<p>Your agent works only in the tabs you share, on the sites you allow. Pause it with one click.</p>
<pre><i>$</i> tabsteer read
# Inbox
[Compose](#) <b>@kqzbwr2</b> | [Search mail](#) <b>@kqzbwr3</b> ...

<i>$</i> tabsteer click <b>@kqzbwr2</b>
Clicked link "Compose" @kqzbwr2</pre></div>
<img class="pop" src="${POPUP}">`;

const PROMO = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;width:440px;height:280px;background:#0b1220;color:#fff;font:400 17px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 36px;box-sizing:border-box}
.b{display:flex;align-items:center;gap:14px;font-weight:700;font-size:34px;letter-spacing:-.5px;margin-bottom:14px}.b img{width:60px}
p{margin:0;color:#b6c2d9}
</style><div class="b"><img src="${LOGO}">Tab Steer</div><p>Hand your coding agent a tab,<br>not your browser.</p>`;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-images-'));
  const context = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
    channel: 'chromium',
    headless: true,
    colorScheme: 'light',
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = worker.url().split('/')[2];

  const shot = async ({ url, html, out, width, height, init }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    if (init) await page.addInitScript(init);
    if (html) {
      const file = path.join(dir, `${path.basename(out)}.html`);
      fs.writeFileSync(file, html);
      url = `file://${file}`;
    }
    await page.goto(url);
    await page.waitForTimeout(400);
    // Store images must be exactly the stated size, so capture at CSS pixels.
    await page.screenshot({ path: path.join(ROOT, out), scale: 'css' });
    await page.close();
    console.log(out);
  };

  // The real popup, with a stand-in state: connected, tab shared, site allowed.
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 320, height: 200 });
  await popup.addInitScript(() => {
    chrome.tabs.query = async () => [{ id: 1, url: 'https://mail.example.com/inbox' }];
    chrome.runtime.sendMessage = async () => ({
      version: '0', connected: true, hostError: null, paused: false, turnedOn: true, allowAllSites: false,
      allowedSites: ['https://mail.example.com'], sharedCount: 1, shared: true,
      origin: 'https://mail.example.com', siteAllowed: true,
    });
  });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForTimeout(400);
  await popup.screenshot({ path: path.join(ROOT, 'docs/assets/popup.png'), fullPage: true });
  await popup.close();
  console.log('docs/assets/popup.png');

  await shot({ html: HERO, out: 'store/screenshot-1.png', width: 1280, height: 800 });
  await shot({
    url: `chrome-extension://${id}/welcome.html`,
    out: 'store/screenshot-2.png',
    width: 1280,
    height: 800,
    init: () => {
      chrome.runtime.sendMessage = async () => ({ connected: true });
    },
  });
  // The side panel, with a sample session of agent activity.
  await shot({
    url: `chrome-extension://${id}/panel.html`,
    out: 'docs/assets/panel.png',
    width: 360,
    height: 640,
    init: () => {
      const now = Date.now();
      const activity = [
        { time: now - 52000, action: 'open', detail: 'https://localhost:5173/checkout', ok: true },
        { time: now - 47000, action: 'read', detail: '3182 of 3182 characters', ok: true },
        { time: now - 41000, action: 'type', detail: '16 characters into @kqzbwr7', ok: true },
        { time: now - 38000, action: 'click', detail: 'button "Place order"', ok: true },
        { time: now - 33000, action: 'wait', detail: 'Order confirmed', ok: true },
        { time: now - 29000, action: 'snap', detail: null, ok: true },
        { time: now - 12000, action: 'read', ok: false, error: 'Tab 1853 is on a site the user has not allowed.' },
      ];
      chrome.storage.session.get = async () => ({ activity });
      chrome.runtime.sendMessage = async () => ({
        connected: true, paused: false, turnedOn: true, allowAllSites: false,
        allowedSites: ['http://localhost:5173', 'https://mail.example.com'],
      });
    },
  });
  await shot({ html: PROMO, out: 'store/promo-440x280.png', width: 440, height: 280 });
  fs.copyFileSync(path.join(EXT, 'icons', 'icon128.png'), path.join(ROOT, 'store', 'icon-128.png'));

  await context.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
