/**
 * HEDM station. Pure physics without DOM access. Everything here is unit-tested in tests/hedm.test.ts.
 *
 * Geometry in the lab frame: beam along +x, rotation axis ω = +z (vertical, also the tensile-load axis),
 * y horizontal. R_z(ω) turns the sample counter-clockwise seen from +z. The sample is a vertical cylinder;
 * we follow one horizontal slice (the plane z = 0, the plane a line-focused beam illuminates).
 *
 * 1. Bragg / Laue condition (elastic scattering, monochromatic beam):
 *      k_out = k_in + g,  |k_out| = |k_in| = 1/λ        λ[Å] = hc/E = 12.398 / E[keV]
 *    ⇔ λ = 2 d sinθ  and, for the lab-frame reciprocal vector g_l = R_z(ω) g_s,   g_l,x = −λ|g|²/2.
 *    With g_s = (ρ cosφ, ρ sinφ, g_z):  cos(ω + φ) = −λ|g|²/(2ρ)  → two ω per g (none if ρ is too small:
 *    the blind zone around the rotation axis). Diffracted direction d̂ = x̂ + λ g_l, so cos 2θ = d̂_x.
 *    At 70 keV (λ = 0.177 Å) Ni{111} (d = 2.034 Å) sits at 2θ = 4.99°: high-energy diffraction is
 *    forward-peaked, 2θ ≈ λ/d, and every ring radius on a flat detector scales ≈ 1/E.
 * 2. Spot position on a flat detector ⟂ beam at distance L from the rotation axis, for a scatterer at P:
 *      (Y, Z) = (P_y + (L − P_x) d̂_y/d̂_x,  P_z + (L − P_x) d̂_z/d̂_x)
 *    Far field (L ≈ 1 m): P hardly matters → spots encode orientation + d-spacing (strain).
 *    Near field (L ≈ 5–10 mm): P matters → each spot is a projection of the grain's shape.
 * 3. Lattice strain: strained reciprocal lattice g' = (I + ε)^{−T} g ≈ (I − ε) g (small, rotation-free),
 *    so d'_{hkl} = d(1 + n̂·ε·n̂) and Δ(2θ) = −2 tanθ · ε_{hkl}; on the detector ΔR/R ≈ −ε_{hkl}.
 *    Tension along z: spots near η = ±90° (g ∥ load) move inward, spots near η = 0/180° move outward
 *    (Poisson contraction) → rings become slightly squashed ellipses.
 * 4. Grain stresses: uniaxial macroscopic stress σ along z. Each grain's strain is the mean of the Reuss
 *    (iso-stress, ε = S_grain : σ, anisotropic single-crystal compliances) and Voigt (iso-strain,
 *    Voigt-averaged isotropic moduli) bounds. A Hill-type stand-in for a self-consistent model.
 *    Cubic compliance tensor: S_ijkl = S12 δij δkl + (S44/4)(δik δjl + δil δjk) + (S11 − S12 − S44/2) Σ_p δip δjp δkp δlp.
 *    Ni single-crystal constants (room temperature): C11 = 246.5, C12 = 147.3, C44 = 124.7 GPa
 *    (Alers, Neighbours & Sato, J. Phys. Chem. Solids 13, 40 (1960)) → E<100> = 136 GPa, E<111> = 304 GPa.
 *    Macroscopic curve: linear elastic up to σ_y, then linear hardening σ = σ_y + H ε_p. σ_y = 900 MPa and
 *    H = 1.5 GPa are ILLUSTRATIVE of a high-strength Ni alloy; load sharing between grain families after
 *    yield (elasto-plastic self-consistent effects) is not modelled.
 * 5. Plasticity (ILLUSTRATIVE magnitudes): intragranular misorientation spread (FWHM) 0.03° + 0.9° per % plastic
 *    strain, rigid grain rotation 0.25° per %, intragranular strain heterogeneity 1e-4 + 2e-4 per %.
 *    Orders of magnitude follow in-situ 3DXRD/HEDM tensile studies (e.g. Margulies et al., Science 291,
 *    2392 (2001); Pokharel et al., IJP 67, 217 (2015)).
 * 6. Integrated spot intensity (kinematic, rotation method):
 *      I ∝ λ³ |F|² · P · L · V · A,   |F|² = 16 f(s)² e^{−2Bs²} (fcc), s = sinθ/λ = 1/(2d)
 *      Lorentz factor for rotation about z:  L = 1/(sin2θ |cos η|) (η from the horizontal; capped at
 *      |cos η| ≥ 0.15 near the blind zone), polarisation for horizontal linear polarisation P = 1 − d̂_y²,
 *      absorption A = exp(−μ (path_in + path_out)) through the cylinder.
 *    f(s): Cromer–Mann coefficients for Ni (International Tables C, Table 6.1.1.4); B(Ni, 295 K) ≈ 0.37 Å².
 *    At small angles λ³/sin2θ ≈ λ² d → per-grain signal ∝ λ² e^{−μD}: thicker samples need higher energy.
 * 7. Attenuation: I/I₀ = exp(−(μ/ρ) ρ t). μ/ρ (total, with coherent scattering) from NIST XCOM /
 *    Hubbell & Seltzer, NIST Standard Reference Database 126 (X-ray mass attenuation coefficients), at
 *    10–200 keV, interpolated log–log (no absorption edges in this range for Al, Ti, Fe, Ni). "Steel" = Fe.
 *    Check: Fe 1/μ = 0.35 mm at 40 keV, 1.5 mm at 70 keV, 3.4 mm at 100 keV (HEXM dossier, r52).
 * 8. Orientation colour: inverse pole figure of the sample z (load) axis, cubic m-3m, RGB = (c−b, b−a, √2·a)
 *    of the sorted |components| a ≤ b ≤ c, normalised. Red [001], green [101], blue [111].
 */
