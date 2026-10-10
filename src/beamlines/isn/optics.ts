import * as THREE from 'three';
import { FLOOR } from './geom';
import { M, bar, boxSpan, cyl, flangeX, pedestal, pipeX, rod, shadowed, vesselBox, vesselSpan } from './kit';

/**
 * 19-ID-A optics (first optics enclosure) and the two beam-defining-aperture assemblies of 19-ID-C/D.
 * Each builder's origin is the component's position on the beam axis.
 */

const stripeMats = () => [
  new THREE.MeshStandardMaterial({ color: 0x8fa3c4, roughness: 0.06, metalness: 0.6 }), // bare Si
  new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.05, metalness: 1.0 }), // Cr
  new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.04, metalness: 1.0 }), // Pt
];

/** Three coating stripes (Si / Cr / Pt) across a reflecting face lying in the XZ plane at y = 0 (normal ±Y). */
function stripes(L: number, w: number, up: boolean): THREE.Group {
  const g = new THREE.Group();
  const sw = w / 3;
  stripeMats().forEach((m, i) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(L, sw * 0.92), m);
    p.rotation.x = up ? -Math.PI / 2 : Math.PI / 2;
    p.position.z = -w / 2 + sw * (i + 0.5);
    g.add(p);
  });
  return g;
}

/** Steel rim around the (translucent) lid of a vacuum tank, so the optics inside stay visible from above. */
function lidRim(x0: number, x1: number, y: number, halfW: number): THREE.Group {
  const g = new THREE.Group();
  for (const z of [-halfW, halfW]) g.add(boxSpan(x0 - 0.015, x1 + 0.015, y - 0.01, y + 0.015, z - 0.015, z + 0.015, M.steel(), 0.003));
  for (const x of [x0, x1]) g.add(boxSpan(x - 0.015, x + 0.015, y - 0.01, y + 0.015, -halfW, halfW, M.steel(), 0.003));
  return g;
}

/**
 * Shared M1/M2 vacuum tank (NIMA 2020 Fig. 3a: one vessel ~27.4–29.4 m) with M1 inside. Origin = M1 centre (28.0 m).
 * M1: flat 400 × 50 × 50 mm Si, above the beam, reflecting DOWN at 2.5 mrad; side-notch water cooling.
 */
export function m1Tank(): THREE.Group {
  const g = new THREE.Group();
  const x0 = -0.6;
  const x1 = 1.4;
  g.add(vesselSpan(x0, x1, -0.3, 0.3, -0.4, 0.4));
  // lid and floor plates, ports
  g.add(lidRim(x0, x1, 0.3, 0.4));
  g.add(boxSpan(x0 - 0.02, x1 + 0.02, -0.33, -0.3, -0.42, 0.42, M.steel(), 0.01));
  for (const x of [x0, x1]) {
    const f = flangeX(0.1);
    f.position.x = x;
    g.add(f);
  }
  g.add(pipeX(x0 - 0.35, x0, 0.035), pipeX(x1, x1 + 0.3, 0.035));
  const pump = cyl(0.1, 0.25, M.steel(), 20);
  pump.position.set(0.4, -0.48, -0.25);
  g.add(pump);
  // M1 substrate above the beam, face down
  const L = 0.4;
  g.add(boxSpan(-L / 2, L / 2, 0.0015, 0.0515, -0.025, 0.025, M.silicon(), 0.002));
  const s = stripes(L, 0.05, false);
  s.position.y = 0.0012;
  g.add(s);
  // side-notch cooling bars (copper) along both sides, close to the reflecting surface
  for (const z of [-1, 1]) g.add(boxSpan(-L / 2 + 0.01, L / 2 - 0.01, 0.008, 0.024, z * 0.026, z * 0.04, M.copper(), 0.002));
  // hanger bridge from two side posts
  for (const z of [-0.14, 0.14]) {
    g.add(boxSpan(-0.17, -0.11, -0.3, 0.12, z - 0.03, z + 0.03, M.darkSteel(), 0.004));
    g.add(boxSpan(0.11, 0.17, -0.3, 0.12, z - 0.03, z + 0.03, M.darkSteel(), 0.004));
  }
  g.add(boxSpan(-0.18, 0.18, 0.09, 0.13, -0.17, 0.17, M.darkSteel(), 0.004));
  g.add(boxSpan(-0.16, 0.16, 0.0515, 0.09, -0.03, 0.03, M.steel(), 0.003));
  // water lines up through the lid
  for (const z of [-0.035, 0.035]) g.add(rod(new THREE.Vector3(-0.1, 0.02, z), new THREE.Vector3(-0.1, 0.33, z * 3), 0.006, M.copper(), 8));
  // stand
  g.add(pedestal(0.4, 0, FLOOR, -0.33, 1.4, 0.6, M.granite()));
  return shadowed(g);
}

