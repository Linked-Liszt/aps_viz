/**
 * Panel 2. What an observer straight ahead receives.
 *   • top: the on-axis far-field E_x(t) of one electron (Liénard–Wiechert, see physics.ts `waveform`), normalised,
 *     scrolling like an oscilloscope. Small K → a pure sine; large K → the cone sweeps past the observer twice per
 *     period and the wave turns into sharp alternating spikes → strong odd harmonics. Even harmonics stay zero on
 *     axis because the two spikes per period have opposite sign.
 *   • bottom left: harmonic content |c_n|² = F_n(K)/4 as bars (exact identity, verified in tests/undulator.test.ts),
 *     normalised to the strongest.
 *   • bottom right: zoom on one harmonic line (the 1st, or the one the station tuned to). The wave train is N periods
 *     long, so its spectrum is sinc²(πnN(E/E_n − 1)): FWHM ΔE/E = 0.886/(nN), zeros at ±1/(nN). Dashed: the
 *     same line convolved with the energy-spread Gaussian (rms 2σ_E in E/E_n, since E_n ∝ γ²). Numerically, so
 *     its FWHM and peak are exact for a Gaussian spread; the spectrum heights and captions use the same cached numbers
 *     (physics.ts `spreadFactor`, `spreadFwhm`). Beam divergence is not included in this line shape.
 */
import { TOKENS, type Canvas2D } from '../kit';
import * as P from './physics';
import { label, withAlpha } from './scene';

const M = 512;
const NB = 9;
/** samples across the zoomed line (same grid as physics.ts `spreadFwhm`) */
const NZ = P.LINE_SAMPLES;

export interface LineInput {
  /** harmonic number shown in the zoom */
  n: number;
  /** its on-axis energy (keV) */
  En: number;
  /** number of periods */
  N: number;
  /** relative rms electron energy spread */
  sigmaE: number;
}

export class WaveView {
  private K = 1;
  private lam1 = 1; // Å
  private buf = new Float32Array(M);
  private peak = 1;
  private bars = new Float64Array(NB + 1);
  private phase = 0;
  /** bumped by set(); with the canvas size it decides when a still picture needs redrawing */
  private ver = 0;
  private stillKey = '';
  // zoomed line
  private line: LineInput = { n: 1, En: 1, N: 1, sigmaE: 0 };
  private zSpan = 0.03; // relative half-span shown
  private zNat = new Float64Array(NZ);
  private zSpr = new Float64Array(NZ);
  private zFwNat = 0; // relative FWHM
  private zFwSpr = 0;
  private zPkSpr = 1;

  constructor(
    private c: Canvas2D,
    private accent: string,
    /** right edge (canvas px) of the DOM panel title, to keep canvas text clear of it */
    private titleRight: () => number = () => 0,
  ) {
  }

  set(K: number, lam1A: number, line: LineInput): void {
    this.ver++;
    this.K = K;
    this.lam1 = lam1A;
    this.peak = P.waveform(K, this.buf) || 1;
    let mx = 0;
    for (let n = 1; n <= NB; n++) {
      this.bars[n] = P.Fn(n, K);
      mx = Math.max(mx, this.bars[n]);
    }
    for (let n = 1; n <= NB; n++) this.bars[n] /= mx || 1;
    const prev = this.line;
    this.line = line;
    // the line shape (relative units) depends only on n, N and σ_E. Not on K
    if (prev.n !== line.n || prev.N !== line.N || prev.sigmaE !== line.sigmaE || this.zFwNat === 0) this.computeLine();
  }

  /** sinc² line and its energy-spread convolution on a relative-detuning grid δ = E/E_n − 1 */
  private computeLine(): void {
    const { n, N, sigmaE } = this.line;
    const span = P.lineSpan(n, N, sigmaE);
    this.zSpan = span;
    for (let i = 0; i < NZ; i++) {
      const d = -span + (2 * span * i) / (NZ - 1);
      this.zNat[i] = P.lineShape(1 + d, 1, n, N);
      this.zSpr[i] = P.spreadLine(d, n, N, sigmaE);
    }
    this.zFwNat = P.naturalWidth(n, N);
    this.zPkSpr = P.spreadFactor(n, N, sigmaE);
    this.zFwSpr = P.spreadFwhm(n, N, sigmaE);
  }

