import { describe, expect, it } from 'vitest';
import * as P from '../src/ui/explainers/undulator/physics';

const APSU = P.RINGS.apsu;
const APS = P.RINGS.aps;

/** independent power-series J_n for cross-checks */
function jSeries(n: number, x: number): number {
  let s = 0;
  let fact = 1;
  for (let i = 2; i <= n; i++) fact *= i;
  let term = Math.pow(x / 2, n) / fact;
  for (let m = 0; m < 60; m++) {
    s += term;
    term *= -(x * x) / 4 / ((m + 1) * (m + 1 + n));
  }
  return s;
}

describe('kinematics and the undulator equation', () => {
  it('γ(6 GeV) = 11,742 and 1/γ = 85 µrad', () => {
    expect(P.gammaOf(6)).toBeCloseTo(11741.7, 0);
    expect(1e6 / P.gammaOf(6)).toBeCloseTo(85.2, 1);
  });
  it('K = 0.9337 B[T] λu[cm]', () => {
    expect(P.kOf(1, 10)).toBeCloseTo(0.9337, 4);
    expect(P.bOfK(P.kOf(0.7, 28), 28)).toBeCloseTo(0.7, 12);
  });
  it('E_n = n · 0.9496 E² / (λu[cm](1 + K²/2)) keV', () => {
    for (const [E, lam, K] of [
      [6, 28, 2.48],
      [7, 33, 2.6],
      [6, 16.5, 1.63],
    ]) {
      const ref = (0.9496 * E * E) / ((lam / 10) * (1 + (K * K) / 2));
      expect(P.energyN(1, E, lam, K) / ref).toBeCloseTo(1, 3);
      expect(P.energyN(5, E, lam, K) / P.energyN(1, E, lam, K)).toBeCloseTo(5, 12);
    }
  });
  it('7 → 6 GeV lowers every harmonic by (6/7)² = 0.735', () => {
    expect(P.energyN(1, 6, 28, 1.5) / P.energyN(1, 7, 28, 1.5)).toBeCloseTo(36 / 49, 12);
  });
  it('off-axis red shift: λ(θ = 1/γ) = λ(0)·(2 + K²/2)/(1 + K²/2)', () => {
    expect(P.lambdaN(1, 6, 28, 1, 1) / P.lambdaN(1, 6, 28, 1, 0)).toBeCloseTo(2.5 / 1.5, 12);
  });
});

describe('magnet models', () => {
  it('Elleaume hybrid fit: B₀(8.5 mm, 28 mm) ≈ 0.912 T', () => {
    expect(P.hybridField(8.5, 28)).toBeCloseTo(0.912, 2);
  });
  it('per-device scale reproduces the APS K at minimum gap and stays a modest correction (2–18 %)', () => {
    for (const id of P.PM_IDS) {
      const d = P.DEVICES[id];
      expect(P.kAt(d, d.gapMinMm)).toBeCloseTo(d.kRef, 10);
      const s = P.pmScale(d);
      expect(s).toBeGreaterThan(1.0);
      expect(s).toBeLessThan(1.18);
    }
  });
  it('first-harmonic energies at minimum gap match the APS ID table (6 GeV)', () => {
    const table: [P.DeviceId, number][] = [
      ['u33', 2.0],
      ['u28', 3.0],
      ['u25', 4.6],
      ['u21', 8.4],
      ['u13', 23.4],
    ];
    for (const [id, e1] of table) {
      const d = P.DEVICES[id];
      expect(Math.abs(P.energyN(1, 6, d.periodMm, P.kAt(d, d.gapMinMm)) - e1)).toBeLessThan(0.06);
    }
    // SCU 18.5 mm, K = 2.291 → 5.1 keV (FDR Table 4.13); 16.5 mm K_max 1.63 ↔ 1.06 T
    expect(P.energyN(1, 6, 18.5, P.kAt(P.DEVICES.scu18, 1))).toBeCloseTo(5.1, 1);
    expect(P.fieldAt(P.DEVICES.scu16, 1)).toBeCloseTo(1.06, 2);
  });
  it('old APS Undulator A at 7 GeV and 10.5 mm: E₁ ≈ 3.1 keV', () => {
    const d = P.DEVICES.u33;
    expect(P.energyN(1, 7, 33, P.kAt(d, 10.5))).toBeCloseTo(3.1, 1);
  });
  it('K falls monotonically with gap and settingForK inverts kAt', () => {
    for (const id of [...P.PM_IDS, ...P.SCU_IDS]) {
      const d = P.DEVICES[id];
      const [lo, hi] = P.settingRange(d);
      let prev = d.kind === 'pm' ? Infinity : -Infinity;
      for (let i = 0; i <= 20; i++) {
        const s = lo + ((hi - lo) * i) / 20;
        const K = P.kAt(d, s);
        if (d.kind === 'pm') expect(K).toBeLessThan(prev);
        else expect(K).toBeGreaterThan(prev);
        prev = K;
        expect(P.settingForK(d, K)).toBeCloseTo(s, 6);
      }
    }
  });
  it('superconducting coils give ~2× the field of permanent magnets at the same short period and 8 mm gap', () => {
    for (const id of P.SCU_IDS) {
      const d = P.DEVICES[id];
      const ratio = P.fieldAt(d, 1) / P.pmFieldEstimate(d.gapMinMm, d.periodMm);
      expect(ratio).toBeGreaterThan(1.7);
      expect(ratio).toBeLessThan(2.4);
    }
  });
});

