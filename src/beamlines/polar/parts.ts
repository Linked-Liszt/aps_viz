import * as THREE from 'three';
import { glowMaterial } from '../../scene/palette';
import {
  boredPlateX, box, cyl, cylX, cylZ, flangeX, hose, pedestal, pipeX, pm, reducedMotion, ringX, ringXCut, ringY, shadowed, vesselBox, vesselBoxOpenTop, vesselCylY,
  type FrameHook,
} from './kit';
import { ARM_APD, ARM_PAD, ARM_Y, CRYO_R, DEG, G_MU, TABLE_TOP, TRANSPORT_STANDS } from './geometry';

/**
 * Bespoke POLAR (4-ID) component models. Each returns a group whose origin is the component position on the
 * beam axis (unless noted); +X downstream, +Y up, +Z outboard; floor at y = -beamY. Real dimensions where
 * published (FDR 2019, Strempfer et al. 2022, 2021 town-hall plan); otherwise typical sizes for the device class.
 */

// ------------------------------------------------------------------ source & front end

/** Gap-adjustable permanent-magnet phase shifter between the two in-line undulators (length not published; ~0.2 m shown). */
export function phaseShifter(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const L = 0.18;
  const red = new THREE.MeshStandardMaterial({ color: 0xc94b4b, roughness: 0.45, metalness: 0.4 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x3c6fd1, roughness: 0.45, metalness: 0.4 });
  for (const [y, m] of [[0.04, red], [-0.04, blue]] as const) {
    const jaw = box(L, 0.06, 0.09, m, 0.004);
    jaw.position.y = y + Math.sign(y) * 0.006;
    const back = box(L, 0.07, 0.16, pm.darkSteel(), 0.01);
    back.position.y = y + Math.sign(y) * 0.075;
    g.add(jaw, back);
  }
  const frame = box(L * 0.9, 0.5, 0.12, new THREE.MeshStandardMaterial({ color: 0x3f6f9a, roughness: 0.6, metalness: 0.3 }), 0.02);
  frame.position.z = 0.22;
  g.add(frame, pedestal(beamY, -0.26, 0.2, 0.36, pm.darkSteel()));
  g.children.at(-1)!.position.z = 0.12;
  return shadowed(g);
}

/**
 * High-heat-load front end: a photon pipe from ~14 m through masks, the GRID XBPM, photon and safety shutters and the
 * wall collimator in the ratchet wall, to the FOE at 24.4 m. Origin at 20 m (the component's nominal position).
 * Element positions are not published. The last 4 m follow the 2021 town-hall elevation drawing (scaled, ±0.2 m): the
 * tandem safety shutters with their tall actuators at ~22.7–23.4 m, a long photon-shutter body just upstream, and the wall
 * collimator inside the ~23.6–24.4 m ratchet wall. Upstream of ~21 m the order follows the FDR element list, spacing schematic.
 */
export function frontEnd(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const X0 = 20;
  const at = (d: number) => d - X0;
  g.add(pipeX(at(14.0), at(24.45), 0.035));
  for (const d of [14.3, 16.9, 19.6, 21.0]) {
    const s = pedestal(beamY, -0.04, 0.08, 0.08, pm.steel());
    s.position.x = at(d);
    g.add(s);
  }
  const copperBlock = (d: number, len: number) => {
    const b = box(len, 0.26, 0.26, pm.copper(), 0.02);
    b.position.x = at(d);
    const s = pedestal(beamY, -0.13, 0.2, 0.2, pm.darkSteel());
    s.position.x = at(d);
    const water = hose([new THREE.Vector3(at(d) - len / 3, 0.13, 0), new THREE.Vector3(at(d) - len / 3, 0.3, 0.05), new THREE.Vector3(at(d), 0.36, 0.2), new THREE.Vector3(at(d) + len / 3, 0.13, 0.05)], 0.012, pm.steel());
    g.add(b, s, water);
  };
  copperBlock(15.2, 0.45); // burn-through fixed mask BTFM1
  copperBlock(16.3, 0.38); // FM2
  {
    const coll = box(0.3, 0.3, 0.3, pm.tungsten(), 0.01); // collimator
    coll.position.x = at(17.4);
    const s = pedestal(beamY, -0.15, 0.2, 0.2, pm.darkSteel());
    s.position.x = at(17.4);
    g.add(coll, s);
  }
  {
    const x = box(0.2, 0.2, 0.2, pm.steel(), 0.015); // GRID XBPM1
    x.position.x = at(18.5);
    for (const [y, z] of [[0.13, 0], [-0.13, 0], [0, 0.13], [0, -0.13]]) {
      const arm = cyl(0.025, 0.09, pm.darkSteel(), 10);
      if (z) arm.rotation.x = Math.PI / 2;
      arm.position.set(at(18.5), y, z);
      g.add(arm);
    }
    const s = pedestal(beamY, -0.1, 0.12, 0.12, pm.darkSteel());
    s.position.x = at(18.5);
    g.add(x, s);
  }
  copperBlock(20.3, 0.35); // FM3
  {
    const v = box(0.12, 0.18, 0.16, pm.darkSteel(), 0.01); // front-end valve with its actuator
    v.position.set(at(21.6), 0.03, 0);
    const act = cyl(0.045, 0.2, pm.steel(), 16);
    act.position.set(at(21.6), 0.22, 0);
    g.add(v, act);
  }
  // photon shutter PS2 (long, water-cooled, with intensity monitor) on its own table
  {
    const b = box(0.7, 0.3, 0.32, pm.shutterYellow(), 0.02);
    b.position.set(at(22.22), 0, 0);
    const s = pedestal(beamY, -0.15, 0.6, 0.4, pm.darkSteel());
    s.position.x = at(22.22);
    g.add(b, s);
  }
  // redundant safety shutters SS1/SS2 in tandem, tall pneumatic actuators on top
  for (const d of [22.88, 23.22]) {
    const b = box(0.3, 0.42, 0.42, pm.shutterYellow(), 0.02);
    b.position.set(at(d), 0, 0);
    const act = box(0.24, 0.3, 0.26, pm.darkSteel(), 0.02);
    act.position.set(at(d), 0.36, 0);
    const s = pedestal(beamY, -0.21, 0.26, 0.4, pm.darkSteel());
    s.position.x = at(d);
    g.add(b, act, s);
  }
  {
    const wc = box(0.75, 0.36, 0.36, pm.lead(), 0.01); // wall collimator, inside the ratchet wall
    wc.position.x = at(24.0);
    g.add(wc);
  }
  return shadowed(g);
}

/** Front-end exit mask (2 × 2 mm) with XBPM2, on the last front-end table inside the FOE. */
export function exitMask(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const top = -0.3;
  const table = box(1.75, 0.08, 0.55, pm.lid(), 0.01);
  table.position.set(0.2, top - 0.04, 0);
  g.add(table);
  for (const x of [-0.55, 0.95]) {
    const leg = pedestal(beamY, top - 0.08, 0.14, 0.4, pm.darkSteel());
    leg.position.x = x;
    g.add(leg);
  }
  const mask = box(0.32, 0.22, 0.22, pm.copper(), 0.015);
  const bh = -0.11 - top;
  const bracket = box(0.26, bh, 0.18, pm.darkSteel(), 0.005);
  bracket.position.y = top + bh / 2;
  const water = hose([new THREE.Vector3(-0.1, 0.11, 0), new THREE.Vector3(-0.05, 0.25, -0.05), new THREE.Vector3(0.1, 0.25, -0.12), new THREE.Vector3(0.12, 0.11, 0)], 0.01, pm.steel());
  g.add(mask, bracket, water);
  const xbpm = box(0.14, 0.16, 0.16, pm.steel(), 0.01);
  xbpm.position.x = 0.32;
  const cam = cylZ(0.03, 0.12, pm.detector(), 14);
  cam.position.set(0.32, 0, -0.14);
  const xbh = -0.08 - top;
  const xb = box(0.1, xbh, 0.1, pm.darkSteel(), 0.005);
  xb.position.set(0.32, top + xbh / 2, 0);
  g.add(xbpm, cam, xb, pipeX(-0.6, 1.0, 0.028));
  for (const x of [-0.6, 1.0]) g.add(flangeX(x, 0.05));
  return shadowed(g);
}

/** Exit collimator (5 × 5 mm): a dense tungsten block sitting on the front-end exit table. */
export function exitCollimator(): THREE.Group {
  const g = new THREE.Group();
  const top = -0.3;
  const blk = box(0.26, 0.26, 0.26, pm.tungsten(), 0.01);
  const bh = -0.13 - top;
  const base = box(0.22, bh, 0.2, pm.darkSteel(), 0.005);
  base.position.y = top + bh / 2;
  g.add(blk, base);
  return shadowed(g);
}

// ------------------------------------------------------------------ FOE optics

