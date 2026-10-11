import * as THREE from 'three';
import { M, box, cyl, flangeX, hose, pipeX, post, rod, shadowed, v3, vesselBox, vesselCyl, vesselSphere } from './kit';

/**
 * CHEX end-station models (part frame: origin at the sample / interaction point on the beam, +X downstream along the
 * branch, +Y up, +Z to the branch's outboard side). The engine yaws each part onto its branch with rotY.
 */

// ------------------------------------------------------------------ shared hexapod diffractometer (FDR Fig. 4.7)

export type TopKind = 'pass' | 'cell' | 'furnace' | 'riser';

/**
 * Shared CHEX diffractometer after the FDR Fig. 4.7 concept (built as Huber hexapod diffractometers in B, D, F and G):
 * black base, large teal rotation stage, hexapod (6 legs) carrying the sample or a reaction chamber, and a vertical
 * detector tower with a horizontal carriage on one side. `towerSide` = ±1 (branch outboard / inboard).
 * 'pass' = beam-pass mode: everything is lowered so a beam pipe runs through to the rear position.
 */
export function hexapodDiffractometer(beamY: number, o: { towerSide: 1 | -1; top: TopKind; towerYaw?: number }): THREE.Group {
  const g = new THREE.Group();
  const y0 = -beamY;
  const ts = o.towerSide;
  // base slab and levelling feet
  const base = box(1.25, 0.2, 1.05, M.blackAnod(), 0.02);
  base.position.y = y0 + 0.14;
  g.add(base);
  for (const [fx, fz] of [[-0.55, -0.45], [0.55, -0.45], [-0.55, 0.45], [0.55, 0.45]]) {
    const f = cyl(0.04, 0.04, M.steel(), 12);
    f.position.set(fx, y0 + 0.02, fz);
    g.add(f);
  }
  // rotation stage (teal) with the tower arm
  const rot = cyl(0.5, 0.16, M.teal(), 48);
  rot.position.y = y0 + 0.32;
  const arm = box(0.55, 0.16, 0.5, M.teal(), 0.02);
  arm.position.set(-0.1, y0 + 0.32, ts * 0.55);
  // the tower rides on the rotation stage (FDR Fig. 4.7), so it can be parked at any azimuth: towerYaw turns the arm,
  // tower, carriage and parked PAD about the vertical axis through the sample (+ = from the outboard side toward +X)
  const towerGroup = new THREE.Group();
  towerGroup.rotation.y = o.towerYaw ?? 0;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.012, 6, 48), M.tealDark());
  ring.rotation.x = Math.PI / 2;
  ring.position.y = y0 + 0.4;
  towerGroup.add(arm);
  g.add(rot, ring);
  const riser = cyl(0.3, 0.12, M.tealDark(), 36);
  riser.position.y = y0 + 0.46;
  g.add(riser);
  // hexapod: gold lower ring, 6 struts, triangular top plate
  const lowY = y0 + 0.55;
  const topY = o.top === 'pass' ? -0.42 : -0.36;
  const low = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 10, 48), M.gold());
  low.rotation.x = Math.PI / 2;
  low.position.y = lowY;
  g.add(low);
  const top = cyl(0.27, 0.05, M.teal(), 3);
  top.position.y = topY;
  top.rotation.y = Math.PI / 6;
  g.add(top);
  for (let k = 0; k < 3; k++) {
    for (const s of [-1, 1]) {
      const aLow = ((k * 120 + s * 18) * Math.PI) / 180;
      const aTop = ((k * 120 + 60 - s * 42) * Math.PI) / 180;
      const a = v3(0.36 * Math.cos(aLow), lowY + 0.03, 0.36 * Math.sin(aLow));
      const b = v3(0.2 * Math.cos(aTop), topY - 0.03, 0.2 * Math.sin(aTop));
      const mid = a.clone().lerp(b, 0.45);
      g.add(rod(a, mid, 0.03, M.teal(), 12), rod(mid, b, 0.018, M.steel(), 10));
    }
  }
  // sample on top
  if (o.top === 'cell') g.add(userCell(topY));
  if (o.top === 'furnace') g.add(furnace(topY));
  // detector tower (green) with horizontal carriage and a small PAD in its parked position
  const tower = box(0.3, 2.35, 0.26, M.green(), 0.02);
  tower.position.set(-0.18, y0 + 0.4 + 1.175, ts * 0.72);
  const rail = box(0.06, 2.1, 0.03, M.steel(), 0.004);
  rail.position.set(-0.18, y0 + 0.4 + 1.15, ts * 0.72 - ts * 0.145);
  const carriage = box(0.62, 0.14, 0.08, M.alu(), 0.01);
  carriage.position.set(-0.05, 0.42, ts * 0.55);
  const pad = box(0.12, 0.12, 0.14, M.detector(), 0.01);
  pad.position.set(0.12, 0.42, ts * 0.44);
  const motor = box(0.1, 0.12, 0.1, M.yellow(), 0.01);
  motor.position.set(-0.18, y0 + 2.55, ts * 0.72);
  towerGroup.add(tower, rail, carriage, pad, motor);
  g.add(towerGroup);
  return shadowed(g);
}

