/** Shared drawing / DOM helpers for the "laue" station (local; the shared kit is not modified). */
import { TOKENS } from '../kit';
import { BAND } from './physics';

// ------------------------------------------------------------------ energy → "colour" of the X-ray

/**
 * X-rays are invisible; we paint them like visible light: long wavelength (low energy) red → short (high energy)
 * violet. Hue is linear in log E (≡ −log λ) across the 5.3–30 keV band, which spreads the common 8–20 keV range.
 */
const ELUT = new Uint8ClampedArray(256 * 3);
(() => {
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const hue = 275 * t;
    // lift the lightness of blue/violet so high-energy spots remain visible on the dark background
    const lift = t > 0.55 ? (t - 0.55) / 0.45 : 0;
    const [r, g, b] = hsl(hue, 0.92, 0.6 - 0.07 * Math.sin(Math.PI * Math.min(t, 0.55) / 0.55) + 0.1 * lift);
    ELUT[i * 3] = r;
    ELUT[i * 3 + 1] = g;
    ELUT[i * 3 + 2] = b;
  }
})();

function hsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}

export function eT(E: number): number {
  return Math.max(0, Math.min(1, Math.log(E / BAND.min) / Math.log(BAND.max / BAND.min)));
}
export function eRgb(E: number): [number, number, number] {
  const i = Math.round(eT(E) * 255) * 3;
  return [ELUT[i], ELUT[i + 1], ELUT[i + 2]];
}
const cssCache = new Map<number, string>();
/** CSS colour of energy E (alpha quantised to 1/200; strings are cached. This runs for every spot every frame) */
export function eCss(E: number, alpha = 1): string {
  const i = Math.round(eT(E) * 255);
  const a = Math.max(0, Math.min(200, Math.round(alpha * 200)));
  const key = i * 256 + a;
  let c = cssCache.get(key);
  if (!c) {
    const r = ELUT[i * 3];
    const g = ELUT[i * 3 + 1];
    const b = ELUT[i * 3 + 2];
    c = a >= 200 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 200).toFixed(3)})`;
    cssCache.set(key, c);
  }
  return c;
}

// ------------------------------------------------------------------ text helpers

/** "−1 1 5" style Miller indices (no overbars: they render unreliably on canvas). */
export function hklStr(h: number, k: number, l: number): string {
  const f = (n: number) => (n < 0 ? `−${-n}` : `${n}`);
  return `${f(h)} ${f(k)} ${f(l)}`;
}

export function fix(v: number, d: number): string {
  return v.toFixed(d).replace('-', '−');
}

// ------------------------------------------------------------------ canvas helpers

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width = 1.5, head = 7): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0);
  const hh = Math.min(head, len * 0.6);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - Math.cos(a) * hh * 0.7, y1 - Math.sin(a) * hh * 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(a - 0.42) * hh, y1 - Math.sin(a - 0.42) * hh);
  ctx.lineTo(x1 - Math.cos(a + 0.42) * hh, y1 - Math.sin(a + 0.42) * hh);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Text with a dark halo so it stays legible over spots / lines. */
export function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  o: { color?: string; size?: number; weight?: number; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; mono?: boolean; halo?: string } = {},
): void {
  ctx.save();
  ctx.font = `${o.weight ?? 500} ${o.size ?? 11}px ${o.mono ? TOKENS.mono : TOKENS.font}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = o.halo ?? 'rgba(5,8,14,0.92)';
  ctx.lineWidth = 3.5;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = o.color ?? TOKENS.ink2;
  ctx.fillText(text, x, y);
  ctx.restore();
}

