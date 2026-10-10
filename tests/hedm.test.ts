import { describe, expect, it, vi } from 'vitest';
import * as P from '../src/ui/explainers/hedm/physics';
import { HedmSim, FF } from '../src/ui/explainers/hedm/sim';
import { hangMass, pullToStrain } from '../src/ui/explainers/hedm';
import { rng } from '../src/lib/fft';

const deg = (r: number) => r / P.DEG;

describe('Bragg geometry at high energy', () => {
  it('λ = 12.398/E and Ni 111 sits at 2θ ≈ 4.99° at 70 keV', () => {
    expect(P.wavelength(70)).toBeCloseTo(0.17712, 4);
    const f = P.fccFamilies(P.NI.a, 8);
    expect(f[0].label).toBe('111');
    expect(f[0].d).toBeCloseTo(2.0345, 3);
    expect(deg(P.twoThetaOf(f[0].d, P.wavelength(70)))).toBeCloseTo(4.99, 2);
    // small-angle scaling: 2θ ∝ 1/E
    const r = P.twoThetaOf(f[0].d, P.wavelength(35)) / P.twoThetaOf(f[0].d, P.wavelength(70));
    expect(r).toBeCloseTo(2, 2);
  });

  it('fcc ring families: unmixed hkl, multiplicities and unit normals', () => {
    const f = P.fccFamilies(P.NI.a, 8);
    expect(f.map((x) => x.label)).toEqual(['111', '200', '220', '311', '222', '400', '331', '420']);
    expect(f.map((x) => x.n)).toEqual([8, 6, 12, 24, 8, 6, 24, 24]);
    for (const fam of f)
      for (let m = 0; m < fam.n; m++) expect(Math.hypot(fam.normals[m * 3], fam.normals[m * 3 + 1], fam.normals[m * 3 + 2])).toBeCloseTo(1, 12);
  });

  it('ω solutions satisfy |k_out| = |k_in| and λ = 2d sinθ', () => {
    const r = rng(3);
    const out = new Float64Array(8);
    const lam = P.wavelength(70);
    for (let t = 0; t < 200; t++) {
      const d = 0.8 + 1.5 * r();
      const u = P.randomRotation(r);
      const gx = u[2] / d;
      const gy = u[5] / d;
      const gz = u[8] / d;
      const k = P.solveOmega(gx, gy, gz, lam, out);
      for (let j = 0; j < k; j++) {
        const om = out[j * 4];
        const [dx, dy, dz] = [out[j * 4 + 1], out[j * 4 + 2], out[j * 4 + 3]];
        expect(Math.hypot(dx, dy, dz)).toBeCloseTo(1, 10); // elastic: |k_out| = |k_in|
        const sinT = lam / (2 * d);
        expect(dx).toBeCloseTo(1 - 2 * sinT * sinT, 10); // cos 2θ
        // lab g_x = −λ|g|²/2
        const glx = gx * Math.cos(om) - gy * Math.sin(om);
        expect(glx).toBeCloseTo((-lam / (d * d)) / 2, 10);
      }
    }
  });

  it('g along the rotation axis never diffracts (blind zone)', () => {
    const out = new Float64Array(8);
    expect(P.solveOmega(0, 0, 1 / 2.03, P.wavelength(70), out)).toBe(0);
    expect(P.solveOmega(0.002, 0, 1 / 2.03, P.wavelength(70), out)).toBe(0);
  });

  it('lattice strain shifts 2θ by −2 tanθ·ε', () => {
    const lam = P.wavelength(70);
    const d = P.NI.a / 2; // 200
    const eps = 3e-3;
    const out = new Float64Array(8);
    // g ⟂ beam-ish along z-tilted direction, strain along g
    const n: P.Vec3 = [0.6, 0, 0.8];
    P.solveOmega(n[0] / d, n[1] / d, n[2] / d, lam, out);
    const tt0 = Math.acos(out[1]);
    P.solveOmega((n[0] / d) * (1 - eps), (n[1] / d) * (1 - eps), (n[2] / d) * (1 - eps), lam, out);
    const tt1 = Math.acos(out[1]);
    expect((tt1 - tt0) / (-2 * Math.tan(tt0 / 2) * eps)).toBeCloseTo(1, 2);
  });

  it('detector hit and exit path through a cylinder', () => {
    const [Y, Z] = P.detectorHit(0, 0, Math.cos(0.1), Math.sin(0.1), 0, 1000);
    expect(Y).toBeCloseTo(1000 * Math.tan(0.1), 9);
    expect(Z).toBe(0);
    expect(P.exitPath(0, 0, 1, 0, 0.5)).toBeCloseTo(0.5, 12);
    expect(P.entryPath(0, 0, 0.5)).toBeCloseTo(0.5, 12);
    expect(P.entryPath(0.2, 0.3, 0.5)).toBeCloseTo(0.2 + 0.4, 12);
  });

  it('Lorentz factor grows toward the rotation axis (capped), polarisation ≈ 1 at small 2θ', () => {
    const lam = P.wavelength(70);
    const s = Math.sin(0.09);
    const horiz = P.spotFactor(lam, 2, s, 0);
    const diag = P.spotFactor(lam, 2, s * Math.SQRT1_2, s * Math.SQRT1_2);
    const vert = P.spotFactor(lam, 2, s * 0.01, s);
    expect(diag / horiz).toBeCloseTo(Math.SQRT2 * (1 - (s * s) / 2) / (1 - s * s), 3);
    expect(vert / horiz).toBeCloseTo(1 / 0.15 / (1 - s * s), 1);
  });
});

