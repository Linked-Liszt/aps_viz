import * as THREE from 'three';
import {
  BSDD_DIR, COND, FLOOR, KBH, KBV, KB_CHAMBER, KB_EXIT, PTYCHO, ROBOT, SAMPLE_CHAMBER, SAMPLE_X, SE, TABLE, XRD, XRD_DIR, XRD_R, XRF,
} from './geom';
import { M, bar, beamSeg, boxSpan, cyl, detectorFace, detectorHead, faceToward, flangeX, pedestal, pipeX, rod, shadowed, vesselSpan } from './kit';

/**
 * 19-ID-E endstation hardware (MEDSI'25 TUOA02 Figs. 3–5): beam-conditioning line on granite blocks, the UHV KB optics
 * chamber and the separate HV sample chamber on one granite table + Invar baseplate, the fluorescence detectors, the
 * robot-held diffraction detector and the ptychography detector on its 6 m table. Each builder's origin is its
 * component's position (on the beam axis unless the layout offsets it).
 */

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Double Si3N4 exit window (19ID-WN-1) on a blue pump/pedestal tower, as at the left of MEDSI'25 Fig. 3. */
export function exitWindow(): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(-0.09, 0.09, -0.09, 0.09, -0.09, 0.09, M.steel(), 0.01));
  for (const x of [-0.02, 0.02]) {
    const w = cyl(0.012, 0.002, M.diamond(), 20);
    w.rotation.z = Math.PI / 2;
    w.position.x = x;
    g.add(w);
  }
  for (const x of [-0.1, 0.1]) {
    const f = flangeX(0.07);
    f.position.x = x;
    g.add(f);
  }
  const pump = cyl(0.07, 0.22, M.steel(), 16);
  pump.position.set(0, 0.2, 0);
  g.add(pump, pipeX(-0.35, -0.1, 0.03), pipeX(0.1, 0.2, 0.03));
  g.add(pedestal(0, 0, FLOOR, -0.09, 0.2, 0.2, M.bluePost()));
  return shadowed(g);
}

export function filterBox(): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(-0.07, 0.07, -0.08, 0.12, -0.08, 0.08, M.steel(), 0.01));
  for (let i = 0; i < 4; i++) {
    const a = cyl(0.012, 0.12, M.blackAnod(), 10);
    a.position.set(-0.045 + i * 0.03, 0.18, 0);
    g.add(a);
  }
  g.add(pipeX(0.07, 0.25, 0.025));
  g.add(pedestal(0, 0, FLOOR, -0.08, 0.1, 0.1, M.bluePost()));
  return shadowed(g);
}

/**
 * Beam-conditioning section: two large granite blocks carrying scintillator BPMs, clean-up slits and PIN-diode flux
 * monitors in low vacuum (positions on the blocks are illustrative: none are published). Origin = 214.5 m.
 */
