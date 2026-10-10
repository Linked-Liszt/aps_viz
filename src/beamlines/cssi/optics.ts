import * as THREE from 'three';
import { glowMaterial, COLORS } from '../../scene/palette';
import { box, cm, cyl, cylX, cylZ, flangeX, hose, pedestal, pipeX, shadowed, strut, v3, vesselBox, vesselCylY } from './kit';
import { KB } from './geom';

/** Shielding block (mask / collimator / stop) with a square beam aperture, on a short stand. */
export function shieldBlock(o: {
  beamY: number;
  len: number;
  w?: number;
  h?: number;
  mat: 'copper' | 'tungsten' | 'lead';
  hole?: number;
  water?: boolean;
  /** floor-to-top stand height override: stand top (beam frame) */
  standTop?: number;
}): THREE.Group {
  const g = new THREE.Group();
  const w = o.w ?? 0.24;
  const h = o.h ?? 0.24;
  const m = o.mat === 'copper' ? cm.copper() : o.mat === 'tungsten' ? cm.tungsten() : cm.lead();
  const hole = o.hole ?? 0.012;
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
    for (const s of [-1, 1])
      g.add(hose([v3(-o.len * 0.25, h / 2, s * 0.05), v3(-o.len * 0.25, h / 2 + 0.12, s * 0.05), v3(-o.len * 0.25, h / 2 + 0.2, s * 0.2)], 0.011, cm.waterHose()));
  }
  g.add(pedestal(o.beamY, o.standTop ?? -h / 2, Math.min(o.len, 0.22), Math.min(w, 0.22), cm.darkSteel()));
  return shadowed(g);
}

/**
 * PM-5: water-cooled mask with two apertures, one on the pink path and one on the mono path ~10 mm outboard
 * (the model draws the beam on one axis; the mono aperture is the one on the axis, the pink one 10 mm inboard).
 */
export function dualApertureMask(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const len = 0.14;
  const w = 0.24;
  const h = 0.22;
  const hole = 0.006;
  const pink = -0.01;
  // build as slabs around two holes at z = 0 and z = pink
  const zs = [-w / 2, pink - hole / 2, pink + hole / 2, -hole / 2, hole / 2, w / 2];
  const solids: [number, number][] = [
    [zs[0], zs[1]],
    [zs[2], zs[3]],
    [zs[4], zs[5]],
  ];
  for (const [a, b] of solids) {
    const s = box(len, h, b - a, cm.copper(), 0.002);
    s.position.z = (a + b) / 2;
    g.add(s);
  }
  for (const zc of [0, pink]) {
    for (const sy of [-1, 1]) {
      const s = box(len, (h - hole) / 2, hole, cm.copper(), 0);
      s.position.set(0, sy * (hole / 2 + (h - hole) / 4), zc);
      g.add(s);
    }
  }
  for (const s of [-1, 1]) g.add(hose([v3(-0.03, h / 2, s * 0.05), v3(-0.03, h / 2 + 0.12, s * 0.05), v3(-0.03, h / 2 + 0.2, s * 0.2)], 0.011, cm.waterHose()));
  g.add(pedestal(beamY, -h / 2, 0.14, 0.2, cm.darkSteel()));
  return shadowed(g);
}

/** BS-2: tungsten pink-beam stop that sits on the pink path, 10 mm inboard of the mono beam, inside a small vessel with gate valve. */
export function pinkBeamStop(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const stop = box(0.12, 0.06, 0.03, cm.tungsten(), 0.003);
  stop.position.z = -0.01 - 0.015 + 0.006; // covers the pink path (z = −10 mm) and stops short of the mono beam
  const arm = box(0.02, 0.16, 0.02, cm.steel(), 0);
  arm.position.set(0, 0.11, -0.02);
  g.add(stop, arm, vesselBox(0.22, 0.26, 0.2));
  // gate valve GV-5 upstream
  const gv = box(0.08, 0.32, 0.16, cm.steel(), 0.01);
  gv.position.set(-0.2, 0.06, 0);
  const act = cyl(0.04, 0.16, cm.black(), 14);
  act.position.set(-0.2, 0.3, 0);
  g.add(gv, act, pipeX(-0.34, 0.22, 0.03), flangeX(-0.11, 0.07), flangeX(0.11, 0.07));
  g.add(pedestal(beamY, -0.13, 0.2, 0.2, cm.darkSteel()));
  return shadowed(g);
}

