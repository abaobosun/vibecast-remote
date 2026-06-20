'use strict';

const { execFile } = require('child_process');
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

const PASTE_RESTORE_DELAY_MS = 350;
const PASTE_MODIFIER = Key.LeftSuper;

keyboard.config.autoDelayMs = 0;

const KEY_MAP = {
  Enter: Key.Enter,
  Backspace: Key.Backspace,
  Tab: Key.Tab,
  Escape: Key.Escape
};

function isAscii(text) {
  return /^[\x00-\x7F]*$/.test(text);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: options.timeout || 3000
    }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    const child = execFile('pbcopy', (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin.end(text, 'utf8');
  });
}

function readClipboard() {
  return runCommand('pbpaste', []);
}

async function pasteClipboard() {
  await keyboard.pressKey(PASTE_MODIFIER);
  await keyboard.pressKey(Key.V);
  await keyboard.releaseKey(Key.V);
  await keyboard.releaseKey(PASTE_MODIFIER);
}

async function injectText(text) {
  if (!text) return;

  if (isAscii(text)) {
    await keyboard.type(text);
    return;
  }

  let previousClipboard = null;
  try {
    previousClipboard = await readClipboard();
  } catch {
    previousClipboard = null;
  }

  await copyToClipboard(text);
  await pasteClipboard();

  if (previousClipboard !== null) {
    setTimeout(() => {
      copyToClipboard(previousClipboard).catch(() => {});
    }, PASTE_RESTORE_DELAY_MS);
  }
}

async function pressNamedKey(name) {
  const key = KEY_MAP[name];
  if (key === undefined) return;
  await keyboard.pressKey(key);
  await keyboard.releaseKey(key);
}

async function getFrontmostAppName() {
  const script = 'tell application "System Events" to get name of first application process whose frontmost is true';
  const out = await runCommand('osascript', ['-e', script], { timeout: 2000 });
  return (out || '').trim() || 'Current Focus';
}

module.exports = {
  id: 'darwin',
  label: 'macOS',
  localMachineLabel: 'Mac',
  setupLines: [
    'macOS setup: System Settings -> Privacy & Security -> Accessibility',
    'Enable the terminal app or node process that is running this server.'
  ],
  getFrontmostAppName,
  injectText,
  pressNamedKey
};
