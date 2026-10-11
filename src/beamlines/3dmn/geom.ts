import * as THREE from 'three';

/**
 * 3DMN / 34-ID geometry used by the layout. Sources: APS-U FDR (2019) Table 4.63 + Figs. 4.58/4.59/4.67,
 * APS-U PDR (2017) §6-3, 34-ID-E wiki/web pages, Gursoy et al. 2022 and the lauelab geometry files.
 * Local beamline frame: +X downstream (m from the straight-section centre), +Y up (0 = beam), +Z outboard.
 */

const S2 = Math.SQRT1_2;

// ------------------------------------------------------------------ canted pair + first mirrors
/**
 * The two canted beams are 1 mrad apart (3DMN = upstream device = outboard). The layout rotates the whole group by
 * +0.5 mrad (cantMrad) so that local +X is the 3DMN beam's initial direction: 3DMN then runs along z = 0 up to its
 * mirror and ATOMIC diverges inboard at −1 mrad. Separations are therefore true (29.6 mm at the 3DMN mirror).
 */
export const CANT_MRAD = 0.5;
export const CANT = 1.0e-3;
/** Flat horizontally-deflecting first mirrors at 3.0 mrad grazing → 6 mrad deflection (PDR: 3DMN outboard, ATOMIC inboard). */
export const MIRROR_DEFLECTION = 6e-3;
export const M1_3DMN = 29.6;
export const M2_ATOMIC = 31.3;

/** True lateral position of the ATOMIC (inboard) beam in this frame: −1 mrad, then a further −6 mrad after its mirror at 31.3 m. */
export function atomicSide(x: number): number {
  return -CANT * Math.max(0, x) - (x > M2_ATOMIC ? MIRROR_DEFLECTION * (x - M2_ATOMIC) : 0);
}
/** True lateral position of the 3DMN beam (straight line after the outboard mirror). */
export function dmnSideTrue(x: number): number {
  return x > M1_3DMN ? MIRROR_DEFLECTION * (x - M1_3DMN) : 0;
}
/**
 * Engine branch ramp for 3DMN (the engine's branch offset is a smoothstep that then stays constant): starts at the outboard
 * mirror and reaches +0.19 m by ~56.6 m. True straight-line values are 0.145 m at the HDCM (53.8 m), 0.183 m at the micro
 * sample (60.1 m) and 0.216 m at the nano sample (65.6 m): the ramp stays within ~4 cm and keeps the beam parallel to X
 * inside 34-ID-E, where the instruments are.
 */
export const BRANCH_3DMN = { side: 0.19, divergeAtM: M1_3DMN, rampM: 27 };
export const SIDE_3DMN_E = BRANCH_3DMN.side;

/** Slope of the ATOMIC beam downstream of its mirror (rad, toward −Z). */
export const ATOMIC_SLOPE = -(CANT + MIRROR_DEFLECTION);

// ------------------------------------------------------------------ 34-ID-E (from FDR Fig. 4.58, ±0.1–0.3 m)
export const HUTCH_E = {
  /** C/E wall: ~55.0 m (FDR Table 4.63: both pink shutters in C at 54.8 m, ATOMIC pipe 'through 34-ID-E' from 55.1 m). */
  start: 55.0,
  step: 59.3,
  end: 67.5,
  height: 3.3,
  /** walls relative to the local axis (side 0) */
  narrow: { out: SIDE_3DMN_E + 1.6, in: SIDE_3DMN_E - 1.02 },
  wide: { out: SIDE_3DMN_E + 2.32, in: SIDE_3DMN_E - 1.96 },
};

/** 34-ID-E footprint as a polygon (local [x, z]; same winding as the other layouts' outlines) for the engine's outline hutch. */
export const OUTLINE_E: [number, number][] = [
  [HUTCH_E.start, HUTCH_E.narrow.in],
  [HUTCH_E.start, HUTCH_E.narrow.out],
  [HUTCH_E.step, HUTCH_E.narrow.out],
  [HUTCH_E.step, HUTCH_E.wide.out],
  [HUTCH_E.end, HUTCH_E.wide.out],
  [HUTCH_E.end, HUTCH_E.wide.in],
  [HUTCH_E.step, HUTCH_E.wide.in],
  [HUTCH_E.step, HUTCH_E.narrow.in],
];

/**
 * The partner ATOMIC hutch at 34-ID-F follows the trapezoidal plan in FDR Fig. 4.58, to ±0.2 m.
 * Its upstream wall at 67.5 m extends about 5.2 m outboard. The stepped diagonal outboard wall ends at 79.8 m,
 * and the inboard wall is straight. The vertices are the ATOMIC
 * exhibit's (its frame is rotated 1 mrad from this one: z = z_atomic − 1 mrad·x) so that both exhibits draw the same hutch.
 */
const F_ATOMIC_FRAME: [number, number][] = [
  [67.5, -2.29], [67.5, 5.25], [68.55, 5.29], [75.07, 2.73], [74.74, 1.93], [79.8, -0.2], [79.8, -2.29],
];
export const OUTLINE_F: [number, number][] = F_ATOMIC_FRAME.map(([x, z]) => [x, z - CANT * x]);
export const F_HEIGHT = 3.6;

