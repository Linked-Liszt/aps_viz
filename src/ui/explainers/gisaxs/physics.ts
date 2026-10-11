/**
 * Grazing-incidence X-ray optics for the "Grazing-incidence surface scattering" station (CSSI, APS 9-ID).
 * Pure functions only without DOM access, unit-tested in tests/gisaxs.test.ts.
 *
 * Equations (small-angle forms where noted):
 *   λ[nm] = hc/E = 1.2398420 / E[keV]                        k = 2π/λ
 *   n = 1 − δ + iβ
 *   δ = r_e λ² ρ_e / (2π)                                    (ρ_e = electron density; f′ dispersion neglected:
 *                                                              for Si/C above 6 keV f′/Z ≲ 3 %, i.e. ≲ 1.5 % in α_c)
 *   β = λ μ / (4π)                                           (μ = linear attenuation, NIST XCOM total, log-log interp.)
 *   α_c ≈ √(2δ)                                              (critical angle for total external reflection)
 *   k_z,1 = k √(sin²α − 2δ + 2iβ)                           (z-wavevector in the medium, principal root, Im ≥ 0)
 *   r = (sin α − √(…)) / (sin α + √(…)),  t = 2 sin α / (sin α + √(…))   (Fresnel, single interface; s≈p at grazing)
 *   Λ_1/e = 1 / (2 Im k_z,1)                                 (1/e INTENSITY penetration depth; identical to Dosch's
 *         = λ / (2√2 π) · [√((α²−α_c²)² + 4β²) − (α²−α_c²)]^(−1/2)   small-angle closed form, PRB 35, 2137 (1987))
 *         → λ/(4π α_c) for α ≪ α_c (a few nm),   → sin α / μ for α ≫ α_c (µm–mm)
 *   footprint = h_beam / sin α_i
 *
 *   Distorted-wave Born approximation for islands on a substrate (Rauscher et al. PRB 52, 16855 (1995);
 *   Lazzari, J. Appl. Cryst. 35, 406 (2002); Renaud, Lazzari & Leroy, Surf. Sci. Rep. 64, 255 (2009)):
 *     F_DWBA = F(q∥, p_f+p_i) + R_i F(q∥, p_f−p_i) + R_f F(q∥, p_i−p_f) + R_i R_f F(q∥, −p_f−p_i),
 *     p = k sin α.  For islands much thinner than 1/q_z this → T_i T_f F(q∥, 0):
 *     the |T(α_f)|² factor peaks at α_f = α_c → the Yoneda band (Yoneda, Phys. Rev. 131, 2010 (1963)).
 *
 * Materials: Si (2.329 g/cm³, ρ_e = 0.699 e/Å³) and polystyrene (C8H8)n (1.05 g/cm³, ρ_e = 0.340 e/Å³).
 * μ/ρ from NIST (Hubbell & Seltzer, X-ray mass attenuation coefficients); PS = 92.26 wt% C + 7.74 wt% H.
 */

export const R_E_NM = 2.8179403262e-6; // classical electron radius [nm]
export const HC_KEV_NM = 1.239841984; // h·c [keV·nm]
export const N_A = 6.02214076e23;
export const DEG = Math.PI / 180;

export interface Material {
  id: 'si' | 'ps';
  name: string;
  /** mass density [g/cm³] */
  density: number;
  /** electrons per formula unit (Z sum) */
  electrons: number;
  /** molar mass of the formula unit [g/mol] */
  molarMass: number;
  /** [E keV, μ/ρ cm²/g] (NIST total attenuation) */
  muRho: ReadonlyArray<readonly [number, number]>;
}

// NIST X-ray mass attenuation coefficients (total, with coherent scattering), cm²/g.
const SI_MU: ReadonlyArray<readonly [number, number]> = [
  [5, 245.3],
  [6, 146.4],
  [8, 65.33],
  [10, 33.89],
  [15, 10.34],
  [20, 4.464],
  [30, 1.436],
  [40, 0.7012],
];
const C_MU = [19.12, 10.95, 4.576, 2.373, 0.8071, 0.442, 0.2562, 0.2076];
const H_MU = [0.4, 0.4, 0.395, 0.3854, 0.3764, 0.3695, 0.357, 0.3458];
const E_TAB = [5, 6, 8, 10, 15, 20, 30, 40];
const PS_MU: ReadonlyArray<readonly [number, number]> = E_TAB.map((e, i) => [e, 0.9226 * C_MU[i] + 0.0774 * H_MU[i]] as const);

