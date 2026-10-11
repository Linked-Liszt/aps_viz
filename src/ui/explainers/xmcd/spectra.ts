/**
 * View 2. Absorption spectra: schematic Pt L₃ and L₂ absorption for left- and right-circular X-rays
 * (top) and their difference, the XMCD (bottom), on a broken energy axis (the two edges are 1.7 keV apart).
 * The lines are μ_L / μ_R at P_c = 0.98. Dots represent absorption for the polarization selected in view 1:
 * μ_L for LCP, μ_R for RCP, their average for linear light and an intermediate value for elliptical light.
 * The y-range of the XMCD plot is fixed (full saturation), so the signal visibly shrinks with M.
 */
import { TOKENS, type Canvas2D } from '../kit';
import * as P from './physics';
import { COL, linMap, rgba, rich, richW, signed, textW, txt, type Map1 } from './draw';

export interface SpectraView {
  sp: P.Spectra;
  /** fixed |Δμ| range */
  yMax: number;
  beamPc: number;
  beamColor: string;
  /** sum-rule read-back on the displayed curves (moments projected on the beam) */
  rb: { mOrb: number; mSpinEff: number; p: number; q: number };
  /** true if μ ≈ 0 (no magnetic order): used for a "flat line" hint */
  quiet: boolean;
}

export class SpectraPlot {
  private c: Canvas2D;
  private accent: string;

  constructor(c: Canvas2D, accent: string) {
    this.c = c;
    this.accent = accent;
  }

