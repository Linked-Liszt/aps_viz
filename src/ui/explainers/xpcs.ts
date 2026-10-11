/**
 * Station "Nanoparticle motion". X-ray photon correlation spectroscopy (XPCS) at 8-ID.
 *
 * What it simulates (details + equations in xpcs/physics.ts and xpcs/sim.ts):
 *  - 1000 colloidal spheres (radius a) Brownian-diffusing in water: D = k_B T/(6πηa), η(T) from the Vogel
 *    equation. Only motion ⟂ beam matters at small angles, so the 2-D projection is exact.
 *  - A partially coherent 3 µm beam (two incoherent modes → speckle contrast β ≈ 0.53) and the far-field
 *    speckle |A(q)|², A(q) = F(qa) Σ ψ(r_j) e^{−iq·r_j}, recomputed every 50 µs detector frame by FFT.
 *  - Photon counting: Poisson noise with ⟨n⟩ = n₀ P(qa) I/⟨I⟩, n₀ = 1 photon/pixel/frame for APS-U;
 *    the APS (pre-2023) frame is the same frame with 1/500 of the photons (Poisson thinning). Gain 500×:
 *    documented range for 8-ID 500–850× (design 1.7×10¹³ ph/s in one mode vs ≈2×10¹⁰ ph/s at pre-upgrade 8-ID-I
 *    = 850×, different energy/bandwidth; directory 1×10¹³ → 500×), FDR Table 1.1: 520× at 20 keV, and checked
 *    by a Gaussian-source estimate at 10 keV (≈600× ideal; physics.ts coherentGainEstimate, unit-tested).
 *  - Multi-tau g2(q,τ) = ⟨I(t)I(t+τ)⟩/⟨I⟩² for every q-ring at once, compared with the Siegert-relation
 *    theory g2 = 1 + β exp(−2Dq²τ). Error bars: scatter of 8 azimuthal sectors, floored at the speckle-sampling
 *    error √(v/M) (physics.ts speckleSamplingErr), which the sector scatter under-reads on short runs.
 *  - Signal-to-noise: expected SNR of the short-delay contrast, 1/SNR² = 1/SNR_shot² + 1/SNR_speckle²
 *    (photon shot noise ∝ 1/flux; speckle sampling, flux-independent), validated against the simulation's
 *    run-to-run scatter (physics.ts xpcsSnrModel). Hence the time APS needs for equal quality,
 *    (G² + x)/(1 + x): ≈100× at the defaults (APS-U speckle-limited), → G² = 250,000× for photon-starved
 *    (fast / weak) signals, which is the B² scaling of XPCS time resolution.
 *  - Single-pixel trace and real-space view connect intensity changes, correlation and particle motion.
 *  - Readouts: τ = 1/(Dq²) (theory), contrast β and τ from a weighted fit of g2 = 1 + β e^{−2Γτ} to the selected
 *    source's data (shown only once the lags reach the decay and the contrast SNR ≥ 4; APS usually: "too noisy").
 *    Measured SNR check (16 seeds, defaults, 1500 frames): run-to-run SNR of the short-τ contrast 14.9 (APS-U)
 *    and 1.37 (APS) vs model 15.8 and 1.79, i.e. the model is good to ~10 % when speckle-limited and ~30 %
 *    optimistic when photon-starved (the UI says so).
 * Illustrative choices (stated in the UI): the photon rate n₀, the 2-mode coherence model, instantaneous
 * frames (no exposure blur), 97×97-pixel detector crop, a dilute non-interacting sample, 50 µs frames
 * (8-ID's Rigaku 3M runs at 19.2 µs).
 */
import type { ExplainerModule } from './registry';
import { TOKENS, button, canvas2d, createStation, group, loop, note, onReducedMotionChange, prefersReducedMotion, readout, slider, toggle } from './kit';
import { APSU_GAIN, GEOM, emaResidualContrast, equalSnrTimeRatio, fitG2, fitRingAngle, fmtLen, fmtTime, sci } from './xpcs/physics';
import { DISP_FRAMES, LONG_FRAMES, XpcsSim, type G2Series, type SourceIx } from './xpcs/sim';
import { DetectorView, G2View, SampleView, type DetView, type MapData, type ViewState } from './xpcs/views';

const RING_MIN = 7;
const RING_MAX = 60;
const RING_HW = 1;
const DEF = { radiusNm: 100, tempC: 20, ringR: 24, theta: -0.62, src: 1 as SourceIx, view: 'photons' as DetView };
/** detector frames simulated per wall-clock second (if the machine keeps up) */
const SIM_RATE = 150;
/** compute budget per animation frame for the simulation (ms) */
const BUDGET_MS = 13;
/** reduced motion: detector frames measured off-screen after each (re)start, so the paused station shows a result */
const PREFILL_FRAMES = 900;

/** rings used for the Γ(q) map: 27 non-overlapping 3-px rings */
const MAP_RINGS = Int32Array.from({ length: 27 }, (_, i) => 7 + 2 * i);

const newSeries = (): G2Series => ({ n: 0, tau: new Float64Array(96), g2: new Float64Array(96), err: new Float64Array(96), bin: new Float64Array(96) });

