import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/** How long the CSS opacity fade of `.lbl.is-hidden` runs before a hidden label leaves the render list. */
const FADE_MS = 360;

let epoch = 0;

/**
 * Return a counter incremented when the engine shows, hides or moves a label. The frame loop compares this counter,
 * camera matrices and canvas size with their previous values before rendering the CSS2D label layer.
 */
export function labelEpoch(): number {
  return epoch;
}

/** Increment the counter after changing a label, such as moving it to another anchor. */
export function touchLabels(): void {
  epoch++;
}

interface LabelState {
  shown?: boolean;
  hideTimer?: number;
}

/**
 * Show or hide a CSS2D pin, place name or ruler label.
 *
 * Apply `.is-hidden` for the opacity fade, then set `visible = false`. CSS2DRenderer applies `display: none`, so the
 * label is excluded from rendering, keyboard focus and hit testing. To show it, restore visibility and remove the
 * class two frames later for the fade-in. `el` is the element with the `.lbl` class. Pins have an anchor around it.
 */
export function showLabel(obj: CSS2DObject, shown: boolean, el: HTMLElement = obj.element): void {
  const st = obj.userData as LabelState;
  if (st.shown === shown && (shown ? obj.visible : true)) return;
  st.shown = shown;
  if (shown) {
    if (st.hideTimer) {
      clearTimeout(st.hideTimer);
      st.hideTimer = 0;
    }
    if (obj.visible) {
      el.classList.remove('is-hidden');
      return;
    }
    obj.visible = true;
    epoch++;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if ((obj.userData as LabelState).shown) el.classList.remove('is-hidden');
      }),
    );
    return;
  }
  el.classList.add('is-hidden');
  if (!obj.visible || st.hideTimer) return;
  st.hideTimer = window.setTimeout(() => {
    st.hideTimer = 0;
    if (!st.shown) {
      obj.visible = false;
      epoch++;
    }
  }, FADE_MS);
}

/** Hide immediately without a fade, such as when disposing of a scene. */
export function hideLabelNow(obj: CSS2DObject, el: HTMLElement = obj.element): void {
  const st = obj.userData as LabelState;
  if (st.hideTimer) clearTimeout(st.hideTimer);
  st.hideTimer = 0;
  st.shown = false;
  el.classList.add('is-hidden');
  obj.visible = false;
  epoch++;
}

/** Return the requested visibility. The fade may still be running. */
export function labelShown(obj: CSS2DObject): boolean {
  return (obj.userData as LabelState).shown !== false;
}

/** Screen-space rectangle (CSS pixels). */
export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const overlaps = (a: Rect, b: Rect, pad = 0): boolean =>
  a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;

/** Widths of canvas areas covered by the top bar, breadcrumbs, side panel and path strip, in pixels. */
export interface SafeInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Return the insets from the last Stage.setInsets call. Layout functions use these when their caller supplies none,
 * placing pins and place labels clear of the top bar, side panel and path strip.
 */
export function stageInsets(stage: object): Partial<SafeInsets> | undefined {
  const i = (stage as { insets?: Partial<SafeInsets> }).insets;
  return i && typeof i === 'object' ? i : undefined;
}

/** The part of a width × height canvas that is not covered by UI chrome. */
export function safeRect(width: number, height: number, safe?: Partial<SafeInsets>): Rect {
  return {
    x0: safe?.left ?? 0,
    x1: width - (safe?.right ?? 0),
    y0: safe?.top ?? 0,
    y1: height - (safe?.bottom ?? 0),
  };
}

export const inside = (r: Rect, frame: Rect): boolean => r.x0 >= frame.x0 && r.x1 <= frame.x1 && r.y0 >= frame.y0 && r.y1 <= frame.y1;
