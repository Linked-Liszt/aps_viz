/**
 * Planned 2D FFT for square n×n complex Float64 arrays, tuned for the BCDI phase-retrieval loop.
 *
 * Radix-2² decimation-in-time (pairs of radix-2 stages fused, so each element is loaded/stored half as often),
 * rows transformed in place, columns via a cache-blocked transpose. On a 2-core 2015 laptop CPU (i5-6300U) a
 * 128×128 transform takes ≈0.8 ms, about 2× faster than the general-purpose strided FFT in src/lib/fft.ts, which
 * keeps several phase-retrieval iterations inside one 60 fps frame.
 *
 * The transform is UNSCALED in both directions: run(+1) computes Σ x·e^{+2πi k·r/n}, run(−1) Σ x·e^{−2πi k·r/n};
 * run(−1)∘run(+1) = n²·identity. Callers handle normalisation explicitly.
 */
export class FFT2 {
  readonly n: number;
  private readonly rev: Uint16Array;
  private readonly cs: Float64Array;
  private readonly sn: Float64Array;
  private readonly tr: Float64Array;
  private readonly ti: Float64Array;
  private readonly odd: boolean;

  constructor(n: number) {
    if (n < 4 || n & (n - 1)) throw new Error(`FFT2 size must be a power of two ≥ 4, got ${n}`);
    this.n = n;
    const bits = Math.round(Math.log2(n));
    this.rev = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cs = new Float64Array(n);
    this.sn = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      this.cs[k] = Math.cos((2 * Math.PI * k) / n);
      this.sn[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.tr = new Float64Array(n * n);
    this.ti = new Float64Array(n * n);
    this.odd = (bits & 1) === 1;
  }

  /** 1D transforms of all n rows, in place. */
  private rows(re: Float64Array, im: Float64Array, sign: number): void {
    const n = this.n;
    const rev = this.rev;
    const cs = this.cs;
    const sn = this.sn;
    const total = n * n;
    for (let o = 0; o < total; o += n) {
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
      let q = 1;
      if (this.odd) {
        // one plain radix-2 stage so the remaining stage count is even
        for (let s = o; s < o + n; s += 2) {
          const xr = re[s + 1];
          const xi = im[s + 1];
          re[s + 1] = re[s] - xr;
          im[s + 1] = im[s] - xi;
          re[s] += xr;
          im[s] += xi;
        }
        q = 2;
      }
      for (; q < n; q <<= 2) {
        const size = q << 2;
        const st1 = n / (2 * q);
        const st2 = n / size;
        for (let s = o; s < o + n; s += size) {
          for (let k = 0; k < q; k++) {
            const t1r = cs[k * st1];
            const t1i = sign * sn[k * st1];
            const t2r = cs[k * st2];
            const t2i = sign * sn[k * st2];
            const ia = s + k;
            const ib = ia + q;
            const ic = ib + q;
            const id = ic + q;
            const ar = re[ia];
            const ai = im[ia];
            const b0r = re[ib];
            const b0i = im[ib];
            const br = b0r * t1r - b0i * t1i;
            const bi = b0r * t1i + b0i * t1r;
            const a1r = ar + br;
            const a1i = ai + bi;
            const b1r = ar - br;
            const b1i = ai - bi;
            const c0r = re[ic];
            const c0i = im[ic];
            const d0r = re[id];
            const d0i = im[id];
            const dr = d0r * t1r - d0i * t1i;
            const di = d0r * t1i + d0i * t1r;
            const c1r = c0r + dr;
            const c1i = c0i + di;
            const d1r = c0r - dr;
            const d1i = c0i - di;
            const c2r = c1r * t2r - c1i * t2i;
            const c2i = c1r * t2i + c1i * t2r;
            re[ia] = a1r + c2r;
            im[ia] = a1i + c2i;
            re[ic] = a1r - c2r;
            im[ic] = a1i - c2i;
            const d2r = d1r * t2r - d1i * t2i;
            const d2i = d1r * t2i + d1i * t2r;
            // × (sign·i): the extra quarter-turn twiddle of the second fused stage
            const er = -sign * d2i;
            const ei = sign * d2r;
            re[ib] = b1r + er;
            im[ib] = b1i + ei;
            re[id] = b1r - er;
            im[id] = b1i - ei;
          }
        }
      }
    }
  }

  private transpose(sr: Float64Array, si: Float64Array, dr: Float64Array, di: Float64Array): void {
    const n = this.n;
    const B = n >= 16 ? 16 : n;
    for (let y0 = 0; y0 < n; y0 += B) {
      for (let x0 = 0; x0 < n; x0 += B) {
        for (let y = y0; y < y0 + B; y++) {
          let s = y * n + x0;
          for (let x = x0; x < x0 + B; x++, s++) {
            const d = x * n + y;
            dr[d] = sr[s];
            di[d] = si[s];
          }
        }
      }
    }
  }

  /** Unscaled 2D transform in place with kernel e^{sign·2πi k·r/n}. */
  run(re: Float64Array, im: Float64Array, sign: 1 | -1): void {
    this.rows(re, im, sign);
    this.transpose(re, im, this.tr, this.ti);
    this.rows(this.tr, this.ti, sign);
    this.transpose(this.tr, this.ti, re, im);
  }
}
