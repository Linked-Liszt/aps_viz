import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPart } from '../../scene/beamline/parts';
import { COLORS } from '../../scene/palette';
import { FLOOR, M1_SEP, MONO_OFFSET } from './geom';
import { M, beamSeg, box, boxSpan, cyl, flangeX, pedestal, pipeX, rod, shadowed, vesselBox } from './kit';

const WHITE = new THREE.Color(1.0, 0.93, 0.82);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ source straight

/**
 * Interim in-line source (ID table, 22 Sep 2026): U21 upstream, revolver U21/U25 downstream, 2.35 m each, centred at
 * ±1.3 m. The revolver carries a second (parked) magnet structure on its turret, drawn on the inboard side
 * (schematic: the parked orientation is not published). A small phase-shifter/corrector sits between the devices.
 */
export function undulatorU21(beamY: number, opts: { revolver?: boolean; phaseShifterAt?: number } = {}): THREE.Group {
  const g = buildPart('undulator', 'U21', { beamY, lengthM: 2.35, periodMm: 21 });
  if (opts.revolver) {
    const L = 2.35;
    const n = Math.round((L * 1000) / 12.5); // 25 mm period: half-period blocks
    const bw = L / n;
    const red = new THREE.MeshStandardMaterial({ color: 0xb04848, roughness: 0.45, metalness: 0.4 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x3a62b8, roughness: 0.45, metalness: 0.4 });
    for (const [z, mat] of [[-0.215, red], [-0.365, blue]] as const) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(bw * 0.9, 0.12, 0.11), mat, n);
      const d = new THREE.Object3D();
      for (let i = 0; i < n; i++) {
        d.position.set(-L / 2 + (i + 0.5) * bw, 0, z);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
      }
      g.add(im);
    }
    // turret end plates: the two structures rotate about an axis parallel to the beam
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 40, 1, false, Math.PI * 0.55, Math.PI * 0.9), M.darkSteel());
      plate.rotation.z = Math.PI / 2;
      plate.position.x = (s * L) / 2 + s * 0.03;
      g.add(plate);
    }
  }
  if (opts.phaseShifterAt !== undefined) {
    const ps = new THREE.Group();
    ps.position.x = opts.phaseShifterAt;
    ps.add(boxSpan(-0.08, 0.08, 0.03, 0.2, -0.12, 0.16, M.blueAnod(), 0.01), boxSpan(-0.08, 0.08, -0.2, -0.03, -0.12, 0.16, M.blueAnod(), 0.01));
    ps.add(boxSpan(-0.08, 0.08, -0.2, 0.2, 0.16, 0.24, M.blueAnod(), 0.01));
    ps.add(pedestal(0, 0.05, FLOOR, -0.2, 0.12, 0.24, M.darkSteel()));
    g.add(ps);
  }
  return shadowed(g);
}

// ------------------------------------------------------------------ shielding hardware

