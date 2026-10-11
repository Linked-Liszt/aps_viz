/**
 * Physics for the "coherence" station (CHEX 28-ID + facility story): transverse coherence of undulator
 * radiation on the pre-upgrade APS vs APS-U, and a Young's double-slit test of it.
 *
 * Model in the Gaussian approximation. Sources are K.-J. Kim, AIP Conf. Proc. 184, 565 (1989) and X-ray Data Booklet §2.1:
 *   λ [m]          = 12.398 419 843 keV·Å / E                       (hc)
 *   single electron σ_r = √(2λL) / 4π ,  σ_r' = √(λ / 2L)            (σ_r σ_r' = λ/4π, the photon "emittance")
 *   photon source   Σ² = σ_e² + σ_r² ,   Σ'² = σ_e'² + σ_r'²          (per plane, electron ⊕ single-electron mode)
 *   coherent frac.  f_x = (λ/4π) / (Σ_x Σ'_x) ,  f = f_x · f_y          (≤ 1 automatically)
 *   Behaviour: when ε_e ≫ λ/4π, f_i ≈ (λ/4π)/ε_i ∝ 1/E, so f ∝ 1/E² once both planes are emittance-dominated;
 *   the APS-U / APS gain f_new/f_old ≈ Π ε_old/(ε_new + λ/4π)-ish, i.e. it GROWS with energy toward the
 *   emittance ratio because at low energy APS-U is already close to the diffraction limit λ/4π.
 *
 * Transverse coherence length at distance Z. Gaussian Schell model (GSM) of the photon source with rms size Σ and
 * divergence Σ' (Vartanyants & Singer, New J. Phys. 12, 035004 (2010); Mandel & Wolf §5.6.4):
 *   |μ₁₂(d)| = exp(−d² / 2ξ²)                                             (rms convention; others differ by ~π/√2)
 *   GSM source: Σ'² = (1/k²)(1/4Σ² + 1/ξ₀²)  ⇒  f = (λ/4π)/(ΣΣ') = q/√(q² + 4)  with q = ξ₀/Σ, i.e. the
 *   "global degree of coherence" ζ of the GSM IS the coherent fraction above; inverting, q = 2f/√(1 − f²).
 *   Free propagation keeps ξ/Σ fixed:  Σ(Z) = √(Σ² + Σ'²Z²),  ξ(Z) = q·Σ(Z)                       (exact in the GSM)
 *   Far field (Z ≫ Σ/Σ') and f ≪ 1: ξ → λZ/(2πΣ), the van Cittert–Zernike result for an incoherent source.
 *   The far-field form is NOT used: at Z = 20–45 m it underestimates ξ of the old APS horizontally by 56–13 %
 *   (Σ/Σ' = 25 m there) and of the APS-U flat-beam vertical plane by up to 32 % at 5 keV (f_y ≈ 0.66).
 *
 * Young's double-slit test uses a quasi-homogeneous field, Fraunhofer diffraction and uniform illumination of both slits:
 *   I(θ) ∝ ∫ C(s) μ(s) cos(k θ s) ds ,  C = aperture autocorrelation of two slits (width a, centres ±d/2)
 *        = 2Λ(s) + Λ(s−d) + Λ(s+d) ,  Λ(t) = max(0, a − |t|)
 *   In fringe-order units u = θ d / λ the pattern depends only on ξ/d and a/d. For a ≪ ξ:
 *   I ∝ sinc²(π a θ/λ)·[1 + |μ₁₂| cos(2π d θ/λ)] and the fringe visibility V = |μ₁₂(d)|.
 *   The station uses a = d/4 (stated in the UI) and evaluates the integral numerically (no a ≪ ξ assumption).
 *
 * Source parameters from research dossier facility.json. Values are rms at the ID source point and zero current:
 *   APS 2019 (7 GeV, ε_x 3.1 nm·rad, ε_y 40 pm, ~1.3 % coupling): σ_x 275 µm, σ_x' 11 µrad, σ_y 10 µm, σ_y' 3.5 µrad
 *. APS-U FDR (2019) Table 2.1 (Table 1.1 gives 280 µm / 11.6 µrad).
 *   APS-U round beam (κ = 1, the user-operation mode since 2025): σ_x 12.3 µm, σ_x' 2.34 µrad, σ_y 8.26 µm,
 *     σ_y' 3.47 µrad, ε_x = ε_y = 28.7 pm. APS-U storage-ring parameters 2024, Table 5.
 *   APS-U flat beam (κ = 0.1): σ_x 14.5 µm, σ_x' 2.75 µrad, σ_y 3.08 µm, σ_y' 1.29 µrad, ε 39.7 / 3.98 pm. Same table.
 *   Undulator length L = 2.4 m for both rings (APS standard device length; the facility dossier's
 *   "coherentFractionEstimate" uses the same model and reproduces: 10 keV → 0.046 % APS, 2.7 % round, 6.0 % flat).
 *   CHEX (28-ID) energies and distances: chex.json. Fixed branches 15 keV (D/E), 25/35 keV (F), 75/105 keV (G);
 *   instrument positions D 35.5 m, F/1 45.5 m, G/1 52.0 m, B 64.5 m, C 72.0 m (FDR Table 4.5); its interim
 *   canted HPMUs are 2.07 m long (APS-U f lower by 4–11 % than with 2.4 m over 5–105 keV. Stated, not plotted).
 *
 * Approximations stated in the station's notes: Gaussian beams, zero current and omitted energy spread. σ_δ = 0.136 %
 * (APS-U), 0.095 % (APS) inflates σ_r' by Q_a(x), x = 2πnNσ_δ (Tanaka & Kitamura, JSR 16, 380 (2009),
 * Q_a(x) = [2x² / (−1 + e^{−2x²} + √(2π)·x·erf(√2·x))]^{1/2}): Q_a ≈ 1.7 for APS-U at n = 5, N = 74 (CHEX 25 keV),
 * ≈ 1.2 for APS at n = 3, N = 72. So f falls below the curves from the 3rd–5th harmonic up, more for APS-U.
 * Kim's σ_r (Onuki–Elleaume / Tanaka–Kitamura fits give a ~2× larger σ_r, lowering f near the diffraction limit).
 * Reality check: SRW wave-optics design studies for two APS-U feature beamlines (FDR Ch. 4, Tables 4.41 / 4.51,
 * design source incl. Energy spread) give 4.2–5.6 % at 10 keV and 0.54–0.94 % at 25 keV, vs 2.7 / 6.0 % and
 * 0.80 / 2.2 % (round / flat) here. Read the APS-U curves as an idealised upper bound at high energy.
 * Unfocused beam (ideal optics preserve f and ξ/Σ_Z).
 */

