/**
 * Physics and data for the "brightness" station. Pure functions only (unit-tested in tests/brightness.test.ts).
 *
 * DEFINITION (spectral brightness, a.k.a. brilliance; Kim 1989, X-ray Data Booklet §2.1)
 *   B = F / (4π² Σ_x Σ′_x Σ_y Σ′_y)            [ph / s / mm² / mrad² / 0.1 % BW]
 *   F = spectral flux in a 0.1 % bandwidth; Σ, Σ′ = rms photon source size and divergence (Gaussian beams, waist
 *   at the source point, no x–x′ correlation). Equivalent: F / (2πΣ_xΣ_y · 2πΣ′_xΣ′_y) = flux / (source area ×
 *   solid angle), with "area" and "solid angle" the Gaussian effective values 2πΣ_xΣ_y and 2πΣ′_xΣ′_y.
 *
 * PHOTON SOURCE = electron beam ⊗ single-electron undulator radiation (Kim 1989, Gaussian approximation):
 *   Σ² = σ_e² + σ_r²,  Σ′² = σ_e′² + σ_r′²,   σ_r = √(2λL)/4π,  σ_r′ = √(λ/2L)   ⇒  σ_r σ_r′ = λ/4π
 *   L = 2.4 m (a full-length APS undulator; the same convention as the facility dossier's coherence estimates).
 *   Caveats (the station's notes name the main simplifications): Tanaka & Kitamura (2009) give σ_r ≈ 2× Kim's
 *   and an energy-spread broadening of σ_r′ (σ_δ = 0.136 % at APS-U) that matters for high harmonics;
 *   zero-current electron beams; β-mismatch between electron and photon beams is ignored.
 * DIFFRACTION LIMIT: a perfect (zero-emittance) electron beam gives Σ_iΣ′_i = λ/4π per plane, so
 *   B_max = F / (4π² (λ/4π)²) = 4F/λ²  (fully coherent beam; Kim 1989).
 *
 * LENS + SLIT ACCEPTANCE (panel 1) — wave-optics exact. A thin lens (f = 7.5 m) with a soft aperture at z₁ = 15 m
 *   images the source 1:1 onto a soft slit at z₂ = 30 m: the slit selects source POSITION, the lens aperture
 *   selects emission ANGLE, so the count measures photons per (size × angle), i.e. brightness. (Two bare slits far
 *   from the source cannot do this: their acceptance at the source has β = (z₁² + z₂²)/Δz ≥ 72 m for z₁ ≥ 15 m,
 *   badly mismatched to an APS-U photon beam with β = Σ/Σ′ ≈ 1.5–3 m, so every source below ~30 µm looks like a
 *   point to them and the count saturates far below the brightness gain. The lens makes β_acc ≈ s₂z₁/s₁ = 2 m.)
 *   Both apertures are tall GAUSSIAN (apodized) slits, amplitude transmission t(x) = exp(−x²/4s²), intensity
 *   exp(−x²/2s²) (a parabolic CRL's absorption aperture is Gaussian too). For a Gaussian Schell-model beam (Kim's
 *   Gaussian photon source is one) the Wigner function W(x, θ) is a positive Gaussian and is transformed EXACTLY by
 *     free drift:        W(x, θ) → W(x − θz, θ)                                (a shear: rays)
 *     thin lens:         W(x, θ) → W(x, θ + x/f)                               (a shear: θ → θ − x/f)
 *     Gaussian aperture: W(x, θ) → e^{−x²/2s²} · [W(x, ·) ⊛ N(0, d²)](θ),  d = λ/(4π s)  (diffraction kick)
 *   (multiply the field by t, take the Wigner transform: t(x+y/2)t(x−y/2) = e^{−x²/2s²} e^{−y²/8s²}). So photons
 *   sampled from W, passed with probability e^{−x²/2s²}, kicked by N(0, d²) and bent by −x/f at the lens are an
 *   exact Monte Carlo of the wave intensity. The pass probability is analytic (Gaussian conditioning,
 *   passFraction). Effective acceptance A = ∫∫ (pass probability) dx dθ = 2π s₁s₂/(z₂ − z₁) (∂(x₁,x₂)/∂(x₀,θ) = Δz
 *   with or without the lens; the kick conserves it), and P ≤ A/(2πΣΣ′) (peak phase-space density × acceptance)
 *   with equality when the beam overfills it (Liouville) — the photon rate through a small acceptance is set by
 *   brightness, not by total flux. s₁ = 30 µm ≙ 75 µm hard, s₂ = 4 µm ≙ 10 µm hard (width √(2π)s). Diffraction
 *   (λ/4πs₁ = 3.3 µrad at 1 keV, 0.16 µrad at 20 keV, i.e. a diffraction-limited focus of rms Δz·λ/4πs₁) lowers P
 *   at low E. Only the horizontal plane is tested (tall slits), so the count ignores the vertical factor of B.
 *
 * ELECTRON BEAMS at the ID source point (rms, zero current):
 *   APS 2019 (7 GeV, 100 mA, ε_x 3.1 nm): σ_x 275 µm, σ_x′ 11 µrad, σ_y 10 µm, σ_y′ 3.5 µrad — FDR 2019 Table 2.1.
 *   APS-U (6 GeV, 200 mA) round, κ = 1 (user mode): 12.3 µm, 2.34 µrad, 8.3 µm, 3.47 µrad — APS Storage Ring
 *   Parameters 2024 (Borland), Table 5.  Flat, κ = 0.1: 14.5 µm, 2.75 µrad, 3.1 µm, 1.29 µrad — same table.
 *
 * DESIGN BRILLIANCE CURVES (panel 2) — all are design calculations; no measured APS-U brightness curve has been
 * published (facility dossier, Oct. 2026):
 *   ENVELOPE: IPAC'21 MOXA02 (R. Hettel, "Status of the APS-U Project") Fig. 1, upper envelope over all candidate
 *     undulators, APS vs APS-U, digitized by the facility dossier (±20 % in value, ±3 % in energy).
 *   DEVICES: APS-U FDR 2019 Fig. 2.1 (vector paths, exact) — APS: HPM 3.3 & 2.7 cm × 4.8 m at 10.75 mm gap;
 *     APS-U: HPMU 2.8 & 2.5 cm × 4.6 m at 8.5 mm; SCU 2.05 & 1.55 cm × 3.5 m at 8.0 mm (FDR Table 2.2).
 *   ANCHOR: FDR 2019 Table 1.1 at 20 keV (undulator optimized for 20 keV): APS 6×10¹⁹, APS-U brightness mode
 *     (324 bunches) 3.25×10²² → ×540; the facility's "up to 500× brighter" headline.
 *   Curves between digitized points: monotone cubic (Fritsch–Carlson) in log B vs log E (no overshoot).
 */

