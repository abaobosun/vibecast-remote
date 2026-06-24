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
    return normalizeConfig(parsed);
  } catch {
    return normalizeConfig({ appName: 'VibeCast Remote', targets: defaultTargets(), quickButtons: [] });
  }
}

function defaultTargets() {
  return [
    { id: 'current', label: 'Current Focus', hint: 'Use focused input', initial: 'C', sendMode: 'type' },
    { id: 'codex', label: 'Codex', hint: 'Draft for Codex', initial: 'C', sendMode: 'sendEnter' },
    { id: 'notion', label: 'Notion', hint: 'Draft for Notion', initial: 'N', sendMode: 'type' },
    { id: 'hermes', label: 'Hermes', hint: 'Draft for Hermes', initial: 'H', sendMode: 'type' },
    { id: 'claude-code', label: 'Claude Code', hint: 'Draft for Claude Code', initial: 'C', sendMode: 'sendEnter' },
    { id: 'obsidian', label: 'Obsidian', hint: 'Draft for Obsidian', initial: 'O', sendMode: 'type' }
  ];
}

function defaultQuickButtons() {
  return [
    { label: 'Continue', payload: '继续' },
    { label: 'Yes', payload: 'y' },
    { label: 'No', payload: 'n' },
    { label: '/compact', payload: '/compact' },
    { label: '/clear', payload: '/clear' },
    { label: '/review', payload: '/review' }
  ];
}

function normalizeSendMode(mode) {
  return mode === 'sendEnter' ? 'sendEnter' : 'type';
}

function limitString(value, fallback, maxLength) {
  const text = String(value == null ? fallback : value).trim();
  return text.slice(0, maxLength);
}

function fallbackId(label, index) {
  const id = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || `target-${index + 1}`;
}

function normalizeTargets(rawTargets) {
  const source = Array.isArray(rawTargets) && rawTargets.length ? rawTargets : defaultTargets();
  const seen = new Set();
  const targets = [];

  source.slice(0, 24).forEach((target, index) => {
    if (!target || typeof target !== 'object') return;
    const label = limitString(target.label, target.id || `Target ${index + 1}`, 40);
    const id = limitString(target.id, fallbackId(label, index), 48);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const initial = limitString(target.initial, label || id, 4).charAt(0).toUpperCase() || 'T';
    targets.push({
      id,
      label: label || id,
      hint: limitString(target.hint, '', 80),
      initial,
      sendMode: normalizeSendMode(target.sendMode)
    });
  });

  return targets.length ? targets : defaultTargets();
}

function normalizeQuickButtons(rawButtons) {
  if (!Array.isArray(rawButtons)) return [];
  return rawButtons.slice(0, 24).map((button) => {
    if (!button || typeof button !== 'object') return null;
    const payload = limitString(button.payload, '', 500);
    const label = limitString(button.label, payload || 'Send', 40);
    if (!payload) return null;
    return { label, payload };
  }).filter(Boolean);
}

function normalizeConfig(rawConfig) {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  return {
    appName: limitString(source.appName, 'VibeCast Remote', 80) || 'VibeCast Remote',
    targets: normalizeTargets(source.targets),
    quickButtons: normalizeQuickButtons(source.quickButtons)
  };
}

