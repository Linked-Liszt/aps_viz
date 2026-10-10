/**
 * Ptychography physics for the "The lens is a computer" station (PtychoProbe, 33-ID). Pure functions, no DOM.
 *
 * Geometry (one consistent set, 10 keV):
 *   λ = hc/E = 1.23984 keV·nm / 10 keV = 0.124 nm.
 *   Detector crop M × M = 64 × 64 px. Far-field sampling gives the reconstruction pixel
 *     Δx = λ z / (M p) = 2 nm      (p = 75 µm pixels at z ≈ 77 mm; the PtychoProbe fast detector can sit from
 *                                   75 mm behind the sample — research dossier r16)
 *   so the detector edge is at spatial frequency f_max = 1/(2Δx) = 0.25 nm⁻¹ (half-period 2 nm), i.e. a scattering
 *   angle θ_max = λ f_max = 31 mrad. Object array N × N = 128 × 128 px = 256 nm field.
 *
 * Probe (the X-ray beam at the sample): a Fresnel zone plate with the PtychoProbe 5-nm design parameters
 *   (outermost zone Δr_N = 4 nm, D = 180 µm → f = D Δr_N/λ = 5.8 mm, 11 250 zones; FDR, dossier r1),
 *   NA = λ/(2Δr_N) = 15.5 mrad. The focal field is the inverse Fourier transform of the (annular, central-stop)
 *   pupil; the sample sits Δz = 1.5 µm downstream of focus (≈ 3 depths of focus λ/NA² = 0.52 µm — a deliberately
 *   defocused probe, common practice to spread the dose and increase overlap), applied with the paraxial (Fresnel)
 *   transfer function
 *     P(r) = F⁻¹[ pupil(f) · exp(−iπ λ Δz |f|²) ]
 *   Pupil radius on the detector = NA/λ = 1/(2Δr_N) = 0.125 nm⁻¹ = 16 px: the bright-field disc reaches half-way
 *   to the detector edge; everything outside it is dark-field scattering from the sample — information the lens
 *   alone could not image (coherent lens cut-off: half-period Δr_N = 4 nm, vs 2 nm at the detector edge).
 *   Probe "diameter" for the overlap definition = geometric cone diameter d = 2·NA·Δz ≈ 46 nm.
 *
 * Object: thin (projection-approximation) complex transmission of a single patterned layer,
 *   O(r) = a(r) e^{−iφ(r)},  φ = k δ t,  a = exp(−k β t),  k = 2π/λ,
 *   with δ, β at 10 keV from the CXRO (Henke) tables / NIST XCOM μ/ρ (Cu δ 1.58e-5 β 1.91e-6 — just above the Cu K
 *   edge; Au δ 3.0e-5 β 2.25e-6; W δ 2.8e-5 β 1.84e-6, W is just below its L3 edge so ±10 %). Thicknesses 120–150 nm
 *   keep the layer inside the depth of field of a 2-nm-resolution image, DOF ≈ 5.2 Δx²/λ ≈ 170 nm, so the
 *   projection (multiplicative exit-wave) approximation holds. 150 nm of Au gives a 0.23 rad phase shift but absorbs
 *   only 3.4 % of the intensity (1 − e^{−2kβt}; amplitude 0.983): hard X-ray images of thin samples are phase images. The layout (letters, Siemens star with
 *   spokes down to ~2 nm, Cu wiring + W plugs, 4-nm line pairs) is an illustrative test pattern, not a real device.
 *
 * Measurement: far-field (Fraunhofer) intensity of the exit wave ψ_j = P(r) · O(r − R_j),
 *   I_j(k) = N_ph |F[ψ_j](k)|² / M²  (unnormalised DFT, so Σ_k I_j = N_ph Σ_r |ψ_j|² with Σ_r|P|² = 1),
 *   counts drawn from Poisson(I_j(k)); no detector read noise (photon-counting pixel detector), no beamstop.
 *
 * Reconstruction: ePIE (Maiden & Rodenburg, Ultramicroscopy 109, 1256 (2009)), positions in random order:
 *   Ψ_j = F[ψ_j],  Ψ'_j = √(n_j) · Ψ_j/|Ψ_j|  (modulus constraint, n_j = measured counts), ψ'_j = F⁻¹[Ψ'_j]
 *   O ← O + α P^∗ (ψ'_j − ψ_j) / max|P|²,   P ← P + β O^∗ (ψ'_j − ψ_j) / max|O_j|²   (α = β = 1 in the station)
 *   or rPIE (Maiden, Johnson & Li, Optica 4, 736 (2017)) for the object:
 *   O ← O + P^∗ (ψ'_j − ψ_j) / [(1 − a)|P|² + a·max|P|²],  a = 0.15.
 *   Detector pixels beyond an optional detector radius are treated as unmeasured (Ψ' = Ψ there; not used by the
 *   station — with a probe of pupil radius r_p, object frequencies up to r_det + r_p still reach the detector, so a
 *   crop is not a clean resolution knob). Constraints: |O| ≤ 1 (passive sample) and Σ|P|² fixed to the measured
 *   photons per shot (I0-monitor normalisation) — together they pin the O·c, P/c scale ambiguity that otherwise
 *   drifts and diverges at ~10³ photons/shot. Plain ePIE is still not noise-robust: below ~3 × 10³ photons/shot the
 *   probe update fits the noise (the probe turns to speckle, FRC lost) whatever α, β or a Fourier-support constraint
 *   on P — an algorithm limit (maximum-likelihood solvers do better), so the station's exposure range starts at
 *   10 µs (3.1 × 10³ photons/shot at the pre-upgrade flux), where the result is a noisy ~10 nm image. Probe refinement starts after the first full sweep (common practice);
 *   the station visits the first sweep in scan order (then random order) so the image visibly assembles.
 *   Initial guesses: O = 1 (empty membrane), P = the nominal lens model but with a wrong defocus (1.0 µm instead of
 *   1.5 µm) — the algorithm must fix it.
 *
 * Quality metrics (simulation only): ε = ‖O_t − γO_r‖/‖O_t − ⟨O_t⟩‖ and the FRC against the truth (FrcMeter,
 *   below), γ the best complex scale, both over ONE fixed field of view (the chip, FOV below) for every scan. An
 *   illumination-derived window would down-weight exactly the poorly lit gaps where a low-overlap scan fails, and
 *   its probe-fringe structure (shared by truth and reconstruction) inflates the high-frequency FRC: with it a
 *   44 %-overlap reconstruction with ε ≈ 70 % still scored a pixel-limited 2 nm. Detector-pixel count-rate limits,
 *   read-out noise, partial coherence, position errors and multiple scattering are not modelled.
 *
 * Overlap: linear overlap o = 1 − s/d (Bunk et al., Ultramicroscopy 108, 481 (2008): o ≳ 60 % needed).
 *   Raster grid (with ±1 px jitter to avoid the raster-grid pathology, Thibault et al., Ultramicroscopy 109, 338
 *   (2009)) or Fermat spiral r_n = c√n, θ_n = n·137.508° (Huang et al., Opt. Express 22, 12634 (2014)), c chosen for
 *   the same point density. Positions are integer pixels (no sub-pixel shifts, no position errors) — idealised.
 *
 * Flux: PtychoProbe FDR prediction 3.1e10 ph/s in the focus of the 4-nm-zone ZP at 10 keV (dossier r1). That FDR
 *   number assumes Si(311) bandwidth (ΔE/E ≈ 3e-5) — a zone plate with N = 11 250 zones needs ΔE/E ≲ 1/N ≈ 9e-5 to
 *   stay achromatic, which the installed Si(111) DCM (1.4e-4) does not meet — and the FDR's two-undulator 4.6 m
 *   source; the as-built single ~2.35 m device gives roughly 3× less coherent flux (dossier estimate). So it is a
 *   design value, used as such. Pre-upgrade value = that ÷ 100, the "more than two orders of magnitude"
 *   coherent-flux gain of APS-U (dossier r19, r3) — an illustrative scaling, not a measured number for a specific
 *   pre-upgrade instrument. Dwell times: EIGER2 at 2 kHz (0.5 ms) to a 30 kHz fast detector
 *   (33 µs) (dossier r15); the slider spans 10 µs (100 kHz, beyond today's detectors) to 3 ms. Ptychographic resolution goal ~1 nm on radiation-hard samples (r5); 5 nm focus goal (r1).
 */