/** A metal-striped mirror substrate standing on edge (horizontal deflection). face = +1: reflecting face toward +Z. */
function sideMirror(len: number, height: number, thick: number, face: 1 | -1, stripes: THREE.Material[]): THREE.Group {
  const g = new THREE.Group();
  const sub = box(len, height, thick, pm.silicon(), 0.003);
  sub.position.z = -face * (thick / 2 + 0.0008);
  g.add(sub);
  // stripes run along the mirror; picked by moving the mirror vertically. Drawn 12 mm high (real 5 mm) to stay visible.
  const sh = Math.min(0.012, height / (stripes.length + 1));
  stripes.forEach((m, i) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.98, sh * 0.9), m);
    s.position.set(0, (i - (stripes.length - 1) / 2) * sh, face * 0.0003);
    if (face < 0) s.rotation.y = Math.PI;
    g.add(s);
  });
  const cool = box(len * 0.9, height * 0.6, 0.02, pm.copper(), 0.003);
  cool.position.z = -face * (thick + 0.012);
  g.add(cool);
  return g;
}

/**
 * HHL white-beam mirrors M1 (flat, notched) and M2 (bendable) in one vessel: Si, 320 mm, 3 mrad grazing angle each (horizontal
 * deflection), Pt/Rh/Si stripes. The 2021 town-hall cartoon steps the beam toward the ring at this pair, so M1 sits just outboard
 * of the beam with its face turned inboard, and M2 sits inboard facing outboard to send the beam on parallel (the ~4 mm offset is
 * not drawn). Museum cut-away: the vessel is open on top (steel rim only) so the mirrors and their stripes can be seen.
 */
export function hhlMirrors(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const v = vesselBoxOpenTop(1.35, 0.5, 0.55);
  g.add(v);
  for (const [w, d, x, z] of [[1.37, 0.05, 0, 0.26], [1.37, 0.05, 0, -0.26], [0.05, 0.47, 0.66, 0], [0.05, 0.47, -0.66, 0]] as const) {
    const rim = box(w, 0.03, d, pm.lid(), 0.005);
    rim.position.set(x, 0.265, z);
    g.add(rim);
  }
  const stripes = [pm.stripePt(), pm.stripeRh(), pm.stripeSi()];
  // [x, face, side of the mirror body]: M1 body outboard (+z) facing inboard; M2 body inboard facing outboard
  const pair: [number, 1 | -1][] = [[-0.33, -1], [0.33, 1]];
  for (const [x, face] of pair) {
    const m = sideMirror(0.32, 0.06, 0.05, face, stripes);
    m.position.x = x;
    g.add(m);
    const body = -face; // +1 = body outboard
    const st = box(0.26, 0.17, 0.2, pm.darkSteel(), 0.01);
    st.position.set(x, -0.135, body * 0.06);
    g.add(st);
    // cooling water from the copper block behind the mirror up to a feedthrough on the rim
    const w = hose([new THREE.Vector3(x - 0.1, 0.03, body * 0.07), new THREE.Vector3(x - 0.1, 0.18, body * 0.12), new THREE.Vector3(x - 0.06, 0.27, body * 0.2), new THREE.Vector3(x - 0.04, 0.3, body * 0.26)], 0.008, pm.copper());
    const ft = cyl(0.02, 0.03, pm.steel(), 16);
    ft.position.set(x - 0.04, 0.295, body * 0.26);
    g.add(w, ft);
  }
  // M2 meridional bender (R = ±50 km) at both ends, behind its mirror body
  for (const s of [-1, 1]) {
    const b = box(0.05, 0.11, 0.08, pm.darkSteel(), 0.005);
    b.position.set(0.33 + s * 0.18, 0, -0.09);
    g.add(b);
  }
  const plate = box(1.38, 0.05, 0.65, pm.lid(), 0.01);
  plate.position.y = -0.275;
  g.add(plate, pedestal(beamY, -0.3, 1.2, 0.75));
  g.add(pipeX(-0.76, -0.675, 0.03), flangeX(-0.675, 0.07), flangeX(0.675, 0.07));
  return shadowed(g);
}

/** Photon mask / pink-beam stop: water-cooled copper with an aperture for the mirror-reflected beam. */
export function pinkBeamStop(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const v = vesselBox(0.2, 0.3, 0.3);
  v.position.x = 0.0;
  g.add(v);
  const block = ringX(0.08, 0.012, 0.1, pm.copper(), 32);
  const w = hose([new THREE.Vector3(-0.03, 0.08, 0), new THREE.Vector3(-0.03, 0.22, 0.02), new THREE.Vector3(0.05, 0.26, 0.08)], 0.008, pm.steel());
  g.add(block, w, pipeX(-0.13, -0.1, 0.028), pipeX(0.1, 0.2, 0.028), pedestal(beamY, -0.15, 0.18, 0.24, pm.darkSteel()));
  return shadowed(g);
}

/**
 * CINEL vertical double-crystal monochromator (LN2-cooled). The 2021 elevation drawing shows its vessel as a drum about 0.9 m
 * across, centred just above the beam at ~30.6 m: a cylinder whose axis runs across the beam (the Bragg axis is horizontal).
 * Drawn see-through, with the Bragg rotary and its motor on the outboard face, LN2 lines from the top to a phase separator.
 * Si(111) pair in the beam, 6H-SiC(0006) pair beside it (selected by translation). Crystals drawn at the Si(111) Bragg angle
 * for 10 keV (11.4°); fixed exit, +15.6 mm offset, drawn about the beam axis.
 */
export function dcm(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const th = 11.4 * DEG;
  const off = 0.0156;
  const R = 0.44;
  const W = 0.6;
  const yc = 0.04;
  // drum: transparent shell + steel end rims + flat end faces
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 56, 1, true), pm.vessel());
  shell.rotation.x = Math.PI / 2;
  shell.position.y = yc;
  shell.renderOrder = 3;
  g.add(shell);
  for (const zs of [-1, 1]) {
    const face = new THREE.Mesh(new THREE.CircleGeometry(R, 56), pm.vessel());
    face.position.set(0, yc, (zs * W) / 2);
    face.renderOrder = 3;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.018, 8, 56), pm.steel());
    rim.position.set(0, yc, (zs * W) / 2);
    g.add(face, rim);
  }
  // beam ports on the drum wall
  for (const xs of [-1, 1]) {
    const port = cylX(0.05, 0.08, pm.steel(), 20);
    port.position.x = xs * (R + 0.02);
    g.add(port, flangeX(xs * (R + 0.06), 0.075));
  }
  const sets: [number, THREE.Material][] = [[0, pm.silicon()], [0.075, pm.sic()]];
  for (const [z, mat] of sets) {
    // first crystal: large (beam walks along it), Bragg rotation only
    const c1 = box(0.16, 0.035, 0.05, mat, 0.003);
    c1.rotation.z = th;
    c1.position.set(-0.03, -off / 2 - 0.0175 / Math.cos(th), z);
    const h1 = box(0.18, 0.03, 0.06, pm.copper(), 0.003);
    h1.rotation.z = th;
    h1.position.set(-0.03 + 0.03 * Math.sin(th), -off / 2 - 0.05 / Math.cos(th), z);
    // second crystal: small, coarse + piezo pitch/roll for XBPM feedback
    const c2 = box(0.07, 0.03, 0.05, mat, 0.003);
    c2.rotation.z = th;
    c2.position.set(off / Math.tan(2 * th) - 0.03 + 0.04, off / 2 + 0.015 / Math.cos(th), z);
    const h2 = box(0.08, 0.03, 0.06, pm.copper(), 0.003);
    h2.rotation.z = th;
    h2.position.set(c2.position.x - 0.03 * Math.sin(th), off / 2 + 0.045 / Math.cos(th), z);
    g.add(c1, h1, c2, h2);
  }
  // crystal cage hanging from the Bragg axis (axis along z through the drum centre)
  const axle = cylZ(0.02, W - 0.04, pm.steel(), 16);
  axle.position.y = yc;
  const cage = box(0.26, 0.012, 0.2, pm.darkSteel(), 0.002);
  cage.position.set(0, -0.085, 0.035);
  const hanger = box(0.03, yc + 0.085, 0.03, pm.darkSteel(), 0.002);
  hanger.position.set(0, (yc - 0.085) / 2, 0.2);
  const pz = cyl(0.012, 0.06, pm.black(), 10);
  pz.position.set(0.05, 0.11, 0);
  g.add(axle, cage, hanger, pz);
  // Bragg rotary + motor on the outboard face
  const rot = cylZ(0.2, 0.08, pm.lid(), 48);
  rot.position.set(0, yc, W / 2 + 0.04);
  const rot2 = cylZ(0.09, 0.1, pm.steel(), 32);
  rot2.position.set(0, yc, W / 2 + 0.13);
  const mot = box(0.16, 0.16, 0.16, pm.black(), 0.01);
  mot.position.set(0.0, yc - 0.27, W / 2 + 0.14);
  g.add(rot, rot2, mot);
  // LN2 feedthroughs on top of the drum, lines up to a phase separator
  const sep = cyl(0.08, 0.22, pm.steel(), 20);
  sep.position.set(0.22, yc + R + 0.32, 0.5);
  g.add(sep);
  for (const dz of [-0.04, 0.04]) {
    const ft = cyl(0.025, 0.05, pm.steel(), 12);
    ft.position.set(-0.05, yc + R + 0.01, dz);
    g.add(ft, hose([new THREE.Vector3(-0.05, yc + R + 0.03, dz), new THREE.Vector3(-0.05, yc + R + 0.22, dz), new THREE.Vector3(0.1, yc + R + 0.3, 0.3 + dz), new THREE.Vector3(0.22, yc + R + 0.22, 0.5 + dz)], 0.016, pm.white()));
  }
  // cradle and pedestal
  const cradle = box(0.62, 0.08, W + 0.1, pm.lid(), 0.01);
  cradle.position.y = yc - R - 0.02;
  for (const xs of [-1, 1]) {
    const saddle = box(0.08, 0.16, W, pm.darkSteel(), 0.008);
    saddle.position.set(xs * 0.24, yc - R + 0.06, 0);
    g.add(saddle);
  }
  g.add(cradle, pedestal(beamY, yc - R - 0.06, 0.7, 0.8));
  g.add(pipeX(-0.66, -0.52, 0.03), pipeX(0.52, 0.66, 0.03));
  return shadowed(g);
}

