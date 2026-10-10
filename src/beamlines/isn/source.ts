import * as THREE from 'three';
import { mats, glowMaterial, COLORS } from '../../scene/palette';
import { FLOOR, UND } from './geom';
import { M, boxSpan, cyl, flangeX, pedestal, pipeX, shadowed, vesselSpan } from './kit';

/**
 * Source and front end of 19-ID: two in-line revolver undulators (APS21R25 #1/#2) with a phase shifter between them, and a
 * schematic windowless high-heat-load front end running to the ratchet wall.
 */

const jawRed = () => new THREE.MeshStandardMaterial({ color: 0xc94b4b, roughness: 0.45, metalness: 0.4 });
const jawBlue = () => new THREE.MeshStandardMaterial({ color: 0x3c6fd1, roughness: 0.45, metalness: 0.4 });
const dimMat = new THREE.MeshStandardMaterial({ color: 0x7c7f8a, roughness: 0.5, metalness: 0.5 });

/** one magnet array of N half-period blocks along X, alternating magnet / pole colours */
function magnetArray(L: number, periodMm: number, h: number, w: number, magnet: THREE.Material, pole: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const n = Math.round((L * 1000) / (periodMm / 2));
  const bw = L / n;
  const geo = new THREE.BoxGeometry(bw * 0.9, h, w);
  const a = new THREE.InstancedMesh(geo, magnet, Math.ceil(n / 2));
  const b = new THREE.InstancedMesh(geo, pole, Math.ceil(n / 2));
  const d = new THREE.Object3D();
  let ia = 0;
  let ib = 0;
  for (let i = 0; i < n; i++) {
    d.position.set(-L / 2 + (i + 0.5) * bw, 0, 0);
    d.updateMatrix();
    if (i % 2 === 0) a.setMatrixAt(ia++, d.matrix);
    else b.setMatrixAt(ib++, d.matrix);
  }
  a.count = ia;
  b.count = ib;
  g.add(a, b);
  return g;
}

/**
 * Revolver undulator: upper and lower magnet holders each carry two structures (2.1 cm × 112 periods and 2.5 cm × 94
 * periods) on opposite faces; turning the holders swaps which one faces the 8.5 mm gap. Drawn with the U21 structure
 * in the gap and the U25 structure on the outer faces. C-frame strongback on the outboard side.
 */
export function revolverUndulator(): THREE.Group {
  const g = new THREE.Group();
  const L = UND.len;
  const gap = 0.0085;
  const bh = 0.045;
  const bw = 0.06;
  for (const s of [1, -1]) {
    // holder (rotating drum, square section) centred on its axis
    const axisY = s * (gap / 2 + bh + 0.05);
    const holder = boxSpan(-L / 2, L / 2, axisY - 0.05, axisY + 0.05, -0.06, 0.06, M.alu(), 0.012);
    g.add(holder);
    const active = magnetArray(L * 0.985, 21, bh, bw, s > 0 ? jawRed() : jawBlue(), mats.steel());
    active.position.y = s * (gap / 2 + bh / 2);
    const spare = magnetArray(L * 0.985, 25, bh, bw, dimMat, mats.darkSteel());
    spare.position.y = axisY + s * (0.05 + bh / 2);
    g.add(active, spare);
    // revolver drive at each end
    for (const e of [-1, 1]) {
      const drive = cyl(0.075, 0.08, M.darkSteel(), 24);
      drive.rotation.z = Math.PI / 2;
      drive.position.set(e * (L / 2 + 0.05), axisY, 0);
      g.add(drive);
    }
    // girder to the C-frame
    g.add(boxSpan(-L / 2 + 0.05, L / 2 - 0.05, axisY + s * 0.02 - 0.03, axisY + s * 0.02 + 0.03, 0.06, 0.42, M.darkSteel(), 0.01));
  }
  // C-frame strongback (outboard), gap drives on top
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3f6f9a, roughness: 0.6, metalness: 0.3 });
  g.add(boxSpan(-L / 2 + 0.1, L / 2 - 0.1, -0.55, 0.55, 0.42, 0.66, frameMat, 0.03));
  g.add(boxSpan(-L / 2 + 0.1, L / 2 - 0.1, 0.42, 0.55, 0.06, 0.66, frameMat, 0.02));
  g.add(boxSpan(-L / 2 + 0.1, L / 2 - 0.1, -0.55, -0.42, 0.06, 0.66, frameMat, 0.02));
  for (const x of [-L / 3, L / 3]) {
    const m = cyl(0.06, 0.18, M.darkSteel(), 16);
    m.position.set(x, 0.64, 0.5);
    g.add(m);
  }
  // flat aluminium ID vacuum chamber through the gap, and the electron beam
  g.add(boxSpan(-L / 2 - 0.15, L / 2 + 0.15, -0.003, 0.003, -0.04, 0.04, M.alu(), 0.001));
  const e = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, L + 0.3, 6), glowMaterial(COLORS.electron, 5));
  e.rotation.z = Math.PI / 2;
  g.add(e);
  g.add(pedestal(0, 0.3, FLOOR, -0.55, L * 0.7, 0.9, M.darkSteel()));
  return shadowed(g);
}

