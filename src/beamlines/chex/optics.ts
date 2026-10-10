import * as THREE from 'three';
import { COLORS } from '../../scene/palette';
import { DEG } from './geom';
import { M, box, cyl, flangeX, hose, pipeX, post, rod, shadowed, v3, vesselBox, vesselCyl } from './kit';

/**
 * Beam-conditioning and optics models for CHEX (part frame: origin on the beam, +X downstream, +Y up, +Z outboard).
 */

// ------------------------------------------------------------------ source

/**
 * Canting magnets of the 28-ID straight: 0.5 mrad dipoles at each end of the ~5.4 m straight and a short 1 mrad magnet
 * between the two undulators (FDR 3-3.3.5). Origin = straight-section centre.
 */
export function cantingMagnets(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const yoke = new THREE.MeshStandardMaterial({ color: 0x3f7fd6, roughness: 0.5, metalness: 0.25 });
  const coil = M.copper();
  const dipole = (x: number, len: number) => {
    const d = new THREE.Group();
    const top = box(len, 0.12, 0.42, yoke, 0.01);
    top.position.y = 0.11;
    const bot = box(len, 0.12, 0.42, yoke, 0.01);
    bot.position.y = -0.11;
    const back = box(len, 0.34, 0.1, yoke, 0.01);
    back.position.z = -0.16; // C-yoke open to the outboard side (the photon beams leave on the outboard side)
    const c1 = box(len + 0.06, 0.04, 0.3, coil, 0.008);
    c1.position.y = 0.035;
    const c2 = c1.clone();
    c2.position.y = -0.035;
    d.add(top, bot, back, c1, c2, post(beamY, -0.17, Math.max(0.2, len * 0.8), 0.3, M.darkSteel()));
    d.position.x = x;
    return d;
  };
  g.add(dipole(-2.55, 0.22), dipole(0, 0.16), dipole(2.55, 0.22));
  return shadowed(g);
}

// ------------------------------------------------------------------ masks, collimators, stops, pipes

/**
 * Shielding block (mask / collimator) with one aperture per beam that crosses it.
 * `holes` = lateral offsets (m) of the beams in the part frame.
 */
export function shieldBlock(o: { beamY: number; len: number; w?: number; h?: number; mat: 'copper' | 'tungsten' | 'lead'; holes: number[]; hole?: number }): THREE.Group {
  const g = new THREE.Group();
  const lo = Math.min(...o.holes);
  const hi = Math.max(...o.holes);
  const w = Math.max(o.w ?? 0.24, hi - lo + 0.16);
  const h = o.h ?? 0.24;
  const zc = (lo + hi) / 2;
  const m = o.mat === 'copper' ? M.copper() : o.mat === 'tungsten' ? M.tungsten() : M.lead();
  const b = box(o.len, h, w, m, 0.01);
  b.position.z = zc;
  g.add(b);
  const r = (o.hole ?? 0.012) / 2 + 0.002;
  for (const z of o.holes) {
    for (const s of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(r, 20), M.hole());
      d.rotation.y = (s * Math.PI) / 2;
      d.position.set((s * (o.len / 2 + 0.002)), 0, z);
      g.add(d);
    }
  }
  g.add(post(o.beamY, -h / 2, o.len * 0.9, Math.min(w, 0.5), M.darkSteel(), 0, zc));
  return shadowed(g);
}

/**
 * Lead-wrapped shielded beam pipe from x = 0 to x = len (part frame), with flanges and floor supports. The lead jacket
 * is drawn as a translucent shell (ghost) so the beam inside it stays visible over the long CHEX transports.
 */
export function shieldedPipe(o: { beamY: number; len: number; rOut?: number; supports?: number; ghost?: boolean }): THREE.Group {
  const g = new THREE.Group();
  const r = o.rOut ?? 0.085;
  g.add(pipeX(0, o.len, r, o.ghost === false ? M.lead() : M.leadGhost(), 24));
  const nF = Math.max(1, Math.round(o.len / 1.6));
  for (let i = 0; i <= nF; i++) g.add(flangeX((i / nF) * o.len, r + 0.02, M.steel()));
  const nS = o.supports ?? Math.max(1, Math.round(o.len / 2.5));
  for (let i = 0; i < nS; i++) {
    const x = ((i + 0.5) / nS) * o.len;
    g.add(post(o.beamY, -r, 0.12, 0.28, M.steel(), x, 0));
    const saddle = box(0.14, 0.05, 0.3, M.darkSteel(), 0.005);
    saddle.position.set(x, -r - 0.02, 0);
    g.add(saddle);
  }
  return shadowed(g);
}

