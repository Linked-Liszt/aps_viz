/**
 * "Speckle memory" — a live GI-XPCS readout. Each recorded detector frame (photon counts in a region of interest on
 * the Yoneda band around ±q*) is divided pixel-by-pixel by the ensemble-average intensity ⟨I(q)⟩ (the smooth GISAXS
 * pattern), u = I/⟨I⟩, as XPCS normalises by the mean intensity per pixel / q-ring, and then correlated with every
 * earlier frame in a ring buffer with the standard (mean-normalised) two-time estimator
 *   G(t, t−τ) = ⟨u(t) u(t−τ)⟩_ROI / (⟨u(t)⟩_ROI ⟨u(t−τ)⟩_ROI) − 1  ≈  g₂(q,τ) − 1 = β |f(q,τ)|²   (Siegert relation)
 *   C(τ) = G / √(β(t) β(t−τ)),   β(t) = ⟨v²⟩/⟨v⟩² − 1 of the NOISE-FREE pattern v = I_clean/⟨I⟩ (speckle contrast,
 *          a calibration constant in a real experiment; per frame here so finite-speckle-number scatter cancels)
 * i.e. one row of the normalised two-time correlation function at the current age t (C = 1 for identical speckle,
 * 0 once fully decorrelated). Without the ⟨I⟩ normalisation the static envelope (Yoneda band, rod shape) would keep
 * C(τ) high after the speckle itself has decorrelated. Shot noise is independent between frames, so it does NOT bias
 * C(τ > 0) — it only scatters it. Shot-noise scatter of one point for (nearly) unchanged speckle, from the noise-free
 * frame (v_i, expected counts m_i·v_i in bin i, Poisson): Var(u_a u_b) = (v² + v/m)² − v⁴ = 2v³/m + v²/m² per bin, so
 *   σ_C ≈ N √(Σ_i (2v_i³/m_i + v_i²/m_i²)) / (Σ_i v_i)² / β        (shown as a ±1σ band around the curve)
 * In a coarsening system the dynamics slow down with age, so the decay of C(τ) stretches as time goes on ("aging").
 */
import { TOKENS } from '../kit';
import type { Canvas2D } from '../kit';

export class SpeckleMemory {
  readonly cap: number;
  private roi = new Int32Array(0);
  private buf: Float64Array;
  private readonly times: Float64Array;
  /** Σ_ROI u and noise-free contrast β of each stored frame */
  private readonly sums: Float64Array;
  private readonly betas: Float64Array;
  private head = 0;
  count = 0;
  readonly curve: Float64Array;
  readonly lags: Float64Array;
  nCurve = 0;
  /** estimated shot-noise scatter of one C(τ) point (0 without noise) */
  sigma = 0;
  earlier: { lags: Float64Array; curve: Float64Array; n: number } | null = null;
  private lastSnap = 0;
  private readonly maxRoi: number;

  constructor(cap = 90, maxRoi = 1200) {
    this.cap = cap;
    this.maxRoi = maxRoi;
    this.buf = new Float64Array(cap * maxRoi);
    this.times = new Float64Array(cap);
    this.sums = new Float64Array(cap);
    this.betas = new Float64Array(cap);
    this.curve = new Float64Array(cap);
    this.lags = new Float64Array(cap);
  }

  setRoi(cells: number[]): void {
    this.roi = Int32Array.from(cells.slice(0, this.maxRoi));
    this.reset();
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.nCurve = 0;
    this.sigma = 0;
    this.earlier = null;
    this.lastSnap = 0;
  }

