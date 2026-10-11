/**
 * Panel 2 of the brightness station: design brilliance vs photon energy, APS (pre-2023) vs APS-U, log–log, with
 * the APS-U ÷ APS gain below. Data: physics.ENVELOPE (IPAC'21 Fig. 1, digitized) or physics.DEVICES (FDR 2019
 * Fig. 2.1). Monotone-cubic curves through the digitized points (dots). Dashed gain curve = the source-size /
 * divergence term alone for panel 1's source vs the APS-2019 electron beam (same flux, L = 2.4 m, Kim's photon
 * beam) — the "brighter" part; the gap up to the design curve is "more" photons (2× current, new undulators).
 * Mouse hover reads values; click/drag (or arrow keys when focused) picks the energy.
 */
import { TOKENS, type Canvas2D } from '../kit';
import * as P from './physics';
import { approxGain, fmtKeV, sci, sup } from './format';
import { withAlpha } from './source';

export const E_MIN = 1;
export const E_MAX = 120;
const NE = 260;
const B_LO = 18;
const B_HI = 23;
const G_LO = 0; // ×1
const G_HI = Math.log10(3000);
/** gain at or above which the "≈500×" zone is shaded (digitized data are ±20 % each, so ±30 % on the ratio) */
export const ZONE_GAIN = 450;
const GAIN_TITLE = 'How many times brighter: APS-U ÷ APS';

export interface ChartState {
  E: number;
  ds: 'envelope' | 'devices';
  /** panel-1 electron beam (for the source-only gain curve) */
  src: P.Beam;
  srcKey: string;
}

interface Pre {
  ds: P.DataSet;
  old: Float64Array;
  neu: Float64Array[];
  best: Float64Array;
  gain: Float64Array;
  oldF: (E: number) => number;
  neuF: ((E: number) => number)[];
  zones: [number, number][];
}

interface Lay {
  x0: number;
  x1: number;
  mTop: number;
  mBot: number;
  gTop: number;
  gBot: number;
  W: number;
  H: number;
  legendRows: number;
}

export class BrillianceChart {
  needsDraw = true;
  hoverE: number | null = null;
  private es = new Float64Array(NE);
  private srcGain = new Float64Array(NE);
  private srcKey = '';
  private pre: Record<'envelope' | 'devices', Pre>;
  private st: ChartState;
  private lay: Lay | null = null;
  private dragging = false;
  private g: CanvasRenderingContext2D;
  /** label rectangles drawn this frame (for collision avoidance) */
  private occ: { x0: number; y0: number; x1: number; y1: number }[] = [];

  constructor(
    private c: Canvas2D,
    private accent: string,
    private onPick: (E: number) => void,
    init: ChartState,
  ) {
    this.g = c.ctx;
    this.st = init;
    for (let i = 0; i < NE; i++) this.es[i] = E_MIN * Math.pow(E_MAX / E_MIN, i / (NE - 1));
    this.pre = { envelope: this.prepare(P.ENVELOPE), devices: this.prepare(P.DEVICES) };
    this.updateSrc();
    const cv = c.canvas;
    cv.style.cursor = 'crosshair';
    cv.tabIndex = 0;
    cv.style.outline = 'none';
    const eAt = (ev: PointerEvent): number | null => {
      const L = this.lay;
      if (!L) return null;
      const r = cv.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const t = (x - L.x0) / Math.max(1, L.x1 - L.x0);
      if (t < -0.04 || t > 1.04) return null;
      return E_MIN * Math.pow(E_MAX / E_MIN, Math.max(0, Math.min(1, t)));
    };
    cv.addEventListener('pointerdown', (ev) => {
      const E = eAt(ev);
      if (E === null) return;
      this.dragging = true;
      cv.setPointerCapture(ev.pointerId);
      this.onPick(E);
    });
    cv.addEventListener('pointermove', (ev) => {
      const E = eAt(ev);
      if (this.dragging && E !== null) this.onPick(E);
      if (ev.pointerType === 'mouse') {
        this.hoverE = this.dragging ? null : E;
        this.needsDraw = true;
      }
    });
    const end = (ev: PointerEvent) => {
      this.dragging = false;
      if (cv.hasPointerCapture(ev.pointerId)) cv.releasePointerCapture(ev.pointerId);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => {
      this.hoverE = null;
      this.needsDraw = true;
    });
    cv.addEventListener('keydown', (ev) => {
      const f = ev.shiftKey ? 1.25 : 1.04;
      let E = this.st.E;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') E *= f;
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') E /= f;
      else if (ev.key === 'Home') E = E_MIN;
      else if (ev.key === 'End') E = E_MAX;
      else return;
      ev.preventDefault();
      this.onPick(Math.max(E_MIN, Math.min(E_MAX, E)));
    });
    cv.addEventListener('focus', () => (this.needsDraw = true));
    cv.addEventListener('blur', () => (this.needsDraw = true));
  }

