import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEG,
  POLYSTYRENE,
  SILICON,
  dwbaSliceCoeffs,
  electronDensity,
  footprint,
  fresnel,
  optics,
  penetrationDepth,
  penetrationDepthDosch,
  refractedAngle,
  speckleSize,
  wavelengthNm,
  waveNumber,
} from '../src/ui/explainers/gisaxs/physics';
import { fft2, RealFFT2 } from '../src/ui/explainers/gisaxs/fft2';
import { fft2d, poisson, rng } from '../src/lib/fft';
import { Surface, N, PIXEL_NM } from '../src/ui/explainers/gisaxs/surface';
import { Detector, DQ, J_HALF } from '../src/ui/explainers/gisaxs/scatter';
import { SpeckleMemory } from '../src/ui/explainers/gisaxs/xpcs';

describe('gisaxs optics', () => {
  it('electron densities of Si and polystyrene', () => {
    // 0.699 e/Å³ and 0.340 e/Å³ (1 e/Å³ = 1000 e/nm³)
    expect(electronDensity(SILICON) / 1000).toBeCloseTo(0.699, 3);
    expect(electronDensity(POLYSTYRENE) / 1000).toBeCloseTo(0.34, 2);
  });

  it('wavelength and critical angles at 8 keV match tabulated values', () => {
    expect(wavelengthNm(8)).toBeCloseTo(0.15498, 4);
    const si = optics(SILICON, 8);
    const ps = optics(POLYSTYRENE, 8);
    // δ_Si(8 keV) ≈ 7.5–7.6e-6 (CXRO incl. f′: 7.58e-6; we neglect f′, ≤ 2 %)
    expect(si.delta).toBeGreaterThan(7.4e-6);
    expect(si.delta).toBeLessThan(7.7e-6);
    expect(si.alphaC / DEG).toBeGreaterThan(0.218);
    expect(si.alphaC / DEG).toBeLessThan(0.226);
    expect(ps.alphaC / DEG).toBeGreaterThan(0.15);
    expect(ps.alphaC / DEG).toBeLessThan(0.16);
    // β from NIST total attenuation: Si attenuation length at 8 keV ≈ 66 µm
    expect(1 / si.mu / 1000).toBeGreaterThan(62);
    expect(1 / si.mu / 1000).toBeLessThan(70);
    expect(si.beta).toBeGreaterThan(1.6e-7);
    expect(si.beta).toBeLessThan(2.0e-7);
  });

  it('critical angle scales as 1/E', () => {
    const a8 = optics(SILICON, 8).alphaC;
    const a16 = optics(SILICON, 16).alphaC;
    expect(a8 / a16).toBeCloseTo(2, 6);
  });

  it('Fresnel: total reflection below α_c, |T|² peaks near α_c, R → (α_c/2α)⁴ far above', () => {
    const o = optics(SILICON, 8);
    expect(fresnel(0.5 * o.alphaC, o.delta, o.beta).R).toBeGreaterThan(0.9);
    let best = 0;
    let bestA = 0;
    for (let a = 0.2 * o.alphaC; a < 3 * o.alphaC; a += 0.002 * o.alphaC) {
      const f = fresnel(a, o.delta, o.beta);
      expect(Math.hypot(f.tRe - 1 - f.rRe, f.tIm - f.rIm)).toBeLessThan(1e-12); // t = 1 + r
      if (f.T2 > best) {
        best = f.T2;
        bestA = a;
      }
    }
    // absorption (β) moves the |T|² maximum slightly above α_c
    expect(Math.abs(bestA / o.alphaC - 1)).toBeLessThan(0.04);
    expect(best).toBeGreaterThan(3.3);
    expect(best).toBeLessThanOrEqual(4);
    const a = 6 * o.alphaC;
    expect(fresnel(a, o.delta, o.beta).R / Math.pow(o.alphaC / (2 * a), 4)).toBeCloseTo(1, 1);
  });

  it('penetration depth: exact form = Dosch closed form; correct limits', () => {
    for (const E of [6, 8, 15, 30]) {
      for (const m of [SILICON, POLYSTYRENE]) {
        const o = optics(m, E);
        for (const a of [0.01, 0.1, 0.2, 0.4, 0.6]) {
          const ex = penetrationDepth(a * DEG, o);
          const ds = penetrationDepthDosch(a * DEG, o);
          expect(Math.abs(ex / ds - 1)).toBeLessThan(5e-3);
        }
        // α → 0: λ/(4π α_c)
        expect(penetrationDepth(1e-6, o) / (o.lambda / (4 * Math.PI * o.alphaC))).toBeCloseTo(1, 2);
        // α ≫ α_c: sin α / μ
        const a = 20 * o.alphaC;
        expect(penetrationDepth(a, o) / (Math.sin(a) / o.mu)).toBeCloseTo(1, 2);
      }
    }
    // Si, 8 keV, below α_c: a few nm
    const si = optics(SILICON, 8);
    const d = penetrationDepth(0.1 * DEG, si);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(5);
  });

  it('refraction angle is zero (evanescent) below α_c and → √(α²−α_c²) above', () => {
    const o = optics(SILICON, 8);
    // below α_c only absorption gives Re(k_z) ≈ k β/√(α_c²−α²) ≠ 0 — tiny
    expect(refractedAngle(0.5 * o.alphaC, o)).toBeLessThan(0.02 * o.alphaC);
    const a = 2 * o.alphaC;
    expect(refractedAngle(a, o) / Math.sqrt(a * a - o.alphaC * o.alphaC)).toBeCloseTo(1, 3);
  });

  it('footprint and speckle size', () => {
    // 0.3 µm CSSI focus at 0.3° → 57 µm footprint
    expect(footprint(0.3, 0.3 * DEG)).toBeCloseTo(57.3, 1);
    // λD/W at 8 keV, 22 m, 1 µm → 3.4 mm
    expect(speckleSize(wavelengthNm(8) * 1e-9, 22, 1e-6) * 1e3).toBeCloseTo(3.41, 2);
  });

  it('DWBA slice coefficients reduce to Δh·T_i·T_f for thin slices', () => {
    const o = optics(SILICON, 8);
    const k = waveNumber(8);
    const ai = 0.3 * DEG;
    const af = o.alphaC;
    const fi = fresnel(ai, o.delta, o.beta);
    const ff = fresnel(af, o.delta, o.beta);
    const cRe = new Float64Array(1);
    const cIm = new Float64Array(1);
    const dh = 1e-4;
    dwbaSliceCoeffs(k * Math.sin(ai), k * Math.sin(af), fi, ff, 1, dh, cRe, cIm);
    const tr = fi.tRe * ff.tRe - fi.tIm * ff.tIm;
    const ti = fi.tRe * ff.tIm + fi.tIm * ff.tRe;
    expect(cRe[0] / dh).toBeCloseTo(tr, 4);
    expect(cIm[0] / dh).toBeCloseTo(ti, 4);
  });
});

