import * as THREE from 'three';
import { mats } from '../../scene/palette';
import { D3_DET, D3_RAILS, D4_DET, DOOR_X, E, FLOOR, MONO_OFFSET, SAMPLE_X } from './geom';
import { lensStack, fastShutter, ionChamber, slitBox, beamStopBlock, windowFlange } from './optics';
import { hexapod } from './stations';
import { M, bar, box, boxSpan, cyl, detectorFace, detectorHead, pedestal, pipeX, rod, shadowed } from './kit';

/**
 * 20-ID-E, the end station in the Long Beamline Building (ESD-010 Fig. 2; HEXM endstation poster). Builders return
 * groups in either the absolute beamline frame (x = metres from the source) or a component frame (origin = the
 * component's placed position), as noted. Beam axis inside 20-ID-E is MONO_OFFSET (30 mm) outboard of the source axis.
 */

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const AX = MONO_OFFSET;

// ------------------------------------------------------------------ the stepped hutch (absolute frame)

/** Reverse the winding (and normals) of a flat geometry so its front face points the other way. */
function flipFaces(geo: THREE.BufferGeometry): void {
  const idx = geo.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
    idx.needsUpdate = true;
  }
  const n = geo.getAttribute('normal');
  if (n) {
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    n.needsUpdate = true;
  }
}

/**
 * Translucent wall panel from a 2D shape, placed by `place`; `outward` is the wall's outward normal in the hutch frame.
 * Front faces are turned outward so the BackSide glass shows only the far walls from any outside viewpoint.
 */
function wallPanel(shape: THREE.Shape, place: (m: THREE.Object3D) => void, g: THREE.Group, outward: THREE.Vector3): void {
  const geo = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geo, mats.hutchWall());
  mesh.renderOrder = 2;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mats.hutchEdge());
  place(mesh);
  place(edges);
  mesh.updateMatrix();
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
  if (normal.dot(outward) < 0) flipFaces(geo);
  g.add(mesh, edges);
}

const rect = (x0: number, y0: number, x1: number, y1: number) => {
  const s = new THREE.Shape();
  s.moveTo(x0, y0);
  s.lineTo(x1, y0);
  s.lineTo(x1, y1);
  s.lineTo(x0, y1);
  s.closePath();
  return s;
};

/**
 * Two-level lead hutch: upstream part 11.3 m long × 6.8 m wide × 3.98 m (to the crane runway / roof walkway), downstream
 * part 8.5 m × 10.8 m × 6.9 m so the 2θ = 17.8° cone reaches the back wall. Beam 1.4 m above the floor, centred (±0.3 m
 * in the ESD drawing). Doorways on both sides at ~185 m. Drawn cut-away (no roof), with the roof-walkway railing.
 */
