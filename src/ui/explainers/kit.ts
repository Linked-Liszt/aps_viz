/**
 * Station kit: shared building blocks for the interactive "exhibit stations" so every station looks and
 * behaves the same (layout, controls, canvases, plots, colormaps, animation loop lifecycle).
 *
 * Layout produced by createStation():
 *   ┌───────────────────────────────┬──────────────┐
 *   │ visual (one or more canvases) │ controls     │
 *   ├───────────────────────────────┴──────────────┤
 *   │ caption: "what you're seeing"                 │
 *   └───────────────────────────────────────────────┘
 */
import './kit.css';

export const TOKENS = {
  bg: '#05080e',
  panel: '#0b111b',
  grid: 'rgba(140,170,210,0.12)',
  axis: 'rgba(170,190,215,0.55)',
  ink: '#e9eef5',
  ink2: '#b7c3d2',
  ink3: '#8394a9',
  xray: '#5cd3ff',
  electron: '#ffb547',
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  old: '#9aa6b8', // "before the upgrade" series colour
  new: '#5cd3ff', // "after the upgrade" series colour
  font: "'Inter Variable', Inter, system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

export interface Station {
  root: HTMLElement;
  visual: HTMLElement;
  controls: HTMLElement;
  caption: HTMLElement;
  /** Register a cleanup function. */
  onDestroy(fn: () => void): void;
  destroy(): void;
  /** Set the caption ("what you're seeing"). Supports **bold**, *italic*, `code`, _{sub} and ^{sup}. */
  setCaption(text: string): void;
}

export function createStation(host: HTMLElement, opts: { color?: string; layout?: 'side' | 'stack' } = {}): Station {
  const root = el('div', `stn stn-${opts.layout ?? 'side'}`);
  if (opts.color) root.style.setProperty('--c', opts.color);
  const visual = el('div', 'stn-visual');
  const controls = el('div', 'stn-controls');
  const caption = el('div', 'stn-caption');
  root.append(visual, controls, caption);
  host.replaceChildren(root);
  const cleanups: (() => void)[] = [];
  let destroyed = false;
  const s: Station = {
    root,
    visual,
    controls,
    caption,
    // registered after teardown (e.g. by a deferred lookup): run at once
    onDestroy: (fn) => (destroyed ? fn() : void cleanups.push(fn)),
    destroy: () => {
      destroyed = true;
      for (const fn of cleanups.splice(0)) {
        try {
          fn();
        } catch (e) {
          console.error(e);
        }
      }
      if (root.parentNode === host) host.replaceChildren();
    },
    setCaption: (text) => {
      caption.innerHTML = md(text);
    },
  };
  STATIONS.set(root, s);
  return s;
}

/** station root → station, so shared helpers can tie their resources to the station that owns a DOM node */
const STATIONS = new WeakMap<Element, Station>();

/** The station whose DOM contains `node` (nearest `.stn` ancestor), if any. */
export function stationOf(node: Element | null | undefined): Station | null {
  const root = node?.closest('.stn');
  return root ? (STATIONS.get(root) ?? null) : null;
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

/** minimal markdown: **bold**, *em*, `code`, x_{sub}, x^{sup} */
export function md(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/_\{(.+?)\}/g, '<sub>$1</sub>')
    .replace(/\^\{(.+?)\}/g, '<sup>$1</sup>');
}

// ------------------------------------------------------------------ canvas

export interface Canvas2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** CSS pixel size */
  w: number;
  h: number;
  dpr: number;
  onResize(fn: () => void): void;
}

/**
 * HiDPI canvas that tracks its container size. `aspect` = width/height (default fills container height).
 */