export function conditioning(x0: number): THREE.Group {
  const g = new THREE.Group();
  const X = (x: number) => x - x0;
  for (const [a, b] of [COND.b1, COND.b2]) {
    g.add(boxSpan(X(a), X(b), FLOOR + 0.06, COND.top, -COND.halfW, COND.halfW, M.granite(), 0.02));
    // levelling feet
    for (const x of [a + 0.15, b - 0.15]) for (const z of [-0.4, 0.4]) g.add(boxSpan(X(x) - 0.06, X(x) + 0.06, FLOOR, FLOOR + 0.06, z - 0.06, z + 0.06, M.darkSteel(), 0));
  }
  const top = COND.top;
  const bpm = (x: number) => {
    g.add(boxSpan(X(x) - 0.08, X(x) + 0.08, -0.08, 0.08, -0.08, 0.08, M.steel(), 0.01));
    const cam = cyl(0.028, 0.14, M.detector(), 12);
    cam.rotation.x = Math.PI / 2;
    cam.position.set(X(x), 0.0, 0.15);
    const act = cyl(0.02, 0.16, M.blackAnod(), 10);
    act.position.set(X(x), 0.16, 0);
    g.add(cam, act, boxSpan(X(x) - 0.05, X(x) + 0.05, top, -0.08, -0.05, 0.05, M.steel(), 0.004));
  };
  const slit = (x: number) => {
    g.add(boxSpan(X(x) - 0.06, X(x) + 0.06, -0.1, 0.1, -0.1, 0.1, M.steel(), 0.01));
    for (const [y, z] of [[0.17, 0], [-0.0, 0.17], [0, -0.17]] as const) g.add(boxSpan(X(x) - 0.04, X(x) + 0.04, y - 0.06, y + 0.06, z - 0.04, z + 0.04, M.blackAnod(), 0.005));
    g.add(boxSpan(X(x) - 0.05, X(x) + 0.05, top, -0.1, -0.05, 0.05, M.steel(), 0.004));
  };
  const pin = (x: number) => {
    g.add(boxSpan(X(x) - 0.04, X(x) + 0.04, -0.06, 0.06, -0.06, 0.06, M.alu(), 0.006));
    g.add(boxSpan(X(x) - 0.03, X(x) + 0.03, top, -0.06, -0.03, 0.03, M.steel(), 0.003));
  };
  bpm(213.75);
  slit(214.3);
  pin(214.85);
  bpm(216.7);
  slit(217.3);
  pin(217.85);
  g.add(pipeX(X(213.3), X(215.6), 0.025), pipeX(X(216.0), X(218.6), 0.025));
  // blue support posts between the blocks
  for (const x of [215.45]) g.add(pedestal(X(x), 0, FLOOR, -0.03, 0.07, 0.07, M.bluePost()));
  return shadowed(g);
}

export function fastShutter(): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(-0.05, 0.05, -0.06, 0.1, -0.06, 0.06, M.blackAnod(), 0.008));
  const sol = cyl(0.025, 0.08, M.alu(), 12);
  sol.position.set(0, 0.14, 0);
  g.add(sol, pipeX(-0.2, 0.2, 0.025));
  g.add(pedestal(0, 0, FLOOR, -0.06, 0.08, 0.08, M.bluePost()));
  return shadowed(g);
}

/**
 * Granite table + Invar baseplate shared by both chambers, the UHV KB chamber, and the vertical-focusing mirror KBV
 * (404 mm, reflecting UP at 2.5 mrad, as drawn in MEDSI'25 Fig. 5a) on two pitch flexures 300 mm apart, with the two
 * laser-interferometer heads (270 mm apart) reading it from above. Origin = KBV centre (219.604 m).
 */