export function steppedHutch(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hexm-20-ID-E-shell';
  const yF = FLOOR;
  const nw = E.narrowW / 2;
  const ww = E.wideW / 2;
  const z0 = AX;
  // floors
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x223047, roughness: 0.95 });
  for (const [xa, xb, hw] of [[E.x0, E.xStep, nw], [E.xStep, E.x1, ww]] as const) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa, hw * 2), floorMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set((xa + xb) / 2, yF + 0.035, z0);
    f.receiveShadow = true;
    g.add(f);
  }
  // narrow part: side walls with door openings, upstream end wall
  const doorA = DOOR_X - 0.9;
  const doorB = DOOR_X + 0.9;
  const doorH = 2.6;
  for (const s of [-1, 1]) {
    const sh = rect(E.x0, 0, E.xStep, E.narrowH);
    const hole = new THREE.Path();
    hole.moveTo(doorA, 0.001);
    hole.lineTo(doorB, 0.001);
    hole.lineTo(doorB, doorH);
    hole.lineTo(doorA, doorH);
    hole.closePath();
    sh.holes.push(hole);
    wallPanel(sh, (m) => m.position.set(0, yF, z0 + s * nw), g, v(0, 0, s));
  }
  wallPanel(rect(-nw, 0, nw, E.narrowH), (m) => {
    m.rotation.y = Math.PI / 2;
    m.position.set(E.x0, yF, z0);
  }, g, v(-1, 0, 0));
  // the step: upstream face of the tall part with the low part's opening cut out
  {
    const sh = rect(-ww, 0, ww, E.wideH);
    const hole = new THREE.Path();
    hole.moveTo(-nw, 0.001);
    hole.lineTo(nw, 0.001);
    hole.lineTo(nw, E.narrowH);
    hole.lineTo(-nw, E.narrowH);
    hole.closePath();
    sh.holes.push(hole);
    wallPanel(sh, (m) => {
      m.rotation.y = Math.PI / 2;
      m.position.set(E.xStep, yF, z0);
    }, g, v(-1, 0, 0));
  }
  // tall part: side walls and back wall
  for (const s of [-1, 1]) wallPanel(rect(E.xStep, 0, E.x1, E.wideH), (m) => m.position.set(0, yF, z0 + s * ww), g, v(0, 0, s));
  wallPanel(rect(-ww, 0, ww, E.wideH), (m) => {
    m.rotation.y = Math.PI / 2;
    m.position.set(E.x1, yF, z0);
  }, g, v(1, 0, 0));
  // solid low skirts so the hutch reads as a room (gaps at the doorways)
  const skirt = (xa: number, xb: number, z: number) => g.add(boxSpan(xa, xb, yF, yF + 0.5, z - 0.04, z + 0.04, mats.model(), 0));
  for (const s of [-1, 1]) {
    skirt(E.x0, doorA, z0 + s * nw);
    skirt(doorB, E.xStep, z0 + s * nw);
    skirt(E.xStep, E.x1, z0 + s * ww);
    g.add(boxSpan(E.xStep - 0.04, E.xStep + 0.04, yF, yF + 0.5, z0 + s * nw, z0 + s * ww, mats.model(), 0));
    // door frames + a sliding shielded door parked beside each opening
    for (const x of [doorA, doorB]) g.add(boxSpan(x - 0.05, x + 0.05, yF, yF + doorH, z0 + s * nw - 0.06, z0 + s * nw + 0.06, M.tanDark(), 0.004));
    g.add(boxSpan(doorA - 0.05, doorB + 0.05, yF + doorH, yF + doorH + 0.12, z0 + s * nw - 0.06, z0 + s * nw + 0.06, M.tanDark(), 0.004));
    const door = boxSpan(doorB + 0.1, doorB + 1.95, yF + 0.02, yF + doorH - 0.05, z0 + s * (nw + 0.12) - 0.05, z0 + s * (nw + 0.12) + 0.05, M.lead(), 0.01);
    g.add(door);
  }
  g.add(boxSpan(E.x0 - 0.04, E.x0 + 0.04, yF, yF + 0.5, z0 - nw, z0 + nw, mats.model(), 0));
  g.add(boxSpan(E.x1 - 0.04, E.x1 + 0.04, yF, yF + 0.5, z0 - ww, z0 + ww, mats.model(), 0));
  // roof-walkway railing on top of the low part (ESD elevation; safety yellow on the poster)
  const railMat = M.yellow();
  const yR = yF + E.narrowH;
  for (const s of [-1, 1]) {
    const z = z0 + s * (nw - 0.05);
    g.add(boxSpan(E.x0, E.xStep, yR + 1.0, yR + 1.05, z - 0.025, z + 0.025, railMat, 0));
    g.add(boxSpan(E.x0, E.xStep, yR + 0.5, yR + 0.53, z - 0.015, z + 0.015, railMat, 0));
    for (let x = E.x0; x <= E.xStep + 0.01; x += 1.13) g.add(boxSpan(x - 0.025, x + 0.025, yR, yR + 1.05, z - 0.025, z + 0.025, railMat, 0));
  }
  {
    const x = E.x0 + 0.05;
    g.add(boxSpan(x - 0.025, x + 0.025, yR + 1.0, yR + 1.05, z0 - nw, z0 + nw, railMat, 0));
    g.add(boxSpan(x - 0.015, x + 0.015, yR + 0.5, yR + 0.53, z0 - nw, z0 + nw, railMat, 0));
  }
  g.add(bridgeCrane());
  return g;
}

