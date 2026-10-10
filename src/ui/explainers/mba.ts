/**
 * Station "mba" — "Squeezing the electron beam": why the APS Upgrade's multi-bend achromat makes a ~70× smaller
 * electron beam than the old double-bend ring.
 *
 * Panels
 *   1. One of the ring's 40 sectors seen from above (./mba/sector.ts): reference orbit through the real magnet
 *      layout (old APS DBA: schematic positions, real 4.5°/3.06 m dipoles; APS-U H7BA: FDR 2019 Fig. 2.2 layout and
 *      Table 2.4 bend angles incl. 5-step longitudinal-gradient dipoles and the Q4/Q5/Q8 reverse bends; other M:
 *      equal-dipole model). Electrons ride x = η(s)·δ + x_β: they fan out by energy in proportion to the dispersion
 *      η(s), emit photons in the bends (rate ∝ B), and each emission kicks their betatron amplitude by Δx_β = η·Δδ
 *      (quantum excitation), damped back (radiation damping). Below: η_x(s) along the sector.
 *   2. The beam end-on at an ID source point, to scale against a 70-µm hair (./mba/beam.ts):
 *      APS 275 × 10 µm rms (FDR 2019 Table 2.1); APS-U 12.3 × 8.3 µm (round, κ = 1) or 14.5 × 3.1 µm (flat, κ = 0.1),
 *      zero current (Storage Ring Parameters 2024, Table 5) — all from the facility research dossier.
 *   3. Emittance vs bends per sector (./mba/chart.ts).
 *
 * Physics (details, equations and sources in ./mba/physics.ts):
 *   ε_x = C_q γ² ⟨𝓗/|ρ|³⟩ / (J_x ⟨1/ρ²⟩), C_q = 3.832e-13 m  ⇒  ε_x = F C_q γ² θ³ / J_x,  θ = 2π/(40·M)
 *   SCALING LAW shown on the slider: ε(M, E) = 3.1 nm·rad · (2/M)³ · (E/7 GeV)², anchored at the APS.
 *   Real APS-U: 41.7 pm·rad (FDR Table 2.3; srp2024 41.5). The law's 53 pm is anchored at the APS EFFECTIVE
 *   emittance; from its natural 2.5 nm·rad (η_x ≈ 0.17 m leaked into the old straights; Sajaev & Emery 2005) the
 *   law gives 43 pm. APS-U matches the old F/J_x only because J_x = 2.25 (gradient dipoles + reverse bends) makes
 *   up for a hybrid cell that sits ≈ 7× above the TME factor (old DBA ≈ 3.3×); 67 pm without reverse bends.
 *   Coupled emittances: ε_x = ε_0 J_x/(J_x + κJ_y), ε_y = κ ε_x (reproduces srp2024 Table 5: 28.7/28.7 and 39.7/3.98 pm).
 *   Robinson: J_x + J_y + J_E = 4; J_x = 1 − 𝒟.  MBA bound: ε_min = C_q γ²θ³(M+1)/(12√15 J_x (M−1)) (Wolski 2015).
 *   Illustrative (labelled in the UI): the η model for M ≠ 7, the old-APS magnet positions, photon rates,
 *   betatron amplitudes/damping times in the animation, the slowed electron motion in panel 2.
 */
import type { Depth } from '../../app/store';
import type { ExplainerModule } from './registry';
import { button, canvas2d, createStation, group, loop, md, motionGate, note, readout, slider, toggle, type Canvas2D } from './kit';
import * as P from './mba/physics';
import { SectorView } from './mba/sector';
import { BeamView, type Coupling } from './mba/beam';
import { EmittanceChart } from './mba/chart';

type Energy = '7' | '6';

const DEFAULTS = { M: 7, E: '6' as Energy, mode: 'round' as Coupling, zoom: 6 };

const CSS = `
.mba-root .stn-readout-value { white-space: nowrap; }
.mba-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.mba-presets .stn-btn { flex: 1; padding: 6px 8px; font-size: 12px; }
.mba-presets .stn-btn[aria-pressed=true] { background: color-mix(in oklab, var(--c, #5cd3ff) 26%, #0b111b); border-color: var(--c, #5cd3ff); color: #fff; }
.mba-root .stn-note { font-size: 12.25px; }
`;