export function kbChamberAndKBV(): THREE.Group {
  const g = new THREE.Group();
  const X = (x: number) => x - KBV.x;
  // granite table on air-bearing pads, and the Invar (athermal) baseplate — metrology loop 466 mm down to the base
  g.add(boxSpan(X(TABLE.x0), X(TABLE.x1), FLOOR + 0.08, TABLE.top, -TABLE.halfW, TABLE.halfW, M.granite(), 0.02));
  for (const x of [TABLE.x0 + 0.2, TABLE.x1 - 0.2]) for (const z of [-0.42, 0.42]) g.add(boxSpan(X(x) - 0.1, X(x) + 0.1, FLOOR, FLOOR + 0.08, z - 0.08, z + 0.08, M.blackAnod(), 0.005));
  g.add(boxSpan(X(TABLE.x0) + 0.08, X(TABLE.x1) - 0.08, TABLE.top, TABLE.base, -0.5, 0.5, M.invar(), 0.006));
  // UHV optics chamber (cut-away), lid ports, ion pump
  const c = KB_CHAMBER;
  g.add(vesselSpan(X(c.x0), X(c.x1), TABLE.base, c.y1, -c.halfW, c.halfW));
  for (const z of [-c.halfW, c.halfW]) g.add(boxSpan(X(c.x0) - 0.01, X(c.x1), c.y1 - 0.01, c.y1 + 0.012, z - 0.012, z + 0.012, M.steel(), 0.003));
  for (const x of [X(c.x0), X(c.x1) - 0.012]) g.add(boxSpan(x - 0.01, x + 0.012, c.y1 - 0.01, c.y1 + 0.012, -c.halfW, c.halfW, M.steel(), 0.003));
  const pump = cyl(0.075, 0.2, M.steel(), 20);
  pump.position.set(X(219.3), c.y1 + 0.1, -0.12);
  const gauge = cyl(0.02, 0.12, M.steel(), 10);
  gauge.position.set(X(219.62), c.y1 + 0.07, 0.12);
  g.add(pump, gauge, pipeX(X(218.6), X(c.x0), 0.025));
  const fl = flangeX(0.06);
  fl.position.x = X(c.x0);
  g.add(fl);
  // diamond exit window into the 2 mm He gap
  const dw = cyl(0.008, 0.001, M.diamond(), 16);
  dw.rotation.z = Math.PI / 2;
  dw.position.x = X(c.x1);
  g.add(dw);
  // KBV substrate (Si(100)), elliptical-cylinder face up at beam height
  const L = KBV.len;
  g.add(boxSpan(-L / 2, L / 2, -0.045, -0.0008, -0.022, 0.022, M.silicon(), 0.002));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.99, 0.04), M.mirror());
  face.rotation.x = -Math.PI / 2;
  face.position.y = -0.0006;
  g.add(face);
  // holder + two pitch flexures (300 mm lever arm) on Y stages, piezo/picomotor actuators
  g.add(boxSpan(-L / 2 - 0.02, L / 2 + 0.02, -0.075, -0.045, -0.04, 0.04, M.steel(), 0.004));
  for (const s of [-1, 1]) {
    const flex = cyl(0.048, 0.06, M.alu(), 24);
    flex.rotation.x = Math.PI / 2;
    flex.position.set(s * 0.15, -0.13, 0);
    g.add(flex);
    g.add(boxSpan(s * 0.15 - 0.06, s * 0.15 + 0.06, -0.33, -0.178, -0.06, 0.06, M.steel(), 0.006));
    g.add(boxSpan(s * 0.15 - 0.05, s * 0.15 + 0.05, -0.29, -0.21, 0.06, 0.12, M.beige(), 0.004));
    g.add(boxSpan(s * 0.15 - 0.07, s * 0.15 + 0.07, TABLE.base, -0.33, -0.08, 0.08, M.darkSteel(), 0.006));
  }
  // interferometer bracket (outboard) carrying the two laser heads 270 mm apart; retroreflectors 150 mm apart on the holder
  for (const x of [-0.2, 0.2]) {
    g.add(boxSpan(x - 0.012, x + 0.012, TABLE.base, 0.15, 0.19, 0.214, M.invar(), 0.002));
    g.add(boxSpan(x - 0.012, x + 0.012, 0.13, 0.15, 0.04, 0.214, M.invar(), 0.002));
  }
  g.add(boxSpan(-0.212, 0.212, 0.13, 0.15, 0.045, 0.075, M.invar(), 0.002));
  for (const s of [-1, 1]) {
    const head = cyl(0.014, 0.045, M.blackAnod(), 12);
    head.position.set(s * 0.135, 0.108, 0.06);
    g.add(head);
    g.add(boxSpan(s * 0.075 - 0.012, s * 0.075 + 0.012, -0.04, -0.016, 0.042, 0.066, M.alu(), 0.002));
    g.add(beamSeg(v(s * 0.135, 0.085, 0.06), v(s * 0.075, -0.016, 0.054), 0.0012, 0xff3b3b, 3));
  }
  return shadowed(g);
}

/**
 * KBH: 129 mm Si(100) mirror, q = 125.5 mm, ending 61 mm before the focus; carried on a gantry so the sample chamber fits
 * underneath (MEDSI'20). Which side it sits on is not published: drawn OUTBOARD of the beam, face pointing inboard (so it
 * turns the beam 5 mrad inboard).
 * Origin = KBH centre (219.8745 m).
 */
