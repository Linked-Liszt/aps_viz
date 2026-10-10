/**
 * Iterative phase retrieval for the BCDI station, budgeted a few iterations per animation frame.
 *
 *   Modulus projection   Ψ = F[ψ],  Ψ' = √I_meas · Ψ/|Ψ|,  ψ' = F⁻¹[Ψ']
 *   Error reduction (ER) ψ_{k+1} = ψ' on the support S, 0 outside           (Gerchberg–Saxton / Fienup 1982)
 *   Hybrid input–output  ψ_{k+1} = ψ' on S,  ψ_k − β ψ' outside S, β = 0.9  (Fienup, Appl. Opt. 21, 2758, 1982)
 *   Shrink-wrap          every 10 iterations S = { G_σ ∗ |P_S ψ| > 12 % of max }, σ: 2.5 → 0.9 px
 *                        (Marchesini et al., PRB 68, 140101(R), 2003)
 *   Initial support      the autocorrelation F⁻¹[I_meas] has the support S − S (twice the object); we threshold it
 *                        and scale it down 1.6× so it safely contains one copy of the crystal.
 *   Fourier error        ε_F = ‖ |Ψ| − √I ‖ / ‖ √I ‖ (computed on the current iterate before projection).
 *   Schedule             10 × (40 HIO + 10 ER), then 100 ER: 600 iterations, shrink-wrap every 10. A shortened version of
 *                        the 34-ID-C recipe in the ATOMIC PDR (2017) §6-2.4.3: 90–100 HIO + 10–20 ER repeated 3–4×,
 *                        shrink-wrap every 5 iterations, a population of 5–50 random starts with guided (genetic)
 *                        selection. Here one start at a time, with a data-only restart rule (see STUCK_RATIO).
 *
 * Trivial ambiguities of the solution ψ = ρe^{iφ}: global phase (rigid shift of the whole crystal), translation, and
 * the twin ψ*(−r) = ρ(−r)e^{−iφ(−r)} (same |F|²). `align()` removes the first two against the known truth (possible only in a simulation) and
 * reports whether the twin was found.
 */
import { rng } from '../../../lib/fft';
import type { FFT2 } from './fft2';

export const PR_ITERS = 600;
export type Algo = 'HIO' | 'RAAR' | 'ER';

export function algoAt(it: number, main: Algo = 'HIO'): Algo {
  if (it >= 500) return 'ER';
  return it % 50 < 40 ? main : 'ER';
}

export class PhaseRetriever {
  readonly n: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
  readonly support: Uint8Array;
  readonly err = new Float32Array(4096);
  iter = 0;
  known = false;
  sigma = 2.5;
  /** shrink-wrap parameters */
  sigma0 = 2.5;
  sigmaMin = 0.9;
  sigmaDecay = 0.97;
  beta = 0.9;
  /** algorithm used for the exploratory part of each block */
  main: Algo = 'HIO';
  /** first iteration at which shrink-wrap may update the support */
  swStart = 10;
  /** progressive low-pass filter on the Fourier constraint: active for it < lpfEnd, Gaussian width (fraction of the
   *  half-array) growing linearly from lpf0 to 1 */
  lpfEnd = 0;
  lpf0 = 0.25;
  /** total iterations (schedule length) */
  total = PR_ITERS;
  threshold = 0.12;
  /** autocorrelation support: threshold (fraction of max) and down-scaling */
  acThreshold = 0.04;
  acScale = 1.6;
  /** incremented whenever the support changes (for redrawing its outline) */
  supportVersion = 0;
  private readonly fft: FFT2;
  private readonly mod: Float64Array;
  private readonly wr: Float64Array;
  private readonly wi: Float64Array;
  private readonly amp: Float64Array;
  private readonly tmp: Float64Array;
  private readonly kernel = new Float64Array(64);
  private readonly q2: Float64Array;

  constructor(fft: FFT2) {
    const n = fft.n;
    this.n = n;
    this.fft = fft;
    this.re = new Float64Array(n * n);
    this.im = new Float64Array(n * n);
    this.support = new Uint8Array(n * n);
    this.mod = new Float64Array(n * n);
    this.wr = new Float64Array(n * n);
    this.wi = new Float64Array(n * n);
    this.amp = new Float64Array(n * n);
    this.tmp = new Float64Array(n * n);
    this.q2 = new Float64Array(n * n);
    for (let j = 0; j < n; j++) {
      const qy = j < n / 2 ? j : j - n;
      for (let i = 0; i < n; i++) {
        const qx = i < n / 2 ? i : i - n;
        this.q2[j * n + i] = (qx * qx + qy * qy) / ((n / 2) * (n / 2));
      }
    }
  }

