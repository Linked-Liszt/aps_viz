import * as THREE from 'three';
import { E_TABLE, TRANSPORT_STANDS } from './geom';
import { glowMaterial, COLORS } from '../../scene/palette';
import { box, cyl, cylX, flangeX, hose, pedestal, pipeX, shadowed, strut, v3, vesselBox, vesselCylY, xm } from './kit';

/** Shielding block (mask / collimator / stop) with a beam aperture, on a short stand. */
export function shieldBlock(o: {
  beamY: number;
  len: number;
  w?: number;
  h?: number;
  mat: 'copper' | 'tungsten' | 'lead';
  hole?: number;
  water?: boolean;
}): THREE.Group {
  const g = new THREE.Group();
  const w = o.w ?? 0.26;
  const h = o.h ?? 0.26;
  const m = o.mat === 'copper' ? xm.copper() : o.mat === 'tungsten' ? xm.tungsten() : xm.lead();
  const hole = o.hole ?? 0.012;
  // four slabs around a square aperture so the beam visibly threads through
  const side = (w - hole) / 2;
  const vert = (h - hole) / 2;
  for (const s of [-1, 1]) {
    const a = box(o.len, h, side, m, 0.006);
    a.position.z = s * (hole / 2 + side / 2);
    const b = box(o.len, vert, hole + 0.002, m, 0.002);
    b.position.y = s * (hole / 2 + vert / 2);
    g.add(a, b);
  }
  if (o.water) {
    for (const s of [-1, 1]) g.add(hose([v3(-o.len * 0.3, h / 2, s * 0.05), v3(-o.len * 0.3, h / 2 + 0.12, s * 0.05), v3(-o.len * 0.3, h / 2 + 0.2, s * 0.22)], 0.012, xm.waterHose()));
  }
  g.add(pedestal(o.beamY, -h / 2, Math.min(o.len, 0.24), Math.min(w, 0.24), xm.darkSteel()));
  return shadowed(g);
}

/** Small mode-switch mask: a copper block on a vertical translation stage (set per beam mode). */
export function modeSwitchMask(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const block = box(0.1, 0.08, 0.12, xm.copper(), 0.006);
  block.position.y = -0.02;
  const stage = box(0.16, 0.16, 0.16, xm.steel(), 0.01);
  stage.position.y = 0.14;
  const motor = cyl(0.03, 0.12, xm.black(), 14);
  motor.position.y = 0.28;
  const vac = vesselBox(0.18, 0.2, 0.18);
  g.add(block, stage, motor, vac, pipeX(-0.25, 0.25, 0.025), pedestal(beamY, -0.1, 0.14, 0.14, xm.darkSteel()));
  return shadowed(g);
}

/**
 * Horizontal double-crystal monochromator: vertical cylindrical tank (Ø ~0.86 m in the plan), two LN2-cooled Si crystals
 * standing on edge so the Bragg reflection is in the horizontal plane (θ ≈ 13° drawn, the FDR Si(111) case at 8.8 keV).
 * The crystal separation is enlarged for visibility (the real exit offset is 10–15 mm).
 */
export function hdcm(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const tank = vesselCylY(0.43, 0.8);
  tank.position.y = 0.0;
  const lid = cyl(0.45, 0.05, xm.steel(), 40);
  lid.position.y = 0.42;
  const bottom = cyl(0.45, 0.06, xm.steel(), 40);
  bottom.position.y = -0.43;
  g.add(tank, lid, bottom);
  // Bragg geometry: crystal 1 surface centred on the incoming axis, crystal 2 parallel and offset outboard by `sep`
  // (enlarged ×2.7 from 15 mm); the short glowing segment is the beam bouncing between them.
  const th = 13 * (Math.PI / 180);
  const sep = 0.04;
  const dx = sep / Math.tan(2 * th);
  const x1 = -dx / 2;
  const x2 = dx / 2;
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  for (const [x, z, s] of [[x1, 0, -1], [x2, sep, 1]] as const) {
    const xtal = box(0.12, 0.07, 0.035, xm.silicon(), 0.004);
    xtal.position.set(x - s * 0.0175 * sn, 0, z + s * 0.0175 * cs);
    xtal.rotation.y = -th;
    const holder = box(0.14, 0.09, 0.03, xm.copper(), 0.004);
    holder.position.set(x - s * 0.05 * sn, 0, z + s * 0.05 * cs);
    holder.rotation.y = -th;
    g.add(xtal, holder);
  }
  g.add(strut(v3(x1, 0, 0), v3(x2, 0, sep), 0.0025, glowMaterial(COLORS.xray, 3)));
  // rotation stage and crystal cage
  const stage = cyl(0.2, 0.08, xm.darkSteel(), 32);
  stage.position.y = -0.33;
  const post = box(0.06, 0.25, 0.06, xm.steel(), 0.005);
  post.position.y = -0.17;
  g.add(stage, post);
  // LN2 lines (inlet/outlet) out of the lid
  for (const s of [-1, 1]) g.add(hose([v3(s * 0.08, 0.44, 0.1), v3(s * 0.08, 0.85, 0.12), v3(s * 0.1, 1.15, 0.5), v3(s * 0.1, 1.15, 1.05)], 0.03, xm.hose()));
  // flanges and stand
  g.add(pipeX(-0.7, -0.43, 0.035), pipeX(0.43, 0.7, 0.035), flangeX(-0.43, 0.08), flangeX(0.43, 0.08));
  g.add(pedestal(beamY, -0.46, 0.85, 0.85, xm.granite()));
  return shadowed(g);
}