/** Short electromagnetic phase shifter between the two devices (as-built form not published: generic chicane magnet). */
export function phaseShifter(): THREE.Group {
  const g = new THREE.Group();
  const yoke = M.darkSteel();
  g.add(boxSpan(-0.06, 0.06, 0.03, 0.16, -0.1, 0.12, yoke, 0.01));
  g.add(boxSpan(-0.06, 0.06, -0.16, -0.03, -0.1, 0.12, yoke, 0.01));
  g.add(boxSpan(-0.06, 0.06, -0.16, 0.16, 0.12, 0.2, yoke, 0.01));
  for (const s of [1, -1]) {
    const coil = boxSpan(-0.07, 0.07, s * 0.035, s * 0.09, -0.07, 0.09, M.copper(), 0.01);
    g.add(coil);
  }
  g.add(boxSpan(-0.08, 0.08, -0.003, 0.003, -0.04, 0.04, M.alu(), 0.001));
  g.add(pedestal(0, 0.05, FLOOR, -0.16, 0.12, 0.3, M.darkSteel()));
  return shadowed(g);
}

/**
 * Schematic HHL front end (built around the component origin at 20 m): masks, photon and safety shutters, the GRID XBPM
 * and the windowless differential-pumping exit, from ~13.5 m to the ratchet wall at ~23.8 m. Individual positions for
 * 19-ID are not published; the order follows FDR ch. 3 (r2).
 */
export function frontEndTrain(x0: number): THREE.Group {
  const g = new THREE.Group();
  const X = (x: number) => x - x0;
  g.add(pipeX(X(13.5), X(22.9), 0.035));
  const copperBlock = (x: number, len: number) => {
    const b = boxSpan(X(x) - len / 2, X(x) + len / 2, -0.17, 0.17, -0.17, 0.17, M.copper(), 0.02);
    g.add(b, pedestal(X(x), 0, FLOOR, -0.17, len * 0.8, 0.3, M.darkSteel()));
  };
  const shutterBox = (x: number, hgt: number) => {
    g.add(boxSpan(X(x) - 0.22, X(x) + 0.22, -0.22, hgt, -0.22, 0.22, M.yellow(), 0.02));
    g.add(boxSpan(X(x) - 0.23, X(x) + 0.23, hgt, hgt + 0.05, -0.23, 0.23, M.darkSteel(), 0.01));
    g.add(pedestal(X(x), 0, FLOOR, -0.22, 0.36, 0.36, M.darkSteel()));
  };
  copperBlock(14.4, 0.45); // burn-through fixed mask
  shutterBox(15.6, 0.45); // photon shutter + IM1
  // GRID XBPM1: small cross with blade feedthroughs
  g.add(boxSpan(X(16.7) - 0.1, X(16.7) + 0.1, -0.1, 0.1, -0.1, 0.1, M.steel(), 0.01));
  for (const [y, z] of [[0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]]) {
    const f = cyl(0.03, 0.1, M.steel(), 12);
    f.position.set(X(16.7), y, z);
    if (z) f.rotation.x = Math.PI / 2;
    g.add(f);
  }
  g.add(pedestal(X(16.7), 0, FLOOR, -0.1, 0.16, 0.16, M.darkSteel()));
  shutterBox(18.4, 0.6); // safety shutter 1
  shutterBox(19.2, 0.6); // safety shutter 2
  copperBlock(20.8, 0.35); // fixed mask
  // windowless exit: differential-pumping section (narrow tubes + small ion pumps below)
  for (let i = 0; i < 3; i++) {
    const x = 21.9 + i * 0.32;
    const f = flangeX(0.06);
    f.position.x = X(x) - 0.12;
    g.add(f, pipeX(X(x) - 0.12, X(x) + 0.12, 0.045, M.steel()));
    g.add(boxSpan(X(x) - 0.08, X(x) + 0.08, -0.36, -0.08, -0.1, 0.1, M.steel(), 0.01));
  }
  for (const x of [14.0, 17.5, 20.0, 22.6]) g.add(pedestal(X(x), 0, FLOOR, -0.04, 0.08, 0.12, M.steel()));
  return shadowed(g);
}

