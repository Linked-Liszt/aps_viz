import * as THREE from 'three';
import { M, bellowsX, box, boxSpan, cyl, flangeX, ghostBox, pedestal, pipeX, pipeZ, postStand, rod, shadowed, vesselBox, vesselCylY } from './kit';
import { FLOOR } from './geom';

/** Water-cooled mask / collimator / stop block with an aperture (origin on axis). */
export function shieldBlock(o: { len: number; w?: number; h?: number; mat: 'copper' | 'tungsten' | 'lead' | 'glidcop'; hole?: number; water?: boolean; standW?: number }): THREE.Group {
  const g = new THREE.Group();
  const w = o.w ?? 0.24;
  const h = o.h ?? 0.24;
  const m = o.mat === 'copper' ? M.copper() : o.mat === 'tungsten' ? M.tungsten() : o.mat === 'glidcop' ? M.glidcop() : M.lead();
  const hole = o.hole ?? 0.012;
  // four slabs around a square aperture so the beam visibly threads the hole
  g.add(boxSpan(-o.len / 2, o.len / 2, hole / 2, h / 2, -w / 2, w / 2, m, 0.006));
  g.add(boxSpan(-o.len / 2, o.len / 2, -h / 2, -hole / 2, -w / 2, w / 2, m, 0.006));
  g.add(boxSpan(-o.len / 2, o.len / 2, -hole / 2, hole / 2, hole / 2, w / 2, m, 0.002));
  g.add(boxSpan(-o.len / 2, o.len / 2, -hole / 2, hole / 2, -w / 2, -hole / 2, m, 0.002));
  if (o.water) {
    for (const z of [-0.04, 0.04]) {
      g.add(rod(new THREE.Vector3(0, h / 2, z), new THREE.Vector3(0, h / 2 + 0.1, z), 0.008, M.water(), 8));
      g.add(boxSpan(-0.018, 0.018, h / 2 + 0.1, h / 2 + 0.125, z - 0.018, z + 0.018, M.steel(), 0.002));
    }
  }
  g.add(pedestal(0, 0, FLOOR, -h / 2, o.standW ?? Math.min(0.3, w), Math.min(0.3, w), M.steel()));
  return shadowed(g);
}

/** Collimator sleeve through the 1.5 m shield wall (22.1–23.6 m); origin at the collimator (22.9 m). */
export function wallCollimator(): THREE.Group {
  const g = new THREE.Group();
  g.add(pipeX(-0.8, 0.7, 0.09, M.steel()));
  g.add(boxSpan(-0.25, 0.25, -0.16, 0.16, -0.16, 0.16, M.tungsten(), 0.01));
  g.add(flangeX(-0.8, 0.12), flangeX(0.7, 0.12));
  return shadowed(g);
}

/**
 * Bendable high-heat-load mirror (M1 horizontal, M2 vertical) in a cut-away vessel: Si substrate with three stripes
 * (Si / Rh / Pt), side cooling bars, two bender actuators, motorised base on a granite block.
 * Horizontal deflection: reflecting face vertical, substrate on the inboard side (deflection sense undocumented).
 */
