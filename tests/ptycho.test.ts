import { describe, expect, it } from 'vitest';
import { fft2d } from '../src/lib/fft';
import { fft2, fft2FwdT, fft2InvT } from '../src/ui/explainers/ptycho/fft64';
import {
  DET_DIST_MM,
  FLUX,
  FrcMeter,
  GEOM,
  K_NM,
  LAMBDA_NM,
  Measurement,
  NA,
  PROBE_D_NM,
  PUPIL_R_PX,
  PtychoSolver,
  ZP_FOCAL_MM,
  ZP_ZONES,
  angleMrad,
  areaOverlap,
  compareObject,
  emptyMeans,
  expectedAll,
  expectedPattern,
  fovWindow,
  halfPeriodNm,
  illumination,
  makeChip,
  makeProbe,
  makeScan,
  poissonFast,
  probeStats,
  sampleData,
  simulate,
  slab,
  stepForOverlap,
  windowMask,
  type ComplexField,
} from '../src/ui/explainers/ptycho/physics';
import { rng } from '../src/lib/fft';

const N = GEOM.N;
const M = GEOM.M;

describe('geometry (10 keV, 4-nm-zone FZP, 64 × 75 µm detector crop)', () => {
  it('wavelength, NA, zone plate and detector distance', () => {
    expect(LAMBDA_NM).toBeCloseTo(0.12398, 4);
    expect(NA * 1e3).toBeCloseTo(15.5, 1); // λ/(2Δr_N)
    expect(ZP_FOCAL_MM).toBeCloseTo(5.81, 2); // f = DΔr_N/λ, FDR: 5.8 mm
    expect(ZP_ZONES).toBeCloseTo(11250, 0); // FDR: 11 250 zones
    expect(DET_DIST_MM).toBeCloseTo(77.4, 1); // Δx = λz/(Mp) = 2 nm
    expect(PUPIL_R_PX).toBeCloseTo(16, 6); // NA/λ in detector pixels: bright field fills half the detector
    expect(PROBE_D_NM).toBeCloseTo(46.5, 1); // 2·NA·Δz
    expect(halfPeriodNm(M / 2)).toBeCloseTo(GEOM.dxNm, 9); // detector edge ↔ pixel size
    expect(angleMrad(M / 2)).toBeCloseTo(31.0, 1);
  });

  it('APS-U is ~100× the pre-upgrade coherent flux', () => {
    expect(FLUX.apsu / FLUX.aps).toBeCloseTo(100, 6);
    expect(FLUX.apsu).toBe(3.1e10);
  });
});

describe('FFT (fft64)', () => {
  it('transposed forward + inverse is the identity, and matches the reference FFT', () => {
    const r = rng(5);
    const re = new Float64Array(M * M).map(() => r() - 0.5);
    const im = new Float64Array(M * M).map(() => r() - 0.5);
    const re0 = Float64Array.from(re);
    const im0 = Float64Array.from(im);
    // natural-order forward vs src/lib/fft
    const a = Float64Array.from(re);
    const b = Float64Array.from(im);
    fft2(a, b, M);
    const c = Float64Array.from(re);
    const d = Float64Array.from(im);
    fft2d(c, d, M);
    let err = 0;
    for (let i = 0; i < M * M; i++) err = Math.max(err, Math.abs(a[i] - c[i]), Math.abs(b[i] - d[i]));
    expect(err).toBeLessThan(1e-9);
    // transposed layout: element [kx·M + ky]
    fft2FwdT(re, im, M);
    for (const [kx, ky] of [
      [1, 0],
      [3, 7],
      [60, 2],
    ])
      expect(re[kx * M + ky]).toBeCloseTo(a[ky * M + kx], 9);
    fft2InvT(re, im, M);
    for (let i = 0; i < M * M; i++) {
      expect(re[i]).toBeCloseTo(re0[i], 10);
      expect(im[i]).toBeCloseTo(im0[i], 10);
    }
  });
});

