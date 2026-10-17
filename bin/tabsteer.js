#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { VERSION, SOCKET_PATH, HOST_TIMEOUT_MS } = require('../lib/common');

const HELP = `tabsteer ${VERSION} — control the browser tabs you've shared

Usage: tabsteer <command> [options]

Tabs
  status                      Show connection state and how many tabs are shared
  tabs                        List shared tabs
  open <url> [--background]   Open a URL in a new shared tab
  navigate <url>              Load a URL in a shared tab
  back                        Go back one page
  close                       Close a shared tab

Page
  read [--offset N] [--limit N]   Page as Markdown; controls carry refs like @kqzbwr12
  click <ref|text|css=sel>        Click one element
  type <text> [--into <ref>]      Replace the content of a field (or pick a <select> option)
  press <key> [--into <ref>]      Enter, Tab, Escape, Space, arrows, or a single character
  scroll [up|down|top|bottom] [pixels]
  wait <text|ref|css=sel> [--gone] [--timeout ms]
  snap [--out file.png]           Screenshot the visible part of the tab

Setup
  install [--agent claude|antigravity] [--link]
  uninstall
  doctor

Options
  --tab <id>   Target a specific shared tab (needed when several are shared)
  --json       Print the raw JSON result
  -h, --help   Show this help

Tabs are shared by the user from the Tab Steer toolbar icon, or by "tabsteer open".
`;

// ------------------------------------------------------------ arguments
const VALUE_FLAGS = new Set(['--tab', '--out', '--into', '--timeout', '--offset', '--limit', '--agent']);
const BOOL_FLAGS = new Set(['--json', '--background', '--gone', '--link', '--help', '-h']);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (VALUE_FLAGS.has(arg)) {
      if (i + 1 >= argv.length) fail(`${arg} needs a value.`);
      flags[arg.slice(2)] = argv[++i];
    } else if (BOOL_FLAGS.has(arg)) {
      flags[arg.replace(/^-+/, '')] = true;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function integer(value, name) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail(`${name} must be a non-negative whole number.`);
  return n;
}

// ------------------------------------------------------------- transport
const NOT_CONNECTED =
  'Not connected to the browser. Make sure Chrome is open and the Tab Steer extension is enabled, then run "tabsteer doctor".';

function request(action, params = {}) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH);
    let raw = '';
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error('Timed out waiting for the browser.'));
    }, HOST_TIMEOUT_MS + 5000);
    client.setEncoding('utf8');
    client.on('connect', () => client.write(JSON.stringify({ action, params }) + '\n'));
    client.on('data', (chunk) => (raw += chunk));
    client.on('error', () => {
      clearTimeout(timer);
      reject(new Error(NOT_CONNECTED));
    });
    client.on('end', () => {
      clearTimeout(timer);
      let response;
      try {
        response = JSON.parse(raw);
      } catch (e) {
        return reject(new Error(NOT_CONNECTED));
      }
      if (!response.success) return reject(new Error(response.error || 'Unknown error.'));
      resolve(response.result);
    });
  });
}

// --------------------------------------------------------------- commands
function tabLine(t) {
  const where = t.allowed ? `${t.title || '(untitled)'} — ${t.url}` : '(site not allowed — the user can allow it from the Tab Steer icon)';
  return `${t.active ? '*' : ' '} ${t.id}  ${where}`;
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;
  if (!command || flags.help || flags.h || command === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (command === '--version' || command === 'version') return console.log(VERSION);
  if (['install', 'uninstall', 'doctor'].includes(command)) {
    return require('../lib/setup')[command]({ flags, request });
  }

  const tabId = integer(flags.tab, '--tab');
  const out = (result, text) => console.log(flags.json ? JSON.stringify(result, null, 2) : text);
  const need = (value, usage) => (value === undefined ? fail(`Usage: tabsteer ${usage}`) : value);

  switch (command) {
    case 'status': {
      const r = await request('status');
      return out(r, `Connected (extension ${r.version})${r.paused ? ' — PAUSED by the user' : ''}\nShared tabs: ${r.sharedTabs}`);
    }
    case 'tabs': {
      const r = await request('tabs');
      return out(r, r.length ? r.map(tabLine).join('\n') : 'No tabs are shared. Use "tabsteer open <url>" or ask the user to share one.');
    }
    case 'open': {
      const r = await request('open', { url: need(rest[0], 'open <url>'), background: !!flags.background });
      return out(r, `Opened tab ${r.id}\n${tabLine(r)}`);
    }
    case 'navigate': {
      const r = await request('navigate', { url: need(rest[0], 'navigate <url>'), tabId });
      return out(r, tabLine(r));
    }
    case 'back': {
      const r = await request('back', { tabId });
      return out(r, tabLine(r));
    }
    case 'close': {
      const r = await request('close', { tabId });
      return out(r, `Closed tab ${r.closed}`);
    }
    case 'read': {
      const r = await request('read', { tabId, offset: integer(flags.offset, '--offset'), limit: integer(flags.limit, '--limit') });
      return out(r, r.content);
    }
    case 'click': {
      const r = await request('click', { tabId, target: need(rest[0], 'click <ref|text|css=selector>') });
      return out(r, `Clicked ${r.kind} "${r.label}" ${r.ref}${r.covered ? ' (warning: another element was on top of it)' : ''}`);
    }
    case 'type': {
      const r = await request('type', { tabId, text: need(rest[0], 'type <text> [--into <ref>]'), into: flags.into });
      return out(r, `Typed into ${r.ref}: "${r.value}"`);
    }
    case 'press': {
      const r = await request('press', { tabId, key: need(rest[0], 'press <key>'), into: flags.into });
      return out(r, `Pressed ${r.pressed} on ${r.on}${r.did ? ` (${r.did})` : ''}`);
    }
    case 'scroll': {
      const r = await request('scroll', { tabId, direction: rest[0] || 'down', amount: integer(rest[1], 'pixels') });
      return out(r, `Scrolled to ${r.scrollY} of ${r.maxY} px`);
    }
    case 'wait': {
      const r = await request('wait', {
        tabId,
        target: need(rest[0], 'wait <text|ref|css=selector> [--gone] [--timeout ms]'),
        timeout: integer(flags.timeout, '--timeout'),
        gone: !!flags.gone,
      });
      return out(r, `${flags.gone ? 'Gone' : 'Found'} after ${r.waited} ms`);
    }
    case 'snap': {
      const file = path.resolve(flags.out || 'tabsteer-snap.png');
      const r = await request('snap', { tabId });
      const png = Buffer.from(r.base64, 'base64');
      fs.writeFileSync(file, png);
      return out({ path: file, bytes: png.length }, `Saved ${file} (${Math.round(png.length / 1024)} KB)`);
    }
    default:
      fail(`Unknown command "${command}". Run "tabsteer --help".`);
  }
}

main().catch((e) => fail(e.message));
