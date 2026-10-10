import { defineConfig } from '@playwright/test';

/*
 * Every run starts its own dev server on a dedicated port (E2E_PORT, default 5190), never reusing one: a second run
 * would otherwise attach to (and on exit shut down) the first run's server. HMR is off (NOHMR, see vite.config.ts)
 * so edits made elsewhere while the suite runs cannot reload the page under a test.
 */
const PORT = Number(process.env.E2E_PORT ?? 5190);
const URL = `http://127.0.0.1:${PORT}/`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  // a beamline can take several seconds to build on a loaded machine
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: URL,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-angle=gl-egl', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `node_modules/.bin/vite --port ${PORT} --strictPort --host 127.0.0.1`,
    env: { NOHMR: '1' },
    url: URL,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