export function kbhOnGantry(): THREE.Group {
  const g = new THREE.Group();
  const L = KBH.len;
  g.add(boxSpan(-L / 2, L / 2, -0.02, 0.02, 0.0008, 0.035, M.silicon(), 0.002));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.98, 0.036), M.mirror());
  face.position.z = 0.0006;
  face.rotation.y = Math.PI;
  g.add(face);
  // holder hanging from the gantry, flexure stage block
  g.add(boxSpan(-L / 2 - 0.01, L / 2 + 0.01, -0.02, 0.06, 0.035, 0.07, M.steel(), 0.003));
  g.add(boxSpan(-0.05, 0.05, 0.06, 0.14, 0.0, 0.09, M.alu(), 0.004));
  g.add(boxSpan(-0.03, 0.03, 0.08, 0.12, 0.09, 0.13, M.beige(), 0.003));
  // gantry bridge over the beam; slim legs at the downstream end so the mirror face stays visible from inboard
  g.add(boxSpan(-0.06, 0.07, 0.14, 0.18, -0.21, 0.21, M.invar(), 0.004));
  for (const z of [-0.2, 0.2]) g.add(boxSpan(0.045, 0.07, TABLE.base, 0.14, z - 0.02, z + 0.02, M.invar(), 0.003));
  return shadowed(g);
}

/** Square scatter-guard pinhole after the KB pair (inside the optics chamber). Origin 219.944 m. */
export function pinhole(): THREE.Group {
  const g = new THREE.Group();
  const plate = boxSpan(-0.001, 0.001, -0.015, 0.015, -0.015, 0.015, M.tungsten(), 0);
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.004), M.hole());
  hole.rotation.y = -Math.PI / 2;
  hole.position.x = -0.0015;
  g.add(plate, hole, boxSpan(-0.004, 0.004, TABLE.base, -0.015, -0.006, 0.006, M.steel(), 0));
  return shadowed(g);
}

/**
 * In-line vacuum optical microscope: a fold mirror with a hole for the X-rays sits on the axis just upstream of the
 * sample; the NIR 10×/0.26 objective looks down onto it and the tube leaves through the chamber lid (purple, as in
 * MEDSI'25 Fig. 4), tilted toward the outboard side as drawn there, clear of the backscatter SDD. Origin 219.972 m.
 */
export function inlineMicroscope(): THREE.Group {
  const g = new THREE.Group();
  const mirror = new THREE.Group();
  mirror.add(boxSpan(-0.001, 0.001, -0.009, 0.009, -0.009, 0.009, M.mirror(), 0));
  const hole = cyl(0.0018, 0.003, M.hole(), 10);
  hole.rotation.z = Math.PI / 2;
  mirror.add(hole);
  mirror.rotation.z = Math.PI / 4;
  g.add(mirror);
  const tilt = (22 * Math.PI) / 180;
  const axis = v(0, Math.cos(tilt), Math.sin(tilt));
  const p = (d: number) => axis.clone().multiplyScalar(d);
  g.add(rod(p(0.025), p(0.07), 0.012, M.blackAnod(), 16)); // objective
  g.add(rod(p(0.07), p(0.5), 0.022, M.purple(), 20)); // tube
  g.add(rod(p(0.32), p(0.32).add(v(0.0, 0.0, -0.09)), 0.016, M.purple(), 12)); // path selector / fibre port (inboard)
  const cam = boxSpan(-0.04, 0.04, -0.035, 0.035, -0.045, 0.045, M.purple(), 0.01);
  cam.position.copy(p(0.56));
  g.add(cam);
  return shadowed(g);
}

/**
 * HV/air sample chamber, the XYZ + rotation scanning stack (Aerotech PRO225SL / ANT130L, APS vertical flexure stage,
 * Micronix PR-160), kinematic holder mount 60 mm below the beam, Invar/Zerodur metrology frame and three of the 15
 * interferometer beams. Origin = focus/sample (220.0 m).
 */