/** Bremsstrahlung collimator / photon mask: a heavy block on a stand with dark apertures on both faces. */
export function shieldBlock(o: { len?: number; w?: number; h?: number; mat?: 'lead' | 'tungsten' | 'copper'; hole?: number; z?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  const len = o.len ?? 0.25;
  const w = o.w ?? 0.3;
  const h = o.h ?? 0.3;
  const mat = o.mat === 'tungsten' ? M.tungsten() : o.mat === 'copper' ? M.copper() : M.lead();
  g.add(box(len, h, w, mat, 0.01));
  for (const s of [-1, 1]) {
    const ap = new THREE.Mesh(new THREE.PlaneGeometry(o.hole ?? 0.02, o.hole ?? 0.02), M.hole());
    ap.rotation.y = (s * Math.PI) / 2;
    ap.position.set((s * (len + 0.002)) / 2, 0, o.z ?? 0);
    g.add(ap);
  }
  g.add(pipeX(-len / 2 - 0.2, -len / 2, 0.03), pipeX(len / 2, len / 2 + 0.2, 0.03));
  g.add(pedestal(0, 0, FLOOR, -h / 2, len * 0.8, w * 0.8, M.darkSteel()));
  return shadowed(g);
}

/** Window flange (thin diamond/Be disc between two flanges) with a short stand. */
export function windowFlange(o: { diamond?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const f1 = flangeX(0.075);
  f1.position.x = -0.012;
  const f2 = flangeX(0.075);
  f2.position.x = 0.012;
  const disc = cyl(0.028, 0.003, o.diamond ? M.diamond() : new THREE.MeshStandardMaterial({ color: 0xa9b3bd, roughness: 0.4, metalness: 0.6 }), 24);
  disc.rotation.z = Math.PI / 2;
  g.add(f1, f2, disc, pipeX(-0.25, -0.02, 0.03), pipeX(0.02, 0.25, 0.03));
  g.add(pedestal(0, 0, FLOOR, -0.08, 0.1, 0.12, M.darkSteel()));
  return shadowed(g);
}

/** 20-ID-A downstream end: Be window (33.9 m), photon mask PM-1 (34.0 m), tungsten collimator BC-1 (34.4 m). */
export function maskCollimatorTrio(): THREE.Group {
  const g = new THREE.Group();
  const w = windowFlange();
  w.position.x = -0.1;
  const pm = shieldBlock({ len: 0.16, w: 0.22, h: 0.22, mat: 'copper', hole: 0.012 });
  const bc = shieldBlock({ len: 0.25, w: 0.34, h: 0.34, mat: 'tungsten', hole: 0.016 });
  bc.position.x = 0.4;
  g.add(w, pm, bc);
  return g;
}

/** 20-ID-D entrance: photon mask PM-2 (66.2), tungsten collimator BC-2 (66.5), Be window (66.8). */
export function dEntrance(): THREE.Group {
  const g = new THREE.Group();
  const pm = shieldBlock({ len: 0.16, w: 0.22, h: 0.22, mat: 'copper', hole: 0.012 });
  const bc = shieldBlock({ len: 0.22, w: 0.34, h: 0.34, mat: 'tungsten', hole: 0.016 });
  bc.position.x = 0.3;
  const w = windowFlange();
  w.position.x = 0.6;
  g.add(pm, bc, w);
  return g;
}

/** Movable (or fixed) cooled beam stop: copper/tungsten core in a lead house, water lines; `lift` raises it out of the beam. */
export function beamStopBlock(o: { lift?: number; fixed?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const lift = o.lift ?? 0;
  const body = new THREE.Group();
  body.position.y = lift;
  body.add(box(0.36, 0.42, 0.42, M.lead(), 0.012));
  const core = box(0.38, 0.12, 0.16, M.copper(), 0.008);
  body.add(core);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.02, 20), M.hole());
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.192;
  body.add(face);
  for (const z of [-0.06, 0.06]) body.add(pipeX(-0.1, 0.1, 0.01, M.steel(), 0.26, z), rod(v(0.1, 0.26, z), v(0.1, 0.5, z), 0.01, M.steel()));
  g.add(body);
  if (!o.fixed) {
    // vertical actuator
    g.add(boxSpan(-0.06, 0.06, 0.21 + lift, 0.55 + lift, -0.06, 0.06, M.darkSteel(), 0.006));
  }
  g.add(pedestal(0, 0, FLOOR, -0.21 + Math.min(0, lift), 0.3, 0.34, M.darkSteel()));
  return shadowed(g);
}

// ------------------------------------------------------------------ monochromators

/**
 * M1: LN2-cooled bent double-Laue Si(111) monochromator (Cinel, 20-ID-A, 29.5 m). Hero model, origin on the WHITE-beam
 * axis at the tank centre. Crystal 1 (−M1_SEP/2) diffracts horizontally outboard by 2θB; crystal 2 (+M1_SEP/2) sends the
 * beam on parallel, MONO_OFFSET (30 mm) outboard. The white beam transmitted through crystal 1 ends in the built-in
 * white-beam stop, which sits between the crystals on the white-beam axis, just clear of the diffracted ray.
 * LN2 lines run from each crystal's cooled clamps through the open lid to a closed-loop cryocooler standing outboard
 * (cooler size and position schematic).
 * Visual liberties: crystal thickness 4 mm (≈2.5 mm real) and the cylindrical bend (true radius ~15 m, invisible) drawn
 * with ~0.35 m radius so it reads; inter-crystal distance and the 30 mm offset are true (70 keV setting, see geom.ts).
 */
export function bentLaueMono(): THREE.Group {
  const g = new THREE.Group();
  const L = 1.1;
  // vacuum tank drawn without its lid (museum cut-away): drop the +y face (BoxGeometry face groups are
  // +x,−x,+y,−y,+z,−z) so the shell is one single-material mesh that static batching can merge
  const tankGeo = new THREE.BoxGeometry(L, 0.42, 0.46);
  const lid = tankGeo.groups[2];
  const shellIdx = Array.from(tankGeo.index!.array);
  shellIdx.splice(lid.start, lid.count);
  const shellGeo = tankGeo.clone();
  shellGeo.setIndex(shellIdx);
  shellGeo.clearGroups();
  const tank = new THREE.Mesh(shellGeo, M.vessel());
  tank.renderOrder = 3;
  tank.position.z = 0.015;
  const tankEdges = new THREE.LineSegments(new THREE.EdgesGeometry(tankGeo), M.vesselEdge());
  tankEdges.position.z = 0.015;
  g.add(tank, tankEdges);
  // base plate
  g.add(boxSpan(-L / 2 - 0.05, L / 2 + 0.05, -0.27, -0.21, -0.25, 0.28, M.steel(), 0.01));
  const x1 = -M1_SEP / 2;
  const x2 = M1_SEP / 2;
  const crystal = (x: number, z: number) => {
    const c = new THREE.Group();
    c.position.set(x, 0, z);
    // thin bent wafer: a narrow arc of a vertical cylinder (axis along Y), convex upstream
    const R = 0.35;
    const span = 0.09 / R;
    const wafer = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.06, 16, 1, true, Math.PI / 2 - span / 2 + Math.PI, span), M.laue());
    (wafer.material as THREE.Material).side = THREE.DoubleSide;
    wafer.position.x = R;
    const wafer2 = wafer.clone();
    wafer2.position.x = R + 0.004;
    c.add(wafer, wafer2);
    // four-point bender clamps (copper, LN2-cooled) top and bottom
    for (const y of [-1, 1]) {
      c.add(boxSpan(-0.018, 0.022, y * 0.03, y * 0.05, -0.055, 0.055, M.copper(), 0.004));
      for (const zz of [-0.036, 0.036]) c.add(boxSpan(-0.012, 0.016, y * 0.05, y * 0.075, zz - 0.008, zz + 0.008, M.darkSteel(), 0.002));
    }
    // goniometer / translation stage under the crystal
    c.add(boxSpan(-0.06, 0.06, -0.13, -0.07, -0.08, 0.08, M.darkSteel(), 0.006), cyl(0.05, 0.08, M.blackAnod(), 24).translateY(-0.17));
    return c;
  };
  g.add(crystal(x1, 0), crystal(x2, MONO_OFFSET));
  // closed-loop LN2 cryocooler on the floor outboard of the tank; flexible transfer lines from each crystal's clamps
  const coolX = 0;
  const coolZ = 0.82;
  const coolTop = 0.12;
  g.add(boxSpan(coolX - 0.3, coolX + 0.3, FLOOR, coolTop, coolZ - 0.22, coolZ + 0.22, M.alu(), 0.03));
  g.add(boxSpan(coolX - 0.24, coolX + 0.24, coolTop, coolTop + 0.05, coolZ - 0.16, coolZ + 0.16, M.blackAnod(), 0.01));
  for (const [x, z, k] of [[x1, 0, -1], [x2, MONO_OFFSET, 1]] as const) {
    const end = v(coolX + k * 0.12, coolTop + 0.05, coolZ);
    const curve = new THREE.CatmullRomCurve3([v(x, 0.07, z + 0.03), v(x, 0.24, z + 0.05), v(x * 0.7, 0.4, 0.3), v(end.x, 0.36, coolZ - 0.05), end]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.012, 8), M.ln2()));
  }
  // crystal-2 travel rail (keeps the 30 mm offset fixed as the energy changes)
  g.add(boxSpan(-0.15, L / 2 - 0.05, -0.21, -0.19, MONO_OFFSET - 0.05, MONO_OFFSET + 0.05, M.rail(), 0.003));
  // beams inside the tank: white in, mono diagonal between the crystals and out; transmitted white into the stop
  g.add(beamSeg(v(x1, 0, 0), v(x2, 0, MONO_OFFSET), 0.0028, COLORS.xray, 3.2));
  // built-in white-beam stop between the crystals: tungsten-faced copper block on the white axis. Its outboard edge
  // (+10 mm) clears the diffracted ray, which is already ~23 mm outboard there (true geometry at 70 keV).
  const stopX = x2 - 0.12;
  g.add(beamSeg(v(x1, 0, 0), v(stopX, 0, 0), 0.0025, WHITE, 1.6));
  g.add(boxSpan(stopX, stopX + 0.06, -0.035, 0.035, -0.04, 0.01, M.copper(), 0.004), boxSpan(stopX - 0.004, stopX, -0.028, 0.028, -0.032, 0.007, M.tungsten(), 0));
  g.add(boxSpan(stopX + 0.01, stopX + 0.05, -0.21, -0.035, -0.03, 0.0, M.darkSteel(), 0.003));
  // flanged pipes: entrance on the white axis, exit on the mono axis
  g.add(flangeX(0.08).translateX(-L / 2 - 0.01), pipeX(-L / 2 - 0.3, -L / 2, 0.035));
  const fe = flangeX(0.08);
  fe.position.set(L / 2 + 0.01, 0, MONO_OFFSET);
  g.add(fe, pipeX(L / 2, L / 2 + 0.3, 0.035, M.steel(), 0, MONO_OFFSET));
  // support frame
  g.add(pedestal(0, 0.015, FLOOR, -0.27, 0.8, 0.5, M.granite()));
  return shadowed(g);
}

