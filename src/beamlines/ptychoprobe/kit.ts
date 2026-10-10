import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mats, glowMaterial } from '../../scene/palette';

/**
 * Small modelling kit for the PtychoProbe layout (local to this beamline; the shared parts library is not modified).
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

const std = (key: string, p: THREE.MeshStandardMaterialParameters) => cached(`pp-${key}`, () => new THREE.MeshStandardMaterial(p));

export const M = {
  steel: () => mats.steel(),
  darkSteel: () => mats.darkSteel(),
  silicon: () => mats.silicon(),
  mirror: () => mats.mirror(),
  copper: () => mats.copper(),
  detector: () => mats.detector(),
  /** dark polished granite (base) */
  granite: () => std('granite', { color: 0x30343b, roughness: 0.62, metalness: 0.05 }),
  /** slightly lighter granite so the stacked axes read as separate blocks */
  graniteMid: () => std('granite2', { color: 0x464c55, roughness: 0.58, metalness: 0.05 }),
  graniteLight: () => std('granite3', { color: 0x5b626c, roughness: 0.55, metalness: 0.05 }),
  /** air-bearing pads / lands */
  pad: () => std('pad', { color: 0xa9b4c0, roughness: 0.3, metalness: 0.8 }),
  lead: () => std('lead', { color: 0x737c88, roughness: 0.62, metalness: 0.35 }),
  tungsten: () => std('w', { color: 0x4f5560, roughness: 0.38, metalness: 0.8 }),
  glidcop: () => std('glidcop', { color: 0xd08f62, roughness: 0.32, metalness: 0.85 }),
  gold: () => std('au', { color: 0xe6bd5c, roughness: 0.2, metalness: 1.0, emissive: 0x3a2a08, emissiveIntensity: 0.7 }),
  mll: () => std('mll', { color: 0xc9a2ff, roughness: 0.2, metalness: 0.6, emissive: 0x2a1640, emissiveIntensity: 0.6 }),
  multilayer: () => std('ml', { color: 0x9a7fd1, roughness: 0.15, metalness: 0.5 }),
  alu: () => std('alu', { color: 0xc7ced8, roughness: 0.42, metalness: 0.75 }),
  blackAnod: () => std('anod', { color: 0x23272e, roughness: 0.55, metalness: 0.4 }),
  blueFrame: () => std('bluefr', { color: 0x2f6f9e, roughness: 0.5, metalness: 0.45 }),
  orange: () => std('orange', { color: 0xd9822b, roughness: 0.45, metalness: 0.3 }),
  yellow: () => std('yellow', { color: 0xd9b531, roughness: 0.5, metalness: 0.3 }),
  purple: () => std('purple', { color: 0x6b4fc4, roughness: 0.45, metalness: 0.35 }),
  red: () => std('red', { color: 0xb8433b, roughness: 0.5, metalness: 0.3 }),
  water: () => std('water', { color: 0x3b82c4, roughness: 0.35, metalness: 0.2 }),
  ln2: () => std('ln2', { color: 0xe6edf5, roughness: 0.3, metalness: 0.7 }),
  bellows: () => std('bellows', { color: 0x9aa6b3, roughness: 0.3, metalness: 0.85 }),
  /** white-painted vacuum tank (the detector mover is cream/white in the vendor rendering) */
  tankPaint: () => std('tankpaint', { color: 0xe9e4d8, roughness: 0.55, metalness: 0.1 }),
  cabinet: () => std('cabinet', { color: 0xa9b0b8, roughness: 0.6, metalness: 0.3 }),
  sample: () => std('sample', { color: 0xdfe6ee, roughness: 0.25, metalness: 0.9, emissive: 0x60a5fa, emissiveIntensity: 0.5 }),
  magnetA: () => std('magA', { color: 0xc94b4b, roughness: 0.45, metalness: 0.4 }),
  magnetB: () => std('magB', { color: 0x3c6fd1, roughness: 0.45, metalness: 0.4 }),
  /** translucent vacuum-vessel shell (museum cut-away) */
  vessel: () =>
    cached('pp-vessel', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, metalness: 0.2, roughness: 0.25, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    ),
  vesselFaint: () =>
    cached('pp-vessel-faint', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, metalness: 0.2, roughness: 0.25, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide }),
    ),
  vesselEdge: () => cached('pp-vedge', () => new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.6 })),
  /** "not confirmed as built" ghost */
  ghost: () =>
    cached('pp-ghost', () => new THREE.MeshStandardMaterial({ color: 0x9fb8d8, roughness: 0.6, transparent: true, opacity: 0.16, depthWrite: false })),
  ghostEdge: () => cached('pp-ghostedge', () => new THREE.LineDashedMaterial({ color: 0x9fc2ee, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.75 })),
  laser: () => glowMaterial(0xff3b3b, 3.0),
  glowBlue: () => glowMaterial(0x60a5fa, 3.5),
};

export const box = (w: number, h: number, d: number, m: THREE.Material, r = 0.004): THREE.Mesh =>
  new THREE.Mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01)) : new THREE.BoxGeometry(w, h, d), m);