describe('special functions', () => {
  it('Bessel J_n matches the power series', () => {
    for (const n of [0, 1, 2, 5, 10]) for (const x of [0.05, 0.4, 1, 2.5, 6]) expect(P.besselJ(n, x)).toBeCloseTo(jSeries(n, x), 10);
  });
  it('Bessel J_n stays accurate for the high orders/arguments used by the spectrum (n ≤ 61, x ≤ 31)', () => {
    // reference: same integral with many more points
    const ref = (n: number, x: number) => {
      const M = 4096;
      let s = 0;
      for (let k = 0; k < M; k++) {
        const t = (2 * Math.PI * k) / M;
        s += Math.cos(n * t - x * Math.sin(t));
      }
      return s / M;
    };
    for (const n of [20, 30, 45, 61]) for (const x of [1, 8, 15.5, 31]) expect(Math.abs(P.besselJ(n, x) - ref(n, x))).toBeLessThan(1e-13);
    expect(P.besselJ(20, 25)).toBeCloseTo(jSeries(20, 25), 9);
  });
  it('modified Bessel K_ν: exact half-integer orders', () => {
    for (const x of [0.02, 0.3, 1, 4, 12]) {
      const k12 = Math.sqrt(Math.PI / (2 * x)) * Math.exp(-x);
      expect(P.besselK(0.5, x) / k12).toBeCloseTo(1, 6);
      expect(P.besselK(1.5, x) / (k12 * (1 + 1 / x))).toBeCloseTo(1, 6);
    }
  });
  it('H₂(y) peaks at ≈1.47 near y ≈ 0.83 (X-ray Data Booklet Fig. 2-2)', () => {
    let best = 0;
    let at = 0;
    for (let y = 0.2; y < 3; y += 0.005) {
      const h = P.H2(y);
      if (h > best) {
        best = h;
        at = y;
      }
    }
    expect(best).toBeCloseTo(1.47, 1);
    expect(at).toBeGreaterThan(0.7);
    expect(at).toBeLessThan(0.95);
  });
  it('bending-magnet critical energies: APS 19.5 keV, APS-U B:M3 15.6 keV', () => {
    expect(P.criticalEnergy(APS.E, APS.bmB)).toBeCloseTo(19.5, 1);
    expect(P.criticalEnergy(APSU.E, APSU.bmB)).toBeCloseTo(15.6, 1);
  });
});

