/**
 * Drawing helpers for the ptychography station: reusable offscreen bitmaps (no per-frame allocation), colour
 * mapping of phase / counts / complex fields, and small canvas annotations. DOM-only, no physics.
 */
import { TOKENS, lut } from '../kit';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An offscreen canvas + ImageData pair, written pixel-by-pixel and drawn scaled with nearest-neighbour. */
export class Bitmap {
  readonly canvas: HTMLCanvasElement;
  readonly img: ImageData;
  private ctx: CanvasRenderingContext2D;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(w, h);
  }

  get px(): Uint8ClampedArray {
    return this.img.data;
  }

  commit(): void {
    this.ctx.putImageData(this.img, 0, 0);
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect, smooth = false): void {
    ctx.save();
    ctx.imageSmoothingEnabled = smooth;
    ctx.drawImage(this.canvas, r.x, r.y, r.w, r.h);
    ctx.restore();
  }
}

const ICE = lut('ice');
const INFERNO = lut('inferno');
/** panel background (unlit object area) */
const BG: [number, number, number] = [11, 17, 27];

/**
 * Phase image: v = (φ − lo)/(hi − lo) through the 'ice' LUT; `fade` (0..1 per pixel, optional) blends towards the
 * panel background for areas the scan never illuminated. With `idx`, only those pixels are rewritten (the rest
 * keep their previous colours).
 */
export function paintPhase(bmp: Bitmap, phase: ArrayLike<number>, lo: number, hi: number, fade?: Float32Array, idx?: Int32Array): void {
  const d = bmp.px;
  const k = 255 / (hi - lo || 1);
  const n = idx ? idx.length : phase.length;
  for (let q = 0; q < n; q++) {
    const i = idx ? idx[q] : q;
    const t = Math.max(0, Math.min(255, Math.round((phase[i] - lo) * k)));
    const f = fade ? fade[i] : 1;
    const o = i * 4;
    d[o] = BG[0] + (ICE[t * 3] - BG[0]) * f;
    d[o + 1] = BG[1] + (ICE[t * 3 + 1] - BG[1]) * f;
    d[o + 2] = BG[2] + (ICE[t * 3 + 2] - BG[2]) * f;
    d[o + 3] = 255;
  }
  bmp.commit();
}

/**
 * Detector image from counts stored in TRANSPOSED FFT order ([kx·m + ky]), displayed with zero frequency in the
 * centre (fftshift) on a log10(1 + n) scale up to `hiLog`.
 */
export function paintCounts(bmp: Bitmap, counts: Float32Array, m: number, hiLog: number): void {
  const d = bmp.px;
  const h = m / 2;
  const k = 255 / (hiLog || 1);
  for (let v = 0; v < m; v++) {
    const ky = (v + h) % m;
    for (let u = 0; u < m; u++) {
      const kx = (u + h) % m;
      const c = counts[kx * m + ky];
      const t = c > 0 ? Math.max(0, Math.min(255, Math.round(Math.log10(1 + c) * k))) : 0;
      const o = (v * m + u) * 4;
      d[o] = INFERNO[t * 3];
      d[o + 1] = INFERNO[t * 3 + 1];
      d[o + 2] = INFERNO[t * 3 + 2];
      d[o + 3] = 255;
    }
  }
  bmp.commit();
}

/**
 * Complex field (central crop of an m×m array, size bmp.w) as hue = phase − phase0, brightness = |z|/max (γ-corrected).
 */
export function paintComplex(bmp: Bitmap, re: ArrayLike<number>, im: ArrayLike<number>, m: number, phase0: number): void {
  const c = bmp.w;
  const off = (m - c) / 2;
  let mx = 0;
  for (let y = 0; y < c; y++)
    for (let x = 0; x < c; x++) {
      const i = (y + off) * m + x + off;
      const a = re[i] * re[i] + im[i] * im[i];
      if (a > mx) mx = a;
    }
  const d = bmp.px;
  const inv = 1 / Math.sqrt(mx || 1);
  for (let y = 0; y < c; y++)
    for (let x = 0; x < c; x++) {
      const i = (y + off) * m + x + off;
      const amp = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * inv;
      hue(Math.atan2(im[i], re[i]) - phase0, Math.pow(amp, 0.7), d, (y * c + x) * 4);
    }
  bmp.commit();
}

