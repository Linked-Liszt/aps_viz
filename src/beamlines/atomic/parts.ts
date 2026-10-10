import * as THREE from 'three';
import { COLORS, glowMaterial } from '../../scene/palette';
import { M, bar, box, boxSpan, cyl, flangeX, inStation, pedestal, pipeX, rod, shadowed, vesselBox } from './kit';
import {
  ARM, DET_REL, GRANITE, KB2, KOUT, KPLAN, KUP, LAUE, LAUE_REL, SAMPLE_X, SDD, SDD_REL, TUBE_MID_REL, ARM_MID_REL,
} from './geom';

/**
 * ATOMIC part models (local to this beamline; the shared parts library is not modified). Sizes in metres, frame +X downstream,
 * +Y up, +Z outboard. Station-frame builders take the sample/focus as origin and return a group whose origin sits at the
 * component position the engine places (see `inStation`).
 */

const FLOOR = -1.4;
const floorY = (beamY: number, dy = 0) => -beamY - dy;

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}
const A = {
  magRed: () => cached('at-magR', () => new THREE.MeshStandardMaterial({ color: 0xc94b4b, roughness: 0.45, metalness: 0.4 })),
  magBlue: () => cached('at-magB', () => new THREE.MeshStandardMaterial({ color: 0x3c6fd1, roughness: 0.45, metalness: 0.4 })),
  magAmber: () => cached('at-magA', () => new THREE.MeshStandardMaterial({ color: 0xd08a3a, roughness: 0.45, metalness: 0.4 })),
  magTeal: () => cached('at-magT', () => new THREE.MeshStandardMaterial({ color: 0x3a9c96, roughness: 0.45, metalness: 0.4 })),
  pole: () => cached('at-pole', () => new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.35, metalness: 0.85 })),
  frame: () => cached('at-frame', () => new THREE.MeshStandardMaterial({ color: 0x3f6f9a, roughness: 0.6, metalness: 0.3 })),
  kapton: () =>
    cached('at-kapton', () => new THREE.MeshStandardMaterial({ color: 0xffa646, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide })),
  cell: () =>
    cached('at-cell', () => new THREE.MeshPhysicalMaterial({ color: 0xd9e2ec, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide })),
  envelope: () =>
    cached('at-env', () =>
      new THREE.MeshBasicMaterial({
        color: COLORS.xray.clone().multiplyScalar(1.4),
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  fluo: () =>
    cached('at-fluo', () =>
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf6b').multiplyScalar(1.6), transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending }),
    ),
  crystal: () => glowMaterial(0xff8fb1, 3.2),
};

/** Orient a part built along +X (with +Y as its 'up') so that +X → `dir`, +Y → `up`. */
function basis(obj: THREE.Object3D, dir: THREE.Vector3, up: THREE.Vector3): void {
  const z = new THREE.Vector3().crossVectors(dir, up).normalize();
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir.clone().normalize(), up.clone().normalize(), z));
}

/** Flat annulus lying on the floor (or any ring) via a lathe: inner/outer radius, height, optional arc (plan angle δ from +X toward +Z). */
function annulus(rIn: number, rOut: number, h: number, m: THREE.Material, fromDeg = 0, toDeg = 360, seg = 96): THREE.Mesh {
  const pts = [new THREE.Vector2(rIn, 0), new THREE.Vector2(rOut, 0), new THREE.Vector2(rOut, h), new THREE.Vector2(rIn, h), new THREE.Vector2(rIn, 0)];
  // lathe vertex = (r sinφ, y, r cosφ): plan angle δ (x = r cosδ, z = r sinδ) ↔ φ = π/2 − δ
  const d2r = THREE.MathUtils.degToRad;
  const phiStart = Math.PI / 2 - d2r(toDeg);
  const geo = new THREE.LatheGeometry(pts, seg, phiStart, d2r(toDeg - fromDeg));
  return new THREE.Mesh(geo, m);
}

// ------------------------------------------------------------------ undulators

/** One magnet array (alternating magnet/pole blocks) along X; `face` = direction of the gap from the array (unit Y or Z). */
function magnetArray(L: number, periodMm: number, center: THREE.Vector3, size: [number, number, number], mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const n = Math.min(400, Math.round((L * 1000) / (periodMm / 2)));
  const w = L / n;
  const geo = new THREE.BoxGeometry(w * 0.92, size[1], size[2]);
  const mags = new THREE.InstancedMesh(geo, mat, Math.ceil(n / 2));
  const poles = new THREE.InstancedMesh(geo, A.pole(), Math.ceil(n / 2));
  const d = new THREE.Object3D();
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    d.position.set(center.x - L / 2 + (i + 0.5) * w, center.y, center.z);
    d.updateMatrix();
    if (i % 2 === 0) mags.setMatrixAt(a++, d.matrix);
    else poles.setMatrixAt(b++, d.matrix);
  }
  mags.count = a;
  poles.count = b;
  g.add(mags, poles);
  return g;
}

/**
 * Planar hybrid undulator (partner U28) drawn in the same style as ATOMIC's revolver. Magnetic gap drawn 20 mm (real minimum
 * 8.5 mm) so the electron beam between the jaws stays visible.
 */
export function planarUndulator(o: { beamY: number; L: number; periodMm: number }): THREE.Group {
  const g = new THREE.Group();
  const L = o.L;
  g.add(magnetArray(L, o.periodMm, new THREE.Vector3(0, 0.035, 0), [L, 0.05, 0.07], A.magRed()));
  g.add(magnetArray(L, o.periodMm, new THREE.Vector3(0, -0.035, 0), [L, 0.05, 0.07], A.magBlue()));
  for (const s of [1, -1]) g.add(boxSpan(-L / 2, L / 2, s * 0.06, s * 0.2, -0.09, 0.37, M.darkSteel(), 0.01));
  addFrame(g, L, o.beamY);
  addElectronBeam(g, L);
  return shadowed(g);
}

/**
 * ATOMIC's revolver undulator (APS21R25): each jaw carries a square strongback with TWO magnet arrays at 90° (21 mm and 25 mm
 * periods); the strongbacks rotate (gap open) to bring the chosen array to the gap. Drawn with the 21 mm array active and the
 * 25 mm array facing inboard. Same 20 mm drawn gap as the partner U28.
 */