/** Lead/tungsten block with a square aperture on the beam (drawn as four bars around the hole). */
function apertureBlock(len: number, size: number, hole: number, m: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const bar = (w: number, h: number, y: number, z: number) => {
    const b = box(len, h, w, m, 0.004);
    b.position.set(0, y, z);
    g.add(b);
  };
  const s = (size - hole) / 2;
  bar(size, s, hole / 2 + s / 2, 0);
  bar(size, s, -hole / 2 - s / 2, 0);
  bar(s, hole, 0, hole / 2 + s / 2);
  bar(s, hole, 0, -hole / 2 - s / 2);
  return g;
}

/** Secondary collimator, white-beam stop and bremsstrahlung collimator (plan ~31.55, 32.0, 32.3 m). Origin at the WB stop. */
export function foCollimators(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const sc = apertureBlock(0.15, 0.32, 0.03, pm.lead());
  sc.position.x = -0.42;
  // white-beam stop: the undeflected white/bremsstrahlung line runs 15.6 mm below the monochromatic beam
  const ws = box(0.12, 0.12, 0.14, pm.tungsten(), 0.006);
  ws.position.y = -0.0156 - 0.06 + 0.012;
  const bc = apertureBlock(0.3, 0.42, 0.03, pm.lead());
  bc.position.x = 0.35;
  g.add(sc, ws, bc);
  for (const [x, w, top] of [[-0.42, 0.12, -0.16], [0, 0.1, -0.11], [0.35, 0.26, -0.21]] as const) {
    const p = pedestal(beamY, top, w, 0.22, pm.darkSteel());
    p.position.x = x;
    g.add(p);
  }
  g.add(pipeX(-0.6, 0.52, 0.012, pm.steel()));
  return shadowed(g);
}

/**
 * The reused 4-ID-D phase-retarder tank contains three Bragg-transmission plate stages.
 * Stages pr1 and pr2 use diamond C(111)/C(220), and pr3 uses thin Si(111). Each stage's diffraction plane is tilted 45° about the beam so σ and π are equal.
 * Plates drawn at θB(C 111, 10 keV) = 17.5°. The roll of the diffraction plane is drawn at 225° (any odd multiple of 45° gives
 * equal σ and π; the as-installed one is not published) so the goniometer bodies sit below-outboard and the plates face the
 * default inboard camera. Museum cut-away: the lid is left open (steel rim only) and the plates are drawn ~7× real size
 * (30 mm; real plates are a few mm across, 50–500 µm thick) in open copper frames, glowing faintly.
 * Returns the group plus the pr1 piezo (pulses on helicity flips).
 */
export function phaseRetarderTank(beamY: number): { group: THREE.Group; piezo: THREE.Mesh } {
  const g = new THREE.Group();
  const v = vesselBoxOpenTop(0.9, 0.5, 0.7);
  v.position.y = 0.03;
  g.add(v);
  // cut-away lid: steel rim only, open on top
  for (const [w, d, x, z] of [[0.92, 0.06, 0, 0.33], [0.92, 0.06, 0, -0.33], [0.06, 0.6, 0.43, 0], [0.06, 0.6, -0.43, 0]] as const) {
    const rim = box(w, 0.03, d, pm.lid(), 0.005);
    rim.position.set(x, 0.295, z);
    g.add(rim);
  }
  const piezoMat = new THREE.MeshStandardMaterial({ color: 0x1b1f26, emissive: 0xc084fc, emissiveIntensity: 0.2, roughness: 0.4 });
  let piezo!: THREE.Mesh;
  const stage = (x: number, plateMat: THREE.Material, plateSize: number, withPiezo: boolean) => {
    // built with the diffraction plane = x–y and the θ axis along z, then rolled 45° about the beam
    const s = new THREE.Group();
    const disc = cylZ(0.075, 0.03, pm.darkSteel(), 32);
    disc.position.z = -0.09;
    const ringT = ringX(0.08, 0.07, 0.012, pm.steel(), 32);
    ringT.rotation.y = Math.PI / 2;
    ringT.position.z = -0.09;
    const arm = box(0.02, 0.02, 0.07, pm.steel(), 0.003);
    arm.position.set(0, -0.02, -0.045 - plateSize * 0.4);
    // open copper frame (the beam passes through the plate, not the frame)
    const tilt = new THREE.Group();
    const f = plateSize * 0.22;
    for (const [h, d, y, z] of [
      [f, plateSize + 2 * f, (plateSize + f) / 2, 0],
      [f, plateSize + 2 * f, -(plateSize + f) / 2, 0],
      [plateSize, f, 0, (plateSize + f) / 2],
      [plateSize, f, 0, -(plateSize + f) / 2],
    ] as const) {
      const bar = box(0.005, h, d, pm.copper(), 0.001);
      bar.position.set(0, y, z);
      tilt.add(bar);
    }
    const plate = box(0.0025, plateSize, plateSize, plateMat, 0);
    tilt.rotation.z = 17.5 * DEG; // θB in Bragg-transmission (Laue) geometry
    tilt.add(plate);
    s.add(disc, ringT, arm, tilt);
    const mot = box(0.06, 0.06, 0.06, pm.black(), 0.006);
    mot.position.set(0, 0.07, -0.1);
    s.add(mot);
    if (withPiezo) {
      piezo = cyl(0.009, 0.05, piezoMat, 12);
      piezo.position.set(0.025, 0.03, -0.07);
      s.add(piezo);
    }
    s.rotation.x = 225 * DEG;
    s.position.x = x;
    g.add(s);
  };
  stage(-0.2, pm.diamondHero(), 0.03, true);
  stage(0.14, pm.diamondHero(), 0.03, false);
  stage(0.35, pm.silicon(), 0.024, false);
  const plate = box(0.95, 0.05, 0.75, pm.lid(), 0.01);
  plate.position.y = -0.245;
  g.add(plate, pedestal(beamY, -0.27, 0.8, 0.6));
  g.add(pipeX(-0.6, -0.45, 0.03), pipeX(0.45, 0.6, 0.03), flangeX(-0.45, 0.07), flangeX(0.45, 0.07));
  return { group: shadowed(g), piezo };
}

// ------------------------------------------------------------------ transport

/** Shielded transport U1-40 (pipe drawn by the enclosure): stands with lead collars. Origin at 43.3 m. */
export function transportStands(beamY: number, originX: number): THREE.Group {
  const g = new THREE.Group();
  for (const d of TRANSPORT_STANDS) {
    const x = d - originX;
    const collar = box(0.14, 0.36, 0.36, pm.black(), 0.01);
    collar.position.x = x;
    const post = pedestal(beamY, -0.18, 0.1, 0.1, pm.darkSteel());
    post.position.x = x;
    const foot = box(0.4, 0.03, 0.4, pm.darkSteel(), 0.005);
    foot.position.set(x, -beamY + 0.015, 0);
    g.add(collar, post, foot);
  }
  return shadowed(g);
}

// ------------------------------------------------------------------ 4-ID-B

/**
 * Toroid/cylinder focusing mirror M3 or M4 (540 mm Si, 2–4 mrad horizontal deflection), each in its own vessel on a shared
 * granite base. M3 is bendable (4–100 km). Stripes: M3 Pd sagittal cylinder + Si + Pt flats; M4 Pd flat + Si + Pt cylinders.
 */
export function toroidMirror(beamY: number, which: 'M3' | 'M4'): THREE.Group {
  const g = new THREE.Group();
  const v = vesselBox(0.78, 0.45, 0.62);
  g.add(v);
  const lid = box(0.8, 0.03, 0.64, pm.lid(), 0.005);
  lid.position.y = 0.24;
  g.add(lid);
  const face = which === 'M3' ? 1 : -1;
  const m = sideMirror(0.54, 0.05, 0.04, face, [pm.stripePd(), pm.stripeSi(), pm.stripePt()]);
  g.add(m);
  if (which === 'M3') {
    for (const s of [-1, 1]) {
      const b = box(0.04, 0.09, 0.07, pm.darkSteel(), 0.005);
      b.position.set(s * 0.29, 0, -0.07);
      const spring = cylZ(0.012, 0.08, pm.steel(), 10);
      spring.position.set(s * 0.25, 0.03, -0.09);
      g.add(b, spring);
    }
    const motor = box(0.3, 0.16, 0.14, pm.black(), 0.01);
    motor.position.set(0.25, -0.12, -0.39);
    g.add(motor);
  }
  const st = box(0.5, 0.15, 0.22, pm.darkSteel(), 0.01);
  st.position.set(0, -0.12, -face * 0.06);
  g.add(st);
  const plate = box(0.8, 0.04, 0.66, pm.lid(), 0.008);
  plate.position.y = -0.245;
  g.add(plate);
  if (which === 'M3') {
    // common granite base for both tanks (53.27–55.06 m on the plan), origin at 53.7 m
    const gr = pedestal(beamY, -0.265, 1.79, 0.9);
    gr.position.x = 0.465;
    g.add(gr, pipeX(-0.55, -0.39, 0.03), flangeX(-0.39, 0.07));
  } else {
    g.add(pipeX(0.39, 0.62, 0.03), flangeX(0.39, 0.07));
  }
  return shadowed(g);
}

