/**
 * Pure physics for the "laue" station: polychromatic (pink-beam) Laue micro-diffraction and
 * differential-aperture X-ray microscopy (DAXM, "wire scan") as done at APS 34-ID-E / 3DMN.
 * No DOM here. Exports are covered by tests/laue.test.ts.
 *
 * ─── Conventions (34-ID-E beam-line frame, LaueGo/lauelab style) ───────────────────────────────
 *   X horizontal, outboard;  Y vertical, up;  Z along the incident beam (downstream).
 *   Incident beam k̂_in = +Z, linearly polarised along X (planar undulator, horizontal orbit).
 *   Sample surface inclined 45° to the beam; outward surface normal n̂ = (0, 1, −1)/√2 (up & upstream).
 *   Main area detector: plane Y = L directly above the sample, L = 510.9 mm, 409.6 mm square
 *   (PerkinElmer XRD1621, 2048² × 200 µm). Pre-upgrade 34-ID-E geometry (Gürsoy et al. 2022;
 *   lauelab geometry files). Idealised: centred, untilted (real geometry files carry small offsets
 *   and tilts calibrated on a Si reference). 2θ = 90° at the detector centre.
 *   Reciprocal vectors use the physics convention |G| = 2π/d, k = 2π/λ, E = ħc·k.
 *
 * ─── Laue diffraction ─────────────────────────────────────────────────────────────────────────
 *   Laue condition    k_out = k_in + G_hkl,  |k_out| = |k_in| = k
 *                  ⇒  k = −|G|² / (2 k̂_in·G) = |G| / (2 sinθ),   sinθ = −k̂_in·Ĝ      (Bragg: λ = 2d sinθ)
 *   Spot direction    k̂_out = k̂_in + 2 sinθ Ĝ. Depends on Ĝ only ⇒ harmonics n·(hkl) land on the same
 *                     pixel, and a pure dilatation (hydrostatic strain) does not move any spot.
 *   Energy            E[keV] = ħc·k = 12.3984/λ[Å];  harmonic n has E_n = n·E_1.
 *   Lattice           A = (I+ε)·U·a  (columns = real-space cell vectors in the lab frame),
 *                     G_hkl = 2π (A⁻¹)ᵀ (h,k,l)ᵀ = (I+ε)⁻ᵀ · U · (2π/a) (h,k,l)ᵀ.
 *   Extinction        fcc: h,k,l unmixed (|F|² = 16 f²);  diamond: all odd (32 f²) or all even with
 *                     h+k+l = 4n (64 f²), otherwise 0 (e.g. Si 200, 222 forbidden. Kinematically).
 *   Form factor       Cromer–Mann 4-Gaussian fit, International Tables Vol. C Table 6.1.1.4 (no f′, f″).
 *   Debye–Waller      exp(−2B s²), s = sinθ/λ = |G|/4π; B(Ni) ≈ 0.37 Å², B(Si) ≈ 0.46 Å² at room
 *                     temperature (Peng et al., Acta Cryst. A52, 456 (1996)). Approximate.
 *   Spot intensity    kinematic integrated Laue intensity of a thick (semi-infinite) single crystal:
 *                       I ∝ i(λ) · λ⁴ · |F|² e^{−2Bs²} · P / (2 sin²θ) · A(E),   P = 1 − (ε̂·k̂_out)², ε̂ = X̂
 *                     with i(λ) the incident spectrum PER UNIT WAVELENGTH (Lorentz factor 1/(2 sin²θ) for a
 *                     stationary crystal in a white beam: Cruickshank, Helliwell & Moffat, Acta Cryst. A43,
 *                     656 (1987)). Our S(E) is per unit ENERGY: i(λ) = S(E)·|dE/dλ| = S(E)·hc/λ², hence
 *                       I ∝ S(E) · λ² · |F|² e^{−2Bs²} · P / sin²θ · A(E).            Absorption-limited diffracting
 *                     volume A = 1 / [μ(E)·(1 + sinα_in / sinα_out)], α = angles to the surface
 *                     (sinα_in = 1/√2, sinα_out = k̂_out·n̂); μ(E) from NIST XCOM (Hubbell & Seltzer) table
 *                     values, log–log interpolated, incl. The Ni K edge at 8.333 keV. Ignored: air and
 *                     detector efficiency, finite sample thickness, and extinction. A perfect Si wafer
 *                     really diffracts dynamically (integrated intensity ∝ |F|, not |F|²). Brightness is
 *                     therefore indicative only. S(E) is an ILLUSTRATIVE smooth pink-beam spectrum.
 *   Monochromatic     Si(111) double-crystal mono, ΔE/E ≈ 1.3×10⁻⁴; a reflection is seen over
 *                     ΔE/E ≈ Δθ·cotθ (⊕ mono bandwidth) where Δθ ≈ 1 mrad stands for focusing convergence
 *                     plus mosaic spread. ILLUSTRATIVE value.
 *   Band              5.3–30 keV (APS-U FDR beam-delivery spec for 3DMN; pre-upgrade 34-ID-E 7–30 keV).
 *                     Upper limit: Pt-coated KB mirrors at 3 mrad, θc ≈ 84 mrad·keV / E ⇒ ≈ 28 keV.
 *
 * ─── Strain ───────────────────────────────────────────────────────────────────────────────────
 *   Spot positions fix Ĝ for every reflection ⇒ the orientation U and the DEVIATORIC strain (5 of 6
 *   components). Chung & Ice, J. Appl. Phys. 86, 5249 (1999). The 6th (dilatation, tr ε) needs one
 *   absolute |G|, i.e. one energy from a monochromatic energy scan. Ice et al., J. Appl. Cryst. (2005).
 *   Here "stretch" = exactly volume-conserving uniaxial strain along X: diag(e, (1+e)^{−½}−1, (1+e)^{−½}−1);
 *   "swell" = hydrostatic diag(e, e, e).
 *
 * ─── DAXM (Larson, Yang, Ice, Budai & Tischler, Nature 415, 887 (2002)) ─────────────────────────
 *   2-D side view in the Y–Z plane. Beam: y = 0, enters the surface y = z at the origin; a point at
 *   distance s along the beam lies s/√2 below the surface. Watched pixel at (y, z) = (L, L·cot2θ).
 *   Pt wire (radius R) moves parallel to the surface along Ĥ = (Ŷ+Ẑ)/√2 at height h (wire axis) above it:
 *     W(u) = u·Ĥ + h·n̂  ⇒  (y, z) = ((u+h)/√2, (u−h)/√2).
 *   Triangulation: the line from the pixel tangent to the wire's leading (trailing) edge meets the beam at
 *   s_lead (s_trail). Parallel-ray limit: s = (u−h)/√2 − (u+h)/√2·cot2θ ± R/sin2θ,
 *     ds/du = (1 − cot2θ)/√2  (0.71 µm of beam per µm of wire travel at 2θ = 90°).
 *   We use the exact finite-distance tangents. Wire transmission exp(−μ_Pt·chord) gives soft edges.
 *   Pixel signal I(u) = ∫ f(s) e^{−μ(s + t_out(s))} T_wire(s,u) ds ; reconstruction assigns the step
 *   difference I(u_i) − I(u_{i+1}) to the depth interval swept by the leading edge.
 *   μ(Ni, 20 keV) = 1/34.9 µm⁻¹ (table below) and μ(Pt, 20 keV) ≈ 1/6.2 µm⁻¹ (μ/ρ ≈ 75 cm²/g, ρ = 21.45;
 *   approximate). Pixel blur (200 µm pixel at 511 mm), wire-edge roughness and the finite beam size are
 *   not convolved into the simulated scan.
 *
 * ─── Instrument numbers ───────────────────────────────────────────────────────────────────────
 *   From the 3DMN research dossier: APS-U FDR (2019) / PDR (2017) for the 5.3–30 keV band, Si(111) HDCM
 *   and design spot sizes; Gürsoy et al., J. Appl. Cryst. 55 (2022) and lauelab geometry files for the
 *   PE XRD1621 at 510.9 mm and the Pt wire (50 µm historically, ~100 µm in 2022–23); Larson et al. 2002.
 */

