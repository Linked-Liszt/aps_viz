/**
 * Cache-friendly 2D complex FFT for square power-of-two grids (row FFTs → transpose → row FFTs → transpose).
 * Same conventions as src/lib/fft.ts (forward e^{−i…}, inverse scaled by 1/n per axis); ~2× faster there for
 * 128² because every butterfly pass runs over contiguous memory. Verified against lib/fft in tests/gisaxs.test.ts.
 */

interface Plan {
  n: number;
  rev: Uint32Array;
  /** per-stage contiguous twiddles cos/sin(2πk/size), stage s ↔ size 2^{s+1} */
  twR: Float64Array[];
  twI: Float64Array[];
  tRe: Float64Array;
  tIm: Float64Array;
}

const plans = new Map<number, Plan>();

function plan(n: number): Plan {
  let p = plans.get(n);
  if (p) return p;
  if (n & (n - 1)) throw new Error(`fft size must be a power of two: ${n}`);
  const twR: Float64Array[] = [];
  const twI: Float64Array[] = [];
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const a = new Float64Array(half);
    const b = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      a[k] = Math.cos((2 * Math.PI * k) / size);
      b[k] = Math.sin((2 * Math.PI * k) / size);
    }
    twR.push(a);
    twI.push(b);
  }
  const rev = new Uint32Array(n);
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  p = { n, rev, twR, twI, tRe: new Float64Array(n * n), tIm: new Float64Array(n * n) };
  plans.set(n, p);
  return p;
}

function rows(re: Float64Array, im: Float64Array, p: Plan, inverse: boolean, count = p.n): void {
  for (let r = 0; r < count; r++) fft1(re, im, r * p.n, p, inverse);
}

/** unscaled in-place radix-2 FFT of n contiguous complex samples starting at offset o */
function fft1(re: Float64Array, im: Float64Array, o: number, p: Plan, inverse: boolean): void {
  const { n, rev, twR, twI } = p;
  const sgn = inverse ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = o + i;
      const b = o + j;
      let t = re[a];
      re[a] = re[b];
      re[b] = t;
      t = im[a];
      im[a] = im[b];
      im[b] = t;
    }
  }
  const end = o + n;
  // size-2 stage: trivial twiddle
  for (let a = o; a < end; a += 2) {
    const b = a + 1;
    const br = re[b];
    const bi = im[b];
    const ar = re[a];
    const ai = im[a];
    re[b] = ar - br;
    im[b] = ai - bi;
    re[a] = ar + br;
    im[a] = ai + bi;
  }
  for (let size = 4, s = 1; size <= n; size <<= 1, s++) {
    const half = size >> 1;
    const cr = twR[s];
    const ci = twI[s];
    for (let start = o; start < end; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cr[k];
        const wi = sgn * ci[k];
        const a = start + k;
        const b = a + half;
        const br = re[b];
        const bi = im[b];
        const xr = br * wr - bi * wi;
        const xi = br * wi + bi * wr;
        const ar = re[a];
        const ai = im[a];
        re[b] = ar - xr;
        im[b] = ai - xi;
        re[a] = ar + xr;
        im[a] = ai + xi;
      }
    }
  }
}

function transpose(src: Float64Array, dst: Float64Array, n: number): void {
  const B = 16;
  for (let by = 0; by < n; by += B) {
    for (let bx = 0; bx < n; bx += B) {
      for (let y = by; y < by + B; y++) {
        const o = y * n;
        for (let x = bx; x < bx + B; x++) dst[x * n + y] = src[o + x];
      }
    }
  }
}

/** In-place 2D FFT of an n×n row-major complex array (Float64). */
export function fft2(re: Float64Array, im: Float64Array, n: number, inverse = false): void {
  const p = plan(n);
  rows(re, im, p, inverse);
  transpose(re, p.tRe, n);
  transpose(im, p.tIm, n);
  rows(p.tRe, p.tIm, p, inverse);
  transpose(p.tRe, re, n);
  transpose(p.tIm, im, n);
  if (inverse) {
    const s = 1 / (n * n);
    for (let i = 0; i < n * n; i++) {
      re[i] *= s;
      im[i] *= s;
    }
  }
}

/**
 * Real-input 2D FFT with half-spectrum output, used by the Cahn–Hilliard integrator (both of its transforms act on
 * real fields). Rows are transformed two at a time (z = x_r + i x_{r+1}, then split by Hermitian symmetry), and only
 * the N/2+1 non-redundant columns are transformed. About half the work of a complex 2D FFT.
 * Spectrum layout is TRANSPOSED: index kx·N + ky, kx = 0…N/2, ky = 0…N−1 (contiguous column FFTs).
 */
export class RealFFT2 {
  readonly n: number;
  readonly w: number;
  private readonly p: Plan;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;
  constructor(n: number) {
    this.n = n;
    this.w = n / 2 + 1;
    this.p = plan(n);
    this.zr = new Float64Array(n);
    this.zi = new Float64Array(n);
  }

  /** x (n×n real, row-major [y·n + x]) → (outRe, outIm) half spectrum, transposed layout */
  forward(x: Float64Array, outRe: Float64Array, outIm: Float64Array): void {
    const { n, w, p, zr, zi } = this;
    for (let r = 0; r < n; r += 2) {
      const o0 = r * n;
      const o1 = o0 + n;
      for (let j = 0; j < n; j++) {
        zr[j] = x[o0 + j];
        zi[j] = x[o1 + j];
      }
      fft1(zr, zi, 0, p, false);
      for (let k = 0; k < w; k++) {
        const m = (n - k) & (n - 1);
        const a = k * n + r;
        outRe[a] = 0.5 * (zr[k] + zr[m]);
        outIm[a] = 0.5 * (zi[k] - zi[m]);
        outRe[a + 1] = 0.5 * (zi[k] + zi[m]);
        outIm[a + 1] = -0.5 * (zr[k] - zr[m]);
      }
    }
    for (let k = 0; k < w; k++) fft1(outRe, outIm, k * n, p, false);
  }

  /** half spectrum (transposed layout; overwritten) → x (n×n real), scaled by 1/n² */
  inverse(inRe: Float64Array, inIm: Float64Array, x: Float64Array): void {
    const { n, w, p, zr, zi } = this;
    for (let k = 0; k < w; k++) fft1(inRe, inIm, k * n, p, true);
    const s = 1 / (n * n);
    const h = n / 2;
    for (let r = 0; r < n; r += 2) {
      for (let k = 0; k < n; k++) {
        let ar: number;
        let ai: number;
        let br: number;
        let bi: number;
        if (k <= h) {
          const a = k * n + r;
          ar = inRe[a];
          ai = inIm[a];
          br = inRe[a + 1];
          bi = inIm[a + 1];
        } else {
          const a = (n - k) * n + r;
          ar = inRe[a];
          ai = -inIm[a];
          br = inRe[a + 1];
          bi = -inIm[a + 1];
        }
        zr[k] = ar - bi;
        zi[k] = ai + br;
      }
      fft1(zr, zi, 0, p, true);
      const o0 = r * n;
      const o1 = o0 + n;
      for (let j = 0; j < n; j++) {
        x[o0 + j] = zr[j] * s;
        x[o1 + j] = zi[j] * s;
      }
    }
  }
}
