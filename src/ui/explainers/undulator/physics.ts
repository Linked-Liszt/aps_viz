/**
 * Undulator physics for the "undulator" station — pure functions, no DOM, so they can be unit-tested.
 *
 * Planar undulator, ultra-relativistic electrons, small angles (K.-J. Kim, AIP Conf. Proc. 184 (1989) 565;
 * X-ray Data Booklet, LBNL 2009, §2.1 "Characteristics of synchrotron radiation"; Clarke, "The Science and
 * Technology of Undulators and Wigglers", OUP 2004):
 *
 *   γ = E / m_e c²                                   m_e c² = 0.51099895 MeV
 *   K = e B₀ λu / (2π m_e c) = 0.93373 · B₀[T] · λu[cm]
 *   B_y(z) = B₀ cos(k_u z)  ⇒  x′(z) = (K/γ) sin(k_u z),  x(z) = −(K/(γ k_u)) cos(k_u z)
 *   mean longitudinal velocity  β̄_z = 1 − (1 + K²/2) / (2γ²)
 *   λ_n(θ) = λu / (2nγ²) · (1 + K²/2 + γ²θ²)  ⇒ on axis  E_n[keV] = n · 0.9496 · E²[GeV] / (λu[cm] (1 + K²/2))
 *   natural opening angle of the emission around the instantaneous velocity ≈ 1/γ
 *   on-axis angular flux density (filament beam, zero energy spread), n odd:
 *       d²F/dΩ |_n = 1.744×10¹⁴ · N² · E²[GeV] · I[A] · F_n(K)        photons / s / mrad² / 0.1 % BW
 *       F_n(K) = n²K² / (1 + K²/2)² · [J_{(n−1)/2}(ξ) − J_{(n+1)/2}(ξ)]²,   ξ = nK² / (4(1 + K²/2))
 *       even harmonics vanish on axis.
 *   on-axis line shape sinc²(πnN(ω/ω_n − 1)) → FWHM ΔE/E = 0.886/(nN); an rms energy spread σ_E adds a Gaussian
 *       of rms 2σ_E (relative) to every harmonic (E_n ∝ γ²). The peak reduction and FWHM are computed by numerical
 *       convolution (exact for a Gaussian spread, cached per n, N, σ_E).
 *   real-beam corrections applied to the drawn peaks (Kim 1989; X-ray Data Booklet §2.1; Walker NIM A 335 (1993) 328):
 *       beam divergence: σ_r′ = √(λ/2L), Σ′ = √(σ_r′² + σ′²) ⇒ on-axis density × σ_r′² / (Σ_x′ Σ_y′)
 *         (Gaussian approximation; exact in both limits σ′ ≪ σ_r′ and σ′ ≫ σ_r′ for the pattern at E = E_n);
 *       random magnetic phase errors σ_φ (rms, at the fundamental): × exp(−n²σ_φ²).
 *   on-axis far field (Liénard–Wiechert, Jackson 3rd ed. eqs. 14.14 & 14.67): E_x ∝ −d/dt_obs [β_x / (1 − β_z)].
 *       With u = k_u β̄_z c t:  β_x/(1 − β_z) = 2γ · K cos u / (1 + K² cos²u),
 *       observer phase ψ = 2π t_obs / T₁ = u + ξ₁ sin 2u   (ξ₁ = K²/(4(1 + K²/2))).
 *       Its Fourier coefficients reproduce F_n(K) = 4|c_n|² (checked in tests/undulator.test.ts).
 *
 * Bending magnet and wiggler (X-ray Data Booklet §2.1):
 *   E_c[keV] = 0.665 · E²[GeV] · B[T]
 *   d²F/dθdψ |_{ψ=0} = 1.327×10¹³ · E²[GeV] · I[A] · H₂(E/E_c),   H₂(y) = y² K²_{2/3}(y/2)   ph/s/mrad²/0.1 % BW
 *   wiggler (K ≫ 1): on axis = 2N × bending magnet with E_c from the peak field B₀.
 *
 * Magnet models
 *   Hybrid permanent-magnet undulator (NdFeB + vanadium-permendur poles), peak field vs gap:
 *       B₀ = a · exp(b·r + c·r²),  r = g/λu,  a = 3.694 T, b = −5.068, c = 1.520,  valid 0.1 < r < 1
 *       (P. Elleaume, J. Chavanne, B. Faatz, NIM A 455 (2000) 503).
 *     APS-U devices are stronger than this generic fit (better magnets / optimised poles), so each device's curve is
 *     scaled by a constant s so that K at the device minimum gap equals the APS value (R. Dejus et al., IPAC'24
 *     TUPG56 Table 1; APS "Insertion Devices by Sector" table, 22 Sep 2026). s = 1.02 (33 mm) … 1.17 (13.5 mm).
 *     The slider stops at g = λu (edge of the fit's validity); beyond it K is already ≲ 0.3.
 *   Superconducting undulator (NbTi, 4.2 K): fixed 8.0 mm magnetic gap (6.3 mm chamber aperture); tuned by the coil
 *     current, B₀ ∝ I (iron saturation near full current neglected — illustrative). B₀,max from the design K values:
 *     16.5 mm: K_max 1.63 (B₀ = 1.06 T, APS-U FDR ch. 4 / HEXM); 18.5 mm: K_y 2.291 (FDR Table 4.13 / CHEX).
 *
 * Machine numbers (facility research dossier, sources therein):
 *   APS (1995–2023): 7.0 GeV, 100 mA, σ_E 0.095 %, dipole 0.599 T (E_c 19.5 keV), ID-source divergence
 *     σ_x′ = 11 µrad, σ_y′ = 3.5 µrad (3.1 nm emittance; FDR Table 2.1).
 *   APS-U (2024– ):  6.0 GeV, 200 mA, σ_E 0.136 %, BM source B:M3 0.653 T (E_c 15.6 keV), σ_x′ = 2.75 µrad,
 *     σ_y′ = 1.29 µrad (flat-beam mode, ~42 pm; srp2024 Table 5).
 *   Phase error σ_φ = 2.5° rms: APS-U HPMUs as measured (ipac24und Table 2: "≤ 2.5° typ."); assumed for the SCUs too.
 *   Devices: periods / N / K(min gap) from IPAC'24 TUPG56 Table 1 and the Sep-2026 ID table; SCUs from the FDR and
 *   the 2025 APS Strategic Plan (planned, NOT installed as of Sep 2026).
 *
 * Not included: the spectral broadening by beam divergence (≈ γ²σ′²/(1 + K²/2): 3×10⁻⁴ at APS-U, small next to
 * 2σ_E = 2.7×10⁻³, but ~7×10⁻³ at the old APS), the source size, correlated phase errors, and the even harmonics
 * that appear off axis. The station's "What comes out" hint says so.
 */

