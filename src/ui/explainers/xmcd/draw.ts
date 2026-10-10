/** Small canvas helpers shared by the XMCD station views. */
import { TOKENS } from '../kit';

/** Station palette. Helicity colours are a colour-blind-safe amber / blue pair; the accent marks magnetism. */
export const COL = {
  left: '#ffb547',
  right: '#5b9dff',
  linear: '#e9eef5',
  against: '#8aa0c8',
  anvil: 'rgba(196,228,255,',
};

export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [92, 211, 255];
}

/** Linear mix of two hex colours → css rgb(). */
export function mix(a: string, b: string, t: number): string {
  const A = hexRgb(a);
  const B = hexRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * k)},${Math.round(A[1] + (B[1] - A[1]) * k)},${Math.round(A[2] + (B[2] - A[2]) * k)})`;
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Colour of a beam with helicity-signed circular polarization pc. */
export function beamColor(pc: number): string {
  return pc >= 0 ? mix(COL.linear, COL.left, Math.min(1, Math.abs(pc) * 1.15)) : mix(COL.linear, COL.right, Math.min(1, Math.abs(pc) * 1.15));
}

export interface TxtOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  weight?: number;
  mono?: boolean;
}

export function font(o: TxtOpts = {}): string {
  return `${o.weight ?? 500} ${o.size ?? 11}px ${o.mono ? TOKENS.mono : TOKENS.font}`;
}

export function txt(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TxtOpts = {}): number {
  ctx.font = font(o);
  ctx.fillStyle = o.color ?? TOKENS.ink2;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

export function textW(ctx: CanvasRenderingContext2D, s: string, o: TxtOpts = {}): number {
  ctx.font = font(o);
  return ctx.measureText(s).width;
}

/** Split "T_C 750 K" / "m_{spin,eff}" into [text, isSub] runs (subscript = `_x` or `_{…}`). */
function runs(s: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  let i = 0;
  let buf = '';
  while (i < s.length) {
    if (s[i] === '_' && i + 1 < s.length) {
      if (buf) out.push([buf, false]);
      buf = '';
      if (s[i + 1] === '{') {
        const j = s.indexOf('}', i + 2);
        const end = j < 0 ? s.length : j;
        out.push([s.slice(i + 2, end), true]);
        i = end + 1;
      } else {
        out.push([s[i + 1], true]);
        i += 2;
      }
      continue;
    }
    buf += s[i];
    i++;
  }
  if (buf) out.push([buf, false]);
  return out;
}

/** Width of rich text (see rich()). */
export function richW(ctx: CanvasRenderingContext2D, s: string, o: TxtOpts = {}): number {
  const size = o.size ?? 11;
  let w = 0;
  for (const [t, sub] of runs(s)) {
    ctx.font = font({ ...o, size: sub ? size * 0.78 : size });
    w += ctx.measureText(t).width;
  }
  return w;
}

/** Text with subscripts: `_x` or `_{xyz}` is drawn smaller and lowered (canvas has no sub/sup support). */
export function rich(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TxtOpts = {}): number {
  const size = o.size ?? 11;
  const w = richW(ctx, s, o);
  const align = o.align ?? 'left';
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = o.color ?? TOKENS.ink2;
  ctx.textAlign = 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  for (const [t, sub] of runs(s)) {
    ctx.font = font({ ...o, size: sub ? size * 0.78 : size });
    ctx.fillText(t, cx, sub ? y + size * 0.28 : y);
    cx += ctx.measureText(t).width;
  }
  return w;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/** Filled triangular arrow head with its tip at (x, y) pointing along angle a. */
export function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(a - 0.42), y - size * Math.sin(a - 0.42));
  ctx.lineTo(x - size * Math.cos(a + 0.42), y - size * Math.sin(a + 0.42));
  ctx.closePath();
  ctx.fill();
}

/** Line with an arrow head at the end. */
export function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, head = 8, width = 2): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (L < 0.5) return;
  const hs = Math.min(head, L * 0.6);
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - Math.cos(a) * hs * 0.7, y1 - Math.sin(a) * hs * 0.7);
  ctx.stroke();
  arrowHead(ctx, x1, y1, a, hs);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export interface Map1 {
  /** data → px */
  (v: number): number;
}

export function linMap(d0: number, d1: number, p0: number, p1: number): Map1 {
  const k = (p1 - p0) / (d1 - d0);
  return (v: number) => p0 + (v - d0) * k;
}

/** Signed number with a typographic minus: +0.35, −0.35, 0.00. */
export function signed(v: number, digits = 2): string {
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return s;
  return (v > 0 ? '+' : '−') + s;
}

/** Number with a typographic minus. */
export function num(v: number, digits = 0): string {
  const s = Math.abs(v).toFixed(digits);
  return (v < 0 && Number(s) !== 0 ? '−' : '') + s;
}
