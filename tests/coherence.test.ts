import { describe, expect, it } from 'vitest';
import * as P from '../src/ui/explainers/coherence/physics';
import * as B from '../src/ui/explainers/brightness/physics';
import { approxGain } from '../src/ui/explainers/brightness/format';

describe('wavelength & diffraction limit', () => {
  it('λ(12.398 keV) = 1 Å and λ/4π scales as 1/E', () => {
    expect(P.wavelength(12.398419843)).toBeCloseTo(1e-10, 15);
    expect(P.diffractionLimit(10) * 1e12).toBeCloseTo(9.866, 2); // pm·rad
    expect(P.diffractionLimit(20) / P.diffractionLimit(10)).toBeCloseTo(0.5, 12);
  });
  it('single-electron mode has σ_r σ_r\' = λ/4π (Kim)', () => {
    const lam = P.wavelength(25);
    const r = P.singleElectron(lam, 2.4);
    expect(r.size * r.div).toBeCloseTo(lam / (4 * Math.PI), 20);
    expect(r.size * 1e6).toBeCloseTo(1.23, 2); // µm at 25 keV, 2.4 m
    expect(r.div * 1e6).toBeCloseTo(3.21, 2); // µrad
  });
});

describe('coherent fraction', () => {
  it('reproduces the facility dossier estimate at 10 keV (0.046 %, 2.7 % round, 6.0 % flat)', () => {
    expect(P.coherence(P.APS_2019, 10).f * 100).toBeCloseTo(0.0465, 3);
    expect(P.coherence(P.APSU_ROUND, 10).f * 100).toBeCloseTo(2.68, 1);
    expect(P.coherence(P.APSU_FLAT, 10).f * 100).toBeCloseTo(6.03, 1);
  });
  it('is between 0 and 1 and approaches 1 for a zero-emittance beam', () => {
    const zero: P.Ring = { ...P.APSU_FLAT, x: { size: 0, div: 0, emit: 0 }, y: { size: 0, div: 0, emit: 0 } };
    for (const E of [5, 20, 100]) {
      expect(P.coherence(zero, E).f).toBeCloseTo(1, 12);
      for (const r of [P.APS_2019, P.APSU_ROUND, P.APSU_FLAT]) {
        const c = P.coherence(r, E);
        expect(c.f).toBeGreaterThan(0);
        expect(c.f).toBeLessThan(1);
      }
    }
  });
  it('falls with energy for every ring, roughly as 1/E² for the emittance-dominated old ring', () => {
    for (const r of [P.APS_2019, P.APSU_ROUND, P.APSU_FLAT]) expect(P.coherence(r, 50).f).toBeLessThan(P.coherence(r, 10).f);
    const ratio = P.coherence(P.APS_2019, 20).f / P.coherence(P.APS_2019, 80).f;
    expect(ratio).toBeGreaterThan(12);
    expect(ratio).toBeLessThan(17);
  });
  it('the APS-U gain grows with photon energy and stays below the emittance-product ratio', () => {
    for (const r of [P.APSU_ROUND, P.APSU_FLAT]) {
      let prev = 0;
      for (const E of [5, 10, 20, 40, 80, 105]) {
        const g = P.coherence(r, E).f / P.coherence(P.APS_2019, E).f;
        expect(g).toBeGreaterThan(prev);
        prev = g;
      }
      const cap = (P.APS_2019.x.size * P.APS_2019.x.div * P.APS_2019.y.size * P.APS_2019.y.div) / (r.x.size * r.x.div * r.y.size * r.y.div);
      expect(prev).toBeLessThan(cap);
    }
    expect(P.coherence(P.APSU_ROUND, 10).f / P.coherence(P.APS_2019, 10).f).toBeCloseTo(57.6, 0);
  });
});

