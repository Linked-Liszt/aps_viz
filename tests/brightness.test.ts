import { describe, expect, it } from 'vitest';
import * as P from '../src/ui/explainers/brightness/physics';
import { approxGain, fmtGain, fmtOneIn, sci } from '../src/ui/explainers/brightness/format';
import { gauss, rng } from '../src/lib/fft';

describe('photon source (Kim Gaussian model)', () => {
  it('λ(12.398 keV) = 1 Å and λ/4π = 9.87 pm at 10 keV', () => {
    expect(P.wavelength(12.398419843)).toBeCloseTo(1e-10, 15);
    expect(P.diffractionLimitUmUrad(10)).toBeCloseTo(9.866, 2);
  });
  it('single-electron mode is diffraction limited: σ_r σ_r′ = λ/4π; values at 25 keV, L = 2.4 m', () => {
    for (const E of [1, 10, 25, 100]) {
      const r = P.singleElectron(E);
      expect(r.size * r.div).toBeCloseTo(P.diffractionLimitUmUrad(E), 10);
    }
    const r = P.singleElectron(25);
    expect(r.size).toBeCloseTo(1.23, 2);
    expect(r.div).toBeCloseTo(3.21, 2);
  });
  it('photon source adds in quadrature and never drops below the electron beam or σ_r', () => {
    const p = P.photonBeam(P.APSU_ROUND.e, 20);
    const r = P.singleElectron(20);
    expect(p.sx).toBeCloseTo(Math.hypot(12.3, r.size), 10);
    expect(p.syp).toBeCloseTo(Math.hypot(3.47, r.div), 10);
    expect(p.sx).toBeGreaterThan(Math.max(12.3, r.size));
  });
});

describe('brightness', () => {
  it('B = F/(4π²ΣxΣ′xΣyΣ′y) in ph/s/mm²/mrad²/0.1%BW (µm, µrad → mm, mrad)', () => {
    const p: P.Beam = { sx: 100, sxp: 10, sy: 10, syp: 5 };
    const expected = 1e15 / (4 * Math.PI ** 2 * (0.1 * 0.01 * 0.01 * 0.005));
    expect(P.brightness(1e15, p) / expected).toBeCloseTo(1, 12);
  });
  it('equals flux ÷ source area ÷ solid angle', () => {
    const p = P.photonBeam(P.APS_2019.e, 20);
    expect(P.brightness(2e14, p)).toBeCloseTo(2e14 / P.sourceAreaMm2(p) / P.solidAngleMrad2(p), -10);
  });
  it('with the APS-2019 flux implied by FDR Table 1.1 it reproduces the tabulated 6×10¹⁹ order of magnitude', () => {
    // F ≈ 3.8e14 ph/s/0.1%BW at 20 keV (4.8 m of undulator); B within a factor 2 of FDR Table 1.1 (6e19)
    const B = P.brightness(3.8e14, P.photonBeam(P.APS_2019.e, 20));
    expect(B).toBeGreaterThan(3e19);
    expect(B).toBeLessThan(1.2e20);
  });
  it('diffraction-limited ceiling 4F/λ² is reached by a zero-emittance beam and bounds every real beam', () => {
    const zero: P.Beam = { sx: 0, sxp: 0, sy: 0, syp: 0 };
    for (const E of [1, 10, 100]) {
      const lim = P.brightnessLimit(1e15, E);
      const lamMmMrad = P.wavelength(E) * 1e6; // λ in mm·mrad
      expect(lim / ((4 * 1e15) / lamMmMrad ** 2)).toBeCloseTo(1, 10);
      expect(P.brightness(1e15, P.photonBeam(zero, E)) / lim).toBeCloseTo(1, 10);
      for (const r of [P.APS_2019, P.APSU_ROUND, P.APSU_FLAT]) expect(P.brightness(1e15, P.photonBeam(r.e, E))).toBeLessThan(lim);
    }
  });
  it('source-term gain APS-U/APS at equal flux rises with energy (the "why bigger at high E" claim)', () => {
    const g1 = P.sourceGain(P.APSU_ROUND.e, P.APS_2019.e, 1);
    const g10 = P.sourceGain(P.APSU_ROUND.e, P.APS_2019.e, 10);
    const g100 = P.sourceGain(P.APSU_ROUND.e, P.APS_2019.e, 100);
    expect(g1).toBeCloseTo(27.3, 0);
    expect(g10).toBeCloseTo(57.3, 0);
    expect(g100).toBeCloseTo(106, 0);
    expect(P.sourceGain(P.APSU_FLAT.e, P.APS_2019.e, 100)).toBeCloseTo(392, -1);
    // at 20 keV: ×72 round, ×189 flat; ×2 current and better undulators make up the rest of the ×540 (FDR T1.1)
    expect(P.sourceGain(P.APSU_ROUND.e, P.APS_2019.e, 20)).toBeCloseTo(72, 0);
    expect(P.sourceGain(P.APSU_FLAT.e, P.APS_2019.e, 20)).toBeGreaterThan(150);
    expect(P.sourceGain(P.APS_2019.e, P.APS_2019.e, 20)).toBeCloseTo(1, 12);
  });
});

