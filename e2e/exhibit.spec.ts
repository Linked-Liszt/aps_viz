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

test('a phone sector card keeps the guide out of its sheet and restores it on close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page);
  const guide = page.locator('.ov-panel');
  await guide.getByRole('button', { name: 'Expand guide' }).click();
  await guide.getByRole('button', { name: 'Collapse guide' }).waitFor();
  await page.evaluate(() => { location.hash = '#/sector/12'; });
  await expect(page.locator('.sector-card')).toHaveClass(/is-open/);
  await expect(guide).toHaveClass(/is-away/);
  expect(await guide.evaluate((el) => (el as HTMLElement).inert)).toBe(true);

  // Resizing to the desktop restores the side-by-side guide; back on a phone, only the sector sheet is active.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(guide).not.toHaveClass(/is-away/);
  expect(await guide.evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(guide).toHaveClass(/is-away/);

  // Responsive visibility changes still respect a dialog's exclusive hold on the background.
  await page.keyboard.press('?');
  await expect(page.locator('.modal')).toHaveClass(/is-open/);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(guide).not.toHaveClass(/is-away/);
  expect(await guide.evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).not.toHaveClass(/is-open/);
  expect(await guide.evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(guide).toHaveClass(/is-away/);
  await page.locator('.sector-card').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(guide).not.toHaveClass(/is-away/);
  expect(await guide.evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  await guide.getByRole('button', { name: 'Collapse guide' }).click();
  await expect(guide.getByRole('button', { name: 'Expand guide' })).toHaveAttribute('aria-expanded', 'false');
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

test('every panel tab renders', async ({ page }) => {
  const errors = await open(page, '#/beamline/3dmn');
  await beamlineReady(page, '3dmn');
  const tabs = page.locator('.bl-panel .tab');
  await expect(tabs).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await tabs.nth(i).click();
    await expect(page.locator('.panel-body')).not.toBeEmpty();
  }
  expect(errors).toEqual([]);
});

/** Controls or words left over from the retired Visitor / Specialist explanation modes, anywhere in the document. */
async function depthLeftovers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const sel of ['[data-depth]', '[data-d]', '.modal-depth', '[aria-label="Explanation depth"]']) {
      const n = document.querySelectorAll(sel).length;
      if (n) out.push(`${n}× ${sel}`);
    }
    for (const b of document.querySelectorAll('button')) if (/^(?:Visitor|Specialist)$/.test(b.textContent?.trim() ?? '')) out.push(`button "${b.textContent}"`);
    const text = document.body.innerText;
    // the mode names (capitalized) and the phrases that went with them
    for (const rx of [/.{0,30}\b(?:Visitor|Specialist)s?\b.{0,30}/, /.{0,30}\b(?:for specialists|explanation depth|(?:visitor|specialist|expert) mode)\b.{0,30}/i]) {
      const m = text.match(rx);
      if (m) out.push(`text: "${m[0]}"`);
    }
    if (localStorage.getItem('apsu.depth') !== null) out.push('localStorage apsu.depth');
    return out;
  });
}

