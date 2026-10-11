/**
 * View 3 — the magnet's state: hysteresis loop M(H) at the current temperature (major loop of the grain ensemble
 * plus the path actually travelled) and the Weiss mean-field M(T) curve with T_C. Both plots are draggable:
 * horizontal drag on the loop sets the field, on M(T) the temperature.
 */
import { TOKENS, type Canvas2D } from '../kit';
import * as P from './physics';
import { inside, linMap, num, rgba, rich, richW, txt, type Rect } from './draw';

export interface MagnetState {
  H: number;
  T: number;
  P: number;
  M: number;
  m0: number;
  hc: number;
  tc: number;
}

const TRAIL = 220;
/** samples per branch of the drawn major loop */
const LOOP_N = 90;
/** alpha buckets for the fading trail (one stroke each instead of one per segment) */
const TRAIL_BUCKETS = 8;
const T_MAX = 900;

export class MagnetPlot {
  private c: Canvas2D;
  private accent: string;
  private trailH = new Float32Array(TRAIL);
  private trailM = new Float32Array(TRAIL);
  private trailN = 0;
  private trailI = 0;
  /** cached M(T) curves: spontaneous (recomputed when P changes) and in-field (when P or |H| changes) */
  private curveKey0 = '';
  private curveKey = '';
  /** cached major hysteresis loop at the current T, P (independent of the present field) */
  private loopKey = '';
  private loopH = new Float32Array(LOOP_N + 1);
  private loopUp = new Float32Array(LOOP_N + 1);
  private loopDown = new Float32Array(LOOP_N + 1);
  private curveT = new Float32Array(181);
  private curve0 = new Float32Array(181);
  private curveH = new Float32Array(181);
  loopRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  tempRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  hover: 'loop' | 'temp' | null = null;

  constructor(c: Canvas2D, accent: string) {
    this.c = c;
    this.accent = accent;
  }

  pushTrail(H: number, M: number): void {
    const j = (this.trailI + TRAIL - 1) % TRAIL;
    if (this.trailN > 0 && Math.abs(this.trailH[j] - H) < 1e-4 && Math.abs(this.trailM[j] - M) < 1e-4) return;
    this.trailH[this.trailI] = H;
    this.trailM[this.trailI] = M;
    this.trailI = (this.trailI + 1) % TRAIL;
    this.trailN = Math.min(TRAIL, this.trailN + 1);
  }

  clearTrail(): void {
    this.trailN = 0;
    this.trailI = 0;
  }

  /** Map a pointer position to a field (T) or temperature (K) for the hit plot. */
  valueAt(kind: 'loop' | 'temp', x: number): number {
    const r = kind === 'loop' ? this.loopRect : this.tempRect;
    const f = Math.max(0, Math.min(1, (x - r.x) / r.w));
    // same mappings as the drawn axes (field −9…9 T; temperature 0…900 K, clamped to the slider's 2 K minimum)
    return kind === 'loop' ? -P.POLAR.bMax + 2 * P.POLAR.bMax * f : Math.max(2, T_MAX * f);
  }