export const HC_KEV_M = 12.398419843e-10; // keV·m
export const UNDULATOR_LENGTH_M = 2.4;

/** Wavelength in metres for a photon energy in keV. */
export function wavelength(EkeV: number): number {
  return HC_KEV_M / EkeV;
}

/** Photon "emittance" λ/4π (m·rad). The diffraction limit of a single transverse mode. */
export function diffractionLimit(EkeV: number): number {
  return wavelength(EkeV) / (4 * Math.PI);
}

export interface PlaneBeam {
  /** rms electron beam size at the ID source point, m */
  size: number;
  /** rms electron beam divergence, rad */
  div: number;
  /** cited emittance, m·rad (for display; the model uses size·div implicitly) */
  emit: number;
}

export type RingId = 'aps' | 'round' | 'flat';

export interface Ring {
  id: RingId;
  /** display name */
  name: string;
  energyGeV: number;
  x: PlaneBeam;
  y: PlaneBeam;
  source: string;
}

export const APS_2019: Ring = {
  id: 'aps',
  name: 'APS before upgrade',
  energyGeV: 7,
  x: { size: 275e-6, div: 11e-6, emit: 3100e-12 },
  y: { size: 10e-6, div: 3.5e-6, emit: 40e-12 },
  source: 'APS-U FDR (2019) Table 2.1',
};

export const APSU_ROUND: Ring = {
  id: 'round',
  name: 'APS-U, round beam',
  energyGeV: 6,
  x: { size: 12.3e-6, div: 2.34e-6, emit: 28.7e-12 },
  y: { size: 8.26e-6, div: 3.47e-6, emit: 28.7e-12 },
  source: 'APS-U storage-ring parameters (2024) Table 5, κ = 1, zero current',
};

export const APSU_FLAT: Ring = {
  id: 'flat',
  name: 'APS-U, flat beam',
  energyGeV: 6,
  x: { size: 14.5e-6, div: 2.75e-6, emit: 39.7e-12 },
  y: { size: 3.08e-6, div: 1.29e-6, emit: 3.98e-12 },
  source: 'APS-U storage-ring parameters (2024) Table 5, κ = 0.1, zero current',
};

/** Single-electron (one-mode) undulator radiation size and divergence, Kim's Gaussian approximation. */
export function singleElectron(lambda: number, L = UNDULATOR_LENGTH_M): { size: number; div: number } {
  return { size: Math.sqrt(2 * lambda * L) / (4 * Math.PI), div: Math.sqrt(lambda / (2 * L)) };
}