export function hhlMirror(o: { L: number; vertical: boolean }): THREE.Group {
  const g = new THREE.Group();
  const L = o.L;
  const v = vesselBox(L + 0.3, 0.42, 0.42);
  g.add(v);
  const stripe = [M.silicon(), new THREE.MeshStandardMaterial({ color: 0xd5dbe3, roughness: 0.05, metalness: 1 }), new THREE.MeshStandardMaterial({ color: 0xeceff3, roughness: 0.04, metalness: 1 })];
  const thick = 0.05;
  const width = 0.06;
  const inner = new THREE.Group();
  inner.add(boxSpan(-L / 2, L / 2, -thick, 0, -width / 2, width / 2, M.silicon(), 0.003));
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.98, width / 3.3), stripe[i]);
    s.rotation.x = -Math.PI / 2;
    s.position.set(0, 0.0005, -width / 3 + (i * width) / 3);
    inner.add(s);
  }
  // side cooling (copper bars in notches) and bender actuators at both ends
  for (const z of [-width / 2 - 0.008, width / 2 + 0.008]) inner.add(boxSpan(-L * 0.45, L * 0.45, -thick * 0.8, -thick * 0.25, z - 0.006, z + 0.006, M.copper(), 0.002));
  for (const x of [-L / 2 - 0.05, L / 2 + 0.05]) inner.add(boxSpan(x - 0.04, x + 0.04, -0.12, 0.01, -0.05, 0.05, M.darkSteel(), 0.006));
  inner.add(boxSpan(-L / 2 - 0.1, L / 2 + 0.1, -0.16, -0.12, -0.08, 0.08, M.steel(), 0.006));
  if (!o.vertical) {
    // rotate so the reflecting face looks outboard (+Z) with the substrate on the inboard side
    inner.rotation.x = Math.PI / 2;
  }
  g.add(inner);
  for (const s of [-1, 1]) {
    g.add(flangeX((s * (L + 0.3)) / 2, 0.08));
    g.add(pipeX((s * (L + 0.3)) / 2, s * ((L + 0.3) / 2 + 0.2), 0.035));
  }
  // cooling-water feedthroughs on the lid
  for (const x of [-L * 0.2, L * 0.2]) {
    g.add(rod(new THREE.Vector3(x, 0.21, 0), new THREE.Vector3(x, 0.33, 0), 0.01, M.water(), 8));
    g.add(boxSpan(x - 0.025, x + 0.025, 0.33, 0.36, -0.025, 0.025, M.steel(), 0.003));
  }
  // motorised base on a granite pedestal
  g.add(boxSpan(-L / 2 - 0.2, L / 2 + 0.2, -0.33, -0.21, -0.32, 0.32, M.steel(), 0.01));
  g.add(boxSpan(-L / 2 - 0.1, L / 2 + 0.1, FLOOR, -0.33, -0.3, 0.3, M.granite(), 0.01));
  return shadowed(g);
}

/**
 * Horizontally deflecting LN2-cooled Si(111) double-crystal monochromator: vertical-axis tank, both crystals with
 * VERTICAL diffracting faces, rotated about the vertical axis by the Bragg angle (11.4° = Si(111) at 10 keV). The
 * ~1 mm horizontal offset between the beams is enlarged ×10 here.
 */
export function horizontalDcm(): THREE.Group {
  const g = new THREE.Group();
  const tank = vesselCylY(0.3, 0.62);
  tank.position.y = 0.04;
  g.add(tank);
  g.add(cyl(0.32, 0.04, M.steel(), 36).translateY(0.37));
  g.add(cyl(0.32, 0.05, M.steel(), 36).translateY(-0.29));
  const th = THREE.MathUtils.degToRad(11.4);
  const off = 0.01; // 1 mm offset ×10
  const crystal = (x: number, z: number, side: 1 | -1) => {
    const c = new THREE.Group();
    c.add(boxSpan(-0.06, 0.06, -0.035, 0.035, side > 0 ? -0.03 : 0, side > 0 ? 0 : 0.03, M.silicon(), 0.003));
    c.add(boxSpan(-0.065, 0.065, -0.045, 0.045, side > 0 ? -0.05 : 0.03, side > 0 ? -0.03 : 0.05, M.copper(), 0.003));
    c.position.set(x, 0, z);
    c.rotation.y = side * th;
    return c;
  };
  // first crystal face on the beam, second crystal parallel, displaced by the fixed-exit offset
  g.add(crystal(-0.07, -0.001, 1));
  g.add(crystal(0.07, off + 0.001, -1));
  // rotation stage (vertical axis) and LN2 lines up through the lid
  g.add(cyl(0.16, 0.06, M.darkSteel(), 32).translateY(-0.22));
  // LN2 supply/return lines arching over to a wall feedthrough on the FOE's inboard wall (z ≈ −1.3)
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.38, 0), new THREE.Vector3(0, 0.8, 0.05), new THREE.Vector3(0, 1.05, -0.5), new THREE.Vector3(0, 1.0, -1.18)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.03, 8), M.ln2()));
  const curve2 = new THREE.CatmullRomCurve3([new THREE.Vector3(0.08, 0.38, 0), new THREE.Vector3(0.08, 0.75, 0.05), new THREE.Vector3(0.08, 0.98, -0.5), new THREE.Vector3(0.08, 0.93, -1.18)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve2, 24, 0.022, 8), M.ln2()));
  g.add(boxSpan(-0.08, 0.16, 0.82, 1.12, -1.26, -1.18, M.steel(), 0.01));
  for (const s of [-1, 1]) {
    g.add(flangeX(s * 0.3, 0.08));
    g.add(pipeX(s * 0.3, s * 0.45, 0.035));
  }
  g.add(pedestal(0, 0, FLOOR, -0.31, 0.7, 0.7, M.granite()));
  return shadowed(g);
}