describe('gisaxs numerics', () => {
  it('local FFTs match lib/fft', () => {
    const n = 32;
    const r = rng(5);
    const re = new Float64Array(n * n).map(() => r() - 0.5);
    const im = new Float64Array(n * n).map(() => r() - 0.5);
    const a = [re.slice(), im.slice()];
    const b = [re.slice(), im.slice()];
    fft2d(a[0], a[1], n);
    fft2(b[0], b[1], n);
    for (let i = 0; i < n * n; i++) {
      expect(b[0][i]).toBeCloseTo(a[0][i], 9);
      expect(b[1][i]).toBeCloseTo(a[1][i], 9);
    }
    // real-input transform (transposed half spectrum) and its inverse
    const x = new Float64Array(n * n).map(() => r() - 0.5);
    const fr = x.slice();
    const fi = new Float64Array(n * n);
    fft2(fr, fi, n);
    const R = new RealFFT2(n);
    const hr = new Float64Array((n / 2 + 1) * n);
    const hi = new Float64Array((n / 2 + 1) * n);
    R.forward(x, hr, hi);
    for (let kx = 0; kx <= n / 2; kx++)
      for (let ky = 0; ky < n; ky++) {
        expect(hr[kx * n + ky]).toBeCloseTo(fr[ky * n + kx], 9);
        expect(hi[kx * n + ky]).toBeCloseTo(fi[ky * n + kx], 9);
      }
    const y = new Float64Array(n * n);
    R.inverse(hr, hi, y);
    for (let i = 0; i < n * n; i++) expect(y[i]).toBeCloseTo(x[i], 12);
  });

  it('Cahn–Hilliard conserves the mean and coarsens', () => {
    const s = new Surface(3);
    s.seedRipened(3, 7.5);
    const mean0 = s.phi.reduce((a, b) => a + b, 0) / s.phi.length;
    const L0 = s.lengthScalePx();
    for (let i = 0; i < 300; i++) s.step(s.dtFor(s.t));
    const mean1 = s.phi.reduce((a, b) => a + b, 0) / s.phi.length;
    expect(Math.abs(mean1 - mean0)).toBeLessThan(1e-9);
    expect(s.lengthScalePx()).toBeGreaterThan(1.25 * L0);
    const cov = s.coverage();
    expect(cov).toBeGreaterThan(0.25);
    expect(cov).toBeLessThan(0.4);
  });

  it('coherent pattern averages to the incoherent one; Yoneda peak at α_f = α_c; side peaks at 2π/L', () => {
    const s = new Surface(9);
    s.seedRipened(9, 7.5);
    s.computeHeight();
    s.computeSpectra();
    const d = new Detector();
    d.updateSpectra(s, 0);
    const E = 8;
    const ai = 0.4 * DEG;
    d.compute(s, E, ai, true);
    let sc = 0;
    let si = 0;
    for (let i = 0; i < d.inc.length; i++) {
      sc += d.coh[i];
      si += d.inc[i];
    }
    expect(sc / si).toBeGreaterThan(0.8);
    expect(sc / si).toBeLessThan(1.25);
    // Yoneda: along α_f at the correlation peak, the maximum sits at α_c(Si)
    const col = J_HALF + Math.round(d.peakBin);
    let best = 0;
    let bestAf = 0;
    for (let r = 0; r < d.rows; r++) {
      const v = d.inc[r * d.cols + col];
      if (v > best) {
        best = v;
        bestAf = d.af[r];
      }
    }
    const ac = optics(SILICON, E).alphaC;
    expect(Math.abs(bestAf - ac) / DEG).toBeLessThan(0.02);
    // side peak ↔ real-space spacing from the order parameter (same ballpark: 2π/q* vs 2π/<k>)
    const Lpeak = (2 * Math.PI) / (d.peakBin * DQ);
    const Lmean = s.lengthScalePx() * PIXEL_NM;
    expect(Lpeak / Lmean).toBeGreaterThan(0.7);
    expect(Lpeak / Lmean).toBeLessThan(1.4);
    expect(N).toBe(128);
  });
});