export function canvas2d(parent: HTMLElement, opts: { aspect?: number; minHeight?: number; label?: string; className?: string } = {}): Canvas2D {
  const wrap = el('div', `stn-canvas ${opts.className ?? ''}`);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  if (opts.label) {
    canvas.setAttribute('aria-label', opts.label);
    const tag = el('div', 'stn-canvas-label');
    tag.textContent = opts.label;
    wrap.appendChild(tag);
  }
  wrap.prepend(canvas);
  if (opts.aspect) wrap.style.aspectRatio = String(opts.aspect);
  if (opts.minHeight) wrap.style.minHeight = `${opts.minHeight}px`;
  parent.appendChild(wrap);
  const ctx = canvas.getContext('2d')!;
  const c: Canvas2D = { canvas, ctx, w: 1, h: 1, dpr: 1, onResize: (fn) => fns.push(fn) };
  const fns: (() => void)[] = [];
  let wasConnected = false;
  const fit = () => {
    // fallback for a canvas outside any station: stop observing once its DOM has been removed
    if (wrap.isConnected) wasConnected = true;
    else if (wasConnected) {
      ro.disconnect();
      return;
    }
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width));
    const h = Math.max(10, Math.round(r.height));
    if (w === c.w && h === c.h && dpr === c.dpr) return;
    c.w = w;
    c.h = h;
    c.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const fn of fns) fn();
  };
  const ro = new ResizeObserver(fit);
  ro.observe(wrap);
  // Disconnect together with the owning station. A resize callback cannot be relied on for that: a canvas that is
  // hidden (display: none) at teardown stays 0×0 and never reports again. Parts built in a detached element and
  // attached later in the same mount are found on the microtask after it.
  const own = (): boolean => {
    const st = stationOf(wrap);
    if (st) st.onDestroy(() => ro.disconnect());
    return !!st;
  };
  if (!own()) queueMicrotask(own);
  fit();
  return c;
}

/**
 * `el` cannot be seen because of a dialog: an open one (`.modal.is-open`) that does not contain it covers it, or `el`
 * sits in a closed one (faded out to opacity 0 but still laid out, so the IntersectionObserver reports it visible).
 */
function hiddenByDialog(el: HTMLElement): boolean {
  const own = el.closest('.modal');
  if (own && !own.classList.contains('is-open')) return true;
  for (const m of document.querySelectorAll('.modal.is-open')) if (!m.contains(el)) return true;
  return false;
}

/**
 * requestAnimationFrame loop. Returns stop(); it also stops with the station.
 * - Pauses while the station is off-screen (IntersectionObserver) or the tab is hidden.
 * - Pauses while a dialog hides it (another dialog on top, e.g. the same station opened full screen or the story; or
 *   its own dialog has closed), polling a few times a second to resume; nothing runs and `t` stands still meanwhile.
 * - If the station's DOM is removed without destroy() (e.g. its host was replaced while it was loading), the station
 *   is destroyed on the next check, so its loop, observers and timers cannot outlive it.
 */
export function loop(station: Station, fn: (dt: number, t: number) => void): () => void {
  let raf = 0;
  let poll = 0;
  let last = performance.now();
  let t = 0;
  let visible = true;
  let stopped = false;
  let mounted = station.root.isConnected;
  /** true (and the station destroyed) once its DOM has gone after having been in the document */
  const orphaned = (): boolean => {
    if (station.root.isConnected) {
      mounted = true;
      return false;
    }
    if (!mounted) return false;
    station.destroy();
    return true;
  };
  const schedule = () => {
    if (!raf && !poll && !stopped) raf = requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver((e) => {
    visible = e[e.length - 1].isIntersecting;
    if (stopped || orphaned()) return;
    if (visible) {
      last = performance.now();
      schedule();
    }
  });
  io.observe(station.root);
  const wait = () => {
    poll = window.setTimeout(() => {
      poll = 0;
      if (stopped || orphaned()) return;
      if (hiddenByDialog(station.root)) wait();
      else if (visible) {
        last = performance.now();
        schedule();
      }
    }, 250);
  };
  const tick = (now: number) => {
    raf = 0;
    if (stopped || orphaned()) return;
    if (hiddenByDialog(station.root)) {
      wait();
      return;
    }
    const dt = Math.min(0.1, Math.max(0, now - last) / 1000);
    last = now;
    t += dt;
    if (!document.hidden) fn(dt, t);
    if (visible) schedule();
  };
  schedule();
  const stop = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    if (poll) clearTimeout(poll);
    raf = poll = 0;
    io.disconnect();
  };
  station.onDestroy(stop);
  return stop;
}

// ------------------------------------------------------------------ reduced motion

let rmQuery: MediaQueryList | null | undefined;
/**
 * Last known preference: read from the query once, then kept up to date by its change events only. Stations call
 * prefersReducedMotion() every frame, and reading `.matches` that often can swallow the change event (Chrome updates
 * the query's state on read, so when it later re-evaluates the query it sees no change and fires nothing), after
 * which no listener would ever hear of the next switch.
 */