describe('lens + slit acceptance (Gaussian apertures, wave-exact)', () => {
  /** independent check: fully coherent Gaussian beam through aperture + thin lens + aperture via the complex q parameter */
  function coherentPass(E: number, sigma0Um: number, sl: P.Slits): number {
    const lam = P.wavelength(E);
    const w0 = 2 * sigma0Um * 1e-6; // 1/e² intensity radius = 2 × rms
    const zR = (Math.PI * w0 * w0) / lam;
    const inv = (re: number, im: number): [number, number] => {
      const d = re * re + im * im;
      return [re / d, -im / d];
    };
    const w2 = (iq: [number, number]) => -lam / (Math.PI * iq[1]);
    // q(z1) = z1 + i zR
    let iq = inv(sl.z1, zR);
    const wa1 = 2 * sl.s1 * 1e-6;
    const before1 = w2(iq);
    iq = [iq[0] - (Number.isFinite(sl.f) ? 1 / sl.f : 0), iq[1] - lam / (Math.PI * wa1 * wa1)]; // lens (ABCD) + aperture
    const p1 = Math.sqrt(w2(iq) / before1);
    const q = inv(iq[0], iq[1]);
    iq = inv(q[0] + (sl.z2 - sl.z1), q[1]);
    const wa2 = 2 * sl.s2 * 1e-6;
    const before2 = w2(iq);
    iq = [iq[0], iq[1] - lam / (Math.PI * wa2 * wa2)];
    return p1 * Math.sqrt(w2(iq) / before2);
  }
  const BARE: P.Slits = { s1: 8, s2: 8, z1: 15, z2: 30, f: Infinity };
  it('geometry: 1:1 imaging (f = 7.5 m), kick λ/4πs, acceptance 2πs₁s₂/Δz, hard-slit equivalents', () => {
    expect(P.imagingFocal(15, 30)).toBeCloseTo(P.SLITS.f, 12);
    expect(P.diffractionKick(20, 30)).toBeCloseTo(4.93 / 30, 3);
    expect(P.acceptance(P.SLITS)).toBeCloseTo((2 * Math.PI * 120) / 15, 10);
    expect(P.hardWidth(30)).toBeCloseTo(75.2, 1);
    expect(P.hardWidth(4)).toBeCloseTo(10.0, 1);
  });
  it('agrees with Gaussian-beam (q-parameter) wave optics for a fully coherent beam, ΣΣ′ = λ/4π, with and without the lens', () => {
    for (const sl of [P.SLITS, BARE])
      for (const E of [1, 2, 8, 20, 60]) {
        for (const s0 of [0.5, 2, 10]) {
          const sp = P.diffractionLimitUmUrad(E) / s0;
          const exact = coherentPass(E, s0, sl);
          expect(P.passFraction(s0, sp, E, sl) / exact).toBeCloseTo(1, 8);
        }
      }
    // and for a coherent beam the ray-only answer is wrong at low energy
    const r = P.singleElectron(2);
    expect(P.passFraction(r.size, r.div, 2, P.SLITS, false) / coherentPass(2, r.size, P.SLITS)).toBeGreaterThan(1.5);
  });
  it('matches a Monte Carlo of photons (soft apertures + diffraction kicks + lens), as animated', () => {
    const r = rng(7);
    const { s1, s2, z1, z2, f } = P.SLITS;
    for (const [S, Sp, E] of [
      [12.4, 4.3, 20],
      [3, 8, 4],
      [60, 8, 50],
      [275, 11.6, 20],
    ]) {
      let n = 0;
      const N = 400000;
      const k1 = P.diffractionKick(E, s1);
      for (let i = 0; i < N; i++) {
        const x0 = S * gauss(r);
        let th = Sp * gauss(r);
        const x1 = x0 + th * z1;
        if (r() >= P.slitTransmission(x1, s1)) continue;
        th += k1 * gauss(r) - x1 / f;
        if (r() < P.slitTransmission(x1 + th * (z2 - z1), s2)) n++;
      }
      const p = P.passFraction(S, Sp, E);
      const sigma = Math.sqrt((p * (1 - p)) / N);
      expect(Math.abs(n / N - p)).toBeLessThan(4 * sigma + 1e-4);
    }
  });
  it('is bounded by A/(2πΣΣ′) and reaches it when the beam overfills the acceptance (any energy, with or without lens)', () => {
    for (const sl of [P.SLITS, BARE])
      for (const E of [2, 20, 100]) {
        expect(P.passFraction(4000, 400, E, sl) / P.passFractionSmall(4000, 400, sl)).toBeCloseTo(1, 2);
        for (const [S, Sp] of [
          [12.4, 4.3],
          [1.4, 3.6],
          [275, 11.6],
          [3, 0.5],
        ])
          expect(P.passFraction(S, Sp, E, sl)).toBeLessThanOrEqual(P.passFractionSmall(S, Sp, sl) * (1 + 1e-12));
      }
    expect(P.passFraction(0, 0, 20, P.SLITS, false)).toBe(1);
  });
  it('the count tracks brightness: lens + slit see the APS → APS-U gain, two bare slits far away do not', () => {
    const at = (b: P.Beam, E: number, sl = P.SLITS, diff = true) => {
      const p = P.photonBeam(b, E);
      return P.passFraction(p.sx, p.sxp, E, sl, diff);
    };
    const aps = P.photonBeam(P.APS_2019.e, 20);
    const neu = P.photonBeam(P.APSU_ROUND.e, 20);
    const bx = (aps.sx * aps.sxp) / (neu.sx * neu.sxp); // horizontal brightness gain ≈ 60
    const withLens = at(P.APSU_ROUND.e, 20) / at(P.APS_2019.e, 20);
    expect(withLens).toBeGreaterThan(0.8 * bx);
    expect(withLens).toBeLessThan(bx);
    expect(at(P.APSU_ROUND.e, 20, BARE) / at(P.APS_2019.e, 20, BARE)).toBeLessThan(0.6 * bx);
    // squeezing the width below the APS-U value still pays (×2 from 12.3 → 3 µm) with the lens, hardly without
    const w3 = { ...P.APSU_ROUND.e, sx: 3 };
    expect(at(w3, 20) / at(P.APSU_ROUND.e, 20)).toBeGreaterThan(2);
    expect(at(w3, 20, BARE) / at(P.APSU_ROUND.e, 20, BARE)).toBeLessThan(1.25);
    expect(1 / at(P.APS_2019.e, 20)).toBeCloseTo(404, -1);
    expect(1 / at(P.APSU_ROUND.e, 20)).toBeCloseTo(7.8, 0);
  });
  it('diffraction (a blurred focus) matters at low energy only', () => {
    const at = (b: P.Beam, E: number, diff = true) => {
      const p = P.photonBeam(b, E);
      return P.passFraction(p.sx, p.sxp, E, P.SLITS, diff);
    };
    expect(at(P.APSU_ROUND.e, 1) / at(P.APSU_ROUND.e, 1, false)).toBeLessThan(0.35);
    expect(at(P.APSU_ROUND.e, 50) / at(P.APSU_ROUND.e, 50, false)).toBeGreaterThan(0.97);
    expect(at(P.APS_2019.e, 4) / at(P.APS_2019.e, 4, false)).toBeGreaterThan(0.95);
  });
});

