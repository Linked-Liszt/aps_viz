/**
 * XPCS station — pure physics helpers (no DOM; unit-tested in tests/xpcs.test.ts).
 *
 * Equations and sources
 * ---------------------
 *  Stokes–Einstein:        D = k_B T / (6 π η a)                                  (Einstein 1905)
 *  Water viscosity:        η(T) = A·10^{B/(T−C)}, A = 2.414e-5 Pa·s, B = 247.8 K, C = 140 K
 *                          (Vogel-type engineering fit; ≈1–2 % over 0–100 °C vs. IAPWS tables)
 *  Sphere form factor:     F(x) = 3 (sin x − x cos x) / x³,  x = q a,  P = F²    (Rayleigh 1911)
 *  Siegert relation:       g2(q,τ) = 1 + β |f(q,τ)|²  (Gaussian/“fully developed” speckle statistics)
 *  Free diffusion ISF:     f(q,τ) = exp(−D q² τ)  ⇒  g2 = 1 + β exp(−2 Γ τ),  Γ = D q²
 *  Mode-sum contrast:      incoherent sum of independent speckle patterns with weights w_m:
 *                          β = Σ w_m² / (Σ w_m)²   (Goodman, Speckle Phenomena in Optics, §3)
 *  Multi-tau binning:      a correlator that bins Δ frames before correlating at lag kΔ measures
 *                          g2 − 1 = β e^{−2ΓkΔ} · sinh²(ΓΔ) / (Δ² sinh²Γ)   (Γ in 1/frame; exact for
 *                          exponential decay, derived from the double sum over the two bins)
 *  Coherent flux:          F_c = B λ² / 4   (APS-U PDR 2017 §6-10.2.2; Als-Nielsen & McMorrow)
 *  XPCS signal-to-noise:   SNR ≈ β n̄ √(N_pix T / t_f)  for n̄ ≪ 1 photon/pixel/frame
 *                          (Lumma et al., Rev. Sci. Instrum. 71, 3274 (2000); Falus et al.,
 *                          J. Synchrotron Rad. 13, 253 (2006); APS-U PDR §6-10.2.2: SNR ∝ B);
 *                          with many photons per speckle it saturates at the speckle-sampling limit
 *                          β̄ √(M/v), M = independent speckles × coherence times (xpcsSnrModel below).
 *  Speckle count:          A_c = ∫|μ(Δq)|² d²Δq = π/σ_b² for a Gaussian beam of intensity rms σ_b (Goodman)
 *
 * APS vs APS-U coherent-flux gain (documented; research dossier xpcs.json, refs r3/r4/r20):
 *  - 8-ID specifically: design coherent flux 1.7×10¹³ ph/s in one transverse mode at 10 keV, Si(111)
 *    (APS-U PDR/FDR) vs ≈2×10¹⁰ ph/s at pre-upgrade 8-ID-I (7.4 keV, Ge(111), two Undulator A) → ≈850×;
 *    with the 2026 directory's 1×10¹³ ph/s at 9 keV → ≈500× (different energy, bandwidth and mode
 *    definition, so indicative only: the dossier quotes "~500–850×").
 *  - Facility: APS-U FDR (2019) Table 1.1, coherent flux @ 20 keV 312×10¹¹ (brightness mode) vs 0.6×10¹¹
 *    ph/s (APS 2019) → ≈520×. Plain-language APS messaging: “100 to 500 times more coherent X-rays”.
 *  - Our own Gaussian-source estimate at 10 keV (coherentGainEstimate below): Kim photon terms
 *    σ_r = √(2λL)/4π, σ_r′ = √(λ/2L); electron σ, σ′ from the dossier (APS 2019: 280/11.6/10/3.4 µm,µrad;
 *    APS-U brightness mode at 200 mA: 14.7/2.8/3.2/1.3) → coherent fraction 0.056 % → 8.8 % (×157);
 *    central-cone flux N·I·Q₁(K) (K. J. Kim, AIP Conf. Proc. 184 (1989)): 2×UA33 (N = 144, 100 mA) →
 *    2×U21 (N = 224, 200 mA) ≈ ×3.9 ⇒ ≈600× before energy-spread / alignment losses.
 *  The station uses APSU_GAIN = 500 at 10 keV.
 */

