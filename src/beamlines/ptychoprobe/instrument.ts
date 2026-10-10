import * as THREE from 'three';
import { M, bar, bellowsX, boxSpan, cyl, flangeX, pipeX, pipeZ, prismXY, rod, shadowed, vesselBox } from './kit';
import { FLOOR, INST, OSA_X, SAMPLE_X, WEDGE_DEG, XRF, ZP_X } from './geom';

/**
 * The PtychoProbe endstation (33ID-BI-1), after the FDR Fig. 4.37 schematic and the Velociprobe heritage:
 * stiff floor coupling → granite base → granite coarse-Y (two wedges, 5.5° design angle, vented air bearings) →
 * granite coarse-X → vacuum chamber. Inside: optics gantry (CRSZ) carrying the zone-plate carrier (4 ZPs) and the MLL
 * carrier, central-stop and OSA stages, and the sample stack (coarse X → rotation θ → fast XYZ). All builders return
 * groups whose origin is the component's own position; coordinates below are written relative to the SAMPLE and
 * shifted by the component's offset from it.
 */

const C = INST.chamber;

/** Granite stack + vacuum chamber + sample stack. Origin = sample (69.7 m) on the beam axis. */
export function endstation(): THREE.Group {
  const g = new THREE.Group();
  // ---- floor coupling (grouted steel plate with levelling feet)
  g.add(boxSpan(INST.x0 - 0.02, INST.x1 + 0.02, FLOOR, INST.couplingTop - 0.04, INST.z0 - 0.02, INST.z1 + 0.02, M.darkSteel(), 0.01));
  for (const x of [INST.x0 + 0.08, INST.x1 - 0.08]) for (const z of [INST.z0 + 0.08, INST.z1 - 0.08]) g.add(cyl(0.045, 0.04, M.steel(), 16).translateX(x).translateY(INST.couplingTop - 0.02).translateZ(z));
  // ---- granite base
  g.add(boxSpan(INST.x0, INST.x1, INST.couplingTop, INST.baseTop, INST.z0, INST.z1, M.granite(), 0.012));
  // ---- coarse Y: a pair of granite wedges (5.5°) — sliding the lower wedge in X lifts the upper one
  const t = Math.tan(THREE.MathUtils.degToRad(WEDGE_DEG));
  const wx0 = INST.x0 + 0.03;
  const wx1 = INST.x1 - 0.03;
  const yLow = INST.baseTop + 0.05;
  const yHigh = yLow + (wx1 - wx0) * t;
  const zw0 = INST.z0 + 0.05;
  const zw1 = INST.z1 - 0.05;
  g.add(prismXY([[wx0, INST.baseTop], [wx1, INST.baseTop], [wx1, yHigh], [wx0, yLow]], zw0, zw1, M.graniteMid()));
  g.add(prismXY([[wx0, yLow + 0.005], [wx1, yHigh + 0.005], [wx1, INST.crsyTop], [wx0, INST.crsyTop]], zw0, zw1, M.graniteLight()));
  // air-bearing lands (thin bright strips at the sliding interfaces)
  for (const y of [INST.crsyTop, INST.baseTop]) g.add(boxSpan(wx0 + 0.02, wx1 - 0.02, y - 0.003, y + 0.003, zw0 - 0.004, zw1 + 0.004, M.pad(), 0.001));
  // ---- coarse X granite
  g.add(boxSpan(INST.x0 + 0.06, INST.x1 - 0.06, INST.crsyTop + 0.004, INST.crsxTop, INST.z0 + 0.08, INST.z1 - 0.08, M.graniteMid(), 0.01));
  g.add(boxSpan(INST.x0 + 0.08, INST.x1 - 0.08, INST.crsxTop - 0.003, INST.crsxTop + 0.003, INST.z0 + 0.1, INST.z1 - 0.1, M.pad(), 0.001));
  // ---- vacuum chamber (cut-away shell on a thick base plate, steel lid frame)
  g.add(boxSpan(C.x0, C.x1, C.floor, C.plate, C.z0, C.z1, M.steel(), 0.01));
  const shell = vesselBox(C.x1 - C.x0, INST.chamberTop - C.plate, C.z1 - C.z0, true);
  shell.position.set((C.x0 + C.x1) / 2, (INST.chamberTop + C.plate) / 2, 0);
  g.add(shell);
  const lid = 0.03;
  g.add(boxSpan(C.x0, C.x1, INST.chamberTop - lid, INST.chamberTop, C.z0, C.z0 + 0.04, M.steel(), 0.004));
  g.add(boxSpan(C.x0, C.x1, INST.chamberTop - lid, INST.chamberTop, C.z1 - 0.04, C.z1, M.steel(), 0.004));
  g.add(boxSpan(C.x0, C.x0 + 0.04, INST.chamberTop - lid, INST.chamberTop, C.z0, C.z1, M.steel(), 0.004));
  g.add(boxSpan(C.x1 - 0.04, C.x1, INST.chamberTop - lid, INST.chamberTop, C.z0, C.z1, M.steel(), 0.004));
  // ports: beam entrance, exit to the detector coupling, side port for the XRF snout (outboard), metrology feedthrough
  g.add(flangeX(C.x0 - 0.01, 0.07), pipeX(C.x0 - 0.16, C.x0, 0.035), flangeX(C.x0 - 0.16, 0.06));
  g.add(flangeX(C.x1 + 0.01, 0.13), pipeX(C.x1, C.x1 + 0.02, 0.1));
  g.add(pipeZ(C.z1, C.z1 + 0.02, 0.07, M.steel()));
  g.add(pipeZ(C.z0 - 0.02, C.z0, 0.06, M.steel(), -0.05, 0.02));
  // ---- sample stack: coarse X (SAMCX) → rotation (SAMθ) → fast XYZ (SAMXYZ) → sample pin
  g.add(boxSpan(-0.07, 0.22, C.plate, C.plate + 0.03, -0.14, 0.14, M.purple(), 0.004));
  g.add(boxSpan(-0.07, 0.22, C.plate + 0.03, C.plate + 0.035, -0.12, -0.1, M.steel(), 0.001));
  const rot = cyl(0.075, 0.06, M.orange(), 40);
  rot.position.set(0, C.plate + 0.065, 0);
  g.add(rot);
  g.add(boxSpan(0.06, 0.08, C.plate + 0.06, C.plate + 0.095, -0.005, 0.005, M.blackAnod(), 0.001)); // index mark
  g.add(boxSpan(-0.035, 0.035, C.plate + 0.095, -0.08, -0.035, 0.035, M.red(), 0.004));
  // polished metrology reference block on the fast stage (interferometer targets)
  g.add(boxSpan(-0.022, 0.022, -0.08, -0.058, -0.022, 0.022, M.mirror(), 0.002));
  g.add(cyl(0.0025, 0.055, M.steel(), 10).translateY(-0.0325));
  const tip = cyl(0.0015, 0.007, M.sample(), 10);
  tip.position.y = -0.0005;
  g.add(tip);
  return shadowed(g);
}

