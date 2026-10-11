/**
 * HEDM station. Simulation state without DOM access.
 *
 *  • Far field: every (grain, reflection, ω-solution) spot on a 432 mm flat panel 1 m downstream, with
 *    radial shifts from the grain's elastic strain (optionally magnified for display) and an intensity from
 *    physics.spotFactor × grain area × absorption along the actual in/out paths through the rod.
 *  • ω coverage in 1° bins: a spot is "recorded" once the sample has turned through its bin.
 *  • Ring fits (quoted in the caption under load): per hkl, ε(η) = ε_⊥ + (ε_∥ − ε_⊥) sin²η fitted to the recorded spots' true-scale
 *    Bragg angles referred to their grain centroids (no parallax, independent of the ×20 display), giving the
 *    diffraction elastic constants E_hkl = σ/ε_∥ (≈ 270, 175, 246 GPa for 111, 200, 220 with this model).
 *  • Far-field indexing (illustrative): a grain counts as found once ≥ 8 spots and ≥ 8 % of its detectable
 *    full-turn spots have been recorded (one more grain per 0.2 s). Real codes (MIDAS, HEXRD, ImageD11)
 *    test candidate orientations against the spot list with a completeness threshold over the scanned ω range.
 *  • Near field: a slice is illuminated by a line beam; a 128 × 128 camera (25 µm pixels, coarse on purpose) sits 7 mm
 *    behind the axis. True frames are ray-cast voxel-by-voxel (48 × 48 voxel slice), on demand per 1° ω bin from
 *    a list of Bragg events sorted by ω; each grain carries 4 sub-grains that become misoriented after yield.
 *    Reconstruction = forward model (as in IceNine / HEXRD nf): each voxel tests the 24 far-field grain
 *    orientations (after yield also the 96 sub-grain ones); confidence C = (predicted spots landing on lit
 *    pixels) / (predicted spots on the camera). Bins are processed incrementally (time-budgeted per frame), so
 *    the map builds up as the sample turns.
 */
import * as P from './physics';
import { rng } from '../../../lib/fft';

export const FF = { L: 1000, half: 216, stop: 6 }; // mm: Varex 4343-class panel (432 × 432 mm) at 1 m
export const NF = { L: 7, half: 1.6, npx: 128 }; // mm: camera 7 mm behind the axis, 3.2 mm field of view
export const NBIN = 360;
export const N_GRAINS = 24;
export const N_FAM = 8;
export const NF_VOX = 48;
/** detectable-spot threshold relative to the reference median spot */
export const VIS = 0.02;
const NOISE_PIX = 5;
const MIN_TESTS = 3;

export type Mode = 'ff' | 'nf';

export interface RingFit {
  fam: number;
  /** unstrained ring radius L·tan2θ₀, mm */
  R0: number;
  /** sinθ₀ = λ/2d₀ of the unstrained ring */
  sin0: number;
  n: number;
  /** fitted lattice strain across / along the load (true scale): ε(η) = ε_⊥ + (ε_∥ − ε_⊥) sin²η */
  epsPerp: number;
  epsPar: number;
}

export class HedmSim {
  readonly grains: P.Grain[];
  readonly ng: number;
  readonly fams: P.Family[];
  /** f² e^{−2Bs²} per family */
  private readonly fdw: Float64Array;
  readonly el: P.Elastic;
  readonly ni = P.MATERIALS.ni;

  // ---------------------------------------------------------------- parameters
  E = 70;
  /** rod diameter, mm */
  D = 1;
  /** applied macroscopic strain (fraction) */
  eps = 0;
  /** radial-shift magnification on the far-field display */
  mag = 20;

  // ---------------------------------------------------------------- derived
  lambda = P.wavelength(70);
  /** μ of Ni at E (1/mm) */
  mu = 0;
  macro: P.MacroState;
  fx: P.PlasticFx;
  /** current orientations (with plastic rigid rotation), ng × 9 */
  readonly Ucur: Float64Array;
  /** true elastic strain tensors, sample frame, ng × 9 */
  readonly strain: Float64Array;

  // ---------------------------------------------------------------- far-field spots
  n = 0;
  readonly spGrain: Uint8Array;
  readonly spFam: Uint8Array;
  readonly spOmega: Float32Array;
  readonly spBin: Uint16Array;
  readonly spY: Float32Array;
  readonly spZ: Float32Array;
  /** relative intensity (1 ≈ median spot at 70 keV, 1 mm, no load) */
  readonly spI: Float32Array;
  /**
   * TRUE-scale sinθ of the spot and sin²η of its azimuth (whatever the display magnification), referred to the
   * grain's own centroid: what an indexed ff-HEDM analysis measures once the grain centroid is known, free of the
   * ±(grain offset)/R radial parallax on the panel. Neither depends on ω: sinθ = λ|g'|/2 with g' = (I − ε)g, and
   * since g_lab,x = −λ|g|²/2 and g_z is invariant under R_z, sin²η = d̂_z²/(d̂_y² + d̂_z²) = ĝ_z²/cos²θ.
   */
  readonly spSinT: Float32Array;
  readonly spS2: Float32Array;
  readonly spOn: Uint8Array;
  /** spot indices sorted by ω; binStart indexes into it */
  readonly order: Uint32Array;
  readonly binStart = new Int32Array(NBIN + 1);
  private Iref = 1;

