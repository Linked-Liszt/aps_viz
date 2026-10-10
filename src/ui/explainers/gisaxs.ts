/**
 * Station "Skimming the surface" — grazing-incidence (coherent) small-angle X-ray scattering for CSSI, APS 9-ID.
 *
 * Four linked panels:
 *   1 · Side view     beam at α_i (0.02–0.6°), footprint h/sin α_i, specular reflection |R|², refracted beam or
 *                     evanescent wave, scattered fan → edge-on detector carrying the α_f profile (Yoneda peak).
 *   2 · Detector      GISAXS pattern I(q_y, α_f) of polymer islands on Si in the DWBA (4-term, Fresnel
 *                     coefficients of Si): side rods at ±q* = 2π/L, Yoneda band at α_f = α_c, specular spot,
 *                     sample horizon. "Coherent" → speckle from the exact island arrangement under a 1 µm beam;
 *                     APS vs APS-U coherent flux → Poisson-limited photon counts per 1 s frame.
 *   3 · Into the surface   |E(z)|²: standing wave above (period λ/2 sin α_i), |t|² e^{−z/Λ} below; Λ(α_i) for Si & PS.
 *   4 · Surface from above live Cahn–Hilliard coarsening (L ∝ t^{1/3}); tap to add/remove islands.
 *
 * Physics + sources: see gisaxs/physics.ts (optics, Fresnel, Dosch penetration depth, DWBA), gisaxs/surface.ts
 * (Cahn–Hilliard), gisaxs/scatter.ts (detector intensities).
 *
 * Beamline numbers (research dossier cssi.json: APS-U PDR §6-5, FDR §4-8, 9-ID Beamline Directory, 9ID manual):
 *   9-ID: 6–25 keV as operated (FDR design 6–30 keV); one 2.35 m revolver undulator U21/U25 (upstream slot empty);
 *   coherent focal spots 0.6 × 0.35 µm to 3.5 × 1.7 µm (H × V). The CSSI sample surface is VERTICAL (horizontal
 *   scattering plane), so the horizontal focus is the size normal to the surface (sets the footprint h/sin α_i) and the
 *   vertical focus is the width W across the beam in the surface plane (sets the speckle size λD/W along q_y).
 *   Modelled as an intermediate zoom setting: W = 1 µm FWHM across (V) × h = 2 µm normal to the surface (H)
 *   (KB 0.75 × 0.42 µm and CRL-2 3.5 × 1.7 µm at 8.8 keV both have H/V ≈ 2). Ordinary GISAXS: CRL-1 full beam
 *   29 × 16 µm (H × V) on a horizontal sample (GIXS diffractometer) → h = 16 µm.
 *   Coherent flux: KB mode ≈ 1.2×10¹³ ph/s into 0.75 × 0.42 µm at 8.8 keV with a ≈ 3×2-mode aperture (FDR / Beamline
 *   Directory) → ~2×10¹² ph/s per coherent mode; modelled as 10¹² coherent ph/s. Pre-upgrade APS: ~5×10⁹ coherent ph/s
 *   at 8-ID-I (CSSI/holography work, Chu et al. 2023; multislice prototype 5×10⁹) → APS-U ≈ 200× (dossier: the
 *   realistic gain with one 2.35 m device is ~100–200×, coherent fraction ~0.05 % → ~3–6 % at 10 keV).
 *   CSSI sample at z = 55.0 m; EIGER 16M (75 µm px) and MM-PAD (150 µm px) ride 2.9–21.8 m downstream inside the
 *   20 m in-vacuum "Grand Tube", because speckle s ≈ λD/W must span ≥ 2 pixels (oversampling λD/(pW) ≥ 2, more for
 *   comfort) even at 25 keV; the MM-PAD's dynamic range replaces the beamstop (specular ≫ speckle).
 *   2012 proof of principle at old-APS 8-ID-E (Sun, Jiang, Strzalka, Ocola & Wang, Nature Photonics 6, 586 (2012)):
 *   7.35 keV, ~1×10⁹ coherent ph/s, D = 0.7 m, a few hours per pattern (≤ 3000 counts), resolution 2.6 µm × 22 nm × 2.7 nm.
 *   GI-XPCS: XPCS SNR ≈ β·I·√(T·τ·N_pix) in the low-count limit (I = count rate per pixel), so at fixed SNR the
 *   shortest accessible τ ∝ 1/I² (~200× flux → ~4×10⁴× faster dynamics; detector frame rate ~1 ms is the real limit).
 *   Geometry is drawn in the classic horizontal-sample GISAXS frame; the CSSI station mounts the surface vertically
 *   (α_f then spreads horizontally in the tube) — physics identical, stated in the specialist text.
 * Illustrative (labelled in the UI): CH time units, photon-count scale (absolute rates depend strongly on the sample;
 *   only the APS : APS-U ratio is meaningful), 2.56 µm simulated patch, full transverse coherence.
 */
import type { ExplainerModule } from './registry';
import type { Depth } from '../../app/store';
import { button, canvas2d, createStation, group, loop, md, note, onReducedMotionChange, prefersReducedMotion, readout, slider, toggle, type Canvas2D } from './kit';
import { poisson, rng } from '../../lib/fft';
import { DEG, POLYSTYRENE, SILICON, fresnel, footprint, optics, penetrationDepth, refractedAngle, speckleSize, wavelengthNm, waveNumber } from './gisaxs/physics';
import { Surface, N, PIXEL_NM, BEAM_FWHM_NM } from './gisaxs/surface';
import { Detector, DQ, J_HALF } from './gisaxs/scatter';
import { SpeckleMemory } from './gisaxs/xpcs';
import { LOG_HI, LOG_LO, detLayout, drawDepth, drawDetector, drawSide, drawTop, fmtCount, fmtDeg, fmtLen, fmtPct, paintDetector, paintSurface, topLayout, type DetDraw, type Derived, type ViewFlags } from './gisaxs/views';

export * from './gisaxs/physics';

/** surface → spectra → detector refresh interval while annealing [s] (the 'detector frame rate') */
const REFRESH_DT = 0.11;
/** CH steps per wall-clock second while annealing: a fresh film (~220 nm) ripens to the restart spacing in ≈ 20 s */
const STEPS_PER_SEC = 10;
/**
 * photons per display bin per 1 s frame at I/I_ref = 1 with APS-U coherent flux (ILLUSTRATIVE scale, chosen for a
 * weakly scattering sample: ≈ 40 counts per bin in the GI-XPCS region of interest with APS-U, ≈ 0.2 with the old APS)
 */
