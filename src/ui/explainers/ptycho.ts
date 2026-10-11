/**
 * Station "Ptychographic image reconstruction". Ptychography with live reconstruction (PtychoProbe, 33-ID).
 *
 * A focused-but-defocused X-ray beam (46 nm) is stepped across an illustrative test chip; at every stop the
 * far-field diffraction pattern is recorded with Poisson photon noise; ePIE then recovers the complex object AND the
 * beam from the overlapping patterns, live (a time-budgeted number of position updates per animation frame).
 *
 * Physics, equations, approximations and sources: see ./ptycho/physics.ts (header comment). In short:
 *   I_j(q) = N_ph |F[P(r) O(r − R_j)]|² / M²  → Poisson counts;  Δx = λz/(Mp) = 2 nm at 10 keV;
 *   probe = FZP (Δr_N = 4 nm, NA = 15.5 mrad) 1.5 µm past focus, d = 2·NA·Δz = 46 nm; overlap o = 1 − s/d;
 *   ePIE: O ← O + P∗Δψ/max|P|², P ← P + O∗Δψ/max|O|² with |O| ≤ 1 and Σ|P|² fixed to the measured flux;
 *   flux 3.1e10 ph/s (APS-U FDR design value, 4-nm-zone FZP, 10 keV), pre-upgrade = ÷100 (illustrative);
 *   quality = error vs the known truth and FRC(0.5) half-period over one fixed field of view for every scan (only
 *   possible because this is a simulation).
 */
import type { ExplainerModule } from './registry';
import { TOKENS, button, canvas2d, createStation, group, line, loop, lut, motionGate, note, plotFrame, readout, slider, toggle, type Canvas2D } from './kit';
import { FLUX, FrcMeter, GEOM, THICK, slab, Measurement, PROBE_D_NM, PUPIL_R_PX, PtychoSolver, angleMrad, compareObject, emptyMeans, expectedPattern, fovWindow, halfPeriodNm, illumination, makeChip, makeProbe, makeScan, noiseFloor, poissonFast, windowMask, type Means, type Scan, type ScanPattern, type Source } from './ptycho/physics';
import { Bitmap, fitText, haloText, hexRgb, paintComplex, paintCounts, paintPhase, paintSprite, scaleBar, sci, textW, type Rect } from './ptycho/views';
import { rng } from '../../lib/fft';

const N = GEOM.N;
const M = GEOM.M;
const DEF = { stepNm: 14, pattern: 'raster' as ScanPattern, src: 'apsu' as Source, dwellUs: 30 };
/** iterations per "run" before the solver pauses itself (saves battery; Run continues) */
const ITER_CHUNK = 100;
/** reduced motion, results only: the held panels are refreshed at these solver iterations (a few still steps) */
const HOLD_MILESTONES = [4, 12, 35];
/** target CPU time per animation frame (ms): solver budget = this minus the measured drawing cost, clamped */
const FRAME_MS = 13;
/** solver time per frame is also throttled by the measured frame interval: shrink above this (ms) … */
const SLOW_FRAME_MS = 30;
/** … and grow back below this (ms) */
const FAST_FRAME_MS = 20;
/** probe-window inset shown in the reconstruction panel (central crop, px) */
const PROBE_CROP = 48;

const SRC_NAME: Record<Source, string> = { aps: 'APS', apsu: 'APS-U' };
const D_TXT = PROBE_D_NM.toFixed(0);
/** phase delay (rad) of each material layer, for the legend swatches */
const MAT_PHASE = { Au: slab('Au', THICK.Au).phase, W: slab('W', THICK.W).phase, Cu: slab('Cu', THICK.Cu).phase };
const ICE = lut('ice');

const fmtDwell = (us: number): string => (us < 1000 ? `${us < 10 ? us.toFixed(1) : Math.round(us)} µs` : `${(us / 1000).toFixed(us < 10000 ? 1 : 0)} ms`);
const fmtRes = (nm: number): string => (nm > 20 ? '> 20 nm' : `${nm.toFixed(1)} nm`);
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
/** compact scientific notation for readouts: 1.7×10⁻³ */
const eNum = (v: number): string => {
  if (!(v > 0)) return '0';
  const [m, e] = v.toExponential(1).split('e');
  return `${m}×10${String(Number(e)).replace(/./g, (c) => SUP[c] ?? c)}`;
};
const overlapOf = (stepNm: number): number => Math.max(0, 1 - stepNm / PROBE_D_NM);

interface Run {
  errO: number[];
  res: number[];
  /** legend text variants, longest first */
  label: string[];
}

