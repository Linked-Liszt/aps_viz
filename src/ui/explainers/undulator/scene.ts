/**
 * Panel 1. The undulator seen from above (top magnet row lifted away), plus an end-on cross-section inset.
 *
 * What is drawn (and how it is exaggerated. All labelled on the canvas):
 *   • Bottom jaw of a planar hybrid undulator: vanadium-permendur poles (red = N, field up ⊙; blue = S, field down ⊗)
 *     between longitudinally magnetised NdFeB blocks (arrows point to the N poles). SCUs: iron poles with NbTi coil
 *     packs. The end poles are drawn at half strength (end-field termination). Pole colour strength ∝ B₀.
 *   • Electron path x(z) = −(K/γ)(λu/2π)cos(k_u z) (B_y = B₀cos k_u z, F = −e v×B pushes the electron towards +x at N
 *     poles). Sideways displacement and all angles are magnified by the same factor γ·CONE (≈4,900×), so the ratio
 *     "oscillation angle K/γ : cone 1/γ" = K is faithful. The longitudinal scale is the real period, but only a few of the
 *     N periods are shown (number chosen per device so magnets stay legible).
 *   • Emission cone: half-angle 1/γ around the instantaneous velocity.
 *   • Wave crests: one per period, emitted where the electron points along the axis (strongest on-axis emission).
 *     Light outruns the electron; the drawn electron's mean speed is β̄ = 1/(1 + r(1 + K²/2)) of the drawn light
 *     speed, so successive crests are spaced λu·r·(1 + K²/2). The undulator equation with the slippage factor
 *     r = 1/(2γ²) magnified to SLIP (5.5×10⁷×). Circles from successive emission points also reproduce the off-axis
 *     red shift qualitatively.
 *   • Inset: end view to scale. Jaws, gap and the APS-U ID vacuum chamber (16 × 6.3 mm aperture, 0.6 mm wall;
 *     IPAC'24 TUPG56); the electron's (exaggerated) sideways oscillation shows that it moves *between* the jaws, in the
 *     horizontal plane, not towards them.
 */
import { TOKENS, type Canvas2D } from '../kit';
import * as P from './physics';

export interface SceneInput {
  dev: P.Device;
  ring: P.Ring;
  setting: number;
}

/** Drawn cone half-angle (rad) at 6 GeV: real 1/γ = 85 µrad → magnification ≈ 4,900×. Scales as 1/E. */
export const CONE_6 = 0.42;
/** Drawn slippage per period / drawn period at K = 0 and 6 GeV (real 1/(2γ²) = 3.6×10⁻⁹). Scales as 1/E². */
export const SLIP_6 = 0.2;

const MAXC = 72;
const N_COL = '#f05252';
const S_COL = '#3b82f6';
const COPPER = '#c27c3e';

export class UndulatorScene {
  /** vertical drag on the canvas (px, + = up) */
  onDrag: ((dyPx: number) => void) | null = null;
  onDragEnd: (() => void) | null = null;

  private inp: SceneInput | null = null;
  private K = 0;
  private B0 = 0;
  // geometry (CSS px)
  private w = 0;
  private h = 0;
  private axisY = 0;
  private x0 = 0;
  private x1 = 0;
  private lamV = 40;
  private nVis = 5;
  private bandH = 30;
  /** bottom row needs two lines */
  private bottom2 = false;
  private textTop = 0;
  private relaid = false;
  private ix = 0;
  private iy = 0;
  private iw = 0;
  private ih = 0;
  private cone = CONE_6;
  private slipR = SLIP_6;
  private ampV = 0;
  private cv = 100;
  // caches
  private layer = document.createElement('canvas');
  private layerDirty = true;
  /** K for which lamTxt was formatted (NaN = stale) */
  private lamKey = NaN;
  private lamTxt = '';
  private coneSprite = document.createElement('canvas');
  private coneLen = 80;
  private coneDirty = true;
  private glow = document.createElement('canvas');
  private pathX = new Float32Array(0);
  private pathY = new Float32Array(0);
  private pathN = 0;
  // dynamics
  private t = 0;
  private ze = -20;
  private nextM = 1;
  private crX = new Float64Array(MAXC);
  private crY = new Float64Array(MAXC);
  private crT = new Float64Array(MAXC);
  private crHead = 0;
  private crCount = 0;
  private hint = 1;
  private dragging = false;
  private lastY = 0;
  /** bumped whenever inputs or geometry change (a still picture must be re-made) */
  private ver = 0;
  private stillVer = -1;

