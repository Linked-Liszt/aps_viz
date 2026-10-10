/**
 * Station "Chemistry at the nanoscale, while it happens": scanning X-ray fluorescence (XRF) nanoprobe at ISN (19-ID-E).
 *
 * What it simulates (equations, data sources and approximations in nanoprobe/physics.ts, sample.ts, scan.ts):
 *  - A synthetic 100 nm slice through W-doped NMC811 battery-cathode particles (~300 nm grains, W on grain
 *    boundaries), optionally charged in an in situ cell between scans (intergranular cracking, Mn leaching;
 *    illustrative and accelerated).
 *  - A Gaussian probe of the delivered FWHM rasters over a 3.2 µm field; each pixel's areal masses are the
 *    probe-weighted average of the 6.25 nm ground truth; counts are Poisson with
 *      N = Φ t (Ω/4π) m σ_F(E₀),   σ_F from xraylib (Kissel, with cascades); zero below each absorption edge.
 *  - Smallest spot = diffraction limit s_d ≈ 390 nm·keV/E₀ (FDR: 39 nm @10 keV, 16 nm @25 keV ≈ 0.88 λq/(L sinθ)).
 *  - Flux into the spot: APS-U from FDR Table 4.52 (3.5×10¹² ph/s coherent @10 keV, 3.4×10¹¹ @25 keV; ×2.5–9 with
 *    the BDAs open), "APS" = the same optics on the pre-2023 source (÷ facility coherent-flux ratio, ≈160–580×;
 *    larger spots recover the old beam's incoherent modes, so the gain falls to ~10–20× for µm spots).
 *    Detector input capped at 3×10⁷ cps by attenuation (7-element SDD/Xspress3; illustrative).
 *  - XRF spectrum: Kα1/Kα2/Kβ (Mn, Co, Ni) and W L₃/L₂/L₁ lines at xraylib energies, SDD resolution
 *    (Fano 0.115, 50 eV noise → 127 eV at Mn Kα), flat shelf, Rayleigh + Compton scatter at 90° in the
 *    polarisation plane; summed spectrum and the current pixel are Poisson realisations.
 *  - Time and dose: map time = pixels × dwell (stage ≤ 1 mm/s); for equal counts the other source needs a dwell
 *    Φ_this/Φ_other × longer (again floored by the stage speed, so APS-U's advantage saturates for big steps / short
 *    dwells); dose = Φt/step² · E₀ · μ_en/ρ, the same for both sources at equal counts.
 * Illustrative choices are labelled in the specialist text: detector solid angle (0.1 sr) and throughput,
 * the 10 µm electrolyte scatterer, crack/leach kinetics, Gaussian probe, step-scan (no fly-scan smear).
 */
import type { Depth } from '../../app/store';
import type { ExplainerModule } from './registry';
import { button, canvas2d, createStation, group, loop, motionGate, note, readout, slider, toggle, type SliderHandle } from './kit';
import { rng } from '../../lib/fft';
import {
  DET,
  EL_KEYS,
  ELEMENTS,
  OMEGA_FRAC,
  SAMPLE,
  W_EDGES,
  doseGy,
  effectiveDwell,
  elementXS,
  equalCountsMapTime,
  fmtCounts,
  fmtLenNm,
  fmtTime,
  focusedFlux,
  isExcited,
  scatterDCS,
  sci,
  spotMinNm,
  STAGE_V,
  type SourceKey,
} from './nanoprobe/physics';
import { CELL_STATES, FOV_NM, allocComposition, bulkAreal, buildGeometry, composition, truthRGBA, type Geometry } from './nanoprobe/sample';
import { NCH, Pyramid, ScanRun, Spectrum } from './nanoprobe/scan';
import { HeroView, MapsView, SpectrumView, timeMeter } from './nanoprobe/views';

const DEF = { E0: 13, spot: 30, step: 15, dwell: 1e-4, src: 'apsu' as SourceKey };
/** real time per in situ step shown on the time meter (illustrative: a C/2 charge, 2 h, in ~6 snapshots → ~20 min each) */
const INSITU_STEP_S = 20 * 60;
const EL_COLORS = { Ni: ELEMENTS.Ni.color, Mn: ELEMENTS.Mn.color, Co: ELEMENTS.Co.color, W: ELEMENTS.W.color };

/** the geometry is deterministic and costs ~100 ms: build once per page */
let GEOM: Geometry | null = null;

interface Derived {
  spot: number;
  limited: boolean;
  regime: string;
  nx: number;
  step: number;
  dwell: number;
  stageLimited: boolean;
  fluxU: number;
  fluxA: number;
  /** after attenuation */
  effU: number;
  effA: number;
  att: number;
  rate: number;
  photons: number;
  counts: { Ni: number; Mn: number; Co: number; W: number };
  tSel: number;
  tU: number;
  tA: number;
  /** APS-U at the chosen dwell, and the old APS for the same counts (APS-U-quality maps) */
  tCleanU: number;
  tCleanA: number;
  /** the APS-U side of the comparison is limited by the scan-stage speed */
  uStage: boolean;
  dose: number;
  animDur: number;
  speedLabel: string;
}