/** In-line polarimeter: retractable 45° scattering foil and two detectors 90° apart, the head rotating about the beam. */
export function polarimeter(): { group: THREE.Group; rotor: THREE.Group } {
  const g = new THREE.Group();
  const top = TABLE_TOP;
  const bearing = ringX(0.13, 0.05, 0.07, pm.steel(), 40);
  bearing.position.x = -0.07;
  const housing = box(0.1, 0.2 + (0.0 - top) - 0.13, 0.22, pm.darkSteel(), 0.01);
  housing.position.set(-0.07, top + (0.2 + (0.0 - top) - 0.13) / 2, 0);
  g.add(bearing, housing);
  const rotor = new THREE.Group();
  const cube = box(0.09, 0.09, 0.09, pm.steel(), 0.008);
  const foil = box(0.0015, 0.05, 0.05, new THREE.MeshStandardMaterial({ color: 0xd7b56a, metalness: 0.8, roughness: 0.3 }), 0);
  foil.rotation.y = 45 * DEG;
  const dh = cylZ(0.025, 0.11, pm.black(), 16); // horizontal-scatter detector
  dh.position.z = 0.1;
  const dv = cyl(0.025, 0.11, pm.black(), 16); // vertical-scatter detector
  dv.position.y = 0.1;
  rotor.add(cube, foil, dh, dv);
  rotor.position.x = 0.03;
  g.add(rotor, pipeX(-0.2, 0.15, 0.022));
  return { group: shadowed(g), rotor };
}

/** UHV optical chopper (up to 4 kHz): slotted wheel whose rim crosses the beam. Returns the wheel for spin animation. */
export function chopper(): { group: THREE.Group; wheel: THREE.Group } {
  const g = new THREE.Group();
  const top = TABLE_TOP;
  g.add(vesselBox(0.1, 0.24, 0.2));
  const wheel = new THREE.Group();
  const disc = cylX(0.07, 0.002, pm.steel(), 48);
  wheel.add(disc);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const slot = box(0.004, 0.012, 0.006, pm.black(), 0);
    slot.position.set(0, Math.cos(a) * 0.058, Math.sin(a) * 0.058);
    slot.rotation.x = -a;
    wheel.add(slot);
  }
  wheel.position.y = -0.058; // the slotted rim passes through the beam
  const motor = cylX(0.025, 0.06, pm.black(), 16);
  motor.position.set(0.045, -0.058, 0);
  const stand = box(0.08, -top - 0.12, 0.12, pm.darkSteel(), 0.005);
  stand.position.y = top + (-top - 0.12) / 2;
  g.add(wheel, motor, stand, pipeX(-0.15, 0.15, 0.02));
  return { group: shadowed(g), wheel };
}

/** Existing bendable KB pair 'KB3' (≈200 mm mirrors) for the 2 T electromagnet; table mounted. */
export function kb3(): THREE.Group {
  const g = new THREE.Group();
  const top = TABLE_TOP;
  g.add(vesselBox(0.58, 0.26, 0.26));
  const vfm = box(0.2, 0.025, 0.035, pm.silicon(), 0.002);
  vfm.position.set(-0.13, -0.014, 0);
  const vf = new THREE.Mesh(new THREE.PlaneGeometry(0.196, 0.03), pm.mirror());
  vf.rotation.x = -Math.PI / 2;
  vf.position.set(-0.13, -0.0015, 0);
  const hfm = box(0.2, 0.035, 0.025, pm.silicon(), 0.002);
  hfm.position.set(0.13, 0, -0.014);
  const hf = new THREE.Mesh(new THREE.PlaneGeometry(0.196, 0.03), pm.mirror());
  hf.position.set(0.13, 0, -0.0015);
  g.add(vfm, vf, hfm, hf);
  // four-point benders
  for (const [x, vert] of [[-0.13, true], [0.13, false]] as const)
    for (const s of [-1, 1]) {
      const b = box(0.025, 0.05, 0.05, pm.darkSteel(), 0.003);
      b.position.set(x + s * 0.11, vert ? -0.04 : 0, vert ? 0 : -0.04);
      g.add(b);
    }
  const stand = box(0.4, -top - 0.13, 0.2, pm.darkSteel(), 0.008);
  stand.position.y = top + (-top - 0.13) / 2;
  g.add(stand, pipeX(-0.36, -0.29, 0.02), pipeX(0.29, 0.36, 0.02));
  return shadowed(g);
}

/** Compact ion chamber / photodiode box on a post down to `supportY` (beam frame). */
export function ionChamber(supportY: number, len = 0.07): THREE.Group {
  const g = new THREE.Group();
  const body = box(len, 0.11, 0.13, new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: 0.35, metalness: 0.6 }), 0.006);
  const winMat = new THREE.MeshStandardMaterial({ color: 0xc8752c, roughness: 0.4, metalness: 0.2 });
  for (const s of [-1, 1]) {
    const w = cylX(0.018, 0.003, winMat, 16);
    w.position.x = (s * len) / 2 + s * 0.001;
    g.add(w);
  }
  for (const z of [-0.035, 0.035]) {
    const c = cyl(0.008, 0.035, pm.black(), 8);
    c.position.set(0, 0.07, z);
    g.add(c);
  }
  const post = cyl(0.012, -supportY - 0.055, pm.steel(), 10);
  post.position.y = supportY + (-supportY - 0.055) / 2;
  const foot = box(0.08, 0.015, 0.08, pm.darkSteel(), 0.003);
  foot.position.y = supportY + 0.0075;
  g.add(body, post, foot);
  return shadowed(g);
}

/**
 * Existing 2 T water-cooled electromagnet (4-ID-D heritage): bored poles along the beam (field ∥ beam), copper coils,
 * U-shaped iron return yoke, He flow cryostat dropping into the pole gap, on x/y/rotation stages.
 */
export function electromagnet2T(beamY: number): THREE.Group {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const pole = ringX(0.06, 0.006, 0.17, pm.yoke(), 32);
    pole.position.x = s * 0.105;
    const tip = ringX(0.035, 0.006, 0.02, pm.steel(), 24);
    tip.position.x = s * 0.03;
    const coil = ringX(0.165, 0.065, 0.13, pm.coil(), 40);
    coil.position.x = s * 0.115;
    // return-yoke end plate, bored for the beam (field ∥ beam)
    const plate = boredPlateX(0.38, -0.28, 0.5, 0.08, 0.022, pm.yoke());
    plate.position.x = s * 0.25;
    g.add(pole, tip, coil, plate);
    g.add(hose([new THREE.Vector3(s * 0.115, 0.165, 0.08), new THREE.Vector3(s * 0.12, 0.3, 0.15), new THREE.Vector3(s * 0.2, 0.35, 0.3), new THREE.Vector3(s * 0.3, 0.1, 0.32)], 0.01, pm.rubber()));
  }
  const bottom = box(0.58, 0.08, 0.38, pm.yoke(), 0.01);
  bottom.position.y = -0.24;
  g.add(bottom);
  // He flow cryostat into the gap from above
  const tail = cyl(0.016, 0.42, pm.steel(), 16);
  tail.position.y = 0.21;
  const head = cyl(0.05, 0.18, pm.steel(), 24);
  head.position.y = 0.5;
  const sample = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), glowMaterial(0xc084fc, 3));
  g.add(tail, head, sample);
  g.add(hose([new THREE.Vector3(0, 0.59, 0), new THREE.Vector3(0, 0.7, 0.1), new THREE.Vector3(-0.1, 0.62, 0.45), new THREE.Vector3(-0.3, 0.2, 0.6)], 0.014, pm.white()));
  const st1 = box(0.6, 0.08, 0.42, pm.darkSteel(), 0.01);
  st1.position.y = -0.32;
  const rot = cyl(0.22, 0.06, pm.steel(), 32);
  rot.position.y = -0.39;
  g.add(st1, rot, pedestal(beamY, -0.42, 0.5, 0.45, pm.darkSteel()));
  g.add(pipeX(-0.42, -0.29, 0.02), pipeX(0.29, 0.4, 0.02));
  return shadowed(g);
}

// ------------------------------------------------------------------ fixed-figure KB pairs (KB1, KB2)