import { gauss, rng } from '../../../lib/fft';

export type Vec3 = [number, number, number];
/** 3×3 matrix, row-major */
export type Mat3 = Float64Array;

export const DEG = Math.PI / 180;
/** hc in keV·Å (CODATA 2018) */
export const HC_KEV_A = 12.398419843;
export const wavelength = (EkeV: number): number => HC_KEV_A / EkeV;

// ------------------------------------------------------------------ material: nickel (fcc)

export const NI = {
  /** lattice parameter (Å), room temperature (ICDD 04-0850) */
  a: 3.5238,
  /** single-crystal elastic constants, GPa (Alers et al. 1960) */
  C11: 246.5,
  C12: 147.3,
  C44: 124.7,
  /** isotropic Debye–Waller factor, Å² (room temperature) */
  B: 0.37,
  /** Cromer–Mann a1 b1 a2 b2 a3 b3 a4 b4 c */
  cm: [12.8376, 3.8785, 7.292, 0.256565, 4.4438, 12.1763, 2.38, 66.3421, 1.0341],
};

/** Illustrative macroscopic plasticity of a high-strength Ni alloy (GPa). */
export const ALLOY = { sigmaY: 0.9, H: 1.5 };

/** Atomic scattering factor of Ni at s = sinθ/λ (Å⁻¹). */
export function formFactorNi(s: number): number {
  const c = NI.cm;
  const s2 = s * s;
  return c[0] * Math.exp(-c[1] * s2) + c[2] * Math.exp(-c[3] * s2) + c[4] * Math.exp(-c[5] * s2) + c[6] * Math.exp(-c[7] * s2) + c[8];
}

// ------------------------------------------------------------------ X-ray attenuation (NIST XCOM)

