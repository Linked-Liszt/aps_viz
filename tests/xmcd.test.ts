import { describe, expect, it } from 'vitest';
import {
  ARCSEC,
  EDGES,
  FEPT,
  Grains,
  POLAR,
  PT_EDGES,
  brillouin,
  brillouinDeriv,
  carbonF,
  coercivity,
  computeSpectra,
  diamondGeom2,
  inField,
  majorLoop,
  makeSpectra,
  meanFieldM,
  netMagnetization,
  normCdf,
  normInv,
  offsetFor,
  phasePlate,
  polarization,
  pseudoVoigt,
  readBack,
  retardance,
  spontaneous,
  sumRules,
  tcAt,
  whiteLineR,
  xmcdAreas,
} from '../src/ui/explainers/xmcd/physics';

describe('diamond phase retarder', () => {
  it('has the diamond structure-factor selection rules', () => {
    expect(diamondGeom2(1, 1, 1)).toBeCloseTo(32, 6);
    expect(diamondGeom2(2, 2, 0)).toBeCloseTo(64, 6);
    expect(diamondGeom2(2, 0, 0)).toBeCloseTo(0, 6); // forbidden
    expect(diamondGeom2(2, 2, 2)).toBeCloseTo(0, 6); // forbidden (basis)
  });

  it('carbon form factor: f(0) = Z and f ≈ 3 at the (111) reflection', () => {
    expect(carbonF(0)).toBeCloseTo(6, 2);
    const s111 = Math.sqrt(3) / (2 * 3.56712);
    expect(carbonF(s111)).toBeGreaterThan(2.8);
    expect(carbonF(s111)).toBeLessThan(3.2);
  });

  it('C(111), 0.5 mm at 10 keV: θB ≈ 17.5°, quarter-wave offset ≈ 40″ (POLAR dossier: ≈ 42″)', () => {
    const p = phasePlate(10, 0.5e-3);
    expect((p.thetaB * 180) / Math.PI).toBeCloseTo(17.5, 1);
    const q = p.dThetaQ / ARCSEC;
    expect(q).toBeGreaterThan(37);
    expect(q).toBeLessThan(45);
  });

  it('quarter-wave offset scales ∝ t and roughly ∝ λ³', () => {
    const a = phasePlate(10, 0.5e-3).dThetaQ;
    expect(phasePlate(10, 1e-3).dThetaQ / a).toBeCloseTo(2, 6);
    const p5 = phasePlate(5, 0.5e-3);
    const p10 = phasePlate(10, 0.5e-3);
    // same reflection → same F; ratio = (λ₅/λ₁₀)³ · cosθ₅/cosθ₁₀
    expect(p5.dThetaQ / a).toBeCloseTo((8 * Math.cos(p5.thetaB)) / Math.cos(p10.thetaB), 6);
  });

  it('retardance δ = (π/2)Δθq/Δθ and its inverse', () => {
    expect(retardance(1, 1)).toBeCloseTo(Math.PI / 2, 12);
    expect(retardance(2, 1)).toBeCloseTo(Math.PI / 4, 12);
    expect(offsetFor(retardance(-3.3, 1.7), 1.7)).toBeCloseTo(-3.3, 10);
  });

  it('Stokes parameters of the Jones vector after the plate', () => {
    for (const d of [0, 0.3, Math.PI / 4, Math.PI / 2, 2, Math.PI, -Math.PI / 2]) {
      const p = polarization(d);
      const [ar, ai] = p.ex;
      const [br, bi] = p.ey;
      const s0 = ar * ar + ai * ai + br * br + bi * bi;
      const s1 = ar * ar + ai * ai - (br * br + bi * bi);
      // E = Re[J e^{i(kz − ωt)}] (as drawn by the beam view): S3 = 2 Im(Ex* Ey) > 0 ⇔ E turns counter-clockwise
      // seen facing the source ⇔ positive helicity
      const s3 = 2 * (ar * bi - ai * br);
      expect(s0).toBeCloseTo(1, 12);
      expect(s1).toBeCloseTo(p.plin, 12);
      expect(s3).toBeCloseTo(p.pc, 12);
      expect(p.plin * p.plin + p.pc * p.pc).toBeCloseTo(1, 12); // fully polarized
    }
  });

  it('δ = ∓π/2 gives opposite circular helicities; δ = π gives linear vertical', () => {
    expect(polarization(-Math.PI / 2).pc).toBeCloseTo(1, 12);
    expect(polarization(Math.PI / 2).pc).toBeCloseTo(-1, 12);
    expect(polarization(Math.PI).plin).toBeCloseTo(-1, 12);
    expect(polarization(0).plin).toBeCloseTo(1, 12);
    expect(polarization(-Math.PI / 2, POLAR.pc).pc).toBeCloseTo(0.98, 12);
  });

  it('at Pt L₃ (11.564 keV) the 0.5 mm C(111) quarter-wave offset is ≈ 28″ ≈ 0.008° (number quoted in the UI)', () => {
    const p = phasePlate(PT_EDGES.L3, 0.5e-3);
    expect((p.thetaB * 180) / Math.PI).toBeCloseTo(15.1, 1);
    expect(p.dThetaQ / ARCSEC).toBeGreaterThan(26.5);
    expect(p.dThetaQ / ARCSEC).toBeLessThan(29);
    expect(((p.dThetaQ * 180) / Math.PI).toFixed(3)).toBe('0.008');
    // re-tuned for L₂: smaller offset at the higher energy
    expect(phasePlate(PT_EDGES.L2, 0.5e-3).dThetaQ).toBeLessThan(p.dThetaQ);
  });

  it('sign convention used in the UI: the low-angle side (Δθ = −Δθ_q) gives positive helicity (LCP)', () => {
    const q = phasePlate(PT_EDGES.L3, 0.5e-3).dThetaQ;
    expect(polarization(retardance(-q, q)).pc).toBeCloseTo(1, 12);
    expect(polarization(retardance(+q, q)).pc).toBeCloseTo(-1, 12);
    // twice as far off Bragg: δ = ∓π/4, the 'elliptical' preset (P_c = P_lin = 0.69 at 98 %)
    const e = polarization(retardance(-2 * q, q), POLAR.pc);
    expect(e.pc).toBeCloseTo(0.693, 3);
    expect(e.plin).toBeCloseTo(0.693, 3);
  });

  it('Pt L₂,₃ lie inside the phase-plate range of POLAR', () => {
    expect(PT_EDGES.L3).toBeGreaterThan(POLAR.eMin);
    expect(PT_EDGES.L2).toBeLessThan(POLAR.phasePlateMax);
  });
});