  constructor(
    private c: Canvas2D,
    private accent: string,
  ) {
    this.renderGlow();
    c.onResize(() => this.geometry());
    document.fonts?.ready.then(() => this.geometry()).catch(() => {});
    const cv = c.canvas;
    cv.style.cursor = 'ns-resize';
    cv.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastY = e.clientY;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dy = this.lastY - e.clientY;
      this.lastY = e.clientY;
      if (dy !== 0) {
        this.hint = Math.min(this.hint, 0.99);
        this.onDrag?.(dy);
      }
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
      this.onDragEnd?.();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  set(inp: SceneInput): void {
    const prev = this.inp;
    this.inp = inp;
    this.ver++;
    this.B0 = P.fieldAt(inp.dev, inp.setting);
    this.K = P.kOf(this.B0, inp.dev.periodMm);
    const s = 6 / inp.ring.E;
    this.cone = CONE_6 * s;
    this.slipR = SLIP_6 * s * s;
    if (!prev || prev.dev !== inp.dev || prev.ring !== inp.ring) {
      this.geometry();
      this.coneDirty = true;
      this.restartPass();
    } else this.trajectory(); // gap / current only: the static layer stays, the field-dependent parts are drawn per frame
  }

  setAccent(a: string): void {
    this.accent = a;
    this.coneDirty = true;
  }

  /** drawn magnification of sideways displacement and angles */
  magnification(): number {
    if (!this.inp) return 0;
    return P.gammaOf(this.inp.ring.E) * this.cone;
  }

  private restartPass(): void {
    this.ze = -20;
    this.nextM = 1;
    this.crCount = 0;
  }

  // ------------------------------------------------------------------ geometry

  private geometry(): void {
    if (!this.inp) return;
    this.ver++;
    const { w, h } = this.c;
    this.w = w;
    this.h = h;
    const top = 26;
    const bot = 28;
    const avail = Math.max(60, h - top - bot);
    this.bandH = Math.max(20, Math.min(64, avail * 0.3));
    this.iw = Math.round(Math.max(98, Math.min(132, w * 0.24)));
    this.ih = Math.round(Math.max(76, Math.min(112, avail * 0.52)));
    this.ix = w - this.iw - 8;
    // narrow canvases: the DOM panel title runs across the top, so the inset starts below it
    this.iy = w < 640 ? 26 : 8;
    if (w < 640) this.ih = Math.min(this.ih, 100);
    this.axisY = Math.round(top + avail * 0.56);
    this.x0 = 14;
    const devPx = (w - 28) * (w < 560 ? 0.64 : 0.6);
    const lvis = Math.max(150, Math.min(260, devPx / 2.4)); // mm of the device shown
    this.nVis = Math.max(5, Math.min(14, Math.round(lvis / this.inp.dev.periodMm)));
    this.lamV = devPx / this.nVis;
    this.x1 = this.x0 + this.nVis * this.lamV;
    // bottom text row(s) + room for the drag hint between the jaw and that text
    const [left, right] = this.bottomTexts();
    const cx = this.c.ctx;
    cx.font = `500 10.5px ${TOKENS.font}`;
    const bar = 10 * (this.lamV / this.inp.dev.periodMm);
    this.bottom2 = cx.measureText(left).width + 18 + bar + cx.measureText(right).width + 16 >= w;
    const textTop = h - 21 - (this.bottom2 ? 14 : 0);
    this.textTop = textTop;
    const jawTopMin = top + 14; // N/S letters above the jaw
    const maxJawBottom = textTop - 28; // 7 px + 17 px hint pill + 4 px
    if (this.axisY + this.bandH > maxJawBottom) {
      this.bandH = Math.max(20, Math.min(this.bandH, (maxJawBottom - jawTopMin) / 2));
      this.axisY = Math.round(Math.max(jawTopMin + this.bandH, maxJawBottom - this.bandH));
    }
    this.cv = Math.max(80, Math.min(170, w * 0.2));
    this.coneLen = Math.max(54, Math.min(110, w * 0.13));
    this.coneDirty = true;
    this.layerDirty = true;
    this.lamKey = NaN;
    this.trajectory();
  }

  /** [left, right] texts of the bottom row: scale bar caption | magnification */
  private bottomTexts(): [string, string] {
    const inp = this.inp!;
    const left = `10 mm · period λu = ${inp.dev.periodMm} mm · ${this.nVis} of its N = ${inp.dev.N} periods shown`;
    const mag = Math.round(this.magnification() / 100) * 100;
    const right = `oscillation and angles ×${mag.toLocaleString('en-US')} · slippage ×${P.fmtSci(this.slipR * 2 * P.gammaOf(inp.ring.E) ** 2, 1)}`;
    return [left, right];
  }

  /** displacement (screen px, + = up = +x) of the drawn trajectory at screen x z */
  private disp(z: number): number {
    if (z <= this.x0 || z >= this.x1) return 0;
    const half = this.lamV / 2;
    const env = smooth((z - this.x0) / half) * smooth((this.x1 - z) / half);
    return -this.ampV * env * Math.cos((2 * Math.PI * (z - this.x0)) / this.lamV);
  }

  private trajectory(): void {
    this.ampV = (this.K * this.cone * this.lamV) / (2 * Math.PI);
    const n = Math.max(2, Math.ceil(this.w / 2) + 2);
    if (this.pathX.length < n) {
      this.pathX = new Float32Array(n);
      this.pathY = new Float32Array(n);
    }
    for (let i = 0; i < n; i++) {
      const z = Math.min(this.w + 2, i * 2);
      this.pathX[i] = z;
      this.pathY[i] = this.axisY - this.disp(z);
    }
    this.pathN = n;
  }

  // ------------------------------------------------------------------ sprites & static layer

  private renderGlow(): void {
    const g = this.glow;
    g.width = g.height = 48;
    const x = g.getContext('2d')!;
    const rg = x.createRadialGradient(24, 24, 0, 24, 24, 24);
    rg.addColorStop(0, 'rgba(255,214,150,1)');
    rg.addColorStop(0.18, 'rgba(255,181,71,0.95)');
    rg.addColorStop(0.45, 'rgba(255,181,71,0.28)');
    rg.addColorStop(1, 'rgba(255,181,71,0)');
    x.fillStyle = rg;
    x.fillRect(0, 0, 48, 48);
  }

  private renderCone(): void {
    const dpr = this.c.dpr;
    const L = this.coneLen;
    const a = this.cone;
    const hh = Math.ceil(L * Math.sin(a)) + 2;
    const cs = this.coneSprite;
    cs.width = Math.ceil(L * dpr);
    cs.height = Math.ceil(2 * hh * dpr);
    const x = cs.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, L, 2 * hh);
    const rg = x.createRadialGradient(0, hh, 0, 0, hh, L);
    rg.addColorStop(0, withAlpha(this.accent, 0.62));
    rg.addColorStop(0.55, withAlpha(this.accent, 0.22));
    rg.addColorStop(1, withAlpha(this.accent, 0));
    x.fillStyle = rg;
    x.beginPath();
    x.moveTo(0, hh);
    x.arc(0, hh, L, -a, a);
    x.closePath();
    x.fill();
    // cone edges
    x.strokeStyle = withAlpha(this.accent, 0.5);
    x.lineWidth = 1;
    x.setLineDash([3, 3]);
    x.beginPath();
    x.moveTo(0, hh);
    x.lineTo(L * 0.8 * Math.cos(a), hh - L * 0.8 * Math.sin(a));
    x.moveTo(0, hh);
    x.lineTo(L * 0.8 * Math.cos(a), hh + L * 0.8 * Math.sin(a));
    x.stroke();
    this.coneDirty = false;
  }

