import * as THREE from 'three';
import { glowMaterial } from '../../scene/palette';
import { box, cm, cyl, cylX, cylZ, flangeX, pipeX, shadowed, strut, v3, vesselCylY } from './kit';
import { ALPHA, CHAMBER, GIXS_GRANITE, KB_GRANITE } from './geom';

/**
 * CSSI solid-sample station 9ID-BI-2: round multi-port high-vacuum chamber (as-built isometric) on the KB granite.
 * Inside, the 5-DOF flexure stack holds the chip ON EDGE: its surface is vertical, so the X-rays graze it and reflect
 * sideways (horizontal scattering plane). The surface is turned by the true incidence angle α = 0.5° about the
 * vertical axis (pitch), with the in-plane (yaw) rotary stage behind the chip and capacitive/interferometric
 * metrology heads around it. The chip faces inboard in this model, so the reflection goes to −z (side undocumented).
 */
export function cssiChamber(graniteTop: number): THREE.Group {
  const g = new THREE.Group();
  const { r, h } = CHAMBER;
  g.add(vesselCylY(r, h));
  // lid drawn as a steel rim with a see-through centre (museum cut-away) so the stack stays visible from above
  const lid = new THREE.Mesh(new THREE.TorusGeometry(r + 0.005, 0.025, 8, 48), cm.steel());
  lid.rotation.x = Math.PI / 2;
  lid.position.y = h / 2 + 0.02;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(r, 48), cm.vessel());
  glass.rotation.x = -Math.PI / 2;
  glass.position.y = h / 2 + 0.03;
  glass.renderOrder = 3;
  g.add(glass);
  const floor = cyl(r + 0.03, 0.05, cm.steel(), 48);
  floor.position.y = -h / 2 - 0.025;
  g.add(lid, floor);
  // radial ports with blank flanges (many-port drum, as in the isometric), skipping the beam ports and the
  // camera-side quadrant so the inside stays visible
  const portMat = cm.steel();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    const dir = v3(Math.cos(a), 0, Math.sin(a));
    if (Math.abs(dir.z) < 0.3) continue; // beam in/out ports handled below
    if (dir.z < -0.5 && dir.x < 0.2) continue;
    for (const y of [-0.12, 0.12]) {
      const port = cyl(0.04, 0.09, portMat, 16);
      port.position.copy(dir.clone().multiplyScalar(r + 0.035)).setY(y);
      port.quaternion.setFromUnitVectors(v3(0, 1, 0), dir);
      const fl = cyl(0.055, 0.018, portMat, 18);
      fl.position.copy(dir.clone().multiplyScalar(r + 0.085)).setY(y);
      fl.quaternion.copy(port.quaternion);
      g.add(port, fl);
    }
  }
  // lid ports (feedthroughs)
  for (const [x, z, rr] of [[0, 0, 0.07], [0.18, 0.12, 0.045], [-0.17, 0.14, 0.045], [0.14, -0.16, 0.04]] as const) {
    const p = cyl(rr, 0.08, portMat, 18);
    p.position.set(x, h / 2 + 0.08, z);
    const f = cyl(rr + 0.015, 0.016, portMat, 18);
    f.position.set(x, h / 2 + 0.12, z);
    g.add(p, f);
  }
  // beam entrance / exit ports along x
  for (const s of [-1, 1]) {
    const port = cylX(0.05, 0.12, portMat, 18);
    port.position.x = s * (r + 0.05);
    g.add(port, flangeX(s * (r + 0.11), 0.075));
  }

  // ---- flexure stack: granite-like base plate → XYZ flexure stages → pitch (about Y) → yaw rotary (about the surface normal)
  const stackBase = box(0.36, 0.05, 0.3, cm.graniteTop(), 0.005);
  stackBase.position.y = -h / 2 + 0.03;
  const lin1 = box(0.26, 0.05, 0.24, cm.alu(), 0.005);
  lin1.position.y = -h / 2 + 0.08;
  const lin2 = box(0.2, 0.05, 0.2, cm.aluDark(), 0.005);
  lin2.position.y = -h / 2 + 0.13;
  const pitch = cyl(0.08, 0.04, cm.anodBlack(), 32);
  pitch.position.y = -h / 2 + 0.175;
  g.add(stackBase, lin1, lin2, pitch);
  // everything above the pitch stage turns by α about the vertical axis through the sample
  const tilt = new THREE.Group();
  // chip built facing +z, then turned to face inboard (−z) and pitched by α: surface direction ±(cos α, 0, −sin α),
  // front normal (−sin α, 0, −cos α) → the beam hits the inboard face and reflects to −z at 2α
  tilt.rotation.y = Math.PI + ALPHA;
  const column = box(0.05, h / 2 - 0.2, 0.05, cm.alu(), 0.004);
  column.position.set(0, (-h / 2 + 0.2) / 2 - 0.02, -0.06);
  const yaw = cylZ(0.045, 0.03, cm.anodBlack(), 28);
  yaw.position.set(0, 0, -0.037);
  const holder = box(0.07, 0.07, 0.008, cm.steel(), 0.002);
  holder.position.set(0, 0, -0.018);
  // the chip: silicon, ~30 × 20 mm, surface plane at z = 0 (true size)
  const chip = box(0.03, 0.02, 0.0012, cm.silicon(), 0);
  chip.position.z = -0.0006;
  const pattern = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.008), glowMaterial(0xffd479, 1.4));
  pattern.position.z = 0.0002;
  tilt.add(column, yaw, holder, chip, pattern);
  g.add(tilt);
  // metrology heads (capacitive / laser interferometer) aimed at the holder from behind and below
  for (const [x, y, z] of [[-0.06, 0.05, 0.12], [0.06, 0.05, 0.12], [0, -0.07, 0.12]] as const) {
    const head = cylZ(0.01, 0.05, cm.black(), 10);
    head.position.set(x, y, z);
    g.add(head);
  }
  const mframe = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.006, 6, 4), cm.aluDark());
  mframe.position.z = 0.12;
  mframe.rotation.z = Math.PI / 4;
  g.add(mframe);
  // chamber support legs (air-bearing granite stage) down to the KB granite
  const legH = -h / 2 - 0.05 - graniteTop;
  for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const leg = box(0.1, legH, 0.1, cm.alu(), 0.006);
    leg.position.set(Math.cos(a) * 0.22, graniteTop + legH / 2, Math.sin(a) * 0.22);
    g.add(leg);
  }
  return shadowed(g);
}