/**
 * M2: optional in-line (+−−+) four-reflection Si monochromator (20-ID-A, 31.8 m), vertical diffraction, in air, no net
 * offset. Two crystal pairs on weak-link flexure stages; apertures after the 2nd and 4th reflections.
 * Visual liberties: the Bragg angle (drawn 2θ ≈ 6°, real 3.2° for Si(111) at 70 keV) and the vertical beam excursion
 * (drawn 30 mm) are exaggerated ~2–3× so the up-and-back-down path reads.
 */
export function fourBounceMono(): THREE.Group {
  const g = new THREE.Group();
  const h = 0.03;
  const tw = (6 * Math.PI) / 180;
  const run = h / Math.tan(tw);
  // reflection points along x: A (low, faces up), B (high, faces down) | C (high, faces down), D (low, faces up)
  const xA = -run - 0.08;
  const xB = -0.08;
  const xC = 0.08;
  const xD = run + 0.08;
  const crystal = (x: number, y: number, facesUp: boolean) => {
    const c = new THREE.Group();
    c.position.set(x, y, 0);
    const slab = boxSpan(-0.06, 0.06, facesUp ? -0.03 : 0, facesUp ? 0 : 0.03, -0.03, 0.03, M.silicon(), 0.002);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.055), new THREE.MeshStandardMaterial({ color: 0xdfe8f5, roughness: 0.05, metalness: 1 }));
    face.rotation.x = facesUp ? -Math.PI / 2 : Math.PI / 2;
    face.position.y = facesUp ? 0.0006 : -0.0006;
    c.add(slab, face);
    // weak-link flexure block
    c.add(boxSpan(-0.05, 0.05, facesUp ? -0.07 : 0.03, facesUp ? -0.03 : 0.07, -0.035, facesUp ? 0.035 : 0.046, M.alu(), 0.003));
    return c;
  };
  g.add(crystal(xA, 0, true), crystal(xB, h, false), crystal(xC, h, false), crystal(xD, 0, true));
  // pair carriers on rotation stages
  for (const [x0, x1] of [[xA, xB], [xC, xD]] as const) {
    const cx = (x0 + x1) / 2;
    // L-shaped carrier: base plate plus an outboard back plate holding the upper (downward-facing) crystal, open on
    // top and inboard so the four reflections stay visible
    g.add(boxSpan(Math.min(x0, x1) - 0.08, Math.max(x0, x1) + 0.08, -0.1, -0.07, -0.06, 0.06, M.darkSteel(), 0.004));
    g.add(boxSpan(Math.min(x0, x1) - 0.08, Math.max(x0, x1) + 0.08, -0.07, 0.11, 0.045, 0.06, M.darkSteel(), 0.003));
    g.add(cyl(0.09, 0.05, M.blackAnod(), 32).translateX(cx).translateY(-0.13));
  }
  // apertures after reflections 2 and 4
  for (const [x, y] of [[0, h], [xD + 0.1, 0]] as const) {
    const ap = new THREE.Group();
    ap.position.set(x, y, 0);
    ap.add(boxSpan(-0.004, 0.004, 0.006, 0.05, -0.04, 0.04, M.tungsten(), 0), boxSpan(-0.004, 0.004, -0.05, -0.006, -0.04, 0.04, M.tungsten(), 0));
    g.add(ap);
  }
  // beam path (+ − − +): up, level, down, level
  const c = COLORS.xray;
  g.add(beamSeg(v(-0.55, 0, 0), v(xA, 0, 0), 0.0022, c, 2.2), beamSeg(v(xA, 0, 0), v(xB, h, 0), 0.0022, c, 2.6));
  g.add(beamSeg(v(xB, h, 0), v(xC, h, 0), 0.0022, c, 2.6), beamSeg(v(xC, h, 0), v(xD, 0, 0), 0.0022, c, 2.6), beamSeg(v(xD, 0, 0), v(0.55, 0, 0), 0.0022, c, 2.2));
  // optical breadboard on a granite stand; in-air: windows on the pipe ends
  g.add(boxSpan(-0.48, 0.48, -0.2, -0.15, -0.22, 0.22, M.steel(), 0.006));
  g.add(pedestal(0, 0, FLOOR, -0.2, 0.7, 0.4, M.granite()));
  for (const s of [-1, 1]) {
    const f = flangeX(0.06);
    f.position.x = s * 0.5;
    g.add(f, pipeX(s * 0.5, s * 0.7, 0.03));
  }
  return shadowed(g);
}