/** Generic user reaction cell (gas/heating cell with X-ray windows) on a short post. */
function userCell(topY: number): THREE.Group {
  const g = new THREE.Group();
  const p = cyl(0.03, -topY - 0.05, M.steel(), 12);
  p.position.y = topY / 2 - 0.02;
  const body = box(0.11, 0.08, 0.11, M.ss(), 0.01);
  body.position.y = -0.005;
  const win = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 8, 24), M.bewindow());
  win.rotation.y = Math.PI / 2;
  win.position.set(-0.057, 0, 0);
  const win2 = win.clone();
  win2.position.x = 0.057;
  g.add(p, body, win, win2);
  g.add(hose([v3(0, 0.035, 0.05), v3(0, 0.12, 0.12), v3(-0.1, 0.25, 0.3), v3(-0.3, 0.3, 0.5)], 0.006, M.steel()));
  return g;
}

/** Compact cylindrical furnace with an X-ray slot (as on G/1). */
export function furnace(topY: number): THREE.Group {
  const g = new THREE.Group();
  const p = cyl(0.04, -topY - 0.1, M.steel(), 12);
  p.position.y = topY / 2 - 0.05;
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 36, 1, true, 0.35, Math.PI * 2 - 0.7), M.ss());
  shell.material = M.ss();
  const cap = cyl(0.105, 0.025, M.steel(), 36);
  cap.position.y = 0.1;
  const bot = cyl(0.105, 0.025, M.steel(), 36);
  bot.position.y = -0.1;
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.12, 24, 1, true), M.hotDim());
  coil.material.side = THREE.DoubleSide;
  const sample = cyl(0.008, 0.06, M.hot(), 12);
  // window slots facing the beam in/out (the open sector of the shell faces downstream; add an upstream slot frame)
  const slot = box(0.01, 0.03, 0.06, M.bewindow(), 0.002);
  slot.position.set(-0.1, 0, 0);
  g.add(p, shell, cap, bot, coil, sample, slot);
  g.add(hose([v3(0, 0.11, 0.05), v3(0.02, 0.3, 0.1), v3(-0.1, 0.45, 0.35)], 0.008, M.copper()));
  shell.rotation.y = Math.PI / 2 + 0.35; // opening toward +X (downstream: diffracted cone exits)
  return g;
}

// ------------------------------------------------------------------ detectors

/**
 * Photon-counting pixel-array detector (55 µm-class) on a long-distance detector positioner (LDDP: granite base on air
 * pads, column, yaw/tilt head; FDR Fig. 4.8). Origin = detector face centre; `tiltRad` turns the face toward a sample
 * that lies `dist` metres upstream along the (tilted) axis; `tube` adds the evacuated flight path back to the sample.
 */