/**
 * Bridge crane with chain hoist spanning the tall downstream bay (MPE panorama photo, Jan 2024): runway beams along both
 * side walls under the 6.9 m roof, one girder across, hoist parked outboard. Sizes and parked position schematic.
 */
function bridgeCrane(): THREE.Group {
  const g = new THREE.Group();
  const yF = FLOOR;
  const ww = E.wideW / 2;
  const yRun = yF + E.wideH - 0.55;
  for (const s of [-1, 1]) {
    const z = AX + s * (ww - 0.2);
    g.add(boxSpan(E.xStep + 0.1, E.x1 - 0.1, yRun - 0.3, yRun, z - 0.1, z + 0.1, M.darkSteel(), 0));
    for (const x of [E.xStep + 0.3, (E.xStep + E.x1) / 2, E.x1 - 0.3]) g.add(boxSpan(x - 0.1, x + 0.1, yRun - 0.6, yRun - 0.3, z + s * 0.02 - 0.08, z + s * 0.02 + 0.08, M.darkSteel(), 0));
  }
  const xb = 191.2;
  g.add(boxSpan(xb - 0.25, xb + 0.25, yRun, yRun + 0.45, AX - ww + 0.15, AX + ww - 0.15, M.yellow(), 0.01));
  for (const s of [-1, 1]) g.add(boxSpan(xb - 0.6, xb + 0.6, yRun, yRun + 0.3, AX + s * (ww - 0.2) - 0.18, AX + s * (ww - 0.2) + 0.18, M.yellow(), 0.01));
  // hoist trolley and hook block parked outboard
  const zh = AX + 3.6;
  g.add(boxSpan(xb - 0.32, xb + 0.32, yRun - 0.35, yRun, zh - 0.3, zh + 0.3, M.yellow(), 0.01));
  g.add(cyl(0.006, 1.2, M.darkSteel(), 6).translateX(xb).translateY(yRun - 0.95).translateZ(zh));
  g.add(boxSpan(xb - 0.08, xb + 0.08, yRun - 1.75, yRun - 1.55, zh - 0.06, zh + 0.06, M.yellow(), 0.01));
  return shadowed(g);
}

// ------------------------------------------------------------------ beam-conditioning optics (component frames)

/** Entrance window WN-4 (177.7 m, through the upstream wall) + portable white-beam slits S7 on the BCS table. Origin = S7. */
export function entranceSlits(): THREE.Group {
  const g = new THREE.Group();
  const s7 = slitBox({ stand: false, size: 0.2 });
  g.add(s7, pedestal(0, 0, -0.32, -0.1, 0.08, 0.08, M.darkSteel()));
  const w = windowFlange();
  w.position.x = 177.7 - 178.2;
  g.add(w, pipeX(177.5 - 178.2, 177.7 - 178.2, 0.03));
  return shadowed(g);
}

/**
 * Temporary Be window WN-5 (180.0 m): the end of the evacuated path, 0.7 m before the sample, on a bracket at the
 * downstream end of the beam-conditioning table. Origin = window.
 */
export function window5(): THREE.Group {
  const g = new THREE.Group();
  for (const dx of [-0.01, 0.01]) g.add(boxSpan(dx - 0.006, dx + 0.006, -0.045, 0.045, -0.045, 0.045, M.steel(), 0.004));
  const be = cyl(0.02, 0.002, new THREE.MeshStandardMaterial({ color: 0xa9b3bd, roughness: 0.4, metalness: 0.6 }), 20);
  be.rotation.z = Math.PI / 2;
  g.add(be, pipeX(-0.18, -0.016, 0.014));
  g.add(pedestal(-0.06, 0, -0.32, -0.045, 0.04, 0.04, M.darkSteel()));
  return shadowed(g);
}

