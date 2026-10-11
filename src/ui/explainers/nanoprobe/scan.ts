/**
 * Raster-scan engine without DOM access: the probe-weighted areal mass at each scan position, Poisson counting statistics,
 * and the summed / per-pixel XRF spectra.
 *
 * Probe: Gaussian with the delivered FWHM (a diffraction-limited KB focus is closer to sinc² with weak side lobes;
 * a Gaussian is the usual resolution model). Step-scan model: the beam dwells at each pixel centre.
 * The convolution  m̄(r₀) = Σ m(r) P(r − r₀) / Σ P  is evaluated directly at each scan position on a mip level
 * whose pixel is ≤ σ/1.2 (kernel ≤ 15×15), so 20 nm and 1 µm probes cost the same.
 */
import { poisson } from '../../../lib/fft';
import { DET, EL_KEYS, ELEMENTS, OMEGA_FRAC, SAMPLE, comptonE, detFwhm, elementXS, lineXS, scatterDCS, type ElKey } from './physics';
import { FOV_NM, type Composition } from './sample';

/** channels: Ni, Mn, Co, W, total NMC mass */
const NC = 5;

export class Pyramid {
  levels: { n: number; px: number; data: Float32Array }[] = [];
  private wx = new Float64Array(64);
  private wy = new Float64Array(64);

  build(comp: Composition, n: number): void {
    let lv = this.levels[0];
    if (!lv || lv.n !== n) {
      this.levels = [];
      for (let m = n; m >= 8; m >>= 1) this.levels.push({ n: m, px: FOV_NM / m, data: new Float32Array(m * m * NC) });
      lv = this.levels[0];
    }
    const d = lv.data;
    for (let k = 0; k < n * n; k++) {
      const o = k * NC;
      d[o] = comp.ni[k];
      d[o + 1] = comp.mn[k];
      d[o + 2] = comp.co[k];
      d[o + 3] = comp.w[k];
      d[o + 4] = comp.mass[k];
    }
    for (let l = 1; l < this.levels.length; l++) {
      const src = this.levels[l - 1];
      const dst = this.levels[l];
      const m = dst.n;
      for (let j = 0; j < m; j++) {
        for (let i = 0; i < m; i++) {
          const o = (j * m + i) * NC;
          const a = ((2 * j) * src.n + 2 * i) * NC;
          const b = a + NC;
          const c = a + src.n * NC;
          const e = c + NC;
          for (let ch = 0; ch < NC; ch++) dst.data[o + ch] = 0.25 * (src.data[a + ch] + src.data[b + ch] + src.data[c + ch] + src.data[e + ch]);
        }
      }
    }
  }

  /** probe-weighted areal masses at (x, y) nm for a Gaussian of rms σ (nm) → out[0..4] */
  sample(x: number, y: number, sigma: number, out: Float64Array): void {
    let L = 0;
    while (L + 1 < this.levels.length && sigma / this.levels[L + 1].px >= 1.2) L++;
    const lv = this.levels[L];
    const s = Math.max(0.6, sigma / lv.px);
    const R = Math.min(31, Math.ceil(3 * s));
    const cx = x / lv.px - 0.5;
    const cy = y / lv.px - 0.5;
    const i0 = Math.round(cx) - R;
    const j0 = Math.round(cy) - R;
    const span = 2 * R + 1;
    const k2 = 1 / (2 * s * s);
    let sx = 0;
    let sy = 0;
    for (let t = 0; t < span; t++) {
      const dx = i0 + t - cx;
      const dy = j0 + t - cy;
      this.wx[t] = Math.exp(-dx * dx * k2);
      this.wy[t] = Math.exp(-dy * dy * k2);
      sx += this.wx[t];
      sy += this.wy[t];
    }
    for (let c = 0; c < NC; c++) out[c] = 0;
    const n = lv.n;
    const d = lv.data;
    const wx = this.wx;
    const wyA = this.wy;
    // clip the kernel to the field once (the rows / columns outside contribute nothing)
    const ti0 = Math.max(0, -i0);
    const ti1 = Math.min(span, n - i0);
    const tj0 = Math.max(0, -j0);
    const tj1 = Math.min(span, n - j0);
    for (let tj = tj0; tj < tj1; tj++) {
      const wy = wyA[tj];
      let a0 = 0;
      let a1 = 0;
      let a2 = 0;
      let a3 = 0;
      let a4 = 0;
      let o = ((j0 + tj) * n + i0 + ti0) * NC;
      for (let ti = ti0; ti < ti1; ti++, o += NC) {
        const w = wx[ti];
        a0 += w * d[o];
        a1 += w * d[o + 1];
        a2 += w * d[o + 2];
        a3 += w * d[o + 3];
        a4 += w * d[o + 4];
      }
      out[0] += wy * a0;
      out[1] += wy * a1;
      out[2] += wy * a2;
      out[3] += wy * a3;
      out[4] += wy * a4;
    }
    const norm = 1 / (sx * sy);
    for (let c = 0; c < NC; c++) out[c] *= norm;
  }
}