/** Draw the double multilayer monochromator as a translucent model because its installation is unconfirmed. */
export function dmmGhost(beamY: number): THREE.Group {
  const g = new THREE.Group();
  g.add(vesselBox(1.0, 0.42, 0.5, true));
  const mlMat = new THREE.MeshStandardMaterial({ color: 0xb79cff, roughness: 0.2, metalness: 0.4, transparent: true, opacity: 0.55, depthWrite: false });
  for (const [x, z] of [[-0.18, -0.03], [0.18, 0.03]] as const) {
    const ml = box(0.3, 0.05, 0.03, mlMat, 0.003);
    ml.position.set(x, 0, z);
    ml.rotation.y = 0.01;
    g.add(ml);
  }
  const stand = pedestal(beamY, -0.21, 0.8, 0.45, xm.ghost());
  g.add(stand);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(stand.geometry), xm.ghostEdge());
  edges.position.copy(stand.position);
  g.add(edges);
  return g;
}

/**
 * Be-lens transfocator (12 stacks, FDR Table 4.35): UHV housing with one pneumatic actuator per stack. Some stacks are
 * drawn inserted (on the beam) and some retracted, to show the "zoom" principle. Lens cartridges enlarged for visibility.
 */
export function transfocator(beamY: number, inserted: number[] = [1, 4, 7, 8]): THREE.Group {
  const g = new THREE.Group();
  const n = 12;
  const pitch = 0.05;
  const L = n * pitch + 0.14;
  g.add(vesselBox(L, 0.3, 0.24));
  for (let i = 0; i < n; i++) {
    const x = -((n - 1) * pitch) / 2 + i * pitch;
    const isIn = inserted.includes(i);
    const yC = isIn ? 0 : 0.08;
    const cart = box(0.03, 0.06, 0.06, xm.alu(), 0.004);
    cart.position.set(x, yC, 0);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 8), xm.lens());
    lens.scale.set(0.45, 1, 1);
    lens.position.set(x - 0.016, yC, 0);
    const rod = cyl(0.006, 0.12 - yC + 0.05, xm.steel(), 8);
    rod.position.set(x, yC + 0.03 + (0.12 - yC + 0.05) / 2, 0);
    const act = cyl(0.016, 0.1, i < 9 ? xm.black() : xm.darkSteel(), 12);
    act.position.set(x, 0.25, 0);
    g.add(cart, lens, rod, act);
  }
  // water cooling manifold along the outboard side
  g.add(hose([v3(-L / 2, -0.05, 0.13), v3(L / 2, -0.05, 0.13)], 0.012, xm.waterHose()));
  g.add(pipeX(-L / 2 - 0.12, -L / 2, 0.03), pipeX(L / 2, L / 2 + 0.12, 0.03), flangeX(-L / 2, 0.07), flangeX(L / 2, 0.07));
  // X translation stage (±15 mm to follow the pink/mono beam shift) on a pedestal
  const stage = box(L * 0.9, 0.06, 0.34, xm.darkSteel(), 0.006);
  stage.position.y = -0.18;
  g.add(stage, pedestal(beamY, -0.21, L * 0.6, 0.3, xm.granite()));
  return shadowed(g);
}

/** Supports and lead collars along the 11 m shielded transport (the engine draws the pipe itself). Local origin at 36.0 m. */
export function transportSupports(beamY: number, x0: number): THREE.Group {
  const g = new THREE.Group();
  for (const x of TRANSPORT_STANDS) {
    const collar = cylX(0.135, 0.32, xm.lead(), 24);
    collar.position.x = x - x0;
    const p = pedestal(beamY, -0.13, 0.18, 0.26, xm.darkSteel());
    p.position.x = x - x0;
    const foot = box(0.4, 0.03, 0.4, xm.steel(), 0.004);
    foot.position.set(x - x0, -beamY + 0.015, 0);
    g.add(collar, p, foot);
  }
  // wall sleeves where the pipe leaves 8-ID-A (36.0 m) and enters 8-ID-D (46.8 m)
  for (const x of [36.0, 46.8]) {
    const sleeve = box(0.35, 0.36, 0.36, xm.lead(), 0.01);
    sleeve.position.x = x - x0;
    g.add(sleeve);
  }
  return shadowed(g);
}

/** Lead sleeve through a shield wall around a short pipe. */
export function wallSleeve(): THREE.Group {
  const g = new THREE.Group();
  const s = box(0.3, 0.34, 0.34, xm.lead(), 0.01);
  g.add(s, pipeX(-0.35, 0.35, 0.03));
  return shadowed(g);
}