/** FDR-baseline Mo/B4C double-multilayer monochromator: drawn as a dashed ghost (installation unconfirmed). */
export function dmmGhost(): THREE.Group {
  const g = new THREE.Group();
  g.add(ghostBox(0.7, 0.5, 0.5));
  const ml = new THREE.MeshStandardMaterial({ color: 0x9a7fd1, roughness: 0.2, metalness: 0.4, transparent: true, opacity: 0.45, depthWrite: false });
  g.add(boxSpan(-0.18, 0.02, -0.03, 0.03, -0.025, -0.001, ml, 0.002));
  g.add(boxSpan(0.0, 0.2, -0.03, 0.03, 0.009, 0.033, ml, 0.002));
  const base = ghostBox(0.5, 1.4 - 0.25, 0.5);
  base.position.y = (FLOOR - 0.25) / 2;
  g.add(base);
  return g;
}

/**
 * Secondary-source aperture: water-cooled Glidcop slit pair with tungsten defining edges (H and V blade pairs), an
 * integrated beam-position monitor, on a stiff granite pedestal. Origin = aperture on axis.
 */
export function ssaAssembly(o: { table?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  g.add(vesselBox(0.3, 0.3, 0.3));
  const open = 0.004; // drawn opening (real: a few µm)
  for (const s of [-1, 1]) {
    // horizontal-defining blades (move in z)
    const hb = boxSpan(-0.05, -0.01, -0.035, 0.035, s * open, s * (open + 0.07), M.glidcop(), 0.003);
    const hEdge = boxSpan(-0.012, -0.004, -0.035, 0.035, s * open, s * (open + 0.012), M.tungsten(), 0.001);
    // vertical-defining blades (move in y)
    const vb = boxSpan(0.01, 0.05, s * open, s * (open + 0.07), -0.035, 0.035, M.glidcop(), 0.003);
    const vEdge = boxSpan(0.004, 0.012, s * open, s * (open + 0.012), -0.035, 0.035, M.tungsten(), 0.001);
    g.add(hb, hEdge, vb, vEdge);
    // actuators
    g.add(pipeZ(s * 0.15, s * 0.3, 0.02, M.blackAnod(), -0.03, 0));
    const a = cyl(0.02, 0.15, M.blackAnod(), 12);
    a.position.set(0.03, s * 0.225, 0);
    g.add(a);
  }
  // cooling-water feedthroughs
  for (const [x, z] of [[-0.03, 0.06], [0.03, -0.06]]) {
    g.add(rod(new THREE.Vector3(x, 0.15, z), new THREE.Vector3(x, 0.24, z), 0.008, M.water(), 8));
    g.add(boxSpan(x - 0.018, x + 0.018, 0.24, 0.265, z - 0.018, z + 0.018, M.steel(), 0.002));
  }
  // integrated BPM (small cross downstream)
  g.add(boxSpan(0.17, 0.27, -0.06, 0.06, -0.06, 0.06, M.steel(), 0.006));
  g.add(pipeZ(-0.11, 0.11, 0.012, M.darkSteel(), 0.22, 0));
  for (const s of [-1, 1]) {
    g.add(flangeX(s * 0.15, 0.07));
    g.add(pipeX(s * 0.15, s * 0.32, 0.03));
  }
  if (o.table) {
    g.add(boxSpan(-0.3, 0.6, -0.27, -0.2, -0.35, 0.35, M.steel(), 0.006));
    g.add(boxSpan(-0.26, 0.55, FLOOR, -0.27, -0.3, 0.3, M.granite(), 0.01));
  } else {
    g.add(boxSpan(-0.2, 0.2, -0.2, -0.15, -0.2, 0.2, M.steel(), 0.006));
    g.add(boxSpan(-0.18, 0.18, FLOOR, -0.2, -0.18, 0.18, M.granite(), 0.01));
  }
  return shadowed(g);
}

/** Lead-shielded transport pipe between x0 and x1 (built centred on its midpoint). */
export function shieldedTransport(x0: number, x1: number, unshielded: [number, number][] = []): THREE.Group {
  const g = new THREE.Group();
  const mid = (x0 + x1) / 2;
  const L = x1 - x0;
  const cuts = [...unshielded].sort((a, b) => a[0] - b[0]);
  let a = x0;
  const segs: [number, number][] = [];
  for (const [c0, c1] of cuts) {
    if (c0 > a) segs.push([a, c0]);
    a = c1;
  }
  if (a < x1) segs.push([a, x1]);
  for (const [s0, s1] of segs) {
    g.add(pipeX(s0 - mid, s1 - mid, 0.1, M.lead(), 0, 0, 28));
    g.add(flangeX(s0 - mid + 0.02, 0.115, 0.04, M.steel()), flangeX(s1 - mid - 0.02, 0.115, 0.04, M.steel()));
  }
  for (const [c0, c1] of cuts) {
    g.add(pipeX(c0 - mid, c1 - mid, 0.03, M.steel()));
    // ion pump + gate valve in the unshielded section
    const cx = (c0 + c1) / 2 - mid;
    g.add(boxSpan(cx - 0.12, cx - 0.04, -0.12, 0.12, -0.05, 0.05, M.steel(), 0.006));
    g.add(boxSpan(cx - 0.1, cx - 0.06, 0.12, 0.3, -0.04, 0.04, M.blackAnod(), 0.004));
    g.add(boxSpan(cx + 0.05, cx + 0.2, -0.22, -0.04, -0.09, 0.09, M.steel(), 0.006));
    g.add(postStand(cx, FLOOR, -0.22));
  }
  const nSup = Math.max(2, Math.round(L / 2.4));
  for (let i = 0; i <= nSup; i++) {
    const x = -L / 2 + 0.3 + ((L - 0.6) * i) / nSup;
    if (cuts.some(([c0, c1]) => x + mid > c0 - 0.2 && x + mid < c1 + 0.2)) continue;
    g.add(postStand(x, FLOOR, -0.1));
  }
  return shadowed(g);
}

/** Thin in-hutch vacuum pipe with supports (segments given in absolute x; built in absolute x, origin at x = 0). */
export function hutchPipe(segs: [number, number][], stands: number[]): THREE.Group {
  const g = new THREE.Group();
  for (const [a, b] of segs) {
    g.add(pipeX(a, b, 0.025, M.steel()));
    g.add(flangeX(a + 0.01, 0.05), flangeX(b - 0.01, 0.05));
  }
  for (const x of stands) g.add(postStand(x, FLOOR, -0.03));
  return shadowed(g);
}

/** Pink-beam stop at the end wall. */
export function pinkBeamStop(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.22, 0.3, 0.3, M.tungsten(), 0.01));
  g.add(boxSpan(0.11, 0.2, -0.2, 0.2, -0.2, 0.2, M.lead(), 0.01));
  g.add(flangeX(-0.13, 0.06), pipeX(-0.4, -0.13, 0.025));
  g.add(pedestal(0, 0, FLOOR, -0.15, 0.3, 0.3, M.steel()));
  return shadowed(g);
}

/** Generic short bellows link (re-export for the layout). */
export { bellowsX };
