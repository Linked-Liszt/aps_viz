import * as THREE from 'three';
import { glowMaterial, COLORS } from '../../scene/palette';
import { M, box, boxRow, boxSpan, cyl, ghostBox, pipeX, shadowed } from './kit';
import { FLOOR, UND } from './geom';

/**
 * Revolver undulator APS21R25#3 (as built, Sep 2026): ONE 2.35 m planar hybrid device in the downstream half of the
 * Sector 33 straight. Each jaw carries two magnet structures 90° apart on a rotating holder; the 2.1 cm structure faces
 * the beam (gap drawn at the 8.9 mm user minimum), the 2.5 cm structure faces inboard. Origin = device centre on axis.
 */
export function revolverUndulator(): THREE.Group {
  const g = new THREE.Group();
  const L = UND.length;
  const gap = 0.0089;
  const half = (p: number) => Math.round((L * 1000) / (p / 2));
  // Per jaw: the active 2.1 cm structure faces the beam; the 2.5 cm structure sits on the INBOARD face of the same
  // The other magnet array is 90° away on the rotating holder. A 90° rotation with the gap open swaps the arrays.
  for (const s of [1, -1]) {
    const yFace = s * (gap / 2);
    const n = half(21);
    const bw = L / n;
    const mag = boxRow(Math.ceil(n / 2), (i, o) => o.position.set(-L / 2 + (2 * i + 0.5) * bw, yFace + s * 0.03, 0), [bw * 0.92, 0.06, 0.07], s > 0 ? M.magnetA() : M.magnetB());
    const pole = boxRow(Math.floor(n / 2), (i, o) => o.position.set(-L / 2 + (2 * i + 1.5) * bw, yFace + s * 0.028, 0), [bw * 0.7, 0.056, 0.06], M.steel());
    g.add(mag, pole);
    const n2 = half(25);
    const bw2 = L / n2;
    const mag2 = boxRow(Math.ceil(n2 / 2), (i, o) => o.position.set(-L / 2 + (2 * i + 0.5) * bw2, yFace + s * 0.1, -0.08), [bw2 * 0.92, 0.06, 0.06], s > 0 ? M.magnetA() : M.magnetB());
    const pole2 = boxRow(Math.floor(n2 / 2), (i, o) => o.position.set(-L / 2 + (2 * i + 1.5) * bw2, yFace + s * 0.1, -0.078), [bw2 * 0.7, 0.054, 0.056], M.steel());
    g.add(mag2, pole2);
    // rotating holder ("revolver" barrel) and strongback toward the C-frame
    g.add(boxSpan(-L / 2, L / 2, yFace + s * 0.062, yFace + s * 0.138, -0.05, 0.05, M.alu(), 0.006));
    g.add(boxSpan(-L / 2 - 0.03, L / 2 + 0.03, yFace + s * 0.14, yFace + s * 0.27, -0.06, 0.32, M.darkSteel(), 0.02));
    // rotation bearings at the ends
    for (const x of [-L / 2 - 0.06, L / 2 + 0.06]) {
      const b = cyl(0.075, 0.06, M.steel(), 20);
      b.rotation.z = Math.PI / 2;
      b.position.set(x, yFace + s * 0.1, 0);
      g.add(b);
    }
  }
  // C-frame on the outboard side, gap-drive motors on top (4-motor gap separation)
  const frame = box(L * 0.9, 0.95, 0.24, new THREE.MeshStandardMaterial({ color: 0x3f6f9a, roughness: 0.6, metalness: 0.3 }), 0.03);
  frame.position.set(0, 0, 0.42);
  g.add(frame);
  for (const x of [-L * 0.36, -L * 0.12, L * 0.12, L * 0.36]) {
    const mot = cyl(0.045, 0.16, M.blackAnod(), 16);
    mot.position.set(x, 0.56, 0.3);
    g.add(mot);
  }
  g.add(boxSpan(-L * 0.36, L * 0.36, FLOOR, -0.47, -0.1, 0.6, M.darkSteel(), 0.02));
  // flat ID vacuum chamber through the gap
  g.add(boxSpan(-L / 2 - 0.3, L / 2 + 0.3, -0.0035, 0.0035, -0.03, 0.03, M.alu(), 0.001));
  // electron beam
  const e = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, L + 1.2, 6), glowMaterial(COLORS.electron, 5));
  e.rotation.z = Math.PI / 2;
  g.add(e);
  return shadowed(g);
}

/** The empty upstream half of the straight (FDR baseline had a second revolver there): dashed ghost outline. */
export function emptyUpstreamSlot(): THREE.Group {
  const g = new THREE.Group();
  const ghost = ghostBox(UND.length, 0.5, 0.4);
  g.add(ghost);
  g.add(pipeX(-UND.length / 2 - 0.25, UND.length / 2 + 0.25, 0.012, M.alu()));
  return g;
}
