/** Number formatting shared by the brightness station views (pure; tested). */

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

export function sup(n: number | string): string {
  return String(n)
    .split('')
    .map((ch) => SUP[ch] ?? ch)
    .join('');
}

/** 1.1 × 10²² (mantissa with `digits` significant figures; "10²²" when the mantissa rounds to 1). */
export function sci(v: number, digits = 2): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  let e = Math.floor(Math.log10(v));
  let m = v / Math.pow(10, e);
  let ms = m.toPrecision(digits);
  if (Number(ms) >= 10) {
    e += 1;
    m /= 10;
    ms = m.toPrecision(digits);
  }
  if (Number(ms) === 1) return `10${sup(e)}`;
  return `${ms} × 10${sup(e)}`;
}

/**
 * A design gain rounded to what its uncertainty supports (digitized design curves: ±20 % per point, ~±30 % on a
 * ratio): one significant figure. 688 → "700", 545 → "500", 75 → "80", 3.4 → "3". For the station text and readouts.
 */
export function approxGain(g: number): string {
  if (!Number.isFinite(g) || g <= 0) return '—';
  if (g < 1.5) return '1';
  const m = Math.pow(10, Math.floor(Math.log10(g)));
  return (Math.round(g / m) * m).toLocaleString('en-US');
}

/** ×72, ×540, ×3.4, ×1,883 */
export function fmtGain(g: number): string {
  if (!Number.isFinite(g)) return '—';
  if (g >= 999.5) return `×${Math.round(g).toLocaleString('en-US')}`;
  if (g >= 9.95) return `×${Math.round(g)}`;
  return `×${g.toFixed(1)}`;
}

/** "1 in 750" for a probability. */
export function fmtOneIn(p: number): string {
  if (!(p > 0)) return 'none';
  const n = 1 / p;
  if (n < 1.05) return 'all';
  if (n < 9.95) return `1 in ${n.toFixed(1)}`;
  if (n < 100) return `1 in ${Math.round(n)}`;
  const r = Number(n.toPrecision(2));
  return `1 in ${r.toLocaleString('en-US')}`;
}

/** µm / µrad values: 275, 12.3, 1.37, 0.62 */
export function fmtSmall(v: number): string {
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(2);
}

/** keV: 1.4, 20, 85 */
export function fmtKeV(E: number): string {
  return E < 9.95 ? E.toFixed(1) : `${Math.round(E)}`;
}

/** A small area/solid angle in mm² or mrad², with enough digits: 0.0175, 0.000364, 2.2e-6 */
export function fmtTiny(v: number): string {
  if (!(v > 0)) return '0';
  if (v >= 0.01) return v.toPrecision(2);
  if (v >= 1e-4) return v.toFixed(Math.min(8, 1 - Math.floor(Math.log10(v))));
  return sci(v, 2);
}
