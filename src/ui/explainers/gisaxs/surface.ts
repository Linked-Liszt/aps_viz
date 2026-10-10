/**
 * Evolving nano-island surface for the GISAXS / CSSI station.
 *
 * Model (ILLUSTRATIVE dynamics, physically standard): conserved order-parameter coarsening, Cahn–Hilliard
 * (model B):  ∂φ/∂t = ∇²(φ³ − φ − ε²∇²φ),  off-critical quench (mean φ₀ < 0) → islands (φ ≈ +1) in a bare
 * matrix (φ ≈ −1) that ripen and merge with a characteristic spacing growing as L ∝ t^{1/3} (Lifshitz–Slyozov).
 * Cahn & Hilliard, J. Chem. Phys. 28, 258 (1958). Integrated pseudo-spectrally on a periodic N×N grid with the
 * linearly-stabilised semi-implicit scheme (unconditionally energy stable for S ≥ 1):
 *   φ̂ⁿ⁺¹ (1 + Δt S k² + Δt ε² k⁴) = φ̂ⁿ (1 + Δt S k²) − Δt k² FT[φ³ − φ]ⁿ
 *
 * Topography: island cover s = clamp((φ+1)/2) is turned into polydisperse domes h = H₀ · s · b^0.7, where b is a
 * smoothed (two box passes ≈ Gaussian) copy of s with radius ∝ L — so bigger islands are taller, as for ripened
 * droplets. The height map is sliced into K horizontal layers (fractional occupancy) for the DWBA (see scatter.ts).
 *
 * Physical scale: 1 px = 20 nm, N = 128 → 2.56 µm square patch. Spacing grows from ≈140 nm to ≈400 nm.
 * The coherent beam is a Gaussian across the beam (y) with 1.0 µm intensity FWHM (CSSI focus is 1–2 µm H).
 */
import { rng } from '../../../lib/fft';
import { fft2 as fft2d, RealFFT2 } from './fft2';

export const N = 128;
export const PIXEL_NM = 20;
export const K_SLICES = 4;
export const H0_NM = 20; // tallest islands ≈ 20 nm
export const BEAM_FWHM_NM = 1000;

const NN = N * N;
const NH = (N / 2 + 1) * N;

export class Surface {
  readonly n = N;
  readonly a = PIXEL_NM;
  /** order parameter (real space) */
  readonly phi = new Float64Array(NN);
  /** spectral state φ̂: half spectrum (real-input FFT), transposed layout [kx·N + ky], kx = 0…N/2 */
  private readonly pRe = new Float64Array(NH);
  private readonly pIm = new Float64Array(NH);
  /** k² on the half-spectrum grid (CH) */
  private readonly k2h = new Float64Array(NH);
  /** Hermitian multiplicity of each half-spectrum cell (1 for kx = 0, N/2; else 2) */
  private readonly mult = new Float64Array(NH);
  private readonly rfft = new RealFFT2(N);
  private readonly wRe = new Float64Array(NN);
  private readonly wIm = new Float64Array(NN);
  private readonly k2 = new Float64Array(NN);
  /** height map [nm] */
  readonly height = new Float64Array(NN);
  private readonly tmpA = new Float64Array(NN);
  private readonly tmpB = new Float64Array(NN);
  /** windowed slice spectra M_l(k) (complex), K_SLICES of them, FFT layout [ky*N + kx] */
  readonly mRe: Float64Array[] = [];
  readonly mIm: Float64Array[] = [];
  /** beam amplitude window across the beam, w(y) */
  readonly win = new Float64Array(N);
  /** Σ w² over the patch, for normalising coherent ↔ incoherent */
  winNorm = 1;
  /** ring-averaged cross spectra C_{ll'}(n), n = 0..N/2, packed as [pair][n] with pair index for l ≤ l' */
  readonly cross: Float64Array[] = [];
  readonly eps = 0.8;
  readonly S = 2;
  phi0 = -0.32;
  private readonly means = new Float64Array(K_SLICES);
  private readonly counts = new Float64Array(N / 2 + 1);
  /** ring index round(|k|) per FFT cell (−1 beyond N/2) */
  private readonly ring = new Int16Array(NN);
  /** Cahn–Hilliard time (dimensionless) */
  t = 0;
  steps = 0;
  private seed = 1;

