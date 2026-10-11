/**
 * Panel 1 of the brightness station: "same photons, brighter beam".
 *
 * Side (top-down) view of one transverse plane, ANAMORPHIC and to scale on both axes: sideways positions in µm,
 * distance along the beam in m, so a ray x(z) = x₀ + θz [µm = µm + µrad·m] is a straight line. Photons are drawn
 * one by one from a Gaussian source (x₀ ~ N(0, Σ_x²), θ ~ N(0, Σ′_x²)) at a fixed emission rate (same flux). A
 * thin lens with a soft (Gaussian) aperture at 15 m images the source 1:1 onto a soft slit at 30 m
 * (physics.SLITS): a photon at x passes an aperture with probability e^{−x²/2s²}, then gets a diffraction kick
 * θ += N(0, (λ/4πs)²) and, at the lens, θ −= x/f — an exact Monte Carlo of the wave intensity for Gaussian beams
 * (see physics.ts). The pass rate shown is the analytic probability (physics.passFraction); the animation samples
 * it. Below: B = F ÷ (2πΣ_xΣ_y) ÷ (2πΣ′_xΣ′_y) with end-on pictures of the source
 * (µm) and of the angular spread (µrad), to scale, and a log brightness meter with the old-APS / APS-U values at
 * the same flux and the diffraction-limited ceiling 4F/λ².
 */
import { TOKENS, type Canvas2D } from '../kit';
import { gauss, rng } from '../../../lib/fft';
import { SLITS, afterLens, diffractionKick, slitTransmission, widthAfterLens, type AfterLens, type Beam } from './physics';
import { fmtGain, fmtOneIn, fmtSmall, fmtTiny, sci, sup } from './format';

export interface SourceState {
  /** photon beam at the source (µm, µrad) */
  ph: Beam;
  E: number;
  F: number;
  B: number;
  Baps: number;
  Bapsu: number;
  Blim: number;
  /** exact pass probability through the lens aperture and the slit */
  pass: number;
  /** short name of the current source, e.g. "APS-U" or "your source" */
  name: string;
  apsuName: string;
}

const N = 2400;
const RATE = 420; // drawn photons per second (a random sample of the real 10¹⁵ /s)
const SPEED = 21; // m/s on screen
const R_UM = 340; // half-height of the ray view in µm
const Z_MAX = 33.6; // m shown
const Z_DET = 32.4; // detector position, m
const TRAIL = 0.55; // m
const B_LO = 18;
const B_HI = 26;

const ST_FREE = 0;
const ST_FLY = 1;
const ST_PAST1 = 2;
const ST_PAST2 = 3;
const ST_STOP = 4;

interface Geo {
  W: number;
  H: number;
  rayTop: number;
  rayBot: number;
  yc: number;
  k: number; // px per µm
  xs: number; // source x
  xr: number; // right end of the ray view
  pz: number; // px per m
  fTop: number; // formula strip top
  mTop: number; // meter top
  narrow: boolean;
  T: number; // tile size
}

/**
 * Vertical layout of the panel (px): ray view from RAY_TOP, its axis, the formula strip (tiles T px + 68), the meter.
 * The ray view takes what is left. In a short canvas the tiles give way first (down to TILE_MIN), keeping the ray
 * view RAY_FULL tall; below that the ray view shrinks to RAY_MIN.
 */
const RAY_TOP = 32;
const RAY_FULL = 130;
const RAY_MIN = 112;
const TILE_MIN = 60;
const AXIS_H = 30;
const METER_H = 88;
/** everything but the ray view and the tiles */
const FIXED_H = RAY_TOP + AXIS_H + 6 + 68 + METER_H;

/** Smallest canvas height (px) at which panel 1 draws everything without overlap. */
export function sourceMinHeight(): number {
  return FIXED_H + RAY_MIN + TILE_MIN;
}

const OP_W = 18;
function fluxWidth(W: number): number {
  return W < 470 ? 72 : 92;
}
function tileSize(W: number): number {
  return Math.max(TILE_MIN, Math.min(84, (W - 28 - fluxWidth(W) - 2 * OP_W - 8) / 2 - 34));
}

