import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mats, glowMaterial, COLORS } from '../../scene/palette';

/**
 * Small modelling kit for the ISN layout (local to this beamline; the shared parts library is not modified).
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
const std = (key: string, p: THREE.MeshStandardMaterialParameters) => () => cached(`isn-${key}`, () => new THREE.MeshStandardMaterial(p));

export const M = {
  steel: () => mats.steel(),
  darkSteel: () => mats.darkSteel(),
  granite: () => mats.granite(),
  silicon: () => mats.silicon(),
  copper: () => mats.copper(),
  detector: () => mats.detector(),
  concrete: () => mats.concrete(),
  mirror: () => mats.mirror(),
  lead: std('lead', { color: 0x737c88, roughness: 0.62, metalness: 0.35 }),
  tungsten: std('w', { color: 0x4f5560, roughness: 0.38, metalness: 0.8 }),
  alu: std('alu', { color: 0xc7ced8, roughness: 0.42, metalness: 0.75 }),
  blackAnod: std('anod', { color: 0x23272e, roughness: 0.55, metalness: 0.4 }),
  /** blue pedestals / posts of the endstation drawing (MEDSI'25 Fig. 3) */
  bluePost: std('bpost', { color: 0x2f6f9e, roughness: 0.5, metalness: 0.35 }),
  /** green robot / ptychography table paint (MEDSI'25 Fig. 3) */
  green: std('green', { color: 0x4fbf3a, roughness: 0.55, metalness: 0.15 }),
  greenDark: std('green2', { color: 0x2f7a24, roughness: 0.6, metalness: 0.15 }),
  /** orange 7-element SDD body, pink backscatter SDD, purple microscope (MEDSI'25 Fig. 4 colour coding) */
  orange: std('orange', { color: 0xe9875a, roughness: 0.5, metalness: 0.3 }),
  orangeDark: std('orange2', { color: 0xc96a40, roughness: 0.45, metalness: 0.4 }),
  pink: std('pink', { color: 0xe76bd0, roughness: 0.45, metalness: 0.3 }),
  purple: std('purple', { color: 0x8a4fd8, roughness: 0.45, metalness: 0.3 }),
  invar: std('invar', { color: 0x3c8f8a, roughness: 0.5, metalness: 0.45 }),
  yellow: std('yellow', { color: 0xd9a531, roughness: 0.5, metalness: 0.3 }),
  ln2: std('ln2', { color: 0xe6edf5, roughness: 0.3, metalness: 0.7 }),
  platinum: std('pt', { color: 0xe9e4da, roughness: 0.06, metalness: 1.0 }),
  multilayer: std('ml', { color: 0x9a7fd1, roughness: 0.15, metalness: 0.55 }),
  beige: std('beige', { color: 0xcdb48e, roughness: 0.7, metalness: 0.05 }),
  be: std('be', { color: 0xbfc6cc, roughness: 0.35, metalness: 0.6, transparent: true, opacity: 0.7 }),
  /** supply air sock (purple) and exhaust duct (green) keep MEDSI'25 Fig. 2a's colour coding, muted so the instrument stays the focus */
  sock: () =>
    cached('isn-sock', () => new THREE.MeshStandardMaterial({ color: 0x9a7cb4, roughness: 0.95, transparent: true, opacity: 0.3, depthWrite: false })),
  exhaust: () =>
    cached('isn-exh', () => new THREE.MeshStandardMaterial({ color: 0x739f7c, roughness: 0.9, transparent: true, opacity: 0.28, depthWrite: false })),
  /**
   * Window material: plain alpha blending with a clearcoat sheen, no `transmission` (a transmissive material makes
   * three.js render the whole scene into an extra buffer every frame: ~120 draw calls and nearly half the frame rate here).
   */
  diamond: () =>
    cached('isn-diamond', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xe8f6ff, roughness: 0.05, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.05,
        transparent: true, opacity: 0.6, depthWrite: false, emissive: 0x9fdcff, emissiveIntensity: 0.25,
      }),
    ),
  crystal: std('xtal', { color: 0xa9c2ec, roughness: 0.12, metalness: 0.4, emissive: 0x3d64b0, emissiveIntensity: 0.6 }),
  sample: std('sample', { color: 0xc2c9d2, roughness: 0.25, metalness: 0.9, emissive: 0xf472b6, emissiveIntensity: 0.6 }),
  laser: () => cached('isn-laser', () => glowMaterial(0xff3b3b, 3, 0.85)),
  /** translucent vacuum-vessel shell (museum cut-away); fairly rough so the key light does not bloom off it in close-ups */
  vessel: () =>
    cached('isn-vessel', () =>
      new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, metalness: 0.05, roughness: 0.6, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    ),
  vesselEdge: () => cached('isn-vedge', () => new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.6 })),
  ghostEdge: () => cached('isn-gedge', () => new THREE.LineBasicMaterial({ color: 0x8796a8, transparent: true, opacity: 0.4 })),
  hole: () => cached('isn-hole', () => new THREE.MeshBasicMaterial({ color: 0x050608 })),
  floor: std('floor', { color: 0x1d2736, roughness: 0.95 }),
  floorLight: std('floor2', { color: 0x263347, roughness: 0.95 }),
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

