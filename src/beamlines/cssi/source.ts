import * as THREE from 'three';
import { glowMaterial, COLORS } from '../../scene/palette';
import { box, cm, cylX, ghostBox, pedestal, shadowed } from './kit';

function electronBeam(len: number): THREE.Mesh {
  const e = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, 6), glowMaterial(COLORS.electron, 5));
  e.rotation.z = Math.PI / 2;
  return e;
}

/**
 * APS21R25#5 revolver undulator (downstream slot). Each jaw carries two magnet arrays at 90° on one strongback:
 * the active U21 arrays (21 mm period, N = 112) face the gap; the parked U25 arrays (25 mm, N = 94) face sideways and
 * are rotated in (at open gap) to reach lower fundamentals. Gap drawn at the 9.0 mm user minimum. The parked arrays
 * are drawn facing inboard and the drive frame outboard (actual orientation not documented).
 */
export function revolverUndulator(beamY: number, L = 2.35): THREE.Group {
  const g = new THREE.Group();
  const gap = 0.009;
  const addArray = (period: number, y: number, z: number, faceUp: boolean, magnetMat: THREE.Material) => {
    const n = Math.round((L * 1000) / (period / 2));
    const w = L / n;
    const geo = faceUp ? new THREE.BoxGeometry(w * 0.9, 0.05, 0.09) : new THREE.BoxGeometry(w * 0.9, 0.09, 0.05);
    const mags = new THREE.InstancedMesh(geo, magnetMat, Math.ceil(n / 2));
    const poles = new THREE.InstancedMesh(geo, cm.pole(), Math.ceil(n / 2));
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
    addArray(21, s * (gap / 2 + 0.025), 0, true, s > 0 ? cm.magnetRed() : cm.magnetBlue());
    const holder = box(L, 0.12, 0.12, cm.darkSteel(), 0.01);
    holder.position.set(0, s * (gap / 2 + 0.11), 0);
    addArray(25, s * (gap / 2 + 0.11), -0.085, false, cm.magnetGreen());
    const web = box(L * 0.96, 0.07, 0.06, cm.darkSteel(), 0.008);
    web.position.set(0, s * (gap / 2 + 0.2), 0.06);
    const girder = box(L * 0.98, 0.12, 0.26, cm.darkSteel(), 0.02);
    girder.position.set(0, s * (gap / 2 + 0.235), 0.17);
    g.add(holder, web, girder);
  }
  const frame = box(L * 0.92, 1.0, 0.24, cm.frameBlue(), 0.03);
  frame.position.set(0, 0, 0.42);
  g.add(frame);
  for (const x of [-L * 0.36, L * 0.36]) {
    const drive = cylX(0.09, 0.16, cm.steel(), 20);
    drive.position.set(x, 0.42, 0.42);
    const motor = box(0.14, 0.14, 0.2, cm.black(), 0.01);
    motor.position.set(x + 0.15, 0.42, 0.42);
    g.add(drive, motor);
  }
  const ped = pedestal(beamY, -0.5, L * 0.7, 0.5, cm.darkSteel());
  ped.position.z = 0.2;
  g.add(ped, electronBeam(L + 0.4));
  return shadowed(g);
}

/**
 * The empty upstream slot of the dual in-line straight: only the ID vacuum chamber runs through it; a ghost outline
 * shows where the planned 2.3 m planar U21 would sit.
 */
export function emptySlot(beamY: number, L = 2.3): THREE.Group {
  const g = new THREE.Group();
  const ghost = ghostBox(L, 0.62, 0.5);
  ghost.position.z = 0.1;
  const chamber = box(L + 0.3, 0.012, 0.07, cm.alu(), 0.003);
  const stand = pedestal(beamY, -0.31, L * 0.6, 0.4, cm.ghost());
  stand.renderOrder = 3;
  const standEdges = new THREE.LineSegments(new THREE.EdgesGeometry(stand.geometry), cm.ghostEdge());
  standEdges.position.copy(stand.position);
  g.add(ghost, chamber, stand, standEdges, electronBeam(L + 0.4));
  return g;
}