export function revolverUndulator(o: { beamY: number; L: number }): THREE.Group {
  const g = new THREE.Group();
  const L = o.L;
  for (const s of [1, -1]) {
    const yc = s * 0.125; // strongback (revolver drum) centre
    g.add(boxSpan(-L / 2, L / 2, yc - 0.065, yc + 0.065, -0.065, 0.065, M.alu(), 0.012));
    // active 21 mm array facing the gap
    g.add(magnetArray(L, 21, new THREE.Vector3(0, s * 0.035, 0), [L, 0.05, 0.07], s > 0 ? A.magRed() : A.magBlue()));
    // stand-by 25 mm array facing inboard (−Z)
    g.add(magnetArray(L, 25, new THREE.Vector3(0, yc, -0.09), [L, 0.07, 0.05], s > 0 ? A.magAmber() : A.magTeal()));
    // rotation bearings at both ends + girder
    for (const x of [-L / 2 - 0.05, L / 2 + 0.05]) {
      const brg = cyl(0.075, 0.1, M.darkSteel(), 24);
      brg.rotation.z = Math.PI / 2;
      brg.position.set(x, yc, 0);
      g.add(brg);
    }
    g.add(boxSpan(-L / 2 - 0.12, L / 2 + 0.12, s * 0.2, s * 0.32, -0.12, 0.37, M.darkSteel(), 0.01));
  }
  addFrame(g, L + 0.24, o.beamY);
  addElectronBeam(g, L);
  return shadowed(g);
}

/** C-frame (back on the outboard side) and base, as for the engine's planar undulator. */
function addFrame(g: THREE.Group, L: number, beamY: number): void {
  g.add(boxSpan(-L / 2 + 0.05, L / 2 - 0.05, -0.5, 0.5, 0.36, 0.5, A.frame(), 0.02));
  g.add(boxSpan(-L * 0.35, L * 0.35, floorY(beamY), -0.5, 0.0, 0.62, M.darkSteel(), 0.01));
}

function addElectronBeam(g: THREE.Group, L: number): void {
  const e = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, L + 0.6, 6), glowMaterial(COLORS.electron, 5));
  e.rotation.z = Math.PI / 2;
  g.add(e);
}

// ------------------------------------------------------------------ compact beam-conditioning parts

/** Four-jaw slit unit in a small cut-away vessel; `w` widens the vessel outboard (a neighbouring beam passing through), `outJaw` shortens the outboard jaw. */
export function slitUnit(o: { beamY: number; size?: number; jaw?: number; w?: number; outJaw?: number }): THREE.Group {
  const g = new THREE.Group();
  const s = o.size ?? 0.2;
  const w = o.w ?? s;
  const ves = vesselBox(0.16, s, w);
  ves.position.z = (w - s) / 2;
  g.add(ves);
  const jaw = o.jaw ?? 0.006; // half-opening drawn
  for (const [y, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const zl = z > 0 ? jaw + (o.outJaw ?? 0.039) : 0.045;
    const b = boxSpan(-0.012, 0.012, y ? jaw : -0.025, y ? 0.045 : 0.025, z ? jaw : -0.025, z ? zl : 0.025, M.tungsten(), 0.002);
    if (y < 0) b.position.y = -b.position.y;
    if (z < 0) b.position.z = -b.position.z;
    g.add(b);
    const act = cyl(0.016, 0.08, M.darkSteel(), 12);
    if (y) act.position.y = y * (s / 2 + 0.04);
    else {
      act.rotation.x = Math.PI / 2;
      act.position.z = z > 0 ? w - s / 2 + 0.04 : -(s / 2 + 0.04);
    }
    g.add(act);
  }
  for (const x of [-0.09, 0.09]) {
    const f = flangeX(0.06);
    f.position.x = x;
    g.add(f);
  }
  g.add(pipeX(-0.3, -0.09, 0.03), pipeX(0.09, 0.3, 0.03));
  g.add(pedestal(0, (w - s) / 2, floorY(o.beamY), -s / 2 - 0.01, 0.2, Math.min(0.3, w), M.darkSteel()));
  return shadowed(g);
}

/** Small beam-position monitor: a cross with four signal feedthroughs. */
export function bpm(o: { beamY: number }): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.12, 0.12, 0.12, M.steel(), 0.01));
  for (const [y, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const st = cyl(0.012, 0.06, M.copper(), 10);
    if (z) st.rotation.x = Math.PI / 2;
    st.position.set(0, y * 0.09, z * 0.09);
    g.add(st);
  }
  g.add(pipeX(-0.28, -0.06, 0.03), pipeX(0.06, 0.28, 0.03), pedestal(0, 0, floorY(o.beamY), -0.06, 0.14, 0.14, M.darkSteel()));
  return shadowed(g);
}

/** Copper photon mask on a stand (one aperture). */
export function photonMask(o: { beamY: number }): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.16, 0.2, 0.2, M.copper(), 0.008));
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.014), new THREE.MeshBasicMaterial({ color: 0x07090c }));
  for (const s of [-1, 1]) {
    const h = hole.clone();
    h.rotation.y = (s * Math.PI) / 2;
    h.position.x = s * 0.081;
    g.add(h);
  }
  g.add(pipeX(-0.3, -0.08, 0.03), pipeX(0.08, 0.3, 0.03), pedestal(0, 0, floorY(o.beamY), -0.1, 0.12, 0.16, M.darkSteel()));
  return shadowed(g);
}

/**
 * Horizontally deflecting small-offset Si(111) DCM, cut-away tank (as drawn in the 3DMN exhibit, but with a tank radius
 * parameter: the twin beams are only ~0.3 m apart in 34-ID-C, so the tanks are drawn 0.24 m in radius). The real ~1.1 mm
 * offset is drawn ×18 (20 mm); `bypass` lowers the crystals (pink mode); the second crystal carries the heater (~60 K warmer)
 * that steers the mono beam onto the pink-beam focus.
 */