describe('mean-field magnetization', () => {
  it('Brillouin function limits', () => {
    expect(brillouin(1.5, 1e-6)).toBeCloseTo(((1.5 + 1) / (3 * 1.5)) * 1e-6, 12);
    expect(brillouin(1.5, 50)).toBeCloseTo(1, 6);
    expect(brillouin(0.5, 0.7)).toBeCloseTo(Math.tanh(0.7), 10); // J = ½ → tanh
    // small-x series and the closed form agree across the switch-over, and the derivative is consistent
    for (const J of [0.5, 1.5, 3.5]) {
      for (const x of [0.019, 0.021, 0.3, 2]) {
        const dx = 1e-5;
        expect(brillouinDeriv(J, x)).toBeCloseTo((brillouin(J, x + dx) - brillouin(J, x - dx)) / (2 * dx), 6);
      }
      expect(brillouin(J, 0.0199999)).toBeCloseTo(brillouin(J, 0.0200001), 6);
    }
  });

  it('spontaneous m(t): 1 at t = 0, 0 at and above T_C, monotonic, critical exponent ½', () => {
    expect(meanFieldM(0, 1.5)).toBe(1);
    expect(meanFieldM(1, 1.5)).toBe(0);
    expect(meanFieldM(1.2, 1.5)).toBe(0);
    let prev = 1;
    for (let t = 0.05; t < 1; t += 0.05) {
      const m = meanFieldM(t, 1.5);
      expect(m).toBeLessThanOrEqual(prev + 1e-12);
      // self-consistency
      expect(brillouin(1.5, ((3 * 1.5) / 2.5) * (m / t))).toBeCloseTo(m, 8);
      prev = m;
    }
    // near T_C: m ∝ (1 − t)^{1/2}
    const r = meanFieldM(0.99, 1.5) / meanFieldM(0.96, 1.5);
    expect(r).toBeCloseTo(0.5, 1);
  });

  it('Newton solver agrees with a long bisection everywhere, including next to T_C', () => {
    const J = 1.5;
    const k = (3 * J) / (J + 1);
    const bisect = (t: number, h: number): number => {
      if (h <= 0 && t >= 1) return 0;
      const f = (m: number) => brillouin(J, (k * m) / t + h) - m;
      let lo = h <= 0 ? 1e-12 : 0;
      let hi = 1;
      if (h <= 0 && f(lo) <= 0) return 0;
      for (let i = 0; i < 200; i++) {
        const mid = 0.5 * (lo + hi);
        if (f(mid) > 0) lo = mid;
        else hi = mid;
      }
      return 0.5 * (lo + hi);
    };
    let worst = 0;
    for (const h of [0, 1e-4, 0.01, 0.06, 1, 9])
      for (let t = 0.002; t < 3; t += 0.0137) worst = Math.max(worst, Math.abs(meanFieldM(t, J, h) - bisect(t, h)));
    for (const t of [0.999, 0.9999, 0.99999, 0.999999]) worst = Math.max(worst, Math.abs(meanFieldM(t, J) - bisect(t, 0)));
    expect(worst).toBeLessThan(1e-9);
  });

  it('field induces a moment above T_C and adds to it below', () => {
    expect(inField(900, 0, 9)).toBeGreaterThan(0.01);
    expect(inField(900, 0, 9)).toBeLessThan(0.3);
    expect(inField(300, 0, 9)).toBeGreaterThan(spontaneous(300, 0));
  });

  it('FePt: T_C = 750 K at ambient pressure, illustrative pressure suppression', () => {
    expect(tcAt(0)).toBe(FEPT.tc0);
    expect(spontaneous(760, 0)).toBe(0);
    expect(spontaneous(300, 0)).toBeGreaterThan(0.9);
    expect(spontaneous(300, 100)).toBeLessThan(spontaneous(300, 0));
    expect(spontaneous(2, FEPT.pStar)).toBe(0);
    expect(coercivity(800, 0)).toBe(0);
    expect(coercivity(300, 0)).toBeGreaterThan(2.5);
    expect(coercivity(300, 0)).toBeLessThan(POLAR.bMax); // POLAR's magnet can saturate it
  });
});