  constructor(seed = 7) {
    for (let ky = 0; ky < N; ky++) {
      const fy = ky <= N / 2 ? ky : ky - N;
      for (let kx = 0; kx < N; kx++) {
        const fx = kx <= N / 2 ? kx : kx - N;
        const kk = ((2 * Math.PI) / N) ** 2 * (fx * fx + fy * fy);
        this.k2[ky * N + kx] = kk;
        const r = Math.round(Math.sqrt(fx * fx + fy * fy));
        this.ring[ky * N + kx] = r <= N / 2 ? r : -1;
      }
    }
    for (let kx = 0; kx <= N / 2; kx++) {
      for (let ky = 0; ky < N; ky++) {
        const fy = ky <= N / 2 ? ky : ky - N;
        this.k2h[kx * N + ky] = ((2 * Math.PI) / N) ** 2 * (kx * kx + fy * fy);
        this.mult[kx * N + ky] = kx === 0 || kx === N / 2 ? 1 : 2;
      }
    }
    for (let l = 0; l < K_SLICES; l++) {
      this.mRe.push(new Float64Array(NN));
      this.mIm.push(new Float64Array(NN));
    }
    for (let p = 0; p < (K_SLICES * (K_SLICES + 1)) / 2; p++) this.cross.push(new Float64Array(N / 2 + 1));
    // amplitude window: intensity FWHM = BEAM_FWHM → σ_I = FWHM/2.3548, amplitude σ_A = √2 σ_I
    const sA = (Math.SQRT2 * BEAM_FWHM_NM) / 2.3548 / PIXEL_NM;
    let s2 = 0;
    for (let y = 0; y < N; y++) {
      const d = y - N / 2;
      this.win[y] = Math.exp(-(d * d) / (2 * sA * sA));
      s2 += this.win[y] * this.win[y];
    }
    this.winNorm = s2 * N;
    this.reset(seed);
  }

  /** fresh quench: φ = φ₀ + small noise */
  reset(seed = this.seed + 1): void {
    this.seed = seed;
    const r = rng(seed);
    for (let i = 0; i < NN; i++) this.phi[i] = this.phi0 + 0.1 * (r() - 0.5);
    this.toSpectral();
    this.t = 0;
    this.steps = 0;
  }

  /**
   * Start from an already-ripened state without a long pre-run: band-pass filtered noise at spacing Lpx,
   * thresholded to the island fraction (1+φ₀)/2, then relaxed by a few CH steps (interfaces → tanh profiles).
   */
  seedRipened(seed: number, Lpx: number, relaxSteps = 14): void {
    this.seed = seed;
    const r = rng(seed);
    const { wRe, wIm, k2, phi } = this;
    for (let i = 0; i < NN; i++) {
      wRe[i] = r() - 0.5;
      wIm[i] = 0;
    }
    fft2d(wRe, wIm, N);
    const k0 = (2 * Math.PI) / Lpx;
    const sk = 0.4 * k0;
    for (let i = 0; i < NN; i++) {
      const kk = Math.sqrt(k2[i]);
      const f = i === 0 ? 0 : Math.exp(-((kk - k0) * (kk - k0)) / (2 * sk * sk));
      wRe[i] *= f;
      wIm[i] *= f;
    }
    fft2d(wRe, wIm, N, true);
    const sorted = Float64Array.from(wRe).sort();
    const cover = (1 + this.phi0) / 2;
    const thr = sorted[Math.floor((1 - cover) * NN)];
    let sd = 0;
    for (let i = 0; i < NN; i++) sd += wRe[i] * wRe[i];
    sd = Math.sqrt(sd / NN) || 1;
    let mean = 0;
    for (let i = 0; i < NN; i++) {
      phi[i] = Math.tanh((wRe[i] - thr) / (0.35 * sd));
      mean += phi[i];
    }
    mean /= NN;
    for (let i = 0; i < NN; i++) phi[i] += this.phi0 - mean;
    this.toSpectral();
    this.t = 40;
    this.steps = 0;
    for (let i = 0; i < relaxSteps; i++) this.step(0.6);
  }

  private toSpectral(): void {
    this.rfft.forward(this.phi, this.pRe, this.pIm);
  }

  /** suggested time step: grows with t as the dynamics slow (L ∝ t^{1/3}) */
  dtFor(t: number): number {
    return Math.min(16, 0.4 + 0.032 * Math.pow(t + 1, 0.7));
  }

  /** one semi-implicit CH step (two real-input FFTs) */
  step(dt: number): void {
    const { phi, wRe, wIm, pRe, pIm, k2h, tmpA } = this;
    for (let i = 0; i < NN; i++) {
      const p = phi[i];
      tmpA[i] = p * p * p - p;
    }
    this.rfft.forward(tmpA, wRe, wIm);
    const e2 = this.eps * this.eps;
    const S = this.S;
    for (let i = 0; i < NH; i++) {
      const kk = k2h[i];
      const den = 1 + dt * S * kk + dt * e2 * kk * kk;
      const num = 1 + dt * S * kk;
      const re = (pRe[i] * num - dt * kk * wRe[i]) / den;
      const im = (pIm[i] * num - dt * kk * wIm[i]) / den;
      pRe[i] = re;
      pIm[i] = im;
      wRe[i] = re;
      wIm[i] = im;
    }
    this.rfft.inverse(wRe, wIm, phi);
    this.t += dt;
    this.steps++;
  }

