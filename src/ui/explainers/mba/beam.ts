/**
 * Panel 2. The electron beam seen end-on at an insertion-device (ID) source point, everything to the same scale.
 *
 * Both beams are drawn centred on the same axis, over the cross-section of a human hair (70 µm) for scale:
 *   old APS (FDR 2019 Table 2.1):          σ_x × σ_y = 275 × 10 µm rms
 *   APS-U round, κ = 1 (srp2024 Table 5):  12.3 × 8.3 µm rms   (user operation since 2025)
 *   APS-U flat,  κ = 0.1:                  14.5 × 3.1 µm rms
 * Each cloud is a Gaussian glow (to ±3σ) plus individual electrons doing their betatron oscillations
 *     x = a_x σ_x cos φ_x,  y = a_y σ_y cos φ_y,  a ~ Rayleigh(1), φ uniform  ⇒ x, y ~ N(0, σ²)
 * so the cloud is exactly Gaussian at every instant. The oscillation is slowed by ~10⁵: seen at one fixed point
 * the betatron motion repeats at the fractional tune × f_rev ≈ 0.12 · 271.6 kHz ≈ 33 kHz (x) and
 * 0.13 · 271.6 kHz ≈ 35 kHz (y) (ν = 95.12 / 36.13, srp2024); the drawing is otherwise to scale.
 * The 1σ (rms) ellipse is outlined. "Magnify" multiplies the scale; the scale bar follows.
 */
import { TOKENS, type Canvas2D } from '../kit';
import * as P from './physics';
import { hexA } from './sector';
import { richText, richWidth } from './text';

export type Coupling = 'round' | 'flat';

interface Cloud {
  n: number;
  ax: Float32Array;
  ay: Float32Array;
  fx: Float32Array;
  fy: Float32Array;
  wx: Float32Array;
  wy: Float32Array;
}

function cloud(n: number, seed: number): Cloud {
  let s = seed | 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const c: Cloud = { n, ax: new Float32Array(n), ay: new Float32Array(n), fx: new Float32Array(n), fy: new Float32Array(n), wx: new Float32Array(n), wy: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    c.ax[i] = Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd())));
    c.ay[i] = Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd())));
    c.fx[i] = rnd() * Math.PI * 2;
    c.fy[i] = rnd() * Math.PI * 2;
    // slowed-down betatron frequencies (rad/s), ~33/35 kHz ÷ 8×10⁴ (vertical fractional tune slightly higher),
    // with a small spread (chromaticity / amplitude detuning) so the cloud never "breathes" in lock-step
    c.wx[i] = 2 * Math.PI * (0.4 + 0.06 * (rnd() - 0.5));
    c.wy[i] = 2 * Math.PI * (0.44 + 0.06 * (rnd() - 0.5));
  }
  return c;
}

const HAIR_FILL = 'rgba(176,132,84,0.16)';
const HAIR_EDGE = 'rgba(214,176,128,0.75)';
const RBC = 'rgba(248,113,113,0.85)';

export class BeamView {
  private mode: Coupling = 'round';
  private zoomT = 6;
  private zoom = 6;
  private sx = P.APSU.round.sigX;
  private sy = P.APSU.round.sigY;
  private old = cloud(520, 7);
  private neu = cloud(420, 99);
  /** clock of the beam particles' jiggle (stands still while paused) */
  private clock = 0;
  private glow: HTMLCanvasElement = document.createElement('canvas');
  private glowNew: HTMLCanvasElement = document.createElement('canvas');

  constructor(
    private c: Canvas2D,
    private accent: string,
  ) {
    this.glow = gaussSprite('rgba(170,182,200,', 0.55);
    this.glowNew = gaussSprite(cssRgbPrefix(accent), 0.95);
  }

  set(o: { mode?: Coupling; zoom?: number }): void {
    if (o.mode) this.mode = o.mode;
    if (o.zoom !== undefined) this.zoomT = o.zoom;
  }

  /** current APS-U target sizes (µm rms) */
  target(): { sx: number; sy: number } {
    const b = this.mode === 'round' ? P.APSU.round : P.APSU.flat;
    return { sx: b.sigX, sy: b.sigY };
  }

  /** px per µm at magnification 1: the old APS fits ±2.6σ_x across the width */
  private kFit(): number {
    return Math.max(0.05, (this.c.w - 36) / (2 * 2.6 * P.APS.sigX));
  }

