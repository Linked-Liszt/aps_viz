import * as THREE from 'three';
import { M, box, boxSpan, cyl, flangeX, pedestal, pipeX, shadowed, vesselBox } from './kit';

/** Floor y for a component whose origin sits `dy` above the beam. */
const floorY = (beamY: number, dy = 0) => -beamY - dy;

// ------------------------------------------------------------------ source straight

/**
 * The three canting dipoles of the 34-ID straight (origin = straight centre): 0.5 mrad at each end, 1 mrad between the
 * U28 (upstream, −1.2 m) and the revolver (downstream, +1.2 m). C-shaped yokes open to the outboard side so the photon
 * beams can leave; positions of the end magnets (±2.45 m) are approximate.
 */
export function cantingMagnets(beamY: number): THREE.Group {
  const g = new THREE.Group();
  for (const [x, L] of [[-2.45, 0.24], [0, 0.2], [2.45, 0.24]] as const) {
    const m = new THREE.Group();
    m.position.x = x;
    const back = boxSpan(-L / 2, L / 2, -0.2, 0.2, -0.24, -0.12, M.magnet(), 0.01);
    const top = boxSpan(-L / 2, L / 2, 0.035, 0.2, -0.24, 0.1, M.magnet(), 0.01);
    const bot = boxSpan(-L / 2, L / 2, -0.2, -0.035, -0.24, 0.1, M.magnet(), 0.01);
    const c1 = boxSpan(-L / 2 - 0.03, L / 2 + 0.03, 0.05, 0.11, -0.1, 0.06, M.coil(), 0.012);
    const c2 = boxSpan(-L / 2 - 0.03, L / 2 + 0.03, -0.11, -0.05, -0.1, 0.06, M.coil(), 0.012);
    m.add(back, top, bot, c1, c2, pedestal(0, -0.07, floorY(beamY), -0.2, L * 0.8, 0.3, M.darkSteel()));
    g.add(m);
  }
  return shadowed(g);
}

// ------------------------------------------------------------------ shielding blocks

export interface BlockOpts {
  beamY: number;
  len?: number;
  w?: number;
  h?: number;
  mat?: 'lead' | 'tungsten' | 'copper';
  /** lateral offsets (relative to the component origin) of the apertures */
  holes?: number[];
  hole?: number;
}

/** Bremsstrahlung collimator / photon mask: a heavy block on a stand with dark apertures on both faces. */
export function shieldBlock(o: BlockOpts): THREE.Group {
  const g = new THREE.Group();
  const len = o.len ?? 0.3;
  const w = o.w ?? 0.32;
  const h = o.h ?? 0.32;
  const mat = o.mat === 'tungsten' ? M.tungsten() : o.mat === 'copper' ? M.copper() : M.lead();
  g.add(box(len, h, w, mat, 0.01));
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x07090c });
  for (const z of o.holes ?? [0]) {
    for (const s of [-1, 1]) {
      const ap = new THREE.Mesh(new THREE.PlaneGeometry(o.hole ?? 0.03, o.hole ?? 0.03), holeMat);
      ap.rotation.y = (s * Math.PI) / 2;
      ap.position.set((s * (len + 0.002)) / 2, 0, z);
      g.add(ap);
    }
  }
  g.add(pipeX(-len / 2 - 0.25, -len / 2, 0.03), pipeX(len / 2, len / 2 + 0.25, 0.03));
  g.add(pedestal(0, 0, floorY(o.beamY), -h / 2, len * 0.8, w * 0.8, M.darkSteel()));
  return shadowed(g);
}