test('one voice: there is no depth switch anywhere, and V does nothing harmful', async ({ page }) => {
  const errors = track(page);
  // a saved preference from an earlier version is ignored and dropped
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('apsu.depth', 'specialist');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/?test#/beamline/3dmn');
  await page.waitForFunction(() => (window as any).__app?.frameCount > 5, null, { timeout: 60_000 });
  await beamlineReady(page, '3dmn');
  expect(await depthLeftovers(page)).toEqual([]);

  // V on the page: same place, same text, no error
  const body = page.locator('.panel-body');
  const before = await body.innerText();
  await page.keyboard.press('v');
  await page.keyboard.press('V');
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/#\/beamline\/3dmn$/);
  expect(await body.innerText()).toBe(before);

  // every panel tab, the help, the phone menu, the story dialog and a full-screen station: nothing left over
  const tabs = page.locator('.bl-panel .tab');
  for (let i = 0; i < 5; i++) {
    await tabs.nth(i).click();
    await expect(body).not.toBeEmpty();
    expect(await depthLeftovers(page), `panel tab ${i}`).toEqual([]);
  }
  await page.keyboard.press('?');
  const modal = page.locator('.modal');
  await expect(modal).toHaveClass(/is-open/);
  await expect(page.locator('.modal.is-open .modal-content')).not.toContainText('Toggle');
  expect(await depthLeftovers(page), 'help').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/is-open/);

  await page.locator('.topbar-tools').getByRole('button', { name: /The upgrade/ }).click();
  await expect(modal).toHaveClass(/is-open/);
  for (const name of ['Primer', 'By the numbers', 'Timeline']) {
    await page.locator('.modal.is-open .story-tabs [role=tab]', { hasText: name }).click();
    await expect(page.locator('.modal.is-open .story-stage')).not.toBeEmpty();
    expect(await depthLeftovers(page), name).toEqual([]);
  }
  // V inside the dialog does nothing; the dialog stays open on the same tab
  await page.keyboard.press('v');
  await expect(modal).toHaveClass(/is-open/);
  await expect(page.locator('.modal.is-open .story-tabs [aria-selected=true]')).toHaveText('Timeline');
  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/is-open/);

  await page.locator('.bl-panel .tab', { hasText: 'How it works' }).click();
  await expect(page.locator('.bl-panel .station-host .stn')).toBeVisible({ timeout: 30_000 });
  await page.locator('.bl-panel .station-expand').click();
  await expect(page.locator('.modal.is-open .station-host .stn')).toBeVisible({ timeout: 30_000 });
  await page.locator('.modal.is-open .modal-title').focus();
  await page.keyboard.press('v');
  await page.waitForTimeout(300);
  await expect(modal).toHaveClass(/is-open/);
  expect(await depthLeftovers(page), 'station dialog').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/is-open/);

  // the phone menu folds the top-bar tools: no explanation switch there either
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.tb-more').click();
  await expect(page.locator('#tb-menu')).toHaveClass(/is-open/);
  await expect(page.locator('#tb-menu')).not.toContainText(/Explanations|Visitor|Specialist/);
  expect(await depthLeftovers(page), 'phone menu').toEqual([]);
  expect(errors).toEqual([]);
});