import { gauss, rng } from '../../../lib/fft';
import { fft2, fft2FwdT, fft2InvT } from './fft64';

export const HC_KEV_NM = 1.2398419843320026;

export const GEOM = {
  energyKeV: 10,
  /** object array size (px) */
  N: 128,
  /** probe window = detector crop (px), power of two */
  M: 64,
  /** reconstruction pixel (nm) */
  dxNm: 2,
  /** zone-plate outermost zone width (nm) — PtychoProbe 5-nm design */
  drNnm: 4,
  /** zone-plate diameter (µm) */
  zpDiamUm: 180,
  /** central-stop diameter / zone-plate diameter (typical) */
  csFrac: 0.4,
  /** sample distance downstream of focus (µm) */
  defocusUm: 1.5,
  /** detector pixel (µm) used to quote a distance */
  detPixelUm: 75,
};

export const LAMBDA_NM = HC_KEV_NM / GEOM.energyKeV;
export const K_NM = (2 * Math.PI) / LAMBDA_NM;
/** zone-plate numerical aperture (rad) */
export const NA = LAMBDA_NM / (2 * GEOM.drNnm);
/** focal length (mm) f = D Δr_N / λ */
export const ZP_FOCAL_MM = (GEOM.zpDiamUm * 1e3 * GEOM.drNnm) / LAMBDA_NM / 1e6;
/** number of zones N = D / (4 Δr_N) */
export const ZP_ZONES = (GEOM.zpDiamUm * 1e3) / (4 * GEOM.drNnm);
/** sample–detector distance (mm) implied by Δx = λ z / (M p) */
export const DET_DIST_MM = (GEOM.dxNm * GEOM.M * GEOM.detPixelUm * 1e-3) / LAMBDA_NM;
/** frequency pixel (nm⁻¹) */
export const DF = 1 / (GEOM.M * GEOM.dxNm);
/** pupil (bright-field disc) radius on the detector (px) */
export const PUPIL_R_PX = 1 / (2 * GEOM.drNnm) / DF;
/** geometric probe diameter d = 2 NA Δz (nm) */
export const PROBE_D_NM = 2 * NA * GEOM.defocusUm * 1e3;
export const PROBE_D_PX = PROBE_D_NM / GEOM.dxNm;
/** Rayleigh focus of the lens 1.22 Δr_N (nm) */
export const LENS_FOCUS_NM = 1.22 * GEOM.drNnm;
/** depth of field of a Δx-resolution image, 5.2 Δx²/λ (nm) */
export const DOF_NM = (5.2 * GEOM.dxNm * GEOM.dxNm) / LAMBDA_NM;

/** half-period resolution (nm) that corresponds to a detector radius r (px) */
export const halfPeriodNm = (rPx: number): number => 1 / (2 * Math.max(1e-9, rPx) * DF);
/** scattering angle (mrad) at detector radius r (px) */
export const angleMrad = (rPx: number): number => LAMBDA_NM * rPx * DF * 1e3;

// ------------------------------------------------------------------ flux / dose

export type Source = 'aps' | 'apsu';
/** coherent flux in the focus (ph/s), 10 keV, 4-nm-zone ZP: FDR design value (Si(311) bandwidth, 4.6 m source) */
export const FLUX: Record<Source, number> = { apsu: 3.1e10, aps: 3.1e8 };
export const APSU_GAIN = FLUX.apsu / FLUX.aps;
export const photonsPerShot = (src: Source, dwellS: number): number => FLUX[src] * dwellS;

// ------------------------------------------------------------------ materials (10 keV)

export const MATERIALS = {
  Cu: { delta: 1.58e-5, beta: 1.91e-6 },
  Au: { delta: 3.0e-5, beta: 2.25e-6 },
  W: { delta: 2.8e-5, beta: 1.84e-6 },
} as const;
export type Mat = keyof typeof MATERIALS;
/** layer thicknesses (nm) */
export const THICK: Record<Mat, number> = { Au: 150, W: 120, Cu: 120 };

/** phase delay (rad) and amplitude transmission of thickness t (nm) of a material at 10 keV */
export function slab(mat: Mat, tNm: number): { phase: number; amp: number } {
  const m = MATERIALS[mat];
  return { phase: K_NM * m.delta * tNm, amp: Math.exp(-K_NM * m.beta * tNm) };
}

// ------------------------------------------------------------------ test object

export interface ComplexField {
  re: Float64Array;
  im: Float64Array;
}

export interface Chip extends ComplexField {
  n: number;
  /** phase delay k δ t (rad, ≥ 0) */
  phase: Float64Array;
  amp: Float64Array;
  /** largest phase delay (rad) */
  maxPhase: number;
}

