/**
 * Visitor motion preference for the 3D scene. Under `prefers-reduced-motion: reduce` the travelling beam pulses and
 * the circulating electron bunches freeze in place (a static beam); the setting is followed live, so toggling it in
 * the OS takes effect without a reload.
 */
let reduced = false;

if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduced = mq.matches;
  mq.addEventListener?.('change', (e) => {
    reduced = e.matches;
  });
}

/** True while ambient scene animation (pulses, bunches) should stand still. */
export function motionReduced(): boolean {
  return reduced;
}

/**
 * A clock that only advances while motion is allowed, so frozen animations resume from where they stopped
 * instead of jumping ahead.
 */
export class MotionClock {
  t = 0;
  tick(dt: number): number {
    if (!reduced) this.t += dt;
    return this.t;
  }
}