  private renderLayer(): void {
    const inp = this.inp;
    if (!inp) return;
    const { w, h, dpr } = this.c;
    const L = this.layer;
    // re-allocate the backing store only when the size changes (it is fully repainted below)
    const lw = Math.round(w * dpr);
    const lh = Math.round(h * dpr);
    if (L.width !== lw || L.height !== lh) {
      L.width = lw;
      L.height = lh;
    }
    const x = L.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = TOKENS.bg;
    x.fillRect(0, 0, w, h);
    const ay = this.axisY;
    const top = ay - this.bandH;
    const bh = 2 * this.bandH;
    const scu = inp.dev.kind === 'scu';

    // jaw base
    x.fillStyle = '#0e1522';
    x.strokeStyle = 'rgba(150,180,220,0.22)';
    x.lineWidth = 1;
    roundRect(x, this.x0 - 6, top - 4, this.x1 - this.x0 + 12, bh + 8, 6);
    x.fill();
    x.stroke();

    const half = this.lamV / 2;
    const pw = Math.max(2.5, half * (scu ? 0.42 : 0.34));
    const nPoles = 2 * this.nVis + 1;
    // blocks / coils between poles
    for (let m = 0; m < nPoles - 1; m++) {
      const a = this.x0 + m * half + pw / 2;
      const b = this.x0 + (m + 1) * half - pw / 2;
      if (b - a < 1) continue;
      if (scu) {
        // base tint; the field-dependent glow is added per frame (drawMagnets)
        x.fillStyle = withAlpha(COPPER, 0.3);
        x.fillRect(a + 0.5, top + 3, b - a - 1, bh - 6);
        // winding hatch
        x.save();
        x.beginPath();
        x.rect(a + 0.5, top + 3, b - a - 1, bh - 6);
        x.clip();
        x.strokeStyle = 'rgba(255,220,180,0.18)';
        x.lineWidth = 1;
        x.beginPath();
        for (let yy = top - (b - a); yy < top + bh; yy += 4) {
          x.moveTo(a, yy);
          x.lineTo(b, yy + (b - a));
        }
        x.stroke();
        x.restore();
        if (b - a >= 9) {
          // current direction alternates between neighbouring coil packs
          const sym = m % 2 === 0 ? '⊙' : '⊗';
          label(x, sym, (a + b) / 2, ay + this.bandH * 0.62, 'rgba(255,230,200,0.75)', 9, 'center');
        }
      } else {
        x.fillStyle = '#1b2536';
        x.fillRect(a + 0.5, top + 3, b - a - 1, bh - 6);
        if (b - a >= 11) {
          // magnetisation arrow points to the N pole (even m)
          const toRight = (m + 1) % 2 === 0;
          const cx = (a + b) / 2;
          const yy = ay + this.bandH * 0.62;
          const len = Math.min(9, (b - a) * 0.32);
          x.strokeStyle = 'rgba(160,178,204,0.55)';
          x.fillStyle = 'rgba(160,178,204,0.55)';
          x.lineWidth = 1.2;
          x.beginPath();
          x.moveTo(cx - len, yy);
          x.lineTo(cx + len, yy);
          x.stroke();
          const tip = toRight ? cx + len + 2 : cx - len - 2;
          const dir = toRight ? -1 : 1;
          x.beginPath();
          x.moveTo(tip, yy);
          x.lineTo(tip + dir * 4, yy - 2.6);
          x.lineTo(tip + dir * 4, yy + 2.6);
          x.closePath();
          x.fill();
        }
      }
    }
    // poles: SCU iron cores here; the pole colours (∝ field) are drawn per frame (drawMagnets)
    if (scu) {
      x.fillStyle = '#4a5466';
      for (let m = 0; m < nPoles; m++) x.fillRect(this.x0 + m * half - pw / 2, top + 2, pw, bh - 4);
    }
    // N / S letters above the jaw
    if (half >= 11) {
      for (let m = 0; m < nPoles; m++) {
        const cx = this.x0 + m * half;
        const isN = m % 2 === 0;
        label(x, isN ? 'N' : 'S', cx, top - 8, isN ? '#ff8a8a' : '#8db8ff', 9.5, 'center', 700);
      }
    } else if (half >= 6) {
      // too tight for letters: tick colours only
      for (let m = 0; m < nPoles; m++) {
        x.fillStyle = m % 2 === 0 ? '#ff8a8a' : '#8db8ff';
        x.fillRect(this.x0 + m * half - 1, top - 9, 2, 4);
      }
    }

    // beam axis
    x.strokeStyle = 'rgba(170,190,215,0.22)';
    x.setLineDash([4, 5]);
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(0, ay);
    x.lineTo(w, ay);
    x.stroke();
    x.setLineDash([]);

    // exit-region annotations (the λ₁ bar depends on K: drawn per frame)
    label(x, 'X-rays → beamline', w - 10, ay - 8 > this.iy + this.ih + 10 ? ay - 8 : ay + 16, TOKENS.ink3, 10.5, 'right', 600);
    label(x, 'e⁻', 6, ay - 8, TOKENS.electron, 11, 'left', 700);

    // bottom row: scale bar + periods shown | magnification
    const ybar = h - 11;
    const mmPx = this.lamV / inp.dev.periodMm;
    const bar = 10 * mmPx;
    x.strokeStyle = TOKENS.ink2;
    x.lineWidth = 1.2;
    x.beginPath();
    x.moveTo(12, ybar - 4);
    x.lineTo(12, ybar);
    x.lineTo(12 + bar, ybar);
    x.lineTo(12 + bar, ybar - 4);
    x.stroke();
    const [left, right] = this.bottomTexts();
    x.font = `500 10.5px ${TOKENS.font}`;
    if (!this.relaid && x.measureText(left).width + 18 + bar + x.measureText(right).width + 16 >= w !== this.bottom2) {
      // the web font arrived after the layout was measured: lay out again (once), draw on the next frame
      this.relaid = true;
      this.geometry();
      return;
    }
    this.relaid = false;
    label(x, left, 18 + bar, ybar + 1, TOKENS.ink3, 10.5, 'left', 500);
    if (!this.bottom2) label(x, right, w - 10, ybar + 1, TOKENS.ink3, 10.5, 'right', 500);
    else label(x, right, 12, ybar - 14, TOKENS.ink3, 10.5, 'left', 500);

    this.layerDirty = false;
  }

