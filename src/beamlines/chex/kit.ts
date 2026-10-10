import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mats, glowMaterial, COLORS } from '../../scene/palette';

/**
 * Small modelling kit for the CHEX layout (local to this beamline; the shared parts library is not modified).
 * All sizes in metres. Part frame: origin on the beam axis, +X downstream, +Y up (0 = beam height), +Z outboard.
 */

const cache = new Map<string, THREE.Material>();
export function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}
const std = (key: string, p: THREE.MeshStandardMaterialParameters) => () => cached(`chex-${key}`, () => new THREE.MeshStandardMaterial(p));

export const M = {
  steel: () => mats.steel(),
  darkSteel: () => mats.darkSteel(),
  granite: () => mats.granite(),
  silicon: () => mats.silicon(),
  copper: () => mats.copper(),
  detector: () => mats.detector(),
  model: () => mats.model(),
  concrete: () => mats.concrete(),
  lead: std('lead', { color: 0x737c88, roughness: 0.62, metalness: 0.35 }),
  tungsten: std('w', { color: 0x4f5560, roughness: 0.38, metalness: 0.8 }),
  ss: std('ss', { color: 0xc3cad3, roughness: 0.48, metalness: 0.65 }), // matte enough not to bloom (as the engine's steel)
  alu: std('alu', { color: 0xc7ced8, roughness: 0.5, metalness: 0.6 }),
  blackAnod: std('anod', { color: 0x23272e, roughness: 0.55, metalness: 0.4 }),
  /** Huber/teal paint of the FDR Fig. 4.7 diffractometer concept */
  teal: std('teal', { color: 0x3fa597, roughness: 0.5, metalness: 0.25 }),
  tealDark: std('teal2', { color: 0x2b7a70, roughness: 0.55, metalness: 0.25 }),
  green: std('green', { color: 0x2f8f4e, roughness: 0.55, metalness: 0.2 }),
  gold: std('gold', { color: 0xcdb26a, roughness: 0.4, metalness: 0.6 }),
  yellow: std('yellow', { color: 0xd8b13a, roughness: 0.5, metalness: 0.3 }),
  orange: std('orange', { color: 0xd9822b, roughness: 0.55, metalness: 0.2 }),
  blue: std('blue', { color: 0x2f5f9e, roughness: 0.45, metalness: 0.5 }),
  cabinet: std('cab', { color: 0xb9c0c8, roughness: 0.7, metalness: 0.2 }),
  ln2: std('ln2', { color: 0xd9e1ea, roughness: 0.55, metalness: 0.45 }), // insulated LN2 hose: matte, no bloom
  rubber: std('rub', { color: 0x1c1f24, roughness: 0.9, metalness: 0 }),
  /**
   * Glassy materials are plain alpha-blended (no `transmission`: a transmissive material makes three.js render the
   * whole scene into an extra buffer every frame, which cost CHEX ~80 draw calls and a third of its frame rate).
   * A clearcoat gives the polished-crystal sheen; diamond keeps a faint glow so the small plate reads on the beam.
   */
  diamond: () =>
    cached('chex-diamond', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xeaf7ff, roughness: 0.05, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.05,
        transparent: true, opacity: 0.6, depthWrite: false, emissive: 0x7fd8ff, emissiveIntensity: 0.55,
      }),
    ),
  siCrystal: std('sicr', { color: 0xa9c2ec, roughness: 0.12, metalness: 0.4, emissive: 0x3d64b0, emissiveIntensity: 0.9 }),
  quartz: () =>
    cached('chex-quartz', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xf2f7ff, roughness: 0.05, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.05,
        transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide,
      }),
    ),
  /** hot susceptor / heater glow */
  hot: () => cached('chex-hot', () => glowMaterial(new THREE.Color(1.0, 0.45, 0.12), 3.2)),
  hotDim: std('hotdim', { color: 0x8a3b14, roughness: 0.5, metalness: 0.3, emissive: 0xff5a14, emissiveIntensity: 1.6 }),
  /** translucent vacuum-vessel shell (museum cut-away) */
  vessel: () =>
    cached('chex-vessel', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, metalness: 0.2, roughness: 0.25, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    ),
  vesselEdge: () => cached('chex-vedge', () => new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.6 })),
  hole: () => cached('chex-hole', () => new THREE.MeshBasicMaterial({ color: 0x050608 })),
  /** cut-away shells for long pipes, so the beam inside stays visible (museum convention, as for vacuum vessels) */
  leadGhost: () =>
    cached('chex-leadghost', () => new THREE.MeshStandardMaterial({ color: 0x8a939e, roughness: 0.6, metalness: 0.3, transparent: true, opacity: 0.42, depthWrite: false })),
  pipeGhost: () =>
    cached('chex-pipeghost', () => new THREE.MeshStandardMaterial({ color: 0xc9d0d8, roughness: 0.3, metalness: 0.6, transparent: true, opacity: 0.35, depthWrite: false })),
  bewindow: () =>
    cached('chex-bew', () => new THREE.MeshStandardMaterial({ color: 0xd7dde6, roughness: 0.3, metalness: 0.6, emissive: 0x2a3440, emissiveIntensity: 0.4 })),
  xray: () => cached('chex-xglow', () => glowMaterial(COLORS.xray, 4)),
  uv: () => cached('chex-uv', () => glowMaterial(new THREE.Color(0.62, 0.38, 1.0), 1.8)),
  plume: () =>
    cached('chex-plume', () =>
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.55, 1.0).multiplyScalar(1.6), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    ),
};