/** Compact photon shutter (PH-1): tungsten paddle in a short vessel with a pneumatic actuator. */
export function compactShutter(beamY: number, color = cm.shutterYellow()): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.2, 0.36, 0.22, color, 0.02);
  body.position.y = 0.06;
  const act = cyl(0.045, 0.2, cm.black(), 14);
  act.position.y = 0.34;
  g.add(body, act, pipeX(-0.16, 0.16, 0.03), pedestal(beamY, -0.12, 0.18, 0.18, cm.darkSteel()));
  return shadowed(g);
}

/** Fast experimental shutter on the 9-ID-D optical table. */
export function fastShutter(tableTop: number): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.06, 0.12, 0.1, cm.black(), 0.006);
  const blade = box(0.004, 0.05, 0.05, cm.tungsten(), 0);
  blade.position.set(0.032, 0.03, 0);
  const post = box(0.05, -0.06 - tableTop, 0.05, cm.steel(), 0.004);
  post.position.y = tableTop + (-0.06 - tableTop) / 2;
  g.add(body, blade, post, pipeX(-0.12, -0.03, 0.015), pipeX(0.03, 0.12, 0.015));
  return shadowed(g);
}

/**
 * Horizontal double-crystal monochromator (LN2-cooled, fixed exit): vertical cylindrical tank with two Si crystals
 * standing on edge so the Bragg reflection is horizontal (θ = 13° drawn: the FDR Si(111) case at 8.8 keV). The beam
 * exits outboard of the pink path; the crystal offset is drawn 30 mm (×3 of the ~10 mm pink/mono separation).
 */
export function hdcm(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const tank = vesselCylY(0.43, 0.8);
  const lid = cyl(0.45, 0.05, cm.steel(), 40);
  lid.position.y = 0.42;
  const bottom = cyl(0.45, 0.06, cm.steel(), 40);
  bottom.position.y = -0.43;
  g.add(tank, lid, bottom);
  const th = (13 * Math.PI) / 180;
  const sep = 0.03;
  const d = sep / Math.sin(2 * th);
  const p1 = v3(-(d * Math.cos(2 * th)) / 2, 0, 0);
  const p2 = v3((d * Math.cos(2 * th)) / 2, 0, sep);
  const t = 0.035;
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  for (const [p, s] of [[p1, 1], [p2, -1]] as const) {
    const xtal = box(0.12, 0.07, t, cm.silicon(), 0.004);
    // crystal 1 body behind its surface on the −z side, crystal 2 on the +z side
    xtal.position.set(p.x + s * (sn * t) / 2, 0, p.z - s * (cs * t) / 2);
    xtal.rotation.y = -th;
    const holder = box(0.14, 0.09, 0.03, cm.copper(), 0.004);
    holder.position.set(p.x + s * sn * (t + 0.015), 0, p.z - s * cs * (t + 0.015));
    holder.rotation.y = -th;
    g.add(xtal, holder);
  }
  g.add(strut(p1, p2, 0.0025, glowMaterial(COLORS.xray, 3)));
  const stage = cyl(0.2, 0.08, cm.darkSteel(), 32);
  stage.position.y = -0.33;
  const post = box(0.06, 0.25, 0.06, cm.steel(), 0.005);
  post.position.y = -0.17;
  g.add(stage, post);
  for (const s of [-1, 1]) g.add(hose([v3(s * 0.08, 0.44, 0.1), v3(s * 0.08, 0.85, 0.12), v3(s * 0.1, 1.15, 0.5), v3(s * 0.1, 1.15, 1.05)], 0.03, cm.hose()));
  g.add(pipeX(-0.7, -0.43, 0.035), pipeX(0.43, 0.7, 0.035), flangeX(-0.43, 0.08), flangeX(0.43, 0.08));
  g.add(pedestal(beamY, -0.46, 0.85, 0.85, cm.granite()));
  return shadowed(g);
}

/**
 * Be-lens transfocator (as-built: CRL-1 9 cartridges, CRL-2 10 cartridges, all 2D parabolic): vacuum housing with one
 * pneumatic actuator per cartridge; inserted cartridges sit on the beam, retracted ones are lifted (zoom principle).
 * Lens cartridges are enlarged for visibility.
 */
