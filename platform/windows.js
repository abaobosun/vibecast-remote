'use strict';

const { execFile } = require('child_process');
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

const PASTE_RESTORE_DELAY_MS = 350;
const PASTE_MODIFIER = Key.LeftControl;

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

function runPowerShell(command, options = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-Command',
      command
    ], {
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
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  return runPowerShell(
    `Set-Clipboard -Value ([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}')))`
  );
}

async function readClipboard() {
  const out = await runPowerShell(
    '$t=Get-Clipboard -Raw; if($null -ne $t){[System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($t))}'
  );
  const encoded = (out || '').trim();
  return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
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
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class VibeCastWin32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
$buffer = New-Object System.Text.StringBuilder 512
$handle = [VibeCastWin32]::GetForegroundWindow()
[void][VibeCastWin32]::GetWindowText($handle, $buffer, $buffer.Capacity)
$buffer.ToString()
`;
  const out = await runPowerShell(script, { timeout: 3000 });
  return (out || '').trim() || 'Current Focus';
}

module.exports = {
  id: 'win32',
  label: 'Windows',
  localMachineLabel: 'PC',
  setupLines: [
    'Windows setup: allow Node.js through Windows Defender Firewall if prompted.',
    'If injecting into an elevated app fails, run this server as Administrator too.'
  ],
  getFrontmostAppName,
  injectText,
  pressNamedKey
};
