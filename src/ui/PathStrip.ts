import { h, icon, svg } from '../lib/dom';
import type { Beamline, BeamlineComponent } from '../data/types';
import type { BeamlineLayout } from '../scene/beamline/layout';
import { categoryIcon, componentKind, componentKindKey } from './categories';
import { formatDist } from './BeamlinePanel';

/** Stop diameter, and the closest two stops on one row may sit (centre to centre), in px. */
const STOP = 24;
const MIN_GAP = 26;
const ROW_H = 38;
/** y of the beam (and stop centres) inside a row: leaves room for enclosure names along the band's top edge */
const BEAM_Y = 25;
const AXIS_H = 20;
/** row-label gutter for multi-row maps (phones narrow it through --strip-gutter in panel.css) */
const GUTTER = 104;
/** room before the first metre (a whole stop fits) and after the last */
const PAD = STOP / 2 + 4;

interface Knot {
  d: number;
  x: number;
}

interface Stop {
  c: BeamlineComponent;
  /** where the 3D model draws it (layout override) */
  d: number;
  row: number;
  x: number;
  n: number;
  el: HTMLButtonElement;
}

/**
 * "Subway map" of the beamline along the bottom of the screen: enclosures as bands, every component as a stop in
 * order along the beam. The axis is in metres at a constant scale except where stops crowd together: there it is
 * stretched just enough that neighbouring stops on a row never overlap (marked on the axis), so every stop stays
 * clickable. Tooltips give each component's documented distance from the source. Click a stop to fly there; the
 * cursor shows where the camera looks.
 */
export class PathStrip {
  readonly el: HTMLElement;
  private scroller: HTMLElement;
  private track: HTMLElement;
  private lanes: HTMLElement;
  private cursor: HTMLElement;
  private b: Beamline | null = null;
  private layout: BeamlineLayout | undefined;
  private knots: Knot[] = [];
  private scale = 9;
  private multiRow = false;
  private stops = new Map<string, Stop>();
  private order: Stop[] = [];
  onSelect: (id: string) => void = () => {};
  onRide: () => void = () => {};
  onOverview: () => void = () => {};

  constructor() {
    this.lanes = h('div', { class: 'strip-lanes' });
    this.track = h('div', { class: 'strip-track' });
    this.cursor = h('div', { class: 'strip-cursor', 'aria-hidden': 'true' });
    this.scroller = h('div', { class: 'strip-scroll', onkeydown: (e: KeyboardEvent) => this.onKey(e) }, this.track);
    this.el = h(
      'div',
      { class: 'strip glass', role: 'navigation', 'aria-label': 'Beamline map from source to detector' },
      h(
        'div',
        { class: 'strip-tools' },
        h('button', { class: 'btn btn-ghost', type: 'button', title: 'Frame the whole beamline (F)', onclick: () => this.onOverview() }, icon('eye', 15), 'Whole beamline'),
        h('button', { class: 'btn btn-ghost', type: 'button', title: 'Move the camera along the X-ray path (R)', onclick: () => this.onRide() }, icon('play', 15), 'Follow X-ray path'),
        h('span', { class: 'flex1' }),
        h(
          'span',
          { class: 'strip-legend' },
          h(
            'span',
            { title: 'White beam: the full undulator spectrum. Pink beam: after a mirror has removed the high-energy part. Monochromatic: a single X-ray energy selected by a crystal or multilayer.' },
            h('i', { class: 'lg-white' }), ' white ', h('i', { class: 'lg-pink' }), ' pink ', h('i', { class: 'lg-mono' }), ' monochromatic',
          ),
          h('span', { title: 'Closely spaced components are drawn farther apart for easier selection. Distance labels use the listed positions.' }, h('i', { class: 'lg-stretch' }), ' stretched'),
        ),
      ),
      this.scroller,
    );
    this.el.inert = true;
  }

  show(b: Beamline, color: string, branchOf: (compId: string) => string | null, branchLabels: Record<string, string> = {}, layout?: BeamlineLayout): void {
    this.el.style.setProperty('--c', color);
    this.el.classList.add('is-open');
    this.el.inert = false;
    // the app calls show() on every view change: rebuild only for a new beamline (keeps focus on the stop just clicked)
    if (this.b === b && this.layout === layout) return;
    this.b = b;
    this.layout = layout;
    this.build(b, branchOf, branchLabels, layout);
  }

