import * as THREE from 'three';
import { SA } from './geom';
import { beamBetween, box, cyl, cylX, hose, pedestal, pipeX, shadowed, strut, v3, xm } from './kit';
import { detectorHead } from './wa';

/**
 * 8-ID-I small-angle XPCS station. Origins: sample table at the FDR sample position (67.5 m), flight tube at its FDR
 * start (68.0 m), detector at 79.0 m. Beam frame: +X downstream, +Y up (0 = beam), +Z outboard; metres.
 */

const TABLE_TOP = -0.55;

/**
 * Sample-environment table with an Anton Paar MCR 702e TwinDrive rheometer in Couette geometry (beam through the cup
 * centre along the velocity-gradient direction) and, parked inboard, the 9-sample three-zone temperature holder that the
 * table swaps in. The Couette cup (11.4 mm OD) is drawn ×2 for visibility.
 */
export function sampleTableRheometer(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const floor = -beamY;
  // table: heavy frame + top with a lateral (z) translation for quick environment changes
  const frame = box(0.62, TABLE_TOP - 0.06 - floor, 1.4, xm.table(), 0.02);
  frame.position.set(0, (TABLE_TOP - 0.06 + floor) / 2, -0.25);
  const top = box(0.7, 0.06, 1.7, xm.tableTop(), 0.006);
  top.position.set(0, TABLE_TOP - 0.03, -0.25);
  g.add(frame, top);
  for (const z of [-0.95, 0.45]) {
    const rail = box(0.66, 0.025, 0.04, xm.steel(), 0.004);
    rail.position.set(0, TABLE_TOP + 0.012, z);
    g.add(rail);
  }
  // --- rheometer: lower drive (white), measuring cell at beam height, upper drive head on a rear column (outboard)
  const lowerTop = -0.2;
  const lower = box(0.36, lowerTop - TABLE_TOP, 0.34, xm.white(), 0.03);
  lower.position.set(0, (lowerTop + TABLE_TOP) / 2, 0.02);
  const lowerBand = box(0.362, 0.04, 0.342, xm.black(), 0.01);
  lowerBand.position.set(0, lowerTop - 0.05, 0.02);
  const display = box(0.012, 0.09, 0.16, xm.screen(), 0.004);
  display.position.set(-0.185, (lowerTop + TABLE_TOP) / 2 + 0.03, 0.02);
  display.rotation.z = -0.25;
  g.add(lower, lowerBand, display);
  const column = box(0.14, 0.78, 0.1, xm.white(), 0.02);
  column.position.set(0, lowerTop + 0.39, 0.2);
  g.add(column);
  const headY0 = 0.07;
  const head = cyl(0.11, 0.3, xm.white(), 32);
  head.position.set(0, headY0 + 0.15, 0);
  const headCap = cyl(0.112, 0.05, xm.black(), 32);
  headCap.position.set(0, headY0 + 0.3, 0);
  const headArm = box(0.16, 0.16, 0.22, xm.white(), 0.02);
  headArm.position.set(0, headY0 + 0.2, 0.12);
  g.add(head, headCap, headArm);
  // lower drive shaft + Couette cup (transparent polycarbonate) + bob on the upper shaft; beam passes through the cup
  const shaft = cyl(0.01, -0.03 - lowerTop, xm.steel(), 12);
  shaft.position.y = (lowerTop - 0.03) / 2;
  const cup = cyl(0.0114, 0.05, xm.polycarbonate(), 24);
  cup.position.y = -0.005;
  const sampleFluid = cyl(0.0105, 0.04, new THREE.MeshStandardMaterial({ color: 0xf1e4c4, roughness: 0.3, transparent: true, opacity: 0.6 }), 20);
  sampleFluid.position.y = -0.008;
  const bob = cyl(0.008, 0.07, xm.steel(), 16);
  bob.position.y = 0.035;
  const coupling = cyl(0.018, 0.03, xm.darkSteel(), 16);
  coupling.position.y = headY0 - 0.005;
  g.add(shaft, cup, sampleFluid, bob, coupling);
  // --- parked three-zone, 9-sample temperature holder (slides in along z on the same table)
  const holderZ = -0.72;
  const holder = box(0.06, 0.12, 0.3, xm.copper(), 0.008);
  holder.position.set(0, 0, holderZ);
  g.add(holder);
  for (let zone = 0; zone < 3; zone++) {
    for (let s = 0; s < 3; s++) {
      const win = cylX(0.008, 0.062, xm.kapton(), 12);
      win.position.set(0, 0.03 * (s - 1), holderZ - 0.1 + zone * 0.1);
      g.add(win);
    }
    const sep = box(0.064, 0.125, 0.006, xm.black(), 0.001);
    sep.position.set(0, 0, holderZ - 0.05 + zone * 0.1);
    if (zone < 2) g.add(sep);
  }
  const holderPost = box(0.08, -0.06 - TABLE_TOP, 0.1, xm.steel(), 0.005);
  holderPost.position.set(0, (TABLE_TOP - 0.06) / 2, holderZ);
  g.add(holderPost, hose([v3(0, 0.06, holderZ - 0.12), v3(0, 0.25, holderZ - 0.2), v3(0.1, 0.3, holderZ - 0.5)], 0.01, xm.waterHose()));
  return shadowed(g);
}

