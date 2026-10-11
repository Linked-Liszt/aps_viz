/**
 * Station "coherence" — CHEX (28-ID) and the facility story: "How coherent is the light?"
 *
 * Two linked views:
 *   1. Energy chart: coherent fraction f = f_x·f_y of undulator radiation vs photon energy (5–110 keV, log–log)
 *      for the pre-upgrade APS (7 GeV, 3.1 nm·rad) and APS-U (6 GeV, round or flat beam), the APS-U/APS gain,
 *      and the electron emittances against the photon diffraction limit λ/4π. Drag to pick an energy.
 *   2. Young's double-slit test at a distance Z from the source: the Gaussian-Schell-model coherence length
 *      ξ(Z) = q·Σ(Z), q = 2f/√(1−f²) (→ λZ/(2πΣ) in the far field) sets how strongly two slits a distance d apart
 *      are in step, |μ₁₂| = exp(−d²/2ξ²); photons build up the partially coherent fringe pattern on a detector.
 *
 * Equations, approximations, parameter values and sources: ./coherence/physics.ts (header comment). In brief:
 *   σ_r = √(2λL)/4π, σ_r' = √(λ/2L) (Kim 1989), Σ² = σ_e² + σ_r², Σ'² = σ_e'² + σ_r'², f_i = (λ/4π)/(Σ_iΣ'_i);
 *   L = 2.4 m; APS: FDR 2019 Table 2.1; APS-U: storage-ring parameters 2024 Table 5 (zero current);
 *   idealised: no energy spread, Gaussian beams, unfocused beam — said so in the station's last note, together
 *   with the SRW design values (FDR Ch. 4) that show the APS-U curves are an upper bound at high energy.
 * CHEX energies (15/25/35/75/105 keV) and instrument distances (35.5–72 m) from the chex research dossier.
 */
