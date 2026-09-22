import { startTunnel } from 'untun';

const port = process.argv[2] || '5174';
console.log(`Starting Cloudflare tunnel for http://localhost:${port} ...`);

const tunnel = await startTunnel({ url: `http://localhost:${port}` });

if (!tunnel) {
  console.error('Tunnel failed to start.');
  process.exit(1);
}

const url = await tunnel.getURL();
console.log('\n========================================');
console.log('  TUNNEL READY!');
console.log('  Open on your phone:');
console.log('  ' + url);
console.log('========================================\n');
console.log('Press Ctrl+C to stop the tunnel.');

// Keep process alive
process.stdin.resume();
