/**
 * Young's double-slit view: two "lanes" (old APS, APS-U), each drawn as beam's-eye views of
 *   [photon source, to scale] → Z metres → [slit mask + degree of coherence μ(Δx) centred on one slit] → [detector].
 * The detector accumulates individual photons sampled from the partially coherent far-field pattern
 * (physics.youngPattern) with an exponential memory, so the fringes build up and fade as parameters change.
 * Both detectors receive the same photon rate (brightness differences are deliberately not shown).
 */
import type { Depth } from '../../../app/store';
import { TOKENS, lut, type Canvas2D } from '../kit';
import * as P from './physics';
import { roundRect, txt } from './chart';

export type Plane = 'x' | 'y';

export interface YoungParams {
  E: number;
  /** slit distance from the source, m */
  Z: number;
  /** slit separation, m */
  d: number;
  plane: Plane;
  mode: 'round' | 'flat';
  depth: Depth;
  /** shown for CHEX (28-ID): name its stations at their distances */
  chex?: boolean;
}

export interface LaneInfo {
  ring: P.Ring;
  /** photon source size in the tested plane, m */
  sigma: number;
  /** coherence length at the slits, m */
  xi: number;
  /** |μ₁₂(d)| */
  mu: number;
  /** fringe visibility of the computed pattern */
  V: number;
}

const NP = 384; // pattern samples across the detector
const NU = 168; // detector bins across the fringes
const NV = 60; // detector bins along the slits
const U_MAX = 5; // detector half-width in fringe orders (λ/d)
const RATE = 36000; // photons / s per detector
const TAU = 0.7; // s, detector memory
const SIG_V = 0.2; // along-slit spread, fraction of NV
const UT = 4096; // inverse-CDF lookup resolution (photon u-bin per uniform deviate)
// along-slit bin for a uniform deviate: Gaussian quantiles (−1 = off the detector)
const V_TAB = new Int16Array(UT);
for (let k = 0; k < UT; k++) {
  const iv = Math.floor(NV / 2 + normInv((k + 0.5) / UT) * SIG_V * NV);
  V_TAB[k] = iv >= 0 && iv < NV ? iv : -1;
}
// display transfer: normalised counts (0..1, 1024 steps) → colormap index with γ = 0.75
const GAMMA = new Uint8Array(1025);
for (let i = 0; i <= 1024; i++) GAMMA[i] = Math.round(Math.pow(i / 1024, 0.75) * 255);

class Lane {
  info: LaneInfo;
  pdf = new Float32Array(NP);
  cdf = new Float32Array(NP);
  binMax = 1;
  /** u-bin for each of UT equally likely quantiles of the pattern */
  uTab = new Uint16Array(UT);
  acc = new Float32Array(NU * NV);
  img: ImageData;
  imgV: ImageData;
  off: HTMLCanvasElement;
  offCtx: CanvasRenderingContext2D;

  constructor(
    public color: string,
    ring: P.Ring,
  ) {
    this.info = { ring, sigma: 1, xi: 1, mu: 0, V: 0 };
    this.img = new ImageData(NU, NV);
    this.imgV = new ImageData(NV, NU);
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d')!;
  }

  update(ring: P.Ring, p: YoungParams): void {
    const lambda = P.wavelength(p.E);
    const ph = P.photonPlane(p.plane === 'x' ? ring.x : ring.y, lambda);
    const xi = P.coherenceLengthGSM(ph, p.Z);
    const xiD = xi / p.d;
    this.info = { ring, sigma: ph.size, xi, mu: P.degreeOfCoherence(p.d, xi), V: P.centralVisibility(xiD) };
    P.youngPattern(this.pdf, xiD, U_MAX);
    let s = 0;
    for (let i = 0; i < NP; i++) {
      s += this.pdf[i];
      this.cdf[i] = s;
    }
    const inv = s > 0 ? 1 / s : 0;
    let mx = 0;
    for (let i = 0; i < NP; i++) {
      this.cdf[i] *= inv;
      if (this.pdf[i] > mx) mx = this.pdf[i];
    }
    // probability of the most likely detector bin (NP samples → NU bins)
    this.binMax = Math.max(1e-6, (mx * inv * NP) / NU);
    // inverse CDF table (one pass: quantiles are increasing)
    const cdf = this.cdf;
    let j = 0;
    for (let k = 0; k < UT; k++) {
      const r = (k + 0.5) / UT;
      while (j < NP - 1 && cdf[j] < r) j++;
      // sample j sits at t_j = j/(NP−1) across the detector (as youngPattern lays them out) and covers
      // [t_j − ½Δ, t_j + ½Δ), Δ = 1/(NP−1); interpolate inside it for sub-sample placement
      const c0 = j > 0 ? cdf[j - 1] : 0;
      const t = cdf[j] > c0 ? (r - c0) / (cdf[j] - c0) : 0.5;
      const u = (j - 0.5 + t) / (NP - 1);
      this.uTab[k] = Math.max(0, Math.min(NU - 1, Math.floor(u * NU)));
    }
  }