  get done(): boolean {
    return this.iter >= this.total;
  }

  /**
   * Start a new reconstruction from unshifted measured moduli. `knownSupport` (true crystal footprint) replaces the
   * autocorrelation estimate and disables shrink-wrap.
   */
  reset(modulus: Float64Array, seed: number, knownSupport: Uint8Array | null): void {
    const n = this.n;
    const n2 = n * n;
    this.mod.set(modulus);
    this.iter = 0;
    this.err.fill(NaN);
    this.sigma = this.sigma0;
    this.known = !!knownSupport;
    if (knownSupport) this.dilate(knownSupport, this.support);
    else this.autocorrelationSupport();
    this.supportVersion++;
    const r = rng(seed);
    const { wr, wi } = this;
    for (let k = 0; k < n2; k++) {
      const t = 2 * Math.PI * r();
      wr[k] = this.mod[k] * Math.cos(t);
      wi[k] = this.mod[k] * Math.sin(t);
    }
    this.fft.run(wr, wi, -1);
    for (let k = 0; k < n2; k++) {
      const s = this.support[k];
      this.re[k] = s ? wr[k] : 0;
      this.im[k] = s ? wi[k] : 0;
    }
  }

  /** One iteration. Returns the algorithm used. */
  step(): Algo {
    const n = this.n;
    const n2 = n * n;
    const { wr, wi, re, im, mod, support } = this;
    wr.set(re);
    wi.set(im);
    this.fft.run(wr, wi, 1);
    const inv = 1 / n2;
    let num = 0;
    let den = 0;
    const lpf = this.iter < this.lpfEnd;
    const sw = lpf ? this.lpf0 + ((1 - this.lpf0) * this.iter) / this.lpfEnd : 1;
    const ia = lpf ? 1 / (2 * sw * sw) : 0;
    const q2 = this.q2;
    for (let k = 0; k < n2; k++) {
      const a = Math.sqrt(wr[k] * wr[k] + wi[k] * wi[k]);
      const m = lpf ? mod[k] * Math.exp(-q2[k] * ia) : mod[k];
      const d = a * inv - m;
      num += d * d;
      den += m * m;
      if (a > 1e-300) {
        const f = m / a;
        wr[k] *= f;
        wi[k] *= f;
      } else {
        wr[k] = m;
        wi[k] = 0;
      }
    }
    if (this.iter < this.err.length) this.err[this.iter] = den > 0 ? Math.sqrt(num / den) : 0;
    this.fft.run(wr, wi, -1);
    const algo: Algo = this.iter >= this.total - 100 ? 'ER' : this.iter % 50 < 40 ? this.main : 'ER';
    if (algo === 'RAAR') {
      // outside S: β ψ_k − (2β − 1) P_M ψ_k  (Luke, Inverse Problems 21, 37, 2005)
      const b = this.beta;
      const c = 2 * b - 1;
      for (let k = 0; k < n2; k++) {
        if (support[k]) {
          re[k] = wr[k];
          im[k] = wi[k];
        } else {
          re[k] = b * re[k] - c * wr[k];
          im[k] = b * im[k] - c * wi[k];
        }
      }
    } else if (algo === 'HIO') {
      const b = this.beta;
      for (let k = 0; k < n2; k++) {
        if (support[k]) {
          re[k] = wr[k];
          im[k] = wi[k];
        } else {
          re[k] -= b * wr[k];
          im[k] -= b * wi[k];
        }
      }
    } else {
      for (let k = 0; k < n2; k++) {
        if (support[k]) {
          re[k] = wr[k];
          im[k] = wi[k];
        } else {
          re[k] = 0;
          im[k] = 0;
        }
      }
    }
    this.iter++;
    if (!this.known && this.iter % 10 === 0 && this.iter >= this.swStart && this.iter <= this.total - 120) this.shrinkWrap();
    return algo;
  }

  /** Support-projected current estimate. */
  projected(outRe: Float64Array, outIm: Float64Array): void {
    const n2 = this.n * this.n;
    for (let k = 0; k < n2; k++) {
      const s = this.support[k];
      outRe[k] = s ? this.re[k] : 0;
      outIm[k] = s ? this.im[k] : 0;
    }
  }

