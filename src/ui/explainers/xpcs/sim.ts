/**
 * XPCS station — simulation core (DOM-free, so the unit tests can run it headless).
 *
 * Model (all approximations deliberate and listed):
 *  1. N identical spheres (radius a) in water, dilute and non-interacting (S(q) = 1), undergoing free
 *     Brownian motion with the Stokes–Einstein D. Only the motion perpendicular to the beam is simulated:
 *     in small-angle geometry q is ⟂ to the beam (q_z ≈ q²/2k ≈ 10⁻⁷ Å⁻¹ here), so the speckle phase q·r
 *     depends only on the projected 2-D positions → the 2-D simulation is exact for the projection.
 *     Each step: Δx, Δy ~ N(0, 2 D t_f). Periodic box; the beam is ~0 at the box edge so wraps are invisible.
 *  2. Partially coherent illumination = two mutually incoherent coherent modes (Hermite–Gauss HG00 and HG10
 *     of a Gaussian beam with intensity FWHM w = 3 µm), weights 1 : 0.6 → speckle contrast
 *     β = Σw²/(Σw)² = 0.53. Both mode fields are real, so ONE complex FFT of (ρ₀ + iρ₁) yields both
 *     transforms (Hermitian split: A₀(q) = [C(q) + C*(−q)]/2, A₁(q) = [C(q) − C*(−q)]/2i).
 *  3. Far field (Fraunhofer, kinematic): A_m(q) = F(qa) Σ_j ψ_m(r_j) e^{−iq·r_j}. Particles are deposited on
 *     the 128² grid with a normalised Gaussian kernel (σ = 1 grid px) which is divided out again in q
 *     (K̂ = e^{−σ²q²/2}). This keeps sub-pixel phases exact; aliasing ≤ e^{−2πσ²(π−|q_x|)} ≈ 0.7 % in
 *     amplitude inside the displayed 97×97 crop (|q_x|,|q_y| ≤ 0.75 π/px).
 *  4. Detector: 75 µm pixels at 8 m, 10 keV ⇒ Δq = 4.75×10⁻⁴ nm⁻¹ per pixel; L = λR/p = 13.2 µm box;
 *     speckle size λR/w ≈ 4 px (oversampled, as required for full contrast). Mean photon count per pixel per
 *     frame = n₀ P(qa) I/⟨I⟩ (n₀ = 1 for APS-U, ÷APSU_GAIN = ÷500 for APS), then Poisson noise. Same ideal
 *     intensity for both sources; the APS counts are a random 1/500 subset of the APS-U photons (Poisson
 *     thinning), so each source's counts are exactly Poisson with its own mean, though the two are not
 *     independent of each other → an apples-to-apples comparison in the same time.
 *     Frame time 50 µs (20 kHz). Each frame is an instantaneous snapshot (exposure blurring neglected — it
 *     only matters where τ ≲ 3 frames, which the UI flags).
 *  5. Normalisation uses the *expected* number of illuminated particles, so the slow number fluctuations in
 *     the 3 µm spot (a real small-beam XPCS effect) are kept: the total scattered intensity varies by
 *     1/√(4πρσ²) ≈ 9 % rms between realisations and drifts over the beam-crossing time σ²/D ≈ 0.8 s (100 nm,
 *     20 °C). In runs longer than that it adds a ≤ 1/(4πρσ²) ≈ 0.9 % slowly decaying term to g2; shorter runs
 *     mostly normalise it away (symmetric normalisation). ρ = particles per grid px², σ = beam intensity σ.
 */
import { PrunedFFT2 } from './fft2';
import { MultiTau } from './correlator';
import { APSU_GAIN, GEOM, boxSizeA, modeContrast, qPerPixel, speckleSamplingErr, sphereP, stokesEinstein, waterViscosity, xpcsSnrModel } from './physics';

export const N_SECTORS = 8;
const EINV = Math.exp(-1);
/** number of frames kept in the detector display rolling sum */
export const DISP_FRAMES = 8;
export const TRACE_LEN = 360;
/** long-exposure averaging window (frames): 1000 × 50 µs = 50 ms */
export const LONG_FRAMES = 1000;

export type SourceIx = 0 | 1; // 0 = APS (pre-2023), 1 = APS-U

export interface G2Series {
  n: number;
  tau: Float64Array; // frames
  g2: Float64Array;
  err: Float64Array;
  bin: Float64Array;
}

