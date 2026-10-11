/**
 * Bragg coherent diffraction imaging (BCDI): physics core of the "Strain inside a nanocrystal" station.
 * Pure functions + one preallocated simulator class, no DOM, so everything here is covered by tests/bcdi.test.ts.
 *
 * ── MODEL ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * A 2D cross-section (in the scattering plane) of a faceted gold nanocrystal on a substrate. Real BCDI records the
 * full 3D intensity around one Bragg peak by rocking the crystal through ~±0.3° and stacking 2D detector frames;
 * here the same physics is shown in 2D: the object is a section (≈ projection along [1̄10]) and the pattern is the
 * matching central slice of reciprocal space through G. Going from 3D to 2D changes nothing essential about Friedel
 * symmetry, oversampling, phase retrieval or G·u contrast (the q^{-4} Porod fall-off becomes q^{-3}).
 *
 *   Complex Bragg object     O(r) = ρ(r)·exp(iφ(r)),   φ(r) = G·u(r)                     [Robinson & Harder 2009]
 *   Far-field amplitude      A(Δq) = Σ_r O(r)·exp(+iΔq·r),   Δq = Q − G                (kinematic, Fraunhofer)
 *                            (sign chosen so a uniform expansion ε moves the peak to Δq = −εG, i.e. lower |Q|;
 *                             conventions φ = ±G·u differ between papers.)
 *   Intensity                I(Δq) = |A(Δq)|², scaled to N_ph photons, then Poisson counts.
 *   Friedel's law            ρ real ⇒ A(−q) = A*(q) ⇒ I(q) = I(−q) for ANY shape: only a non-uniform φ breaks the
 *                            centro-symmetry. A uniform strain (φ linear in r) just translates the peak.
 *                            Parity: I(q) = I(−q) whenever O is real OR even, O(−r) = O(r) (each up to a shift and a
 *                            global phase), so on a centro-symmetric ρ an EVEN φ (e.g. bending) keeps the symmetry;
 *                            asymmetry needs the odd part of φ beyond a linear ramp, or an even φ on a shape with no
 *                            inversion centre (tested).
 *   Peak position            circular mean of I = mean phase gradient ⟨∇φ⟩ (lag-1 autocorrelation of O); we remove
 *                            it before measuring asymmetry  A_F = Σ|I(q) − I(−q)| / Σ(I(q) + I(−q)).
 *   Sampling                 real-space pixel Δx = 5 nm, N = 128 ⇒ Δq = 2π/(NΔx) = 9.8×10⁻³ nm⁻¹ per detector pixel.
 *                            Crystal ≈ 300 nm (60 px) inside 640 nm ⇒ linear oversampling σ ≈ 2.1 (Nyquist for |F|²,
 *                            Miao, Sayre & Chapman, JOSA A 15, 1662, 1998). Equivalent to 55 µm pixels at 0.26 m, 9 keV.
 *   Resolution estimate      q_max = largest radius whose azimuthal mean ≥ 1 photon/pixel; half-period π/q_max.
 *                            (A crude, honest proxy for the PRTF cut-off.)
 *
 * ── MATERIAL & GEOMETRY (Au, fcc) ─────────────────────────────────────────────────────────────────────────────
 *   a = 4.0782 Å; ν ≈ 0.42 (isotropic average. Au is elastically anisotropic, Zener ratio ≈ 2.9, ignored here);
 *   thermal expansion α = 14.2×10⁻⁶ K⁻¹. E = 9 keV (λ = 1.3776 Å), typical of 34-ID-C BCDI.
 *   Image plane ⟂ [1̄10]: in-plane axes x ∥ [110], y ∥ [001], rotated so [111] points "up" (the usual specular-ish
 *   111 geometry of dewetted Au crystals). Wulff facets {111} and {100} with γ100/γ111 ≈ 1.15, truncated by the
 *   substrate on the (1̄1̄1̄) side (Winterbottom shape). So the crystal is NOT centrosymmetric (twin is distinct).
 *   Reflections in this zone: 111 (2θ = 34.0°), 1̄1̄1 (34.0°), 002 (39.5°), 220 (57.1°).
 *
 * ── DISPLACEMENT FIELDS u(r) ──────────────────────────────────────────────────────────────────────────────────
 *   expanded     u = ε(r − r_c)                                     uniform strain, φ linear → peak shift −εG.
 *   bent         u_x = −κxy,  u_y = ½κ(x² + νy²)                   pure bending of a plate (Timoshenko & Goodier).
 *   core–shell   misfitting circular inclusion (eigenstrain ε_m, radius c·R) in a traction-free disc of radius R,
 *                plane stress, equal elastic constants (Lamé / "shrink-fit" solution):
 *                  core  u = A r,  shell u = B r + C/r,  B = (1−ν)ε_mc²/2,  C = (1+ν)ε_mc²R²/2,  A = B + (1+ν)ε_m/2.
 *                Mapped onto the faceted shape through the polygon gauge function (illustrative, not FEM).
 *   dislocation  straight edge dislocation, line ∥ [1̄10] (viewing direction), b = ½[110] (|b| = 2.884 Å, a Lomer-type
 *                pure edge), isotropic infinite-medium solution (Hirth & Lothe, Theory of Dislocations, eq. 3-45):
 *                  u_x' = b/2π [θ + x'y' / (2(1−ν)r²)],
 *                  u_y' = −b/2π [(1−2ν)/(4(1−ν)) ln r² + (x'² − y'²)/(4(1−ν)r²)].
 *                φ winds by 2π·(G·b)/2π = 2πn around the core: n = 1 (111), −1 (1̄1̄1), 0 (002), 2 (220).
 *                n = 0 is the G·b = 0 case: no vortex, but here G_002 ∥ b × l, so u_y' (dilatation + quadrupole,
 *                ~±1 rad) still gives contrast: G·b = 0 is not sufficient for edge-dislocation invisibility.
 *                (Free-surface image fields are neglected.)
 *   surface      phenomenological: each free facet f relaxes along its normal, u = u₀ Σ_f n_f exp(−d_f/λ), λ = 15 nm;
 *                the substrate interface is pinned. Mimics adsorbate-induced surface stress concentrating at edges
 *                and corners (cf. Watari et al., Nat. Mater. 10, 862 (2011), measured at APS 34-ID-C). Illustrative.
 *
 * ── SOURCE: APS vs APS-U ──────────────────────────────────────────────────────────────────────────────────────
 *   Coherent fraction  f_coh = Π_{x,y} (λ/4π) / (Σ Σ'),  Σ² = σ_e² + σ_r²,  Σ'² = σ_e'² + σ_r'²,
 *   σ_r = √(2λL)/4π, σ_r' = √(λ/2L) (L = 2.1 m undulator).  Electron beam (rms) from APS-U FDR (2019) Table 1.1:
 *   APS 2019: 280/11.6 µm/µrad (x), 10/3.4 (y), 100 mA;  APS-U brightness mode: 14.7/2.8, 3.2/1.3, 200 mA.
 *   At 9 keV: f_coh ≈ 0.05% → 5.8%; with 2× the current ⇒ coherent flux gain ≈ 240 (estimate; same undulator flux per
 *   mA assumed). The FDR quotes ×520 at 20 keV, where the old lattice is further from the diffraction limit.
 *   Photon numbers per 2D frame are illustrative for a ~300 nm Au crystal (only their ratio is source physics).
 *
 * ── ATOMIC (34-ID-F) ─────────────────────────────────────────────────────────────────────────────────────────
 *   APS-U FDR (2019) §4-9 and PDR (2017) §6-2: dedicated coherent-diffraction branch of the canted 34-ID front end
 *   (revolver undulator 2.1 cm/2.5 cm period), windowless, coherence-defining slits at 26.8 m and 50.3 m, Si(111)
 *   small-offset horizontal DCM (5.3–30 keV) with pink-beam bypass for Laue indexing, two bendable "zoom" KB pairs
 *   (~54 m and ~69 m, 15 m apart; FDR Table 4.63 lists 52.0/68.1 m in a different frame) giving 50 nm–2 µm spots
 *   with ~50 mm working distance, ~3×10¹² ph/s/0.1%BW into 50 nm at 8.7 keV (FDR Table 4.65). Goals: sub-10 nm
 *   operando BCDI in tens of seconds and atomic resolution on ~50 nm volumes in ~1000 s (PDR); ≤ 1 nm design
 *   resolution (FDR) vs 10–30 nm typical pre-upgrade. Status (Oct 2026): scientific commissioning.
 */