/** Thin stainless beam pipe on two light posts (beam-pass pipe through a front station). */
export function thinPipe(beamY: number, len: number, r = 0.022): THREE.Group {
  const g = new THREE.Group();
  g.add(pipeX(0, len, r, M.ss(), 16));
  g.add(flangeX(0, r + 0.02), flangeX(len, r + 0.02));
  for (const f of [0.2, 0.8]) {
    if (len < 1) continue;
    g.add(post(beamY, -r, 0.05, 0.05, M.steel(), len * f, 0));
  }
  return shadowed(g);
}

/** Moveable beam stop: tungsten core in a lead block on a motorised vertical stage. `retracted` lifts it clear. */
export function beamStopBlock(beamY: number, o: { white?: boolean; retracted?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const lift = o.retracted ? 0.17 : 0;
  const body = box(0.18, 0.22, 0.2, o.white ? M.tungsten() : M.lead(), 0.01);
  body.position.y = lift;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), M.hole());
  face.rotation.y = -Math.PI / 2;
  face.position.set(-0.092, lift, 0);
  const stage = box(0.12, 0.22, 0.16, M.blackAnod(), 0.006);
  stage.position.y = -0.24;
  const motor = cyl(0.03, 0.1, M.darkSteel(), 12);
  motor.position.set(0, -0.12, 0.11);
  motor.rotation.x = Math.PI / 2;
  g.add(body, face, stage, motor, post(beamY, -0.35, 0.18, 0.18, M.steel()));
  return shadowed(g);
}

// ------------------------------------------------------------------ monochromators

/**
 * Thin single-crystal side-bounce monochromator (SCM). The crystal plate sits on the inboard (shared) beam at the Bragg
 * angle and reflects one harmonic sideways by 2θ (positive = outboard), while the rest of the beam passes through it.
 * The plate is drawn ~3× its real size (≈6 mm, 0.1-0.2 mm thick) so it reads at hutch scale. The vessel also lets the
 * tunable beam pass 28-40 mm outboard, as in the real canted layout.
 */
export function scm(o: { beamY: number; twoThetaDeg: number; crystal: 'diamond' | 'silicon'; tunableAt: number }): THREE.Group {
  const g = new THREE.Group();
  const thB = (o.twoThetaDeg / 2) * DEG;
  const sgn = Math.sign(o.twoThetaDeg);
  const out = o.twoThetaDeg * DEG;
  // vessel spans both beams
  const zc = o.tunableAt / 2 + sgn * 0.02;
  const ves = vesselBox(0.42, 0.32, 0.36);
  ves.position.set(0, 0.02, zc);
  g.add(ves);
  const lid = box(0.44, 0.03, 0.38, M.steel(), 0.006);
  lid.position.set(0, 0.195, zc);
  const base = box(0.44, 0.03, 0.38, M.steel(), 0.006);
  base.position.set(0, -0.155, zc);
  g.add(lid, base);
  // crystal plate (drawn ~3x): diamond = thin transparent plate; silicon = thicker block (body on the far side)
  const plate = o.crystal === 'diamond' ? box(0.022, 0.022, 0.0025, M.diamond(), 0.0005) : box(0.05, 0.026, 0.012, M.siCrystal(), 0.001);
  const pivot = new THREE.Group();
  pivot.rotation.y = -sgn * thB; // plate plane at θB to the beam, tilted toward the deflection side
  if (o.crystal === 'silicon') plate.position.z = -sgn * 0.006; // reflecting face on the beam, body behind it
  pivot.add(plate);
  // copper clamp from above + LN2-cooled braid
  const clamp = box(0.03, 0.03, 0.02, M.copper(), 0.003);
  clamp.position.y = 0.024;
  pivot.add(clamp);
  g.add(pivot);
  const stem = cyl(0.008, 0.15, M.steel(), 10);
  stem.position.y = 0.11;
  g.add(stem);
  // rotation stage under the base, fine-tilt actuators on the lid
  const rot = cyl(0.09, 0.05, M.blackAnod(), 28);
  rot.position.set(0, -0.195, zc);
  g.add(rot);
  for (const dx of [-0.12, 0.12]) {
    const a = cyl(0.018, 0.12, M.darkSteel(), 10);
    a.position.set(dx, 0.27, zc);
    g.add(a);
  }
  g.add(hose([v3(0, 0.21, zc), v3(0.05, 0.5, zc), v3(0.1, 0.75, zc + sgn * 0.3), v3(0.12, 0.9, zc + sgn * 0.7)], 0.022, M.ln2()));
  // ports: straight-through (both canted beams) and the deflected exit at 2θ
  g.add(pipeX(-0.42, -0.21, 0.04), flangeX(-0.21, 0.065), pipeX(0.21, 0.42, 0.04), flangeX(0.21, 0.065));
  const exit = new THREE.Group();
  exit.rotation.y = -out;
  const L0 = 0.21 / Math.cos(out);
  exit.add(pipeX(L0, L0 + 0.25, 0.03), flangeX(L0, 0.05));
  g.add(exit);
  g.add(post(o.beamY, -0.18, 0.34, 0.3, M.granite(), 0, zc));
  return shadowed(g);
}