/** Granite blocks of 9-ID-D: KB/CSSI granite and the GIXS stationary + translating granites (context, not pickable). */
export function granites(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const add = (x0: number, x1: number, w: number, top: number, translating = false) => {
    const h = beamY + top;
    const gr = box(x1 - x0, h - 0.08, w, cm.granite(), 0.02);
    gr.position.set((x0 + x1) / 2, -beamY + 0.08 + (h - 0.08) / 2, 0);
    const skin = box(x1 - x0 - 0.02, 0.01, w - 0.02, cm.graniteTop(), 0.002);
    skin.position.set((x0 + x1) / 2, top - 0.005, 0);
    g.add(gr, skin);
    // levelling feet / air-bearing pads
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const f = cyl(0.05, 0.08, translating ? cm.alu() : cm.darkSteel(), 12);
        f.position.set((x0 + x1) / 2 + sx * ((x1 - x0) / 2 - 0.1), -beamY + 0.04, sz * (w / 2 - 0.1));
        g.add(f);
      }
    if (translating) {
      // floor rails of the translation
      for (const sz of [-1, 1]) {
        const rail = box(x1 - x0 + 0.3, 0.02, 0.05, cm.rail(), 0.003);
        rail.position.set((x0 + x1) / 2, -beamY + 0.01, sz * (w / 2 - 0.1));
        g.add(rail);
      }
    }
  };
  add(KB_GRANITE.x0, KB_GRANITE.x1, KB_GRANITE.w, KB_GRANITE.top);
  add(GIXS_GRANITE.stat.x0, GIXS_GRANITE.stat.x1, GIXS_GRANITE.stat.w, GIXS_GRANITE.stat.top);
  add(GIXS_GRANITE.trans.x0, GIXS_GRANITE.trans.x1, GIXS_GRANITE.trans.w, GIXS_GRANITE.trans.top, true);
  return shadowed(g);
}