export const KB = 1.380649e-23; // J/K
export const HC_KEV_A = 12.398419843; // λ[Å] = hc / E[keV]

/** Coherent-flux gain APS → APS-U used by the station at 10 keV (documented ≈500×; see header). */
export const APSU_GAIN = 500;

/** Experiment geometry (SA-XPCS-like, 8-ID-I). Illustrative but self-consistent; see header of sim.ts. */
export const GEOM = {
  energyKeV: 10,
  /** sample → detector distance (m); the 8-ID-I flight path telescopes from 4 to 12 m */
  detDistM: 8,
  /** detector pixel pitch (m) */
  pixelM: 75e-6,
  /** FFT grid (real-space sampling of the illuminated region) */
  nGrid: 128,
  /** detector crop shown & analysed (odd so q = 0 sits on a pixel centre) */
  nDet: 97,
  /** beam FWHM at the sample (µm); 8-ID-I zoom optics give 3–10 µm (FDR §4-5.6.1) */
  beamFwhmUm: 3.0,
  /** detector frame time (s): a 20 kHz photon-counting detector */
  frameS: 50e-6,
  /** number of particles in the simulated slab */
  nParticles: 1000,
  /** coherent-mode weights (two incoherent modes → β ≈ 0.53) */
  modeWeights: [1, 0.6] as const,
  /** APS-U mean photons / pixel / frame extrapolated to q → 0 (illustrative scattering strength) */
  n0U: 1.0,
  /** beamstop radius in detector pixels */
  beamstopPx: 5.5,
};

export const lambdaA = (eKeV: number): number => HC_KEV_A / eKeV;

/** q per detector pixel (Å⁻¹): small-angle q ≈ k · p / R. */
export function qPerPixel(g = GEOM): number {
  return ((2 * Math.PI) / lambdaA(g.energyKeV)) * (g.pixelM / g.detDistM);
}

/** Side of the real-space box (Å) whose FFT pixel matches one detector pixel: L = 2π/Δq = λR/p. */
export function boxSizeA(g = GEOM): number {
  return (2 * Math.PI) / qPerPixel(g);
}

/** Dynamic viscosity of liquid water (Pa·s) at tC °C (Vogel equation). */
export function waterViscosity(tC: number): number {
  const T = tC + 273.15;
  return 2.414e-5 * Math.pow(10, 247.8 / (T - 140));
}

/** Stokes–Einstein translational diffusion coefficient (m²/s). */
export function stokesEinstein(tC: number, etaPaS: number, radiusM: number): number {
  return (KB * (tC + 273.15)) / (6 * Math.PI * etaPaS * radiusM);
}

/** Normalised sphere scattering amplitude F(qa) (F(0) = 1). */
export function sphereAmp(x: number): number {
  if (x < 1e-3) return 1 - (x * x) / 10;
  return (3 * (Math.sin(x) - x * Math.cos(x))) / (x * x * x);
}

/** Sphere form factor P(qa) = F². */
export function sphereP(x: number): number {
  const f = sphereAmp(x);
  return f * f;
}

/** Coherent flux (ph/s/0.1%BW) from brightness B (ph/s/mm²/mrad²/0.1%BW) and wavelength λ (Å). */
export function coherentFlux(B: number, lambdaAng: number): number {
  const lam = lambdaAng * 1e-10; // m
  // (λ/2)² in mm²·mrad²: 1 m²·rad² = 1e6 mm² × 1e6 mrad²
  return (B * lam * lam * 1e12) / 4;
}

// ------------------------------------------------------------------ source: why APS-U gives ~500× more coherent flux

/** Electron-beam and undulator parameters of a storage-ring source (SI units: m, rad, A, GeV). */
export interface SourceParams {
  name: string;
  eGeV: number;
  currentMA: number;
  periodM: number;
  /** total number of undulator periods feeding the beamline */
  nPeriods: number;
  /** total undulator length (m) */
  lengthM: number;
  sx: number;
  sxp: number;
  sy: number;
  syp: number;
}

