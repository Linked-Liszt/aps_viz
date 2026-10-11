/**
 * Part 2 of the "laue" station: differential-aperture X-ray microscopy (DAXM, "wire scan").
 * Side view (Y–Z plane, true scale in µm) of the 45° sample, the focused beam, two diffracting grains at
 * different depths along the beam, and a Pt wire scanned parallel to the surface. The watched detector
 * pixel is 510.9 mm away, so the rays it receives are (almost) parallel at this scale — they are drawn
 * exactly (finite-distance geometry). Physics: ./physics.ts (DAXM section).
 */
import { TOKENS, canvas2d, group, slider, toggle, button, readout, note, plotFrame, line, type Station, type SliderHandle } from '../kit';
import { rng, poisson } from '../../../lib/fft';
import * as P from './physics';
import { haloText, div, fix, roundRect, textWidth, Layer, glowLine } from './common';
import type { PartApi } from './pattern';

const DEG = Math.PI / 180;
const S_MAX = 60; // µm along the beam modelled
/** grains along the beam; `cell` = lower/upper boundary lines [y0, slope, y1, slope] around the beam (drawing only) */
const GRAINS: (P.Grain & { name: string; col: string; fill: string; cell: [number, number, number, number] })[] = [
  { s0: 7, s1: 19, amp: 1, name: 'A', col: '#fbbf24', fill: 'rgba(245,158,11,0.50)', cell: [-24, 0.3, 400, 0] },
  { s0: 27, s1: 40, amp: 1, name: 'B', col: '#f472b6', fill: 'rgba(236,72,153,0.46)', cell: [-17, -0.2, 21, 0.25] },
];
/** grain-boundary lines z = s + c·y crossing the beam at s (non-intersecting inside the view) */
const BOUNDS: [number, number][] = [
  [-30, 0.05],
  [7, 0.1],
  [19, -0.08],
  [27, 0.06],
  [40, -0.1],
  [52, 0.08],
  [66, -0.05],
  [80, 0.07],
];
const STRIP_FILL = ['#1c2736', '#1f2b3c', '#18212e', '#243246', '#1d2a3b', '#22303f', '#1a2533', '#26354a', '#1e2a39'];
/** ILLUSTRATIVE photons/frame on the watched pixel; ×1000 = design pink flux on sample 10¹¹ → 10¹⁴ ph/s (dossier: PDR 2017,
 * Beamline Directory) at the same exposure — the same factor Part 1 quotes. */
const N0 = { aps: 2000, apsu: 2000000 };

