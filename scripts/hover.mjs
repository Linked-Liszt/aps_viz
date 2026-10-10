// Hover test: move the mouse to (x,y) after load and screenshot. Usage: node scripts/hover.mjs '#/' out.png x y
import { chromium } from '@playwright/test';
const [target = '#/', out = 'hover.png', x = '700', y = '450', w = '1440', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const base = process.env.BASE ?? 'http://127.0.0.1:5175/';
await page.goto(`${base}?test${target}`, { waitUntil: 'load' });
await page.waitForTimeout(3000);
await page.mouse.move(+x - 5, +y - 5);
await page.mouse.move(+x, +y, { steps: 4 });
await page.waitForTimeout(1200);
await page.screenshot({ path: out });
console.log(logs.filter((l) => !l.includes('[vite]') && !l.includes('deprecated')).join('\n'));
await browser.close();