test('guided tour advances and exits', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'Take the guided tour' }).click();
  await expect(page).toHaveURL(/#\/tour\/0/);
  await expect(page.locator('.tour')).toHaveClass(/is-open/);
  await expect(page.locator('.tour-station')).toHaveCount(0);
  await expect(page.locator('.tour').getByRole('button', { name: /Play tour|Pause tour/ })).toHaveCount(0);
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

for (const [i, id] of FEATURES.entries()) {
  test(`the ${id} tour stop opens its full-screen station and keeps the tour position`, async ({ page }) => {
    const step = i + 4;
    const errors = await open(page, `#/tour/${step}`);
    const tour = page.locator('.tour');
    const launch = tour.getByRole('button', { name: 'Try the interactive station', exact: true });
    await expect(tour.locator('.tour-actions .tour-open')).toBeVisible();
    await expect(launch).toHaveAttribute('aria-haspopup', 'dialog');
    await launch.click();
    const modal = page.locator('.modal');
    await expect(page.locator('.modal.is-open .station-host .stn')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`#/tour/${step}$`));
    await expect(page.locator('.modal.is-open .kicker-bl')).toContainText(id, { ignoreCase: true });
    await page.keyboard.press('Escape');
    await expect(modal).not.toHaveClass(/is-open/);
    await expect(tour).toHaveClass(/is-open/);
    await expect(launch).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`#/tour/${step}$`));
    await tour.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/tour/${step + 1}$`));
    expect(errors).toEqual([]);
  });
}

test('Step inside keeps a Return to tour button across station and component exploration', async ({ page }) => {
  const errors = await open(page, '#/tour/5');
  await beamlineReady(page, 'xpcs');
  await page.locator('.tour-open').click();
  await expect(page).toHaveURL(/#\/beamline\/xpcs$/);
  const back = page.getByRole('button', { name: 'Return to tour', exact: true });
  await expect(back).toBeVisible();
  await page.locator('.bl-panel').getByRole('button', { name: 'Try the interactive station', exact: true }).click();
  await expect(page.locator('.modal.is-open .station-host .stn')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(back).toBeVisible();
  await expect(page).toHaveURL(/#\/beamline\/xpcs$/);
  await page.locator('.bl-panel .tab', { hasText: 'Inside' }).click();
  await page.locator('.stop-btn').first().click();
  await expect(page).toHaveURL(/#\/beamline\/xpcs\/.+/);
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/#\/tour\/5$/);
  await expect(page.locator('.tour-next')).toBeFocused();
  await page.locator('.tour-next').click();
  await expect(page).toHaveURL(/#\/tour\/6$/);
  expect(errors).toEqual([]);
});

test('the tour stop is remembered while changing beamlines and resumes from the toolbar or T', async ({ page }) => {
  const errors = await open(page, '#/tour/8');
  await page.locator('.tour-open').click();
  await expect(page).toHaveURL(/#\/beamline\/hexm$/);
  await page.locator('.bl-title').focus();
  await page.keyboard.press('2');
  await expect(page).toHaveURL(/#\/beamline\/xpcs$/);
  await expect(page.locator('.bl-tour-return')).toHaveAttribute('title', 'Return to guided tour stop 9');
  await page.locator('.topbar-tools').getByRole('button', { name: 'Guided tour', exact: true }).click();
  await expect(page).toHaveURL(/#\/tour\/8$/);
  await page.locator('.tour-open').click();
  await expect(page).toHaveURL(/#\/beamline\/hexm$/);
  await page.locator('.bl-title').focus();
  await page.keyboard.press('t');
  await expect(page).toHaveURL(/#\/tour\/8$/);
  expect(errors).toEqual([]);
});

test('returning to the APS clears the saved tour stop', async ({ page }) => {
  const errors = await open(page, '#/tour/5');
  await page.locator('.tour-open').click();
  await expect(page.locator('.bl-tour-return')).toBeVisible();
  await page.getByRole('button', { name: 'Close beamline and return to the APS', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await page.keyboard.press('2');
  await expect(page).toHaveURL(/#\/beamline\/xpcs$/);
  await expect(page.locator('.bl-tour-return')).toBeHidden();
  await page.locator('.topbar-tools').getByRole('button', { name: 'Guided tour', exact: true }).click();
  await expect(page).toHaveURL(/#\/tour\/0$/);
  expect(errors).toEqual([]);
});

test('changing tour stops or using browser Back closes the current full-screen station', async ({ page }) => {
  const errors = await open(page, '#/tour/5');
  const launch = page.locator('.tour-station');
  await launch.click();
  await expect(page.locator('.modal.is-open .station-host .stn')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => { location.hash = '#/tour/6'; });
  await expect(page.locator('.modal')).not.toHaveClass(/is-open/);
  await expect(page).toHaveURL(/#\/tour\/6$/);
  await launch.click();
  await expect(page.locator('.modal.is-open .station-host .stn')).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(page).toHaveURL(/#\/tour\/5$/);
  await expect(page.locator('.modal')).not.toHaveClass(/is-open/);
  await expect(page.locator('.tour')).toHaveClass(/is-open/);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  for (const id of ['polar', 'xpcs', 'ptychoprobe']) {
    test(`tour station and return controls for ${id} fit a ${viewport.width}px phone`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const step = FEATURES.indexOf(id) + 4;
      const errors = await open(page, `#/tour/${step}`);
      const launch = page.locator('.tour-station');
      await expect(launch).toBeVisible();
      await page.locator('.tour').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
      const card = await page.locator('.tour').boundingBox();
      expect(card!.y).toBeGreaterThanOrEqual(56);
      const github = page.getByRole('link', { name: 'GitHub repository', exact: true });
      await expect(github).toHaveAttribute('href', 'https://github.com/Linked-Liszt/aps_viz');
      const linkBox = await github.boundingBox();
      const brandBox = await page.locator('.brand').boundingBox();
      expect(linkBox!.x).toBeGreaterThan(brandBox!.x + brandBox!.width);
      expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(viewport.width);
      for (const control of [launch, page.locator('.tour-open')]) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      }
      await launch.click();
      await expect(page.locator('.modal.is-open .station-host .stn')).toBeVisible({ timeout: 30_000 });
      await page.locator('.modal-close').click();
      await expect(launch).toBeFocused();
      await page.locator('.tour-open').click();
      const back = page.locator('.bl-tour-return');
      await expect(back).toBeVisible();
      await page.locator('.bl-panel').evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
      const backBox = await back.boundingBox();
      const nameBox = await page.locator('.bl-title').boundingBox();
      expect(Math.abs(backBox!.y + backBox!.height / 2 - nameBox!.y - nameBox!.height / 2)).toBeLessThan(2);
      await back.click();
      await expect(page).toHaveURL(new RegExp(`#/tour/${step}$`));
      await expect(page.locator('.tour-next')).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}

