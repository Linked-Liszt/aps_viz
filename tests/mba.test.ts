import { describe, expect, it } from 'vitest';
import * as P from '../src/ui/explainers/mba/physics';

describe('emittance scaling law ε ∝ E²/M³ (anchored at the APS)', () => {
  it('reproduces the APS anchor and the 2 → 7 bend gain', () => {
    expect(P.emittanceScaling(2, 7)).toBeCloseTo(3100, 9);
    expect(P.emittanceScaling(2, 7) / P.emittanceScaling(7, 7)).toBeCloseTo(42.875, 6); // (7/2)³
    expect(P.emittanceScaling(7, 6)).toBeCloseTo(53.1, 1); // incl. (6/7)²
  });
  it('anchored at the effective 3.1 nm the law gives 53 pm; anchored at the natural 2.5 nm it gives the real ~42 pm', () => {
    const r = P.APSU.epsNat / P.emittanceScaling(7, 6);
    expect(r).toBeGreaterThan(0.75);
    expect(r).toBeLessThan(0.82);
    const nat = P.emittanceScaling(7, 6, P.APS.epsNat);
    expect(nat).toBeCloseTo(42.8, 1);
    expect(Math.abs(nat / P.APSU.epsNat - 1)).toBeLessThan(0.04);
    // the old APS effective emittance follows from its natural one + the dispersion it leaked into the straights
    expect(P.effectiveEmittance(P.APS.epsNat, 19.5, 0.17, P.APS.sigmaDelta)).toBeCloseTo(P.APS.epsX, -2);
  });
  it('same F/J_x, different route: APS DBA F ≈ 3.3×TME (J_x = 1); APS-U F ≈ 7.3×TME, won back by J_x = 2.25', () => {
    const fA = P.qualityFactor(P.APS.epsNat, 2, 7, 1);
    const fU = P.qualityFactor(P.APSU.epsNat, 7, 6, P.APSU.Jx);
    expect(fA).toBeCloseTo(3.34, 1);
    expect(fU).toBeCloseTo(7.3, 1);
    expect(fU / P.APSU.Jx / fA).toBeGreaterThan(0.93);
    expect(fU / P.APSU.Jx / fA).toBeLessThan(1.0);
    // a real lattice can never beat its own minimum: F ≥ (M+1)/(M−1)
    expect(fA).toBeGreaterThan(3);
    expect(fU).toBeGreaterThan(8 / 6);
  });
  it('MBA bound (Wolski eq. 180): DBA at 7 GeV ≈ 2.25 nm·rad; APS-U 7BA with J_x = 2.25 ≈ 7.6 pm·rad', () => {
    expect(P.emittanceMin(2, 7) / 1000).toBeCloseTo(2.25, 1);
    // M = 2 is the DBA bound C_qγ²θ³/(4√15), M → ∞ approaches TME C_qγ²θ³/(12√15)
    expect(P.emittanceMin(2, 7) / ((P.CQ * P.gamma(7) ** 2 * P.bendAngle(2) ** 3) / (4 * Math.sqrt(15)) * 1e12)).toBeCloseTo(1, 9);
    expect(P.emittanceMin(1001, 6) / ((P.F_TME * P.CQ * P.gamma(6) ** 2 * P.bendAngle(1001) ** 3) * 1e12)).toBeCloseTo(1, 2);
    expect(P.emittanceMin(7, 6, 2.25)).toBeCloseTo(7.6, 0);
    // real machines sit above their theoretical minimum
    expect(P.APS.epsX).toBeGreaterThan(P.emittanceMin(2, 7));
    expect(P.APSU.epsNat).toBeGreaterThan(P.emittanceMin(7, 6, P.APSU.Jx));
  });
  it('diffraction limit λ/4π at 10 keV ≈ 9.87 pm', () => {
    expect(P.diffractionLimit(10)).toBeCloseTo(9.866, 2);
  });
});