export type Vec3 = [number, number, number];
/** 3×3 matrix, row-major. */
export type Mat3 = Float64Array;

export const HC = 12.398419843; // keV·Å
export const HBARC = HC / (2 * Math.PI); // keV·Å :  E = HBARC·k

/** Instrument constants (pre-upgrade 34-ID-E reference geometry, kept by 3DMN). */
export const GEOM = {
  /** sample → detector plane distance (mm) */
  L: 510.9,
  /** half width of the 409.6 mm square detector (mm) */
  half: 204.8,
  /** pixels across */
  npix: 2048,
  /** pixel pitch (mm) */
  pitch: 0.2,
};

/** 3DMN pink-beam band (keV), APS-U FDR. */
export const BAND = { min: 5.3, max: 30 };
/** Si(111) intrinsic relative bandwidth. */
export const SI111_DE_E = 1.3e-4;
/** illustrative angular acceptance (rad) of a reflection in mono mode: focusing convergence + mosaic */
export const MONO_DTHETA = 1.0e-3;

export const SAMPLE_NORMAL: Vec3 = [0, Math.SQRT1_2, -Math.SQRT1_2];

// ------------------------------------------------------------------ small linear algebra

export function mat3(...v: number[]): Mat3 {
  const m = new Float64Array(9);
  for (let i = 0; i < 9; i++) m[i] = v[i] ?? 0;
  return m;
}
export function ident(): Mat3 {
  return mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);
}
export function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
}
export function mulVec(a: Mat3, v: ArrayLike<number>): Vec3 {
  return [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]];
}
export function transpose(a: Mat3): Mat3 {
  return mat3(a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]);
}
export function det3(a: Mat3): number {
  return a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
}
export function inv3(a: Mat3): Mat3 {
  const d = det3(a);
  const o = mat3(
    a[4] * a[8] - a[5] * a[7], a[2] * a[7] - a[1] * a[8], a[1] * a[5] - a[2] * a[4],
    a[5] * a[6] - a[3] * a[8], a[0] * a[8] - a[2] * a[6], a[2] * a[3] - a[0] * a[5],
    a[3] * a[7] - a[4] * a[6], a[1] * a[6] - a[0] * a[7], a[0] * a[4] - a[1] * a[3],
  );
  for (let i = 0; i < 9; i++) o[i] /= d;
  return o;
}
export function norm(v: ArrayLike<number>): number {
  return Math.hypot(v[0], v[1], v[2]);
}
export function unit(v: ArrayLike<number>): Vec3 {
  const n = norm(v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}
export function cross(a: ArrayLike<number>, b: ArrayLike<number>): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
/** Rotation matrix about a unit axis by angle (rad), right-handed (Rodrigues). */
export function rotAxis(axis: ArrayLike<number>, ang: number): Mat3 {
  const [x, y, z] = unit(axis);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const t = 1 - c;
  return mat3(t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c);
}

// ------------------------------------------------------------------ materials

export type MaterialId = 'Ni' | 'Si';
export interface Material {
  id: MaterialId;
  label: string;
  structure: 'fcc' | 'diamond';
  /** cubic lattice parameter (Å) */
  a: number;
  /** isotropic Debye–Waller B (Å²) */
  B: number;
  /** Cromer–Mann a1 b1 a2 b2 a3 b3 a4 b4 c */
  cm: readonly number[];
  /** density (g/cm³) */
  rho: number;
  /** mass attenuation μ/ρ (cm²/g) at [E keV, value] nodes; an edge is two nodes at the same E */
  mu: readonly (readonly [number, number])[];
}

export const MATERIALS: Record<MaterialId, Material> = {
  Ni: {
    id: 'Ni',
    label: 'Ni (fcc)',
    structure: 'fcc',
    a: 3.524,
    B: 0.37,
    cm: [12.8376, 3.8785, 7.292, 0.2565, 4.4438, 12.1763, 2.38, 66.3421, 1.0341],
    rho: 8.908,
    // NIST XCOM / Hubbell–Seltzer (10–30 keV and the K-edge jump); below the edge a ∝E^−2.75 extrapolation
    mu: [[5, 172], [6, 104], [8, 47.4], [8.333, 42.3], [8.333, 329], [10, 209], [15, 70.8], [20, 32.2], [30, 10.3]],
  },
  Si: {
    id: 'Si',
    label: 'Si (diamond)',
    structure: 'diamond',
    a: 5.43102,
    B: 0.46,
    cm: [6.2915, 2.4386, 3.0353, 32.3337, 1.9891, 0.6785, 1.541, 81.6937, 1.1407],
    rho: 2.329,
    mu: [[5, 245.1], [6, 147], [8, 64.68], [10, 33.89], [15, 10.34], [20, 4.464], [30, 1.436]],
  },
};

/** Linear attenuation coefficient μ (1/µm) at energy E (keV): log–log interpolation of the μ/ρ table. */
export function muLinear(m: Material, E: number): number {
  const t = m.mu;
  let i = 0;
  while (i < t.length - 2 && E >= t[i + 1][0]) i++;
  const [e0, v0] = t[i];
  const [e1, v1] = t[i + 1];
  const mr = e1 === e0 ? v1 : Math.exp(Math.log(v0) + (Math.log(v1 / v0) * Math.log(E / e0)) / Math.log(e1 / e0));
  return (mr * m.rho) / 1e4;
}

/** Tabulated smooth function on [lo, hi] with linear interpolation (clamped outside). For per-frame loops. */
export function tabulate(fn: (x: number) => number, lo: number, hi: number, step: number): (x: number) => number {
  const n = Math.ceil((hi - lo) / step) + 1;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = fn(lo + i * step);
  return (x) => {
    let f = (x - lo) / step;
    if (f <= 0) return v[0];
    if (f >= n - 1) return v[n - 1];
    const i = f | 0;
    f -= i;
    return v[i] + (v[i + 1] - v[i]) * f;
  };
}

const MU_LO = 3;
const MU_HI = 40;
const MU_STEP = 0.01;
const muTables = new Map<MaterialId, { f: (E: number) => number; edges: number[] }>();
/** muLinear via a 10 eV table; exact within one step of an absorption edge (no smeared edge). */
export function muFast(m: Material, E: number): number {
  let tb = muTables.get(m.id);
  if (!tb) {
    const edges = m.mu.filter((n, i) => i > 0 && n[0] === m.mu[i - 1][0]).map((n) => n[0]);
    tb = { f: tabulate((x) => muLinear(m, x), MU_LO, MU_HI, MU_STEP), edges };
    muTables.set(m.id, tb);
  }
  if (E < MU_LO || E > MU_HI) return muLinear(m, E);
  for (const e of tb.edges) if (Math.abs(E - e) < MU_STEP) return muLinear(m, E);
  return tb.f(E);
}

/** sin of the incidence angle of the beam on the 45° surface */
const SIN_IN = Math.SQRT1_2;

/**
 * Absorption-limited diffracting volume per unit beam area (µm) of a semi-infinite crystal:
 * ∫ e^{−μ s (1 + sinα_in/sinα_out)} ds = 1 / [μ (1 + sinα_in / sinα_out)]. 0 if the ray exits through the sample.
 */
export function thickVolume(mu: number, sinOut: number): number {
  return sinOut > 1e-6 ? 1 / (mu * (1 + SIN_IN / sinOut)) : 0;
}

/** Atomic form factor f(s), s = sinθ/λ (Å⁻¹). */
export function formFactor(m: Material, s: number): number {
  const c = m.cm;
  const s2 = s * s;
  return c[0] * Math.exp(-c[1] * s2) + c[2] * Math.exp(-c[3] * s2) + c[4] * Math.exp(-c[5] * s2) + c[6] * Math.exp(-c[7] * s2) + c[8];
}

/** |F_hkl|² / f² for the conventional cubic cell (0 ⇒ extinct). */
export function structureFactorRatio(structure: Material['structure'], h: number, k: number, l: number): number {
  const ph = Math.abs(h) % 2;
  const pk = Math.abs(k) % 2;
  const pl = Math.abs(l) % 2;
  if (!(ph === pk && pk === pl)) return 0; // mixed parity: extinct for both fcc and diamond
  if (structure === 'fcc') return 16;
  if (ph === 1) return 32; // diamond, all odd: |4(1 ± i)|²
  return (((h + k + l) % 4) + 4) % 4 === 0 ? 64 : 0; // diamond, all even
}

export function dSpacing(a: number, h: number, k: number, l: number): number {
  return a / Math.sqrt(h * h + k * k + l * l);
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * All reflection DIRECTIONS (primitive hkl, gcd = 1) with their allowed harmonics n·hkl up to |G| ≤ gMax.
 * Each harmonic carries w = |F|²·e^{−2Bs²} evaluated at the unstrained |G| (strain ≲ 1 % changes f by ≲ 1 %).
 */
export interface DirTable {
  material: Material;
  n: number;
  hkl: Int16Array; // 3·n
  off: Int32Array; // n+1, into harmonic arrays
  hn: Int16Array; // harmonic order
  hw: Float64Array; // |F|² e^{−2Bs²}
}

export function buildDirections(m: Material, gMax: number): DirTable {
  const g0 = (2 * Math.PI) / m.a;
  const N = Math.floor(gMax / g0);
  const hkl: number[] = [];
  const off: number[] = [0];
  const hn: number[] = [];
  const hw: number[] = [];
  for (let h = -N; h <= N; h++)
    for (let k = -N; k <= N; k++)
      for (let l = -N; l <= N; l++) {
        if (h === 0 && k === 0 && l === 0) continue;
        if (gcd(gcd(h, k), l) !== 1) continue;
        const len = Math.sqrt(h * h + k * k + l * l);
        if (len * g0 > gMax) continue;
        const start = hn.length;
        for (let n = 1; n * len * g0 <= gMax; n++) {
          const r = structureFactorRatio(m.structure, n * h, n * k, n * l);
          if (!r) continue;
          const s = (n * len * g0) / (4 * Math.PI);
          const f = formFactor(m, s);
          hn.push(n);
          hw.push(r * f * f * Math.exp(-2 * m.B * s * s));
        }
        if (hn.length > start) {
          hkl.push(h, k, l);
          off.push(hn.length);
        }
      }
  return { material: m, n: hkl.length / 3, hkl: Int16Array.from(hkl), off: Int32Array.from(off), hn: Int16Array.from(hn), hw: Float64Array.from(hw) };
}

// ------------------------------------------------------------------ orientation & strain

/** Orientation (crystal → lab) with crystal direction `normal` along the sample normal and `inplane` along lab X. */
export function orientFromNormal(normal: Vec3, inplane: Vec3): Mat3 {
  const c3 = unit(normal);
  const c1 = unit(inplane);
  const c2 = cross(c3, c1); // right-handed crystal frame {c1, c2, c3}
  const l1: Vec3 = [1, 0, 0];
  const l3 = SAMPLE_NORMAL;
  const l2 = cross(l3, l1);
  // U = Σ l_i c_iᵀ
  const U = new Float64Array(9);
  const Ls = [l1, l2, l3];
  const Cs = [c1, c2, c3];
  for (let i = 0; i < 3; i++)
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) U[r * 3 + c] += Ls[i][r] * Cs[i][c];
  return U;
}

/**
 * Full orientation from the three station angles (rad), applied in the lab frame to a base orientation:
 *   U = R_Z(turn) · R_X(tilt) · R_n(spin) · U0
 * spin = rotation about the sample-surface normal, tilt = about the horizontal X axis, turn = about the beam.
 */
export function composeU(U0: Mat3, turn: number, tilt: number, spin: number): Mat3 {
  return mul(rotAxis([0, 0, 1], turn), mul(rotAxis([1, 0, 0], tilt), mul(rotAxis(SAMPLE_NORMAL, spin), U0)));
}

/** Uniformly random rotation (Shoemake). */
export function randomU(r: () => number): Mat3 {
  const u1 = r();
  const u2 = r() * 2 * Math.PI;
  const u3 = r() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  const q = [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)]; // x y z w
  const [x, y, z, w] = q;
  return mat3(1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y));
}

