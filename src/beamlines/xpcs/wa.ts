import * as THREE from 'three';
import { WA } from './geom';
import { beamBetween, box, cyl, cylX, flangeX, hose, pedestal, pipeX, shadowed, strut, v3, xm } from './kit';

/**
 * 8-ID-E wide-angle XPCS instrument, modelled on the MEDSI 2020 render (Wakefield et al., Fig. 2): a Huber six-circle on a
 * heavy base with X/Y translations, vertical η/δ circles on the inboard side, an open χ cradle around the sample, a split
 * detector arm (vertical arm for the near detector, horizontal ν arm carrying the LDDP flight path), and the air-bearing
 * LDDP. All builders have their origin at the component's position in the beamline frame (+X downstream, +Z outboard).
 */

const C30 = Math.cos(WA.twoTheta);
const S30 = Math.sin(WA.twoTheta);

/** Ring (annulus) whose axis is along Z, centred on the origin. */
function ringZ(rOut: number, rIn: number, thick: number, m: THREE.Material, arc = Math.PI * 2, start = 0): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOut, start, start + arc, false);
  if (arc >= Math.PI * 2 - 1e-6) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  } else {
    shape.absarc(0, 0, rIn, start + arc, start, true);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 48 });
  geo.translate(0, 0, -thick / 2);
  return new THREE.Mesh(geo, m);
}

/** Six-circle diffractometer, origin at the sample (56.3 m). */
export function sixCircle(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const floor = -beamY;
  // heavy base with X/Y translation plates (lets the whole instrument slide out of the 8-ID-I beam path)
  const base = box(1.3, 0.3, 1.3, xm.base(), 0.03);
  base.position.y = floor + 0.15;
  const plateX = box(1.2, 0.05, 1.15, xm.huberDark(), 0.01);
  plateX.position.y = floor + 0.325;
  const plateY = box(1.1, 0.05, 1.1, xm.huber(), 0.01);
  plateY.position.y = floor + 0.375;
  g.add(base, plateX, plateY);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const foot = box(0.18, 0.04, 0.18, xm.steel(), 0.006);
    foot.position.set(sx * 0.55, floor + 0.02, sz * 0.55);
    g.add(foot);
  }
  // μ / ν rotation stage (vertical axis)
  const mu = cyl(0.5, 0.12, xm.huber(), 48);
  mu.position.y = floor + 0.46;
  const muRim = cyl(0.52, 0.03, xm.steel(), 48);
  muRim.position.y = floor + 0.41;
  g.add(mu, muRim);
  // tower on the inboard side carrying the vertical (η, δ) circles
  const towerTop = -0.12;
  const tower = box(0.42, towerTop - (floor + 0.52), 0.2, xm.huberDark(), 0.02);
  tower.position.set(0, (towerTop + floor + 0.52) / 2, -0.52);
  g.add(tower);
  const delta = ringZ(0.46, 0.31, 0.08, xm.huber());
  delta.position.set(0, 0, -0.42);
  const deltaRim = ringZ(0.47, 0.45, 0.1, xm.steel());
  deltaRim.position.set(0, 0, -0.42);
  const eta = ringZ(0.3, 0.235, 0.07, xm.huberDark());
  eta.position.set(0, 0, -0.34);
  g.add(delta, deltaRim, eta);
  // open χ cradle (Eulerian ring in the plane across the beam), open at the top for detector access
  const chiGeo = new THREE.TorusGeometry(0.25, 0.035, 12, 48, Math.PI * 1.5);
  chiGeo.rotateZ((Math.PI * 3) / 4); // put the 90° opening at the top
  const chi = new THREE.Mesh(chiGeo, xm.huber());
  chi.rotation.y = Math.PI / 2;
  const chiCarriage = box(0.12, 0.1, 0.1, xm.huberDark(), 0.01);
  chiCarriage.position.set(0, -0.25, 0);
  g.add(chi, chiCarriage);
  // bracket from the η circle to the χ cradle
  g.add(beamBetween(v3(0, -0.2, -0.3), v3(0, -0.2, -0.08), 0.08, 0.06, xm.huberDark()));
  // φ + XYZ sample stack up to the sample
  const phi = cyl(0.05, 0.05, xm.steel(), 24);
  phi.position.y = -0.18;
  const xyz = box(0.08, 0.06, 0.08, xm.huberDark(), 0.006);
  xyz.position.y = -0.125;
  const post = cyl(0.012, 0.07, xm.steel(), 10);
  post.position.y = -0.06;
  g.add(phi, xyz, post);
  // vertical detector arm (δ = 2θ upward, here 30°): rigid teal beam from the δ circle hub
  const armZ = -0.42;
  const armEnd = WA.nearR - 0.12;
  // (arm springs from the δ circle itself, keeping the bore open so the sample stays visible from the inboard side)
  g.add(beamBetween(v3(0.36 * C30, 0.36 * S30, armZ), v3(armEnd * C30, armEnd * S30, armZ), 0.09, 0.11, xm.huber()));
  // horizontal ν arm (2θ = 30° outboard) carrying the near end of the LDDP flight path
  const nuY = floor + 0.55;
  g.add(beamBetween(v3(0.35 * C30, nuY, 0.35 * S30), v3(0.95 * C30, nuY, 0.95 * S30), 0.12, 0.1, xm.huber()));
  const nuPost = box(0.08, -0.085 - nuY, 0.08, xm.huberDark(), 0.006);
  nuPost.position.set(0.9 * C30, (nuY - 0.085) / 2, 0.9 * S30);
  const saddle = box(0.1, 0.03, 0.16, xm.huberDark(), 0.004);
  saddle.position.set(0.9 * C30, -0.07, 0.9 * S30);
  saddle.rotation.y = -WA.twoTheta;
  g.add(nuPost, saddle);
  // downstream table extension for large add-ons
  const ext = box(0.3, 0.05, 0.7, xm.huberDark(), 0.008);
  ext.position.set(0.72, floor + 0.36, -0.15);
  g.add(ext);
  return shadowed(g);
}