export function sampleChamberAndStack(color: string): THREE.Group {
  const g = new THREE.Group();
  const X = (x: number) => x - SAMPLE_X;
  const c = SAMPLE_CHAMBER;
  g.add(vesselSpan(X(c.x0), X(c.x1), TABLE.base, c.y1, -c.halfW, c.halfW));
  for (const z of [-c.halfW, c.halfW]) {
    g.add(boxSpan(X(c.x0), X(c.x1), c.y1 - 0.012, c.y1, z - 0.006, z + 0.006, M.darkSteel(), 0.002));
    g.add(boxSpan(X(c.x0), X(c.x0) + 0.012, TABLE.base, c.y1, z - 0.006, z + 0.006, M.darkSteel(), 0.002), boxSpan(X(c.x1) - 0.012, X(c.x1), TABLE.base, c.y1, z - 0.006, z + 0.006, M.darkSteel(), 0.002));
  }
  for (const x of [X(c.x0), X(c.x1) - 0.012]) g.add(boxSpan(x, x + 0.012, c.y1 - 0.012, c.y1, -c.halfW, c.halfW, M.darkSteel(), 0.002));
  // diamond entrance window
  const dw = cyl(0.008, 0.001, M.diamond(), 16);
  dw.rotation.z = Math.PI / 2;
  dw.position.x = X(c.x0);
  g.add(dw);
  // scanning stack
  g.add(boxSpan(-0.16, 0.16, TABLE.base, -0.36, -0.13, 0.13, M.blackAnod(), 0.008)); // PRO225SL (along beam)
  g.add(boxSpan(-0.11, 0.11, -0.36, -0.28, -0.11, 0.11, M.blackAnod(), 0.006)); // ANT130L (transverse)
  g.add(boxSpan(-0.08, 0.08, -0.28, -0.155, -0.08, 0.08, M.alu(), 0.006)); // vertical flexure stage
  const rotStage = cyl(0.075, 0.05, M.darkSteel(), 32);
  rotStage.position.y = -0.13;
  const mount = cyl(0.03, 0.012, M.steel(), 20);
  mount.position.y = -0.06;
  const post = cyl(0.004, 0.055, M.steel(), 10);
  post.position.y = -0.03;
  g.add(rotStage, mount, post, boxSpan(-0.02, 0.02, -0.105, -0.066, -0.02, 0.02, M.steel(), 0.003));
  // sample (glowing pin-head)
  g.add(boxSpan(-0.0015, 0.0015, -0.004, 0.004, -0.004, 0.004, M.sample(), 0));
  // metrology frame (Invar) with interferometer heads and three beams to the holder reference
  const inv = M.invar();
  g.add(bar(v(0.13, -0.32, -0.15), v(0.13, -0.02, -0.15), 0.018, inv), bar(v(0.13, -0.32, 0.15), v(0.13, -0.02, 0.15), 0.018, inv));
  g.add(bar(v(0.13, -0.02, -0.16), v(0.13, -0.02, 0.16), 0.018, inv));
  g.add(bar(v(-0.12, -0.32, 0.17), v(0.14, -0.32, 0.17), 0.018, inv));
  for (const [a, b] of [
    [v(0.12, -0.05, 0.0), v(0.022, -0.05, 0.0)],
    [v(0.0, -0.05, 0.16), v(0.0, -0.05, 0.022)],
    [v(0.12, -0.085, 0.07), v(0.022, -0.085, 0.012)],
  ] as const) {
    g.add(beamSeg(a, b, 0.001, 0xff3b3b, 3));
    const head = cyl(0.008, 0.025, M.blackAnod(), 10);
    head.position.copy(a);
    head.quaternion.setFromUnitVectors(v(0, 1, 0), b.clone().sub(a).normalize());
    g.add(head);
  }
  g.add(boxSpan(-0.022, 0.022, -0.064, -0.036, -0.022, 0.022, M.steel(), 0.003)); // reference cube on the holder
  // Be dome window on the downstream face, axis 10° up / 25° outboard (152 mm clear aperture)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.076, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.be());
  const dAxis = v(XRD_DIR.x, XRD_DIR.y, XRD_DIR.z);
  const tExit = (X(c.x1) - 0.005) / dAxis.x;
  dome.position.copy(dAxis.clone().multiplyScalar(tExit));
  dome.quaternion.setFromUnitVectors(v(0, 1, 0), dAxis);
  g.add(dome);
  // forward-beam exit port
  const port = flangeX(0.03, M.steel(), 0.015);
  port.position.x = X(c.x1) + 0.008;
  g.add(port);
  void color;
  return shadowed(g);
}