export type StrainKind = 'deviatoric' | 'hydrostatic';

/** Lab-frame strain tensor. Deviatoric: exactly volume-conserving uniaxial stretch e along X. */
export function strainTensor(kind: StrainKind, e: number): Mat3 {
  if (kind === 'hydrostatic') return mat3(e, 0, 0, 0, e, 0, 0, 0, e);
  const t = 1 / Math.sqrt(1 + e) - 1;
  return mat3(e, 0, 0, 0, t, 0, 0, 0, t);
}

/** hkl → G_lab (Å⁻¹, |G| = 2π/d) for cubic lattice a, orientation U and lab strain ε. */
export function reciprocalMatrix(a: number, U: Mat3, eps?: Mat3): Mat3 {
  let M = U;
  if (eps) {
    const F = mat3(1 + eps[0], eps[1], eps[2], eps[3], 1 + eps[4], eps[5], eps[6], eps[7], 1 + eps[8]);
    M = mul(transpose(inv3(F)), U);
  }
  const o = new Float64Array(9);
  const s = (2 * Math.PI) / a;
  for (let i = 0; i < 9; i++) o[i] = M[i] * s;
  return o;
}

// ------------------------------------------------------------------ spectrum

/**
 * ILLUSTRATIVE pink-beam spectrum on the sample (relative photons per unit energy).
 * A smooth envelope (as from a gap-tapered undulator; an untapered U28 at K≈2.46 instead gives narrow odd
 * harmonics at ≈ 9.1, 15.2, 21.3, 27.4 keV), times the Pt-mirror cut-off (θc·E ≈ 84 mrad·keV ⇒ 28 keV at 3 mrad),
 * times a soft low-energy roll-off from windows/air. Not a calculated undulator spectrum.
 */