export interface KbSpec {
  /** mirror centres relative to the component origin (m) and lengths (m) */
  vfmX: number;
  vfmL: number;
  hfmX: number;
  hfmL: number;
  /** vessel extent (local x) */
  x0: number;
  x1: number;
  /** slim nose (local x end) that carries the HFM close to a sample environment */
  noseTo?: number;
  supportY: number;
  granite?: boolean;
}

/** Prefigured elliptical-cylinder Si KB pair (VFM upstream of HFM, 3 mrad each, Pt/Rh stripes) in a vacuum vessel. */
export function kbFixed(beamY: number, k: KbSpec): THREE.Group {
  const g = new THREE.Group();
  const bodyEnd = k.noseTo !== undefined ? k.x1 : k.x1;
  const len = bodyEnd - k.x0;
  const v = vesselBox(len, 0.26, 0.3);
  v.position.x = (k.x0 + bodyEnd) / 2;
  g.add(v);
  if (k.noseTo !== undefined) {
    const nose = vesselBox(k.noseTo - k.x1, 0.09, 0.11);
    nose.position.x = (k.x1 + k.noseTo) / 2;
    g.add(nose);
  }
  const vfm = box(k.vfmL, 0.03, 0.04, pm.silicon(), 0.002);
  vfm.position.set(k.vfmX, -0.0165, 0);
  const vf = new THREE.Mesh(new THREE.PlaneGeometry(k.vfmL * 0.98, 0.035), pm.mirror());
  vf.rotation.x = -Math.PI / 2;
  vf.position.set(k.vfmX, -0.0012, 0);
  const hfm = box(k.hfmL, 0.035, 0.025, pm.silicon(), 0.002);
  hfm.position.set(k.hfmX, 0, -0.014);
  const hf = new THREE.Mesh(new THREE.PlaneGeometry(k.hfmL * 0.98, 0.03), pm.mirror());
  hf.position.set(k.hfmX, 0, -0.0012);
  g.add(vfm, vf, hfm, hf);
  // piezo/picomotor/capacitive-sensor stages under the mirrors
  const sv = box(k.vfmL * 0.8, 0.07, 0.1, pm.darkSteel(), 0.005);
  sv.position.set(k.vfmX, -0.068, 0);
  const sh = box(k.hfmL * 0.8, 0.06, 0.06, pm.darkSteel(), 0.005);
  sh.position.set(k.hfmX, 0, -0.06);
  g.add(sv, sh);
  const mid = (k.x0 + bodyEnd) / 2;
  if (k.granite) {
    const gr = pedestal(beamY, -0.15, len * 0.75, 0.42);
    gr.position.x = mid;
    g.add(gr);
  } else {
    const st = box(len * 0.7, -0.13 - k.supportY, 0.24, pm.darkSteel(), 0.008);
    st.position.set(mid, k.supportY + (-0.13 - k.supportY) / 2, 0);
    g.add(st);
  }
  g.add(pipeX(k.x0 - 0.12, k.x0, 0.022), flangeX(k.x0, 0.05));
  return shadowed(g);
}

// ------------------------------------------------------------------ 4-ID-G diffractometer & detectors

/**
 * Huber horizontal-scattering diffractometer (6-circle 'ApsPolar' geometry: τ, μ, χ, φ, γ, δ). Shown with μ = 30° and the
 * open Eulerian cradle (χ = 0, its ring perpendicular to the μ-rotated beam axis), and the split detector arm swung to
 * the outboard side: analyzer/APD branch at 2θ = 60°, PAD branch at 35°.
 */
export function huberDiffractometer(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const F = -beamY;
  // base starts ~0.48 m upstream of the sample (plan: 66.7 m) so the KB1 granite fits in front of it
  const base = box(1.13, 0.12, 1.2, pm.huber(), 0.02);
  base.position.set(0.085, F + 0.06, 0);
  g.add(base);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const foot = cyl(0.05, 0.03, pm.black(), 16);
      foot.position.set(0.085 + sx * 0.5, F + 0.015, sz * 0.52);
      g.add(foot);
    }
  const tau = ringY(0.48, 0.26, 0.06, pm.huberLight(), 64);
  tau.position.y = F + 0.15;
  const upper = box(0.98, 0.24, 0.9, pm.huberLight(), 0.03);
  upper.position.set(0.03, F + 0.3, -0.05);
  g.add(tau, upper);
  // γ ring (detector circle, coaxial with μ) and μ table
  const gam = ringY(0.46, 0.37, 0.07, pm.huber(), 64);
  gam.position.y = F + 0.455;
  const mu = cyl(0.33, 0.08, pm.huber(), 64);
  mu.position.y = F + 0.46;
  g.add(gam, mu);
  // χ cradle: support tower on the inboard side + open ring (opening at the top for the magnet's cold head)
  const sample = new THREE.Group();
  sample.rotation.y = -G_MU;
  const tower = box(0.18, 0.62, 0.22, pm.huberLight(), 0.02);
  tower.position.set(0, -0.68, -0.32);
  sample.add(tower);
  const chiRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.032, 12, 64, Math.PI * 1.62), pm.huber());
  chiRing.rotation.y = Math.PI / 2; // ring in the plane ⟂ (μ-rotated) x
  chiRing.rotation.x = Math.PI / 2 + Math.PI * 0.19; // opening centred at the top
  const chiCarriage = box(0.12, 0.07, 0.16, pm.huberLight(), 0.01);
  chiCarriage.position.set(0, -0.3, 0);
  const phi = cyl(0.09, 0.04, pm.huber(), 32);
  phi.position.y = -0.255;
  const hub = box(0.08, 0.36, 0.08, pm.huberLight(), 0.01);
  hub.position.set(0, -0.48, -0.25);
  hub.rotation.x = 0.6;
  sample.add(chiRing, chiCarriage, phi, hub);
  g.add(sample);
  // split detector arm: two beams from a common root on the γ ring, outboard
  const arm = (a: number, r0: number, r1: number) => {
    const L = r1 - r0;
    const beam = box(L, 0.07, 0.08, pm.huber(), 0.01);
    beam.position.set(Math.cos(a) * (r0 + L / 2), ARM_Y - 0.035, Math.sin(a) * (r0 + L / 2));
    beam.rotation.y = -a;
    const riserH = ARM_Y - 0.07 - (F + 0.49);
    const riser = box(0.1, riserH, 0.1, pm.huber(), 0.01);
    riser.position.set(Math.cos(a) * r0, F + 0.49 + riserH / 2, Math.sin(a) * r0);
    const legH = ARM_Y - 0.07 - F - 0.06;
    const leg = cyl(0.025, legH, pm.huberLight(), 12);
    leg.position.set(Math.cos(a) * (r1 - 0.1), F + 0.06 + legH / 2, Math.sin(a) * (r1 - 0.1));
    const wheel = cyl(0.05, 0.05, pm.black(), 16);
    wheel.rotation.x = Math.PI / 2;
    wheel.rotation.y = -a;
    wheel.position.set(Math.cos(a) * (r1 - 0.1), F + 0.05, Math.sin(a) * (r1 - 0.1));
    // counterweight behind the root
    const cw = box(0.16, 0.16, 0.12, pm.darkSteel(), 0.01);
    cw.position.set(Math.cos(a) * (r0 - 0.06), F + 0.62, Math.sin(a) * (r0 - 0.06));
    cw.rotation.y = -a;
    g.add(beam, riser, leg, wheel, cw);
  };
  arm(ARM_APD.twoTheta, 0.42, ARM_APD.r + 0.08);
  arm(ARM_PAD.twoTheta, 0.42, ARM_PAD.r + 0.1);
  // flight tubes along each branch (helium/vacuum paths)
  for (const [a, r] of [[ARM_APD.twoTheta, ARM_APD.r - 0.12], [ARM_PAD.twoTheta, ARM_PAD.r - 0.14]] as const) {
    const L = r - 0.42;
    const ft = cylX(0.03, L, pm.steel(), 16);
    ft.position.set(Math.cos(a) * (0.42 + L / 2), 0, Math.sin(a) * (0.42 + L / 2));
    ft.rotation.set(0, -a, Math.PI / 2);
    const mount = box(0.04, -ARM_Y - 0.03, 0.04, pm.steel(), 0.004);
    mount.position.set(Math.cos(a) * (0.42 + L * 0.7), ARM_Y / 2 - 0.015, Math.sin(a) * (0.42 + L * 0.7));
    g.add(ft, mount);
  }
  return shadowed(g);
}

/**
 * ±2 T HTS split-pair magnet (GM-cooled, 60.4 mm pole gap) on the φ stage, in diffraction geometry: coil axis vertical
 * (field ⟂ beam), radial opening (190° × 45°) facing upstream, outboard and downstream; closed back toward inboard.
 */
