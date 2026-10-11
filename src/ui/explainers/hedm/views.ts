/**
 * HEDM station. Canvas renderers. Pure drawing from HedmSim + ViewState (no simulation changes).
 *   TopView        1 · the rotating sample slice seen from above, beam, flashes, rays, orientation sketch
 *   DetectorView   2 · far-field panel (accumulated ω sweep) or near-field camera (live frame)
 *   PenView        3 · 1/e attenuation length vs energy (NIST), current energy and sample size
 *   AnswerView     4 · far field: grain centroids + axial strain; near field: reconstructed grain map
 */
import { TOKENS, lut, plotFrame, line, type Canvas2D } from '../kit';
import * as P from './physics';
import { FF, NF, NBIN, type HedmSim, type Mode } from './sim';

export interface Flash {
  spot: number;
  t0: number;
}

export interface ViewState {
  omega: number;
  mode: Mode;
  selected: number;
  accent: string;
  /** seconds since mount */
  t: number;
  flashes: Flash[];
  /** user has interacted with the sample (hide the hint) */
  touched: boolean;
  /** reduced motion and not turning: decorative motion (the beam's flow chevrons) holds still */
  still?: boolean;
}

const FONT = TOKENS.font;
const MONO = TOKENS.mono;
const FLASH_GRAIN = 0.6;
const FLASH_RAY = 0.5;
/** at most this many grains glow / rays show at once (each grain diffracts every ~1.5° of rotation) */
const MAX_GLOW = 6;
const MAX_RAYS = 5;
const MAX_RINGS = 8;
/** entries of the tabulated spot profile (indexed by ρ²) */
const SPOT_LUT = 48;