/** Compact X-ray wavefront sensor (APS Optics design): small vacuum cross, scintillator/grating stage and camera. */
export function wavefrontSensor(graniteTop: number): THREE.Group {
  const g = new THREE.Group();
  const cross = box(0.14, 0.14, 0.14, cm.steel(), 0.01);
  const cam = cyl(0.035, 0.16, cm.black(), 16);
  cam.rotation.x = Math.PI / 2;
  cam.position.set(0, 0, -0.15);
  const act = cyl(0.02, 0.12, cm.darkSteel(), 10);
  act.position.y = 0.13;
  const post = box(0.08, -0.07 - graniteTop, 0.08, cm.alu(), 0.004);
  post.position.y = graniteTop + (-0.07 - graniteTop) / 2;
  g.add(cross, cam, act, post, pipeX(-0.2, 0.2, 0.025));
  return shadowed(g);
}

/**
 * Aerotech HEX500-350HL high-load hexapod on the GIXS stationary granite, carrying a sample cell at beam height.
 * Base ~0.5 m across; six struts between staggered base and platform joints.
 */
export function hexapod(graniteTop: number): THREE.Group {
  const g = new THREE.Group();
  const baseY = graniteTop + 0.05;
  const topY = graniteTop + 0.52;
  const base = cyl(0.25, 0.05, cm.anodBlack(), 40);
  base.position.y = graniteTop + 0.025;
  const plat = cyl(0.18, 0.04, cm.anodBlack(), 40);
  plat.position.y = topY + 0.02;
  g.add(base, plat);
  // six struts: base joints in pairs at 120°·k ± 15°, each leg running to the neighbouring platform joint pair (120°·k ± 45°)
  const deg = Math.PI / 180;
  for (let k = 0; k < 3; k++)
    for (const s of [-1, 1]) {
      const aB = (120 * k + s * 15) * deg;
      const aT = (120 * k + s * 45) * deg;
      const a = v3(Math.cos(aB) * 0.2, baseY, Math.sin(aB) * 0.2);
      const b = v3(Math.cos(aT) * 0.15, topY, Math.sin(aT) * 0.15);
      g.add(strut(a, b, 0.02, cm.alu(), 12), strut(a, a.clone().lerp(b, 0.45), 0.032, cm.anodBlack(), 12));
    }
  // adapter plate + sample cell (Linkam-style thermal stage) with the film lying flat at beam height
  const adH = -0.06 - (topY + 0.04);
  const adapter = cyl(0.06, adH, cm.darkSteel(), 20);
  adapter.position.y = topY + 0.04 + adH / 2;
  const cell = box(0.16, 0.05, 0.13, cm.white(), 0.01);
  cell.position.y = -0.035;
  const win = cyl(0.025, 0.003, cm.window(), 20);
  win.position.y = -0.009;
  g.add(adapter, cell, win);
  return shadowed(g);
}

/**
 * The legacy 8-ID-E GIXS diffractometer is a horizontal-sample GISAXS/GIWAXS instrument on translating granite.
 * Its tilt cradle, at angle α, and height stage support a multi-port environment chamber with the film lying flat.
 */
export function gixsDiffractometer(graniteTop: number): THREE.Group {
  const g = new THREE.Group();
  const stage1 = box(0.5, 0.1, 0.5, cm.darkSteel(), 0.01);
  stage1.position.y = graniteTop + 0.05;
  const stage2 = box(0.4, 0.12, 0.4, cm.alu(), 0.01);
  stage2.position.y = graniteTop + 0.16;
  // α tilt stage (small goniometer head) under the chamber
  const tiltStage = box(0.26, 0.07, 0.26, cm.aluDark(), 0.008);
  tiltStage.position.y = -0.235;
  const jack = cyl(0.06, -0.27 - (graniteTop + 0.22), cm.steel(), 18);
  jack.position.y = (graniteTop + 0.22 + -0.27) / 2;
  g.add(stage1, stage2, tiltStage, jack);
  const ch = vesselCylY(0.2, 0.3);
  ch.position.y = -0.02;
  const lid = cyl(0.22, 0.03, cm.steel(), 36);
  lid.position.y = 0.145;
  const bot = cyl(0.22, 0.03, cm.steel(), 36);
  bot.position.y = -0.185;
  g.add(ch, lid, bot);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const dir = v3(Math.cos(a), 0, Math.sin(a));
    if (dir.z < -0.6) continue;
    const p = cyl(0.028, 0.06, cm.steel(), 12);
    p.position.copy(dir.clone().multiplyScalar(0.23)).setY(0.06);
    p.quaternion.setFromUnitVectors(v3(0, 1, 0), dir);
    g.add(p);
  }
  // the film lying flat, tilted by a small incidence angle about the horizontal transverse axis
  const film = box(0.04, 0.001, 0.03, cm.silicon(), 0);
  film.position.y = -0.0006;
  film.rotation.z = 0.0035;
  const puck = cyl(0.04, 0.03, cm.copper(), 24);
  puck.position.y = -0.017;
  const post = cyl(0.02, 0.15, cm.steel(), 12);
  post.position.y = -0.105;
  g.add(film, puck, post);
  return shadowed(g);
}

