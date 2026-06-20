# Changelog

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
