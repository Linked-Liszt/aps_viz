import * as THREE from 'three';
import { glowMaterial, COLORS } from '../../scene/palette';
import { box, cyl, cylX, flangeX, hose, pedestal, pipeX, shadowed, v3, xm } from './kit';

/**
 * APS21R25 revolver undulator: each jaw carries two magnet arrays at 90° on one strongback. The active U21 arrays
 * (21 mm period) face the gap; the parked U25 arrays (25 mm) face sideways, ready to be rotated in (only at open gap).
 * The parked arrays are drawn facing inboard and the drive frame outboard (the real orientation is not documented; this
 * keeps both arrays visible from the aisle-side camera).
 * Magnetic length = N × λu ≈ 2.35 m. Gap drawn at ~9 mm (user minimum gap 9.0 mm), so the jaws nearly touch the e-beam.
 */
export function revolverUndulator(beamY: number, L = 2.35): THREE.Group {
  const g = new THREE.Group();
  const gap = 0.009;
  const addArray = (period: number, y: number, z: number, horizontalFace: boolean, magnetMat: THREE.Material) => {
    const n = Math.round((L * 1000) / (period / 2));
    const w = L / n;
    const blockGeo = horizontalFace ? new THREE.BoxGeometry(w * 0.9, 0.05, 0.09) : new THREE.BoxGeometry(w * 0.9, 0.09, 0.05);
    const mags = new THREE.InstancedMesh(blockGeo, magnetMat, Math.ceil(n / 2));
    const poles = new THREE.InstancedMesh(blockGeo, xm.pole(), Math.ceil(n / 2));
    const d = new THREE.Object3D();
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      d.position.set(-L / 2 + (i + 0.5) * w, y, z);
      d.updateMatrix();
      if (i % 2 === 0) mags.setMatrixAt(a++, d.matrix);
      else poles.setMatrixAt(b++, d.matrix);
    }
    mags.count = a;
    poles.count = b;
    g.add(mags, poles);
  };
  for (const s of [1, -1]) {
    // active U21 array facing the gap
    addArray(21, s * (gap / 2 + 0.025), 0, true, s > 0 ? xm.magnetRed() : xm.magnetBlue());
    // strongback holder (square section) carrying both arrays
    const holder = box(L, 0.12, 0.12, xm.darkSteel(), 0.01);
    holder.position.set(0, s * (gap / 2 + 0.05 + 0.06), 0.0);
    g.add(holder);
    // parked U25 array on the inboard face of the holder
    addArray(25, s * (gap / 2 + 0.11), -0.085, false, xm.magnetGreen());
    // girder
    const girder = box(L * 0.98, 0.12, 0.26, xm.darkSteel(), 0.02);
    girder.position.set(0, s * (gap / 2 + 0.235), 0.17);
    // web joining the holder to the girder
    const web = box(L * 0.96, 0.07, 0.06, xm.darkSteel(), 0.008);
    web.position.set(0, s * (gap / 2 + 0.2), 0.06);
    g.add(web);
    g.add(girder);
  }
  // C-frame and rotation drive on the outboard side
  const frame = box(L * 0.92, 1.0, 0.24, xm.frameBlue(), 0.03);
  frame.position.set(0, 0, 0.42);
  g.add(frame);
  for (const x of [-L * 0.36, L * 0.36]) {
    const drive = cylX(0.09, 0.16, xm.steel(), 20);
    drive.position.set(x, 0.42, 0.42);
    const motor = box(0.14, 0.14, 0.2, xm.black(), 0.01);
    motor.position.set(x + 0.15, 0.42, 0.42);
    g.add(drive, motor);
  }
  const ped = pedestal(beamY, -0.5, L * 0.7, 0.5, xm.darkSteel());
  ped.position.z = 0.2;
  g.add(ped);
  // electron beam through the gap
  const e = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, L + 0.4, 6), glowMaterial(COLORS.electron, 5));
  e.rotation.z = Math.PI / 2;
  g.add(e);
  return shadowed(g);
}

/** Compact electromagnetic phase shifter between the two revolvers (details unpublished): a small dipole with copper coils. */
export function phaseShifter(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const L = 0.12;
  for (const s of [1, -1]) {
    const yoke = box(L, 0.16, 0.3, xm.magnetBlue(), 0.01);
    yoke.position.y = s * 0.12;
    const coil = box(L + 0.04, 0.05, 0.22, xm.coil(), 0.01);
    coil.position.y = s * 0.05;
    g.add(yoke, coil);
  }
  const back = box(L, 0.4, 0.06, xm.magnetBlue(), 0.01);
  back.position.z = 0.17;
  g.add(back, pedestal(beamY, -0.2, 0.1, 0.24, xm.darkSteel()));
  const e = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, L + 0.04, 6), glowMaterial(COLORS.electron, 5));
  e.rotation.z = Math.PI / 2;
  g.add(e);
  return shadowed(g);
}

