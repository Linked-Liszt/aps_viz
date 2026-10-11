/**
 * Synthetic sample: a 100 nm-thin slice through W-doped Ni-rich NMC cathode particles (LiNi0.8Mn0.1Co0.1O2),
 * a battery material imaged in operating cells at ISN. Pure data, no DOM.
 *
 * - ~50 primary grains (~300 nm) per 2.5 µm secondary particle: Voronoi tessellation of relaxed random seeds.
 *   Grain-to-grain composition scatter ±2 % (Ni) / ±1 % (Mn, Co).
 * - Tungsten (~0.5 mol %, ≈1 wt % of the slice) segregated to grain boundaries (~12 nm FWHM layer, up to ~12 wt %) and the particle surface,
 *   as reported for W-doped Ni-rich cathodes; boundary coverage varies from boundary to boundary.
 * - In situ cell states (illustrative, accelerated): above ~4.2 V the H2→H3 c-axis collapse opens intergranular
 *   cracks, preferentially from the particle core and on poorly W-covered boundaries; cracks partly close on
 *   discharge but do not heal. Electrolyte attack leaches Mn (and some Ni) from exposed surfaces and crack walls.
 * Output: areal masses (g/cm²) of Ni, Mn, Co, W and total NMC per pixel on a 512² grid over 3.2 µm (6.25 nm px).
 */
import { SAMPLE, nmcMolarMass } from './physics';

export const FOV_NM = 3200;
export const TRUTH_N = 512;
export const PX_NM = FOV_NM / TRUTH_N;

export interface Grain {
  x: number;
  y: number;
  /** particle index */
  p: number;
  ni: number;
  mn: number;
  co: number;
  /** cosmetic brightness for the ground-truth picture, 0..1 */
  shade: number;
  /** surface relief of this grain (nm) */
  bump: number;
}

interface Particle {
  cx: number;
  cy: number;
  r0: number;
  harm: [number, number, number][];
}

export interface Geometry {
  n: number;
  grains: Grain[];
  particles: Particle[];
  /** particle index per pixel, −1 = outside every particle */
  part: Int8Array;
  g1: Int16Array;
  g2: Int16Array;
  /** distance to the nearest grain boundary (nm) */
  dgb: Float32Array;
  /** distance to the particle surface (nm, > 0 inside) */
  dsurf: Float32Array;
  /** r / R(θ) */
  rnorm: Float32Array;
  /** W coverage of the nearest boundary (static) */
  wcov: Float32Array;
  /** crack susceptibility of the nearest boundary at this radius (static) */
  sus: Float32Array;
  /** a representative position in nm on a W-rich triple junction near the main particle's centre */
  showcase: { x: number; y: number };
}

export interface CellState {
  volts: number;
  /** state of charge 0..1 (for the battery gauge) */
  soc: number;
  dir: 'rest' | 'charging' | 'discharging';
  cycle: number;
  /** max crack opening (nm) */
  crackW: number;
  /** crack susceptibility threshold (lower → more boundaries crack) */
  thr: number;
  /** leaching strength 0..1 */
  leach: number;
  /** what happens at this step: plain words first, then the mechanism and the telling number */
  text: string;
}