const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
};

interface Shape {
  mat: Mat;
  /** bounding box [x0, y0, x1, y1] in 128-px units */
  box: [number, number, number, number];
  /** inside test in object pixel coordinates (continuous; pixel i covers [i, i+1)) */
  hit(x: number, y: number): boolean;
}

const rect = (mat: Mat, x0: number, y0: number, x1: number, y1: number): Shape => ({
  mat,
  box: [x0, y0, x1, y1],
  hit: (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1,
});

/** Siemens-star geometry (128-px units), exported for labels */
export const STAR = { cx: 89, cy: 40, R: 10, spokes: 16 };
/** "APS" letters: top-left corner and cell size (128-px units) */
export const LETTERS = { x0: 29, y0: 29, cell: 3, gap: 1 };
/** dense line pairs: x of the first line, half-pitch (px), y range */
export const LINES = { x0: 88, hp: 2, y0: 90, y1: 100 };

/**
 * Shapes of the illustrative test chip, in pixel units of a 128-px field, in priority order: one patterned layer,
 * so where shapes touch the first one wins (no stacking). Everything sits inside the region the default scan
 * illuminates (x, y ≈ 28–100 px).
 */
function chipShapes(): Shape[] {
  const s: Shape[] = [];
  // "APS" in gold, 5×7 font, 3 px (6 nm) per cell
  const { cell } = LETTERS;
  let x0 = LETTERS.x0;
  for (const ch of 'APS') {
    const g = FONT[ch];
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 5; c++)
        if (g[r][c] === '#') s.push(rect('Au', x0 + c * cell, LETTERS.y0 + r * cell, x0 + (c + 1) * cell, LETTERS.y0 + (r + 1) * cell));
    x0 += 5 * cell + LETTERS.gap;
  }
  // Siemens star (gold): half-period π r / spokes → 2 px (4 nm) at the rim, 1 px (2 nm) at r ≈ 5 px — a resolution gauge
  const { cx, cy, R, spokes } = STAR;
  s.push({
    mat: 'Au',
    box: [cx - R, cy - R, cx + R, cy + R],
    hit: (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const r2 = dx * dx + dy * dy;
      if (r2 > R * R) return false;
      return Math.cos(spokes * Math.atan2(dy, dx)) > 0;
    },
  });
  // dense gold line pairs, half-pitch 2 px = 4 nm
  for (let k = 0; k < 3; k++) s.push(rect('Au', LINES.x0 + 2 * LINES.hp * k, LINES.y0, LINES.x0 + 2 * LINES.hp * k + LINES.hp, LINES.y1));
  // tungsten plugs (priority over the copper they sit on)
  for (const [vx, vy] of [
    [36, 60],
    [60, 72],
    [82, 84],
    [36, 96],
    [60, 84],
  ] as const)
    s.push(rect('W', vx - 3, vy - 3, vx + 3, vy + 3));
  // copper interconnect: horizontal lines 10 nm wide with breaks, vertical lines 8 nm wide
  const W1 = 5;
  const rows: [number, [number, number][]][] = [
    [60, [[28, 100]]],
    [72, [[28, 53], [59, 100]]],
    [84, [[32, 82]]],
    [96, [[28, 76]]],
  ];
  for (const [yc, segs] of rows) for (const [a, b] of segs) s.push(rect('Cu', a, yc - W1 / 2, b, yc + W1 / 2));
  s.push(rect('Cu', 34, 56, 38, 100));
  s.push(rect('Cu', 58, 56, 62, 88));
  s.push(rect('Cu', 80, 56, 84, 88));
  return s;
}

/**
 * Build the complex test object, anti-aliased by 4×4 supersampling of φ and ln a. Shapes are rasterised in priority
 * order inside their bounding boxes; a sub-sample belongs to the first shape that covers it.
 */
export function makeChip(n = GEOM.N): Chip {
  const shapes = chipShapes();
  const scale = 128 / n;
  const SS = 4;
  const ns = n * SS;
  /** material index + 1 owning each sub-sample (0 = empty membrane) */
  const owner = new Uint8Array(ns * ns);
  const mats = Object.keys(MATERIALS) as Mat[];
  for (const sh of shapes) {
    const mi = mats.indexOf(sh.mat) + 1;
    const [bx0, by0, bx1, by1] = sh.box;
    const sx0 = Math.max(0, Math.floor((bx0 / scale) * SS) - 1);
    const sy0 = Math.max(0, Math.floor((by0 / scale) * SS) - 1);
    const sx1 = Math.min(ns - 1, Math.ceil((bx1 / scale) * SS) + 1);
    const sy1 = Math.min(ns - 1, Math.ceil((by1 / scale) * SS) + 1);
    for (let sy = sy0; sy <= sy1; sy++) {
      const v = ((sy + 0.5) / SS) * scale;
      for (let sx = sx0; sx <= sx1; sx++) {
        const k = sy * ns + sx;
        if (owner[k]) continue;
        if (sh.hit(((sx + 0.5) / SS) * scale, v)) owner[k] = mi;
      }
    }
  }
  const phOf = mats.map((m) => slab(m, THICK[m]).phase);
  const lnAOf = mats.map((m) => Math.log(slab(m, THICK[m]).amp));
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  const phase = new Float64Array(n * n);
  const amp = new Float64Array(n * n);
  let maxPhase = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let ph = 0;
      let lnA = 0;
      for (let sy = 0; sy < SS; sy++) {
        const row = (y * SS + sy) * ns + x * SS;
        for (let sx = 0; sx < SS; sx++) {
          const o = owner[row + sx];
          if (o) {
            ph += phOf[o - 1];
            lnA += lnAOf[o - 1];
          }
        }
      }
      ph /= SS * SS;
      lnA /= SS * SS;
      const i = y * n + x;
      const a = Math.exp(lnA);
      phase[i] = ph;
      amp[i] = a;
      if (ph > maxPhase) maxPhase = ph;
      // n = 1 − δ + iβ, transmission exp(−ik∫(δ − iβ)dz) = a·e^{−iφ}
      re[i] = a * Math.cos(-ph);
      im[i] = a * Math.sin(-ph);
    }
  }
  return { n, re, im, phase, amp, maxPhase };
}

// ------------------------------------------------------------------ probe

export interface ProbeOpts {
  m?: number;
  defocusUm?: number;
  pupilR?: number;
  csFrac?: number;
}

