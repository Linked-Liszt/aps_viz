/**
 * Physics for the ISN (19-ID-E) scanning X-ray fluorescence nanoprobe station. Pure functions, no DOM.
 *
 * 1. Fluorescence (thin-sample limit, no self-absorption: 100 nm NMC slice, μt < 1 % for every line here)
 *      N_line = Φ·t_dwell · (Ω/4π) · ε_det · m_el · σ_F,line(E₀)
 *    Φ photons/s on the spot, m_el areal mass (g/cm²) of the element under the probe (probe-weighted),
 *    σ_F = τ_shell(E₀) · ω · p_line the fluorescence-line production cross section (cm²/g).
 *    σ_F values: xraylib 4.3 CS_FluorLine_Kissel_Cascade (Schoonjans et al., Spectrochim. Acta B 66, 776 (2011)),
 *    fitted here as ln σ = c₀ + c₁u + c₂u², u = ln(E₀/E_K) (max error < 2 % from the edge to 30 keV);
 *    W L-subshell groups as knot tables (the L₃ lines jump at the L₂ and L₁ edges through Coster–Kronig cascades).
 *    σ_F = 0 below the edge: an element only fluoresces when E₀ exceeds its K (or L) binding energy.
 *    Line energies / edges: xraylib (= Deslattes et al., Rev. Mod. Phys. 75, 35 (2003) / Bearden & Burr).
 *    ε_det = 1 (thick Si SDD, 4–12 keV); Ω = 0.1 sr (7-element SDD a few cm from an in situ cell; illustrative).
 * 2. Detector: Gaussian lines, FWHM² = FWHM_el² + 2.3548²·F·ε·E (Si: Fano F = 0.115, ε = 3.65 eV/pair,
 *    FWHM_el = 50 eV → 127 eV at Mn Kα; ISN PDR spec ≈ 125 eV). A 0.5 % flat low-energy shelf per line
 *    (incomplete charge collection, P/B ≈ 10⁴). No escape / sum / pile-up peaks.
 *    Scatter: Rayleigh at E₀ and Compton at E₀/(1+(E₀/mc²)(1−cos 90°)), cone-averaged (10°) polarised
 *    differential cross sections at 90° in the storage-ring plane (xraylib DCSP_*), sample + 10 µm of
 *    carbonate electrolyte as the in situ cell (illustrative).
 *    Throughput: total input rate kept ≤ 3×10⁷ cps (7 channels × ~4 Mcps, Xspress3; illustrative); above it
 *    the station "inserts attenuators" (Φ_eff = Φ·R_max/R), as a beamline would.
 * 3. Focused flux (photons/s into the spot):
 *    APS-U = FDR (2019) Table 4.52 design values for ISN (DCM, Si(111)):
 *      coherent (BDAs closed): 3.5×10¹² ph/s in 39×39 nm² at 10 keV; 3.4×10¹¹ ph/s in 16×16 nm² at 25 keV
 *      BDAs open:              8.9×10¹² ph/s in 43×52 nm² at 10 keV; 3.1×10¹² ph/s in 24×30 nm² at 25 keV
 *    Energy dependence: F_coh(E) = η(E)·F_c,source(E), F_c,source = facility coherent-flux design curve
 *    (ph/s/0.1 %BW, digitised IPAC'21 Fig. 1, ±20 %), η log-interpolated between the two FDR anchors.
 *    Minimum (coherent) spot s_d = 390 nm·keV / E (FDR: 39 nm @10 keV, 16 nm @25 keV), ≈ 0.88 λ q/(L sinθ)
 *    (X. Shi et al. 2016) with KBH q = 125.5 mm, L = 129 mm, θ = 2.5 mrad → 42 nm @10 keV.
 *    Spots between s_d and the open-BDA spot: power-law interpolation of flux; larger spots by defocus (flux flat).
 *    APS (pre-2023) = the same optics on the old source: coherent flux lower by the facility coherent-flux ratio
 *    (≈160× @10 keV, ≈350× @25 keV); for bigger spots the old beam's extra transverse modes are accepted
 *    (Liouville: accepted phase space ∝ spot size per plane, up to the demagnified open-BDA source image,
 *    0.43 µm × 0.05 µm FWHM). So the APS-U gain is largest for the smallest spots (≈10–30× for ~1 µm).
 *    Old source (FDR Table 2.1): σx = 275 µm, σx' = 11 µrad, σy = 10 µm, σy' = 3.5 µrad, 2.4 m undulator A.
 * 4. Dose: D = (Φ t / step²) · E₀ · (μ_en/ρ)_NMC (xraylib CS_Energy_CP), independent of the source for equal counts.
 * Everything labelled "illustrative" above is stated as such in the station's specialist text.
 */

