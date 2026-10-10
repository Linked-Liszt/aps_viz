/**
 * Detector-plane GISAXS intensity for islands on a Si substrate (DWBA, see physics.ts), on a (q_y, α_f) grid.
 *
 *   coherent:    I(q_y, α_f) = |Σ_l c_l(α_f) M̃_l(q_x(α_f), q_y)|² / Σw²
 *   incoherent:  I(q_y, α_f) = Σ_{l,l'} c_l c_l'* C_{ll'}(|q_y|) / Σw²     (ring-averaged cross spectra = ensemble)
 *
 * M̃_l = FT[w(y)·(m_l − ⟨m_l⟩)] is the windowed slice spectrum (mean removed: the q∥ = 0 part is the specular
 * reflection, drawn separately). c_l(α_f) = DWBA vertical factors incl. Fresnel coefficients of Si.
 * q_y = j·Δq with Δq = 2π/(N a) (the FFT grid). q_x = k(cos α_f − cos α_i) is tiny (≲ 1 bin of the 2.56 µm patch)
 * and is included by power-preserving interpolation between FFT rows. The real CSSI footprint (tens of µm) makes speckle
 * ≈ footprint/patch times finer along α_f than shown here — documented in the station's specialist text.
 * E[I_coherent] = I_incoherent by construction, so the two modes cross-fade consistently.
 */
import { DEG, SILICON, dwbaSliceCoeffs, fresnel, optics, waveNumber, type Fresnel } from './physics';
import { K_SLICES, H0_NM, N, PIXEL_NM, type Surface } from './surface';

export const DQ = (2 * Math.PI) / (N * PIXEL_NM); // nm⁻¹ per FFT bin
export const J_HALF = 40; // q_y = ±40 bins ≈ ±0.098 nm⁻¹
export const AF_MIN = -0.12 * DEG;
export const AF_MAX = 1.0 * DEG;
export const N_AF = 124;

export class Detector {
  readonly cols = 2 * J_HALF + 1;
  readonly rows = N_AF;
  readonly qy = new Float64Array(this.cols);
  /** α_f per row (row 0 = top = AF_MAX) */
  readonly af = new Float64Array(N_AF);
  readonly inc = new Float64Array(this.cols * N_AF);
  readonly coh = new Float64Array(this.cols * N_AF);
  private readonly cRe = new Float64Array(N_AF * K_SLICES);
  private readonly cIm = new Float64Array(N_AF * K_SLICES);
  private readonly rowValid = new Uint8Array(N_AF);
  /** temporally smoothed ring cross spectra */
  private readonly crossS: Float64Array[] = [];
  private crossInit = false;
  /** normalisation: Born (no Fresnel) incoherent intensity at the correlation peak */
  iRef = 1;
  /** correlation-peak ring index (fractional) */
  peakBin = 10;
  /** |R(α_i)|² of the specular reflection */
  specR = 1;
  alphaC = 0;
  private readonly tot = new Float64Array(N / 2 + 1);
  private readonly tmpRe = new Float64Array(K_SLICES);
  private readonly tmpIm = new Float64Array(K_SLICES);

  constructor() {
    for (let c = 0; c < this.cols; c++) this.qy[c] = (c - J_HALF) * DQ;
    for (let r = 0; r < N_AF; r++) this.af[r] = AF_MAX - ((AF_MAX - AF_MIN) * r) / (N_AF - 1);
    const pairs = (K_SLICES * (K_SLICES + 1)) / 2;
    for (let p = 0; p < pairs; p++) this.crossS.push(new Float64Array(N / 2 + 1));
  }

  /** row index for an exit angle (fractional) */
  rowOf(af: number): number {
    return ((AF_MAX - af) / (AF_MAX - AF_MIN)) * (N_AF - 1);
  }

  /** Pull in fresh ring spectra from the surface (exponential smoothing in time ≈ ensemble average). */
  updateSpectra(s: Surface, smoothing = 0.65): void {
    const K = K_SLICES;
    const nR = N / 2 + 1;
    const a = this.crossInit ? smoothing : 0;
    for (let p = 0; p < this.crossS.length; p++) {
      const src = s.cross[p];
      const dst = this.crossS[p];
      for (let r = 0; r < nR; r++) {
        // light radial smoothing [1 2 1] (ring noise)
        const v = r === 0 ? src[0] : r === nR - 1 ? src[r] : 0.25 * src[r - 1] + 0.5 * src[r] + 0.25 * src[r + 1];
        dst[r] = a * dst[r] + (1 - a) * v;
      }
    }
    // ring 0 is the mean (specular) component, removed by construction: continue the diffuse level smoothly
    for (const c of this.crossS) c[0] = c[1];
    this.crossInit = true;
    // reference: Born intensity Σ dh² C_{ll'} at its peak (excluding the lowest rings)
    const dh = H0_NM / K;
    let best = 0;
    let bestR = 3;
    const tot = this.tot;
    for (let r = 2; r < nR; r++) {
      let p = 0;
      let v = 0;
      for (let l = 0; l < K; l++)
        for (let m = l; m < K; m++) {
          v += (l === m ? 1 : 2) * this.crossS[p][r];
          p++;
        }
      tot[r] = v * dh * dh;
      if (tot[r] > best) {
        best = tot[r];
        bestR = r;
      }
    }
    // parabolic refinement of the peak position
    let pk = bestR;
    if (bestR > 2 && bestR < nR - 1) {
      const y0 = tot[bestR - 1];
      const y1 = tot[bestR];
      const y2 = tot[bestR + 1];
      const den = y0 - 2 * y1 + y2;
      if (den < 0) pk = bestR + (0.5 * (y0 - y2)) / den;
    }
    this.peakBin = pk;
    this.iRef = Math.max(best / s.winNorm, 1e-30);
  }

