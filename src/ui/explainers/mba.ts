/**
 * Station "mba". "Electron emittance and ring geometry" compares the APS-U multi-bend achromat with the old
 * double-bend ring. Horizontal emittance is about 70× lower after the upgrade.
 *
 * Panels
 *   1. One of the ring's 40 sectors seen from above (./mba/sector.ts): reference orbit through the real magnet
 *      layout (old APS DBA: schematic positions, real 4.5°/3.06 m dipoles; APS-U H7BA: FDR 2019 Fig. 2.2 layout and
 *      Table 2.4 bend angles incl. 5-step longitudinal-gradient dipoles and the Q4/Q5/Q8 reverse bends; other M:
 *      equal-dipole model). Electron positions are x = η(s)·δ + x_β. Their energy-dependent offsets follow the dispersion
 *      η(s). Electrons emit photons in the bends at rate ∝ B. Each emission changes their betatron amplitude by
 *      Δx_β = η·Δδ, called quantum excitation. Radiation damping reduces this amplitude. Below: η_x(s) along the sector.
 *   2. The beam end-on at an ID source point, to scale against a 70-µm hair (./mba/beam.ts):
 *      APS 275 × 10 µm rms (FDR 2019 Table 2.1); APS-U 12.3 × 8.3 µm (round, κ = 1) or 14.5 × 3.1 µm (flat, κ = 0.1),
 *      zero current (Storage Ring Parameters 2024, Table 5). All from the facility research dossier.
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
  title: "Electron emittance and ring geometry",
  subtitle: "Compare electron emittance when each sector turns the beam through more bends with smaller angles.",
  mount(host, ctx) {
    const accent = ctx.color || '#5cd3ff';
    const station = createStation(host, { color: accent, layout: 'side' });
    const { visual, controls, root } = station;
    root.classList.add('mba-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const st = { M: DEFAULTS.M, E: DEFAULTS.E, mode: DEFAULTS.mode, zoom: DEFAULTS.zoom };
    const Ev = () => Number(st.E);

    // ------------------------------------------------------------ canvases
    const cSector = canvas2d(visual, { label: "1 · Sector · 27.6 m · top view" });
    const visual2 = document.createElement('div');
    visual2.className = 'stn-visual';
    const cBeam = canvas2d(visual, { label: '2 · The beam end-on at an undulator, to scale' });
    const cChart = canvas2d(visual, {});
    cChart.canvas.setAttribute('aria-label', 'Chart: emittance versus number of bends per sector');
    const wrapOf = (c: Canvas2D) => c.canvas.parentElement as HTMLElement;

    const sector = new SectorView(cSector, accent, P.latticeFor(st.M), Ev());
    const beam = new BeamView(cBeam, accent);
    let chartDirty = true;
    const chart = new EmittanceChart(cChart, accent, (M) => {
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
      "Change the number of bends with the slider or chart. The ring has 40 identical sectors, each with a net turn of 9°. More bends reduce the angle of each bend and the quantum excitation of electron motion. The settings with 2 and 7 bends represent the old APS and APS-U. Other settings use simplified equal-bend models.",
    );
    const guideEl = controls.lastElementChild as HTMLElement;

    const gBuild = group(controls, "Ring geometry");
    const sM = slider(gBuild, {
      label: 'Bends per sector, M',
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
        { value: '7', label: "7 GeV · old APS" },
        { value: '6', label: "6 GeV · APS-U" },
      ],
      value: st.E,
      onChange: (v) => {
        st.E = v;
        changed();
      },
    });
    const presets = document.createElement('div');
    presets.className = 'mba-presets';
    gBuild.appendChild(presets);
    const bOld = button(presets, 'Old APS', () => preset(2, '7'));
    bOld.title = "Double-bend achromat at 7 GeV, from 1995 to 2023";
    const bNew = button(presets, 'APS-U', () => preset(7, '6'));
    bNew.title = "Hybrid seven-bend achromat with reverse bends at 6 GeV, since 2024";
    // reduced motion: panels 1 and 2 show still pictures (redrawn on every change) until Play is pressed
    const motion = motionGate(station, gBuild, { title: "Reduced motion is enabled on your device. Electron positions remain static. Press to animate them." });

    const gNum = group(controls, 'Result');
    const rTheta = readout(gNum, "Angle per bend");
    const rEps = readout(gNum, 'Emittance', { big: true, color: accent });
    /** the real APS-U (M = 7, 6 GeV) shows its design value above; this row keeps the scaling law's estimate */
    const rLaw = readout(gNum, 'Scaling-law estimate');
    const rGain = readout(gNum, 'Smaller than the old APS');
    const epsHint = document.createElement('div');
    epsHint.className = 'stn-hint';
    gNum.appendChild(epsHint);
    const rowLabel = (r: { el: HTMLElement }) => r.el.querySelector('.stn-readout-label') as HTMLElement;

    const gView = group(controls, "End-on beam view · panel 2");
    const tMode = toggle<Coupling>(gView, {
      label: 'APS-U beam shape',
      options: [
        { value: 'round', label: "Round user mode", title: "Full coupling κ = 1 gives εx = εy = 28.7 pm·rad. User operation has used this mode since 2025." },
        { value: 'flat', label: 'Flat', title: 'Low coupling κ = 0.1: εx = 39.7, εy = 3.98 pm·rad' },
      ],
      value: st.mode,
      onChange: (v) => {
        st.mode = v;
        beam.set({ mode: v });
        modeHint.innerHTML = md(modeText());
      },
    });
    const modeHint = document.createElement('div');
    modeHint.className = 'stn-hint';
    gView.appendChild(modeHint);
    const modeText = () =>
      st.mode === 'round'
        ? "Round-beam user operation has used full coupling since 2025. Coupling κ is vertical divided by horizontal emittance. At κ = 1, zero-current values are 28.7 pm·rad in each plane."
        : "Flat-beam coupling is κ = 0.1. Zero-current emittance is 39.7 pm·rad horizontally and 3.98 pm·rad vertically.";
    modeHint.innerHTML = md(modeText());
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
      modeHint.innerHTML = md(modeText());
      changed();
    });

    note(
      controls,
      station,
      "An electron loses a random amount of energy when it emits a photon in a bend. Paths depend on electron energy, a property called dispersion. After emission, the electron oscillates about the path for its new energy. These oscillations are quantum excitation. Smaller bend angles reduce dispersion and excitation. Emittance, the product of beam size and angular spread, scales as bend angle cubed. Halving the angle reduces emittance 8×. Increasing from 2 to 7 bends gives (7/2)³ ≈ 43×, and reducing electron energy from 7 to 6 GeV gives another factor of (6/7)² = 0.73.",
    );
    note(
      controls,
      station,
      "The longest APS-U bends have fields that change in five sections, from 0.65 T to 0.14 T in the first bend. The strongest fields occur where dispersion is lowest. Six reverse bends are formed by offset focusing magnets, each with a reverse angle of 0.07 to 0.31°. They further reduce dispersion. Reverse bends and focusing in the main bends increase horizontal radiation damping, with damping partition Jₓ ≈ 2.25 rather than 1. This reduces emittance by 2.25 but increases relative energy spread to 0.136 %. Design emittance was 67 pm·rad without reverse bends and 42 pm·rad with them.",
    );
    note(
      controls,
      station,
      "Strong focusing requires strong sextupoles to correct energy-dependent focusing. The region of stable transverse motion, called the dynamic aperture, is only about ±1.5 mm at injection. This is too small to add electrons directly to a stored bunch. APS-U uses swap-out injection: about every 20 seconds at 200 mA, the most depleted bunch is removed and replaced with a full bunch. Dense bunches also lose electrons through Touschek scattering, with a 2 to 4 h lifetime compared with 8 h at the old APS. A superconducting cavity lengthens bunches by 2 to 4× to reduce these losses. Measurements showed roughly twice the lifetime.",
    );
    const noteEls = [...controls.querySelectorAll<HTMLElement>('.stn-note')];

    // ------------------------------------------------------------ text
    function updateReadouts(): void {
      const lat = P.latticeFor(st.M);
      const E = Ev();
      const eps = P.emittanceScaling(st.M, E);
      if (lat.id === 'apsu') {
        const b = P.bendStats(lat);
        rTheta.set(`${b.minDeg.toFixed(2)} to ${b.maxDeg.toFixed(2)}°`);
      } else rTheta.set(`${(P.SECTOR_BEND_DEG / st.M).toFixed(st.M >= 8 ? 3 : 2)}°`);
      // the real ring (7 bends, 6 GeV): its design emittance is the headline; the law's estimate goes below it
      const design = lat.id === 'apsu' && E === P.APSU.E;
      const shown = design ? P.APSU.epsNat : eps;
      const anchor = lat.id === 'aps' && E === 7;
      rowLabel(rEps).textContent = design ? "Emittance · design" : anchor ? "Emittance · effective" : "Emittance · scaling law";
      rEps.set(P.fmtEps(shown));
      rLaw.set(P.fmtEps(eps));
      rLaw.el.style.display = design ? '' : 'none';
      const g = P.APS.epsX / shown;
      rGain.set(g < 1.05 && g > 0.95 ? '~1×' : g >= 1 ? `${g < 10 ? g.toFixed(1) : Math.round(g)}×` : `${(1 / g).toFixed(2)}× larger`);
      const natural = P.fmtEps(P.emittanceScaling(st.M, E, P.APS.epsNat));
      epsHint.innerHTML = md(
        `Emittance is beam size × angular spread; 1 pm·rad = 10⁻¹² m·rad.${design ? ' APS-U design emittance is 41.7 pm·rad.' : ''} The scaling law is ε ∝ E²/M³, where E is electron energy and M is bends per sector. Its starting value is the old APS effective emittance of 3.1 nm·rad${anchor ? '. Natural emittance was 2.5 nm·rad' : `. Starting from natural emittance of 2.5 nm·rad instead gives ${natural}`}.`,
      );
      bOld.setAttribute('aria-pressed', String(st.M === 2 && st.E === '7'));
      bNew.setAttribute('aria-pressed', String(st.M === 7 && st.E === '6'));
    }

    function caption(): string {
      const M = st.M;
      const E = Ev();
      const lat = P.latticeFor(M);
      const eps = P.emittanceScaling(M, E);
      const gain = P.APS.epsX / eps;
      const etaMm = P.etaMax(lat) * 1000;
      const per1 = (etaMm / 100).toFixed(etaMm < 100 ? 2 : 1);
      const th = P.SECTOR_BEND_DEG / M;
      const gx = (x: number) => (x < 10 ? x.toFixed(1) : Math.round(x).toString());
      const eNote = E === 7 ? " At the APS-U energy of 6 GeV, emittance would be another 27 % smaller." : '';
      const fan = `Higher-energy electrons follow the amber paths, separated from lower-energy violet paths by up to ${per1} mm per 1 % energy difference. The lower strip displays this simplified dispersion model. Photon emission changes electron energy, and dispersion converts that change into transverse oscillation.`;
      if (lat.id === 'aps') {
        if (E === 7)
          return `The old APS had 2 bends of 4.5° per sector. ${fan} Its beam had rms horizontal width ${P.APS.sigX} µm and effective emittance 3.1 nm·rad. Natural lattice emittance was 2.5 nm·rad; residual dispersion in the straight sections increased the beam width. Increase the bend count to compare.`;
        return `This hypothetical old APS lattice operates at 6 GeV with 2 bends of 4.5° per sector. ${fan} The scaling-law emittance is ${P.fmtEps(eps)}, 27 % below the actual 3.1 nm·rad at 7 GeV. Increase the bend count to compare.`;
      }
      if (lat.id === 'apsu') {
        const b = P.bendStats(lat);
        const deg = `${b.minDeg.toFixed(2)} to ${b.maxDeg.toFixed(2)}°`;
        if (E === 7)
          return `This hypothetical APS-U lattice operates at 7 GeV. It has 7 main bends of ${deg} and 6 reverse bends, marked pink. Dispersion is at most ${per1} mm per 1 % energy difference. The scaling-law emittance is ${P.fmtEps(eps)}, 36 % above the 6 GeV value because emittance scales with squared electron energy. At 6 GeV, design emittance is 41.7 pm·rad, 74× below the old APS value. Without reverse bends, it was 67 pm·rad.`;
        return `APS-U has 7 main bends of ${deg} per sector and 6 reverse bends, marked pink. Dispersion is at most ${per1} mm per 1 % energy difference and is concentrated between the radiating bends. Design emittance is 41.7 pm·rad, 74× below the old APS value. Measured flat-beam emittance was 44 ± 3 pm·rad at 50 mA. The simple scaling law gives ${P.fmtEps(eps)}. Its agreement depends on reverse bends and gradient fields compensating for the less ideal cell geometry. Without reverse bends, design emittance was 67 pm·rad.`;
      }
      let v = `This simplified sector has ${M} equal bends of ${th.toFixed(2)}°. Smaller angles reduce dispersion, here at most ${per1} mm per 1 % energy difference, and reduce quantum excitation from photon emission. Emittance falls as 1/M³ to ${P.fmtEps(eps)}, ${gx(gain)}× below the old APS value. The theoretical minimum for equal bends and damping partition Jₓ = 1 is ${P.fmtEps(P.emittanceMin(M, E, 1))}, shown by the dotted curve.`;
      v += M < 7 ? " APS-U uses 7 main bends." : " More bends require more focusing in the same 27.6 m. The stronger sextupoles needed for correction reduce the dynamic aperture. APS-U uses 7 main bends.";
      return v + eNote;
    }

    function refresh(): void {
      station.setCaption(caption());
    }

    function changed(): void {
      sector.setLattice(P.latticeFor(st.M));
      sector.setEnergy(Ev());
      chart.set({ M: st.M, E: Ev() });
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
    const applyLayout = () => {
      const w = host.clientWidth || 900;
      if (Math.abs(w - lastW) > 0.5) {
        lastW = w;
        resetCaptionHeight();
      }
      const mode = w >= 1000 ? 'wide' : w >= 700 ? 'mid' : 'narrow';
      if (mode === layoutMode) return;
      resetCaptionHeight();
      layoutMode = mode;
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
        vs.gridTemplateRows = '470px';
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
        vs.minHeight = '545px';
      } else {
        root.style.gridTemplateRows = 'repeat(3, max-content)';
        vs.gridTemplateRows = '420px 320px';
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

    return { destroy: () => station.destroy() };
  },
};
export default mod;