export type ElKey = 'Ni' | 'Mn' | 'Co' | 'W';
export const EL_KEYS: ElKey[] = ['Ni', 'Mn', 'Co', 'W'];

export interface LineDef {
  /** IUPAC-ish Siegbahn name */
  name: string;
  /** keV */
  e: number;
  /** fraction of the parent group's cross section */
  frac: number;
  /** group key inside the element ('K', 'Kb', 'L3', 'L2', 'L1') */
  group: string;
}

export interface EdgeDef {
  label: string;
  e: number;
}

export interface ElementDef {
  key: ElKey;
  name: string;
  Z: number;
  /** g/mol */
  A: number;
  color: string;
  /** absorption edges relevant here (keV), lowest first */
  edges: EdgeDef[];
  /** principal line used for labels */
  main: { name: string; e: number };
  lines: LineDef[];
}

// --------------------------------------------------------------------------------------------- K shells

interface KFit {
  eK: number;
  c: [number, number, number];
  /** Kα2/Kα1 */
  a21: number;
  /** Kβ/Kα (KM2,3 + KN2,3 + KM4,5…) */
  ba: number;
}

/** xraylib 4.3 CS_FluorLine_Kissel_Cascade fits (Kα1+Kα2), u = ln(E/E_K); max error 1.4–1.8 %. */
const K_FIT: Record<'Ni' | 'Mn' | 'Co', KFit> = {
  Mn: { eK: 6.539, c: [4.73137, -2.53425, -0.14279], a21: 0.5097, ba: 0.1339 },
  Co: { eK: 7.7089, c: [4.67128, -2.53011, -0.14907], a21: 0.5113, ba: 0.1351 },
  Ni: { eK: 8.3328, c: [4.67306, -2.52848, -0.15215], a21: 0.5118, ba: 0.1356 },
};

/** Kα (Kα1 + Kα2) fluorescence production cross section, cm²/g. */
export function kAlphaXS(el: 'Ni' | 'Mn' | 'Co', E: number): number {
  const f = K_FIT[el];
  if (E <= f.eK) return 0;
  const u = Math.log(E / f.eK);
  return Math.exp(f.c[0] + f.c[1] * u + f.c[2] * u * u);
}

// --------------------------------------------------------------------------------------------- W L shells

/** W L-subshell edges (keV) */
export const W_EDGES = { L3: 10.2068, L2: 11.544, L1: 12.0998 };

/**
 * xraylib 4.3 CS_FluorLine_Kissel_Cascade summed over each subshell's lines (cm²/g), [E keV, σ].
 * xraylib's value within ~10 eV of the L3/L2 edges is an interpolation artefact (27.7 / 11.5, vs 36.2 / 18.3 just
 * 13 / 56 eV above), so the first knots sit at 10.22 / 11.6 keV and the value is held flat down to the edge.
 */
const W_KNOTS: Record<'L3' | 'L2' | 'L1', [number, number][]> = {
  L3: [
    [10.22, 36.226], [10.3, 34.817], [10.5, 33.2], [10.8, 30.775], [11.0, 29.306], [11.5, 25.942], [11.543, 25.672],
    [11.545, 27.052], [11.6, 27.522], [11.8, 26.226], [12.0988, 24.494], [12.1008, 27.409], [12.2, 26.901], [12.5, 25.255],
    [13, 22.781], [14, 18.692], [15, 15.515], [17, 11.025], [20, 7.06], [22.5, 5.078], [25, 3.782], [30, 2.255],
  ],
  L2: [
    [11.6, 18.267], [11.8, 17.18], [12.0988, 16.172], [12.1008, 17.124], [12.2, 16.809], [12.5, 15.84], [13, 14.346],
    [14, 11.882], [15, 9.968], [17, 7.174], [20, 4.641], [22.5, 3.379], [25, 2.525], [30, 1.52],
  ],
  L1: [[12.1008, 3.711], [12.5, 3.606], [13, 3.371], [14, 2.962], [15, 2.626], [17, 2.092], [20, 1.534], [22.5, 1.215], [25, 0.984], [30, 0.673]],
};