describe('hysteresis', () => {
  it('normal quantile / CDF are inverse', () => {
    for (const p of [0.01, 0.2, 0.5, 0.77, 0.995]) expect(normCdf(normInv(p))).toBeCloseTo(p, 6);
  });

  it('grain ensemble: saturates, remembers at H = 0, flips past −H_c', () => {
    const g = new Grains(100);
    const hc = coercivity(300, 0);
    const m0 = spontaneous(300, 0);
    g.update(9, hc, m0);
    expect(g.mean()).toBe(1);
    g.update(0, hc, m0);
    expect(g.mean()).toBe(1); // remanence
    g.update(-hc * 0.3, hc, m0);
    expect(g.mean()).toBe(1); // below the weakest grain (k_min = 1 − 2.58σ ≈ 0.36)
    g.update(-hc, hc, m0);
    expect(Math.abs(g.mean())).toBeLessThan(0.2); // half the grains switched at H_c
    g.update(-9, hc, m0);
    expect(g.mean()).toBe(-1);
  });

  it('cooling through T_C in zero field gives a demagnetized state', () => {
    const g = new Grains(400, 3);
    g.update(0, 0, 0); // hot
    g.update(0, coercivity(300, 0), spontaneous(300, 0));
    expect(Math.abs(g.mean())).toBeLessThan(0.2);
  });

  it('major loop is odd-symmetric and matches the remanence', () => {
    const hc = 3;
    for (const H of [-5, -1, 0, 2, 4]) {
      expect(majorLoop(H, hc, 0.9, 0.9, true)).toBeCloseTo(-majorLoop(-H, hc, 0.9, 0.9, false), 10);
    }
    expect(majorLoop(0, hc, 0.9, 0.9, false)).toBeGreaterThan(0.89);
    expect(netMagnetization(1, 0, 300, 0)).toBeCloseTo(spontaneous(300, 0), 12);
  });
});