export const ATT_E = [10, 15, 20, 30, 40, 50, 60, 80, 100, 150, 200];
export type MatId = 'al' | 'ti' | 'fe' | 'ni';
export interface Material {
  id: MatId;
  name: string;
  /** g/cm³ */
  rho: number;
  /** μ/ρ in cm²/g at ATT_E */
  muRho: number[];
}
export const MATERIALS: Record<MatId, Material> = {
  al: { id: 'al', name: 'Aluminium', rho: 2.699, muRho: [26.23, 7.955, 3.441, 1.128, 0.5685, 0.3681, 0.2778, 0.2018, 0.1704, 0.1378, 0.1223] },
  ti: { id: 'ti', name: 'Titanium', rho: 4.54, muRho: [110.7, 35.87, 15.85, 4.972, 2.214, 1.213, 0.7661, 0.4052, 0.2721, 0.1649, 0.1314] },
  fe: { id: 'fe', name: "Steel · Fe", rho: 7.874, muRho: [170.6, 57.08, 25.68, 8.176, 3.629, 1.958, 1.205, 0.5952, 0.3717, 0.1964, 0.146] },
  ni: { id: 'ni', name: 'Nickel', rho: 8.902, muRho: [209.0, 70.81, 32.2, 10.34, 4.597, 2.474, 1.512, 0.7306, 0.444, 0.2208, 0.1582] },
};

/** μ/ρ (cm²/g), log–log interpolation between NIST nodes (log–log extrapolation of the end segments). */
export function muRho(m: Material, E: number): number {
  const xs = ATT_E;
  let i = 0;
  while (i < xs.length - 2 && E > xs[i + 1]) i++;
  const t = Math.log(E / xs[i]) / Math.log(xs[i + 1] / xs[i]);
  return Math.exp(Math.log(m.muRho[i]) + t * (Math.log(m.muRho[i + 1]) - Math.log(m.muRho[i])));
}
/** linear attenuation coefficient μ in 1/mm */
export const muPerMm = (m: Material, E: number): number => (muRho(m, E) * m.rho) / 10;
/** 1/e attenuation length in mm */
export const attLengthMm = (m: Material, E: number): number => 1 / muPerMm(m, E);
/** transmission through t mm */
export const transmission = (m: Material, E: number, tMm: number): number => Math.exp(-muPerMm(m, E) * tMm);

/**
 * Relative diffracted signal from a rod of diameter D (central chord), small-angle rotation method:
 * ∝ λ³/sin2θ · e^{−μD} ≈ λ² d · e^{−μD}. Normalised to its maximum over 20–200 keV by the caller.
 */
export function signal(m: Material, Dmm: number, E: number): number {
  const l = wavelength(E);
  return l * l * Math.exp(-muPerMm(m, E) * Dmm);
}
/** Energy (keV) maximising signal() on [Emin, Emax]. */
export function bestEnergy(m: Material, Dmm: number, Emin = 20, Emax = 200): number {
  let best = Emin;
  let bv = -1;
  for (let i = 0; i <= 400; i++) {
    const E = Emin * Math.pow(Emax / Emin, i / 400);
    const v = signal(m, Dmm, E);
    if (v > bv) {
      bv = v;
      best = E;
    }
  }
  return best;
}

// ------------------------------------------------------------------ Bragg / reflections

export const twoThetaOf = (d: number, lambda: number): number => 2 * Math.asin(Math.min(1, lambda / (2 * d)));

export interface Family {
  hkl: Vec3;
  label: string;
  /** h²+k²+l² */
  m2: number;
  /** d-spacing, Å */
  d: number;
  /** unit plane normals in the crystal frame (x,y,z triplets), all symmetry-equivalent members incl. ±g */
  normals: Float64Array;
  n: number;
}

/** The first `count` fcc ring families (h,k,l unmixed), innermost first. */
export function fccFamilies(a: number, count: number): Family[] {
  const list: { hkl: Vec3; m2: number }[] = [];
  for (let h = 0; h <= 8; h++)
    for (let k = 0; k <= h; k++)
      for (let l = 0; l <= k; l++) {
        if (h + k + l === 0) continue;
        if (!(h % 2 === k % 2 && k % 2 === l % 2)) continue;
        list.push({ hkl: [h, k, l], m2: h * h + k * k + l * l });
      }
  list.sort((p, q) => p.m2 - q.m2 || q.hkl[0] - p.hkl[0]);
  return list.slice(0, count).map(({ hkl, m2 }) => {
    const seen = new Set<string>();
    const out: number[] = [];
    const perms: Vec3[] = [
      [hkl[0], hkl[1], hkl[2]],
      [hkl[0], hkl[2], hkl[1]],
      [hkl[1], hkl[0], hkl[2]],
      [hkl[1], hkl[2], hkl[0]],
      [hkl[2], hkl[0], hkl[1]],
      [hkl[2], hkl[1], hkl[0]],
    ];
    const inv = 1 / Math.sqrt(m2);
    for (const p of perms)
      for (let s = 0; s < 8; s++) {
        const v: Vec3 = [s & 1 ? -p[0] : p[0], s & 2 ? -p[1] : p[1], s & 4 ? -p[2] : p[2]];
        const key = v.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(v[0] * inv, v[1] * inv, v[2] * inv);
      }
    return { hkl, label: hkl.join(''), m2, d: a / Math.sqrt(m2), normals: new Float64Array(out), n: out.length / 3 };
  });
}