const mod: ExplainerModule = {
  title: 'Chemistry at the nanoscale, while it happens',
  subtitle: 'Shrink the X-ray spot, tune its energy, and map the elements in a battery particle as it charges.',
  mount(host, ctx) {
    const station = createStation(host, { depth: ctx.depth, color: ctx.color, layout: 'side' });
    const accent = /^#[0-9a-f]{6}$/i.test(ctx.color) ? ctx.color : '#5cd3ff';
    const rand = rng(20260906);
    const isSpec = () => station.depth === 'specialist';

    // ------------------------------------------------------------------ sample
    const geom = (GEOM ??= buildGeometry(7));
    let comp = allocComposition(geom.n);
    let compNext = allocComposition(geom.n);
    const pyr = new Pyramid();
    const truth = document.createElement('canvas');
    truth.width = geom.n;
    truth.height = geom.n;
    const truthCtx = truth.getContext('2d')!;
    let truthImg = new ImageData(geom.n, geom.n);
    let truthNext = new ImageData(geom.n, geom.n);
    let cellIdx = 0;
    let truthVersion = 0;
    const rebuildSample = () => {
      truthVersion++;
      composition(geom, CELL_STATES[cellIdx], comp);
      truthRGBA(geom, comp, EL_COLORS, truthImg.data);
      truthCtx.putImageData(truthImg, 0, 0);
      pyr.build(comp, geom.n);
    };
    rebuildSample();
    /** the next in situ state is prepared a few rows per frame during the pause between scans */
    let prep: { idx: number; row: number } | null = null;
    const stepPrep = (rows: number) => {
      if (!prep) return;
      const j1 = Math.min(geom.n, prep.row + rows);
      composition(geom, CELL_STATES[prep.idx], compNext, prep.row, j1);
      truthRGBA(geom, compNext, EL_COLORS, truthNext.data, prep.row, j1);
      prep.row = j1;
    };
    const commitPrep = () => {
      if (!prep) return;
      stepPrep(geom.n);
      [comp, compNext] = [compNext, comp];
      [truthImg, truthNext] = [truthNext, truthImg];
      cellIdx = prep.idx;
      prep = null;
      truthVersion++;
      truthCtx.putImageData(truthImg, 0, 0);
      pyr.build(comp, geom.n);
    };

    // ------------------------------------------------------------------ canvases
    const heroC = canvas2d(station.visual, { label: '1 · Sample + X-ray spot' });
    const mapsC = canvas2d(station.visual, { label: '2 · Element maps' });
    const specC = canvas2d(station.visual, { label: '3 · X-ray fluorescence spectrum' });
    const wraps = { hero: heroC.canvas.parentElement!, maps: mapsC.canvas.parentElement!, spec: specC.canvas.parentElement! };
    const hero = new HeroView(heroC);
    const maps = new MapsView(mapsC);
    const specView = new SpectrumView(specC);
    const spectrum = new Spectrum();

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
      const root = station.root.style;
      station.root.classList.toggle('stn-side', m === 'wide');
      station.root.classList.toggle('stn-stack', m !== 'wide');
      root.overflowY = m === 'wide' ? '' : 'auto';
      root.gridTemplateRows = m === 'wide' ? '' : 'max-content max-content max-content';
      root.gridTemplateColumns = m === 'wide' ? 'minmax(0, 1fr) 272px' : '';
      station.controls.style.gridTemplateColumns = m === 'narrow' ? 'minmax(0, 1fr)' : '';
      // stacked: "what you are seeing" right under the pictures, controls after it
      station.caption.style.order = m === 'wide' ? '' : '1';
      station.controls.style.order = m === 'wide' ? '' : '2';
      // wide: reserve two caption lines so the pictures do not jump when the caption shortens
      station.caption.style.minHeight = m === 'wide' ? '64px' : '';
      wraps.hero.style.gridArea = 'hero';
      wraps.maps.style.gridArea = 'maps';
      wraps.spec.style.gridArea = 'spec';
      const v = station.visual.style;
      const inner = W - 16;
      if (m === 'narrow') {
        v.gridTemplateColumns = 'minmax(0, 1fr)';
        v.gridTemplateRows = 'auto auto auto';
        v.gridTemplateAreas = '"hero" "maps" "spec"';
        v.height = '';
        wraps.hero.style.height = `${Math.round(Math.min(560, inner * 0.92 + 50))}px`;
        wraps.maps.style.height = `${Math.round(Math.min(620, inner * 0.98 + 60))}px`;
        wraps.spec.style.height = `${Math.round(Math.max(270, Math.min(360, inner * 0.68)))}px`;
      } else {
        v.gridTemplateColumns = 'minmax(0, 1fr) minmax(0, 1.12fr)';
        v.gridTemplateRows = 'minmax(0, 1.7fr) minmax(0, 1fr)';
        v.gridTemplateAreas = '"hero maps" "spec spec"';
        v.height = m === 'mid' ? `${Math.round(Math.min(860, inner * 0.82 + 40))}px` : '';
        for (const wr of Object.values(wraps)) wr.style.height = '100%';
      }
      dirty = true;
    };
    const ro = new ResizeObserver(() => applyLayout());
    ro.observe(host);
    station.onDestroy(() => ro.disconnect());

    // ------------------------------------------------------------------ parameters
    const P = { ...DEF, insitu: false };
    const relabel = (input: HTMLElement, text: string) => {
      const l = input.closest('.stn-slider, .stn-readout')?.querySelector('.stn-slider-label, .stn-readout-label');
      if (l) l.textContent = text;
    };
    const specOnly: HTMLElement[] = [];

    // 0. toolbar: scan / reset, and the in situ switch (the station's headline action)
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    station.controls.appendChild(btnRow);
    button(btnRow, '▶ Scan again', () => restart(), 'is-primary');
    button(btnRow, '↺ Reset', () => reset());
    // reduced motion: scans are computed without the moving beam and appear when done
    const motion = motionGate(station, btnRow, {
      play: '▶ Animate scans',
      pause: '❚❚ Results only',
      title: 'Your device asks for reduced motion: each scan appears when it is done. Press to watch the beam raster across the sample.',
      onChange: (on) => {
        if (on && scanning && run) elapsed = (run.idx / run.total) * d.animDur;
        dirty = true;
      },
    });
    const insituToggle = toggle<'off' | 'on'>(station.controls, {
      label: 'Battery cell',
      options: [
        { value: 'off', label: 'Hold still', title: 'The sample stays as it is between scans' },
        { value: 'on', label: '⚡ Charge it (in situ)', title: 'Charge the battery: the sample changes before every new scan' },
      ],
      value: 'off',
      onChange: (v) => setInsitu(v === 'on'),
    });

    // 1. beam
    const gBeam = group(station.controls, 'X-ray beam');
    const eSlider = slider(gBeam, {
      label: 'X-ray energy',
      min: 5,
      max: 25,
      log: true,
      value: P.E0,
      format: (v) => `${v.toFixed(2)} keV`,
      onInput: (v) => {
        P.E0 = v;
        spotSlider.set(spotSlider.get());
        queueRestart();
      },
    });
    edgeTicks(eSlider, 5, 25);
    const spotSlider: SliderHandle = slider(gBeam, {
      label: 'Spot size',
      min: 20,
      max: 1000,
      log: true,
      value: P.spot,
      format: (v) => {
        const sd = spotMinNm(P.E0);
        return v < sd ? `${fmtLenNm(sd)} (min)` : fmtLenNm(v);
      },
      onInput: (v) => {
        P.spot = v;
        queueRestart();
      },
    });
    note(
      gBeam,
      station,
      'An element glows only if the X-rays carry enough energy to knock out one of its inner electrons: its **edge** (ticks under the slider). Higher energy also allows a **smaller spot**.',
      'Fluorescence needs E₀ above the edge: K for Mn/Co/Ni (6.539/7.709/8.333 keV), L₃/L₂/L₁ for W (10.207/11.544/12.100 keV). σ_{F} = τ_{shell}ω p falls ≈ E^{−2.7} above an edge, so excite just above it. The KB focus is achromatic but diffraction-limited: s_{min} ≈ 0.88 λq/(L sinθ); FDR: 39 nm at 10 keV, 16 nm at 25 keV.',
    );

    // 2. source (before the scan group: the APS vs APS-U comparison stays above the fold)
    const gSrc = group(station.controls, 'X-ray source');
    const srcToggle = toggle<SourceKey>(gSrc, {
      options: [
        { value: 'apsu', label: 'APS-U (2024–)', title: 'The upgraded multi-bend-achromat storage ring' },
        { value: 'aps', label: 'APS (pre-2023)', title: 'The original APS storage ring (1996–2023), same beamline optics' },
      ],
      value: P.src,
      onChange: (v) => {
        P.src = v;
        queueRestart();
      },
    });
    const meter = timeMeter(gSrc, accent);
    const fluxRO = readout(gSrc, 'X-rays hitting the spot');
    note(
      gSrc,
      station,
      "APS-U's beam is far more **laser-like** (coherent), so hundreds of times more X-rays squeeze into the tiny spot. The gain is biggest for the **smallest** spots.",
      'APS-U: FDR Table 4.52 design flux (3.5×10^{12} ph/s coherent in 39 nm, 8.9×10^{12} with BDAs open at 10 keV; 3.4×10^{11} / 3.1×10^{12} at 25 keV), scaled in energy with the facility coherent-flux curve. *APS* = the same optics on the 2019 source: ÷ the coherent-flux ratio (≈160× at 10 keV, ≈350× at 25 keV) at the coherent spot; bigger spots admit the old beam\'s extra modes (accepted phase space ∝ spot per plane, up to its 0.43 × 0.05 µm image), so the gain falls to ~10–20× for µm spots. Good to ~×2. Pre-upgrade nanoprobes used zone plates (~10× less efficient): the PDR quotes 10^{3}–10^{4}.',
    );

    // 3. scan
    const gScan = group(station.controls, 'Scan');
    const stepSlider = slider(gScan, {
      label: 'Step (pixel size)',
      min: 12.5,
      max: 400,
      log: true,
      value: P.step,
      format: (v) => {
        const nx = Math.max(8, Math.min(256, Math.round(FOV_NM / v)));
        return `${fmtLenNm(FOV_NM / nx)} · ${nx}²`;
      },
      onInput: (v) => {
        P.step = v;
        queueRestart();
      },
    });
    const dwellSlider = slider(gScan, {
      label: 'Time per pixel',
      min: 2e-5,
      max: 2e-2,
      log: true,
      value: P.dwell,
      format: (v) => fmtTime(v),
      onInput: (v) => {
        P.dwell = v;
        queueRestart();
      },
    });
    const scanNote = note(gScan, station, '', '');

    // 4. numbers
    const gNum = group(station.controls, 'Per pixel');
    const countsRO = readout(gNum, 'X-rays caught');
    const detRO = readout(gNum, 'Detector input');
    const doseRO = readout(gNum, 'Dose');
    specOnly.push(detRO.el, doseRO.el);
    note(
      gNum,
      station,
      "A map pixel's brightness is the number of that element's X-rays the detector caught there. Few X-rays → grainy maps.",
      'N = Φt (Ω/4π) m σ_{F}(E₀) per line, m = probe-weighted areal mass; Ω = 0.1 sr (7-element SDD, illustrative); input capped at 3×10^{7} cps by attenuation. Maps assume ideal spectral fitting: W Lα₁ (8.398 keV) sits 133 eV from Ni Kβ (8.265 keV), inside one SDD FWHM, so real W maps need full-spectrum fits (e.g. MAPS / XRF-Maps). Dose = Φt/step² · E₀ μ_{en}/ρ: for equal counts it is the same on both sources.',
    );

    // 5. background: the sample and the beamline
    const gAbout = group(station.controls, 'About');
    note(
      gAbout,
      station,
      'The sample: a thin slice of **battery cathode** particles, crystals of nickel, manganese and cobalt oxide, with a pinch of **tungsten** between them. (Lithium is too light to show up.)',
      'Synthetic W-doped NMC811 (LiNi_{0.8}Mn_{0.1}Co_{0.1}O_{2}) slice, 100 nm thick, ρ = 4.75 g/cm³, ~300 nm grains; W ≈ 0.5 mol% on grain boundaries (≤ 12 wt%) and surface. Intergranular cracking above ~4.2 V (H2→H3 collapse) and Mn/Ni leaching are qualitative and accelerated. Li is invisible to XRF.',
    );
    note(
      gAbout,
      station,
      "**Why is ISN 220 m long?** The spot is a shrunken image of a tiny slit far upstream; the shrink factor is (slit → mirror) ÷ (mirror → sample). Leaving ~6 cm of room for a battery cell or furnace keeps the mirrors away from the sample, so the slit must be very far away: 165 m gives ~400× shrinking.",
      '**Why 220 m:** the KB images the BDA (secondary source) demagnified by p/q: KBV 165 m / 0.396 m ≈ 417, KBH 156 m / 0.126 m ≈ 1240. The 61 mm working distance for in situ cells fixes q, so a small image needs a large p. For a diffraction-limited spot (≈ 0.88 λq/A, A = L sinθ ≈ 1.0 / 0.32 mm for the 404 / 129 mm mirrors at 2.5 mrad) the BDA must be coherence-matched, Δ ≈ 0.44 λp/A ≈ 3.6 µm (V, 25 keV); a 5× shorter line would need a sub-µm slit. The BDA also decouples the focus from upstream optics motion (KB stability 5/16 nrad).',
    );

    // ------------------------------------------------------------------ derived quantities
    const bulk = bulkAreal();
    /** counts per incident photon on bulk material (for the detector-rate limit) */
    const perPhoton = (E0: number) => {
      const sc = scatterDCS(E0);
      let y = bulk.ni * elementXS('Ni', E0) + bulk.mn * elementXS('Mn', E0) + bulk.co * elementXS('Co', E0) + bulk.w * elementXS('W', E0);
      y *= OMEGA_FRAC;
      y += DET.omegaSr * (bulk.mass * (sc.rayNMC + sc.comNMC) + SAMPLE.envMass * (sc.rayEnv + sc.comEnv));
      return y;
    };
    const derive = (): Derived => {
      const fu = focusedFlux('apsu', P.E0, P.spot);
      const fa = focusedFlux('aps', P.E0, P.spot);
      const nx = Math.max(8, Math.min(256, Math.round(FOV_NM / P.step)));
      const step = FOV_NM / nx;
      const dwell = effectiveDwell(P.dwell, step);
      const y = perPhoton(P.E0);
      const effU = Math.min(fu.flux, DET.maxCps / y);
      const effA = Math.min(fa.flux, DET.maxCps / y);
      const eff = P.src === 'apsu' ? effU : effA;
      const raw = P.src === 'apsu' ? fu.flux : fa.flux;
      const photons = eff * dwell;
      const sigP = fu.spot / 2.3548;
      const wB = SAMPLE.density * SAMPLE.thicknessNm * 1e-7 * (0.003 + (0.12 * 0.6 * 5) / Math.sqrt(25 + sigP * sigP));
      const k = photons * OMEGA_FRAC;
      const counts = { Ni: k * bulk.ni * elementXS('Ni', P.E0), Mn: k * bulk.mn * elementXS('Mn', P.E0), Co: k * bulk.co * elementXS('Co', P.E0), W: k * wB * elementXS('W', P.E0) };
      const npx = nx * nx;
      const tSel = npx * dwell;
      // equal counts on the other source: dwell scaled by the flux ratio, but never faster than the stage
      const tU = P.src === 'apsu' ? tSel : equalCountsMapTime(npx, dwell, effA, effU, step);
      const tA = P.src === 'aps' ? tSel : equalCountsMapTime(npx, dwell, effU, effA, step);
      // APS-U-quality maps (APS-U at this dwell) and what the old source needs for the same counts
      const tCleanU = npx * dwell;
      const tCleanA = equalCountsMapTime(npx, dwell, effU, effA, step);
      const animDur = Math.max(2.2, Math.min(9, tSel));
      const f = tSel / animDur;
      const speedLabel = f > 1.3 ? `time-lapse ×${f >= 100 ? Math.round(f).toLocaleString('en-US') : f.toFixed(f < 10 ? 1 : 0)}` : f < 0.77 ? `slow motion ×${(1 / f).toFixed(1 / f < 10 ? 1 : 0)}` : '▶ real speed';
      return {
        spot: fu.spot,
        limited: fu.limited,
        regime: fu.regime,
        nx,
        step,
        dwell,
        stageLimited: dwell > P.dwell * 1.0001,
        fluxU: fu.flux,
        fluxA: fa.flux,
        effU,
        effA,
        att: eff / raw,
        rate: eff * y,
        photons,
        counts,
        tSel,
        tU,
        tA,
        tCleanU,
        tCleanA,
        uStage: P.src === 'aps' && (dwell * effA) / effU < step / STAGE_V,
        dose: doseGy(photons, step, P.E0),
        animDur,
        speedLabel,
      };
    };

    // ------------------------------------------------------------------ scan state
    let run: ScanRun | null = null;
    let d = derive();
    let scanning = false;
    let elapsed = 0;
    let pendingPx = 0;
    let pixT = 0;
    let insituWait = 0;
    let ymax = 100;
    let dirty = true;
    /** draw the next frame even while a reduced-motion scan holds the panels (the answer to the input that started it) */
    let showNext = true;
    let specT = 0;
    /** running estimate of the scan engine's cost (ms per pixel), for the per-frame budget */
    let msPerPx = 0.004;
    const mean = new Float64Array(6);
    const tmpSpec = new Float32Array(NCH);
    const bulkS = new Float64Array(6);
    const excited = () => EL_KEYS.map((k) => isExcited(k, P.E0));

    // ------------------------------------------------------------------ aim the parked beam (pointer + arrow keys)
    /** where the beam waits between scans (nm), and the expected spectral components there */
    let park = { ...geom.showcase };
    const parked = new Float64Array(6);
    function aimAt(p: { x: number; y: number }): void {
      park = { x: Math.max(0, Math.min(FOV_NM, p.x)), y: Math.max(0, Math.min(FOV_NM, p.y)) };
      if (!scanning && run) {
        run.expectedAt(park.x, park.y, pyr, parked);
        spectrum.drawPixel(parked, rand);
      }
      dirty = true;
      specT = 0;
    }
    {
      const cv = heroC.canvas;
      cv.tabIndex = 0;
      cv.setAttribute('aria-label', 'Sample and X-ray spot. Between scans, click or use the arrow keys to move the beam and see the spectrum at that spot.');
      let dragging = false;
      const at = (e: PointerEvent) => {
        const r = cv.getBoundingClientRect();
        const p = hero.toNm(e.clientX - r.left, e.clientY - r.top);
        if (p) aimAt(p);
      };
      cv.addEventListener('pointerdown', (e) => {
        if (scanning) return;
        dragging = true;
        try {
          cv.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic / already-released pointer */
        }
        at(e);
      });
      cv.addEventListener('pointermove', (e) => {
        if (dragging && !scanning) at(e);
      });
      const end = () => (dragging = false);
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      // visible keyboard focus (the canvas wrapper clips the canvas's own outline)
      cv.addEventListener('focus', () => {
        if (!cv.matches(':focus-visible')) return;
        wraps.hero.style.outline = `2px solid ${accent}`;
        wraps.hero.style.outlineOffset = '-2px';
      });
      cv.addEventListener('blur', () => (wraps.hero.style.outline = ''));
      cv.addEventListener('keydown', (e) => {
        const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!k || scanning) return;
        e.preventDefault();
        const stepNm = e.shiftKey ? 200 : 25;
        aimAt({ x: park.x + k[0] * stepNm, y: park.y + k[1] * stepNm });
      });
    }

    const computeYmax = () => {
      const k = d.photons * OMEGA_FRAC;
      bulkS[0] = k * bulk.ni * elementXS('Ni', P.E0);
      bulkS[1] = k * bulk.mn * elementXS('Mn', P.E0);
      bulkS[2] = k * bulk.co * elementXS('Co', P.E0);
      bulkS[3] = k * bulk.w * 3 * elementXS('W', P.E0);
      const sc = scatterDCS(P.E0);
      bulkS[4] = d.photons * DET.omegaSr * (bulk.mass * sc.rayNMC + SAMPLE.envMass * sc.rayEnv);
      bulkS[5] = d.photons * DET.omegaSr * (bulk.mass * sc.comNMC + SAMPLE.envMass * sc.comEnv);
      spectrum.expectedInto(bulkS, tmpSpec);
      let mx = 0;
      for (let c = 0; c < NCH; c++) mx = Math.max(mx, tmpSpec[c]);
      // never below 10 counts, so single detected photons (1 count / channel) stay on the plot
      ymax = Math.pow(10, Math.ceil(Math.log10(Math.max(3, mx * 2))));
    };

    /** slider / toggle changes: at most one rebuild per animation frame however fast the input events arrive */
    let restartQueued = false;
    function queueRestart(): void {
      restartQueued = true;
      dirty = true;
    }
    function restart(): void {
      restartQueued = false;
      d = derive();
      const prevComplete = !run || run.done;
      run = new ScanRun({ E0: P.E0, spot: d.spot, nx: d.nx, photons: d.photons }, pyr);
      maps.begin(run, prevComplete);
      spectrum.setup(P.E0);
      computeYmax();
      spectrum.pixel.fill(0);
      pendingPx = 0;
      elapsed = 0;
      pixT = 0;
      scanning = true;
      showNext = true;
      heroC.canvas.style.cursor = '';
      dirty = true;
      updateReadouts();
      refreshCaption();
    }

    function reset(): void {
      Object.assign(P, DEF);
      eSlider.set(P.E0);
      spotSlider.set(P.spot);
      stepSlider.set(P.step);
      dwellSlider.set(P.dwell);
      srcToggle.set(P.src);
      insituToggle.set('off');
      P.insitu = false;
      insituWait = 0;
      prep = null;
      park = { ...geom.showcase };
      if (cellIdx !== 0) {
        cellIdx = 0;
        rebuildSample();
      }
      restart();
    }

    function setInsitu(on: boolean): void {
      P.insitu = on;
      if (on) {
        if (cellIdx >= CELL_STATES.length - 1) {
          cellIdx = 0;
          rebuildSample();
        }
        if (!scanning) insituWait = 0.5;
      } else {
        insituWait = 0;
        prep = null;
      }
      dirty = true;
      updateReadouts();
      refreshCaption();
    }

    function onScanDone(): void {
      scanning = false;
      heroC.canvas.style.cursor = 'crosshair';
      // the beam parks (on the showcase W-rich boundary, or wherever the visitor aimed it): show that spot's spectrum
      aimAt(park);
      if (P.insitu) {
        if (cellIdx < CELL_STATES.length - 1) insituWait = 1.6;
        else {
          P.insitu = false;
          insituToggle.set('off');
        }
      }
      refreshCaption();
    }

    // ------------------------------------------------------------------ readouts & captions
    function updateReadouts(): void {
      const spc = isSpec();
      const sel = P.src === 'apsu' ? d.effU : d.effA;
      fluxRO.set(`${sci(sel)} /s`);
      relabel(fluxRO.el, spc ? `Flux on sample (${P.src === 'apsu' ? 'APS-U' : 'APS'})` : 'X-rays hitting the spot');
      const ex = excited();
      const c = d.counts;
      const parts = (['Ni', 'Mn', 'Co', 'W'] as const).filter((_, i) => ex[i]).map((k) => `${k} ${fmtCounts(c[k])}`);
      countsRO.set(parts.length ? parts.join(' · ') : 'none');
      relabel(countsRO.el, spc ? 'Counts/px' : 'X-rays caught');
      detRO.set(`${sci(d.rate)} cps${d.att < 0.999 ? ` (att. ×${d.att.toFixed(2)})` : ''}`);
      doseRO.set(`${sci(d.dose, 1)} Gy`);
      meter.setHead(spc ? 'Map time for equal counts per pixel' : 'Time to make these maps (same quality)');
      meter.set(d.tU, d.tA, fmtTime, { insituStep: P.insitu || cellIdx > 0 ? INSITU_STEP_S : undefined, selected: P.src, uStage: d.uStage, gain: d.effU / d.effA });
      for (const el of specOnly) el.style.display = spc ? '' : 'none';
      // scan note: sampling advice
      const ratio = d.step / d.spot;
      let vis = ratio > 1.3 ? `Your step (**${fmtLenNm(d.step)}**) is bigger than the spot: the beam skips what lies between the dots.` : ratio < 0.2 ? `Steps much smaller than the **${fmtLenNm(d.spot)}** spot add pixels and time, but no new detail.` : 'A smaller **step** means more pixels: finer detail, but a longer scan.';
      if (d.stageLimited) vis += ` The sample can only be moved 1 mm per second, so each ${fmtLenNm(d.step)} pixel really takes **${fmtTime(d.dwell)}**.`;
      const samp = ratio > 1 ? 'under-sampled: gaps between probe footprints' : ratio > 0.55 ? 'mildly under-sampled (Nyquist wants ≤ FWHM/2)' : ratio < 0.2 ? 'over-sampled: dose and time without resolution' : 'Nyquist-adequate';
      const spcTxt = `Step ${fmtLenNm(d.step)} = ${ratio.toFixed(2)} × FWHM (${samp}). ${d.nx}² px × ${fmtTime(d.dwell)}${d.stageLimited ? ' (stage limit 1 mm/s)' : ''} = ${fmtTime(d.tSel)}. Dose ∝ Φt/step², independent of the source at equal counts.`;
      scanNote.set(vis, spcTxt);
    }

    /** Ni counts per pixel at another energy (same requested spot, dwell, source) */
    const countsAt = (E: number) => {
      const f = focusedFlux(P.src, E, P.spot).flux;
      const eff = Math.min(f, DET.maxCps / perPhoton(E));
      return eff * d.dwell * OMEGA_FRAC * bulk.ni * elementXS('Ni', E);
    };
    function refreshCaption(): void {
      const ex = excited();
      const dark = EL_KEYS.filter((_, i) => !ex[i]);
      const st = CELL_STATES[cellIdx];
      const spot = fmtLenNm(d.spot);
      let v: string;
      if (dark.length === 4) v = `At **${P.E0.toFixed(1)} keV** the beam cannot excite any element in this sample: only scattered X-rays come back. Raise the energy past the manganese edge (6.54 keV).`;
      else if (dark.length > 0) {
        const names = [...dark].sort((a, b) => ELEMENTS[a].edges[0].e - ELEMENTS[b].edges[0].e).map((k) => `**${ELEMENTS[k].name}** (${ELEMENTS[k].edges[0].e.toFixed(2)} keV)`);
        const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
        v = `At **${P.E0.toFixed(1)} keV** the X-rays are not energetic enough to knock out the inner electrons of ${list}, so ${dark.length > 1 ? 'those maps stay' : 'that map stays'} dark. Slide the energy above ${dark.length > 1 ? 'their edges' : 'its edge'}.`;
      } else if (P.src === 'aps') v = `With the old APS, only ~${fmtCounts(d.counts.Mn)} manganese X-rays reach the detector per pixel, so the maps dissolve into noise. Maps as clean as APS-U's would take the old APS **${fmtTime(d.tCleanA)}** instead of **${fmtTime(d.tCleanU)}**.`;
      else if (P.E0 > 17 && d.spot < 30) {
        const xs = elementXS('Ni', 13) / elementXS('Ni', P.E0);
        const fewer = Math.max(2, Math.round(countsAt(13) / Math.max(1e-9, d.counts.Ni)));
        v = `At **${P.E0.toFixed(0)} keV** the spot can shrink to **${spot}**, sharper than ever. But these X-rays are far above the elements' edges, so atoms absorb them ~${Math.round(xs)}× less often${fewer > 1.15 * xs ? ', and fewer X-rays fit into the tinier spot' : ''}: each pixel catches ~${fewer}× fewer nickel X-rays than at 13 keV. Sharpness costs signal.`;
      }
      else if (d.spot > 160) v = `The **${spot}** spot is bigger than the crystal grains (~300 nm), so boundaries${st.crackW > 0 ? ' and cracks' : ''} blur away. Shrink the spot to see them.`;
      else if (d.step > d.spot * 1.3) v = `Each pixel is **${fmtLenNm(d.step)}** apart but the spot is only **${spot}**: the beam hops over most of the sample. Make the step smaller than the spot.`;
      else if (cellIdx > 0 || P.insitu) v = `**${st.volts.toFixed(1)} V.** ${st.visitor}${st.crackW > 0 ? ' Cracks show up as dark lines in every map.' : ''}`;
      else v = `A **${spot}** X-ray spot scans a thin slice of a battery particle. Each element glows at its own X-ray energy (spectrum, panel 3), giving one map per element. **Tungsten** outlines the ~300 nm crystals: visible only because the spot is far smaller than a crystal.`;
      const regime = d.regime === 'coherent' ? 'coherent (BDAs closed)' : d.regime === 'partial' ? 'BDAs partly open' : 'BDAs open / defocused';
      let s = `E₀ = ${P.E0.toFixed(2)} keV${dark.length ? ` (below ${dark.map((k) => ELEMENTS[k].edges[0].label).join(', ')} edge)` : ''}; probe ${spot} FWHM${d.limited ? ` (diffraction limit at ${P.E0.toFixed(1)} keV)` : ''}, ${regime}; Φ = ${sci(P.src === 'apsu' ? d.fluxU : d.fluxA)} ph/s (${P.src === 'apsu' ? 'APS-U' : 'APS'}), gain APS-U/APS = ${Math.round(d.fluxU / d.fluxA)}×${d.att < 0.999 ? `; attenuated ×${d.att.toFixed(2)} to keep the SDD ≤ ${sci(DET.maxCps, 1)} cps` : ''}. Bulk counts/px: Ni ${fmtCounts(d.counts.Ni)}, Mn ${fmtCounts(d.counts.Mn)}, Co ${fmtCounts(d.counts.Co)}, W (boundary) ${fmtCounts(d.counts.W)}.`;
      if (cellIdx > 0 || P.insitu) s += ` Cell: ${st.specialist}`;
      else if (P.E0 > W_EDGES.L3 && P.E0 < W_EDGES.L2) s += ' Only W L₃ lines (Lα, Lβ₂, Lℓ) are excited; Lβ₁/Lγ₁ need E₀ > L₂.';
      else if (d.counts.W < 10 && ex[3]) s += ' W counts are low: detection limit set by counting statistics.';
      station.setCaption(v, s);
    }

    // ------------------------------------------------------------------ depth
    const applyDepth = () => {
      relabel(eSlider.input, isSpec() ? 'Incident energy E₀' : 'X-ray energy');
      relabel(spotSlider.input, isSpec() ? 'Probe FWHM (requested)' : 'Spot size');
      relabel(stepSlider.input, isSpec() ? 'Step · pixels' : 'Step (pixel size)');
      relabel(dwellSlider.input, isSpec() ? 'Dwell per pixel' : 'Time per pixel');
      updateReadouts();
      refreshCaption();
      dirty = true;
    };

    // ------------------------------------------------------------------ first frame: instant scan, then a live one
    applyLayout();
    {
      d = derive();
      // a quick coarse scan as the dim placeholder under the first live scan (no blank maps on load)
      const nx0 = Math.min(d.nx, 64);
      const first = new ScanRun({ E0: P.E0, spot: Math.max(d.spot, FOV_NM / nx0), nx: nx0, photons: d.photons * (d.nx / nx0) ** 2 }, pyr);
      first.finish(pyr, rand);
      maps.begin(first, false);
      maps.update();
      run = first;
    }
    restart();
    applyDepth();

    // ------------------------------------------------------------------ animation
    loop(station, (dt) => {
      if (restartQueued) restart();
      if (scanning && run) {
        // reduced motion: no raster animation, the scan runs as fast as the frame budget allows and shows when done
        const silent = !motion.on;
        elapsed += dt;
        const target = silent ? run.total : run.total * Math.min(1, elapsed / d.animDur);
        const before = run.idx;
        // per-frame budget (~8 ms of probe convolutions, measured): on a slow machine the scan animation
        // stretches instead of the frame rate collapsing
        const cap = silent ? Math.max(150, Math.floor(28 / msPerPx)) : Math.max(150, Math.min(6000, Math.floor(8 / msPerPx)));
        const t0 = performance.now();
        run.advance(Math.min(target, before + cap), pyr, rand);
        const added = run.idx - before;
        if (added >= 100) msPerPx = 0.75 * msPerPx + (0.25 * (performance.now() - t0)) / added;
        if (run.idx < Math.floor(target) && !run.done) elapsed = (run.idx / run.total) * d.animDur;
        if (added > 0) {
          pendingPx += added;
          spectrum.accumulate(run.pending, pendingPx, rand);
          pendingPx = 0;
          maps.update();
          pixT -= dt;
          if (pixT <= 0 && !silent) {
            spectrum.drawPixel(run.last, rand);
            pixT = 0.09;
          }
        }
        if (run.done) onScanDone();
        dirty = true;
      } else if (insituWait > 0) {
        insituWait -= dt;
        dirty = true;
        if (!prep) prep = { idx: Math.min(CELL_STATES.length - 1, cellIdx + 1), row: 0 };
        stepPrep(40);
        if (insituWait <= 0) {
          insituWait = 0;
          commitPrep();
          restart();
        }
      }
      if (!dirty) return;
      if (scanning && !motion.on && !showNext) return;
      showNext = false;
      dirty = false;
      const r = run;
      if (r && r.idx > 0) for (let c = 0; c < 6; c++) mean[c] = r.sums[c] / r.idx;
      else mean.fill(0);
      const st = CELL_STATES[cellIdx];
      const beam = scanning && r ? r.pos(Math.min(r.idx, r.total - 1)) : park;
      const next = CELL_STATES[Math.min(CELL_STATES.length - 1, cellIdx + 1)];
      const pendingDir = next.dir === 'discharging' || next.volts < st.volts ? 'discharging' : 'charging';
      hero.draw({
        truth,
        truthVersion,
        beam,
        spot: d.spot,
        run: r,
        scanning,
        cell: st,
        cellIndex: cellIdx,
        insitu: P.insitu,
        pending: insituWait > 0 ? `${pendingDir} → ${next.volts.toFixed(1)} V…` : '',
        pendingDir,
        hasCracks: st.crackW > 0,
        depth: station.depth,
        accent,
        speedLabel: d.speedLabel,
        hint: isSpec() ? 'click or drag to park the beam (point spectrum)|click to park the beam|click to park' : 'tap the sample to aim the beam|tap to aim the beam|tap to aim',
      });
      maps.draw({ run: r, excited: excited(), scanning, depth: station.depth, accent });
      specT -= dt;
      if (scanning && specT > 0) return;
      specT = 1 / 30;
      specView.draw({ spec: spectrum, mean, hasPixel: !!r && r.idx > 0, E0: P.E0, excited: excited(), depth: station.depth, accent, ymax });
    });
    // a resize clears a canvas: redraw it even while a reduced-motion scan holds the panels
    for (const c of [heroC, mapsC, specC])
      c.onResize(() => {
        dirty = true;
        showNext = true;
      });

    return {
      destroy: () => station.destroy(),
      setDepth: (dp: Depth) => {
        station.setDepth(dp);
        applyDepth();
      },
    };
  },
};
export default mod;