describe('harmonic strengths F_n(K)', () => {
  it('weak undulator: F₁ → K², higher harmonics vanish', () => {
    expect(P.Fn(1, 0.05) / 0.0025).toBeCloseTo(1, 2);
    expect(P.Fn(3, 0.1)).toBeLessThan(1e-4);
    expect(P.Fn(2, 1.5)).toBe(0);
  });
  it('F₁ peaks at ≈0.39 for K ≈ 1.2–1.3 (Kim 1989; X-ray Data Booklet Fig. 2-4)', () => {
    let best = 0;
    let at = 0;
    for (let K = 0.2; K < 4; K += 0.01) {
      const f = P.Fn(1, K);
      if (f > best) {
        best = f;
        at = K;
      }
    }
    expect(best).toBeGreaterThan(0.38);
    expect(best).toBeLessThan(0.43);
    expect(at).toBeGreaterThan(1.1);
    expect(at).toBeLessThan(1.8);
  });
  it('Liénard–Wiechert on-axis waveform: 4|c_n|² = F_n(K) for odd n; even harmonics vanish', () => {
    const buf = new Float32Array(4096);
    const f64 = new Float64Array(4096);
    for (const K of [0.3, 1, 1.73, 2.86, 5]) {
      P.waveform(K, buf);
      f64.set(buf);
      for (const n of [1, 3, 5, 7, 9]) {
        const fn = P.Fn(n, K);
        if (fn < 1e-8) continue;
        expect((4 * P.harmonicPower(f64, n)) / fn).toBeCloseTo(1, 3);
      }
      expect(P.harmonicPower(f64, 2)).toBeLessThan(1e-10);
      expect(P.harmonicPower(f64, 4)).toBeLessThan(1e-10);
    }
  });
});