/** Lake Shore-type cryostage on the sample stack (compact vacuum can with X-ray windows and a He transfer line). */
export function cryostage(): THREE.Group {
  const g = new THREE.Group();
  const can = cyl(0.045, 0.07, xm.alu(), 28);
  can.position.y = 0.005;
  const lid = cyl(0.05, 0.015, xm.steel(), 28);
  lid.position.y = 0.045;
  const win = cylX(0.012, 0.094, xm.kapton(), 16);
  g.add(can, lid, win);
  g.add(hose([v3(0, 0.05, 0), v3(0, 0.22, 0.02), v3(-0.15, 0.4, 0.15), v3(-0.5, 0.45, 0.45)], 0.01, xm.hose()));
  return shadowed(g);
}

/** Generic hybrid-pixel detector head, face at local x = 0 looking toward −X. Size ~ EIGER2 X 4M head. */
export function detectorHead(face: THREE.Material, w = 0.155, h = 0.162, depth = 0.38): THREE.Group {
  const g = new THREE.Group();
  const housing = box(depth, h + 0.09, w + 0.09, xm.black(), 0.02);
  housing.position.x = depth / 2 + 0.01;
  const bezel = box(0.02, h + 0.05, w + 0.05, xm.aluDark(), 0.004);
  bezel.position.x = 0.0;
  const facePlane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), face);
  facePlane.rotation.y = -Math.PI / 2;
  facePlane.position.x = -0.0105;
  facePlane.name = 'detector-face';
  const fins = box(depth * 0.6, h * 0.6, 0.02, xm.darkSteel(), 0.004);
  fins.position.set(depth * 0.55, 0, (w + 0.09) / 2 + 0.012);
  const water = hose([v3(depth, 0.03, -0.03), v3(depth + 0.12, 0.05, -0.04), v3(depth + 0.2, -0.2, -0.1)], 0.01, xm.waterHose());
  g.add(housing, bezel, facePlane, fins, water);
  return shadowed(g);
}

/**
 * Near-sample detector on the vertical arm, origin at the detector face; the caller rotates it so local +X points
 * along the scattered ray (δ = 30° up). Includes the short flight pipe back toward the sample and the arm bracket.
 */
export function nearDetector(face: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(detectorHead(face, 0.08, 0.08, 0.26));
  // short flight pipe (sample side) with anti-scatter slit box
  const len = WA.nearR - 0.38;
  const p = pipeX(-len - 0.03, -0.03, 0.045, xm.aluDark());
  const sl = box(0.08, 0.12, 0.12, xm.darkSteel(), 0.006);
  sl.position.x = -0.12;
  g.add(p, flangeX(-len - 0.03, 0.06), flangeX(-0.03, 0.06), sl);
  // bracket to the arm (arm runs 0.42 m inboard of the scattering plane)
  g.add(beamBetween(v3(0.05, -0.0, -0.42), v3(0.05, 0, -0.08), 0.07, 0.07, xm.huberDark()));
  const clamp = box(0.2, 0.12, 0.08, xm.huber(), 0.008);
  clamp.position.set(-0.05, 0, -0.42);
  g.add(clamp);
  return shadowed(g);
}

/**
 * Long-distance detector positioner, origin at the detector face; caller applies rotY = −2θ so local +X points away from
 * the sample. Granite base on air casters, tapered frame, ±100 mm stages, detector, removable telescoping flight path
 * back to 0.35 m from the sample, laser-tracker reflectors (SMRs).
 */
