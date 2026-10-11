/**
 * Energy chart for the coherence station: coherent fraction f_x·f_y vs photon energy for the old APS and APS-U,
 * the APS-U/APS gain, and — when the canvas is tall enough (EMIT_MIN_H) — the electron emittances against the photon
 * diffraction limit λ/4π.
 * Log–log axes, shared energy axis; pointer drag on the chart picks the energy.
 */
import { TOKENS, type Canvas2D } from '../kit';
import * as P from './physics';

export const E_MIN = 5;
export const E_MAX = 110;
const NE = 220;
/** canvas height (px) from which the third subplot (emittance vs λ/4π) has room to be legible */
const EMIT_MIN_H = 600;

export interface ChartState {
  E: number;
  mode: 'round' | 'flat';
  /** shown for CHEX (28-ID): mark its 15–105 keV band and fixed-energy stations */
  chex?: boolean;
}

interface Layout {
  rects: Rect[];
  px: (E: number) => number;
  py1: (v: number) => number;
  py2: (v: number) => number;
  py3: ((v: number) => number) | null;
}

interface Rect {
  x0: number;
  x1: number;
  y0: number; // top
  y1: number; // bottom
}

const OLD = TOKENS.old;

export function fmtInN(f: number): string {
  const n = 1 / f;
  if (n < 9.95) return `1 in ${n.toFixed(1)}`;
  if (n < 1000) return `1 in ${Math.round(n)}`;
  const r = n < 1e4 ? Math.round(n / 10) * 10 : n < 1e5 ? Math.round(n / 100) * 100 : Math.round(n / 1000) * 1000;
  return `1 in ${r.toLocaleString('en-US')}`;
}

export function fmtPct(f: number): string {
  const p = f * 100;
  if (p >= 10) return `${p.toFixed(0)} %`;
  if (p >= 1) return `${p.toFixed(1)} %`;
  if (p >= 0.1) return `${p.toFixed(2)} %`;
  if (p >= 0.01) return `${p.toFixed(3)} %`;
  return `${p.toPrecision(2)} %`;
}

export function fmtGain(g: number): string {
  return `×${g >= 100 ? Math.round(g) : g >= 10 ? Math.round(g) : g.toFixed(1)}`;
}

function fmtPm(v: number): string {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 10) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2);
}

export class EnergyChart {
  private es = new Float64Array(NE);
  private fOld = new Float64Array(NE);
  private fRound = new Float64Array(NE);
  private fFlat = new Float64Array(NE);
  private gRound = new Float64Array(NE);
  private gFlat = new Float64Array(NE);
  private dl = new Float64Array(NE);
  private st: ChartState = { E: 25, mode: 'round' };
  private plotX0 = 0;
  private plotX1 = 1;
  private dragging = false;
  /** vertical bounds for value pills (set per subplot while drawing) */
  private clampY: [number, number] | null = null;
  /** context the helpers draw into: the cached static layer or the visible canvas */
  private g: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private layerCtx: CanvasRenderingContext2D;
  private layerKey = '';
  private lay: Layout | null = null;