export function hdcm(o: { beamY: number; R?: number; bypass?: boolean; thetaDeg?: number; heater?: boolean; sense?: 1 | -1 }): THREE.Group {
  const sense = o.sense ?? -1;
  const g = new THREE.Group();
  const th = THREE.MathUtils.degToRad(o.thetaDeg ?? 12.5);
  const R = o.R ?? 0.24;
  const H = 0.52;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 40, 1, true), M.vessel());
  wall.renderOrder = 3;
  const base = cyl(R + 0.02, 0.05, M.steel(), 40);
  base.position.y = -H / 2;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, 0.04, 40, 1, false, Math.PI / 2, Math.PI), M.steel());
  lid.position.y = H / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.01, 6, 48), M.steel());
  rim.rotation.x = Math.PI / 2;
  rim.position.y = H / 2;
  g.add(wall, base, lid, rim);
  const cage = new THREE.Group();
  cage.position.y = o.bypass ? -0.045 : 0;
  const off = 0.02;
  const D = off / Math.sin(2 * th);
  const x1 = -(D * Math.cos(2 * th)) / 2;
  const mk = (x: number, z: number, side: 1 | -1, heater: boolean) => {
    const c = new THREE.Group();
    const xtal = box(0.07, 0.045, 0.022, M.silicon(), 0.002);
    xtal.position.z = side * 0.011;
    const holder = box(0.08, 0.055, 0.016, M.copper(), 0.003);
    holder.position.z = side * 0.03;
    c.add(xtal, holder);
    if (heater) {
      const pad = box(0.05, 0.03, 0.004, M.heater(), 0.001);
      pad.position.z = side * 0.04;
      c.add(pad);
    }
    c.rotation.y = -sense * th;
    c.position.set(x, 0, z);
    return c;
  };
  // sense −1: offset toward the inboard side (ATOMIC; not documented, drawn like its mirror); +1: outboard (3DMN exhibit)
  const s1 = sense > 0 ? -1 : 1;
  cage.add(mk(x1, 0, s1, false), mk(-x1, sense * off, -s1 as 1 | -1, o.heater ?? false));
  cage.add(boxSpan(-0.12, 0.12, -0.05, -0.035, -0.09, 0.08, M.steel(), 0.004));
  const rot = cyl(0.08, 0.08, M.darkSteel(), 32);
  rot.position.y = -0.1;
  cage.add(rot);
  g.add(cage);
  g.add(boxSpan(-0.02, 0.02, -0.24, -0.06, 0.1, 0.12, M.darkSteel(), 0.003));
  for (const x of [-R - 0.01, R + 0.01]) {
    const f = flangeX(0.07);
    f.position.x = x;
    g.add(f);
  }
  g.add(pipeX(-R - 0.3, -R, 0.032), pipeX(R, R + 0.3, 0.032));
  g.add(pedestal(0, 0, -o.beamY, -H / 2 - 0.025, 0.46, 0.44, M.granite()));
  return shadowed(g);
}

// ------------------------------------------------------------------ zoom KB mirror pairs

interface KBMirror {
  /** centre along x (relative to the group origin) */
  x: number;
  len: number;
  plane: 'H' | 'V';
  /** H mirrors: substrate on the outboard (+1) or inboard (−1) side of the beam */
  side?: 1 | -1;
}

/**
 * Bendable KB mirror pair in a cut-away vessel. V mirror: substrate below the beam, face up (deflects upward); H mirror:
 * substrate on the inboard side by default, face outboard (deflects outboard). The real deflection senses are not documented and the
 * ~6 mrad deflections are not drawn (2–4 mm over the station). Each substrate carries a two-moment bender (end clamps +
 * actuator) that changes its elliptical shape by tens of micrometres to zoom.
 */
export function kbPair(o: { beamY: number; mirrors: KBMirror[]; vessel: [number, number]; w?: number; h?: number; standFloor?: number; standTop?: number; zOff?: number }): THREE.Group {
  const g = new THREE.Group();
  const [v0, v1] = o.vessel;
  const w = o.w ?? 0.3;
  const h = o.h ?? 0.3;
  const zOff = o.zOff ?? 0;
  const ves = vesselBox(v1 - v0, h, w);
  ves.position.set((v0 + v1) / 2, 0, zOff);
  g.add(ves);
  for (const m of o.mirrors) {
    const L = m.len;
    const x0 = m.x - L / 2;
    const x1 = m.x + L / 2;
    const t = 0.035; // substrate thickness
    const sw = Math.min(0.05, 0.12 * L + 0.02); // substrate width
    if (m.plane === 'V') {
      g.add(boxSpan(x0, x1, -t - 0.0006, -0.0006, -sw / 2, sw / 2, M.silicon(), 0.002));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.98, sw * 0.8), M.mirror());
      face.rotation.x = -Math.PI / 2;
      face.position.set(m.x, -0.0005, 0);
      g.add(face);
      for (const x of [x0 + 0.012, x1 - 0.012]) g.add(boxSpan(x - 0.014, x + 0.014, -t - 0.035, -t + 0.006, -sw / 2 - 0.012, sw / 2 + 0.012, M.blackAnod(), 0.002));
      g.add(boxSpan(x0, x1, -t - 0.05, -t - 0.035, -sw / 2 - 0.01, sw / 2 + 0.01, M.steel(), 0.002));
      g.add(boxSpan(m.x - 0.03, m.x + 0.03, -t - 0.1, -t - 0.05, -0.025, 0.025, M.darkSteel(), 0.003));
    } else {
      const k = m.side ?? -1;
      const zs = (a: number, b: number): [number, number] => [k * a, k * b];
      g.add(boxSpan(x0, x1, -sw / 2, sw / 2, ...zs(0.0006, 0.0006 + t), M.silicon(), 0.002));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.98, sw * 0.8), M.mirror());
      face.rotation.y = k > 0 ? Math.PI : 0;
      face.position.set(m.x, 0, k * 0.0005);
      g.add(face);
      for (const x of [x0 + 0.012, x1 - 0.012]) g.add(boxSpan(x - 0.014, x + 0.014, -sw / 2 - 0.012, sw / 2 + 0.012, ...zs(t - 0.006, t + 0.035), M.blackAnod(), 0.002));
      g.add(boxSpan(x0, x1, -sw / 2 - 0.01, sw / 2 + 0.01, ...zs(t + 0.035, t + 0.05), M.steel(), 0.002));
      g.add(boxSpan(m.x - 0.03, m.x + 0.03, -0.025, 0.025, ...zs(t + 0.05, t + 0.1), M.darkSteel(), 0.003));
    }
  }
  // common base plate + stand
  const top = o.standTop ?? -h / 2;
  g.add(boxSpan(v0 + 0.03, v1 - 0.03, top - 0.03, top, zOff - w / 2 + 0.02, zOff + w / 2 - 0.02, M.steel(), 0.004));
  g.add(pedestal((v0 + v1) / 2, zOff, o.standFloor ?? floorY(o.beamY), top - 0.03, Math.min(0.5, (v1 - v0) * 0.6), Math.min(0.3, w * 0.8), M.granite()));
  for (const x of [v0 - 0.005, v1 + 0.005]) {
    const f = flangeX(0.055);
    f.position.x = x;
    g.add(f);
  }
  return shadowed(g);
}