/** Box spanning explicit min/max corners. */
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

/** Square-section bar between two points. */
export function bar(a: THREE.Vector3, b: THREE.Vector3, s: number, m: THREE.Material): THREE.Mesh {
  const d = b.clone().sub(a);
  const g = new THREE.Mesh(new THREE.BoxGeometry(s, d.length(), s), m);
  g.position.copy(a).addScaledVector(d, 0.5);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return g;
}

/** Cylinder along X from x0 to x1 at (y, z). */
export function pipeX(x0: number, x1: number, r: number, m: THREE.Material = M.steel(), y = 0, z = 0, seg = 20): THREE.Mesh {
  const p = cyl(r, Math.abs(x1 - x0), m, seg);
  p.rotation.z = Math.PI / 2;
  p.position.set((x0 + x1) / 2, y, z);
  return p;
}

/** Cylinder along Z from z0 to z1 at (x, y). */
export function pipeZ(z0: number, z1: number, r: number, m: THREE.Material = M.steel(), x = 0, y = 0, seg = 20): THREE.Mesh {
  const p = cyl(r, Math.abs(z1 - z0), m, seg);
  p.rotation.x = Math.PI / 2;
  p.position.set(x, y, (z0 + z1) / 2);
  return p;
}

/** Disc flange normal to X. */
export function flangeX(x: number, r: number, t = 0.02, m: THREE.Material = M.steel(), y = 0, z = 0): THREE.Mesh {
  const f = cyl(r, t, m, 28);
  f.rotation.z = Math.PI / 2;
  f.position.set(x, y, z);
  return f;
}

/** Support pedestal from the floor (y = floorY) up to y = topY, centred at (x, z). */
export function pedestal(x: number, z: number, floorY: number, topY: number, w: number, d: number, m: THREE.Material = M.steel()): THREE.Mesh {
  return boxSpan(x - w / 2, x + w / 2, floorY, topY, z - d / 2, z + d / 2, m, 0.006);
}

/** Simple post stand with a base plate (pipe supports). */
export function postStand(x: number, floorY: number, topY: number, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(x - 0.12, x + 0.12, floorY, floorY + 0.02, z - 0.12, z + 0.12, M.steel(), 0.003));
  g.add(boxSpan(x - 0.025, x + 0.025, floorY + 0.02, topY, z - 0.025, z + 0.025, M.steel(), 0.003));
  g.add(boxSpan(x - 0.06, x + 0.06, topY - 0.015, topY, z - 0.05, z + 0.05, M.darkSteel(), 0.003));
  return g;
}

/** Translucent box-shaped vessel with crisp edges. */
export function vesselBox(w: number, h: number, d: number, faint = false): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const shell = new THREE.Mesh(geo, faint ? M.vesselFaint() : M.vessel());
  shell.renderOrder = 3;
  g.add(shell, new THREE.LineSegments(new THREE.EdgesGeometry(geo), M.vesselEdge()));
  return g;
}

/** Translucent vertical-axis cylindrical vessel with steel rims. */
export function vesselCylY(r: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40, 1, true), M.vessel());
  shell.renderOrder = 3;
  g.add(shell);
  for (const y of [-h / 2, h / 2]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 40), M.steel());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    g.add(rim);
  }
  return g;
}

/** Ghost outline (dashed edges + faint fill) for hardware whose installation is unconfirmed. */
export function ghostBox(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const fill = new THREE.Mesh(geo, M.ghost());
  fill.renderOrder = 3;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), M.ghostEdge());
  edges.computeLineDistances();
  g.add(fill, edges);
  return g;
}

/** Bellows (corrugated short pipe) along X. */
export function bellowsX(x0: number, x1: number, r: number, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(3, Math.round((x1 - x0) / 0.012));
  const geo = new THREE.TorusGeometry(r, r * 0.12, 6, 24);
  for (let i = 0; i <= n; i++) {
    const t = new THREE.Mesh(geo, M.bellows());
    t.rotation.y = Math.PI / 2;
    t.position.set(x0 + ((x1 - x0) * i) / n, y, z);
    g.add(t);
  }
  g.add(pipeX(x0, x1, r * 0.9, M.bellows(), y, z));
  return g;
}

/** Arbitrary prism: polygon in the (x, y) plane extruded along z from z0 to z1. */
export function prismXY(pts: [number, number][], z0: number, z1: number, m: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
  geo.translate(0, 0, z0);
  return new THREE.Mesh(geo, m);
}

export function shadowed<T extends THREE.Object3D>(o: T, cast = true): T {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    const transparent = Array.isArray(mat) ? false : mat.transparent;
    m.castShadow = cast && !transparent;
    m.receiveShadow = !transparent;
  });
  return o;
}

/** Instanced row of small boxes along X (magnet blocks, ribs …). */
export function boxRow(
  n: number,
  pos: (i: number, o: THREE.Object3D) => void,
  size: [number, number, number],
  m: THREE.Material,
): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(...size), m, n);
  const o = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    pos(i, o);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
  }
  im.instanceMatrix.needsUpdate = true;
  return im;
}
