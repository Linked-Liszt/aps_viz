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
 * Illustrative (said so in the specialist text): the fixed F, the slit geometry, Kim's Gaussian photon beam with
 *   no energy spread, interpolation between digitized points.
 */
import type { Depth } from '../../app/store';
import type { ExplainerModule } from './registry';
import { button, canvas2d, createStation, group, loop, motionGate, note, readout, slider, toggle, type Canvas2D } from './kit';
import * as P from './brightness/physics';
import { SourceView, sourceMinHeight } from './brightness/source';
import { BrillianceChart, E_MAX, E_MIN } from './brightness/chart';
import { approxGain, fmtGain, fmtKeV, fmtOneIn, fmtSmall, sci } from './brightness/format';

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
.brt-root[data-depth=visitor] .brt-spec-only { display: none !important; }
.brt-root .stn-toggle button { padding: 6px 7px; }
`;

const mod: ExplainerModule = {
  title: 'Brighter, not just more',
  subtitle: 'Squeeze the X-ray source and count the photons a lens can focus through a tiny slit — then see how much brighter the upgraded APS really is.',
  mount(host, ctx) {
    const accent = ctx.color || '#5cd3ff';
    const station = createStation(host, { depth: ctx.depth, color: accent, layout: 'side' });
    const { visual, controls, root } = station;
    root.classList.add('brt-root');
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    // ------------------------------------------------------------ state
    let depth: Depth = ctx.depth;
    const st = {
      preset: DEFAULTS.preset,
      /** which APS-U coupling the comparison marker uses (last APS-U preset chosen) */
      ring: 'round' as 'round' | 'flat',
      e: { ...P.APSU_ROUND.e } as P.Beam,
      E: DEFAULTS.E,
      ds: DEFAULTS.ds,
    };

    // ------------------------------------------------------------ canvases
    const titles = {
      p1: ['1 · Same photons, brighter beam', '1 · Brightness of a Gaussian source'],
      p2: ['2 · The real machines, before and after', '2 · Design brilliance vs photon energy'],
    };
    const c1 = canvas2d(visual, { label: titles.p1[0] });
    const c2 = canvas2d(visual, { label: titles.p2[0] });
    const visual2 = document.createElement('div');
    visual2.className = 'stn-visual';
    const wrapOf = (c: Canvas2D) => c.canvas.parentElement as HTMLElement;
    const labelOf = (c: Canvas2D) => wrapOf(c).querySelector('.stn-canvas-label') as HTMLElement | null;

    const srcView = new SourceView(c1, accent);
    const chart = new BrillianceChart(c2, accent, (E) => setE(E, true), { E: st.E, ds: st.ds, depth, src: st.e, srcKey: keyOf(st.e) });
    c2.onResize(() => (chart.needsDraw = true));

    // ------------------------------------------------------------ controls
    note(
      controls,
      station,
      '**Flashlight vs laser pointer.** Both can send out the same amount of light, but the laser’s comes from a tiny spot and heads one way, so a lens can focus it to a tiny dot: it is *brighter*. Here the photon count is fixed: **squeeze the source** and count how many the lens can focus through a tiny slit.',
      'Panel 1 (horizontal plane, to scale): photons from the source at fixed F; a lens at 15 m images it 1:1 onto a slit at 30 m — slit ⇒ position, aperture ⇒ angle, so the count follows brightness. Soft (Gaussian) apertures, kick λ/4πs. Sliders set the *electron* σ (drawn: Σ = √(σ² + σ_{r}²)). Panel 2: hover, drag or arrow keys.',
    );
    const guideEl = controls.lastElementChild as HTMLElement;

    const g1 = group(controls, '1 · The X-ray source');
    const tPreset = toggle<Preset>(g1, {
      options: [
        { value: 'aps', label: 'Old APS', title: 'APS before the upgrade (2019): σx 275 µm, σx′ 11 µrad, σy 10 µm, σy′ 3.5 µrad (FDR 2019 Table 2.1)' },
        { value: 'round', label: 'APS-U', title: 'APS-U round beam (κ = 1, how it runs for users): σx 12.3 µm, σx′ 2.34 µrad, σy 8.3 µm, σy′ 3.47 µrad (Storage Ring Parameters 2024)' },
        { value: 'flat', label: 'APS-U flat', title: 'APS-U flat beam (κ = 0.1): σx 14.5 µm, σx′ 2.75 µrad, σy 3.1 µm, σy′ 1.29 µrad (Storage Ring Parameters 2024)' },
      ],
      value: st.preset,
      onChange: (v) => applyPreset(v),
    });
    const presetWrap = g1.lastElementChild as HTMLElement;
    // reduced motion: panel 1 shows a still picture of the photons (redrawn when the source changes)
    const motion = motionGate(station, g1, { title: 'Your device asks for reduced motion, so the photons in panel 1 hold still. Press to let them fly.' });
    presetWrap.querySelectorAll('button')[2]?.classList.add('brt-spec-only');
    const sW = slider(g1, {
      label: 'Source width',
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
      label: 'Spread angle',
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

    const g2 = group(controls, '2 · X-ray energy');
    const sE = slider(g2, {
      label: 'Energy',
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
    const dsWrap = g2.lastElementChild as HTMLElement;

    const gN = group(controls, 'Numbers');
    const rGain = readout(gN, 'vs old APS, same photons', { big: true, color: accent });
    const rPass = readout(gN, 'Through lens and slit');
    const rReal = readout(gN, 'Real machines at 20 keV', { big: true });
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
      '**Why is the gain biggest for high-energy X-rays?** Light is a wave, so even a perfect beam has a tiny built-in blur and spread — smaller for shorter waves. The old source was so wide that this never mattered. The new one is so small that at low energies the light’s own blur is now the limit; at high energies the squeeze pays off in full.',
      '**Why the gain rises with E.** Σ² = σ_{e}² + σ_{r}², σ_{r}σ_{r}′ = λ/4π (9.9 pm·rad at 10 keV, 2.0 pm at 50 keV). Horizontally the APS (ε_{x} 3.1 nm) is emittance-dominated at every E, so its Σ_{x}Σ′_{x} hardly changes, while APS-U (ε_{x} 29–42 pm) is near λ/4π at a few keV: its photon terms dominate at low E and fade at high E. Vertically both rings were already close to λ/4π (ε_{y} 40 pm vs 29 pm round), so that ratio stays ≈ ×1.2 (flat, ε_{y} 4 pm: ×1.7 → ×6). Source term alone (dashed): ×27 at 1 keV → ×106 at 100 keV (round), ×36 → ×390 (flat). Design ÷ source term (≈ ×1 at 1 keV, ×9.5 at 20 keV) is mostly flux — 2× current (200 mA), longer, shorter-period undulators at 8.5 mm gaps, SCUs above ~50 keV — plus what this simple source model leaves out (real lengths, harmonics, energy spread).',
    );
    note(
      controls,
      station,
      '**The curves in panel 2 are design calculations** from the upgrade project — nobody has published a measured brightness curve yet.',
      '**Caveats.** All curves are design calculations; no measured APS-U brightness curve has been published (dossier, Oct. 2026). Envelope digitized from IPAC’21 Fig. 1 (±20 % per point, ~±30 % on the ratio); the headline “up to 500×” matches FDR Table 1.1 (×540 at 20 keV). Panel 1: Kim Gaussian photon beam, L = 2.4 m, zero current, no energy spread (σ_{δ} = 0.136 % degrades high harmonics; Tanaka–Kitamura give σ_{r} ≈ 2× Kim); F = 10^{15} ph/s/0.1%BW fixed (order of one APS-U undulator at 20 keV) and the lens + slit geometry are illustrative. Gaussian apertures keep the wave optics exact (the Wigner function stays Gaussian; a parabolic CRL’s absorption aperture is Gaussian too); hard edges would add side lobes to the focus. Two bare slits at 15 & 30 m would not do: their acceptance (β ≥ 72 m at the source) is mismatched to the APS-U photon beam (β ≈ 3 m), so the count would saturate far below the brightness gain.',
    );

    // ------------------------------------------------------------ depth-dependent labels
    const applyDepthLabels = () => {
      const spec = depth === 'specialist';
      const i = spec ? 1 : 0;
      const l1 = labelOf(c1);
      const l2 = labelOf(c2);
      if (l1) l1.textContent = titles.p1[i];
      if (l2) l2.textContent = titles.p2[i];
      c1.canvas.setAttribute('aria-label', `${titles.p1[i]}: a lens focuses photons from the source through a slit; brightness meter below`);
      c2.canvas.setAttribute('aria-label', `${titles.p2[i]}: log–log chart; use left and right arrow keys to change the energy`);
      setSliderLabel(sW.input, spec ? 'σx electron beam (rms)' : 'Source width');
      setSliderLabel(sD.input, spec ? 'σ′x electron beam (rms)' : 'Spread angle');
      setSliderLabel(sE.input, spec ? 'Photon energy E' : 'Energy');
      (g1.querySelector('.stn-group-title') as HTMLElement).textContent = spec ? '1 · Source (horizontal plane)' : '1 · The X-ray source';
      (g2.querySelector('.stn-group-title') as HTMLElement).textContent = spec ? '2 · Photon energy & data set' : '2 · X-ray energy';
      setToggleLabels(dsWrap, spec ? ["IPAC'21 envelope", 'FDR Fig. 2.1'] : ['Best of all', 'Examples']);
      const dl = dsWrap.querySelector('.stn-slider-label');
      if (dl) dl.textContent = spec ? 'Design curves' : 'Undulators compared';
      rowLabel(rGain).textContent = spec ? 'B ÷ B(APS 2019), same F' : 'vs old APS, same photons';
      rowLabel(rPass).textContent = spec ? 'P(lens ∧ slit)' : 'Through lens and slit';
    };

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
        depth,
        name: presetName(st.preset),
        apsuName: st.ring === 'flat' ? 'APS-U flat' : 'APS-U',
      });
      chart.set({ E: st.E, ds: st.ds, depth, src: st.e, srcKey: keyOf(st.e) });
      updateReadouts();
      if (pendingImmediate) lastCapT = 0;
      pendingImmediate = false;
      refreshCaption();
    }

    function updateReadouts(): void {
      const m = model;
      const spec = depth === 'specialist';
      rGain.set(fmtGain(m.B / m.Baps));
      rPass.set(spec ? pct(m.pass) : fmtOneIn(m.pass));
      const v = chart.valuesAt(st.E);
      rowLabel(rReal).textContent = spec ? `Design gain at ${fmtKeV(st.E)} keV` : `Real machines at ${fmtKeV(st.E)} keV`;
      // visitors: rounded to what the design data support (±30 % on the ratio)
      rReal.set(Number.isFinite(v.gain) ? (spec ? fmtGain(v.gain) : `≈ ×${approxGain(v.gain)}`) : 'no data');
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
      const [v, s] = captions();
      station.setCaption(v, s);
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

    function captions(): [string, string] {
      const m = model;
      const aps = P.photonBeam(P.APS_2019.e, st.E);
      const gain = m.B / m.Baps;
      const wRatio = aps.sx / m.ph.sx;
      const dRatio = aps.sxp / m.ph.sxp;
      const v = chart.valuesAt(st.E);
      const Et = `${fmtKeV(st.E)} keV`;
      const atFloor = st.preset === 'custom' && (st.e.sx < m.r.size || st.e.sxp < m.r.div * 0.6);

      // ---------------- visitor
      let vis = '';
      if (st.preset === 'aps') {
        vis = `**This is the old APS source.** Its X-rays come from a spot about ${((m.ph.sx * 4) / 1000).toFixed(1)} mm wide and fan out widely, so the lens can only focus them to a broad blur and just **${fmtOneIn(m.pass)}** photons make it through the slit. Press **APS-U**, or drag the sliders, to squeeze it.`;
      } else {
        const who = st.preset === 'custom' ? 'Your source' : 'The APS-U source';
        const head = gain >= 1.05 ? `**Same number of photons — ${fmtGain(gain).slice(1)} times brighter than the old APS.**` : gain <= 0.95 ? `**Same number of photons — but dimmer than the old APS** (${fmtGain(gain)}).` : '**About as bright as the old APS.**';
        const spot = m.focus * 4;
        const spotTxt = spot < 1000 ? `${spot < 10 ? spot.toFixed(1) : Number(spot.toPrecision(2))} µm` : `${(spot / 1000).toFixed(1)} mm`;
        vis = `${head} ${who} is ${fmtRatio(wRatio)} than the old one and its X-rays fan out ${fmtRatio(dRatio, 'less')}, so the lens focuses them to a spot about ${spotTxt} across and **${fmtOneIn(m.pass)}** photons make it through the slit (old APS: ${fmtOneIn(m.passAps)}).`;
        if (m.pass < 0.8 * m.passRay) vis += ` Why is the focus blurred? Light is a wave: a lens this small can’t focus it to a sharp point — worse at low energy (longer waves) — so fewer fit through the slit.`;
        if (m.pass > 0.25 && gain > 100) vis += ` That’s close to the limit: the count can’t rise past “all of them”, even though brightness keeps climbing.`;
        if (atFloor) vis += ` You’ve hit the floor: light is a wave, so even a perfect electron beam makes a source about ${fmtSmall(m.r.size)} µm wide that spreads ${fmtSmall(m.r.div)} µrad at ${Et}. Shorter waves (higher energy) lower the floor.`;
      }
      if (Number.isFinite(v.gain)) {
        // design curves are good to ~±30 % on the ratio: visitors get one significant figure, and the headline
        // figure they will have read elsewhere ("up to 500×", FDR Table 1.1: ×540 at 20 keV) is put in context
        const g = approxGain(v.gain);
        const which = st.ds === 'envelope' ? 'each with its best undulator' : 'with these example undulators';
        vis +=
          v.gain / m.srcU >= 1.5
            ? ` In panel 2, the real machines at ${Et}, ${which}: the upgraded APS has a smaller, tighter source *and* makes more photons (twice the current, better undulators), so its design brightness is **about ${g} times** the old one.`
            : ` In panel 2, the real machines at ${Et}, ${which}: the design brightness is **about ${g} times** the old one — at this energy almost all of it comes from the smaller, tighter source.`;
        vis +=
          st.ds === 'envelope'
            ? ' These are design estimates (±30 %), and the gain depends on the energy, from about 20 times for the softest X-rays to several hundred times at higher energies. The facility quotes one round figure, “up to 500 times brighter” (540× at 20 keV in its design report).'
            : ' Other undulators do better at some energies: “Best of all” shows the best one at each energy.';
      } else vis += ` (No design data at ${Et} for this comparison.)`;

      // ---------------- specialist
      const p = m.ph;
      let sp = `**E = ${st.E.toFixed(1)} keV, λ = ${((P.wavelength(st.E) * 1e10)).toFixed(3)} Å, λ/4π = ${P.diffractionLimitUmUrad(st.E).toFixed(2)} pm.** Kim (L = 2.4 m): σ_{r} = ${fmtSmall(m.r.size)} µm, σ_{r}′ = ${fmtSmall(m.r.div)} µrad. `;
      sp += `${presetName(st.preset)}: Σ_{x} = ${fmtSmall(p.sx)} µm, Σ′_{x} = ${fmtSmall(p.sxp)} µrad, Σ_{y} = ${fmtSmall(p.sy)} µm, Σ′_{y} = ${fmtSmall(p.syp)} µrad → **B = F/(4π²Σ_{x}Σ′_{x}Σ_{y}Σ′_{y}) = ${sci(m.B, 2)}** at F = 10^{15} ph/s/0.1%BW: ${fmtGain(gain)} vs the APS-2019 beam at equal F; ceiling 4F/λ² = ${sci(m.Blim, 2)}. `;
      const sl = P.SLITS;
      const kick = P.diffractionKick(st.E, sl.s1);
      const bx = (aps.sx * aps.sxp) / (p.sx * p.sxp);
      const by = (aps.sy * aps.syp) / (p.sy * p.syp);
      sp += `Lens + slit: A = 2πs_{1}s_{2}/Δz = ${P.acceptance(sl).toFixed(1)} µm·µrad, kick λ/4πs_{1} = ${fmtSmall(kick)} µrad (blur ${fmtSmall(kick * (sl.z2 - sl.z1))} µm), focus ${fmtSmall(m.focus)} µm rms → P = ${pct(m.pass)} (rays ${pct(m.passRay)}, bound A/2πΣ_{x}Σ′_{x} ${pct(P.passFractionSmall(p.sx, p.sxp))}); APS ${pct(m.passAps)} → ${fmtGain(m.pass / m.passAps)} vs horizontal B ratio ${fmtGain(bx)} (the vertical ${fmtGain(by)} is not tested by tall slits). `;
      if (Number.isFinite(v.gain)) {
        const dsName = st.ds === 'envelope' ? 'IPAC’21 envelope' : 'FDR Fig. 2.1, best APS-U device';
        sp += `Design (${dsName}) at ${Et}: APS ${sci(v.old, 2)}, APS-U ${sci(v.best, 2)} → **${fmtGain(v.gain)}** = source term (${st.ring === 'flat' ? 'flat' : 'round'}) ${fmtGain(m.srcU)} × remainder ${fmtGain(v.gain / m.srcU)} (mostly flux; model-dependent). FDR Table 1.1 (20 keV): ×540.`;
      } else sp += `No tabulated design data at ${Et} in this set.`;
      return [vis, sp];
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
    let lastDepth: Depth | '' = '';
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
      if (mode === layoutMode && depth === lastDepth) return fitCaption();
      resetCaptionHeight();
      layoutMode = mode;
      lastDepth = depth;
      const spec = depth === 'specialist';
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
        vs.gridTemplateRows = spec ? '540px' : '520px';
        vs.minHeight = '';
        v2.gridTemplateColumns = 'minmax(0,1fr)';
        v2.gridTemplateRows = spec ? '500px' : '480px';
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
        vs.gridTemplateRows = spec ? '540px' : '520px';
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
    applyDepthLabels();
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

    return {
      destroy: () => station.destroy(),
      setDepth: (d) => {
        depth = d;
        station.setDepth(d);
        applyDepthLabels();
        applyLayout();
        changed(true);
        chart.draw();
      },
    };
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

function setSliderLabel(input: HTMLInputElement, text: string): void {
  const l = input.parentElement?.querySelector('.stn-slider-label');
  if (l) l.textContent = text;
}

function setToggleLabels(wrap: HTMLElement, labels: string[]): void {
  wrap.querySelectorAll('button').forEach((b, i) => {
    if (labels[i]) b.textContent = labels[i];
  });
}

/** nearest ancestor that scrolls vertically (the story dialog's stage), or null */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}
