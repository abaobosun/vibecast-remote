'use strict';

function loadPlatformAdapter() {
  if (process.platform === 'darwin') return require('./macos');
  if (process.platform === 'win32') return require('./windows');
  return require('./unsupported');
}

module.exports = loadPlatformAdapter();