  /**
   * Record the ROI of a frame taken at wall time t [s] and update C(τ).
   * frame: measured intensity (∝ photon counts, any scale); clean: the noise-free intensity and mean: the
   * ensemble-average intensity (same units as each other); photonScale: expected photon counts per unit of `clean`
   * (Infinity = no shot noise). C(τ) is scale-invariant; only the noise estimate σ needs photonScale.
   */
  push(frame: Float64Array, clean: Float64Array, mean: Float64Array, t: number, photonScale = Infinity): void {
    const n = this.roi.length;
    if (!n) return;
    const o = this.head * this.maxRoi;
    const noise = Number.isFinite(photonScale);
    let su = 0;
    let sv = 0;
    let sv2 = 0;
    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const c = this.roi[i];
      const m = Math.max(mean[c], 1e-12);
      const u = frame[c] / m;
      const v = clean[c] / m;
      this.buf[o + i] = u;
      su += u;
      sv += v;
      sv2 += v * v;
      if (noise) {
        const mc = Math.max(m * photonScale, 1e-9); // expected counts in this bin for v = 1
        varSum += (2 * v * v * v) / mc + (v * v) / (mc * mc);
      }
    }
    const beta = sv > 0 ? Math.max(0.05, (n * sv2) / (sv * sv) - 1) : 1;
    this.sums[this.head] = su;
    this.betas[this.head] = beta;
    this.times[this.head] = t;
    const newest = this.head;
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.cap, this.count + 1);
    // shot-noise scatter of one C point (EMA over frames so the readout is steady)
    const sig = sv > 0 ? (n * Math.sqrt(varSum)) / (sv * sv) / beta : 0;
    this.sigma = this.count === 1 ? sig : 0.8 * this.sigma + 0.2 * sig;
    let k = 0;
    for (let lag = 1; lag < this.count; lag++) {
      const idx = (newest - lag + this.cap) % this.cap;
      const ob = idx * this.maxRoi;
      let cab = 0;
      for (let i = 0; i < n; i++) cab += this.buf[o + i] * this.buf[ob + i];
      const den = su * this.sums[idx];
      this.lags[k] = t - this.times[idx];
      this.curve[k] = den > 0 ? ((n * cab) / den - 1) / Math.sqrt(beta * this.betas[idx]) : 0;
      k++;
    }
    this.nCurve = k;
    if (this.count === this.cap && t - this.lastSnap > 10) {
      this.lastSnap = t;
      this.earlier = { lags: this.lags.slice(0, k), curve: this.curve.slice(0, k), n: k };
    }
  }

  /** lag at which C first drops below 1/2 (linear interpolation), or null */
  halfLife(): number | null {
    for (let i = 0; i < this.nCurve; i++) {
      if (this.curve[i] < 0.5) {
        if (i === 0) return this.lags[0];
        const f = (this.curve[i - 1] - 0.5) / (this.curve[i - 1] - this.curve[i]);
        return this.lags[i - 1] + f * (this.lags[i] - this.lags[i - 1]);
      }
    }
    return null;
  }

  draw(c: Canvas2D, accent: string, specialist: boolean, note: string | null): void {
    const { ctx, w, h } = c;
    ctx.clearRect(0, 0, w, h);
    const x0 = 28;
    const x1 = w - 8;
    const y0 = h - 18;
    const y1 = 22;
    const tMax = 12;
    // C range shown: −0.2 … 1.2 (noisy estimates scatter beyond 0 and 1)
    const vLo = -0.2;
    const vHi = 1.2;
    const X = (t: number) => x0 + (Math.min(t, tMax) / tMax) * (x1 - x0);
    const Y = (v: number) => y0 - ((Math.max(vLo, Math.min(vHi, v)) - vLo) / (vHi - vLo)) * (y0 - y1);
    ctx.save();
    ctx.font = `10px ${TOKENS.font}`;
    ctx.strokeStyle = TOKENS.grid;
    ctx.fillStyle = TOKENS.ink3;
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [0, 0.5, 1]) {
      ctx.beginPath();
      ctx.moveTo(x0, Y(v));
      ctx.lineTo(x1, Y(v));
      ctx.stroke();
      ctx.fillText(String(v), x0 - 4, Y(v));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of [0, 4, 8, 12]) ctx.fillText(t === 12 ? '12 s' : String(t), X(t), y0 + 3);
    ctx.strokeStyle = TOKENS.axis;
    ctx.beginPath();
    ctx.moveTo(x0, y1);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(x0, y1 - 2, x1 - x0, y0 - y1 + 2);
    ctx.clip();
    const plot = (lags: ArrayLike<number>, curve: ArrayLike<number>, n: number, color: string, lw: number, dash: number[]) => {
      if (n < 1) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(X(0), Y(1));
      for (let i = 0; i < n; i++) ctx.lineTo(X(lags[i]), Y(curve[i]));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    // ±1σ shot-noise band around the live curve
    if (this.sigma > 0.02 && this.nCurve > 1) {
      const sg = this.sigma;
      ctx.fillStyle = 'rgba(233,238,245,0.10)';
      ctx.beginPath();
      ctx.moveTo(X(0), Y(1 + sg));
      for (let i = 0; i < this.nCurve; i++) ctx.lineTo(X(this.lags[i]), Y(this.curve[i] + sg));
      for (let i = this.nCurve - 1; i >= 0; i--) ctx.lineTo(X(this.lags[i]), Y(this.curve[i] - sg));
      ctx.lineTo(X(0), Y(1 - sg));
      ctx.closePath();
      ctx.fill();
    }
    if (this.earlier) plot(this.earlier.lags, this.earlier.curve, this.earlier.n, 'rgba(233,238,245,0.45)', 1.2, [3, 3]);
    plot(this.lags, this.curve, this.nCurve, accent, 1.8, []);
    ctx.restore();
    const noisy = this.nCurve >= 3 && this.sigma > 0.15;
    const hl = noisy ? null : this.halfLife();
    ctx.save();
    ctx.font = `600 10.5px ${TOKENS.font}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = noisy ? TOKENS.warn : TOKENS.ink;
    const span = this.nCurve ? this.lags[this.nCurve - 1] : 0;
    const noiseMsg = specialist ? `noisy: σ ≈ ±${this.sigma.toFixed(2)} per point` : 'too few photons: noisy';
    const msg = note ?? (this.nCurve < 3 ? 'recording…' : noisy ? noiseMsg : hl !== null ? `memory ≈ ${hl.toFixed(1)} s` : span >= 3 ? `memory > ${Math.floor(span)} s` : 'recording…');
    ctx.fillText(msg, x1, 14);
    if (this.earlier) {
      ctx.font = `500 9.5px ${TOKENS.font}`;
      ctx.fillStyle = TOKENS.ink3;
      ctx.fillText(specialist ? '--- 10 s earlier (aging)' : '--- 10 s earlier', x1, y1 + 12);
    }
    ctx.restore();
  }
}
