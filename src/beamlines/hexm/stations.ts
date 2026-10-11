import * as THREE from 'three';
import { FLOOR, D_DET_PARK, D_DET_RAIL, D_DET_X } from './geom';
import { M, boxSpan, cyl, detectorFace, detectorHead, rod, shadowed } from './kit';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Six-strut hexapod between two plates (base radius rb at y0, top radius rt at y1). */
export function hexapod(rb: number, rt: number, y0: number, y1: number, strutR = 0.012): THREE.Group {
  const g = new THREE.Group();
  const base = cyl(rb + 0.03, 0.04, M.darkSteel(), 6);
  base.position.y = y0 - 0.02;
  const top = cyl(rt + 0.02, 0.03, M.alu(), 32);
  top.position.y = y1 + 0.015;
  g.add(base, top);
  const d2r = Math.PI / 180;
  for (let i = 0; i < 6; i++) {
    const c = Math.floor(i / 2) * 120 * d2r;
    const s = i % 2 ? 1 : -1;
    const a = v(Math.cos(c + s * 15 * d2r) * rb, y0, Math.sin(c + s * 15 * d2r) * rb);
    const b = v(Math.cos(c + s * 45 * d2r) * rt, y1, Math.sin(c + s * 45 * d2r) * rt);
    g.add(rod(a, b, strutR, M.blackAnod(), 10));
    g.add(rod(a.clone().lerp(b, 0.12), a.clone().lerp(b, 0.45), strutR * 1.7, M.alu(), 10));
  }
  return g;
}

/**
 * 20-ID-D high-throughput HEDM instrument (NSF-MRI consortium; six-DOF Aerotech manipulation). Origin = sample position.
 * Schematic: granite base, rotary stage, hexapod, sample mount, and a small sample carousel beside it (high-throughput /
 * mail-in operation is described; the changer hardware itself is not documented). `idle`: no sample mounted and the empty
 * mount 5 cm below the beam, as when 20-ID-D passes the beam on to 20-ID-E.
 */
export function htHedm(o: { idle?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(-0.55, 0.55, FLOOR, FLOOR + 0.62, -0.5, 0.5, M.granite(), 0.02));
  // rotation stage (schematic; bearing type not documented)
  const rot = cyl(0.17, 0.12, M.blackAnod(), 40);
  rot.position.y = FLOOR + 0.68;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.008, 6, 40), M.alu());
  ring.rotation.x = Math.PI / 2;
  ring.position.y = FLOOR + 0.74;
  g.add(rot, ring);
  // hexapod above the rotation
  g.add(hexapod(0.15, 0.09, FLOOR + 0.78, -0.16));
  // The sample-mount pin is at beam height during use, or empty and below the beam when idle.
  if (o.idle) g.add(cyl(0.006, 0.07, M.steel(), 10).translateY(-0.115));
  else {
    g.add(cyl(0.006, 0.12, M.steel(), 10).translateY(-0.09));
    g.add(cyl(0.0035, 0.03, M.sample(), 12));
  }
  // sample carousel (schematic) on the inboard side
  const car = new THREE.Group();
  car.position.set(-0.05, FLOOR + 0.62, -0.32);
  car.add(cyl(0.14, 0.03, M.blackAnod(), 32).translateY(0.015));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    car.add(cyl(0.006, 0.05, M.steel(), 8).translateX(Math.cos(a) * 0.11).translateZ(Math.sin(a) * 0.11).translateY(0.055));
  }
  g.add(car);
  return shadowed(g);
}

/**
 * 20-ID-D far-field area detector (FDR: "Dexela 2923 or equivalent"; the Directory lists a Varex 4343 for 20-ID) on a
 * carriage that rides floor rails over the documented 72.5–75 m detector zone. Origin = detector face centre, which the
 * layout places D_DET_PARK inboard of the beam: the detector has slid sideways on a cross-slide (pass-through state), while
 * the rails stay centred under the beam axis.
 */
export function dDetector(): THREE.Group {
  const g = new THREE.Group();
  const zBeam = -D_DET_PARK; // local z of the beam axis
  g.add(detectorHead(0.43, 0.43, 0.12, detectorFace('blank')));
  // support yoke, cross-slide and carriage
  g.add(boxSpan(0.02, 0.1, FLOOR + 0.36, -0.255, -0.05, 0.05, M.steel(), 0.006));
  g.add(boxSpan(-0.12, 0.24, FLOOR + 0.3, FLOOR + 0.36, -0.2, 0.2, M.darkSteel(), 0.006));
  g.add(boxSpan(-0.16, 0.28, FLOOR + 0.27, FLOOR + 0.3, -0.25, zBeam + 0.35, M.rail(), 0.004));
  g.add(boxSpan(-0.25, 0.4, FLOOR + 0.1, FLOOR + 0.27, zBeam - 0.35, zBeam + 0.35, M.darkSteel(), 0.01));
  // rails along the beam (relative to the detector at D_DET_X)
  for (const z of [zBeam - 0.25, zBeam + 0.25]) g.add(boxSpan(D_DET_RAIL.x0 - D_DET_X - 0.3, D_DET_RAIL.x1 - D_DET_X + 0.2, FLOOR, FLOOR + 0.1, z - 0.04, z + 0.04, M.rail(), 0.004));
  return shadowed(g);
}