/** 8-ID before (2019: two in-line 3.3 cm Undulator A, 7 GeV, 100 mA) and after the upgrade (two 2.1 cm HPMU arrays,
 * 6 GeV, 200 mA, brightness mode with IBS: FDR Table 1.1). Electron σ, σ′ as quoted in the research dossier. */
export const SOURCES: { aps: SourceParams; apsu: SourceParams } = {
  aps: { name: 'APS (2019)', eGeV: 7, currentMA: 100, periodM: 0.033, nPeriods: 144, lengthM: 4.8, sx: 280e-6, sxp: 11.6e-6, sy: 10e-6, syp: 3.4e-6 },
  apsu: { name: 'APS-U', eGeV: 6, currentMA: 200, periodM: 0.021, nPeriods: 224, lengthM: 4.7, sx: 14.7e-6, sxp: 2.8e-6, sy: 3.2e-6, syp: 1.3e-6 },
};

/** Diffraction-limited photon source size σ_r (m) and divergence σ_r′ (rad) of an undulator of length L (Kim). */
export function photonTerms(eKeV: number, lengthM: number): { sr: number; srp: number } {
  const lam = lambdaA(eKeV) * 1e-10;
  return { sr: Math.sqrt(2 * lam * lengthM) / (4 * Math.PI), srp: Math.sqrt(lam / (2 * lengthM)) };
}

/** Fraction of the flux in one transverse coherent mode: (λ/4π)² / (Σ_x Σ_x′ Σ_y Σ_y′). */
export function coherentFraction(eKeV: number, s: SourceParams): number {
  const { sr, srp } = photonTerms(eKeV, s.lengthM);
  const lam = lambdaA(eKeV) * 1e-10;
  const vol = Math.hypot(s.sx, sr) * Math.hypot(s.sxp, srp) * Math.hypot(s.sy, sr) * Math.hypot(s.syp, srp);
  return Math.pow(lam / (4 * Math.PI), 2) / vol;
}

function besselJ(n: 0 | 1, x: number): number {
  // power series (fine for the small arguments ξ < 0.25 used here)
  let sum = 0;
  let term = n === 0 ? 1 : x / 2;
  for (let m = 0; m < 12; m++) {
    sum += term;
    term *= -(x * x) / 4 / ((m + 1) * (m + 1 + n));
  }
  return sum;
}

/** Undulator deflection parameter K that puts the first harmonic at eKeV: E₁ = 0.9496 E²/(λ_u[cm](1 + K²/2)). */
export function kForFirstHarmonic(eKeV: number, eGeV: number, periodM: number): number {
  const k2 = 2 * ((0.9496 * eGeV * eGeV) / (periodM * 100 * eKeV) - 1);
  return k2 > 0 ? Math.sqrt(k2) : NaN;
}

/** Kim's Q₁(K) = K²/(1 + K²/2) · [J₀(ξ) − J₁(ξ)]², ξ = K²/(4 + 2K²): central-cone flux ∝ N · I · Q₁(K). */
export function undulatorQ1(K: number): number {
  const xi = (K * K) / (4 + 2 * K * K);
  const jj = besselJ(0, xi) - besselJ(1, xi);
  return ((K * K) / (1 + (K * K) / 2)) * jj * jj;
}

/** Coherent flux (arbitrary units) on the first harmonic: N · I · Q₁(K) × coherent fraction. */
export function coherentFluxRel(eKeV: number, s: SourceParams): number {
  const K = kForFirstHarmonic(eKeV, s.eGeV, s.periodM);
  return s.nPeriods * s.currentMA * undulatorQ1(K) * coherentFraction(eKeV, s);
}

/** Gaussian-source estimate of the APS → APS-U coherent-flux gain at 8-ID (ideal: no energy-spread losses). */
export function coherentGainEstimate(eKeV: number): { gain: number; fracAps: number; fracApsu: number; fluxRatio: number } {
  const fracAps = coherentFraction(eKeV, SOURCES.aps);
  const fracApsu = coherentFraction(eKeV, SOURCES.apsu);
  const gain = coherentFluxRel(eKeV, SOURCES.apsu) / coherentFluxRel(eKeV, SOURCES.aps);
  return { gain, fracAps, fracApsu, fluxRatio: gain / (fracApsu / fracAps) };
}