const widthCache = new Map<string, number>();
// widths measured with a fallback font are wrong once the web font arrives
if (typeof document !== 'undefined' && document.fonts) document.fonts.addEventListener('loadingdone', () => widthCache.clear());
export function textWidth(ctx: CanvasRenderingContext2D, text: string, size = 11, weight = 500, mono = false): number {
  const key = `${size}|${weight}|${mono ? 1 : 0}|${text}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    ctx.save();
    ctx.font = `${weight} ${size}px ${mono ? TOKENS.mono : TOKENS.font}`;
    w = ctx.measureText(text).width;
    ctx.restore();
    if (widthCache.size > 4000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}

// ------------------------------------------------------------------ station-local CSS

const CSS = `
.laue-tabs { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.laue-tabs .stn-toggle { flex: 1 1 auto; }
.laue-tabs .stn-toggle button { font-size: 12.5px; padding: 7px 10px; }
.laue-part { display: grid; gap: 6px; }
.laue-root.stn-side .laue-part { min-height: 0; }
.laue-part[hidden] { display: none !important; }
.laue-ctl[hidden] { display: none !important; }
.laue-tip { position: absolute; z-index: 3; pointer-events: none; max-width: 250px; padding: 7px 9px; border-radius: 8px;
  background: rgba(8,13,22,.94); border: 1px solid rgba(150,180,220,.25); color: #e9eef5; font-size: 12px; line-height: 1.4;
  box-shadow: 0 6px 22px rgba(0,0,0,.45); opacity: 0; transition: opacity .12s; }
.laue-tip.is-on { opacity: 1; }
.laue-tip b { color: #fff; }
.laue-tip .mono { font-family: var(--mono, ui-monospace, monospace); font-size: 11.5px; }
.laue-tip .dim { color: #8394a9; }
.laue-card { font-size: 12.5px; line-height: 1.45; color: #b7c3d2; padding: 8px 10px; border-radius: 8px;
  background: rgba(255,255,255,.035); border: 1px solid rgba(150,180,220,.12); }
.laue-card:empty { display: none; }
.laue-card strong { color: #fff; }
.laue-card code { font-family: var(--mono, ui-monospace, monospace); font-size: 11.5px; color: #e9eef5; }
.laue-row { display: flex; flex-wrap: wrap; gap: 6px; }
.laue-row .stn-btn { padding: 6px 9px; font-size: 12px; }
.laue-row .stn-btn[aria-pressed=true] { border-color: var(--c, #5cd3ff); background: color-mix(in oklab, var(--c, #5cd3ff) 22%, #0b111b); }
.laue-canvas-focus canvas:focus-visible { outline: 2px solid var(--c, #5cd3ff); outline-offset: -2px; border-radius: 8px; }
/* Stacked side-panel and phone layouts use column flow for groups of different heights. */
.laue-root.stn-stack .stn-controls { display: block; column-width: 200px; column-gap: 16px; }
.laue-root.stn-stack .stn-controls > .laue-ctl > * { break-inside: avoid; margin-bottom: 14px; }
.laue-root { overflow-y: auto; }
.laue-root .stn-slider-value { min-width: 0; }
.laue-root .stn-readout-value { white-space: nowrap; }
.laue-root .stn-readout-label { min-width: 0; }
`;

export function injectStyle(root: HTMLElement): void {
  const s = document.createElement('style');
  s.textContent = CSS;
  root.appendChild(s);
}

export function div(cls: string, parent?: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (parent) parent.appendChild(d);
  return d;
}

// ------------------------------------------------------------------ performance helpers

/**
 * Offscreen layer for the static part of a canvas (backgrounds, axes, labels). Re-rendered only when its key
 * changes (size, mode …); blitting a bitmap is far cheaper than re-rasterising fills and text each frame.
 */
export class Layer {
  private c: HTMLCanvasElement | null = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  private key = '';
  draw(target: { ctx: CanvasRenderingContext2D; w: number; h: number; dpr: number }, key: string, render: (ctx: CanvasRenderingContext2D) => void): void {
    const c = this.c;
    if (!c) return;
    const W = Math.round(target.w * target.dpr);
    const H = Math.round(target.h * target.dpr);
    const k = `${W}x${H}|${key}`;
    if (k !== this.key) {
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const x = c.getContext('2d')!;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, W, H);
      x.setTransform(target.dpr, 0, 0, target.dpr, 0, 0);
      render(x);
      this.key = k;
    }
    const ctx = target.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }
}

const sprites = new Map<number, HTMLCanvasElement>();
/** Pre-rendered soft glow (radial gradient) for a colour; drawn with drawImage instead of a new gradient per spot. */
export function glowSprite(rgb: [number, number, number]): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const key = ((rgb[0] >> 3) << 10) | ((rgb[1] >> 3) << 5) | (rgb[2] >> 3);
  let c = sprites.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  const [r, gg, b] = rgb;
  g.addColorStop(0, `rgba(${r},${gg},${b},0.95)`);
  g.addColorStop(0.32, `rgba(${r},${gg},${b},0.6)`);
  g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  sprites.set(key, c);
  return c;
}

/** Cheap "glow" stroke: a wide translucent pass under a narrow bright one (no shadowBlur). */
export function glowLine(ctx: CanvasRenderingContext2D, path: () => void, color: string, width: number, glowWidth = width * 3.5, glowAlpha = 0.22): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.globalAlpha = glowAlpha;
  ctx.lineWidth = glowWidth;
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = width;
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.restore();
}
