import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mats } from '../../scene/palette';

/**
 * Geometry/material kit for the 9-ID CSSI models. Builders work in the beamline frame:
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
  cached(`cssi-${key}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));

export const cm = {
  steel: () => mats.steel(),
  darkSteel: () => mats.darkSteel(),
  copper: () => mats.copper(),
  silicon: () => mats.silicon(),
  mirror: () => mats.mirror(),
  granite: () => mats.granite(),
  detector: () => mats.detector(),
  /** speckled black granite tops (air-bearing granites in 9-ID-D) */
  graniteTop: () => std('graniteTop', 0x3a3f47, 0.55, 0.1),
  lead: () => std('lead', 0x5d6570, 0.7, 0.3),
  tungsten: () => std('W', 0x3a3f47, 0.35, 0.9),
  white: () => std('white', 0xe6e9ed, 0.45, 0.15),
  black: () => std('black', 0x14181e, 0.55, 0.3),
  alu: () => std('alu', 0xc5cdd6, 0.35, 0.7),
  aluDark: () => std('aluD', 0x8f99a5, 0.4, 0.7),
  table: () => std('table', 0x2c3138, 0.6, 0.5),
  tableTop: () => std('tableTop', 0x9aa3ad, 0.35, 0.8),
  frame: () => std('frame', 0x6f7a87, 0.5, 0.55),
  safety: () => std('safety', 0xe0b52e, 0.55, 0.2),
  shutterYellow: () => std('shutter', 0xd9a531, 0.5, 0.3),
  magnetRed: () => std('magR', 0xc94b4b, 0.45, 0.4),
  magnetBlue: () => std('magB', 0x3c6fd1, 0.45, 0.4),
  magnetGreen: () => std('magG', 0x3fa36a, 0.45, 0.4),
  pole: () => std('pole', 0x9aa6b4, 0.35, 0.8),
  frameBlue: () => std('frameBlue', 0x3f6f9a, 0.6, 0.3),
  pt: () => std('pt', 0xeef1f4, 0.04, 1.0),
  hose: () => std('hose', 0xe6edf5, 0.3, 0.7),
  waterHose: () => std('waterHose', 0x3b82c4, 0.5, 0.1),
  cable: () => std('cable', 0x1d232b, 0.8, 0.1),
  /** Aerotech-style black anodised hexapod parts */
  anodBlack: () => std('anodBlack', 0x23272e, 0.4, 0.5),
  /** Grand Tube: light-grey painted stainless vessel (APS photo) and its darker inside */
  tubePaint: () => std('tubePaint', 0xd3d8de, 0.55, 0.25),
  tubeRing: () => std('tubeRing', 0xb7bec7, 0.45, 0.4),
  tubeInside: () => std('tubeIn', 0x8a95a3, 0.5, 0.45, { side: THREE.BackSide }),
  tubeCut: () => std('tubeCut', 0x8e98a4, 0.6, 0.3),
  saddle: () => std('saddle', 0x55606d, 0.6, 0.4),
  rail: () => std('rail', 0xaab4bf, 0.3, 0.85),
  dragChain: () => std('drag', 0x2a2f36, 0.7, 0.2),
  pilatusBlue: () => std('pilatus', 0x2f5e9e, 0.45, 0.35),
  eigerGrey: () => std('eiger', 0xd0d5db, 0.45, 0.3),
  beryllium: () => std('Be', 0xb9c0c7, 0.3, 0.6),
  /**
   * Clear optics (Be lenses, sample-cell window): plain alpha blending with a clearcoat sheen, never `transmission`
   * (a transmissive material makes three.js re-render the whole scene into an extra buffer every frame). Without
   * depth writes they stay order-independent, so static batching can merge them.
   */
  lens: () =>
    cached('cssi-lens', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xd7f3ff, roughness: 0.05, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.05,
        transparent: true, opacity: 0.72, depthWrite: false,
      }),
    ),
  window: () =>
    cached('cssi-window', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xbfe9ff, roughness: 0.05, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.05,
        transparent: true, opacity: 0.6, depthWrite: false,
      }),
    ),
  ghost: () =>
    cached('cssi-ghost', () =>
      new THREE.MeshStandardMaterial({ color: 0x9fc7ff, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.12, depthWrite: false }),
    ),
  ghostEdge: () => cached('cssi-ghostEdge', () => new THREE.LineBasicMaterial({ color: 0x9fc7ff, transparent: true, opacity: 0.6 })),
  vessel: () =>
    cached('cssi-vessel', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, metalness: 0.2, roughness: 0.25, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    ),
  vesselEdge: () => cached('cssi-vesselEdge', () => new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.6 })),
};

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

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
export function pedestal(beamY: number, topY: number, w: number, d: number, m: THREE.Material = cm.granite()): THREE.Mesh {
  const h = Math.max(0.05, topY + beamY);
  const s = box(w, h, d, m, 0.012);
  s.position.y = -beamY + h / 2;
  return s;
}

