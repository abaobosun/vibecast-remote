# VibeCast Remote

[中文说明](README.zh-CN.md)

VibeCast Remote lets a phone browser send dictated or typed text into the currently focused macOS or Windows input field over your local Wi-Fi.

The phone side is just a web page. Tap the text area, use the microphone in your iOS or Android keyboard/input method, then send the recognized text to the Mac.

## Setup

```bash
npm install
npm start
```

On macOS, you can also double-click `start.command`. On Windows, double-click `start.bat`.

The server prints one or more same-Wi-Fi URLs with a `token` query parameter. Open a token URL on your phone and pairing happens automatically. A four-digit PIN is still printed as a manual fallback.

Open `http://127.0.0.1:8765/desktop` on the computer to see the current PIN, token URLs, LAN URLs, version, target config, and permission reminders. This desktop dashboard also edits target cards and quick buttons. It is local-only; LAN devices cannot open it.

On iPhone, keep VibeCast Remote in a normal Safari or Edge tab, or save it as a browser bookmark. iOS home-screen web apps can black-screen when some third-party voice keyboards open. On Android Chrome, adding to the home screen is still fine when the keyboard behaves normally.

## Platform Setup

macOS blocks simulated keyboard input until you grant Accessibility access:

System Settings -> Privacy & Security -> Accessibility

Enable the terminal app, editor, or `node` process that runs this server. Restart `npm start` after changing the permission if injection still fails.

On Windows, allow Node.js through Windows Defender Firewall if prompted. If injecting into an elevated app fails, run this server as Administrator too.

## Behavior

- The phone UI can keep separate drafts for configurable target cards such as Current Focus, Codex, Notion, Hermes, Claude Code, and Obsidian.
- Target cards are a phone-side workflow aid in this version. Injection still goes to whichever input field is focused on the computer.
- Each target can set a default send action. For example, Codex and Claude Code can default to `Send + Enter`, while Notion defaults to plain `Send`.
- `Send` injects text into the current focused field.
- `Send + Enter` injects text, waits briefly, then presses Enter.
- Quick buttons follow the active target's default send action.
- Chinese, emoji, and mixed Unicode text use the system clipboard plus simulated paste.
- The previous clipboard value is restored on a best-effort delay.
- macOS uses `pbcopy` / `pbpaste` plus `Cmd+V`.
- Windows uses PowerShell clipboard commands plus `Ctrl+V`.
- The displayed target is the current frontmost app or window when the platform allows it.

## Security

This is for trusted local networks. The pairing PIN changes on every launch and is not stored. Do not expose the port to the public internet.

Token URLs are local control links. The phone stores the token in browser localStorage and removes it from the address bar after first load. Restarting the server generates a new token.

The `/desktop` dashboard shows the current PIN and token URL only to requests from this computer. The LAN-safe `/health` endpoint does not include pairing secrets.

The phone page intentionally avoids iOS standalone home-screen mode because that mode can conflict with third-party voice input keyboards.

## Configuration

- `PORT=9000 npm start` changes the port.
- `config.json` controls the app label, target cards, and quick buttons.
- Target cards support `sendMode: "type"` or `sendMode: "sendEnter"`.
- The local-only `/api/config` endpoint powers the desktop dashboard and saves changes back to `config.json`.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Credits

- Product flow, mobile input panel ideas, and UI direction are inspired by `Pls-1q43/VibeCast`:

https://github.com/Pls-1q43/VibeCast

- The local HTTP/WebSocket bridge and clipboard-paste input approach are inspired by the MIT-licensed `phone-web-remote` project:

https://github.com/hello-claude/phone-web-remote

This project keeps the implementation intentionally lightweight and cross-platform: Node.js server, phone-browser UI, local pairing, and system clipboard plus simulated paste for text injection.