  // ---------------------------------------------------------------- coverage & indexing
  readonly visited = new Uint8Array(NBIN);
  nVisited = 0;
  /** bumps whenever the set of visited bins changes (sweep / reset) */
  covVersion = 0;
  readonly totalSpots: Uint16Array;
  readonly seenSpots: Uint16Array;
  readonly found: Uint8Array;
  nFound = 0;
  /** bumps whenever the far-field spot list changes (views redraw) */
  ffVersion = 0;

  // ---------------------------------------------------------------- near field
  readonly nv: number;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vGrain: Uint8Array;
  readonly vSub: Uint8Array;
  /** voxel index of grid cell (−1 outside) */
  readonly vIndex: Int32Array;
  /** voxel centres in mm (rebuilt with the rod diameter) */
  private vpx: Float32Array;
  private vpy: Float32Array;
  /** voxels grouped by sub-grain (gs = 4·grain + sub): subVox[subStart[gs] .. SubStart[gs+1]) */
  private readonly subStart: Int32Array;
  private readonly subVox: Int32Array;
  /**
   * True near-field diffraction events, one per (grain or sub-grain, reflection, ω solution), sorted by ω bin.
   * A frame is rendered on demand by projecting only the voxels that diffract in that bin (~10³ ray casts),
   * so a rebuild after a slider change costs a few ms instead of casting all ~4·10⁵ voxel rays up front.
   */
  private sBinStart = new Int32Array(NBIN + 1);
  /** voxel range subVox[sV0 .. SV1) that diffracts, and its grain */
  private sV0: Int32Array;
  private sV1: Int32Array;
  private sG: Uint8Array;
  private sCos: Float32Array;
  private sSin: Float32Array;
  private sDx: Float32Array;
  private sDy: Float32Array;
  private sDz: Float32Array;
  /** ln(relative spot strength) before absorption */
  private sLnI: Float32Array;
  /** rod radius (mm) and μ (1/mm) the near-field model was built for */
  private nfR = 0.5;
  private nfMu = 0;
  private cBinStart = new Int32Array(NBIN + 1);
  /** candidate index per candidate spot (0..ng−1: grain-average orientations; ng + 4g + s: sub-grain s of grain g) */
  private cGrain: Uint8Array;
  /** number of candidate orientations in the current model */
  nCand = 0;
  /** IPF colour of each candidate */
  readonly candIpf: Float32Array;
  private cCos: Float32Array;
  private cSin: Float32Array;
  private cTy: Float32Array;
  private cTz: Float32Array;
  readonly tests: Uint16Array;
  readonly hits: Uint16Array;
  readonly processed = new Uint8Array(NBIN);
  private queue: number[] = [];
  private readonly frame: Uint8Array;
  private readonly touched: Int32Array;
  private nfIref = 1;
  /** bumps when the reconstruction changes */
  nfVersion = 0;
  nfDirty = true;