export function lddp(beamY: number, face: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const floor = -beamY;
  g.add(detectorHead(face));
  // ±100 mm H/V stages under the detector
  const stageV = box(0.32, 0.12, 0.3, xm.huber(), 0.008);
  stageV.position.set(0.2, -0.2, 0);
  const stageH = box(0.42, 0.06, 0.36, xm.huberDark(), 0.008);
  stageH.position.set(0.2, -0.29, 0);
  g.add(stageV, stageH);
  // tapered steel frame
  const frameTop = -0.32;
  const frameBot = floor + 0.42;
  const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.36, frameTop - frameBot, 4, 1), xm.baseLight());
  frame.rotation.y = Math.PI / 4;
  frame.position.set(0.2, (frameTop + frameBot) / 2, 0);
  frame.scale.set(1, 1, 0.85);
  g.add(frame);
  // granite base on air casters
  const granite = box(0.9, 0.34, 0.7, xm.granite(), 0.02);
  granite.position.set(0.2, floor + 0.25, 0);
  g.add(granite);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const pad = cyl(0.07, 0.06, xm.black(), 18);
    pad.position.set(0.2 + sx * 0.33, floor + 0.04, sz * 0.25);
    g.add(pad);
  }
  // push handle at the back
  g.add(hose([v3(0.65, floor + 0.42, -0.25), v3(0.78, floor + 0.95, -0.25), v3(0.78, floor + 0.95, 0.25), v3(0.65, floor + 0.42, 0.25)], 0.016, xm.steel()));
  // laser-tracker reflectors
  for (const [x, z] of [[0.05, 0.16], [0.36, -0.16]] as const) {
    const smr = new THREE.Mesh(new THREE.SphereGeometry(0.019, 16, 10), xm.pt());
    smr.position.set(x, 0.14, z);
    g.add(smr);
  }
  // removable telescoping flight path back to ~0.35 m from the sample (three sections, growing toward the detector)
  const R = WA.lddpR;
  const sections: [number, number, number][] = [
    [-(R - 0.35), -(R - 0.35) + 1.15, 0.055],
    [-(R - 0.35) + 1.1, -(R - 0.35) + 2.25, 0.065],
    [-(R - 0.35) + 2.2, -0.04, 0.075],
  ];
  for (const [a, b, r] of sections) g.add(pipeX(a, b, r, xm.aluDark()), flangeX(a, r + 0.018), flangeX(b, r + 0.018));
  const win = cylX(0.072, 0.004, xm.kapton(), 24);
  win.position.x = -0.042;
  g.add(win);
  // mobile mid support of the flight path
  const midX = -(R - 0.35) + 1.6;
  const stand = box(0.06, beamY - 0.08, 0.06, xm.steel(), 0.005);
  stand.position.set(midX, floor + (beamY - 0.08) / 2, 0);
  const foot = box(0.4, 0.03, 0.4, xm.steel(), 0.004);
  foot.position.set(midX, floor + 0.015, 0);
  const cradle = box(0.08, 0.03, 0.16, xm.huberDark(), 0.004);
  cradle.position.set(midX, -0.075, 0);
  g.add(stand, foot, cradle);
  return shadowed(g);
}

/** Laser tracker on its blue pedestal (MEDSI render), origin on the floor. */
export function laserTracker(): THREE.Group {
  const g = new THREE.Group();
  const plate = box(0.4, 0.02, 0.4, xm.trackerBlue(), 0.004);
  plate.position.y = 0.01;
  const column = cyl(0.07, 0.95, xm.trackerBlue(), 20);
  column.position.y = 0.495;
  const top = box(0.22, 0.02, 0.22, xm.steel(), 0.004);
  top.position.y = 0.98;
  // tracker: base drum, U-shaped yoke and a tilting head with the laser aperture
  const drum = cyl(0.08, 0.08, xm.offWhite(), 24);
  drum.position.y = 1.03;
  g.add(plate, column, top, drum);
  for (const z of [-0.07, 0.07]) {
    const arm = box(0.07, 0.16, 0.025, xm.offWhite(), 0.006);
    arm.position.set(0, 1.15, z);
    g.add(arm);
  }
  const head = box(0.1, 0.09, 0.11, xm.black(), 0.012);
  head.position.y = 1.17;
  const lens = cylX(0.025, 0.02, xm.pt(), 16);
  lens.position.set(-0.055, 1.17, 0);
  g.add(head, lens);
  return shadowed(g);
}

/** Removable beam-pass pipe (57.3–61.0 m) drawn as a see-through ghost: the model shows 8-ID-E in WA mode. */
export function ghostPipe(beamY: number, len: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.04, 0.04, len, 20, 1, true);
  const pipe = new THREE.Mesh(geo, xm.ghost());
  pipe.rotation.z = Math.PI / 2;
  pipe.position.x = len / 2;
  g.add(pipe);
  for (const x of [0, len]) {
    const f = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 24), xm.ghost());
    f.rotation.y = Math.PI / 2;
    f.position.x = x;
    g.add(f);
  }
  for (const x of [0.7, len - 0.7]) {
    const s = pedestal(beamY, -0.05, 0.05, 0.05, xm.ghost());
    s.position.x = x;
    g.add(s);
  }
  const edgePts = [v3(0, 0.04, 0), v3(len, 0.04, 0), v3(0, -0.04, 0), v3(len, -0.04, 0)];
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edgePts), xm.ghostEdge()));
  return g;
}

export { strut };