/** piecewise log-log interpolation on knots; 0 at/below `edge`; flat between the edge and the first knot */
export function knotInterp(knots: [number, number][], edge: number, E: number): number {
  if (E <= edge) return 0;
  if (E <= knots[0][0]) return knots[0][1];
  const n = knots.length;
  let i = 0;
  while (i < n - 2 && E > knots[i + 1][0]) i++;
  const [e0, s0] = knots[i];
  const [e1, s1] = knots[i + 1];
  const t = Math.log(E / e0) / Math.log(e1 / e0);
  return Math.exp(Math.log(s0) + t * (Math.log(s1) - Math.log(s0)));
}

export function wSubshellXS(shell: 'L3' | 'L2' | 'L1', E: number): number {
  return knotInterp(W_KNOTS[shell], W_EDGES[shell], E);
}

// --------------------------------------------------------------------------------------------- elements

const kLines = (el: 'Ni' | 'Mn' | 'Co', ka1: number, ka2: number, kb: number): LineDef[] => {
  const f = K_FIT[el];
  return [
    { name: 'Kα₁', e: ka1, frac: 1 / (1 + f.a21), group: 'K' },
    { name: 'Kα₂', e: ka2, frac: f.a21 / (1 + f.a21), group: 'K' },
    { name: 'Kβ', e: kb, frac: f.ba, group: 'K' },
  ];
};

/** Elements of the synthetic W-doped NMC811 cathode. Colours are the station's element palette. */
export const ELEMENTS: Record<ElKey, ElementDef> = {
  Ni: {
    key: 'Ni', name: 'nickel', Z: 28, A: 58.693, color: '#3ee08f',
    edges: [{ label: 'Ni K', e: 8.3328 }], main: { name: 'Kα', e: 7.4781 },
    lines: kLines('Ni', 7.4781, 7.4609, 8.2647),
  },
  Mn: {
    key: 'Mn', name: 'manganese', Z: 25, A: 54.938, color: '#ff6fb5',
    edges: [{ label: 'Mn K', e: 6.539 }], main: { name: 'Kα', e: 5.8987 },
    lines: kLines('Mn', 5.8987, 5.8876, 6.4904),
  },
  Co: {
    key: 'Co', name: 'cobalt', Z: 27, A: 58.933, color: '#8f9bff',
    edges: [{ label: 'Co K', e: 7.7089 }], main: { name: 'Kα', e: 6.9303 },
    lines: kLines('Co', 6.9303, 6.9153, 7.6494),
  },
  W: {
    key: 'W', name: 'tungsten', Z: 74, A: 183.84, color: '#ffc23d',
    edges: [
      { label: 'W L₃', e: W_EDGES.L3 },
      { label: 'L₂', e: W_EDGES.L2 },
      { label: 'L₁', e: W_EDGES.L1 },
    ],
    main: { name: 'Lα', e: 8.3976 },
    // fractions within each subshell (xraylib, constant above the edges)
    lines: [
      { name: 'Lα₁', e: 8.3976, frac: 0.7339, group: 'L3' },
      { name: 'Lα₂', e: 8.3352, frac: 0.0832, group: 'L3' },
      { name: 'Lℓ', e: 7.3872, frac: 0.0382, group: 'L3' },
      { name: 'Lβ₂', e: 9.9614, frac: 0.1302, group: 'L3' },
      { name: 'Lβ₁₅', e: 9.948, frac: 0.0145, group: 'L3' },
      { name: 'Lβ₁', e: 9.6724, frac: 0.8431, group: 'L2' },
      { name: 'Lγ₁', e: 11.2852, frac: 0.1569, group: 'L2' },
      { name: 'Lβ₃', e: 9.8188, frac: 0.4435, group: 'L1' },
      { name: 'Lβ₄', e: 9.5249, frac: 0.3543, group: 'L1' },
      { name: 'Lγ₃', e: 11.6745, frac: 0.1153, group: 'L1' },
      { name: 'Lγ₂', e: 11.6082, frac: 0.087, group: 'L1' },
    ],
  },
};