describe('transverse coherence & Young', () => {
  it('ξ = λZ/(2πΣ) and |μ| = exp(−d²/2ξ²)', () => {
    const lam = P.wavelength(25);
    const xi = P.coherenceLength(lam, 45.5, 12.36e-6);
    expect(xi * 1e6).toBeCloseTo(29.06, 1);
    expect(P.degreeOfCoherence(xi, xi)).toBeCloseTo(Math.exp(-0.5), 12);
    expect(P.degreeOfCoherence(0, xi)).toBe(1);
  });
  it('far-field ξ/Σ_Z ≈ 2f per plane', () => {
    const c = P.coherence(P.APSU_ROUND, 25);
    const Z = 500; // far field
    const xi = P.coherenceLength(c.lambda, Z, c.x.size);
    expect(xi / P.beamSizeAt(c.x.size, c.x.div, Z)).toBeCloseTo(2 * c.x.f, 3);
  });
  it('fully coherent double slit: peak 1 at u = 0, dark fringe at u = ½, envelope zero at u = 1/a', () => {
    const buf = new Float64Array(3);
    P.youngPattern(buf, 1e6, 0.5);
    expect(buf[1]).toBeCloseTo(1, 3);
    expect(buf[0]).toBeLessThan(1e-3);
    expect(buf[2]).toBeLessThan(1e-3);
    const g = new Float64Array(9);
    P.youngPattern(g, 1e6, 4); // u = −4…4 in steps of 1: g[8] is u = 4 = 1/a, the single-slit zero
    expect(g[8]).toBeLessThan(1e-3);
  });
  it('visibility ≈ |μ₁₂(d)| when the slits are narrow compared with ξ', () => {
    for (const xi of [0.6, 1, 2, 4]) {
      const V = P.centralVisibility(xi, 0.02);
      expect(V).toBeCloseTo(Math.exp(-1 / (2 * xi * xi)), 2);
    }
  });
  it('visibility vanishes for an incoherent beam and stays close to |μ| for a = d/4', () => {
    expect(P.centralVisibility(0.05)).toBeLessThan(1e-6);
    for (const xi of [0.3, 0.5, 1, 3]) expect(Math.abs(P.centralVisibility(xi) - Math.exp(-1 / (2 * xi * xi)))).toBeLessThan(0.06);
  });
});

describe('Gaussian Schell model coherence length (used by the Young view)', () => {
  it('gsmQ inverts f = q/√(q² + 4)', () => {
    for (const q of [1e-3, 0.1, 0.5, 1, 2, 5]) expect(P.gsmQ(q / Math.sqrt(q * q + 4))).toBeCloseTo(q, 9);
  });
  it('ξ(Z)/Σ(Z) = q at every distance; ξ(0) is the source coherence length qΣ', () => {
    const c = P.coherence(P.APS_2019, 25);
    const q = P.gsmQ(c.x.f);
    expect(P.coherenceLengthGSM(c.x, 0)).toBeCloseTo(q * c.x.size, 15);
    for (const Z of [5, 20, 45.5, 200]) expect(P.coherenceLengthGSM(c.x, Z) / P.beamSizeAt(c.x.size, c.x.div, Z)).toBeCloseTo(q, 12);
  });
  it('tends to the van Cittert–Zernike λZ/2πΣ in the far field, up to √(1 + q²/4)', () => {
    for (const [r, E] of [[P.APSU_ROUND, 25], [P.APSU_FLAT, 5], [P.APS_2019, 75]] as const) {
      for (const pl of ['x', 'y'] as const) {
        const c = P.coherence(r, E);
        const ph = c[pl];
        const q = P.gsmQ(ph.f);
        const Z = 1e5; // m, deep far field
        const ratio = P.coherenceLengthGSM(ph, Z) / P.coherenceLength(c.lambda, Z, ph.size);
        expect(ratio).toBeCloseTo(Math.sqrt(1 + (q * q) / 4), 6);
      }
    }
  });
  it('old APS, 25 keV, 28-ID-F (45.5 m): ξ_x ≈ 1.48 µm, 13 % above the far-field 1.31 µm; APS-U round ≈ 29 µm', () => {
    const o = P.coherence(P.APS_2019, 25);
    expect(P.coherenceLengthGSM(o.x, 45.5) * 1e6).toBeCloseTo(1.48, 1);
    expect(P.coherenceLength(o.lambda, 45.5, o.x.size) * 1e6).toBeCloseTo(1.31, 1);
    const n = P.coherence(P.APSU_ROUND, 25);
    expect(P.coherenceLengthGSM(n.x, 45.5) * 1e6).toBeCloseTo(29.2, 0);
  });
});

