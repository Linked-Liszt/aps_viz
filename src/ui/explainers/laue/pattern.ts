/**
 * Part 1 of the "laue" station: the Laue pattern of one crystal grain on the 34-ID-E top detector,
 * the (rotationally reduced) Ewald construction, and a 3-D schematic of the set-up.
 * Physics lives in ./physics.ts (see its header for equations, sources and approximations).
 */
import { TOKENS, announcer, canvas2d, group, slider, toggle, button, readout, note, onReducedMotionChange, prefersReducedMotion, type Station, type SliderHandle } from '../kit';
import { rng } from '../../../lib/fft';
import * as P from './physics';
import { eCss, eRgb, hklStr, fix, roundRect, arrow, haloText, textWidth, div, Layer, glowSprite, glowLine } from './common';

export interface PartApi {
  el: HTMLElement;
  ctl: HTMLElement;
  /** width = available width of the part container (px) */
  layout(narrow: boolean, width: number): void;
  setActive(on: boolean): void;
  frame(dt: number): void;
  caption(): string;
  reset(): void;
}

const G_MAX = 25.4; // Å⁻¹. Covers 30 keV over the whole detector (2·k_max·sin 55.9°)
const DECADES = 4.0; // displayed dynamic range of spot intensities (≈ a flat-panel's usable range)
const DEG = Math.PI / 180;
// the spectrum is tabulated (10 eV) because computeLaue evaluates it for ~10⁴ harmonics per orientation
const OPTS: P.LaueOpts = { L: P.GEOM.L, half: P.GEOM.half, Emin: P.BAND.min, Emax: P.BAND.max, spectrum: P.tabulate(P.pinkSpectrum, 4, 32, 0.01), absorption: true };

interface Table {
  tab: P.DirTable;
  Iref: number;
}
const tables: Partial<Record<P.MaterialId, Table>> = {};
function table(id: P.MaterialId): Table {
  let t = tables[id];
  if (!t) {
    const tab = P.buildDirections(P.MATERIALS[id], G_MAX);
    // reference intensity: median over random grains of the brightest spot
    const r = rng(11);
    const maxes: number[] = [];
    for (let i = 0; i < 24; i++) {
      const res = P.computeLaue(tab, P.reciprocalMatrix(tab.material.a, P.randomU(r)), OPTS);
      let m = 0;
      for (const s of res.spots) m = Math.max(m, s.I);
      maxes.push(m);
    }
    maxes.sort((a, b) => a - b);
    t = { tab, Iref: maxes[maxes.length >> 1] };
    tables[id] = t;
  }
  return t;
}

const PRESETS: Record<string, { n: P.Vec3; x: P.Vec3; label: string; title: string }> = {
  '001': { n: [0, 0, 1], x: [1, 0, 0], label: '(001)', title: "Surface normal along [001], with a cube face upward" },
  '011': { n: [0, 1, 1], x: [1, 0, 0], label: '(011)', title: 'Surface normal along [011]' },
  '111': { n: [1, 1, 1], x: [1, -1, 0], label: '(111)', title: "Surface normal along [111], with close-packed planes upward" },
};

const DEFAULTS = { mat: 'Ni' as P.MaterialId, preset: '001', turn: 0, tilt: 4, spin: 9, E0: 12, strain: 0, kind: 'deviatoric' as P.StrainKind };

