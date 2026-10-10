import * as THREE from 'three';
import { branchSide } from '../../scene/beamline/layout';

/**
 * ATOMIC / 34-ID geometry used by the layout. Sources: APS-U FDR (2019) Table 4.63 + Figs. 4.58/4.59/4.64, APS-U PDR (2017)
 * §6-2 (Fig. 6.7), the ATOMIC dossier, and the 3DMN exhibit (same hutches, same distance reference).
 * Local beamline frame: +X downstream (m from the straight-section centre), +Y up (0 = beam), +Z outboard.
 */

// ------------------------------------------------------------------ canted pair + first mirrors
/**
 * The two canted beams are 1 mrad apart (3DMN = upstream U28 = outboard; ATOMIC = downstream revolver = inboard). The layout
 * rotates the whole group by −0.5 mrad so that local +X is ATOMIC's initial direction (the 3DMN exhibit uses +0.5 mrad, so the
 * two exhibits share one world geometry). Each flat first mirror deflects 6 mrad (3.0 mrad grazing): 3DMN outboard at 29.6 m,
 * ATOMIC inboard at 31.3 m (FDR Fig. 4.59, PDR §6-3.4.1). All lateral separations are true (no exaggeration).
 */
export const CANT_MRAD = -0.5;
export const CANT = 1.0e-3;
export const MIRROR_DEFLECTION = 6e-3;
export const M1_3DMN = 29.6;
export const M2_ATOMIC = 31.3;

/** True lateral position of the 3DMN (partner) beam in this frame: +1 mrad, then a further +6 mrad after its mirror. */
export function dmnSide(x: number): number {
  return CANT * x + (x > M1_3DMN ? MIRROR_DEFLECTION * (x - M1_3DMN) : 0);
}
/** True lateral position of the ATOMIC beam (straight line after the inboard mirror). */
export function atomicTrue(x: number): number {
  return x > M2_ATOMIC ? -MIRROR_DEFLECTION * (x - M2_ATOMIC) : 0;
}
/**
 * Engine branch ramp for ATOMIC (a smoothstep that then stays constant). Starts at the inboard mirror and reaches −0.24 m by
 * ~71 m. True straight-line values: −0.118 m at the HDCM (51.0 m), −0.136 m at KB1 (54 m), −0.229 m at the sample (69.5 m),
 * −0.284 m at the beam stop; the ramp stays within ~2 cm upstream of the sample and keeps the beam parallel to X inside
 * 34-ID-F, where the instruments are (the 6 mrad tilt over the 11 m hutch would be 7 cm).
 */
export const BRANCH_ATOMIC = { side: -0.24, divergeAtM: M2_ATOMIC, rampM: 40 };
export const atomicSide = (x: number): number => branchSide({ id: 'atomic', branches: { atomic: BRANCH_ATOMIC } }, 'atomic', x);

// ------------------------------------------------------------------ hutches (3DMN-exhibit values converted to this frame: z' = z + 1 mrad·x)
/** 34-ID-A/B/C boxes (side = centre offset, + outboard). Read from FDR Fig. 4.58 (±0.1–0.3 m), as in the 3DMN exhibit. */
export const HUTCH_A = { side: 0.33, widthM: 2.3 };
export const HUTCH_B = { side: 0.545, widthM: 2.5 };
export const HUTCH_C = { side: 0.951, widthM: 3.5 };
/** 34-ID-E (3DMN): stepped outline, ~2.6 m wide from 55.0 m (old 34-ID-D footprint), ~4.3 m from 59.3 m to the E/F wall at 67.5 m. */
export const E_OUTLINE: [number, number][] = [
  [55.0, -0.77], [55.0, 1.85], [59.3, 1.85], [59.3, 2.57], [67.5, 2.57], [67.5, -1.71], [59.3, -1.71], [59.3, -0.77],
];
/**
 * 34-ID-F (ATOMIC), read from the native FDR Fig. 4.58 raster (25 px/m): beam ~2.05 m from the straight inboard wall; upstream
 * wall 67.5 m, ~7.5 m wide; the outboard wall runs diagonally from ~5.5 m outboard of the beam at 68.5 m to ~3.0 m at 75.1 m,
 * steps in to ~2.2 m at 74.7 m and meets the beam line at the downstream wall (79.8 m). Offsets below include the beam's
 * −0.24 m position in this frame. PDR Fig. 6.7 elevation: taller roof (~3.5 m) for vertical detector travel.
 */
export const F_OUTLINE: [number, number][] = [
  [67.5, -2.29], [67.5, 5.25], [68.55, 5.29], [75.07, 2.73], [74.74, 1.93], [79.8, -0.2], [79.8, -2.29],
];
export const F_HEIGHT = 3.6;

// ------------------------------------------------------------------ optics positions
/** Zoom KB1 in 34-ID-C (drawing frame ~54 m; ray-trace spacing H 0.5 m before V). 350 mm mirrors. */
export const KB1 = { x: 54.0, hX: 53.75, vX: 54.25, len: 0.35 };
/**
 * Zoom KB2 just upstream of the sample: V mirror 400 mm centred 0.4 m before the focus, H mirror 140 mm centred 0.12 m before it
 * (FDR Fig. 4.64) → V 68.9–69.3 m, H 69.31–69.45 m; ~50 mm working distance.
 */