/** The in situ ladder: one snapshot per scan. Crack widths and leaching are illustrative (and accelerated). */
export const CELL_STATES: CellState[] = [
  { volts: 3.0, soc: 0, dir: 'rest', cycle: 1, crackW: 0, thr: 1, leach: 0, text: "Uncharged battery. Crystal grains are intact. Tungsten is concentrated at their boundaries." },
  { volts: 3.8, soc: 0.3, dir: 'charging', cycle: 1, crackW: 0, thr: 1, leach: 0, text: "During charging, lithium leaves the crystals. Lattice changes are still too small for visible cracks." },
  { volts: 4.1, soc: 0.6, dir: 'charging', cycle: 1, crackW: 7, thr: 0.62, leach: 0, text: "During charging, cracks about 7 nm wide open between grains near the particle centre." },
  { volts: 4.2, soc: 0.75, dir: 'charging', cycle: 1, crackW: 22, thr: 0.5, leach: 0.1, text: "Crystal height decreases during the H2→H3 phase transition. Cracks widen to ~20 nm at boundaries with little tungsten." },
  { volts: 4.3, soc: 0.85, dir: 'charging', cycle: 1, crackW: 36, thr: 0.4, leach: 0.2, text: "Cracks extend outward. In this illustrative model, electrolyte contacts the exposed surfaces and manganese and nickel begin dissolving into it." },
  { volts: 4.5, soc: 1, dir: 'charging', cycle: 1, crackW: 55, thr: 0.33, leach: 0.4, text: "At full charge, cracks are up to ~55 nm wide. Tungsten-rich boundaries remain less cracked in this model." },
  { volts: 3.9, soc: 0.5, dir: 'discharging', cycle: 1, crackW: 34, thr: 0.33, leach: 0.5, text: "During discharge, crystal dimensions increase. Cracks partly close, but regions depleted of dissolved elements remain." },
  { volts: 3.0, soc: 0, dir: 'rest', cycle: 1, crackW: 22, thr: 0.33, leach: 0.55, text: "After the first cycle, cracks ~20 nm wide remain. Manganese is depleted about 35 nm into each crack surface. Dissolution is accelerated in this model." },
  { volts: 4.3, soc: 0.85, dir: 'charging', cycle: 2, crackW: 52, thr: 0.27, leach: 0.7, text: "During the second charge, existing cracks reopen at a lower voltage and widen. New cracks also form. This repeated damage is fatigue." },
  { volts: 4.5, soc: 1, dir: 'charging', cycle: 2, crackW: 70, thr: 0.22, leach: 0.85, text: "Internal cracks isolate grains electrically. Isolated material no longer contributes to charging, reducing battery capacity." },
  { volts: 3.0, soc: 0, dir: 'rest', cycle: 2, crackW: 40, thr: 0.22, leach: 0.95, text: "After two cycles, cracks remain and manganese is depleted at exposed surfaces. Reset to repeat the model." },
];

// --------------------------------------------------------------------------------------------- hashing