/** Pink-photon mask + white-beam stop at the end of the FOE: a lead-shielded block, copper core, two pink-beam ports. */
export function whiteBeamStop(beamY: number, holes: number[]): THREE.Group {
  const g = new THREE.Group();
  const shell = box(0.5, 0.62, 0.62, M.lead(), 0.015);
  const core = box(0.52, 0.16, 0.24, M.copper(), 0.01);
  g.add(shell, core);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050608 });
  for (const z of holes) {
    const ap = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), holeMat);
    ap.rotation.y = -Math.PI / 2;
    ap.position.set(-0.262, 0, z);
    g.add(ap);
  }
  // water-cooling lines on the copper core
  for (const z of [-0.08, 0.08]) {
    const p = cyl(0.012, 0.5, M.steel(), 10);
    p.position.set(0, 0.55, z);
    g.add(p);
  }
  g.add(pipeX(-0.55, -0.25, 0.035), pipeX(0.25, 0.55, 0.035));
  g.add(pedestal(0, 0, floorY(beamY), -0.31, 0.4, 0.5, M.darkSteel()));
  return shadowed(g);
}

/**
 * Pink-beam photon/safety shutter. FDR Table 4.63 puts ATOMIC's SH-1 and 3DMN's SH-2 side by side at 54.8 m with the two
 * beams only ~0.38 m apart, so each is drawn as a compact 0.3 m-wide unit (the shared generic part is 0.5 m wide and
 * the pair would interpenetrate).
 */
export function pinkShutter(beamY: number, color = 0xd9a531): THREE.Group {
  const g = new THREE.Group();
  // 0.36 m long so that the unit at 54.8 m stays inside 34-ID-C (C/E wall ~55.0 m); the downstream stub runs into the wall
  const body = box(0.36, 0.7, 0.3, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 }), 0.02);
  body.position.y = 0.13;
  const cap = box(0.38, 0.06, 0.32, M.darkSteel(), 0.01);
  cap.position.y = 0.51;
  const actuator = cyl(0.04, 0.16, M.steel(), 16);
  actuator.position.y = 0.62;
  g.add(body, cap, actuator, pipeX(-0.36, -0.18, 0.03), pipeX(0.18, 0.3, 0.03));
  g.add(pedestal(0, 0, floorY(beamY), -0.22, 0.32, 0.26, M.darkSteel()));
  return shadowed(g);
}

/** Pink-beam stop at the end of the 3DMN branch: tungsten core in a lead house. */
export function pinkBeamStop(beamY: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.32, 0.4, 0.36, M.lead(), 0.012));
  const face = box(0.02, 0.12, 0.12, M.tungsten(), 0.004);
  face.position.x = -0.165;
  g.add(face, pipeX(-0.4, -0.16, 0.03), pedestal(0, 0, floorY(beamY), -0.2, 0.26, 0.3, M.darkSteel()));
  return shadowed(g);
}

// ------------------------------------------------------------------ shielded transports

/**
 * Lead-jacketed vacuum transport drawn with its top quarter cut away (museum style) so the beams inside stay visible.
 * Runs from x = 0 to `len` along +X; `supports` are x positions of floor stands (relative to the start).
 */
export function shieldedPipe(o: { beamY: number; len: number; rIn: number; rOut: number; supports: number[]; z?: number; ghost?: boolean }): THREE.Group {
  const g = new THREE.Group();
  const z = o.z ?? 0;
  const t0 = (3 * Math.PI) / 4;
  const tl = (3 * Math.PI) / 2;
  // `ghost`: partner hardware drawn as a faint see-through shell so it never hides this beamline's instruments
  const see = o.ghost ? { transparent: true, opacity: 0.16, depthWrite: false } : {};
  const jacket = new THREE.Mesh(new THREE.CylinderGeometry(o.rOut, o.rOut, o.len, 36, 1, true, t0, tl), new THREE.MeshStandardMaterial({ color: 0x6d7681, roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide, ...see }));
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(o.rIn, o.rIn, o.len, 36, 1, true, t0, tl), new THREE.MeshStandardMaterial({ color: 0xc5cdd6, roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide, ...(o.ghost ? { transparent: true, opacity: 0.1, depthWrite: false } : {}) }));
  for (const m of [jacket, inner]) {
    m.rotation.z = Math.PI / 2;
    m.position.set(o.len / 2, 0, z);
    g.add(m);
  }
  // annular end caps + collars every ~2 m (also cut away)
  const n = Math.max(1, Math.round(o.len / 2));
  const collarMat = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: 0.35, metalness: 0.75, side: THREE.DoubleSide, ...(o.ghost ? { transparent: true, opacity: 0.45, depthWrite: false } : {}) });
  const collarGeo = new THREE.RingGeometry(o.rIn, o.rOut + 0.012, 36, 1, t0, tl);
  for (let i = 0; i <= n; i++) {
    const ring = new THREE.Mesh(collarGeo, collarMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.set((i / n) * o.len, 0, z);
    g.add(ring);
  }
  for (const x of o.supports) {
    const s = pedestal(x, z, floorY(o.beamY), -o.rOut, 0.08, 0.22, M.darkSteel());
    const cradle = boxSpan(x - 0.06, x + 0.06, -o.rOut - 0.03, -o.rOut + 0.01, z - 0.13, z + 0.13, M.steel(), 0.004);
    g.add(s, cradle);
  }
  return shadowed(g);
}

