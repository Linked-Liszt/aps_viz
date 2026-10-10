/**
 * Station "Strain inside a nanocrystal" — Bragg coherent diffraction imaging (BCDI) at ATOMIC (34-ID-F).
 *
 * Three linked views of one experiment:
 *   1. the crystal: a faceted Au nanocrystal whose atoms are displaced by u(r) (choose the cause and its strength);
 *      colour = φ = G·u, the projection of the displacement on the Bragg vector G, and the lattice planes that this
 *      reflection sees drawn with spacing and displacement magnified ×PLANE_MAG;
 *   2. the detector: |A(Δq)|² around the Bragg peak with Poisson noise for the chosen source (APS vs APS-U) and
 *      exposure — centro-symmetric for any unstrained crystal (Friedel), lopsided once strain varies inside;
 *   3. the computer: live HIO/ER + shrink-wrap phase retrieval from the noisy intensities alone, budgeted a few
 *      iterations per frame, with a data-only "stuck → new random start" rule and a convergence plot.
 *
 * All physics, equations, parameter values and sources are documented in ./bcdi/physics.ts (forward model, fields,
 * coherent-flux estimate, ATOMIC specs) and ./bcdi/phasing.ts (algorithms). Illustrative elements (photon scale,
 * phenomenological surface field, gauge-mapped core–shell field, 2D instead of 3D) are labelled as such in the
 * specialist text.
 */
import type { Depth } from '../../app/store';
import type { ExplainerModule } from './registry';
import { TOKENS, button, canvas2d, createStation, group, label, line, loop, lut, motionGate, note, plotFrame, readout, slider, toggle, type Canvas2D, type SliderHandle } from './kit';
import {
  BraggSim,
  CRYSTAL_WIDTH,
  COHERENT_GAIN,
  DEFAULT_FIELD,
  DET_DIST,
  DQ,
  DX,
  N,
  NU,
  ALPHA_AU,
  OVERSAMPLING,
  PHOTON_RATE,
  PLANE_MAG,
  REFLECTIONS,
  burgers,
  chord,
  dislocationAt,
  gauge,
  phaseFn,
  sdist,
  type FieldParams,
  type Mode,
  type PhaseFn,
  type ReflId,
} from './bcdi/physics';
import { DECIDE_AT, PR_ITERS, PhaseRetriever, STUCK_RATIO, align, algoAt, applyAlignment, noiseFloor, type Alignment } from './bcdi/phasing';
import { Layer, phaseCss, renderAsym, renderCounts, renderField, type FieldView, type Sampler } from './bcdi/render';

// ───────────────────────────────────────────────────────────────── configuration

type Src = 'aps' | 'apsu';
type DetView = 'intensity' | 'asym';
type SupportMode = 'shrink' | 'known';

interface State {
  mode: Mode;
  eps: number;
  kappa: number;
  misfit: number;
  u0: number;
  dislP: number;
  disl: [number, number];
  refl: ReflId;
  src: Src;
  exposure: number;
  view: DetView;
  support: SupportMode;
  planes: boolean;
}

const DEFAULTS: Omit<State, 'disl'> = {
  mode: 'dislocation',
  eps: 0.0015,
  kappa: 5e-6,
  misfit: 0.0015,
  u0: 0.4,
  dislP: -0.25,
  refl: '111',
  src: 'apsu',
  exposure: 0.1,
  view: 'intensity',
  support: 'shrink',
  planes: true,
};

/** Parameter limits chosen inside the regime where HIO/ER + shrink-wrap converges reliably (see tests). */
const LIM = { eps: 0.003, kappa: 5e-6, misfit: 0.002, u0: 0.6 };
/** real-space field of view (nm) of the crystal and reconstruction panels */
const FOV = 450;
const VIEW: FieldView = { cx: 0, cy: 0, fov: FOV };
/** detector colour scale: 1 … 10^LOG_MAX photons */
const LOG_MAX = 7;
const MAX_ATTEMPTS = 3;
const REFL_IDS: ReflId[] = ['111', '-1-11', '002'];

const MODES: { id: Mode; name: string }[] = [
  { id: 'perfect', name: 'Perfect' },
  { id: 'expanded', name: 'Expanded' },
  { id: 'bent', name: 'Bent' },
  { id: 'coreshell', name: 'Core–shell' },
  { id: 'dislocation', name: 'Dislocation' },
  { id: 'surface', name: 'Surface' },
];

const MODE_TEXT: Record<Mode, { v: string; s: string }> = {
  perfect: {
    v: '**A flawless crystal.** Every row of atoms sits exactly where it belongs: the colour is even and the planes are straight.',
    s: '**u = 0.** ρ real ⇒ A(−q) = A(q)^{∗} ⇒ I(q) = I(−q) for *any* shape (Friedel). Streaks run ⟂ to each facet; fringe period 2π/L.',
  },
  expanded: {
    v: '**Heated or cooled.** Every row of atoms moves apart (or together) by the same tiny amount, so the planes simply spread evenly. The colours repeat because X-rays cannot tell a shift of exactly one row from no shift at all.',
    s: '**Uniform strain** u = ε(r − r_{c}) ⇒ φ = εG·r: a linear phase ramp. The peak moves to Δq = −εG but stays centro-symmetric — all that ordinary diffraction sees is ⟨d⟩.',
  },
  bent: {
    v: '**Bent like a bow.** One side is stretched, the other squeezed, so the rows of atoms curve.',
    s: '**Pure bending** u_{x} = −κxy, u_{y} = ½κ(x² + νy²): strain gradient ∂ε_{xx}/∂y = −κ plus lattice rotation κx. φ is quadratic and *even* in r, so on a centro-symmetric crystal it would split/broaden the peak but keep I(q) = I(−q); the weak asymmetry here comes from the substrate-truncated shape. Odd-parity fields (core–shell, surface, off-centre dislocation) are what make patterns strongly lopsided. Capped at R ≥ 200 µm: stronger phase curvature defeats this phasing scheme.',
  },
  coreshell: {
    v: '**A core of slightly different atoms**, like silver inside a gold shell. The core pushes (or pulls) on its shell.',
    s: '**Misfitting core** (eigenstrain ε_{m}, plane stress, equal moduli): uniform dilatation inside, u = Br + C/r in the shell (Lamé solution, mapped onto the facets — illustrative). Ag core in Au: ε_{m} ≈ +0.18 %. Mean strain = mean eigenstrain (traction-free body), so the peak also shifts a little.',
  },
  dislocation: {
    v: '**An extra half-plane of atoms** (the ⊥) — the defect that lets metals bend without breaking. Drag it around inside the crystal!',
    s: '**Edge dislocation** b = ½[110], line ∥ [1̅ 10] (Lomer-type, glide plane (001); isotropic infinite-medium field, Hirth & Lothe). φ winds by G·b = 2πn around the core: n = 1 for 111, −1 for 1̅ 1̅ 1. Pick 002: G·b = 0 and the vortex vanishes — but here G_{002} ∥ b × l, so the dilatational part (u_{y′}) still shows: G·b = 0 alone does not make an edge dislocation invisible.',
  },
  surface: {
    v: '**Molecules stuck to the surface** (as in catalysis or sensing) tug on the outer atoms; the strain gathers at edges and corners.',
    s: '**Surface relaxation** (phenomenological) u = u_{0}Σ_{f} n_{f} e^{−d_{f}/λ}, λ = 15 nm, substrate pinned. Cf. thiol-induced edge strain in Au, Watari et al., Nat. Mater. 2011 (APS 34-ID-C).',
  },
};

// ───────────────────────────────────────────────────────────────── formatting

