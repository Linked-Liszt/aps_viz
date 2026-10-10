// Measure fps for a route under different settings (hardware GL). Usage: node scripts/perf.mjs '#/' [w h]
import { chromium } from '@playwright/test';
const [target = '#/', w = '1440', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const base = process.env.BASE ?? 'http://127.0.0.1:5175/';
await page.goto(`${base}?test${target}`, { waitUntil: 'load' });
await page.waitForTimeout(3500);
const measure = async (label, js) => {
  if (js) await page.evaluate(js);
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const a = window.__app; const f0 = a.frameCount; const t0 = performance.now();
    await new Promise((res) => setTimeout(res, 3000));
    return { fps: ((a.frameCount - f0) * 1000) / (performance.now() - t0), calls: a.stage.renderer.info.render.calls, tris: a.stage.renderer.info.render.triangles };
  });
  console.log(label.padEnd(28), r.fps.toFixed(1), 'fps', r.calls, 'calls', r.tris, 'tris');
};
await measure('balanced (default)');
await measure('low', "window.__app.stage.setQuality('low')");
await measure('high', "window.__app.stage.setQuality('high')");
await browser.close();