  /** advance the detector: fade and add new photons */
  accumulate(dt: number): void {
    const decay = Math.exp(-dt / TAU);
    const a = this.acc;
    for (let i = 0; i < a.length; i++) a[i] *= decay;
    const n = Math.round(RATE * dt);
    const ut = this.uTab;
    for (let k = 0; k < n; k++) {
      const iv = V_TAB[(Math.random() * UT) | 0];
      if (iv < 0) continue;
      a[iv * NU + ut[(Math.random() * UT) | 0]] += 1;
    }
  }

  /** render the detector buffer into the offscreen canvas in the given orientation */
  render(plane: Plane): HTMLCanvasElement {
    const steady = RATE * TAU * this.binMax * (1 / (Math.sqrt(2 * Math.PI) * SIG_V * NV));
    const inv = 1024 / (steady * 1.1);
    const L = lut('inferno');
    const vert = plane === 'y';
    const img = vert ? this.imgV : this.img;
    const d = img.data;
    const a = this.acc;
    for (let iv = 0; iv < NV; iv++) {
      for (let iu = 0; iu < NU; iu++) {
        const k = GAMMA[Math.min(1024, (a[iv * NU + iu] * inv) | 0)] * 3;
        // horizontal test: u → x, v → y ; vertical test: u → −y (up), v → x
        const o = vert ? ((NU - 1 - iu) * NV + iv) * 4 : (iv * NU + iu) * 4;
        d[o] = L[k];
        d[o + 1] = L[k + 1];
        d[o + 2] = L[k + 2];
        d[o + 3] = 255;
      }
    }
    if (this.off.width !== img.width || this.off.height !== img.height) {
      this.off.width = img.width;
      this.off.height = img.height;
    }
    this.offCtx.putImageData(img, 0, 0);
    return this.off;
  }
}

export class YoungView {
  private old: Lane;
  private neu: Lane;
  private p: YoungParams = { E: 25, Z: 45.5, d: 10e-6, plane: 'x', mode: 'round', depth: 'visitor' };
  /** everything except the detector images changes only with the parameters or the canvas size */
  private fullDirty = true;
  /** the detectors still show photons of the previous parameters (reduced motion: refill them at once) */
  private stale = false;
  private scr: { L: Lane; x: number; y: number; w: number; h: number }[] = [];

  constructor(
    private c: Canvas2D,
    accent: string,
  ) {
    this.old = new Lane(TOKENS.old, P.APS_2019);
    this.neu = new Lane(accent, P.APSU_ROUND);
  }

  set(p: YoungParams): void {
    const prevPlane = this.p.plane;
    this.p = p;
    this.old.update(P.APS_2019, p);
    this.neu.update(p.mode === 'round' ? P.APSU_ROUND : P.APSU_FLAT, p);
    if (prevPlane !== p.plane) {
      this.old.acc.fill(0);
      this.neu.acc.fill(0);
    }
    this.fullDirty = true;
    this.stale = true;
  }

  /** request a full repaint (e.g. after a resize) */
  invalidate(): void {
    this.fullDirty = true;
  }

  get lanes(): { old: LaneInfo; neu: LaneInfo } {
    return { old: this.old.info, neu: this.neu.info };
  }

  /** pre-fill the detectors so the first frame already shows a pattern */
  warm(seconds = 1.2): void {
    for (let t = 0; t < seconds; t += 1 / 30) {
      this.old.accumulate(1 / 30);
      this.neu.accumulate(1 / 30);
    }
  }

  frame(dt: number): void {
    this.old.accumulate(dt);
    this.neu.accumulate(dt);
    this.stale = false;
    if (this.fullDirty) this.draw();
    else for (const r of this.scr) this.screenImage(r.L, r.x, r.y, r.w, r.h);
  }

