import * as THREE from 'three';
import { fatLine } from '../../scene/lines';
import { glowMaterial } from '../../scene/palette';
import { M, bar, box, boxSpan, inStation, now, REDUCED_MOTION, rod, vesselBox, wedge45 } from './kit';
import { H_SCAN, N_SURF, NANO_ENCL, NANO_KB_X, NANO_TOP_DET, NANO_X, SIDE_DET, WIRE } from './geom';
import { detectorFace, facingQuaternion, grainOrientation, laueSpots, rayFan, spotDots, type Spot } from './laue';

/**
 * 3DMN nano-diffraction instrument (34ID-BI-2), after FDR Fig. 4.67: ultra-stability optical table inside a ~3 m
 * thermal enclosure (≤ 0.02 °C), KB-mirror positioner upstream, interferometric nano-positioners, precision knife-edge
 * scanner and flat-panel detectors above. Station frame: origin = nano focus/sample (65.6 m), +X downstream, +Y up, +Z out.
 * Design only — its 2026 build status is not public. Detector layout mirrors the micro station (design: one large
 * low-noise detector above plus side detectors); short-focus KB: f_v ≈ 120 mm, f_h ≈ 55 mm, ~30 mm working distance (PDR).
 */

const TABLE_TOP = -0.32;
const X0 = NANO_ENCL.x0 - NANO_X; // enclosure start in station frame
const X1 = NANO_ENCL.x1 - NANO_X;
const FLOOR = -1.4;
const ROOF = FLOOR + NANO_ENCL.height;

export const NANO_TOP = new THREE.Vector3(0, NANO_TOP_DET.dist, 0);
/** Side panels as at the micro station (design: 'detector layout mirrors the micro station'), tilted 45° about the beam. */
const N_OUT = SIDE_DET.outCenter.clone();
const N_IN = SIDE_DET.inCenter.clone();
const UP = new THREE.Vector3(0, 1, 0);

let nanoSpots: Spot[] | null = null;
export function spots(): Spot[] {
  if (!nanoSpots)
    nanoSpots = laueSpots(
      [{ U: grainOrientation(38), origin: new THREE.Vector3(0.0006, 0, 0) }],
      [
        { name: 'top', center: NANO_TOP, normal: UP, half: NANO_TOP_DET.active / 2 },
        { name: 'out', center: N_OUT, normal: SIDE_DET.outNormal, half: SIDE_DET.active / 2 },
        { name: 'in', center: N_IN, normal: SIDE_DET.inNormal, half: SIDE_DET.active / 2 },
      ],
    );
  return nanoSpots;
}
const onDet = (n: string) => spots().filter((s) => s.det === n);

// ------------------------------------------------------------------ thermal enclosure (origin = its upstream wall, 64.0 m)