/**
 * 8-ID-E upstream 6-DOF table (PDR TC1) carrying attenuators, the experiment shutter and the mono-beam slits SL-5,
 * with a narrow nose under the Be window and guard slits. Local origin at 54.8 m (SL-5).
 */
export function eOpticsTable(beamY: number, x0: number): THREE.Group {
  const g = new THREE.Group();
  const T = E_TABLE;
  const len = T.x1 - T.x0;
  // massive dark-grey body on four jacks
  const body = box(len, 0.5, T.half * 2, xm.base(), 0.02);
  body.position.set((T.x0 + T.x1) / 2 - x0, T.top - 0.25, 0);
  const top = box(len, 0.04, T.half * 2, xm.tableTop(), 0.004);
  top.position.set((T.x0 + T.x1) / 2 - x0, T.top - 0.02, 0);
  g.add(body, top);
  const nose = box(T.noseX1 - T.x1 + 0.1, 0.08, T.noseHalf * 2, xm.base(), 0.01);
  nose.position.set((T.x1 - 0.1 + T.noseX1) / 2 - x0, T.top - 0.04, 0);
  g.add(nose);
  const jackH = beamY + T.top - 0.5;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const jack = cyl(0.07, jackH, xm.darkSteel(), 16);
      jack.position.set((T.x0 + T.x1) / 2 - x0 + sx * (len / 2 - 0.16), -beamY + jackH / 2, sz * (T.half - 0.12));
      g.add(jack);
    }
  // devices on the table top, upstream → downstream
  const att = box(0.14, 0.2, 0.16, xm.steel(), 0.01);
  att.position.set(54.42 - x0, 0.03, 0);
  for (let i = 0; i < 4; i++) {
    const a = cyl(0.012, 0.09, xm.black(), 10);
    a.position.set(54.42 - x0 - 0.045 + i * 0.03, 0.17, 0);
    g.add(a);
  }
  const shutter = box(0.08, 0.18, 0.12, xm.shutterYellow(), 0.008);
  shutter.position.set(54.6 - x0, 0.03, 0);
  const sl = box(0.06, 0.18, 0.18, xm.darkSteel(), 0.006);
  sl.position.set(0, 0, 0);
  g.add(att, shutter, sl);
  for (const [x, h] of [[54.42, 0.27], [54.6, 0.26], [0 + x0, 0.26]] as const) {
    const post = box(0.06, h - 0.1, 0.06, xm.steel(), 0.004);
    post.position.set(x - x0, T.top + (h - 0.1) / 2, 0);
    g.add(post);
  }
  g.add(pipeX(54.3 - x0, 55.02 - x0, 0.018));
  return shadowed(g);
}

/**
 * Compact bendable KB pair on the 8-ID-E table: VKB (200 mm, below the beam, face up) then HKB (100 mm, beside the beam),
 * Pt-coated, in a small vacuum vessel. Lengths from the PDR.
 */
export function kbPair(tableTop: number): THREE.Group {
  const g = new THREE.Group();
  g.add(vesselBox(0.5, 0.26, 0.26));
  const vkb = box(0.2, 0.03, 0.04, xm.silicon(), 0.003);
  vkb.position.set(-0.1, -0.017, 0);
  const vFace = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.03), xm.pt());
  vFace.rotation.x = -Math.PI / 2;
  vFace.position.set(-0.1, -0.0015, 0);
  const hkb = box(0.1, 0.04, 0.03, xm.silicon(), 0.003);
  hkb.position.set(0.12, 0, -0.017);
  const hFace = new THREE.Mesh(new THREE.PlaneGeometry(0.095, 0.03), xm.pt());
  hFace.position.set(0.12, 0, -0.0015);
  g.add(vkb, vFace, hkb, hFace);
  // bimorph bender electrodes / pitch stages
  const piezo = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.35, metalness: 0.8 });
  for (const x of [-0.19, -0.01]) {
    const p = box(0.02, 0.03, 0.05, piezo, 0.002);
    p.position.set(x, -0.04, 0);
    g.add(p);
  }
  const base = box(0.48, 0.03, 0.24, xm.darkSteel(), 0.004);
  base.position.y = -0.115;
  g.add(base);
  const post = box(0.3, -0.13 - tableTop, 0.16, xm.steel(), 0.006);
  post.position.y = tableTop + (-0.13 - tableTop) / 2;
  g.add(post, pipeX(-0.3, -0.25, 0.02), pipeX(0.25, 0.32, 0.02));
  return shadowed(g);
}

/** End-of-line beam stop: tungsten core in a lead housing on a stand. */
export function endBeamStop(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const lead = box(0.25, 0.3, 0.3, xm.lead(), 0.01);
  const core = cylX(0.04, 0.02, xm.tungsten(), 16);
  core.position.x = -0.13;
  const sign = box(0.005, 0.08, 0.12, xm.safety(), 0.002);
  sign.position.set(-0.128, 0.08, 0);
  g.add(lead, core, sign, pedestal(beamY, -0.15, 0.2, 0.2, xm.darkSteel()));
  return shadowed(g);
}