/** Radii of the three telescoping sections and their local x-extents (origin at 68.0 m). */
const SECTIONS: [number, number, number][] = [
  [0.32, 4.05, 0.19],
  [3.95, 7.65, 0.22],
  [7.55, 10.85, 0.25],
];
const TUBE_END = 10.85;
const TRUSS = { x0: 0.25, x1: 11.6, top: -0.36, bot: -0.84, half: 0.2 };
const PEDESTALS = [1.2, 10.4];

/**
 * The hero: 12 m-class telescoping vacuum flight path on a truss (2021 elevation), cut away along the top so the
 * scattered X-rays and the in-vacuum beam stop are visible. Kapton exit window at the downstream end. The truss
 * extends past the window to carry the detector platform.
 */
export function flightTube(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const floor = -beamY;
  // cut-away shell: open 130° window centred on the top (θ measured from +Z toward +Y once the axis lies along X), so the
  // inside reads from any raised viewpoint on either side of the hutch
  const open0 = (25 * Math.PI) / 180;
  const openLen = (130 * Math.PI) / 180;
  const outer = xm.tubeOutside();
  const inner = xm.tubeInside();
  const cutEdge = xm.steel();
  for (const [a, b, r] of SECTIONS) {
    // CylinderGeometry puts x = r·sinθ, z = r·cosθ; after rotation.z = π/2 that is world y = r·sinθ, z = r·cosθ,
    // so θ is the angle from +Z (outboard) toward +Y (up) and the shell spans everything except the top window.
    const geo = new THREE.CylinderGeometry(r, r, b - a, 48, 1, true, open0 + openLen, Math.PI * 2 - openLen);
    for (const m of [outer, inner]) {
      const shell = new THREE.Mesh(geo, m);
      shell.rotation.z = Math.PI / 2;
      shell.position.x = (a + b) / 2;
      g.add(shell);
    }
    // stiffening rings
    const n = Math.max(2, Math.round((b - a) / 0.9));
    for (let i = 0; i <= n; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.012, 0.014, 8, 40), xm.steel());
      ring.rotation.y = Math.PI / 2;
      ring.position.x = a + ((b - a) * i) / n;
      g.add(ring);
    }
    // collar flanges at section joints (telescoping seals)
    for (const x of [a, b]) {
      const f = new THREE.Mesh(new THREE.TorusGeometry(r + 0.016, 0.02, 10, 44), xm.aluDark());
      f.rotation.y = Math.PI / 2;
      f.position.x = x;
      g.add(f);
    }
    // longitudinal cut edges
    for (const th of [open0, open0 + openLen]) {
      const e = cylX(0.013, b - a, cutEdge, 8);
      e.position.set((a + b) / 2, r * Math.sin(th), r * Math.cos(th));
      g.add(e);
    }
  }
  // upstream nose cone, narrow at the small entrance window by the sample and widening to the first section
  // (CylinderGeometry's top (+Y) maps to −X after rotation.z = π/2, so radiusTop is the upstream end)
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.19, 0.32, 40, 1, true), outer);
  nose.rotation.z = Math.PI / 2;
  nose.position.x = 0.16;
  const noseIn = new THREE.Mesh(nose.geometry, inner);
  noseIn.rotation.z = Math.PI / 2;
  noseIn.position.x = 0.16;
  // entrance flange: an annulus around a Kapton window, so the beam visibly enters through the window
  const entranceRing = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.011, 10, 32), xm.darkSteel());
  entranceRing.rotation.y = Math.PI / 2;
  const entrance = cylX(0.036, 0.003, xm.kapton(), 24);
  entrance.position.x = -0.002;
  g.add(nose, noseIn, entranceRing, entrance);
  // downstream end plate with the Kapton exit window
  const endPlate = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.27, 48), xm.darkSteel());
  endPlate.rotation.y = Math.PI / 2;
  endPlate.position.x = TUBE_END;
  const window = cylX(0.17, 0.004, xm.kaptonThin(), 40);
  window.position.x = TUBE_END;
  window.renderOrder = 4;
  g.add(endPlate, window);
  // motorized in-vacuum beam stop (tungsten disk on a rod from the outboard wall), enlarged ×2 for visibility
  const stopX = TUBE_END - 0.25;
  const disk = cylX(0.012, 0.012, xm.tungsten(), 16);
  disk.position.x = stopX;
  const rod = cyl(0.003, 0.25, xm.steel(), 6);
  rod.rotation.x = Math.PI / 2;
  rod.position.set(stopX, 0, 0.125);
  const motor = box(0.08, 0.1, 0.12, xm.black(), 0.006);
  motor.position.set(stopX, 0, 0.31);
  g.add(disk, rod, motor);
  // saddles from the tube to the truss
  for (const x of [0.6, 2.2, 3.8, 5.6, 7.3, 9.0, 10.6]) {
    const r = SECTIONS.find(([a, b]) => x >= a && x <= b)?.[2] ?? 0.22;
    const s = box(0.08, -r - TRUSS.top + 0.01, 0.3, xm.darkSteel(), 0.006);
    s.position.set(x, (TRUSS.top - r) / 2, 0);
    g.add(s);
  }
  g.add(truss());
  // pedestals (the downstream one rides on the swing rail)
  for (const x of PEDESTALS) {
    const p = box(0.5, TRUSS.bot - floor - 0.06, 0.62, xm.baseLight(), 0.02);
    p.position.set(x, (TRUSS.bot - 0.06 + floor) / 2, 0);
    const foot = box(0.7, 0.06, 0.8, xm.darkSteel(), 0.01);
    foot.position.set(x, floor + 0.03, 0);
    g.add(p, foot);
  }
  // detector platform at the downstream end of the truss
  const plat = box(0.9, 0.05, 0.5, xm.darkSteel(), 0.008);
  plat.position.set(11.1, TRUSS.top + 0.025, 0);
  g.add(plat);
  return shadowed(g);
}

