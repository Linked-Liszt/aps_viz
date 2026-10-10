import * as THREE from 'three';
import { box, cm, cyl, cylX, shadowed } from './kit';
import { DET_X, EIGER, MMPAD, TUBE } from './geom';

const DEG = Math.PI / 180;
/**
 * Cut-away window of the vessel: the upper-inboard quadrant (the side the exhibit cameras look from), over the
 * downstream part of the tube where the detector carriage runs. In the rotated cylinder frame a vertex at angle θ sits
 * at up = r·sin θ, side = r·cos θ.
 */
const CUT_FROM = 78 * DEG;
const CUT_TO = 200 * DEG;
/** window extent along the beam (absolute metres from the source) */
const WIN_X0 = 63.2;
const WIN_X1 = 76.9;

/** Shell of the vessel between x0 and x1 (local), covering θ ∈ [θ0, θ0 + Δ]; outside paint + lighter inside. */
function shell(R: number, ax: number, x0: number, x1: number, th0 = 0, dth = Math.PI * 2): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(R, R, x1 - x0, 96, 1, true, th0, dth);
  for (const m of [cm.tubePaint(), cm.tubeInside()]) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, ax, 0);
    g.add(mesh);
  }
  return g;
}

/** Ring around the tube axis covering θ ∈ [θ0, θ0 + Δ] (stiffener / flange / cut edge). */
function ring(r: number, tube: number, m: THREE.Material, th0 = 0, dth = Math.PI * 2): THREE.Mesh {
  // TorusGeometry arcs start on its +X axis in its XY plane; after rotation.y = π/2 the torus plane is YZ and a point at
  // angle u lies at (up = sin u, side = −cos u)·r, i.e. u = π − θ. Rotate the arc about its own axis first.
  const t = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 96, dth), m);
  t.rotation.y = Math.PI / 2;
  t.rotateOnAxis(new THREE.Vector3(0, 0, 1), Math.PI - th0 - dth);
  return t;
}

/**
 * 9-ID-GT "Grand Tube": 2.75 m bore × ~20.5 m stainless vessel (8 mm wall, pink-beam shielding), four flanged sections
 * with external stiffener rings, dished heads, on floor saddles; light-grey paint (APS photo). Drawn as a museum
 * cut-away: a window in the upper-inboard quadrant over the carriage region (a faint glass skin keeps the silhouette).
 * Inside: a deck with the detector rails and a cable carrier. Local origin at x = `x0`; axis `TUBE.axisY` above the beam.
 */