export const MC2_MEV = 0.51099895;
export const HC_KEV_ANGSTROM = 12.398419843;
/** K = K_PER_T_MM · B₀[T] · λu[mm]  (= 0.93373 per T·cm) */
export const K_PER_T_MM = 0.0933729;
/** physical constants of the flux formulas (X-ray Data Booklet §2.1) */
export const UND_FLUX_COEF = 1.744e14;
export const BM_FLUX_COEF = 1.327e13;
export const EC_COEF = 0.665;
/** hybrid-PM fit coefficients (Elleaume, Chavanne & Faatz 2000) */
export const HYBRID = { a: 3.694, b: -5.068, c: 1.52 };

export type RingId = 'aps' | 'apsu';
export interface Ring {
  id: RingId;
  E: number; // GeV
  I: number; // A
  sigmaE: number; // relative rms energy spread
  bmB: number; // bending-magnet source field (T)
  /** rms electron-beam divergence at the ID source point (µrad) */
  divX: number;
  divY: number;
  /** horizontal emittance (pm rad), for text */
  emitPm: number;
  label: string;
}
export const RINGS: Record<RingId, Ring> = {
  aps: { id: 'aps', E: 7.0, I: 0.1, sigmaE: 0.00095, bmB: 0.599, divX: 11, divY: 3.5, emitPm: 3100, label: 'APS (1995–2023)' },
  apsu: { id: 'apsu', E: 6.0, I: 0.2, sigmaE: 0.00136, bmB: 0.653, divX: 2.75, divY: 1.29, emitPm: 42, label: 'APS-U (2024–)' },
};
/** rms magnetic phase error (degrees) — APS-U HPMU typical (ipac24und Table 2) */
export const PHASE_ERR_DEG = 2.5;