export function createDaxm(station: Station, color: string, onCaption: () => void): PartApi {
  const el = div('laue-part');
  const ctl = div('laue-ctl');

  const st = {
    tthDeg: 90,
    wireD: 50,
    flux: 'apsu' as 'aps' | 'apsu',
    step: 1,
    u: 0,
    auto: false,
    played: false,
  };
  let active = false;
  let narrow = false;
  let dirty = true;

  // derived
  let g: P.DaxmGeom = { ...P.DAXM_DEFAULT };
  let grid: P.DepthGrid = P.depthGrid(GRAINS, g, S_MAX);
  let Itot = 1;
  let uA = 0;
  let uB = 1;
  let u0 = 0;
  let nSteps = 0;
  let uGrid = new Float64Array(0);
  let leadGrid = new Float64Array(0);
  let meas = new Uint8Array(0);
  let vals = new Float64Array(0);
  let fineU = new Float64Array(400);
  let fineI = new Float64Array(400);
  let dens = new Float64Array(0); // expected density f/Itot on grid.f samples
  let densMax = 1;
  let seed = 1;
  /** wire positions (relative to u0) where the leading / trailing edge crosses each grain's ends */
  let bands: { la: number; lb: number; ta: number; tb: number }[] = [];
  /** bumps whenever the geometry (and so every cached layer) changes */
  let geoVer = 0;
  /** DOM (slider, readouts) needs syncing — done at drawing rate, not per pointer/animation step */
  let uiDirty = true;

  function rebuild(keepFrac = true): void {
    const frac = keepFrac && uB > uA ? (st.u - uA) / (uB - uA) : 0;
    g = { ...P.DAXM_DEFAULT, tth: st.tthDeg * DEG, R: st.wireD / 2 };
    grid = P.depthGrid(GRAINS, g, S_MAX);
    Itot = P.totalIntensity(grid);
    uA = P.uForLead(-6, g);
    uB = P.uForTrail(S_MAX - 6, g);
    u0 = P.uForLead(0, g);
    nSteps = Math.floor((uB - uA) / st.step) + 1;
    uGrid = new Float64Array(nSteps);
    leadGrid = new Float64Array(nSteps);
    for (let i = 0; i < nSteps; i++) {
      uGrid[i] = uA + i * st.step;
      leadGrid[i] = P.edgeDepths(uGrid[i], g)[1];
    }
    meas = new Uint8Array(nSteps);
    vals = new Float64Array(nSteps);
    fineU = new Float64Array(400);
    fineI = new Float64Array(400);
    for (let k = 0; k < 400; k++) {
      const u = uA + ((uB - uA) * k) / 399;
      fineU[k] = u - u0;
      fineI[k] = P.wireIntensity(u, g, grid) / Itot;
    }
    dens = new Float64Array(grid.f.length);
    densMax = 0;
    for (let i = 0; i < grid.f.length; i++) {
      dens[i] = grid.f[i] / Itot;
      densMax = Math.max(densMax, dens[i]);
    }
    bands = GRAINS.map((gr) => ({
      la: P.uForLead(gr.s0, g) - u0,
      lb: P.uForLead(gr.s1, g) - u0,
      ta: P.uForTrail(gr.s0, g) - u0,
      tb: P.uForTrail(gr.s1, g) - u0,
    }));
    geoVer++;
    st.u = uA + frac * (uB - uA);
    seed++;
    posS.input.min = String(uA - u0);
    posS.input.max = String(uB - u0);
    dirty = true;
    uiDirty = true;
    onCaption();
  }

  function measure(i: number): void {
    if (meas[i]) return;
    const I = P.wireIntensity(uGrid[i], g, grid) / Itot;
    const n0 = N0[st.flux];
    vals[i] = poisson(n0 * I, rng((seed * 7919 + i * 104729) >>> 0)) / n0;
    meas[i] = 1;
  }
  function remeasureAll(): void {
    seed++;
    for (let i = 0; i < nSteps; i++)
      if (meas[i]) {
        meas[i] = 0;
        measure(i);
      }
  }

  /** move the wire to u, measuring every scan step passed on the way */
  function moveTo(u: number): void {
    const nu = Math.max(uA, Math.min(uB, u));
    const a = Math.min(st.u, nu);
    const b = Math.max(st.u, nu);
    const i0 = Math.max(0, Math.ceil((a - uA) / st.step - 1e-9));
    const i1 = Math.min(nSteps - 1, Math.floor((b - uA) / st.step + 1e-9));
    for (let i = i0; i <= i1; i++) measure(i);
    st.u = nu;
    dirty = true;
    uiDirty = true;
    onCaption();
  }

  function clearScan(): void {
    meas.fill(0);
    dirty = true;
  }

  // ---------------------------------------------------------------- canvases
  const side = canvas2d(el, { label: 'Side view · true scale' });
  const scan = canvas2d(el, { label: 'What one detector pixel sees' });
  const depth = canvas2d(el, { label: 'Depth profile rebuilt from the scan' });
  const sideWrap = side.canvas.parentElement!;
  const scanWrap = scan.canvas.parentElement!;
  const depthWrap = depth.canvas.parentElement!;
  for (const c of [side, scan, depth]) c.onResize(() => (dirty = true));

  // ---------------------------------------------------------------- controls
  const gScan = group(ctl, 'Sweep the wire');
  const posS: SliderHandle = slider(gScan, {
    label: 'Wire position H',
    min: -100,
    max: 100,
    step: 0.1,
    value: 0,
    format: (v) => `${fix(v, 1)} µm`,
    onInput: (v) => {
      stopAuto();
      moveTo(v + u0);
    },
  });
  const row = div('laue-row', gScan);
  const autoBtn = button(row, '▶ Auto scan', () => {
    if (st.auto) stopAuto();
    else startAuto();
  });
  button(row, 'Clear', () => {
    stopAuto();
    clearScan();
  });
  const depthR = readout(gScan, 'Front edge aims at', { big: true, color });
  const belowR = readout(gScan, 'Depth below surface');
  const gUp = group(ctl, 'Photons per frame');
  toggle(gUp, {
    options: [
      { value: 'aps', label: 'APS (before)', title: 'Illustrative: 2,000 photons per frame on this pixel' },
      { value: 'apsu', label: 'APS-U (after)', title: 'Illustrative: ~1,000× more photons in the same exposure (design rainbow-beam flux 10¹¹ → 10¹⁴ photons/s)' },
    ],
    value: st.flux,
    onChange: (v) => {
      st.flux = v as 'aps' | 'apsu';
      remeasureAll();
      dirty = true;
      onCaption();
    },
  });
  const gGeo = group(ctl, 'Geometry');
  const tthS = slider(gGeo, {
    label: 'Pixel position (2θ)',
    min: 68,
    max: 112,
    step: 0.5,
    value: st.tthDeg,
    format: (v) => `${v.toFixed(1)}°`,
    onInput: (v) => {
      stopAuto();
      st.tthDeg = v;
      rebuild(true);
    },
  });
  const wireT = toggle(gGeo, {
    label: 'Pt wire diameter',
    options: [
      { value: '50', label: '50 µm' },
      { value: '100', label: '100 µm' },
    ],
    value: '50',
    onChange: (v) => {
      stopAuto();
      st.wireD = Number(v);
      rebuild(true);
    },
  });
  const stepS = slider(gGeo, {
    label: 'Wire step',
    min: 0.5,
    max: 4,
    step: 0.5,
    value: st.step,
    format: (v) => `${v.toFixed(1)} µm`,
    onInput: (v) => {
      stopAuto();
      st.step = v;
      rebuild(true);
    },
  });
  const perStepR = readout(gGeo, 'Beam depth per wire step');
  note(
    ctl,
    station,
    '**What’s next:** 3DMN can swap the wire for a tiny **gold barcode**, a “coded aperture”: 256 bars of ~4.6 µm-thick gold on a thin silicon-nitride membrane. Every run of 8 bars is unique (a de Bruijn code), so ≈120 µm of sweep tells each pixel where its light came from, where a wire scan needs ~600 µm in 1 µm steps: about 5× fewer pictures. Such mask scans are planned to become the 3DMN default once the method matures (Gürsoy et al., 2022).',
  );
  const resetRow = div('laue-row', ctl);
  button(resetRow, '↺ Reset', () => reset());
  // the model's fine print, in smaller type (its numbers follow the geometry)
  const gModel = group(ctl, 'About this model');
  const modelNote = note(gModel, station, '');
  (gModel.lastElementChild as HTMLElement).style.fontSize = '11.5px';
  let modelShown = '';

  function startAuto(): void {
    if (st.u >= uB - 1e-6) {
      clearScan();
      st.u = uA;
    }
    st.auto = true;
    autoBtn.textContent = '❚❚ Pause';
  }
  function stopAuto(): void {
    st.auto = false;
    autoBtn.textContent = '▶ Auto scan';
  }

  function reset(): void {
    stopAuto();
    st.tthDeg = 90;
    tthS.set(90);
    st.wireD = 50;
    wireT.set('50');
    st.step = 1;
    stepS.set(1);
    rebuild(false);
    clearScan();
    startAuto();
  }

  const shown = { pos: NaN, depth: '', below: '', per: '' };
  /** sync slider + readouts with the state; only touches the DOM when a displayed value changes */
  function updateReadouts(): void {
    uiDirty = false;
    const pos = Math.round((st.u - u0) * 10) / 10;
    if (pos !== shown.pos) {
      shown.pos = pos;
      posS.set(st.u - u0);
    }
    const [, sl] = P.edgeDepths(st.u, g);
    const d = sl < 0 ? 'above surface' : `${sl.toFixed(1)} µm`;
    const b = sl < 0 ? '—' : `${(sl * Math.SQRT1_2).toFixed(1)} µm`;
    const r = `${(P.depthPerWireStep(g.tth) * st.step).toFixed(2)} µm`;
    if (d !== shown.depth) depthR.set((shown.depth = d));
    if (b !== shown.below) belowR.set((shown.below = b));
    if (r !== shown.per) perStepR.set((shown.per = r));
  }

  // ---------------------------------------------------------------- captions
  function grainAt(s: number): (typeof GRAINS)[number] | null {
    for (const gr of GRAINS) if (s >= gr.s0 && s <= gr.s1) return gr;
    return null;
  }
  function caption(): string {
    const [st_, sl] = P.edgeDepths(st.u, g);
    const gl = grainAt(sl);
    const gt = grainAt(st_);
    const r = P.depthPerWireStep(g.tth);
    let now = '';
    if (gl) now = ` Right now the wire’s edge is sliding across **grain ${gl.name}**, ${(sl * Math.SQRT1_2).toFixed(1)} µm below the surface: that grain’s light is being cut off, so the pixel dims.`;
    else if (gt) now = ` Now the wire’s *back* edge is uncovering **grain ${gt.name}** again, so the pixel brightens.`;
    else if (sl < 0) now = ' The wire’s shadow hasn’t reached the sample yet.';
    const v = `The beam dives into the metal and **two grains** along its path both send X-rays to the same detector pixel, so the pixel alone can’t tell which came from where. Sweep the **platinum wire** just above the surface: the straight line from the pixel past the wire’s edge points exactly at the depth being blocked, so each ${st.step} µm wire step moves the blocked point ${(r * st.step).toFixed(2)} µm along the beam.${now} Step by step, the drops in the pixel’s signal become the rebuilt **depth profile** (the deeper grain looks dimmer: its X-rays are absorbed on the way in and out).${st.flux === 'aps' ? ' With the old APS’s fewer X-rays the rebuilt profile is grainy: switch to **APS-U** and it sharpens.' : ' Try **APS (before)**: with ~1,000× fewer X-rays per picture the rebuilt profile turns grainy.'}`;
    // fine print: blur terms for the current geometry. Pixel blur: moving the pixel point by p along the detector
    // moves the triangulated depth by ds = p·y_w/(L − y_w) (y_w = wire height above the beam), independent of 2θ
    const [wy] = P.wireYZ(st.u, g.h);
    const blur = (P.GEOM.pitch * 1000 * wy) / (g.L - wy);
    const m = `The watched pixel sits at 2θ = ${st.tthDeg.toFixed(1)}° on the detector 510.9 mm above the sample; the ${st.wireD} µm platinum wire, its axis ${g.h} µm above the 45° surface, moves parallel to it. The wire’s edge is modelled exactly: platinum fades X-rays to 1/e in ≈6.2 µm at 20 keV, which softens the edge to ≈${edgeSoftness().toFixed(1)} µm along the beam (10–90 %). The pixel’s 200 µm size (≈${blur.toFixed(2)} µm of blur here) and the beam’s width are not included. Nickel fades X-rays to 1/e in ≈35 µm at 20 keV, so the deeper grain is dimmer; the profile is not corrected for this. Photon counts are illustrative: ${N0.aps.toLocaleString('en-US')} per picture on this pixel for APS, ×1,000 for APS-U, the design gain in rainbow-beam flux (10¹¹ → 10¹⁴ photons/s) at the same exposure. Method: Larson, Yang, Ice, Budai & Tischler, Nature 415, 887 (2002).`;
    if (m !== modelShown) modelNote.set((modelShown = m));
    return v;
  }

  /** 10–90 % width (µm along the beam) of the wire-edge transmission step for the current geometry */
  function edgeSoftness(): number {
    const u = st.u;
    const [, sl] = P.edgeDepths(u, g);
    let s10 = NaN;
    let s90 = NaN;
    for (let k = 0; k <= 600; k++) {
      const s = sl - 6 + (k / 600) * 7;
      const T = P.wireTransmission(s, u, g);
      if (Number.isNaN(s10) && T > 0.1) s10 = s;
      if (Number.isNaN(s90) && T > 0.9) s90 = s;
    }
    return s90 - s10;
  }

  // ---------------------------------------------------------------- side view (overview + zoom strip)
  interface View {
    sc: number;
    zc: number;
    yc: number;
    cx: number;
    cy: number;
    r: { x: number; y: number; w: number; h: number };
  }
  let vMain: View = { sc: 1, zc: 0, yc: 0, cx: 0, cy: 0, r: { x: 0, y: 0, w: 1, h: 1 } };
  let vZoom: View = { ...vMain };
  const sideBg = new Layer();
  /** world window shown magnified around the beam (µm) */
  const ZOOM = { z0: -9, z1: 54, y0: -15, y1: 21 };

  function fit(r: View['r'], z0: number, z1: number, y0: number, y1: number, padT: number, padB: number, pad: number): View {
    const sc = Math.min((r.w - 2 * pad) / (z1 - z0), (r.h - padT - padB) / (y1 - y0));
    return { sc, zc: (z0 + z1) / 2, yc: (y0 + y1) / 2, cx: r.x + r.w / 2, cy: r.y + padT + (r.h - padT - padB) / 2, r };
  }

  function layoutSide(w: number, h: number): void {
    const hz = Math.round(Math.max(120, Math.min(h * 0.42, w * 0.62)));
    const main = { x: 0, y: 0, w, h: h - hz - 6 };
    const zoom = { x: 6, y: h - hz, w: w - 12, h: hz - 6 };
    const [wyA, wzA] = P.wireYZ(uA, g.h);
    const [wyB, wzB] = P.wireYZ(uB, g.h);
    const yHi = Math.max(wyA, wyB) + g.R + 30;
    const zLo = Math.min(-40, wzA - g.R - 16);
    const zHi = Math.max(S_MAX + 6, wzB + g.R + 16);
    vMain = fit(main, zLo, zHi, -34, yHi, 24, 16, 8);
    vZoom = fit(zoom, ZOOM.z0, ZOOM.z1, ZOOM.y0, ZOOM.y1, 20, 18, 6);
  }

  function drawSide(): void {
    const { ctx, w, h } = side;
    ctx.clearRect(0, 0, w, h);
    if (w < 60 || h < 60) return;
    layoutSide(w, h);
    sideBg.draw(side, `${uA}|${uB}|${g.R}`, (c) => {
      c.save();
      c.beginPath();
      c.rect(vMain.r.x, vMain.r.y, vMain.r.w, vMain.r.h);
      c.clip();
      drawScene(c, vMain, false, true);
      c.restore();
      c.save();
      roundRect(c, vZoom.r.x, vZoom.r.y, vZoom.r.w, vZoom.r.h, 8);
      c.fillStyle = '#070b12';
      c.fill();
      c.clip();
      drawScene(c, vZoom, true, true);
      c.restore();
    });
    // overview
    ctx.save();
    ctx.beginPath();
    ctx.rect(vMain.r.x, vMain.r.y, vMain.r.w, vMain.r.h);
    ctx.clip();
    drawScene(ctx, vMain, false, false);
    ctx.restore();
    // zoom window marker + connectors
    const Xm = (z: number) => vMain.cx + (z - vMain.zc) * vMain.sc;
    const Ym = (y: number) => vMain.cy - (y - vMain.yc) * vMain.sc;
    const zx0 = Xm(ZOOM.z0);
    const zx1 = Xm(ZOOM.z1);
    const zy0 = Ym(ZOOM.y1);
    const zy1 = Ym(ZOOM.y0);
    ctx.save();
    ctx.strokeStyle = 'rgba(233,238,245,0.55)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(zx0, zy0, zx1 - zx0, zy1 - zy0);
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(zx0, zy1);
    ctx.lineTo(vZoom.r.x, vZoom.r.y);
    ctx.moveTo(zx1, zy1);
    ctx.lineTo(vZoom.r.x + vZoom.r.w, vZoom.r.y);
    ctx.stroke();
    ctx.restore();
    // zoom strip
    ctx.save();
    roundRect(ctx, vZoom.r.x, vZoom.r.y, vZoom.r.w, vZoom.r.h, 8);
    ctx.clip();
    drawScene(ctx, vZoom, true, false);
    ctx.restore();
    ctx.save();
    roundRect(ctx, vZoom.r.x, vZoom.r.y, vZoom.r.w, vZoom.r.h, 8);
    ctx.strokeStyle = 'rgba(233,238,245,0.35)';
    ctx.stroke();
    ctx.restore();
    haloText(ctx, `ZOOM ×${Math.round(vZoom.sc / vMain.sc)} ALONG THE BEAM · drag to aim the wire edge`, vZoom.r.x + 8, vZoom.r.y + 14, { size: 10, weight: 600, color: 'rgba(183,195,210,0.8)' });
  }

  function drawSampleBg(ctx: CanvasRenderingContext2D, v: View, X: (z: number) => number, Y: (y: number) => number, zL: number, zR: number, yB: number, yT: number): void {
    const lo = Math.min(zL, yB) - 10;
    const hi = Math.max(zR, yT) + 10;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(X(lo), Y(lo));
    ctx.lineTo(X(hi), Y(hi));
    ctx.lineTo(X(hi), Y(yB - 10));
    ctx.lineTo(X(lo), Y(yB - 10));
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#16202c';
    ctx.fillRect(v.r.x, v.r.y, v.r.w, v.r.h);
    for (let i = 0; i < BOUNDS.length - 1; i++) {
      const [s0, c0] = BOUNDS[i];
      const [s1, c1] = BOUNDS[i + 1];
      const quad = (ya: number, yb: number) => {
        ctx.beginPath();
        ctx.moveTo(X(s0 + c0 * ya), Y(ya));
        ctx.lineTo(X(s0 + c0 * yb), Y(yb));
        ctx.lineTo(X(s1 + c1 * yb), Y(yb));
        ctx.lineTo(X(s1 + c1 * ya), Y(ya));
        ctx.closePath();
      };
      quad(yB - 60, yT + 60);
      ctx.fillStyle = STRIP_FILL[i % STRIP_FILL.length];
      ctx.fill();
      const gr = GRAINS.find((G) => Math.abs(G.s0 - s0) < 1e-6);
      if (gr) {
        const zc = (gr.s0 + gr.s1) / 2;
        const yl = (z: number) => gr.cell[0] + gr.cell[1] * (z - zc);
        const yh = (z: number) => gr.cell[2] + gr.cell[3] * (z - zc);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(X(zc - 300), Y(yl(zc - 300)));
        ctx.lineTo(X(zc + 300), Y(yl(zc + 300)));
        ctx.lineTo(X(zc + 300), Y(yh(zc + 300)));
        ctx.lineTo(X(zc - 300), Y(yh(zc - 300)));
        ctx.closePath();
        ctx.clip();
        quad(yB - 60, yT + 60);
        ctx.fillStyle = gr.fill;
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X(zc - 300), Y(yl(zc - 300)));
        ctx.lineTo(X(zc + 300), Y(yl(zc + 300)));
        ctx.moveTo(X(zc - 300), Y(yh(zc - 300)));
        ctx.lineTo(X(zc + 300), Y(yh(zc + 300)));
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (const [s0, c0] of BOUNDS) {
      ctx.beginPath();
      ctx.moveTo(X(s0 + c0 * (yB - 60)), Y(yB - 60));
      ctx.lineTo(X(s0 + c0 * (yT + 60)), Y(yT + 60));
      ctx.stroke();
    }
    ctx.restore();
    // surface
    ctx.strokeStyle = 'rgba(200,215,235,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(X(lo), Y(lo));
    ctx.lineTo(X(hi), Y(hi));
    ctx.stroke();
  }

  /** bgOnly: static sample/grains/surface (cached); otherwise the wire-dependent overlay */
  function drawScene(ctx: CanvasRenderingContext2D, v: View, zoom: boolean, bgOnly: boolean): void {
    const X = (z: number) => v.cx + (z - v.zc) * v.sc;
    const Y = (y: number) => v.cy - (y - v.yc) * v.sc;
    const zL = v.zc - (v.cx - v.r.x) / v.sc - 5;
    const zR = v.zc + (v.r.x + v.r.w - v.cx) / v.sc + 5;
    const yB = v.yc - (v.r.y + v.r.h - v.cy) / v.sc - 5;
    const yT = v.yc + (v.cy - v.r.y) / v.sc + 5;

    // sample (below the surface line y = z) with its grains
    if (bgOnly) {
      drawSampleBg(ctx, v, X, Y, zL, zR, yB, yT);
      return;
    }
    // rays from the two grains toward the pixel; blocked rays stop at the wire
    const [wy, wz] = P.wireYZ(st.u, g.h);
    const dsRay = zoom ? 0.8 : 1.6;
    for (const gr of GRAINS) {
      for (let s = gr.s0 + dsRay / 2; s < gr.s1; s += dsRay) {
        const [vy, vz] = P.rayDir(s, g);
        const ry = wy;
        const rz = wz - s;
        const tc = ry * vy + rz * vz;
        const b2 = ry * ry + rz * rz - tc * tc;
        let tEnd = (yT + 10) / vy;
        let blocked = false;
        if (b2 < g.R * g.R && tc > 0) {
          tEnd = tc - Math.sqrt(g.R * g.R - b2);
          blocked = true;
        }
        const tOut = P.exitPath(s, g);
        const att = Math.exp(-g.muS * (s + tOut));
        ctx.strokeStyle = gr.col;
        ctx.lineWidth = zoom ? 1.2 : 1;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(X(s), Y(0));
        ctx.lineTo(X(s + vz * tOut), Y(vy * tOut));
        ctx.stroke();
        ctx.globalAlpha = (blocked ? 0.3 : 0.8) * (0.35 + 0.65 * att);
        ctx.beginPath();
        ctx.moveTo(X(s + vz * tOut), Y(vy * tOut));
        ctx.lineTo(X(s + vz * tEnd), Y(vy * tEnd));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // wire shadow + edge rays
    const [sT, sL] = P.edgeDepths(st.u, g);
    const tangentPoint = (sEdge: number): [number, number] => {
      const [vy, vz] = P.rayDir(sEdge, g);
      const t = wy * vy + (wz - sEdge) * vz;
      return [vy * t, sEdge + vz * t];
    };
    const [tTy, tTz] = tangentPoint(sT);
    const [tLy, tLz] = tangentPoint(sL);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.moveTo(X(sT), Y(0));
    ctx.lineTo(X(tTz), Y(tTy));
    ctx.lineTo(X(wz), Y(wy));
    ctx.lineTo(X(tLz), Y(tLy));
    ctx.lineTo(X(sL), Y(0));
    ctx.closePath();
    ctx.fill();
    const topOf = (sEdge: number): [number, number] => {
      const [vy, vz] = P.rayDir(sEdge, g);
      const t = (yT + 10) / vy;
      return [vy * t, sEdge + vz * t];
    };
    const [eTy, eTz] = topOf(sT);
    const [eLy, eLz] = topOf(sL);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(183,195,210,0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(X(sT), Y(0));
    ctx.lineTo(X(eTz), Y(eTy));
    ctx.stroke();
    ctx.restore();
    glowLine(
      ctx,
      () => {
        ctx.moveTo(X(sL), Y(0));
        ctx.lineTo(X(eLz), Y(eLy));
      },
      color,
      2,
      7,
      0.22,
    );

    // incident beam, attenuating inside the sample (one gradient stroke; glow = wide translucent pass)
    glowLine(
      ctx,
      () => {
        ctx.moveTo(X(zL), Y(0));
        ctx.lineTo(X(0), Y(0));
      },
      TOKENS.xray,
      zoom ? 3 : 2.6,
      zoom ? 10 : 8,
      0.22,
    );
    const sEnd = Math.min(zR, S_MAX + 60);
    if (sEnd > 0) {
      const gr = ctx.createLinearGradient(X(0), 0, X(sEnd), 0);
      for (let k = 0; k <= 8; k++) {
        const s = (sEnd * k) / 8;
        gr.addColorStop(k / 8, `rgba(92,211,255,${(0.95 * Math.exp(-g.muS * s)).toFixed(3)})`);
      }
      ctx.save();
      ctx.strokeStyle = gr;
      ctx.lineWidth = zoom ? 2.4 : 2;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      ctx.lineTo(X(sEnd), Y(0));
      ctx.stroke();
      ctx.restore();
    }

    // probed point
    if (sL > zL && sL < zR) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(sL), Y(0), zoom ? 7 : 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (!zoom) {
      // wire track + wire
      const [ay, az] = P.wireYZ(uA, g.h);
      const [by, bz] = P.wireYZ(uB, g.h);
      ctx.save();
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = 'rgba(200,215,235,0.32)';
      ctx.beginPath();
      ctx.moveTo(X(az), Y(ay));
      ctx.lineTo(X(bz), Y(by));
      ctx.stroke();
      ctx.restore();
      const rr = g.R * v.sc;
      const wg = ctx.createRadialGradient(X(wz) - rr * 0.35, Y(wy) - rr * 0.35, rr * 0.1, X(wz), Y(wy), rr);
      wg.addColorStop(0, '#f5f6f8');
      wg.addColorStop(0.55, '#a8adb8');
      wg.addColorStop(1, '#5d6370');
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(X(wz), Y(wy), rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // keep the wire's label clear of the top annotation; flip to the right of the wire if it would clip
      const ly = Math.max(Y(wy) - 1, v.r.y + 52);
      const t1 = `Pt wire Ø${st.wireD} µm`;
      const roomL = X(wz) - rr - 7 - (v.r.x + 4);
      const roomR = v.r.x + v.r.w - 4 - (X(wz) + rr + 7);
      const long2 = `⇄ drag · ${g.h} µm above surface`;
      const t2 = textWidth(ctx, long2, 9.5) <= Math.max(roomL, roomR) ? long2 : '⇄ drag me';
      const lw = Math.max(textWidth(ctx, t1, 11, 600), textWidth(ctx, t2, 9.5));
      const leftOk = roomL >= lw || roomL >= roomR;
      const wlx = leftOk ? X(wz) - rr - 7 : X(wz) + rr + 7;
      haloText(ctx, t1, wlx, ly, { size: 11, color: TOKENS.ink, align: leftOk ? 'right' : 'left', weight: 600 });
      haloText(ctx, t2, wlx, ly + 13, { size: 9.5, color: TOKENS.ink3, align: leftOk ? 'right' : 'left' });
      haloText(ctx, 'focused X-ray beam (~0.1 µm)', v.r.x + 10, Y(0) - 8, { size: 10.5, color: TOKENS.xray });
      haloText(ctx, 'Ni sample', v.r.x + v.r.w - 8, Y(0) - 8, { size: 10.5, color: TOKENS.ink3, align: 'right' });
      // to-pixel annotation along the leading edge ray
      const [vy, vz] = P.rayDir(sL, g);
      const yTop = v.yc + (v.cy - v.r.y - 30) / v.sc;
      const t = yTop / vy;
      const ax = X(sL + vz * t);
      const ay2 = Y(vy * t);
      const long = `↑ to one detector pixel, 511 mm away (2θ ${st.tthDeg.toFixed(0)}°)`;
      const short = `↑ to a pixel 511 mm up (2θ ${st.tthDeg.toFixed(0)}°)`;
      const txt = textWidth(ctx, long, 10) < v.r.w * 0.55 ? long : short;
      const tw = textWidth(ctx, txt, 10);
      const right = ax + 8 + tw > v.r.x + v.r.w - 6;
      const lx = right ? Math.max(v.r.x + 6 + tw, ax - 8) : ax + 8;
      haloText(ctx, txt, lx, ay2 + 4, { size: 10, color, align: right ? 'right' : 'left' });
      // scale bar (bottom right, inside the sample, clear of the beam)
      const bar = 50;
      const bx = v.r.x + v.r.w - 12 - bar * v.sc;
      const byy = v.r.y + v.r.h - 8;
      ctx.strokeStyle = TOKENS.ink2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, byy);
      ctx.lineTo(bx + bar * v.sc, byy);
      ctx.stroke();
      haloText(ctx, `${bar} µm`, bx + (bar * v.sc) / 2, byy - 5, { size: 10, color: TOKENS.ink2, align: 'center' });
    } else {
      // depth ticks along the beam
      for (let s = 0; s <= 50; s += 10) {
        ctx.strokeStyle = 'rgba(233,238,245,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X(s), Y(0) + 4);
        ctx.lineTo(X(s), Y(0) + 9);
        ctx.stroke();
        haloText(ctx, s === 50 ? '50 µm' : `${s}`, X(s), Y(0) + 20, { size: 10, color: TOKENS.ink2, align: 'center' });
      }
      for (const gr of GRAINS) haloText(ctx, `grain ${gr.name}`, X((gr.s0 + gr.s1) / 2), Y(-11.5), { size: 11.5, weight: 700, color: gr.col, align: 'center' });
      haloText(ctx, 'surface', X(-7) - 4, Y(-7) + 4, { size: 10, color: TOKENS.ink3, align: 'right' });
      haloText(ctx, 'beam', v.r.x + 10, Y(0) - 7, { size: 10, color: TOKENS.xray });
      if (sL > ZOOM.z0 && sL < ZOOM.z1) {
        const lab = sL < 0 ? 'edge above the surface' : `${sL.toFixed(1)} µm`;
        const right = X(sL) > v.r.x + v.r.w - 90;
        haloText(ctx, lab, right ? X(sL) - 10 : X(sL) + 10, Y(0) - 10, { size: 11.5, weight: 700, color, align: right ? 'right' : 'left' });
      }
      const zVisL = zL + 5 + 60 / v.sc;
      const zVisR = zR - 5 - 60 / v.sc;
      const yLab = yT - 5 - 34 / v.sc;
      const atY = (sE: number) => {
        const [ry, rz] = P.rayDir(sE, g);
        return X(sE + (yLab * rz) / ry);
      };
      if (sT > zVisL && sT < zVisR) haloText(ctx, 'back edge', atY(sT) - 6, Y(yLab), { size: 9.5, color: TOKENS.ink2, align: 'right' });
      if (sL > zVisL && sL < zVisR) haloText(ctx, 'front edge', atY(sL) + 6, Y(yLab), { size: 9.5, color, align: 'left' });
    }
  }

  // ---------------------------------------------------------------- scan plot
  let scanFrame: ReturnType<typeof plotFrame> | null = null;
  const scanBg = new Layer();
  function drawScan(): void {
    const { ctx, w, h } = scan;
    ctx.clearRect(0, 0, w, h);
    if (w < 60 || h < 60) return;
    const xmin = fineU[0];
    const xmax = fineU[fineU.length - 1];
    scanBg.draw(scan, `${geoVer}`, (c) => {
      const f = plotFrame(c, { x: 0, y: 32, w, h: h - 32 }, { min: xmin, max: xmax, label: 'wire position H (µm)' }, { min: 0, max: 1.12, label: 'pixel signal', ticks: [0, 0.5, 1] });
      scanFrame = f;
      // bands: where the leading / trailing edge crosses each grain
      GRAINS.forEach((gr, k) => {
        const { la, lb, ta, tb } = bands[k];
        c.fillStyle = gr.fill.replace(/[\d.]+\)$/, '0.16)');
        c.fillRect(f.px(la), f.y1, f.px(lb) - f.px(la), f.y0 - f.y1);
        c.fillStyle = gr.fill.replace(/[\d.]+\)$/, '0.07)');
        c.fillRect(f.px(ta), f.y1, f.px(tb) - f.px(ta), f.y0 - f.y1);
        haloText(c, `${gr.name}↓`, (f.px(la) + f.px(lb)) / 2, f.y1 + 11, { size: 10, color: gr.col, align: 'center', weight: 700 });
        haloText(c, `${gr.name}↑`, (f.px(ta) + f.px(tb)) / 2, f.y1 + 11, { size: 10, color: gr.col, align: 'center' });
      });
      line(c, f, fineU, fineI, 'rgba(183,195,210,0.45)', 1.2);
      haloText(c, '↓ wire’s front edge hides a grain · ↑ back edge uncovers it', 8, 30, { size: 9.5, color: TOKENS.ink3 });
    });
    const f = scanFrame;
    if (!f) return;
    // measured points
    ctx.fillStyle = color;
    const r = nSteps > 260 ? 1.4 : 2;
    ctx.beginPath();
    for (let i = 0; i < nSteps; i++) {
      if (!meas[i]) continue;
      ctx.rect(f.px(uGrid[i] - u0) - r, f.py(vals[i]) - r, 2 * r, 2 * r);
    }
    ctx.fill();
    // current position
    const cx = f.px(st.u - u0);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, f.y1);
    ctx.lineTo(cx, f.y0);
    ctx.stroke();
  }

  // ---------------------------------------------------------------- depth plot
  const depthBg = new Layer();
  let depthFrame: ReturnType<typeof plotFrame> | null = null;
  const SMAX_PLOT = 52;
  function drawDepth(): void {
    const { ctx, w, h } = depth;
    ctx.clearRect(0, 0, w, h);
    if (w < 60 || h < 60) return;
    const smax = SMAX_PLOT;
    depthBg.draw(depth, `${geoVer}`, (c) => {
      const ymax = densMax * 1.45;
      const ymin = -densMax * 0.25;
      const f = plotFrame(
        c,
        { x: 0, y: 32, w, h: h - 32 },
        { min: 0, max: smax, label: 'depth along the beam (µm)' },
        { min: ymin, max: ymax, label: 'signal / µm', ticks: [0, niceStep(ymax)], format: (v) => (v === 0 ? '0' : v.toFixed(2)) },
      );
      depthFrame = f;
      c.strokeStyle = TOKENS.axis;
      c.beginPath();
      c.moveTo(f.x0, f.py(0));
      c.lineTo(f.x1, f.py(0));
      c.stroke();
      // truth (attenuated profile)
      for (const gr of GRAINS) {
        c.fillStyle = gr.fill.replace(/[\d.]+\)$/, '0.22)');
        c.strokeStyle = gr.col;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(f.px(gr.s0), f.py(0));
        for (let i = 0; i < grid.f.length; i++) {
          const s = (i + 0.5) * grid.ds;
          if (s < gr.s0 || s > gr.s1) continue;
          c.lineTo(f.px(s), f.py(dens[i]));
        }
        c.lineTo(f.px(gr.s1), f.py(0));
        c.closePath();
        c.fill();
        c.globalAlpha = 0.7;
        c.stroke();
        c.globalAlpha = 1;
        haloText(c, `grain ${gr.name}`, f.px((gr.s0 + gr.s1) / 2), f.y1 + 11, { size: 10, color: gr.col, align: 'center', weight: 700 });
      }
      haloText(c, 'bars = rebuilt from the scan · shaded = true grains', 8, 30, { size: 9.5, color: TOKENS.ink3 });
    });
    const f = depthFrame;
    if (!f) return;
    // reconstruction from step differences (leading edge)
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x0, f.y1, f.x1 - f.x0, f.y0 - f.y1);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    const y0 = f.py(0);
    ctx.beginPath();
    for (let i = 0; i < nSteps - 1; i++) {
      if (!meas[i] || !meas[i + 1]) continue;
      const sa = leadGrid[i];
      const sb = leadGrid[i + 1];
      if (sb < 0 || sa > smax) continue;
      const d = (vals[i] - vals[i + 1]) / (sb - sa);
      const x0 = f.px(sa);
      const x1 = f.px(sb);
      const y = f.py(d);
      ctx.rect(x0, Math.min(y, y0), Math.max(1, x1 - x0 - 0.5), Math.abs(y0 - y));
    }
    ctx.fill();
    ctx.restore();
    const [, sl] = P.edgeDepths(st.u, g);
    if (sl >= 0 && sl <= smax) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#fff';
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(f.px(sl), f.y1);
      ctx.lineTo(f.px(sl), f.y0);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- interaction
  /** pointer → wire position: on the overview, project onto the wire track; on the zoom strip, aim the front edge */
  const pointerToU = (cx: number, cy: number, zoom: boolean): number => {
    if (zoom) {
      const z = vZoom.zc + (cx - vZoom.cx) / vZoom.sc;
      return P.uForLead(z, g);
    }
    const z = vMain.zc + (cx - vMain.cx) / vMain.sc;
    const y = vMain.yc - (cy - vMain.cy) / vMain.sc;
    return (y + z) * Math.SQRT1_2; // projection on Ĥ (Ĥ ⟂ n̂)
  };
  let dragSide: null | { zoom: boolean } = null;
  side.canvas.style.cursor = 'grab';
  side.canvas.addEventListener('pointerdown', (e) => {
    side.canvas.setPointerCapture(e.pointerId);
    const r = side.canvas.getBoundingClientRect();
    const y = e.clientY - r.top;
    dragSide = { zoom: y >= vZoom.r.y };
    stopAuto();
    moveTo(pointerToU(e.clientX - r.left, y, dragSide.zoom));
    side.canvas.style.cursor = 'grabbing';
  });
  side.canvas.addEventListener('pointermove', (e) => {
    const r = side.canvas.getBoundingClientRect();
    if (!dragSide) {
      side.canvas.style.cursor = e.clientY - r.top >= vZoom.r.y ? 'ew-resize' : 'grab';
      return;
    }
    moveTo(pointerToU(e.clientX - r.left, e.clientY - r.top, dragSide.zoom));
  });
  const endSide = () => {
    dragSide = null;
    side.canvas.style.cursor = 'grab';
  };
  side.canvas.addEventListener('pointerup', endSide);
  side.canvas.addEventListener('pointercancel', endSide);
  let dragScan = false;
  scan.canvas.style.cursor = 'ew-resize';
  const scrub = (e: PointerEvent) => {
    if (!scanFrame) return;
    const r = scan.canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left - scanFrame.x0) / (scanFrame.x1 - scanFrame.x0);
    moveTo(uA + fx * (uB - uA));
  };
  scan.canvas.addEventListener('pointerdown', (e) => {
    scan.canvas.setPointerCapture(e.pointerId);
    dragScan = true;
    stopAuto();
    scrub(e);
  });
  scan.canvas.addEventListener('pointermove', (e) => dragScan && scrub(e));
  scan.canvas.addEventListener('pointerup', () => (dragScan = false));
  scan.canvas.addEventListener('pointercancel', () => (dragScan = false));

  // ---------------------------------------------------------------- frame, layout
  let animAcc = 0;
  function frame(dt: number): void {
    if (!active) return;
    if (st.auto) {
      const speed = (uB - uA) / 8; // whole scan in ~8 s
      const nu = Math.min(uB, st.u + speed * dt);
      moveTo(nu);
      if (nu >= uB) stopAuto();
    }
    if (!dirty) return;
    animAcc += dt;
    if (st.auto && !dragSide && animAcc < 0.031) return; // animation-only redraws capped at ~30 fps
    animAcc = 0;
    dirty = false;
    if (uiDirty) updateReadouts();
    drawSide();
    drawScan();
    drawDepth();
  }

  function layout(n: boolean, width: number): void {
    narrow = n;
    if (narrow) {
      const w = Math.max(200, width);
      el.style.gridTemplateColumns = 'minmax(0,1fr)';
      el.style.gridTemplateRows = 'auto auto auto';
      for (const [wrap, ar] of [
        [sideWrap, 0.82],
        [scanWrap, 2.0],
        [depthWrap, 2.0],
      ] as [HTMLElement, number][]) {
        wrap.style.gridArea = '';
        wrap.style.height = `${Math.round(w / ar)}px`;
      }
    } else {
      el.style.gridTemplateColumns = 'minmax(0,1fr) minmax(0,1fr)';
      el.style.gridTemplateRows = 'minmax(0,1fr) minmax(0,1fr)';
      sideWrap.style.gridArea = '1 / 1 / 3 / 2';
      scanWrap.style.gridArea = '1 / 2 / 2 / 3';
      depthWrap.style.gridArea = '2 / 2 / 3 / 3';
      for (const w of [sideWrap, scanWrap, depthWrap]) w.style.height = '';
    }
    dirty = true;
  }

  function setActive(on: boolean): void {
    active = on;
    el.hidden = !on;
    ctl.hidden = !on;
    ctl.style.display = on ? 'contents' : 'none';
    if (on) {
      dirty = true;
      if (!st.played) {
        st.played = true;
        st.u = uA;
        clearScan();
        startAuto();
      }
    }
  }

  rebuild(false);
  st.u = uA;
  updateReadouts();
  void narrow;
  return { el, ctl, layout, setActive, frame, caption, reset };
}

function niceStep(max: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [5, 2, 1]) if (m * e <= max * 0.95) return m * e;
  return e;
}