export function grandTube(beamY: number, x0: number): THREE.Group {
  const g = new THREE.Group();
  const R = TUBE.r + TUBE.wall;
  const ax = TUBE.axisY;
  const hd = TUBE.headDepth;
  const s0 = TUBE.x0 + hd - x0; // cylindrical shell start (local)
  const s1 = TUBE.x1 - hd - x0;
  const L = s1 - s0;
  const w0 = WIN_X0 - x0;
  const w1 = WIN_X1 - x0;
  const keep = 2 * Math.PI - (CUT_TO - CUT_FROM);
  g.add(shell(R, ax, s0, w0), shell(R, ax, w0, w1, CUT_TO, keep), shell(R, ax, w1, s1));
  // faint skin over the window so the tube still reads as a full cylinder from afar
  const skin = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, w1 - w0, 48, 1, true, CUT_FROM, CUT_TO - CUT_FROM),
    new THREE.MeshStandardMaterial({ color: 0xd3d8de, roughness: 0.5, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }),
  );
  skin.rotation.z = Math.PI / 2;
  skin.position.set((w0 + w1) / 2, ax, 0);
  skin.renderOrder = 4;
  g.add(skin);
  // window edges: two along the tube, two arcs at the ends
  for (const th of [CUT_FROM, CUT_TO]) {
    const e = box(w1 - w0, 0.03, 0.03, cm.tubeCut(), 0.004);
    e.position.set((w0 + w1) / 2, ax + R * Math.sin(th), R * Math.cos(th));
    g.add(e);
  }
  for (const x of [w0, w1]) {
    const e = ring(R, 0.016, cm.tubeCut(), CUT_FROM, CUT_TO - CUT_FROM);
    e.position.set(x, ax, 0);
    g.add(e);
  }
  // section flanges (4 sections → 3 joints + ends) and stiffener rings; partial where they cross the window
  const secLen = L / TUBE.sections;
  const addRing = (x: number, r: number, t: number) => {
    const inWin = x > w0 + 0.02 && x < w1 - 0.02;
    const rr = inWin ? ring(r, t, cm.tubeRing(), CUT_TO, keep) : ring(r, t, cm.tubeRing());
    rr.position.set(x, ax, 0);
    g.add(rr);
  };
  for (let i = 0; i <= TUBE.sections; i++) {
    addRing(s0 + i * secLen, R + 0.03, 0.035);
    if (i < TUBE.sections) for (let k = 1; k < 4; k++) addRing(s0 + i * secLen + (k * secLen) / 4, R + 0.012, 0.02);
  }
  // dished heads (spherical caps, radius = diameter): upstream solid, downstream solid
  const Rs = 2 * TUBE.r;
  const capAngle = Math.asin(R / Rs);
  for (const [xc, dir] of [[s0, -1], [s1, 1]] as const) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(Rs, 64, 12, 0, Math.PI * 2, 0, capAngle), cm.tubePaint());
    // sphere cap opens around +Y; turn it to face ±X and pull it back so its rim meets the shell
    cap.rotation.z = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    cap.position.set(xc - dir * Rs * Math.cos(capAngle), ax, 0);
    const capIn = cap.clone();
    capIn.material = cm.tubeInside();
    g.add(cap, capIn);
  }
  // beam entrance spool on the upstream head
  const spool = cylX(0.1, 0.25, cm.steel(), 24);
  spool.position.set(s0 - hd + 0.06, 0, 0);
  g.add(spool);
  // saddles on the floor: base plate plus webs whose tops follow the tube's underside
  const nS = 5;
  for (let i = 0; i < nS; i++) {
    const x = s0 + 0.6 + (i * (L - 1.2)) / (nS - 1);
    const base = box(0.42, 0.06, 2.2, cm.saddle(), 0.008);
    base.position.set(x, -beamY + 0.03, 0);
    g.add(base);
    for (const sz of [-1.0, -0.75, -0.45, 0, 0.45, 0.75, 1.0]) {
      const yb = ax - Math.sqrt(R * R - sz * sz) + beamY; // tube underside above the floor at this z
      const web = box(0.3, yb - 0.06, Math.abs(sz) === 1.0 ? 0.05 : 0.03, cm.saddle(), 0.004);
      web.position.set(x, -beamY + 0.06 + (yb - 0.06) / 2, sz);
      g.add(web);
    }
    const cradle = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.32, 48, 1, true, 1.5 * Math.PI - 0.82, 1.64), cm.saddle());
    cradle.rotation.z = Math.PI / 2;
    cradle.position.set(x, ax, 0);
    g.add(cradle);
  }
  // interior deck with detector rails (z = ±0.4) and a cable carrier to the carriage
  const deckTop = TUBE.deckY;
  const deckW = 1.4;
  const deck = box(L - 0.2, 0.04, deckW, cm.aluDark(), 0.004);
  deck.position.set((s0 + s1) / 2, deckTop - 0.02, 0);
  g.add(deck);
  for (const sz of [-0.4, 0.4]) {
    const rail = box(L - 0.4, 0.04, 0.05, cm.rail(), 0.004);
    rail.position.set((s0 + s1) / 2, deckTop + 0.02, sz);
    g.add(rail);
  }
  const legs = Math.round(L / 2);
  for (let i = 0; i <= legs; i++) {
    const x = s0 + 0.2 + (i * (L - 0.4)) / legs;
    for (const sz of [-0.55, 0.55]) {
      const yb = ax - Math.sqrt(R * R - sz * sz);
      const leg = box(0.06, deckTop - 0.04 - yb, 0.06, cm.darkSteel(), 0.004);
      leg.position.set(x, yb + (deckTop - 0.04 - yb) / 2, sz);
      g.add(leg);
    }
  }
  const chainX0 = s0 + 0.4;
  const chainX1 = DET_X - x0 - 0.5;
  const tray = box(chainX1 - chainX0, 0.02, 0.16, cm.darkSteel(), 0.003);
  tray.position.set((chainX0 + chainX1) / 2, deckTop + 0.01, 0.62);
  const chain = box((chainX1 - chainX0) / 2, 0.06, 0.12, cm.dragChain(), 0.01);
  chain.position.set(chainX0 + (chainX1 - chainX0) * 0.75, deckTop + 0.05, 0.62);
  g.add(tray, chain);
  return shadowed(g);
}