describe('X-ray attenuation (NIST XCOM)', () => {
  const { fe, ni, ti, al } = P.MATERIALS;
  it('reproduces tabulated nodes and the dossier check values for iron', () => {
    expect(P.muRho(ni, 100)).toBeCloseTo(0.444, 6);
    expect(P.attLengthMm(fe, 40)).toBeCloseTo(0.35, 2);
    expect(P.attLengthMm(fe, 100)).toBeCloseTo(3.42, 2);
    expect(P.attLengthMm(fe, 70)).toBeGreaterThan(1.4);
    expect(P.attLengthMm(fe, 70)).toBeLessThan(1.65);
  });
  it('penetration rises monotonically with energy and with lower Z', () => {
    for (const m of [al, ti, fe, ni]) for (let E = 10; E < 200; E += 5) expect(P.attLengthMm(m, E + 5)).toBeGreaterThan(P.attLengthMm(m, E));
    for (const E of [20, 50, 100, 150]) {
      expect(P.attLengthMm(al, E)).toBeGreaterThan(P.attLengthMm(ti, E));
      expect(P.attLengthMm(ti, E)).toBeGreaterThan(P.attLengthMm(fe, E));
      expect(P.attLengthMm(fe, E)).toBeGreaterThan(P.attLengthMm(ni, E));
    }
  });
  it('1 mm of nickel: opaque at lab energies, see-through at HEXM energies', () => {
    expect(P.transmission(ni, 10, 1)).toBeLessThan(1e-50);
    expect(P.transmission(ni, 70, 1)).toBeGreaterThan(0.3);
    expect(P.transmission(ni, 120, 1)).toBeGreaterThan(0.7);
  });
  it('best diffraction energy (∝ λ² e^{−μD}) rises with sample size', () => {
    const e1 = P.bestEnergy(ni, 1);
    const e2 = P.bestEnergy(ni, 2);
    const e5 = P.bestEnergy(ni, 5);
    expect(e1).toBeGreaterThan(60);
    expect(e1).toBeLessThan(90);
    expect(e2).toBeGreaterThan(e1);
    expect(e5).toBeGreaterThan(e2);
  });
});

describe('elasticity of nickel', () => {
  const el = P.elastic();
  it('directional moduli and Zener anisotropy', () => {
    expect(P.youngDir(el, [0, 0, 1])).toBeCloseTo(136.3, 0);
    expect(P.youngDir(el, [1, 1, 1])).toBeCloseTo(304, -1);
    expect((2 * P.NI.C44) / (P.NI.C11 - P.NI.C12)).toBeCloseTo(2.51, 2);
    expect(el.Er).toBeLessThan(el.Em);
    expect(el.Em).toBeLessThan(el.Ev);
    expect(el.Em).toBeGreaterThan(200);
    expect(el.Em).toBeLessThan(240);
  });
  it('grain strain: <100> grain = ½(Reuss + Voigt); random average = macroscopic', () => {
    const I = P.identity();
    const e = P.grainStrain(I, 1, el);
    expect(e[8]).toBeCloseTo(0.5 * (el.S11 + 1 / el.Ev), 12);
    expect(e[0]).toBeCloseTo(0.5 * (el.S12 - el.nuV / el.Ev), 12);
    const r = rng(11);
    let sz = 0;
    let sx = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const g = P.grainStrain(P.randomRotation(r), 1, el);
      sz += g[8];
      sx += g[0];
      expect(g[1]).toBeCloseTo(g[3], 12); // symmetric
    }
    expect(sz / N / (1 / el.Em)).toBeCloseTo(1, 1);
    expect(-(sx / N) / (sz / N)).toBeCloseTo(el.nuM, 1);
  });
  it('macroscopic curve: linear to σ_y, then hardening; slider mapping', () => {
    const eY = P.ALLOY.sigmaY / el.Em;
    expect(P.macroState(eY * 0.5, el).sigma).toBeCloseTo(P.ALLOY.sigmaY / 2, 9);
    expect(P.macroState(eY, el).yielded).toBe(false);
    const m = P.macroState(0.02, el);
    expect(m.yielded).toBe(true);
    expect(m.sigma).toBeCloseTo(P.ALLOY.sigmaY + P.ALLOY.H * m.epsP, 9);
    expect(m.epsP + m.sigma / el.Em).toBeCloseTo(0.02, 9);
    expect(pullToStrain(0)).toBe(0);
    expect(pullToStrain(50)).toBeCloseTo(0.006, 12);
    expect(pullToStrain(100)).toBeCloseTo(0.05, 12);
  });
});