/**
 * Defocused zone-plate probe, centred in an m × m window, normalised to Σ|P|² = 1.
 * P = F⁻¹[ A(f) exp(−iπλΔz|f|²) ], A = annulus csFrac·R < |f| < R (soft 1-px edge).
 */
export function makeProbe(o: ProbeOpts = {}): ComplexField {
  const m = o.m ?? GEOM.M;
  const dz = (o.defocusUm ?? GEOM.defocusUm) * 1e3; // nm
  const R = o.pupilR ?? PUPIL_R_PX * (m / GEOM.M);
  const cs = o.csFrac ?? GEOM.csFrac;
  const df = 1 / (m * GEOM.dxNm);
  const re = new Float64Array(m * m);
  const im = new Float64Array(m * m);
  for (let ky = 0; ky < m; ky++) {
    const fy = ky < m / 2 ? ky : ky - m;
    for (let kx = 0; kx < m; kx++) {
      const fx = kx < m / 2 ? kx : kx - m;
      const r = Math.hypot(fx, fy);
      const outer = Math.max(0, Math.min(1, R + 0.5 - r));
      const inner = Math.max(0, Math.min(1, r - cs * R + 0.5));
      const a = outer * inner;
      if (a <= 0) continue;
      const f2 = (fx * fx + fy * fy) * df * df;
      const chi = -Math.PI * LAMBDA_NM * dz * f2;
      // (−1)^(kx+ky) moves the probe from the window corner to its centre
      const sgn = (kx + ky) & 1 ? -1 : 1;
      re[ky * m + kx] = sgn * a * Math.cos(chi);
      im[ky * m + kx] = sgn * a * Math.sin(chi);
    }
  }
  fft2(re, im, m, true);
  normalise(re, im, 1);
  return { re, im };
}

/** scale so that Σ|z|² = total */
export function normalise(re: Float64Array, im: Float64Array, total: number): void {
  let s = 0;
  for (let i = 0; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i];
  const k = Math.sqrt(total / (s || 1));
  for (let i = 0; i < re.length; i++) {
    re[i] *= k;
    im[i] *= k;
  }
}

/** intensity-weighted RMS radius and the diameter enclosing 90 % of the intensity (px) */
export function probeStats(p: ComplexField, m = GEOM.M): { rmsR: number; d90: number } {
  const c = m / 2;
  let s = 0;
  let s2 = 0;
  const pairs: [number, number][] = [];
  for (let y = 0; y < m; y++)
    for (let x = 0; x < m; x++) {
      const i = y * m + x;
      const I = p.re[i] * p.re[i] + p.im[i] * p.im[i];
      const r = Math.hypot(x - c, y - c);
      s += I;
      s2 += I * r * r;
      pairs.push([r, I]);
    }
  pairs.sort((a, b) => a[0] - b[0]);
  let acc = 0;
  let d90 = 0;
  for (const [r, I] of pairs) {
    acc += I;
    if (acc >= 0.9 * s) {
      d90 = 2 * r;
      break;
    }
  }
  return { rmsR: Math.sqrt(s2 / s), d90 };
}

// ------------------------------------------------------------------ scan

export type ScanPattern = 'raster' | 'spiral';

export interface Scan {
  /** window top-left corners (px); the probe centre is at (x + M/2, y + M/2) */
  x: Int32Array;
  y: Int32Array;
  count: number;
  /** nominal step (px) */
  step: number;
}

/** step (px) for a linear overlap o = 1 − s/d */
export const stepForOverlap = (overlap: number, dPx = PROBE_D_PX): number => Math.max(1, dPx * (1 - overlap));

/**
 * Scan positions for linear overlap o = 1 − s/d. Window corners stay within [0, n − m].
 * Raster: snake order, ±1 px jitter. Spiral: Fermat spiral with the same point density (c = s/√π).
 */
export function makeScan(pattern: ScanPattern, overlap: number, dPx = PROBE_D_PX, n = GEOM.N, m = GEOM.M, seed = 7): Scan {
  const span = n - m;
  const step = stepForOverlap(overlap, dPx);
  const xs: number[] = [];
  const ys: number[] = [];
  const r = rng(seed);
  const clampI = (v: number) => Math.max(0, Math.min(span, Math.round(v)));
  if (pattern === 'raster') {
    const k = Math.floor(span / step + 1e-9) + 1;
    const off = (span - (k - 1) * step) / 2;
    for (let iy = 0; iy < k; iy++) {
      for (let j = 0; j < k; j++) {
        const ix = iy % 2 === 0 ? j : k - 1 - j;
        const jx = k > 1 ? Math.floor(r() * 3) - 1 : 0;
        const jy = k > 1 ? Math.floor(r() * 3) - 1 : 0;
        xs.push(clampI(off + ix * step + jx));
        ys.push(clampI(off + iy * step + jy));
      }
    }
  } else {
    const c = step / Math.sqrt(Math.PI);
    const R = span / 2;
    const golden = (137.50776 * Math.PI) / 180;
    for (let i = 0; ; i++) {
      const rr = c * Math.sqrt(i + 0.5);
      if (rr > R * Math.SQRT2 + 0.5) break;
      const px = R + rr * Math.cos(i * golden);
      const py = R + rr * Math.sin(i * golden);
      // keep the square field of view (same area as the raster) — points outside are dropped, not clamped
      if (px < -0.5 || px > span + 0.5 || py < -0.5 || py > span + 0.5) continue;
      xs.push(clampI(px));
      ys.push(clampI(py));
    }
  }
  return { x: Int32Array.from(xs), y: Int32Array.from(ys), count: xs.length, step };
}

/** Σ_j |P(r − R_j)|² over the object (the "illumination map"). */
export function illumination(scan: Scan, probe: ComplexField, n = GEOM.N, m = GEOM.M): Float32Array {
  const out = new Float32Array(n * n);
  for (let j = 0; j < scan.count; j++) {
    const x0 = scan.x[j];
    const y0 = scan.y[j];
    for (let y = 0; y < m; y++)
      for (let x = 0; x < m; x++) {
        const i = y * m + x;
        out[(y0 + y) * n + x0 + x] += probe.re[i] * probe.re[i] + probe.im[i] * probe.im[i];
      }
  }
  return out;
}

/** fraction of the area of two discs of diameter d whose centres are s apart that is shared */
export function areaOverlap(s: number, d: number): number {
  const r = d / 2;
  if (s >= d) return 0;
  const a = 2 * r * r * Math.acos(s / (2 * r)) - (s / 2) * Math.sqrt(4 * r * r - s * s);
  return a / (Math.PI * r * r);
}

