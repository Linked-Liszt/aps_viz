import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MultiTau } from '../src/ui/explainers/xpcs/correlator';
import {
  APSU_GAIN,
  GEOM,
  boxSizeA,
  SOURCES,
  coherentFlux,
  coherentGainEstimate,
  emaResidualContrast,
  exposureFactor,
  fitRingAngle,
  kForFirstHarmonic,
  photonTerms,
  undulatorQ1,
  fitG2,
  fmtTime,
  g2Binned,
  modeContrast,
  qPerPixel,
  sci,
  speckleEstimatorVar,
  speckleSamplingErr,
  equalSnrTimeRatio,
  xpcsSnrModel,
  sphereAmp,
  stokesEinstein,
  waterViscosity,
  xpcsSnr,
} from '../src/ui/explainers/xpcs/physics';
import { XpcsSim, type G2Series } from '../src/ui/explainers/xpcs/sim';
import { fft2d, rng } from '../src/lib/fft';
import { PrunedFFT2 } from '../src/ui/explainers/xpcs/fft2';

describe('xpcs physics helpers', () => {
  it('water viscosity matches reference values (IAPWS: 1.002 mPa·s @20 °C, 0.890 @25 °C, 0.467 @60 °C)', () => {
    expect(waterViscosity(20)).toBeCloseTo(1.002e-3, 4);
    expect(Math.abs(waterViscosity(25) / 0.89e-3 - 1)).toBeLessThan(0.01);
    expect(Math.abs(waterViscosity(60) / 0.4665e-3 - 1)).toBeLessThan(0.02);
  });

  it('Stokes–Einstein: 100 nm sphere in water at 20 °C diffuses at ≈2.14 µm²/s', () => {
    const D = stokesEinstein(20, waterViscosity(20), 100e-9);
    expect(D * 1e12).toBeGreaterThan(2.1);
    expect(D * 1e12).toBeLessThan(2.18);
  });

  it('sphere form factor: F(0)=1 and first zero at qa = 4.4934', () => {
    expect(sphereAmp(0)).toBe(1);
    expect(Math.abs(sphereAmp(4.4934))).toBeLessThan(1e-4);
    expect(sphereAmp(2)).toBeGreaterThan(0);
  });

  it('coherent flux F_c = Bλ²/4 (1e21 brightness at 1 Å → 2.5e12 ph/s)', () => {
    expect(coherentFlux(1e21, 1) / 2.5e12).toBeCloseTo(1, 9);
    // FDR Table 1.1 numbers @ 20 keV: brightness 325e20 → coherent flux ≈ 312e11 within ~15 %
    const fc = coherentFlux(325e20, 12.398 / 20);
    expect(fc / 312e11).toBeGreaterThan(0.85);
    expect(fc / 312e11).toBeLessThan(1.15);
  });

  it('Kim undulator helpers: K for the first harmonic and Q₁(K)', () => {
    // E₁ = 0.9496 E²/(λu[cm](1 + K²/2)): 2.1 cm period at 6 GeV reaches 10 keV with K ≈ 1.12
    expect(kForFirstHarmonic(10, 6, 0.021)).toBeCloseTo(1.1206, 3);
    expect(Number.isNaN(kForFirstHarmonic(20, 6, 0.021))).toBe(true); // above the K = 0 limit (16.3 keV)
    // Q₁(1) = (2/3)(J₀(1/6) − J₁(1/6))² ≈ 0.552; Q₁ → ~0.97 for K ≫ 1
    expect(undulatorQ1(1)).toBeCloseTo(0.5521, 3);
    expect(undulatorQ1(30)).toBeGreaterThan(0.95);
    expect(undulatorQ1(30)).toBeLessThan(1);
  });

  it('Gaussian-source estimate of the APS → APS-U coherent-flux gain at 10 keV supports the documented ≈500×', () => {
    const { sr, srp } = photonTerms(10, 4.7);
    expect(sr * 1e6).toBeCloseTo(2.72, 1); // dossier: σ_r ≈ 2.7 µm, σ_r′ ≈ 3.6 µrad
    expect(srp * 1e6).toBeCloseTo(3.63, 1);
    const est = coherentGainEstimate(10);
    // dossier (derived): coherent fraction ~0.06 % (APS 2019) vs ~9 % (APS-U)
    expect(est.fracAps).toBeGreaterThan(4.5e-4);
    expect(est.fracAps).toBeLessThan(6.5e-4);
    expect(est.fracApsu).toBeGreaterThan(0.08);
    expect(est.fracApsu).toBeLessThan(0.1);
    expect(est.fluxRatio).toBeGreaterThan(3);
    expect(est.fluxRatio).toBeLessThan(5);
    expect(est.gain).toBeGreaterThan(450);
    expect(est.gain).toBeLessThan(800);
    // the station's gain is the documented value and not above the ideal estimate
    expect(APSU_GAIN).toBe(500);
    expect(APSU_GAIN).toBeLessThanOrEqual(est.gain);
    expect(SOURCES.apsu.currentMA / SOURCES.aps.currentMA).toBe(2);
  });

  it('contrast of an incoherent two-mode sum', () => {
    expect(modeContrast([1, 0.6])).toBeCloseTo(1.36 / 2.56, 12);
    expect(modeContrast([1])).toBe(1);
    expect(modeContrast([1, 1, 1, 1])).toBeCloseTo(0.25, 12);
  });

  it('multi-tau binned model reduces to the plain exponential for bin = 1 and small Γ·bin', () => {
    expect(g2Binned(0.5, 0.01, 10, 1)).toBeCloseTo(0.5 * Math.exp(-0.2), 12);
    expect(g2Binned(0.5, 1e-5, 64, 16) / (0.5 * Math.exp(-2e-5 * 64))).toBeCloseTo(1, 4);
    // binning always raises the apparent correlation for an exponential
    expect(g2Binned(0.5, 0.1, 32, 8)).toBeGreaterThan(0.5 * Math.exp(-6.4));
  });

  it('exposure factor: 1 for slow dynamics, ≈ 1/(Γt) for fast', () => {
    expect(exposureFactor(1e-6)).toBeCloseTo(1, 5);
    expect(exposureFactor(50)).toBeCloseTo(1 / 50 - 1 / 5000, 4);
  });

  it('long-exposure residual contrast β/(1 + 2T_e/τ) matches a discrete exponential moving average', () => {
    // frames of 1, EMA weight α = 1/T_e, intensity correlation e^{−2k/τ}: Σ_k Σ_l w_k w_l ρ^{|k−l|} / (Σw)²
    for (const [tauC, tE] of [
      [20, 1000],
      [400, 1000],
      [3000, 1000],
    ]) {
      const a = 1 / tE;
      const rho = Math.exp(-2 / tauC);
      const K = 40 * tE;
      let num = 0;
      let sw = 0;
      // Σ_k w_k [w_k + 2 Σ_{l>k} w_l ρ^{l−k}] with the inner sum in closed form
      for (let k = 0; k < K; k++) {
        const wk = a * Math.pow(1 - a, k);
        sw += wk;
        num += wk * (wk + (2 * wk * (1 - a) * rho) / (1 - (1 - a) * rho));
      }
      const exact = (0.5 * num) / (sw * sw);
      expect(Math.abs(emaResidualContrast(0.5, tauC, tE) / exact - 1)).toBeLessThan(0.02);
    }
    // ≈ βτ/2T_e for τ ≪ T_e (the factor 2 differs from a boxcar of length T, β τ/T)
    expect(emaResidualContrast(0.5, 1, 1000) / (0.5 / 2000)).toBeCloseTo(1, 3);
  });

  it('ring angle is moved into the detector corners only when the ring is wider than the detector', () => {
    const h = 48;
    expect(fitRingAngle(24, -0.62, h)).toBe(-0.62);
    for (const r of [49, 55, 60, 67]) {
      for (const th of [0, 0.3, -0.62, 1.5, 2.5, -2.9, Math.PI]) {
        const t = fitRingAngle(r, th, h);
        expect(Math.abs(r * Math.cos(t))).toBeLessThanOrEqual(h + 1e-9);
        expect(Math.abs(r * Math.sin(t))).toBeLessThanOrEqual(h + 1e-9);
        // stays in the same quadrant (or on its boundary)
        expect(Math.cos(t) * Math.cos(th)).toBeGreaterThanOrEqual(-1e-12);
        expect(Math.sin(t) * Math.sin(th)).toBeGreaterThanOrEqual(-1e-12);
      }
    }
    // already inside the allowed band: unchanged
    expect(fitRingAngle(55, Math.PI / 4, h)).toBeCloseTo(Math.PI / 4, 12);
  });

  it('low-count SNR scales linearly with intensity ⇒ 10⁴× time for 100× less flux', () => {
    const a = xpcsSnr(0.5, 0.01, 1000, 1e4);
    const b = xpcsSnr(0.5, 0.0001, 1000, 1e8);
    expect(a / b).toBeCloseTo(1, 9);
  });

  it('speckle estimator variance: 4 for fully coherent speckle, ≈0.86 at β = 0.53', () => {
    expect(speckleEstimatorVar(1)).toBeCloseTo(4, 12);
    expect(speckleEstimatorVar(0.531)).toBeCloseTo(0.863, 2);
    // Monte-Carlo check of the delta-method value with gamma-distributed (2-mode) intensities, β = 1/2
    const r = rng(9);
    const expo = () => -Math.log(1 - r());
    const M = 400;
    const trials = 2000;
    let s = 0;
    let s2 = 0;
    for (let t = 0; t < trials; t++) {
      let a = 0;
      let b = 0;
      for (let i = 0; i < M; i++) {
        const x = (expo() + expo()) / 2; // gamma(k = 2): contrast 1/2
        a += x * x;
        b += x;
      }
      const R = a / M / ((b / M) * (b / M));
      s += R;
      s2 += R * R;
    }
    const varR = (s2 / trials - (s / trials) ** 2) * M;
    expect(Math.abs(varR / speckleEstimatorVar(0.5) - 1)).toBeLessThan(0.15);
  });

  it('SNR model: shot-noise limit ∝ flux, speckle limit flux-independent, time ratio between 1 and G²', () => {
    const base = { beta: 0.53, decay: 0.8, lEff: 10, nPix: 450, nFrames: 3000, gammaFrame: 0.014, cohAreaPx: 8.6 };
    const bright = xpcsSnrModel({ ...base, nPerPixFrame: 0.7 });
    const dim = xpcsSnrModel({ ...base, nPerPixFrame: 0.7 / 500 });
    expect(bright.shot / dim.shot).toBeCloseTo(500, 6);
    expect(bright.speckle).toBe(dim.speckle);
    expect(bright.snr).toBeLessThan(Math.min(bright.shot, bright.speckle));
    // values validated against the simulation's run-to-run scatter (12 seeds): APS-U ≈ 23, APS ≈ 2–3
    expect(bright.snr).toBeGreaterThan(18);
    expect(bright.snr).toBeLessThan(30);
    expect(dim.snr).toBeGreaterThan(1.2);
    expect(dim.snr).toBeLessThan(3);
    // the error-bar floor is the same speckle-sampling term: SNR_spk = β̄ / σ_spk, and σ_spk ∝ 1/√(1 + 1.1 N_f Γ)
    const sig = speckleSamplingErr(base.beta, base.nPix, base.cohAreaPx, base.nFrames, base.gammaFrame);
    expect((base.beta * base.decay) / sig).toBeCloseTo(bright.speckle, 9);
    const sig4 = speckleSamplingErr(base.beta, base.nPix, base.cohAreaPx, 4 * base.nFrames, base.gammaFrame);
    expect(sig / sig4).toBeGreaterThan(1.9);
    expect(sig / sig4).toBeLessThan(2.01);
    const ratio = equalSnrTimeRatio(500, bright.shot, bright.speckle);
    expect(ratio).toBeGreaterThan(30);
    expect(ratio).toBeLessThan(500 * 500);
    expect(equalSnrTimeRatio(500, 1e-3, 10)).toBeCloseTo(250000, -2); // photon-starved: G²
    expect(equalSnrTimeRatio(500, 1e6, 10)).toBeLessThan(1.1); // speckle-limited for both
  });

  it('fitG2 recovers β and Γ from clean data', () => {
    const tau = Float64Array.from({ length: 40 }, (_, i) => Math.pow(10, i / 10));
    const g = tau.map((t) => 1 + 0.4 * Math.exp(-2 * 0.03 * t));
    const f = fitG2(tau, g, null, tau.length, 1e-4, 10);
    expect(f.beta).toBeCloseTo(0.4, 4);
    expect(f.gamma).toBeCloseTo(0.03, 5);
  });

  it('geometry is self-consistent: L = λR/p and speckle oversampled', () => {
    const lam = 12.398419843 / GEOM.energyKeV; // Å
    expect(boxSizeA() / ((lam * GEOM.detDistM) / GEOM.pixelM)).toBeCloseTo(1, 9);
    // speckle size λR/w in pixels should be > 2 (Nyquist) for full contrast
    const speckPx = (lam * 1e-10 * GEOM.detDistM) / (GEOM.beamFwhmUm * 1e-6) / GEOM.pixelM;
    expect(speckPx).toBeGreaterThan(2);
    expect(qPerPixel()).toBeGreaterThan(4e-5);
    expect(qPerPixel()).toBeLessThan(5e-5);
    expect(APSU_GAIN).toBeGreaterThanOrEqual(100);
  });

  it('formatters', () => {
    expect(sci(1.14e-3)).toBe('1.1×10⁻³');
    expect(fmtTime(3.6e-3)).toBe('3.6 ms');
    expect(fmtTime(52e-6)).toBe('52 µs');
  });
});

