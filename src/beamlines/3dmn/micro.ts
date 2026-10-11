import * as THREE from 'three';
import { fatLine } from '../../scene/lines';
import { glowMaterial } from '../../scene/palette';
import { M, bar, box, boxSpan, cyl, inStation, now, REDUCED_MOTION, rod, vesselBox, pipeX, flangeX, wedge45 } from './kit';
import { H_SCAN, MICROSCOPE, N_SURF, SDD, SIDE_DET, TOP_DET, WIRE } from './geom';
import { detectorFace, facingQuaternion, grainOrientation, laueSpots, rayFan, spotDots, type Detector, type Spot } from './laue';

/**
 * The 34-ID-E micro-diffraction instrument (34ID-BI-1), modelled in a station frame whose origin is the beam-entry
 * point on the sample surface (the focus): +X downstream, +Y up, +Z outboard. Reference geometry = pre-upgrade 34-ID-E,
 * which 3DMN keeps (FDR/PDR): sample surface at 45° (normal up-and-upstream), 409.6 mm detector 513 mm above the sample
 * looking down (2θ ≈ 90° at its centre), two 204.8 mm side detectors tilted 45° about the beam at ~0.40 m (calibrated positions
 * from the 2023 geometry file), Pt wire scanned parallel to the surface,
 * KB pair with the vertical mirror upstream (f ≈ 142 mm) and the horizontal one closer (f ≈ 70 mm, ≥ 50 mm working distance).
 */

const GRANITE_TOP = -0.72;
const GRANITE = { x0: -0.62, x1: 0.46, z0: -0.62, z1: 0.68 };
const GANTRY = { x: 0.32, zIn: -0.55, zOut: 0.62, top: 0.74 };

export const TOP_CENTER = TOP_DET.center.clone();
export const OUT_CENTER = SIDE_DET.outCenter.clone();
export const IN_CENTER = SIDE_DET.inCenter.clone();
export const SDD_ORIGIN = SDD.dir.clone().multiplyScalar(SDD.bodyAt);

/** Wire scan: the carrier slides along H; u = 0.3 h … 2.6 h sweeps the wire's shadow across all three detectors. */
export function wireU(t: number, h = WIRE.h): number {
  return REDUCED_MOTION ? 1.2 * h : h * (1.45 + 1.15 * Math.sin((2 * Math.PI * t) / 9));
}
export function wireAxis(t: number, h = WIRE.h): THREE.Vector3 {
  return N_SURF.clone().multiplyScalar(h).addScaledVector(H_SCAN, wireU(t, h));
}

let microSpots: Spot[] | null = null;
/** Two nickel grains at different depths along the beam (depths enlarged ×12, like the wire neighbourhood). */
export function spots(): Spot[] {
  if (!microSpots) {
    const dets: Detector[] = [
      { name: 'top', center: TOP_CENTER, normal: TOP_DET.normal, half: TOP_DET.active / 2 },
      { name: 'out', center: OUT_CENTER, normal: SIDE_DET.outNormal, half: SIDE_DET.active / 2 },
      { name: 'in', center: IN_CENTER, normal: SIDE_DET.inNormal, half: SIDE_DET.active / 2 },
    ];
    microSpots = laueSpots(
      [
        { U: grainOrientation(87), origin: new THREE.Vector3(0.0005, 0, 0) },
        { U: grainOrientation(246), origin: new THREE.Vector3(0.0013, 0, 0) },
      ],
      dets,
    );
  }
  return microSpots;
}

const onDet = (name: string) => spots().filter((s) => s.det === name);

/** Rotation taking a part's local +Y onto `dir`. */
const alongDir = (dir: THREE.Vector3) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());

// ------------------------------------------------------------------ base table + detector gantry (custom, pickable)