/** absorption-edge ticks under the energy slider (aligned with the thumb travel) */
function edgeTicks(h: SliderHandle, min: number, max: number): void {
  const row = h.input.closest('.stn-slider');
  if (!row) return;
  const strip = document.createElement('div');
  strip.style.cssText = 'position:relative;height:25px;margin-top:-3px;font:600 10px var(--font)';
  strip.setAttribute('aria-hidden', 'true');
  const edges: { e: number; t: string; c: string }[] = [
    { e: 6.539, t: 'Mn', c: ELEMENTS.Mn.color },
    { e: 7.709, t: 'Co', c: ELEMENTS.Co.color },
    { e: 8.333, t: 'Ni', c: ELEMENTS.Ni.color },
    { e: W_EDGES.L3, t: 'W', c: ELEMENTS.W.color },
  ];
  edges.forEach((ed, i) => {
    const f = Math.log(ed.e / min) / Math.log(max / min);
    const lane = i % 2;
    const tick = document.createElement('i');
    tick.style.cssText = `position:absolute;top:0;left:calc(8px + ${f.toFixed(4)} * (100% - 16px));width:1px;height:${lane ? 13 : 5}px;background:${ed.c}`;
    const lab = document.createElement('span');
    lab.textContent = ed.t;
    lab.style.cssText = `position:absolute;top:${lane ? 14 : 5}px;left:calc(8px + ${f.toFixed(4)} * (100% - 16px));transform:translateX(-50%);color:${ed.c};line-height:1`;
    strip.append(tick, lab);
  });
  const lab = document.createElement('span');
  lab.textContent = 'edges';
  lab.style.cssText = 'position:absolute;right:0;top:5px;color:#8394a9;font-weight:500;line-height:1';
  strip.append(lab);
  const hint = row.querySelector('.stn-hint');
  row.insertBefore(strip, hint);
}