import { poisson, rng } from '../../../lib/fft';
import { FFT2 } from './fft2';

// ───────────────────────────────────────────────────────────────── constants

/** grid size (pixels per side) */
export const N = 128;
/** real-space pixel (nm) */
export const DX = 5;
/** reciprocal-space pixel (nm⁻¹) */
export const DQ = (2 * Math.PI) / (N * DX);
export const E_KEV = 9;
/** wavelength (Å) */
export const LAMBDA = 12.398419843 / E_KEV;
/** Au lattice parameter (Å) */
export const A_AU = 4.0782;
export const NU = 0.42;
/** Au linear thermal expansion (1/K) */
export const ALPHA_AU = 14.2e-6;
/** |b| for b = ½⟨110⟩ (Å) */
export const B_LEN = A_AU / Math.SQRT2;
/** detector pixel (m) and the distance that makes the sim pixel DX: N·DX = λD/p */
export const DET_PIXEL = 55e-6;
export const DET_DIST = (N * DX * 1e-9 * DET_PIXEL) / (LAMBDA * 1e-10);
/** crystal width (nm) */
export const CRYSTAL_WIDTH = 300;
/** linear oversampling ratio along the crystal's widest direction */
export const OVERSAMPLING = (N * DX) / CRYSTAL_WIDTH;
/** magnification used to DRAW lattice planes (spacing and displacements along G drawn ×M) */
export const PLANE_MAG = 85;