function hash32(a: number): number {
  let h = a | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
/** symmetric pseudo-random number in [0,1) for a grain pair */
export function pairRand(a: number, b: number, salt: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return hash32(lo * 73856093 + hi * 19349663 + salt * 83492791) / 4294967296;
}

/** fraction of the boundary covered by the W-rich phase (0.15..1) */
export function wCoverage(a: number, b: number): number {
  return 0.15 + 0.85 * Math.pow(pairRand(a, b, 1), 0.7);
}

/** crack susceptibility of a boundary at normalised radius rn: core-first, poorly W-covered boundaries first */
export function crackSusceptibility(a: number, b: number, rn: number): number {
  return Math.pow(1 - wCoverage(a, b), 1.2) * (1 - 0.45 * rn * rn) * (0.65 + 0.35 * pairRand(a, b, 2));
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------------------------------------- geometry

function radiusAt(p: Particle, th: number): number {
  let f = 1;
  const h = p.harm;
  for (let i = 0; i < h.length; i++) f += h[i][1] * Math.cos(h[i][0] * th + h[i][2]);
  return p.r0 * f;
}

export function buildGeometry(seed = 7, n = TRUTH_N): Geometry {
  const rnd = mulberry(seed);
  const px = FOV_NM / n;
  const particles: Particle[] = [
    { cx: 1580, cy: 1640, r0: 1240, harm: [[2, 0.035, rnd() * 6.28], [3, 0.03, rnd() * 6.28], [5, 0.018, rnd() * 6.28]] },
    { cx: 3330, cy: 220, r0: 650, harm: [[2, 0.05, rnd() * 6.28], [3, 0.03, rnd() * 6.28]] },
    { cx: 150, cy: 3270, r0: 580, harm: [[2, 0.05, rnd() * 6.28], [3, 0.03, rnd() * 6.28]] },
  ];
  const meanGrain = 300; // nm (equivalent diameter)
  const grains: Grain[] = [];
  const pStart: number[] = [];
  for (let pi = 0; pi < particles.length; pi++) {
    const P = particles[pi];
    pStart.push(grains.length);
    const target = Math.round((P.r0 * P.r0) / ((meanGrain / 2) * (meanGrain / 2)));
    const pts: [number, number][] = [];
    // random sequential adsorption well below jamming (Lloyd relaxation evens the grains out afterwards)
    const minD2 = (meanGrain * 0.6) ** 2;
    let tries = 0;
    while (pts.length < target && tries < 5000) {
      tries++;
      const r = P.r0 * 0.97 * Math.sqrt(rnd());
      const th = rnd() * Math.PI * 2;
      const x = P.cx + r * Math.cos(th);
      const y = P.cy + r * Math.sin(th);
      let ok = true;
      for (let q = 0; q < pts.length && ok; q++) ok = (pts[q][0] - x) ** 2 + (pts[q][1] - y) ** 2 > minD2;
      if (ok) pts.push([x, y]);
    }
    // two Lloyd iterations on a coarse grid → rounder, more uniform grains
    for (let it = 0; it < 2; it++) {
      const sx = new Float64Array(pts.length);
      const sy = new Float64Array(pts.length);
      const cnt = new Float64Array(pts.length);
      const step = 25;
      for (let y = P.cy - P.r0; y <= P.cy + P.r0; y += step) {
        for (let x = P.cx - P.r0; x <= P.cx + P.r0; x += step) {
          const dx = x - P.cx;
          const dy = y - P.cy;
          if (Math.sqrt(dx * dx + dy * dy) > radiusAt(P, Math.atan2(dy, dx))) continue;
          let best = 0;
          let bd = Infinity;
          for (let k = 0; k < pts.length; k++) {
            const d = (pts[k][0] - x) ** 2 + (pts[k][1] - y) ** 2;
            if (d < bd) {
              bd = d;
              best = k;
            }
          }
          sx[best] += x;
          sy[best] += y;
          cnt[best]++;
        }
      }
      for (let k = 0; k < pts.length; k++) if (cnt[k] > 0) pts[k] = [sx[k] / cnt[k], sy[k] / cnt[k]];
    }
    for (const [x, y] of pts) {
      const dn = (rnd() - 0.5) * 0.04;
      const dm = (rnd() - 0.5) * 0.02;
      const dc = (rnd() - 0.5) * 0.02;
      let ni = 0.8 + dn;
      let mn = 0.1 + dm;
      let co = 0.1 + dc;
      const s = ni + mn + co;
      ni /= s;
      mn /= s;
      co /= s;
      grains.push({ x, y, p: pi, ni, mn, co, shade: rnd(), bump: (rnd() - 0.5) * 50 });
    }
  }
  pStart.push(grains.length);

  const N = n * n;
  const part = new Int8Array(N).fill(-1);
  const g1 = new Int16Array(N).fill(-1);
  const g2 = new Int16Array(N).fill(-1);
  const dgb = new Float32Array(N).fill(1e4);
  const dsurf = new Float32Array(N).fill(-1e4);
  const rnorm = new Float32Array(N).fill(2);
  const wcov = new Float32Array(N);
  const sus = new Float32Array(N);
  const NG = grains.length;
  const GX = Float64Array.from(grains, (g) => g.x);
  const GY = Float64Array.from(grains, (g) => g.y);
  const GB = Float64Array.from(grains, (g) => g.bump);
  // boundary properties per grain pair (symmetric)
  const pairW = new Float32Array(NG * NG);
  const pairS = new Float32Array(NG * NG);
  for (let a = 0; a < NG; a++) {
    for (let b = 0; b < NG; b++) {
      pairW[a * NG + b] = wCoverage(a, b);
      pairS[a * NG + b] = crackSusceptibility(a, b, 0);
    }
  }
  // R(θ) lookup per particle
  const NT = 2048;
  const rLut = particles.map((P) => Float64Array.from({ length: NT + 1 }, (_, t) => radiusAt(P, -Math.PI + (2 * Math.PI * t) / NT)));
  const rAt = (pi: number, th: number) => {
    const f = ((th + Math.PI) / (2 * Math.PI)) * NT;
    const t = Math.floor(f);
    const l = rLut[pi];
    return l[t] + (l[Math.min(NT, t + 1)] - l[t]) * (f - t);
  };
  // candidate seeds per 8×8-pixel block (exact for nearest-two: every seed that could win inside the block)
  const B = 8;
  const nb = Math.ceil(n / B);
  const halfDiag = (B * px * Math.SQRT2) / 2;
  const np = particles.length;
  const cand: number[] = [];
  for (let bj = 0; bj < nb; bj++) {
    for (let bi = 0; bi < nb; bi++) {
      const bx = (bi + 0.5) * B * px;
      const by = (bj + 0.5) * B * px;
      for (let pi = 0; pi < np; pi++) {
        const P = particles[pi];
        const dx0 = bx - P.cx;
        const dy0 = by - P.cy;
        if (Math.sqrt(dx0 * dx0 + dy0 * dy0) > P.r0 * 1.25 + 60 + halfDiag) continue;
        // second-nearest seed distance at the block centre bounds every pixel's second-nearest
        let d1 = Infinity;
        let d2 = Infinity;
        for (let g = pStart[pi]; g < pStart[pi + 1]; g++) {
          const d = Math.sqrt((GX[g] - bx) ** 2 + (GY[g] - by) ** 2);
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
        const lim = d2 + 2 * halfDiag;
        cand.length = 0;
        for (let g = pStart[pi]; g < pStart[pi + 1]; g++) if (Math.sqrt((GX[g] - bx) ** 2 + (GY[g] - by) ** 2) <= lim) cand.push(g);
        for (let j = bj * B; j < Math.min(n, bj * B + B); j++) {
          const y = (j + 0.5) * px;
          const dy = y - P.cy;
          for (let i = bi * B; i < Math.min(n, bi * B + B); i++) {
            const x = (i + 0.5) * px;
            const k = j * n + i;
            const dx = x - P.cx;
            const r = Math.sqrt(dx * dx + dy * dy);
            const th = Math.atan2(dy, dx);
            const R0 = rAt(pi, th);
            const margin = R0 + 40 - r;
            if (margin < -20) continue;
            // pixel already claimed by another particle with a larger margin?
            if (part[k] >= 0 && dsurf[k] > margin - 40) continue;
            let a = -1;
            let b = -1;
            let da = Infinity;
            let db = Infinity;
            for (let c = 0; c < cand.length; c++) {
              const g = cand[c];
              const ex = GX[g] - x;
              const ey = GY[g] - y;
              const d = ex * ex + ey * ey;
              if (d < da) {
                db = da;
                b = a;
                da = d;
                a = g;
              } else if (d < db) {
                db = d;
                b = g;
              }
            }
            if (b < 0) continue;
            const R = R0 + GB[a];
            part[k] = pi;
            g1[k] = a;
            g2[k] = b;
            const sx = GX[a] - GX[b];
            const sy = GY[a] - GY[b];
            dgb[k] = (db - da) / (2 * Math.sqrt(sx * sx + sy * sy));
            dsurf[k] = R - r;
            const rn = r / R;
            rnorm[k] = rn;
            wcov[k] = pairW[a * NG + b];
            const rc = Math.min(1, rn);
            sus[k] = pairS[a * NG + b] * (1 - 0.45 * rc * rc);
          }
        }
      }
    }
  }

  // representative position at a tungsten-rich triple boundary junction near the main particle's centre
  let showcase = { x: particles[0].cx, y: particles[0].cy };
  let best = -Infinity;
  for (let j = 0; j < n; j += 2) {
    for (let i = 0; i < n; i += 2) {
      const k = j * n + i;
      if (part[k] !== 0 || dgb[k] > 4 || rnorm[k] > 0.55) continue;
      const score = wcov[k] - rnorm[k] * 0.4;
      if (score > best) {
        best = score;
        showcase = { x: (i + 0.5) * px, y: (j + 0.5) * px };
      }
    }
  }
  return { n, grains, particles, part, g1, g2, dgb, dsurf, rnorm, wcov, sus, showcase };
}

// --------------------------------------------------------------------------------------------- composition

export interface Composition {
  /** areal masses, g/cm² */
  ni: Float32Array;
  mn: Float32Array;
  co: Float32Array;
  w: Float32Array;
  /** total NMC (for scatter) */
  mass: Float32Array;
  /** crack void fraction (for the picture) */
  crack: Float32Array;
  /** leaching depletion factor (0..1, for the picture) */
  leachF: Float32Array;
}

export function allocComposition(n = TRUTH_N): Composition {
  const N = n * n;
  return {
    ni: new Float32Array(N),
    mn: new Float32Array(N),
    co: new Float32Array(N),
    w: new Float32Array(N),
    mass: new Float32Array(N),
    crack: new Float32Array(N),
    leachF: new Float32Array(N),
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** bulk W-boundary peak (wt fraction), boundary half-width σ (nm), surface coating */
export const W_PARAMS = { bulk: 0.003, gb: 0.12, gbSigma: 5, surf: 0.06, surfSigma: 8 };

/** areal masses for a cell state (rows j0 … j1−1; the whole slice by default) */
export function composition(geom: Geometry, st: CellState, out: Composition = allocComposition(geom.n), j0 = 0, j1 = geom.n): Composition {
  const { n, grains, part, g1, dgb, dsurf, rnorm, wcov, sus } = geom;
  const px = FOV_NM / n;
  const rhoT = SAMPLE.density * SAMPLE.thicknessNm * 1e-7; // g/cm²
  const N = n * n;
  // per-grain mass fractions
  const fNi = Float64Array.from(grains, (G) => (G.ni * 58.693) / nmcMolarMass(G.ni, G.mn, G.co));
  const fMn = Float64Array.from(grains, (G) => (G.mn * 54.938) / nmcMolarMass(G.ni, G.mn, G.co));
  const fCo = Float64Array.from(grains, (G) => (G.co * 58.933) / nmcMolarMass(G.ni, G.mn, G.co));
  const thr = st.thr;
  const k2gb = 1 / (2 * W_PARAMS.gbSigma * W_PARAMS.gbSigma);
  const k2s = 1 / (2 * W_PARAMS.surfSigma * W_PARAMS.surfSigma);
  const kEnd = Math.min(N, j1 * n);
  for (let k = Math.max(0, j0 * n); k < kEnd; k++) {
    if (part[k] < 0) {
      out.ni[k] = out.mn[k] = out.co[k] = out.w[k] = out.mass[k] = out.crack[k] = out.leachF[k] = 0;
      continue;
    }
    const a = g1[k];
    const ds = dsurf[k];
    let cover = Math.max(0, Math.min(1, ds / px + 0.5));
    // crack opening on this boundary
    let open = 0;
    if (st.crackW > 0 && sus[k] > thr) open = st.crackW * smooth(thr, thr + 0.12, sus[k]) * Math.max(0, 1 - 0.55 * rnorm[k]);
    const dg = dgb[k];
    let crack = 0;
    let dWall = dg;
    if (open > 0.5) {
      crack = 1 - Math.max(0, Math.min(1, (dg - open / 2) / px + 0.5));
      dWall = Math.max(0, dg - open / 2);
    }
    cover *= 1 - crack;
    // leaching from exposed surfaces (outer surface + crack walls)
    const depth = open > 0.5 ? Math.min(Math.max(ds, 0), dWall) : Math.max(ds, 0);
    const lf = st.leach > 0 && depth < 250 ? st.leach * Math.exp(-depth / 35) : 0;
    // tungsten: boundary layer (kept on both crack walls) + surface coating
    const dsp = Math.max(ds, 0);
    const wf =
      W_PARAMS.bulk +
      (dWall < 30 ? W_PARAMS.gb * wcov[k] * Math.exp(-dWall * dWall * k2gb) : 0) +
      (dsp < 40 ? W_PARAMS.surf * Math.exp(-dsp * dsp * k2s) : 0);
    const m = rhoT * cover;
    const tm = m * (1 - wf);
    out.ni[k] = tm * fNi[a] * (1 - 0.3 * lf);
    out.mn[k] = tm * fMn[a] * (1 - 0.85 * lf);
    out.co[k] = tm * fCo[a] * (1 - 0.1 * lf);
    out.w[k] = m * wf;
    out.mass[k] = m;
    out.crack[k] = part[k] >= 0 && ds > 0 ? crack : 0;
    out.leachF[k] = lf;
  }
  return out;
}

/** bulk (pristine, grain-interior) areal masses for the station's reference numbers */
export function bulkAreal(): { ni: number; mn: number; co: number; w: number; mass: number } {
  const rhoT = SAMPLE.density * SAMPLE.thicknessNm * 1e-7;
  const M = nmcMolarMass(0.8, 0.1, 0.1);
  const wf = 0.010; // slice average incl. Boundaries (1.0 wt % for buildGeometry(7), pristine)
  const tm = rhoT * (1 - wf);
  return { ni: (tm * 0.8 * 58.693) / M, mn: (tm * 0.1 * 54.938) / M, co: (tm * 0.1 * 58.933) / M, w: rhoT * wf, mass: rhoT };
}

// --------------------------------------------------------------------------------------------- picture

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * "Ground truth" picture (what is really there). Colours: NMC body as a mix of the Ni/Mn/Co map colours,
 * gold = W-rich, black = cracks; grain-to-grain shading is cosmetic (marks the crystals).
 */
export function truthRGBA(geom: Geometry, comp: Composition, colors: { Ni: string; Mn: string; Co: string; W: string }, out: Uint8ClampedArray, j0 = 0, j1 = geom.n): void {
  const { n, part, g1, dgb, grains } = geom;
  const cNi = hex(colors.Ni);
  const cMn = hex(colors.Mn);
  const cCo = hex(colors.Co);
  const cW = hex(colors.W);
  const bg = [8, 12, 19];
  const bulk = bulkAreal();
  const kEnd = Math.min(n * n, j1 * n);
  for (let k = Math.max(0, j0 * n); k < kEnd; k++) {
    const o = k * 4;
    out[o + 3] = 255;
    if (part[k] < 0 || comp.mass[k] <= 0) {
      const cr = comp.crack[k];
      // electrolyte in cracks a touch bluer than the background
      out[o] = bg[0] + cr * 4;
      out[o + 1] = bg[1] + cr * 8;
      out[o + 2] = bg[2] + cr * 14;
      continue;
    }
    const cover = comp.mass[k] / bulk.mass;
    const fNi = comp.ni[k] / (bulk.ni * cover + 1e-12);
    const fMn = comp.mn[k] / (bulk.mn * cover + 1e-12);
    const fCo = comp.co[k] / (bulk.co * cover + 1e-12);
    let r = 0.5 * fNi * cNi[0] + 0.3 * fMn * fMn * cMn[0] + 0.2 * fCo * cCo[0];
    let g = 0.5 * fNi * cNi[1] + 0.3 * fMn * fMn * cMn[1] + 0.2 * fCo * cCo[1];
    let b = 0.5 * fNi * cNi[2] + 0.3 * fMn * fMn * cMn[2] + 0.2 * fCo * cCo[2];
    const G = grains[g1[k]];
    const d = dgb[k];
    const sh = (0.62 + 0.3 * G.shade) * (1 - 0.35 * Math.exp(-(d * d) / 50));
    r *= sh;
    g *= sh;
    b *= sh;
    const wf = comp.w[k] / comp.mass[k];
    const t = Math.min(1, Math.pow(Math.max(0, wf - 0.004) / 0.05, 0.8)) * 0.92;
    r += (cW[0] - r) * t;
    g += (cW[1] - g) * t;
    b += (cW[2] - b) * t;
    const c = Math.min(1, cover);
    out[o] = bg[0] + (r - bg[0]) * c;
    out[o + 1] = bg[1] + (g - bg[1]) * c;
    out[o + 2] = bg[2] + (b - bg[2]) * c;
  }
}
