import * as THREE from 'three';
import { M, bellowsX, boxSpan, cyl, flangeX, pipeX, pipeZ, rod, shadowed } from './kit';
import { COUPLING, EIGER_FACE, FLOOR, RAILS, SAMPLE_X, SELUN_FACE, TANK } from './geom';

/**
 * In-vacuum detector mover (IRELEC): a single 5.6 m vacuum chamber on a steel frame, coupled to the instrument chamber
 * through bellows and a gate valve; two in-vacuum detectors ride on rails inside. The shell is opaque cream (vendor
 * rendering) with a cut-away window on the upper inboard side. Origin = TANK_PIN_X on the beam axis.
 */
export const TANK_PIN_X = (TANK.x0 + TANK.x1) / 2;

/** Cut-away window of the tank shell (θ from +Z outboard toward +Y up): from just past the top to below the inboard side. */
const CUT0 = THREE.MathUtils.degToRad(100);
const CUT1 = THREE.MathUtils.degToRad(236);

let insideMat: THREE.MeshStandardMaterial | null = null;
/** Inner face of the tank (electropolished steel, a little darker than the paint so the interior reads as depth). */
function tankInside(): THREE.MeshStandardMaterial {
  return (insideMat ??= new THREE.MeshStandardMaterial({ color: 0x4d5560, roughness: 0.5, metalness: 0.45, side: THREE.BackSide }));
}

/** Partial ring around the beam axis at x (radius r, from angle t0 to t1, θ measured from +Z toward +Y). */
function arcTube(x: number, r: number, t0: number, t1: number, tube: number, mat: THREE.Material): THREE.Mesh {
  const n = 48;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    pts.push(new THREE.Vector3(x, r * Math.sin(t), r * Math.cos(t)));
  }
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, tube, 8, false), mat);
  m.castShadow = true;
  return m;
}