export const HC_KEV_ANGSTROM = 12.398419843; // h·c in keV·Å
export const L_UND = 2.4; // m

/** Photon wavelength in metres for an energy in keV. */
export function wavelength(EkeV: number): number {
  return (HC_KEV_ANGSTROM / EkeV) * 1e-10;
}

/** Photon "emittance" λ/4π in µm·µrad (= pm·rad) at E keV. */
export function diffractionLimitUmUrad(EkeV: number): number {
  return (wavelength(EkeV) / (4 * Math.PI)) * 1e12;
}

/** Single-electron undulator radiation (Kim): rms size [µm] and divergence [µrad]. */
export function singleElectron(EkeV: number, L = L_UND): { size: number; div: number } {
  const lam = wavelength(EkeV);
  return { size: (Math.sqrt(2 * lam * L) / (4 * Math.PI)) * 1e6, div: Math.sqrt(lam / (2 * L)) * 1e6 };
}

/** rms electron (or photon) beam sizes at the source point: µm and µrad. */
export interface Beam {
  sx: number;
  sxp: number;
  sy: number;
  syp: number;
}

export interface Ring {
  id: 'aps' | 'round' | 'flat';
  name: string;
  /** electron beam at the ID source point */
  e: Beam;
  source: string;
}

export const APS_2019: Ring = {
  id: 'aps',
  name: 'APS (2019)',
  e: { sx: 275, sxp: 11, sy: 10, syp: 3.5 },
  source: 'FDR 2019 Table 2.1',
};
export const APSU_ROUND: Ring = {
  id: 'round',
  name: 'APS-U round (κ = 1)',
  e: { sx: 12.3, sxp: 2.34, sy: 8.3, syp: 3.47 },
  source: 'Storage Ring Parameters 2024, Table 5',
};
export const APSU_FLAT: Ring = {
  id: 'flat',
  name: 'APS-U flat (κ = 0.1)',
  e: { sx: 14.5, sxp: 2.75, sy: 3.1, syp: 1.29 },
  source: 'Storage Ring Parameters 2024, Table 5',
};
export const RINGS = { aps: APS_2019, round: APSU_ROUND, flat: APSU_FLAT } as const;

