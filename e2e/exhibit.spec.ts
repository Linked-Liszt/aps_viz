import { test, expect, type Page } from '@playwright/test';

const FEATURES = ['polar', 'xpcs', 'cssi', 'isn', 'hexm', 'chex', 'ptychoprobe', '3dmn', 'atomic'];

/** Page errors and console errors seen by this page (each test gets its own page). */
function track(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Load the app in test mode (instant camera flights, no intro) at a hash and wait until it renders. */
async function open(page: Page, hash = '#/'): Promise<string[]> {
  const errors = track(page);
  await page.goto(`/?test${hash}`);
  await page.waitForFunction(() => (window as any).__app?.frameCount > 5, null, { timeout: 60_000 });
  return errors;
}

/** Wait until a beamline model is built and showing (CHEX and ISN can take several seconds on a loaded machine). */
async function beamlineReady(page: Page, id: string): Promise<void> {
  await page.waitForFunction((bid) => (window as any).__app?.bl?.data?.id === bid, id, { timeout: 60_000 });
}

/** Screen position of a sector's floor strip (projected from the 3D scene). */
async function sectorScreenPos(page: Page, n: number) {
  return page.evaluate((sector) => {
    const a = (window as any).__app;
    const strip = a.site.sectorStrips.get(sector);
    strip.geometry.computeBoundingSphere();
    const c = strip.geometry.boundingSphere.center.clone();
    strip.localToWorld(c);
    const v = c.project(a.stage.camera);
    const r = a.stage.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }, n);
}

/** Camera position and orbit target are real numbers. */
async function cameraFinite(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const st = (window as any).__app.stage;
    const p = st.camera.position;
    const vals = [p.x, p.y, p.z, ...st.camera.projectionMatrix.elements];
    const t = st.controls?.getTarget?.(st.camera.position.clone());
    if (t) vals.push(t.x, t.y, t.z);
    return vals.every(Number.isFinite);
  });
}

/** Visible vs total component pins of the beamline that is showing, and how many visible ones are not headline pins. */
async function pinCounts(page: Page): Promise<{ visible: number; total: number; nonHeadline: number }> {
  return page.evaluate(() => {
    const bl = (window as any).__app.bl;
    const placed = bl.placed as { pin: { visible: boolean; element: HTMLElement } }[];
    const info = (bl.pinInfo ?? []) as { headline: boolean }[];
    const shown = placed.map((p, i) => [p, i] as const).filter(([p]) => p.pin.visible && !(p.pin.element.firstElementChild as HTMLElement).classList.contains('is-hidden'));
    return { visible: shown.length, total: placed.length, nonHeadline: shown.filter(([, i]) => !info[i]?.headline).length };
  });
}

/**
 * How the station in the open dialog fails to fit it, if it does: the dialog (or its scrolling content or story stage)
 * scrolls, or the station is taller than its host. Empty when it fits.
 */
async function stationMisfit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const box = document.querySelector('.modal.is-open .modal-box') as HTMLElement | null;
    const host = box?.querySelector('.station-host') as HTMLElement | null;
    const stn = host?.querySelector('.stn') as HTMLElement | null;
    if (!box || !host || !stn) return ['no station in an open dialog'];
    const out: string[] = [];
    for (const el of [box, ...box.querySelectorAll<HTMLElement>('.modal-content, .story-stage')]) {
      if (el.scrollHeight > el.clientHeight + 1) out.push(`.${el.classList[0]} scrolls: ${el.scrollHeight} > ${el.clientHeight} px`);
    }
    const sh = stn.getBoundingClientRect().height;
    const hh = host.getBoundingClientRect().height;
    if (sh > hh + 1) out.push(`station ${Math.round(sh)} px taller than its host ${Math.round(hh)} px`);
    return out;
  });
}

/** Camera aspect vs the canvas's on-screen aspect. */
async function aspects(page: Page): Promise<{ camera: number; canvas: number }> {
  return page.evaluate(() => {
    const st = (window as any).__app.stage;
    const el = st.renderer.domElement as HTMLCanvasElement;
    return { camera: st.camera.aspect, canvas: el.clientWidth / el.clientHeight };
  });
}

// ------------------------------------------------------------------ overview and navigation

test('overview renders and the 3D canvas receives pointer input', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#stage canvas')).toBeVisible();
  await expect(page.locator('.ov-panel')).toBeVisible();
  await expect(page.locator('.feature-card')).toHaveCount(9);
  // regression: hidden overlays must not swallow pointer events
  const p = await sectorScreenPos(page, 15);
  await page.mouse.move(p.x - 4, p.y - 4);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await expect(page.locator('.hovercard')).toHaveClass(/is-on/);
  await expect(page.locator('.hovercard h4')).toContainText('Sector 15');
  expect(errors).toEqual([]);
});