// ------------------------------------------------------------------ forward model

/** radius (px, from the zero frequency) of every detector pixel, FFT order (symmetric, so valid transposed too) */
export function radiusMap(m = GEOM.M): Float32Array {
  const out = new Float32Array(m * m);
  const h = m / 2;
  for (let ky = 0; ky < m; ky++)
    for (let kx = 0; kx < m; kx++) out[ky * m + kx] = Math.hypot(kx < h ? kx : kx - m, ky < h ? ky : ky - m);
  return out;
}

/**
 * Exit wave → far-field expected counts for one scan point, written into `mean` in TRANSPOSED FFT order
 * (element [kx·m + ky]); returns the total. Probe normalised to Σ|P|² = 1; nPh = photons per scan point.
 */
export function expectedPattern(obj: ComplexField, n: number, probe: ComplexField, m: number, x0: number, y0: number, nPh: number, wRe: Float64Array, wIm: Float64Array, mean: Float32Array): number {
  for (let y = 0; y < m; y++) {
    const ro = (y0 + y) * n + x0;
    const rp = y * m;
    for (let x = 0; x < m; x++) {
      const pr = probe.re[rp + x];
      const pi = probe.im[rp + x];
      const or = obj.re[ro + x];
      const oi = obj.im[ro + x];
      wRe[rp + x] = pr * or - pi * oi;
      wIm[rp + x] = pr * oi + pi * or;
    }
  }
  fft2FwdT(wRe, wIm, m);
  const k = nPh / (m * m);
  let tot = 0;
  for (let i = 0; i < m * m; i++) {
    const v = (wRe[i] * wRe[i] + wIm[i] * wIm[i]) * k;
    mean[i] = v;
    tot += v;
  }
  return tot;
}

/**
 * Fast Poisson deviate: inversion for small means (≤ 30), normal approximation N(μ, μ) rounded for large means
 * (error in the variance < 2 % above μ = 30, invisible here).
 */
export function poissonFast(mean: number, r: () => number): number {
  if (mean <= 0) return 0;
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss(r)));
  let u = r();
  let p = Math.exp(-mean);
  let k = 0;
  while (u > p) {
    u -= p;
    k++;
    p *= mean / k;
    if (k > 200) break;
  }
  return k;
}

// ------------------------------------------------------------------ data set

/** number of radius bins used for radial statistics */
export const NRAD = Math.ceil((GEOM.M / 2) * Math.SQRT2) + 2;

export interface DataSet {
  scan: Scan;
  nPh: number;
  /** measured amplitudes M·√counts per scan point (TRANSPOSED FFT order), the form ePIE uses */
  amp: Float32Array[];
  /** measured counts (TRANSPOSED FFT order) */
  counts: Float32Array[];
  /** mean expected counts per pixel per pattern, binned by radius (index = round(radius px)) */
  radial: Float64Array;
  /** photon-noise floor of the Fourier error, binned by radius: Σ(√n − √⟨n⟩)², Σ n */
  floorNum: Float64Array;
  floorDen: Float64Array;
  /** total counts over the whole scan */
  totalCounts: number;
  /** largest detector radius (px, ≤ M/2) where ⟨counts⟩ ≥ 1 ph/px; Infinity if the signal reaches the edge */
  r1: number;
}

/** The Fourier error the TRUE object would score (photon-noise floor), using pixels with radius ≤ rDet. */
export function noiseFloor(d: DataSet, rDet = Infinity): number {
  let a = 0;
  let b = 0;
  for (let r = 0; r < NRAD; r++) {
    if (r > rDet + 0.5) break;
    a += d.floorNum[r];
    b += d.floorDen[r];
  }
  return b ? a / b : 0;
}

/** Expected patterns for every scan point (the slow part: one FFT each). Reused when only the dose changes. */
export interface Means {
  scan: Scan;
  /** expected counts for 1 photon per scan point (TRANSPOSED FFT order) */
  mean1: Float32Array[];
}

export function expectedAll(obj: ComplexField, n: number, probe: ComplexField, m: number, scan: Scan): Means {
  const wRe = new Float64Array(m * m);
  const wIm = new Float64Array(m * m);
  const mean1: Float32Array[] = [];
  for (let j = 0; j < scan.count; j++) {
    const mean = new Float32Array(m * m);
    expectedPattern(obj, n, probe, m, scan.x[j], scan.y[j], 1, wRe, wIm, mean);
    mean1.push(mean);
  }
  return { scan, mean1 };
}

/**
 * Incremental measurement: records one scan point at a time (so a station can spread the work over animation
 * frames and show the scan happening). Expected patterns (one FFT each) are cached in `means` and reused when only
 * the dose changes. When `done`, `data` is a complete DataSet.
 */
export class Measurement {
  readonly data: DataSet;
  /** number of scan points recorded so far */
  next = 0;
  private r: () => number;
  private bin: Uint8Array;
  private rc: Float64Array;
  private wRe: Float64Array;
  private wIm: Float64Array;

  constructor(
    readonly obj: ComplexField,
    readonly probe: ComplexField,
    readonly means: Means,
    nPh: number,
    readonly n = GEOM.N,
    readonly m = GEOM.M,
    seed = 1,
  ) {
    this.r = rng(seed);
    this.bin = Uint8Array.from(radiusMap(m), (v) => Math.round(v));
    this.rc = new Float64Array(NRAD);
    this.wRe = new Float64Array(m * m);
    this.wIm = new Float64Array(m * m);
    this.data = {
      scan: means.scan,
      nPh,
      amp: [],
      counts: [],
      radial: new Float64Array(NRAD),
      floorNum: new Float64Array(NRAD),
      floorDen: new Float64Array(NRAD),
      totalCounts: 0,
      r1: 0,
    };
  }

  get done(): boolean {
    return this.next >= this.means.scan.count;
  }

