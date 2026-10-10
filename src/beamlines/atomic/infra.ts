import * as THREE from 'three';
import { M, box, boxSpan, cyl, flangeX, pedestal, pipeX, shadowed, vesselBox } from './kit';

/**
 * Shared 34-ID hardware (canting magnets, front-end exit table blocks, FOE mirrors, white-beam stop, pink shutters, shielded
 * transports), vendored from the 3DMN exhibit so that both canted-partner exhibits draw the same physical objects alike.
 */

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

// ------------------------------------------------------------------ canted undulator front end (in the tunnel)

/**
 * Canted-undulator front end (CUFE) as a schematic train of vacuum hardware, origin = the documented upstream fixed mask at
 * 19.4 m (FDR Ch. 3). Order as in the FDR CUFE description: permanent-magnet clearing magnet, low-power photon shutter (LPPS),
 * storage-ring valve, burn-through fixed mask, fixed mask, GRID XBPM1, photon shutter, two safety shutters, differential
 * pumps (windowless exit), then the ratchet wall at ~24.4 m. Both canted beams share the chamber (2–2.5 cm apart here).
 * Positions other than the 19.4 m mask are illustrative (≈15.6–24.0 m).
 */
export function frontEndTrain(beamY: number, x0 = -3.8, x1 = 4.6): THREE.Group {
  const g = new THREE.Group();
  const fy = floorY(beamY);
  const z = 0.012; // chamber centred between the two beams (ATOMIC at 0, 3DMN +0.02–0.024 m)
  const actMat = new THREE.MeshStandardMaterial({ color: 0xd9a531, roughness: 0.5, metalness: 0.3 });
  const pumpMat = new THREE.MeshStandardMaterial({ color: 0x8a96a6, roughness: 0.5, metalness: 0.6 });
  const at = (o: THREE.Object3D, x: number, y = 0, zz = z) => {
    o.position.set(x, y, zz);
    g.add(o);
    return o;
  };
  // continuous chamber + flanges
  g.add(pipeX(x0, x1, 0.032, M.steel(), 0, z));
  for (let x = x0 + 0.4; x < x1; x += 0.9) {
    const f = flangeX(0.055);
    at(f, x);
  }
  /** a pneumatic actuator standing on top of a unit of height h */
  const actuator = (x: number, h: number, len = 0.22) => {
    at(cyl(0.035, len, actMat, 16), x, h + len / 2);
    at(box(0.1, 0.03, 0.1, M.darkSteel(), 0.005), x, h + 0.015);
  };
  const stand = (x: number, top: number, w = 0.24, d = 0.24) => g.add(pedestal(x, z, fy, top, w, d, M.darkSteel()));

  // clearing magnet (permanent-magnet C dipole sweeping charged particles out of the photon path)
  {
    const cx = -3.5;
    at(box(0.22, 0.07, 0.24, M.magnet(), 0.008), cx, 0.07);
    at(box(0.22, 0.07, 0.24, M.magnet(), 0.008), cx, -0.07);
    at(box(0.22, 0.21, 0.06, M.magnet(), 0.008), cx, 0, z - 0.12);
    stand(cx, -0.105, 0.18, 0.2);
  }
  // LPPS: small chamber with a pneumatic paddle
  at(vesselBox(0.18, 0.18, 0.18), -3.0);
  at(box(0.04, 0.09, 0.08, M.copper(), 0.004), -3.0, 0.035);
  actuator(-3.0, 0.09, 0.18);
  stand(-3.0, -0.09, 0.16, 0.16);
  // storage-ring valve (all-metal gate valve)
  at(box(0.09, 0.34, 0.22, M.steel(), 0.01), -2.35, 0.06);
  actuator(-2.35, 0.23, 0.2);
  // burn-through fixed mask and the fixed mask (water-cooled GlidCop blocks)
  at(box(0.3, 0.2, 0.2, M.copper(), 0.01), -1.4);
  stand(-1.4, -0.1, 0.24, 0.18);
  at(box(0.55, 0.26, 0.26, M.copper(), 0.012), 0);
  for (const zz of [-0.07, 0.07]) at(cyl(0.01, 0.22, M.steel(), 10), 0.12, 0.24, z + zz);
  stand(0, -0.13, 0.42, 0.2);
  // GRID XBPM1: cube vessel with four diagnostic ports
  at(vesselBox(0.16, 0.16, 0.16), 1.0);
  for (const [yy, zz] of [[0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]] as const) {
    const port = cyl(0.025, 0.08, M.steel(), 12);
    if (zz) port.rotation.x = Math.PI / 2;
    at(port, 1.0, yy, z + zz);
  }
  stand(1.0, -0.16, 0.12, 0.12);
  // photon shutter (water-cooled absorber in a chamber) and the two safety shutters (heavy tungsten blocks)
  at(box(0.42, 0.26, 0.24, M.steel(), 0.012), 2.0, 0.02);
  actuator(2.0, 0.15, 0.24);
  stand(2.0, -0.11, 0.32, 0.2);
  for (const x of [2.85, 3.3]) {
    at(box(0.32, 0.4, 0.3, M.tungsten(), 0.012), x, 0.04);
    actuator(x, 0.24, 0.26);
    stand(x, -0.16, 0.28, 0.26);
  }
  // differential pumping section: three small crosses on ion pumps (no window: preserves the coherent wavefront)
  for (const x of [3.85, 4.1, 4.35]) at(box(0.07, 0.11, 0.11, M.steel(), 0.006), x);
  // ion pumps under the chamber
  for (const x of [-2.7, 0.6, 1.5, 4.1]) {
    at(cyl(0.012, 0.12, M.steel(), 10), x, -0.09);
    at(box(0.16, 0.2, 0.12, pumpMat, 0.01), x, -0.25);
    stand(x, -0.35, 0.12, 0.1);
  }
  return shadowed(g);
}