/**
 * ω solutions of the Bragg condition for a sample-frame reciprocal vector g (Å⁻¹), beam ∥ +x, rotation about +z.
 * Writes up to two (ω ∈ [0, 2π), d̂x, d̂y, d̂z) quadruples into out; returns how many.
 */
export function solveOmega(gx: number, gy: number, gz: number, lambda: number, out: Float64Array, offset = 0): number {
  const G2 = gx * gx + gy * gy + gz * gz;
  const rho = Math.sqrt(gx * gx + gy * gy);
  const target = (-lambda * G2) / 2; // required lab g_x
  if (rho < 1e-12 || Math.abs(target) > rho) return 0;
  const phi = Math.atan2(gy, gx);
  const ac = Math.acos(target / rho);
  const TWO_PI = 2 * Math.PI;
  for (let k = 0; k < 2; k++) {
    let om = (k === 0 ? ac : -ac) - phi;
    om -= TWO_PI * Math.floor(om / TWO_PI);
    const c = Math.cos(om);
    const s = Math.sin(om);
    const j = offset + k * 4;
    out[j] = om;
    out[j + 1] = 1 + lambda * (gx * c - gy * s);
    out[j + 2] = lambda * (gx * s + gy * c);
    out[j + 3] = lambda * gz;
  }
  return 2;
}

/** Detector hit of a ray from (px, py, 0) along d̂ on the plane x = L. Returns [Y, Z]. */
export function detectorHit(px: number, py: number, dx: number, dy: number, dz: number, L: number): [number, number] {
  const t = (L - px) / dx;
  return [py + t * dy, t * dz];
}

/** 3D path length from (px, py) along d̂ until it leaves a vertical cylinder of radius R. */
export function exitPath(px: number, py: number, dx: number, dy: number, R: number): number {
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return 0;
  const b = px * dx + py * dy;
  const c = px * px + py * py - R * R;
  const disc = b * b - a * c;
  return disc <= 0 ? 0 : Math.max(0, (-b + Math.sqrt(disc)) / a);
}
/** path of the incident beam (along +x) from the cylinder surface to (px, py) */
export function entryPath(px: number, py: number, R: number): number {
  const h = R * R - py * py;
  return h <= 0 ? 0 : Math.max(0, px + Math.sqrt(h));
}

/** f(s)² e^{−2Bs²} of a reflection with spacing d (Å). The structure-factor part of the spot intensity */
export function fDW(d: number): number {
  const s = 1 / (2 * d);
  const f = formFactorNi(s);
  return f * f * Math.exp(-2 * NI.B * s * s);
}

/**
 * Relative integrated intensity of one spot (no volume / absorption): λ³ f² e^{−2Bs²} P L.
 * d̂ = diffracted unit vector (lab), d in Å; pass fdw = fDW(d) to skip recomputing the form factor.
 */
export function spotFactor(lambda: number, d: number, dy: number, dz: number, fdw = fDW(d)): number {
  const sin2t = Math.sqrt(dy * dy + dz * dz);
  if (sin2t < 1e-9) return 0;
  const cosEta = Math.abs(dy) / sin2t;
  const P = 1 - dy * dy;
  const L = 1 / (sin2t * Math.max(0.15, cosEta));
  return lambda * lambda * lambda * fdw * P * L;
}

// ------------------------------------------------------------------ rotations