  private shrinkWrap(): void {
    const n = this.n;
    const n2 = n * n;
    const { amp, tmp, kernel } = this;
    for (let k = 0; k < n2; k++) amp[k] = this.support[k] ? Math.hypot(this.re[k], this.im[k]) : 0;
    const s = this.sigma;
    const rad = Math.min(31, Math.ceil(3 * s));
    let ks = 0;
    for (let i = -rad; i <= rad; i++) ks += kernel[i + rad] = Math.exp(-(i * i) / (2 * s * s));
    for (let i = 0; i <= 2 * rad; i++) kernel[i] /= ks;
    // horizontal then vertical, periodic (n is a power of two: wrap with a bit mask)
    const mask = n - 1;
    for (let y = 0; y < n; y++) {
      const o = y * n;
      for (let x = 0; x < n; x++) {
        let a = 0;
        for (let i = -rad; i <= rad; i++) a += kernel[i + rad] * amp[o + ((x + i) & mask)];
        tmp[o + x] = a;
      }
    }
    let mx = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let a = 0;
        for (let i = -rad; i <= rad; i++) a += kernel[i + rad] * tmp[((y + i) & mask) * n + x];
        amp[y * n + x] = a;
        if (a > mx) mx = a;
      }
    }
    const thr = this.threshold * mx;
    for (let k = 0; k < n2; k++) this.support[k] = amp[k] > thr ? 1 : 0;
    this.sigma = Math.max(this.sigmaMin, s * this.sigmaDecay);
    this.supportVersion++;
  }

  private autocorrelationSupport(): void {
    const n = this.n;
    const n2 = n * n;
    const { wr, wi, amp } = this;
    for (let k = 0; k < n2; k++) {
      wr[k] = this.mod[k] * this.mod[k];
      wi[k] = 0;
    }
    this.fft.run(wr, wi, -1);
    let mx = 0;
    for (let k = 0; k < n2; k++) {
      amp[k] = Math.hypot(wr[k], wi[k]);
      if (amp[k] > mx) mx = amp[k];
    }
    const thr = this.acThreshold * mx;
    const h = n / 2;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const sx = Math.round(this.acScale * (i - h));
        const sy = Math.round(this.acScale * (j - h));
        let v = 0;
        if (Math.abs(sx) < h && Math.abs(sy) < h) v = amp[((sy + n) % n) * n + ((sx + n) % n)] > thr ? 1 : 0;
        this.support[j * n + i] = v;
      }
    }
  }

  private dilate(src: Uint8Array, dst: Uint8Array): void {
    const n = this.n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1 && !v; dx++) v = src[((y + dy + n) % n) * n + ((x + dx + n) % n)];
        dst[y * n + x] = v;
      }
    }
  }
}

// ───────────────────────────────────────────────────────────────── noise floor (data-only stagnation test)

/** g(λ) = E[(√C − √λ)²] for C ~ Poisson(λ): the expected squared modulus error of a perfect model. → 1/4 for λ ≫ 1. */
const G_TABLE = (() => {
  const t = new Float64Array(64);
  for (let lam = 1; lam < 64; lam++) {
    let p = Math.exp(-lam);
    let e = 0;
    for (let c = 0; c < 200; c++) {
      if (c > 0) p *= lam / c;
      e += p * Math.sqrt(c);
    }
    t[lam] = 2 * lam - 2 * Math.sqrt(lam) * e;
  }
  return t;
})();

/**
 * Expected Fourier error ε_F of the TRUE object for Poisson counts c (unshifted or not — order is irrelevant):
 * ε² ≈ Σ g(c) / Σ c, with λ estimated by c (zero-count pixels cannot be estimated and are skipped, so this is a
 * slight underestimate). Converged reconstructions typically reach ≈1.3–1.5× this value; stagnated ones stay ≳2×.
 */
export function noiseFloor(counts: ArrayLike<number>): number {
  let num = 0;
  let den = 0;
  for (let k = 0; k < counts.length; k++) {
    const c = counts[k];
    if (c <= 0) continue;
    den += c;
    num += c < 64 ? G_TABLE[Math.round(c)] : 0.25 + 1 / (32 * c);
  }
  return den > 0 ? Math.sqrt(num / den) : 1;
}

/** Ratio ε_F / floor above which an ER-phase error at the decision point means "stuck in a false solution". */
export const STUCK_RATIO = 1.7;
/** Iteration (end of an ER block) at which the stagnation test is made. */
export const DECIDE_AT = 300;

// ───────────────────────────────────────────────────────────────── alignment against the known truth

export interface Alignment {
  /** normalised complex overlap |⟨T, E⟩| / (‖T‖‖E‖) of the best direct-or-twin match, 0..1 */
  match: number;
  /** true if the twin conj(E(s − r)) matches the truth better than E(r − s) */
  twin: boolean;
  /** integer shift s of the winning hypothesis */
  sx: number;
  sy: number;
  /** global phase that makes the winning overlap real and positive */
  phase: number;
}

export interface Truth {
  re: Float64Array;
  im: Float64Array;
  norm: number;
  com: [number, number];
  idx: Int32Array;
}