export type DeviceId = 'u33' | 'u28' | 'u25' | 'u21' | 'u13' | 'scu18' | 'scu16';
export interface Device {
  id: DeviceId;
  kind: 'pm' | 'scu';
  periodMm: number;
  /** periods in one device */
  N: number;
  lengthM: number;
  /** PM: device minimum gap; SCU: fixed magnetic gap */
  gapMinMm: number;
  /** PM: largest gap offered on the slider (g/λu = 1) */
  gapMaxMm: number;
  /** K at minimum gap (PM) or at full current (SCU) */
  kRef: number;
  /** button label */
  short: string;
  name: string;
  /** one-line status, shown in the station's gap hint */
  status: string;
}

export const DEVICES: Record<DeviceId, Device> = {
  u33: { id: 'u33', kind: 'pm', periodMm: 33, N: 72, lengthM: 2.38, gapMinMm: 10.0, gapMaxMm: 33, kRef: 2.86, short: '33', name: 'U33 “Undulator A”', status: 'reused from the old APS (3 full + 7 canted)' },
  u28: { id: 'u28', kind: 'pm', periodMm: 28, N: 84, lengthM: 2.35, gapMinMm: 8.5, gapMaxMm: 28, kRef: 2.48, short: '28', name: 'U28', status: 'new for APS-U (3 full + 10 canted)' },
  u25: { id: 'u25', kind: 'pm', periodMm: 25, N: 94, lengthM: 2.35, gapMinMm: 8.5, gapMaxMm: 25, kRef: 1.98, short: '25', name: 'U25', status: 'new for APS-U (9 + 3 canted, mostly in revolvers)' },
  u21: { id: 'u21', kind: 'pm', periodMm: 21, N: 112, lengthM: 2.35, gapMinMm: 8.5, gapMaxMm: 21, kRef: 1.37, short: '21', name: 'U21', status: 'new for APS-U (11 + 5 canted)' },
  u13: { id: 'u13', kind: 'pm', periodMm: 13.5, N: 175, lengthM: 2.36, gapMinMm: 8.5, gapMaxMm: 13.5, kRef: 0.41, short: '13.5', name: 'U13.5', status: 'new for APS-U (2 full + 1 canted)' },
  scu18: { id: 'scu18', kind: 'scu', periodMm: 18.5, N: 70, lengthM: 1.3, gapMinMm: 8.0, gapMaxMm: 8.0, kRef: 2.291, short: '18.5', name: 'SCU18.5', status: 'planned canted pair for 28-ID (CHEX); not installed as of September 2026' },
  scu16: { id: 'scu16', kind: 'scu', periodMm: 16.5, N: 115, lengthM: 1.9, gapMinMm: 8.0, gapMaxMm: 8.0, kRef: 1.63, short: '16.5', name: 'SCU16.5', status: 'planned in-line pairs for 1-ID and 20-ID (HEXM), and a 1.5 m canted pair for 11-ID; not installed as of September 2026' },
};
export const PM_IDS: DeviceId[] = ['u33', 'u28', 'u25', 'u21', 'u13'];
export const SCU_IDS: DeviceId[] = ['scu18', 'scu16'];
/** lowest SCU current offered (fraction of full current) */
export const SCU_FRAC_MIN = 0.05;

/** Illustrative wiggler for the comparison curve — NOT an APS device (APS-U has none). */
export const WIGGLER = { periodMm: 150, B0: 1.6, N: 16 };

