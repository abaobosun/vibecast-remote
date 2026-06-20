# VibeCast Remote

VibeCast Remote lets a phone browser send dictated or typed text into the currently focused macOS input field over your local Wi-Fi.

The phone side is just a web page. Tap the text area, use the microphone in your iOS or Android keyboard/input method, then send the recognized text to the Mac.

## Setup

```bash
npm install
npm start
```

The server prints a four-digit PIN and one or more LAN URLs. Open one of those URLs on a phone connected to the same Wi-Fi, enter the PIN, and use the input panel.

## macOS Permission

macOS blocks simulated keyboard input until you grant Accessibility access:

System Settings -> Privacy & Security -> Accessibility

Enable the terminal app, editor, or `node` process that runs this server. Restart `npm start` after changing the permission if injection still fails.

## Behavior

- `Send` injects text into the current focused field.
- `Send + Enter` injects text, waits briefly, then presses Enter.
- Chinese, emoji, and mixed Unicode text use `pbcopy` plus simulated `Cmd+V`.
- The previous clipboard value is restored on a best-effort delay.
- The displayed target is the current frontmost app when macOS allows AppleScript to read it.

## Security

This is for trusted local networks. The pairing PIN changes on every launch and is not stored. Do not expose the port to the public internet.

## Configuration

- `PORT=9000 npm start` changes the port.
- `config.json` controls the app label and quick buttons.

## Reference

This project is inspired by the MIT-licensed `phone-web-remote` project:

https://github.com/hello-claude/phone-web-remote

The architecture follows the same practical pattern: a local HTTP/WebSocket server, phone-browser UI, PIN pairing, and macOS text injection through the clipboard plus simulated paste.
