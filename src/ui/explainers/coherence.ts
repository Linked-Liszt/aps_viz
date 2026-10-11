/**
 * Station "coherence". CHEX (28-ID) and the facility story: "X-ray coherence"
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
 *   idealised: no energy spread, Gaussian beams, unfocused beam. Said so in the station's last note, together
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
  title: "X-ray coherence",
  subtitle: "Change photon energy to compare coherent fractions and interference patterns before and after the upgrade.",
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
    const cChart = canvas2d(visual, { label: "1 · Coherent fraction" });
    const visual2 = document.createElement('div');
    visual2.className = 'stn-visual';
    const cYoung = canvas2d(visual, { label: "2 · Young's double-slit test" });
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
      `Change the energy with the slider or chart${chex ? ', or select a CHEX station,' : ''} to compare interference fringes. Fringes require a stable phase relationship between the X-rays at the two slits. The curve above each slit mask represents the degree of coherence relative to the left slit. Both detector panels use the same photon rate, so they compare coherence without showing brightness differences.`,
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
    chipsLabel.textContent = "CHEX stations · keV · energy and distance presets:";
    if (chex) gE.append(chipsLabel, chips);
    const chipBtns = (chex ? P.CHEX_STOPS : []).map((s) => {
      const b = button(chips, `${s.station.slice(-1)} · ${s.E}`, () => {
        st.E = s.E;
        st.Z = s.Z;
        sE.set(st.E);
        sZ.set(st.Z);
        changed(true);
      });
      b.title = `${s.station}: ${s.E} keV, ${s.Z} m from source. ${s.what}.`;
      return { b, s };
    });

    const gS = group(controls, "Young's double-slit test");
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
        { value: 'x', label: "↔ Horizontal", title: 'Horizontal: the direction the old beam was 275 µm wide' },
        { value: 'y', label: "↕ Vertical", title: 'Vertical: the old beam was already only 10 µm tall' },
      ],
      value: st.plane,
      onChange: (v) => {
        st.plane = v;
        changed(true);
      },
    });
    // reduced motion: the detectors show a still picture (refilled when a parameter changes) instead of live photons
    const motion = motionGate(station, gS, { title: "Reduced motion is enabled on your device. The panels display static photon distributions. Press to animate individual photon arrivals." });

    const gB = group(controls, 'APS-U beam shape');
    const tMode = toggle<Mode>(gB, {
      options: [
        { value: 'round', label: "Round user mode", title: "Full coupling κ = 1 gives εx = εy = 28.7 pm. User operation has used this mode since 2025." },
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
    const rOld = readout(gN, "Old APS coherent fraction");
    const rNew = readout(gN, "APS-U coherent fraction", { color: accent });
    const rGain = readout(gN, "Coherent fraction ratio", { big: true, color: accent });
    const rFlux = readout(gN, "Coherent flux gain · design", { color: accent });
    rFlux.el.title =
      "Design APS-U ÷ APS coherent flux from the IPAC'21 envelope, using the best undulator at each energy. Uncertainty is ±30 %. It includes coherent fraction, twice the current and upgraded undulators.";
    const rXi = readout(gN, "Coherence length at slits");
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
      "In each direction, coherent fraction is at most (λ/4π) ÷ (emittance + λ/4π). Wavelength λ sets the diffraction limit λ/4π: 20 pm·rad at 5 keV and 10 pm·rad at 10 keV. The old horizontal electron emittance of 3.1 nm·rad exceeded that limit across the energy range, so coherent fraction fell approximately with wavelength. The new emittance of 29 to 40 pm·rad is only 1.5 to 4× above the limit at 5 to 10 keV. Its fraction initially falls more slowly, so the APS-U ÷ APS ratio increases toward ≈130 for a round beam or ≈670 for a flat beam.",
    );
    note(
      controls,
      station,
      chex
        ? "CHEX uses mainly 15 to 105 keV X-rays, which penetrate growth-reactor walls. At 25 keV, the coherent fraction was about 1 in 10,000 before the upgrade and is now about 1 in 125. The larger coherent flux permits speckle measurements of structural changes during crystal growth."
        : "Coherent X-rays produce interference and speckle patterns used to measure atomic and nanoscale structure and motion. X-ray photon correlation spectroscopy and coherent imaging use these patterns. Higher-energy X-rays penetrate devices and reactors but have shorter wavelengths and lower coherent fractions. The upgrade gives its largest relative coherence gain at these energies.",
    );
    note(
      controls,
      station,
      `The model uses zero-current electron beam parameters and omits electron energy spread. The actual spread of 0.136 % broadens the natural radiation divergence by about 1.7× at the 5th harmonic, ${chex ? 'CHEX at 25 keV with 74 periods' : '25 keV from a 2.07 m undulator with a 2.8 cm period and 74 periods'}. Broadening is greater at 75 to 105 keV and for APS-U than the old ring. Other fitted beam models give natural source sizes about 2× larger. Final Design Report chapter 4 simulations give 0.5 to 0.9 % coherence at 25 keV, compared with 0.8 to 2.2 % here. The APS-U curves are therefore upper bounds. Coherent flux gains include twice the current and optimized undulators; the design gain is 540× at 20 keV. ${chex ? 'CHEX interim undulators are' : 'An undulator is'} 2.07 m long, giving 4 to 11 % less coherent fraction than the assumed 2.4 m. Ideal optics preserve coherent fraction.`,
    );

    cChart.canvas.setAttribute('aria-label', "Coherent fraction versus X-ray energy for the old APS and APS-U, with their ratio. Larger screens include electron emittance and the diffraction limit λ/4π. Drag to change energy.");
    cYoung.canvas.setAttribute('aria-label', "Young's double-slit test for the old APS and APS-U. The source is to scale, slit masks show degree of coherence, and detected photons form interference fringes.");
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
      rowLabel(rXi).textContent = `Coherence length at slits · ${st.plane === 'x' ? 'horizontal' : 'vertical'}`;
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
      const at = `At ${st.Z.toFixed(1)} m${pos ? `, ${pos.name}` : ''}`;

      // g is the ratio of coherent fractions; coherent photon flux also gains 2× current and
      // better undulators (design coherent flux ≈ brightness ratio)
      let v = `At ${Et}, with wavelength ${(n.lambda * 1e10).toFixed(3)} Å, the coherent fraction is ${fmtInN(o.f)} for the old APS and ${fmtInN(n.f)} for the APS-U ${st.mode} beam. The APS-U fraction is ${fmtPct(n.f)}, from horizontal ${fmtPct(n.x.f)} × vertical ${fmtPct(n.y.f)}. It is ${fmtGain(g).slice(1)}× larger. `;
      if (Number.isFinite(cf) && cf > 1.5 * g) v += `Including twice the current and upgraded undulators, the design coherent flux gain is about ${approxGain(cf)}×. `;
      if (vo < 0.15 && vn > 0.5)
        v += `${at}, the APS-U coherence length is ~${fmtUm(L.neu.xi)}, giving fringes with ${pct(vn)} contrast at the ${dT} slit spacing. The old APS coherence length is only ~${fmtUm(L.old.xi)}, shorter than this spacing, giving ${pct(vo)} contrast.`;
      else if (vo >= 0.15 && vn > 0.5)
        v += `${at}, the ${dT} slit spacing is within the old APS coherence length of ~${fmtUm(L.old.xi)}. Both patterns have fringes: ${pct(vo)} contrast for the old APS and ${pct(vn)} for APS-U. Increase energy or slit spacing to compare changes in contrast.`;
      else if (vn <= 0.5 && vn > 0.08)
        v += `${at}, the APS-U coherence length of ~${fmtUm(L.neu.xi)} is ${L.neu.xi > st.d ? 'only slightly larger than' : 'about equal to'} the ${dT} slit spacing. APS-U fringe contrast is ${pct(vn)}. Move the slits closer together or farther from the source to increase it.`;
      else v += `${at}, the ${dT} slit spacing exceeds both coherence lengths, including APS-U at ~${fmtUm(L.neu.xi)}. Both patterns have little contrast. Move the slits closer together or farther from the source.`;
      if (st.plane === 'y') v += " The old APS beam was already narrow vertically, so the largest coherence gain is horizontal.";
      else v += ` Higher photon energy means shorter wavelength and lower coherent fraction. The relative gain after the upgrade is greater at higher energies${chex ? ', including the CHEX range' : ''}.`;
      if (stop) v += ` ${stop.station}: ${stop.what} at ${stop.E} keV.`;
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