export function pinkSpectrum(E: number): number {
  const env = Math.exp(-0.5 * (Math.log(E / 13) / 0.6) ** 2);
  const mirror = 1 / (1 + Math.exp((E - 28.2) / 0.55));
  const low = 1 - Math.exp(-((E / 7) ** 4));
  return env * mirror * low;
}

// ------------------------------------------------------------------ Laue pattern

export interface Harmonic {
  n: number;
  h: number;
  k: number;
  l: number;
  E: number;
  /** relative intensity (pink beam) */
  I: number;
  /** spectrum-free weight λ²|F|²e^{−2Bs²}P·A/sin²θ (I = S(E)·w, S per unit energy) */
  w: number;
  /** linear attenuation of the crystal at this energy (1/µm) */
  mu: number;
}

export interface Spot {
  /** index into the DirTable */
  dir: number;
  /** label hkl = lowest-order allowed harmonic inside the band */
  h: number;
  k: number;
  l: number;
  /** detector coordinates (mm): x along lab X (outboard), z along lab Z (downstream) */
  x: number;
  z: number;
  /** unit k_out */
  kx: number;
  ky: number;
  kz: number;
  /** unit G (lab) */
  gx: number;
  gy: number;
  gz: number;
  tth: number;
  sinT: number;
  /** energy of the strongest in-band harmonic */
  E: number;
  /** total pink-beam intensity */
  I: number;
  harm: Harmonic[];
}

