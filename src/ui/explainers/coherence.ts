/**
 * Station "coherence" — CHEX (28-ID) and the facility story: "How coherent is the light?"
 *
 * Two linked views:
 *   1. Energy chart: coherent fraction f = f_x·f_y of undulator radiation vs photon energy (5–110 keV, log–log)
 *      for the pre-upgrade APS (7 GeV, 3.1 nm·rad) and APS-U (6 GeV, round or flat beam), the APS-U/APS gain,
 *      and (specialist) electron emittances against the photon diffraction limit λ/4π. Drag to pick an energy.
 *   2. Young's double-slit test at a distance Z from the source: the Gaussian-Schell-model coherence length
 *      ξ(Z) = q·Σ(Z), q = 2f/√(1−f²) (→ λZ/(2πΣ) in the far field) sets how strongly two slits a distance d apart
 *      are in step, |μ₁₂| = exp(−d²/2ξ²); photons build up the partially coherent fringe pattern on a detector.
 *
 * Equations, approximations, parameter values and sources: ./coherence/physics.ts (header comment). In brief:
 *   σ_r = √(2λL)/4π, σ_r' = √(λ/2L) (Kim 1989), Σ² = σ_e² + σ_r², Σ'² = σ_e'² + σ_r'², f_i = (λ/4π)/(Σ_iΣ'_i);
 *   L = 2.4 m; APS: FDR 2019 Table 2.1; APS-U: storage-ring parameters 2024 Table 5 (zero current);
 *   idealised: no energy spread, Gaussian beams, unfocused beam — said so in the specialist text, together with
 *   the SRW design values (FDR Ch. 4) that show the APS-U curves are an upper bound at high energy.
 * CHEX energies (15/25/35/75/105 keV) and instrument distances (35.5–72 m) from the chex research dossier.
 */
import type { ExplainerModule } from './registry';
import type { Depth } from '../../app/store';
import { button, canvas2d, createStation, group, loop, md, motionGate, note, readout, slider, toggle, type Canvas2D } from './kit';
import * as P from './coherence/physics';
import { ENVELOPE, seriesCurve } from './brightness/physics';
import { approxGain } from './brightness/format';
import { EnergyChart, E_MAX, E_MIN, fmtGain, fmtInN, fmtPct } from './coherence/chart';
import { YoungView, fmtUm, type Plane } from './coherence/young';

type Mode = 'round' | 'flat';

/**
 * Design coherent-flux gain APS-U/APS at E keV (NaN outside 1–100 keV). Coherent flux F_c = B·(λ/2)², so at equal λ
 * its ratio is the brightness ratio: IPAC'21 Fig. 1 envelope (best undulator at each energy, digitized ±20 % per
 * point, ~±30 % on the ratio; the dossier's coherent-flux columns agree within that). It includes 2× current and the
 * new undulators, unlike the coherent *fraction* this station models.
 */
const envOld = seriesCurve(ENVELOPE.old);
const envNew = seriesCurve(ENVELOPE.neu[0]);
const coherentFluxGain = (E: number) => envNew(E) / envOld(E);

const DEFAULTS = { E: 25, Z: 45.5, dUm: 10, plane: 'x' as Plane, mode: 'round' as Mode };

const CSS = `
.coh-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.coh-chips .stn-btn { padding: 4px 8px; font-size: 11.5px; border-radius: 7px; font-variant-numeric: tabular-nums; }
.coh-chips .stn-btn[aria-pressed=true] { background: color-mix(in oklab, var(--c, #5cd3ff) 26%, #0b111b); border-color: var(--c, #5cd3ff); color: #fff; }
.coh-chips-label { font-size: 11.5px; color: #8394a9; margin-bottom: -4px; }
.coh-root .stn-readout-value { white-space: nowrap; }
`;