export class SourceView {
  /** current straight segment of each photon: x(z) = xa + ta·(z − za)  (µm, µrad, m) */
  private xa = new Float32Array(N);
  private ta = new Float32Array(N);
  private za = new Float32Array(N);
  private z = new Float32Array(N);
  private age = new Float32Array(N);
  private st = new Uint8Array(N);
  private hitX = new Float32Array(N);
  private free = 0;
  private acc = 0;
  private flash = 0;
  private hits = 0;
  private r = rng(20231);
  private s: SourceState | null = null;
  private ctx: CanvasRenderingContext2D;
  /** rms diffraction kicks at the lens aperture and the slit [µrad] */
  private kick1 = 0;
  private kick2 = 0;
  /** photons just after the lens (for the drawn envelope) */
  private al: AfterLens | null = null;
  /** formula strip + meter only change with the state: drawn once into this layer, blitted every frame */
  private layer = document.createElement('canvas');
  private layerKey = '';
  private ver = 0;
  private jawCache: { key: string; grad: CanvasGradient[] } = { key: '', grad: [] };

  constructor(
    private c: Canvas2D,
    private accent: string,
  ) {
    this.ctx = c.ctx;
  }

  set(s: SourceState): void {
    this.s = s;
    this.ver++;
    this.al = afterLens(s.ph.sx, s.ph.sxp, s.E);
    this.kick1 = diffractionKick(s.E, SLITS.s1);
    this.kick2 = diffractionKick(s.E, SLITS.s2);
  }

  /** Fill the beamline with photons so the first frame is not empty. */
  warm(): void {
    for (let i = 0; i < 90; i++) this.step(1 / 30);
  }

  frame(dt: number): void {
    this.step(dt);
    this.draw();
  }

  private stillVer = -1;
  private stillKey = '';
  /**
   * Reduced motion: a still picture instead of frame(). For each new state the beamline is refilled from scratch
   * (same random stream, so a state always gives the same picture) and drawn once; otherwise only a resize redraws.
   */
  still(): void {
    const key = `${this.c.w}|${this.c.h}|${this.c.dpr}`;
    if (this.ver !== this.stillVer) {
      this.stillVer = this.ver;
      this.st.fill(ST_FREE);
      this.acc = 0;
      this.free = 0;
      this.r = rng(20231);
      this.warm();
      this.flash = 0;
    } else if (key === this.stillKey) return;
    this.stillKey = key;
    this.draw();
  }