export const SAMPLE_X = 69.5;
export const KB2 = { x: 69.2, v0: 68.9, v1: 69.3, h0: 69.31, h1: 69.45 };
/** Intermediate-focus range for the zoom animation: KB1V image distance q1 = 1.25–13.2 m (FDR Fig. 4.64). */
export const ZOOM = { from: KB1.vX, qMin: 1.25, qMax: 13.2, kb2: (KB2.v0 + KB2.v1) / 2 };

// ------------------------------------------------------------------ endstation (station frame: origin = sample/focus)
export const S_SIDE = atomicSide(SAMPLE_X);
export const GRANITE = { x0: -0.7, x1: 0.5, z0: -0.45, z1: 0.45, top: -0.62 };

/**
 * Detector-positioning diffractometer (separate from the sample platform, PDR concept). The FDR plan (Fig. 4.58) draws a ~4.3 m
 * arm at ~35° toward the outboard side over a floor arc spanning ~8–67°. Model pose: δ = 30° (horizontal, outboard) and
 * γ = 16.8° (vertical) → 2θ = acos(cos δ cos γ) = 34.0°, Au(111) at 9 keV. Vertical travel is what a horizontally polarized
 * beam prefers (no cos²2θ loss), which is why the PDR hutch has a taller roof.
 */
export const ARM = {
  deltaDeg: 30,
  gammaDeg: 16.8,
  /** boom from 0.55 m to 4.45 m along the diffracted ray, 0.18 m below it */
  d0: 0.55,
  d1: 4.45,
  below: 0.18,
  /** floor ring (δ circle) radius around the sample axis, and the far-end floor arc rail (plan radius) */
  ringR: 0.95,
  railR: 4.26,
  railFromDeg: -8,
  railToDeg: 64,
  /** far-end support leg at this distance along the ray */
  legD: 4.3,
  /** BCDI detector distance; flight tube span along the ray */
  detD: 3.0,
  tube0: 0.35,
  tube1: 2.85,
};
const dR = THREE.MathUtils.degToRad(ARM.deltaDeg);
const gR = THREE.MathUtils.degToRad(ARM.gammaDeg);
/** Unit vector of the diffracted (Bragg) beam. */
export const KOUT = new THREE.Vector3(Math.cos(gR) * Math.cos(dR), Math.sin(gR), Math.cos(gR) * Math.sin(dR));
/** Unit vector perpendicular to KOUT in its vertical plane, pointing up. */
export const KUP = new THREE.Vector3(-Math.sin(gR) * Math.cos(dR), Math.cos(gR), -Math.sin(gR) * Math.sin(dR));
/** Horizontal unit vector of the arm's plan direction. */
export const KPLAN = new THREE.Vector3(Math.cos(dR), 0, Math.sin(dR));
export const TWO_THETA_DEG = THREE.MathUtils.radToDeg(Math.acos(Math.cos(dR) * Math.cos(gR)));

export const DET_REL = KOUT.clone().multiplyScalar(ARM.detD);
/** Side of the arm's vertical plane facing upstream-outboard (for broadside camera shots). */
export const KSIDE = new THREE.Vector3().crossVectors(KOUT, KUP).normalize();
const arr = (q: THREE.Vector3) => q.toArray() as [number, number, number];
/** Close-up camera directions (from target toward camera, local frame). */
export const SHOT = {
  armBroadside: arr(KSIDE.clone().multiplyScalar(0.8).addScaledVector(KUP, 0.55).addScaledVector(KOUT, -0.15).normalize()),
  detFace: arr(KOUT.clone().multiplyScalar(-0.75).addScaledVector(KUP, 0.45).addScaledVector(KSIDE, 0.5).normalize()),
};
export const TUBE_MID_REL = KOUT.clone().multiplyScalar((ARM.tube0 + ARM.tube1) / 2);
export const ARM_MID_REL = KOUT.clone().multiplyScalar(2.3).addScaledVector(KUP, -ARM.below);

/**
 * Laue orientation detector as at 34-ID-C (Zhang et al. 2023): on the inboard side facing outboard, sensor ~28 mm from the
 * sample (25 mm quoted), long axis along the beam, centre 30 mm downstream (forward-scattered Laue spots; clears KB2).
 */
export const LAUE = { n: new THREE.Vector3(0, 0, -1), dist: 0.028, dx: 0.03, sensor: [0.0771, 0.0386] as const };
export const LAUE_REL = LAUE.n.clone().multiplyScalar(LAUE.dist).add(new THREE.Vector3(LAUE.dx, 0, 0));
/** SDD looks at the spot from the outboard side, 90° to the beam in the horizontal plane (polarization minimum). */
export const SDD = { tip: 0.045, body0: 0.11, body1: 0.42 };
export const SDD_REL = new THREE.Vector3(0, 0, 0.25);

/** Upstream platform with BPM and apodizing apertures (68.1 m), between the E/F wall and KB2. */
export const PRECOND_X = 68.1;

// ------------------------------------------------------------------ ATOMIC transport through 34-ID-E
/** Shielded pipe 55.1–67.5 m (FDR Table 4.63); supports as in the 3DMN exhibit (clear of the 3DMN instruments). */
export const PIPE_E = { x0: 55.1, x1: 67.5, rIn: 0.045, rOut: 0.072, supports: [55.6, 56.9, 58.0, 60.8, 62.5, 63.8, 67.1] };

// ------------------------------------------------------------------ 3DMN partner (context)
export const DMN = { microX: 60.1, nanoX: 65.6, nanoEncl0: 64.0, nanoEncl1: 66.7, stopX: 66.9, hdcmX: 53.8, shutterX: 54.8 };