/**
 * Beam-conditioning optics table (≈178–180 m): granite on legs, carrying L6 (origin, 178.8 m), S6/S8 slits, an ion
 * chamber and the fast shutter. Element order on the table follows FDR Fig. 4.19 (S6 · L6 · S8); monitor and shutter
 * positions are schematic.
 */
export function bcsTable(): THREE.Group {
  const g = new THREE.Group();
  const xa = 178.0 - 178.8;
  const xb = 180.0 - 178.8;
  const top = -0.32;
  g.add(boxSpan(xa, xb, top - 0.2, top, -0.3, 0.3, M.granite(), 0.01));
  for (const x of [xa + 0.25, xb - 0.25]) g.add(pedestal(x, 0, FLOOR, top - 0.2, 0.3, 0.45, M.darkSteel()));
  const post = (x: number, y0: number) => g.add(pedestal(x, 0, top, y0, 0.05, 0.05, M.darkSteel()));
  const l6 = lensStack({ n: 14, stand: false, housing: 0.1 });
  g.add(l6);
  post(0, -0.065);
  const s6 = slitBox({ stand: false, size: 0.12 });
  s6.position.x = -0.38;
  g.add(s6);
  post(-0.38, -0.06);
  const ic = ionChamber();
  ic.position.x = 0.45;
  g.add(ic);
  post(0.45, -0.05);
  const fs = fastShutter({ stand: false });
  fs.position.x = 0.72;
  g.add(fs);
  post(0.72, -0.06);
  const s8 = slitBox({ stand: false, size: 0.12 });
  s8.position.x = 1.0;
  g.add(s8);
  post(1.0, -0.06);
  g.add(pipeX(-0.25, -0.12, 0.012), pipeX(0.12, 0.4, 0.012));
  return shadowed(g);
}

// ------------------------------------------------------------------ sample position (origin = sample)

/**
 * High-Load SMS (wheeled cart with guide columns) carrying a RAMS-type load frame (rotating grips top and bottom so the
 * sample can turn 360° under load), on floor rails used to swap it with the High-Resolution SMS (parked inboard).
 * The overhead support structure bridges the sample area (poster). Dimensions are schematic.
 */
