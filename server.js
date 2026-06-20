'use strict';

/*
 * VibeCast Remote
 * A local-first phone-browser input bridge for macOS.
 *
 * This project is inspired by hello-claude/phone-web-remote:
 * https://github.com/hello-claude/phone-web-remote
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { WebSocketServer } = require('ws');
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

const PORT = Number(process.env.PORT) || 8765;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const PLATFORM = process.platform;
const PIN = String(Math.floor(1000 + Math.random() * 9000));
const MAX_FAILS = 20;
const BLOCK_MS = 15 * 1000;
const STATUS_INTERVAL_MS = 2000;
const PASTE_RESTORE_DELAY_MS = 350;
const SEND_ENTER_DELAY_MS = 120;

keyboard.config.autoDelayMs = 0;

const KEY_MAP = {
  Enter: Key.Enter,
  Backspace: Key.Backspace,
  Tab: Key.Tab,
  Escape: Key.Escape
};

const PASTE_MODIFIER = PLATFORM === 'darwin' ? Key.LeftSuper : Key.LeftControl;
const authed = new WeakSet();
const authFails = new Map();
let config = loadConfig();
let targetState = {
  appName: 'Current Focus',
  platform: PLATFORM,
  updatedAt: new Date().toISOString()
};

function loadConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!Array.isArray(parsed.quickButtons)) parsed.quickButtons = [];
    return parsed;
  } catch {
    return { appName: 'VibeCast Remote', quickButtons: [] };
  }
}

function sendJson(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcast(payload) {
  const encoded = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (authed.has(client) && client.readyState === 1) client.send(encoded);
  });
}

function getClientIp(req) {
  return (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

function getLanIPs() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const item of ifaces[name] || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (isLikelyPhoneReachableIPv4(item.address)) ips.push(item.address);
    }
  }
  return ips;
}

function isLikelyPhoneReachableIPv4(ip) {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function healthPayload() {
  const lanIPs = getLanIPs();
  return {
    ok: true,
    appName: config.appName || 'VibeCast Remote',
    platform: PLATFORM,
    target: targetState,
    port: PORT,
    localUrl: `http://127.0.0.1:${PORT}`,
    lanIPs,
    lanUrls: lanIPs.map((ip) => `http://${ip}:${PORT}`),
    startedAt
  };
}

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
  if (PLATFORM !== 'darwin') {
    return Promise.reject(new Error('Clipboard injection is currently implemented for macOS only.'));
  }

  return new Promise((resolve, reject) => {
    const child = execFile('pbcopy', (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin.end(text, 'utf8');
  });
}

function readClipboard() {
  if (PLATFORM !== 'darwin') {
    return Promise.reject(new Error('Clipboard restore is currently implemented for macOS only.'));
  }
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

async function injectTextAndEnter(text) {
  await injectText(text);
  await new Promise((resolve) => setTimeout(resolve, SEND_ENTER_DELAY_MS));
  await pressNamedKey('Enter');
}

async function getFrontmostAppName() {
  if (PLATFORM !== 'darwin') return 'Current Focus';
  const script = 'tell application "System Events" to get name of first application process whose frontmost is true';
  const out = await runCommand('osascript', ['-e', script], { timeout: 2000 });
  return (out || '').trim() || 'Current Focus';
}

async function refreshTargetState() {
  try {
    const appName = await getFrontmostAppName();
    if (appName !== targetState.appName) {
      targetState = {
        appName,
        platform: PLATFORM,
        updatedAt: new Date().toISOString()
      };
      broadcast({ type: 'status', target: targetState, quickButtons: config.quickButtons });
    }
  } catch {
    if (targetState.appName !== 'Current Focus') {
      targetState = {
        appName: 'Current Focus',
        platform: PLATFORM,
        updatedAt: new Date().toISOString()
      };
      broadcast({ type: 'status', target: targetState, quickButtons: config.quickButtons });
    }
  }
}

function handleAuth(ws, req, msg) {
  const ip = getClientIp(req);
  const failRecord = authFails.get(ip);
  if (failRecord && failRecord.until > Date.now()) {
    sendJson(ws, {
      type: 'authFail',
      blocked: true,
      retryAfterMs: Math.max(0, failRecord.until - Date.now())
    });
    ws.close();
    return;
  }

  if (String(msg.pin) === PIN) {
    authFails.delete(ip);
    authed.add(ws);
    sendJson(ws, { type: 'authOk' });
    sendJson(ws, {
      type: 'status',
      target: targetState,
      quickButtons: config.quickButtons,
      appName: config.appName || 'VibeCast Remote'
    });
    return;
  }

  const nextFailRecord = authFails.get(ip) || { count: 0, until: 0 };
  nextFailRecord.count += 1;
  if (nextFailRecord.count >= MAX_FAILS) {
    nextFailRecord.count = 0;
    nextFailRecord.until = Date.now() + BLOCK_MS;
  }
  authFails.set(ip, nextFailRecord);
  sendJson(ws, {
    type: 'authFail',
    blocked: nextFailRecord.until > Date.now(),
    attemptsLeft: nextFailRecord.until > Date.now() ? 0 : Math.max(0, MAX_FAILS - nextFailRecord.count),
    retryAfterMs: nextFailRecord.until > Date.now() ? Math.max(0, nextFailRecord.until - Date.now()) : 0
  });
}

async function handleAuthedMessage(ws, msg) {
  switch (msg.type) {
    case 'type':
      if (typeof msg.text === 'string') await injectText(msg.text);
      sendJson(ws, { type: 'sent', mode: 'type' });
      break;
    case 'sendEnter':
      if (typeof msg.text === 'string') await injectTextAndEnter(msg.text);
      else await pressNamedKey('Enter');
      sendJson(ws, { type: 'sent', mode: 'sendEnter' });
      break;
    case 'key':
      await pressNamedKey(String(msg.key || ''));
      sendJson(ws, { type: 'sent', mode: 'key', key: msg.key });
      break;
    case 'ping':
      sendJson(ws, { type: 'pong', target: targetState });
      break;
    default:
      break;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const startedAt = new Date().toISOString();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(healthPayload(), null, 2));
    return;
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(requestedPath)}`);

  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'auth') {
      handleAuth(ws, req, msg);
      return;
    }

    if (!authed.has(ws)) return;

    try {
      await handleAuthedMessage(ws, msg);
      refreshTargetState().catch(() => {});
    } catch (error) {
      sendJson(ws, {
        type: 'error',
        message: String((error && error.message) || error)
      });
    }
  });
});

server.on('error', (error) => {
  console.error('\nVibeCast Remote could not start.');
  console.error(`Reason: ${error.code || 'ERROR'} ${error.message || error}`);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=9000 npm start`);
  }
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    console.error('The current environment blocked opening the local network port.');
  }
  process.exitCode = 1;
});

wss.on('error', (error) => {
  console.error(`WebSocket error: ${error.message || error}`);
});

server.listen(PORT, HOST, () => {
  const ips = getLanIPs();
  console.log('\n================ VibeCast Remote ================');
  console.log(`Pairing PIN: ${PIN}`);
  console.log(`On this Mac: http://127.0.0.1:${PORT}`);
  console.log('On your phone, open one of these same-Wi-Fi URLs:');
  if (ips.length) {
    ips.forEach((ip) => console.log(`   http://${ip}:${PORT}`));
  } else {
    console.log('   No Wi-Fi/LAN address found yet. Check Network settings, then restart.');
  }
  console.log('\nIf the phone URL stops opening, your Mac IP may have changed.');
  console.log(`Open http://127.0.0.1:${PORT}/health on the Mac to see the current LAN URL.`);
  console.log('\nmacOS setup: System Settings -> Privacy & Security -> Accessibility');
  console.log('Enable the terminal app or node process that is running this server.');
  console.log('=================================================\n');
});

refreshTargetState().catch(() => {});
setInterval(() => refreshTargetState().catch(() => {}), STATUS_INTERVAL_MS);