export function detectorMover(): THREE.Group {
  const g = new THREE.Group();
  const X = (x: number) => x - TANK_PIN_X;
  const R = TANK.r;
  // ---- coupling: bellows → gate valve (actuator up to ~2 m above the floor, as on the elevation) → bellows
  g.add(bellowsX(X(COUPLING.chamberPort + 0.02), X(COUPLING.valve0), 0.075));
  g.add(boxSpan(X(COUPLING.valve0), X(COUPLING.valve1), -0.14, 0.2, -0.15, 0.15, M.steel(), 0.01));
  g.add(cyl(0.05, 0.36, M.blackAnod(), 16).translateX(X((COUPLING.valve0 + COUPLING.valve1) / 2)).translateY(0.38));
  g.add(boxSpan(X(COUPLING.valve0) + 0.02, X(COUPLING.valve1) - 0.02, 0.56, 0.6, -0.06, 0.06, M.yellow(), 0.004));
  g.add(bellowsX(X(COUPLING.valve1), X(TANK.capFront), 0.095));
  // ---- front cover (flat dished door with stiffening spokes, as in the vendor rendering)
  g.add(flangeX(X(TANK.capFront + 0.05), R + 0.04, 0.1, M.tankPaint()));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sp = boxSpan(-0.012, 0.012, 0, R * 0.9, -0.012, 0.012, M.tankPaint(), 0.003);
    sp.position.x = X(TANK.capFront) - 0.012;
    sp.rotation.x = a;
    g.add(sp);
  }
  // ---- shell: opaque cream cylinder (as in the vendor rendering) with a museum cut-away window on the upper inboard
  // side so the two detectors and the rails inside stay visible; flange rings follow the cut; solid dished rear head.
  // Angle θ is measured from +Z (outboard) toward +Y (up): the shell spans CUT1 → CUT0 + 2π, the window CUT0 → CUT1.
  const len = TANK.x1 - TANK.x0;
  const shellGeo = new THREE.CylinderGeometry(R, R, len, 64, 1, true, CUT1, Math.PI * 2 - (CUT1 - CUT0));
  for (const mat of [M.tankPaint(), tankInside()]) {
    const shell = new THREE.Mesh(shellGeo, mat);
    shell.rotation.z = Math.PI / 2;
    shell.position.x = X((TANK.x0 + TANK.x1) / 2);
    g.add(shell);
  }
  // cut edges: a painted rim along both long edges
  for (const t of [CUT0, CUT1]) g.add(rod(new THREE.Vector3(X(TANK.x0), Math.sin(t) * R, Math.cos(t) * R), new THREE.Vector3(X(TANK.x1), Math.sin(t) * R, Math.cos(t) * R), 0.011, M.darkSteel(), 8));
  for (const x of [TANK.x0, ...TANK.flanges, TANK.x1]) g.add(arcTube(X(x), R + 0.012, CUT1, CUT0 + Math.PI * 2, 0.022, M.tankPaint()));
  const head = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.tankPaint());
  head.rotation.z = -Math.PI / 2;
  head.scale.set(1, (TANK.capRear - TANK.x1) / R, 1);
  head.position.x = X(TANK.x1);
  g.add(head);
  // ---- ports: top flanges, turbo pump, side ports and a viewport
  for (const x of [71.3, 73.8, 75.6]) {
    g.add(cyl(0.09, 0.09, M.tankPaint(), 28).translateX(X(x)).translateY(R + 0.03));
    g.add(cyl(0.12, 0.025, M.steel(), 28).translateX(X(x)).translateY(R + 0.085));
  }
  g.add(cyl(0.11, 0.26, M.alu(), 28).translateX(X(72.0)).translateY(R + 0.17));
  g.add(cyl(0.13, 0.03, M.steel(), 28).translateX(X(72.0)).translateY(R + 0.04));
  for (let x = 72.8; x <= 74.81; x += 0.4) g.add(pipeZ(R - 0.02, R + 0.05, 0.035, M.steel(), X(x), 0.0));
  g.add(pipeZ(R - 0.02, R + 0.05, 0.075, M.steel(), X(71.6), 0.0));
  // ---- steel frame (blue), saddles, levelling feet; electronics cabinet on the outboard side
  const yTop = -R - 0.06;
  for (const z of [-0.32, 0.32]) g.add(boxSpan(X(TANK.capFront), X(TANK.capRear) - 0.1, yTop - 0.1, yTop, z - 0.05, z + 0.05, M.blueFrame(), 0.004));
  for (const x of [70.8, 72.5, 74.3, 76.05]) {
    for (const z of [-0.32, 0.32]) {
      g.add(boxSpan(X(x) - 0.05, X(x) + 0.05, FLOOR + 0.06, yTop - 0.1, z - 0.05, z + 0.05, M.blueFrame(), 0.004));
      g.add(boxSpan(X(x) - 0.1, X(x) + 0.1, FLOOR, FLOOR + 0.06, z - 0.1, z + 0.1, M.darkSteel(), 0.004));
    }
    g.add(boxSpan(X(x) - 0.04, X(x) + 0.04, yTop - 0.08, yTop - 0.02, -0.32, 0.32, M.blueFrame(), 0.004));
    g.add(boxSpan(X(x) - 0.06, X(x) + 0.06, yTop, -R * 0.8, -0.18, 0.18, M.tankPaint(), 0.006));
    g.add(boxSpan(X(x) - 0.04, X(x) + 0.04, FLOOR + 0.3, FLOOR + 0.36, -0.32, 0.32, M.blueFrame(), 0.004));
  }
  g.add(boxSpan(X(75.1), X(75.75), FLOOR + 0.35, yTop - 0.12, 0.38, 0.62, M.cabinet(), 0.01));
  // ---- in-vacuum rails (two) on a base plate, cable chain
  for (const z of [-RAILS.z, RAILS.z]) g.add(boxSpan(X(RAILS.x0), X(RAILS.x1), RAILS.y - 0.02, RAILS.y, z - 0.012, z + 0.012, M.steel(), 0.002));
  g.add(boxSpan(X(RAILS.x0), X(RAILS.x1), RAILS.y - 0.05, RAILS.y - 0.02, -0.2, 0.2, M.darkSteel(), 0.003));
  for (let x = RAILS.x0 + 0.3; x < RAILS.x1; x += 1.0) g.add(boxSpan(X(x) - 0.04, X(x) + 0.04, -R + 0.01, RAILS.y - 0.05, -0.12, 0.12, M.darkSteel(), 0.003));
  g.add(boxSpan(X(RAILS.x0), X(RAILS.x1) - 0.4, RAILS.y - 0.02, RAILS.y + 0.02, -0.25, -0.21, M.orange(), 0.004));
  return shadowed(g);
}