// ───────────────────────────────────────────────────────────────── crystallography

/** rotation that puts [111] vertical in the (1̄10) zone */
const ROT = Math.PI / 2 - Math.atan(1 / Math.SQRT2);

/** In-plane (physical, y up) coordinates of the direction [hkl] lying in the [1̄10] zone (needs h = k for exactness). */
export function zoneVec(h: number, k: number, l: number): [number, number] {
  const x = (h + k) / Math.SQRT2;
  const y = l;
  const c = Math.cos(ROT);
  const s = Math.sin(ROT);
  return [x * c - y * s, x * s + y * c];
}

/** Burgers vector b = ½[110] in the image plane (Å). */
export function burgers(): [number, number] {
  const v = zoneVec(1, 1, 0);
  return [(v[0] * A_AU) / 2, (v[1] * A_AU) / 2];
}

export type ReflId = '111' | '-1-11' | '002' | '220';

export interface Reflection {
  id: ReflId;
  hkl: [number, number, number];
  /** label with combining overlines (U+0305), e.g. 1̅1̅1 */
  label: string;
  /** G (Å⁻¹) in the physical frame (x right, y up) */
  g: [number, number];
  gMag: number;
  /** d-spacing (Å) */
  d: number;
  /** scattering angle 2θ at E_KEV (degrees) */
  twoTheta: number;
  /** G·b / 2π for the model dislocation (integer) */
  n: number;
}

function makeRefl(id: ReflId, h: number, k: number, l: number, label: string): Reflection {
  const v = zoneVec(h, k, l);
  const s = (2 * Math.PI) / A_AU;
  const g: [number, number] = [v[0] * s, v[1] * s];
  const gMag = Math.hypot(g[0], g[1]);
  const d = (2 * Math.PI) / gMag;
  const b = burgers();
  return {
    id,
    hkl: [h, k, l],
    label,
    g,
    gMag,
    d,
    twoTheta: (2 * Math.asin(LAMBDA / (2 * d)) * 180) / Math.PI,
    n: Math.round((g[0] * b[0] + g[1] * b[1]) / (2 * Math.PI)),
  };
}

/** U+0305 COMBINING OVERLINE (Inter has no U+0304 macron); a hair space keeps adjacent bars apart. */
const BAR = '\u0305';
const HS = '\u200a';
export const REFLECTIONS: Record<ReflId, Reflection> = {
  '111': makeRefl('111', 1, 1, 1, '111'),
  '-1-11': makeRefl('-1-11', -1, -1, 1, `1${BAR}${HS}1${BAR}${HS}1`),
  '002': makeRefl('002', 0, 0, 2, '002'),
  '220': makeRefl('220', 2, 2, 0, '220'),
};

// ───────────────────────────────────────────────────────────────── crystal shape

export interface Facet {
  /** outward unit normal (physical frame) */
  nx: number;
  ny: number;
  /** distance of the facet plane from the grid origin (nm): inside ⇔ n·r ≤ h */
  h: number;
  label: string;
  substrate: boolean;
}

export interface Shape {
  facets: Facet[];
  /** polygon vertices (nm), counter-clockwise */
  verts: [number, number][];
  /** Wulff point (nm): origin of the facet construction, centre for the gauge function */
  wulff: [number, number];
  centroid: [number, number];
  area: number;
}

const FACETS: { hkl: [number, number, number]; label: string; h: number; substrate?: boolean }[] = [
  { hkl: [1, 1, 1], label: '(111)', h: 1 },
  { hkl: [0, 0, 1], label: '(001)', h: 1.15 },
  { hkl: [-1, -1, 1], label: `(1${BAR}${HS}1${BAR}${HS}1)`, h: 1 },
  { hkl: [-1, -1, -1], label: `(1${BAR}${HS}1${BAR}${HS}1${BAR})`, h: 0.62, substrate: true },
  { hkl: [0, 0, -1], label: `(00${HS}1${BAR})`, h: 1.15 },
  { hkl: [1, 1, -1], label: `(11${HS}1${BAR})`, h: 1 },
];