test('the tour keeps the outgoing beamline visible while the next model prepares', async ({ page }) => {
  const errors = await open(page, '#/tour/4');
  await page.waitForFunction(() => (window as any).__app?.bl?.data.id === 'polar' && (window as any).__app.bl.group.visible);
  await page.evaluate(async () => {
    const w = window as any;
    const a = w.__app;
    const { BeamlineScene } = await import('/src/scene/beamline/BeamlineScene.ts' as string);
    const prepare = BeamlineScene.prototype.prepare;
    BeamlineScene.prototype.prepare = function () {
      const ready = prepare.call(this);
      return this.data.id === 'xpcs' ? ready.then(() => new Promise<void>((resolve) => { w.releaseNextModel = resolve; })) : ready;
    };
    w.transitionFrames = [];
    a.stage.onFrame(() => w.transitionFrames.push({ focus: a.site.focusId, outgoing: a.previousBeamline?.group.visible }));
  });
  await page.locator('.tour').getByRole('button', { name: /Next/ }).click();
  await page.waitForFunction(() => !!(window as any).releaseNextModel);
  const heldAt = await page.evaluate(() => (window as any).__app.frameCount);
  await page.waitForFunction((frame) => (window as any).__app.frameCount > frame + 3, heldAt);
  expect(await page.evaluate(() => {
    const a = (window as any).__app;
    return { focus: a.site.focusId, incoming: a.bl.data.id, incomingVisible: a.bl.group.visible, outgoing: a.previousBeamline?.data.id, outgoingVisible: a.previousBeamline?.group.visible };
  })).toEqual({ focus: 'polar', incoming: 'xpcs', incomingVisible: false, outgoing: 'polar', outgoingVisible: true });
  expect(await page.evaluate(() => (window as any).transitionFrames.every((f: { focus: string }) => f.focus === 'polar'))).toBe(true);
  await page.evaluate(() => (window as any).releaseNextModel());
  await page.waitForFunction(() => (window as any).__app.bl.group.visible && (window as any).__app.site.focusId === 'xpcs');
  expect(await page.evaluate(() => (window as any).__app.previousBeamline)).toBeNull();
  expect(errors).toEqual([]);
});