  frame(dt: number): void {
    this.phase = (this.phase + dt * 0.45) % 1;
    this.draw();
  }

  /** Reduced motion: the wave holds still; redrawn only when the input or the canvas size changes. */
  still(): void {
    const key = `${this.ver}|${this.c.w}|${this.c.h}|${this.c.dpr}`;
    if (key === this.stillKey) return;
    this.stillKey = key;
    this.draw();
  }

  private draw(): void {
    const { ctx, w, h } = this.c;
    if (w < 20) return;
    ctx.save();
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    const top = 28;
    const stacked = h >= 200;
    const showBars = stacked || w >= 330;
    let wx0 = 12;
    let wx1 = w - 12;
    const wy0 = top;
    let wy1 = h - 24;
    let bx0 = 0;
    let bx1 = 0;
    let by0 = 0;
    let by1 = 0;
    let zx0 = 0;
    let zx1 = 0;
    if (stacked) {
      const split = top + (h - top) * 0.5;
      wy1 = split - 22;
      by0 = split + 18;
      by1 = h - 20;
      // bottom row: harmonic bars | line zoom
      const mid = Math.round(w * 0.5);
      bx0 = 22;
      bx1 = mid - 14;
      zx0 = mid + 12;
      zx1 = w - 12;
    } else if (showBars) {
      const bw = Math.max(120, Math.min(200, w * 0.36));
      wx1 = w - bw - 18;
      bx0 = wx1 + 26;
      bx1 = w - 12;
      by0 = top + 16;
      by1 = h - 20;
    }

    // ---- waveform
    const mid = (wy0 + wy1) / 2;
    const amp = Math.max(8, (wy1 - wy0) / 2 - 4);
    const cycles = 3;
    const cyc = (wx1 - wx0) / cycles;
    ctx.strokeStyle = 'rgba(170,190,215,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wx0, mid);
    ctx.lineTo(wx1, mid);
    ctx.stroke();
    const sample = (px: number) => {
      const f = (px - wx0) / cyc + this.phase;
      const i = Math.floor((((f % 1) + 1) % 1) * M) % M;
      return this.buf[i] / this.peak;
    };
    ctx.beginPath();
    ctx.moveTo(wx0, mid);
    for (let px = wx0; px <= wx1; px += 1) ctx.lineTo(px, mid - amp * sample(px));
    ctx.lineTo(wx1, mid);
    ctx.closePath();
    ctx.fillStyle = withAlpha(this.accent, 0.13);
    ctx.fill();
    ctx.beginPath();
    for (let px = wx0; px <= wx1; px += 1) {
      const y = mid - amp * sample(px);
      if (px === wx0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();
    // one-cycle bracket
    const T = (this.lam1 * 1e-10) / 2.99792458e8; // s
    const as = T * 1e18;
    const yb = wy1 + 12;
    ctx.strokeStyle = TOKENS.ink3;
    ctx.beginPath();
    ctx.moveTo(wx0, yb - 3);
    ctx.lineTo(wx0, yb + 3);
    ctx.moveTo(wx0, yb);
    ctx.lineTo(wx0 + cyc, yb);
    ctx.moveTo(wx0 + cyc, yb - 3);
    ctx.lineTo(wx0 + cyc, yb + 3);
    ctx.stroke();
    const asTxt = as < 1 ? as.toFixed(2) : as.toFixed(1);
    const N = this.line.N;
    const trainAs = N * as;
    const trTxt = trainAs < 10 ? trainAs.toFixed(1) : trainAs.toFixed(0);
    ctx.font = `500 10.5px ${TOKENS.font}`;
    const room = wx1 - (wx0 + cyc + 6);
    const opts = [
      `One wavelength passes in ${asTxt} attoseconds; all ${N} pass in ${trTxt} attoseconds`,
      `One wavelength: ${asTxt} attoseconds · all ${N}: ${trTxt}`,
      `One wavelength passes in ${asTxt} attoseconds`,
      `One wavelength: ${asTxt} attoseconds`,
    ];
    const tTxt = opts.find((t) => ctx.measureText(t).width <= room) ?? opts[opts.length - 1];
    label(ctx, tTxt, wx0 + cyc + 6, yb + 4, TOKENS.ink3, 10.5, 'left', 500);
    // shape descriptor, top-right of the canvas, unless the DOM panel title already reaches there
    const kTxt = `K = ${this.K.toFixed(2)}: ${this.K < 0.8 ? 'near-sinusoidal field' : this.K < 1.6 ? 'narrower peaks' : 'narrow field peaks'}`;
    ctx.font = `600 10.5px ${TOKENS.font}`;
    const kx = showBars && !stacked ? w - 12 : wx1;
    if (kx - ctx.measureText(kTxt).width > this.titleRight() + 10) label(ctx, kTxt, kx, 16, this.K < 0.8 ? TOKENS.ink2 : this.accent, 10.5, 'right', 600);

    // ---- harmonic bars
    if (showBars) {
      const n = NB;
      const slot = (bx1 - bx0) / n;
      const bw = Math.max(3, Math.min(14, slot * 0.55));
      ctx.strokeStyle = 'rgba(170,190,215,0.25)';
      ctx.beginPath();
      ctx.moveTo(bx0 - 4, by1);
      ctx.lineTo(bx1, by1);
      ctx.stroke();
      for (let k = 1; k <= n; k++) {
        const cx = bx0 + (k - 0.5) * slot;
        const v = this.bars[k];
        if (k % 2 === 1) {
          const hh = Math.max(v > 1e-4 ? 1.5 : 0, v * (by1 - by0));
          ctx.fillStyle = k === 1 ? this.accent : withAlpha(this.accent, 0.72);
          ctx.fillRect(cx - bw / 2, by1 - hh, bw, hh);
        } else {
          ctx.fillStyle = 'rgba(170,190,215,0.35)';
          ctx.fillRect(cx - bw / 2, by1 - 1.5, bw, 1.5);
        }
        label(ctx, String(k), cx, by1 + 12, k % 2 ? TOKENS.ink2 : 'rgba(131,148,169,0.6)', 10, 'center', 600);
      }
      const title = 'harmonics in this wave';
      label(ctx, title, bx0 - 4, by0 - 6, TOKENS.ink3, 10, 'left', 600);
      const tw = ctx.measureText(title).width;
      const evenTxt = 'even: none on axis';
      ctx.font = `500 9.5px ${TOKENS.font}`;
      if (bx0 - 4 + tw + 10 + ctx.measureText(evenTxt).width <= bx1) label(ctx, evenTxt, bx1, by0 - 6, 'rgba(131,148,169,0.75)', 9.5, 'right', 500);
    }

    // ---- zoom on one harmonic line
    if (stacked && zx1 - zx0 > 90) this.drawLine(ctx, zx0, zx1, by0, by1);
    ctx.restore();
  }

  private drawLine(ctx: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number): void {
    const { n, En } = this.line;
    const span = this.zSpan;
    const px = (d: number) => x0 + ((d + span) / (2 * span)) * (x1 - x0);
    const hgt = y1 - y0 - 2;
    const py = (v: number) => y1 - v * hgt;
    const eV = (rel: number) => rel * En * 1000;
    // title
    const title = `zoom on the ${P.ordinal(n)} harmonic`;
    label(ctx, title, x0 - 2, y0 - 6, TOKENS.ink3, 10, 'left', 600);
    // baseline + centre tick
    ctx.strokeStyle = 'rgba(170,190,215,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y1);
    ctx.lineTo(x1, y1);
    ctx.moveTo(px(0), y1);
    ctx.lineTo(px(0), y1 + 3);
    ctx.stroke();
    // natural (N-period) line
    ctx.beginPath();
    ctx.moveTo(px(-span), y1);
    for (let i = 0; i < NZ; i++) ctx.lineTo(px(-span + (2 * span * i) / (NZ - 1)), py(this.zNat[i]));
    ctx.lineTo(px(span), y1);
    ctx.closePath();
    ctx.fillStyle = withAlpha(this.accent, 0.16);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < NZ; i++) {
      const x = px(-span + (2 * span * i) / (NZ - 1));
      const y = py(this.zNat[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // with the electrons' energy spread (dashed)
    {
      ctx.beginPath();
      for (let i = 0; i < NZ; i++) {
        const x = px(-span + (2 * span * i) / (NZ - 1));
        const y = py(this.zSpr[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(233,238,245,0.8)';
      ctx.setLineDash([3, 2.5]);
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // FWHM bracket of the natural line
    const hw = this.zFwNat / 2;
    const yh = py(0.5);
    const xa = px(-hw);
    const xb = px(hw);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(xa, yh - 3);
    ctx.lineTo(xa, yh + 3);
    ctx.moveTo(xa, yh);
    ctx.lineTo(xb, yh);
    ctx.moveTo(xb, yh - 3);
    ctx.lineTo(xb, yh + 3);
    ctx.stroke();
    // labels: natural width beside the bracket (clear of the dashed flank); energy spread in the top-left corner,
    // which only the low side-lobes reach. Anything that does not fit is dropped (the read-outs carry the numbers).
    const cx = px(0);
    // the dashed (σ_E) curve only crosses half height when its peak is above 0.5
    const flank = Math.max(xb, this.zPkSpr > 0.5 ? px(this.zFwSpr / 2) : xb);
    const fwTxt = `${fmtEv(eV(this.zFwNat))} eV`;
    const natTxt = `${fwTxt} wide`;
    const tag = (t: string, x: number, y: number, color: string, size: number, weight: number) => {
      ctx.font = `${weight} ${size}px ${TOKENS.font}`;
      const tw = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(5,8,14,0.78)';
      ctx.fillRect(x - 2, y - size + 1, tw + 4, size + 2);
      label(ctx, t, x, y, color, size, 'left', weight);
    };
    ctx.font = `600 10px ${TOKENS.font}`;
    let nw = ctx.measureText(natTxt).width;
    let nt = natTxt;
    if (flank + 6 + nw > x1) {
      nt = fwTxt;
      nw = ctx.measureText(nt).width;
    }
    if (flank + 6 + nw <= x1) tag(nt, flank + 6, yh + 3.5, '#fff', 10, 600);
    {
      // "┄ with energy spread: 59 eV" (dashed swatch; FWHM of the broadened line) and "peak ×0.86" below it, in
      // the top-left corner; shorter wordings when space is short.
      // the two label rows reach down to v = vMin: keep clear of wherever either curve rises above that
      const vMin = (y1 - (y0 + 24)) / hgt;
      let occ = 0;
      for (let i = 0; i < NZ; i++) {
        if (this.zNat[i] >= vMin || this.zSpr[i] >= vMin) occ = Math.max(occ, Math.abs(-span + (2 * span * i) / (NZ - 1)));
      }
      const room = cx - (px(occ) - cx) - 8 - x0;
      const fs = 9.5;
      const sw = 12;
      const ev = `${fmtEv(eV(this.zFwSpr))} eV`;
      ctx.font = `500 ${fs}px ${TOKENS.font}`;
      const txt = [`with energy spread: ${ev}`, `energy spread: ${ev}`, `with spread: ${ev}`, `spread: ${ev}`].find((t) => sw + 4 + ctx.measureText(t).width <= room);
      if (txt) {
        const total = sw + 4 + ctx.measureText(txt).width;
        const y = y0 + 8;
        ctx.fillStyle = 'rgba(5,8,14,0.78)';
        ctx.fillRect(x0 - 2, y - fs + 1, total + 4, fs + 4);
        ctx.strokeStyle = 'rgba(233,238,245,0.8)';
        ctx.setLineDash([3, 2.5]);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x0, y - 3);
        ctx.lineTo(x0 + sw, y - 3);
        ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, txt, x0 + sw + 4, y, TOKENS.ink, fs, 'left', 500);
        const l2 = `peak ×${this.zPkSpr.toFixed(2)}`;
        ctx.font = `500 ${fs}px ${TOKENS.font}`;
        if (ctx.measureText(l2).width + sw + 4 <= room) tag(l2, x0 + sw + 4, y0 + 21, TOKENS.ink2, fs, 500);
      }
    }
    // axis labels: ±half-span in eV and the line centre
    const X = fmtEv(eV(span));
    label(ctx, `−${X}`, x0, y1 + 12, TOKENS.ink3, 9.5, 'left', 500);
    label(ctx, `+${X} eV`, x1, y1 + 12, TOKENS.ink3, 9.5, 'right', 500);
    label(ctx, `${P.fmtKeV(En)} keV`, px(0), y1 + 12, TOKENS.ink2, 10, 'center', 600);
  }
}

function fmtEv(e: number): string {
  if (e >= 100) return String(Math.round(e));
  if (e >= 10) return e.toFixed(0);
  return e.toFixed(1);
}
