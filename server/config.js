const os = require('os');
const path = require('path');

const appSupportDir = path.join(os.homedir(), 'Library', 'Application Support', 'DRILL44 AI');
const settingsPath = path.join(appSupportDir, 'settings.json');
const tmpDir = path.join(appSupportDir, 'tmp');

module.exports = {
  appSupportDir,
  settingsPath,
  tmpDir,
  cleanupIntervalMs: 60 * 60 * 1000,
  tmpTtlMs: 24 * 60 * 60 * 1000,
  uploadLimitBytes: 15 * 1024 * 1024
};
