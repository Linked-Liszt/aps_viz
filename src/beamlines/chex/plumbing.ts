import * as THREE from 'three';
import { M, box, cyl, flangeX, pipeX, post, shadowed } from './kit';

/**
 * Compact beam-conditioning parts for CHEX. The FDR spaces slits, lens stacks, viewers and windows only 0.2-0.3 m apart
 * (Tables 4.6-4.9), so the generic engine parts (0.5-0.9 m long) would run into each other; these are sized to fit.
 * Part frame: origin on the beam, +X downstream, +Y up, +Z outboard.
 */

/** Four-blade mono-beam slit in a small cross, on a slim post (0.16 m along the beam). */
export function compactSlits(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.12, 0.2, 0.2, M.steel(), 0.01);
  g.add(body);
  for (const [y, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const m = cyl(0.022, 0.09, M.darkSteel(), 12);
    m.position.set(0, y * 0.145, z * 0.145);
    if (z) m.rotation.x = Math.PI / 2;
    g.add(m);
  }
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), M.hole());
  hole.rotation.y = -Math.PI / 2;
  hole.position.x = -0.061;
  g.add(hole, pipeX(-0.08, 0.08, 0.022), post(beamY, -0.1, 0.1, 0.12, M.steel()));
  return shadowed(g);
}

/** Beam visualisation monitor: a small vacuum cross with a YAG flag actuator on top and a camera on the side. */
export function beamViewer(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const cross = box(0.09, 0.09, 0.09, M.ss(), 0.008);
  const act = cyl(0.014, 0.14, M.darkSteel(), 10);
  act.position.y = 0.115;
  const cam = cyl(0.022, 0.1, M.detector(), 14);
  cam.rotation.x = Math.PI / 2;
  cam.position.z = 0.095;
  g.add(cross, act, cam, post(beamY, -0.045, 0.06, 0.06, M.steel()));
  return shadowed(g);
}

/** Thin diamond/Be exit window on a short flange spool. */
export function exitWindow(beamY: number): THREE.Group {
  const g = new THREE.Group();
  g.add(pipeX(-0.07, 0.03, 0.022), flangeX(0.03, 0.05), flangeX(0.05, 0.05));
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.018, 20), M.bewindow());
  win.rotation.y = Math.PI / 2;
  win.position.x = 0.062;
  g.add(win, post(beamY, -0.05, 0.05, 0.05, M.steel(), 0));
  return shadowed(g);
}

/** Compact monochromatic-beam shutter (P8-20 class): a short tungsten-block housing with a pneumatic cylinder. */
export function monoShutter(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.24, 0.32, 0.2, M.yellow(), 0.015);
  body.position.y = 0.06;
  const cylA = cyl(0.03, 0.2, M.alu(), 14);
  cylA.position.y = 0.32;
  g.add(body, cylA, pipeX(-0.2, 0.2, 0.022), post(beamY, -0.1, 0.18, 0.16, M.darkSteel()));
  return shadowed(g);
}

/** Wall collimator: a tungsten plug with one bore per canted beam, seated inside the ratchet-wall sleeve. */
export function wallCollimator(holes: number[], len = 0.6): THREE.Group {
  const g = new THREE.Group();
  const plug = cyl(0.1, len, M.tungsten(), 28);
  plug.rotation.z = Math.PI / 2;
  g.add(plug);
  for (const z of holes) {
    for (const s of [-1, 1]) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16), M.hole());
      d.rotation.y = (s * Math.PI) / 2;
      d.position.set((s * len) / 2 + s * 0.002, 0, z);
      g.add(d);
    }
  }
  return shadowed(g);
}

/** White-beam P4-40-class shutter (taller water-cooled body), sized to fit inside the 1 m wide SE-1 mini-hutch. */
export function whiteShutter(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const body = box(0.36, 0.5, 0.32, M.yellow(), 0.02);
  body.position.y = 0.08;
  const cap = box(0.38, 0.05, 0.34, M.darkSteel(), 0.008);
  cap.position.y = 0.355;
  const cylA = cyl(0.035, 0.18, M.alu(), 14);
  cylA.position.y = 0.47;
  g.add(body, cap, cylA, pipeX(-0.3, 0.3, 0.03), post(beamY, -0.17, 0.3, 0.28, M.darkSteel()));
  return shadowed(g);
}

/** Generic floor-standing beam-pipe support used for beam-pass and in-hutch flight pipes (part frame along +X). */
export function passPipe(beamY: number, len: number, r = 0.022): THREE.Group {
  const g = new THREE.Group();
  g.add(pipeX(0, len, r, M.pipeGhost(), 14), flangeX(0, r + 0.018), flangeX(len, r + 0.018));
  const n = Math.max(1, Math.round(len / 2.2));
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * len;
    g.add(post(beamY, -r, 0.04, 0.04, M.steel(), x, 0));
  }
  return shadowed(g);
}
