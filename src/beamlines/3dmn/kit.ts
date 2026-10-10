import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mats, glowMaterial } from '../../scene/palette';

/**
 * Small modelling kit for the 3DMN layout (local to this beamline; the shared parts library is not modified).
 * All sizes in metres. Frame: +X downstream, +Y up, +Z outboard.
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

export const M = {
  steel: () => mats.steel(),
  darkSteel: () => mats.darkSteel(),
  granite: () => mats.granite(),
  silicon: () => mats.silicon(),
  mirror: () => mats.mirror(),
  copper: () => mats.copper(),
  detector: () => mats.detector(),
  model: () => mats.model(),
  lead: () => cached('3dmn-lead', () => new THREE.MeshStandardMaterial({ color: 0x737c88, roughness: 0.62, metalness: 0.35 })),
  tungsten: () => cached('3dmn-w', () => new THREE.MeshStandardMaterial({ color: 0x4f5560, roughness: 0.38, metalness: 0.8 })),
  gold: () => cached('3dmn-au', () => new THREE.MeshStandardMaterial({ color: 0xe0b85a, roughness: 0.22, metalness: 1.0, emissive: 0x3a2a08, emissiveIntensity: 0.6 })),
  platinum: () => cached('3dmn-pt', () => new THREE.MeshStandardMaterial({ color: 0xeef0f6, roughness: 0.15, metalness: 1.0, emissive: 0x9aa4b8, emissiveIntensity: 0.5 })),
  // satin rather than polished: at 0.42 roughness the SDD body and stages bloomed into a white flare from outboard-downstream
  alu: () => cached('3dmn-alu', () => new THREE.MeshStandardMaterial({ color: 0xc7ced8, roughness: 0.6, metalness: 0.62 })),
  blackAnod: () => cached('3dmn-anod', () => new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.55, metalness: 0.4 })),
  blueAnod: () => cached('3dmn-banod', () => new THREE.MeshStandardMaterial({ color: 0x2f5f9e, roughness: 0.45, metalness: 0.5 })),
  sample: () => cached('3dmn-sample', () => new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.25, metalness: 0.95, emissive: 0x2dd4bf, emissiveIntensity: 0.25 })),
  magnet: () => mats.magnetDipole(),
  coil: () => cached('3dmn-coil', () => new THREE.MeshStandardMaterial({ color: 0xc7835a, roughness: 0.35, metalness: 0.8 })),
  heater: () => cached('3dmn-heater', () => new THREE.MeshStandardMaterial({ color: 0xff7a3d, emissive: 0xff5a1f, emissiveIntensity: 2.2, roughness: 0.5 })),
  /** translucent vacuum-vessel shell (museum cut-away) */
  vessel: () =>
    cached('3dmn-vessel', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, metalness: 0.2, roughness: 0.25, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    ),
  vesselEdge: () => cached('3dmn-vedge', () => new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.6 })),
  /** glass of the nano thermal enclosure */
  glass: () =>
    cached('3dmn-glass', () =>
      new THREE.MeshPhysicalMaterial({ color: 0x9fc7ff, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    ),
  /** semi-transparent thin flight tube so the beam inside stays visible */
  tube: () =>
    cached('3dmn-tube', () => new THREE.MeshStandardMaterial({ color: 0xc5cdd6, metalness: 0.6, roughness: 0.35, transparent: true, opacity: 0.32, depthWrite: false })),
  laser: () => glowMaterial(0xff3b3b, 3.2),
  /** flat-panel detector housing: light blue-grey so the panels read against the dark hutch floor and the alu gantry */
  detHousing: () => cached('3dmn-dethouse', () => new THREE.MeshStandardMaterial({ color: 0x7f97b3, roughness: 0.42, metalness: 0.55 })),
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
  const L = d.length();
  const g = new THREE.Mesh(new THREE.BoxGeometry(s, L, s), m);
  g.position.copy(a).addScaledVector(d, 0.5);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return g;
}

/**
 * 45° sample wedge (the classic 34-ID-E reflection-geometry mount), in a frame whose origin is the beam spot on the
 * sample surface: the slanted top face has normal (−1, 1, 0)/√2 (up-and-upstream) and lies `gap` below the surface plane
 * (room for the sample plate); the block runs straight down to `baseY`. `faceLen` is measured along the slope.
 */
export function wedge45(faceLen: number, depthZ: number, gap: number, baseY: number, m: THREE.Material): THREE.Mesh {
  const s = Math.SQRT1_2;
  const cx = gap * s; // face centre = origin − gap·N
  const cy = -gap * s;
  const h = (faceLen / 2) * s;
  const shape = new THREE.Shape();
  shape.moveTo(cx - h, cy - h); // upstream (low) end of the slope
  shape.lineTo(cx + h, cy + h); // downstream (high) end
  shape.lineTo(cx + h, baseY);
  shape.lineTo(cx - h, baseY);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: depthZ, bevelEnabled: false });
  geo.translate(0, 0, -depthZ / 2);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, m);
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

export function shadowed<T extends THREE.Object3D>(o: T, cast = true): T {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      const mat = m.material as THREE.Material;
      const seeThrough = mat.transparent && (mat as THREE.MeshStandardMaterial).opacity < 0.6;
      m.castShadow = cast && !seeThrough;
      m.receiveShadow = !seeThrough;
    }
  });
  return o;
}

/**
 * Build a component in a convenient "station" frame: `fn` draws relative to a reference point (e.g. the sample),
 * while the returned group's origin sits at `origin` (the component position the engine places on the beam).
 */
export function inStation(origin: THREE.Vector3, fn: (g: THREE.Group) => void): THREE.Group {
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.copy(origin).multiplyScalar(-1);
  outer.add(inner);
  fn(inner);
  return shadowed(outer);
}

/** Seconds since page load: a shared clock for the small looping animations (wire scan). */
export function now(): number {
  return performance.now() / 1000;
}

/** True when the visitor asked the OS for reduced motion. */
export const REDUCED_MOTION = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
