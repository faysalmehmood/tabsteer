'use strict';

// install / uninstall / doctor. Nothing here runs implicitly: the user asks
// for it with an explicit command.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { VERSION, HOST_NAME, EXTENSION_IDS, HOME, SOCKET_PATH, WRAPPER_PATH } = require('./common');

const ROOT = path.resolve(__dirname, '..');
const HOST_SCRIPT = path.join(ROOT, 'host', 'native-host.js');
const EXTENSION_DIR = path.join(ROOT, 'extension');
const SKILL_SOURCE = path.join(ROOT, 'skills', 'tabsteer', 'SKILL.md');
const CLI_SCRIPT = path.join(ROOT, 'bin', 'tabsteer.js');
const LINK_PATH = path.join(os.homedir(), '.local', 'bin', 'tabsteer');

const AGENT_SKILL_DIRS = {
  claude: path.join(os.homedir(), '.claude', 'skills', 'tabsteer'),
  antigravity: path.join(os.homedir(), '.gemini', 'config', 'skills', 'tabsteer'),
};

// Each Chromium-family browser reads native messaging manifests from its own
// directory. We only write into browsers that are actually present.
function browserDirs() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    return {
      'Chrome': path.join(base, 'Google', 'Chrome'),
      'Chrome Beta': path.join(base, 'Google', 'Chrome Beta'),
      'Chrome Canary': path.join(base, 'Google', 'Chrome Canary'),
      'Chromium': path.join(base, 'Chromium'),
      'Brave': path.join(base, 'BraveSoftware', 'Brave-Browser'),
      'Edge': path.join(base, 'Microsoft Edge'),
      'Vivaldi': path.join(base, 'Vivaldi'),
      'Arc': path.join(base, 'Arc', 'User Data'),
    };
  }
  if (process.platform === 'linux') {
    const base = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    return {
      'Chrome': path.join(base, 'google-chrome'),
      'Chrome Beta': path.join(base, 'google-chrome-beta'),
      'Chromium': path.join(base, 'chromium'),
      'Brave': path.join(base, 'BraveSoftware', 'Brave-Browser'),
      'Edge': path.join(base, 'microsoft-edge'),
      'Vivaldi': path.join(base, 'vivaldi'),
    };
  }
  return null;
}

const manifestPath = (browserDir) => path.join(browserDir, 'NativeMessagingHosts', `${HOST_NAME}.json`);

function presentBrowsers() {
  const dirs = browserDirs();
  if (!dirs) {
    console.error(`Error: Tab Steer supports macOS and Linux for now (this is ${process.platform}).`);
    process.exit(1);
  }
  return Object.entries(dirs).filter(([, dir]) => fs.existsSync(dir));
}

function install({ flags }) {
  const browsers = presentBrowsers();
  if (!browsers.length) {
    console.error('Error: no supported Chromium-family browser found.');
    process.exit(1);
  }

  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.chmodSync(HOME, 0o700);

  // Browsers launched from the desktop don't see the shell's PATH, so the
  // wrapper pins the absolute path of the node that ran this install.
  const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  fs.writeFileSync(WRAPPER_PATH, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(HOST_SCRIPT)}\n`, { mode: 0o755 });
  fs.chmodSync(WRAPPER_PATH, 0o755);
  console.log(`Host launcher   ${WRAPPER_PATH}`);

  const manifest = {
    name: HOST_NAME,
    description: 'Tab Steer native messaging host',
    path: WRAPPER_PATH,
    type: 'stdio',
    allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
  };
  for (const [name, dir] of browsers) {
    const file = manifestPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Registered for  ${name}`);
  }

  if (flags.agent) {
    const dir = AGENT_SKILL_DIRS[flags.agent];
    if (!dir) {
      console.error(`Error: unknown agent "${flags.agent}". Choose one of: ${Object.keys(AGENT_SKILL_DIRS).join(', ')}.`);
      process.exit(1);
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(SKILL_SOURCE, path.join(dir, 'SKILL.md'));
    console.log(`Skill           ${path.join(dir, 'SKILL.md')}`);
  }

  if (flags.link) {
    fs.mkdirSync(path.dirname(LINK_PATH), { recursive: true });
    try {
      fs.unlinkSync(LINK_PATH);
    } catch (e) {}
    fs.symlinkSync(CLI_SCRIPT, LINK_PATH);
    console.log(`Command         ${LINK_PATH}`);
  }

  console.log(`
Next, the extension:
  Install it from the Chrome Web Store if you haven't yet:
    https://chromewebstore.google.com/detail/tab-steer/mkpmilnglglhiaeojeeioafmbjjghmed
  It connects within a minute. To use an unpacked copy instead:
    1. Open chrome://extensions and turn on "Developer mode".
    2. Click "Load unpacked" and choose:
       ${EXTENSION_DIR}

Then click the Tab Steer toolbar icon on a tab to share it, and check the setup with: tabsteer doctor`);
}