export function htsMagnet(): THREE.Group {
  const g = new THREE.Group();
  const R = 0.12;
  const housing = new THREE.MeshStandardMaterial({ color: 0xb4bec9, roughness: 0.55, metalness: 0.55 });
  for (const s of [-1, 1]) {
    // coil cans leave a 100 mm-high radial opening at the rim; the coils inside sit 60 mm apart
    const can = cyl(R, 0.075, housing, 40);
    can.position.y = s * (0.05 + 0.0375);
    const coil = ringY(0.07, 0.025, 0.02, pm.coilSC(), 32);
    coil.position.y = s * 0.04;
    g.add(can, coil);
  }
  // closed 170° back, centred on the inboard side (CylinderGeometry θ = 0 points to +Z)
  const back = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.1, 40, 1, false, Math.PI * (95 / 180), Math.PI * (170 / 180)), housing);
  g.add(back);
  // GM cold head (Cryomech AL63) on top + flex lines
  const ch = cyl(0.055, 0.3, pm.steel(), 24);
  ch.position.y = 0.26;
  const mot = box(0.12, 0.12, 0.12, pm.black(), 0.01);
  mot.position.y = 0.46;
  g.add(ch, mot);
  for (const dz of [-0.03, 0.03]) g.add(hose([new THREE.Vector3(0, 0.52, dz), new THREE.Vector3(-0.1, 0.68, dz), new THREE.Vector3(-0.45, 0.72, -0.25 + dz), new THREE.Vector3(-0.7, 0.4, -0.55 + dz)], 0.012, pm.rubber()));
  // mount down to the φ stage
  const post = cyl(0.03, 0.11, housing, 16);
  post.position.y = -0.18;
  const sample = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), glowMaterial(0xc084fc, 3));
  g.add(post, sample);
  return shadowed(g);
}

/** High-precision imaging stack (air bearing + nanopositioners), shown parked on a cart. Origin at beam height above the cart. */
export function imagingStack(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const F = -beamY;
  const cartTop = F + 0.62;
  const top = box(0.62, 0.04, 0.62, pm.lid(), 0.01);
  top.position.y = cartTop - 0.02;
  const shelf = box(0.58, 0.03, 0.58, pm.lid(), 0.01);
  shelf.position.y = F + 0.2;
  g.add(top, shelf);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = cyl(0.015, 0.5, pm.steel(), 8);
      leg.position.set(sx * 0.28, F + 0.36, sz * 0.28);
      const caster = cyl(0.03, 0.03, pm.black(), 12);
      caster.rotation.x = Math.PI / 2;
      caster.position.set(sx * 0.28, F + 0.06, sz * 0.28);
      g.add(leg, caster);
    }
  let y = cartTop;
  const layer = (w: number, h: number, m: THREE.Material, round = false) => {
    const o = round ? cyl(w / 2, h, m, 40) : box(w, h, w, m, 0.006);
    o.position.y = y + h / 2;
    g.add(o);
    y += h;
  };
  layer(0.34, 0.05, pm.huberLight()); // double tilt ±7°
  layer(0.3, 0.09, pm.darkSteel()); // XYZ
  layer(0.28, 0.08, pm.lid(), true); // 360° air-bearing rotation
  layer(0.22, 0.04, pm.huberLight()); // tilt ±15°
  layer(0.18, 0.05, pm.darkSteel()); // XY
  layer(0.11, 0.05, pm.black()); // XYZ nanopositioner with strain gauges
  const pin = cyl(0.004, 0.05, pm.steel(), 8);
  pin.position.y = y + 0.025;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 8), glowMaterial(0xc084fc, 1.6));
  tip.position.y = y + 0.05;
  g.add(pin, tip);
  return shadowed(g);
}

/** Silicon drift detector with a snout; origin at the snout tip, snout pointing +X (rotate to aim at the sample). */
export function sdd(opts: { elements: 4 | 7; supportY: number; bodyLen?: number }): THREE.Group {
  const g = new THREE.Group();
  const snoutL = opts.elements === 7 ? 0.32 : 0.22;
  const sn = cylX(opts.elements === 7 ? 0.03 : 0.022, snoutL, pm.steel(), 20);
  sn.position.x = -snoutL / 2;
  const win = cylX(opts.elements === 7 ? 0.028 : 0.02, 0.003, pm.black(), 20);
  win.position.x = 0.0015;
  const bodyL = opts.bodyLen ?? 0.26;
  const body = cylX(opts.elements === 7 ? 0.07 : 0.05, bodyL, pm.steel(), 28);
  body.position.x = -snoutL - bodyL / 2;
  const elec = box(0.18, 0.12, 0.12, pm.black(), 0.01);
  elec.position.x = -snoutL - bodyL - 0.09;
  g.add(sn, win, body, elec);
  const postH = -opts.supportY - 0.08;
  const post = cyl(0.016, postH, pm.steel(), 10);
  post.position.set(-snoutL - bodyL / 2, opts.supportY + postH / 2, 0);
  const foot = box(0.12, 0.015, 0.12, pm.darkSteel(), 0.003);
  foot.position.set(-snoutL - bodyL / 2, opts.supportY + 0.0075, 0);
  g.add(post, foot);
  return shadowed(g);
}

/** In-vacuum polarization analyzer (2θA ≈ 90°) with an APD, at the end of the analyzer branch; origin = analyzer crystal. */
export function analyzerAPD(): THREE.Group {
  const g = new THREE.Group();
  const tank = cylX(0.075, 0.2, new THREE.MeshPhysicalMaterial({ color: 0xcfd8e3, metalness: 0.3, roughness: 0.25, transparent: true, opacity: 0.45, depthWrite: false }), 32);
  const caps = [-0.1, 0.1].map((x) => {
    const c = cylX(0.08, 0.012, pm.steel(), 32);
    c.position.x = x;
    return c;
  });
  const xtal = box(0.004, 0.03, 0.03, pm.silicon(), 0);
  xtal.rotation.z = 45 * DEG;
  const eta = ringX(0.06, 0.05, 0.02, pm.huberLight(), 32);
  eta.position.x = -0.1;
  const apd = cyl(0.022, 0.13, pm.black(), 16); // APD above (scattered through ~90°)
  apd.position.y = 0.12;
  const pre = box(0.07, 0.05, 0.05, pm.steel(), 0.005);
  pre.position.y = 0.21;
  const mount = box(0.05, -ARM_Y - 0.075 + 0.0, 0.05, pm.steel(), 0.004);
  mount.position.y = ARM_Y + (-ARM_Y - 0.075) / 2;
  g.add(tank, ...caps, xtal, eta, apd, pre, mount);
  return shadowed(g);
}

/** Dectris Eiger2 X 1M (77 × 80 mm² active) on a rail carriage on the PAD branch; face toward −X (rotate to aim). */
export function eiger(): THREE.Group {
  const g = new THREE.Group();
  const housing = box(0.24, 0.14, 0.13, new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.6, metalness: 0.35 }), 0.01);
  housing.position.x = 0.12;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.077, 0.08), new THREE.MeshStandardMaterial({ color: 0x0a0f16, emissive: 0x5cd3ff, emissiveIntensity: 0.35, roughness: 0.5 }));
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.001;
  const fins = box(0.16, 0.1, 0.02, pm.darkSteel(), 0.004);
  fins.position.set(0.14, 0, 0.075);
  const carriage = box(0.2, -ARM_Y - 0.07 - 0.0, 0.1, pm.huberLight(), 0.006);
  carriage.position.set(0.1, ARM_Y + (-ARM_Y - 0.07) / 2, 0);
  g.add(housing, face, fins, carriage);
  return shadowed(g);
}

// ------------------------------------------------------------------ 4-ID-H extreme-conditions instrument

/**
 * Cryogenic Ltd 9-1-1 T vector magnet: liquid-helium cryostat (green, drawn see-through), split solenoid pair with its
 * axis along the beam (±9 T ∥ beam) plus transverse ±1 T coil pairs, 75 mm vertical VTI bore for the top-loaded probe,
 * re-entrant side bores (Raman outboard, SDD inboard), big downstream window, on a heavy-load motorized table that
 * translates the magnet inboard for 'beam-pass'. Probe drive on top. Origin at the sample (73.3 m). Museum cut-away: the
 * cryostat wall is see-through and a wedge of the 9 T split pair is removed on the inboard-top side to reveal the DAC.
 */