  /** record the next scan point; returns its index (or −1 when finished) */
  step(): number {
    const j = this.next;
    const { scan } = this.means;
    if (j >= scan.count) return -1;
    const { m, data, bin, rc } = this;
    const mm = m * m;
    let mu1 = this.means.mean1[j];
    if (!mu1) {
      mu1 = new Float32Array(mm);
      expectedPattern(this.obj, this.n, this.probe, m, scan.x[j], scan.y[j], 1, this.wRe, this.wIm, mu1);
      this.means.mean1[j] = mu1;
    }
    const c = new Float32Array(mm);
    const a = new Float32Array(mm);
    const nPh = data.nPh;
    const r = this.r;
    let total = 0;
    for (let i = 0; i < mm; i++) {
      const mu = mu1[i] * nPh;
      const v = poissonFast(mu, r);
      c[i] = v;
      a[i] = m * Math.sqrt(v);
      const b = bin[i];
      const d = Math.sqrt(v) - Math.sqrt(mu);
      data.floorNum[b] += d * d;
      data.floorDen[b] += v;
      data.radial[b] += mu;
      rc[b] += 1;
      total += v;
    }
    data.counts.push(c);
    data.amp.push(a);
    data.totalCounts += total;
    this.next++;
    if (this.done) {
      for (let i = 0; i < NRAD; i++) data.radial[i] = rc[i] ? data.radial[i] / rc[i] : 0;
      let r1 = 0;
      const half = m / 2;
      for (let i = 1; i <= half; i++) if (data.radial[i] >= 1) r1 = i;
      data.r1 = r1 >= half ? Infinity : r1;
    }
    return j;
  }
}

/** Expected patterns container with nothing computed yet (filled lazily by Measurement). */
export function emptyMeans(scan: Scan): Means {
  return { scan, mean1: new Array<Float32Array>(scan.count) };
}

/** Poisson-sample a full data set at nPh photons per scan point. */
export function sampleData(means: Means, nPh: number, m = GEOM.M, seed = 1, obj?: ComplexField, probe?: ComplexField, n = GEOM.N): DataSet {
  const meas = new Measurement(obj ?? { re: new Float64Array(0), im: new Float64Array(0) }, probe ?? { re: new Float64Array(0), im: new Float64Array(0) }, means, nPh, n, m, seed);
  while (!meas.done) meas.step();
  return meas.data;
}

/** Simulate a full ptychographic data set (Poisson counting). */
export function simulate(obj: ComplexField, n: number, probe: ComplexField, m: number, scan: Scan, nPh: number, seed = 1): DataSet {
  return sampleData(emptyMeans(scan), nPh, m, seed, obj, probe, n);
}

// ------------------------------------------------------------------ reconstruction

export type Algo = 'epie' | 'rpie';

export interface SolverOpts {
  algo?: Algo;
  /** refine the probe too (blind ptychography) */
  probeUpdate?: boolean;
  /** iteration index from which the probe is refined */
  probeStart?: number;
  rpieAlpha?: number;
  /** object step size α (ePIE: O ← O + α P^∗Δψ/max|P|²; rPIE: multiplies its update) */
  alpha?: number;
  /** probe step size β */
  beta?: number;
  /** detector radius (px) beyond which pixels are treated as unmeasured; Infinity = whole detector */
  rDet?: number;
  /** enforce |O| ≤ 1 (a passive sample cannot amplify the beam) — stabilises low-dose reconstructions */
  clampO?: boolean;
  /** visit the positions in scan order during the first sweep (random order afterwards) */
  firstSweepInOrder?: boolean;
  seed?: number;
}

/**
 * Live ePIE / rPIE solver. step(k) processes k scan points (one FFT pair each); a full sweep over all points
 * in a random order is one iteration. Allocation-free after construction.
 */
export class PtychoSolver {
  readonly n: number;
  readonly m: number;
  readonly O: ComplexField;
  readonly P: ComplexField;
  iter = 0;
  /** index within the current sweep */
  k = 0;
  /** scan point updated most recently */
  last = -1;
  /** Fourier error per completed iteration: Σ(|Ψ| − √n)² / Σ n over measured pixels */
  readonly errF: number[] = [];
  readonly opts: Required<SolverOpts>;
  private order: Int32Array;
  private wRe: Float64Array;
  private wIm: Float64Array;
  private sRe: Float64Array;
  private sIm: Float64Array;
  /** 1 where the detector pixel is measured (transposed order; the radius map is symmetric) */
  private meas: Uint8Array;
  private eNum = 0;
  private eDen = 0;
  private r: () => number;
  private maxP2 = 1;
  /** incident photons per shot = Σ|P|² */
  private p0 = 1;

  constructor(
    readonly data: DataSet,
    initProbe: ComplexField,
    n = GEOM.N,
    m = GEOM.M,
    opts: SolverOpts = {},
  ) {
    this.n = n;
    this.m = m;
    this.opts = { algo: 'epie', probeUpdate: true, probeStart: 1, rpieAlpha: 0.15, alpha: 1, beta: 1, rDet: Infinity, clampO: true, firstSweepInOrder: false, seed: 3, ...opts };
    this.O = { re: new Float64Array(n * n).fill(1), im: new Float64Array(n * n) };
    this.P = { re: Float64Array.from(initProbe.re), im: Float64Array.from(initProbe.im) };
    // scale the probe guess to the measured photon count per shot (empty-membrane transmission ≈ 1)
    this.p0 = data.totalCounts / Math.max(1, data.scan.count);
    normalise(this.P.re, this.P.im, this.p0);
    this.order = new Int32Array(data.scan.count);
    this.wRe = new Float64Array(m * m);
    this.wIm = new Float64Array(m * m);
    this.sRe = new Float64Array(m * m);
    this.sIm = new Float64Array(m * m);
    this.meas = new Uint8Array(m * m);
    this.setDetector(this.opts.rDet);
    this.r = rng(this.opts.seed);
    if (this.opts.firstSweepInOrder) for (let i = 0; i < this.order.length; i++) this.order[i] = i;
    else this.shuffle();
    this.updateMaxP();
  }

  /** change the detector radius used by the modulus constraint (takes effect immediately) */
  setDetector(rDet: number): void {
    this.opts.rDet = rDet;
    const rad = radiusMap(this.m);
    for (let i = 0; i < rad.length; i++) this.meas[i] = rad[i] <= rDet + 1e-9 ? 1 : 0;
  }