/**
 * In situ holder at the focus (Hummingbird gas/heating cell shown: two gas inlets, four bias channels, to 1000 °C):
 * ≤24 mm envelope around the sample with its gas lines and bias leads running to a chamber feedthrough.
 */
export function inSituCell(): THREE.Group {
  const g = new THREE.Group();
  const shell = cyl(0.012, 0.03, new THREE.MeshPhysicalMaterial({ color: 0xd9a35a, roughness: 0.3, metalness: 0.6, transparent: true, opacity: 0.45, depthWrite: false }), 24);
  shell.position.y = -0.006;
  g.add(shell);
  const winMat = M.diamond();
  for (const x of [-0.0125, 0.0125]) {
    const w = cyl(0.004, 0.0008, winMat, 12);
    w.rotation.z = Math.PI / 2;
    w.position.x = x;
    g.add(w);
  }
  // gas lines (PEEK) and bias leads to the chamber wall (inboard feedthrough)
  const tube = new THREE.MeshStandardMaterial({ color: 0xc8a978, roughness: 0.6 });
  for (const [k, m, r] of [[0, tube, 0.002], [1, tube, 0.002], [2, M.copper(), 0.0012]] as const) {
    const curve = new THREE.CatmullRomCurve3([v(0.01, -0.02, -0.005 + k * 0.005), v(0.05, -0.06, -0.06 + k * 0.01), v(0.1, -0.08, -0.2), v(0.14, -0.1, -0.33)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, r, 6), m));
  }
  return shadowed(g);
}

/**
 * Fluorescence detectors. The 7-element SDD (orange body, Xspress3 readout) looks at the sample at 90° on the OUTBOARD side
 * in the horizontal plane (the polarisation plane, where elastic scatter is weakest): long snout through the chamber wall
 * to ~30 mm from the sample. The 12-element backscatter SDD (pink) views the sample from above-inboard-upstream, just
 * behind the KB exit (MEDSI'25 Fig. 4), its cold finger rising through the lid. Origin = 7-element body centre, 0.52 m
 * outboard of the sample; the sample is at local (0, 0, −0.52).
 */
export function fluorescenceDetectors(): THREE.Group {
  const g = new THREE.Group();
  const S = v(0, 0, -XRF.bodyCentre);
  const d = (dist: number) => S.clone().add(v(0, 0, dist));
  // Be window cap, long snout through the chamber wall, wider nose and mounting flange (as drawn in MEDSI'25 Fig. 4)
  g.add(rod(d(XRF.snoutTip), d(XRF.snoutTip + 0.01), 0.021, M.be(), 20));
  g.add(rod(d(XRF.snoutTip + 0.01), d(0.36), 0.024, M.orange(), 24));
  g.add(rod(d(0.36), d(XRF.bodyFace - 0.025), 0.042, M.orange(), 24));
  g.add(rod(d(XRF.bodyFace - 0.025), d(XRF.bodyFace), 0.075, M.orangeDark(), 32));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bolt = cyl(0.005, 0.03, M.steel(), 8);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.copy(d(XRF.bodyFace - 0.012)).add(v(Math.cos(a) * 0.062, Math.sin(a) * 0.062, 0));
    g.add(bolt);
  }
  // preamplifier body: an upright slab, face toward the sample
  const hd = XRF.bodyDepth / 2;
  g.add(boxSpan(-0.11, 0.11, -0.17, 0.23, -hd, hd, M.orange(), 0.015));
  // signal / power cables to the Xspress3 rack (leaving the top)
  const cab = new THREE.CatmullRomCurve3([v(0.04, 0.23, 0), v(0.05, 0.33, 0.04), v(0.02, 0.42, 0.16), v(-0.05, 0.46, 0.3)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(cab, 16, 0.007, 6), M.blackAnod()));
  // floor stand just outboard of the granite table (post behind the body, bracket under it)
  const zp = hd + 0.02;
  g.add(boxSpan(-0.09, 0.09, -0.19, -0.17, -hd, zp + 0.03, M.darkSteel(), 0.003));
  g.add(boxSpan(-0.03, 0.03, FLOOR, -0.19, zp - 0.03, zp + 0.03, M.darkSteel(), 0.004));
  g.add(boxSpan(-0.13, 0.13, FLOOR, FLOOR + 0.025, zp - 0.1, zp + 0.14, M.darkSteel(), 0.002));
  // backscatter SDD head + cold finger up through the lid
  const bd = v(BSDD_DIR.x, BSDD_DIR.y, BSDD_DIR.z).normalize();
  const h0 = S.clone().addScaledVector(bd, 0.05);
  const h1 = S.clone().addScaledVector(bd, 0.095);
  g.add(rod(h0, h1, 0.016, M.pink(), 16));
  const tiltUp = v(0, 1, -0.35).normalize();
  const top = h1.clone().addScaledVector(tiltUp, 0.42);
  g.add(rod(h1, top, 0.01, M.pink(), 12));
  const body = boxSpan(-0.035, 0.035, -0.05, 0.05, -0.035, 0.035, M.pink(), 0.008);
  body.position.copy(top);
  g.add(body);
  return shadowed(g);
}