export function transfocator(beamY: number, n: number, inserted: number[], standTop?: number): THREE.Group {
  const g = new THREE.Group();
  const pitch = 0.042;
  const L = n * pitch + 0.1;
  g.add(vesselBox(L, 0.28, 0.22));
  for (let i = 0; i < n; i++) {
    const x = -((n - 1) * pitch) / 2 + i * pitch;
    const isIn = inserted.includes(i);
    const yC = isIn ? 0 : 0.075;
    const cart = box(0.026, 0.055, 0.055, cm.alu(), 0.004);
    cart.position.set(x, yC, 0);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.013, 14, 8), cm.lens());
    lens.scale.set(0.45, 1, 1);
    lens.position.set(x - 0.014, yC, 0);
    const rodLen = 0.12 - yC + 0.04;
    const rod = cyl(0.005, rodLen, cm.steel(), 8);
    rod.position.set(x, yC + 0.028 + rodLen / 2, 0);
    const act = cyl(0.015, 0.09, cm.black(), 12);
    act.position.set(x, 0.23, 0);
    g.add(cart, lens, rod, act);
  }
  g.add(hose([v3(-L / 2, -0.05, 0.12), v3(L / 2, -0.05, 0.12)], 0.011, cm.waterHose()));
  g.add(pipeX(-L / 2 - 0.1, -L / 2, 0.03), pipeX(L / 2, L / 2 + 0.1, 0.03), flangeX(-L / 2, 0.065), flangeX(L / 2, 0.065));
  const stage = box(L * 0.9, 0.05, 0.3, cm.darkSteel(), 0.006);
  stage.position.y = -0.165;
  g.add(stage, pedestal(beamY, -0.19, L * 0.6, 0.28, standTop === undefined ? cm.granite() : cm.steel()));
  return shadowed(g);
}

/**
 * KB pair 9ID-MR-3 in its UHV chamber on the shared granite: vertical-focusing mirror (face up, below the beam) at
 * ~54.08 m, then horizontal-focusing mirror (face sideways) at ~54.35 m, Pt-coated, bendable, with flexure benders and
 * an interferometer metrology frame. Local origin at KB.x; granite top at `graniteTop`.
 */
export function kbChamber(graniteTop: number): THREE.Group {
  const g = new THREE.Group();
  const W = 0.62;
  g.add(vesselBox(W, 0.46, 0.56));
  const vx = KB.vX - KB.x;
  const hx = KB.hX - KB.x;
  // V mirror: substrate below the beam, Pt face up
  const vSub = box(KB.vLen, 0.035, 0.045, cm.silicon(), 0.003);
  vSub.position.set(vx, -0.0195, 0);
  const vFace = new THREE.Mesh(new THREE.PlaneGeometry(KB.vLen * 0.97, 0.034), cm.pt());
  vFace.rotation.x = -Math.PI / 2;
  vFace.position.set(vx, -0.0015, 0);
  // H mirror: substrate on the inboard side, Pt face toward +z (deflection sense undocumented)
  const hSub = box(KB.hLen, 0.045, 0.035, cm.silicon(), 0.003);
  hSub.position.set(hx, 0, -0.0195);
  const hFace = new THREE.Mesh(new THREE.PlaneGeometry(KB.hLen * 0.97, 0.034), cm.pt());
  hFace.position.set(hx, 0, -0.0015);
  g.add(vSub, vFace, hSub, hFace);
  // flexure benders: lever arms at both mirror ends, piezo stacks
  const piezo = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.35, metalness: 0.8 });
  for (const s of [-1, 1]) {
    const lv = box(0.025, 0.07, 0.07, cm.darkSteel(), 0.003);
    lv.position.set(vx + (s * KB.vLen) / 2, -0.06, 0);
    const lh = box(0.025, 0.07, 0.07, cm.darkSteel(), 0.003);
    lh.position.set(hx + (s * KB.hLen) / 2, 0, -0.06);
    g.add(lv, lh);
  }
  for (const [x, y, z] of [[vx, -0.09, 0], [hx, 0, -0.09]] as const) {
    const p = box(0.03, 0.03, 0.03, piezo, 0.002);
    p.position.set(x, y, z);
    g.add(p);
  }
  // metrology frame (interferometer heads aimed at the mirror backs)
  const frameMat = cm.aluDark();
  const fr = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.008, 6, 4), frameMat);
  fr.rotation.y = Math.PI / 2;
  fr.rotation.x = Math.PI / 4;
  fr.position.x = (vx + hx) / 2;
  g.add(fr);
  for (const [x, y, z] of [[vx - 0.06, -0.14, 0.06], [vx + 0.06, -0.14, -0.06], [hx - 0.05, 0.08, -0.13], [hx + 0.05, -0.08, -0.13]] as const) {
    const head = cyl(0.012, 0.05, cm.black(), 10);
    head.position.set(x, y, z);
    if (Math.abs(z) > 0.1) head.rotation.x = Math.PI / 2;
    g.add(head);
  }
  // flexure alignment stages and the chamber base plate
  const base = box(W - 0.04, 0.03, 0.5, cm.darkSteel(), 0.004);
  base.position.y = -0.2;
  const plate = box(W + 0.06, 0.06, 0.66, cm.steel(), 0.006);
  plate.position.y = -0.26;
  g.add(base, plate);
  // ports on top and sides
  for (const [x, z] of [[-0.18, 0], [0.0, 0.1], [0.18, -0.05]] as const) {
    const port = cyl(0.045, 0.06, cm.steel(), 18);
    port.position.set(x, 0.26, z);
    g.add(port);
  }
  for (const x of [-0.15, 0.12]) {
    const port = cylZ(0.05, 0.05, cm.steel(), 18);
    port.position.set(x, 0, -0.3);
    g.add(port);
  }
  // air-bearing feet down to the granite
  const footH = -0.29 - graniteTop;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const f = box(0.12, footH, 0.12, cm.alu(), 0.006);
      f.position.set(sx * 0.22, graniteTop + footH / 2, sz * 0.22);
      g.add(f);
    }
  g.add(pipeX(-W / 2 - 0.12, -W / 2, 0.03), flangeX(-W / 2, 0.07), flangeX(W / 2, 0.07));
  return shadowed(g);
}

