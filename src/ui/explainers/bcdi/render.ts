/**
 * Rendering helpers for the BCDI station (no physics here).
 *
 * Phase colour map: a cyclic, diverging map (white at φ = 0, warm for +φ, cool for −φ, purple at ±π) because the
 * retrieved phase is only known modulo 2π — a cyclic map shows wraps as smooth colour cycles rather than false edges.
 *
 * Lattice planes: the Bragg reflection G "sees" one family of planes — the loci G·(r − u) = 2πm. We draw the
 * contours of G_draw·r − φ(r) = 2πm with |G_draw| = |G|/M (M = PLANE_MAG), i.e. the real planes with their spacing
 * AND their displacement along G magnified M×. A phase vortex of charge n therefore appears as exactly n extra
 * half-planes — the textbook picture of a dislocation.
 */
import { lut } from '../kit';

type RGB = [number, number, number];
const PHASE_STOPS: RGB[] = [
  [238, 241, 247], // 0
  [248, 198, 160], // +π/4
  [238, 120, 88], // +π/2
  [204, 72, 128], // +3π/4
  [140, 74, 196], // ±π
  [84, 104, 224], // −3π/4
  [62, 150, 238], // −π/2
  [160, 208, 246], // −π/4
];

/** 256-entry cyclic LUT, index = (φ/2π mod 1)·256. */
export const PHASE_LUT: Uint8ClampedArray = (() => {
  const l = new Uint8ClampedArray(256 * 3);
  const m = PHASE_STOPS.length;
  for (let i = 0; i < 256; i++) {
    const f = (i / 256) * m;
    const a = Math.floor(f) % m;
    const b = (a + 1) % m;
    const t = f - Math.floor(f);
    for (let k = 0; k < 3; k++) l[i * 3 + k] = PHASE_STOPS[a][k] + (PHASE_STOPS[b][k] - PHASE_STOPS[a][k]) * t;
  }
  return l;
})();

const TWO_PI = 2 * Math.PI;

export function phaseIndex(phi: number): number {
  let v = phi / TWO_PI;
  v -= Math.floor(v);
  return Math.min(255, (v * 256) | 0);
}

export function phaseCss(phi: number, alpha = 1): string {
  const i = phaseIndex(phi) * 3;
  return `rgba(${PHASE_LUT[i]},${PHASE_LUT[i + 1]},${PHASE_LUT[i + 2]},${alpha})`;
}

export interface FieldView {
  /** centre (nm) and full width (nm) of the square view */
  cx: number;
  cy: number;
  fov: number;
}

/** out[0] = opacity/amplitude 0..1, out[1] = phase (rad). */
export type Sampler = (x: number, y: number, out: Float64Array) => void;

const SAMPLE = new Float64Array(2);
const LINE_RGB: RGB = [10, 14, 26];

/**
 * Render a complex field into an RGBA ImageData (square, R×R) with optional magnified lattice planes.
 * `planes` = [gx, gy] drawing wave-vector (rad/nm) or null.
 */
export function renderField(img: ImageData, view: FieldView, sample: Sampler, planes: [number, number] | null, lineWidth = 1.2, lineDark = 0.7): void {
  const R = img.width;
  const d = img.data;
  const step = view.fov / R;
  const x0 = view.cx - view.fov / 2 + step / 2;
  const y0 = view.cy + view.fov / 2 - step / 2;
  const gx = planes ? planes[0] : 0;
  const gy = planes ? planes[1] : 0;
  const spacingPx = planes ? TWO_PI / Math.hypot(gx, gy) / step : 1;
  const half = lineWidth / 2 + 0.5;
  const L = PHASE_LUT;
  for (let py = 0; py < R; py++) {
    const y = y0 - py * step;
    for (let px = 0; px < R; px++) {
      const x = x0 + px * step;
      const o = (py * R + px) * 4;
      sample(x, y, SAMPLE);
      const a = SAMPLE[0];
      if (a <= 0.004) {
        d[o + 3] = 0;
        continue;
      }
      const phi = SAMPLE[1];
      const li = phaseIndex(phi) * 3;
      let r = L[li];
      let g = L[li + 1];
      let b = L[li + 2];
      if (planes) {
        const t = (gx * x + gy * y - phi) / TWO_PI;
        const fr = Math.abs(t - Math.floor(t + 0.5)) * spacingPx;
        let w = half - fr;
        if (w > 0) {
          if (w > 1) w = 1;
          const k = lineDark * w * Math.min(1, a * 1.6);
          r += (LINE_RGB[0] - r) * k;
          g += (LINE_RGB[1] - g) * k;
          b += (LINE_RGB[2] - b) * k;
        }
      }
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = Math.min(255, a * 255);
    }
  }
}