  hit(x: number, y: number): 'loop' | 'temp' | null {
    const pad = 8;
    const grow = (r: Rect): Rect => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });
    if (inside(grow(this.loopRect), x, y)) return 'loop';
    if (inside(grow(this.tempRect), x, y)) return 'temp';
    return null;
  }

  draw(s: MagnetState): void {
    const { ctx, w, h } = this.c;
    ctx.save();
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    const side = w > h * 1.35;
    const top = 30;
    const padL = 40;
    if (side) {
      const cw = (w - 12) / 2;
      this.loopRect = { x: padL, y: top + 22, w: cw - padL - 10, h: h - top - 22 - 34 };
      this.tempRect = { x: cw + 12 + padL, y: top + 22, w: cw - padL - 10, h: h - top - 22 - 34 };
    } else {
      const ch = (h - top) / 2;
      this.loopRect = { x: padL, y: top + 20, w: w - padL - 12, h: ch - 20 - 30 };
      this.tempRect = { x: padL, y: top + ch + 22, w: w - padL - 12, h: ch - 22 - 30 };
    }
    this.drawLoop(s);
    this.drawTemp(s);
    ctx.restore();
  }

  private frame(r: Rect, xt: number[], yt: number[], xm: (v: number) => number, ym: (v: number) => number, fx: (v: number) => string, fy: (v: number) => string): void {
    const { ctx } = this.c;
    ctx.strokeStyle = TOKENS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of xt) {
      const x = Math.round(xm(t)) + 0.5;
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
    }
    for (const t of yt) {
      const y = Math.round(ym(t)) + 0.5;
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = TOKENS.axis;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    for (const t of xt) txt(ctx, fx(t), xm(t), r.y + r.h + 13, { size: 10.5, color: TOKENS.ink3, align: 'center' });
    for (const t of yt) txt(ctx, fy(t), r.x - 5, ym(t) + 4, { size: 10.5, color: TOKENS.ink3, align: 'right' });
  }

  private drawLoop(s: MagnetState): void {
    const { ctx } = this.c;
    const r = this.loopRect;
    const B = P.POLAR.bMax;
    const xm = linMap(-B, B, r.x, r.x + r.w);
    const ym = linMap(-1.12, 1.12, r.y + r.h, r.y);
    const xt = r.w > 220 ? [-9, -6, -3, 0, 3, 6, 9] : [-9, -4.5, 0, 4.5, 9];
    this.frame(r, xt, [-1, 0, 1], xm, ym, (v) => num(v, Number.isInteger(v) ? 0 : 1), (v) => num(v, 0));
    // zero axes
    ctx.strokeStyle = 'rgba(170,190,215,0.3)';
    ctx.beginPath();
    ctx.moveTo(xm(0) + 0.5, r.y);
    ctx.lineTo(xm(0) + 0.5, r.y + r.h);
    ctx.moveTo(r.x, ym(0) + 0.5);
    ctx.lineTo(r.x + r.w, ym(0) + 0.5);
    ctx.stroke();
    // major loop at this T, P (cached: it does not depend on the present field)
    this.ensureLoop(s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.strokeStyle = rgba(this.accent, 0.38);
    ctx.lineWidth = 1.5;
    for (const br of [this.loopUp, this.loopDown]) {
      ctx.beginPath();
      for (let i = 0; i <= LOOP_N; i++) {
        if (i) ctx.lineTo(xm(this.loopH[i]), ym(br[i]));
        else ctx.moveTo(xm(this.loopH[i]), ym(br[i]));
      }
      ctx.stroke();
    }
    // the path actually travelled, fading with age (segments grouped into a few alpha buckets)
    if (this.trailN > 1) {
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const start = (this.trailI - this.trailN + TRAIL) % TRAIL;
      const segs = this.trailN - 1;
      for (let b = 0; b < TRAIL_BUCKETS; b++) {
        const k0 = 1 + Math.floor((segs * b) / TRAIL_BUCKETS);
        const k1 = Math.floor((segs * (b + 1)) / TRAIL_BUCKETS);
        if (k1 < k0) continue;
        ctx.globalAlpha = 0.15 + (0.85 * (b + 1)) / TRAIL_BUCKETS;
        ctx.beginPath();
        let j = (start + k0 - 1) % TRAIL;
        ctx.moveTo(xm(this.trailH[j]), ym(this.trailM[j]));
        for (let k = k0; k <= k1; k++) {
          j = (start + k) % TRAIL;
          ctx.lineTo(xm(this.trailH[j]), ym(this.trailM[j]));
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // coercive field marks
    if (s.hc > 0.05) {
      ctx.fillStyle = rgba(this.accent, 0.8);
      for (const sg of [-1, 1]) {
        const x = xm(sg * s.hc);
        ctx.beginPath();
        ctx.moveTo(x, r.y + r.h - 1);
        ctx.lineTo(x - 4, r.y + r.h + 5);
        ctx.lineTo(x + 4, r.y + r.h + 5);
        ctx.closePath();
        ctx.fill();
      }
      if (r.w > 200) rich(ctx, `H_{c} ${s.hc.toFixed(1)} T`, xm(s.hc) + 6, ym(-0.8), { size: 10.5, color: TOKENS.ink3 });
    }
    // current state
    const x = xm(s.H);
    const y = ym(s.M);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // titles
    txt(ctx, `Flip it with a magnetic field: M(H) at ${Math.round(s.T)} K`, r.x, r.y - 8, { size: 11.5, weight: 650, color: TOKENS.ink });
    txt(ctx, 'field μ₀H (tesla)', r.x + r.w, r.y + r.h + 27, { size: 10.5, color: TOKENS.ink2, align: 'right' });
    this.yLabel(['magnetization M·k̂/M_{s}', 'magnetization'], r);
    if (this.hover === 'loop') txt(ctx, '⇠ drag ⇢', r.x + r.w - 6, r.y + 14, { size: 10.5, color: TOKENS.ink3, align: 'right' });
  }

  private ensureLoop(s: MagnetState): void {
    const key = `${s.T.toFixed(1)}|${s.P.toFixed(2)}`;
    if (key === this.loopKey) return;
    this.loopKey = key;
    const B = P.POLAR.bMax;
    for (let i = 0; i <= LOOP_N; i++) {
      const H = -B + (2 * B * i) / LOOP_N;
      const mHigh = Math.abs(H) > 1e-6 ? P.inField(s.T, s.P, Math.abs(H)) : s.m0;
      this.loopH[i] = H;
      this.loopUp[i] = P.majorLoop(H, s.hc, s.m0, mHigh, true);
      this.loopDown[i] = P.majorLoop(H, s.hc, s.m0, mHigh, false);
    }
  }

  private ensureCurves(s: MagnetState): void {
    const n = this.curveT.length;
    const key0 = s.P.toFixed(2);
    if (key0 !== this.curveKey0) {
      this.curveKey0 = key0;
      for (let i = 0; i < n; i++) {
        const T = 1 + ((T_MAX - 1) * i) / (n - 1);
        this.curveT[i] = T;
        this.curve0[i] = P.spontaneous(T, s.P);
      }
    }
    // the in-field curve only differs visibly from the spontaneous one near and above T_C: 0.05 T steps suffice
    const hAbs = Math.round(Math.abs(s.H) * 20) / 20;
    const key = `${key0}|${hAbs.toFixed(2)}`;
    if (key === this.curveKey) return;
    this.curveKey = key;
    for (let i = 0; i < n; i++) this.curveH[i] = hAbs > 0.05 ? P.inField(this.curveT[i], s.P, hAbs) : NaN;
  }

  private drawTemp(s: MagnetState): void {
    const { ctx } = this.c;
    const r = this.tempRect;
    this.ensureCurves(s);
    const xm = linMap(0, T_MAX, r.x, r.x + r.w);
    const ym = linMap(0, 1.1, r.y + r.h, r.y);
    this.frame(r, [0, 300, 600, 900], [0, 0.5, 1], xm, ym, (v) => `${v}`, (v) => (v === 0.5 ? '½' : `${v}`));
    // POLAR sample-environment band
    ctx.fillStyle = 'rgba(92,211,255,0.08)';
    ctx.fillRect(xm(P.POLAR.tMin), r.y + 1, xm(450) - xm(P.POLAR.tMin), r.h - 1);
    txt(ctx, 'POLAR cryostats ≤ 450 K', xm(8), r.y + r.h - 6, { size: 10, color: 'rgba(160,215,240,0.7)' });
    // room temperature
    const xr = xm(293);
    ctx.strokeStyle = 'rgba(170,190,215,0.35)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(xr + 0.5, r.y);
    ctx.lineTo(xr + 0.5, r.y + r.h);
    ctx.stroke();
    // T_C
    if (s.tc > 0) {
      const xc = xm(Math.min(T_MAX, s.tc));
      ctx.strokeStyle = rgba(TOKENS.warn, 0.7);
      ctx.beginPath();
      ctx.moveTo(xc + 0.5, r.y);
      ctx.lineTo(xc + 0.5, r.y + r.h);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // above the cryostat note, which runs along the bottom
    txt(ctx, 'room temp.', xr + 4, r.y + r.h - 20, { size: 10, color: TOKENS.ink3 });
    if (s.tc > 0) {
      const xc = xm(Math.min(T_MAX, s.tc));
      const lbl = `Curie point T_{C} ${Math.round(s.tc)} K`;
      const o = { size: 10.5, color: TOKENS.warn, weight: 600 };
      const right = xc + 4 + richW(ctx, lbl, o) < r.x + r.w - 2;
      rich(ctx, lbl, right ? xc + 4 : xc - 4, r.y + 13, { ...o, align: right ? 'left' : 'right' });
    } else {
      txt(ctx, 'no magnetic order at this pressure', r.x + r.w / 2, r.y + r.h / 2, { size: 10.5, color: TOKENS.warn, align: 'center' });
    }
    // curves
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    const n = this.curveT.length;
    if (Number.isFinite(this.curveH[0])) {
      ctx.strokeStyle = 'rgba(233,238,245,0.55)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < n; i++) (i ? ctx.lineTo(xm(this.curveT[i]), ym(this.curveH[i])) : ctx.moveTo(xm(this.curveT[i]), ym(this.curveH[i])));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) (i ? ctx.lineTo(xm(this.curveT[i]), ym(this.curve0[i])) : ctx.moveTo(xm(this.curveT[i]), ym(this.curve0[i])));
    ctx.stroke();
    ctx.restore();
    // current temperature + |M|
    const x = xm(s.T);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(x + 0.5, r.y);
    ctx.lineTo(x + 0.5, r.y + r.h);
    ctx.stroke();
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, ym(s.m0), 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, ym(Math.abs(s.M)), 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    txt(ctx, 'Heat it: magnetism vs temperature (mean field)', r.x, r.y - 8, { size: 11.5, weight: 650, color: TOKENS.ink });
    txt(ctx, 'temperature T (kelvin)', r.x + r.w, r.y + r.h + 27, { size: 10.5, color: TOKENS.ink2, align: 'right' });
    this.yLabel(['strength |M|/M_{s}', 'strength'], r);
    if (this.hover === 'temp') txt(ctx, '⇠ drag ⇢', r.x + r.w - 6, r.y + 28, { size: 10.5, color: TOKENS.ink3, align: 'right' });
  }

  /** rotated axis label: the first variant that fits the plot height */
  private yLabel(variants: string[], r: Rect): void {
    const { ctx } = this.c;
    const o = { size: 10.5 };
    const s = variants.find((v) => richW(ctx, v, o) <= r.h - 6) ?? variants[variants.length - 1];
    ctx.save();
    ctx.translate(r.x - 30, r.y + r.h / 2);
    ctx.rotate(-Math.PI / 2);
    rich(ctx, s, 0, 3, { size: 10.5, color: TOKENS.ink2, align: 'center' });
    ctx.restore();
  }
}