export const SILICON: Material = { id: 'si', name: 'Silicon', density: 2.329, electrons: 14, molarMass: 28.0855, muRho: SI_MU };
export const POLYSTYRENE: Material = { id: 'ps', name: 'Polystyrene', density: 1.05, electrons: 56, molarMass: 104.15, muRho: PS_MU };

export function wavelengthNm(EkeV: number): number {
  return HC_KEV_NM / EkeV;
}

export function waveNumber(EkeV: number): number {
  return (2 * Math.PI) / wavelengthNm(EkeV);
}

/** electrons per nm³ */
export function electronDensity(m: Material): number {
  return ((m.density * N_A) / m.molarMass) * m.electrons * 1e-21;
}

/** μ/ρ [cm²/g] by log-log interpolation of the NIST table */
export function massAttenuation(m: Material, EkeV: number): number {
  const t = m.muRho;
  if (EkeV <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (EkeV <= t[i][0]) {
      const [e0, m0] = t[i - 1];
      const [e1, m1] = t[i];
      const f = Math.log(EkeV / e0) / Math.log(e1 / e0);
      return Math.exp(Math.log(m0) + f * Math.log(m1 / m0));
    }
  }
  return t[t.length - 1][1];
}

export interface Optics {
  delta: number;
  beta: number;
  /** critical angle [rad] */
  alphaC: number;
  /** linear attenuation [1/nm] */
  mu: number;
  lambda: number;
}

export function optics(m: Material, EkeV: number): Optics {
  const lambda = wavelengthNm(EkeV);
  const delta = (R_E_NM * lambda * lambda * electronDensity(m)) / (2 * Math.PI);
  const mu = massAttenuation(m, EkeV) * m.density * 1e-7; // cm⁻¹ → nm⁻¹
  const beta = (lambda * mu) / (4 * Math.PI);
  return { delta, beta, alphaC: Math.sqrt(2 * delta), mu, lambda };
}

/** principal complex square root, written into out [re, im] (Im ≥ 0 for Im(z) ≥ 0) */
export function csqrt(re: number, im: number, out: [number, number] = [0, 0]): [number, number] {
  const r = Math.hypot(re, im);
  const a = Math.sqrt(Math.max(0, (r + re) / 2));
  let b = Math.sqrt(Math.max(0, (r - re) / 2));
  if (im < 0) b = -b;
  out[0] = a;
  out[1] = b;
  return out;
}

export interface Fresnel {
  /** amplitude reflection coefficient */
  rRe: number;
  rIm: number;
  /** amplitude transmission coefficient (t = 1 + r) */
  tRe: number;
  tIm: number;
  /** |r|² */
  R: number;
  /** |t|² */
  T2: number;
  /** normalised z-wavevector in the medium √(sin²α − 2δ + 2iβ) */
  wRe: number;
  wIm: number;
}

const _w: [number, number] = [0, 0];
/** Fresnel coefficients of a single vacuum/medium interface at grazing angle α (rad). */
export function fresnel(alpha: number, delta: number, beta: number): Fresnel {
  const s = Math.sin(alpha);
  csqrt(s * s - 2 * delta, 2 * beta, _w);
  const [wr, wi] = _w;
  // r = (s − w)/(s + w)
  const nr = s - wr;
  const ni = -wi;
  const dr = s + wr;
  const di = wi;
  const dd = dr * dr + di * di || 1e-300;
  const rRe = (nr * dr + ni * di) / dd;
  const rIm = (ni * dr - nr * di) / dd;
  const tRe = 1 + rRe;
  const tIm = rIm;
  return { rRe, rIm, tRe, tIm, R: rRe * rRe + rIm * rIm, T2: tRe * tRe + tIm * tIm, wRe: wr, wIm: wi };
}

/** 1/e intensity penetration depth [nm] at grazing angle α (rad), exact single-interface form. */
export function penetrationDepth(alpha: number, o: Optics): number {
  const s = Math.sin(alpha);
  csqrt(s * s - 2 * o.delta, 2 * o.beta, _w);
  return o.lambda / (4 * Math.PI * Math.max(_w[1], 1e-300));
}

/** Dosch's small-angle closed form (for cross-checking the exact form). */
export function penetrationDepthDosch(alpha: number, o: Optics): number {
  const a2 = alpha * alpha - o.alphaC * o.alphaC;
  return o.lambda / (2 * Math.SQRT2 * Math.PI) / Math.sqrt(Math.sqrt(a2 * a2 + 4 * o.beta * o.beta) - a2);
}

