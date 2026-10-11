import * as THREE from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { fatSegments } from '../../scene/lines';
import { N_SURF } from './geom';
import { now, REDUCED_MOTION } from './kit';

/**
 * Polychromatic (Laue) diffraction from an fcc nickel grain in the 34-ID-E reflection geometry, computed once at load.
 * Beam along +X; each primitive reciprocal-lattice direction ĝ with k̂·ĝ < 0 reflects the incident direction to
 * k̂' = k̂ − 2(k̂·ĝ)ĝ at energy E₁ = hc / (2 d sinθ); harmonics n·(hkl) share the spot (fcc: all-odd or all-even only).
 * Spots are kept if any allowed harmonic lies in the 5.3–30 keV pink band and the ray leaves through the 45° surface.
 */

const HC = 12.398419843; // keV·Å
const A_NI = 3.524; // Å
export const BAND = { min: 5.3, max: 30 };

export interface Grain {
  /** orientation (crystal → lab) */
  U: THREE.Matrix3;
  /** origin of the rays relative to the beam-entry point (depth along the beam, model scale) */
  origin: THREE.Vector3;
}

export interface Detector {
  name: string;
  /** detector centre relative to the sample */
  center: THREE.Vector3;
  /** face normal pointing away from the sample (default: along `center`, i.e. the panel faces the sample) */
  normal?: THREE.Vector3;
  /** half-size of the active area (m) */
  half: number;
}

export interface Spot {
  dir: THREE.Vector3;
  E: number;
  I: number;
  det: string;
  hit: THREE.Vector3;
  /** in-plane coordinates on the detector (m) */
  uv: [number, number];
  origin: THREE.Vector3;
}

/** Deterministic "random" rotation (uniform via quaternions) so the exhibit always shows the same grain. */
export function grainOrientation(seed: number): THREE.Matrix3 {
  let s = seed >>> 0;
  const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const u1 = r(), u2 = r(), u3 = r();
  const q = new THREE.Quaternion(
    Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
    Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
    Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
    Math.sqrt(u1) * Math.cos(2 * Math.PI * u3),
  );
  return new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
}