/** lowest edge that must be exceeded for the element to fluoresce at all */
export function firstEdge(el: ElKey): number {
  return ELEMENTS[el].edges[0].e;
}

export function isExcited(el: ElKey, E0: number): boolean {
  return E0 > firstEdge(el);
}

/** fluorescence production cross section of one line at incident energy E0 (cm²/g) */
export function lineXS(el: ElKey, line: LineDef, E0: number): number {
  if (el === 'W') return wSubshellXS(line.group as 'L3' | 'L2' | 'L1', E0) * line.frac;
  return kAlphaXS(el, E0) * line.frac;
}

/** total detected-line cross section of an element (all its lines in the window), cm²/g */
export function elementXS(el: ElKey, E0: number): number {
  let s = 0;
  for (const l of ELEMENTS[el].lines) s += lineXS(el, l, E0);
  return s;
}

// --------------------------------------------------------------------------------------------- detector & scatter

export const DET = {
  /** solid angle (sr): 7-element SDD a few cm from an in situ cell (illustrative) */
  omegaSr: 0.1,
  fano: 0.115,
  /** keV per e-h pair in Si */
  epsKeV: 0.00365,
  /** electronic-noise FWHM, keV */
  fwhmEl: 0.05,
  /** max total input count rate kept by the "auto-attenuator" (illustrative, 7 × ~4 Mcps) */
  maxCps: 3e7,
  /** fraction of each line's counts in the flat low-energy shelf */
  shelf: 0.005,
};
export const OMEGA_FRAC = DET.omegaSr / (4 * Math.PI);

/** SDD energy resolution (FWHM, keV) at energy E (keV) */
export function detFwhm(E: number): number {
  return Math.sqrt(DET.fwhmEl * DET.fwhmEl + 2.3548 * 2.3548 * DET.fano * DET.epsKeV * E);
}

/** Compton-scattered photon energy (keV), scattering angle θ (rad) */
export function comptonE(E0: number, theta = Math.PI / 2): number {
  return E0 / (1 + (E0 / 510.999) * (1 - Math.cos(theta)));
}

/**
 * Cone-averaged (10° half-angle ≈ 0.1 sr) polarised differential scattering cross sections at 2θ = 90° in the
 * horizontal (polarisation) plane, cm²/g/sr. Power-law fits to xraylib DCSP_Rayl_CP / DCSP_Compt_CP (6–25 keV, ±8 %).
 */
export function scatterDCS(E0: number): { rayNMC: number; comNMC: number; rayEnv: number; comEnv: number } {
  const x = E0 / 6;
  return {
    rayNMC: 0.00246 * Math.pow(x, -1.66),
    comNMC: 0.00016 * Math.pow(x, 0.44),
    rayEnv: 0.00046 * Math.pow(x, -1.71),
    comEnv: 0.00025 * Math.pow(x, 0.256),
  };
}

// --------------------------------------------------------------------------------------------- sample

/** Synthetic sample constants (W-doped NMC811 thin slice in a liquid cell). */
export const SAMPLE = {
  thicknessNm: 100,
  /** g/cm³ (LiNi0.8Mn0.1Co0.1O2) */
  density: 4.75,
  /** areal mass of the cell's electrolyte path seen by the beam, g/cm² (10 µm of EC, ρ = 1.32) */
  envMass: 1.32e-3,
};

/** formula mass of Li(Ni_x Mn_y Co_z)O2 */
export function nmcMolarMass(ni: number, mn: number, co: number): number {
  return 6.94 + ni * 58.693 + mn * 54.938 + co * 58.933 + 2 * 15.999;
}