export function baseAndGantry(): THREE.Group {
  return inStation(new THREE.Vector3(), (g) => {
    g.add(boxSpan(GRANITE.x0, GRANITE.x1, -1.4, GRANITE_TOP - 0.03, GRANITE.z0, GRANITE.z1, M.granite(), 0.01));
    g.add(boxSpan(GRANITE.x0 + 0.01, GRANITE.x1 - 0.01, GRANITE_TOP - 0.03, GRANITE_TOP, GRANITE.z0 + 0.01, GRANITE.z1 - 0.01, M.steel(), 0.004));
    for (const x of [GRANITE.x0 + 0.1, GRANITE.x1 - 0.1])
      for (const z of [GRANITE.z0 + 0.1, GRANITE.z1 - 0.1]) {
        const f = cyl(0.04, 0.05, M.darkSteel(), 16);
        f.position.set(x, -1.4 + 0.025, z);
        g.add(f);
      }
    // stabilisation gantry carrying the detectors
    const a = M.alu();
    const s = 0.05;
    for (const x of [-GANTRY.x, GANTRY.x])
      for (const z of [GANTRY.zIn, GANTRY.zOut]) g.add(bar(new THREE.Vector3(x, GRANITE_TOP, z), new THREE.Vector3(x, GANTRY.top + s / 2, z), s, a));
    for (const x of [-GANTRY.x, GANTRY.x]) g.add(bar(new THREE.Vector3(x, GANTRY.top, GANTRY.zIn), new THREE.Vector3(x, GANTRY.top, GANTRY.zOut), s, a));
    for (const z of [GANTRY.zIn, GANTRY.zOut, -0.17, 0.17]) g.add(bar(new THREE.Vector3(-GANTRY.x, GANTRY.top, z), new THREE.Vector3(GANTRY.x, GANTRY.top, z), s * 0.8, a));
  });
}

// ------------------------------------------------------------------ KB pair (component origin: 60.0 m = station x −0.1)

export function microKB(): THREE.Group {
  return inStation(new THREE.Vector3(-0.1, 0, 0), (g) => {
    const main = vesselBox(0.195, 0.11, 0.12);
    main.position.set(-0.1725, -0.01, 0);
    const nose = vesselBox(0.029, 0.05, 0.06);
    nose.position.set(-0.0605, 0, 0);
    g.add(main, nose);
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16), new THREE.MeshStandardMaterial({ color: 0xc58a3c, roughness: 0.4, transparent: true, opacity: 0.8 }));
    win.rotation.y = Math.PI / 2;
    win.position.x = -0.0458;
    g.add(win);
    // vertically focusing mirror (upstream, ~142 mm from focus, reflects up) and horizontally focusing mirror (~70 mm, reflects outboard)
    g.add(boxSpan(-0.187, -0.097, -0.03, -0.0004, -0.0125, 0.0125, M.silicon(), 0.0015));
    const fV = new THREE.Mesh(new THREE.PlaneGeometry(0.088, 0.02), M.mirror());
    fV.rotation.x = -Math.PI / 2;
    fV.position.set(-0.142, 0, 0);
    g.add(fV);
    g.add(boxSpan(-0.09, -0.05, -0.012, 0.012, -0.022, -0.0004, M.silicon(), 0.0015));
    const fH = new THREE.Mesh(new THREE.PlaneGeometry(0.038, 0.02), M.mirror());
    fH.position.set(-0.07, 0, 0);
    g.add(fH);
    for (const x of [-0.19, -0.094]) g.add(boxSpan(x - 0.006, x + 0.006, -0.05, -0.03, -0.02, 0.02, M.blackAnod(), 0.002));
    for (const x of [-0.093, -0.047]) g.add(boxSpan(x - 0.004, x + 0.004, -0.015, 0.015, -0.04, -0.022, M.blackAnod(), 0.002));
    // alignment stages and support post
    g.add(boxSpan(-0.26, -0.085, -0.1, -0.065, -0.07, 0.07, M.alu(), 0.003));
    g.add(boxSpan(-0.24, -0.1, -0.18, -0.1, -0.06, 0.06, M.blackAnod(), 0.003));
    g.add(boxSpan(-0.2, -0.14, GRANITE_TOP, -0.18, -0.04, 0.04, M.steel(), 0.003));
    // upstream: entrance slits and the incident-flux ion chamber
    const fl = flangeX(0.035);
    fl.position.x = -0.272;
    g.add(fl, pipeX(-0.3, -0.27, 0.012));
    g.add(boxSpan(-0.345, -0.3, -0.03, 0.03, -0.03, 0.03, M.darkSteel(), 0.003));
    for (const [y, z] of [[0.024, 0], [-0.024, 0], [0, 0.024], [0, -0.024]]) g.add(boxSpan(-0.33, -0.315, y - 0.008, y + 0.008, z - 0.008, z + 0.008, M.tungsten(), 0));
    g.add(boxSpan(-0.46, -0.37, -0.035, 0.035, -0.04, 0.04, M.alu(), 0.004));
    for (const x of [-0.461, -0.369]) {
      const k = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.03), new THREE.MeshStandardMaterial({ color: 0xc58a3c, roughness: 0.5, side: THREE.DoubleSide }));
      k.rotation.y = Math.PI / 2;
      k.position.x = x;
      g.add(k);
    }
    g.add(pipeX(-0.37, -0.345, 0.01), pipeX(-0.52, -0.46, 0.012));
    g.add(boxSpan(-0.47, -0.3, -0.055, -0.035, -0.06, 0.06, M.steel(), 0.003));
    g.add(boxSpan(-0.41, -0.37, GRANITE_TOP, -0.055, -0.03, 0.03, M.steel(), 0.003));
  });
}