/** Photon source = electron beam ⊗ single-electron radiation (quadrature sums), µm and µrad. */
export function photonBeam(e: Beam, EkeV: number, L = L_UND): Beam {
  const r = singleElectron(EkeV, L);
  return {
    sx: Math.hypot(e.sx, r.size),
    sxp: Math.hypot(e.sxp, r.div),
    sy: Math.hypot(e.sy, r.size),
    syp: Math.hypot(e.syp, r.div),
  };
}

/** Effective source area 2πΣ_xΣ_y in mm². */
export function sourceAreaMm2(p: Beam): number {
  return 2 * Math.PI * p.sx * p.sy * 1e-6;
}

/** Effective solid angle 2πΣ′_xΣ′_y in mrad². */
export function solidAngleMrad2(p: Beam): number {
  return 2 * Math.PI * p.sxp * p.syp * 1e-6;
}

/** Brightness [ph/s/mm²/mrad²/0.1%BW] of a photon beam p (µm, µrad) carrying spectral flux F [ph/s/0.1%BW]. */
export function brightness(F: number, p: Beam): number {
  return F / (sourceAreaMm2(p) * solidAngleMrad2(p));
}

/** Diffraction-limited (fully coherent) brightness 4F/λ² with λ in mm·mrad units (λ/4π per plane). */
export function brightnessLimit(F: number, EkeV: number): number {
  const e = diffractionLimitUmUrad(EkeV) * 1e-6; // mm·mrad
  return F / (4 * Math.PI * Math.PI * e * e);
}

/** Brightness gain of electron beam `a` over `b` at the same flux (pure source-size/divergence effect). */
export function sourceGain(a: Beam, b: Beam, EkeV: number, L = L_UND): number {
  const pa = photonBeam(a, EkeV, L);
  const pb = photonBeam(b, EkeV, L);
  return (pb.sx * pb.sxp * pb.sy * pb.syp) / (pa.sx * pa.sxp * pa.sy * pa.syp);
}

// ------------------------------------------------------------------ lens + slit acceptance (Gaussian apertures)

export interface Slits {
  /** rms widths of the intensity transmission e^{−x²/2s²} [µm]: s1 = lens aperture, s2 = slit */
  s1: number;
  s2: number;
  /** distances from the source [m] */
  z1: number;
  z2: number;
  /** focal length of the thin lens at z1 [m] (Infinity = no lens, two bare slits) */
  f: number;
}

/** Panel 1: lens (f = 7.5 m, aperture rms 30 µm) at 15 m imaging the source 1:1 onto a slit (rms 4 µm) at 30 m. */
export const SLITS: Slits = { s1: 30, s2: 4, z1: 15, z2: 30, f: 7.5 };

/** Focal length that images the source (z = 0) onto z2 with a lens at z1. */
export function imagingFocal(z1: number, z2: number): number {
  return (z1 * (z2 - z1)) / z2;
}

/** Equivalent hard-slit width √(2π)·s [µm] (same acceptance for an overfilling beam). */
export function hardWidth(s: number): number {
  return Math.sqrt(2 * Math.PI) * s;
}

/** Intensity transmission of a Gaussian slit of rms s at position x (µm). */
export function slitTransmission(x: number, s: number): number {
  return Math.exp((-0.5 * x * x) / (s * s));
}

/** rms diffraction kick λ/(4π s) [µrad] given to a photon by a Gaussian slit of rms s [µm] at E keV. */
export function diffractionKick(EkeV: number, s: number): number {
  return diffractionLimitUmUrad(EkeV) / s;
}

/** Effective phase-space acceptance 2π s₁s₂/(z₂−z₁) in µm·µrad. */
export function acceptance(sl: Slits): number {
  return (2 * Math.PI * sl.s1 * sl.s2) / (sl.z2 - sl.z1);
}