/** Winterbottom-like cross-section of a supported Au crystal, CRYSTAL_WIDTH wide, bounding box centred on the origin. */
export function buildShape(): Shape {
  const raw = FACETS.map((f) => {
    const v = zoneVec(...f.hkl);
    const m = Math.hypot(v[0], v[1]);
    return { nx: v[0] / m, ny: v[1] / m, h: f.h, label: f.label, substrate: !!f.substrate };
  }).sort((a, b) => Math.atan2(a.ny, a.nx) - Math.atan2(b.ny, b.nx));
  const vs: [number, number][] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    const b = raw[(i + 1) % raw.length];
    const det = a.nx * b.ny - a.ny * b.nx;
    vs.push([(a.h * b.ny - a.ny * b.h) / det, (a.nx * b.h - a.h * b.nx) / det]);
  }
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of vs) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const s = CRYSTAL_WIDTH / (x1 - x0);
  const tx = (-(x0 + x1) / 2) * s;
  const ty = (-(y0 + y1) / 2) * s;
  const facets: Facet[] = raw.map((f) => ({ ...f, h: f.h * s + f.nx * tx + f.ny * ty }));
  const verts = vs.map(([x, y]) => [x * s + tx, y * s + ty] as [number, number]);
  let A = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < verts.length; i++) {
    const [ax, ay] = verts[i];
    const [bx, by] = verts[(i + 1) % verts.length];
    const c = ax * by - bx * ay;
    A += c;
    cx += (ax + bx) * c;
    cy += (ay + by) * c;
  }
  A /= 2;
  return { facets, verts, wulff: [tx, ty], centroid: [cx / (6 * A), cy / (6 * A)], area: A };
}

/** Signed distance-like function: ≤ 0 inside (exact distance to the boundary for interior points of a convex polygon). */
export function sdist(shape: Shape, x: number, y: number): number {
  let m = -Infinity;
  for (const f of shape.facets) {
    const d = f.nx * x + f.ny * y - f.h;
    if (d > m) m = d;
  }
  return m;
}

/** Polygon gauge (Minkowski functional) about the Wulff point: 0 at the centre, 1 on the surface. */
export function gauge(shape: Shape, x: number, y: number): number {
  const [wx, wy] = shape.wulff;
  let m = 0;
  for (const f of shape.facets) {
    const g = (f.nx * (x - wx) + f.ny * (y - wy)) / (f.h - f.nx * wx - f.ny * wy);
    if (g > m) m = g;
  }
  return m;
}

/** Points where a line through p along unit vector d leaves the polygon: returns [tMin, tMax]. */
export function chord(shape: Shape, p: [number, number], d: [number, number]): [number, number] {
  let lo = -Infinity;
  let hi = Infinity;
  for (const f of shape.facets) {
    const nd = f.nx * d[0] + f.ny * d[1];
    const slack = f.h - f.nx * p[0] - f.ny * p[1];
    if (Math.abs(nd) < 1e-12) continue;
    const t = slack / nd;
    if (nd > 0) hi = Math.min(hi, t);
    else lo = Math.max(lo, t);
  }
  return [lo, hi];
}

// ───────────────────────────────────────────────────────────────── displacement fields

export type Mode = 'perfect' | 'expanded' | 'bent' | 'coreshell' | 'dislocation' | 'surface';

export interface FieldParams {
  mode: Mode;
  /** uniform strain (expanded) */
  eps: number;
  /** curvature 1/R (nm⁻¹) (bent) */
  kappa: number;
  /** core eigenstrain ε_m (core–shell) */
  misfit: number;
  /** core size as a fraction of the crystal (gauge units) */
  coreFrac: number;
  /** dislocation core position (nm) */
  disl: [number, number];
  /** surface relaxation amplitude (Å) */
  u0: number;
  /** surface relaxation decay length (nm) */
  decay: number;
}

export const DEFAULT_FIELD: FieldParams = {
  mode: 'dislocation',
  eps: 0.0015,
  kappa: 1e-5,
  misfit: 0.002,
  coreFrac: 0.55,
  disl: [0, 0],
  u0: 0.4,
  decay: 15,
};

export type PhaseFn = (x: number, y: number) => number;

/** Reference length for the logarithmic term of the dislocation field (only adds a constant phase). */
const R_LOG = 100;
/** Core regularisation radius (nm). Well below one pixel. */
const R_CORE = 0.5;