export function mat3(): Mat3 {
  return new Float64Array(9);
}
export function identity(out: Mat3 = mat3()): Mat3 {
  out.fill(0);
  out[0] = out[4] = out[8] = 1;
  return out;
}
export function matMul(A: ArrayLike<number>, B: ArrayLike<number>, out: Mat3 = mat3()): Mat3 {
  const r = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  out.set(r);
  return out;
}
export function transpose(A: ArrayLike<number>, out: Mat3 = mat3()): Mat3 {
  const r = [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
  out.set(r);
  return out;
}
export function quatToMat(w: number, x: number, y: number, z: number, out: Mat3 = mat3()): Mat3 {
  const n = Math.hypot(w, x, y, z) || 1;
  w /= n;
  x /= n;
  y /= n;
  z /= n;
  out[0] = 1 - 2 * (y * y + z * z);
  out[1] = 2 * (x * y - w * z);
  out[2] = 2 * (x * z + w * y);
  out[3] = 2 * (x * y + w * z);
  out[4] = 1 - 2 * (x * x + z * z);
  out[5] = 2 * (y * z - w * x);
  out[6] = 2 * (x * z - w * y);
  out[7] = 2 * (y * z + w * x);
  out[8] = 1 - 2 * (x * x + y * y);
  return out;
}
/** Uniformly random rotation (Shoemake 1992). */
export function randomRotation(r: () => number, out: Mat3 = mat3()): Mat3 {
  const u1 = r();
  const u2 = r() * 2 * Math.PI;
  const u3 = r() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return quatToMat(b * Math.cos(u3), a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), out);
}
/** Rotation by |v| radians about v (Rodrigues). */
export function rotVec(vx: number, vy: number, vz: number, out: Mat3 = mat3()): Mat3 {
  const t = Math.hypot(vx, vy, vz);
  if (t < 1e-15) return identity(out);
  const h = t / 2;
  const s = Math.sin(h) / t;
  return quatToMat(Math.cos(h), vx * s, vy * s, vz * s, out);
}
/** misorientation angle (rad) between two rotations, ignoring crystal symmetry */
export function rotAngle(A: ArrayLike<number>, B: ArrayLike<number>): number {
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += A[i * 3 + k] * B[i * 3 + k];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
}

/** Inverse-pole-figure colour (0..1 RGB) of the sample z axis, cubic symmetry. U maps crystal → sample. */
export function ipfColor(U: ArrayLike<number>): Vec3 {
  const v = [Math.abs(U[6]), Math.abs(U[7]), Math.abs(U[8])].sort((p, q) => p - q);
  const rgb: Vec3 = [v[2] - v[1], v[1] - v[0], v[0] * Math.SQRT2];
  const m = Math.max(rgb[0], rgb[1], rgb[2]) || 1;
  return [Math.pow(rgb[0] / m, 0.7), Math.pow(rgb[1] / m, 0.7), Math.pow(rgb[2] / m, 0.7)];
}
/** crystal direction ∥ sample z reduced to the standard triangle, as small integers-ish string, e.g. "1 1 4" */
export function loadAxisHkl(U: ArrayLike<number>): string {
  const v = [Math.abs(U[6]), Math.abs(U[7]), Math.abs(U[8])].sort((p, q) => p - q);
  // smallest-integer approximation with indices ≤ 6
  let best = '0 0 1';
  let be = Infinity;
  for (let c = 1; c <= 6; c++)
    for (let b = 0; b <= c; b++)
      for (let a = 0; a <= b; a++) {
        const n = Math.hypot(a, b, c);
        const err = Math.acos(Math.min(1, (a * v[0] + b * v[1] + c * v[2]) / n));
        if (err < be - 1e-9) {
          be = err;
          best = `${a} ${b} ${c}`;
        }
      }
  return best;
}

// ------------------------------------------------------------------ elasticity & plasticity

export interface Elastic {
  S11: number;
  S12: number;
  S44: number;
  /** anisotropy term S11 − S12 − S44/2 */
  A: number;
  /** Reuss & Voigt Young's moduli and Poisson ratios of a random polycrystal (GPa) */
  Er: number;
  nuR: number;
  Ev: number;
  nuV: number;
  /** macroscopic (Hill-type strain average) modulus and Poisson ratio */
  Em: number;
  nuM: number;
}