/** NMC mass energy-absorption coefficient μ_en/ρ (cm²/g); xraylib CS_Energy_CP knots across the Mn/Co/Ni K edges */
const MU_EN_KNOTS: [number, number][] = [
  [5, 116.2], [5.75, 78.53], [6.538, 54.63], [6.54, 70.37], [7.1, 56.59], [7.708, 45.52], [7.71, 57.63], [8, 52.92],
  [8.332, 47.63], [8.334, 132.98], [9, 113.24], [10, 90.85], [11, 72.32], [12, 58.63], [13, 48.24], [14, 40.18],
  [15, 33.8], [17, 24.45], [20, 15.87], [22.5, 11.55], [25, 8.66],
];
export function nmcMuEn(E: number): number {
  return knotInterp(MU_EN_KNOTS, 0, Math.min(25, Math.max(5, E)));
}

/** absorbed dose (Gy) for `photons` spread over a step×step pixel at E0 */
export function doseGy(photons: number, stepNm: number, E0: number): number {
  const areaCm2 = (stepNm * 1e-7) ** 2;
  const J = E0 * 1.602176634e-16;
  return (photons / areaCm2) * J * nmcMuEn(E0) * 1000;
}

// --------------------------------------------------------------------------------------------- optics & flux

export const KB = {
  /** vertical mirror: length, image distance (m) */
  LV: 0.404,
  qV: 0.396,
  LH: 0.129,
  qH: 0.1255,
  theta: 2.5e-3,
  /** BDA → KB distances (m) */
  zV: 165,
  zH: 155.9,
  /** optical working distance, mm */
  wdMm: 61,
  /** source → sample (m) */
  lengthM: 220,
};

/** wavelength (m) */
export function lambdaM(E: number): number {
  return 12.39842e-10 / E;
}

/** diffraction-limited FWHM of a KB mirror (nm): 0.88 λ q / (L sinθ) */
export function kbDiffLimitNm(E: number, q: number, L: number, theta = KB.theta): number {
  return ((0.88 * lambdaM(E) * q) / (L * Math.sin(theta))) * 1e9;
}

/** coherence-matched beam-defining aperture (µm): Δ ≈ 0.44 λ z / (L sinθ) */
export function bdaCoherentUm(E: number, z: number, L: number, theta = KB.theta): number {
  return ((0.44 * lambdaM(E) * z) / (L * Math.sin(theta))) * 1e6;
}

/** smallest (coherent, diffraction-limited) ISN spot, nm FWHM — FDR: 39 nm @10 keV, 16 nm @25 keV */
export function spotMinNm(E: number): number {
  return 390 / E;
}

/** facility design coherent flux (ph/s/0.1%BW), digitised IPAC'21 Fig. 1 (facility dossier) */
const COH_E = [5, 8, 10, 15, 20, 25, 30];
const COH_APSU = [1.5e14, 1.1e14, 9.6e13, 6.1e13, 3.5e13, 1.7e13, 6.4e12];
const COH_APS = [1.8e12, 9.8e11, 5.9e11, 1.3e11, 6.0e10, 4.9e10, 1.8e10];

function loglogTable(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  let i = 0;
  if (x <= xs[0]) i = 0;
  else if (x >= xs[n - 1]) i = n - 2;
  else while (i < n - 2 && x > xs[i + 1]) i++;
  const t = Math.log(x / xs[i]) / Math.log(xs[i + 1] / xs[i]);
  return Math.exp(Math.log(ys[i]) + t * (Math.log(ys[i + 1]) - Math.log(ys[i])));
}

export type SourceKey = 'apsu' | 'aps';

export function sourceCoherentFlux(src: SourceKey, E: number): number {
  return loglogTable(COH_E, src === 'apsu' ? COH_APSU : COH_APS, Math.min(30, Math.max(5, E)));
}

/** two-anchor log-log interpolation (extrapolates with the same power law) */
function anchor2(E: number, e0: number, v0: number, e1: number, v1: number): number {
  return v0 * Math.pow(E / e0, Math.log(v1 / v0) / Math.log(e1 / e0));
}

/** FDR Table 4.52 anchors */
export const FDR = {
  coh10: 3.5e12,
  coh25: 3.4e11,
  open10: 8.9e12,
  open25: 3.1e12,
  /** open-BDA spot (geometric mean of H×V FWHM, nm) */
  sOpen10: Math.sqrt(43 * 52),
  sOpen25: Math.sqrt(24 * 30),
};