/** Wheel-actuated attenuator (F2) and calibration-foil (F3) units sharing a stand. */
export function wheelAttenuators(): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-0.12, 0.12]) {
    const housing = cyl(0.13, 0.05, M.alu(), 32);
    housing.rotation.z = Math.PI / 2;
    housing.position.set(x, 0.11, 0);
    const motor = cyl(0.03, 0.08, M.blackAnod(), 16);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(x + 0.06, 0.11, 0);
    g.add(housing, motor);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const foil = cyl(0.022, 0.004, i % 2 ? M.copper() : M.tungsten(), 16);
      foil.rotation.z = Math.PI / 2;
      foil.position.set(x - 0.028, 0.11 + Math.cos(a) * 0.08, Math.sin(a) * 0.08);
      g.add(foil);
    }
  }
  g.add(pipeX(-0.35, 0.35, 0.03), pedestal(0, 0, FLOOR, -0.04, 0.4, 0.22, M.darkSteel()));
  return shadowed(g);
}

/** Compound refractive lens stack in a cut-away housing on a vertical insertion stage (↕ in FDR Fig. 4.19). */
export function lensStack(o: { n?: number; diamond?: boolean; cooled?: boolean; stand?: boolean; housing?: number; actuator?: boolean; pipes?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const n = o.n ?? 10;
  const pitch = 0.018;
  const len = n * pitch + 0.08;
  const hw = o.housing ?? 0.12;
  const housing = vesselBox(len, hw * 1.3, hw);
  g.add(housing);
  // the n lenses and their n holder rings are each ONE merged mesh (2 draw calls per stack instead of 2n)
  const lensProto = new THREE.SphereGeometry(0.016, 16, 10).scale(0.3, 1, 1);
  const holderProto = new THREE.TorusGeometry(0.018, 0.004, 6, 20).rotateY(Math.PI / 2);
  const lensGeos: THREE.BufferGeometry[] = [];
  const holderGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + 0.04 + i * pitch;
    lensGeos.push(lensProto.clone().translate(x, 0, 0));
    holderGeos.push(holderProto.clone().translate(x, 0, 0));
  }
  g.add(new THREE.Mesh(mergeGeometries(lensGeos), o.diamond ? M.diamond() : M.lens()), new THREE.Mesh(mergeGeometries(holderGeos), M.alu()));
  if (o.cooled) {
    for (const z of [-hw / 2 - 0.01, hw / 2 + 0.01]) g.add(boxSpan(-len / 2, len / 2, -0.03, 0.03, z - 0.008, z + 0.008, M.copper(), 0.003));
  }
  // vertical insertion actuator
  if (o.actuator !== false) g.add(boxSpan(-0.04, 0.04, hw * 0.65, hw * 0.65 + 0.16, -0.04, 0.04, M.darkSteel(), 0.004));
  if (o.pipes !== false) g.add(pipeX(-len / 2 - 0.12, -len / 2, 0.025), pipeX(len / 2, len / 2 + 0.12, 0.025));
  if (o.stand !== false) g.add(pedestal(0, 0, FLOOR, -hw * 0.65, 0.18, 0.18, M.darkSteel()));
  return shadowed(g);
}

