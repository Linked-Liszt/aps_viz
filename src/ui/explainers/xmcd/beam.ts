/**
 * View 1 — "Twist the light": the beam travelling left → right in a cabinet projection.
 *   undulator (linear-H) → diamond quarter-wave plate(s) → polarized wave → FePt film (grain mosaic, M arrow),
 *   optional diamond anvils around the sample, and a head-on inset showing the path of the E-vector tip.
 * World axes: z along the beam (screen right), X horizontal transverse (pointing away from the viewer, drawn
 * receding up-right), Y vertical. Viewed facing the oncoming beam, X is to the right and Y up, so positive helicity
 * (LCP, optics convention) turns counter-clockwise in the inset.
 * Wavelength and amplitude on screen are of course not to scale (λ ≈ 1 Å).
 */
import { TOKENS, type Canvas2D } from '../kit';
import * as P from './physics';
import { COL, arrow, arrowHead, beamColor, rgba, textW, txt } from './draw';

/** screen offset per unit X (horizontal transverse) */
const PX = 0.55;
const PY = -0.3;
/** depth buckets for the wave strokes, and the point buffer size (2 px spacing → canvases up to ~3000 px) */
const NB = 7;
const MAXPTS = 1600;

export interface BeamState {
  /** displayed retardance after the plate(s), rad */
  delta: number;
  /** displayed plate rock in units of the quarter-wave offset (sign = side of the Bragg peak) */
  rock: number;
  /** 0 = plate in the beam, 1 = moved out (linear-H) */
  retract: number;
  /** 0..1 visibility of the second plate (linear-V = two quarter-wave plates) */
  second: number;
  /** labels for the plate and wave */
  plateLabel: string;
  plateSub: string;
  waveLabel: string;
  waveSub: string;
  /** magnetization along the beam (units of M_s(0,0)) and spontaneous magnitude */
  m: number;
  m0: number;
  grains: Int8Array;
  pressure: number;
}

export class BeamView {
  private c: Canvas2D;
  private accent: string;
  private t = 0;
  private norm = 1;
  /** scratch: (x, y, near) per wave point, reused every frame */
  private pts = new Float32Array(3 * MAXPTS);
  speed = 1;

  constructor(c: Canvas2D, accent: string) {
    this.c = c;
    this.accent = accent;
  }

  draw(s: BeamState, dt: number): void {
    this.t += dt * this.speed;
    const { ctx, w, h } = this.c;
    ctx.save();
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);

    const compact = w < 620;
    const A = Math.max(24, Math.min(58, h * 0.15, w * 0.075));
    const axisY = Math.round(h * 0.6);
    const xU0 = 12;
    const xU1 = compact ? 50 : Math.min(120, w * 0.1);
    const xP = compact ? w * 0.27 : w * 0.3;
    const plateGap = Math.max(30, w * 0.06);
    const xS = w - (compact ? 46 : Math.max(70, w * 0.085));
    const sHalf = A * 1.15; // half side of the sample film
    const lamS = Math.max(56, Math.min(110, w * 0.1)); // on-screen wavelength
    const k = (2 * Math.PI) / lamS;
    const omega = 2 * Math.PI * 0.55;
    const phase0 = omega * this.t;

