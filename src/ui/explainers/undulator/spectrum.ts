/**
 * Panel 3. On-axis spectrum, log–log, in the units of the X-ray Data Booklet: photons/s/mrad²/0.1 % BW.
 *   • spikes: odd harmonics E_n of the current setting; height = 1.744×10¹⁴N²E²I·F_n(K) × energy-spread ×
 *     beam-divergence × phase-error factors (physics.ts `peakFlux`). Their true width (ΔE/E ≈ 1/(nN) ≈ 1 %/n) is narrower than a pixel at this scale, and
 *     on a log axis a sinc² line falls to zero at ±1/(nN), so each line is drawn as a vertical stroke.
 *   • bands: where the 1st/3rd/5th harmonic peaks can go as the gap (or SCU current) is varied ("tuning curves").
 *   • dashed: the ring's bending magnet (APS-U B:M3 0.653 T / APS 0.599 T); dotted: an ILLUSTRATIVE wiggler
 *     (λ = 15 cm, 1.6 T, 16 periods. Not an APS device).
 *   • hover shows an energy; click/tap asks the station to tune there (main module decides harmonic + gap).
 */
import { TOKENS, plotFrame, type Canvas2D, type PlotFrame } from '../kit';
import * as P from './physics';
import { label, roundRect, withAlpha } from './scene';

const EMIN = 1;
const EMAX = 200;
const FMIN = 1e12;
const FMAX = 10 ** 20.5; // headroom above the tallest line (~6×10¹⁸) for the legend
const NCURVE = 160;
const TUNE_N = [1, 3, 5];
const TUNE_S = 90;
const NMAX = 61;

export interface SpectrumInput {
  dev: P.Device;
  ring: P.Ring;
  setting: number;
  tunedN: number | null;
}

export class SpectrumView {
  dirty = true;
  private inp: SpectrumInput | null = null;
  private K = 0;
  private bmE = new Float64Array(NCURVE);
  private bmF = new Float64Array(NCURVE);
  private wgF = new Float64Array(NCURVE);
  private tuneE: Float64Array[] = TUNE_N.map(() => new Float64Array(TUNE_S));
  private tuneF: Float64Array[] = TUNE_N.map(() => new Float64Array(TUNE_S));
  private specE = new Float64Array(NMAX);
  private specF = new Float64Array(NMAX);
  private hoverE: number | null = null;
  private frame: PlotFrame | null = null;
  private curveKey = '';
  private bg = document.createElement('canvas');
  private bgKey = '';

