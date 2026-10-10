/**
 * Station "hedm" — HEXM (20-ID): high-energy diffraction microscopy, far field + near field.
 *
 * One idea: hard X-rays see through millimetres of metal, and every crystal grain inside "flashes" a spot onto a
 * detector when the rotating sample brings its atomic planes to the Bragg angle. From those spots a computer
 * works out where each grain is, how it is turned, and how hard it is being pulled.
 *
 * Panels: 1 rotating sample slice (top view) · 2 far-field detector / near-field camera · 3 penetration vs energy
 *         · 4 what the computer finds (ff: centroids + axial strain; nf: forward-model grain map).
 * Controls: energy 35–120 keV (HEXM range), rod diameter, pull (macroscopic strain), far/near detector,
 *           shift magnification, rotation play/scrub, reset.
 *
 * Physics, equations and sources: ./hedm/physics.ts (header). In brief:
 *   λ[Å] = 12.398/E[keV];  λ = 2d sinθ;  ω from cos(ω+φ) = −λ|g|²/(2ρ);  d̂ = x̂ + λ g_lab
 *   spot (Y,Z) = P_{y,z} + (L − P_x) d̂_{y,z}/d̂_x;  Δ(2θ) = −2 tanθ ε_hkl,  ε_hkl = n̂·ε·n̂
 *   grain strain = ½(Reuss + Voigt), Ni C_ij (Alers 1960); I ∝ λ³ f² e^{−2Bs²} P/(sin2θ|cosη|) · V · e^{−μ(path)}
 *   attenuation: NIST XCOM μ/ρ, log–log interpolation.
 * Beamline numbers (35–120 keV, 180 m, 20-ID-E detectors, APS-U emittance 3113 → 42 pm, nf line beams 3–4 mm,
 * interim U21 source / planned SCU) come from the HEXM research dossier (APS-U FDR 2019, PDR 2017, Beamline
 * Directory, APS news). Illustrative elements (yield stress, plastic broadening, grain count, coarse nf pixels,
 * indexing threshold) are labelled in the specialist text.
 */
import type { ExplainerModule } from './registry';
import { button, canvas2d, createStation, group, loop, note, onReducedMotionChange, prefersReducedMotion, readout, slider, toggle } from './kit';
import * as P from './hedm/physics';
import { HedmSim, NF_VOX, type Mode } from './hedm/sim';
import { AnswerView, DetectorView, PenView, TopView, fmtLen, type ViewState } from './hedm/views';

const ROT_SPEED = 15 * P.DEG; // rad/s (display speed; real scans: minutes per 360°)
const DEF = { E: 70, D: 1.0, pull: 0 };