let rmReduced = false;
const rmListeners = new Set<(reduced: boolean) => void>();
function rmq(): MediaQueryList | null {
  if (rmQuery === undefined) {
    rmQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    rmReduced = rmQuery?.matches ?? false;
    rmQuery?.addEventListener('change', (e) => {
      if (e.matches === rmReduced) return;
      rmReduced = e.matches;
      for (const f of [...rmListeners]) {
        try {
          f(e.matches);
        } catch (err) {
          console.error(err);
        }
      }
    });
  }
  return rmQuery;
}

/** The visitor asks for reduced motion (live: follows changes to the OS / browser setting). */
export function prefersReducedMotion(): boolean {
  rmq();
  return rmReduced;
}

/** Call `fn` whenever the reduced-motion preference changes, for the station's lifetime. */
export function onReducedMotionChange(station: Station, fn: (reduced: boolean) => void): void {
  rmq();
  rmListeners.add(fn);
  station.onDestroy(() => rmListeners.delete(fn));
}

export interface MotionGate {
  /** autonomous animation may run: always, unless reduced motion is preferred and the visitor has not pressed Play */
  readonly on: boolean;
  /** reduced motion is preferred right now */
  readonly reduced: boolean;
  /** the Play / Pause button (shown only while reduced motion is preferred) */
  readonly button: HTMLButtonElement;
  set(on: boolean): void;
}

/**
 * Reduced-motion switch for a station's self-running animation. With `prefers-reduced-motion: reduce` the animation
 * starts frozen and a visible Play button (added to `parent`) lets the visitor run it; without the preference the
 * button is hidden and `on` is always true. Stations keep redrawing in response to input either way.
 */
export function motionGate(
  station: Station,
  parent: HTMLElement,
  opts: { play?: string; pause?: string; title?: string; onChange?: (on: boolean) => void; before?: Element | null } = {},
): MotionGate {
  const play = opts.play ?? '▶ Play animation';
  const pause = opts.pause ?? '❚❚ Pause animation';
  let reduced = prefersReducedMotion();
  let on = !reduced;
  const b = button(parent, play, () => set(!on), 'stn-motion');
  if (opts.before) parent.insertBefore(b, opts.before);
  b.title = opts.title ?? 'Your device asks for reduced motion, so this animation starts paused';
  const sync = () => {
    b.hidden = !reduced;
    b.textContent = on ? pause : play;
    b.setAttribute('aria-pressed', String(on));
  };
  const set = (v: boolean) => {
    if (v === on) return;
    on = v;
    sync();
    opts.onChange?.(on);
  };
  onReducedMotionChange(station, (r) => {
    reduced = r;
    sync();
    set(!r);
  });
  sync();
  return {
    get on() {
      return on;
    },
    get reduced() {
      return reduced;
    },
    button: b,
    set,
  };
}

// ------------------------------------------------------------------ controls

export function group(parent: HTMLElement, title?: string): HTMLElement {
  const g = el('div', 'stn-group');
  if (title) {
    const h = el('div', 'stn-group-title');
    h.textContent = title;
    g.appendChild(h);
  }
  parent.appendChild(g);
  return g;
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  /** format the displayed value */
  format?: (v: number) => string;
  /** logarithmic slider: min/max are the real values, internally linear in log10 */
  log?: boolean;
  hint?: string;
  onInput: (v: number) => void;
}

export interface SliderHandle {
  input: HTMLInputElement;
  get(): number;
  set(v: number, fire?: boolean): void;
}

export function slider(parent: HTMLElement, o: SliderOpts): SliderHandle {
  const row = el('label', 'stn-slider');
  const top = el('div', 'stn-slider-top');
  const name = el('span', 'stn-slider-label');
  name.textContent = o.label;
  const val = el('span', 'stn-slider-value');
  top.append(name, val);
  const input = document.createElement('input');
  input.type = 'range';
  const toPos = (v: number) => (o.log ? Math.log10(v) : v);
  const fromPos = (p: number) => (o.log ? Math.pow(10, p) : p);
  input.min = String(toPos(o.min));
  input.max = String(toPos(o.max));
  input.step = o.log ? 'any' : String(o.step ?? (o.max - o.min) / 100);
  input.value = String(toPos(o.value));
  const fmt = o.format ?? ((v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3)));
  let current = o.value;
  const show = () => {
    val.textContent = fmt(current);
    const pct = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
    input.style.setProperty('--pct', `${pct}%`);
  };
  input.addEventListener('input', () => {
    current = fromPos(Number(input.value));
    show();
    o.onInput(current);
  });
  row.append(top, input);
  if (o.hint) {
    const hint = el('div', 'stn-hint');
    hint.textContent = o.hint;
    row.appendChild(hint);
  }
  parent.appendChild(row);
  show();
  return {
    input,
    get: () => current,
    set: (v, fire = false) => {
      current = v;
      input.value = String(toPos(v));
      show();
      if (fire) o.onInput(v);
    },
  };
}