  private step(dt: number): void {
    const s = this.s;
    if (!s) return;
    const { s1, s2, z1, z2 } = SLITS;
    const r = this.r;
    // emit
    this.acc += RATE * dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      const i = this.alloc();
      if (i < 0) break;
      this.xa[i] = s.ph.sx * gauss(r);
      this.ta[i] = s.ph.sxp * gauss(r);
      this.za[i] = 0;
      this.z[i] = r() * SPEED * dt; // spread births over the frame
      this.st[i] = ST_FLY;
      this.age[i] = 0;
    }
    const dz = SPEED * dt;
    for (let i = 0; i < N; i++) {
      const st = this.st[i];
      if (st === ST_FREE) continue;
      if (st === ST_STOP) {
        this.age[i] += dt;
        if (this.age[i] > 0.45) this.st[i] = ST_FREE;
        continue;
      }
      const zn = this.z[i] + dz;
      if (st === ST_FLY && zn >= z1) {
        // passes the lens aperture with probability e^{−x²/2s²}; new straight segment: diffraction kick + lens bend
        const x = this.xa[i] + this.ta[i] * (z1 - this.za[i]);
        if (r() < slitTransmission(x, s1)) {
          this.xa[i] = x;
          this.za[i] = z1;
          this.ta[i] += this.kick1 * gauss(r) - x / SLITS.f;
          this.st[i] = ST_PAST1;
        } else {
          this.stop(i, z1, x);
          continue;
        }
      }
      if (this.st[i] === ST_PAST1 && zn >= z2) {
        const x = this.xa[i] + this.ta[i] * (z2 - this.za[i]);
        if (r() < slitTransmission(x, s2)) {
          this.xa[i] = x;
          this.za[i] = z2;
          this.ta[i] += this.kick2 * gauss(r);
          this.st[i] = ST_PAST2;
        } else {
          this.stop(i, z2, x);
          continue;
        }
      }
      if (this.st[i] === ST_PAST2 && zn >= Z_DET) {
        this.st[i] = ST_FREE;
        this.hits++;
        this.flash = 1;
        continue;
      }
      this.z[i] = zn;
    }
    this.flash = Math.max(0, this.flash - dt * 3);
  }

  private stop(i: number, z: number, x: number): void {
    this.st[i] = ST_STOP;
    this.z[i] = z;
    this.hitX[i] = x;
    this.age[i] = 0;
  }

  private alloc(): number {
    for (let n = 0; n < N; n++) {
      const i = (this.free + n) % N;
      if (this.st[i] === ST_FREE) {
        this.free = (i + 1) % N;
        return i;
      }
    }
    return -1;
  }

  private layout(): Geo {
    const W = this.c.w;
    const H = this.c.h;
    const narrow = W < 470;
    const T = Math.max(TILE_MIN, Math.min(tileSize(W), H - FIXED_H - RAY_FULL));
    const formulaH = T + 68;
    const rayBot = Math.max(RAY_TOP + RAY_MIN, H - METER_H - formulaH - AXIS_H - 6);
    const rayTop = RAY_TOP;
    const yc = (rayTop + rayBot) / 2;
    const k = (rayBot - rayTop) / 2 / R_UM;
    const xs = 60;
    const xr = W - 14;
    const pz = (xr - xs) / Z_MAX;
    const fTop = rayBot + AXIS_H + 4;
    const mTop = fTop + formulaH;
    return { W, H, rayTop, rayBot, yc, k, xs, xr, pz, fTop, mTop, narrow, T };
  }

  draw(): void {
    const s = this.s;
    if (!s) return;
    const g = this.ctx;
    const G = this.layout();
    g.clearRect(0, 0, G.W, G.H);
    this.drawRays(g, G, s);
    const dpr = this.c.dpr;
    const key = `${G.W}|${G.H}|${dpr}|${this.ver}`;
    if (key !== this.layerKey) {
      this.layerKey = key;
      const L = this.layer;
      L.width = Math.round(G.W * dpr);
      L.height = Math.round(G.H * dpr);
      const lg = L.getContext('2d');
      if (lg) {
        lg.setTransform(dpr, 0, 0, dpr, 0, 0);
        lg.clearRect(0, 0, G.W, G.H);
        this.drawFormula(lg, G, s);
        this.drawMeter(lg, G, s);
      }
    }
    g.drawImage(this.layer, 0, 0, G.W, G.H);
  }

  // ------------------------------------------------------------------ ray view

  private drawRays(g: CanvasRenderingContext2D, G: Geo, s: SourceState): void {
    const { s1, s2, z1, z2 } = SLITS;
    const X = (z: number) => G.xs + z * G.pz;
    const Y = (x: number) => G.yc - x * G.k;
    // backdrop
    g.save();
    g.fillStyle = 'rgba(14,21,33,0.55)';
    g.fillRect(G.xs - 30, G.rayTop, G.xr - G.xs + 30, G.rayBot - G.rayTop);
    g.strokeStyle = TOKENS.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(G.xs - 30, G.yc + 0.5);
    g.lineTo(G.xr, G.yc + 0.5);
    g.setLineDash([2, 4]);
    g.stroke();
    g.setLineDash([]);
    g.restore();

    g.save();
    g.beginPath();
    g.rect(G.xs - 30, G.rayTop, G.xr - G.xs + 30, G.rayBot - G.rayTop);
    g.clip();

    // beam envelopes ±2σ(z): the free beam up to the lens, then the photons the lens aperture lets through
    // (converging to the image of the source at the slit when the source is small)
    const env = (z: number) => 2 * Math.sqrt(s.ph.sx * s.ph.sx + z * z * s.ph.sxp * s.ph.sxp);
    const al = this.al;
    const envT = (z: number) => (al ? 2 * widthAfterLens(al, z) : 0);
    const band = (za: number, zb: number, f: (z: number) => number, fill: string, edge: string, dash: number[]) => {
      const steps = 28;
      g.fillStyle = fill;
      g.beginPath();
      for (let i = 0; i <= steps; i++) {
        const z = za + ((zb - za) * i) / steps;
        if (i === 0) g.moveTo(X(z), Y(f(z)));
        else g.lineTo(X(z), Y(f(z)));
      }
      for (let i = steps; i >= 0; i--) {
        const z = za + ((zb - za) * i) / steps;
        g.lineTo(X(z), Y(-f(z)));
      }
      g.closePath();
      g.fill();
      g.strokeStyle = edge;
      g.lineWidth = 1;
      g.setLineDash(dash);
      for (const sgn of [1, -1]) {
        g.beginPath();
        for (let i = 0; i <= steps; i++) {
          const z = za + ((zb - za) * i) / steps;
          if (i === 0) g.moveTo(X(z), Y(sgn * f(z)));
          else g.lineTo(X(z), Y(sgn * f(z)));
        }
        g.stroke();
      }
      g.setLineDash([]);
    };
    band(0, z1, env, withAlpha(this.accent, 0.1), withAlpha(this.accent, 0.3), [4, 5]);
    if (al) band(z1, Z_MAX, envT, withAlpha(this.accent, 0.08), withAlpha(this.accent, 0.4), [4, 5]);

    // photons in flight
    const tz = TRAIL;
    g.lineCap = 'round';
    g.lineWidth = 1.6;
    g.strokeStyle = 'rgba(205,236,255,0.62)';
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const st = this.st[i];
      if (st !== ST_FLY && st !== ST_PAST1) continue;
      const zz = this.z[i];
      const za = this.za[i];
      const zb = Math.max(za, zz - tz);
      g.moveTo(X(zb), Y(this.xa[i] + this.ta[i] * (zb - za)));
      g.lineTo(X(zz), Y(this.xa[i] + this.ta[i] * (zz - za)));
    }
    g.stroke();
    // photons through the lens aperture and the slit
    g.save();
    g.strokeStyle = this.accent;
    g.lineWidth = 2.2;
    g.shadowColor = this.accent;
    g.shadowBlur = 8;
    g.beginPath();
    for (let i = 0; i < N; i++) {
      if (this.st[i] !== ST_PAST2) continue;
      const zz = this.z[i];
      const za = this.za[i];
      const zb = Math.max(za, zz - tz);
      g.moveTo(X(zb), Y(this.xa[i] + this.ta[i] * (zb - za)));
      g.lineTo(X(zz), Y(this.xa[i] + this.ta[i] * (zz - za)));
    }
    g.stroke();
    g.restore();

    // source glow (to scale vertically, ±2Σ; at least 2.5 px)
    const ry = Math.max(2.5, 2 * s.ph.sx * G.k);
    const rx = 7;
    g.save();
    g.translate(G.xs, G.yc);
    g.scale(1, ry / rx);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, this.accent);
    grad.addColorStop(1, withAlpha(this.accent, 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // impacts on the slit jaws (fading)
    g.fillStyle = 'rgba(255,190,110,0.9)';
    for (let i = 0; i < N; i++) {
      if (this.st[i] !== ST_STOP) continue;
      const y = Y(this.hitX[i]);
      if (y < G.rayTop - 2 || y > G.rayBot + 2) continue;
      g.globalAlpha = Math.max(0, 1 - this.age[i] / 0.45) * 0.85;
      g.fillRect(X(this.z[i]) - 3.5, y - 1, 2.2, 2);
    }
    g.globalAlpha = 1;

    // slits: soft-edged (Gaussian) jaws, opacity 1 − e^{−x²/2s²}
    const jaws = this.jawGradients(g, G, [s1, s2]);
    [z1, z2].forEach((z, k) => {
      g.fillStyle = jaws[k];
      g.fillRect(X(z) - 2.5, G.rayTop, 5, G.rayBot - G.rayTop);
    });
    // the lens body (biconvex symbol) across its soft aperture
    {
      const xl = X(z1);
      const h = Math.max(12, 2.6 * s1 * G.k);
      const bulge = 5;
      g.save();
      g.beginPath();
      g.moveTo(xl, G.yc - h);
      g.quadraticCurveTo(xl + 2 * bulge, G.yc, xl, G.yc + h);
      g.quadraticCurveTo(xl - 2 * bulge, G.yc, xl, G.yc - h);
      g.closePath();
      g.fillStyle = withAlpha(this.accent, 0.16);
      g.fill();
      g.strokeStyle = 'rgba(205,236,255,0.75)';
      g.lineWidth = 1.2;
      g.stroke();
      g.restore();
    }

    // detector
    const xd = X(Z_DET);
    g.save();
    g.fillStyle = '#16202e';
    g.strokeStyle = this.flash > 0 ? this.accent : 'rgba(170,190,215,0.55)';
    g.lineWidth = 1.2;
    if (this.flash > 0) {
      g.shadowColor = this.accent;
      g.shadowBlur = 14 * this.flash;
    }
    g.beginPath();
    g.roundRect(xd - 1, G.yc - 14, 9, 28, 2);
    g.fill();
    g.stroke();
    g.restore();
    g.restore(); // clip

    // labels
    const lab = (t: string, x: number, y: number, o: { color?: string; align?: CanvasTextAlign; size?: number; weight?: number; mono?: boolean } = {}) => {
      g.font = `${o.weight ?? 600} ${o.size ?? 10.5}px ${o.mono ? TOKENS.mono : TOKENS.font}`;
      g.fillStyle = o.color ?? TOKENS.ink3;
      g.textAlign = o.align ?? 'center';
      g.textBaseline = 'middle';
      g.fillText(t, x, y);
    };
    const yl = G.rayTop + 10;
    // lens: focal length and soft aperture (rms); slit: rms width — left of each, the distance right of it
    const room = X(z1) - 18;
    g.font = `600 10.5px ${TOKENS.font}`;
    const lensTxt = [`lens, focal length ${SLITS.f} m, aperture ${s1} µm`, `lens, aperture ${s1} µm`, 'lens'].find((t) => g.measureText(t).width <= room) ?? 'lens';
    lab(lensTxt, X(z1) - 6, yl, { align: 'right' });
    lab(`${z1} m`, X(z1) + 6, yl, { align: 'left', color: TOKENS.ink2 });
    lab(`slit, ${s2} µm`, X(z2) - 6, yl, { align: 'right' });
    lab(`${z2} m`, X(z2) + 6, yl, { align: 'left', color: TOKENS.ink2 });

    // source size (left) and pass rate (right) above the axis: the fullest wordings that do not collide
    const srcOpts = [`source ${fmtSmall(s.ph.sx)} µm (rms)`, `source ${fmtSmall(s.ph.sx)} µm`];
    const passOpts = [`${fmtOneIn(s.pass)} get through (${pct(s.pass)})`, `${fmtOneIn(s.pass)} get through`];
    const tw = (t: string, size: number, weight: number) => {
      g.font = `${weight} ${size}px ${TOKENS.font}`;
      return g.measureText(t).width;
    };
    const rowRoom = G.xr - 2 - (G.xs + 10) - 12;
    const [srcTxt, passTxt] =
      [
        [srcOpts[0], passOpts[0]],
        [srcOpts[1], passOpts[0]],
        [srcOpts[1], passOpts[1]],
      ].find(([a, b]) => tw(a, 10.5, 600) + tw(b, 11.5, 700) <= rowRoom) ?? [srcOpts[1], passOpts[1]];
    lab(srcTxt, G.xs + 10, G.rayBot - 10, { align: 'left', color: TOKENS.ink2, weight: 600 });
    lab(passTxt, G.xr - 2, G.rayBot - 10, { align: 'right', color: this.accent, size: 11.5, weight: 700 });

    // scale bar (200 µm, vertical)
    const sb = 200;
    const xb = 24;
    g.strokeStyle = TOKENS.ink3;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(xb, Y(sb / 2));
    g.lineTo(xb, Y(-sb / 2));
    g.moveTo(xb - 3, Y(sb / 2));
    g.lineTo(xb + 3, Y(sb / 2));
    g.moveTo(xb - 3, Y(-sb / 2));
    g.lineTo(xb + 3, Y(-sb / 2));
    g.stroke();
    g.save();
    g.translate(xb - 12, G.yc);
    g.rotate(-Math.PI / 2);
    lab(`${sb} µm`, 0, 0, { size: 10, weight: 600 });
    g.restore();

    // distance axis
    const ya = G.rayBot + 1;
    g.strokeStyle = TOKENS.axis;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(G.xs, ya + 0.5);
    g.lineTo(G.xr, ya + 0.5);
    for (const z of [0, 10, 20, 30]) {
      g.moveTo(X(z) + 0.5, ya);
      g.lineTo(X(z) + 0.5, ya + 4);
    }
    g.stroke();
    for (const z of [0, 10, 20, 30]) lab(`${z} m`, X(z), ya + 11, { size: 10, weight: 500 });
    const axTxt = G.W < 470 ? 'distance from the source (m); sideways in µm' : 'distance from the source (m); sideways positions in µm, both to scale';
    lab(axTxt, (G.xs + G.xr) / 2 + (G.narrow ? 14 : 0), ya + 24, {
      size: 10.5,
      weight: 500,
      color: TOKENS.ink3,
    });
  }

  /** Vertical gradients for the soft slit jaws (cached per layout). */
  private jawGradients(g: CanvasRenderingContext2D, G: Geo, ss: number[]): CanvasGradient[] {
    const key = `${G.rayTop}|${G.rayBot}|${G.k}|${ss.join(',')}`;
    if (this.jawCache.key === key) return this.jawCache.grad;
    const span = G.rayBot - G.rayTop;
    const us = [-4.5, -3.5, -3, -2.5, -2, -1.6, -1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2, 1.6, 2, 2.5, 3, 3.5, 4.5];
    const grads = ss.map((sw) => {
      const gr = g.createLinearGradient(0, G.rayTop, 0, G.rayBot);
      const stop = (xUm: number) => {
        const t = Math.max(0, Math.min(1, (G.yc - xUm * G.k - G.rayTop) / span));
        // jaw opacity 1 − T; a lighter rim where the edge is half-transparent (peaks at T = ½)
        const T = slitTransmission(xUm, sw);
        const op = 1 - T;
        const rim = 4 * T * op;
        const c = (d: number, l: number) => Math.round(d + (l - d) * rim);
        gr.addColorStop(t, `rgba(${c(46, 190)},${c(64, 208)},${c(88, 230)},${(0.04 + 0.96 * Math.max(op, 0.75 * rim)).toFixed(3)})`);
      };
      stop(R_UM);
      for (let i = us.length - 1; i >= 0; i--) stop(us[i] * sw);
      stop(-R_UM);
      return gr;
    });
    this.jawCache = { key, grad: grads };
    return grads;
  }

  // ------------------------------------------------------------------ formula strip

  private drawFormula(g: CanvasRenderingContext2D, G: Geo, s: SourceState): void {
    const top = G.fTop;
    const left = 14;
    const right = G.W - 14;
    // heading
    g.save();
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = `600 12px ${TOKENS.font}`;
    g.fillStyle = TOKENS.ink;
    const head = G.narrow ? 'Brightness = photons ÷ area ÷ spread' : 'Brightness = photons per second ÷ source area ÷ angular spread';
    g.fillText(head, left, top + 8);
    g.restore();

    const opW = OP_W;
    const fluxW = fluxWidth(G.W);
    const T = G.T;
    const tileTop = top + 34;
    // three blocks spread across the width
    const blocks = [fluxW, T, T];
    const total = blocks.reduce((p, v) => p + v, 0) + 2 * opW;
    const pad = Math.max(0, (right - left - total) / 4);
    let x = left + pad;
    const xsB: number[] = [];
    for (let i = 0; i < 3; i++) {
      xsB.push(x);
      x += blocks[i] + (i < 2 ? opW + pad : 0);
    }
    const cy = tileTop + T / 2;
    const txt = (t: string, x: number, y: number, o: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; mono?: boolean } = {}) => {
      g.font = `${o.weight ?? 600} ${o.size ?? 10.5}px ${o.mono ? TOKENS.mono : TOKENS.font}`;
      g.fillStyle = o.color ?? TOKENS.ink3;
      g.textAlign = o.align ?? 'center';
      g.textBaseline = 'middle';
      g.fillText(t, x, y);
    };
    // operators
    for (let i = 0; i < 2; i++) txt('÷', xsB[i] + blocks[i] + pad / 2 + opW / 2, cy, { size: 18, weight: 500, color: TOKENS.ink2 });

    // flux block
    const fx = xsB[0] + fluxW / 2;
    txt('PHOTONS / s', fx, tileTop - 10, { size: 10, weight: 700 });
    txt(sci(s.F, 1), fx, cy - 6, { size: G.narrow ? 17 : 20, weight: 700, color: TOKENS.ink });
    txt('same for all', fx, cy + 16, { size: 10, weight: 600, color: TOKENS.ink2 });
    txt('in 0.1 % bandwidth', fx, cy + 29, { size: 9.5, weight: 500, color: TOKENS.ink3 });

    // tiles
    const tile = (x0: number, title: string, value: string, unitScale: number, wx: number, wy: number, color: string, scaleTxt: string, scaleLen: number) => {
      g.save();
      g.fillStyle = '#0b111b';
      g.strokeStyle = TOKENS.grid;
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(x0, tileTop, T, T, 6);
      g.fill();
      g.stroke();
      g.beginPath();
      g.roundRect(x0, tileTop, T, T, 6);
      g.clip();
      const cx = x0 + T / 2;
      const cyy = tileTop + T / 2;
      // cross-hair
      g.strokeStyle = TOKENS.grid;
      g.beginPath();
      g.moveTo(x0, cyy + 0.5);
      g.lineTo(x0 + T, cyy + 0.5);
      g.moveTo(cx + 0.5, tileTop);
      g.lineTo(cx + 0.5, tileTop + T);
      g.stroke();
      // ellipse ±Σ (filled glow to ±2Σ)
      const rx = Math.max(1.6, wx * unitScale);
      const ry = Math.max(1.6, wy * unitScale);
      const rr = Math.max(rx, ry);
      g.translate(cx, cyy);
      g.scale(rx / rr, ry / rr);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, rr * 2);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.25, color);
      gr.addColorStop(0.5, withAlpha(color, 0.45));
      gr.addColorStop(1, withAlpha(color, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, rr * 2, 0, Math.PI * 2);
      g.fill();
      g.restore();
      // scale bar inside the tile
      const L = scaleLen * unitScale;
      g.strokeStyle = TOKENS.ink3;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x0 + 6, tileTop + T - 7.5);
      g.lineTo(x0 + 6 + L, tileTop + T - 7.5);
      g.stroke();
      txt(scaleTxt, x0 + 8 + L, tileTop + T - 8, { size: 9, weight: 600, align: 'left' });
      txt(title, x0 + T / 2, tileTop - 10, { size: 10, weight: 700 });
      txt(value, x0 + T / 2, tileTop + T + 11, { size: 10.5, weight: 600, color: TOKENS.ink, mono: true });
    };
    // source: tile spans ±320 µm; spread: ±26 µrad
    const sSrc = T / 2 / 320;
    const sDiv = T / 2 / 26;
    const area = 2 * Math.PI * s.ph.sx * s.ph.sy * 1e-6;
    const solid = 2 * Math.PI * s.ph.sxp * s.ph.syp * 1e-6;
    tile(xsB[1], 'SOURCE AREA', `${fmtTiny(area)} mm²`, sSrc, s.ph.sx, s.ph.sy, this.accent, '100 µm', 100);
    tile(xsB[2], 'ANGULAR SPREAD', `${fmtTiny(solid)} mrad²`, sDiv, s.ph.sxp, s.ph.syp, '#9fe3ff', '10 µrad', 10);
    // rms width × height of the X-ray source and of its angular spread (end-on views above)
    txt(`${fmtSmall(s.ph.sx)} × ${fmtSmall(s.ph.sy)} µm rms`, xsB[1] + T / 2, tileTop + T + 24, { size: 9.5, weight: 500 });
    txt(`${fmtSmall(s.ph.sxp)} × ${fmtSmall(s.ph.syp)} µrad rms`, xsB[2] + T / 2, tileTop + T + 24, { size: 9.5, weight: 500 });
  }

  // ------------------------------------------------------------------ brightness meter

  private drawMeter(g: CanvasRenderingContext2D, G: Geo, s: SourceState): void {
    const top = G.mTop;
    const x0 = 16;
    const x1 = G.W - 16;
    const X = (B: number) => x0 + ((Math.log10(B) - B_LO) / (B_HI - B_LO)) * (x1 - x0);
    const yBar = top + 56;
    const txt = (t: string, x: number, y: number, o: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; mono?: boolean } = {}) => {
      g.font = `${o.weight ?? 600} ${o.size ?? 10.5}px ${o.mono ? TOKENS.mono : TOKENS.font}`;
      g.fillStyle = o.color ?? TOKENS.ink3;
      g.textAlign = o.align ?? 'left';
      g.textBaseline = 'middle';
      g.fillText(t, x, y);
      return g.measureText(t).width;
    };
    // headline: value and gain
    const w1 = txt('= ', x0, top + 10, { size: 16, weight: 600, color: TOKENS.ink2 });
    const w2 = txt(sci(s.B, 2), x0 + w1, top + 10, { size: 16, weight: 700, color: this.accent });
    const gainTxt = `${fmtGain(s.B / s.Baps)} the old APS`;
    g.font = `700 12px ${TOKENS.font}`;
    const gw = g.measureText(gainTxt).width;
    const unit = G.W < 430 ? 'ph/s/mm²/mrad²/0.1%BW' : 'photons/s/mm²/mrad²/0.1%BW';
    g.font = `500 10px ${TOKENS.font}`;
    const uw = g.measureText(unit).width;
    if (x0 + w1 + w2 + 8 + uw + 12 + gw < x1) txt(unit, x0 + w1 + w2 + 6, top + 11, { size: 10, weight: 500 });
    txt(gainTxt, x1, top + 10, { size: 12, weight: 700, color: TOKENS.ink, align: 'right' });

    // bar
    g.save();
    g.fillStyle = 'rgba(150,180,220,0.14)';
    g.beginPath();
    g.roundRect(x0, yBar - 4, x1 - x0, 8, 4);
    g.fill();
    const xb = Math.max(x0 + 4, Math.min(x1, X(s.B)));
    const grad = g.createLinearGradient(x0, 0, xb, 0);
    grad.addColorStop(0, withAlpha(this.accent, 0.15));
    grad.addColorStop(1, this.accent);
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(x0, yBar - 4, xb - x0, 8, 4);
    g.fill();
    g.shadowColor = this.accent;
    g.shadowBlur = 10;
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(xb, yBar, 5, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // decade ticks
    const step = G.W < 400 ? 2 : 1;
    for (let e = B_LO; e <= B_HI; e += step) {
      const x = X(Math.pow(10, e));
      g.strokeStyle = TOKENS.axis;
      g.beginPath();
      g.moveTo(x + 0.5, yBar + 6);
      g.lineTo(x + 0.5, yBar + 9);
      g.stroke();
      txt(`10${sup(e)}`, x, yBar + 17, { size: 9.5, weight: 500, align: e === B_LO ? 'left' : e === B_HI ? 'right' : 'center' });
    }

    // reference markers above the bar (staggered on collision)
    const marks: { B: number; label: string; color: string; dashed?: boolean }[] = [
      { B: s.Baps, label: 'old APS', color: TOKENS.old },
      { B: s.Bapsu, label: s.apsuName, color: this.accent },
      { B: s.Blim, label: 'diffraction limit', color: '#ffffff', dashed: true },
    ];
    marks.sort((p, q) => p.B - q.B);
    const rowRight = [-1e9, -1e9];
    for (const m of marks) {
      const x = X(m.B);
      if (x < x0 - 1 || x > x1 + 1) continue;
      g.font = `600 10px ${TOKENS.font}`;
      const w = g.measureText(m.label).width;
      const lx = Math.min(x1 - w / 2, Math.max(x0 + w / 2, x));
      const row = lx - w / 2 >= rowRight[0] + 6 ? 0 : lx - w / 2 >= rowRight[1] + 6 ? 1 : 0;
      rowRight[row] = lx + w / 2;
      const ly = yBar - 14 - row * 12;
      g.strokeStyle = m.color;
      g.lineWidth = 1.2;
      g.setLineDash(m.dashed ? [2, 2] : []);
      g.beginPath();
      g.moveTo(x + 0.5, ly + 5);
      g.lineTo(x + 0.5, yBar + 5);
      g.stroke();
      g.setLineDash([]);
      txt(m.label, lx, ly, { size: 10, weight: 600, color: m.color, align: 'center' });
    }
  }
}

function pct(p: number): string {
  const v = p * 100;
  if (v >= 10) return `${v.toFixed(0)} %`;
  if (v >= 1) return `${v.toFixed(1)} %`;
  if (v >= 0.1) return `${v.toFixed(2)} %`;
  return `${v.toPrecision(2)} %`;
}

/** '#5cd3ff' or 'rgb(…)' + alpha → rgba() */
export function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m3 = /^#([0-9a-f]{3})$/i.exec(color.trim());
  if (m3) {
    const [r, gg, b] = m3[1].split('').map((h) => parseInt(h + h, 16));
    return `rgba(${r},${gg},${b},${a})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgb) {
    const p = rgb[1].split(',').map((t) => t.trim());
    return `rgba(${p[0]},${p[1]},${p[2]},${a})`;
  }
  return color;
}