describe('object, probe and scan', () => {
  it('thin-object transmission: φ = kδt, a = exp(−kβt); hard X-rays see mostly phase', () => {
    const au = slab('Au', 150);
    expect(au.phase).toBeCloseTo(K_NM * 3.0e-5 * 150, 9);
    expect(au.phase).toBeCloseTo(0.228, 3);
    // intensity absorption 1 − e^{−2kβt} ≈ 3.4 %: hard X-rays see mostly phase
    expect(1 - au.amp * au.amp).toBeCloseTo(0.034, 3);
    const chip = makeChip();
    expect(chip.maxPhase).toBeCloseTo(au.phase, 6);
    // |O| ≤ 1 everywhere, empty membrane = 1
    let mx = 0;
    for (let i = 0; i < N * N; i++) mx = Math.max(mx, Math.hypot(chip.re[i], chip.im[i]));
    expect(mx).toBeCloseTo(1, 9);
    expect(chip.re[0]).toBe(1);
  });

  it('probe is normalised, centred and ≈ the geometric cone diameter', () => {
    const p = makeProbe();
    let s = 0;
    let cx = 0;
    let cy = 0;
    for (let y = 0; y < M; y++)
      for (let x = 0; x < M; x++) {
        const I = p.re[y * M + x] ** 2 + p.im[y * M + x] ** 2;
        s += I;
        cx += I * x;
        cy += I * y;
      }
    expect(s).toBeCloseTo(1, 9);
    expect(cx / s).toBeCloseTo(M / 2, 0);
    expect(cy / s).toBeCloseTo(M / 2, 0);
    const st = probeStats(p);
    const dPx = PROBE_D_NM / GEOM.dxNm;
    expect(st.d90).toBeGreaterThan(0.8 * dPx);
    expect(st.d90).toBeLessThan(1.4 * dPx);
  });

  it('scan step follows o = 1 − s/d; positions stay inside the object', () => {
    expect(stepForOverlap(0.7)).toBeCloseTo(0.3 * (PROBE_D_NM / GEOM.dxNm), 9);
    const s70 = makeScan('raster', 0.7);
    expect(s70.count).toBe(100);
    const s0 = makeScan('raster', 0);
    expect(s0.count).toBe(9);
    const sp = makeScan('spiral', 0.7);
    expect(sp.count).toBeGreaterThan(70);
    expect(sp.count).toBeLessThan(130);
    for (const sc of [s70, s0, sp])
      for (let j = 0; j < sc.count; j++) {
        expect(sc.x[j]).toBeGreaterThanOrEqual(0);
        expect(sc.x[j]).toBeLessThanOrEqual(N - M);
        expect(sc.y[j]).toBeGreaterThanOrEqual(0);
        expect(sc.y[j]).toBeLessThanOrEqual(N - M);
      }
    expect(areaOverlap(0, 10)).toBeCloseTo(1, 9);
    expect(areaOverlap(10, 10)).toBe(0);
  });
});

describe('forward model and noise', () => {
  it('Parseval: Σ expected counts = N_ph Σ|P·O|² (= N_ph through an empty membrane)', () => {
    const p = makeProbe();
    const ones = { re: new Float64Array(N * N).fill(1), im: new Float64Array(N * N) };
    const wRe = new Float64Array(M * M);
    const wIm = new Float64Array(M * M);
    const mean = new Float32Array(M * M);
    expect(expectedPattern(ones, N, p, M, 10, 20, 1e6, wRe, wIm, mean)).toBeCloseTo(1e6, -1);
    const chip = makeChip();
    const tot = expectedPattern(chip, N, p, M, 32, 32, 1e6, wRe, wIm, mean);
    expect(tot).toBeLessThan(1e6);
    expect(tot).toBeGreaterThan(0.97e6);
  });

  it('a pure phase object scatters outside the bright-field disc (dark field)', () => {
    const p = makeProbe();
    const chip = makeChip();
    const wRe = new Float64Array(M * M);
    const wIm = new Float64Array(M * M);
    const mean = new Float32Array(M * M);
    const ones: ComplexField = { re: new Float64Array(N * N).fill(1), im: new Float64Array(N * N) };
    const dark = (o: ComplexField) => {
      expectedPattern(o, N, p, M, 32, 0, 1, wRe, wIm, mean);
      let s = 0;
      for (let ky = 0; ky < M; ky++)
        for (let kx = 0; kx < M; kx++) {
          const fx = kx < M / 2 ? kx : kx - M;
          const fy = ky < M / 2 ? ky : ky - M;
          if (Math.hypot(fx, fy) > PUPIL_R_PX + 2) s += mean[kx * M + ky];
        }
      return s;
    };
    expect(dark(ones)).toBeLessThan(1e-4);
    expect(dark(chip)).toBeGreaterThan(20 * dark(ones));
  });

  it('Poisson sampler: mean and variance', () => {
    const r = rng(11);
    for (const mu of [0.3, 4, 25, 400]) {
      let s = 0;
      let s2 = 0;
      const n = 40000;
      for (let i = 0; i < n; i++) {
        const v = poissonFast(mu, r);
        s += v;
        s2 += v * v;
      }
      const m = s / n;
      const v = s2 / n - m * m;
      expect(Math.abs(m - mu) / mu).toBeLessThan(0.03);
      expect(Math.abs(v - mu) / mu).toBeLessThan(0.06);
    }
  });

  it('incremental Measurement equals the batch simulation (same seed)', () => {
    const chip = makeChip();
    const p = makeProbe();
    const scan = makeScan('raster', 0.3);
    const a = simulate(chip, N, p, M, scan, 1e5, 4);
    const meas = new Measurement(chip, p, emptyMeans(scan), 1e5, N, M, 4);
    while (!meas.done) meas.step();
    const b = meas.data;
    expect(b.totalCounts).toBe(a.totalCounts);
    expect(b.counts[3][100]).toBe(a.counts[3][100]);
    expect(b.r1).toBe(a.r1);
    // reusing cached expected patterns at a 100× lower dose gives ~100× fewer counts
    const c = sampleData(expectedAll(chip, N, p, M, scan), 1e3, M, 4);
    expect(c.totalCounts / a.totalCounts).toBeCloseTo(0.01, 3);
  });
});