/** Motorised four-blade slits (compact, on a post). */
export function slitBox(o: { stand?: boolean; size?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  const s = o.size ?? 0.16;
  g.add(boxSpan(-0.03, 0.03, -s / 2, s / 2, -s / 2, s / 2, M.alu(), 0.006));
  const ap = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.012), M.hole());
  ap.rotation.y = -Math.PI / 2;
  ap.position.x = -0.031;
  g.add(ap);
  for (const [y, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const m = cyl(0.016, 0.07, M.blackAnod(), 12);
    if (z) m.rotation.x = Math.PI / 2;
    m.position.set(0, y * (s / 2 + 0.035), z * (s / 2 + 0.035));
    g.add(m);
  }
  g.add(pipeX(-0.15, -0.03, 0.025), pipeX(0.03, 0.15, 0.025));
  if (o.stand !== false) g.add(pedestal(0, 0, FLOOR, -s / 2, 0.12, 0.12, M.darkSteel()));
  return shadowed(g);
}

/** Compact fast shutter (rotary blade in a small housing). */
export function fastShutter(o: { stand?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(-0.03, 0.03, -0.06, 0.1, -0.06, 0.06, M.blackAnod(), 0.006));
  const motor = cyl(0.03, 0.06, M.alu(), 16);
  motor.position.y = 0.13;
  g.add(motor, pipeX(-0.12, -0.03, 0.02), pipeX(0.03, 0.12, 0.02));
  if (o.stand !== false) g.add(pedestal(0, 0, FLOOR, -0.06, 0.1, 0.1, M.darkSteel()));
  return shadowed(g);
}

/** Ion chamber (beam-intensity monitor). */
export function ionChamber(): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(-0.06, 0.06, -0.05, 0.05, -0.05, 0.05, M.blueAnod(), 0.006));
  g.add(cyl(0.008, 0.06, M.steel(), 8).translateY(0.08));
  return shadowed(g);
}
