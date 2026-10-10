import { describe, expect, it } from 'vitest';
import { fft1d, fft2d, fftshift2d, rng, poisson } from '../src/lib/fft';

describe('fft', () => {
  it('matches a naive DFT', () => {
    const n = 16;
    const r = rng(3);
    const re = new Float64Array(n).map(() => r() - 0.5);
    const im = new Float64Array(n).map(() => r() - 0.5);
    const dre = new Float64Array(n);
    const dim = new Float64Array(n);
    for (let k = 0; k < n; k++)
      for (let t = 0; t < n; t++) {
        const a = (-2 * Math.PI * k * t) / n;
        dre[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a);
        dim[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a);
      }
    fft1d(re, im, n);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(dre[k], 9);
      expect(im[k]).toBeCloseTo(dim[k], 9);
    }
  });
  it('2D forward+inverse is identity and shift centres DC', () => {
    const n = 8;
    const r = rng(5);
    const re = new Float32Array(n * n).map(() => r());
    const im = new Float32Array(n * n);
    const orig = re.slice();
    fft2d(re, im, n);
    const dc = re[0];
    fft2d(re, im, n, true);
    for (let i = 0; i < n * n; i++) expect(re[i]).toBeCloseTo(orig[i], 4);
    const a = new Float32Array(n * n);
    a[0] = dc;
    fftshift2d(a, n);
    expect(a[(n / 2) * n + n / 2]).toBeCloseTo(dc, 5);
  });
  it('poisson has the right mean', () => {
    const r = rng(9);
    let s = 0;
    for (let i = 0; i < 20000; i++) s += poisson(3.2, r);
    expect(s / 20000).toBeCloseTo(3.2, 1);
  });
});
