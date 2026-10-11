/**
 * Station "undulator". "Undulator radiation".
 *
 * Electrons oscillate in a periodic magnetic field and emit radiation along their trajectory. Light advances
 * by one first-harmonic wavelength per magnetic period. Radiation from N periods interferes constructively
 * at odd harmonics, with on-axis peak intensity proportional to N² relative to a single bend.
 * A smaller gap increases field and K. Slippage and wavelength increase, while photon energy decreases.
 *
 * Panels
 *   1. ./undulator/scene.ts. The magnet array from above, trajectory, 1/γ cone, slipping wave crests, end view.
 *   2. ./undulator/wave.ts. On-axis field E_x(t) (Liénard–Wiechert), its harmonic content F_n(K) and a zoom on
 *                                one line: sinc² of width 0.886/(nN) (+ energy-spread broadening, dashed).
 *   3. ./undulator/spectrum.ts. On-axis spectrum (ph/s/mrad²/0.1 % BW) with tuning bands, BM and wiggler.
 *
 * Physics, equations, approximations and sources: ./undulator/physics.ts (header comment). In short:
 *   K = 0.934 λu[cm] B₀[T];  E_n = n·0.9496 E²[GeV] / (λu[cm](1 + K²/2)) keV;  d²F/dΩ = 1.744×10¹⁴ N²E²I F_n(K);
 *   hybrid PM: B₀ = 3.694 exp(−5.068 g/λu + 1.520 (g/λu)²) T (Elleaume et al. 2000), scaled per device to the APS
 *   K at minimum gap (IPAC'24 TUPG56 Table 1 / APS ID table Sep 2026); SCU: fixed 8.0 mm gap, B₀ ∝ current.
 * Drawn peaks = filament value × energy spread (exact convolution) × beam divergence σ_r′²/(Σ_x′Σ_y′) (Gaussian
 * approx.) × phase errors exp(−n²σ_φ²), σ_φ = 2.5° rms. The energy tuner picks the lowest odd harmonic within 80 % of
 * the best on-axis flux and names a clearly better device when there is one.
 * Device periods, N, minimum gaps and K: facility research dossier (insertionDevices). Machine: APS 7 GeV/100 mA,
 * 3.1 nm; APS-U 6 GeV/200 mA, 42 pm. Illustrative (labelled in the UI): the magnified angles/slippage and the few
 * periods shown in panel 1, the wiggler curve, B₀ ∝ current for the SCU. Not included: divergence broadening of the
 * lines, source size, even harmonics off axis.
 *
 * Performance: the canvases follow every input; DOM text is re-written at most every 120 ms during a drag.
 */
import type { ExplainerModule } from './registry';
import { button, canvas2d, createStation, group, loop, md, motionGate, note, readout, slider, toggle, type Canvas2D } from './kit';
import * as P from './undulator/physics';
import { UndulatorScene } from './undulator/scene';
import { WaveView } from './undulator/wave';
import { SpectrumView } from './undulator/spectrum';

type Dev = P.DeviceId | '';

/** width of a human hair (µm), for a sense of scale */
const HAIR_UM = 70;
const DEFAULTS = { dev: 'u28' as P.DeviceId, ring: 'apsu' as P.RingId, setting: 11 };
const PRESETS = [8, 12.4, 25, 60];
/**
 * Side layout, short hosts: the lower row (spectrum + panel 2) keeps the 200 px panel 2 needs for its harmonic bars
 * and line zoom (./undulator/wave.ts); only the top view shrinks, down to the kit's 160 px canvas minimum.
 */
const WIDE_LOWER_MIN_PX = 200;
const WIDE_SCENE_MIN_PX = 160;
/** smallest height of the three panels: padding 2 × 8 + gap 6 + both rows */
const WIDE_VISUAL_MIN_PX = 16 + 6 + WIDE_SCENE_MIN_PX + WIDE_LOWER_MIN_PX;