/** Refraction angle inside the medium (rad): Re √(α² − α_c²). Zero (evanescent) below α_c. */
export function refractedAngle(alpha: number, o: Optics): number {
  const s = Math.sin(alpha);
  csqrt(s * s - 2 * o.delta, 2 * o.beta, _w);
  return Math.asin(Math.min(1, _w[0]));
}

/** Length of the beam footprint on the sample (same units as beam height). */
export function footprint(beamHeight: number, alpha: number): number {
  return beamHeight / Math.sin(alpha);
}

/**
 * Field intensity |E(z)|² (incident amplitude 1) at height z [nm] (z>0 vacuum, z<0 inside the substrate):
 * above: |1 + r e^{2i p z}|² (standing wave, period λ / (2 sin α)); below: |t|² e^{−|z|/Λ}.
 */
export function fieldIntensity(z: number, alpha: number, k: number, f: Fresnel, lambdaPen: number): number {
  if (z >= 0) {
    const ph = 2 * k * Math.sin(alpha) * z;
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    const re = 1 + f.rRe * c - f.rIm * s;
    const im = f.rRe * s + f.rIm * c;
    return re * re + im * im;
  }
  return f.T2 * Math.exp(z / lambdaPen);
}

/**
 * DWBA vertical coefficients for a stack of K horizontal slices (islands on the substrate):
 * c_l = Σ_t a_t ∫_{z_l}^{z_l+Δh} e^{i q_t z} dz with (a_t, q_t) = (1, p_i+p_f), (R_i, p_f−p_i), (R_f, p_i−p_f),
 * (R_i R_f, −p_i−p_f). Writes Re/Im into cRe/cIm (length K). Units: nm.
 */
export function dwbaSliceCoeffs(
  pi: number,
  pf: number,
  ri: Fresnel,
  rf: Fresnel,
  K: number,
  dh: number,
  cRe: Float64Array,
  cIm: Float64Array,
): void {
  const aRe0 = 1;
  const aIm0 = 0;
  const aRe1 = ri.rRe;
  const aIm1 = ri.rIm;
  const aRe2 = rf.rRe;
  const aIm2 = rf.rIm;
  const aRe3 = ri.rRe * rf.rRe - ri.rIm * rf.rIm;
  const aIm3 = ri.rRe * rf.rIm + ri.rIm * rf.rRe;
  const q0 = pi + pf;
  const q1 = pf - pi;
  const q2 = pi - pf;
  const q3 = -pi - pf;
  for (let l = 0; l < K; l++) {
    const zc = (l + 0.5) * dh;
    let re = 0;
    let im = 0;
    // term helper inlined 4× for speed
    let q = q0;
    let sc = sinc((q * dh) / 2) * dh;
    let c = Math.cos(q * zc) * sc;
    let s = Math.sin(q * zc) * sc;
    re += aRe0 * c - aIm0 * s;
    im += aRe0 * s + aIm0 * c;
    q = q1;
    sc = sinc((q * dh) / 2) * dh;
    c = Math.cos(q * zc) * sc;
    s = Math.sin(q * zc) * sc;
    re += aRe1 * c - aIm1 * s;
    im += aRe1 * s + aIm1 * c;
    q = q2;
    sc = sinc((q * dh) / 2) * dh;
    c = Math.cos(q * zc) * sc;
    s = Math.sin(q * zc) * sc;
    re += aRe2 * c - aIm2 * s;
    im += aRe2 * s + aIm2 * c;
    q = q3;
    sc = sinc((q * dh) / 2) * dh;
    c = Math.cos(q * zc) * sc;
    s = Math.sin(q * zc) * sc;
    re += aRe3 * c - aIm3 * s;
    im += aRe3 * s + aIm3 * c;
    cRe[l] = re;
    cIm[l] = im;
  }
}

export function sinc(x: number): number {
  return Math.abs(x) < 1e-6 ? 1 - (x * x) / 6 : Math.sin(x) / x;
}

/** Speckle size on a detector at distance D for an illuminated width d (all SI or consistent units): s ≈ λD/d. */
export function speckleSize(lambda: number, D: number, d: number): number {
  return (lambda * D) / d;
}

/** In-plane momentum transfer along the beam for a detector pixel in the plane of incidence (2θ_f = 0). */
export function qx(k: number, alphaI: number, alphaF: number): number {
  return k * (Math.cos(alphaF) - Math.cos(alphaI));
}
