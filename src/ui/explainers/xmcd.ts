/**
 * Station "xmcd" — POLAR (4-ID): "Magnets seen in polarized light" (X-ray magnetic circular dichroism).
 *
 * Three linked views:
 *   1. The beam: the undulator's linear-horizontal light passes a diamond quarter-wave plate (Bragg-transmission
 *      phase retarder, scattering plane at 45°) and leaves linear-H, left/right circular, elliptical or (two plates)
 *      linear-V; animated E-field helix in a cabinet projection plus a head-on view of the E-vector tip.
 *   2. Schematic Pt L₃ (11.564 keV) and L₂ (13.273 keV) absorption of an L1₀ FePt film for left- and right-circular
 *      light, and their difference (XMCD), which flips with M and vanishes with M; the sum rules are applied to the
 *      displayed curves (the box in view 2). Dots = what the beam selected in view 1 measures (μ_L, μ_R, their mean for
 *      linear light; P_c = 0.98 for one plate, |P_lin| = 0.9 for linear-V from two plates, measured −0.80…−0.95).
 *   3. The magnet: hysteresis loop of a granular Stoner–Wohlfarth ensemble (field up to POLAR's 9 T) and the Weiss
 *      mean-field M(T) with T_C = 750 K; an illustrative diamond-anvil-cell pressure suppresses T_C and the moment.
 *
 * Equations, parameter values, approximations and sources: ./xmcd/physics.ts (header). In brief:
 *   δ(Δθ) = (π/2)Δθ_q/Δθ, Δθ_q = 2t cosθ_B r_e² λ³ Re(F_hF_h̄)/(π²V²) (Pharet form, POLAR dossier) → 28″ for C(111),
 *   t = 0.5 mm at Pt L₃; P_c = −sin δ, P_lin = cos δ; measured P_c ≈ 0.98, ~15 Hz piezo flipping (POLAR dossier).
 *   μ_{L,R} = μ̄ ∓ (P_c/2)(M·k̂/M_s)Δμ^{±}; sum rules (Thole 1992, Carra 1993, Chen 1995) fix the XMCD areas from
 *   m_spin,eff = 0.35 μ_B, m_orb = 0.05 μ_B, n_h = 1.7 (illustrative); lineshapes are SCHEMATIC.
 *   m = B_J(3J/(J+1)·m/t + gμ_BJB/k_BT), J = 3/2; H_c ∝ m^{1.1}; pressure model ILLUSTRATIVE (moment → 0 at 150 GPa).
 */
import type { ExplainerModule } from './registry';
import { button, canvas2d, createStation, group, loop, md, note, onReducedMotionChange, prefersReducedMotion, readout, slider, toggle, type Canvas2D } from './kit';
import * as P from './xmcd/physics';
import { BeamView, type BeamState } from './xmcd/beam';
import { SpectraPlot } from './xmcd/spectra';
import { MagnetPlot } from './xmcd/magnet';
import { beamColor, num, signed } from './xmcd/draw';

type Pol = 'L' | 'R' | 'E' | 'H' | 'V';

/** Target retardance, plate rock (units of Δθ_q), retraction and second plate for each preset. */
const POLS: Record<Pol, { delta: number; rock: number; retract: number; second: number }> = {
  L: { delta: -Math.PI / 2, rock: -1, retract: 0, second: 0 },
  R: { delta: Math.PI / 2, rock: 1, retract: 0, second: 0 },
  E: { delta: -Math.PI / 4, rock: -2, retract: 0, second: 0 },
  H: { delta: 0, rock: 0, retract: 1, second: 0 },
  // two quarter-wave plates on the same side of the Bragg peak: δ = −π ≡ π
  V: { delta: -Math.PI, rock: -1, retract: 0, second: 1 },
};

const DEFAULTS = { pol: 'L' as Pol, H: 0, T: 300, P: 0, ratio: P.FEPT.mOrb / P.FEPT.mSpin };
const FLIP_PERIOD = 1.2; // s between helicity flips in the slowed-down "auto-flip" (real: ~15 Hz modulation, a flip every ~1/30 s)
const PLATE = P.phasePlate(P.PT_EDGES.L3, 0.5e-3);
const DQ = PLATE.dThetaQ / P.ARCSEC; // quarter-wave offset at Pt L₃, arcsec

