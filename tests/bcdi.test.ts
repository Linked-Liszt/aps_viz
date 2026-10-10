/**
 * Physics tests for the "Strain inside a nanocrystal" (BCDI) station.
 * Covers crystallography, the forward model (Friedel's law, peak shift), the displacement fields (dislocation winding,
 * Lamé core–shell solution), the coherent-flux estimate, the FFT, the noise floor, alignment/twin handling and an
 * end-to-end phase retrieval.
 */
import { describe, expect, it } from 'vitest';
import { fft2d } from '../src/lib/fft';
import { FFT2 } from '../src/ui/explainers/bcdi/fft2';
import {
  A_AU,
  B_LEN,
  BraggSim,
  COHERENT_GAIN,
  CRYSTAL_WIDTH,
  DEFAULT_FIELD,
  DQ,
  DX,
  N,
  NU,
  OVERSAMPLING,
  PHOTON_RATE,
  REFLECTIONS,
  SOURCES,
  buildShape,
  burgers,
  coherentFraction,
  coreShellRadial,
  dislocationAt,
  friedelAsymmetry,
  phaseFn,
  radialMean,
  sdist,
  type FieldParams,
  type Mode,
  type ReflId,
} from '../src/ui/explainers/bcdi/physics';
import { PR_ITERS, PhaseRetriever, align, applyAlignment, noiseFloor, type Alignment } from '../src/ui/explainers/bcdi/phasing';

const field = (mode: Mode, extra: Partial<FieldParams> = {}): FieldParams => ({ ...DEFAULT_FIELD, mode, ...extra });

describe('crystallography (Au, 9 keV)', () => {
  it('d-spacings and Bragg angles', () => {
    expect(REFLECTIONS['111'].d).toBeCloseTo(A_AU / Math.sqrt(3), 6);
    expect(REFLECTIONS['002'].d).toBeCloseTo(A_AU / 2, 6);
    expect(REFLECTIONS['220'].d).toBeCloseTo(A_AU / Math.sqrt(8), 6);
    // 2θ = 2 asin(λ/2d), λ = 1.3776 Å
    expect(REFLECTIONS['111'].twoTheta).toBeCloseTo(34.0, 1);
    expect(REFLECTIONS['002'].twoTheta).toBeCloseTo(39.5, 1);
  });

  it('G vectors lie in the [1-10] zone with the right lengths and angles', () => {
    const g111 = REFLECTIONS['111'].g;
    // [111] is drawn vertical
    expect(Math.abs(g111[0])).toBeLessThan(1e-12);
    expect(g111[1]).toBeGreaterThan(0);
    const a = REFLECTIONS['111'];
    const b = REFLECTIONS['-1-11'];
    const cos = (a.g[0] * b.g[0] + a.g[1] * b.g[1]) / (a.gMag * b.gMag);
    expect((Math.acos(cos) * 180) / Math.PI).toBeCloseTo(109.47, 1); // [111]∠[1̄1̄1]: cos = −1/3
  });

  it('Burgers vector b = ½[110] and G·b/2π (dislocation visibility)', () => {
    expect(B_LEN).toBeCloseTo(2.8837, 3);
    const n: Record<ReflId, number> = { '111': 1, '-1-11': -1, '002': 0, '220': 2 };
    for (const id of Object.keys(n) as ReflId[]) expect(REFLECTIONS[id].n).toBe(n[id]);
  });
});