function saveConfig(nextConfig) {
  const normalized = normalizeConfig(nextConfig);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(normalized, null, 2)}\n`);
  config = normalized;
  broadcastStatus();
  return normalized;
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

function broadcastStatus() {
  broadcast({
    type: 'status',
    target: targetState,
    targets: config.targets,
    quickButtons: config.quickButtons,
    appName: config.appName || 'VibeCast Remote'
  });
}

function getClientIp(req) {
  return (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

function isLocalRequest(req) {
  const ip = getClientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase();
}

function isAllowedWebSocketOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;

  const host = normalizeHost(req.headers.host);
  if (!host) return false;

  try {
    const originUrl = new URL(origin);
    if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return false;
    return normalizeHost(originUrl.host) === host;
  } catch {
    return false;
  }
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

function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function renderDesktopPage(payload) {
  const sendModeLabel = (mode) => mode === 'sendEnter' ? '发送并回车' : '仅发送';
  const targetRows = payload.targets.map((target) => `
    <tr>
      <td>${escapeHtml(target.label || target.id)}</td>
      <td><code>${escapeHtml(target.id)}</code></td>
      <td>${escapeHtml(sendModeLabel(target.sendMode))}</td>
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
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VibeCast 本机面板</title>
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
    button {
      min-height: 38px;
      border: 0;
      border-radius: 8px;
      padding: 0 12px;
      background: var(--button);
      color: var(--ink);
      font: inherit;
      font-weight: 800;
    }
    button.primary {
      background: var(--accent);
      color: #ffffff;
    }
    button.danger {
      color: var(--danger);
    }
    input,
    select {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 9px;
      background: #fbfdfc;
      color: var(--ink);
      font: inherit;
      font-size: 14px;
    }
    .editor {
      display: grid;
      gap: 14px;
    }
    .editor-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .editor-list {
      display: grid;
      gap: 8px;
    }
    .editor-row {
      display: grid;
      gap: 8px;
      align-items: center;
    }
    .editor-row.target-row {
      grid-template-columns: 1fr 0.95fr 0.42fr 1.2fr 0.72fr auto;
    }
    .editor-row.quick-row {
      grid-template-columns: 1fr 2fr auto;
    }
    .field-labels {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .editor-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .row-actions {
      display: flex;
      gap: 5px;
      align-items: center;
      justify-content: flex-end;
    }
    .row-actions button {
      min-height: 32px;
      padding: 0 8px;
      font-size: 12px;
      white-space: nowrap;
    }
    .hidden-file {
      display: none;
    }
    .message {
      min-height: 20px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 750;
    }
    .message.error {
      color: var(--danger);
    }
    @media (max-width: 760px) {
      body { padding: 12px; }
      header { align-items: flex-start; flex-direction: column; }
      .grid { grid-template-columns: 1fr; }
      .editor-row.target-row,
      .editor-row.quick-row {
        grid-template-columns: 1fr;
      }
      .field-labels {
        display: none;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>${escapeHtml(payload.appName)} 本机面板</h1>
        <div class="muted">仅限本机访问的诊断与配置页面。</div>
      </div>
      <div class="pill">v${escapeHtml(payload.version)} · ${escapeHtml(payload.platformLabel)}</div>
    </header>

    <section class="grid">
      <div class="card">
        <h2>配对</h2>
        <div class="stat">
          <div class="label">PIN</div>
          <div class="value pin">${escapeHtml(payload.pin)}</div>
        </div>
        <div class="stat">
          <div class="label">Token 手机地址</div>
          ${renderValueList(payload.tokenUrls, '没有找到局域网地址。检查 Wi-Fi 后重启服务。')}
        </div>
        <div class="muted">在同一 Wi-Fi 下的手机浏览器里打开 token 地址。</div>
      </div>

      <div class="card">
        <h2>服务</h2>
        <div class="stat">
          <div class="label">本机地址</div>
          <code>${escapeHtml(payload.localUrl)}</code>
        </div>
        <div class="stat">
          <div class="label">本机面板</div>
          <code>${escapeHtml(payload.desktopUrl)}</code>
        </div>
        <div class="stat">
          <div class="label">启动时间</div>
          <div class="value">${escapeHtml(payload.startedAt)}</div>
        </div>
      </div>

      <div class="card">
        <h2>当前焦点</h2>
        <div class="stat">
          <div class="label">前台应用</div>
          <div class="value">${escapeHtml(payload.target.appName)}</div>
        </div>
        <div class="stat">
          <div class="label">更新时间</div>
          <div class="value">${escapeHtml(payload.target.updatedAt)}</div>
        </div>
      </div>

      <div class="card">
        <h2>网络</h2>
        <div class="stat">
          <div class="label">不带 token 的手机地址</div>
          ${renderValueList(payload.lanUrls, '没有找到局域网地址。')}
        </div>
        <div class="stat">
          <div class="label">局域网 IP</div>
          ${renderValueList(payload.lanIPs, '没有找到局域网 IP。')}
        </div>
      </div>

      <div class="card wide">
        <h2>目标卡</h2>
        <table>
          <thead><tr><th>名称</th><th>ID</th><th>发送模式</th><th>提示</th></tr></thead>
          <tbody>${targetRows || '<tr><td colspan="4" class="muted">还没有配置目标卡。</td></tr>'}</tbody>
        </table>
      </div>

      <div class="card wide">
        <h2>快捷按钮</h2>
        <table>
          <thead><tr><th>名称</th><th>发送内容</th></tr></thead>
          <tbody>${quickButtonRows || '<tr><td colspan="2" class="muted">还没有配置快捷按钮。</td></tr>'}</tbody>
        </table>
      </div>

      <div class="card wide">
        <h2>权限提示</h2>
        <ul>${setupLines || '<li>没有平台专用权限提示。</li>'}</ul>
      </div>

      <div class="card wide">
        <h2>配置</h2>
        <div class="editor">
          <div class="stat">
            <div class="label">应用名称</div>
            <input id="appNameInput" maxlength="80">
          </div>
          <div>
            <div class="editor-title">
              <div>
                <div class="label">目标卡</div>
                <div class="muted">保存后会立即推送到已连接的手机页面。</div>
              </div>
              <button id="addTargetButton" type="button">添加目标</button>
            </div>
            <div class="editor-row target-row field-labels">
              <div>名称</div><div>ID</div><div>首字母</div><div>提示</div><div>发送模式</div><div></div>
            </div>
            <div class="editor-list" id="targetsEditor"></div>
          </div>
          <div>
            <div class="editor-title">
              <div>
                <div class="label">快捷按钮</div>
                <div class="muted">快捷按钮会跟随手机端当前目标的默认发送模式。</div>
              </div>
              <button id="addQuickButton" type="button">添加按钮</button>
            </div>
            <div class="editor-row quick-row field-labels">
              <div>名称</div><div>发送内容</div><div></div>
            </div>
            <div class="editor-list" id="quickEditor"></div>
          </div>
          <div class="editor-actions">
            <button class="primary" id="saveConfigButton" type="button">保存配置</button>
            <button id="exportConfigButton" type="button">导出配置</button>
            <button id="importConfigButton" type="button">导入配置</button>
            <button class="danger" id="resetConfigButton" type="button">恢复默认</button>
            <button id="reloadConfigButton" type="button">重新载入页面</button>
            <input class="hidden-file" id="importConfigInput" type="file" accept="application/json,.json">
            <span class="message" id="configMessage"></span>
          </div>
        </div>
      </div>
    </section>
  </main>
  <script id="configData" type="application/json">${scriptJson({
    appName: payload.appName,
    targets: payload.targets,
    quickButtons: payload.quickButtons,
    defaults: normalizeConfig({
      appName: 'VibeCast Remote',
      targets: defaultTargets(),
      quickButtons: defaultQuickButtons()
    })
  })}</script>
  <script>
    const configState = JSON.parse(document.getElementById('configData').textContent);
    const appNameInput = document.getElementById('appNameInput');
    const targetsEditor = document.getElementById('targetsEditor');
    const quickEditor = document.getElementById('quickEditor');
    const configMessage = document.getElementById('configMessage');
    const importConfigInput = document.getElementById('importConfigInput');

    function setConfigMessage(text, isError) {
      configMessage.textContent = text || '';
      configMessage.classList.toggle('error', Boolean(isError));
    }

    function makeInput(value, placeholder, maxLength) {
      const input = document.createElement('input');
      input.value = value || '';
      input.placeholder = placeholder || '';
      input.maxLength = maxLength || 80;
      return input;
    }

    function makeSendModeSelect(value) {
      const select = document.createElement('select');
      [['type', '仅发送'], ['sendEnter', '发送并回车']].forEach((item) => {
        const option = document.createElement('option');
        option.value = item[0];
        option.textContent = item[1];
        option.selected = item[0] === value;
        select.appendChild(option);
      });
      return select;
    }

    function moveRow(row, direction) {
      if (direction < 0 && row.previousElementSibling) {
        row.parentElement.insertBefore(row, row.previousElementSibling);
      }
      if (direction > 0 && row.nextElementSibling) {
        row.parentElement.insertBefore(row.nextElementSibling, row);
      }
    }

    function makeRowActions(row) {
      const actions = document.createElement('div');
      const up = document.createElement('button');
      const down = document.createElement('button');
      const remove = document.createElement('button');
      actions.className = 'row-actions';
      up.type = 'button';
      up.textContent = '上移';
      up.addEventListener('click', () => moveRow(row, -1));
      down.type = 'button';
      down.textContent = '下移';
      down.addEventListener('click', () => moveRow(row, 1));
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = '删除';
      remove.addEventListener('click', () => row.remove());
      actions.append(up, down, remove);
      return actions;
    }

    function renderTargetRow(target) {
      const row = document.createElement('div');
      row.className = 'editor-row target-row';
      row.appendChild(makeInput(target.label, 'Codex', 40));
      row.appendChild(makeInput(target.id, 'codex', 48));
      row.appendChild(makeInput(target.initial, 'C', 4));
      row.appendChild(makeInput(target.hint, 'Draft for Codex', 80));
      row.appendChild(makeSendModeSelect(target.sendMode || 'type'));
      row.appendChild(makeRowActions(row));
      targetsEditor.appendChild(row);
    }

    function renderQuickRow(button) {
      const row = document.createElement('div');
      row.className = 'editor-row quick-row';
      row.appendChild(makeInput(button.label, 'Continue', 40));
      row.appendChild(makeInput(button.payload, '继续', 500));
      row.appendChild(makeRowActions(row));
      quickEditor.appendChild(row);
    }

    function renderConfig(nextConfig) {
      appNameInput.value = nextConfig.appName || 'VibeCast Remote';
      targetsEditor.innerHTML = '';
      quickEditor.innerHTML = '';
      (nextConfig.targets || []).forEach(renderTargetRow);
      (nextConfig.quickButtons || []).forEach(renderQuickRow);
    }

    function collectConfig() {
      const targets = Array.from(targetsEditor.querySelectorAll('.target-row')).map((row) => {
        const fields = row.querySelectorAll('input, select');
        return {
          label: fields[0].value.trim(),
          id: fields[1].value.trim(),
          initial: fields[2].value.trim(),
          hint: fields[3].value.trim(),
          sendMode: fields[4].value
        };
      }).filter((target) => target.label || target.id);

      const quickButtons = Array.from(quickEditor.querySelectorAll('.quick-row')).map((row) => {
        const fields = row.querySelectorAll('input');
        return {
          label: fields[0].value.trim(),
          payload: fields[1].value
        };
      }).filter((button) => button.payload.trim());

      return {
        appName: appNameInput.value.trim() || 'VibeCast Remote',
        targets,
        quickButtons
      };
    }

    async function saveConfig() {
      setConfigMessage('正在保存...', false);
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: collectConfig() })
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || '保存失败');
        setConfigMessage('已保存，并已推送到已连接的手机。', false);
      } catch (error) {
        setConfigMessage(error.message || '保存失败', true);
      }
    }

    function downloadConfig() {
      const blob = new Blob([JSON.stringify(collectConfig(), null, 2) + '\\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'vibecast-config.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setConfigMessage('配置已导出。', false);
    }

    function importConfigFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        try {
          const parsed = JSON.parse(String(reader.result || '{}'));
          const nextConfig = parsed.config && typeof parsed.config === 'object' ? parsed.config : parsed;
          renderConfig(nextConfig);
          setConfigMessage('配置已导入编辑器，点击保存后生效。', false);
        } catch {
          setConfigMessage('导入失败：JSON 格式不正确。', true);
        }
      });
      reader.readAsText(file);
    }

    function resetConfig() {
      renderConfig(configState.defaults);
      setConfigMessage('已恢复默认到编辑器，点击保存后生效。', false);
    }

    renderConfig(configState);
    document.getElementById('addTargetButton').addEventListener('click', () => renderTargetRow({
      id: '',
      label: '',
      initial: '',
      hint: '',
      sendMode: 'type'
    }));
    document.getElementById('addQuickButton').addEventListener('click', () => renderQuickRow({
      label: '',
      payload: ''
    }));
    document.getElementById('saveConfigButton').addEventListener('click', saveConfig);
    document.getElementById('exportConfigButton').addEventListener('click', downloadConfig);
    document.getElementById('importConfigButton').addEventListener('click', () => importConfigInput.click());
    document.getElementById('resetConfigButton').addEventListener('click', resetConfig);
    importConfigInput.addEventListener('change', () => {
      importConfigFile(importConfigInput.files[0]);
      importConfigInput.value = '';
    });
    document.getElementById('reloadConfigButton').addEventListener('click', () => location.reload());
  </script>
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

