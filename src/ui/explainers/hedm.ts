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
 * indexing threshold) are labelled as such in the station's "About this model" fine print.
 */
import type { ExplainerModule } from './registry';
import { button, canvas2d, createStation, group, loop, note, onReducedMotionChange, prefersReducedMotion, readout, slider, toggle } from './kit';
import * as P from './hedm/physics';
import { HedmSim, NF, NF_VOX, type Mode } from './hedm/sim';
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
    const station = createStation(host, { color: ctx.color, layout: 'side' });
    const accent = /^#[0-9a-f]{6}$/i.test(ctx.color) ? ctx.color : '#fb923c';
    const sim = new HedmSim(7);
    const vs: ViewState = { omega: 0, mode: 'ff', selected: -1, accent, t: 0, flashes: [], touched: false, still: false };

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
        { value: 'ff', label: 'Far · 1 m', title: 'Far-field high-energy diffraction microscopy: a flat-panel detector 1 m downstream' },
        { value: 'nf', label: 'Near · 7 mm', title: 'Near-field high-energy diffraction microscopy: a high-resolution camera a few mm behind the sample' },
      ],
      value: 'ff',
      onChange: (m) => setMode(m),
    });
    const detNote = note(gDet, station, '');
    const setDetNote = () =>
      detNote.set(
        vs.mode === 'ff'
          ? 'The **far-field** detector, 1 m back, sorts spots by angle. From them the computer works out each grain’s tilt, its stretch and its centre, but not its shape. Measured repeatability at APS beamline 1-ID-E: about 5 µm in position, 0.02° in tilt and 2×10^{−4} in strain. Spot colours only mark which grain made them.'
          : 'The **near-field** camera sits only 5–10 mm (7 mm here) behind a sample lit by a thin sheet of beam, so each spot is still a projection of its grain’s outline: together the spots redraw every grain’s **shape**. HEXM’s 20-ID-E serves near field, far field and very far field (detectors up to ~16 m away) from one calibrated sample position.',
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
      'Higher-energy X-rays slip through more metal and bounce off the atoms at **smaller angles**, so the rings shrink: their size scales roughly as 1/E (at 70 keV nickel’s 111 ring bends X-rays through just 2θ = 4.99°). But each reflection also weakens as the energy rises, about as 1/E², so the brightest spots come where deeper reach and weaker reflection balance: the green ▼ in panel 3. Thicker parts need higher energies (this estimate leaves out the source spectrum and the detector’s efficiency, which both fall at high energy). HEXM covers 35–120 keV with a bent double-Laue silicon monochromator (energy spread ΔE/E ≈ 10^{−3}).',
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
      'A **nickel alloy** like those in jet engines. Each coloured patch is a **grain**: a tiny crystal with its own tilt. Pull gently and the atoms spring back; past the **yield point** the metal stretches for good. A nickel crystal is stiffer along some directions than others (136 GPa along a cube edge, 304 GPa along a cube diagonal), so each grain stretches by its own amount. 24 grains keep the picture clear; a real far-field scan follows 10^{2}–10^{4} grains at once.',
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
      'A real scan takes a picture every 0.1–0.25° through a full turn: 1,440–3,600 pictures. Here one second ≈ 15°. Each set of atomic planes passes the Bragg angle twice per turn (four times, counting the same planes seen from the other side). Planes lying almost square to the rotation axis never reach it, which leaves blind gaps at the top and bottom of each ring.',
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
      'The upgraded ring packs its electrons into a far tighter beam: its horizontal emittance (size × spread) fell from 3,113 to 42 pm. At these high energies the X-ray beam’s size and spread are set mostly by the electrons, so the gain carries over. At 20-ID-E, 180 m from the source, lenses spread the beam over samples **3–4 mm** across (about 1 mm before) or focus it to 0.43 × 0.21 µm (design, 70 keV) to zoom in on one grain; data should come ~100× faster than at 1-ID before the upgrade. Today’s source is an interim pair of permanent-magnet undulators; the design flux (≈10^{14} photons/s at 70 keV) assumes the superconducting undulator planned for 2026–27.',
    );

    // 6. the model's fine print, in smaller type
    const gModel = group(station.controls, 'About this model');
    const modelNote = note(gModel, station, '');
    modelNote.set(
      `A simulation, not data. Nickel is modelled as a face-centred cubic crystal (a = 3.524 Å) with elastic constants C_{11}, C_{12}, C_{44} = 246.5, 147.3, 124.7 GPa; each grain’s strain is the average of the two textbook bounds (Reuss and Voigt) under a straight pull, giving an overall stiffness ≈221 GPa. The yield stress (900 MPa), hardening (1.5 GPa) and plastic smearing (0.9° spread in tilt per % of permanent stretch) are illustrative. Spot brightness follows simple (kinematic) diffraction theory: it scales with λ³ (λ the wavelength), the atoms’ scattering strength, their thermal jiggling, polarization, the time each set of planes spends at the Bragg angle, the grain’s volume and the share of X-rays that get through, from NIST XCOM absorption data. The grey ▼ in panel 3 marks a molybdenum lab tube’s 17.5 keV line. A grain counts as found once ≥ 8 of its spots, and ≥ 8 % of its full-turn spots, are recorded (an illustrative threshold). The near-field camera here has ${NF.npx}² pixels of ${((2 * NF.half * 1000) / NF.npx).toFixed(0)} µm (real: ≈1.5 µm), and the map ${NF_VOX}² cells, each testing the ${sim.ng} far-field orientations (after yield also 4 tilted pieces per grain). Real codes (IceNine, HEXRD, MIDAS) search all orientations and use 2–3 camera distances; HEXM’s design aim is ≈1 µm and 0.01°.`,
    );
    (gModel.lastElementChild as HTMLElement).style.fontSize = '11.5px';

    // where the groups live: all in the side column (wide/mid); in the narrow single column the main ones
    // (with the live caption) move up right under the detector so nobody has to scroll past four panels
    const mainGroups = [gDet, gBeam, gS, gRot];
    const restGroups = [gSel, gU, gModel];
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
      const T = sim.transmissionCentre;
      rT.set(`${tPct(T)} %`);
      rT.el.querySelector<HTMLElement>('.stn-readout-value')!.style.color = T < 0.01 ? '#f87171' : T < 0.1 ? '#fbbf24' : '';
      const M = sim.macro;
      const sMPa = Math.round(M.sigma * 1000);
      rStress.set(sim.eps === 0 ? 'none' : M.yielded ? `${sMPa} MPa, yielded` : `${sMPa} MPa, springy`);
      refreshCard();
    }

    /** signed with a true minus: "+0.35", "−0.12" */
    const sgn = (v: number, d: number) => {
      const t = Math.abs(v).toFixed(d);
      return Number(t) === 0 ? t : `${v > 0 ? '+' : '−'}${t}`;
    };
    function refreshCard(): void {
      const g = vs.selected;
      card.replaceChildren();
      const add = (text: string, o: { mono?: boolean; strong?: boolean; color?: string; small?: boolean } = {}) => {
        const d = document.createElement('div');
        d.textContent = text;
        d.style.cssText = `font:${o.strong ? 650 : 500} ${o.small ? 11 : 12}px ${o.mono ? 'var(--mono)' : 'var(--font)'};color:${o.color ?? '#b7c3d2'};white-space:${o.mono ? 'pre' : 'normal'}`;
        card.appendChild(d);
        return d;
      };
      if (g < 0) {
        add('Tap a grain in panel 1, a spot in panel 2 or a dot in panel 4 to follow it.', { small: true });
        return;
      }
      const gr = sim.grains[g];
      const head = add(`■ Grain ${g + 1}`, { strong: true, color: '#e9eef5' });
      const sw = `rgb(${Math.round(gr.ipf[0] * 255)},${Math.round(gr.ipf[1] * 255)},${Math.round(gr.ipf[2] * 255)})`;
      head.innerHTML = `<span style="color:${sw}">■</span> Grain ${g + 1}`;
      const tot = sim.totalSpots[g];
      const seen = sim.seenSpots[g];
      const e = sim.strain.subarray(g * 9, g * 9 + 9);
      const U = sim.Ucur.subarray(g * 9, g * 9 + 9);
      add(sim.found[g] ? `Found: ${seen} of its ${tot} spots recorded` : tot ? `Not found yet (${seen} of ${tot} spots)` : 'Too faint to see at this energy', { small: true });
      add(`Pull runs ≈ along its crystal direction ⟨${P.loadAxisHkl(U)}⟩, where its stiffness (Young’s modulus) is ${P.youngDir(sim.el, [U[6], U[7], U[8]]).toFixed(0)} GPa`, { small: true });
      if (sim.eps > 0) {
        add(`Its atoms: ${sgn(e[8] * 100, 2)} % farther apart along the pull`, { small: true });
        add('Full strain, ×10⁻⁴ (rows/columns x, y, z; z = pull):', { small: true, color: '#8394a9' });
        const f = (v: number) => sgn(v * 1e4, 0).replace('+', '').padStart(5, ' ');
        add(`${f(e[0])}${f(e[1])}${f(e[2])}\n${f(e[3])}${f(e[4])}${f(e[5])}\n${f(e[6])}${f(e[7])}${f(e[8])}`, { mono: true, small: true, color: '#e9eef5' });
      } else add('Not pulled yet', { small: true });
      add('Its spots are ringed on the detector.', { small: true, color: '#8394a9' });
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
    function captionText(): string {
      const T = sim.transmissionCentre;
      const M = sim.macro;
      const E = sim.E;
      const D = sim.D.toFixed(1);
      const sMPa = Math.round(M.sigma * 1000);
      const ax = sim.axialStats();
      const att = fmtLen(1 / sim.mu);
      const tNote =
        T < 0.005
          ? ` At ${E} keV almost no X-rays get through ${D} mm of nickel (the beam fades to 1/e every ${att}): **raise the energy** to see inside.`
          : T < 0.15
            ? ` Only **${tPct(T)} %** of the beam gets through ${D} mm of nickel (it fades to 1/e every ${att}), so the spots are faint: try a higher energy.`
            : '';
      if (vs.mode === 'ff') {
        const nRec = sim.recordedSpots();
        if (sim.nVisited === 0)
          return `Press **▶ Turn** or drag the sample. As the rod turns, each crystal grain **flashes** when its layers of atoms meet the ${E} keV beam at exactly the Bragg angle θ, where λ = 2d sinθ (λ the X-ray wavelength, ${sim.lambda.toFixed(3)} Å here; d the spacing of the layers), and throws a spot onto the detector 1 m away.${tNote}`;
        let v = `**${sim.nFound} of ${sim.ng} grains** found from **${nRec} spots** over ${sim.nVisited}° of turning. A grain flashes when its atom layers meet the ${E} keV beam at exactly the Bragg angle; spots from the same kind of layer fall on one ring (nickel’s 111 ring at 2θ = ${(P.twoThetaOf(sim.fams[0].d, sim.lambda) / P.DEG).toFixed(2)}°).${tNote}`;
        if (sim.eps === 0) v += ' Now **pull** on the rod.';
        else if (!M.yielded) {
          const fit = sim.ringFits().find((f) => f.fam === 0);
          v += ` Pulled at **${sMPa} MPa** (like hanging **${hangMass(M.sigma, sim.D)}** from this ${D} mm rod), atoms along the pull sit **${pct(ax.mean, 2)} %** farther apart on average, from ${pct(ax.min, 2)} to ${pct(ax.max, 2)} % grain by grain, because each crystal is stiffer in some directions than others. Spots at the top and bottom creep inward${sim.mag > 1 ? ' (×20 on screen)' : ' (at true size less than a pixel: try **×20**)'}, so the rings turn into ovals${fit ? `: the 111 oval gives ${sgn(fit.epsPar * 100, 2)} % along the pull and ${sgn(fit.epsPerp * 100, 2)} % across it` : ''}.`;
        } else
          v += ` Past the **yield point** the rod stretches for good (**${pct(M.epsP, 1)} %**), yet the atoms are still only about **${pct(ax.mean, 2)} %** farther apart: layers of atoms **slip** past each other instead. The crystals bend, so their spots **smear** into arcs (a ${(sim.fx.spread / P.DEG).toFixed(1)}° spread in tilt, illustrative).`;
        return v;
      }
      const st = ans.stats;
      const mapped = Math.round(st.mapped * 100);
      if (sim.nVisited === 0) return `Press **▶ Turn** or drag the sample. A camera just **7 mm** behind the rod catches each spot almost where it leaves its grain.${tNote}`;
      let v = `A camera just **7 mm** behind the rod catches each spot almost where it leaves its grain, so every spot is a thin **streak as wide as its grain** looks from that angle; many angles together give the grain’s shape, as in a CT scan. For each point of the slice the computer tries the orientations found in the far field and keeps the one whose predicted spots land on bright pixels: **${mapped} %** mapped so far (fit at least 50 % sure), ${Math.round(st.correct * 100)} % to the right grain.${tNote}`;
      if (M.yielded) v += ` Bent past yield, each grain breaks into **slightly tilted pieces** (≈${(sim.fx.spread / P.DEG).toFixed(1)}° apart, illustrative): the dark lines inside the grains.`;
      return v;
    }
    const refreshCaption = (force = false) => {
      const now = performance.now();
      if (!force && (!capDirty || now - capT < 250)) return;
      capT = now;
      capDirty = false;
      const v = captionText();
      if (v === capLast) return;
      capLast = v;
      station.setCaption(v);
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
    };
  },
};
export default mod;