  /**
   * Reduced motion: a still picture instead of frame(). After a parameter change each detector is refilled at once
   * with one detector memory's worth of photons (RATE·TAU, the steady-state count) from the new pattern; otherwise
   * nothing is redrawn unless the view needs it (resize).
   */
  still(): void {
    if (this.stale) {
      this.stale = false;
      for (const L of [this.old, this.neu]) {
        L.acc.fill(0);
        L.accumulate(TAU);
      }
      this.fullDirty = true;
    }
    if (this.fullDirty) this.draw();
  }

  draw(): void {
    this.fullDirty = false;
    this.scr.length = 0;
    const { ctx, w, h } = this.c;
    const p = this.p;
    const spec = p.depth === 'specialist';
    ctx.save();
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    // header line under the kit label
    const pos = p.chex ? P.nearestChexPosition(p.Z) : null;
    const Etxt = `${p.E.toFixed(1)} keV`;
    const head = spec
      ? `${Etxt} · λ = ${(P.wavelength(p.E) * 1e10).toFixed(3)} Å · d = ${fmtUm(p.d)} · Z = ${p.Z.toFixed(1)} m${pos ? ` (${pos.name})` : ''} · slit width d/4`
      : `${Etxt} X-rays · two slits ${fmtUm(p.d)} apart, ${p.Z.toFixed(1)} m from the source${pos ? ` (${pos.name})` : ''}`;
    const short = spec
      ? `${Etxt} · d ${fmtUm(p.d)} · Z ${p.Z.toFixed(1)} m${pos ? ` (${pos.name})` : ''} · width d/4`
      : `${Etxt} · slits ${fmtUm(p.d)} apart · ${p.Z.toFixed(1)} m from source${pos ? ` (${pos.name.replace('28-ID-', '')})` : ''}`;
    const hs = w < 420 ? 10.5 : 11.5;
    ctx.save();
    ctx.font = `500 ${hs}px ${TOKENS.font}`;
    const fits = ctx.measureText(head).width <= w - 16;
    ctx.restore();
    txt(ctx, fits ? head : short, 8, 34, { color: TOKENS.ink2, size: hs });
    const top = 44;
    const laneGap = 10;
    const laneH = (h - top - laneGap - 6) / 2;
    this.lane(this.old, 8, top, w - 16, laneH, false);
    this.lane(this.neu, 8, top + laneH + laneGap, w - 16, laneH, true);
    ctx.restore();
  }