describe('numbers quoted in the station text', () => {
  it('25 keV: about 1 in 10,000 (APS) vs 1 in 125 (APS-U round) in step, ×78', () => {
    const o = P.coherence(P.APS_2019, 25).f;
    const n = P.coherence(P.APSU_ROUND, 25).f;
    expect(1 / o).toBeGreaterThan(9000);
    expect(1 / o).toBeLessThan(10500);
    expect(Math.round(1 / n)).toBe(125);
    expect(Math.round(n / o)).toBe(78);
  });
  it('in-step photons per second (design coherent flux = brightness ratio) gain ≈ ×300 at 25 keV, ≫ the ×78 share', () => {
    // coherence.ts quotes the IPAC'21 envelope ratio for coherent flux; the dossier's coherent-flux columns agree
    const g = B.seriesCurve(B.ENVELOPE.neu[0])(25) / B.seriesCurve(B.ENVELOPE.old)(25);
    expect(approxGain(g)).toBe('300');
    expect(Math.abs(g / (1.7e13 / 4.9e10) - 1)).toBeLessThan(0.15);
    expect(g / (P.coherence(P.APSU_ROUND, 25).f / P.coherence(P.APS_2019, 25).f)).toBeGreaterThan(3);
  });
  it('emittance-product caps ≈ ×130 (round) and ×670 (flat)', () => {
    const prod = (r: P.Ring) => r.x.size * r.x.div * r.y.size * r.y.div;
    expect(prod(P.APS_2019) / prod(P.APSU_ROUND)).toBeCloseTo(128, -1);
    expect(prod(P.APS_2019) / prod(P.APSU_FLAT)).toBeCloseTo(668, -1);
  });
  it('a matched β = L/2π gives f = (λ/4π)/(ε + λ/4π)', () => {
    const L = 2.4;
    const lam = P.wavelength(20);
    const eps = 30e-12;
    const beta = L / (2 * Math.PI);
    const ph = P.photonPlane({ size: Math.sqrt(eps * beta), div: Math.sqrt(eps / beta), emit: eps }, lam, L);
    expect(ph.f).toBeCloseTo(P.diffractionLimit(20) / (eps + P.diffractionLimit(20)), 12);
  });
  it('CHEX interim 2.07 m undulators: APS-U f 4–11 % below the 2.4 m curves over 5–105 keV', () => {
    for (const r of [P.APSU_ROUND, P.APSU_FLAT])
      for (const E of [5, 15, 25, 35, 75, 105]) {
        const drop = 1 - P.coherence(r, E, 2.07).f / P.coherence(r, E, 2.4).f;
        expect(drop).toBeGreaterThan(0.035);
        expect(drop).toBeLessThan(0.115);
      }
  });
  it('energy-spread caveat: Tanaka–Kitamura Q_a ≈ 1.7 at n = 5, N = 74, σ_δ = 0.136 %; ≈ 1.2 for APS at n = 3', () => {
    const erf = (x: number) => {
      // Abramowitz & Stegun 7.1.26
      const t = 1 / (1 + 0.3275911 * Math.abs(x));
      const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
      return x >= 0 ? y : -y;
    };
    const Qa = (x: number) => Math.sqrt((2 * x * x) / (-1 + Math.exp(-2 * x * x) + Math.sqrt(2 * Math.PI) * x * erf(Math.SQRT2 * x)));
    expect(Qa(2 * Math.PI * 5 * 74 * 0.00136)).toBeCloseTo(1.7, 1);
    expect(Qa(2 * Math.PI * 3 * 72 * 0.00095)).toBeCloseTo(1.2, 1);
  });
});