  /** still: reduced motion, paused. No jiggle, and zoom / beam-shape changes are cuts instead of eased */
  frame(dt: number, still = false): void {
    const { c } = this;
    const ctx = c.ctx;
    const w = c.w;
    const h = c.h;
    // ease zoom (log space) and APS-U size changes
    const ez = still ? 1 : 1 - Math.exp(-dt * 7);
    this.zoom = Math.exp(Math.log(this.zoom) + (Math.log(this.zoomT) - Math.log(this.zoom)) * ez);
    const tg = this.target();
    this.sx += (tg.sx - this.sx) * ez;
    this.sy += (tg.sy - this.sy) * ez;
    if (!still) this.clock += dt;
    const tt = this.clock;

    // layout: kit label on top | overview strip (to scale) | magnified view | info rows
    const top = 24;
    const infoH = this.infoRows(ctx) * 15 + 8;
    const k0 = this.kFit();
    const ovH = Math.round(Math.max(54, Math.min(80, P.HAIR_UM * k0 + 30)));
    const ov = { x: 0, y: top, w, h: ovH };
    const zm = { x: 0, y: top + ovH + 8, w, h: h - infoH - (top + ovH + 8) - 2 };
    const k1 = k0 * this.zoom;

    ctx.clearRect(0, 0, w, h);

    // ---------------- overview: everything at 1×
    const ocx = w / 2;
    const ocy = ov.y + ov.h / 2 - 4;
    this.scene(ctx, ov, ocx, ocy, k0, tt, false);
    // overview labels
    ctx.save();
    ctx.font = `600 10.5px ${TOKENS.font}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TOKENS.ink2;
    ctx.textAlign = 'left';
    ctx.font = `600 10px ${TOKENS.font}`;
    const tsw = ctx.measureText("To scale").width;
    // the longest wording that stays clear of the scale bar (same row) at the top left
    const sbMax = Math.min(w * 0.22, 110);
    const sb = niceStep(sbMax / k0);
    ctx.font = `600 10.5px ${TOKENS.mono}`;
    const sbEnd = 10 + tsw + 10 + sb * k0 + 6 + ctx.measureText(fmtLen(sb)).width + 10;
    ctx.font = `600 10.5px ${TOKENS.font}`;
    const opts = [`old APS width ${P.APS.sigX} µm · rms`, `old APS, ${P.APS.sigX} µm wide`, 'old APS beam'];
    const oTxt = opts.find((t) => w - 8 - richWidth(ctx, t) >= sbEnd) ?? opts[opts.length - 1];
    const oX = Math.max(sbEnd, Math.min(w - 8 - richWidth(ctx, oTxt), ocx + P.APS.sigX * k0 * 1.05));
    richText(ctx, oTxt, oX, ocy - Math.max(9, P.APS.sigY * k0 + 8));
    ctx.fillStyle = TOKENS.ink3;
    ctx.font = `600 10px ${TOKENS.font}`;
    ctx.fillText("To scale", 10, ov.y + 7);
    ctx.restore();
    this.scaleBar(ctx, 10 + tsw + 10, ov.y + 7, k0, sbMax);

    // zoom box in the overview + connectors to the magnified view
    const bw = zm.w / this.zoom;
    const bh = zm.h / this.zoom;
    const bx = ocx - bw / 2;
    const by = ocy - bh / 2;
    ctx.save();
    ctx.strokeStyle = hexA(this.accent, 0.85);
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.max(2, Math.round(bw)), Math.max(2, Math.round(bh)));
    ctx.strokeStyle = hexA(this.accent, 0.3);
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(bx, by + bh);
    ctx.lineTo(zm.x + 1, zm.y);
    ctx.moveTo(bx + bw, by + bh);
    ctx.lineTo(zm.x + zm.w - 1, zm.y);
    ctx.stroke();
    ctx.restore();

    // ---------------- magnified view
    const zcx = w / 2;
    const zcy = zm.y + zm.h / 2 - 6;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.018)';
    ctx.fillRect(zm.x, zm.y, zm.w, zm.h);
    ctx.strokeStyle = hexA(this.accent, 0.45);
    ctx.lineWidth = 1;
    ctx.strokeRect(zm.x + 0.5, zm.y + 0.5, zm.w - 1, zm.h - 1);
    ctx.restore();
    const rbc = this.scene(ctx, zm, zcx, zcy, k1, tt, true);
    this.zoomLabels(ctx, zm, zcx, zcy, k1, rbc);
    // scale bar + magnification
    this.scaleBar(ctx, zm.x + 10, zm.y + zm.h - 10, k1, Math.min(w * 0.3, 140));
    ctx.save();
    ctx.font = `600 10.5px ${TOKENS.font}`;
    tag(ctx, `×${this.zoom.toFixed(this.zoom < 10 ? 1 : 0)}`, zm.x + zm.w - 10, zm.y + 12, 'right', this.accent);
    ctx.font = `500 10px ${TOKENS.font}`;
    tag(ctx, w < 420 ? 'outlines: rms size' : 'outlines: rms size · electrons slowed ~10⁵×', zm.x + zm.w - 10, zm.y + zm.h - 11, 'right', TOKENS.ink2);
    ctx.restore();

    // ---------------- info rows
    this.drawInfo(ctx, h - infoH + 2);
  }

  /** draw grid, hair, red blood cell, both beams into rect (clipped). Returns the RBC circle if drawn. */
  private scene(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, cx: number, cy: number, k: number, t: number, detail: boolean): { x: number; y: number; r: number } | null {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    if (detail) {
      // faint µm grid (1-2-5 steps ~ 40 px)
      const gstep = niceStep(40 / k);
      ctx.strokeStyle = 'rgba(140,170,210,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const nx = Math.ceil(r.w / 2 / (gstep * k)) + 1;
      for (let i = -nx; i <= nx; i++) {
        const x = Math.round(cx + i * gstep * k) + 0.5;
        ctx.moveTo(x, r.y);
        ctx.lineTo(x, r.y + r.h);
      }
      const ny = Math.ceil(r.h / (gstep * k)) + 1;
      for (let i = -ny; i <= ny; i++) {
        const y = Math.round(cy + i * gstep * k) + 0.5;
        ctx.moveTo(r.x, y);
        ctx.lineTo(r.x + r.w, y);
      }
      ctx.stroke();
    }
    // human hair, centred, behind the beams
    const rh = (P.HAIR_UM / 2) * k;
    ctx.beginPath();
    ctx.arc(cx, cy, rh, 0, Math.PI * 2);
    const hg = ctx.createRadialGradient(cx - rh * 0.3, cy - rh * 0.35, rh * 0.1, cx, cy, rh);
    hg.addColorStop(0, 'rgba(196,150,100,0.22)');
    hg.addColorStop(1, HAIR_FILL);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = HAIR_EDGE;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.setLineDash([]);
    // a red blood cell beside the hair once it is big enough to see
    let rbc: { x: number; y: number; r: number } | null = null;
    if (detail) {
      const rr = (P.RBC_UM / 2) * k;
      const rx = cx - Math.min(r.w * 0.32, 47 * k);
      const ry = cy + Math.min(r.h * 0.27, 22 * k);
      if (rr >= 3 && ry + rr < r.y + r.h - 22 && rx - rr > r.x + 4) {
        rbc = { x: rx, y: ry, r: rr };
        ctx.beginPath();
        ctx.arc(rx, ry, rr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(248,113,113,0.2)';
        ctx.fill();
        ctx.strokeStyle = RBC;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rx, ry, rr * 0.45, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(248,113,113,0.35)';
        ctx.stroke();
      }
    }
    // clouds + 1σ ellipses
    this.drawCloud(ctx, this.old, P.APS.sigX, P.APS.sigY, cx, cy, k, t, this.glow, 'rgba(206,214,226,0.55)', 1.1);
    this.drawCloud(ctx, this.neu, this.sx, this.sy, cx, cy, k, t, this.glowNew, '#ffffff', 1.0);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(200,210,224,0.7)';
    ellipse(ctx, cx, cy, P.APS.sigX * k, Math.max(0.6, P.APS.sigY * k));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1.5;
    ellipse(ctx, cx, cy, Math.max(0.8, this.sx * k), Math.max(0.8, this.sy * k));
    ctx.stroke();
    ctx.restore();
    return rbc;
  }

  private zoomLabels(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, cx: number, cy: number, k: number, rbc: { x: number; y: number; r: number } | null): void {
    const top = r.y + 8;
    const bot = r.y + r.h - 24;
    const w = r.w;
    ctx.save();
    ctx.font = `600 11px ${TOKENS.font}`;
    ctx.textBaseline = 'middle';
    // hair: label at its upper-left edge (or the top-left corner when the hair overflows the view)
    {
      const rh = (P.HAIR_UM / 2) * k;
      const a = (-140 * Math.PI) / 180;
      let hx = cx + Math.cos(a) * rh;
      let hy = cy + Math.sin(a) * rh;
      const txt = `human hair · ${P.HAIR_UM} µm`;
      const tw = ctx.measureText(txt).width;
      if (hy < top + 4) {
        // edge outside: point at the visible arc where it crosses the top region
        hy = top + 14;
        const dy = hy - cy;
        hx = cx - Math.sqrt(Math.max(0, rh * rh - dy * dy));
      }
      const lx = Math.max(10, Math.min(hx - 10 - tw, w - 10 - tw));
      const ly = Math.max(top + 6, hy - 14);
      if (hx > 4 && hx < w - 4) leader(ctx, hx, hy, lx + tw, ly + 4, HAIR_EDGE);
      tag(ctx, txt, lx, ly, 'left', 'rgb(222,192,150)');
    }
    // old APS ribbon: label at the right, above the band
    {
      const ey = cy - Math.max(3, P.APS.sigY * k);
      const txt = w < 420 ? `old APS, ${P.APS.sigY} µm tall` : `old APS beam: ${P.APS.sigY} µm tall, far wider than this view`;
      ctx.font = `600 10.5px ${TOKENS.font}`;
      const ly = Math.max(top + 24, ey - 12);
      tag(ctx, txt, w - 10, ly, 'right', TOKENS.ink2);
    }
    // APS-U: below-right of the ellipse
    {
      const ex = cx + this.sx * k * 0.72;
      const ey = cy + this.sy * k * 0.72;
      ctx.font = `650 11.5px ${TOKENS.font}`;
      const txt = `APS-U beam ${fmt1(this.sx)} × ${fmt1(this.sy)} µm`;
      const tw = ctx.measureText(txt).width;
      const gap = Math.max(22, Math.max(this.sy * k, P.APS.sigY * k) + 14);
      let lx = ex + 18;
      if (lx + tw > w - 8) lx = Math.max(8, w - 8 - tw);
      const ly = Math.min(bot, cy + gap);
      leader(ctx, ex, ey, Math.min(lx + 4, ex + 14), ly - 7, hexA(this.accent, 0.85));
      tag(ctx, txt, lx, ly, 'left', this.accent);
    }
    if (rbc) {
      ctx.font = `500 10.5px ${TOKENS.font}`;
      ctx.fillStyle = 'rgb(252,165,165)';
      ctx.textAlign = 'right';
      const txt = `red blood cell · ${P.RBC_UM} µm`;
      const tx = Math.max(ctx.measureText(txt).width + 8, rbc.x - rbc.r - 5);
      tag(ctx, txt, tx, rbc.y, 'right', 'rgb(252,165,165)');
    }
    ctx.restore();
  }

  private scaleBar(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, maxPx: number): void {
    const sb = niceStep(maxPx / k);
    const px = sb * k;
    ctx.save();
    ctx.strokeStyle = TOKENS.ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 3.5);
    ctx.lineTo(x, y + 3.5);
    ctx.moveTo(x + px, y - 3.5);
    ctx.lineTo(x + px, y + 3.5);
    ctx.stroke();
    ctx.font = `600 10.5px ${TOKENS.mono}`;
    ctx.fillStyle = TOKENS.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtLen(sb), x + px + 6, y);
    ctx.restore();
  }

  /** [dot colour, name, values]: rms size and angle spread (width × height) of both beams */
  private infoLines(): [string, string, string][] {
    const tg = this.target();
    const aOld = P.APS.sigX * P.APS.sigY;
    const aNew = tg.sx * tg.sy;
    const div = this.mode === 'round' ? P.APSU.round : P.APSU.flat;
    return [
      ['rgba(206,214,226,0.9)', 'APS before upgrade · 7 GeV', `width × height ${P.APS.sigX} × ${P.APS.sigY} µm · rms · angular spread ${P.APS.divX} × ${P.APS.divY} µrad`],
      [this.accent, `APS-U · 6 GeV, ${this.mode}`, `${fmt1(tg.sx)} × ${fmt1(tg.sy)} µm · spread ${div.divX} × ${div.divY} µrad · ${Math.round(aOld / aNew)}× smaller area`],
    ];
  }

  /**
   * Layout of the info block: per beam, the value goes beside the name when it fits, otherwise on its own lines
   * below it, wrapped after " · " (never cut off).
   */
  private infoLayout(ctx: CanvasRenderingContext2D): { col: string; name: string; inline: boolean; lines: string[] }[] {
    const w = this.c.w;
    ctx.save();
    const out = this.infoLines().map(([col, name, val]) => {
      ctx.font = `650 11.5px ${TOKENS.font}`;
      const nw = ctx.measureText(name).width;
      ctx.font = `500 11px ${TOKENS.font}`;
      if (26 + nw + 8 + ctx.measureText(val).width <= w - 8) return { col, name, inline: true, lines: [val] };
      const lines: string[] = [];
      let cur = '';
      for (const part of val.split(' · ')) {
        const next = cur ? `${cur} · ${part}` : part;
        if (cur && ctx.measureText(next).width > w - 34) {
          lines.push(cur);
          cur = part;
        } else cur = next;
      }
      if (cur) lines.push(cur);
      return { col, name, inline: false, lines };
    });
    ctx.restore();
    return out;
  }

  /** number of text lines the info block needs at the current width */
  private infoRows(ctx: CanvasRenderingContext2D): number {
    return this.infoLayout(ctx).reduce((n, r) => n + (r.inline ? 1 : 1 + r.lines.length), 0);
  }

  private drawInfo(ctx: CanvasRenderingContext2D, y0: number): void {
    const w = this.c.w;
    const rows = this.infoLayout(ctx);
    ctx.save();
    ctx.textBaseline = 'middle';
    let y = y0 + 7;
    for (const { col, name, inline, lines } of rows) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(16, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `650 11.5px ${TOKENS.font}`;
      ctx.fillStyle = TOKENS.ink;
      ctx.textAlign = 'left';
      ctx.fillText(name, 26, y);
      const nw = ctx.measureText(name).width;
      ctx.font = `500 11px ${TOKENS.font}`;
      ctx.fillStyle = TOKENS.ink2;
      if (inline) ctx.fillText(lines[0], 26 + nw + 8, y);
      else
        for (const l of lines) {
          y += 15;
          ctx.fillText(fitText(ctx, l, w - 34), 26, y);
        }
      y += 15;
    }
    ctx.restore();
  }

  private drawCloud(
    ctx: CanvasRenderingContext2D,
    cl: Cloud,
    sx: number,
    sy: number,
    cx: number,
    cy: number,
    k: number,
    t: number,
    sprite: HTMLCanvasElement,
    dot: string,
    r: number,
  ): void {
    const ex = sx * k;
    const ey = sy * k;
    // Gaussian glow: the sprite spans ±3σ
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(sprite, cx - 3 * ex, cy - 3 * ey, 6 * ex, Math.max(1.5, 6 * ey));
    ctx.restore();
    // electrons (cap the count when the cloud is tiny on screen: they would just overplot)
    const n = Math.min(cl.n, Math.max(60, Math.round(ex * ey * 0.9)));
    ctx.fillStyle = dot;
    ctx.globalAlpha = Math.min(0.95, 0.35 + 30 / Math.sqrt(1 + ex * ey));
    const d = r * 2;
    for (let i = 0; i < n; i++) {
      const x = cx + cl.ax[i] * ex * Math.cos(cl.fx[i] + cl.wx[i] * t);
      const y = cy + cl.ay[i] * ey * Math.cos(cl.fy[i] + cl.wy[i] * t);
      ctx.fillRect(x - r, y - r, d, d);
    }
    ctx.globalAlpha = 1;
  }
}

/** 64×64 sprite of a 2D Gaussian spanning ±3σ, colour prefix like "rgba(r,g,b," */
function gaussSprite(prefix: string, peak: number): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (let i = 0; i <= 10; i++) {
    const r = i / 10; // fraction of 3σ
    const a = peak * Math.exp(-((3 * r) ** 2) / 2);
    grad.addColorStop(r, `${prefix}${a.toFixed(3)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return s;
}

function cssRgbPrefix(col: string): string {
  if (col.startsWith('#') && (col.length === 7 || col.length === 4)) {
    const h = col.length === 4 ? `#${col[1]}${col[1]}${col[2]}${col[2]}${col[3]}${col[3]}` : col;
    const n = parseInt(h.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},`;
  }
  return 'rgba(92,211,255,';
}

function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

/** text with a translucent dark backing so it stays legible over the clouds */
function tag(ctx: CanvasRenderingContext2D, txt: string, x: number, y: number, align: CanvasTextAlign, col: string): void {
  const tw = richWidth(ctx, txt);
  const x0 = align === 'left' ? x : align === 'right' ? x - tw : x - tw / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(5,8,14,0.72)';
  ctx.fillRect(x0 - 3, y - 8, tw + 6, txt.includes('_') ? 18 : 16);
  ctx.fillStyle = col;
  ctx.textBaseline = 'middle';
  richText(ctx, txt, x0, y);
  ctx.restore();
}

function leader(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: string): void {
  ctx.save();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x0, y0, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.restore();
}

/** 1-2-5 step closest below v */
export function niceStep(v: number): number {
  const e = Math.floor(Math.log10(v));
  const m = v / Math.pow(10, e);
  const f = m >= 5 ? 5 : m >= 2 ? 2 : 1;
  return f * Math.pow(10, e);
}

function fmtLen(um: number): string {
  if (um >= 1000) return `${um / 1000} mm`;
  return `${um} µm`;
}

function fmt1(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function fitText(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 4 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}