  private lane(L: Lane, x: number, y: number, w: number, h: number, isNew: boolean): void {
    const ctx = this.c.ctx;
    const p = this.p;
    const spec = p.depth === 'specialist';
    const info = L.info;
    const col = L.color;
    // card
    ctx.save();
    ctx.fillStyle = 'rgba(14,21,33,0.55)';
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = isNew ? withAlpha(col, 0.35) : 'rgba(150,180,220,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // ---- title row: visibility meter on the right, the longest title variant that fits on the left
    const narrow = w < 440;
    const V = info.V;
    const mw = narrow ? 46 : 64;
    const vTxt = spec ? `V = ${V < 0.005 ? '0.00' : V.toFixed(2)}` : `${narrow ? 'contrast' : 'fringe contrast'} ${Math.round(V * 100)}%`;
    const mx1 = x + w - 10;
    const mx0 = mx1 - mw;
    ctx.save();
    ctx.fillStyle = 'rgba(150,180,220,0.16)';
    roundRect(ctx, mx0, y + 9, mw, 7, 3.5);
    ctx.fill();
    ctx.fillStyle = col;
    if (V > 0.004) {
      roundRect(ctx, mx0, y + 9, Math.max(7, mw * V), 7, 3.5);
      ctx.fill();
    }
    ctx.font = `700 12px ${TOKENS.mono}`;
    const vW = ctx.measureText(vTxt).width;
    ctx.font = `700 12.5px ${TOKENS.font}`;
    const beam = p.mode === 'round' ? 'round' : 'flat';
    const titles = spec
      ? isNew
        ? [`APS-U · 6 GeV · ${beam} beam`, `APS-U · ${beam} beam`, `APS-U · ${beam}`, 'APS-U']
        : ['APS 2019 · 7 GeV', 'APS 2019', 'APS']
      : isNew
        ? ['After the upgrade: APS-U', 'After (APS-U)', 'APS-U']
        : ['Before the upgrade: APS', 'Before (APS)', 'APS'];
    const room = mx0 - 8 - vW - 10 - (x + 10);
    const title = titles.find((t) => ctx.measureText(t).width <= room) ?? titles[titles.length - 1];
    ctx.restore();
    txt(ctx, title, x + 10, y + 17, { color: isNew ? col : TOKENS.ink2, size: 12.5, weight: 700 });
    txt(ctx, vTxt, mx0 - 8, y + 17, { color: isNew ? col : TOKENS.ink, size: 12, weight: 700, mono: true, align: 'right' });

    // ---- panels row
    const capH = 16;
    const rowY = y + 26;
    const rowH = h - 26 - capH - 6;
    const gapA = narrow ? 14 : 26;
    const srcS = Math.min(rowH, narrow ? Math.max(46, w * 0.15) : Math.max(60, Math.min(118, w * 0.17)));
    const slitW = narrow ? Math.max(76, w * 0.24) : Math.max(86, Math.min(170, w * 0.25));
    const scrW = w - 20 - srcS - slitW - 2 * gapA;
    const sx = x + 10;
    const slx = sx + srcS + gapA;
    const scx = slx + slitW + gapA;
    this.source(L, sx, rowY + (rowH - srcS) / 2, srcS);
    this.slits(L, slx, rowY, slitW, rowH);
    this.screen(L, scx, rowY, scrW, rowH);
    // connectors
    const cy = rowY + rowH / 2;
    arrow(ctx, sx + srcS + 3, cy, slx - 3, cy, TOKENS.ink3);
    arrow(ctx, slx + slitW + 3, cy, scx - 3, cy, TOKENS.ink3);

    // ---- captions under panels
    const cyy = y + h - 7;
    txt(ctx, spec ? (srcS < 70 ? `Σ_${p.plane}` : `Σ_${p.plane} ${fmtUm(info.sigma)}`) : srcS < 70 ? 'source' : 'source (to scale)', sx + srcS / 2, cyy, { color: TOKENS.ink3, size: 10, align: 'center' });
    const xiTxt = spec ? `ξ_${p.plane} = ${fmtUm(info.xi)}` : narrow ? `in step ~${fmtUm(info.xi)}` : `in step over ~${fmtUm(info.xi)}`;
    txt(ctx, xiTxt, slx + slitW / 2, cyy, { color: isNew ? col : TOKENS.ink2, size: 10, align: 'center', weight: 600 });
    const lam = P.wavelength(p.E);
    const fr = (lam / p.d) * 1e6;
    const frT = `${fr < 1 ? fr.toFixed(2) : fr < 100 ? fr.toFixed(1) : fr.toFixed(0)} µrad`;
    const scrCap = spec ? (scrW < 260 ? `far field · fringes every ${frT}` : `detector (far field) · fringe period λ/d = ${frT}`) : scrW < 200 ? 'detector, far behind' : 'detector far behind the slits';
    txt(ctx, scrCap, scx + scrW / 2, cyy, {
      color: TOKENS.ink3,
      size: 10,
      align: 'center',
    });
  }

  /** photon source Σ_x × Σ_y drawn to a common scale for both lanes */
  private source(L: Lane, x: number, y: number, s: number): void {
    const ctx = this.c.ctx;
    const p = this.p;
    const lambda = P.wavelength(p.E);
    const ring = L.info.ring;
    const Sx = P.photonPlane(ring.x, lambda).size;
    const Sy = P.photonPlane(ring.y, lambda).size;
    // common scale: the old ring's source in the tested plane spans ±2.6 Σ of the box
    const oldS = P.photonPlane(p.plane === 'x' ? P.APS_2019.x : P.APS_2019.y, lambda).size;
    const span = 5.2 * oldS; // m across the box
    const k = s / span; // px per m
    ctx.save();
    ctx.fillStyle = '#03050a';
    roundRect(ctx, x, y, s, s, 6);
    ctx.fill();
    ctx.clip();
    const cx = x + s / 2;
    const cy = y + s / 2;
    const rx = Math.max(1.6, 2 * Sx * k);
    const ry = Math.max(1.6, 2 * Sy * k);
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.6);
    const c = L.color;
    g.addColorStop(0, withAlpha('#ffffff', 0.95));
    g.addColorStop(0.18, withAlpha(c, 0.95));
    g.addColorStop(0.45, withAlpha(c, 0.55));
    g.addColorStop(0.625, withAlpha(c, 0.22));
    g.addColorStop(1, withAlpha(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // box border + scale bar
    ctx.save();
    ctx.strokeStyle = 'rgba(150,180,220,0.22)';
    roundRect(ctx, x + 0.5, y + 0.5, s - 1, s - 1, 6);
    ctx.stroke();
    const bar = niceLen(span * 0.35);
    const bpx = bar * k;
    ctx.strokeStyle = TOKENS.ink2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + s - 7);
    ctx.lineTo(x + 6 + bpx, y + s - 7);
    ctx.stroke();
    ctx.restore();
    txt(this.c.ctx, fmtUm(bar), x + 6, y + s - 11, { color: TOKENS.ink2, size: 9.5 });
    txt(this.c.ctx, s >= 70 ? `${um(Sx)} × ${um(Sy)} µm` : `${um(Sx)}×${um(Sy)}`, x + s / 2, y + 13, { color: L.color === TOKENS.old ? TOKENS.ink2 : L.color, size: s >= 70 ? 9.5 : 9, align: 'center', weight: 600 });
  }

