import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mats } from '../../scene/palette';

/**
 * Geometry/material kit for the 8-ID XPCS models. All builders work in the beamline frame:
 * +X downstream, +Y up (0 = beam height), +Z outboard; metres.
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

const std = (key: string, color: number, roughness: number, metalness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  cached(`x-${key}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));

export const xm = {
  steel: () => mats.steel(),
  darkSteel: () => mats.darkSteel(),
  copper: () => mats.copper(),
  silicon: () => mats.silicon(),
  mirror: () => mats.mirror(),
  granite: () => mats.granite(),
  detector: () => mats.detector(),
  /** Huber turquoise anodising, as on the 8-ID-E six-circle (MEDSI 2020 render). */
  huber: () => std('huber', 0x22a39a, 0.42, 0.35),
  huberDark: () => std('huberD', 0x177a73, 0.45, 0.35),
  /** warm grey cast-iron / painted bases of the 8-ID-E instruments */
  base: () => std('base', 0x4a4f57, 0.6, 0.35),
  baseLight: () => std('baseL', 0x8d939b, 0.5, 0.45),
  table: () => std('table', 0x2c3138, 0.6, 0.5),
  tableTop: () => std('tableTop', 0x9aa3ad, 0.35, 0.8),
  lead: () => std('lead', 0x5d6570, 0.7, 0.3),
  tungsten: () => std('W', 0x3a3f47, 0.35, 0.9),
  white: () => std('white', 0xe6e9ed, 0.45, 0.15),
  offWhite: () => std('offWhite', 0xcfd5db, 0.5, 0.2),
  black: () => std('black', 0x14181e, 0.55, 0.3),
  rubber: () => std('rubber', 0x23272d, 0.9, 0),
  alu: () => std('alu', 0xc5cdd6, 0.35, 0.7),
  aluDark: () => std('aluD', 0x8f99a5, 0.4, 0.7),
  truss: () => std('truss', 0x5c84b8, 0.5, 0.45),
  safety: () => std('safety', 0xe0b52e, 0.55, 0.2),
  shutterYellow: () => std('shutter', 0xd9a531, 0.5, 0.3),
  trackerBlue: () => std('trackerBlue', 0x1d5fb8, 0.45, 0.3),
  kapton: () => std('kapton', 0xd98a1e, 0.35, 0.1, { emissive: 0x3a1c00, transparent: true, opacity: 0.85 }),
  /** large thin Kapton exit window: amber but see-through, so the detector face behind it still reads */
  kaptonThin: () => std('kaptonThin', 0xe0a040, 0.3, 0.05, { emissive: 0x2a1400, transparent: true, opacity: 0.28, depthWrite: false }),
  beryllium: () => std('Be', 0xb9c0c7, 0.3, 0.6),
  magnetRed: () => std('magR', 0xc94b4b, 0.45, 0.4),
  magnetBlue: () => std('magB', 0x3c6fd1, 0.45, 0.4),
  magnetGreen: () => std('magG', 0x3fa36a, 0.45, 0.4),
  pole: () => std('pole', 0x9aa6b4, 0.35, 0.8),
  frameBlue: () => std('frameBlue', 0x3f6f9a, 0.6, 0.3),
  coil: () => std('coil', 0xd08a3c, 0.35, 0.7, { emissive: 0x2a1404 }),
  pt: () => std('pt', 0xeef1f4, 0.04, 1.0),
  multilayer: () => std('ml', 0x9a7fd1, 0.15, 0.5),
  hose: () => std('hose', 0xe6edf5, 0.3, 0.7),
  waterHose: () => std('waterHose', 0x3b82c4, 0.5, 0.1),
  floorTint: () => std('floorTint', 0x223047, 0.95, 0),
  desk: () => std('desk', 0x6b7380, 0.7, 0.2),
  screen: () => std('screen', 0x0b1320, 0.4, 0.1, { emissive: 0x2f6fb8, emissiveIntensity: 0.9 }),
  /**
   * Clear materials (Couette cup, Be-lens cartridges): plain alpha blending with a clearcoat sheen, never
   * `transmission` (a transmissive material makes three.js re-render the whole scene into an extra buffer every
   * frame). Without depth writes they stay order-independent, so static batching can merge them.
   */
  polycarbonate: () =>
    cached('x-pc', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xdff3ff, roughness: 0.05, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.05,
        transparent: true, opacity: 0.45, depthWrite: false,
      }),
    ),
  lens: () =>
    cached('x-lens', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xd7f3ff, roughness: 0.05, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.05,
        transparent: true, opacity: 0.72, depthWrite: false,
      }),
    ),
  /** "not installed / removable" ghost material (see-through, cool tint) */
  ghost: () =>
    cached('x-ghost', () =>
      new THREE.MeshStandardMaterial({ color: 0x9fc7ff, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.22, depthWrite: false }),
    ),
  ghostEdge: () => cached('x-ghostEdge', () => new THREE.LineBasicMaterial({ color: 0x9fc7ff, transparent: true, opacity: 0.55 })),
  vessel: () =>
    cached('x-vessel', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, metalness: 0.2, roughness: 0.25, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    ),
  vesselEdge: () => cached('x-vesselEdge', () => new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.6 })),
  /** inside of the cut-away flight tube */
  tubeInside: () => std('tubeIn', 0x2a3443, 0.8, 0.2, { side: THREE.BackSide }),
  tubeOutside: () => std('tubeOut', 0xc5cdd6, 0.35, 0.7, { side: THREE.FrontSide }),
};