// ------------------------------------------------------------------ endstation (station frame: origin = sample/focus)

/** Pre-conditioning platform (68.1 m): small granite table with a diamond XBPM and an apodizing four-jaw aperture. */
export function preconditioningPlatform(o: { beamY: number }): THREE.Group {
  const g = new THREE.Group();
  const top = -0.3;
  g.add(boxSpan(-0.4, 0.4, floorY(o.beamY), top - 0.02, -0.28, 0.28, M.granite(), 0.008));
  g.add(boxSpan(-0.39, 0.39, top - 0.02, top, -0.27, 0.27, M.steel(), 0.003));
  // diamond XBPM
  const x = bpm({ beamY: 0 });
  x.children.at(-1)?.removeFromParent();
  x.position.x = -0.18;
  g.add(x, boxSpan(-0.22, -0.14, top, -0.06, -0.04, 0.04, M.darkSteel(), 0.003));
  // apodizing slits
  const s = slitUnit({ beamY: 0, size: 0.16 });
  s.children.at(-1)?.removeFromParent();
  s.position.x = 0.16;
  g.add(s, boxSpan(0.1, 0.22, top, -0.08, -0.06, 0.06, M.darkSteel(), 0.003));
  return shadowed(g);
}

/** Sample-positioning diffractometer: granite platform (carries KB2 and the sample tower) + air-bearing θ rotation + XYZ. */
export function sampleDiffractometer(origin: THREE.Vector3): THREE.Group {
  return inStation(origin, (g) => {
    const t = GRANITE.top;
    g.add(boxSpan(GRANITE.x0, GRANITE.x1, FLOOR + 0.06, t - 0.03, GRANITE.z0, GRANITE.z1, M.granite(), 0.012));
    g.add(boxSpan(GRANITE.x0 + 0.01, GRANITE.x1 - 0.01, t - 0.03, t, GRANITE.z0 + 0.01, GRANITE.z1 - 0.01, M.steel(), 0.004));
    for (const x of [GRANITE.x0 + 0.12, GRANITE.x1 - 0.12])
      for (const z of [GRANITE.z0 + 0.1, GRANITE.z1 - 0.1]) {
        const f = cyl(0.045, 0.06, M.darkSteel(), 16);
        f.position.set(x, FLOOR + 0.03, z);
        g.add(f);
      }
    // air-bearing θ rotary table
    const ring = cyl(0.17, 0.06, M.blackAnod(), 48);
    ring.position.y = t + 0.03;
    const plate = cyl(0.15, 0.025, M.steel(), 48);
    plate.position.y = t + 0.072;
    g.add(ring, plate);
    // coarse XYZ stack
    g.add(boxSpan(-0.12, 0.12, t + 0.085, t + 0.13, -0.12, 0.12, M.alu(), 0.004));
    g.add(boxSpan(-0.1, 0.1, t + 0.13, t + 0.17, -0.1, 0.1, M.blackAnod(), 0.004));
    g.add(boxSpan(-0.08, 0.08, t + 0.17, t + 0.2, -0.08, 0.08, M.alu(), 0.004));
  });
}

/** χ/φ cradle, piezo scanner, sample post and the nanocrystal on its chip (origin = sample). */
export function sampleStages(): THREE.Group {
  const g = new THREE.Group();
  const t = GRANITE.top + 0.2; // top of the coarse stack (-0.42)
  // χ cradle: two arc guides (radius 0.2 m, centred on the sample) on a base block; the carriage rides at the bottom
  const R = 0.2;
  // arc plates (bottom quarter, 225°–315°), 20 mm thick, in planes normal to the beam
  const sh = new THREE.Shape();
  const a0 = Math.PI * 1.25;
  const a1 = Math.PI * 1.75;
  sh.absarc(0, 0, R + 0.012, a0, a1, false);
  sh.absarc(0, 0, R - 0.03, a1, a0, true);
  const arcGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false, curveSegments: 24 });
  arcGeo.translate(0, 0, -0.01);
  for (const x of [-0.045, 0.045]) {
    const arc = new THREE.Mesh(arcGeo, M.alu());
    arc.rotation.y = Math.PI / 2;
    arc.position.x = x;
    g.add(arc);
  }
  g.add(boxSpan(-0.07, 0.07, t, -R - 0.012, -0.15, 0.15, M.blackAnod(), 0.004));
  g.add(boxSpan(-0.06, 0.06, -R - 0.012, -R + 0.012, -0.05, 0.05, M.blueAnod(), 0.003));
  // φ rotation + XYZ piezo + kinematic mount
  const phi = cyl(0.04, 0.035, M.blackAnod(), 32);
  phi.position.y = -R + 0.03;
  g.add(phi);
  g.add(boxSpan(-0.03, 0.03, -R + 0.048, -0.1, -0.03, 0.03, M.blueAnod(), 0.003));
  g.add(boxSpan(-0.02, 0.02, -0.1, -0.08, -0.02, 0.02, M.steel(), 0.003));
  // kinematic mount + post + chip
  g.add(boxSpan(-0.016, 0.016, -0.08, -0.07, -0.016, 0.016, M.blackAnod(), 0.002));
  const post = cyl(0.004, 0.064, M.steel(), 10);
  post.position.y = -0.038;
  g.add(post, boxSpan(-0.005, 0.005, -0.0062, -0.0052, -0.005, 0.005, M.silicon(), 0));
  // the nanocrystal (real ~0.05–1 µm; drawn as a 6 mm glowing octahedron so it can be seen)
  const xtal = new THREE.Mesh(new THREE.OctahedronGeometry(0.0042), A.crystal());
  xtal.scale.set(1, 1.15, 1);
  xtal.position.y = -0.0006;
  g.add(xtal);
  return shadowed(g);
}