/** Thin vacuum pipe along X between local x0 and x1 at height y / side z. */
export function pipeX(x0: number, x1: number, r = 0.03, m: THREE.Material = cm.steel(), y = 0, z = 0): THREE.Mesh {
  const p = cylX(r, Math.abs(x1 - x0), m, 16);
  p.position.set((x0 + x1) / 2, y, z);
  return p;
}

export function flangeX(x: number, r = 0.06, m: THREE.Material = cm.steel(), y = 0, z = 0): THREE.Mesh {
  const f = cylX(r, 0.022, m, 20);
  f.position.set(x, y, z);
  return f;
}

/** See-through vacuum vessel (box) with crisp edges. */
export function vesselBox(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const shell = new THREE.Mesh(geo, cm.vessel());
  shell.renderOrder = 3;
  g.add(shell, new THREE.LineSegments(new THREE.EdgesGeometry(geo), cm.vesselEdge()));
  return g;
}

/** See-through vertical cylindrical vessel with steel rims. */
export function vesselCylY(r: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48, 1, true), cm.vessel());
  shell.renderOrder = 3;
  g.add(shell);
  for (const y of [-h / 2, h / 2]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 6, 48), cm.steel());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    g.add(rim);
  }
  return g;
}

/** Optical table (top surface at `topY`, beam frame) on four legs. Centred on the local origin in x/z. */
export function opticalTable(beamY: number, lenX: number, widthZ: number, topY: number, thick = 0.25): THREE.Group {
  const g = new THREE.Group();
  const top = box(lenX, thick, widthZ, cm.tableTop(), 0.01);
  top.position.y = topY - thick / 2;
  g.add(top);
  const legH = beamY + topY - thick;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = box(0.14, legH, 0.14, cm.table(), 0.01);
      leg.position.set(sx * (lenX / 2 - 0.2), -beamY + legH / 2, sz * (widthZ / 2 - 0.16));
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

/** A straight strut between two points. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, seg = 8): THREE.Mesh {
  const d = b.clone().sub(a);
  const c = cyl(r, d.length(), m, seg);
  c.position.copy(a).addScaledVector(d, 0.5);
  c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return c;
}

/** Ghost (not-installed) box outline. */
export function ghostBox(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, cm.ghost());
  m.renderOrder = 3;
  g.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(geo), cm.ghostEdge()));
  return g;
}

/**
 * Text/diagram card drawn on a canvas, as a camera-facing sprite: unlike a CSS label (ctx.addLabel) it scales with
 * distance and is occluded like the rest of the diorama, so it reads as part of the model.
 */
export function canvasCard(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void, worldWidth: number): THREE.Sprite {
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(worldWidth, (worldWidth * h) / w, 1);
  s.renderOrder = 10;
  return s;
}

/** Rounded rectangle path helper for canvas cards. */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