/** beamline efficiency η = focused coherent flux / source coherent flux per 0.1 %BW (Si(111) BW, mirrors, KB) */
export function beamlineEta(E: number): number {
  const e10 = FDR.coh10 / sourceCoherentFlux('apsu', 10);
  const e25 = FDR.coh25 / sourceCoherentFlux('apsu', 25);
  const v = anchor2(E, 10, e10, 25, e25);
  return Math.min(1.3 * e10, Math.max(0.85 * e25, v));
}

/** coherent (diffraction-limited spot) focused flux for a source, ph/s */
export function coherentFocusedFlux(src: SourceKey, E: number): number {
  return beamlineEta(E) * sourceCoherentFlux(src, E);
}

/** APS-U open-BDA flux / coherent flux (FDR: 2.54 @10 keV, 9.1 @25 keV) */
export function openRatio(E: number): number {
  const v = anchor2(E, 10, FDR.open10 / FDR.coh10, 25, FDR.open25 / FDR.coh25);
  return Math.min(12, Math.max(1.3, v));
}

/** APS-U open-BDA spot (nm FWHM): quadrature of s_d and a geometric source-image term fitted to the FDR */
export function openSpotNm(E: number): number {
  const g10 = Math.sqrt(FDR.sOpen10 ** 2 - spotMinNm(10) ** 2);
  const g25 = Math.sqrt(FDR.sOpen25 ** 2 - spotMinNm(25) ** 2);
  const g = anchor2(E, 10, g10, 25, g25);
  return Math.hypot(spotMinNm(E), g);
}

/**
 * Electron-beam source sizes (µm rms) and undulator length (m).
 * Old APS (2019): FDR Table 2.1. APS-U: brightness mode, flat beam, zero current (ISN dossier); 2 × 2.35 m revolvers.
 */
export const SOURCES = {
  aps: { sx: 275, sy: 10, undL: 2.4 },
  apsu: { sx: 14.5, sy: 3.1, undL: 4.7 },
};
/** M3 (35 m) → BDA-H (64 m) and M2 (29 m) → BDA-V (55 m) magnifications; KB demagnifications (dossier) */
const BDA_MAG = { H: (64 - 35) / 35, V: (55 - 29) / 29 };
const KB_DEMAG = { H: 1242, V: 417 };

/** single-electron (diffraction) source size, µm: √(2λL)/(4π) */
export function sigmaR(E: number, L: number): number {
  return (Math.sqrt(2 * lambdaM(E) * L) / (4 * Math.PI)) * 1e6;
}

/** demagnified open-BDA image (FWHM, nm) of a source at the ISN focus, per plane */
export function sourceImageNm(src: SourceKey, E: number): { h: number; v: number } {
  const s = SOURCES[src];
  const sr = sigmaR(E, s.undL);
  const Sx = Math.hypot(s.sx, sr);
  const Sy = Math.hypot(s.sy, sr);
  return { h: ((2.3548 * Sx * BDA_MAG.H) / KB_DEMAG.H) * 1e3, v: ((2.3548 * Sy * BDA_MAG.V) / KB_DEMAG.V) * 1e3 };
}

/**
 * Relative number of transverse modes the BDA+KB accept for a spot `s` (both planes): per plane the accepted
 * phase space grows ∝ spot/s_d (fixed KB NA) until the slit passes the whole source image (Liouville).
 */
export function acceptedModes(src: SourceKey, E: number, s: number): number {
  const sd = spotMinNm(E);
  const img = sourceImageNm(src, E);
  const m = Math.max(1, s / sd);
  return Math.min(m, Math.hypot(sd, img.h) / sd) * Math.min(m, Math.hypot(sd, img.v) / sd);
}

export interface FluxResult {
  /** spot actually delivered (nm FWHM) */
  spot: number;
  /** true if the request was below the diffraction limit */
  limited: boolean;
  /** ph/s into the spot */
  flux: number;
  /** 'coherent' | 'partial' | 'defocused' regime (APS-U) */
  regime: 'coherent' | 'partial' | 'defocused';
}