test('recent beamline models are reused and the cache stays bounded', async ({ page }) => {
  const errors = await open(page);
  for (const id of ['polar', 'xpcs']) {
    await page.evaluate((bid) => { location.hash = `#/beamline/${bid}`; }, id);
    await page.waitForFunction((bid) => (window as any).__app.bl?.data.id === bid && (window as any).__app.bl.group.visible, id);
  }
  await page.evaluate(() => { (window as any).savedXpcs = (window as any).__app.bl; location.hash = '#/'; });
  await page.waitForFunction(() => (window as any).__app.applied.mode === 'overview');
  await page.locator('.feature-card').filter({ hasText: 'XPCS' }).click();
  await page.waitForFunction(() => (window as any).__app.bl?.group.visible);
  expect(await page.evaluate(() => (window as any).__app.bl === (window as any).savedXpcs)).toBe(true);
  expect(await page.evaluate(() => {
    const a = (window as any).__app;
    const hidden = a.sceneCache.get('polar');
    return !hidden.group.visible && !a.stage.pickables.some((obj: any) => hidden.pickables.has(obj));
  })).toBe(true);
  await page.evaluate(() => { location.hash = '#/beamline/cssi'; });
  await page.waitForFunction(() => (window as any).__app.bl?.data.id === 'cssi' && (window as any).__app.bl.group.visible);
  expect(await page.evaluate(() => {
    const a = (window as any).__app;
    return { cached: [...a.sceneCache.keys()], evicted: !a.stage.scene.getObjectByName('beamline-polar') };
  })).toEqual({ cached: ['xpcs', 'cssi'], evicted: true });
  await page.evaluate(() => { location.hash = '#/beamline/xpcs'; });
  await page.waitForFunction(() => (window as any).__app.bl?.data.id === 'xpcs' && (window as any).__app.bl.group.visible);
  expect(await page.evaluate(() => {
    const a = (window as any).__app;
    return a.bl === (window as any).savedXpcs && a.stage.pickables.some((o: any) => { for (let p = o; p; p = p.parent) if (p === a.bl.group) return true; return false; });
  })).toBe(true);
  await page.locator('.strip-stop').first().click();
  await expect(page.locator('.comp-card')).toBeVisible();
  expect(errors).toEqual([]);
});

test('leaving during construction cancels the partial model without restoring it later', async ({ page }) => {
  const errors = await open(page);
  await page.locator('.feature-card').filter({ hasText: 'CHEX' }).click();
  await page.waitForFunction(() => (window as any).__app.pendingBuild === 'chex' && !!(window as any).__app.bl);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/$/);
  await page.waitForFunction(() => !(window as any).__app.bl && !(window as any).__app.pendingBuild);
  await page.locator('.feature-card').filter({ hasText: 'ATOMIC' }).click();
  await page.waitForFunction(() => (window as any).__app.bl?.data.id === 'atomic' && (window as any).__app.bl.group.visible);
  expect(await page.evaluate(() => {
    const a = (window as any).__app;
    return { focus: a.site.focusId, partialRemoved: !a.stage.scene.getObjectByName('beamline-chex'), cached: [...a.sceneCache.keys()] };
  })).toEqual({ focus: 'atomic', partialRemoved: true, cached: ['atomic'] });
  expect(errors).toEqual([]);
});

test('rapid tour navigation does not reveal a skipped model', async ({ page }) => {
  const errors = await open(page, '#/tour/4');
  await page.waitForFunction(() => (window as any).__app.bl?.group.visible);
  await page.evaluate(async () => {
    const w = window as any;
    const a = w.__app;
    const { BeamlineScene } = await import('/src/scene/beamline/BeamlineScene.ts' as string);
    const prepare = BeamlineScene.prototype.prepare;
    BeamlineScene.prototype.prepare = function () {
      const ready = prepare.call(this);
      return this.data.id === 'xpcs' ? ready.then(() => new Promise<void>((resolve) => { w.releaseSkippedModel = resolve; })) : ready;
    };
    w.focusChanges = [];
    const focus = a.site.setFocus;
    a.site.setFocus = function (id: string | null, sector: number | null) { w.focusChanges.push(id); return focus.call(this, id, sector); };
  });
  await page.locator('.tour').getByRole('button', { name: /Next/ }).click();
  await page.waitForFunction(() => !!(window as any).releaseSkippedModel);
  await page.evaluate(() => {
    (document.querySelector('.tour-next') as HTMLButtonElement).click();
    (window as any).releaseSkippedModel();
  });
  await page.waitForFunction(() => (window as any).__app.bl?.data.id === 'cssi' && (window as any).__app.bl.group.visible);
  expect(await page.evaluate(() => (window as any).focusChanges)).toEqual(['cssi']);
  expect(await page.evaluate(() => !!(window as any).__app.stage.scene.getObjectByName('beamline-xpcs'))).toBe(false);
  expect(errors).toEqual([]);
});

