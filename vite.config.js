import { defineConfig } from 'vite';

export default defineConfig({
  // host: true listens on every network interface, so other devices on the LAN can open
  // http://<this machine's IP>:5173 (Vite only listens on localhost by default)
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 5000 },
});