/** Gas-flow heater cell around the sample: aluminium base and lid, Kapton window band, two gas lines (origin = sample). */
export function environmentCell(): THREE.Group {
  const g = new THREE.Group();
  const r = 0.019;
  const win = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.022, 32, 1, true), A.kapton());
  win.renderOrder = 4;
  win.position.y = 0.002;
  const lid = cyl(r + 0.002, 0.006, A.cell(), 32);
  lid.position.y = 0.016;
  const base = cyl(r + 0.003, 0.01, M.alu(), 32);
  base.position.y = -0.014;
  g.add(win, lid, base);
  for (const z of [-0.008, 0.008]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.012, -0.016, z),
      new THREE.Vector3(0.03, -0.03, z * 1.5),
      new THREE.Vector3(0.06, -0.09, z * 3),
      new THREE.Vector3(0.08, -0.2, z * 4),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.0025, 6), M.copper()));
  }
  return shadowed(g);
}

/** Laue orientation detector (Eiger2 500K class): 77 × 39 mm sensor ~28 mm from the sample, inboard, facing outboard. */
export function laueDetector(): THREE.Group {
  return inStation(LAUE_REL, (g) => {
    const d = new THREE.Group();
    const [sw, sh] = LAUE.sensor;
    // built facing −X (toward the sample) with the body behind (+X), then rotated so +X → n (away from the sample)
    d.add(boxSpan(0.002, 0.24, -0.05, 0.05, -0.058, 0.058, M.detHousing(), 0.01));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshStandardMaterial({ map: laueTexture(), emissive: 0xffffff, emissiveMap: laueTexture(), emissiveIntensity: 0.9, roughness: 0.5 }));
    face.rotation.y = -Math.PI / 2;
    d.add(face);
    d.add(boxSpan(0.24, 0.27, -0.03, 0.03, -0.03, 0.03, M.blackAnod(), 0.003));
    d.position.copy(LAUE_REL);
    basis(d, LAUE.n.clone(), new THREE.Vector3(0, 1, 0));
    g.add(d);
    // support: bracket under the housing to a vertical (y) and transverse (z) stage on the granite's inboard edge
    const zf = GRANITE.z0 + 0.09;
    const a = new THREE.Vector3(LAUE_REL.x, -0.065, LAUE_REL.z - 0.18);
    const b = new THREE.Vector3(LAUE_REL.x, -0.065, zf);
    const c = new THREE.Vector3(LAUE_REL.x, GRANITE.top + 0.1, zf);
    g.add(boxSpan(a.x - 0.03, a.x + 0.03, -0.065, -0.05, LAUE_REL.z - 0.22, LAUE_REL.z - 0.14, M.alu(), 0.003));
    g.add(bar(a, b, 0.025, M.alu()), bar(b, c, 0.035, M.alu()));
    g.add(boxSpan(c.x - 0.05, c.x + 0.05, GRANITE.top, GRANITE.top + 0.1, zf - 0.05, zf + 0.05, M.blackAnod(), 0.004));
  });
}

/** Silicon-drift fluorescence detector looking at the spot from the outboard side (90° to the beam). Origin = body centre. */
export function fluorescenceDetector(): THREE.Group {
  return inStation(SDD_REL, (g) => {
    const snout = cyl(0.009, SDD.body0 - SDD.tip, M.steel(), 16);
    snout.rotation.x = Math.PI / 2;
    snout.position.z = (SDD.tip + SDD.body0) / 2;
    const tip = cyl(0.0095, 0.002, new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.3, metalness: 0.6 }), 16);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = SDD.tip;
    const body = cyl(0.026, SDD.body1 - SDD.body0, M.alu(), 24);
    body.rotation.x = Math.PI / 2;
    body.position.z = (SDD.body0 + SDD.body1) / 2;
    g.add(snout, tip, body, boxSpan(-0.035, 0.035, -0.055, 0.03, SDD.body1 - 0.12, SDD.body1 + 0.02, M.blackAnod(), 0.004));
    // stage on the granite
    g.add(boxSpan(-0.03, 0.03, GRANITE.top, -0.035, 0.32, 0.38, M.alu(), 0.003));
    g.add(boxSpan(-0.06, 0.06, GRANITE.top, GRANITE.top + 0.05, 0.27, 0.43, M.blackAnod(), 0.003));
    // fluorescence cone (sample → snout)
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0005, SDD.tip, 24, 1, true), A.fluo());
    cone.rotation.x = Math.PI / 2;
    cone.position.z = SDD.tip / 2;
    g.add(cone);
  });
}

/** Zoom KB2 on the sample platform: V mirror (400 mm) then H mirror (140 mm), downstream end ~50 mm before the focus. */
export function kb2(origin: THREE.Vector3): THREE.Group {
  return inStation(origin, (g) => {
    const rel = (x: number) => x - SAMPLE_X;
    const pair = kbPair({
      beamY: 1.4,
      mirrors: [
        { x: rel((KB2.v0 + KB2.v1) / 2), len: 0.4, plane: 'V' },
        { x: rel((KB2.h0 + KB2.h1) / 2), len: 0.14, plane: 'H' },
      ],
      vessel: [rel(KB2.v0) - 0.04, rel(KB2.h1) + 0.005],
      w: 0.29,
      h: 0.3,
      standFloor: GRANITE.top,
    });
    g.add(pair);
    // beam pipe from the platform
    g.add(pipeX(rel(68.5), rel(KB2.v0) - 0.045, 0.022));
  });
}

// ------------------------------------------------------------------ detector-positioning diffractometer (arm)

/** Unit along the diffracted ray at distance d, offset `below` under it (in the vertical plane of the ray). */
const onRay = (d: number, below = 0) => KOUT.clone().multiplyScalar(d).addScaledVector(KUP, -below);