/** Thin semi-transparent flight tube on light stands (beam stays visible). */
export function flightTube(beamY: number, x0: number, x1: number, r = 0.028, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.add(pipeX(x0, x1, r, M.tube(), 0, z));
  const n = Math.max(1, Math.round((x1 - x0) / 1.6));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const f = flangeX(r + 0.012);
    f.position.set(x, 0, z);
    g.add(f);
    if (i > 0 && i < n) g.add(pedestal(x, z, -beamY, -r, 0.04, 0.12, M.steel()));
  }
  return shadowed(g);
}

// ------------------------------------------------------------------ small-offset horizontal DCM

/**
 * Horizontally deflecting Si(111) double-crystal monochromator, cut-away tank. The crystals' faces are vertical and set
 * at the Bragg angle about the vertical axis (12.5° = 9.1 keV, the FDR heat-load case). The real ~1.1 mm offset is drawn
 * ×18 (20 mm) so the two crystals can be told apart. `bypass` lowers the crystal pair 45 mm below the beam (pink mode);
 * the second crystal carries the heater (~60 K warmer) that steers the mono beam onto the pink focus.
 */
export function hdcm(o: { beamY: number; bypass?: boolean; thetaDeg?: number; heater?: boolean }): THREE.Group {
  const g = new THREE.Group();
  const th = THREE.MathUtils.degToRad(o.thetaDeg ?? 12.5);
  const R = 0.3;
  const H = 0.56;
  // tank: translucent wall, opaque base, half lid (cut-away)
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 40, 1, true), M.vessel());
  wall.renderOrder = 3;
  const base = cyl(R + 0.02, 0.05, M.steel(), 40);
  base.position.y = -H / 2;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, 0.04, 40, 1, false, Math.PI / 2, Math.PI), M.steel());
  lid.position.y = H / 2;
  const rimGeo = new THREE.TorusGeometry(R, 0.01, 6, 48);
  const rim = new THREE.Mesh(rimGeo, M.steel());
  rim.rotation.x = Math.PI / 2;
  rim.position.y = H / 2;
  g.add(wall, base, lid, rim);
  // crystal cage on the Bragg rotation stage
  const cage = new THREE.Group();
  cage.position.y = o.bypass ? -0.045 : 0;
  const off = 0.02;
  const D = off / Math.sin(2 * th);
  const x1 = -(D * Math.cos(2 * th)) / 2;
  const x2 = -x1;
  const mk = (x: number, z: number, side: 1 | -1, heater: boolean) => {
    const c = new THREE.Group();
    const xtal = box(0.07, 0.045, 0.022, M.silicon(), 0.002);
    xtal.position.z = (side * 0.011);
    const holder = box(0.08, 0.055, 0.016, M.copper(), 0.003);
    holder.position.z = side * 0.03;
    c.add(xtal, holder);
    if (heater) {
      const pad = box(0.05, 0.03, 0.004, M.heater(), 0.001);
      pad.position.z = side * 0.04;
      c.add(pad);
    }
    // face plane makes angle θ with the beam about +Y; crystal body on the far side of its reflecting face
    c.rotation.y = -th;
    c.position.set(x, 0, z);
    return c;
  };
  cage.add(mk(x1, 0, -1, false), mk(x2, off, 1, o.heater ?? false));
  const plate = boxSpan(-0.13, 0.13, -0.05, -0.035, -0.08, 0.1, M.steel(), 0.004);
  const rot = cyl(0.09, 0.08, M.darkSteel(), 32);
  rot.position.y = -0.1;
  cage.add(plate, rot);
  g.add(cage);
  // vertical translation guide (bypass) and the pink-beam path label-free cue
  const guide = boxSpan(-0.02, 0.02, -0.26, -0.06, -0.12, -0.1, M.darkSteel(), 0.003);
  g.add(guide);
  for (const x of [-R - 0.01, R + 0.01]) {
    const f = flangeX(0.075);
    f.position.x = x;
    g.add(f);
  }
  g.add(pipeX(-R - 0.35, -R, 0.035), pipeX(R, R + 0.35, 0.035));
  g.add(pedestal(0, 0, -o.beamY, -H / 2 - 0.025, 0.55, 0.55, M.granite()));
  return shadowed(g);
}