describe('orientations and microstructure', () => {
  it('IPF colours: [001] red, [101] green, [111] blue', () => {
    const U = new Float64Array(9);
    U.set([0, 0, 1], 6);
    expect(P.ipfColor(U)).toEqual([1, 0, 0]);
    U.set([Math.SQRT1_2, 0, Math.SQRT1_2], 6);
    const g = P.ipfColor(U);
    expect(g[1]).toBeCloseTo(1, 9);
    expect(g[0]).toBeCloseTo(0, 9);
    const t = 1 / Math.sqrt(3);
    U.set([t, -t, t], 6);
    const b = P.ipfColor(U);
    expect(b[2]).toBeCloseTo(1, 9);
    expect(b[0] + b[1]).toBeCloseTo(0, 9);
  });
  it('random rotations are proper orthogonal', () => {
    const r = rng(5);
    for (let i = 0; i < 50; i++) {
      const U = P.randomRotation(r);
      const UUt = P.matMul(U, P.transpose(U));
      for (let k = 0; k < 9; k++) expect(UUt[k]).toBeCloseTo(k % 4 === 0 ? 1 : 0, 12);
    }
  });
  it('Voronoi slice tiles the disc and is deterministic', () => {
    const a = P.makeMicrostructure(24, 7);
    const b = P.makeMicrostructure(24, 7);
    const area = a.reduce((s, g) => s + g.area, 0);
    expect(area).toBeCloseTo((72 / (2 * Math.PI)) * Math.sin((2 * Math.PI) / 72), 6);
    expect(a.map((g) => g.cx)).toEqual(b.map((g) => g.cx));
    for (const g of a) expect(P.grainAt(a, g.sx, g.sy)).toBe(g.id);
  });
});