/** Second moments of the transmitted photons just after the lens aperture (µm², µm·µrad, µrad²) and its pass probability. */
export interface AfterLens {
  p1: number;
  xx: number;
  xt: number;
  tt: number;
}

/**
 * Photons from a Gaussian source (rms size S µm, divergence Sp µrad, waist at z = 0) at the lens plane z₁:
 * drifted covariance conditioned on the aperture (Kalman update with "noise" s₁²; pass probability
 * √(s₁²/(s₁² + ⟨x²⟩))), bent by the lens (θ → θ − x/f) and kicked in θ by d₁² (diffraction = false: rays only).
 */
export function afterLens(S: number, Sp: number, EkeV: number, sl: Slits = SLITS, diffraction = true): AfterLens {
  const vt = Sp * Sp;
  const xx = S * S + sl.z1 * sl.z1 * vt;
  const xt = sl.z1 * vt;
  const tt = vt;
  const q1 = sl.s1 * sl.s1;
  const den = xx + q1;
  const p1 = Math.sqrt(q1 / den);
  const cxx = xx - (xx * xx) / den;
  const cxt = xt - (xx * xt) / den;
  const ctt = tt - (xt * xt) / den;
  const k = Number.isFinite(sl.f) ? 1 / sl.f : 0;
  const lxt = cxt - k * cxx;
  let ltt = ctt - 2 * k * cxt + k * k * cxx;
  if (diffraction) {
    const d = diffractionKick(EkeV, sl.s1);
    ltt += d * d;
  }
  return { p1, xx: cxx, xt: lxt, tt: ltt };
}

/** rms width [µm] at distance z ≥ z₁ of the photons that passed the lens aperture. */
export function widthAfterLens(a: AfterLens, z: number, sl: Slits = SLITS): number {
  const dz = z - sl.z1;
  return Math.sqrt(Math.max(0, a.xx + 2 * dz * a.xt + dz * dz * a.tt));
}

/**
 * Exact probability that a photon passes the lens aperture and then the slit at z₂ (wave optics for Gaussian
 * beams: see the header). diffraction = false gives geometric rays only.
 */
export function passFraction(S: number, Sp: number, EkeV: number, sl: Slits = SLITS, diffraction = true): number {
  const a = afterLens(S, Sp, EkeV, sl, diffraction);
  const w = widthAfterLens(a, sl.z2, sl);
  const q2 = sl.s2 * sl.s2;
  return a.p1 * Math.sqrt(q2 / (q2 + w * w));
}

/** Upper bound (and overfilled-beam limit) of passFraction: A / (2πΣΣ′). */
export function passFractionSmall(S: number, Sp: number, sl: Slits = SLITS): number {
  return acceptance(sl) / (2 * Math.PI * S * Sp);
}

// ------------------------------------------------------------------ design brilliance data

export interface Series {
  id: string;
  label: string;
  E: number[];
  B: (number | null)[];
}

export interface DataSet {
  id: 'envelope' | 'devices';
  label: string;
  source: string;
  old: Series;
  neu: Series[];
}

const E_ENV = [1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];
export const ENVELOPE: DataSet = {
  id: 'envelope',
  label: "Design envelope, all candidate undulators (IPAC'21 Fig. 1, digitized ±20 %)",
  source: "R. Hettel, Proc. IPAC'21 MOXA02, Fig. 1 (digitized by the facility dossier)",
  old: {
    id: 'aps',
    label: 'APS (pre-2023)',
    E: E_ENV,
    B: [1.3e19, 1.6e19, 3e19, 1.3e20, 1.7e20, 1.6e20, 7.7e19, 6.4e19, 1e20, 4.5e19, 2.6e19, 1.2e19, 8.3e18, 2.7e18, 1.4e18],
  },
  neu: [
    {
      id: 'apsu',
      label: 'APS-U',
      E: E_ENV,
      B: [2.6e20, 1.2e21, 5.2e21, 1.1e22, 2.2e22, 3.1e22, 4.2e22, 4.4e22, 3.1e22, 1.7e22, 1.4e22, 9.5e21, 5.7e21, 2.1e21, 8.5e20],
    },
  ],
};

