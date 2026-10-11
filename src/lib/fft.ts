/**
 * Small, allocation-free radix-2 complex FFT (1D + 2D) for the interactive stations
 * (speckle, ptychography, Bragg CDI, coherence demos). Sizes must be powers of two.
 */

const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function plan(n: number) {
  let p = twiddleCache.get(n);
  if (p) return p;
  if (n & (n - 1)) throw new Error(`FFT size must be a power of two, got ${n}`);
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  p = { cos, sin, rev };
  twiddleCache.set(n, p);
  return p;
}

/**
 * In-place FFT of a strided complex sequence. `inverse` uses +i and scales by 1/n.
 */
export function fft1d(re: Float32Array | Float64Array, im: Float32Array | Float64Array, n: number, offset = 0, stride = 1, inverse = false): void {
  const { cos, sin, rev } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = offset + i * stride;
      const b = offset + j * stride;
      let t = re[a];
      re[a] = re[b];
      re[b] = t;
      t = im[a];
      im[a] = im[b];
      im[b] = t;
    }
  }
  const sgn = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sgn * sin[k * step];
        const a = offset + (start + k) * stride;
        const b = offset + (start + k + half) * stride;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      const a = offset + i * stride;
      re[a] /= n;
      im[a] /= n;
    }
  }
}

/** In-place 2D FFT of an n×n row-major complex array. */
export function fft2d(re: Float32Array | Float64Array, im: Float32Array | Float64Array, n: number, inverse = false): void {
  for (let r = 0; r < n; r++) fft1d(re, im, n, r * n, 1, inverse);
  for (let c = 0; c < n; c++) fft1d(re, im, n, c, n, inverse);
}

/** Swap quadrants in place to put zero frequency at the centre. Requires even n. */
export function fftshift2d<T extends Float32Array | Float64Array>(a: T, n: number): T {
  const h = n / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const j = (y + h) * n + ((x + h) % n);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
  }
  return a;
}

/** |F|² of a complex field (new array). */
export function intensity(re: ArrayLike<number>, im: ArrayLike<number>, out?: Float32Array): Float32Array {
  const o = out ?? new Float32Array(re.length);
  for (let i = 0; i < re.length; i++) o[i] = re[i] * re[i] + im[i] * im[i];
  return o;
}

/** Deterministic PRNG (mulberry32) so stations are reproducible. */
export function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian deviate (Box–Muller). */
export function gauss(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Poisson deviate (Knuth for small means, normal approximation for large). */
export function poisson(mean: number, r: () => number): number {
  if (mean <= 0) return 0;
  if (mean > 40) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gauss(r)));
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}