describe('gisaxs GI-XPCS speckle memory', () => {
  const n = 3000;
  // smooth GISAXS-like envelope varying by ~10× across the ROI
  const mean = Float64Array.from({ length: n }, (_, i) => 0.1 + Math.exp(-i / 400));
  const roi = Array.from({ length: n }, (_, i) => i);
  // fully developed speckle: exponential intensity statistics around the envelope
  const speckle = (r: () => number, env: Float64Array) => Float64Array.from(env, (m) => m * -Math.log(1 - r()));

  it('normalising by the ensemble mean: identical frames → 1, independent speckle → ≈ 0 despite a strong envelope', () => {
    const r = rng(4);
    const mem = new SpeckleMemory(8, n);
    mem.setRoi(roi);
    const a = speckle(r, mean);
    mem.push(a, a, mean, 0);
    mem.push(a, a, mean, 1);
    expect(mem.curve[0]).toBeCloseTo(1, 9);
    expect(mem.sigma).toBe(0); // no shot noise
    const b = speckle(r, mean);
    mem.push(b, b, mean, 2);
    expect(Math.abs(mem.curve[0])).toBeLessThan(0.08);
    expect(Math.abs(mem.curve[1])).toBeLessThan(0.08);
    // without the normalisation the static envelope alone would fake a long memory
    const raw = new SpeckleMemory(8, n);
    raw.setRoi(roi);
    const ones = new Float64Array(n).fill(1);
    const c = speckle(r, mean);
    const d = speckle(r, mean);
    raw.push(c, c, ones, 0);
    raw.push(d, d, ones, 1);
    expect(raw.curve[0]).toBeGreaterThan(0.15);
  });

  it('shot noise scatters C(τ) but does not bias it (unlike a Pearson coefficient); σ estimate is realistic', () => {
    const r = rng(8);
    const clean = speckle(r, mean);
    const scale = 0.5; // ≈ 0.2 photons per bin on average: very low counts
    const frame = () => Float64Array.from(clean, (v) => poisson(v * scale, r) / scale);
    const vals: number[] = [];
    let sig = 0;
    for (let k = 0; k < 60; k++) {
      const mem = new SpeckleMemory(4, n);
      mem.setRoi(roi);
      mem.push(frame(), clean, mean, 0, scale);
      mem.push(frame(), clean, mean, 1, scale);
      vals.push(mem.curve[0]);
      sig = mem.sigma;
    }
    const avg = vals.reduce((x, y) => x + y, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((x, y) => x + (y - avg) ** 2, 0) / (vals.length - 1));
    // same speckle, independent Poisson realisations: unbiased → mean ≈ 1 (a Pearson estimate would give ≈ 0.2)
    expect(Math.abs(avg - 1)).toBeLessThan(0.1);
    expect(sd).toBeGreaterThan(0.05);
    expect(sig / sd).toBeGreaterThan(0.5);
    expect(sig / sd).toBeLessThan(2);
  });
});

describe('one presentation for every reader', () => {
  it('the station never reads the retired Visitor/Specialist depth', () => {
    const src = ['gisaxs.ts', 'gisaxs/views.ts', 'gisaxs/xpcs.ts'].map((f) => readFileSync(join(__dirname, '../src/ui/explainers', f), 'utf8')).join('\n');
    expect(src).not.toMatch(/ctx\.depth|station\.depth|setDepth|'specialist'|data-depth|app\/store/);
  });
});