export interface PhotonPlane {
  /** Σ, m */
  size: number;
  /** Σ', rad */
  div: number;
  /** coherent fraction of this plane, (λ/4π)/(ΣΣ') */
  f: number;
}

export function photonPlane(e: PlaneBeam, lambda: number, L = UNDULATOR_LENGTH_M): PhotonPlane {
  const r = singleElectron(lambda, L);
  const size = Math.hypot(e.size, r.size);
  const div = Math.hypot(e.div, r.div);
  return { size, div, f: lambda / (4 * Math.PI) / (size * div) };
}

export interface Coherence {
  E: number;
  lambda: number;
  x: PhotonPlane;
  y: PhotonPlane;
  /** f_x · f_y */
  f: number;
}

export function coherence(ring: Ring, EkeV: number, L = UNDULATOR_LENGTH_M): Coherence {
  const lambda = wavelength(EkeV);
  const x = photonPlane(ring.x, lambda, L);
  const y = photonPlane(ring.y, lambda, L);
  return { E: EkeV, lambda, x, y, f: x.f * y.f };
}

/** Far-field (van Cittert–Zernike, incoherent source) rms coherence length ξ = λZ/(2πΣ); limit of coherenceLengthGSM. */
export function coherenceLength(lambda: number, Z: number, sigma: number): number {
  return (lambda * Z) / (2 * Math.PI * sigma);
}

/** GSM ratio q = ξ/Σ (constant along free propagation) from the coherent fraction f = q/√(q²+4) of the plane. */
export function gsmQ(f: number): number {
  const ff = Math.min(f, 0.999999);
  return (2 * ff) / Math.sqrt(1 - ff * ff);
}

/** rms transverse coherence length at distance Z (m) from the source of one plane, Gaussian Schell model:
 *  ξ(Z) = q·Σ(Z) with Σ(Z) = √(Σ² + Σ'²Z²). Tends to λZ/(2πΣ) in the far field when f ≪ 1. */
export function coherenceLengthGSM(ph: PhotonPlane, Z: number): number {
  return gsmQ(ph.f) * beamSizeAt(ph.size, ph.div, Z);
}

/** |μ₁₂| for two points a distance d apart, Gaussian Schell / van Cittert–Zernike. */
export function degreeOfCoherence(d: number, xi: number): number {
  return Math.exp(-(d * d) / (2 * xi * xi));
}

/** rms beam size at distance Z (free propagation from a waist). */
export function beamSizeAt(sigma: number, sigmaP: number, Z: number): number {
  return Math.hypot(sigma, sigmaP * Z);
}

// ------------------------------------------------------------------ Young's double slit

/** Slit width as a fraction of the slit separation (fixed in the station; stated in the UI). */
export const SLIT_WIDTH_OVER_D = 0.25;

const NQ = 96; // quadrature points per region (midpoint rule)

/**
 * Far-field double-slit intensity for partially coherent illumination.
 * out[i] is I(u_i) with u_i = −uMax + 2·uMax·i/(n−1) in fringe orders (u = θd/λ); ξ and a in units of d.
 * Returns the integral normalisation-free pattern (fully coherent peak = 1 for a = 0.25, ξ → ∞, up to rounding).
 */
export function youngPattern(out: Float32Array | Float64Array, xiOverD: number, uMax: number, aOverD = SLIT_WIDTH_OVER_D): void {
  const n = out.length;
  const a = aOverD;
  const inv2xi2 = 1 / (2 * xiOverD * xiOverD);
  // quadrature nodes s_j and weights w_j = C(s_j) μ(s_j) Δs (midpoint rule), computed once
  let m = 0;
  // region 1: |s| < a, weight 2Λ(s); μ is negligible beyond ~7ξ
  const s1max = Math.min(a, 7 * xiOverD);
  const h1 = s1max / NQ;
  for (let j = 0; j < NQ; j++) {
    const sj = (j + 0.5) * h1;
    QS[m] = sj;
    QW[m++] = 2 * (a - sj) * Math.exp(-sj * sj * inv2xi2) * h1;
  }
  // region 2: s ∈ [1−a, 1+a], weight Λ(s−1) (only if μ there is non-negligible)
  if (Math.exp(-(1 - a) * (1 - a) * inv2xi2) > 1e-9) {
    const h2 = (2 * a) / NQ;
    for (let j = 0; j < NQ; j++) {
      const sj = 1 - a + (j + 0.5) * h2;
      QS[m] = sj;
      QW[m++] = (a - Math.abs(sj - 1)) * Math.exp(-sj * sj * inv2xi2) * h2;
    }
  }
  if (ACC.length < n) ACC = new Float64Array(n);
  const acc = ACC;
  acc.fill(0, 0, n);
  const du = n > 1 ? (2 * uMax) / (n - 1) : 0;
  const u0 = n > 1 ? -uMax : 0;
  // Σ_j w_j cos(2π u_i s_j) on a uniform u grid: angle advances by a constant step → rotation recurrence
  for (let j = 0; j < m; j++) {
    const w = QW[j];
    if (w === 0) continue;
    const k = 2 * Math.PI * QS[j];
    let c = Math.cos(k * u0);
    let sn = Math.sin(k * u0);
    const cd = Math.cos(k * du);
    const sd = Math.sin(k * du);
    for (let i = 0; i < n; i++) {
      acc[i] += w * c;
      const c2 = c * cd - sn * sd;
      sn = sn * cd + c * sd;
      c = c2;
    }
  }
  // integrand is even in s: ∫_{−∞}^{∞} = 2∫_0^∞ ; fully coherent value at u = 0 is 2·[a² + a²] = 4a²
  const norm = 2 / (4 * a * a);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, acc[i] * norm);
}