/** φ(r) = G·u(r) in radians for positions in nm (physical frame). */
export function phaseFn(shape: Shape, p: FieldParams, R: Reflection): PhaseFn {
  // G in nm⁻¹ for displacements expressed in nm
  const gx = R.g[0] * 10;
  const gy = R.g[1] * 10;
  switch (p.mode) {
    case 'perfect':
      return () => 0;
    case 'expanded': {
      const [cx, cy] = shape.centroid;
      const e = p.eps;
      return (x, y) => e * (gx * (x - cx) + gy * (y - cy));
    }
    case 'bent': {
      const [cx, cy] = shape.centroid;
      const k = p.kappa;
      return (x, y) => {
        const X = x - cx;
        const Y = y - cy;
        return gx * (-k * X * Y) + gy * (0.5 * k * (X * X + NU * Y * Y));
      };
    }
    case 'coreshell': {
      const c = p.coreFrac;
      const e = p.misfit;
      const B = ((1 - NU) * e * c * c) / 2;
      const Cp = ((1 + NU) * e * c * c) / 2;
      const A = B + ((1 + NU) * e) / 2;
      const [wx, wy] = shape.wulff;
      return (x, y) => {
        const s = gauge(shape, x, y);
        const f = s < c ? A : B + Cp / (s * s);
        return f * (gx * (x - wx) + gy * (y - wy));
      };
    }
    case 'dislocation': {
      const b = burgers();
      const bm = Math.hypot(b[0], b[1]);
      const bx = b[0] / bm;
      const by = b[1] / bm;
      // G components (Å⁻¹) along b̂ and ŷ' = b̂ rotated +90°
      const gb = R.g[0] * bx + R.g[1] * by;
      const gn = -R.g[0] * by + R.g[1] * bx;
      const k = bm / (2 * Math.PI);
      const c1 = 1 / (2 * (1 - NU));
      const c2 = (1 - 2 * NU) / (4 * (1 - NU));
      const c3 = 1 / (4 * (1 - NU));
      const [px, py] = p.disl;
      const rc2 = R_CORE * R_CORE;
      const r02 = R_LOG * R_LOG;
      return (x, y) => {
        const dx = x - px;
        const dy = y - py;
        const xp = dx * bx + dy * by;
        const yp = -dx * by + dy * bx;
        const r2 = xp * xp + yp * yp + rc2;
        const ux = k * (Math.atan2(yp, xp) + (c1 * xp * yp) / r2);
        const uy = -k * (c2 * Math.log(r2 / r02) + (c3 * (xp * xp - yp * yp)) / r2);
        return ux * gb + uy * gn;
      };
    }
    case 'surface': {
      const fs = shape.facets.filter((f) => !f.substrate).map((f) => ({ nx: f.nx, ny: f.ny, h: f.h, gn: R.g[0] * f.nx + R.g[1] * f.ny }));
      const u0 = p.u0;
      const lam = p.decay;
      return (x, y) => {
        let s = 0;
        for (let i = 0; i < fs.length; i++) {
          const f = fs[i];
          s += f.gn * Math.exp(-(f.h - f.nx * x - f.ny * y) / lam);
        }
        return u0 * s;
      };
    }
  }
}

/** Plane-stress Lamé solution for a misfitting core (radius a) in a free disc (radius b): radial displacement. */
export function coreShellRadial(r: number, a: number, b: number, misfit: number, nu = NU): number {
  const B = ((1 - nu) * misfit * a * a) / (2 * b * b);
  const C = ((1 + nu) * misfit * a * a) / 2;
  const A = B + ((1 + nu) * misfit) / 2;
  return r < a ? A * r : B * r + C / r;
}

/** Position of the dislocation core for a slider value p ∈ [−1, 1]: along b through the centroid. */
export function dislocationAt(shape: Shape, p: number): [number, number] {
  const b = burgers();
  const m = Math.hypot(b[0], b[1]);
  const d: [number, number] = [b[0] / m, b[1] / m];
  const c = shape.centroid;
  const [lo, hi] = chord(shape, c, d);
  const t = p >= 0 ? p * hi * 0.72 : -p * lo * 0.72;
  return [c[0] + d[0] * t, c[1] + d[1] * t];
}

// ───────────────────────────────────────────────────────────────── source

export interface Source {
  id: 'aps' | 'apsu';
  /** rms electron beam size (µm) / divergence (µrad) */
  sx: number;
  sxp: number;
  sy: number;
  syp: number;
  /** stored current (mA) */
  current: number;
}

/** APS-U FDR (2019) Table 1.1. */
export const SOURCES: Record<'aps' | 'apsu', Source> = {
  aps: { id: 'aps', sx: 280, sxp: 11.6, sy: 10.0, syp: 3.4, current: 100 },
  apsu: { id: 'apsu', sx: 14.7, sxp: 2.8, sy: 3.2, syp: 1.3, current: 200 },
};

/** Fraction of the undulator flux in one transverse coherent mode (Gaussian approximation). */
export function coherentFraction(s: Source, eKeV = E_KEV, undulatorM = 2.1): number {
  const lam = (12.398419843 / eKeV) * 1e-10; // m
  const sr = Math.sqrt(2 * lam * undulatorM) / (4 * Math.PI); // m
  const srp = Math.sqrt(lam / (2 * undulatorM)); // rad
  const em = lam / (4 * Math.PI);
  const plane = (sz: number, szp: number) => em / (Math.hypot(sz * 1e-6, sr) * Math.hypot(szp * 1e-6, srp));
  return plane(s.sx, s.sxp) * plane(s.sy, s.syp);
}