  draw(v: SpectraView): void {
    const { ctx, w, h } = this.c;
    ctx.save();
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    const narrow = w < 470;

    // ---------------- legend row (wraps onto a second row on narrow canvases)
    let ly = 34;
    let lx = 10;
    const leg = (color: string, label: string, kind: 'line' | 'fill' | 'glow') => {
      if (lx > 10 && lx + 21 + richW(ctx, label, { size: 11 }) > w - 4) {
        lx = 10;
        ly += 16;
      }
      ctx.save();
      if (kind === 'line') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(lx, ly - 4);
        ctx.lineTo(lx + 16, ly - 4);
        ctx.stroke();
      } else if (kind === 'fill') {
        ctx.fillStyle = rgba(this.accent, 0.45);
        ctx.fillRect(lx, ly - 9, 16, 10);
        ctx.fillStyle = this.accent;
        ctx.fillRect(lx, ly - 9, 16, 2);
      } else {
        ctx.fillStyle = color;
        ctx.strokeStyle = TOKENS.bg;
        ctx.lineWidth = 1.2;
        for (const dx of [3, 8, 13]) {
          ctx.beginPath();
          ctx.arc(lx + dx, ly - 4, 2.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
      lx += 21;
      lx += rich(ctx, label, lx, ly, { size: 11, color: TOKENS.ink2 }) + (narrow ? 10 : 14);
    };
    leg(COL.left, "↺ left circular μ_L", 'line');
    leg(COL.right, "↻ right circular μ_R", 'line');
    leg(this.accent, 'difference Δμ = μ_L − μ_R', 'fill');
    leg(v.beamColor, "selected polarization", 'glow');

    // ---------------- frames
    const padL = 44;
    const padR = 10;
    const gap = 18;
    const top = 48 + (ly - 34);
    const bottom = h - 34;
    const avail = bottom - top;
    const hTop = Math.round(avail * 0.58);
    const hBot = avail - hTop - 12;
    const yTop0 = top;
    const yTop1 = top + hTop;
    const yBot0 = yTop1 + 12;
    const yBot1 = yBot0 + hBot;
    const ww = (w - padL - padR - gap) / 2;
    const wins: { e: P.EdgeSpectra; x0: number; name: string; E: number }[] = [
      { e: v.sp.L3, x0: padL, name: 'Pt L₃', E: P.PT_EDGES.L3 },
      { e: v.sp.L2, x0: padL + ww + gap, name: 'Pt L₂', E: P.PT_EDGES.L2 },
    ];
    const muMin = -0.06;
    const muMax = 1.46;
    const yMu = linMap(muMin, muMax, yTop1, yTop0);
    const yD = linMap(-v.yMax, v.yMax, yBot1, yBot0);
    const xs = v.sp.x;

    // y ticks (left only)
    ctx.font = `11px ${TOKENS.font}`;
    for (const t of [0, 0.5, 1]) {
      txt(ctx, t.toFixed(1), padL - 6, yMu(t) + 4, { size: 10.5, color: TOKENS.ink3, align: 'right' });
    }
    const dStep = niceStep(v.yMax * 100);
    for (let t = -Math.floor((v.yMax * 100) / dStep) * dStep; t <= v.yMax * 100 + 1e-9; t += dStep) {
      txt(ctx, `${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t).toFixed(dStep < 1 ? 1 : 0)}`, padL - 6, yD(t / 100) + 4, { size: 10.5, color: TOKENS.ink3, align: 'right' });
    }
    // y labels (rotated)
    const yl = (s: string, yc: number) => {
      ctx.save();
      ctx.translate(11, yc);
      ctx.rotate(-Math.PI / 2);
      txt(ctx, s, 0, 0, { size: 11, color: TOKENS.ink2, align: 'center', baseline: 'middle' });
      ctx.restore();
    };
    // longer wording where the plot is tall enough
    const fit = (a: string, b: string, len: number) => (textW(ctx, a, { size: 11 }) <= len - 8 ? a : b);
    yl(fit("absorption μ · normalized", 'absorption μ', yTop1 - yTop0), (yTop0 + yTop1) / 2);
    yl(fit('Δμ (% of L₃ edge step)', 'Δμ (% of step)', yBot1 - yBot0), (yBot0 + yBot1) / 2);

    for (const win of wins) {
      const xm = linMap(P.WINDOW.lo, P.WINDOW.hi, win.x0, win.x0 + ww);
      this.grid(win.x0, ww, yTop0, yTop1, yBot0, yBot1, xm, yMu, yD);
      // ---- top: fill between μ_L and μ_R (the gap), faint μ_L / μ_R, glow for the selected beam
      ctx.save();
      ctx.beginPath();
      ctx.rect(win.x0, yTop0, ww, yTop1 - yTop0);
      ctx.clip();
      ctx.fillStyle = rgba(this.accent, 0.4);
      ctx.beginPath();
      for (let i = 0; i < xs.length; i++) (i ? ctx.lineTo(xm(xs[i]), yMu(win.e.muL[i])) : ctx.moveTo(xm(xs[i]), yMu(win.e.muL[i])));
      for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(xm(xs[i]), yMu(win.e.muR[i]));
      ctx.closePath();
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.7;
      ctx.strokeStyle = COL.right;
      path(ctx, xs, win.e.muR, xm, yMu);
      ctx.stroke();
      ctx.strokeStyle = COL.left;
      path(ctx, xs, win.e.muL, xm, yMu);
      ctx.stroke();
      // Absorption for the selected polarization, sampled every DOT_STEP steps.
      ctx.fillStyle = v.beamColor;
      ctx.strokeStyle = TOKENS.bg;
      ctx.lineWidth = 1.2;
      const r = ww < 200 ? 2 : 2.4;
      for (let i = DOT_STEP >> 1; i < xs.length; i += DOT_STEP) {
        ctx.beginPath();
        ctx.arc(xm(xs[i]), yMu(win.e.beam[i]), r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      // ---- bottom: XMCD
      ctx.save();
      ctx.beginPath();
      ctx.rect(win.x0, yBot0, ww, yBot1 - yBot0);
      ctx.clip();
      const y0 = yD(0);
      ctx.fillStyle = rgba(this.accent, 0.42);
      ctx.beginPath();
      ctx.moveTo(xm(xs[0]), y0);
      for (let i = 0; i < xs.length; i++) ctx.lineTo(xm(xs[i]), yD(win.e.diff[i]));
      ctx.lineTo(xm(xs[xs.length - 1]), y0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      path(ctx, xs, win.e.diff, xm, yD);
      ctx.stroke();
      ctx.restore();

      // edge name + energy, top-right (clear of the white lines)
      // (the energy moves under the name when the window is narrow, keeping both clear of the white line)
      const nw = textW(ctx, win.name, { size: 12, weight: 700 });
      const eTxt = `${win.E.toFixed(3)} keV`;
      const ew = textW(ctx, eTxt, { size: 10.5, mono: true });
      if (ww >= 200) {
        const lx0 = win.x0 + ww - 6 - nw - 6 - ew;
        txt(ctx, win.name, lx0, yTop0 + 14, { size: 12, weight: 700, color: TOKENS.ink });
        txt(ctx, eTxt, lx0 + nw + 6, yTop0 + 14, { size: 10.5, color: TOKENS.ink3, mono: true });
      } else {
        txt(ctx, win.name, win.x0 + ww - 6, yTop0 + 14, { size: 12, weight: 700, color: TOKENS.ink, align: 'right' });
        if (ww >= 150) txt(ctx, eTxt, win.x0 + ww - 6, yTop0 + 27, { size: 10, color: TOKENS.ink3, mono: true, align: 'right' });
      }

      // x ticks
      for (const t of [-20, 0, 20, 40]) {
        const x = xm(t);
        txt(ctx, t === 0 ? '0' : `${t > 0 ? '+' : '−'}${Math.abs(t)}`, x, yBot1 + 14, { size: 10.5, color: TOKENS.ink3, align: 'center' });
      }
    }

    // axis break marks
    const bx = padL + ww + gap / 2;
    ctx.strokeStyle = TOKENS.axis;
    ctx.lineWidth = 1.2;
    for (const yy of [yTop1, yBot1]) {
      ctx.beginPath();
      ctx.moveTo(bx - 6, yy + 4);
      ctx.lineTo(bx - 2, yy - 4);
      ctx.moveTo(bx + 2, yy + 4);
      ctx.lineTo(bx + 6, yy - 4);
      ctx.stroke();
    }
    rich(ctx, narrow ? 'energy above each edge (eV)' : "X-ray energy above edge, E − E_{edge} (eV) · schematic shapes", padL + (w - padL - padR) / 2, h - 5, {
      size: 11,
      color: TOKENS.ink2,
      align: 'center',
    });

    // ---- annotations
    const L3 = wins[0];
    const L2 = wins[1];
    const xm3 = linMap(P.WINDOW.lo, P.WINDOW.hi, L3.x0, L3.x0 + ww);
    const xm2 = linMap(P.WINDOW.lo, P.WINDOW.hi, L2.x0, L2.x0 + ww);
    const pk3 = peak(L3.e.diff);
    const pk2 = peak(L2.e.diff);
    const big = Math.abs(pk3.v) > v.yMax * 0.12;
    /** annotation height: beside the peak, but never on the zero line (small signals) */
    const tagY = (d: number) => {
      const y0 = yD(0);
      const y = yD(d);
      return d >= 0 ? Math.min(y, y0 - 11) : Math.max(y, y0 + 11);
    };
    // integrated areas of the displayed difference, in eV (μ_L − μ_R, i.e. −P_c·(μ⁺−μ⁻) for M ∥ k)
    const a3 = -v.rb.p * P.POLAR.pc;
    const a2 = -(v.rb.q - v.rb.p) * P.POLAR.pc;
    if (big) {
      const roomy = ww >= 230;
      const t3 = pk3.v > 0 ? "greater left-circular absorption" : "greater right-circular absorption";
      this.tag(xm3(pk3.x), tagY(pk3.v * 0.6), yD(0), roomy ? `${t3}, area ${signed(a3, 2)} eV` : t3, L3.x0, L3.x0 + ww);
      this.tag(xm2(pk2.x), tagY(pk2.v * 0.6), yD(0), roomy ? `opposite sign at L₂, area ${signed(a2, 2)} eV` : "opposite sign at L₂", L2.x0, L2.x0 + ww);
    }
    // sum-rule read-back in the empty upper right of the L₂ window
    {
      const bxl = L2.x0 + ww - 6;
      let by = yTop0 + (ww >= 200 ? 32 : 44); // below the edge label (two lines when narrow)
      const lines = [
        ['sum rules on these curves', TOKENS.ink3, 600],
        [`orbital m_{orb} ${signed(v.rb.mOrb, 3)} μ_B`, TOKENS.ink, 600],
        [`spin m_{spin,eff} ${signed(v.rb.mSpinEff, 3)} μ_B`, TOKENS.ink, 600],
        [Math.abs(v.rb.mSpinEff) > 0.01 ? `ratio ${(v.rb.mOrb / v.rb.mSpinEff).toFixed(3)}` : "ratio undefined", TOKENS.ink3, 500],
      ] as [string, string, number][];
      for (const [s, c, wgt] of lines) {
        rich(ctx, s, bxl, by, { size: 10.5, color: c, align: 'right', weight: wgt });
        by += 14;
      }
    }
    if (v.quiet) {
      // This describes both edges; centring across them also keeps the sentence inside narrow canvases.
      txt(ctx, 'no magnetism along the beam → Δμ ≈ 0', (L3.x0 + L2.x0 + ww) / 2, yBot0 + 14, {
        size: 11,
        color: TOKENS.ink3,
        align: 'center',
        weight: 600,
      });
    }
    ctx.restore();
  }

  /**
   * Annotation for a peak at px (height y beside it): to its right if it fits inside [xMin, xMax], else to its left,
   * else (narrow windows) centred under / over the peak on the empty side of the zero line y0.
   */
  private tag(px: number, y: number, y0: number, s: string, xMin: number, xMax: number): void {
    const { ctx } = this.c;
    const o = { size: 10.5, color: TOKENS.ink, weight: 600 };
    const tw = textW(ctx, s, o);
    const right = px + 12;
    const left = px - 12 - tw;
    let xx: number;
    if (right + tw <= xMax - 4) xx = right;
    else if (left >= xMin + 4) xx = left;
    else {
      xx = Math.max(xMin + 2, Math.min(xMax - 2 - tw, px - tw / 2));
      y = y < y0 ? y0 + 12 : y0 - 12;
    }
    ctx.save();
    ctx.shadowColor = TOKENS.bg;
    ctx.shadowBlur = 4;
    txt(ctx, s, xx, y + 4, o);
    ctx.restore();
  }

  private grid(x0: number, ww: number, yT0: number, yT1: number, yB0: number, yB1: number, xm: Map1, yMu: Map1, yD: Map1): void {
    const { ctx } = this.c;
    ctx.strokeStyle = TOKENS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of [-20, 0, 20, 40]) {
      const x = Math.round(xm(t)) + 0.5;
      ctx.moveTo(x, yT0);
      ctx.lineTo(x, yT1);
      ctx.moveTo(x, yB0);
      ctx.lineTo(x, yB1);
    }
    for (const t of [0.5, 1]) {
      const y = Math.round(yMu(t)) + 0.5;
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + ww, y);
    }
    ctx.stroke();
    ctx.strokeStyle = TOKENS.axis;
    ctx.beginPath();
    ctx.moveTo(x0, yT0);
    ctx.lineTo(x0, yT1);
    ctx.lineTo(x0 + ww, yT1);
    ctx.moveTo(x0, yB0);
    ctx.lineTo(x0, yB1);
    ctx.lineTo(x0 + ww, yB1);
    ctx.stroke();
    // zero line of the difference
    ctx.strokeStyle = 'rgba(170,190,215,0.45)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const y = Math.round(yD(0)) + 0.5;
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + ww, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** spacing of the "measured" data points (samples; the grid is 0.25 eV) */
const DOT_STEP = 10;

function path(ctx: CanvasRenderingContext2D, xs: Float64Array, ys: Float64Array, xm: Map1, ym: Map1): void {
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) (i ? ctx.lineTo(xm(xs[i]), ym(ys[i])) : ctx.moveTo(xm(xs[i]), ym(ys[i])));
}

function peak(a: Float64Array): { v: number; x: number } {
  let m = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++)
    if (Math.abs(a[i]) > Math.abs(m)) {
      m = a[i];
      k = i;
    }
  return { v: m, x: P.WINDOW.lo + ((P.WINDOW.hi - P.WINDOW.lo) * k) / (P.WINDOW.n - 1) };
}

function niceStep(span: number): number {
  for (const s of [0.5, 1, 2, 2.5, 5, 10, 20]) if (span / s <= 2.2) return s;
  return 50;
}