export class XpcsSim {
  readonly n = GEOM.nGrid;
  readonly nd = GEOM.nDet;
  readonly half = (GEOM.nDet - 1) / 2;
  readonly N = GEOM.nParticles;
  readonly dqA = qPerPixel();
  readonly boxA = boxSizeA();
  /** grid pixel (m) */
  readonly dxM = boxSizeA() * 1e-10 / GEOM.nGrid;
  /** beam intensity σ in grid px */
  readonly sBeam = (GEOM.beamFwhmUm * 1e-6) / 2.3548 / ((boxSizeA() * 1e-10) / GEOM.nGrid);
  readonly beta = modeContrast(GEOM.modeWeights);
  readonly nBins: number;

  // particles (grid px; wrapped) and unwrapped copies for trails
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly ux: Float64Array;
  readonly uy: Float64Array;

  radiusNm = 100;
  tempC = 20;
  /** diffusion coefficient (m²/s) */
  D = 0;
  private stepPx = 0;

  private re: Float32Array;
  private im: Float32Array;
  private fidx: Int32Array;
  private nidx: Int32Array;
  /** count-scale per detector pixel: n0 P(q) / (Σw · S_exp · K̂²); 0 under the beamstop */
  private fac: Float32Array;
  /** radius (detector px) of every detector pixel */
  readonly rad: Float32Array;
  readonly mask: Uint8Array; // 1 = analysed (outside beamstop)
  /** ideal APS-U mean count per pixel for the current frame */
  readonly ideal: Float32Array;
  /** current-frame counts per source, rolling display sums, long exposure (EMA, per frame) */
  readonly counts: [Uint16Array, Uint16Array];
  readonly disp: [Float32Array, Float32Array];
  private ringBuf: [Uint16Array, Uint16Array];
  private ringSlot = 0;
  readonly ema: [Float32Array, Float32Array];
  emaFrames = 0;
  /** update the long-exposure average (only needed while that view is shown) */
  trackLong = false;

  // analysed pixels
  readonly anaIdx: Int32Array;
  private anaVals: [Float32Array, Float32Array];
  readonly corr: [MultiTau, MultiTau];

  // single-pixel trace (the pixel under the ring handle)
  probe = 0;
  readonly traceIdeal = new Float32Array(TRACE_LEN);
  readonly traceCounts: [Float32Array, Float32Array] = [new Float32Array(TRACE_LEN), new Float32Array(TRACE_LEN)];
  traceHead = 0;
  traceLen = 0;

  /** total frames simulated since construction */
  totalFrames = 0;
  private st = 1;
  private gSpare = NaN;
  private wx = new Float64Array(7);
  private wy = new Float64Array(7);
  private fft: PrunedFFT2;
  private cols: Int32Array;

