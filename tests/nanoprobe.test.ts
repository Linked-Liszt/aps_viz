import { describe, expect, it } from 'vitest';
import {
  ELEMENTS,
  W_EDGES,
  apsuGain,
  bdaCoherentUm,
  comptonE,
  detFwhm,
  doseGy,
  effectiveDwell,
  elementXS,
  equalCountsMapTime,
  fmtLenNm,
  fmtTime,
  focusedFlux,
  isExcited,
  kAlphaXS,
  KB,
  kbDiffLimitNm,
  lineXS,
  sourceCoherentFlux,
  spotMinNm,
  wSubshellXS,
} from '../src/ui/explainers/nanoprobe/physics';
import { CELL_STATES, FOV_NM, allocComposition, buildGeometry, composition } from '../src/ui/explainers/nanoprobe/sample';
import { NCH, Pyramid, ScanRun, SPEC, Spectrum, chE } from '../src/ui/explainers/nanoprobe/scan';
import { rng } from '../src/lib/fft';

const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe('XRF atomic data', () => {
  it('line energies and edges match tabulated values (keV)', () => {
    const ka1 = (k: 'Ni' | 'Mn' | 'Co') => ELEMENTS[k].lines[0].e;
    expect(ka1('Mn')).toBeCloseTo(5.899, 3);
    expect(ka1('Co')).toBeCloseTo(6.930, 3);
    expect(ka1('Ni')).toBeCloseTo(7.478, 3);
    expect(ELEMENTS.W.lines.find((l) => l.name === 'Lα₁')!.e).toBeCloseTo(8.398, 3);
    expect(ELEMENTS.W.lines.find((l) => l.name === 'Lβ₁')!.e).toBeCloseTo(9.672, 3);
    expect(ELEMENTS.Mn.edges[0].e).toBeCloseTo(6.539, 3);
    expect(ELEMENTS.Co.edges[0].e).toBeCloseTo(7.709, 3);
    expect(ELEMENTS.Ni.edges[0].e).toBeCloseTo(8.333, 3);
    expect(W_EDGES.L3).toBeCloseTo(10.207, 3);
  });

  it('an element fluoresces only above its absorption edge', () => {
    expect(elementXS('Ni', 8.3)).toBe(0);
    expect(elementXS('Ni', 8.4)).toBeGreaterThan(90);
    expect(isExcited('Mn', 6.5)).toBe(false);
    expect(isExcited('Mn', 6.6)).toBe(true);
    expect(elementXS('W', 10.2)).toBe(0);
    // L2 lines (Lβ1) need E0 > L2 edge; L3 lines (Lα) only need L3
    const lb1 = ELEMENTS.W.lines.find((l) => l.name === 'Lβ₁')!;
    const la1 = ELEMENTS.W.lines.find((l) => l.name === 'Lα₁')!;
    expect(lineXS('W', lb1, 11.0)).toBe(0);
    expect(lineXS('W', la1, 11.0)).toBeGreaterThan(15);
    expect(lineXS('W', lb1, 12.0)).toBeGreaterThan(10);
  });

  it('Kα production cross sections agree with xraylib (Kissel + cascade) to 3 %', () => {
    // xraylib 4.3 CS_FluorLine_Kissel_Cascade(Z, KL2+KL3, E), cm²/g
    expect(rel(kAlphaXS('Ni', 10), 67.403)).toBeLessThan(0.03);
    expect(rel(kAlphaXS('Ni', 20), 10.398)).toBeLessThan(0.03);
    expect(rel(kAlphaXS('Mn', 12), 23.141)).toBeLessThan(0.03);
    expect(rel(kAlphaXS('Co', 15), 18.578)).toBeLessThan(0.03);
    expect(rel(wSubshellXS('L3', 13), 22.781)).toBeLessThan(0.01);
    expect(rel(wSubshellXS('L2', 14), 11.882)).toBeLessThan(0.01);
    // W L3 / L2 just above their edges (xraylib 13–56 eV above; the on-edge xraylib values are interpolation artefacts)
    expect(rel(wSubshellXS('L3', 10.3), 34.817)).toBeLessThan(0.01);
    expect(rel(wSubshellXS('L3', 10.21), 36.226)).toBeLessThan(0.01);
    expect(rel(wSubshellXS('L2', 11.6), 18.267)).toBeLessThan(0.01);
    expect(wSubshellXS('L3', 10.25)).toBeGreaterThan(wSubshellXS('L3', 10.6));
    // Kβ/Kα ≈ 0.135 for the 3d metals
    const ni = ELEMENTS.Ni.lines;
    expect(lineXS('Ni', ni[2], 12) / (lineXS('Ni', ni[0], 12) + lineXS('Ni', ni[1], 12))).toBeCloseTo(0.1356, 3);
  });

  it('excitation is strongest just above the edge and falls roughly as E^-2.7', () => {
    const slope = Math.log(kAlphaXS('Ni', 20) / kAlphaXS('Ni', 10)) / Math.log(2);
    expect(slope).toBeLessThan(-2.5);
    expect(slope).toBeGreaterThan(-2.9);
    expect(kAlphaXS('Mn', 6.6)).toBeGreaterThan(kAlphaXS('Mn', 8));
  });
});