describe('pruned FFT', () => {
  it('matches the shared fft2d on the transformed columns', () => {
    const n = 32;
    const r = rng(5);
    const re = new Float32Array(n * n);
    const im = new Float32Array(n * n);
    for (let y = 4; y <= 27; y++) for (let x = 0; x < n; x++) { re[y * n + x] = r() - 0.5; im[y * n + x] = r() - 0.5; }
    const re2 = re.slice();
    const im2 = im.slice();
    fft2d(re2, im2, n);
    const cols = Int32Array.from([0, 1, 2, 5, 30, 31]);
    new PrunedFFT2(n).forward(re, im, 4, 27, cols);
    for (const c of cols) for (let y = 0; y < n; y++) {
      expect(re[y * n + c]).toBeCloseTo(re2[y * n + c], 3);
      expect(im[y * n + c]).toBeCloseTo(im2[y * n + c], 3);
    }
  });
});

describe('multi-tau correlator', () => {
  it('reproduces g2 = 1 + e^{-2Γτ} (binned model) for synthetic Gaussian speckle', () => {
    const npix = 400;
    const frames = 6000;
    const gam = 0.05; // per frame (field correlation e^{-Γ})
    const rho = Math.exp(-gam);
    const sd = Math.sqrt(1 - rho * rho);
    const r = rng(11);
    const gauss = () => {
      let u = 0;
      while (u === 0) u = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
    };
    const ar = new Float64Array(npix).map(() => gauss() / Math.SQRT2);
    const ai = new Float64Array(npix).map(() => gauss() / Math.SQRT2);
    const group = new Int32Array(npix); // all in one group
    const mt = new MultiTau(group, 1, 10);
    const x = new Float32Array(npix);
    for (let t = 0; t < frames; t++) {
      for (let p = 0; p < npix; p++) {
        ar[p] = rho * ar[p] + (sd * gauss()) / Math.SQRT2;
        ai[p] = rho * ai[p] + (sd * gauss()) / Math.SQRT2;
        x[p] = ar[p] * ar[p] + ai[p] * ai[p];
      }
      mt.push(x);
    }
    const out = new Float64Array(4);
    let checked = 0;
    for (let j = 0; j < mt.nLags; j++) {
      const lag = mt.lagFrames[j];
      if (lag > 60) break;
      expect(mt.sums([0], j, out)).toBe(true);
      const g2 = (out[0] * out[3]) / (out[1] * out[2]);
      const th = 1 + g2Binned(1, gam, lag, mt.lagBin[j]);
      expect(Math.abs(g2 - th)).toBeLessThan(0.05);
      checked++;
    }
    expect(checked).toBeGreaterThan(15);
  });
});