export const box = (w: number, h: number, d: number, m: THREE.Material, r = 0.004): THREE.Mesh =>
  new THREE.Mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01)) : new THREE.BoxGeometry(w, h, d), m);

export const cyl = (r: number, h: number, m: THREE.Material, seg = 24): THREE.Mesh => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);

/** Cylinder between two points. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material, seg = 12): THREE.Mesh {
  const d = b.clone().sub(a);
  const c = cyl(r, d.length(), m, seg);
  c.position.copy(a).addScaledVector(d, 0.5);
  c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return c;
}

/** Smooth tube through points (cables, gas lines, LN2 hoses). */
export function hose(pts: THREE.Vector3[], r: number, m: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, pts.length * 10), r, 8), m);
}

/** Horizontal pipe along +X from x0 to x1 (part frame). */
export function pipeX(x0: number, x1: number, r: number, m: THREE.Material = M.steel(), seg = 18): THREE.Mesh {
  const p = cyl(r, Math.abs(x1 - x0), m, seg);
  p.rotation.z = Math.PI / 2;
  p.position.x = (x0 + x1) / 2;
  return p;
}

export function flangeX(x: number, r: number, m: THREE.Material = M.steel()): THREE.Mesh {
  const f = cyl(r, 0.022, m, 24);
  f.rotation.z = Math.PI / 2;
  f.position.x = x;
  return f;
}

/** Support from the floor (y = −beamY) up to y = top, centred at (x, z). */
export function post(beamY: number, top: number, w: number, d: number, m: THREE.Material = M.granite(), x = 0, z = 0): THREE.Mesh {
  const h = Math.max(0.05, beamY + top);
  const b = box(w, h, d, m, 0.01);
  b.position.set(x, -beamY + h / 2, z);
  return b;
}

/** Translucent vessel box with crisp edges. */
export function vesselBox(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  g.add(new THREE.Mesh(geo, M.vessel()));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), M.vesselEdge()));
  return g;
}

export function vesselCyl(r: number, h: number, seg = 40): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg, 1, true), M.vessel()));
  const rimGeo = new THREE.TorusGeometry(r, 0.01, 6, seg);
  for (const y of [-h / 2, h / 2]) {
    const rim = new THREE.Mesh(rimGeo, M.steel());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    g.add(rim);
  }
  return g;
}

export function vesselSphere(r: number): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 36, 24), M.vessel()));
  const eq = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 48), M.steel());
  eq.rotation.x = Math.PI / 2;
  g.add(eq);
  return g;
}

export function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      const mat = m.material as THREE.Material;
      const transparent = Array.isArray(mat) ? false : mat.transparent;
      m.castShadow = !transparent;
      m.receiveShadow = true;
    }
  });
  return o;
}

/** Thin glowing rod (an X-ray / laser segment that belongs to a part). */
export function glowRod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh {
  return rod(a, b, r, m, 8);
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