/** Coherent-flux gain of APS-U over the 2019 APS at E (same undulator flux per mA assumed). */
export function coherentGain(eKeV = E_KEV): number {
  const a = SOURCES.aps;
  const u = SOURCES.apsu;
  return (coherentFraction(u, eKeV) * u.current) / (coherentFraction(a, eKeV) * a.current);
}

export const COHERENT_GAIN = coherentGain();
/** Illustrative photons per second into the 2D Bragg-peak slice for a ~300 nm Au crystal. */
export const PHOTON_RATE: Record<'aps' | 'apsu', number> = { aps: 1.0e5, apsu: 1.0e5 * COHERENT_GAIN };

// ───────────────────────────────────────────────────────────────── analysis helpers (pure)

/** Friedel asymmetry Σ|I(q) − I(−q)| / Σ(I(q) + I(−q)) of an fftshifted n×n intensity (centre at n/2). */
export function friedelAsymmetry(I: ArrayLike<number>, n: number): number {
  let num = 0;
  let den = 0;
  for (let y = 0; y < n; y++) {
    const ym = (n - y) % n;
    for (let x = 0; x < n; x++) {
      const a = I[y * n + x];
      const b = I[ym * n + ((n - x) % n)];
      num += Math.abs(a - b);
      den += a + b;
    }
  }
  return den > 0 ? num / den : 0;
}

/** Azimuthal mean of an fftshifted n×n map in integer-radius bins 0..n/2. */
export function radialMean(I: ArrayLike<number>, n: number, out: Float64Array, cnt: Float64Array): void {
  out.fill(0);
  cnt.fill(0);
  const h = n / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.round(Math.hypot(x - h, y - h));
      if (r > h) continue;
      out[r] += I[y * n + x];
      cnt[r]++;
    }
  }
  for (let r = 0; r <= h; r++) out[r] = cnt[r] ? out[r] / cnt[r] : 0;
}

/** Largest radius (pixels) whose azimuthal mean is ≥ `floor` photons. 0 if none. */
export function signalRadius(radial: ArrayLike<number>, floor = 1): number {
  let k = 0;
  for (let r = 1; r < radial.length; r++) if (radial[r] >= floor) k = r;
  return k;
}

/** Half-period resolution (nm) for a signal radius in detector pixels. */
export function halfPeriod(k: number): number {
  return k > 0 ? Math.PI / (k * DQ) : Infinity;
}

// ───────────────────────────────────────────────────────────────── simulator

export interface SimStats {
  /** expected photons in the frame */
  total: number;
  /** counted photons (Poisson) */
  counted: number;
  /** brightest pixel (expected photons) */
  peak: number;
  /** intensity centre of mass relative to the unstrained Bragg position (pixels; +x right, +y up) */
  comX: number;
  comY: number;
  /** Friedel asymmetry after re-centring the peak */
  asym: number;
  /** signal radius (pixels) and half-period resolution (nm) */
  kmax: number;
  resolution: number;
}

/**
 * Forward model with preallocated buffers. Pixel (i, j) ↔ x = (i − N/2)·DX, y = (N/2 − j)·DX (y up), so that images
 * of both the object and the fftshifted diffraction pattern display with physical "up" at the top of the screen.
 */
export class BraggSim {
  readonly n = N;
  readonly shape: Shape;
  readonly fft: FFT2;
  /** pixel class: 0 outside, 1 fully inside, 2 partially covered (supersampled) */
  readonly cls = new Uint8Array(N * N);
  readonly rho = new Float64Array(N * N);
  readonly support = new Uint8Array(N * N);
  readonly objRe = new Float64Array(N * N);
  readonly objIm = new Float64Array(N * N);
  /** fftshifted maps */
  readonly intensity = new Float64Array(N * N);
  readonly centred = new Float64Array(N * N);
  readonly counts = new Float64Array(N * N);
  /** normalised asymmetry (I(q) − I(−q))/(I(q) + I(−q)) of the re-centred pattern, NaN where < 0.5 photon */
  readonly asymMap = new Float64Array(N * N);
  /** unshifted √counts, ready for phase retrieval */
  readonly modulus = new Float64Array(N * N);
  readonly radial = new Float64Array(N / 2 + 1);
  readonly stats: SimStats = { total: 0, counted: 0, peak: 0, comX: 0, comY: 0, asym: 0, kmax: 0, resolution: Infinity };
  /** truth bookkeeping for alignment */
  truthNorm = 0;
  truthCom: [number, number] = [N / 2, N / 2];
  /** indices of non-zero truth pixels */
  readonly truthIdx: Int32Array;
  private readonly wr = new Float64Array(N * N);
  private readonly wi = new Float64Array(N * N);
  private readonly rcnt = new Float64Array(N / 2 + 1);
  /** integer radius (0..N/2, or 255 = outside) of each fftshifted pixel, for the azimuthal mean */
  private readonly rbin = new Uint8Array(N * N);
  /** separable re-centring phase factors e^{−iπ_x(i−N/2)}, e^{−iπ_y(j−N/2)} */
  private readonly cx = new Float64Array(N);
  private readonly sx = new Float64Array(N);
  private readonly cy = new Float64Array(N);
  private readonly sy = new Float64Array(N);
  private photons = 0;

