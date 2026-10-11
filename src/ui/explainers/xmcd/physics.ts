/**
 * XMCD station physics. Pure functions, no DOM covered by tests/xmcd.test.ts.
 *
 * 1. Polarization: diamond Bragg-transmission phase retarder at POLAR
 *    The two undulators at 4-ID are planar, so the source is linear-horizontal (LH). A thin diamond crystal set a
 *    small angle Δθ off its Bragg angle, with its scattering plane at 45° to the incident polarization, delays the
 *    π component relative to σ by (asymptotic dynamical theory, valid for |Δθ| ≫ Darwin width)
 *        δ(Δθ) = (π/2) · Δθ_q / Δθ,
 *        Δθ_q  = 2 t cosθ_B r_e² λ³ Re(F_h F_h̄) / (π² V²)        (quarter-wave offset)
 *. The form used in APS 4-ID-POLAR's Pharet calculator (POLAR research dossier, interactive idea 1); C(111),
 *    t = 0.5 mm, 10 keV gives Δθ_q ≈ 2×10⁻⁴ rad ≈ 42″. Atomic form factor of C from the Cromer–Mann fit
 *    (International Tables for Crystallography Vol. C, Table 6.1.1.4); f′ ≈ 0, static lattice (no Debye–Waller).
 *    Output Jones vector for LH input, plate axes σ̂ = (x̂+ŷ)/√2, π̂ = (−x̂+ŷ)/√2:
 *        E = ((1+e^{iδ})/2, (1−e^{iδ})/2)  ⇒  Stokes P_lin(H−V) = cos δ,  P_circ = −sin δ.
 *    δ = 0: LH; δ = ∓π/2: circular (sign of Δθ picks the helicity); δ = π (two quarter-wave plates): LV.
 *    Sign: with Δθ = θ − θ_B, the two-beam dispersion far from Bragg gives the forward wave an extra wave-vector
 *    ε₀ = k C² χ_hχ_h̄ / (2α), α = −2Δθ sin2θ_B, C = 1 (σ) or cos2θ_B (π); so on the high-angle side (Δθ > 0) π lags
 *    σ (δ > 0 → negative helicity for σ̂ at +45°) and the low-angle side gives positive helicity. Which side is
 *    "left" in a real tank depends on the sense of the 45° tilt, so the UI calls the mapping geometry-dependent.
 *    Helicity convention: P_circ > 0 = positive helicity (photon spin ∥ k) = E rotating counter-clockwise when
 *    viewed facing the oncoming beam = "left-circular" in the optics (Born & Wolf) convention; its snapshot in space
 *    is a left-handed screw. POLAR numbers (dossier, refs r7, r12, r15): P_c ≈ 0.98, LV P_lin ≈ −0.80…−0.95,
 *    piezo helicity flipping ≈ 13–15 Hz with lock-in detection, phase plates usable ≈ 2.7–14 keV.
 *
 * 2. Magnet: L1₀ FePt (the granular "heat-assisted magnetic recording" alloy), probed at the Pt L₃ / L₂ edges.
 *    Why Pt L₂,₃: 2p → 5d dipole transitions probe the 5d shell that carries the (induced) Pt moment, so the
 *    Thole–Carra sum rules apply directly (unlike 3d K edges or rare-earth L edges, where the probed 4p / 5d states
 *    are only spectators); L₃ = 11.564 keV and L₂ = 13.273 keV (X-ray Data Booklet) both lie inside POLAR's
 *    2.7–27 keV range and below the ≈14 keV phase-plate limit; Pt alone is non-magnetic, so the signal is a clean
 *    demonstration of element specificity.
 *    • Spontaneous magnetization: Weiss mean field, m = B_J(3J/(J+1) · m/t + g μ_B J B/(k_B T)), t = T/T_C,
 *      J = 3/2 (≈ Fe spin moment), T_C = 750 K (bulk L1₀ FePt; films / particles lower). Solved by Newton's method
 *      from m = 1 (monotone, since B_J is concave for x > 0). Mean-field caveats: β = ½ (real ≈ 0.35), no spin-wave
 *      T^{3/2} fall-off at low T.
 *    • Hysteresis: a Preisach / Stoner–Wohlfarth ensemble of N independent uniaxial grains with switching fields
 *      H_sw,i = H_c(T)·(1 + σ g_i) (g_i = normal quantiles, σ = 0.25). H_c(T) ∝ H_K ∝ K/M_s ∝ m^{1.1}, using the
 *      K ∝ M_s^{2.1} scaling of FePt (Okamoto et al. PRB 66, 024413 (2002); Mryasov et al. EPL 69, 805 (2005)).
 *      H_c(300 K) ≈ 3 T, typical of granular L1₀ FePt media. Illustrative. Grains heated above T_C lose their
 *      orientation; on cooling they freeze along the field, or at random in zero field (thermally demagnetized).
 *    • Pressure (ILLUSTRATIVE toy model, not FePt data): T_C(P) = T_C0 (1 − P/P*), moment ∝ √(1 − P/P*),
 *      P* = 150 GPa. Compression broadens the d bands and weakens exchange until the moment collapses.
 *
 * 3. Spectra with schematic lineshapes: each edge = arctan step + pseudo-Voigt "white line" (2p → 5d), normalized to
 *    an L₃ jump of 1 and an L₂ jump of ½ (statistical 2p₃/₂ : 2p₁/₂ ratio, the usual practice before applying the
 *    sum rules). The XMCD at each edge has the white-line shape with an AREA fixed by the sum rules
 *    (Thole et al. PRL 68, 1943 (1992); Carra et al. PRL 70, 694 (1993); practical form of Chen et al. PRL 75,
 *    152 (1995)):
 *        m_orb       = −4 q n_h / (3 r)
 *        m_spin,eff  = m_spin + 7⟨T_z⟩ term = −(6p − 4q) n_h / r
 *    with p = ∫_{L₃}(μ⁺−μ⁻), q = ∫_{L₃+L₂}(μ⁺−μ⁻), r = ∫_{L₃+L₂}(μ⁺+μ⁻) (white lines only), μ^± for photon spin
 *    parallel / antiparallel to the majority-spin direction (i.e. antiparallel / parallel to M). Inverted:
 *        A_{L₃} = p = −r (m_spin,eff + 3 m_orb) / (6 n_h),      A_{L₂} = q − p = r (2 m_spin,eff − 3 m_orb) / (12 n_h).
 *    Inputs (illustrative, of the order of DFT values for Pt in L1₀ FePt): m_spin,eff = 0.35 μ_B, m_orb = 0.05 μ_B,
 *    n_h = 1.7 5d holes. The resulting XMCD (≈7 % of the L₃ jump at saturation) follows self-consistently.
 *    In the lab frame the measured difference μ_L − μ_R = −P_c (M·k̂/M_s) Δμ^{±}, so it flips sign with M and
 *    vanishes with M; linear light measures the average (X-ray magnetic LINEAR dichroism is neglected).
 */