/** Ratchet (tunnel shield) wall slab where the beam leaves the tunnel, cut away at 2 m height (museum convention). */
export function ratchetWall(x0: number): THREE.Group {
  const g = new THREE.Group();
  const X = (x: number) => x - x0;
  const top = 0.6;
  // concrete with a collimated pass-through for the beam pipe
  g.add(boxSpan(X(22.95), X(23.85), FLOOR, -0.12, -1.6, 1.3, M.concrete(), 0.01));
  g.add(boxSpan(X(22.95), X(23.85), 0.12, top, -1.6, 1.3, M.concrete(), 0.01));
  g.add(boxSpan(X(22.95), X(23.85), -0.12, 0.12, -1.6, -0.12, M.concrete(), 0.002));
  g.add(boxSpan(X(22.95), X(23.85), -0.12, 0.12, 0.12, 1.3, M.concrete(), 0.002));
  g.add(boxSpan(X(22.95), X(23.85), -0.12, 0.12, -0.12, 0.12, M.lead(), 0.002));
  g.add(pipeX(X(22.9), X(23.9), 0.035));
  return shadowed(g);
}

/** Front-end exit mask (2 × 2 mm², with integrated XBPM2): water-cooled copper block, blade feedthroughs on top. */
export function exitMask(): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(-0.15, 0.15, -0.14, 0.14, -0.14, 0.14, M.copper(), 0.015));
  for (const z of [-0.06, 0.06]) {
    const f = cyl(0.025, 0.12, M.steel(), 12);
    f.position.set(0.08, 0.2, z);
    g.add(f);
  }
  for (const z of [-0.1, 0.1]) {
    const w = cyl(0.01, 0.3, M.steel(), 8);
    w.position.set(-0.05, -0.29, z);
    g.add(w);
  }
  g.add(pedestal(0, 0, FLOOR, -0.14, 0.24, 0.24, M.darkSteel()));
  g.add(pipeX(-0.3, 0.3, 0.03));
  return shadowed(g);
}

/** Generic shielding block / collimator with a small aperture. */
export function shieldBlock(o: { len?: number; w?: number; h?: number; mat?: 'lead' | 'tungsten' | 'copper'; hole?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  const len = o.len ?? 0.2;
  const w = o.w ?? 0.3;
  const h = o.h ?? 0.3;
  const m = o.mat === 'tungsten' ? M.tungsten() : o.mat === 'copper' ? M.copper() : M.lead();
  g.add(boxSpan(-len / 2, len / 2, -h / 2, h / 2, -w / 2, w / 2, m, 0.008));
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(o.hole ?? 0.012, o.hole ?? 0.012), M.hole());
  hole.rotation.y = -Math.PI / 2;
  hole.position.x = -len / 2 - 0.001;
  g.add(hole);
  g.add(pedestal(0, 0, FLOOR, -h / 2, Math.min(len, 0.2), Math.min(w, 0.24), M.darkSteel()));
  return shadowed(g);
}

/** Vacuum enclosure for small items (diagnostic crosses etc.). */
export function smallVessel(len: number, s: number): THREE.Group {
  return vesselSpan(-len / 2, len / 2, -s / 2, s / 2, -s / 2, s / 2);
}