export interface LaueOpts {
  L: number;
  half: number;
  Emin: number;
  Emax: number;
  spectrum: (E: number) => number;
  /** include the thick-crystal absorption-limited volume A(E) in the intensities (default false) */
  absorption?: boolean;
}

export interface LaueResult {
  spots: Spot[];
  /** reflections satisfying Bragg within the band but missing this detector */
  elsewhere: number;
}

/**
 * Laue pattern on the top detector for reciprocal matrix T (hkl → G_lab).
 * `dirs` (optional) restricts the calculation to these direction indices. E.g. The unstrained twins of the
 * spots of a strained pattern, instead of the whole table.
 */
export function computeLaue(tab: DirTable, T: Mat3, o: LaueOpts, minI = 0, dirs?: ArrayLike<number>): LaueResult {
  const spots: Spot[] = [];
  let elsewhere = 0;
  const { hkl, off, hn, hw } = tab;
  const nIter = dirs ? dirs.length : tab.n;
  for (let q = 0; q < nIter; q++) {
    const i = dirs ? dirs[q] : q;
    const h = hkl[i * 3];
    const k = hkl[i * 3 + 1];
    const l = hkl[i * 3 + 2];
    const Gx = T[0] * h + T[1] * k + T[2] * l;
    const Gy = T[3] * h + T[4] * k + T[5] * l;
    const Gz = T[6] * h + T[7] * k + T[8] * l;
    const g = Math.sqrt(Gx * Gx + Gy * Gy + Gz * Gz);
    const sinT = -Gz / g;
    if (sinT <= 1e-6) continue;
    const E1 = (HBARC * g) / (2 * sinT);
    const nmin = Math.ceil(o.Emin / E1 - 1e-12);
    const nmax = Math.floor(o.Emax / E1 + 1e-12);
    if (nmax < nmin) continue;
    let any = false;
    for (let j = off[i]; j < off[i + 1]; j++) if (hn[j] >= nmin && hn[j] <= nmax) any = true;
    if (!any) continue;
    const ux = Gx / g;
    const uy = Gy / g;
    const uz = Gz / g;
    const kx = 2 * sinT * ux;
    const ky = 2 * sinT * uy;
    const kz = 1 + 2 * sinT * uz;
    const P = 1 - kx * kx; // horizontal linear polarisation
    const lor = 1 / (sinT * sinT);
    const sinOut = (ky * SAMPLE_NORMAL[1] + kz * SAMPLE_NORMAL[2]); // k̂_out·n̂ (n̂_x = 0)
    // intensity first (needed for the threshold even when the spot misses the detector)
    const harm: Harmonic[] = [];
    let I = 0;
    let best = 0;
    let bestE = 0;
    for (let j = off[i]; j < off[i + 1]; j++) {
      const n = hn[j];
      if (n < nmin || n > nmax) continue;
      const E = n * E1;
      const lam = HC / E;
      const mu = muFast(tab.material, E);
      const A = o.absorption ? thickVolume(mu, sinOut) : 1;
      // λ² (not λ⁴): S(E) is per unit energy, i(λ) = S(E)·hc/λ². See the header
      const w = lam * lam * hw[j] * P * lor * A;
      const Ih = o.spectrum(E) * w;
      harm.push({ n, h: n * h, k: n * k, l: n * l, E, I: Ih, w, mu });
      I += Ih;
      if (Ih > best) {
        best = Ih;
        bestE = E;
      }
    }
    if (I < minI) continue;
    if (ky <= 1e-9) {
      elsewhere++;
      continue;
    }
    const t = o.L / ky;
    const x = t * kx;
    const z = t * kz;
    if (Math.abs(x) > o.half || Math.abs(z) > o.half) {
      elsewhere++;
      continue;
    }
    const lab = harm[0];
    spots.push({ dir: i, h: lab.h, k: lab.k, l: lab.l, x, z, kx, ky, kz, gx: ux, gy: uy, gz: uz, tth: Math.acos(Math.max(-1, Math.min(1, kz))), sinT, E: bestE, I, harm });
  }
  return { spots, elsewhere };
}