export function sampleArea(): THREE.Group {
  const g = new THREE.Group();
  const yF = FLOOR;
  // transverse exchange rails (z), from the beam to the parked HR-SMS on the inboard side
  for (const x of [-0.45, 0.45]) g.add(boxSpan(x - 0.04, x + 0.04, yF, yF + 0.06, -2.9, 0.9, M.rail(), 0.004));
  // --- HL-SMS cart with guide columns (columns in the sample plane, 0.55 m either side of the beam)
  g.add(boxSpan(-0.62, 0.62, yF + 0.12, yF + 0.42, -0.68, 0.68, M.tan(), 0.02));
  for (const x of [-0.45, 0.45])
    for (const z of [-0.5, 0.5]) {
      const wheel = cyl(0.06, 0.06, M.darkSteel(), 16);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, yF + 0.08, z);
      g.add(wheel);
    }
  const colTop = 0.78;
  for (const z of [-0.55, 0.55]) g.add(boxSpan(-0.05, 0.05, yF + 0.42, colTop, z - 0.05, z + 0.05, M.steel(), 0.01));
  // load frame: actuator below, rotary stages top & bottom, grips, load cell, crosshead
  g.add(boxSpan(-0.2, 0.2, -0.62, -0.42, -0.62, 0.62, M.darkSteel(), 0.01)); // lower platen
  const act = cyl(0.07, 0.36, M.alu(), 24);
  act.position.y = -0.8;
  g.add(act);
  const rotLo = cyl(0.11, 0.14, M.blackAnod(), 32);
  rotLo.position.y = -0.35;
  const rotHi = cyl(0.11, 0.14, M.blackAnod(), 32);
  rotHi.position.y = 0.37;
  g.add(rotLo, rotHi);
  const gripLo = cyl(0.025, 0.2, M.steel(), 16);
  gripLo.position.y = -0.16;
  const gripHi = cyl(0.025, 0.14, M.steel(), 16);
  gripHi.position.y = 0.13;
  const cell = cyl(0.045, 0.08, M.blueAnod(), 20);
  cell.position.y = 0.26;
  g.add(gripLo, gripHi, cell);
  // dog-bone specimen (gauge section in the beam)
  g.add(cyl(0.004, 0.06, M.sample(), 12), cyl(0.008, 0.02, M.sample(), 12).translateY(-0.045), cyl(0.008, 0.02, M.sample(), 12).translateY(0.045));
  g.add(boxSpan(-0.2, 0.2, 0.45, 0.6, -0.62, 0.62, M.darkSteel(), 0.01)); // crosshead
  g.add(cyl(0.06, 0.16, M.alu(), 20).translateY(0.68));
  // --- overhead support structure (portal truss), clear of the 3.98 m roof
  const yTop = yF + 3.72;
  const yBot = yF + 3.35;
  for (const x of [-0.45, 0.95]) {
    for (const z of [-3.15, 3.1]) g.add(boxSpan(x - 0.07, x + 0.07, yF, yTop, z - 0.07, z + 0.07, M.tanDark(), 0.006));
    g.add(boxSpan(x - 0.06, x + 0.06, yTop - 0.1, yTop, -3.15, 3.1, M.tan(), 0.004), boxSpan(x - 0.05, x + 0.05, yBot, yBot + 0.08, -3.15, 3.1, M.tan(), 0.004));
    for (let z = -3.0; z < 3.0; z += 0.6) g.add(bar(v(x, yBot + 0.08, z), v(x, yTop - 0.1, z + 0.6), 0.035, M.tan()));
  }
  for (const z of [-3.15, -1.0, 1.0, 3.1]) g.add(boxSpan(-0.45, 0.95, yTop - 0.09, yTop - 0.01, z - 0.04, z + 0.04, M.tan(), 0.004));
  // --- High-Resolution SMS parked on the exchange rails: hexapod on a granite block with a large rotation stage on top
  // (poster rendering; bearing type not stated). Its sample mount stays empty while parked.
  const hr = new THREE.Group();
  hr.position.z = -2.1;
  hr.add(boxSpan(-0.5, 0.5, yF + 0.1, yF + 0.6, -0.45, 0.45, M.granite(), 0.02));
  for (const x of [-0.45, 0.45]) hr.add(boxSpan(x - 0.06, x + 0.06, yF + 0.05, yF + 0.12, -0.4, 0.4, M.darkSteel(), 0.004));
  hr.add(hexapod(0.24, 0.17, yF + 0.62, -0.3, 0.016));
  const rotStage = cyl(0.2, 0.12, M.alu(), 40);
  rotStage.position.y = -0.21;
  const rotRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.006, 6, 40), M.blackAnod());
  rotRing.rotation.x = Math.PI / 2;
  rotRing.position.y = -0.148;
  hr.add(rotStage, rotRing, cyl(0.05, 0.06, M.darkSteel(), 20).translateY(-0.12), cyl(0.006, 0.07, M.steel(), 10).translateY(-0.055));
  g.add(hr);
  return shadowed(g);
}

/**
 * D1 near-field / imaging detector: thin LuAG:Ce scintillator → 45° mirror → microscope objective → camera, drawn
 * retracted ~0.1 m outboard of the beam (in use it sits 1–2 cm behind the sample). Origin = scintillator centre.
 */