export function thermalEnclosure(): THREE.Group {
  return inStation(new THREE.Vector3(X0, 0, 0), (g) => {
    const zi = NANO_ENCL.in;
    const zo = NANO_ENCL.out;
    // glass walls + roof
    const glass = M.glass();
    const walls: [number, number, number, number][] = [
      [X0, zi, X1, zi], [X1, zi, X1, zo], [X1, zo, X0, zo], [X0, zo, X0, zi],
    ];
    const H = ROOF - FLOOR;
    for (const [xa, za, xb, zb] of walls) {
      const len = Math.hypot(xb - xa, zb - za);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(len, H), glass);
      p.renderOrder = 4;
      p.position.set((xa + xb) / 2, FLOOR + H / 2, (za + zb) / 2);
      p.rotation.y = -Math.atan2(zb - za, xb - xa);
      g.add(p);
    }
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, zo - zi), glass);
    roof.rotation.x = -Math.PI / 2;
    roof.position.set((X0 + X1) / 2, ROOF, (zi + zo) / 2);
    roof.renderOrder = 4;
    g.add(roof);
    // aluminium frame: posts, top and bottom rails, door mullions (the doors are on the outboard side, as in Fig. 4.67)
    const a = M.alu();
    const s = 0.045;
    const xm = (X0 + X1) / 2;
    for (const x of [X0, xm, X1])
      for (const z of [zi, zo]) g.add(bar(new THREE.Vector3(x, FLOOR, z), new THREE.Vector3(x, ROOF, z), s, a));
    for (const y of [FLOOR + s / 2, ROOF])
      for (const z of [zi, zo]) g.add(bar(new THREE.Vector3(X0, y, z), new THREE.Vector3(X1, y, z), s, a));
    for (const y of [FLOOR + s / 2, ROOF])
      for (const x of [X0, X1]) g.add(bar(new THREE.Vector3(x, y, zi), new THREE.Vector3(x, y, zo), s, a));
    for (const x of [X0 + 0.05, X1 - 0.05]) g.add(bar(new THREE.Vector3(x, ROOF - 0.01, zi), new THREE.Vector3(x, ROOF - 0.01, zo), s * 0.7, a));
    const handle = rod(new THREE.Vector3(xm - 0.06, -0.2, zo + 0.03), new THREE.Vector3(xm - 0.06, 0.2, zo + 0.03), 0.01, M.steel());
    g.add(handle);
    // beam ports in the upstream and downstream walls (the direct beam continues to the pink beam stop at 66.9 m)
    const portMat = new THREE.MeshStandardMaterial({ color: 0x9aa5b1, side: THREE.DoubleSide });
    for (const x of [X0, X1]) {
      const port = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.045, 24), portMat);
      port.rotation.y = Math.PI / 2;
      port.position.set(x, 0, 0);
      g.add(port);
    }
  });
}

// ------------------------------------------------------------------ ultra-stable table + interferometer laser (custom)

export function nanoTable(): THREE.Group {
  return inStation(new THREE.Vector3(), (g) => {
    const navy = new THREE.MeshStandardMaterial({ color: 0x1c2738, roughness: 0.55, metalness: 0.2 });
    g.add(boxSpan(-0.95, 0.75, FLOOR, TABLE_TOP - 0.02, -0.4, 0.45, navy, 0.01));
    g.add(boxSpan(-0.94, 0.74, TABLE_TOP - 0.02, TABLE_TOP, -0.39, 0.44, M.blackAnod(), 0.004));
    // interferometer laser head and electronics (blue + yellow boxes in FDR Fig. 4.67)
    g.add(boxSpan(0.18, 0.55, TABLE_TOP, TABLE_TOP + 0.09, 0.2, 0.3, M.blueAnod(), 0.006));
    const yel = new THREE.MeshStandardMaterial({ color: 0xf2c53d, roughness: 0.5 });
    g.add(boxSpan(0.55, 0.64, TABLE_TOP, TABLE_TOP + 0.09, 0.2, 0.3, yel, 0.006));
    g.add(boxSpan(0.22, 0.34, TABLE_TOP, TABLE_TOP + 0.07, 0.04, 0.16, yel, 0.006));
  });
}

// ------------------------------------------------------------------ nano KB on its positioner (origin 65.5 m = x −0.1)