    // ---------- floor (horizontal plane) to cue the 3D view
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(120,150,200,0.045)';
    ctx.beginPath();
    ctx.moveTo(xU0 - A * PX, axisY - A * PY);
    ctx.lineTo(xS - A * PX, axisY - A * PY);
    ctx.lineTo(xS + A * PX, axisY + A * PY);
    ctx.lineTo(xU0 + A * PX, axisY + A * PY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,170,210,0.10)';
    ctx.lineWidth = 1;
    for (let x = xU0 + 20; x < xS - 10; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x - A * PX, axisY - A * PY);
      ctx.lineTo(x + A * PX, axisY + A * PY);
      ctx.stroke();
    }

    // ---------- undulator glyph
    this.undulator(xU0, xU1, axisY, A);

    // ---------- beam axis
    ctx.strokeStyle = 'rgba(200,225,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(xU1 + 2, axisY);
    ctx.lineTo(xS, axisY);
    ctx.stroke();
    ctx.setLineDash([]);

    // ---------- waves
    const pol = P.polarization(s.delta);
    const plateIn = 1 - s.retract;
    const xP2 = xP + plateGap;
    const twoPlates = s.second > 0.5;
    const xAfter = twoPlates ? xP2 : xP;
    // before the plate: linear-H
    this.norm = 1;
    this.wave(xU1 + 4, xP - 4, axisY, A, k, phase0, [1, 0], [0, 0], COL.linear, 0.8);
    if (twoPlates) {
      const mid = P.polarization(s.delta / 2);
      this.norm = normOf(mid);
      this.wave(xP + 4, xP2 - 4, axisY, A, k, phase0, mid.ex, mid.ey, beamColor(mid.pc), 0.9);
    }
    this.norm = normOf(pol);
    this.wave(xAfter + 4, xS - 8, axisY, A, k, phase0, pol.ex, pol.ey, beamColor(pol.pc), 1);

    // ---------- plate(s)
    this.plate(xP, axisY, A, s.rock, plateIn);
    if (s.second > 0.01) this.plate(xP2, axisY, A, s.rock, s.second * plateIn);

    // ---------- sample, anvils, magnetization
    this.sample(xS, axisY, sHalf, s);

    // ---------- head-on inset (above the wave, clear of the plate and of the M arrow over the sample)
    const R = compact ? Math.max(24, Math.min(34, h * 0.13)) : Math.max(26, Math.min(40, h * 0.14));
    const title = 'head-on view of the E field';
    const tw = textW(ctx, title, { size: 10.5, weight: 600 }) / 2 + 4;
    let icx = compact ? (xP + xS) / 2 + 6 : xP + (xS - xP) * 0.56;
    icx = Math.max(tw, R + 10, Math.min(w - tw, w - R - 22, icx));
    // compact: start below the HTML canvas label that runs across the top-left
    const icy = compact ? 40 + 13 + R : 24 + R + 14;
    this.inset(icx, icy, R, pol, k * xS - phase0, title);

    // ---------- labels along the bottom
    // on narrow canvases the wave's label gets its own row above the component labels
    const yl = h - 22;
    const yw = compact ? h - 54 : yl;
    const items: Lbl[] = [
      { x: (xU0 + xU1) / 2, y: yl, main: 'undulator', sub: 'flat, side to side', pri: 4 },
      { x: twoPlates ? (xP + xP2) / 2 : xP, y: yl, main: s.plateLabel, sub: s.plateSub, pri: 1 },
      { x: (xAfter + xS) / 2, y: yw, main: s.waveLabel, sub: s.waveSub, pri: 0, color: beamColor(pol.pc) },
      { x: xS, y: yl, main: 'magnet: FePt film', sub: 'Pt edge 11.56 keV', pri: 2 },
    ];
    this.labels(items, w);
    ctx.restore();
  }

  /**
   * One stretch of the wave: E-vector stems from the axis, a soft glow and the depth-shaded tip curve.
   * Segments are grouped into NB depth buckets (one stroke each) so a frame issues ~a dozen strokes, not hundreds.
   */
  private wave(x0: number, x1: number, axisY: number, A: number, k: number, ph0: number, ex: [number, number], ey: [number, number], color: string, alpha: number): void {
    const { ctx } = this.c;
    if (x1 - x0 < 4) return;
    const sc = A / this.norm;
    const fine = 2;
    const m = Math.min(MAXPTS, Math.floor((x1 - x0) / fine) + 1);
    const P = this.pts;
    for (let i = 0; i < m; i++) {
      const x = x0 + i * fine;
      const ph = k * x - ph0;
      const c = Math.cos(ph);
      const sn = Math.sin(ph);
      const EX = (ex[0] * c - ex[1] * sn) * sc;
      const EY = (ey[0] * c - ey[1] * sn) * sc;
      P[3 * i] = x + EX * PX;
      P[3 * i + 1] = axisY - EY + EX * PY;
      // 0 = far side (X > 0, into the screen), 1 = near side
      P[3 * i + 2] = Math.max(0, Math.min(1, 0.5 - (0.5 * EX) / A));
    }
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    // stems every 3rd point (6 px)
    ctx.lineWidth = 1;
    for (let b = 0; b < NB; b++) {
      ctx.globalAlpha = alpha * (0.12 + (0.3 * (b + 0.5)) / NB);
      ctx.beginPath();
      for (let i = 0; i < m; i += 3) {
        if (Math.min(NB - 1, Math.floor(P[3 * i + 2] * NB)) !== b) continue;
        ctx.moveTo(x0 + i * fine, axisY);
        ctx.lineTo(P[3 * i], P[3 * i + 1]);
      }
      ctx.stroke();
    }
    // soft glow
    ctx.globalAlpha = alpha * 0.16;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(P[0], P[1]);
    for (let i = 1; i < m; i++) ctx.lineTo(P[3 * i], P[3 * i + 1]);
    ctx.stroke();
    // depth-shaded tip curve
    for (let b = 0; b < NB; b++) {
      const near = (b + 0.5) / NB;
      ctx.globalAlpha = alpha * (0.35 + 0.65 * near);
      ctx.lineWidth = 1.4 + 1.4 * near;
      ctx.beginPath();
      let open = false;
      for (let i = 1; i < m; i++) {
        const nb = Math.min(NB - 1, Math.floor(0.5 * (P[3 * i + 2] + P[3 * i - 1]) * NB));
        if (nb !== b) {
          open = false;
          continue;
        }
        if (!open) ctx.moveTo(P[3 * i - 3], P[3 * i - 2]);
        ctx.lineTo(P[3 * i], P[3 * i + 1]);
        open = true;
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private undulator(x0: number, x1: number, axisY: number, A: number): void {
    const { ctx } = this.c;
    const n = Math.max(4, Math.floor((x1 - x0) / 8));
    const bw = (x1 - x0) / n;
    const gap = A * 0.55;
    const bh = Math.max(7, A * 0.32);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * bw;
      ctx.fillStyle = i % 2 ? 'rgba(248,113,113,0.55)' : 'rgba(96,165,250,0.55)';
      ctx.fillRect(x + 0.5, axisY - gap - bh, bw - 1, bh);
      ctx.fillStyle = i % 2 ? 'rgba(96,165,250,0.55)' : 'rgba(248,113,113,0.55)';
      ctx.fillRect(x + 0.5, axisY + gap, bw - 1, bh);
    }
    // electron wiggle (horizontal plane → drawn along the receding X direction)
    ctx.strokeStyle = rgba(TOKENS.electron, 0.8);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 1) {
      const X = Math.sin(((x - x0) / bw) * Math.PI) * A * 0.22;
      const px = x + X * PX;
      const py = axisY + X * PY;
      if (x === x0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  /** A thin diamond slab whose normal is tilted (in the 45° scattering plane) by a base angle plus the rock. */
  private plate(x: number, axisY: number, A: number, rock: number, vis: number): void {
    if (vis <= 0.01) return;
    const { ctx } = this.c;
    const lift = (1 - vis) * A * 2.2; // slides up out of the beam when retracted
    const base = 0.42; // rad, schematic tilt of the plate normal from the beam
    const a = base + Math.max(-3.5, Math.min(3.5, rock)) * 0.075;
    // 3D: normal n = cos a ẑ + sin a ê45 ; ê45 = (X̂ + Ŷ)/√2 ; u1 = cos a ê45 − sin a ẑ ; u2 = (−X̂ + Ŷ)/√2
    const r2 = Math.SQRT1_2;
    const proj = (z: number, X: number, Y: number): [number, number] => [x + z + X * PX, axisY - lift - Y + X * PY];
    const s = A * 1.25;
    const u1 = { z: -Math.sin(a), X: Math.cos(a) * r2, Y: Math.cos(a) * r2 };
    const u2 = { z: 0, X: -r2, Y: r2 };
    const n = { z: Math.cos(a), X: Math.sin(a) * r2, Y: Math.sin(a) * r2 };
    const th = 3.5;
    const corner = (i: number, j: number, f: number): [number, number] =>
      proj(i * s * u1.z + j * s * u2.z + f * th * n.z, i * s * u1.X + j * s * u2.X + f * th * n.X, i * s * u1.Y + j * s * u2.Y + f * th * n.Y);
    ctx.globalAlpha = vis;
    // back face
    const quad = (f: number) => {
      const p = [corner(-1, -1, f), corner(1, -1, f), corner(1, 1, f), corner(-1, 1, f)];
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
      ctx.closePath();
    };
    quad(-1);
    ctx.fillStyle = 'rgba(170,215,255,0.07)';
    ctx.fill();
    // edges connecting faces
    ctx.strokeStyle = 'rgba(200,232,255,0.35)';
    ctx.lineWidth = 1;
    for (const [i, j] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const p0 = corner(i, j, -1);
      const p1 = corner(i, j, 1);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
    quad(1);
    const g = ctx.createLinearGradient(x - s, axisY - s, x + s, axisY + s);
    g.addColorStop(0, 'rgba(210,240,255,0.22)');
    g.addColorStop(0.5, 'rgba(160,210,255,0.08)');
    g.addColorStop(1, 'rgba(210,240,255,0.18)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,240,255,0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // a sparkle: lattice-plane hatching on the front face
    ctx.strokeStyle = 'rgba(220,240,255,0.16)';
    ctx.lineWidth = 1;
    for (let q = -0.6; q <= 0.61; q += 0.3) {
      const p0 = corner(q, -0.92, 1);
      const p1 = corner(q, 0.92, 1);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private sample(xS: number, axisY: number, s: number, st: BeamState): void {
    const { ctx, dpr } = this.c;
    const th = 4; // half thickness along z
    // anvils (behind / in front of the film along the beam)
    const pv = Math.max(0, Math.min(1, st.pressure / 12));
    if (pv > 0.01) {
      this.anvil(xS - th, axisY, s, -1, pv);
    }
    // the film: in this projection the visible faces are the top (Y = +s), the near side (X = −s) and the
    // downstream face (z = +th), which carries the grain mosaic
    const P0 = (z: number, X: number, Y: number): [number, number] => [xS + z + X * PX, axisY - Y + X * PY];
    const poly = (pts: [number, number][], fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fill();
    };
    poly([P0(-th, -s, s), P0(th, -s, s), P0(th, s, s), P0(-th, s, s)], 'rgba(78,92,116,0.95)');
    poly([P0(-th, -s, -s), P0(th, -s, -s), P0(th, -s, s), P0(-th, -s, s)], 'rgba(48,58,76,0.95)');
    const o = P0(th, -s, -s);
    const nG = Math.round(Math.sqrt(st.grains.length));
    const cell = (2 * s) / nG;
    ctx.save();
    ctx.setTransform(dpr * PX, dpr * PY, 0, -dpr, dpr * o[0], dpr * o[1]);
    ctx.fillStyle = '#121a28';
    ctx.fillRect(0, 0, 2 * s, 2 * s);
    const mag = Math.min(1, st.m0);
    for (let j = 0; j < nG; j++) {
      for (let i = 0; i < nG; i++) {
        const g = st.grains[j * nG + i];
        ctx.fillStyle = g > 0 ? this.accent : COL.against;
        ctx.globalAlpha = mag < 0.01 ? 0.1 : 0.12 + 0.78 * mag;
        ctx.fillRect(i * cell + 0.6, j * cell + 0.6, cell - 1.2, cell - 1.2);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    const fr = [P0(th, -s, -s), P0(th, s, -s), P0(th, s, s), P0(th, -s, s)];
    ctx.strokeStyle = 'rgba(200,215,235,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    fr.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.stroke();
    if (pv > 0.01) this.anvil(xS + th, axisY, s, 1, pv);

    // magnetization arrow, above the film, along ±z (kept inside the canvas)
    const L = 30 + 26 * Math.min(1, Math.abs(st.m));
    const y = axisY - s - s * 0.35 - 14;
    const ax = Math.min(xS + 6, this.c.w - 4 - 18 - 28);
    if (Math.abs(st.m) > 0.02) {
      const dir = Math.sign(st.m);
      const len = L * Math.min(1, 0.25 + Math.abs(st.m));
      ctx.strokeStyle = this.accent;
      ctx.fillStyle = this.accent;
      ctx.globalAlpha = 0.25 + 0.75 * Math.min(1, Math.abs(st.m) * 1.4);
      arrow(ctx, ax - (dir * len) / 2, y, ax + (dir * len) / 2, y, 9, 2.6);
      ctx.globalAlpha = 1;
      txt(ctx, 'M', ax + (dir * len) / 2 + dir * 6, y + 4, { color: this.accent, size: 12, weight: 700, align: dir > 0 ? 'left' : 'right' });
    } else {
      txt(ctx, 'M ≈ 0', ax, y + 4, { color: TOKENS.ink3, size: 11, weight: 600, align: 'center' });
    }
  }

  /** Side silhouette of a brilliant-cut anvil with its culet on the film; dir = −1 upstream, +1 downstream. */
  private anvil(x: number, axisY: number, s: number, dir: number, vis: number): void {
    const { ctx } = this.c;
    const L = s * 1.15;
    const c = s * 0.32; // culet half-height
    const g = s * 1.0; // girdle half-height
    const tb = s * 0.62; // table half-height
    const pts: [number, number][] = [
      [0, -c],
      [0.62 * L, -g],
      [0.78 * L, -g],
      [L, -tb],
      [L, tb],
      [0.78 * L, g],
      [0.62 * L, g],
      [0, c],
    ];
    ctx.globalAlpha = vis;
    ctx.beginPath();
    pts.forEach(([u, v], i) => (i ? ctx.lineTo(x + dir * u, axisY + v) : ctx.moveTo(x + dir * u, axisY + v)));
    ctx.closePath();
    ctx.fillStyle = `${COL.anvil}0.12)`;
    ctx.fill();
    ctx.strokeStyle = `${COL.anvil}0.6)`;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.strokeStyle = `${COL.anvil}0.22)`;
    ctx.beginPath();
    ctx.moveTo(x + dir * 0.62 * L, axisY - g);
    ctx.lineTo(x + dir * L, axisY + tb * 0.2);
    ctx.moveTo(x + dir * 0.62 * L, axisY + g);
    ctx.lineTo(x + dir * L, axisY - tb * 0.2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private inset(cx: number, cy: number, R: number, pol: P.Polarization, phAtSample: number, title: string): void {
    const { ctx } = this.c;
    ctx.save();
    // disc
    ctx.fillStyle = 'rgba(14,21,33,0.92)';
    ctx.strokeStyle = 'rgba(150,180,220,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // axes: X right, Y up (facing the source)
    ctx.strokeStyle = 'rgba(150,180,220,0.22)';
    ctx.beginPath();
    ctx.moveTo(cx - R - 4, cy);
    ctx.lineTo(cx + R + 4, cy);
    ctx.moveTo(cx, cy - R - 4);
    ctx.lineTo(cx, cy + R + 4);
    ctx.stroke();
    {
      // the diamond's two diagonal axes (σ at 45°, π at 135°): the components it delays against each other
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(200,232,255,0.35)';
      const d = (R + 2) * Math.SQRT1_2;
      ctx.beginPath();
      ctx.moveTo(cx - d, cy + d);
      ctx.lineTo(cx + d, cy - d);
      ctx.moveTo(cx + d, cy + d);
      ctx.lineTo(cx - d, cy - d);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const col = beamColor(pol.pc);
    const norm = normOf(pol);
    const sc = R / norm;
    // trace
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const ph = (i / 64) * Math.PI * 2;
      const c = Math.cos(ph);
      const sn = Math.sin(ph);
      const x = cx + (pol.ex[0] * c - pol.ex[1] * sn) * sc;
      const y = cy - (pol.ey[0] * c - pol.ey[1] * sn) * sc;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // rotation sense: arrowheads where the tip is heading as time advances (φ decreases)
    ctx.fillStyle = col;
    if (Math.abs(pol.pc) > 0.08) {
      for (const ph of [0.9, 0.9 + Math.PI]) {
        const [x0, y0] = field(pol, ph);
        const [x1, y1] = field(pol, ph - 0.12);
        arrowHead(ctx, cx + x1 * sc, cy - y1 * sc, Math.atan2(-(y1 - y0), x1 - x0), 7);
      }
    }
    // the live E vector
    const [ex, ey] = field(pol, phAtSample);
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    arrow(ctx, cx, cy, cx + ex * sc, cy - ey * sc, 7, 2);
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();
    // captions
    txt(ctx, title, cx, cy - R - 13, { size: 10.5, color: TOKENS.ink3, align: 'center', weight: 600 });
    txt(ctx, 'H', cx + R + 12, cy + 4, { size: 10, color: TOKENS.ink3, align: 'left' });
    txt(ctx, 'V', cx, cy + R + 20, { size: 10, color: TOKENS.ink3, align: 'center' });
    ctx.restore();
  }

  /** Two-line labels, placed by priority; a label that would overlap one already placed on its row is dropped. */
  private labels(items: Lbl[], w: number): void {
    const { ctx } = this.c;
    const mainO = { size: 11.5, weight: 650 };
    const subO = { size: 10.5, weight: 500 };
    const placed: { l: number; r: number; y: number }[] = [];
    const order = [...items].sort((a, b) => a.pri - b.pri);
    for (const it of order) {
      const wd = Math.max(textW(ctx, it.main, mainO), textW(ctx, it.sub, subO));
      let l = Math.max(4, Math.min(w - 4 - wd, it.x - wd / 2));
      const clash = placed.some((p) => Math.abs(p.y - it.y) < 28 && l < p.r + 8 && l + wd > p.l - 8);
      if (clash) continue;
      placed.push({ l, r: l + wd, y: it.y });
      l += wd / 2;
      txt(ctx, it.main, l, it.y, { ...mainO, color: it.color ?? TOKENS.ink, align: 'center' });
      txt(ctx, it.sub, l, it.y + 14, { ...subO, color: TOKENS.ink3, align: 'center' });
    }
  }
}

interface Lbl {
  x: number;
  y: number;
  main: string;
  sub: string;
  /** lower = placed first */
  pri: number;
  color?: string;
}

/** E-field (X, Y) of a polarization state at carrier phase φ. */
function field(p: P.Polarization, ph: number): [number, number] {
  const c = Math.cos(ph);
  const s = Math.sin(ph);
  return [p.ex[0] * c - p.ex[1] * s, p.ey[0] * c - p.ey[1] * s];
}

/** Largest |E| over a cycle (semi-major axis of the polarization ellipse). */
function normOf(p: P.Polarization): number {
  // |E|² over a cycle = a + b cos2φ + c sin2φ → max = a + √(b² + c²)
  const [xr, xi] = p.ex;
  const [yr, yi] = p.ey;
  const a = 0.5 * (xr * xr + xi * xi + yr * yr + yi * yi);
  const b = 0.5 * (xr * xr - xi * xi + yr * yr - yi * yi);
  const c = -(xr * xi + yr * yi);
  return Math.max(1e-6, Math.sqrt(a + Math.hypot(b, c)));
}