describe('XPCS simulation end-to-end', () => {
  it('measured g2 on a ring follows 1 + β exp(−2 D q² τ) (Stokes–Einstein D, β from the mode sum)', () => {
    const sim = new XpcsSim(3);
    // choose a sample so that Γ ≈ 0.06 per frame at ring radius 22 px
    sim.setSample(60, 40);
    const r0 = 22;
    const gFrame = sim.gammaAt(r0) * GEOM.frameS;
    expect(gFrame).toBeGreaterThan(0.02);
    expect(gFrame).toBeLessThan(0.2);
    const t0 = performance.now();
    const frames = 2400;
    for (let i = 0; i < frames; i++) sim.step();
    const msPerStep = (performance.now() - t0) / frames;
    console.log(`xpcs sim: ${msPerStep.toFixed(2)} ms/step, Γ=${gFrame.toFixed(3)}/frame, β_th=${sim.beta.toFixed(3)}`);
    const cap = 80;
    const s: G2Series = { n: 0, tau: new Float64Array(cap), g2: new Float64Array(cap), err: new Float64Array(cap), bin: new Float64Array(cap) };
    sim.g2Ring(1, r0, 1, s);
    expect(s.n).toBeGreaterThan(20);
    // fit using lags up to ~4/Γ
    let n = 0;
    while (n < s.n && s.tau[n] * gFrame < 4) n++;
    const fit = fitG2(s.tau, s.g2, s.err, n, gFrame / 10, gFrame * 10);
    console.log(`fit Γ=${fit.gamma.toFixed(4)} (th ${gFrame.toFixed(4)}), β=${fit.beta.toFixed(3)} (th ${sim.beta.toFixed(3)})`);
    expect(Math.abs(fit.gamma / gFrame - 1)).toBeLessThan(0.15);
    expect(Math.abs(fit.beta / sim.beta - 1)).toBeLessThan(0.15);
    // APS (100× fewer photons) is far noisier in the same time
    const a: G2Series = { n: 0, tau: new Float64Array(cap), g2: new Float64Array(cap), err: new Float64Array(cap), bin: new Float64Array(cap) };
    sim.g2Ring(0, r0, 1, a);
    const errU = s.err[0];
    const errA = a.n ? a.err[0] : Infinity;
    console.log(`σ(g2) at first lag: APS-U ${errU.toFixed(3)}, APS ${errA.toFixed(3)}`);
    expect(errA / errU).toBeGreaterThan(5);
    // sector-scatter SNR of the short-delay contrast
    const tauMax = 0.25 / gFrame;
    const su = sim.contrastSnr(1, r0, 1, tauMax);
    const sa = sim.contrastSnr(0, r0, 1, tauMax);
    // photon-starved APS: compare with the shot-noise formula β̄ n̄ √(N_pix N_f L)/√(1+β) (lags independent)
    let L = 0;
    let decay = 0;
    for (let j = 0; j < sim.corr[0].nLags && sim.corr[0].lagFrames[j] <= Math.max(1, tauMax); j++) {
      L++;
      decay += Math.exp(-2 * gFrame * sim.corr[0].lagFrames[j]);
    }
    const nA = sim.ringMeanCounts(0, r0, 1);
    const snrShot = (sim.beta * (decay / L) * nA * Math.sqrt(sim.ringPixels(r0, 1) * frames * L)) / Math.sqrt(1 + sim.beta);
    console.log(`contrast SNR: APS-U ${su.snr.toFixed(1)} (contrast ${su.contrast.toFixed(3)}), APS ${sa.snr.toFixed(2)} (shot-noise formula ${snrShot.toFixed(2)}, n̄=${nA.toExponential(2)})`);
    expect(Math.abs(su.contrast / (sim.beta * (decay / L)) - 1)).toBeLessThan(0.2);
    expect(su.snr).toBeGreaterThan(4 * Math.max(sa.snr, 0.5));
    expect(sa.snr).toBeLessThan(3 * snrShot + 1);
    // the displayed (model) SNR: speckle-limited APS-U, photon-starved APS; model shot term ≈ the formula above
    const mu = sim.snrModel(1, r0, 1, tauMax);
    const ma = sim.snrModel(0, r0, 1, tauMax);
    console.log(`model SNR: APS-U ${mu.snr.toFixed(1)} (shot ${mu.shot.toFixed(0)}, speckle ${mu.speckle.toFixed(1)}), APS ${ma.snr.toFixed(2)}; A_c = ${sim.cohAreaPx.toFixed(2)} px`);
    expect(sim.cohAreaPx).toBeGreaterThan(6);
    expect(sim.cohAreaPx).toBeLessThan(12);
    expect(mu.speckle).toBeLessThan(mu.shot);
    expect(ma.shot).toBeLessThan(ma.speckle);
    expect(mu.snr / ma.snr).toBeGreaterThan(5);
    // the sector estimator over-reads in the speckle-limited regime (shared speckles), never under-reads by much
    expect(su.snr / mu.snr).toBeGreaterThan(0.7);
    expect(su.snr / mu.snr).toBeLessThan(3);
    // error-bar floor: never below the speckle-sampling error, and the fit is still unbiased with the floor applied
    const se = sim.speckleErr(r0, 1);
    sim.floorErr(s, r0, 1);
    for (let i = 0; i < s.n; i++) expect(s.err[i]).toBeGreaterThanOrEqual(se);
    const fit2 = fitG2(s.tau, s.g2, s.err, n, gFrame / 10, gFrame * 10);
    expect(Math.abs(fit2.gamma / gFrame - 1)).toBeLessThan(0.15);
  }, 60000);
});

describe('one presentation for every reader', () => {
  it('the station never reads the retired Visitor/Specialist depth', () => {
    const src = ['xpcs.ts', 'xpcs/views.ts'].map((f) => readFileSync(join(__dirname, '../src/ui/explainers', f), 'utf8')).join('\n');
    expect(src).not.toMatch(/ctx\.depth|station\.depth|setDepth|'specialist'|data-depth|app\/store/);
  });
});