test('clicking a non-feature sector opens the sector card', async ({ page }) => {
  const errors = await open(page);
  const p = await sectorScreenPos(page, 12);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.sector-card')).toHaveClass(/is-open/);
  await expect(page).toHaveURL(/#\/sector\/12$/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sector-card')).not.toHaveClass(/is-open/);
  expect(errors).toEqual([]);
});

test('enter a feature beamline, walk components, and step back', async ({ page }) => {
  const errors = await open(page);
  await page.locator('.feature-card').filter({ hasText: '3DMN' }).click();
  await expect(page).toHaveURL(/#\/beamline\/3dmn$/);
  await beamlineReady(page, '3dmn');
  await expect(page.locator('.bl-panel')).toHaveClass(/is-open/);
  await expect(page.locator('.bl-title')).toHaveText('3DMN');
  await expect(page.locator('.strip')).toHaveClass(/is-open/);
  await page.locator('.strip-stop').nth(0).click();
  await expect(page).toHaveURL(/#\/beamline\/3dmn\/.+/);
  await expect(page.locator('.comp-card')).toBeVisible();
  await page.keyboard.press(']');
  await expect(page.locator('.comp-card .mono.small')).toContainText('2 /');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/beamline\/3dmn$/);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.bl-panel')).not.toHaveClass(/is-open/);
  expect(errors).toEqual([]);
});

test('every panel tab renders and depth switches the text', async ({ page }) => {
  const errors = await open(page, '#/beamline/3dmn');
  await beamlineReady(page, '3dmn');
  const tabs = page.locator('.bl-panel .tab');
  await expect(tabs).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await tabs.nth(i).click();
    await expect(page.locator('.panel-body')).not.toBeEmpty();
  }
  await tabs.nth(0).click();
  const visitor = await page.locator('.panel-body p').nth(1).innerText();
  // the top-bar switch (the phone menu and dialogs carry their own copies)
  const specialist = page.locator('.topbar-tools [data-depth=specialist]').first();
  await specialist.click();
  await expect(specialist).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.panel-body p').nth(1)).not.toHaveText(visitor);
  expect(errors).toEqual([]);
});

test('guided tour advances and exits', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Take the guided tour' }).click();
  await expect(page).toHaveURL(/#\/tour\/0/);
  await expect(page.locator('.tour')).toHaveClass(/is-open/);
  await page.locator('.tour').getByRole('button', { name: /Next/ }).click();
  await expect(page).toHaveURL(/#\/tour\/1/);
  await page.locator('.tour').getByRole('button', { name: /Exit tour/ }).click();
  await expect(page).toHaveURL(/#\/$/);
  expect(errors).toEqual([]);
});

test('a tour stop at a beamline declutters its pins', async ({ page }) => {
  const errors = await open(page, '#/tour/6');
  await expect(page.locator('.tour')).toHaveClass(/is-open/);
  await page.waitForFunction(() => !!(window as any).__app?.bl && location.hash === '#/tour/6', null, { timeout: 60_000 });
  await expect.poll(async () => (await pinCounts(page)).total).toBeGreaterThan(10);
  await expect
    .poll(async () => {
      const c = await pinCounts(page);
      return c.visible > 0 && c.visible < c.total;
    })
    .toBe(true);
  // the tour has no component list beside the model: only headline pins (BeamlineScene.setPinMode('tour'))
  await expect.poll(async () => (await pinCounts(page)).nonHeadline).toBe(0);
  expect(errors).toEqual([]);
});

test('the upgrade story modal opens, and the canvas works after closing it', async ({ page }) => {
  const errors = await open(page);
  await page.locator('.topbar-tools').getByRole('button', { name: /The upgrade/ }).click();
  await expect(page.locator('.modal')).toHaveClass(/is-open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).not.toHaveClass(/is-open/);
  const p = await sectorScreenPos(page, 15);
  await page.mouse.move(p.x - 3, p.y - 3);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await expect(page.locator('.hovercard')).toHaveClass(/is-on/);
  expect(errors).toEqual([]);
});

test('the story stations fit the dialog at 1440×900', async ({ page }) => {
  const errors = await open(page);
  await page.locator('.topbar-tools').getByRole('button', { name: /The upgrade/ }).click();
  await expect(page.locator('.modal')).toHaveClass(/is-open/);
  for (const name of ['A new kind of ring', 'Brightness', 'Undulators', 'Coherence']) {
    await page.locator('.modal.is-open .story-tabs [role=tab]', { hasText: name }).click();
    await expect(page.locator('.modal.is-open .story-stage .station-host .stn')).toBeVisible({ timeout: 30_000 });
    await expect.configure({ soft: true }).poll(() => stationMisfit(page), { timeout: 5_000, message: `${name} fits 1440×900` }).toEqual([]);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).not.toHaveClass(/is-open/);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------------ keyboard and dialogs

test('keys still work after search is opened and closed: / then Escape then 2 opens XPCS', async ({ page }) => {
  const errors = await open(page);
  await page.keyboard.press('/');
  await expect.poll(() => page.evaluate(() => (window as any).__app.search.isOpen)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__app.search.isOpen)).toBe(false);
  await page.keyboard.press('2');
  await expect(page).toHaveURL(/#\/beamline\/xpcs$/);
  await beamlineReady(page, 'xpcs');
  await expect(page.locator('.bl-title')).toHaveText('XPCS');
  expect(errors).toEqual([]);
});

test('Escape closes Help after a click on its text', async ({ page }) => {
  const errors = await open(page);
  await page.locator('.topbar-tools').getByRole('button', { name: /Help/ }).click();
  const modal = page.locator('.modal');
  await expect(modal).toHaveClass(/is-open/);
  // a click on plain text moves focus out of the dialog's controls (to the body in some browsers)
  await page.locator('.modal.is-open .modal-content p').first().click();
  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/is-open/);
  // and the page keeps its keys
  await page.keyboard.press('?');
  await expect(modal).toHaveClass(/is-open/);
  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/is-open/);
  expect(errors).toEqual([]);
});

test('a focused station canvas keeps its keys: ] on the 3DMN station does not walk the beamline', async ({ page }) => {
  const errors = await open(page, '#/beamline/3dmn');
  await beamlineReady(page, '3dmn');
  await page.locator('.bl-panel .tab', { hasText: 'How it works' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLCanvasElement>('.bl-panel .station-host canvas')].some((c) => c.tabIndex >= 0), null, {
    timeout: 30_000,
  });
  await page.evaluate(() => {
    const c = [...document.querySelectorAll<HTMLCanvasElement>('.bl-panel .station-host canvas')].find((x) => x.tabIndex >= 0)!;
    (window as any).__probeCanvas = c;
    c.focus();
  });
  expect(await page.evaluate(() => document.activeElement === (window as any).__probeCanvas)).toBe(true);
  const before = await page.evaluate(() => location.hash);
  await page.keyboard.press(']');
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => location.hash)).toBe(before);
  expect(await page.evaluate(() => ((window as any).__probeCanvas as HTMLElement).isConnected)).toBe(true);
  await expect(page.locator('.bl-panel .tab[aria-selected=true]')).toHaveText(/How it works/);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------------ deep links and robustness

/**
 * A real page load at `hash`. (page.goto to a URL that differs only in its #fragment is a same-document navigation:
 * no reload, only a hashchange. A distinct query parameter forces startup to run again.)
 */
let loads = 0;
async function load(page: Page, hash: string): Promise<void> {
  if (page.url().startsWith('http')) await page.evaluate(() => ((window as any).__stale = true));
  await page.goto(`/?test&load=${++loads}${hash}`);
  await page.waitForFunction(() => (window as any).__app?.frameCount > 5, null, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__stale), `${hash} is a fresh page load`).toBeUndefined();
}

/** The tour card shows its last stop and the address names it. */
async function expectLastTourStop(page: Page, what: string): Promise<void> {
  await expect(page.locator('.tour'), what).toHaveClass(/is-open/);
  await expect
    .poll(async () => {
      const [i, n] = (await page.locator('.tour-count').innerText()).split('/').map((s) => Number(s.trim()));
      return i > 1 && i === n && new RegExp(`#/tour/${n - 1}$`).test(page.url());
    }, { message: `${what}: clamped to the last stop` })
    .toBe(true);
}

const NOWHERE: [string, RegExp][] = [
  ['#/sector/abc', /#\/$/],
  ['#/sector/0', /#\/$/],
  ['#/sector/99', /#\/$/],
  ['#/sector/%E2%9C', /#\/$/],
  ['#/beamline/nope', /#\/$/],
  ['#/tour/99', /#\/tour\/\d+$/],
];

test('deep links that name no real place fall back cleanly at startup', async ({ page }) => {
  const errors = track(page);
  for (const [hash, want] of NOWHERE) {
    await load(page, hash);
    await expect(page, hash).toHaveURL(want);
    await expect(page.locator('.sector-card'), hash).not.toHaveClass(/is-open/);
    expect(await cameraFinite(page), hash).toBe(true);
    if (hash.startsWith('#/tour/')) await expectLastTourStop(page, hash);
  }
  expect(errors).toEqual([]);
});

test('typing a link that names no real place into a running app falls back cleanly', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => ((window as any).__sameDocument = true));
  for (const [hash, want] of NOWHERE) {
    await page.evaluate((h) => (location.hash = h), hash);
    await expect(page, hash).toHaveURL(want);
    await expect(page.locator('.sector-card'), hash).not.toHaveClass(/is-open/);
    expect(await cameraFinite(page), hash).toBe(true);
    if (hash.startsWith('#/tour/')) {
      await expectLastTourStop(page, hash);
      await page.evaluate(() => (location.hash = '#/'));
      await expect(page).toHaveURL(/#\/$/);
    }
  }
  expect(await page.evaluate(() => (window as any).__sameDocument), 'no reload happened').toBe(true);
  expect(errors).toEqual([]);
});

test('a malformed %-escape in the hash does not break startup', async ({ page }) => {
  const errors = track(page);
  await load(page, '#/beamline/xpcs/%E2%9C');
  await beamlineReady(page, 'xpcs');
  await expect(page.locator('.bl-title')).toHaveText('XPCS');
  // the undecodable component names no part: the address falls back to the beamline itself
  await expect(page).toHaveURL(/#\/beamline\/xpcs$/);
  expect(await cameraFinite(page)).toBe(true);
  for (const hash of ['#/sector/%E2%9C', '#/tour/%E2', '#/%E2%9C/%']) {
    await load(page, hash);
    await expect(page, hash).toHaveURL(hash.startsWith('#/tour/') ? /#\/tour\/0$/ : /#\/$/);
    expect(await cameraFinite(page), hash).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('#/sector/abc then entering XPCS leaves the camera finite', async ({ page }) => {
  const errors = await open(page, '#/sector/abc');
  await expect(page).toHaveURL(/#\/$/);
  expect(await cameraFinite(page)).toBe(true);
  await page.locator('.feature-card').filter({ hasText: 'XPCS' }).click();
  await expect(page).toHaveURL(/#\/beamline\/xpcs$/);
  await beamlineReady(page, 'xpcs');
  await page.waitForTimeout(500);
  expect(await cameraFinite(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('resizing the window keeps the camera aspect equal to the canvas aspect', async ({ page }) => {
  const errors = await open(page);
  const close = (a: { camera: number; canvas: number }) => Math.abs(a.camera - a.canvas) < 0.01;
  expect(close(await aspects(page))).toBe(true);
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect.poll(async () => close(await aspects(page))).toBe(true);
  expect((await aspects(page)).canvas).toBeGreaterThan(1.9); // the new size really applied
  // with the side panel open the view is offset: same rule
  await page.locator('.feature-card').filter({ hasText: 'XPCS' }).click();
  await beamlineReady(page, 'xpcs');
  await page.setViewportSize({ width: 1200, height: 860 });
  await expect.poll(async () => close(await aspects(page))).toBe(true);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------------ every feature beamline

for (const id of FEATURES) {
  test(`beamline route ${id} loads, its station runs inline and full screen, without errors`, async ({ page }) => {
    const errors = await open(page, `#/beamline/${id}`);
    await beamlineReady(page, id);
    await expect(page.locator('.bl-title')).toBeVisible();

    // three.js renders the whole scene twice per frame once any visible material is transmissive
    const transmissive = await page.evaluate(() => {
      const bad: string[] = [];
      (window as any).__app.stage.scene.traverse((o: any) => {
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) if (m.transmission > 0) bad.push(`${o.name || o.type} (${m.name || m.type})`);
      });
      return bad;
    });
    expect(transmissive).toEqual([]);

    await page.locator('.bl-panel .tab', { hasText: 'How it works' }).click();
    await expect(page.locator('.bl-panel .station-host')).toBeVisible();
    await expect(page.locator('.bl-panel .station-host .stn')).toBeVisible({ timeout: 30_000 });

    // Full screen at 1440×900: the station fits the dialog (no scrolling dialog, no station taller than its host)
    await page.locator('.bl-panel .station-expand').click();
    const modal = page.locator('.modal');
    await expect(modal).toHaveClass(/is-open/);
    await expect(page.locator('.modal.is-open .station-host .stn')).toBeVisible({ timeout: 30_000 });
    // soft: a station that does not fit is reported, and the rest of the route is still checked
    await expect.configure({ soft: true }).poll(() => stationMisfit(page), { timeout: 5_000, message: `${id} full screen fits 1440×900` }).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(modal).not.toHaveClass(/is-open/);
    await expect(page).toHaveURL(new RegExp(`#/beamline/${id}$`));

    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });
}