/**
 * Windowless high-heat-load front end as a train of parts in the FDR order (Ch. 3, Sec. 3-2.1): clearing magnet, low-power
 * photon shutter, storage-ring valve, burn-through fixed mask BTFM1, fixed mask FM2, collimator, GRID XBPM1, fixed mask FM3,
 * photon shutter PS2 with intensity monitor IM1, safety shutters SS1/SS2, differential-pumping section (no window) and the
 * front-end valve. The FDR does not tabulate positions: the parts are spread over ~14.4–23.6 m (dossier: FE occupies
 * ~14–25 m), so spacing is approximate. Origin at the component's dossier distance (20.0 m), beam frame.
 */
export function frontEndTrain(beamY: number, x0 = 20.0): THREE.Group {
  const g = new THREE.Group();
  const X = (x: number) => x - x0;
  const put = (o: THREE.Object3D, x: number, y = 0, z = 0) => {
    o.position.set(X(x), y, z);
    g.add(o);
    return o;
  };
  const stand = (x: number, top: number, w = 0.2, d = 0.22) => put(pedestal(beamY, top, w, d, xm.darkSteel()), x, pedestalY(beamY, top));
  // continuous UHV pipe from the tunnel to the exit mask in 8-ID-A (no window anywhere: coherence is preserved)
  g.add(pipeX(X(14.15), X(25.25), 0.03));
  for (const x of [14.15, 16.0, 18.45, 22.2, 24.0]) put(flangeX(0, 0.055), x);
  // clearing magnet: C-shaped yoke + coils (sweeps stray electrons out of the X-ray path)
  put(box(0.3, 0.44, 0.1, xm.frameBlue(), 0.015), 14.6, 0, 0.17);
  for (const sy of [1, -1]) {
    put(box(0.3, 0.12, 0.3, xm.frameBlue(), 0.015), 14.6, sy * 0.16, 0.04);
    put(box(0.22, 0.05, 0.24, xm.coil(), 0.008), 14.6, sy * 0.075, 0.02);
  }
  stand(14.6, -0.22, 0.24, 0.3);
  // low-power photon shutter (LPPS) and storage-ring gate valve, each with a pneumatic actuator on top
  put(box(0.16, 0.24, 0.18, xm.shutterYellow(), 0.01), 15.25, 0.02);
  put(cyl(0.035, 0.22, xm.steel(), 14), 15.25, 0.25);
  put(box(0.09, 0.3, 0.2, xm.aluDark(), 0.008), 15.75, 0.04);
  put(cyl(0.04, 0.2, xm.steel(), 14), 15.75, 0.29);
  stand(15.5, -0.12, 0.7, 0.2);
  // water-cooled copper masks (BTFM1 long, FM2, FM3) and a heavy-metal collimator
  const mask = (x: number, len: number) => {
    put(box(len, 0.26, 0.26, xm.copper(), 0.015), x);
    for (const z of [-0.06, 0.06]) put(hose([v3(0, -0.13, z), v3(0.02, -0.4, z), v3(0.08, -0.6, z * 2)], 0.012, xm.waterHose()), x - len / 3);
    stand(x, -0.13, len * 0.7, 0.22);
  };
  mask(16.55, 0.5);
  mask(17.5, 0.36);
  put(box(0.24, 0.3, 0.3, xm.tungsten(), 0.01), 18.15);
  stand(18.15, -0.15, 0.2, 0.24);
  // GRID XBPM1: small cube with four blade feedthroughs
  put(box(0.16, 0.16, 0.16, xm.steel(), 0.01), 18.85);
  for (const [y, z] of [[0.13, 0], [-0.13, 0], [0, 0.13], [0, -0.13]] as const) {
    const f = cyl(0.028, 0.1, xm.alu(), 12);
    if (z) f.rotation.x = Math.PI / 2;
    put(f, 18.85, y, z);
  }
  stand(18.85, -0.18, 0.14, 0.14);
  mask(19.5, 0.32);
  // photon shutter PS2 (+ IM1) and the two safety shutters: tall yellow bodies with actuator housings on top
  const shutterBody = (x: number, top: number) => {
    put(box(0.4, top + 0.22, 0.4, xm.shutterYellow(), 0.02), x, (top - 0.22) / 2);
    put(box(0.42, 0.05, 0.42, xm.darkSteel(), 0.01), x, top + 0.025);
    put(cyl(0.05, 0.16, xm.steel(), 16), x, top + 0.13);
    stand(x, -0.22, 0.34, 0.34);
  };
  shutterBody(20.35, 0.42);
  shutterBody(21.25, 0.55);
  shutterBody(21.85, 0.55);
  // windowless exit: differential-pumping stages (short narrow tubes with ion pumps hanging below) and the FE valve
  for (let i = 0; i < 3; i++) {
    const x = 22.55 + i * 0.32;
    put(cylX(0.05, 0.2, xm.steel(), 18), x);
    put(cyl(0.07, 0.24, xm.alu(), 18), x, -0.17);
  }
  stand(22.87, -0.29, 0.9, 0.18);
  put(box(0.09, 0.3, 0.2, xm.aluDark(), 0.008), 23.55, 0.04);
  put(cyl(0.04, 0.2, xm.steel(), 14), 23.55, 0.29);
  stand(23.55, -0.12, 0.12, 0.18);
  return shadowed(g);
}

/** pedestal() builds its mesh already offset in y; keep it there (helper for the train's `stand`). */
function pedestalY(beamY: number, top: number): number {
  const h = Math.max(0.05, top + beamY);
  return -beamY + h / 2;
}