export function box(w: number, h: number, d: number, m: THREE.Material, r = 0.01): THREE.Mesh {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  return new THREE.Mesh(rr > 0.0005 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d), m);
}

/** Cylinder with its axis along Y. */
export function cyl(r: number, h: number, m: THREE.Material, seg = 28, open = false): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg, 1, open), m);
}

/** Cylinder with its axis along X (beam direction). */
export function cylX(r: number, len: number, m: THREE.Material, seg = 24): THREE.Mesh {
  const c = cyl(r, len, m, seg);
  c.rotation.z = Math.PI / 2;
  return c;
}

/** Cylinder with its axis along Z (across the beam). */
export function cylZ(r: number, len: number, m: THREE.Material, seg = 24): THREE.Mesh {
  const c = cyl(r, len, m, seg);
  c.rotation.x = Math.PI / 2;
  return c;
}

/** Support pedestal from the floor (y = -beamY) up to `topY` (beam frame). */
export function pedestal(beamY: number, topY: number, w: number, d: number, m: THREE.Material = xm.granite()): THREE.Mesh {
  const h = Math.max(0.05, topY + beamY);
  const s = box(w, h, d, m, 0.012);
  s.position.y = -beamY + h / 2;
  return s;
}

/** Thin vacuum pipe along X between local x0 and x1, at beam height. */
export function pipeX(x0: number, x1: number, r = 0.03, m: THREE.Material = xm.steel()): THREE.Mesh {
  const p = cylX(r, Math.abs(x1 - x0), m, 16);
  p.position.x = (x0 + x1) / 2;
  return p;
}

export function flangeX(x: number, r = 0.06, m: THREE.Material = xm.steel()): THREE.Mesh {
  const f = cylX(r, 0.022, m, 20);
  f.position.x = x;
  return f;
}

/** See-through vacuum vessel (box) with crisp edges. */
export function vesselBox(w: number, h: number, d: number, ghost = false): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const shell = new THREE.Mesh(geo, ghost ? xm.ghost() : xm.vessel());
  shell.renderOrder = 3;
  g.add(shell, new THREE.LineSegments(new THREE.EdgesGeometry(geo), ghost ? xm.ghostEdge() : xm.vesselEdge()));
  return g;
}

/** See-through vertical cylindrical vessel with steel rims. */
export function vesselCylY(r: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40, 1, true), xm.vessel());
  shell.renderOrder = 3;
  g.add(shell);
  for (const y of [-h / 2, h / 2]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 40), xm.steel());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    g.add(rim);
  }
  return g;
}

/** Optical table (top surface at `topY`, beam frame) on four legs. Centred on the local origin in x/z. */
export function opticalTable(beamY: number, lenX: number, widthZ: number, topY: number, thick = 0.3): THREE.Group {
  const g = new THREE.Group();
  const top = box(lenX, thick, widthZ, xm.tableTop(), 0.01);
  top.position.y = topY - thick / 2;
  g.add(top);
  const legH = beamY + topY - thick;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = box(0.16, legH, 0.16, xm.table(), 0.01);
      leg.position.set(sx * (lenX / 2 - 0.22), -beamY + legH / 2, sz * (widthZ / 2 - 0.18));
      g.add(leg);
    }
  return shadowed(g);
}

export function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      const mat = m.material as THREE.Material;
      m.castShadow = !mat.transparent;
      m.receiveShadow = true;
    }
  });
  return o;
}

/** Tube through a list of points (cables, cryo lines, water hoses). */
export function hose(points: THREE.Vector3[], r: number, m: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, points.length * 8), r, 8), m);
}

/** A straight strut between two points (truss members, rails). */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, seg = 8): THREE.Mesh {
  const d = b.clone().sub(a);
  const c = cyl(r, d.length(), m, seg);
  c.position.copy(a).addScaledVector(d, 0.5);
  c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return c;
}

/** Box beam between two points (rectangular section w × h, w across the horizontal). */
export function beamBetween(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, m: THREE.Material): THREE.Mesh {
  const d = b.clone().sub(a);
  const len = d.length();
  const mesh = box(len, h, w, m, Math.min(0.01, h / 3));
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
  return mesh;
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const reducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && (matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]test\b/.test(location.search));
