import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildCtx } from '../../scene/beamline/layout';
import { E, E_Z, FLOOR, HALL_EXIT_X, LBB_OUTLINE, LBB_X, PUMPS, ST2, beamSide } from './geom';
import { M, boxSpan, cyl, shadowed } from './kit';

/**
 * The ~147 m shielded transport (19ID-ST-2, 65.5–213 m), the experiment-hall wall it passes through, the enclosed
 * corridor to the Long Beamline Building and the building's ISN wing. Everything here is built in the beamline group's
 * frame (absolute x from the source; z = lateral, + outboard), following the drawn beam axis (beamSide).
 */

/** Merge every mesh of `src` (after its transforms) into one mesh per material — cheap to draw for long repeated runs. */
function mergeByMaterial(src: THREE.Object3D): THREE.Group {
  src.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    geo = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    const mat = m.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(geo);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (merged) out.add(new THREE.Mesh(merged, mat));
  }
  return out;
}

const jacketMat = new THREE.MeshStandardMaterial({ color: 0x6d7681, roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide });
const innerMat = new THREE.MeshStandardMaterial({ color: 0xc5cdd6, roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide });

/**
 * Lead-jacketed 4-inch transport from x0 to x1 following the beam drift, in ~3 m straight sections between supports.
 * The jacket and pipe are cut away over a 120° window on the upper `open` side so the beam inside stays visible.
 */
export function longTransport(x0: number, x1: number, open: 1 | 0 | -1, skip: [number, number][] = []): THREE.Group {
  const src = new THREE.Group();
  const n = Math.max(1, Math.round((x1 - x0) / 3));
  const start = open > 0 ? (2 * Math.PI) / 3 : open < 0 ? Math.PI : (5 * Math.PI) / 6;
  const ringGeo = new THREE.TorusGeometry(0.115, 0.012, 6, 20);
  for (let i = 0; i < n; i++) {
    const a = x0 + ((x1 - x0) * i) / n;
    const b = x0 + ((x1 - x0) * (i + 1)) / n;
    const za = beamSide(a);
    const zb = beamSide(b);
    const len = Math.hypot(b - a, zb - za);
    const yaw = -Math.atan2(zb - za, b - a);
    const seg = new THREE.Group();
    seg.position.set((a + b) / 2, 0, (za + zb) / 2);
    seg.rotation.y = yaw;
    for (const [r, m] of [[0.11, jacketMat], [0.057, innerMat]] as const) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 24, 1, true, start, (4 * Math.PI) / 3), m);
      c.rotation.z = Math.PI / 2;
      seg.add(c);
    }
    src.add(seg);
    // collar + support stand at the section joint
    if (!skip.some(([s0, s1]) => a > s0 && a < s1)) {
      const ring = new THREE.Mesh(ringGeo, M.steel());
      ring.rotation.y = Math.PI / 2 + yaw;
      ring.position.set(a, 0, za);
      src.add(ring);
      if (i > 0) {
        src.add(boxSpan(a - 0.035, a + 0.035, FLOOR, -0.11, za - 0.1, za + 0.1, M.darkSteel(), 0));
        src.add(boxSpan(a - 0.06, a + 0.06, -0.14, -0.1, za - 0.12, za + 0.12, M.steel(), 0));
      }
    }
  }
  return shadowed(mergeByMaterial(src));
}

/**
 * Shielded ion-pump mini-enclosure (200 L/s pumps at 95, 124, 153 and 183 m, FDR Table 4.49). Lead box around the
 * pump tee, cut away on the top so the pump inside shows.
 */
export function pumpStation(x: number): THREE.Group {
  const g = new THREE.Group();
  const z = beamSide(x);
  const h = 0.36;
  const w = 0.42;
  g.add(boxSpan(x - w, x + w, FLOOR, -0.55, z - w, z + w, M.lead(), 0.01)); // base
  for (const s of [-1, 1]) {
    g.add(boxSpan(x - w, x + w, -0.55, h, z + s * w - s * 0.08, z + s * w, M.lead(), 0.008));
    g.add(boxSpan(x + s * w - s * 0.08, x + s * w, -0.55, h, z - w + 0.08, z + w - 0.08, M.lead(), 0.008));
  }
  // pump tee + ion pump body hanging below the pipe
  const tee = cyl(0.05, 0.3, M.steel(), 16);
  tee.position.set(x, -0.17, z);
  const pump = boxSpan(x - 0.14, x + 0.14, -0.5, -0.28, z - 0.11, z + 0.11, M.steel(), 0.015);
  const mag = boxSpan(x - 0.15, x + 0.15, -0.47, -0.31, z - 0.13, z + 0.13, M.blackAnod(), 0.01);
  g.add(tee, pump, mag);
  return shadowed(g);
}