export interface ScanSetup {
  E0: number;
  /** delivered probe FWHM, nm */
  spot: number;
  /** pixels per side */
  nx: number;
  /** photons per pixel on the sample (flux × dwell after attenuation) */
  photons: number;
}

/** Counts per (g/cm²) per pixel for each element, and per (g/cm²) for scatter (Rayleigh, Compton). */
export function yields(E0: number, photons: number): { el: Float64Array; rayNMC: number; comNMC: number; rayEnv: number; comEnv: number } {
  const el = new Float64Array(4);
  EL_KEYS.forEach((k, i) => (el[i] = photons * OMEGA_FRAC * elementXS(k, E0)));
  const s = scatterDCS(E0);
  const f = photons * DET.omegaSr;
  return { el, rayNMC: f * s.rayNMC, comNMC: f * s.comNMC, rayEnv: f * s.rayEnv, comEnv: f * s.comEnv };
}

/** One raster scan in progress. Components for the spectrum: Ni, Mn, Co, W, Rayleigh, Compton. */
export class ScanRun {
  readonly nx: number;
  readonly step: number;
  readonly total: number;
  readonly setup: ScanSetup;
  idx = 0;
  /** measured (Poisson) counts per element */
  readonly maps: Float32Array[];
  /** expected counts per element */
  readonly expected: Float32Array[];
  /** display maximum per element (counts) */
  readonly scale = new Float64Array(4);
  /** expected spectral-component counts summed over measured pixels, and pending (not yet sent to the spectrum) */
  readonly sums = new Float64Array(6);
  readonly pending = new Float64Array(6);
  /** expected component counts of the last measured pixel */
  readonly last = new Float64Array(6);
  private y: ReturnType<typeof yields>;
  private tmp = new Float64Array(NC);
  private sigma: number;

  constructor(setup: ScanSetup, pyr: Pyramid) {
    this.setup = setup;
    this.nx = setup.nx;
    this.step = FOV_NM / setup.nx;
    this.total = setup.nx * setup.nx;
    this.maps = EL_KEYS.map(() => new Float32Array(this.total));
    this.expected = EL_KEYS.map(() => new Float32Array(this.total));
    this.y = yields(setup.E0, setup.photons);
    this.sigma = setup.spot / 2.3548;
    // display scale: expected maximum on a coarse grid of probe positions (+ 2σ of counting noise)
    const G = 28;
    const mx = new Float64Array(4);
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        pyr.sample(((i + 0.5) / G) * FOV_NM, ((j + 0.5) / G) * FOV_NM, this.sigma, this.tmp);
        for (let e = 0; e < 4; e++) mx[e] = Math.max(mx[e], this.tmp[e] * this.y.el[e]);
      }
    }
    for (let e = 0; e < 4; e++) this.scale[e] = mx[e] > 0 ? Math.max(1, mx[e] * 1.08 + 2 * Math.sqrt(mx[e])) : 1;
  }

  get done(): boolean {
    return this.idx >= this.total;
  }

  /** beam position (nm) of pixel k */
  pos(k: number): { x: number; y: number } {
    const j = Math.floor(k / this.nx);
    const i = k - j * this.nx;
    return { x: (i + 0.5) * this.step, y: (j + 0.5) * this.step };
  }

  /** measure pixels idx … target−1 */
  advance(target: number, pyr: Pyramid, rand: () => number): void {
    const end = Math.min(this.total, Math.max(this.idx, Math.floor(target)));
    const env = SAMPLE.envMass;
    for (let k = this.idx; k < end; k++) {
      const j = Math.floor(k / this.nx);
      const i = k - j * this.nx;
      pyr.sample((i + 0.5) * this.step, (j + 0.5) * this.step, this.sigma, this.tmp);
      for (let e = 0; e < 4; e++) {
        const lam = this.tmp[e] * this.y.el[e];
        this.expected[e][k] = lam;
        this.maps[e][k] = poisson(lam, rand);
        this.last[e] = lam;
      }
      this.last[4] = this.tmp[4] * this.y.rayNMC + env * this.y.rayEnv;
      this.last[5] = this.tmp[4] * this.y.comNMC + env * this.y.comEnv;
      for (let c = 0; c < 6; c++) {
        this.sums[c] += this.last[c];
        this.pending[c] += this.last[c];
      }
    }
    this.idx = end;
  }

  /** expected spectral components (Ni, Mn, Co, W, Rayleigh, Compton) with the beam parked at (x, y) nm */
  expectedAt(x: number, y: number, pyr: Pyramid, out: Float64Array): void {
    pyr.sample(x, y, this.sigma, this.tmp);
    for (let e = 0; e < 4; e++) out[e] = this.tmp[e] * this.y.el[e];
    out[4] = this.tmp[4] * this.y.rayNMC + SAMPLE.envMass * this.y.rayEnv;
    out[5] = this.tmp[4] * this.y.comNMC + SAMPLE.envMass * this.y.comEnv;
  }

  /** run to completion (used for the instant first scan) */
  finish(pyr: Pyramid, rand: () => number): void {
    this.advance(this.total, pyr, rand);
  }
}