describe('station simulation', () => {
  it('far-field spots: rings at L·tan2θ, density ∝ |cos η|, unloaded fits give zero strain', () => {
    const s = new HedmSim(7);
    let maxDev = 0;
    let horiz = 0;
    let vert = 0;
    for (let i = 0; i < s.n; i++) {
      if (!s.detectable(i)) continue;
      const R = Math.hypot(s.spY[i], s.spZ[i]);
      const R0 = FF.L * Math.tan(P.twoThetaOf(s.fams[s.spFam[i]].d, s.lambda));
      maxDev = Math.max(maxDev, Math.abs(R / R0 - 1));
      const eta = Math.abs(Math.atan2(s.spZ[i], s.spY[i]));
      const e = Math.min(eta, Math.PI - eta);
      if (e < Math.PI / 6) horiz++;
      else if (e > Math.PI / 3) vert++;
    }
    // only the grain-position parallax: a grain ≤ 0.5 mm off-axis moves its spot ≤ 0.5 mm on an ≥ 87 mm ring
    expect(maxDev).toBeLessThan(0.5 / 87 + 1e-3);
    // ∫|cos η| over 0–30° vs 60–90°: (1/2)/(1 − √3/2) ≈ 3.7
    expect(horiz / vert).toBeGreaterThan(2.8);
    expect(horiz / vert).toBeLessThan(4.8);
    s.sweep(0, 2 * Math.PI - 1e-6, true);
    for (const f of s.ringFits()) expect(Math.abs(f.epsPar) + Math.abs(f.epsPerp)).toBeLessThan(1e-4);
  });

  it('under tension the ring fits recover hkl-dependent lattice strains (200 softer than 111)', () => {
    const s = new HedmSim(7);
    s.eps = 0.003;
    s.updateLoad();
    s.updateFF();
    s.sweep(0, 2 * Math.PI - 1e-6, true);
    const fits = s.ringFits();
    const f111 = fits.find((f) => f.fam === 0)!;
    const f200 = fits.find((f) => f.fam === 1)!;
    expect(f111.epsPar).toBeGreaterThan(0);
    expect(f200.epsPar).toBeGreaterThan(f111.epsPar * 1.3);
    expect(f111.epsPerp).toBeLessThan(0);
    const E111 = s.macro.sigma / f111.epsPar;
    const E200 = s.macro.sigma / f200.epsPar;
    expect(E111).toBeGreaterThan(220);
    expect(E111).toBeLessThan(300);
    expect(E200).toBeGreaterThan(130);
    expect(E200).toBeLessThan(190);
  });

  it('ring fits do not depend on the ×20 display, the rod size or how far it has turned (centroid-referred 2θ)', () => {
    const fit = (mag: number, D: number, eps: number, sweepDeg: number) => {
      const s = new HedmSim(7);
      s.mag = mag;
      s.D = D;
      s.eps = eps;
      s.updateLoad();
      s.updateFF();
      s.sweep(0, sweepDeg * P.DEG - 1e-6, true);
      return s.ringFits();
    };
    // unloaded: zero strain to rounding, even for a 5 mm rod (raw panel radii carry ~3e-2 parallax there)
    for (const f of fit(1, 5, 0, 360)) expect(Math.abs(f.epsPar) + Math.abs(f.epsPerp)).toBeLessThan(2e-6);
    const ref = fit(1, 1, 0.003, 360);
    for (const [mag, D, sw] of [
      [20, 1, 360],
      [1, 5, 360],
      [1, 1, 30],
      [20, 5, 30],
    ]) {
      const other = fit(mag, D, 0.003, sw);
      for (const fam of [0, 1]) {
        const a = ref.find((f) => f.fam === fam)!;
        const b = other.find((f) => f.fam === fam)!;
        // a 30° sweep samples fewer grains (statistics), but no systematic shift beyond ~5 %
        const tol = sw < 360 ? 0.06 : 2e-3;
        expect(Math.abs(b.epsPar / a.epsPar - 1)).toBeLessThan(tol);
      }
    }
    // the fitted ring passes through the unstrained radius when unloaded
    const s = new HedmSim(7);
    s.sweep(0, 2 * Math.PI - 1e-6, true);
    for (const f of s.ringFits()) expect(s.fitRadius(f, 0.5) / f.R0).toBeCloseTo(1, 5);
  });

  it('near-field forward model rebuilds the grain map, and after yield resolves the sub-grains', () => {
    const s = new HedmSim(7);
    s.buildNF();
    s.sweep(0, 2 * Math.PI - 1e-6, true);
    while (s.pumpNF(1e4));
    const ok = s.nfStats();
    expect(ok.mapped).toBeGreaterThan(0.95);
    expect(ok.correct).toBeGreaterThan(0.97);
    s.eps = 0.04;
    s.updateLoad();
    s.updateFF();
    s.buildNF();
    while (s.pumpNF(1e4));
    const bent = s.nfStats();
    expect(bent.mapped).toBeGreaterThan(0.9);
    expect(bent.correct).toBeGreaterThan(0.95);
    let sub = 0;
    for (let v = 0; v < s.nv; v++) if (s.best(v).o === s.ng + 4 * s.vGrain[v] + s.vSub[v]) sub++;
    expect(sub / s.nv).toBeGreaterThan(0.8);
  });

  it('bulk bestAll() equals per-voxel best(); on-demand nf frames only light pixels of real grains', () => {
    const s = new HedmSim(7);
    s.eps = 0.03;
    s.updateLoad();
    s.updateFF();
    s.buildNF();
    s.sweep(0, Math.PI, true);
    while (s.pumpNF(1e4));
    const bo = new Int16Array(s.nv);
    const bc = new Float32Array(s.nv);
    s.bestAll(bo, bc);
    for (let v = 0; v < s.nv; v++) {
      const b = s.best(v);
      expect(bo[v]).toBe(b.o);
      expect(bc[v]).toBeCloseTo(b.c, 6);
    }
    expect(s.summarize(bo, bc)).toEqual(s.nfStats());
    // every lit pixel of a frame carries a grain id (1..ng) or the noise marker; frames are cleared again
    let lit = 0;
    for (let b = 0; b < 360; b += 7) {
      const n = s.renderFrame(b);
      for (let i = 0; i < n; i++) {
        const g = s.frameBuf[s.touchedBuf[i]];
        expect(g === 255 || (g >= 1 && g <= s.ng)).toBe(true);
      }
      lit += n;
      s.clearFrame(n);
      expect(s.frameBuf.every((x) => x === 0)).toBe(true);
    }
    expect(lit).toBeGreaterThan(52 * 50);
  });

  it('thick sample at low energy: almost nothing detectable', () => {
    const s = new HedmSim(7);
    s.E = 35;
    s.D = 4;
    s.updateFF();
    let n = 0;
    for (let i = 0; i < s.n; i++) if (s.detectable(i)) n++;
    expect(n).toBeLessThan(10);
    expect(s.transmissionCentre).toBeLessThan(1e-9);
  });
});