/**
 * Pilatus 1M-F (169 × 179 mm active, 172 µm pixels) on the in-air WAXS detector motion system 9ID-BI-7: a floor-standing
 * frame with vertical and transverse slides. Face drawn ~0.3 m downstream of the GIXS sample, raised and outboard so the
 * direct beam and small-angle scattering pass beside it into the Grand Tube (position is variable).
 */
export function pilatusOnMotion(beamY: number, faceMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const housing = box(0.42, 0.3, 0.27, cm.pilatusBlue(), 0.02);
  housing.position.x = 0.215;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.169, 0.179), faceMat);
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.0;
  face.name = 'detector-face';
  const bezel = box(0.01, 0.22, 0.21, cm.black(), 0.004);
  bezel.position.x = 0.0;
  face.position.x = -0.006;
  g.add(housing, bezel, face);
  // motion system: transverse arm from an outboard column
  const colZ = 0.42;
  const col = box(0.14, beamY + 0.5, 0.14, cm.frame(), 0.01);
  col.position.set(0.25, -beamY + (beamY + 0.5) / 2, colZ);
  const arm = box(0.12, 0.08, colZ, cm.frame(), 0.008);
  arm.position.set(0.25, 0.19, colZ / 2);
  const slide = box(0.18, 0.2, 0.06, cm.darkSteel(), 0.008);
  slide.position.set(0.25, 0.12, colZ - 0.1);
  const foot = box(0.5, 0.04, 0.5, cm.frame(), 0.006);
  foot.position.set(0.25, -beamY + 0.02, colZ);
  g.add(col, arm, slide, foot);
  return shadowed(g);
}

/** 9-ID-D upstream optical table and the SL-5/XBPM-2 table (context). */
export function stationTables(beamY: number, tables: { x0: number; x1: number; half: number; top: number }[]): THREE.Group {
  const g = new THREE.Group();
  for (const t of tables) {
    const len = t.x1 - t.x0;
    const top = box(len, 0.2, t.half * 2, cm.tableTop(), 0.01);
    top.position.set((t.x0 + t.x1) / 2, t.top - 0.1, 0);
    g.add(top);
    const legH = beamY + t.top - 0.2;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = box(0.12, legH, 0.12, cm.table(), 0.008);
        leg.position.set((t.x0 + t.x1) / 2 + sx * (len / 2 - 0.15), -beamY + legH / 2, sz * (t.half - 0.13));
        g.add(leg);
      }
  }
  return shadowed(g);
}

/** Large flange + gate valve where the beam leaves 9-ID-D through its downstream wall into the Grand Tube. */
export function tubeEntrance(): THREE.Group {
  const g = new THREE.Group();
  const flange = cylX(0.32, 0.05, cm.steel(), 40);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.015, 8, 40), cm.darkSteel());
  ring.rotation.y = Math.PI / 2;
  ring.position.x = -0.03;
  const gv = box(0.1, 0.5, 0.3, cm.steel(), 0.01);
  gv.position.set(-0.22, 0.12, 0);
  const act = cyl(0.05, 0.22, cm.black(), 14);
  act.position.set(-0.22, 0.48, 0);
  g.add(flange, ring, gv, act, pipeX(-0.45, 0.0, 0.04));
  return shadowed(g);
}
