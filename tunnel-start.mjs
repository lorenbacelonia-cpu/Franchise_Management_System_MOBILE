import { startTunnel } from 'untun';
import http from 'http';

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(600, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function resolvePort() {
  if (process.argv[2]) return process.argv[2];
  // Check typical Vite ports
  for (const p of [5175, 5174, 5173, 5176, 5177]) {
    if (await checkPort(p)) return String(p);
  }
  return '5175';
}

const port = await resolvePort();
console.log(`Starting Cloudflare tunnel for http://localhost:${port} ...`);

const tunnel = await startTunnel({ url: `http://localhost:${port}` });

if (!tunnel) {
  console.error('Tunnel failed to start.');
  process.exit(1);
}

const url = await tunnel.getURL();
console.log('\n========================================');
console.log('  TUNNEL READY (SECURE HTTPS)!');
console.log('  Open on your mobile phone:');
console.log('  ' + url);
console.log('========================================\n');
console.log('Press Ctrl+C to stop the tunnel.');

// Keep process alive
process.stdin.resume();