export const HC_KEV_A = 12.398419843; // hc, keV·Å
export const R_E = 2.8179403262e-15; // classical electron radius, m
export const ARCSEC = Math.PI / (180 * 3600);
const MUB_OVER_KB = 0.6717138; // μ_B / k_B, K/T

/** POLAR numbers from the research dossier (beamline directory r7, town hall r12). */
export const POLAR = {
  eMin: 2.7,
  eMax: 27,
  /** upper end of diamond phase-retarder operation, keV */
  phasePlateMax: 14,
  /** measured degree of circular polarization after the phase retarder */
  pc: 0.98,
  /** |P_lin| of linear-V from two plates: measured −0.80 (low E) … −0.95 (high E); ≈0.9 assumed near 11.6 keV */
  plinV: 0.9,
  /** piezo helicity modulation, Hz */
  flipHz: 15,
  /** 9-1-1 T vector magnet, field along the beam (4-ID-H) */
  bMax: 9,
  /** listed operational DAC pressure, GPa */
  pMax: 300,
  /** sample temperature range at 4-ID-H, K */
  tMin: 1.4,
  tMaxH: 300,
};

/** Pt absorption edges, keV (X-ray Data Booklet Table 1-1). */
export const PT_EDGES = { L3: 11.564, L2: 13.273 };

export const wavelengthA = (eKeV: number): number => HC_KEV_A / eKeV;

