/**
 * Station "Magnetism from X-ray absorption" at POLAR 4-ID. X-ray magnetic circular dichroism.
 *
 * Three linked views:
 *   1. The beam: the undulator's linear-horizontal light passes a diamond quarter-wave plate (Bragg-transmission
 *      phase retarder, scattering plane at 45°) and leaves linear-H, left/right circular, elliptical or (two plates)
 *      linear-V; animated E-field helix in a cabinet projection plus a head-on view of the E-vector tip.
 *   2. Schematic Pt L₃ (11.564 keV) and L₂ (13.273 keV) absorption of an L1₀ FePt film for left- and right-circular
 *      light, and their difference (XMCD), which flips with M and vanishes with M; the sum rules are applied to the
 *      displayed curves (the box in view 2). Dots represent absorption for the polarization selected in view 1: μ_L, μ_R or their mean for
 *      linear light. P_c = 0.98 for one plate; |P_lin| = 0.9 for linear-V from two plates, measured −0.80 to −0.95.
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
  title: "Magnetism from X-ray absorption",
  subtitle: "Change X-ray polarization and reverse, heat or pressurize the magnet. Compare the absorption of left- and right-circular X-rays.",
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
    const cA = canvas2d(visual, { label: "1 · Diamond phase retarder" });
    const cB = canvas2d(visual, { label: "2 · Absorption spectra · schematic" });
    const cC = canvas2d(visual, { label: "3 · Magnetization M(H) and M(T)" });
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
      "Select circular polarization, then flip the magnet to reverse the absorption difference. Heat above the Curie point to remove spontaneous magnetization, or apply pressure in this illustrative model. The moments in panel 2 are calculated from the displayed curves using the sum rules.",
    );
    const guideEl = controls.lastElementChild as HTMLElement;
    const gL = group(controls, "1 · X-ray polarization");
    const tPol = toggle<Pol>(gL, {
      options: [
        { value: 'L', label: "↺ Left circular", title: `Left-circular polarization with positive helicity. Diamond offset Δθ = −${DQ.toFixed(1)}″; phase delay δ = −90°.` },
        { value: 'R', label: "↻ Right circular", title: `Right-circular polarization with negative helicity. Δθ = +${DQ.toFixed(1)}″; δ = +90°.` },
        { value: 'E', label: "⬭ Elliptical", title: `Elliptical polarization. Δθ = −${(2 * DQ).toFixed(1)}″; δ = −45°.` },
        { value: 'H', label: "↔ Horizontal", title: "Linear-horizontal polarization from the undulator. Diamond removed; δ = 0." },
        { value: 'V', label: "↕ Vertical", title: "Linear-vertical polarization from two quarter-wave plates; δ = 180°." },
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
    const bAuto = button(rowL, "⇄ Alternate polarization", () => setAuto(!st.auto));
    bAuto.title = "POLAR alternates polarization at about 15 Hz using a piezo-driven diamond and lock-in detection. This display changes it every 1.2 s.";
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
    bReset.title = "Restore left-circular polarization, upward magnetization, 300 K, zero field and zero pressure";

    note(
      controls,
      station,
      `Radiation from the undulator is linearly polarized, with horizontal electric-field oscillations. A diamond 0.5 mm thick is set ${DQ.toFixed(0)}″, or about 0.008°, from its Bragg reflection angle. Within the diamond, one diagonal electric-field component acquires a quarter-wavelength delay relative to the other. The resulting electric field rotates, with 98 % circular polarization. Reverse the diamond offset to reverse the polarization. At POLAR, the diamond angle is alternated at about 15 Hz. Phase-retarder operation covers about 2.7 to 14 keV, with flux reduced by a factor of 5 to 30.`,
    );
    const lightEl = controls.lastElementChild as HTMLElement;

    note(
      controls,
      station,
      "Each element has characteristic X-ray absorption energies, so X-ray magnetic circular dichroism, or XMCD, measures one element's magnetism at a time. Platinum is not magnetic on its own. Iron neighbours induce magnetism in the platinum atoms of this FePt film. The sum rules relate the integrated absorption difference to spin and orbital magnetic moments. An orbital moment gives an imbalance between the L₃ and L₂ peaks. The rules work best at heavy-element L edges such as these. Heat-assisted hard drives use FePt and heat grains near their Curie point so a small field can reverse their magnetization.",
    );
    const whyEl = controls.lastElementChild as HTMLElement;
    note(
      controls,
      station,
      "The displayed waves are not to scale; their wavelength is about a ten-millionth of a millimetre. The absorption curve shapes are simplified. Illustrative moments resemble calculations for platinum in FePt: spin 0.35 and orbital 0.05 Bohr magnetons. The mean-field model varies too little at low temperature. The pressure dependence is illustrative. POLAR's cryostats cover 1.4 to 450 K; higher temperatures are displayed to demonstrate the physics. Its diamond anvil cells reach 3 Mbar, or 300 GPa, with a goal of about 6 Mbar.",
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
    setMd(b.hint, "The field at POLAR is up to ±9 T along the beam");
    b = sliderBits(sT);
    setMd(b.label, 'Temperature');
    setMd(b.hint, "Spontaneous magnetization vanishes at the Curie point, T_{C} = 750 K or 477 °C");
    b = sliderBits(sP);
    setMd(b.label, "Pressure · illustrative");
    setMd(b.hint, "1 GPa ≈ 10,000 atmospheres. This illustrative model loses magnetization at 150 GPa.");
    b = sliderBits(sR);
    setMd(b.label, "Orbital ÷ spin moment");
    setMd(b.hint, "m_{orb}/m_{spin,eff} is ≈0.14 for Pt in FePt. At ⅔, the L₂ signal vanishes, as observed in the iridate Sr_{2}IrO_{4}.");
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
      rHc.set(mag.m0 > 1e-3 ? `${mag.hc.toFixed(2)} T` : "None");
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
      const Ttxt = `${Math.round(st.T)} K or ${Math.round(st.T - 273.15)} °C`;
      const left = pcT > 0;
      const twist = st.pol === 'E' ? "elliptically polarized" : left ? "left-circular" : "right-circular";
      const other = left ? "right-circular" : "left-circular";

      let v = '';
      if (mag.tc <= 0) {
        v = `At ${Math.round(st.P)} GPa, about ${(st.P / 100).toFixed(1)} million atmospheres, this model has no magnetization or absorption difference. Actual materials lose magnetism at different pressures. At POLAR, those changes are measured in diamond anvil cells. The pressure dependence here is illustrative, with magnetization vanishing at 150 GPa.`;
      } else if (hot) {
        v =
          Math.abs(mag.M) > 0.03
            ? `At ${Ttxt}, above the Curie point of ${Math.round(mag.tc)} K, thermal motion disrupts alignment of the atomic moments. The strong field still aligns some moments, producing a difference of ${signed(p3, 1)} % of the edge step. This magnetization is induced by the field. Turn the field off to remove it.`
            : `At ${Ttxt}, above the Curie point of ${Math.round(mag.tc)} K, thermal motion disrupts alignment of the atomic moments. Left- and right-circular X-rays are absorbed equally. Heat-assisted hard drives use heating and cooling near the Curie point to reverse magnetization and record bits.`;
      } else if (zfc) {
        v = `The grains cooled without an applied field, so their magnetizations point in opposite directions and nearly cancel. This is thermal demagnetization. Each grain is magnetic, but the net absorption difference is small. Flip the magnet to apply a 9-tesla pulse and align them.`;
      } else if (demag && nearHc) {
        v = `At ${num(st.H, 1)} tesla, about half the grains have reversed their magnetization. Their moments nearly cancel, reducing the absorption difference. This is near the coercive field of ${mag.hc.toFixed(1)} tesla. Different grains reverse at different fields. Increase the field to reverse all grains.`;
      } else if (demag) {
        v = `About half the grains point in each direction at ${num(st.H, 1)} tesla. Their near cancellation persists because magnetization depends on field history, a property called hysteresis. A field stronger than about ${mag.hc.toFixed(1)} tesla aligns all grains again.`;
      } else if (Math.abs(pcT) < 0.1) {
        v = `Linearly polarized X-rays have approximately zero circular polarization. Their absorption is the average of the left- and right-circular curves and does not distinguish the magnetization direction in this model. Select left- or right-circular polarization to measure the absorption difference.`;
      } else if (st.pol === 'E') {
        v = `The elliptically polarized beam has ${Math.round(Math.abs(pcT) * 100)} % circular polarization. The measured magnetic absorption difference is reduced by this factor. The points lie between the left- and right-circular curves. The XMCD signal is greatest with circular polarization. Circular polarization at POLAR reaches 98 %.`;
      } else {
        const more = (p3 > 0) === left;
        v = `${cap(twist)} X-rays are absorbed ${more ? 'more' : 'less'} than ${other} X-rays at platinum's 11.56 keV absorption edge. The difference exists because the atoms are magnetized ${mag.M > 0 ? 'along' : 'against'} the beam. This is X-ray magnetic circular dichroism, or XMCD. The difference is ${signed(p3, 1)} % of the edge step at L₃ and ${signed(p2, 1)} % at L₂. `;
        if (mag.M < 0) v += "Reversing the magnetization reversed the absorption difference. ";
        else v += "Flip the magnet to reverse the absorption difference. ";
        if (st.P > 0) v += `At ${Math.round(st.P)} GPa, magnetization is lower in this illustrative pressure model.`;
        else if (st.T > 0.75 * mag.tc) v += "Magnetization decreases near the Curie point.";
        else v += `The sum rules give platinum moments along the beam of ${signed(rb.mSpinEff, 2)} Bohr magnetons for effective spin and ${signed(rb.mOrb, 3)} Bohr magnetons for orbital motion.`;
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
        L: ['diamond, tilted', `Δθ = −${d.toFixed(1)}″ · 0.008°`, "left-circular polarization", '↺ left-circular, 98 %'],
        R: ['diamond, tilted', `the other way, Δθ = +${d.toFixed(1)}″`, "right-circular polarization", '↻ right-circular, 98 %'],
        E: ['diamond, tilted', `twice as far, Δθ = −${(2 * d).toFixed(1)}″`, "elliptical polarization", 'elliptical, 69 % circular'],
        H: ['diamond moved out', "phase delay unchanged", "horizontal polarization", "linear-horizontal"],
        V: ['two diamonds', "two quarter-wave delays", "vertical polarization", 'linear-vertical, ~90 %'],
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
