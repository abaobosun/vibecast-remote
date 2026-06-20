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

## Platform Setup

macOS blocks simulated keyboard input until you grant Accessibility access:

System Settings -> Privacy & Security -> Accessibility

Enable the terminal app, editor, or `node` process that runs this server. Restart `npm start` after changing the permission if injection still fails.

On Windows, allow Node.js through Windows Defender Firewall if prompted. If injecting into an elevated app fails, run this server as Administrator too.

## Behavior

- `Send` injects text into the current focused field.
- `Send + Enter` injects text, waits briefly, then presses Enter.
- Chinese, emoji, and mixed Unicode text use the system clipboard plus simulated paste.
- The previous clipboard value is restored on a best-effort delay.
- macOS uses `pbcopy` / `pbpaste` plus `Cmd+V`.
- Windows uses PowerShell clipboard commands plus `Ctrl+V`.
- The displayed target is the current frontmost app or window when the platform allows it.

## Security

This is for trusted local networks. The pairing PIN changes on every launch and is not stored. Do not expose the port to the public internet.

Token URLs are local control links. The phone stores the token in browser localStorage and removes it from the address bar after first load. Restarting the server generates a new token.

## Configuration

- `PORT=9000 npm start` changes the port.
- `config.json` controls the app label and quick buttons.

## Credits

- Product flow, mobile input panel ideas, and UI direction are inspired by `Pls-1q43/VibeCast`:

https://github.com/Pls-1q43/VibeCast

- The local HTTP/WebSocket bridge and clipboard-paste input approach are inspired by the MIT-licensed `phone-web-remote` project:

https://github.com/hello-claude/phone-web-remote

This project keeps the implementation intentionally lightweight and cross-platform: Node.js server, phone-browser UI, local pairing, and system clipboard plus simulated paste for text injection.