const G_TXT = APSU_GAIN.toLocaleString('en-US');
const G2_TXT = (APSU_GAIN * APSU_GAIN).toLocaleString('en-US');
/** round to one significant figure: 352 → 400 (the SNR model behind the time ratio is good to ~15–25 %) */
const round1 = (v: number) => {
  const m = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.round(v / m) * m;
};

/** Two-bar signal-to-noise meter (log scale) comparing APS-U and APS on the selected ring. */
function snrMeter(parent: HTMLElement, accent: string): { set(u: number, a: number, fmt: (v: number) => string): void } {
  const box = document.createElement('div');
  box.style.cssText = 'display:flex;flex-direction:column;gap:5px;padding:8px 9px;border-radius:8px;background:rgba(255,255,255,.035);border:1px solid rgba(150,180,220,.1)';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;font-size:11.5px;color:#8394a9';
  const headL = document.createElement('span');
  headL.textContent = 'Signal-to-noise of the curve';
  const headR = document.createElement('span');
  headR.style.fontSize = '10.5px';
  headR.textContent = 'log scale';
  head.append(headL, headR);
  box.appendChild(head);
  const rows: { bar: HTMLElement; val: HTMLElement }[] = [];
  for (const [name, col] of [
    ['APS-U', accent],
    ['APS', TOKENS.old],
  ] as const) {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:44px 1fr 36px;align-items:center;gap:7px';
    const lab = document.createElement('span');
    lab.textContent = name;
    lab.style.cssText = `font:600 11.5px var(--font);color:${col}`;
    const track = document.createElement('div');
    track.style.cssText = 'position:relative;height:8px;border-radius:4px;background:rgba(150,180,220,.14);overflow:hidden';
    const bar = document.createElement('i');
    bar.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:0;border-radius:4px;background:${col};transition:width .3s`;
    track.appendChild(bar);
    const val = document.createElement('span');
    val.style.cssText = 'font:12px var(--mono);color:#e9eef5;text-align:right';
    row.append(lab, track, val);
    box.appendChild(row);
    rows.push({ bar, val });
  }
  box.setAttribute('role', 'group');
  box.title = "Expected signal-to-noise of the curve's height at short delays, from photon counts and the number of independent speckles averaged";
  parent.appendChild(box);
  const frac = (v: number) => Math.max(0, Math.min(1, Math.log10(1 + Math.max(0, v)) / Math.log10(1 + 1000)));
  return {
    set(u, a, fmt) {
      rows[0].bar.style.width = `${(frac(u) * 100).toFixed(1)}%`;
      rows[1].bar.style.width = `${(frac(a) * 100).toFixed(1)}%`;
      rows[0].val.textContent = fmt(u);
      rows[1].val.textContent = fmt(a);
      box.setAttribute('aria-label', `Signal-to-noise: APS-U ${fmt(u)}, APS ${fmt(a)}`);
    },
  };
}

const mod: ExplainerModule = {
  title: "Nanoparticle motion",
  subtitle: 'Drag the ring on the X-ray speckle, then switch the source between APS and APS-U.',
  mount(host, ctx) {
    const station = createStation(host, { color: ctx.color, layout: 'side' });
    const accent = /^#[0-9a-f]{6}$/i.test(ctx.color) ? ctx.color : '#38bdf8';
    // fixed seed → every visitor sees the same, representative realisation (seed scan: early fits within ~7 % of theory)
    const sim = new XpcsSim(31);

    // ------------------------------------------------------------------ canvases
    const smpC = canvas2d(station.visual, { label: "1 · Sample positions" });
    const detC = canvas2d(station.visual, { label: "2 · Detector pattern" });
    const g2C = canvas2d(station.visual, { label: '3 · How fast it changes' });
    const wraps = { smp: smpC.canvas.parentElement!, det: detC.canvas.parentElement!, g2: g2C.canvas.parentElement! };
    const det = new DetectorView(detC, sim);
    const smp = new SampleView(smpC, sim, accent);
    const g2v = new G2View(g2C, sim);
    let plotMode: 'ring' | 'map' = 'ring';
    const modeBox = document.createElement('div');
    modeBox.style.cssText = 'position:absolute;right:6px;top:4px;z-index:2';
    wraps.g2.appendChild(modeBox);
    const modeToggle = toggle<'ring' | 'map'>(modeBox, {
      options: [
        { value: 'ring', label: 'One ring', title: 'g₂(τ) on the selected ring' },
        { value: 'map', label: 'All rings', title: 'Relaxation rate Γ = 1/τ for every ring: the diffusion law Γ = Dq²' },
      ],
      value: 'ring',
      onChange: (v) => {
        plotMode = v;
        refreshCaption(true);
      },
    });
    for (const b of modeBox.querySelectorAll('button')) (b as HTMLButtonElement).style.cssText = 'padding:3px 9px;font-size:11px';
    const mapData: MapData = {
      rings: MAP_RINGS,
      gamma: [new Float64Array(MAP_RINGS.length).fill(NaN), new Float64Array(MAP_RINGS.length).fill(NaN)],
      sig: [new Float64Array(MAP_RINGS.length), new Float64Array(MAP_RINGS.length)],
      D: sim.D,
      Dfit: NaN,
      T: 0,
    };
    let mapNext = 0;
    const mapSeries = newSeries();
    const clearMap = () => {
      mapData.gamma[0].fill(NaN);
      mapData.gamma[1].fill(NaN);
      mapData.Dfit = NaN;
    };
    /** fit one more ring (round robin) for both sources */
    const mapStep = () => {
      const i = mapNext;
      mapNext = (mapNext + 1) % MAP_RINGS.length;
      const r = MAP_RINGS[i];
      const gTh = sim.gammaAt(r) * GEOM.frameS;
      for (const si of [0, 1] as const) {
        const ser = sim.floorErr(sim.g2Ring(si, r, RING_HW, mapSeries), r, RING_HW);
        // gate on the smaller of the measured (sector-scatter) and expected SNR: the sector estimate alone can
        // fluctuate high at very low photon counts and let a meaningless fit through
        const snrv = Math.min(sim.contrastSnr(si, r, RING_HW, 0.25 / gTh).snr, sim.snrModel(si, r, RING_HW, 0.25 / gTh).snr);
        const covered = ser.n > 4 && ser.tau[ser.n - 1] * gTh >= 1.5;
        mapData.gamma[si][i] = NaN;
        if (snrv < 3 || !covered || gTh > 0.6) continue;
        let n = 0;
        while (n < ser.n && ser.tau[n] * gTh < 6) n++;
        const f = fitG2(ser.tau, ser.g2, ser.err, Math.max(4, n), gTh / 30, gTh * 30);
        if (!f.ok || !(f.sigLnGamma < 0.7)) continue;
        mapData.gamma[si][i] = f.gamma / GEOM.frameS;
        mapData.sig[si][i] = f.sigLnGamma;
      }
      // D from the APS-U points: weighted mean of ln(Γ/q²)
      let sw = 0;
      let swl = 0;
      for (let k = 0; k < MAP_RINGS.length; k++) {
        const G = mapData.gamma[1][k];
        if (!(G > 0)) continue;
        const q = sim.qOf(MAP_RINGS[k]) * 1e10;
        const w = 1 / Math.max(1e-4, mapData.sig[1][k] ** 2);
        sw += w;
        swl += w * Math.log(G / (q * q));
      }
      mapData.Dfit = sw > 0 ? Math.exp(swl / sw) : NaN;
    };

    const vs: ViewState = {
      src: DEF.src,
      view: DEF.view,
      ringR: DEF.ringR,
      ringHw: RING_HW,
      theta: DEF.theta,
      accent,
      interacted: false,
      dragging: false,
      hoverRing: false,
      t: 0,
    };
    // reduced motion: start paused The ▶ Play button starts the changing speckle pattern on request.
    let running = !prefersReducedMotion();
    /** detector frames still to be measured silently while paused under reduced motion (see PREFILL_FRAMES) */
    let prefill = 0;
    /** draw the first frame of a silent measurement, so input still gets an immediate answer */
    let prefillShow = false;
    const remeasured = () => {
      if (running || !prefersReducedMotion()) return;
      prefill = PREFILL_FRAMES;
      prefillShow = true;
    };
    const series: [G2Series, G2Series] = [newSeries(), newSeries()];
    type FitRes = { beta: number; gamma: number; sig: number };
    const fits: [FitRes | null, FitRes | null] = [null, null];
    /** analysis passes until the next g2 fit (0 = fit on the next pass) */
    let fitCountdown = 0;
    /** expected SNR of the short-delay contrast (validated model; drives the meter and the words) */
    const snr = [0, 0];
    /** measured SNR (sector scatter; only used to decide whether fitting makes sense) */
    const snrMeas = [0, 0];
    /** model details for APS-U: photon-shot-noise and speckle-sampling limits */
    let snrShotU = 0;
    let snrSpk = 0;

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
      // stacked content can be taller than a fixed-height host: scroll inside instead of clipping
      station.root.style.overflowY = m === 'wide' ? '' : 'auto';
      // the kit gives .stn-visual an explicit min-height, which lets an `auto` row shrink below its content
      station.root.style.gridTemplateRows = m === 'wide' ? '' : 'max-content max-content max-content';
      // the kit's stacked controls auto-fill 190 px columns: two cramped columns at ~450 px; use one full-width column
      station.controls.style.gridTemplateColumns = m === 'narrow' ? 'minmax(0, 1fr)' : '';
      // phone widths: the panel-3 label would run under the One ring / All rings toggle
      const g2Label = wraps.g2.querySelector('.stn-canvas-label');
      if (g2Label) g2Label.textContent = W < 420 ? '3 · How fast' : '3 · How fast it changes';
      const v = station.visual.style;
      wraps.smp.style.gridArea = 'smp';
      wraps.det.style.gridArea = 'det';
      wraps.g2.style.gridArea = 'g2';
      if (m === 'narrow') {
        const inner = W - 16;
        v.gridTemplateColumns = 'minmax(0, 1fr)';
        v.gridTemplateRows = 'auto auto auto';
        v.gridTemplateAreas = '"smp" "det" "g2"';
        v.height = '';
        wraps.smp.style.height = `${Math.round(Math.max(170, Math.min(250, inner * 0.5)))}px`;
        wraps.det.style.height = `${Math.round(Math.min(560, inner * 0.96 + 40))}px`;
        wraps.g2.style.height = `${Math.round(Math.max(300, Math.min(440, inner * 0.82)))}px`;
      } else {
        v.gridTemplateColumns = 'minmax(0, 1fr) minmax(0, 1.08fr)';
        v.gridTemplateRows = 'minmax(0, 0.8fr) minmax(0, 1.2fr)';
        v.gridTemplateAreas = '"smp det" "g2 det"';
        v.height = m === 'mid' ? `${Math.round(Math.min(620, (W - 16) * 0.53 + 70))}px` : '';
        for (const wr of Object.values(wraps)) wr.style.height = '100%';
      }
    };
    const ro = new ResizeObserver(() => applyLayout());
    ro.observe(host);
    station.onDestroy(() => ro.disconnect());
    applyLayout();

    // ------------------------------------------------------------------ controls
    // 1. Source
    const gSrc = group(station.controls, 'X-ray source');
    const srcToggle = toggle<'aps' | 'apsu'>(gSrc, {
      options: [
        { value: 'aps', label: 'APS before upgrade', title: 'The original APS storage ring (1996–2023)' },
        { value: 'apsu', label: 'APS-U', title: 'The upgraded multi-bend-achromat ring (2024–)' },
      ],
      value: 'apsu',
      onChange: (v) => {
        vs.src = v === 'apsu' ? 1 : 0;
        refreshReadouts();
        refreshCaption(true);
      },
    });
    const rPhot = readout(gSrc, 'Photons/pixel/frame (ring)');
    const meter = snrMeter(gSrc, accent);
    note(
      gSrc,
      station,
      `The upgraded electron beam is about 20× narrower, its angular spread is about 4× smaller, and its current is twice as large. Coherent photons form speckle patterns. They come from a source region whose size × angular spread is below about half a wavelength. Coherent flux therefore grows with brightness. This model uses ~${G_TXT}× more coherent photons for APS-U. The documented gain at 8-ID is 500 to 850×, depending on energy and bandwidth.`,
    );

    // 2. Sample
    const gSmp = group(station.controls, 'Sample: spheres in water');
    const sRad = slider(gSmp, {
      label: 'Particle radius a',
      min: 40,
      max: 250,
      log: true,
      value: DEF.radiusNm,
      format: (v) => `${Math.round(v)} nm`,
      onInput: (v) => setSample(v, sTemp.get()),
    });
    const sTemp = slider(gSmp, {
      label: 'Temperature',
      min: 5,
      max: 60,
      step: 1,
      value: DEF.tempC,
      format: (v) => `${Math.round(v)} °C`,
      onInput: (v) => setSample(sRad.get(), v),
    });
    const rD = readout(gSmp, 'Diffusion constant D');
    note(
      gSmp,
      station,
      "Larger or colder particles diffuse more slowly, so the speckle pattern changes more slowly and the correlation curve decays at longer delays. The Stokes–Einstein relation gives the diffusion constant D = k_{B}T/6πηa. Here a is the particle radius, T is the temperature in kelvin, η is the water's viscosity, and k_{B} is Boltzmann's constant, which relates temperature to energy. The simulated slice contains 1,000 dilute spheres, with ~40 in the beam. A real sample 1 mm thick contains 10^{4} to 10^{6} particles in the beam, with the same speckle statistics.",
    );

    // 3. Measurement
    const gMeas = group(station.controls, 'Measurement');
    const ringFmt = (r: number) => fmtLen((2 * Math.PI) / (sim.qOf(r) * 1e10));
    const sRing = slider(gMeas, {
      label: 'Ring: detail size 2π/q',
      min: RING_MIN,
      max: RING_MAX,
      step: 1,
      value: DEF.ringR,
      format: ringFmt,
      onInput: (v) => setRing(v, vs.theta, true),
    });
    const viewToggle = toggle<DetView>(gMeas, {
      label: 'Detected pattern',
      options: [
        { value: 'photons', label: 'Photons', title: `Photon counts over the last ${DISP_FRAMES} detector frames` },
        { value: 'ideal', label: 'Ideal', title: "Noise-free speckle intensity for infinitely many photons" },
        { value: 'long', label: "Long exposure", title: "Average over ~50 ms. Fast changes average out, leaving the average structure." },
      ],
      value: DEF.view,
      onChange: (v) => {
        vs.view = v;
        sim.trackLong = v === 'long';
        if (v === 'long') {
          sim.resetLongExposure();
          remeasured();
        }
        refreshCaption(true);
      },
    });
    const rTau = readout(gMeas, "Decay time τ = 1/Dq²", { big: true, color: accent });
    const rBeta = readout(gMeas, `Fitted contrast β · theory ${sim.beta.toFixed(2)}`);
    rBeta.el.title = "Height of the correlation curve above 1 at zero delay. Higher contrast means more variation between bright and dark speckles; 1 corresponds to a perfectly coherent beam.";
    const rFit = readout(gMeas, 'τ from the fit');
    rFit.el.title = "Weighted fit of g₂ = 1 + β·exp(−2τ/τ_fit) to the selected source's measurements. Displayed once the correlation can be distinguished from noise.";
    const rTime = readout(gMeas, 'Measuring time');
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    gMeas.appendChild(btnRow);
    const syncPause = () => {
      bPause.textContent = running ? '❚❚ Pause' : '▶ Play';
      bPause.setAttribute('aria-pressed', String(!running));
    };
    const bPause = button(btnRow, '❚❚ Pause', () => {
      running = !running;
      if (running) prefill = 0;
      syncPause();
    });
    syncPause();
    onReducedMotionChange(station, (reduced) => {
      if (reduced === running) bPause.click();
    });
    button(btnRow, '↺ Restart', () => restartMeasurement(), 'is-primary');
    button(btnRow, 'Defaults', () => resetAll());
    note(
      gMeas,
      station,
      "Drag the ring on the detector. Larger scattering vectors q correspond to finer details of size 2π/q, which change faster. Each ring is 3 pixels wide. Detector frames are 50 µs apart, and the error bars compare 8 sectors of the ring.",
    );
    const gIdea = group(station.controls, 'What XPCS measures');
    note(
      gIdea,
      station,
      "Ordinary small-angle scattering measures the particles' size and arrangement from the average pattern. Try Long exposure to average out changes in the speckles. XPCS measures how similar the pattern remains after a time interval τ. Its correlation is g_{2}(τ) = ⟨I(t)·I(t+τ)⟩/⟨I⟩^{2}, where I is the scattered intensity at time t and brackets mean an average over measurements. The curve starts at 1 + β. The speckle contrast β describes the variation between bright and dark speckles; it is 0.53 here. Real setups often accept 0.1 to 0.3 to collect more photons. The correlation falls to 1 as particle motion changes the pattern. For many freely diffusing particles, g_{2} = 1 + β·e^{−2Dq²τ}. The scattering vector q corresponds to detail size 2π/q. The decay rate gives the diffusion constant D, which gives the particle size for particles in a fluid of known viscosity and temperature. Dynamic light scattering uses the same principle. XPCS measures motion at nanometre scales and can examine opaque samples.",
    );
    const gAbout = group(station.controls, 'At 8-ID');
    note(
      gAbout,
      station,
      "At 8-ID, XPCS measures motion in nanoparticles, gels and metallic glasses over intervals from millionths of a second to hours. Frames are recorded every 19.2 µs with the Rigaku 3M detector, or about 1 µs in bursts. Small-angle XPCS runs in 8-ID-I and wide-angle XPCS in 8-ID-E. When photon counts limit the measurement, doubling the coherent photon rate allows delays four times shorter at the same signal-to-noise.",
    );
    // ------------------------------------------------------------------ actions
    function setSample(radiusNm: number, tempC: number) {
      sim.setSample(radiusNm, tempC);
      sim.resetMeasurement();
      sim.resetLongExposure();
      remeasured();
      clearMap();
      fits[0] = fits[1] = null;
      fitCountdown = 0;
      refreshReadouts();
      refreshCaption(true);
    }
    function setRing(r: number, theta: number, fromSlider = false) {
      const rr = Math.max(RING_MIN, Math.min(RING_MAX, Math.round(r)));
      vs.ringR = rr;
      // rings wider than the detector half-width exist only in its corners: keep the handle and traced pixel on them
      vs.theta = theta = fitRingAngle(rr, theta, sim.half);
      if (!fromSlider) sRing.set(rr);
      const probe = sim.pixelAt(rr, theta);
      if (probe !== sim.probe) {
        sim.probe = probe;
        sim.traceLen = 0;
      }
      detC.canvas.setAttribute('aria-valuenow', String(rr));
      detC.canvas.setAttribute('aria-valuetext', ringFmt(rr));
      fits[0] = fits[1] = null;
      fitCountdown = 0;
      refreshReadouts();
      refreshCaption(true);
    }
    function restartMeasurement() {
      sim.resetMeasurement();
      clearMap();
      sim.resetLongExposure();
      remeasured();
      fits[0] = fits[1] = null;
      fitCountdown = 0;
      refreshReadouts();
    }
    function resetAll() {
      sRad.set(DEF.radiusNm);
      sTemp.set(DEF.tempC);
      srcToggle.set('apsu');
      viewToggle.set(DEF.view);
      vs.src = DEF.src;
      vs.view = DEF.view;
      sim.trackLong = false;
      modeToggle.set('ring');
      plotMode = 'ring';
      if (!running && !prefersReducedMotion()) bPause.click();
      sim.setSample(DEF.radiusNm, DEF.tempC);
      setRing(DEF.ringR, DEF.theta);
      restartMeasurement();
      refreshCaption(true);
    }

    // ------------------------------------------------------------------ detector interaction
    const dc = detC.canvas;
    dc.tabIndex = 0;
    dc.setAttribute('role', 'slider');
    dc.setAttribute('aria-label', "Detector ring selection. Use arrow keys or drag to choose q.");
    dc.setAttribute('aria-valuemin', String(RING_MIN));
    dc.setAttribute('aria-valuemax', String(RING_MAX));
    dc.style.cursor = 'crosshair';
    const local = (e: PointerEvent) => {
      const r = dc.getBoundingClientRect();
      return det.pick(e.clientX - r.left, e.clientY - r.top);
    };
    dc.addEventListener('pointerdown', (e) => {
      const p = local(e);
      if (!p.inside) return;
      vs.dragging = true;
      vs.interacted = true;
      dc.setPointerCapture(e.pointerId);
      setRing(p.r, p.theta);
      e.preventDefault();
    });
    dc.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (vs.dragging) {
        setRing(p.r, p.theta);
        return;
      }
      vs.hoverRing = p.inside && Math.abs(p.r - vs.ringR) < 4;
      dc.style.cursor = vs.hoverRing ? 'grab' : p.inside ? 'crosshair' : 'default';
    });
    const endDrag = () => {
      vs.dragging = false;
    };
    dc.addEventListener('pointerup', endDrag);
    dc.addEventListener('pointercancel', endDrag);
    dc.addEventListener('pointerleave', () => (vs.hoverRing = false));
    dc.addEventListener('keydown', (e) => {
      const step = e.key === 'PageUp' || e.key === 'PageDown' ? 5 : 1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') setRing(vs.ringR + step, vs.theta);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') setRing(vs.ringR - step, vs.theta);
      else return;
      vs.interacted = true;
      e.preventDefault();
    });

    // ------------------------------------------------------------------ analysis
    const ringGamma = () => sim.gammaAt(vs.ringR) * GEOM.frameS; // per frame
    let anaKey = '';
    function analyse() {
      // nothing new to analyse (paused, or the governor skipped the simulation this frame)
      const key = `${sim.totalFrames}:${sim.corr[1].frames}:${vs.ringR}:${sim.D}`;
      if (key === anaKey) return;
      anaKey = key;
      const gF = ringGamma();
      for (const si of [0, 1] as const) {
        sim.floorErr(sim.g2Ring(si, vs.ringR, RING_HW, series[si]), vs.ringR, RING_HW);
        // measured SNR of the short-time contrast (lags τ ≤ τ_c/4) from the sector-to-sector scatter: gates fitting
        snrMeas[si] = sim.contrastSnr(si, vs.ringR, RING_HW, 0.25 / gF).snr;
        const m = sim.snrModel(si, vs.ringR, RING_HW, 0.25 / gF);
        snr[si] = m.snr;
        if (si === 1) {
          snrShotU = m.shot;
          snrSpk = m.speckle;
        }
      }
      // refit every 4th analysis pass (~0.13 s; a fit is ~130 χ² evaluations, ≈0.15 ms), immediately after any
      // change, and only once the measured lags reach the decay (τ_max Γ ≥ 1) and the short-delay contrast stands
      // clear of the noise: an early fit to a handful of short lags is unconstrained in Γ and would mislead
      if (fitCountdown-- > 0) return;
      fitCountdown = 3;
      for (const si of [0, 1] as const) {
        const s = series[si];
        if (s.n < 5 || snrMeas[si] < 4 || s.tau[s.n - 1] * gF < 1) {
          fits[si] = null;
          continue;
        }
        let n = 0;
        while (n < s.n && s.tau[n] * gF < 6) n++;
        const f = fitG2(s.tau, s.g2, s.err, Math.max(3, n), gF / 30, gF * 30);
        fits[si] = f.ok && f.sigLnGamma < 0.7 ? { beta: f.beta, gamma: f.gamma, sig: f.sigLnGamma } : null;
      }
    }

    // ------------------------------------------------------------------ readouts & captions
    const nInBeam = () => {
      const c = sim.n / 2;
      const rf = ((GEOM.beamFwhmUm / 2) * 1e-6) / sim.dxM;
      let k = 0;
      for (let j = 0; j < sim.N; j++) {
        const dx = sim.px[j] - c;
        const dy = sim.py[j] - c;
        if (dx * dx + dy * dy < rf * rf) k++;
      }
      return k;
    };
    const fmtSnr = (v: number) => (v <= 0 ? 'Unknown' : v < 0.1 ? '<0.1' : v < 10 ? v.toFixed(1) : Math.round(v).toString());
    function refreshReadouts() {
      const tauS = 1 / sim.gammaAt(vs.ringR);
      rTau.set(fmtTime(tauS));
      const frames = sim.corr[1].frames;
      rTime.set(fmtTime(frames * GEOM.frameS));
      rTime.el.title = `${frames.toLocaleString('en-US')} detector frames of 50 µs`;
      // APS = APS-U photons thinned by 1/GAIN, so its exact expectation is the (better measured) APS-U rate ÷ GAIN;
      // the readout, the trace annotation and the caption all quote this same number
      const nU = sim.ringMeanCounts(1, vs.ringR, RING_HW);
      const n = vs.src === 1 ? nU : nU / APSU_GAIN;
      ringMeanCache = n;
      rPhot.set(n >= 0.1 ? n.toFixed(2) : n >= 0.001 ? n.toFixed(4) : sci(n));
      meter.set(snr[1], snr[0], fmtSnr);
      rD.set(`${(sim.D * 1e12).toFixed(2)} µm²/s`);
      // fit of the selected source: APS usually has none (too noisy), which is the point
      const f = fits[vs.src];
      const none = frames < 50 || vs.src === 1 || snr[0] >= 4 ? 'measuring…' : 'too noisy';
      rBeta.set(f ? f.beta.toFixed(2) : none);
      rFit.set(f ? `${fmtTime(GEOM.frameS / f.gamma)} ± ${Math.max(1, Math.round(f.sig * 100))} %` : none);
    }

    let capKey = '';
    function refreshCaption(force = false) {
      const q = sim.qOf(vs.ringR);
      const qm = q * 1e10;
      const tauS = 1 / sim.gammaAt(vs.ringR);
      const detail = fmtLen((2 * Math.PI) / qm);
      const shuffle = fmtLen(Math.SQRT2 / qm);
      const frames = sim.corr[1].frames;
      const T = fmtTime(frames * GEOM.frameS);
      const nU = sim.ringMeanCounts(1, vs.ringR, RING_HW);
      const nA = nU / APSU_GAIN;
      const tooFast = tauS / GEOM.frameS < 2.5;
      // long exposure: speckle survives where τ is not ≪ the averaging window (residual contrast β/(1 + 2T_e/τ));
      // judge by the innermost (slowest) and outermost-full (fastest) rings, not only the selected one
      const tLong = LONG_FRAMES * GEOM.frameS;
      const tauIn = 1 / sim.gammaAt(RING_MIN);
      const tauOut = 1 / sim.gammaAt(sim.half);
      const residual = `The contrast on the selected ring is ${emaResidualContrast(sim.beta, tauS, tLong).toFixed(2)}, down from ${sim.beta.toFixed(2)}. `;
      const viewSentence =
        vs.view === 'ideal'
          ? "The ideal view shows the noise-free intensity for infinitely many photons. "
          : vs.view === 'long'
            ? (tauIn < 0.1 * tLong
                ? "The long exposure averages out the changing speckles. It shows the particles' average shape and arrangement, as in ordinary small-angle scattering, without information about their motion. "
                : tauOut < 0.1 * tLong
                  ? "In the long exposure, the fast changes in the outer speckles average out to the particles' average shape, as in ordinary small-angle scattering. Near the centre, the speckle pattern changes more slowly than the ~50 ms averaging window and remains visible. "
                  : "These particles move so slowly that the speckle pattern changes little during the ~50 ms exposure. The long exposure therefore leaves most of the speckle contrast visible. ") + residual
            : '';
      // time APS needs for the same quality: (G² + x)/(1 + x), x = (SNR_shot,U/SNR_speckle)² (validated model, stable
      // in T). Quoted to one significant figure: the model is good to ~15–25 %.
      const ratio = equalSnrTimeRatio(APSU_GAIN, snrShotU, snrSpk);
      const xReg = snrSpk > 0 ? (snrShotU / snrSpk) ** 2 : 0;
      const reliable = frames >= 200 && snrSpk > 0;
      const fmtRatio = (r: number) => round1(r).toLocaleString('en-US');
      // why the factor is not simply G²: APS-U is limited by how many independent speckles it averages, not by photons
      const regime =
        xReg > 1
          ? ` The gain is below ${G_TXT}² = ${G2_TXT}× because the number of independent speckles averaged limits APS-U here.`
          : ` The gain approaches ${G_TXT}² = ${G2_TXT}×. When photon counts limit the measurement, the time for equal quality grows with the square of the photon ratio.`;
      let srcSentence: string;
      if (vs.src === 1) {
        srcSentence =
          (snr[1] >= 8 ? `With APS-U, the correlation is well resolved after ${T} of measuring.` : "With APS-U, the correlation becomes better resolved within a fraction of a second.") +
          ` The old APS, with ${G_TXT}× fewer coherent photons, ` +
          (snr[0] < 3 ? "has noise larger than the correlation signal" : 'is noisier') +
          (reliable ? `: it would need about ${fmtRatio(ratio)}× longer for the same quality.${regime}` : '.');
      } else {
        const every = nA > 0 ? Math.round(1 / nA) : Infinity;
        const word = snr[0] < 3 ? "not distinguishable from noise" : snr[0] < 10 ? 'noisy' : 'visible, but noisier';
        const upTo = ratio < 0.3 * APSU_GAIN * APSU_GAIN ? `, and up to ${G2_TXT}× for faster motion, where low photon counts limit the measurement` : '';
        srcSentence =
          `With the old APS, a pixel on this ring records about one photon every ${every.toLocaleString('en-US')} frames. After ${T}, the correlation is ${word}.` +
          (reliable ? ` Matching APS-U would take about **${fmtRatio(ratio)}× longer** here${upTo}.` : '');
      }
      let okU = 0;
      let okA = 0;
      for (let k = 0; k < MAP_RINGS.length; k++) {
        if (mapData.gamma[1][k] > 0) okU++;
        if (mapData.gamma[0][k] > 0) okA++;
      }
      const dFit = Number.isFinite(mapData.Dfit) ? `. The fitted diffusion constant is D = ${(mapData.Dfit * 1e12).toFixed(2)} µm²/s, compared with ${(sim.D * 1e12).toFixed(2)} from the Stokes–Einstein relation` : '';
      const mapSentence = `Each dot represents the rate Γ = 1/τ at which the speckles on one ring change. On these logarithmic axes, diffusion gives a line of slope 2 because Γ = Dq². Details half as large change 4× faster. APS-U has resolved ${okU} of ${MAP_RINGS.length} rings, compared with ${okA} for the old APS${dFit}. `;
      const ringSentence = `The selected ring has q = ${sci(q)} Å^{−1}, corresponding to details about ${detail} across. The faint stripes in panel 1 represent this scale. The pattern changes in ${fmtTime(tauS)}, the time needed for particles to diffuse ~${shuffle}. `;
      const caption =
        `About ${nInBeamCache} particles are in the X-ray spot in this simulated slice. Their scattered waves interfere to form speckles, which change as the particles diffuse. ` +
        viewSentence +
        (plotMode === 'map' ? mapSentence : ringSentence) +
        (tooFast ? "The decay time is under 2.5 frames, or 125 µs, which is too fast to resolve. Real frames would also blur the speckle; this model does not include that effect. Choose a smaller ring or slow the particles down. " : '') +
        srcSentence;
      if (!force && caption === capKey) return;
      capKey = caption;
      station.setCaption(caption);
    }

    // ------------------------------------------------------------------ main loop
    let simDebt = 0;
    /** measured detector frames per wall-clock second (for the slow-motion badge) */
    let simRate = SIM_RATE;
    let avgStep = 3;
    let lastSlow = 0;
    let nInBeamCache = nInBeam();
    /** mean photons/pixel/frame on the selected ring for the selected source (refreshed with the readouts) */
    let ringMeanCache = 0;
    let frameNo = 0;
    for (let i = 0; i < 6; i++) {
      sim.step();
      smp.record();
    }
    setRing(DEF.ringR, DEF.theta);
    remeasured();
    // a resize clears a canvas: redraw it even while a silent measurement holds the panels
    for (const c of [smpC, detC, g2C]) c.onResize(() => (prefillShow = true));

    /** EMA of the total work of animation frames that ran the simulation (ms): drives the slow-machine governor.
     * Only simulating frames are measured, so engaging the governor does not feed back on its own input. */
    let work = 8;
    let simulatedThisFrame = false;
    loop(station, (dt, t) => {
      const tWork = performance.now();
      // reduced motion, paused: the "drag me" pulse holds still too
      if (running || !prefersReducedMotion()) vs.t = t;
      frameNo++;
      const silent = !running && prefill > 0;
      if (running || silent) {
        simDebt += dt * SIM_RATE;
        const warm = t < 1.2 || silent; // fill the plot quickly at first (or off-screen, under reduced motion)
        // nothing is drawn while silent, so that work may take most of the frame
        const budget = silent ? 32 : warm ? 26 : BUDGET_MS;
        const maxSteps = Math.max(1, Math.min(silent ? 24 : warm ? 10 : 5, Math.floor(budget / Math.max(0.5, avgStep))));
        let steps = Math.min(maxSteps, Math.floor(simDebt));
        if (warm) steps = silent ? Math.min(maxSteps, prefill) : maxSteps;
        // slow machine (a frame costs > 28 ms even with one detector frame): simulate on alternate frames only,
        // so drawing and interaction stay above ~30 fps; the slow-motion badge reports the real rate
        else if (work > 28 && frameNo % 2 === 1) steps = 0;
        simDebt = Math.max(0, Math.min(simDebt - steps, 3));
        simulatedThisFrame = steps > 0;
        if (steps > 0) {
          const t0 = performance.now();
          for (let i = 0; i < steps; i++) {
            sim.step();
            smp.record();
          }
          avgStep = 0.85 * avgStep + (0.15 * (performance.now() - t0)) / steps;
        }
        if (dt > 0 && running) simRate = 0.97 * simRate + 0.03 * (steps / dt);
        if (silent) prefill -= steps;
      }
      // silent measurement: show its first frame (the answer to the input that started it) and its result only
      if (silent && prefill > 0 && !prefillShow) return;
      prefillShow = false;
      if (frameNo % 2 === 0 || !running) analyse();
      const tauFrames = 1 / ringGamma();
      det.draw(vs, { tauFrames });
      smp.draw(vs, sim.radiusNm, sim.tempC, nInBeamCache, running ? 1 / (Math.max(1, simRate) * GEOM.frameS) : 0);
      let meanTrace = 0;
      for (let i = 0; i < sim.traceLen; i++) meanTrace += sim.traceIdeal[i];
      meanTrace = sim.traceLen ? meanTrace / sim.traceLen : 1;
      if (plotMode === 'map') {
        mapStep();
        mapData.D = sim.D;
        mapData.T = sim.corr[1].frames * GEOM.frameS;
      }
      g2v.draw(vs, { series, beta: sim.beta, gamma: ringGamma(), fit: fits, meanTrace, ringMean: ringMeanCache, mode: plotMode, map: mapData });
      if (t - lastSlow > 0.35) {
        lastSlow = t;
        nInBeamCache = nInBeam();
        refreshReadouts();
        refreshCaption();
      }
      if (running && simulatedThisFrame && t > 1.2) work = 0.9 * work + 0.1 * (performance.now() - tWork);
    });

    return {
      destroy: () => station.destroy(),
    };
  },
};

export default mod;
