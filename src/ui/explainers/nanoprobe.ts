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
 * Illustrative choices are labelled in the station's notes: detector solid angle (0.1 sr) and throughput,
 * the 10 µm electrolyte scatterer, crack/leach kinetics, Gaussian probe, step-scan (no fly-scan smear).
 */
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
  title: "Element mapping during battery charging",
  subtitle: 'Shrink the X-ray spot, tune its energy, and map the elements in a battery particle as it charges.',
  mount(host, ctx) {
    const station = createStation(host, { color: ctx.color, layout: 'side' });
    const accent = /^#[0-9a-f]{6}$/i.test(ctx.color) ? ctx.color : '#5cd3ff';
    const rand = rng(20260906);

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

    // 0. Toolbar: scan / reset, and the in situ switch (the station's headline action)
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    station.controls.appendChild(btnRow);
    button(btnRow, '▶ Scan again', () => restart(), 'is-primary');
    button(btnRow, '↺ Reset', () => reset());
    // reduced motion: scans are computed without the moving beam and appear when done
    const motion = motionGate(station, btnRow, {
      play: '▶ Animate scans',
      pause: '❚❚ Results only',
      title: "Reduced motion is enabled on your device. Each scan appears after calculation. Press to animate the beam position across the sample.",
      onChange: (on) => {
        if (on && scanning && run) elapsed = (run.idx / run.total) * d.animDur;
        dirty = true;
      },
    });
    const insituToggle = toggle<'off' | 'on'>(station.controls, {
      label: 'Battery cell',
      options: [
        { value: 'off', label: 'Hold still', title: 'The sample stays as it is between scans' },
        { value: 'on', label: "Charge battery", title: 'Charge the battery: the sample changes before every new scan' },
      ],
      value: 'off',
      onChange: (v) => setInsitu(v === 'on'),
    });

    // 1. Beam
    const gBeam = group(station.controls, 'X-ray beam');
    const eSlider = slider(gBeam, {
      label: 'X-ray energy E₀',
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
      label: 'Spot size (FWHM)',
      min: 20,
      max: 1000,
      log: true,
      value: P.spot,
      format: (v) => {
        const sd = spotMinNm(P.E0);
        return v < sd ? `${fmtLenNm(sd)} minimum` : fmtLenNm(v);
      },
      onInput: (v) => {
        P.spot = v;
        queueRestart();
      },
    });
    note(
      gBeam,
      station,
      "X-ray fluorescence requires enough incident energy to remove an inner-shell electron. The threshold is the absorption edge, marked below the slider. Fluorescence is strongest just above an edge and decreases roughly as E^{−2.7} at higher energy. The diffraction-limited focal spot also decreases with energy: 39 nm at 10 keV and 16 nm at 25 keV.",
    );

    // 2. Source (before the scan group: the APS vs APS-U comparison stays above the fold)
    const gSrc = group(station.controls, 'X-ray source');
    const srcToggle = toggle<SourceKey>(gSrc, {
      options: [
        { value: 'apsu', label: "APS-U since 2024", title: 'The upgraded multi-bend-achromat storage ring' },
        { value: 'aps', label: "APS before 2023", title: "The original storage ring operated from 1996 to 2023. Both sources use the same beamline optics in this model." },
      ],
      value: P.src,
      onChange: (v) => {
        P.src = v;
        queueRestart();
      },
    });
    const meter = timeMeter(gSrc, accent);
    const fluxRO = readout(gSrc, "Incident photons per second");
    note(
      gSrc,
      station,
      "Higher APS-U coherence increases flux in small focal spots: ~160× at 10 keV and ~350× at 25 keV. Larger spots include more of the old source's incoherent flux, reducing the gain to ~10 to 20× for micrometre spots. The comparison assumes identical optics and is accurate to about a factor of 2. Against old zone-plate nanoprobes, the design report gives a gain of 10^{3} to 10^{4}×.",
    );

    // 3. Scan
    const gScan = group(station.controls, 'Scan');
    const stepSlider = slider(gScan, {
      label: 'Step size · pixels',
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
      label: 'Time per pixel (dwell)',
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
    const scanNote = note(gScan, station, '');

    // 4. Numbers
    const gNum = group(station.controls, 'Per pixel');
    const countsRO = readout(gNum, "Recorded photons");
    const detRO = readout(gNum, 'Detector input');
    const doseRO = readout(gNum, 'Radiation dose');
    detRO.el.title = "Incident detector rate in counts/s. Attenuation keeps it below 3×10⁷.";
    doseRO.el.title = 'Energy absorbed per kilogram of sample, in gray (Gy): photons per area × energy × absorption';
    note(
      gNum,
      station,
      "Map intensity is the recorded fluorescence count for each element at each scan position. Low counts give noisy maps. The 0.1 sr detector solid angle and count-rate limit are illustrative. Maps assume separated emission lines. Tungsten's strongest line is only 133 eV from a nickel line, too close for direct separation at this detector resolution. Actual tungsten maps require full-spectrum fitting. At equal counts, both sources give the same radiation dose.",
    );

    // 5. Background: the sample and the beamline
    const gAbout = group(station.controls, "Sample and geometry");
    note(
      gAbout,
      station,
      "The illustrative sample is a 100 nm slice through NMC811 battery-cathode particles, LiNi_{0.8}Mn_{0.1}Co_{0.1}O_{2}. It contains ~300 nm nickel-manganese-cobalt oxide crystals with ≈0.5 mol% tungsten at grain boundaries. Lithium fluorescence is too weak and low in energy for these measurements. Cracking above ~4.2 V and manganese loss are qualitative and accelerated.",
    );
    note(
      gAbout,
      station,
      "The 220 m ISN beamline length permits strong demagnification of an upstream slit. The demagnification is the slit-to-mirror distance divided by the mirror-to-sample distance. A ~6 cm clearance for a battery cell or furnace requires separation between mirrors and sample. Distances of 165 m and 0.4 m give ~400× demagnification. A beamline 5× shorter would require a slit narrower than a micrometre. The distant slit also reduces sensitivity to upstream optic motion.",
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
      // The static beam position is the representative tungsten-rich boundary or a user-selected position. Display its spectrum.
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
      const sel = P.src === 'apsu' ? d.effU : d.effA;
      fluxRO.set(`${sci(sel)} /s`);
      const ex = excited();
      const c = d.counts;
      const parts = (['Ni', 'Mn', 'Co', 'W'] as const).filter((_, i) => ex[i]).map((k) => `${k} ${fmtCounts(c[k])}`);
      countsRO.set(parts.length ? parts.join(' · ') : 'none');
      detRO.set(`${sci(d.rate)} /s${d.att < 0.999 ? ` · attenuation ×${d.att.toFixed(2)}` : ''}`);
      doseRO.set(`${sci(d.dose, 1)} Gy`);
      meter.set(d.tU, d.tA, fmtTime, { insituStep: P.insitu || cellIdx > 0 ? INSITU_STEP_S : undefined, selected: P.src, uStage: d.uStage, gain: d.effU / d.effA });
      // scan note: sampling advice, then the numbers behind it
      const ratio = d.step / d.spot;
      let t = ratio > 1.3 ? `The ${fmtLenNm(d.step)} step is larger than the focal spot, leaving gaps between illuminated positions.` : ratio < 0.2 ? `Steps much smaller than the ${fmtLenNm(d.spot)} spot increase pixel count and scan time without improving resolution.` : "Smaller steps provide finer sampling but increase scan time.";
      if (d.stageLimited) t += ` Stage speed is limited to 1 mm/s, so each ${fmtLenNm(d.step)} pixel takes at least ${fmtTime(d.dwell)}.`;
      const samp =
        ratio > 1 ? 'gaps between the spots' : ratio > 0.55 ? "coarse; sampling requires a step no larger than half the spot width" : ratio < 0.2 ? "oversampled; additional time and dose without finer resolution" : "fine enough to sample the resolved detail";
      t += ` Step = ${ratio.toFixed(2)} × spot width, with ${samp}. The scan has ${d.nx}² pixels × ${fmtTime(d.dwell)} = ${fmtTime(d.tSel)}.`;
      scanNote.set(t);
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
      if (dark.length === 4) v = `At ${P.E0.toFixed(1)} keV, none of the elements in this sample produces fluorescence. Only scattered incident X-rays are recorded. Increase energy above the manganese edge at 6.54 keV.`;
      else if (dark.length > 0) {
        const names = [...dark].sort((a, b) => ELEMENTS[a].edges[0].e - ELEMENTS[b].edges[0].e).map((k) => `${ELEMENTS[k].name} at ${ELEMENTS[k].edges[0].e.toFixed(2)} keV`);
        const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
        v = `At ${P.E0.toFixed(1)} keV, the incident energy is below the absorption edge of ${list}, so ${dark.length > 1 ? 'those maps remain' : 'that map remains'} dark. Increase energy above ${dark.length > 1 ? 'their edges' : 'its edge'}.`;
      } else if (P.src === 'aps') v = `With the old APS, only ~${fmtCounts(d.counts.Mn)} manganese photons are recorded per pixel, making the maps noisy. Equal-quality maps would take ${fmtTime(d.tCleanA)}, compared with ${fmtTime(d.tCleanU)} for APS-U${d.uStage ? `. The time ratio is below the ~${Math.round(d.fluxU / d.fluxA)}× flux ratio because stage speed limits APS-U` : `, with ~${Math.round(d.fluxU / d.fluxA)}× less flux in this spot`}.`;
      else if (P.E0 > 17 && d.spot < 30) {
        const xs = elementXS('Ni', 13) / elementXS('Ni', P.E0);
        const fewer = Math.max(2, Math.round(countsAt(13) / Math.max(1e-9, d.counts.Ni)));
        v = `At ${P.E0.toFixed(0)} keV, the minimum focal spot is ${spot}. The energy is far above the absorption edges, so absorption is ~${Math.round(xs)}× less frequent${fewer > 1.15 * xs ? ', and flux in the smaller spot is lower' : ''}. Each pixel records ~${fewer}× fewer nickel photons than at 13 keV. Finer spatial resolution therefore comes with lower fluorescence counts.`;
      } else if (d.spot > 160) v = `The ${spot} spot exceeds the ~300 nm grain size, blurring boundaries${st.crackW > 0 ? ' and cracks' : ''}. Reduce the spot size to resolve them.`;
      else if (d.step > d.spot * 1.3) v = `The ${fmtLenNm(d.step)} pixel spacing exceeds the ${spot} focal spot, leaving gaps between measured areas. Make the step smaller than the spot.`;
      else if (cellIdx > 0 || P.insitu) v = `Battery voltage is ${st.volts.toFixed(1)} V. ${st.text}${st.crackW > 0 ? ' Cracks appear as dark lines in every map.' : ''}`;
      else {
        v = `A ${spot} X-ray spot is scanned across a thin battery-particle slice. Characteristic fluorescence energies distinguish elements in the spectrum in panel 3, giving an element map for each. Tungsten marks the ~300 nm crystal boundaries, which are resolved because the spot is much smaller than a crystal.`;
        if (P.E0 > W_EDGES.L3 && P.E0 < W_EDGES.L2) v += ` At this energy, only tungsten L₃ lines are excited. The Lβ₁ and Lγ₁ lines require more than ${W_EDGES.L2.toFixed(2)} keV.`;
        else if (d.counts.W < 10) v += ' Tungsten gives only a few counts per pixel here, so counting statistics set how little of it can be detected.';
      }
      // how the optics make this spot (the slit far upstream, the beam-defining aperture, sets size against flux)
      if (!dark.length && P.src === 'apsu' && !(cellIdx > 0 || P.insitu))
        v +=
          d.regime === 'coherent'
            ? ` A nearly closed upstream slit limits illumination to the coherent part of the beam${d.limited ? `, giving the minimum ${spot} spot at ${P.E0.toFixed(1)} keV` : ''}.`
            : d.regime === 'partial'
              ? " Flux is greater and coherence is lower with a partly open upstream slit."
              : " A fully open upstream slit or defocus gives a larger spot with greater flux and lower spatial resolution.";
      station.setCaption(v);
    }

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
    meter.setHead('Map time · equal counts');
    updateReadouts();
    refreshCaption();
    dirty = true;

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
        accent,
        speedLabel: d.speedLabel,
        hint: 'tap or drag to aim the beam: its spectrum is in panel 3|tap to aim the beam|tap to aim',
      });
      maps.draw({ run: r, excited: excited(), scanning, accent });
      specT -= dt;
      if (scanning && specT > 0) return;
      specT = 1 / 30;
      specView.draw({ spec: spectrum, mean, hasPixel: !!r && r.idx > 0, E0: P.E0, excited: excited(), accent, ymax });
    });
    // a resize clears a canvas: redraw it even while a reduced-motion scan holds the panels
    for (const c of [heroC, mapsC, specC])
      c.onResize(() => {
        dirty = true;
        showNext = true;
      });

    return {
      destroy: () => station.destroy(),
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