/** Square-section bar between two points. */
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

/** Translucent box-shaped vessel with crisp edges, centred at the origin. */
export function vesselBox(w: number, h: number, d: number, edge: THREE.LineBasicMaterial = M.vesselEdge()): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  const shell = new THREE.Mesh(geo, M.vessel());
  shell.renderOrder = 3;
  g.add(shell, new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge));
  return g;
}

/** Translucent vessel spanning explicit corners. */
export function vesselSpan(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.Group {
  const v = vesselBox(x1 - x0, y1 - y0, z1 - z0);
  v.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return v;
}

/** Beam-pipe flange (disc normal to X). */
export function flangeX(r: number, m: THREE.Material = M.steel(), t = 0.02): THREE.Mesh {
  const f = cyl(r, t, m, 24);
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
      const seeThrough = mat.transparent && (mat as THREE.MeshStandardMaterial).opacity < 0.6;
      m.castShadow = cast && !seeThrough;
      m.receiveShadow = !seeThrough;
    }
  });
  return o;
}

/** Pixel-detector face texture (module grid + a pattern), cached per style. */
const faceCache = new Map<string, THREE.MeshStandardMaterial>();
export function detectorFace(style: 'speckle' | 'spots' | 'blank', color = '#f472b6'): THREE.MeshStandardMaterial {
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
  for (let i = 0; i <= 2; i++) {
    g.beginPath();
    g.moveTo(0, i * 128);
    g.lineTo(256, i * 128);
    g.moveTo(i * 128, 0);
    g.lineTo(i * 128, 256);
    g.stroke();
  }
  g.globalCompositeOperation = 'lighter';
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (style === 'speckle') {
    // far-field ptychography pattern: bright central disc (the KB pupil, a square-ish aperture) + speckle
    const grd = g.createRadialGradient(128, 128, 2, 128, 128, 120);
    grd.addColorStop(0, color + 'ff');
    grd.addColorStop(0.2, color + '77');
    grd.addColorStop(1, color + '00');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#ffffff';
    g.fillRect(118, 118, 20, 20);
    for (let i = 0; i < 700; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 0.9) * 120;
      g.fillStyle = color + Math.floor(40 + rnd() * 150).toString(16).padStart(2, '0');
      g.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 2 + rnd() * 2, 2 + rnd() * 2);
    }
  } else if (style === 'spots') {
    for (let i = 0; i < 9; i++) {
      const x = 30 + rnd() * 196;
      const y = 30 + rnd() * 196;
      for (let k = 4; k >= 1; k--) {
        g.fillStyle = color + Math.floor(30 + (5 - k) * 40).toString(16).padStart(2, '0');
        g.beginPath();
        g.arc(x, y, k * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.strokeStyle = color + '55';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(-60, 300, 300, -Math.PI / 2, 0);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: style === 'blank' ? 0.4 : 1.0, roughness: 0.5 });
  faceCache.set(key, m);
  return m;
}

/**
 * Compact pixel-detector head (e.g. EIGER2 X 1M: 77 × 80 mm active area) with its sensitive face pointing to −X of its
 * own group (upstream when unrotated). w × h is the active area; depth is the housing depth behind the face.
 */
export function detectorHead(w: number, h: number, depth: number, face: THREE.Material, housing: THREE.Material = M.detector()): THREE.Group {
  const g = new THREE.Group();
  const shell = boxSpan(0, depth, -h / 2 - 0.02, h / 2 + 0.03, -w / 2 - 0.02, w / 2 + 0.02, housing, 0.01);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(w, h), face);
  f.rotation.y = -Math.PI / 2;
  f.position.x = -0.003;
  const fins = boxSpan(depth * 0.35, depth * 0.95, -h * 0.35, h * 0.35, w / 2 + 0.02, w / 2 + 0.035, M.darkSteel(), 0.003);
  g.add(shell, f, fins);
  return g;
}

/** Orient an object so its local −X axis points along `dir` (used for detectors whose face is at −X). */
export function faceToward(o: THREE.Object3D, dir: THREE.Vector3): void {
  o.quaternion.setFromUnitVectors(new THREE.Vector3(-1, 0, 0), dir.clone().normalize());
}