/** Contrast of an incoherent sum of independent fully developed speckle patterns. */
export function modeContrast(w: ArrayLike<number>): number {
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < w.length; i++) {
    s += w[i];
    s2 += w[i] * w[i];
  }
  return s2 / (s * s);
}

/** Theory g2 − 1 at lag `lag` frames for a multi-tau channel that bins `bin` frames (Γ in 1/frame). */
export function g2Binned(beta: number, gamma: number, lag: number, bin = 1): number {
  const base = beta * Math.exp(-2 * gamma * lag);
  if (bin <= 1) return base;
  const a = gamma * bin;
  if (a < 1e-6) return base;
  const s1 = Math.sinh(a);
  const s0 = Math.sinh(gamma);
  return (base * s1 * s1) / (bin * bin * s0 * s0);
}

/**
 * Low-count XPCS signal-to-noise estimate (Lumma 2000 / Falus 2006): β n̄ √(N_pix N_frames), valid when there
 * are ≪ 1 photons per speckle per correlation time. With many photons per speckle the SNR saturates at the
 * number of independent speckle realisations (≈ √(N_speckles · T/τ)), so the time needed for a given SNR then
 * scales more weakly than 1/flux².
 */
export function xpcsSnr(beta: number, nPerPixFrame: number, nPix: number, nFrames: number): number {
  return beta * nPerPixFrame * Math.sqrt(nPix * nFrames);
}

/**
 * Per-sample variance of the ratio estimator R = ⟨I²⟩/⟨I⟩² for speckle with contrast β (gamma-distributed
 * intensity, shape 1/β, moments E[iᵐ] = Π_{j<m}(1 + jβ)); delta method:
 *   v = Var(i²) + 4(1+β)² Var(i) − 4(1+β) Cov(i², i)          (v = 4 for β = 1, ≈ 0.86 for β = 0.53)
 */
export function speckleEstimatorVar(beta: number): number {
  const m2 = 1 + beta;
  const m3 = m2 * (1 + 2 * beta);
  const m4 = m3 * (1 + 3 * beta);
  return m4 - m2 * m2 + 4 * m2 * m2 * beta - 4 * m2 * (m3 - m2);
}

export interface SnrModelInput {
  /** speckle contrast β at τ → 0 */
  beta: number;
  /** mean e^{−2Γτ} over the pooled lags (weighted like the estimator) */
  decay: number;
  /** effective number of independent lags: Σ (bin width in frames) over the pooled multi-tau lags */
  lEff: number;
  nPix: number;
  nFrames: number;
  /** mean photons per pixel per frame */
  nPerPixFrame: number;
  /** Γ = Dq² per frame */
  gammaFrame: number;
  /** speckle (coherence) area in pixels, ∫|μ(Δq)|² d²Δq */
  cohAreaPx: number;
}

/**
 * Expected SNR of the short-delay contrast β̄ (lags τ ≲ τ_c/4 pooled, as in the station) for multispeckle XPCS,
 * combining the two noise limits in quadrature:
 *   photon shot noise   SNR_shot = β̄ n̄ √(N_pix N_f L_eff/(1+β))         (Lumma 2000; lags independent)
 *   speckle sampling    SNR_spk  = β̄ √(M/v),  M = (N_pix/A_c)(1 + κ N_f Γ)   (independent speckle realisations;
 *                       κ = 1.1 = 1/∫ρ_{I²}dτ for e^{−Γτ} field decay, v from speckleEstimatorVar)
 *   1/SNR² = 1/SNR_shot² + 1/SNR_spk².
 * Caveat: M ignores the Friedel symmetry I(q) = I(−q) of this thin-sample pattern (half as many independent
 * speckles on a ring) and v is the variance of ⟨I²⟩/⟨I⟩², larger than that of the lag-pooled ⟨I(t)I(t+τ)⟩;
 * the two errors roughly cancel here, so the formula is calibrated against the simulation, not trusted a priori.
 * Run-to-run scatter, 16 seeds × 1500 frames at the defaults: APS-U (speckle-limited) 14.9 vs model 15.8;
 * APS (photon-starved) 1.37 vs model 1.79, i.e. the model is ~30 % optimistic there.
 */