  /** Recompute both patterns for the given energy (keV) and incidence angle (rad). */
  compute(s: Surface, EkeV: number, alphaI: number, wantCoherent: boolean): void {
    const K = K_SLICES;
    const o = optics(SILICON, EkeV);
    this.alphaC = o.alphaC;
    const k = waveNumber(EkeV);
    const fi = fresnel(alphaI, o.delta, o.beta);
    this.specR = fi.R;
    const pi = k * Math.sin(alphaI);
    const dh = H0_NM / K;
    const { cRe, cIm, tmpRe, tmpIm } = this;
    for (let r = 0; r < N_AF; r++) {
      const af = this.af[r];
      if (af <= 0) {
        this.rowValid[r] = 0;
        continue;
      }
      this.rowValid[r] = 1;
      const ff: Fresnel = fresnel(af, o.delta, o.beta);
      dwbaSliceCoeffs(pi, k * Math.sin(af), fi, ff, K, dh, tmpRe, tmpIm);
      for (let l = 0; l < K; l++) {
        cRe[r * K + l] = tmpRe[l];
        cIm[r * K + l] = tmpIm[l];
      }
    }
    const invW = 1 / s.winNorm;
    const cols = this.cols;
    // incoherent
    for (let r = 0; r < N_AF; r++) {
      const o0 = r * cols;
      if (!this.rowValid[r]) {
        this.inc.fill(0, o0, o0 + cols);
        continue;
      }
      for (let c = 0; c < cols; c++) {
        const n = Math.abs(c - J_HALF);
        let v = 0;
        let p = 0;
        for (let l = 0; l < K; l++) {
          const ar = cRe[r * K + l];
          const ai = cIm[r * K + l];
          for (let m = l; m < K; m++) {
            const C = this.crossS[p][n];
            if (l === m) v += (ar * ar + ai * ai) * C;
            else {
              const br = cRe[r * K + m];
              const bi = cIm[r * K + m];
              v += 2 * (ar * br + ai * bi) * C;
            }
            p++;
          }
        }
        this.inc[o0 + c] = Math.max(0, v * invW);
      }
    }
    if (!wantCoherent) return;
    // coherent
    for (let r = 0; r < N_AF; r++) {
      const o0 = r * cols;
      if (!this.rowValid[r]) {
        this.coh.fill(0, o0, o0 + cols);
        continue;
      }
      // e^{+i q·r} convention ↔ FFT bin (−q): g = −q_x/Δq
      const gx = -(k * (Math.cos(this.af[r]) - Math.cos(alphaI))) / DQ;
      const kx0 = Math.floor(gx);
      // power-preserving interpolation between neighbouring (independent) speckle amplitudes:
      // weights (cos, sin)(πf/2) keep E|A|² constant, unlike linear weights which lose up to 50 %
      const fq = gx - kx0;
      const wa = Math.cos((Math.PI / 2) * fq);
      const wb = Math.sin((Math.PI / 2) * fq);
      const ka = ((kx0 % N) + N) % N;
      const kb = (ka + 1) % N;
      for (let c = 0; c < cols; c++) {
        const j = c - J_HALF;
        const ky = ((-j % N) + N) % N;
        const ia = ky * N + ka;
        const ib = ky * N + kb;
        let ar = 0;
        let ai = 0;
        for (let l = 0; l < K; l++) {
          const mr = wa * s.mRe[l][ia] + wb * s.mRe[l][ib];
          const mi = wa * s.mIm[l][ia] + wb * s.mIm[l][ib];
          const cr = cRe[r * K + l];
          const ci = cIm[r * K + l];
          ar += cr * mr - ci * mi;
          ai += cr * mi + ci * mr;
        }
        this.coh[o0 + c] = (ar * ar + ai * ai) * invW;
      }
    }
  }
}