  private prepare(ds: P.DataSet): Pre {
    const oldF = P.seriesCurve(ds.old);
    const neuF = ds.neu.map((s) => P.seriesCurve(s));
    const old = new Float64Array(NE);
    const neu = ds.neu.map(() => new Float64Array(NE));
    const best = new Float64Array(NE);
    const gain = new Float64Array(NE);
    const zones: [number, number][] = [];
    let zStart = -1;
    for (let i = 0; i < NE; i++) {
      const E = this.es[i];
      old[i] = oldF(E);
      for (let k = 0; k < neu.length; k++) neu[k][i] = neuF[k](E);
      best[i] = P.bestNew(ds, neuF, E);
      gain[i] = best[i] / old[i];
      const inZone = gain[i] >= ZONE_GAIN;
      if (inZone && zStart < 0) zStart = E;
      if ((!inZone || i === NE - 1) && zStart > 0) {
        zones.push([zStart, inZone ? E : this.es[i - 1]]);
        zStart = -1;
      }
    }
    return { ds, old, neu, best, gain, oldF, neuF, zones };
  }

  private updateSrc(): void {
    if (this.st.srcKey === this.srcKey) return;
    this.srcKey = this.st.srcKey;
    for (let i = 0; i < NE; i++) this.srcGain[i] = P.sourceGain(this.st.src, P.APS_2019.e, this.es[i]);
  }

  set(s: ChartState): void {
    this.st = s;
    this.updateSrc();
    this.needsDraw = true;
  }

  /** values at energy E for the current data set */
  valuesAt(E: number): { old: number; neu: number[]; best: number; gain: number; src: number } {
    const p = this.pre[this.st.ds];
    const neu = p.neuF.map((f) => f(E));
    const best = P.bestNew(p.ds, p.neuF, E);
    const old = p.oldF(E);
    return { old, neu, best, gain: best / old, src: P.sourceGain(this.st.src, P.APS_2019.e, E) };
  }

  zones(): [number, number][] {
    return this.pre[this.st.ds].zones;
  }

  private layout(): Lay {
    const W = this.c.w;
    const H = this.c.h;
    const x0 = 50;
    const x1 = W - 14;
    const legendRows = this.legendRows(W);
    const mTop = 44 + legendRows * 15;
    const bottomPad = 38;
    const avail = H - mTop - bottomPad;
    const mBot = mTop + Math.round(avail * 0.6);
    const gTop = mBot + 30;
    const gBot = H - bottomPad;
    return { x0, x1, mTop, mBot, gTop, gBot, W, H, legendRows };
  }

  private legendItems(): { label: string; color: string; dash?: number[] }[] {
    const items: { label: string; color: string; dash?: number[] }[] =
      this.st.ds === 'envelope'
        ? [
            { label: 'APS before the upgrade (7 GeV, 100 mA)', color: TOKENS.old },
            { label: 'APS-U (6 GeV, 200 mA)', color: this.accent },
          ]
        : [
            { label: 'APS: 3.3 & 2.7 cm periods', color: TOKENS.old },
            { label: 'APS-U magnets: 2.8 & 2.5 cm', color: this.accent },
            { label: 'superconducting: 2.05 & 1.55 cm', color: this.accent, dash: [5, 4] },
          ];
    items.push({ label: 'design report, 20 keV', color: '#ffffff', dash: [0, 99] });
    return items;
  }