describe('design data', () => {
  it('interpolant passes through the digitized points and is monotone between them (no overshoot)', () => {
    for (const ds of [P.ENVELOPE, P.DEVICES])
      for (const s of [ds.old, ...ds.neu]) {
        const f = P.seriesCurve(s);
        s.E.forEach((E, i) => {
          const b = s.B[i];
          if (b !== null) expect(f(E) / b).toBeCloseTo(1, 8);
        });
        for (let i = 0; i < s.E.length - 1; i++) {
          const a = s.B[i];
          const b = s.B[i + 1];
          if (a === null || b === null) continue;
          for (let t = 0.1; t < 1; t += 0.2) {
            const E = s.E[i] * Math.pow(s.E[i + 1] / s.E[i], t);
            const v = f(E);
            expect(v).toBeGreaterThanOrEqual(Math.min(a, b) * (1 - 1e-9));
            expect(v).toBeLessThanOrEqual(Math.max(a, b) * (1 + 1e-9));
          }
        }
      }
  });
  it('envelope gain is ~690 at 20 keV and spans ~20× (1 keV) to ~800× (50 keV); FDR anchor ×540', () => {
    const fo = P.seriesCurve(P.ENVELOPE.old);
    const fn = P.seriesCurve(P.ENVELOPE.neu[0]);
    expect(fn(20) / fo(20)).toBeCloseTo(4.4e22 / 6.4e19, 3);
    expect(fn(1) / fo(1)).toBeCloseTo(20, 0);
    expect(fn(50) / fo(50)).toBeGreaterThan(700);
    expect(P.FDR_20KEV.apsuBrightness / P.FDR_20KEV.aps).toBeCloseTo(542, 0);
    expect(Number.isNaN(fo(110))).toBe(true);
  });
  it('device set: APS series ends at 85 keV; best APS-U device picks the SCU at high energy', () => {
    const fo = P.seriesCurve(P.DEVICES.old);
    const fns = P.DEVICES.neu.map((s) => P.seriesCurve(s));
    expect(Number.isNaN(fo(90))).toBe(true);
    expect(P.bestNew(P.DEVICES, fns, 80)).toBeCloseTo(1.18e21, -18);
    expect(P.bestNew(P.DEVICES, fns, 8)).toBeCloseTo(1.41e22, -19);
  });
});