/** Fresnel-zone-plate texture (concentric zones, radii ∝ √n, drawn with far fewer zones than the real 11,250). */
let zpTex: THREE.CanvasTexture | null = null;
function zonePlateTexture(): THREE.CanvasTexture {
  if (zpTex) return zpTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#20160a';
  ctx.fillRect(0, 0, 256, 256);
  const N = 60;
  const R = 124;
  for (let n = N; n >= 1; n--) {
    ctx.beginPath();
    ctx.arc(128, 128, R * Math.sqrt(n / N), 0, Math.PI * 2);
    ctx.fillStyle = n % 2 ? '#f2cb68' : '#3a2810';
    ctx.fill();
  }
  zpTex = new THREE.CanvasTexture(c);
  zpTex.colorSpace = THREE.SRGBColorSpace;
  return zpTex;
}

/**
 * Nano-focusing optics module hung from the optics gantry. Origin = active zone plate (69.69 m) on axis.
 * The gantry (CRSZ) bridges the beam upstream of the sample; the ZP carrier holds four plates (5–8, 8–12, 12–18,
 * 18–30 keV), the MLL carrier (two crossed 1D lenses) waits beside it; a central stop sits just upstream.
 * Optic sizes are enlarged ~100× (the real zone plate is 0.18 mm across; drawn 17.6 mm).
 */
