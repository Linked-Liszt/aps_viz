/**
 * Panel 1. One sector of the ring seen from above, with an animated stream of electrons.
 *
 * Top: the reference orbit through the sector's magnets (bends drawn EXAG× sharper so the 9° turn is visible).
 * Electrons carry a relative energy offset δ (colour: amber = more energy, violet = less) and sit at
 *     x = η(s)·δ + x_β,
 * Energy-dependent offsets follow the dispersion η(s) and return to zero at the next straight
 * (the achromat condition). Electrons emit X-ray photons in the bends at a rate ∝ |B| (photons per unit length
 * ∝ γ/ρ ∝ B at fixed E). Each emission removes energy du from the electron while its position stays put, so its
 * betatron offset jumps by Δx_β = η(s)·du. Quantum excitation: a photon emitted where η is large leaves the
 * electron oscillating transversely. The oscillation damps (radiation damping) and δ relaxes back (rf). Amplitudes, rates and the
 * damping time are illustrative (exaggerated), not to scale.
 *
 * Bottom: η_x(s) along the sector (APS-U: digitised FDR Fig. 2.2; others: thin-lens model), bends shaded.
 */
import { TOKENS, plotFrame, type Canvas2D } from '../kit';
import * as P from './physics';

/** bends are drawn this many times sharper */
export const EXAG = 7;
export const COL = {
  bend: '#4c7dff',
  bendEdge: '#a9c0ff',
  reverse: '#f472b6',
  quad: '#ef5350',
  sext: '#4ade80',
  hi: '#ffb547',
  lo: '#a78bfa',
};

const NB = 17; // colour buckets for δ
const DMAX = 2.2;

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** CSS colours for δ buckets: violet (−) → white → amber (+) */
const BUCKETS: string[] = (() => {
  const lo = hexRgb(COL.lo);
  const hi = hexRgb(COL.hi);
  const mid: [number, number, number] = [244, 247, 251];
  const out: string[] = [];
  for (let b = 0; b < NB; b++) {
    const t = (b / (NB - 1)) * 2 - 1;
    const a = t < 0 ? lo : hi;
    const f = Math.abs(t);
    out.push(`rgb(${Math.round(mid[0] + (a[0] - mid[0]) * f)},${Math.round(mid[1] + (a[1] - mid[1]) * f)},${Math.round(mid[2] + (a[2] - mid[2]) * f)})`);
  }
  return out;
})();

const bucketOf = (d: number) => Math.max(0, Math.min(NB - 1, Math.round(((d / DMAX + 1) / 2) * (NB - 1))));

export class SectorView {
  private lat: P.Lattice;
  private E: number;
  private layer: HTMLCanvasElement = document.createElement('canvas');
  private layerOk = false;
  // geometry, CSS px
  private n = 0;
  private gds = 0.02;
  private gx = new Float32Array(0);
  private gy = new Float32Array(0);
  private tx = new Float32Array(0);
  private ty = new Float32Array(0);
  private nx = new Float32Array(0);
  private ny = new Float32Array(0);
  private geta = new Float32Array(0);
  private gB = new Float32Array(0);
  private G = 60; // px per (m of η · 1σ of δ)
  private drawBox = { x: 0, y: 0, w: 1, h: 1 };
  // electrons
  private readonly NP = 84;
  private ps = new Float32Array(this.NP);
  private d0 = new Float32Array(this.NP);
  private dd = new Float32Array(this.NP);
  private c1 = new Float32Array(this.NP);
  private c2 = new Float32Array(this.NP);
  private ph = new Float32Array(this.NP);
  // photons (ring buffer)
  private readonly NPH = 96;
  private fx = new Float32Array(this.NPH);
  private fy = new Float32Array(this.NPH);
  private fdx = new Float32Array(this.NPH);
  private fdy = new Float32Array(this.NPH);
  private fage = new Float32Array(this.NPH).fill(99);
  private fa = new Float32Array(this.NPH);
  private fi = 0;
  private seed = 12345;
  /** photons emitted per (T · m) of path, per electron (illustrative) */
  private readonly kEmit = 0.55;