/** XBIC/XBIV electrometer (CAEN ELS TetrAMM) on the baseplate beside the sample chamber, cabled to a feedthrough. */
export function electrometer(): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(-0.08, 0.08, -0.022, 0.022, -0.05, 0.05, new THREE.MeshStandardMaterial({ color: 0x2b6cb0, roughness: 0.4, metalness: 0.5 }), 0.004));
  for (let i = 0; i < 4; i++) {
    const c = cyl(0.005, 0.01, M.alu(), 8);
    c.rotation.z = Math.PI / 2;
    c.position.set(0.085, 0, -0.03 + i * 0.02);
    g.add(c);
  }
  const curve = new THREE.CatmullRomCurve3([v(0.09, 0, 0), v(0.13, 0.04, 0.03), v(0.08, 0.14, 0.07), v(-0.02, 0.26, 0.07)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.003, 6), M.blackAnod()));
  return shadowed(g);
}

/**
 * EIGER2 X 1M (77 × 80 mm) on a Stäubli TX2-160L arm, viewing the sample through the Be dome along its axis (10° up,
 * 25° outboard), face 0.62 m from the sample. The arm pose is solved here (two-link IK: 825 / 625 mm links) from the
 * robot pedestal outboard-downstream of the chamber. Origin = detector face centre.
 */
export function robotXrd(color: string): THREE.Group {
  const g = new THREE.Group();
  const dir = v(XRD_DIR.x, XRD_DIR.y, XRD_DIR.z).normalize();
  const det = detectorHead(0.077, 0.08, 0.25, detectorFace('spots', color), M.detector());
  faceToward(det, dir.clone().negate());
  g.add(det);
  // world → local offsets (origin = detector face)
  const O = v(XRD.x, XRD.up, XRD.side);
  const L = (p: THREE.Vector3) => p.clone().sub(O);
  const base = v(ROBOT.x, FLOOR, ROBOT.z);
  const flange = v(SAMPLE_X, 0, SE).addScaledVector(dir, XRD_R + 0.33);
  // pedestal + base + J1
  const ped = cyl(0.24, 0.45, M.greenDark(), 28);
  ped.position.copy(L(base.clone().add(v(0, 0.225, 0))));
  const j1 = cyl(0.2, 0.25, M.green(), 28);
  j1.position.copy(L(base.clone().add(v(0, 0.575, 0))));
  g.add(ped, j1);
  const toF = v(flange.x - base.x, 0, flange.z - base.z);
  const az = toF.clone().normalize();
  const shoulder = base.clone().add(v(0, 0.98, 0)).addScaledVector(az, 0.15);
  const sw = flange.clone().sub(shoulder);
  const horiz = Math.hypot(sw.x, sw.z);
  const D = sw.length();
  const L1 = 0.825;
  const L2 = 0.625;
  const a = Math.acos(Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)));
  const el = Math.atan2(sw.y, horiz) + a;
  const elbow = shoulder.clone().addScaledVector(az, Math.cos(el) * L1).add(v(0, Math.sin(el) * L1, 0));
  // links and joints
  g.add(rod(L(base.clone().add(v(0, 0.7, 0))), L(shoulder), 0.15, M.green(), 20));
  g.add(rod(L(shoulder), L(elbow), 0.11, M.green(), 20));
  g.add(rod(L(elbow), L(flange), 0.08, M.green(), 18));
  for (const [p, r] of [[shoulder, 0.16], [elbow, 0.12]] as const) {
    const j = cyl(r, 0.24, M.green(), 24);
    j.position.copy(L(p));
    j.quaternion.setFromUnitVectors(v(0, 1, 0), v(-az.z, 0, az.x));
    g.add(j);
  }
  // wrist + adapter plate to the detector back
  const back = dir.clone().multiplyScalar(0.25);
  g.add(rod(L(flange), back.clone().addScaledVector(dir, 0.02), 0.045, M.greenDark(), 16));
  return shadowed(g);
}