export function nearFieldDetector(): THREE.Group {
  const g = new THREE.Group();
  const scint = boxSpan(-0.001, 0.001, -0.015, 0.015, -0.015, 0.015, M.scint(), 0);
  g.add(scint);
  g.add(boxSpan(0.002, 0.05, -0.03, 0.03, -0.03, 0.03, M.blackAnod(), 0.004)); // mirror block
  const obj = cyl(0.026, 0.07, M.alu(), 24);
  obj.rotation.x = Math.PI / 2;
  obj.position.set(0.026, 0, 0.07);
  const tube = cyl(0.032, 0.11, M.blackAnod(), 24);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0.026, 0, 0.16);
  const cam = boxSpan(-0.035, 0.09, -0.055, 0.055, 0.215, 0.33, M.blueAnod(), 0.01);
  g.add(obj, tube, cam);
  // XYZ stage and post down to the HL-SMS cart deck
  g.add(boxSpan(-0.03, 0.08, -0.12, -0.06, 0.08, 0.28, M.darkSteel(), 0.004));
  g.add(pedestal(0.026, 0.15, FLOOR + 0.42, -0.12, 0.05, 0.05, M.darkSteel()));
  return shadowed(g);
}

/**
 * D2: hexapod-mounted flat-panel platform (~1 m from the sample), drawn moved aside (inboard) out of the direct beam,
 * as when the far-field detectors are in use. Panel: GE-41RT/Dexela-class (≈0.41 m). Origin = panel centre.
 */
export function d2Platform(): THREE.Group {
  const g = new THREE.Group();
  g.add(detectorHead(0.41, 0.41, 0.1, detectorFace('blank')));
  g.add(boxSpan(0.1, 0.2, -0.2, 0.2, -0.12, 0.12, M.darkSteel(), 0.006));
  g.add(hexapod(0.24, 0.16, FLOOR + 0.62, -0.3, 0.016));
  g.add(boxSpan(-0.3, 0.45, FLOOR, FLOOR + 0.6, -0.35, 0.35, M.tan(), 0.02));
  return shadowed(g);
}

/**
 * L7 TXM objective: refractive lens stack on a vertical lift. In TXM it sits in the direct beam; here it is drawn
 * lowered 0.3 m out of the beam (far-field configuration). Origin = on the beam axis.
 */
export function txmObjective(): THREE.Group {
  const g = new THREE.Group();
  const lens = lensStack({ n: 18, housing: 0.12, stand: false, actuator: false });
  lens.position.y = -0.3;
  g.add(lens);
  g.add(boxSpan(-0.09, 0.09, -0.62, -0.38, -0.09, 0.09, M.darkSteel(), 0.006));
  g.add(pedestal(0, 0, FLOOR, -0.62, 0.2, 0.2, M.tan()));
  return shadowed(g);
}

// ------------------------------------------------------------------ large detector movers (origin = detector face centre)

function hexmDecal(): THREE.MeshBasicMaterial {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c8b48c';
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = '#2b2f36';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  'HEXM'.split('').forEach((ch, i) => ctx.fillText(ch, 32, 56 + i * 54));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex });
}

/** Rotate a detector head (face along −X of its frame) so the face looks back at a point `toward` (local coords). */
function aim(head: THREE.Object3D, toward: THREE.Vector3): void {
  const d = toward.clone().normalize();
  head.quaternion.setFromUnitVectors(new THREE.Vector3(-1, 0, 0), d);
}

/**
 * D3 detector manipulation system: a tall tan pillar on a carriage riding the outboard floor rail (+2.2 m), with a
 * vertical carriage and a cantilever arm holding a ~100 kg large-area detector (Pilatus3 X CdTe 6M was the spec
 * reference: 424 × 435 mm). Pillar kept under the 3.98 m roof of the low section it must pass through.
 * Shown 6 m from the sample with the detector on the 2θ = 8° Debye ring (schematic configuration).
 */