  /** slit mask (beam's-eye view) with |μ(Δ)| centred on the first slit */
  private slits(L: Lane, x: number, y: number, w: number, h: number): void {
    const ctx = this.c.ctx;
    const p = this.p;
    const spec = p.depth === 'specialist';
    const vert = p.plane === 'y';
    const info = L.info;
    const xiD = info.xi / p.d;
    ctx.save();
    ctx.fillStyle = '#0c1320';
    roundRect(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,180,220,0.22)';
    ctx.stroke();
    ctx.clip();
    const a = P.SLIT_WIDTH_OVER_D;
    // across-axis geometry in units of d (span ±0.95)
    const across = vert ? h : w;
    const S = (across - 14) / 1.9; // px per d
    const c0x = x + w / 2;
    const c0y = y + h / 2;
    // slits
    ctx.fillStyle = 'rgba(233,238,245,0.9)';
    for (const sgn of [-1, 1]) {
      const c = sgn * 0.5;
      if (!vert) ctx.fillRect(c0x + (c - a / 2) * S, y + 8, a * S, h - 16);
      else ctx.fillRect(x + 8, c0y - (c + a / 2) * S, w - 16, a * S);
    }
    // degree of coherence relative to slit 1 (left / bottom)
    const amp = (vert ? w : h) * 0.62;
    const base = vert ? x + 6 : y + h - 6;
    const N = 90;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const c = -0.95 + (1.9 * i) / N;
      const m = Math.exp(-((c + 0.5) * (c + 0.5)) / (2 * xiD * xiD));
      const px = vert ? base + m * amp : c0x + c * S;
      const py = vert ? c0y - c * S : base - m * amp;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = L.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (vert) {
      ctx.lineTo(base, c0y - 0.95 * S);
      ctx.lineTo(base, c0y + 0.95 * S);
    } else {
      ctx.lineTo(c0x + 0.95 * S, base);
      ctx.lineTo(c0x - 0.95 * S, base);
    }
    ctx.closePath();
    ctx.fillStyle = withAlpha(L.color, 0.2);
    ctx.fill();
    // marker at the second slit
    const m2 = info.mu;
    const dx = vert ? base + m2 * amp : c0x + 0.5 * S;
    const dy = vert ? c0y - 0.5 * S : base - m2 * amp;
    ctx.fillStyle = TOKENS.bg;
    ctx.beginPath();
    ctx.arc(dx, dy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = L.color;
    ctx.beginPath();
    ctx.arc(dx, dy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const muTxt = spec ? `|μ₁₂| = ${m2 < 0.005 ? '0.00' : m2.toFixed(2)}` : `${Math.round(m2 * 100)}% in step`;
    // place the label clear of the bell: highest point of the curve over the label's extent (units of d)
    ctx.save();
    ctx.font = `700 10.5px ${TOKENS.font}`;
    const tw = ctx.measureText(muTxt).width;
    ctx.restore();
    const bellMax = (c0: number, c1: number) => {
      // the bell peaks at c = −0.5 (slit 1) and falls off monotonically on either side
      const c = Math.max(c0, Math.min(c1, -0.5));
      return Math.exp(-((c + 0.5) * (c + 0.5)) / (2 * xiD * xiD));
    };
    if (!vert) {
      const half = (tw / 2 + 3) / S;
      const mm = bellMax(-half, half);
      const ly = Math.max(y + 30, Math.min(base - 18, base - mm * amp - 7));
      txt(ctx, muTxt, c0x, ly, { color: L.color, size: 10.5, weight: 700, halo: true, align: 'center' });
    } else {
      const half = 8 / S; // half the text height, in units of d
      const mm = bellMax(-half, half);
      const xr = base + mm * amp + 6; // just right of the curve …
      // … or just left of it (inside the shaded area): lowest point of the curve over the text height, which is
      // at the end farther from slit 1
      const cFar = Math.abs(-half + 0.5) > Math.abs(half + 0.5) ? -half : half;
      const xl = base + Math.exp(-((cFar + 0.5) * (cFar + 0.5)) / (2 * xiD * xiD)) * amp - 6;
      if (xr + tw <= x + w - 4) txt(ctx, muTxt, xr, c0y + 4, { color: L.color, size: 10.5, weight: 700, halo: true, align: 'left' });
      else if (xl - tw >= x + 4) txt(ctx, muTxt, xl, c0y + 4, { color: L.color, size: 10.5, weight: 700, halo: true, align: 'right' });
      else txt(ctx, muTxt, x + w / 2, c0y + 4, { color: L.color, size: 10.5, weight: 700, halo: true, align: 'center' });
    }
    // d bracket
    if (!vert) {
      const by = y + 13;
      ctx.save();
      ctx.strokeStyle = TOKENS.ink3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c0x - 0.5 * S, by);
      ctx.lineTo(c0x + 0.5 * S, by);
      ctx.stroke();
      ctx.restore();
      txt(ctx, `d ${fmtUm(p.d)}`, c0x, by - 3, { color: TOKENS.ink2, size: 9.5, align: 'center', halo: true });
    } else {
      txt(ctx, `d ${fmtUm(p.d)}`, x + w - 6, y + 12, { color: TOKENS.ink2, size: 9.5, align: 'right', halo: true });
    }
  }

  /** detector: static frame (border) + the live image; the image part is repainted every frame */
  private screen(L: Lane, x: number, y: number, w: number, h: number): void {
    const ctx = this.c.ctx;
    this.scr.push({ L, x, y, w, h });
    this.screenImage(L, x, y, w, h);
    ctx.save();
    ctx.strokeStyle = 'rgba(150,180,220,0.22)';
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 6);
    ctx.stroke();
    ctx.restore();
  }

