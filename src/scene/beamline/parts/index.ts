import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mats, glowMaterial, COLORS, markShared } from '../../palette';

/**
 * Parametric component models. Every builder returns a group whose origin sits ON the beam axis at the
 * component's position; local +X is downstream, +Y up, +Z to the outboard side. Sizes are realistic
 * (metres) so the scene can be explored at true scale.
 */
export interface PartOptions {
  color?: string;
  specs?: Record<string, string | number>;
  deflection?: string;
  name?: string;
  /** Beam height above the floor (for stands). */
  beamY: number;
}

export type PartBuilder = (o: PartOptions) => THREE.Group;

const box = (w: number, h: number, d: number, m: THREE.Material, r = 0.02) =>
  new THREE.Mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d), m);
const cyl = (r: number, h: number, m: THREE.Material, seg = 28) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

/** Granite/steel support stand from the floor up to just below the device. */
function stand(beamY: number, topBelow: number, w = 0.6, d = 0.6, m: THREE.Material = mats.granite()): THREE.Mesh {
  const hgt = Math.max(0.1, beamY - topBelow);
  const s = box(w, hgt, d, m, 0.015);
  s.position.y = -beamY + hgt / 2;
  return s;
}

/** Semi-transparent vacuum vessel shell so the optic inside stays visible (museum cut-away). */
function vesselMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xcfd8e3,
    metalness: 0.2,
    roughness: 0.25,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
    // single pass: a two-pass (back, front) transparent material re-resolves its shader program every frame
    forceSinglePass: true,
  });
}
const vesselMat = markShared(vesselMaterial());
const vesselEdge = markShared(new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.6 }));

/**
 * Clear optics (windows, lenses, diamonds) are alpha-blended with a clearcoat sheen, never `transmission`: one
 * transmissive material makes three.js re-render every opaque object into an extra MSAA buffer each frame
 * (BeamlineScene also strips transmission from any layout material that still sets it).
 */
function glass(color: number, opacity: number, emissive = 0x000000, emissiveIntensity = 0): THREE.MeshPhysicalMaterial {
  return markShared(
    new THREE.MeshPhysicalMaterial({
      color, roughness: 0.05, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.05,
      transparent: true, opacity, depthWrite: false, emissive, emissiveIntensity,
    }),
  );
}
const windowGlass = glass(0xbfe9ff, 0.6);
const lensGlass = glass(0xd7f3ff, 0.72);
const diamondGlass = glass(0xeaf7ff, 0.62, 0x7fd8ff, 0.35);

function vesselBox(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  g.add(new THREE.Mesh(geo, vesselMat));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), vesselEdge));
  return g;
}

function vesselCyl(r: number, h: number, horizontal = false): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(r, r, h, 32, 1, true);
  const m = new THREE.Mesh(geo, vesselMat);
  g.add(m);
  const rimGeo = new THREE.TorusGeometry(r, 0.012, 6, 40);
  for (const y of [-h / 2, h / 2]) {
    const rim = new THREE.Mesh(rimGeo, mats.steel());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    g.add(rim);
  }
  if (horizontal) g.rotation.z = Math.PI / 2;
  return g;
}

function pipe(len: number, r = 0.035): THREE.Mesh {
  const p = cyl(r, len, mats.steel(), 16);
  p.rotation.z = Math.PI / 2;
  return p;
}

function flange(r = 0.08): THREE.Mesh {
  const f = cyl(r, 0.03, mats.steel(), 20);
  f.rotation.z = Math.PI / 2;
  return f;
}

// ------------------------------------------------------------------ sources

