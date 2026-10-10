import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mats } from '../../scene/palette';

/**
 * Small geometry/material kit for the POLAR (4-ID) models. All builders work in the beamline frame:
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

export const pm = {
  steel: () => mats.steel(),
  darkSteel: () => mats.darkSteel(),
  copper: () => mats.copper(),
  silicon: () => mats.silicon(),
  mirror: () => mats.mirror(),
  granite: () => mats.granite(),
  detector: () => mats.detector(),
  model: () => mats.model(),
  /** Huber's turquoise anodising (the 4-ID-G diffractometer). */
  huber: () => cached('p-huber', () => new THREE.MeshStandardMaterial({ color: 0x2fa89c, roughness: 0.42, metalness: 0.35 })),
  huberLight: () => cached('p-huberL', () => new THREE.MeshStandardMaterial({ color: 0xc7d2d8, roughness: 0.38, metalness: 0.55 })),
  /** Cryogenic Ltd green cryostat (9-1-1 T magnet), slightly see-through so the coils and DAC show (museum cut-away). */
  cryoGreen: () =>
    cached('p-cryoGreen', () =>
      new THREE.MeshPhysicalMaterial({ color: 0x2f8f3f, roughness: 0.35, metalness: 0.3, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
    ),
  cryoGreenSolid: () => cached('p-cryoGreenS', () => new THREE.MeshStandardMaterial({ color: 0x2f8f3f, roughness: 0.4, metalness: 0.3 })),
  coil: () => cached('p-coil', () => new THREE.MeshStandardMaterial({ color: 0xd08a3c, roughness: 0.35, metalness: 0.7, emissive: 0x2a1404 })),
  coilSC: () => cached('p-coilSC', () => new THREE.MeshStandardMaterial({ color: 0x8f6ad8, roughness: 0.35, metalness: 0.5, emissive: 0x140828 })),
  yoke: () => cached('p-yoke', () => new THREE.MeshStandardMaterial({ color: 0x35557d, roughness: 0.5, metalness: 0.4 })),
  frameBlue: () => cached('p-frameBlue', () => new THREE.MeshStandardMaterial({ color: 0x24477a, roughness: 0.55, metalness: 0.35 })),
  safety: () => cached('p-safety', () => new THREE.MeshStandardMaterial({ color: 0xe0b52e, roughness: 0.55, metalness: 0.2 })),
  lead: () => cached('p-lead', () => new THREE.MeshStandardMaterial({ color: 0x5d6570, roughness: 0.7, metalness: 0.3 })),
  tungsten: () => cached('p-W', () => new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.35, metalness: 0.9 })),
  shutterYellow: () => cached('p-shutter', () => new THREE.MeshStandardMaterial({ color: 0xd9a531, roughness: 0.5, metalness: 0.3 })),
  black: () => cached('p-black', () => new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.55, metalness: 0.3 })),
  white: () => cached('p-white', () => new THREE.MeshStandardMaterial({ color: 0xe8ebef, roughness: 0.45, metalness: 0.2 })),
  rubber: () => cached('p-rubber', () => new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.9, metalness: 0 })),
  table: () => cached('p-table', () => new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.5 })),
  tableTop: () => cached('p-tableTop', () => new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.8 })),
  beryllium: () => cached('p-Be', () => new THREE.MeshStandardMaterial({ color: 0xb9c0c7, roughness: 0.3, metalness: 0.6 })),
  /**
   * DAC anvils. Plain alpha blending with a clearcoat sheen, never `transmission` (a transmissive material makes
   * three.js re-render the whole scene into an extra buffer every frame); ior 2.42 only raises the specular glint.
   */
  diamond: () =>
    cached('p-diamond', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xe9fbff, roughness: 0.05, metalness: 0, ior: 2.42, clearcoat: 0.6, clearcoatRoughness: 0.05,
        transparent: true, opacity: 0.78, depthWrite: false, emissive: 0x3aa8c8, emissiveIntensity: 0.55,
      }),
    ),
  ruby: () => cached('p-ruby', () => new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0xff1133, emissiveIntensity: 1.2, roughness: 0.2 })),
  sic: () => cached('p-sic', () => new THREE.MeshStandardMaterial({ color: 0x6aa26b, roughness: 0.15, metalness: 0.45 })),
  stripePt: () => cached('p-stripePt', () => new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.05, metalness: 1 })),
  stripeRh: () => cached('p-stripeRh', () => new THREE.MeshStandardMaterial({ color: 0xc7ccd6, roughness: 0.06, metalness: 1 })),
  stripePd: () => cached('p-stripePd', () => new THREE.MeshStandardMaterial({ color: 0xd5d0c5, roughness: 0.06, metalness: 1 })),
  stripeSi: () => cached('p-stripeSi', () => new THREE.MeshStandardMaterial({ color: 0x7f93b6, roughness: 0.05, metalness: 0.6 })),
  screen: () => cached('p-screen', () => new THREE.MeshStandardMaterial({ color: 0x0b1320, emissive: 0x3d7bd6, emissiveIntensity: 0.9, roughness: 0.4 })),
  /** translucent vacuum-vessel shell (cut-away), like the shared parts library */
  vessel: () =>
    cached('p-vessel', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, metalness: 0.2, roughness: 0.25, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    ),
  vesselEdge: () => cached('p-vesselEdge', () => new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.6 })),
  /** Bead-blasted stainless for big flat lids and base plates (the shared polished steel blooms when it faces the sun). */
  lid: () => cached('p-lid', () => new THREE.MeshStandardMaterial({ color: 0xa3adb8, roughness: 0.62, metalness: 0.45 })),
  /** Phase-retarder diamond, glowing faintly so the few-mm plates read inside their tank. */
  diamondHero: () =>
    cached('p-diamondHero', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xeefcff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.92, emissive: 0x9fdcff, emissiveIntensity: 1.25 }),
    ),
  railing: () => cached('p-rail', () => new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5, metalness: 0.3 })),
  tread: () => cached('p-tread', () => new THREE.MeshStandardMaterial({ color: 0x8c949e, roughness: 0.7, metalness: 0.5 })),
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