// ------------------------------------------------------------------ diamond phase retarder

export const DIAMOND_A = 3.56712; // lattice constant, Å

/** Cromer–Mann atomic form factor of carbon, s = sinθ/λ in Å⁻¹. */
export function carbonF(s: number): number {
  const a = [2.31, 1.02, 1.5886, 0.865];
  const b = [20.8439, 10.2075, 0.5687, 51.6512];
  const s2 = s * s;
  let f = 0.2156;
  for (let i = 0; i < 4; i++) f += a[i] * Math.exp(-b[i] * s2);
  return f;
}

/** |F_hkl|² of diamond (8 atoms per cubic cell) for f = 1, i.e. the geometric part (0, 32 or 64). */
export function diamondGeom2(h: number, k: number, l: number): number {
  const fcc = [
    [0, 0, 0],
    [0, 0.5, 0.5],
    [0.5, 0, 0.5],
    [0.5, 0.5, 0],
  ];
  let re = 0;
  let im = 0;
  for (const base of [
    [0, 0, 0],
    [0.25, 0.25, 0.25],
  ]) {
    for (const p of fcc) {
      const ph = 2 * Math.PI * (h * (p[0] + base[0]) + k * (p[1] + base[1]) + l * (p[2] + base[2]));
      re += Math.cos(ph);
      im += Math.sin(ph);
    }
  }
  return re * re + im * im;
}

export interface PhasePlate {
  /** Bragg angle, rad */
  thetaB: number;
  /** quarter-wave offset Δθ_q, rad */
  dThetaQ: number;
  /** Re(F_h F_h̄) */
  F2: number;
}

/** Quarter-wave offset of a diamond Bragg-transmission phase plate (Pharet form, see header). */
export function phasePlate(eKeV: number, thicknessM: number, hkl: [number, number, number] = [1, 1, 1]): PhasePlate {
  const lamA = wavelengthA(eKeV);
  const d = DIAMOND_A / Math.hypot(hkl[0], hkl[1], hkl[2]);
  const sinT = lamA / (2 * d);
  const thetaB = Math.asin(Math.min(1, sinT));
  const f = carbonF(1 / (2 * d));
  const F2 = diamondGeom2(hkl[0], hkl[1], hkl[2]) * f * f;
  const lam = lamA * 1e-10;
  const V = Math.pow(DIAMOND_A * 1e-10, 3);
  const dThetaQ = (2 * thicknessM * Math.cos(thetaB) * R_E * R_E * lam * lam * lam * F2) / (Math.PI * Math.PI * V * V);
  return { thetaB, dThetaQ, F2 };
}

/** Phase retardation δ (rad) at an offset Δθ from the Bragg angle (asymptotic, |Δθ| ≫ Darwin width). */
export const retardance = (dTheta: number, dThetaQ: number): number => ((Math.PI / 2) * dThetaQ) / dTheta;
/** Offset Δθ that produces retardation δ (δ → 0 means "far off Bragg": returns ±Infinity). */
export const offsetFor = (delta: number, dThetaQ: number): number => ((Math.PI / 2) * dThetaQ) / delta;

export interface Polarization {
  /** complex Jones components (re, im) in the lab frame: x horizontal, y vertical */
  ex: [number, number];
  ey: [number, number];
  /** helicity-signed degree of circular polarization: + = positive helicity (LCP, optics convention) */
  pc: number;
  /** linear polarization H − V */
  plin: number;
}

/** Polarization after a retarder of phase δ with axes at 45° to an incident linear-horizontal beam. */
export function polarization(delta: number, degree = 1): Polarization {
  const c = Math.cos(delta);
  const s = Math.sin(delta);
  return {
    ex: [(1 + c) / 2, s / 2],
    ey: [(1 - c) / 2, -s / 2],
    pc: -s * degree,
    plin: c * degree,
  };
}

// ------------------------------------------------------------------ mean-field magnetization

function coth(x: number): number {
  return 1 / Math.tanh(x);
}

/**
 * Brillouin function B_J(x) = a coth(ax) − b coth(bx), a = (2J+1)/2J, b = 1/2J. Below |x| = 0.02 the series
 * (a²−b²)x/3 − (a⁴−b⁴)x³/45 + 2(a⁶−b⁶)x⁵/945 avoids the 1/x − 1/x cancellation (matters right next to T_C).
 */