describe('reconstruction (ePIE) reproduces the station demonstrations', () => {
  const chip = makeChip();
  const probe = makeProbe();
  const guess = makeProbe({ defocusUm: 1.0 });
  const frc = new FrcMeter(chip);
  // one fixed field of view for every scan (as in the station)
  const fov = fovWindow();
  const mask = windowMask(fov);
  frc.setWindow(fov);
  const run = (overlap: number, nPh: number, iters: number) => {
    const scan = makeScan('raster', overlap);
    const sol = new PtychoSolver(simulate(chip, N, probe, M, scan, nPh), guess, N, M);
    for (let i = 0; i < iters; i++) sol.step(scan.count);
    const g = compareObject(chip, sol.O, mask);
    return { err: g.err, res: frc.measure(sol.O, g.gRe, g.gIm), errF: sol.errF };
  };

  it('FRC meter: truth vs truth is pixel-limited; the FOV covers the default scan', () => {
    expect(frc.measure(chip, 1, 0)).toBe(GEOM.dxNm);
    // the ε mask is lit by the default (70 %) scan: > 90 % of it at ≥ 30 % of peak, nothing dark (raster corners ≈ 10 %)
    const ill = illumination(makeScan('raster', 0.7), probe);
    let mx = 0;
    for (const v of ill) mx = Math.max(mx, v);
    let worst = Infinity;
    let dim = 0;
    let cnt = 0;
    for (let i = 0; i < N * N; i++) {
      if (!mask[i]) continue;
      cnt++;
      worst = Math.min(worst, ill[i] / mx);
      if (ill[i] / mx < 0.3) dim++;
    }
    expect(worst).toBeGreaterThan(0.08);
    expect(dim / cnt).toBeLessThan(0.1);
    expect(fov[64 * N + 64]).toBe(1);
    expect(fov[0]).toBe(0);
  });

  it('APS-U dose, 70 % overlap: converges to a sharp image', () => {
    const r = run(0.7, 9.3e5, 40);
    expect(r.err).toBeLessThan(0.32);
    expect(r.res).toBeLessThanOrEqual(2.5);
    expect(r.errF[r.errF.length - 1]).toBeLessThan(r.errF[0]);
  }, 120000);

  it('pre-upgrade dose (÷100): noisy, much coarser', () => {
    const r = run(0.7, 9.3e3, 40);
    expect(r.err).toBeGreaterThan(0.6);
    expect(r.res).toBeGreaterThan(5);
  }, 120000);

  it('too little overlap (≈ 23 %): blind retrieval fails', () => {
    const r = run(1 - 36 / PROBE_D_NM, 9.3e5, 40);
    expect(r.err).toBeGreaterThan(0.6);
  }, 120000);

  it('44 % overlap: garbled image is not reported as pixel-limited (regression: illumination-weighted FRC)', () => {
    const r = run(1 - 26 / PROBE_D_NM, 9.3e5, 60);
    expect(r.err).toBeGreaterThan(0.5);
    expect(r.res).toBeGreaterThan(4);
  }, 120000);

  it('slider minimum (APS, 10 µs ≈ 3 × 10³ photons/shot): a coarse image, not a diverged one', () => {
    const r = run(1 - 14 / PROBE_D_NM, FLUX.aps * 10e-6, 30);
    expect(r.res).toBeGreaterThan(6);
    expect(r.res).toBeLessThan(15);
  }, 120000);

  it('stays bounded at very low dose (probe-power constraint)', () => {
    const r = run(0.7, 1e3, 30);
    for (const e of r.errF) expect(e).toBeLessThan(2);
  }, 120000);
});