const CSS = `
.xmcd-root .xmcd-pol .stn-toggle button { flex: 1 1 28%; padding: 6px 4px; }
.xmcd-root .stn-btn[aria-pressed=true] { background: color-mix(in oklab, var(--c, #5cd3ff) 26%, #0b111b); border-color: var(--c, #5cd3ff); color: #fff; }
.xmcd-root .xmcd-row { display: flex; gap: 8px; flex-wrap: wrap; }
.xmcd-root .xmcd-row .stn-btn { flex: 1 1 auto; }
.xmcd-root .xmcd-row .stn-btn + .stn-btn { flex: 0 0 auto; }
.xmcd-root.stn-side .stn-readout { padding: 5px 9px; }
.xmcd-root .stn-readout-value { white-space: nowrap; }
.xmcd-root .xmcd-magnetization .stn-readout-value { min-width: 0; white-space: normal; text-align: right; }
.xmcd-root .stn-canvas.xmcd-drag canvas { cursor: ew-resize; }
`;

const mod: ExplainerModule = {
  title: 'Magnets seen in polarized light',
  subtitle: 'Twist the X-rays left or right, then flip, heat or squeeze a magnet: the gap between the two absorption curves is its magnetism.',
  mount(host, ctx) {
    const accent = ctx.color || '#c084fc';
    const station = createStation(host, { color: accent, layout: 'side' });
    const { visual, controls, root } = station;
    root.classList.add('xmcd-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    // live: follows a change of the OS / browser setting while the station is open
    let reduceMotion = prefersReducedMotion();

    // ------------------------------------------------------------ state
    const st = { pol: DEFAULTS.pol, auto: false, H: DEFAULTS.H, T: DEFAULTS.T, P: DEFAULTS.P, ratio: DEFAULTS.ratio };
    const anim = { ...POLS[st.pol], autoT: 0 };
    let pulse: { t: number; from: number; peak: number } | null = null;
    const grains = new P.Grains(100);
    /** zfc: grains froze at random on cooling through T_C in ~zero field (cleared once a field switches grains) */
    const mag = { tc: P.FEPT.tc0, m0: 1, hc: P.FEPT.hc0, sbar: 1, M: 1, zfc: false };
    const sp = P.makeSpectra();
    let yMax = 0.1;
    let rb = { mOrb: 0, mSpinEff: 0, p: 0, q: 0, r: 1 };
    let specDirty = true;
    let magDirty = true;

    // ------------------------------------------------------------ canvases
    const cA = canvas2d(visual, { label: '1 · Twist the light (diamond phase retarder)' });
    const cB = canvas2d(visual, { label: "2 · The magnet's fingerprint (schematic)" });
    const cC = canvas2d(visual, { label: '3 · The magnet: M(H) and M(T)' });
    const wrapOf = (c: Canvas2D) => c.canvas.parentElement as HTMLElement;
    wrapOf(cA).style.gridColumn = '1 / -1';
    // extra containers for the narrow (side-panel) order: each control group sits next to the plot it drives
    const visual2 = document.createElement('div');
    visual2.className = 'stn-visual';
    const visual3 = document.createElement('div');
    visual3.className = 'stn-visual';
    const beamView = new BeamView(cA, accent);
    if (reduceMotion) beamView.speed = 0;
    onReducedMotionChange(station, (r) => {
      reduceMotion = r;
      beamView.speed = r ? 0 : 1;
    });
    const specPlot = new SpectraPlot(cB, accent);
    const magPlot = new MagnetPlot(cC, accent);
    cB.onResize(() => (specDirty = true));
    cC.onResize(() => (magDirty = true));

    // ------------------------------------------------------------ controls: light
    const ctlA = document.createElement('div');
    ctlA.className = 'stn-controls';
    ctlA.style.gridTemplateColumns = 'minmax(0,1fr)';
    ctlA.style.overflowY = 'visible';
    const ctlM = document.createElement('div');
    ctlM.className = 'stn-controls';
    ctlM.style.overflowY = 'visible';

    note(
      controls,
      station,
      '**Try it:** give the X-rays a twist, then **flip the magnet**: the shaded difference turns upside down. Then **heat** it past its Curie point, or squeeze it (illustrative). The moments in panel 2 come from applying the sum rules to the curves as drawn.',
    );
    const guideEl = controls.lastElementChild as HTMLElement;
    const gL = group(controls, '1 · The X-ray light (polarization)');
    const tPol = toggle<Pol>(gL, {
      options: [
        { value: 'L', label: '↺ Left', title: `Left-handed corkscrew (left-circular, positive helicity): diamond tilted by Δθ = −${DQ.toFixed(1)}″, phase delay δ = −90°` },
        { value: 'R', label: '↻ Right', title: `Right-handed corkscrew (right-circular, negative helicity): Δθ = +${DQ.toFixed(1)}″, δ = +90°` },
        { value: 'E', label: '⬭ Oval', title: `Partly twisted (elliptical): Δθ = −${(2 * DQ).toFixed(1)}″, δ = −45°` },
        { value: 'H', label: '↔ Flat', title: 'Flat, side to side (linear-horizontal), as the undulator makes it: diamond moved out, δ = 0' },
        { value: 'V', label: '↕ Upright', title: 'Flat, up and down (linear-vertical): two quarter-wave plates, δ = 180°' },
      ],
      value: st.pol,
      onChange: (v) => {
        setAuto(false);
        setPol(v);
      },
    });
    const polWrap = gL.lastElementChild as HTMLElement;
    polWrap.classList.add('xmcd-pol');
    const rowL = document.createElement('div');
    rowL.className = 'xmcd-row';
    gL.appendChild(rowL);
    const bAuto = button(rowL, '⇄ Auto-flip the twist (slowed)', () => setAuto(!st.auto));
    bAuto.title = 'POLAR flips the twist about 15 times a second (piezo-rocked diamond, lock-in detection); here once every 1.2 s';
    bAuto.setAttribute('aria-pressed', 'false');

    // ------------------------------------------------------------ controls: magnet
    const gM = group(controls, '2 · The magnet: iron-platinum film');
    const rowM = document.createElement('div');
    rowM.className = 'xmcd-row';
    gM.appendChild(rowM);
    const bFlip = button(rowM, '⇅ Flip the magnet', () => startPulse(), 'is-primary');
    bFlip.title = 'A 9-tesla field pulse along the beam reverses the magnetization M, then the field returns to 0 T';
    const sH = slider(gM, {
      label: '',
      min: -P.POLAR.bMax,
      max: P.POLAR.bMax,
      step: 0.05,
      value: st.H,
      format: (v) => `${signed(v, 2)} T`,
      hint: ' ',
      onInput: (v) => {
        pulse = null;
        setField(Math.abs(v) < 0.025 ? 0 : v);
      },
    });
    const sT = slider(gM, {
      label: '',
      min: 2,
      max: 900,
      step: 1,
      value: st.T,
      format: (v) => `${Math.round(v)} K · ${num(v - 273.15, 0)} °C`,
      hint: ' ',
      onInput: (v) => {
        st.T = v;
        magPlot.clearTrail();
        updateMagnet();
      },
    });
    const sP = slider(gM, {
      label: '',
      min: 0,
      max: P.POLAR.pMax,
      step: 1,
      value: st.P,
      format: (v) => `${Math.round(v)} GPa`,
      hint: ' ',
      onInput: (v) => {
        st.P = v;
        magPlot.clearTrail();
        updateMagnet();
      },
    });
    const sR = slider(gM, {
      label: '',
      min: 0,
      max: 1,
      step: 0.01,
      value: st.ratio,
      format: (v) => v.toFixed(2),
      hint: ' ',
      onInput: (v) => {
        st.ratio = v;
        specDirty = true;
      },
    });

    const gN = group(controls, 'Readings');
    const rSig = readout(gN, '', { big: true, color: accent });
    const rM = readout(gN, '');
    rM.el.classList.add('xmcd-magnetization');
    const rTc = readout(gN, '');
    const rHc = readout(gN, '');
    for (const r of [rSig, rM, rTc, rHc]) {
      const raw = r.set.bind(r);
      let last = '';
      r.set = (v: string) => {
        if (v !== last) {
          last = v;
          raw(v);
        }
      };
    }
    const resetRow = document.createElement('div');
    resetRow.className = 'xmcd-row';
    gN.appendChild(resetRow);
    const bReset = button(resetRow, '↺ Reset', reset);
    bReset.title = 'Back to the start: left-twisted light, magnet up, 300 K, no field, no pressure';

    note(
      controls,
      station,
      `**How the twist is made.** The undulator's light wiggles **flat**, side to side. A 0.5 mm-thick **diamond**, turned a hair (${DQ.toFixed(0)}″, about 0.008°) away from the angle at which it would reflect the X-rays, splits each wiggle into two diagonal parts and holds one back by a quarter wave: out comes a **corkscrew**, 98 % circular. Turn it the other way for the opposite twist; POLAR rocks the diamond back and forth about **15 times a second**. Such plates work from about 2.7 to 14 keV, at a 5–30× cost in flux.`,
    );
    const lightEl = controls.lastElementChild as HTMLElement;

    note(
      controls,
      station,
      '**Why it matters.** Each element absorbs X-rays at its own energy, so XMCD (X-ray magnetic circular dichroism) reports the magnetism of one kind of atom at a time. Platinum is not magnetic on its own; here its iron neighbours magnetize it. The **sum rules** turn the areas of the difference peaks into the atom’s spin and orbital magnetic moments: an orbital moment shows up as an imbalance between the L₃ and L₂ peaks. They work best at heavy-element L edges like these. FePt is the material of heat-assisted hard drives, which heat a grain near its Curie point so a small field can flip it.',
    );
    const whyEl = controls.lastElementChild as HTMLElement;
    note(
      controls,
      station,
      '*Not to scale: these X-ray waves are only a ten-millionth of a millimetre long. The curve shapes are simplified, the moments are illustrative values like those computed for platinum in FePt (spin 0.35, orbital 0.05 Bohr magnetons), the mean-field magnetism is too flat at low temperature, and the pressure model is a toy; the physics behind them is real. POLAR’s cryostats cover 1.4–450 K (hotter is shown for the physics), and its diamond anvil cells reach 3 Mbar (300 GPa), with about 6 Mbar the goal.*',
    );
    const caveatEl = controls.lastElementChild as HTMLElement;

    // ------------------------------------------------------------ labels with symbols (the kit's mini-markdown)
    /** like textContent, with the kit's mini-markdown (x_{sub}, **bold**) */
    const setMd = (el: Element | null, s: string) => {
      if (el) el.innerHTML = md(s);
    };
    const sliderBits = (s: { input: HTMLInputElement }) => {
      const row = s.input.parentElement as HTMLElement;
      return { label: row.querySelector('.stn-slider-label'), hint: row.querySelector('.stn-hint') };
    };
    cA.canvas.setAttribute('aria-label', 'Animated X-ray electric field passing a diamond phase plate and hitting the magnetic film');
    cB.canvas.setAttribute('aria-label', 'Absorption spectra for left and right circular X-rays at the platinum L3 and L2 edges, and their difference');
    cC.canvas.setAttribute('aria-label', 'Hysteresis loop and magnetization versus temperature; drag to set field or temperature');
    let b = sliderBits(sH);
    setMd(b.label, 'Magnetic field μ_{0}H');
    setMd(b.hint, 'POLAR’s magnet reaches ±9 T along the beam');
    b = sliderBits(sT);
    setMd(b.label, 'Temperature');
    setMd(b.hint, 'Its magnetism vanishes at the Curie point, T_{C} = 750 K (477 °C)');
    b = sliderBits(sP);
    setMd(b.label, 'Squeeze: pressure (illustrative)');
    setMd(b.hint, '1 GPa ≈ 10,000 atmospheres · toy model: magnetism gone at 150 GPa');
    b = sliderBits(sR);
    setMd(b.label, 'What if: orbital ÷ spin moment');
    setMd(b.hint, 'm_{orb}/m_{spin,eff}: Pt in FePt ≈ 0.14. At ⅔ the L₂ signal vanishes, as seen in the iridate Sr_{2}IrO_{4}');
    const rl = (r: { el: HTMLElement }, s: string) => setMd(r.el.querySelector('.stn-readout-label'), s);
    rl(rSig, 'Magnetic signal at L₃');
    rSig.el.title = 'Peak of the difference μ_L − μ_R at the L₃ edge, in % of the edge step';
    rl(rM, 'Magnetization');
    rM.el.title = 'M·k̂/M_s: magnetization along the beam, as a fraction of its full value';
    rl(rTc, 'Curie point T_{C}');
    rl(rHc, 'Coercive field H_{c}');
    rHc.el.title = 'Field at which half of the grains have flipped, at the current temperature';

    // ------------------------------------------------------------ actions
    function setPol(v: Pol): void {
      st.pol = v;
      tPol.set(v);
      if (reduceMotion) Object.assign(anim, POLS[v]);
      specDirty = true;
    }

    function setAuto(on: boolean): void {
      st.auto = on;
      anim.autoT = 0;
      bAuto.setAttribute('aria-pressed', String(on));
      if (on && st.pol !== 'L' && st.pol !== 'R') setPol('L');
    }

    function startPulse(): void {
      const target = mag.M >= 0.02 ? -1 : mag.M <= -0.02 ? 1 : mag.sbar >= 0 ? -1 : 1;
      pulse = { t: 0, from: st.H, peak: target * P.POLAR.bMax };
    }

    /** Sweep the field to H in ≤ 0.1 T steps, so a jump of the slider still traces the loop (grains are history-dependent). */
    function setField(H: number): void {
      const H0 = st.H;
      const n = Math.max(1, Math.ceil(Math.abs(H - H0) / 0.1));
      for (let i = 1; i <= n; i++) {
        st.H = i === n ? H : H0 + ((H - H0) * i) / n;
        updateMagnet();
      }
    }

    function updateMagnet(): void {
      mag.tc = P.tcAt(st.P);
      mag.m0 = P.spontaneous(st.T, st.P);
      mag.hc = P.coercivity(st.T, st.P);
      const wasHot = grains.hot;
      const before = grains.mean();
      grains.update(st.H, mag.hc, mag.m0);
      if (wasHot && !grains.hot) mag.zfc = Math.abs(st.H) < 0.05;
      else if (grains.hot || grains.mean() !== before) mag.zfc = false;
      mag.sbar = grains.mean();
      mag.M = P.netMagnetization(mag.sbar, st.H, st.T, st.P);
      magPlot.pushTrail(st.H, mag.M);
      specDirty = true;
      magDirty = true;
    }

    function reset(): void {
      pulse = null;
      setAuto(false);
      st.H = DEFAULTS.H;
      st.T = DEFAULTS.T;
      st.P = DEFAULTS.P;
      st.ratio = DEFAULTS.ratio;
      sH.set(st.H);
      sT.set(st.T);
      sP.set(st.P);
      sR.set(st.ratio);
      setPol(DEFAULTS.pol);
      Object.assign(anim, POLS[DEFAULTS.pol]);
      grains.setAll(1);
      mag.zfc = false;
      magPlot.clearTrail();
      updateMagnet();
      lastCap = '';
    }

    // ------------------------------------------------------------ derived quantities
    /** orbital moment: Pt in FePt by default, or the what-if ratio slider */
    const mOrbNow = () => st.ratio * P.FEPT.mSpin;
    /** degree of polarization: P_c ≈ 0.98 (one plate); linear-V from two plates ≈ −0.80…−0.95 → 0.9 near 11.6 keV;
     *  retarder out: the planar undulator's linear-H light, taken as fully polarized */
    const beamPol = () => P.polarization(anim.delta, st.pol === 'V' ? P.POLAR.plinV : st.pol === 'H' ? 1 : P.POLAR.pc);

    function recomputeSpectra(): void {
      const pol = beamPol();
      const s = { mProj: mag.M, pcBeam: pol.pc, pcMag: P.POLAR.pc, mSpinEff: P.FEPT.mSpin, mOrb: mOrbNow(), nh: P.FEPT.nh };
      P.computeSpectra(sp, s);
      yMax = 1.18 * P.maxDiff(sp, { pcMag: P.POLAR.pc, mSpinEff: s.mSpinEff, mOrb: s.mOrb, nh: s.nh });
      rb = P.readBack(sp, P.POLAR.pc, P.FEPT.nh);
    }

    const peakOf = (a: Float64Array) => {
      let m = 0;
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > Math.abs(m)) m = a[i];
      return m;
    };

    function updateReadouts(): void {
      const p3 = peakOf(sp.L3.diff) * 100;
      rSig.set(Math.abs(p3) < 0.05 ? '0.0 %' : `${signed(p3, 1)} %`);
      rM.set(Math.abs(mag.M) < 0.01 ? '0 %' : `${Math.round(Math.abs(mag.M) * 100)} % ${mag.M > 0 ? '→ with beam' : '← against'}`);
      rTc.set(mag.tc > 0 ? `${Math.round(mag.tc)} K · ${Math.round(mag.tc - 273.15)} °C` : 'gone');
      rHc.set(mag.m0 > 1e-3 ? `${mag.hc.toFixed(2)} T` : '—');
    }

    // ------------------------------------------------------------ captions
    let lastCap = '';
    let lastCapT = 0;
    function caption(): string {
      const tgt = POLS[st.pol];
      const pcT = -Math.sin(tgt.delta) * P.POLAR.pc;
      const p3 = peakOf(sp.L3.diff) * 100;
      const p2 = peakOf(sp.L2.diff) * 100;
      const hot = mag.m0 <= 1e-3;
      const demag = !hot && Math.abs(mag.sbar) < 0.3 && Math.abs(mag.M) < 0.3;
      const zfc = demag && mag.zfc;
      /** the field is close to the coercive field (rather than back near zero after a partial reversal) */
      const nearHc = Math.abs(st.H) > 0.6 * mag.hc;
      const Ttxt = `${Math.round(st.T)} K (${Math.round(st.T - 273.15)} °C)`;
      const left = pcT > 0;
      const twist = st.pol === 'E' ? 'oval-twisted' : left ? 'left-twisted' : 'right-twisted';
      const other = left ? 'right-twisted' : 'left-twisted';

      let v = '';
      if (mag.tc <= 0) {
        v = `**Squeezed to ${Math.round(st.P)} GPa (about ${(st.P / 100).toFixed(1)} million atmospheres), this magnet has lost its magnetism**, so the gap between the curves is gone. Real materials give up their magnetism at very different squeezes, and POLAR measures where, in diamond anvil cells. *(Toy pressure model: magnetism gone at 150 GPa.)*`;
      } else if (hot) {
        v =
          Math.abs(mag.M) > 0.03
            ? `**At ${Ttxt} the magnet is above its Curie point (${Math.round(mag.tc)} K): its atomic magnets jiggle out of line.** The strong field still lines up a few of them, leaving a faint difference (${signed(p3, 1)} % of the edge step): magnetism induced by the field, not the magnet’s own. Switch the field off and it vanishes.`
            : `**At ${Ttxt}, hotter than its Curie point (${Math.round(mag.tc)} K), the atomic magnets jiggle out of line and the magnetism is gone.** Left- and right-twisted X-rays are absorbed equally: no difference. Heat-assisted hard drives write bits this way: heat, flip, cool.`;
      } else if (zfc) {
        v = `**The magnetism came back with no field to guide it, so the tiny grains froze pointing both ways and cancel out** (the magnet is *thermally demagnetized*). Every grain is magnetic, yet the difference is almost gone. Press **Flip the magnet** (a 9-tesla pulse) to line them up.`;
      } else if (demag && nearHc) {
        v = `**At ${num(st.H, 1)} tesla, about half of the tiny grains have flipped and half have not**, so their magnetism nearly cancels and the gap almost closes. This field, about ${mag.hc.toFixed(1)} tesla, is the magnet's *coercive field*. The grains differ, so they flip over a spread of fields; push harder and every grain flips.`;
      } else if (demag) {
        v = `**About half of the tiny grains point each way, and they stay like that at ${num(st.H, 1)} tesla: the magnet remembers.** Their magnetism cancels, so the gap stays almost closed. Only a field stronger than about ${mag.hc.toFixed(1)} tesla lines them all up again.`;
      } else if (Math.abs(pcT) < 0.1) {
        v = `**Flat-wiggling light cannot tell which way the magnet points.** It has no twist (circular polarization ≈ 0), so it measures the average of the two curves and your beam's dots sit in the middle. Choose a **left** or **right** twist to see the magnetism.`;
      } else if (st.pol === 'E') {
        v = `**The oval twist is part corkscrew, part flat, so it picks up only about ${Math.round(Math.abs(pcT) * 100)} % of the magnetic gap:** its dots sit between the left- and right-twist curves. A full twist gives the biggest signal, which is why POLAR makes its corkscrews as round as it can (98 %).`;
      } else {
        const more = (p3 > 0) === left;
        v = `**${cap(twist)} X-rays are absorbed ${more ? 'more' : 'less'} than ${other} ones at platinum's absorption edge (X-ray energy 11.56 keV).** The gap between them, shaded in the lower plot, is there only because the atoms are magnetized ${mag.M > 0 ? 'along' : 'against'} the beam: this is **X-ray magnetic circular dichroism (XMCD)**, ${signed(p3, 1)} % of the edge step at L₃ and ${signed(p2, 1)} % at L₂. `;
        if (mag.M < 0) v += 'The magnet is flipped, so the gap is upside down. ';
        else v += 'Flip the magnet and the gap turns upside down. ';
        if (st.P > 0) v += `Squeezed to ${Math.round(st.P)} GPa, the magnetism is weaker *(illustrative)*.`;
        else if (st.T > 0.75 * mag.tc) v += 'Near the Curie point the magnetism is already fading.';
        else v += `The sum rules turn the two areas into platinum’s moments: ${signed(rb.mSpinEff, 2)} (effective spin) and ${signed(rb.mOrb, 3)} (orbital) Bohr magnetons along the beam.`;
      }
      return v;
    }

    function refreshCaption(force = false): void {
      const now = performance.now();
      if (!force && now - lastCapT < 150) return;
      lastCapT = now;
      const v = caption();
      if (v === lastCap) return;
      lastCap = v;
      station.setCaption(v);
    }
    // The caption only grows while the width stays fixed: shrinking would resize the canvases while a slider moves.
    let capMin = 0;
    // write in the next frame: changing layout inside the observer callback triggers "ResizeObserver loop" warnings
    const capRo = new ResizeObserver(() =>
      requestAnimationFrame(() => {
        const ch = station.caption.getBoundingClientRect().height;
        if (ch > capMin + 0.5) {
          capMin = Math.ceil(ch);
          station.caption.style.minHeight = `${capMin}px`;
        }
      }),
    );
    capRo.observe(station.caption);
    const resetCaptionHeight = () => {
      capMin = 0;
      station.caption.style.minHeight = '';
    };

    // ------------------------------------------------------------ pointer interaction on the magnet plots
    let drag: 'loop' | 'temp' | null = null;
    const local = (e: PointerEvent) => {
      const r = cC.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const applyDrag = (kind: 'loop' | 'temp', x: number) => {
      const v = magPlot.valueAt(kind, x);
      if (kind === 'loop') {
        pulse = null;
        let H = Math.round(v * 20) / 20;
        if (Math.abs(H) < 0.025) H = 0;
        sH.set(H);
        setField(H);
      } else {
        st.T = Math.round(v);
        sT.set(st.T);
        magPlot.clearTrail();
        updateMagnet();
      }
    };
    cC.canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = local(e);
      const k = magPlot.hit(x, y);
      if (!k) return;
      drag = k;
      cC.canvas.setPointerCapture(e.pointerId);
      applyDrag(k, x);
      e.preventDefault();
    });
    cC.canvas.addEventListener('pointermove', (e) => {
      const [x, y] = local(e);
      if (drag) {
        applyDrag(drag, x);
        return;
      }
      const k = magPlot.hit(x, y);
      if (k !== magPlot.hover) {
        magPlot.hover = k;
        wrapOf(cC).classList.toggle('xmcd-drag', !!k);
        magDirty = true;
      }
    });
    const endDrag = () => {
      drag = null;
    };
    cC.canvas.addEventListener('pointerup', endDrag);
    cC.canvas.addEventListener('pointercancel', endDrag);
    cC.canvas.addEventListener('pointerleave', () => {
      if (!drag && magPlot.hover) {
        magPlot.hover = null;
        wrapOf(cC).classList.remove('xmcd-drag');
        magDirty = true;
      }
    });

    // ------------------------------------------------------------ layout
    let layoutMode = '';
    let lastW = -1;
    const applyLayout = () => {
      const w = host.clientWidth || 900;
      if (Math.abs(w - lastW) > 0.5) {
        lastW = w;
        resetCaptionHeight();
      }
      const mode = w >= 1000 ? 'wide' : w >= 700 ? 'mid' : w >= 520 ? 'narrow' : 'narrow-tall';
      if (mode === layoutMode) return;
      resetCaptionHeight();
      layoutMode = mode;
      const stack = mode !== 'wide';
      const narrow = mode.startsWith('narrow');
      root.classList.toggle('stn-stack', stack);
      root.classList.toggle('stn-side', !stack);
      root.style.height = stack ? '100%' : '';
      root.style.overflowY = stack ? 'auto' : '';
      root.style.scrollbarWidth = stack ? 'thin' : '';
      controls.style.overflowY = stack ? 'visible' : '';
      for (const n of [guideEl, lightEl, whyEl, caveatEl]) n.style.gridColumn = stack ? '1 / -1' : '';
      root.style.gridTemplateColumns = mode === 'wide' ? 'minmax(0,1fr) 288px' : '';
      const vs = visual.style;
      if (narrow) {
        // beam → light controls → spectra → caption → magnet controls (Flip sits just below the spectra it
        // flips) → magnet plots → background notes
        visual2.append(wrapOf(cB));
        visual3.append(wrapOf(cC));
        ctlA.replaceChildren(guideEl, gL, lightEl);
        ctlM.replaceChildren(gM, gN);
        resetRow.appendChild(bReset);
        controls.replaceChildren(whyEl, caveatEl);
        root.style.gridTemplateRows = 'repeat(7, max-content)';
        root.append(visual, ctlA, visual2, station.caption, ctlM, visual3, controls);
        vs.gridTemplateColumns = 'minmax(0,1fr)';
        vs.gridTemplateRows = '316px';
        vs.minHeight = '';
        for (const v of [visual2.style, visual3.style]) {
          v.gridTemplateColumns = 'minmax(0,1fr)';
          v.minHeight = '';
        }
        visual2.style.gridTemplateRows = '350px';
        visual3.style.gridTemplateRows = `${mode === 'narrow-tall' ? 420 : 300}px`;
        return;
      }
      visual.append(wrapOf(cB), wrapOf(cC));
      controls.replaceChildren(guideEl, gL, gM, gN, lightEl, whyEl, caveatEl);
      // the side column is height-limited: Reset joins the Flip button's row instead of trailing the readouts
      if (mode === 'wide') rowM.appendChild(bReset);
      else resetRow.appendChild(bReset);
      visual2.remove();
      visual3.remove();
      ctlA.remove();
      ctlM.remove();
      root.append(visual, controls, station.caption);
      vs.gridTemplateColumns = 'minmax(0,1.45fr) minmax(0,1fr)';
      if (mode === 'wide') {
        root.style.gridTemplateRows = '';
        vs.gridTemplateRows = 'minmax(250px,0.72fr) minmax(0,1fr)';
        vs.minHeight = '600px';
      } else {
        root.style.gridTemplateRows = 'repeat(3, max-content)';
        vs.gridTemplateRows = '260px 380px';
        vs.minHeight = '';
      }
    };
    const ro = new ResizeObserver(() => requestAnimationFrame(() => applyLayout()));
    ro.observe(host);
    station.onDestroy(() => {
      ro.disconnect();
      capRo.disconnect();
    });

    // ------------------------------------------------------------ frame loop
    const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    const beamState: BeamState = {
      delta: anim.delta,
      rock: anim.rock,
      retract: anim.retract,
      second: anim.second,
      plateLabel: '',
      plateSub: '',
      waveLabel: '',
      waveSub: '',
      m: 1,
      m0: 1,
      grains: grains.s,
      pressure: 0,
    };
    let labelKey = '';
    const updateBeamLabels = () => {
      const key = `${st.pol}`;
      if (key === labelKey) return;
      labelKey = key;
      const d = DQ;
      // [plate, plate detail, wave, wave detail]
      const L: Record<Pol, [string, string, string, string]> = {
        L: ['diamond, tilted', `by Δθ = −${d.toFixed(1)}″ (0.008°)`, 'left-handed corkscrew', '↺ left-circular, 98 %'],
        R: ['diamond, tilted', `the other way, Δθ = +${d.toFixed(1)}″`, 'right-handed corkscrew', '↻ right-circular, 98 %'],
        E: ['diamond, tilted', `twice as far, Δθ = −${(2 * d).toFixed(1)}″`, 'oval corkscrew', 'elliptical, 69 % circular'],
        H: ['diamond moved out', 'nothing changes', 'flat, side to side', 'linear-horizontal, no twist'],
        V: ['two diamonds', 'two quarter waves add up', 'flat, up and down', 'linear-vertical, ~90 %'],
      };
      const t = L[st.pol];
      beamState.plateLabel = t[0];
      beamState.plateSub = t[1];
      beamState.waveLabel = t[2];
      beamState.waveSub = t[3];
    };

    loop(station, (dt) => {
      // auto-flip (slowed piezo)
      if (st.auto) {
        anim.autoT += dt;
        if (anim.autoT >= FLIP_PERIOD) {
          anim.autoT = 0;
          setPol(st.pol === 'L' ? 'R' : 'L');
        }
      }
      // field pulse: from → ±9 T → 0 T
      if (pulse) {
        pulse.t += dt;
        const T1 = 0.75;
        const T2 = 0.25;
        const T3 = 0.75;
        let H: number;
        if (pulse.t < T1) H = pulse.from + (pulse.peak - pulse.from) * ease(pulse.t / T1);
        else if (pulse.t < T1 + T2) H = pulse.peak;
        else if (pulse.t < T1 + T2 + T3) H = pulse.peak * (1 - ease((pulse.t - T1 - T2) / T3));
        else {
          H = 0;
          pulse = null;
        }
        sH.set(H);
        setField(H);
      }
      // smooth the optics
      const tgt = POLS[st.pol];
      const k = reduceMotion ? 1 : 1 - Math.exp(-dt / 0.11);
      const d0 = anim.delta;
      anim.delta += (tgt.delta - anim.delta) * k;
      anim.rock += (tgt.rock - anim.rock) * k;
      anim.retract += (tgt.retract - anim.retract) * k;
      anim.second += (tgt.second - anim.second) * k;
      if (Math.abs(anim.delta - d0) > 1e-5) specDirty = true;

      if (specDirty) {
        specDirty = false;
        recomputeSpectra();
        const pol = beamPol();
        specPlot.draw({ sp, yMax, beamPc: pol.pc, beamColor: beamColor(pol.pc), rb, quiet: Math.abs(mag.M) < 0.01 });
        updateReadouts();
      }
      if (magDirty) {
        magDirty = false;
        magPlot.draw({ H: st.H, T: st.T, P: st.P, M: mag.M, m0: mag.m0, hc: mag.hc, tc: mag.tc });
      }
      updateBeamLabels();
      beamState.delta = anim.delta;
      beamState.rock = anim.rock;
      beamState.retract = anim.retract;
      beamState.second = anim.second;
      beamState.m = mag.M;
      beamState.m0 = mag.m0;
      beamState.pressure = st.P;
      beamView.draw(beamState, dt);
      refreshCaption();
    });

    // ------------------------------------------------------------ start
    applyLayout();
    updateMagnet();
    recomputeSpectra();
    updateReadouts();
    refreshCaption(true);

    return {
      destroy: () => station.destroy(),
    };
  },
};
export default mod;

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