export function ldDetector(beamY: number, o: { dist: number; tiltRad: number; tube: boolean; face?: number }): THREE.Group {
  const g = new THREE.Group();
  const s = o.face ?? 0.08;
  const head = new THREE.Group();
  head.rotation.z = o.tiltRad; // +tilt: detector above the beam looks down-back to the sample
  const housing = box(0.24, s + 0.07, s + 0.07, M.detector(), 0.012);
  housing.position.x = 0.13;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(s, s), detFace());
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.003;
  const fins = box(0.16, (s + 0.07) * 0.7, 0.015, M.darkSteel(), 0.003);
  fins.position.set(0.22, 0, (s + 0.07) / 2 + 0.01);
  head.add(housing, face, fins);
  if (o.tube) {
    const L = o.dist - 0.4;
    const t = pipeX(-0.04 - L, -0.04, 0.06, M.alu(), 24);
    head.add(t, flangeX(-0.04, 0.08), flangeX(-0.04 - L, 0.08));
    const n = Math.max(1, Math.floor(L / 1.2));
    for (let i = 1; i < n; i++) head.add(flangeX(-0.04 - (i / n) * L, 0.072, M.steel()));
  }
  g.add(head);
  // positioner column and granite base (stays vertical)
  const y0 = -beamY;
  const colTop = -0.08 - (s + 0.07) / 2;
  const colH = colTop - (y0 + 0.36);
  const col = box(0.16, Math.max(0.1, colH), 0.16, M.alu(), 0.01);
  col.position.set(0.13, y0 + 0.36 + colH / 2, 0);
  const yawHead = box(0.26, 0.06, 0.24, M.blackAnod(), 0.008);
  yawHead.position.set(0.13, colTop, 0);
  const granite = box(0.9, 0.3, 0.7, M.granite(), 0.02);
  granite.position.set(0.13, y0 + 0.21, 0);
  const pads = box(0.8, 0.06, 0.6, M.blackAnod(), 0.01);
  pads.position.set(0.13, y0 + 0.03, 0);
  g.add(col, yawHead, granite, pads);
  // flight-tube supports to the floor
  if (o.tube) {
    for (const f of [0.35, 0.75]) {
      const d = 0.04 + f * (o.dist - 0.4);
      const px = -d * Math.cos(o.tiltRad);
      const py = -d * Math.sin(o.tiltRad);
      const leg = box(0.05, py - 0.06 - y0, 0.05, M.steel(), 0.004);
      leg.position.set(px, (py - 0.06 + y0) / 2, 0);
      const foot = box(0.25, 0.03, 0.25, M.darkSteel(), 0.004);
      foot.position.set(px, y0 + 0.015, 0);
      g.add(leg, foot);
    }
  }
  return shadowed(g);
}

/** Large flat-panel area detector for high-energy diffraction (G), with a direct-beam stop in front of the centre. */
export function hePanel(beamY: number, o: { size: number; stop: boolean }): THREE.Group {
  const g = new THREE.Group();
  const s = o.size;
  const housing = box(0.12, s + 0.1, s + 0.1, M.detector(), 0.015);
  housing.position.x = 0.065;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(s, s), detFace('#facc15'));
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.002;
  const back = box(0.1, s * 0.6, s * 0.6, M.blackAnod(), 0.01);
  back.position.x = 0.17;
  g.add(housing, face, back);
  if (o.stop) {
    const bs = cyl(0.006, 0.012, M.tungsten(), 16);
    bs.rotation.z = Math.PI / 2;
    bs.position.x = -0.12;
    const arm = rod(v3(-0.12, 0, 0), v3(-0.12, s / 2 + 0.03, 0), 0.0015, M.steel(), 6);
    g.add(bs, arm);
  }
  // heavy stand: two columns + cross plate on a granite block
  const y0 = -beamY;
  const top = -(s + 0.1) / 2;
  for (const z of [-0.18, 0.18]) {
    const c = box(0.1, top - (y0 + 0.3), 0.08, M.alu(), 0.008);
    c.position.set(0.1, (top + y0 + 0.3) / 2, z);
    g.add(c);
  }
  const gr = box(0.6, 0.3, 0.7, M.granite(), 0.02);
  gr.position.set(0.1, y0 + 0.15, 0);
  g.add(gr);
  return shadowed(g);
}