export function undulator(o: PartOptions & { lengthM?: number; periodMm?: number; superconducting?: boolean; helical?: boolean }): THREE.Group {
  const g = new THREE.Group();
  const L = o.lengthM ?? 4.6;
  if (o.superconducting) {
    // Cryostat vessel with the magnet inside, cut-away window on the outboard side.
    const cryo = cyl(0.42, L, new THREE.MeshStandardMaterial({ color: 0x9fb2c6, metalness: 0.6, roughness: 0.35 }), 40);
    cryo.rotation.z = Math.PI / 2;
    cryo.scale.set(1, 1, 0.85);
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.43, 0.43, L * 0.8, 40, 1, true, -Math.PI * 0.2, Math.PI * 0.4),
      new THREE.MeshStandardMaterial({ color: 0x5b6b7c, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }),
    );
    shell.rotation.z = Math.PI / 2;
    g.add(cryo, shell);
    const coil = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.06, 0.12), mats.copper(), Math.min(400, Math.floor(L / 0.02)));
    const d = new THREE.Object3D();
    for (let i = 0; i < coil.count; i++) {
      d.position.set(-L * 0.4 + (i / coil.count) * L * 0.8, i % 2 ? 0.05 : -0.05, 0.36);
      d.updateMatrix();
      coil.setMatrixAt(i, d.matrix);
    }
    g.add(coil);
    g.add(stand(o.beamY, 0.45, 0.9, 0.7));
  } else {
    // Hybrid permanent-magnet undulator: two magnet arrays (jaws) on a C-frame strongback.
    const nBlocks = Math.min(320, Math.round((L * 1000) / ((o.periodMm ?? 28) / 2)));
    const blockW = L / nBlocks;
    const jawMatA = new THREE.MeshStandardMaterial({ color: 0xc94b4b, roughness: 0.45, metalness: 0.4 });
    const jawMatB = new THREE.MeshStandardMaterial({ color: 0x3c6fd1, roughness: 0.45, metalness: 0.4 });
    for (const [y, mat] of [[0.075, jawMatA], [-0.075, jawMatB]] as const) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(blockW * 0.92, 0.11, 0.12), mat, nBlocks);
      const im2 = new THREE.InstancedMesh(new THREE.BoxGeometry(blockW * 0.92, 0.11, 0.12), mats.steel(), nBlocks);
      const d = new THREE.Object3D();
      let a = 0;
      let b = 0;
      for (let i = 0; i < nBlocks; i++) {
        d.position.set(-L / 2 + (i + 0.5) * blockW, y + Math.sign(y) * 0.055, 0);
        d.updateMatrix();
        if (i % 2 === 0) im.setMatrixAt(a++, d.matrix);
        else im2.setMatrixAt(b++, d.matrix);
      }
      im.count = a;
      im2.count = b;
      g.add(im, im2);
      const strong = box(L, 0.16, 0.34, mats.darkSteel(), 0.02);
      strong.position.set(0, y + Math.sign(y) * 0.2, 0);
      g.add(strong);
    }
    const frame = box(L * 0.92, 1.0, 0.26, new THREE.MeshStandardMaterial({ color: 0x3f6f9a, roughness: 0.6, metalness: 0.3 }), 0.03);
    frame.position.set(0, 0, 0.45);
    g.add(frame);
    g.add(stand(o.beamY, 0.55, L * 0.7, 0.9, mats.darkSteel()));
  }
  // vacuum chamber + electron beam through the gap
  const e = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, L + 1.2, 6), glowMaterial(COLORS.electron, 5));
  e.rotation.z = Math.PI / 2;
  g.add(e);
  return shadowed(g);
}

// ------------------------------------------------------------------ beam-conditioning

export function frontEnd(o: PartOptions): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.8, 0.45, 0.45, mats.copper(), 0.03);
  g.add(body, pipe(1.6), stand(o.beamY, 0.23, 0.5, 0.5));
  return shadowed(g);
}

export function shutter(o: PartOptions): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.5, 0.75, 0.5, new THREE.MeshStandardMaterial({ color: 0xd9a531, roughness: 0.5, metalness: 0.3 }), 0.03);
  body.position.y = 0.15;
  const cap = box(0.52, 0.06, 0.52, mats.darkSteel(), 0.01);
  cap.position.y = 0.55;
  g.add(body, cap, pipe(0.9), stand(o.beamY, 0.23, 0.45, 0.45));
  return shadowed(g);
}

export function slits(o: PartOptions): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 4), mats.darkSteel());
  frame.rotation.y = Math.PI / 2;
  frame.rotation.x = Math.PI / 4;
  g.add(frame);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.9, roughness: 0.3 });
  for (const [y, z] of [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]]) {
    const b = box(0.04, y ? 0.07 : 0.03, z ? 0.07 : 0.03, bladeMat, 0);
    b.position.set(0, y * 1.5, z * 1.5);
    g.add(b);
  }
  g.add(pipe(0.5, 0.03), stand(o.beamY, 0.2, 0.3, 0.3));
  return shadowed(g);
}

