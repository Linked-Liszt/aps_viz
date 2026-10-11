/**
 * Station "brightness" — facility story: "Brighter, not just more".
 *
 * Panel 1 (./brightness/source.ts): the flashlight-vs-laser-pointer idea made quantitative. A Gaussian X-ray
 *   source with a FIXED photon rate F = 10¹⁵ ph/s/0.1%BW; sliders set the horizontal electron-beam size σ_x and
 *   divergence σ′_x (vertical plane from the preset). Photons are drawn from the photon source; a thin lens
 *   (f = 7.5 m) with a soft Gaussian aperture (rms 30 µm) at 15 m images the source 1:1 onto a soft slit (rms 4 µm)
 *   at 30 m, with the diffraction kick λ/4πs at each aperture — exact wave optics for Gaussian beams. The slit picks
 *   source position, the aperture picks angle, so the rate through both is set by brightness, not by flux
 *   (Liouville; two bare far slits would be mismatched to the APS-U beam and saturate). Below: the
 *   definition B = F ÷ (2πΣ_xΣ_y) ÷ (2πΣ′_xΣ′_y) with to-scale end-on views and a log meter (old APS, APS-U,
 *   diffraction-limited ceiling 4F/λ² at the same F).
 * Panel 2 (./brightness/chart.ts): design brilliance vs photon energy for APS (pre-2023) and APS-U — IPAC'21
 *   Fig. 1 envelope (digitized) or FDR 2019 Fig. 2.1 specific undulators — with the APS-U ÷ APS gain, the ≈500×
 *   zones and the source-term-only gain of panel 1's source (dashed). Hover reads values; drag picks E.
 *
 * Equations (sources and caveats in ./brightness/physics.ts):
 *   B = F / (4π² Σ_x Σ′_x Σ_y Σ′_y);  Σ² = σ_e² + σ_r²,  Σ′² = σ_e′² + σ_r′²;  σ_r = √(2λL)/4π,  σ_r′ = √(λ/2L)
 *   (Kim 1989; L = 2.4 m); B_max = 4F/λ²;  two-slit pass probability exact (Wigner function of a Gaussian
 *   Schell-model beam through Gaussian apertures and a thin lens), ≤ A/(2πΣΣ′) with A = 2πs₁s₂/(z₂−z₁), equal
 *   when overfilled.
 * Numbers: electron beams FDR 2019 Table 2.1 (APS) and Storage Ring Parameters 2024 Table 5 (APS-U, zero current);
 *   design curves from the facility research dossier (IPAC'21 MOXA02 Fig. 1; FDR Fig. 2.1, Tables 1.1, 2.2).
 * Illustrative (said so in the notes): the fixed F, the slit geometry, Kim's Gaussian photon beam with no energy
 *   spread, interpolation between digitized points.
 */
import type { ExplainerModule } from './registry';
import { button, canvas2d, createStation, group, loop, motionGate, note, readout, slider, toggle, type Canvas2D } from './kit';
import * as P from './brightness/physics';
import { SourceView, sourceMinHeight } from './brightness/source';
import { BrillianceChart, E_MAX, E_MIN } from './brightness/chart';
import { approxGain, fmtGain, fmtKeV, fmtOneIn, fmtSmall } from './brightness/format';

type Preset = 'aps' | 'round' | 'flat' | 'custom';
type Ds = 'envelope' | 'devices';

const F_FIXED = 1e15; // ph/s/0.1%BW, held fixed in panel 1 (order of one APS-U undulator at 20 keV)
const DEFAULTS = { preset: 'round' as Preset, E: 20, ds: 'envelope' as Ds };
const SX = { min: 0.5, max: 400 };
const SXP = { min: 0.2, max: 40 };
/** host width from which the controls sit in a column beside the two panels (each panel then ≥ ~320 px wide) */
const SIDE_MIN_W = 930;
/** kit: .stn-visual padding (px) */
const VISUAL_PAD = 8;
/** side layout: the caption never gets less than ~3 lines (kit: 13.5 px × 1.5, padding 22 px) before it scrolls */
const CAPTION_MIN_H = 84;