// ------------------------------------------------------------------ sample tower, 45° sample, microscope (origin = sample)

export function sampleTower(): THREE.Group {
  return inStation(new THREE.Vector3(), (g) => {
    g.add(boxSpan(-0.13, 0.13, GRANITE_TOP, -0.6, -0.12, 0.12, M.darkSteel(), 0.006));
    g.add(boxSpan(-0.11, 0.11, -0.6, -0.55, -0.11, 0.11, M.alu(), 0.004));
    g.add(boxSpan(-0.1, 0.1, -0.55, -0.5, -0.1, 0.1, M.blackAnod(), 0.004));
    g.add(boxSpan(-0.035, 0.035, -0.5, -0.09, -0.035, 0.035, M.steel(), 0.004));
    g.add(boxSpan(-0.028, 0.028, -0.09, -0.036, -0.028, 0.028, M.blueAnod(), 0.003));
    // 45° wedge holder (standing on the blue stage top at y = −0.036) and the sample (12 × 12 × 2 mm; true size)
    const wedge = wedge45(0.026, 0.026, 0.0021, -0.036, M.alu());
    const sample = box(0.012, 0.002, 0.012, M.sample(), 0.0004);
    sample.rotation.z = Math.PI / 4;
    sample.position.copy(N_SURF).multiplyScalar(-0.001);
    g.add(wedge, sample);
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.0009, 12, 8), glowMaterial(0xbff6ff, 1.8));
    g.add(spot);
    // optical microscope looking straight down the surface normal (long-working-distance objective)
    const n = N_SURF;
    g.add(rod(n.clone().multiplyScalar(MICROSCOPE.wd), n.clone().multiplyScalar(MICROSCOPE.wd + 0.045), 0.011, M.blackAnod(), 20));
    // LED ring light of the objective: kept dim so it does not bloom over the sample and the wire in close-ups
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.0018, 8, 24), glowMaterial(0xfff4d8, 0.55));
    ring.position.copy(n).multiplyScalar(MICROSCOPE.wd + 0.001);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    g.add(ring);
    g.add(rod(n.clone().multiplyScalar(MICROSCOPE.wd + 0.045), n.clone().multiplyScalar(MICROSCOPE.len - 0.03), 0.017, M.alu(), 20));
    const cam = box(0.05, 0.05, 0.05, M.blackAnod(), 0.004);
    cam.position.copy(n).multiplyScalar(MICROSCOPE.len);
    cam.quaternion.copy(alongDir(n));
    g.add(cam);
    // hung from the upstream crossbar of the detector gantry (a floor column here would stand between inboard
    // visitors and the KB/sample); the strut passes ~6 cm upstream of the top-detector housing
    const top = n.clone().multiplyScalar(MICROSCOPE.len - 0.03);
    g.add(rod(top, new THREE.Vector3(-GANTRY.x, GANTRY.top - 0.02, 0), 0.009, M.steel()));
  });
}

// ------------------------------------------------------------------ Animated Pt wire scanner. The origin is the sample.