/** M2: bendable 400 mm Si mirror below the beam, reflecting UP at 2.5 mrad (inside the shared tank). */
export function m2Bender(): THREE.Group {
  const g = new THREE.Group();
  const L = 0.4;
  g.add(boxSpan(-L / 2, L / 2, -0.0515, -0.0015, -0.025, 0.025, M.silicon(), 0.002));
  const s = stripes(L, 0.05, true);
  s.position.y = -0.0012;
  g.add(s);
  for (const z of [-1, 1]) g.add(boxSpan(-L / 2 + 0.01, L / 2 - 0.01, -0.024, -0.008, z * 0.026, z * 0.04, M.copper(), 0.002));
  // bender: end clamps, push rods, actuator
  for (const e of [-1, 1]) {
    g.add(boxSpan(e * (L / 2) - 0.03, e * (L / 2) + 0.03, -0.11, -0.02, -0.05, 0.05, M.darkSteel(), 0.004));
    g.add(rod(new THREE.Vector3(e * 0.13, -0.05, 0), new THREE.Vector3(e * 0.05, -0.16, 0), 0.008, M.steel(), 8));
  }
  g.add(boxSpan(-0.07, 0.07, -0.22, -0.16, -0.06, 0.06, M.blackAnod(), 0.006));
  g.add(boxSpan(-0.26, 0.26, -0.3, -0.22, -0.12, 0.12, M.steel(), 0.006));
  return shadowed(g);
}

/** PM-1: copper white-beam stop with the pink-beam aperture ~5 mm below the old straight-through axis. */
export function whiteBeamStop(): THREE.Group {
  const g = new THREE.Group();
  g.add(boxSpan(-0.08, 0.08, 0.004, 0.16, -0.12, 0.12, M.copper(), 0.008));
  g.add(boxSpan(-0.08, 0.08, -0.16, -0.012, -0.12, 0.12, M.copper(), 0.008));
  g.add(pedestal(0, 0, FLOOR, -0.16, 0.14, 0.2, M.darkSteel()));
  return shadowed(g);
}

/**
 * Horizontally deflecting, LN2-cooled small-offset Si(111) DCM. Crystals stand vertically (Bragg axis vertical) and are
 * drawn at θB = 11.4° (10 keV); the first crystal sits outboard and turns the beam inboard, the second restores it.
 * The few-mm offset is not published and is drawn as zero (the beam runs between the crystal faces).
 */
export function horizontalDcm(): THREE.Group {
  const g = new THREE.Group();
  g.add(vesselSpan(-0.38, 0.38, -0.3, 0.26, -0.3, 0.3));
  g.add(lidRim(-0.38, 0.38, 0.26, 0.3));
  g.add(boxSpan(-0.4, 0.4, -0.33, -0.3, -0.32, 0.32, M.steel(), 0.01));
  // Bragg rotary table
  const rot = cyl(0.2, 0.05, M.darkSteel(), 40);
  rot.position.y = -0.27;
  g.add(rot);
  const th = (11.4 * Math.PI) / 180;
  for (const [x, side] of [[-0.055, 1], [0.055, -1]] as const) {
    const xt = new THREE.Group();
    xt.add(boxSpan(-0.05, 0.05, -0.04, 0.04, 0, side * 0.018, M.crystal(), 0.002));
    xt.add(boxSpan(-0.055, 0.055, -0.045, 0.045, side * 0.018, side * 0.04, M.copper(), 0.003));
    xt.add(boxSpan(-0.04, 0.04, -0.25, -0.045, side * 0.012, side * 0.04, M.darkSteel(), 0.003));
    xt.position.set(x, 0, side * 0.0015);
    xt.rotation.y = side > 0 ? th : th; // both faces parallel (non-dispersive pair)
    g.add(xt);
    // LN2 braids to the lid
    g.add(rod(new THREE.Vector3(x, 0.05, side * 0.03), new THREE.Vector3(x * 2, 0.26, side * 0.12), 0.008, M.ln2(), 8));
  }
  // LN2 feed lines leaving the lid
  // vacuum-jacketed LN2 transfer line leaving the lid toward the outboard cryocooler (not drawn)
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.26, 0.18), new THREE.Vector3(0, 0.46, 0.2), new THREE.Vector3(0, 0.58, 0.36), new THREE.Vector3(0, 0.6, 0.85)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.024, 10), M.ln2()));
  for (const x of [-0.38, 0.38]) {
    const f = flangeX(0.09);
    f.position.x = x;
    g.add(f);
  }
  g.add(pipeX(-0.6, -0.38, 0.035), pipeX(0.38, 0.6, 0.035));
  g.add(pedestal(0, 0, FLOOR, -0.33, 0.7, 0.6, M.granite()));
  return shadowed(g);
}

