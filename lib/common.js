'use strict';

const os = require('os');
const path = require('path');

const VERSION = require('../package.json').version;
const HOST_NAME = 'dev.tabsteer.host';

// The unpacked extension's ID is fixed by the public key in its manifest.
// Add the Chrome Web Store ID here once the extension is listed.
const EXTENSION_IDS = ['fphchnijffeejbacbknlbfmdhacgmicn'];

// Everything the host and CLI share lives in one private directory.
const HOME = process.env.TABSTEER_HOME || path.join(os.homedir(), '.tabsteer');
const SOCKET_PATH = path.join(HOME, 'tabsteer.sock');
const LOG_PATH = path.join(HOME, 'host.log');
const DEBUG_FLAG = path.join(HOME, 'debug');
const WRAPPER_PATH = path.join(HOME, 'tabsteer-host');

const MAX_REQUEST_BYTES = 512 * 1024;
const HOST_TIMEOUT_MS = 60000;

module.exports = {
  VERSION, HOST_NAME, EXTENSION_IDS, HOME, SOCKET_PATH, LOG_PATH, DEBUG_FLAG, WRAPPER_PATH,
  MAX_REQUEST_BYTES, HOST_TIMEOUT_MS,
};