  // ------------------------------------------------------------------ animation

  frame(dt: number): void {
    if (!this.inp || this.w < 20) return;
    this.advance(dt);
    this.draw();
  }

  /**
   * Reduced motion: a still picture instead of frame(). For each new state (input, gap, resize) the pass is replayed
   * off-screen to a representative moment, the electron ~80 % through the magnets with its crests spreading ahead,
   * and drawn once.
   */
  still(): void {
    if (!this.inp || this.w < 20 || this.stillVer === this.ver) return;
    this.stillVer = this.ver;
    this.t = 0;
    this.restartPass();
    const target = this.x0 + 0.8 * (this.x1 - this.x0);
    for (let i = 0; i < 3000 && this.ze < target; i++) this.advance(1 / 60);
    this.draw();
  }

  private advance(dt: number): void {
    this.t += dt;
    const t = this.t;
    const r = this.slipR;
    const inside = this.ze > this.x0 && this.ze < this.x1;
    const beta = inside ? 1 / (1 + r * (1 + (this.K * this.K) / 2)) : 1 / (1 + r);
    const v = this.cv * beta;
    this.ze += v * dt;
    // emission at the N poles (electron moving parallel to the axis), m = 1 … nVis−1
    while (this.nextM <= this.nVis - 1 && this.ze >= this.x0 + this.nextM * this.lamV) {
      const zm = this.x0 + this.nextM * this.lamV;
      const tEmit = t - (this.ze - zm) / v;
      const k = (this.crHead + this.crCount) % MAXC;
      this.crX[k] = zm;
      this.crY[k] = this.axisY - this.disp(zm);
      this.crT[k] = tEmit;
      if (this.crCount < MAXC) this.crCount++;
      else this.crHead = (this.crHead + 1) % MAXC;
      this.nextM++;
    }
    if (this.ze > this.w + 30) this.restartPassKeepCrests();
    // retire crests that left the canvas
    while (this.crCount > 0) {
      const R = this.cv * (t - this.crT[this.crHead]);
      if (this.crX[this.crHead] + R * Math.cos(1.5 * this.cone) > this.w + 10) {
        this.crHead = (this.crHead + 1) % MAXC;
        this.crCount--;
      } else break;
    }
    if (!this.dragging && this.hint < 1 && this.hint > 0) this.hint = Math.max(0, this.hint - dt * 0.5);
  }

