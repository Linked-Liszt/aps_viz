import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mats, glowMaterial, COLORS } from '../../scene/palette';

/**
 * Small modelling kit for the HEXM layout (local to this beamline; the shared parts library is not modified).
 * All sizes in metres. Frame: +X downstream, +Y up (0 = beam height), +Z outboard.
 */

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

const std = (key: string, p: THREE.MeshStandardMaterialParameters) => () => cached(`hexm-${key}`, () => new THREE.MeshStandardMaterial(p));

export const M = {
  steel: () => mats.steel(),
  darkSteel: () => mats.darkSteel(),
  granite: () => mats.granite(),
  silicon: () => mats.silicon(),
  copper: () => mats.copper(),
  detector: () => mats.detector(),
  model: () => mats.model(),
  lead: std('lead', { color: 0x737c88, roughness: 0.62, metalness: 0.35 }),
  tungsten: std('w', { color: 0x4f5560, roughness: 0.38, metalness: 0.8 }),
  alu: std('alu', { color: 0xc7ced8, roughness: 0.42, metalness: 0.75 }),
  blackAnod: std('anod', { color: 0x23272e, roughness: 0.55, metalness: 0.4 }),
  blueAnod: std('banod', { color: 0x2f5f9e, roughness: 0.45, metalness: 0.5 }),
  /** the tan/beige paint of the 20-ID-E detector movers (poster rendering) */
  tan: std('tan', { color: 0xc8b48c, roughness: 0.7, metalness: 0.1 }),
  tanDark: std('tan2', { color: 0x9c8a66, roughness: 0.7, metalness: 0.15 }),
  /** safety yellow (roof-walkway railing, bridge crane) */
  yellow: std('yellow', { color: 0xd9b92e, roughness: 0.6, metalness: 0.2 }),
  orange: std('orange', { color: 0xd9822b, roughness: 0.55, metalness: 0.2 }),
  rail: std('rail', { color: 0x8d99a8, roughness: 0.3, metalness: 0.85 }),
  /**
   * Clear refractive-optic materials (diamond windows and white-beam CRLs; Be/Al lenses). Plain alpha blending with a
   * glossy clearcoat instead of `transmission`: a transmissive material makes three render the whole scene into an
   * extra pre-pass every frame, and without depth writes these meshes stay order-independent, so static batching
   * (scene/beamline/batch.ts) can merge every lens of the beamline into one draw call per material.
   */
  diamond: () =>
    cached('hexm-diamond', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xe8f6ff, roughness: 0.05, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.05,
        emissive: 0x3f7fa0, emissiveIntensity: 0.25, transparent: true, opacity: 0.6, depthWrite: false,
      }),
    ),
  lens: () =>
    cached('hexm-lens', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xd7f3ff, roughness: 0.05, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.05,
        emissive: 0x2f6f8f, emissiveIntensity: 0.2, transparent: true, opacity: 0.65, depthWrite: false,
      }),
    ),
  /** bent Si Laue crystal: slightly glowing so the thin wafers read at a distance */
  laue: std('laue', { color: 0xa9c2ec, roughness: 0.12, metalness: 0.4, emissive: 0x3d64b0, emissiveIntensity: 0.55 }),
  ln2: std('ln2', { color: 0xe6edf5, roughness: 0.3, metalness: 0.7 }),
  sample: std('sample', { color: 0xc2c9d2, roughness: 0.25, metalness: 0.95, emissive: 0xfb923c, emissiveIntensity: 0.35 }),
  scint: std('scint', { color: 0xbff7c8, roughness: 0.2, metalness: 0.1, emissive: 0x3dff8a, emissiveIntensity: 0.9 }),
  /** translucent vacuum-vessel shell (museum cut-away) */
  vessel: () =>
    cached('hexm-vessel', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, metalness: 0.2, roughness: 0.25, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    ),
  vesselEdge: () => cached('hexm-vedge', () => new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.6 })),
  hole: () => cached('hexm-hole', () => new THREE.MeshBasicMaterial({ color: 0x050608 })),
};

export const box = (w: number, h: number, d: number, m: THREE.Material, r = 0.004): THREE.Mesh =>
  new THREE.Mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01)) : new THREE.BoxGeometry(w, h, d), m);

/** Box spanning explicit min/max corners (convenient for layout from drawings). */
export function boxSpan(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material, r = 0.004): THREE.Mesh {
  const b = box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), m, r);
  b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return b;
}

export const cyl = (r: number, h: number, m: THREE.Material, seg = 24): THREE.Mesh => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);

/** Cylinder between two points. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, seg = 12): THREE.Mesh {
  const d = b.clone().sub(a);
  const c = cyl(r, d.length(), m, seg);
  c.position.copy(a).addScaledVector(d, 0.5);
  c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return c;
}

/** Square-section bar between two points (structural extrusion). */
export function bar(a: THREE.Vector3, b: THREE.Vector3, s: number, m: THREE.Material): THREE.Mesh {
  const d = b.clone().sub(a);
  const g = new THREE.Mesh(new THREE.BoxGeometry(s, d.length(), s), m);
  g.position.copy(a).addScaledVector(d, 0.5);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return g;
}

/** Support pedestal from the floor (y = floorY) up to y = topY, centred at (x, z). */
export function pedestal(x: number, z: number, floorY: number, topY: number, w: number, d: number, m: THREE.Material = M.steel()): THREE.Mesh {
  return boxSpan(x - w / 2, x + w / 2, floorY, topY, z - d / 2, z + d / 2, m, 0.006);
}

/** Translucent box-shaped vessel with crisp edges. */
export function vesselBox(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const shell = new THREE.Mesh(geo, M.vessel());
  shell.renderOrder = 3;
  g.add(shell, new THREE.LineSegments(new THREE.EdgesGeometry(geo), M.vesselEdge()));
  return g;
}