  constructor(seed = 7) {
    const n = this.n;
    const nd = this.nd;
    this.st = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) | 0;
    this.px = new Float64Array(this.N);
    this.py = new Float64Array(this.N);
    this.ux = new Float64Array(this.N);
    this.uy = new Float64Array(this.N);
    for (let j = 0; j < this.N; j++) {
      this.px[j] = this.ux[j] = this.u() * n;
      this.py[j] = this.uy[j] = this.u() * n;
    }
    this.fft = new PrunedFFT2(n);
    this.cols = Int32Array.from({ length: nd }, (_, i) => (i - (nd - 1) / 2 + n) % n);
    this.re = new Float32Array(n * n);
    this.im = new Float32Array(n * n);
    const np = nd * nd;
    this.fidx = new Int32Array(np);
    this.nidx = new Int32Array(np);
    this.rad = new Float32Array(np);
    this.mask = new Uint8Array(np);
    this.fac = new Float32Array(np);
    this.ideal = new Float32Array(np);
    this.counts = [new Uint16Array(np), new Uint16Array(np)];
    this.disp = [new Float32Array(np), new Float32Array(np)];
    this.ringBuf = [new Uint16Array(np * DISP_FRAMES), new Uint16Array(np * DISP_FRAMES)];
    this.ema = [new Float32Array(np), new Float32Array(np)];
    const h = this.half;
    const ana: number[] = [];
    let maxBin = 0;
    for (let v = 0; v < nd; v++) {
      for (let u = 0; u < nd; u++) {
        const p = v * nd + u;
        const fx = u - h;
        const fy = v - h;
        this.fidx[p] = ((fy + n) % n) * n + ((fx + n) % n);
        this.nidx[p] = ((-fy + n) % n) * n + ((-fx + n) % n);
        const r = Math.hypot(fx, fy);
        this.rad[p] = r;
        if (r > GEOM.beamstopPx) {
          this.mask[p] = 1;
          ana.push(p);
          maxBin = Math.max(maxBin, Math.round(r));
        }
      }
    }
    this.nBins = maxBin + 1;
    this.anaIdx = Int32Array.from(ana);
    const grp = new Int32Array(ana.length);
    for (let i = 0; i < ana.length; i++) {
      const p = ana[i];
      const fx = (p % nd) - h;
      const fy = Math.floor(p / nd) - h;
      let ang = Math.atan2(fy, fx);
      if (ang < 0) ang += Math.PI; // Friedel partners share a sector
      if (ang >= Math.PI) ang -= Math.PI;
      const sec = Math.min(N_SECTORS - 1, Math.floor((ang / Math.PI) * N_SECTORS));
      grp[i] = Math.round(this.rad[p]) * N_SECTORS + sec;
    }
    const ngroups = this.nBins * N_SECTORS;
    this.corr = [new MultiTau(grp, ngroups), new MultiTau(grp, ngroups)];
    this.anaVals = [new Float32Array(ana.length), new Float32Array(ana.length)];
    this.probe = Math.round(h) * nd + Math.round(h + 24);
    this.setSample(this.radiusNm, this.tempC);
  }

  /** q (Å⁻¹) of a radius in detector pixels */
  qOf(rPx: number): number {
    return rPx * this.dqA;
  }

  /** Γ = D q² (1/s) at radius rPx */
  gammaAt(rPx: number): number {
    const q = this.qOf(rPx) * 1e10; // 1/m
    return this.D * q * q;
  }

  /** Change particle radius / temperature (does not reset the correlators — the caller decides). */
  setSample(radiusNm: number, tempC: number): void {
    this.radiusNm = radiusNm;
    this.tempC = tempC;
    this.D = stokesEinstein(tempC, waterViscosity(tempC), radiusNm * 1e-9);
    this.stepPx = Math.sqrt(2 * this.D * GEOM.frameS) / this.dxM;
    // count scale per pixel
    const n = this.n;
    const s = this.sBeam;
    const sExp = (this.N * 2 * Math.PI * s * s) / (n * n); // ⟨Σ_j |ψ_m(r_j)|²⟩ for either mode
    const wsum = GEOM.modeWeights[0] + GEOM.modeWeights[1];
    const aA = radiusNm * 10; // Å
    const sig = 1; // kernel σ (grid px)
    for (let p = 0; p < this.fac.length; p++) {
      if (!this.mask[p]) {
        this.fac[p] = 0;
        continue;
      }
      const r = this.rad[p];
      const qrad = (2 * Math.PI * r) / n; // rad per grid px
      const kh2 = Math.exp(-sig * sig * qrad * qrad); // K̂²
      this.fac[p] = (GEOM.n0U * sphereP(this.qOf(r) * aA)) / (wsum * sExp * kh2);
    }
  }

  resetMeasurement(): void {
    this.corr[0].reset();
    this.corr[1].reset();
    this.rbKey = '';
  }

  private gauss(): number {
    if (!Number.isNaN(this.gSpare)) {
      const g = this.gSpare;
      this.gSpare = NaN;
      return g;
    }
    let u = 0;
    while (u === 0) u = this.u();
    const v = this.u();
    const m = Math.sqrt(-2 * Math.log(u));
    this.gSpare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  }

  /** mulberry32 uniform in [0, 1) (same generator as lib/fft rng, inlined for speed) */
  private u(): number {
    const a = (this.st = (this.st + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Poisson deviate: sequential inversion (exact) below 30, normal approximation above. */
  private poisson(lam: number): number {
    if (lam <= 0) return 0;
    if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * this.gauss()));
    let p = Math.exp(-lam);
    let F = p;
    const u = this.u();
    let k = 0;
    while (u > F && k < 120) {
      k++;
      p *= lam / k;
      F += p;
    }
    return k;
  }

  /** Advance one detector frame. */
  step(): void {
    const n = this.n;
    const N = this.N;
    const sp = this.stepPx;
    const px = this.px;
    const py = this.py;
    // 1. Brownian motion
    for (let j = 0; j < N; j++) {
      const dx = sp * this.gauss();
      const dy = sp * this.gauss();
      this.ux[j] += dx;
      this.uy[j] += dy;
      let x = px[j] + dx;
      let y = py[j] + dy;
      if (x < 0) x += n;
      else if (x >= n) x -= n;
      if (y < 0) y += n;
      else if (y >= n) y -= n;
      px[j] = x;
      py[j] = y;
    }
    // 2. deposit both (real) mode fields: re ← ρ0 (HG00), im ← ρ1 (HG10)
    const re = this.re;
    const im = this.im;
    re.fill(0);
    im.fill(0);
    const c = n / 2;
    const s = this.sBeam;
    const inv4s2 = 1 / (4 * s * s);
    const norm = 1 / (2 * Math.PI); // kernel σ = 1
    const wx = this.wx;
    const wy = this.wy;
    const cull = 27.6 * s * s; // |ψ0| < 1e-3
    const mask = n - 1;
    for (let j = 0; j < N; j++) {
      const X = px[j];
      const Y = py[j];
      const rx = X - c;
      const ry = Y - c;
      const r2 = rx * rx + ry * ry;
      if (r2 > cull) continue;
      const psi0 = Math.exp(-r2 * inv4s2) * norm;
      const a0 = psi0;
      const a1 = (rx / s) * psi0;
      const ix = Math.floor(X);
      const iy = Math.floor(Y);
      const fx = X - ix;
      const fy = Y - iy;
      // Gaussian weights e^{−d²/2} at d = i − 3 − f by recurrence: w_{i+1} = w_i · e^{−d_i − 1/2}
      let ax = Math.exp(-0.5 * (3 + fx) * (3 + fx));
      let rx2 = Math.exp(2.5 + fx);
      let ay = Math.exp(-0.5 * (3 + fy) * (3 + fy));
      let ry2 = Math.exp(2.5 + fy);
      for (let i = 0; i < 7; i++) {
        wx[i] = ax;
        wy[i] = ay;
        ax *= rx2;
        ay *= ry2;
        rx2 *= EINV;
        ry2 *= EINV;
      }
      for (let jj = 0; jj < 7; jj++) {
        const row = ((iy + jj - 3) & mask) * n;
        const w0 = wy[jj];
        const b0 = a0 * w0;
        const b1 = a1 * w0;
        for (let i = 0; i < 7; i++) {
          const idx = row + ((ix + i - 3) & mask);
          const w = wx[i];
          re[idx] += b0 * w;
          im[idx] += b1 * w;
        }
      }
    }
    // 3. far field
    this.fft.forward(re, im, 0, n - 1, this.cols);
    // 4. intensities, photons, display buffers
    const W0 = GEOM.modeWeights[0];
    const W1 = GEOM.modeWeights[1];
    const fac = this.fac;
    const fidx = this.fidx;
    const nidx = this.nidx;
    const ideal = this.ideal;
    const [cA, cU] = this.counts;
    const [dA, dU] = this.disp;
    const [rA, rU] = this.ringBuf;
    const [eA, eU] = this.ema;
    const slot = this.ringSlot;
    const np = ideal.length;
    const invG = 1 / APSU_GAIN;
    const long = this.trackLong;
    if (long) this.emaFrames++;
    const alpha = Math.max(1 / LONG_FRAMES, 1 / Math.max(1, this.emaFrames));
    for (let p = 0; p < np; p++) {
      const f = fac[p];
      if (f === 0) {
        ideal[p] = 0;
        cA[p] = cU[p] = 0;
        continue;
      }
      const k = fidx[p];
      const km = nidx[p];
      const a = re[k];
      const b = im[k];
      const cc = re[km];
      const d = im[km];
      const s0 = a + cc;
      const t0 = b - d;
      const s1 = a - cc;
      const t1 = b + d;
      const lam = 0.25 * f * (W0 * (s0 * s0 + t0 * t0) + W1 * (s1 * s1 + t1 * t1));
      ideal[p] = lam;
      const nU = this.poisson(lam);
      // APS = the same frame with 1/GAIN of the photons: Poisson thinning gives exactly Poisson(λ/GAIN)
      let nA = 0;
      for (let i = 0; i < nU; i++) if (this.u() < invG) nA++;
      cU[p] = nU;
      cA[p] = nA;
      const ri = slot * np + p;
      dU[p] += nU - rU[ri];
      dA[p] += nA - rA[ri];
      rU[ri] = nU;
      rA[ri] = nA;
      if (long) {
        eU[p] += (nU - eU[p]) * alpha;
        eA[p] += (nA - eA[p]) * alpha;
      }
    }
    this.ringSlot = (slot + 1) % DISP_FRAMES;
    // 5. correlators
    const ana = this.anaIdx;
    const vA = this.anaVals[0];
    const vU = this.anaVals[1];
    for (let i = 0; i < ana.length; i++) {
      vA[i] = cA[ana[i]];
      vU[i] = cU[ana[i]];
    }
    this.corr[0].push(vA);
    this.corr[1].push(vU);
    // 6. single-pixel trace
    const h = this.traceHead;
    this.traceIdeal[h] = ideal[this.probe];
    this.traceCounts[0][h] = cA[this.probe];
    this.traceCounts[1][h] = cU[this.probe];
    this.traceHead = (h + 1) % TRACE_LEN;
    this.traceLen = Math.min(TRACE_LEN, this.traceLen + 1);
    this.totalFrames++;
  }

  /** Clear the long-exposure average (e.g. after the sample changed). */
  resetLongExposure(): void {
    this.ema[0].fill(0);
    this.ema[1].fill(0);
    this.emaFrames = 0;
  }

  private ringCache = new Map<string, Int32Array>();
  /** Group ids of the ring [r0 − hw, r0 + hw] (radial bins), optionally a single sector. */
  ringGroups(r0: number, hw = 1, sector = -1): Int32Array {
    const key = `${Math.round(r0 - hw)}:${Math.round(r0 + hw)}:${sector}`;
    const hit = this.ringCache.get(key);
    if (hit) return hit;
    const res = this.buildRingGroups(r0, hw, sector);
    if (this.ringCache.size > 512) this.ringCache.clear();
    this.ringCache.set(key, res);
    return res;
  }

  private buildRingGroups(r0: number, hw: number, sector: number): Int32Array {
    const out: number[] = [];
    for (let b = Math.max(0, Math.round(r0 - hw)); b <= Math.min(this.nBins - 1, Math.round(r0 + hw)); b++) {
      if (sector >= 0) out.push(b * N_SECTORS + sector);
      else for (let s = 0; s < N_SECTORS; s++) out.push(b * N_SECTORS + s);
    }
    return Int32Array.from(out);
  }

  /**
   * g2 on a ring for one source: pooled estimate + error from the scatter between the 8 azimuthal sectors
   * (Friedel partners share a sector so sectors are independent), floored by the photon-coincidence shot
   * noise σ/g2 ≈ 1/√(Σ I I′). Lags with fewer than `minPairs` frame pairs are skipped.
   */
  g2Ring(src: SourceIx, r0: number, hw: number, out: G2Series, minPairs = 12): G2Series {
    const mt = this.corr[src];
    const groups = this.readRing(src, r0, hw);
    const nL = mt.nLags;
    const G = this.rbG;
    const IP = this.rbP;
    const IF = this.rbF;
    const secG = this.secG;
    const secP = this.secP;
    const secF = this.secF;
    const secN = this.secN;
    let m = 0;
    for (let j = 0; j < nL; j++) {
      const M = mt.pairs(j);
      if (M < minPairs) continue;
      secG.fill(0);
      secP.fill(0);
      secF.fill(0);
      secN.fill(0);
      for (let gi = 0; gi < groups.length; gi++) {
        const s = gi % N_SECTORS;
        const o = gi * nL + j;
        secG[s] += G[o];
        secP[s] += IP[o];
        secF[s] += IF[o];
        secN[s] += mt.gCount[groups[gi]];
      }
      let gA = 0;
      let pA = 0;
      let fA = 0;
      let nA = 0;
      let sm = 0;
      let sm2 = 0;
      let ns = 0;
      for (let s = 0; s < N_SECTORS; s++) {
        gA += secG[s];
        pA += secP[s];
        fA += secF[s];
        nA += secN[s];
        if (secP[s] > 0 && secF[s] > 0 && secN[s] > 0) {
          const gs = (secG[s] * M * secN[s]) / (secP[s] * secF[s]);
          sm += gs;
          sm2 += gs * gs;
          ns++;
        }
      }
      if (pA <= 0 || fA <= 0) continue;
      const g2 = (gA * M * nA) / (pA * fA);
      const shotErr = g2 / Math.sqrt(Math.max(1, gA));
      let err = shotErr;
      if (ns >= 4) {
        const mean = sm / ns;
        const v = Math.max(0, sm2 / ns - mean * mean);
        err = Math.max(shotErr, Math.sqrt(v / (ns - 1)));
      }
      out.tau[m] = mt.lagFrames[j];
      out.bin[m] = mt.lagBin[j];
      out.g2[m] = g2;
      out.err[m] = err;
      m++;
    }
    out.n = m;
    return out;
  }

  /**
   * Signal-to-noise of the short-delay contrast (g2 − 1 for 0 < τ ≤ tauMax frames) on a ring, measured the
   * way an experimenter would: the lag-pooled contrast is estimated separately in each of the 8 independent
   * azimuthal sectors, and SNR = mean / standard error across sectors.
   * Pooling lags *inside* a sector before taking the scatter matters: in the photon-starved regime the lags
   * are nearly independent (coincidence shot noise), but when there are many photons per speckle per τ the
   * lags all see the same speckle realisations, so treating them as independent would overstate the SNR
   * by up to √(number of lags).
   * Caveat: neighbouring sectors share speckles at their borders, so in the speckle-limited regime this still
   * overestimates the true run-to-run SNR (≈1.7× at the defaults, checked over 12 seeds). The station uses it
   * only to decide whether a fit is meaningful; the displayed SNR comes from snrModel().
   */
  contrastSnr(src: SourceIx, r0: number, hw: number, tauMaxFrames: number, minPairs = 12): { snr: number; contrast: number } {
    const mt = this.corr[src];
    const groups = this.readRing(src, r0, hw);
    const nL = mt.nLags;
    const num = this.secG;
    const den = this.secP;
    const npx = this.secN;
    num.fill(0);
    den.fill(0);
    npx.fill(0);
    for (let gi = 0; gi < groups.length; gi++) npx[gi % N_SECTORS] += mt.gCount[groups[gi]];
    let used = 0;
    for (let j = 0; j < nL; j++) {
      if (mt.lagFrames[j] > Math.max(1, tauMaxFrames)) break;
      const M = mt.pairs(j);
      if (M < minPairs) continue;
      used++;
      // per sector: g2_j = G·M·N / (IP·IF); pool lags as Σ G·M·N / Σ IP·IF (ratio of sums: stable at low counts)
      const gS = this.secF; // per-lag sector accumulators (secF is free here)
      const pS = this.secTmpP;
      const fS = this.secTmpF;
      gS.fill(0);
      pS.fill(0);
      fS.fill(0);
      for (let gi = 0; gi < groups.length; gi++) {
        const s = gi % N_SECTORS;
        const o = gi * nL + j;
        gS[s] += this.rbG[o];
        pS[s] += this.rbP[o];
        fS[s] += this.rbF[o];
      }
      for (let s = 0; s < N_SECTORS; s++) {
        num[s] += gS[s] * M * npx[s];
        den[s] += pS[s] * fS[s];
      }
    }
    if (!used) return { snr: 0, contrast: NaN };
    let sm = 0;
    let sm2 = 0;
    let ns = 0;
    let numAll = 0;
    let denAll = 0;
    for (let s = 0; s < N_SECTORS; s++) {
      if (!(den[s] > 0)) continue;
      const c = num[s] / den[s] - 1;
      sm += c;
      sm2 += c * c;
      ns++;
      numAll += num[s];
      denAll += den[s];
    }
    if (ns < 4) return { snr: 0, contrast: NaN };
    const mean = sm / ns;
    const se = Math.sqrt(Math.max(1e-12, (sm2 / ns - mean * mean) / (ns - 1)));
    return { snr: Math.max(0, mean / se), contrast: denAll > 0 ? numAll / denAll - 1 : NaN };
  }

  /** speckle (coherence) area on the detector, pixels: A_c = π/σ_b² in q, with Δq = 2π/n per pixel (HG00 beam) */
  get cohAreaPx(): number {
    return (this.n * this.n) / (4 * Math.PI * this.sBeam * this.sBeam);
  }

  /**
   * Expected SNR of the short-delay contrast on a ring for one source (see xpcsSnrModel), using the measured mean
   * APS-U count rate on the ring (APS = APS-U ÷ gain, its exact expectation) and the multi-tau lags the estimator
   * pools (τ ≤ tauMax; each lag weighted by its bin width, like the ratio-of-sums estimator).
   */
  snrModel(src: SourceIx, r0: number, hw: number, tauMaxFrames: number): { snr: number; shot: number; speckle: number } {
    const mt = this.corr[1];
    const gF = this.gammaAt(r0) * GEOM.frameS;
    let lEff = 0;
    let decay = 0;
    for (let j = 0; j < mt.nLags; j++) {
      if (mt.lagFrames[j] > Math.max(1, tauMaxFrames)) break;
      const b = mt.lagBin[j];
      lEff += b;
      decay += b * Math.exp(-2 * gF * mt.lagFrames[j]);
    }
    const nU = this.ringMeanCounts(1, r0, hw);
    return xpcsSnrModel({
      beta: this.beta,
      decay: lEff > 0 ? decay / lEff : 0,
      lEff,
      nPix: this.ringPixels(r0, hw),
      nFrames: mt.frames,
      nPerPixFrame: src === 1 ? nU : nU / APSU_GAIN,
      gammaFrame: gF,
      cohAreaPx: this.cohAreaPx,
    });
  }

  /** Speckle-sampling standard error of g2 on a ring after the frames measured so far (flux-independent). */
  speckleErr(r0: number, hw: number): number {
    return speckleSamplingErr(this.beta, this.ringPixels(r0, hw), this.cohAreaPx, this.corr[1].frames, this.gammaAt(r0) * GEOM.frameS);
  }

  /** Floor the per-lag error bars of a series at the speckle-sampling error (see speckleSamplingErr). */
  floorErr(out: G2Series, r0: number, hw: number): G2Series {
    const se = this.speckleErr(r0, hw);
    for (let i = 0; i < out.n; i++) if (!(out.err[i] >= se)) out.err[i] = se;
    return out;
  }

  private secTmpP = new Float64Array(N_SECTORS);
  private secTmpF = new Float64Array(N_SECTORS);
  private rbKey = '';
  /**
   * Fill rbG/rbP/rbF with the correlator sums of a ring (cached: g2Ring and contrastSnr read the same ring at
   * the same frame count, so the per-pixel readout runs once).
   */
  private readRing(src: SourceIx, r0: number, hw: number): Int32Array {
    const mt = this.corr[src];
    const groups = this.ringGroups(r0, hw);
    const key = `${src}:${Math.round(r0 - hw)}:${Math.round(r0 + hw)}:${mt.frames}`;
    if (key === this.rbKey) return groups;
    const need = groups.length * mt.nLags;
    if (this.rbG.length < need) {
      this.rbG = new Float64Array(need);
      this.rbP = new Float64Array(need);
      this.rbF = new Float64Array(need);
    }
    mt.groupLagSums(groups, this.rbG, this.rbP, this.rbF);
    this.rbKey = key;
    return groups;
  }

  private rbG = new Float64Array(0);
  private rbP = new Float64Array(0);
  private rbF = new Float64Array(0);
  private secG = new Float64Array(N_SECTORS);
  private secP = new Float64Array(N_SECTORS);
  private secF = new Float64Array(N_SECTORS);
  private secN = new Float64Array(N_SECTORS);

  /** Mean measured photons per pixel per frame on a ring (falls back to the ideal mean). */
  ringMeanCounts(src: SourceIx, r0: number, hw = 1): number {
    const m = this.corr[src].meanLevel0(this.ringGroups(r0, hw));
    if (Number.isFinite(m) && this.corr[src].frames > 20) return m;
    let s = 0;
    let c = 0;
    for (let p = 0; p < this.ideal.length; p++) {
      if (this.mask[p] && Math.abs(this.rad[p] - r0) <= hw + 0.5) {
        s += this.ideal[p];
        c++;
      }
    }
    return c ? (s / c) * (src === 1 ? 1 : 1 / APSU_GAIN) : 0;
  }

  /** Number of analysed pixels on a ring. */
  ringPixels(r0: number, hw = 1): number {
    const mt = this.corr[0];
    let n = 0;
    for (const g of this.ringGroups(r0, hw)) n += mt.gCount[g];
    return n;
  }

  /** Detector pixel index (row-major nd×nd) at radius r, angle θ (radians, screen coords). */
  pixelAt(r: number, theta: number): number {
    const h = this.half;
    const u = Math.max(0, Math.min(this.nd - 1, Math.round(h + r * Math.cos(theta))));
    const v = Math.max(0, Math.min(this.nd - 1, Math.round(h + r * Math.sin(theta))));
    return v * this.nd + u;
  }
}