/** Warren-truss box girder under the tube (blue in the exhibit palette). */
function truss(): THREE.Group {
  const g = new THREE.Group();
  const m = xm.truss();
  const { x0, x1, top, bot, half } = TRUSS;
  const chords: [number, number][] = [
    [top, -half],
    [top, half],
    [bot, -half],
    [bot, half],
  ];
  for (const [y, z] of chords) g.add(beamBetween(v3(x0, y, z), v3(x1, y, z), 0.05, 0.06, m));
  const n = Math.round((x1 - x0) / 0.6);
  const dx = (x1 - x0) / n;
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * dx;
    for (const z of [-half, half]) {
      g.add(strut(v3(x, top, z), v3(x, bot, z), 0.012, m));
      if (i < n) g.add(strut(v3(x, i % 2 ? top : bot, z), v3(x + dx, i % 2 ? bot : top, z), 0.012, m));
    }
    g.add(strut(v3(x, bot, -half), v3(x, bot, half), 0.01, m));
    g.add(strut(v3(x, top, -half), v3(x, top, half), 0.01, m));
  }
  return g;
}

/** 8-ID-I detector on its XY stage, origin at the detector face (79.0 m). */
export function saDetector(face: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(detectorHead(face));
  const stage = box(0.4, 0.1, 0.36, xm.huber(), 0.008);
  stage.position.set(0.2, -0.2, 0);
  const riser = box(0.3, -0.25 - (TRUSS.top + 0.05), 0.26, xm.darkSteel(), 0.008);
  riser.position.set(0.2, (-0.25 + TRUSS.top + 0.05) / 2, 0);
  g.add(stage, riser);
  return shadowed(g);
}

/** Painted floor arc showing the 0–5° swing of the flight tube about the sample (toward inboard, 2021 plan). */
export function swingArc(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const y = -beamY + 0.045;
  const R = SA.tubeX0 + PEDESTALS[1] - SA.sampleX;
  const geo = new THREE.RingGeometry(R - 0.45, R + 0.45, 24, 1, -SA.swing - 0.01, SA.swing + 0.02);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4a60, roughness: 0.9, transparent: true, opacity: 0.85 });
  const band = new THREE.Mesh(geo, mat);
  band.rotation.x = -Math.PI / 2;
  // RingGeometry lies in XY; after rotation.x = −π/2 its +Y becomes −Z, so positive angles swing toward inboard.
  band.position.y = y;
  g.add(band);
  // dashed centre line of the swung (5°) tube axis
  const pts: THREE.Vector3[] = [];
  const L = SA.detX - SA.sampleX;
  for (let s = 0.6; s < L; s += 0.5) {
    pts.push(v3(s * Math.cos(SA.swing), y + 0.002, -s * Math.sin(SA.swing)));
    pts.push(v3((s + 0.28) * Math.cos(SA.swing), y + 0.002, -(s + 0.28) * Math.sin(SA.swing)));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7fa6d6, transparent: true, opacity: 0.7 })));
  return g;
}

export { pedestal, pipeX };