describe('crystal shape and sampling', () => {
  it('300 nm wide, oversampled > 2, and not centro-symmetric (substrate truncation)', () => {
    const s = buildShape();
    const xs = s.verts.map((v) => v[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(CRYSTAL_WIDTH, 6);
    expect(OVERSAMPLING).toBeGreaterThan(2);
    expect(DQ).toBeCloseTo((2 * Math.PI) / (N * DX), 12);
    // a point inside whose mirror image through the centroid is outside ⇒ no inversion centre
    const [cx, cy] = s.centroid;
    let asymmetric = false;
    for (let y = -150; y <= 150 && !asymmetric; y += 5)
      for (let x = -150; x <= 150 && !asymmetric; x += 5) if (sdist(s, x, y) < -5 && sdist(s, 2 * cx - x, 2 * cy - y) > 5) asymmetric = true;
    expect(asymmetric).toBe(true);
  });

  it('the crystal stays well inside the grid (no wrap-around)', () => {
    const sim = new BraggSim();
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) if (sim.support[j * N + i]) expect(Math.min(i, j, N - 1 - i, N - 1 - j)).toBeGreaterThan(20);
  });
});

describe('FFT2', () => {
  it('matches the reference FFT and inverts to n²·identity', () => {
    const n = 32;
    const f = new FFT2(n);
    const re = new Float64Array(n * n).map((_, k) => Math.sin(k * 0.37) + 0.1 * (k % 7));
    const im = new Float64Array(n * n).map((_, k) => Math.cos(k * 0.11));
    const r2 = re.slice();
    const i2 = im.slice();
    f.run(re, im, -1);
    fft2d(r2, i2, n, false);
    let err = 0;
    for (let k = 0; k < n * n; k++) err = Math.max(err, Math.abs(re[k] - r2[k]), Math.abs(im[k] - i2[k]));
    expect(err).toBeLessThan(1e-9);
    f.run(re, im, 1);
    for (let k = 0; k < 50; k++) expect(re[k] / (n * n)).toBeCloseTo(Math.sin(k * 0.37) + 0.1 * (k % 7), 9);
  });
});

describe('forward model: Friedel symmetry and strain', () => {
  const sim = new BraggSim();
  const R = REFLECTIONS['111'];

  it('perfect crystal ⇒ I(q) = I(−q) and the peak stays at G', () => {
    sim.setField(phaseFn(sim.shape, field('perfect'), R));
    sim.measure(1e6, 1);
    expect(sim.stats.asym).toBeLessThan(1e-9);
    expect(friedelAsymmetry(sim.intensity, N)).toBeLessThan(1e-9);
    expect(Math.hypot(sim.stats.comX, sim.stats.comY)).toBeLessThan(0.05);
  });

  it('uniform strain moves the peak to Δq = −εG and keeps it centro-symmetric', () => {
    const eps = 0.002;
    sim.setField(phaseFn(sim.shape, field('expanded', { eps }), R));
    sim.measure(1e6, 1);
    expect(sim.stats.asym).toBeLessThan(1e-6);
    const gx = R.g[0] * 10; // nm⁻¹
    const gy = R.g[1] * 10;
    expect(sim.stats.comX).toBeCloseTo((-eps * gx) / DQ, 0);
    expect(Math.abs(sim.stats.comY - (-eps * gy) / DQ)).toBeLessThan(0.3);
  });

  it('inhomogeneous strain breaks the symmetry', () => {
    const sh = sim.shape;
    const cases: [Mode, Partial<FieldParams>][] = [
      ['bent', { kappa: 5e-6 }],
      ['coreshell', { misfit: 0.002 }],
      ['dislocation', { disl: dislocationAt(sh, -0.25) }],
      ['surface', { u0: 0.4 }],
    ];
    for (const [mode, extra] of cases) {
      const p = field(mode, extra);
      sim.setField(phaseFn(sh, p, R), mode === 'dislocation' ? p.disl : null);
      sim.measure(1e6, 1);
      expect(sim.stats.asym, mode).toBeGreaterThan(0.03);
    }
  });

  it('parity: an even phase on a centro-symmetric object keeps I(q) = I(−q); an odd (cubic) phase breaks it', () => {
    const n = 128;
    const f = new FFT2(n);
    const asym = (ph: (x: number, y: number) => number) => {
      const re = new Float64Array(n * n);
      const im = new Float64Array(n * n);
      // centro-symmetric hexagon about pixel (64, 64)
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const x = i - 64;
          const y = j - 64;
          if (Math.abs(x) <= 30 && Math.abs(y) <= 20 && Math.abs(x + y) <= 40) {
            re[j * n + i] = Math.cos(ph(x, y));
            im[j * n + i] = Math.sin(ph(x, y));
          }
        }
      f.run(re, im, 1);
      const I = new Float64Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) I[((j + 64) % n) * n + ((i + 64) % n)] = re[j * n + i] ** 2 + im[j * n + i] ** 2;
      return friedelAsymmetry(I, n);
    };
    // bending-like quadratic (even) phase: symmetric despite strong strain
    expect(asym((x, y) => 4e-4 * (x * x + 0.4 * y * y) - 3e-4 * x * y)).toBeLessThan(1e-9);
    // odd, non-linear phase: lopsided
    expect(asym((x) => 2e-5 * x * x * x)).toBeGreaterThan(0.1);
  });

  it('core–shell: mean strain = mean eigenstrain (traction-free body) ⇒ peak centroid at −ε_m c² G', () => {
    const misfit = 0.002;
    const p = field('coreshell', { misfit });
    sim.setField(phaseFn(sim.shape, p, R));
    sim.measure(1e6, 1);
    const c2 = p.coreFrac * p.coreFrac;
    expect(sim.stats.comX).toBeCloseTo((-misfit * c2 * R.g[0] * 10) / DQ, 1);
    expect(Math.abs(sim.stats.comY - (-misfit * c2 * R.g[1] * 10) / DQ)).toBeLessThan(0.1);
  });

  it('deferred analysis (measure without analysis, then analyse()) matches the one-pass result', () => {
    const p = field('dislocation', { disl: dislocationAt(sim.shape, -0.25) });
    sim.setField(phaseFn(sim.shape, p, R), p.disl);
    sim.measure(1e6, 5);
    const full = { ...sim.stats };
    const asymMap = sim.asymMap.slice();
    // a different state in between, so stale values would show
    sim.setField(phaseFn(sim.shape, field('perfect'), R));
    sim.measure(1e6, 5);
    sim.setField(phaseFn(sim.shape, p, R), p.disl);
    sim.measure(1e6, 5, false);
    expect(sim.stats.asym).toBeLessThan(1e-9); // still the perfect crystal's value: analysis deferred
    sim.analyse();
    expect(sim.stats.asym).toBeCloseTo(full.asym, 12);
    expect(sim.stats.kmax).toBe(full.kmax);
    expect(sim.stats.counted).toBe(full.counted);
    let d = 0;
    for (let k = 0; k < N * N; k++) if (Number.isFinite(asymMap[k])) d = Math.max(d, Math.abs(asymMap[k] - sim.asymMap[k]));
    expect(d).toBeLessThan(1e-9);
    // the binned azimuthal mean equals the reference radialMean()
    const out = new Float64Array(N / 2 + 1);
    const cnt = new Float64Array(N / 2 + 1);
    radialMean(sim.centred, N, out, cnt);
    for (let r = 0; r <= N / 2; r++) expect(sim.radial[r]).toBeCloseTo(out[r], 6);
  });

  it('Poisson counts conserve the photon budget and more photons ⇒ finer resolution', () => {
    sim.setField(phaseFn(sim.shape, field('perfect'), R));
    sim.measure(PHOTON_RATE.apsu * 0.1, 3);
    const resU = sim.stats.resolution;
    expect(sim.stats.counted / sim.stats.total).toBeGreaterThan(0.99);
    expect(sim.stats.counted / sim.stats.total).toBeLessThan(1.01);
    sim.measure(PHOTON_RATE.aps * 0.1, 3);
    expect(sim.stats.resolution).toBeGreaterThan(2 * resU);
  });
});