const COUNTS_APSU = 500;
/** coherent flux [ph/s]: APS-U 9-ID (~10¹², see header) vs pre-upgrade APS 8-ID (~5×10⁹) — ratio ≈ 200 */
const FLUX_APSU = 1e12;
const FLUX_APS = 5e9;
/** initial island spacing of a fresh film [px] (≈ 260 nm) and the spacing at which a new film is started [nm] */
const SEED_L_PX = 6.5;
const RESTART_L_NM = 440;
/** beam size normal to the surface [µm]: CSSI horizontal focus (vertical surface), 0.6–3.5 µm → 2 µm with W = 1 µm */
const BEAM_H_COHERENT = 2;
/** ordinary GISAXS: CRL-1 full beam 29 × 16 µm (H × V) on a horizontal sample → 16 µm normal to the surface */
const BEAM_H_GISAXS = 16;
const DETECTOR_DISTANCE = 21.8; // m, longest sample–detector distance in the Grand Tube (range 2.9–21.8 m)
const PIXEL_EIGER = 75e-6; // m

type Source = 'apsu' | 'aps';

const mod: ExplainerModule = {
  title: 'Skimming the surface',
  subtitle: 'Tilt the X-rays to a whisper-thin angle, watch the surface glow on the detector — then switch on APS-U coherence.',
  mount(host, ctx) {
    const accent = ctx.color || '#34d399';
    const station = createStation(host, { depth: ctx.depth, color: accent, layout: host.clientWidth < 760 ? 'stack' : 'side' });
    const { visual, controls } = station;

    // ------------------------------------------------------------ canvases
    const cSide = canvas2d(visual, { label: '1 · Side view' });
    const cDet = canvas2d(visual, { label: '2 · Detector' });
    const cDepth = canvas2d(visual, { label: '3 · Into the surface' });
    const cTop = canvas2d(visual, { label: '4 · Surface from above' });
    const wrapOf = (c: Canvas2D) => c.canvas.parentElement as HTMLElement;
    wrapOf(cSide).style.gridArea = 'side';
    wrapOf(cDet).style.gridArea = 'det';
    wrapOf(cDepth).style.gridArea = 'depth';
    wrapOf(cTop).style.gridArea = 'top';
    const labelEls = [cSide, cDet, cDepth, cTop].map((c) => wrapOf(c).querySelector('.stn-canvas-label') as HTMLElement);
    const panelTitles: [string, string][] = [
      ['1 · Side view', '1 · Scattering geometry'],
      ['2 · What the detector sees', '2 · Detector pattern (DWBA)'],
      ['3 · How deep do X-rays go?', '3 · Field intensity & 1/e depth'],
      ['4 · The surface from above', '4 · Surface (live coarsening)'],
    ];
    cTop.canvas.style.cursor = 'crosshair';
    cDet.canvas.style.cursor = 'crosshair';
    cDepth.canvas.style.cursor = 'ew-resize';

    /*
     * Layout. Wide (≥ 760 px): kit side layout, all four panels in one grid, controls column, caption below.
     * Narrow (side panel, phones): the kit would stack ALL canvases above ALL controls, which puts the angle slider
     * ~1300 px down. Instead the stack is ordered so that the hands-on controls follow the two hero panels:
     *   [1 side view, 2 detector] → [beam / sample / coherent controls] → [3 depth, 4 surface] → caption → [numbers]
     * In a host with a definite height (e.g. a fixed-height modal) the stacked station scrolls inside it.
     */
    const visual2 = document.createElement('div');
    visual2.className = 'stn-visual';
    const controls2 = document.createElement('div');
    controls2.className = 'stn-controls';
    // holds only the Numbers group: one full-width column (the kit's stacked controls grid would halve it)
    controls2.style.gridTemplateColumns = 'minmax(0, 1fr)';
    controls2.style.overflowY = 'visible';
    let layoutMode: 'wide' | 'stack2' | 'stack1' | '' = '';
    const applyLayout = () => {
      const w = host.clientWidth || 800;
      const mode = w >= 760 ? 'wide' : w >= 430 ? 'stack2' : 'stack1';
      if (mode === layoutMode) return;
      layoutMode = mode;
      const narrow = mode !== 'wide';
      const root = station.root;
      root.classList.toggle('stn-stack', narrow);
      root.classList.toggle('stn-side', !narrow);
      root.style.height = narrow ? '100%' : '';
      root.style.overflowY = narrow ? 'auto' : '';
      root.style.scrollbarWidth = narrow ? 'thin' : '';
      // stacked rows must never shrink below their content (the kit's controls are a scroll container, whose
      // automatic minimum height is 0, so 'auto' rows would squash them when the station overflows its host)
      root.style.gridTemplateRows = narrow ? 'repeat(5, max-content)' : '';
      controls.style.overflowY = narrow ? 'visible' : '';
      const vs = visual.style;
      const v2 = visual2.style;
      if (!narrow) {
        visual.append(wrapOf(cDepth), wrapOf(cTop));
        controls.appendChild(gNum);
        visual2.remove();
        controls2.remove();
        vs.gridTemplateAreas = '"side side det" "depth top det"';
        vs.gridTemplateColumns = 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr)';
        vs.gridTemplateRows = 'minmax(0,0.95fr) minmax(0,1.15fr)';
        vs.minHeight = '520px';
        return;
      }
      visual2.append(wrapOf(cDepth), wrapOf(cTop));
      controls2.appendChild(gNum);
      root.append(visual, controls, visual2, station.caption, controls2);
      vs.gridTemplateAreas = '"side" "det"';
      vs.gridTemplateColumns = 'minmax(0,1fr)';
      vs.minHeight = '';
      v2.minHeight = '';
      if (mode === 'stack2') {
        vs.gridTemplateRows = '220px 380px';
        v2.gridTemplateAreas = '"depth top"';
        v2.gridTemplateColumns = 'minmax(0,1fr) minmax(0,1fr)';
        v2.gridTemplateRows = '300px';
      } else {
        vs.gridTemplateRows = '210px 360px';
        v2.gridTemplateAreas = '"depth" "top"';
        v2.gridTemplateColumns = 'minmax(0,1fr)';
        v2.gridTemplateRows = '300px 300px';
      }
    };
    const ro = new ResizeObserver(() => applyLayout());
    station.onDestroy(() => ro.disconnect());

    // ------------------------------------------------------------ state
    const st = {
      E: 8.0,
      aIdeg: 0.3,
      coherent: false,
      source: 'apsu' as Source,
      // reduced motion: the film waits for ▶ Anneal instead of ripening by itself
      playing: !prefersReducedMotion(),
      mix: 0,
    };
    /** reduced motion and not annealing: nothing moves unless the visitor changes something */
    const still = () => !st.playing && prefersReducedMotion();
    const surface = new Surface();
    const det = new Detector();
    let seed = 11;
    surface.seedRipened(seed, SEED_L_PX);
    const rowCenter = new Float64Array(N);

    let D = derive();
    function derive(): Derived {
      const si = optics(SILICON, st.E);
      const ps = optics(POLYSTYRENE, st.E);
      const aI = st.aIdeg * DEG;
      const beamH = st.coherent ? BEAM_H_COHERENT : BEAM_H_GISAXS;
      return {
        E: st.E,
        lambda: wavelengthNm(st.E),
        k: waveNumber(st.E),
        si,
        ps,
        aI,
        fSi: fresnel(aI, si.delta, si.beta),
        penSi: penetrationDepth(aI, si),
        penPs: penetrationDepth(aI, ps),
        beamH,
        foot: footprint(beamH, aI),
        aT: refractedAngle(aI, si),
      };
    }
    // Λ(α) curves
    const NC = 220;
    const curves = { a: new Float64Array(NC), si: new Float64Array(NC), ps: new Float64Array(NC) };
    const updateCurves = () => {
      for (let i = 0; i < NC; i++) {
        const a = 0.003 + (0.6 - 0.003) * (i / (NC - 1));
        curves.a[i] = a;
        curves.si[i] = penetrationDepth(a * DEG, D.si);
        curves.ps[i] = penetrationDepth(a * DEG, D.ps);
      }
    };
    updateCurves();

    // ------------------------------------------------------------ buffers
    const cells = det.cols * det.rows;
    const incN = new Float64Array(cells);
    const cohN = new Float64Array(cells);
    const disp = new Float64Array(cells);
    const prof = new Float64Array(det.rows);
    const ddraw: DetDraw = {
      image: document.createElement('canvas'),
      cutH: new Float64Array(det.cols),
      cutHAvg: new Float64Array(det.cols),
      cutV: new Float64Array(det.rows),
      cutVAvg: new Float64Array(det.rows),
      hover: null,
      showBeamstop: true,
      photons: null,
    };
    ddraw.image.width = det.cols;
    ddraw.image.height = det.rows;
    const detCtx = ddraw.image.getContext('2d')!;
    const detImg = new ImageData(det.cols, det.rows);
    const topCanvas = document.createElement('canvas');
    topCanvas.width = N;
    topCanvas.height = N;
    const topCtx = topCanvas.getContext('2d')!;
    const topImg = new ImageData(N, N);
    const noiseRng = rng(2024);
    const hist = { t: new Float64Array(400), L: new Float64Array(400), n: 0 };
    let Lnm = 0;
    let topHover: { x: number; y: number } | null = null;
    let pulse: { x: number; y: number; t: number } | null = null;

    // ------------------------------------------------------------ pipeline
    let surfDirty = true;
    let forceRefresh = true;
    let topImageDirty = true;
    let detDirty = true;
    let depthDirty = true;
    /** the surface changed under panel 3 (only its small island profile depends on it) */
    let depthSurfDirty = false;
    let depthClock = 0;
    let topDirty = true;
    let noiseDirty = true;
    let detDrawDirty = true;
    let roiDirty = true;

    /** surface → detector pipeline: computeHeight → computeSpectra → finishRefresh (staged over frames in tick) */
    let pipe: 0 | 1 | 2 = 0;
    const refreshSurface = () => {
      surface.computeHeight();
      surface.computeSpectra();
      pipe = 0;
      surfDirty = false;
      finishRefresh();
    };
    const finishRefresh = () => {
      det.updateSpectra(surface);
      for (let x = 0; x < N; x++) rowCenter[x] = surface.height[(N / 2) * N + x];
      Lnm = (2 * Math.PI) / Math.max(det.peakBin * DQ, 1e-6);
      if (hist.n < hist.t.length && (hist.n === 0 || surface.t > hist.t[hist.n - 1] * 1.02)) {
        hist.t[hist.n] = surface.t;
        hist.L[hist.n] = Lnm;
        hist.n++;
      }
      detDirty = true;
      topDirty = true;
      topImageDirty = true;
      depthSurfDirty = true; // islands in the cross-section: redrawn at ≤ 3 Hz (see tick)
    };

    const recomputeDetector = () => {
      det.compute(surface, st.E, D.aI, st.coherent || st.mix > 0);
      const inv = 1 / det.iRef;
      for (let i = 0; i < cells; i++) {
        incN[i] = det.inc[i] * inv;
        cohN[i] = det.coh[i] * inv;
      }
      detDirty = false;
      noiseDirty = true;
    };

    let photons: number | null = null;
    /** expected photons per display bin per 1 s frame at I/I_ref = 1 for the selected source */
    const photonScale = () => COUNTS_APSU * (st.source === 'apsu' ? 1 : FLUX_APS / FLUX_APSU);
    /** a new Poisson frame was drawn since the last GI-XPCS sample */
    let freshFrame = false;
    const composeDisplay = () => {
      const m = st.mix;
      const steady = st.coherent && m >= 0.999;
      photons = null;
      if (steady) {
        freshFrame = true;
        const scale = photonScale();
        let tot = 0;
        for (let i = 0; i < cells; i++) {
          const mean = cohN[i] * scale;
          const c = mean > 0 ? poisson(mean, noiseRng) : 0;
          tot += c;
          disp[i] = c / COUNTS_APSU;
        }
        photons = tot;
      } else {
        for (let i = 0; i < cells; i++) disp[i] = (1 - m) * incN[i] + m * cohN[i];
      }
      paintDetector(detImg, det, disp);
      detCtx.putImageData(detImg, 0, 0);
      // cuts
      const rY = Math.round(det.rowOf(det.alphaC));
      for (let c = 0; c < det.cols; c++) {
        let a = 0;
        let b = 0;
        let n = 0;
        for (let r = rY - 1; r <= rY + 1; r++) {
          if (r < 0 || r >= det.rows) continue;
          a += disp[r * det.cols + c];
          b += incN[r * det.cols + c];
          n++;
        }
        ddraw.cutH[c] = n ? a / n : 0;
        ddraw.cutHAvg[c] = n ? b / n : 0;
      }
      const pk = Math.max(1, Math.min(J_HALF - 1, Math.round(det.peakBin)));
      const colsAt = [J_HALF - pk - 1, J_HALF - pk, J_HALF - pk + 1, J_HALF + pk - 1, J_HALF + pk, J_HALF + pk + 1];
      for (let r = 0; r < det.rows; r++) {
        let a = 0;
        let b = 0;
        let e = 0;
        for (const c of colsAt) {
          a += disp[r * det.cols + c];
          b += incN[r * det.cols + c];
          e += (1 - m) * incN[r * det.cols + c] + m * cohN[r * det.cols + c];
        }
        ddraw.cutV[r] = a / colsAt.length;
        ddraw.cutVAvg[r] = b / colsAt.length;
        const v = e / colsAt.length;
        prof[r] = v > 0 ? Math.max(0, Math.min(1, (Math.log10(v) - LOG_LO) / (LOG_HI - LOG_LO))) : 0;
      }
      ddraw.showBeamstop = !st.coherent;
      ddraw.photons = photons;
      noiseDirty = false;
      detDrawDirty = true;
    };

    const flags = (): ViewFlags => ({ specialist: station.depth === 'specialist', coherent: st.coherent, mix: st.mix, accent });

    // ------------------------------------------------------------ controls
    const gBeam = group(controls, 'Beam');
    const sAngle = slider(gBeam, {
      label: 'Incidence angle αᵢ',
      min: 0.02,
      max: 0.6,
      step: 0.005,
      value: st.aIdeg,
      format: (v) => `${v.toFixed(v < 0.1 ? 3 : 2)}°`,
      onInput: (v) => {
        st.aIdeg = v;
        paramsChanged();
      },
    });
    const sEnergy = slider(gBeam, {
      label: 'X-ray energy',
      min: 6,
      max: 25,
      step: 0.1,
      value: st.E,
      format: (v) => `${v.toFixed(1)} keV`,
      hint: '9-ID range 6–25 keV · higher energy → smaller critical angle',
      onInput: (v) => {
        st.E = v;
        updateCurvesNeeded = true;
        paramsChanged();
      },
    });
    const tBeam = toggle(gBeam, {
      label: 'Beam',
      options: [
        { value: 'ord', label: 'Ordinary', title: 'Large, mostly incoherent beam: smooth, averaged GISAXS pattern' },
        { value: 'coh', label: 'Coherent', title: 'Focused coherent beam: speckle from the exact islands under the beam' },
      ],
      value: 'ord',
      onChange: (v) => {
        st.coherent = v === 'coh';
        gCoh.style.display = st.coherent ? 'flex' : 'none';
        roiDirty = true;
        paramsChanged();
      },
    });

    const gSample = group(controls, 'Sample');
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
    gSample.appendChild(btnRow);
    const setPlaying = (p: boolean) => {
      st.playing = p;
      bPlay.textContent = p ? '❚❚ Pause' : '▶ Anneal';
      bPlay.setAttribute('aria-pressed', String(p));
    };
    const bPlay = button(btnRow, '❚❚ Pause', () => setPlaying(!st.playing), 'is-primary');
    setPlaying(st.playing);
    onReducedMotionChange(station, (reduced) => setPlaying(!reduced));
    bPlay.title = 'Heat the sample: the islands ripen and merge (time-lapse)';
    const bIsland = button(btnRow, '+ Island', () => {
      const r = rng(Math.floor(performance.now()));
      const x = r() * N;
      const y = N / 2 + (r() - 0.5) * 30;
      pokeAt(x, y, true);
    });
    bIsland.title = 'Drop a new island inside the beam (or tap the surface map)';
    button(btnRow, '↺ Reset', () => resetAll());
    const rL = readout(gSample, 'Island spacing', { color: accent });

    // coherent-beam options (shown only with the coherent beam)
    const gCoh = group(controls, 'Coherent beam');
    gCoh.style.display = 'none';
    const tSource = toggle(gCoh, {
      label: 'Coherent photons from…',
      options: [
        { value: 'apsu', label: 'APS-U', title: '9-ID today: ~10¹² coherent photons/s in a ~1 µm focus' },
        { value: 'aps', label: 'old APS', title: 'Before the upgrade: ~5×10⁹ coherent photons/s (about 200× fewer)' },
      ],
      value: 'apsu',
      onChange: (v) => {
        st.source = v as Source;
        noiseDirty = true;
        roiDirty = true;
        updateText();
      },
    });
    const xpcsHead = document.createElement('div');
    xpcsHead.className = 'stn-slider-label';
    xpcsHead.textContent = 'Speckle memory';
    gCoh.appendChild(xpcsHead);
    const cX = canvas2d(gCoh, { label: 'GI-XPCS' });
    const xWrap = cX.canvas.parentElement as HTMLElement;
    xWrap.style.height = '112px';
    xWrap.style.minHeight = '112px';
    xWrap.style.flex = 'none';
    note(
      gCoh,
      station,
      'How alike is the speckle now and *τ* seconds ago? It fades as the islands move. That fading time is what **GI-XPCS** measures. Tap the surface map and watch the memory drop.',
      'C(τ) = [⟨u(t)u(t−τ)⟩/(⟨u(t)⟩⟨u(t−τ)⟩) − 1]/β, u = I/⟨I⟩ (⟨I⟩ = ensemble GISAXS), over |q_{y}| = 0.5–2 q∗, α_{f} ≈ α_{c}…α_{c}+0.5°: one row of the two-time correlation ≈ (g_{2}(q,τ)−1)/β = |f(q,τ)|^{2}; β = contrast of the noise-free speckle (a calibration constant in practice). Coarsening slows with age, so the decay stretches (aging; dashed = ~10 s earlier). Shot noise does not bias C(τ>0), it scatters it (grey band ≈ ±1σ shot noise).',
    );
    const memory = new SpeckleMemory(64, 3200);
    note(
      controls,
      station,
      'Drag the angle below silicon’s **critical angle** (the grey dashed line in panel 3): the X-rays stop going in and just skim the top few nanometres. Then switch to the **coherent** beam.',
      '**DWBA, islands on Si:** F = F(p_{i}+p_{f}) + R_{i}F(p_{f}−p_{i}) + R_{f}F(p_{i}−p_{f}) + R_{i}R_{f}F(−p_{i}−p_{f}), p = k sin α. For islands thin compared with 1/q_{z} this → T_{i}T_{f} F(q_{∥}, 0): |T(α_{f})|^{2} puts the **Yoneda** maximum at α_{f} = α_{c}. Drag in panel 3 to set α_{i}; hover the detector for q.',
    );

    const gNum = group(controls, 'Numbers');
    const rAc = readout(gNum, 'Critical angle, silicon');
    const rAcPs = readout(gNum, 'Critical angle, polymer');
    const rPen = readout(gNum, 'X-rays reach (Si)');
    const rFoot = readout(gNum, 'Beam footprint');
    const rSpk = readout(gNum, 'Speckle size, 21.8 m away');
    const rNote = note(gNum, station, '', '');

    const readoutLabels: [{ el: HTMLElement }, string, string][] = [
      [rL, 'Island spacing', 'L = 2π/q∗'],
      [rAc, 'Critical angle, silicon', 'α_{c} Si = √(2δ)'],
      [rAcPs, 'Critical angle, polymer', 'α_{c} polystyrene'],
      [rPen, 'X-rays reach (silicon)', 'Λ_{1/e} in Si'],
      [rFoot, 'Beam footprint', 'footprint h/sin α_{i}'],
      [rSpk, 'Speckle size, 21.8 m away', 'speckle λD/W, D = 21.8 m'],
    ];
    const relabel = () => {
      const sp = station.depth === 'specialist';
      for (const [r, v, s] of readoutLabels) (r.el.querySelector('.stn-readout-label') as HTMLElement).innerHTML = md(sp ? s : v);
      labelEls.forEach((el, i) => (el.textContent = panelTitles[i][sp ? 1 : 0]));
      rAcPs.el.style.display = '';
    };

    // ------------------------------------------------------------ text
    /** sample–detector distance [m] for `ns` pixels of size p [m] per speckle λD/W (W [m]) */
    const dNeed = (ns: number, p: number, W: number) => (ns * p * W) / (D.lambda * 1e-9);
    const fmtM = (m: number) => (m < 1 ? `${(m * 100).toFixed(0)} cm` : `${m.toFixed(m < 10 ? 1 : 0)} m`);
    const sci = (x: number) => {
      const e = Math.floor(Math.log10(x));
      return `${(x / Math.pow(10, e)).toFixed(2)}×10^{${e}}`;
    };
    function updateText(): void {
      const aC = D.si.alphaC;
      const aCp = D.ps.alphaC;
      rL.set(fmtLen(Lnm));
      rAc.set(fmtDeg(aC, 3));
      rAcPs.set(fmtDeg(aCp, 3));
      rPen.set(fmtLen(D.penSi));
      rFoot.set(fmtLen(D.foot * 1000));
      rFoot.el.title = `beam size normal to the surface h = ${D.beamH} µm (${st.coherent ? 'CSSI coherent focus, horizontal size on the vertical surface' : 'ordinary GISAXS, CRL-1 full beam'})`;
      const s = speckleSize(D.lambda * 1e-9, DETECTOR_DISTANCE, BEAM_FWHM_NM * 1e-9);
      rSpk.set(`${(s * 1e3).toFixed(1)} mm`);
      rSpk.el.title = `≈ ${Math.round(s / PIXEL_EIGER)} Eiger pixels (75 µm) for a 1 µm wide coherent beam`;
      const footCoh = footprint(BEAM_H_COHERENT, D.aI) * 1000;
      // minimum distance for 2 pixels per speckle (Nyquist), p = 75–150 µm, W = vertical focus 0.35–1.7 µm
      const dLo = dNeed(2, 75e-6, 0.35e-6);
      const dHi = dNeed(2, 150e-6, 1.7e-6);
      rNote.set(
        'Coherent photons per second: **APS-U (9-ID): about 10^{12}**, roughly **200 times more** than the old APS. The detector sits up to **21.8 m** away inside a walk-in vacuum tube, so each speckle grows big enough to see.',
        `δ_{Si} = ${sci(D.si.delta)}, β_{Si} = ${sci(D.si.beta)}, δ_{PS} = ${sci(D.ps.delta)}. Oversampling: the speckle λD/W must span ≥ 2 pixels p (Nyquist for phasing): D ≥ 2pW/λ = ${fmtM(dLo)}–${fmtM(dHi)} at ${st.E.toFixed(1)} keV for p = 75–150 µm and W = 0.35–1.7 µm (vertical focus = width across the beam on the vertical CSSI surface); ×2.5 more for ~5 px per speckle, and λ is 3× shorter at 25 keV → the Grand Tube: EIGER 16M (75 µm) and MM-PAD (150 µm, no beamstop) ride 2.9–21.8 m from the CSSI sample (z = 55.0 m). Flux: ≈1.2×10^{13} ph/s into the 0.75 × 0.42 µm KB focus at 8.8 keV with ≈3×2 coherent modes (FDR; Beamline Directory) → ~2×10^{12} per mode, modelled as 10^{12} coherent ph/s; pre-upgrade ~5×10^{9} coherent ph/s (8-ID-I), ~10^{9} in the 2012 CSSI demonstration (8-ID-E, D = 0.7 m, hours per pattern). Drawn as classic horizontal-sample GISAXS; the CSSI station mounts the surface vertically (same physics, α_{f} spreads sideways). *Illustrative:* 2.56 µm patch (real coherent footprint ${fmtLen(footCoh)} for h = ${BEAM_H_COHERENT} µm, so real speckle is ~${Math.max(1, Math.round(footCoh / (N * PIXEL_NM)))}× finer along α_{f} via q_{x} = k(cos α_{f} − cos α_{i})), Cahn–Hilliard time units, photon-count scale (only the APS : APS-U ratio is meaningful), full transverse coherence.`,
      );
      // caption
      const a = st.aIdeg;
      let v: string;
      let spc: string;
      const Rpct = fmtPct(D.fSi.R).replace('%', '');
      const E = `${st.E.toFixed(1)} keV`;
      if (D.aI < aCp) {
        v = `**Below the critical angle: total reflection.** At ${a.toFixed(2)}° the X-rays can’t get in. They bounce off like a stone skipping on water (${Rpct}% reflected), and only a faint *evanescent* wave reaches about **${fmtLen(D.penSi)}** into the surface. Everything the detector sees comes from the very top.`;
        spc = `α_{i} = ${fmtDeg(D.aI, 3)} < α_{c}(PS) = ${fmtDeg(aCp, 3)} < α_{c}(Si) = ${fmtDeg(aC, 3)} at ${E}: total external reflection, |R|^{2} = ${Rpct}%, evanescent Λ_{1/e} = ${fmtLen(D.penSi)} (→ λ/4πα_{c} = ${fmtLen(D.lambda / (4 * Math.PI * aC))} as α_{i} → 0), |T_{i}|^{2} = ${D.fSi.T2.toFixed(2)}.`;
      } else if (D.aI < aC) {
        v = `**Between two critical angles.** At ${a.toFixed(2)}° the beam can enter the polymer islands, but the silicon underneath still reflects almost all of it (${Rpct}%). The islands sit in a bright *standing wave* (panel 3), which is why grazing incidence is so good at seeing very thin layers.`;
        spc = `α_{c}(PS) = ${fmtDeg(aCp, 3)} < α_{i} = ${fmtDeg(D.aI, 3)} < α_{c}(Si) = ${fmtDeg(aC, 3)} at ${E}: islands fully illuminated while Si still totally reflects (|R|^{2} = ${Rpct}%, Λ_{Si} = ${fmtLen(D.penSi)}); |T_{i}|^{2} = ${D.fSi.T2.toFixed(2)}, peaking just above α_{c} (→ 4 for β → 0; absorption caps it lower).`;
      } else {
        v = `**Above the critical angle.** At ${a.toFixed(2)}° the X-rays dive about **${fmtLen(D.penSi)}** into the silicon and the mirror reflection fades to ${Rpct}%. The **Yoneda band** on the detector does not move when you tilt: it always sits at silicon’s critical angle, a built-in fingerprint of the material.`;
        spc = `α_{i} = ${fmtDeg(D.aI, 3)} > α_{c}(Si) = ${fmtDeg(aC, 3)} at ${E}: Λ_{1/e} = ${fmtLen(D.penSi)}, |R|^{2} = ${Rpct}%, refracted at ${fmtDeg(D.aT, 3)}. Specular at α_{f} = α_{i} (q_{z} = 2k sin α_{i} = ${(2 * D.k * Math.sin(D.aI)).toFixed(3)} nm^{−1}); Yoneda stays at α_{f} = α_{c}.`;
      }
      const qs = det.peakBin * DQ;
      if (!st.coherent) {
        v += ` The two bright stripes are the islands’ **spacing fingerprint** (about ${fmtLen(Lnm)}). As the islands ripen and grow apart, the stripes slide toward the centre.`;
        spc += ` Ordinary GISAXS (h = ${BEAM_H_GISAXS} µm normal to the surface, footprint ${fmtLen(D.foot * 1000)}): ensemble DWBA with ring-averaged slice spectra; correlation rods at ±q∗ = ${qs.toFixed(4)} nm^{−1}, L = 2π/q∗ = ${fmtLen(Lnm)}.`;
      } else if (st.source === 'apsu') {
        v += ` **Coherent beam (APS-U):** the smooth stripes break into **speckle**, a barcode of exactly which islands sit under the beam. As the islands move, the barcode flickers. Timing that flicker is **GI-XPCS**; decoding the barcode into a 3D picture of the surface is **coherent surface scattering imaging (CSSI)**.`;
        spc += ` Coherent (W = 1 µm FWHM across × h = ${BEAM_H_COHERENT} µm normal to the surface, footprint ${fmtLen(footCoh)}): I = |Σ_{l} c_{l}(α_{f}) M̃_{l}(q)|^{2} over the actual islands, speckle width Δq_{y} ≈ 2π/W; dashed = ensemble average. The speckle decorrelates as the islands coarsen (GI-XPCS); phase retrieval inverts it to a 3D surface image (CSSI).`;
      } else {
        v += ` **The same experiment with the old APS:** about 200 times fewer coherent photons, so each 1-second frame catches only a sprinkle of photons. The barcode is still there, but buried in noise: you would have to add up many frames, far too slow to follow a surface that changes in seconds.`;
        spc += ` ~5×10^{9} coherent ph/s (pre-upgrade 8-ID) vs 10^{12} for APS-U 9-ID (~200×): Poisson-limited 1 s frames (${photons !== null ? fmtCount(photons) : '…'} photons here, illustrative scale). XPCS SNR ≈ β·I·√(T·τ·N_{pix}) at low counts, so at fixed SNR and total time the shortest resolvable τ ∝ 1/I^{2}: the old APS could follow only ~4×10^{4}× slower dynamics. (The 2012 CSSI demonstration at 8-ID-E had ~10^{9} ph/s and needed hours per pattern; Sun et al., Nat. Photon. 6, 586 (2012).)`;
      }
      if (restartNotice > 0) {
        v = `**A fresh film!** The islands had fully ripened, so the exhibit started a new one. ` + v;
        spc = `New quench (islands had coarsened to L > ${RESTART_L_NM} nm, i.e. only ~5 islands across the 2.56 µm patch). ` + spc;
      }
      station.setCaption(v, spc);
    }

    // ------------------------------------------------------------ interactions
    let updateCurvesNeeded = false;
    function paramsChanged(): void {
      D = derive();
      roiDirty = true;
      if (updateCurvesNeeded) {
        updateCurves();
        updateCurvesNeeded = false;
      }
      detDirty = true;
      depthDirty = true;
      updateText();
    }

    function pokeAt(x: number, y: number, add?: boolean): void {
      const i = (((Math.round(y) % N) + N) % N) * N + (((Math.round(x) % N) + N) % N);
      const doAdd = add ?? surface.phi[i] < 0;
      const Lpx = Lnm / PIXEL_NM;
      surface.poke(x, y, Math.max(2.5, Lpx * (doAdd ? 0.3 : 0.42)), doAdd);
      pulse = prefersReducedMotion() ? null : { x, y, t: 0 };
      surfDirty = true;
      forceRefresh = true;
    }

    // top view: tap to add/remove islands
    const topPos = (e: PointerEvent) => {
      const r = cTop.canvas.getBoundingClientRect();
      const T = topLayout(cTop.w, cTop.h);
      const x = ((e.clientX - r.left - T.x) / T.s) * N;
      const y = ((e.clientY - r.top - T.y) / T.s) * N;
      return x >= 0 && y >= 0 && x < N && y < N ? { x, y } : null;
    };
    const onTopDown = (e: PointerEvent) => {
      const p = topPos(e);
      if (p) pokeAt(p.x, p.y);
    };
    const onTopMove = (e: PointerEvent) => {
      topHover = topPos(e);
      topDirty = true;
    };
    const onTopLeave = () => {
      topHover = null;
      topDirty = true;
    };
    cTop.canvas.addEventListener('pointerdown', onTopDown);
    cTop.canvas.addEventListener('pointermove', onTopMove);
    cTop.canvas.addEventListener('pointerleave', onTopLeave);

    // depth plot: drag to set α_i
    let depthPlot: { x0: number; x1: number; y0: number; y1: number } | null = null;
    let dragging = false;
    const angleFromDepth = (e: PointerEvent) => {
      if (!depthPlot) return;
      const r = cDepth.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const a = ((x - depthPlot.x0) / (depthPlot.x1 - depthPlot.x0)) * 0.6;
      const v = Math.max(0.02, Math.min(0.6, Math.round(a / 0.005) * 0.005));
      sAngle.set(v, true);
    };
    const onDepthDown = (e: PointerEvent) => {
      const r = cDepth.canvas.getBoundingClientRect();
      if (!depthPlot || e.clientY - r.top < depthPlot.y1 - 10) return;
      dragging = true;
      cDepth.canvas.setPointerCapture(e.pointerId);
      angleFromDepth(e);
    };
    const onDepthMove = (e: PointerEvent) => {
      if (dragging) angleFromDepth(e);
    };
    const onDepthUp = () => {
      dragging = false;
    };
    cDepth.canvas.addEventListener('pointerdown', onDepthDown);
    cDepth.canvas.addEventListener('pointermove', onDepthMove);
    cDepth.canvas.addEventListener('pointerup', onDepthUp);
    cDepth.canvas.addEventListener('pointercancel', onDepthUp);

    // detector hover readout
    const onDetMove = (e: PointerEvent) => {
      const r = cDet.canvas.getBoundingClientRect();
      const L = detLayout(cDet.w, cDet.h);
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (x < L.x0 || x > L.x1 || y < L.y0 || y > L.y1) {
        if (ddraw.hover) {
          ddraw.hover = null;
          detDrawDirty = true;
        }
        return;
      }
      const qMax = J_HALF * DQ;
      const qy = -qMax - DQ / 2 + ((x - L.x0) / (L.x1 - L.x0)) * (2 * qMax + DQ);
      const af = det.af[0] - ((y - L.y0) / (L.y1 - L.y0)) * (det.af[0] - det.af[det.rows - 1]);
      ddraw.hover = { qy, af };
      detDrawDirty = true;
    };
    const onDetLeave = () => {
      ddraw.hover = null;
      detDrawDirty = true;
    };
    cDet.canvas.addEventListener('pointermove', onDetMove);
    cDet.canvas.addEventListener('pointerleave', onDetLeave);
    station.onDestroy(() => {
      cTop.canvas.removeEventListener('pointerdown', onTopDown);
      cTop.canvas.removeEventListener('pointermove', onTopMove);
      cTop.canvas.removeEventListener('pointerleave', onTopLeave);
      cDepth.canvas.removeEventListener('pointerdown', onDepthDown);
      cDepth.canvas.removeEventListener('pointermove', onDepthMove);
      cDepth.canvas.removeEventListener('pointerup', onDepthUp);
      cDepth.canvas.removeEventListener('pointercancel', onDepthUp);
      cDet.canvas.removeEventListener('pointermove', onDetMove);
      cDet.canvas.removeEventListener('pointerleave', onDetLeave);
    });

    let restartNotice = 0;
    function restartFilm(): void {
      seed += 1;
      surface.seedRipened(seed, SEED_L_PX);
      hist.n = 0;
      memory.reset();
      roiDirty = true;
      surfDirty = true;
      forceRefresh = true;
      refreshSurface();
    }
    function resetAll(): void {
      seed += 1;
      surface.seedRipened(seed, SEED_L_PX);
      hist.n = 0;
      memory.reset();
      setPlaying(!prefersReducedMotion());
      st.aIdeg = 0.3;
      st.E = 8;
      st.coherent = false;
      st.source = 'apsu';
      sAngle.set(st.aIdeg);
      sEnergy.set(st.E);
      tBeam.set('ord');
      tSource.set('apsu');
      gCoh.style.display = 'none';
      updateCurvesNeeded = true;
      surfDirty = true;
      forceRefresh = true;
      paramsChanged();
      refreshSurface();
    }

    // redraw everything on resize
    for (const c of [cSide, cDet, cDepth, cTop])
      c.onResize(() => {
        detDrawDirty = true;
        depthDirty = true;
        topDirty = true;
      });

    // ------------------------------------------------------------ loop
    const setupRoi = () => {
      const cells: number[] = [];
      // ROI: speckle region from just below the Yoneda band up to α_c + 0.5°, |q_y| = 0.5–2 q* (≈ 40 independent
      // speckles in this simulation — a 0.7–1.3 q* strip on the Yoneda row alone holds only ~5, too noisy for C(τ))
      const r0 = Math.max(0, Math.round(det.rowOf(Math.min(det.alphaC + 0.5 * DEG, 0.95 * DEG))));
      const r1 = Math.min(det.rows - 1, Math.round(det.rowOf(Math.max(det.alphaC - 0.02 * DEG, 0.01 * DEG))));
      const pk = det.peakBin;
      const c0 = Math.max(1, Math.floor(0.5 * pk));
      const c1 = Math.min(J_HALF, Math.ceil(2 * pk));
      for (let r = r0; r <= r1; r++)
        for (let j = c0; j <= c1; j++) {
          cells.push(r * det.cols + J_HALF + j);
          cells.push(r * det.cols + J_HALF - j);
        }
      memory.setRoi(cells);
      roiDirty = false;
    };
    let xpcsClock = 0;
    const XPCS_DT = 0.2;
    let frameEma = 1 / 60;
    let sideSkip = 0;

    /*
     * Frame budget. The simulation work per detector refresh (height map ≈ 2 ms, slice FFTs ≈ 6 ms, DWBA ≈ 3 ms,
     * Poisson frame ≈ 2 ms, CH step ≈ 2 ms each on an i5-6300U) would land in one ~15–20 ms frame and stutter.
     * Instead each stage runs only if it fits the remaining budget of this frame (the first stage of a frame always
     * runs), using running cost estimates — fast machines do everything at once, slow ones spread it over frames.
     */
    const BUDGET_MS = 7;
    const cost = { ch: 2, height: 2, spectra: 6, det: 3, compose: 2.5 };
    type Stage = keyof typeof cost;
    let used = 0;
    const fits = (k: Stage) => used === 0 || used + cost[k] <= BUDGET_MS;
    const run = (k: Stage, fn: () => void) => {
      const t0 = performance.now();
      fn();
      const ms = performance.now() - t0;
      cost[k] = 0.8 * cost[k] + 0.2 * ms;
      used += ms;
    };
    const runHeight = () => surface.computeHeight();
    const runSpectra = () => surface.computeSpectra();
    const runFinish = () => {
      finishRefresh();
      recomputeDetector();
    };
    const runStep = () => surface.advance(1);

    let stepAcc = 0;
    /** clock of the side view's moving beam dashes (stands still under reduced motion) */
    let sideT = 0;
    let refreshClock = 0;
    let noiseClock = 0;
    let textClock = 0;
    const tick = (dt: number, t: number) => {
      // adaptive load shedding on slow machines: fewer CH steps, slower detector refresh, side view at half rate
      if (dt > 0) frameEma = 0.95 * frameEma + 0.05 * dt;
      const slow = frameEma > 1 / 38;
      used = 0;
      // coherent cross-fade (a cut under reduced motion)
      const target = st.coherent ? 1 : 0;
      if (st.mix !== target) {
        st.mix = prefersReducedMotion() ? target : st.mix + Math.sign(target - st.mix) * Math.min(Math.abs(target - st.mix), dt * 1.8);
        noiseDirty = true;
      }
      const hold = still();
      if (!hold) sideT = t;
      // user edits (taps on the surface) go through in one go, immediately
      if (forceRefresh) {
        forceRefresh = false;
        refreshClock = 0;
        const t0 = performance.now();
        refreshSurface();
        used += performance.now() - t0;
      }
      // staged surface → detector pipeline at the 'detector frame rate'
      refreshClock += dt;
      if (pipe === 0 && surfDirty && refreshClock >= (slow ? REFRESH_DT * 1.7 : REFRESH_DT) && fits('height')) {
        refreshClock = 0;
        surfDirty = false;
        run('height', runHeight);
        pipe = 1;
      }
      if (pipe === 1 && fits('spectra')) {
        run('spectra', runSpectra);
        pipe = 2;
      }
      if (pipe === 2 && fits('det')) {
        run('det', runFinish);
        pipe = 0;
      }
      // unattended exhibit: once the islands have fully ripened, quench a fresh film
      if (st.playing && pipe === 0 && Lnm > RESTART_L_NM && surface.t > 300) {
        restartFilm();
        restartNotice = 3.5;
      }
      if (restartNotice > 0) restartNotice -= dt;
      // slider changes (angle, energy, beam) → detector only
      if (pipe === 0 && detDirty && fits('det')) run('det', recomputeDetector);
      noiseClock += dt;
      // fresh shot noise on the coherent speckle (it twinkles), unless everything holds still
      if (st.coherent && st.mix >= 0.999 && !hold && noiseClock >= (st.playing ? REFRESH_DT : 0.25)) {
        noiseClock = 0;
        noiseDirty = true;
      }
      if (noiseDirty && !detDirty && fits('compose')) run('compose', composeDisplay);
      // anneal: CH steps at a fixed rate per wall-clock second, in whatever budget is left (≤ 2 per frame)
      if (st.playing) {
        stepAcc += dt * (slow ? STEPS_PER_SEC * 0.7 : STEPS_PER_SEC);
        let n = 0;
        while (stepAcc >= 1 && n < 2 && fits('ch')) {
          run('ch', runStep);
          stepAcc -= 1;
          n++;
          surfDirty = true;
        }
        if (stepAcc > 3) stepAcc = 3; // never bank a backlog
      }
      // GI-XPCS recording (steady coherent mode only)
      if (st.coherent && st.mix >= 0.999) {
        if (roiDirty) setupRoi();
        xpcsClock += dt;
        // sample only freshly drawn frames: re-correlating one noise realisation with itself would add its shot noise
        if (xpcsClock >= XPCS_DT && freshFrame) {
          xpcsClock = 0;
          freshFrame = false;
          memory.push(disp, cohN, incN, t, photonScale());
          memory.draw(cX, accent, station.depth === 'specialist', null);
        }
      }
      if (pulse) {
        pulse.t += dt * 1.6;
        topDirty = true;
        if (pulse.t >= 1) pulse = null;
      }
      const f = flags();
      if (!slow || ++sideSkip % 2 === 0) drawSide(cSide, D, f, prof, det, rowCenter, sideT);
      if (detDrawDirty) {
        drawDetector(cDet, D, f, det, ddraw);
        detDrawDirty = false;
      }
      depthClock += dt;
      if (depthSurfDirty && depthClock >= 0.33) depthDirty = true;
      if (depthDirty) {
        depthClock = 0;
        depthSurfDirty = false;
        depthPlot = drawDepth(cDepth, D, f, rowCenter, curves).plot;
        depthDirty = false;
      }
      if (topDirty) {
        if (topImageDirty) {
          paintSurface(topImg, surface.height, accent);
          topCtx.putImageData(topImg, 0, 0);
          topImageDirty = false;
        }
        drawTop(cTop, f, topCanvas, surface.win, { L: Lnm, hover: topHover, pulse, history: hist });
        topDirty = false;
      }
      textClock += dt;
      if (textClock > 0.5) {
        textClock = 0;
        updateText();
      }
    };
    // layout needs every control group to exist (the Numbers group moves in stacked mode)
    applyLayout();
    ro.observe(host);
    // first paint synchronously so the station is never blank
    refreshSurface();
    recomputeDetector();
    composeDisplay();
    relabel();
    updateText();
    tick(0, 0);
    loop(station, tick);

    return {
      destroy: () => station.destroy(),
      setDepth: (d: Depth) => {
        station.setDepth(d);
        relabel();
        updateText();
        detDrawDirty = true;
        depthDirty = true;
        topDirty = true;
      },
    };
  },
};
export default mod;