/** Concrete sleeve where the line passes the experiment-hall outer wall (~91 m, computed), drawn as a cut wall section. */
export function hallWall(): THREE.Group {
  const g = new THREE.Group();
  const x = HALL_EXIT_X;
  const z = beamSide(x);
  // the wall runs along the hall circle: tangent ⟂ radius from the ring centre at (0, −175.5)
  const yaw = -Math.atan2(-x, z + 175.5);
  const wall = new THREE.Group();
  wall.position.set(x, 0, z);
  wall.rotation.y = yaw;
  const t = 0.4;
  // the beam crosses the 0.4 m wall at ~27° to its face, so the sleeve opening is ~1 m long along the wall
  wall.add(boxSpan(-2.6, -0.5, FLOOR, 0.9, -t / 2, t / 2, M.concrete(), 0.01));
  wall.add(boxSpan(0.5, 2.6, FLOOR, 0.9, -t / 2, t / 2, M.concrete(), 0.01));
  wall.add(boxSpan(-0.5, 0.5, FLOOR, -0.2, -t / 2, t / 2, M.concrete(), 0.002));
  wall.add(boxSpan(-0.5, 0.5, 0.2, 0.9, -t / 2, t / 2, M.concrete(), 0.002));
  g.add(wall);
  return shadowed(g);
}

/** Floor strip + low curbs marking the enclosed transport corridor from the hall wall to the LBB (following the beam). */
export function corridor(halfW = 1.5): THREE.Group {
  const g = new THREE.Group();
  const xs: number[] = [];
  for (let x = HALL_EXIT_X + 0.3; x < LBB_X; x += 4) xs.push(x);
  xs.push(LBB_X);
  const shape = new THREE.Shape();
  xs.forEach((x, i) => (i ? shape.lineTo(x, -(beamSide(x) - halfW)) : shape.moveTo(x, -(beamSide(x) - halfW))));
  for (let i = xs.length - 1; i >= 0; i--) shape.lineTo(xs[i], -(beamSide(xs[i]) + halfW));
  shape.closePath();
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), M.floor());
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR + 0.02;
  floor.receiveShadow = true;
  g.add(floor);
  // low cut walls (0.3 m) on both sides, in ~4 m straight pieces
  const src = new THREE.Group();
  for (let i = 0; i < xs.length - 1; i++) {
    for (const s of [-1, 1]) {
      const a = new THREE.Vector3(xs[i], 0, beamSide(xs[i]) + s * halfW);
      const b = new THREE.Vector3(xs[i + 1], 0, beamSide(xs[i + 1]) + s * halfW);
      const len = a.distanceTo(b);
      const w = boxSpan(-len / 2, len / 2, FLOOR, FLOOR + 0.3, -0.06, 0.06, M.concrete(), 0);
      const p = new THREE.Group();
      p.position.copy(a).add(b).multiplyScalar(0.5);
      p.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      p.add(w);
      src.add(p);
    }
  }
  g.add(shadowed(mergeByMaterial(src)));
  return g;
}

/** ISN wing of the Long Beamline Building (footprint from site.json): floor slab, low cut walls and roof-line edges. */
export function lbbWing(heightM = 9.0): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape(LBB_OUTLINE.map(([x, z]) => new THREE.Vector2(x, -z)));
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), M.floorLight());
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR + 0.025;
  floor.receiveShadow = true;
  g.add(floor);
  const pts = [...LBB_OUTLINE, LBB_OUTLINE[0]];
  const edge: number[] = [];
  const src = new THREE.Group();
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    // leave the corridor opening where the transport enters (upstream face around the beam)
    const p = new THREE.Group();
    p.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    p.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    p.add(boxSpan(-len / 2, len / 2, FLOOR, FLOOR + 0.9, -0.1, 0.1, M.concrete(), 0));
    src.add(p);
    edge.push(x0, FLOOR + heightM, z0, x1, FLOOR + heightM, z1);
    edge.push(x0, FLOOR + 0.9, z0, x0, FLOOR + heightM, z0);
  }
  g.add(shadowed(mergeByMaterial(src)));
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
  const lines = new THREE.LineSegments(eg, new THREE.LineDashedMaterial({ color: 0x8796a8, transparent: true, opacity: 0.35, dashSize: 0.6, gapSize: 0.45 }));
  lines.computeLineDistances();
  g.add(lines);
  return g;
}

/**
 * 19-ID-E concrete walls (12 in = 0.30 m) drawn cut away at 1.1 m above the floor, with the airlock doorway on the
 * inboard wall (toward the control area, MEDSI'25 Fig. 2a; position approx), and the isolation joint of the 1 m thick
 * instrument slab (VC-G) drawn as a dark groove along the inside of the walls.
 */