  private restartPassKeepCrests(): void {
    this.ze = -20;
    this.nextM = 1;
  }

  /** Field-dependent parts of the magnet array (pole colours, coil glow, λ₁ bar): cheap, drawn every frame. */
  private drawMagnets(ctx: CanvasRenderingContext2D): void {
    const inp = this.inp!;
    const scu = inp.dev.kind === 'scu';
    const strength = Math.max(0.12, Math.min(1, this.B0 / 1.15));
    const ay = this.axisY;
    const top = ay - this.bandH;
    const bh = 2 * this.bandH;
    const half = this.lamV / 2;
    const pw = Math.max(2.5, half * (scu ? 0.42 : 0.34));
    const nPoles = 2 * this.nVis + 1;
    if (scu) {
      ctx.fillStyle = COPPER;
      ctx.globalAlpha = 0.45 * strength;
      for (let m = 0; m < nPoles - 1; m++) {
        const a = this.x0 + m * half + pw / 2;
        const b = this.x0 + (m + 1) * half - pw / 2;
        if (b - a >= 1) ctx.fillRect(a + 0.5, top + 3, b - a - 1, bh - 6);
      }
    }
    for (let m = 0; m < nPoles; m++) {
      const cx = this.x0 + m * half;
      const end = m === 0 || m === nPoles - 1;
      const al = (end ? 0.5 : 1) * (0.25 + 0.75 * strength);
      ctx.globalAlpha = al;
      ctx.fillStyle = m % 2 === 0 ? N_COL : S_COL;
      ctx.fillRect(cx - pw / 2, top + 2, pw, bh - 4);
      if (!scu) {
        ctx.globalAlpha = 0.1 * al;
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - pw / 2, top + 2, Math.max(1, pw * 0.3), bh - 4);
      }
    }
    ctx.globalAlpha = 1;
    // beam axis back on top of the poles
    ctx.strokeStyle = 'rgba(170,190,215,0.22)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.x0 - 6, ay);
    ctx.lineTo(this.x1 + 6, ay);
    ctx.stroke();
    ctx.setLineDash([]);
    // one X-ray wavelength (drawn slippage per period)
    const Ldraw = this.lamV * this.slipR * (1 + (this.K * this.K) / 2);
    const bx = this.x1 + 18;
    const by = ay + 30;
    if (bx + Ldraw < this.ix - 4 || by > this.iy + this.ih + 8) {
      ctx.strokeStyle = withAlpha(this.accent, 0.85);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4);
      ctx.lineTo(bx, by + 4);
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Ldraw, by);
      ctx.moveTo(bx + Ldraw, by - 4);
      ctx.lineTo(bx + Ldraw, by + 4);
      ctx.stroke();
      if (this.lamKey !== this.K) {
        this.lamKey = this.K;
        const lam1 = P.lambdaN(1, inp.ring.E, inp.dev.periodMm, this.K);
        const v = `${lam1 < 1 ? lam1.toFixed(3) : lam1.toFixed(2)} Å`;
        ctx.font = `600 10.5px ${TOKENS.font}`;
        this.lamTxt = [`one wavelength λ₁ = ${v}`, `one wavelength: ${v}`, `λ₁ = ${v}`].find((t) => bx + ctx.measureText(t).width <= this.w - 4) ?? `λ₁ = ${v}`;
      }
      label(ctx, this.lamTxt, bx, by + 15, this.accent, 10.5, 'left', 600);
    }
  }

  private draw(): void {
    const inp = this.inp!;
    const ctx = this.c.ctx;
    const { w, h } = this;
    if (this.layerDirty) this.renderLayer();
    if (this.coneDirty) this.renderCone();
    ctx.save();
    ctx.drawImage(this.layer, 0, 0, w, h);
    this.drawMagnets(ctx);

    // wave crests
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1.6;
    const c = this.cone;
    for (let i = 0; i < this.crCount; i++) {
      const k = (this.crHead + i) % MAXC;
      const R = this.cv * (this.t - this.crT[k]);
      if (R <= 0.5) continue;
      const cx = this.crX[k];
      const cy = this.crY[k];
      const fade = Math.max(0, Math.min(1, (w - 4 - (cx + R)) / 40));
      const a = 0.8 * fade;
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(cx, cy, R, -0.5 * c, 0.5 * c);
      ctx.stroke();
      ctx.globalAlpha = a * 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0.5 * c, c);
      ctx.moveTo(cx + R * Math.cos(-c), cy + R * Math.sin(-c));
      ctx.arc(cx, cy, R, -c, -0.5 * c);
      ctx.stroke();
      ctx.globalAlpha = a * 0.16;
      ctx.beginPath();
      ctx.arc(cx, cy, R, c, 1.5 * c);
      ctx.moveTo(cx + R * Math.cos(-1.5 * c), cy + R * Math.sin(-1.5 * c));
      ctx.arc(cx, cy, R, -1.5 * c, -c);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // trajectory: faint ahead, bright behind the electron
    const ze = this.ze;
    const iz = Math.max(0, Math.min(this.pathN - 1, Math.floor(ze / 2)));
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,181,71,0.22)';
    ctx.beginPath();
    ctx.moveTo(this.pathX[iz], this.pathY[iz]);
    for (let i = iz + 1; i < this.pathN; i++) ctx.lineTo(this.pathX[i], this.pathY[i]);
    ctx.stroke();
    if (ze > 0) {
      ctx.strokeStyle = 'rgba(255,181,71,0.8)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(this.pathX[0], this.pathY[0]);
      for (let i = 1; i <= iz; i++) ctx.lineTo(this.pathX[i], this.pathY[i]);
      ctx.lineTo(ze, this.axisY - this.disp(ze));
      ctx.stroke();
    }

    // electron + emission cone
    if (ze > -10 && ze < w + 10) {
      const ey = this.axisY - this.disp(ze);
      const slope = (this.disp(ze + 0.5) - this.disp(ze - 0.5)) / 1; // + = turning up (+x)
      const ang = -Math.atan(slope);
      const fadeOut = Math.max(0, Math.min(1, (w - ze) / 60));
      ctx.globalAlpha = fadeOut;
      ctx.save();
      ctx.translate(ze, ey);
      ctx.rotate(ang);
      const sh = this.coneSprite.height / this.c.dpr;
      ctx.drawImage(this.coneSprite, 0, -sh / 2, this.coneSprite.width / this.c.dpr, sh);
      ctx.restore();
      ctx.drawImage(this.glow, ze - 12, ey - 12, 24, 24);
      ctx.fillStyle = '#fff4e0';
      ctx.beginPath();
      ctx.arc(ze, ey, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // drag hint
    if (this.hint > 0.02) {
      ctx.globalAlpha = Math.min(1, this.hint);
      const txt = inp.dev.kind === 'scu' ? '↕ drag to change the current' : '↕ drag to open / close the gap';
      ctx.font = `600 10.5px ${TOKENS.font}`;
      const tw = ctx.measureText(txt).width + 14;
      const px = Math.max(this.x0, Math.min(this.x1 - tw, (this.x0 + this.x1) / 2 - tw / 2));
      const py = this.axisY + this.bandH + 7;
      if (py + 17 <= this.textTop - 2) {
        ctx.fillStyle = 'rgba(11,17,27,0.85)';
        roundRect(ctx, px, py, tw, 17, 8.5);
        ctx.fill();
        ctx.strokeStyle = withAlpha(this.accent, 0.45);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = TOKENS.ink2;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, px + 7, py + 9);
      }
      ctx.globalAlpha = 1;
    }

    this.drawInset(ctx);
    ctx.restore();
  }

  private drawInset(ctx: CanvasRenderingContext2D): void {
    const inp = this.inp!;
    const { ix, iy, iw, ih } = this;
    const scu = inp.dev.kind === 'scu';
    ctx.fillStyle = 'rgba(9,14,22,0.94)';
    ctx.strokeStyle = 'rgba(150,180,220,0.22)';
    ctx.lineWidth = 1;
    roundRect(ctx, ix, iy, iw, ih, 7);
    ctx.fill();
    ctx.stroke();
    label(ctx, "End view", ix + 7, iy + 13, TOKENS.ink3, 9, 'left', 700);
    label(ctx, scu ? '4 K' : 'to scale', ix + iw - 7, iy + 13, scu ? '#9fd3ff' : TOKENS.ink3, 9, 'right', 600);
    const s = (ih - 38) / (33 + 2 * 8); // px per mm, same for every device
    const gap = scu ? inp.dev.gapMinMm : this.inp!.setting;
    const cx = ix + iw / 2 - 4;
    const cy = iy + 19 + (ih - 38) / 2;
    const jw = iw - 30;
    const jt = 8 * s;
    const gy = (gap / 2) * s;
    for (const sgn of [-1, 1]) {
      const y = sgn < 0 ? cy - gy - jt : cy + gy;
      if (scu) {
        ctx.fillStyle = withAlpha(COPPER, 0.35 + 0.5 * Math.min(1, this.B0 / 1.3));
        ctx.fillRect(cx - jw / 2, y, jw, jt);
        ctx.fillStyle = '#4a5466';
        ctx.fillRect(cx - jw / 2, sgn < 0 ? y + jt - 1.5 : y, jw, 1.5);
      } else {
        ctx.fillStyle = '#1f2a3d';
        ctx.fillRect(cx - jw / 2, y, jw, jt);
        ctx.fillStyle = withAlpha(sgn < 0 ? S_COL : N_COL, 0.75);
        ctx.fillRect(cx - jw / 2, sgn < 0 ? y + jt - 1.5 : y, jw, 1.5);
      }
    }
    // cryostat outline for SCU
    if (scu) {
      ctx.strokeStyle = 'rgba(159,211,255,0.35)';
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(cx - jw / 2 - 4, cy - gy - jt - 4, jw + 8, 2 * (gy + jt) + 8);
      ctx.setLineDash([]);
    }
    // vacuum chamber (APS-U IDVC: 16 × 6.3 mm aperture, 0.6 mm wall)
    ctx.strokeStyle = 'rgba(203,213,225,0.75)';
    ctx.lineWidth = Math.max(1, 0.6 * s);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 8.3 * s, 3.45 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
    // electron: oscillates sideways (between the jaws), magnified like panel 1
    const ze = this.ze;
    const ex = Math.max(-7 * s, Math.min(7 * s, this.disp(ze) * 0.45));
    if (ze > -10 && ze < this.w) {
      ctx.drawImage(this.glow, cx + ex - 6, cy - 6, 12, 12);
      ctx.fillStyle = '#fff4e0';
      ctx.beginPath();
      ctx.arc(cx + ex, cy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // gap dimension
    const dx = cx + jw / 2 + 6;
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dx - 3, cy - gy);
    ctx.lineTo(dx + 3, cy - gy);
    ctx.moveTo(dx, cy - gy);
    ctx.lineTo(dx, cy + gy);
    ctx.moveTo(dx - 3, cy + gy);
    ctx.lineTo(dx + 3, cy + gy);
    ctx.stroke();
    ctx.font = `600 10px ${TOKENS.mono}`;
    let gtxt = scu ? `fixed gap ${gap.toFixed(1)} mm` : `gap ${gap.toFixed(1)} mm`;
    if (ctx.measureText(gtxt).width > iw - 8) gtxt = scu ? `${gap.toFixed(1)} mm, fixed` : `${gap.toFixed(1)} mm`;
    label(ctx, gtxt, ix + iw / 2, iy + ih - 7, this.accent, 10, 'center', 600, true);
  }
}

