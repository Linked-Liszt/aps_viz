import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mats, glowMaterial } from '../../scene/palette';

/**
 * Small modelling kit for the ATOMIC layout (a copy of the 3DMN exhibit's kit, vendored so the two canted-partner exhibits can
 * evolve independently; the shared parts library is not modified).
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
  lead: () => cached('atomic-lead', () => new THREE.MeshStandardMaterial({ color: 0x737c88, roughness: 0.62, metalness: 0.35 })),
  tungsten: () => cached('atomic-w', () => new THREE.MeshStandardMaterial({ color: 0x4f5560, roughness: 0.38, metalness: 0.8 })),
  gold: () => cached('atomic-au', () => new THREE.MeshStandardMaterial({ color: 0xe0b85a, roughness: 0.22, metalness: 1.0, emissive: 0x3a2a08, emissiveIntensity: 0.6 })),
  platinum: () => cached('atomic-pt', () => new THREE.MeshStandardMaterial({ color: 0xeef0f6, roughness: 0.15, metalness: 1.0, emissive: 0x9aa4b8, emissiveIntensity: 0.5 })),
  alu: () => cached('atomic-alu', () => new THREE.MeshStandardMaterial({ color: 0xc7ced8, roughness: 0.42, metalness: 0.75 })),
  blackAnod: () => cached('atomic-anod', () => new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.55, metalness: 0.4 })),
  blueAnod: () => cached('atomic-banod', () => new THREE.MeshStandardMaterial({ color: 0x2f5f9e, roughness: 0.45, metalness: 0.5 })),
  sample: () => cached('atomic-sample', () => new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.25, metalness: 0.95, emissive: 0x2dd4bf, emissiveIntensity: 0.25 })),
  magnet: () => mats.magnetDipole(),
  coil: () => cached('atomic-coil', () => new THREE.MeshStandardMaterial({ color: 0xc7835a, roughness: 0.35, metalness: 0.8 })),
  heater: () => cached('atomic-heater', () => new THREE.MeshStandardMaterial({ color: 0xff7a3d, emissive: 0xff5a1f, emissiveIntensity: 2.2, roughness: 0.5 })),
  /** translucent vacuum-vessel shell (museum cut-away) */
  vessel: () =>
    cached('atomic-vessel', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, metalness: 0.2, roughness: 0.25, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    ),
  vesselEdge: () => cached('atomic-vedge', () => new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.6 })),
  /** glass of the nano thermal enclosure */
  glass: () =>
    cached('atomic-glass', () =>
      new THREE.MeshPhysicalMaterial({ color: 0x9fc7ff, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    ),
  /** semi-transparent thin flight tube so the beam inside stays visible */
  tube: () =>
    cached('atomic-tube', () => new THREE.MeshStandardMaterial({ color: 0xc5cdd6, metalness: 0.6, roughness: 0.35, transparent: true, opacity: 0.32, depthWrite: false })),
  laser: () => glowMaterial(0xff3b3b, 3.2),
  /** flat-panel detector housing: light blue-grey so the panels read against the dark hutch floor and the alu gantry */
  detHousing: () => cached('atomic-dethouse', () => new THREE.MeshStandardMaterial({ color: 0x7f97b3, roughness: 0.42, metalness: 0.55 })),
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

/**
 * The engine's travelling beam pulses are 7 cm glowing spheres: right from metres away, but in the 0.3–0.5 m close-ups around
 * the sample a pulse passing the camera blooms over half the frame. Shrink each pulse as the camera approaches (full size from
 * `full` metres, never below `min`), so a nearby pulse keeps roughly the on-screen size of one `full` metres away. Engine
 * pulses are recognised as in the CHEX layout (SphereGeometry r = 0.035 m carrying userData.u). Call after the engine beams
 * exist (custom() runs last). Pulses closer than `near` metres are hidden (scaled to ~0). Suggested engine change: size pulses
 * by camera distance or in screen space.
 */
export function tamePulses(group: THREE.Object3D, full = 4, min = 0.1, near = 0.35): void {
  const cam = new THREE.Vector3();
  const p = new THREE.Vector3();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    const geo = m.geometry as THREE.SphereGeometry | undefined;
    if (!m.isMesh || geo?.type !== 'SphereGeometry' || geo.parameters.radius !== 0.035 || m.userData.u === undefined) return;
    m.onBeforeRender = (_r, _s, camera) => {
      cam.setFromMatrixPosition(camera.matrixWorld);
      p.setFromMatrixPosition(m.matrixWorld);
      // within `near` of the camera a pulse is only a bloom blob (the diffracted ray points at the sample close-ups): hide it
      const d = p.distanceTo(cam);
      const s = d < near ? 1e-4 : THREE.MathUtils.clamp(d / full, min, 1);
      if (Math.abs(m.scale.x - s) > 1e-3) {
        m.scale.setScalar(s);
        m.updateMatrixWorld();
      }
    };
  });
}

/** True when the visitor asked the OS for reduced motion. */
export const REDUCED_MOTION = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