let faceTex: Map<string, THREE.CanvasTexture> | null = null;
function detFace(color = '#facc15'): THREE.MeshStandardMaterial {
  faceTex ??= new Map();
  let tex = faceTex.get(color);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d')!;
    x.fillStyle = '#05080d';
    x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(120,150,190,0.35)';
    for (let i = 0; i <= 4; i++) {
      x.beginPath();
      x.moveTo(0, i * 64);
      x.lineTo(256, i * 64);
      x.moveTo(i * 64, 0);
      x.lineTo(i * 64, 256);
      x.stroke();
    }
    // speckle: random grains, brighter toward one corner (the CTR / diffuse streak)
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 1600; i++) {
      const px = rnd() * 256;
      const py = rnd() * 256;
      const w = Math.exp(-((px - 128) ** 2 + (py - 128) ** 2) / 9000);
      x.fillStyle = color + Math.floor(30 + 200 * w * rnd()).toString(16).padStart(2, '0');
      x.fillRect(px, py, 3, 3);
    }
    for (const r of [40, 70, 98]) {
      x.strokeStyle = color + '40';
      x.lineWidth = 2;
      x.beginPath();
      x.arc(128, 128, r, 0, Math.PI * 2);
      x.stroke();
    }
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    faceTex.set(color, tex);
  }
  return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.5 });
}

// ------------------------------------------------------------------ in situ growth chambers

/**
 * MOCVD growth chamber (28-ID-F), after the 12-ID-D predecessor (Ju et al., RSI 2017): a fused-quartz wall (70 mm ID,
 * 2 mm wall) around a heated molybdenum susceptor, gas inlet from above, stainless lower body and exhaust, all carried
 * on the hexapod diffractometer. The X-rays pass straight through the quartz wall and graze the growing film.
 */
export function mocvdChamber(beamY: number): THREE.Group {
  const g = hexapodDiffractometer(beamY, { towerSide: 1, top: 'riser' });
  const c = new THREE.Group();
  // stainless lower body on a riser from the hexapod top plate
  const riser = cyl(0.05, 0.12, M.steel(), 16);
  riser.position.y = -0.31;
  const body = cyl(0.085, 0.2, M.ss(), 32);
  body.position.y = -0.16;
  const fl1 = cyl(0.1, 0.02, M.steel(), 32);
  fl1.position.y = -0.055;
  c.add(riser, body, fl1);
  // quartz wall around the sample
  const q = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.17, 40, 1, true), M.quartz());
  q.position.y = 0.04;
  const q2 = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.039, 0.17, 40, 1, true), M.quartz());
  q2.position.y = 0.04;
  c.add(q, q2);
  // susceptor (glowing) + wafer
  const sus = cyl(0.027, 0.008, M.hot(), 32);
  sus.position.y = -0.005;
  const heater = cyl(0.03, 0.025, M.hotDim(), 24);
  heater.position.y = -0.025;
  const wafer = cyl(0.012, 0.0015, M.silicon(), 24);
  wafer.position.y = 0.0005;
  c.add(sus, heater, wafer);
  // top flange + showerhead and gas lines (NH3, TEGa, carrier)
  const top = cyl(0.07, 0.03, M.steel(), 32);
  top.position.y = 0.14;
  const head = cyl(0.03, 0.06, M.ss(), 16);
  head.position.y = 0.18;
  c.add(top, head);
  const lineCols = [M.ss(), M.steel(), M.ss()];
  [-0.015, 0, 0.015].forEach((dz, i) => {
    c.add(hose([v3(0, 0.2, dz), v3(0, 0.45, dz), v3(-0.15, 0.7, 0.2 + dz), v3(-0.6, 0.85, 0.7 + dz), v3(-1.0, 0.85, 1.05 + dz)], 0.007, lineCols[i]));
  });
  // exhaust line downward
  c.add(hose([v3(0.06, -0.2, 0), v3(0.2, -0.3, -0.1), v3(0.35, -0.6, -0.4), v3(0.4, -1.0, -0.6)], 0.018, M.steel()));
  g.add(c);
  return shadowed(g);
}

/** Gas cabinet + manifold that feeds the MOCVD reactor (placed in the hutch, lines run overhead). */
export function gasCabinet(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const y0 = -beamY;
  const cab = box(0.9, 2.0, 0.55, M.cabinet(), 0.02);
  cab.position.y = y0 + 1.0;
  const win = box(0.5, 0.6, 0.01, M.bewindow(), 0.004);
  win.position.set(0, y0 + 1.35, 0.28);
  const duct = cyl(0.08, 0.6, M.steel(), 16);
  duct.position.y = y0 + 2.3;
  const stripe = box(0.92, 0.08, 0.56, M.yellow(), 0.004);
  stripe.position.y = y0 + 1.85;
  g.add(cab, win, duct, stripe);
  return shadowed(g);
}

