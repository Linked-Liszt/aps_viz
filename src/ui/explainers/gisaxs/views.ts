/**
 * Canvas renderers for the four panels of the "Skimming the surface" station.
 * All drawing is 2D canvas, CSS-pixel coordinates (kit canvas2d applies the DPR transform).
 */
import { TOKENS, label, lut, plotFrame, line } from '../kit';
import type { Canvas2D } from '../kit';
import { DEG, fieldIntensity, type Fresnel, type Optics } from './physics';
import { N, PIXEL_NM, H0_NM } from './surface';
import { AF_MAX, AF_MIN, DQ, J_HALF, type Detector } from './scatter';

export interface Derived {
  E: number;
  lambda: number;
  k: number;
  si: Optics;
  ps: Optics;
  aI: number;
  fSi: Fresnel;
  penSi: number;
  penPs: number;
  /** beam height [µm] and footprint [µm] */
  beamH: number;
  foot: number;
  /** refraction angle in Si [rad] (0 below α_c) */
  aT: number;
}

export interface ViewFlags {
  specialist: boolean;
  coherent: boolean;
  /** 0..1 cross-fade towards the coherent pattern */
  mix: number;
  accent: string;
}

// ------------------------------------------------------------------ formatting

export function fmtLen(nm: number): string {
  if (!Number.isFinite(nm)) return '∞';
  if (nm < 10) return `${nm.toFixed(1)} nm`;
  if (nm < 1000) return `${Math.round(nm)} nm`;
  if (nm < 1e4) return `${(nm / 1000).toFixed(2)} µm`;
  if (nm < 1e6) return `${Math.round(nm / 1000)} µm`;
  return `${(nm / 1e6).toFixed(nm < 1e7 ? 2 : 1)} mm`;
}

/** reflectivity (0..1) as a percentage with sensible precision: 98%, 3.9%, 0.24%, 0.003% */
export function fmtPct(R: number): string {
  const p = R * 100;
  if (p >= 99.5 && p < 100) return `${Math.min(99.9, +p.toFixed(1))}%`; // never round a not-quite-total reflection up to 100 %
  if (p >= 9.95) return `${p.toFixed(0)}%`;
  if (p >= 0.995) return `${p.toFixed(1)}%`;
  if (p >= 0.01) return `${p.toFixed(2)}%`;
  return p > 0 ? `${p.toPrecision(1)}%` : '0%';
}

export function fmtDeg(rad: number, digits = 3): string {
  return `${(rad / DEG).toFixed(digits)}°`;
}

function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface TextOpts {
  color?: string;
  size?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  weight?: number;
  mono?: boolean;
  halo?: boolean;
}

/** split "α_{i} = 3·10^{-6}" into runs: 0 normal, 1 subscript, 2 superscript */
function runs(text: string): [string, number][] {
  const out: [string, number][] = [];
  const re = /([_^])\{([^}]*)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push([text.slice(last, m.index), 0]);
    out.push([m[2], m[1] === '_' ? 1 : 2]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push([text.slice(last), 0]);
  return out;
}

/** Canvas text with _{sub} / ^{sup} markup and (by default) a dark halo so it stays legible over images. */
export function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextOpts = {}): number {
  const size = o.size ?? 11;
  const fam = o.mono ? TOKENS.mono : TOKENS.font;
  const wt = o.weight ?? 600;
  const parts = runs(text);
  const fontFor = (k: number) => `${wt} ${k ? size * 0.74 : size}px ${fam}`;
  ctx.save();
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  ctx.textAlign = 'left';
  let total = 0;
  for (const [t, k] of parts) {
    ctx.font = fontFor(k);
    total += ctx.measureText(t).width;
  }
  const al = o.align ?? 'left';
  let cx = al === 'center' ? x - total / 2 : al === 'right' || al === 'end' ? x - total : x;
  ctx.lineJoin = 'round';
  for (const [t, k] of parts) {
    ctx.font = fontFor(k);
    const dy = k === 1 ? size * 0.28 : k === 2 ? -size * 0.38 : 0;
    if (o.halo !== false) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(5,8,14,0.85)';
      ctx.strokeText(t, cx, y + dy);
    }
    ctx.fillStyle = o.color ?? TOKENS.ink;
    ctx.fillText(t, cx, y + dy);
    cx += ctx.measureText(t).width;
  }
  ctx.restore();
  return total;
}