export interface ToggleOpts<T extends string> {
  label?: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
}

export function toggle<T extends string>(parent: HTMLElement, o: ToggleOpts<T>): { set(v: T, fire?: boolean): void; get(): T } {
  const wrap = el('div', 'stn-toggle-wrap');
  if (o.label) {
    const l = el('div', 'stn-slider-label');
    l.textContent = o.label;
    wrap.appendChild(l);
  }
  const seg = el('div', 'stn-toggle');
  seg.setAttribute('role', 'group');
  let cur = o.value;
  const btns: HTMLButtonElement[] = [];
  for (const opt of o.options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = opt.label;
    if (opt.title) b.title = opt.title;
    b.setAttribute('aria-pressed', String(opt.value === cur));
    b.addEventListener('click', () => {
      set(opt.value, true);
    });
    btns.push(b);
    seg.appendChild(b);
  }
  const set = (v: T, fire = false) => {
    cur = v;
    btns.forEach((b, i) => b.setAttribute('aria-pressed', String(o.options[i].value === v)));
    if (fire) o.onChange(v);
  };
  wrap.appendChild(seg);
  parent.appendChild(wrap);
  return { set, get: () => cur };
}

export function button(parent: HTMLElement, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `stn-btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

export function readout(parent: HTMLElement, label: string, opts: { big?: boolean; color?: string } = {}): { set(v: string): void; el: HTMLElement } {
  const r = el('div', `stn-readout ${opts.big ? 'is-big' : ''}`);
  const l = el('span', 'stn-readout-label');
  l.textContent = label;
  const v = el('span', 'stn-readout-value');
  if (opts.color) v.style.color = opts.color;
  r.append(l, v);
  parent.appendChild(r);
  return { el: r, set: (s) => (v.textContent = s) };
}

/**
 * The station's one screen-reader announcer: a visually hidden role=status element. Live readouts are deliberately
 * not live regions (they would chatter on every slider step); a station says() what matters after a discrete user
 * action. Debounced: rapid input announces only the last state. A function argument is read when the message fires.
 */
export function announcer(station: Station): { say(text: string | (() => string), delayMs?: number): void } {
  let el = station.root.querySelector<HTMLElement>(':scope > .stn-sr-status');
  if (!el) {
    el = document.createElement('div');
    el.className = 'stn-sr-status';
    el.setAttribute('role', 'status');
    station.root.appendChild(el);
  }
  const live = el;
  let timer = 0;
  station.onDestroy(() => clearTimeout(timer));
  return {
    say(text, delayMs = 500) {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const t = (typeof text === 'function' ? text() : text).replace(/\s+/g, ' ').trim();
        // a repeat of the same words is only re-read if the region is emptied first
        live.textContent = '';
        timer = window.setTimeout(() => (live.textContent = t), 60);
      }, delayMs);
    },
  };
}

/** Explanatory paragraph beside the controls (same minimal markdown as the caption); `set` rewrites it. */
export function note(parent: HTMLElement, _station: Station, text: string): { set(text: string): void } {
  const n = el('div', 'stn-note');
  parent.appendChild(n);
  const set = (t: string) => {
    n.innerHTML = md(t);
  };
  set(text);
  return { set };
}

export function legend(parent: HTMLElement, items: { color: string; label: string; dashed?: boolean }[]): HTMLElement {
  const l = el('div', 'stn-legend');
  for (const it of items) {
    const i = el('span', 'stn-legend-item');
    const sw = el('i', it.dashed ? 'is-dashed' : '');
    sw.style.setProperty('--sw', it.color);
    const t = document.createElement('span');
    t.textContent = it.label;
    i.append(sw, t);
    l.appendChild(i);
  }
  parent.appendChild(l);
  return l;
}

// ------------------------------------------------------------------ plotting

export interface Axis {
  min: number;
  max: number;
  log?: boolean;
  label?: string;
  ticks?: number[];
  format?: (v: number) => string;
}

export interface PlotFrame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** data → pixel */
  px(x: number): number;
  py(y: number): number;
}

/** Draws axes + grid into a rect and returns the coordinate mapping. */
export function plotFrame(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, xa: Axis, ya: Axis, title?: string): PlotFrame {
  const padL = 46;
  const padB = 34;
  const padT = title ? 22 : 8;
  const padR = 10;
  const x0 = rect.x + padL;
  const x1 = rect.x + rect.w - padR;
  const y0 = rect.y + rect.h - padB;
  const y1 = rect.y + padT;
  const map = (a: Axis, v: number, p0: number, p1: number) => {
    const f = a.log ? (Math.log10(v) - Math.log10(a.min)) / (Math.log10(a.max) - Math.log10(a.min)) : (v - a.min) / (a.max - a.min);
    return p0 + f * (p1 - p0);
  };
  const frame: PlotFrame = { x0, y0, x1, y1, px: (x) => map(xa, x, x0, x1), py: (y) => map(ya, y, y0, y1) };
  ctx.save();
  ctx.font = `11px ${TOKENS.font}`;
  ctx.fillStyle = TOKENS.ink3;
  ctx.strokeStyle = TOKENS.grid;
  ctx.lineWidth = 1;
  const xt = xa.ticks ?? autoTicks(xa);
  const yt = ya.ticks ?? autoTicks(ya);
  const xf = xa.format ?? fmtTick;
  const yf = ya.format ?? fmtTick;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of xt) {
    const x = frame.px(t);
    if (x < x0 - 0.5 || x > x1 + 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
    ctx.fillText(xf(t), x, y0 + 4);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of yt) {
    const y = frame.py(t);
    if (y > y0 + 0.5 || y < y1 - 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.fillText(yf(t), x0 - 5, y);
  }
  ctx.strokeStyle = TOKENS.axis;
  ctx.beginPath();
  ctx.moveTo(x0, y1);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x1, y0);
  ctx.stroke();
  ctx.fillStyle = TOKENS.ink2;
  if (xa.label) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(xa.label, (x0 + x1) / 2, rect.y + rect.h - 1);
  }
  if (ya.label) {
    ctx.save();
    ctx.translate(rect.x + 11, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ya.label, 0, 0);
    ctx.restore();
  }
  if (title) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = TOKENS.ink;
    ctx.font = `600 12px ${TOKENS.font}`;
    ctx.fillText(title, x0, rect.y + 3);
  }
  ctx.restore();
  return frame;
}

export function autoTicks(a: Axis): number[] {
  if (a.log) {
    const out: number[] = [];
    for (let e = Math.floor(Math.log10(a.min)); e <= Math.ceil(Math.log10(a.max)); e++) out.push(Math.pow(10, e));
    return out;
  }
  const span = a.max - a.min;
  const raw = span / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 6) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(a.min / step) * step; v <= a.max + 1e-9; v += step) out.push(+v.toPrecision(10));
  return out;
}

export function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e4 || a < 1e-2) {
    const e = Math.floor(Math.log10(a));
    const m = v / Math.pow(10, e);
    return Math.abs(m - 1) < 1e-9 ? `1e${e}` : `${m.toFixed(1)}e${e}`;
  }
  return +v.toPrecision(3) + '';
}

export function line(ctx: CanvasRenderingContext2D, f: PlotFrame, xs: ArrayLike<number>, ys: ArrayLike<number>, color: string, width = 2, dash: number[] = []): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.x0, f.y1, f.x1 - f.x0, f.y0 - f.y1);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (!Number.isFinite(y)) {
      started = false;
      continue;
    }
    const px = f.px(xs[i]);
    const py = f.py(y);
    if (!started) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
    started = true;
  }
  ctx.stroke();
  ctx.restore();
}

export function dots(ctx: CanvasRenderingContext2D, f: PlotFrame, xs: ArrayLike<number>, ys: ArrayLike<number>, color: string, r = 2.5, errs?: ArrayLike<number>): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(ys[i])) continue;
    const x = f.px(xs[i]);
    const y = f.py(ys[i]);
    if (errs) {
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, f.py(ys[i] - errs[i]));
      ctx.lineTo(x, f.py(ys[i] + errs[i]));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ colormaps & images

type RGB = [number, number, number];
const STOPS: Record<string, RGB[]> = {
  // perceptually-ordered approximations of matplotlib maps
  inferno: [
    [0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106], [186, 54, 85], [227, 89, 51], [249, 140, 10], [249, 201, 50], [252, 255, 164],
  ],
  viridis: [
    [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [110, 206, 88], [181, 222, 43], [253, 231, 37],
  ],
  ice: [
    [4, 6, 19], [20, 30, 70], [30, 70, 130], [40, 120, 180], [92, 211, 255], [200, 240, 255], [255, 255, 255],
  ],
  // diverging (for phase / strain / XMCD sign)
  rdbu: [
    [5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222], [247, 247, 247], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 31],
  ],
};

const lutCache = new Map<string, Uint8ClampedArray>();
export function lut(name: keyof typeof STOPS | string): Uint8ClampedArray {
  let l = lutCache.get(name);
  if (l) return l;
  const stops = STOPS[name] ?? STOPS.inferno;
  l = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = (i / 255) * (stops.length - 1);
    const a = Math.floor(f);
    const b = Math.min(stops.length - 1, a + 1);
    const t = f - a;
    for (let k = 0; k < 3; k++) l[i * 3 + k] = stops[a][k] + (stops[b][k] - stops[a][k]) * t;
  }
  lutCache.set(name, l);
  return l;
}

/** Map a 0..1 value to a CSS colour from a LUT. */
export function cmapCss(name: string, v: number): string {
  const l = lut(name);
  const i = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${l[i * 3]},${l[i * 3 + 1]},${l[i * 3 + 2]})`;
}