import type { ExplainerModule } from './registry';
import { button, canvas2d, createStation, group, loop, motionGate, note, readout, slider, toggle, type Canvas2D } from './kit';
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
    const station = createStation(host, { color: accent, layout: 'side' });
    const { visual, controls } = station;
    const root = station.root;
    root.classList.add('coh-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    // ------------------------------------------------------------ state
    const st = { E: DEFAULTS.E, Z: DEFAULTS.Z, d: DEFAULTS.dUm * 1e-6, plane: DEFAULTS.plane, mode: DEFAULTS.mode };
    /** on the CHEX (28-ID) panel: its stations, energy band and science; elsewhere (the upgrade story) stay generic */
    const chex = ctx.beamlineId === 'chex';

    // ------------------------------------------------------------ canvases
    const cChart = canvas2d(visual, { label: '1 · How much of the beam is in step?' });
    const visual2 = document.createElement('div');
    visual2.className = 'stn-visual';
    const cYoung = canvas2d(visual, { label: '2 · Test it: Young’s double slit' });
    const wrapOf = (c: Canvas2D) => c.canvas.parentElement as HTMLElement;

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
      `**Drag the energy** (or the chart)${chex ? ', or jump to a CHEX station,' : ''} and watch the detectors: stripes (fringes) appear only where the light at the two slits marches **in step**. The bell over each slit mask shows how strongly the light at each point is in step with the left slit (the *degree of coherence*). Both detectors get photons at the same rate, so brightness differences are not shown.`,
    );
    const guideEl = controls.lastElementChild as HTMLElement;

    const gE = group(controls, 'X-ray energy');
    const sE = slider(gE, {
      label: 'X-ray energy',
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
    chipsLabel.textContent = 'CHEX fixed-energy stations, keV (sets energy and distance):';
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

    const gS = group(controls, 'Young’s double-slit test');
    const sD = slider(gS, {
      label: 'Slit spacing',
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
      label: 'Distance from the source',
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
        { value: 'x', label: '↔ sideways', title: 'Horizontal: the direction the old beam was 275 µm wide' },
        { value: 'y', label: '↕ up–down', title: 'Vertical: the old beam was already only 10 µm tall' },
      ],
      value: st.plane,
      onChange: (v) => {
        st.plane = v;
        changed(true);
      },
    });
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
    const rOld = readout(gN, 'Old APS: in step');
    const rNew = readout(gN, 'APS-U: in step', { color: accent });
    const rGain = readout(gN, 'In-step share grows', { big: true, color: accent });
    const rFlux = readout(gN, 'In-step X-rays per second (design)', { color: accent });
    rFlux.el.title =
      'Design coherent flux, APS-U ÷ APS (IPAC’21 envelope, best undulator at each energy, ±30 %): the larger in-step share × twice the current × better undulators';
    const rXi = readout(gN, 'In-step patch at the slits');
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
      '**Why does the gain grow with energy?** To stay in step, light must come from a source about as small and as parallel as its waves are short. In each direction the in-step share is at most (λ/4π) ÷ (emittance + λ/4π), where λ/4π — the light’s own limit — is 20 pm·rad at 5 keV and 10 pm·rad at 10 keV, shrinking as the waves get shorter. The old beam (3.1 nm·rad sideways) was far above that at every energy, so its share fell in proportion to the wavelength. The new beam (29–40 pm·rad) is only 1.5–4× above it at 5–10 keV, so its share falls more slowly at first, and the ratio keeps climbing toward ≈ ×130 (round) or ×670 (flat).',
    );
    note(
      controls,
      station,
      chex
        ? '**Why CHEX cares.** CHEX mostly uses 15–105 keV X-rays, which pass through the walls of real growth reactors. Before the upgrade only about 1 X-ray in 10,000 at 25 keV was in step; now about 1 in 125 is, enough to film the speckle of atoms rearranging while a crystal grows.'
        : '**Why it matters.** In-step X-rays make speckle and interference patterns that show how atoms and tiny structures are arranged and how they move: the basis of techniques such as X-ray photon correlation spectroscopy (XPCS) and coherent imaging. High-energy X-rays pass through real devices and reactors, but they were the hardest to keep in step, so that is where the upgrade helps most.',
    );
    note(
      controls,
      station,
      `**What this model leaves out.** It assumes zero beam current and no electron energy spread. The real spread (0.136 %) widens the light’s natural angle spread — about 1.7× already at the 5th harmonic (${chex ? 'CHEX at 25 keV, 74 periods' : '25 keV from a 2.07-m, 2.8-cm-period undulator with 74 periods'}), more at 75–105 keV, and more for APS-U than for the old ring — and other fits give a natural source size about 2× the one used here. Design simulations of two APS-U beamlines (final design report, chapter 4) find 0.5–0.9 % in step at 25 keV, against 0.8–2.2 % here: read the APS-U curves as an upper bound. Coherent *flux* gains also include twice the current and optimised undulators (design report: ×540 at 20 keV). ${chex ? 'CHEX’s interim 2.07-m undulators give' : 'A 2.07-m undulator gives'} 4–11 % less than the 2.4 m assumed. Ideal optics keep the in-step share.`,
    );

    cChart.canvas.setAttribute('aria-label', 'Chart: coherent fraction of the X-rays before and after the upgrade versus X-ray energy, and their ratio (on large screens also the electron-beam emittances against the light’s limit λ/4π). Drag to change the energy.');
    cYoung.canvas.setAttribute('aria-label', 'Young’s double-slit test for the old APS and APS-U: the source to scale, the slit mask with the degree of coherence, and the detector building up fringes photon by photon.');
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
      station.setCaption(caption());
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
      young.set({ E: st.E, Z: st.Z, d: st.d, plane: st.plane, mode: st.mode, chex });
      chart.set({ E: st.E, mode: st.mode, chex });
      chartDirty = true;
      updateReadouts();
      for (const { b, s } of chipBtns) b.setAttribute('aria-pressed', String(Math.abs(s.E - st.E) < 0.05 && Math.abs(s.Z - st.Z) < 0.05));
      if (pendingImmediate) lastCapT = 0;
      pendingImmediate = false;
      refreshCaption();
    }

    function updateReadouts(): void {
      const o = P.coherence(P.APS_2019, st.E);
      const n = P.coherence(st.mode === 'round' ? P.APSU_ROUND : P.APSU_FLAT, st.E);
      rOld.set(fmtInN(o.f));
      rNew.set(fmtInN(n.f));
      rGain.set(fmtGain(n.f / o.f));
      const cf = coherentFluxGain(st.E);
      rFlux.set(Number.isFinite(cf) ? `≈ ×${approxGain(cf)}` : 'no design data');
      const L = young.lanes;
      rowLabel(rXi).textContent = `In-step patch at the slits, ${st.plane === 'x' ? 'sideways' : 'up–down'}`;
      rXi.set(`${fmtUm(L.old.xi)} → ${fmtUm(L.neu.xi)}`);
    }

    function caption(): string {
      const o = P.coherence(P.APS_2019, st.E);
      const ring = st.mode === 'round' ? P.APSU_ROUND : P.APSU_FLAT;
      const n = P.coherence(ring, st.E);
      const L = young.lanes;
      const g = n.f / o.f;
      const Et = `${st.E < 10 ? st.E.toFixed(1) : Math.round(st.E)} keV`;
      const dT = fmtUm(st.d);
      const vo = L.old.V;
      const vn = L.neu.V;
      const pct = (V: number) => `${Math.round(V * 100)} %`;
      const pos = chex ? P.nearestChexPosition(st.Z) : null;
      const stop = chex ? P.CHEX_STOPS.find((s) => Math.abs(s.E - st.E) < 0.05 && Math.abs(s.Z - st.Z) < 0.05) : undefined;
      const cf = coherentFluxGain(st.E);
      const at = `At ${st.Z.toFixed(1)} m${pos ? ` (${pos.name})` : ''}`;

      // g is the ratio of in-step *fractions*; the number of in-step photons per second also gains 2× current and
      // better undulators (design coherent flux ≈ brightness ratio)
      let v = `**At ${Et} (wavelength ${(n.lambda * 1e10).toFixed(3)} Å), only ${fmtInN(o.f)} of the old APS’s X-rays marched in step; with APS-U (${st.mode} beam) it is ${fmtInN(n.f)} — ${fmtPct(n.f)}, from ${fmtPct(n.x.f)} sideways × ${fmtPct(n.y.f)} up–down — a ${fmtGain(g).slice(1)}× larger share.** `;
      if (Number.isFinite(cf) && cf > 1.5 * g) v += `Add twice the current and better undulators, and the design delivers about **${approxGain(cf)} times more in-step X-rays per second**. `;
      if (vo < 0.15 && vn > 0.5)
        v += `${at}, the light at the two slits stays in step over ~${fmtUm(L.neu.xi)} with APS-U (its *coherence length*), so stripes (fringes) appear, with ${pct(vn)} contrast. The old beam is in step over only ~${fmtUm(L.old.xi)} — less than the ${dT} slit spacing — so its stripes wash out (${pct(vo)}).`;
      else if (vo >= 0.15 && vn > 0.5)
        v += `${at}, even the old beam makes ${vo > 0.8 ? 'clear' : 'some'} stripes (${pct(vo)} contrast, APS-U ${pct(vn)}): the slits are close enough (${dT}) for its ~${fmtUm(L.old.xi)} in-step patch (its *coherence length*). Raise the energy or spread the slits and watch which stripes survive.`;
      else if (vn <= 0.5 && vn > 0.08)
        v += `${at}, ${vo < 0.15 ? 'APS-U’s stripes are fading too' : 'both sets of stripes are fading'} (${pct(vn)} contrast): its in-step patch (its *coherence length*, ~${fmtUm(L.neu.xi)}) is ${L.neu.xi > st.d ? 'only just bigger than' : 'about the size of'} the ${dT} slit spacing. Bring the slits closer, or move them farther from the source.`;
      else v += `${at}, both blur out: ${dT} is wider than either beam’s in-step patch (APS-U ~${fmtUm(L.neu.xi)}). Bring the slits closer or move them farther away.`;
      if (st.plane === 'y') v += ' Up–down, the old beam was already thin, so the upgrade matters less in this direction — its big win is side to side.';
      else v += ` Higher energy means shorter waves, which are harder to keep in step: that is where the upgrade${chex ? ', and CHEX,' : ''} gain${chex ? '' : 's'} the most.`;
      if (stop) v += ` *(${stop.station}: ${stop.what} at ${stop.E} keV.)*`;
      return v;
    }

    // The caption only grows while the layout/width stay the same: a shrinking caption would resize the
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
      if (mode === 'narrow') {
        // chart → energy controls → Young → remaining controls → caption
        visual2.appendChild(wrapOf(cYoung));
        ctlA.append(guideEl, gE);
        root.style.gridTemplateRows = 'repeat(5, max-content)';
        root.append(visual, ctlA, visual2, controls, station.caption);
        vs.gridTemplateColumns = 'minmax(0,1fr)';
        vs.gridTemplateRows = '420px';
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
        vs.minHeight = '520px';
      } else {
        root.style.gridTemplateRows = 'repeat(3, max-content)';
        vs.gridTemplateRows = '480px';
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

    return { destroy: () => station.destroy() };
  },
};
export default mod;