  /** number of legend rows needed at width W (same flow rule as the drawing code) */
  private legendRows(W: number): number {
    const g = this.g;
    g.font = `500 11px ${TOKENS.font}`;
    const xStart = 50 - 36;
    const xEnd = W - 14;
    let x = xStart;
    let rows = 1;
    for (const it of this.legendItems()) {
      const w = g.measureText(it.label).width + 30;
      if (x + w > xEnd && x > xStart) {
        x = xStart;
        rows++;
      }
      x += w;
    }
    return rows;
  }

  draw(): void {
    this.needsDraw = false;
    const g = this.g;
    const L = (this.lay = this.layout());
    const p = this.pre[this.st.ds];
    const px = (E: number) => L.x0 + (Math.log10(E / E_MIN) / Math.log10(E_MAX / E_MIN)) * (L.x1 - L.x0);
    const pyM = (B: number) => L.mBot - ((Math.log10(B) - B_LO) / (B_HI - B_LO)) * (L.mBot - L.mTop);
    const pyG = (G: number) => L.gBot - ((Math.log10(G) - G_LO) / (G_HI - G_LO)) * (L.gBot - L.gTop);
    g.clearRect(0, 0, L.W, L.H);
    this.occ.length = 0;

    const txt = (t: string, x: number, y: number, o: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline; mono?: boolean } = {}) => {
      g.font = `${o.weight ?? 500} ${o.size ?? 10.5}px ${o.mono ? TOKENS.mono : TOKENS.font}`;
      g.fillStyle = o.color ?? TOKENS.ink3;
      g.textAlign = o.align ?? 'left';
      g.textBaseline = o.base ?? 'middle';
      g.fillText(t, x, y);
      return g.measureText(t).width;
    };