/** FWHM (keV) of the energy window over which a reflection at Bragg angle θ is seen with the monochromator. */
export function monoWindow(E: number, sinT: number): number {
  const cot = Math.sqrt(Math.max(0, 1 - sinT * sinT)) / sinT;
  return E * Math.hypot(MONO_DTHETA * cot, SI111_DE_E);
}

/** Gaussian response of a harmonic at energy E when the monochromator sits at E0. */
export function monoResponse(E: number, E0: number, fwhm: number): number {
  const x = (E - E0) / fwhm;
  return Math.exp(-4 * Math.LN2 * x * x);
}

/** 2θ (rad) of a detector point (x, z) in mm. */
export function detectorTwoTheta(x: number, z: number, L = GEOM.L): number {
  return Math.acos(z / Math.sqrt(x * x + L * L + z * z));
}

/** Angle (rad) between two unit vectors. */
export function angleBetween(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b)))));
}

// ------------------------------------------------------------------ DAXM (wire scan)

export interface DaxmGeom {
  /** sample–pixel distance along Y (µm) */
  L: number;
  /** pixel scattering angle 2θ (rad), pixel in the Y–Z plane */
  tth: number;
  /** wire radius (µm) */
  R: number;
  /** wire-axis height above the sample surface (µm) */
  h: number;
  /** linear attenuation of the sample at the reflection energy (1/µm) */
  muS: number;
  /** linear attenuation of the Pt wire (1/µm) */
  muW: number;
}