const E_DEV = [5, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80, 85, 90, 100, 110, 120];
export const DEVICES: DataSet = {
  id: 'devices',
  label: 'Specific undulators (APS-U FDR 2019 Fig. 2.1)',
  source: 'APS-U Final Design Report (2019) Fig. 2.1 and Table 2.2',
  old: {
    id: 'aps',
    label: 'APS: 3.3 & 2.7 cm, 4.8 m',
    E: E_DEV,
    B: [1.09e20, 1.55e20, 1.49e20, 1.26e20, 6.55e19, 4.8e19, 5.75e19, 3.85e19, 2.23e19, 1.19e19, 5.77e18, 3.24e18, 1.79e18, 1.25e18, null, null, null, null],
  },
  neu: [
    {
      id: 'hpmu',
      label: 'APS-U: 2.8 & 2.5 cm, 4.6 m',
      E: E_DEV,
      B: [8.97e21, 1.41e22, 1.37e22, 8.67e21, 8.07e21, 7.57e21, 5.22e21, 3.89e21, 1.98e21, 9.95e20, 4.98e20, 2.52e20, 1.26e20, 9.46e19, 6.44e19, 3.3e19, 1.64e19, 8.18e18],
    },
    {
      id: 'scu',
      label: 'APS-U superconducting: 2.05 & 1.55 cm, 3.5 m',
      E: E_DEV,
      B: [7.87e21, 1.35e22, 1.55e22, 2.37e22, 2.44e22, 1.15e22, 7.62e21, 5.55e21, 7.66e21, 2.71e21, 3.03e21, 1.37e21, 1.18e21, 8.39e20, 5.69e20, 2.22e20, 2.25e20, 9.53e19],
    },
  ],
};
export const DATASETS = { envelope: ENVELOPE, devices: DEVICES } as const;

/** FDR 2019 Table 1.1, 20 keV, undulator optimized for 20 keV. */
export const FDR_20KEV = { E: 20, aps: 6e19, apsuTiming: 1.54e22, apsuBrightness: 3.25e22 };
/** Key performance parameters (FDR Table 1.2; Strategic Plan 2025 Table 1). */
export const KPP = [
  { E: 20, threshold: 1e20, objective: 1e22 },
  { E: 60, threshold: 1e19, objective: 1e21 },
];

/**
 * Monotone piecewise-cubic interpolant (Fritsch–Carlson) of y(x). Returns NaN outside [x₀, x_n].
 * Points with null y are dropped (the series then ends there).
 */
export function monotoneInterpolant(xs: number[], ys: (number | null)[]): (x: number) => number {
  const X: number[] = [];
  const Y: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (y !== null && Number.isFinite(y)) {
      X.push(xs[i]);
      Y.push(y);
    }
  }
  const n = X.length;
  if (n === 0) return () => NaN;
  if (n === 1) return (x) => (x === X[0] ? Y[0] : NaN);
  const d = new Array<number>(n - 1);
  const h = new Array<number>(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = X[i + 1] - X[i];
    d[i] = (Y[i + 1] - Y[i]) / h[i];
  }
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (!(x >= X[0] && x <= X[n - 1])) return NaN;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (X[mid] <= x) lo = mid;
      else hi = mid;
    }
    const t = (x - X[lo]) / h[lo];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * Y[lo] + (t3 - 2 * t2 + t) * h[lo] * m[lo] + (-2 * t3 + 3 * t2) * Y[lo + 1] + (t3 - t2) * h[lo] * m[lo + 1];
  };
}

/** Brilliance curve B(E) of a series: monotone cubic in log10 B vs log10 E through the digitized points. */
export function seriesCurve(s: Series): (EkeV: number) => number {
  const f = monotoneInterpolant(
    s.E.map((e) => Math.log10(e)),
    s.B.map((b) => (b === null ? null : Math.log10(b))),
  );
  return (E) => Math.pow(10, f(Math.log10(E)));
}

/** Best APS-U value over the data set's APS-U series at E (NaN where none is defined). */
export function bestNew(ds: DataSet, curves: ((E: number) => number)[], E: number): number {
  let best = NaN;
  for (let i = 0; i < ds.neu.length; i++) {
    const v = curves[i](E);
    if (Number.isFinite(v) && !(v <= best)) best = v;
  }
  return best;
}