  constructor(
    private c: Canvas2D,
    private accent: string,
    lat: P.Lattice,
    E: number,
  ) {
    this.lat = lat;
    this.E = E;
    for (let i = 0; i < this.NP; i++) {
      this.ps[i] = ((i + this.rnd()) / this.NP) * lat.C;
      let d = this.gauss();
      d = Math.max(-DMAX, Math.min(DMAX, d));
      this.d0[i] = d;
      this.dd[i] = d;
      this.ph[i] = this.rnd() * Math.PI * 2;
    }
  }

  private rnd(): number {
    // mulberry32
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private gauss(): number {
    const u = Math.max(1e-9, this.rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rnd());
  }

  setLattice(lat: P.Lattice): void {
    if (lat === this.lat) return;
    this.lat = lat;
    this.layerOk = false;
    // a new lattice: settle the wobbles so the comparison starts clean
    this.c1.fill(0);
    this.c2.fill(0);
    this.fage.fill(99);
  }

  setEnergy(E: number): void {
    if (E === this.E) return;
    this.E = E;
    this.layerOk = false;
  }

  invalidate(): void {
    this.layerOk = false;
  }

  /** layout: [kit label + header] / drawing / legend (+ footnote) / η strip */
  private split(): { headTop: number; inlineHead: boolean; drawTop: number; drawBot: number; legendTop: number; stripTop: number } {
    const h = this.c.h;
    const inlineHead = this.c.w >= 700;
    // the kit's panel label occupies y ≈ 0..20 at the top-left
    const headTop = inlineHead ? 4 : 22;
    const extra = inlineHead ? 0 : this.headerLines().sub.length - 1;
    const drawTop = (inlineHead ? 40 : 58) + 15 * extra;
    const stripH = Math.max(120, Math.min(200, Math.round(h * 0.36)));
    const stripTop = h - stripH;
    const legendTop = stripTop - 6 - this.legendRows() * 15;
    return { headTop, inlineHead, drawTop, drawBot: legendTop - 2, legendTop, stripTop };
  }

  private legendItems(): { color: string; label: string; kind: 'box' | 'dot' | 'line' | 'text' }[] {
    // a short canvas gets the compact wording (one legend row leaves more room for the drawing)
    const full = this.c.w >= 900;
    const items: { color: string; label: string; kind: 'box' | 'dot' | 'line' | 'text' }[] = [
      { color: COL.bend, label: full ? "dipole bend" : 'bend', kind: 'box' },
      { color: COL.reverse, label: 'backward bend', kind: 'box' },
      { color: COL.quad, label: full ? "quadrupole focusing" : 'focusing', kind: 'box' },
      { color: COL.sext, label: full ? "sextupole correction" : 'corrector', kind: 'box' },
      { color: TOKENS.xray, label: full ? 'X-ray photon' : 'photon', kind: 'line' },
      { color: COL.hi, label: full ? 'e⁻ with more energy' : 'e⁻ more energy', kind: 'dot' },
      { color: COL.lo, label: 'less', kind: 'dot' },
    ];
    if (this.lat.id !== 'apsu') items.splice(1, 1);
    items.push({ color: TOKENS.ink3, label: full ? `· bend angles ${EXAG}× larger, energy-dependent offsets enlarged` : `· bend angles ${EXAG}× larger, offsets enlarged`, kind: 'text' });
    return items;
  }

  private legendRows(): number {
    const ctx = this.c.ctx;
    ctx.save();
    ctx.font = `500 10.5px ${TOKENS.font}`;
    let rows = 1;
    let x = 10;
    for (const it of this.legendItems()) {
      const wI = (it.kind === 'text' ? 0 : 14) + ctx.measureText(it.label).width + 12;
      if (x + wI > this.c.w - 8) {
        rows++;
        x = 10;
      }
      x += wI;
    }
    ctx.restore();
    return rows;
  }

  private buildGeometry(): void {
    const lat = this.lat;
    const C = lat.C;
    const ds = this.gds;
    const n = Math.ceil(C / ds) + 1;
    this.n = n;
    const X = new Float64Array(n);
    const Y = new Float64Array(n);
    const PHI = new Float64Array(n);
    this.gx = new Float32Array(n);
    this.gy = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.ty = new Float32Array(n);
    this.nx = new Float32Array(n);
    this.ny = new Float32Array(n);
    this.geta = new Float32Array(n);
    this.gB = new Float32Array(n);
    const els = lat.elements.filter((e) => e.kind === 'bend' || e.kind === 'reverse');
    let net = 0;
    for (const e of els) net += e.angle;
    const curv = (s: number) => {
      for (const e of els) if (s >= e.s0 && s < e.s1) return e.angle / (e.s1 - e.s0);
      return 0;
    };
    const fieldAt = (s: number) => {
      for (const e of els) if (s >= e.s0 && s < e.s1) return Math.abs(P.fieldOf(e, this.E));
      return 0;
    };
    // y-up integration, clockwise turn (heading decreases)
    let phi = (EXAG * net) / 2;
    let x = 0;
    let y = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.min(i * ds, C);
      X[i] = x;
      Y[i] = y;
      PHI[i] = phi;
      this.geta[i] = P.etaAt(lat, s);
      this.gB[i] = fieldAt(s + ds / 2);
      const k = curv(s + ds / 2) * EXAG;
      // exact arc step
      if (Math.abs(k) > 1e-12) {
        const p1 = phi - k * ds;
        x += (Math.sin(phi) - Math.sin(p1)) / k;
        y += (Math.cos(p1) - Math.cos(phi)) / k;
        phi = p1;
      } else {
        x += Math.cos(phi) * ds;
        y += Math.sin(phi) * ds;
      }
    }
    // fit into the drawing box: the orbit plus the ±2.4σ energy fan of THIS lattice, magnets and end labels
    const { drawTop, drawBot } = this.split();
    const w = this.c.w;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, X[i]);
      maxX = Math.max(maxX, X[i]);
      minY = Math.min(minY, Y[i]);
      maxY = Math.max(maxY, Y[i]);
    }
    const padX = 14;
    const availW = w - 2 * padX;
    const boxH = Math.max(60, drawBot - drawTop);
    // fan scale (px per m of η per σ_δ): fixed for all lattices so fans compare; the old APS peak (0.24 m) 1σ
    // fan is ~3.2 % of the width, capped so that its ±2.4σ fan never takes more than ~40 % of the height
    this.G = Math.min((0.032 * availW) / 0.24, (0.2 * boxH) / (2.4 * 0.24));
    const u = Math.max(4.5, Math.min(8, w / 75));
    const fan = 2.4 * this.G * P.etaMax(lat) + 1.5 * u;
    const mTop = fan + 8;
    const mBot = Math.max(u * 1.6 + 22, fan * 0.35);
    const availH = Math.max(20, boxH - mTop - mBot);
    const sc = Math.min(availW / (maxX - minX), availH / Math.max(1e-6, maxY - minY));
    const ox = padX + (availW - (maxX - minX) * sc) / 2 - minX * sc;
    const extra = Math.max(0, availH - (maxY - minY) * sc);
    const oy = drawTop + mTop + extra * 0.5 + maxY * sc;
    for (let i = 0; i < n; i++) {
      this.gx[i] = ox + X[i] * sc;
      this.gy[i] = oy - Y[i] * sc;
      const c = Math.cos(PHI[i]);
      const s = Math.sin(PHI[i]);
      this.tx[i] = c;
      this.ty[i] = -s;
      // outward normal = left of travel for a clockwise turn (y-up: (−sin, cos)) → canvas (−sin, −cos)
      this.nx[i] = -s;
      this.ny[i] = -c;
    }
    this.drawBox = { x: 0, y: drawTop - 18, w, h: drawBot - drawTop + 18 };
  }

  private idx(s: number): number {
    return Math.max(0, Math.min(this.n - 1, Math.round(s / this.gds)));
  }

  private buildLayer(): void {
    const { c } = this;
    const dpr = c.dpr;
    this.buildGeometry();
    const L = this.layer;
    L.width = Math.round(c.w * dpr);
    L.height = Math.round(c.h * dpr);
    const ctx = L.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.w, c.h);
    this.drawSector(ctx);
    this.drawLegend(ctx);
    this.drawStrip(ctx);
    this.layerOk = true;
  }

  private poly(ctx: CanvasRenderingContext2D, s0: number, s1: number, off0: number, off1: number, minPx = 2.5): void {
    let i0 = this.idx(s0);
    let i1 = this.idx(s1);
    // enforce a minimum drawn length
    const len = Math.hypot(this.gx[i1] - this.gx[i0], this.gy[i1] - this.gy[i0]);
    if (len < minPx) {
      const grow = Math.ceil(((minPx - len) / 2 / Math.max(0.01, len / Math.max(1, i1 - i0 || 1))) || 2);
      i0 = Math.max(0, i0 - grow);
      i1 = Math.min(this.n - 1, i1 + grow);
    }
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) ctx.lineTo(this.gx[i] + this.nx[i] * off1, this.gy[i] + this.ny[i] * off1);
    for (let i = i1; i >= i0; i--) ctx.lineTo(this.gx[i] + this.nx[i] * off0, this.gy[i] + this.ny[i] * off0);
    ctx.closePath();
  }

  private drawSector(ctx: CanvasRenderingContext2D): void {
    const lat = this.lat;
    const C = lat.C;
    const w = this.c.w;
    const u = Math.max(4.5, Math.min(8, w / 75));
    const n = this.n;
    const G = this.G;

    // header lines (the second one wraps at its last " · " when the panel is narrow)
    const hl = this.headerLines();
    const sp = this.split();
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = sp.inlineHead ? 'right' : 'left';
    const hx = sp.inlineHead ? w - 10 : 10;
    ctx.fillStyle = TOKENS.ink;
    ctx.font = `650 ${hl.size}px ${TOKENS.font}`;
    ctx.fillText(hl.title, hx, sp.headTop + 12);
    ctx.fillStyle = TOKENS.ink2;
    ctx.font = `500 11.5px ${TOKENS.font}`;
    hl.sub.forEach((t, i) => ctx.fillText(t, hx, sp.headTop + 28 + 15 * i));
    ctx.restore();

    // X-ray beam from the upstream undulator: straight on along the tangent at s = 0
    {
      const x0 = this.gx[0];
      const y0 = this.gy[0];
      const len = Math.max(30, Math.min(w * 0.42, (y0 - (sp.drawTop + 4)) / Math.max(0.2, -this.ty[0])));
      const x1 = x0 + this.tx[0] * len;
      const y1 = y0 + this.ty[0] * len;
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(92,211,255,0.95)');
      g.addColorStop(1, 'rgba(92,211,255,0)');
      ctx.save();
      ctx.strokeStyle = g;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.shadowColor = TOKENS.xray;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.font = `600 10.5px ${TOKENS.font}`;
      ctx.fillStyle = TOKENS.xray;
      const lx = x0 + this.tx[0] * len * 0.6;
      const ly = y0 + this.ty[0] * len * 0.6;
      ctx.translate(lx, ly);
      ctx.rotate(Math.atan2(this.ty[0], this.tx[0]));
      ctx.textAlign = 'center';
      ctx.fillText(w >= 780 ? 'undulator X-rays → beamline' : 'X-rays → beamline', 0, -(u * 1.5 + 6));
      ctx.restore();
    }

    // energy fan envelope (±2σ)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < n; i += 2) ctx.lineTo(this.gx[i] + this.nx[i] * 2 * G * this.geta[i], this.gy[i] + this.ny[i] * 2 * G * this.geta[i]);
    for (let i = n - 1 - ((n - 1) % 2); i >= 0; i -= 2) ctx.lineTo(this.gx[i] - this.nx[i] * 2 * G * this.geta[i], this.gy[i] - this.ny[i] * 2 * G * this.geta[i]);
    ctx.closePath();
    ctx.fillStyle = hexA(this.accent, 0.13);
    ctx.fill();
    ctx.restore();
    // fan edges
    for (const sgn of [1, -1]) {
      ctx.save();
      ctx.strokeStyle = sgn > 0 ? hexA(COL.hi, 0.45) : hexA(COL.lo, 0.5);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (let i = 0; i < n; i += 2) ctx.lineTo(this.gx[i] + sgn * this.nx[i] * 2 * G * this.geta[i], this.gy[i] + sgn * this.ny[i] * 2 * G * this.geta[i]);
      ctx.stroke();
      ctx.restore();
    }

    // reference orbit
    ctx.save();
    ctx.strokeStyle = 'rgba(233,238,245,0.38)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(this.gx[i], this.gy[i]);
    ctx.stroke();
    ctx.restore();

    // undulators (half of each straight's device is in this sector)
    const und = (sa: number, sb: number) => {
      const per = 0.24;
      let k = 0;
      for (let s = sa; s < sb - 1e-6; s += per / 2, k++) {
        const s2 = Math.min(sb, s + per / 2 - 0.02);
        for (const side of [1, -1]) {
          this.poly(ctx, s, s2, side * (u * 0.55), side * (u * 1.5), 1);
          ctx.fillStyle = (k + (side > 0 ? 0 : 1)) % 2 ? '#7d8ba0' : '#3f4b5c';
          ctx.fill();
        }
      }
    };
    und(0, 1.2);
    und(C - 1.2, C);

    // magnets
    const Bref = 0.7 * (this.E / 6);
    for (const e of lat.elements) {
      const hw = e.kind === 'bend' ? u : e.kind === 'reverse' ? u * 1.15 : e.kind === 'quad' ? u * 1.25 : u * 0.95;
      this.poly(ctx, e.s0, e.s1, -hw, hw);
      if (e.kind === 'bend') {
        const a = 0.3 + 0.7 * Math.min(1, Math.abs(P.fieldOf(e, this.E)) / Bref);
        ctx.fillStyle = hexA(COL.bend, a);
        ctx.fill();
        ctx.strokeStyle = hexA(COL.bendEdge, 0.55);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      } else {
        ctx.fillStyle = e.kind === 'reverse' ? COL.reverse : e.kind === 'quad' ? COL.quad : COL.sext;
        ctx.globalAlpha = e.kind === 'sext' ? 0.85 : 0.95;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // labels: reverse-bend callout, undulator source point
    ctx.save();
    if (lat.id === 'apsu') {
      // reverse-bend callout: centred in the bowl under the apex, leaders to both Q8s (inner side)
      const mid = this.idx(C / 2);
      const etaMid = this.geta[mid];
      const tx = this.gx[mid];
      const ty = this.gy[mid] - this.ny[mid] * (u * 1.4 + 2.4 * G * etaMid + 22);
      ctx.font = `600 10.5px ${TOKENS.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const txt = w >= 780 ? 'backward (reverse) bends' : 'backward bends';
      ctx.strokeStyle = hexA(COL.reverse, 0.7);
      ctx.lineWidth = 1;
      for (const name of ['A:Q8', 'B:Q8']) {
        const q = lat.elements.find((e) => e.magnet === name);
        if (!q) continue;
        const i = this.idx((q.s0 + q.s1) / 2);
        const ax = this.gx[i] - this.nx[i] * (u * 1.2 + 2);
        const ay = this.gy[i] - this.ny[i] * (u * 1.2 + 2);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(tx + (ax < tx ? -1 : 1) * Math.min(40, ctx.measureText(txt).width / 2 - 6), ty - 7);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(5,8,14,0.7)';
      const tw = ctx.measureText(txt).width;
      ctx.fillRect(tx - tw / 2 - 3, ty - 7, tw + 6, 14);
      ctx.fillStyle = COL.reverse;
      ctx.fillText(txt, tx, ty);
    }
    // ends of the sector: ID source point (links to panel 2) and the next straight
    {
      const x0 = this.gx[0];
      const y0 = this.gy[0];
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x0, y0, 5.5, 0, Math.PI * 2);
      ctx.stroke();
      const xr = this.gx[n - 1];
      const yr = this.gy[n - 1];
      // the long names when both fit between the two ends of the sector, short ones otherwise
      const lx = Math.max(6, x0 - 6);
      const rx = Math.min(w - 6, xr + 6);
      const width = (t: string, weight: number) => {
        ctx.font = `${weight} 10.5px ${TOKENS.font}`;
        return ctx.measureText(t).width;
      };
      const [left, right] = [
        ['undulator source point → panel 2', 'next undulator straight'],
        ['source point → panel 2', 'next straight'],
        ['source point → panel 2', ''],
      ].find(([l, r]) => !r || lx + width(l, 700) + 16 + width(r, 500) <= rx)!;
      ctx.fillStyle = this.accent;
      ctx.font = `700 10.5px ${TOKENS.font}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(left, lx, y0 + u * 1.5 + 5);
      ctx.fillStyle = TOKENS.ink3;
      ctx.font = `500 10.5px ${TOKENS.font}`;
      ctx.textAlign = 'right';
      if (right) ctx.fillText(right, rx, yr + u * 1.5 + 5);
    }
    ctx.restore();
  }

  /** header title (font shrunk to fit, ≥ 11 px) and subtitle lines, measured against the canvas width */
  private headerLines(): { title: string; size: number; sub: string[] } {
    const [l1, l2] = this.headerText(P.bendStats(this.lat));
    const ctx = this.c.ctx;
    const maxW = this.c.w - 20;
    ctx.save();
    let size = 13;
    ctx.font = `650 ${size}px ${TOKENS.font}`;
    while (size > 11 && ctx.measureText(l1).width > maxW) {
      size -= 0.5;
      ctx.font = `650 ${size}px ${TOKENS.font}`;
    }
    ctx.font = `500 11.5px ${TOKENS.font}`;
    // wrap greedily after " · " or ", " (the separator " · " is dropped at a line break, ", " keeps its comma)
    const parts = l2.split(/(?<=, )|(?= · )/);
    const sub: string[] = [];
    let cur = '';
    for (const p of parts) {
      const next = cur + p;
      if (cur && ctx.measureText(next.trimEnd()).width > maxW) {
        sub.push(cur.trimEnd());
        cur = p.replace(/^ · /, '');
      } else cur = next;
    }
    if (cur) sub.push(cur.trimEnd());
    ctx.restore();
    return { title: l1, size, sub };
  }

  private headerText(st: P.BendStats): [string, string] {
    const lat = this.lat;
    const native = (lat.id === 'apsu' && this.E === 6) || (lat.id === 'aps' && this.E === 7);
    const E = `${this.E.toFixed(1)} GeV${lat.id !== 'generic' && !native ? ' · hypothetical' : ''}`;
    if (lat.id === 'apsu') {
      return [
        native ? "APS-U · 7 bends per sector" : "APS-U lattice · 7 bends per sector",
        `7 bends of ${st.minDeg.toFixed(2)} to ${st.maxDeg.toFixed(2)}° · +9.95° total · 6 backward bends · −0.94° · ${E}`,
      ];
    }
    if (lat.id === 'aps') return ['APS before upgrade · 2 bends per sector', `2 bends of 4.5°, each 3.06 m long · simplified dispersion model · ${E}`];
    const M = lat.M;
    const th = (P.SECTOR_BEND_DEG / M).toFixed(M >= 8 ? 3 : 2);
    return [`Hypothetical lattice · ${M} bends per sector`, `${M} equal bends of ${th}° · simplified model · ${E}`];
  }

  private drawLegend(ctx: CanvasRenderingContext2D): void {
    const { legendTop } = this.split();
    let y = legendTop + 7;
    let x = 10;
    ctx.save();
    ctx.font = `500 10.5px ${TOKENS.font}`;
    ctx.textBaseline = 'middle';
    for (const it of this.legendItems()) {
      const wI = (it.kind === 'text' ? 0 : 14) + ctx.measureText(it.label).width + 12;
      if (x + wI > this.c.w - 8) {
        y += 15;
        x = 10;
      }
      if (it.kind === 'text') {
        ctx.fillStyle = it.color;
        ctx.fillText(it.label, x, y);
        x += wI;
        continue;
      }
      ctx.fillStyle = it.color;
      ctx.strokeStyle = it.color;
      if (it.kind === 'box') ctx.fillRect(x, y - 4, 10, 8);
      else if (it.kind === 'dot') {
        ctx.beginPath();
        ctx.arc(x + 5, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y + 3);
        ctx.lineTo(x + 11, y - 3);
        ctx.stroke();
      }
      ctx.fillStyle = TOKENS.ink2;
      ctx.fillText(it.label, x + 14, y);
      x += wI;
    }
    ctx.restore();
  }

  private drawStrip(ctx: CanvasRenderingContext2D): void {
    const lat = this.lat;
    const { stripTop } = this.split();
    const rect = { x: 0, y: stripTop, w: this.c.w, h: this.c.h - stripTop };
    // sideways shift for +1 % energy (mm) = η[m]·10
    const k = 10;
    const f = plotFrame(
      ctx,
      rect,
      { min: 0, max: lat.C, ticks: [0, 5, 10, 15, 20, 25], label: 'distance along the sector (m)' },
      { min: 0, max: 3, ticks: [0, 1, 2, 3], label: 'mm per 1 %' },
      this.stripTitle(ctx, rect.w - 60),
    );
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x0, f.y1, f.x1 - f.x0, f.y0 - f.y1);
    ctx.clip();
    for (const e of lat.elements) {
      if (e.kind !== 'bend' && e.kind !== 'reverse') continue;
      ctx.fillStyle = e.kind === 'bend' ? hexA(COL.bend, 0.22) : hexA(COL.reverse, 0.35);
      const xa = f.px(e.s0);
      const xb = Math.max(xa + 1.5, f.px(e.s1));
      ctx.fillRect(xa, f.y1, xb - xa, f.y0 - f.y1);
    }
    // curve
    const n = lat.eta.length;
    const step = Math.max(1, Math.floor(n / 600));
    ctx.beginPath();
    ctx.moveTo(f.px(0), f.py(0));
    for (let i = 0; i < n; i += step) {
      const s = i * lat.ds;
      if (s > lat.C) break;
      ctx.lineTo(f.px(s), f.py(lat.eta[i] * k));
    }
    ctx.lineTo(f.px(lat.C), f.py(lat.eta[Math.floor(lat.C / lat.ds)] * k));
    ctx.lineTo(f.px(lat.C), f.py(0));
    ctx.closePath();
    ctx.fillStyle = hexA(this.accent, 0.22);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < n; i += step) {
      const s = i * lat.ds;
      if (s > lat.C) break;
      ctx.lineTo(f.px(s), f.py(lat.eta[i] * k));
    }
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    // peak tag
    let im = 0;
    for (let i = 0; i < n; i++) if (lat.eta[i] > lat.eta[im]) im = i;
    const sm = im * lat.ds;
    const v = lat.eta[im] * k;
    const tag = `widest: ${v.toFixed(v < 1 ? 2 : 1)} mm (ηₓ = ${(lat.eta[im] * 1000).toFixed(0)} mm)`;
    ctx.save();
    ctx.font = `600 10.5px ${TOKENS.mono}`;
    const tw = ctx.measureText(tag).width;
    let tx = f.px(sm) + 6;
    if (tx + tw > f.x1 - 4) tx = f.px(sm) - tw - 6;
    const ty = Math.max(f.y1 + 10, f.py(v) - 4);
    ctx.fillStyle = TOKENS.ink;
    ctx.textBaseline = 'bottom';
    ctx.fillText(tag, tx, ty);
    ctx.restore();
  }

  /** strip title, shortened to fit the available width */
  private stripTitle(ctx: CanvasRenderingContext2D, maxW: number): string {
    const m = this.lat.modelEta;
    const src = m ? 'simplified model' : 'APS-U design';
    const opts = [
      `Offset per energy difference · dispersion ηₓ · ${src} · shaded bends`,
      `Dispersion ηₓ · ${src} · shaded bends`,
      `Dispersion ηₓ · ${src}`,
      "Dispersion ηₓ",
    ];
    ctx.save();
    ctx.font = `600 12px ${TOKENS.font}`;
    const t = opts.find((o) => ctx.measureText(o).width <= maxW) ?? opts[opts.length - 1];
    ctx.restore();
    return t;
  }

  frame(dt: number): void {
    const { c } = this;
    if (!this.layerOk) this.buildLayer();
    const ctx = c.ctx;
    ctx.clearRect(0, 0, c.w, c.h);
    ctx.drawImage(this.layer, 0, 0, c.w, c.h);
    const lat = this.lat;
    const C = lat.C;
    const G = this.G;
    // dt = 0 (reduced motion, paused): a still picture of the current state
    const v = C / 5.5;
    const ds = v * dt;
    const dampB = Math.exp(-dt / 1.6);
    const relaxE = 1 - Math.exp(-dt / 2.2);
    const kPh = (2 * Math.PI * lat.nuSector) / C;
    const pxScale = c.w / 430;
    const bright = (this.E / 6) ** 2;

    // photons: age + draw (clipped to the sector drawing)
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.drawBox.x, this.drawBox.y, this.drawBox.w, this.drawBox.h);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.strokeStyle = TOKENS.xray;
    ctx.lineWidth = 1.6;
    const vPh = 240 * pxScale;
    const life = 0.6;
    for (let j = 0; j < this.NPH; j++) {
      if (this.fage[j] >= life) continue;
      this.fage[j] += dt;
      const a = Math.max(0, 1 - this.fage[j] / life) * this.fa[j];
      if (a <= 0.01) continue;
      this.fx[j] += this.fdx[j] * vPh * dt;
      this.fy[j] += this.fdy[j] * vPh * dt;
      const L = 11 * pxScale;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(this.fx[j], this.fy[j]);
      ctx.lineTo(this.fx[j] - this.fdx[j] * L, this.fy[j] - this.fdy[j] * L);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // electrons
    for (let i = 0; i < this.NP; i++) {
      let s = this.ps[i] + ds;
      if (s >= C) s -= C;
      this.ps[i] = s;
      this.ph[i] += kPh * ds;
      this.c1[i] *= dampB;
      this.c2[i] *= dampB;
      this.dd[i] += (this.d0[i] - this.dd[i]) * relaxE;
      const k = this.idx(s);
      const B = this.gB[k];
      if (B > 0 && this.rnd() < this.kEmit * B * ds) {
        const du = Math.min(1.6, -0.45 * Math.log(Math.max(1e-6, 1 - this.rnd())));
        this.dd[i] -= du;
        const kick = this.geta[k] * du * G;
        this.c1[i] += kick * Math.cos(this.ph[i]);
        this.c2[i] += kick * Math.sin(this.ph[i]);
        // spawn a photon along the local tangent
        const j = this.fi;
        this.fi = (this.fi + 1) % this.NPH;
        const off0 = this.geta[k] * this.dd[i] * G + this.c1[i] * Math.cos(this.ph[i]) + this.c2[i] * Math.sin(this.ph[i]);
        this.fx[j] = this.gx[k] + this.nx[k] * off0;
        this.fy[j] = this.gy[k] + this.ny[k] * off0;
        this.fdx[j] = this.tx[k];
        this.fdy[j] = this.ty[k];
        this.fage[j] = 0;
        this.fa[j] = Math.min(1, 0.35 + 0.75 * bright * (B / 0.65));
      }
      const off = this.geta[k] * this.dd[i] * G + this.c1[i] * Math.cos(this.ph[i]) + this.c2[i] * Math.sin(this.ph[i]);
      const x = this.gx[k] + this.nx[k] * off;
      const y = this.gy[k] + this.ny[k] * off;
      const col = BUCKETS[bucketOf(this.dd[i])];
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** "#rrggbb" (or any CSS colour) with alpha. */
export function hexA(col: string, a: number): string {
  if (col.startsWith('#') && (col.length === 7 || col.length === 4)) {
    const h = col.length === 4 ? `#${col[1]}${col[1]}${col[2]}${col[2]}${col[3]}${col[3]}` : col;
    const [r, g, b] = hexRgb(h);
    return `rgba(${r},${g},${b},${a})`;
  }
  return `color-mix(in srgb, ${col} ${Math.round(a * 100)}%, transparent)`;
}