const CSS = `
.und-root .stn-readout-value { white-space: nowrap; }
.und-root .stn-toggle button { padding: 6px 6px; min-width: 0; }
.und-presets-wrap { container-type: inline-size; }
.und-presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
@container (min-width: 260px) { .und-presets { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.und-presets .stn-btn { min-width: 0; padding: 6px 4px; font-size: 12px; white-space: nowrap; }
.und-presets .stn-btn[aria-pressed=true] { background: color-mix(in oklab, var(--c, #5cd3ff) 26%, #0b111b); border-color: var(--c, #5cd3ff); color: #fff; }
.und-msg { font-size: 12px; line-height: 1.4; color: #b7c3d2; min-height: 1.4em; }
.und-msg.is-bad { color: #fbbf24; }
.und-msg strong { color: #fff; }
.und-root .stn-note { font-size: 12.25px; }
.und-root .stn-hint strong { color: #b7c3d2; }
.und-root .stn-readout-label { min-width: 0; }
.und-out-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 8px 10px; }
.und-out-grid > .stn-group-title, .und-out-grid > .stn-hint, .und-out-grid > .stn-readout.is-big { grid-column: 1 / -1; }
`;

const mod: ExplainerModule = {
  title: "Undulator radiation",
  subtitle: "Change the magnetic gap to compare electron trajectories, photon energies and harmonic intensities.",
  mount(host, ctx) {
    const accent = ctx.color || '#5cd3ff';
    const station = createStation(host, { color: accent, layout: 'side' });
    const { visual, controls, root } = station;
    root.classList.add('und-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const st = { dev: DEFAULTS.dev, ring: DEFAULTS.ring, setting: DEFAULTS.setting, tunedN: null as number | null, preset: null as number | null };
    const memory: Partial<Record<P.DeviceId, number>> = {};
    let msg: { text: string; bad: boolean } | null = null;
    const device = () => P.DEVICES[st.dev];
    const ring = () => P.RINGS[st.ring];

    // ------------------------------------------------------------ canvases
    const cScene = canvas2d(visual, { label: "1 · Electron trajectory · top view" });
    const cSpec = canvas2d(visual, { label: "3 · On-axis spectrum · approximate" });
    const cWave = canvas2d(visual, { label: "2 · On-axis X-ray electric field" });
    cScene.canvas.setAttribute('aria-label', "Top view of an electron oscillating through an alternating magnetic field and emitting X-rays. Drag up or down to change the gap.");
    cWave.canvas.setAttribute('aria-label', 'The electric field of the X-rays arriving on axis, its harmonic content, and a zoom on one harmonic line showing how narrow it is.');
    cSpec.canvas.setAttribute('aria-label', 'Spectrum of the undulator on axis, compared with a bending magnet and a wiggler. Click to tune to an energy.');
    const visual2 = document.createElement('div');
    visual2.className = 'stn-visual';
    const wrapOf = (c: Canvas2D) => c.canvas.parentElement as HTMLElement;
    const labelOf = (c: Canvas2D) => wrapOf(c).querySelector('.stn-canvas-label') as HTMLElement;

    const scene = new UndulatorScene(cScene, accent);
    const wave = new WaveView(cWave, accent, () => {
      const l = labelOf(cWave);
      return l.offsetLeft + l.offsetWidth;
    });
    const spectrum = new SpectrumView(cSpec, accent, (E) => tune(E, null));
    cScene.onResize(() => scene.set(sceneInput()));

    // ------------------------------------------------------------ controls
    const ctlA = document.createElement('div');
    ctlA.className = 'stn-controls';
    ctlA.style.gridTemplateColumns = 'minmax(0,1fr)';

    note(
      controls,
      station,
      "Reduce the gap with the slider or by dragging the magnets vertically. The field becomes stronger, electron deflection increases and photon energy falls. Click a spectrum energy or preset. The software then selects the gap and lowest odd harmonic with at least 80 % of the maximum on-axis flux.",
    );
    const guideEl = controls.lastElementChild as HTMLElement;

    const gDev = group(controls, 'Undulator');
    const optsPM = P.PM_IDS.map((id) => ({ value: id as Dev, label: P.DEVICES[id].short, title: `${P.DEVICES[id].name}: period ${P.DEVICES[id].periodMm} mm, ${P.DEVICES[id].N} periods. ${P.DEVICES[id].status}.` }));
    const optsSC = P.SCU_IDS.map((id) => ({ value: id as Dev, label: P.DEVICES[id].short, title: `${P.DEVICES[id].name}: period ${P.DEVICES[id].periodMm} mm, ${P.DEVICES[id].N} periods. ${P.DEVICES[id].status}.` }));
    const tPM = toggle<Dev>(gDev, { label: "Permanent-magnet period λu · mm", options: optsPM, value: st.dev, onChange: (v) => v && pickDevice(v) });
    const tSC = toggle<Dev>(gDev, { label: "Superconducting devices · planned", options: optsSC, value: '', onChange: (v) => v && pickDevice(v) });
    const sSet = slider(gDev, {
      label: 'Magnetic gap',
      min: device().gapMinMm,
      max: device().gapMaxMm,
      step: 0.05,
      value: st.setting,
      format: (v) => (device().kind === 'pm' ? `${v.toFixed(1)} mm` : `${v.toFixed(0)} %`),
      onInput: (v) => {
        st.setting = device().kind === 'pm' ? v : v / 100;
        clearTune();
        update(true);
      },
    });
    const setHint = document.createElement('div');
    setHint.className = 'stn-hint';
    gDev.appendChild(setHint);
    // reduced motion: panels 1 and 3 show still pictures (re-made on every change) until Play is pressed
    const motion = motionGate(station, gDev, { title: "Reduced motion is enabled on your device. Electron and wave positions remain static. Press to animate them." });

    const gRing = group(controls, 'Electron beam');
    const tRing = toggle<P.RingId>(gRing, {
      label: 'Electron energy',
      options: [
        { value: 'aps', label: "7 GeV · old APS", title: "APS from 1995 to 2023: 7 GeV, 100 mA" },
        { value: 'apsu', label: "6 GeV · APS-U", title: "APS-U since 2024: 6 GeV, 200 mA" },
      ],
      value: st.ring,
      onChange: (v) => {
        st.ring = v;
        clearTune();
        update();
      },
    });
    const ringHint = document.createElement('div');
    ringHint.className = 'stn-hint';
    gRing.appendChild(ringHint);

    const gOut = group(controls, "Radiation parameters");
    const rE1 = cachedSet(readout(gOut, '1st harmonic', { big: true, color: accent }));
    const rLam = cachedSet(readout(gOut, "Wavelength λ₁"));
    const rB = cachedSet(readout(gOut, 'Peak magnetic field B₀'));
    const rK = cachedSet(readout(gOut, "Deflection parameter K"));
    const rAmp = cachedSet(readout(gOut, "Electron trajectory amplitude"));
    const rGain = cachedSet(readout(gOut, "On-axis flux ÷ bending-magnet flux"));
    const rGam = cachedSet(readout(gOut, 'Light cone half-angle 1/γ'));
    const rW = cachedSet(readout(gOut, 'Line width, 1st harmonic'));
    const rPM = cachedSet(readout(gOut, 'Magnets at the same period & gap'));
    const outHint = document.createElement('div');
    outHint.className = 'stn-hint';
    gOut.appendChild(outHint);
    // long label + value pairs take a full row when the read-outs flow into a grid (stacked layouts)
    for (const r of [rGain, rW]) r.el.style.gridColumn = '1 / -1';

    const gAsk = group(controls, "Select photon energy");
    const presetWrap = document.createElement('div');
    presetWrap.className = 'und-presets-wrap';
    const presetRow = document.createElement('div');
    presetRow.className = 'und-presets';
    presetWrap.appendChild(presetRow);
    gAsk.appendChild(presetWrap);
    const presetBtns = PRESETS.map((E) => {
      const b = button(presetRow, `${E} keV`, () => tune(E, E));
      b.setAttribute('aria-pressed', 'false');
      return b;
    });
    const msgEl = document.createElement('div');
    msgEl.className = 'und-msg';
    msgEl.setAttribute('aria-live', 'polite');
    gAsk.appendChild(msgEl);

    const resetRow = document.createElement('div');
    resetRow.style.display = 'flex';
    controls.appendChild(resetRow);
    button(resetRow, '↺ Reset', () => {
      st.dev = DEFAULTS.dev;
      st.ring = DEFAULTS.ring;
      st.setting = DEFAULTS.setting;
      for (const k of Object.keys(memory)) delete memory[k as P.DeviceId];
      tRing.set(st.ring);
      clearTune();
      syncDeviceControls();
      update();
    });

    note(
      controls,
      station,
      "In a bending magnet, electrons follow one curved segment and emit a broad spectrum. In a wiggler, strong alternating bends with K ≫ 1 produce 2N radiation pulses whose intensities add, giving about 2N times the bending-magnet intensity. In an undulator, K is up to a few. Radiation from N periods interferes constructively at narrow harmonic energies. The line width scales as 1/nN for harmonic n, and the on-axis peak scales as N², thousands of times a bending-magnet value. The illustrated wiggler has a 15 cm period, 1.6 T field and 16 periods. It is not an APS device.",
    );
    note(
      controls,
      station,
      "Superconducting undulator fields come from niobium-titanium coils cooled to 4.2 K, or −269 °C, with a fixed 8.0 mm gap. Permanent-magnet field decreases rapidly as gap grows relative to period. At a 16.5 mm period, the superconducting field is 1.06 T, compared with ≈0.52 T for permanent magnets; K is 1.63 versus ≈0.8. Stronger fields retain higher harmonic intensity above ~50 keV, with about 3× higher brightness there. Eight superconducting undulators were planned for APS-U, in pairs at sectors 1, 11, 20 for HEXM and 28 for CHEX. None was installed as of September 2026 because of core reliability problems. Interim permanent-magnet undulators are in use.",
    );
    const noteEls = [...controls.querySelectorAll<HTMLElement>('.stn-note')];

    // ------------------------------------------------------------ actions

    function defaultSetting(dev: P.Device): number {
      if (dev.kind === 'scu') return 0.8;
      if (dev.id === DEFAULTS.dev) return DEFAULTS.setting;
      return Math.round(P.settingForK(dev, Math.min(dev.kRef, 1.75)) * 20) / 20;
    }

    function pickDevice(id: P.DeviceId): void {
      if (id === st.dev) return;
      memory[st.dev] = st.setting;
      st.dev = id;
      st.setting = memory[id] ?? defaultSetting(P.DEVICES[id]);
      clearTune();
      syncDeviceControls();
      update();
    }

    function syncDeviceControls(): void {
      const d = device();
      const pm = d.kind === 'pm';
      tPM.set(pm ? st.dev : '');
      tSC.set(pm ? '' : st.dev);
      const inp = sSet.input;
      if (pm) {
        inp.min = String(d.gapMinMm);
        inp.max = String(d.gapMaxMm);
        inp.step = '0.05';
      } else {
        inp.min = String(P.SCU_FRAC_MIN * 100);
        inp.max = '100';
        inp.step = '1';
      }
      sSet.set(pm ? st.setting : st.setting * 100);
      applyLabels();
    }

    function clearTune(): void {
      st.tunedN = null;
      st.preset = null;
      msg = null;
    }

    function tune(E: number, preset: number | null): void {
      const d = device();
      const r = ring();
      const t = P.tuneTo(d, r, E);
      st.preset = preset;
      if (!t) {
        st.tunedN = null;
        msg = { text: whyNot(E), bad: true };
      } else {
        st.setting = t.setting;
        st.tunedN = t.n;
        const where = d.kind === 'pm' ? `gap ${t.setting.toFixed(2)} mm` : `${Math.round(t.setting * 100)} % coil current`;
        // point to a clearly better device (×2 or more on-axis flux at this energy)
        const alt = P.bestDevice(r, E);
        let tip = '';
        if (alt && alt.id !== d.id && alt.tune.flux > 2 * t.flux) {
          const ad = P.DEVICES[alt.id];
          const x = fmtX(alt.tune.flux / t.flux);
          tip = ` About ${x}× more flux is calculated for the ${ad.short} mm${ad.kind === 'scu' ? ' superconducting' : ''} undulator at its ${P.ordinal(alt.tune.n)} harmonic.`;
        }
        msg = {
          text: `At ${P.fmtKeV(E)} keV, use the ${P.ordinal(t.n)} harmonic with ${where} and K = ${t.K.toFixed(2)}. Calculated on-axis flux is ${P.fmtSci(t.flux)} photons/s/mrad² in 0.1 % bandwidth.${tip}`,
          bad: false,
        };
        sSet.set(d.kind === 'pm' ? st.setting : st.setting * 100);
      }
      update();
    }

    function whyNot(E: number): string {
      const d = device();
      const r = ring();
      const alt = P.bestDevice(r, E);
      const altTxt = alt
        ? ` Try the ${P.DEVICES[alt.id].short} mm${P.DEVICES[alt.id].kind === 'scu' ? ' superconducting' : ''} undulator at its ${P.ordinal(alt.tune.n)} harmonic.`
        : " No modeled undulator has an accessible harmonic at this energy.";
      const [lo1] = P.harmonicRange(1, d, r);
      if (E < lo1) return `${P.fmtKeV(E)} keV is below this undulator's minimum first-harmonic energy of ${P.fmtKeV(lo1)} keV.${altTxt}`;
      for (let n = 1; n < 41; n += 2) {
        const [, hiN] = P.harmonicRange(n, d, r);
        const [loM] = P.harmonicRange(n + 2, d, r);
        if (E > hiN && E < loM)
          return `${P.fmtKeV(E)} keV lies between tuning bands. The ${P.ordinal(n)} harmonic extends to ${P.fmtKeV(hiN)} keV, and the ${P.ordinal(n + 2)} harmonic starts at ${P.fmtKeV(loM)} keV.${altTxt}`;
      }
      return `No accessible harmonic for this device at ${P.fmtKeV(E)} keV.${altTxt}`;
    }

    scene.onDrag = (dy) => {
      const d = device();
      const [lo, hi] = P.settingRange(d);
      st.setting = Math.max(lo, Math.min(hi, st.setting + (dy * (hi - lo)) / 170));
      sSet.set(d.kind === 'pm' ? st.setting : st.setting * 100);
      clearTune();
      update(true);
    };

    // ------------------------------------------------------------ text

    /** labels that depend on the device kind (permanent magnets: gap; superconducting: coil current) */
    function applyLabels(): void {
      const d = device();
      setSliderLabel(sSet.input, d.kind === 'pm' ? 'Magnetic gap' : "Coil current · % of full");
      rPM.el.style.display = d.kind === 'scu' ? '' : 'none';
      presetBtns.forEach((b, i) => (b.title = `Tune to ${PRESETS[i]} keV using the odd harmonic and ${d.kind === 'pm' ? 'gap' : 'current'} with maximum on-axis flux`));
    }

    function caption(): string {
      const d = device();
      const r = ring();
      const B0 = P.fieldAt(d, st.setting);
      const K = P.kOf(B0, d.periodMm);
      const e1 = P.energyN(1, r.E, d.periodMm, K);
      const lam1 = P.lambdaN(1, r.E, d.periodMm, K);
      const pm = d.kind === 'pm';
      const eV = (rel: number) => Math.round(rel * e1 * 1000);
      const lead = pm
        ? `Gap is ${st.setting.toFixed(1)} mm, peak field is ${B0.toFixed(2)} T and deflection parameter K = ${K.toFixed(2)}.`
        : `Coil current is ${Math.round(st.setting * 100)} %, peak field is ${B0.toFixed(2)} T and deflection parameter K = ${K.toFixed(2)}.`;
      let v = `${lead} Electrons emit radiation along the oscillating trajectory. Their average forward speed is below the speed of light, so light advances by one first-harmonic wavelength per period. This is called slippage. Radiation from ${d.N} periods interferes constructively at ${P.fmtKeV(e1)} keV, with wavelength ${lam1 < 1 ? lam1.toFixed(3) : lam1.toFixed(2)} Å. Natural line width is ${eV(P.naturalWidth(1, d.N))} eV, increasing to ${eV(P.spreadFwhm(1, d.N, r.sigmaE))} eV with electron energy spread, as shown in the enlarged plot. Odd harmonics occur at 3× and 5× the energy, ${P.fmtKeV(3 * e1)} and ${P.fmtKeV(5 * e1)} keV.`;
      if (K < 0.8) v += " At K < 1, the electric field is nearly sinusoidal and most radiation is in the first harmonic.";
      else if (K > 1.6) v += " At K > 1, the emission cone with half-angle 1/γ crosses the axis in short pulses, increasing higher-harmonic intensity.";
      v += pm ? " Reducing the gap lowers photon energy; increasing it raises the energy." : " At this short period, superconducting coils provide a stronger field than permanent magnets.";
      if (st.ring === 'aps') {
        const worse = P.peakFlux(1, K, d, P.RINGS.apsu) / P.peakFlux(1, K, d, r);
        v += ` At the old APS energy of 7 GeV, every harmonic is 36 % higher in energy. Current was 100 mA and electron angular spread was larger${worse >= 1.5 ? `, giving about ${fmtX(worse)}× less` : ', giving less'} on-axis flux. This comparison retains the selected undulator and gap. The old vacuum chambers required gaps of at least ~10.5 mm. The 6 GeV APS-U beam has lower emittance. Shorter periods and smaller gaps compensate for the lower photon energies.`;
      }
      if (st.tunedN && msg && !msg.bad) v += ` The selected energy uses the ${P.ordinal(st.tunedN)} harmonic.`;
      return v;
    }

    /**
     * Canvases follow every input at once. The DOM text (read-outs, hints, captions) is re-written at most every
     * TEXT_MS while the gap is being dragged (`live`), plus once at the end: each write costs a style/layout pass,
     * which on a slow laptop otherwise eats the frame budget.
     */
    const TEXT_MS = 120;
    let textTimer = 0;
    let lastText = -1e9;
    function update(live = false): void {
      const d = device();
      const r = ring();
      const K = P.kAt(d, st.setting);
      const lam1 = P.lambdaN(1, r.E, d.periodMm, K);
      scene.set(sceneInput());
      const zn = st.tunedN ?? 1;
      wave.set(K, lam1, { n: zn, En: P.energyN(zn, r.E, d.periodMm, K), N: d.N, sigmaE: r.sigmaE });
      spectrum.set({ dev: d, ring: r, setting: st.setting, tunedN: st.tunedN });
      if (live) {
        const wait = TEXT_MS - (performance.now() - lastText);
        if (wait > 0) {
          if (!textTimer)
            textTimer = window.setTimeout(() => {
              textTimer = 0;
              updateText();
            }, wait);
          return;
        }
      }
      if (textTimer) {
        clearTimeout(textTimer);
        textTimer = 0;
      }
      updateText();
    }

    function updateText(): void {
      lastText = performance.now();
      const d = device();
      const r = ring();
      const B0 = P.fieldAt(d, st.setting);
      const K = P.kOf(B0, d.periodMm);
      const e1 = P.energyN(1, r.E, d.periodMm, K);
      const lam1 = P.lambdaN(1, r.E, d.periodMm, K);
      const g = P.gammaOf(r.E);

      rE1.set(`${P.fmtKeV(e1)} keV`);
      rLam.set(`${lam1 < 1 ? lam1.toFixed(3) : lam1.toFixed(2)} Å`);
      rB.set(`${B0.toFixed(2)} T`);
      rK.set(K.toFixed(2));
      const amp = ((K * d.periodMm * 1e-3) / (2 * Math.PI * g)) * 1e6; // µm
      rAmp.set(`±${amp < 0.1 ? amp.toFixed(3) : amp.toFixed(2)} µm`);
      const flux = P.peakFlux(1, K, d, r);
      const gain = flux / P.bendingMagnet(e1, r.E, r.I, r.bmB);
      rGain.set(`×${P.fmtRound(gain)}`);
      rGam.set(`${(1e6 / g).toFixed(0)} µrad`);
      const ev = (rel: number) => Math.round(rel * e1 * 1000);
      rW.set(`${ev(P.naturalWidth(1, d.N))} → ${ev(P.spreadFwhm(1, d.N, r.sigmaE))} eV`);
      if (d.kind === 'scu') {
        const bpm = P.pmFieldEstimate(d.gapMinMm, d.periodMm);
        rPM.set(`${bpm.toFixed(2)} T, K ${P.kOf(bpm, d.periodMm).toFixed(2)}`);
      }
      put(
        outHint,
        md(
          `First-harmonic on-axis flux is ${P.fmtRound(gain)}× the bending-magnet value, or ${P.fmtSci(flux)} photons/s/mrad² in 0.1 % bandwidth. The estimate includes electron energy and angular spread and small magnet errors. It omits angular-spread broadening of the lines, source size and off-axis even harmonics. One ${d.lengthM} m device has N = ${d.N}; two inline devices phased together correspond to 2N. The electron trajectory amplitude is ±${amp < 0.1 ? amp.toFixed(3) : amp.toFixed(2)} µm, about 1/${P.fmtRound(HAIR_UM / amp)} of the reference hair diameter. The trajectory is magnified in panel 1.`,
        ),
      );
      const [lo1, hi1] = P.harmonicRange(1, d, r);
      if (d.kind === 'pm') {
        put(
          setHint,
          md(
            `The vacuum chamber lies within the ${d.gapMinMm} to ${d.gapMaxMm} mm magnetic gap. Over that range, K decreases from ${d.kRef.toFixed(2)} to ${P.kAt(d, d.gapMaxMm).toFixed(2)}, giving first-harmonic energies from ${P.fmtKeV(lo1)} to ${P.fmtKeV(hi1)} keV. ${d.name}, N = ${d.N}. ${d.status}.`,
          ),
        );
      } else {
        put(
          setHint,
          md(
            `The gap is fixed at 8.0 mm. Field is proportional to coil current in this model, which omits iron saturation. Maximum K is ${d.kRef} at ${P.fieldAt(d, 1).toFixed(2)} T. First-harmonic energy extends from ${P.fmtKeV(lo1)} to ${P.fmtKeV(hi1)} keV. ${d.name}, N = ${d.N}. ${d.status}.`,
          ),
        );
      }
      const gTxt = Math.round(g).toLocaleString('en-US');
      put(
        ringHint,
        md(
          st.ring === 'apsu'
            ? `Electron energy is 6.0 GeV and current is 200 mA. The relativistic factor γ = ${gTxt} is energy divided by rest energy. Flat-beam emittance is about 42 pm·rad, with angular spread ${r.divX} × ${r.divY} µrad. Harmonic energies scale with squared electron energy: (6/7)² = 0.73 of the 7 GeV values. Relative energy spread is ${(r.sigmaE * 100).toFixed(3)} %.`
            : `Electron energy is 7.0 GeV, γ = ${gTxt}, current is 100 mA and emittance is 3.1 nm·rad. Angular spread is ${r.divX} × ${r.divY} µrad, and relative energy spread is ${(r.sigmaE * 100).toFixed(3)} %. Higher energy raises harmonic energies, but greater angular spread lowers on-axis flux. The selected undulator and gap are unchanged.`,
        ),
      );
      presetBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(st.preset === PRESETS[i] && st.tunedN !== null)));
      put(msgEl, msg ? md(msg.text) : md("Click a spectrum energy to tune."));
      msgEl.classList.toggle('is-bad', !!msg?.bad);
      const v = caption();
      // only touch the DOM when the text changed (every write forces a style/layout pass)
      if (v !== lastCap) {
        lastCap = v;
        station.setCaption(v);
      }
    }

    let lastCap = '';

    function sceneInput() {
      return { dev: device(), ring: ring(), setting: st.setting };
    }

    // The caption only grows while the layout/width stay the same: a shrinking caption would resize the canvases
    // (re-allocating their backing stores) every time the gap changes.
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
      const mode = w >= 980 ? 'wide' : w >= 700 ? 'mid' : 'narrow';
      const wideCol = mode === 'wide' && w >= 1180;
      const key = `${mode}|${wideCol}`;
      if (key === layoutMode) return;
      resetCaptionHeight();
      layoutMode = key;
      const stack = mode !== 'wide';
      root.classList.toggle('stn-stack', stack);
      root.classList.toggle('stn-side', !stack);
      root.style.height = stack ? '100%' : '';
      root.style.overflowY = stack ? 'auto' : '';
      root.style.scrollbarWidth = stack ? 'thin' : '';
      controls.style.overflowY = stack ? 'visible' : '';
      const vs = visual.style;
      const v2 = visual2.style;
      const sw = wrapOf(cScene).style;
      const wide = mode === 'wide';
      // see the wide branch below
      vs.contain = wide ? 'size' : '';
      for (const c of [cSpec, cWave]) wrapOf(c).style.minHeight = wide ? `${WIDE_LOWER_MIN_PX}px` : '';
      for (const n of noteEls) n.style.gridColumn = stack ? '1 / -1' : '';
      // stacked: the read-outs get the full width and flow into columns instead of squeezing their labels
      gOut.classList.toggle('und-out-grid', stack);
      gOut.style.gridColumn = stack ? '1 / -1' : '';
      gAsk.style.gridColumn = mode === 'narrow' ? '1 / -1' : '';
      // wide screens: a wider control column, so the main controls and the presets fit above the fold
      root.style.gridTemplateColumns = wideCol ? 'minmax(0,1fr) 300px' : '';
      if (mode === 'narrow') {
        // scene → main controls (+ reset) → wave + spectrum → presets, read-outs, notes → caption
        visual2.append(wrapOf(cWave), wrapOf(cSpec));
        ctlA.append(guideEl, gDev, gRing, resetRow);
        controls.prepend(gAsk);
        gAsk.after(gOut);
        root.style.gridTemplateRows = 'repeat(5, max-content)';
        root.append(visual, ctlA, visual2, controls, station.caption);
        vs.gridTemplateColumns = 'minmax(0,1fr)';
        vs.gridTemplateRows = w < 420 ? '250px' : '270px';
        vs.minHeight = '';
        sw.gridColumn = '';
        v2.gridTemplateColumns = 'minmax(0,1fr)';
        v2.gridTemplateRows = '270px 320px';
        v2.minHeight = '';
        return;
      }
      visual.append(wrapOf(cSpec), wrapOf(cWave));
      // guide → device → electrons → presets → reset → read-outs → notes
      controls.prepend(guideEl);
      guideEl.after(gDev);
      gDev.after(gRing);
      gRing.after(gAsk);
      gAsk.after(resetRow);
      resetRow.after(gOut);
      visual2.remove();
      ctlA.remove();
      root.append(visual, controls, station.caption);
      vs.gridTemplateColumns = 'minmax(0,1.45fr) minmax(0,1fr)';
      sw.gridColumn = '1 / -1';
      if (wide) {
        // The panels take whatever height the host leaves above the caption (its grid row is minmax(min-content,
        // 1fr)), down to a floor: the station fits short dialogs (the story at 1440×900, 1280×800) without
        // scrolling them; only a host shorter than the floor scrolls. Rows keep 1 : 1.12 while there is room; below
        // that the lower row holds its minimum (the panel 2 / spectrum wraps' min-height, via min-content) and the
        // top view gives way. Size containment keeps that ratio out of the visual's own min-content height (a
        // contained grid sizes as if empty, so its min-content row is 0): the floor is only min-height.
        root.style.gridTemplateRows = '';
        vs.gridTemplateRows = 'minmax(0,1fr) minmax(min-content,1.12fr)';
        vs.minHeight = `${WIDE_VISUAL_MIN_PX}px`;
      } else {
        root.style.gridTemplateRows = 'repeat(3, max-content)';
        vs.gridTemplateRows = '300px 320px';
        vs.minHeight = '';
      }
    };
    const ro = new ResizeObserver(() => applyLayout());
    ro.observe(host);
    station.onDestroy(() => {
      ro.disconnect();
      capRo.disconnect();
      cancelAnimationFrame(capRaf);
      if (textTimer) clearTimeout(textTimer);
    });

    // ------------------------------------------------------------ start
    syncDeviceControls();
    applyLayout();
    update();

    loop(station, (dt) => {
      if (motion.on) {
        scene.frame(dt);
        wave.frame(dt);
      } else {
        scene.still();
        wave.still();
      }
      if (spectrum.dirty) spectrum.draw();
    });

    return { destroy: () => station.destroy() };
  },
};
export default mod;

/** innerHTML write that is skipped when nothing changed */
const htmlCache = new WeakMap<HTMLElement, string>();
function put(el: HTMLElement, html: string): void {
  if (htmlCache.get(el) === html) return;
  htmlCache.set(el, html);
  el.innerHTML = html;
}

/** readout whose set() only writes to the DOM when the text changes */
function cachedSet<T extends { set(v: string): void }>(r: T): T {
  const raw = r.set.bind(r);
  let last: string | null = null;
  r.set = (v: string) => {
    if (v === last) return;
    last = v;
    raw(v);
  };
  return r;
}

/** ratio for text: 1.6, 7.5 → "1.6", "8"; 23,412 → "23,000" */
function fmtX(r: number): string {
  if (r < 2.95) return r.toFixed(1);
  if (r < 100) return String(Math.round(r));
  return P.fmtRound(r);
}

function setSliderLabel(input: HTMLInputElement, text: string): void {
  const l = input.parentElement?.querySelector('.stn-slider-label');
  if (l) l.textContent = text;
}
