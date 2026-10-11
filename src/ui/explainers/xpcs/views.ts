/**
 * XPCS station. Canvas renderers (detector, sample, correlation plot). Pure drawing: no state changes.
 */
import { TOKENS, lut, plotFrame, type Canvas2D, type PlotFrame } from '../kit';
import { DISP_FRAMES, TRACE_LEN, type G2Series, type SourceIx, type XpcsSim } from './sim';
import { APSU_GAIN, GEOM, fmtLen, fmtTime, sci } from './physics';

export type DetView = 'photons' | 'ideal' | 'long';

export interface ViewState {
  src: SourceIx;
  view: DetView;
  ringR: number;
  ringHw: number;
  theta: number;
  accent: string;
  interacted: boolean;
  dragging: boolean;
  hoverRing: boolean;
  /** seconds since mount, for gentle animations */
  t: number;
}

/** photons that saturate the colour scale (in the DISP_FRAMES rolling sum) */
export const N_SAT = 30;

const FONT = TOKENS.font;
const MONO = TOKENS.mono;

function hexToRgb(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [92, 211, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgba(c: string, a: number): string {
  const [r, g, b] = hexToRgb(c);
  return `rgba(${r},${g},${b},${a})`;
}

function txt(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  o: { size?: number; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline; weight?: number; mono?: boolean } = {},
): number {
  ctx.font = `${o.weight ?? 500} ${o.size ?? 11}px ${o.mono ? MONO : FONT}`;
  ctx.fillStyle = o.color ?? TOKENS.ink2;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.base ?? 'alphabetic';
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

/** Text on a dark rounded pill (for labels over images). */
function pill(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  o: { size?: number; color?: string; align?: 'left' | 'right' | 'center'; border?: string; mono?: boolean; bg?: string } = {},
): { w: number; h: number } {
  const size = o.size ?? 11;
  ctx.font = `600 ${size}px ${o.mono ? MONO : FONT}`;
  const w = ctx.measureText(s).width + 12;
  const h = size + 8;
  let x0 = x;
  if (o.align === 'right') x0 = x - w;
  else if (o.align === 'center') x0 = x - w / 2;
  ctx.fillStyle = o.bg ?? 'rgba(5,8,14,0.82)';
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
  return { w, h };
}

// ======================================================================= detector

export interface DetGeom {
  x0: number;
  y0: number;
  side: number;
  scale: number;
  cx: number;
  cy: number;
}

export class DetectorView {
  private img: ImageData;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private photIx = new Uint8Array(256);
  private L = lut('inferno');
  geom: DetGeom = { x0: 0, y0: 0, side: 1, scale: 1, cx: 0, cy: 0 };

  constructor(private c: Canvas2D, private sim: XpcsSim) {
    const nd = sim.nd;
    this.img = new ImageData(nd, nd);
    this.off = document.createElement('canvas');
    this.off.width = this.off.height = nd;
    this.offCtx = this.off.getContext('2d')!;
    const lnSat = Math.log(N_SAT);
    for (let n = 0; n < 256; n++) {
      const v = n <= 0 ? 0 : Math.min(1, 0.36 + (0.64 * Math.log(n)) / lnSat);
      this.photIx[n] = Math.round(v * 255);
    }
  }

  layout(): DetGeom {
    const { w, h } = this.c;
    const top = 30;
    const bottom = 40;
    const sideM = 10;
    const side = Math.max(60, Math.floor(Math.min(w - 2 * sideM, h - top - bottom)));
    const x0 = Math.round((w - side) / 2);
    const y0 = Math.round(top + (h - top - bottom - side) / 2);
    this.geom = { x0, y0, side, scale: side / this.sim.nd, cx: x0 + side / 2, cy: y0 + side / 2 };
    return this.geom;
  }

  private buildImage(s: ViewState): void {
    const sim = this.sim;
    const d = this.img.data;
    const L = this.L;
    const np = sim.nd * sim.nd;
    const mask = sim.mask;
    let src: Float32Array;
    let map: (x: number) => number;
    if (s.view === 'photons') {
      src = sim.disp[s.src];
      const pi = this.photIx;
      map = (x) => pi[Math.min(255, Math.max(0, Math.round(x)))];
    } else if (s.view === 'ideal') {
      src = sim.ideal;
      const lo = Math.log10(0.05);
      const hi = Math.log10(N_SAT);
      map = (x) => {
        const v = x * DISP_FRAMES;
        if (v <= 0) return 0;
        return Math.round(Math.max(0, Math.min(1, (Math.log10(v) - lo) / (hi - lo))) * 255);
      };
    } else {
      src = sim.ema[s.src];
      let mx = 0;
      for (let p = 0; p < np; p++) if (mask[p] && src[p] > mx) mx = src[p];
      const lmx = Math.log10(Math.max(mx, 1e-9));
      map = (x) => (x <= 0 ? 0 : Math.round(Math.max(0, Math.min(1, (Math.log10(x) - lmx) / 2.5 + 1)) * 255));
    }
    for (let p = 0; p < np; p++) {
      const o = p * 4;
      if (!mask[p]) {
        d[o] = 10;
        d[o + 1] = 12;
        d[o + 2] = 18;
        d[o + 3] = 255;
        continue;
      }
      const k = map(src[p]) * 3;
      d[o] = L[k];
      d[o + 1] = L[k + 1];
      d[o + 2] = L[k + 2];
      d[o + 3] = 255;
    }
    this.offCtx.putImageData(this.img, 0, 0);
  }

  draw(s: ViewState, info: { tauFrames: number }): void {
    const { ctx, w, h } = this.c;
    const g = this.layout();
    const sim = this.sim;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    this.buildImage(s);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, g.x0, g.y0, g.side, g.side);
    ctx.restore();
    // detector frame
    ctx.strokeStyle = 'rgba(150,180,220,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x0 - 0.5, g.y0 - 0.5, g.side + 1, g.side + 1);

    // beamstop on its holder (comes in from the left, like the real thing)
    const bsR = GEOM.beamstopPx * g.scale + 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x0, g.y0, g.side, g.side);
    ctx.clip();
    ctx.fillStyle = '#1a2130';
    ctx.strokeStyle = 'rgba(170,190,215,0.35)';
    const armH = Math.max(3, bsR * 0.32);
    ctx.fillRect(g.x0, g.cy - armH / 2, g.cx - g.x0, armH);
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, bsR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // the selected ring
    const rIn = (s.ringR - s.ringHw - 0.5) * g.scale;
    const rOut = (s.ringR + s.ringHw + 0.5) * g.scale;
    const glow = s.dragging || s.hoverRing;
    ctx.fillStyle = rgba(s.accent, glow ? 0.16 : 0.09);
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, rOut, 0, Math.PI * 2);
    ctx.arc(g.cx, g.cy, rIn, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.strokeStyle = rgba(s.accent, 0.95);
    ctx.lineWidth = glow ? 1.8 : 1.3;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, rIn, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, rOut, 0, Math.PI * 2);
    ctx.stroke();

    // probe pixel (the one whose trace is plotted)
    const pr = sim.probe;
    const pu = pr % sim.nd;
    const pv = Math.floor(pr / sim.nd);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    const ps = Math.max(4, g.scale);
    ctx.strokeRect(g.x0 + pu * g.scale - (ps - g.scale) / 2 - 1, g.y0 + pv * g.scale - (ps - g.scale) / 2 - 1, ps + 2, ps + 2);
    ctx.restore();

    // drag handle on the ring (radial arrows)
    const hr = s.ringR * g.scale;
    let hx = g.cx + hr * Math.cos(s.theta);
    let hy = g.cy + hr * Math.sin(s.theta);
    hx = Math.max(g.x0 + 8, Math.min(g.x0 + g.side - 8, hx));
    hy = Math.max(g.y0 + 8, Math.min(g.y0 + g.side - 8, hy));
    const pulse = s.interacted ? 0 : 0.5 + 0.5 * Math.sin(s.t * 4);
    ctx.save();
    if (!s.interacted) {
      ctx.strokeStyle = rgba(s.accent, 0.5 * (1 - pulse));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, 9 + 8 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = s.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(hx, hy, glow ? 8 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // tiny radial double arrow
    ctx.translate(hx, hy);
    ctx.rotate(s.theta);
    ctx.strokeStyle = '#0b111b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-3.5, 0);
    ctx.lineTo(3.5, 0);
    ctx.moveTo(1.5, -2);
    ctx.lineTo(3.5, 0);
    ctx.lineTo(1.5, 2);
    ctx.moveTo(-1.5, -2);
    ctx.lineTo(-3.5, 0);
    ctx.lineTo(-1.5, 2);
    ctx.stroke();
    ctx.restore();

    // ring label (placed outward of the handle, kept inside the canvas)
    const q = sim.qOf(s.ringR);
    const ringTxt = `length scale ≈ ${fmtLen((2 * Math.PI) / (q * 1e10))} · q = ${sci(q)} Å⁻¹`;
    ctx.font = `600 11px ${FONT}`;
    const tw = ctx.measureText(ringTxt).width + 12;
    let lx = hx + 14 * Math.cos(s.theta) + (Math.cos(s.theta) >= 0 ? 6 : -6 - tw);
    let ly = hy + 14 * Math.sin(s.theta) + (Math.sin(s.theta) >= 0 ? 10 : -10);
    lx = Math.max(4, Math.min(w - tw - 4, lx));
    ly = Math.max(40, Math.min(h - 50, ly));
    pill(ctx, ringTxt, lx, ly, { color: '#fff', border: rgba(s.accent, 0.7) });

    // header: source badge + view description (top-right)
    const srcName = s.src === 1 ? 'APS-U' : "APS before upgrade";
    const srcCol = s.src === 1 ? s.accent : TOKENS.old;
    const viewTxt =
      s.view === 'photons'
        ? `photons in last ${fmtTime(DISP_FRAMES * GEOM.frameS)}`
        : s.view === 'ideal'
          ? 'ideal speckle · no photon noise'
          : 'long exposure ≈ 50 ms';
    const headR = w - 8;
    if (s.view !== 'ideal') {
      ctx.font = `700 12px ${FONT}`;
      const sw = ctx.measureText(srcName).width;
      txt(ctx, srcName, headR, 16, { size: 12, weight: 700, color: srcCol, align: 'right', base: 'middle' });
      ctx.fillStyle = srcCol;
      ctx.beginPath();
      ctx.arc(headR - sw - 8, 16, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (g.y0 > 34 || s.view === 'ideal') {
      txt(ctx, viewTxt, headR, s.view === 'ideal' ? 16 : 30, { size: 10.5, color: TOKENS.ink3, align: 'right', base: 'middle' });
    }

    // too-fast warning
    if (info.tauFrames < 2.5) {
      pill(ctx, "50 µs frames · too fast: τ < 2.5 frames", g.cx, g.y0 + g.side - 14, {
        align: 'center',
        size: 10.5,
        color: '#fff',
        bg: 'rgba(120,30,30,0.85)',
      });
    } else if (!s.interacted) {
      const a = 0.55 + 0.45 * pulse;
      pill(ctx, 'drag the ring ⟷', g.cx, g.y0 + g.side - 14, { align: 'center', size: 11, color: rgba('#ffffff', a), border: rgba(s.accent, 0.6 * a) });
    }

    // colour bar + q scale (bottom)
    this.drawScale(s, g);
  }

  private drawScale(s: ViewState, g: DetGeom): void {
    const { ctx, w } = this.c;
    const y = g.y0 + g.side + 10;
    const barW = Math.min(150, g.side * 0.42);
    const x = g.x0;
    const L = this.L;
    const segs = 48;
    for (let i = 0; i < segs; i++) {
      const v = i / (segs - 1);
      const k = Math.round(v * 255) * 3;
      ctx.fillStyle = `rgb(${L[k]},${L[k + 1]},${L[k + 2]})`;
      ctx.fillRect(x + (i * barW) / segs, y, barW / segs + 0.6, 7);
    }
    ctx.strokeStyle = 'rgba(150,180,220,0.3)';
    ctx.strokeRect(x - 0.5, y - 0.5, barW + 1, 8);
    const lab = (t: string, f: number) => txt(ctx, t, x + f * barW, y + 19, { size: 10, color: TOKENS.ink3, align: 'center' });
    if (s.view === 'photons' || s.view === 'ideal') {
      const pos = (n: number) => (n <= 0 ? 0 : 0.36 + (0.64 * Math.log(n)) / Math.log(N_SAT));
      if (s.view === 'photons') {
        lab('0', 0);
        lab('1', pos(1));
        lab('5', pos(5));
        lab('10', pos(10));
        lab(`${N_SAT}`, 1);
        txt(ctx, 'photons', x + barW + 8, y + 7, { size: 10, color: TOKENS.ink3, base: 'alphabetic' });
      } else {
        const lo = Math.log10(0.05);
        const hi = Math.log10(N_SAT);
        const f = (n: number) => (Math.log10(n) - lo) / (hi - lo);
        lab('0.05', 0);
        lab('1', f(1));
        lab(`${N_SAT}`, 1);
        txt(ctx, 'mean photons', x + barW + 8, y + 7, { size: 10, color: TOKENS.ink3 });
      }
    } else {
      lab('low', 0.08);
      lab('high', 0.92);
      txt(ctx, 'log intensity', x + barW + 8, y + 7, { size: 10, color: TOKENS.ink3 });
    }
    // q scale bar (right side)
    const qBar = 1e-3 / this.sim.dqA; // detector px per 10⁻³ Å⁻¹
    const bw = qBar * g.scale;
    const xr = g.x0 + g.side;
    // the Δq scale bar where it fits, and the plain hint to its left (narrow phones: the note in the controls says
    // the same)
    const hint = 'outer rings = finer details';
    ctx.font = `500 10px ${FONT}`;
    const unitEnd = x + barW + 8 + ctx.measureText(s.view === 'long' ? 'log intensity' : s.view === 'ideal' ? 'mean photons' : 'photons').width;
    const hintW = ctx.measureText(hint).width;
    const bar = xr - bw > x + barW + 90 && xr < w;
    const hintR = bar ? xr - bw - 12 : xr;
    if (hintR - hintW > unitEnd + 12) txt(ctx, hint, hintR, y + 7, { size: 10, color: TOKENS.ink3, align: 'right' });
    if (bar) {
      ctx.strokeStyle = TOKENS.ink2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xr - bw, y + 3);
      ctx.lineTo(xr, y + 3);
      ctx.moveTo(xr - bw, y);
      ctx.lineTo(xr - bw, y + 6);
      ctx.moveTo(xr, y);
      ctx.lineTo(xr, y + 6);
      ctx.stroke();
      txt(ctx, 'Δq = 10⁻³ Å⁻¹', xr - bw / 2, y + 19, { size: 10, color: TOKENS.ink3, align: 'center' });
    }
  }

  /** Map a pointer position to (radius in detector px, angle). */
  pick(x: number, y: number): { r: number; theta: number; inside: boolean } {
    const g = this.geom;
    const dx = (x - g.cx) / g.scale;
    const dy = (y - g.cy) / g.scale;
    const inside = x >= g.x0 - 12 && x <= g.x0 + g.side + 12 && y >= g.y0 - 12 && y <= g.y0 + g.side + 12;
    return { r: Math.hypot(dx, dy), theta: Math.atan2(dy, dx), inside };
  }
}

// ======================================================================= sample

const TRAIL = 900;

export class SampleView {
  /** sprites pre-lit at LEVELS illumination levels (0 = outside the beam … LEVELS−1 = beam centre) */
  private sprites: HTMLCanvasElement[] = [];
  private glow: HTMLCanvasElement | null = null;
  private glowKey = '';
  readonly tracked = new Int32Array([-1, -1, -1]);
  private trailX: Float32Array[] = [];
  private trailY: Float32Array[] = [];
  private trailHead = new Int32Array(3);
  private trailLen = new Int32Array(3);
  private pickR = 0;

  constructor(private c: Canvas2D, private sim: XpcsSim, accent: string) {
    for (let i = 0; i < LEVELS; i++) this.sprites.push(sprite(accent, i / (LEVELS - 1)));
    for (let i = 0; i < 3; i++) {
      this.trailX.push(new Float32Array(TRAIL));
      this.trailY.push(new Float32Array(TRAIL));
    }
  }

  private beamSigmaPx(): number {
    return this.sim.sBeam;
  }

  /** choose a new particle to follow: the one nearest to a target point at 0.7 σ, 120° apart per slot */
  private retarget(slot: number): void {
    const sim = this.sim;
    const c = sim.n / 2;
    const s = this.beamSigmaPx();
    this.pickR = (this.pickR + 1) % 7;
    const ang = (slot * 2 * Math.PI) / 3 + 0.5 + this.pickR * 0.3;
    const tx = c + 0.7 * s * Math.cos(ang);
    const ty = c + 0.7 * s * Math.sin(ang);
    let best = -1;
    let bd = Infinity;
    for (let j = 0; j < sim.N; j++) {
      if (this.tracked.includes(j)) continue;
      const dx = sim.px[j] - tx;
      const dy = sim.py[j] - ty;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    this.tracked[slot] = best;
    this.trailLen[slot] = 0;
    this.trailHead[slot] = 0;
  }

  /** record the tracked particles (call after every sim step) */
  record(): void {
    const sim = this.sim;
    const c = sim.n / 2;
    const lim = this.beamSigmaPx() * 2.6;
    for (let i = 0; i < 3; i++) {
      let j = this.tracked[i];
      if (j >= 0) {
        const dx = sim.px[j] - c;
        const dy = sim.py[j] - c;
        if (dx * dx + dy * dy > lim * lim) j = -1;
      }
      if (j < 0) {
        this.retarget(i);
        j = this.tracked[i];
        if (j < 0) continue;
      }
      const h = this.trailHead[i];
      this.trailX[i][h] = sim.ux[j];
      this.trailY[i][h] = sim.uy[j];
      this.trailHead[i] = (h + 1) % TRAIL;
      this.trailLen[i] = Math.min(TRAIL, this.trailLen[i] + 1);
    }
  }

  draw(s: ViewState, radiusNm: number, tempC: number, nInBeam: number, slowMo: number): void {
    const { ctx, w, h } = this.c;
    const sim = this.sim;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    const dxUm = sim.dxM * 1e6;
    const sUm = this.beamSigmaPx() * dxUm;
    const k = Math.max(10, Math.min(w / 6.6, (h - 28) / 4.4)); // px per µm
    const cx = w / 2;
    const cy = 22 + (h - 22) / 2;
    // beam glow (Gaussian intensity profile), cached per size
    const R = sUm * 3.2 * k;
    const key = `${w}x${h}:${k.toFixed(2)}`;
    if (key !== this.glowKey || !this.glow) {
      this.glowKey = key;
      const cv = this.glow ?? document.createElement('canvas');
      const D = Math.ceil(2 * R);
      cv.width = cv.height = D;
      const gc = cv.getContext('2d')!;
      const grad = gc.createRadialGradient(D / 2, D / 2, 0, D / 2, D / 2, R);
      for (let i = 0; i <= 12; i++) {
        const rr = (i / 12) * 3.2; // in σ
        grad.addColorStop(i / 12, rgba(s.accent, 0.3 * Math.exp((-rr * rr) / 2)));
      }
      gc.clearRect(0, 0, D, D);
      gc.fillStyle = grad;
      gc.fillRect(0, 0, D, D);
      this.glow = cv;
    }
    ctx.drawImage(this.glow, cx - this.glow.width / 2, cy - this.glow.height / 2);

    // the density "ripple" this ring is sensitive to (wave vector along the handle direction)
    const q = sim.qOf(s.ringR) * 1e4; // 1/µm
    const lamUm = (2 * Math.PI) / q;
    const Rw = sUm * 2.2 * k;
    const ux = Math.cos(s.theta);
    const uy = Math.sin(s.theta);
    const spacing = lamUm * k;
    ctx.save();
    ctx.lineWidth = 1.2;
    const nMax = Math.ceil(Rw / spacing);
    for (let i = -nMax; i <= nMax; i++) {
      const d = i * spacing;
      if (Math.abs(d) >= Rw) continue;
      const half = Math.sqrt(Rw * Rw - d * d);
      const a = 0.32 * Math.exp((-d * d) / (2 * (sUm * k * 1.2) ** 2));
      ctx.strokeStyle = rgba(s.accent, a);
      const px0 = cx + d * ux;
      const py0 = cy + d * uy;
      ctx.beginPath();
      ctx.moveTo(px0 - half * uy, py0 + half * ux);
      ctx.lineTo(px0 + half * uy, py0 - half * ux);
      ctx.stroke();
    }
    ctx.restore();

    // FWHM circle
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = rgba(s.accent, 0.55);
    ctx.lineWidth = 1;
    const rF = (GEOM.beamFwhmUm / 2) * k;
    ctx.beginPath();
    ctx.arc(cx, cy, rF, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // particles
    const c = sim.n / 2;
    const rPx = Math.max(1.4, radiusNm * 1e-3 * k);
    const sz = rPx * 2;
    const inv2s2 = 1 / (2 * sUm * sUm);
    for (let j = 0; j < sim.N; j++) {
      const xu = (sim.px[j] - c) * dxUm;
      const yu = (sim.py[j] - c) * dxUm;
      const X = cx + xu * k;
      const Y = cy + yu * k;
      if (X < -rPx || X > w + rPx || Y < -rPx || Y > h + rPx) continue;
      const b = Math.exp(-(xu * xu + yu * yu) * inv2s2);
      ctx.drawImage(this.sprites[Math.min(LEVELS - 1, Math.round(b * (LEVELS - 1)))], X - rPx, Y - rPx, sz, sz);
    }

    // trails of tracked particles (Brownian random walks)
    for (let i = 0; i < 3; i++) {
      const j = this.tracked[i];
      const n = this.trailLen[i];
      if (j < 0 || n < 2) continue;
      const X0 = cx + (sim.px[j] - c) * dxUm * k;
      const Y0 = cy + (sim.py[j] - c) * dxUm * k;
      const ux0 = sim.ux[j];
      const uy0 = sim.uy[j];
      const TX = this.trailX[i];
      const TY = this.trailY[i];
      const head = this.trailHead[i];
      const CH = 6;
      for (let ch = 0; ch < CH; ch++) {
        const a0 = Math.floor((ch * n) / CH);
        const a1 = Math.floor(((ch + 1) * n) / CH);
        ctx.strokeStyle = rgba(TOKENS.electron, 0.12 + (0.75 * (ch + 1)) / CH);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let m = a0; m <= Math.min(n - 1, a1); m++) {
          const idx = (head - n + m + TRAIL * 2) % TRAIL;
          const X = X0 + (TX[idx] - ux0) * dxUm * k;
          const Y = Y0 + (TY[idx] - uy0) * dxUm * k;
          if (m === a0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = TOKENS.electron;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X0, Y0, rPx + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // annotations ---------------------------------------------------------------
    // beam label
    const bl = `coherent X-ray spot, ${GEOM.beamFwhmUm} µm wide`;
    pill(ctx, bl, cx, Math.max(32, cy - rF - 2), { size: 10.5, color: '#e6f7ff', align: 'center', border: rgba(s.accent, 0.45) });
    // ripple label: dimension arrow between two neighbouring crests, placed below-right of centre
    if (spacing > 10) {
      const off = Math.min(Rw * 0.82, rF * 1.05);
      const bx = cx - uy * off;
      const by = cy + ux * off;
      const ex = bx + ux * spacing;
      const ey = by + uy * spacing;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      for (const [px0, py0, dir] of [
        [bx, by, -1],
        [ex, ey, 1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(px0, py0);
        ctx.lineTo(px0 - dir * 5 * ux - 3 * uy, py0 - dir * 5 * uy + 3 * ux);
        ctx.moveTo(px0, py0);
        ctx.lineTo(px0 - dir * 5 * ux + 3 * uy, py0 - dir * 5 * uy - 3 * ux);
        ctx.stroke();
      }
      const lab = `length scale 2π/q ≈ ${fmtLen(lamUm * 1e-6)}`;
      ctx.font = `600 10.5px ${FONT}`;
      const tw = ctx.measureText(lab).width + 12;
      let lx = (bx + ex) / 2 - uy * 14 - tw / 2;
      let ly = (by + ey) / 2 + ux * 14;
      lx = Math.max(4, Math.min(w - tw - 4, lx));
      // keep clear of the bottom row (scale bar + trail legend, ≈ h − 18 … h − 6)
      ly = Math.max(30, Math.min(h - 34, ly));
      pill(ctx, lab, lx, ly, { size: 10.5, color: '#fff', border: rgba(s.accent, 0.6) });
    }
    // scale bar
    const sbY = h - 10;
    ctx.strokeStyle = TOKENS.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, sbY);
    ctx.lineTo(10 + k, sbY);
    ctx.stroke();
    txt(ctx, '1 µm', 10 + k + 6, sbY + 3.5, { size: 10.5, color: TOKENS.ink2 });
    // sample info (top-right)
    // longest variant that clears the panel title on the left
    ctx.font = `500 10.5px ${FONT}`;
    const variants = [
      `radius ${Math.round(radiusNm)} nm · ${Math.round(tempC)} °C water · ≈${Math.round(nInBeam)} in the spot`,
      `radius ${Math.round(radiusNm)} nm · ${Math.round(tempC)} °C water`,
      `${Math.round(radiusNm)} nm · ${Math.round(tempC)} °C`,
    ];
    const info = variants.find((t) => w - 8 - ctx.measureText(t).width > 190) ?? variants[variants.length - 1];
    txt(ctx, info, w - 8, 16, { size: 10.5, color: TOKENS.ink3, align: 'right', base: 'middle' });
    if (slowMo > 1) {
      const sm = slowMo >= 100 ? Math.round(slowMo / 10) * 10 : Math.round(slowMo);
      txt(ctx, `▶ ${sm}× slow motion`, w - 8, 31, { size: 10.5, color: TOKENS.warn, align: 'right', base: 'middle', weight: 600 });
    }
    // trail legend (bottom-right)
    ctx.strokeStyle = TOKENS.electron;
    ctx.lineWidth = 2;
    const tl = `3 random walks, last ${fmtTime(TRAIL * GEOM.frameS)}`;
    ctx.font = `500 10.5px ${FONT}`;
    const tlw = ctx.measureText(tl).width;
    ctx.beginPath();
    ctx.moveTo(w - tlw - 30, sbY - 3);
    ctx.lineTo(w - tlw - 16, sbY - 3);
    ctx.stroke();
    txt(ctx, tl, w - 8, sbY + 0.5, { size: 10.5, color: TOKENS.ink2, align: 'right' });
  }
}

const LEVELS = 8;

/** A shaded sphere sprite; `lit` ∈ [0,1] blends from a dim grey bead to a bead glowing in the beam colour. */
function sprite(color: string, lit: number): HTMLCanvasElement {
  const S = 48;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const [ar, ag, ab] = hexToRgb(color);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * lit);
  const edge = `rgba(${mix(70, ar)},${mix(82, ag)},${mix(100, ab)},${0.55 + 0.35 * lit})`;
  const mid = `rgba(${mix(120, Math.round((ar + 255) / 2))},${mix(135, Math.round((ag + 255) / 2))},${mix(155, Math.round((ab + 255) / 2))},${0.6 + 0.4 * lit})`;
  const core = `rgba(${mix(200, 255)},${mix(210, 255)},${mix(225, 255)},${0.75 + 0.25 * lit})`;
  const gr = g.createRadialGradient(S * 0.38, S * 0.36, S * 0.04, S / 2, S / 2, S / 2);
  gr.addColorStop(0, core);
  gr.addColorStop(0.55, mid);
  gr.addColorStop(1, edge);
  g.globalAlpha = 0.45 + 0.55 * lit;
  g.fillStyle = gr;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
  g.fill();
  return cv;
}

// ======================================================================= correlation plot

export interface MapData {
  /** ring radii (detector px) */
  rings: Int32Array;
  /** fitted Γ (1/s) per ring and source, NaN if not measurable */
  gamma: [Float64Array, Float64Array];
  /** 1σ error of ln Γ */
  sig: [Float64Array, Float64Array];
  /** diffusion coefficient (m²/s) used for the theory line */
  D: number;
  /** D from a weighted fit of the APS-U points (m²/s), NaN if none */
  Dfit: number;
  /** measuring time so far (s) */
  T: number;
}

export interface PlotData {
  series: [G2Series, G2Series];
  beta: number;
  /** Γ per frame on the ring */
  gamma: number;
  fit: [{ beta: number; gamma: number } | null, { beta: number; gamma: number } | null];
  meanTrace: number;
  /** mean photons per pixel per frame on the selected ring, selected source */
  ringMean: number;
  mode: 'ring' | 'map';
  map: MapData;
}

const TAU_MIN = 2.5e-5;
const TAU_MAX = 1;
const Y_MIN = 0.8;
const Y_MAX = 1.8;

export class G2View {
  private xs = new Float64Array(160);
  private ys = new Float64Array(160);
  frame: PlotFrame | null = null;

  constructor(private c: Canvas2D, private sim: XpcsSim) {}

  draw(s: ViewState, d: PlotData): void {
    const { ctx, w, h } = this.c;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    if (d.mode === 'map') {
      this.drawMap(s, { x: 0, y: 34, w, h: h - 34 }, d);
      return;
    }
    const traceH = Math.round(Math.max(58, Math.min(96, h * 0.24)));
    this.drawTrace(s, 34, traceH, d);
    const top = 34 + traceH + 8;
    this.drawPlot(s, { x: 0, y: top, w, h: h - top }, d);
  }

  /** Relaxation rate vs q for every ring (log–log): the diffusion law Γ = Dq² and the accessible window. */
  private drawMap(s: ViewState, rect: { x: number; y: number; w: number; h: number }, d: PlotData): void {
    const { ctx } = this.c;
    const sim = this.sim;
    const m = d.map;
    const Q0 = 2.6e-4;
    const Q1 = 3.2e-3;
    const G0 = 1;
    const G1 = 2e5;
    const fq = (v: number) => {
      const e = Math.floor(Math.log10(v));
      const mnt = Math.round(v / 10 ** e);
      return `${mnt}×10${e === -4 ? '⁻⁴' : e === -3 ? '⁻³' : `^${e}`}`;
    };
    const fG = (v: number) => (v >= 1e3 ? `10${['', '', '', '³', '⁴', '⁵'][Math.round(Math.log10(v))]}` : String(v));
    const f = plotFrame(
      ctx,
      rect,
      { min: Q0, max: Q1, log: true, ticks: [3e-4, 5e-4, 1e-3, 2e-3, 3e-3], format: fq, label: "ring q (Å⁻¹) · finer spatial scale →" },
      { min: G0, max: G1, log: true, ticks: [1, 10, 100, 1e3, 1e4, 1e5], format: fG, label: 'rate Γ = 1/τ (s⁻¹)' },
    );
    this.frame = f;
    const tf = GEOM.frameS;
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x0, f.y1, f.x1 - f.x0, f.y0 - f.y1);
    ctx.clip();
    // inaccessible regions: faster than ~2 frames, slower than T/3
    const gFast = 1 / (2 * tf);
    const yFast = f.py(Math.min(G1, gFast));
    ctx.fillStyle = 'rgba(248,113,113,0.10)';
    ctx.fillRect(f.x0, f.y1, f.x1 - f.x0, yFast - f.y1);
    const gSlow = m.T > 0 ? 3 / m.T : G1;
    const ySlow = f.py(Math.max(G0, Math.min(G1, gSlow)));
    ctx.fillStyle = 'rgba(154,166,184,0.10)';
    ctx.fillRect(f.x0, ySlow, f.x1 - f.x0, f.y0 - ySlow);
    // theory Γ = D q²
    ctx.strokeStyle = 'rgba(233,238,245,0.85)';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const q = Q0 * (Q1 / Q0) ** (i / 40);
      const G = m.D * (q * 1e10) ** 2;
      const X = f.px(q);
      const Y = f.py(Math.max(G0 / 10, G));
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // current ring
    const qr = sim.qOf(s.ringR);
    ctx.strokeStyle = rgba(s.accent, 0.45);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(f.px(qr), f.y1);
    ctx.lineTo(f.px(qr), f.y0);
    ctx.stroke();
    // points
    const order: SourceIx[] = s.src === 1 ? [0, 1] : [1, 0];
    for (const si of order) {
      const sel = si === s.src;
      const col = si === 1 ? s.accent : TOKENS.old;
      ctx.globalAlpha = sel ? 1 : 0.5;
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < m.rings.length; i++) {
        const G = m.gamma[si][i];
        if (!(G > 0)) continue;
        const X = f.px(sim.qOf(m.rings[i]));
        const sg = Math.min(2, m.sig[si][i]);
        ctx.beginPath();
        ctx.moveTo(X, f.py(G * Math.exp(-sg)));
        ctx.lineTo(X, f.py(G * Math.exp(sg)));
        ctx.stroke();
        ctx.beginPath();
        if (si === 1) {
          ctx.arc(X, f.py(G), sel ? 3.4 : 2.8, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // APS: hollow, so it stays visible where it overlaps the APS-U points
          ctx.arc(X, f.py(G), sel ? 4.6 : 4.2, 0, Math.PI * 2);
          ctx.lineWidth = sel ? 1.8 : 1.4;
          ctx.stroke();
          ctx.lineWidth = 1.2;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // region labels
    if (yFast - f.y1 > 14) txt(ctx, "too fast · τ < 2 frames = 100 µs", f.x0 + 6, f.y1 + 12, { size: 10, color: '#fca5a5' });
    if (f.y0 - ySlow > 14) txt(ctx, `too slow so far: τ > T/3, measuring time T = ${fmtTime(m.T)}`, f.x0 + 6, f.y0 - 6, { size: 10, color: TOKENS.ink3 });
    // slope annotation
    const qa = 1.5e-3;
    const Ga = m.D * (qa * 1e10) ** 2;
    if (Ga > G0 * 3 && Ga < G1 / 3) {
      const lab = "Γ = Dq² · half the length scale → 4× faster decay";
      ctx.font = `600 10.5px ${FONT}`;
      const tw = ctx.measureText(lab).width;
      pill(ctx, lab, Math.min(f.x1 - tw - 14, f.px(qa) + 10), f.py(Ga) + 16, { size: 10.5, color: TOKENS.ink, border: 'rgba(233,238,245,0.35)' });
    }
    // legend (bottom-right: below the diffusion line there is always free space)
    const spec = Number.isFinite(m.Dfit);
    const dTxt = spec ? `D: fit ${(m.Dfit * 1e12).toFixed(2)}, theory ${(m.D * 1e12).toFixed(2)} µm²/s` : '';
    ctx.font = `600 10.5px ${FONT}`;
    const legW = Math.max(110, spec ? ctx.measureText(dTxt).width + 4 : 0);
    const lx = f.x1 - legW - 4;
    let ly = f.y0 - (spec ? 50 : 36) - (f.y0 - ySlow > 14 ? 0 : 0);
    const items: [string, string, boolean][] = [
      ['APS-U', s.accent, true],
      ["APS before upgrade", TOKENS.old, false],
    ];
    for (const [lab, col, filled] of items) {
      ctx.beginPath();
      if (filled) {
        ctx.fillStyle = col;
        ctx.arc(lx + 4, ly, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6;
        ctx.arc(lx + 4, ly, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      txt(ctx, lab, lx + 13, ly, { size: 10.5, color: TOKENS.ink2, base: 'middle', weight: 600 });
      ly += 15;
    }
    if (spec) txt(ctx, dTxt, lx, ly, { size: 10.5, color: TOKENS.ink2, base: 'middle' });
  }

  private drawTrace(s: ViewState, y0: number, th: number, d: PlotData): void {
    const { ctx, w } = this.c;
    const sim = this.sim;
    const x0 = 46;
    const x1 = w - 10;
    const yb = y0 + th - 6;
    const yt = y0 + 22; // below the title row, so the axis label does not read as part of the title
    const n = sim.traceLen;
    // y scale: counts of the selected source
    const g = s.src === 1 ? 1 : 1 / APSU_GAIN;
    let mx = 0;
    const cts0 = sim.traceCounts[s.src];
    for (let i = 0; i < n; i++) mx = Math.max(mx, cts0[i], sim.traceIdeal[i] * g);
    const ymax = Math.max(2, Math.ceil(Math.max(mx, d.meanTrace * g * 2)));
    const py = (v: number) => yb - (Math.min(v, ymax) / ymax) * (yb - yt);
    const pxf = (i: number) => x0 + ((i + (TRACE_LEN - n)) / (TRACE_LEN - 1)) * (x1 - x0);
    // frame
    ctx.strokeStyle = TOKENS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, yb + 0.5);
    ctx.lineTo(x1, yb + 0.5);
    ctx.stroke();
    txt(ctx, "Intensity I(t) at one speckle pixel", x0, y0 + 2, { size: 10.5, color: TOKENS.ink2, base: 'top', weight: 600 });
    txt(ctx, `last ${fmtTime(TRACE_LEN * GEOM.frameS)} → now`, x1, y0 + 2, { size: 10, color: TOKENS.ink3, base: 'top', align: 'right' });
    txt(ctx, '0', x0 - 5, yb, { size: 10, color: TOKENS.ink3, align: 'right', base: 'middle' });
    txt(ctx, String(ymax), x0 - 5, yt, { size: 10, color: TOKENS.ink3, align: 'right', base: 'middle' });
    if (n < 2) return;
    const head = sim.traceHead;
    // photon counts (bars)
    const cts = sim.traceCounts[s.src];
    const col = s.src === 1 ? s.accent : TOKENS.old;
    ctx.fillStyle = col;
    const bw = Math.max(1, ((x1 - x0) / TRACE_LEN) * 0.9);
    for (let i = 0; i < n; i++) {
      const idx = (head - n + i + TRACE_LEN) % TRACE_LEN;
      const v = cts[idx];
      if (v <= 0) continue;
      const X = pxf(i);
      const Y = py(v);
      ctx.fillRect(X - bw / 2, Y, bw, yb - Y);
    }
    // expected intensity (the ideal speckle intensity at that pixel, scaled to this source)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const idx = (head - n + i + TRACE_LEN) % TRACE_LEN;
      const X = pxf(i);
      const Y = py(sim.traceIdeal[idx] * g);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.stroke();
    // photon-starved: say so, otherwise an almost empty trace looks broken
    const mean = d.ringMean;
    if (mean > 0 && mean < 0.05) {
      const every = Math.round(1 / mean).toLocaleString('en-US');
      const t = `low counts: ⟨n⟩ ≈ ${sci(mean, 2)} per frame · ~1 photon every ${every} frames`;
      pill(ctx, t, (x0 + x1) / 2, (yt + yb) / 2, { size: 10.5, color: TOKENS.ink2, align: 'center' });
    }
  }

  private drawPlot(s: ViewState, rect: { x: number; y: number; w: number; h: number }, d: PlotData): void {
    const { ctx } = this.c;
    const tf = GEOM.frameS;
    const fmtX = (v: number) => (v >= 1 ? `${v} s` : v >= 1e-3 ? `${+(v * 1e3).toPrecision(3)} ms` : `${+(v * 1e6).toPrecision(3)} µs`);
    const f = plotFrame(
      ctx,
      rect,
      { min: TAU_MIN, max: TAU_MAX, log: true, ticks: [1e-4, 1e-3, 1e-2, 1e-1, 1], format: fmtX, label: 'time delay τ' },
      { min: Y_MIN, max: Y_MAX, ticks: [0.8, 1, 1.2, 1.4, 1.6, 1.8], format: (v) => v.toFixed(1), label: 'similarity g₂(τ)' },
    );
    this.frame = f;
    // baseline g2 = 1 and the contrast level
    ctx.save();
    ctx.strokeStyle = 'rgba(170,190,215,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(f.x0, f.py(1));
    ctx.lineTo(f.x1, f.py(1));
    ctx.stroke();
    ctx.restore();

    txt(ctx, "uncorrelated intensities: g₂ = 1", f.x1 - 4, f.py(1) + 12, { size: 10, color: TOKENS.ink3, align: 'right' });
    txt(ctx, 'same pattern: 1 + β', f.x0 + 6, f.py(1 + d.beta) - 9, { size: 10, color: TOKENS.ink3 });
    // theory
    const xs = this.xs;
    const ys = this.ys;
    const nT = 120;
    for (let i = 0; i < nT; i++) {
      const t = TAU_MIN * Math.pow(TAU_MAX / TAU_MIN, i / (nT - 1));
      xs[i] = t;
      ys[i] = 1 + d.beta * Math.exp((-2 * d.gamma * t) / tf);
    }
    this.curve(f, xs, ys, nT, 'rgba(233,238,245,0.85)', 1.6, [6, 4]);

    // τ marker
    const tauS = tf / d.gamma;
    if (tauS > TAU_MIN && tauS < TAU_MAX) {
      const X = f.px(tauS);
      ctx.save();
      ctx.strokeStyle = 'rgba(233,238,245,0.35)';
      ctx.setLineDash([1, 3]);
      ctx.beginPath();
      ctx.moveTo(X, f.y1);
      ctx.lineTo(X, f.y0);
      ctx.stroke();
      ctx.restore();
      const lab = `τ = ${fmtTime(tauS)}`;
      ctx.font = `600 10.5px ${FONT}`;
      const tw = ctx.measureText(lab).width;
      const legendL = f.x1 - 190; // the legend occupies the top-right corner (3–4 rows)
      let lx = X + 5;
      let ly = f.y1 + 10;
      if (lx + tw > legendL) {
        if (X - tw - 5 > f.x0 && X < legendL) lx = X - tw - 5;
        else {
          lx = Math.min(X + 5, f.x1 - tw - 2);
          ly = f.y1 + 76;
        }
      }
      pill(ctx, lab, lx - 6, ly, { size: 10.5, color: TOKENS.ink, bg: 'rgba(5,8,14,0.85)' });
    }

    // fits to the data (thin solid lines), once a source's curve stands clear of the noise
    let anyFit = false;
    for (const si of [0, 1] as const) {
      const ft = d.fit[si];
      if (!ft) continue;
      anyFit = true;
      for (let i = 0; i < nT; i++) ys[i] = 1 + ft.beta * Math.exp((-2 * ft.gamma * xs[i]) / tf);
      this.curve(f, xs, ys, nT, si === 1 ? rgba(s.accent, 0.9) : 'rgba(154,166,184,0.8)', 1.2, []);
    }

    // data: other source first (faded), selected on top
    const order: SourceIx[] = s.src === 1 ? [0, 1] : [1, 0];
    for (const si of order) {
      const ser = d.series[si];
      const sel = si === s.src;
      const col = si === 1 ? s.accent : TOKENS.old;
      this.points(f, ser, col, sel ? 3.2 : 2.3, sel ? 1 : 0.45);
    }

    // legend
    const lx = f.x1 - 6;
    let ly = f.y1 + 10;
    const item = (label: string, col: string, kind: 'dot' | 'dash' | 'line', alpha: number) => {
      ctx.font = `600 10.5px ${FONT}`;
      const tw = ctx.measureText(label).width;
      txt(ctx, label, lx, ly, { size: 10.5, color: TOKENS.ink2, align: 'right', base: 'middle', weight: 600 });
      ctx.globalAlpha = alpha;
      if (kind === 'dot') {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(lx - tw - 9, ly, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = col;
        ctx.setLineDash(kind === 'dash' ? [5, 3] : []);
        ctx.lineWidth = kind === 'dash' ? 1.6 : 1.2;
        ctx.beginPath();
        ctx.moveTo(lx - tw - 20, ly);
        ctx.lineTo(lx - tw - 5, ly);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
      ly += 15;
    };
    item('APS-U', s.accent, 'dot', s.src === 1 ? 1 : 0.55);
    item("APS before upgrade", TOKENS.old, 'dot', s.src === 0 ? 1 : 0.55);
    item('theory: 1 + β·exp(−2Dq²τ)', 'rgba(233,238,245,0.85)', 'dash', 1);
    if (anyFit) item('fit to the data', rgba(s.accent, 0.9), 'line', 1);

    if (d.series[0].n === 0 && d.series[1].n === 0) {
      txt(ctx, "collecting photon counts…", (f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, { size: 12, color: TOKENS.ink3, align: 'center', base: 'middle' });
    }
  }

  private curve(f: PlotFrame, xs: Float64Array, ys: Float64Array, n: number, color: string, lw: number, dash: number[]): void {
    const { ctx } = this.c;
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x0, f.y1, f.x1 - f.x0, f.y0 - f.y1);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.setLineDash(dash);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const X = f.px(xs[i]);
      const Y = f.py(ys[i]);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private points(f: PlotFrame, ser: G2Series, color: string, r: number, alpha: number): void {
    const { ctx } = this.c;
    const tf = GEOM.frameS;
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x0 - 4, f.y1 - 4, f.x1 - f.x0 + 8, f.y0 - f.y1 + 8);
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    for (let i = 0; i < ser.n; i++) {
      const t = ser.tau[i] * tf;
      if (t < TAU_MIN || t > TAU_MAX) continue;
      const X = f.px(t);
      const g = ser.g2[i];
      const e = ser.err[i];
      const yLo = Math.max(Y_MIN, g - e);
      const yHi = Math.min(Y_MAX, g + e);
      if (Number.isFinite(e) && yHi > yLo) {
        ctx.globalAlpha = alpha * 0.55;
        ctx.beginPath();
        ctx.moveTo(X, f.py(yLo));
        ctx.lineTo(X, f.py(yHi));
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }
      if (g > Y_MAX || g < Y_MIN) {
        // off-scale: small triangle at the edge
        const Y = g > Y_MAX ? f.y1 + 1 : f.y0 - 1;
        const dir = g > Y_MAX ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(X - 3.5, Y + dir * 6);
        ctx.lineTo(X + 3.5, Y + dir * 6);
        ctx.lineTo(X, Y);
        ctx.closePath();
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.arc(X, f.py(g), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
