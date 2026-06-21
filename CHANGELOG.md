# Changelog

## Unreleased

### Fixed

- Replaced the mobile composer viewport-based height with a fixed height to reduce iOS Safari layout jumps when third-party voice keyboards open.
- Disabled iOS standalone home-screen mode to avoid black screens when third-party voice keyboards switch into voice input.

## 0.6.0 - 2026-06-21

### Added

- Added a local-only `/desktop` diagnostics dashboard with the current PIN, token URLs, LAN URLs, version, frontmost app, targets, quick buttons, and setup reminders.
- Added Hermes, Claude Code, and Obsidian as default target cards.

### Security

- Kept pairing secrets out of `/health`; PIN and token details are only shown on the local-only desktop dashboard.

## 0.5.0 - 2026-06-21

### Added

- Added configurable target cards for the phone UI.
- Added per-target phone drafts stored in browser localStorage.
- Added `targetId` to text and Send + Enter messages as groundwork for future target-aware routing.
- Added per-target default send modes so targets such as Codex can default to Send + Enter.

### Notes

- Target cards are currently a phone-side workflow feature. Text injection still uses the computer's currently focused input field.
- Quick buttons now follow the active target's default send mode.

## 0.4.0 - 2026-06-20

### Added

- Added a web app manifest and SVG icon for add-to-home-screen support.
- Added mobile web app meta tags for a more app-like phone experience.

### Changed

- Token auto-pairing now shows a clearer pairing status while connecting.

## 0.3.0 - 2026-06-20

### Added

- Added token URLs for automatic phone pairing without typing the PIN.
- The phone page now stores pairing tokens in localStorage and removes the token from the address bar after first load.

### Changed

- PIN pairing is now a manual fallback instead of the primary same-Wi-Fi flow.

## 0.2.0 - 2026-06-20

### Added

- Added cross-platform input adapters under `platform/`.
- Added Windows clipboard injection using PowerShell plus simulated `Ctrl+V`.
- Added Windows frontmost-window title detection.
- Added `start.bat` for Windows users.
- Updated English and Chinese documentation for macOS and Windows setup.

### Changed

- Moved macOS-specific clipboard, paste, keypress, and frontmost-app logic out of `server.js`.
- Updated `/health` to report a human-readable platform label.

### Notes

- macOS startup, health, and WebSocket pairing were verified locally.
- Windows support is implemented at the code level and still needs validation on a real Windows machine.