describe('displacement fields', () => {
  const shape = buildShape();

  /** total winding of φ around a circle (sum of wrapped differences) / 2π */
  const winding = (id: ReflId, c: [number, number], r: number) => {
    const f = phaseFn(shape, field('dislocation', { disl: c }), REFLECTIONS[id]);
    let tot = 0;
    const M = 720;
    let prev = f(c[0] + r, c[1]);
    for (let k = 1; k <= M; k++) {
      const t = (2 * Math.PI * k) / M;
      const v = f(c[0] + r * Math.cos(t), c[1] + r * Math.sin(t));
      let d = v - prev;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      tot += d;
      prev = v;
    }
    return tot / (2 * Math.PI);
  };

  it('edge dislocation: φ winds by G·b = 2πn around the core', () => {
    const c: [number, number] = [10, -20];
    expect(winding('111', c, 15)).toBeCloseTo(1, 6);
    expect(winding('-1-11', c, 15)).toBeCloseTo(-1, 6);
    expect(winding('002', c, 15)).toBeCloseTo(0, 6);
    expect(winding('220', c, 15)).toBeCloseTo(2, 6);
  });

  it('edge dislocation: the extra half-plane side (+y′) is compressed (Hirth & Lothe dilatation)', () => {
    // ∇·u = −(b/2π)·(1 − 2ν)/(1 − ν)·y′/r². Recover u from the phases of two non-collinear reflections, then differentiate.
    const c: [number, number] = [0, 0];
    const fa = phaseFn(shape, field('dislocation', { disl: c }), REFLECTIONS['111']);
    const fb = phaseFn(shape, field('dislocation', { disl: c }), REFLECTIONS['-1-11']);
    const ga = REFLECTIONS['111'].g.map((v) => v * 10); // nm⁻¹
    const gb = REFLECTIONS['-1-11'].g.map((v) => v * 10);
    const det = ga[0] * gb[1] - ga[1] * gb[0];
    const u = (x: number, y: number): [number, number] => {
      const pa = fa(x, y);
      const pb = fb(x, y);
      return [(gb[1] * pa - ga[1] * pb) / det, (-gb[0] * pa + ga[0] * pb) / det];
    };
    const h = 0.01;
    const div = (x: number, y: number) => (u(x + h, y)[0] - u(x - h, y)[0] + u(x, y + h)[1] - u(x, y - h)[1]) / (2 * h);
    const bv = burgers();
    const bm = Math.hypot(bv[0], bv[1]);
    const side = [-bv[1] / bm, bv[0] / bm]; // +y′ = b̂ rotated +90°
    const r = 20;
    const dPlus = div(side[0] * r, side[1] * r);
    const dMinus = div(-side[0] * r, -side[1] * r);
    const expected = ((B_LEN / 10 / (2 * Math.PI)) * (1 - 2 * NU)) / (1 - NU) / r;
    expect(dPlus).toBeLessThan(0);
    expect(dMinus).toBeGreaterThan(0);
    // r² is regularised as r² + (0.5 nm)² at the core ⇒ 3×10⁻⁴ relative difference at 20 nm
    expect(-dPlus / expected).toBeCloseTo(1, 3);
  });

  it('core–shell (Lamé, plane stress): continuous u and σ_rr at the interface, free outer surface', () => {
    const a = 60;
    const b = 150;
    const em = 0.002;
    const u = (r: number) => coreShellRadial(r, a, b, em);
    const h = 1e-4;
    const sig = (r: number, inCore: boolean) => {
      const err = (u(r + h) - u(r - h)) / (2 * h);
      const ett = u(r) / r;
      const eig = inCore ? em : 0;
      return err + NU * ett - (1 + NU) * eig; // ∝ σ_rr (plane stress)
    };
    expect(u(a - 1e-9)).toBeCloseTo(u(a + 1e-9), 9);
    expect(sig(a - 0.01, true)).toBeCloseTo(sig(a + 0.01, false), 5);
    expect(sig(b - 1e-3, false)).toBeCloseTo(0, 6);
  });

  it('a perfect crystal is phase-flat; uniform strain is a pure linear ramp', () => {
    const f0 = phaseFn(shape, field('perfect'), REFLECTIONS['111']);
    expect(f0(12, 34)).toBe(0);
    const f = phaseFn(shape, field('expanded', { eps: 0.001 }), REFLECTIONS['111']);
    const lap = f(10, 10) + f(-10, -10) - 2 * f(0, 0);
    expect(Math.abs(lap)).toBeLessThan(1e-12);
  });
});

