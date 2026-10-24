import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    allowedHosts: true, // Allow any external tunnel (Cloudflare, ngrok, etc.)
  }
});