  constructor() {
    this.shape = buildShape();
    this.fft = new FFT2(N);
    const sub = [-0.375, -0.125, 0.125, 0.375];
    const idx: number[] = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const x = (i - N / 2) * DX;
        const y = (N / 2 - j) * DX;
        const sd = sdist(this.shape, x, y);
        if (sd < -0.75 * DX) {
          this.cls[k] = 1;
          this.rho[k] = 1;
        } else if (sd > 0.75 * DX) {
          this.cls[k] = 0;
        } else {
          let c = 0;
          for (const oy of sub) for (const ox of sub) if (sdist(this.shape, x + ox * DX, y + oy * DX) <= 0) c++;
          this.rho[k] = c / 16;
          this.cls[k] = c > 0 ? 2 : 0;
        }
        this.support[k] = this.rho[k] > 0 ? 1 : 0;
        if (this.support[k]) idx.push(k);
      }
    }
    this.truthIdx = Int32Array.from(idx);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const r = Math.round(Math.hypot(x - N / 2, y - N / 2));
        this.rbin[y * N + x] = r > N / 2 ? 255 : r;
      }
  }

  /** Pixel centre → physical coordinates (nm). */
  static px(i: number): number {
    return (i - N / 2) * DX;
  }
  static py(j: number): number {
    return (N / 2 - j) * DX;
  }

  /**
   * Build O = ρ·e^{iφ}: ρ = anti-aliased area coverage, φ sampled at pixel centres (so a linear φ stays exactly
   * linear and an unstrained crystal stays exactly real). Pixels within 2.5 px of `singular` (a dislocation core)
   * average e^{iφ} over 4×4 sub-samples, giving the vortex core its physical amplitude dip.
   */
  setField(phi: PhaseFn, singular: [number, number] | null = null): void {
    const sub = [-0.375, -0.125, 0.125, 0.375];
    const r2s = (2.5 * DX) ** 2;
    let nrm = 0;
    let cx = 0;
    let cy = 0;
    for (let j = 0; j < N; j++) {
      const y = (N / 2 - j) * DX;
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const c = this.cls[k];
        if (c === 0) {
          this.objRe[k] = 0;
          this.objIm[k] = 0;
          continue;
        }
        const x = (i - N / 2) * DX;
        const near = singular !== null && (x - singular[0]) ** 2 + (y - singular[1]) ** 2 < r2s;
        if (!near) {
          // phase sampled at the pixel centre, amplitude = area coverage: keeps O exactly ρ·e^{iφ} with real ρ
          const p = phi(x, y);
          const a = this.rho[k];
          this.objRe[k] = a * Math.cos(p);
          this.objIm[k] = a * Math.sin(p);
        } else {
          let sr = 0;
          let si = 0;
          for (const oy of sub) {
            for (const ox of sub) {
              const xs = x + ox * DX;
              const ys = y + oy * DX;
              if (c === 2 && sdist(this.shape, xs, ys) > 0) continue;
              const p = phi(xs, ys);
              sr += Math.cos(p);
              si += Math.sin(p);
            }
          }
          this.objRe[k] = sr / 16;
          this.objIm[k] = si / 16;
        }
        const w = this.objRe[k] ** 2 + this.objIm[k] ** 2;
        nrm += w;
        cx += w * i;
        cy += w * j;
      }
    }
    this.truthNorm = Math.sqrt(nrm);
    this.truthCom = [cx / nrm, cy / nrm];
  }

  /**
   * Far-field intensity and a Poisson-noisy measurement with `photons` expected counts. `analyse = false` skips the
   * Friedel/resolution analysis (re-centred pattern, asymmetry map, azimuthal mean). About half the cost. So a slider
   * drag stays smooth; call `analyse()` when the input settles. Stats.asym / kmax / resolution keep their old values
   * until then.
   */
  measure(photons: number, seed: number, analyse = true): void {
    const n = N;
    const n2 = n * n;
    const h = n / 2;
    const { wr, wi } = this;
    // 1) raw pattern
    wr.set(this.objRe);
    wi.set(this.objIm);
    this.fft.run(wr, wi, 1);
    let sum = 0;
    for (let k = 0; k < n2; k++) sum += wr[k] * wr[k] + wi[k] * wi[k];
    const scale = sum > 0 ? photons / sum : 0;
    this.photons = photons;
    let peak = 0;
    let mx = 0;
    let my = 0;
    for (let j = 0; j < n; j++) {
      const js = (j + h) % n;
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const is = (i + h) % n;
        const v = (wr[k] * wr[k] + wi[k] * wi[k]) * scale;
        this.intensity[js * n + is] = v;
        if (v > peak) peak = v;
        mx += v * (is - h);
        my += v * (h - js);
      }
    }
    // 2) Poisson counts
    const r = rng(seed);
    let counted = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const ks = y * n + x;
        const c = poisson(this.intensity[ks], r);
        this.counts[ks] = c;
        counted += c;
        // unshifted index for phasing
        this.modulus[((y + h) % n) * n + ((x + h) % n)] = Math.sqrt(c);
      }
    }
    const st = this.stats;
    st.total = photons;
    st.counted = counted;
    st.peak = peak;
    st.comX = photons > 0 ? mx / photons : 0;
    st.comY = photons > 0 ? my / photons : 0;
    if (analyse) this.analyse();
  }

  /**
   * Friedel asymmetry of the noise-free pattern after removing the mean phase ramp (lag-1 autocorrelation phase of O,
   * so the circular mean of I sits at q = 0), its per-pixel map, and the ⟨I⟩ ≥ 1 photon resolution estimate.
   */
  analyse(): void {
    const n = N;
    const h = n / 2;
    const { wr, wi, cx, sx, cy, sy } = this;
    let axr = 0;
    let axi = 0;
    let ayr = 0;
    let ayi = 0;
    const { objRe: or, objIm: oi } = this;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (i + 1 < n) {
          const k2 = k + 1;
          axr += or[k2] * or[k] + oi[k2] * oi[k];
          axi += oi[k2] * or[k] - or[k2] * oi[k];
        }
        if (j + 1 < n) {
          const k2 = k + n;
          ayr += or[k2] * or[k] + oi[k2] * oi[k];
          ayi += oi[k2] * or[k] - or[k2] * oi[k];
        }
      }
    }
    const px = Math.atan2(axi, axr);
    const py = Math.atan2(ayi, ayr);
    // e^{−i(px(i−h) + py(j−h))} = e^{−ipx(i−h)}·e^{−ipy(j−h)}: 2n trig calls instead of n²
    for (let i = 0; i < n; i++) {
      cx[i] = Math.cos(-px * (i - h));
      sx[i] = Math.sin(-px * (i - h));
      cy[i] = Math.cos(-py * (i - h));
      sy[i] = Math.sin(-py * (i - h));
    }
    for (let j = 0; j < n; j++) {
      const cj = cy[j];
      const sj = sy[j];
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const c = cx[i] * cj - sx[i] * sj;
        const s = sx[i] * cj + cx[i] * sj;
        wr[k] = or[k] * c - oi[k] * s;
        wi[k] = or[k] * s + oi[k] * c;
      }
    }
    this.fft.run(wr, wi, 1);
    let sum = 0;
    for (let k = 0; k < n * n; k++) sum += wr[k] * wr[k] + wi[k] * wi[k];
    // |FFT|² is unchanged in total by the ramp (Parseval), so the same photon scale applies
    const scale = sum > 0 ? this.photons / sum : 0;
    for (let j = 0; j < n; j++) {
      const js = ((j + h) % n) * n;
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        this.centred[js + ((i + h) % n)] = (wr[k] * wr[k] + wi[k] * wi[k]) * scale;
      }
    }
    const asym = friedelAsymmetry(this.centred, n);
    for (let y = 0; y < n; y++) {
      const ym = (n - y) % n;
      for (let x = 0; x < n; x++) {
        const a = this.centred[y * n + x];
        const b = this.centred[ym * n + ((n - x) % n)];
        this.asymMap[y * n + x] = a + b >= 1 ? (a - b) / (a + b) : NaN;
      }
    }
    // azimuthal mean through the precomputed radius bins (same bins as radialMean())
    const out = this.radial;
    const cnt = this.rcnt;
    out.fill(0);
    cnt.fill(0);
    const rb = this.rbin;
    for (let k = 0; k < n * n; k++) {
      const b = rb[k];
      if (b === 255) continue;
      out[b] += this.centred[k];
      cnt[b]++;
    }
    for (let q = 0; q <= h; q++) out[q] = cnt[q] ? out[q] / cnt[q] : 0;
    const kmax = signalRadius(out, 1);
    const st = this.stats;
    st.asym = asym;
    st.kmax = kmax;
    st.resolution = halfPeriod(kmax);
  }
}