  constructor(
    private c: Canvas2D,
    private accent: string,
    private onTune: (EkeV: number) => void,
  ) {
    for (let i = 0; i < NCURVE; i++) this.bmE[i] = EMIN * Math.pow(EMAX / EMIN, i / (NCURVE - 1));
    c.onResize(() => (this.dirty = true));
    const cv = c.canvas;
    cv.style.cursor = 'crosshair';
    const toE = (e: PointerEvent | MouseEvent): number | null => {
      const f = this.frame;
      if (!f) return null;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (x < f.x0 - 4 || x > f.x1 + 4 || y < f.y1 - 6 || y > f.y0 + 26) return null;
      const u = Math.max(0, Math.min(1, (x - f.x0) / (f.x1 - f.x0)));
      return EMIN * Math.pow(EMAX / EMIN, u);
    };
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const E = toE(e);
      if (E !== this.hoverE) {
        this.hoverE = E;
        this.dirty = true;
      }
    });
    cv.addEventListener('pointerleave', () => {
      this.hoverE = null;
      this.dirty = true;
    });
    cv.addEventListener('click', (e) => {
      const E = toE(e);
      if (E !== null) this.onTune(E);
    });
  }

  set(inp: SpectrumInput): void {
    this.inp = inp;
    this.K = P.kAt(inp.dev, inp.setting);
    const key = `${inp.dev.id}|${inp.ring.id}`;
    if (key !== this.curveKey) {
      this.curveKey = key;
      const { E, I, bmB } = inp.ring;
      for (let i = 0; i < NCURVE; i++) {
        this.bmF[i] = P.bendingMagnet(this.bmE[i], E, I, bmB);
        this.wgF[i] = P.wiggler(this.bmE[i], E, I);
      }
      const [lo, hi] = P.settingRange(inp.dev);
      TUNE_N.forEach((n, j) => {
        for (let i = 0; i < TUNE_S; i++) {
          // sample densely near the strong-field end where K changes fastest with gap
          const u = i / (TUNE_S - 1);
          const s = inp.dev.kind === 'pm' ? lo + (hi - lo) * u * u : hi - (hi - lo) * u * u;
          const K = P.kAt(inp.dev, s);
          this.tuneE[j][i] = P.energyN(n, E, inp.dev.periodMm, K);
          this.tuneF[j][i] = P.peakFlux(n, K, inp.dev, inp.ring);
        }
      });
    }
    for (let k = 0; k < NMAX; k++) {
      const n = 2 * k + 1;
      const E = P.energyN(n, inp.ring.E, inp.dev.periodMm, this.K);
      this.specE[k] = E;
      // harmonics beyond the plotted range are never drawn: skip their (Bessel-function) flux
      this.specF[k] = E <= EMAX * 1.02 ? P.peakFlux(n, this.K, inp.dev, inp.ring) : 0;
    }
    this.dirty = true;
  }

  /**
   * Axes, tuning bands and reference curves change only with the device, ring and canvas size: they are
   * rendered once into an offscreen layer, so dragging the gap only redraws the harmonic lines and labels.
   */
  private renderStatic(narrow: boolean): PlotFrame {
    const { w, h, dpr } = this.c;
    const key = `${w}x${h}@${dpr}|${this.curveKey}`;
    if (key === this.bgKey && this.frame) return this.frame;
    this.bgKey = key;
    const bg = this.bg;
    bg.width = Math.round(w * dpr);
    bg.height = Math.round(h * dpr);
    const ctx = bg.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    const plotH = h - 24;
    const decadeStep = plotH < 230 ? 2 : 1;
    const yt: number[] = [];
    for (let e = 12; e <= 20; e += decadeStep) yt.push(10 ** e);
    const f = plotFrame(
      ctx,
      { x: 0, y: 24, w, h: plotH },
      { min: EMIN, max: EMAX, log: true, ticks: [1, 2, 5, 10, 20, 50, 100, 200], format: (v) => String(v), label: "X-ray photon energy (keV) → shorter wavelength" },
      { min: FMIN, max: FMAX, log: true, ticks: yt, format: (v) => `10${P.sup(Math.round(Math.log10(v)))}`, label: plotH >= 260 ? 'on-axis flux, ph/s/mrad²/0.1% BW' : 'ph/s/mrad²/0.1% BW' },
    );
    this.frame = f;
    const px = (E: number) => f.px(Math.max(EMIN * 0.5, E));
    const py = (F: number) => f.py(Math.max(FMIN * 0.1, F));
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x0, f.y1, f.x1 - f.x0, f.y0 - f.y1);
    ctx.clip();

    // tuning bands
    const bandW = narrow ? 6 : 8;
    TUNE_N.forEach((_, j) => {
      const xs = this.tuneE[j];
      const ys = this.tuneF[j];
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = withAlpha(this.accent, 0.16);
      ctx.lineWidth = bandW;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < TUNE_S; i++) {
        if (ys[i] < FMIN * 0.3) {
          started = false;
          continue;
        }
        if (!started) ctx.moveTo(px(xs[i]), py(ys[i]));
        else ctx.lineTo(px(xs[i]), py(ys[i]));
        started = true;
      }
      ctx.stroke();
      ctx.strokeStyle = withAlpha(this.accent, 0.42);
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // references
    const curve = (ys: Float64Array, color: string, dash: number[], width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < NCURVE; i++) {
        if (ys[i] < FMIN * 0.05) {
          started = false;
          continue;
        }
        const x = px(this.bmE[i]);
        const y = py(ys[i]);
        if (!started) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        started = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    curve(this.wgF, 'rgba(183,195,210,0.75)', [1.5, 3.5], 1.6);
    curve(this.bmF, TOKENS.old, [6, 4], 1.6);
    ctx.restore();
    return f;
  }

  draw(): void {
    const inp = this.inp;
    const { ctx, w, h } = this.c;
    if (!inp || w < 40) return;
    this.dirty = false;
    const narrow = w < 420;
    const f = this.renderStatic(narrow);
    ctx.save();
    ctx.drawImage(this.bg, 0, 0, w, h);
    const px = (E: number) => f.px(Math.max(EMIN * 0.5, E));
    const py = (F: number) => f.py(Math.max(FMIN * 0.1, F));
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x0, f.y1, f.x1 - f.x0, f.y0 - f.y1);
    ctx.clip();

    // harmonic spikes
    ctx.lineCap = 'butt';
    for (let k = NMAX - 1; k >= 0; k--) {
      const E = this.specE[k];
      const F = this.specF[k];
      if (E > EMAX * 1.02 || F < FMIN) continue;
      const n = 2 * k + 1;
      const major = n <= 5 || n === inp.tunedN;
      const x = px(E);
      ctx.beginPath();
      ctx.moveTo(x, f.y0);
      ctx.lineTo(x, py(F));
      if (major) {
        // soft glow: wide translucent strokes (cheaper than shadowBlur)
        ctx.strokeStyle = withAlpha(this.accent, 0.12);
        ctx.lineWidth = 9;
        ctx.stroke();
        ctx.strokeStyle = withAlpha(this.accent, 0.25);
        ctx.lineWidth = 4.5;
        ctx.stroke();
      }
      ctx.strokeStyle = major ? this.accent : withAlpha(this.accent, 0.62);
      ctx.lineWidth = major ? 2 : 1.1;
      ctx.stroke();
    }
    ctx.restore();

    // reference labels (left edge, where no undulator line can be)
    // each sits just above the highest point of its curve under the text, on a dark backdrop
    const refLabel = (ys: Float64Array, text: string, color: string) => {
      ctx.font = `600 10.5px ${TOKENS.font}`;
      const x0 = px(1.12);
      const tw = ctx.measureText(text).width;
      let top = Infinity;
      for (let i = 0; i < NCURVE; i++) {
        const x = px(this.bmE[i]);
        if (x < x0 - 2 || x > x0 + tw + 2) continue;
        top = Math.min(top, py(ys[i]));
      }
      if (!Number.isFinite(top)) return;
      const y = top - 5;
      ctx.fillStyle = 'rgba(5,8,14,0.72)';
      ctx.fillRect(x0 - 2, y - 10, tw + 4, 13);
      label(ctx, text, x0, y, color, 10.5, 'left', 600);
    };
    refLabel(this.bmF, `bending magnet · ${inp.ring.bmB.toFixed(2)} T`, TOKENS.old);
    refLabel(this.wgF, "example wiggler · K ≈ 22", TOKENS.ink2);

    // legend (top band of the plot, above every peak); peak labels stay below it
    const legendBottom = this.legend(ctx, f, narrow);

    // peak markers + labels
    const placed: [number, number, number][] = [];
    for (let k = 0; k < NMAX; k++) {
      const n = 2 * k + 1;
      if (!(n <= 5 || n === inp.tunedN)) continue;
      const E = this.specE[k];
      const F = this.specF[k];
      if (E > EMAX || F < FMIN) continue;
      const x = px(E);
      const y = py(F);
      ctx.fillStyle = this.accent;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, n === inp.tunedN ? 4.5 : 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (n === inp.tunedN) {
        ctx.strokeStyle = withAlpha(this.accent, 0.8);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      const txt = n === 1 ? `1st  ${P.fmtKeV(E)} keV` : P.ordinal(n);
      ctx.font = `600 10.5px ${TOKENS.font}`;
      const tw = ctx.measureText(txt).width;
      let tx = x - tw / 2;
      let ty = y - 9;
      tx = Math.max(f.x0 + 2, Math.min(f.x1 - tw - 2, tx));
      // avoid previous labels, then the legend: fall back to beside the marker
      for (const [ox, oy, ow] of placed) if (tx < ox + ow + 4 && ox < tx + tw + 4 && Math.abs(oy - ty) < 12) ty = oy - 13;
      if (ty - 10 < legendBottom + 2) {
        ty = y + 4;
        tx = x + 8 + tw < f.x1 ? x + 8 : x - 8 - tw;
      }
      placed.push([tx, ty, tw]);
      ctx.fillStyle = 'rgba(5,8,14,0.7)';
      ctx.fillRect(tx - 2, ty - 10, tw + 4, 13);
      label(ctx, txt, tx, ty, n === 1 || n === inp.tunedN ? '#fff' : TOKENS.ink2, 10.5, 'left', 600);
    }

    // hover guide
    if (this.hoverE !== null) {
      const x = px(this.hoverE);
      ctx.strokeStyle = 'rgba(233,238,245,0.55)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, f.y0);
      ctx.lineTo(x, f.y1 + 30);
      ctx.stroke();
      ctx.setLineDash([]);
      const txt = `${P.fmtKeV(this.hoverE)} keV · click to tune`;
      ctx.font = `600 10.5px ${TOKENS.font}`;
      const tw = ctx.measureText(txt).width + 12;
      const bx = Math.max(f.x0, Math.min(f.x1 - tw, x - tw / 2));
      const by = f.y0 - 22;
      ctx.fillStyle = 'rgba(11,17,27,0.92)';
      roundRect(ctx, bx, by, tw, 17, 8);
      ctx.fill();
      ctx.strokeStyle = withAlpha(this.accent, 0.6);
      ctx.stroke();
      label(ctx, txt, bx + 6, by + 12.5, TOKENS.ink, 10.5, 'left', 600);
    }
    ctx.restore();
  }

  /** draws the legend in the plot's top band; returns its bottom y */
  private legend(ctx: CanvasRenderingContext2D, f: PlotFrame, narrow: boolean): number {
    const items: { kind: 'line' | 'band' | 'dash' | 'dot'; text: string; color: string }[] = [
      { kind: 'line', text: "current undulator spectrum", color: this.accent },
      { kind: 'band', text: 'tuning range of harmonics 1, 3, 5', color: this.accent },
      { kind: 'dash', text: 'bending magnet', color: TOKENS.old },
      { kind: 'dot', text: 'wiggler', color: TOKENS.ink2 },
    ];
    ctx.font = `500 10.5px ${TOKENS.font}`;
    const sw = 18;
    let x = f.x0 + 8;
    let y = f.y1 + 9;
    const maxX = f.x1 - 6;
    const pads: { x: number; y: number; w: number }[] = [];
    for (const it of items) {
      const tw = ctx.measureText(it.text).width;
      const iw = sw + 5 + tw;
      if (x + iw > maxX && x > f.x0 + 8) {
        x = f.x0 + 8;
        y += 13;
      }
      pads.push({ x, y, w: iw });
      x += iw + (narrow ? 10 : 14);
    }
    // backdrop so spikes/curves never collide with the text
    const yTop = f.y1 + 2;
    const yBot = pads[pads.length - 1].y + 6;
    ctx.fillStyle = 'rgba(5,8,14,0.72)';
    ctx.fillRect(f.x0 + 1, yTop, f.x1 - f.x0 - 1, yBot - yTop);
    items.forEach((it, i) => {
      const p = pads[i];
      const cy = p.y - 3.5;
      ctx.strokeStyle = it.color;
      ctx.setLineDash(it.kind === 'dash' ? [5, 3] : it.kind === 'dot' ? [1.5, 3] : []);
      ctx.lineWidth = it.kind === 'band' ? 6 : 1.8;
      if (it.kind === 'band') ctx.strokeStyle = withAlpha(it.color, 0.3);
      ctx.beginPath();
      ctx.moveTo(p.x, cy);
      ctx.lineTo(p.x + sw, cy);
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, it.text, p.x + sw + 5, p.y, TOKENS.ink2, 10.5, 'left', 500);
    });
    return yBot;
  }
}