export function windowPart(o: PartOptions): THREE.Group {
  const g = new THREE.Group();
  g.add(flange(0.09));
  const w = cyl(0.03, 0.004, windowGlass, 20);
  w.rotation.z = Math.PI / 2;
  g.add(w, pipe(0.4, 0.03), stand(o.beamY, 0.1, 0.2, 0.2));
  return shadowed(g);
}

export function filterPart(o: PartOptions): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.3, 0.4, 0.3, mats.steel(), 0.02);
  body.position.y = 0.12;
  g.add(body, pipe(0.6, 0.03), stand(o.beamY, 0.1, 0.25, 0.25));
  for (let i = 0; i < 4; i++) {
    const act = cyl(0.025, 0.18, mats.darkSteel(), 10);
    act.position.set(-0.1 + i * 0.065, 0.42, 0);
    g.add(act);
  }
  return shadowed(g);
}

export function diagnostics(o: PartOptions): THREE.Group {
  const g = new THREE.Group();
  const cross = box(0.22, 0.22, 0.22, mats.steel(), 0.02);
  const cam = cyl(0.04, 0.16, mats.detector(), 16);
  cam.position.set(0, 0, 0.19);
  cam.rotation.x = Math.PI / 2;
  g.add(cross, cam, pipe(0.5, 0.03), stand(o.beamY, 0.11, 0.2, 0.2));
  return shadowed(g);
}

// ------------------------------------------------------------------ optics

/** Long mirror in a cut-away vacuum vessel; deflection sets the mirror orientation. */
export function mirror(o: PartOptions & { lengthM?: number }): THREE.Group {
  const g = new THREE.Group();
  const L = o.lengthM ?? 1.0;
  const vertical = (o.deflection ?? '').startsWith('vert');
  const v = vesselBox(L + 0.35, 0.5, 0.5);
  g.add(v);
  const sub = box(L, 0.07, 0.07, mats.silicon(), 0.005);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.98, 0.05), mats.mirror());
  if (vertical) {
    // vertically deflecting: reflecting face up, substrate below beam
    sub.position.y = -0.04;
    face.rotation.x = -Math.PI / 2;
    face.position.y = -0.004;
  } else {
    // horizontally deflecting: reflecting face toward the beam from the inboard side
    sub.scale.set(1, 1.6, 1);
    sub.position.z = -0.04;
    face.position.z = -0.004;
  }
  g.add(sub, face);
  const benderMat = mats.darkSteel();
  for (const s of [-1, 1]) {
    const b = box(0.08, 0.16, 0.16, benderMat, 0.01);
    b.position.set((s * L) / 2, vertical ? -0.1 : 0, vertical ? 0 : -0.1);
    g.add(b);
  }
  const base = box(L + 0.5, 0.12, 0.7, mats.steel(), 0.02);
  base.position.y = -0.31;
  g.add(base, stand(o.beamY, 0.37, L * 0.6, 0.6));
  g.add(flangePair(L + 0.35));
  return shadowed(g);
}

function flangePair(len: number): THREE.Group {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const f = flange(0.08);
    f.position.x = (s * len) / 2;
    const p = pipe(0.35, 0.035);
    p.position.x = (s * (len + 0.35)) / 2;
    g.add(f, p);
  }
  return g;
}