const SUPS: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
/** mantissa (1 decimal) and exponent, with 9.96 → 1.0×10^{e+1} handled */
function mantExp(v: number): [string, number] {
  let e = Math.floor(Math.log10(Math.abs(v)));
  let m = (v / 10 ** e).toFixed(1);
  if (Math.abs(+m) >= 10) {
    e++;
    m = (v / 10 ** e).toFixed(1);
  }
  return [m, e];
}
function sci(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) < 1000) return v >= 100 ? v.toFixed(0) : +v.toPrecision(2) + '';
  const [m, e] = mantExp(v);
  return `${m}×10${String(e).split('').map((c) => SUPS[c] ?? c).join('')}`;
}
function sciMd(v: number): string {
  if (Math.abs(v) < 1000) return sci(v);
  const [m, e] = mantExp(v);
  return `${m}×10^{${e}}`;
}
/** fixed 3 decimals without a negative zero, with a true minus sign */
const f3 = (v: number) => (Math.abs(v) < 5e-4 ? '0.000' : v < 0 ? `−${(-v).toFixed(3)}` : v.toFixed(3));
function fmtTime(s: number): string {
  if (s < 1e-3) return `${(s * 1e6).toFixed(0)} µs`;
  if (s < 1) return s < 0.01 ? `${(s * 1e3).toFixed(1)} ms` : `${(s * 1e3).toFixed(0)} ms`;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : s.toFixed(0)} s`;
  if (s < 3600) return `${(s / 60).toFixed(s < 600 ? 1 : 0)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
function fmtNm(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v < 10 ? `${v.toFixed(1)} nm` : `${v.toFixed(0)} nm`;
}
/** keep numbers and their units on one line in flowing text */
const nbsp = (t: string) => t.replace(/(\d) (?=(%|nm|ms|µs|s|min|h|µm|keV|Å|rad)(?![A-Za-z]))/g, '$1\u00a0');
const signed = (v: number, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ───────────────────────────────────────────────────────────────── local styles

const CSS = `
.bcdi-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.bcdi-mode{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 2px 5px;border-radius:9px;border:1px solid rgba(150,180,220,.16);background:rgba(255,255,255,.035);color:#8394a9;font:600 11px var(--font, system-ui);cursor:pointer;min-width:0;transition:border-color .15s,background .15s,color .15s}
.bcdi-mode canvas{width:40px;height:40px;display:block}
.bcdi-mode span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.bcdi-mode:hover{border-color:color-mix(in oklab,var(--c,#5cd3ff) 60%,transparent);color:#e9eef5}
.bcdi-mode[aria-pressed=true]{background:color-mix(in oklab,var(--c,#5cd3ff) 18%,transparent);border-color:var(--c,#5cd3ff);color:#fff}
.bcdi-mode:focus-visible,.bcdi-row .stn-btn:focus-visible{outline:2px solid var(--c,#5cd3ff);outline-offset:1px}
.bcdi-row{display:flex;gap:6px;flex-wrap:wrap}
.bcdi-row .stn-btn{flex:1 1 auto}
.stn[data-depth=visitor] .bcdi-spec{display:none}
.bcdi-root.stn-stack .stn-controls{display:block;columns:2 220px;column-gap:16px;padding-bottom:4px}
.bcdi-root.stn-stack .stn-group{break-inside:avoid;margin-bottom:18px}
.bcdi-root.stn-side .stn-visual{align-content:center}
.bcdi-root .stn-readout-value{white-space:nowrap}
.bcdi-root .stn-canvas-label{right:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bcdi-root[data-depth=specialist] .stn-canvas-label{text-transform:none;letter-spacing:.04em}
.bcdi-flash{animation:bcdi-flash 1.4s ease-out}
.bcdi-overlay-btn{position:absolute;z-index:2;font:600 11.5px var(--font,system-ui);padding:5px 11px;border-radius:999px;border:1px solid var(--c,#5cd3ff);background:color-mix(in oklab,var(--c,#5cd3ff) 26%,rgba(8,12,20,.88));color:#fff;cursor:pointer;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.5)}
.bcdi-overlay-btn:hover{background:color-mix(in oklab,var(--c,#5cd3ff) 45%,rgba(8,12,20,.88))}
.bcdi-overlay-btn:focus-visible{outline:2px solid #fff;outline-offset:2px}
@keyframes bcdi-flash{0%{box-shadow:inset 0 0 0 2px var(--c,#5cd3ff)}100%{box-shadow:inset 0 0 0 2px transparent}}
`;

// ───────────────────────────────────────────────────────────────── station

const mod: ExplainerModule = {
  title: 'Strain inside a nanocrystal',
  subtitle: 'Bend, squeeze or break a gold nanocrystal, watch its X-ray pattern change — then let the computer rebuild the crystal from the pattern alone.',
  mount(host, ctx) {
    const station = createStation(host, { depth: ctx.depth, color: ctx.color, layout: 'side' });
    const accent = ctx.color || TOKENS.xray;
    station.root.classList.add('bcdi-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    station.root.appendChild(style);
    const dual = (v: string, s: string) => (station.depth === 'specialist' ? s : v);

    // ── simulation objects (all buffers preallocated here)
    const sim = new BraggSim();
    const shape = sim.shape;
    const pr = new PhaseRetriever(sim.fft);
    const n2 = N * N;
    const estRe = new Float64Array(n2);
    const estIm = new Float64Array(n2);
    const dispRe = new Float64Array(n2);
    const dispIm = new Float64Array(n2);
    const dispSup = new Uint8Array(n2);
    const matchHist = new Float32Array(PR_ITERS).fill(NaN);
    const al: Alignment = { match: 0, twin: false, sx: 0, sy: 0, phase: 0 };
    const truth = { re: sim.objRe, im: sim.objIm, norm: 0, com: [0, 0] as [number, number], idx: sim.truthIdx };

    const st: State = { ...DEFAULTS, disl: dislocationAt(shape, DEFAULTS.dislP) };
    let phi: PhaseFn = () => 0;
    let fieldDirty = true;
    let dataDirty = true;
    let noiseSeed = 1;
    let floor = 1;
    /** time of the last continuous edit (slider move / drag): while recent, the expensive extras are deferred */
    let lastEdit = -Infinity;
    const edit = () => {
      lastEdit = performance.now();
    };
    /** Friedel/resolution analysis skipped during an edit, to be done once the input settles */
    let analysisStale = false;
    /** the crystal image was last rendered at the reduced (interactive) resolution */
    let truthLowRes = false;

    // reconstruction controller
    type RPhase = 'waiting' | 'running' | 'paused' | 'done';
    const rc = {
      phase: 'waiting' as RPhase,
      attempt: 1,
      seed: 1,
      restartAt: 0,
      ghosts: [] as Float32Array[],
      stuckFlash: -Infinity,
      ampRef: 1,
      everStuck: false,
      lastCaption: 0,
    };
    /** reduced motion: draw the first frame of a rebuild (its "rebuilding…" state), then hold until it is done */
    let showRun = false;

    // ── visual panels
    // non-empty labels so the kit creates the label element (texts are set per depth in setPanelLabels)
    const cvT = canvas2d(station.visual, { label: 'The crystal' });
    const cvD = canvas2d(station.visual, { label: 'X-ray pattern' });
    const cvR = canvas2d(station.visual, { label: 'Rebuilt by computer' });
    const cvC = canvas2d(station.visual, { label: 'Progress' });
    const wrapOf = (c: Canvas2D) => c.canvas.parentElement as HTMLElement;
    const labelEl = (c: Canvas2D) => wrapOf(c).querySelector('.stn-canvas-label') as HTMLElement | null;
    const setPanelLabels = () => {
      const L: [Canvas2D, string, string][] = [
        [cvT, '1 · The crystal', '1 · Object ρ·exp(iG·u)'],
        [cvD, '2 · X-ray pattern', '2 · Detector  |A(Δq)|²'],
        [cvR, '3 · Rebuilt by computer', '3 · Phase retrieval'],
        [cvC, 'Progress', 'Convergence'],
      ];
      for (const [c, v, s] of L) {
        const e = labelEl(c);
        if (e) e.textContent = dual(v, s);
        c.canvas.setAttribute('aria-label', dual(v, s));
      }
    };
    setPanelLabels();
    cvD.canvas.style.cursor = 'crosshair';
    cvR.canvas.style.cursor = 'crosshair';
    // "Rebuild again" right where the reconstruction is shown (positioned in drawRec)
    const recBtn = document.createElement('button');
    recBtn.type = 'button';
    recBtn.className = 'bcdi-overlay-btn';
    recBtn.addEventListener('click', () => startRecon());
    wrapOf(cvR).appendChild(recBtn);

    const layers = { truth: new Layer(256), det: new Layer(N), rec: new Layer(200) };
    let truthDirty = true;
    let detDirty = true;
    let recDirty = true;
    let recFull = false;
    const dirty = { t: true, d: true, r: true, c: true };
    const markAll = () => {
      dirty.t = dirty.d = dirty.r = dirty.c = true;
    };
    // a resized canvas is cleared, so it must be redrawn; the offscreen layers re-render only if their size changes
    // (drawTruth/drawRec resize them), so a chart-only resize no longer re-renders the crystal images
    cvT.onResize(() => (dirty.t = true));
    cvD.onResize(() => (dirty.d = true));
    // a resize clears a canvas: redraw it even while reduced motion holds panels 3 and 4
    cvR.onResize(() => {
      dirty.r = true;
      showRun = true;
    });
    cvC.onResize(() => {
      dirty.c = true;
      showRun = true;
    });

    // ── layout: side (controls right) when the host is wide, stacked otherwise; 3 or 2 panel columns
    let layoutDirty = true;
    const place = (c: Canvas2D, col: string, row: string) => {
      const w = wrapOf(c);
      w.style.gridColumn = col;
      w.style.gridRow = row;
    };
    /** smallest image panel (px) worth showing beside the controls; below it the station stacks and scrolls */
    const MIN_TILE = 200;
    /** gap between the panels (px), and the progress chart's height range in the three-column layout */
    const GAP = 6;
    const CHART_MIN = 150;
    const CHART_MAX = 260;
    // the rows below size every panel; the kit's default panel minimum (160 px) would only let one spill out of its
    // row, over the caption (e.g. a 150 px chart row on a phone)
    for (const c of [cvT, cvD, cvR, cvC]) wrapOf(c).style.minHeight = '0';
    /** the image row carries ~60 px of panel label above and colour bar + ticks below the square image */
    const TILE_EXTRA = 60;
    /**
     * Side by side, neither column may set the row height. In the full-screen dialog the host grows with its content
     * (`flex: 1 0 auto`), so a 1500 px controls column, or panel rows fitted to an earlier, taller measurement (e.g.
     * before the caption was written, or before it grew by a line), would stretch the station past the dialog and
     * push the caption out of view. height 0 + min-height 100% fills the row the host leaves above the caption,
     * whatever the column holds (the controls scroll within it; the panel rows are fitted to it in relayout).
     */
    const fillRow = (e: HTMLElement, side: boolean) => {
      e.style.height = side ? '0' : '';
      e.style.minHeight = side ? '100%' : '';
    };
    /** side by side (controls right) or stacked (pictures, caption, controls) */
    const applyMode = (stack: boolean) => {
      const root = station.root;
      root.classList.toggle('stn-stack', stack);
      root.classList.toggle('stn-side', !stack);
      // pinned inline so the kit's viewport media query cannot contradict the host-width decision; in stacked mode the
      // rows must keep their content height (the root scrolls when the host has a fixed height, e.g. a modal on a phone)
      root.style.gridTemplateColumns = stack ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 250px';
      root.style.gridTemplateRows = stack ? 'max-content max-content max-content' : 'minmax(0, 1fr) auto';
      root.style.overflowY = stack ? 'auto' : '';
      station.controls.style.overflowY = stack ? 'visible' : '';
      fillRow(station.controls, !stack);
      fillRow(station.visual, !stack);
      // stacked: "what you are seeing" sits right under the pictures, the controls follow
      station.caption.style.gridRow = stack ? '2' : '';
      station.controls.style.gridRow = stack ? '3' : '';
      station.caption.style.borderBottom = stack ? '1px solid rgba(150,180,220,.12)' : '';
    };
    /**
     * Side by side needs width (≥ 700 px) and enough height for MIN_TILE panels next to the 250 px controls column;
     * otherwise stack (pictures full width, controls below, the panel or station scrolls) instead of shrinking the
     * pictures to thumbnails, e.g. in a tablet's bottom sheet (host ~750 × 430).
     * The height is always measured side by side, when neither column sets it (fillRow): a host that fills a sized
     * container (the full-screen dialog, the harness) then measures the space it is given, and one that only has a
     * min-height (the panel) about that min-height. A stacked station grows with its content, so it is laid out side
     * by side for the measurement; relayout applies the decided mode in the same task, before anything is painted or
     * observed. Measuring the same layout every time keeps the decision stable, and a station stacked on a short
     * screen goes back side by side once the screen is tall enough again.
     */
    const sideFits = (W: number): boolean => {
      if (W < 700) return false;
      if (!station.root.classList.contains('stn-side')) applyMode(false);
      const H = Math.max(parseFloat(getComputedStyle(host).minHeight) || 0, host.clientHeight);
      const vw = W - 250 - 16; // visual column minus its padding
      const vh = H - Math.max(48, station.caption.getBoundingClientRect().height) - 16;
      const tile = vw >= 620 ? Math.min((vw - 2 * GAP) / 3, vh - CHART_MIN - GAP - TILE_EXTRA) : Math.min((vw - GAP) / 2, (vh - GAP) / 2 - 58);
      return tile >= MIN_TILE;
    };
    const relayout = () => {
      layoutDirty = false;
      const W = host.clientWidth || 800;
      const stack = !sideFits(W);
      applyMode(stack);
      const vis = station.visual;
      const vw = Math.max(200, vis.clientWidth - 16);
      const gap = GAP;
      if (vw >= 620) {
        vis.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
        place(cvT, '1', '1');
        place(cvD, '2', '1');
        place(cvR, '3', '1');
        place(cvC, '1 / -1', '2');
        const col = (vw - 2 * gap) / 3;
        if (stack) vis.style.gridTemplateRows = `${Math.round(col + TILE_EXTRA)}px 170px`;
        else {
          // image row sized to the square panels, or to what the height leaves after the chart's minimum; the chart
          // takes the rest up to CHART_MAX. Any slack is split above and below so the group sits centred. (The visual
          // area's height comes from the host, not from these rows: see fillRow.)
          const vh = vis.clientHeight - 16;
          const top = Math.max(0, Math.floor(Math.min(col + TILE_EXTRA, vh - CHART_MIN - gap)));
          const ch = Math.max(0, Math.floor(Math.min(vh - top - gap, CHART_MAX)));
          vis.style.gridTemplateRows = `${top}px ${ch}px`;
        }
      } else if (vw < 400) {
        // phone width: crystal and pattern side by side, the rebuilt crystal (the pay-off) and the chart full width
        vis.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        place(cvT, '1', '1');
        place(cvD, '2', '1');
        place(cvR, '1 / -1', '2');
        place(cvC, '1 / -1', '3');
        const col = (vw - gap) / 2;
        vis.style.gridTemplateRows = `${Math.round(col + 58)}px ${Math.round(col * 1.45 + 58)}px 150px`;
      } else {
        vis.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        place(cvT, '1', '1');
        place(cvD, '2', '1');
        place(cvR, '1', '2');
        place(cvC, '2', '2');
        const col = (vw - gap) / 2;
        vis.style.gridTemplateRows = stack ? `${Math.round(col + 58)}px ${Math.round(col + 58)}px` : 'minmax(0, 1fr) minmax(0, 1fr)';
      }
    };
    // the station starts side by side, so the visual area fills its row from the first measurement on (otherwise the
    // host would first be measured stretched around four default-height panels)
    applyMode(false);
    relayout();
    const markLayout = () => {
      layoutDirty = true;
    };
    const ro = new ResizeObserver(markLayout);
    ro.observe(host);
    // the visual area also shrinks when the caption grows by a line or two (a fixed-height host gives the caption's
    // extra lines to it): re-fit the panel rows then, or the chart would spill under the caption. Converges in one
    // pass — relayout only rewrites rows that depend on the visual's size, not the other way round.
    ro.observe(station.visual);
    // a stacked station in the full-screen dialog is as tall as its content, so its host does not resize when the
    // window grows taller: re-check then whether it fits side by side again
    addEventListener('resize', markLayout);
    station.onDestroy(() => {
      ro.disconnect();
      removeEventListener('resize', markLayout);
    });

    // ── controls ─────────────────────────────────────────────────────────────────────────────────────────
    const titles: [HTMLElement, string, string][] = [];
    const mkGroup = (v: string, s: string) => {
      const g = group(station.controls, v);
      const t = g.querySelector('.stn-group-title') as HTMLElement;
      titles.push([t, v, s]);
      return g;
    };
    const relabel: (() => void)[] = [];

    // 1 · crystal
    const g1 = mkGroup('1 · Choose the crystal', '1 · Displacement field u(r)');
    const modeWrap = document.createElement('div');
    modeWrap.className = 'bcdi-modes';
    modeWrap.setAttribute('role', 'group');
    modeWrap.setAttribute('aria-label', 'What is happening inside the crystal');
    g1.appendChild(modeWrap);
    const modeBtns = new Map<Mode, { btn: HTMLButtonElement; cv: HTMLCanvasElement }>();
    for (const m of MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bcdi-mode';
      b.setAttribute('aria-pressed', String(m.id === st.mode));
      const c = document.createElement('canvas');
      c.setAttribute('aria-hidden', 'true');
      const sp = document.createElement('span');
      sp.textContent = m.name;
      b.append(c, sp);
      b.addEventListener('click', () => setMode(m.id));
      modeWrap.appendChild(b);
      modeBtns.set(m.id, { btn: b, cv: c });
    }

    const sliders: Partial<Record<Mode, { h: SliderHandle; row: HTMLElement; v: string; s: string }>> = {};
    const mkSlider = (m: Mode, v: string, s: string, o: Omit<Parameters<typeof slider>[1], 'label'>) => {
      const h = slider(g1, { ...o, label: v });
      const row = h.input.parentElement as HTMLElement;
      sliders[m] = { h, row, v, s };
    };
    mkSlider('expanded', 'Squeeze ↔ stretch', 'Uniform strain ε', {
      min: -LIM.eps * 100,
      max: LIM.eps * 100,
      step: 0.005,
      value: st.eps * 100,
      format: (p) => (station.depth === 'specialist' ? `${signed(p, 3)} %` : `${signed(p, 2)} %`),
      onInput: (p) => {
        st.eps = p / 100;
        fieldDirty = true;
        edit();
      },
    });
    mkSlider('bent', 'Bend', 'Curvature 1/R', {
      min: -1,
      max: 1,
      step: 0.01,
      value: st.kappa / LIM.kappa,
      format: (f) => {
        const k = f * LIM.kappa;
        if (Math.abs(k) < 1e-9) return 'flat';
        const R = 1 / Math.abs(k) / 1000; // µm
        return station.depth === 'specialist' ? `R = ${signed(R, 0).replace('+', '')} µm` : `R = ${R.toFixed(0)} µm${k < 0 ? ' (down)' : ''}`;
      },
      onInput: (f) => {
        st.kappa = f * LIM.kappa;
        fieldDirty = true;
        edit();
      },
    });
    mkSlider('coreshell', 'Core size mismatch', 'Core misfit (eigenstrain)', {
      min: -LIM.misfit * 100,
      max: LIM.misfit * 100,
      step: 0.005,
      value: st.misfit * 100,
      format: (p) => `${signed(p, 3)} %`,
      onInput: (p) => {
        st.misfit = p / 100;
        fieldDirty = true;
        edit();
      },
    });
    mkSlider('dislocation', 'Slide the dislocation', 'Core position along b', {
      min: -1,
      max: 1,
      step: 0.01,
      value: st.dislP,
      format: () => {
        const c = shape.centroid;
        const b = burgers();
        const bm = Math.hypot(b[0], b[1]);
        const t = ((st.disl[0] - c[0]) * b[0] + (st.disl[1] - c[1]) * b[1]) / bm;
        return `${signed(t, 0)} nm`;
      },
      onInput: (p) => {
        st.dislP = p;
        st.disl = dislocationAt(shape, p);
        fieldDirty = true;
        edit();
      },
    });
    mkSlider('surface', 'Surface tug', 'Surface relaxation u₀', {
      min: -LIM.u0,
      max: LIM.u0,
      step: 0.01,
      value: st.u0,
      format: (u) => (station.depth === 'specialist' ? `${signed(u, 2)} Å (λ = 15 nm)` : `${signed(u / 10, 3)} nm ${u >= 0 ? 'outward' : 'inward'}`),
      onInput: (u) => {
        st.u0 = u;
        fieldDirty = true;
        edit();
      },
    });
    relabel.push(() => {
      for (const k of Object.keys(sliders) as Mode[]) {
        const s = sliders[k]!;
        const l = s.row.querySelector('.stn-slider-label');
        if (l) l.textContent = dual(s.v, s.s);
        s.h.set(s.h.get());
      }
    });

    const reflToggle = toggle<ReflId>(g1, {
      label: 'Which atomic planes reflect',
      options: REFL_IDS.map((id) => ({ value: id, label: REFLECTIONS[id].label, title: `Bragg reflection ${REFLECTIONS[id].label}: d = ${REFLECTIONS[id].d.toFixed(3)} Å, 2θ = ${REFLECTIONS[id].twoTheta.toFixed(1)}° at 9 keV` })),
      value: st.refl,
      onChange: (v) => {
        st.refl = v;
        fieldDirty = true;
        thumbsDirty = true;
      },
    });
    const reflLabel = (g1.lastElementChild as HTMLElement).querySelector('.stn-slider-label') as HTMLElement;
    relabel.push(() => {
      reflLabel.textContent = dual('Which atomic planes reflect', 'Bragg reflection hkl (zone [1̅ 10])');
    });
    const planesToggle = toggle<'on' | 'off'>(g1, {
      label: 'Rows of atoms',
      options: [
        { value: 'on', label: 'Show planes' },
        { value: 'off', label: 'Colour only' },
      ],
      value: 'on',
      onChange: (v) => {
        st.planes = v === 'on';
        truthDirty = true;
        recDirty = true;
        markAll();
      },
    });
    const planesLabel = (g1.lastElementChild as HTMLElement).querySelector('.stn-slider-label') as HTMLElement;
    relabel.push(() => {
      planesLabel.textContent = dual('Rows of atoms', `Lattice planes (drawn ×${PLANE_MAG})`);
    });
    const modeNote = note(g1, station, '', '');

    // 2 · source
    const g2 = mkGroup('2 · Shine X-rays on it', '2 · Source & detector');
    const srcToggle = toggle<Src>(g2, {
      label: 'X-ray source',
      options: [
        { value: 'aps', label: 'Original APS', title: 'APS before the 2023–24 upgrade (3.1 nm·rad emittance, 100 mA)' },
        { value: 'apsu', label: 'APS-U', title: 'Upgraded APS (42 pm·rad emittance, 200 mA)' },
      ],
      value: st.src,
      onChange: (v) => {
        st.src = v;
        dataDirty = true;
        flash(cvD);
      },
    });
    const srcLabel = (g2.lastElementChild as HTMLElement).querySelector('.stn-slider-label') as HTMLElement;
    relabel.push(() => {
      srcLabel.textContent = dual('X-ray source', 'Source (coherent flux)');
    });
    const expSlider = slider(g2, {
      label: 'Exposure time',
      min: 0.001,
      max: 10,
      log: true,
      value: st.exposure,
      format: fmtTime,
      onInput: (v) => {
        st.exposure = v;
        dataDirty = true;
        edit();
      },
    });
    const viewToggle = toggle<DetView>(g2, {
      label: 'Detector view',
      options: [
        { value: 'intensity', label: 'Brightness' },
        { value: 'asym', label: 'Lopsidedness' },
      ],
      value: st.view,
      onChange: (v) => {
        st.view = v;
        if (analysisStale) settle();
        detDirty = true;
        dirty.d = true;
        updateCaption(true);
      },
    });
    const viewLabel = (g2.lastElementChild as HTMLElement).querySelector('.stn-slider-label') as HTMLElement;
    const viewBtns = (g2.lastElementChild as HTMLElement).querySelectorAll('button');
    relabel.push(() => {
      viewLabel.textContent = dual('Detector view', 'Detector view');
      viewBtns[0].textContent = dual('Brightness', 'I(Δq), log');
      viewBtns[1].textContent = dual('Lopsidedness', 'Friedel asymmetry');
    });
    const roPhot = readout(g2, 'X-rays collected');
    const roRes = readout(g2, 'Finest detail');
    const roSym = readout(g2, 'Symmetry');
    const roOther = readout(g2, 'Same data at the old APS');
    const roRate = readout(g2, 'Peak pixel rate');
    roRate.el.classList.add('bcdi-spec');
    const roLbl = (r: { el: HTMLElement }) => r.el.querySelector('.stn-readout-label') as HTMLElement;
    relabel.push(() => {
      roLbl(roPhot).textContent = dual('X-rays collected', 'Photons in frame');
      roLbl(roRes).textContent = dual('Finest detail', 'Half-period at ⟨I⟩ = 1 ph');
      roLbl(roSym).textContent = dual('Symmetry', 'Friedel asymmetry');
    });
    note(
      g2,
      station,
      `**Why APS-U matters:** its beam carries about **${Math.round(COHERENT_GAIN / 10) * 10}× more coherent X-rays** — waves marching in step, which is what makes the speckled pattern. More X-rays in the faint outer fringes means finer detail, or the same picture far faster: fast enough to watch a crystal while it reacts.`,
      `Coherent fraction f = Π (λ/4π)/(ΣΣ′) at 9 keV, 2.1 m undulator, beam sizes from FDR Table 1.1: 0.049 % (APS) → 5.8 % (APS-U); × 2 current ⇒ **${COHERENT_GAIN.toFixed(0)}× coherent flux** (estimate). In 3D, ⟨I⟩ ∝ q^{−4} so q_{max} ∝ F_{coh}^{1/4} (≈ 4× finer half-period; q^{−3} and F^{1/3} in this 2D model), or the same data ${COHERENT_GAIN.toFixed(0)}× faster. Photon numbers: illustrative for a ~300 nm Au crystal; the brightest pixels would exceed a photon-counting detector's ~10^{6}–10^{7} ph/s linear range, a known ATOMIC challenge.`,
    );

    // 3 · reconstruction
    const g3 = mkGroup('3 · Rebuild the crystal', '3 · Phase retrieval');
    const row = document.createElement('div');
    row.className = 'bcdi-row';
    g3.appendChild(row);
    const btnRestart = button(row, '↻ Rebuild again', () => startRecon(), 'is-primary');
    const btnPause = button(row, '❚❚ Pause', () => {
      if (rc.phase === 'running') rc.phase = 'paused';
      else if (rc.phase === 'paused') rc.phase = 'running';
      syncPause();
    });
    // reduced motion: the computer still rebuilds, but panels 3 and 4 show the result instead of every iteration
    const motion = motionGate(station, row, {
      play: '▶ Show it live',
      pause: '❚❚ Results only',
      title: 'Your device asks for reduced motion: the rebuilt crystal appears when the computer is done. Press to watch every iteration.',
      onChange: () => markAll(),
    });
    const syncPause = () => {
      btnPause.textContent = rc.phase === 'paused' ? '▶ Resume' : '❚❚ Pause';
      btnPause.disabled = rc.phase !== 'running' && rc.phase !== 'paused';
      btnPause.style.opacity = btnPause.disabled ? '0.5' : '';
    };
    relabel.push(() => {
      btnRestart.textContent = dual('↻ Rebuild again', '↻ New random start');
    });
    const supToggle = toggle<SupportMode>(g3, {
      label: 'Does the computer know the outline?',
      options: [
        { value: 'shrink', label: 'Shape unknown', title: 'Shrink-wrap: the algorithm finds the crystal outline itself' },
        { value: 'known', label: 'Shape known', title: 'Use the true crystal outline as the support constraint' },
      ],
      value: st.support,
      onChange: (v) => {
        st.support = v;
        startRecon();
      },
    });
    const supLabel = (g3.lastElementChild as HTMLElement).querySelector('.stn-slider-label') as HTMLElement;
    const supBtns = (g3.lastElementChild as HTMLElement).querySelectorAll('button');
    relabel.push(() => {
      supLabel.textContent = dual('Does the computer know the outline?', 'Support constraint');
      supBtns[0].textContent = dual('Shape unknown', 'Shrink-wrap');
      supBtns[1].textContent = dual('Shape known', 'True support');
    });
    const roIter = readout(g3, 'Iteration');
    const roMatch = readout(g3, 'Match to the real crystal', { big: true, color: accent });
    const roErr = readout(g3, 'Fourier error / Poisson floor');
    roErr.el.classList.add('bcdi-spec');
    const roSol = readout(g3, 'Solution');
    roSol.el.classList.add('bcdi-spec');
    relabel.push(() => {
      roLbl(roIter).textContent = dual('Guess number', 'Iteration · algorithm');
      roLbl(roMatch).textContent = dual('Match to the real crystal', 'Overlap with truth |⟨T,E⟩|');
    });
    note(
      g3,
      station,
      'The detector counts X-rays but cannot record their **phase** — and the phase is exactly where the atom shifts are hidden. The computer guesses the phase, checks the guess against the pattern and the crystal’s outline, and repeats hundreds of times until both agree.',
      `**Phasing:** HIO (β = 0.9) / ER blocks with shrink-wrap (σ 2.5 → 0.9 px, 12 %), support seeded from the autocorrelation F^{−1}[I]. Oversampling ≥ ${OVERSAMPLING.toFixed(1)} per axis (Nyquist sampling of |F|² needs ≥ 2; Miao, Sayre & Chapman 1998: a total ratio > 2 already suffices in principle). Recovered: ψ = ρe^{iφ} with φ mod 2π, up to a global phase, a translation and the twin ψ^{∗}(−r) = ρ(−r)e^{−iφ(−r)} — flipped back here by comparison with the true object (in practice from prior knowledge, e.g. which facet sits on the substrate). If ε_{F} stalls above ${STUCK_RATIO}× the Poisson floor at iteration ${DECIDE_AT}, a new random start is made — the data-only test a user would apply. A shortened version of the 34-ID-C recipe in the ATOMIC PDR (§6-2.4.3: 90–100 HIO + 10–20 ER, ×3–4, shrink-wrap every 5 iterations, 5–50 random starts with guided/genetic selection).`,
    );

    // 4 · about
    const g4 = mkGroup('ATOMIC · 34-ID', 'ATOMIC · 34-ID-F');
    note(
      g4,
      station,
      '**ATOMIC** is a beamline built just for this kind of imaging. Its “zoom” mirrors are designed to shrink the X-ray spot from 2 µm down to 50 nm to fit each crystal, with room around the sample for heaters, gases and liquids — so crystals can be watched *while* they work, in batteries, catalysts and under stress.',
      '**ATOMIC (34-ID-F):** dedicated coherent-diffraction branch of the canted 34-ID front end (revolver U21/U25), windowless; coherence-defining slits at 26.8 m and 50.3 m; small-offset Si(111) DCM, 5.3–30 keV; two bendable zoom-KB pairs ~15 m apart (~54 m in 34-ID-C, ~69 m in 34-ID-F) → 50 nm–2 µm focus, ~50 mm working distance; ~3×10^{12} ph/s in 50 nm at 8.7 keV (FDR Table 4.65); pink-beam bypass so a Laue pattern can index the crystal before a single Bragg peak is measured with monochromatic beam. Goals: sub-10 nm operando BCDI in tens of seconds; ≤ 1 nm design resolution (vs 10–30 nm typical before) and, ultimately, atomic resolution on ~50 nm crystals (~1000 s, PDR §6-2). Status Oct 2026: scientific commissioning. **This station** is a 2D model: the object is a section (≈ projection) along [1̅\u200a10] and the pattern the matching central slice through G, which a real measurement assembles from a ~±0.3° rocking scan; kinematic Fraunhofer optics, Au, 9 keV, q-pixel ' +
        `Δq = ${(DQ * 1000).toFixed(1)}×10^{−3} nm^{−1} (55 µm pixels at ${DET_DIST.toFixed(2)} m, i.e. 4 × 4-binned at ~${(DET_DIST * 4).toFixed(1)} m).`,
    );
    const resetRow = document.createElement('div');
    resetRow.className = 'bcdi-row';
    g4.appendChild(resetRow);
    button(resetRow, 'Reset station', () => resetAll());

    // ── mode handling
    let thumbsDirty = true;
    function setMode(m: Mode): void {
      st.mode = m;
      for (const [id, { btn }] of modeBtns) btn.setAttribute('aria-pressed', String(id === m));
      for (const k of Object.keys(sliders) as Mode[]) sliders[k]!.row.style.display = k === m ? '' : 'none';
      modeNote.set(MODE_TEXT[m].v, MODE_TEXT[m].s);
      cvT.canvas.style.cursor = m === 'dislocation' ? 'grab' : 'crosshair';
      fieldDirty = true;
    }

    function fieldParams(): FieldParams {
      return { ...DEFAULT_FIELD, mode: st.mode, eps: st.eps, kappa: st.kappa, misfit: st.misfit, u0: st.u0, disl: st.disl };
    }

    function renderThumbs(): void {
      thumbsDirty = false;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const R = Math.round(40 * dpr);
      const lay = new Layer(R);
      const refl = REFLECTIONS[st.refl];
      const demo: Record<Mode, Partial<FieldParams>> = {
        perfect: {},
        expanded: { eps: 0.003 },
        bent: { kappa: 1.6e-5 },
        coreshell: { misfit: 0.004 },
        dislocation: { disl: [shape.centroid[0], shape.centroid[1] + 8] },
        surface: { u0: 1.2 },
      };
      const view: FieldView = { cx: 0, cy: 0, fov: 330 };
      const m = 230; // icon magnification
      const gd: [number, number] = [(refl.g[0] * 10) / m, (refl.g[1] * 10) / m];
      for (const { id } of MODES) {
        const f = phaseFn(shape, { ...DEFAULT_FIELD, ...demo[id], mode: id }, refl);
        const pix = view.fov / R;
        renderField(lay.img, view, (x, y, o) => {
          const a = clamp(0.5 - sdist(shape, x, y) / pix, 0, 1);
          o[0] = a;
          o[1] = a > 0 ? f(x, y) : 0;
        }, gd, 1.1 * dpr, 0.75);
        lay.commit();
        const c = modeBtns.get(id)!.cv;
        c.width = R;
        c.height = R;
        const cx = c.getContext('2d')!;
        cx.clearRect(0, 0, R, R);
        cx.drawImage(lay.canvas, 0, 0);
      }
    }

    // ── data pipeline
    function rebuild(): void {
      if (fieldDirty) {
        phi = phaseFn(shape, fieldParams(), REFLECTIONS[st.refl]);
        sim.setField(phi, st.mode === 'dislocation' ? st.disl : null);
        truth.norm = sim.truthNorm;
        truth.com = sim.truthCom;
        truthDirty = true;
        dirty.t = true;
      }
      fieldDirty = false;
      dataDirty = false;
      // during a drag the Friedel/resolution analysis (half the cost) waits for the input to settle, unless the
      // detector is showing the asymmetry map itself
      const lite = interacting() && st.view === 'intensity';
      sim.measure(PHOTON_RATE[st.src] * st.exposure, noiseSeed++, !lite);
      analysisStale = lite;
      floor = noiseFloor(sim.counts);
      detDirty = true;
      dirty.d = true;
      // the reconstruction is now stale: restart shortly (debounced while sliders move)
      rc.phase = 'waiting';
      rc.restartAt = performance.now() + 320;
      syncPause();
      dirty.r = dirty.c = true;
      updateReadouts();
      // full caption rewrite only when the input is discrete (a click); during drags the 400 ms throttle applies
      updateCaption(!interacting());
    }

    /** a slider is moving or the dislocation is being dragged (input within the last 200 ms) */
    function interacting(): boolean {
      return dragging || performance.now() - lastEdit < 200;
    }

    /** the input has settled: run the deferred Friedel/resolution analysis and refresh what depends on it */
    function settle(): void {
      sim.analyse();
      analysisStale = false;
      detDirty = true;
      dirty.d = true;
      updateReadouts();
      updateCaption(true);
    }

    function startRecon(): void {
      rc.seed = (rc.seed * 16807 + 11) % 2147483647;
      rc.attempt = 1;
      rc.ghosts = [];
      rc.everStuck = false;
      beginAttempt();
      rc.phase = 'running';
      showRun = true;
      syncPause();
      updateCaption(true);
    }
    function beginAttempt(): void {
      pr.reset(sim.modulus, rc.seed + rc.attempt * 7919, st.support === 'known' ? sim.support : null);
      matchHist.fill(NaN);
      al.match = 0;
      alignNow();
      dirty.r = dirty.c = true;
    }

    /** Align the current estimate to the truth (display only) and transform the support outline the same way. */
    function alignNow(): void {
      pr.projected(estRe, estIm);
      align(estRe, estIm, N, truth, al);
      applyAlignment(estRe, estIm, N, al, dispRe, dispIm);
      const sup = pr.support;
      for (let j = 0; j < N; j++) {
        const jj = al.twin ? (((al.sy - j) % N) + N) % N : (((j - al.sy) % N) + N) % N;
        for (let i = 0; i < N; i++) {
          const ii = al.twin ? (((al.sx - i) % N) + N) % N : (((i - al.sx) % N) + N) % N;
          dispSup[j * N + i] = sup[jj * N + ii];
        }
      }
      // amplitude reference: 95th-percentile-ish via max over support × 0.9
      let mx = 0;
      for (let k = 0; k < n2; k++) {
        const a = dispRe[k] * dispRe[k] + dispIm[k] * dispIm[k];
        if (a > mx) mx = a;
      }
      rc.ampRef = Math.sqrt(mx) * 0.85 || 1;
      if (pr.iter > 0) matchHist[Math.min(PR_ITERS, pr.iter) - 1] = al.match;
      recDirty = true;
    }

    let iterCost = 2.5; // ms, running estimate
    function iterate(budgetMs: number, maxK = 6): void {
      const t0 = performance.now();
      let k = 0;
      while (k < maxK && !pr.done) {
        const ts = performance.now();
        pr.step();
        iterCost = iterCost * 0.9 + (performance.now() - ts) * 0.1;
        k++;
        if (pr.iter === DECIDE_AT && st.support === 'shrink' && rc.attempt < MAX_ATTEMPTS) {
          const ratio = pr.err[DECIDE_AT - 1] / floor;
          if (ratio > STUCK_RATIO) {
            rc.ghosts.push(pr.err.slice(0, DECIDE_AT));
            rc.attempt++;
            rc.everStuck = true;
            rc.stuckFlash = performance.now();
            flash(cvR);
            beginAttempt();
            updateCaption(true);
            break;
          }
        }
        if (pr.iter % 5 === 0) alignNow();
        if (performance.now() - t0 + iterCost > budgetMs) break;
      }
      if (pr.done) {
        alignNow();
        rc.phase = 'done';
        recFull = true;
        syncPause();
        updateCaption(true);
      }
      dirty.r = dirty.c = true;
    }

    function resetAll(): void {
      Object.assign(st, { ...DEFAULTS, disl: dislocationAt(shape, DEFAULTS.dislP) });
      sliders.expanded!.h.set(st.eps * 100);
      sliders.bent!.h.set(st.kappa / LIM.kappa);
      sliders.coreshell!.h.set(st.misfit * 100);
      sliders.dislocation!.h.set(st.dislP);
      sliders.surface!.h.set(st.u0);
      reflToggle.set(st.refl);
      planesToggle.set('on');
      srcToggle.set(st.src);
      expSlider.set(st.exposure);
      viewToggle.set(st.view);
      supToggle.set(st.support);
      setMode(st.mode);
      thumbsDirty = true;
      dataDirty = true;
      truthDirty = recDirty = detDirty = true;
      markAll();
    }

    // ── readouts & caption
    function updateReadouts(): void {
      const s = sim.stats;
      roPhot.set(sci(s.counted));
      roRes.set(s.kmax >= N / 2 ? `${fmtNm(s.resolution)} (detector edge)` : s.kmax > 0 ? fmtNm(s.resolution) : `> ${CRYSTAL_WIDTH} nm`);
      roSym.set(
        station.depth === 'specialist'
          ? s.asym.toFixed(3)
          : s.asym < 0.01
            ? 'symmetric'
            : `lopsided ${(s.asym * 100).toFixed(0)} %`,
      );
      const other = st.src === 'apsu' ? st.exposure * COHERENT_GAIN : st.exposure / COHERENT_GAIN;
      roLbl(roOther).textContent = st.src === 'apsu' ? dual('Same data at the old APS', 'Equivalent APS (2019) time') : dual('Same data at APS-U', 'Equivalent APS-U time');
      roOther.set(fmtTime(other));
      roRate.set(`${sci(s.peak / st.exposure)} ph/s`);
      (roRate.el.querySelector('.stn-readout-value') as HTMLElement).style.color = s.peak / st.exposure > 3e6 ? TOKENS.warn : '';
    }

    const shown = new Map<{ set(v: string): void }, string>();
    /** set a readout only when its text changes (avoids per-frame style/layout work) */
    const put = (r: { set(v: string): void }, v: string) => {
      if (shown.get(r) === v) return;
      shown.set(r, v);
      r.set(v);
    };
    function updateRunReadouts(): void {
      const it = pr.iter;
      const algo = it >= PR_ITERS ? 'done' : algoAt(it);
      put(
        roIter,
        station.depth === 'specialist'
          ? `${it} / ${PR_ITERS} · ${algo}${rc.attempt > 1 ? ` · start ${rc.attempt}` : ''}`
          : `${it} / ${PR_ITERS}${rc.attempt > 1 ? ` (attempt ${rc.attempt})` : ''}`,
      );
      put(roMatch, it === 0 || rc.phase === 'waiting' ? '—' : `${(al.match * 100).toFixed(1)} %`);
      const e = it > 0 ? pr.err[Math.min(it, PR_ITERS) - 1] : NaN;
      put(roErr, Number.isFinite(e) ? `${e.toFixed(3)} / ${floor.toFixed(3)} = ${(e / floor).toFixed(2)}×` : '—');
      put(roSol, it === 0 ? '—' : al.twin ? 'twin ψ∗(−r) → flipped' : 'direct');
    }

    function updateCaption(force = false): void {
      const now = performance.now();
      if (!force && now - rc.lastCaption < 400) return;
      rc.lastCaption = now;
      const s = sim.stats;
      const R = REFLECTIONS[st.refl];
      const mt = MODE_TEXT[st.mode];
      // pattern
      // lead sentence: the mode (its full text is also in the controls note), replaced by the G·b = 0 lesson when that applies
      let lead = mt.v.replace(/ Drag it around inside the crystal!/, '');
      if (st.mode === 'dislocation' && R.n === 0)
        lead = `With the ${R.label} planes the swirl around the ⊥ **vanishes**: this defect slips atoms *along* these planes, and X-rays bouncing off them only sense shifts *across* them. Only the gentler squeeze around the extra half-plane still shows.`;
      let pv: string;
      let ps: string;
      const shift = Math.hypot(s.comX, s.comY);
      // the symmetry verdict is a property of the noise-free pattern; say so when the counts are too few to show it
      const noisy = s.resolution > 25;
      if (s.asym < 0.01) {
        pv =
          shift > 1.5
            ? `Its X-ray pattern **slides** ${shift.toFixed(0)} pixels but stays perfectly **symmetric** — turn it half a turn and it looks the same.`
            : 'Its X-ray pattern is perfectly **symmetric** — turn it half a turn and it looks the same.';
      } else if (noisy) pv = `Its X-ray pattern should be **lopsided** (${(s.asym * 100).toFixed(0)} %), but with so few X-rays the noise hides most of it.`;
      else pv = `Its X-ray pattern is **lopsided** (${(s.asym * 100).toFixed(0)} %) — the tell-tale sign that strain varies inside.`;
      if (st.mode === 'expanded' && Math.abs(st.eps) > 1e-5)
        pv = `${st.eps > 0 ? 'Stretching' : 'Squeezing'} it by ${(Math.abs(st.eps) * 100).toFixed(2)} % is like ${st.eps > 0 ? 'heating' : 'cooling'} gold by about ${Math.abs(st.eps / ALPHA_AU).toFixed(0)} °C. ${pv}`;
      ps = `A_{F} = ${s.asym.toFixed(3)} (noise-free pattern, re-centred); peak centroid Δq = (${f3(s.comX * DQ)}, ${f3(s.comY * DQ)}) nm^{−1}.`;
      if (st.mode === 'dislocation') ps += ` G_{${R.label}}·b = ${R.n === 0 ? '0' : `${R.n > 0 ? '' : '−'}2π`} ⇒ vortex charge n = ${R.n}${R.n === 0 ? ' (residual contrast from G·(b × l) ≠ 0)' : ''}.`;
      if (st.view === 'asym') {
        pv += ' **Red**: brighter than the matching spot across the centre; **blue**: dimmer; white: balanced.';
        ps += ' Map: hue = (I(q) − I(−q))/(I(q) + I(−q)) of the noise-free pattern after removing the mean phase ramp (so a pure peak shift reads as symmetric), brightness = log I. I(q) = I(−q) whenever O is real or even (up to a shift and global phase), so asymmetry needs the odd part of φ beyond a linear ramp, or an even φ on a shape without an inversion centre.';
      }
      // source
      const tStr = fmtTime(st.exposure);
      const sv =
        st.src === 'apsu'
          ? `**APS-U** collects ${sciMd(s.counted)} X-rays in ${tStr}: enough to see details down to ~${fmtNm(s.resolution)}.`
          : `The **original APS** collects only ${sciMd(s.counted)} X-rays in ${tStr}; details finer than ~${s.kmax > 0 ? fmtNm(s.resolution) : `${CRYSTAL_WIDTH} nm`} drown in the noise.`;
      const ss = `N_{ph} = ${sciMd(s.counted)} (${st.src === 'apsu' ? 'APS-U' : 'APS 2019'}, ${tStr}); ⟨I⟩ ≥ 1 ph/px to q = ${(s.kmax * DQ).toFixed(2)} nm^{−1} ⇒ half-period ≈ ${fmtNm(s.resolution)}. Poisson floor of ε_{F}: ${floor.toFixed(3)}.`;
      // reconstruction
      let rv = '';
      let rs = '';
      const pct = `${(al.match * 100).toFixed(0)} %`;
      if (rc.phase === 'waiting') {
        rv = 'New data — the computer will start rebuilding in a moment.';
        rs = 'Data changed; phasing restarts after 0.3 s of no input.';
      } else if (rc.phase === 'done') {
        const good = al.match > 0.9;
        rv = good ? `**Rebuilt!** The computer’s crystal is ${pct} similar to the real one` : `The rebuild is only ${pct} similar to the real crystal: with this few X-rays (or this much strain) many different crystals fit the pattern`;
        rv += al.twin ? ' — it found the crystal’s **twin** (rotated half a turn, colours reversed: same pattern!), which we flipped back.' : '.';
        if (rc.everStuck) rv += ' It got stuck once and started over from a fresh random guess, just as scientists do.';
        rs = `Done: ${PR_ITERS} iterations, ε_{F} = ${pr.err[PR_ITERS - 1].toFixed(3)} (${(pr.err[PR_ITERS - 1] / floor).toFixed(2)}× floor), overlap ${(al.match).toFixed(3)} with the truth${al.twin ? ' (twin solution, conjugated & inverted for display)' : ''}${rc.attempt > 1 ? `; random start ${rc.attempt} of ≤ ${MAX_ATTEMPTS}` : ''}.`;
      } else {
        rv = `The computer is rebuilding the crystal from the pattern alone… ${pr.iter > 20 ? `(${pct} similar so far)` : ''}`;
        if (rc.attempt > 1) rv += ' It got stuck, so it is trying a fresh random guess.';
        rs = `${algoAt(pr.iter)} iteration ${pr.iter}/${PR_ITERS}${rc.attempt > 1 ? `, start ${rc.attempt}` : ''}; overlap ${al.match.toFixed(3)}.`;
      }
      station.setCaption(nbsp(`${lead} ${pv} ${sv} ${rv}`), nbsp(`${ps} ${ss} ${rs}`));
    }

    function flash(c: Canvas2D): void {
      const w = wrapOf(c);
      w.classList.remove('bcdi-flash');
      void w.offsetWidth;
      w.classList.add('bcdi-flash');
    }

    // ── geometry helpers for panels
    interface Geo {
      x: number;
      y: number;
      s: number;
    }
    const geoOf = (c: Canvas2D, bottom = 34): Geo => {
      const top = 24;
      const side = 8;
      const s = Math.max(40, Math.floor(Math.min(c.w - 2 * side, c.h - top - bottom)));
      return { x: Math.round((c.w - s) / 2), y: Math.round(top + Math.max(0, (c.h - top - bottom - s) / 2)), s };
    };
    const toPx = (g: Geo, x: number, y: number): [number, number] => [g.x + ((x - (VIEW.cx - FOV / 2)) / FOV) * g.s, g.y + ((VIEW.cy + FOV / 2 - y) / FOV) * g.s];
    const toNm = (g: Geo, px: number, py: number): [number, number] => [VIEW.cx - FOV / 2 + ((px - g.x) / g.s) * FOV, VIEW.cy + FOV / 2 - ((py - g.y) / g.s) * FOV];
    const geo = { t: geoOf(cvT), d: geoOf(cvD), r: geoOf(cvR) };

    // ── pointer interaction
    const hover: { panel: '' | 't' | 'd' | 'r'; x: number; y: number } = { panel: '', x: 0, y: 0 };
    let dragging = false;
    /** the pulsing 'drag me' ring stops (and the 20 Hz redraw with it) once the visitor has found the handle */
    let dragged = false;
    const local = (c: Canvas2D, e: PointerEvent): [number, number] => {
      const r = c.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const moveDislocation = (px: number, py: number) => {
      const [x, y] = toNm(geo.t, px, py);
      if (gauge(shape, x, y) > 0.88) return;
      st.disl = [x, y];
      // keep the slider in sync with the projection along b
      const c = shape.centroid;
      const b = burgers();
      const bm = Math.hypot(b[0], b[1]);
      const d: [number, number] = [b[0] / bm, b[1] / bm];
      const t = (x - c[0]) * d[0] + (y - c[1]) * d[1];
      const [lo, hi] = chord(shape, c, d);
      st.dislP = clamp(t >= 0 ? t / (hi * 0.72) : t / (-lo * 0.72), -1, 1);
      sliders.dislocation!.h.set(st.dislP);
      fieldDirty = true;
      edit();
    };
    const onDown = (e: PointerEvent) => {
      if (st.mode !== 'dislocation') return;
      const [px, py] = local(cvT, e);
      const [x, y] = toNm(geo.t, px, py);
      if (gauge(shape, x, y) > 0.95) return;
      dragging = true;
      dragged = true;
      cvT.canvas.setPointerCapture(e.pointerId);
      cvT.canvas.style.cursor = 'grabbing';
      moveDislocation(px, py);
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      dirty.t = true;
      if (cvT.canvas.hasPointerCapture(e.pointerId)) cvT.canvas.releasePointerCapture(e.pointerId);
      cvT.canvas.style.cursor = st.mode === 'dislocation' ? 'grab' : 'crosshair';
    };
    const onMove = (panel: 't' | 'd' | 'r', c: Canvas2D) => (e: PointerEvent) => {
      const [px, py] = local(c, e);
      hover.panel = panel;
      hover.x = px;
      hover.y = py;
      if (panel === 't' && dragging) moveDislocation(px, py);
      dirty[panel] = true;
    };
    const onLeave = (panel: 't' | 'd' | 'r') => () => {
      if (hover.panel === panel) hover.panel = '';
      dirty[panel] = true;
    };
    cvT.canvas.addEventListener('pointerdown', onDown);
    cvT.canvas.addEventListener('pointerup', onUp);
    cvT.canvas.addEventListener('pointercancel', onUp);
    for (const [p, c] of [['t', cvT], ['d', cvD], ['r', cvR]] as const) {
      c.canvas.addEventListener('pointermove', onMove(p, c));
      c.canvas.addEventListener('pointerleave', onLeave(p));
    }

    // ── drawing ──────────────────────────────────────────────────────────────────────────────────────────
    const FONT = TOKENS.font;
    const planeVec = (): [number, number] | null => {
      if (!st.planes) return null;
      const g = REFLECTIONS[st.refl].g;
      return [(g[0] * 10) / PLANE_MAG, (g[1] * 10) / PLANE_MAG];
    };

    function tooltip(c: CanvasRenderingContext2D, w: number, h: number, x: number, y: number, lines: string[]): void {
      c.save();
      c.font = `500 11px ${FONT}`;
      const tw = Math.max(...lines.map((l) => c.measureText(l).width)) + 14;
      const th = lines.length * 15 + 8;
      let bx = x + 12;
      let by = y + 12;
      if (bx + tw > w - 4) bx = x - tw - 10;
      if (by + th > h - 4) by = y - th - 10;
      bx = Math.max(4, bx);
      by = Math.max(4, by);
      c.fillStyle = 'rgba(8,12,20,0.88)';
      c.strokeStyle = 'rgba(150,180,220,0.3)';
      c.beginPath();
      c.roundRect(bx, by, tw, th, 6);
      c.fill();
      c.stroke();
      c.fillStyle = TOKENS.ink;
      c.textBaseline = 'top';
      lines.forEach((l, i) => c.fillText(l, bx + 7, by + 5 + i * 15));
      c.restore();
    }

    function scaleBar(c: CanvasRenderingContext2D, g: Geo, lenPx: number, text: string): void {
      const x = g.x + 10;
      const y = g.y + g.s - 12;
      c.save();
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 2;
      c.shadowColor = '#000';
      c.shadowBlur = 4;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + lenPx, y);
      c.stroke();
      c.restore();
      label(c, text, x + lenPx / 2, y - 5, { color: TOKENS.ink, size: 10.5, align: 'center', weight: 600 });
    }

    function phaseBar(c: CanvasRenderingContext2D, g: Geo, cw: number, extra?: string): void {
      const R = REFLECTIONS[st.refl];
      const y = g.y + g.s + 8;
      // ≥ 86 px so the visitor end labels ("−0.12", "+0.12 nm") never touch on a phone-width panel
      const x = g.x;
      const barW = Math.min(Math.max(86, Math.min(160, g.s * 0.5)), cw - x - 6);
      const grad = c.createLinearGradient(x, 0, x + barW, 0);
      for (let i = 0; i <= 16; i++) grad.addColorStop(i / 16, phaseCss(-Math.PI + (i / 16) * 2 * Math.PI));
      c.fillStyle = grad;
      c.fillRect(x, y, barW, 6);
      const spec = station.depth === 'specialist';
      const halfD = R.d / 20; // nm
      const lo = spec ? '−π' : `−${halfD.toFixed(2)}`;
      const hi = spec ? '+π' : `+${halfD.toFixed(2)} nm`;
      label(c, lo, x, y + 17, { color: TOKENS.ink3, size: 10, align: 'left' });
      if (barW >= 100 || spec) label(c, '0', x + barW / 2, y + 17, { color: TOKENS.ink3, size: 10, align: 'center' });
      label(c, hi, x + barW, y + 17, { color: TOKENS.ink3, size: 10, align: 'right' });
      const title = extra ?? (spec ? 'φ = G·u' : 'atom shift along arrow');
      if (fits(c, title, x + barW + 10, cw)) label(c, title, x + barW + 10, y + 7, { color: TOKENS.ink2, size: 10.5 });
    }

    /** Does a 10.5 px label starting at x end before maxX − 4? */
    function fits(c: CanvasRenderingContext2D, text: string, x: number, maxX: number): boolean {
      c.save();
      c.font = `500 10.5px ${FONT}`;
      const w = c.measureText(text).width;
      c.restore();
      return x + w < maxX - 4;
    }

    function frameImage(c: CanvasRenderingContext2D, g: Geo): void {
      c.save();
      c.strokeStyle = 'rgba(150,180,220,0.14)';
      c.lineWidth = 1;
      c.strokeRect(g.x - 0.5, g.y - 0.5, g.s + 1, g.s + 1);
      c.restore();
    }

    function drawTruth(t: number): void {
      const c = cvT.ctx;
      const g = (geo.t = geoOf(cvT));
      c.clearRect(0, 0, cvT.w, cvT.h);
      // substrate below the crystal (does not diffract at this Bragg angle)
      const sub = shape.facets.find((f) => f.substrate)!;
      const ySub = -sub.h; // normal is (0, −1)
      const [, pySub] = toPx(g, 0, ySub);
      c.save();
      c.beginPath();
      c.rect(g.x, g.y, g.s, g.s);
      c.clip();
      const grd = c.createLinearGradient(0, pySub, 0, g.y + g.s);
      grd.addColorStop(0, 'rgba(140,160,190,0.20)');
      grd.addColorStop(1, 'rgba(140,160,190,0.05)');
      c.fillStyle = grd;
      c.fillRect(g.x, pySub, g.s, g.y + g.s - pySub);
      c.strokeStyle = 'rgba(170,190,215,0.45)';
      c.beginPath();
      c.moveTo(g.x, pySub + 0.5);
      c.lineTo(g.x + g.s, pySub + 0.5);
      c.stroke();
      c.restore();
      if (g.y + g.s - pySub > 30) {
        // keep clear of the scale-bar text on the left
        const room = g.s - 8 - (10 + (100 / FOV) * g.s / 2 + 26);
        let t = station.depth === 'specialist' ? 'substrate (no Bragg signal)' : 'substrate';
        c.save();
        c.font = `500 10px ${FONT}`;
        if (c.measureText(t).width > room) t = 'substrate';
        const ok = c.measureText(t).width <= room;
        c.restore();
        if (ok) label(c, t, g.x + g.s - 8, g.y + g.s - 10, { color: TOKENS.ink3, size: 10, align: 'right' });
      }
      // crystal image: half resolution while a slider moves or the dislocation is dragged (a full-size render costs
      // ~20 ms on a slow laptop); re-rendered at full size once the input settles (see the main loop)
      const low = interacting();
      const R = low ? clamp(Math.round((g.s * cvT.dpr) / 2.3), 90, 200) : clamp(Math.round((g.s * cvT.dpr) / 1.15), 140, 400);
      if (layers.truth.resize(R)) truthDirty = true;
      truthLowRes = low;
      if (truthDirty) {
        truthDirty = false;
        const pix = FOV / R;
        const f = phi;
        const sampler: Sampler = (x, y, o) => {
          const a = clamp(0.5 - sdist(shape, x, y) / pix, 0, 1);
          o[0] = a;
          o[1] = a > 0 ? f(x, y) : 0;
        };
        renderField(layers.truth.img, VIEW, sampler, planeVec(), 1.25, 0.72);
        layers.truth.commit();
      }
      c.save();
      c.imageSmoothingEnabled = true;
      c.drawImage(layers.truth.canvas, g.x, g.y, g.s, g.s);
      c.restore();
      // facet outline
      c.save();
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.lineWidth = 1;
      c.beginPath();
      shape.verts.forEach(([x, y], i) => {
        const [px, py] = toPx(g, x, y);
        if (i) c.lineTo(px, py);
        else c.moveTo(px, py);
      });
      c.closePath();
      c.stroke();
      c.restore();
      // facet labels (specialist, roomy panels)
      if (station.depth === 'specialist' && g.s > 300) {
        for (const f of shape.facets) {
          if (f.substrate) continue;
          // midpoint of the facet segment
          const vs = shape.verts.filter(([x, y]) => Math.abs(f.nx * x + f.ny * y - f.h) < 1e-6);
          if (vs.length < 2) continue;
          const mx = (vs[0][0] + vs[1][0]) / 2 + f.nx * 16;
          const my = (vs[0][1] + vs[1][1]) / 2 + f.ny * 16;
          const [px, py] = toPx(g, mx, my);
          label(c, f.label, px, py, { color: TOKENS.ink3, size: 9.5, align: 'center', baseline: 'middle' });
        }
      }
      drawGArrow(c, g);
      // dislocation symbol
      if (st.mode === 'dislocation') drawDislocation(c, g, t);
      scaleBar(c, g, (100 / FOV) * g.s, '100 nm');
      frameImage(c, g);
      phaseBar(c, g, cvT.w);
      if (st.mode === 'dislocation' && g.s > 150) {
        label(c, dual('drag the ⊥ to move it', 'drag ⊥ (glide + climb)'), g.x + g.s - 8, g.y + 14, { color: TOKENS.ink3, size: 10, align: 'right' });
      }
      // hover probe
      if (hover.panel === 't' && !dragging) {
        const [x, y] = toNm(g, hover.x, hover.y);
        if (sdist(shape, x, y) <= 0) {
          const p = phi(x, y);
          const R = REFLECTIONS[st.refl];
          const uA = p / R.gMag; // Å along Ĝ (unwrapped)
          tooltip(
            c,
            cvT.w,
            cvT.h,
            hover.x,
            hover.y,
            station.depth === 'specialist'
              ? [`φ = ${signed(p, 2)} rad`, `u·Ĝ = ${signed(uA, 3)} Å  (${signed(uA / R.d, 3)} d)`]
              : [`atoms shifted ${signed(uA / 10, 3)} nm`, `along the G arrow`],
          );
        }
      }
    }

    function drawGArrow(c: CanvasRenderingContext2D, g: Geo): void {
      const R = REFLECTIONS[st.refl];
      const ux = R.g[0] / R.gMag;
      const uy = -R.g[1] / R.gMag; // screen y down
      const L = 26;
      const cx = g.x + g.s - 34;
      const cy = g.y + 52;
      const x0 = cx - (ux * L) / 2;
      const y0 = cy - (uy * L) / 2;
      const x1 = cx + (ux * L) / 2;
      const y1 = cy + (uy * L) / 2;
      c.save();
      c.strokeStyle = accent;
      c.fillStyle = accent;
      c.lineWidth = 2.2;
      c.shadowColor = 'rgba(0,0,0,0.8)';
      c.shadowBlur = 4;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
      const a = Math.atan2(uy, ux);
      c.beginPath();
      c.moveTo(x1 + Math.cos(a) * 3, y1 + Math.sin(a) * 3);
      c.lineTo(x1 - Math.cos(a - 0.5) * 9, y1 - Math.sin(a - 0.5) * 9);
      c.lineTo(x1 - Math.cos(a + 0.5) * 9, y1 - Math.sin(a + 0.5) * 9);
      c.closePath();
      c.fill();
      c.restore();
      const lx = ux > 0.3 ? x0 - 6 : x1 + (ux < -0.3 ? -6 : 8);
      const align: CanvasTextAlign = ux > 0.3 || ux < -0.3 ? 'right' : 'left';
      const ly = Math.max(y0, y1) + (Math.abs(uy) > 0.7 ? -L / 2 + 4 : 4);
      // dark backing: on small panels the label can sit over the (light) crystal, e.g. G 002 pointing up-left
      const text = `G ${R.label}`;
      const tx = ux < -0.3 ? Math.min(x0, x1) - 6 : lx;
      c.save();
      c.font = `700 11px ${FONT}`;
      const tw = c.measureText(text).width;
      c.fillStyle = 'rgba(5,8,14,0.72)';
      c.beginPath();
      c.roundRect((align === 'right' ? tx - tw : tx) - 4, ly - 11, tw + 8, 15, 4);
      c.fill();
      c.restore();
      label(c, text, tx, ly, { color: accent, size: 11, weight: 700, align });
    }

    function drawDislocation(c: CanvasRenderingContext2D, g: Geo, t: number): void {
      const [px, py] = toPx(g, st.disl[0], st.disl[1]);
      const b = burgers();
      const bm = Math.hypot(b[0], b[1]);
      const bx = b[0] / bm;
      const by = -b[1] / bm; // screen
      // extra half-plane is on the +y' side (b̂ rotated +90° in physical frame) → screen (−by_phys, −bx_phys)
      const nx = -b[1] / bm;
      const ny = -(b[0] / bm);
      c.save();
      if (!dragging) {
        const r = dragged || !motion.on ? 13 : 13 + 2.5 * Math.sin(t * 3);
        c.strokeStyle = accent;
        c.globalAlpha = 0.55;
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(px, py, r, 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 1;
      }
      const S = 8;
      c.lineCap = 'round';
      for (const [w, col] of [
        [5, 'rgba(5,8,14,0.85)'],
        [2.4, accent],
      ] as const) {
        c.strokeStyle = col;
        c.lineWidth = w;
        c.beginPath();
        c.moveTo(px - bx * S, py - by * S);
        c.lineTo(px + bx * S, py + by * S);
        c.moveTo(px, py);
        c.lineTo(px + nx * S * 1.4, py + ny * S * 1.4);
        c.stroke();
      }
      c.restore();
    }

    function drawDet(): void {
      const c = cvD.ctx;
      const g = (geo.d = geoOf(cvD));
      c.clearRect(0, 0, cvD.w, cvD.h);
      if (detDirty) {
        detDirty = false;
        if (st.view === 'intensity') renderCounts(layers.det.img, sim.counts, LOG_MAX);
        else renderAsym(layers.det.img, sim.asymMap, sim.centred, LOG_MAX);
        layers.det.commit();
      }
      c.save();
      c.imageSmoothingEnabled = false;
      c.drawImage(layers.det.canvas, g.x, g.y, g.s, g.s);
      c.restore();
      const px = g.s / N;
      const cx = g.x + g.s / 2;
      const cy = g.y + g.s / 2;
      const spec = station.depth === 'specialist';
      // unstrained Bragg position
      c.save();
      c.strokeStyle = 'rgba(233,238,245,0.55)';
      c.lineWidth = 1;
      c.beginPath();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        c.moveTo(cx + dx * 5, cy + dy * 5);
        c.lineTo(cx + dx * 11, cy + dy * 11);
      }
      c.stroke();
      c.restore();
      const s = sim.stats;
      if (st.view === 'intensity') {
        // peak centroid when it moved
        const mx = cx + s.comX * px;
        const my = cy - s.comY * px;
        if (Math.hypot(s.comX, s.comY) > 1.5) {
          c.save();
          c.strokeStyle = accent;
          c.lineWidth = 1.5;
          c.setLineDash([3, 3]);
          c.beginPath();
          c.moveTo(cx, cy);
          c.lineTo(mx, my);
          c.stroke();
          c.setLineDash([]);
          c.beginPath();
          c.arc(mx, my, 6, 0, Math.PI * 2);
          c.stroke();
          c.restore();
          // intensity centroid = −⟨∇φ⟩ (ρ²-weighted); for uniform strain that is −εG
          const pl = spec ? (st.mode === 'expanded' ? 'Δq = −εG' : '⟨Δq⟩ = −⟨∇φ⟩') : 'peak moved';
          c.font = `600 10.5px ${FONT}`;
          const plx = mx + 9 + c.measureText(pl).width > g.x + g.s - 4 ? mx - 9 - c.measureText(pl).width : mx + 9;
          label(c, pl, plx, my - 8, { color: accent, size: 10.5, weight: 600 });
        }
        // signal radius
        if (s.kmax > 2 && s.kmax < N / 2) {
          const r = s.kmax * px;
          c.save();
          c.strokeStyle = 'rgba(233,238,245,0.55)';
          c.setLineDash([4, 4]);
          c.lineWidth = 1;
          c.beginPath();
          c.arc(cx, cy, r, 0, Math.PI * 2);
          c.stroke();
          c.restore();
          const a = -Math.PI / 4;
          const txt = spec ? '⟨I⟩ = 1 ph/px' : 'signal fades into noise';
          c.font = `600 10px ${FONT}`;
          const tw = c.measureText(txt).width;
          const lx = Math.max(g.x + 4, Math.min(cx + Math.cos(a) * r + 4, g.x + g.s - tw - 6));
          const ly = Math.max(g.y + 14, cy + Math.sin(a) * r - 4);
          label(c, txt, lx, ly, { color: TOKENS.ink, size: 10, weight: 600 });
        }
      }
      // q scale bar
      scaleBar(c, g, (0.2 / DQ) * px, '0.2 nm⁻¹');
      frameImage(c, g);
      // colour bar
      const y = g.y + g.s + 8;
      const barW = Math.max(70, Math.min(160, g.s * 0.5));
      if (st.view === 'intensity') {
        const L = lut('inferno');
        const grad = c.createLinearGradient(g.x, 0, g.x + barW, 0);
        for (let i = 0; i <= 8; i++) {
          const v = 0.06 + 0.94 * (i / 8);
          const k = Math.min(255, (v * 255) | 0) * 3;
          grad.addColorStop(i / 8, `rgb(${L[k]},${L[k + 1]},${L[k + 2]})`);
        }
        c.fillStyle = grad;
        c.fillRect(g.x, y, barW, 6);
        for (const e of [0, 2, 4, 6]) {
          const xx = g.x + (e / LOG_MAX) * barW;
          label(c, e === 0 ? '1' : `10${SUPS[String(e)]}`, xx, y + 17, { color: TOKENS.ink3, size: 10, align: e === 0 ? 'left' : 'center' });
        }
        const title = spec ? 'counts / pixel' : 'X-rays per pixel';
        if (fits(c, title, g.x + barW + 10, cvD.w)) label(c, title, g.x + barW + 10, y + 7, { color: TOKENS.ink2, size: 10.5 });
      } else {
        const L = lut('rdbu');
        const grad = c.createLinearGradient(g.x, 0, g.x + barW, 0);
        for (let i = 0; i <= 8; i++) {
          const k = Math.min(255, ((i / 8) * 255) | 0) * 3;
          grad.addColorStop(i / 8, `rgb(${L[k]},${L[k + 1]},${L[k + 2]})`);
        }
        c.fillStyle = grad;
        c.fillRect(g.x, y, barW, 6);
        label(c, spec ? '−1' : 'dimmer', g.x, y + 17, { color: TOKENS.ink3, size: 10 });
        label(c, '0', g.x + barW / 2, y + 17, { color: TOKENS.ink3, size: 10, align: 'center' });
        label(c, spec ? '+1' : 'brighter', g.x + barW, y + 17, { color: TOKENS.ink3, size: 10, align: 'right' });
        const title = spec ? '[I(q) − I(−q)] / sum' : 'than its mirror point';
        if (fits(c, title, g.x + barW + 10, cvD.w)) label(c, title, g.x + barW + 10, y + 7, { color: TOKENS.ink2, size: 10.5 });
        if (s.asym < 0.01) label(c, spec ? 'I(q) = I(−q): centro-symmetric' : 'perfectly symmetric', cx, g.y + 18, { color: TOKENS.good, size: 11, weight: 600, align: 'center' });
      }
      // hover probe
      if (hover.panel === 'd') {
        const i = Math.floor((hover.x - g.x) / px);
        const j = Math.floor((hover.y - g.y) / px);
        if (i >= 0 && j >= 0 && i < N && j < N) {
          const k = j * N + i;
          const qx = (i - N / 2) * DQ;
          const qy = (N / 2 - j) * DQ;
          const cnt = sim.counts[k];
          const lines =
            st.view === 'asym'
              ? [Number.isFinite(sim.asymMap[k]) ? `${spec ? 'asymmetry' : 'lopsidedness'} ${signed(sim.asymMap[k], 2)}` : spec ? 'below 1 photon (masked)' : 'too faint to tell']
              : spec
                ? [`${sci(cnt)} counts`, `Δq = (${qx.toFixed(3)}, ${qy.toFixed(3)}) nm⁻¹`]
                : [`${sci(cnt)} X-ray${cnt === 1 ? '' : 's'} in this pixel`];
          tooltip(c, cvD.w, cvD.h, hover.x, hover.y, lines);
          c.save();
          c.strokeStyle = 'rgba(255,255,255,0.8)';
          c.strokeRect(g.x + i * px, g.y + j * px, Math.max(1, px), Math.max(1, px));
          c.restore();
        }
      }
    }

    function drawRec(): void {
      const c = cvR.ctx;
      const g = (geo.r = geoOf(cvR));
      c.clearRect(0, 0, cvR.w, cvR.h);
      const full = rc.phase === 'done' || rc.phase === 'paused';
      const R = clamp(Math.round(((full ? 1 : 0.6) * g.s * cvR.dpr) / 1.15), 110, 400);
      if (layers.rec.resize(R)) recDirty = true;
      if (recDirty || (recFull && full)) {
        recDirty = false;
        recFull = false;
        const inv = 1 / rc.ampRef;
        const sampler: Sampler = (x, y, o) => {
          // bilinear interpolation of the aligned complex estimate
          const fi = x / DX + N / 2;
          const fj = N / 2 - y / DX;
          const i0 = Math.floor(fi);
          const j0 = Math.floor(fj);
          if (i0 < 0 || j0 < 0 || i0 >= N - 1 || j0 >= N - 1) {
            o[0] = 0;
            return;
          }
          const tx = fi - i0;
          const ty = fj - j0;
          const k = j0 * N + i0;
          const w00 = (1 - tx) * (1 - ty);
          const w10 = tx * (1 - ty);
          const w01 = (1 - tx) * ty;
          const w11 = tx * ty;
          const re = dispRe[k] * w00 + dispRe[k + 1] * w10 + dispRe[k + N] * w01 + dispRe[k + N + 1] * w11;
          const im = dispIm[k] * w00 + dispIm[k + 1] * w10 + dispIm[k + N] * w01 + dispIm[k + N + 1] * w11;
          const a = Math.sqrt(re * re + im * im) * inv;
          o[0] = a > 1 ? 1 : a;
          o[1] = Math.atan2(im, re);
        };
        renderField(layers.rec.img, VIEW, sampler, planeVec(), 1.25, 0.72);
        layers.rec.commit();
      }
      const waiting = rc.phase === 'waiting';
      c.save();
      c.imageSmoothingEnabled = true;
      if (waiting) c.globalAlpha = 0.3;
      c.drawImage(layers.rec.canvas, g.x, g.y, g.s, g.s);
      c.restore();
      // support outline (shrink-wrap)
      if (!waiting) {
        const px = (DX / FOV) * g.s;
        const [ox, oy] = toPx(g, (0 - N / 2 - 0.5) * DX, (N / 2 + 0.5) * DX);
        c.save();
        c.beginPath();
        c.rect(g.x, g.y, g.s, g.s);
        c.clip();
        c.strokeStyle = accent;
        c.globalAlpha = rc.phase === 'done' ? 0.45 : 0.8;
        c.lineWidth = 1.2;
        c.beginPath();
        const i0 = Math.max(0, Math.floor((g.x - ox) / px) - 1);
        const i1 = Math.min(N - 1, Math.ceil((g.x + g.s - ox) / px) + 1);
        const j0 = Math.max(0, Math.floor((g.y - oy) / px) - 1);
        const j1 = Math.min(N - 1, Math.ceil((g.y + g.s - oy) / px) + 1);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const v = dispSup[j * N + i];
            if (i < N - 1 && v !== dispSup[j * N + i + 1]) {
              const x = ox + (i + 1) * px;
              c.moveTo(x, oy + j * px);
              c.lineTo(x, oy + (j + 1) * px);
            }
            if (j < N - 1 && v !== dispSup[(j + 1) * N + i]) {
              const y = oy + (j + 1) * px;
              c.moveTo(ox + i * px, y);
              c.lineTo(ox + (i + 1) * px, y);
            }
          }
        }
        c.stroke();
        c.restore();
      }
      scaleBar(c, g, (100 / FOV) * g.s, '100 nm');
      frameImage(c, g);
      phaseBar(c, g, cvR.w, station.depth === 'specialist' ? 'arg ψ, brightness |ψ|' : undefined);
      // longest label that fits between the scale-bar text and the right edge of the image
      const room = 0.889 * g.s - 48;
      c.save();
      c.font = `600 11.5px ${FONT}`;
      const opts = station.depth === 'specialist' ? ['↻ New random start', '↻ New start', '↻'] : ['↻ Rebuild again', '↻ Again', '↻'];
      const bt = opts.find((t) => c.measureText(t).width + 24 <= room) ?? '↻';
      c.restore();
      if (recBtn.textContent !== bt) recBtn.textContent = bt;
      recBtn.setAttribute('aria-label', 'Start the reconstruction again from a new random guess');
      recBtn.style.right = `${Math.round(cvR.w - (g.x + g.s) + 8)}px`;
      recBtn.style.top = `${Math.round(g.y + g.s - 8 - 26)}px`;
      // status badge
      const spec = station.depth === 'specialist';
      let badge = '';
      let col: string = TOKENS.ink2;
      if (waiting) badge = spec ? 'new data…' : 'new pattern — starting…';
      else if (rc.phase === 'done') {
        badge = al.match > 0.9 ? `✓ ${(al.match * 100).toFixed(0)} % match` : `${(al.match * 100).toFixed(0)} % match`;
        col = al.match > 0.9 ? TOKENS.good : TOKENS.warn;
      } else if (rc.phase === 'paused') badge = 'paused';
      else if (!motion.on) badge = spec ? 'phasing…' : 'rebuilding…';
      else badge = `${algoAt(pr.iter)} ${pr.iter}`;
      if (performance.now() - rc.stuckFlash < 2200) {
        badge = spec ? 'stalled → new start' : 'stuck → new guess';
        col = TOKENS.warn;
      }
      c.save();
      c.font = `600 10.5px ${FONT}`;
      const bw = c.measureText(badge).width + 14;
      c.fillStyle = 'rgba(8,12,20,0.8)';
      c.beginPath();
      c.roundRect(g.x + g.s - bw - 6, g.y + 6, bw, 19, 9);
      c.fill();
      c.restore();
      label(c, badge, g.x + g.s - 13, g.y + 19.5, { color: col, size: 10.5, weight: 600, align: 'right' });
      if (rc.phase !== 'waiting' && al.twin && pr.iter > 30) {
        c.save();
        c.font = `600 10px ${FONT}`;
        const tw = c.measureText('twin, flipped back').width + 12;
        c.fillStyle = 'rgba(8,12,20,0.8)';
        c.beginPath();
        c.roundRect(g.x + g.s - tw - 6, g.y + 29, tw, 17, 8);
        c.fill();
        c.restore();
        label(c, 'twin, flipped back', g.x + g.s - 12, g.y + 41, { color: TOKENS.ink2, size: 10, align: 'right' });
      }
      // hover probe
      if (hover.panel === 'r' && !waiting) {
        const [x, y] = toNm(g, hover.x, hover.y);
        const fi = x / DX + N / 2;
        const fj = N / 2 - y / DX;
        const i = Math.round(fi);
        const j = Math.round(fj);
        if (i >= 0 && j >= 0 && i < N && j < N) {
          const k = j * N + i;
          const a = Math.hypot(dispRe[k], dispIm[k]) / rc.ampRef;
          if (a > 0.3) {
            const p = Math.atan2(dispIm[k], dispRe[k]);
            const Rf = REFLECTIONS[st.refl];
            const uA = p / Rf.gMag;
            tooltip(c, cvR.w, cvR.h, hover.x, hover.y, spec ? [`φ = ${signed(p, 2)} rad (mod 2π)`, `|ψ| = ${a.toFixed(2)}`] : [`atoms shifted ${signed(uA / 10, 3)} nm`, '(as rebuilt)']);
          }
        }
      }
    }

    function drawChart(): void {
      const c = cvC.ctx;
      const w = cvC.w;
      const h = cvC.h;
      c.clearRect(0, 0, w, h);
      const spec = station.depth === 'specialist';
      const rect = { x: 0, y: 18, w: w - 4, h: h - 20 };
      const yMin = 0.003;
      const xt = w < 360 ? [0, 200, 400, 600] : [0, 100, 200, 300, 400, 500, 600];
      const f = plotFrame(c, rect, { min: 0, max: PR_ITERS, label: dual('guesses (iterations)', 'iteration'), ticks: xt }, { min: yMin, max: 1, log: true, label: dual('error', 'error'), ticks: [0.01, 0.1, 1], format: (v) => (v >= 1 ? '1' : v >= 0.1 ? '0.1' : '0.01') });
      // ER bands
      c.save();
      c.fillStyle = 'rgba(255,255,255,0.045)';
      for (let b = 40; b < 500; b += 50) c.fillRect(f.px(b), f.y1, f.px(b + 10) - f.px(b), f.y0 - f.y1);
      c.fillRect(f.px(500), f.y1, f.px(600) - f.px(500), f.y0 - f.y1);
      c.restore();
      if (f.x1 - f.x0 > 260) {
        // the first HIO block and ER band are only 25 iterations apart: label them only where the words do not touch
        if (f.px(45) - f.px(20) >= 26) {
          label(c, 'HIO', f.px(20), f.y1 + 11, { color: TOKENS.ink3, size: 9.5, align: 'center' });
          label(c, 'ER', f.px(45), f.y1 + 11, { color: TOKENS.ink3, size: 9.5, align: 'center' });
        }
        label(c, 'ER polish', f.px(550), f.y1 + 11, { color: TOKENS.ink3, size: 9.5, align: 'center' });
      }
      // decision point
      c.save();
      c.strokeStyle = 'rgba(251,191,36,0.35)';
      c.setLineDash([2, 3]);
      c.beginPath();
      c.moveTo(f.px(DECIDE_AT), f.y0);
      c.lineTo(f.px(DECIDE_AT), f.y1);
      c.stroke();
      c.restore();
      // noise floor
      const fl = clamp(floor, yMin, 1);
      line(c, f, [0, PR_ITERS], [fl, fl], 'rgba(183,195,210,0.55)', 1, [5, 4]);
      // above the dashed line, or below it when that would collide with the HIO/ER/ER-polish labels at the top
      const fy = f.py(fl) - 4 < f.y1 + 24 ? f.py(fl) + 13 : f.py(fl) - 4;
      const ft = dual('photon-noise floor', 'Poisson floor');
      c.save();
      c.font = `500 10px ${FONT}`;
      const fw = c.measureText(ft).width;
      c.fillStyle = 'rgba(5,8,14,0.72)';
      c.fillRect(f.x1 - fw - 7, fy - 10, fw + 6, 13);
      c.restore();
      label(c, ft, f.x1 - 4, fy, { color: TOKENS.ink3, size: 10, align: 'right' });
      // ghosts of stuck attempts
      for (const gh of rc.ghosts) line(c, f, xs300, clampArr(gh, yMin), 'rgba(154,166,184,0.35)', 1.2);
      // current error, HIO faint / ER bright
      const it = Math.min(pr.iter, PR_ITERS);
      if (rc.phase !== 'waiting' && it > 1) {
        for (let k = 0; k < it; k++) {
          errY[k] = Math.max(yMin, pr.err[k]);
          // err[k] is measured on the iterate made by step k − 1: highlight the outputs of ER steps
          errER[k] = k > 0 && algoAt(k - 1) === 'ER' ? errY[k] : NaN;
        }
        errY.fill(NaN, it);
        errER.fill(NaN, it);
        line(c, f, xsAll, errY, hexA(accent, 0.38), 1);
        line(c, f, xsAll, errER, accent, 2);
        // difference from truth (sampled every 5 iterations)
        let m = 0;
        for (let k = 0; k < it; k++) {
          const v = matchHist[k];
          if (v === v) {
            mx5[m] = k + 1;
            my5[m] = Math.max(yMin, 1 - v);
            m++;
          }
        }
        line(c, f, mx5.subarray(0, m), my5.subarray(0, m), TOKENS.ink, 1.4, [4, 3]);
      }
      // legend (one line when it fits, otherwise two)
      const narrow = f.x1 - f.x0 < 220;
      const t1 = spec ? 'Fourier error (data misfit)' : narrow ? 'misfit to pattern' : 'misfit to the pattern';
      const t2 = spec ? '1 − overlap (truth)' : narrow ? 'off from real crystal' : 'difference from the real crystal';
      c.save();
      c.font = `500 10px ${FONT}`;
      const w1 = c.measureText(t1).width;
      const w2 = c.measureText(t2).width;
      c.restore();
      const lx = f.x0 + 8;
      const oneLine = 48 + w1 + w2 < f.x1 - f.x0 - 12;
      const ly1 = oneLine ? f.y0 - 10 : f.y0 - 23;
      const lx2 = oneLine ? lx + 28 + w1 : lx;
      const ly2 = f.y0 - 10;
      c.save();
      c.fillStyle = 'rgba(5,8,14,0.75)';
      c.fillRect(lx - 4, ly1 - 8, (oneLine ? 52 + w1 + w2 : 24 + Math.max(w1, w2)), ly2 - ly1 + 16);
      c.lineWidth = 2;
      c.strokeStyle = accent;
      c.beginPath();
      c.moveTo(lx, ly1);
      c.lineTo(lx + 16, ly1);
      c.stroke();
      c.strokeStyle = TOKENS.ink;
      c.setLineDash([4, 3]);
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(lx2, ly2);
      c.lineTo(lx2 + 16, ly2);
      c.stroke();
      c.restore();
      label(c, t1, lx + 20, ly1 + 3.5, { color: TOKENS.ink2, size: 10 });
      label(c, t2, lx2 + 20, ly2 + 3.5, { color: TOKENS.ink2, size: 10 });
    }

    // err[k] is measured after k completed iterations
    const xsAll = Float64Array.from({ length: PR_ITERS }, (_, i) => i);
    const xs300 = Float64Array.from({ length: DECIDE_AT }, (_, i) => i);
    const errY = new Float64Array(PR_ITERS);
    const errER = new Float64Array(PR_ITERS);
    const mx5 = new Float64Array(PR_ITERS);
    const my5 = new Float64Array(PR_ITERS);
    const ghostBuf = new Float64Array(DECIDE_AT);
    function clampArr(a: Float32Array, lo: number): Float64Array {
      for (let i = 0; i < DECIDE_AT; i++) ghostBuf[i] = Math.max(lo, a[i]);
      return ghostBuf;
    }
    function hexA(col: string, a: number): string {
      const m = /^#([0-9a-f]{6})$/i.exec(col.trim());
      if (!m) return col;
      const v = parseInt(m[1], 16);
      return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
    }

    // ── main loop
    setMode(st.mode);
    let lastReadouts = 0;
    let lastPulse = 0;
    let lastRec = 0;
    let lastChart = 0;
    // phase-retrieval time per frame (ms): shrinks when frames run long (slow or busy CPU) so drawing stays ≥ 30 fps
    let budget = 9;
    loop(station, (dt, t) => {
      if (layoutDirty) relayout();
      if (thumbsDirty) renderThumbs();
      if (fieldDirty || dataDirty) rebuild();
      else if (!interacting()) {
        // input settled: finish the work deferred during the drag
        if (analysisStale) settle();
        if (truthLowRes) dirty.t = true;
      }
      const now = performance.now();
      if (rc.phase === 'waiting' && now >= rc.restartAt && !dragging) startRecon();
      if (rc.phase === 'running') {
        budget = clamp(budget + (24 - dt * 1000) * 0.25, 3, 10);
        // reduced motion, results only: panels 3 and 4 are not redrawn meanwhile, so phasing may use most of the frame
        if (motion.on) iterate(budget);
        else iterate(28, 24);
      }
      // Redraw budget: text readouts ≤ 10 Hz, chart ≤ 20 Hz and reconstruction ≤ 30 Hz while phasing, the pulsing
      // "drag me" ring ≤ 20 Hz; everything else only when dirty. Keeps slow laptops responsive while iterating.
      const running = rc.phase === 'running';
      if (now - lastReadouts > (running ? 100 : 250)) {
        lastReadouts = now;
        updateRunReadouts();
      }
      if (running) updateCaption();
      // reduced motion: panels 3 and 4 hold while the computer works (input still redraws panels 1 and 2)
      const hold = running && !motion.on && !showRun;
      showRun = false;
      if (dirty.t || (st.mode === 'dislocation' && !dragged && motion.on && now - lastPulse > 50)) {
        dirty.t = false;
        lastPulse = now;
        drawTruth(t);
      }
      if (dirty.d) {
        dirty.d = false;
        drawDet();
      }
      if (dirty.r && !hold && (!running || now - lastRec > 33)) {
        dirty.r = false;
        lastRec = now;
        drawRec();
      }
      if (dirty.c && !hold && (!running || now - lastChart > 50)) {
        dirty.c = false;
        lastChart = now;
        drawChart();
      }
      if (performance.now() - rc.stuckFlash < 2400) dirty.r = true;
    });

    const setDepth = (d: Depth) => {
      station.setDepth(d);
      for (const [el, v, s] of titles) el.textContent = d === 'specialist' ? s : v;
      for (const f of relabel) f();
      setPanelLabels();
      updateReadouts();
      updateRunReadouts();
      updateCaption(true);
      truthDirty = true;
      recDirty = true;
      markAll();
    };
    setDepth(ctx.depth);

    return {
      destroy: () => station.destroy(),
      setDepth,
    };
  },
};

export default mod;

// re-exported for the unit tests (pure physics lives in ./bcdi/physics and ./bcdi/phasing)
export { BraggSim, NU };