/**
 * Two-circle detector arm, independent of the sample platform: δ turntable ring on the floor around the sample axis, a boom
 * along the diffracted ray carried by a column on the δ ring and a telescopic leg on a floor arc rail (radius ~4.3 m, as drawn
 * in FDR Fig. 4.58), detector carriage on a linear guide. Posed at δ = 30°, γ = 16.8° (2θ = 34°). Origin = boom midpoint.
 */
export function detectorArm(): THREE.Group {
  return inStation(ARM_MID_REL, (g) => {
    const steel = M.steel();
    const dark = M.darkSteel();
    // δ ring around the sample axis + carriage + column
    g.add(annulus(ARM.ringR - 0.07, ARM.ringR + 0.07, 0.1, dark).translateY(FLOOR));
    g.add(annulus(ARM.ringR - 0.03, ARM.ringR + 0.03, 0.115, steel).translateY(FLOOR));
    const cP = KPLAN.clone().multiplyScalar(ARM.ringR);
    const carr = boxSpan(-0.16, 0.16, FLOOR + 0.1, FLOOR + 0.24, -0.13, 0.13, M.blueAnod(), 0.008);
    carr.position.set(cP.x, carr.position.y, cP.z);
    carr.rotation.y = -THREE.MathUtils.degToRad(ARM.deltaDeg);
    g.add(carr);
    // boom height at the column (plan radius = ringR)
    // boom centreline c(d) = d·k − below·u has plan radius d·cosγ + below·sinγ: solve for the ring radius
    const dCol = (ARM.ringR - ARM.below * KOUT.y) / KPLAN.dot(KOUT);
    const colTop = onRay(dCol, ARM.below + 0.09);
    g.add(bar(new THREE.Vector3(cP.x, FLOOR + 0.24, cP.z), new THREE.Vector3(cP.x, colTop.y, cP.z), 0.13, M.alu()));
    // boom: box beam with a linear guide on top
    const boom = new THREE.Group();
    const L = ARM.d1 - ARM.d0;
    boom.add(boxSpan(0, L, -0.09, 0.09, -0.07, 0.07, M.alu(), 0.01));
    boom.add(boxSpan(0, L, 0.09, 0.105, -0.03, 0.03, dark, 0.003));
    for (let i = 1; i < 8; i++) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), dark);
      hole.position.set((i * L) / 8, 0, 0.0705);
      boom.add(hole);
    }
    boom.position.copy(onRay(ARM.d0, ARM.below));
    basis(boom, KOUT, KUP);
    g.add(boom);
    // far-end telescopic leg on the floor arc rail
    const legTop = onRay(ARM.legD, ARM.below + 0.09);
    const legFoot = new THREE.Vector3(legTop.x, FLOOR + 0.16, legTop.z);
    const mid = new THREE.Vector3(legTop.x, (legTop.y + legFoot.y) / 2, legTop.z);
    g.add(bar(legFoot, mid, 0.12, M.alu()), bar(mid, legTop, 0.085, steel));
    const fc = boxSpan(-0.2, 0.2, FLOOR + 0.03, FLOOR + 0.16, -0.14, 0.14, M.blueAnod(), 0.008);
    fc.position.set(legFoot.x, fc.position.y, legFoot.z);
    fc.rotation.y = -THREE.MathUtils.degToRad(ARM.deltaDeg);
    g.add(fc);
    const railR = Math.hypot(legFoot.x, legFoot.z);
    g.add(annulus(railR - 0.09, railR + 0.09, 0.03, dark, ARM.railFromDeg, ARM.railToDeg, 120).translateY(FLOOR));
    g.add(annulus(railR - 0.025, railR + 0.025, 0.045, steel, ARM.railFromDeg, ARM.railToDeg, 120).translateY(FLOOR));
    // angle scale on the rail (every 10°)
    for (let a = 0; a <= 60; a += 10) {
      const r = THREE.MathUtils.degToRad(a);
      const tick = boxSpan(-0.012, 0.012, FLOOR + 0.03, FLOOR + 0.05, -0.12, 0.12, M.copper(), 0);
      tick.position.set((railR + 0.16) * Math.cos(r), tick.position.y, (railR + 0.16) * Math.sin(r));
      tick.rotation.y = -r;
      g.add(tick);
    }
  });
}

/** Evacuated flight tube along the diffracted ray, Kapton windows at both ends, saddles on the boom. Origin = tube midpoint. */
export function flightTube(): THREE.Group {
  return inStation(TUBE_MID_REL, (g) => {
    const t = new THREE.Group();
    const L = ARM.tube1 - ARM.tube0;
    t.add(pipeX(0, L, 0.05, M.tube()));
    for (const x of [0, L]) {
      const f = flangeX(0.068);
      f.position.x = x;
      const w = new THREE.Mesh(new THREE.CircleGeometry(0.05, 28), A.kapton());
      w.rotation.y = Math.PI / 2;
      w.position.x = x + (x ? 0.011 : -0.011);
      t.add(f, w);
    }
    for (let i = 1; i < 4; i++) {
      const x = (i * L) / 4;
      // set the position directly: flangeX() is rotated about Z, so translateX() would move it along the tube's +Y
      const mid = flangeX(0.058);
      mid.position.x = x;
      t.add(mid);
      t.add(boxSpan(x - 0.025, x + 0.025, -ARM.below + 0.105, -0.045, -0.03, 0.03, M.steel(), 0.003));
    }
    // vacuum port
    const port = cyl(0.015, 0.08, M.steel(), 12);
    port.position.set(0.25, 0.08, 0);
    t.add(port);
    t.position.copy(onRay(ARM.tube0));
    basis(t, KOUT, KUP);
    g.add(t);
  });
}

/**
 * BCDI photon-counting detector (directory: Timepix-based 512 × 512, 55 µm → 28 mm sensor, drawn at true size) on its
 * carriage at 3.0 m. The face shows a computed Bragg-peak speckle pattern. Origin = sensor centre.
 */