/**
 * Pulsed-laser-deposition chamber with HAXPES (28-ID-E), after Eres et al., RSI 2019 (PLD chamber on a diffractometer,
 * real-time surface diffraction, hemispherical electron analyser). Sample face-up on a heater; target above it at an
 * angle; the UV laser enters through a viewport and the plume (violet) streams onto the film. The analyser lens column
 * leaves the chamber horizontally on the outboard side and feeds the hemisphere. Analyser drawn as a generic
 * hemispherical analyser (the published system used a Scienta EW4000).
 */
export function pldHaxpes(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const y0 = -beamY;
  // diffractometer base + rotation stage
  const base = box(1.1, 0.3, 1.0, M.blackAnod(), 0.02);
  base.position.y = y0 + 0.15;
  const rot = cyl(0.42, 0.14, M.teal(), 40);
  rot.position.y = y0 + 0.37;
  const ped = cyl(0.12, -0.3 - (y0 + 0.44), M.tealDark(), 24);
  ped.position.y = (y0 + 0.44 - 0.3) / 2;
  g.add(base, rot, ped);
  // UHV chamber: cut-away sphere
  const ch = vesselSphere(0.27);
  ch.position.y = 0.03;
  g.add(ch);
  const bottom = cyl(0.14, 0.05, M.steel(), 32);
  bottom.position.y = -0.27;
  g.add(bottom);
  // X-ray entrance / exit ports along the beam, wide exit window for the scattered beam
  g.add(pipeX(-0.42, -0.25, 0.035, M.ss()), flangeX(-0.42, 0.06), pipeX(0.25, 0.36, 0.06, M.ss()), flangeX(0.36, 0.09));
  // sample heater (glowing) face-up at the beam
  const heater = cyl(0.03, 0.02, M.hotDim(), 24);
  heater.position.y = -0.012;
  const film = cyl(0.01, 0.002, M.silicon(), 20);
  film.position.y = 0.0;
  const stalk = cyl(0.012, 0.25, M.steel(), 12);
  stalk.position.y = -0.14;
  g.add(heater, film, stalk);
  // target carousel above, tilted toward the sample
  const tgt = new THREE.Group();
  tgt.position.set(0.0, 0.15, -0.08);
  tgt.rotation.x = -0.5;
  const disk = cyl(0.035, 0.012, M.darkSteel(), 24);
  const holder = cyl(0.01, 0.2, M.steel(), 10);
  holder.position.y = 0.1;
  tgt.add(disk, holder);
  g.add(tgt);
  // plume from target to film
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.15, 24, 1, true), M.plume());
  const pa = v3(0, 0.145, -0.075);
  const pb = v3(0, 0.005, 0);
  plume.position.copy(pa).lerp(pb, 0.5);
  plume.quaternion.setFromUnitVectors(v3(0, 1, 0), pa.clone().sub(pb).normalize());
  g.add(plume);
  // UV laser: from the excimer laser head (PLD_LASER_HEAD, part frame) up a periscope, across to a turning mirror by the
  // viewport and down onto the target
  const vp = flangeX(0, 0.035, M.steel());
  vp.position.set(-0.17, 0.2, -0.14);
  vp.rotation.set(0, 0.6, Math.PI / 2 - 0.5);
  g.add(vp);
  const H = PLD_LASER_HEAD;
  const P1 = v3(H.x, 0.55, H.z);
  const P2 = v3(-0.6, 0.55, -0.5);
  const T = v3(0.0, 0.15, -0.08);
  g.add(rod(H, P1, 0.003, M.uv(), 6), rod(P1, P2, 0.003, M.uv(), 6), rod(P2, T, 0.003, M.uv(), 6));
  for (const p of [H, P1, P2]) {
    const m = box(0.06, 0.06, 0.06, M.alu(), 0.004);
    m.position.copy(p);
    g.add(m);
  }
  const periscope = box(0.04, 0.55 - 0.03 - (H.y + 0.03), 0.04, M.steel(), 0.003);
  periscope.position.set(H.x + 0.05, (0.52 + H.y + 0.03) / 2, H.z);
  const turnPost = box(0.03, 0.55 - y0 - 0.03, 0.03, M.steel(), 0.003);
  turnPost.position.set(-0.6, (0.52 + y0) / 2, -0.5);
  g.add(periscope, turnPost);
  // HAXPES analyser: lens column + hemisphere + detector box, on its own stand
  const lensLen = 0.5;
  const lens = cyl(0.065, lensLen, M.ss(), 24);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0.03, 0.27 + lensLen / 2);
  g.add(lens, flangeX(0, 0.09));
  g.children[g.children.length - 1].position.set(0, 0.03, 0.29);
  g.children[g.children.length - 1].rotation.set(Math.PI / 2, 0, 0);
  const hemi = new THREE.Group();
  hemi.position.set(0, 0.03 + 0.2, 0.27 + lensLen + 0.02);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), M.ss());
  dome.rotation.x = Math.PI / 2; // dome bulges away from the chamber (+z)
  const plate = cyl(0.31, 0.04, M.steel(), 40);
  plate.rotation.x = Math.PI / 2;
  hemi.add(dome, plate);
  const detBox = box(0.16, 0.14, 0.18, M.detector(), 0.01);
  detBox.position.set(0, 0.2, -0.1);
  hemi.add(detBox);
  g.add(hemi);
  const hs = box(0.4, 0.23 - y0 - 0.32, 0.3, M.alu(), 0.01);
  hs.position.set(0, (y0 + 0.23 - 0.32) / 2, 0.27 + lensLen + 0.12);
  g.add(hs);
  // turbo pump hanging off the chamber
  const turbo = cyl(0.07, 0.18, M.steel(), 20);
  turbo.position.set(0.12, -0.2, -0.22);
  g.add(turbo);
  return shadowed(g);
}