describe('source: APS vs APS-U coherent flux', () => {
  it('coherent fractions at 9 keV (FDR Table 1.1 beam sizes, 2.1 m undulator)', () => {
    const fa = coherentFraction(SOURCES.aps);
    const fu = coherentFraction(SOURCES.apsu);
    expect(fa).toBeGreaterThan(4e-4);
    expect(fa).toBeLessThan(6e-4);
    expect(fu).toBeGreaterThan(0.05);
    expect(fu).toBeLessThan(0.07);
    expect(COHERENT_GAIN).toBeGreaterThan(200);
    expect(COHERENT_GAIN).toBeLessThan(300);
    expect(PHOTON_RATE.apsu / PHOTON_RATE.aps).toBeCloseTo(COHERENT_GAIN, 6);
  });

  it('a zero-emittance electron beam is fully coherent in the Gaussian model (σ_r·σ_r′ = λ/4π)', () => {
    const z = { id: 'apsu' as const, sx: 0, sxp: 0, sy: 0, syp: 0, current: 1 };
    expect(coherentFraction(z)).toBeCloseTo(1, 9);
  });
});

describe('phase retrieval', () => {
  it('Poisson noise floor of the Fourier error: ε → 0.5/√c for large counts', () => {
    const c = new Float64Array(1000).fill(400);
    expect(noiseFloor(c)).toBeCloseTo(0.5 / Math.sqrt(400), 3);
  });

  it('alignment recognises a shifted copy and a twin (conjugated, inverted) copy', () => {
    const sim = new BraggSim();
    sim.setField(phaseFn(sim.shape, field('dislocation', { disl: [0, 0] }), REFLECTIONS['111']), [0, 0]);
    const T = { re: sim.objRe, im: sim.objIm, norm: sim.truthNorm, com: sim.truthCom, idx: sim.truthIdx };
    const out: Alignment = { match: 0, twin: false, sx: 0, sy: 0, phase: 0 };
    const eRe = new Float64Array(N * N);
    const eIm = new Float64Array(N * N);
    // shifted by (5, −3) with a global phase of 1 rad
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const q = ((j - 3 + N) % N) * N + ((i + 5) % N);
        eRe[q] = sim.objRe[k] * Math.cos(1) - sim.objIm[k] * Math.sin(1);
        eIm[q] = sim.objRe[k] * Math.sin(1) + sim.objIm[k] * Math.cos(1);
      }
    align(eRe, eIm, N, T, out);
    expect(out.twin).toBe(false);
    expect(out.match).toBeGreaterThan(0.999);
    // twin: conj(O(−r)) about an arbitrary centre
    eRe.fill(0);
    eIm.fill(0);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const q = ((7 - j + 2 * N) % N) * N + ((3 - i + 2 * N) % N);
        eRe[q] = sim.objRe[k];
        eIm[q] = -sim.objIm[k];
      }
    align(eRe, eIm, N, T, out);
    expect(out.twin).toBe(true);
    expect(out.match).toBeGreaterThan(0.999);
    const dRe = new Float64Array(N * N);
    const dIm = new Float64Array(N * N);
    applyAlignment(eRe, eIm, N, out, dRe, dIm);
    let e = 0;
    for (let k = 0; k < N * N; k++) e = Math.max(e, Math.abs(dRe[k] - sim.objRe[k]), Math.abs(dIm[k] - sim.objIm[k]));
    expect(e).toBeLessThan(1e-9);
  });

  it('HIO/ER + shrink-wrap recovers the strained crystal from APS-U data (end to end)', () => {
    const sim = new BraggSim();
    const p = field('dislocation', { disl: dislocationAt(sim.shape, -0.25) });
    sim.setField(phaseFn(sim.shape, p, REFLECTIONS['111']), p.disl);
    sim.measure(PHOTON_RATE.apsu * 0.1, 7);
    const pr = new PhaseRetriever(sim.fft);
    pr.reset(sim.modulus, 11, null);
    while (!pr.done) pr.step();
    const eRe = new Float64Array(N * N);
    const eIm = new Float64Array(N * N);
    pr.projected(eRe, eIm);
    const out: Alignment = { match: 0, twin: false, sx: 0, sy: 0, phase: 0 };
    align(eRe, eIm, N, { re: sim.objRe, im: sim.objIm, norm: sim.truthNorm, com: sim.truthCom, idx: sim.truthIdx }, out);
    expect(pr.iter).toBe(PR_ITERS);
    expect(out.match).toBeGreaterThan(0.95);
    // final Fourier error close to the Poisson floor
    expect(pr.err[PR_ITERS - 1] / noiseFloor(sim.counts)).toBeLessThan(1.7);
  }, 60000);
});