/** Carrier geometry at u = 0; the group is slid along H by wireU(t). */
function wireCarrier(withWire: boolean): THREE.Group {
  const c = new THREE.Group();
  const h = WIRE.h;
  const w0 = N_SURF.clone().multiplyScalar(h);
  const C0 = w0.clone().addScaledVector(H_SCAN, -0.03);
  const at = (p: THREE.Vector3, z: number) => new THREE.Vector3(p.x, p.y, z);
  const zs = WIRE.half + 0.001;
  c.add(rod(at(C0, zs + 0.002), at(C0, -0.15), 0.0025, M.alu()));
  for (const z of [-zs, zs]) c.add(rod(at(C0, z), at(w0, z), 0.0015, M.alu()));
  const carriage = box(0.04, 0.02, 0.04, M.blackAnod(), 0.002);
  carriage.rotation.z = Math.PI / 4;
  carriage.position.copy(at(C0, -0.15)).addScaledVector(N_SURF, -0.012);
  c.add(carriage);
  if (withWire) {
    const wire = rod(at(w0, -zs), at(w0, zs), WIRE.r, M.platinum(), 10);
    c.add(wire);
    const glow = fatLine([at(w0, -zs), at(w0, zs)], { color: new THREE.Color(0xfff1d6), intensity: 2.2, width: 3.2 });
    c.add(glow);
  }
  return c;
}

function animateAlongH(host: THREE.Mesh, carrier: THREE.Object3D): void {
  host.frustumCulled = false;
  carrier.position.copy(H_SCAN).multiplyScalar(wireU(now()));
  if (REDUCED_MOTION) return;
  host.onBeforeRender = () => {
    carrier.position.copy(H_SCAN).multiplyScalar(wireU(now()));
  };
}

export function wireScanner(): THREE.Group {
  return inStation(new THREE.Vector3(), (g) => {
    const h = WIRE.h;
    const C0 = N_SURF.clone().multiplyScalar(h).addScaledVector(H_SCAN, -0.03);
    const base = C0.clone().addScaledVector(N_SURF, -0.025);
    const a = base.clone().addScaledVector(H_SCAN, -0.04);
    const b = base.clone().addScaledVector(H_SCAN, 0.07);
    const z = -0.15;
    g.add(bar(new THREE.Vector3(a.x, a.y, z), new THREE.Vector3(b.x, b.y, z), 0.026, M.darkSteel()));
    g.add(bar(new THREE.Vector3(a.x, GRANITE_TOP, z), new THREE.Vector3(a.x, a.y, z), 0.026, M.steel()));
    const carrier = wireCarrier(true);
    g.add(carrier);
    animateAlongH(carrier.children[0] as THREE.Mesh, carrier);
  });
}

// ------------------------------------------------------------------ coded aperture, parked beside the wire on the same carrier

/** Binary de Bruijn sequence B(2, 8): 256 bits in which every 8-bit word appears exactly once. */
export function deBruijn(k = 2, n = 8): number[] {
  const a = new Array(k * n).fill(0);
  const seq: number[] = [];
  const db = (t: number, p: number) => {
    if (t > n) {
      if (n % p === 0) for (let j = 1; j <= p; j++) seq.push(a[j]);
    } else {
      a[t] = a[t - p];
      db(t + 1, p);
      for (let j = a[t - p] + 1; j < k; j++) {
        a[t] = j;
        db(t + 1, t);
      }
    }
  };
  db(1, 1);
  return seq;
}

