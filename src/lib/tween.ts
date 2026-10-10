/** Minimal frame-driven tweens (driven by the Stage clock, so they pause with it). */

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inOutQuint: (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
};

interface Tween {
  t0: number;
  dur: number;
  ease: Ease;
  step: (k: number) => void;
  /** true: ran to the end; false: cancelled */
  resolve: (completed: boolean) => void;
  cancelled: boolean;
}

export class Tweens {
  private list: Tween[] = [];
  private now = 0;

  update(time: number): void {
    this.now = time;
    const done: Tween[] = [];
    for (const tw of this.list) {
      if (tw.cancelled) {
        done.push(tw);
        continue;
      }
      const k = tw.dur <= 0 ? 1 : Math.min(1, (time - tw.t0) / tw.dur);
      tw.step(tw.ease(k));
      if (k >= 1) done.push(tw);
    }
    if (done.length) {
      this.list = this.list.filter((t) => !done.includes(t));
      for (const t of done) if (!t.cancelled) t.resolve(true);
    }
  }

  /**
   * Animate k from 0..1 over `dur` seconds. Returns a cancel handle and a promise that resolves to true when the
   * tween ran to the end, or to false when it was cancelled (so follow-up work can tell the two apart).
   */
  run(dur: number, step: (k: number) => void, e: Ease = ease.inOutCubic): { done: Promise<boolean>; cancel: () => void } {
    let tw!: Tween;
    const done = new Promise<boolean>((resolve) => {
      tw = { t0: this.now, dur, ease: e, step, resolve, cancelled: false };
    });
    this.list.push(tw);
    return {
      done,
      cancel: () => {
        if (tw.cancelled) return;
        tw.cancelled = true;
        tw.resolve(false);
      },
    };
  }
}

export const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
