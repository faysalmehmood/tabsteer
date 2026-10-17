'use strict';

// Exercises the native host and CLI with a stand-in for the browser.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOST = path.join(ROOT, 'host', 'native-host.js');
const CLI = path.join(ROOT, 'bin', 'tabsteer.js');

function frame(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

// Starts the host and plays the extension's part over its stdio.
function startHost(home, reply) {
  const child = spawn(process.execPath, [HOST], { env: { ...process.env, TABSTEER_HOME: home } });
  const seen = [];
  let buffer = Buffer.alloc(0);
  let ready;
  const acked = new Promise((r) => (ready = r));
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const length = buffer.readUInt32LE(0);
      const msg = JSON.parse(buffer.subarray(4, 4 + length).toString());
      buffer = buffer.subarray(4 + length);
      seen.push(msg);
      if (msg.type === 'hello_ack') ready();
      else child.stdin.write(frame(reply(msg)));
    }
  });
  child.stdin.write(frame({ type: 'hello', version: 'test' }));
  return { child, seen, acked };
}

function cli(home, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, TABSTEER_HOME: home } }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stdout, stderr })
    );
  });
}

async function waitFor(file) {
  for (let i = 0; i < 100 && !fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(fs.existsSync(file), `${file} should exist`);
}

test('host relays CLI requests and keeps its files private', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
  const host = startHost(home, (msg) =>
    msg.action === 'status'
      ? { id: msg.id, success: true, result: { version: 'test', paused: false, sharedTabs: 2 } }
      : { id: msg.id, success: false, error: 'Tab 9 is not shared with Tab Steer.' }
  );
  t.after(() => host.child.kill());
  await host.acked;
  const socket = path.join(home, 'tabsteer.sock');
  await waitFor(socket);

  assert.strictEqual(fs.statSync(home).mode & 0o777, 0o700, 'home directory is private');
  assert.strictEqual(fs.statSync(socket).mode & 0o777, 0o600, 'socket is private');
  assert.ok(!fs.existsSync(path.join(home, 'host.log')), 'no log unless debug is switched on');

  const ok = await cli(home, ['status', '--json']);
  assert.strictEqual(ok.code, 0, ok.stderr);
  assert.deepStrictEqual(JSON.parse(ok.stdout), { version: 'test', paused: false, sharedTabs: 2 });

  const bad = await cli(home, ['read', '--tab', '9']);
  assert.strictEqual(bad.code, 1);
  assert.match(bad.stderr, /Tab 9 is not shared/);
  assert.deepStrictEqual(host.seen.at(-1).params, { tabId: 9 });
});

test('host removes its socket when the browser disconnects', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
  const host = startHost(home, () => ({}));
  await host.acked;
  const socket = path.join(home, 'tabsteer.sock');
  await waitFor(socket);
  const exited = new Promise((r) => host.child.on('exit', r));
  host.child.stdin.end();
  await exited;
  assert.ok(!fs.existsSync(socket));
});

test('a surviving host reclaims the socket when the newer one exits', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
  const reply = (msg) => ({ id: msg.id, success: true, result: { version: 'test', paused: false, sharedTabs: 0 } });
  const first = startHost(home, reply);
  t.after(() => first.child.kill());
  await first.acked;
  const socket = path.join(home, 'tabsteer.sock');
  await waitFor(socket);
  const firstInode = fs.statSync(socket).ino;

  const second = startHost(home, reply);
  await second.acked;
  for (let i = 0; i < 100 && fs.statSync(socket).ino === firstInode; i++) await new Promise((r) => setTimeout(r, 50));
  const exited = new Promise((r) => second.child.on('exit', r));
  second.child.stdin.end();
  await exited;

  await waitFor(socket);
  const result = await cli(home, ['status', '--json']);
  assert.strictEqual(result.code, 0, result.stderr);
});

test('CLI reports a clear error when nothing is listening', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
  const result = await cli(home, ['status']);
  assert.strictEqual(result.code, 1);
  assert.match(result.stderr, /Not connected to the browser/);
});

test('host opens no network port', () => {
  const source = fs.readFileSync(HOST, 'utf8') + fs.readFileSync(path.join(ROOT, 'lib', 'common.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](http|https|dgram|http2)['"]\)/);
});