/** Smooth pink-beam spectrum after the mirror (illustrative): rises above ~7 keV, mirror cut-off near 26–30 keV. */
function spectrum(E: number): number {
  if (E < BAND.min || E > BAND.max) return 0;
  return (1 / (1 + Math.exp(-(E - 7) / 1.0))) * (1 / (1 + Math.exp((E - 26) / 1.5)));
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const fccAllowed = (h: number, k: number, l: number) => {
  const p = (v: number) => ((v % 2) + 2) % 2;
  return p(h) === p(k) && p(k) === p(l);
};

/**
 * Plane basis for a detector: n is the plane normal pointing away from the sample (default: along the centre vector),
 * e1 is horizontal and e2 = (−n) × e1, so (e1, e2, −n) is right-handed with −n (the active face) toward the sample.
 */
function detBasis(c: THREE.Vector3, normal?: THREE.Vector3): { n: THREE.Vector3; e1: THREE.Vector3; e2: THREE.Vector3 } {
  const n = (normal ?? c).clone().normalize();
  let e1 = new THREE.Vector3(0, 1, 0).cross(n);
  if (e1.lengthSq() < 1e-8) e1 = new THREE.Vector3(1, 0, 0);
  e1.normalize();
  const e2 = n.clone().negate().cross(e1).normalize();
  return { n, e1, e2 };
}

export function laueSpots(grains: Grain[], dets: Detector[], nmax = 12): Spot[] {
  const out: Spot[] = [];
  const kin = new THREE.Vector3(1, 0, 0);
  const g = new THREE.Vector3();
  const bases = dets.map((d) => ({ d, ...detBasis(d.center, d.normal) }));
  for (const grain of grains) {
    for (let h = -nmax; h <= nmax; h++)
      for (let k = -nmax; k <= nmax; k++)
        for (let l = -nmax; l <= nmax; l++) {
          if (!h && !k && !l) continue;
          if (gcd(gcd(h, k), l) !== 1) continue;
          g.set(h, k, l).applyMatrix3(grain.U);
          const gl = g.length();
          g.divideScalar(gl);
          const c = kin.dot(g);
          if (c >= -1e-6) continue;
          const kout = kin.clone().addScaledVector(g, -2 * c);
          if (kout.dot(N_SURF) <= 0.05) continue; // must exit through the 45° surface
          const d1 = A_NI / Math.hypot(h, k, l);
          const E1 = HC / (2 * d1 * -c);
          let I = 0, Eb = 0, Ib = 0;
          for (let n = 1; n <= 10; n++) {
            const E = n * E1;
            if (E > BAND.max) break;
            if (!fccAllowed(n * h, n * k, n * l)) continue;
            const s = Math.hypot(n * h, n * k, n * l) / (2 * A_NI); // sinθ/λ
            const f = Math.exp(-0.35 * s * s) * Math.exp(-1.2 * s); // form factor × Debye–Waller (illustrative)
            const w = (spectrum(E) * f * f) / n;
            if (w > Ib) {
              Ib = w;
              Eb = E;
            }
            I += w;
          }
          if (I <= 3e-4) continue;
          for (const b of bases) {
            const cd = kout.dot(b.n);
            if (cd <= 0.2) continue;
            // ray origin + t·k̂ meets the detector plane (p − centre)·n = 0
            const t = b.d.center.clone().sub(grain.origin).dot(b.n) / cd;
            const p = kout.clone().multiplyScalar(t).add(grain.origin);
            const q = p.clone().sub(b.d.center);
            const u = q.dot(b.e1);
            const v = q.dot(b.e2);
            if (Math.abs(u) > b.d.half || Math.abs(v) > b.d.half) continue;
            out.push({ dir: kout, E: Eb, I, det: b.d.name, hit: p, uv: [u, v], origin: grain.origin.clone() });
          }
        }
  }
  return out;
}

// ------------------------------------------------------------------ colour: energy → hue (same convention as the Laue station)

/** Red (5.3 keV) → violet (30 keV), hue linear in log E. */
export function energyColor(E: number, out = new THREE.Color()): THREE.Color {
  const t = Math.max(0, Math.min(1, Math.log(E / BAND.min) / Math.log(BAND.max / BAND.min)));
  return out.setHSL((275 * t) / 360, 0.95, 0.58 + (t > 0.55 ? 0.1 * ((t - 0.55) / 0.45) : 0));
}

// ------------------------------------------------------------------ ray fan with wire occlusion

export interface WireState {
  /** Wire-axis position relative to the sample at time t. The wire is parallel to Z. */
  at: (t: number) => THREE.Vector3;
  r: number;
}

/**
 * Coloured rays from the sample to every spot. If a wire is given, rays whose path passes the wire are dimmed each frame:
 * the DAXM principle (which spot blinks off depends on the depth it came from and the wire position).
 */
export function rayFan(
  spots: Spot[],
  wire?: WireState,
  opts: { width?: number; gain?: number; startFrac?: number; nearFade?: { near: number; far: number; min: number } } = {},
): THREE.Object3D {
  const Imax = Math.max(...spots.map((s) => s.I), 1e-9);
  const segs: [THREE.Vector3, THREE.Vector3][] = spots.map((s) => [s.origin.clone(), s.hit.clone()]);
  const base = spots.map((s) => energyColor(s.E).multiplyScalar((opts.gain ?? 1) * (0.7 + 2.2 * Math.sqrt(s.I / Imax))));
  const fs = fatSegments(segs, base, { width: opts.width ?? 1.6 });
  const mat = fs.object.material as LineMaterial;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.AdditiveBlending;
  fs.object.renderOrder = 5;
  // Colour ramps from dim at the sample to full at the detector: dozens of rays leave the same point, and at full
  // brightness their additive sum blooms into a blob that hides the sample and the wire.
  const k0 = opts.startFrac ?? 0.12;
  const col = new Float32Array(spots.length * 6);
  const write = (i: number, c: THREE.Color, k = 1) => col.set([c.r * k * k0, c.g * k * k0, c.b * k * k0, c.r * k, c.g * k, c.b * k], i * 6);
  base.forEach((c, i) => write(i, c));
  const geo = fs.object.geometry as LineSegmentsGeometry;
  geo.setColors(col);
  // In extreme close-ups the camera sits inside the fan (the detectors cover much of the upper hemisphere): fade the rays
  // so that the sample, the wire and the coded aperture stay readable; the blinking stays visible at reduced opacity.
  const fade = opts.nearFade;
  const origin = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const applyFade = (camera: THREE.Camera) => {
    if (!fade) return;
    fs.object.getWorldPosition(origin);
    camera.getWorldPosition(camPos);
    const t = Math.max(0, Math.min(1, (camPos.distanceTo(origin) - fade.near) / (fade.far - fade.near)));
    mat.opacity = fade.min + (1 - fade.min) * t * t * (3 - 2 * t);
  };
  const host = fs.object as THREE.Object3D;
  if (fade) host.onBeforeRender = (_r, _s, camera) => applyFade(camera);
  if (wire && !REDUCED_MOTION) {
    const blocked = new Uint8Array(spots.length);
    host.onBeforeRender = (_r, _s, camera) => {
      applyFade(camera);
      const w = wire.at(now());
      let changed = false;
      spots.forEach((s, i) => {
        // distance (in the X–Y plane; the wire is along Z) from the wire axis to the ray origin + t·dir, t > 0
        const dx = w.x - s.origin.x;
        const dy = w.y - s.origin.y;
        const kx = s.dir.x;
        const ky = s.dir.y;
        const kk = Math.hypot(kx, ky) || 1e-9;
        const dist = Math.abs(kx * dy - ky * dx) / kk;
        const ahead = kx * dx + ky * dy > 0;
        const b = ahead && dist < wire.r ? 1 : 0;
        if (b !== blocked[i]) {
          blocked[i] = b;
          changed = true;
          write(i, base[i], b ? 0.06 : 1);
        }
      });
      if (changed) {
        const a = geo.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute;
        a.data.needsUpdate = true;
      }
    };
  }
  return fs.object;
}

/** Bright dots where the rays land (just in front of each detector face). */
export function spotDots(spots: Spot[], size = 0.006): THREE.Object3D {
  const g = new THREE.Group();
  const Imax = Math.max(...spots.map((s) => s.I), 1e-9);
  const geo = new THREE.CircleGeometry(size, 12);
  for (const s of spots) {
    const c = energyColor(s.E).multiplyScalar(1.5 + 3 * Math.sqrt(s.I / Imax));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, toneMapped: false, side: THREE.DoubleSide }));
    m.position.copy(s.hit).addScaledVector(s.dir, -0.004);
    m.lookAt(s.origin);
    m.scale.setScalar(0.6 + 0.8 * Math.sqrt(s.I / Imax));
    g.add(m);
  }
  return g;
}