test('following the X-ray path waits for the complete model', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(async () => {
    const w = window as any;
    const { BeamlineScene } = await import('/src/scene/beamline/BeamlineScene.ts' as string);
    const prepare = BeamlineScene.prototype.prepare;
    BeamlineScene.prototype.prepare = function () {
      return prepare.call(this).then(() => new Promise<void>((resolve) => { w.releasePathModel = resolve; }));
    };
  });
  await page.locator('.feature-card').filter({ hasText: '3DMN' }).click();
  await page.waitForFunction(() => !!(window as any).releasePathModel);
  await page.getByRole('button', { name: 'Follow X-ray path' }).click();
  expect(await page.evaluate(() => {
    const a = (window as any).__app;
    return { requested: a.rideRequested, started: !!a.ride };
  })).toEqual({ requested: true, started: false });
  await page.evaluate(() => (window as any).releasePathModel());
  await page.waitForFunction(() => !!(window as any).__app.ride?.run);
  expect(await page.evaluate(() => (window as any).__app.bl.group.visible)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/$/);
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

test('the phone comparison keeps values whole and supports keyboard scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page);
  const more = page.locator('.tb-more');
  await more.click();
  await page.locator('#tb-menu').getByRole('button', { name: 'The upgrade', exact: true }).click();
  await page.locator('.modal.is-open .story-tabs').getByRole('tab', { name: 'By the numbers', exact: true }).click();
  const comparison = page.locator('.modal.is-open .compare-scroll');
  expect(await comparison.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.locator('.specs.compare td').evaluateAll((cells) => cells.every((el) => {
    const value = document.createRange();
    value.selectNodeContents(el);
    return value.getClientRects().length === 1 && el.scrollWidth <= el.clientWidth + 1;
  }))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await comparison.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => comparison.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.modal.is-open'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).not.toHaveClass(/is-open/);
  await expect(more).toBeFocused();
  expect(errors).toEqual([]);
});

test("the author's welcome link opens the note and the note also opens from the top bar", async ({ page }) => {
  const errors = track(page);
  // test mode skips the welcome unless ?welcome asks for it
  await page.goto('/?test&welcome#/');
  const modal = page.locator('.modal');
  // the welcome opens once the facility has been drawn behind it (the dialog then pauses rendering)
  await expect(modal).toHaveClass(/is-open/, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__app.frameCount)).toBeGreaterThan(2);
  await expect(page.locator('.modal.is-open .author-md')).toBeVisible();
  await expect(modal.locator('.modal-title')).toHaveText('From the author');
  await expect(modal.locator('.author-kicker')).toHaveCount(0);
  await expect(modal.getByRole('button', { name: "Read the author's note" })).toHaveCount(0);
  const noteLink = page.locator('.modal.is-open .author-md a[href="#author-note"]');
  await expect(noteLink).toBeVisible();
  await noteLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: "Author's note", exact: true })).toBeVisible();
  await expect(modal.locator('.modal-title')).toHaveText("Author's note");
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.modal.is-open .author-md pre code')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'From the author', exact: true })).toBeVisible();
  await expect(noteLink).toBeFocused();
  await expect(modal).not.toHaveAttribute('inert', '');
  // Reopen the note and close with its button too. Each return keeps the welcome interactive.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: "Author's note", exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'From the author', exact: true })).toBeVisible();
  await expect(noteLink).toBeFocused();
  await modal.getByRole('button', { name: 'Explore freely', exact: true }).click();
  await expect(modal).not.toHaveClass(/is-open/);
  await expect(page.locator('.intro')).toHaveCount(0);
  await page.locator('.topbar-tools').getByRole('button', { name: "Author's note" }).click();
  await expect(modal).toHaveClass(/is-open/);
  await expect(page.locator('.modal.is-open .author-md')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/is-open/);
  expect(errors).toEqual([]);
});