export { vesselBox };

// ------------------------------------------------------------------ first-optics-enclosure mirrors

/**
 * Flat, horizontally deflecting first mirror (3.0 mrad grazing, 6 mrad deflection). The neighbouring canted beam passes
 * only ~30 mm away, so the substrate is drawn thin (22 mm) and side-on; its face carries the three coating stripes
 * (Si / Rh / Pt, chosen by vertical translation). `deflect` = +1 → face toward +Z (outboard deflection, 3DMN);
 * −1 → inboard (ATOMIC). Substrate length is not published; 0.7 m is illustrative (the tank must fit between the
 * tabulated collimators 0.7 m either side).
 */
export function foeMirror(o: { beamY: number; deflect: 1 | -1; lengthM?: number }): THREE.Group {
  const g = new THREE.Group();
  const L = o.lengthM ?? 0.7;
  const s = o.deflect;
  g.add(vesselBox(L + 0.36, 0.46, 0.46));
  const sub = boxSpan(-L / 2, L / 2, -0.035, 0.035, s > 0 ? -0.022 : 0, s > 0 ? 0 : 0.022, M.silicon(), 0.002);
  g.add(sub);
  const stripes: [number, number][] = [[0x8fa3c4, 0.0215], [0xd5dbe3, 0], [0xf2f3f8, -0.0215]]; // Si, Rh, Pt
  for (const [c, y] of stripes) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.98, 0.019), new THREE.MeshStandardMaterial({ color: c, roughness: 0.05, metalness: 1 }));
    f.rotation.y = s > 0 ? 0 : Math.PI;
    f.position.set(0, y, s * 0.0008);
    g.add(f);
  }
  // holder, cooling lines, translation stage and stand
  g.add(boxSpan(-L / 2 - 0.02, L / 2 + 0.02, -0.05, -0.035, s > 0 ? -0.05 : -0.005, s > 0 ? 0.005 : 0.05, M.copper(), 0.003));
  for (const x of [-L / 3, L / 3]) {
    const p = cyl(0.008, 0.2, M.copper(), 8);
    p.position.set(x, 0.13, -s * 0.03);
    g.add(p);
  }
  g.add(boxSpan(-L / 2 - 0.15, L / 2 + 0.15, -0.3, -0.23, -0.3, 0.3, M.steel(), 0.01));
  g.add(boxSpan(-0.1, 0.1, -0.23, -0.05, -0.08, 0.08, M.darkSteel(), 0.004));
  for (const x of [-(L + 0.36) / 2 - 0.01, (L + 0.36) / 2 + 0.01]) {
    const f = flangeX(0.08);
    f.position.x = x;
    g.add(f);
  }
  g.add(pipeX(-(L + 0.36) / 2 - 0.06, -(L + 0.36) / 2, 0.04), pipeX((L + 0.36) / 2, (L + 0.36) / 2 + 0.06, 0.04));
  g.add(pedestal(0, 0, -o.beamY, -0.3, L * 0.7, 0.5, M.granite()));
  return shadowed(g);
}