// --------------------------------------------------------------------------------------------- spectrum

export const SPEC = { e0: 4, e1: 14, de: 0.01 };
export const NCH = Math.round((SPEC.e1 - SPEC.e0) / SPEC.de);

export interface SpecLine {
  el: ElKey | 'scatter';
  name: string;
  e: number;
  /** fraction of the component's counts in this line */
  w: number;
}

/** Spectral shapes (per count) for the six components, the accumulated measured histogram, and a per-pixel draw. */
export class Spectrum {
  readonly unit: Float32Array[] = Array.from({ length: 6 }, () => new Float32Array(NCH));
  readonly hist = new Float64Array(NCH);
  readonly pixel = new Float32Array(NCH);
  readonly lines: SpecLine[] = [];
  pixels = 0;
  E0 = 0;

  setup(E0: number): void {
    this.E0 = E0;
    this.hist.fill(0);
    this.pixels = 0;
    this.lines.length = 0;
    for (const u of this.unit) u.fill(0);
    EL_KEYS.forEach((k, ci) => {
      const tot = elementXS(k, E0);
      if (tot <= 0) return;
      for (const l of ELEMENTS[k].lines) {
        const w = lineXS(k, l, E0) / tot;
        if (w <= 0) continue;
        this.lines.push({ el: k, name: l.name, e: l.e, w });
        this.addPeak(this.unit[ci], l.e, detFwhm(l.e), w);
      }
    });
    this.addPeak(this.unit[4], E0, detFwhm(E0), 1);
    const ec = comptonE(E0);
    // Compton: Doppler-broadened (illustrative 1.5 % of E0 added in quadrature)
    this.addPeak(this.unit[5], ec, Math.hypot(detFwhm(ec), 0.015 * E0), 1);
    this.lines.push({ el: 'scatter', name: 'Rayleigh', e: E0, w: 1 }, { el: 'scatter', name: 'Compton', e: ec, w: 1 });
  }

  /** Gaussian line of unit area (× w) plus a flat incomplete-charge shelf down to 0 keV */
  private addPeak(u: Float32Array, e: number, fwhm: number, w: number): void {
    const sig = fwhm / 2.3548;
    const norm = (w * (1 - DET.shelf) * SPEC.de) / (sig * Math.sqrt(2 * Math.PI));
    const lo = Math.max(0, Math.floor((e - 5 * sig - SPEC.e0) / SPEC.de));
    const hi = Math.min(NCH - 1, Math.ceil((e + 5 * sig - SPEC.e0) / SPEC.de));
    for (let c = lo; c <= hi; c++) {
      const x = SPEC.e0 + (c + 0.5) * SPEC.de - e;
      u[c] += norm * Math.exp(-(x * x) / (2 * sig * sig));
    }
    const shelf = (w * DET.shelf * SPEC.de) / e;
    const top = Math.min(NCH, Math.floor((e - SPEC.e0) / SPEC.de));
    for (let c = 0; c < top; c++) u[c] += shelf;
  }

  /** add the Poisson realisation of `d` expected component counts (summed over n pixels) */
  accumulate(d: Float64Array, n: number, rand: () => number): void {
    if (n <= 0) return;
    const u = this.unit;
    for (let c = 0; c < NCH; c++) {
      const lam = d[0] * u[0][c] + d[1] * u[1][c] + d[2] * u[2][c] + d[3] * u[3][c] + d[4] * u[4][c] + d[5] * u[5][c];
      if (lam > 0) this.hist[c] += poisson(lam, rand);
    }
    this.pixels += n;
    d.fill(0);
  }

  /** expected per-pixel spectrum for component vector s → out */
  expectedInto(s: Float64Array, out: Float32Array): void {
    const u = this.unit;
    for (let c = 0; c < NCH; c++) out[c] = s[0] * u[0][c] + s[1] * u[1][c] + s[2] * u[2][c] + s[3] * u[3][c] + s[4] * u[4][c] + s[5] * u[5][c];
  }

  /** one Poisson draw of a single pixel's spectrum */
  drawPixel(s: Float64Array, rand: () => number): void {
    this.expectedInto(s, this.pixel);
    for (let c = 0; c < NCH; c++) this.pixel[c] = poisson(this.pixel[c], rand);
  }
}

/** channel → energy (keV, centre) */
export function chE(c: number): number {
  return SPEC.e0 + (c + 0.5) * SPEC.de;
}