  private build(b: Beamline, branchOf: (compId: string) => string | null, branchLabels: Record<string, string>, layout?: BeamlineLayout): void {
    this.stops.clear();
    this.order = [];
    // stops sit where the 3D model puts them (layout overrides) and in the same order, so the numbers match the pins
    const placed: { c: BeamlineComponent; d: number }[] = [];
    for (const c of b.components) {
      const o = layout?.comp?.[c.id];
      const d = o?.distanceM ?? c.distanceM;
      if (o?.hidden || d === null || d === undefined || !Number.isFinite(d)) continue;
      placed.push({ c, d });
    }
    const monoRule = layout?.monoAtM;
    const monoOverride = (br: string) => (typeof monoRule === 'number' ? monoRule : monoRule && br ? monoRule[br] : undefined);
    const branches = Array.from(new Set(placed.map((s) => branchOf(s.c.id) ?? ''))).sort();
    const rows = branches.length ? branches : [''];
    const rowOf = (id: string) => Math.max(0, rows.indexOf(branchOf(id) ?? ''));
    const encs = b.enclosures.filter((e) => e.endM > e.startM && !layout?.enclosure?.[e.name]?.hidden);
    const dMin = Math.min(0, ...placed.map((s) => s.d), ...encs.map((e) => e.startM));
    const dMax = Math.max(b.totalLengthM || 0, ...encs.map((e) => e.endM || 0), ...placed.map((s) => s.d)) * 1.02;
    this.scale = Math.max(9, 860 / Math.max(1, dMax - dMin));
    this.multiRow = rows.length > 1;

    // distance → x: constant scale, stretched locally so stops on one row keep MIN_GAP apart
    const knots: Knot[] = [{ d: dMin, x: PAD }];
    const lastX = new Map<number, number>();
    const sorted = placed.map((s, i) => ({ ...s, i, row: rowOf(s.c.id) })).sort((a, b2) => a.d - b2.d || a.i - b2.i);
    const xs = new Array<number>(placed.length);
    for (const s of sorted) {
      const k = knots[knots.length - 1];
      let x = k.x + (s.d - k.d) * this.scale;
      const lx = lastX.get(s.row);
      if (lx !== undefined && x < lx + MIN_GAP) x = lx + MIN_GAP;
      if (s.d > k.d || x > k.x) knots.push({ d: s.d, x });
      lastX.set(s.row, x);
      xs[s.i] = x;
    }
    this.knots = knots;
    const width = Math.ceil(this.xOf(dMax) + PAD);
    const height = rows.length * ROW_H;
    const x = (d: number) => this.xOf(d);

    this.track.style.gridTemplateColumns = `${this.multiRow ? `var(--strip-gutter, ${GUTTER}px)` : '0px'} ${width}px`;
    this.track.style.gridTemplateRows = `${AXIS_H}px ${height}px`;
    this.lanes.replaceChildren();
    this.lanes.style.height = `${height}px`;

    // scale: ticks every 5 m (labels every 10 m), metre ticks where the map is stretched, and the stretched spans shaded
    const axis = svg('svg', { class: 'strip-axis', width, height: AXIS_H, 'aria-hidden': 'true' });
    for (let i = 1; i < knots.length; i++) {
      const a = knots[i - 1];
      const z = knots[i];
      const natural = (z.d - a.d) * this.scale;
      if (z.x - a.x > natural + 6) axis.appendChild(svg('rect', { class: 'ax-stretch', x: a.x, y: 0, width: z.x - a.x, height: 5 }));
    }
    const first = Math.ceil(dMin);
    for (let d = first; d <= dMax; d++) {
      const major = d % 10 === 0;
      const five = d % 5 === 0;
      const local = x(d + 0.5) - x(d - 0.5);
      if (!five && local < 14) continue;
      axis.appendChild(svg('line', { x1: x(d), x2: x(d), y1: 0, y2: major ? 7 : five ? 5 : 3, stroke: 'currentColor', 'stroke-width': 1, opacity: five ? 1 : 0.6 }));
      if (major) {
        const t = svg('text', { x: x(d) + 2, y: 17, 'font-size': 11, fill: 'currentColor' });
        t.textContent = `${d} m`;
        axis.appendChild(t);
      }
    }

    // rows, each with its beam (same white → pink → mono rule as the 3D scene; the shared row switches on its own optics)
    const gutter = h('div', { class: 'strip-gutter' });
    rows.forEach((br, r) => {
      const top = r * ROW_H;
      const row = h('div', { class: 'strip-row', style: `top:${top}px;height:${ROW_H}px;--beam-y:${BEAM_Y}px` });
      if (rows.length > 1) {
        const label = br ? (branchLabels[br] ?? br) : (layout?.sharedRowLabel ?? 'shared');
        gutter.appendChild(h('div', { class: 'strip-row-label', style: `top:${top + BEAM_Y - 13}px;height:26px`, title: label }, h('span', null, label)));
      }
      const onRow = (c: BeamlineComponent) => (br ? branchOf(c.id) === br || branchOf(c.id) === null : rows.length === 1 || branchOf(c.id) === null);
      const firstMono = monoOverride(br) ?? placed.filter((s) => /monochromator|multilayerMono/.test(String(s.c.category)) && onRow(s.c)).map((s) => s.d).sort((a, b2) => a - b2)[0];
      const rowDs = placed.filter((s) => (branchOf(s.c.id) ?? '') === br || (branchOf(s.c.id) ?? '') === '').map((s) => s.d);
      const start = Math.min(0, ...rowDs);
      const end = Math.max(...rowDs, 10);
      const mono = Math.min(firstMono ?? end, end);
      const firstMirror = placed
        .filter((s) => /^(mirror|kbMirror)$/.test(String(s.c.category)) && s.d < mono && onRow(s.c))
        .map((s) => s.d)
        .sort((a, b2) => a - b2)[0];
      const pink = Math.min(firstMirror ?? mono, mono);
      row.appendChild(h('div', { class: 'strip-beam white', style: `left:${x(start)}px;width:${x(pink) - x(start)}px` }));
      if (pink < mono) row.appendChild(h('div', { class: 'strip-beam pink', style: `left:${x(pink)}px;width:${x(mono) - x(pink)}px` }));
      if (mono < end) row.appendChild(h('div', { class: 'strip-beam mono', style: `left:${x(mono)}px;width:${x(end) - x(mono)}px` }));
      this.lanes.appendChild(row);
    });

    // enclosures: bands, with the name along the band's top edge (clipped before the next name on the same edge)
    const labels: { x0: number; x1: number; top: number; e: (typeof encs)[number] }[] = [];
    for (const e of encs) {
      const r = Math.max(0, rows.indexOf(e.branch ?? ''));
      const top = (rows.length > 1 && e.branch ? r : 0) * ROW_H;
      const hgt = rows.length > 1 && !e.branch ? rows.length * ROW_H : ROW_H;
      const x0 = x(e.startM);
      const x1 = x(e.endM);
      this.lanes.appendChild(h('div', { class: 'strip-enc', style: `left:${x0}px;width:${x1 - x0}px;top:${top + 1}px;height:${hgt - 2}px` }));
      labels.push({ x0, x1, top, e });
    }
    labels.sort((a, b2) => a.top - b2.top || a.x0 - b2.x0);
    labels.forEach((l, i) => {
      const next = labels.slice(i + 1).find((m) => m.top === l.top && m.x0 > l.x0 + 1);
      const w = Math.min(l.x1, next?.x0 ?? Infinity) - l.x0 - 2;
      if (w < 18) return;
      this.lanes.appendChild(h('span', { class: 'strip-enc-label', title: `${l.e.name}: ${l.e.role}`, style: `left:${l.x0}px;top:${l.top + 1}px;max-width:${w}px` }, l.e.name));
    });

    // stops (numbered in pin order; positioned where the model draws them, labelled with the documented distance)
    placed.forEach((s, i) => {
      const row = rowOf(s.c.id);
      const doc = s.c.distanceM;
      const drawn = doc !== null && doc !== undefined && Math.abs(doc - s.d) > 0.05 ? ` (drawn at ${formatDist(s.d)})` : '';
      const where = doc !== null && doc !== undefined ? `${formatDist(doc)} from source` : `drawn at ${formatDist(s.d)}`;
      const btn = h(
        'button',
        {
          class: 'strip-stop',
          type: 'button',
          tabindex: '-1',
          style: `left:${xs[i]}px;top:${row * ROW_H + BEAM_Y}px`,
          title: `${i + 1}. ${s.c.name}\n${componentKind(s.c)} · ${where}${drawn}`,
          'aria-label': `${i + 1}. ${s.c.name}, ${where}`,
          onclick: () => this.onSelect(s.c.id),
          onfocus: () => this.setRoving(s.c.id),
        },
        categoryIcon(componentKindKey(s.c), 14),
      );
      const stop: Stop = { c: s.c, d: s.d, row, x: xs[i], n: i + 1, el: btn };
      this.stops.set(s.c.id, stop);
      this.order.push(stop);
      this.lanes.appendChild(btn);
    });
    this.lanes.appendChild(this.cursor);
    if (this.order[0]) this.order[0].el.tabIndex = 0;

    this.track.replaceChildren(
      h('div', { class: 'strip-corner' }),
      h('div', { class: 'strip-axis-wrap' }, axis),
      rows.length > 1 ? gutter : h('div', { class: 'strip-gutter' }),
      this.lanes,
    );
    this.scroller.scrollTo({ left: 0, top: 0 });
  }