export function nanoKB(): THREE.Group {
  return inStation(new THREE.Vector3(NANO_KB_X - NANO_X, 0, 0), (g) => {
    const v = vesselBox(0.15, 0.09, 0.1);
    v.position.set(-0.115, -0.008, 0);
    const nose = vesselBox(0.016, 0.04, 0.05);
    nose.position.set(-0.032, 0, 0);
    g.add(v, nose);
    g.add(boxSpan(-0.155, -0.085, -0.026, -0.0004, -0.011, 0.011, M.silicon(), 0.0012));
    const fV = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.018), M.mirror());
    fV.rotation.x = -Math.PI / 2;
    fV.position.set(-0.12, 0, 0);
    g.add(fV);
    g.add(boxSpan(-0.0675, -0.0325, -0.01, 0.01, -0.02, -0.0004, M.silicon(), 0.0012));
    const fH = new THREE.Mesh(new THREE.PlaneGeometry(0.033, 0.017), M.mirror());
    fH.position.set(-0.05, 0, 0);
    g.add(fH);
    // KB-mirror positioner (stacked fine stages) down to the table
    g.add(boxSpan(-0.2, -0.04, -0.09, -0.053, -0.07, 0.07, M.alu(), 0.003));
    g.add(boxSpan(-0.24, -0.04, -0.17, -0.09, -0.11, 0.11, M.steel(), 0.004));
    g.add(boxSpan(-0.27, -0.02, TABLE_TOP, -0.17, -0.14, 0.14, M.darkSteel(), 0.005));
    for (const z of [-0.09, 0.09]) g.add(boxSpan(-0.23, -0.06, -0.13, -0.1, z - 0.015, z + 0.015, M.blackAnod(), 0.002));
  });
}

// ------------------------------------------------------------------ nano sample on interferometric positioners (origin = sample)

export function nanoPositioner(): THREE.Group {
  return inStation(new THREE.Vector3(), (g) => {
    g.add(boxSpan(-0.09, 0.09, TABLE_TOP, -0.22, -0.09, 0.09, M.darkSteel(), 0.004));
    g.add(boxSpan(-0.07, 0.07, -0.22, -0.16, -0.07, 0.07, M.alu(), 0.003));
    g.add(boxSpan(-0.025, 0.025, -0.16, -0.06, -0.025, 0.025, M.steel(), 0.003));
    const ref = box(0.04, 0.03, 0.04, M.alu(), 0.002); // interferometer reference cube (alu, not mirror-bright: it bloomed in top views)
    ref.position.y = -0.045;
    g.add(ref);
    // 45° wedge standing on the interferometer reference cube (top at y = −0.03)
    const wedge = wedge45(0.018, 0.018, 0.0016, -0.03, M.alu());
    const sample = box(0.008, 0.0015, 0.008, M.sample(), 0.0003);
    sample.rotation.z = Math.PI / 4;
    sample.position.copy(N_SURF).multiplyScalar(-0.00075);
    g.add(wedge, sample, new THREE.Mesh(new THREE.SphereGeometry(0.0009, 12, 8), glowMaterial(0xbff6ff, 1.8)));
    // three interferometer heads aimed at the reference cube (x, y, z), red measuring beams
    const target = new THREE.Vector3(0, -0.045, 0);
    const heads: THREE.Vector3[] = [new THREE.Vector3(0.16, -0.045, 0), new THREE.Vector3(0, -0.045, 0.16), new THREE.Vector3(0.12, -0.045, -0.12)];
    for (const hp of heads) {
      const dir = target.clone().sub(hp).normalize();
      const head = box(0.03, 0.03, 0.05, M.blackAnod(), 0.003);
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      head.position.copy(hp);
      g.add(head, bar(new THREE.Vector3(hp.x, TABLE_TOP, hp.z), new THREE.Vector3(hp.x, hp.y - 0.015, hp.z), 0.02, M.steel()));
      const start = hp.clone().addScaledVector(dir, 0.025);
      const end = target.clone().addScaledVector(dir, -0.02);
      g.add(fatLine([start, end], { color: new THREE.Color(1, 0.18, 0.18), intensity: 2.2, width: 1.6 }));
    }
  });
}

// ------------------------------------------------------------------ knife-edge (wire) scanner, animated like the micro wire

const NANO_WIRE_H = WIRE.h * 0.8;
export function nanoWireU(t: number): number {
  const h = NANO_WIRE_H;
  return REDUCED_MOTION ? 1.2 * h : h * (1.45 + 1.15 * Math.sin((2 * Math.PI * (t + 2.5)) / 7));
}