// ------------------------------------------------------------------ kinematics

export const gammaOf = (EGeV: number): number => (EGeV * 1000) / MC2_MEV;
export const kOf = (B0: number, periodMm: number): number => K_PER_T_MM * B0 * periodMm;
export const bOfK = (K: number, periodMm: number): number => K / (K_PER_T_MM * periodMm);

/** on-axis wavelength of harmonic n (Å) */
export function lambdaN(n: number, EGeV: number, periodMm: number, K: number, gammaTheta = 0): number {
  const g = gammaOf(EGeV);
  return ((periodMm * 1e7) / (2 * n * g * g)) * (1 + (K * K) / 2 + gammaTheta * gammaTheta);
}
/** on-axis photon energy of harmonic n (keV) */
export const energyN = (n: number, EGeV: number, periodMm: number, K: number): number => HC_KEV_ANGSTROM / lambdaN(n, EGeV, periodMm, K);
/** mean longitudinal velocity 1 − β̄_z */
export const slip = (EGeV: number, K: number): number => (1 + (K * K) / 2) / (2 * gammaOf(EGeV) ** 2);

// ------------------------------------------------------------------ magnets

/** Generic hybrid-PM peak field (T) — Elleaume, Chavanne & Faatz (2000). */
export function hybridField(gapMm: number, periodMm: number): number {
  const r = gapMm / periodMm;
  return HYBRID.a * Math.exp(HYBRID.b * r + HYBRID.c * r * r);
}

/** Per-device calibration of the generic fit to the APS K at minimum gap (1 for SCUs). */
export function pmScale(dev: Device): number {
  if (dev.kind !== 'pm') return 1;
  return dev.kRef / kOf(hybridField(dev.gapMinMm, dev.periodMm), dev.periodMm);
}

/**
 * Field a hybrid PM undulator would reach at an arbitrary period and gap: the generic fit times the APS calibration
 * interpolated (linearly in g/λu) between the APS devices. Used for "what permanent magnets could do" vs the SCUs.
 */