describe('spectra', () => {
  it('U28 at minimum gap, APS-U: on-axis peak ≈ 2×10¹⁸ ph/s/mrad²/0.1 %BW', () => {
    const d = P.DEVICES.u28;
    const f = P.undulatorPeak(1, d.kRef, d.N, APSU.E, APSU.I);
    expect(f).toBeGreaterThan(1.5e18);
    expect(f).toBeLessThan(2.5e18);
  });
  it('undulator line is ~10⁴ above a bending magnet on axis (≈ N² coherent gain)', () => {
    const d = P.DEVICES.u28;
    const K = P.kAt(d, 11);
    const e1 = P.energyN(1, APSU.E, d.periodMm, K);
    const r = P.undulatorPeak(1, K, d.N, APSU.E, APSU.I) / P.bendingMagnet(e1, APSU.E, APSU.I, APSU.bmB);
    expect(r).toBeGreaterThan(5e3);
    expect(r).toBeLessThan(1e5);
  });
  it('sinc² line: FWHM = 0.886/(nN)', () => {
    const n = 3;
    const N = 84;
    const w = P.naturalWidth(n, N);
    expect(P.lineShape(10 * (1 + w / 2), 10, n, N)).toBeCloseTo(0.5, 2);
    expect(P.lineShape(10 * (1 - w / 2), 10, n, N)).toBeCloseTo(0.5, 2);
    expect(P.lineShape(10 * (1 + 1 / (n * N)), 10, n, N)).toBeCloseTo(0, 10);
  });
  it('energy-spread line: zero spread = sinc²; broadened width ≈ natural ⊕ 2.355·2σ_E, peak ≈ spreadFactor', () => {
    expect(P.spreadLine(0.003, 1, 84, 0)).toBeCloseTo(P.lineShape(1.003, 1, 1, 84), 12);
    for (const [n, N] of [
      [1, 84],
      [3, 84],
      [7, 84],
      [5, 115],
    ]) {
      const sE = APSU.sigmaE;
      const span = Math.max(2.6 / (n * N), 8 * sE);
      const M = 401;
      const v = new Float64Array(M);
      for (let i = 0; i < M; i++) v[i] = P.spreadLine(-span + (2 * span * i) / (M - 1), n, N, sE);
      const fw = P.fwhmSampled(v, span);
      expect(fw / P.lineWidth(n, N, sE)).toBeGreaterThan(0.85);
      expect(fw / P.lineWidth(n, N, sE)).toBeLessThan(1.15);
      expect(v[(M - 1) / 2] / P.spreadFactor(n, N, sE)).toBeCloseTo(1, 10);
      // the Gaussian (quadrature) estimate is within a few % of the exact convolution
      expect(P.spreadFactorGauss(n, N, sE) / P.spreadFactor(n, N, sE)).toBeGreaterThan(0.95);
      expect(P.spreadFactorGauss(n, N, sE) / P.spreadFactor(n, N, sE)).toBeLessThan(1.05);
      // the cached FWHM uses the same convolution
      expect(P.spreadFwhm(n, N, sE) / fw).toBeGreaterThan(0.97);
      expect(P.spreadFwhm(n, N, sE) / fw).toBeLessThan(1.03);
      // area is conserved by the convolution: ∫sinc² dδ = 1/(nN)
      let area = 0;
      for (let i = 0; i < M; i++) area += v[i];
      area *= (2 * span) / (M - 1);
      expect(area * n * N).toBeGreaterThan(0.85); // the sinc² tails beyond ±span hold a few %
      expect(area * n * N).toBeLessThan(1.01);
    }
  });
  it('energy spread ≫ line width: peak → area/(√(2π)·2σ_E) = 1/(nN·√(2π)·2σ_E)', () => {
    const n = 41;
    const N = 175;
    const sE = 0.00136;
    const lim = 1 / (n * N * Math.sqrt(2 * Math.PI) * 2 * sE);
    expect(P.spreadFactor(n, N, sE) / lim).toBeGreaterThan(0.97);
    expect(P.spreadFactor(n, N, sE) / lim).toBeLessThan(1.03);
    expect(P.spreadFactor(1, 84, 0)).toBeCloseTo(1, 12);
  });
  it('beam divergence: σ_r′ = √(λ/2L); factor → 1 for a filament, → σ_r′²/(σ_x′σ_y′) for a wide beam', () => {
    const d = P.DEVICES.u28; // L = 84 × 28 mm = 2.352 m
    expect(P.sigmaRp(P.HC_KEV_ANGSTROM, d)).toBeCloseTo(Math.sqrt(1e-10 / (2 * 2.352)) * 1e6, 6); // λ = 1 Å → 4.61 µrad
    const filament = { ...APSU, divX: 0, divY: 0 };
    expect(P.divergenceFactor(10, d, filament)).toBeCloseTo(1, 12);
    const wide = { ...APSU, divX: 200, divY: 100 };
    const s2 = P.sigmaRp(10, d) ** 2;
    expect(P.divergenceFactor(10, d, wide) / (s2 / (200 * 100))).toBeCloseTo(1, 2);
    // APS-U: a mild correction at E₁, stronger at high energy; the old APS (3.1 nm) loses far more
    expect(P.divergenceFactor(5, d, APSU)).toBeGreaterThan(0.85);
    expect(P.divergenceFactor(60, d, APSU)).toBeLessThan(0.65);
    expect(P.divergenceFactor(60, d, APS)).toBeLessThan(0.15);
  });
  it('phase errors: exp(−n²σ_φ²) with σ_φ = 2.5° rms', () => {
    expect(P.phaseFactor(1)).toBeCloseTo(Math.exp(-(((2.5 * Math.PI) / 180) ** 2)), 12);
    expect(P.phaseFactor(1)).toBeGreaterThan(0.99);
    expect(P.phaseFactor(11)).toBeCloseTo(0.79, 2);
    expect(P.phaseFactor(1, 0)).toBe(1);
  });
  it('old APS (7 GeV, 3.1 nm) gives several times less on-axis flux than APS-U at the same device and gap', () => {
    const d = P.DEVICES.u28;
    const K = P.kAt(d, 11);
    const r = P.peakFlux(1, K, d, APSU) / P.peakFlux(1, K, d, APS);
    expect(r).toBeGreaterThan(2);
    expect(r).toBeLessThan(4);
  });
  it('fwhmSampled recovers the sinc² FWHM 0.886/(nN)', () => {
    const span = 2.6 / 84;
    const M = 801;
    const v = new Float64Array(M);
    for (let i = 0; i < M; i++) v[i] = P.lineShape(1 - span + (2 * span * i) / (M - 1), 1, 1, 84);
    expect(P.fwhmSampled(v, span) / P.naturalWidth(1, 84)).toBeCloseTo(1, 2);
  });
  it('wiggler on axis = 2N × bending magnet at its own field', () => {
    const e = 20;
    expect(P.wiggler(e, 6, 0.2) / P.bendingMagnet(e, 6, 0.2, P.WIGGLER.B0)).toBeCloseTo(2 * P.WIGGLER.N, 10);
    expect(P.kOf(P.WIGGLER.B0, P.WIGGLER.periodMm)).toBeGreaterThan(15); // K ≫ 1
  });
});