/** Double-crystal monochromator: cylindrical tank, two crystals on a rotation stage, cryo lines. */
export function monochromator(o: PartOptions & { multilayer?: boolean; cryo?: boolean }): THREE.Group {
  const g = new THREE.Group();
  const tank = vesselCyl(0.45, 0.9);
  tank.position.y = 0.05;
  g.add(tank);
  const lid = cyl(0.47, 0.05, mats.steel(), 36);
  lid.position.y = 0.52;
  const bottom = cyl(0.47, 0.06, mats.steel(), 36);
  bottom.position.y = -0.42;
  g.add(lid, bottom);
  const crystalMat = o.multilayer ? new THREE.MeshStandardMaterial({ color: 0x9a7fd1, roughness: 0.15, metalness: 0.5 }) : mats.silicon();
  const c1 = box(0.16, 0.05, 0.08, crystalMat, 0.004);
  c1.position.set(-0.08, -0.03, 0);
  c1.rotation.z = 0.18;
  const c2 = box(0.16, 0.05, 0.08, crystalMat, 0.004);
  c2.position.set(0.1, 0.06, 0);
  c2.rotation.z = 0.18;
  const holder1 = box(0.18, 0.06, 0.12, mats.copper(), 0.005);
  holder1.position.set(-0.08, -0.085, 0);
  holder1.rotation.z = 0.18;
  const holder2 = box(0.18, 0.06, 0.12, mats.copper(), 0.005);
  holder2.position.set(0.1, 0.115, 0);
  holder2.rotation.z = 0.18;
  g.add(c1, c2, holder1, holder2);
  if (o.cryo !== false) {
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe6edf5, roughness: 0.3, metalness: 0.7 });
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.55, 0),
      new THREE.Vector3(0, 1.0, 0.1),
      new THREE.Vector3(0, 1.3, 0.8),
      new THREE.Vector3(0, 1.2, 1.6),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.035, 8), lineMat));
  }
  g.add(flangePair(0.95), stand(o.beamY, 0.45, 0.8, 0.8));
  return shadowed(g);
}

/** Compound refractive lenses / transfocator: a row of lens cartridges. */
export function crl(o: PartOptions & { cartridges?: number }): THREE.Group {
  const g = new THREE.Group();
  const n = o.cartridges ?? 8;
  const housing = vesselBox(0.16 + n * 0.07, 0.36, 0.3);
  g.add(housing);
  for (let i = 0; i < n; i++) {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10), lensGlass);
    lens.scale.set(0.35, 1, 1);
    lens.position.x = -((n - 1) * 0.07) / 2 + i * 0.07;
    const act = cyl(0.012, 0.16, mats.darkSteel(), 8);
    act.position.set(lens.position.x, 0.1, 0);
    g.add(lens, act);
  }
  g.add(pipe(0.3 + n * 0.07, 0.02), stand(o.beamY, 0.18, 0.3, 0.3));
  return shadowed(g);
}

/** Kirkpatrick–Baez pair: a vertically- then a horizontally-focusing mirror, bent to elliptical shape. */
export function kbMirror(o: PartOptions & { lengthM?: number; compact?: boolean }): THREE.Group {
  const g = new THREE.Group();
  const L = o.lengthM ?? (o.compact ? 0.12 : 0.35);
  const vessel = vesselBox(L * 2 + 0.5, 0.42, 0.42);
  g.add(vessel);
  const m1 = box(L, 0.04, 0.04, mats.silicon(), 0.003);
  m1.position.set(-L / 2 - 0.05, -0.03, 0);
  const m2 = box(L * 0.8, 0.04, 0.04, mats.silicon(), 0.003);
  m2.position.set(L / 2 + 0.05, 0, -0.03);
  m2.rotation.x = Math.PI / 2;
  // gentle visual curvature hint
  const f1 = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.96, 0.03), mats.mirror());
  f1.rotation.x = -Math.PI / 2;
  f1.position.set(m1.position.x, -0.009, 0);
  const f2 = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.76, 0.03), mats.mirror());
  f2.position.set(m2.position.x, 0, -0.009);
  g.add(m1, m2, f1, f2, stand(o.beamY, 0.21, 0.6, 0.5));
  return shadowed(g);
}

