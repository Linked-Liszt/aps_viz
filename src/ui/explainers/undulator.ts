/**
 * Station "undulator" — "How an undulator makes X-rays".
 *
 * One idea: an electron wiggling through N alternating magnets emits a flash per wiggle; because it runs almost as
 * fast as its own light, it slips back by exactly one X-ray wavelength per period, so the N flashes add up in step
 * → sharp, tunable colours (odd harmonics), ~N² brighter on axis than a single bend. Close the gap → stronger field
 * → bigger K → more slippage → longer wavelength → lower photon energy.
 *
 * Panels
 *   1. ./undulator/scene.ts    — the magnet array from above, trajectory, 1/γ cone, slipping wave crests, end view.
 *   2. ./undulator/wave.ts     — on-axis field E_x(t) (Liénard–Wiechert), its harmonic content F_n(K) and a zoom on
 *                                one line: sinc² of width 0.886/(nN) (+ energy-spread broadening, dashed).
 *   3. ./undulator/spectrum.ts — on-axis spectrum (ph/s/mrad²/0.1 % BW) with tuning bands, BM and wiggler.
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
  title: 'How an undulator makes X-rays',
  subtitle: 'Squeeze the magnets together and watch the wiggle, the light and the X-ray colours change.',
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
    const cScene = canvas2d(visual, { label: '1 · Inside the undulator, seen from above' });
    const cSpec = canvas2d(visual, { label: '3 · Spectrum straight ahead (approx.)' });
    const cWave = canvas2d(visual, { label: '2 · The X-ray wave reaching the beamline' });
    cScene.canvas.setAttribute('aria-label', 'Animated top view of an undulator: an electron wiggles between alternating magnets and emits X-ray wave crests. Drag up or down to change the gap.');
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
      '**Close the gap** with the slider (or drag up/down on the magnets): stronger field, bigger wiggle — and *lower*-energy X-rays. **Click the spectrum** or a preset to ask for any energy: like a beamline’s energy scan, the station then picks the gap and the lowest odd harmonic that gives at least 80 % of the best flux straight ahead.',
    );
    const guideEl = controls.lastElementChild as HTMLElement;

    const gDev = group(controls, 'Undulator');
    const optsPM = P.PM_IDS.map((id) => ({ value: id as Dev, label: P.DEVICES[id].short, title: `${P.DEVICES[id].name}: ${P.DEVICES[id].periodMm} mm period, ${P.DEVICES[id].N} periods — ${P.DEVICES[id].status}` }));
    const optsSC = P.SCU_IDS.map((id) => ({ value: id as Dev, label: P.DEVICES[id].short, title: `${P.DEVICES[id].name}: ${P.DEVICES[id].periodMm} mm period, ${P.DEVICES[id].N} periods — ${P.DEVICES[id].status}` }));
    const tPM = toggle<Dev>(gDev, { label: 'Magnet period λu (mm) · permanent magnets', options: optsPM, value: st.dev, onChange: (v) => v && pickDevice(v) });
    const tSC = toggle<Dev>(gDev, { label: '…or superconducting (planned)', options: optsSC, value: '', onChange: (v) => v && pickDevice(v) });
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
    const motion = motionGate(station, gDev, { title: 'Your device asks for reduced motion, so the electron and the wave hold still. Press to set them moving.' });

    const gRing = group(controls, 'Electron beam');
    const tRing = toggle<P.RingId>(gRing, {
      label: 'Electron energy',
      options: [
        { value: 'aps', label: '7 GeV (old APS)', title: 'APS 1995–2023: 7 GeV, 100 mA' },
        { value: 'apsu', label: '6 GeV (APS-U)', title: 'APS Upgrade 2024–: 6 GeV, 200 mA' },
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

    const gOut = group(controls, 'What comes out');
    const rE1 = cachedSet(readout(gOut, '1st harmonic', { big: true, color: accent }));
    const rLam = cachedSet(readout(gOut, '…its wavelength λ₁'));
    const rB = cachedSet(readout(gOut, 'Peak magnetic field B₀'));
    const rK = cachedSet(readout(gOut, 'Wiggle strength K'));
    const rAmp = cachedSet(readout(gOut, 'Real wiggle size'));
    const rGain = cachedSet(readout(gOut, 'On-axis flux vs a bending magnet'));
    const rGam = cachedSet(readout(gOut, 'Light cone half-angle 1/γ'));
    const rW = cachedSet(readout(gOut, 'Line width, 1st harmonic'));
    const rPM = cachedSet(readout(gOut, 'Magnets at the same period & gap'));
    const outHint = document.createElement('div');
    outHint.className = 'stn-hint';
    gOut.appendChild(outHint);
    // long label + value pairs take a full row when the read-outs flow into a grid (stacked layouts)
    for (const r of [rGain, rW]) r.el.style.gridColumn = '1 / -1';

    const gAsk = group(controls, 'Ask for an X-ray energy');
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
      '**Three ways to make X-rays.** A *bending magnet* curves the beam once: one sweep of light, a broad spectrum. A *wiggler* bends it hard back and forth (K ≫ 1): 2N separate flashes that add up in intensity — broad again, but 2N times stronger. An *undulator* wiggles it gently (K up to a few): the light from all N periods arrives as one wave train and adds **in step**, piling into narrow lines (width ∝ 1/nN for harmonic n) whose peak straight ahead grows as N² — thousands of times a bending magnet’s. The wiggler curve is an illustrative example (15-cm period, 1.6 T, 16 periods), not an APS device.',
    );
    note(
      controls,
      station,
      '**Superconducting undulators** (SCUs) use coils of niobium-titanium wire cooled to 4.2 K (−269 °C) instead of permanent magnets, at a fixed 8.0-mm gap. A permanent-magnet field falls off steeply as the gap grows relative to the period, so at a short period it is weak; an SCU makes about twice the field — 1.06 T against ≈ 0.52 T at a 16.5-mm period (K = 1.63 against ≈ 0.8) — and keeps its harmonics strong above ~50 keV, about 3× brighter there. Eight were planned for APS-U, in pairs at sectors 1, 11, 20 (HEXM) and 28 (CHEX); as of September 2026 none has been installed (problems with core reliability), and those beamlines run on stand-in permanent-magnet undulators.',
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
          tip = ` The ${ad.short}-mm${ad.kind === 'scu' ? ' superconducting' : ''} undulator (${P.ordinal(alt.tune.n)} harmonic) would give about ${x}× more.`;
        }
        msg = {
          text: `**${P.fmtKeV(E)} keV:** use the **${P.ordinal(t.n)} harmonic** — ${where}, K = ${t.K.toFixed(2)}: ${P.fmtSci(t.flux)} photons/s/mrad² in 0.1 % bandwidth on axis.${tip}`,
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
        ? ` Try the **${P.DEVICES[alt.id].short} mm**${P.DEVICES[alt.id].kind === 'scu' ? ' superconducting' : ''} undulator (${P.ordinal(alt.tune.n)} harmonic).`
        : ' None of these undulators reaches it.';
      const [lo1] = P.harmonicRange(1, d, r);
      if (E < lo1) return `**${P.fmtKeV(E)} keV is too low** for this undulator: its 1st harmonic goes down only to ${P.fmtKeV(lo1)} keV.${altTxt}`;
      for (let n = 1; n < 41; n += 2) {
        const [, hiN] = P.harmonicRange(n, d, r);
        const [loM] = P.harmonicRange(n + 2, d, r);
        if (E > hiN && E < loM)
          return `**${P.fmtKeV(E)} keV falls in a gap:** the ${P.ordinal(n)} harmonic only reaches ${P.fmtKeV(hiN)} keV and the ${P.ordinal(n + 2)} starts at ${P.fmtKeV(loM)} keV.${altTxt}`;
      }
      return `**${P.fmtKeV(E)} keV** is out of reach for this device.${altTxt}`;
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
      setSliderLabel(sSet.input, d.kind === 'pm' ? 'Magnetic gap' : 'Coil current (% of full)');
      rPM.el.style.display = d.kind === 'scu' ? '' : 'none';
      presetBtns.forEach((b, i) => (b.title = `Tune to ${PRESETS[i]} keV: the odd harmonic and ${d.kind === 'pm' ? 'gap' : 'current'} with the most flux straight ahead`));
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
        ? `**Gap ${st.setting.toFixed(1)} mm → peak field ${B0.toFixed(2)} T → wiggle strength K = ${K.toFixed(2)}.**`
        : `**Coil current ${Math.round(st.setting * 100)} % → peak field ${B0.toFixed(2)} T → wiggle strength K = ${K.toFixed(2)}.**`;
      let v = `${lead} At every wiggle the electron sends out a flash of light. It runs almost as fast as its own light, so by the next wiggle it has fallen behind by exactly one wavelength (the *slippage*), and the flashes from all ${d.N} periods add up *in step* into one sharp line: **${P.fmtKeV(e1)} keV** (wavelength ${lam1 < 1 ? lam1.toFixed(3) : lam1.toFixed(2)} Å), just ${eV(P.naturalWidth(1, d.N))} eV wide (${eV(P.spreadFwhm(1, d.N, r.sigmaE))} eV with the electrons’ energy spread; see the zoom), plus odd harmonics at 3× and 5× (${P.fmtKeV(3 * e1)} and ${P.fmtKeV(5 * e1)} keV).`;
      if (K < 0.8) v += ' The wiggle is gentle (K < 1), so the wave is an almost pure ripple: nearly all the light is in the 1st harmonic.';
      else if (K > 1.6) v += ' The wiggle is strong (K > 1): the light cone (half-angle 1/γ) sweeps across the axis in sharp flashes, so the higher harmonics are bright too.';
      v += pm ? ' **Close the gap** and the energy drops; open it and it rises.' : ' Superconducting coils reach a stronger field than magnets could at this short period.';
      if (st.ring === 'aps') {
        const worse = P.peakFlux(1, K, d, P.RINGS.apsu) / P.peakFlux(1, K, d, r);
        v += ` *Old APS (7 GeV, 100 mA): every harmonic sits 36 % higher in energy, but with half the current and a far more spread-out beam${worse >= 1.5 ? `, about ${fmtX(worse)}× less` : ', less'} light went straight ahead. This keeps today’s undulator and gap; the old ring’s chambers allowed gaps only down to ~10.5 mm. APS-U went to 6 GeV for a much smaller beam and makes up the energy with shorter periods and smaller gaps.*`;
      }
      if (st.tunedN && msg && !msg.bad) v += ` *Tuned with the ${P.ordinal(st.tunedN)} harmonic.*`;
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
          `**×${P.fmtRound(gain)}**: at the 1st harmonic, that many times more X-rays per second straight ahead (per unit solid angle) than one bending magnet gives — ${P.fmtSci(flux)} photons/s/mrad² in 0.1 % bandwidth, including the electrons’ energy and angle spreads and small magnet errors. Not modelled: line broadening by the beam’s angle spread, the source size, and the even harmonics that appear off axis. N = ${d.N} is one ${d.lengthM}-m device; two in-line devices phased together act like 2N. The real wiggle (±${amp < 0.1 ? amp.toFixed(3) : amp.toFixed(2)} µm) is about 1/${P.fmtRound(HAIR_UM / amp)} of a hair’s width — panel 1 magnifies it.`,
        ),
      );
      const [lo1, hi1] = P.harmonicRange(1, d, r);
      if (d.kind === 'pm') {
        put(
          setHint,
          md(
            `Gap ${d.gapMinMm}–${d.gapMaxMm} mm (the beam’s vacuum chamber sits in between): K from ${d.kRef.toFixed(2)} down to ${P.kAt(d, d.gapMaxMm).toFixed(2)}, so the 1st harmonic tunes from ${P.fmtKeV(lo1)} to ${P.fmtKeV(hi1)} keV. ${d.name}, N = ${d.N}: ${d.status}.`,
          ),
        );
      } else {
        put(
          setHint,
          md(
            `The gap is fixed at 8.0 mm; the field follows the coil current (in simple proportion here, ignoring iron saturation): K up to ${d.kRef} (${P.fieldAt(d, 1).toFixed(2)} T), 1st harmonic ${P.fmtKeV(lo1)}–${P.fmtKeV(hi1)} keV. ${d.name}, N = ${d.N}: **${d.status}.**`,
          ),
        );
      }
      const gTxt = Math.round(g).toLocaleString('en-US');
      put(
        ringHint,
        md(
          st.ring === 'apsu'
            ? `6.0 GeV electrons (γ = ${gTxt}: energy ÷ rest energy), 200 mA. The new ring squeezes the beam to about 42 pm·rad (angle spread ${r.divX} × ${r.divY} µrad, flat-beam values), but harmonic energies scale with the electron energy squared: (6/7)² = 0.73 of the 7-GeV values. Energy spread ${(r.sigmaE * 100).toFixed(3)} %.`
            : `7.0 GeV electrons (γ = ${gTxt}), 100 mA, emittance 3.1 nm·rad (angle spread ${r.divX} × ${r.divY} µrad), energy spread ${(r.sigmaE * 100).toFixed(3)} %: higher harmonic energies, but a far more spread-out beam, so less light straight ahead. Same undulator and gap as selected.`,
        ),
      );
      presetBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(st.preset === PRESETS[i] && st.tunedN !== null)));
      put(msgEl, msg ? md(msg.text) : md('…or click anywhere on the spectrum.'));
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