function barcodeTexture(): THREE.CanvasTexture {
  const bits = deBruijn();
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3c4656';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#f1c35e';
  const w = c.width / bits.length;
  bits.forEach((b, i) => {
    if (b) ctx.fillRect(i * w, 0, w * 0.999, c.height);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export const CODED_ORIGIN = N_SURF.clone().multiplyScalar(WIRE.h).add(new THREE.Vector3(0, 0, 0.042));

export function codedAperture(): THREE.Group {
  return inStation(CODED_ORIGIN, (g) => {
    const carrier = new THREE.Group();
    const p = CODED_ORIGIN;
    const frame = box(0.026, 0.0015, 0.02, M.silicon(), 0.0005);
    frame.rotation.z = Math.PI / 4;
    frame.position.copy(p).addScaledVector(N_SURF, -0.0009);
    const tex = barcodeTexture();
    const code = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.009), new THREE.MeshStandardMaterial({ map: tex, metalness: 0.7, roughness: 0.3, emissive: 0x3a2a08, emissiveMap: tex, emissiveIntensity: 0.9 }));
    // plane +x → H (scan / code direction), +y → −Z, normal → N
    code.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(H_SCAN.clone(), new THREE.Vector3(0, 0, -1), N_SURF.clone()));
    code.position.copy(p);
    const w0 = N_SURF.clone().multiplyScalar(WIRE.h).addScaledVector(H_SCAN, -0.012);
    const bracket = rod(new THREE.Vector3(w0.x, w0.y, WIRE.half + 0.002), new THREE.Vector3(w0.x, w0.y, p.z - 0.012), 0.0013, M.alu());
    carrier.add(frame, code, bracket);
    g.add(carrier);
    animateAlongH(frame, carrier);
  });
}

// ------------------------------------------------------------------ detectors

function panel(center: THREE.Vector3, normal: THREE.Vector3, housing: number, depth: number): THREE.Group {
  const g = new THREE.Group();
  const q = facingQuaternion(center, normal);
  const n = normal.clone().normalize();
  const hb = box(housing, housing, depth, M.detHousing(), 0.006);
  hb.quaternion.copy(q);
  hb.position.copy(center).addScaledVector(n, depth / 2 + 0.0015);
  const fin = box(housing * 0.6, housing * 0.55, depth * 0.6, M.darkSteel(), 0.004);
  fin.quaternion.copy(q);
  fin.position.copy(center).addScaledVector(n, depth + depth * 0.3);
  g.add(hb, fin);
  return g;
}

/** Main area detector, face down, centre 513 mm above and ~31 mm downstream of the sample (origin = detector centre). */
export function topDetector(): THREE.Group {
  return inStation(TOP_CENTER, (g) => {
    g.add(panel(TOP_CENTER, TOP_DET.normal, TOP_DET.housing, TOP_DET.depth));
    g.add(detectorFace(onDet('top'), TOP_CENTER, TOP_DET.active / 2, TOP_DET.normal));
    g.add(spotDots(onDet('top'), 0.0055));
    const y0 = TOP_CENTER.y + TOP_DET.depth * 1.6;
    for (const x of [-0.18, 0.18])
      for (const z of [-0.17, 0.17]) g.add(rod(new THREE.Vector3(TOP_CENTER.x + x, y0, z), new THREE.Vector3(TOP_CENTER.x + x, GANTRY.top, z), 0.009, M.steel()));
  });
}

/**
 * 'Yellow' (outboard) and 'Purple' (inboard) side detectors at their calibrated positions: each tilted 45° about the beam
 * axis, centred ~0.14 m upstream of the sample; each hangs from the upstream gantry post on its side. Origin = outboard centre.
 */
export function sideDetectors(): THREE.Group {
  return inStation(OUT_CENTER, (g) => {
    for (const [c, nrm, name, zCol] of [[OUT_CENTER, SIDE_DET.outNormal, 'out', GANTRY.zOut], [IN_CENTER, SIDE_DET.inNormal, 'in', GANTRY.zIn]] as const) {
      g.add(panel(c, nrm, SIDE_DET.housing, SIDE_DET.depth));
      g.add(detectorFace(onDet(name), c, SIDE_DET.active / 2, nrm));
      g.add(spotDots(onDet(name), 0.0045));
      const back = c.clone().addScaledVector(nrm, SIDE_DET.depth * 1.6);
      const post = new THREE.Vector3(-GANTRY.x, back.y + 0.06, zCol);
      g.add(rod(back, post, 0.011, M.alu()));
    }
  });
}

