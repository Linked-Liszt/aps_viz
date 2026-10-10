/**
 * Pruned 2-D complex FFT for the XPCS station (local, so the shared lib stays untouched).
 *
 *  - rows are transformed only where the input row is non-zero (the illuminated band),
 *  - columns are transformed only for the kx we actually display (|kx| ≤ 48 of 128),
 *  - columns are copied into a contiguous scratch vector (cache friendly), math in Float64.
 * Same sign convention as lib/fft.ts (forward = e^{−2πi kx/n}, no scaling).
 */
export class PrunedFFT2 {
  readonly n: number;
  private cos: Float64Array;
  private sin: Float64Array;
  private rev: Uint32Array;
  private tr: Float64Array;
  private ti: Float64Array;

  constructor(n: number) {
    if (n & (n - 1)) throw new Error('size must be a power of two');
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.tr = new Float64Array(n);
    this.ti = new Float64Array(n);
  }

  /** In-place forward FFT of the contiguous scratch vector (tr, ti). */
  private fft1(): void {
    const n = this.n;
    const re = this.tr;
    const im = this.ti;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const C = this.cos;
    const S = this.sin;
    // first two stages fused (radix-4 with trivial twiddles 1 and −i)
    for (let a = 0; a < n; a += 4) {
      const r0 = re[a] + re[a + 1];
      const i0 = im[a] + im[a + 1];
      const r1 = re[a] - re[a + 1];
      const i1 = im[a] - im[a + 1];
      const r2 = re[a + 2] + re[a + 3];
      const i2 = im[a + 2] + im[a + 3];
      const r3 = re[a + 2] - re[a + 3];
      const i3 = im[a + 2] - im[a + 3];
      re[a] = r0 + r2;
      im[a] = i0 + i2;
      re[a + 2] = r0 - r2;
      im[a + 2] = i0 - i2;
      // (r3 + i i3)·(−i) = i3 − i r3
      re[a + 1] = r1 + i3;
      im[a + 1] = i1 - r3;
      re[a + 3] = r1 - i3;
      im[a + 3] = i1 + r3;
    }
    for (let size = 8; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = C[k * step];
          const wi = S[k * step];
          const a = start + k;
          const b = a + half;
          const br = re[b];
          const bi = im[b];
          const xr = br * wr - bi * wi;
          const xi = br * wi + bi * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }

  /**
   * Forward 2-D FFT in place on row-major n×n (re, im).
   * rowLo..rowHi (inclusive): rows that may contain non-zero input (others are assumed zero).
   * cols: the column indices (kx) whose transforms are needed; other columns are left half-transformed.
   */
  forward(re: Float32Array, im: Float32Array, rowLo: number, rowHi: number, cols: Int32Array): void {
    const n = this.n;
    const tr = this.tr;
    const ti = this.ti;
    for (let r = rowLo; r <= rowHi; r++) {
      const o = r * n;
      for (let i = 0; i < n; i++) {
        tr[i] = re[o + i];
        ti[i] = im[o + i];
      }
      this.fft1();
      for (let i = 0; i < n; i++) {
        re[o + i] = tr[i];
        im[o + i] = ti[i];
      }
    }
    for (let ci = 0; ci < cols.length; ci++) {
      const c = cols[ci];
      for (let i = 0; i < n; i++) {
        tr[i] = re[i * n + c];
        ti[i] = im[i * n + c];
      }
      this.fft1();
      for (let i = 0; i < n; i++) {
        re[i * n + c] = tr[i];
        im[i * n + c] = ti[i];
      }
    }
  }
}
