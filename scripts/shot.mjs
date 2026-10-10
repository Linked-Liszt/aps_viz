// Usage: node scripts/shot.mjs <'#/hash' | 'explainer.html?id=x'> <out.png> [waitMs] [w] [h] [evalJs] [timeoutMs]
// BASE env var = dev server root (default: the no-HMR screenshot server http://127.0.0.1:5175/).
// Waits for the app to have rendered frames (and for the beamline scene on #/beamline routes), retries
// navigation if the page reloads mid-capture, and retries blank (uniform) frames.
import { chromium } from '@playwright/test';
const [target = '#/', out = 'shot.png', wait = '2500', w = '1440', h = '900', evalJs = '', tmo = '60000'] = process.argv.slice(2);
const gpuArgs = process.env.SWIFT ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=gl-egl', '--enable-gpu-rasterization'];
const browser = await chromium.launch({ args: [...gpuArgs, '--ignore-gpu-blocklist'] });
const base = process.env.BASE ?? 'http://127.0.0.1:5175/';
const url = target.startsWith('#') ? `${base}?test${target}` : `${base}${target}${target.includes('?') ? '&' : '?'}test`;
const logs = [];
let ok = false;
for (let attempt = 0; attempt < 3 && !ok; attempt++) {
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.setDefaultTimeout(+tmo);
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  try {
    await page.goto(url, { waitUntil: 'load', timeout: +tmo });
    if (target.startsWith('#')) {
      await page.waitForFunction(() => (window.__app?.frameCount ?? 0) > 8, null, { timeout: +tmo });
      if (target.startsWith('#/beamline')) await page.waitForFunction(() => !!window.__app?.bl, null, { timeout: +tmo });
    }
    await page.waitForTimeout(+wait);
    if (evalJs) {
      await page.evaluate(evalJs);
      await page.waitForTimeout(+wait);
    }
    if (target.startsWith('#')) await page.evaluate(() => window.__app?.updateHud?.());
    // blank-frame check on the WebGL canvas (preserveDrawingBuffer is on in ?test mode)
    const varied = await page.evaluate(() => {
      const c = document.querySelector('#stage canvas') ?? document.querySelector('canvas');
      if (!c) return true;
      const t = document.createElement('canvas');
      t.width = 48; t.height = 30;
      const g = t.getContext('2d');
      g.drawImage(c, 0, 0, 48, 30);
      const d = g.getImageData(0, 0, 48, 30).data;
      let mn = 255, mx = 0;
      for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; mn = Math.min(mn, v); mx = Math.max(mx, v); }
      return mx - mn > 24;
    });
    if (!varied && attempt < 2) { logs.push('[shot] blank frame, retrying'); await page.close(); continue; }
    await page.screenshot({ path: out, timeout: +tmo });
    ok = true;
  } catch (e) {
    logs.push(`[shot] attempt ${attempt + 1} failed: ${String(e.message).split('\n')[0]}`);
  }
  await page.close().catch(() => {});
}
console.log(logs.filter((l) => !l.includes('[vite]') && !l.includes('deprecated')).slice(0, 40).join('\n'));
await browser.close();
process.exit(ok ? 0 : 1);