/** Silicon-drift fluorescence detector on a slide (origin = middle of the snout). */
export function fluorescenceDetector(): THREE.Group {
  return inStation(SDD_ORIGIN, (g) => {
    const d = SDD.dir;
    const P = (s: number) => d.clone().multiplyScalar(s);
    g.add(rod(P(SDD.tip), P(SDD.tip + 0.004), 0.0135, M.blackAnod(), 20));
    g.add(rod(P(SDD.tip + 0.004), P(0.24), 0.0125, M.steel(), 20));
    const body = box(0.075, 0.13, 0.075, M.alu(), 0.006);
    body.position.copy(P(0.3));
    body.quaternion.copy(alongDir(d));
    g.add(body);
    const dewar = cyl(0.03, 0.06, M.blackAnod(), 16);
    dewar.position.copy(P(0.38));
    dewar.quaternion.copy(alongDir(d));
    g.add(dewar);
    const r0 = P(0.2).add(new THREE.Vector3(0, -0.05, 0));
    const r1 = P(0.44).add(new THREE.Vector3(0, -0.05, 0));
    g.add(bar(r0, r1, 0.02, M.darkSteel()));
    const mid = P(0.32).add(new THREE.Vector3(0, -0.05, 0));
    g.add(bar(new THREE.Vector3(mid.x, GRANITE_TOP, mid.z), mid, 0.03, M.steel()));
    for (const s of [0.24, 0.36]) g.add(rod(P(s), P(s).add(new THREE.Vector3(0, -0.05, 0)), 0.006, M.steel()));
  });
}

/**
 * The SDD's acceptance cone (origin = sample): fluorescence leaves the spot in all directions; the detector collects the
 * narrow cone that reaches its ~27 mm snout. Replaces the engine's generic scatter cone, whose 5 cm minimum radius would
 * swallow the snout at this 28 mm working distance.
 */
export function fluorescenceCone(): THREE.Mesh {
  const L = SDD.tip;
  const geo = new THREE.ConeGeometry(0.0125, L, 28, 1, true);
  geo.translate(0, -L / 2, 0);
  geo.rotateX(Math.PI);
  const cone = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf6b').multiplyScalar(1.4), transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending }),
  );
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), SDD.dir);
  return cone;
}

/** Coloured Laue rays + wire occlusion, positioned at the sample by the caller. */
export function microRays(): THREE.Object3D {
  return rayFan(spots(), { at: (t) => wireAxis(t), r: WIRE.r }, { width: 1.7, nearFade: { near: 0.18, far: 0.6, min: 0.16 } });
}

// ------------------------------------------------------------------ far-field BCDI detector (illustrative position)

export function bcdiDetector(toSample: THREE.Vector3, floorY: number): THREE.Group {
  const g = new THREE.Group();
  const dir = toSample.clone().normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  const housing = box(0.13, 0.11, 0.24, M.detector(), 0.008);
  housing.quaternion.copy(q);
  housing.position.copy(dir).multiplyScalar(-0.09);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.04), new THREE.MeshStandardMaterial({ color: 0x0a1018, emissive: 0x2dd4bf, emissiveIntensity: 0.4 }));
  face.quaternion.copy(q);
  face.position.copy(dir).multiplyScalar(0.031);
  g.add(housing, face);
  // vertical stage (column + guide rail + carriage) on an X–Y floor translator
  g.add(boxSpan(-0.06, 0.06, floorY + 0.12, -0.02, -0.06, 0.06, M.darkSteel(), 0.006));
  g.add(boxSpan(-0.02, 0.02, floorY + 0.3, -0.06, 0.08, 0.1, M.darkSteel(), 0.003));
  g.add(boxSpan(-0.07, 0.07, -0.16, -0.02, 0.06, 0.14, M.blackAnod(), 0.004));
  g.add(boxSpan(-0.14, 0.14, floorY + 0.12, floorY + 0.2, -0.14, 0.14, M.steel(), 0.006));
  g.add(boxSpan(-0.18, 0.18, floorY + 0.06, floorY + 0.12, -0.16, 0.16, M.blackAnod(), 0.004));
  for (const z of [-0.3, 0.3]) g.add(boxSpan(-0.7, 0.7, floorY, floorY + 0.03, z - 0.03, z + 0.03, M.steel(), 0.003));
  g.add(boxSpan(-0.06, 0.06, floorY + 0.03, floorY + 0.06, -0.4, 0.4, M.darkSteel(), 0.003));
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}