// ------------------------------------------------------------------ micro-diffraction instrument (34ID-BI-1)
/** Micro focus / sample position: KB tabulated at 60.0 m; PDR focal lengths f_v ≈ 142 mm, f_h ≈ 70 mm put the focus ~0.1 m further. */
export const MICRO_X = 60.1;
export const MICRO_KB_X = 60.0;
/** Sample surface normal: 34-ID-E (0, 1, −1)/√2 in beamline (X out, Y up, Z beam) → (−1, 1, 0)/√2 here. */
export const N_SURF = new THREE.Vector3(-S2, S2, 0);
/** Wire scan direction H = (Y + Z)/√2 → (1, 1, 0)/√2 here (parallel to the sample surface). */
export const H_SCAN = new THREE.Vector3(S2, S2, 0);
/**
 * Detector geometry = the pre-upgrade 34-ID-E calibration (lauelab test file geoN_2023-04-06, 'CalibrationListOrange0 /
 * Yellow1 / Purple2'): centre = R·P with R the Rodrigues rotation, converted from 34-ID-E (X out, Y up, Z beam) to this frame.
 * Main detector (PE1621 = XRD1621): 2048² × 200 µm = 409.6 mm, face horizontal, centre 513 mm above and 29–31 mm downstream.
 */
export const TOP_DET = {
  dist: 0.513,
  center: new THREE.Vector3(0.031, 0.513, 0.002),
  normal: new THREE.Vector3(0, 1, 0),
  active: 0.4096,
  housing: 0.47,
  depth: 0.055,
};
/**
 * Side detectors (two PE0822 / 'XRD 0820 AN' panels, 1024² × 200 µm = 204.8 mm): 'Yellow' outboard and 'Purple' inboard. In the
 * calibration each panel is tilted 45° about the beam axis (face normal (0, ±1, 1)/√2 in 34-ID-E coordinates) at ~400 mm
 * perpendicular distance, with its centre ~0.14 m UPSTREAM of the sample (|centre| ≈ 0.43 m, 2θ ≈ 110° at the centre).
 * `normal` points from the sample side toward the panel; the active face looks back along −normal.
 */
export const SIDE_DET = {
  active: 0.2048,
  housing: 0.27,
  depth: 0.045,
  outCenter: new THREE.Vector3(-0.14, 0.266, 0.305),
  outNormal: new THREE.Vector3(0.011, 0.706, 0.708).normalize(),
  inCenter: new THREE.Vector3(-0.145, 0.305, -0.259),
  inNormal: new THREE.Vector3(-0.005, 0.706, -0.708).normalize(),
};
/** Vortex-class SDD: looks at the spot from outboard/upstream, ~28° above the 45° surface (illustrative). */
export const SDD = { dir: new THREE.Vector3(-0.55, 0.12, 0.83).normalize(), tip: 0.028, bodyAt: 0.2 };
/**
 * Pt wire: real ~50–100 µm diameter, ~0.2–1 mm above the surface. The model enlarges the whole wire neighbourhood
 * by a factor of 12, to r = 0.6 mm and height 6 mm, for visibility. The geometric ratios and blocked angular band are preserved.
 */
export const WIRE = { h: 0.006, r: 0.0006, half: 0.02, scale: 12 };
/** Optical microscope looks along the sample normal (34-ID-E "F = (−Y+Z)/√2"); long-working-distance objective. */
export const MICROSCOPE = { wd: 0.034, len: 0.3 };

// ------------------------------------------------------------------ nano-diffraction instrument (34ID-BI-2)
export const NANO_X = 65.6;
export const NANO_KB_X = 65.5;
/**
 * Nano thermal enclosure: FDR Fig. 4.58 draws the nano footprint at ~64.3–66.75 m, ~1.2 m wide, straddling BOTH the 3DMN
 * beam and ATOMIC's shielded pipe (~0.6 m outboard / inboard of the 3DMN beam); Fig. 4.67 quotes a 3000 mm dimension.
 * Drawn 64.0–66.7 m so that the 3DMN pink beam stop (66.9 m, Table 4.63) stands just outside its downstream wall.
 */
export const NANO_ENCL = { x0: 64.0, x1: 66.7, out: 0.7, in: -0.62, height: 2.35 };
export const NANO_TOP_DET = { dist: 0.5, active: 0.4096, housing: 0.47, depth: 0.055 };

/**
 * BCDI far-field detector (PDR: movable, 2–3 m from the micro sample; position illustrative). Drawn 2.2 m away along
 * k̂ = (0.30, 0.55, 0.78): 2θ ≈ 72° (e.g. Ni 400 at 12 keV) and k̂·n̂ = 0.18 > 0, i.e. the diffracted ray leaves through the
 * 45° surface (a forward, low-angle reflection would run into the sample). The ray clears the gantry posts and the
 * outboard side detector (~30° away); the detector sits ~2.6 m above the floor, below the hutch roof.
 */
export const BCDI = { x: MICRO_X + 0.66, side: 1.72, up: 1.21 };

/** ATOMIC transport through 34-ID-E (FDR: 55.1–67.5 m) and its supports read from Fig. 4.58 (64.2 → 63.8 m to clear the nano enclosure). */
export const ATOMIC_PIPE = { x0: 55.1, x1: 67.5, rIn: 0.045, rOut: 0.072, supports: [55.6, 56.9, 58.0, 60.8, 62.5, 63.8, 67.1] };