export function magnet911(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const F = -beamY;
  const R = CRYO_R;
  const yb = -0.32;
  const yt = 0.62;
  // heavy-load table with translation rails (toward inboard)
  const frame = box(1.05, 0.26, 1.5, pm.frameBlue(), 0.02);
  frame.position.set(0, F + 0.13, -0.3);
  g.add(frame);
  for (const x of [-0.38, 0.38]) {
    const rail = box(0.06, 0.03, 1.46, pm.stripePt(), 0.004);
    rail.position.set(x, F + 0.275, -0.3);
    g.add(rail);
  }
  const carriage = box(1.0, 0.06, 1.0, pm.lid(), 0.01);
  carriage.position.y = F + 0.32;
  g.add(carriage);
  // support spider under the dewar
  const spiderH = yb - (F + 0.35);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const leg = box(0.1, spiderH, 0.1, pm.huberLight(), 0.01);
    leg.position.set(Math.cos(a) * 0.3, F + 0.35 + spiderH / 2, Math.sin(a) * 0.3);
    g.add(leg);
  }
  const ring = ringY(R + 0.02, R - 0.08, 0.05, pm.huberLight(), 48);
  ring.position.y = yb - 0.025;
  g.add(ring);
  // cryostat: see-through green wall, solid bands and flanges
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, yt - yb, 56, 1, true), pm.cryoGreen());
  shell.position.y = (yt + yb) / 2;
  shell.renderOrder = 4;
  g.add(shell);
  for (const [y, h] of [[yb + 0.02, 0.04], [0.33, 0.035], [yt - 0.02, 0.04]] as const) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.004, R + 0.004, h, 56, 1, true), pm.cryoGreenSolid());
    band.position.y = y;
    g.add(band);
  }
  const bottom = cyl(R, 0.02, pm.cryoGreenSolid(), 56);
  bottom.position.y = yb + 0.01;
  const flange = cyl(R + 0.035, 0.04, pm.steel(), 56);
  flange.position.y = yt + 0.02;
  g.add(bottom, flange);
  // 9 T split pair (axis ∥ beam) and transverse 1 T pairs
  for (const s of [-1, 1]) {
    // cut-away wedge (φ −25°…95°, facing the default inboard-above camera) so the DAC in the 60 mm split gap shows
    const c9 = ringXCut(0.22, 0.065, 0.11, pm.coilSC(), 95 * DEG, 240 * DEG);
    c9.position.x = s * 0.085;
    g.add(c9);
    const cz = ringX(0.085, 0.05, 0.03, pm.coil(), 32);
    cz.rotation.y = Math.PI / 2;
    cz.position.z = s * 0.25;
    g.add(cz);
  }
  for (const s of [-1, 1]) {
    const cy = ringY(0.1, 0.045, 0.03, pm.coil(), 32);
    cy.position.y = s * 0.25;
    g.add(cy);
  }
  // He bath level hint (inner can)
  const can = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 0.75, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x9fb6c9, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  can.position.y = 0.05;
  g.add(can);
  // VTI bore tube (75 mm) from the sample region up through the top flange
  const vti = new THREE.Mesh(new THREE.CylinderGeometry(0.0375, 0.0375, 1.0, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xc7d0da, metalness: 0.7, roughness: 0.3, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
  vti.position.y = 0.5;
  g.add(vti);
  // windows: upstream re-entrant, big downstream, side bores (Raman outboard, SDD inboard)
  const up = cylX(0.045, 0.1, pm.steel(), 24);
  up.position.x = -R - 0.03;
  const upW = cylX(0.03, 0.004, pm.beryllium(), 20);
  upW.position.x = -R - 0.081;
  const dn = cylX(0.09, 0.07, pm.steel(), 32);
  dn.position.x = R + 0.02;
  const dnW = cylX(0.07, 0.004, pm.beryllium(), 28);
  dnW.position.x = R + 0.056;
  g.add(up, upW, dn, dnW);
  for (const s of [-1, 1]) {
    const side = cylZ(0.045, 0.09, pm.steel(), 24);
    side.position.z = s * (R + 0.02);
    const w = cylZ(0.03, 0.004, s > 0 ? new THREE.MeshPhysicalMaterial({ color: 0xbfe9ff, roughness: 0.05, transparent: true, opacity: 0.6 }) : pm.beryllium(), 20);
    w.position.z = s * (R + 0.066);
    g.add(side, w);
  }
  // top: fill turrets, posts, top plate, probe drive
  for (const [x, z, r, h] of [[0.22, 0.18, 0.04, 0.16], [-0.2, 0.2, 0.03, 0.12], [0.18, -0.22, 0.05, 0.1]] as const) {
    const t = cyl(r, h, pm.steel(), 16);
    t.position.set(x, yt + 0.04 + h / 2, z);
    g.add(t);
  }
  const plateY = 1.05;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const p = cyl(0.016, plateY - yt - 0.04, pm.steel(), 10);
    p.position.set(Math.cos(a) * 0.3, (plateY + yt + 0.04) / 2, Math.sin(a) * 0.3);
    g.add(p);
  }
  const plate = box(0.72, 0.035, 0.72, pm.black(), 0.006);
  plate.position.y = plateY;
  const drive = box(0.3, 0.32, 0.36, pm.huberLight(), 0.02);
  drive.position.set(0.0, plateY + 0.18, -0.02);
  const drive2 = box(0.14, 0.14, 0.1, pm.huberLight(), 0.01);
  drive2.position.set(0.0, plateY + 0.27, 0.21);
  const neck = cyl(0.06, plateY - yt - 0.04, pm.steel(), 24);
  neck.position.y = (plateY + yt + 0.04) / 2;
  g.add(plate, drive, drive2, neck);
  // He recovery line
  g.add(hose([new THREE.Vector3(0.22, yt + 0.2, 0.18), new THREE.Vector3(0.3, yt + 0.4, 0.3), new THREE.Vector3(0.45, 1.3, 0.2), new THREE.Vector3(0.6, 1.45, -0.6)], 0.018, pm.steel()));
  return shadowed(g);
}

/** Probe tip: x/y/z nanopositioner and CuBe DAC with double (compression/decompression) He membranes. Origin = sample. */
export function dacProbe(): THREE.Group {
  const g = new THREE.Group();
  const cube = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.35, metalness: 0.8 });
  const body = cylX(0.026, 0.034, cube, 32);
  const memMat = new THREE.MeshStandardMaterial({ color: 0x7a6bd8, roughness: 0.35, metalness: 0.4, emissive: 0x1a1240 });
  const m1 = cylX(0.028, 0.006, memMat, 32);
  m1.position.x = -0.021;
  const m2 = cylX(0.028, 0.006, memMat, 32);
  m2.position.x = -0.029;
  // anvils (drawn ~2× for visibility) meeting at the sample
  const anvilGeo = new THREE.ConeGeometry(0.006, 0.01, 8);
  const a1 = new THREE.Mesh(anvilGeo, pm.diamond());
  a1.rotation.z = -Math.PI / 2;
  a1.position.x = -0.0055;
  const a2 = new THREE.Mesh(anvilGeo, pm.diamond());
  a2.rotation.z = Math.PI / 2;
  a2.position.x = 0.0055;
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 10, 8), glowMaterial(0xc084fc, 6));
  g.add(body, m1, m2, a1, a2, spark);
  // capillaries for the membranes
  for (const z of [-0.008, 0.008]) g.add(hose([new THREE.Vector3(-0.025, 0.02, z), new THREE.Vector3(-0.02, 0.07, z), new THREE.Vector3(-0.01, 0.2, z), new THREE.Vector3(0, 0.6, z)], 0.0015, pm.steel()));
  const holder = box(0.02, 0.05, 0.05, cube, 0.003);
  holder.position.y = 0.045;
  const nano = box(0.045, 0.06, 0.045, pm.darkSteel(), 0.004);
  nano.position.y = 0.1;
  const nano2 = box(0.04, 0.03, 0.04, pm.steel(), 0.003);
  nano2.position.y = 0.145;
  g.add(holder, nano, nano2);
  for (const z of [-0.016, 0.016]) {
    const rod = cyl(0.003, 0.9, pm.steel(), 8);
    rod.position.set(0, 0.6, z);
    g.add(rod);
  }
  const retro = new THREE.Mesh(new THREE.TetrahedronGeometry(0.006), pm.stripePt());
  retro.position.set(0, 0.07, -0.025);
  g.add(retro);
  return shadowed(g);
}

/** Raman/ruby system on its outboard breadboard: laser, spectrometer, objective on x/y/z/tilt stages into the side bore. */
export function ramanStation(beamY: number, objectiveReach: number): THREE.Group {
  const g = new THREE.Group();
  const top = TABLE_TOP;
  const bb = box(0.62, 0.06, 0.89, pm.tableTop(), 0.006);
  bb.position.y = top - 0.03;
  g.add(bb);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const legH = beamY + top - 0.06;
      const leg = box(0.05, legH, 0.05, pm.frameBlue(), 0.004);
      leg.position.set(sx * 0.27, -beamY + legH / 2, sz * 0.4);
      g.add(leg);
    }
  const spec = box(0.34, 0.16, 0.26, pm.black(), 0.01);
  spec.position.set(-0.08, top + 0.08, 0.17);
  const lab = box(0.12, 0.002, 0.08, pm.white(), 0);
  lab.position.set(-0.12, top + 0.161, 0.14);
  const laser = box(0.24, 0.09, 0.12, new THREE.MeshStandardMaterial({ color: 0x4a5160, roughness: 0.4, metalness: 0.5 }), 0.008);
  laser.position.set(0.12, top + 0.045, 0.28);
  g.add(spec, lab, laser);
  // objective on stages at the magnet-side edge
  const zEdge = -0.4;
  let y = top;
  for (const [w, h] of [[0.16, 0.06], [0.14, 0.06], [0.12, 0.06]] as const) {
    const s = box(w, h, w, y === top ? pm.darkSteel() : pm.steel(), 0.004);
    s.position.set(0, y + h / 2, zEdge);
    g.add(s);
    y += h;
  }
  const colH = -y - 0.03;
  const col = box(0.06, colH, 0.06, pm.darkSteel(), 0.004);
  col.position.set(0, y + colH / 2, zEdge);
  g.add(col);
  const tubeL = Math.abs(objectiveReach - zEdge);
  const obj = cylZ(0.022, tubeL, pm.white(), 20);
  obj.position.set(0, 0, (objectiveReach + zEdge) / 2);
  const lens = cylZ(0.014, 0.04, pm.black(), 16);
  lens.position.set(0, 0, objectiveReach + 0.02);
  g.add(obj, lens);
  g.add(hose([new THREE.Vector3(0, 0.02, zEdge + 0.02), new THREE.Vector3(0, 0.12, zEdge + 0.2), new THREE.Vector3(-0.05, top + 0.25, 0.1), new THREE.Vector3(-0.08, top + 0.17, 0.17)], 0.005, new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 })));
  // laser light into the bore (wavelength not published; drawn green)
  const ray = cylZ(0.0015, 0.42, glowMaterial(0x6dff8a, 2.2, 0.85), 6);
  ray.position.set(0, 0, objectiveReach - 0.21);
  g.add(ray);
  return shadowed(g);
}