describe('tuning to a requested energy', () => {
  const d = P.DEVICES.u28;
  it('U28 at APS-U: 8 keV on the 1st harmonic, 12.4 keV needs the 3rd', () => {
    const a = P.tuneTo(d, APSU, 8)!;
    expect(a.n).toBe(1);
    expect(P.energyN(1, APSU.E, 28, P.kAt(d, a.setting))).toBeCloseTo(8, 6);
    const b = P.tuneTo(d, APSU, 12.4)!;
    expect(b.n).toBe(3);
    expect(P.energyN(3, APSU.E, 28, P.kAt(d, b.setting))).toBeCloseTo(12.4, 6);
  });
  it('60 keV is reached on a high harmonic; requests below the lowest harmonic are refused', () => {
    const c = P.tuneTo(d, APSU, 60)!;
    expect(c.n).toBeGreaterThanOrEqual(7);
    expect(c.n).toBeLessThanOrEqual(13);
    expect(P.energyN(c.n, APSU.E, 28, P.kAt(d, c.setting))).toBeCloseTo(60, 6);
    expect(P.tuneTo(P.DEVICES.u13, APSU, 8)).toBeNull();
    expect(P.tuneTo(P.DEVICES.u13, APSU, 40)).toBeNull(); // falls between the 1st (≤ 25.4) and 3rd (≥ 70) harmonics
  });
  it('the tuner prefers the lowest harmonic within 80 % of the best flux, never an absurdly high one', () => {
    for (const id of [...P.PM_IDS, ...P.SCU_IDS]) {
      for (const E of [8, 12.4, 25, 60, 100]) {
        const opts = P.tuneOptions(P.DEVICES[id], APSU, E);
        const t = P.tuneTo(P.DEVICES[id], APSU, E);
        if (!opts.length) {
          expect(t).toBeNull();
          continue;
        }
        const best = Math.max(...opts.map((o) => o.flux));
        expect(t!.flux).toBeGreaterThanOrEqual(P.TUNE_PREFER_LOW * best);
        for (const o of opts) if (o.n < t!.n) expect(o.flux).toBeLessThan(P.TUNE_PREFER_LOW * best);
        expect(t!.n).toBeLessThanOrEqual(25);
      }
    }
  });
  it('above ~50 keV a superconducting undulator gives the most on-axis flux (APS-U plan)', () => {
    for (const E of [60, 100]) {
      const b = P.bestDevice(APSU, E)!;
      expect(P.DEVICES[b.id].kind).toBe('scu');
    }
    expect(P.DEVICES[P.bestDevice(APSU, 8)!.id].kind).toBe('pm');
  });
  it('harmonic ranges scale with n', () => {
    const [a, b] = P.harmonicRange(1, d, APSU);
    const [c, e] = P.harmonicRange(3, d, APSU);
    expect(a).toBeCloseTo(3.0, 1);
    expect(c / a).toBeCloseTo(3, 10);
    expect(e / b).toBeCloseTo(3, 10);
  });
});

describe('formatting', () => {
  it('rounds and labels', () => {
    expect(P.fmtRound(27430)).toBe('27,000');
    expect(P.ordinal(1)).toBe('1st');
    expect(P.ordinal(3)).toBe('3rd');
    expect(P.ordinal(11)).toBe('11th');
    expect(P.fmtSci(2.04e18)).toBe('2.0×10¹⁸');
  });
});