/**
 * Compare an estimate E with the truth T allowing translation (±2 px around the centre-of-mass guess), a global
 * phase and the twin conj(E(−r)). Cost O(|support| × 50): fine every few iterations.
 */
const trigCache = new Map<number, { c: Float64Array; s: Float64Array }>();
function trig(n: number): { c: Float64Array; s: Float64Array } {
  let t = trigCache.get(n);
  if (!t) {
    t = { c: new Float64Array(n), s: new Float64Array(n) };
    for (let i = 0; i < n; i++) {
      t.c[i] = Math.cos((2 * Math.PI * i) / n);
      t.s[i] = Math.sin((2 * Math.PI * i) / n);
    }
    trigCache.set(n, t);
  }
  return t;
}

export function align(eRe: Float64Array, eIm: Float64Array, n: number, T: Truth, out: Alignment): Alignment {
  let w = 0;
  let cxs = 0;
  let cxc = 0;
  let cys = 0;
  let cyc = 0;
  const { c: COS, s: SIN } = trig(n);
  // circular centre of mass (robust to wrap-around of the estimate)
  for (let j = 0; j < n; j++) {
    const cay = COS[j];
    const say = SIN[j];
    let rowW = 0;
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const a = eRe[k] * eRe[k] + eIm[k] * eIm[k];
      if (!a) continue;
      rowW += a;
      cxc += a * COS[i];
      cxs += a * SIN[i];
    }
    w += rowW;
    cyc += rowW * cay;
    cys += rowW * say;
  }
  out.match = 0;
  out.twin = false;
  out.sx = 0;
  out.sy = 0;
  out.phase = 0;
  if (w <= 0) return out;
  const cx = ((((Math.atan2(cxs, cxc) / (2 * Math.PI)) * n) % n) + n) % n;
  const cy = ((((Math.atan2(cys, cyc) / (2 * Math.PI)) * n) % n) + n) % n;
  const eNorm = Math.sqrt(w);
  const [tx, ty] = T.com;
  let best = -1;
  let bre = 0;
  let bim = 0;
  const idx = T.idx;
  // n is a power of two: index wrap with a bit mask, row = k >> log2(n)
  const mask = n - 1;
  const sh = Math.round(Math.log2(n));
  for (let twin = 0; twin < 2; twin++) {
    // direct: E(r − s) has COM c + s → s ≈ t − c.   twin: conj(E(s − r)) has COM s − c → s ≈ t + c.
    const s0x = Math.round(twin ? tx + cx : tx - cx);
    const s0y = Math.round(twin ? ty + cy : ty - cy);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const sx = s0x + dx;
        const sy = s0y + dy;
        let ar = 0;
        let ai = 0;
        for (let m = 0; m < idx.length; m++) {
          const k = idx[m];
          const i = k & mask;
          const j = k >> sh;
          const ii = (twin ? sx - i : i - sx) & mask;
          const jj = (twin ? sy - j : j - sy) & mask;
          const q = (jj << sh) | ii;
          const er = eRe[q];
          const ei = twin ? -eIm[q] : eIm[q];
          // conj(T)·E
          ar += T.re[k] * er + T.im[k] * ei;
          ai += T.re[k] * ei - T.im[k] * er;
        }
        const mag = Math.hypot(ar, ai);
        if (mag > best) {
          best = mag;
          out.twin = !!twin;
          out.sx = sx;
          out.sy = sy;
          bre = ar;
          bim = ai;
        }
      }
    }
  }
  out.match = Math.min(1, best / (T.norm * eNorm));
  out.phase = -Math.atan2(bim, bre);
  return out;
}

/**
 * Apply an alignment for display: dst(r) = E(r − s)·e^{iφ}, or for a twin dst(r) = conj(E(s − r))·e^{iφ}
 * (i.e. the twin is flipped back — the choice a scientist makes from prior knowledge such as the substrate side).
 */
export function applyAlignment(eRe: Float64Array, eIm: Float64Array, n: number, a: Alignment, dstRe: Float64Array, dstIm: Float64Array): void {
  const c = Math.cos(a.phase);
  const s = Math.sin(a.phase);
  const sg = a.twin ? -1 : 1;
  for (let j = 0; j < n; j++) {
    const jj = a.twin ? (((a.sy - j) % n) + n) % n : (((j - a.sy) % n) + n) % n;
    for (let i = 0; i < n; i++) {
      const ii = a.twin ? (((a.sx - i) % n) + n) % n : (((i - a.sx) % n) + n) % n;
      const q = jj * n + ii;
      const er = eRe[q];
      const ei = sg * eIm[q];
      const k = j * n + i;
      dstRe[k] = er * c - ei * s;
      dstIm[k] = er * s + ei * c;
    }
  }
}