const mod: ExplainerModule = {
  title: "Ptychographic image reconstruction",
  subtitle: "Change the scan step and X-ray source to see how a computer reconstructs an image from overlapping diffraction measurements.",
  mount(host, ctx) {
    const station = createStation(host, { color: ctx.color, layout: 'side' });
    const accent = /^#[0-9a-f]{6}$/i.test(ctx.color) ? ctx.color : '#60a5fa';
    const accRgb = hexRgb(accent);

    // ------------------------------------------------------------------ physics state
    const chip = makeChip();
    const probeTrue = makeProbe();
    const probeGuess = makeProbe({ defocusUm: 1.0 });
    const frc = new FrcMeter(chip);
    // one fixed field of view (the chip) for ε and the FRC, whatever the scan: sparse scans are judged on the same area
    const fovW = fovWindow();
    const mask = windowMask(fovW);
    frc.setWindow(fovW);
    const phLo = -0.02;
    const phHi = chip.maxPhase * 1.06;

    const par = { ...DEF };
    let scan: Scan = makeScan(par.pattern, overlapOf(par.stepNm));
    let means: Means = emptyMeans(scan);
    let illum = illumination(scan, probeTrue);
    const fade = new Float32Array(N * N);
    let meas: Measurement | null = null;
    let solver: PtychoSolver | null = null;
    let stage: 'measure' | 'solve' | 'done' = 'measure';
    let running = true;
    let iterTarget = ITER_CHUNK;
    let run: Run = { errO: [], res: [], label: [] };
    let ghost: Run | null = null;
    /** log10 of the brightest expected count in a pattern (detector colour scale) */
    let detHiLog = 3;
    let lastErr = 1;
    let lastRes = NaN;
    /** latest comparison with the truth (γ alignment + error) */
    let gam = { err: 1, gRe: 1, gIm: 0 };
    let gamAge = 0;
    /** frames since the probe inset was repainted */
    let probeAge = 99;
    const refreshGamma = () => {
      if (!solver) return;
      gam = compareObject(chip, solver.O, mask);
      lastErr = gam.err;
      gamAge = 0;
    };

    const nPh = () => FLUX[par.src] * par.dwellUs * 1e-6;
    const runLabel = (): string[] => {
      const src = SRC_NAME[par.src];
      const ov = Math.round(overlapOf(par.stepNm) * 100);
      const dw = fmtDwell(par.dwellUs);
      const pat = par.pattern === 'spiral' ? ' · spiral' : '';
      return [`${src} · ${ov} % overlap · ${dw}${pat}`, `${src} · ${ov} % · ${dw}${pat}`, `${src} · ${ov} %${pat}`, `${src} · ${ov} %`];
    };
    /** median of the last few FRC values (single-iteration FRC jitters around the threshold) */
    const resNow = (): number => {
      const r = run.res.filter((v) => !Number.isNaN(v)).slice(-5);
      if (!r.length || (solver && solver.iter < 4)) return NaN;
      r.sort((a, b) => a - b);
      return r[Math.floor(r.length / 2)];
    };

    /** indices of pixels the scan illuminates (the only ones the reconstruction panel needs to recompute) */
    let litIdx = new Int32Array(0);
    const updateFade = () => {
      let mx = 0;
      for (let i = 0; i < illum.length; i++) if (illum[i] > mx) mx = illum[i];
      let n = 0;
      for (let i = 0; i < illum.length; i++) {
        const t = Math.max(0, Math.min(1, (illum[i] / (mx || 1) - 0.06) / 0.2));
        fade[i] = t * t * (3 - 2 * t);
        if (fade[i] > 0) n++;
      }
      litIdx = new Int32Array(n);
      n = 0;
      for (let i = 0; i < illum.length; i++) if (fade[i] > 0) litIdx[n++] = i;
    };

    // ------------------------------------------------------------------ canvases
    const smpC = canvas2d(station.visual, { label: '1 · Sample + beam' });
    const detC = canvas2d(station.visual, { label: "2 · Detector counts · log scale" });
    const recC = canvas2d(station.visual, { label: "3 · Reconstructed image" });
    const errC = canvas2d(station.visual, { label: "4 · Reconstruction error" });
    const wraps = { smp: smpC.canvas.parentElement!, det: detC.canvas.parentElement!, rec: recC.canvas.parentElement!, err: errC.canvas.parentElement! };
    {
      smpC.canvas.setAttribute('aria-label', 'Test chip with the scan positions of the X-ray beam. Drag, or focus and use the arrow keys, to aim the beam and see its diffraction pattern.');
      detC.canvas.setAttribute('aria-label', 'Diffraction pattern recorded by the camera for the highlighted beam position, logarithmic colour scale.');
      recC.canvas.setAttribute('aria-label', 'Image recovered by the reconstruction algorithm, with the recovered beam as an inset.');
      errC.canvas.setAttribute('aria-label', 'Plot of the reconstruction error against iteration number.');
    }

    const truthBmp = new Bitmap(N, N);
    paintPhase(truthBmp, chip.phase, phLo, phHi);
    const recBmp = new Bitmap(N, N);
    const detBmp = new Bitmap(M, M);
    const probeBmp = new Bitmap(PROBE_CROP, PROBE_CROP);
    const spriteBmp = new Bitmap(M, M);
    paintSprite(spriteBmp, probeTrue.re, probeTrue.im, accRgb);
    const recPhase = new Float64Array(N * N);
    const blankPhase = new Float64Array(N * N);

    // ------------------------------------------------------------------ adaptive layout
    type Mode = 'wide' | 'mid' | 'narrow';
    let mode: Mode | null = null;
    let lastW = 0;
    const applyLayout = () => {
      const W = Math.round(host.clientWidth || station.root.clientWidth || 800);
      if (W === lastW && mode) return;
      lastW = W;
      const m: Mode = W >= 940 ? 'wide' : W >= 640 ? 'mid' : 'narrow';
      mode = m;
      station.root.classList.toggle('stn-side', m === 'wide');
      station.root.classList.toggle('stn-stack', m !== 'wide');
      station.root.style.overflowY = m === 'wide' ? '' : 'auto';
      station.root.style.gridTemplateRows = m === 'wide' ? '' : 'max-content max-content max-content';
      station.controls.style.gridTemplateColumns = m === 'narrow' ? 'minmax(0, 1fr)' : '';
      const v = station.visual.style;
      wraps.smp.style.gridArea = 'smp';
      wraps.det.style.gridArea = 'det';
      wraps.rec.style.gridArea = 'rec';
      wraps.err.style.gridArea = 'err';
      for (const wr of Object.values(wraps)) {
        wr.style.height = '100%';
        wr.style.minHeight = '0';
      }
      v.height = '';
      if (m === 'wide') {
        v.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
        v.gridTemplateRows = 'minmax(0, 1.65fr) minmax(0, 1fr)';
        v.gridTemplateAreas = '"smp det rec" "err err err"';
      } else if (m === 'mid') {
        const col = (W - 16 - 12) / 3;
        v.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
        v.gridTemplateRows = `${Math.round(col + 48)}px ${Math.round(Math.max(190, Math.min(250, W * 0.28)))}px`;
        v.gridTemplateAreas = '"smp det rec" "err err err"';
      } else {
        const col = (W - 16 - 6) / 2;
        v.gridTemplateColumns = 'minmax(0, 1fr) minmax(0, 1fr)';
        v.gridTemplateRows = `${Math.round(col + 48)}px ${Math.round(Math.max(200, col + 48))}px`;
        v.gridTemplateAreas = '"smp det" "rec err"';
      }
      dirtyAll();
    };
    const ro = new ResizeObserver(() => applyLayout());
    ro.observe(host);
    station.onDestroy(() => ro.disconnect());

    // ------------------------------------------------------------------ controls
    // run
    const gRun = group(station.controls, 'Reconstruction');
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    gRun.appendChild(btnRow);
    const bRun = button(btnRow, 'Pause', () => {
      if (running) running = false;
      else {
        if (stage === 'done') {
          stage = 'solve';
          iterTarget = (solver?.iter ?? 0) + ITER_CHUNK;
        }
        running = true;
      }
      syncRunButton();
      refreshCaption();
    }, 'is-primary');
    bRun.style.flex = '1 1 auto';
    const bRestart = button(btnRow, 'Restart', () => restartSolver());
    bRestart.title = "Reconstruct again from a blank initial image, using the same recorded data";
    const bDefaults = button(btnRow, 'Reset', () => setDefaults());
    bDefaults.title = 'Restore the default source, exposure and scan step';
    // reduced motion: the scan and the solver still run, but the panels show their result instead of every step
    const motion = motionGate(station, btnRow, {
      play: "▶ Animate reconstruction",
      pause: '❚❚ Results only',
      title: "Reduced motion is enabled on your device. The panels display results rather than each step. Press to animate the scan and reconstruction.",
      onChange: () => dirtyAll(),
    });
    const rRes = readout(gRun, 'Finest detail', { big: true, color: accent });
    rRes.el.title = "Half-period of the finest detail that agrees with the true chip, measured by Fourier ring correlation at 0.5";
    const rRF = readout(gRun, 'Data misfit');
    rRF.el.title = "R_F measures the difference between predicted and recorded diffraction patterns, compared with the difference expected from photon noise alone.";
    const syncRunButton = () => {
      bRun.textContent = running ? 'Pause' : stage === 'done' ? 'Resume' : 'Run';
      bRun.setAttribute('aria-pressed', String(running));
    };

    // source
    const gSrc = group(station.controls, 'X-ray source');
    const tSrc = toggle<Source>(gSrc, {
      options: [
        { value: 'aps', label: "APS before upgrade", title: "The original APS storage ring operated from 1996 to 2023. This model uses ~100× less coherent flux." },
        { value: 'apsu', label: 'APS-U', title: "The upgraded multi-bend-achromat ring has operated since 2024." },
      ],
      value: par.src,
      onChange: (v) => {
        par.src = v;
        newDose();
      },
    });
    const sDwell = slider(gSrc, {
      label: 'Exposure per shot',
      // 10 µs = 100 kHz frames, already past today's fastest detectors; below ~3 × 10³ photons/shot plain ePIE
      // refines the probe into noise (an algorithm failure, not the dose physics this slider is about)
      min: 10,
      max: 3000,
      log: true,
      value: par.dwellUs,
      format: fmtDwell,
      onInput: (v) => {
        par.dwellUs = v;
        newDose();
      },
    });
    const rPh = readout(gSrc, 'Photons per shot');
    note(
      gSrc,
      station,
      "Ptychography uses coherent X-rays, whose waves have a stable phase relationship. Coherent flux grows with source brightness. The design coherent flux in this focus is 3.1×10^{10} photons/s at 10 keV, over 100× the pre-upgrade estimate. This value depends on the design assumptions described below. The pre-upgrade source in this model is 100× weaker for illustration.",
    );

    // scan
    const gScan = group(station.controls, 'Scan');
    const sStep = slider(gScan, {
      label: 'Step between shots',
      min: 8,
      max: 46,
      step: 1,
      value: par.stepNm,
      format: (v) => `${Math.round(v)} nm · ${Math.round(overlapOf(v) * 100)} %`,
      onInput: (v) => {
        par.stepNm = Math.round(v);
        newScan();
      },
    });
    const tPat = toggle<ScanPattern>(gScan, {
      label: 'Pattern',
      options: [
        { value: 'raster', label: 'Grid', title: "Raster grid in snake order, with ±1 px jitter" },
        { value: 'spiral', label: 'Spiral', title: "Fermat spiral without periodic spacing" },
      ],
      value: par.pattern,
      onChange: (v) => {
        par.pattern = v;
        newScan();
      },
    });
    note(
      gScan,
      station,
      `Each ring marks one exposure with the ${D_TXT} nm beam. Overlap = 1 − step ÷ ${D_TXT} nm. Adjacent exposures need about 60 % overlap or more to distinguish the beam profile from the sample. The grid positions vary by ±1 pixel because a perfectly regular grid can introduce reconstruction artefacts. The Fermat spiral avoids periodic spacing.`,
    );

    // model caveats: the fine print, in smaller type
    const gModel = group(station.controls, 'About this model');
    note(
      gModel,
      station,
      "This is a simulation of an illustrative chip. The gold is 150 nm thick, and the tungsten and copper are 120 nm thick. These layers are thinner than the ≈170 nm depth of field, so a single-layer model applies. The model uses one fully coherent beam mode, exact positions and photon noise. It does not include detector noise or a count-rate limit. Both sources use plain ePIE, which performs poorly at low dose compared with more advanced solvers. Error and finest detail are measured against the known chip over the same area for every scan. The design flux assumes a Si(311) monochromator. For 11,250 zones, the required bandwidth is below ≈9×10^{−5}. The installed Si(111) bandwidth is 1.4×10^{−4}. The design also assumes 4.6 m of undulator. The installed length is ≈2.35 m, with ~3× less coherent flux.",
    );
    (gModel.lastElementChild as HTMLElement).style.fontSize = '11.5px';

    // ------------------------------------------------------------------ state transitions
    let dirty = { smp: true, det: true, rec: true, err: true };
    /** draw the next frame even if the panels are holding for a result (the first frame of a new run) */
    let showNext = true;
    function dirtyAll() {
      dirty = { smp: true, det: true, rec: true, err: true };
    }

    const archiveRun = () => {
      if (run.errO.length >= 3) ghost = { errO: run.errO.slice(), res: run.res.slice(), label: run.label };
    };

    /** start recording a new data set (scan or dose changed) */
    const remeasure = () => {
      archiveRun();
      meas = new Measurement(chip, probeTrue, means, nPh(), N, M, 1);
      solver = null;
      stage = 'measure';
      running = true;
      iterTarget = ITER_CHUNK;
      run = { errO: [], res: [], label: runLabel() };
      lastErr = 1;
      lastRes = NaN;
      // detector colour scale: brightest expected count of the first pattern (fixed for the data set, so dose shows)
      detHiLog = 0;
      rPh.set(sci(nPh()));
      syncRunButton();
      refreshCaption();
      dirtyAll();
      showNext = true;
    };

    function newScan() {
      scan = makeScan(par.pattern, overlapOf(par.stepNm));
      scanId++;
      means = emptyMeans(scan);
      illum = illumination(scan, probeTrue);
      updateFade();
      remeasure();
    }

    function newDose() {
      remeasure();
    }

    const startSolver = () => {
      if (!meas) return;
      // first sweep in scan order: the picture visibly stitches together patch by patch
      solver = new PtychoSolver(meas.data, probeGuess, N, M, { firstSweepInOrder: true });
      gam = { err: 1, gRe: 1, gIm: 0 };
      gamAge = 99;
      probeAge = 99;
      stage = 'solve';
      run.errO = [1];
      run.res = [NaN];
      lastErr = 1;
      refreshCaption();
    };

    function restartSolver() {
      if (!meas || !meas.done) return;
      archiveRun();
      run = { errO: [], res: [], label: runLabel() };
      iterTarget = ITER_CHUNK;
      running = true;
      startSolver();
      syncRunButton();
      dirtyAll();
      showNext = true;
    }

    function setDefaults() {
      Object.assign(par, DEF);
      sStep.set(par.stepNm);
      tPat.set(par.pattern);
      tSrc.set(par.src);
      sDwell.set(par.dwellUs);
      newScan();
    }

    // ------------------------------------------------------------------ manual beam (drag / arrow keys)
    const manual = { on: false, x: 0, y: 0, until: 0 };
    const manCounts = new Float32Array(M * M);
    const manMean = new Float32Array(M * M);
    const manRe = new Float64Array(M * M);
    const manIm = new Float64Array(M * M);
    const manRng = rng(99);
    let manDirty = false;
    const aim = (x0: number, y0: number) => {
      manual.on = true;
      manual.x = Math.max(0, Math.min(N - M, Math.round(x0)));
      manual.y = Math.max(0, Math.min(N - M, Math.round(y0)));
      manual.until = performance.now() + 3500;
      manDirty = true;
      dirty.smp = true;
      dirty.det = true;
    };
    const computeManual = () => {
      if (!manDirty) return;
      manDirty = false;
      const k = nPh();
      expectedPattern(chip, N, probeTrue, M, manual.x, manual.y, k, manRe, manIm, manMean);
      for (let i = 0; i < M * M; i++) manCounts[i] = poissonFast(manMean[i], manRng);
      if (detHiLog <= 0) detHiLog = hiLogOf(manMean, 1);
    };
    let smpRect: Rect = { x: 0, y: 0, w: 1, h: 1 };
    const toObj = (e: PointerEvent): [number, number] => {
      const r = smpC.canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      return [((px - smpRect.x) / smpRect.w) * N - M / 2, ((py - smpRect.y) / smpRect.h) * N - M / 2];
    };
    let dragging = false;
    smpC.canvas.style.cursor = 'crosshair';
    smpC.canvas.tabIndex = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      smpC.canvas.setPointerCapture(e.pointerId);
      aim(...toObj(e));
      refreshCaption();
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) aim(...toObj(e));
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (smpC.canvas.hasPointerCapture(e.pointerId)) smpC.canvas.releasePointerCapture(e.pointerId);
    };
    const onKey = (e: KeyboardEvent) => {
      const d: Record<string, [number, number]> = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] };
      if (e.key === 'Escape') {
        manual.on = false;
        dirtyAll();
        return;
      }
      const v = d[e.key];
      if (!v) return;
      e.preventDefault();
      const [bx, by] = manual.on ? [manual.x, manual.y] : currentPos();
      aim(bx + v[0], by + v[1]);
    };
    const onFocus = () => {
      if (smpC.canvas.matches(':focus-visible')) {
        wraps.smp.style.outline = `2px solid ${accent}`;
        wraps.smp.style.outlineOffset = '1px';
      }
    };
    const onBlur = () => (wraps.smp.style.outline = '');
    smpC.canvas.addEventListener('focus', onFocus);
    smpC.canvas.addEventListener('blur', onBlur);
    smpC.canvas.addEventListener('pointerdown', onDown);
    smpC.canvas.addEventListener('pointermove', onMove);
    smpC.canvas.addEventListener('pointerup', onUp);
    smpC.canvas.addEventListener('pointercancel', onUp);
    smpC.canvas.addEventListener('keydown', onKey);
    station.onDestroy(() => {
      smpC.canvas.removeEventListener('pointerdown', onDown);
      smpC.canvas.removeEventListener('pointermove', onMove);
      smpC.canvas.removeEventListener('pointerup', onUp);
      smpC.canvas.removeEventListener('pointercancel', onUp);
      smpC.canvas.removeEventListener('keydown', onKey);
      smpC.canvas.removeEventListener('focus', onFocus);
      smpC.canvas.removeEventListener('blur', onBlur);
    });

    // ------------------------------------------------------------------ helpers
    function hiLogOf(mean1: Float32Array, scale: number): number {
      let mx = 0;
      for (let i = 0; i < mean1.length; i++) if (mean1[i] > mx) mx = mean1[i];
      return Math.log10(1 + mx * scale);
    }

    /** scan point currently highlighted (index) */
    const currentIdx = (): number => {
      if (stage === 'measure') return meas ? Math.max(0, meas.next - 1) : 0;
      return solver && solver.last >= 0 ? solver.last : 0;
    };
    function currentPos(): [number, number] {
      const j = currentIdx();
      return j < scan.count ? [scan.x[j], scan.y[j]] : [(N - M) / 2, (N - M) / 2];
    }

    const squareIn = (c: Canvas2D, top: number, bottom: number): Rect => {
      const s = Math.max(40, Math.floor(Math.min(c.w - 12, c.h - top - bottom)));
      return { x: Math.round((c.w - s) / 2), y: Math.round(top + Math.max(0, (c.h - top - bottom - s) / 2)), w: s, h: s };
    };
    const clear = (c: Canvas2D) => {
      c.ctx.save();
      c.ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
      c.ctx.fillStyle = TOKENS.bg;
      c.ctx.fillRect(0, 0, c.w, c.h);
      c.ctx.restore();
    };
    const fs = (c: Canvas2D) => (c.w < 260 ? 10 : 11);

    // ------------------------------------------------------------------ drawing: sample
    /** static layer of the sample panel (truth, footprints, legend), rebuilt only when its inputs change */
    const smpBase = document.createElement('canvas');
    let smpKey = '';
    let scanId = 0;
    const drawSample = () => {
      const c = smpC;
      const g = c.ctx;
      const r = squareIn(c, 24, 24);
      smpRect = r;
      const sc = r.w / N;
      const rad = (PROBE_D_NM / GEOM.dxNm / 2) * sc;
      const shown = stage === 'measure' && meas ? meas.next : scan.count;
      const key = `${c.w}|${c.h}|${c.dpr}|${shown}|${scanId}|${manual.on ? 1 : 0}`;
      if (key !== smpKey) {
        smpKey = key;
        smpBase.width = Math.round(c.w * c.dpr);
        smpBase.height = Math.round(c.h * c.dpr);
        const b = smpBase.getContext('2d')!;
        b.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
        b.fillStyle = TOKENS.bg;
        b.fillRect(0, 0, c.w, c.h);
        truthBmp.draw(b, r);
        // footprints, one path
        b.save();
        b.beginPath();
        b.rect(r.x, r.y, r.w, r.h);
        b.clip();
        b.strokeStyle = 'rgba(255,255,255,0.26)';
        b.lineWidth = 1;
        b.beginPath();
        for (let j = 0; j < shown; j++) {
          const cx = r.x + (scan.x[j] + M / 2) * sc;
          const cy = r.y + (scan.y[j] + M / 2) * sc;
          b.moveTo(cx + rad, cy);
          b.arc(cx, cy, rad, 0, Math.PI * 2);
        }
        b.stroke();
        b.fillStyle = 'rgba(255,255,255,0.55)';
        for (let j = 0; j < shown; j++) {
          const cx = r.x + (scan.x[j] + M / 2) * sc;
          const cy = r.y + (scan.y[j] + M / 2) * sc;
          b.fillRect(cx - 0.75, cy - 0.75, 1.5, 1.5);
        }
        b.restore();
        // footer: scale bar + materials legend
        const f = fs(c);
        const fy = r.y + r.w + 13;
        scaleBar(b, r.x + 2, fy, 25 * sc, '50 nm', f);
        const mats: [string, string, number][] = [
          ['gold', 'Au', MAT_PHASE.Au],
          ['tungsten', 'W', MAT_PHASE.W],
          ['copper', 'Cu', MAT_PHASE.Cu],
        ];
        const barW = 2 + 25 * sc + 5 + textW(b, '50 nm', f, 600);
        const legW = (long: boolean) => mats.reduce((acc, [lng, sh]) => acc + textW(b, long ? lng : sh, f, 500) + 20, 0);
        const useLong = barW + legW(true) + 8 <= r.w;
        const showLeg = barW + legW(false) + 8 <= r.w;
        let x = r.x + r.w;
        for (let k = showLeg ? mats.length - 1 : -1; k >= 0; k--) {
          const [lng, sh, ph] = mats[k];
          const name = useLong ? lng : sh;
          x -= textW(b, name, f, 500);
          haloText(b, name, x, fy, { size: f, baseline: 'middle', color: TOKENS.ink2, weight: 500 });
          x -= 12;
          const t = Math.round(((ph - phLo) / (phHi - phLo)) * 255);
          b.fillStyle = `rgb(${ICE[t * 3]},${ICE[t * 3 + 1]},${ICE[t * 3 + 2]})`;
          b.fillRect(x, fy - 4, 8, 8);
          x -= 8;
        }
        if (!manual.on && c.w >= 200) haloText(b, fitText(b, ['drag or use the arrow keys to aim the beam', 'drag to aim the beam'], r.w - 8, f - 0.5, 500), r.x + r.w - 4, r.y + r.w - 6, { size: f - 0.5, align: 'right', color: TOKENS.ink3, weight: 500 });
      }
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(smpBase, 0, 0);
      g.restore();
      // the beam (true probe intensity) at the highlighted position
      const [bx, by] = manual.on ? [manual.x, manual.y] : currentPos();
      g.save();
      g.beginPath();
      g.rect(r.x, r.y, r.w, r.h);
      g.clip();
      if (manual.on || stage !== 'done' || running) {
        g.globalCompositeOperation = 'lighter';
        spriteBmp.draw(g, { x: r.x + bx * sc, y: r.y + by * sc, w: M * sc, h: M * sc }, true);
        g.globalCompositeOperation = 'source-over';
      }
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(r.x + (bx + M / 2) * sc, r.y + (by + M / 2) * sc, rad, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    };
    // ------------------------------------------------------------------ drawing: detector
    const drawDetector = () => {
      const c = detC;
      const g = c.ctx;
      clear(c);
      const r = squareIn(c, 24, 24);
      const f = fs(c);
      let counts: Float32Array | null = null;
      if (manual.on) {
        computeManual();
        counts = manCounts;
      } else if (meas && meas.data.counts.length) {
        const j = stage === 'measure' ? meas.data.counts.length - 1 : Math.min(currentIdx(), meas.data.counts.length - 1);
        counts = meas.data.counts[j];
      }
      if (!counts) {
        g.fillStyle = TOKENS.panel;
        g.fillRect(r.x, r.y, r.w, r.h);
        return;
      }
      paintCounts(detBmp, counts, M, detHiLog || 1);
      detBmp.draw(g, r);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const sc = r.w / M;
      g.save();
      g.beginPath();
      g.rect(r.x, r.y, r.w, r.h);
      g.clip();
      // bright-field disc (the lens' own cone of light): dark underlay so the dashes show on the saturated disc
      g.beginPath();
      g.arc(cx, cy, PUPIL_R_PX * sc, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(5,8,14,0.75)';
      g.lineWidth = 3;
      g.stroke();
      g.setLineDash([4, 4]);
      g.strokeStyle = 'rgba(233,238,245,0.9)';
      g.lineWidth = 1.2;
      g.stroke();
      g.setLineDash([]);
      // dose-limited reach: where the mean count per pixel falls to 1
      const r1 = meas && meas.done ? meas.data.r1 : NaN;
      if (Number.isFinite(r1) && r1 > 0) {
        g.strokeStyle = accent;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx, cy, r1 * sc, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
      haloText(g, fitText(g, ["lens cone · bright field", "lens cone"], r.w - 6, f, 600), cx, cy - PUPIL_R_PX * sc - 4, { size: f, align: 'center', color: TOKENS.ink });
      if (meas && meas.done) {
        const reach = Number.isFinite(r1) ? r1 : M / 2;
        const t = fitText(
          g,
          Number.isFinite(r1)
            ? [`outside: <1 photon/pixel · detail <${halfPeriodNm(r1).toFixed(1)} nm`, 'outside: < 1 photon per pixel', 'outside: < 1 photon/pixel', '< 1 photon/pixel']
            : ['≥ 1 photon per pixel to the edge', '≥ 1 photon/pixel'],
          r.w - 6,
          f,
          600,
        );
        const ty = Math.min(r.y + r.h - 5, cy + reach * sc + (Number.isFinite(r1) ? 13 : -5));
        haloText(g, t, cx, ty, { size: f, align: 'center', color: accent });
      }
      if (manual.on) haloText(g, 'your beam', r.x + 5, r.y + 14, { size: f, color: accent });
      // footer
      const fy = r.y + r.w + 13;
      const th = angleMrad(M / 2).toFixed(0);
      const edge = fitText(
        g,
        [`camera edge: ${th} mrad ↔ ${GEOM.dxNm} nm detail`, `edge ${th} mrad ↔ ${GEOM.dxNm} nm detail`, `edge ↔ ${GEOM.dxNm} nm detail`],
        r.w + 8,
        f,
        500,
      );
      haloText(g, edge, r.x + r.w / 2, fy, { size: f, align: 'center', baseline: 'middle', color: TOKENS.ink2, weight: 500 });
    };

    // ------------------------------------------------------------------ drawing: reconstruction
    const drawRecon = () => {
      const c = recC;
      const g = c.ctx;
      clear(c);
      const r = squareIn(c, 24, 24);
      const f = fs(c);
      const sc = r.w / N;
      if (solver) {
        // global complex factor γ (phase offset / scale): refreshed every few frames, it drifts slowly
        if (++gamAge > 6) refreshGamma();
        const cmp = gam;
        const { re, im } = solver.O;
        for (let k = 0; k < litIdx.length; k++) {
          const i = litIdx[k];
          const a = cmp.gRe * re[i] - cmp.gIm * im[i];
          const b = cmp.gRe * im[i] + cmp.gIm * re[i];
          recPhase[i] = -Math.atan2(b, a);
        }
        paintPhase(recBmp, recPhase, phLo, phHi, fade, litIdx);
        recBmp.draw(g, r);
        // the recovered beam, inset top-right (over the unlit corner)
        const s = Math.round(r.w * 0.24);
        const ix = r.x + r.w - s - 3;
        const iy = r.y + 3;
        // the probe changes slowly: repaint the inset every third reconstruction frame
        if (++probeAge >= 3 || !running) {
          probeAge = 0;
          paintComplex(probeBmp, solver.P.re, solver.P.im, M, Math.atan2(cmp.gIm, cmp.gRe));
        }
        probeBmp.draw(g, { x: ix, y: iy, w: s, h: s }, true);
        g.strokeStyle = 'rgba(233,238,245,0.45)';
        g.lineWidth = 1;
        g.strokeRect(ix - 0.5, iy - 0.5, s + 1, s + 1);
        // label centred under the inset but kept inside the canvas
        const lab = fitText(g, ['recovered beam', 'beam'], Math.min(s * 1.7, 2 * (c.w - 4 - (ix + s / 2))), f - 0.5, 600);
        const lw = textW(g, lab, f - 0.5, 600);
        haloText(g, lab, Math.min(ix + s / 2, c.w - 4 - lw / 2), iy + s + 11, { size: f - 0.5, align: 'center', color: TOKENS.ink2 });
        // position being updated
        if (running && stage === 'solve' && solver.last >= 0) {
          const j = solver.last;
          g.save();
          g.strokeStyle = accent;
          g.globalAlpha = 0.8;
          g.lineWidth = 1.2;
          g.beginPath();
          g.arc(r.x + (scan.x[j] + M / 2) * sc, r.y + (scan.y[j] + M / 2) * sc, (PROBE_D_NM / GEOM.dxNm / 2) * sc, 0, Math.PI * 2);
          g.stroke();
          g.restore();
        }
      } else {
        paintPhase(recBmp, blankPhase, phLo, phHi, fade);
        recBmp.draw(g, r);
        const done = meas ? meas.next : 0;
        // reduced motion, results only: this frame stays up until the picture is solved, so no running count
        const msg = !motion.on ? 'measuring, then solving…' : `recording ${done} / ${scan.count} shots…`;
        haloText(g, msg, r.x + r.w / 2, r.y + r.h / 2, { size: f + 1, align: 'center', baseline: 'middle', color: TOKENS.ink2 });
      }
      // footer
      const fy = r.y + r.w + 13;
      const it = solver ? solver.iter : 0;
      const rn = resNow();
      const resTxt = !Number.isNaN(rn) ? fmtRes(rn) : '…';
      const e = (lastErr * 100).toFixed(0);
      const t = fitText(
        g,
        [`iteration ${it} · error ${e} % · detail ${resTxt}`, `error ${e} % · detail ${resTxt}`, `detail ${resTxt} · beam ${D_TXT} nm`, `detail ${resTxt}`],
        r.w + 8,
        f,
        500,
      );
      haloText(g, t, r.x + r.w / 2, fy, { size: f, align: 'center', baseline: 'middle', color: TOKENS.ink2, weight: 500 });
    };

    // ------------------------------------------------------------------ drawing: error plot
    const drawPlot = () => {
      const c = errC;
      const g = c.ctx;
      clear(c);
      const n = Math.max(run.errO.length, ghost ? ghost.errO.length : 0);
      const xMax = Math.max(40, Math.ceil((n + 4) / 20) * 20);
      const yTicks = [0.03, 0.1, 0.3, 1, 3];
      const fr = plotFrame(
        g,
        { x: 2, y: 22, w: c.w - 6, h: c.h - 24 },
        { min: 0, max: xMax, label: 'iteration' },
        { min: 0.03, max: 5, log: true, ticks: yTicks, label: c.h - 60 >= 150 ? 'error ε vs. the true chip (%)' : 'error ε (%)', format: (v) => `${Math.round(v * 100)}` },
      );
      // "blank guess" reference
      g.save();
      g.strokeStyle = 'rgba(183,195,210,0.35)';
      g.setLineDash([2, 4]);
      g.beginPath();
      g.moveTo(fr.x0, fr.py(1));
      g.lineTo(fr.x1, fr.py(1));
      g.stroke();
      g.restore();
      const f = fs(c);
      haloText(g, 'blank start', fr.x1 - 4, fr.py(1) - 4, { size: f - 0.5, align: 'right', color: TOKENS.ink3, weight: 500 });
      const xs = (k: number) => {
        const a = new Float64Array(k);
        for (let i = 0; i < k; i++) a[i] = i;
        return a;
      };
      if (ghost) line(g, fr, xs(ghost.errO.length), ghost.errO.map((v) => Math.max(0.031, Math.min(4.9, v))), TOKENS.old, 1.6, [5, 4]);
      if (run.errO.length) {
        const ys = run.errO.map((v) => Math.max(0.031, Math.min(4.9, v)));
        if (solver && stage === 'solve' && solver.k > 0) {
          ys.push(Math.max(0.031, Math.min(4.9, lastErr)));
        }
        const xx = xs(ys.length);
        if (solver && stage === 'solve' && solver.k > 0) xx[ys.length - 1] = solver.iter + solver.k / scan.count;
        line(g, fr, xx, ys, accent, 2.4);
        const lx = fr.px(xx[ys.length - 1]);
        const ly = fr.py(ys[ys.length - 1]);
        g.fillStyle = accent;
        g.beginPath();
        g.arc(lx, ly, 3.5, 0, Math.PI * 2);
        g.fill();
      }
      // legend (top-right, inside the frame)
      const variants = (pre: string, l: string[]) => [...l.map((x) => `${pre}: ${x}`), ...l.slice(-2), l[l.length - 1].split(' · ')[0]];
      const items: [string[], string, boolean][] = [[variants('now', run.label), accent, false]];
      if (ghost) items.push([variants('before', ghost.label), TOKENS.old, true]);
      let ly = fr.y1 + 12;
      const maxW = fr.x1 - fr.x0 - 34;
      for (const [txts, col, dash] of items) {
        const t = fitText(g, txts, maxW, f, 500);
        const tw = textW(g, t, f, 500);
        const x = fr.x1 - tw - 6;
        g.save();
        g.strokeStyle = col;
        g.lineWidth = 2;
        g.setLineDash(dash ? [4, 3] : []);
        g.beginPath();
        g.moveTo(x - 22, ly - 4);
        g.lineTo(x - 5, ly - 4);
        g.stroke();
        g.restore();
        haloText(g, t, x, ly, { size: f, color: col === TOKENS.old ? TOKENS.ink2 : TOKENS.ink, weight: 500 });
        ly += f + 6;
      }
    };

    // ------------------------------------------------------------------ captions
    let capKey = '';
    function refreshCaption() {
      const ov = overlapOf(par.stepNm);
      const ovPct = Math.round(ov * 100);
      const it = solver ? solver.iter : 0;
      const ph = nPh();
      const lowOv = ov < 0.55;
      const lowDose = ph < 1.5e5;
      let key: string;
      if (manual.on && dragging) key = 'manual';
      else if (stage === 'measure') key = 'measure';
      else if (it < 6) key = 'early';
      // judged on the result, not the slider: a ~50 % overlap scan can still get there, just slowly
      else if (lowOv && lastErr >= 0.4) key = 'overlap';
      else if (lowDose) key = 'dose';
      else key = lastErr < 0.3 || (lastErr < 0.45 && it >= 15) ? 'good' : 'solving';
      const rn = resNow();
      const res = !Number.isNaN(rn) ? fmtRes(rn) : '';
      // live numbers in the text (iteration, ε, resolution) are re-rendered in coarse steps, not every frame
      const live = key === 'good' ? `${res}|${it >> 3}|${Math.round(lastErr * 50)}` : key === 'early' || key === 'solving' || key === 'overlap' ? `${it >> 2}|${Math.round(lastErr * 50)}` : key === 'dose' ? `${lastErr > 1 ? 1 : 0}|${res}` : '';
      const full = `${key}|${ovPct}|${par.src}|${Math.round(Math.log10(ph) * 10)}|${live}|${ghost ? 1 : 0}`;
      if (full === capKey) return;
      capKey = full;
      const d = PROBE_D_NM.toFixed(0);
      const r1 = meas && meas.done ? meas.data.r1 : NaN;
      let v = '';
      const err = (lastErr * 100).toFixed(0);
      const misfit = solver && solver.errF.length && meas ? `. The pattern misfit is ${eNum(solver.errF[solver.errF.length - 1])}, compared with a photon-noise floor of ${eNum(noiseFloor(meas.data))}` : '';
      switch (key) {
        case 'manual':
          v = `You are aiming the beam. The speckle pattern is shown for this beam position. The bright disc is the bright field: X-rays transmitted within the lens's cone, which form a blurred shadow image. Fine structures in the chip scatter X-rays outside this disc. Finer structures scatter to wider angles. The detector's edge is ${angleMrad(M / 2).toFixed(0)} mrad from the centre and corresponds to 2 nm detail.`;
          break;
        case 'measure':
          v = `The X-ray beam is ${d} nm wide because the chip is 1.5 µm beyond the focus of a zone-plate lens with 4 nm outer rings. At each of ${scan.count} positions, a diffraction pattern of ~${sci(ph)} photons is recorded. These measurements record scattered intensity rather than a focused image. A computer reconstructs the image from the overlapping measurements.`;
          break;
        case 'early':
        case 'solving':
          v = `The solver starts from a blank image and adjusts its estimates of the image and beam until their predicted patterns agree with the recorded patterns. The method is ePIE, the extended ptychographic iterative engine. It updates one exposure at a time. The beam is ${d} nm wide, but the widest scattering angle with enough recorded photons determines the finest detail. At iteration ${it}, the error is ${err} %.`;
          break;
        case 'overlap':
          v = `At ${ovPct} % overlap, adjacent exposures share too little information to distinguish the beam profile from the chip. Stripes and blurring appear in the reconstructed image. The recorded patterns fit about as well as in a successful reconstruction${misfit}, while the image error stays near ${err} %. Agreement with the measurements alone does not guarantee the correct image. Reduce the step until adjacent exposures overlap by about 60 % or more.`;
          break;
        case 'dose':
          v = `${par.src === 'aps' ? 'Pre-upgrade coherent flux is ~100× lower' : 'This exposure is very short'}, with about ${sci(ph)} photons per exposure. At outer detector pixels, few photons are recorded from the finest structures${Number.isFinite(r1) ? `. Beyond ${halfPeriodNm(r1).toFixed(1)} nm detail, the mean count is below 1 photon per pixel. Counts from overlapping exposures add together, so this is not a hard cutoff` : ''}. The reconstructed image is noisy and blurred.${lastErr > 1 ? ' Here the noise exceeds the chip\'s faint contrast, and the error is greater than for the blank initial image.' : ''} Scattering typically falls as the fourth power of the angle, so 10× finer detail needs ~10^{4}× more photons. ${par.src === 'aps' ? 'Switch to APS-U.' : 'Increase the exposure.'}`;
          break;
        default:
          v =
            par.src === 'apsu'
              ? `The reconstruction resolves ${res || 'nanometre-scale'} detail with a ${d} nm beam. The error is ${err} %, and the detector pixels allow 2 nm detail. Wide-angle scattering determines the resolution, and With APS-U, enough photons are recorded at those angles. The focused lens resolution is ≈5 nm. PtychoProbe aims for ~1 nm on samples that tolerate the dose.${lowOv ? ' The low overlap made this reconstruction slow.' : ''} Try APS before upgrade or a larger step.`
              : `The reconstruction has error ${err} % and detail ${res || 'coarse'}. Equal photon counts required ${fmtDwell(par.dwellUs)} per exposure before the upgrade and ${fmtDwell(par.dwellUs / 100)} with APS-U. A chip-sized scan that takes APS-U a minute would have taken well over an hour.`;
      }
      station.setCaption(v);
    }

    // ------------------------------------------------------------------ readouts
    const refreshReadouts = () => {
      const rn = resNow();
      rRes.set(!Number.isNaN(rn) ? fmtRes(rn) : stage === 'measure' ? 'recording…' : 'solving…');
      if (solver && solver.errF.length && meas) {
        const rf = solver.errF[solver.errF.length - 1];
        const fl = noiseFloor(meas.data);
        rRF.set(fl > 0 ? `${(rf / fl).toFixed(1)}× noise floor` : eNum(rf));
        rRF.el.title = `R_F = ${eNum(rf)} measures the difference between predicted and recorded diffraction patterns. Photon noise alone would give ${eNum(fl)}.`;
      } else rRF.set('…');
    };

    // ------------------------------------------------------------------ main loop
    const onIteration = () => {
      if (!solver) return;
      refreshGamma();
      lastRes = frc.measure(solver.O, gam.gRe, gam.gIm);
      run.errO.push(gam.err);
      run.res.push(lastRes);
    };

    let lastReadout = 0;
    /** smoothed drawing cost per frame (ms) */
    let drawMs = 4;
    let frameNo = 0;
    /** adaptive solver budget (ms per frame), driven by the real frame interval (drawing + browser overhead) */
    let solveMs = 8;
    loop(station, (dt) => {
      const t0 = performance.now();
      frameNo++;
      // keep ≥ 30 fps on slow machines: the frame interval includes compositing that drawMs cannot see
      const frameMs = dt * 1000;
      if (frameMs > SLOW_FRAME_MS) solveMs = Math.max(2, solveMs * 0.8);
      else if (frameMs < FAST_FRAME_MS) solveMs = Math.min(11, solveMs + 0.3);
      // reduced motion, results only: nothing is drawn until the run ends, so the solver may use most of the frame
      const holding = !motion.on && running && stage !== 'done' && !manual.on;
      const BUDGET_MS = holding ? 30 : Math.max(2, Math.min(solveMs, FRAME_MS - drawMs));
      if (manual.on && !dragging && t0 > manual.until) {
        manual.on = false;
        dirtyAll();
        refreshCaption();
      }
      if (running && meas) {
        if (stage === 'measure') {
          const cap = Math.max(1, Math.ceil(scan.count / 14));
          let k = 0;
          while (!meas.done && k < cap && performance.now() - t0 < BUDGET_MS) {
            const j = meas.step();
            if (j === 0 && detHiLog <= 0) detHiLog = hiLogOf(means.mean1[0], meas.data.nPh);
            k++;
          }
          if (meas.done) {
            startSolver();
            showNext = true; // results only: show the finished scan once
          }
          dirty.smp = dirty.det = dirty.rec = true;
        } else if (stage === 'solve' && solver) {
          while (performance.now() - t0 < BUDGET_MS) {
            solver.step(1);
            if (solver.k === 0) {
              onIteration();
              dirty.err = true;
              if (!motion.on && HOLD_MILESTONES.includes(solver.iter)) showNext = true;
              if (solver.iter >= iterTarget) {
                stage = 'done';
                running = false;
                syncRunButton();
                break;
              }
            }
          }
          dirtyAll();
        }
      }
      const td = performance.now();
      const solving = running && stage === 'solve';
      // reduced motion: while recording and solving, the panels hold until the result (or input) arrives
      const hold = !motion.on && running && stage !== 'done' && !manual.on && !showNext;
      showNext = false;
      if (hold) {
        if (t0 - lastReadout > 150) {
          lastReadout = t0;
          refreshReadouts();
          refreshCaption();
        }
        return;
      }
      // while solving, the reconstruction (the costliest panel) is repainted every other frame
      // and the camera on the frames in between
      if (dirty.rec && solving && frameNo % 2 === 1) dirty.rec = false;
      if (dirty.det && solving && !manual.on && frameNo % 2 === 0) dirty.det = false;
      const any = dirty.smp || dirty.det || dirty.rec || dirty.err || solving;
      if (dirty.smp) drawSample();
      if (dirty.det) drawDetector();
      if (dirty.rec) drawRecon();
      if (dirty.err || solving) drawPlot();
      if (any) drawMs = 0.9 * drawMs + 0.1 * (performance.now() - td);
      dirty = { smp: false, det: false, rec: false, err: false };
      if (t0 - lastReadout > 150) {
        lastReadout = t0;
        refreshReadouts();
        refreshCaption();
      }
    });

    // a resize clears a canvas: redraw it even while reduced motion holds the panels
    for (const c of [smpC, detC, recC, errC])
      c.onResize(() => {
        dirtyAll();
        showNext = true;
      });

    // ------------------------------------------------------------------ boot
    applyLayout();
    updateFade();
    remeasure();
    refreshReadouts();

    return {
      destroy: () => station.destroy(),
    };
  },
};

export default mod;