export function d3Tower(): THREE.Group {
  const g = new THREE.Group();
  const railZ = D3_RAILS.sides[2] + AX - (D3_DET.side + AX);
  const yF = FLOOR - D3_DET.up;
  const yTop = FLOOR + E.narrowH - 0.3 - D3_DET.up;
  const head = detectorHead(0.424, 0.435, 0.42, detectorFace('arc'));
  aim(head, v(SAMPLE_X - D3_DET.x, -D3_DET.up, -D3_DET.side));
  g.add(head);
  // pillar just downstream of the detector housing
  const px = 0.72;
  // carriage on the rail
  g.add(boxSpan(px - 0.5, px + 0.5, yF + 0.07, yF + 0.32, railZ - 0.38, railZ + 0.38, M.tanDark(), 0.02));
  for (const x of [px - 0.38, px + 0.38]) {
    const w = cyl(0.07, 0.1, M.darkSteel(), 16);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, yF + 0.09, railZ);
    g.add(w);
  }
  const pillar = boxSpan(px - 0.2, px + 0.2, yF + 0.32, yTop, railZ - 0.2, railZ + 0.2, M.tan(), 0.02);
  g.add(pillar);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.64), hexmDecal());
  decal.rotation.y = -Math.PI / 2;
  decal.position.set(px - 0.203, yTop - 0.6, railZ);
  g.add(decal);
  // cable chain up the pillar (downstream face)
  g.add(boxSpan(px + 0.2, px + 0.26, yF + 0.4, yTop - 0.1, railZ - 0.09, railZ + 0.09, M.blackAnod(), 0.004));
  // vertical carriage and cantilever arm reaching toward the beam
  g.add(boxSpan(px - 0.26, px + 0.26, -0.22, 0.22, railZ - 0.3, railZ + 0.3, M.tanDark(), 0.015));
  g.add(boxSpan(0.44, 0.6, -0.08, 0.08, 0.0, railZ - 0.25, M.tan(), 0.01));
  g.add(boxSpan(0.38, 0.5, -0.14, 0.14, -0.12, 0.16, M.darkSteel(), 0.008)); // tilt/rotation head
  return shadowed(g);
}

/** The three D3 floor rails (absolute frame). */
export function d3Rails(): THREE.Group {
  const g = new THREE.Group();
  for (const s of D3_RAILS.sides) {
    const z = s + AX;
    g.add(boxSpan(D3_RAILS.x0, D3_RAILS.x1, FLOOR, FLOOR + 0.05, z - 0.06, z + 0.06, M.rail(), 0.004));
    g.add(boxSpan(D3_RAILS.x0, D3_RAILS.x1, FLOOR, FLOOR + 0.015, z - 0.2, z + 0.2, M.darkSteel(), 0));
  }
  return shadowed(g);
}

/**
 * D4 back-wall detector system: a tan pillar travelling across the back wall on top and bottom rails, with a carriage
 * holding a high-resolution detector aimed back at the sample ~16 m away. Origin = detector face centre (196.9 m).
 */
export function d4BackWall(): THREE.Group {
  const g = new THREE.Group();
  const yF = FLOOR - D4_DET.up;
  const zOff = -(D4_DET.side + AX); // local z of the source-axis line… plus AX, i.e. local z of absolute z = 0
  const wallX = E.x1 - D4_DET.x;
  const head = detectorHead(0.3, 0.3, 0.2, detectorFace('spot'));
  aim(head, v(SAMPLE_X - D4_DET.x, -D4_DET.up, -D4_DET.side));
  g.add(head);
  // rails along the back wall (span ±5 m about the beam)
  const za = zOff + AX - 5.0;
  const zb = zOff + AX + 5.0;
  for (const y of [yF + 0.25, yF + 6.45]) g.add(boxSpan(wallX - 0.16, wallX - 0.04, y - 0.06, y + 0.06, za, zb, M.rail(), 0.004));
  for (let z = za; z <= zb + 0.01; z += 2.5) g.add(boxSpan(wallX - 0.06, wallX - 0.01, yF + 0.1, yF + 6.6, z - 0.04, z + 0.04, M.darkSteel(), 0));
  // pillar
  g.add(boxSpan(wallX - 0.36, wallX - 0.16, yF + 0.15, yF + 6.55, -0.15, 0.15, M.tan(), 0.015));
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.48), hexmDecal());
  decal.rotation.y = -Math.PI / 2;
  decal.position.set(wallX - 0.362, yF + 4.8, 0);
  g.add(decal);
  // carriage
  g.add(boxSpan(0.12, wallX - 0.14, -0.2, 0.2, -0.22, 0.22, M.tanDark(), 0.012));
  return shadowed(g);
}