/**
 * Output aperture of the excimer laser in the PLD part frame (origin = sample): the laser sits upstream and inboard of
 * the chamber; place excimerLaser() at PLD_LASER_ORIGIN (same frame) so its head lines up with the UV path.
 */
export const PLD_LASER_HEAD = v3(-1.25, -0.4, -1.0);
export const PLD_LASER_ORIGIN = v3(PLD_LASER_HEAD.x - 0.76, 0, PLD_LASER_HEAD.z);

/** The excimer laser that drives the PLD (on a floor table; output head at +0.7 m, 1.0 m above the floor). */
export function excimerLaser(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const y0 = -beamY;
  const table = box(1.6, 0.8, 0.8, M.cabinet(), 0.02);
  table.position.y = y0 + 0.4;
  const laser = box(1.35, 0.35, 0.42, M.blue(), 0.03);
  laser.position.y = y0 + 0.98;
  const head = box(0.12, 0.12, 0.12, M.darkSteel(), 0.01);
  head.position.set(0.7, y0 + 1.0, 0);
  g.add(table, laser, head);
  return shadowed(g);
}

/**
 * Oxide molecular-beam-epitaxy chamber (28-ID-C): a UHV drum with effusion cells aimed up at a face-down substrate,
 * cryo-shroud LN2 lines, oxidant (ozone) inlet and X-ray windows, on a heavy frame. The beam grazes the substrate at
 * the sample position (origin).
 */