function readJsonBody(req, maxBytes = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function handleConfigApi(req, res) {
  if (!isLocalRequest(req)) {
    writeJson(res, 403, { ok: false, error: 'Config API is only available from this computer.' });
    return;
  }

  if (req.method === 'GET') {
    writeJson(res, 200, { ok: true, config });
    return;
  }

  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const nextConfig = body && typeof body.config === 'object' ? body.config : body;
    const savedConfig = saveConfig(nextConfig);
    writeJson(res, 200, { ok: true, config: savedConfig });
  } catch (error) {
    writeJson(res, 400, { ok: false, error: String((error && error.message) || error) });
  }
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
      broadcastStatus();
    }
  } catch {
    if (targetState.appName !== 'Current Focus') {
      targetState = {
        appName: 'Current Focus',
        platform: PLATFORM,
        updatedAt: new Date().toISOString()
      };
      broadcastStatus();
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
    sendJson(ws, { type: 'authOk', method: tokenMatches ? 'token' : 'pin', token: PAIRING_TOKEN });
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
  const sentMeta = {};
  if (typeof msg.clientId === 'string' && msg.clientId) {
    sentMeta.clientId = msg.clientId;
  }

  switch (msg.type) {
    case 'type':
      if (typeof msg.text === 'string') await platformAdapter.injectText(msg.text);
      sendJson(ws, { type: 'sent', mode: 'type', targetId: msg.targetId || 'current', ...sentMeta });
      break;
    case 'sendEnter':
      if (typeof msg.text === 'string') await injectTextAndEnter(msg.text);
      else await platformAdapter.pressNamedKey('Enter');
      sendJson(ws, { type: 'sent', mode: 'sendEnter', targetId: msg.targetId || 'current', ...sentMeta });
      break;
    case 'key':
      await platformAdapter.pressNamedKey(String(msg.key || ''));
      sendJson(ws, { type: 'sent', mode: 'key', key: msg.key, ...sentMeta });
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

  if (url.pathname === '/api/config') {
    handleConfigApi(req, res).catch((error) => {
      writeJson(res, 500, { ok: false, error: String((error && error.message) || error) });
    });
    return;
  }

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
      res.end('本机面板只允许从这台电脑访问。');
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
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }
  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);

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

const wss = new WebSocketServer({
  server,
  verifyClient(info, done) {
    done(isAllowedWebSocketOrigin(info.req), 403, 'Forbidden');
  }
});

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
      const errorPayload = {
        type: 'error',
        message: String((error && error.message) || error)
      };
      if (msg && typeof msg.clientId === 'string' && msg.clientId) {
        errorPayload.clientId = msg.clientId;
      }
      sendJson(ws, {
        ...errorPayload
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
  process.exit(1);
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