/**
 * Double-multilayer monochromator (FDR design: Mo/B4C, 300 bilayers, horizontal, LN2-cooled). Its installation is not
 * confirmed (2026 directory lists only the H-DCM), so the vessel is drawn as a dashed "design" ghost with the two
 * multilayer mirrors parked clear of the beam (DCM mode).
 */
export function dmmGhost(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(1.1, 0.6, 0.8);
  const shell = new THREE.Mesh(geo, M.vessel());
  shell.position.y = -0.02;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineDashedMaterial({ color: 0xb79cf0, dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.8 }));
  edges.position.y = -0.02;
  edges.computeLineDistances();
  g.add(shell, edges);
  for (const [x, side] of [[-0.2, 1], [0.2, -1]] as const) {
    g.add(boxSpan(x - 0.15, x + 0.15, -0.035, 0.035, side * 0.02, side * 0.05, M.multilayer(), 0.002));
    g.add(boxSpan(x - 0.16, x + 0.16, -0.04, 0.04, side * 0.05, side * 0.08, M.copper(), 0.003));
    g.add(boxSpan(x - 0.12, x + 0.12, -0.3, -0.04, side * 0.03, side * 0.08, M.darkSteel(), 0.003));
  }
  g.add(pipeX(-0.55, 0.55, 0.03));
  g.add(pedestal(0, 0, FLOOR, -0.32, 0.9, 0.6, M.granite()));
  return shadowed(g);
}

/**
 * M3: bendable Pt-coated horizontal focusing mirror, 2.5 mrad, deflecting the beam 5 mrad INBOARD. To turn the beam
 * inboard the reflecting face points inboard, so the substrate sits on the OUTBOARD side of the beam. Vertical
 * translation selects the stripe. (Mirror length is not published: drawn 0.4 m like M1/M2.)
 */
export function m3Mirror(): THREE.Group {
  const g = new THREE.Group();
  g.add(vesselSpan(-0.42, 0.42, -0.28, 0.28, -0.3, 0.3));
  g.add(lidRim(-0.42, 0.42, 0.28, 0.3));
  g.add(boxSpan(-0.44, 0.44, -0.31, -0.28, -0.32, 0.32, M.steel(), 0.01));
  const L = 0.4;
  g.add(boxSpan(-L / 2, L / 2, -0.035, 0.035, 0.0015, 0.05, M.silicon(), 0.002));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.98, 0.065), M.platinum());
  face.position.z = 0.0012;
  face.rotation.y = Math.PI; // facing −Z (inboard)
  g.add(face);
  // bender clamps + actuator on the back (outboard) side
  for (const e of [-1, 1]) g.add(boxSpan(e * L / 2 - 0.03, e * L / 2 + 0.03, -0.05, 0.05, 0.03, 0.11, M.darkSteel(), 0.004));
  g.add(boxSpan(-0.06, 0.06, -0.04, 0.04, 0.11, 0.18, M.blackAnod(), 0.004));
  // vertical (stripe-select) stage
  g.add(boxSpan(-0.22, 0.22, -0.28, -0.05, 0.0, 0.16, M.steel(), 0.006));
  for (const x of [-0.42, 0.42]) {
    const f = flangeX(0.09);
    f.position.x = x;
    g.add(f);
  }
  g.add(pipeX(-0.65, -0.42, 0.035), pipeX(0.42, 0.65, 0.035));
  g.add(pedestal(0, 0, FLOOR, -0.31, 0.7, 0.6, M.granite()));
  return shadowed(g);
}

/**
 * Beam-defining aperture assembly (19ID-SL-4 vertical at 55 m, 19ID-SL-5 horizontal at 64 m): a granite base that
 * widens downstream (as drawn in the NIMA 2020 plan), a beam-position monitor, the water-cooled slit chamber whose two
 * jaws meet the beam at a grazing angle (a jaw facing the beam head-on would pass 850 K), and a removable flag.
 * The jaw gap (3.5–4 µm at its smallest) is drawn ~3 mm, i.e. ~1000× enlarged.
 */