export function concreteHutch(): THREE.Group {
  const g = new THREE.Group();
  const top = FLOOR + 1.1;
  const x0o = E.x0 - E.wall;
  const x1o = E.x1 + E.wall;
  const door: [number, number] = [221.0, 222.3];
  // outboard and inboard walls
  g.add(boxSpan(x0o, x1o, FLOOR, top, E_Z.inOut, E_Z.outOut, M.concrete(), 0.01));
  g.add(boxSpan(x0o, door[0], FLOOR, top, E_Z.outIn, E_Z.inIn, M.concrete(), 0.01));
  g.add(boxSpan(door[1], x1o, FLOOR, top, E_Z.outIn, E_Z.inIn, M.concrete(), 0.01));
  // upstream wall with the pipe pass-through (centred on the beam where it crosses the wall), downstream wall
  const zw = beamSide(E.x0 - E.wall / 2);
  g.add(boxSpan(x0o, E.x0, FLOOR, top, E_Z.inIn, zw - 0.15, M.concrete(), 0.01));
  g.add(boxSpan(x0o, E.x0, FLOOR, top, zw + 0.15, E_Z.inOut, M.concrete(), 0.01));
  g.add(boxSpan(x0o, E.x0, FLOOR, -0.15, zw - 0.15, zw + 0.15, M.concrete(), 0.005));
  g.add(boxSpan(E.x1, x1o, FLOOR, top, E_Z.inIn, E_Z.inOut, M.concrete(), 0.01));
  // isolation joint around the instrument slab (0.5 in, drawn 4 cm wide so it reads)
  const j = M.hole();
  const y = FLOOR + 0.03;
  g.add(boxSpan(E.x0 + 0.05, E.x1 - 0.05, y - 0.005, y, E_Z.inIn + 0.05, E_Z.inIn + 0.09, j, 0));
  g.add(boxSpan(E.x0 + 0.05, E.x1 - 0.05, y - 0.005, y, E_Z.inOut - 0.09, E_Z.inOut - 0.05, j, 0));
  g.add(boxSpan(E.x0 + 0.05, E.x0 + 0.09, y - 0.005, y, E_Z.inIn + 0.05, E_Z.inOut - 0.05, j, 0));
  g.add(boxSpan(E.x1 - 0.09, E.x1 - 0.05, y - 0.005, y, E_Z.inIn + 0.05, E_Z.inOut - 0.05, j, 0));
  return shadowed(g);
}

/**
 * Fabric supply 'air socks' (purple U) around a central exhaust duct (green), hung below the roof (MEDSI'25 Fig. 2a):
 * gentle laminar supply that holds the air to ±0.05 °C per hour. Hangers run up to the roof line.
 */
export function airSocks(): THREE.Group {
  const g = new THREE.Group();
  const yS = E.roof - 0.45;
  const xa = E.x0 + 1.6;
  const xb = E.x1 - 1.6;
  const zO = E_Z.inOut - 1.0;
  const zI = E_Z.inIn + 1.0;
  const r = 0.22;
  const sock = (a: THREE.Vector3, b: THREE.Vector3) => {
    const d = b.clone().sub(a);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 20, 1, false), M.sock());
    c.position.copy(a).addScaledVector(d, 0.5);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    c.renderOrder = 4;
    return c;
  };
  g.add(sock(new THREE.Vector3(xa, yS, zO), new THREE.Vector3(xb, yS, zO)));
  g.add(sock(new THREE.Vector3(xa, yS, zI), new THREE.Vector3(xb, yS, zI)));
  g.add(sock(new THREE.Vector3(xb, yS, zO + r), new THREE.Vector3(xb, yS, zI - r)));
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, xb - xa - 2.4, 20), M.exhaust());
  ex.rotation.z = Math.PI / 2;
  ex.position.set((xa + xb) / 2 - 0.6, yS, (zO + zI) / 2);
  ex.renderOrder = 4;
  g.add(ex);
  // hangers
  const hang: number[] = [];
  for (let x = xa + 0.5; x < xb; x += 2.5) for (const z of [zO, zI, (zO + zI) / 2]) hang.push(x, yS + 0.2, z, x, E.roof, z);
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(hang, 3));
  g.add(new THREE.LineSegments(hg, M.ghostEdge()));
  return g;
}

/** Invisible pick volume along the long transport so clicking the pipe opens its card. */
export function transportHit(ctx: BuildCtx, id: string): void {
  const src = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ visible: false });
  for (let a = ST2.x0; a < ST2.x1; a += 10) {
    const b = Math.min(ST2.x1, a + 10);
    const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, 0.6, 0.6), mat);
    m.position.set((a + b) / 2, 0, beamSide((a + b) / 2));
    src.add(m);
  }
  for (const x of PUMPS) src.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat).translateX(x).translateZ(beamSide(x)).translateY(-0.4));
  ctx.group.add(src);
  ctx.addPickable(src, id);
}