/** Shielded transport supports with lead collars around the engine-drawn pipe (local origin at x0). */
export function transportSupports(beamY: number, x0: number, xs: number[], walls: number[]): THREE.Group {
  const g = new THREE.Group();
  for (const x of xs) {
    const collar = cylX(0.13, 0.3, cm.lead(), 24);
    collar.position.x = x - x0;
    const p = pedestal(beamY, -0.13, 0.16, 0.24, cm.darkSteel());
    p.position.x = x - x0;
    const foot = box(0.36, 0.03, 0.36, cm.steel(), 0.004);
    foot.position.set(x - x0, -beamY + 0.015, 0);
    g.add(collar, p, foot);
  }
  for (const x of walls) {
    const sleeve = box(0.32, 0.34, 0.34, cm.lead(), 0.01);
    sleeve.position.x = x - x0;
    g.add(sleeve);
  }
  return shadowed(g);
}

/**
 * The face of the concrete ratchet (shield) wall where the front end leaves the tunnel, with the wall-collimator
 * penetration. Asymmetric about the beam: it reaches `zIn` inboard (stopping short of the storage-ring magnets, which at
 * ~22 m run only ~1.4 m inboard of the X-ray beam) and `zOut` outboard, where it meets the tunnel's outer wall drawn by
 * the site (1.35 m outboard of the beam, 0.9 m thick). Height = the site's tunnel walls (3.4 m).
 */
export function ratchetWall(beamY: number, thick = 1.5, zIn = -0.85, zOut = 1.8, height = 3.4): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9d9a93, roughness: 0.97 });
  const hole = 0.24;
  const width = zOut - zIn;
  const zc = (zOut + zIn) / 2;
  const below = beamY - hole / 2;
  const above = height - beamY - hole / 2;
  const a = box(thick, below, width, mat, 0.01);
  a.position.set(0, -beamY + below / 2, zc);
  const b = box(thick, above, width, mat, 0.01);
  b.position.set(0, hole / 2 + above / 2, zc);
  for (const [z0, z1] of [[zIn, -hole / 2], [hole / 2, zOut]] as const) {
    const c = box(thick, hole, z1 - z0, mat, 0);
    c.position.z = (z0 + z1) / 2;
    g.add(c);
  }
  const coll = cylX(0.11, thick, cm.tungsten(), 20);
  g.add(a, b, coll, pipeX(-thick / 2 - 0.3, thick / 2 + 0.3, 0.035));
  return shadowed(g);
}