export const DAXM_DEFAULT: DaxmGeom = { L: GEOM.L * 1000, tth: Math.PI / 2, R: 25, h: 200, muS: 0, muW: 1 / 6.2 };
DAXM_DEFAULT.muS = muLinear(MATERIALS.Ni, 20);

/** watched pixel (y, z) in µm */
export function pixelYZ(g: DaxmGeom): [number, number] {
  return [g.L, g.L * cot(g.tth)];
}

function cot(a: number): number {
  return Math.cos(a) / Math.sin(a);
}

/** wire-axis (y, z) in µm for wire position u along Ĥ = (Ŷ+Ẑ)/√2 */
export function wireYZ(u: number, h: number): [number, number] {
  return [(u + h) * Math.SQRT1_2, (u - h) * Math.SQRT1_2];
}

/** Depths along the beam (µm) where the pixel→wire-edge tangents meet the beam: [trailing, leading]. */
export function edgeDepths(u: number, g: DaxmGeom): [number, number] {
  const py = g.L;
  const pz = g.L * cot(g.tth);
  const dy = (u + g.h) * Math.SQRT1_2 - py;
  const dz = (u - g.h) * Math.SQRT1_2 - pz;
  const d = Math.hypot(dy, dz);
  const sa = Math.min(1, g.R / d);
  const ca = Math.sqrt(1 - sa * sa);
  // rotate the pixel→wire-centre direction by ±a: the two tangent lines; intersect each with the beam y = 0
  const ty1 = dy * ca - dz * -sa;
  const tz1 = dy * -sa + dz * ca;
  const ty2 = dy * ca - dz * sa;
  const tz2 = dy * sa + dz * ca;
  const s1 = pz - (py / ty1) * tz1;
  const s2 = pz - (py / ty2) * tz2;
  return s1 < s2 ? [s1, s2] : [s2, s1];
}