export function xpcsSnrModel(p: SnrModelInput): { snr: number; shot: number; speckle: number } {
  const bb = p.beta * p.decay;
  const shot = bb * p.nPerPixFrame * Math.sqrt((p.nPix * p.nFrames * p.lEff) / (1 + p.beta));
  const speckle = bb / speckleSamplingErr(p.beta, p.nPix, p.cohAreaPx, p.nFrames, p.gammaFrame);
  const snr = shot > 0 && speckle > 0 ? 1 / Math.sqrt(1 / (shot * shot) + 1 / (speckle * speckle)) : 0;
  return { snr, shot, speckle };
}

/**
 * Speckle-sampling (flux-independent) standard error of a ring-averaged contrast / g2 value: √(v/M) with
 * M = (N_pix/A_c)(1 + κ N_f Γ) independent speckle realisations (κ = 1.1, v from speckleEstimatorVar).
 * Used as a floor for the per-lag error bars: the sector scatter alone under-reads it when few speckle
 * realisations have been seen (short runs), because all lags share the same speckles.
 */
export function speckleSamplingErr(beta: number, nPix: number, cohAreaPx: number, nFrames: number, gammaFrame: number): number {
  const M = (nPix / cohAreaPx) * (1 + 1.1 * nFrames * gammaFrame);
  return M > 0 ? Math.sqrt(speckleEstimatorVar(beta) / M) : Infinity;
}

/**
 * How much longer a source with `gain`× fewer photons must measure to reach the same SNR, for long runs
 * (both noise terms ∝ √T):  T_A/T_U = (G² + x)/(1 + x),  x = (SNR_shot,U / SNR_spk)².
 * → G² when even the bright source is photon-starved (x ≪ 1); → 1 when both are speckle-limited.
 */
export function equalSnrTimeRatio(gain: number, shotU: number, speckle: number): number {
  const x = speckle > 0 ? (shotU / speckle) ** 2 : 0;
  return (gain * gain + x) / (1 + x);
}

/** Exposure (frame-integration) contrast reduction for exponential decay: β_eff/β, x = Γ t_f. */
export function exposureFactor(x: number): number {
  if (x < 1e-4) return 1 - (2 * x) / 3;
  return (Math.exp(-2 * x) - 1 + 2 * x) / (2 * x * x);
}

/**
 * Residual speckle contrast of a long exposure taken as an exponential moving average with time constant tE,
 * for speckle whose field decays as e^{−τ/τc} (g2 − 1 = β e^{−2τ/τc}):
 *   β_eff = β ∫∫ w(t) w(t′) e^{−2|t−t′|/τc} / (∫w)² = β / (1 + 2 tE/τc)   (w = e^{−t/tE})  ≈ β τc / 2tE.
 */
export function emaResidualContrast(beta: number, tauC: number, tE: number): number {
  return beta / (1 + (2 * tE) / tauC);
}

/**
 * A ring of radius r (detector px) on a square detector of half-width `half` px only exists in the corners
 * once r > half: move the angle θ to the nearest angle at which the ring point lies on the detector
 * (|r cos θ|, |r sin θ| ≤ half), keeping the quadrant. Unchanged for r ≤ half.
 */
export function fitRingAngle(r: number, theta: number, half: number): number {
  if (r <= half) return theta;
  const c = Math.min(1, half / r);
  const lo = Math.acos(c);
  const hi = Math.asin(c);
  const cs = Math.cos(theta);
  const sn = Math.sin(theta);
  const phi = Math.atan2(Math.abs(sn), Math.abs(cs));
  const p = lo <= hi ? Math.max(lo, Math.min(hi, phi)) : Math.PI / 4;
  return Math.atan2((sn < 0 ? -1 : 1) * Math.sin(p), (cs < 0 ? -1 : 1) * Math.cos(p));
}

export interface G2Fit {
  beta: number;
  gamma: number;
  chi2: number;
  /** 1σ statistical error of ln Γ from the χ² curvature (β profiled; lag-to-lag correlations ignored) */
  sigLnGamma: number;
  ok: boolean;
}

