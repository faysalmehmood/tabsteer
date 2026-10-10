#!/usr/bin/env node
'use strict';

// Tab Steer native messaging host. Chrome launches this process and talks to
// it over stdio; the CLI talks to it over a private Unix socket. It relays
// requests and holds no browser state of its own.

const fs = require('fs');
const net = require('net');
const {
  VERSION, HOME, SOCKET_PATH, LOG_PATH, DEBUG_FLAG, MAX_REQUEST_BYTES, HOST_TIMEOUT_MS,
} = require('../lib/common');

fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
fs.chmodSync(HOME, 0o700);

// Off unless ~/.tabsteer/debug exists. Logs action names only, never payloads.
const DEBUG = fs.existsSync(DEBUG_FLAG);
function log(line) {
  if (!DEBUG) return;
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`, { mode: 0o600 });
  } catch (e) {}
}

// ------------------------------------------------- Chrome side (stdio)
const pending = new Map();
let nextId = 1;
let input = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (input.length < 4 + length) break;
    const body = input.subarray(4, 4 + length);
    input = input.subarray(4 + length);
    let msg;
    try {
      msg = JSON.parse(body.toString('utf8'));
    } catch (e) {
      log('unparseable message from Chrome');
      continue;
    }
    onChromeMessage(msg);
  }
});
process.stdin.on('end', shutdown);

function sendToChrome(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function onChromeMessage(msg) {
  if (msg.type === 'hello') {
    log(`extension connected (v${msg.version})`);
    sendToChrome({ type: 'hello_ack', version: VERSION });
    return;
  }
  const waiter = pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  clearTimeout(waiter.timer);
  waiter.resolve(msg);
}

function askChrome(action, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for the browser to finish "${action}".`));
    }, HOST_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    log(`-> ${action}`);
    sendToChrome({ id, action, params });
  });
}

// ---------------------------------------------------- CLI side (socket)
// One JSON request line in, one JSON response line out, per connection.
const server = net.createServer((client) => {
  let raw = '';
  let handled = false;
  client.setEncoding('utf8');
  client.on('error', () => {});
  client.on('data', async (chunk) => {
    if (handled) return;
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) {
      handled = true;
      return client.end(JSON.stringify({ success: false, error: 'Request too large.' }) + '\n');
    }
    const newline = raw.indexOf('\n');
    if (newline === -1) return;
    handled = true;
    let response;
    try {
      const request = JSON.parse(raw.slice(0, newline));
      if (typeof request.action !== 'string') throw new Error('Missing action.');
      response = await askChrome(request.action, request.params || {});
    } catch (e) {
      response = { success: false, error: e.message };
    }
    client.end(JSON.stringify(response) + '\n');
  });
});

let ownInode = null;
try {
  fs.unlinkSync(SOCKET_PATH);
} catch (e) {}
// Create the socket already private; chmod after listen would leave a window.
const oldMask = process.umask(0o177);
server.listen(SOCKET_PATH, () => {
  process.umask(oldMask);
  ownInode = fs.statSync(SOCKET_PATH).ino;
  log(`listening on ${SOCKET_PATH}`);
});
server.on('error', (e) => {
  log(`socket error: ${e.message}`);
  process.exit(1);
});

function shutdown() {
  // Only remove the socket if a newer host hasn't replaced it.
  try {
    if (ownInode !== null && fs.statSync(SOCKET_PATH).ino === ownInode) fs.unlinkSync(SOCKET_PATH);
  } catch (e) {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