  constructor(
    private c: Canvas2D,
    private accent: string,
    private onPick: (E: number) => void,
  ) {
    this.g = c.ctx;
    this.layer = document.createElement('canvas');
    this.layerCtx = this.layer.getContext('2d')!;
    for (let i = 0; i < NE; i++) {
      const E = E_MIN * Math.pow(E_MAX / E_MIN, i / (NE - 1));
      this.es[i] = E;
      const o = P.coherence(P.APS_2019, E).f;
      const r = P.coherence(P.APSU_ROUND, E).f;
      const f = P.coherence(P.APSU_FLAT, E).f;
      this.fOld[i] = o;
      this.fRound[i] = r;
      this.fFlat[i] = f;
      this.gRound[i] = r / o;
      this.gFlat[i] = f / o;
      this.dl[i] = P.diffractionLimit(E) * 1e12;
    }
    const cv = c.canvas;
    cv.style.cursor = 'ew-resize';
    const pick = (ev: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const t = Math.max(0, Math.min(1, (x - this.plotX0) / Math.max(1, this.plotX1 - this.plotX0)));
      this.onPick(E_MIN * Math.pow(E_MAX / E_MIN, t));
    };
    // Mouse/pen: pick on press and drag. Touch (canvas has touch-action: pan-y so the page can still scroll):
    // pick only once the finger moves sideways, or on a tap — a vertical swipe scrolls without changing E.
    let touch: { id: number; x: number; y: number } | null = null;
    cv.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'touch') {
        touch = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
        return;
      }
      this.dragging = true;
      cv.setPointerCapture(ev.pointerId);
      pick(ev);
    });
    cv.addEventListener('pointermove', (ev) => {
      if (touch && ev.pointerId === touch.id && !this.dragging) {
        const dx = Math.abs(ev.clientX - touch.x);
        const dy = Math.abs(ev.clientY - touch.y);
        if (dx > 6 && dx > dy) {
          this.dragging = true;
          cv.setPointerCapture(ev.pointerId);
        }
      }
      if (this.dragging) pick(ev);
    });
    const end = (ev: PointerEvent) => {
      if (ev.type === 'pointerup' && touch && ev.pointerId === touch.id && !this.dragging) {
        if (Math.abs(ev.clientX - touch.x) < 8 && Math.abs(ev.clientY - touch.y) < 8) pick(ev); // tap
      }
      if (touch && ev.pointerId === touch.id) touch = null;
      this.dragging = false;
      if (cv.hasPointerCapture(ev.pointerId)) cv.releasePointerCapture(ev.pointerId);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  set(s: ChartState): void {
    this.st = s;
  }

  /** Static axes/curves/labels are cached in an offscreen layer (rebuilt on resize or mode change); only the
   *  energy marker and its value labels are redrawn when the energy changes. */
  draw(): void {
    const { w, h, dpr } = this.c;
    const key = `${w}|${h}|${dpr}|${this.st.mode}|${this.st.chex ? 1 : 0}`;
    if (key !== this.layerKey) {
      this.layerKey = key;
      this.layer.width = Math.max(1, Math.round(w * dpr));
      this.layer.height = Math.max(1, Math.round(h * dpr));
      this.layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.g = this.layerCtx;
      this.drawStatic();
    }
    const ctx = this.c.ctx;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.layer, 0, 0, w, h);
    ctx.restore();
    this.g = ctx;
    this.drawOverlay();
  }

  private drawStatic(): void {
    const ctx = this.g;
    const { w, h } = this.c;
    const s = this.st;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);

    const padL = 70;
    const padR = 14;
    const legendTop = w < 560;
    const top = legendTop ? 46 : 28;
    const bottom = 36;
    const gap = 26;
    const x0 = padL;
    const x1 = w - padR;
    this.plotX0 = x0;
    this.plotX1 = x1;
    const emit = h >= EMIT_MIN_H;
    const shares = emit ? [0.46, 0.25, 0.29] : [0.6, 0.4];
    const avail = h - top - bottom - gap * (shares.length - 1);
    const rects: Rect[] = [];
    let y = top;
    for (const sh of shares) {
      const hh = avail * sh;
      rects.push({ x0, x1, y0: y, y1: y + hh });
      y += hh + gap;
    }
    const px = (E: number) => x0 + (Math.log(E / E_MIN) / Math.log(E_MAX / E_MIN)) * (x1 - x0);
    const narrow = w < 420;

    // ---------------------------------------------------------------- subplot 1: coherent fraction
    const r1 = rects[0];
    const fr: [number, number] = [4e-6, 0.4];
    const py1 = (v: number) => mapLog(v, fr, r1);
    this.frame(r1, px, fr, [1e-5, 1e-4, 1e-3, 1e-2, 1e-1], fmtInNShort, false);
    if (s.chex) this.chexBand(r1, px, true, narrow);
    const fSel = s.mode === 'round' ? this.fRound : this.fFlat;
    const fOther = s.mode === 'round' ? this.fFlat : this.fRound;
    this.curve(r1, px, py1, fOther, this.accent, 1.3, [5, 4], 0.55);
    this.curve(r1, px, py1, this.fOld, OLD, 2.2);
    this.curve(r1, px, py1, fSel, this.accent, 2.6);
    // other-mode tag at the right end
    {
      const v = fOther[NE - 1];
      txt(ctx, s.mode === 'round' ? 'flat' : 'round', x1 - 3, py1(v) + (s.mode === 'round' ? -5 : 12), { color: this.accent, align: 'right', size: 10, alpha: 0.75 });
    }
    // legend: bottom-left inside the plot (below the old-ring curve at low energy); a row above it when narrow
    {
      const items: [string, string][] = legendTop
        ? [
            [w < 400 ? 'APS (before)' : 'APS before (7 GeV)', OLD],
            [w < 400 ? `APS-U (${s.mode})` : `APS-U after (6 GeV, ${s.mode})`, this.accent],
          ]
        : [
            ['APS before the upgrade (7 GeV)', OLD],
            [`APS-U after the upgrade (6 GeV, ${s.mode} beam)`, this.accent],
          ];
      const sw = (lx: number, ly: number, col: string) => {
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + 16, ly);
        ctx.stroke();
        ctx.restore();
      };
      if (legendTop) {
        let lx = x0;
        const ly = 34;
        ctx.save();
        ctx.font = `500 10.5px ${TOKENS.font}`;
        for (const [label, col] of items) {
          sw(lx, ly, col);
          txt(ctx, label, lx + 21, ly + 3.5, { color: TOKENS.ink2, size: 10.5 });
          lx += 21 + ctx.measureText(label).width + 14;
        }
        ctx.restore();
      } else {
        const lx = x0 + 10;
        let ly = r1.y1 - 30;
        ctx.save();
        ctx.fillStyle = 'rgba(5,8,14,0.72)';
        ctx.font = `500 10.5px ${TOKENS.font}`;
        const lw = Math.min(x1 - x0 - 20, 34 + Math.max(...items.map(([t]) => ctx.measureText(t).width)));
        roundRect(ctx, lx - 6, ly - 10, lw, 34, 6);
        ctx.fill();
        ctx.restore();
        for (const [label, col] of items) {
          sw(lx, ly, col);
          txt(ctx, label, lx + 22, ly + 3.5, { color: TOKENS.ink2, size: 10.5 });
          ly += 15;
        }
      }
    }

    // ---------------------------------------------------------------- subplot 2: gain
    const r2 = rects[1];
    const gr: [number, number] = [20, 800];
    const py2 = (v: number) => mapLog(v, gr, r2);
    this.frame(r2, px, gr, [30, 100, 300], (v) => `×${v}`, false, [20, 40, 50, 60, 70, 80, 90, 200, 400, 500, 600, 700, 800]);
    if (s.chex) this.chexBand(r2, px, false, narrow);
    const gSel = s.mode === 'round' ? this.gRound : this.gFlat;
    const gOther = s.mode === 'round' ? this.gFlat : this.gRound;
    this.curve(r2, px, py2, gOther, this.accent, 1.3, [5, 4], 0.55);
    this.curve(r2, px, py2, gSel, this.accent, 2.6);
    // the ratio of in-step *shares*; in-step photons per second gain more (2× current, new undulators): see Numbers
    this.title(r2, w < 480 ? 'In-step share, APS-U ÷ APS' : 'How many times bigger the in-step share is: APS-U ÷ APS');
    txt(ctx, s.mode === 'round' ? 'flat' : 'round', x1 - 3, py2(gOther[NE - 1]) + (s.mode === 'round' ? -5 : 12), { color: this.accent, align: 'right', size: 10, alpha: 0.75 });

    // ---------------------------------------------------------------- subplot 3: emittance vs λ/4π
    if (emit) {
      const r3 = rects[2];
      const er: [number, number] = [0.2, 9000];
      const py3 = (v: number) => mapLog(v, er, r3);
      this.frame(r3, px, er, [1, 10, 100, 1000], (v) => v.toLocaleString('en-US'), false, [0.2, 0.5, 2, 3, 5, 20, 30, 50, 200, 300, 500, 2000, 3000, 5000]);
      // diffraction-limited zone (ε < λ/4π)
      ctx.save();
      ctx.beginPath();
      ctx.rect(r3.x0, r3.y0, r3.x1 - r3.x0, r3.y1 - r3.y0);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(px(this.es[0]), r3.y1);
      for (let i = 0; i < NE; i++) ctx.lineTo(px(this.es[i]), py3(this.dl[i]));
      ctx.lineTo(px(this.es[NE - 1]), r3.y1);
      ctx.closePath();
      ctx.fillStyle = 'rgba(233,238,245,0.07)';
      ctx.fill();
      ctx.restore();
      this.curve(r3, px, py3, this.dl, TOKENS.ink, 2);
      const ring = s.mode === 'round' ? P.APSU_ROUND : P.APSU_FLAT;
      const hline = (v: number, col: string, dash: number[], width = 2) => {
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(r3.x0, py3(v));
        ctx.lineTo(r3.x1, py3(v));
        ctx.stroke();
        ctx.restore();
      };
      hline(P.APS_2019.x.emit * 1e12, OLD, []);
      hline(P.APS_2019.y.emit * 1e12, OLD, [6, 4]);
      hline(ring.x.emit * 1e12, this.accent, []);
      if (ring.y.emit !== ring.x.emit) hline(ring.y.emit * 1e12, this.accent, [6, 4]);
      const lab = (t: string, v: number, col: string, right: boolean, below = false) =>
        txt(ctx, t, right ? r3.x1 - 4 : r3.x0 + 5, py3(v) + (below ? 12 : -4), { color: col, size: 10, align: right ? 'right' : 'left', halo: true });
      lab(`APS sideways ${fmtPm(P.APS_2019.x.emit * 1e12)} pm`, P.APS_2019.x.emit * 1e12, OLD, false, true);
      lab(`APS up–down ${fmtPm(P.APS_2019.y.emit * 1e12)} pm (dashed)`, P.APS_2019.y.emit * 1e12, OLD, false);
      if (ring.y.emit === ring.x.emit) lab(`APS-U ${fmtPm(ring.x.emit * 1e12)} pm, both ways`, ring.x.emit * 1e12, this.accent, true, true);
      else {
        lab(`APS-U sideways ${fmtPm(ring.x.emit * 1e12)} pm`, ring.x.emit * 1e12, this.accent, true, true);
        lab(`APS-U up–down ${fmtPm(ring.y.emit * 1e12)} pm`, ring.y.emit * 1e12, this.accent, true, true);
      }
      txt(ctx, 'shaded: below λ/4π (diffraction-limited)', r3.x0 + 5, r3.y1 - 5, { color: TOKENS.ink3, size: 10 });
      this.title(r3, w < 480 ? 'Emittance vs the light’s limit λ/4π, pm·rad' : 'Electron-beam emittance vs the light’s own limit λ/4π (pm·rad)');
    }

    // ---------------------------------------------------------------- x axis (bottom subplot only)
    const rb = rects[rects.length - 1];
    ctx.save();
    ctx.font = `11px ${TOKENS.font}`;
    ctx.fillStyle = TOKENS.ink3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of [5, 10, 20, 50, 100]) ctx.fillText(String(t), px(t), rb.y1 + 4);
    ctx.fillStyle = TOKENS.ink2;
    ctx.textBaseline = 'bottom';
    ctx.fillText('X-ray photon energy (keV)  →  shorter waves', (x0 + x1) / 2, h - 2);
    ctx.restore();

    ctx.restore();
    const er3: [number, number] = [0.2, 9000];
    this.lay = {
      rects,
      px,
      py1,
      py2,
      py3: emit ? (v: number) => mapLog(v, er3, rects[2]) : null,
    };
  }

  private drawOverlay(): void {
    const L = this.lay;
    if (!L) return;
    const ctx = this.g;
    const s = this.st;
    const { rects, px, py1, py2, py3 } = L;
    const r1 = rects[0];
    const r2 = rects[1];
    const rb = rects[rects.length - 1];
    const fSel = s.mode === 'round' ? this.fRound : this.fFlat;
    const gSel = s.mode === 'round' ? this.gRound : this.gFlat;
    ctx.save();
    // ---------------------------------------------------------------- energy marker across all subplots
    const mx = px(s.E);
    ctx.save();
    ctx.strokeStyle = this.accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    for (const r of rects) {
      ctx.beginPath();
      ctx.moveTo(mx, r.y0);
      ctx.lineTo(mx, r.y1);
      ctx.stroke();
    }
    ctx.restore();
    // handle on the axis
    ctx.save();
    ctx.fillStyle = this.accent;
    ctx.beginPath();
    ctx.moveTo(mx, rb.y1 - 1);
    ctx.lineTo(mx - 5, rb.y1 + 7);
    ctx.lineTo(mx + 5, rb.y1 + 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const iE = this.idx(s.E);
    const fo = lerpArr(this.fOld, iE);
    const fn = lerpArr(fSel, iE);
    const side = s.E > 38 ? 'left' : 'right';
    this.dot(mx, py1(fo), OLD);
    this.dot(mx, py1(fn), this.accent);
    const lblO = fmtInN(fo);
    const lblN = fmtInN(fn);
    this.clampY = [r1.y0, r1.y1];
    this.pill(lblN, mx, py1(fn), this.accent, side, -1);
    this.pill(lblO, mx, py1(fo), OLD, side, 1);
    this.clampY = [r2.y0, r2.y1];
    const g = lerpArr(gSel, iE);
    this.dot(mx, py2(g), this.accent);
    this.pill(fmtGain(g), mx, py2(g), this.accent, side, -1, true);
    if (py3) {
      const r3 = rects[2];
      const dlE = P.diffractionLimit(s.E) * 1e12;
      // curve label, kept away from the moving marker
      const El = s.E > 28 ? 11 : 62;
      txt(ctx, 'λ/4π', px(El), py3(P.diffractionLimit(El) * 1e12) - 6, { color: TOKENS.ink, size: 11, weight: 700, halo: true });
      this.dot(mx, py3(dlE), TOKENS.ink);
      // below-left of the dot lies under the falling λ/4π curve, clear of the horizontal emittance lines
      this.clampY = [r3.y0, r3.y1];
      this.pill(`${dlE.toFixed(2)} pm`, mx, py3(dlE), TOKENS.ink, mx - 80 > r3.x0 ? 'left' : 'right', 1);
    }
    this.clampY = null;
    ctx.restore();
  }

  // ------------------------------------------------------------------ helpers

  private idx(E: number): number {
    return (Math.log(E / E_MIN) / Math.log(E_MAX / E_MIN)) * (NE - 1);
  }

  private frame(r: Rect, px: (E: number) => number, range: [number, number], yt: number[], yf: (v: number) => string, xLabels: boolean, minorY: number[] = []): void {
    const ctx = this.g;
    ctx.save();
    ctx.fillStyle = 'rgba(14,21,33,0.55)';
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.lineWidth = 1;
    // minor x grid
    ctx.strokeStyle = 'rgba(140,170,210,0.06)';
    for (const t of [6, 7, 8, 9, 30, 40, 60, 70, 80, 90]) {
      const x = Math.round(px(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, r.y0);
      ctx.lineTo(x, r.y1);
      ctx.stroke();
    }
    for (const v of minorY) {
      if (v < range[0] || v > range[1]) continue;
      const y = Math.round(mapLog(v, range, r)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(r.x0, y);
      ctx.lineTo(r.x1, y);
      ctx.stroke();
    }
    ctx.strokeStyle = TOKENS.grid;
    for (const t of [5, 10, 20, 50, 100]) {
      const x = Math.round(px(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, r.y0);
      ctx.lineTo(x, r.y1);
      ctx.stroke();
    }
    ctx.font = `10.5px ${TOKENS.font}`;
    ctx.fillStyle = TOKENS.ink3;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of yt) {
      const y = Math.round(mapLog(v, range, r)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(r.x0, y);
      ctx.lineTo(r.x1, y);
      ctx.stroke();
      ctx.fillText(yf(v), r.x0 - 5, y);
    }
    ctx.strokeStyle = TOKENS.axis;
    ctx.beginPath();
    ctx.moveTo(r.x0 + 0.5, r.y0);
    ctx.lineTo(r.x0 + 0.5, r.y1 + 0.5);
    ctx.lineTo(r.x1, r.y1 + 0.5);
    ctx.stroke();
    if (xLabels) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const t of [5, 10, 20, 50, 100]) ctx.fillText(String(t), px(t), r.y1 + 4);
    }
    ctx.restore();
  }

  private title(r: Rect, t: string): void {
    txt(this.g, t, r.x0, r.y0 - 8, { color: TOKENS.ink, size: 11.5, weight: 600 });
  }

  /** CHEX energy band (15–105 keV) with the fixed-branch energies as ticks. */
  private chexBand(r: Rect, px: (E: number) => number, labels: boolean, narrow: boolean): void {
    const ctx = this.g;
    const xa = px(P.CHEX_BAND.min);
    const xb = Math.min(r.x1, px(P.CHEX_BAND.max));
    ctx.save();
    ctx.fillStyle = this.accent;
    ctx.globalAlpha = 0.07;
    ctx.fillRect(xa, r.y0, xb - xa, r.y1 - r.y0);
    ctx.globalAlpha = 1;
    if (labels) {
      ctx.strokeStyle = this.accent;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.5;
      for (const st of P.CHEX_STOPS) {
        const x = Math.round(px(st.E)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, r.y0);
        ctx.lineTo(x, r.y0 + 6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.font = `600 10px ${TOKENS.font}`;
      ctx.fillStyle = this.accent;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      for (const st of P.CHEX_STOPS) {
        if (narrow && st.E === 35) continue;
        const x = px(st.E);
        const t = String(st.E);
        const tw = ctx.measureText(t).width;
        ctx.fillText(t, Math.min(r.x1 - tw / 2 - 1, x), r.y0 + 8);
      }
      ctx.textAlign = 'left';
      ctx.font = `700 10px ${TOKENS.font}`;
      ctx.fillText('CHEX', xa + 4, r.y0 + 20);
    }
    ctx.restore();
  }

  private curve(r: Rect, px: (E: number) => number, py: (v: number) => number, ys: Float64Array, color: string, width: number, dash: number[] = [], alpha = 1): void {
    const ctx = this.g;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash);
    ctx.beginPath();
    for (let i = 0; i < NE; i++) {
      const x = px(this.es[i]);
      const y = py(ys[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private dot(x: number, y: number, color: string): void {
    const ctx = this.g;
    ctx.save();
    ctx.fillStyle = TOKENS.bg;
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** value label in a dark pill next to a marker dot; dy −1 = above, +1 = below */
  private pill(t: string, x: number, y: number, color: string, side: 'left' | 'right', dy: number, big = false): void {
    const ctx = this.g;
    ctx.save();
    ctx.font = `${big ? 700 : 600} ${big ? 12.5 : 11}px ${TOKENS.mono}`;
    const tw = ctx.measureText(t).width;
    const ph = big ? 18 : 16;
    const bx = side === 'right' ? x + 8 : x - 8 - tw - 10;
    let by = y + (dy < 0 ? -ph - 3 : 3);
    if (this.clampY) by = Math.max(this.clampY[0] + 2, Math.min(this.clampY[1] - ph - 2, by));
    ctx.fillStyle = 'rgba(5,8,14,0.86)';
    roundRect(ctx, bx, by, tw + 10, ph, 5);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(t, bx + 5, by + ph / 2 + 0.5);
    ctx.restore();
  }
}

// ------------------------------------------------------------------ small helpers

function mapLog(v: number, range: [number, number], r: Rect): number {
  const t = (Math.log(v) - Math.log(range[0])) / (Math.log(range[1]) - Math.log(range[0]));
  return r.y1 - t * (r.y1 - r.y0);
}

function lerpArr(a: Float64Array, fi: number): number {
  const i = Math.max(0, Math.min(a.length - 1, Math.floor(fi)));
  const j = Math.min(a.length - 1, i + 1);
  const t = Math.max(0, Math.min(1, fi - i));
  // log-interpolate (curves are smooth power laws)
  return Math.exp(Math.log(a[i]) * (1 - t) + Math.log(a[j]) * t);
}

function fmtInNShort(f: number): string {
  const n = Math.round(1 / f);
  if (n >= 1e5) return `1 in ${n / 1000}k`;
  if (n >= 1e4) return `1 in ${n / 1000}k`;
  return `1 in ${n.toLocaleString('en-US')}`;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function txt(
  ctx: CanvasRenderingContext2D,
  t: string,
  x: number,
  y: number,
  o: { color?: string; size?: number; weight?: number; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; mono?: boolean; alpha?: number; halo?: boolean } = {},
): void {
  ctx.save();
  const size = o.size ?? 11;
  const fam = o.mono ? TOKENS.mono : TOKENS.font;
  const font = `${o.weight ?? 500} ${size}px ${fam}`;
  const subFont = `${o.weight ?? 500} ${Math.round(size * 0.74 * 10) / 10}px ${fam}`;
  ctx.font = font;
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  ctx.fillStyle = o.color ?? TOKENS.ink2;
  ctx.strokeStyle = 'rgba(5,8,14,0.9)';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  // subscripts: "Σ_x", "ε_{y}" → smaller, lowered glyphs
  const segs = splitSub(t);
  if (segs.length === 1) {
    ctx.textAlign = o.align ?? 'left';
    if (o.halo) ctx.strokeText(t, x, y);
    ctx.fillText(t, x, y);
    ctx.restore();
    return;
  }
  ctx.textAlign = 'left';
  let total = 0;
  for (const s of segs) {
    ctx.font = s.sub ? subFont : font;
    s.w = ctx.measureText(s.t).width;
    total += s.w;
  }
  let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' || o.align === 'end' ? x - total : x;
  for (const s of segs) {
    ctx.font = s.sub ? subFont : font;
    const yy = s.sub ? y + size * 0.28 : y;
    if (o.halo) ctx.strokeText(s.t, cx, yy);
    ctx.fillText(s.t, cx, yy);
    cx += s.w;
  }
  ctx.restore();
}

const subCache = new Map<string, { t: string; sub: boolean; w: number }[]>();
function splitSub(t: string): { t: string; sub: boolean; w: number }[] {
  let segs = subCache.get(t);
  if (segs) return segs;
  segs = [];
  const re = /_\{([^}]*)\}|_([^\s·,;:()=]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) segs.push({ t: t.slice(last, m.index), sub: false, w: 0 });
    segs.push({ t: m[1] ?? m[2], sub: true, w: 0 });
    last = m.index + m[0].length;
  }
  if (last < t.length) segs.push({ t: t.slice(last), sub: false, w: 0 });
  if (!segs.length) segs.push({ t, sub: false, w: 0 });
  if (subCache.size > 400) subCache.clear();
  subCache.set(t, segs);
  return segs;
}