  private shuffle(): void {
    const o = this.order;
    for (let i = 0; i < o.length; i++) o[i] = i;
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(this.r() * (i + 1));
      const t = o[i];
      o[i] = o[j];
      o[j] = t;
    }
  }

  /**
   * Refresh max|P|²; with `renorm`, first rescale P to the known incident power p0 (probe-power constraint: the
   * photons per shot are measured upstream, which pins the O·c, P/c scale ambiguity that otherwise drifts at low dose).
   */
  private updateMaxP(renorm = false): void {
    const { re, im } = this.P;
    if (renorm) {
      let s = 0;
      for (let i = 0; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i];
      const k = s > 0 ? Math.sqrt(this.p0 / s) : 1;
      for (let i = 0; i < re.length; i++) {
        re[i] *= k;
        im[i] *= k;
      }
    }
    let mx = 0;
    for (let i = 0; i < re.length; i++) {
      const v = re[i] * re[i] + im[i] * im[i];
      if (v > mx) mx = v;
    }
    this.maxP2 = mx || 1;
  }

  /** process up to `count` scan points (stops at the end of a sweep); returns the number processed */
  step(count: number): number {
    const { n, m, O, P, data, meas } = this;
    const mm = m * m;
    const { wRe, wIm, sRe, sIm } = this;
    const refineP = this.opts.probeUpdate && this.iter >= this.opts.probeStart;
    const rpie = this.opts.algo === 'rpie';
    const aR = this.opts.rpieAlpha;
    const clampO = this.opts.clampO;
    let done = 0;
    while (done < count) {
      const j = this.order[this.k];
      const x0 = data.scan.x[j];
      const y0 = data.scan.y[j];
      const A = data.amp[j];
      // exit wave ψ = P·O_j (kept in s*), copied to w* for the FFT
      for (let y = 0; y < m; y++) {
        const ro = (y0 + y) * n + x0;
        const rp = y * m;
        for (let x = 0; x < m; x++) {
          const pr = P.re[rp + x];
          const pi = P.im[rp + x];
          const or = O.re[ro + x];
          const oi = O.im[ro + x];
          const a = pr * or - pi * oi;
          const b = pr * oi + pi * or;
          sRe[rp + x] = a;
          sIm[rp + x] = b;
          wRe[rp + x] = a;
          wIm[rp + x] = b;
        }
      }
      fft2FwdT(wRe, wIm, m);
      // modulus constraint on measured pixels (transposed order on both sides)
      let num = 0;
      let den = 0;
      for (let i = 0; i < mm; i++) {
        if (!meas[i]) continue;
        const re = wRe[i];
        const im = wIm[i];
        const mag = Math.sqrt(re * re + im * im);
        const ai = A[i];
        const d = mag - ai;
        num += d * d;
        den += ai * ai;
        const s = ai / (mag + 1e-12);
        wRe[i] = re * s;
        wIm[i] = im * s;
      }
      this.eNum += num;
      this.eDen += den;
      fft2InvT(wRe, wIm, m);
      let maxO2 = 0;
      if (refineP) {
        for (let y = 0; y < m; y++) {
          const ro = (y0 + y) * n + x0;
          for (let x = 0; x < m; x++) {
            const v = O.re[ro + x] * O.re[ro + x] + O.im[ro + x] * O.im[ro + x];
            if (v > maxO2) maxO2 = v;
          }
        }
      }
      const sO = this.opts.alpha;
      const kO = sO / this.maxP2;
      const kP = this.opts.beta / (maxO2 || 1);
      const maxP2 = this.maxP2;
      for (let y = 0; y < m; y++) {
        const ro = (y0 + y) * n + x0;
        const rp = y * m;
        for (let x = 0; x < m; x++) {
          const ip = rp + x;
          const io = ro + x;
          // Δψ = ψ' − ψ
          const dr = wRe[ip] - sRe[ip];
          const di = wIm[ip] - sIm[ip];
          const pr = P.re[ip];
          const pi = P.im[ip];
          const or = O.re[io];
          const oi = O.im[io];
          // object: O += w · conj(P) Δψ
          const w = rpie ? sO / ((1 - aR) * (pr * pr + pi * pi) + aR * maxP2) : kO;
          let nr = or + w * (pr * dr + pi * di);
          let ni = oi + w * (pr * di - pi * dr);
          if (clampO) {
            const a2 = nr * nr + ni * ni;
            if (a2 > 1) {
              const s = 1 / Math.sqrt(a2);
              nr *= s;
              ni *= s;
            }
          }
          O.re[io] = nr;
          O.im[io] = ni;
          if (refineP) {
            // probe: P += conj(O_old) Δψ / max|O|²
            P.re[ip] = pr + kP * (or * dr + oi * di);
            P.im[ip] = pi + kP * (or * di - oi * dr);
          }
        }
      }
      if (refineP) this.updateMaxP(true);
      this.last = j;
      done++;
      this.k++;
      if (this.k >= this.order.length) {
        this.k = 0;
        this.iter++;
        this.errF.push(this.eDen ? this.eNum / this.eDen : 0);
        this.eNum = 0;
        this.eDen = 0;
        this.shuffle();
        return done;
      }
    }
    return done;
  }
}

// ------------------------------------------------------------------ metrics

/**
 * Compare a reconstruction with the truth over a mask, removing the undetermined global complex factor γ
 * (overall phase offset and, with probe refinement, amplitude scale):
 *   γ = Σ O_t conj(O_r) / Σ |O_r|²,   ε = ‖O_t − γO_r‖ / ‖O_t − ⟨O_t⟩‖   (0 = perfect, ≈ 1 = no information).
 */
export function compareObject(truth: ComplexField, rec: ComplexField, mask: Uint8Array): { err: number; gRe: number; gIm: number } {
  let nr = 0;
  let ni = 0;
  let dd = 0;
  let mr = 0;
  let mi = 0;
  let cnt = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const tr = truth.re[i];
    const ti = truth.im[i];
    const rr = rec.re[i];
    const ri = rec.im[i];
    nr += tr * rr + ti * ri;
    ni += ti * rr - tr * ri;
    dd += rr * rr + ri * ri;
    mr += tr;
    mi += ti;
    cnt++;
  }
  if (!cnt || !dd) return { err: 1, gRe: 1, gIm: 0 };
  const gRe = nr / dd;
  const gIm = ni / dd;
  mr /= cnt;
  mi /= cnt;
  let e = 0;
  let v = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const rr = rec.re[i];
    const ri = rec.im[i];
    const er = truth.re[i] - (gRe * rr - gIm * ri);
    const ei = truth.im[i] - (gRe * ri + gIm * rr);
    e += er * er + ei * ei;
    const vr = truth.re[i] - mr;
    const vi = truth.im[i] - mi;
    v += vr * vr + vi * vi;
  }
  return { err: Math.sqrt(e / (v || 1)), gRe, gIm };
}

/**
 * Field of view used for every quality metric (128-px units): flat over [lo, hi]² — the chip's features span
 * 28–100 px — with a raised-cosine taper `taper` px wide outside it. Every scan the station offers puts its probe
 * centres over the same square (32–96 px), so the FOV is the region the experimenter means to image.
 */