  /** accumulated photons + expected profile, clipped inside the detector border */
  private screenImage(L: Lane, x: number, y: number, w: number, h: number): void {
    const ctx = this.c.ctx;
    const vert = this.p.plane === 'y';
    const off = L.render(this.p.plane);
    ctx.save();
    roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 5.5);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, x, y, w, h);
    // expected profile overlay
    let mx = 0;
    for (let i = 0; i < NP; i++) if (L.pdf[i] > mx) mx = L.pdf[i];
    const inv = mx > 0 ? 1 / mx : 0;
    ctx.beginPath();
    for (let i = 0; i < NP; i += 2) {
      const t = i / (NP - 1);
      const v = L.pdf[i] * inv;
      const px = vert ? x + w - 4 - v * w * 0.3 : x + t * w;
      const py = vert ? y + h - t * h : y + h - 4 - v * h * 0.3;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }
}

// ------------------------------------------------------------------ helpers

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e−9). */
function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  if (x1 - x0 < 6) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - 5, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - 6, y1 - 3.5);
  ctx.lineTo(x1 - 6, y1 + 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function fmtUm(m: number): string {
  const u = m * 1e6;
  if (u >= 1000) return `${(u / 1000).toFixed(u >= 1e4 ? 0 : 1)} mm`;
  if (u >= 100) return `${Math.round(u)} µm`;
  if (u >= 10) return `${u.toFixed(0)} µm`;
  if (u >= 1) return `${u.toFixed(1)} µm`;
  return `${u.toFixed(2)} µm`;
}

function um(m: number): string {
  const u = m * 1e6;
  return u >= 10 ? u.toFixed(0) : u.toFixed(1);
}

function niceLen(m: number): number {
  const e = Math.floor(Math.log10(m));
  const b = Math.pow(10, e);
  const f = m / b;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * b;
}

const alphaCache = new Map<string, string>();
export function withAlpha(hex: string, a: number): string {
  const key = `${hex}|${a.toFixed(3)}`;
  let v = alphaCache.get(key);
  if (v) return v;
  let r = 255;
  let g = 255;
  let b = 255;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const m3 = /^#?([0-9a-f]{3})$/i.exec(hex.trim());
    if (m3) {
      const s = m3[1];
      r = parseInt(s[0] + s[0], 16);
      g = parseInt(s[1] + s[1], 16);
      b = parseInt(s[2] + s[2], 16);
    }
  }
  v = `rgba(${r},${g},${b},${a})`;
  alphaCache.set(key, v);
  return v;
}