  advance(nSteps: number): void {
    for (let i = 0; i < nSteps; i++) this.step(this.dtFor(this.t));
  }

  /** characteristic spacing L = 2π/⟨k⟩ [px] from the structure factor of φ (spectral state, no extra FFT) */
  lengthScalePx(): number {
    const { pRe, pIm, k2h, mult } = this;
    let sw = 0;
    let skw = 0;
    for (let i = 1; i < NH; i++) {
      const kk = k2h[i];
      if (kk > ((2 * Math.PI) / 3) ** 2) continue; // ignore sub-3-px noise
      const s = (pRe[i] * pRe[i] + pIm[i] * pIm[i]) * mult[i];
      sw += s;
      skw += s * Math.sqrt(kk);
    }
    return skw > 0 ? (2 * Math.PI * sw) / skw : N;
  }

  /** island area fraction (φ > 0) */
  coverage(): number {
    let c = 0;
    for (let i = 0; i < NN; i++) if (this.phi[i] > 0) c++;
    return c / NN;
  }

  /** build the dome-shaped height map [nm] */
  computeHeight(): void {
    const { phi, tmpA, tmpB, height } = this;
    for (let i = 0; i < NN; i++) {
      const s = (phi[i] + 1) / 2;
      tmpA[i] = s < 0 ? 0 : s > 1 ? 1 : s;
    }
    const L = this.lengthScalePx();
    const R = Math.max(1, Math.round(0.22 * L));
    tmpB.set(tmpA);
    boxBlur(tmpB, this.wRe, R);
    boxBlur(tmpB, this.wRe, R);
    for (let i = 0; i < NN; i++) {
      const b = Math.min(1, tmpB[i] / 0.85);
      height[i] = H0_NM * tmpA[i] * Math.pow(b, 0.7);
    }
  }

  /**
   * Slice the height map into K layers, window across the beam, and FFT (two real slices packed per complex FFT).
   * Also accumulates ring-averaged cross spectra for the incoherent (ensemble) pattern.
   */
  computeSpectra(): void {
    // Split into small monomorphic helpers over typed arrays: V8 optimises these far better than one big method
    // (measured ≈ 2.5× faster on an i5-6300U).
    const dh = H0_NM / K_SLICES;
    const { height, wRe, wIm, win, means } = this;
    sliceMeans(height, dh, means);
    for (let l = 0; l < K_SLICES; l += 2) {
      fillSlicePair(height, win, l * dh, (l + 1) * dh, dh, means[l], means[l + 1], wRe, wIm);
      fft2d(wRe, wIm, N);
      unpackPair(wRe, wIm, this.mRe[l], this.mIm[l], this.mRe[l + 1], this.mIm[l + 1]);
    }
    // ring-averaged cross spectra (real by ±q symmetry)
    const counts = this.counts;
    counts.fill(0);
    for (const c of this.cross) c.fill(0);
    const [m0r, m1r, m2r, m3r] = this.mRe;
    const [m0i, m1i, m2i, m3i] = this.mIm;
    const [c00, c01, c02, c03, c11, c12, c13, c22, c23, c33] = this.cross;
    accumulateCross(this.ring, counts, m0r, m0i, m1r, m1i, m2r, m2i, m3r, m3i, c00, c01, c02, c03, c11, c12, c13, c22, c23, c33);
    const nR = N / 2 + 1;
    for (const c of this.cross) for (let r = 0; r < nR; r++) c[r] = counts[r] ? c[r] / counts[r] : 0;
  }

  /** Add (or remove) material in a disc of radius r px centred at (x, y) px; re-syncs the spectral state. */
  poke(x: number, y: number, r: number, add: boolean): void {
    const target = add ? 1 : -1;
    const R = Math.ceil(r + 2);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy);
        const wgt = 0.5 * (1 - Math.tanh((d - r) / 0.9));
        if (wgt < 0.01) continue;
        const ix = (((Math.round(x) + dx) % N) + N) % N;
        const iy = (((Math.round(y) + dy) % N) + N) % N;
        const i = iy * N + ix;
        this.phi[i] = this.phi[i] * (1 - wgt) + target * wgt;
      }
    }
    this.toSpectral();
  }
}

// ---------------------------------------------------------------- spectra helpers (K_SLICES = 4, packed in pairs)