export function bdaAssembly(dir: 'v' | 'h'): THREE.Group {
  const g = new THREE.Group();
  // granite trapezoid
  const shape = new THREE.Shape([new THREE.Vector2(-0.8, -0.32), new THREE.Vector2(0.8, -0.55), new THREE.Vector2(0.8, 0.55), new THREE.Vector2(-0.8, 0.32)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.95, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, FLOOR, 0);
  g.add(new THREE.Mesh(geo, M.granite()));
  const top = FLOOR + 0.95;
  // slit chamber
  g.add(vesselBox(0.26, 0.26, 0.26));
  for (const s of [-1, 1]) {
    // jaw motor housings on two opposite faces (top/bottom for V, sides for H)
    const housing = dir === 'v' ? boxSpan(-0.07, 0.07, s * 0.13, s * 0.33, -0.07, 0.07, M.blackAnod(), 0.01) : boxSpan(-0.07, 0.07, -0.07, 0.07, s * 0.13, s * 0.33, M.blackAnod(), 0.01);
    g.add(housing);
    // grazing jaw (tilted ~4°, drawn exaggerated) with its tungsten tip at the beam
    const jaw = new THREE.Group();
    jaw.add(boxSpan(-0.06, 0.06, 0, 0.03, -0.035, 0.035, M.tungsten(), 0.002));
    jaw.add(boxSpan(-0.05, 0.05, 0.03, 0.05, -0.03, 0.03, M.copper(), 0.002));
    const tilt = 0.07;
    if (dir === 'v') {
      jaw.rotation.z = s > 0 ? -tilt : Math.PI + tilt;
      jaw.position.set(0, s * 0.0016, 0);
    } else {
      jaw.rotation.x = s > 0 ? Math.PI / 2 + tilt : -Math.PI / 2 - tilt;
      jaw.position.set(0, 0, s * 0.0016);
    }
    g.add(jaw);
    // cooling-water hoses: leave the chamber clear of the jaw drives and rise to the top (hose runs beyond are not drawn)
    const xw = s > 0 ? -0.06 : 0.06;
    const hose = (pts: THREE.Vector3[]) => {
      for (let i = 0; i < pts.length - 1; i++) g.add(rod(pts[i], pts[i + 1], 0.006, M.copper(), 8));
    };
    if (dir === 'v') hose([new THREE.Vector3(xw, s * 0.05, 0.13), new THREE.Vector3(xw, s * 0.05, 0.22), new THREE.Vector3(xw, 0.42, 0.22)]);
    else hose([new THREE.Vector3(xw, 0.13, s * 0.05), new THREE.Vector3(xw, 0.42, s * 0.05)]);
  }
  g.add(boxSpan(-0.1, 0.1, top, -0.13, -0.12, 0.12, M.steel(), 0.006));
  // upstream BPM cross and downstream flag
  for (const [x, cam] of [[-0.5, 0.16], [0.5, 0.16]] as const) {
    g.add(boxSpan(x - 0.08, x + 0.08, -0.08, 0.08, -0.08, 0.08, M.steel(), 0.01));
    const c = cyl(0.03, 0.12, M.detector(), 12);
    c.rotation.x = Math.PI / 2;
    c.position.set(x, 0, cam);
    g.add(c);
    g.add(boxSpan(x - 0.05, x + 0.05, top, -0.08, -0.06, 0.06, M.steel(), 0.004));
  }
  const act = cyl(0.025, 0.2, M.darkSteel(), 12);
  act.position.set(0.5, 0.18, 0);
  g.add(act);
  g.add(pipeX(-0.85, -0.58, 0.03), pipeX(-0.42, -0.13, 0.03), pipeX(0.13, 0.42, 0.03), pipeX(0.58, 0.85, 0.03));
  return shadowed(g);
}

/**
 * Open-ended partial cylinder along +X (x0..x1) at (y, z), cut away over a 120° window on the top / `open` side so the beam
 * inside stays visible (museum cut-away). Cylinder angle θ maps to (y = r·sinθ, z = r·cosθ).
 */
export function cutTube(x0: number, x1: number, r: number, m: THREE.Material, open: 1 | 0 | -1 = 0, y = 0, z = 0): THREE.Mesh {
  const start = open > 0 ? (2 * Math.PI) / 3 : open < 0 ? Math.PI : (5 * Math.PI) / 6;
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, x1 - x0, 28, 1, true, start, (4 * Math.PI) / 3), m);
  c.rotation.z = Math.PI / 2;
  c.position.set((x0 + x1) / 2, y, z);
  return c;
}

const jacketMat = new THREE.MeshStandardMaterial({ color: 0x6d7681, roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide });
const innerMat = new THREE.MeshStandardMaterial({ color: 0xc5cdd6, roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide });

/** Lead-shielded 4-inch vacuum transport along +X from x0 to x1 (component origin at x = 0), jacket cut away on top. */
export function shieldedSpan(x0: number, x1: number, every = 3, open: 1 | 0 | -1 = 0): THREE.Group {
  const g = new THREE.Group();
  const len = x1 - x0;
  g.add(cutTube(x0, x1, 0.11, jacketMat, open), cutTube(x0, x1, 0.057, innerMat, open));
  const n = Math.max(1, Math.round(len / every));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (i / n) * len;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 6, 24), M.steel());
    ring.rotation.y = Math.PI / 2;
    ring.position.x = x;
    g.add(ring);
    if (i > 0 && i < n) g.add(pedestal(x, 0, FLOOR, -0.11, 0.07, 0.2, M.darkSteel()));
  }
  return shadowed(g);
}

/** Simple steel bar (used for gantries / frames). */
export const frameBar = bar;