/** Parallel-ray estimate of ds/du (µm of beam per µm of wire travel). */
export function depthPerWireStep(tth: number): number {
  return (1 - Math.cos(tth) / Math.sin(tth)) * Math.SQRT1_2;
}

/** Wire position u at which the leading edge's shadow reaches depth s (bisection; s_lead(u) is monotonic). */
export function uForLead(s: number, g: DaxmGeom): number {
  let lo = -5000;
  let hi = 5000;
  for (let i = 0; i < 70; i++) {
    const m = (lo + hi) / 2;
    if (edgeDepths(m, g)[1] < s) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
/** Wire position u at which the trailing edge's shadow reaches depth s. */
export function uForTrail(s: number, g: DaxmGeom): number {
  let lo = -5000;
  let hi = 5000;
  for (let i = 0; i < 70; i++) {
    const m = (lo + hi) / 2;
    if (edgeDepths(m, g)[0] < s) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Unit direction (y, z) from beam point s to the pixel. */
export function rayDir(s: number, g: DaxmGeom): [number, number] {
  const dy = g.L;
  const dz = g.L * cot(g.tth) - s;
  const n = Math.hypot(dy, dz);
  return [dy / n, dz / n];
}

/** Path length (µm) inside the sample from beam point s to the surface along the ray to the pixel. */
export function exitPath(s: number, g: DaxmGeom): number {
  const dy = g.L;
  const dz = g.L * cot(g.tth) - s;
  return (s * Math.hypot(dy, dz)) / (dy - dz);
}

/** Transmission of the ray (beam point s → pixel) through the wire at position u (pixel cot2θ precomputable). */
export function wireTransmission(s: number, u: number, g: DaxmGeom, cot2t = cot(g.tth)): number {
  const dy = g.L;
  const dz = g.L * cot2t - s;
  const n = Math.hypot(dy, dz);
  const ry = (u + g.h) * Math.SQRT1_2;
  const rz = (u - g.h) * Math.SQRT1_2 - s;
  const b = Math.abs(ry * dz - rz * dy) / n;
  if (b >= g.R) return 1;
  // the wire always lies between the beam point and the pixel in this geometry
  const chord = 2 * Math.sqrt(g.R * g.R - b * b);
  return Math.exp(-g.muW * chord);
}

export interface Grain {
  /** along-beam extent (µm) */
  s0: number;
  s1: number;
  /** relative scattering strength into the watched pixel */
  amp: number;
}

export interface DepthGrid {
  s0: number;
  ds: number;
  /** emitted signal per µm reaching the pixel when unobstructed: f(s)·e^{−μ(s + t_out)} */
  f: Float64Array;
}

/** Discretise the grains into an attenuated depth profile. */
export function depthGrid(grains: Grain[], g: DaxmGeom, sMax: number, ds = 0.1): DepthGrid {
  const n = Math.ceil(sMax / ds);
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * ds;
    let a = 0;
    for (const gr of grains) if (s >= gr.s0 && s < gr.s1) a += gr.amp;
    if (a) f[i] = a * Math.exp(-g.muS * (s + exitPath(s, g)));
  }
  return { s0: 0, ds, f };
}

/** Pixel intensity (∫ f·T ds) for wire position u. */
export function wireIntensity(u: number, g: DaxmGeom, grid: DepthGrid): number {
  const [lo, hi] = edgeDepths(u, g);
  const pad = 0.5; // the transmission is exactly 1 outside the geometric shadow [lo, hi]
  const c2 = cot(g.tth);
  let sum = 0;
  for (let i = 0; i < grid.f.length; i++) {
    const fi = grid.f[i];
    if (!fi) continue;
    const s = grid.s0 + (i + 0.5) * grid.ds;
    const T = s < lo - pad || s > hi + pad ? 1 : wireTransmission(s, u, g, c2);
    sum += fi * T;
  }
  return sum * grid.ds;
}

/** Total unobstructed pixel intensity. */
export function totalIntensity(grid: DepthGrid): number {
  let s = 0;
  for (let i = 0; i < grid.f.length; i++) s += grid.f[i];
  return s * grid.ds;
}

/** Pt / Ni attenuation lengths (µm) at 20 keV, for labels */
export const ATTEN = { niAt20keV_um: 1 / muLinear(MATERIALS.Ni, 20), ptAt20keV_um: 6.2 };
