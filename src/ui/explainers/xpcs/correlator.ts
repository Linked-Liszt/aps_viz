/**
 * Multi-tau intensity autocorrelator for many detector pixels at once (the standard XPCS algorithm,
 * Schätzel 1990; as used in the 8-ID pipelines), with symmetric normalisation
 *
 *     g2(τ) = ⟨I(t) I(t+τ)⟩ / (⟨I(t)⟩_past ⟨I(t+τ)⟩_future)
 *
 * where all averages run over time AND over the pixels of a group set (a ring on the detector).
 *
 * Layout: m = 8 channels per level. Level 0 correlates raw frames at lags 1…7; level l ≥ 1 works on sums of
 * 2^l consecutive frames and adds lags 4…7 (×2^l frames) → 4 lags per octave up to 7·2^(L−1) frames.
 * All pixels receive frames synchronously, so the bookkeeping (counters, ring positions) is global and only
 * the 8-deep history per level is stored per pixel.
 *
 * Accumulators are pooled per *group* (radial bin × azimuthal sector), never per pixel:
 *   G[g, lag]    Σ_p∈g Σ_t I_p(t) I_p(t−k)
 *   S[l, g]      Σ_p∈g Σ_t I_p(t)          (all values seen at level l)
 *   FIRST[l,i,g] Σ_p∈g I_p(i)              (the first 7 values at level l)
 * The “past” and “future” means needed for symmetric normalisation follow exactly from S minus the first /
 * last k values (the last values are still in the per-pixel ring buffers), so the hot loop does a single
 * multiply-add per lag and skips pixels that recorded zero photons (sparse XPCS data).
 */
export const MT_M = 8;

export class MultiTau {
  readonly npix: number;
  readonly levels: number;
  readonly ngroups: number;
  readonly nLags: number;
  /** lag (frames) of each lag index */
  readonly lagFrames: Float64Array;
  /** bin width (frames) of each lag index */
  readonly lagBin: Float64Array;
  readonly lagLevel: Int32Array;
  readonly lagK: Int32Array;
  /** pixel → group */
  readonly group: Int32Array;
  /** CSR lists of pixels per group */
  readonly gStart: Int32Array;
  readonly gPix: Int32Array;
  readonly gCount: Int32Array;

  private buf: Float32Array[];
  private pend: Float32Array[];
  private scratch: Float32Array[];
  private cnt: Float64Array;
  private G: Float64Array;
  private S: Float64Array;
  private FIRST: Float64Array;
  private offs = new Int32Array(MT_M);
  private js = new Int32Array(MT_M);

  constructor(group: Int32Array, ngroups: number, levels = 12) {
    this.npix = group.length;
    this.levels = levels;
    this.ngroups = ngroups;
    this.group = group;
    const lf: number[] = [];
    const lb: number[] = [];
    const ll: number[] = [];
    const lk: number[] = [];
    for (let l = 0; l < levels; l++) {
      for (let k = l === 0 ? 1 : MT_M / 2; k < MT_M; k++) {
        lf.push(k * 2 ** l);
        lb.push(2 ** l);
        ll.push(l);
        lk.push(k);
      }
    }
    this.nLags = lf.length;
    this.lagFrames = Float64Array.from(lf);
    this.lagBin = Float64Array.from(lb);
    this.lagLevel = Int32Array.from(ll);
    this.lagK = Int32Array.from(lk);
    // CSR group lists
    this.gCount = new Int32Array(ngroups);
    for (let p = 0; p < this.npix; p++) this.gCount[group[p]]++;
    this.gStart = new Int32Array(ngroups + 1);
    for (let g = 0; g < ngroups; g++) this.gStart[g + 1] = this.gStart[g] + this.gCount[g];
    this.gPix = new Int32Array(this.npix);
    const fill = this.gStart.slice(0, ngroups);
    for (let p = 0; p < this.npix; p++) this.gPix[fill[group[p]]++] = p;

    this.buf = [];
    this.pend = [];
    this.scratch = [];
    for (let l = 0; l < levels; l++) {
      this.buf.push(new Float32Array(this.npix * MT_M));
      this.pend.push(new Float32Array(this.npix));
      this.scratch.push(new Float32Array(this.npix));
    }
    this.cnt = new Float64Array(levels);
    this.G = new Float64Array(ngroups * this.nLags);
    this.S = new Float64Array(levels * ngroups);
    this.FIRST = new Float64Array(levels * (MT_M - 1) * ngroups);
  }

  /** frames pushed since the last reset */
  get frames(): number {
    return this.cnt[0];
  }

  /** number of time pairs accumulated at lag index j (per pixel) */
  pairs(j: number): number {
    return Math.max(0, this.cnt[this.lagLevel[j]] - this.lagK[j]);
  }

  reset(): void {
    for (let l = 0; l < this.levels; l++) {
      this.buf[l].fill(0);
      this.pend[l].fill(0);
    }
    this.cnt.fill(0);
    this.G.fill(0);
    this.S.fill(0);
    this.FIRST.fill(0);
  }

