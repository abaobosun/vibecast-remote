'use strict';

function unsupported() {
  return Promise.reject(new Error(`Unsupported platform: ${process.platform}. VibeCast Remote currently supports macOS and Windows.`));
}

module.exports = {
  id: process.platform,
  label: process.platform,
  localMachineLabel: 'computer',
  setupLines: [
    `Unsupported platform: ${process.platform}.`,
    'VibeCast Remote currently supports macOS and Windows.'
  ],
  getFrontmostAppName() {
    return Promise.resolve('Current Focus');
  },
  injectText: unsupported,
  pressNamedKey: unsupported
};