    // ---------------------------------------------------------- legend
    const items = this.legendItems();
    {
      let x = L.x0 - 36;
      let y = 37;
      g.font = `500 11px ${TOKENS.font}`;
      for (const it of items) {
        const w = g.measureText(it.label).width + 30;
        if (x + w > L.x1 && x > L.x0 - 36) {
          x = L.x0 - 36;
          y += 15;
        }
        if (it.dash && it.dash[0] === 0) {
          // marker-only item (diamond)
          g.save();
          g.translate(x + 8, y);
          g.rotate(Math.PI / 4);
          g.strokeStyle = it.color;
          g.lineWidth = 1.5;
          g.strokeRect(-3.5, -3.5, 7, 7);
          g.restore();
        } else {
          g.strokeStyle = it.color;
          g.lineWidth = 2.2;
          g.setLineDash(it.dash ?? []);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + 16, y);
          g.stroke();
          g.setLineDash([]);
        }
        txt(it.label, x + 21, y, { size: 11, color: TOKENS.ink2 });
        x += w;
      }
    }

    // ---------------------------------------------------------- frames & grids
    const frame = (top: number, bot: number) => {
      g.fillStyle = 'rgba(14,21,33,0.55)';
      g.fillRect(L.x0, top, L.x1 - L.x0, bot - top);
    };
    frame(L.mTop, L.mBot);
    frame(L.gTop, L.gBot);
    // ≈500× zones (both plots)
    for (const [a, b] of p.zones) {
      const xa = px(a);
      const xb = px(b);
      g.fillStyle = withAlpha(this.accent, 0.07);
      g.fillRect(xa, L.mTop, xb - xa, L.mBot - L.mTop);
      g.fillStyle = withAlpha(this.accent, 0.12);
      g.fillRect(xa, L.gTop, xb - xa, L.gBot - L.gTop);
    }
    const xTicks = [1, 2, 5, 10, 20, 50, 100];
    g.strokeStyle = TOKENS.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (const E of xTicks) {
      const x = Math.round(px(E)) + 0.5;
      g.moveTo(x, L.mTop);
      g.lineTo(x, L.mBot);
      g.moveTo(x, L.gTop);
      g.lineTo(x, L.gBot);
    }
    for (let e = B_LO; e <= B_HI; e++) {
      const y = Math.round(pyM(Math.pow(10, e))) + 0.5;
      g.moveTo(L.x0, y);
      g.lineTo(L.x1, y);
    }
    for (const G of [1, 10, 100, 1000]) {
      const y = Math.round(pyG(G)) + 0.5;
      g.moveTo(L.x0, y);
      g.lineTo(L.x1, y);
    }
    g.stroke();
    // axes
    g.strokeStyle = TOKENS.axis;
    g.beginPath();
    g.moveTo(L.x0 + 0.5, L.mTop);
    g.lineTo(L.x0 + 0.5, L.mBot + 0.5);
    g.lineTo(L.x1, L.mBot + 0.5);
    g.moveTo(L.x0 + 0.5, L.gTop);
    g.lineTo(L.x0 + 0.5, L.gBot + 0.5);
    g.lineTo(L.x1, L.gBot + 0.5);
    g.stroke();
    for (let e = B_LO; e <= B_HI; e++) txt(`10${sup(e)}`, L.x0 - 6, pyM(Math.pow(10, e)), { align: 'right', size: 10.5 });
    for (const G of [1, 10, 100, 1000]) txt(`×${G.toLocaleString('en-US')}`, L.x0 - 6, pyG(G), { align: 'right', size: 10.5 });
    for (const E of xTicks) txt(`${E}`, px(E), L.gBot + 15, { align: 'center', size: 10.5 });
    txt('X-ray photon energy (keV)  →  shorter waves', (L.x0 + L.x1) / 2, L.H - 10, { align: 'center', size: 11, color: TOKENS.ink2 });
    // y-axis title (main)
    g.save();
    g.translate(11, (L.mTop + L.mBot) / 2);
    g.rotate(-Math.PI / 2);
    txt(L.mBot - L.mTop >= 250 ? 'brightness, ph/s/mm²/mrad²/0.1%BW' : 'ph/s/mm²/mrad²/0.1%BW', 0, 0, { align: 'center', size: 10.5, color: TOKENS.ink2 });
    g.restore();
    // gain plot title
    txt(GAIN_TITLE, L.x0, L.gTop - 11, { size: 11.5, weight: 600, color: TOKENS.ink });

    // ---------------------------------------------------------- curves (clipped)
    const curve = (ys: Float64Array, py: (v: number) => number, color: string, w: number, dash: number[] = [], top = L.mTop, bot = L.mBot) => {
      g.save();
      g.beginPath();
      g.rect(L.x0, top - 1, L.x1 - L.x0, bot - top + 2);
      g.clip();
      g.strokeStyle = color;
      g.lineWidth = w;
      g.lineJoin = 'round';
      g.setLineDash(dash);
      g.beginPath();
      let on = false;
      for (let i = 0; i < NE; i++) {
        const v = ys[i];
        if (!Number.isFinite(v) || v <= 0) {
          on = false;
          continue;
        }
        const x = px(this.es[i]);
        const y = py(v);
        if (!on) g.moveTo(x, y);
        else g.lineTo(x, y);
        on = true;
      }
      g.stroke();
      g.restore();
    };
    const dotsOf = (s: P.Series, color: string) => {
      g.fillStyle = color;
      for (let i = 0; i < s.E.length; i++) {
        const b = s.B[i];
        if (b === null) continue;
        const y = pyM(b);
        if (y < L.mTop || y > L.mBot) continue;
        g.beginPath();
        g.arc(px(s.E[i]), y, 2.3, 0, Math.PI * 2);
        g.fill();
      }
    };
    curve(p.old, pyM, TOKENS.old, 2);
    p.neu.forEach((ys, k) => curve(ys, pyM, this.accent, 2.4, k === 1 ? [6, 4] : []));
    dotsOf(p.ds.old, TOKENS.old);
    p.ds.neu.forEach((s) => dotsOf(s, this.accent));

    // design-report anchor at 20 keV (FDR 2019 Table 1.1)
    {
      const a = P.FDR_20KEV;
      const dia = (E: number, B: number, color: string) => {
        const x = px(E);
        const y = pyM(B);
        g.save();
        g.translate(x, y);
        g.rotate(Math.PI / 4);
        g.strokeStyle = color;
        g.lineWidth = 1.6;
        g.strokeRect(-3.5, -3.5, 7, 7);
        g.restore();
      };
      dia(a.E, a.aps, TOKENS.old);
      dia(a.E, a.apsuBrightness, '#ffffff');
    }

    // gain curves
    curve(this.srcGain, pyG, withAlpha(this.accent, 0.9), 1.6, [4, 4], L.gTop, L.gBot);
    curve(p.gain, pyG, this.accent, 2.4, [], L.gTop, L.gBot);
    // ×500 reference
    {
      const y = Math.round(pyG(500)) + 0.5;
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(L.x0, y);
      g.lineTo(L.x1, y);
      g.stroke();
      g.setLineDash([]);
    }
    // gain legend (top-right of the gain plot title row)
    {
      let lab = 'panel 1’s source alone, same photons';
      g.font = `500 10.5px ${TOKENS.font}`;
      let w = g.measureText(lab).width;
      const xr = L.x1;
      g.strokeStyle = this.accent;
      g.lineWidth = 1.6;
      g.setLineDash([4, 4]);
      g.beginPath();
      const titleW = (() => {
        g.font = `600 11.5px ${TOKENS.font}`;
        return g.measureText(GAIN_TITLE).width;
      })();
      const fits = xr - w - 24 > L.x0 + titleW + 10;
      if (!fits) {
        lab = 'source alone';
        g.font = `500 10.5px ${TOKENS.font}`;
        w = g.measureText(lab).width;
      }
      const ly = fits ? L.gTop - 11 : L.gBot - 9;
      const lx = fits ? xr - w - 22 : L.x1 - w - 26;
      g.moveTo(lx, ly);
      g.lineTo(lx + 16, ly);
      g.stroke();
      g.setLineDash([]);
      txt(lab, lx + 21, ly, { size: 10.5, color: TOKENS.ink2 });
      this.occ.push({ x0: lx - 2, y0: ly - 7, x1: lx + 23 + w, y1: ly + 7 });
    }

    // ---------------------------------------------------------- selected energy
    const E = this.st.E;
    const v = this.valuesAt(E);
    const xe = px(E);
    g.strokeStyle = withAlpha(this.accent, 0.85);
    g.lineWidth = 1.2;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(xe + 0.5, L.mTop);
    g.lineTo(xe + 0.5, L.mBot);
    g.moveTo(xe + 0.5, L.gTop);
    g.lineTo(xe + 0.5, L.gBot);
    g.stroke();
    g.setLineDash([]);
    // handle on the axis
    g.fillStyle = this.accent;
    g.beginPath();
    g.moveTo(xe, L.gBot + 1);
    g.lineTo(xe - 5, L.gBot + 8);
    g.lineTo(xe + 5, L.gBot + 8);
    g.closePath();
    g.fill();
    // selected value markers + bracket
    const yo = Number.isFinite(v.old) ? pyM(v.old) : NaN;
    const yn = Number.isFinite(v.best) ? pyM(v.best) : NaN;
    if (Number.isFinite(yo) && Number.isFinite(yn)) {
      g.strokeStyle = withAlpha(this.accent, 0.6);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(xe, yo - 5);
      g.lineTo(xe, yn + 5);
      g.stroke();
    }
    const knob = (x: number, y: number, color: string) => {
      if (!Number.isFinite(y) || y < L.mTop - 2 || y > L.gBot + 2) return;
      g.fillStyle = color;
      g.strokeStyle = '#05080e';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    };
    knob(xe, yo, TOKENS.old);
    knob(xe, yn, this.accent);
    for (const y of [yo, yn]) if (Number.isFinite(y)) this.occ.push({ x0: xe - 6, y0: y - 6, x1: xe + 6, y1: y + 6 });
    const pillSide = xe > (L.x0 + L.x1) / 2 ? -1 : 1;
    if (Number.isFinite(yn)) this.pill(sci(v.best, 2), xe + pillSide * 9, yn, pillSide, this.accent, L.mTop + 9, L.mBot - 9);
    if (Number.isFinite(yo)) this.pill(sci(v.old, 2), xe + pillSide * 9, yo, pillSide, TOKENS.old, L.mTop + 9, L.mBot - 9);
    // gain markers
    if (Number.isFinite(v.gain)) {
      const yg = pyG(v.gain);
      knob(xe, yg, this.accent);
      // rounded to what the design data support (±30 % on the ratio), as in the text
      this.pill(`≈ ×${approxGain(v.gain)}`, xe + pillSide * 9, yg, pillSide, this.accent, L.gTop + 9, L.gBot - 9, true);
    }
    if (Number.isFinite(v.src)) {
      const ys = pyG(Math.max(1, Math.min(Math.pow(10, G_HI), v.src)));
      g.strokeStyle = this.accent;
      g.fillStyle = '#05080e';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(xe, ys, 3.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (!Number.isFinite(v.old) || !Number.isFinite(v.best)) {
      // bottom of the main plot, clear of the value pills
      const msg = Number.isFinite(v.best) ? 'no old-APS design data at this energy' : 'no design data at this energy';
      g.font = `500 10.5px ${TOKENS.font}`;
      const mw = g.measureText(msg).width;
      const mx0 = pillSide > 0 ? xe + 8 : xe - 8 - mw;
      const free = (y: number) => !this.occ.some((o) => mx0 < o.x1 && mx0 + mw > o.x0 && y - 7 < o.y1 && y + 7 > o.y0);
      const my = free(L.mTop + 14) ? L.mTop + 14 : L.mBot - 12;
      txt(msg, xe + pillSide * 8, my, { align: pillSide > 0 ? 'left' : 'right', size: 10.5, color: TOKENS.ink3 });
    }

    // ≈500× zone label: first free spot (top, then bottom of the gain plot) that avoids pills, legend and cursor
    if (p.zones.length) {
      const label = '≈ 500× and more';
      g.font = `700 10.5px ${TOKENS.font}`;
      const w = g.measureText(label).width;
      const zs = [...p.zones].sort((a, b) => px(b[1]) - px(b[0]) - (px(a[1]) - px(a[0])));
      this.occ.push({ x0: xe - 3, y0: L.gTop, x1: xe + 3, y1: L.gBot });
      const cands: [number, number][] = [];
      for (const y of [L.gTop + 9, L.gBot - 9, (L.gTop + L.gBot) / 2])
        for (const z of zs) {
          const za = px(z[0]);
          const zb = px(z[1]);
          cands.push([(za + zb) / 2, y], [za + w / 2 + 4, y], [zb - w / 2 - 4, y]);
        }
      // does a gain curve pass through the label box?
      const crosses = (r: { x0: number; y0: number; x1: number; y1: number }) => {
        for (let k = 0; k <= 6; k++) {
          const t = (r.x0 + ((r.x1 - r.x0) * k) / 6 - L.x0) / Math.max(1, L.x1 - L.x0);
          const i = Math.round(Math.max(0, Math.min(1, t)) * (NE - 1));
          for (const ys of [p.gain, this.srcGain]) {
            const val = ys[i];
            if (!Number.isFinite(val) || val <= 0) continue;
            const yy = pyG(val);
            if (yy > r.y0 - 3 && yy < r.y1 + 3) return true;
          }
        }
        return false;
      };
      for (const [xm, y] of cands) {
        const cx = Math.min(L.x1 - 4 - w / 2, Math.max(L.x0 + 4 + w / 2, xm));
        const r = { x0: cx - w / 2 - 2, y0: y - 7, x1: cx + w / 2 + 2, y1: y + 7 };
        if (this.occ.some((o) => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0)) continue;
        if (crosses(r)) continue;
        txt(label, cx, y, { align: 'center', size: 10.5, weight: 700, color: this.accent });
        break;
      }
    }

    // ---------------------------------------------------------- hover read-out
    const hE = this.hoverE;
    if (hE !== null) {
      const xh = px(hE);
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.round(xh) + 0.5, L.mTop);
      g.lineTo(Math.round(xh) + 0.5, L.mBot);
      g.moveTo(Math.round(xh) + 0.5, L.gTop);
      g.lineTo(Math.round(xh) + 0.5, L.gBot);
      g.stroke();
      const hv = this.valuesAt(hE);
      const rows: [string, string, string][] = [];
      rows.push([`${fmtKeV(hE)} keV`, '', TOKENS.ink]);
      const neuLabels = this.st.ds === 'envelope' ? ['APS-U'] : ['APS-U magnets', 'APS-U SC'];
      if (Number.isFinite(hv.old)) rows.push(['APS', sci(hv.old, 2), TOKENS.old]);
      hv.neu.forEach((b, k) => {
        if (Number.isFinite(b)) rows.push([neuLabels[k], sci(b, 2), this.accent]);
      });
      if (Number.isFinite(hv.gain)) rows.push(['APS-U ÷ APS', `≈ ×${approxGain(hv.gain)}`, '#ffffff']);
      if (rows.length === 1) rows.push(['no data', '', TOKENS.ink3]);
      this.tooltip(rows, xh, L);
    }

    // focus ring
    if (document.activeElement === this.c.canvas) {
      g.strokeStyle = withAlpha(this.accent, 0.7);
      g.lineWidth = 2;
      g.strokeRect(1, 1, L.W - 2, L.H - 2);
    }
  }

  private pill(t: string, x: number, y: number, side: number, color: string, yMin: number, yMax: number, big = false): void {
    const g = this.g;
    g.font = `${big ? 700 : 600} ${big ? 12 : 11}px ${TOKENS.mono}`;
    const w = g.measureText(t).width + 12;
    const h = big ? 19 : 17;
    const yy = Math.max(yMin, Math.min(yMax, y));
    const x0 = side > 0 ? x : x - w;
    this.occ.push({ x0, y0: yy - h / 2, x1: x0 + w, y1: yy + h / 2 });
    g.fillStyle = 'rgba(5,8,14,0.88)';
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(x0, yy - h / 2, w, h, 5);
    g.fill();
    g.stroke();
    g.fillStyle = color === TOKENS.old ? TOKENS.ink2 : '#ffffff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(t, x0 + 6, yy + 0.5);
  }

  private tooltip(rows: [string, string, string][], xh: number, L: Lay): void {
    const g = this.g;
    g.font = `600 11px ${TOKENS.font}`;
    let wl = 0;
    for (const r of rows) wl = Math.max(wl, g.measureText(r[0]).width);
    g.font = `600 11px ${TOKENS.mono}`;
    let wv = 0;
    for (const r of rows) wv = Math.max(wv, g.measureText(r[1]).width);
    const w = wl + wv + 26;
    const h = rows.length * 16 + 8;
    // first placement (right/left of the cursor, top/bottom of the plot) that stays inside and covers no value pill
    const xs = [xh + 12, xh - 12 - w].filter((x) => x >= L.x0 + 2 && x + w <= L.x1 - 2);
    if (!xs.length) xs.push(Math.max(L.x0 + 2, Math.min(L.x1 - 2 - w, xh + 12)));
    const ys = [L.mTop + 6, L.mBot - 6 - h, Math.round((L.mTop + L.mBot - h) / 2)];
    let x = xs[0];
    let y = ys[0];
    search: for (const yy of ys)
      for (const xx of xs)
        if (!this.occ.some((o) => xx < o.x1 + 3 && xx + w > o.x0 - 3 && yy < o.y1 + 3 && yy + h > o.y0 - 3)) {
          x = xx;
          y = yy;
          break search;
        }
    g.fillStyle = 'rgba(8,12,20,0.94)';
    g.strokeStyle = 'rgba(150,180,220,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(x, y, w, h, 7);
    g.fill();
    g.stroke();
    rows.forEach((r, i) => {
      const yy = y + 12 + i * 16;
      g.font = `600 11px ${TOKENS.font}`;
      g.fillStyle = i === 0 ? TOKENS.ink : r[2];
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(r[0], x + 8, yy);
      g.font = `600 11px ${TOKENS.mono}`;
      g.fillStyle = r[2] === TOKENS.old ? TOKENS.ink2 : '#ffffff';
      g.textAlign = 'right';
      g.fillText(r[1], x + w - 8, yy);
    });
  }
}
