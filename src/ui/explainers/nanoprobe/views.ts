/**
 * Canvas views for the nanoprobe station: the sample with the scanning beam (+ close-up), the four element maps,
 * and the XRF spectrum with the absorption-edge ruler.
 */
import type { Depth } from '../../../app/store';
import { TOKENS, plotFrame, type Canvas2D } from '../kit';
import { EL_KEYS, ELEMENTS, W_EDGES, comptonE, fmtCounts, fmtLenNm, type ElKey } from './physics';
import { FOV_NM, type CellState } from './sample';
import { NCH, SPEC, chE, type ScanRun, type Spectrum } from './scan';

const FONT = TOKENS.font;
const MONO = TOKENS.mono;

function txt(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: { c?: string; size?: number; w?: number; align?: CanvasTextAlign; base?: CanvasTextBaseline; mono?: boolean } = {}): number {
  ctx.fillStyle = o.c ?? TOKENS.ink2;
  ctx.font = `${o.w ?? 500} ${o.size ?? 11}px ${o.mono ? MONO : FONT}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.base ?? 'alphabetic';
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgba = (h: string, a: number) => {
  const [r, g, b] = rgb(h);
  return `rgba(${r},${g},${b},${a})`;
};

// ============================================================================================ hero: sample + beam

export interface HeroState {
  truth: HTMLCanvasElement;
  /** bump when the truth picture changes */
  truthVersion: number;
  /** beam position (nm) or null when parked */
  beam: { x: number; y: number };
  spot: number;
  run: ScanRun | null;
  scanning: boolean;
  cell: CellState;
  cellIndex: number;
  insitu: boolean;
  /** "charging…" countdown text between in situ scans */
  pending: string;
  /** direction of the pending change (colours the status text) */
  pendingDir: 'charging' | 'discharging';
  hasCracks: boolean;
  depth: Depth;
  accent: string;
  speedLabel: string;
  /** footer hint while the beam is parked; "|"-separated variants, longest first (the first that fits is drawn) */
  hint: string;
}

export class HeroView {
  private scaled = document.createElement('canvas');
  private scaledKey = '';
  /** last drawn sample square (CSS px), for pointer → sample mapping */
  private box = { x0: 0, y0: 0, side: 1 };
  constructor(private c: Canvas2D) {}

  /** canvas CSS-pixel position → sample position (nm), or null outside the sample square */
  toNm(px: number, py: number): { x: number; y: number } | null {
    const { x0, y0, side } = this.box;
    const u = (px - x0) / side;
    const v = (py - y0) / side;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return { x: u * FOV_NM, y: v * FOV_NM };
  }

  draw(s: HeroState): void {
    const { ctx, w, h } = this.c;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    const top = 26;
    const bottom = 24;
    const side = Math.max(60, Math.floor(Math.min(w - 16, h - top - bottom)));
    const x0 = Math.round((w - side) / 2);
    const y0 = Math.round(top + (h - top - bottom - side) / 2);
    const sc = side / FOV_NM;
    this.box = { x0, y0, side };
    // the ground truth, pre-scaled once per size/state (a 512² high-quality downscale every frame is costly)
    const dpr = this.c.dpr;
    const key = `${side}|${dpr}|${s.truthVersion}`;
    if (key !== this.scaledKey) {
      this.scaledKey = key;
      this.scaled.width = Math.round(side * dpr);
      this.scaled.height = Math.round(side * dpr);
      const sc2 = this.scaled.getContext('2d')!;
      sc2.imageSmoothingEnabled = true;
      sc2.imageSmoothingQuality = 'high';
      sc2.drawImage(s.truth, 0, 0, this.scaled.width, this.scaled.height);
    }
    ctx.drawImage(this.scaled, x0, y0, side, side);
    ctx.strokeStyle = 'rgba(150,180,220,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, side - 1, side - 1);

    // probe footprints for coarse scans: shows gaps (under-sampling) or overlap
    const run = s.run;
    if (run && run.nx <= 48) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, side, side);
      ctx.clip();
      const r = Math.max(1.2, (s.spot / 2) * sc);
      ctx.fillStyle = rgba(s.accent, 0.16);
      ctx.strokeStyle = rgba(s.accent, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const ds = run.step * sc;
      // heavily overlapping footprints merge into a uniform wash (and cost a lot of fill): show the current line's
      // only, and none once the scan is over
      const heavy = r > 0.75 * ds;
      const k0 = heavy ? (s.scanning ? Math.max(0, run.idx - run.nx) : run.idx) : 0;
      for (let k = k0; k < run.idx; k++) {
        const j = Math.floor(k / run.nx);
        const px = x0 + (k - j * run.nx + 0.5) * ds;
        const py = y0 + (j + 0.5) * ds;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // raster trace of the current line
    const bx = x0 + s.beam.x * sc;
    const by = y0 + s.beam.y * sc;
    if (s.scanning && run) {
      ctx.strokeStyle = rgba(s.accent, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + (run.step / 2) * sc, by);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    this.beam(ctx, bx, by, (s.spot / 2) * sc, s.accent, true);

    // close-up inset around the beam
    const inset = Math.round(Math.min(side * 0.36, 170));
    if (side >= 230 && s.spot <= 350) {
      // top-right corner unless the beam is under it, then top-left / bottom corners
      const corners = [
        [x0 + side - inset - 8, y0 + 8],
        [x0 + 8, y0 + 8],
        [x0 + side - inset - 8, y0 + side - inset - 8],
      ];
      const pad = 18;
      const pick = corners.find(([cx, cy]) => !(bx > cx - pad && bx < cx + inset + pad && by > cy - pad && by < cy + inset + pad)) ?? corners[0];
      const ix = pick[0];
      const iy = pick[1];
      const Z = Math.max(5 * s.spot, 360); // nm across
      const zx = Math.min(FOV_NM - Z, Math.max(0, s.beam.x - Z / 2));
      const zy = Math.min(FOV_NM - Z, Math.max(0, s.beam.y - Z / 2));
      const srcN = s.truth.width / FOV_NM;
      ctx.save();
      pill(ctx, ix - 1, iy - 1, inset + 2, inset + 2, 6);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.beginPath();
      ctx.rect(ix, iy, inset, inset);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(s.truth, zx * srcN, zy * srcN, Z * srcN, Z * srcN, ix, iy, inset, inset);
      const zs = inset / Z;
      this.beam(ctx, ix + (s.beam.x - zx) * zs, iy + (s.beam.y - zy) * zs, (s.spot / 2) * zs, s.accent, false);
      ctx.restore();
      ctx.strokeStyle = rgba(s.accent, 0.7);
      ctx.lineWidth = 1;
      pill(ctx, ix - 0.5, iy - 0.5, inset + 1, inset + 1, 6);
      ctx.stroke();
      // where the close-up is
      ctx.strokeStyle = rgba(s.accent, 0.5);
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x0 + zx * sc, y0 + zy * sc, Math.max(3, Z * sc), Math.max(3, Z * sc));
      ctx.setLineDash([]);
      // labels inside the inset: name + spot on top, scale bar at the bottom
      ctx.fillStyle = 'rgba(5,8,14,0.7)';
      ctx.fillRect(ix, iy, inset, 17);
      ctx.fillRect(ix, iy + inset - 15, inset, 15);
      const spotT = s.depth === 'specialist' ? `FWHM ${fmtLenNm(s.spot)}` : `spot ${fmtLenNm(s.spot)}`;
      ctx.font = `600 10.5px ${FONT}`;
      const sw = ctx.measureText(spotT).width;
      txt(ctx, spotT, ix + inset - 5, iy + 12, { size: 10.5, c: s.accent, align: 'right', w: 600 });
      ctx.font = `700 9.5px ${FONT}`;
      if (ctx.measureText('CLOSE-UP').width + sw + 16 < inset) txt(ctx, 'CLOSE-UP', ix + 5, iy + 12, { size: 9.5, c: 'rgba(233,238,245,0.85)', w: 700 });
      const bar = niceBar(Z * 0.3);
      ctx.fillStyle = TOKENS.ink;
      ctx.fillRect(ix + 6, iy + inset - 8, bar * zs, 2);
      txt(ctx, fmtLenNm(bar), ix + 10 + bar * zs, iy + inset - 4, { size: 10, c: TOKENS.ink2 });
    }

    // header right: cell status / speed
    const hy = 15;
    if (s.insitu || s.cellIndex > 0) {
      const st = s.cell;
      const t = s.pending || `${st.volts.toFixed(1)} V · ${st.dir === 'rest' ? 'resting' : st.dir}${st.cycle > 1 ? ` · cycle ${st.cycle}` : ''}`;
      const dir = s.pending ? s.pendingDir : st.dir;
      const tw = txt(ctx, t, w - 10, hy + 1, { size: 11, c: dir === 'charging' ? TOKENS.warn : TOKENS.ink2, align: 'right', w: 600 });
      // battery gauge
      const gx = w - 16 - tw - 26;
      const gy = hy - 8;
      ctx.strokeStyle = TOKENS.ink2;
      ctx.lineWidth = 1;
      ctx.strokeRect(gx + 0.5, gy + 0.5, 20, 10);
      ctx.fillStyle = TOKENS.ink2;
      ctx.fillRect(gx + 21, gy + 3, 2, 5);
      ctx.fillStyle = st.soc > 0.9 ? TOKENS.good : st.soc > 0.4 ? TOKENS.warn : TOKENS.bad;
      ctx.fillRect(gx + 2, gy + 2, Math.max(1, 17 * st.soc), 7);
    }

    // footer: scale bar + legend
    const fy = y0 + side + 16;
    const bar = niceBar(FOV_NM * 0.18);
    ctx.fillStyle = TOKENS.ink;
    ctx.fillRect(x0, fy - 4, bar * sc, 2);
    const bw = txt(ctx, fmtLenNm(bar), x0 + bar * sc + 6, fy, { size: 10.5, c: TOKENS.ink2 });
    let lx = x0 + side;
    const items: [string, string][] = [];
    items.push([ELEMENTS.W.color, s.depth === 'specialist' ? 'W-rich' : 'tungsten-rich']);
    if (s.hasCracks) items.push(['#1a2433', 'cracks']);
    ctx.textAlign = 'right';
    for (let i = items.length - 1; i >= 0; i--) {
      const [col, name] = items[i];
      const tw = txt(ctx, name, lx, fy, { size: 10.5, c: TOKENS.ink2, align: 'right' });
      lx -= tw + 13;
      ctx.fillStyle = col;
      ctx.fillRect(lx, fy - 8, 9, 9);
      if (col === '#1a2433') {
        ctx.strokeStyle = 'rgba(183,195,210,0.5)';
        ctx.strokeRect(lx + 0.5, fy - 7.5, 8, 8);
      }
      lx -= 12;
    }
    // speed (while scanning) or the "aim the beam" hint, only where it fits between scale bar and legend
    const fx = x0 + bar * sc + bw + 16;
    ctx.font = `500 10.5px ${FONT}`;
    const foot = (s.scanning ? [s.speedLabel] : s.hint.split('|')).find((t) => t && ctx.measureText(t).width < lx - fx - 6);
    if (foot) txt(ctx, foot, fx, fy, { size: 10.5, c: s.scanning ? TOKENS.ink3 : TOKENS.ink2 });
  }

  /** beam: true-size FWHM disc with glow; crosshair ticks so a 20 nm spot is still findable */
  private beam(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, accent: string, ticks: boolean): void {
    const rr = Math.max(1.4, r);
    // Gaussian-like glow; large spots get a fainter glow so the sample stays visible underneath
    const big = rr > 10;
    const R = big ? rr * 1.45 : rr * 2.2 + 4;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, rgba(accent, big ? 0.42 : 0.95));
    g.addColorStop(Math.min(0.9, rr / R), rgba(accent, big ? 0.2 : 0.55));
    g.addColorStop(1, rgba(accent, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.stroke();
    if (ticks) {
      const a = rr + 5;
      const b = rr + 13;
      ctx.strokeStyle = rgba(accent, 0.9);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - b, y);
      ctx.lineTo(x - a, y);
      ctx.moveTo(x + a, y);
      ctx.lineTo(x + b, y);
      ctx.moveTo(x, y - b);
      ctx.lineTo(x, y - a);
      ctx.moveTo(x, y + a);
      ctx.lineTo(x, y + b);
      ctx.stroke();
    }
  }
}

function niceBar(v: number): number {
  const m = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / m;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * m;
}

// ============================================================================================ element maps

/** black → element colour → white */
function elementLut(hex: string): Uint8ClampedArray {
  const [r, g, b] = rgb(hex);
  const out = new Uint8ClampedArray(256 * 3);
  const base = [7, 10, 16];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let c: number[];
    if (t < 0.8) {
      const u = Math.pow(t / 0.8, 0.9);
      c = [base[0] + (r - base[0]) * u, base[1] + (g - base[1]) * u, base[2] + (b - base[2]) * u];
    } else {
      const u = (t - 0.8) / 0.2;
      c = [r + (255 - r) * u * 0.85, g + (255 - g) * u * 0.85, b + (255 - b) * u * 0.85];
    }
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  return out;
}

export interface MapsState {
  run: ScanRun | null;
  excited: boolean[];
  scanning: boolean;
  depth: Depth;
  accent: string;
}

export class MapsView {
  private luts = EL_KEYS.map((k) => elementLut(ELEMENTS[k].color));
  private cur: HTMLCanvasElement[] = EL_KEYS.map(() => document.createElement('canvas'));
  private ghost: HTMLCanvasElement[] = EL_KEYS.map(() => document.createElement('canvas'));
  private hasGhost = false;
  private img: ImageData[] = [];
  private drawn = 0;
  private run: ScanRun | null = null;

  constructor(private c: Canvas2D) {}

  /** a new scan begins: keep the last complete maps as a dim "ghost" underneath */
  begin(run: ScanRun, prevComplete: boolean): void {
    if (this.run && prevComplete) {
      for (let e = 0; e < 4; e++) {
        const g = this.ghost[e];
        g.width = this.cur[e].width;
        g.height = this.cur[e].height;
        g.getContext('2d')!.drawImage(this.cur[e], 0, 0);
      }
      this.hasGhost = true;
    }
    this.run = run;
    this.drawn = 0;
    this.img = EL_KEYS.map(() => new ImageData(run.nx, run.nx));
    for (const cv of this.cur) {
      cv.width = run.nx;
      cv.height = run.nx;
    }
  }

  /** write newly measured pixels into the map images */
  update(): void {
    const run = this.run;
    if (!run || run.idx <= this.drawn) return;
    const from = this.drawn;
    const to = run.idx;
    for (let e = 0; e < 4; e++) {
      const d = this.img[e].data;
      const lut = this.luts[e];
      const m = run.maps[e];
      const inv = 255 / run.scale[e];
      for (let k = from; k < to; k++) {
        const v = Math.max(0, Math.min(255, Math.round(m[k] * inv)));
        const o = k * 4;
        d[o] = lut[v * 3];
        d[o + 1] = lut[v * 3 + 1];
        d[o + 2] = lut[v * 3 + 2];
        d[o + 3] = 255;
      }
      const j0 = Math.floor(from / run.nx);
      const j1 = Math.floor((to - 1) / run.nx);
      this.cur[e].getContext('2d')!.putImageData(this.img[e], 0, 0, 0, j0, run.nx, j1 - j0 + 1);
    }
    this.drawn = to;
  }

  private layer = document.createElement('canvas');
  private layerKey = '';

  private geom(w: number, h: number) {
    const top = 24;
    const gap = 10;
    const tw = (w - gap * 3) / 2;
    const th = (h - top - gap * 2) / 2;
    const head = 16;
    const foot = 15;
    const msz = Math.max(40, Math.floor(Math.min(tw, th - head - foot)));
    return EL_KEYS.map((_, e) => {
      const tx = gap + (e % 2) * (tw + gap);
      const ty = top + Math.floor(e / 2) * (th + gap);
      return { mx: Math.round(tx + (tw - msz) / 2), my: Math.round(ty + head + (th - head - foot - msz) / 2), msz };
    });
  }

  /** background, titles, frames and colour bars: redrawn only when they change */
  private renderLayer(s: MapsState, w: number, h: number): void {
    const dpr = this.c.dpr;
    this.layer.width = Math.round(w * dpr);
    this.layer.height = Math.round(h * dpr);
    const ctx = this.layer.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    const G = this.geom(w, h);
    const run = s.run;
    EL_KEYS.forEach((k, e) => {
      const El = ELEMENTS[k];
      const { mx, my, msz } = G[e];
      const sym = txt(ctx, k, mx, my - 4, { size: 13, w: 700, c: El.color });
      const sub = s.depth === 'specialist' ? `${El.main.name} ${El.main.e.toFixed(2)} keV` : El.name;
      txt(ctx, sub, mx + sym + 5, my - 4, { size: 10.5, c: TOKENS.ink3 });
      ctx.fillStyle = '#070a10';
      ctx.fillRect(mx, my, msz, msz);
      ctx.strokeStyle = 'rgba(150,180,220,0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mx - 0.5, my - 0.5, msz + 1, msz + 1);
      // colour bar: "0 ▬▬▬ max unit" on one line
      const cy = my + msz + 11;
      ctx.font = `500 10px ${FONT}`;
      const unit = s.depth === 'specialist' ? '/px' : ' per pixel';
      const maxT = run && s.excited[e] ? `${fmtCounts(run.scale[e])}${unit}` : '';
      const mw = maxT ? ctx.measureText(maxT).width : 0;
      const bx0 = mx + 10;
      const bx1 = mx + msz - (mw ? mw + 5 : 0);
      if (bx1 - bx0 > 12) {
        const grad = ctx.createLinearGradient(bx0, 0, bx1, 0);
        const lut = this.luts[e];
        for (let i = 0; i <= 8; i++) {
          const v = Math.round((i / 8) * 255);
          grad.addColorStop(i / 8, `rgb(${lut[v * 3]},${lut[v * 3 + 1]},${lut[v * 3 + 2]})`);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(bx0, cy - 5, bx1 - bx0, 4);
      }
      txt(ctx, '0', mx, cy, { size: 10, c: TOKENS.ink3 });
      if (maxT) txt(ctx, maxT, mx + msz, cy, { size: 10, c: TOKENS.ink3, align: 'right' });
    });
  }

  draw(s: MapsState): void {
    const { ctx, w, h } = this.c;
    const run = s.run;
    const key = `${w}|${h}|${this.c.dpr}|${s.depth}|${s.excited.join()}|${run ? Array.from(run.scale, (v) => fmtCounts(v)).join() : ''}`;
    if (key !== this.layerKey) {
      this.layerKey = key;
      this.renderLayer(s, w, h);
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.layer, 0, 0, w, h);
    const G = this.geom(w, h);
    EL_KEYS.forEach((k, e) => {
      const { mx, my, msz } = G[e];
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      if (this.hasGhost && this.ghost[e].width > 0) {
        ctx.globalAlpha = 0.33;
        ctx.drawImage(this.ghost[e], mx, my, msz, msz);
        ctx.globalAlpha = 1;
      }
      if (run) ctx.drawImage(this.cur[e], mx, my, msz, msz);
      ctx.restore();
      if (run && s.scanning && run.idx < run.total) {
        const p = run.pos(run.idx);
        const bx = mx + (p.x / FOV_NM) * msz;
        const by = my + (p.y / FOV_NM) * msz;
        ctx.strokeStyle = rgba(s.accent, 0.95);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx - 7, by);
        ctx.lineTo(bx - 3, by);
        ctx.moveTo(bx + 3, by);
        ctx.lineTo(bx + 7, by);
        ctx.moveTo(bx, by - 7);
        ctx.lineTo(bx, by - 3);
        ctx.moveTo(bx, by + 3);
        ctx.lineTo(bx, by + 7);
        ctx.stroke();
      }
      if (!s.excited[e]) {
        ctx.fillStyle = 'rgba(5,8,14,0.8)';
        ctx.fillRect(mx, my, msz, msz);
        const edge = ELEMENTS[k].edges[0];
        txt(ctx, s.depth === 'specialist' ? 'not excited' : 'dark: not excited', mx + msz / 2, my + msz / 2 - 4, { size: 11.5, w: 650, c: TOKENS.ink, align: 'center' });
        txt(ctx, `needs E₀ > ${edge.e.toFixed(2)} keV`, mx + msz / 2, my + msz / 2 + 12, { size: 10.5, c: TOKENS.ink3, align: 'center' });
      }
    });
  }
}

// ============================================================================================ spectrum

export interface SpecState {
  spec: Spectrum;
  /** expected mean counts per pixel per component (Ni, Mn, Co, W, Rayleigh, Compton) */
  mean: Float64Array;
  hasPixel: boolean;
  E0: number;
  excited: boolean[];
  depth: Depth;
  accent: string;
  /** y-axis top (counts per pixel per channel) */
  ymax: number;
}

const SUPD: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
/** log-axis tick label: 1k, 100, 1, 0.1, 0.01, 10⁻³ … */
function tickFmt(v: number): string {
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  if (v >= 1) return `${Math.round(v)}`;
  if (v >= 0.01) return `${+v.toPrecision(1)}`;
  const e = Math.round(Math.log10(v));
  return `10${String(e).split('').map((c) => SUPD[c] ?? c).join('')}`;
}

const COMP_COLORS = [ELEMENTS.Ni.color, ELEMENTS.Mn.color, ELEMENTS.Co.color, ELEMENTS.W.color, '#9aa6b8', '#9aa6b8'];

export class SpectrumView {
  private tmp = new Float32Array(NCH);
  private layer = document.createElement('canvas');
  private layerKey = '';
  private F = { x0: 0, x1: 1, y0: 1, y1: 0, lmin: 0, lmax: 1, rY0: 0, rY1: 0 };
  private xs = new Float32Array(NCH);
  private legendBox = { x0: 0, x1: 0, y0: 0, y1: 0 };
  constructor(private c: Canvas2D) {}

  /** axes, ruler, edges and the excitation window: redrawn only when E₀ / size / scale / depth change */
  private renderLayer(s: SpecState, w: number, h: number): void {
    const dpr = this.c.dpr;
    this.layer.width = Math.round(w * dpr);
    this.layer.height = Math.round(h * dpr);
    const ctx = this.layer.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = TOKENS.bg;
    ctx.fillRect(0, 0, w, h);
    const ruler = 34;
    const top = 22;
    const ymax = s.ymax;
    const ymin = ymax / 1e5;
    const decades: number[] = [];
    for (let v = ymin * 10; v <= ymax * 1.001; v *= 10) decades.push(v);
    const yt = w < 460 ? decades.filter((_, i) => i % 2 === decades.length % 2 || i === decades.length - 1) : decades;
    const spc = s.depth === 'specialist';
    const f = plotFrame(
      ctx,
      { x: 0, y: top + ruler, w, h: h - top - ruler },
      { min: SPEC.e0, max: SPEC.e1, label: spc ? 'emitted photon energy (keV)' : w < 460 ? 'energy of the X-rays coming out (keV)' : 'energy of the X-rays coming out of the sample (keV)', ticks: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] },
      { min: ymin, max: ymax, log: true, label: spc ? 'counts / px / 10 eV' : 'X-rays per pixel', ticks: yt, format: tickFmt },
    );
    const rY0 = top + 4;
    const rY1 = top + ruler - 4;
    this.F = { x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1, lmin: Math.log10(ymin), lmax: Math.log10(ymax), rY0, rY1 };
    for (let c = 0; c < NCH; c++) this.xs[c] = f.x0 + ((chE(c) - SPEC.e0) / (SPEC.e1 - SPEC.e0)) * (f.x1 - f.x0);
    const X = (e: number) => f.x0 + ((e - SPEC.e0) / (SPEC.e1 - SPEC.e0)) * (f.x1 - f.x0);
    // excitation window: everything left of the beam energy can be excited
    const e0x = s.E0 <= SPEC.e1 ? X(s.E0) : f.x1;
    ctx.fillStyle = rgba(s.accent, 0.08);
    ctx.fillRect(f.x0, rY0, Math.max(0, e0x - f.x0), rY1 - rY0);
    ctx.strokeStyle = 'rgba(150,180,220,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(f.x0, rY1 + 0.5);
    ctx.lineTo(f.x1, rY1 + 0.5);
    ctx.stroke();
    txt(ctx, 'edges', f.x0 - 6, rY1 - 3, { size: 10, c: TOKENS.ink3, align: 'right' });
    const edges: { e: number; label: string; color: string; on: boolean }[] = [];
    for (const k of EL_KEYS) for (const ed of ELEMENTS[k].edges) edges.push({ e: ed.e, label: k === 'W' ? ed.label : k, color: ELEMENTS[k].color, on: s.E0 > ed.e });
    edges.sort((a, b) => a.e - b.e);
    let lastRight = -1e9;
    for (const ed of edges) {
      const x = X(ed.e);
      ctx.fillStyle = ed.on ? ed.color : 'rgba(131,148,169,0.6)';
      ctx.beginPath();
      ctx.moveTo(x - 4, rY1 - 7);
      ctx.lineTo(x + 4, rY1 - 7);
      ctx.lineTo(x, rY1);
      ctx.closePath();
      ctx.fill();
      ctx.font = `600 10.5px ${FONT}`;
      const tw = ctx.measureText(ed.label).width;
      let lx = x - tw / 2;
      if (lx < lastRight + 3) lx = lastRight + 3;
      txt(ctx, ed.label, lx, rY1 - 10, { size: 10.5, w: 600, c: ed.on ? ed.color : TOKENS.ink3 });
      lastRight = lx + tw;
      if (ed.on) {
        ctx.strokeStyle = rgba(ed.color, 0.18);
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x + 0.5, f.y1);
        ctx.lineTo(x + 0.5, f.y0);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // beam energy marker + label
    const bl = `beam ${s.E0.toFixed(1)} keV`;
    if (s.E0 <= SPEC.e1) {
      const x = X(s.E0);
      ctx.strokeStyle = s.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, rY0 - 2);
      ctx.lineTo(x, rY1);
      ctx.stroke();
      const right = x + 70 > f.x1;
      txt(ctx, bl, right ? x - 4 : x + 4, rY0 + 7, { size: 10.5, w: 700, c: s.accent, align: right ? 'right' : 'left' });
    } else txt(ctx, `${bl} →`, f.x1, rY0 + 7, { size: 10.5, w: 700, c: s.accent, align: 'right' });
  }

  draw(s: SpecState): void {
    const { ctx, w, h } = this.c;
    const key = `${w}|${h}|${this.c.dpr}|${s.E0.toFixed(3)}|${s.ymax}|${s.depth}`;
    if (key !== this.layerKey) {
      this.layerKey = key;
      this.renderLayer(s, w, h);
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.layer, 0, 0, w, h);
    const spec = s.spec;
    const F = this.F;
    const xs = this.xs;
    const ky = (F.y1 - F.y0) / (F.lmax - F.lmin);
    const ymin = Math.pow(10, F.lmin);
    const Y = (v: number) => (v <= ymin ? F.y0 : v >= Math.pow(10, F.lmax) ? F.y1 : F.y0 + (Math.log10(v) - F.lmin) * ky);
    const X = (e: number) => F.x0 + ((e - SPEC.e0) / (SPEC.e1 - SPEC.e0)) * (F.x1 - F.x0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(F.x0, F.y1, F.x1 - F.x0, F.y0 - F.y1);
    ctx.clip();
    // expected components (mean per pixel), filled; 2-channel stride (lines are ≥ 12 channels wide)
    const order = [4, 5, 0, 3, 2, 1];
    for (const ci of order) {
      const a = s.mean[ci];
      if (!(a > 0)) continue;
      const u = spec.unit[ci];
      ctx.beginPath();
      ctx.moveTo(xs[0], F.y0);
      let lastLow = false;
      for (let c = 0; c < NCH; c += 2) {
        const v = a * u[c];
        const low = v <= ymin;
        if (low && lastLow && c + 2 < NCH && a * u[c + 2] <= ymin) continue;
        ctx.lineTo(xs[c], Y(v));
        lastLow = low;
      }
      ctx.lineTo(xs[NCH - 1], F.y0);
      ctx.closePath();
      ctx.fillStyle = rgba(COMP_COLORS[ci], ci >= 4 ? 0.16 : 0.26);
      ctx.fill();
      ctx.strokeStyle = rgba(COMP_COLORS[ci], 0.65);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // this pixel (one Poisson draw): one dot per non-empty 10 eV channel. Counts are integers, so on the log axis
    // they sit on discrete rows (1, 2, 3 …); empty channels simply have no dot.
    if (s.hasPixel) {
      ctx.fillStyle = rgba(s.accent, 0.9);
      const px = spec.pixel;
      for (let c = 0; c < NCH; c++) {
        const v = px[c];
        if (v < 1) continue;
        ctx.fillRect(xs[c] - 1.1, Y(v) - 1.1, 2.2, 2.2);
      }
    }
    // measured map average
    if (spec.pixels > 0) {
      const inv = 1 / spec.pixels;
      ctx.strokeStyle = TOKENS.ink;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let c = 0; c < NCH; c++) {
        const y = Y(spec.hist[c] * inv);
        if (c === 0) ctx.moveTo(xs[c], y);
        else ctx.lineTo(xs[c], y);
      }
      ctx.stroke();
    }
    ctx.restore();
    if (s.E0 <= SPEC.e1) {
      const x = X(s.E0);
      ctx.strokeStyle = s.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, F.rY1);
      ctx.lineTo(x, F.y0);
      ctx.stroke();
    }
    this.legend(ctx, s);
    this.peakLabels(ctx, s, X, Y, F.y1, F.x0, F.x1);
  }

  /** legend with a backing box; top-left on wide plots, top-right on narrow ones (the 10–14 keV region is quiet) */
  private legend(ctx: CanvasRenderingContext2D, s: SpecState): void {
    const F = this.F;
    const spc = s.depth === 'specialist';
    const t1 = spc ? 'map average (Σ / N px)' : 'whole map (average)';
    const t2 = spc ? 'beam position (1 Poisson draw)' : 'the spot under the beam';
    ctx.font = `500 10.5px ${FONT}`;
    const bw = 19 + Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 8;
    const narrow = F.x1 - F.x0 < 480;
    const bx = narrow ? F.x1 - bw - 4 : F.x0 + 4;
    const by = F.y1 + 2;
    ctx.fillStyle = 'rgba(5,8,14,0.72)';
    ctx.fillRect(bx, by, bw, 31);
    const lgx = bx + 5;
    let lgy = by + 12;
    ctx.fillStyle = TOKENS.ink;
    ctx.fillRect(lgx, lgy - 4, 14, 2);
    txt(ctx, t1, lgx + 19, lgy, { size: 10.5, c: TOKENS.ink2 });
    lgy += 14;
    ctx.fillStyle = s.accent;
    for (const [dx, dy] of [
      [0, -2],
      [4, -6],
      [8, -3],
      [12, -7],
    ]) ctx.fillRect(lgx + dx, lgy + dy - 1, 2.2, 2.2);
    txt(ctx, t2, lgx + 19, lgy, { size: 10.5, c: TOKENS.ink2 });
    this.legendBox = { x0: bx, x1: bx + bw, y0: by, y1: by + 31 };
  }

  private peakLabels(ctx: CanvasRenderingContext2D, s: SpecState, X: (e: number) => number, Y: (v: number) => number, yTop: number, xL: number, xR: number): void {
    const spec = s.spec;
    const spc = s.depth === 'specialist';
    const cand: { e: number; text: string; color: string; pri: number }[] = [];
    const ex = (k: ElKey) => s.excited[EL_KEYS.indexOf(k)];
    for (const k of ['Ni', 'Co', 'Mn'] as const) {
      if (!ex(k)) continue;
      const L = ELEMENTS[k].lines;
      cand.push({ e: L[0].e, text: spc ? `${k} Kα` : k, color: ELEMENTS[k].color, pri: 3 });
      if (spc && xR - xL > 520) cand.push({ e: L[2].e, text: `${k} Kβ`, color: ELEMENTS[k].color, pri: 1 });
    }
    if (ex('W')) {
      cand.push({ e: 8.3976, text: spc ? 'W Lα' : 'W', color: ELEMENTS.W.color, pri: 2 });
      if (s.E0 > W_EDGES.L2) cand.push({ e: 9.6724, text: spc ? 'W Lβ' : 'W', color: ELEMENTS.W.color, pri: 2 });
      if (spc && s.E0 > W_EDGES.L2 && xR - xL > 400) cand.push({ e: 11.2852, text: 'W Lγ', color: ELEMENTS.W.color, pri: 1 });
    }
    if (s.E0 <= SPEC.e1 + 0.2) {
      const ec = comptonE(s.E0);
      if (spc) {
        cand.push({ e: ec, text: 'Compton', color: '#9aa6b8', pri: 1 });
        cand.push({ e: s.E0, text: 'Rayleigh', color: '#9aa6b8', pri: 0 });
      } else cand.push({ e: (s.E0 + ec) / 2, text: 'scattered beam', color: '#9aa6b8', pri: 1 });
    }
    // height: top of the measured / expected curve near the line
    const tmp = this.tmp;
    spec.expectedInto(s.mean, tmp);
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [{ ...this.legendBox }];
    cand.sort((a, b) => b.pri - a.pri || a.e - b.e);
    ctx.font = `650 10.5px ${FONT}`;
    for (const c of cand) {
      const ch = Math.round((c.e - SPEC.e0) / SPEC.de);
      if (ch < 0 || ch >= NCH) continue;
      let peak = 0;
      for (let k = Math.max(0, ch - 8); k < Math.min(NCH, ch + 8); k++) peak = Math.max(peak, tmp[k], spec.pixels ? spec.hist[k] / spec.pixels : 0);
      if (peak <= 0) continue;
      const x = X(c.e);
      const tw = ctx.measureText(c.text).width;
      let lx = Math.max(xL + 2, Math.min(xR - tw - 2, x - tw / 2));
      let y = Y(peak) - 5;
      let ok = false;
      for (let tries = 0; tries < 6; tries++) {
        const box = { x0: lx - 2, x1: lx + tw + 2, y0: y - 11, y1: y + 2 };
        if (box.y0 < yTop + 2) {
          y = yTop + 13;
          box.y0 = y - 11;
          box.y1 = y + 2;
        }
        const hit = placed.find((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
        if (!hit) {
          placed.push(box);
          ok = true;
          break;
        }
        y = hit.y0 - 3;
        if (y - 11 < yTop + 2) {
          // try a small sideways nudge (never far from its own peak)
          const nx = c.e > (SPEC.e0 + SPEC.e1) / 2 ? hit.x0 - tw - 4 : hit.x1 + 4;
          if (Math.abs(nx + tw / 2 - x) > tw / 2 + 14) break;
          lx = nx;
          y = Y(peak) - 5;
        }
      }
      if (!ok) continue;
      ctx.fillStyle = 'rgba(5,8,14,0.65)';
      ctx.fillRect(lx - 2, y - 10, tw + 4, 13);
      txt(ctx, c.text, lx, y, { size: 10.5, w: 650, c: c.color });
    }
  }
}

// ============================================================================================ time meter (DOM)

export interface TimeMeter {
  el: HTMLElement;
  set(tU: number, tA: number, fmt: (s: number) => string, opts: { insituStep?: number; selected: 'apsu' | 'aps'; uStage?: boolean; gain?: number }): void;
  setHead(t: string): void;
}

/** two log-scale bars: map time on APS-U vs APS for the same counts */
export function timeMeter(parent: HTMLElement, accent: string): TimeMeter {
  const LMIN = -1;
  const LMAX = Math.log10(86400 * 7);
  const fr = (s: number) => Math.max(0, Math.min(1, (Math.log10(Math.max(s, 0.1)) - LMIN) / (LMAX - LMIN)));
  const box = document.createElement('div');
  box.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px 9px 6px;border-radius:8px;background:rgba(255,255,255,.035);border:1px solid rgba(150,180,220,.1)';
  const head = document.createElement('div');
  head.style.cssText = 'font-size:11.5px;color:#8394a9;line-height:1.3';
  box.appendChild(head);
  const rows: { bar: HTMLElement; val: HTMLElement; lab: HTMLElement }[] = [];
  const trackWrap: HTMLElement[] = [];
  for (const [name, col] of [
    ['APS-U', accent],
    ['APS', TOKENS.old],
  ] as const) {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:40px 1fr 54px;align-items:center;gap:6px';
    const lab = document.createElement('span');
    lab.textContent = name;
    lab.style.cssText = `font:600 11.5px var(--font);color:${col}`;
    const track = document.createElement('div');
    track.style.cssText = 'position:relative;height:9px;border-radius:5px;background:rgba(150,180,220,.13);overflow:visible';
    const bar = document.createElement('i');
    bar.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:0;border-radius:5px;background:${col};transition:width .35s`;
    track.appendChild(bar);
    trackWrap.push(track);
    const val = document.createElement('span');
    val.style.cssText = 'font:12px var(--mono);color:#e9eef5;text-align:right;white-space:nowrap';
    row.append(lab, track, val);
    box.appendChild(row);
    rows.push({ bar, val, lab });
  }
  // tick labels under the bars
  const ticks = document.createElement('div');
  ticks.style.cssText = 'position:relative;height:13px;margin:0 60px 0 46px;font:10px var(--font);color:#8394a9';
  for (const [s, t] of [
    [1, '1 s'],
    [60, '1 min'],
    [3600, '1 h'],
    [86400, '1 d'],
  ] as const) {
    const sp = document.createElement('span');
    sp.textContent = t;
    sp.style.cssText = `position:absolute;left:${(fr(s) * 100).toFixed(1)}%;transform:translateX(-50%);white-space:nowrap`;
    ticks.appendChild(sp);
    for (const tr of trackWrap) {
      const tk = document.createElement('i');
      tk.style.cssText = `position:absolute;left:${(fr(s) * 100).toFixed(1)}%;top:-2px;bottom:-2px;width:1px;background:rgba(233,238,245,.22)`;
      tr.appendChild(tk);
    }
  }
  box.appendChild(ticks);
  // in situ marker (one cell step)
  const marks = trackWrap.map((tr) => {
    const m = document.createElement('i');
    m.style.cssText = `position:absolute;top:-4px;bottom:-4px;width:2px;background:${TOKENS.warn};display:none`;
    tr.appendChild(m);
    return m;
  });
  const foot = document.createElement('div');
  foot.style.cssText = 'font-size:11px;color:#b7c3d2;line-height:1.35';
  box.appendChild(foot);
  box.setAttribute('role', 'group');
  parent.appendChild(box);
  return {
    el: box,
    setHead: (t) => (head.textContent = t),
    set(tU, tA, fmt, o) {
      rows[0].bar.style.width = `${(fr(tU) * 100).toFixed(1)}%`;
      rows[1].bar.style.width = `${(fr(tA) * 100).toFixed(1)}%`;
      rows[0].val.textContent = fmt(tU);
      rows[1].val.textContent = fmt(tA);
      rows[0].lab.style.textDecoration = o.selected === 'apsu' ? 'underline' : 'none';
      rows[1].lab.style.textDecoration = o.selected === 'aps' ? 'underline' : 'none';
      const ratio = tA / tU;
      const rs = ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1);
      let msg =
        o.uStage && o.gain
          ? `APS-U is only ${rs}× faster here: it collects these few X-rays ${Math.round(o.gain)}× faster, but the scanning stage tops out at 1 mm/s.`
          : `APS-U is ${rs}× faster for these maps.`;
      for (const m of marks) m.style.display = o.insituStep ? 'block' : 'none';
      if (o.insituStep) {
        for (const m of marks) m.style.left = `calc(${(fr(o.insituStep) * 100).toFixed(1)}% - 1px)`;
        if (tA > o.insituStep) msg += ` The old APS is slower than the battery changes (yellow mark: one step ≈ ${fmt(o.insituStep)}).`;
      }
      foot.textContent = msg;
      box.setAttribute('aria-label', `Time for this map: APS-U ${fmt(tU)}, APS ${fmt(tA)}`);
    },
  };
}