export function brillouin(J: number, x: number): number {
  const a = (2 * J + 1) / (2 * J);
  const b = 1 / (2 * J);
  if (Math.abs(x) < 0.02) {
    const a2 = a * a;
    const b2 = b * b;
    const x2 = x * x;
    return x * ((a2 - b2) / 3 - ((a2 * a2 - b2 * b2) * x2) / 45 + (2 * (a2 * a2 * a2 - b2 * b2 * b2) * x2 * x2) / 945);
  }
  return a * coth(a * x) - b * coth(b * x);
}

/** dB_J/dx (same series below |x| = 0.02). */
export function brillouinDeriv(J: number, x: number): number {
  const a = (2 * J + 1) / (2 * J);
  const b = 1 / (2 * J);
  if (Math.abs(x) < 0.02) {
    const a2 = a * a;
    const b2 = b * b;
    const x2 = x * x;
    return (a2 - b2) / 3 - ((a2 * a2 - b2 * b2) * x2) / 15 + (2 * (a2 * a2 * a2 - b2 * b2 * b2) * x2 * x2) / 189;
  }
  const sa = Math.sinh(a * x);
  const sb = Math.sinh(b * x);
  return (b * b) / (sb * sb) - (a * a) / (sa * sa);
}

/** Reduced Zeeman energy g μ_B J B / (k_B T). */
export function zeeman(bTesla: number, tK: number, J: number, g = 2): number {
  return (g * MUB_OVER_KB * J * bTesla) / Math.max(tK, 1e-6);
}

/**
 * Weiss mean-field reduced magnetization m ∈ [0, 1] at reduced temperature t = T/T_C and reduced field h ≥ 0:
 * the largest root of g(m) = B_J(3J/(J+1)·m/t + h) − m. B_J is concave for positive argument, so g is concave on
 * m ≥ 0 and Newton's method started at m = 1 (where g < 0) descends monotonically onto the largest root. A few
 * iterations instead of a long bisection (this runs a few hundred times per frame while a slider moves).
 */
