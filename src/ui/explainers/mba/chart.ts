/**
 * Emittance vs number of bends per sector (log scale).
 *   • scaling law ε(M, E) = 3.1 nm·rad · (2/M)³ · (E / 7 GeV)²   (anchored at the APS; accent at the chosen E,
 *     faint at the other energy)
 *   • the two real machines: APS 3.1 nm·rad (M = 2, 7 GeV), APS-U 41.7 pm·rad (M = 7, 6 GeV, design)
 *   • λ/4π at 10 keV (9.9 pm·rad), the "diffraction limit" for 10-keV X-rays
 *   • the theoretical minimum ε_min(M) = C_q γ²θ³/(12√15 J_x)·(M+1)/(M−1) (Wolski 2015 eq. 180) for J_x = 1 (and
 *     the APS-U J_x = 2.25), see physics.ts
 * Click / drag on the plot to choose M.
 */
import { TOKENS, dots, line, plotFrame, type Canvas2D, type PlotFrame } from '../kit';
import * as P from './physics';
import { hexA } from './sector';

const MS = Array.from({ length: 81 }, (_, i) => 2 + i * 0.1);
const Y_MIN = 3;
const Y_MAX = 12000;

export class EmittanceChart {
  private M = 7;
  private E = 6;
  private frame: PlotFrame | null = null;
  private dragging = false;
  private ys = new Float64Array(MS.length);

