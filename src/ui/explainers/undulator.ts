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
 *                                one line: sinc² of width 0.886/(nN) (+ energy-spread broadening for specialists).
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
import type { Depth } from '../../app/store';
import type { ExplainerModule } from './registry';
import { button, canvas2d, createStation, group, loop, md, motionGate, note, readout, slider, toggle, type Canvas2D } from './kit';
import * as P from './undulator/physics';
import { UndulatorScene } from './undulator/scene';
import { WaveView } from './undulator/wave';
import { SpectrumView } from './undulator/spectrum';

type Dev = P.DeviceId | '';

/** width of a human hair (µm), for the visitor's sense of scale */
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
.und-root .stn-canvas-label .und-sym { text-transform: none; letter-spacing: 0; font-size: 11.5px; }
.und-root .stn-canvas-label sub { font-size: 0.75em; }
.und-root .stn-readout-label { min-width: 0; }
.und-out-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 8px 10px; }
.und-out-grid > .stn-group-title, .und-out-grid > .stn-hint, .und-out-grid > .stn-readout.is-big { grid-column: 1 / -1; }
`;

const mod: ExplainerModule = {
  title: 'How an undulator makes X-rays',
  subtitle: 'Squeeze the magnets together and watch the wiggle, the light and the X-ray colours change.',
  mount(host, ctx) {
    const accent = ctx.color || '#5cd3ff';
    const station = createStation(host, { depth: ctx.depth, color: accent, layout: 'side' });
    const { visual, controls, root } = station;
    root.classList.add('und-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    let depth: Depth = ctx.depth;
    const st = { dev: DEFAULTS.dev, ring: DEFAULTS.ring, setting: DEFAULTS.setting, tunedN: null as number | null, preset: null as number | null };
    const memory: Partial<Record<P.DeviceId, number>> = {};
    let msg: { text: string; bad: boolean } | null = null;
    const device = () => P.DEVICES[st.dev];
    const ring = () => P.RINGS[st.ring];

    // ------------------------------------------------------------ canvases
    const cScene = canvas2d(visual, { label: ' ' });
    const cSpec = canvas2d(visual, { label: ' ' });
    const cWave = canvas2d(visual, { label: ' ' });
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
      '**Close the gap** with the slider (or drag up/down on the magnets): stronger field, bigger wiggle — and *lower*-energy X-rays. **Click the spectrum** to ask for any energy.',
      '**Gap → B₀ → K → E_{n}.** Drag the slider or the magnets. Click the spectrum or a preset: the station picks harmonic and gap like a beamline energy scan (lowest odd n within 80 % of the best on-axis flux).',
    );
    const guideEl = controls.lastElementChild as HTMLElement;

    const gDev = group(controls, 'Undulator');
    const optsPM = P.PM_IDS.map((id) => ({ value: id as Dev, label: P.DEVICES[id].short, title: `${P.DEVICES[id].name}: ${P.DEVICES[id].periodMm} mm period, ${P.DEVICES[id].N} periods — ${P.DEVICES[id].status}` }));
    const optsSC = P.SCU_IDS.map((id) => ({ value: id as Dev, label: P.DEVICES[id].short, title: `${P.DEVICES[id].name}: ${P.DEVICES[id].periodMm} mm period, ${P.DEVICES[id].N} periods — ${P.DEVICES[id].status}` }));
    const tPM = toggle<Dev>(gDev, { label: 'Period (mm) · permanent magnets', options: optsPM, value: st.dev, onChange: (v) => v && pickDevice(v) });
    const tPMwrap = gDev.lastElementChild as HTMLElement;
    const tSC = toggle<Dev>(gDev, { label: 'Superconducting (planned)', options: optsSC, value: '', onChange: (v) => v && pickDevice(v) });
    const tSCwrap = gDev.lastElementChild as HTMLElement;
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

    const gRing = group(controls, 'Electrons');
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
    const tRingWrap = gRing.lastElementChild as HTMLElement;
    const ringHint = document.createElement('div');
    ringHint.className = 'stn-hint';
    gRing.appendChild(ringHint);

    const gOut = group(controls, 'What comes out');
    const rE1 = cachedSet(readout(gOut, '1st harmonic', { big: true, color: accent }));
    const rB = cachedSet(readout(gOut, 'Magnetic field'));
    const rK = cachedSet(readout(gOut, 'Wiggle strength K'));
    const rAmp = cachedSet(readout(gOut, 'Real wiggle'));
    const rGain = cachedSet(readout(gOut, 'vs bending magnet'));
    const rGam = cachedSet(readout(gOut, 'γ · 1/γ'));
    const rW = cachedSet(readout(gOut, 'Line width'));
    const rPM = cachedSet(readout(gOut, 'PM, same λu & gap'));
    const outHint = document.createElement('div');
    outHint.className = 'stn-hint';
    gOut.appendChild(outHint);
    // long label + value pairs take a full row when the read-outs flow into a grid (stacked layouts)
    for (const r of [rGain, rW]) r.el.style.gridColumn = '1 / -1';
    const rowLabel = (r: { el: HTMLElement }) => r.el.querySelector('.stn-readout-label') as HTMLElement;

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
      '**Three ways to make X-rays.** A *bending magnet* curves the beam once: one long sweep of light, a broad and dim rainbow. A *wiggler* bends it hard back and forth: many separate flashes, broad again but brighter. An *undulator* wiggles it gently: the flashes overlap and add **in step**, piling the light into sharp colours — thousands of times brighter straight ahead.',
      '**BM vs wiggler vs undulator.** BM: E_{c} = 0.665E²B; d²F/dθdψ = 1.327×10¹³E²I·H₂(E/E_{c}), H₂(y) = y²K²_{2/3}(y/2). Wiggler (K ≫ 1: sweep K/γ ≫ 1/γ): the observer sees 2N separate pulses that add in intensity → 2N × BM at E_{c}(B₀). Undulator (K ≲ few): the field of all N periods arrives as one wave train → lines at nω₁, on-axis peak ∝ N², width ∝ 1/(nN); angle-integrated flux ∝ N. The wiggler curve is illustrative (λ = 15 cm, 1.6 T, N = 16), not an APS device.',
    );
    note(
      controls,
      station,
      '**Superconducting undulators** use coils of niobium-titanium wire cooled to −269 °C instead of permanent magnets. At a short period they make about twice the field, so their colours stay strong at very high energies (above ~50 keV). Eight were planned for APS-U; as of September 2026 none has been installed yet — the beamlines run on stand-in magnet undulators.',
      '**Why SCUs.** Hybrid-PM fields fall as ≈ exp(−5.07 g/λu): at short λu and fixed gap, K is small, so E₁ barely tunes and high harmonics are weak. NbTi at 4.2 K, 8.0 mm magnetic gap (6.3 mm chamber aperture): B₀ = 1.06 T at λu = 16.5 mm (K = 1.63) vs ≈ 0.52 T for PM (K ≈ 0.8) → ~3× brightness above 50 keV (APS Strategic Plan 2025). Tuned by current at fixed gap. Planned (8, FDR Table 3.24; Strategic Plan 2025): 16.5 mm in-line pairs at 1-ID and 20-ID (HEXM; 1.9 m), a 16.5 mm canted pair at 11-ID (1.5 m), an 18.5 mm canted pair at 28-ID (CHEX; 1.2–1.3 m). None installed as of Sep 2026 (core-reliability problems); B₀ ∝ I here ignores iron saturation.',
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
      applyDepthLabels();
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
        const where = d.kind === 'pm' ? `gap ${t.setting.toFixed(2)} mm` : `${Math.round(t.setting * 100)} % current`;
        const spec = depth === 'specialist';
        // point to a clearly better device (×2 or more on-axis flux at this energy)
        const alt = P.bestDevice(r, E);
        let tip = '';
        if (alt && alt.id !== d.id && alt.tune.flux > 2 * t.flux) {
          const ad = P.DEVICES[alt.id];
          const x = fmtX(alt.tune.flux / t.flux);
          tip = spec
            ? ` ${ad.name} (n = ${alt.tune.n}) would give ×${x}.`
            : ` The ${ad.short}-mm${ad.kind === 'scu' ? ' superconducting' : ''} undulator would give about ${x}× more.`;
        }
        msg = {
          text: spec
            ? `**${P.fmtKeV(E)} keV** on n = ${t.n}: K = ${t.K.toFixed(3)}, ${where}, ${P.fmtSci(t.flux)} ph/s/mrad²/0.1%BW.${tip}`
            : `**${P.fmtKeV(E)} keV:** use the **${P.ordinal(t.n)} harmonic** — ${where}.${tip}`,
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
      if (E < lo1) return `**${P.fmtKeV(E)} keV is too low** for this undulator: its lowest colour is ${P.fmtKeV(lo1)} keV.${altTxt}`;
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

    function applyDepthLabels(): void {
      const spec = depth === 'specialist';
      const d = device();
      // panel titles are upper-cased by the kit; symbols go in a span that keeps their case (γ must not become Γ)
      labelOf(cScene).innerHTML = spec ? `1 · Top view: poles, path, ${sym('1/γ')} cone` : '1 · Inside the undulator, seen from above';
      labelOf(cWave).innerHTML = spec ? `2 · On-axis field ${sym('E<sub>x</sub>(t)')} and line shape` : '2 · The X-ray wave reaching the beamline';
      labelOf(cSpec).textContent = spec ? '3 · On-axis spectrum (real beam, approx.)' : '3 · X-ray colours straight ahead';
      cScene.canvas.setAttribute('aria-label', 'Animated top view of an undulator: an electron wiggles between alternating magnets and emits X-ray wave crests. Drag up or down to change the gap.');
      cWave.canvas.setAttribute('aria-label', 'The electric field of the X-rays arriving on axis, its harmonic content, and a zoom on one harmonic line showing how narrow it is.');
      cSpec.canvas.setAttribute('aria-label', 'Spectrum of the undulator on axis, compared with a bending magnet and a wiggler. Click to tune to an energy.');
      (gDev.querySelector('.stn-group-title') as HTMLElement).textContent = spec ? 'Insertion device' : 'Undulator';
      (gRing.querySelector('.stn-group-title') as HTMLElement).textContent = spec ? 'Storage ring' : 'Electrons';
      (gOut.querySelector('.stn-group-title') as HTMLElement).textContent = spec ? 'Source parameters' : 'What comes out';
      (gAsk.querySelector('.stn-group-title') as HTMLElement).textContent = spec ? 'Tune to an energy' : 'Ask for an X-ray energy';
      setWrapLabel(tPMwrap, spec ? 'Hybrid PM, λu (mm)' : 'Period (mm) · permanent magnets');
      setWrapLabel(tSCwrap, spec ? 'Superconducting NbTi, λu (mm) — planned' : '…or superconducting (planned)');
      setWrapLabel(tRingWrap, spec ? 'Beam energy, current' : 'Electron energy');
      setToggleLabels(tRingWrap, spec ? ['7 GeV · 100 mA', '6 GeV · 200 mA'] : ['7 GeV (old APS)', '6 GeV (APS-U)']);
      setSliderLabel(sSet.input, d.kind === 'pm' ? (spec ? 'Magnetic gap g' : 'Magnetic gap') : spec ? 'Coil current, % of full (I/Iₘₐₓ)' : 'Coil current');
      rowLabel(rE1).innerHTML = md(spec ? 'E_{1} · λ_{1}' : '1st colour (harmonic)');
      rowLabel(rB).innerHTML = md(spec ? 'Peak field B_{0}' : 'Magnetic field');
      rowLabel(rK).innerHTML = md(spec ? 'K = 0.934 λ_{u}B_{0}' : 'Wiggle strength K');
      rowLabel(rAmp).innerHTML = md(spec ? 'x_{max} = Kλ_{u}/2πγ' : 'Real wiggle size');
      rowLabel(rGain).innerHTML = md(spec ? 'd²F/dΩ(E_{1}) ÷ BM' : 'vs a bending magnet');
      rowLabel(rGam).innerHTML = md('γ · 1/γ');
      rowLabel(rW).innerHTML = md('FWHM ΔE/E, n = 1: N → +σ_{E}');
      rowLabel(rPM).innerHTML = md('PM at same λ_{u}, g');
      rGam.el.style.display = spec ? '' : 'none';
      rW.el.style.display = spec ? '' : 'none';
      rPM.el.style.display = spec && d.kind === 'scu' ? '' : 'none';
      presetBtns.forEach((b, i) => (b.title = spec ? `Find the odd harmonic and ${d.kind === 'pm' ? 'gap' : 'current'} with the most on-axis flux at ${PRESETS[i]} keV` : `Tune the undulator to ${PRESETS[i]} keV`));
    }

    function captions(): [string, string] {
      const d = device();
      const r = ring();
      const B0 = P.fieldAt(d, st.setting);
      const K = P.kOf(B0, d.periodMm);
      const e1 = P.energyN(1, r.E, d.periodMm, K);
      const lam1 = P.lambdaN(1, r.E, d.periodMm, K);
      const pm = d.kind === 'pm';
      const lead = pm ? `**Gap ${st.setting.toFixed(1)} mm → field ${B0.toFixed(2)} T → wiggle strength K = ${K.toFixed(2)}.**` : `**Coil current ${Math.round(st.setting * 100)} % → field ${B0.toFixed(2)} T → K = ${K.toFixed(2)}.**`;
      let v = `${lead} The electron sends out a flash of light at every wiggle. It runs almost as fast as its own light, so by the next wiggle it has fallen behind by exactly one wavelength — the flashes from all ${d.N} wiggles add up *in step* into one sharp X-ray colour, **${P.fmtKeV(e1)} keV** (just ${Math.round(P.naturalWidth(1, d.N) * e1 * 1000)} eV wide — see the zoom), with “overtones” at 3× and 5× (${P.fmtKeV(3 * e1)}, ${P.fmtKeV(5 * e1)} keV).`;
      if (K < 0.8) v += ' The wiggle is gentle (K < 1), so the wave is an almost pure ripple: nearly all the light is in the first colour.';
      else if (K > 1.6) v += ' The wiggle is strong (K > 1): the light beam sweeps past you in sharp flashes, so the overtones are bright too.';
      v += pm ? ' **Close the gap** and the colour drops; open it and it rises.' : ' Superconducting coils reach a stronger field than magnets could at this short period.';
      if (st.ring === 'aps') {
        const worse = P.peakFlux(1, K, d, P.RINGS.apsu) / P.peakFlux(1, K, d, r);
        v += ` *Old APS: 7-GeV electrons push every colour 36 % higher, but its electron beam was far more spread out, so${worse >= 1.5 ? ` about ${fmtX(worse)}× less` : ' less'} light went straight ahead. APS-U went to 6 GeV for a much smaller beam and makes up the energy with shorter periods and smaller gaps.*`;
      }
      if (st.tunedN && msg && !msg.bad) v += ` *Tuned with the ${P.ordinal(st.tunedN)} harmonic.*`;

      // specialist
      const g = P.gammaOf(r.E);
      const F1 = P.Fn(1, K);
      const flux = P.peakFlux(1, K, d, r);
      const fil = P.undulatorPeak(1, K, d.N, r.E, r.I);
      const bf = P.beamFactors(1, K, d, r);
      const bm = P.bendingMagnet(e1, r.E, r.I, r.bmB);
      const setTxt = pm ? `g = ${st.setting.toFixed(2)} mm (g/λu = ${(st.setting / d.periodMm).toFixed(2)}; fit ×${P.pmScale(d).toFixed(3)} to the APS K at ${d.gapMinMm} mm)` : `I/I_{max} = ${(st.setting * 100).toFixed(0)} %, g = 8.0 mm fixed`;
      let s = `**${d.name}: λu = ${d.periodMm} mm, N = ${d.N} (${d.lengthM} m), ${setTxt} → B₀ = ${B0.toFixed(3)} T, K = ${K.toFixed(3)}.** E = ${r.E} GeV, I = ${r.I * 1000} mA: γ = ${Math.round(g).toLocaleString('en-US')}, 1/γ = ${(1e6 / g).toFixed(1)} µrad, wiggle angle K/γ = ${((1e6 * K) / g).toFixed(0)} µrad. E_{n} = n·${P.fmtKeV(e1)} keV (λ₁ = ${lam1.toFixed(3)} Å); n = 1 FWHM 0.886E₁/N = ${Math.round(P.naturalWidth(1, d.N) * e1 * 1000)} eV, ${Math.round(P.spreadFwhm(1, d.N, r.sigmaE) * e1 * 1000)} eV with σ_{E} = ${(r.sigmaE * 100).toFixed(3)} %. On axis, n = 1: filament 1.744×10¹⁴N²E²I·F₁ = ${P.fmtSci(fil)} (F₁ = ${F1.toFixed(3)}) × ${bf.spread.toFixed(2)} (σ_{E}) × ${bf.div.toFixed(2)} (divergence: σ_{r}′ = √(λ/2L) = ${P.sigmaRp(e1, d).toFixed(1)} µrad vs σ′ = ${r.divX} × ${r.divY} µrad) × ${bf.phase.toFixed(2)} (phase error σ_{φ} = ${P.PHASE_ERR_DEG}° rms: exp(−n²σ_{φ}²)) = ${P.fmtSci(flux)} ph/s/mrad²/0.1%BW, ${P.fmtRound(flux / bm)}× the ${r.bmB}-T bending magnet. Not included: divergence broadening of the line, source size, even harmonics off axis.`;
      if (st.ring === 'aps') s += ` 7-GeV case keeps the APS-U device and gap; the old ring's ID chambers limited gaps to ~10.5 mm (Undulator A, 33 mm: E₁ ≈ 3.1 keV at 7 GeV). ε_{x} = ${(r.emitPm / 1000).toFixed(1)} nm: the beam divergence, not σ_{E}, dominates its high harmonics.`;
      return [v, s];
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
      wave.set(K, lam1, depth, { n: zn, En: P.energyN(zn, r.E, d.periodMm, K), N: d.N, sigmaE: r.sigmaE });
      spectrum.set({ dev: d, ring: r, setting: st.setting, depth, tunedN: st.tunedN });
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
      const spec = depth === 'specialist';
      const B0 = P.fieldAt(d, st.setting);
      const K = P.kOf(B0, d.periodMm);
      const e1 = P.energyN(1, r.E, d.periodMm, K);
      const lam1 = P.lambdaN(1, r.E, d.periodMm, K);
      const g = P.gammaOf(r.E);

      rE1.set(spec ? `${P.fmtKeV(e1)} keV · ${lam1.toFixed(2)} Å` : `${P.fmtKeV(e1)} keV`);
      rB.set(`${B0.toFixed(spec ? 3 : 2)} T`);
      rK.set(K.toFixed(spec ? 3 : 2));
      const amp = ((K * d.periodMm * 1e-3) / (2 * Math.PI * g)) * 1e6; // µm
      rAmp.set(`±${amp < 0.1 ? amp.toFixed(3) : amp.toFixed(2)} µm`);
      const bm = P.bendingMagnet(e1, r.E, r.I, r.bmB);
      const gain = P.peakFlux(1, K, d, r) / bm;
      rGain.set(spec ? `×${P.fmtSci(gain, 1)}` : `×${P.fmtRound(gain)}`);
      rGam.set(`${Math.round(g).toLocaleString('en-US')} · ${(1e6 / g).toFixed(0)} µrad`);
      rW.set(`${(P.naturalWidth(1, d.N) * 100).toFixed(2)} → ${(P.spreadFwhm(1, d.N, r.sigmaE) * 100).toFixed(2)} %`);
      if (d.kind === 'scu') {
        const bpm = P.pmFieldEstimate(d.gapMinMm, d.periodMm);
        rPM.set(`${bpm.toFixed(2)} T · K ${P.kOf(bpm, d.periodMm).toFixed(2)}`);
      }
      put(outHint, md(
        spec
          ? `Ratio at E₁: undulator line (σ_{E}, beam divergence and phase errors included) ÷ bending magnet, both on axis. N = ${d.N} is one ${d.lengthM}-m device; a straight with two in-line devices phased together acts like 2N (up to twice the peak, half the width). The real wiggle x_{max} is about a micrometre; panel 1 magnifies it.`
          : `**×${P.fmtRound(gain)}**: that many times brighter straight ahead, at the 1st colour, than the light from one bending magnet. The real wiggle is about 1/${P.fmtRound(HAIR_UM / amp)} of the width of a hair — panel 1 magnifies it.`,
      ));
      const [lo1, hi1] = P.harmonicRange(1, d, r);
      if (d.kind === 'pm') {
        put(setHint, md(
          spec
            ? `${d.name}, N = ${d.N}: g ${d.gapMinMm}–${d.gapMaxMm} mm → K ${P.kAt(d, d.gapMaxMm).toFixed(2)}–${d.kRef.toFixed(2)}, E₁ ${P.fmtKeV(lo1)}–${P.fmtKeV(hi1)} keV. ${cap(d.status)}.`
            : `Smallest gap ${d.gapMinMm} mm — the beam pipe sits in between. 1st colour tunes from ${P.fmtKeV(lo1)} to ${P.fmtKeV(hi1)} keV.`,
        ));
      } else {
        put(setHint, md(
          spec
            ? `${d.name}, N = ${d.N}, g = 8.0 mm fixed: K up to ${d.kRef} (B₀ ${P.fieldAt(d, 1).toFixed(2)} T), E₁ ${P.fmtKeV(lo1)}–${P.fmtKeV(hi1)} keV. ${cap(d.status)}.`
            : `The gap is fixed at 8 mm; the field follows the current in the coils. 1st colour: ${P.fmtKeV(lo1)}–${P.fmtKeV(hi1)} keV. **Planned — not installed yet.**`,
        ));
      }
      put(ringHint, md(
        spec
          ? st.ring === 'apsu'
            ? 'APS-U: 6.0 GeV, 200 mA, σ_{E} 0.136 %, ε_{x} ≈ 42 pm (σ′ 2.75 × 1.29 µrad). E_{n} ∝ E²: (6/7)² = 0.73 of the old energies.'
            : 'APS: 7.0 GeV, 100 mA, σ_{E} 0.095 %, ε_{x} 3.1 nm (σ′ 11 × 3.5 µrad); same device & gap as selected.'
          : st.ring === 'apsu'
            ? 'APS-U’s new magnets squeeze the electron beam far smaller — but at 6 GeV every colour drops by about a quarter.'
            : 'The old ring: faster electrons, higher colours — but a far more spread-out electron beam, so less light straight ahead.',
      ));
      presetBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(st.preset === PRESETS[i] && st.tunedN !== null)));
      put(msgEl, msg ? md(msg.text) : md(spec ? 'Or click anywhere on the spectrum.' : '…or click anywhere on the spectrum.'));
      msgEl.classList.toggle('is-bad', !!msg?.bad);
      const [v, s] = captions();
      // only touch the DOM when the text changed (every write forces a style/layout pass)
      const capKey = `${depth}|${v}|${s}`;
      if (capKey !== lastCap) {
        lastCap = capKey;
        station.setCaption(v, s);
      }
    }

    let lastCap = '';

    function sceneInput() {
      return { dev: device(), ring: ring(), setting: st.setting, depth };
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
    let lastDepth: Depth | '' = '';
    const applyLayout = () => {
      const w = host.clientWidth || 900;
      if (Math.abs(w - lastW) > 0.5) {
        lastW = w;
        resetCaptionHeight();
      }
      const mode = w >= 980 ? 'wide' : w >= 700 ? 'mid' : 'narrow';
      const wideCol = mode === 'wide' && w >= 1180;
      const key = `${mode}|${wideCol}`;
      if (key === layoutMode && depth === lastDepth) return;
      resetCaptionHeight();
      layoutMode = key;
      lastDepth = depth;
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

    return {
      destroy: () => station.destroy(),
      setDepth: (d: Depth) => {
        depth = d;
        station.setDepth(d);
        applyDepthLabels();
        applyLayout();
        if (msg && st.tunedN !== null) {
          // re-word the tuning message for the new depth
          const E = P.energyN(st.tunedN, ring().E, device().periodMm, P.kAt(device(), st.setting));
          const keep = st.preset;
          tune(E, keep);
          return;
        }
        update();
      },
    };
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

function cap(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function sym(html: string): string {
  return `<span class="und-sym">${html}</span>`;
}

function setSliderLabel(input: HTMLInputElement, text: string): void {
  const l = input.parentElement?.querySelector('.stn-slider-label');
  if (l) l.textContent = text;
}

function setWrapLabel(wrap: HTMLElement, text: string): void {
  const l = wrap.querySelector('.stn-slider-label');
  if (l) l.textContent = text;
}

function setToggleLabels(wrap: HTMLElement, labels: string[]): void {
  wrap.querySelectorAll('button').forEach((b, i) => {
    if (labels[i]) b.textContent = labels[i];
  });
}