export function bcdiDetector(): THREE.Group {
  return inStation(DET_REL, (g) => {
    const d = new THREE.Group();
    d.add(boxSpan(0.004, 0.26, -0.07, 0.07, -0.07, 0.07, M.detHousing(), 0.01));
    const bezel = boxSpan(0, 0.006, -0.055, 0.055, -0.055, 0.055, M.blackAnod(), 0.002);
    const s = 0.0282;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshStandardMaterial({ map: speckleTexture(), emissive: 0xffffff, emissiveMap: speckleTexture(), emissiveIntensity: 1.1, roughness: 0.5 }));
    face.rotation.y = -Math.PI / 2;
    face.position.x = -0.0008;
    d.add(bezel, face);
    for (let i = 0; i < 6; i++) d.add(boxSpan(0.08 + i * 0.03, 0.09 + i * 0.03, 0.07, 0.1, -0.05, 0.05, M.darkSteel(), 0.002));
    // carriage down to the boom's linear guide
    d.add(boxSpan(0.04, 0.22, -ARM.below + 0.105, -0.07, -0.05, 0.05, M.blueAnod(), 0.004));
    d.position.copy(DET_REL);
    basis(d, KOUT, KUP);
    g.add(d);
  });
}

// ------------------------------------------------------------------ zoom envelope (custom, animated)

/**
 * Converging/diverging beam envelope of the two-stage zoom KB (schematic: lateral size ×~30, one round envelope for both
 * planes, V-mirror distances). KB1 focuses to an intermediate focus that slides between q1 = 1.25 and 13.2 m; KB2 re-images
 * it onto the fixed focus. The footprint on KB2 — hence the numerical aperture and the final spot — is largest when the
 * intermediate focus is close to KB1 (≈50 nm mode, KB2 aperture fully filled: drawn clamped) and smallest when it sits near
 * KB2 (≈2 µm mode). The final cone (KB2 → sample) is drawn a further 5× thinner.
 */
export function zoomEnvelope(): { group: THREE.Group; set: (xI: number, a: THREE.Vector3, i: THREE.Vector3, b: THREE.Vector3, f: THREE.Vector3, rA: number, rB: number) => void } {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0, 1, 1, 28, 1, true);
  geo.translate(0, 0.5, 0); // base (radius 1) at y = 0, apex at y = 1
  const cones = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(geo, A.envelope());
    m.renderOrder = 5;
    m.frustumCulled = false;
    group.add(m);
    return m;
  });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 14, 10), glowMaterial(COLORS.xray, 5));
  group.add(dot);
  const up = new THREE.Vector3(0, 1, 0);
  const place = (m: THREE.Mesh, base: THREE.Vector3, apex: THREE.Vector3, r: number) => {
    const d = apex.clone().sub(base);
    m.position.copy(base);
    m.quaternion.setFromUnitVectors(up, d.clone().normalize());
    m.scale.set(r, d.length(), r);
  };
  return {
    group,
    set: (_xI, a, i, b, f, rA, rB) => {
      place(cones[0], a, i, rA);
      place(cones[1], b, i, rB);
      // final convergence onto the sample: drawn 5× thinner again so close-ups of the sample are not swamped
      place(cones[2], b, f, rB * 0.2);
      dot.position.copy(i);
    },
  };
}

// ------------------------------------------------------------------ 3DMN partner context (simplified)

/**
 * The 3DMN instruments in 34-ID-E, simplified from the 3DMN exhibit (whose own exhibit has the detailed models). Station
 * frame: origin = 3DMN micro sample (60.1 m on the 3DMN beam). Micro: granite base (x −0.62…0.46, z −0.62…0.68, top 0.72 m
 * below the beam), aluminium detector gantry and the 409.6 mm flat-panel detector 0.51 m above the sample. Nano (origin
 * offset `nano`): optical table and the ~2.7 m glass thermal enclosure (64.0–66.7 m) that ATOMIC's shielded pipe crosses.
 */
export function dmnContext(o: { nano: THREE.Vector3; encl: { x0: number; x1: number; zIn: number; zOut: number } }): THREE.Group {
  const g = new THREE.Group();
  const top = -0.72;
  g.add(boxSpan(-0.62, 0.46, FLOOR, top, -0.62, 0.68, M.granite(), 0.01));
  const a = M.alu();
  const s = 0.05;
  const gx = 0.32;
  const gt = 0.74;
  for (const x of [-gx, gx]) for (const z of [-0.55, 0.62]) g.add(bar(new THREE.Vector3(x, top, z), new THREE.Vector3(x, gt + s / 2, z), s, a));
  for (const x of [-gx, gx]) g.add(bar(new THREE.Vector3(x, gt, -0.55), new THREE.Vector3(x, gt, 0.62), s, a));
  for (const z of [-0.55, 0.62, -0.17, 0.17]) g.add(bar(new THREE.Vector3(-gx, gt, z), new THREE.Vector3(gx, gt, z), s * 0.8, a));
  // top flat-panel detector (face down) on four rods
  g.add(boxSpan(-0.235 + 0.03, 0.235 + 0.03, 0.513, 0.568, -0.235, 0.235, M.detHousing(), 0.008));
  for (const x of [-0.18, 0.18]) for (const z of [-0.17, 0.17]) g.add(rod(new THREE.Vector3(x + 0.03, 0.568, z), new THREE.Vector3(x + 0.03, gt, z), 0.009, M.steel()));
  // sample tower (simplified)
  g.add(boxSpan(-0.13, 0.13, top, -0.6, -0.12, 0.12, M.darkSteel(), 0.006), boxSpan(-0.035, 0.035, -0.6, -0.02, -0.035, 0.035, M.steel(), 0.004));
  // nano station
  const n = new THREE.Group();
  n.position.copy(o.nano);
  const navy = new THREE.MeshStandardMaterial({ color: 0x1c2738, roughness: 0.55, metalness: 0.2 });
  n.add(boxSpan(-0.95, 0.75, FLOOR, -0.34, -0.4, 0.45, navy, 0.01), boxSpan(-0.94, 0.74, -0.34, -0.32, -0.39, 0.44, M.blackAnod(), 0.004));
  n.add(boxSpan(-0.2, -0.05, -0.32, -0.04, -0.06, 0.06, M.blackAnod(), 0.004), boxSpan(-0.04, 0.04, -0.32, -0.01, -0.04, 0.04, M.steel(), 0.004));
  n.add(boxSpan(-0.235, 0.235, 0.5, 0.555, -0.235, 0.235, M.detHousing(), 0.008));
  g.add(n);
  const { x0, x1, zIn, zOut } = o.encl;
  const H = 2.35;
  const walls: [number, number, number, number][] = [[x0, zIn, x1, zIn], [x1, zIn, x1, zOut], [x1, zOut, x0, zOut], [x0, zOut, x0, zIn]];
  for (const [xa, za, xb, zb] of walls) {
    const len = Math.hypot(xb - xa, zb - za);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(len, H), M.glass());
    p.renderOrder = 4;
    p.position.set((xa + xb) / 2, FLOOR + H / 2, (za + zb) / 2);
    p.rotation.y = -Math.atan2(zb - za, xb - xa);
    g.add(p);
  }
  for (const x of [x0, (x0 + x1) / 2, x1]) for (const z of [zIn, zOut]) g.add(bar(new THREE.Vector3(x, FLOOR, z), new THREE.Vector3(x, FLOOR + H, z), 0.045, a));
  for (const y of [FLOOR + 0.02, FLOOR + H]) {
    for (const z of [zIn, zOut]) g.add(bar(new THREE.Vector3(x0, y, z), new THREE.Vector3(x1, y, z), 0.045, a));
    for (const x of [x0, x1]) g.add(bar(new THREE.Vector3(x, y, zIn), new THREE.Vector3(x, y, zOut), 0.045, a));
  }
  return shadowed(g);
}

