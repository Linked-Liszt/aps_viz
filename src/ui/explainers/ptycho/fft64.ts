/**
 * Fast in-place 2-D complex FFT for small square power-of-two arrays (the ptychography inner loop runs two of these
 * per scan-point update, hundreds of times per second, so it must be cheap on a 2-core laptop).
 *
 * Each 1-D pass is done "vectorised over rows": every butterfly between rows is applied to all columns at once, so
 * the inner loop walks contiguous memory; pairs of radix-2 stages are fused into radix-4 butterflies to halve the
 * memory sweeps. A transpose between the two passes turns the column transform into the row transform.
 * Float64 storage (no float↔double conversions in the hot loop) measured ~2.5× faster than Float32 in V8.
 * Conventions match src/lib/fft.ts: forward uses e^{−i…}, unnormalised; inverse uses e^{+i…} and scales by 1/n².
 */

interface Plan {
  n: number;
  cos: Float64Array;
  sin: Float64Array;
  rev: Uint16Array;
}

const plans = new Map<number, Plan>();

export function fftPlan(n: number): Plan {
  let p = plans.get(n);
  if (p) return p;
  if (n < 2 || n & (n - 1)) throw new Error(`FFT size must be a power of two, got ${n}`);
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint16Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  p = { n, cos, sin, rev };
  plans.set(n, p);
  return p;
}

/** 1-D FFT along y (between rows) applied to all n columns at once. */
function colPass(re: Float64Array, im: Float64Array, p: Plan, inverse: boolean): void {
  const { n, cos, sin, rev } = p;
  // bit-reversal permutation of whole rows
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = i * n;
      const b = j * n;
      for (let x = 0; x < n; x++) {
        let t = re[a + x];
        re[a + x] = re[b + x];
        re[b + x] = t;
        t = im[a + x];
        im[a + x] = im[b + x];
        im[b + x] = t;
      }
    }
  }
  const sgn = inverse ? 1 : -1;
  let h = 1;
  // odd number of stages: one plain radix-2 stage first
  if (Math.log2(n) % 2 === 1) {
    for (let start = 0; start < n; start += 2) {
      const a = start * n;
      const b = a + n;
      for (let x = 0; x < n; x++) {
        const xr = re[b + x];
        const xi = im[b + x];
        re[b + x] = re[a + x] - xr;
        im[b + x] = im[a + x] - xi;
        re[a + x] += xr;
        im[a + x] += xi;
      }
    }
    h = 2;
  }
  // fused radix-2 stages (size 2h then 4h) = radix-4 butterflies on rows k, k+h, k+2h, k+3h
  for (; h < n; h <<= 2) {
    const L = 4 * h;
    const s4 = n / L; // twiddle stride for W_{4h}
    for (let start = 0; start < n; start += L) {
      for (let k = 0; k < h; k++) {
        // W2 = W_{2h}^k = W_{4h}^{2k}, W4 = W_{4h}^k
        const w2r = cos[2 * k * s4];
        const w2i = sgn * sin[2 * k * s4];
        const w4r = cos[k * s4];
        const w4i = sgn * sin[k * s4];
        const i0 = (start + k) * n;
        const i1 = i0 + h * n;
        const i2 = i1 + h * n;
        const i3 = i2 + h * n;
        for (let x = 0; x < n; x++) {
          const x0r = re[i0 + x];
          const x0i = im[i0 + x];
          const y1r = re[i1 + x];
          const y1i = im[i1 + x];
          const x2r = re[i2 + x];
          const x2i = im[i2 + x];
          const y3r = re[i3 + x];
          const y3i = im[i3 + x];
          // t1 = W2·x1, t3 = W2·x3
          const t1r = y1r * w2r - y1i * w2i;
          const t1i = y1r * w2i + y1i * w2r;
          const t3r = y3r * w2r - y3i * w2i;
          const t3i = y3r * w2i + y3i * w2r;
          const a0r = x0r + t1r;
          const a0i = x0i + t1i;
          const a1r = x0r - t1r;
          const a1i = x0i - t1i;
          const a2r = x2r + t3r;
          const a2i = x2i + t3i;
          const a3r = x2r - t3r;
          const a3i = x2i - t3i;
          // u2 = W4·a2 ; u3 = (∓i)·W4·a3  (W_{4h}^{k+h} = W4 · e^{∓iπ/2})
          const u2r = a2r * w4r - a2i * w4i;
          const u2i = a2r * w4i + a2i * w4r;
          const v3r = a3r * w4r - a3i * w4i;
          const v3i = a3r * w4i + a3i * w4r;
          // forward (sgn = −1): multiply by −i → (v3i, −v3r); inverse: by +i → (−v3i, v3r)
          const u3r = -sgn * v3i;
          const u3i = sgn * v3r;
          re[i0 + x] = a0r + u2r;
          im[i0 + x] = a0i + u2i;
          re[i2 + x] = a0r - u2r;
          im[i2 + x] = a0i - u2i;
          re[i1 + x] = a1r + u3r;
          im[i1 + x] = a1i + u3i;
          re[i3 + x] = a1r - u3r;
          im[i3 + x] = a1i - u3i;
        }
      }
    }
  }
}

function transpose(a: Float64Array, n: number): void {
  for (let y = 0; y < n; y++) {
    const r = y * n;
    for (let x = y + 1; x < n; x++) {
      const i = r + x;
      const j = x * n + y;
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
  }
}

/** In-place 2-D FFT of an n×n row-major complex array (Float64), natural layout in and out. */
export function fft2(re: Float64Array, im: Float64Array, n: number, inverse = false): void {
  if (inverse) {
    transpose(re, n);
    transpose(im, n);
    fft2InvT(re, im, n);
  } else {
    fft2FwdT(re, im, n);
    transpose(re, n);
    transpose(im, n);
  }
}

/**
 * Forward 2-D FFT whose output is left TRANSPOSED (element [kx·n + ky]) — saves two transposes when the spectrum is
 * only multiplied point-wise (modulus constraint) and transformed back with fft2InvT.
 */
export function fft2FwdT(re: Float64Array, im: Float64Array, n: number): void {
  const p = fftPlan(n);
  colPass(re, im, p, false);
  transpose(re, n);
  transpose(im, n);
  colPass(re, im, p, false);
}

/** Inverse of fft2FwdT: takes a transposed spectrum, returns the field in natural layout, scaled by 1/n². */
export function fft2InvT(re: Float64Array, im: Float64Array, n: number): void {
  const p = fftPlan(n);
  colPass(re, im, p, true);
  transpose(re, n);
  transpose(im, n);
  colPass(re, im, p, true);
  const s = 1 / (n * n);
  for (let i = 0; i < n * n; i++) {
    re[i] *= s;
    im[i] *= s;
  }
}