/** hue-wheel colour (same mapping as the kit's phaseRgb) written straight into an RGBA buffer */
function hue(phi: number, amp: number, d: Uint8ClampedArray, o: number): void {
  const h = (((phi / (2 * Math.PI)) % 1) + 1) % 1;
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return 1 - Math.max(0, Math.min(k, 4 - k, 1));
  };
  d[o] = 255 * f(5) * amp;
  d[o + 1] = 255 * f(3) * amp;
  d[o + 2] = 255 * f(1) * amp;
  d[o + 3] = 255;
}

/** Beam footprint sprite: accent colour with alpha ∝ (|P|²/max)^0.55 (m×m, centred). */
export function paintSprite(bmp: Bitmap, re: ArrayLike<number>, im: ArrayLike<number>, rgb: [number, number, number]): void {
  const n = bmp.w * bmp.h;
  let mx = 0;
  for (let i = 0; i < n; i++) mx = Math.max(mx, re[i] * re[i] + im[i] * im[i]);
  const d = bmp.px;
  for (let i = 0; i < n; i++) {
    const a = Math.pow((re[i] * re[i] + im[i] * im[i]) / (mx || 1), 0.75);
    d[i * 4] = rgb[0] + (255 - rgb[0]) * a * 0.4;
    d[i * 4 + 1] = rgb[1] + (255 - rgb[1]) * a * 0.4;
    d[i * 4 + 2] = rgb[2] + (255 - rgb[2]) * a * 0.4;
    d[i * 4 + 3] = Math.round(225 * Math.min(1, a));
  }
  bmp.commit();
}

export function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [96, 165, 250];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** text with a dark halo so it stays legible over images */
export function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  o: { color?: string; size?: number; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; weight?: number; mono?: boolean } = {},
): void {
  ctx.save();
  ctx.font = `${o.weight ?? 600} ${o.size ?? 11}px ${o.mono ? TOKENS.mono : TOKENS.font}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(5,8,14,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = o.color ?? TOKENS.ink;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** width of a string in the given font */
export function textW(ctx: CanvasRenderingContext2D, text: string, size = 11, weight = 600, mono = false): number {
  // callers always set their own font before drawing, so no save/restore is needed here
  ctx.font = `${weight} ${size}px ${mono ? TOKENS.mono : TOKENS.font}`;
  return ctx.measureText(text).width;
}

/** the first of several text variants that fits in maxW (else the last) */
export function fitText(ctx: CanvasRenderingContext2D, variants: string[], maxW: number, size = 11, weight = 600): string {
  for (const v of variants) if (textW(ctx, v, size, weight) <= maxW) return v;
  return variants[variants.length - 1];
}

/** horizontal scale bar of `px` pixels with a label to its right */
export function scaleBar(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, text: string, size = 10.5): void {
  ctx.save();
  ctx.strokeStyle = TOKENS.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.stroke();
  ctx.restore();
  haloText(ctx, text, x + px + 5, y, { size, baseline: 'middle', color: TOKENS.ink2 });
}

/** scientific notation with Unicode superscripts: 9.3 × 10⁵ */
export function sci(v: number, digits = 2): string {
  if (!Number.isFinite(v) || v <= 0) return '0';
  const e = Math.floor(Math.log10(v));
  if (e >= -2 && e <= 3) return v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toPrecision(digits);
  const m = v / Math.pow(10, e);
  const sup = String(e)
    .split('')
    .map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'['0123456789'.indexOf(c)] ?? '⁻')
    .join('');
  return `${m.toFixed(digits - 1)} × 10${sup}`;
}