/** mean fractional occupancy of each of the 4 height slices [l·dh, (l+1)·dh), one pass over the map */
function sliceMeans(height: Float64Array, dh: number, out: Float64Array): void {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  const inv = 1 / dh;
  for (let i = 0; i < NN; i++) {
    const u = height[i] * inv;
    s0 += u <= 0 ? 0 : u >= 1 ? 1 : u;
    s1 += u <= 1 ? 0 : u >= 2 ? 1 : u - 1;
    s2 += u <= 2 ? 0 : u >= 3 ? 1 : u - 2;
    s3 += u <= 3 ? 0 : u >= 4 ? 1 : u - 3;
  }
  out[0] = s0 / NN;
  out[1] = s1 / NN;
  out[2] = s2 / NN;
  out[3] = s3 / NN;
}

/** windowed, mean-removed occupancy of two slices packed as re/im of one complex field */
function fillSlicePair(
  height: Float64Array,
  win: Float64Array,
  loA: number,
  loB: number,
  dh: number,
  mA: number,
  mB: number,
  re: Float64Array,
  im: Float64Array,
): void {
  const inv = 1 / dh;
  for (let y = 0; y < N; y++) {
    const w = win[y];
    const o = y * N;
    for (let x = 0; x < N; x++) {
      const h = height[o + x];
      const a = (h - loA) * inv;
      const b = (h - loB) * inv;
      re[o + x] = w * ((a <= 0 ? 0 : a >= 1 ? 1 : a) - mA);
      im[o + x] = w * ((b <= 0 ? 0 : b >= 1 ? 1 : b) - mB);
    }
  }
}

/** split the FFT Z of (a + i b) into A(k) = (Z(k) + Z*(−k))/2 and B(k) = (Z(k) − Z*(−k))/(2i) */
function unpackPair(zRe: Float64Array, zIm: Float64Array, aRe: Float64Array, aIm: Float64Array, bRe: Float64Array, bIm: Float64Array): void {
  for (let ky = 0; ky < N; ky++) {
    const o = ky * N;
    const om = ((N - ky) & (N - 1)) * N;
    for (let kx = 0; kx < N; kx++) {
      const i = o + kx;
      const j = om + ((N - kx) & (N - 1));
      const zr = zRe[i];
      const zi = zIm[i];
      const cr = zRe[j];
      const ci = -zIm[j];
      aRe[i] = 0.5 * (zr + cr);
      aIm[i] = 0.5 * (zi + ci);
      bRe[i] = 0.5 * (zi - ci);
      bIm[i] = -0.5 * (zr - cr);
    }
  }
}

/** ring sums of the 10 slice cross spectra Re(M_l M_l'*) and the ring cell counts */
function accumulateCross(
  ring: Int16Array,
  counts: Float64Array,
  m0r: Float64Array,
  m0i: Float64Array,
  m1r: Float64Array,
  m1i: Float64Array,
  m2r: Float64Array,
  m2i: Float64Array,
  m3r: Float64Array,
  m3i: Float64Array,
  c00: Float64Array,
  c01: Float64Array,
  c02: Float64Array,
  c03: Float64Array,
  c11: Float64Array,
  c12: Float64Array,
  c13: Float64Array,
  c22: Float64Array,
  c23: Float64Array,
  c33: Float64Array,
): void {
  for (let i = 0; i < NN; i++) {
    const r = ring[i];
    if (r < 0) continue;
    counts[r] += 1;
    const ar = m0r[i];
    const ai = m0i[i];
    const br = m1r[i];
    const bi = m1i[i];
    const cr = m2r[i];
    const ci = m2i[i];
    const dr = m3r[i];
    const di = m3i[i];
    c00[r] += ar * ar + ai * ai;
    c01[r] += ar * br + ai * bi;
    c02[r] += ar * cr + ai * ci;
    c03[r] += ar * dr + ai * di;
    c11[r] += br * br + bi * bi;
    c12[r] += br * cr + bi * ci;
    c13[r] += br * dr + bi * di;
    c22[r] += cr * cr + ci * ci;
    c23[r] += cr * dr + ci * di;
    c33[r] += dr * dr + di * di;
  }
}

/** periodic separable box blur of radius R (in place), using tmp as scratch */
function boxBlur(a: Float64Array, tmp: Float64Array, R: number): void {
  const w = 2 * R + 1;
  // rows
  for (let y = 0; y < N; y++) {
    const o = y * N;
    let s = 0;
    for (let d = -R; d <= R; d++) s += a[o + ((d + N) % N)];
    for (let x = 0; x < N; x++) {
      tmp[o + x] = s / w;
      s += a[o + ((x + R + 1) % N)] - a[o + ((x - R + N) % N)];
    }
  }
  // columns
  for (let x = 0; x < N; x++) {
    let s = 0;
    for (let d = -R; d <= R; d++) s += tmp[((d + N) % N) * N + x];
    for (let y = 0; y < N; y++) {
      a[y * N + x] = s / w;
      s += tmp[((y + R + 1) % N) * N + x] - tmp[((y - R + N) % N) * N + x];
    }
  }
}
