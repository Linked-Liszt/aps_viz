import type { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/** How long the CSS opacity fade of `.lbl.is-hidden` runs before a hidden label leaves the render list. */
const FADE_MS = 360;

let epoch = 0;

/**
 * Changes whenever a scene label is shown, hidden or moved by the engine. Together with the camera matrices and the
 * canvas size it tells the frame loop whether the CSS2D label layer needs re-rendering at all.
 */
export function labelEpoch(): number {
  return epoch;
}

/** Record a label change the CSS2D layer must pick up (e.g. a label moved to a new anchor). */
export function touchLabels(): void {
  epoch++;
}

interface LabelState {
  shown?: boolean;
  hideTimer?: number;
}

/**
 * Show or hide a CSS2D label (pin, place name, ruler mark…).
 *
 * A hidden label first fades out through the `.is-hidden` class, then drops out of the CSS2D render list
 * (`visible = false`, which CSS2DRenderer turns into `display: none`). Hidden labels are then neither focusable nor
 * hit-testable, and cost the label renderer nothing per frame. Showing reverses this; the class is dropped two frames
 * after the element is displayed again so the fade-in still runs. `el` is the element carrying the `.lbl` class (pins
 * wrap it in an anchor element).
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

/** Hide immediately, without the fade (labels that must vanish at once, e.g. when a scene is torn down). */
export function hideLabelNow(obj: CSS2DObject, el: HTMLElement = obj.element): void {
  const st = obj.userData as LabelState;
  if (st.hideTimer) clearTimeout(st.hideTimer);
  st.hideTimer = 0;
  st.shown = false;
  el.classList.add('is-hidden');
  obj.visible = false;
  epoch++;
}

/** Whether the label is meant to be visible (its fade may still be running). */
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

/** Pixels of the canvas covered by UI chrome on each side (top bar and crumbs, side panel, path strip…). */
export interface SafeInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The UI insets the stage currently keeps clear (the last Stage.setInsets), for layout passes whose caller passes none:
 * pins and place labels then still avoid the top bar, side panel and path strip.
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
