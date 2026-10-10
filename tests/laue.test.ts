import { describe, expect, it } from 'vitest';
import * as P from '../src/ui/explainers/laue/physics';

const OPTS: P.LaueOpts = { L: P.GEOM.L, half: P.GEOM.half, Emin: P.BAND.min, Emax: P.BAND.max, spectrum: P.pinkSpectrum };
const DEG = Math.PI / 180;
const U001 = P.orientFromNormal([0, 0, 1], [1, 0, 0]);

describe('materials & structure factors', () => {
  it('form factors tend to Z at s = 0', () => {
    expect(P.formFactor(P.MATERIALS.Ni, 0)).toBeCloseTo(28, 1);
    expect(P.formFactor(P.MATERIALS.Si, 0)).toBeCloseTo(14, 1);
  });
  it('fcc extinction: h,k,l unmixed', () => {
    expect(P.structureFactorRatio('fcc', 1, 0, 0)).toBe(0);
    expect(P.structureFactorRatio('fcc', 1, 1, 0)).toBe(0);
    expect(P.structureFactorRatio('fcc', 1, 1, 1)).toBe(16);
    expect(P.structureFactorRatio('fcc', 2, 0, 0)).toBe(16);
    expect(P.structureFactorRatio('fcc', -1, 1, -3)).toBe(16);
  });
  it('diamond extinction: all odd, or all even with h+k+l = 4n', () => {
    expect(P.structureFactorRatio('diamond', 1, 1, 1)).toBe(32);
    expect(P.structureFactorRatio('diamond', 2, 0, 0)).toBe(0);
    expect(P.structureFactorRatio('diamond', 2, 2, 2)).toBe(0);
    expect(P.structureFactorRatio('diamond', 2, 2, 0)).toBe(64);
    expect(P.structureFactorRatio('diamond', 4, 0, 0)).toBe(64);
    expect(P.structureFactorRatio('diamond', -4, 2, 2)).toBe(64);
    expect(P.structureFactorRatio('diamond', 0, 0, 6)).toBe(0);
  });
});

describe('absorption', () => {
  it('μ(E) reproduces the NIST nodes: 1/μ(Ni, 20 keV) ≈ 34.9 µm, 1/μ(Si, 20 keV) ≈ 962 µm', () => {
    expect(1 / P.muLinear(P.MATERIALS.Ni, 20)).toBeCloseTo(34.86, 1);
    expect(1 / P.muLinear(P.MATERIALS.Si, 20)).toBeCloseTo(961.9, 0);
    expect(P.DAXM_DEFAULT.muS).toBeCloseTo(P.muLinear(P.MATERIALS.Ni, 20), 12);
  });
  it('Ni K edge at 8.333 keV: μ jumps by ≈ 7.8× and decreases monotonically on either side', () => {
    const m = P.MATERIALS.Ni;
    expect(P.muLinear(m, 8.334) / P.muLinear(m, 8.332)).toBeGreaterThan(7);
    for (const [a, b] of [[5, 8.3], [8.34, 30]]) {
      let prev = Infinity;
      for (let E = a; E <= b; E += 0.05) {
        const mu = P.muLinear(m, E);
        expect(mu).toBeLessThan(prev);
        prev = mu;
      }
    }
  });
  it('the tabulated μ agrees with the exact one to 1e-4 everywhere in the band, including at the edge', () => {
    for (const m of [P.MATERIALS.Ni, P.MATERIALS.Si])
      for (let E = 5; E <= 30; E += 0.0137) expect(Math.abs(P.muFast(m, E) / P.muLinear(m, E) - 1)).toBeLessThan(1e-4);
  });
  it('thick-crystal volume 1/[μ(1 + sinα_in/sinα_out)]: symmetric 45°/45° gives 1/(2μ); grazing exit → 0', () => {
    expect(P.thickVolume(0.1, Math.SQRT1_2)).toBeCloseTo(5, 12);
    expect(P.thickVolume(0.1, 1e-9)).toBe(0);
    expect(P.thickVolume(0.1, 1)).toBeLessThan(10);
  });
  it('with absorption on, each harmonic is weighted by A(E) computed from its own k_out', () => {
    const ni = P.buildDirections(P.MATERIALS.Ni, 25.4);
    const T = P.reciprocalMatrix(3.524, P.composeU(P.orientFromNormal([0, 0, 1], [1, 0, 0]), 0.2, 0.07, 0.3));
    const base: P.LaueOpts = { L: P.GEOM.L, half: P.GEOM.half, Emin: P.BAND.min, Emax: P.BAND.max, spectrum: P.pinkSpectrum };
    const a = P.computeLaue(ni, T, { ...base, absorption: true });
    const b = P.computeLaue(ni, T, base);
    const bm = new Map(b.spots.map((s) => [s.dir, s]));
    let n = 0;
    for (const s of a.spots) {
      const t = bm.get(s.dir)!;
      const sinOut = (s.ky - s.kz) * Math.SQRT1_2;
      s.harm.forEach((h, i) => {
        expect(h.w / t.harm[i].w).toBeCloseTo(P.thickVolume(P.muLinear(P.MATERIALS.Ni, h.E), sinOut), 4);
        n++;
      });
    }
    expect(n).toBeGreaterThan(10);
  });
  it('tabulate() interpolates a smooth function to < 1e-5 relative error', () => {
    const f = P.tabulate(P.pinkSpectrum, 4, 32, 0.01);
    for (let E = 6; E < 28; E += 0.173) expect(Math.abs(f(E) - P.pinkSpectrum(E))).toBeLessThan(1e-5);
  });
});