describe('XMCD spectra and sum rules', () => {
  const base = { mSpinEff: FEPT.mSpin, mOrb: FEPT.mOrb, nh: FEPT.nh };

  it('pseudo-Voigt is area-normalized', () => {
    let a = 0;
    for (let x = -400; x <= 400; x += 0.05) a += pseudoVoigt(x, 6, 0.6) * 0.05;
    expect(a).toBeGreaterThan(0.99);
    expect(a).toBeLessThan(1.001);
  });

  it('sum rules invert xmcdAreas exactly', () => {
    const r = whiteLineR();
    for (const [ms, mo] of [
      [0.35, 0.05],
      [0.5, 0],
      [0.2, 0.1],
    ]) {
      const { a3, a2 } = xmcdAreas(ms, mo, 1.7, r);
      const back = sumRules(a3, a3 + a2, r, 1.7);
      expect(back.mSpinEff).toBeCloseTo(ms, 12);
      expect(back.mOrb).toBeCloseTo(mo, 12);
    }
    // no orbital moment → L₃ and L₂ XMCD areas equal and opposite
    const z = xmcdAreas(0.4, 0, 1.7, r);
    expect(z.a3 + z.a2).toBeCloseTo(0, 12);
    // Chen convention: L₃ (μ⁺ − μ⁻) negative for a positive moment
    expect(xmcdAreas(0.35, 0.05, 1.7, r).a3).toBeLessThan(0);
  });

  it('Δμ flips sign with M, vanishes with M, and scales with P_c', () => {
    const sp = makeSpectra();
    const peak = () => sp.L3.diff.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
    computeSpectra(sp, { ...base, mProj: 1, pcBeam: 0.98, pcMag: 0.98 });
    const up = peak();
    expect(up).toBeGreaterThan(0.04); // a few % of the edge jump, as in Pt L₃ XMCD of FePt
    expect(up).toBeLessThan(0.12);
    computeSpectra(sp, { ...base, mProj: -1, pcBeam: 0.98, pcMag: 0.98 });
    expect(peak()).toBeCloseTo(-up, 12);
    computeSpectra(sp, { ...base, mProj: 0, pcBeam: 0.98, pcMag: 0.98 });
    expect(Math.abs(peak())).toBe(0);
    computeSpectra(sp, { ...base, mProj: 1, pcBeam: 0.98, pcMag: 0.49 });
    expect(peak()).toBeCloseTo(up / 2, 12);
  });

  it('linear light measures the average of μ_L and μ_R', () => {
    const sp = makeSpectra();
    computeSpectra(sp, { ...base, mProj: 0.8, pcBeam: 0, pcMag: 0.98 });
    for (let i = 0; i < sp.x.length; i += 17) expect(sp.L3.beam[i]).toBeCloseTo((sp.L3.muL[i] + sp.L3.muR[i]) / 2, 12);
  });

  it('read-back of the drawn curves recovers the projected moments (window truncation < 3 %)', () => {
    const sp = makeSpectra();
    for (const m of [1, 0.6, -0.9]) {
      computeSpectra(sp, { ...base, mProj: m, pcBeam: 0.98, pcMag: 0.98 });
      const rb = readBack(sp, 0.98, FEPT.nh);
      expect(rb.mSpinEff / (FEPT.mSpin * m)).toBeCloseTo(1, 1);
      expect(Math.abs(rb.mSpinEff / (FEPT.mSpin * m) - 1)).toBeLessThan(0.03);
      expect(Math.abs(rb.mOrb / (FEPT.mOrb * m) - 1)).toBeLessThan(0.03);
    }
  });

  it('edge jumps follow the 2:1 statistical ratio', () => {
    expect(EDGES.L2.jump / EDGES.L3.jump).toBeCloseTo(0.5, 12);
  });
});