const mod: ExplainerModule = {
  title: 'Squeezing the electron beam',
  subtitle: 'Split each turn of the ring into more, gentler bends — and watch the electron beam shrink.',
  mount(host, ctx) {
    const accent = ctx.color || '#5cd3ff';
    const station = createStation(host, { depth: ctx.depth, color: accent, layout: 'side' });
    const { visual, controls, root } = station;
    root.classList.add('mba-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const st = { M: DEFAULTS.M, E: DEFAULTS.E, mode: DEFAULTS.mode, zoom: DEFAULTS.zoom };
    let depth: Depth = ctx.depth;
    const Ev = () => Number(st.E);

    // ------------------------------------------------------------ canvases
    const cSector = canvas2d(visual, { label: ' ' });
    const visual2 = document.createElement('div');
    visual2.className = 'stn-visual';
    const cBeam = canvas2d(visual, { label: ' ' });
    const cChart = canvas2d(visual, {});
    cChart.canvas.setAttribute('aria-label', 'Chart: emittance versus number of bends per sector');
    const wrapOf = (c: Canvas2D) => c.canvas.parentElement as HTMLElement;
    const labelOf = (c: Canvas2D) => wrapOf(c).querySelector('.stn-canvas-label') as HTMLElement;

    const sector = new SectorView(cSector, accent, P.latticeFor(st.M), Ev(), depth);
    const beam = new BeamView(cBeam, accent, depth);
    let chartDirty = true;
    const chart = new EmittanceChart(cChart, accent, depth, (M) => {
      if (M !== st.M) {
        st.M = M;
        sM.set(M);
        changed();
      }
    });
    cSector.onResize(() => sector.invalidate());
    cChart.onResize(() => (chartDirty = true));

    // ------------------------------------------------------------ controls
    const ctlA = document.createElement('div');
    ctlA.className = 'stn-controls';
    ctlA.style.gridTemplateColumns = 'minmax(0,1fr)';

    note(
      controls,
      station,
      '**Drag the number of bends.** The ring is 40 identical sectors, each turning the beam by 9°. Split that turn into more, gentler bends and the electrons get shaken less — so the beam squeezes smaller.',
      '**Drag M** (or click the chart). M = 2 is the APS double-bend achromat, M = 7 the real APS-U hybrid 7BA; other M are equal-dipole achromat models. Panel 1 animates quantum excitation: photon emission in the bends changes δ, and the betatron amplitude jumps by η·Δδ.',
    );
    const guideEl = controls.lastElementChild as HTMLElement;

    const gBuild = group(controls, 'Build a ring');
    const sM = slider(gBuild, {
      label: 'Bends per sector',
      min: 2,
      max: 10,
      step: 1,
      value: st.M,
      format: (v) => `${Math.round(v)}`,
      onInput: (v) => {
        const M = Math.round(v);
        if (M !== st.M) {
          st.M = M;
          changed();
        }
      },
    });
    const tE = toggle<Energy>(gBuild, {
      label: 'Electron energy',
      options: [
        { value: '7', label: '7 GeV (old APS)' },
        { value: '6', label: '6 GeV (APS-U)' },
      ],
      value: st.E,
      onChange: (v) => {
        st.E = v;
        changed();
      },
    });
    const eWrap = gBuild.lastElementChild as HTMLElement;
    const presets = document.createElement('div');
    presets.className = 'mba-presets';
    gBuild.appendChild(presets);
    const bOld = button(presets, 'Old APS', () => preset(2, '7'));
    bOld.title = 'Double-bend achromat, 7 GeV (1995–2023)';
    const bNew = button(presets, 'APS-U', () => preset(7, '6'));
    bNew.title = 'Hybrid seven-bend achromat with reverse bends, 6 GeV (2024–)';
    // reduced motion: panels 1 and 2 show still pictures (redrawn on every change) until Play is pressed
    const motion = motionGate(station, gBuild, { title: 'Your device asks for reduced motion, so the electrons hold still. Press to set them moving.' });

    const gNum = group(controls, 'Result');
    const rTheta = readout(gNum, 'Each bend turns');
    const rEps = readout(gNum, 'Emittance', { big: true, color: accent });
    /** the real APS-U (M = 7, 6 GeV) shows its design value above; this row keeps the scaling law's estimate */
    const rLaw = readout(gNum, 'Simple scaling-law estimate');
    const rGain = readout(gNum, 'Smaller than old APS');
    const rMin = readout(gNum, 'MBA bound');
    const epsHint = document.createElement('div');
    epsHint.className = 'stn-hint';
    gNum.appendChild(epsHint);
    const rowLabel = (r: { el: HTMLElement }) => r.el.querySelector('.stn-readout-label') as HTMLElement;

    const gView = group(controls, 'End-on view (panel 2)');
    const tMode = toggle<Coupling>(gView, {
      label: 'APS-U beam shape',
      options: [
        { value: 'round', label: 'Round (users)', title: 'Full coupling κ = 1: ε_x = ε_y = 28.7 pm·rad (user operation since 2025)' },
        { value: 'flat', label: 'Flat', title: 'Low coupling κ = 0.1: ε_x = 39.7, ε_y = 3.98 pm·rad' },
      ],
      value: st.mode,
      onChange: (v) => {
        st.mode = v;
        beam.set({ mode: v });
        refresh();
      },
    });
    const modeWrap = gView.lastElementChild as HTMLElement;
    const sZoom = slider(gView, {
      label: 'Magnify',
      min: 2,
      max: 20,
      log: true,
      value: st.zoom,
      format: (v) => `×${v < 10 ? v.toFixed(1) : v.toFixed(0)}`,
      onInput: (v) => {
        st.zoom = v;
        beam.set({ zoom: v });
      },
    });

    const resetRow = document.createElement('div');
    resetRow.style.display = 'flex';
    resetRow.style.gap = '8px';
    controls.appendChild(resetRow);
    button(resetRow, '↺ Reset', () => {
      st.M = DEFAULTS.M;
      st.E = DEFAULTS.E;
      st.mode = DEFAULTS.mode;
      st.zoom = DEFAULTS.zoom;
      sM.set(st.M);
      tE.set(st.E);
      tMode.set(st.mode);
      sZoom.set(st.zoom);
      beam.set({ mode: st.mode, zoom: st.zoom });
      changed();
    });

    note(
      controls,
      station,
      '**Why does bending shake the beam?** Every bend makes an electron fling out X-rays, losing a random bit of energy. Electrons of different energy take different paths (amber vs violet), so each loss knocks the electron sideways into a wobble. Halve the bend angle and the wobbles — the beam’s *emittance*, its size × angle spread — shrink about 8×.',
      '**Why θ³.** ε_{x} = C_{q}γ²⟨𝓗/|ρ|³⟩ / (J_{x}⟨1/ρ²⟩), C_{q} = 3.83×10⁻¹³ m. In a dipole η ∝ ρθ², η′ ∝ θ, so 𝓗 = γη² + 2αηη′ + βη′² ∝ ρθ³ and ε = F·C_{q}γ²θ³/J_{x}. F is a lattice quality factor (TME bound F = 1/12√15). M 2 → 7: (7/2)³ = 43×; 7 → 6 GeV: ×(6/7)² = 0.73. The slider keeps F/J_{x} fixed (**scaling law**).',
    );
    note(
      controls,
      station,
      '**The tricks.** APS-U’s long bends are not uniform: each is strongest at the end where the energy fan is narrowest. And six slightly *backward* bends (pink) help pull the fan back in. Without the backward bends the design reached only 67 pm·rad; with them, 42.',
      '**Reverse bends & Robinson.** Q4, Q5, Q8 are quadrupoles shifted off-axis, adding −0.07 to −0.31° of reverse bend (per sector +9.945° − 0.942° = 9°; 435° per turn). This extra dispersion knob lowers 𝓗 in the dipoles independently of β: 42 pm vs 67 pm without (FDR §2-2.1). Robinson: J_{x} + J_{y} + J_{E} = 4, J_{x} = 1 − 𝒟, 𝒟 = ∮η(1/ρ)(1/ρ² + 2K)ds/∮ds/ρ². Defocusing gradients in M3/M4 and focusing K in the reverse bends (η > 0, 1/ρ < 0) make 𝒟 < 0: J_{x} ≈ 2.25, J_{E} ≈ 0.75 (τ_{x,y,E} = 6.7/15.1/19.8 ms) — ε_{x} ÷2.25, paid with σ_{δ} ∝ 1/√J_{E} (0.136 %).',
    );
    note(
      controls,
      station,
      '**The catch.** Squeezing this hard takes very strong magnets, and they leave a “safe zone” only about 3 mm across — too small to pour new electrons into a running bunch. So APS-U *swaps*: about every 20 seconds a tired bunch is kicked out and a fresh, full one takes its place. Crowded bunches also lose electrons by bumping into each other, so a superconducting “stretching” cavity makes each bunch longer and less crowded.',
      '**The price.** Strong quads (to ~86 T/m) → large natural chromaticity → strong sextupoles (to ~6800 T/m²) → dynamic aperture ≈ ±1.5 mm at injection (measured, septum included), too small for off-axis accumulation. Hence **on-axis swap-out**: the most depleted bunch is kicked to a dump and replaced in the same bucket by a full-charge one (≈ every 20 s at 200 mA, 216 bunches). Dense bunches also lose electrons by **Touschek** scattering (lifetime 2–4 h vs 8 h at the APS). A passive superconducting **1408-MHz (4th-harmonic) cavity** at ~1.1 MV flattens the rf well and stretches bunches 2–4× (σ_{t} = 14.4 ps at zero current without it): ~2× longer Touschek lifetime measured, less IBS and rf heating.',
    );
    const noteEls = [...controls.querySelectorAll<HTMLElement>('.stn-note')];

    // ------------------------------------------------------------ text
    const applyDepthLabels = () => {
      const spec = depth === 'specialist';
      labelOf(cSector).textContent = spec ? '1 · One sector (27.6 m), plan view' : '1 · One of 40 sectors, from above';
      labelOf(cBeam).textContent = spec ? '2 · Beam cross-section at the ID source point' : '2 · The beam end-on, to scale';
      cSector.canvas.setAttribute('aria-label', labelOf(cSector).textContent ?? '');
      cBeam.canvas.setAttribute('aria-label', labelOf(cBeam).textContent ?? '');
      setSliderLabel(sM.input, spec ? 'Dipoles per sector, M' : 'Bends per sector');
      setSliderLabel(sZoom.input, spec ? 'Magnification' : 'Magnify');
      const el = eWrap.querySelector('.stn-slider-label');
      if (el) el.textContent = spec ? 'Beam energy E' : 'Electron energy';
      const ml = modeWrap.querySelector('.stn-slider-label');
      if (ml) ml.textContent = spec ? 'APS-U coupling' : 'APS-U beam shape';
      setToggleLabels(modeWrap, spec ? ['Round κ = 1', 'Flat κ = 0.1'] : ['Round (users)', 'Flat']);
      rowLabel(rTheta).textContent = spec ? 'Bend angle θ' : 'Each bend turns';
      rowLabel(rGain).textContent = spec ? 'ε_APS / ε' : 'Smaller than old APS';
      rowLabel(rMin).innerHTML = md(spec ? 'MBA bound (J_{x} = 1)' : '');
      rMin.el.style.display = spec ? '' : 'none';
      (gBuild.querySelector('.stn-group-title') as HTMLElement).textContent = spec ? 'Lattice' : 'Build a ring';
      (gNum.querySelector('.stn-group-title') as HTMLElement).textContent = spec ? 'Emittance' : 'Result';
    };

    function updateReadouts(): void {
      const spec = depth === 'specialist';
      const lat = P.latticeFor(st.M);
      const E = Ev();
      const eps = P.emittanceScaling(st.M, E);
      if (lat.id === 'apsu') {
        const b = P.bendStats(lat);
        rTheta.set(spec ? `${b.minDeg.toFixed(2)}–${b.maxDeg.toFixed(2)}°` : `1.1–1.6°`);
      } else rTheta.set(`${(P.SECTOR_BEND_DEG / st.M).toFixed(st.M >= 8 ? 3 : 2)}°`);
      // the real ring (7 bends, 6 GeV): its design emittance is the headline; the law's estimate goes below it
      const design = lat.id === 'apsu' && E === P.APSU.E;
      const shown = design ? P.APSU.epsNat : eps;
      rowLabel(rEps).innerHTML = md(design ? (spec ? 'ε_{0} design (FDR)' : 'Emittance (design)') : spec ? 'ε (scaling law)' : 'Emittance*');
      rEps.set(P.fmtEps(shown));
      rowLabel(rLaw).innerHTML = md(spec ? 'ε (scaling law)' : 'Simple scaling-law estimate*');
      rLaw.set(P.fmtEps(eps));
      rLaw.el.style.display = design ? '' : 'none';
      const g = P.APS.epsX / shown;
      rGain.set(g < 1.05 && g > 0.95 ? '—' : g >= 1 ? `${g < 10 ? g.toFixed(1) : Math.round(g)}×` : `${(1 / g).toFixed(2)}× larger`);
      rMin.set(P.fmtEps(P.emittanceMin(st.M, E, 1)));
      epsHint.innerHTML = md(
        spec
          ? `Scaling law ε = 3.1 nm·rad·(2/M)³(E/7 GeV)², F/J_{x} fixed, anchored at the APS *effective* emittance (FDR 2019 Table 2.1). From its natural ε_{0} = 2.5 nm·rad: ${P.fmtEps(P.emittanceScaling(st.M, E, P.APS.epsNat))}.`
          : design
            ? `Emittance = beam size × angle spread. ${P.fmtEps(P.APSU.epsNat)} is the APS-U design value. *The simple scaling law ε ∝ E²/M³, starting from the old APS, estimates ${P.fmtEps(eps)}.`
            : '*Emittance = beam size × angle spread. Estimated with the scaling law ε ∝ E²/M³, starting from the old APS.',
      );
      bOld.setAttribute('aria-pressed', String(st.M === 2 && st.E === '7'));
      bNew.setAttribute('aria-pressed', String(st.M === 7 && st.E === '6'));
      const lawTitle = 'Scaling law ε ∝ E²/M³, anchored at the old APS (3.1 nm·rad)';
      rowLabel(rEps).title = spec ? '' : design ? 'APS-U design natural emittance (FDR 2019 Table 2.3)' : lawTitle;
      rowLabel(rLaw).title = spec ? '' : lawTitle;
    }

    function captions(): [string, string] {
      const M = st.M;
      const E = Ev();
      const lat = P.latticeFor(M);
      const eps = P.emittanceScaling(M, E);
      const gain = P.APS.epsX / eps;
      const etaMm = P.etaMax(lat) * 1000;
      const per1 = (etaMm / 100).toFixed(etaMm < 100 ? 2 : 1);
      const th = P.SECTOR_BEND_DEG / M;
      const gx = (x: number) => (x < 10 ? x.toFixed(1) : Math.round(x).toString());
      const eNote = E === 7 && M !== 2 ? ' (At 6 GeV, the APS-U energy, it would be another 27 % smaller.)' : E === 6 && M === 2 ? ' (Here the old lattice is run at 6 GeV — 27 % smaller than at 7 GeV.)' : '';
      let v: string;
      if (lat.id === 'aps') {
        v = `**The old APS: each sector turned the beam with just 2 sharp 4.5° bends.** Electrons with a little more energy (amber) swing wide of those with less (violet) — a couple of millimetres apart for every 1 % of energy (bottom strip, a simplified model). Each X-ray flash in a bend jolts an electron’s energy, and where the paths fan apart that jolt becomes a sideways wobble. Result: emittance ${P.fmtEps(eps)} and a beam size of ${P.APS.sigX} µm. **Slide to more bends →**${eNote}`;
      } else if (lat.id === 'apsu') {
        v = `**APS-U: 7 gentle bends of 1.1–1.6° per sector, plus 6 tiny backward bends (pink).** The energies now fan apart by at most ${per1} mm per 1 % — and mostly *between* the bends, away from where the X-ray flashes happen. The simple law estimates ${P.fmtEps(eps)}; the real ring reaches **42 pm·rad — 74× smaller than the old APS**, a beam narrower than a hair. Its backward bends are essential: without them the design only reached 67 pm·rad.${eNote}`;
      } else {
        v = `**What if each sector had ${M} equal bends of ${th.toFixed(2)}°?** (a simplified model) Gentler bends fan the energies apart less (at most ${per1} mm per 1 %), so each X-ray jolt shakes the beam less: the emittance falls as 1/M³, to about **${P.fmtEps(eps)} — ${gx(gain)}× smaller** than the old APS.`;
        v += M < 7 ? ' Keep going — APS-U uses 7.' : ' But every extra bend needs more, stronger focusing magnets squeezed into the same 27.6 m and makes the beam harder to keep stable; APS-U settled on 7.';
        v += eNote;
      }
      // ---------------- specialist
      const eMin1 = P.emittanceMin(M, E, 1);
      let s: string;
      if (lat.id === 'aps') {
        const fA = P.qualityFactor(P.APS.epsNat, 2, 7, 1);
        s = `**M = 2 — APS double-bend (Chasman–Green) achromat, E = ${E} GeV.** 4.5°/dipole (3.06 m, ${P.fieldOf(lat.elements.find((e) => e.kind === 'bend')!, E).toFixed(3)} T).${E === 7 ? '' : ` Scaling law at ${E} GeV: ${P.fmtEps(eps)}.`} Last 7-GeV lattice: natural ε_{0} = 2.5 nm·rad, effective 3.1 nm·rad (FDR Table 2.1) because the optics leaked η_{x} ≈ 0.17 m into the straights: σ_{x} = √(ε_{0}β_{x} + η²σ_{δ}²) = √(2.5 nm·19.5 m + (0.17 m·0.095 %)²) = 275 µm. DBA bound (J_{x} = 1) ${P.fmtEps(P.emittanceMin(2, 7, 1))} → F ≈ ${fA.toFixed(1)} × TME. η drawn: thin-lens achromat **model** (η = 0 in the straights; schematic magnet positions).`;
      } else if (lat.id === 'apsu') {
        const fA = P.qualityFactor(P.APS.epsNat, 2, 7, 1);
        const fU = P.qualityFactor(P.APSU.epsNat, 7, 6, P.APSU.Jx);
        s = `**M = 7 — APS-U hybrid 7BA + 6 reverse bends, E = ${E} GeV.** Law: ${P.fmtEps(eps)} from the APS ε_{eff} = 3.1 nm·rad, ${P.fmtEps(P.emittanceScaling(7, E, P.APS.epsNat))} from its natural 2.5 nm·rad; design ε_{0} = 41.7 pm·rad at 6 GeV (measured 44 ± 3 pm, flat, 50 mA). Same F/J_{x} as the old DBA (${(fU / P.APSU.Jx).toFixed(1)} vs ${fA.toFixed(1)} × TME), reached differently: the sextupole η bumps leave F ≈ ${fU.toFixed(1)} × TME, won back by J_{x} = 2.25 (67 pm without reverse bends). MBA bound (J_{x} = 1): ${P.fmtEps(eMin1)}. η_{x}: digitised FDR Fig. 2.2. Panel 2: σ = √(εβ), β_{x,y} = 5.26/2.38 m, ε_{x} = ε_{0}J_{x}/(J_{x} + κJ_{y}), ε_{y} = κε_{x} (srp2024 Table 5, zero current).`;
      } else {
        s = `**M = ${M} — model ${M}-bend achromat, θ = 9°/${M} = ${th.toFixed(3)}°, E = ${E} GeV.** Scaling law ε = 3.1 nm·rad·(2/M)³(E/7)² = ${P.fmtEps(eps)} (÷${gx(gain)} vs APS); MBA bound ε_{min} = C_{q}γ²θ³(M+1)/(12√15 J_{x}(M−1)) = ${P.fmtEps(eMin1)} (J_{x} = 1; Wolski 2015 eq. 180). η from a thin-lens achromat **model** (illustrative): η_{max} = ${etaMm.toFixed(0)} mm ∝ θ. Not shown: with cells ∝ 1/M the integrated quadrupole strength grows ∝ M, so natural chromaticity, sextupole strengths and the loss of dynamic aperture set the practical limit.`;
      }
      if (E === 7 && M !== 2) s += ' (E = 7 GeV: ×1.36 vs 6 GeV.)';
      return [v, s];
    }

    function refresh(): void {
      const [v, s] = captions();
      station.setCaption(v, s);
    }

    function changed(): void {
      sector.setLattice(P.latticeFor(st.M));
      sector.setEnergy(Ev());
      chart.set({ M: st.M, E: Ev(), depth });
      chartDirty = true;
      updateReadouts();
      refresh();
    }

    function preset(M: number, E: Energy): void {
      st.M = M;
      st.E = E;
      sM.set(M);
      tE.set(E);
      changed();
    }

    // The caption only grows while the layout/width stay the same: a shrinking caption would resize the canvases
    // (re-allocating their backing stores and rebuilding the sector drawing) every time M changes.
    let capMin = 0;
    // measured a frame later: a min-height written during the observer's own delivery re-triggers the layout
    // observers in the same frame (the browser's "ResizeObserver loop" error)
    let capRaf = 0;
    const capRo = new ResizeObserver(() => {
      cancelAnimationFrame(capRaf);
      capRaf = requestAnimationFrame(() => {
        const ch = station.caption.getBoundingClientRect().height;
        if (ch > capMin + 0.5) {
          capMin = Math.ceil(ch);
          station.caption.style.minHeight = `${capMin}px`;
        }
      });
    });
    capRo.observe(station.caption);
    const resetCaptionHeight = () => {
      capMin = 0;
      station.caption.style.minHeight = '';
    };

    // ------------------------------------------------------------ layout
    let layoutMode = '';
    let lastW = -1;
    let lastDepth: Depth | '' = '';
    const applyLayout = () => {
      const w = host.clientWidth || 900;
      if (Math.abs(w - lastW) > 0.5) {
        lastW = w;
        resetCaptionHeight();
      }
      const mode = w >= 1000 ? 'wide' : w >= 700 ? 'mid' : 'narrow';
      if (mode === layoutMode && depth === lastDepth) return;
      resetCaptionHeight();
      layoutMode = mode;
      lastDepth = depth;
      const spec = depth === 'specialist';
      const stack = mode !== 'wide';
      root.classList.toggle('stn-stack', stack);
      root.classList.toggle('stn-side', !stack);
      root.style.height = stack ? '100%' : '';
      root.style.overflowY = stack ? 'auto' : '';
      root.style.scrollbarWidth = stack ? 'thin' : '';
      controls.style.overflowY = stack ? 'visible' : '';
      const vs = visual.style;
      const v2 = visual2.style;
      const sw = wrapOf(cSector).style;
      for (const n of noteEls) n.style.gridColumn = stack ? '1 / -1' : '';
      if (mode === 'narrow') {
        // sector → main controls → beam → chart → remaining controls → caption
        visual2.append(wrapOf(cBeam), wrapOf(cChart));
        ctlA.append(guideEl, gBuild, gNum);
        root.style.gridTemplateRows = 'repeat(5, max-content)';
        root.append(visual, ctlA, visual2, controls, station.caption);
        vs.gridTemplateColumns = 'minmax(0,1fr)';
        vs.gridTemplateRows = spec ? '470px' : '450px';
        vs.minHeight = '';
        sw.gridColumn = '';
        v2.gridTemplateColumns = 'minmax(0,1fr)';
        v2.gridTemplateRows = '360px 270px';
        v2.minHeight = '';
        return;
      }
      visual.append(wrapOf(cBeam), wrapOf(cChart));
      controls.prepend(guideEl);
      guideEl.after(gBuild);
      gBuild.after(gNum);
      visual2.remove();
      ctlA.remove();
      root.append(visual, controls, station.caption);
      vs.gridTemplateColumns = 'minmax(0,1.1fr) minmax(0,1fr)';
      sw.gridColumn = '1 / -1';
      if (mode === 'wide') {
        root.style.gridTemplateRows = '';
        vs.gridTemplateRows = 'minmax(0,1.3fr) minmax(0,1fr)';
        vs.minHeight = '560px';
      } else {
        root.style.gridTemplateRows = 'repeat(3, max-content)';
        vs.gridTemplateRows = spec ? '420px 320px' : '400px 310px';
        vs.minHeight = '';
      }
    };
    const ro = new ResizeObserver(() => applyLayout());
    ro.observe(host);
    station.onDestroy(() => {
      ro.disconnect();
      capRo.disconnect();
      cancelAnimationFrame(capRaf);
    });

    // ------------------------------------------------------------ start
    applyDepthLabels();
    applyLayout();
    beam.set({ mode: st.mode, zoom: st.zoom });
    changed();

    loop(station, (dt) => {
      if (chartDirty) {
        chart.draw();
        chartDirty = false;
      }
      sector.frame(motion.on ? dt : 0);
      beam.frame(dt, !motion.on);
    });

    return {
      destroy: () => station.destroy(),
      setDepth: (d: Depth) => {
        depth = d;
        station.setDepth(d);
        sector.setDepth(d);
        beam.set({ depth: d });
        applyDepthLabels();
        applyLayout();
        changed();
      },
    };
  },
};
export default mod;

function setSliderLabel(input: HTMLInputElement, text: string): void {
  const l = input.parentElement?.querySelector('.stn-slider-label');
  if (l) l.textContent = text;
}

function setToggleLabels(wrap: HTMLElement, labels: string[]): void {
  wrap.querySelectorAll('button').forEach((b, i) => {
    if (labels[i]) b.textContent = labels[i];
  });
}