/**
 * Narrow additive cone (apex at the origin, along +Y) for the coherently diffracted beam. Drawn in the monochromatic-beam colour:
 * Bragg diffraction is elastic, so the diffracted X-rays have the incident energy (the exhibit colour, a rose close to the
 * 'pink beam' legend colour, would suggest a polychromatic beam).
 */
export function diffractedFan(len: number, rEnd: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(rEnd, 0.0004, len, 24, 1, true);
  geo.translate(0, len / 2, 0);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: COLORS.xray.clone().multiplyScalar(1.5), transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending }),
  );
  m.renderOrder = 5;
  return m;
}

// ------------------------------------------------------------------ small infrastructure

/** Sealed wall pass-through collar around a pipe (disc normal to X). */
export function collar(rPipe: number, alpha = 1): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(rPipe + 0.002, rPipe + 0.045, 32),
    new THREE.MeshStandardMaterial({ color: 0x9aa5b1, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide, transparent: alpha < 1, opacity: alpha }),
  );
  m.rotation.y = Math.PI / 2;
  return m;
}

/** Floor-to-beam pipe support (for short connecting pipes). */
export function pipeStand(beamY: number, r: number): THREE.Group {
  const g = new THREE.Group();
  g.add(pedestal(0, 0, floorY(beamY), -r, 0.06, 0.16, M.darkSteel()));
  return g;
}

// ------------------------------------------------------------------ textures

let speckleTex: THREE.CanvasTexture | null = null;
/**
 * Bragg-peak speckle around one reflection of a faceted crystal: |FT|² of a hexagonal-ish particle (three facet streak
 * directions), mild asymmetry from strain, log-scaled; 55 µm-pixel module gaps drawn faintly.
 */
function speckleTexture(): THREE.CanvasTexture {
  if (speckleTex) return speckleTex;
  const N = 160;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const sinc2 = (x: number) => (Math.abs(x) < 1e-6 ? 1 : (Math.sin(x) / x) ** 2);
  const dirs = [0, 60, 120].map((a) => [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)]);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const u = (i / N - 0.5) * 2;
      const v = (j / N - 0.5) * 2;
      let I = 1;
      for (const [dx, dy] of dirs) I *= sinc2(9.5 * (u * dx + v * dy) + 0.9 * (u * u - v * v * 0.5));
      I *= 1 + 0.35 * u;
      const s = Math.max(0, Math.min(1, (Math.log10(I + 1e-7) + 7) / 7));
      const k = (j * N + i) * 4;
      // dark → indigo → cyan → white
      const r = s < 0.6 ? 20 + s * 60 : 56 + (s - 0.6) * 495;
      const g = s < 0.35 ? 10 + s * 120 : 52 + (s - 0.35) * 310;
      const b = 40 + s * 215;
      img.data[k] = Math.min(255, r);
      img.data[k + 1] = Math.min(255, g);
      img.data[k + 2] = Math.min(255, b);
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(N / 2, 0);
  ctx.lineTo(N / 2, N);
  ctx.moveTo(0, N / 2);
  ctx.lineTo(N, N / 2);
  ctx.stroke();
  speckleTex = new THREE.CanvasTexture(c);
  speckleTex.colorSpace = THREE.SRGBColorSpace;
  return speckleTex;
}

let laueTex: THREE.CanvasTexture | null = null;
/** Pink-beam Laue starburst: spots on a few zone curves, coloured by energy. */
function laueTexture(): THREE.CanvasTexture {
  if (laueTex) return laueTex;
  const W = 128;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#05080d';
  ctx.fillRect(0, 0, W, H);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const zones = [
    (t: number) => [W * 0.5 + (t - 0.5) * W * 0.9, H * 0.5 + Math.sin(t * Math.PI) * 40 - 20],
    (t: number) => [W * 0.2 + t * W * 0.6, H * (0.1 + t * 0.8)],
    (t: number) => [W * 0.85 - t * W * 0.7, H * (0.15 + t * 0.75)],
    (t: number) => [W * 0.5 + Math.sin(t * 6.2) * 30, H * t],
  ];
  const hues = ['#ff5d73', '#ff9f43', '#ffe066', '#7cf29a', '#5cd3ff', '#9b8cff'];
  for (const z of zones)
    for (let k = 0; k < 9; k++) {
      const [x, y] = z(rnd());
      ctx.fillStyle = hues[Math.floor(rnd() * hues.length)];
      ctx.beginPath();
      ctx.arc(x, y, 2 + rnd() * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.strokeStyle = 'rgba(120,150,190,0.35)';
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  laueTex = new THREE.CanvasTexture(c);
  laueTex.colorSpace = THREE.SRGBColorSpace;
  return laueTex;
}