  hide(): void {
    this.el.classList.remove('is-open');
    this.el.inert = true;
    this.b = null;
  }

  setActive(id: string | null): void {
    for (const [cid, s] of this.stops) s.el.classList.toggle('is-active', cid === id);
    const s = id ? this.stops.get(id) : undefined;
    if (!s) return;
    this.setRoving(s.c.id);
    // centre the stop horizontally and bring its row into view, scrolling only the strip itself
    const sc = this.scroller;
    const viewW = sc.clientWidth - (this.multiRow ? (this.track.querySelector<HTMLElement>('.strip-gutter')?.offsetWidth ?? GUTTER) : 0);
    const viewH = sc.clientHeight - AXIS_H;
    const rowTop = s.row * ROW_H;
    const top = rowTop < sc.scrollTop || rowTop + ROW_H > sc.scrollTop + viewH ? rowTop - Math.max(0, (viewH - ROW_H) / 2) : sc.scrollTop;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    sc.scrollTo({ left: Math.max(0, s.x - viewW / 2), top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  }

  /** Move the "camera is looking here" cursor (distance along beam, metres). */
  setCursor(d: number): void {
    if (!this.b || !this.knots.length) return;
    this.cursor.style.transform = `translateX(${this.xOf(d)}px)`;
  }

  /** Map x of a distance along the beam (piecewise linear through the knots; constant scale outside them). */
  private xOf(d: number): number {
    const k = this.knots;
    if (d <= k[0].d) return k[0].x - (k[0].d - d) * this.scale;
    const last = k[k.length - 1];
    if (d >= last.d) return last.x + (d - last.d) * this.scale;
    let lo = 0;
    let hi = k.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (k[mid].d <= d) lo = mid;
      else hi = mid;
    }
    const a = k[lo];
    const b = k[hi];
    return b.d === a.d ? a.x : a.x + ((b.x - a.x) * (d - a.d)) / (b.d - a.d);
  }

  /** One tab stop for the whole map (the active stop, else the first); arrows walk the stops in beam order. */
  private setRoving(id: string): void {
    for (const s of this.order) s.el.tabIndex = s.c.id === id ? 0 : -1;
  }

  private onKey(e: KeyboardEvent): void {
    const cur = this.order.findIndex((s) => s.el === document.activeElement);
    if (cur < 0) return;
    const n = this.order.length;
    const j = e.key === 'ArrowRight' ? Math.min(n - 1, cur + 1) : e.key === 'ArrowLeft' ? Math.max(0, cur - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const s = this.order[j];
    this.setRoving(s.c.id);
    s.el.focus();
  }
}