/** Annulus (coil / bearing) with its axis along X. */
export function ringX(rOut: number, rIn: number, len: number, m: THREE.Material, seg = 40): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: seg });
  geo.translate(0, 0, -len / 2);
  geo.rotateY(Math.PI / 2);
  return new THREE.Mesh(geo, m);
}

/**
 * Annulus along X with a wedge cut away (museum cut-away). The kept arc runs from `keepFrom` for `keepLen` radians, with
 * angle φ measured in the cross-section as (up = sin φ, inboard = cos φ), i.e. φ = 0 points inboard (−Z), φ = π/2 up.
 */
export function ringXCut(rOut: number, rIn: number, len: number, m: THREE.Material, keepFrom: number, keepLen: number, seg = 48): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOut, keepFrom, keepFrom + keepLen, false);
  shape.absarc(0, 0, rIn, keepFrom + keepLen, keepFrom, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: seg });
  geo.translate(0, 0, -len / 2);
  geo.rotateY(Math.PI / 2); // shape (x, y) → world (z = −x, y)
  return new THREE.Mesh(geo, m);
}

/** Annulus with its axis along Y. */
export function ringY(rOut: number, rIn: number, h: number, m: THREE.Material, seg = 40): THREE.Mesh {
  const r = ringX(rOut, rIn, h, m, seg);
  r.geometry.rotateZ(Math.PI / 2);
  return r;
}

/** Support pedestal from the floor (y = -beamY) up to `topY`. */
export function pedestal(beamY: number, topY: number, w: number, d: number, m: THREE.Material = pm.granite()): THREE.Mesh {
  const h = Math.max(0.05, topY + beamY);
  const s = box(w, h, d, m, 0.012);
  s.position.y = -beamY + h / 2;
  return s;
}

/** Thin vacuum pipe along X between x0 and x1 (local), at beam height. */
export function pipeX(x0: number, x1: number, r = 0.03, m: THREE.Material = pm.steel()): THREE.Mesh {
  const p = cylX(r, Math.abs(x1 - x0), m, 16);
  p.position.x = (x0 + x1) / 2;
  return p;
}

export function flangeX(x: number, r = 0.06, m: THREE.Material = pm.steel()): THREE.Mesh {
  const f = cylX(r, 0.022, m, 20);
  f.position.x = x;
  return f;
}

/** See-through vacuum vessel (box) with crisp edges. */
export function vesselBox(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const shell = new THREE.Mesh(geo, pm.vessel());
  shell.renderOrder = 3;
  g.add(shell, new THREE.LineSegments(new THREE.EdgesGeometry(geo), pm.vesselEdge()));
  return g;
}

/** See-through vacuum vessel with its top face left open (cut-away), crisp edges. */
export function vesselBoxOpenTop(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const none = cached('p-none', () => new THREE.MeshBasicMaterial({ visible: false }));
  // BoxGeometry face groups: +x, -x, +y, -y, +z, -z
  const shell = new THREE.Mesh(geo, [pm.vessel(), pm.vessel(), none, pm.vessel(), pm.vessel(), pm.vessel()]);
  shell.renderOrder = 3;
  g.add(shell, new THREE.LineSegments(new THREE.EdgesGeometry(geo), pm.vesselEdge()));
  return g;
}

/** See-through vertical cylindrical vessel with steel rims. */
export function vesselCylY(r: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40, 1, true), pm.vessel());
  shell.renderOrder = 3;
  g.add(shell);
  for (const y of [-h / 2, h / 2]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.01, 6, 40), pm.steel());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    g.add(rim);
  }
  return g;
}

/** Optical table (honeycomb top on four legs). Top surface at `topY` (beam frame). */
export function opticalTable(beamY: number, lenX: number, widthZ: number, topY: number, thick = 0.3): THREE.Group {
  const g = new THREE.Group();
  const top = box(lenX, thick, widthZ, pm.tableTop(), 0.01);
  top.position.y = topY - thick / 2;
  g.add(top);
  const legH = beamY + topY - thick;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = box(0.16, legH, 0.16, pm.table(), 0.01);
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

/**
 * Flat plate across the beam (normal along X) with a round hole on the beam axis, e.g. a magnet yoke plate the beam passes
 * through. Plate spans z ∈ [−w/2, w/2] and y ∈ [y0, y0 + h] in the beam frame; hole of radius r centred at y = 0, z = 0.
 */
export function boredPlateX(w: number, y0: number, h: number, t: number, r: number, m: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, y0);
  shape.lineTo(w / 2, y0);
  shape.lineTo(w / 2, y0 + h);
  shape.lineTo(-w / 2, y0 + h);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, r, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 24 });
  geo.translate(0, 0, -t / 2);
  geo.rotateY(Math.PI / 2);
  return new THREE.Mesh(geo, m);
}

export const reducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && (matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]test\b/.test(location.search));

/** Per-frame registration (the scene's ctx.onFrame: called with dt and elapsed seconds, removed on dispose). */
export type FrameHook = (fn: (dt: number, t: number) => void) => void;