describe('rotation bookkeeping', () => {
  it('crossings() returns exactly the detectable spots swept, also across the 360° wrap and backwards', () => {
    const s = new HedmSim(7);
    const brute = (lo: number, hi: number) => {
      const TWO = 2 * Math.PI;
      if (hi < lo) hi += TWO;
      const r: number[] = [];
      for (let i = 0; i < s.n; i++) {
        if (!s.detectable(i)) continue;
        let w = s.spOmega[i];
        if (w <= lo) w += TWO;
        if (w > lo && w <= hi) r.push(i);
      }
      return r.sort((a, b) => a - b);
    };
    const out: number[] = [];
    for (const [a, b] of [
      [0.1, 0.13],
      [6.25, 0.05],
      [3, 3.6],
      [5.9, 6.28],
    ]) {
      s.crossings(a, b, true, out, 1e6);
      expect([...out].sort((p, q) => p - q)).toEqual(brute(a, b));
      s.crossings(b, a, false, out, 1e6);
      expect([...out].sort((p, q) => p - q)).toEqual(brute(a, b));
    }
    s.crossings(0, 4, true, out); // a jump, not a sweep
    expect(out.length).toBe(0);
  });
});

describe('station readouts', () => {
  it('transmission readout follows E and D immediately (before the spot list is rebuilt)', () => {
    const s = new HedmSim(7);
    s.E = 35;
    s.D = 4;
    s.updateBeam();
    expect(s.transmissionCentre).toBeCloseTo(P.transmission(P.MATERIALS.ni, 35, 4), 12);
    expect(s.lambda).toBeCloseTo(P.wavelength(35), 12);
    s.E = 120;
    s.D = 3;
    s.updateBeam();
    expect(s.transmissionCentre).toBeGreaterThan(0.4);
    expect(s.transmissionCentre).toBeLessThan(0.45);
  });
});

describe('visitor analogies', () => {
  it('stress as a hanging weight: 796 MPa on a 1 mm rod ≈ 64 kg, on 5 mm ≈ 1.6 t', () => {
    expect(hangMass(0.796, 1)).toBe('64 kg');
    expect(hangMass(0.796, 5)).toBe('1.6 tonnes');
    expect(hangMass(0.3, 0.5)).toBe('6 kg');
  });
});

describe('reduced-motion preference (kit), relied on by the Turn / Play buttons', () => {
  it('still hears a switch although a station loop reads the preference every frame', async () => {
    // Chrome-like query: reading .matches updates its state, and a change event fires only if the state differs
    // when the query is re-evaluated, so a read in between swallows the event
    class FakeQuery {
      env = false;
      state = false;
      fns: ((e: { matches: boolean }) => void)[] = [];
      get matches(): boolean {
        this.state = this.env;
        return this.state;
      }
      addEventListener(_t: string, f: (e: { matches: boolean }) => void): void {
        this.fns.push(f);
      }
      evaluate(): void {
        if (this.state === this.env) return;
        this.state = this.env;
        for (const f of this.fns) f({ matches: this.state });
      }
    }
    const q = new FakeQuery();
    vi.stubGlobal('matchMedia', () => q);
    vi.resetModules();
    try {
      const kit = await import('../src/ui/explainers/kit');
      const heard: boolean[] = [];
      const station = { onDestroy: () => {} } as unknown as Parameters<typeof kit.onReducedMotionChange>[0];
      kit.onReducedMotionChange(station, (r) => heard.push(r));
      expect(kit.prefersReducedMotion()).toBe(false);
      for (const v of [true, false, true]) {
        q.env = v;
        kit.prefersReducedMotion(); // a frame runs before the browser re-evaluates the query
        q.evaluate();
        expect(kit.prefersReducedMotion()).toBe(v);
      }
      expect(heard).toEqual([true, false, true]);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