/**
 * Horizontal (side-bounce) LN2-cooled fixed-exit double-crystal monochromator 28ID-MN-1. Bragg axis vertical, so the
 * vessel is a vertical drum; the two Si crystals face each other across a ~4 mm gap and shift the beam ~8 mm outboard
 * (the 2025 ray trace moves a photon mask 4-8 mm outboard for monochromatic mode). Crystal angle drawn for ~10 keV
 * Si(111) (θ ≈ 11.4°). The inboard canted beam passes 35 mm away inside the same vessel.
 */
export function hdcm(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const th = 11.4 * DEG;
  const tank = vesselCyl(0.34, 0.5);
  tank.position.y = 0.04;
  g.add(tank);
  const lid = cyl(0.36, 0.05, M.steel(), 40);
  lid.position.y = 0.315;
  const bottom = cyl(0.36, 0.06, M.steel(), 40);
  bottom.position.y = -0.24;
  g.add(lid, bottom);
  const n1 = new THREE.Vector2(-Math.sin(th), Math.cos(th)); // crystal-1 surface normal (x,z), points outboard
  const mk = (sx: number, sz: number, side: 1 | -1) => {
    const c = box(0.09, 0.045, 0.025, M.siCrystal(), 0.002);
    const holder = box(0.1, 0.03, 0.035, M.copper(), 0.003);
    const grp = new THREE.Group();
    // body behind the reflecting face: crystal 1 inboard of its face, crystal 2 outboard of its face
    c.position.set(0, 0, -side * 0.0125);
    holder.position.set(0, -0.04, -side * 0.0125);
    grp.add(c, holder);
    grp.position.set(sx, 0, sz);
    grp.rotation.y = -th;
    void n1;
    return grp;
  };
  const D = 0.008;
  const dx = D / Math.tan(2 * th);
  g.add(mk(0, 0, 1), mk(dx, D, -1));
  // rotation stage, LN2 lines
  const rot = cyl(0.16, 0.08, M.blackAnod(), 32);
  rot.position.y = -0.3;
  g.add(rot);
  g.add(hose([v3(0.05, 0.34, 0.05), v3(0.08, 0.7, 0.1), v3(0.2, 1.05, 0.5), v3(0.3, 1.1, 1.2)], 0.03, M.ln2()));
  g.add(hose([v3(-0.05, 0.34, 0.08), v3(-0.06, 0.72, 0.16), v3(0.1, 1.1, 0.6), v3(0.2, 1.15, 1.3)], 0.03, M.ln2()));
  g.add(pipeX(-0.6, -0.34, 0.045), flangeX(-0.34, 0.075), pipeX(0.34, 0.6, 0.045), flangeX(0.34, 0.075));
  g.add(post(beamY, -0.34, 0.7, 0.7, M.granite()));
  return shadowed(g);
}

/** Small X-ray beam glint (short glowing rod) used inside optics to show where the beam is reflected. */
export function glint(a: THREE.Vector3, b: THREE.Vector3): THREE.Mesh {
  const m = rod(a, b, 0.0025, new THREE.MeshBasicMaterial({ color: COLORS.xray.clone().multiplyScalar(3), toneMapped: false }), 6);
  return m;
}