/** Beam-pipe flange (disc normal to X). */
export function flangeX(r: number, m: THREE.Material = M.steel()): THREE.Mesh {
  const f = cyl(r, 0.02, m, 24);
  f.rotation.z = Math.PI / 2;
  return f;
}

/** Pipe along +X from x0 to x1 at (y, z). */
export function pipeX(x0: number, x1: number, r: number, m: THREE.Material = M.steel(), y = 0, z = 0): THREE.Mesh {
  const p = cyl(r, Math.abs(x1 - x0), m, 20);
  p.rotation.z = Math.PI / 2;
  p.position.set((x0 + x1) / 2, y, z);
  return p;
}

/** Glowing beam segment (world-size cylinder) for short in-device beam paths. */
export function beamSeg(a: THREE.Vector3, b: THREE.Vector3, r = 0.0025, color: THREE.ColorRepresentation = COLORS.xray, intensity = 4): THREE.Mesh {
  return rod(a, b, r, glowMaterial(color, intensity), 8);
}

export function shadowed<T extends THREE.Object3D>(o: T, cast = true): T {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      const mat = m.material as THREE.Material;
      // glass-like (no depth write) or faint materials neither cast nor receive shadows
      const seeThrough = mat.transparent && (!mat.depthWrite || (mat as THREE.MeshStandardMaterial).opacity < 0.6);
      m.castShadow = cast && !seeThrough;
      m.receiveShadow = !seeThrough;
    }
  });
  return o;
}

/** Pixel-detector face texture (module grid + a few diffraction rings/spots), cached per style. */
const faceCache = new Map<string, THREE.MeshStandardMaterial>();
export function detectorFace(style: 'rings' | 'arc' | 'spot' | 'speckle' | 'saxs' | 'image' | 'blank', color = '#fb923c'): THREE.MeshStandardMaterial {
  const key = `${style}-${color}`;
  let m = faceCache.get(key);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05080d';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(120,150,190,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(0, i * 64);
    g.lineTo(256, i * 64);
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64, 256);
    g.stroke();
  }
  g.globalCompositeOperation = 'lighter';
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (style === 'rings') {
    for (const r of [44, 51, 72, 85, 89, 102]) {
      g.strokeStyle = color + '99';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(128, 128, r, 0, Math.PI * 2);
      g.stroke();
    }
  } else if (style === 'arc') {
    // a segment of one Debye ring crossing the panel (ring centre = beam, off the panel's lower corner)
    const cx = -232;
    const cy = 488;
    const r = 509;
    g.strokeStyle = color + 'ff';
    g.lineWidth = 12;
    g.beginPath();
    g.arc(cx, cy, r, -Math.PI / 2, 0);
    g.stroke();
    for (let i = 0; i < 90; i++) {
      const a = -Math.PI / 2 + rnd() * (Math.PI / 2);
      g.fillStyle = '#ffffff';
      g.fillRect(cx + Math.cos(a) * (r + (rnd() - 0.5) * 8) - 2.5, cy + Math.sin(a) * (r + (rnd() - 0.5) * 8) - 2.5, 5, 5);
    }
  } else if (style === 'spot' || style === 'speckle') {
    // one Bragg peak with coherent fringes
    for (let k = 7; k >= 1; k--) {
      g.fillStyle = color + Math.floor(20 + (8 - k) * 22).toString(16).padStart(2, '0');
      g.beginPath();
      g.ellipse(128, 128, k * 12, k * 7, 0.4, 0, Math.PI * 2);
      g.fill();
    }
    if (style === 'speckle')
      for (let i = 0; i < 400; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.pow(rnd(), 0.8) * 110;
        g.fillStyle = color + '66';
        g.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r * 0.7, 3, 3);
      }
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(128, 128, 6, 0, Math.PI * 2);
    g.fill();
  } else if (style === 'saxs') {
    const grd = g.createRadialGradient(128, 128, 4, 128, 128, 120);
    grd.addColorStop(0, color + 'ff');
    grd.addColorStop(0.25, color + '88');
    grd.addColorStop(1, color + '00');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#0a0d12';
    g.beginPath();
    g.arc(128, 128, 10, 0, Math.PI * 2);
    g.fill();
  } else if (style === 'image') {
    // magnified grain image (TXM): polygonal grains
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `hsla(${20 + rnd() * 30}, 80%, ${20 + rnd() * 35}%, 0.9)`;
      g.beginPath();
      const cx = rnd() * 256;
      const cy = rnd() * 256;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + rnd() * 0.4;
        const r = 20 + rnd() * 26;
        if (k === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: style === 'blank' ? 0.4 : 1.0, roughness: 0.5 });
  faceCache.set(key, m);
  return m;
}

/**
 * Area-detector head with its sensitive face pointing toward -X of its own group (i.e. upstream when unrotated).
 * w × h is the active area; depth is the housing depth behind the face.
 */
export function detectorHead(w: number, h: number, depth: number, face: THREE.Material, housing: THREE.Material = M.detector()): THREE.Group {
  const g = new THREE.Group();
  const shell = boxSpan(0, depth, -h / 2 - 0.04, h / 2 + 0.04, -w / 2 - 0.04, w / 2 + 0.04, housing, 0.02);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(w, h), face);
  f.rotation.y = -Math.PI / 2;
  f.position.x = -0.004;
  const fins = boxSpan(depth * 0.4, depth * 0.95, -h * 0.3, h * 0.3, w / 2 + 0.04, w / 2 + 0.07, M.darkSteel(), 0.004);
  g.add(shell, f, fins);
  return g;
}