export function hexToRgb(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [92, 211, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgba(c: string, a: number): string {
  const [r, g, b] = hexToRgb(c);
  return `rgba(${r},${g},${b},${a})`;
}
const rgb255 = (v: P.Vec3, k = 1, a = 1): string =>
  `rgba(${Math.round(Math.min(255, v[0] * 255 * k))},${Math.round(Math.min(255, v[1] * 255 * k))},${Math.round(Math.min(255, v[2] * 255 * k))},${a})`;
/** grain colour mixed toward white by w */
const tint = (v: P.Vec3, w: number, a = 1): string =>
  `rgba(${Math.round(255 * (v[0] + (1 - v[0]) * w))},${Math.round(255 * (v[1] + (1 - v[1]) * w))},${Math.round(255 * (v[2] + (1 - v[2]) * w))},${a})`;

function txt(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  o: { size?: number; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline; weight?: number; mono?: boolean; halo?: boolean } = {},
): number {
  ctx.font = `${o.weight ?? 500} ${o.size ?? 11}px ${o.mono ? MONO : FONT}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.base ?? 'alphabetic';
  if (o.halo) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5,8,14,0.9)';
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = o.color ?? TOKENS.ink2;
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

const wrapCache = new Map<string, string[]>();
/** greedy word wrap of s into lines no wider than maxW px (cached: the legends are redrawn every frame) */
function wrapLines(ctx: CanvasRenderingContext2D, s: string, maxW: number, size: number, weight = 500): string[] {
  const key = `${size}|${weight}|${Math.round(maxW)}|${s}`;
  const hit = wrapCache.get(key);
  if (hit) return hit;
  ctx.font = `${weight} ${size}px ${FONT}`;
  const out: string[] = [];
  let cur = '';
  for (const word of s.split(' ')) {
    const t = cur ? `${cur} ${word}` : word;
    if (!cur || ctx.measureText(t).width <= maxW) cur = t;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  if (wrapCache.size > 200) wrapCache.clear();
  wrapCache.set(key, out);
  return out;
}

/** wrapped paragraph; returns the y below it. Stops at yMax. */
function para(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, yMax: number, o: { size?: number; color?: string; weight?: number; lh?: number } = {}): number {
  const size = o.size ?? 10;
  const lh = o.lh ?? size + 3;
  for (const l of wrapLines(ctx, s, maxW, size, o.weight ?? 500)) {
    if (y > yMax) break;
    txt(ctx, l, x, y, { size, color: o.color ?? TOKENS.ink3, weight: o.weight });
    y += lh;
  }
  return y;
}

function pill(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: { size?: number; color?: string; align?: 'left' | 'right' | 'center'; border?: string; mono?: boolean } = {}): number {
  const size = o.size ?? 11;
  ctx.font = `600 ${size}px ${o.mono ? MONO : FONT}`;
  const w = ctx.measureText(s).width + 12;
  const h = size + 8;
  const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = 'rgba(5,8,14,0.84)';
  ctx.beginPath();
  ctx.roundRect(x0, y - h / 2, w, h, 6);
  ctx.fill();
  if (o.border) {
    ctx.strokeStyle = o.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = o.color ?? TOKENS.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x0 + 6, y + 0.5);
  return w;
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(ang) * size, y + Math.sin(ang) * size);
  ctx.lineTo(x + Math.cos(ang + 2.5) * size, y + Math.sin(ang + 2.5) * size);
  ctx.lineTo(x + Math.cos(ang - 2.5) * size, y + Math.sin(ang - 2.5) * size);
  ctx.closePath();
  ctx.fill();
}

export const fmtLen = (mm: number): string => (mm >= 10 ? `${(mm / 10).toPrecision(2)} cm` : mm >= 1 ? `${mm.toPrecision(2)} mm` : mm >= 0.1 ? `${mm.toFixed(2)} mm` : `${Math.round(mm * 1000)} µm`);

// ====================================================================== 1 · top view

export interface TopGeom {
  cx: number;
  cy: number;
  /** sample radius, px */
  r: number;
  /** detector bar x and half-height */
  xd: number;
  hb: number;
  /** px per mm */
  s: number;
}

export class TopView {
  private glow: Float32Array;
  constructor(
    private c: Canvas2D,
    private sim: HedmSim,
    private vs: ViewState,
  ) {
    this.glow = new Float32Array(sim.ng);
  }

  /** the orientation sketch shrinks on narrow canvases */
  sketchScale(): number {
    return this.c.w < 380 ? 0.8 : 1;
  }
  /** right edge of the sketch card: near field uses the free space right of the (close) camera bar */
  sketchRight(): number {
    return this.vs.mode === 'nf' ? this.c.w - 12 : this.c.w - 34;
  }
  /** top of the sketch card: below the panel's HTML label (≈ 215 px wide) whenever they would collide */
  sketchTop(): number {
    return this.sketchRight() - 96 * this.sketchScale() < 222 ? 24 : 8;
  }

  geom(): TopGeom {
    const { w, h } = this.c;
    const r = Math.max(40, Math.min(0.3 * h, 0.21 * w));
    const cx = Math.max(r + 46, 0.34 * w);
    // the beam band (top at cy − r − 5) may tuck under the sketch card (top 8, height 84·scale) by ≤ ~10 px
    const cy = Math.min(h - r - 26, Math.max(0.56 * h, r + 60, this.sketchTop() + 84 * this.sketchScale() + r - 10));
    const nf = this.vs.mode === 'nf';
    const xd = nf ? cx + r * 1.85 : w - 18;
    const hb = Math.min(r * 1.25, h - cy - 40);
    return { cx, cy, r, xd, hb, s: r / (this.sim.D / 2) };
  }

  /** grain under a screen point (−1 if outside the sample) */
  pick(x: number, y: number): number {
    const g = this.geom();
    const lx = (x - g.cx) / g.r;
    const ly = -(y - g.cy) / g.r;
    if (lx * lx + ly * ly > 1) return -1;
    const c = Math.cos(-this.vs.omega);
    const s = Math.sin(-this.vs.omega);
    return P.grainAt(this.sim.grains, c * lx - s * ly, s * lx + c * ly);
  }
  /** polar angle of a screen point around the rotation axis (math convention, y up) */
  angleAt(x: number, y: number): number {
    const g = this.geom();
    return Math.atan2(-(y - g.cy), x - g.cx);
  }
  inside(x: number, y: number, pad = 0): boolean {
    const g = this.geom();
    return Math.hypot(x - g.cx, y - g.cy) <= g.r + pad;
  }

  draw(): void {
    const { ctx, w, h } = this.c;
    const sim = this.sim;
    const vs = this.vs;
    const G = this.geom();
    const { cx, cy, r, xd, hb } = G;
    const nf = vs.mode === 'nf';
    const T = sim.transmissionCentre;
    const xray = TOKENS.xray;
    ctx.save();
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);

    // ---- incoming beam (box beam far field / line beam near field: same footprint from above)
    const by0 = cy - r - 5;
    const by1 = cy + r + 5;
    const gIn = ctx.createLinearGradient(0, 0, cx, 0);
    gIn.addColorStop(0, rgba(xray, 0.05));
    gIn.addColorStop(1, rgba(xray, 0.24));
    ctx.fillStyle = gIn;
    ctx.fillRect(0, by0, cx, by1 - by0);
    ctx.strokeStyle = rgba(xray, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, by0);
    ctx.lineTo(cx, by0);
    ctx.moveTo(0, by1);
    ctx.lineTo(cx, by1);
    ctx.stroke();
    // flow chevrons
    ctx.fillStyle = rgba(xray, 0.45);
    const ph = vs.still ? 13 : (vs.t * 40) % 26;
    for (let x = ph - 26; x < cx - r - 8; x += 26) {
      for (const yy of [cy - r * 0.55, cy, cy + r * 0.55]) {
        ctx.beginPath();
        ctx.moveTo(x, yy - 4);
        ctx.lineTo(x + 5, yy);
        ctx.lineTo(x, yy + 4);
        ctx.fill();
      }
    }

    // ---- transmitted beam: brightness ∝ e^{−μ·chord(y)}
    const R = sim.D / 2;
    const gOut = ctx.createLinearGradient(0, by0, 0, by1);
    for (let k = 0; k <= 12; k++) {
      const f = k / 12;
      const yy = (f * 2 - 1) * ((by1 - by0) / 2 / r) * R;
      const chord = yy * yy < R * R ? 2 * Math.sqrt(R * R - yy * yy) : 0;
      gOut.addColorStop(f, rgba(xray, 0.24 * Math.exp(-sim.mu * chord)));
    }
    ctx.fillStyle = gOut;
    ctx.fillRect(cx, by0, xd - cx, by1 - by0);

    // ---- sample (rotating), in mathematical coordinates (y up), unit-disc units
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(r, -r);
    ctx.rotate(vs.omega);
    const lw = 1 / r;
    const now = vs.t;
    const glow = this.glow;
    glow.fill(0);
    const sel = vs.selected;
    let shown = 0;
    for (let q = vs.flashes.length - 1; q >= 0; q--) {
      const f = vs.flashes[q];
      const a = 1 - (now - f.t0) / FLASH_GRAIN;
      if (a <= 0) break;
      const g = sim.spGrain[f.spot];
      if (g !== sel) {
        if (shown >= MAX_GLOW) continue;
        shown++;
      }
      glow[g] = Math.max(glow[g], sel >= 0 && g !== sel ? 0.45 * a : a);
    }
    for (const g of sim.grains) {
      const p = g.poly;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
      ctx.closePath();
      ctx.fillStyle = rgb255(g.ipf, 0.5 + 0.5 * glow[g.id]);
      ctx.fill();
      if (glow[g.id] > 0) {
        ctx.fillStyle = `rgba(255,255,255,${0.55 * glow[g.id] * glow[g.id]})`;
        ctx.fill();
      }
    }
    // boundaries
    ctx.strokeStyle = 'rgba(5,8,14,0.85)';
    ctx.lineWidth = 2 * lw;
    ctx.lineJoin = 'round';
    for (const g of sim.grains) {
      const p = g.poly;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
      ctx.closePath();
      ctx.stroke();
    }
    // selected grain outline
    if (vs.selected >= 0) {
      const p = sim.grains[vs.selected].poly;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
      ctx.closePath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5 * lw;
      ctx.stroke();
    }
    // rim
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(220,230,245,0.55)';
    ctx.lineWidth = 1.2 * lw;
    ctx.stroke();
    // reference mark on the rim so the rotation is visible even for a uniform-looking slice
    ctx.beginPath();
    ctx.moveTo(1.0, 0);
    ctx.lineTo(1.09, 0);
    ctx.strokeStyle = 'rgba(233,238,245,0.8)';
    ctx.lineWidth = 2.5 * lw;
    ctx.stroke();
    ctx.restore();

    // ---- beam inside the sample, fading with depth
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.clip();
    const gS = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    gS.addColorStop(0, rgba(xray, 0.2));
    gS.addColorStop(0.5, rgba(xray, 0.2 * Math.sqrt(T)));
    gS.addColorStop(1, rgba(xray, 0.2 * T));
    ctx.fillStyle = gS;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.restore();

    // ---- diffracted rays of recent flashes
    const c = Math.cos(vs.omega);
    const s = Math.sin(vs.omega);
    ctx.lineCap = 'round';
    let rays = 0;
    for (let q = vs.flashes.length - 1; q >= 0; q--) {
      const f = vs.flashes[q];
      const age = now - f.t0;
      if (age > FLASH_RAY) break;
      const gi = sim.spGrain[f.spot];
      if (gi !== sel) {
        if (rays >= MAX_RAYS) continue;
        rays++;
      }
      const a = (1 - age / FLASH_RAY) * (sel >= 0 && gi !== sel ? 0.35 : 1);
      const gr = sim.grains[gi];
      // grain centroid in the lab at the moment of diffraction → slope of the projected ray
      const om = sim.spOmega[f.spot];
      const R0 = sim.D / 2;
      const pxd = (Math.cos(om) * gr.cx - Math.sin(om) * gr.cy) * R0;
      const pyd = (Math.sin(om) * gr.cx + Math.cos(om) * gr.cy) * R0;
      const x0 = cx + (c * gr.cx - s * gr.cy) * r;
      const y0 = cy - (s * gr.cx + c * gr.cy) * r;
      let y1: number;
      if (nf) {
        // near field (camera close by): true ray direction, so where the grain sits matters
        const slope = (sim.spY[f.spot] - pyd) / (FF.L - pxd);
        y1 = y0 - (xd - x0) * slope;
      } else {
        // far field: the bar is a side view of the 432 mm panel, so the ray ends where the spot really lands
        // (Y); the grain offset is kept only partly because the sample is drawn hugely enlarged (not to scale)
        const keep = 0.35;
        y1 = cy + keep * (y0 - cy) - (sim.spY[f.spot] / FF.half) * Math.max(10, hb - keep * r - 3);
      }
      const grad = ctx.createLinearGradient(x0, y0, xd, y1);
      grad.addColorStop(0, tint(gr.ipf, 0.4, 0.9 * a));
      grad.addColorStop(1, tint(gr.ipf, 0.4, 0.35 * a));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(xd, y1);
      ctx.stroke();
      if (Math.abs(y1 - cy) <= hb) {
        ctx.fillStyle = tint(gr.ipf, 0.6, a);
        ctx.beginPath();
        ctx.arc(xd, y1, 2.6, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // ---- detector bar
    ctx.fillStyle = 'rgba(160,180,205,0.18)';
    ctx.strokeStyle = 'rgba(190,205,225,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(xd - 3, cy - hb, 6, 2 * hb, 2);
    ctx.fill();
    ctx.stroke();
    // beam stop on the panel (far field)
    if (!nf) {
      ctx.fillStyle = '#1b2433';
      ctx.fillRect(xd - 7, cy - 4, 5, 8);
    }
    const detLabel = nf ? 'detector 7 mm away' : 'detector 1 m away';
    if (nf) {
      // the camera bar sits close to the sample: label it from the bar rightwards (clear of the hint below the rod)
      ctx.font = `600 10.5px ${FONT}`;
      const lx = Math.min(xd - 6, w - 4 - ctx.measureText(detLabel).width);
      txt(ctx, detLabel, lx, cy + hb + 14, { size: 10.5, color: TOKENS.ink2, weight: 600 });
      txt(ctx, "not to scale", lx, cy + hb + 27, { size: 10, color: TOKENS.ink3 });
    } else {
      txt(ctx, detLabel, xd + 3, cy + hb + 14, { size: 10.5, align: 'right', color: TOKENS.ink2, weight: 600 });
      txt(ctx, "not to scale", xd + 3, cy + hb + 27, { size: 10, align: 'right', color: TOKENS.ink3 });
    }

    // ---- rotation arrow + ω readout
    ctx.strokeStyle = rgba(vs.accent, 0.85);
    ctx.fillStyle = rgba(vs.accent, 0.85);
    ctx.lineWidth = 1.6;
    const ra = r + 11;
    const a0 = Math.PI * 0.62;
    const a1 = Math.PI * 0.86;
    ctx.beginPath();
    ctx.arc(cx, cy, ra, -a1, -a0);
    ctx.stroke();
    arrowHead(ctx, cx + ra * Math.cos(-a1), cy + ra * Math.sin(-a1), -a1 - Math.PI / 2, 5);
    const om = ((vs.omega / P.DEG) % 360 + 360) % 360;
    txt(ctx, `ω ${om.toFixed(0).padStart(3, ' ')}°`, cx + (ra + 6) * Math.cos(-Math.PI * 0.74) - 4, cy + (ra + 6) * Math.sin(-Math.PI * 0.74) - 2, {
      size: 11,
      align: 'right',
      color: vs.accent,
      weight: 700,
      mono: true,
      halo: true,
    });
    // rotation axis (pointing at the viewer)
    ctx.fillStyle = 'rgba(5,8,14,0.7)';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(233,238,245,0.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(233,238,245,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.6, 0, 2 * Math.PI);
    ctx.fill();

    // ---- labels
    txt(ctx, `X-rays · ${sim.E.toFixed(0)} keV`, 8, by0 - 8, { size: 11, color: xray, weight: 700 });
    const tp = T >= 0.995 ? '100' : T >= 0.1 ? (T * 100).toFixed(0) : T >= 0.001 ? (T * 100).toFixed(1) : '< 0.1';
    const tLabel = `${tp} % transmission`;
    ctx.font = `700 10.5px ${FONT}`;
    // between the rod and the detector bar if it fits there, else (near field: close camera) beyond the bar
    const tx = cx + r + 8 + ctx.measureText(tLabel).width < xd - 6 ? cx + r + 8 : xd + 8;
    txt(ctx, tLabel, tx, cy + 4, { size: 10.5, color: T < 0.01 ? TOKENS.bad : TOKENS.ink, weight: 700, halo: true });
    // scale bar
    const mm = sim.D / 2 >= 1.2 ? 1 : sim.D >= 1 ? 0.5 : 0.2;
    const sb = mm * G.s;
    const sy = Math.min(h - 10, cy + r + 30);
    ctx.strokeStyle = TOKENS.ink2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, sy);
    ctx.lineTo(10 + sb, sy);
    ctx.moveTo(10, sy - 3);
    ctx.lineTo(10, sy + 3);
    ctx.moveTo(10 + sb, sy - 3);
    ctx.lineTo(10 + sb, sy + 3);
    ctx.stroke();
    txt(ctx, mm >= 1 ? `${mm} mm` : `${mm * 1000} µm`, 10 + sb + 6, sy + 4, { size: 10.5, color: TOKENS.ink2 });
    if (!vs.touched) {
      txt(ctx, 'drag to turn · tap a grain', cx, cy + r + 19, { size: 11, align: 'center', color: TOKENS.ink, weight: 600, halo: true });
    }

    // ---- orientation sketch (whole rod, slice, beam, load)
    this.drawSketch(ctx, this.sketchRight(), this.sketchTop());
    ctx.restore();
  }

  /** small 3D card (right-aligned at x1, top y0): which slice we are looking at */
  private drawSketch(ctx: CanvasRenderingContext2D, xr: number, yt: number): void {
    const vs = this.vs;
    const W = 96;
    const H = 84;
    const ks = this.sketchScale();
    ctx.save();
    ctx.translate(xr, yt);
    ctx.scale(ks, ks);
    const x1 = 0;
    const y0 = 0;
    const x0 = x1 - W;
    ctx.fillStyle = 'rgba(11,17,27,0.88)';
    ctx.strokeStyle = 'rgba(150,180,220,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x0, y0, W, H, 8);
    ctx.fill();
    ctx.stroke();
    const mx = x0 + W / 2 + 6;
    const top = y0 + 22;
    const bot = y0 + H - 14;
    const rx = 12;
    const ry = 4;
    const mid = (top + bot) / 2 + 2;
    // rod
    ctx.fillStyle = 'rgba(150,165,185,0.22)';
    ctx.fillRect(mx - rx, top, 2 * rx, bot - top);
    ctx.strokeStyle = 'rgba(200,212,228,0.65)';
    ctx.beginPath();
    ctx.moveTo(mx - rx, top);
    ctx.lineTo(mx - rx, bot);
    ctx.moveTo(mx + rx, top);
    ctx.lineTo(mx + rx, bot);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(mx, top, rx, ry, 0, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(mx, bot, rx, ry, 0, 0, Math.PI);
    ctx.stroke();
    // slice
    ctx.fillStyle = rgba(vs.accent, 0.75);
    ctx.beginPath();
    ctx.ellipse(mx, mid, rx, ry, 0, 0, 2 * Math.PI);
    ctx.fill();
    // beam
    ctx.strokeStyle = TOKENS.xray;
    ctx.fillStyle = TOKENS.xray;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 + 6, mid);
    ctx.lineTo(mx - rx - 5, mid);
    ctx.stroke();
    arrowHead(ctx, mx - rx - 3, mid, 0, 4);
    // rotation axis + ω arrow
    ctx.strokeStyle = 'rgba(233,238,245,0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(mx, top - 10);
    ctx.lineTo(mx, bot + 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = vs.accent;
    ctx.fillStyle = vs.accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(mx, top - 6, rx + 5, 4, 0, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    arrowHead(ctx, mx - (rx + 5) * Math.cos(0.15 * Math.PI), top - 6 + 4 * Math.sin(0.15 * Math.PI), Math.PI * 0.95, 4);
    txt(ctx, 'ω', mx + rx + 8, top - 4, { size: 10, color: vs.accent, weight: 700 });
    // load arrows
    if (this.sim.eps > 0) {
      ctx.strokeStyle = TOKENS.warn;
      ctx.fillStyle = TOKENS.warn;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(mx - rx - 10, top + 6);
      ctx.lineTo(mx - rx - 10, top - 8);
      ctx.moveTo(mx - rx - 10, bot - 6);
      ctx.lineTo(mx - rx - 10, bot + 7);
      ctx.stroke();
      arrowHead(ctx, mx - rx - 10, top - 10, -Math.PI / 2, 4);
      arrowHead(ctx, mx - rx - 10, bot + 9, Math.PI / 2, 4);
    }
    if (ks === 1) txt(ctx, 'slice shown', x0 + 7, y0 + 12, { size: 9.5, color: TOKENS.ink3, weight: 600 });
    ctx.restore();
  }
}

// ====================================================================== 2 · detector

export class DetectorView {
  private acc: HTMLCanvasElement = document.createElement('canvas');
  private accCtx: CanvasRenderingContext2D = this.acc.getContext('2d')!;
  private sprites: HTMLCanvasElement[] = [];
  private noise: HTMLCanvasElement = document.createElement('canvas');
  private accVersion = -1;
  private accSize = 0;
  private accVisited = new Uint8Array(NBIN);
  /** far-field accumulation as a pixel buffer (device px, opaque black background) */
  private accImg: ImageData | null = null;
  private acc32: Uint32Array | null = null;
  /** per grain: spot profile (colour × alpha, 0–255) vs ρ² = (r / spot radius)², SPOT_LUT entries × RGB */
  private spotLut: Float32Array;
  // near-field persistence image
  private nfImg: ImageData | null = null;
  private nfBuf = new Float32Array(NF.npx * NF.npx * 3);
  private nfCanvas: HTMLCanvasElement = document.createElement('canvas');
  private lastBin = -1;
  /** set by the station when the selection changes */
  selVersion = 0;

  constructor(
    private c: Canvas2D,
    private sim: HedmSim,
    private vs: ViewState,
  ) {
    for (const g of sim.grains) {
      const s = document.createElement('canvas');
      s.width = s.height = 32;
      const x = s.getContext('2d')!;
      const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, tint(g.ipf, 0.72, 1));
      gr.addColorStop(0.28, tint(g.ipf, 0.35, 0.95));
      gr.addColorStop(0.6, tint(g.ipf, 0.1, 0.35));
      gr.addColorStop(1, tint(g.ipf, 0, 0));
      x.fillStyle = gr;
      x.fillRect(0, 0, 32, 32);
      this.sprites.push(s);
    }
    // the same radial profile, tabulated for the pixel-buffer renderer (premultiplied colour, linear in ρ)
    const stops: [number, number, number][] = [
      [0, 0.72, 1],
      [0.28, 0.35, 0.95],
      [0.6, 0.1, 0.35],
      [1, 0, 0],
    ];
    this.spotLut = new Float32Array(sim.ng * SPOT_LUT * 3);
    for (const g of sim.grains)
      for (let q = 0; q < SPOT_LUT; q++) {
        const rho = Math.sqrt(q / (SPOT_LUT - 1));
        let j = 0;
        while (j < stops.length - 2 && rho > stops[j + 1][0]) j++;
        const [r0, w0, a0] = stops[j];
        const [r1, w1, a1] = stops[j + 1];
        const t = Math.min(1, Math.max(0, (rho - r0) / (r1 - r0)));
        for (let ch = 0; ch < 3; ch++) {
          const c0 = (g.ipf[ch] + (1 - g.ipf[ch]) * w0) * a0;
          const c1 = (g.ipf[ch] + (1 - g.ipf[ch]) * w1) * a1;
          this.spotLut[(g.id * SPOT_LUT + q) * 3 + ch] = 255 * (c0 + (c1 - c0) * t);
        }
      }
    // faint detector noise texture
    const n = 96;
    this.noise.width = this.noise.height = n;
    const nx = this.noise.getContext('2d')!;
    const img = nx.createImageData(n, n);
    let seed = 12345;
    for (let i = 0; i < n * n; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const v = 10 + ((seed >>> 16) % 14);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v + 2;
      img.data[i * 4 + 2] = v + 6;
      img.data[i * 4 + 3] = 255;
    }
    nx.putImageData(img, 0, 0);
    this.nfCanvas.width = this.nfCanvas.height = NF.npx;
    this.nfImg = new ImageData(NF.npx, NF.npx);
  }

  /** detector square: centre, side, px per mm */
  geom(): { dcx: number; dcy: number; S: number; k: number } {
    const { w, h } = this.c;
    const top = 26;
    const bottom = 24;
    const S = Math.max(60, Math.min(w - 24, h - top - bottom));
    const half = this.vs.mode === 'nf' ? NF.half : FF.half;
    return { dcx: w / 2, dcy: top + (h - top - bottom) / 2, S, k: S / (2 * half) };
  }

  /** nearest recorded far-field spot to a screen point → grain (−1 if none within 10 px) */
  pick(x: number, y: number): number {
    if (this.vs.mode !== 'ff') return -1;
    const { dcx, dcy, k } = this.geom();
    const sim = this.sim;
    let best = -1;
    let bd = 100;
    for (let i = 0; i < sim.n; i++) {
      if (!sim.detectable(i) || !sim.visited[sim.spBin[i]]) continue;
      const sx = dcx - sim.spY[i] * k;
      const sy = dcy - sim.spZ[i] * k;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bd) {
        bd = d;
        best = sim.spGrain[i];
      }
    }
    return best;
  }

  /** spot size (px) and plastic smearing: tangential = misorientation spread (rad), radial = strain spread × mag;
   *  both are multiplied by the spot's ring radius in px (arc length R·Δη, radial ΔR = R·Δε) */
  private spotGeom(): { base: number; tang: number; rad: number } {
    const { k } = this.geom();
    const sim = this.sim;
    const base = Math.max(2.5, Math.min(5, 3.6 * k));
    return { base, tang: sim.fx.spread, rad: sim.fx.hetero * sim.mag };
  }

  /** draw spot i into the accumulation canvas (device px) */
  private stamp(x: CanvasRenderingContext2D, i: number, dcx: number, dcy: number, k: number, sg: { base: number; tang: number; rad: number }, dim: number): void {
    const sim = this.sim;
    const Y = sim.spY[i];
    const Z = sim.spZ[i];
    const sx = dcx - Y * k;
    const sy = dcy - Z * k;
    const I = sim.spI[i];
    const a = Math.min(1, Math.max(0.1, 1 - Math.exp(-1.1 * I))) * dim * Math.min(1, I / 0.05);
    if (a < 0.01) return;
    const Rpx = Math.hypot(Y, Z) * k;
    const lt = Math.max(sg.base, Rpx * sg.tang + sg.base * 0.6);
    const lr = Math.max(sg.base, Rpx * sg.rad + sg.base * 0.6);
    x.globalAlpha = a;
    const spr = this.sprites[sim.spGrain[i]];
    if (lt < sg.base * 1.15 && lr < sg.base * 1.15) {
      x.drawImage(spr, sx - sg.base, sy - sg.base, sg.base * 2, sg.base * 2);
      return;
    }
    const ang = Math.atan2(-Z, -Y); // screen angle of the radial direction
    x.save();
    x.translate(sx, sy);
    x.rotate(ang);
    x.drawImage(spr, -lr, -lt, lr * 2, lt * 2);
    x.restore();
  }

  /**
   * Max-blend spot i into the accumulation buffer (device px). Same look as stamp() with 'lighten', but as plain
   * pixel arithmetic: ~5000 sprite drawImage calls cost ~40 ms per rebuild, this ~2–5 ms. The spot is an
   * ellipse, semi-axes lr (radial) × lt (tangential); each row is filled only over its exact span.
   */
  private stampBuf(buf: Uint8ClampedArray, N: number, i: number, cx: number, cy: number, k: number, base: number, tang: number, rad: number): void {
    const sim = this.sim;
    const Y = sim.spY[i];
    const Z = sim.spZ[i];
    const I = sim.spI[i];
    const a = Math.min(1, Math.max(0.1, 1 - Math.exp(-1.1 * I))) * Math.min(1, I / 0.05);
    if (a < 0.01) return;
    const sx = cx - Y * k;
    const sy = cy - Z * k;
    const R0 = Math.sqrt(Y * Y + Z * Z);
    const Rpx = R0 * k;
    const lt = Math.max(base, Rpx * tang + base * 0.6);
    const lr = Math.max(base, Rpx * rad + base * 0.6);
    const ir = 1 / (lr * lr);
    const it = 1 / (lt * lt);
    // ρ² = P dx² + 2Q dx dy + Rr dy²; radial unit vector on screen (c, sn) = −(Y, Z)/R (circle: no rotation needed)
    let Pq = ir;
    let Qq = 0;
    let Rq = ir;
    if (lt !== lr && R0 > 0) {
      const c = -Y / R0;
      const sn = -Z / R0;
      Pq = c * c * ir + sn * sn * it;
      Qq = c * sn * (ir - it);
      Rq = sn * sn * ir + c * c * it;
    }
    const hy = Math.sqrt(Pq / (Pq * Rq - Qq * Qq));
    const y0 = Math.max(0, Math.ceil(sy - hy - 0.5));
    const y1 = Math.min(N - 1, Math.floor(sy + hy - 0.5));
    const lut = this.spotLut;
    const lo = sim.spGrain[i] * SPOT_LUT * 3;
    const scale = SPOT_LUT - 1;
    for (let iy = y0; iy <= y1; iy++) {
      const dy = iy + 0.5 - sy;
      const disc = Qq * Qq * dy * dy - Pq * (Rq * dy * dy - 1);
      if (disc <= 0) continue;
      const sq = Math.sqrt(disc);
      const xa = Math.max(0, Math.ceil(sx + (-Qq * dy - sq) / Pq - 0.5));
      const xb = Math.min(N - 1, Math.floor(sx + (-Qq * dy + sq) / Pq - 0.5));
      let o = (iy * N + xa) * 4;
      for (let ix = xa; ix <= xb; ix++, o += 4) {
        const dx = ix + 0.5 - sx;
        const r2 = Pq * dx * dx + 2 * Qq * dx * dy + Rq * dy * dy;
        if (r2 >= 1) continue;
        const q = lo + ((r2 * scale) | 0) * 3;
        const vr = lut[q] * a;
        const vg = lut[q + 1] * a;
        const vb = lut[q + 2] * a;
        if (vr > buf[o]) buf[o] = vr;
        if (vg > buf[o + 1]) buf[o + 1] = vg;
        if (vb > buf[o + 2]) buf[o + 2] = vb;
      }
    }
  }

  /** rebuild or extend the accumulated far-field image */
  private updateAcc(): void {
    const sim = this.sim;
    const { S, k } = this.geom();
    const dpr = this.c.dpr;
    const size = Math.round(S * dpr);
    let full = !this.accImg || size !== this.accSize || this.accVersion !== sim.ffVersion;
    // coverage was reset (new scan) → rebuild from scratch
    if (!full)
      for (let b = 0; b < NBIN; b++)
        if (this.accVisited[b] && !sim.visited[b]) {
          full = true;
          break;
        }
    if (full) {
      if (!this.accImg || size !== this.accSize) {
        this.acc.width = this.acc.height = size;
        this.accImg = this.accCtx.createImageData(size, size);
        this.acc32 = new Uint32Array(this.accImg.data.buffer);
        this.accSize = size;
      }
      this.acc32!.fill(0xff000000); // opaque black (little-endian RGBA)
      this.accVersion = sim.ffVersion;
      this.accVisited.fill(0);
    }
    // maximum projection over ω (as in ff-HEDM spot viewers): overlapping spots keep their own colour
    // instead of summing to white once a full turn has been recorded
    const buf = this.accImg!.data;
    const sg = this.spotGeom();
    const half = size / 2;
    let dirty = full;
    for (let b = 0; b < NBIN; b++) {
      if (!sim.visited[b] || this.accVisited[b]) continue;
      this.accVisited[b] = 1;
      dirty = true;
      for (let q = sim.binStart[b]; q < sim.binStart[b + 1]; q++) {
        const i = sim.order[q];
        if (!sim.spOn[i]) continue;
        this.stampBuf(buf, size, i, half, half, k * dpr, sg.base * dpr, sg.tang, sg.rad);
      }
    }
    if (dirty) this.accCtx.putImageData(this.accImg!, 0, 0);
  }

  invalidate(): void {
    this.accVersion = -1;
  }

  draw(dt: number): void {
    if (this.vs.mode === 'ff') this.drawFF();
    else this.drawNF(dt);
  }

  private drawFF(): void {
    const { ctx, w, h } = this.c;
    const sim = this.sim;
    const vs = this.vs;
    this.updateAcc();
    const { dcx, dcy, S, k } = this.geom();
    const x0 = dcx - S / 2;
    const y0 = dcy - S / 2;
    ctx.save();
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    // panel
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.noise, x0, y0, S, S);
    ctx.globalAlpha = 1;
    // guide rings at the unstrained Bragg angles and, under load, the fitted rings. Drawn BEFORE the spots
    // (which are max-blended on top), so the lines show between spots but never hide them.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, S, S);
    ctx.clip();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = sim.eps > 0 ? 'rgba(233,238,245,0.5)' : 'rgba(233,238,245,0.2)';
    ctx.lineWidth = 1;
    const lam = sim.lambda;
    const labels: { x: number; y: number; s: string }[] = [];
    sim.fams.forEach((f, fi) => {
      const tt = P.twoThetaOf(f.d, lam);
      const Rm = FF.L * Math.tan(tt);
      const Rp = Rm * k;
      if (Rm > FF.half * Math.SQRT2) return;
      ctx.beginPath();
      ctx.arc(dcx, dcy, Rp, 0, 2 * Math.PI);
      ctx.stroke();
      if (Rm > FF.half - 4) return; // only partly on the panel: no label
      // label position: staggered azimuths
      for (const etaDeg of [24 + 10 * fi, 20 + 10 * fi]) {
        const e = etaDeg * P.DEG;
        const lx = dcx + Rp * Math.cos(e);
        const ly = dcy - Rp * Math.sin(e);
        if (lx > x0 + 14 && lx < x0 + S - 14 && ly > y0 + 10 && ly < y0 + S - 8) {
          // the first ring also names its scattering angle, which the caption quotes
          labels.push({ x: lx, y: ly, s: fi === 0 ? `${f.label} · 2θ = ${(tt / P.DEG).toFixed(2)}°` : f.label });
          break;
        }
      }
    });
    ctx.setLineDash([]);
    // fitted rings under load: ε(η) = ε_⊥ + (ε_∥ − ε_⊥) sin²η through the recorded spots
    if (sim.eps > 0) {
      ctx.strokeStyle = rgba(vs.accent, 0.6);
      ctx.lineWidth = 1.2;
      for (const fit of sim.ringFits()) {
        ctx.beginPath();
        for (let q = 0; q <= 96; q++) {
          const e = (q / 96) * 2 * Math.PI;
          const sn = Math.sin(e);
          const R = sim.fitRadius(fit, sn * sn) * k;
          const px = dcx + R * Math.cos(e);
          const py = dcy - R * sn;
          if (q === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'lighten'; // the buffer is opaque black where empty: keep noise and rings
    ctx.drawImage(this.acc, x0, y0, S, S);
    ctx.globalCompositeOperation = 'source-over';
    // selection: dim everything else, re-draw the grain's spots on top
    if (vs.selected >= 0) {
      ctx.fillStyle = 'rgba(5,8,14,0.62)';
      ctx.fillRect(x0, y0, S, S);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, S, S);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const sg = this.spotGeom();
      for (let i = 0; i < sim.n; i++) {
        if (sim.spGrain[i] !== vs.selected || !sim.spOn[i] || !sim.visited[sim.spBin[i]]) continue;
        this.stamp(ctx, i, dcx, dcy, k, sg, 1);
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < sim.n; i++) {
        if (sim.spGrain[i] !== vs.selected || !sim.detectable(i) || !sim.visited[sim.spBin[i]]) continue;
        const sx = dcx - sim.spY[i] * k;
        const sy = dcy - sim.spZ[i] * k;
        ctx.moveTo(sx + 5, sy);
        ctx.arc(sx, sy, 5, 0, 2 * Math.PI);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(190,205,225,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, S - 1, S - 1);
    for (const l of labels) {
      ctx.font = `600 10px ${FONT}`;
      const x = Math.min(l.x + 3, x0 + S - ctx.measureText(l.s).width - 5);
      txt(ctx, l.s, x, l.y - 3, { size: 10, color: 'rgba(233,238,245,0.78)', weight: 600, halo: true });
    }

    // beam stop
    ctx.fillStyle = '#1b2433';
    ctx.strokeStyle = 'rgba(190,205,225,0.5)';
    ctx.beginPath();
    ctx.arc(dcx, dcy, Math.max(3.5, FF.stop * k), 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    // flashes: expanding rings on new spots
    const now = vs.t;
    let rings = 0;
    for (let q = vs.flashes.length - 1; q >= 0; q--) {
      const f = vs.flashes[q];
      const age = now - f.t0;
      if (age > 0.6) break;
      if (!sim.spOn[f.spot]) continue;
      if (sim.spGrain[f.spot] !== vs.selected) {
        if (rings >= MAX_RINGS) continue;
        rings++;
      }
      const a = 1 - age / 0.6;
      const g = sim.grains[sim.spGrain[f.spot]];
      ctx.strokeStyle = tint(g.ipf, 0.5, a);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      // reduced motion and not turning: the ring fades in place instead of expanding
      ctx.arc(dcx - sim.spY[f.spot] * k, dcy - sim.spZ[f.spot] * k, vs.still ? 8 : 4 + 10 * (1 - a), 0, 2 * Math.PI);
      ctx.stroke();
    }

    // badges
    if (sim.eps > 0) {
      // load direction (vertical on the detector): outside the panel when there is room
      const ax = w - (x0 + S) >= 34 ? x0 + S + 22 : x0 + S - 14;
      const ay = dcy;
      ctx.strokeStyle = TOKENS.warn;
      ctx.fillStyle = TOKENS.warn;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay - 18);
      ctx.lineTo(ax, ay + 18);
      ctx.stroke();
      arrowHead(ctx, ax, ay - 20, -Math.PI / 2, 4.5);
      arrowHead(ctx, ax, ay + 20, Math.PI / 2, 4.5);
      txt(ctx, 'pull', ax - 6, ay + 3, { size: 10, align: 'right', color: TOKENS.warn, weight: 700, halo: true });
    }
    // footer
    const cov = sim.nVisited;
    const nRec = sim.recordedSpots();
    const fy = y0 + S + 15;
    txt(ctx, `turned ${cov}° · ${nRec} spots`, x0, fy, { size: 10.5, color: TOKENS.ink2 });
    if (sim.eps > 0) {
      // line legend: dashed = before pulling, solid = fitted ring under load
      const t2 = sim.mag > 1 ? `under load ×${sim.mag}` : 'under load';
      ctx.font = `500 10.5px ${FONT}`;
      const w2 = ctx.measureText(t2).width;
      const w1 = ctx.measureText('before').width;
      let xx = x0 + S - w2;
      txt(ctx, t2, xx, fy, { size: 10.5, color: TOKENS.ink2 });
      xx -= 20;
      ctx.strokeStyle = vs.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xx, fy - 4);
      ctx.lineTo(xx + 15, fy - 4);
      ctx.stroke();
      xx -= 10 + w1;
      txt(ctx, 'before', xx, fy, { size: 10.5, color: TOKENS.ink2 });
      xx -= 20;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(233,238,245,0.7)';
      ctx.beginPath();
      ctx.moveTo(xx, fy - 4);
      ctx.lineTo(xx + 15, fy - 4);
      ctx.stroke();
      ctx.setLineDash([]);
    } else txt(ctx, "colour identifies grain", x0 + S, fy, { size: 10.5, align: 'right', color: TOKENS.ink3 });
    if (cov === 0) pill(ctx, "Press ▶ or drag the sample to rotate it", dcx, dcy + 40, { size: 11, align: 'center' });
    ctx.restore();
  }

  private drawNF(dt: number): void {
    const { ctx, w, h } = this.c;
    const sim = this.sim;
    const vs = this.vs;
    const { dcx, dcy, S, k } = this.geom();
    const x0 = dcx - S / 2;
    const y0 = dcy - S / 2;
    // persistence: decay, then add the frame of the current ω bin
    const decay = Math.exp(-Math.max(0.001, dt) / 0.16); // short afterglow: the live 1° frame plus a brief trail
    const buf = this.nfBuf;
    for (let i = 0; i < buf.length; i++) buf[i] *= decay;
    const b = Math.floor((((vs.omega / P.DEG) % 360) + 360) % 360);
    if (b !== this.lastBin || dt > 0) {
      this.lastBin = b;
      const nt = sim.renderFrame(b);
      const fr = sim.frameBuf;
      const tb = sim.touchedBuf;
      for (let q = 0; q < nt; q++) {
        const p = tb[q];
        const g = fr[p];
        if (g === 255) {
          buf[p * 3] = buf[p * 3 + 1] = buf[p * 3 + 2] = 0.8;
        } else {
          const col = sim.grains[g - 1].ipf;
          buf[p * 3] = Math.max(buf[p * 3], 0.35 + 0.65 * col[0]);
          buf[p * 3 + 1] = Math.max(buf[p * 3 + 1], 0.35 + 0.65 * col[1]);
          buf[p * 3 + 2] = Math.max(buf[p * 3 + 2], 0.35 + 0.65 * col[2]);
        }
      }
      sim.clearFrame(nt);
    }
    const img = this.nfImg!;
    const d = img.data;
    for (let p = 0; p < NF.npx * NF.npx; p++) {
      d[p * 4] = 8 + Math.min(247, buf[p * 3] * 247);
      d[p * 4 + 1] = 11 + Math.min(244, buf[p * 3 + 1] * 244);
      d[p * 4 + 2] = 18 + Math.min(237, buf[p * 3 + 2] * 237);
      d[p * 4 + 3] = 255;
    }
    this.nfCanvas.getContext('2d')!.putImageData(img, 0, 0);
    ctx.save();
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.nfCanvas, x0, y0, S, S);
    ctx.strokeStyle = 'rgba(190,205,225,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, S - 1, S - 1);
    // direct (line) beam, blocked: a thin dark bar across the sample width at Z ≈ 0
    const R = sim.D / 2;
    const bw = Math.min(S, 2 * R * k);
    ctx.fillStyle = 'rgba(27,36,51,0.95)';
    ctx.fillRect(dcx - bw / 2, dcy - 2, bw, 4);
    ctx.strokeStyle = rgba(TOKENS.xray, 0.5);
    ctx.strokeRect(dcx - bw / 2, dcy - 2, bw, 4);
    txt(ctx, "line beam · blocked", dcx, dcy + 15, { size: 10, align: 'center', color: TOKENS.ink3, halo: true });
    // scale bar 0.5 mm
    const sb = 0.5 * k;
    ctx.strokeStyle = TOKENS.ink2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0 + 8, y0 + S - 10);
    ctx.lineTo(x0 + 8 + sb, y0 + S - 10);
    ctx.stroke();
    txt(ctx, '0.5 mm', x0 + 8 + sb + 5, y0 + S - 6, { size: 10, color: TOKENS.ink2, halo: true });
    pill(ctx, `ω ${b}° · live`, x0 + S, Math.max(10, y0 - 12), { size: 10, align: 'right', color: vs.accent, mono: true });
    const fy = y0 + S + 15;
    txt(ctx, "each streak corresponds to a grain, viewed side-on", x0, fy, { size: 10.5, color: TOKENS.ink2 });
    if (sim.nVisited === 0) pill(ctx, "Press ▶ or drag the sample to rotate it", dcx, dcy + 44, { size: 11, align: 'center' });
    ctx.restore();
  }
}

// ====================================================================== 3 · penetration plot

const MAT_STYLE: { id: P.MatId; color: string; label: string }[] = [
  { id: 'al', color: '#9aa6b8', label: 'aluminium' },
  { id: 'ti', color: '#a78bfa', label: 'titanium' },
  { id: 'fe', color: '#f59e0b', label: 'steel' },
  { id: 'ni', color: '', label: "nickel sample" },
];

export class PenView {
  private tagW = -1;
  private tagRight = 200;
  private xs = new Float64Array(80);
  private ys: Record<P.MatId, Float64Array> = { al: new Float64Array(80), ti: new Float64Array(80), fe: new Float64Array(80), ni: new Float64Array(80) };
  constructor(
    private c: Canvas2D,
    private sim: HedmSim,
    private vs: ViewState,
  ) {
    for (let i = 0; i < 80; i++) {
      const E = 10 * Math.pow(20, i / 79);
      this.xs[i] = E;
      for (const m of MAT_STYLE) this.ys[m.id][i] = P.attLengthMm(P.MATERIALS[m.id], E);
    }
  }

  draw(): void {
    const { ctx, w, h } = this.c;
    const sim = this.sim;
    const vs = this.vs;
    ctx.save();
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    const fmtY = (v: number) => (v >= 10 ? `${v / 10} cm` : v >= 1 ? `${v} mm` : v >= 0.1 ? `${v} mm` : `${Math.round(v * 1000)} µm`);
    // header readout: on the label row if it clears the panel's HTML label, else on a row of its own
    const E = sim.E;
    const att = P.attLengthMm(sim.ni, E);
    const lab = `${E.toFixed(0)} keV: ${fmtLen(att)} into nickel`;
    ctx.font = `700 10.5px ${FONT}`;
    if (this.tagW !== w) {
      // the HTML label's extent changes only with the panel width: read it once per width (no layout per frame)
      const tag = this.c.canvas.parentElement?.querySelector<HTMLElement>('.stn-canvas-label');
      this.tagRight = tag && tag.offsetWidth ? tag.offsetLeft + tag.offsetWidth : 200;
      this.tagW = w;
    }
    const tagRight = this.tagRight;
    const twoRow = w - 8 - ctx.measureText(lab).width < tagRight + 10;
    const top = twoRow ? 36 : 22;
    const f = plotFrame(
      ctx,
      { x: 0, y: top, w: w - 4, h: h - top - 2 },
      { min: 10, max: 200, log: true, label: 'X-ray energy (keV)', ticks: [10, 20, 50, 100, 200], format: (v) => `${v}` },
      { min: 0.003, max: 60, log: true, ticks: [0.01, 0.1, 1, 10], format: fmtY },
    );
    // HEXM band
    const hx0 = f.px(35);
    const hx1 = f.px(120);
    ctx.fillStyle = rgba(vs.accent, 0.09);
    ctx.fillRect(hx0, f.y1, hx1 - hx0, f.y0 - f.y1);
    const hexmLab = "HEXM · 35 to 120 keV";
    const hexmL = txt(ctx, hexmLab, (hx0 + hx1) / 2, f.y1 + 12, { size: 10, align: 'center', color: rgba(vs.accent, 0.95), weight: 700, halo: true });
    // lab X-ray tube for comparison: Mo Kα, 17.5 keV (Cu Kα, 8 keV, is off the left edge)
    const xm = f.px(17.48);
    ctx.fillStyle = TOKENS.ink3;
    ctx.beginPath();
    ctx.moveTo(xm, f.y0 - 1);
    ctx.lineTo(xm - 4, f.y0 - 8);
    ctx.lineTo(xm + 4, f.y0 - 8);
    ctx.closePath();
    ctx.fill();
    txt(ctx, 'lab X-ray tube', xm + 6, f.y0 - 4, { size: 9.5, color: TOKENS.ink3, weight: 600, halo: true });
    // sample size line
    const yD = f.py(sim.D);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(233,238,245,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(f.x0, yD);
    ctx.lineTo(f.x1, yD);
    ctx.stroke();
    ctx.restore();
    txt(ctx, `sample ⌀ ${sim.D.toFixed(1)} mm`, f.x0 + 5, yD - 5, { size: 10, color: TOKENS.ink, weight: 600, halo: true });
    // curves
    for (const m of MAT_STYLE) {
      const col = m.id === 'ni' ? vs.accent : m.color;
      line(ctx, f, this.xs, this.ys[m.id], col, m.id === 'ni' ? 2.6 : 1.4);
    }
    // legend (lower right: every curve is high there)
    let ly = f.y0 - 28 - 13 * (MAT_STYLE.length - 1);
    const lx = f.x1 - 104;
    for (const m of [...MAT_STYLE].reverse()) {
      const col = m.id === 'ni' ? vs.accent : m.color;
      ctx.fillStyle = col;
      ctx.fillRect(lx, ly - 4, 12, m.id === 'ni' ? 3 : 2);
      txt(ctx, m.label, lx + 17, ly, { size: 10, color: m.id === 'ni' ? TOKENS.ink : TOKENS.ink2, weight: m.id === 'ni' ? 700 : 500, base: 'middle' });
      ly += 13;
    }
    // current energy
    const xe = f.px(E);
    const ye = f.py(att);
    ctx.strokeStyle = rgba(vs.accent, 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xe, f.y0);
    ctx.lineTo(xe, f.y1);
    ctx.stroke();
    ctx.fillStyle = vs.accent;
    ctx.beginPath();
    ctx.arc(xe, ye, 4.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // readout in the header row (never collides with the curves)
    txt(ctx, lab, w - 8, twoRow ? 28 : 14, { size: 10.5, align: 'right', color: vs.accent, weight: 700, base: 'middle' });
    // best-signal energy for this rod (λ² e^{−μD})
    const Eb = P.bestEnergy(sim.ni, sim.D, 10, 200);
    const xb = f.px(Eb);
    ctx.fillStyle = TOKENS.good;
    ctx.beginPath();
    ctx.moveTo(xb, f.y0 - 1);
    ctx.lineTo(xb - 5, f.y0 - 9);
    ctx.lineTo(xb + 5, f.y0 - 9);
    ctx.closePath();
    ctx.fill();
    const bestLabel = `highest spot intensity ≈ ${Eb.toFixed(0)} keV`;
    ctx.font = `600 9.5px ${FONT}`;
    const bestOnLeft = xb + 7 + ctx.measureText(bestLabel).width > f.x1 - 3;
    txt(ctx, bestLabel, xb + (bestOnLeft ? -7 : 7), f.y0 - 6, { size: 9.5, align: bestOnLeft ? 'right' : 'left', color: TOKENS.good, weight: 600, halo: true });
    // data note (top left), shortened if it would run into the HEXM band label
    const dataLong = "Depth at 1/e intensity · 37 % · NIST data";
    ctx.font = `500 9.5px ${FONT}`;
    const roomL = (hx0 + hx1) / 2 - hexmL / 2 - 8 - (f.x0 + 6);
    txt(ctx, ctx.measureText(dataLong).width <= roomL ? dataLong : ctx.measureText('1/e depth · NIST').width <= roomL ? '1/e depth · NIST' : 'NIST', f.x0 + 6, f.y1 + 12, { size: 9.5, color: TOKENS.ink3 });
    ctx.restore();
  }
}

// ====================================================================== 4 · answer: indexed grains / reconstructed map

export class AnswerView {
  private ipfKey: HTMLCanvasElement = document.createElement('canvas');
  private map: HTMLCanvasElement = document.createElement('canvas');
  private mapImg: ImageData;
  private pop = new Float32Array(64);
  private wasFound = new Uint8Array(64);
  stats = { mapped: 0, correct: 0, meanC: 0 };
  private bestCache: Int16Array;
  private confCache: Float32Array;
  private segG: number[] = [];
  private segS: number[] = [];
  private statsVersion = -1;
  private lastRecompute = -1;

  constructor(
    private c: Canvas2D,
    private sim: HedmSim,
    private vs: ViewState,
  ) {
    // IPF colour key (standard triangle 001–101–111)
    const W = 64;
    const H = 52;
    this.ipfKey.width = W;
    this.ipfKey.height = H;
    const kx = this.ipfKey.getContext('2d')!;
    const im = kx.createImageData(W, H);
    const U = new Float64Array(9);
    // corners (screen): 001 bottom-left, 101 bottom-right, 111 top-right
    const A = [3, H - 3];
    const B = [W - 3, H - 3];
    const C = [W - 3, 3];
    const d001 = [0, 0, 1];
    const d101 = [Math.SQRT1_2, 0, Math.SQRT1_2];
    const d111 = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        // barycentric
        const det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
        const l1 = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / det;
        const l2 = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -0.01 || l2 < -0.01 || l3 < -0.01) continue;
        const v = [0, 1, 2].map((i) => l1 * d001[i] + l2 * d101[i] + l3 * d111[i]);
        const n = Math.hypot(v[0], v[1], v[2]);
        U[6] = v[0] / n;
        U[7] = v[1] / n;
        U[8] = v[2] / n;
        const col = P.ipfColor(U);
        const o = (y * W + x) * 4;
        im.data[o] = col[0] * 255;
        im.data[o + 1] = col[1] * 255;
        im.data[o + 2] = col[2] * 255;
        im.data[o + 3] = 255;
      }
    kx.putImageData(im, 0, 0);
    this.map.width = this.map.height = 48;
    this.mapImg = new ImageData(48, 48);
    this.bestCache = new Int16Array(sim.nv).fill(-1);
    this.confCache = new Float32Array(sim.nv);
  }

  /** layout: disc centre & radius, legend x */
  geom(): { cx: number; cy: number; r: number; lx: number } {
    const { w, h } = this.c;
    const legendW = Math.min(150, Math.max(104, w * 0.3));
    const r = Math.max(30, Math.min((h - 54) / 2, (w - legendW - 30) / 2));
    const cx = 14 + r + Math.max(0, (w - legendW - 28 - 2 * r) / 2);
    return { cx, cy: 24 + r + Math.max(0, (h - 46 - 2 * r) / 2), r, lx: w - legendW };
  }

  pick(x: number, y: number): number {
    const { cx, cy, r } = this.geom();
    const ux = (x - cx) / r;
    const uy = -(y - cy) / r;
    if (ux * ux + uy * uy > 1.05) return -1;
    if (this.vs.mode === 'nf') {
      // the map is drawn turned by ω (like panel 1): back to the sample frame
      const c = Math.cos(-this.vs.omega);
      const s = Math.sin(-this.vs.omega);
      const sx = c * ux - s * uy;
      const sy = s * ux + c * uy;
      const N = 48;
      const i = Math.floor(((sx + 1) / 2) * N);
      const j = Math.floor(((1 - sy) / 2) * N);
      if (i < 0 || j < 0 || i >= N || j >= N) return -1;
      const v = this.sim.vIndex[j * N + i];
      if (v < 0) return -1;
      const b = this.sim.best(v);
      return b.c >= 0.5 ? b.g : -1;
    }
    let best = -1;
    let bd = Infinity;
    const c = Math.cos(this.vs.omega);
    const s = Math.sin(this.vs.omega);
    for (const g of this.sim.grains) {
      if (!this.sim.found[g.id]) continue;
      const d = (ux - (c * g.cx - s * g.cy)) ** 2 + (uy - (s * g.cx + c * g.cy)) ** 2;
      if (d < bd) {
        bd = d;
        best = g.id;
      }
    }
    return bd < 0.06 ? best : -1;
  }

  draw(dt: number): void {
    const { ctx, w, h } = this.c;
    ctx.save();
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    if (this.vs.mode === 'ff') this.drawFF(dt);
    else this.drawNF();
    ctx.restore();
  }

  private drawFF(dt: number): void {
    const { ctx, w } = this.c;
    const sim = this.sim;
    const vs = this.vs;
    const { cx, cy, r, lx } = this.geom();
    // sample outline (sample frame, ω = 0)
    ctx.fillStyle = 'rgba(150,170,200,0.05)';
    ctx.strokeStyle = 'rgba(200,212,228,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    const range = 0.007;
    const L = lut('rdbu');
    const co = Math.cos(vs.omega);
    const so = Math.sin(vs.omega);
    for (const g of sim.grains) {
      const f = sim.found[g.id];
      // a newly found grain pops (grows, then settles); with reduced motion and not turning it just appears
      if (f && !this.wasFound[g.id]) this.pop[g.id] = vs.still ? 0 : 1;
      this.wasFound[g.id] = f;
      this.pop[g.id] = vs.still ? 0 : Math.max(0, this.pop[g.id] - dt * 2.2);
      if (!f) continue;
      const ez = sim.strain[g.id * 9 + 8];
      const ki = Math.max(0, Math.min(255, Math.round(((ez + range) / (2 * range)) * 255)));
      const x = cx + (co * g.cx - so * g.cy) * r;
      const y = cy - (so * g.cx + co * g.cy) * r;
      const rad = Math.max(4, Math.sqrt(g.area) * r * 0.62) * (1 + 0.5 * this.pop[g.id]);
      ctx.fillStyle = `rgb(${L[ki * 3]},${L[ki * 3 + 1]},${L[ki * 3 + 2]})`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = rgb255(g.ipf);
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (g.id === vs.selected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, rad + 4, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    const nf = sim.nFound;
    if (nf === 0) {
      // empty state: say what will appear here
      const msg = ["As the sample rotates,", "positions and orientations", "are fitted to the spots.", "Grain centres appear here."];
      const lh = 14;
      let yy = cy - ((msg.length - 1) * lh) / 2 + 4;
      for (const m of msg) {
        txt(ctx, m, cx, yy, { size: r < 70 ? 10 : 11, align: 'center', color: TOKENS.ink3 });
        yy += lh;
      }
    }
    txt(ctx, `${nf} / ${sim.ng} grains found`, cx, cy + r + 15, { size: 11, align: 'center', color: nf ? vs.accent : TOKENS.ink3, weight: 700 });
    // legend: colour bar
    const bx = lx;
    let by = para(ctx, 'atom spacing along pull', bx, 34, w - bx - 8, this.c.h - 4, { size: 10.5, color: TOKENS.ink, weight: 600, lh: 13 }) - 5;
    const bw = Math.min(w - bx - 12, 130);
    for (let i = 0; i < bw; i++) {
      const k = Math.round((i / (bw - 1)) * 255);
      ctx.fillStyle = `rgb(${L[k * 3]},${L[k * 3 + 1]},${L[k * 3 + 2]})`;
      ctx.fillRect(bx + i, by, 1.2, 9);
    }
    by += 21;
    txt(ctx, `−${(range * 100).toFixed(1)}%`, bx, by, { size: 9.5, color: TOKENS.ink2, mono: true });
    txt(ctx, '0', bx + bw / 2, by, { size: 9.5, align: 'center', color: TOKENS.ink2, mono: true });
    txt(ctx, `+${(range * 100).toFixed(1)}%`, bx + bw, by, { size: 9.5, align: 'right', color: TOKENS.ink2, mono: true });
    by += 22;
    // ring = orientation
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(bx + 7, by - 4, 6, 0, 2 * Math.PI);
    ctx.stroke();
    by = para(ctx, 'ring = grain colour', bx + 19, by, w - bx - 27, this.c.h - 4, { size: 10, color: TOKENS.ink2, lh: 12 }) + 6;
    const maxW = w - bx - 8;
    const yMax = this.c.h - 4;
    if (vs.selected >= 0) {
      by = this.grainHead(bx, by);
      const g = vs.selected;
      const ez = sim.strain[g * 9 + 8];
      const found = sim.found[g] === 1;
      const U = sim.Ucur.subarray(g * 9, g * 9 + 9);
      by = para(ctx, found ? "Grain indexed from its diffraction spots." : "Not indexed yet. Continue rotating.", bx, by, maxW, yMax, { color: TOKENS.ink2 });
      by = para(ctx, sim.eps > 0 ? `Atoms ${(ez * 100).toFixed(2)} % farther apart along the load axis.` : "No tensile load yet.", bx, by, maxW, yMax, { color: TOKENS.ink2 });
      para(ctx, `Stiffness along the pull: ${P.youngDir(sim.el, [U[6], U[7], U[8]]).toFixed(0)} GPa.`, bx, by, maxW, yMax, { color: TOKENS.ink3 });
      return;
    }
    para(
      ctx,
      "Grain centre, orientation and full strain are reconstructed from far-field diffraction. Shape requires near-field measurements. Tap a dot to follow a grain.",
      bx,
      by,
      maxW,
      yMax,
    );
  }

  /** "■ Grain n" heading in the legend column; returns the next baseline */
  private grainHead(x: number, y: number): number {
    const { ctx } = this.c;
    const g = this.sim.grains[this.vs.selected];
    ctx.fillStyle = rgb255(g.ipf);
    ctx.fillRect(x, y - 9, 10, 10);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - 8.5, 9, 9);
    txt(ctx, `Grain ${g.id + 1}`, x + 16, y, { size: 11, color: TOKENS.ink, weight: 700 });
    return y + 15;
  }

  private drawNF(): void {
    const { ctx } = this.c;
    const sim = this.sim;
    const vs = this.vs;
    const { cx, cy, r, lx } = this.geom();
    const N = 48;
    const d = this.mapImg.data;
    // re-read the reconstruction at most ~8×/s while it is being computed (best() scans every candidate)
    const recompute = this.statsVersion !== sim.nfVersion && (sim.nfPending === 0 || vs.t - this.lastRecompute > 0.12);
    if (recompute) {
      this.lastRecompute = vs.t;
      this.statsVersion = sim.nfVersion;
      sim.bestAll(this.bestCache, this.confCache);
      // same definitions as HedmSim.nfStats()
      this.stats = sim.summarize(this.bestCache, this.confCache);
      for (let v = 0; v < sim.nv; v++) if (this.confCache[v] < 0.25) this.bestCache[v] = -1;
      // boundary segments between mapped voxels (grid units): grain boundaries and sub-grain boundaries
      this.segG.length = 0;
      this.segS.length = 0;
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const v = sim.vIndex[j * N + i];
          if (v < 0) continue;
          const a = this.bestCache[v];
          if (a < 0) continue;
          const vr = i + 1 < N ? sim.vIndex[j * N + i + 1] : -1;
          const vd = j + 1 < N ? sim.vIndex[(j + 1) * N + i] : -1;
          for (const [w, x0, y0, x1, y1] of [
            [vr, i + 1, j, i + 1, j + 1],
            [vd, i, j + 1, i + 1, j + 1],
          ] as const) {
            if (w < 0) continue;
            const bb = this.bestCache[w];
            if (bb < 0 || bb === a) continue;
            (sim.candGrain(bb) === sim.candGrain(a) ? this.segS : this.segG).push(x0, y0, x1, y1);
          }
        }
    }
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const o = (j * N + i) * 4;
        const v = sim.vIndex[j * N + i];
        if (v < 0) {
          d[o + 3] = 0;
          continue;
        }
        const b = this.bestCache[v];
        d[o + 3] = 255;
        if (b >= 0 && this.confCache[v] >= 0.25) {
          const ci = sim.candIpf;
          const c = this.confCache[v];
          const k = 0.15 + 0.85 * c * c;
          d[o] = 14 + ci[b * 3] * 241 * k;
          d[o + 1] = 18 + ci[b * 3 + 1] * 237 * k;
          d[o + 2] = 26 + ci[b * 3 + 2] * 229 * k;
        } else {
          d[o] = 22;
          d[o + 1] = 28;
          d[o + 2] = 38;
        }
      }
    this.map.getContext('2d')!.putImageData(this.mapImg, 0, 0);
    // drawn turned by ω so it lines up with panel 1
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-vs.omega);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.map, -r, -r, 2 * r, 2 * r);
    const u = (2 * r) / N;
    for (const [seg, col, lw] of [
      [this.segS, 'rgba(5,8,14,0.55)', 0.9],
      [this.segG, 'rgba(5,8,14,0.95)', 1.6],
    ] as const) {
      if (!seg.length) continue;
      ctx.beginPath();
      for (let q = 0; q < seg.length; q += 4) {
        ctx.moveTo(-r + seg[q] * u, -r + seg[q + 1] * u);
        ctx.lineTo(-r + seg[q + 2] * u, -r + seg[q + 3] * u);
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(200,212,228,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
    if (vs.selected >= 0) {
      // outline the selected grain's true cell
      const p = sim.grains[vs.selected].poly;
      const co = Math.cos(vs.omega);
      const so = Math.sin(vs.omega);
      ctx.beginPath();
      for (let k = 0; k < p.length; k += 2) {
        const X = cx + (co * p[k] - so * p[k + 1]) * r;
        const Y = cy - (so * p[k] + co * p[k + 1]) * r;
        if (k === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      }
      ctx.closePath();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const st = this.stats;
    const label = sim.nfPending > 0 ? `computing… ${Math.round(st.mapped * 100)} % mapped` : `${Math.round(st.mapped * 100)} % of the slice mapped`;
    txt(ctx, label, cx, cy + r + 15, { size: 11, align: 'center', color: st.mapped > 0.05 ? vs.accent : TOKENS.ink3, weight: 700 });
    // legend: IPF triangle + confidence
    const maxW = this.c.w - lx - 8;
    const yMax = this.c.h - 4;
    let by = para(ctx, 'colour = crystal direction along the pull', lx, 32, maxW, yMax, { size: 10.5, color: TOKENS.ink, weight: 600, lh: 13 }) - 7;
    const kw = 58;
    const kh = (kw * 52) / 64;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.ipfKey, lx + 4, by, kw, kh);
    txt(ctx, '001', lx + 2, by + kh + 11, { size: 9, color: TOKENS.ink2, mono: true });
    txt(ctx, '101', lx + kw + 6, by + kh + 11, { size: 9, align: 'right', color: TOKENS.ink2, mono: true });
    txt(ctx, '111', lx + kw + 8, by + 6, { size: 9, color: TOKENS.ink2, mono: true });
    by += kh + 28;
    by = para(ctx, "bright = high confidence, dark = low confidence", lx, by, maxW, yMax, { color: TOKENS.ink2 }) + 3;
    if (vs.selected >= 0) {
      by = this.grainHead(lx, by + 4);
      para(ctx, 'Dashed line: its true outline, for comparison.', lx, by, maxW, yMax, { color: TOKENS.ink2 });
      return;
    }
    para(ctx, "Grain shape and orientation are reconstructed from near-field diffraction. Strain requires far-field measurements.", lx, by, maxW, yMax);
  }
}