/** Diffractive nano-focusing optic (zone plate or multilayer Laue lens) with order-sorting aperture. */
export function zonePlate(o: PartOptions & { mll?: boolean }): THREE.Group {
  const g = new THREE.Group();
  const holder = box(0.04, 0.12, 0.12, mats.darkSteel(), 0.005);
  g.add(holder);
  if (o.mll) {
    const l1 = box(0.006, 0.05, 0.004, new THREE.MeshStandardMaterial({ color: 0xc9a2ff, metalness: 0.6, roughness: 0.2 }), 0);
    l1.position.set(0.02, 0, 0);
    const l2 = box(0.006, 0.004, 0.05, new THREE.MeshStandardMaterial({ color: 0xc9a2ff, metalness: 0.6, roughness: 0.2 }), 0);
    l2.position.set(0.035, 0, 0);
    g.add(l1, l2);
  } else {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.004, 0.03, 48, 6), new THREE.MeshStandardMaterial({ color: 0xffd479, metalness: 0.9, roughness: 0.2, side: THREE.DoubleSide }));
    ring.rotation.y = Math.PI / 2;
    ring.position.x = 0.022;
    g.add(ring);
  }
  const osa = box(0.004, 0.06, 0.06, mats.steel(), 0);
  osa.position.x = 0.08;
  g.add(osa, stand(o.beamY, 0.06, 0.15, 0.15, mats.steel()));
  return shadowed(g);
}

export function phaseRetarder(o: PartOptions): THREE.Group {
  const g = new THREE.Group();
  const gon = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 10, 32), mats.darkSteel());
  gon.rotation.y = Math.PI / 2;
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), diamondGlass);
  g.add(gon, diamond, pipe(0.5, 0.025), stand(o.beamY, 0.15, 0.3, 0.3));
  return shadowed(g);
}

// ------------------------------------------------------------------ end station

export function sampleStage(o: PartOptions): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), glowMaterial(o.color ?? COLORS.xray, 3));
  const post = cyl(0.008, 0.08, mats.steel(), 10);
  post.position.y = -0.05;
  const hexapod = cyl(0.12, 0.12, mats.darkSteel(), 6);
  hexapod.position.y = -0.18;
  const top = cyl(0.1, 0.02, mats.steel(), 24);
  top.position.y = -0.1;
  g.add(s, post, top, hexapod, stand(o.beamY, 0.24, 0.5, 0.5));
  return shadowed(g);
}

export function diffractometer(o: PartOptions & { arm?: number }): THREE.Group {
  const g = new THREE.Group();
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xd2d8df, metalness: 0.65, roughness: 0.3 });
  const chi = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 12, 48, Math.PI * 1.5), ringMat);
  chi.rotation.y = Math.PI / 2;
  chi.rotation.z = Math.PI * 0.75;
  const omega = cyl(0.42, 0.1, mats.darkSteel(), 40);
  omega.position.y = -0.5;
  const base = box(0.9, 0.5, 0.9, mats.steel(), 0.04);
  base.position.y = -0.8;
  g.add(chi, omega, base);
  const armLen = o.arm ?? 0.9;
  const arm = box(armLen, 0.06, 0.08, mats.steel(), 0.01);
  arm.position.set(armLen / 2 + 0.1, 0.25, 0.2);
  arm.rotation.z = 0.35;
  g.add(arm, sampleStage({ ...o, beamY: 0.6 }));
  g.add(stand(o.beamY, 1.05, 0.9, 0.9));
  return shadowed(g);
}

export function sampleEnvironment(o: PartOptions & { kind?: 'cryostat' | 'dac' | 'furnace' | 'cell' }): THREE.Group {
  const g = new THREE.Group();
  const k = o.kind ?? 'cryostat';
  if (k === 'dac') {
    const body = cyl(0.04, 0.035, mats.steel(), 24);
    body.rotation.z = Math.PI / 2;
    const anvil1 = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.02, 8), diamondGlass);
    anvil1.rotation.z = Math.PI / 2;
    anvil1.position.x = -0.012;
    const anvil2 = anvil1.clone();
    anvil2.rotation.z = -Math.PI / 2;
    anvil2.position.x = 0.012;
    g.add(body, anvil1, anvil2);
  } else if (k === 'furnace' || k === 'cell') {
    const body = box(0.14, 0.12, 0.12, new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.5, metalness: 0.4 }), 0.02);
    g.add(body);
  } else {
    const can = cyl(0.11, 0.5, new THREE.MeshStandardMaterial({ color: 0xb9c3cf, metalness: 0.75, roughness: 0.3 }), 32);
    can.position.y = 0.15;
    const head = cyl(0.14, 0.12, mats.steel(), 32);
    head.position.y = 0.45;
    g.add(can, head);
  }
  g.add(sampleStage({ ...o, beamY: o.beamY }));
  return shadowed(g);
}

