import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    allowedHosts: 'all', // Allow any external tunnel (Cloudflare, ngrok, etc.)
  }
});