/** Canvas texture of the detector face: module tiling + the computed Laue spots (u → +x of the plane, v → +y). */
export function faceTexture(spots: Spot[], half: number, tiles = 4): THREE.CanvasTexture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#05080d';
  ctx.fillRect(0, 0, N, N);
  ctx.strokeStyle = 'rgba(120,150,190,0.3)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= tiles; i++) {
    const p = (i / tiles) * N;
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(N, p);
    ctx.moveTo(p, 0);
    ctx.lineTo(p, N);
    ctx.stroke();
  }
  const Imax = Math.max(...spots.map((s) => s.I), 1e-9);
  ctx.globalCompositeOperation = 'lighter';
  const col = new THREE.Color();
  for (const s of spots) {
    const x = ((s.uv[0] / half) * 0.5 + 0.5) * N;
    const y = (0.5 - (s.uv[1] / half) * 0.5) * N;
    energyColor(s.E, col);
    const r = 2 + 4 * Math.sqrt(s.I / Imax);
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
    const css = `rgb(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)})`;
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.35, css);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Mesh for a detector's active face, oriented to face the sample, textured with its spots. */
export function detectorFace(spots: Spot[], center: THREE.Vector3, half: number, normal?: THREE.Vector3): THREE.Mesh {
  const { n, e1, e2 } = detBasis(center, normal);
  const tex = faceTexture(spots, half);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.1, roughness: 0.6, side: THREE.DoubleSide }),
  );
  // plane +x → e1, +y → e2, +z (front) → −n (towards the sample)
  const basis = new THREE.Matrix4().makeBasis(e1, e2, n.clone().negate());
  m.quaternion.setFromRotationMatrix(basis);
  m.position.copy(center).addScaledVector(n, -0.001);
  return m;
}

/** Orientation (quaternion) that turns a box's +Z axis toward −n (facing the sample) with e1/e2 as in the face basis. */
export function facingQuaternion(center: THREE.Vector3, normal?: THREE.Vector3): THREE.Quaternion {
  const { n, e1, e2 } = detBasis(center, normal);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(e1, e2, n.clone().negate()));
}