export function elastic(C11 = NI.C11, C12 = NI.C12, C44 = NI.C44): Elastic {
  const den = (C11 - C12) * (C11 + 2 * C12);
  const S11 = (C11 + C12) / den;
  const S12 = -C12 / den;
  const S44 = 1 / C44;
  const A = S11 - S12 - S44 / 2;
  // Reuss (random orientation average of compliances): ⟨Σ a_p⁴⟩ = 3/5, ⟨Σ a_p² n_p²⟩ = 1/5 (a ⟂ n)
  const sR = S11 - 0.4 * A;
  const tR = S12 + A / 5;
  const Er = 1 / sR;
  const nuR = -tR / sR;
  const K = (C11 + 2 * C12) / 3;
  const Gv = (C11 - C12 + 3 * C44) / 5;
  const Ev = (9 * K * Gv) / (3 * K + Gv);
  const nuV = (3 * K - 2 * Gv) / (2 * (3 * K + Gv));
  const sM = 0.5 * (sR + 1 / Ev);
  const tM = 0.5 * (tR - nuV / Ev);
  return { S11, S12, S44, A, Er, nuR, Ev, nuV, Em: 1 / sM, nuM: -tM / sM };
}

/** Young's modulus along a crystal direction (GPa) */
export function youngDir(el: Elastic, n: Vec3): number {
  const l = Math.hypot(n[0], n[1], n[2]);
  const a = n[0] / l;
  const b = n[1] / l;
  const c = n[2] / l;
  const G = a * a * b * b + b * b * c * c + c * c * a * a;
  return 1 / (el.S11 - 2 * el.A * G);
}

/**
 * Elastic strain tensor (sample frame) of a grain with orientation U under uniaxial stress σ (GPa) along z:
 * mean of the Reuss (single-crystal compliance) and Voigt (isotropic) estimates.
 */
export function grainStrain(U: ArrayLike<number>, sigma: number, el: Elastic, out: Mat3 = mat3()): Mat3 {
  const a = [U[6], U[7], U[8]]; // load axis in the crystal frame
  const ec = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) ec[i * 3 + j] = sigma * ((i === j ? el.S12 + el.A * a[i] * a[i] : 0) + (el.S44 / 2) * a[i] * a[j]);
  // es = U ec Uᵀ
  const t = matMul(U, ec);
  const es = matMul(t, transpose(U));
  const ezV = sigma / el.Ev;
  for (let i = 0; i < 9; i++) out[i] = 0.5 * es[i];
  out[0] += 0.5 * -el.nuV * ezV;
  out[4] += 0.5 * -el.nuV * ezV;
  out[8] += 0.5 * ezV;
  return out;
}

export interface MacroState {
  /** applied macroscopic strain (fraction) */
  eps: number;
  /** macroscopic stress (GPa) */
  sigma: number;
  /** plastic strain (fraction) */
  epsP: number;
  yielded: boolean;
}
export function macroState(eps: number, el: Elastic): MacroState {
  const eY = ALLOY.sigmaY / el.Em;
  if (eps <= eY) return { eps, sigma: el.Em * eps, epsP: 0, yielded: false };
  const epsP = (eps - eY) / (1 + ALLOY.H / el.Em);
  return { eps, sigma: ALLOY.sigmaY + ALLOY.H * epsP, epsP, yielded: true };
}

export interface PlasticFx {
  /** intragranular misorientation spread, FWHM, rad */
  spread: number;
  /** rigid rotation of each grain, rad */
  rot: number;
  /** intragranular strain heterogeneity, FWHM */
  hetero: number;
}
/** ILLUSTRATIVE plasticity-induced broadening (see header §5). */
export function plasticFx(epsP: number): PlasticFx {
  const p = epsP * 100;
  return { spread: (0.03 + 0.9 * p) * DEG, rot: 0.25 * p * DEG, hetero: 1e-4 + 2e-4 * p };
}

// ------------------------------------------------------------------ microstructure (2D Voronoi slice)