/** APS-U flux into a spot (FDR-anchored): coherent → open BDAs (power-law interpolation) → defocus (flat) */
function apsuFlux(E: number, s: number): number {
  const sd = spotMinNm(E);
  const so = openSpotNm(E);
  const rho = openRatio(E);
  const fc = coherentFocusedFlux('apsu', E);
  if (s >= so) return fc * rho;
  return fc * Math.pow(s / sd, Math.log(rho) / Math.log(so / sd));
}

/**
 * photons/s into a spot of (requested) FWHM `spotNm` at energy E for a source.
 * APS = APS-U × (old/new coherent flux, facility curves) × (modes accepted from the old beam / from the new one):
 * equal to the coherent-flux ratio at the diffraction-limited spot, shrinking as larger spots let the old
 * source's many incoherent modes through.
 */
export function focusedFlux(src: SourceKey, E: number, spotNm: number): FluxResult {
  const sd = spotMinNm(E);
  const limited = spotNm < sd;
  const s = Math.max(spotNm, sd);
  const fu = apsuFlux(E, s);
  if (src === 'apsu') {
    const regime = s <= sd * 1.001 ? 'coherent' : s < openSpotNm(E) ? 'partial' : 'defocused';
    return { spot: s, limited, flux: fu, regime };
  }
  const rCoh = sourceCoherentFlux('apsu', E) / sourceCoherentFlux('aps', E);
  const flux = (fu / rCoh) * (acceptedModes('aps', E, s) / acceptedModes('apsu', E, s));
  const img = sourceImageNm('aps', E);
  const regime = s <= sd * 1.001 ? 'coherent' : s < Math.hypot(sd, img.h) ? 'partial' : 'defocused';
  return { spot: s, limited, flux, regime };
}

/** APS-U / APS flux gain at the same spot and energy */
export function apsuGain(E: number, spotNm: number): number {
  return focusedFlux('apsu', E, spotNm).flux / focusedFlux('aps', E, spotNm).flux;
}

// --------------------------------------------------------------------------------------------- scan timing

/** fly-scan stage speed limit (nm/s): ISN horizontal fly scans up to 1 mm/s */
export const STAGE_V = 1e6;

/** effective dwell (s): user dwell, but never faster than the stage can move one step */
export function effectiveDwell(dwell: number, stepNm: number): number {
  return Math.max(dwell, stepNm / STAGE_V);
}

/**
 * Map time (s) for `npx` pixels on a source delivering `fOther` ph/s, for the same counts per pixel that a dwell of
 * `dwell` s collects with `fThis` ph/s: dwell' = dwell · fThis/fOther, but never faster than the stage.
 */
export function equalCountsMapTime(npx: number, dwell: number, fThis: number, fOther: number, stepNm: number): number {
  return npx * effectiveDwell((dwell * fThis) / fOther, stepNm);
}

// --------------------------------------------------------------------------------------------- formatting

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export function sci(v: number, digits = 2): string {
  if (!Number.isFinite(v) || v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  const m = v / Math.pow(10, e);
  const ms = m.toFixed(digits - 1);
  if (ms === '10' || ms === '10.0') return sci(Math.sign(v) * Math.pow(10, e + 1), digits);
  return `${ms}×10${String(e)
    .split('')
    .map((c) => SUP[c] ?? c)
    .join('')}`;
}

/** 2–3 significant digits, never exponential */
function sig(v: number): string {
  return v >= 10 ? String(Math.round(v)) : String(+v.toPrecision(2));
}

export function fmtTime(s: number): string {
  if (s < 1e-3) return `${sig(s * 1e6)} µs`;
  if (s < 1) return `${sig(s * 1e3)} ms`;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  if (s < 3600) return `${sig(s / 60)} min`;
  if (s < 86400 * 2) return `${sig(s / 3600)} h`;
  return `${sig(s / 86400)} days`;
}

export function fmtLenNm(nm: number): string {
  if (nm >= 1000) return `${+(nm / 1000).toPrecision(2)} µm`;
  return `${nm < 20 ? +nm.toPrecision(3) : nm < 100 ? +nm.toPrecision(2) : Math.round(nm)} nm`;
}

export function fmtCounts(n: number): string {
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  if (n >= 10) return `${Math.round(n)}`;
  if (n >= 1) return n.toFixed(1);
  return n.toPrecision(1);
}