/** pull slider position 0–100 → macroscopic strain: first half 0–0.6 % (elastic + yield), second half 0.6–5 % */
export function pullToStrain(p: number): number {
  return p <= 50 ? (0.006 * p) / 50 : 0.006 + (0.044 * (p - 50)) / 50;
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}`;
/** weight that would give stress σ (GPa) in a rod of diameter D (mm): F = σ·πD²/4, m = F/g */
export function hangMass(sigmaGPa: number, Dmm: number): string {
  const kg = (sigmaGPa * 1000 * Math.PI * Dmm * Dmm) / 4 / 9.81;
  return kg >= 1000 ? `${(kg / 1000).toFixed(kg >= 10000 ? 0 : 1)} tonnes` : `${kg >= 100 ? Math.round(kg / 10) * 10 : Math.round(kg)} kg`;
}
const tPct = (T: number) => (T >= 0.995 ? '100' : T >= 0.1 ? (T * 100).toFixed(0) : T >= 0.001 ? (T * 100).toFixed(1) : '< 0.1');

const mod: ExplainerModule = {
  title: 'Seeing inside a metal under load',
  subtitle: 'Turn a nickel-alloy rod in a high-energy X-ray beam, watch its grains flash onto the detector, then pull on it.',
  mount(host, ctx) {
    const station = createStation(host, { depth: ctx.depth, color: ctx.color, layout: 'side' });
    const accent = /^#[0-9a-f]{6}$/i.test(ctx.color) ? ctx.color : '#fb923c';
    const sim = new HedmSim(7);
    const vs: ViewState = { omega: 0, mode: 'ff', selected: -1, depth: ctx.depth, accent, t: 0, flashes: [], touched: false, still: false };

    // ------------------------------------------------------------------ canvases
    const smpC = canvas2d(station.visual, { label: '1 · Sample slice, from above' });
    const detC = canvas2d(station.visual, { label: '2 · Far-field detector' });
    const penC = canvas2d(station.visual, { label: '3 · How deep X-rays reach' });
    const ansC = canvas2d(station.visual, { label: '4 · What the computer finds' });
    const wrap = (c: { canvas: HTMLCanvasElement }) => c.canvas.parentElement!;
    const wraps = { smp: wrap(smpC), det: wrap(detC), pen: wrap(penC), ans: wrap(ansC) };
    const labelOf = (w: HTMLElement) => w.querySelector('.stn-canvas-label') as HTMLElement | null;
    const top = new TopView(smpC, sim, vs);
    const det = new DetectorView(detC, sim, vs);
    const pen = new PenView(penC, sim, vs);
    const ans = new AnswerView(ansC, sim, vs);
    let penDirty = true;
    let capDirty = true;
    let capT = 0;
    let capLast = '';
    for (const c of [smpC, detC, penC, ansC]) c.onResize(() => (penDirty = true));

    // ------------------------------------------------------------------ adaptive layout (host width)
    type Lay = 'wide' | 'mid' | 'narrow';
    let lay: Lay | null = null;
    let lastW = 0;
    /** set once the control groups exist: moves them (and the caption) between the side column and the narrow column */
    let placeHook: ((narrow: boolean) => void) | null = null;
    let placed: boolean | null = null;
    const applyLayout = () => {
      const W = Math.round(host.clientWidth || station.root.clientWidth || 900);
      if (W === lastW && lay) return;
      lastW = W;
      const m: Lay = W >= 940 ? 'wide' : W >= 640 ? 'mid' : 'narrow';
      lay = m;
      if (placeHook && placed !== (m === 'narrow')) {
        placed = m === 'narrow';
        placeHook(placed);
      }
      station.root.classList.toggle('stn-side', m === 'wide');
      station.root.classList.toggle('stn-stack', m !== 'wide');
      station.root.style.overflowY = m === 'wide' ? '' : 'auto';
      station.root.style.gridTemplateRows = m === 'wide' ? '' : 'max-content max-content max-content';
      station.controls.style.gridTemplateColumns = m === 'narrow' ? 'minmax(0, 1fr)' : '';
      const v = station.visual.style;
      wraps.smp.style.gridArea = 'smp';
      wraps.det.style.gridArea = 'det';
      wraps.pen.style.gridArea = 'pen';
      wraps.ans.style.gridArea = 'ans';
      if (m === 'narrow') {
        const inner = W - 16;
        v.gridTemplateColumns = 'minmax(0, 1fr)';
        v.gridTemplateRows = 'repeat(6, auto)';
        v.gridTemplateAreas = '"smp" "det" "cap" "ctl" "pen" "ans"';
        v.height = '';
        wraps.smp.style.height = `${Math.round(Math.max(270, Math.min(340, inner * 0.74)))}px`;
        wraps.det.style.height = `${Math.round(Math.min(560, inner + 34))}px`;
        wraps.ans.style.height = `${Math.round(Math.max(220, Math.min(300, inner * 0.6)))}px`;
        wraps.pen.style.height = `${Math.round(Math.max(220, Math.min(300, inner * 0.6)))}px`;
      } else {
        v.gridTemplateColumns = 'minmax(0, 1.12fr) minmax(0, 1fr)';
        v.gridTemplateRows = 'minmax(0, 1.3fr) minmax(0, 1fr)';
        v.gridTemplateAreas = '"smp det" "pen ans"';
        v.height = m === 'mid' ? `${Math.round(Math.min(720, (W - 16) * 0.8))}px` : '';
        for (const wr of Object.values(wraps)) wr.style.height = '100%';
      }
      penDirty = true;
    };
    const ro = new ResizeObserver(() => applyLayout());
    ro.observe(host);
    station.onDestroy(() => ro.disconnect());
    applyLayout();

    // ------------------------------------------------------------------ helpers
    const isSpec = () => station.depth === 'specialist';
    const relabel = (el: HTMLElement, text: string) => {
      const l = el.closest('.stn-slider, .stn-readout, .stn-toggle-wrap')?.querySelector('.stn-slider-label, .stn-readout-label');
      if (l) l.textContent = text;
    };
    let ffDirty = false;
    let lastParam = 0;
    const paramsChanged = (load = false) => {
      sim.updateBeam(); // λ, μ now: readouts must not wait for the (deferred) spot rebuild
      if (load) sim.updateLoad();
      ffDirty = true;
      sim.nfDirty = true;
      lastParam = performance.now();
      penDirty = true;
      refreshReadouts();
      capDirty = true;
    };

    // ------------------------------------------------------------------ controls
    // 0. detector: far field / near field (the station's two "acts")
    const gDet = group(station.controls, 'Detector');
    const tMode = toggle<Mode>(gDet, {
      options: [
        { value: 'ff', label: 'Far · 1 m', title: 'Far-field HEDM: flat panel 1 m downstream' },
        { value: 'nf', label: 'Near · 7 mm', title: 'Near-field HEDM: high-resolution camera a few mm behind the sample' },
      ],
      value: 'ff',
      onChange: (m) => setMode(m),
    });
    const detNote = note(gDet, station, '', '');
    const setDetNote = () =>
      detNote.set(
        vs.mode === 'ff'
          ? 'The **far** detector sorts spots by angle: it tells how each grain is tilted and how much it is stretched, but not its shape.'
          : 'The **near** camera sits so close that each spot still shows where it came from: together they redraw every grain’s **shape**.',
        vs.mode === 'ff'
          ? 'ff: (Y,Z) = P_{y,z} + (L − P_x)(d̂_{y},d̂_{z})/d̂_x with L ≫ sample, so spots encode orientation and d-spacing; centroids come from small position residuals (1-ID-E repeatability ≈ 5 µm, 0.02°, 2×10^{−4} strain). Spots are coloured by grain only to link the panels.'
          : 'nf: L ≈ 5–10 mm, line beam; spots are projections of grain cross-sections. HEXM 20-ID-E serves nf (D1), ff (D2/D3, 2θ ≤ 18°) and very-far-field (up to ~16 m) at one calibrated sample position.',
      );
    setDetNote();

    // 1. beam
    const gBeam = group(station.controls, 'X-ray beam');
    const sE = slider(gBeam, {
      label: 'Energy',
      min: 35,
      max: 120,
      step: 1,
      value: DEF.E,
      format: (v) => `${Math.round(v)} keV`,
      onInput: (v) => {
        sim.E = Math.round(v);
        paramsChanged();
      },
    });
    const rT = readout(gBeam, 'Gets through the rod');
    note(
      gBeam,
      station,
      'Higher-energy X-rays slip through more metal and bounce off the atoms at **smaller angles**: the rings shrink.',
      'λ[Å] = 12.398/E[keV]; 2θ = 2 asin(λ/2d) ≈ λ/d, so ring radii on the flat panel scale ≈ 1/E (Ni 111: 4.99° at 70 keV). Spot signal ∝ λ³/sin2θ · e^{−μD} ≈ λ²d·e^{−μD}: optimum μD ≈ 2/n for μ ∝ E^{−n} (green ▲, panel 3), so thicker parts need higher E (ignores the source spectrum and detector efficiency, both of which fall at high E). HEXM: 35–120 keV from a bent double-Laue Si(111) monochromator (ΔE/E ≈ 10^{−3}); design flux ≈ 10^{14} ph/s unfocused at 70 keV (with the planned SCU).',
    );

    // 2. sample
    const gS = group(station.controls, 'Sample: nickel-alloy rod');
    const sD = slider(gS, {
      label: 'Rod diameter',
      min: 0.5,
      max: 5,
      step: 0.1,
      value: DEF.D,
      format: (v) => `${v.toFixed(1)} mm`,
      onInput: (v) => {
        sim.D = Math.round(v * 10) / 10;
        paramsChanged();
      },
    });
    const sPull = slider(gS, {
      label: 'Pull (stretch)',
      min: 0,
      max: 100,
      step: 1,
      value: DEF.pull,
      format: (p) => `${pct(pullToStrain(p), 2)} %`,
      onInput: (p) => {
        sim.eps = pullToStrain(p);
        paramsChanged(true);
      },
    });
    const rStress = readout(gS, 'Stress');
    const tMag = toggle<'20' | '1'>(gS, {
      label: 'Strain shifts on the detector',
      options: [
        { value: '20', label: 'Magnified ×20', title: 'Radial strain shifts magnified twenty times so they are visible' },
        { value: '1', label: 'True size', title: 'Real shifts: a fraction of a millimetre on a 43 cm panel' },
      ],
      value: '20',
      onChange: (v) => {
        sim.mag = v === '20' ? 20 : 1;
        paramsChanged();
      },
    });
    note(
      gS,
      station,
      'A **nickel alloy** like those in jet engines. Each coloured patch is a **grain**: a tiny crystal with its own tilt. Pull gently and the atoms spring back; past the **yield point** the metal stretches for good.',
      'Model: fcc Ni (a = 3.524 Å), C_{11}, C_{12}, C_{44} = 246.5, 147.3, 124.7 GPa (E_{100} = 136, E_{111} = 304 GPa); grain strain = ½(Reuss + Voigt) under uniaxial σ_{zz}; E_{macro} ≈ 221 GPa. σ_y = 900 MPa, H = 1.5 GPa, and the plastic broadening (0.9° misorientation FWHM per % ε_p) are illustrative. 24 grains for clarity (real ff-HEDM: 10^{2}–10^{4} grains in the beam); the slice scales with the rod.',
    );

    // 3. rotation
    const gRot = group(station.controls, 'Turn the sample');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    gRot.appendChild(row);
    // reduced motion: the sample waits for ▶ Turn (or a drag) instead of turning by itself
    let playing = !prefersReducedMotion();
    const bPlay = button(row, playing ? '❚❚ Pause' : '▶ Turn', () => setPlaying(!playing), 'is-primary');
    button(row, 'New scan', () => {
      sim.resetCoverage();
      vs.flashes.length = 0;
      det.invalidate();
      capDirty = true;
    });
    button(row, 'Reset all', () => resetAll());
    const sOm = slider(gRot, {
      label: 'Rotation angle ω',
      min: 0,
      max: 360,
      step: 1,
      value: 0,
      format: (v) => `${Math.round(v)}°`,
      onInput: (v) => {
        setPlaying(false);
        vs.touched = true;
        const cur = vs.omega / P.DEG;
        turnBy((v - cur) * P.DEG);
      },
    });
    note(
      gRot,
      station,
      'A real scan takes a picture every quarter of a degree for a full turn: over a thousand pictures. Here one second ≈ 15°.',
      'Bragg in the rotation geometry: cos(ω + φ) = −λ|g|²/(2ρ), ρ = |g_{xy}| → two ω per g (four with Friedel −g); g within θ of the rotation axis never diffracts (blind zone near η = ±90°). Lorentz factor 1/(sin2θ|cos η|). Real ff-HEDM: Δω = 0.1–0.25°, 1440–3600 frames per 360°.',
    );

    // 4. selected grain
    const gSel = group(station.controls, 'Grain you are following');
    const card = document.createElement('div');
    card.className = 'stn-readout';
    card.style.cssText = 'display:block;line-height:1.45';
    gSel.appendChild(card);

    // 5. APS-U
    const gU = group(station.controls, 'What APS-U adds');
    note(
      gU,
      station,
      'The upgraded ring makes a far narrower, brighter beam. HEXM spreads it over samples **several millimetres** across (about 1 mm before), or squeezes it to ~200 nm to zoom in on one grain, 180 m from the source.',
      'Emittance 3113 → 42 pm (vertical ≈ 4 pm): at 35–120 keV the electron beam dominates the photon phase space, so the gain carries to high energy. At 20-ID-E (180 m) diamond expanders make 3–4 mm line beams for nf-HEDM; design focus 0.43 × 0.21 µm at 70 keV; ~100× the data rate of pre-upgrade 1-ID. Today’s source is an interim pair of U21 permanent-magnet undulators; a 2 × 1.9 m, 16.5 mm-period SCU is planned (2026–27).',
    );

    // where the groups live: all in the side column (wide/mid); in the narrow single column the main ones
    // (with the live caption) move up right under the detector so nobody has to scroll past four panels
    const mainGroups = [gDet, gBeam, gS, gRot];
    const restGroups = [gSel, gU];
    const quick = document.createElement('div');
    quick.className = 'stn-controls';
    quick.style.cssText = 'grid-area:ctl;grid-template-columns:minmax(0,1fr);border:1px solid rgba(150,180,220,.12);border-radius:8px;overflow:visible';
    const placeGroups = (narrow: boolean) => {
      const cap = station.caption;
      if (narrow) {
        quick.replaceChildren(...mainGroups);
        station.controls.replaceChildren(...restGroups);
        cap.style.gridArea = 'cap';
        cap.style.borderRadius = '8px';
        cap.style.border = '1px solid rgba(150,180,220,.12)';
        station.visual.append(cap, quick);
      } else {
        station.controls.replaceChildren(...mainGroups, ...restGroups);
        quick.remove();
        cap.style.gridArea = cap.style.borderRadius = cap.style.border = '';
        station.root.appendChild(cap);
      }
    };
    placeHook = placeGroups;
    placed = lay === 'narrow';
    placeGroups(placed);

    // ------------------------------------------------------------------ readouts
    function refreshReadouts(): void {
      const spec = isSpec();
      const T = sim.transmissionCentre;
      relabel(rT.el, spec ? 'λ · T' : 'Gets through the rod');
      rT.set(spec ? `${sim.lambda.toFixed(4)} Å · ${tPct(T)} %` : `${tPct(T)} %`);
      rT.el.querySelector<HTMLElement>('.stn-readout-value')!.style.color = T < 0.01 ? '#f87171' : T < 0.1 ? '#fbbf24' : '';
      const M = sim.macro;
      relabel(rStress.el, spec ? 'σ_zz · ε_p' : 'Stress');
      const sMPa = Math.round(M.sigma * 1000);
      rStress.set(spec ? `${sMPa} MPa · ${pct(M.epsP, 2)} %` : sim.eps === 0 ? 'none' : M.yielded ? `${sMPa} MPa, yielded` : `${sMPa} MPa, springy`);
      relabel(sE.input, spec ? 'Photon energy E' : 'Energy');
      relabel(sD.input, spec ? 'Rod diameter D' : 'Rod diameter');
      relabel(sPull.input, spec ? 'Applied strain ε (macro)' : 'Pull (stretch)');
      relabel(sOm.input, spec ? 'ω (rotation about z)' : 'Rotation angle ω');
      refreshCard();
    }

    function refreshCard(): void {
      const g = vs.selected;
      const spec = isSpec();
      card.replaceChildren();
      const add = (text: string, o: { mono?: boolean; strong?: boolean; color?: string; small?: boolean } = {}) => {
        const d = document.createElement('div');
        d.textContent = text;
        d.style.cssText = `font:${o.strong ? 650 : 500} ${o.small ? 11 : 12}px ${o.mono ? 'var(--mono)' : 'var(--font)'};color:${o.color ?? '#b7c3d2'};white-space:pre`;
        card.appendChild(d);
        return d;
      };
      if (g < 0) {
        add('Tap a grain in panel 1, a spot in panel 2', { small: true });
        add('or a dot in panel 4 to follow it.', { small: true });
        return;
      }
      const gr = sim.grains[g];
      const head = add(`■ Grain ${g + 1}`, { strong: true, color: '#e9eef5' });
      head.style.whiteSpace = 'normal';
      const sw = `rgb(${Math.round(gr.ipf[0] * 255)},${Math.round(gr.ipf[1] * 255)},${Math.round(gr.ipf[2] * 255)})`;
      head.innerHTML = `<span style="color:${sw}">■</span> Grain ${g + 1}`;
      const tot = sim.totalSpots[g];
      const seen = sim.seenSpots[g];
      const e = sim.strain.subarray(g * 9, g * 9 + 9);
      if (spec) {
        const U = sim.Ucur.subarray(g * 9, g * 9 + 9);
        const uvw = P.loadAxisHkl(U);
        const Ed = P.youngDir(sim.el, [U[6], U[7], U[8]]);
        add(`load axis ∥ ⟨${uvw}⟩ · E_uvw ${Ed.toFixed(0)} GPa`, { small: true });
        add(`spots recorded ${seen}/${tot} · ${sim.found[g] ? 'indexed' : 'not indexed'}`, { small: true });
        add('ε (sample frame) ×10⁻⁴:', { small: true });
        const f = (v: number) => (v * 1e4).toFixed(0).padStart(5, ' ');
        add(`${f(e[0])}${f(e[1])}${f(e[2])}\n${f(e[3])}${f(e[4])}${f(e[5])}\n${f(e[6])}${f(e[7])}${f(e[8])}`, { mono: true, small: true, color: '#e9eef5' });
      } else {
        add(sim.found[g] ? `Found: ${seen} of its ${tot} spots seen` : tot ? `Not found yet (${seen} of ${tot} spots)` : 'Too faint to see at this energy', { small: true });
        add(sim.eps > 0 ? `Its atoms: +${pct(e[8], 2)} % farther apart along the pull` : 'Not pulled yet', { small: true });
        add('Its spots are ringed on the detector.', { small: true, color: '#8394a9' });
      }
    }

    // ------------------------------------------------------------------ state changes
    function setPlaying(p: boolean): void {
      playing = p;
      bPlay.textContent = p ? '❚❚ Pause' : '▶ Turn';
      bPlay.setAttribute('aria-pressed', String(p));
    }
    bPlay.setAttribute('aria-pressed', String(playing));
    onReducedMotionChange(station, (reduced) => setPlaying(!reduced));

    function setMode(m: Mode): void {
      vs.mode = m;
      tMode.set(m);
      const l2 = labelOf(wraps.det);
      const l4 = labelOf(wraps.ans);
      if (l2) l2.textContent = m === 'ff' ? '2 · Far-field detector' : '2 · Near-field camera';
      if (l4) l4.textContent = m === 'ff' ? '4 · What the computer finds' : '4 · Reconstructed grain map';
      sim.nfDirty = true;
      lastParam = 0;
      det.invalidate();
      setDetNote();
      capDirty = true;
    }

    function select(g: number): void {
      vs.selected = g === vs.selected ? -1 : g;
      refreshCard();
    }

    function resetAll(): void {
      sim.E = DEF.E;
      sim.D = DEF.D;
      sim.eps = pullToStrain(DEF.pull);
      sim.mag = 20;
      sE.set(DEF.E);
      sD.set(DEF.D);
      sPull.set(DEF.pull);
      tMag.set('20');
      setMode('ff');
      vs.selected = -1;
      vs.omega = 0;
      sOm.set(0);
      vs.flashes.length = 0;
      sim.resetCoverage();
      paramsChanged(true);
      setPlaying(!prefersReducedMotion());
    }

    // ------------------------------------------------------------------ rotation
    const cross: number[] = [];
    function turnBy(d: number): void {
      if (d === 0) return;
      const TWO = 2 * Math.PI;
      const o0 = vs.omega;
      const o1 = o0 + d;
      if (d > 0) sim.sweep(o0, o1, true);
      else sim.sweep(o1 + TWO, o0 + TWO, true);
      const n0 = ((o0 % TWO) + TWO) % TWO;
      const n1 = ((o1 % TWO) + TWO) % TWO;
      sim.crossings(n0, n1, d > 0, cross, 24);
      for (const i of cross) vs.flashes.push({ spot: i, t0: vs.t });
      if (vs.flashes.length > 160) vs.flashes.splice(0, vs.flashes.length - 160);
      vs.omega = n1;
      capDirty = true;
    }

    // ------------------------------------------------------------------ pointer & keyboard
    const smpCanvas = smpC.canvas;
    smpCanvas.tabIndex = 0;
    smpCanvas.setAttribute(
      'aria-label',
      'Rotating sample slice. Drag or use the left and right arrow keys to turn it; space to pause; up and down arrows to follow a grain.',
    );
    let drag: { id: number; a: number; x: number; y: number; moved: boolean; t: number } | null = null;
    const local = (e: PointerEvent, c: HTMLCanvasElement) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    smpCanvas.addEventListener('pointerdown', (e) => {
      const p = local(e, smpCanvas);
      if (!top.inside(p.x, p.y, 24)) return;
      drag = { id: e.pointerId, a: top.angleAt(p.x, p.y), x: p.x, y: p.y, moved: false, t: performance.now() };
      try {
        smpCanvas.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic or already-released pointer */
      }
      vs.touched = true;
    });
    smpCanvas.addEventListener('pointermove', (e) => {
      const p = local(e, smpCanvas);
      if (!drag) {
        smpCanvas.style.cursor = top.inside(p.x, p.y, 24) ? 'grab' : 'default';
        return;
      }
      if (Math.hypot(p.x - drag.x, p.y - drag.y) > 5) {
        if (!drag.moved) setPlaying(false);
        drag.moved = true;
      }
      if (!drag.moved) return;
      smpCanvas.style.cursor = 'grabbing';
      const a = top.angleAt(p.x, p.y);
      let d = a - drag.a;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      drag.a = a;
      turnBy(d);
      sOm.set(vs.omega / P.DEG);
    });
    const endDrag = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moved) {
        const p = local(e, smpCanvas);
        const g = top.pick(p.x, p.y);
        if (g >= 0) select(g);
      }
      drag = null;
      smpCanvas.style.cursor = 'grab';
    };
    smpCanvas.addEventListener('pointerup', endDrag);
    smpCanvas.addEventListener('pointercancel', (e) => {
      if (drag && drag.id === e.pointerId) drag = null;
    });
    smpCanvas.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        setPlaying(false);
        vs.touched = true;
        turnBy((e.key === 'ArrowRight' ? 2 : -2) * P.DEG); // same sense as the ω slider
        sOm.set(vs.omega / P.DEG);
      } else if (e.key === ' ' || e.key === 'Enter') {
        setPlaying(!playing);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const n = sim.ng;
        const g = vs.selected < 0 ? 0 : (vs.selected + (e.key === 'ArrowUp' ? 1 : n - 1)) % n;
        vs.selected = g;
        refreshCard();
      } else if (e.key === 'Escape' && vs.selected >= 0) {
        // only consume Escape when it clears a selection, so it can still close a full-screen dialog
        vs.selected = -1;
        refreshCard();
      } else return;
      e.preventDefault();
    });
    const tapPick = (c: HTMLCanvasElement, pick: (x: number, y: number) => number) => {
      let down: { x: number; y: number } | null = null;
      c.addEventListener('pointerdown', (e) => (down = local(e, c)));
      c.addEventListener('pointerup', (e) => {
        const p = local(e, c);
        if (down && Math.hypot(p.x - down.x, p.y - down.y) < 6) {
          const g = pick(p.x, p.y);
          if (g >= 0) select(g);
          else if (vs.selected >= 0) select(vs.selected);
        }
        down = null;
      });
    };
    tapPick(detC.canvas, (x, y) => det.pick(x, y));
    tapPick(ansC.canvas, (x, y) => ans.pick(x, y));
    detC.canvas.style.cursor = 'pointer';
    ansC.canvas.style.cursor = 'pointer';

    // ------------------------------------------------------------------ caption
    function captionTexts(): [string, string] {
      const T = sim.transmissionCentre;
      const M = sim.macro;
      const E = sim.E;
      const D = sim.D.toFixed(1);
      const sMPa = Math.round(M.sigma * 1000);
      const ax = sim.axialStats();
      const tVis =
        T < 0.005
          ? ` At ${E} keV almost no X-rays get through ${D} mm of nickel: **raise the energy** to see inside.`
          : T < 0.15
            ? ` Only **${tPct(T)} %** of the beam gets through ${D} mm of nickel, so the spots are faint: try a higher energy.`
            : '';
      const tSpec = ` T = e^{−μD} = ${tPct(T)} % (μ = ${sim.mu.toFixed(2)} mm^{−1}, 1/μ = ${fmtLen(1 / sim.mu)}).`;
      if (vs.mode === 'ff') {
        const nRec = sim.recordedSpots();
        let v: string;
        if (sim.nVisited === 0) {
          v = 'Press **▶ Turn** or drag the sample. As the rod turns, each crystal grain **flashes** when its layers of atoms meet the beam at exactly the right angle, and throws a spot onto the detector.';
        } else {
          v = `**${sim.nFound} of ${sim.ng} grains** found from **${nRec} spots**. A grain flashes when its atom layers sit at exactly the right angle to the ${E} keV beam (Bragg’s law); spots from the same kind of layer fall on one ring.${tVis}`;
          if (sim.eps === 0) v += ' Now **pull** on the rod.';
          else if (!M.yielded)
            v += ` Pulled at **${sMPa} MPa** (like hanging **${hangMass(M.sigma, sim.D)}** from this ${D} mm rod), atoms along the pull sit about **${pct(ax.mean, 2)} %** farther apart: spots at the top and bottom creep inward${sim.mag > 1 ? ' (×20 on screen)' : ' (at true size less than a pixel: try **×20**)'}, so the rings turn into ovals.`;
          else
            v += ` Past the **yield point** the rod stretches for good (**${pct(M.epsP, 1)} %**), yet the atoms are still only about **${pct(ax.mean, 2)} %** farther apart: layers of atoms **slip** past each other instead. The crystals bend, so their spots **smear** into arcs.`;
        }
        let s = `**ff-HEDM**, E = ${E} keV (λ = ${sim.lambda.toFixed(4)} Å), L = 1 m: Ni 111 at 2θ = ${(P.twoThetaOf(sim.fams[0].d, sim.lambda) / P.DEG).toFixed(2)}°. ${nRec} spots from Δω = ${sim.nVisited}°; ${sim.nFound}/${sim.ng} grains indexed (a grain counts once ≥ 8 of its spots, and ≥ 8 % of its full-turn spots, are recorded: illustrative).`;
        if (sim.eps > 0)
          s += ` σ_{zz} = ${sMPa} MPa: grain ε_{zz} = ${(ax.min * 1e3).toFixed(2)}–${(ax.max * 1e3).toFixed(2)}×10^{−3} (mean ${(ax.mean * 1e3).toFixed(2)}), spread by elastic anisotropy; ΔR/R ≈ −ε_{hkl}${sim.mag > 1 ? ', drawn ×20' : ', true scale'}.`;
        if (sim.eps > 0) {
          const fits = sim.ringFits().filter((f) => f.fam <= 1);
          if (fits.length)
            s += ` Ring fits ε(η) = ε_{⊥} + (ε_{∥} − ε_{⊥}) sin²η (2θ referred to each grain’s centroid): ${fits
              .map((f) => `${sim.fams[f.fam].label}: ε_{∥} = ${(f.epsPar * 1e3).toFixed(2)}, ε_{⊥} = ${(f.epsPerp * 1e3).toFixed(2)}×10^{−3} (E_{hkl} ≈ ${Math.round(M.sigma / f.epsPar)} GPa)`)
              .join('; ')}.`;
        }
        if (M.yielded) s += ` ε_p = ${pct(M.epsP, 2)} %: ${(sim.fx.spread / P.DEG).toFixed(1)}° FWHM misorientation streaks spots in η and ω (illustrative).`;
        s += tSpec;
        return [v, s];
      }
      const st = ans.stats;
      const mapped = Math.round(st.mapped * 100);
      let v =
        sim.nVisited === 0
          ? 'Press **▶ Turn** or drag the sample. A camera just **7 mm** behind the rod catches each spot almost where it leaves its grain.'
          : `A camera just **7 mm** behind the rod catches each spot almost where it leaves its grain, so every spot is a thin **streak as wide as its grain** looks from that angle; many angles together give the grain’s shape, as in a CT scan. For each point of the slice the computer tries every grain orientation and keeps the one whose predicted spots land on bright pixels: **${mapped} %** mapped so far.${tVis}`;
      if (M.yielded) v += ' Bent past yield, each grain breaks into **slightly tilted pieces**: the dark lines inside the grains.';
      const vox = ((sim.D * 1000) / NF_VOX).toFixed(0);
      let s = `**nf-HEDM**: line beam, L = 7 mm, 3.2 mm field of view (128² × 25 µm pixels: coarse; real ≈ 1.5 µm). Forward model on a 48² voxel grid (${vox} µm): each voxel tests the 24 ff-indexed orientations; C = hits / predicted spots on the camera. Mapped (C ≥ 0.5): ${mapped} %, right grain: ${Math.round(st.correct * 100)} %.`;
      if (M.yielded) s += ` After yield each grain carries 4 sub-grains misoriented by ~${(sim.fx.spread / P.DEG).toFixed(1)}° FWHM (illustrative); the model then also tests those orientations (a local search around each ff grain), and sub-grain boundaries appear as dark lines.`;
      s += ' Real reconstructions (IceNine, HEXRD, MIDAS) search orientation space and use 2–3 distances to triangulate; HEXM design: ≈1 µm, 0.01°.';
      s += tSpec;
      return [v, s];
    }
    const refreshCaption = (force = false) => {
      const now = performance.now();
      if (!force && (!capDirty || now - capT < 250)) return;
      capT = now;
      capDirty = false;
      const [v, s] = captionTexts();
      const key = `${station.depth}|${v}|${s}`;
      if (key === capLast) return;
      capLast = key;
      station.setCaption(v, s);
    };

    // ------------------------------------------------------------------ loop
    let cardT = 0;
    // adaptive pacing of far-field rebuilds while a slider is dragged: after a rebuild that cost c ms (spot list +
    // detector image), the next one waits ≥ c ms, so rebuilds take at most ~half the frame time on slow machines
    let ffNext = 0;
    let ffT0 = -1;
    loop(station, (dt, t) => {
      vs.t = t;
      vs.still = !playing && prefersReducedMotion();
      if (playing && !drag) {
        turnBy(ROT_SPEED * dt);
        sOm.set(vs.omega / P.DEG);
      }
      if (ffDirty && performance.now() >= ffNext) {
        ffDirty = false;
        ffT0 = performance.now();
        sim.updateFF();
      }
      // reduced motion and not turning: grains found from what was seen appear at once, not one by one for seconds
      if (sim.stepIndexing(vs.still ? 60 : dt)) capDirty = true;
      if (vs.mode === 'nf') {
        // rebuild the near-field model once a slider has been still for 200 ms; then work through the bins
        if (sim.nfDirty && performance.now() - lastParam > 200) sim.buildNF();
        if (!sim.nfDirty && sim.pumpNF(5)) capDirty = true;
      }
      // prune old flashes
      let k = 0;
      while (k < vs.flashes.length && t - vs.flashes[k].t0 > 0.8) k++;
      if (k) vs.flashes.splice(0, k);
      top.draw();
      det.draw(dt);
      if (ffT0 >= 0) {
        const now = performance.now();
        ffNext = now + Math.min(250, now - ffT0);
        ffT0 = -1;
      }
      ans.draw(dt);
      if (penDirty) {
        penDirty = false;
        pen.draw();
      }
      refreshCaption();
      if (vs.selected >= 0 && t - cardT > 0.4) {
        cardT = t;
        refreshCard();
      }
    });

    refreshReadouts();
    refreshCaption(true);

    return {
      destroy: () => station.destroy(),
      setDepth: (d) => {
        station.setDepth(d);
        vs.depth = d;
        penDirty = true;
        refreshReadouts();
        capLast = '';
        refreshCaption(true);
      },
    };
  },
};
export default mod;