/** Two laser-interferometer heads on a post, looking at the cryostat / probe; origin at the upper head. */
export function interferometerHeads(supportY: number, reach: number): THREE.Group {
  const g = new THREE.Group();
  const heads: [number, number][] = [[0, reach], [-0.3, reach * 0.85]];
  for (const [y, r] of heads) {
    const h = cylZ(0.014, 0.07, pm.stripePt(), 14);
    h.position.y = y;
    const fib = hose([new THREE.Vector3(0, y, -0.035), new THREE.Vector3(0, y - 0.05, -0.12), new THREE.Vector3(0.02, supportY + 0.1, -0.15)], 0.003, new THREE.MeshStandardMaterial({ color: 0xf2c230 }));
    const beam = cylZ(0.0012, r - 0.035, glowMaterial(0xff3344, 2.5, 0.9), 6);
    beam.position.set(0, y, 0.035 + (r - 0.035) / 2);
    g.add(h, fib, beam);
  }
  const postH = 0.04 - supportY;
  const post = cyl(0.015, postH - 0.3, pm.steel(), 10);
  post.position.y = supportY + (postH - 0.3) / 2;
  const bar = box(0.03, 0.34, 0.03, pm.steel(), 0.003);
  bar.position.set(0, -0.15, -0.03);
  const foot = box(0.1, 0.015, 0.1, pm.darkSteel(), 0.003);
  foot.position.y = supportY + 0.0075;
  g.add(post, bar, foot);
  return shadowed(g);
}

/**
 * Existing small-bore 4 T cryogen-free magnet: steel cryostat centred on the beam (sample at the coil centre, beam ports on
 * both ends), GM cold head on top, on a stand and blue frame. Origin at the sample.
 */
export function magnet4T(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const F = -beamY;
  const frame = box(0.95, 0.5, 1.2, pm.frameBlue(), 0.02);
  frame.position.y = F + 0.25;
  g.add(frame);
  const top = F + 0.5;
  const bodyH = 0.72;
  const body = cyl(0.3, bodyH, cached4T(), 48);
  const standH = -bodyH / 2 - top;
  const stand = cyl(0.22, standH, pm.darkSteel(), 32);
  stand.position.y = top + standH / 2;
  const fl = cyl(0.33, 0.04, pm.lid(), 48);
  fl.position.y = bodyH / 2 + 0.02;
  const head = cyl(0.07, 0.38, pm.steel(), 24);
  head.position.set(0.08, bodyH / 2 + 0.04 + 0.19, 0.05);
  const mot = box(0.14, 0.14, 0.14, pm.black(), 0.01);
  mot.position.set(0.08, bodyH / 2 + 0.04 + 0.38 + 0.07, 0.05);
  g.add(body, stand, fl, head, mot);
  for (const s of [-1, 1]) {
    const port = cylX(0.04, 0.08, pm.steel(), 20);
    port.position.x = s * 0.33;
    const win = cylX(0.025, 0.004, pm.beryllium(), 16);
    win.position.x = s * 0.372;
    g.add(port, win);
  }
  const yTop = bodyH / 2 + 0.04 + 0.38 + 0.14;
  for (const dz of [-0.03, 0.03]) g.add(hose([new THREE.Vector3(0.08, yTop, 0.05 + dz), new THREE.Vector3(0.1, yTop + 0.15, 0.2 + dz), new THREE.Vector3(0.2, yTop - 0.15, 0.75 + dz), new THREE.Vector3(0.25, F + 0.05, 0.85 + dz)], 0.013, pm.rubber()));
  return shadowed(g);
}

let mat4T: THREE.MeshStandardMaterial | null = null;
function cached4T(): THREE.MeshStandardMaterial {
  return (mat4T ??= new THREE.MeshStandardMaterial({ color: 0xaeb7c1, roughness: 0.5, metalness: 0.6 }));
}

/**
 * Mono beam stop: tungsten block bolted to the face of a lead backing plate, the plate standing on its own column and foot.
 * (Everything touches: block → plate → column → floor.)
 */
export function beamStopBlock(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const w = box(0.1, 0.12, 0.12, pm.tungsten(), 0.006);
  const pb = box(0.06, 0.4, 0.4, pm.lead(), 0.006);
  pb.position.x = 0.08; // upstream face at x = 0.05, flush with the block's downstream face
  const col = pedestal(beamY, -0.2, 0.08, 0.12, pm.darkSteel());
  col.position.x = 0.08;
  const foot = box(0.3, 0.03, 0.4, pm.darkSteel(), 0.004);
  foot.position.set(0.08, -beamY + 0.015, 0);
  // short bracket under the block so it does not look cantilevered off the plate
  const br = box(0.1, 0.14, 0.05, pm.darkSteel(), 0.004);
  br.position.set(0.0, -0.13, 0);
  g.add(w, pb, col, foot, br);
  return shadowed(g);
}

/**
 * Compact station shutter / beam stop at the 4-ID-G/H wall (inferred). The 2021 elevation drawing shows only a small box on a
 * stand at beam height (~0.3 m along the beam), not a full-size mono shutter: a lead-lined body with a pneumatic actuator on
 * top, on a column. Origin on the beam axis.
 */
export function compactShutter(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.28, 0.3, 0.3, pm.shutterYellow(), 0.012);
  body.position.y = 0.03;
  const cap = box(0.3, 0.025, 0.32, pm.darkSteel(), 0.004);
  cap.position.y = 0.19;
  const act = cyl(0.035, 0.2, pm.steel(), 16);
  act.position.y = 0.3;
  const head = box(0.08, 0.05, 0.08, pm.black(), 0.005);
  head.position.y = 0.42;
  const tag = box(0.002, 0.08, 0.16, pm.black(), 0);
  tag.position.set(-0.142, 0.03, 0);
  g.add(body, cap, act, head, tag);
  const col = pedestal(beamY, -0.12, 0.16, 0.18, pm.darkSteel());
  const foot = box(0.34, 0.03, 0.34, pm.darkSteel(), 0.004);
  foot.position.y = -beamY + 0.015;
  g.add(col, foot, pipeX(-0.22, -0.14, 0.022), pipeX(0.14, 0.22, 0.022));
  return shadowed(g);
}

/** Spin / slow rotation for small live details, driven by the scene's per-frame hook. */
export function spin(host: THREE.Object3D, axis: 'x' | 'y' | 'z', radPerS: number, onFrame: FrameHook): void {
  if (reducedMotion()) return;
  onFrame((_dt, t) => {
    host.rotation[axis] = t * radPerS;
  });
}

/**
 * Retractable beam-viewing flag: a small six-way cross on the beam pipe, pneumatic actuator on top (the YAG screen drops into
 * the beam), and a camera looking at the screen through a side viewport (outboard). Origin on the beam axis.
 */
export function beamFlag(beamY: number, supportY = -beamY): THREE.Group {
  const g = new THREE.Group();
  const cross = box(0.075, 0.075, 0.075, pm.steel(), 0.006);
  const act = cyl(0.016, 0.16, pm.steel(), 12);
  act.position.y = 0.0375 + 0.08;
  const valve = box(0.05, 0.04, 0.04, pm.black(), 0.004);
  valve.position.y = 0.0375 + 0.17;
  const port = cylZ(0.022, 0.04, pm.steel(), 14);
  port.position.z = 0.0575;
  const cam = box(0.06, 0.05, 0.06, pm.black(), 0.005);
  cam.position.z = 0.12;
  const lens = cylZ(0.016, 0.04, pm.darkSteel(), 14);
  lens.position.z = 0.08;
  const yag = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.03), new THREE.MeshStandardMaterial({ color: 0xc8ff9a, emissive: 0x7dff6a, emissiveIntensity: 0.6, roughness: 0.4 }));
  yag.rotation.y = Math.PI / 4;
  g.add(cross, act, valve, port, cam, lens, yag);
  g.add(pipeX(-0.07, 0.07, 0.022));
  const postH = -0.0375 - supportY;
  if (postH > 0.04) {
    const post = cyl(0.014, postH, pm.steel(), 10);
    post.position.y = supportY + postH / 2;
    const foot = box(0.09, 0.012, 0.09, pm.darkSteel(), 0.003);
    foot.position.y = supportY + 0.006;
    g.add(post, foot);
  }
  return shadowed(g);
}

export { vesselCylY };