const mod: ExplainerModule = {
  title: 'How coherent is the light?',
  subtitle: 'Slide the X-ray energy and see how much of the beam marches in step — before and after the upgrade.',
  mount(host, ctx) {
    const accent = ctx.color || '#5cd3ff';
    const station = createStation(host, { depth: ctx.depth, color: accent, layout: 'side' });
    const { visual, controls } = station;
    const root = station.root;
    root.classList.add('coh-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    // ------------------------------------------------------------ state
    const st = { E: DEFAULTS.E, Z: DEFAULTS.Z, d: DEFAULTS.dUm * 1e-6, plane: DEFAULTS.plane, mode: DEFAULTS.mode };
    let depth: Depth = ctx.depth;
    /** on the CHEX (28-ID) panel: its stations, energy band and science; elsewhere (the upgrade story) stay generic */
    const chex = ctx.beamlineId === 'chex';

    // ------------------------------------------------------------ canvases
    const cChart = canvas2d(visual, { label: '' });
    const visual2 = document.createElement('div');
    visual2.className = 'stn-visual';
    const cYoung = canvas2d(visual, { label: '' });
    const wrapOf = (c: Canvas2D) => c.canvas.parentElement as HTMLElement;
    const labelOf = (c: Canvas2D) => wrapOf(c).querySelector('.stn-canvas-label') as HTMLElement | null;
    // canvas2d only creates the label element when a label is given — create both up front
    for (const c of [cChart, cYoung]) {
      if (!labelOf(c)) {
        const tag = document.createElement('div');
        tag.className = 'stn-canvas-label';
        wrapOf(c).appendChild(tag);
      }
    }
    const chartTitles: [string, string] = ['1 · How much of the beam is in step?', '1 · Coherent fraction vs photon energy'];
    const youngTitles: [string, string] = ["2 · Test it: Young's two slits", "2 · Young's double slit · partial coherence"];

    // kit canvases default to touch-action:none; in the stacked (phone) layout that would trap vertical swipes
    cChart.canvas.style.touchAction = 'pan-y';
    cYoung.canvas.style.touchAction = 'auto';

    let chartDirty = true;
    const chart = new EnergyChart(cChart, accent, (E) => setE(E, true));
    const young = new YoungView(cYoung, accent);
    cChart.onResize(() => {
      chartDirty = true;
    });
    cYoung.onResize(() => {
      young.invalidate();
      young.draw();
    });

    // ------------------------------------------------------------ controls
    const ctlA = document.createElement('div');
    ctlA.className = 'stn-controls';
    ctlA.style.gridTemplateColumns = 'minmax(0,1fr)';
    ctlA.style.overflowY = 'visible';

    note(
      controls,
      station,
      '**Drag the energy** (or the chart) and watch the detectors: stripes appear only where the light at the two slits marches **in step**.',
      `Drag E (slider or chart)${chex ? ' or pick a CHEX station' : ''}. The bell on each slit mask is |\u2060μ(Δx)| about slit 1; detectors accumulate single photons from the partially coherent far-field pattern (equal photon rate on both: brightness differences not shown).`,
    );
    const guideEl = controls.lastElementChild as HTMLElement;

    const gE = group(controls, 'X-ray energy');
    const sE = slider(gE, {
      label: 'Energy',
      min: E_MIN,
      max: E_MAX,
      log: true,
      value: st.E,
      format: (v) => `${v.toFixed(1)} keV`,
      onInput: (v) => setE(v, false),
    });
    const chipsLabel = document.createElement('div');
    chipsLabel.className = 'coh-chips-label';
    const chips = document.createElement('div');
    chips.className = 'coh-chips';
    chips.setAttribute('role', 'group');
    if (chex) gE.append(chipsLabel, chips);
    const chipBtns = (chex ? P.CHEX_STOPS : []).map((s) => {
      const b = button(chips, `${s.station.slice(-1)} · ${s.E}`, () => {
        st.E = s.E;
        st.Z = s.Z;
        sE.set(st.E);
        sZ.set(st.Z);
        changed(true);
      });
      b.title = `${s.station}: ${s.E} keV, instrument ${s.Z} m from the source (${s.what})`;
      return { b, s };
    });

    const gS = group(controls, "Young's double-slit test");
    const sD = slider(gS, {
      label: 'Slit spacing d',
      min: 1,
      max: 100,
      log: true,
      value: DEFAULTS.dUm,
      format: (v) => (v < 10 ? `${v.toFixed(1)} µm` : `${v.toFixed(0)} µm`),
      onInput: (v) => {
        st.d = v * 1e-6;
        changed(false);
      },
    });
    const sZ = slider(gS, {
      label: 'Distance from source Z',
      min: 20,
      max: 80,
      step: 0.5,
      value: st.Z,
      format: (v) => `${v.toFixed(1)} m`,
      onInput: (v) => {
        st.Z = v;
        changed(false);
      },
    });
    const tPlane = toggle<Plane>(gS, {
      label: 'Slits placed',
      options: [
        { value: 'x', label: '↔ sideways' },
        { value: 'y', label: '↕ up–down' },
      ],
      value: st.plane,
      onChange: (v) => {
        st.plane = v;
        applyDepthLabels();
        changed(true);
      },
    });
    const planeWrap = gS.lastElementChild as HTMLElement;
    // reduced motion: the detectors show a still picture (refilled when a parameter changes) instead of live photons
    const motion = motionGate(station, gS, { title: 'Your device asks for reduced motion, so the detectors show a still picture. Press to watch the photons arrive.' });

    const gB = group(controls, 'APS-U beam shape');
    const tMode = toggle<Mode>(gB, {
      options: [
        { value: 'round', label: 'Round (user mode)', title: 'Full coupling, κ = 1: εx = εy = 28.7 pm (how APS-U runs for users since 2025)' },
        { value: 'flat', label: 'Flat', title: 'Low coupling, κ = 0.1: εx = 39.7 pm, εy = 4.0 pm' },
      ],
      value: st.mode,
      onChange: (v) => {
        st.mode = v;
        changed(true);
      },
    });
    const modeWrap = gB.lastElementChild as HTMLElement;

    const resetRow = document.createElement('div');
    resetRow.style.display = 'flex';
    resetRow.style.gap = '8px';
    controls.appendChild(resetRow);
    button(resetRow, '↺ Reset', () => {
      st.E = DEFAULTS.E;
      st.Z = DEFAULTS.Z;
      st.d = DEFAULTS.dUm * 1e-6;
      st.plane = DEFAULTS.plane;
      st.mode = DEFAULTS.mode;
      sE.set(st.E);
      sZ.set(st.Z);
      sD.set(DEFAULTS.dUm);
      tPlane.set(st.plane);
      tMode.set(st.mode);
      changed(true);
    });
    const gN = group(controls, 'Numbers');
    const rOld = readout(gN, '');
    const rNew = readout(gN, '', { color: accent });
    const rGain = readout(gN, '', { big: true, color: accent });
    const rFlux = readout(gN, '', { color: accent });
    rFlux.el.title =
      'Design coherent flux, APS-U ÷ APS (IPAC’21 envelope, best undulator at each energy, ±30 %): the larger in-step share × twice the current × better undulators';
    const rXi = readout(gN, '');
    const rowLabel = (r: { el: HTMLElement }) => r.el.querySelector('.stn-readout-label') as HTMLElement;
    // only touch the DOM when a readout's text actually changes
    for (const r of [rOld, rNew, rGain, rFlux, rXi]) {
      const raw = r.set.bind(r);
      let last = '';
      r.set = (v: string) => {
        if (v !== last) {
          last = v;
          raw(v);
        }
      };
    }

    note(
      controls,
      station,
      '**Why does the gain grow with energy?** To keep light in step, the beam must be about as small and straight as the waves are short. At low energy (long waves) the new beam is already near that limit, so its extra smallness only partly shows. At high energy (short waves) both beams are far too big, and the new beam’s much smaller size counts in full.',
      '**Why the gain grows with E.** Per plane f = (λ/4π)/ΣΣ′ ≤ (λ/4π)/(ε + λ/4π), with equality for a matched β = L/2π. APS (ε_{x} 3.1 nm) is emittance-dominated at every hard-X-ray energy, so f_{x} ∝ λ; APS-U (29–40 pm) is only 1.5–4× above λ/4π (20–10 pm) at 5–10 keV, so its f falls more slowly at first and the ratio climbs toward Π ε_{APS}/ε_{APS-U} (≈ ×130 round, ×670 flat for the σ·σ′ used here) as λ/4π shrinks.',
    );
    note(
      controls,
      station,
      chex
        ? '**Why CHEX cares.** CHEX mostly uses 15–105 keV X-rays, which pass through the walls of real growth reactors. Before the upgrade only about 1 X-ray in 10,000 at 25 keV was in step; now about 1 in 125 is, enough to film the speckle of atoms rearranging while a crystal grows.'
        : '**Why it matters.** In-step X-rays make speckle and interference patterns that show how atoms and tiny structures are arranged and how they move: the basis of techniques such as XPCS and coherent imaging. High-energy X-rays pass through real devices and reactors, but they were the hardest to keep in step, so that is where the upgrade helps most.',
      `**Caveats (illustrative).** Zero current, no energy spread: σ_{δ} = 0.136 % inflates σ_{r}′ by Q_{a}(2πnNσ_{δ}) (Tanaka & Kitamura 2009), ≈ 1.7× already at n = 5 (${chex ? 'CHEX 25 keV, N = 74' : '25 keV on a 2.07 m, 2.8 cm undulator, N = 74'}), more at 75–105 keV, and more for APS-U than for APS. Onuki–Elleaume / T–K fits give σ_{r} ≈ 2× Kim’s. SRW design studies of two APS-U beamlines (FDR Ch. 4) find 0.5–0.9 % at 25 keV vs 0.8–2.2 % here: read the APS-U curves as an upper bound. Coherent-*flux* gains also include 2× current and optimised undulators (FDR Table 1.1: ×540 at 20 keV). ${chex ? 'CHEX’s interim 2.07 m HPMUs' : 'A 2.07 m undulator'}: 4–11 % lower f than L = 2.4 m. Ideal optics conserve f and ξ/beam size.`,
    );

    // ------------------------------------------------------------ depth-dependent labels
    const applyDepthLabels = () => {
      const spec = depth === 'specialist';
      const lc = labelOf(cChart);
      if (lc) lc.textContent = spec ? chartTitles[1] : chartTitles[0];
      const ly = labelOf(cYoung);
      if (ly) ly.textContent = spec ? youngTitles[1] : youngTitles[0];
      cChart.canvas.setAttribute('aria-label', spec ? chartTitles[1] : chartTitles[0]);
      cYoung.canvas.setAttribute('aria-label', spec ? youngTitles[1] : youngTitles[0]);
      (gE.querySelector('.stn-group-title') as HTMLElement).textContent = spec ? 'Photon energy' : 'X-ray energy';
      chipsLabel.textContent = spec ? 'CHEX fixed-energy stations, keV (sets E and Z):' : 'Jump to a CHEX station (keV):';
      setSliderLabel(sD.input, spec ? 'Slit separation d' : 'Slit spacing');
      setSliderLabel(sZ.input, spec ? 'Distance Z from source' : 'Distance from the source');
      setToggleLabels(planeWrap, spec ? ['Horizontal x', 'Vertical y'] : ['↔ sideways', '↕ up–down']);
      const pl = planeWrap.querySelector('.stn-slider-label');
      if (pl) pl.textContent = spec ? 'Plane tested' : 'Slits placed';
      setToggleLabels(modeWrap, spec ? ['Round κ=1 (users)', 'Flat κ=0.1'] : ['Round (user mode)', 'Flat']);
      (gB.querySelector('.stn-group-title') as HTMLElement).textContent = spec ? 'APS-U coupling' : 'APS-U beam shape';
      rowLabel(rOld).innerHTML = md(spec ? 'f_{x}·f_{y}, APS' : 'Old APS: in step');
      rowLabel(rNew).innerHTML = md(spec ? 'f_{x}·f_{y}, APS-U' : 'APS-U: in step');
      rowLabel(rGain).textContent = spec ? 'Gain f(APS-U)/f(APS)' : 'In-step share grows';
      rowLabel(rFlux).textContent = spec ? 'Coherent flux gain (design)' : 'In-step X-rays per second';
      rowLabel(rXi).innerHTML = md(spec ? `ξ_{${st.plane}}, APS → APS-U` : 'In-step patch');
    };

    // ------------------------------------------------------------ updates
    let capTimer = 0;
    let lastCapT = 0;
    const refreshCaption = () => {
      const now = performance.now();
      if (now - lastCapT < 120) {
        if (!capTimer)
          capTimer = window.setTimeout(() => {
            capTimer = 0;
            refreshCaption();
          }, 130);
        return;
      }
      lastCapT = now;
      const [v, s] = captions();
      station.setCaption(v, s);
    };

    function setE(E: number, fromChart: boolean): void {
      st.E = Math.max(E_MIN, Math.min(E_MAX, E));
      if (fromChart) sE.set(st.E);
      changed(false);
    }

    /** Parameter changes are coalesced: slider input can fire several times per frame, the model and the DOM
     *  readouts are recomputed at most once per animation frame (or immediately when `immediate`). */
    let pending = false;
    let pendingImmediate = false;
    function changed(immediate: boolean): void {
      pending = true;
      pendingImmediate ||= immediate;
      if (immediate) apply();
    }
    function apply(): void {
      if (!pending) return;
      pending = false;
      young.set({ E: st.E, Z: st.Z, d: st.d, plane: st.plane, mode: st.mode, depth, chex });
      chart.set({ E: st.E, mode: st.mode, depth, chex });
      chartDirty = true;
      updateReadouts();
      for (const { b, s } of chipBtns) b.setAttribute('aria-pressed', String(Math.abs(s.E - st.E) < 0.05 && Math.abs(s.Z - st.Z) < 0.05));
      if (pendingImmediate) lastCapT = 0;
      pendingImmediate = false;
      refreshCaption();
    }

    function updateReadouts(): void {
      const spec = depth === 'specialist';
      const o = P.coherence(P.APS_2019, st.E);
      const n = P.coherence(st.mode === 'round' ? P.APSU_ROUND : P.APSU_FLAT, st.E);
      rOld.set(spec ? fmtPct(o.f) : fmtInN(o.f));
      rNew.set(spec ? fmtPct(n.f) : fmtInN(n.f));
      rGain.set(fmtGain(n.f / o.f));
      const cf = coherentFluxGain(st.E);
      rFlux.set(Number.isFinite(cf) ? (spec ? fmtGain(cf) : `≈ ×${approxGain(cf)}`) : spec ? 'no design data' : 'no data');
      const L = young.lanes;
      rXi.set(`${fmtUm(L.old.xi)} → ${fmtUm(L.neu.xi)}`);
    }

    function captions(): [string, string] {
      const o = P.coherence(P.APS_2019, st.E);
      const ring = st.mode === 'round' ? P.APSU_ROUND : P.APSU_FLAT;
      const n = P.coherence(ring, st.E);
      const L = young.lanes;
      const g = n.f / o.f;
      const Et = `${st.E < 10 ? st.E.toFixed(1) : Math.round(st.E)} keV`;
      const dT = fmtUm(st.d);
      const vo = L.old.V;
      const vn = L.neu.V;
      const pos = chex ? P.nearestChexPosition(st.Z) : null;
      const stop = chex ? P.CHEX_STOPS.find((s) => Math.abs(s.E - st.E) < 0.05 && Math.abs(s.Z - st.Z) < 0.05) : undefined;
      const cf = coherentFluxGain(st.E);

      // ---------------- visitor
      // g is the ratio of in-step *fractions*; the number of in-step photons per second also gains 2× current and
      // better undulators (design coherent flux ≈ brightness ratio)
      let v = `**At ${Et}, only ${fmtInN(o.f)} of the old APS’s X-rays marched in step; with APS-U it is ${fmtInN(n.f)}, a ${fmtGain(g).slice(1)}× larger share.** `;
      if (Number.isFinite(cf) && cf > 1.5 * g)
        v += `Add twice the current and better undulators, and the design delivers about **${approxGain(cf)} times more in-step X-rays per second**. `;
      if (vo < 0.15 && vn > 0.5)
        v += `With APS-U the light at the two slits stays in step over ~${fmtUm(L.neu.xi)}, so stripes (fringes) appear. The old beam is in step over only ~${fmtUm(L.old.xi)} — less than the ${dT} slit spacing — so its stripes wash out into a blur.`;
      else if (vo >= 0.15 && vn > 0.5)
        v += `Here even the old beam makes some stripes: the slits are close enough (${dT}) for its ~${fmtUm(L.old.xi)} in-step patch. Raise the energy or spread the slits and watch which stripes survive.`;
      else if (vn <= 0.5 && vn > 0.08)
        v += `${vo < 0.15 ? "APS-U's stripes are fading too" : 'Both sets of stripes are fading'}: APS-U's in-step patch (~${fmtUm(L.neu.xi)}) is ${L.neu.xi > st.d ? 'only just bigger than' : 'about the size of'} the ${dT} slit spacing. Bring the slits closer, or move them farther from the source.`;
      else
        v += `Both blur out here: ${dT} is wider than either beam's in-step patch (APS-U ~${fmtUm(L.neu.xi)}). Bring the slits closer or move them farther away.`;
      if (st.plane === 'y') v += ' Up–down, the old beam was already thin, so the upgrade matters less in this direction — its big win is side to side.';
      else v += ` Higher energy means shorter waves, which are harder to keep in step: that is where the upgrade${chex ? ', and CHEX,' : ''} gain${chex ? '' : 's'} the most.`;
      if (stop) v += ` *(${stop.station}: ${stop.what} at ${stop.E} keV.)*`;

      // ---------------- specialist
      const pl = (c: P.Coherence, axis: 'x' | 'y') => {
        const q = axis === 'x' ? c.x : c.y;
        return `Σ_{${axis}} ${um(q.size)} µm, Σ′_{${axis}} ${um(q.div)} µrad → f_{${axis}} ${fmtPct(q.f)}`;
      };
      let s = `**E = ${st.E.toFixed(1)} keV**, λ = ${(n.lambda * 1e10).toFixed(3)} Å, λ/4π = ${(P.diffractionLimit(st.E) * 1e12).toFixed(2)} pm. `;
      s += `APS-U (${st.mode === 'round' ? 'round, κ = 1' : 'flat, κ = 0.1'}): ${pl(n, 'x')}; ${pl(n, 'y')}; **f = ${fmtPct(n.f)}**. `;
      s += `APS: ${pl(o, 'x')}; f_{y} ${fmtPct(o.y.f)}; **f = ${fmtPct(o.f)}** → **${fmtGain(g)}** in coherent fraction. `;
      if (Number.isFinite(cf))
        s += `Coherent flux F_{c} = f·F = B(λ/2)^{2}, design (IPAC’21 envelope, best ID at each E, ±30 %): **${fmtGain(cf)}** ≈ ${fmtGain(g)} in f (this model) × ${fmtGain(cf / g)} remainder (mostly flux: 2× current, new undulators; model-dependent). `;
      const ffN = P.coherenceLength(n.lambda, st.Z, L.neu.sigma);
      const ffO = P.coherenceLength(n.lambda, st.Z, L.old.sigma);
      const ax = st.plane;
      s += `At Z = ${st.Z.toFixed(1)} m${pos ? ` (${pos.name})` : ''}: ξ_{${ax}} = q·Σ_{${ax}}(Z) = ${fmtUm(L.neu.xi)} vs ${fmtUm(L.old.xi)} (Gaussian Schell, q = 2f_{${ax}}/√(1−f_{${ax}}²); far-field λZ/2πΣ_{${ax}} would give ${fmtUm(ffN)} vs ${fmtUm(ffO)}); `;
      s += `|μ₁₂(d = ${dT})| = ${L.neu.mu.toFixed(2)} vs ${L.old.mu.toFixed(2)}, fringe visibility (a = d/4) V = ${vn.toFixed(2)} vs ${vo.toFixed(2)}. `;
      s += `Kim Gaussian model, L = 2.4 m, zero current, no energy spread — an idealised upper bound.`;
      return [v, s];
    }

    // The caption only grows while the layout/depth/width stay the same: a shrinking caption would resize the
    // canvases (re-allocating their backing stores) several times a second while a slider is dragged.
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
    let lastDepthForLayout: Depth | '' = '';
    const applyLayout = () => {
      const w = host.clientWidth || 900;
      if (Math.abs(w - lastW) > 0.5) {
        lastW = w;
        resetCaptionHeight();
      }
      const mode = w >= 1000 ? 'wide' : w >= 700 ? 'mid' : 'narrow';
      if (mode === layoutMode && depth === lastDepthForLayout) return;
      resetCaptionHeight();
      layoutMode = mode;
      lastDepthForLayout = depth;
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
      if (mode === 'narrow') {
        // chart → energy controls → Young → remaining controls → caption
        visual2.appendChild(wrapOf(cYoung));
        ctlA.append(guideEl, gE);
        root.style.gridTemplateRows = 'repeat(5, max-content)';
        root.append(visual, ctlA, visual2, controls, station.caption);
        vs.gridTemplateColumns = 'minmax(0,1fr)';
        vs.gridTemplateRows = spec ? '520px' : '400px';
        vs.minHeight = '';
        v2.gridTemplateColumns = 'minmax(0,1fr)';
        v2.gridTemplateRows = '430px';
        v2.minHeight = '';
        return;
      }
      // wide and mid: both canvases in the visual grid, all controls together
      visual.appendChild(wrapOf(cYoung));
      controls.insertBefore(gE, gS);
      controls.prepend(guideEl);
      visual2.remove();
      ctlA.remove();
      root.append(visual, controls, station.caption);
      vs.gridTemplateColumns = 'minmax(0,1fr) minmax(0,1.08fr)';
      if (mode === 'wide') {
        root.style.gridTemplateRows = '';
        vs.gridTemplateRows = 'minmax(0,1fr)';
        vs.minHeight = spec ? '600px' : '540px';
      } else {
        root.style.gridTemplateRows = 'repeat(3, max-content)';
        vs.gridTemplateRows = spec ? '560px' : '470px';
        vs.minHeight = '';
      }
    };
    // notes span the full width when the kit lays the controls out as a grid (stacked layouts)
    for (const n of controls.querySelectorAll<HTMLElement>('.stn-note')) n.style.gridColumn = '1 / -1';
    const ro = new ResizeObserver(() => applyLayout());
    ro.observe(host);
    station.onDestroy(() => {
      ro.disconnect();
      capRo.disconnect();
      cancelAnimationFrame(capRaf);
      if (capTimer) clearTimeout(capTimer);
    });

    // ------------------------------------------------------------ start
    applyDepthLabels();
    applyLayout();
    changed(true);
    young.warm();
    chart.draw();
    chartDirty = false;
    young.draw();

    loop(station, (dt) => {
      apply();
      if (chartDirty) {
        chart.draw();
        chartDirty = false;
      }
      if (motion.on) young.frame(dt);
      else young.still();
    });

    return {
      destroy: () => station.destroy(),
      setDepth: (d) => {
        depth = d;
        station.setDepth(d);
        applyDepthLabels();
        applyLayout();
        changed(true);
        chart.draw();
        chartDirty = false;
        young.draw();
      },
    };
  },
};
export default mod;

function um(m: number): string {
  const u = m * 1e6;
  return u >= 100 ? u.toFixed(0) : u >= 10 ? u.toFixed(1) : u.toFixed(2);
}

function setSliderLabel(input: HTMLInputElement, text: string): void {
  const l = input.parentElement?.querySelector('.stn-slider-label');
  if (l) l.textContent = text;
}

function setToggleLabels(wrap: HTMLElement, labels: string[]): void {
  const btns = wrap.querySelectorAll('button');
  btns.forEach((b, i) => {
    if (labels[i]) b.textContent = labels[i];
  });
}