  /** Push one frame (values for every analysed pixel, same order as `group`). */
  push(x: Float32Array): void {
    const np = this.npix;
    const grp = this.group;
    const nL = this.nLags;
    const G = this.G;
    const offs = this.offs;
    const js = this.js;
    let src = x;
    for (let l = 0; l < this.levels; l++) {
      const c = this.cnt[l];
      const B = this.buf[l];
      // lags valid at this level
      let nk = 0;
      const k0 = l === 0 ? 1 : MT_M / 2;
      const jBase = l === 0 ? -1 : MT_M - 1 + (l - 1) * (MT_M / 2) - MT_M / 2;
      for (let k = k0; k < MT_M; k++) {
        if (c >= k) {
          offs[nk] = (c - k) & (MT_M - 1);
          js[nk] = jBase + k;
          nk++;
        }
      }
      const w = c & (MT_M - 1);
      const Sl = l * this.ngroups;
      const S = this.S;
      for (let p = 0; p < np; p++) {
        const v = src[p];
        const base = p * MT_M;
        if (v !== 0) {
          const g = grp[p];
          const gb = g * nL;
          for (let i = 0; i < nk; i++) G[gb + js[i]] += v * B[base + offs[i]];
          S[Sl + g] += v;
        }
        B[base + w] = v;
      }
      if (c < MT_M - 1) {
        const F = this.FIRST;
        const fb = (l * (MT_M - 1) + c) * this.ngroups;
        for (let p = 0; p < np; p++) {
          const v = src[p];
          if (v !== 0) F[fb + grp[p]] += v;
        }
      }
      this.cnt[l] = c + 1;
      if ((c + 1) % 2 === 0) {
        if (l + 1 >= this.levels) break;
        const P = this.pend[l];
        const nx = this.scratch[l + 1];
        for (let p = 0; p < np; p++) nx[p] = P[p] + src[p];
        src = nx;
      } else {
        this.pend[l].set(src);
        break;
      }
    }
  }

  /**
   * Pooled sums for a set of groups at lag index j. Returns false if no pairs yet.
   * out = [G, IP(past), IF(future), pairs × pixels]
   */
  sums(groups: ArrayLike<number>, j: number, out: Float64Array): boolean {
    const l = this.lagLevel[j];
    const k = this.lagK[j];
    const c = this.cnt[l];
    if (c <= k) return false;
    const M = c - k;
    let g2n = 0;
    let ip = 0;
    let iff = 0;
    let npx = 0;
    const B = this.buf[l];
    const ng = this.ngroups;
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const n = this.gCount[g];
      if (!n) continue;
      npx += n;
      g2n += this.G[g * this.nLags + j];
      const s = this.S[l * ng + g];
      let first = 0;
      for (let i = 0; i < k; i++) first += this.FIRST[(l * (MT_M - 1) + i) * ng + g];
      let last = 0;
      for (let q = this.gStart[g]; q < this.gStart[g + 1]; q++) {
        const base = this.gPix[q] * MT_M;
        for (let i = 0; i < k; i++) last += B[base + ((c - 1 - i) & (MT_M - 1))];
      }
      iff += s - first;
      ip += s - last;
    }
    out[0] = g2n;
    out[1] = ip;
    out[2] = iff;
    out[3] = M * npx;
    return npx > 0;
  }

  private lastScratch = new Float64Array(MT_M);
  /**
   * Batched readout: for each listed group (index gi) and every lag j, write the pooled sums
   * G, IP (past) and IF (future) into arrays laid out [gi * nLags + j]. Lags without pairs get zeros.
   * The last-k sums are gathered once per level and group (cheap even for big rings).
   */
  groupLagSums(groups: ArrayLike<number>, G: Float64Array, IP: Float64Array, IF: Float64Array): void {
    const nL = this.nLags;
    const ng = this.ngroups;
    const last = this.lastScratch;
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const o = gi * nL;
      for (let l = 0; l < this.levels; l++) {
        const c = this.cnt[l];
        const B = this.buf[l];
        const S = this.S[l * ng + g];
        const kMax = Math.min(MT_M - 1, c);
        last.fill(0);
        for (let q = this.gStart[g]; q < this.gStart[g + 1]; q++) {
          const base = this.gPix[q] * MT_M;
          for (let i = 0; i < kMax; i++) last[i] += B[base + ((c - 1 - i) & (MT_M - 1))];
        }
        const k0 = l === 0 ? 1 : MT_M / 2;
        const jBase = l === 0 ? -1 : MT_M - 1 + (l - 1) * (MT_M / 2) - MT_M / 2;
        let firstSum = 0;
        let lastSum = 0;
        for (let k = 1; k < MT_M; k++) {
          firstSum += this.FIRST[(l * (MT_M - 1) + (k - 1)) * ng + g];
          lastSum += last[k - 1];
          if (k < k0) continue;
          const j = jBase + k;
          if (c <= k) {
            G[o + j] = IP[o + j] = IF[o + j] = 0;
          } else {
            G[o + j] = this.G[g * nL + j];
            IP[o + j] = S - lastSum;
            IF[o + j] = S - firstSum;
          }
        }
      }
    }
  }

  /** Mean value per pixel per frame (level 0) over a set of groups. */
  meanLevel0(groups: ArrayLike<number>): number {
    const c = this.cnt[0];
    if (!c) return NaN;
    let s = 0;
    let n = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      s += this.S[g];
      n += this.gCount[g];
    }
    return n ? s / (n * c) : NaN;
  }
}