describe('detector and scatter', () => {
  it('SDD resolution ≈ 125–130 eV at Mn Kα and grows as √E', () => {
    const f = detFwhm(5.899) * 1000;
    expect(f).toBeGreaterThan(120);
    expect(f).toBeLessThan(135);
    expect(detFwhm(10)).toBeGreaterThan(detFwhm(6));
  });
  it('Compton peak at 90°: 13 keV → 12.677 keV', () => {
    expect(comptonE(13)).toBeCloseTo(12.677, 2);
  });
});

describe('ISN optics and flux', () => {
  it('KB diffraction limit 0.88 λq/(L sinθ): ~42 nm at 10 keV, ~17 nm at 25 keV (KBH)', () => {
    expect(kbDiffLimitNm(10, KB.qH, KB.LH)).toBeCloseTo(42.5, 0);
    expect(kbDiffLimitNm(25, KB.qH, KB.LH)).toBeCloseTo(17.0, 0);
    expect(spotMinNm(10)).toBeCloseTo(39, 5);
    expect(spotMinNm(25)).toBeCloseTo(15.6, 5);
  });
  it('coherence-matched BDA 0.44 λz/A ≈ 3.6 µm (V) at 25 keV', () => {
    expect(bdaCoherentUm(25, KB.zV, KB.LV)).toBeCloseTo(3.56, 1);
  });
  it('APS-U focused flux reproduces the FDR Table 4.52 design values', () => {
    expect(rel(focusedFlux('apsu', 10, 39).flux, 3.5e12)).toBeLessThan(0.01);
    expect(rel(focusedFlux('apsu', 25, 15.6).flux, 3.4e11)).toBeLessThan(0.01);
    expect(rel(focusedFlux('apsu', 10, 60).flux, 8.9e12)).toBeLessThan(0.01);
    expect(rel(focusedFlux('apsu', 25, 40).flux, 3.1e12)).toBeLessThan(0.01);
    // a spot below the diffraction limit is not delivered
    const r = focusedFlux('apsu', 10, 20);
    expect(r.limited).toBe(true);
    expect(r.spot).toBeCloseTo(39, 5);
  });
  it('APS-U/APS gain equals the facility coherent-flux ratio at the smallest spot', () => {
    expect(rel(apsuGain(10, 39), sourceCoherentFlux('apsu', 10) / sourceCoherentFlux('aps', 10))).toBeLessThan(1e-9);
    expect(apsuGain(10, 39)).toBeGreaterThan(150);
    expect(apsuGain(10, 39)).toBeLessThan(175);
    expect(apsuGain(25, 15.6)).toBeGreaterThan(330);
    expect(apsuGain(25, 15.6)).toBeLessThan(360);
  });
  it('the gain shrinks monotonically for bigger spots (old beam had many incoherent modes)', () => {
    for (const E of [8, 10, 13, 20, 25]) {
      let prev = Infinity;
      for (let s = spotMinNm(E); s <= 1000; s *= 1.15) {
        const g = apsuGain(E, s);
        expect(g).toBeLessThanOrEqual(prev * 1.0001);
        prev = g;
      }
      expect(apsuGain(E, 1000)).toBeGreaterThan(5);
      expect(apsuGain(E, 1000)).toBeLessThan(40);
    }
  });
  it('stage speed limits the dwell; dose follows Φt/step² · E · μen/ρ', () => {
    expect(effectiveDwell(1e-6, 20)).toBeCloseTo(2e-5, 9);
    expect(effectiveDwell(1e-3, 20)).toBe(1e-3);
    // 1e9 photons in a 20 nm pixel at 10 keV, μen/ρ(NMC) = 90.85 cm²/g → 3.64e10 Gy
    expect(rel(doseGy(1e9, 20, 10), 3.64e10)).toBeLessThan(0.01);
  });
  it('equal-count map time scales with the flux ratio until the 1 mm/s stage limit', () => {
    // 213² px of 15 nm, 100 µs on the old source; a 323× brighter source would need 0.31 µs, but the stage needs 15 µs
    const npx = 213 * 213;
    expect(rel(equalCountsMapTime(npx, 1e-4, 1, 323, 15), npx * 15e-6)).toBeLessThan(1e-9);
    // the other way round there is no limit: 323× longer
    expect(rel(equalCountsMapTime(npx, 1e-4, 323, 1, 15), npx * 1e-4 * 323)).toBeLessThan(1e-9);
  });
  it('formats times without exponents', () => {
    expect(fmtTime(2e-4)).toBe('200 µs');
    expect(fmtTime(5.1)).toBe('5.1 s');
    expect(fmtTime(28 * 60)).toBe('28 min');
    expect(fmtLenNm(12.5)).toBe('12.5 nm');
    expect(fmtLenNm(15.02)).toBe('15 nm');
    expect(fmtLenNm(39)).toBe('39 nm');
    expect(fmtLenNm(1000)).toBe('1 µm');
  });
});