export interface Grain {
  id: number;
  /** Voronoi seed and area centroid, unit-disc coordinates (sample frame) */
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  /** cell polygon (x,y pairs), unit disc */
  poly: Float64Array;
  /** area as a fraction of the disc */
  area: number;
  /** orientation (crystal → sample) */
  U: Mat3;
  ipf: Vec3;
  /** random unit axis for plastic rigid rotation */
  rotAxis: Vec3;
  /** misorientation directions of 4 sub-grains (unit-normal 3-vectors), for deformation in near field */
  sub: Float64Array;
}

function clipHalfPlane(poly: number[], nx: number, ny: number, c: number): number[] {
  // keep points with nx*x + ny*y <= c
  const out: number[] = [];
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = poly[2 * i];
    const ay = poly[2 * i + 1];
    const j = (i + 1) % n;
    const bx = poly[2 * j];
    const by = poly[2 * j + 1];
    const da = nx * ax + ny * ay - c;
    const db = nx * bx + ny * by - c;
    if (da <= 0) out.push(ax, ay);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push(ax + t * (bx - ax), ay + t * (by - ay));
    }
  }
  return out;
}

/** n-grain Voronoi tessellation of the unit disc with random (uniform) orientations. Deterministic per seed. */
export function makeMicrostructure(n: number, seed: number): Grain[] {
  const r = rng(seed);
  // best-candidate (Mitchell) sampling: evenly spread seeds, some near the rim
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    let bx = 0;
    let by = 0;
    let bd = -1;
    for (let k = 0; k < 14; k++) {
      const rr = Math.sqrt(r()) * 0.97;
      const th = r() * 2 * Math.PI;
      const x = rr * Math.cos(th);
      const y = rr * Math.sin(th);
      let dmin = Infinity;
      for (let j = 0; j < pts.length; j += 2) dmin = Math.min(dmin, (x - pts[j]) ** 2 + (y - pts[j + 1]) ** 2);
      if (dmin > bd) {
        bd = dmin;
        bx = x;
        by = y;
      }
    }
    pts.push(bx, by);
  }
  const disc: number[] = [];
  const NSEG = 72;
  for (let k = 0; k < NSEG; k++) disc.push(Math.cos((2 * Math.PI * k) / NSEG), Math.sin((2 * Math.PI * k) / NSEG));
  const grains: Grain[] = [];
  for (let i = 0; i < n; i++) {
    const sx = pts[2 * i];
    const sy = pts[2 * i + 1];
    let poly = disc.slice();
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const ox = pts[2 * j];
      const oy = pts[2 * j + 1];
      const nx = ox - sx;
      const ny = oy - sy;
      const c = nx * (sx + ox) * 0.5 + ny * (sy + oy) * 0.5;
      poly = clipHalfPlane(poly, nx, ny, c);
    }
    // shoelace area + centroid
    let A = 0;
    let cx = 0;
    let cy = 0;
    const m = poly.length / 2;
    for (let k = 0; k < m; k++) {
      const x0 = poly[2 * k];
      const y0 = poly[2 * k + 1];
      const x1 = poly[2 * ((k + 1) % m)];
      const y1 = poly[2 * ((k + 1) % m) + 1];
      const cr = x0 * y1 - x1 * y0;
      A += cr;
      cx += (x0 + x1) * cr;
      cy += (y0 + y1) * cr;
    }
    A /= 2;
    cx /= 6 * A;
    cy /= 6 * A;
    const U = randomRotation(r);
    const ax = gauss(r);
    const ay = gauss(r);
    const az = gauss(r);
    const an = Math.hypot(ax, ay, az) || 1;
    const sub = new Float64Array(12);
    for (let k = 0; k < 12; k++) sub[k] = gauss(r);
    grains.push({ id: i, sx, sy, cx, cy, poly: new Float64Array(poly), area: A / Math.PI, U, ipf: ipfColor(U), rotAxis: [ax / an, ay / an, az / an], sub });
  }
  return grains;
}

/** index of the Voronoi cell containing (x, y) (nearest seed) */
export function grainAt(grains: Grain[], x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  for (const g of grains) {
    const d = (x - g.sx) ** 2 + (y - g.sy) ** 2;
    if (d < bd) {
      bd = d;
      best = g.id;
    }
  }
  return best;
}