export function knifeEdge(): THREE.Group {
  return inStation(new THREE.Vector3(), (g) => {
    const h = NANO_WIRE_H;
    const w0 = N_SURF.clone().multiplyScalar(h);
    const C0 = w0.clone().addScaledVector(H_SCAN, -0.024);
    const at = (p: THREE.Vector3, z: number) => new THREE.Vector3(p.x, p.y, z);
    const zs = 0.016;
    const base = C0.clone().addScaledVector(N_SURF, -0.02);
    const a = base.clone().addScaledVector(H_SCAN, -0.03);
    const b = base.clone().addScaledVector(H_SCAN, 0.05);
    g.add(bar(at(a, -0.12), at(b, -0.12), 0.022, M.darkSteel()), bar(new THREE.Vector3(a.x, TABLE_TOP, -0.12), at(a, -0.12), 0.022, M.steel()));
    const carrier = new THREE.Group();
    carrier.add(rod(at(C0, zs + 0.002), at(C0, -0.12), 0.002, M.alu()));
    for (const z of [-zs, zs]) carrier.add(rod(at(C0, z), at(w0, z), 0.0012, M.alu()));
    carrier.add(rod(at(w0, -zs), at(w0, zs), WIRE.r * 0.8, M.platinum(), 10));
    carrier.add(fatLine([at(w0, -zs), at(w0, zs)], { color: new THREE.Color(0xfff1d6), intensity: 2.0, width: 2.6 }));
    g.add(carrier);
    const host = carrier.children[0] as THREE.Mesh;
    host.frustumCulled = false;
    carrier.position.copy(H_SCAN).multiplyScalar(nanoWireU(now()));
    if (!REDUCED_MOTION) host.onBeforeRender = () => carrier.position.copy(H_SCAN).multiplyScalar(nanoWireU(now()));
  });
}

export function nanoRays(): THREE.Object3D {
  return rayFan(
    spots(),
    { at: (t) => N_SURF.clone().multiplyScalar(NANO_WIRE_H).addScaledVector(H_SCAN, nanoWireU(t)), r: WIRE.r * 0.8 },
    { width: 1.5, gain: 0.9, nearFade: { near: 0.18, far: 0.6, min: 0.16 } },
  );
}

// ------------------------------------------------------------------ flat-panel detectors (origin = top panel centre)

function panel(center: THREE.Vector3, normal: THREE.Vector3, housing: number, depth: number): THREE.Group {
  const g = new THREE.Group();
  const q = facingQuaternion(center, normal);
  const n = normal.clone().normalize();
  const hb = box(housing, housing, depth, M.detHousing(), 0.006);
  hb.quaternion.copy(q);
  hb.position.copy(center).addScaledVector(n, depth / 2 + 0.0015);
  g.add(hb);
  return g;
}

export function nanoDetectors(): THREE.Group {
  return inStation(NANO_TOP, (g) => {
    g.add(panel(NANO_TOP, UP, NANO_TOP_DET.housing, NANO_TOP_DET.depth), detectorFace(onDet('top'), NANO_TOP, NANO_TOP_DET.active / 2, UP), spotDots(onDet('top'), 0.005));
    const y0 = NANO_TOP_DET.dist + NANO_TOP_DET.depth;
    for (const x of [-0.18, 0.18]) for (const z of [-0.17, 0.17]) g.add(rod(new THREE.Vector3(x, y0, z), new THREE.Vector3(x, ROOF, z), 0.008, M.steel()));
    for (const [c, nrm, name] of [[N_OUT, SIDE_DET.outNormal, 'out'], [N_IN, SIDE_DET.inNormal, 'in']] as const) {
      g.add(panel(c, nrm, SIDE_DET.housing, SIDE_DET.depth), detectorFace(onDet(name), c, SIDE_DET.active / 2, nrm), spotDots(onDet(name), 0.004));
      const back = c.clone().addScaledVector(nrm, SIDE_DET.depth * 1.2);
      g.add(rod(back, new THREE.Vector3(back.x, ROOF, back.z), 0.008, M.steel()));
    }
  });
}

