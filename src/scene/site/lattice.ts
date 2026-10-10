import * as THREE from 'three';
import { SITE, toWorld } from '../../data/site';
import { mats } from '../palette';

/**
 * APS-U hybrid seven-bend achromat (H7BA) sector, instanced around all 40 sectors.
 * Magnet COUNTS per sector follow the Final Design Report (2-3.1, Table 2.4): 7 dipoles (M1, M2 longitudinal-gradient
 * ×2 each, M3 transverse-gradient ×2, M4 ×1 at the centre), 10 quadrupoles (Q1, Q2, Q3, Q6, Q7 ×2), 6 reverse bends
 * (offset quadrupoles Q4, Q5, Q8 ×2), 6 sextupoles (S1, S2, S3 ×2) and 4 fast correctors = 33 magnets × 40 = 1,320
 * (+1 extra corrector near injection = 1,321). The ORDER and spacing are schematic (mirror-symmetric about the
 * sector centre); lengths are approximate. s = 0 is the ID straight-section centre.
 */
type Kind = 'D' | 'Q' | 'R' | 'S' | 'C';
const HALF: [Kind, string, number][] = [
  ['Q', 'Q1', 0.25], ['Q', 'Q2', 0.25], ['D', 'M1', 2.2], ['Q', 'Q3', 0.25], ['R', 'Q4', 0.3], ['D', 'M2', 2.2],
  ['S', 'S1', 0.25], ['R', 'Q5', 0.3], ['S', 'S2', 0.25], ['D', 'M3', 0.8], ['S', 'S3', 0.25], ['Q', 'Q6', 0.25],
  ['Q', 'Q7', 0.3], ['R', 'Q8', 0.3], ['C', 'FC', 0.15], ['C', 'FC', 0.15],
];

function sectorSequence(): { kind: Kind; s: number; len: number }[] {
  const L = SITE.circumferenceM / SITE.sectors; // ~27.6 m
  const sc = L / 2; // sector centre (M4)
  const start = 3.0; // end of the ID straight
  const m4 = 0.8;
  const total = HALF.reduce((a, [, , len]) => a + len, 0);
  const gap = (sc - m4 / 2 - start - total) / HALF.length;
  const out: { kind: Kind; s: number; len: number }[] = [];
  let s = start;
  for (const [kind, , len] of HALF) {
    out.push({ kind, s: s + len / 2, len });
    s += len + gap;
  }
  const mirrored = out.map((m) => ({ ...m, s: 2 * sc - m.s }));
  return [...out, { kind: 'D', s: sc, len: m4 }, ...mirrored];
}

export function buildLattice(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lattice';
  const seq = sectorSequence();
  const R = SITE.orbitRadiusM;
  const sgn = SITE.clockwise ? -1 : 1;
  const dims: Record<Kind, [number, number]> = { D: [0.55, 0.62], Q: [0.62, 0.62], R: [0.62, 0.62], S: [0.5, 0.5], C: [0.4, 0.4] };
  const material: Record<Kind, THREE.Material> = {
    D: mats.magnetDipole(),
    Q: mats.magnetQuad(),
    R: mats.magnetReverse(),
    S: mats.magnetSext(),
    C: mats.magnetCorrector(),
  };
  const dummy = new THREE.Object3D();
  const angle0 = (n: number) => THREE.MathUtils.degToRad(SITE.sector1AngleDeg) + sgn * (n - 1) * ((Math.PI * 2) / SITE.sectors);
  for (const k of ['D', 'Q', 'R', 'S', 'C'] as Kind[]) {
    const list = seq.filter((m) => m.kind === k);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material[k], list.length * SITE.sectors);
    let i = 0;
    for (let n = 1; n <= SITE.sectors; n++) {
      for (const { s, len } of list) {
        const a = angle0(n) + sgn * (s / R);
        dummy.position.copy(toWorld(R * Math.cos(a), R * Math.sin(a), SITE.beamHeightM));
        dummy.rotation.set(0, a, 0);
        dummy.scale.set(dims[k][0], dims[k][1], len);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.castShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = `magnets-${k}`;
    g.add(mesh);
  }
  // 5 pre-assembled modules per sector (DLM-A, QMQ-A, FODO, QMQ-B, DLM-B) on concrete plinths
  const L = SITE.circumferenceM / SITE.sectors;
  const modules: [number, number][] = [[5.6, 5.0], [10.0, 3.2], [13.8, 4.0], [17.6, 3.2], [22.0, 5.0]].map(([c, len]) => [(c / 27.6) * L, len]);
  const girder = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.darkSteel(), SITE.sectors * modules.length);
  let j = 0;
  for (let n = 1; n <= SITE.sectors; n++) {
    for (const [s, len] of modules) {
      const a = angle0(n) + sgn * (s / R);
      dummy.position.copy(toWorld(R * Math.cos(a), R * Math.sin(a), 0.55));
      dummy.rotation.set(0, a, 0);
      dummy.scale.set(0.9, 1.1, len);
      dummy.updateMatrix();
      girder.setMatrixAt(j++, dummy.matrix);
    }
  }
  girder.receiveShadow = true;
  g.add(girder);
  return g;
}