export function mbeChamber(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const y0 = -beamY;
  const R = 0.32;
  const drum = vesselCyl(R, 0.8);
  drum.position.y = -0.2;
  g.add(drum);
  const topFl = cyl(R + 0.03, 0.05, M.steel(), 48);
  topFl.position.y = 0.22;
  g.add(topFl);
  // dished bottom with the cell flange ring
  const dish = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 3), M.vessel());
  dish.position.y = -0.6;
  g.add(dish);
  // effusion cells aimed at the substrate (origin), 6 around, 28° from vertical
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const tilt = 0.5;
    const dir = v3(Math.sin(tilt) * Math.cos(a), -Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
    const p0 = dir.clone().multiplyScalar(0.52);
    const p1 = dir.clone().multiplyScalar(0.95);
    g.add(rod(p0, p1, 0.04, k % 2 ? M.ss() : M.steel(), 16));
    const mouth = rod(p0, p0.clone().addScaledVector(dir, -0.02), 0.03, M.hotDim(), 12);
    g.add(mouth);
    const fl = rod(p1.clone().addScaledVector(dir, -0.05), p1.clone().addScaledVector(dir, -0.03), 0.055, M.steel(), 16);
    g.add(fl);
  }
  // substrate manipulator from the top: face-down heater just above the beam
  const manip = cyl(0.05, 0.45, M.ss(), 20);
  manip.position.y = 0.45;
  const bellows = cyl(0.07, 0.12, M.steel(), 20);
  bellows.position.y = 0.3;
  const holder = cyl(0.035, 0.02, M.hotDim(), 24);
  holder.position.y = 0.012;
  const stalk = cyl(0.008, 0.2, M.steel(), 8);
  stalk.position.y = 0.12;
  g.add(manip, bellows, holder, stalk);
  // X-ray windows: entrance flange and a wide beryllium exit window band
  g.add(pipeX(-0.5, -R, 0.035, M.ss()), flangeX(-0.5, 0.06));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.004, R + 0.004, 0.08, 40, 1, true, Math.PI / 2 - 0.5, 1.0), M.bewindow());
  band.material.side = THREE.DoubleSide;
  band.position.y = -0.02;
  g.add(band);
  // ozone inlet + LN2 shroud lines
  g.add(hose([v3(-0.2, 0.0, -0.25), v3(-0.4, 0.2, -0.45), v3(-0.6, 0.6, -0.6), v3(-0.8, 0.9, -0.7)], 0.01, M.steel()));
  g.add(hose([v3(0.15, 0.22, -0.2), v3(0.25, 0.6, -0.3), v3(0.4, 1.0, -0.5), v3(0.6, 1.2, -0.9)], 0.025, M.ln2()));
  // ion pump
  const pump = box(0.25, 0.3, 0.18, M.steel(), 0.02);
  pump.position.set(0.15, -0.35, -0.48);
  g.add(pump, rod(v3(0.1, -0.3, -0.3), v3(0.12, -0.32, -0.4), 0.05, M.steel()));
  // support frame (4 legs + ring) down to the floor
  const ringY = -0.55;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.06, 0.025, 8, 48), M.blackAnod());
  ring.rotation.x = Math.PI / 2;
  ring.position.y = ringY;
  g.add(ring);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const x = (R + 0.06) * Math.cos(a);
    const z = (R + 0.06) * Math.sin(a);
    const leg = box(0.06, ringY - y0, 0.06, M.blackAnod(), 0.005);
    leg.position.set(x, (ringY + y0) / 2, z);
    g.add(leg);
  }
  const plinth = box(1.1, 0.12, 1.1, M.granite(), 0.02);
  plinth.position.y = y0 + 0.06;
  g.add(plinth);
  return shadowed(g);
}

/** The open rear position G/2 has a heavy table and sample stage for large partner instruments. */
export function openPosition(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const y0 = -beamY;
  const table = box(1.3, -0.35 - y0, 0.9, M.granite(), 0.02);
  table.position.y = (y0 - 0.35) / 2;
  const xy = box(0.3, 0.08, 0.3, M.blackAnod(), 0.008);
  xy.position.y = -0.31;
  const z = box(0.18, 0.18, 0.18, M.alu(), 0.008);
  z.position.y = -0.18;
  const pin = cyl(0.006, 0.08, M.steel(), 10);
  pin.position.y = -0.05;
  g.add(table, xy, z, pin);
  return shadowed(g);
}

/** Model the B/C transfocators as lens cartridges on pneumatic actuators inside an ultra-high-vacuum vessel. */
export function transfocator(beamY: number, n: number): THREE.Group {
  const g = new THREE.Group();
  const L = 0.12 + n * 0.045;
  const v = vesselBox(L, 0.22, 0.2);
  g.add(v);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + 0.06 + i * 0.045;
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10), M.quartz());
    lens.scale.set(0.35, 1, 1);
    lens.position.x = x;
    const act = cyl(0.01, 0.16, M.darkSteel(), 8);
    act.position.set(x, 0.19, 0);
    g.add(lens, act);
  }
  const lid = box(L + 0.02, 0.025, 0.22, M.steel(), 0.004);
  lid.position.y = 0.12;
  g.add(lid, pipeX(-L / 2 - 0.15, -L / 2, 0.025), pipeX(L / 2, L / 2 + 0.15, 0.025));
  g.add(post(beamY, -0.11, L * 0.7, 0.24, M.granite()));
  return shadowed(g);
}

/** Moveable flight-tube "nose" used when nothing else is defined (kept small). */
export function nose(len: number): THREE.Mesh {
  return pipeX(0, len, 0.04, M.alu());
}

export { vesselBox };