/**
 * Ptychography / SAXS EIGER2 X 1M on an XYZ carriage that travels 6 m along the green table (MEDSI'25 Fig. 3), shown
 * mid-travel at 223 m; cable chain alongside. Origin = detector face centre.
 */
export function ptychoTable(color: string): THREE.Group {
  const g = new THREE.Group();
  const X = (x: number) => x - PTYCHO.detX;
  const t0 = X(PTYCHO.tableX0);
  const t1 = X(PTYCHO.tableX1);
  // green girder table with darker rails, two pedestal supports
  g.add(boxSpan(t0, t1, PTYCHO.top - 0.36, PTYCHO.top - 0.05, -0.3, 0.3, M.green(), 0.02));
  for (const z of [-0.18, 0.18]) g.add(boxSpan(t0 + 0.05, t1 - 0.05, PTYCHO.top - 0.05, PTYCHO.top, z - 0.025, z + 0.025, M.steel(), 0.004));
  for (const x of [t0 + 1.0, t1 - 1.0]) g.add(boxSpan(x - 0.35, x + 0.35, FLOOR, PTYCHO.top - 0.36, -0.35, 0.35, M.blackAnod(), 0.01));
  // cable chain along the inboard side
  g.add(boxSpan(t0 + 0.2, t1 - 0.2, PTYCHO.top - 0.05, PTYCHO.top + 0.02, -0.3, -0.24, M.blackAnod(), 0.004));
  // carriage + XYZ stack; the head is centred on the direct beam, which the KB pair tips up and inboard (KB_EXIT)
  const dUp = KB_EXIT.up * (PTYCHO.detX - SAMPLE_X);
  const dSide = KB_EXIT.side * (PTYCHO.detX - SAMPLE_X);
  g.add(boxSpan(-0.25, 0.25, PTYCHO.top, PTYCHO.top + 0.08, -0.26, 0.26, M.alu(), 0.008));
  g.add(boxSpan(-0.12, 0.2, PTYCHO.top + 0.08, -0.16, -0.14, 0.14, M.darkSteel(), 0.008));
  g.add(boxSpan(-0.06, 0.18, -0.16, -0.055 + dUp, dSide - 0.08, dSide + 0.08, M.alu(), 0.006));
  const det = detectorHead(0.077, 0.08, 0.26, detectorFace('speckle', color), M.detector());
  det.position.set(0, dUp, dSide);
  g.add(det);
  return shadowed(g);
}

/** Mono beamstop (19ID-BS-1) against the downstream wall, on its own floor stand (the wall is drawn cut below beam height). Origin 227.0 m. */
export function beamstop(): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(-0.06, 0.12, -0.08, 0.08, -0.08, 0.08, M.tungsten(), 0.01));
  g.add(boxSpan(0.12, 0.19, -0.16, 0.16, -0.16, 0.16, M.steel(), 0.006));
  g.add(pedestal(0.06, 0, FLOOR, -0.16, 0.16, 0.2, M.darkSteel()));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.01, 16), M.hole());
  dot.rotation.y = -Math.PI / 2;
  dot.position.x = -0.061;
  g.add(dot);
  return shadowed(g);
}