export function pmFieldEstimate(gapMm: number, periodMm: number): number {
  const pts = PM_IDS.map((id) => DEVICES[id])
    .map((d) => [d.gapMinMm / d.periodMm, pmScale(d)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const r = gapMm / periodMm;
  let s = pts[0][1];
  if (r >= pts[pts.length - 1][0]) s = pts[pts.length - 1][1];
  else
    for (let i = 0; i < pts.length - 1; i++) {
      if (r >= pts[i][0] && r <= pts[i + 1][0]) {
        const f = (r - pts[i][0]) / (pts[i + 1][0] - pts[i][0] || 1);
        s = pts[i][1] + f * (pts[i + 1][1] - pts[i][1]);
        break;
      }
    }
  return s * hybridField(gapMm, periodMm);
}

/**
 * The tuning "setting" of a device: the gap in mm for permanent magnets, the coil-current fraction (0–1) for SCUs.
 */
export function settingRange(dev: Device): [number, number] {
  return dev.kind === 'pm' ? [dev.gapMinMm, dev.gapMaxMm] : [SCU_FRAC_MIN, 1];
}
export function fieldAt(dev: Device, setting: number): number {
  if (dev.kind === 'pm') return pmScale(dev) * hybridField(setting, dev.periodMm);
  return Math.max(0, Math.min(1, setting)) * bOfK(dev.kRef, dev.periodMm);
}
export const kAt = (dev: Device, setting: number): number => kOf(fieldAt(dev, setting), dev.periodMm);
export function kRange(dev: Device): [number, number] {
  const [lo, hi] = settingRange(dev);
  const a = kAt(dev, lo);
  const b = kAt(dev, hi);
  return [Math.min(a, b), Math.max(a, b)];
}
/** Inverse of kAt (bisection for PM — K falls monotonically with gap for r < 1.67; linear for SCU). */
export function settingForK(dev: Device, K: number): number {
  const [lo, hi] = settingRange(dev);
  if (dev.kind === 'scu') return Math.max(lo, Math.min(hi, K / dev.kRef));
  let a = lo;
  let b = hi;
  if (K >= kAt(dev, a)) return a;
  if (K <= kAt(dev, b)) return b;
  for (let i = 0; i < 60; i++) {
    const m = 0.5 * (a + b);
    if (kAt(dev, m) > K) a = m;
    else b = m;
  }
  return 0.5 * (a + b);
}

// ------------------------------------------------------------------ special functions

/**
 * Bessel J_n(x), integer n ≥ 0, via the periodic trapezoid rule on Bessel's integral. With M points the only error
 * is aliasing, Σ_k J_{kM±n}(x), which is negligible (< 1e-15) once M − n exceeds |x| by ~30 — so M adapts to n + |x|.
 */
export function besselJ(n: number, x: number): number {
  const M = Math.min(1024, 32 + 2 * Math.ceil((n + Math.abs(x)) / 2) + 16);
  let s = 0;
  for (let k = 0; k < M; k++) {
    const t = (2 * Math.PI * k) / M;
    s += Math.cos(n * t - x * Math.sin(t));
  }
  return s / M;
}

/** Modified Bessel K_ν(x), x > 0: K_ν(x) = ∫₀^∞ exp(−x cosh t) cosh(νt) dt (trapezoid; integrand decays doubly-exponentially). */
export function besselK(nu: number, x: number): number {
  if (!(x > 0)) return Infinity;
  const tMax = Math.acosh(1 + 60 / x);
  const M = 400;
  const h = tMax / M;
  let s = 0.5 * Math.exp(-x);
  for (let k = 1; k <= M; k++) {
    const t = k * h;
    s += Math.exp(-x * Math.cosh(t)) * Math.cosh(nu * t);
  }
  return s * h;
}

/** H₂(y) = y² K²_{2/3}(y/2): on-axis bending-magnet spectral shape. */
export function H2(y: number): number {
  if (!(y > 0)) return 0;
  const k = besselK(2 / 3, y / 2);
  return y * y * k * k;
}

/** Undulator harmonic strength F_n(K) (zero for even n on axis). */
export function Fn(n: number, K: number): number {
  if (n % 2 === 0 || K <= 0) return 0;
  const K2 = K * K;
  const d = 1 + K2 / 2;
  const x = (n * K2) / (4 * d);
  const m = (n - 1) / 2;
  const jj = besselJ(m, x) - besselJ(m + 1, x);
  return ((n * n * K2) / (d * d)) * jj * jj;
}

// ------------------------------------------------------------------ spectra

/** On-axis peak angular flux density of harmonic n (ph/s/mrad²/0.1 % BW), filament beam. */
export const undulatorPeak = (n: number, K: number, N: number, EGeV: number, IA: number): number => UND_FLUX_COEF * N * N * EGeV * EGeV * IA * Fn(n, K);

/** Relative FWHM of harmonic n on axis from the finite number of periods. */
export const naturalWidth = (n: number, N: number): number => 0.886 / (n * N);
/** Relative FWHM added by an rms energy spread (Gaussian, 2σ_E rms). */
export const spreadWidth = (sigmaE: number): number => 2.3548 * 2 * sigmaE;

/**
 * Gaussian approximation of the energy-spread peak reduction: the sinc² line (Gaussian-equivalent σ = FWHM/2.355)
 * convolved with a Gaussian of rms 2σ_E. Kept as a cross-check of the exact `spreadFactor` (tests).
 */
export function spreadFactorGauss(n: number, N: number, sigmaE: number): number {
  const sn = naturalWidth(n, N) / 2.3548;
  return sn / Math.hypot(sn, 2 * sigmaE);
}

const lineCache = new Map<string, number>();
function cached(key: string, f: () => number): number {
  let v = lineCache.get(key);
  if (v === undefined) {
    if (lineCache.size > 4000) lineCache.clear();
    v = f();
    lineCache.set(key, v);
  }
  return v;
}
/** samples across the line used by `spreadFwhm` (and by the zoom in panel 2, so both give the same number) */
export const LINE_SAMPLES = 181;
/** half-span (relative detuning) of the sampled line: main lobe + side lobes, or ±4 rms of the spread */
export const lineSpan = (n: number, N: number, sigmaE: number): number => Math.max(2.6 / (n * N), 8 * sigmaE);

/** Peak reduction of harmonic n by the energy spread: exact numerical convolution (sinc² ⊗ Gaussian of rms 2σ_E). */
export function spreadFactor(n: number, N: number, sigmaE: number): number {
  return cached(`p|${n}|${N}|${sigmaE}`, () => spreadLine(0, n, N, sigmaE));
}
/** Relative FWHM of harmonic n with the energy spread (numerical, same grid as the panel-2 zoom). */
export function spreadFwhm(n: number, N: number, sigmaE: number): number {
  return cached(`w|${n}|${N}|${sigmaE}`, () => {
    const span = lineSpan(n, N, sigmaE);
    const v = new Float64Array(LINE_SAMPLES);
    for (let i = 0; i < LINE_SAMPLES; i++) v[i] = spreadLine(-span + (2 * span * i) / (LINE_SAMPLES - 1), n, N, sigmaE);
    return fwhmSampled(v, span);
  });
}
/** Combined relative FWHM of harmonic n (natural ⊕ energy spread, quadrature) — the textbook estimate. */
export const lineWidth = (n: number, N: number, sigmaE: number): number => Math.hypot(naturalWidth(n, N), spreadWidth(sigmaE));

/** Reduction of the on-axis intensity of harmonic n by random phase errors σ_φ (Walker 1993): exp(−n²σ_φ²). */
export const phaseFactor = (n: number, sigmaDeg = PHASE_ERR_DEG): number => Math.exp(-(((n * sigmaDeg * Math.PI) / 180) ** 2));

/** Natural (single-electron) rms opening angle of the radiation at photon energy E: σ_r′ = √(λ/2L) (µrad). */
export function sigmaRp(EkeV: number, dev: Device): number {
  const lamM = (HC_KEV_ANGSTROM / EkeV) * 1e-10;
  const L = dev.N * dev.periodMm * 1e-3;
  return Math.sqrt(lamM / (2 * L)) * 1e6;
}
/** On-axis angular-density reduction by the electron-beam divergence: σ_r′² / (Σ_x′ Σ_y′), Σ′ = √(σ_r′² + σ′²). */
export function divergenceFactor(EkeV: number, dev: Device, ring: Ring): number {
  const s2 = sigmaRp(EkeV, dev) ** 2;
  return s2 / Math.sqrt((s2 + ring.divX ** 2) * (s2 + ring.divY ** 2));
}

/** The separate real-beam factors applied to the filament on-axis peak of harmonic n. */
export function beamFactors(n: number, K: number, dev: Device, ring: Ring): { spread: number; div: number; phase: number } {
  return {
    spread: spreadFactor(n, dev.N, ring.sigmaE),
    div: divergenceFactor(energyN(n, ring.E, dev.periodMm, K), dev, ring),
    phase: phaseFactor(n),
  };
}
/**
 * On-axis peak angular flux density of harmonic n for the real beam (what the station draws): the filament value
 * × energy spread × beam divergence × phase errors.
 */
export function peakFlux(n: number, K: number, dev: Device, ring: Ring): number {
  const f = undulatorPeak(n, K, dev.N, ring.E, ring.I);
  if (!(f > 0)) return 0;
  const b = beamFactors(n, K, dev, ring);
  return f * b.spread * b.div * b.phase;
}

/** sinc² on-axis line shape, normalised to 1 at E = E_n. */
export function lineShape(EkeV: number, En: number, n: number, N: number): number {
  const a = Math.PI * n * N * (EkeV / En - 1);
  if (Math.abs(a) < 1e-9) return 1;
  const s = Math.sin(a) / a;
  return s * s;
}

/**
 * On-axis line of harmonic n at relative detuning δ = E/E_n − 1, averaged over a Gaussian electron energy spread
 * (rms σ_E → rms 2σ_E in δ, since E_n ∝ γ²); normalised so that the zero-spread peak is 1. Trapezoid over ±4σ with a
 * step fine enough for both the Gaussian and the sinc² fringes (period 1/(nN)).
 */
export function spreadLine(delta: number, n: number, N: number, sigmaE: number): number {
  const sd = 2 * sigmaE;
  if (!(sd > 0)) return lineShape(1 + delta, 1, n, N);
  const step = Math.min(0.1 * sd, 0.1 / (n * N));
  const m = Math.min(2000, Math.ceil((4 * sd) / step));
  let s = 0;
  let w = 0;
  for (let j = -m; j <= m; j++) {
    const u = (4 * j) / m;
    const g = Math.exp(-0.5 * u * u);
    s += g * lineShape(1 + delta - u * sd, 1, n, N);
    w += g;
  }
  return s / w;
}

/** Full width at half maximum of a symmetric, centrally peaked curve sampled uniformly on [−span, span] (odd length). */
export function fwhmSampled(v: ArrayLike<number>, span: number): number {
  const c = (v.length - 1) / 2;
  const half = v[c] / 2;
  for (let i = c; i < v.length - 1; i++) {
    if (v[i + 1] <= half) {
      const f = (v[i] - half) / (v[i] - v[i + 1] || 1);
      return 2 * ((i + f - c) / c) * span;
    }
  }
  return 2 * span;
}

export const criticalEnergy = (EGeV: number, B: number): number => EC_COEF * EGeV * EGeV * B;
/** On-axis (ψ = 0) bending-magnet angular flux density (ph/s/mrad²/0.1 % BW). */
export const bendingMagnet = (EkeV: number, EGeV: number, IA: number, B: number): number => BM_FLUX_COEF * EGeV * EGeV * IA * H2(EkeV / criticalEnergy(EGeV, B));
/** On-axis wiggler angular flux density (K ≫ 1): 2N incoherent bending-magnet sources at the peak field. */
export const wiggler = (EkeV: number, EGeV: number, IA: number, w = WIGGLER): number => 2 * w.N * bendingMagnet(EkeV, EGeV, IA, w.B0);

// ------------------------------------------------------------------ tuning

export interface Tune {
  n: number;
  K: number;
  setting: number;
  flux: number;
}

/** a harmonic within this fraction of the best on-axis flux is preferred if it is lower (see tuneTo) */
export const TUNE_PREFER_LOW = 0.8;

/**
 * Odd harmonics whose tuning range contains target (keV), with their real-beam on-axis peak flux. tuneTo returns the
 * LOWEST harmonic within 80 % of the best one — beamline practice: at high n the attainable flux is nearly flat in n,
 * while gap jitter, heat load and the effects left out here (correlated phase errors, divergence broadening) all
 * grow with n. Returns null if no odd harmonic reaches the target.
 */
export function tuneOptions(dev: Device, ring: Ring, targetKeV: number, nMax = 41): Tune[] {
  const [kLo, kHi] = kRange(dev);
  const e0 = energyN(1, ring.E, dev.periodMm, 0);
  const out: Tune[] = [];
  for (let n = 1; n <= nMax; n += 2) {
    const K2 = 2 * ((n * e0) / targetKeV - 1);
    if (K2 < kLo * kLo - 1e-12 || K2 > kHi * kHi + 1e-12) continue;
    const K = Math.sqrt(Math.max(0, K2));
    out.push({ n, K, setting: settingForK(dev, K), flux: peakFlux(n, K, dev, ring) });
  }
  return out;
}
export function tuneTo(dev: Device, ring: Ring, targetKeV: number, nMax = 41): Tune | null {
  const opts = tuneOptions(dev, ring, targetKeV, nMax);
  if (!opts.length) return null;
  const best = Math.max(...opts.map((o) => o.flux));
  return opts.find((o) => o.flux >= TUNE_PREFER_LOW * best) ?? opts[0];
}

/** Device (of all offered) that gives the most on-axis flux at the target energy, with its tune. */
export function bestDevice(ring: Ring, targetKeV: number, ids: DeviceId[] = [...PM_IDS, ...SCU_IDS]): { id: DeviceId; tune: Tune } | null {
  let best: { id: DeviceId; tune: Tune } | null = null;
  for (const id of ids) {
    const t = tuneTo(DEVICES[id], ring, targetKeV);
    if (t && (!best || t.flux > best.tune.flux)) best = { id, tune: t };
  }
  return best;
}


/** Energy range [Emin, Emax] (keV) that harmonic n covers over the device's tuning range. */
export function harmonicRange(n: number, dev: Device, ring: Ring): [number, number] {
  const [kLo, kHi] = kRange(dev);
  return [energyN(n, ring.E, dev.periodMm, kHi), energyN(n, ring.E, dev.periodMm, kLo)];
}

// ------------------------------------------------------------------ on-axis waveform

/**
 * On-axis far-field E_x over one period of the observer's clock, sampled uniformly in ψ ∈ [0, 2π).
 * out[i] = −d/dψ [K cos u / (1 + K² cos²u)], ψ = u + ξ₁ sin 2u. Returns max |E| (unnormalised).
 */
export function waveform(K: number, out: Float32Array): number {
  const M = out.length;
  const K2 = K * K;
  const xi = K2 / (4 * (1 + K2 / 2));
  let u = 0;
  let peak = 0;
  for (let i = 0; i < M; i++) {
    const psi = (2 * Math.PI * i) / M;
    // Newton for u(ψ): ψ = u + ξ sin 2u  (dψ/du = 1 + 2ξ cos 2u ≥ 1 − 2ξ > 0)
    if (i === 0) u = psi;
    for (let it = 0; it < 30; it++) {
      const f = u + xi * Math.sin(2 * u) - psi;
      const d = 1 + 2 * xi * Math.cos(2 * u);
      const du = f / d;
      u -= du;
      if (Math.abs(du) < 1e-13) break;
    }
    const c = Math.cos(u);
    const s = Math.sin(u);
    const q = 1 + K2 * c * c;
    const dfdu = (-K * s * (1 - K2 * c * c)) / (q * q);
    const dpsidu = 1 + 2 * xi * Math.cos(2 * u);
    const e = -dfdu / dpsidu;
    out[i] = e;
    if (Math.abs(e) > peak) peak = Math.abs(e);
  }
  return peak;
}

/** |c_n|² of a uniformly sampled periodic signal (one period). */
export function harmonicPower(samples: ArrayLike<number>, n: number): number {
  const M = samples.length;
  let re = 0;
  let im = 0;
  for (let i = 0; i < M; i++) {
    const a = (2 * Math.PI * n * i) / M;
    re += samples[i] * Math.cos(a);
    im -= samples[i] * Math.sin(a);
  }
  re /= M;
  im /= M;
  return re * re + im * im;
}

// ------------------------------------------------------------------ formatting helpers

export function fmtKeV(e: number): string {
  if (e >= 100) return e.toFixed(0);
  if (e >= 10) return e.toFixed(1);
  return e.toFixed(2);
}
export function fmtSci(v: number, digits = 1): string {
  if (!(v > 0)) return '0';
  const e = Math.floor(Math.log10(v));
  const m = v / 10 ** e;
  return `${m.toFixed(digits)}×10${sup(e)}`;
}
export function sup(e: number): string {
  const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(e)
    .split('')
    .map((c) => map[c] ?? c)
    .join('');
}
/** 27430 → "27,000"; 412 → "410" (2 significant figures, grouped) */
export function fmtRound(v: number): string {
  if (!(v > 0)) return '0';
  const e = Math.floor(Math.log10(v));
  const r = Math.round(v / 10 ** (e - 1)) * 10 ** (e - 1);
  return Math.round(r).toLocaleString('en-US');
}
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${s}`;
}