/** Ptychographic far-field pattern: bright annulus (zone-plate pupil with central-stop shadow) + speckle halo. */
const faceCache = new Map<string, THREE.MeshStandardMaterial>();
export function ptychoFaceMaterial(color = '#60a5fa'): THREE.MeshStandardMaterial {
  let m = faceCache.get(color);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#04070c';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(120,150,190,0.25)';
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * 64);
    ctx.lineTo(256, i * 64);
    ctx.moveTo(i * 64, 0);
    ctx.lineTo(i * 64, 256);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // speckle halo (falls off with q)
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 34 + Math.pow(rnd(), 2.2) * 100;
    const v = Math.floor(30 + 160 * Math.exp(-(r - 34) / 28) * rnd());
    ctx.fillStyle = color + Math.min(255, v).toString(16).padStart(2, '0');
    ctx.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 2, 2);
  }
  // bright pupil annulus (direct beam) with the central-stop shadow
  const grad = ctx.createRadialGradient(128, 128, 9, 128, 128, 34);
  grad.addColorStop(0, '#000000');
  grad.addColorStop(0.18, '#000000');
  grad.addColorStop(0.24, '#ffffff');
  grad.addColorStop(0.85, color);
  grad.addColorStop(1, '#000000');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(128, 128, 34, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.0, roughness: 0.5, side: THREE.DoubleSide });
  faceCache.set(color, m);
  return m;
}

/**
 * DECTRIS SELUN (190 × 190 pixels of 100 µm = 19 × 19 mm) on its long in-vacuum carriage, drawn at its closest
 * documented position, 75 mm from the sample (reached through the coupling into the instrument chamber).
 * Origin = sensor face.
 */
export function selunDetector(color: string): THREE.Group {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.019, 0.019), ptychoFaceMaterial(color));
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.0005;
  g.add(face);
  g.add(boxSpan(0, 0.07, -0.032, 0.032, -0.032, 0.032, M.detector(), 0.004));
  g.add(boxSpan(0.002, 0.004, -0.0115, 0.0115, -0.0115, 0.0115, M.blackAnod(), 0)); // sensor frame
  // boom back through the coupling to the carriage on the rails
  const carX = 70.78 - SELUN_FACE;
  g.add(pipeX(0.07, carX, 0.014, M.alu()));
  g.add(boxSpan(carX - 0.05, carX + 0.05, -0.2, 0.02, -0.02, 0.02, M.alu(), 0.003));
  g.add(boxSpan(carX - 0.12, carX + 0.12, RAILS.y, RAILS.y + 0.04, -0.17, 0.17, M.darkSteel(), 0.004));
  g.add(rod(new THREE.Vector3(carX, RAILS.y + 0.04, -0.15), new THREE.Vector3(carX + 0.4, RAILS.y + 0.02, -0.23), 0.006, M.orange(), 6));
  return shadowed(g);
}

/**
 * DECTRIS EIGER2 XE 1.5M, drawn at its farthest documented position (5 m). "1.5M" = three 1028 × 512-pixel modules of
 * 75 µm → sensitive area ≈77 × 118 mm (module stacking assumed vertical, as in the 1M); housing proportions generic.
 * Origin = sensor face.
 */
export function eigerDetector(color: string): THREE.Group {
  const g = new THREE.Group();
  const W = 0.0771;
  const H = 0.1185;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), ptychoFaceMaterial(color));
  face.rotation.y = -Math.PI / 2;
  face.position.x = -0.001;
  g.add(face);
  // module gaps (two thin dark lines across the face)
  for (const y of [-H / 6, H / 6]) g.add(boxSpan(-0.0012, -0.0008, y - 0.0006, y + 0.0006, -W / 2, W / 2, M.blackAnod(), 0));
  g.add(boxSpan(0, 0.3, -0.1, 0.1, -0.07, 0.07, M.detector(), 0.01));
  g.add(boxSpan(0.3, 0.34, -0.06, 0.06, -0.05, 0.05, M.blackAnod(), 0.004));
  for (let i = 0; i < 5; i++) g.add(boxSpan(0.08 + i * 0.045, 0.1 + i * 0.045, 0.1, 0.12, -0.06, 0.06, M.darkSteel(), 0.002)); // cooling fins
  g.add(boxSpan(0.03, 0.27, RAILS.y + 0.04, -0.1, -0.05, 0.05, M.alu(), 0.003));
  g.add(boxSpan(0.0, 0.3, RAILS.y, RAILS.y + 0.04, -0.17, 0.17, M.darkSteel(), 0.004));
  return shadowed(g);
}

/** sample → detector distance helpers for the layout */
export const SELUN_DIST = SELUN_FACE - SAMPLE_X;
export const EIGER_DIST = EIGER_FACE - SAMPLE_X;