/** Pixel-array area detector. Size defaults ~ a large hybrid photon-counting module array. */
export function detector(o: PartOptions & { sizeM?: number; faceDir?: THREE.Vector3 }): THREE.Group {
  const g = new THREE.Group();
  const s = o.sizeM ?? 0.3;
  const housing = box(0.35, s + 0.08, s + 0.08, mats.detector(), 0.03);
  housing.position.x = 0.18;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(s, s), detectorFaceMaterial(o.color ?? '#5cd3ff'));
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.006;
  const fins = box(0.2, s * 0.6, 0.02, mats.darkSteel(), 0.005);
  fins.position.set(0.35, 0, s / 2 + 0.03);
  g.add(housing, face, fins, stand(o.beamY, s / 2 + 0.04, 0.35, 0.35, mats.steel()));
  return shadowed(g);
}

let faceTexCache: Map<string, THREE.CanvasTexture> | null = null;
function detectorFaceMaterial(color: string): THREE.MeshStandardMaterial {
  faceTexCache ??= new Map();
  let tex = faceTexCache.get(color);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#05080d';
    ctx.fillRect(0, 0, 256, 256);
    // module tiling + faint speckle/diffraction rings
    ctx.strokeStyle = 'rgba(120,150,190,0.35)';
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * 64);
      ctx.lineTo(256, i * 64);
      ctx.moveTo(i * 64, 0);
      ctx.lineTo(i * 64, 256);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const r of [34, 58, 84, 110]) {
      ctx.strokeStyle = color + '55';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(128, 128, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.pow(rnd(), 1.6) * 120;
      ctx.fillStyle = color + Math.floor(40 + rnd() * 120).toString(16).padStart(2, '0');
      ctx.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 2, 2);
    }
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    faceTexCache.set(color, tex);
  }
  return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.5 });
}

export function flightTube(o: PartOptions & { lengthM?: number; radiusM?: number }): THREE.Group {
  const g = new THREE.Group();
  const L = o.lengthM ?? 4;
  const r = o.radiusM ?? 0.25;
  const tube = cyl(r, L, new THREE.MeshStandardMaterial({ color: 0xc5cdd6, metalness: 0.7, roughness: 0.35 }), 36);
  tube.rotation.z = Math.PI / 2;
  tube.position.x = L / 2;
  g.add(tube);
  const n = Math.max(2, Math.floor(L / 1.5));
  for (let i = 0; i <= n; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.01, 0.018, 8, 36), mats.steel());
    ring.rotation.y = Math.PI / 2;
    ring.position.x = (i / n) * L;
    g.add(ring);
    if (i < n) {
      const leg = stand(o.beamY, r, 0.12, 0.3, mats.steel());
      leg.position.x = ((i + 0.5) / n) * L;
      g.add(leg);
    }
  }
  return shadowed(g);
}

export function spectrometer(o: PartOptions & { radiusM?: number }): THREE.Group {
  const g = new THREE.Group();
  const R = o.radiusM ?? 1.0;
  const arm = box(R, 0.08, 0.12, mats.steel(), 0.01);
  arm.position.set(R / 2, 0.3, 0.3);
  arm.rotation.y = -0.6;
  g.add(arm);
  for (let i = 0; i < 5; i++) {
    const an = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 10, 0, Math.PI * 2, 0, Math.PI / 3), mats.silicon());
    an.position.set(R * 0.75, 0.3 + (i - 2) * 0.11, 0.62);
    an.rotation.x = Math.PI / 2;
    g.add(an);
  }
  const det = detector({ ...o, sizeM: 0.12 });
  det.position.set(0.25, 0.4, 0.2);
  det.children.at(-1)?.removeFromParent();
  g.add(det, sampleStage(o));
  return shadowed(g);
}

