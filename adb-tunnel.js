const { execSync } = require('child_process');
console.log('Starting ADB persistent reverse tunnel...');
setInterval(() => {
  try {
    execSync('adb reverse tcp:8081 tcp:8081', { stdio: 'ignore' });
  } catch (e) {
    // ignore
  }
}, 500);