/** cheap glow: two translucent wide strokes under the core stroke (no shadowBlur, which is slow on CPU canvases) */
function glowStroke(ctx: CanvasRenderingContext2D, color: string, width: number, alpha: number, path: () => void): void {
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha * 0.12;
  ctx.lineWidth = width + 12;
  path();
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.25;
  ctx.lineWidth = width + 5;
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ 1 · side view

export interface SideGeom {
  ys: number;
  xc: number;
  xd: number;
  V: number;
}

/**
 * Schematic side view: incident beam at α_i (angles exaggerated ×V), footprint, specular reflection (∝|R|²),
 * refracted beam or evanescent wave, scattered fan to an edge-on detector carrying the α_f intensity profile.
 * prof[r] = normalised (0..1, log) intensity at the correlation peak for detector row r.
 */
export function drawSide(c: Canvas2D, d: Derived, f: ViewFlags, prof: Float64Array, det: Detector, row: Float64Array, t: number): SideGeom {
  const { ctx, w, h } = c;
  ctx.clearRect(0, 0, w, h);
  const narrow = w < 420;
  const ys = Math.round(h * (narrow ? 0.66 : 0.64));
  const xc = Math.round(w * (narrow ? 0.34 : 0.33));
  const xd = w - (narrow ? 22 : 30);
  const aDispMax = 0.85 * DEG;
  const V = (ys - 26) / (xd - xc) / Math.tan(aDispMax);
  const Y = (a: number, dx: number) => dx * V * Math.tan(a);
  const accent = f.accent;
  const aC = d.si.alphaC;

  // --- substrate (wafer ends a little after the footprint; scattered rays then fly to the detector)
  const xw = xc + (xd - xc) * 0.42;
  const g = ctx.createLinearGradient(0, ys, 0, h);
  g.addColorStop(0, '#1d2a3d');
  g.addColorStop(1, '#0a1019');
  ctx.fillStyle = g;
  ctx.fillRect(0, ys, xw, h - ys);
  ctx.strokeStyle = 'rgba(190,210,235,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, ys + 0.5);
  ctx.lineTo(xw, ys + 0.5);
  ctx.lineTo(xw, h);
  ctx.stroke();
  // horizon continuation to the detector
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(190,210,235,0.22)';
  ctx.beginPath();
  ctx.moveTo(xw, ys + 0.5);
  ctx.lineTo(xd, ys + 0.5);
  ctx.stroke();
  ctx.restore();

  // --- islands (decorative cross-section from the live map, heights exaggerated)
  ctx.save();
  ctx.fillStyle = rgba(accent, 0.9);
  ctx.beginPath();
  ctx.moveTo(0, ys);
  const sx = narrow ? 1.1 : 1.4; // px per map pixel
  const hz = narrow ? 0.22 : 0.28; // px per nm
  for (let x = 0; x <= xw; x += 1) {
    const ix = Math.floor(x / sx) % N;
    ctx.lineTo(x, ys - row[ix] * hz);
  }
  ctx.lineTo(xw, ys);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // --- incident beam (clipped to above the surface → its intersection is the footprint)
  const tb = f.coherent ? 7 : 13;
  const th = Math.atan(V * Math.tan(d.aI));
  const x0 = -10;
  const y0 = ys - Y(d.aI, xc - x0);
  const xr = xd;
  const yr = ys - Y(d.aI, xr - xc);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, ys);
  ctx.clip();
  // reflected beam (∝ |R|²)
  const reflA = 0.12 + 0.88 * Math.pow(d.fSi.R, 0.45);
  glowStroke(ctx, TOKENS.xray, tb, reflA, () => {
    ctx.beginPath();
    ctx.moveTo(xc, ys);
    ctx.lineTo(xr, yr);
  });
  // incoming
  glowStroke(ctx, TOKENS.xray, tb, 1, () => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(xc + (4 * tb) / Math.max(Math.tan(th), 0.02), ys + 4 * tb);
  });
  // travelling wave-packets
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(1.5, tb * 0.35);
  ctx.setLineDash([5, 22]);
  ctx.lineDashOffset = -t * 70;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(xc, ys);
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = reflA;
  ctx.beginPath();
  ctx.moveTo(xc, ys);
  ctx.lineTo(xr, yr);
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // --- footprint highlight
  const fpLen = tb / Math.max(Math.sin(th), 1e-4);
  const fpL = xc - fpLen / 2;
  const fpR = xc + fpLen / 2;
  glowStroke(ctx, '#ffffff', 2, 1, () => {
    ctx.beginPath();
    ctx.moveTo(Math.max(0, fpL), ys + 1);
    ctx.lineTo(Math.min(xw, fpR), ys + 1);
  });

  // --- below the surface: evanescent wave or refracted beam
  const belowC = d.aI < aC;
  if (belowC) {
    const a = Math.min(1, d.fSi.T2 / 3);
    const gg = ctx.createLinearGradient(0, ys, 0, ys + 7);
    gg.addColorStop(0, rgba(TOKENS.xray, 0.85 * a));
    gg.addColorStop(1, rgba(TOKENS.xray, 0));
    ctx.fillStyle = gg;
    ctx.fillRect(Math.max(0, fpL - 6), ys + 1, Math.min(xw, fpR + 30) - Math.max(0, fpL - 6), 7);
  } else {
    const tt = Math.atan(V * Math.tan(d.aT));
    const len = Math.min(Math.min(h - ys - 4, 70) / Math.max(Math.sin(tt), 0.05), (xw - xc) * 0.75);
    const x2 = xc + len * Math.cos(tt);
    const y2 = ys + len * Math.sin(tt);
    const gg = ctx.createLinearGradient(xc, ys, x2, y2);
    const a = Math.min(1, 0.25 + d.fSi.T2 / 3);
    gg.addColorStop(0, rgba(TOKENS.xray, 0.75 * a));
    gg.addColorStop(1, rgba(TOKENS.xray, 0));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, ys + 1, xw, h - ys);
    ctx.clip();
    ctx.strokeStyle = gg;
    ctx.lineWidth = tb * 0.6;
    ctx.beginPath();
    ctx.moveTo(xc, ys);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  // --- scattered fan to detector
  const nRays = narrow ? 11 : 15;
  const yDet = (a: number) => ys - Y(a, xd - xc);
  for (let i = 0; i < nRays; i++) {
    const a = (0.02 + (i / (nRays - 1)) * 0.8) * DEG;
    const r = Math.round(det.rowOf(a));
    const p = prof[Math.max(0, Math.min(prof.length - 1, r))] || 0;
    ctx.strokeStyle = `rgba(200,235,255,${(0.05 + 0.4 * p).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xc, ys - 1);
    ctx.lineTo(xd, yDet(a));
    ctx.stroke();
  }
  // Yoneda ray
  if (aC < aDispMax) {
    ctx.save();
    ctx.strokeStyle = rgba(accent, 0.85);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(xc, ys - 1);
    ctx.lineTo(xd, yDet(aC));
    ctx.stroke();
    ctx.restore();
  }

  // --- detector (edge-on) with α_f profile
  const yTop = yDet(aDispMax);
  const yBot = ys + 10;
  ctx.fillStyle = '#121b29';
  ctx.strokeStyle = 'rgba(190,210,235,0.5)';
  ctx.lineWidth = 1;
  roundRect(ctx, xd, yTop - 4, 7, yBot - yTop + 8, 2);
  ctx.fill();
  ctx.stroke();
  const pw = Math.min(70, (xd - xw) * 0.55);
  ctx.save();
  ctx.beginPath();
  let started = false;
  for (let r = 0; r < prof.length; r++) {
    const a = det.af[r];
    if (a <= 0 || a > aDispMax) continue;
    const y = yDet(a);
    const x = xd - 2 - prof[r] * pw;
    if (!started) {
      ctx.moveTo(xd - 2, y);
      started = true;
    }
    ctx.lineTo(x, y);
  }
  ctx.lineTo(xd - 2, ys);
  ctx.closePath();
  const pg = ctx.createLinearGradient(xd - pw, 0, xd, 0);
  pg.addColorStop(0, rgba(accent, 0.05));
  pg.addColorStop(1, rgba(accent, 0.45));
  ctx.fillStyle = pg;
  ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.95);
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.restore();
  // specular spot on the detector
  if (d.aI <= aDispMax) {
    const rr = 3 + 2 * reflA;
    const gl = ctx.createRadialGradient(xd + 3.5, yr, 0, xd + 3.5, yr, rr * 3);
    gl.addColorStop(0, `rgba(255,255,255,${(0.35 + 0.65 * reflA).toFixed(3)})`);
    gl.addColorStop(0.33, `rgba(200,240,255,${(0.3 * reflA + 0.1).toFixed(3)})`);
    gl.addColorStop(1, 'rgba(92,211,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(xd + 3.5 - rr * 3, yr - rr * 3, rr * 6, rr * 6);
  }

  // --- angle arc and labels
  ctx.save();
  ctx.strokeStyle = 'rgba(233,238,245,0.7)';
  ctx.lineWidth = 1;
  const rArc = narrow ? 34 : 46;
  ctx.beginPath();
  ctx.arc(xc, ys, rArc, Math.PI, Math.PI + th, false);
  ctx.stroke();
  ctx.restore();
  const lblSize = narrow ? 10.5 : 11.5;
  // angle label: just above the incoming beam where it meets the arc (the beam rises to the left, so clear it at the
  // label's left end); the "X-ray beam" tag further left is lifted if the two would touch
  const angTxt = f.specialist ? `α_{i} = ${fmtDeg(d.aI, 2)}` : `angle ${fmtDeg(d.aI, 2)}`;
  ctx.font = `600 ${lblSize}px ${TOKENS.font}`;
  const angW = ctx.measureText(angTxt).width;
  const angR = xc - rArc - 2;
  const angY = Math.max(30, ys - Math.tan(th) * (xc - (angR - angW)) - tb / 2 - 6);
  haloText(ctx, angTxt, angR, angY, { align: 'right', size: lblSize, color: TOKENS.ink });

  // labels: beam, reflected, detector, Yoneda, wafer
  ctx.font = `600 ${lblSize}px ${TOKENS.font}`;
  const beamW = ctx.measureText('X-ray beam').width;
  let beamY = Math.max(30, y0 - tb - 4);
  if (8 + beamW > angR - angW - 6 && Math.abs(beamY - angY) < lblSize + 3) beamY = Math.max(30, angY - lblSize - 4);
  haloText(ctx, 'X-ray beam', 8, beamY, { size: lblSize, color: TOKENS.xray });
  {
    const lx = xc + (xr - xc) * 0.4;
    const ly = ys - Y(d.aI, lx - xc) - tb / 2 - 7;
    haloText(ctx, f.specialist ? `specular |R|^{2} = ${fmtPct(d.fSi.R)}` : `reflected ${fmtPct(d.fSi.R)}`, lx, Math.max(30, ly), { size: lblSize - 0.5, color: rgba(TOKENS.xray, 0.6 + 0.4 * reflA), align: 'center' });
  }
  haloText(ctx, 'detector', xd + 7, yBot + 16, { size: lblSize - 0.5, align: 'right', color: TOKENS.ink2 });
  if (aC < aDispMax && w >= 520) {
    const rY = Math.round(det.rowOf(aC));
    const pk = prof[Math.max(0, Math.min(prof.length - 1, rY))] || 0;
    // below the Yoneda ray unless the specular beam runs there (α_i < α_c) — then above it
    const yY = d.aI < aC ? yDet(aC) - 6 : yDet(aC) + 14;
    haloText(ctx, f.specialist ? 'Yoneda (α_{f} = α_{c})' : 'Yoneda glow', xd - 4 - pk * pw - 4, yY, { size: lblSize - 0.5, align: 'right', color: accent });
  }
  haloText(ctx, f.specialist ? 'Si wafer + polymer islands' : 'silicon wafer with polymer islands', 8, h - 8, { size: lblSize - 0.5, color: TOKENS.ink3, weight: 500 });

  // footprint dimension (below surface)
  {
    const yy = ys + (belowC ? 18 : 14);
    const l = Math.max(4, fpL);
    const r = Math.min(xw - 2, fpR);
    ctx.save();
    ctx.strokeStyle = 'rgba(233,238,245,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(l, yy);
    ctx.lineTo(r, yy);
    ctx.moveTo(l, yy - 4);
    ctx.lineTo(l, yy + 4);
    ctx.moveTo(r, yy - 4);
    ctx.lineTo(r, yy + 4);
    ctx.stroke();
    ctx.restore();
    const txt = `${f.specialist ? 'footprint' : 'beam spreads over'} ${fmtLen(d.foot * 1000)}`;
    haloText(ctx, txt, Math.min(Math.max((l + r) / 2, 70), xw - 60), yy + 15, { size: lblSize, align: 'center', color: TOKENS.ink });
    if (belowC) {
      const evTxt = f.specialist ? `evanescent, Λ = ${fmtLen(d.penSi)}` : `skims the top ${fmtLen(d.penSi)}`;
      ctx.font = `600 ${lblSize - 1}px ${TOKENS.font}`;
      const evW = ctx.measureText(evTxt).width;
      const fitsRight = fpR + 34 + evW <= xw - 4;
      haloText(ctx, evTxt, fitsRight ? fpR + 34 : xw - 4, ys + 6, { size: lblSize - 1, color: TOKENS.xray, align: fitsRight ? 'left' : 'right', baseline: 'middle' });
    }
  }
  // exaggeration note
  label(ctx, `angles ×${Math.round(V)} · not to scale`, w - 8, 14, { align: 'right', size: 10, color: TOKENS.ink3 });
  return { ys, xc, xd, V };
}

// ------------------------------------------------------------------ 2 · detector

export interface DetLayout {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cutX0: number;
  cutX1: number;
  cutY0: number;
  cutY1: number;
}

export function detLayout(w: number, h: number): DetLayout {
  const narrow = w < 400;
  const x0 = narrow ? 44 : 48;
  const cutW = Math.max(52, Math.min(90, w * 0.19));
  const cutH = Math.max(46, Math.min(90, h * 0.17));
  const x1 = w - cutW - 12;
  const y0 = 44;
  const y1 = h - cutH - 40;
  return { x0, x1, y0, y1, cutX0: x1 + 6, cutX1: w - 8, cutY0: y1 + 34, cutY1: h - 6 };
}

export const LOG_LO = -4.0;
export const LOG_HI = 1.25;

/** Map a normalised pattern (I/I_ref) into an RGBA image using inferno on a log scale. */
export function paintDetector(img: ImageData, det: Detector, values: Float64Array): void {
  const L = lut('inferno');
  const { cols, rows } = det;
  const d = img.data;
  for (let r = 0; r < rows; r++) {
    const shadow = det.af[r] <= 0;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const o = i * 4;
      if (shadow) {
        d[o] = 9;
        d[o + 1] = 12;
        d[o + 2] = 18;
        d[o + 3] = 255;
        continue;
      }
      const v = values[i];
      let x = v > 0 ? (Math.log10(v) - LOG_LO) / (LOG_HI - LOG_LO) : 0;
      x = x < 0 ? 0 : x > 1 ? 1 : x;
      const k = Math.round(x * 255) * 3;
      d[o] = L[k];
      d[o + 1] = L[k + 1];
      d[o + 2] = L[k + 2];
      d[o + 3] = 255;
    }
  }
}

export interface DetDraw {
  image: HTMLCanvasElement;
  cutH: Float64Array; // I/I_ref along q_y at the Yoneda row
  cutHAvg: Float64Array;
  cutV: Float64Array; // I/I_ref along α_f at q*
  cutVAvg: Float64Array;
  hover: { qy: number; af: number } | null;
  showBeamstop: boolean;
  photons: number | null;
}

export function drawDetector(c: Canvas2D, d: Derived, f: ViewFlags, det: Detector, dd: DetDraw): DetLayout {
  const { ctx, w, h } = c;
  ctx.clearRect(0, 0, w, h);
  const L = detLayout(w, h);
  const { x0, x1, y0, y1 } = L;
  const iw = x1 - x0;
  const ih = y1 - y0;
  const accent = f.accent;
  // image
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(dd.image, x0, y0, iw, ih);
  ctx.restore();
  ctx.strokeStyle = 'rgba(190,210,235,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, iw - 1, ih - 1);
  const qMax = J_HALF * DQ;
  const px = (q: number) => x0 + ((q + qMax + DQ / 2) / (2 * qMax + DQ)) * iw;
  const py = (a: number) => y0 + ((AF_MAX - a) / (AF_MAX - AF_MIN)) * ih;
  const small = w < 400 ? 10 : 10.5;

  // horizon & shadow
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(233,238,245,0.45)';
  ctx.beginPath();
  ctx.moveTo(x0, py(0));
  ctx.lineTo(x1, py(0));
  ctx.stroke();
  ctx.restore();

  // Yoneda line
  const aC = d.si.alphaC;
  if (aC < AF_MAX) {
    ctx.save();
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = rgba(accent, 0.75);
    ctx.beginPath();
    ctx.moveTo(x0, py(aC));
    ctx.lineTo(x1, py(aC));
    ctx.stroke();
    ctx.restore();
    haloText(ctx, f.specialist ? 'Yoneda α_{c}' : 'Yoneda band', x0 + 6, py(aC) - 5, { size: small, color: accent });
  }
  // specular: beamstop (ordinary GISAXS) or bright spot (CSSI: no beamstop)
  if (d.aI < AF_MAX) {
    const sx = px(0);
    const sy = py(d.aI);
    const R = det.specR;
    if (dd.showBeamstop) {
      ctx.save();
      ctx.fillStyle = '#2a3446';
      ctx.strokeStyle = 'rgba(233,238,245,0.6)';
      roundRect(ctx, sx - 5, sy - 6, 10, 12, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(sx - 1.5, sy + 6, 3, y1 - sy - 6);
      ctx.restore();
      haloText(ctx, f.specialist ? 'beamstop (specular)' : 'beamstop', sx + 9, sy + 4, { size: small, color: TOKENS.ink2 });
    } else {
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#fff7c2';
      ctx.shadowBlur = 6 + 14 * Math.pow(R, 0.3);
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2 + 2.5 * Math.pow(R, 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      haloText(ctx, f.specialist ? `specular |R|^{2} = ${(R * 100).toPrecision(2)}%` : 'mirror reflection', sx + 9, sy + 4, { size: small, color: '#fff7c2' });
    }
  }
  // horizon / shadow label: drawn after the beamstop so its halo stays legible across the beamstop stem
  haloText(ctx, f.specialist ? 'horizon α_{f} = 0 · sample shadow' : 'surface level · sample shadow below', x0 + 6, (py(0) + y1) / 2 + 4, { size: small, color: TOKENS.ink2, weight: 500 });
  // q* markers
  const qs = det.peakBin * DQ;
  if (qs < qMax) {
    for (const sgn of [-1, 1]) {
      const x = px(sgn * qs);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(x, y0 - 2);
      ctx.lineTo(x - 4, y0 - 9);
      ctx.lineTo(x + 4, y0 - 9);
      ctx.closePath();
      ctx.fill();
    }
    haloText(ctx, f.specialist ? `±q* = 2π/L = ${qs.toFixed(3)} nm^{−1}` : '← island spacing peaks →', px(0), y0 - 11, { size: small, align: 'center', color: accent });
  }

  // axes
  ctx.save();
  ctx.font = `10.5px ${TOKENS.font}`;
  ctx.fillStyle = TOKENS.ink3;
  ctx.strokeStyle = TOKENS.axis;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const a of [0, 0.25, 0.5, 0.75, 1.0]) {
    const y = py(a * DEG);
    ctx.beginPath();
    ctx.moveTo(x0 - 4, y);
    ctx.lineTo(x0, y);
    ctx.stroke();
    ctx.fillText(a === 0 ? '0' : a.toString(), x0 - 6, y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const qt = w < 400 ? [-0.08, 0, 0.08] : [-0.08, -0.04, 0, 0.04, 0.08];
  for (const q of qt) {
    const x = px(q);
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y1 + 4);
    ctx.stroke();
    ctx.fillText(q === 0 ? '0' : q.toFixed(2), x, y1 + 6);
  }
  ctx.restore();
  haloText(ctx, f.specialist ? 'q_{y} (nm^{−1}) — across the beam' : 'sideways angle → q_{y} (nm^{−1})', (x0 + x1) / 2, y1 + 30, { size: 11, align: 'center', color: TOKENS.ink2, weight: 500, halo: false });
  ctx.save();
  ctx.translate(9, (y0 + y1) / 2);
  ctx.rotate(-Math.PI / 2);
  haloText(ctx, f.specialist ? 'exit angle α_{f} (°)' : 'upward angle (°)', 0, 4, { size: 11, align: 'center', color: TOKENS.ink2, weight: 500, halo: false });
  ctx.restore();

  // vertical cut (I vs α_f at q*), log x
  const { cutX0, cutX1, cutY0, cutY1 } = L;
  const vx = (v: number) => cutX0 + (Math.max(0, Math.min(1, (Math.log10(Math.max(v, 1e-9)) - LOG_LO) / (LOG_HI - LOG_LO)))) * (cutX1 - cutX0);
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  ctx.fillRect(cutX0, y0, cutX1 - cutX0, ih);
  ctx.beginPath();
  ctx.rect(cutX0, y0, cutX1 - cutX0, ih);
  ctx.clip();
  const drawV = (arr: Float64Array, color: string, lw: number, dash: number[]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let st = false;
    for (let r = 0; r < det.rows; r++) {
      if (det.af[r] <= 0) continue;
      const x = vx(arr[r]);
      const y = py(det.af[r]);
      if (!st) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      st = true;
    }
    ctx.stroke();
  };
  if (f.mix > 0.02) drawV(dd.cutVAvg, 'rgba(233,238,245,0.45)', 1, [3, 3]);
  drawV(dd.cutV, accent, 1.4, []);
  ctx.restore();
  label(ctx, f.specialist ? 'cut at q*' : 'at the peaks', (cutX0 + cutX1) / 2, y0 - 6, { align: 'center', size: 10, color: TOKENS.ink3 });
  // q_z ticks for specialists (right edge of the cut panel)
  if (f.specialist) {
    const k = d.k;
    ctx.save();
    ctx.font = `9.5px ${TOKENS.font}`;
    ctx.fillStyle = TOKENS.ink3;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const qLo = k * Math.sin(d.aI);
    const qHi = k * (Math.sin(d.aI) + Math.sin(AF_MAX));
    const raw = (qHi - qLo) / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const stp = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? raw;
    for (let qz = Math.ceil(qLo / stp) * stp; qz < qHi; qz += stp) {
      const s = qz / k - Math.sin(d.aI);
      if (s <= 0.03 * Math.sin(AF_MAX) || s >= 0.97 * Math.sin(AF_MAX)) continue;
      const y = py(Math.asin(s));
      ctx.fillText(`${+qz.toPrecision(3)}`, cutX1 - 1, y);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.restore();
    ctx.save();
    haloText(ctx, 'q_{z} nm^{−1}', cutX1, y1 + 13, { size: 9.5, align: 'right', color: TOKENS.ink3, weight: 500, halo: false });
    ctx.restore();
  }

  // horizontal cut (I vs q_y at the Yoneda row), log y
  const hy = (v: number) => cutY1 - Math.max(0, Math.min(1, (Math.log10(Math.max(v, 1e-9)) - LOG_LO) / (LOG_HI - LOG_LO))) * (cutY1 - cutY0);
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  ctx.fillRect(x0, cutY0, iw, cutY1 - cutY0);
  ctx.beginPath();
  ctx.rect(x0, cutY0, iw, cutY1 - cutY0);
  ctx.clip();
  const drawH = (arr: Float64Array, color: string, lw: number, dash: number[]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.setLineDash(dash);
    ctx.beginPath();
    for (let cI = 0; cI < det.cols; cI++) {
      const x = px((cI - J_HALF) * DQ);
      const y = hy(arr[cI]);
      if (cI === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  if (f.mix > 0.02) drawH(dd.cutHAvg, 'rgba(233,238,245,0.45)', 1, [3, 3]);
  drawH(dd.cutH, accent, 1.4, []);
  ctx.restore();
  label(ctx, f.specialist ? 'cut along the Yoneda band (log)' : 'brightness along the Yoneda band', x0 + 4, cutY0 + 11, { size: 10, color: TOKENS.ink3 });

  // photons readout
  if (dd.photons !== null) {
    const txt = `${fmtCount(dd.photons)} photons in this 1 s frame`;
    haloText(ctx, txt, x1 - 6, y0 + 14, { size: small, align: 'right', color: TOKENS.ink });
  }

  // hover crosshair
  if (dd.hover) {
    const { qy, af } = dd.hover;
    const x = px(qy);
    const y = py(af);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.restore();
    const qz = d.k * (Math.sin(d.aI) + Math.sin(Math.max(af, 0)));
    const lines = f.specialist
      ? [`q_{y} ${qy.toFixed(3)} nm^{−1} ↔ 2π/q_{y} = ${Math.abs(qy) > 1e-4 ? fmtLen((2 * Math.PI) / Math.abs(qy)) : '∞'}`, `α_{f} ${fmtDeg(af, 3)}   q_{z} ${qz.toFixed(3)} nm^{−1}`]
      : [`sideways: ${Math.abs(qy) > 1e-4 ? fmtLen((2 * Math.PI) / Math.abs(qy)) : '—'} repeat`, `upward ${fmtDeg(af, 2)}`];
    const bx = x > (x0 + x1) / 2 ? x - 8 : x + 8;
    const al: CanvasTextAlign = x > (x0 + x1) / 2 ? 'right' : 'left';
    const by = y < y0 + 40 ? y + 16 : y - 18;
    haloText(ctx, lines[0], bx, by, { size: small, align: al, mono: true, weight: 500 });
    haloText(ctx, lines[1], bx, by + 13, { size: small, align: al, mono: true, weight: 500 });
  }
  return L;
}

export function fmtCount(n: number): string {
  if (n < 1000) return `${Math.round(n)}`;
  const e = Math.floor(Math.log10(n));
  const m = n / Math.pow(10, e);
  return `${m.toFixed(1)}×10${sup(e)}`;
}

function sup(n: number): string {
  const m: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  return String(n)
    .split('')
    .map((ch) => m[ch] ?? ch)
    .join('');
}

// ------------------------------------------------------------------ 3 · into the surface

export interface DepthLayout {
  plot: { x0: number; x1: number; y0: number; y1: number; px(a: number): number };
}

/**
 * Top: nanoscale cross-section — standing wave above the surface (|1 + r e^{2ipz}|²), transmitted/evanescent
 * intensity |t|² e^{−z/Λ} below, islands drawn at true lateral/vertical ratio ×~3.
 * Bottom: 1/e penetration depth vs α_i (log) for Si and polystyrene.
 */
export function drawDepth(c: Canvas2D, d: Derived, f: ViewFlags, row: Float64Array, curves: { a: Float64Array; si: Float64Array; ps: Float64Array }): DepthLayout {
  const { ctx, w, h } = c;
  ctx.clearRect(0, 0, w, h);
  const narrow = w < 300;
  const compact = w < 400;
  const top = 24;
  const csH = Math.round(Math.max(80, Math.min(150, h * 0.4)));
  const zTop = 40;
  const zBot = -32;
  const zy = (z: number) => top + ((zTop - z) / (zTop - zBot)) * csH;
  const ice = lut('ice');
  // field rows
  for (let y = top; y < top + csH; y++) {
    const z = zTop - ((y - top + 0.5) / csH) * (zTop - zBot);
    const I = fieldIntensity(z, d.aI, d.k, d.fSi, d.penSi);
    const v = Math.max(0, Math.min(1, Math.pow(I / 4, 0.75)));
    const k = Math.round(v * 255) * 3;
    ctx.fillStyle = `rgb(${ice[k]},${ice[k + 1]},${ice[k + 2]})`;
    ctx.fillRect(0, y, w, 1);
  }
  // substrate tint + surface line
  const yS = zy(0);
  ctx.fillStyle = 'rgba(30,45,66,0.45)';
  ctx.fillRect(0, yS, w, top + csH - yS);
  ctx.strokeStyle = 'rgba(233,238,245,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, yS + 0.5);
  ctx.lineTo(w, yS + 0.5);
  ctx.stroke();
  // islands (true aspect ×~3): show ~ (w / pxPerNm) nm of the beam-centre row
  const pxPerNmZ = csH / (zTop - zBot);
  const exag = 3;
  const pxPerNmX = pxPerNmZ / exag;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, yS);
  for (let x = 0; x <= w; x++) {
    const nm = x / pxPerNmX;
    const ixF = nm / PIXEL_NM;
    const i0 = Math.floor(ixF) % N;
    const i1 = (i0 + 1) % N;
    const fr = ixF - Math.floor(ixF);
    const hh = row[i0] * (1 - fr) + row[i1] * fr;
    ctx.lineTo(x, zy(hh));
  }
  ctx.lineTo(w, yS);
  ctx.closePath();
  ctx.fillStyle = rgba(f.accent, 0.28);
  ctx.fill();
  ctx.strokeStyle = rgba(f.accent, 0.95);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  // depth marker
  const sm = narrow ? 9.5 : 10.5;
  if (d.penSi < -zBot - 2) {
    const y = zy(-d.penSi);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.restore();
    haloText(ctx, `${f.specialist ? '1/e depth Λ' : 'X-rays fade by here'} = ${fmtLen(d.penSi)}`, w - 6, y + 12, { size: sm, align: 'right' });
  } else {
    haloText(ctx, `↓ ${f.specialist ? 'Λ' : 'reaches'} ${fmtLen(d.penSi)} ${f.specialist ? 'into Si' : 'deep'}`, w - 6, top + csH - 6, { size: sm, align: 'right' });
  }
  // standing-wave period (above surface)
  const period = d.lambda / (2 * Math.sin(d.aI));
  if (f.specialist) haloText(ctx, compact ? `standing wave ${fmtLen(period)}` : `standing wave, period λ/2sin α_{i} = ${fmtLen(period)}`, 6, top + 12, { size: sm, color: TOKENS.ink });
  else haloText(ctx, compact ? 'waves interfere' : 'incoming + reflected waves interfere', 6, top + 12, { size: sm, color: TOKENS.ink });
  haloText(ctx, 'Si', 6, top + csH - 6, { size: sm, color: TOKENS.ink2 });
  // scale bars
  {
    const len100 = 100 * pxPerNmX;
    const bx = w - 22 - len100;
    const by = top + 22;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + len100, by);
    ctx.strokeStyle = 'rgba(5,8,14,0.8)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    haloText(ctx, '100 nm', bx + len100 / 2, by - 4, { size: 9.5, align: 'center', color: TOKENS.ink2 });
    const l20 = 20 * pxPerNmZ;
    ctx.beginPath();
    ctx.moveTo(w - 8, yS - 1);
    ctx.lineTo(w - 8, yS - 1 - l20);
    ctx.strokeStyle = 'rgba(5,8,14,0.8)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    haloText(ctx, '20 nm', w - 11, yS - 2 - l20 / 2, { size: 9.5, align: 'right', baseline: 'middle', color: TOKENS.ink2 });
  }

  // --- penetration plot
  const py0 = top + csH + 6;
  const rect = { x: 0, y: py0, w, h: h - py0 - 2 };
  const yTicks = [1, 1e3, 1e6];
  const fr = plotFrame(
    ctx,
    rect,
    { min: 0, max: 0.6, ticks: narrow ? [0, 0.2, 0.4, 0.6] : [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6] },
    { min: 0.5, max: 2e6, log: true, ticks: yTicks, format: (v) => (v === 1 ? '1 nm' : v === 1e3 ? '1 µm' : '1 mm') },
  );
  haloText(ctx, f.specialist ? 'incidence angle α_{i} (°)' : 'incidence angle (°)', (fr.x0 + fr.x1) / 2, rect.y + rect.h - 2, { size: 11, align: 'center', color: TOKENS.ink2, weight: 500, halo: false });
  ctx.save();
  ctx.translate(rect.x + 11, (fr.y0 + fr.y1) / 2);
  ctx.rotate(-Math.PI / 2);
  haloText(ctx, f.specialist ? '1/e depth Λ' : 'how deep', 0, 4, { size: 11, align: 'center', color: TOKENS.ink2, weight: 500, halo: false });
  ctx.restore();
  // minor decade grid
  ctx.save();
  ctx.strokeStyle = 'rgba(140,170,210,0.06)';
  for (let e = 0; e <= 6; e++) {
    const y = fr.py(Math.pow(10, e));
    ctx.beginPath();
    ctx.moveTo(fr.x0, y);
    ctx.lineTo(fr.x1, y);
    ctx.stroke();
  }
  ctx.restore();
  // α_c markers
  const mark = (a: number, txt: string, color: string, dy: number) => {
    const x = fr.px(a / DEG);
    if (x < fr.x0 || x > fr.x1) return;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, fr.y0);
    ctx.lineTo(x, fr.y1);
    ctx.stroke();
    ctx.restore();
    haloText(ctx, txt, x + 3, fr.y1 + 10 + dy, { size: 9.5, color });
  };
  mark(d.ps.alphaC, f.specialist ? 'α_{c} PS' : 'polymer', f.accent, 0);
  mark(d.si.alphaC, f.specialist ? 'α_{c} Si' : 'silicon', '#c7d2e0', 12);
  line(ctx, fr, curves.a, curves.ps, f.accent, 1.8);
  line(ctx, fr, curves.a, curves.si, '#c7d2e0', 1.8);
  // current α_i
  const xa = fr.px(d.aI / DEG);
  ctx.save();
  ctx.strokeStyle = TOKENS.xray;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(xa, fr.y0);
  ctx.lineTo(xa, fr.y1);
  ctx.stroke();
  for (const [v, col] of [
    [d.penSi, '#c7d2e0'],
    [d.penPs, f.accent],
  ] as const) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(xa, fr.py(Math.max(0.5, Math.min(2e6, v))), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // legend
  const lx = fr.x1 - 4;
  const ly = fr.y0 - 20;
  haloText(ctx, 'polystyrene', lx, ly, { size: 9.5, align: 'right', color: f.accent });
  haloText(ctx, 'silicon', lx, ly + 12, { size: 9.5, align: 'right', color: '#c7d2e0' });
  return { plot: { x0: fr.x0, x1: fr.x1, y0: fr.y0, y1: fr.y1, px: (a: number) => fr.px(a) } };
}

// ------------------------------------------------------------------ 4 · surface from above

export interface TopLayout {
  x: number;
  y: number;
  s: number;
}

export function topLayout(w: number, h: number): TopLayout {
  const s = Math.max(60, Math.min(w - 16, h - 52));
  return { x: Math.round((w - s) / 2), y: 26, s };
}

/** Shaded-relief rendering of the height map (AFM-style), tinted with the accent colour. */
export function paintSurface(img: ImageData, height: Float64Array, accent: string): void {
  const hx = accent.replace('#', '');
  const v = parseInt(hx, 16);
  const ar = (v >> 16) & 255;
  const ag = (v >> 8) & 255;
  const ab = v & 255;
  const d = img.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const hh = height[i] / H0_NM;
      const gx = (height[y * N + ((x + 1) % N)] - height[y * N + ((x - 1 + N) % N)]) / (2 * PIXEL_NM);
      const gy = (height[((y + 1) % N) * N + x] - height[((y - 1 + N) % N) * N + x]) / (2 * PIXEL_NM);
      // light from upper-left
      const shade = Math.max(-1, Math.min(1, (-gx - gy) * 6));
      const base = 0.18 + 0.82 * Math.min(1, hh * 1.6);
      const lum = 0.55 + 0.45 * shade;
      const t = Math.min(1, hh * 2.2);
      const r = (14 * (1 - t) + ar * t * base) * (0.75 + 0.5 * lum * t + (1 - t) * 0.25);
      const g = (22 * (1 - t) + ag * t * base) * (0.75 + 0.5 * lum * t + (1 - t) * 0.25);
      const b = (36 * (1 - t) + ab * t * base) * (0.75 + 0.5 * lum * t + (1 - t) * 0.25);
      const o = i * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
}

export function drawTop(
  c: Canvas2D,
  f: ViewFlags,
  image: HTMLCanvasElement,
  win: Float64Array,
  info: { L: number; hover: { x: number; y: number } | null; pulse: { x: number; y: number; t: number } | null; history: { t: Float64Array; L: Float64Array; n: number } },
): TopLayout {
  const { ctx, w, h } = c;
  ctx.clearRect(0, 0, w, h);
  const T = topLayout(w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, T.x, T.y, T.s, T.s);
  ctx.restore();
  // beam overlay: coherent → 1 µm Gaussian stripe along x; ordinary → whole patch
  const accent = f.accent;
  if (f.coherent) {
    ctx.save();
    const g = ctx.createLinearGradient(0, T.y, 0, T.y + T.s);
    for (let i = 0; i <= 16; i++) {
      const yy = Math.floor((i / 16) * (N - 1));
      const a = win[yy] * win[yy];
      g.addColorStop(i / 16, `rgba(92,211,255,${(0.32 * a).toFixed(3)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(T.x, T.y, T.s, T.s);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(92,211,255,0.08)';
    ctx.fillRect(T.x, T.y, T.s, T.s);
  }
  ctx.strokeStyle = 'rgba(190,210,235,0.35)';
  ctx.strokeRect(T.x + 0.5, T.y + 0.5, T.s - 1, T.s - 1);
  // beam arrow
  {
    const y = T.y + T.s / 2;
    ctx.save();
    ctx.strokeStyle = TOKENS.xray;
    ctx.fillStyle = TOKENS.xray;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(T.x + 4, y);
    ctx.lineTo(T.x + 26, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(T.x + 30, y);
    ctx.lineTo(T.x + 23, y - 4);
    ctx.lineTo(T.x + 23, y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    haloText(ctx, f.coherent ? (f.specialist ? 'coherent beam, 1 µm FWHM' : 'coherent beam') : 'beam covers it all', T.x + 6, y - 8, { size: 10, color: TOKENS.xray });
  }
  // scale bar 1 µm
  {
    const len = (1000 / (N * PIXEL_NM)) * T.s;
    const bx = T.x + T.s - 8 - len;
    const by = T.y + T.s - 10;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + len, by);
    ctx.stroke();
    haloText(ctx, '1 µm', bx + len / 2, by - 5, { size: 10, align: 'center' });
  }
  // pulse ring after a poke
  if (info.pulse && info.pulse.t < 1) {
    const p = info.pulse;
    const x = T.x + (p.x / N) * T.s;
    const y = T.y + (p.y / N) * T.s;
    ctx.save();
    ctx.strokeStyle = rgba(accent, 1 - p.t);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6 + 26 * p.t, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // hover brush
  if (info.hover) {
    const x = T.x + (info.hover.x / N) * T.s;
    const y = T.y + (info.hover.y / N) * T.s;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(5, ((info.L * 0.32) / N) * T.s), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // spacing readout under the map
  const txt = f.specialist ? (w < 300 ? `L = 2π/q* = ${fmtLen(info.L)}` : `L = 2π/q* = ${fmtLen(info.L)} · patch 2.56 µm`) : `islands about ${fmtLen(info.L)} apart`;
  haloText(ctx, txt, w / 2, T.y + T.s + 16, { align: 'center', size: 11, color: TOKENS.ink2, weight: 500, halo: false });
  // L(t) log-log inset for specialists: coarsening law L ∝ t^{1/3}
  if (f.specialist && info.history.n > 3 && T.s > 150) {
    const iw = Math.min(110, T.s * 0.42);
    const ih = iw * 0.62;
    const ix = T.x + 6;
    const iy = T.y + T.s - ih - 6;
    ctx.save();
    ctx.fillStyle = 'rgba(5,8,14,0.78)';
    roundRect(ctx, ix, iy, iw, ih, 5);
    ctx.fill();
    const H = info.history;
    let t0 = Infinity;
    let t1 = 0;
    let l0 = Infinity;
    let l1 = 0;
    for (let i = 0; i < H.n; i++) {
      t0 = Math.min(t0, H.t[i]);
      t1 = Math.max(t1, H.t[i]);
      l0 = Math.min(l0, H.L[i]);
      l1 = Math.max(l1, H.L[i]);
    }
    const lt0 = Math.log10(Math.max(t0, 1));
    const lt1 = Math.max(lt0 + 0.5, Math.log10(Math.max(t1, 2)));
    const ll0 = Math.log10(l0) - 0.05;
    const ll1 = Math.max(ll0 + 0.25, Math.log10(l1) + 0.05);
    const X = (t: number) => ix + 6 + ((Math.log10(Math.max(t, 1)) - lt0) / (lt1 - lt0)) * (iw - 12);
    const Yy = (l: number) => iy + ih - 14 - ((Math.log10(l) - ll0) / (ll1 - ll0)) * (ih - 22);
    // t^{1/3} guide through the last point
    const tl = H.t[H.n - 1];
    const Ll = H.L[H.n - 1];
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(233,238,245,0.45)';
    ctx.beginPath();
    for (let k = 0; k <= 10; k++) {
      const tt = Math.pow(10, lt0 + ((lt1 - lt0) * k) / 10);
      const ll = Ll * Math.pow(tt / tl, 1 / 3);
      if (k === 0) ctx.moveTo(X(tt), Yy(ll));
      else ctx.lineTo(X(tt), Yy(ll));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < H.n; i++) {
      if (i === 0) ctx.moveTo(X(H.t[i]), Yy(H.L[i]));
      else ctx.lineTo(X(H.t[i]), Yy(H.L[i]));
    }
    ctx.stroke();
    ctx.restore();
    label(ctx, 'L vs t (log–log)', ix + 6, iy + 11, { size: 9, color: TOKENS.ink2 });
    label(ctx, '--- t^1/3', ix + iw - 6, iy + ih - 4, { size: 9, color: TOKENS.ink3, align: 'right' });
  }
  return T;
}