describe('orientation', () => {
  it('maps the chosen crystal normal onto the 45° sample normal and is a proper rotation', () => {
    const n = P.mulVec(U001, [0, 0, 1]);
    expect(n[0]).toBeCloseTo(0, 12);
    expect(n[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(n[2]).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(P.det3(U001)).toBeCloseTo(1, 12);
    const U = P.orientFromNormal([1, 1, 1], [1, -1, 0]);
    expect(P.det3(U)).toBeCloseTo(1, 12);
    const m = P.mulVec(U, P.unit([1, 1, 1]));
    expect(P.dot(m, P.SAMPLE_NORMAL)).toBeCloseTo(1, 12);
  });
});

describe('Laue pattern', () => {
  const si = P.buildDirections(P.MATERIALS.Si, 25.4);
  const ni = P.buildDirections(P.MATERIALS.Ni, 25.4);

  it('Si (001) at 45°: the 00l spot sits at 2θ = 90° in the detector centre with E(004) = hc/(√2 d)', () => {
    const r = P.computeLaue(si, P.reciprocalMatrix(5.43102, U001), OPTS);
    const c = r.spots.find((s) => Math.hypot(s.x, s.z) < 1e-6)!;
    expect(c).toBeDefined();
    expect([c.h, c.k, c.l]).toEqual([0, 0, 4]);
    expect(c.tth / DEG).toBeCloseTo(90, 9);
    const d004 = 5.43102 / 4;
    expect(c.harm[0].E).toBeCloseTo(P.HC / (Math.SQRT2 * d004), 9); // 6.457 keV
    // harmonics: 004, 008, 0 0 12, 0 0 16 (002, 006, 0 0 10, 0 0 14 forbidden; 0 0 20 above 30 keV)
    expect(c.harm.map((h) => h.l)).toEqual([4, 8, 12, 16]);
    expect(c.harm[0].E).toBeCloseTo(6.457, 3);
  });

  it('Ni (001): the 002 lies below 5.3 keV, so the centre spot is labelled 004 at 9.95 keV', () => {
    const r = P.computeLaue(ni, P.reciprocalMatrix(3.524, U001), OPTS);
    const c = r.spots.find((s) => Math.hypot(s.x, s.z) < 1e-6)!;
    expect([c.h, c.k, c.l]).toEqual([0, 0, 4]);
    expect(c.harm[0].E).toBeCloseTo(9.951, 3);
  });

  it("every spot obeys Bragg's law, lies on the detector and has a unit k_out", () => {
    const U = P.composeU(U001, 0.3, 0.07, 0.4);
    const r = P.computeLaue(si, P.reciprocalMatrix(5.43102, U), OPTS);
    expect(r.spots.length).toBeGreaterThan(20);
    for (const s of r.spots) {
      expect(Math.hypot(s.kx, s.ky, s.kz)).toBeCloseTo(1, 12);
      // angle between k_in (+Z) and k_out is 2θ, with sinθ = −k̂_in·Ĝ
      expect(Math.cos(s.tth)).toBeCloseTo(1 - 2 * s.sinT * s.sinT, 12);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(P.GEOM.half);
      expect(Math.abs(s.z)).toBeLessThanOrEqual(P.GEOM.half);
      expect(s.x / s.kx || 0).toBeCloseTo(s.kx ? P.GEOM.L / s.ky : 0, 6);
      for (const h of s.harm) {
        const d = P.dSpacing(5.43102, h.h, h.k, h.l);
        expect(P.HC / h.E).toBeCloseTo(2 * d * s.sinT, 10); // λ = 2 d sinθ
        expect(h.E).toBeGreaterThanOrEqual(P.BAND.min);
        expect(h.E).toBeLessThanOrEqual(P.BAND.max);
        expect(P.structureFactorRatio('diamond', h.h, h.k, h.l)).toBeGreaterThan(0);
      }
    }
  });

  it('a rotation about the beam rotates the whole pattern rigidly about the beam axis', () => {
    const a = P.computeLaue(ni, P.reciprocalMatrix(3.524, U001), OPTS);
    const ang = 3 * DEG;
    const b = P.computeLaue(ni, P.reciprocalMatrix(3.524, P.composeU(U001, ang, 0, 0)), OPTS);
    const bm = new Map(b.spots.map((s) => [s.dir, s]));
    let n = 0;
    for (const s of a.spots) {
      const t = bm.get(s.dir);
      if (!t) continue;
      n++;
      expect(t.kx).toBeCloseTo(s.kx * Math.cos(ang) - s.ky * Math.sin(ang), 10);
      expect(t.ky).toBeCloseTo(s.kx * Math.sin(ang) + s.ky * Math.cos(ang), 10);
      expect(t.kz).toBeCloseTo(s.kz, 10);
      expect(t.E).toBeCloseTo(s.E, 9); // energies are unchanged (θ unchanged)
    }
    expect(n).toBeGreaterThan(5);
  });

  it('hydrostatic strain moves no spot and scales every energy by 1/(1+ε)', () => {
    const U = P.composeU(U001, 0.1, 0.05, 0.2);
    const e = 0.006;
    const a = P.computeLaue(si, P.reciprocalMatrix(5.43102, U), OPTS);
    const b = P.computeLaue(si, P.reciprocalMatrix(5.43102, U, P.strainTensor('hydrostatic', e)), OPTS);
    const bm = new Map(b.spots.map((s) => [s.dir, s]));
    let n = 0;
    for (const s of a.spots) {
      const t = bm.get(s.dir);
      if (!t || t.harm.length !== s.harm.length) continue;
      n++;
      expect(t.x).toBeCloseTo(s.x, 9);
      expect(t.z).toBeCloseTo(s.z, 9);
      expect(t.harm[0].E / s.harm[0].E).toBeCloseTo(1 / (1 + e), 12);
    }
    expect(n).toBeGreaterThan(20);
  });

  it('volume-conserving uniaxial (deviatoric) strain moves spots and changes inter-planar angles', () => {
    const eps = P.strainTensor('deviatoric', 0.005);
    expect(P.det3(P.mat3(1 + eps[0], 0, 0, 0, 1 + eps[4], 0, 0, 0, 1 + eps[8]))).toBeCloseTo(1, 14);
    const U = P.composeU(U001, 0.1, 0.05, 0.2);
    const a = P.computeLaue(si, P.reciprocalMatrix(5.43102, U), OPTS);
    const b = P.computeLaue(si, P.reciprocalMatrix(5.43102, U, eps), OPTS);
    const bm = new Map(b.spots.map((s) => [s.dir, s]));
    let maxShift = 0;
    for (const s of a.spots) {
      const t = bm.get(s.dir);
      if (t) maxShift = Math.max(maxShift, Math.hypot(t.x - s.x, t.z - s.z));
    }
    expect(maxShift / P.GEOM.pitch).toBeGreaterThan(2); // several 200 µm pixels at ε = 0.5 %
    // an inter-planar angle changes by ~ε
    const [s1, s2] = b.spots;
    const meas = P.angleBetween([s1.gx, s1.gy, s1.gz], [s2.gx, s2.gy, s2.gz]);
    const ideal = P.angleBetween([s1.h, s1.k, s1.l], [s2.h, s2.k, s2.l]);
    expect(Math.abs(meas - ideal)).toBeGreaterThan(1e-6);
    expect(Math.abs(meas - ideal)).toBeLessThan(0.02);
  });

  it('Laue energies agree with the Ewald-sphere construction E = ħc |G|² / (2|G·k̂_in|)', () => {
    const T = P.reciprocalMatrix(3.524, P.composeU(U001, 0.2, -0.1, 0.5));
    const r = P.computeLaue(ni, T, OPTS);
    for (const s of r.spots)
      for (const h of s.harm) {
        const G = P.mulVec(T, [h.h, h.k, h.l]);
        const g2 = P.dot(G, G);
        expect(h.E).toBeCloseTo((P.HBARC * g2) / (2 * Math.abs(G[2])), 9);
      }
  });

  it('spot weight = λ²|F|²e^{−2Bs²}·P/sin²θ: S(E) per unit energy ⇔ i(λ)λ⁴/(2sin²θ) per unit wavelength', () => {
    const T = P.reciprocalMatrix(3.524, P.composeU(U001, 0.15, 0.06, 0.4));
    const r = P.computeLaue(ni, T, OPTS);
    let n = 0;
    for (const s of r.spots)
      for (const h of s.harm) {
        const lam = P.HC / h.E;
        const sTh = 1 / (2 * P.dSpacing(3.524, h.h, h.k, h.l)); // sinθ/λ
        const f = P.formFactor(P.MATERIALS.Ni, sTh);
        const F2 = 16 * f * f * Math.exp(-2 * P.MATERIALS.Ni.B * sTh * sTh);
        const pol = 1 - s.kx * s.kx;
        expect(h.w / ((lam * lam * F2 * pol) / (s.sinT * s.sinT))).toBeCloseTo(1, 9);
        // the same number written with a per-unit-wavelength spectrum i(λ) = S(E)·hc/λ²
        const iLam = (P.pinkSpectrum(h.E) * P.HC) / (lam * lam);
        expect(h.I / ((iLam * lam ** 4 * F2 * pol) / (s.sinT * s.sinT) / P.HC)).toBeCloseTo(1, 9);
        n++;
      }
    expect(n).toBeGreaterThan(10);
  });

  it('computeLaue on a subset of directions reproduces those spots exactly', () => {
    const T = P.reciprocalMatrix(5.43102, P.composeU(U001, 0.2, -0.05, 0.3));
    const all = P.computeLaue(si, T, OPTS);
    const pick = all.spots.filter((_, i) => i % 3 === 0);
    const sub = P.computeLaue(si, T, OPTS, 0, pick.map((s) => s.dir));
    expect(sub.spots.length).toBe(pick.length);
    sub.spots.forEach((s, i) => {
      expect(s.dir).toBe(pick[i].dir);
      expect(s.x).toBe(pick[i].x);
      expect(s.I).toBe(pick[i].I);
    });
  });

  it('a single energy excites (almost) nothing: few harmonics fall in a ~1e-3 window', () => {
    const r = P.computeLaue(ni, P.reciprocalMatrix(3.524, P.composeU(U001, 0.3, 0.1, 0.2)), OPTS);
    let lit = 0;
    for (const s of r.spots) for (const h of s.harm) if (P.monoResponse(h.E, 12, P.monoWindow(h.E, s.sinT)) > 0.5) lit++;
    expect(lit).toBeLessThanOrEqual(1);
  });
});

describe('DAXM wire triangulation', () => {
  const g: P.DaxmGeom = { ...P.DAXM_DEFAULT };

  it('the shadow lies between the trailing and leading edge depths', () => {
    for (const u of [180, 210, 240]) {
      const [t, l] = P.edgeDepths(u, g);
      expect(l - t).toBeGreaterThan(2 * g.R * 0.99); // ≈ 2R/sin2θ at 90°
      expect(P.wireTransmission(l + 0.05, u, g)).toBe(1);
      expect(P.wireTransmission(t - 0.05, u, g)).toBe(1);
      expect(P.wireTransmission((l + t) / 2, u, g)).toBeLessThan(1e-3);
      expect(P.wireTransmission(l - 3, u, g)).toBeLessThan(0.1);
    }
  });

  it('ds/du matches the parallel-ray formula (1 − cot2θ)/√2 for several pixels', () => {
    for (const tthDeg of [70, 90, 110]) {
      const gg = { ...g, tth: tthDeg * DEG };
      const d = (P.edgeDepths(260, gg)[1] - P.edgeDepths(240, gg)[1]) / 20;
      // exact (finite pixel distance) vs parallel rays differ by ≈ L/(L − y_wire) ≈ 1 + 6e-4
      expect(Math.abs(d / P.depthPerWireStep(gg.tth) - 1)).toBeLessThan(2e-3);
    }
    expect(P.depthPerWireStep(Math.PI / 2)).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('uForLead inverts the leading-edge triangulation', () => {
    for (const s of [0, 12.5, 33]) expect(P.edgeDepths(P.uForLead(s, g), g)[1]).toBeCloseTo(s, 6);
  });

  it('exit path at 2θ = 90° equals the depth along the beam (45° surface)', () => {
    expect(P.exitPath(20, g)).toBeCloseTo(20, 2); // ray to a pixel 511 mm away is vertical to ~4e-5 rad
  });

  it('pixel signal: unobstructed far from the sample, drops by each grain as the leading edge passes it', () => {
    const grains: P.Grain[] = [
      { s0: 7, s1: 19, amp: 1 },
      { s0: 27, s1: 40, amp: 1 },
    ];
    const grid = P.depthGrid(grains, g, 60);
    const tot = P.totalIntensity(grid);
    expect(P.wireIntensity(P.uForLead(-10, g), g, grid)).toBeCloseTo(tot, 9);
    // leading edge between the grains: grain A hidden, B still visible
    const mid = P.wireIntensity(P.uForLead(23, g), g, grid) / tot;
    let a = 0;
    for (let i = 0; i < grid.f.length; i++) if ((i + 0.5) * grid.ds < 23) a += grid.f[i] * grid.ds;
    expect(mid).toBeCloseTo(1 - a / tot, 2);
  });
});