export function meanFieldM(t: number, J: number, h = 0): number {
  if (t <= 1e-6) return 1;
  if (h <= 0 && t >= 1) return 0;
  const k = (3 * J) / (J + 1);
  let m = 1;
  for (let i = 0; i < 80; i++) {
    const x = (k * m) / t + h;
    const g = brillouin(J, x) - m;
    if (g >= 0) return m; // at (or numerically on) the root
    const dg = (brillouinDeriv(J, x) * k) / t - 1; // < 0 right of the root (concavity)
    if (!(dg < 0)) break;
    const next = m - g / dg;
    if (!(next < m) || next <= 0) return Math.max(0, next);
    if (m - next < 1e-13) return next;
    m = next;
  }
  // slow convergence (critical point, t → 1⁻ with h = 0): finish by bisection on (0, m]
  let lo = 0;
  let hi = m;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (brillouin(J, (k * mid) / t + h) - mid > 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ------------------------------------------------------------------ FePt model

export const FEPT = {
  /** Curie temperature at ambient pressure, K */
  tc0: 750,
  J: 1.5,
  g: 2,
  /** coercive field at T = 0, T (gives ≈3 T at room temperature) */
  hc0: 3.2,
  /** H_c ∝ m^hcExp (K ∝ M^2.1, H_K = 2K/M) */
  hcExp: 1.1,
  /** relative spread of grain switching fields */
  sigmaSw: 0.25,
  /** toy pressure scale at which the moment collapses, GPa (ILLUSTRATIVE) */
  pStar: 150,
  /** Pt 5d moments per atom at saturation, T = 0 (illustrative, DFT-like), μ_B */
  mSpin: 0.35,
  mOrb: 0.05,
  /** Pt 5d holes */
  nh: 1.7,
};

export const tcAt = (pGPa: number): number => FEPT.tc0 * Math.max(0, 1 - pGPa / FEPT.pStar);
export const momentScale = (pGPa: number): number => Math.sqrt(Math.max(0, 1 - pGPa / FEPT.pStar));

/** Spontaneous (zero-field) magnetization, in units of M_s(T = 0, P = 0). */
export function spontaneous(tK: number, pGPa: number): number {
  const tc = tcAt(pGPa);
  const s = momentScale(pGPa);
  if (tc <= 0 || s <= 0) return 0;
  return s * meanFieldM(tK / tc, FEPT.J);
}

/** Magnetization along an applied field of magnitude |B| (units of M_s(0,0)); above T_C this is the induced moment. */
export function inField(tK: number, pGPa: number, bAbs: number): number {
  const tc = tcAt(pGPa);
  const s = momentScale(pGPa);
  if (s <= 0) return 0;
  const h = zeeman(Math.abs(bAbs), tK, FEPT.J, FEPT.g);
  if (tc <= 0) return s * brillouin(FEPT.J, h); // free paramagnet
  return s * meanFieldM(tK / tc, FEPT.J, h);
}

/** Coercive field (T) at temperature and pressure. */
export function coercivity(tK: number, pGPa: number): number {
  const m = spontaneous(tK, pGPa);
  return m > 0 ? FEPT.hc0 * Math.pow(m, FEPT.hcExp) : 0;
}

/** Inverse standard-normal CDF (Acklam's rational approximation, |err| < 1.2e-9). */
export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Standard-normal CDF (Abramowitz–Stegun 7.1.26 erf, |err| < 1.5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/**
 * Ensemble of independent uniaxial grains (easy axis ∥ beam). Grain i flips to +1 when H ≥ H_c·k_i and to −1 when
 * H ≤ −H_c·k_i, with k_i = 1 + σ g_i and g_i the normal quantiles (shuffled over the mosaic).
 */
export class Grains {
  readonly n: number;
  readonly k: Float64Array;
  readonly s: Int8Array;
  /** true while the sample is above T_C (grains have no orientation to remember) */
  hot = false;
  private seed: number;

  constructor(n = 100, seed = 7) {
    this.n = n;
    this.k = new Float64Array(n);
    this.s = new Int8Array(n).fill(1);
    this.seed = seed;
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < n; i++) this.k[order[i]] = Math.max(0.05, 1 + FEPT.sigmaSw * normInv((i + 0.5) / n));
  }

  /** deterministic LCG in [0, 1) */
  rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  setAll(v: 1 | -1): void {
    this.s.fill(v);
    this.hot = false;
  }

  /** Apply field H (T) with coercivity hc (T) and spontaneous magnetization m0. */
  update(H: number, hc: number, m0: number): void {
    if (m0 <= 1e-4) {
      this.hot = true;
      return;
    }
    if (this.hot) {
      // freeze in on cooling through T_C: along the field, or at random in (near) zero field
      const p = 0.5 * (1 + Math.tanh(H / 0.02));
      for (let i = 0; i < this.n; i++) this.s[i] = this.rand() < p ? 1 : -1;
      this.hot = false;
    }
    for (let i = 0; i < this.n; i++) {
      const sw = hc * this.k[i];
      if (H >= sw) this.s[i] = 1;
      else if (H <= -sw) this.s[i] = -1;
    }
  }

  mean(): number {
    let a = 0;
    for (let i = 0; i < this.n; i++) a += this.s[i];
    return a / this.n;
  }
}

/** Ascending (from −saturation) and descending major-loop branches of the ensemble average, analytic. */
export function majorLoop(H: number, hc: number, m0: number, mHigh: number, ascending: boolean): number {
  if (hc <= 0) return Math.sign(H) * mHigh;
  const x = ascending ? (H - hc) / (FEPT.sigmaSw * hc) : (H + hc) / (FEPT.sigmaSw * hc);
  const sbar = 2 * normCdf(x) - 1;
  return sbar * m0 + Math.sign(H) * Math.max(0, mHigh - m0);
}

/** Net magnetization along the beam, units of M_s(0,0): grain average × m0 plus the high-field (para-process) part. */
export function netMagnetization(sbar: number, H: number, tK: number, pGPa: number): number {
  const m0 = spontaneous(tK, pGPa);
  const mh = Math.abs(H) > 1e-6 ? inField(tK, pGPa, Math.abs(H)) : m0;
  return sbar * m0 + Math.sign(H) * Math.max(0, mh - m0);
}

// ------------------------------------------------------------------ spectra (schematic) and sum rules

/** Area-normalized pseudo-Voigt profile. */
export function pseudoVoigt(x: number, fwhm: number, eta: number): number {
  const g = Math.sqrt(4 * Math.LN2 / Math.PI) / fwhm * Math.exp((-4 * Math.LN2 * x * x) / (fwhm * fwhm));
  const l = (2 / Math.PI) * (fwhm / (4 * x * x + fwhm * fwhm));
  return eta * l + (1 - eta) * g;
}

export const arctanStep = (x: number, w: number): number => 0.5 + Math.atan(x / w) / Math.PI;

export interface EdgeShape {
  /** edge energy, eV */
  e0: number;
  /** edge jump (L₃ = 1, L₂ = ½) */
  jump: number;
  /** step centre and half-width, eV relative to e0 */
  stepPos: number;
  stepW: number;
  /** white-line area (jump·eV), centre (eV rel. E0), FWHM (eV), Lorentzian fraction */
  wlArea: number;
  wlPos: number;
  fwhm: number;
  eta: number;
  /** XMCD peak position relative to e0 */
  xmcdPos: number;
}

/** Schematic Pt L₃ / L₂ edges: core-hole widths ≈ 5.3 / 5.7 eV broadened by the Si(111) bandpass (≈1.6 eV). */
export const EDGES: { L3: EdgeShape; L2: EdgeShape } = {
  L3: { e0: PT_EDGES.L3 * 1000, jump: 1, stepPos: 0, stepW: 2.6, wlArea: 4.7, wlPos: 2.2, fwhm: 6.4, eta: 0.6, xmcdPos: 1.4 },
  L2: { e0: PT_EDGES.L2 * 1000, jump: 0.5, stepPos: 0, stepW: 2.8, wlArea: 1.8, wlPos: 2.4, fwhm: 6.8, eta: 0.6, xmcdPos: 1.6 },
};

/** Energy window (eV relative to each edge) and sampling. */
export const WINDOW = { lo: -24, hi: 46, n: 281 };

/** r = ∫(μ⁺ + μ⁻) over both white lines = 2 × (sum of white-line areas). */
export const whiteLineR = (): number => 2 * (EDGES.L3.wlArea + EDGES.L2.wlArea);

/** XMCD areas (Chen convention μ⁺ − μ⁻) at L₃ and L₂ from the moments, by inverting the sum rules. */
export function xmcdAreas(mSpinEff: number, mOrb: number, nh: number, r: number): { a3: number; a2: number } {
  return { a3: (-r * (mSpinEff + 3 * mOrb)) / (6 * nh), a2: (r * (2 * mSpinEff - 3 * mOrb)) / (12 * nh) };
}

/** Sum rules (Chen et al. 1995 form): moments from p = ∫_{L₃}Δμ, q = ∫_{L₃+L₂}Δμ, r = ∫(μ⁺+μ⁻). */
export function sumRules(p: number, q: number, r: number, nh: number): { mOrb: number; mSpinEff: number } {
  return { mOrb: (-4 * q * nh) / (3 * r), mSpinEff: (-(6 * p - 4 * q) * nh) / r };
}

export interface Spectra {
  /** energies relative to each edge, eV */
  x: Float64Array;
  /** per edge: step, average absorption, measured μ_L, μ_R, the beam's μ, and Δμ = μ_L − μ_R */
  L3: EdgeSpectra;
  L2: EdgeSpectra;
}

export interface EdgeSpectra {
  step: Float64Array;
  avg: Float64Array;
  /** XMCD shape with unit area (Chen-convention sign applied later) */
  shape: Float64Array;
  muL: Float64Array;
  muR: Float64Array;
  beam: Float64Array;
  diff: Float64Array;
}

function edgeArrays(e: EdgeShape, x: Float64Array): EdgeSpectra {
  const n = x.length;
  const out: EdgeSpectra = {
    step: new Float64Array(n),
    avg: new Float64Array(n),
    shape: new Float64Array(n),
    muL: new Float64Array(n),
    muR: new Float64Array(n),
    beam: new Float64Array(n),
    diff: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    out.step[i] = e.jump * arctanStep(x[i] - e.stepPos, e.stepW);
    out.avg[i] = out.step[i] + e.wlArea * pseudoVoigt(x[i] - e.wlPos, e.fwhm, e.eta);
    out.shape[i] = pseudoVoigt(x[i] - e.xmcdPos, e.fwhm, e.eta);
  }
  return out;
}

export function makeSpectra(): Spectra {
  const x = new Float64Array(WINDOW.n);
  for (let i = 0; i < WINDOW.n; i++) x[i] = WINDOW.lo + ((WINDOW.hi - WINDOW.lo) * i) / (WINDOW.n - 1);
  return { x, L3: edgeArrays(EDGES.L3, x), L2: edgeArrays(EDGES.L2, x) };
}

export interface SpectraState {
  /** magnetization along the beam, units of M_s(0,0) (sign = direction) */
  mProj: number;
  /** helicity-signed P_c of the beam currently selected (for `beam`) */
  pcBeam: number;
  /** degree of circular polarization used for the μ_L / μ_R pair */
  pcMag: number;
  /** Pt moments at saturation (μ_B) and hole count */
  mSpinEff: number;
  mOrb: number;
  nh: number;
}

/** Fill μ_L, μ_R, beam and Δμ in place (no allocation). */
export function computeSpectra(sp: Spectra, s: SpectraState): void {
  const { a3, a2 } = xmcdAreas(s.mSpinEff, s.mOrb, s.nh, whiteLineR());
  for (const [ed, a] of [
    [sp.L3, a3],
    [sp.L2, a2],
  ] as [EdgeSpectra, number][]) {
    for (let i = 0; i < ed.avg.length; i++) {
      const dC = a * ed.shape[i] * s.mProj; // μ⁺ − μ⁻ (Chen) for the actual magnetization
      // helicity h (+1 = LCP): μ_h = μ̄ − h·P·dC/2   (photon spin ∥ k is antiparallel to the majority spin when M ∥ k)
      ed.muL[i] = ed.avg[i] - (s.pcMag * dC) / 2;
      ed.muR[i] = ed.avg[i] + (s.pcMag * dC) / 2;
      ed.beam[i] = ed.avg[i] - (s.pcBeam * dC) / 2;
      ed.diff[i] = ed.muL[i] - ed.muR[i];
    }
  }
}

function trapz(x: Float64Array, y: (i: number) => number): number {
  let a = 0;
  for (let i = 1; i < x.length; i++) a += 0.5 * (y(i) + y(i - 1)) * (x[i] - x[i - 1]);
  return a;
}

/**
 * Apply the sum rules to the displayed μ_L / μ_R exactly as an experimenter would: subtract the arctan steps,
 * convert the lab difference to the Chen convention assuming M ∥ +k (so the result is the moment PROJECTED on the
 * beam direction) and correct for the degree of circular polarization.
 */
export function readBack(sp: Spectra, pcMag: number, nh: number): { mOrb: number; mSpinEff: number; p: number; q: number; r: number } {
  const x = sp.x;
  const e3 = sp.L3;
  const e2 = sp.L2;
  const p = trapz(x, (i) => -e3.diff[i] / pcMag);
  const q = p + trapz(x, (i) => -e2.diff[i] / pcMag);
  const r = trapz(x, (i) => e3.muL[i] + e3.muR[i] - 2 * e3.step[i]) + trapz(x, (i) => e2.muL[i] + e2.muR[i] - 2 * e2.step[i]);
  return { ...sumRules(p, q, r, nh), p, q, r };
}

/** Largest |Δμ| (L₃ or L₂) at full saturation and P_c = pcMag. Sets a fixed y-range for the XMCD plot. */
export function maxDiff(sp: Spectra, s: Omit<SpectraState, 'mProj' | 'pcBeam'>): number {
  const { a3, a2 } = xmcdAreas(s.mSpinEff, s.mOrb, s.nh, whiteLineR());
  let m = 0;
  for (let i = 0; i < sp.x.length; i++) m = Math.max(m, Math.abs(a3 * sp.L3.shape[i]), Math.abs(a2 * sp.L2.shape[i]));
  return m * s.pcMag;
}