/** Fixed white-beam stop BS-2 at the back wall (origin on the beam axis). */
export function fixedStop(): THREE.Group {
  return beamStopBlock({ fixed: true });
}

/** D6 SAXS detector on the SAXS table near the back wall, with a small direct-beam stop in front. Origin = face centre. */
export function saxsStation(): THREE.Group {
  const g = new THREE.Group();
  g.add(detectorHead(0.25, 0.25, 0.25, detectorFace('saxs')));
  // beamstop on a thin wire
  const bs = cyl(0.008, 0.01, M.tungsten(), 16);
  bs.rotation.z = Math.PI / 2;
  bs.position.x = -0.12;
  g.add(bs, rod(v(-0.12, 0, 0), v(-0.12, 0.2, 0), 0.0012, M.steel(), 6));
  g.add(boxSpan(-0.14, -0.1, 0.19, 0.22, -0.06, 0.06, M.darkSteel(), 0.002));
  // table
  g.add(boxSpan(-0.3, 0.6, -0.42, -0.36, -0.45, 0.45, M.alu(), 0.01));
  g.add(boxSpan(-0.05, 0.3, -0.36, -0.17, -0.1, 0.1, M.darkSteel(), 0.006));
  for (const x of [-0.25, 0.55]) for (const z of [-0.4, 0.4]) g.add(pedestal(x, z, FLOOR, -0.42, 0.05, 0.05, M.steel()));
  return shadowed(g);
}

/** D5 TXM imaging detector (high-resolution, high-efficiency), drawn moved 1.3 m inboard of the axis on its own table (idle face). */
export function txmDetector(): THREE.Group {
  const g = new THREE.Group();
  g.add(detectorHead(0.28, 0.28, 0.16, detectorFace('blank')));
  g.add(boxSpan(-0.15, 0.4, -0.45, -0.18, -0.3, 0.3, M.darkSteel(), 0.01));
  g.add(boxSpan(-0.2, 0.45, FLOOR, -0.45, -0.32, 0.32, M.tan(), 0.02));
  // short transverse rail toward the beam
  for (const x of [0.0, 0.3]) g.add(boxSpan(x - 0.03, x + 0.03, FLOOR, FLOOR + 0.04, -0.5, 1.4, M.rail(), 0.003));
  return shadowed(g);
}

/** Laser tracker (Leica AT9xx class) on a tripod that watches the big detector movers (absolute frame). */
export function laserTracker(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, FLOOR, z);
  const hgt = 1.55;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    g.add(rod(v(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45), v(0, hgt - 0.1, 0), 0.015, M.blackAnod()));
  }
  g.add(cyl(0.07, 0.12, M.alu(), 20).translateY(hgt));
  const head = box(0.16, 0.22, 0.16, new THREE.MeshStandardMaterial({ color: 0xe7e9ec, roughness: 0.5, metalness: 0.2 }), 0.03);
  head.position.y = hgt + 0.17;
  const eye = cyl(0.035, 0.04, M.blackAnod(), 16);
  eye.rotation.z = Math.PI / 2;
  eye.position.set(0.09, hgt + 0.2, 0);
  g.add(head, eye);
  return shadowed(g);
}