// ------------------------------------------------------------------ helpers

function smooth(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u * u * (3 - 2 * u);
}

const alphaCache = new Map<string, string>();
/** CSS colour with alpha (memoised: it is called from the animation loop) */
export function withAlpha(color: string, a: number): string {
  const key = `${color}|${a}`;
  let v = alphaCache.get(key);
  if (v === undefined) {
    v = withAlphaRaw(color, a);
    if (alphaCache.size > 512) alphaCache.clear();
    alphaCache.set(key, v);
  }
  return v;
}

function withAlphaRaw(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (m) {
    const v = parseInt(m[1], 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
  }
  const m3 = /^#([0-9a-f]{3})$/i.exec(color.trim());
  if (m3) {
    const [r, g, b] = m3[1].split('').map((c) => parseInt(c + c, 16));
    return `rgba(${r},${g},${b},${a})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgb) {
    const p = rgb[1].split(',').map((s) => s.trim());
    return `rgba(${p[0]},${p[1]},${p[2]},${a})`;
  }
  return color;
}

export function roundRect(x: CanvasRenderingContext2D, rx: number, ry: number, rw: number, rh: number, r: number): void {
  const rr = Math.min(r, rw / 2, rh / 2);
  x.beginPath();
  x.moveTo(rx + rr, ry);
  x.arcTo(rx + rw, ry, rx + rw, ry + rh, rr);
  x.arcTo(rx + rw, ry + rh, rx, ry + rh, rr);
  x.arcTo(rx, ry + rh, rx, ry, rr);
  x.arcTo(rx, ry, rx + rw, ry, rr);
  x.closePath();
}

export function label(
  x: CanvasRenderingContext2D,
  text: string,
  px: number,
  py: number,
  color: string,
  size: number,
  align: CanvasTextAlign = 'left',
  weight = 500,
  mono = false,
): void {
  x.fillStyle = color;
  x.font = `${weight} ${size}px ${mono ? TOKENS.mono : TOKENS.font}`;
  x.textAlign = align;
  x.textBaseline = 'alphabetic';
  x.fillText(text, px, py);
}