export function opticsModule(): THREE.Group {
  const g = new THREE.Group();
  const dx = SAMPLE_X - ZP_X; // positions written relative to the sample, shifted into this frame
  const at = (x: number) => x + dx;
  // ---- gantry (CRSZ): an open parallelogram frame each side (inclined legs, as in FDR Fig. 4.37) joined by cross
  // beams, so the optic hangs close to the sample with little cantilever; drawn open so the optics stay visible
  const v = (x: number, y: number, z: number) => new THREE.Vector3(at(x), y, z);
  const topY = 0.16;
  for (const z of [-0.16, 0.16]) {
    g.add(bar(v(-0.4, C.plate + 0.03, z), v(-0.26, topY, z), 0.025, M.alu()));
    g.add(bar(v(-0.16, C.plate + 0.03, z), v(-0.02, topY, z), 0.025, M.alu()));
    g.add(boxSpan(at(-0.275), at(-0.005), topY - 0.012, topY + 0.012, z - 0.0125, z + 0.0125, M.alu(), 0.002));
  }
  g.add(boxSpan(at(-0.27), at(-0.23), topY - 0.012, topY + 0.012, -0.17, 0.17, M.alu(), 0.003));
  g.add(boxSpan(at(-0.05), at(-0.01), 0.13, topY + 0.012, -0.17, 0.17, M.alu(), 0.003));
  g.add(boxSpan(at(-0.42), at(-0.14), C.plate, C.plate + 0.03, -0.2, 0.2, M.steel(), 0.003)); // CRSZ slide
  // ---- hanger plate with the ZP carrier slide
  g.add(boxSpan(at(-0.026), at(-0.02), 0.035, 0.13, -0.07, 0.07, M.alu(), 0.002));
  // ZP carrier: thin frame with four windows (one on axis), each holding a zone plate
  const frameT = 0.003;
  const xz = at(-0.01);
  const zps = [-0.066, -0.044, -0.022, 0];
  g.add(boxSpan(xz - frameT, xz, 0.011, 0.035, -0.08, 0.014, M.alu(), 0.001));
  g.add(boxSpan(xz - frameT, xz, -0.017, -0.011, -0.08, 0.014, M.alu(), 0.001));
  for (const z of [...zps.map((v) => v - 0.011), 0.011]) g.add(boxSpan(xz - frameT, xz, -0.011, 0.011, z - 0.0015, z + 0.0015, M.alu(), 0));
  const zpMat = new THREE.MeshStandardMaterial({ map: zonePlateTexture(), roughness: 0.25, metalness: 0.9, emissive: 0x3a2a08, emissiveMap: zonePlateTexture(), emissiveIntensity: 0.8, side: THREE.DoubleSide });
  for (const z of zps) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.0088, 48), zpMat);
    d.rotation.y = Math.PI / 2;
    d.position.set(xz - frameT / 2, 0, z);
    g.add(d);
  }
  // ---- MLL carrier beside it: two crossed 1D lenses (vertical- and horizontal-focusing slices) in a small holder
  const xm = at(-0.012);
  g.add(boxSpan(xm - 0.006, xm + 0.006, -0.012, 0.035, 0.03, 0.06, M.blackAnod(), 0.002));
  g.add(boxSpan(xm - 0.0015, xm + 0.0005, -0.006, 0.006, 0.0438, 0.0462, M.mll(), 0)); // focuses horizontally
  g.add(boxSpan(xm + 0.001, xm + 0.003, -0.0012, 0.0012, 0.039, 0.051, M.mll(), 0)); // focuses vertically
  // ---- central stop (BS XY) just upstream of the active plate
  const xb = at(-0.028);
  g.add(boxSpan(xb - 0.006, xb + 0.006, 0.035, 0.06, -0.012, 0.012, M.darkSteel(), 0.002));
  g.add(cyl(0.0006, 0.034, M.steel(), 6).translateX(xb).translateY(0.018));
  g.add(pipeX(xb - 0.0005, xb + 0.0005, 0.0016, M.tungsten(), 0, 0, 12));
  // ---- focusing light: converging cone from the plate to the focus on the sample (length true, width enlarged)
  const len = dx;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.0085, len, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#9ad8ff').multiplyScalar(1.8), transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending }),
  );
  cone.rotation.z = -Math.PI / 2; // apex toward +X (the sample)
  cone.position.x = len / 2;
  g.add(cone);
  return shadowed(g);
}

/** Order-sorting aperture on its XYZ stage (hung from the gantry). Origin = OSA (69.695 m) on axis. */
export function osaModule(): THREE.Group {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.RingGeometry(0.0007, 0.006, 24), new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.9, roughness: 0.25, side: THREE.DoubleSide }));
  plate.rotation.y = Math.PI / 2;
  g.add(plate);
  g.add(boxSpan(-0.0006, 0.0006, 0.006, 0.1, -0.0015, 0.0015, M.steel(), 0));
  g.add(boxSpan(-0.006, 0.01, 0.1, 0.13, -0.015, 0.015, M.darkSteel(), 0.002));
  return shadowed(g);
}

export const METRO_ORIGIN = new THREE.Vector3(-0.02, -0.02, -0.33); // relative to the sample (inboard)

/**
 * Interferometric metrology (illustrative layout): an Invar post on the inboard side carries three interferometer heads;
 * their beams (red) measure the sample-stage reference block and the optics hanger. Origin = METRO_ORIGIN.
 */