const QS = new Float64Array(2 * NQ);
const QW = new Float64Array(2 * NQ);
let ACC = new Float64Array(512);

/**
 * Fringe visibility of the double-slit pattern near the axis: amplitude of the cos(2πu) cross term relative to
 * the mean (the two single-slit "auto" terms), V = ∫(Λ(s−d)+Λ(s+d))μ ds / ∫2Λ(s)μ ds. Equals |μ₁₂(d)| for a ≪ ξ and
 * differs slightly when ξ is comparable to the slit width (μ then also varies across each slit).
 */
export function centralVisibility(xiOverD: number, aOverD = SLIT_WIDTH_OVER_D): number {
  const a = aOverD;
  const inv2xi2 = 1 / (2 * xiOverD * xiOverD);
  const h = a / NQ;
  let auto = 0;
  let cross = 0;
  for (let j = 0; j < NQ; j++) {
    const s = (j + 0.5) * h; // 0..a
    auto += 2 * (a - s) * Math.exp(-s * s * inv2xi2);
    const s1 = 1 - a + s;
    const s2 = 1 + s;
    cross += s * Math.exp(-s1 * s1 * inv2xi2) + (a - s) * Math.exp(-s2 * s2 * inv2xi2);
  }
  // auto: ∫_{−a}^{a} 2Λμ = 2·∫_0^a 2(a−s)μ ; cross: 2·∫_{1−a}^{1+a} Λ(s−1)μ (both sides)
  auto *= 2 * h;
  cross *= 2 * h;
  return auto > 0 ? Math.min(1, cross / auto) : 0;
}

// ------------------------------------------------------------------ CHEX

export interface ChexStop {
  id: string;
  /** branch / station label */
  station: string;
  E: number;
  /** instrument distance from the straight-section centre, m */
  Z: number;
  what: string;
}

/** CHEX fixed-energy instrument positions (chex.json keyParameters; FDR Table 4.5 path lengths). */
export const CHEX_STOPS: ChexStop[] = [
  { id: 'd15', station: '28-ID-D', E: 15, Z: 35.5, what: 'pulsed-laser deposition' },
  { id: 'f25', station: '28-ID-F', E: 25, Z: 45.5, what: 'chemical vapour deposition' },
  { id: 'f35', station: '28-ID-F', E: 35, Z: 45.5, what: 'chemical vapour deposition' },
  { id: 'g75', station: '28-ID-G', E: 75, Z: 52.0, what: 'high-energy diffraction' },
  { id: 'g105', station: '28-ID-G', E: 105, Z: 52.0, what: 'high-energy diffraction' },
];

/** Named positions along the CHEX beamline for the distance readout. */
export const CHEX_POSITIONS: { name: string; Z: number }[] = [
  { name: '28-ID-D', Z: 35.5 },
  { name: '28-ID-E', Z: 43.0 },
  { name: '28-ID-F', Z: 45.5 },
  { name: '28-ID-F/2', Z: 49.5 },
  { name: '28-ID-G', Z: 52.0 },
  { name: '28-ID-G/2', Z: 56.0 },
  { name: '28-ID-B', Z: 64.5 },
  { name: '28-ID-C', Z: 72.0 },
];

export function nearestChexPosition(Z: number): { name: string; Z: number } | null {
  let best: { name: string; Z: number } | null = null;
  for (const p of CHEX_POSITIONS) if (Math.abs(p.Z - Z) < 0.6 && (!best || Math.abs(p.Z - Z) < Math.abs(best.Z - Z))) best = p;
  return best;
}

/** CHEX sector energy range (feature-beamline page: 5–104 keV; fixed branches 15–105 keV). */
export const CHEX_BAND = { min: 15, max: 105 };