/**
 * Detector carriage on the deck rails with the in-vacuum EIGER 16M (75 µm pixels, 311 × 328 mm active, 4 × 8 modules)
 * on transverse (x) and vertical (y) slides. Local origin at the EIGER face centre (on the component's position).
 */
export function eigerOnCarriage(faceMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const [fw, fh] = EIGER.face;
  const housing = box(0.42, fh + 0.09, fw + 0.09, cm.eigerGrey(), 0.025);
  housing.position.x = 0.22;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), faceMat);
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.004;
  face.name = 'detector-face';
  const bezel = box(0.012, fh + 0.04, fw + 0.04, cm.black(), 0.004);
  bezel.position.x = 0.004;
  const back = box(0.1, 0.18, 0.22, cm.black(), 0.01);
  back.position.x = 0.48;
  g.add(housing, bezel, face, back);
  // carriage: wheels on the rails at z = ±0.4 (frame relative to the EIGER: its centre is at EIGER.side)
  const dz = -0.2 - EIGER.side; // carriage centred 0.2 m inboard of the tube axis (relative to the EIGER)
  const deckTop = TUBE.deckY;
  const plate = box(1.2, 0.08, 1.3, cm.aluDark(), 0.01);
  plate.position.set(0.0, deckTop + 0.1, dz);
  g.add(plate);
  for (const sx of [-0.45, 0.45])
    for (const sz of [-0.4, 0.4]) {
      const w = cyl(0.045, 0.05, cm.black(), 16);
      w.rotation.x = Math.PI / 2;
      w.position.set(sx, deckTop + 0.085, -EIGER.side + sz);
      g.add(w);
    }
  // transverse slide across the carriage, vertical column under the detector
  const xs = box(0.16, 0.05, 1.25, cm.rail(), 0.006);
  xs.position.set(0.22, deckTop + 0.165, dz);
  const colH = -(fh / 2 + 0.045) - (deckTop + 0.19);
  const col = box(0.2, colH, 0.2, cm.frame(), 0.01);
  col.position.set(0.22, deckTop + 0.19 + colH / 2, 0);
  g.add(xs, col);
  return shadowed(g);
}

/** MM-PAD (150 µm pixels, ~47 × 49 mm) on its own arm from the carriage, at the specular spot. Local origin at its face. */
export function mmPad(faceMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const [fw, fh] = MMPAD.face;
  const housing = box(0.24, 0.12, 0.11, cm.white(), 0.012);
  housing.position.x = 0.13;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), faceMat);
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.003;
  face.name = 'detector-face';
  const fin = box(0.14, 0.06, 0.012, cm.aluDark(), 0.003);
  fin.position.set(0.14, 0, -0.065);
  const deckTop = TUBE.deckY;
  const postH = -0.06 - (deckTop + 0.14); // down to the carriage plate
  const post = box(0.08, postH, 0.08, cm.frame(), 0.006);
  post.position.set(0.14, deckTop + 0.14 + postH / 2, 0);
  g.add(housing, face, fin, post);
  return shadowed(g);
}

/** Pink-beam-rated end stop inside the downstream end of the tube (tungsten core in a lead/steel block on a post). */
export function endStop(beamY: number): THREE.Group {
  const g = new THREE.Group();
  const lead = box(0.2, 0.24, 0.24, cm.lead(), 0.01);
  lead.position.x = 0.1;
  const core = cylX(0.035, 0.02, cm.tungsten(), 16);
  core.position.x = -0.005;
  const post = box(0.1, -0.12 - TUBE.deckY, 0.1, cm.darkSteel(), 0.004);
  post.position.set(0.1, TUBE.deckY + (-0.12 - TUBE.deckY) / 2, 0);
  void beamY;
  g.add(lead, core, post);
  return shadowed(g);
}