for (const choice of ['Start the guided tour', 'Explore freely'] as const) {
  test(`a new home visitor chooses ${choice} in the single opening dialog`, async ({ page }) => {
    const errors = track(page);
    await page.goto('/');
    const modal = page.locator('.modal');
    await expect(page.getByRole('dialog', { name: 'From the author', exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.intro')).toHaveCount(0);
    const tour = modal.getByRole('button', { name: 'Start the guided tour', exact: true });
    const explore = modal.getByRole('button', { name: 'Explore freely', exact: true });
    await expect(tour).toBeFocused();
    await explore.focus();
    await page.keyboard.press('Tab');
    await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(explore).toBeFocused();
    await modal.getByRole('button', { name: choice, exact: true }).click();
    await expect(modal).not.toHaveClass(/is-open/);
    await expect(page.locator('.intro')).toHaveCount(0);
    await expect(page.locator('.topbar')).not.toHaveAttribute('inert', '');
    await expect(page.locator('#stage')).not.toHaveAttribute('inert', '');
    expect(await page.evaluate(() => localStorage.getItem('apsu.intro'))).toBe('seen');
    if (choice === 'Start the guided tour') {
      await expect(page).toHaveURL(/#\/tour\/0$/);
      await expect(page.locator('.tour')).toHaveClass(/is-open/);
    } else {
      expect(await page.evaluate(() => (window as any).__app.applied.mode)).toBe('overview');
      await expect(page.locator('.ov-panel')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

for (const hash of ['#/beamline/xpcs', '#/sector/12', '#/tour/3']) {
  test(`a new visitor with a direct link to ${hash} skips the welcome and introduction`, async ({ page }) => {
    const errors = track(page);
    await page.goto(`/${hash}`);
    await page.waitForFunction(() => !!(window as any).__app?.applied, null, { timeout: 60_000 });
    const drawnFrom = await page.evaluate(() => (window as any).__app.frameCount);
    await page.waitForFunction((n) => (window as any).__app.frameCount > n + 5, drawnFrom, { timeout: 60_000 });
    await expect(page.locator('.modal')).not.toHaveClass(/is-open/);
    await expect(page.locator('.intro')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(hash.replaceAll('/', '\\/') + '$'));
    // Going home later in the same visit must not schedule a welcome either.
    await page.locator('.brand').click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('.modal')).not.toHaveClass(/is-open/);
    await expect(page.locator('.intro')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('the story stations fit the dialog at 1440×900', async ({ page }) => {
  const errors = await open(page);
  await page.locator('.topbar-tools').getByRole('button', { name: /The upgrade/ }).click();
  await expect(page.locator('.modal')).toHaveClass(/is-open/);
  for (const name of ['Storage-ring magnets', 'Brightness', 'Undulators', 'Coherence']) {
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

    const launch = page.getByRole('button', { name: 'Try the interactive station', exact: true });
    const modal = page.locator('.modal');
    await launch.click();
    await expect(modal).toHaveClass(/is-open/);
    await expect(page.locator('.modal.is-open .station-host .stn')).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(modal).not.toHaveClass(/is-open/);
    await expect(page.locator('.bl-panel .tab[aria-selected="true"]')).toHaveText('Overview');
    await expect(launch).toBeFocused();

    await page.locator('.bl-panel .tab', { hasText: 'How it works' }).click();
    await expect(page.locator('.bl-panel .station-host')).toBeVisible();
    await expect(page.locator('.bl-panel .station-host .stn')).toBeVisible({ timeout: 30_000 });

    // Full screen at 1440×900: the station fits the dialog (no scrolling dialog, no station taller than its host)
    await page.locator('.bl-panel .station-expand').click();
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