  constructor(seed = 7) {
    this.grains = P.makeMicrostructure(N_GRAINS, seed);
    this.ng = this.grains.length;
    this.fams = P.fccFamilies(P.NI.a, N_FAM);
    this.fdw = new Float64Array(this.fams.map((f) => P.fDW(f.d)));
    this.el = P.elastic();
    this.macro = P.macroState(0, this.el);
    this.fx = P.plasticFx(0);
    this.Ucur = new Float64Array(this.ng * 9);
    this.strain = new Float64Array(this.ng * 9);
    let members = 0;
    for (const f of this.fams) members += f.n;
    const cap = this.ng * members * 2;
    this.spGrain = new Uint8Array(cap);
    this.spFam = new Uint8Array(cap);
    this.spOmega = new Float32Array(cap);
    this.spBin = new Uint16Array(cap);
    this.spY = new Float32Array(cap);
    this.spZ = new Float32Array(cap);
    this.spI = new Float32Array(cap);
    this.spSinT = new Float32Array(cap);
    this.spS2 = new Float32Array(cap);
    this.spOn = new Uint8Array(cap);
    this.order = new Uint32Array(cap);
    this.totalSpots = new Uint16Array(this.ng);
    this.seenSpots = new Uint16Array(this.ng);
    this.found = new Uint8Array(this.ng);

    // near-field voxel grid
    const N = NF_VOX;
    const vx: number[] = [];
    const vy: number[] = [];
    const vg: number[] = [];
    const vs: number[] = [];
    this.vIndex = new Int32Array(N * N).fill(-1);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = -1 + (2 * (i + 0.5)) / N;
        const y = 1 - (2 * (j + 0.5)) / N;
        if (x * x + y * y > 1) continue;
        const g = P.grainAt(this.grains, x, y);
        this.vIndex[j * N + i] = vx.length;
        vx.push(x);
        vy.push(y);
        vg.push(g);
        vs.push(0);
      }
    // sub-grains (used once the metal has yielded): Voronoi cells of 4 random voxels inside each grain
    {
      const r = rng(seed * 31 + 5);
      const byGrain: number[][] = this.grains.map(() => []);
      for (let v = 0; v < vx.length; v++) byGrain[vg[v]].push(v);
      for (let g = 0; g < this.grains.length; g++) {
        const list = byGrain[g];
        if (!list.length) continue;
        const seeds: number[] = [];
        for (let k = 0; k < 4; k++) seeds.push(list[Math.floor(r() * list.length)]);
        for (const v of list) {
          let best = 0;
          let bd = Infinity;
          for (let k = 0; k < 4; k++) {
            const d = (vx[v] - vx[seeds[k]]) ** 2 + (vy[v] - vy[seeds[k]]) ** 2;
            if (d < bd) {
              bd = d;
              best = k;
            }
          }
          vs[v] = best;
        }
      }
    }
    this.nv = vx.length;
    this.vx = new Float32Array(vx);
    this.vy = new Float32Array(vy);
    this.vGrain = new Uint8Array(vg);
    this.vSub = new Uint8Array(vs);
    this.vpx = new Float32Array(this.nv);
    this.vpy = new Float32Array(this.nv);
    const nsub = this.ng * 4;
    this.subStart = new Int32Array(nsub + 1);
    this.subVox = new Int32Array(this.nv);
    for (let v = 0; v < this.nv; v++) this.subStart[this.vGrain[v] * 4 + this.vSub[v] + 1]++;
    for (let k = 0; k < nsub; k++) this.subStart[k + 1] += this.subStart[k];
    {
      const pos = this.subStart.slice(0, nsub);
      for (let v = 0; v < this.nv; v++) this.subVox[pos[this.vGrain[v] * 4 + this.vSub[v]]++] = v;
    }
    const scap = nsub * members * 2;
    this.sV0 = new Int32Array(scap);
    this.sV1 = new Int32Array(scap);
    this.sG = new Uint8Array(scap);
    this.sCos = new Float32Array(scap);
    this.sSin = new Float32Array(scap);
    this.sDx = new Float32Array(scap);
    this.sDy = new Float32Array(scap);
    this.sDz = new Float32Array(scap);
    this.sLnI = new Float32Array(scap);
    const ccap = this.ng * 5 * members * 2;
    this.cGrain = new Uint8Array(ccap);
    this.cCos = new Float32Array(ccap);
    this.cSin = new Float32Array(ccap);
    this.cTy = new Float32Array(ccap);
    this.cTz = new Float32Array(ccap);
    this.tests = new Uint16Array(this.nv * this.ng * 5);
    this.hits = new Uint16Array(this.nv * this.ng * 5);
    this.candIpf = new Float32Array(this.ng * 5 * 3);
    this.frame = new Uint8Array(NF.npx * NF.npx);
    this.touched = new Int32Array(NF.npx * NF.npx);

