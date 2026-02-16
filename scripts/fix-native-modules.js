// Fix node-pty spawn-helper permissions.
// node-pty v1.1.0 ships prebuilds with spawn-helper missing the execute bit (644).
// This causes "posix_spawnp failed" when node-pty tries to fork processes.
// Fixed upstream in v1.2.0-beta but not yet in stable.

const fs = require('fs');
const path = require('path');
const os = require('os');

if (os.platform() === 'win32') process.exit(0);

const arch = os.arch();
const platform = os.platform();
const helper = path.join(
  __dirname,
  '..',
  'node_modules',
  'node-pty',
  'prebuilds',
  `${platform}-${arch}`,
  'spawn-helper',
);

try {
  fs.chmodSync(helper, 0o755);
  console.log(`[fix-native-modules] Fixed spawn-helper permissions: ${helper}`);
} catch (e) {
  // Not critical during CI or if node-pty isn't installed
  if (e.code !== 'ENOENT') {
    console.warn(`[fix-native-modules] Warning: ${e.message}`);
  }
}