describe('beam sizes at the ID source point', () => {
  it('APS-U: σ = √(εβ) reproduces the srp2024 Table 5 sizes', () => {
    const u = P.APSU;
    expect(P.beamSize(u.round.epsX, u.betaX, u.etaX, u.sigmaDelta)).toBeCloseTo(u.round.sigX, 0);
    expect(P.beamSize(u.round.epsY, u.betaY)).toBeCloseTo(u.round.sigY, 0);
    expect(P.beamSize(u.flat.epsX, u.betaX, u.etaX, u.sigmaDelta)).toBeCloseTo(u.flat.sigX, 0);
    expect(P.beamSize(u.flat.epsY, u.betaY)).toBeCloseTo(u.flat.sigY, 0);
  });
  it('APS: 2.5 nm natural, β 19.5 m, η 0.17 m reproduce 275 µm, 11 µrad and ε_eff = 3.1 nm·rad', () => {
    expect(P.beamSize(2500, 19.5, 0.17, P.APS.sigmaDelta)).toBeCloseTo(275, -1);
    expect(Math.sqrt(2.5e-9 / 19.5) * 1e6).toBeCloseTo(P.APS.divX, 0);
    expect(P.effectiveEmittance(2500, 19.5, 0.17, P.APS.sigmaDelta)).toBeCloseTo(3100, -2);
  });
  it('cross-section shrinks 27× (round) / 61× (flat)', () => {
    const a = P.APS.sigX * P.APS.sigY;
    expect(a / (P.APSU.round.sigX * P.APSU.round.sigY)).toBeCloseTo(26.9, 0);
    expect(a / (P.APSU.flat.sigX * P.APSU.flat.sigY)).toBeCloseTo(61.2, 0);
  });
});

describe('lattices', () => {
  it('APS-U bends sum to FDR Table 2.4: +9.945°, −0.942°, net 9° per sector; 7 forward + 6 reverse', () => {
    const st = P.bendStats(P.latticeFor(7));
    expect(st.forward).toBe(7);
    expect(st.reverse).toBe(6);
    expect(st.sumForwardDeg).toBeCloseTo(9.945, 3);
    expect(st.sumReverseDeg).toBeCloseTo(-0.942, 3);
    expect(st.sumForwardDeg + st.sumReverseDeg).toBeCloseTo(P.SECTOR_BEND_DEG, 2);
  });
  it('APS-U longitudinal-gradient M1 steps from 0.65 T to 0.14 T at 6 GeV', () => {
    const m1 = P.latticeFor(7).elements.filter((e) => e.magnet === 'A:M1');
    expect(m1.length).toBe(5);
    expect(P.fieldOf(m1[0], 6)).toBeCloseTo(0.65, 1);
    expect(P.fieldOf(m1[4], 6)).toBeCloseTo(0.141, 1);
  });
  it('APS dipole: 4.5° in 3.06 m is 0.599 T at 7 GeV', () => {
    const b = P.latticeFor(2).elements.find((e) => e.kind === 'bend')!;
    expect(b.angle * (180 / Math.PI)).toBeCloseTo(4.5, 9);
    expect(P.fieldOf(b, 7)).toBeCloseTo(P.APS.dipoleB, 2);
  });
  it('APS-U digitised dispersion: 0.39 mm in the straight, ≈ 0.09 m peak (FDR Table 2.3)', () => {
    const l = P.latticeFor(7);
    expect(P.etaAt(l, 1) * 1e3).toBeCloseTo(0.4, 1);
    expect(P.etaMax(l)).toBeGreaterThan(0.085);
    expect(P.etaMax(l)).toBeLessThan(0.092);
  });
  it('thin-lens models are achromats (η = η\' = 0 at the next straight) with focusing lenses', () => {
    for (const M of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const l = M === 2 ? P.latticeFor(2) : P.genericModel(M);
      const c = P.closure(l);
      expect(Math.abs(c.eta)).toBeLessThan(1e-6);
      expect(Math.abs(c.deta)).toBeLessThan(1e-5);
      for (const ln of l.lenses) expect(ln.f).toBeGreaterThan(0);
      expect(P.etaAt(l, 1)).toBe(0);
      expect(P.etaAt(l, l.C - 1)).toBeCloseTo(0, 6);
    }
  });
  it('model dispersion shrinks ~1/M² as the bends multiply', () => {
    const e3 = P.etaMax(P.genericModel(3));
    const e9 = P.etaMax(P.genericModel(9));
    expect(e3 / e9).toBeGreaterThan(6);
    expect(e3 / e9).toBeLessThan(12);
    // and the old APS model sits at a few tenths of a metre
    expect(P.etaMax(P.latticeFor(2))).toBeGreaterThan(0.2);
    expect(P.etaMax(P.latticeFor(2))).toBeLessThan(0.35);
  });
});