/**
 * Weighted least-squares fit of g2 = 1 + β exp(−2Γτ). Grid search in log Γ (β solved analytically for
 * each Γ), then golden-section refinement. Robust for very noisy data; τ in any unit, Γ in its inverse.
 */
export function fitG2(
  tau: ArrayLike<number>,
  g2: ArrayLike<number>,
  sigma: ArrayLike<number> | null,
  n: number,
  gMin: number,
  gMax: number,
): G2Fit {
  const evalAt = (gam: number): [number, number] => {
    let sye = 0;
    let see = 0;
    for (let i = 0; i < n; i++) {
      const y = g2[i] - 1;
      if (!Number.isFinite(y)) continue;
      const w = sigma ? 1 / Math.max(1e-12, sigma[i] * sigma[i]) : 1;
      const e = Math.exp(-2 * gam * tau[i]);
      sye += w * y * e;
      see += w * e * e;
    }
    const beta = see > 0 ? Math.max(0, sye / see) : 0;
    let chi = 0;
    for (let i = 0; i < n; i++) {
      const y = g2[i] - 1;
      if (!Number.isFinite(y)) continue;
      const w = sigma ? 1 / Math.max(1e-12, sigma[i] * sigma[i]) : 1;
      const r = y - beta * Math.exp(-2 * gam * tau[i]);
      chi += w * r * r;
    }
    return [chi, beta];
  };
  const STEPS = 64;
  const l0 = Math.log(gMin);
  const l1 = Math.log(gMax);
  let best = 0;
  let bestChi = Infinity;
  for (let s = 0; s <= STEPS; s++) {
    const c = evalAt(Math.exp(l0 + ((l1 - l0) * s) / STEPS))[0];
    if (c < bestChi) {
      bestChi = c;
      best = s;
    }
  }
  // golden-section refinement in log Γ around the best grid point
  let a = l0 + ((l1 - l0) * Math.max(0, best - 1)) / STEPS;
  let b = l0 + ((l1 - l0) * Math.min(STEPS, best + 1)) / STEPS;
  const gr = 0.6180339887;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = evalAt(Math.exp(c))[0];
  let fd = evalAt(Math.exp(d))[0];
  for (let it = 0; it < 30; it++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = evalAt(Math.exp(c))[0];
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = evalAt(Math.exp(d))[0];
    }
  }
  const lg = (a + b) / 2;
  const gam = Math.exp(lg);
  const [chi2, beta] = evalAt(gam);
  const h = 0.05;
  const cp = evalAt(Math.exp(lg + h))[0];
  const cm = evalAt(Math.exp(lg - h))[0];
  const curv = (cp + cm - 2 * chi2) / (h * h);
  const sigLnGamma = curv > 0 ? Math.sqrt(2 / curv) : Infinity;
  const edge = lg < l0 + 1e-3 || lg > l1 - 1e-3;
  return { beta, gamma: gam, chi2, sigLnGamma, ok: Number.isFinite(chi2) && beta > 0 && !edge };
}

// ------------------------------------------------------------------ formatting helpers (pure)

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** 1.14×10⁻³ style. */
export function sci(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  const m = v / Math.pow(10, e);
  const ms = m.toFixed(digits - 1);
  if (ms === '10' || ms === '10.0') return sci(v * 1.0000001, digits);
  const es = String(e)
    .split('')
    .map((ch) => SUP[ch] ?? ch)
    .join('');
  return `${ms}×10${es}`;
}

/** Seconds → "52 µs", "3.6 ms", "0.42 s", "2.1 min". */
export function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const a = Math.abs(s);
  const p = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/0$/, ''));
  if (a < 1e-3) return `${p(s * 1e6)} µs`;
  if (a < 1) return `${p(s * 1e3)} ms`;
  if (a < 120) return `${p(s)} s`;
  if (a < 7200) return `${p(s / 60)} min`;
  if (a < 172800) return `${p(s / 3600)} h`;
  return `${p(s / 86400)} days`;
}

/** Length in metres → "550 nm" / "1.3 µm". */
export function fmtLen(m: number): string {
  if (m < 1e-6) return `${Math.round(m * 1e9)} nm`;
  return `${(m * 1e6).toFixed(m < 1e-5 ? 2 : 1)} µm`;
}