function uninstall() {
  const removed = [];
  const remove = (file) => {
    try {
      fs.unlinkSync(file);
      removed.push(file);
    } catch (e) {}
  };
  for (const [, dir] of presentBrowsers()) remove(manifestPath(dir));
  remove(WRAPPER_PATH);
  remove(SOCKET_PATH);
  for (const dir of Object.values(AGENT_SKILL_DIRS)) {
    remove(path.join(dir, 'SKILL.md'));
    try {
      fs.rmdirSync(dir);
    } catch (e) {}
  }
  try {
    if (fs.readlinkSync(LINK_PATH) === CLI_SCRIPT) remove(LINK_PATH);
  } catch (e) {}
  try {
    fs.rmdirSync(HOME);
  } catch (e) {}
  console.log(removed.length ? `Removed:\n  ${removed.join('\n  ')}` : 'Nothing to remove.');
  console.log('\nTo finish, remove the Tab Steer extension from chrome://extensions.');
}

async function doctor({ request }) {
  let problems = 0;
  const check = (ok, label, fix) => {
    console.log(`${ok ? '✓' : '✗'} ${label}`);
    if (!ok) {
      problems++;
      if (fix) console.log(`    ${fix}`);
    }
    return ok;
  };

  console.log(`tabsteer ${VERSION}, node ${process.version}\n`);
  check(Number(process.versions.node.split('.')[0]) >= 18, 'Node.js 18 or newer', 'Upgrade Node.js.');

  let wrapperNode = null;
  if (check(fs.existsSync(WRAPPER_PATH), 'Host launcher exists', 'Run "tabsteer install".')) {
    const match = /^exec '(.+?)' '(.+?)'$/m.exec(fs.readFileSync(WRAPPER_PATH, 'utf8'));
    wrapperNode = match && match[1];
    check(!!wrapperNode && fs.existsSync(wrapperNode), 'Launcher points at an existing node binary', 'Node moved (version manager?). Run "tabsteer install" again.');
    check(!!match && fs.existsSync(match[2]), 'Launcher points at an existing host script', 'Tab Steer moved. Run "tabsteer install" again.');
  }

  const registered = presentBrowsers().filter(([, dir]) => {
    try {
      return JSON.parse(fs.readFileSync(manifestPath(dir), 'utf8')).path === WRAPPER_PATH;
    } catch (e) {
      return false;
    }
  });
  check(registered.length > 0, `Registered with a browser${registered.length ? ` (${registered.map(([n]) => n).join(', ')})` : ''}`, 'Run "tabsteer install".');

  try {
    const mode = fs.statSync(HOME).mode & 0o777;
    check(mode === 0o700, `${HOME} is private`, `Run: chmod 700 ${HOME}`);
  } catch (e) {}

  let status = null;
  try {
    status = await request('status');
  } catch (e) {}
  if (check(!!status, 'Extension is connected', 'Open the browser, load the extension from chrome://extensions, and make sure it is enabled.')) {
    // The extension and this tool update separately, so patch versions may differ.
    const series = (v) => String(v).split('.').slice(0, 2).join('.');
    check(series(status.version) === series(VERSION), `Extension ${status.version} works with tabsteer ${VERSION}`, 'Update both: "npm install -g tabsteer", and update or reload the extension.');
    const build = status.extensionId === EXTENSION_IDS[1] ? 'Chrome Web Store build' : status.extensionId === EXTENSION_IDS[0] ? 'unpacked build' : 'unknown build';
    console.log(`  ${build}, ${status.paused ? 'paused by the user' : 'not paused'}, ${status.sharedTabs} shared tab(s)`);
    if (status.turnedOn === false) console.log('  Not turned on yet: click the Tab Steer toolbar icon and choose "Turn on".');
  }

  console.log(problems ? `\n${problems} problem(s) found.` : '\nAll good.');
  process.exitCode = problems ? 1 : 0;
}

module.exports = { install, uninstall, doctor };