/** Hue-wheel colour for a phase in radians (for complex-field images). */
export function phaseRgb(phi: number, amp = 1): RGB {
  const h = ((phi / (2 * Math.PI)) % 1 + 1) % 1;
  const k = (n: number) => (n + h * 6) % 6;
  const f = (n: number) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [255 * f(5) * amp, 255 * f(3) * amp, 255 * f(1) * amp];
}

/**
 * Render a scalar field (row-major, n×m) into an offscreen image and draw it scaled into rect.
 * opts.log: log10 scaling; opts.range: [lo, hi] data range (auto if omitted); opts.diverging: symmetric about 0.
 */
export function drawField(
  ctx: CanvasRenderingContext2D,
  data: ArrayLike<number>,
  nx: number,
  ny: number,
  rect: { x: number; y: number; w: number; h: number },
  opts: { cmap?: string; log?: boolean; range?: [number, number]; diverging?: boolean; smooth?: boolean } = {},
): [number, number] {
  const n = nx * ny;
  const v = new Float32Array(n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    let x = data[i];
    if (opts.log) x = Math.log10(Math.max(x, 1e-12));
    v[i] = x;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  if (opts.range) [lo, hi] = opts.log ? [Math.log10(Math.max(opts.range[0], 1e-12)), Math.log10(Math.max(opts.range[1], 1e-12))] : opts.range;
  if (opts.diverging) {
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    lo = -m;
    hi = m;
  }
  const span = hi - lo || 1;
  const l = lut(opts.cmap ?? (opts.diverging ? 'rdbu' : 'inferno'));
  const img = new ImageData(nx, ny);
  for (let i = 0; i < n; i++) {
    const k = Math.max(0, Math.min(255, Math.round(((v[i] - lo) / span) * 255)));
    img.data[i * 4] = l[k * 3];
    img.data[i * 4 + 1] = l[k * 3 + 1];
    img.data[i * 4 + 2] = l[k * 3 + 2];
    img.data[i * 4 + 3] = 255;
  }
  blit(ctx, img, rect, opts.smooth ?? false);
  return [lo, hi];
}

/** Draw an RGB(A) ImageData scaled into rect (nearest-neighbour unless smooth). */
const scratch = typeof document !== 'undefined' ? document.createElement('canvas') : null;
export function blit(ctx: CanvasRenderingContext2D, img: ImageData, rect: { x: number; y: number; w: number; h: number }, smooth = false): void {
  if (!scratch) return;
  scratch.width = img.width;
  scratch.height = img.height;
  scratch.getContext('2d')!.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(scratch, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/** Text helper with consistent styling. */
export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts: { color?: string; size?: number; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; weight?: number; mono?: boolean } = {}): void {
  ctx.save();
  ctx.fillStyle = opts.color ?? TOKENS.ink2;
  ctx.font = `${opts.weight ?? 500} ${opts.size ?? 11}px ${opts.mono ? TOKENS.mono : TOKENS.font}`;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = opts.baseline ?? 'alphabetic';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Glowing beam segment (for schematic geometry drawings). */
export function beam(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color = TOKENS.xray, width = 3): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}
