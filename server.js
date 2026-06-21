'use strict';

/*
 * VibeCast Remote
 * A local-first phone-browser input bridge for macOS and Windows.
 *
 * This project is inspired by hello-claude/phone-web-remote:
 * https://github.com/hello-claude/phone-web-remote
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const platformAdapter = require('./platform');
const packageMeta = require('./package.json');

const PORT = Number(process.env.PORT) || 8765;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const PLATFORM = process.platform;
const PIN = String(Math.floor(1000 + Math.random() * 9000));
const PAIRING_TOKEN = crypto.randomBytes(24).toString('base64url');
const MAX_FAILS = 20;
const BLOCK_MS = 15 * 1000;
const STATUS_INTERVAL_MS = 2000;
const SEND_ENTER_DELAY_MS = 120;
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
    if (!Array.isArray(parsed.targets) || parsed.targets.length === 0) parsed.targets = defaultTargets();
    return parsed;
  } catch {
    return { appName: 'VibeCast Remote', targets: defaultTargets(), quickButtons: [] };
  }
}

function defaultTargets() {
  return [
    { id: 'current', label: 'Current Focus', hint: 'Use focused input', initial: 'C', sendMode: 'type' },
    { id: 'codex', label: 'Codex', hint: 'Draft for Codex', initial: 'C', sendMode: 'sendEnter' },
    { id: 'notion', label: 'Notion', hint: 'Draft for Notion', initial: 'N', sendMode: 'type' }
  ];
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

function isLocalRequest(req) {
  const ip = getClientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
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
    platformLabel: platformAdapter.label,
    target: targetState,
    targets: config.targets,
    port: PORT,
    localUrl: `http://127.0.0.1:${PORT}`,
    lanIPs,
    lanUrls: lanIPs.map((ip) => `http://${ip}:${PORT}`),
    startedAt
  };
}

function desktopPayload() {
  const lanIPs = getLanIPs();
  return {
    ok: true,
    appName: config.appName || 'VibeCast Remote',
    version: packageMeta.version,
    platform: PLATFORM,
    platformLabel: platformAdapter.label,
    localMachineLabel: platformAdapter.localMachineLabel,
    pin: PIN,
    token: PAIRING_TOKEN,
    tokenUrls: lanIPs.map((ip) => buildUrl(ip, true)),
    localUrl: buildUrl('127.0.0.1'),
    desktopUrl: `${buildUrl('127.0.0.1')}desktop`,
    lanIPs,
    lanUrls: lanIPs.map((ip) => buildUrl(ip)),
    target: targetState,
    targets: config.targets,
    quickButtons: config.quickButtons,
    setupLines: platformAdapter.setupLines,
    startedAt
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderValueList(values, emptyText) {
  if (!values.length) return `<div class="muted">${escapeHtml(emptyText)}</div>`;
  return values.map((value) => `<code>${escapeHtml(value)}</code>`).join('');
}

function renderDesktopPage(payload) {
  const targetRows = payload.targets.map((target) => `
    <tr>
      <td>${escapeHtml(target.label || target.id)}</td>
      <td><code>${escapeHtml(target.id)}</code></td>
      <td>${escapeHtml(target.sendMode || 'type')}</td>
      <td>${escapeHtml(target.hint || '')}</td>
    </tr>
  `).join('');
  const quickButtonRows = payload.quickButtons.map((button) => `
    <tr>
      <td>${escapeHtml(button.label || '')}</td>
      <td><code>${escapeHtml(button.payload || '')}</code></td>
    </tr>
  `).join('');
  const setupLines = payload.setupLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="10">
  <title>VibeCast Desktop</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7f4;
      --panel: #ffffff;
      --panel-strong: #e8f7f2;
      --ink: #18302c;
      --muted: #657571;
      --line: #cddbd6;
      --accent: #159884;
      --danger: #be4a45;
      --button: #edf3f0;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 22px;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    main {
      width: min(980px, 100%);
      margin: 0 auto;
      display: grid;
      gap: 14px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 4px 0;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 16px;
    }
    .pill {
      border: 1px solid rgba(21, 152, 132, 0.38);
      border-radius: 999px;
      padding: 7px 11px;
      background: var(--panel-strong);
      color: #0b6f61;
      font-size: 13px;
      font-weight: 800;
      white-space: nowrap;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      background: var(--panel);
      box-shadow: 0 18px 42px rgba(31, 57, 50, 0.11);
    }
    .wide { grid-column: 1 / -1; }
    .stat {
      display: grid;
      gap: 5px;
      margin: 0 0 13px;
    }
    .label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .value {
      min-width: 0;
      font-size: 17px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .pin {
      font-size: 34px;
      letter-spacing: 7px;
      color: var(--accent);
    }
    code {
      display: block;
      margin: 5px 0;
      padding: 9px 10px;
      border-radius: 8px;
      background: #f0f5f2;
      color: #143530;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th,
    td {
      border-top: 1px solid var(--line);
      padding: 9px 7px;
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    td code {
      margin: 0;
      padding: 5px 7px;
    }
    ul {
      margin: 0;
      padding-left: 19px;
      color: var(--muted);
      line-height: 1.55;
    }
    a {
      color: var(--accent);
      font-weight: 800;
      text-decoration: none;
    }
    @media (max-width: 760px) {
      body { padding: 12px; }
      header { align-items: flex-start; flex-direction: column; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>${escapeHtml(payload.appName)} Desktop</h1>
        <div class="muted">Local-only diagnostics. This page refreshes every 10 seconds.</div>
      </div>
      <div class="pill">v${escapeHtml(payload.version)} · ${escapeHtml(payload.platformLabel)}</div>
    </header>

    <section class="grid">
      <div class="card">
        <h2>Pairing</h2>
        <div class="stat">
          <div class="label">PIN</div>
          <div class="value pin">${escapeHtml(payload.pin)}</div>
        </div>
        <div class="stat">
          <div class="label">Token URL</div>
          ${renderValueList(payload.tokenUrls, 'No LAN address found. Check Wi-Fi and restart.')}
        </div>
        <div class="muted">Open the token URL on a phone connected to the same Wi-Fi.</div>
      </div>

      <div class="card">
        <h2>Service</h2>
        <div class="stat">
          <div class="label">Local URL</div>
          <code>${escapeHtml(payload.localUrl)}</code>
        </div>
        <div class="stat">
          <div class="label">Desktop Dashboard</div>
          <code>${escapeHtml(payload.desktopUrl)}</code>
        </div>
        <div class="stat">
          <div class="label">Started</div>
          <div class="value">${escapeHtml(payload.startedAt)}</div>
        </div>
      </div>

      <div class="card">
        <h2>Current Focus</h2>
        <div class="stat">
          <div class="label">Frontmost App</div>
          <div class="value">${escapeHtml(payload.target.appName)}</div>
        </div>
        <div class="stat">
          <div class="label">Updated</div>
          <div class="value">${escapeHtml(payload.target.updatedAt)}</div>
        </div>
      </div>

      <div class="card">
        <h2>Network</h2>
        <div class="stat">
          <div class="label">LAN URLs without token</div>
          ${renderValueList(payload.lanUrls, 'No LAN address found.')}
        </div>
        <div class="stat">
          <div class="label">LAN IPs</div>
          ${renderValueList(payload.lanIPs, 'No LAN IPs found.')}
        </div>
      </div>

      <div class="card wide">
        <h2>Targets</h2>
        <table>
          <thead><tr><th>Label</th><th>ID</th><th>Send Mode</th><th>Hint</th></tr></thead>
          <tbody>${targetRows || '<tr><td colspan="4" class="muted">No targets configured.</td></tr>'}</tbody>
        </table>
      </div>

      <div class="card wide">
        <h2>Quick Buttons</h2>
        <table>
          <thead><tr><th>Label</th><th>Payload</th></tr></thead>
          <tbody>${quickButtonRows || '<tr><td colspan="2" class="muted">No quick buttons configured.</td></tr>'}</tbody>
        </table>
      </div>

      <div class="card wide">
        <h2>Permissions</h2>
        <ul>${setupLines || '<li>No platform-specific setup instructions.</li>'}</ul>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function buildUrl(host, includeToken = false) {
  const url = new URL(`http://${host}:${PORT}`);
  if (includeToken) url.searchParams.set('token', PAIRING_TOKEN);
  return url.toString();
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(String(a || ''));
  const bBuffer = Buffer.from(String(b || ''));
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

async function injectTextAndEnter(text) {
  await platformAdapter.injectText(text);
  await new Promise((resolve) => setTimeout(resolve, SEND_ENTER_DELAY_MS));
  await platformAdapter.pressNamedKey('Enter');
}

async function refreshTargetState() {
  try {
    const appName = await platformAdapter.getFrontmostAppName();
    if (appName !== targetState.appName) {
      targetState = {
        appName,
        platform: PLATFORM,
        updatedAt: new Date().toISOString()
      };
      broadcast({ type: 'status', target: targetState, targets: config.targets, quickButtons: config.quickButtons });
    }
  } catch {
    if (targetState.appName !== 'Current Focus') {
      targetState = {
        appName: 'Current Focus',
        platform: PLATFORM,
        updatedAt: new Date().toISOString()
      };
      broadcast({ type: 'status', target: targetState, targets: config.targets, quickButtons: config.quickButtons });
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

  const tokenMatches = typeof msg.token === 'string' && safeEqual(msg.token, PAIRING_TOKEN);
  const pinMatches = typeof msg.pin === 'string' && String(msg.pin) === PIN;

  if (tokenMatches || pinMatches) {
    authFails.delete(ip);
    authed.add(ws);
    sendJson(ws, { type: 'authOk', method: tokenMatches ? 'token' : 'pin' });
    sendJson(ws, {
      type: 'status',
      target: targetState,
      targets: config.targets,
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
      if (typeof msg.text === 'string') await platformAdapter.injectText(msg.text);
      sendJson(ws, { type: 'sent', mode: 'type', targetId: msg.targetId || 'current' });
      break;
    case 'sendEnter':
      if (typeof msg.text === 'string') await injectTextAndEnter(msg.text);
      else await platformAdapter.pressNamedKey('Enter');
      sendJson(ws, { type: 'sent', mode: 'sendEnter', targetId: msg.targetId || 'current' });
      break;
    case 'key':
      await platformAdapter.pressNamedKey(String(msg.key || ''));
      sendJson(ws, { type: 'sent', mode: 'key', key: msg.key });
      break;
    case 'ping':
      sendJson(ws, { type: 'pong', target: targetState, targets: config.targets, quickButtons: config.quickButtons });
      break;
    default:
      break;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
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

  if (url.pathname === '/desktop') {
    if (!isLocalRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Desktop dashboard is only available from this computer.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(renderDesktopPage(desktopPayload()));
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
  console.log(`Platform: ${platformAdapter.label}`);
  console.log(`On this ${platformAdapter.localMachineLabel}: ${buildUrl('127.0.0.1')}`);
  console.log(`Desktop dashboard: ${buildUrl('127.0.0.1')}desktop`);
  console.log('On your phone, open one of these same-Wi-Fi token URLs:');
  if (ips.length) {
    ips.forEach((ip) => console.log(`   ${buildUrl(ip, true)}`));
  } else {
    console.log('   No Wi-Fi/LAN address found yet. Check Network settings, then restart.');
  }
  console.log(`\nManual fallback PIN: ${PIN}`);
  if (ips.length) {
    console.log('Manual same-Wi-Fi URLs without token:');
    ips.forEach((ip) => console.log(`   ${buildUrl(ip)}`));
  }
  console.log('\nIf the phone URL stops opening, your Mac IP may have changed.');
  console.log(`Open http://127.0.0.1:${PORT}/health on the Mac to see the current LAN URL.`);
  console.log('');
  platformAdapter.setupLines.forEach((line) => console.log(line));
  console.log('=================================================\n');
});

refreshTargetState().catch(() => {});
setInterval(() => refreshTargetState().catch(() => {}), STATUS_INTERVAL_MS);
