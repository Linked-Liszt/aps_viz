import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: 'index.html' } },
    // main = three.js + all nine dossiers (~1 MB JSON, bundled so search and the overview work instantly): ~1.8 MB, ~575 kB gzip
    chunkSizeWarningLimit: 2000,
  },
  // NOHMR=1 gives a stable server for screenshots (no full reloads while other files are being edited)
  server: { host: '127.0.0.1', port: 5173, hmr: process.env.NOHMR ? false : undefined },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