export function createPattern(station: Station, color: string, onCaption: () => void): PartApi {
  const el = div('laue-part');
  const ctl = div('laue-ctl');
  ctl.style.display = 'contents';

  // ---------------------------------------------------------------- state
  const st = {
    mat: DEFAULTS.mat,
    preset: DEFAULTS.preset as string,
    U0: P.orientFromNormal(PRESETS[DEFAULTS.preset].n, PRESETS[DEFAULTS.preset].x),
    turn: DEFAULTS.turn,
    tilt: DEFAULTS.tilt,
    spin: DEFAULTS.spin,
    mode: 'pink' as 'pink' | 'mono',
    E0: DEFAULTS.E0,
    kind: DEFAULTS.kind,
    strain: DEFAULTS.strain,
    sel: [] as number[],
    hover: -1,
    scanning: false,
    tune: null as null | { from: number; to: number; t: number },
    interacted: false,
  };
  /** after-glow of reflections an energy scan just swept through: spot dir → { v: 0..1, n: harmonic order hit } */
  const flash = new Map<number, { v: number; n: number }>();
  let active = true;
  let narrow = false;
  let dirty = true;
  /** orientation changed since the last recompute (pointer/keyboard events are coalesced per frame) */
  let pending = false;

  // derived
  let U = P.ident();
  let res: P.LaueResult = { spots: [], elsewhere: 0 };
  let map0 = new Map<number, P.Spot>();
  let byDir = new Map<number, P.Spot>();
  let maxShiftPx = 0;
  let Iref = 1;

  let geomVer = 0;
  let tableMat = st.mat;
  function recompute(): void {
    geomVer++;
    const t = table(st.mat);
    Iref = t.Iref;
    const m = t.tab.material;
    U = P.composeU(st.U0, st.turn * DEG, st.tilt * DEG, st.spin * DEG);
    const T0 = P.reciprocalMatrix(m.a, U);
    const minI = Iref * Math.pow(10, -DECADES);
    let res0: P.LaueResult;
    if (st.strain !== 0) {
      const eps = P.strainTensor(st.kind, st.strain);
      res = P.computeLaue(t.tab, P.reciprocalMatrix(m.a, U, eps), OPTS, minI);
      // unstrained twins only for the spots we show (half the cost of a second full pass); no threshold so
      // every strained spot keeps its reference unless it leaves the band or the detector
      res0 = P.computeLaue(t.tab, T0, OPTS, 0, res.spots.map((s) => s.dir));
    } else res = res0 = P.computeLaue(t.tab, T0, OPTS, minI);
    map0 = new Map(res0.spots.map((s) => [s.dir, s]));
    byDir = new Map(res.spots.map((s) => [s.dir, s]));
    maxShiftPx = 0;
    for (const s of res.spots) {
      const s0 = map0.get(s.dir);
      if (s0) maxShiftPx = Math.max(maxShiftPx, Math.hypot(s.x - s0.x, s.z - s0.z) / P.GEOM.pitch);
    }
    // direction indices belong to one material's table: a material switch invalidates hover & selection
    if (st.mat !== tableMat) {
      tableMat = st.mat;
      st.sel = [];
      st.hover = -1;
    }
    st.sel = st.sel.filter((d) => byDir.has(d));
    if (!byDir.has(st.hover)) st.hover = -1;
    // the tooltip describes the hovered spot: hide it when that spot is gone, else follow it with fresh numbers
    if (st.hover < 0) tip.classList.remove('is-on');
    else if (tip.classList.contains('is-on')) {
      const hs = byDir.get(st.hover)!;
      showTip(st.hover, mm2px(hs.x), mmz2py(hs.z));
    }
    dirty = true;
    updateInfo();
    onCaption();
  }

  const bright = (I: number) => Math.max(0, Math.min(1, (Math.log10(I / Iref) + DECADES) / DECADES));

  /** brightness of a spot in monochromatic mode (0..1) and the harmonic that is lit */
  function monoLit(s: P.Spot, glow = true): [number, P.Harmonic | null] {
    let best = 0;
    let hb: P.Harmonic | null = null;
    for (const h of s.harm) {
      const r = P.monoResponse(h.E, st.E0, P.monoWindow(h.E, s.sinT));
      if (r > best) {
        best = r;
        hb = h;
      }
    }
    const fl = glow ? flash.get(s.dir) : undefined;
    if (fl && fl.v > best) {
      // the glow belongs to the harmonic the scan actually crossed (e.g. 006, not the 002 label)
      const hf = s.harm.find((x) => x.n === fl.n);
      if (hf) return [fl.v, hf];
    }
    return [best, hb];
  }

  // ---------------------------------------------------------------- canvases
  const det = canvas2d(el, { label: 'Area detector · seen from the sample' });
  const setup = canvas2d(el, { label: "Geometry · not to scale" });
  const ew = canvas2d(el, { label: 'Ewald construction' });
  const detWrap = det.canvas.parentElement!;
  const setupWrap = setup.canvas.parentElement!;
  const ewWrap = ew.canvas.parentElement!;
  detWrap.classList.add('laue-canvas-focus');
  for (const c of [det, setup, ew]) c.onResize(() => (dirty = true));
  det.canvas.tabIndex = 0;
  det.canvas.setAttribute(
    'aria-label',
    "Laue pattern on the area detector. Drag or use arrow keys to rotate the crystal. Left and right turn about the beam; up and down tilt it; [ and ] spin it. Click a spot or press N and Shift+N to select spots and display their details.",
  );
  const tip = div('laue-tip', detWrap);
  const hint = div('laue-tip', detWrap);
  hint.innerHTML = "Drag to rotate the crystal · tap a spot for details";
  hint.style.left = '50%';
  hint.style.top = '40px';
  hint.style.whiteSpace = 'nowrap';
  hint.style.maxWidth = 'none';
  hint.style.transform = 'translateX(-50%)';
  hint.classList.add('is-on');

  // ---------------------------------------------------------------- controls
  const spotsR = readout(ctl, 'Spots on this detector', { big: true, color });
  // not a live region: it also updates while the crystal turns or the strain slider moves; a spot the visitor picks
  // is announced once through the station's status element (clickSpot)
  const info = div('laue-card', ctl);
  const sr = announcer(station);

  const gBeam = group(ctl, 'X-ray beam');
  const modeT = toggle(gBeam, {
    options: [
      { value: 'pink', label: "Broad spectrum", title: "Pink beam with all energies from 5.3 to 30 keV" },
      { value: 'mono', label: "Single energy", title: "A narrow energy band is selected by Si(111) diffraction" },
    ],
    value: st.mode,
    onChange: (v) => setMode(v as 'pink' | 'mono'),
  });
  const monoBox = div('laue-ctl', gBeam);
  monoBox.style.display = 'flex';
  monoBox.style.flexDirection = 'column';
  monoBox.style.gap = '8px';
  const eS: SliderHandle = slider(monoBox, {
    label: 'Energy',
    min: P.BAND.min,
    max: P.BAND.max,
    step: 0.005,
    value: st.E0,
    format: (v) => `${v.toFixed(3)} keV`,
    onInput: (v) => {
      st.E0 = v;
      st.scanning = false;
      st.tune = null;
      scanBtn.textContent = '▶ Scan energy';
      dirty = true;
      updateInfo();
      onCaption();
    },
  });
  const scanRow = div('laue-row', monoBox);
  const scanBtn = button(scanRow, '▶ Scan energy', () => {
    st.scanning = !st.scanning;
    st.tune = null;
    scanBtn.textContent = st.scanning ? '❚❚ Pause scan' : '▶ Scan energy';
  });
  monoBox.hidden = true;

  const gStrain = group(ctl, 'Strain the crystal');
  const kindT = toggle(gStrain, {
    options: [
      { value: 'deviatoric', label: 'Stretch', title: "Volume-conserving stretch along X, called deviatoric strain" },
      { value: 'hydrostatic', label: "Expand equally", title: "Equal expansion in all directions, called hydrostatic strain" },
    ],
    value: st.kind,
    onChange: (v) => {
      st.kind = v as P.StrainKind;
      recompute();
    },
  });
  const strainS = slider(gStrain, {
    label: 'Strain ε',
    min: -1,
    max: 1,
    step: 0.01,
    value: st.strain * 100,
    format: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} %`,
    onInput: (v) => {
      st.strain = v / 100;
      recompute();
    },
  });

  const gOri = group(ctl, 'Turn the grain');
  const turnS = slider(gOri, { label: 'Turn about beam', min: -180, max: 180, step: 0.1, value: st.turn, format: (v) => `${fix(v, 1)}°`, onInput: (v) => setAngles(v, st.tilt, st.spin) });
  const tiltS = slider(gOri, { label: 'Tilt', min: -40, max: 40, step: 0.05, value: st.tilt, format: (v) => `${fix(v, 2)}°`, onInput: (v) => setAngles(st.turn, v, st.spin) });
  const spinS = slider(gOri, { label: 'Spin on its surface', min: -180, max: 180, step: 0.1, value: st.spin, format: (v) => `${fix(v, 1)}°`, onInput: (v) => setAngles(st.turn, st.tilt, v) });

  const gCry = group(ctl, 'Crystal');
  toggle(gCry, {
    options: [
      { value: 'Ni', label: 'Nickel', title: 'Ni, a = 3.524 Å, face-centred cubic' },
      { value: 'Si', label: "Silicon", title: 'Si, a = 5.431 Å, diamond structure' },
    ],
    value: st.mat,
    onChange: (v) => {
      st.mat = v as P.MaterialId;
      st.sel = [];
      recompute();
    },
  });
  const presetRow = div('laue-row', gCry);
  const presetBtns: HTMLButtonElement[] = [];
  for (const [k, p] of Object.entries(PRESETS)) {
    const b = button(presetRow, p.label, () => applyPreset(k));
    b.title = p.title;
    b.dataset.k = k;
    presetBtns.push(b);
  }
  const rndBtn = button(presetRow, 'Random grain', () => applyPreset('random'));
  rndBtn.title = 'A randomly oriented grain, as in a polycrystal';
  presetBtns.push(rndBtn);
  rndBtn.dataset.k = 'random';
  let rndSeed = 3;

  note(
    ctl,
    station,
    "Tap two spots to measure the angle between their atomic planes. Stretch the crystal to change that angle from its unstrained value. Identifying planes from these angles is called indexing. Fitting their small differences with software such as LaueGo measures shape-changing strain to about 1 part in 10⁴.",
  );
  note(
    ctl,
    station,
    "A smaller source image is formed by mirror focusing. Its horizontal rms width fell from 280 to 14.7 µm after the upgrade. The design focus at 14 keV is 103 × 68 nm, or 37 × 37 nm in the nano station, compared with 0.3 to 0.5 µm before the upgrade. The design flux rises ~1,000×, from ≈10¹¹ to 10¹⁴ photons/s. A pattern could then come from a small group of defects within a grain, and 3-D maps that took days are expected to take minutes. These are design values. 3DMN is still being commissioned as of October 2026.",
  );
  const resetRow = div('laue-row', ctl);
  button(resetRow, '↺ Reset', () => reset());
  // the model's fine print, in smaller type
  const gModel = group(ctl, 'About this model');
  note(
    gModel,
    station,
    "The model uses one grain in the 34-ID-E geometry. The square detector is 409.6 mm wide, with 2,048² pixels of 200 µm, and sits 510.9 mm above the sample at 2θ = 90°. Spot intensity follows kinematic diffraction theory for a thick crystal, including absorption. Nickel spots just above its 8.33 keV absorption edge are ~8× weaker. The broad-spectrum beam shape is illustrative. The model omits extinction, air absorption and detector efficiency. The Si(111) bandwidth is ΔE/E ≈1.3×10⁻⁴. Each reflection accepts a band set by ≈1 mrad of beam convergence and crystal mosaic spread, both illustrative. At 3DMN, broad-spectrum and single-energy beams are focused onto the same ~100 nm spot. One 200 µm pixel spans ≈3.9×10⁻⁴ rad of scattering angle. The Ewald plot rotates each lattice point about the beam into a single plane. This reduction is exact because the spherical shells are symmetric about the beam axis.",
  );
  (gModel.lastElementChild as HTMLElement).style.fontSize = '11.5px';

  // ---------------------------------------------------------------- state changes
  /** user-driven orientation change: coalesced, the pattern is recomputed once in the next frame */
  function setAngles(turn: number, tilt: number, spin: number): void {
    interacted();
    setAnglesQuiet(turn, tilt, spin);
  }
  function setAnglesQuiet(turn: number, tilt: number, spin: number): void {
    const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
    st.turn = wrap(turn);
    st.tilt = Math.max(-40, Math.min(40, tilt));
    st.spin = wrap(spin);
    turnS.set(st.turn);
    tiltS.set(st.tilt);
    spinS.set(st.spin);
    pending = true;
  }

  function applyPreset(k: string): void {
    st.preset = k;
    if (k === 'random') {
      st.U0 = P.randomU(rng(rndSeed++ * 7919));
    } else st.U0 = P.orientFromNormal(PRESETS[k].n, PRESETS[k].x);
    st.turn = 0;
    st.tilt = 0;
    st.spin = 0;
    turnS.set(0);
    tiltS.set(0);
    spinS.set(0);
    st.sel = [];
    markPreset();
    recompute();
  }
  function markPreset(): void {
    for (const b of presetBtns) b.setAttribute('aria-pressed', String(b.dataset.k === st.preset));
  }

  function setMode(m: 'pink' | 'mono'): void {
    st.mode = m;
    monoBox.hidden = m !== 'mono';
    st.scanning = false;
    st.tune = null;
    scanBtn.textContent = '▶ Scan energy';
    flash.clear();
    dirty = true;
    updateInfo();
    onCaption();
  }

  for (const ev of ['pointerdown', 'input', 'click', 'keydown'] as const) station.root.addEventListener(ev, () => interacted(), true);
  function interacted(): void {
    if (!st.interacted) {
      st.interacted = true;
      hint.classList.remove('is-on');
    }
  }

  function reset(): void {
    st.mat = DEFAULTS.mat;
    st.sel = [];
    st.hover = -1;
    st.E0 = DEFAULTS.E0;
    eS.set(st.E0);
    st.kind = DEFAULTS.kind;
    kindT.set(st.kind);
    st.strain = DEFAULTS.strain;
    strainS.set(0);
    modeT.set('pink');
    setMode('pink');
    st.preset = DEFAULTS.preset;
    st.U0 = P.orientFromNormal(PRESETS[DEFAULTS.preset].n, PRESETS[DEFAULTS.preset].x);
    markPreset();
    matToggleSet(DEFAULTS.mat);
    setAngles(DEFAULTS.turn, DEFAULTS.tilt, DEFAULTS.spin);
  }
  // the crystal toggle handle is created inline above; keep a setter for reset
  const matButtons = gCry.querySelectorAll<HTMLButtonElement>('.stn-toggle button');
  function matToggleSet(id: P.MaterialId): void {
    matButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0 ? 'Ni' : 'Si') === id)));
  }

  // ---------------------------------------------------------------- info card + caption
  function updateInfo(): void {
    const sel = st.sel.map((d) => byDir.get(d)).filter((s): s is P.Spot => !!s);
    const m = P.MATERIALS[st.mat];
    const metal = m.id === 'Ni' ? 'nickel' : 'silicon';
    if (!sel.length) {
      info.innerHTML = '';
      return;
    }
    const parts: string[] = [];
    for (const s of sel) {
      const h0 = s.harm[0];
      const dS = (P.HC / h0.E) / (2 * s.sinT); // d of the strained lattice from Bragg
      if (st.mode === 'mono') {
        const [lit, hb] = monoLit(s);
        if (hb && lit > 0.25) {
          const dm = P.HC / (2 * hb.E * s.sinT);
          const N = Math.sqrt(hb.h * hb.h + hb.k * hb.k + hb.l * hb.l);
          const aM = dm * N;
          const da = ((aM - m.a) / m.a) * 100;
          parts.push(
            `Reflection ${hklStr(hb.h, hb.k, hb.l)} occurs at ${hb.E.toFixed(3)} keV. The measured energy gives the plane spacing d = λ ÷ (2 sinθ) = ${dm.toFixed(4)} Å. It also gives the cubic unit-cell edge, ${aM.toFixed(4)} Å. This is ${Math.abs(da) < 5e-4 ? 'unstrained' : `${signed(da, 3)} % from the unstrained ${m.a.toFixed(4)} Å`}. Spot positions alone give relative shape and orientation. An energy measurement is needed for absolute lattice spacing.`,
          );
        } else {
          const ov = s.harm.slice(1);
          parts.push(
            `Reflection ${hklStr(h0.h, h0.k, h0.l)} is absent at ${st.E0.toFixed(3)} keV. It requires ${h0.E.toFixed(3)} keV${ov.length ? `, or ${ov.map((h) => h.E.toFixed(3)).join(' or ')} keV for higher-order reflections` : ''}, within about ±${(P.monoWindow(h0.E, s.sinT) / 2 * 1000).toFixed(0)} eV. Tap the spot to tune the monochromator to that energy.`,
          );
        }
        continue;
      }
      // names the label harmonic h0 with ITS energy and d (Bragg-consistent, strained lattice)
      const lam = P.HC / h0.E;
      const s0 = st.strain !== 0 ? map0.get(s.dir) : undefined;
      const e0 = s0?.harm.find((x) => x.n === h0.n);
      const moved = s0 ? Math.hypot(s.x - s0.x, s.z - s0.z) / P.GEOM.pitch : 0;
      const dEtxt = e0
        ? ` Strain changed the energy from ${e0.E.toFixed(3)} to ${h0.E.toFixed(3)} keV, a change of ${signed((h0.E / e0.E - 1) * 100, 3)} %${moved < 0.05 ? ' without moving the spot' : `, and moved the spot ${moved.toFixed(1)} detector pixels`}.`
        : '';
      parts.push(
        `For reflection ${hklStr(h0.h, h0.k, h0.l)}, planes ${dS.toFixed(4)} Å apart reflect ${h0.E.toFixed(2)} keV X-rays with wavelength ${lam.toFixed(3)} Å through 2θ = ${(s.tth / DEG).toFixed(2)}°. At this energy, X-ray intensity falls to 1/e over ${(1 / h0.mu).toFixed(1)} µm of ${metal}.${s.harm.length > 1 ? ` The spot also contains ${s.harm.length - 1} higher-order reflection${s.harm.length > 2 ? 's' : ''}. Their planes are ${s.harm.slice(1).map((h) => `${+(h.n / h0.n).toFixed(2)}×`).join(', ')} closer, at ${s.harm.slice(1).map((h) => h.E.toFixed(2)).join(', ')} keV.` : ''}${dEtxt}`,
      );
    }
    if (sel.length === 2 && st.mode === 'pink') {
      const [a, b] = sel;
      const meas = P.angleBetween([a.gx, a.gy, a.gz], [b.gx, b.gy, b.gz]) / DEG;
      const ideal = P.angleBetween([a.h, a.k, a.l], [b.h, b.k, b.l]) / DEG;
      const dd = meas - ideal;
      parts.push(
        `The two plane families meet at ${meas.toFixed(4)}°${Math.abs(dd) >= 5e-5 ? `. An unstrained crystal would give ${ideal.toFixed(4)}°. The difference is ${signed(dd, 4)}°, or ${fmtE(dd * DEG)} rad, and measures the strain.` : '. This agrees with the unstrained crystal geometry. Matching these angles identifies the planes and determines the grain orientation, a process called indexing.'}`,
      );
    }
    info.innerHTML = parts.map((p) => `<div>${mdLite(p)}</div>`).join('<div style="height:6px"></div>');
  }

  function litCount(): number {
    let n = 0;
    for (const s of res.spots) if (monoLit(s, false)[0] > 0.25) n++;
    return n;
  }

  let lastCount = '';
  function caption(): string {
    const N = res.spots.length;
    const cnt = st.mode === 'mono' ? `${litCount()} of ${N}` : `${N}`;
    if (cnt !== lastCount) {
      lastCount = cnt;
      spotsR.set(cnt);
    }
    const m = P.MATERIALS[st.mat];
    const strained = st.strain !== 0;
    const pct = `${Math.abs(st.strain * 100).toFixed(2)} %`;
    let v = '';
    if (st.mode === 'mono') {
      const n = litCount();
      v = `At ${st.E0.toFixed(3)} keV, ${n === 0 ? `none of the ${N} reflections occurs` : n === 1 ? `1 of the ${N} reflections occurs` : `${n} of the ${N} reflections occur`}. This energy is selected from the broad spectrum by silicon-crystal diffraction. At a single wavelength, few atomic planes are at the required angle. Press Scan energy or tap a grey ring to tune to a reflection. Its energy gives the absolute plane spacing and the uniform expansion that spot positions cannot measure.`;
    } else {
      v = `The pattern has ${N} spots. Each represents a family of atomic planes in this ${m.id === 'Ni' ? 'nickel' : 'silicon'} grain, with a matching X-ray energy from the 5.3 to 30 keV beam. The colours represent energy. Bragg's law is λ = 2d sinθ, where λ is wavelength, d is plane spacing and θ is the glancing angle. A spot gives the plane direction. Planes 2× or 3× closer reflect 2× or 3× the energy onto the same spot. Drag to rotate the crystal and change the pattern. Such a pattern determines grain orientation without rotating the sample during measurement.`;
    }
    if (strained) {
      if (st.kind === 'hydrostatic') {
        v += ` You ${st.strain > 0 ? 'expanded' : 'contracted'} the crystal by ${pct} in every direction. The spots stayed in place, while every reflection energy changed by ${signed(-st.strain / (1 + st.strain) * 100, 2)} %. Strain has six independent components. Spot positions give the five that change shape. One exact energy measurement gives the sixth, which changes volume.`;
      } else {
        const side = Math.abs((1 / Math.sqrt(1 + st.strain) - 1) * 100).toFixed(2);
        v += ` You ${st.strain > 0 ? 'stretched' : 'compressed'} the crystal sideways by ${pct}. Its dimensions ${st.strain > 0 ? 'decrease' : 'increase'} by ${side} % in the other two directions, keeping the volume constant. Spots shift by up to ${maxShiftPx.toFixed(1)} detector pixels. The arrows are magnified. Fitting spot centres to a fraction of a 200 µm pixel can resolve shape-changing strains of ~10⁻⁴.`;
      }
    }
    return v;
  }

  // ---------------------------------------------------------------- detector drawing
  let dg = { x0: 0, y0: 0, S: 1, barY: 0, barH: 0 };
  const detBg = new Layer();
  const ewBg = new Layer();
  const ewDots = new Layer();
  const mm2px = (x: number) => dg.x0 + ((x + P.GEOM.half) / (2 * P.GEOM.half)) * dg.S;
  const mmz2py = (z: number) => dg.y0 + ((P.GEOM.half - z) / (2 * P.GEOM.half)) * dg.S;
  const eMin = 5;
  const eMax = 30;
  const e2x = (E: number) => dg.x0 + ((E - eMin) / (eMax - eMin)) * dg.S;
  const x2e = (x: number) => eMin + ((x - dg.x0) / dg.S) * (eMax - eMin);

  function drawDetector(): void {
    const { ctx, w, h } = det;
    ctx.clearRect(0, 0, w, h);
    if (w < 60 || h < 60) return;
    const top = 30;
    const barH = 56;
    const side = 30;
    const S = Math.max(80, Math.min(w - 2 * side, h - top - barH - 6));
    dg = { x0: Math.round((w - S) / 2), y0: top, S, barY: top + S + 8, barH };
    const { x0, y0 } = dg;

    detBg.draw(det, `${S}|${st.mode}`, (c) => {
      drawBarStatic(c);
      // detector face
      c.save();
      roundRect(c, x0, y0, S, S, 6);
      const grd = c.createLinearGradient(x0, y0, x0 + S, y0 + S);
      grd.addColorStop(0, '#0b1320');
      grd.addColorStop(1, '#070b13');
      c.fillStyle = grd;
      c.fill();
      c.strokeStyle = 'rgba(150,180,220,0.28)';
      c.lineWidth = 1;
      c.stroke();
      c.clip();
      // 256-pixel grid
      c.strokeStyle = 'rgba(140,170,210,0.06)';
      for (let i = 1; i < 8; i++) {
        const p = x0 + (i / 8) * S;
        const q = y0 + (i / 8) * S;
        c.beginPath();
        c.moveTo(p, y0);
        c.lineTo(p, y0 + S);
        c.moveTo(x0, q);
        c.lineTo(x0 + S, q);
        c.stroke();
      }
      // 2θ contours
      c.setLineDash([3, 4]);
      for (const t of [70, 80, 90, 100, 110]) {
        const cot = 1 / Math.tan(t * DEG);
        c.strokeStyle = t === 90 ? 'rgba(170,190,215,0.22)' : 'rgba(170,190,215,0.13)';
        c.beginPath();
        for (let i = 0; i <= 40; i++) {
          const x = -P.GEOM.half + (i / 40) * 2 * P.GEOM.half;
          const z = cot * Math.sqrt(x * x + P.GEOM.L * P.GEOM.L);
          if (i === 0) c.moveTo(mm2px(x), mmz2py(z));
          else c.lineTo(mm2px(x), mmz2py(z));
        }
        c.stroke();
      }
      c.setLineDash([]);
      c.restore();
      for (const t of [70, 80, 90, 100, 110]) {
        const z = (1 / Math.tan(t * DEG)) * Math.sqrt(P.GEOM.L * P.GEOM.L + P.GEOM.half * P.GEOM.half);
        const y = mmz2py(z);
        if (y > y0 + 4 && y < y0 + S - 4) haloText(c, `${t}°`, x0 + S + 3, y + 3, { size: 9.5, color: 'rgba(170,190,215,0.7)' });
      }
      haloText(c, '2θ', x0 + S + 3, y0 - 4, { size: 9.5, color: 'rgba(170,190,215,0.7)' });

      // orientation annotations outside the face
      c.save();
      c.translate(x0 - 11, y0 + S / 2);
      c.rotate(-Math.PI / 2);
      haloText(c, 'downstream (beam direction) →', 0, 0, { size: 10, color: TOKENS.ink3, align: 'center', baseline: 'middle' });
      c.restore();
    });

    // strain arrows
    let mag = 0;
    if (st.strain !== 0 && maxShiftPx > 0.02) {
      const pxPerDetPx = dg.S / P.GEOM.npix;
      const maxScreen = maxShiftPx * pxPerDetPx;
      mag = niceMag(Math.max(1, 34 / Math.max(maxScreen, 1e-6)));
      ctx.save();
      for (const s of res.spots) {
        const s0 = map0.get(s.dir);
        if (!s0) continue;
        const ax = mm2px(s0.x);
        const ay = mmz2py(s0.z);
        const bx = ax + (mm2px(s.x) - ax) * mag;
        const by = ay + (mmz2py(s.z) - ay) * mag;
        if (Math.hypot(bx - ax, by - ay) < 2) continue;
        arrow(ctx, ax, ay, bx, by, 'rgba(233,238,245,0.75)', 1.2, 6);
      }
      ctx.restore();
    }

    // spots
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, S, S);
    ctx.clip();
    const mono = st.mode === 'mono';
    const sc = Math.max(0.75, Math.min(1.25, S / 460));
    for (const s of res.spots) {
      const b = bright(s.I);
      const x = mm2px(s.x);
      const y = mmz2py(s.z);
      const r = (2 + 5 * Math.pow(b, 1.2)) * sc;
      if (mono) {
        const [lit, hb] = monoLit(s);
        ctx.strokeStyle = 'rgba(200,215,235,0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(3, r + 1.5), 0, Math.PI * 2);
        ctx.stroke();
        if (lit > 0.02 && hb) glowSpot(ctx, x, y, r * (0.8 + 0.6 * lit), eRgb(hb.E), lit);
      } else glowSpot(ctx, x, y, r, eRgb(s.E), 0.5 + 0.5 * b);
    }
    ctx.restore();

    // hover / selection rings, labels
    const labelled = new Set<number>();
    const ringed = [...st.sel];
    if (st.hover >= 0 && !ringed.includes(st.hover)) ringed.push(st.hover);
    for (const d of ringed) {
      const s = byDir.get(d);
      if (!s) continue;
      const x = mm2px(s.x);
      const y = mmz2py(s.z);
      ctx.save();
      ctx.strokeStyle = st.sel.includes(d) ? color : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 10 * sc, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      labelled.add(d);
      const t = `${hklStr(s.h, s.k, s.l)}`;
      const lx = x + 13 * sc;
      const tw = textWidth(ctx, t, 11, 600, true);
      const alignRight = lx + tw > x0 + S - 4;
      haloText(ctx, t, alignRight ? x - 13 * sc : lx, y - 8, { size: 11, weight: 600, mono: true, color: '#fff', align: alignRight ? 'right' : 'left' });
    }
    if (st.sel.length === 2) {
      const a = byDir.get(st.sel[0]);
      const b = byDir.get(st.sel[1]);
      if (a && b) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(mm2px(a.x), mmz2py(a.z));
        ctx.lineTo(mm2px(b.x), mmz2py(b.z));
        ctx.stroke();
        ctx.restore();
      }
    }
    if (st.sel.length === 0) {
      // label the strongest few spots so the pattern reads as "indexed"
      const nLab = 8;
      const sorted = [...res.spots].sort((a, b) => b.I - a.I).slice(0, nLab);
      const boxes: [number, number, number, number][] = [];
      for (const s of sorted) {
        if (labelled.has(s.dir)) continue;
        const x = mm2px(s.x);
        const y = mmz2py(s.z);
        const t = hklStr(s.h, s.k, s.l);
        const tw = textWidth(ctx, t, 9.5, 500, true);
        let lx = x + 7;
        if (lx + tw > x0 + S - 3) lx = x - 7 - tw;
        const ly = y + 13;
        const box: [number, number, number, number] = [lx - 2, ly - 10, lx + tw + 2, ly + 2];
        if (box[1] < y0 || box[3] > y0 + S) continue;
        if (boxes.some((o) => !(box[2] < o[0] || box[0] > o[2] || box[3] < o[1] || box[1] > o[3]))) continue;
        boxes.push(box);
        haloText(ctx, t, lx, ly, { size: 9.5, mono: true, color: mono ? 'rgba(183,195,210,0.5)' : 'rgba(233,238,245,0.72)' });
      }
    }
    if (mono) {
      // name the spots that are lit right now, with the energy that lights them
      for (const sp2 of res.spots) {
        if (labelled.has(sp2.dir)) continue;
        const [lit, hb] = monoLit(sp2);
        if (lit < 0.3 || !hb) continue;
        const x = mm2px(sp2.x);
        const y = mmz2py(sp2.z);
        const t = `${hklStr(hb.h, hb.k, hb.l)} · ${hb.E.toFixed(2)} keV`;
        const tw = textWidth(ctx, t, 10.5, 600, true);
        const right = x + 12 + tw > x0 + S - 4;
        haloText(ctx, t, right ? x - 12 : x + 12, y - 9, { size: 10.5, weight: 600, mono: true, color: eCss(hb.E), align: right ? 'right' : 'left' });
      }
    }
    if (mag > 0) {
      // on a backing pill: the bottom-right corner of the face often holds a spot
      const t = `arrows: shift ×${mag}`;
      const tw = textWidth(ctx, t, 10.5, 600) + 16;
      ctx.save();
      roundRect(ctx, x0 + S - 6 - tw, y0 + S - 26, tw, 20, 10);
      ctx.fillStyle = 'rgba(8,13,22,0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(233,238,245,0.3)';
      ctx.stroke();
      ctx.restore();
      haloText(ctx, t, x0 + S - 6 - tw / 2, y0 + S - 12, { size: 10.5, weight: 600, color: '#fff', align: 'center' });
    }
    if (st.strain !== 0 && st.kind === 'hydrostatic') {
      const t = 'Spot positions are unchanged. Energies changed.';
      const tw = Math.min(S - 16, textWidth(ctx, t, 11, 600) + 18);
      ctx.save();
      roundRect(ctx, x0 + (S - tw) / 2, y0 + 8, tw, 22, 11);
      ctx.fillStyle = 'rgba(8,13,22,0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(251,191,36,0.55)';
      ctx.stroke();
      ctx.restore();
      haloText(ctx, t, x0 + S / 2, y0 + 23, { size: 11, weight: 600, color: TOKENS.warn, align: 'center' });
    }

    drawEnergyBar(ctx);
  }

  /** static part of the energy bar (spectrum, colour strip, axis). Rendered into the detector's cached layer */
  function drawBarStatic(c: CanvasRenderingContext2D): void {
    const { barY } = dg;
    const specH = 20;
    const stripY = barY + specH + 2;
    const stripH = 7;
    // spectrum
    c.save();
    c.beginPath();
    c.moveTo(e2x(eMin), stripY);
    for (let i = 0; i <= 120; i++) {
      const E = eMin + (i / 120) * (eMax - eMin);
      const v = E < P.BAND.min ? 0 : P.pinkSpectrum(E);
      c.lineTo(e2x(E), stripY - v * specH);
    }
    c.lineTo(e2x(eMax), stripY);
    c.closePath();
    c.fillStyle = st.mode === 'mono' ? 'rgba(200,215,235,0.06)' : 'rgba(200,215,235,0.13)';
    c.fill();
    c.restore();
    // colour strip
    for (let i = 0; i < 100; i++) {
      const E0 = eMin + (i / 100) * (eMax - eMin);
      const E1 = eMin + ((i + 1) / 100) * (eMax - eMin);
      const inBand = E0 >= P.BAND.min - 0.01;
      c.fillStyle = eCss(Math.max(E0, P.BAND.min), !inBand ? 0.12 : st.mode === 'mono' ? 0.35 : 0.95);
      c.fillRect(e2x(E0), stripY, e2x(E1) - e2x(E0) + 0.6, stripH);
    }
    // axis
    for (let E = 5; E <= 30; E += 5) {
      const x = e2x(E);
      haloText(c, E === 30 ? '30 keV' : `${E}`, E === 30 ? x + 3 : x, stripY + stripH + 12, { size: 10, color: TOKENS.ink3, align: E === 30 ? 'right' : 'center' });
    }
  }

  function drawEnergyBar(ctx: CanvasRenderingContext2D): void {
    const { x0, S, barY } = dg;
    const specH = 20;
    const stripY = barY + specH + 2;
    const stripH = 7;
    // spot energies as ticks
    for (const s of res.spots) {
      const b = bright(s.I);
      for (const hm of s.harm) {
        const x = e2x(hm.E);
        const a = st.mode === 'mono' ? 0.25 + 0.75 * Math.min(1, monoLit(s)[0]) : 0.25 + 0.7 * b;
        ctx.strokeStyle = eCss(hm.E, a);
        ctx.lineWidth = st.hover === s.dir || st.sel.includes(s.dir) ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, stripY - 2);
        ctx.lineTo(x, stripY - 2 - (st.hover === s.dir || st.sel.includes(s.dir) ? specH : 4 + 8 * b));
        ctx.stroke();
      }
    }
    let shift = '';
    if (st.mode === 'pink' && st.strain !== 0 && res.spots.length) {
      // relative energy change of each spot's strongest harmonic
      let lo = Infinity;
      let hi = -Infinity;
      for (const sp of res.spots) {
        const s0 = map0.get(sp.dir);
        if (!s0) continue;
        const hm = strongest(sp);
        const h0 = s0.harm.find((x) => x.n === hm.n);
        if (!h0) continue;
        const r = (hm.E / h0.E - 1) * 100;
        lo = Math.min(lo, r);
        hi = Math.max(hi, r);
      }
      if (lo <= hi) shift = st.kind === 'hydrostatic' || hi - lo < 0.005 ? `every energy ${signed(lo, 2)} %` : `energies ${signed(lo, 2)} … ${signed(hi, 2)} %`;
    }
    const full = st.mode === 'mono' ? 'monochromator energy · drag' : 'illustrative pink-beam spectrum & spot energies';
    const title = shift && textWidth(ctx, full, 9.5) + textWidth(ctx, shift, 10, 600) + 16 > S ? 'spot energies' : full;
    const markerLeft = st.mode === 'mono' && e2x(st.E0) < x0 + textWidth(ctx, title, 9.5) + 50;
    haloText(ctx, title, markerLeft ? x0 + S : x0, barY + 8, { size: 9.5, color: TOKENS.ink3, align: markerLeft ? 'right' : 'left' });
    if (shift) haloText(ctx, shift, x0 + S, barY + 8, { size: 10, weight: 600, color: st.kind === 'hydrostatic' ? TOKENS.warn : TOKENS.ink, align: 'right' });
    if (st.mode === 'mono') {
      const x = e2x(st.E0);
      glowLine(ctx, () => {
        ctx.moveTo(x, barY + 2);
        ctx.lineTo(x, stripY + stripH + 2);
      }, eCss(st.E0), 2, 7, 0.35);
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, barY + 2);
      ctx.lineTo(x, stripY + stripH + 2);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(x - 5, stripY + stripH + 3);
      ctx.lineTo(x + 5, stripY + stripH + 3);
      ctx.lineTo(x, stripY + stripH - 3);
      ctx.fill();
      const t = `${st.E0.toFixed(3)} keV`;
      const tw = textWidth(ctx, t, 10.5, 600, true);
      const lx = Math.min(x0 + S - tw, Math.max(x0, x - tw / 2));
      haloText(ctx, t, lx, barY + 8, { size: 10.5, weight: 600, mono: true, color: '#fff' });
    }
  }

  function glowSpot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: [number, number, number], a: number): void {
    const spr = glowSprite(rgb);
    if (!spr) return;
    const R = r * 2.8;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(spr, x - R, y - R, 2 * R, 2 * R);
    ctx.globalAlpha = 1;
    if (a > 0.55) {
      ctx.fillStyle = `rgba(255,255,255,${((a - 0.55) * 1.6).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- Ewald drawing

  const ewPts = new Float64Array(600 * 3);
  let ewN = 0;
  let dotImg: ImageData | null = null;
  let dotPix = new Uint32Array(0);
  let onDetMask = new Uint8Array(0);
  function drawEwald(): void {
    const { ctx, w, h } = ew;
    ctx.clearRect(0, 0, w, h);
    if (w < 60 || h < 60) return;
    const kMax = P.BAND.max / P.HBARC;
    const kMin = P.BAND.min / P.HBARC;
    const padL = 14;
    const padR = 14;
    const leg1 = 'dots = families of atomic planes';
    const leg2 = 'inside the rainbow shell ⇒ they reflect';
    // the DOM canvas label ("EWALD CONSTRUCTION") occupies ≈ 150 px at the top left
    const legW = Math.max(textWidth(ctx, leg1, 9.5), textWidth(ctx, leg2, 9.5));
    const legBelow = w - 8 - legW < 160;
    const padT = legBelow ? 50 : 28;
    const padB = 30;
    const qzMin = -2 * kMax - 0.6;
    const qzMax = 2.2;
    const qpMax = kMax + 1.2;
    const sc = Math.min((w - padL - padR) / (qzMax - qzMin), (h - padT - padB) / qpMax);
    const drawW = (qzMax - qzMin) * sc;
    const ox = padL + (w - padL - padR - drawW) / 2 + -qzMin * sc;
    const oy = h - padB;

    const X = (qz: number) => ox + qz * sc;
    const Y = (qp: number) => oy - qp * sc;
    const mono = st.mode === 'mono';

    ewBg.draw(ew, `${w}|${h}|${st.mode}`, (c) => {
      c.save();
      c.beginPath();
      c.rect(0, 0, w, oy);
      c.clip();
      // rainbow shell between the 5.3 and 30 keV spheres
      const steps = 48;
      for (let i = steps; i >= 0; i--) {
        const E = P.BAND.min * Math.pow(P.BAND.max / P.BAND.min, i / steps);
        const k = E / P.HBARC;
        c.fillStyle = eCss(E, mono ? 0.045 : 0.1);
        c.beginPath();
        c.arc(X(-k), oy, k * sc, Math.PI, 2 * Math.PI);
        c.fill();
      }
      c.fillStyle = TOKENS.bg;
      c.beginPath();
      c.arc(X(-kMin), oy, kMin * sc, Math.PI, 2 * Math.PI);
      c.fill();
      // limiting spheres
      c.lineWidth = 1.5;
      for (const E of [P.BAND.min, P.BAND.max]) {
        const k = E / P.HBARC;
        c.strokeStyle = eCss(E, mono ? 0.35 : 0.9);
        c.beginPath();
        c.arc(X(-k), oy, k * sc, Math.PI, 2 * Math.PI);
        c.stroke();
      }
      // detector wedge (2θ range at the detector's centre line)
      const t1 = Math.atan2(P.GEOM.L, P.GEOM.half) / 2; // θ min
      const t2 = Math.atan2(P.GEOM.L, -P.GEOM.half) / 2; // θ max
      const R = 2 * kMax + 1;
      c.fillStyle = 'rgba(233,238,245,0.045)';
      c.beginPath();
      c.moveTo(ox, oy);
      for (let i = 0; i <= 20; i++) {
        const th = t1 + ((t2 - t1) * i) / 20;
        const ang = Math.PI / 2 + th; // angle of G from +qz
        c.lineTo(X(R * Math.cos(ang)), Y(R * Math.sin(ang)));
      }
      c.closePath();
      c.fill();
      c.setLineDash([3, 4]);
      c.strokeStyle = 'rgba(233,238,245,0.25)';
      c.lineWidth = 1;
      for (const th of [t1, t2]) {
        const ang = Math.PI / 2 + th;
        c.beginPath();
        c.moveTo(ox, oy);
        c.lineTo(X(R * Math.cos(ang)), Y(R * Math.sin(ang)));
        c.stroke();
      }
      c.setLineDash([]);

      c.restore();
      // axis & labels
      c.strokeStyle = TOKENS.axis;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(X(qzMin), oy);
      c.lineTo(X(qzMax), oy);
      c.stroke();
      for (let q = -30; q <= 0; q += 10) {
        c.beginPath();
        c.moveTo(X(q), oy);
        c.lineTo(X(q), oy + 4);
        c.stroke();
        haloText(c, `${q}`, X(q), oy + 14, { size: 9.5, color: TOKENS.ink3, align: 'center' });
      }
      haloText(c, "q along beam · Å⁻¹ →", X(qzMin), oy + 26, { size: 10, color: TOKENS.ink3 });
      haloText(c, '000', ox - 3, oy - 4, { size: 10, color: TOKENS.ink2, mono: true, align: 'right' });
      const kM = kMax;
      haloText(c, '30 keV sphere', X(-kM), Y(kM) - 5, { size: 10, color: eCss(30), align: 'center' });
      haloText(c, '5.3 keV', X(-2 * kMin) - 4, oy - 4, { size: 10, color: eCss(5.3), align: 'right' });
      // "detector" just outside the 30 keV sphere, beside the wedge's low-2θ edge (r_sphere = −2k cos∠)
      const angIn = Math.PI / 2 + t1;
      const rL = -2 * kMax * Math.cos(angIn) + 0.9;
      const dTxt = "detector · 2θ 68 to 112°";
      haloText(c, dTxt, X(rL * Math.cos(angIn)) + 7, Y(rL * Math.sin(angIn)) + 3, { size: 9.5, color: 'rgba(233,238,245,0.7)', align: 'left' });
      haloText(c, leg1, w - 8, legBelow ? 32 : 14, { size: 9.5, color: TOKENS.ink3, align: 'right' });
      haloText(c, leg2, w - 8, legBelow ? 44 : 26, { size: 9.5, color: TOKENS.ink3, align: 'right' });
    });
    if (mono) {
      const k = st.E0 / P.HBARC;
      glowLine(ctx, () => ctx.arc(X(-k), oy, k * sc, Math.PI, 2 * Math.PI), eCss(st.E0), 2, 7, 0.25);
  if (mono) haloText(ctx, `${st.E0.toFixed(2)} keV`, X(-st.E0 / P.HBARC), Y(st.E0 / P.HBARC) - 5, { size: 10, color: '#fff', weight: 600, align: 'center' });
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, oy);
    ctx.clip();
    // reciprocal-lattice points
    const t = table(st.mat);
    const m = t.tab.material;
    const T = st.strain !== 0 ? P.reciprocalMatrix(m.a, U, P.strainTensor(st.kind, st.strain)) : P.reciprocalMatrix(m.a, U);
    const { hkl, off, hn } = t.tab;
    const hl = st.hover >= 0 ? st.hover : st.sel.length ? st.sel[st.sel.length - 1] : -1;
    // grey lattice points only change with orientation/strain: cached, and written straight into pixels
    // (Si has ~10⁵ points in view; path rects would cost tens of ms per orientation change)
    ewDots.draw(ew, `${geomVer}|${w}|${h}`, (c) => {
      const dpr = ew.dpr;
      const W = Math.round(w * dpr);
      const H = Math.round(h * dpr);
      if (!dotImg || dotImg.width !== W || dotImg.height !== H) {
        dotImg = new ImageData(W, H);
        dotPix = new Uint32Array(dotImg.data.buffer);
      } else dotPix.fill(0);
      const yMax = Math.floor((oy - 1) * dpr);
      const sz = Math.max(2, Math.round(1.6 * dpr));
      const col = (71 << 24) | (215 << 16) | (190 << 8) | 170; // rgba(170,190,215,0.28), little-endian ABGR
      if (onDetMask.length < t.tab.n) onDetMask = new Uint8Array(t.tab.n);
      else onDetMask.fill(0);
      for (const sp of res.spots) onDetMask[sp.dir] = 1;
      for (let i = 0; i < t.tab.n; i++) {
        const h = hkl[i * 3];
        const k = hkl[i * 3 + 1];
        const l = hkl[i * 3 + 2];
        const Gz = T[6] * h + T[7] * k + T[8] * l;
        if (Gz > qzMax) continue; // every harmonic n·G lies further right, off the plot
        const Gx = T[0] * h + T[1] * k + T[2] * l;
        const Gy = T[3] * h + T[4] * k + T[5] * l;
        const qp = Math.sqrt(Gx * Gx + Gy * Gy);
        if (qp > qpMax) continue; // … or above it
        const onDet = onDetMask[i] ? byDir.get(i) : undefined;
        for (let j = off[i]; j < off[i + 1]; j++) {
          const n = hn[j];
          const qz = Gz * n;
          const qpn = qp * n;
          if (qz < qzMin || qpn > qpMax || qz > qzMax) continue;
          if (onDet && onDet.harm.some((hh) => hh.n === n)) continue; // drawn below, on top
          const x0 = Math.round(X(qz) * dpr - sz / 2);
          const y0 = Math.round(Y(qpn) * dpr - sz / 2);
          if (x0 < 0 || y0 < 0 || x0 + sz > W || y0 + sz > yMax) continue;
          for (let yy = 0; yy < sz; yy++) dotPix.fill(col, (y0 + yy) * W + x0, (y0 + yy) * W + x0 + sz);
        }
      }
      c.putImageData(dotImg, 0, 0);
    });
    // in-band points that hit the detector
    ewN = 0;
    for (const s of res.spots) {
      const b = bright(s.I);
      for (const hm of s.harm) {
        const gl = P.mulVec(T, [hm.h, hm.k, hm.l]);
        const px = X(gl[2]);
        const py = Y(Math.hypot(gl[0], gl[1]));
        let a = 0.45 + 0.55 * b;
        if (mono) {
          const fl = flash.get(s.dir);
          a = 0.15 + 0.85 * Math.min(1, P.monoResponse(hm.E, st.E0, P.monoWindow(hm.E, s.sinT)) + (fl && fl.n === hm.n ? fl.v : 0));
        }
        if (ewN < 600) {
          ewPts[ewN * 3] = px;
          ewPts[ewN * 3 + 1] = py;
          ewPts[ewN * 3 + 2] = s.dir;
          ewN++;
        }
        ctx.fillStyle = eCss(hm.E, a);
        ctx.strokeStyle = 'rgba(5,8,14,0.85)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, py, 2.2 + 2.2 * b, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fill();
      }
    }
    // construction for the highlighted spot
    if (hl >= 0) {
      const s = byDir.get(hl);
      if (s) {
        const hm = mono ? (monoLit(s)[1] ?? strongest(s)) : strongest(s);
        const gl = P.mulVec(T, [hm.h, hm.k, hm.l]);
        const qz = gl[2];
        const qp = Math.hypot(gl[0], gl[1]);
        const k = hm.E / P.HBARC;
        // harmonic line through the origin
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.setLineDash([2, 3]);
        const L = (2 * kMax + 1) / Math.hypot(qz, qp);
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(X(qz * L), Y(qp * L));
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = eCss(hm.E, 0.9);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(X(-k), oy, k * sc, Math.PI, 2 * Math.PI);
        ctx.stroke();
        ctx.restore();
        arrow(ctx, X(-k), oy, ox - 2, oy, TOKENS.xray, 2, 8);
        arrow(ctx, X(-k), oy, X(qz), Y(qp), eCss(hm.E), 2, 8);
        arrow(ctx, ox, oy, X(qz), Y(qp), '#fff', 1.6, 7);
        haloText(ctx, 'k_in', (X(-k) + ox) / 2, oy - 5, { size: 10.5, color: TOKENS.xray, align: 'center', weight: 600 });
        haloText(ctx, 'k_out', (X(-k) + X(qz)) / 2 - 6, (oy + Y(qp)) / 2 - 4, { size: 10.5, color: eCss(hm.E), align: 'right', weight: 600 });
        haloText(ctx, `G ${hklStr(hm.h, hm.k, hm.l)}`, (ox + X(qz)) / 2 + 6, (oy + Y(qp)) / 2, { size: 10.5, color: '#fff', weight: 600, mono: true });
        ctx.save();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(X(qz), Y(qp), 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();

  }

  function strongest(s: P.Spot): P.Harmonic {
    let b = s.harm[0];
    for (const h of s.harm) if (h.I > b.I) b = h;
    return b;
  }

  // ---------------------------------------------------------------- 3-D set-up drawing
  const cam = { eye: [-8.2, -1.4, -5.2] as P.Vec3, target: [0, 2.1, -0.4] as P.Vec3, r: [0, 0, 1] as P.Vec3, u: [0, 1, 0] as P.Vec3, f: [1, 0, 0] as P.Vec3, s: 1, cx: 0, cy: 0 };
  function camSetup(w: number, h: number): void {
    const f = P.unit([cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], cam.target[2] - cam.eye[2]]);
    const r = P.unit(P.cross(f, [0, 1, 0]));
    const u = P.cross(r, f);
    cam.f = f;
    cam.r = r;
    cam.u = u;
    cam.s = 1;
    cam.cx = 0;
    cam.cy = 0;
    const pts: P.Vec3[] = [
      [-2.05, 5.11, -2.05], [2.05, 5.11, -2.05], [2.05, 5.11, 2.05], [-2.05, 5.11, 2.05], [0, 0, -5.2], [0.8, -0.75, 0.6], [-0.8, -0.75, -0.6],
    ];
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      const [x, y] = project(p);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const padT = 30;
    const pad = 16;
    const s = Math.min((w - 2 * pad) / (x1 - x0), (h - padT - pad) / (y1 - y0));
    cam.s = s;
    cam.cx = pad + (w - 2 * pad - (x1 - x0) * s) / 2 - x0 * s;
    cam.cy = padT + (h - padT - pad - (y1 - y0) * s) / 2 - y0 * s;
  }
  function project(p: ArrayLike<number>): [number, number, number] {
    const dx = p[0] - cam.eye[0];
    const dy = p[1] - cam.eye[1];
    const dz = p[2] - cam.eye[2];
    const z = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
    const k = 9 / z;
    const x = (dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2]) * k;
    const y = -(dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2]) * k;
    return [cam.cx + x * cam.s, cam.cy + y * cam.s, z];
  }

  function poly(ctx: CanvasRenderingContext2D, pts: P.Vec3[]): void {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = project(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }

  function drawSetup(): void {
    const { ctx, w, h } = setup;
    ctx.clearRect(0, 0, w, h);
    if (w < 60 || h < 60) return;
    camSetup(w, h);
    const Ld = P.GEOM.L / 100;
    const hw = P.GEOM.half / 100;
    // detector (seen from below)
    poly(ctx, [[-hw, Ld, -hw], [hw, Ld, -hw], [hw, Ld, hw], [-hw, Ld, hw]]);
    ctx.fillStyle = 'rgba(24,36,54,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,180,220,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // detector housing thickness
    const thick = 0.18;
    poly(ctx, [[-hw, Ld, -hw], [-hw, Ld, hw], [-hw, Ld + thick, hw], [-hw, Ld + thick, -hw]]);
    ctx.fillStyle = 'rgba(40,52,72,0.95)';
    ctx.fill();
    poly(ctx, [[-hw, Ld, -hw], [hw, Ld, -hw], [hw, Ld + thick, -hw], [-hw, Ld + thick, -hw]]);
    ctx.fillStyle = 'rgba(34,46,64,0.95)';
    ctx.fill();
    // rays + spots
    const mono = st.mode === 'mono';
    for (const s of res.spots) {
      const b = bright(s.I);
      let a = 0.12 + 0.5 * b;
      let E = s.E;
      if (mono) {
        const [lit, hb] = monoLit(s);
        a = 0.6 * lit;
        if (hb) E = hb.E;
      }
      const end: P.Vec3 = [s.x / 100, Ld, s.z / 100];
      const [ex, ey] = project(end);
      const isH = s.dir === st.hover || st.sel.includes(s.dir);
      if (a > 0.02 || isH) {
        const [ox, oy] = project([0, 0, 0]);
        ctx.strokeStyle = eCss(E, isH ? 0.95 : a);
        ctx.lineWidth = isH ? 1.8 : 1;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      ctx.fillStyle = mono ? (a > 0.05 ? eCss(E, Math.min(1, a * 1.6)) : 'rgba(200,215,235,0.25)') : eCss(E, 0.5 + 0.5 * b);
      ctx.beginPath();
      ctx.arc(ex, ey, 1.3 + 2.2 * b, 0, Math.PI * 2);
      ctx.fill();
    }
    // incident pink beam
    const [bx0, by0] = project([0, 0, -5.2]);
    const [bx1, by1] = project([0, 0, 0]);
    ctx.save();
    ctx.lineCap = 'round';
    const beamPath = () => {
      ctx.moveTo(bx0, by0);
      ctx.lineTo(bx1, by1);
    };
    if (mono) {
      glowLine(ctx, beamPath, eCss(st.E0), 3, 10, 0.25);
    } else {
      const cols = [6, 9, 13, 18, 26];
      cols.forEach((E, i) => {
        ctx.strokeStyle = eCss(E, 0.85);
        ctx.lineWidth = 1.4;
        const off = (i - 2) * 1.1;
        ctx.beginPath();
        ctx.moveTo(bx0, by0 + off);
        ctx.lineTo(bx1, by1 + off * 0.3);
        ctx.stroke();
      });
      glowLine(ctx, beamPath, 'rgba(255,255,255,0.85)', 1, 6, 0.18);
    }
    ctx.restore();
    // KB mirrors
    poly(ctx, [[-0.35, 0.14, -3.6], [0.35, 0.14, -3.6], [0.35, 0.14, -2.8], [-0.35, 0.14, -2.8]]);
    ctx.fillStyle = 'rgba(160,175,200,0.55)';
    ctx.fill();
    poly(ctx, [[0.14, -0.3, -2.4], [0.14, 0.3, -2.4], [0.14, 0.3, -1.8], [0.14, -0.3, -1.8]]);
    ctx.fillStyle = 'rgba(160,175,200,0.4)';
    ctx.fill();
    // sample slab (surface spanned by X and Ĥ = (Y+Z)/√2)
    const Hh: P.Vec3 = [0, Math.SQRT1_2, Math.SQRT1_2];
    const n = P.SAMPLE_NORMAL;
    const a = 0.75;
    const tk = 0.28;
    const corner = (sx: number, sh: number, sn: number): P.Vec3 => [sx * a, sh * a * Hh[1] + sn * n[1], sh * a * Hh[2] + sn * n[2]];
    // front (upstream-facing) side and top
    poly(ctx, [corner(-1, -1, 0), corner(1, -1, 0), corner(1, -1, -tk), corner(-1, -1, -tk)]);
    ctx.fillStyle = '#3b4a60';
    ctx.fill();
    poly(ctx, [corner(-1, -1, 0), corner(-1, 1, 0), corner(-1, 1, -tk), corner(-1, -1, -tk)]);
    ctx.fillStyle = '#2c394b';
    ctx.fill();
    poly(ctx, [corner(-1, -1, 0), corner(1, -1, 0), corner(1, 1, 0), corner(-1, 1, 0)]);
    const [sx0, sy0] = project(corner(-1, -1, 0));
    const [sx1, sy1] = project(corner(1, 1, 0));
    const sg = ctx.createLinearGradient(sx0, sy0, sx1, sy1);
    sg.addColorStop(0, '#8fa3bd');
    sg.addColorStop(1, '#5c6f88');
    ctx.fillStyle = sg;
    ctx.fill();
    // beam footprint
    const [fx, fy] = project([0, 0, 0]);
    glowSpot(ctx, fx, fy, 3, mono ? eRgb(st.E0) : [255, 255, 255], 0.9);
    // Pt wire, along X, above the surface
    const wc: P.Vec3 = [0, 0.32 * n[1] + 0.22 * Hh[1], 0.32 * n[2] + 0.22 * Hh[2]];
    const [wx0, wy0] = project([-0.95, wc[1], wc[2]]);
    const [wx1, wy1] = project([0.95, wc[1], wc[2]]);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#d6d9e0';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(wx0, wy0);
    ctx.lineTo(wx1, wy1);
    ctx.stroke();
    ctx.restore();

    // labels. Placed in order; each takes the first candidate offset whose box is clear of the ones before
    const boxes: [number, number, number, number][] = [];
    const insetR = Math.max(30, Math.min(48, w * 0.1));
    boxes.push([0, 0, 2 * insetR + 28, 2 * insetR + 58]); // crystal inset + its caption (top left)
    const lab = (lines: string[], p: P.Vec3, cands: [number, number][], col: string = TOKENS.ink2, align: CanvasTextAlign = 'left') => {
      const [x, y] = project(p);
      const tw = Math.max(...lines.map((t) => textWidth(ctx, t, 10.5)));
      const th = 13 * lines.length;
      let pick = cands[0];
      for (const c of cands) {
        const bx = align === 'center' ? x + c[0] - tw / 2 : align === 'right' ? x + c[0] - tw : x + c[0];
        const b: [number, number, number, number] = [bx - 2, y + c[1] - 10, bx + tw + 2, y + c[1] - 10 + th];
        const inside = b[0] >= 2 && b[2] <= w - 2 && b[1] >= 2 && b[3] <= h - 2;
        if (inside && !boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]))) {
          pick = c;
          boxes.push(b);
          break;
        }
      }
      lines.forEach((t, i) => haloText(ctx, t, x + pick[0], y + pick[1] + 13 * i, { size: 10.5, color: col, align }));
    };
    // detector: beside its outboard/downstream corner (right-most on screen), clear of the ray fan
    const dc: P.Vec3[] = [[-hw, Ld, -hw], [hw, Ld, -hw], [hw, Ld, hw], [-hw, Ld, hw]];
    let dRight = dc[0];
    for (const q of dc) if (project(q)[0] > project(dRight)[0]) dRight = q;
    const dLines = ['detector', '511 mm above'];
    lab(dLines, dRight, [[6, 4], [-4, 24], [6, -26], [-70, 34]], TOKENS.ink2, 'left');
    lab(["sample surface · 45°"], corner(0, -1, -tk), [[0, 16], [0, 28]], TOKENS.ink2, 'center');
    lab([mono ? `single energy · ${st.E0.toFixed(1)} keV` : "pink beam · 5.3 to 30 keV"], [0, 0, -5.1], [[0, 23], [0, 36], [0, -10]], mono ? eCss(st.E0) : TOKENS.ink, 'left');
    lab(['KB mirrors'], [0, 0.14, -3.2], [[0, -9], [0, -21], [0, 22]], TOKENS.ink3, 'center');
    lab(['Pt wire'], [-0.95, wc[1], wc[2]], [[-5, -4], [-5, -16], [-5, -28], [-5, 12]], TOKENS.ink3, 'right');

    drawCrystalInset(ctx, w);
    drawTriad(ctx, h);
  }

  /** unit-cell glyph showing the grain orientation (same camera rotation as the scene) */
  function drawCrystalInset(ctx: CanvasRenderingContext2D, w: number): void {
    const R = Math.max(30, Math.min(48, w * 0.1));
    const cx = R + 16;
    const cy = R + 34;
    ctx.save();
    ctx.fillStyle = 'rgba(11,17,27,0.85)';
    ctx.strokeStyle = 'rgba(150,180,220,0.22)';
    ctx.beginPath();
    ctx.arc(cx, cy, R + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const proj = (v: ArrayLike<number>): [number, number, number] => {
      const p = P.mulVec(U, v);
      const x = p[0] * cam.r[0] + p[1] * cam.r[1] + p[2] * cam.r[2];
      const y = p[0] * cam.u[0] + p[1] * cam.u[1] + p[2] * cam.u[2];
      const z = p[0] * cam.f[0] + p[1] * cam.f[1] + p[2] * cam.f[2];
      return [cx + x * R * 0.62, cy - y * R * 0.62, z];
    };
    const c = (x: number, y: number, z: number) => proj([x - 0.5, y - 0.5, z - 0.5]);
    // edges
    ctx.strokeStyle = 'rgba(200,215,235,0.45)';
    ctx.lineWidth = 1;
    const E: [number, number, number, number, number, number][] = [];
    for (const a of [0, 1])
      for (const b of [0, 1]) {
        E.push([0, a, b, 1, a, b], [a, 0, b, a, 1, b], [a, b, 0, a, b, 1]);
      }
    for (const e of E) {
      const p = c(e[0], e[1], e[2]);
      const q = c(e[3], e[4], e[5]);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
    // atoms
    const atoms: [number, number, number][] = [];
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) atoms.push([x, y, z]);
    atoms.push([0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 0, 0.5], [0.5, 1, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5]);
    const isSi = st.mat === 'Si';
    const inner: [number, number, number][] = isSi ? [[0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75]] : [];
    if (isSi) {
      ctx.strokeStyle = 'rgba(196,181,253,0.55)';
      ctx.lineWidth = 1.2;
      for (const t of inner)
        for (const a of atoms) {
          const d = Math.hypot(a[0] - t[0], a[1] - t[1], a[2] - t[2]);
          if (Math.abs(d - Math.sqrt(3) / 4) < 1e-6) {
            const p = c(t[0], t[1], t[2]);
            const q = c(a[0], a[1], a[2]);
            ctx.beginPath();
            ctx.moveTo(p[0], p[1]);
            ctx.lineTo(q[0], q[1]);
            ctx.stroke();
          }
        }
    }
    const all = [...atoms.map((a) => ({ a, inner: false })), ...inner.map((a) => ({ a, inner: true }))]
      .map((o) => ({ ...o, p: c(o.a[0], o.a[1], o.a[2]) }))
      .sort((p, q) => q.p[2] - p.p[2]);
    for (const o of all) {
      const rr = (isSi ? 2.6 : 3.4) * (R / 44);
      const g = ctx.createRadialGradient(o.p[0] - rr * 0.3, o.p[1] - rr * 0.3, 0.5, o.p[0], o.p[1], rr);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, isSi ? (o.inner ? '#a78bfa' : '#8b5cf6') : '#7dd3c0');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.p[0], o.p[1], rr, 0, Math.PI * 2);
      ctx.fill();
    }
    // crystal axes
    const axc = ['#f87171', '#4ade80', '#60a5fa'];
    const names = ['a', 'b', 'c'];
    for (let i = 0; i < 3; i++) {
      const v: P.Vec3 = [0, 0, 0];
      v[i] = 0.95;
      const o = proj([0, 0, 0]);
      const p = proj(v);
      arrow(ctx, o[0], o[1], p[0], p[1], axc[i], 1.6, 5);
      haloText(ctx, names[i], p[0] + (p[0] - o[0]) * 0.18, p[1] + (p[1] - o[1]) * 0.18 + 3, { size: 10, color: axc[i], align: 'center', weight: 700 });
    }
    ctx.restore();
    haloText(ctx, st.mat === 'Ni' ? 'Ni unit cell' : 'Si unit cell', cx, cy + R + 19, { size: 9.5, color: TOKENS.ink3, align: 'center' });
  }

  function drawTriad(ctx: CanvasRenderingContext2D, h: number): void {
    if (setup.w < 400) return; // no room beside the beam at phone widths
    const ox = 46;
    const oy = h - 20;
    const ax: [P.Vec3, string, string][] = [
      [[1, 0, 0], 'X out', '#94a3b8'],
      [[0, 1, 0], 'Y up', '#94a3b8'],
      [[0, 0, 1], 'Z beam', TOKENS.xray],
    ];
    for (const [v, t, c] of ax) {
      const x = v[0] * cam.r[0] + v[1] * cam.r[1] + v[2] * cam.r[2];
      const y = v[0] * cam.u[0] + v[1] * cam.u[1] + v[2] * cam.u[2];
      const L = 16;
      if (Math.hypot(x, y) < 0.15) continue;
      arrow(ctx, ox, oy, ox + x * L, oy - y * L, c, 1.3, 5);
      haloText(ctx, t, ox + x * (L + 4), oy - y * (L + 4) + 3, { size: 9, color: c, align: x < -0.2 ? 'right' : 'left' });
    }
  }

  // ---------------------------------------------------------------- interaction
  function spotAt(px: number, py: number, r = 11): number {
    let best = -1;
    let bd = r * r;
    for (const s of res.spots) {
      const dx = mm2px(s.x) - px;
      const dy = mmz2py(s.z) - py;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = s.dir;
      }
    }
    return best;
  }

  function showTip(d: number, px: number, py: number): void {
    const s = byDir.get(d);
    if (!s) {
      tip.classList.remove('is-on');
      return;
    }
    const h0 = s.harm[0];
    const ov = s.harm.slice(1);
    let html = `<b class="mono">(${hklStr(h0.h, h0.k, h0.l)})</b> · ${h0.E.toFixed(2)} keV`;
    html += `<div class="dim">planes ${(P.HC / h0.E / (2 * s.sinT)).toFixed(4)} Å apart · 2θ ${(s.tth / DEG).toFixed(2)}°</div>`;
    if (ov.length) html += `<div class="dim">+${ov.length} higher-order reflection${ov.length > 1 ? 's' : ''}: ${ov.map((h) => h.E.toFixed(2)).join(', ')} keV</div>`;
    tip.innerHTML = html;
    tip.classList.add('is-on');
    const W = det.w;
    const tw = 190;
    let left = px + 14;
    if (left + tw > W - 4) left = px - tw - 14;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(28, py - 18)}px`;
  }

  let drag: null | { x: number; y: number; moved: boolean; spot: number; mode: 'rot' | 'energy'; turn: number; tilt: number } = null;
  det.canvas.addEventListener('pointerdown', (e) => {
    const r = det.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    det.canvas.setPointerCapture(e.pointerId);
    if (st.mode === 'mono' && y > dg.barY - 4 && y < dg.barY + dg.barH) {
      drag = { x, y, moved: true, spot: -1, mode: 'energy', turn: st.turn, tilt: st.tilt };
      setEnergyFromX(x);
      return;
    }
    drag = { x, y, moved: false, spot: spotAt(x, y), mode: 'rot', turn: st.turn, tilt: st.tilt };
  });
  det.canvas.addEventListener('pointermove', (e) => {
    const r = det.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (drag) {
      if (drag.mode === 'energy') {
        setEnergyFromX(x);
        return;
      }
      if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) > 4) drag.moved = true;
      if (drag.moved) {
        const mmPerPx = (2 * P.GEOM.half) / dg.S;
        const dxmm = (x - drag.x) * mmPerPx;
        const dzmm = -(y - drag.y) * mmPerPx;
        tip.classList.remove('is-on');
        setAngles(drag.turn - (dxmm / P.GEOM.L) / DEG, drag.tilt + (dzmm / (2 * P.GEOM.L)) / DEG, st.spin);
      }
      return;
    }
    const d = spotAt(x, y);
    if (d !== st.hover) {
      st.hover = d;
      dirty = true;
    }
    det.canvas.style.cursor = d >= 0 ? 'pointer' : st.mode === 'mono' && y > dg.barY - 4 && y < dg.barY + dg.barH ? 'ew-resize' : 'grab';
    if (d >= 0) showTip(d, x, y);
    else tip.classList.remove('is-on');
  });
  const endDrag = () => {
    if (drag && drag.mode === 'rot' && !drag.moved) {
      clickSpot(drag.spot);
    }
    drag = null;
  };
  det.canvas.addEventListener('pointerup', endDrag);
  det.canvas.addEventListener('pointercancel', () => (drag = null));
  det.canvas.addEventListener('pointerleave', () => {
    if (!drag) {
      st.hover = -1;
      tip.classList.remove('is-on');
      dirty = true;
    }
  });
  det.canvas.addEventListener('keydown', (e) => {
    const f = e.shiftKey ? 0.1 : 1;
    let used = true;
    if (e.key === 'ArrowLeft') setAngles(st.turn + 1 * f, st.tilt, st.spin);
    else if (e.key === 'ArrowRight') setAngles(st.turn - 1 * f, st.tilt, st.spin);
    else if (e.key === 'ArrowUp') setAngles(st.turn, st.tilt + 0.5 * f, st.spin);
    else if (e.key === 'ArrowDown') setAngles(st.turn, st.tilt - 0.5 * f, st.spin);
    else if (e.key === '[') setAngles(st.turn, st.tilt, st.spin - 2 * f);
    else if (e.key === ']') setAngles(st.turn, st.tilt, st.spin + 2 * f);
    else if (e.key === 'n' || e.key === 'N') {
      // keyboard equivalent of tapping spots: step through them, brightest first
      const order = [...res.spots].sort((a, b) => b.I - a.I).map((x) => x.dir);
      if (order.length) {
        const cur = st.sel.length ? order.indexOf(st.sel[st.sel.length - 1]) : -1;
        const next = order[(cur + (e.shiftKey ? -1 : 1) + order.length) % order.length];
        if (st.mode === 'pink') st.sel = [];
        clickSpot(next);
      }
    } else if (e.key === 'Escape' && st.sel.length) {
      // only consume Escape when it clears a selection, so it can still close a full-screen dialog
      st.sel = [];
      updateInfo();
      dirty = true;
    } else used = false;
    if (used) e.preventDefault();
  });

  function setEnergyFromX(x: number): void {
    const E = Math.max(P.BAND.min, Math.min(P.BAND.max, x2e(x)));
    st.E0 = E;
    eS.set(E);
    st.scanning = false;
    st.tune = null;
    scanBtn.textContent = '▶ Scan energy';
    dirty = true;
    updateInfo();
    onCaption();
  }

  function clickSpot(d: number): void {
    interacted();
    if (d < 0) {
      if (st.sel.length) {
        st.sel = [];
        updateInfo();
        dirty = true;
      }
      return;
    }
    if (st.mode === 'mono') {
      const s = byDir.get(d);
      if (s) {
        st.sel = [d];
        const target = strongest(s).E;
        st.scanning = false;
        scanBtn.textContent = '▶ Scan energy';
        st.tune = { from: st.E0, to: target, t: 0 };
      }
    } else {
      const i = st.sel.indexOf(d);
      if (i >= 0) st.sel.splice(i, 1);
      else {
        st.sel.push(d);
        if (st.sel.length > 2) st.sel.shift();
      }
    }
    updateInfo();
    dirty = true;
    // in mono mode the monochromator first tunes to the spot: announce the card once it has settled
    sr.say(() => info.textContent || '', st.mode === 'mono' ? 1500 : 500);
  }

  // Ewald: hover a coloured point to highlight its spot (cross-linked with the detector)
  ew.canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const r = ew.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best = -1;
    let bd = 81;
    for (let i = 0; i < ewN; i++) {
      const dx = ewPts[i * 3] - x;
      const dy = ewPts[i * 3 + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = ewPts[i * 3 + 2];
      }
    }
    ew.canvas.style.cursor = best >= 0 ? 'pointer' : 'grab';
    if (best !== st.hover) {
      st.hover = best;
      dirty = true;
    }
  });
  ew.canvas.addEventListener('pointerleave', () => {
    if (st.hover >= 0) {
      st.hover = -1;
      dirty = true;
    }
  });
  // setup canvas & Ewald: drag rotates too
  for (const c of [setup, ew]) {
    let d0: null | { x: number; y: number; turn: number; tilt: number } = null;
    c.canvas.style.cursor = 'grab';
    c.canvas.addEventListener('pointerdown', (e) => {
      c.canvas.setPointerCapture(e.pointerId);
      d0 = { x: e.clientX, y: e.clientY, turn: st.turn, tilt: st.tilt };
    });
    c.canvas.addEventListener('pointermove', (e) => {
      if (!d0) return;
      setAngles(d0.turn - (e.clientX - d0.x) * 0.25, d0.tilt - (e.clientY - d0.y) * 0.12, st.spin);
    });
    c.canvas.addEventListener('pointerup', () => (d0 = null));
    c.canvas.addEventListener('pointercancel', () => (d0 = null));
  }

  // ---------------------------------------------------------------- frame & layout
  // live: follows a change of the OS / browser setting (the attract loop stops or starts with it)
  let reducedMotion = prefersReducedMotion();
  onReducedMotionChange(station, (r) => (reducedMotion = r));
  let attractT = 0;
  let animAcc = 0;
  function frame(dt: number): void {
    if (!active) return;
    if (!st.interacted && !reducedMotion && st.mode === 'pink') {
      // attract loop: the grain rocks gently until the visitor touches anything
      attractT += dt;
      st.turn = DEFAULTS.turn + 4 * Math.sin((attractT * 2 * Math.PI) / 16);
      st.tilt = DEFAULTS.tilt + 1.5 * Math.sin((attractT * 2 * Math.PI) / 11);
      pending = true;
    }
    if (pending) dirty = true;
    if (st.mode === 'mono') {
      if (st.scanning) {
        const prev = st.E0;
        let next = prev + dt * 2.2; // keV per second
        if (next > P.BAND.max) next = P.BAND.min + (next - P.BAND.max);
        // flash every harmonic crossed in this step
        for (const s of res.spots)
          for (const h of s.harm) {
            const crossed = next >= prev ? h.E > prev && h.E <= next : h.E > prev || h.E <= next;
            if (crossed) flash.set(s.dir, { v: 1, n: h.n });
          }
        st.E0 = next;
        eS.set(next);
        dirty = true;
        onCaption();
        updateInfoThrottled(dt);
      }
      if (st.tune) {
        st.tune.t = Math.min(1, st.tune.t + dt / 0.8);
        const k = 0.5 - 0.5 * Math.cos(Math.PI * st.tune.t);
        st.E0 = st.tune.from + (st.tune.to - st.tune.from) * k;
        eS.set(st.E0);
        if (st.tune.t >= 1) {
          st.E0 = st.tune.to;
          st.tune = null;
          updateInfo();
          onCaption();
        }
        dirty = true;
      }
      if (flash.size) {
        const decay = Math.exp(-dt / 0.45);
        for (const [k, f] of flash) {
          f.v *= decay;
          if (f.v < 0.02) flash.delete(k);
        }
        dirty = true;
      }
    }
    if (!dirty) return;
    // purely animated updates (attract loop, energy scan, after-glow) are capped at ~30 fps;
    // direct manipulation (a drag in progress) always redraws immediately
    animAcc += dt;
    const animating = (!st.interacted && !reducedMotion) || st.scanning || !!st.tune || flash.size > 0;
    if (animating && !drag && animAcc < 0.031) return;
    animAcc = 0;
    if (pending) {
      pending = false;
      if (!st.interacted) {
        // attract loop: keep the sliders in step at the drawing rate only
        turnS.set(st.turn);
        tiltS.set(st.tilt);
      }
      recompute();
    }
    dirty = false;
    drawDetector();
    drawEwald();
    drawSetup();
  }
  let infoT = 0;
  function updateInfoThrottled(dt: number): void {
    infoT += dt;
    if (infoT > 0.2) {
      infoT = 0;
      updateInfo();
    }
  }

  /** narrow: stacked canvases with explicit pixel heights (grid rows ignore aspect-ratio of empty boxes) */
  function layout(nar: boolean, width: number): void {
    narrow = nar;
    if (narrow) {
      const w = Math.max(200, width);
      el.style.gridTemplateColumns = 'minmax(0,1fr)';
      el.style.gridTemplateRows = 'auto auto auto';
      for (const [wrap, ar] of [
        [detWrap, 0.9],
        [setupWrap, 1.75],
      ] as [HTMLElement, number][]) {
        wrap.style.gridArea = '';
        wrap.style.height = `${Math.round(w / ar)}px`;
      }
      // Ewald plot is width-limited: q range 2k_max+2.8 ≈ 33.6 Å⁻¹ wide × k_max+1.2 ≈ 16.4 Å⁻¹ tall, plus labels
      ewWrap.style.gridArea = '';
      ewWrap.style.height = `${Math.round(((w - 28) * 16.4) / 33.6 + (w < 470 ? 84 : 62))}px`;
      detWrap.style.order = '0';
      ewWrap.style.order = '1';
      setupWrap.style.order = '2';
    } else {
      el.style.gridTemplateColumns = 'minmax(0,1.05fr) minmax(0,1fr)';
      el.style.gridTemplateRows = 'minmax(0,1fr) minmax(0,1fr)';
      detWrap.style.gridArea = '1 / 1 / 3 / 2';
      setupWrap.style.gridArea = '1 / 2 / 2 / 3';
      ewWrap.style.gridArea = '2 / 2 / 3 / 3';
      for (const w of [detWrap, ewWrap, setupWrap]) {
        w.style.height = '';
        w.style.order = '';
      }
    }
    dirty = true;
  }

  function setActive(on: boolean): void {
    active = on;
    el.hidden = !on;
    ctl.hidden = !on;
    ctl.style.display = on ? 'contents' : 'none';
    if (on) dirty = true;
  }

  markPreset();
  recompute();
  return { el, ctl, layout, setActive, frame, caption, reset };
}

function niceMag(x: number): number {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  let best = 1;
  for (const s of steps) if (s <= x) best = s;
  return best;
}

function fmtE(v: number): string {
  if (Math.abs(v) < 1e-12) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  const m = v / Math.pow(10, e);
  return `${fix(m, 2)}×10^{${e}}`.replace('^{', '<sup>').replace('}', '</sup>');
}

/** signed with a true minus and an explicit plus: "+0.24", "−0.40" */
function signed(v: number, d: number): string {
  const t = Math.abs(v).toFixed(d);
  return Number(t) === 0 ? t : `${v > 0 ? '+' : '−'}${t}`;
}

/** tiny markdown: **bold**, `code`, _{sub}. The kit's md() is not exported for inline HTML reuse with sup */
function mdLite(t: string): string {
  return t
    .replace(/&(?!lt;|gt;|amp;)/g, '&amp;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/_\{(.+?)\}/g, '<sub>$1</sub>');
}