/** Log-scaled photon counts (fftshifted, n×n) into an n×n ImageData; zero counts → near-black. */
export function renderCounts(img: ImageData, counts: ArrayLike<number>, logMax: number): void {
  const L = lut('inferno');
  const d = img.data;
  const n = img.width * img.height;
  for (let k = 0; k < n; k++) {
    const c = counts[k];
    const o = k * 4;
    if (c <= 0) {
      d[o] = 3;
      d[o + 1] = 4;
      d[o + 2] = 9;
      d[o + 3] = 255;
      continue;
    }
    // 1 photon maps a little above black so single counts stay visible
    const v = 0.06 + 0.94 * Math.min(1, Math.log10(c) / logMax);
    const i = Math.min(255, (v * 255) | 0) * 3;
    d[o] = L[i];
    d[o + 1] = L[i + 1];
    d[o + 2] = L[i + 2];
    d[o + 3] = 255;
  }
}

/**
 * Friedel-asymmetry view as a bivariate image: brightness = log intensity of the (re-centred, noise-free) pattern,
 * hue = normalised difference (I(q) − I(−q))/(I(q) + I(−q)) on a diverging map (white = symmetric). Showing the
 * difference only where there is intensity keeps faint, noisy fringes from dominating the picture.
 */
export function renderAsym(img: ImageData, map: ArrayLike<number>, intensity: ArrayLike<number>, logMax: number): void {
  const L = lut('rdbu');
  const d = img.data;
  const n = img.width * img.height;
  for (let k = 0; k < n; k++) {
    const o = k * 4;
    const I = intensity[k];
    // 0.3 photon … 10^logMax photons → 0 … 1
    let b = I > 0 ? (Math.log10(I) + 0.5) / (logMax + 0.5) : 0;
    b = b < 0 ? 0 : b > 1 ? 1 : b;
    b = 0.05 + 0.95 * Math.pow(b, 0.85);
    const v = map[k];
    let r: number;
    let g: number;
    let bl: number;
    if (v === v) {
      // kit 'rdbu' runs blue (0) → white → red (255): I(q) > I(−q) shows red
      const i = Math.max(0, Math.min(255, ((v * 0.5 + 0.5) * 255) | 0)) * 3;
      r = L[i];
      g = L[i + 1];
      bl = L[i + 2];
    } else {
      r = g = bl = 150; // too faint to judge: neutral grey
    }
    d[o] = 4 + r * b;
    d[o + 1] = 6 + g * b;
    d[o + 2] = 12 + bl * b;
    d[o + 3] = 255;
  }
}

/** CSS linear-gradient of the phase map from −π (left) to +π (right). */
export function phaseGradientCss(): string {
  const stops: string[] = [];
  for (let i = 0; i <= 16; i++) {
    const phi = -Math.PI + (i / 16) * TWO_PI;
    stops.push(`${phaseCss(phi)} ${((i / 16) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** Offscreen canvas holder that keeps its ImageData between frames (no per-frame allocation). */
export class Layer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  img: ImageData;
  constructor(w: number, h = w) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(w, h);
  }
  resize(w: number, h = w): boolean {
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    this.img = this.ctx.createImageData(w, h);
    return true;
  }
  commit(): void {
    this.ctx.putImageData(this.img, 0, 0);
  }
}