describe('formatting', () => {
  it('sci, gains and "1 in N"', () => {
    expect(sci(1.14e22)).toBe('1.1 × 10²²');
    expect(sci(1e15, 1)).toBe('10¹⁵');
    expect(sci(9.96e19)).toBe('10²⁰');
    expect(fmtGain(72.2)).toBe('×72');
    expect(fmtGain(1.04)).toBe('×1.0');
    expect(fmtGain(1883.4)).toBe('×1,883');
    expect(fmtOneIn(1 / 751)).toBe('1 in 750');
    expect(fmtOneIn(0.0529)).toBe('1 in 19');
  });
  it('design gains in the text and readouts are rounded to one significant figure (design data: ~±30 % on a ratio)', () => {
    expect(approxGain(687.5)).toBe('700');
    expect(approxGain(545)).toBe('500');
    expect(approxGain(310)).toBe('300');
    expect(approxGain(1234)).toBe('1,000');
    expect(approxGain(75)).toBe('80');
    expect(approxGain(3.4)).toBe('3');
    expect(approxGain(1.2)).toBe('1');
    expect(approxGain(NaN)).toBe('—');
  });
  it('default view (envelope, 20 keV) is consistent with the FDR headline within the ±30 % digitizing error', () => {
    const g = P.seriesCurve(P.ENVELOPE.neu[0])(20) / P.seriesCurve(P.ENVELOPE.old)(20);
    const fdr = P.FDR_20KEV.apsuBrightness / P.FDR_20KEV.aps;
    expect(approxGain(g)).toBe('700');
    expect(Math.abs(g / fdr - 1)).toBeLessThan(0.3);
  });
});