const CSS = `
.brt-root .stn-readout-value { white-space: nowrap; }
.brt-root .stn-toggle button { padding: 6px 7px; }
`;

const mod: ExplainerModule = {
  title: 'Brighter, not just more',
  subtitle: 'Squeeze the X-ray source and count the photons a lens can focus through a tiny slit — then see how much brighter the upgraded APS really is.',
  mount(host, ctx) {
    const accent = ctx.color || '#5cd3ff';
    const station = createStation(host, { color: accent, layout: 'side' });
    const { visual, controls, root } = station;
    root.classList.add('brt-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    // ------------------------------------------------------------ state
    const st = {
      preset: DEFAULTS.preset,
      /** which APS-U coupling the comparison marker uses (last APS-U preset chosen) */
      ring: 'round' as 'round' | 'flat',
      e: { ...P.APSU_ROUND.e } as P.Beam,
      E: DEFAULTS.E,
      ds: DEFAULTS.ds,
    };

    // ------------------------------------------------------------ canvases
    const titles = { p1: '1 · Same photons, brighter beam', p2: '2 · The real machines: design brightness' };
    const c1 = canvas2d(visual, { label: titles.p1 });
    const c2 = canvas2d(visual, { label: titles.p2 });
    c1.canvas.setAttribute('aria-label', `${titles.p1}: a lens focuses photons from the source through a slit; brightness meter below`);
    c2.canvas.setAttribute('aria-label', `${titles.p2}: log–log chart of brightness versus X-ray energy; use left and right arrow keys to change the energy`);
    const visual2 = document.createElement('div');
    visual2.className = 'stn-visual';
    const wrapOf = (c: Canvas2D) => c.canvas.parentElement as HTMLElement;

    const srcView = new SourceView(c1, accent);
    const chart = new BrillianceChart(c2, accent, (E) => setE(E, true), { E: st.E, ds: st.ds, src: st.e, srcKey: keyOf(st.e) });
    c2.onResize(() => (chart.needsDraw = true));

    // ------------------------------------------------------------ controls
    note(
      controls,
      station,
      '**Flashlight vs laser pointer.** Both can send out the same number of photons, but the laser’s come from a tiny spot and head one way, so a lens can focus them to a tiny dot: it is *brighter*. Here the photon rate is fixed. **Squeeze the source** — the sliders set the electron beam’s sideways width and angle spread (rms) — and count how many photons the lens can focus through the slit. The slit picks position and the lens aperture picks angle, so the count follows brightness, not the photon total. The slit is tall, so only the sideways squeeze counts there; the meter includes both directions. Panel 2: hover, drag or use the arrow keys.',
    );
    const guideEl = controls.lastElementChild as HTMLElement;

    const g1 = group(controls, '1 · The X-ray source (sideways)');
    const tPreset = toggle<Preset>(g1, {
      options: [
        { value: 'aps', label: 'Old APS', title: 'APS before the upgrade (2019): σx 275 µm, σx′ 11 µrad, σy 10 µm, σy′ 3.5 µrad (FDR 2019 Table 2.1)' },
        { value: 'round', label: 'APS-U', title: 'APS-U round beam (κ = 1, how it runs for users): σx 12.3 µm, σx′ 2.34 µrad, σy 8.3 µm, σy′ 3.47 µrad (Storage Ring Parameters 2024)' },
        { value: 'flat', label: 'APS-U flat', title: 'APS-U flat beam (κ = 0.1): σx 14.5 µm, σx′ 2.75 µrad, σy 3.1 µm, σy′ 1.29 µrad (Storage Ring Parameters 2024)' },
      ],
      value: st.preset,
      onChange: (v) => applyPreset(v),
    });
    // reduced motion: panel 1 shows a still picture of the photons (redrawn when the source changes)
    const motion = motionGate(station, g1, { title: 'Your device asks for reduced motion, so the photons in panel 1 hold still. Press to let them fly.' });
    const sW = slider(g1, {
      label: 'Electron beam width',
      min: SX.min,
      max: SX.max,
      log: true,
      value: st.e.sx,
      format: (v) => `${fmtSmall(v)} µm`,
      onInput: (v) => {
        st.e.sx = v;
        markCustom();
      },
    });
    const sD = slider(g1, {
      label: 'Electron angle spread',
      min: SXP.min,
      max: SXP.max,
      log: true,
      value: st.e.sxp,
      format: (v) => `${fmtSmall(v)} µrad`,
      onInput: (v) => {
        st.e.sxp = v;
        markCustom();
      },
    });

    const g2 = group(controls, '2 · X-ray energy & design data');
    const sE = slider(g2, {
      label: 'X-ray energy',
      min: E_MIN,
      max: E_MAX,
      log: true,
      value: st.E,
      format: (v) => `${fmtKeV(v)} keV`,
      onInput: (v) => setE(v, false),
    });
    const tDs = toggle<Ds>(g2, {
      label: 'Undulators compared',
      options: [
        { value: 'envelope', label: 'Best of all', title: "Upper envelope over all candidate undulators (IPAC'21 MOXA02 Fig. 1, digitized)" },
        { value: 'devices', label: 'Examples', title: 'Specific devices: APS 3.3 & 2.7 cm × 4.8 m vs APS-U 2.8 & 2.5 cm × 4.6 m and superconducting 2.05 & 1.55 cm × 3.5 m (FDR 2019 Fig. 2.1)' },
      ],
      value: st.ds,
      onChange: (v) => {
        st.ds = v;
        changed(true);
      },
    });

    const gN = group(controls, 'Numbers');
    const rGain = readout(gN, 'Brightness vs old APS, same photons', { big: true, color: accent });
    const rPass = readout(gN, 'Through lens and slit');
    const rReal = readout(gN, 'Design gain at 20 keV', { big: true });
    const rowLabel = (r: { el: HTMLElement }) => r.el.querySelector('.stn-readout-label') as HTMLElement;
    for (const r of [rGain, rPass, rReal]) {
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
    resetRow.style.display = 'flex';
    resetRow.style.gap = '8px';
    controls.appendChild(resetRow);
    button(resetRow, '↺ Reset', () => {
      st.E = DEFAULTS.E;
      st.ds = DEFAULTS.ds;
      sE.set(st.E);
      tDs.set(st.ds);
      applyPreset(DEFAULTS.preset);
    });

    note(
      controls,
      station,
      '**Why is the gain biggest for high-energy X-rays?** Light is a wave, so even a perfect electron beam gives an X-ray source with a built-in size and angle spread, whose product is λ/4π: 9.9 pm·rad at 10 keV, less for shorter waves. The old beam (3.1 nm·rad sideways) was so wide that this never mattered. The new one (29–42 pm·rad) is so small that at low energy the light’s own blur sets the limit, while at high energy the squeeze pays off in full: from the source alone, ×27 at 1 keV rising to ×106 at 100 keV (round beam). Panel 1 includes this blur, and its meter’s *diffraction limit* is what a perfect electron beam would give. The rest of the design gain is *more* photons: twice the current (200 mA) and new, shorter-period undulators.',
    );
    note(
      controls,
      station,
      '**The curves in panel 2 are design calculations:** no measured APS-U brightness curve had been published as of October 2026. They are digitized from a 2021 conference paper (IPAC’21; about ±20 % per point, ±30 % on a ratio); the headline “up to 500×” matches the design report’s ×540 at 20 keV. Panel 1 is a simplified model: a fixed photon rate (10¹⁵ per second in 0.1 % bandwidth, roughly one APS-U undulator at 20 keV), a soft-edged (Gaussian) lens aperture and slit, and an idealised photon beam from a 2.4-m undulator with no electron energy spread, which in reality weakens the higher harmonics.',
    );

    // ------------------------------------------------------------ state changes
    function applyPreset(p: Preset): void {
      if (p === 'custom') return;
      st.preset = p;
      if (p !== 'aps') st.ring = p;
      st.e = { ...P.RINGS[p].e };
      sW.set(st.e.sx);
      sD.set(st.e.sxp);
      tPreset.set(p);
      changed(true);
    }
    function markCustom(): void {
      const match = (['aps', 'round', 'flat'] as const).find((k) => near(P.RINGS[k].e.sx, st.e.sx) && near(P.RINGS[k].e.sxp, st.e.sxp) && near(P.RINGS[k].e.sy, st.e.sy));
      st.preset = match ?? 'custom';
      tPreset.set(st.preset);
      changed(false);
    }
    function setE(E: number, fromChart: boolean): void {
      st.E = Math.max(E_MIN, Math.min(E_MAX, E));
      if (fromChart) sE.set(st.E);
      changed(false);
    }

    let pending = false;
    let pendingImmediate = false;
    function changed(immediate: boolean): void {
      pending = true;
      pendingImmediate ||= immediate;
      if (immediate) apply();
    }

    let model = compute();
    function compute() {
      const ph = P.photonBeam(st.e, st.E);
      const B = P.brightness(F_FIXED, ph);
      const Baps = P.brightness(F_FIXED, P.photonBeam(P.APS_2019.e, st.E));
      const ring = P.RINGS[st.ring];
      const Bapsu = P.brightness(F_FIXED, P.photonBeam(ring.e, st.E));
      const Blim = P.brightnessLimit(F_FIXED, st.E);
      const pass = P.passFraction(ph.sx, ph.sxp, st.E);
      const passRay = P.passFraction(ph.sx, ph.sxp, st.E, P.SLITS, false);
      const passAps = P.passFraction(...xyOf(P.photonBeam(P.APS_2019.e, st.E)), st.E);
      const r = P.singleElectron(st.E);
      /** source-term gain of the APS-U preset (to tell "brighter" from "more" in the panel-2 sentence) */
      const srcU = P.sourceGain(ring.e, P.APS_2019.e, st.E);
      /** rms width of the focus at the slit */
      const focus = P.widthAfterLens(P.afterLens(ph.sx, ph.sxp, st.E), P.SLITS.z2);
      return { ph, B, Baps, Bapsu, Blim, pass, passRay, passAps, r, srcU, focus };
    }

    function apply(): void {
      if (!pending) return;
      pending = false;
      model = compute();
      const m = model;
      srcView.set({
        ph: m.ph,
        E: st.E,
        F: F_FIXED,
        B: m.B,
        Baps: m.Baps,
        Bapsu: m.Bapsu,
        Blim: m.Blim,
        pass: m.pass,
        name: presetName(st.preset),
        apsuName: st.ring === 'flat' ? 'APS-U flat' : 'APS-U',
      });
      chart.set({ E: st.E, ds: st.ds, src: st.e, srcKey: keyOf(st.e) });
      updateReadouts();
      if (pendingImmediate) lastCapT = 0;
      pendingImmediate = false;
      refreshCaption();
    }

    function updateReadouts(): void {
      const m = model;
      rGain.set(fmtGain(m.B / m.Baps));
      rPass.set(fmtOneIn(m.pass));
      const v = chart.valuesAt(st.E);
      rowLabel(rReal).textContent = `Design gain at ${fmtKeV(st.E)} keV`;
      // rounded to what the design data support (±30 % on the ratio)
      rReal.set(Number.isFinite(v.gain) ? `≈ ×${approxGain(v.gain)}` : 'no data');
    }

    // ------------------------------------------------------------ captions
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
      capFade();
    };
    /** a caption that scrolls (side layout, short host) fades out at the bottom while there is more below */
    const capFade = () => {
      const c = station.caption;
      const more = c.scrollHeight - c.clientHeight - c.scrollTop > 1;
      const m = more ? 'linear-gradient(to bottom, #000 calc(100% - 26px), transparent)' : '';
      c.style.setProperty('mask-image', m);
      c.style.setProperty('-webkit-mask-image', m);
    };
    station.caption.addEventListener('scroll', capFade, { passive: true });

    function caption(): string {
      const m = model;
      const aps = P.photonBeam(P.APS_2019.e, st.E);
      const gain = m.B / m.Baps;
      const wRatio = aps.sx / m.ph.sx;
      const dRatio = aps.sxp / m.ph.sxp;
      const v = chart.valuesAt(st.E);
      const Et = `${fmtKeV(st.E)} keV`;
      const atFloor = st.preset === 'custom' && (st.e.sx < m.r.size || st.e.sxp < m.r.div * 0.6);

      let t = '';
      if (st.preset === 'aps') {
        t = `**This is the old APS source.** Its X-rays come from a spot about ${((m.ph.sx * 4) / 1000).toFixed(1)} mm wide and fan out widely, so the lens can only focus them to a broad blur and just **${fmtOneIn(m.pass)}** photons (${pct(m.pass)}) make it through the slit. Press **APS-U**, or drag the sliders, to squeeze it.`;
      } else {
        const who = st.preset === 'custom' ? 'Your source' : st.preset === 'flat' ? 'The APS-U flat-beam source' : 'The APS-U source';
        const head = gain >= 1.05 ? `**Same number of photons — ${fmtGain(gain).slice(1)} times brighter than the old APS.**` : gain <= 0.95 ? `**Same number of photons — but dimmer than the old APS** (${fmtGain(gain)}).` : '**About as bright as the old APS.**';
        const spot = m.focus * 4;
        const spotTxt = spot < 1000 ? `${spot < 10 ? spot.toFixed(1) : Number(spot.toPrecision(2))} µm` : `${(spot / 1000).toFixed(1)} mm`;
        t = `${head} ${who} is ${fmtRatio(wRatio)} than the old one and its X-rays fan out ${fmtRatio(dRatio, 'less')}, so the lens focuses them to a spot about ${spotTxt} across and **${fmtOneIn(m.pass)}** photons make it through the slit (old APS: ${fmtOneIn(m.passAps)}).`;
        if (m.pass < 0.8 * m.passRay)
          t += ` Why is the focus blurred? Light is a wave: passing the lens’s ${P.SLITS.s1}-µm aperture spreads it by about ${fmtSmall(P.diffractionKick(st.E, P.SLITS.s1))} µrad — more at low energy (longer waves) — so fewer photons fit through the slit.`;
        if (m.pass > 0.25 && gain > 100) t += ' That’s close to the limit: the count can’t rise past “all of them”, even though brightness keeps climbing.';
        if (atFloor)
          t += ` You’ve hit the floor: light is a wave, so even a perfect electron beam makes a source about ${fmtSmall(m.r.size)} µm wide (rms) that spreads ${fmtSmall(m.r.div)} µrad at ${Et}. Shorter waves (higher energy) lower the floor.`;
      }
      if (Number.isFinite(v.gain)) {
        // design curves are good to ~±30 % on the ratio: one significant figure, and the headline figure readers will
        // have seen elsewhere ("up to 500×", FDR Table 1.1: ×540 at 20 keV) is put in context
        const g = approxGain(v.gain);
        const which = st.ds === 'envelope' ? 'each with its best undulator' : 'with these example undulators';
        t +=
          v.gain / m.srcU >= 1.5
            ? ` In panel 2, the real machines at ${Et}, ${which}: APS-U’s design brightness is **about ${g} times** the old one — ${fmtGain(m.srcU)} from its smaller, tighter ${st.ring === 'flat' ? 'flat-beam ' : ''}source alone, the rest from *more* photons (twice the current, better undulators).`
            : ` In panel 2, the real machines at ${Et}, ${which}: APS-U’s design brightness is **about ${g} times** the old one — at this energy almost all of it from the smaller, tighter source.`;
        t +=
          st.ds === 'envelope'
            ? ' These are design estimates (±30 %), and the gain depends on the energy, from about 20 times for the softest X-rays to several hundred times at higher energies. The facility quotes one round figure, “up to 500 times brighter” (540× at 20 keV in its design report).'
            : ' Other undulators do better at some energies: “Best of all” shows the best one at each energy.';
      } else t += ` (No design data at ${Et} for this comparison.)`;
      return t;
    }

    // The caption only grows while the layout stays the same (avoids canvas re-allocation while dragging).
    let capMin = 0;
    // measured a frame later: a min-height written during the observer's own delivery re-triggers the layout
    // observers in the same frame (the browser's "ResizeObserver loop" error)
    let capRaf = 0;
    const capRo = new ResizeObserver(() => {
      cancelAnimationFrame(capRaf);
      capRaf = requestAnimationFrame(() => {
        capFade();
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
    // Three layouts by host width:
    //   side   (≥ SIDE_MIN_W): panels 1 | 2 side by side, the controls in a column at the right (it scrolls within
    //          the row), caption below. The visual row only claims what panel 1 needs (sourceMinHeight) and
    //          grows into a taller host, so the station fits a short dialog (story dialog at 1440×900: 1030×657).
    //   mid    (780 – SIDE_MIN_W): panels 1 | 2 on top, the controls as a grid below, caption — the station scrolls.
    //   narrow (< 780): panel 1, its controls, panel 2, the other controls, caption — the station scrolls.
    const ctlA = document.createElement('div');
    ctlA.className = 'stn-controls';
    ctlA.style.gridTemplateColumns = 'minmax(0,1fr)';
    ctlA.style.overflowY = 'visible';
    let layoutMode = '';
    let lastW = -1;
    // Side layout: the caption may take what the host leaves below the visual row's floor and scrolls beyond that,
    // so a long caption (custom source, low energy) cannot push the station out of a short dialog (story dialog at
    // 1280×800: 557 px = 412 px floor + 145 px). A host that grows with its content (the story dialog's) overflows
    // its scrolling ancestor instead of clipping, so that overflow is taken off the host's height.
    let scroller: HTMLElement | null = null;
    const fitCaption = () => {
      const cs = station.caption.style;
      if (layoutMode !== 'side') {
        cs.maxHeight = '';
        cs.overflowY = '';
        cs.scrollbarWidth = '';
        return capFade();
      }
      if (!scroller) {
        scroller = scrollParent(host);
        if (scroller) ro.observe(scroller);
      }
      const over = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
      const max = Math.max(CAPTION_MIN_H, Math.floor(host.clientHeight - over - visualFloor()));
      if (capMin > max) {
        capMin = max;
        cs.minHeight = `${max}px`;
      }
      cs.maxHeight = `${max}px`;
      cs.overflowY = 'auto';
      cs.scrollbarWidth = 'thin';
      capFade();
    };
    const visualFloor = () => sourceMinHeight() + 2 * VISUAL_PAD;
    const applyLayout = () => {
      const w = host.clientWidth || 900;
      if (Math.abs(w - lastW) > 0.5) {
        lastW = w;
        resetCaptionHeight();
      }
      const mode = w >= SIDE_MIN_W ? 'side' : w >= 780 ? 'mid' : 'narrow';
      if (mode === layoutMode) return fitCaption();
      resetCaptionHeight();
      layoutMode = mode;
      const stack = mode !== 'side';
      root.classList.toggle('stn-stack', stack);
      root.classList.toggle('stn-side', !stack);
      root.style.height = stack ? '100%' : '';
      root.style.overflowY = stack ? 'auto' : '';
      root.style.scrollbarWidth = stack ? 'thin' : '';
      controls.style.overflowY = stack ? 'visible' : '';
      const vs = visual.style;
      const v2 = visual2.style;
      if (mode === 'narrow') {
        // panel 1 → its controls → panel 2 → remaining controls → caption
        visual2.appendChild(wrapOf(c2));
        ctlA.append(guideEl, g1);
        controls.prepend(g2, gN, resetRow);
        root.style.gridTemplateRows = 'repeat(5, max-content)';
        root.append(visual, ctlA, visual2, controls, station.caption);
        vs.gridTemplateColumns = 'minmax(0,1fr)';
        vs.gridTemplateRows = '540px';
        vs.minHeight = '';
        v2.gridTemplateColumns = 'minmax(0,1fr)';
        v2.gridTemplateRows = '500px';
        v2.minHeight = '';
        return fitCaption();
      }
      visual.appendChild(wrapOf(c2));
      visual2.remove();
      ctlA.remove();
      root.append(visual, controls, station.caption);
      vs.gridTemplateColumns = 'minmax(0,1fr) minmax(0,1.05fr)';
      if (mode === 'side') {
        // The column scrolls within the visual row: every control comes first, so its first screen holds all of
        // them beside the panels they drive; the introduction follows, then the readouts and the notes.
        controls.prepend(g1, g2, resetRow, guideEl);
        root.style.gridTemplateRows = '';
        vs.gridTemplateRows = 'minmax(0,1fr)';
        vs.minHeight = `${visualFloor()}px`;
      } else {
        controls.prepend(guideEl, g1, g2, gN, resetRow);
        root.style.gridTemplateRows = 'repeat(3, max-content)';
        vs.gridTemplateRows = '540px';
        vs.minHeight = '';
      }
      fitCaption();
    };
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
    srcView.warm();
    srcView.draw();
    chart.draw();

    loop(station, (dt) => {
      apply();
      if (motion.on) srcView.frame(dt);
      else srcView.still();
      if (chart.needsDraw) chart.draw();
    });

    return { destroy: () => station.destroy() };
  },
};
export default mod;

// ------------------------------------------------------------------ helpers

function keyOf(e: P.Beam): string {
  return `${e.sx.toPrecision(5)}|${e.sxp.toPrecision(5)}|${e.sy}|${e.syp}`;
}

function xyOf(p: P.Beam): [number, number] {
  return [p.sx, p.sxp];
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.005 * Math.max(Math.abs(a), Math.abs(b));
}

function presetName(p: Preset): string {
  return p === 'aps' ? 'APS 2019' : p === 'round' ? 'APS-U round' : p === 'flat' ? 'APS-U flat' : 'Custom source';
}

function pct(p: number): string {
  const v = p * 100;
  if (v >= 10) return `${v.toFixed(0)} %`;
  if (v >= 1) return `${v.toFixed(1)} %`;
  if (v >= 0.1) return `${v.toFixed(2)} %`;
  return `${v.toPrecision(2)} %`;
}

/** "22× narrower", "about as wide", "3× wider" (for ratio old/new of sizes) */
function fmtRatio(r: number, kind: 'narrow' | 'less' = 'narrow'): string {
  const n = r >= 9.5 ? Math.round(r).toString() : r.toFixed(1);
  if (kind === 'less') {
    if (r > 1.1) return `${n}× less`;
    if (r < 0.9) return `${(1 / r).toFixed(1)}× more`;
    return 'about as much';
  }
  if (r > 1.1) return `${n}× narrower`;
  if (r < 0.9) return `${(1 / r).toFixed(1)}× wider`;
  return 'about as wide';
}

/** nearest ancestor that scrolls vertically (the story dialog's stage), or null */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}