export const FOV = { lo: 32, hi: 96, taper: 10 };

/** separable raised-cosine window over the FOV (0..1, n × n) */
export function fovWindow(n = GEOM.N): Float64Array {
  const s = n / 128;
  const lo = FOV.lo * s;
  const hi = FOV.hi * s;
  const tp = FOV.taper * s;
  const f = (v: number) => {
    const d = Math.max(lo - v, v - hi, 0);
    return d >= tp ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / tp);
  };
  const w = new Float64Array(n * n);
  for (let y = 0; y < n; y++) {
    const fy = f(y + 0.5);
    for (let x = 0; x < n; x++) w[y * n + x] = fy * f(x + 0.5);
  }
  return w;
}

/** pixels where a window is ≥ ½ (the area ε is computed over) */
export function windowMask(w: Float64Array): Uint8Array {
  return Uint8Array.from(w, (v) => (v >= 0.5 ? 1 : 0));
}

/** mask of well-illuminated pixels (≥ frac of the maximum illumination) */
export function litMask(illum: Float32Array, frac = 0.25): Uint8Array {
  let mx = 0;
  for (let i = 0; i < illum.length; i++) if (illum[i] > mx) mx = illum[i];
  const out = new Uint8Array(illum.length);
  for (let i = 0; i < illum.length; i++) out[i] = illum[i] >= frac * mx ? 1 : 0;
  return out;
}

/**
 * Resolution meter: Fourier ring correlation between the (γ-aligned) reconstruction and the true object,
 *   FRC(f) = Re Σ_{|k|∈f} F_t(k) F_r^∗(k) / √(Σ|F_t|² Σ|F_r|²),
 * over a smooth window w(r) (mean removed inside the window) — the fixed field of view fovWindow(), the same for
 * every scan, so that poorly lit gaps of a sparse scan count against it (see the header). The resolution is
 * the half-period 1/(2q) at the first ring beyond the FRC maximum where the (3-ring averaged) FRC drops below 0.5 —
 * the usual threshold when comparing with ground truth (it corresponds to the 1/7 half-data-set threshold,
 * Rosenthal & Henderson, J. Mol. Biol. 333, 721 (2003)). Searching outward from the maximum measures the
 * high-frequency cut-off; low-frequency phase errors (typical of noisy ptychography, few pixels per ring) are left to
 * the overall error ε. Only available in a simulation, where the truth is known.
 */
export class FrcMeter {
  readonly n: number;
  /** FRC per ring (index = ring radius in px of the n-grid; half-period = n Δx / (2k)) */
  readonly frc: Float64Array;
  readonly nRing: number;
  private w: Float64Array;
  private tRe: Float64Array;
  private tIm: Float64Array;
  private rRe: Float64Array;
  private rIm: Float64Array;
  private ring: Uint16Array;
  private num: Float64Array;
  private d1: Float64Array;
  private d2: Float64Array;

  constructor(
    private truth: ComplexField,
    n = GEOM.N,
  ) {
    this.n = n;
    const nn = n * n;
    this.nRing = n / 2 + 1;
    this.frc = new Float64Array(this.nRing);
    this.w = new Float64Array(nn);
    this.tRe = new Float64Array(nn);
    this.tIm = new Float64Array(nn);
    this.rRe = new Float64Array(nn);
    this.rIm = new Float64Array(nn);
    this.num = new Float64Array(this.nRing);
    this.d1 = new Float64Array(this.nRing);
    this.d2 = new Float64Array(this.nRing);
    this.ring = new Uint16Array(nn);
    const h = n / 2;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const r = Math.round(Math.hypot(x < h ? x : x - n, y < h ? y : y - n));
        this.ring[y * n + x] = Math.min(r, 0xffff);
      }
  }

  /** set the analysis window (0..1 per pixel, e.g. fovWindow()) and transform the windowed truth */
  setWindow(w: Float64Array): void {
    this.w.set(w);
    this.load(this.truth, 1, 0, this.tRe, this.tIm);
    fft2FwdT(this.tRe, this.tIm, this.n);
  }

  private load(f: ComplexField, gRe: number, gIm: number, outRe: Float64Array, outIm: Float64Array): void {
    const { w } = this;
    let sw = 0;
    let mr = 0;
    let mi = 0;
    for (let i = 0; i < w.length; i++) {
      const a = gRe * f.re[i] - gIm * f.im[i];
      const b = gRe * f.im[i] + gIm * f.re[i];
      outRe[i] = a;
      outIm[i] = b;
      sw += w[i];
      mr += w[i] * a;
      mi += w[i] * b;
    }
    mr /= sw || 1;
    mi /= sw || 1;
    for (let i = 0; i < w.length; i++) {
      outRe[i] = (outRe[i] - mr) * w[i];
      outIm[i] = (outIm[i] - mi) * w[i];
    }
  }

  /** FRC of a reconstruction (aligned by the complex factor γ); returns the half-period resolution in nm */
  measure(rec: ComplexField, gRe: number, gIm: number): number {
    const { n, frc, num, d1, d2, ring, tRe, tIm, rRe, rIm } = this;
    this.load(rec, gRe, gIm, rRe, rIm);
    fft2FwdT(rRe, rIm, n);
    num.fill(0);
    d1.fill(0);
    d2.fill(0);
    const nr = this.nRing;
    for (let i = 0; i < n * n; i++) {
      const k = ring[i];
      if (k >= nr) continue;
      num[k] += tRe[i] * rRe[i] + tIm[i] * rIm[i];
      d1[k] += tRe[i] * tRe[i] + tIm[i] * tIm[i];
      d2[k] += rRe[i] * rRe[i] + rIm[i] * rIm[i];
    }
    for (let k = 0; k < nr; k++) {
      // 3-ring average to tame the scatter of single rings
      let a = 0;
      let b = 0;
      let c = 0;
      for (let j = Math.max(0, k - 1); j <= Math.min(nr - 1, k + 1); j++) {
        a += num[j];
        b += d1[j];
        c += d2[j];
      }
      frc[k] = b > 0 && c > 0 ? a / Math.sqrt(b * c) : 0;
    }
    let kMax = 2;
    for (let k = 2; k < nr; k++) if (frc[k] > frc[kMax]) kMax = k;
    if (frc[kMax] < 0.5) return Infinity;
    for (let k = kMax + 1; k < nr; k++) if (frc[k] < 0.5) return (n * GEOM.dxNm) / (2 * k);
    return GEOM.dxNm;
  }
}