export function metrology(): THREE.Group {
  const g = new THREE.Group();
  const o = METRO_ORIGIN;
  const rel = (x: number, y: number, z: number) => new THREE.Vector3(x - o.x, y - o.y, z - o.z);
  g.add(boxSpan(-0.02, 0.02, C.plate - o.y, 0.1 - o.y, -0.02, 0.02, M.alu(), 0.003));
  g.add(boxSpan(-0.06, 0.06, C.plate - o.y, C.plate + 0.015 - o.y, -0.05, 0.05, M.alu(), 0.003));
  const targets = [
    { head: rel(-0.0, -0.069, -0.3), tgt: rel(-0.0, -0.069, -0.022) }, // sample stage, horizontal transverse
    { head: rel(0.012, -0.064, -0.3), tgt: rel(0.012, -0.064, -0.022) }, // second head (pitch/yaw)
    { head: rel(-0.023, 0.06, -0.3), tgt: rel(-0.023, 0.06, -0.07) }, // optics hanger
  ];
  for (const { head, tgt } of targets) {
    const h = cyl(0.009, 0.04, M.blackAnod(), 14);
    h.rotation.x = Math.PI / 2;
    h.position.copy(head).add(new THREE.Vector3(0, 0, -0.01));
    g.add(h);
    g.add(boxSpan(head.x - 0.012, head.x + 0.012, head.y - 0.012, head.y + 0.012, head.z - 0.05, head.z - 0.03, M.alu(), 0.002));
    g.add(rod(head.clone().add(new THREE.Vector3(0, 0, 0.01)), tgt, 0.0011, M.laser(), 6));
  }
  // fibre feedthrough to the chamber wall
  g.add(rod(rel(0, 0.08, -0.33), rel(-0.05, 0.04, -0.5), 0.004, M.yellow(), 6));
  return shadowed(g);
}

export const XRF_ORIGIN = new THREE.Vector3(0, 0, (XRF.bodyZ0 + XRF.bodyZ1) / 2);

/**
 * Energy-dispersive silicon-drift detector at 90° in the horizontal plane (side undocumented): long snout
 * through the side port to ~2 cm from the sample, bellows and linear slide outside, preamplifier body, floor stand.
 * Built pointing to −Z; the layout turns it 180° about Y so it enters the OUTBOARD side port (the inboard side is kept
 * clear for the close-up camera). Origin = XRF_ORIGIN (detector body centre).
 */
export function xrfDetector(): THREE.Group {
  const g = new THREE.Group();
  const zo = XRF_ORIGIN.z;
  g.add(pipeZ(XRF.tipZ - 0.006 - zo, XRF.wallZ - zo, 0.022, M.steel()));
  // collimated nose with the 7-element window
  g.add(pipeZ(XRF.tipZ - zo - 0.008, XRF.tipZ - zo, 0.025, M.darkSteel()));
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.02, 28), new THREE.MeshStandardMaterial({ color: 0x5b4a2a, roughness: 0.3, metalness: 0.6, emissive: 0x3a2a08, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
  win.position.z = XRF.tipZ - zo + 0.0005;
  g.add(win);
  g.add(bellowsZ(XRF.wallZ - 0.02 - zo, XRF.bodyZ0 - zo, 0.045));
  g.add(pipeZ(XRF.bodyZ0 - zo, XRF.bodyZ1 - zo, 0.07, M.alu(), 0, 0, 28));
  g.add(pipeZ(XRF.bodyZ1 - zo, XRF.bodyZ1 - 0.08 - zo, 0.05, M.blackAnod(), 0, 0, 20));
  g.add(pipeZ(XRF.bodyZ0 - zo + 0.02, XRF.bodyZ0 - zo, 0.075, M.steel()));
  // linear slide and floor stand
  g.add(boxSpan(-0.05, 0.05, -0.1, -0.07, XRF.wallZ - 0.06 - zo, XRF.bodyZ1 - zo, M.steel(), 0.003));
  g.add(boxSpan(-0.025, 0.025, FLOOR + 0.02, -0.1, -0.035, 0.015, M.steel(), 0.003));
  g.add(boxSpan(-0.12, 0.12, FLOOR, FLOOR + 0.02, -0.13, 0.11, M.steel(), 0.003));
  // cable to the electronics
  g.add(rod(new THREE.Vector3(0, 0, XRF.bodyZ1 - 0.08 - zo), new THREE.Vector3(0, -0.4, XRF.bodyZ1 - 0.25 - zo), 0.008, M.blackAnod(), 6));
  return shadowed(g);
}

function bellowsZ(z0: number, z1: number, r: number): THREE.Group {
  const g = bellowsX(0, Math.abs(z1 - z0), r);
  g.rotation.y = -Math.PI / 2; // +X → +Z
  g.position.z = Math.min(z0, z1);
  return g;
}

/** Fluorescence emitted by the sample toward the SDD window (amber cone filling the detector's solid angle). */
export function fluorescenceCone(): THREE.Mesh {
  const L = Math.abs(XRF.tipZ);
  const geo = new THREE.ConeGeometry(0.02, L, 32, 1, true);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf6b').multiplyScalar(1.8), transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending }),
  );
  // apex at the sample, opening toward +Z (outboard SDD)
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0, L / 2);
  return m;
}

/** helper used by the layout: the OSA sits between the plate and the sample */
export const OSA_OFFSET = OSA_X - SAMPLE_X;
