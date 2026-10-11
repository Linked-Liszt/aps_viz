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
    const station = createStation(host, { color: accent, layout: 'side' });
    const { visual, controls, root } = station;
    root.classList.add('mba-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const st = { M: DEFAULTS.M, E: DEFAULTS.E, mode: DEFAULTS.mode, zoom: DEFAULTS.zoom };
    const Ev = () => Number(st.E);

    // ------------------------------------------------------------ canvases
    const cSector = canvas2d(visual, { label: '1 · One of 40 sectors (27.6 m), from above' });
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
      '**Drag the number of bends** (or click the chart). The ring is 40 identical sectors, each turning the beam by 9°. Split that turn into more, gentler bends and each electron is shaken less, so the beam squeezes smaller. Two settings are real machines: 2 bends (the old APS) and 7 (APS-U); the others are simplified models with equal bends.',
    );
    const guideEl = controls.lastElementChild as HTMLElement;

    const gBuild = group(controls, 'Build a ring');
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
        { value: '7', label: '7 GeV (old APS)' },
        { value: '6', label: '6 GeV (APS-U)' },
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
    bOld.title = 'Double-bend achromat, 7 GeV (1995–2023)';
    const bNew = button(presets, 'APS-U', () => preset(7, '6'));
    bNew.title = 'Hybrid seven-bend achromat with reverse bends, 6 GeV (2024–)';
    // reduced motion: panels 1 and 2 show still pictures (redrawn on every change) until Play is pressed
    const motion = motionGate(station, gBuild, { title: 'Your device asks for reduced motion, so the electrons hold still. Press to set them moving.' });

    const gNum = group(controls, 'Result');
    const rTheta = readout(gNum, 'Each bend turns');
    const rEps = readout(gNum, 'Emittance', { big: true, color: accent });
    /** the real APS-U (M = 7, 6 GeV) shows its design value above; this row keeps the scaling law's estimate */
    const rLaw = readout(gNum, 'Scaling-law estimate');
    const rGain = readout(gNum, 'Smaller than the old APS');
    const epsHint = document.createElement('div');
    epsHint.className = 'stn-hint';
    gNum.appendChild(epsHint);
    const rowLabel = (r: { el: HTMLElement }) => r.el.querySelector('.stn-readout-label') as HTMLElement;

    const gView = group(controls, 'End-on view (panel 2)');
    const tMode = toggle<Coupling>(gView, {
      label: 'APS-U beam shape',
      options: [
        { value: 'round', label: 'Round (users)', title: 'Full coupling κ = 1: εx = εy = 28.7 pm·rad (user operation since 2025)' },
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
        ? '*Round*, how APS-U runs for users since 2025: full coupling between the planes (κ = up–down ÷ sideways emittance = 1) gives 28.7 pm·rad in each, at zero beam current.'
        : '*Flat*: weak coupling (κ = 0.1) gives 39.7 pm·rad sideways and 3.98 pm·rad up–down, at zero beam current.';
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
      '**Why does bending shake the beam?** In every bend an electron flings out X-ray photons, each carrying off a random bit of its energy. Electrons of different energy follow different paths — the energy fan, or *dispersion* (amber vs violet) — so each loss leaves the electron off its new path, wobbling sideways (*quantum excitation*). Gentler bends shrink both the fan and the jolts: the beam’s *emittance* (its size × angle spread) scales as the bend angle cubed, so halving the angle shrinks it 8×. Going from 2 to 7 bends gains (7/2)³ ≈ 43×; lowering the energy from 7 to 6 GeV gains another (6/7)², ×0.73.',
    );
    note(
      controls,
      station,
      '**The tricks.** APS-U’s longest bends are not uniform: their field steps up or down in five sections (the first from 0.65 T to 0.14 T), strongest where the energy fan is narrowest. Six slightly *backward* bends (pink: focusing magnets shifted off-centre, each bending the beam back by 0.07–0.31°) pull the fan in further. Together with focusing built into the main bends, the backward bends also shift radiation damping toward the horizontal plane (damping partition Jₓ ≈ 2.25 instead of 1), dividing the emittance by 2.25 at the cost of a wider energy spread (0.136 %). Without the backward bends the design reached only 67 pm·rad; with them, 42.',
    );
    note(
      controls,
      station,
      '**The catch.** Squeezing this hard takes very strong focusing magnets, and the even stronger *sextupoles* that correct how their focusing varies with energy leave a stable zone (the *dynamic aperture*) only about ±1.5 mm wide at injection — too small to pour new electrons into a stored bunch. So APS-U *swaps*: about every 20 seconds at 200 mA, the most depleted bunch is kicked out and a fresh, full one takes its place. Electrons in such dense bunches also knock each other out (*Touschek scattering*: a 2–4 h lifetime, against 8 h at the old APS), so a superconducting cavity stretches each bunch 2–4× longer, which roughly doubled that lifetime in measurements.',
    );
    const noteEls = [...controls.querySelectorAll<HTMLElement>('.stn-note')];

    // ------------------------------------------------------------ text
    function updateReadouts(): void {
      const lat = P.latticeFor(st.M);
      const E = Ev();
      const eps = P.emittanceScaling(st.M, E);
      if (lat.id === 'apsu') {
        const b = P.bendStats(lat);
        rTheta.set(`${b.minDeg.toFixed(2)}–${b.maxDeg.toFixed(2)}°`);
      } else rTheta.set(`${(P.SECTOR_BEND_DEG / st.M).toFixed(st.M >= 8 ? 3 : 2)}°`);
      // the real ring (7 bends, 6 GeV): its design emittance is the headline; the law's estimate goes below it
      const design = lat.id === 'apsu' && E === P.APSU.E;
      const shown = design ? P.APSU.epsNat : eps;
      const anchor = lat.id === 'aps' && E === 7;
      rowLabel(rEps).textContent = design ? 'Emittance (design)' : anchor ? 'Emittance (effective)' : 'Emittance (scaling law)';
      rEps.set(P.fmtEps(shown));
      rLaw.set(P.fmtEps(eps));
      rLaw.el.style.display = design ? '' : 'none';
      const g = P.APS.epsX / shown;
      rGain.set(g < 1.05 && g > 0.95 ? '—' : g >= 1 ? `${g < 10 ? g.toFixed(1) : Math.round(g)}×` : `${(1 / g).toFixed(2)}× larger`);
      const natural = P.fmtEps(P.emittanceScaling(st.M, E, P.APS.epsNat));
      epsHint.innerHTML = md(
        `Emittance = beam size × angle spread (1 pm·rad = 10⁻¹² m·rad).${design ? ' APS-U design value: 41.7 pm·rad.' : ''} The scaling law ε ∝ E²/M³ (E: electron energy, M: bends per sector) starts from the old APS’s effective 3.1 nm·rad${anchor ? ' (its natural emittance was 2.5 nm·rad)' : `; starting from its natural 2.5 nm·rad instead, it gives ${natural}`}.`,
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
      const eNote = E === 7 ? ' (At 6 GeV, the APS-U energy, it would be another 27 % smaller.)' : '';
      const fan = `Electrons with a little more energy (amber) swing wide of those with less (violet) — up to ${per1} mm apart for every 1 % of energy (bottom strip; simplified model). Each photon emitted in a bend jolts an electron’s energy, and where the paths fan apart that jolt becomes a sideways wobble.`;
      if (lat.id === 'aps') {
        if (E === 7)
          return `**The old APS: each sector turned the beam with just 2 sharp 4.5° bends.** ${fan} Result: a beam ${P.APS.sigX} µm wide (rms) and an emittance of 3.1 nm·rad — an *effective* value: the lattice itself made 2.5 nm·rad, and the fan leaking into the straight sections widened the beam. **Slide to more bends →**`;
        return `**The old APS lattice run at 6 GeV (what if): 2 sharp 4.5° bends per sector.** ${fan} At 6 GeV the scaling law gives ${P.fmtEps(eps)}, 27 % less than the real 3.1 nm·rad at 7 GeV. **Slide to more bends →**`;
      }
      if (lat.id === 'apsu') {
        const b = P.bendStats(lat);
        const deg = `${b.minDeg.toFixed(2)}–${b.maxDeg.toFixed(2)}°`;
        if (E === 7)
          return `**The APS-U lattice run at 7 GeV (what if).** Its 7 gentle bends (${deg}) and 6 backward bends (pink) fan the energies apart by at most ${per1} mm per 1 %. The simple law gives ${P.fmtEps(eps)} here, 36 % more than at 6 GeV: emittance grows with the square of the electron energy, one reason APS-U runs at 6 GeV. There its design reaches **41.7 pm·rad, 74× smaller than the old APS** (67 pm·rad without the backward bends).`;
        return `**APS-U: 7 gentle bends of ${deg} per sector, plus 6 tiny backward bends (pink).** The energies now fan apart by at most ${per1} mm per 1 % — and mostly *between* the bends, away from where photons are emitted. The design reaches **41.7 pm·rad, 74× smaller than the old APS** (measured: 44 ± 3 pm·rad in flat mode at 50 mA), for a beam narrower than a hair. The simple law gives ${P.fmtEps(eps)}; it lands this close only because backward bends and gradient magnets make up for a less ideal cell — without the backward bends the design reached just 67 pm·rad.`;
      }
      let v = `**What if each sector had ${M} equal bends of ${th.toFixed(2)}°?** (a simplified model) Gentler bends fan the energies apart less — at most ${per1} mm per 1 % — so each photon’s jolt shakes the beam less: the emittance falls as 1/M³, to about **${P.fmtEps(eps)}, ${gx(gain)}× smaller** than the old APS. With equal bends and no damping tricks, no cell design could go below ${P.fmtEps(P.emittanceMin(M, E, 1))} (dotted, Jₓ = 1).`;
      v += M < 7 ? ' Keep going — APS-U uses 7.' : ' But more bends need more, stronger focusing magnets in the same 27.6 m, and the strong sextupoles these require shrink the stable zone for the beam; APS-U settled on 7.';
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