/** Platinum differential-aperture wire (DAXM) or coded aperture just above the sample surface. */
export function wire(o: PartOptions & { coded?: boolean }): THREE.Group {
  const g = new THREE.Group();
  if (o.coded) {
    const plate = box(0.004, 0.03, 0.03, new THREE.MeshStandardMaterial({ color: 0xd8b56a, metalness: 0.9, roughness: 0.25 }), 0);
    g.add(plate);
  } else {
    const w = cyl(0.0004 * 30, 0.06, new THREE.MeshStandardMaterial({ color: 0xe7e7ef, metalness: 1, roughness: 0.2 }), 10);
    w.rotation.x = Math.PI / 2;
    g.add(w);
  }
  const carrier = box(0.02, 0.02, 0.1, mats.darkSteel(), 0.003);
  carrier.position.set(0, 0.025, 0);
  g.add(carrier);
  return shadowed(g);
}

export function beamStop(o: PartOptions): THREE.Group {
  const g = new THREE.Group();
  const s = cyl(0.006, 0.01, new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.95, roughness: 0.2 }), 12);
  s.rotation.z = Math.PI / 2;
  const rod = cyl(0.002, 0.15, mats.steel(), 6);
  rod.position.y = 0.075;
  g.add(s, rod);
  void o;
  return shadowed(g);
}

export function generic(o: PartOptions): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.35, 0.35, 0.35, mats.steel(), 0.03), pipe(0.6, 0.03), stand(o.beamY, 0.18, 0.3, 0.3));
  return shadowed(g);
}

/** Dispatch on the research `category` field (with keyword fallbacks on the component name). */
export function buildPart(category: string, name: string, o: PartOptions & Record<string, unknown>): THREE.Group {
  const n = name.toLowerCase();
  switch (category) {
    case 'undulator':
      return undulator({ ...o, superconducting: /supercond|scu|scape/.test(n) });
    case 'frontEnd':
      return frontEnd(o);
    case 'shutter':
      return shutter(o);
    case 'slits':
    case 'collimator':
      return slits(o);
    case 'window':
      return windowPart(o);
    case 'filter':
    case 'attenuator':
      return filterPart(o);
    case 'diagnostics':
      return diagnostics(o);
    case 'mirror':
      return mirror(o);
    case 'monochromator':
      return monochromator({ ...o, multilayer: /multilayer/.test(n) });
    case 'multilayerMono':
      return monochromator({ ...o, multilayer: true });
    case 'crl':
    case 'transfocator':
      return crl(o);
    case 'kbMirror':
      return kbMirror({ ...o, compact: /nano|probe/.test(n) });
    case 'zonePlate':
      return zonePlate(o);
    case 'mll':
      return zonePlate({ ...o, mll: true });
    case 'phaseRetarder':
    case 'polarizationAnalyzer':
      return phaseRetarder(o);
    case 'sample':
    case 'goniometer':
      return sampleStage(o);
    case 'diffractometer':
      return diffractometer(o);
    case 'sampleEnvironment':
      return sampleEnvironment({ ...o, kind: /diamond|dac|pressure/.test(n) ? 'dac' : /furnace|heater|cell|reactor/.test(n) ? 'furnace' : 'cryostat' });
    case 'detector':
      return detector(o);
    case 'flightTube':
      return flightTube(o);
    case 'spectrometer':
    case 'analyzer':
      return spectrometer(o);
    case 'wire':
      return wire(o);
    case 'codedAperture':
      return wire({ ...o, coded: true });
    case 'beamStop':
      return beamStop(o);
    case 'beamPipe':
      return (() => {
        const g = new THREE.Group();
        g.add(pipe(1.5, 0.035));
        return g;
      })();
    default:
      return generic(o);
  }
}

/** Stylised 1.75 m person for scale (museum-diorama convention). Origin at the feet. */
export function scalePerson(color = 0xcfd6df, pose: 'stand' | 'point' = 'stand'): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.62, 4, 12), m);
  body.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), m);
  head.position.y = 1.63;
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.62, 4, 10), m);
  legs.position.y = 0.42;
  legs.scale.set(1.15, 1, 0.8);
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.55, 3, 8), m);
  armL.position.set(0, 1.12, 0.22);
  const armR = armL.clone();
  armR.position.z = -0.22;
  if (pose === 'point') {
    armR.rotation.x = -1.1;
    armR.position.set(0.18, 1.3, -0.25);
  }
  g.add(body, head, legs, armL, armR);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  g.userData.isScalePerson = true;
  return g;
}