  constructor(
    private c: Canvas2D,
    private accent: string,
    private onPick: (M: number) => void,
  ) {
    const cv = c.canvas;
    cv.style.cursor = 'pointer';
    const pick = (e: PointerEvent) => {
      const f = this.frame;
      if (!f) return;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const M = 2 + ((x - f.x0) / (f.x1 - f.x0)) * 8;
      this.onPick(Math.max(2, Math.min(10, Math.round(M))));
    };
    cv.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      cv.setPointerCapture(e.pointerId);
      pick(e);
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.dragging) pick(e);
    });
    const end = () => (this.dragging = false);
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  set(o: { M: number; E: number }): void {
    this.M = o.M;
    this.E = o.E;
  }

  draw(): void {
    const { c } = this;
    const ctx = c.ctx;
    const w = c.w;
    const h = c.h;
    ctx.clearRect(0, 0, w, h);
    const yTicks = [10, 100, 1000, 10000];
    const f = plotFrame(
      ctx,
      { x: 4, y: 2, w: w - 8, h: h - 4 },
      { min: 2, max: 10, ticks: [2, 3, 4, 5, 6, 7, 8, 9, 10], label: 'bends per sector, M' },
      { min: Y_MIN, max: Y_MAX, log: true, ticks: yTicks, format: (v) => (v >= 1000 ? `${v / 1000} nm` : `${v} pm`) },
      w < 400 ? 'Emittance (log scale) vs bends' : 'Emittance εₓ (pm·rad, log scale) vs bends per sector',
    );
    this.frame = f;
    const otherE = this.E === 6 ? 7 : 6;

    // diffraction limit at 10 keV
    const dl = P.diffractionLimit(10);
    ctx.save();
    ctx.strokeStyle = hexA(TOKENS.good, 0.75);
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(f.x0, f.py(dl));
    ctx.lineTo(f.x1, f.py(dl));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 10.5px ${TOKENS.font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const dlTxt = w < 400 ? '10-keV diffraction limit, 9.9 pm·rad' : 'diffraction limit for 10-keV X-rays: λ/4π = 9.9 pm·rad';
    ctx.fillStyle = 'rgba(5,8,14,0.7)';
    ctx.fillRect(f.x0 + 4, f.py(dl) - 16, ctx.measureText(dlTxt).width + 4, 13);
    ctx.fillStyle = TOKENS.good;
    ctx.fillText(dlTxt, f.x0 + 6, f.py(dl) - 3);
    ctx.restore();

    // theoretical minimum for M equal bends (faint: context, not a target)
    {
      for (let i = 0; i < MS.length; i++) this.ys[i] = P.emittanceMin(MS[i], this.E, 1);
      line(ctx, f, MS, this.ys, hexA(TOKENS.ink3, 0.9), 1.3, [2, 3]);
      for (let i = 0; i < MS.length; i++) this.ys[i] = P.emittanceMin(MS[i], this.E, P.APSU.Jx);
      line(ctx, f, MS, this.ys, hexA(TOKENS.ink3, 0.55), 1, [1, 3]);
      // label each bound along its own curve (the chord over the label length sets the angle): J_x = 1 just
      // above its curve (the gap up to the scaling law is wider there), J_x = 2.25 just below its curve
      ctx.save();
      ctx.font = `500 10px ${TOKENS.font}`;
      ctx.textAlign = 'left';
      const pxPerM = f.px(3) - f.px(2);
      for (const [Jx, txt, alpha, M0, above] of [
        [1, 'theoretical minimum, Jₓ = 1', 0.95, 3.9, true],
        [P.APSU.Jx, 'minimum, Jₓ = 2.25', 0.75, 2.45, false],
      ] as [number, string, number, number, boolean][]) {
        const tw = ctx.measureText(txt).width;
        const M1 = M0 + ((tw + 4) / pxPerM) * 0.92;
        const x0 = f.px(M0);
        const y0 = f.py(P.emittanceMin(M0, this.E, Jx));
        const ang = Math.atan2(f.py(P.emittanceMin(M1, this.E, Jx)) - y0, f.px(M1) - x0);
        ctx.save();
        ctx.translate(x0, y0);
        ctx.rotate(ang);
        ctx.fillStyle = hexA(TOKENS.ink3, alpha);
        ctx.textBaseline = above ? 'bottom' : 'top';
        ctx.fillText(txt, 2, above ? -3 : 3);
        ctx.restore();
      }
      ctx.restore();
    }

    // scaling law at the other energy (faint) and the chosen one
    for (let i = 0; i < MS.length; i++) this.ys[i] = P.emittanceScaling(MS[i], otherE);
    line(ctx, f, MS, this.ys, hexA(TOKENS.old, 0.45), 1.3, [6, 4]);
    for (let i = 0; i < MS.length; i++) this.ys[i] = P.emittanceScaling(MS[i], this.E);
    line(ctx, f, MS, this.ys, this.accent, 2.2);
    // curve labels
    ctx.save();
    ctx.font = `600 10.5px ${TOKENS.font}`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    const lm = this.M <= 5 ? 7.4 : 3.5;
    const lx = f.px(lm) + 6;
    const ly = f.py(P.emittanceScaling(lm, Math.max(this.E, otherE))) - 6;
    ctx.fillStyle = this.accent;
    ctx.fillText(w < 440 ? `scaling law, ${this.E} GeV` : `scaling law ε ∝ E²/M³, ${this.E} GeV`, lx, ly);
    ctx.fillStyle = hexA(TOKENS.ink3, 0.95);
    ctx.textBaseline = 'top';
    // label the other-energy curve away from the current-choice tag (which sits near the dot at M)
    const oM = this.M >= 7.5 ? 4.7 : 9.3;
    if (w > 300) ctx.fillText(`${otherE} GeV`, f.px(oM), f.py(P.emittanceScaling(oM, otherE)) + (otherE > this.E ? -16 : 4));
    ctx.restore();

    // real machines
    const xsA = [2];
    const ysA = [P.APS.epsX];
    dots(ctx, f, xsA, ysA, TOKENS.old, 5);
    ctx.save();
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 2;
    ctx.fillStyle = TOKENS.bg;
    const ux = f.px(7);
    const uy = f.py(P.APSU.epsNat);
    ctx.beginPath();
    ctx.moveTo(ux, uy - 6.5);
    ctx.lineTo(ux + 6.5, uy);
    ctx.lineTo(ux, uy + 6.5);
    ctx.lineTo(ux - 6.5, uy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = `650 11px ${TOKENS.font}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TOKENS.ink2;
    ctx.textAlign = 'left';
    ctx.fillText('old APS: 3.1 nm·rad (7 GeV)', f.px(2) + 9, f.py(P.APS.epsX) + 1);
    ctx.fillStyle = TOKENS.ink;
    ctx.textAlign = 'right';
    const apsuTxt = 'APS-U design: 41.7 pm·rad';
    ctx.fillText(apsuTxt, ux - 10, uy + 12);
    ctx.restore();

    // current choice
    const M = this.M;
    const eps = P.emittanceScaling(M, this.E);
    const x = f.px(M);
    const y = f.py(eps);
    ctx.save();
    ctx.strokeStyle = hexA(this.accent, 0.35);
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, f.y0);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor = this.accent;
    ctx.shadowBlur = 12;
    ctx.fillStyle = this.accent;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    const tag = `${P.fmtEps(eps)}`;
    ctx.font = `700 12px ${TOKENS.mono}`;
    const tw = ctx.measureText(tag).width;
    let tx = x + 10;
    if (tx + tw > f.x1 - 2) tx = x - 10 - tw;
    const ty = M === 2 ? y + 20 : y - 14;
    ctx.fillStyle = 'rgba(5,8,14,0.75)';
    ctx.fillRect(tx - 3, ty - 9, tw + 6, 17);
    ctx.fillStyle = TOKENS.ink;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(tag, tx, ty);
    ctx.restore();
  }
}