describe('coupling, damping partition and the numbers quoted in the captions', () => {
  it('ε_x = ε_0 J_x/(J_x + κJ_y) reproduces srp2024 Table 5 (round and flat)', () => {
    const r = P.coupledEmittances(41.52, 1);
    expect(r.x).toBeCloseTo(28.7, 1);
    expect(r.y).toBeCloseTo(28.7, 1);
    const f = P.coupledEmittances(41.52, 0.1);
    // within 0.2 % (Table 5 rounds; J_x = 2.25 is itself rounded from the damping times)
    expect(Math.abs(f.x / 39.7 - 1)).toBeLessThan(0.002);
    expect(Math.abs(f.y / 3.98 - 1)).toBeLessThan(0.002);
  });
  it('Robinson: APS-U damping times 6.72/15.05/19.78 ms give J_x ≈ 2.25, J_E ≈ 0.75', () => {
    const j = P.partitionFromDampingTimes(6.72, 15.05, 19.78);
    expect(j.Jx + j.Jy + j.JE).toBeCloseTo(4, 9);
    expect(j.Jx).toBeCloseTo(2.25, 1);
    expect(j.Jy).toBeCloseTo(1.0, 1);
    expect(j.JE).toBeCloseTo(0.76, 1);
  });
  it('gains quoted in the text: 58× (scaling law) and 74× (real APS-U)', () => {
    expect(P.APS.epsX / P.emittanceScaling(7, 6)).toBeCloseTo(58.4, 0);
    expect(Math.round(P.APS.epsX / P.APSU.epsNat)).toBe(74);
    // the APS-U preset's big readout shows the design value (42), the law's estimate (53) goes below it
    expect(P.fmtEps(P.APSU.epsNat)).toBe('42 pm·rad');
    expect(P.fmtEps(P.emittanceScaling(7, 6))).toBe('53 pm·rad');
    // and θ³: halving the bend angle (M → 2M) shrinks ε 8×
    expect(P.emittanceScaling(3, 6) / P.emittanceScaling(6, 6)).toBeCloseTo(8, 9);
  });
  it('APS-U beam is narrower than a hair and the area shrinks 27× (round)', () => {
    expect(2.355 * P.APSU.round.sigX).toBeLessThan(P.HAIR_UM);
    expect(Math.round((P.APS.sigX * P.APS.sigY) / (P.APSU.round.sigX * P.APSU.round.sigY))).toBe(27);
    expect(Math.round((P.APS.sigX * P.APS.sigY) / (P.APSU.flat.sigX * P.APSU.flat.sigY))).toBe(61);
  });
  it('M1 high-field end is 0.65 T and sits where η ≈ 0.4 mm', () => {
    const l = P.latticeFor(7);
    const m1 = l.elements.filter((e) => e.magnet === 'A:M1');
    expect(P.fieldOf(m1[0], 6)).toBeCloseTo(0.65, 1);
    expect(P.etaAt(l, m1[0].s0) * 1e3).toBeLessThan(1);
  });
});