    // reference intensities at 70 keV, 1 mm, unloaded
    this.updateLoad();
    this.updateFF();
    const on: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.spOn[i]) on.push(this.spI[i]);
    on.sort((a, b) => a - b);
    this.Iref = on[on.length >> 1] || 1;
    this.updateFF();
    this.nfIref = this.spotFactorMedian();
  }

  private spotFactorMedian(): number {
    const v: number[] = [];
    const lam = P.wavelength(70);
    const tmp = new Float64Array(8);
    const g = this.grains[0];
    for (const f of this.fams)
      for (let m = 0; m < f.n; m++) {
        const nx = f.normals[m * 3];
        const ny = f.normals[m * 3 + 1];
        const nz = f.normals[m * 3 + 2];
        const U = g.U;
        const k = P.solveOmega((U[0] * nx + U[1] * ny + U[2] * nz) / f.d, (U[3] * nx + U[4] * ny + U[5] * nz) / f.d, (U[6] * nx + U[7] * ny + U[8] * nz) / f.d, lam, tmp);
        for (let s = 0; s < k; s++) v.push(P.spotFactor(lam, f.d, tmp[s * 4 + 2], tmp[s * 4 + 3]));
      }
    v.sort((a, b) => a - b);
    return v[v.length >> 1] || 1;
  }

  // ---------------------------------------------------------------- parameter updates

  /** macroscopic state, grain orientations and strains from eps */
  updateLoad(): void {
    this.macro = P.macroState(this.eps, this.el);
    this.fx = P.plasticFx(this.macro.epsP);
    const R = P.mat3();
    const e = P.mat3();
    for (const g of this.grains) {
      const a = g.rotAxis;
      P.rotVec(a[0] * this.fx.rot, a[1] * this.fx.rot, a[2] * this.fx.rot, R);
      const U = P.matMul(R, g.U);
      this.Ucur.set(U, g.id * 9);
      P.grainStrain(U, this.macro.sigma, this.el, e);
      this.strain.set(e, g.id * 9);
    }
  }

  /** wavelength and attenuation at the current energy (cheap; call as soon as E changes) */
  updateBeam(): void {
    this.lambda = P.wavelength(this.E);
    this.mu = P.muPerMm(this.ni, this.E);
  }

  /** recompute all far-field spots (call after E, D, eps or mag change) */
  updateFF(): void {
    this.updateBeam();
    const lam = this.lambda;
    const R = this.D / 2;
    const tmp = new Float64Array(8);
    const B = new Float64Array(9);
    let n = 0;
    let sinT = 0;
    let s2T = 0;
    for (const g of this.grains) {
      const U = this.Ucur.subarray(g.id * 9, g.id * 9 + 9);
      const e = this.strain.subarray(g.id * 9, g.id * 9 + 9);
      // B = (I − mag·ε) U
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          let s = 0;
          for (let k = 0; k < 3; k++) s += ((i === k ? 1 : 0) - this.mag * e[i * 3 + k]) * U[k * 3 + j];
          B[i * 3 + j] = s;
        }
      const cx = g.cx * R;
      const cy = g.cy * R;
      for (let fi = 0; fi < this.fams.length; fi++) {
        const f = this.fams[fi];
        const inv = 1 / f.d;
        for (let m = 0; m < f.n; m++) {
          const nx = f.normals[m * 3];
          const ny = f.normals[m * 3 + 1];
          const nz = f.normals[m * 3 + 2];
          const gx = (B[0] * nx + B[1] * ny + B[2] * nz) * inv;
          const gy = (B[3] * nx + B[4] * ny + B[5] * nz) * inv;
          const gz = (B[6] * nx + B[7] * ny + B[8] * nz) * inv;
          const k = P.solveOmega(gx, gy, gz, lam, tmp);
          if (k) {
            // true-scale Bragg angle and azimuth of this reflection (for the ring fits)
            const sx = U[0] * nx + U[1] * ny + U[2] * nz;
            const sy = U[3] * nx + U[4] * ny + U[5] * nz;
            const sz = U[6] * nx + U[7] * ny + U[8] * nz;
            const tz = sz - (e[6] * sx + e[7] * sy + e[8] * sz);
            const tl = Math.hypot(sx - (e[0] * sx + e[1] * sy + e[2] * sz), sy - (e[3] * sx + e[4] * sy + e[5] * sz), tz);
            sinT = (lam * inv * tl) / 2;
            s2T = Math.min(1, (tz * tz) / (tl * tl * (1 - sinT * sinT)));
          }
          for (let s = 0; s < k; s++) {
            const om = tmp[s * 4];
            const dx = tmp[s * 4 + 1];
            const dy = tmp[s * 4 + 2];
            const dz = tmp[s * 4 + 3];
            const c = Math.cos(om);
            const sn = Math.sin(om);
            const px = c * cx - sn * cy;
            const py = sn * cx + c * cy;
            const t = (FF.L - px) / dx;
            const Y = py + t * dy;
            const Z = t * dz;
            const path = P.entryPath(px, py, R) + P.exitPath(px, py, dx, dy, R);
            this.spGrain[n] = g.id;
            this.spFam[n] = fi;
            this.spOmega[n] = om;
            this.spBin[n] = Math.min(NBIN - 1, Math.floor(om / P.DEG));
            this.spY[n] = Y;
            this.spZ[n] = Z;
            this.spI[n] = (P.spotFactor(lam, f.d, dy, dz, this.fdw[fi]) * g.area * Math.exp(-this.mu * path)) / this.Iref;
            this.spSinT[n] = sinT;
            this.spS2[n] = s2T;
            this.spOn[n] = Math.abs(Y) <= FF.half && Math.abs(Z) <= FF.half && Y * Y + Z * Z > FF.stop * FF.stop ? 1 : 0;
            n++;
          }
        }
      }
    }
    this.n = n;
    // counting sort by bin
    const bs = this.binStart;
    bs.fill(0);
    for (let i = 0; i < n; i++) bs[this.spBin[i] + 1]++;
    for (let b = 0; b < NBIN; b++) bs[b + 1] += bs[b];
    const fill = bs.slice(0, NBIN);
    for (let i = 0; i < n; i++) this.order[fill[this.spBin[i]]++] = i;
    // sort within bins by ω (small)
    for (let b = 0; b < NBIN; b++) {
      const a = bs[b];
      const z = bs[b + 1];
      for (let i = a + 1; i < z; i++) {
        const v = this.order[i];
        let j = i - 1;
        while (j >= a && this.spOmega[this.order[j]] > this.spOmega[v]) {
          this.order[j + 1] = this.order[j];
          j--;
        }
        this.order[j + 1] = v;
      }
    }
    this.ffVersion++;
    this.recount();
  }

  /** a spot is detectable on the far-field panel */
  detectable(i: number): boolean {
    return this.spOn[i] === 1 && this.spI[i] >= VIS;
  }

  /** far-field indexing completeness per grain; grains that lost their spots (absorption) are dropped */
  recount(): void {
    this.totalSpots.fill(0);
    this.seenSpots.fill(0);
    for (let i = 0; i < this.n; i++) {
      if (!this.detectable(i)) continue;
      const g = this.spGrain[i];
      this.totalSpots[g]++;
      if (this.visited[this.spBin[i]]) this.seenSpots[g]++;
    }
    let nf = 0;
    for (let g = 0; g < this.ng; g++) {
      if (this.found[g] && !this.indexable(g)) this.found[g] = 0;
      nf += this.found[g];
    }
    this.nFound = nf;
  }

  /** enough of a grain's spots recorded for an indexing code to lock onto it (illustrative threshold) */
  indexable(g: number): boolean {
    const t = this.totalSpots[g];
    return t >= 8 && this.seenSpots[g] >= Math.max(8, 0.08 * t);
  }

  private indexTimer = 0;
  /** "the computer works through the spot list": one more indexable grain is found every 0.2 s */
  stepIndexing(dt: number): boolean {
    this.indexTimer += dt;
    let changed = false;
    while (this.indexTimer >= 0.2) {
      let best = -1;
      let bv = -1;
      for (let g = 0; g < this.ng; g++) {
        if (this.found[g] || !this.indexable(g)) continue;
        const v = this.seenSpots[g] / this.totalSpots[g];
        if (v > bv) {
          bv = v;
          best = g;
        }
      }
      if (best < 0) {
        this.indexTimer = 0.2;
        break;
      }
      this.found[best] = 1;
      this.nFound++;
      this.indexTimer -= 0.2;
      changed = true;
    }
    return changed;
  }

  // ---------------------------------------------------------------- rotation coverage

  /** Mark bins swept between ω0 and ω1 (radians). ForwardWrap: animation (always increasing, wraps at 2π). */
  sweep(om0: number, om1: number, forwardWrap: boolean): number[] {
    const fresh: number[] = [];
    const b0 = Math.floor(om0 / P.DEG);
    const b1 = Math.floor(om1 / P.DEG);
    const mark = (b: number) => {
      const k = ((b % NBIN) + NBIN) % NBIN;
      if (!this.visited[k]) {
        this.visited[k] = 1;
        this.nVisited++;
        fresh.push(k);
      }
    };
    if (forwardWrap) {
      let steps = b1 - b0;
      if (steps < 0) steps += NBIN;
      steps = Math.min(steps, NBIN - 1);
      for (let s = 0; s <= steps; s++) mark(b0 + s);
    } else {
      const lo = Math.min(b0, b1);
      const hi = Math.max(b0, b1);
      for (let b = lo; b <= hi; b++) mark(b);
    }
    if (fresh.length) {
      this.covVersion++;
      this.recount();
      for (const b of fresh) this.queue.push(b);
    }
    return fresh;
  }

  resetCoverage(): void {
    this.visited.fill(0);
    this.nVisited = 0;
    this.covVersion++;
    this.found.fill(0);
    this.indexTimer = 0;
    this.queue.length = 0;
    this.tests.fill(0);
    this.hits.fill(0);
    this.processed.fill(0);
    this.recount();
    this.nfVersion++;
  }

  /** Spot indices with ω in the half-open arc (om0, om1] travelled forward (wrap) or backward. */
  crossings(om0: number, om1: number, forward: boolean, out: number[], max = 40): void {
    out.length = 0;
    if (om0 === om1) return;
    const TWO = 2 * Math.PI;
    const lo = forward ? om0 : om1;
    let hi = forward ? om1 : om0;
    if (hi < lo) hi += TWO;
    if (hi - lo > Math.PI) return; // a jump, not a sweep
    // only the ω bins the arc touches (spots are sorted by bin, then ω)
    const b0 = Math.floor(lo / P.DEG);
    const b1 = Math.floor(hi / P.DEG);
    for (let bb = b0; bb <= b1 && out.length < max; bb++) {
      const b = ((bb % NBIN) + NBIN) % NBIN;
      for (let q = this.binStart[b], q1 = this.binStart[b + 1]; q < q1 && out.length < max; q++) {
        const i = this.order[q];
        if (!this.detectable(i)) continue;
        let w = this.spOmega[i];
        if (w <= lo) w += TWO;
        if (w > lo && w <= hi) out.push(i);
      }
    }
  }

  // ---------------------------------------------------------------- near field

  /** (Re)build true near-field spots and candidate spots; restarts the reconstruction over visited bins. */
  buildNF(): void {
    this.nfDirty = false;
    const lam = this.lambda;
    const R = this.D / 2;
    for (let v = 0; v < this.nv; v++) {
      this.vpx[v] = this.vx[v] * R;
      this.vpy[v] = this.vy[v] * R;
    }
    const ng = this.ng;
    // Orientations o: 0..ng−1 grain averages (from the far field), ng + 4g + s sub-grain s of grain g. After
    // yield the sub-grains are misoriented: they make the true frames and join the candidate list (a local
    // orientation search around each ff grain, as real nf codes do). Before yield they differ by ≤ 0.03°
    // (≈ 1 µm on the camera, far below a pixel), so each grain diffracts as one orientation.
    const subOn = this.fx.spread > 0.2 * P.DEG;
    const sigma = this.fx.spread / 2.355;
    const nOri = subOn ? ng * 5 : ng;
    this.nCand = nOri;
    this.nfR = R;
    this.nfMu = this.mu;
    const tmp = new Float64Array(8);
    const Rm = P.mat3();
    const U = P.mat3();
    const sBin = new Uint16Array(this.sG.length);
    const cBin = new Uint16Array(this.cGrain.length);
    let ns = 0;
    let nc = 0;
    for (let o = 0; o < nOri; o++) {
      const g = o < ng ? o : (o - ng) >> 2;
      const Ug = this.Ucur.subarray(g * 9, g * 9 + 9);
      if (o < ng) U.set(Ug);
      else {
        const sI = (o - ng) & 3;
        const q = this.grains[g].sub;
        P.rotVec(q[sI * 3] * sigma, q[sI * 3 + 1] * sigma, q[sI * 3 + 2] * sigma, Rm);
        P.matMul(Rm, Ug, U);
      }
      this.candIpf.set(P.ipfColor(U), o * 3);
      // voxels this orientation really occupies (none: a grain average after yield is only a candidate)
      const isTrue = subOn ? o >= ng : true;
      const v0 = !isTrue ? 0 : subOn ? this.subStart[o - ng] : this.subStart[4 * g];
      const v1 = !isTrue ? 0 : subOn ? this.subStart[o - ng + 1] : this.subStart[4 * g + 4];
      for (let fi = 0; fi < this.fams.length; fi++) {
        const f = this.fams[fi];
        const inv = 1 / f.d;
        for (let m = 0; m < f.n; m++) {
          const nx = f.normals[m * 3];
          const ny = f.normals[m * 3 + 1];
          const nz = f.normals[m * 3 + 2];
          const k = P.solveOmega((U[0] * nx + U[1] * ny + U[2] * nz) * inv, (U[3] * nx + U[4] * ny + U[5] * nz) * inv, (U[6] * nx + U[7] * ny + U[8] * nz) * inv, lam, tmp);
          for (let j = 0; j < k; j++) {
            const om = tmp[j * 4];
            const dx = tmp[j * 4 + 1];
            const dy = tmp[j * 4 + 2];
            const dz = tmp[j * 4 + 3];
            const bin = Math.min(NBIN - 1, Math.floor(om / P.DEG));
            const c = Math.cos(om);
            const sn = Math.sin(om);
            cBin[nc] = bin;
            this.cGrain[nc] = o;
            this.cCos[nc] = c;
            this.cSin[nc] = sn;
            this.cTy[nc] = dy / dx;
            this.cTz[nc] = dz / dx;
            nc++;
            if (v1 <= v0) continue;
            sBin[ns] = bin;
            this.sV0[ns] = v0;
            this.sV1[ns] = v1;
            this.sG[ns] = g;
            this.sCos[ns] = c;
            this.sSin[ns] = sn;
            this.sDx[ns] = dx;
            this.sDy[ns] = dy;
            this.sDz[ns] = dz;
            this.sLnI[ns] = Math.log(Math.max(1e-30, P.spotFactor(lam, f.d, dy, dz, this.fdw[fi]) / this.nfIref));
            ns++;
          }
        }
      }
    }
    this.sortByBin(sBin, ns, this.sBinStart, [this.sV0, this.sV1, this.sG, this.sCos, this.sSin, this.sDx, this.sDy, this.sDz, this.sLnI]);
    this.sortByBin(cBin, nc, this.cBinStart, [this.cGrain, this.cCos, this.cSin, this.cTy, this.cTz]);
    // restart the reconstruction over the bins seen so far
    this.tests.fill(0);
    this.hits.fill(0);
    this.processed.fill(0);
    this.queue.length = 0;
    for (let b = 0; b < NBIN; b++) if (this.visited[b]) this.queue.push(b);
    this.nfVersion++;
  }

  private sortByBin(bins: Uint16Array, n: number, start: Int32Array, arrays: (Int32Array | Uint8Array | Float32Array)[]): void {
    start.fill(0);
    for (let i = 0; i < n; i++) start[bins[i] + 1]++;
    for (let b = 0; b < NBIN; b++) start[b + 1] += start[b];
    const pos = start.slice(0, NBIN);
    const perm = new Int32Array(n);
    for (let i = 0; i < n; i++) perm[pos[bins[i]]++] = i;
    for (const a of arrays) {
      const copy = a.slice(0, n);
      for (let i = 0; i < n; i++) a[i] = copy[perm[i]];
    }
  }

  /**
   * Render the true near-field frame of bin b into this.frame (grain+1, 255 = noise). Returns the number of
   * lit pixels; their indices are in this.touched. Call clearFrame() afterwards.
   */
  renderFrame(b: number): number {
    const npx = NF.npx;
    const invPx = npx / (2 * NF.half);
    const half = NF.half;
    const L = NF.L;
    const R = this.nfR;
    const R2 = R * R;
    const mu = this.nfMu;
    const lnThr = Math.log(0.05);
    // longest in+out path through the rod (small 2θ: ≈ the diameter; 2.2R covers 2θ ≲ 25°)
    const muMax = mu * 2.2 * R;
    const vpx = this.vpx;
    const vpy = this.vpy;
    const subVox = this.subVox;
    const touched = this.touched;
    let nt = 0;
    const f = this.frame;
    const nf = f.length;
    for (let k = this.sBinStart[b], k1 = this.sBinStart[b + 1]; k < k1; k++) {
      const g = this.sG[k] + 1;
      const c = this.sCos[k];
      const sn = this.sSin[k];
      const dx = this.sDx[k];
      const dy = this.sDy[k];
      const dz = this.sDz[k];
      const lnI = this.sLnI[k];
      const weak = lnI - muMax < lnThr;
      for (let q = this.sV0[k], q1 = this.sV1[k]; q < q1; q++) {
        const v = subVox[q];
        const px0 = vpx[v];
        const py0 = vpy[v];
        const px = c * px0 - sn * py0;
        const py = sn * px0 + c * py0;
        const t = (L - px) / dx;
        const fx = (half - py - t * dy) * invPx;
        const fz = (half - t * dz) * invPx;
        if (fx < 0 || fx >= npx || fz < 0 || fz >= npx) continue;
        if (weak) {
          // absorption may matter: entry path along +x, exit path along d̂ to the cylinder surface
          const hIn = R2 - py * py;
          const pin = hIn > 0 ? px + Math.sqrt(hIn) : 0;
          const a = dx * dx + dy * dy;
          const bb = px * dx + py * dy;
          const disc = bb * bb - a * (px * px + py * py - R2);
          const pout = disc > 0 ? (-bb + Math.sqrt(disc)) / a : 0;
          if (lnI - mu * (pin + pout) < lnThr) continue;
        }
        const p = (fz | 0) * npx + (fx | 0);
        if (!f[p]) touched[nt++] = p;
        f[p] = g;
        // 2-px tall: tolerance for rounding of the thin line-beam streaks
        const p2 = p + npx;
        if (p2 < nf) {
          if (!f[p2]) touched[nt++] = p2;
          f[p2] = g;
        }
      }
    }
    // a few hot pixels / zingers
    for (let i = 0; i < NOISE_PIX; i++) {
      let h = Math.imul(b * 7919 + i * 104729 + 17, 2654435761) >>> 0;
      h = (h ^ (h >>> 13)) >>> 0;
      const p = h % f.length;
      if (!f[p]) this.touched[nt++] = p;
      f[p] = 255;
    }
    return nt;
  }
  clearFrame(nt: number): void {
    for (let i = 0; i < nt; i++) this.frame[this.touched[i]] = 0;
  }
  get frameBuf(): Uint8Array {
    return this.frame;
  }
  get touchedBuf(): Int32Array {
    return this.touched;
  }

  private processBin(b: number): void {
    const nt = this.renderFrame(b);
    const npx = NF.npx;
    const invPx = npx / (2 * NF.half);
    const half = NF.half;
    const L = NF.L;
    const f = this.frame;
    const nv = this.nv;
    const vpx = this.vpx;
    const vpy = this.vpy;
    const tests = this.tests;
    const hits = this.hits;
    const cG = this.cGrain;
    const cC = this.cCos;
    const cS = this.cSin;
    const cY = this.cTy;
    const cZ = this.cTz;
    for (let k = this.cBinStart[b], k1 = this.cBinStart[b + 1]; k < k1; k++) {
      const o = cG[k];
      const c = cC[k];
      const s = cS[k];
      const ty = cY[k];
      const tz = cZ[k];
      const ob = o * nv;
      for (let v = 0; v < nv; v++) {
        const x0 = vpx[v];
        const y0 = vpy[v];
        const t = L - (c * x0 - s * y0);
        const fx = (half - (s * x0 + c * y0) - t * ty) * invPx;
        const fz = (half - t * tz) * invPx;
        if (fx < 0 || fx >= npx || fz < 0 || fz >= npx) continue;
        const a = ob + v;
        tests[a]++;
        if (f[(fz | 0) * npx + (fx | 0)]) hits[a]++;
      }
    }
    this.clearFrame(nt);
    this.processed[b] = 1;
  }

  /** Work through queued bins for at most `budgetMs`. Returns true if anything was processed. */
  pumpNF(budgetMs: number): boolean {
    if (this.nfDirty || !this.queue.length) return false;
    const t0 = performance.now();
    let did = false;
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const b = this.queue.shift()!;
      if (this.processed[b]) continue;
      this.processBin(b);
      did = true;
    }
    if (did) this.nfVersion++;
    return did;
  }
  get nfPending(): number {
    return this.queue.length;
  }

  /** grain of a candidate orientation */
  candGrain(o: number): number {
    return o < this.ng ? o : (o - this.ng) >> 2;
  }

  /** best candidate orientation o, its grain g and confidence c of voxel v (o = g = −1 if not enough tests yet) */
  best(v: number): { o: number; g: number; c: number } {
    let bo = -1;
    let bc = 0;
    const nv = this.nv;
    for (let o = 0; o < this.nCand; o++) {
      const t = this.tests[o * nv + v];
      if (t < MIN_TESTS) continue;
      const c = this.hits[o * nv + v] / t;
      if (c > bc + 1e-9) {
        bc = c;
        bo = o;
      }
    }
    return { o: bo, g: bo < 0 ? -1 : this.candGrain(bo), c: bc };
  }

  /**
   * best() for every voxel at once (same result and tie-breaking), sweeping the tests/hits arrays in memory
   * order (candidate-major). ~10× faster than calling best(v) per voxel, which strides by nv.
   */
  bestAll(outO: Int16Array, outC: Float32Array): void {
    const nv = this.nv;
    const tests = this.tests;
    const hits = this.hits;
    outO.fill(-1);
    outC.fill(0);
    for (let o = 0; o < this.nCand; o++) {
      const base = o * nv;
      for (let v = 0; v < nv; v++) {
        const t = tests[base + v];
        if (t < MIN_TESTS) continue;
        const c = hits[base + v] / t;
        if (c > outC[v] + 1e-9) {
          outC[v] = c;
          outO[v] = o;
        }
      }
    }
  }

  /** summary of a bestAll() result: fraction of voxels mapped (C ≥ 0.5), of those the fraction matching the truth */
  summarize(bo: Int16Array, bc: Float32Array): { mapped: number; correct: number; meanC: number } {
    let mapped = 0;
    let ok = 0;
    let sc = 0;
    for (let v = 0; v < this.nv; v++) {
      if (bo[v] < 0 || bc[v] < 0.5) continue;
      mapped++;
      sc += bc[v];
      if (this.candGrain(bo[v]) === this.vGrain[v]) ok++;
    }
    return { mapped: mapped / this.nv, correct: mapped ? ok / mapped : 0, meanC: mapped ? sc / mapped : 0 };
  }

  /** reconstruction summary: fraction of voxels mapped (C ≥ 0.5) and of those, fraction matching the truth */
  nfStats(): { mapped: number; correct: number; meanC: number } {
    const bo = new Int16Array(this.nv);
    const bc = new Float32Array(this.nv);
    this.bestAll(bo, bc);
    return this.summarize(bo, bc);
  }

  // ---------------------------------------------------------------- ring analysis

  private fitKey = -1;
  private fitCache: RingFit[] = [];
  /**
   * Per ring family, least-squares fit of the recorded spots' lattice strain vs azimuth,
   * ε(η) = ε_⊥ + (ε_∥ − ε_⊥) sin²η (the far-field analogue of a sin²ψ analysis), with η from the horizontal.
   * Each spot's lattice strain follows from its true-scale Bragg angle, ε = 1 − sinθ/sinθ₀ (spSinT, spS2), so
   * the ×20 display and true size give the same numbers. Angles are referred to each grain's centroid, as after
   * indexing: the raw panel radius carries a parallax of up to ±(grain offset)/R ≈ 6×10⁻³ for a 1 mm rod
   * (3×10⁻² for 5 mm), larger than the elastic strain itself at true scale.
   */
  ringFits(): RingFit[] {
    const key = this.ffVersion * 1e6 + this.covVersion;
    if (key === this.fitKey) return this.fitCache;
    this.fitKey = key;
    const nf = this.fams.length;
    const sin0 = this.fams.map((f) => this.lambda / (2 * f.d));
    const S = new Float64Array(nf * 5); // n, Σs, Σs², Σε, Σsε
    for (let i = 0; i < this.n; i++) {
      if (!this.detectable(i) || !this.visited[this.spBin[i]]) continue;
      const f = this.spFam[i];
      const s2 = this.spS2[i];
      const e = 1 - this.spSinT[i] / sin0[f];
      const o = f * 5;
      S[o]++;
      S[o + 1] += s2;
      S[o + 2] += s2 * s2;
      S[o + 3] += e;
      S[o + 4] += s2 * e;
    }
    const out: RingFit[] = [];
    for (let f = 0; f < nf; f++) {
      const o = f * 5;
      const n = S[o];
      const det = n * S[o + 2] - S[o + 1] * S[o + 1];
      if (n < 8 || det < 1e-6 * n * n) continue;
      const slope = (n * S[o + 4] - S[o + 1] * S[o + 3]) / det;
      const e0 = (S[o + 3] - slope * S[o + 1]) / n;
      const R0 = FF.L * Math.tan(2 * Math.asin(sin0[f]));
      out.push({ fam: f, R0, sin0: sin0[f], n, epsPerp: e0, epsPar: e0 + slope });
    }
    this.fitCache = out;
    return out;
  }

  /**
   * radius (mm) of a fitted ring at azimuth η (given sin²η) as drawn: strain × mag, linear model g' = (1 − mag·ε)g.
   * The displayed spots follow (I − mag·ε)g, whose length differs at second order (mag²|εn̂|²/2 ≲ 0.3 %, < 1 px).
   */
  fitRadius(fit: RingFit, s2: number): number {
    const e = fit.epsPerp + (fit.epsPar - fit.epsPerp) * s2;
    const st = Math.min(0.999, fit.sin0 * (1 - this.mag * e));
    return FF.L * Math.tan(2 * Math.asin(st));
  }

  // ---------------------------------------------------------------- summaries

  /** axial elastic strain ε_zz of each grain: mean, min, max */
  axialStats(): { mean: number; min: number; max: number } {
    let s = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let g = 0; g < this.ng; g++) {
      const e = this.strain[g * 9 + 8];
      s += e;
      lo = Math.min(lo, e);
      hi = Math.max(hi, e);
    }
    return { mean: s / this.ng, min: lo, max: hi };
  }

  /** fraction of the beam transmitted along the rod's diameter */
  get transmissionCentre(): number {
    return Math.exp(-this.mu * this.D);
  }

  private recKey = -1;
  private recN = 0;
  /** count of detectable far-field spots recorded so far (cached per spot list × coverage) */
  recordedSpots(): number {
    const key = this.ffVersion * 1e6 + this.covVersion;
    if (key === this.recKey) return this.recN;
    let n = 0;
    for (let i = 0; i < this.n; i++) if (this.detectable(i) && this.visited[this.spBin[i]]) n++;
    this.recKey = key;
    this.recN = n;
    return n;
  }
}