describe('synthetic cathode and scan engine', { timeout: 60000 }, () => {
  const geom = buildGeometry(7);
  const pristine = composition(geom, CELL_STATES[0]);

  it('W ≈ 0.5–1.5 mol % of the slice, concentrated on grain boundaries', () => {
    let w = 0;
    let m = 0;
    let wgb = 0;
    let ngb = 0;
    let win = 0;
    let nin = 0;
    for (let k = 0; k < pristine.mass.length; k++) {
      if (geom.part[k] !== 0 || geom.dsurf[k] < 30) continue;
      w += pristine.w[k];
      m += pristine.mass[k];
      if (geom.dgb[k] < 3) {
        wgb += pristine.w[k] / pristine.mass[k];
        ngb++;
      } else if (geom.dgb[k] > 40) {
        win += pristine.w[k] / pristine.mass[k];
        nin++;
      }
    }
    const molPct = ((w / m) * 97.3 * 100) / 183.84;
    expect(molPct).toBeGreaterThan(0.3);
    expect(molPct).toBeLessThan(1.5);
    expect(wgb / ngb).toBeGreaterThan(10 * (win / nin));
  });

  it('charging opens cracks, preferentially on poorly W-covered boundaries; the damage persists', () => {
    const crackFrac = (st: number) => {
      const c = composition(geom, CELL_STATES[st], allocComposition(geom.n));
      let cr = 0;
      let n = 0;
      let wc = 0;
      let nc = 0;
      for (let k = 0; k < c.mass.length; k++) {
        if (geom.part[k] !== 0 || geom.dsurf[k] <= 0) continue;
        cr += c.crack[k];
        n++;
        if (c.crack[k] > 0.5) {
          wc += geom.wcov[k];
          nc++;
        }
      }
      return { f: cr / n, wcov: nc ? wc / nc : 1 };
    };
    expect(crackFrac(0).f).toBe(0);
    const charged = crackFrac(5);
    expect(charged.f).toBeGreaterThan(0.005);
    expect(crackFrac(7).f).toBeGreaterThan(0); // end of cycle 1: cracks partly close but remain
    expect(crackFrac(9).f).toBeGreaterThan(charged.f);
    // mean W coverage of boundary pixels overall vs cracked ones
    let all = 0;
    let na = 0;
    for (let k = 0; k < geom.dgb.length; k++) {
      if (geom.part[k] === 0 && geom.dgb[k] < 3) {
        all += geom.wcov[k];
        na++;
      }
    }
    expect(charged.wcov).toBeLessThan(0.75 * (all / na));
  });

  it('probe convolution conserves a uniform signal and is Poisson-counted', () => {
    const c = allocComposition(geom.n);
    c.ni.fill(1e-5);
    c.mass.fill(2e-5);
    const pyr = new Pyramid();
    pyr.build(c, geom.n);
    const out = new Float64Array(5);
    for (const sigma of [8, 40, 400]) {
      pyr.sample(FOV_NM / 2, FOV_NM / 2, sigma, out);
      expect(out[0]).toBeCloseTo(1e-5, 9);
    }
    const run = new ScanRun({ E0: 13, spot: 30, nx: 64, photons: 1e8 }, pyr);
    run.finish(pyr, rng(5));
    // expected counts = photons · Ω/4π · m · σ_F
    const expNi = 1e8 * (0.1 / (4 * Math.PI)) * 1e-5 * elementXS('Ni', 13);
    const mid = 32 * 64 + 32;
    expect(rel(run.expected[0][mid], expNi)).toBeLessThan(1e-6);
    let sum = 0;
    for (let k = 0; k < run.total; k++) if (k % 64 > 8 && k % 64 < 56 && k > 64 * 8 && k < 64 * 56) sum += run.maps[0][k];
    const n = 47 * 47;
    expect(rel(sum / n, expNi)).toBeLessThan(0.05);
  });

  it('spectral line shapes are normalised and centred on the line energy', () => {
    const sp = new Spectrum();
    sp.setup(13);
    let tot = 0;
    let m1 = 0;
    for (let c = 0; c < NCH; c++) {
      tot += sp.unit[0][c];
    }
    expect(tot).toBeGreaterThan(0.95);
    expect(tot).toBeLessThan(1.001);
    // centroid of the Ni peak region (Kα dominates)
    let w = 0;
    for (let c = 0; c < NCH; c++) {
      const e = chE(c);
      if (e > 7.2 && e < 7.75) {
        m1 += sp.unit[0][c] * e;
        w += sp.unit[0][c];
      }
    }
    expect(m1 / w).toBeCloseTo(7.472, 2);
    expect(SPEC.e1).toBeGreaterThan(13);
  });
});