/**
 * APS-U high-heat-load front end in the tunnel, drawn as a train in the documented ORDER (FDR Ch. 3, Sec. 3-2.1):
 * permanent-magnet clearing magnet → LPPS → storage-ring valve → burn-through fixed mask BTFM1 → fixed mask FM2 →
 * collimator → GRID XBPM1 → FM3 → photon shutter PS2 with intensity monitor → safety shutters SS1/SS2 (→ wall
 * collimator in the ratchet wall, → exit mask/collimator in 9-ID-A). Element positions for 9-ID are not published:
 * spacing is illustrative, with XBPM1 on the component anchor (19.4 m). Pumps sit on top of the vacuum system (FDR).
 * Everything stays within ±0.2 m of the beam so it clears the storage-ring magnets beside it (~0.4 m away at 16 m).
 * Local origin = anchor `x0`.
 */
export function frontEndTrain(beamY: number, x0: number): THREE.Group {
  const g = new THREE.Group();
  const X = (x: number) => x - x0;
  const start = 15.8;
  const end = 21.85;
  // low support stands and the vacuum pipe
  for (const [a, b] of [[15.9, 17.62], [17.72, 19.82], [19.92, 21.8]] as const) {
    const top = box(b - a, 0.05, 0.36, cm.steel(), 0.006);
    top.position.set(X((a + b) / 2), -0.36, 0);
    g.add(top);
    for (const x of [a + 0.12, b - 0.12]) {
      const leg = box(0.08, beamY - 0.385, 0.08, cm.darkSteel(), 0.004);
      leg.position.set(X(x), -beamY + (beamY - 0.385) / 2, 0);
      g.add(leg);
    }
  }
  g.add(pipeX(X(start), X(end), 0.028));
  const block = (x: number, len: number, w: number, h: number, m: THREE.Material, y = 0) => {
    const b = box(len, h, w, m, 0.008);
    b.position.set(X(x), y, 0);
    const post = box(Math.min(len, 0.12), Math.max(0.02, -0.335 - (y - h / 2)), 0.12, cm.darkSteel(), 0.003);
    post.position.set(X(x), (-0.335 + (y - h / 2)) / 2, 0);
    g.add(b, post);
    return b;
  };
  // clearing magnet: permanent-magnet C-yoke around the pipe
  const yoke = block(16.05, 0.28, 0.3, 0.3, cm.frameBlue());
  void yoke;
  for (const s of [-1, 1]) {
    const pole = box(0.24, 0.05, 0.12, s > 0 ? cm.magnetRed() : cm.magnetBlue(), 0.004);
    pole.position.set(X(16.05), s * 0.045, 0.16);
    g.add(pole);
  }
  // LPPS and storage-ring valve
  block(16.5, 0.22, 0.26, 0.28, cm.tungsten());
  block(16.95, 0.1, 0.24, 0.34, cm.steel(), 0.04);
  const act = cyl(0.04, 0.16, cm.black(), 12);
  act.position.set(X(16.95), 0.3, 0);
  g.add(act);
  // fixed masks (water-cooled copper) and collimator
  for (const [x, len] of [[17.4, 0.32], [18.05, 0.4], [20.05, 0.3]] as const) {
    block(x, len, 0.26, 0.26, cm.copper());
    g.add(hose([v3(X(x) - len * 0.25, 0.13, 0.05), v3(X(x) - len * 0.25, 0.26, 0.05), v3(X(x) - len * 0.25, 0.34, 0.18)], 0.01, cm.waterHose()));
  }
  block(18.65, 0.3, 0.3, 0.3, cm.lead());
  // GRID XBPM1 (on the anchor): small cross with blade feedthroughs
  block(19.4, 0.18, 0.18, 0.18, cm.steel());
  for (const s of [-1, 1]) {
    const f = cylZ(0.035, 0.08, cm.steel(), 14);
    f.position.set(0, 0, s * 0.12);
    g.add(f);
  }
  // photon shutter PS2 + intensity monitor, then the two safety shutters with pneumatic cylinders
  block(20.6, 0.3, 0.26, 0.3, cm.shutterYellow());
  for (const x of [21.2, 21.6]) {
    block(x, 0.28, 0.3, 0.36, cm.darkSteel(), 0.03);
    const c = cyl(0.045, 0.22, cm.black(), 12);
    c.position.set(X(x), 0.32, 0);
    g.add(c);
  }
  // ion pumps on top of the vacuum system
  for (const x of [16.75, 17.75, 18.95, 19.75, 20.35]) {
    const p = box(0.12, 0.16, 0.16, cm.white(), 0.01);
    p.position.set(X(x), 0.12, 0);
    const neck = cyl(0.02, 0.1, cm.steel(), 10);
    neck.position.set(X(x), 0.03, 0);
    g.add(p, neck);
  }
  return shadowed(g);
}
